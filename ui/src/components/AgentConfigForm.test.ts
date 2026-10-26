import { describe, expect, it } from "vitest";
import type { Environment } from "@paperclipai/shared";
import {
  adapterSwitchPreservesAiConnection,
  resolvePaperclipRunnerTransitionModel,
  supportsAdapterModelRefresh,
} from "./AgentConfigForm";
import { paperclipRunnerTransitionConfig } from "@paperclipai/adapter-utils";
import { resolveForcedKubernetesEnvironment } from "../lib/forced-kubernetes-environment";

describe("supportsAdapterModelRefresh", () => {
  it("enables the model refresh action for Claude and Codex adapters", () => {
    expect(supportsAdapterModelRefresh("claude_local")).toBe(true);
    expect(supportsAdapterModelRefresh("codex_local")).toBe(true);
    expect(supportsAdapterModelRefresh("acpx_local")).toBe(false);
  });

  it("keeps the refresh action hidden for adapters without a live refresh hook", () => {
    expect(supportsAdapterModelRefresh("opencode_local")).toBe(true);
    expect(supportsAdapterModelRefresh("paperclip_runner")).toBe(true);
    expect(supportsAdapterModelRefresh("process")).toBe(false);
  });
});

describe("resolvePaperclipRunnerTransitionModel", () => {
  it("preserves Claude custom model IDs", () => {
    expect(resolvePaperclipRunnerTransitionModel("claude_local", "custom-claude-model")).toBe("custom-claude-model");
  });
  it("preserves an explicit model from codex_local", () => {
    expect(resolvePaperclipRunnerTransitionModel("codex_local", "gpt-5.5"))
      .toBe("gpt-5.5");
  });

  it("uses the current Codex default when the source model is blank", () => {
    expect(resolvePaperclipRunnerTransitionModel("codex_local", ""))
      .toBe("gpt-5.6-sol");
  });
});

describe("adapterSwitchPreservesAiConnection", () => {
  /** The config the adapter-type onChange handler builds when switching to the runner. */
  const toRunner = (from: string) => paperclipRunnerTransitionConfig(from, "");

  it("preserves the binding switching claude_local -> harness-equivalent paperclip_runner", () => {
    const next = toRunner("claude_local");
    expect(next.provider).toBe("acpx");
    expect(next.acpxAgent).toBe("claude");
    expect(adapterSwitchPreservesAiConnection("claude_local", {}, "paperclip_runner", next)).toBe(true);
  });

  it("preserves the binding switching harness-equivalent paperclip_runner -> claude_local", () => {
    expect(
      adapterSwitchPreservesAiConnection(
        "paperclip_runner",
        { provider: "acpx", acpxAgent: "claude" },
        "claude_local",
        {},
      ),
    ).toBe(true);
  });

  it("preserves the binding switching codex_local and opencode_local onto their runner variants", () => {
    expect(adapterSwitchPreservesAiConnection("codex_local", {}, "paperclip_runner", toRunner("codex_local"))).toBe(true);
    expect(adapterSwitchPreservesAiConnection("opencode_local", {}, "paperclip_runner", toRunner("opencode_local"))).toBe(true);
  });

  it("clears the binding when the harness actually changes", () => {
    expect(adapterSwitchPreservesAiConnection("claude_local", {}, "codex_local", {})).toBe(false);
    expect(adapterSwitchPreservesAiConnection("claude_local", {}, "opencode_local", {})).toBe(false);
    expect(adapterSwitchPreservesAiConnection("opencode_local", {}, "gemini_local", {})).toBe(false);
  });

  it("clears the binding when the runner tunnels to a different harness than the old adapter", () => {
    expect(
      adapterSwitchPreservesAiConnection("opencode_local", {}, "paperclip_runner", { provider: "acpx", acpxAgent: "claude" }),
    ).toBe(false);
    expect(
      adapterSwitchPreservesAiConnection("paperclip_runner", { provider: "codex" }, "claude_local", {}),
    ).toBe(false);
  });

  it("clears the binding when neither side resolves to a real harness", () => {
    expect(
      adapterSwitchPreservesAiConnection(
        "paperclip_runner",
        { provider: "openai_dot" },
        "paperclip_runner",
        { provider: "muse" },
      ),
    ).toBe(false);
  });

  it("clears the binding when switching an external runner choice onto the runner adapter", () => {
    expect(
      adapterSwitchPreservesAiConnection("claude_local", {}, "paperclip_runner", { provider: "openai_dot" }),
    ).toBe(false);
  });
});

function makeEnvironment(overrides: Partial<Environment>): Environment {
  return {
    id: "env-1",
    name: "Env",
    description: null,
    driver: "local",
    status: "active",
    config: {},
    envVars: {},
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const localEnv = makeEnvironment({ id: "local-1", name: "Local", driver: "local" });
const k8sEnv = makeEnvironment({
  id: "k8s-1",
  name: "Managed K8s",
  driver: "sandbox",
  config: { provider: "kubernetes" },
});

describe("resolveForcedKubernetesEnvironment", () => {
  it("does not force when executionMode is 'any' (full picker / unchanged)", () => {
    const result = resolveForcedKubernetesEnvironment("any", [localEnv, k8sEnv]);
    expect(result.forced).toBe(false);
    expect(result.kubernetesEnvironment).toBeNull();
  });

  it("does not force when executionMode is absent (self-hoster default)", () => {
    const result = resolveForcedKubernetesEnvironment(undefined, [localEnv, k8sEnv]);
    expect(result.forced).toBe(false);
    expect(result.kubernetesEnvironment).toBeNull();
  });

  it("forces and selects the Kubernetes sandbox when executionMode is 'kubernetes'", () => {
    const result = resolveForcedKubernetesEnvironment("kubernetes", [localEnv, k8sEnv]);
    expect(result.forced).toBe(true);
    expect(result.kubernetesEnvironment?.id).toBe("k8s-1");
  });

  it("forces but reports no environment when none is the Kubernetes sandbox", () => {
    const fakeSandbox = makeEnvironment({
      id: "fake-1",
      driver: "sandbox",
      config: { provider: "fake" },
    });
    const result = resolveForcedKubernetesEnvironment("kubernetes", [localEnv, fakeSandbox]);
    expect(result.forced).toBe(true);
    expect(result.kubernetesEnvironment).toBeNull();
  });
});
