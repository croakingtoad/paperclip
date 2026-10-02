import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  companies,
  companyMemberships,
  createDb,
  issueRelations,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { documentService } from "../services/documents.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue transfer route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BOARD_USER_ID = "cross-company-user-1";

describeEmbeddedPostgres("POST /api/issues/:id/transfer-to-company", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-transfer-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /** A board session that is a member of exactly `companyIds`. */
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

  // `issues.identifier` is globally unique, so the prefix has to be the seeded
  // company's own.
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

  it("copies the issue, its named documents and links both sides", async () => {
    const source = await seedCompany("SRC");
    const target = await seedCompany("DST");
    const sourceIssueId = await seedSourceIssue(source, 1);

    const documents = documentService(db);
    await documents.upsertIssueDocument({
      issueId: sourceIssueId,
      key: "plan",
      title: "Plan",
      format: "markdown",
      body: "## Plan\n\nStep one.",
      createdByUserId: BOARD_USER_ID,
    });
    await documents.upsertIssueDocument({
      issueId: sourceIssueId,
      key: "handoff",
      title: "Handoff",
      format: "markdown",
      body: "Notes for the receiving team.",
      createdByUserId: BOARD_USER_ID,
    });

    const app = createApp([source.companyId, target.companyId]);
    const response = await request(app)
      .post(`/api/issues/${sourceIssueId}/transfer-to-company`)
      .send({ targetCompanyId: target.companyId, targetProjectId: target.projectId });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.identifier).toMatch(/^DST-\d+$/);

    const transferredId = response.body.id as string;
    const transferred = await db
      .select()
      .from(issues)
      .where(eq(issues.id, transferredId))
      .then((rows) => rows[0] ?? null);
    expect(transferred).toMatchObject({
      companyId: target.companyId,
      projectId: target.projectId,
      title: "Ship the cross-company handoff",
      description: "The source description, verbatim.",
    });

    const copied = await documents.listIssueDocuments(transferredId);
    expect(copied.map((doc) => doc.key).sort()).toEqual(["handoff", "plan"]);
    expect(copied.find((doc) => doc.key === "plan")?.body).toBe("## Plan\n\nStep one.");
    expect(copied.find((doc) => doc.key === "handoff")?.body).toBe(
      "Notes for the receiving team.",
    );

    const links = await db
      .select({
        companyId: issueRelations.companyId,
        issueId: issueRelations.issueId,
        relatedIssueId: issueRelations.relatedIssueId,
      })
      .from(issueRelations)
      .where(
        and(
          eq(issueRelations.type, "transfer"),
          inArray(issueRelations.issueId, [sourceIssueId, transferredId]),
        ),
      );
    expect(links).toEqual(
      expect.arrayContaining([
        {
          companyId: source.companyId,
          issueId: sourceIssueId,
          relatedIssueId: transferredId,
        },
        {
          companyId: target.companyId,
          issueId: transferredId,
          relatedIssueId: sourceIssueId,
        },
      ]),
    );
    expect(links).toHaveLength(2);

    // The handoff copies; it never mutates the source.
    const sourceStillThere = await db
      .select({ status: issues.status, companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, sourceIssueId))
      .then((rows) => rows[0] ?? null);
    expect(sourceStillThere).toMatchObject({ status: "todo", companyId: source.companyId });
  });

  it("rejects a target company the acting user does not belong to", async () => {
    const source = await seedCompany("SRA");
    const target = await seedCompany("DSA");
    const sourceIssueId = await seedSourceIssue(source, 1);

    const app = createApp([source.companyId]);
    const response = await request(app)
      .post(`/api/issues/${sourceIssueId}/transfer-to-company`)
      .send({ targetCompanyId: target.companyId, targetProjectId: target.projectId });

    expect(response.status, JSON.stringify(response.body)).toBe(403);
    const created = await db
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.companyId, target.companyId));
    expect(created).toHaveLength(0);
  });

  it("rejects an agent key even when both companies are reachable", async () => {
    const source = await seedCompany("SRB");
    const target = await seedCompany("DSB");
    const sourceIssueId = await seedSourceIssue(source, 1);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "agent",
        agentId: randomUUID(),
        companyId: source.companyId,
        source: "agent_key",
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);

    const response = await request(app)
      .post(`/api/issues/${sourceIssueId}/transfer-to-company`)
      .send({ targetCompanyId: target.companyId, targetProjectId: target.projectId });

    expect(response.status, JSON.stringify(response.body)).toBe(403);
  });

  it("rejects a target project that belongs to another company", async () => {
    const source = await seedCompany("SRC2");
    const target = await seedCompany("DST2");
    const sourceIssueId = await seedSourceIssue(source, 1);

    const app = createApp([source.companyId, target.companyId]);
    const response = await request(app)
      .post(`/api/issues/${sourceIssueId}/transfer-to-company`)
      .send({ targetCompanyId: target.companyId, targetProjectId: source.projectId });

    expect(response.status, JSON.stringify(response.body)).toBe(404);
    const stray = await db
      .select({ id: issueRelations.id })
      .from(issueRelations)
      .where(and(eq(issueRelations.type, "transfer"), eq(issueRelations.issueId, sourceIssueId)));
    expect(stray).toHaveLength(0);
  });
});
