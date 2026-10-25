import type { Issue, IssueExecutionPolicy, IssueExecutionStageParticipant, IssueExecutionStagePrincipal, IssueExecutionStageType } from "@paperclipai/shared";
import { ISSUE_EXECUTION_STAGE_TYPES } from "@paperclipai/shared";
import { parseAssigneeValue } from "./assignees";

type StageType = IssueExecutionStageType;

function newId() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
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
  const stage = policy?.stages.find((candidate) => candidate.type === stageType);
  return stage?.participants.map((participant) => selectionValueFromPrincipal(participant)) ?? [];
}

function mergeParticipants(
  existing: IssueExecutionStageParticipant[] | undefined,
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
  const mode = input.existingPolicy?.mode ?? "normal";
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

  if (stages.length === 0 && !monitor) return null;

  return {
    mode,
    commentRequired: true,
    stages,
    ...(monitor ? { monitor } : {}),
  };
}
