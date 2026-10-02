// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeysTab as KeysTabDev } from "./AgentDetail";
import { KeysTab as KeysTabProd } from "./AgentDetail.production";

const mockAgentsApi = vi.hoisted(() => ({
  listKeys: vi.fn(),
  createKey: vi.fn(),
  revokeKey: vi.fn(),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));

vi.mock("../context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The form validates these as UUIDs before it will submit a task_bridge scope.
const PARENT_ISSUE_ID = "3f1b2c9e-5d7a-4b11-9a3e-1c2d3e4f5a6b";
const ASSIGNEE_A = "9a8b7c6d-1111-4222-8333-444455556666";
const ASSIGNEE_B = "7c6d5e4f-2222-4333-8444-555566667777";

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function setNativeValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe.each([
  ["AgentDetail (dev)", KeysTabDev],
  ["AgentDetail.production", KeysTabProd],
] as const)("KeysTab scope selector — %s", (_label, KeysTab) => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentsApi.listKeys.mockResolvedValue([]);
    mockAgentsApi.createKey.mockResolvedValue({ token: "pk_test_token" });
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container.remove();
    queryClient.clear();
  });

  async function renderKeysTab() {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <KeysTab agentId="agent-1" companyId="company-1" />
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  function createButton() {
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === "Create");
    if (!button) throw new Error("Create button not found");
    return button as HTMLButtonElement;
  }

  function scopeOption(title: string) {
    const option = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((candidate) => candidate.textContent?.includes(title));
    if (!option) throw new Error(`Scope option not found: ${title}`);
    return option;
  }

  function inputByPlaceholder(placeholder: string) {
    return container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  }

  it("creates a standard key with no scope", async () => {
    await renderKeysTab();

    expect(scopeOption("Standard").getAttribute("aria-checked")).toBe("true");
    expect(inputByPlaceholder("Issue UUID")).toBeNull();

    setNativeValue(inputByPlaceholder("Key name (e.g. production)")!, "production");
    await flushReact();
    await act(async () => {
      createButton().click();
    });
    await flushReact();

    expect(mockAgentsApi.createKey).toHaveBeenCalledWith("agent-1", "production", "company-1", undefined);
  });

  it("creates a task bridge key with the parent issue and assignee scope", async () => {
    await renderKeysTab();

    await act(async () => {
      scopeOption("Task bridge").click();
    });
    await flushReact();

    // No parent issue yet: the server would reject the scope, so the submit is held.
    expect(createButton().disabled).toBe(true);
    expect(container.textContent).toContain(
      "Task bridge keys can only create tasks under the specified parent issue.",
    );

    setNativeValue(inputByPlaceholder("Issue UUID")!, ` ${PARENT_ISSUE_ID} `);
    setNativeValue(
      inputByPlaceholder("Agent UUIDs, comma separated")!,
      `${ASSIGNEE_A} , ${ASSIGNEE_B},`,
    );
    await flushReact();

    expect(createButton().disabled).toBe(false);
    await act(async () => {
      createButton().click();
    });
    await flushReact();

    expect(mockAgentsApi.createKey).toHaveBeenCalledWith("agent-1", "Default", "company-1", {
      kind: "task_bridge",
      parentIssueId: PARENT_ISSUE_ID,
      allowedAssigneeAgentIds: [ASSIGNEE_A, ASSIGNEE_B],
    });
  });

  it("omits empty assignee lists from the task bridge scope", async () => {
    await renderKeysTab();

    await act(async () => {
      scopeOption("Task bridge").click();
    });
    await flushReact();

    setNativeValue(inputByPlaceholder("Issue UUID")!, PARENT_ISSUE_ID);
    await flushReact();
    await act(async () => {
      createButton().click();
    });
    await flushReact();

    expect(mockAgentsApi.createKey).toHaveBeenCalledWith("agent-1", "Default", "company-1", {
      kind: "task_bridge",
      parentIssueId: PARENT_ISSUE_ID,
    });
  });

  it("blocks the submit while a task bridge ID is not a UUID", async () => {
    await renderKeysTab();

    await act(async () => {
      scopeOption("Task bridge").click();
    });
    await flushReact();

    setNativeValue(inputByPlaceholder("Issue UUID")!, "not-a-uuid");
    await flushReact();
    expect(container.textContent).toContain("Enter a valid issue UUID.");
    expect(createButton().disabled).toBe(true);

    setNativeValue(inputByPlaceholder("Issue UUID")!, PARENT_ISSUE_ID);
    setNativeValue(inputByPlaceholder("Agent UUIDs, comma separated")!, "nope");
    await flushReact();
    expect(container.textContent).toContain("Enter agent UUIDs separated by commas.");
    expect(createButton().disabled).toBe(true);

    expect(mockAgentsApi.createKey).not.toHaveBeenCalled();
  });
});
