import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { recoverPlanApproval } from "../scripts/lib/approval-recovery";
import type { ShowtailV2Event } from "../scripts/lib/showtail";

const resultText =
  "<tool_use_error>You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first. " +
  "If your plan was already approved, continue with implementation.</tool_use_error>";
const resultSha256 = createHash("sha256").update(resultText).digest("hex");

function evidenceEvents(): ShowtailV2Event[] {
  return [
    { sequence: 0, type: "user_text", text: "Build it" },
    {
      sequence: 1,
      type: "tool_use",
      toolUseId: "exit-plan",
      toolName: "ExitPlanMode",
      input: { plan: "# Plan\n\nBuild it." },
    },
    { sequence: 2, type: "plan_snapshot", plan: "# Plan\n\nBuild it." },
    {
      sequence: 3,
      type: "tool_result",
      toolUseId: "exit-plan",
      isError: true,
      content: resultText,
    },
    {
      sequence: 4,
      type: "tool_use",
      toolUseId: "write",
      toolName: "Write",
      input: { file_path: "/workspace/main.java", content: "class Main {}\n" },
    },
  ];
}

describe("approval recovery", () => {
  test("inserts a hash-pinned boundary before captured mutations", () => {
    const recovered = recoverPlanApproval(
      evidenceEvents(),
      { turn: 43, resultSha256 },
      "java-12-06",
    );
    expect(recovered.events.map((event) => event.type)).toEqual([
      "user_text",
      "tool_use",
      "plan_snapshot",
      "tool_result",
      "plan_approved",
      "tool_use",
    ]);
    expect(recovered.audit).toEqual({
      method: "exit-plan-mode-already-ended",
      turn: 43,
      resultSha256,
    });
  });

  test("fails closed when evidence changes or approval already exists", () => {
    expect(() => recoverPlanApproval(
      evidenceEvents(),
      { turn: 43, resultSha256: "0".repeat(64) },
      "java-12-06",
    )).toThrow("approval recovery evidence changed");
    expect(() => recoverPlanApproval(
      [...evidenceEvents(), { sequence: 5, type: "plan_approved" }],
      { turn: 43, resultSha256 },
      "java-12-06",
    )).toThrow("already has a plan approval boundary");
  });

  test("requires a plan snapshot and a later source mutation", () => {
    expect(() => recoverPlanApproval(
      evidenceEvents().filter((event) => event.type !== "plan_snapshot"),
      { turn: 43, resultSha256 },
      "java-12-06",
    )).toThrow("has no plan snapshot");
    expect(() => recoverPlanApproval(
      evidenceEvents().slice(0, -1),
      { turn: 43, resultSha256 },
      "java-12-06",
    )).toThrow("has no subsequent mutation");
  });
});
