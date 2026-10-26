import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, companyMemberships, createDb, principalPermissionGrants } from "@paperclipai/db";
import type { AiConnectionBinding } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { getServerAdapter, registerServerAdapter, unregisterServerAdapter } from "../adapters/index.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;

const ANTHROPIC_BINDING: AiConnectionBinding = { provider: "anthropic", method: "subscription", mode: "responsible_user" };

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "paperclip-adapter-switch-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", "adapter-switch");
  database = await startEmbeddedPostgresTestDatabase("paperclip-adapter-switch-db-");
  db = createDb(database.connectionString);
}, 90_000);

afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) await rm(home, { recursive: true, force: true });
});

/** A claude_local agent carrying a persisted Anthropic binding, edited by its company owner. */
async function fixture() {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const userId = `owner-${companyId}`;
  await db.insert(companies).values({ id: companyId, name: "Adapter switch test", issuePrefix: `S${companyId.slice(0, 7)}`, defaultResponsibleUserId: userId });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:configure" });
  await db.insert(agents).values({
    id: agentId, companyId, name: "Claude", role: "engineer", adapterType: "claude_local",
    adapterConfig: { model: "claude-sonnet-5" },
    runtimeConfig: { aiConnection: ANTHROPIC_BINDING, heartbeat: { enabled: true, intervalSec: 300 } },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "board", source: "session", userId, companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  const account = await aiConnectionService(db).save(companyId, userId, {
    provider: "anthropic", method: "subscription", name: "Owner's Claude", ownership: "personal",
    agentIds: [agentId], allAgents: false, loginSessionId: "fixture",
  }, "fixture-subscription-token");
  return { app, companyId, agentId, userId, account };
}

const stored = async (agentId: string) => (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!;

describe("switching an agent's harness with a stale AI connection binding", () => {
  it("drops the stale Anthropic binding when the switch omits aiConnection", async () => {
    // LOC-645: the agent still carries the claude_local binding, but the edit
    // moves it to opencode_local, which Anthropic cannot serve. A runtimeConfig
    // that omits aiConnection must not resurrect the old binding — neither in
    // the response, nor in the row, nor as a compatibility rejection of a save
    // that was never going to persist it.
    const f = await fixture();
    const response = await request(f.app).patch(`/api/agents/${f.agentId}`).send({
      adapterType: "opencode_local",
      adapterConfig: { model: "openai/gpt-5.4" },
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.adapterType).toBe("opencode_local");
    expect(response.body.runtimeConfig.aiConnection).toBeUndefined();
    expect((await stored(f.agentId)).runtimeConfig).not.toHaveProperty("aiConnection");
  });

  it("keeps the binding when the same harness is edited without aiConnection", async () => {
    // The mirror case that makes the one above a real guard: with the adapter
    // type unchanged, an omitted aiConnection still means "leave it alone".
    const f = await fixture();
    const response = await request(f.app).patch(`/api/agents/${f.agentId}`).send({
      runtimeConfig: { heartbeat: { enabled: false, intervalSec: 300 } },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.runtimeConfig.aiConnection).toEqual(ANTHROPIC_BINDING);
    expect((await stored(f.agentId)).runtimeConfig.aiConnection).toEqual(ANTHROPIC_BINDING);
  });

  it("rejects a switch that explicitly keeps the incompatible Anthropic binding", async () => {
    const f = await fixture();
    const response = await request(f.app).patch(`/api/agents/${f.agentId}`).send({
      adapterType: "opencode_local",
      adapterConfig: { model: "openai/gpt-5.4" },
      runtimeConfig: { aiConnection: ANTHROPIC_BINDING },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details.code).toBe("ai_connection_incompatible");
    expect((await stored(f.agentId)).adapterType).toBe("claude_local");
  });

  it("accepts the switch when the edit supplies the OpenRouter binding opencode needs", async () => {
    const f = await fixture();
    const openrouter: AiConnectionBinding = { provider: "openrouter", method: "api_key", mode: "responsible_user" };
    await aiConnectionService(db).save(f.companyId, f.userId, {
      provider: "openrouter", method: "api_key", name: "Owner's OpenRouter", ownership: "personal",
      agentIds: [f.agentId], allAgents: false, apiKey: "fixture-openrouter-key",
    }, "fixture-openrouter-key");
    // The save-time probe already ran; the adoption probe is the only reason
    // this edit would touch the harness or the provider, so both are stubbed.
    registerServerAdapter({ ...getServerAdapter("opencode_local"), testEnvironment: async () => ({ status: "pass", checks: [] }) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    try {
      const response = await request(f.app).patch(`/api/agents/${f.agentId}`).send({
        adapterType: "opencode_local",
        adapterConfig: { model: "openai/gpt-5.4" },
        runtimeConfig: { aiConnection: openrouter },
      });

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.runtimeConfig.aiConnection).toEqual(openrouter);
      expect((await stored(f.agentId)).runtimeConfig.aiConnection).toEqual(openrouter);
    } finally {
      vi.unstubAllGlobals();
      unregisterServerAdapter("opencode_local");
    }
  });
});

/** A paperclip_runner agent carrying a router binding, edited by its company owner. */
async function runnerFixture(adapterConfig: Record<string, unknown>) {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const userId = `owner-${companyId}`;
  const routerBinding = { mode: "router" as const, connectionId: "00000000-0000-4000-8000-000000000099" };
  await db.insert(companies).values({ id: companyId, name: "Runner guard test", issuePrefix: `R${companyId.slice(0, 7)}`, defaultResponsibleUserId: userId });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:configure" });
  await db.insert(agents).values({
    id: agentId, companyId, name: "Codex Runner", role: "engineer",
    adapterType: "paperclip_runner",
    adapterConfig,
    runtimeConfig: { aiConnection: routerBinding, heartbeat: { enabled: true, intervalSec: 300 } },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "board", source: "session", userId, companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  return { app, companyId, agentId, userId, routerBinding };
}

describe("re-injection guard normalizes existingHarness before comparing (LOC-693)", () => {
  it("preserves AI binding for runner with acpx/codex stored adapterConfig on harness-preserving PATCH", async () => {
    // LOC-693: stored {provider:"acpx",acpxAgent:"codex"} normalizes to {provider:"codex"}.
    // The re-injection guard must normalize existing.adapterConfig before comparing harnesses
    // so the binding is not silently dropped when the PATCH sends the same raw config.
    const f = await runnerFixture({ provider: "acpx", acpxAgent: "codex", model: "gpt-5.5" });
    const response = await request(f.app).patch(`/api/agents/${f.agentId}`).send({
      adapterType: "paperclip_runner",
      adapterConfig: { provider: "acpx", acpxAgent: "codex", model: "gpt-5.5" },
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.runtimeConfig.aiConnection).toEqual(f.routerBinding);
    expect((await stored(f.agentId)).runtimeConfig.aiConnection).toEqual(f.routerBinding);
  });

  it("preserves AI binding for runner with provider-less stored adapterConfig on harness-preserving PATCH", async () => {
    // LOC-693: stored {} (provider-less) normalizes to {provider:"codex"}.
    // Harness must agree on both sides of the comparison so the binding is preserved.
    const f = await runnerFixture({});
    const response = await request(f.app).patch(`/api/agents/${f.agentId}`).send({
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.runtimeConfig.aiConnection).toEqual(f.routerBinding);
    expect((await stored(f.agentId)).runtimeConfig.aiConnection).toEqual(f.routerBinding);
  });
});
