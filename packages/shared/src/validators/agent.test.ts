import { describe, expect, it } from "vitest";
import { agentRuntimeConfigSchema } from "./agent.js";

describe("agentRuntimeConfigSchema", () => {
  it("accepts an explicit null aiConnection as the clear signal", () => {
    // The adapter-switch PATCH sends null to clear a binding that the new
    // adapter type cannot accept. undefined would be dropped by JSON.stringify,
    // so null has to survive validation for the server to see the intent.
    const parsed = agentRuntimeConfigSchema.safeParse({ aiConnection: null });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ aiConnection: null });
  });

  it("accepts an omitted aiConnection", () => {
    const parsed = agentRuntimeConfigSchema.safeParse({
      heartbeat: { enabled: true, intervalSec: 300 },
    });

    expect(parsed.success).toBe(true);
  });

  it("still accepts a valid aiConnection binding", () => {
    const parsed = agentRuntimeConfigSchema.safeParse({
      aiConnection: {
        provider: "anthropic",
        method: "subscription",
        mode: "responsible_user",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("still rejects a malformed aiConnection binding", () => {
    const parsed = agentRuntimeConfigSchema.safeParse({
      aiConnection: { provider: "not-a-provider", mode: "responsible_user" },
    });

    expect(parsed.success).toBe(false);
  });

  it("still rejects the removed modelProfiles key", () => {
    const parsed = agentRuntimeConfigSchema.safeParse({ modelProfiles: {} });

    expect(parsed.success).toBe(false);
  });
});
