import { afterEach, describe, expect, it, vi } from "vitest";
import { issueExecutionPolicySchema } from "@paperclipai/shared";
import type { Issue } from "@paperclipai/shared";
import { buildExecutionPolicy, isPendingExecutionParticipant } from "./issue-execution-policy";

const AGENT_ID = "00000000-0000-4000-8000-000000000001";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_ID = "00000000-0000-4000-8000-000000000002";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000003";

describe("reading execution policy defaults", () => {
  it.each([
    {},
    { authorizationPolicy: { trustPreset: "standard" } },
    { monitor: { nextCheckAt: "2099-01-01T00:00:00.000Z" } },
    { stages: [{ type: "review" }] },
  ])("reads schema-valid omitted collections without changing the input: %j", (input) => {
    expect(issueExecutionPolicySchema.safeParse(input).success).toBe(true);
    const before = structuredClone(input);
    expect(stageParticipantValues(input as IssueExecutionPolicy, "review")).toEqual([]);
    expect(stageParticipantValues(input as IssueExecutionPolicy, "approval")).toEqual([]);
    expect(input).toEqual(before);
  });

  it("retains configured reviewers when an unrelated stage omits participants", () => {
    const policy = {
      stages: [
        { type: "approval" },
        { id: STAGE_ID, type: "review", participants: [
          { id: PARTICIPANT_ID, type: "agent", agentId: AGENT_ID },
          { type: "user", userId: "board-reviewer" },
        ] },
      ],
    } as IssueExecutionPolicy;
    expect(stageParticipantValues(policy, "review")).toEqual([`agent:${AGENT_ID}`, "user:board-reviewer"]);
    expect(stageParticipantValues(policy, "approval")).toEqual([]);
  });
});

// Persisted monitor-only policies can omit fields supplied by schema defaults.
const monitorOnlyPolicy = {
  monitor: {
    nextCheckAt: "2026-10-08T16:00:00.000Z",
    notes: "Check pull request",
    scheduledBy: "assignee",
    kind: "external_service",
    serviceName: "github-pr",
    externalRef: "https://github.com/example/repo/pull/1",
    maxAttempts: 5,
  },
} as IssueExecutionPolicy;

describe("stageParticipantValues", () => {
  it.each(["review", "approval"] as const)("reads %s participants from a monitor-only policy", (stageType) => {
    expect(issueExecutionPolicySchema.safeParse(monitorOnlyPolicy).success).toBe(true);
    expect(stageParticipantValues(monitorOnlyPolicy, stageType)).toEqual([]);
  });
});

describe("buildExecutionPolicy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds review and approval stages to a monitor-only policy without losing its monitor", () => {
    const policy = buildExecutionPolicy({
      existingPolicy: monitorOnlyPolicy,
      reviewerValues: [`agent:${AGENT_ID}`],
      approverValues: ["user:local-board"],
    });

    expect(issueExecutionPolicySchema.safeParse(policy).success).toBe(true);
    expect(policy?.monitor).toEqual(monitorOnlyPolicy.monitor);
    expect(stageParticipantValues(policy, "review")).toEqual([`agent:${AGENT_ID}`]);
    expect(stageParticipantValues(policy, "approval")).toEqual(["user:local-board"]);
  });

  it("keeps a monitor-only policy when there are no review or approval stages", () => {
    expect(buildExecutionPolicy({
      existingPolicy: monitorOnlyPolicy,
      reviewerValues: [],
      approverValues: [],
    })).toEqual({
      mode: "normal",
      commentRequired: true,
      stages: [],
      monitor: monitorOnlyPolicy.monitor,
    });
  });

  it("generates schema-valid UUIDs when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index;
        }
        return bytes;
      },
    });

    const policy = buildExecutionPolicy({
      existingPolicy: null,
      stageValues: {
        review: [`agent:${AGENT_ID}`],
        approval: ["user:local-board"],
      },
    });

    expect(policy).not.toBeNull();
    expect(issueExecutionPolicySchema.safeParse(policy).success).toBe(true);
    expect(policy?.stages).toHaveLength(2);

    for (const stage of policy?.stages ?? []) {
      expect(stage.id).toMatch(UUID_PATTERN);
      expect(stage.participants).toHaveLength(1);
      expect(stage.participants[0]?.id).toMatch(UUID_PATTERN);
    }
  });

  it("emits a git stage last, after review and approval", () => {
    const policy = buildExecutionPolicy({
      existingPolicy: null,
      stageValues: {
        git: [`agent:${AGENT_ID}`],
        approval: ["user:local-board"],
        review: ["user:reviewer"],
      },
    });

    expect(issueExecutionPolicySchema.safeParse(policy).success).toBe(true);
    expect(policy?.stages.map((stage) => stage.type)).toEqual(["review", "approval", "git"]);
  });

  it("keeps stages the caller did not mention, and clears the ones it empties", () => {
    const existingPolicy = buildExecutionPolicy({
      existingPolicy: null,
      stageValues: { review: ["user:reviewer"], git: [`agent:${AGENT_ID}`] },
    });

    // A reviewers-only edit must not silently drop the git owner.
    const afterReviewEdit = buildExecutionPolicy({
      existingPolicy,
      stageValues: { review: ["user:other-reviewer"] },
    });
    expect(afterReviewEdit?.stages.map((stage) => stage.type)).toEqual(["review", "git"]);

    const afterGitCleared = buildExecutionPolicy({
      existingPolicy,
      stageValues: { git: [] },
    });
    expect(afterGitCleared?.stages.map((stage) => stage.type)).toEqual(["review"]);
  });
});

describe("isPendingExecutionParticipant", () => {
  const issueWith = (
    overrides: Partial<Issue["executionState"] & object>,
    status: Issue["status"] = "in_review",
  ) => ({
    status,
    executionState: {
      status: "pending",
      currentStageId: null,
      currentStageIndex: null,
      currentStageType: "approval",
      currentParticipant: { type: "user", userId: "user-1", agentId: null },
      returnAssignee: null,
      reviewRequest: null,
      completedStageIds: [],
      lastDecisionId: null,
      lastDecisionOutcome: null,
      ...overrides,
    },
  }) as Pick<Issue, "status" | "executionState">;

  it("is true only for the user the pending stage waits on", () => {
    expect(isPendingExecutionParticipant(issueWith({}), "user-1")).toBe(true);
    expect(isPendingExecutionParticipant(issueWith({}), "user-2")).toBe(false);
  });

  it("is false outside a pending in_review stage, or when the participant is an agent", () => {
    expect(isPendingExecutionParticipant(issueWith({}, "in_progress"), "user-1")).toBe(false);
    expect(isPendingExecutionParticipant(issueWith({ status: "changes_requested" }), "user-1")).toBe(false);
    expect(isPendingExecutionParticipant(
      issueWith({ currentParticipant: { type: "agent", agentId: AGENT_ID, userId: null } }),
      "user-1",
    )).toBe(false);
    expect(isPendingExecutionParticipant({ status: "in_review" }, "user-1")).toBe(false);
  });

  it("never matches a signed-out viewer against a null participant id", () => {
    expect(isPendingExecutionParticipant(
      issueWith({ currentParticipant: { type: "user", userId: null, agentId: null } }),
      undefined,
    )).toBe(false);
  });
});
