import { createHash } from "node:crypto";
import type { ShowtailV2Event } from "./showtail";

export interface ApprovalRecoveryInput {
  turn: number;
  resultSha256: string;
}

export interface ApprovalRecoveryResult {
  events: ShowtailV2Event[];
  audit: {
    method: "exit-plan-mode-already-ended";
    turn: number;
    resultSha256: string;
  };
}

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Recover one hash-pinned approval boundary that the cumulative export omitted. */
export function recoverPlanApproval(
  events: ShowtailV2Event[],
  recovery: ApprovalRecoveryInput,
  label: string,
): ApprovalRecoveryResult {
  if (events.some((event) => event.type === "plan_approved"))
    throw new Error(`${label} already has a plan approval boundary`);

  const exits = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === "tool_use" && event.toolName?.toLowerCase() === "exitplanmode");
  if (exits.length !== 1 || !exits[0]!.event.toolUseId)
    throw new Error(`${label} approval recovery requires one ExitPlanMode tool use`);
  const exit = exits[0]!;
  const resultIndex = events.findIndex(
    (event, index) =>
      index > exit.index &&
      event.type === "tool_result" &&
      event.toolUseId === exit.event.toolUseId,
  );
  if (resultIndex < 0) throw new Error(`${label} approval recovery result is missing`);
  const result = events[resultIndex]!;
  if (
    !result.isError ||
    typeof result.content !== "string" ||
    digest(result.content) !== recovery.resultSha256
  ) throw new Error(`${label} approval recovery evidence changed`);
  if (!result.content.includes("If your plan was already approved, continue with implementation."))
    throw new Error(`${label} approval recovery result is not recognized`);
  if (!events.slice(exit.index + 1, resultIndex).some(
    (event) => event.type === "plan_snapshot" && event.plan,
  )) throw new Error(`${label} approval recovery has no plan snapshot`);
  if (!events.slice(resultIndex + 1).some(
    (event) => event.type === "tool_use" && ["write", "edit"].includes(event.toolName?.toLowerCase() ?? ""),
  )) throw new Error(`${label} approval recovery has no subsequent mutation`);

  const recovered: ShowtailV2Event = {
    sequence: result.sequence,
    type: "plan_approved",
    timestamp: result.timestamp,
  };
  return {
    events: [...events.slice(0, resultIndex + 1), recovered, ...events.slice(resultIndex + 1)],
    audit: {
      method: "exit-plan-mode-already-ended",
      turn: recovery.turn,
      resultSha256: recovery.resultSha256,
    },
  };
}
