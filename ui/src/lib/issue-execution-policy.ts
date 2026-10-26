import type { Issue, IssueExecutionPolicy, IssueExecutionStageParticipant, IssueExecutionStagePrincipal, IssueExecutionStageType } from "@paperclipai/shared";
import { ISSUE_EXECUTION_STAGE_TYPES, issueExecutionPolicySchema } from "@paperclipai/shared";
import { parseAssigneeValue } from "./assignees";
import { createUuid as newId } from "./uuid";

type StageType = IssueExecutionStageType;
const nullablePolicySchema = issueExecutionPolicySchema.nullable();

/** Apply wire-format defaults without treating an invalid policy as no policy. */
export function readExecutionPolicy(policy: unknown) {
  return nullablePolicySchema.safeParse(policy ?? null);
}

/** Stage name as the board says it: "Review pending with …", "Run git now". */
export const EXECUTION_STAGE_LABEL: Record<StageType, string> = {
  review: "Review",
  approval: "Approval",
  git: "Git",
};

/** Participant-slot name: the picker row label and its "No …"/"Search …" copy. */
export const EXECUTION_STAGE_PARTICIPANT_LABEL: Record<StageType, string> = {
  review: "Reviewers",
  approval: "Approvers",
  git: "Git owners",
};

function principalKey(principal: IssueExecutionStagePrincipal | IssueExecutionStageParticipant) {
  return principal.type === "agent" ? `agent:${principal.agentId}` : `user:${principal.userId}`;
}

export function principalFromSelectionValue(value: string): IssueExecutionStagePrincipal | null {
  const selection = parseAssigneeValue(value);
  if (selection.assigneeAgentId) {
    return { type: "agent", agentId: selection.assigneeAgentId, userId: null };
  }
  if (selection.assigneeUserId) {
    return { type: "user", userId: selection.assigneeUserId, agentId: null };
  }
  return null;
}

export function selectionValueFromPrincipal(principal: IssueExecutionStagePrincipal | IssueExecutionStageParticipant): string {
  return principal.type === "agent" ? `agent:${principal.agentId}` : `user:${principal.userId}`;
}

/**
 * LOC-124: true when `userId` is the signed-in board user the current execution
 * stage is waiting on, so the UI can offer verdict controls instead of leaving
 * them to guess the magic approval comment.
 */
export function isPendingExecutionParticipant(
  issue: Pick<Issue, "status" | "executionState">,
  userId: string | null | undefined,
): boolean {
  const participant = issue.executionState?.currentParticipant;
  return Boolean(
    userId &&
    issue.status === "in_review" &&
    issue.executionState?.status === "pending" &&
    participant?.type === "user" &&
    participant.userId === userId,
  );
}

export function stageParticipantValues(policy: IssueExecutionPolicy | null | undefined, stageType: StageType): string[] {
  const parsed = readExecutionPolicy(policy);
  if (!parsed.success) return [];
  const stage = parsed.data?.stages.find((candidate) => candidate.type === stageType);
  return stage?.participants.map((participant) => selectionValueFromPrincipal(participant)) ?? [];
}

function mergeParticipants(
  existing: Array<IssueExecutionStagePrincipal & { id?: string }> | undefined,
  values: string[],
): IssueExecutionStageParticipant[] {
  const existingByKey = new Map((existing ?? []).map((participant) => [principalKey(participant), participant]));
  const participants: IssueExecutionStageParticipant[] = [];
  for (const value of values) {
    const principal = principalFromSelectionValue(value);
    if (!principal) continue;
    const key = principalKey(principal);
    const previous = existingByKey.get(key);
    participants.push({
      id: previous?.id ?? newId(),
      type: principal.type,
      agentId: principal.type === "agent" ? principal.agentId ?? null : null,
      userId: principal.type === "user" ? principal.userId ?? null : null,
    });
  }
  return participants;
}

/**
 * Rebuild the policy from the picker selections. Stages are emitted in
 * `ISSUE_EXECUTION_STAGE_TYPES` order, which is the order the engine runs them.
 *
 * A stage type absent from `stageValues` keeps whatever the existing policy had —
 * only an explicit empty array clears it. That way a caller that predates a stage
 * type cannot silently delete it by rebuilding the policy without it.
 */
export function buildExecutionPolicy(input: {
  existingPolicy?: IssueExecutionPolicy | null;
  stageValues: Partial<Record<StageType, string[]>>;
}): IssueExecutionPolicy | null {
  const parsed = readExecutionPolicy(input.existingPolicy);
  if (!parsed.success) throw new Error("Execution policy is unavailable");
  const existingPolicy = parsed.data;
  const mode = existingPolicy?.mode ?? "normal";
  const stages: IssueExecutionPolicy["stages"] = [];
  const monitor = input.existingPolicy?.monitor ?? null;

  for (const stageType of ISSUE_EXECUTION_STAGE_TYPES) {
    const existingStage = input.existingPolicy?.stages.find((stage) => stage.type === stageType);
    const values = input.stageValues[stageType] ?? stageParticipantValues(input.existingPolicy, stageType);
    const participants = mergeParticipants(existingStage?.participants, values);
    if (participants.length === 0) continue;
    stages.push({
      id: existingStage?.id ?? newId(),
      type: stageType,
      approvalsNeeded: 1 as const,
      participants,
    });
  }

  if (stages.length === 0 && !monitor && !existingPolicy?.authorizationPolicy
    && !existingPolicy?.reviewPreset && existingPolicy?.maxReviewRounds == null) return null;

  return {
    ...input.existingPolicy,
    mode,
    commentRequired: true,
    stages,
    ...(monitor ? { monitor } : {}),
  };
}
