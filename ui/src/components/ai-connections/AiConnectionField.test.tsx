// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { AiConnectionField } from "./AiConnectionField";

const mockAgentsApi = vi.hoisted(() => ({
  opencodeGatewayProviders: vi.fn(),
}));

const mockAiConnectionsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("@/api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: mockAiConnectionsApi }));

const DECLARED_PROVIDERS = [{ id: "vllm-fleet", baseUrl: "http://100.115.234.63:65000/v1" }];
const NO_CONNECTIONS = { currentUserId: "user-1", connections: [] };

let root: Root | undefined;
let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockAiConnectionsApi.list.mockResolvedValue(NO_CONNECTIONS);
  // Seed ai-connections cache so the component renders without a real API call.
  queryClient.setQueryData(["ai-connections", "company-1", undefined], NO_CONNECTIONS);
});

afterEach(() => {
  if (root) flushSync(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function mount(
  adapterType: string,
  model: string,
  gatewayProviders = DECLARED_PROVIDERS,
  value?: React.ComponentProps<typeof AiConnectionField>["value"],
) {
  queryClient.setQueryData(
    queryKeys.agents.opencodeGatewayProviders("company-1"),
    gatewayProviders,
  );
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <AiConnectionField
          companyId="company-1"
          agentName="Test Agent"
          adapterType={adapterType}
          model={model}
          value={value}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  );
  return container;
}

describe("AiConnectionField gateway box", () => {
  it("shows gateway box and Billing & auth heading for a declared gateway model", () => {
    const container = mount("opencode_local", "vllm-fleet/qwen3.8-27b");

    expect(container.textContent).toContain("Inference gateway: vllm-fleet");
    expect(container.textContent).toContain("http://100.115.234.63:65000/v1");
    expect(container.textContent).toContain("Billing & auth");
    expect(container.textContent).not.toContain("AI connection");
  });

  it("names the gateway for a vllm_fleet agent and keeps the connection billing-only", () => {
    const container = mount("vllm_fleet", "vllm-fleet/qwen3.8-27b", DECLARED_PROVIDERS, {
      provider: "openrouter",
      method: "api_key",
      mode: "responsible_user",
    });

    expect(container.textContent).toContain("Inference gateway: vllm-fleet");
    expect(container.textContent).toContain("http://100.115.234.63:65000/v1");
    expect(container.textContent).toContain("Billing & auth");
    // An OpenRouter connection on a vllm-fleet model must not be reported as
    // incompatible — that warning is what blocked saving the agent.
    expect(container.textContent).not.toContain("does not support the current harness");
  });

  it("hides gateway box and keeps AI connection heading when model prefix is not a declared provider", () => {
    // openai is not in DECLARED_PROVIDERS, so openai/gpt-5.2-codex is not a gateway model
    const container = mount("opencode_local", "openai/gpt-5.2-codex");

    expect(container.textContent).not.toContain("Inference gateway:");
    expect(container.textContent).toContain("AI connection");
    expect(container.textContent).not.toContain("Billing & auth");
  });

  it("leaves openrouter/* models unchanged — no gateway box, AI connection heading", () => {
    // openrouter/ prefix → couldBeGatewayModel is false, query is never enabled
    const container = mount("opencode_local", "openrouter/anthropic/claude-3.5-sonnet");

    expect(mockAgentsApi.opencodeGatewayProviders).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Inference gateway:");
    expect(container.textContent).toContain("AI connection");
  });
});
