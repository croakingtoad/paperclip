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

// mode:"shared" (not "responsible_user") so isAiConnectionCompatible hits the early-return at
// ai-connections.ts:133 and returns true for both codex_local and opencode_local — only the
// agentHarnessType() comparison can block re-injection, which is exactly what MAJ-1 tests.
const OPENAI_BINDING: AiConnectionBinding = {
  provider: "openai", method: "api_key", mode: "shared",
  connectionId: "00000000-0000-4000-8000-000000000010",
  grantId: "00000000-0000-4000-8000-000000000011",
};

/** A paperclip_runner/codex agent carrying a persisted OpenAI binding, edited by its company owner. */
async function runnerCodexFixture() {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const userId = `owner-${companyId}`;
  await db.insert(companies).values({ id: companyId, name: "Runner switch test", issuePrefix: `R${companyId.slice(0, 7)}`, defaultResponsibleUserId: userId });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:configure" });
  await db.insert(agents).values({
    id: agentId, companyId, name: "Codex agent", role: "engineer", adapterType: "paperclip_runner",
    // cwd is set to the isolated temp home so assertManagedAiProjectAuth scans only that tree,
    // not the host user's ~/.codex/config.toml which may contain model_provider= entries.
    adapterConfig: { provider: "codex", model: "o4-mini", cwd: home },
    runtimeConfig: { aiConnection: OPENAI_BINDING },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "board", source: "session", userId, companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  await aiConnectionService(db).save(companyId, userId, {
    provider: "openai", method: "api_key", name: "Owner's OpenAI", ownership: "personal",
    agentIds: [agentId], allAgents: false, apiKey: "fixture-openai-key",
  }, "fixture-openai-key");
  return { app, companyId, agentId, userId };
}

describe("paperclip_runner provider switch with stale AI connection (MAJ-1)", () => {
  it("does not re-inject the stale openai binding when switching codex→opencode provider", async () => {
    // MAJ-1: adapterType stays "paperclip_runner" for both codex and opencode providers, but
    // the effective harness changes (codex_local→opencode_local). The guard's agentHarnessType()
    // comparison must detect this and suppress re-injection. OPENAI_BINDING uses mode:"shared"
    // so isAiConnectionCompatible returns true for both harnesses (ai-connections.ts:133) —
    // only the harness comparison can block re-injection, isolating the MAJ-1 fix.
    const f = await runnerCodexFixture();
    const response = await request(f.app).patch(`/api/agents/${f.agentId}`).send({
      adapterConfig: { provider: "opencode", model: "openai/gpt-5.4" },
      runtimeConfig: {},  // omits aiConnection — buggy guard would inject stale openai binding
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.runtimeConfig?.aiConnection).toBeUndefined();
    expect((await stored(f.agentId)).runtimeConfig).not.toHaveProperty("aiConnection");
  });
});
