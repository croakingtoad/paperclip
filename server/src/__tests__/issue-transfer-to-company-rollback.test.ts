import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  companyMemberships,
  createDb,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { documentService as realDocumentService } from "../services/documents.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";

// Mock documentService so that upsertIssueDocument throws, simulating a
// mid-write failure. listIssueDocuments and every other method use the real
// implementation so the route actually reaches the failing upsert.
vi.mock("../services/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/index.js")>();
  return {
    ...real,
    documentService: (db: any) => {
      const realSvc = realDocumentService(db);
      return {
        ...realSvc,
        upsertIssueDocument: async () => {
          throw new Error("simulated disk failure");
        },
      };
    },
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping rollback test on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BOARD_USER_ID = "rollback-test-user-1";

describeEmbeddedPostgres("POST /api/issues/:id/transfer-to-company — rollback", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-transfer-rollback-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(companyIds: string[]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: BOARD_USER_ID,
        companyIds,
        memberships: companyIds.map((companyId) => ({
          companyId,
          membershipRole: "owner",
          status: "active",
        })),
        source: "cloud_tenant",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany(prefix: string) {
    const companyId = randomUUID();
    const projectId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Company ${prefix}`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: BOARD_USER_ID,
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      companyId,
      principalId: BOARD_USER_ID,
      membershipRole: "owner",
      grantedByUserId: null,
    });
    await db.insert(projects).values({ id: projectId, companyId, name: `Project ${prefix}` });
    return { companyId, projectId, prefix };
  }

  async function seedSourceIssue(
    company: { companyId: string; projectId: string; prefix: string },
    issueNumber: number,
  ) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId: company.companyId,
      projectId: company.projectId,
      issueNumber,
      identifier: `${company.prefix}-${issueNumber}`,
      title: "Ship the cross-company handoff",
      description: "The source description, verbatim.",
      status: "todo",
      priority: "high",
      createdByUserId: BOARD_USER_ID,
    });
    return issueId;
  }

  it("rolls back cleanly when a document upsert fails — no orphaned issue in target company", async () => {
    const source = await seedCompany("SRR");
    const target = await seedCompany("DSR");
    const sourceIssueId = await seedSourceIssue(source, 1);

    // Seed one document on the source so the route enters the upsert loop.
    // The mocked upsertIssueDocument will throw, which should roll back the
    // issue creation and relation writes that happened earlier in the same tx.
    await realDocumentService(db).upsertIssueDocument({
      issueId: sourceIssueId,
      key: "plan",
      title: "Plan",
      format: "markdown",
      body: "## Plan\n\nStep one.",
      createdByUserId: BOARD_USER_ID,
    });

    const app = createApp([source.companyId, target.companyId]);
    const response = await request(app)
      .post(`/api/issues/${sourceIssueId}/transfer-to-company`)
      .send({ targetCompanyId: target.companyId, targetProjectId: target.projectId });

    expect(response.status).toBe(500);

    const orphans = await db
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.companyId, target.companyId));
    expect(orphans).toHaveLength(0);
  });
});
