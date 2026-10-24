// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TransferIssueToCompanyDialog } from "./TransferIssueToCompanyDialog";

const companies = vi.hoisted(() => [
  { id: "company-1", name: "Acme Labs", issuePrefix: "PAP", status: "active" },
  { id: "company-2", name: "Strata", issuePrefix: "STR", status: "active" },
  { id: "company-3", name: "Retired Co", issuePrefix: "RET", status: "archived" },
]);
const pushToast = vi.hoisted(() => vi.fn());
const transferToCompany = vi.hoisted(() => vi.fn());
const listProjects = vi.hoisted(() => vi.fn());
const getCurrentBoardAccess = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    isInstanceAdmin: false,
    companyIds: ["company-1", "company-2"],
    memberships: [
      { companyId: "company-1", membershipRole: "owner", status: "active" },
      { companyId: "company-2", membershipRole: "member", status: "active" },
    ],
    source: "session",
    keyId: null,
    userId: "user-1",
    user: null,
  }),
);

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ companies }),
}));
vi.mock("../context/ToastContext", () => ({
  useToastActions: () => ({ pushToast }),
}));
vi.mock("../api/issues", () => ({
  issuesApi: { transferToCompany },
}));
vi.mock("../api/projects", () => ({
  projectsApi: { list: listProjects },
}));
vi.mock("../api/access", () => ({
  accessApi: { getCurrentBoardAccess },
}));

// Radix Select leans on Pointer Capture APIs jsdom omits.
const OriginalPointerEvent = globalThis.PointerEvent;
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as any;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});
afterAll(() => {
  globalThis.PointerEvent = OriginalPointerEvent;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ISSUE = {
  id: "issue-1",
  identifier: "PAP-42",
  title: "Ship the handoff",
  companyId: "company-1",
};

describe("TransferIssueToCompanyDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pushToast.mockReset();
    transferToCompany.mockReset().mockResolvedValue({ id: "issue-9", identifier: "STR-9" });
    listProjects.mockReset().mockResolvedValue([
      { id: "project-9", name: "Platform", archivedAt: null },
      { id: "project-10", name: "Sunset", archivedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  function render() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={client}>
          <TransferIssueToCompanyDialog open onOpenChange={() => {}} issue={ISSUE} />
        </QueryClientProvider>,
      );
    });
  }

  async function settle() {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushSync(() => {});
    }
  }

  function comboboxes() {
    return [...document.querySelectorAll<HTMLElement>('[role="combobox"]')];
  }

  function optionLabels() {
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((node) =>
      node.textContent?.trim(),
    );
  }

  function clickOption(label: string) {
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (node) => node.textContent?.trim() === label,
    );
    if (!option) throw new Error(`No option labelled ${label}`);
    flushSync(() => {
      option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      option.click();
    });
  }

  function openSelect(index: number) {
    flushSync(() => {
      comboboxes()[index]!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      comboboxes()[index]!.click();
    });
  }

  function button(label: string) {
    return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent?.trim() === label,
    );
  }

  it("offers only the other active companies and sends the task to the chosen project", async () => {
    render();
    await settle();

    expect(button("Send")?.disabled).toBe(true);

    openSelect(0);
    await settle();
    // The task's own company and the archived one are not handoff targets.
    expect(optionLabels()).toEqual(["Strata"]);
    clickOption("Strata");
    await settle();

    expect(listProjects).toHaveBeenCalledWith("company-2");
    openSelect(1);
    await settle();
    // Archived projects are not offered either.
    expect(optionLabels()).toEqual(["Platform"]);
    clickOption("Platform");
    await settle();

    // Confirmation summary names what is copied and where it lands.
    expect(document.body.textContent).toContain("PAP-42");
    expect(document.body.textContent).toContain("Ship the handoff");
    expect(document.body.textContent).toContain("Strata");
    expect(document.body.textContent).toContain("Platform");

    const send = button("Send")!;
    expect(send.disabled).toBe(false);
    flushSync(() => send.click());
    await settle();

    expect(transferToCompany).toHaveBeenCalledWith("issue-1", {
      targetCompanyId: "company-2",
      targetProjectId: "project-9",
    });
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "success",
        action: { label: "STR-9", href: "/STR/issues/STR-9" },
      }),
    );
  });
});
