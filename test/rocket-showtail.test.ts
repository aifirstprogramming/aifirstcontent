import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateRocketFixture } from "../scripts/lib/rocket-fixture";

const fixture = join(import.meta.dir, "fixtures", "rocket-showtail");

describe("rocket Showtail v2 fixture", () => {
  test("generates replayable content from only report JSON and final source", () => {
    const result = generateRocketFixture(join(fixture, "bundle"));
    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.book).toBeDefined();
    const generated = `${JSON.stringify(result.book, null, 2)}\n`;
    expect(generated).toBe(
      readFileSync(
        join(fixture, "generated", "books", "rocket-python.json"),
        "utf8",
      ),
    );

    const example = result.book!.sections![0]!.chapters![0]!.examples![0]!;
    expect(example.replay?.workflow?.questions).toHaveLength(1);
    expect(example.replay?.workflow?.canonicalAnswers).toEqual({
      telemetry_detail: "standard",
    });
    expect(example.replay?.workflow?.canonicalPlan).toContain("Rocket");
    expect(example.replay?.workflow?.interludes).toBeUndefined();
    const preflight = example.replay?.prePlanEvents?.find(
      (event) => event.type === "operation",
    );
    expect(preflight).toMatchObject({
      type: "operation",
      operation: { type: "command", command: ["bash", "-lc", "ls -la ."] },
    });
    if (
      preflight?.type === "operation" &&
      preflight.operation.type === "command"
    ) {
      expect(preflight.operation.expectedStdout).toBeUndefined();
      expect(preflight.operation.expectedStderr).toBeUndefined();
    }
    expect(
      example.replay?.operations.map((operation) => operation.type),
    ).toEqual(["write", "write", "command", "command"]);
    const commands =
      example.replay?.operations.filter(
        (operation) => operation.type === "command",
      ) ?? [];
    expect(commands[0]).toMatchObject({
      type: "command",
      expectedExitCode: 0,
      expectedStderr: "",
    });
    if (commands[0]?.type === "command")
      expect(commands[0].expectedStdout).toBeUndefined();
    expect(commands[1]).toMatchObject({
      type: "command",
      expectedExitCode: 0,
      expectedStdout: "BYTE IDENTICAL",
    });
    expect(example.replay?.completionText).toEndWith(
      "Rocket simulation complete.",
    );
    expect(example.scaffold?.files.map((file) => file.path)).toEqual([
      "rocket_sim.py",
      "test_rocket_sim.py",
    ]);
  });

  test("does not require or read the Claude oracle", () => {
    const root = mkdtempSync(join(tmpdir(), "rocket-bundle-only-"));
    try {
      cpSync(join(fixture, "bundle"), join(root, "bundle"), {
        recursive: true,
      });
      const isolated = generateRocketFixture(join(root, "bundle"));
      const committed = generateRocketFixture(join(fixture, "bundle"));
      expect(isolated.diagnostics).toEqual(committed.diagnostics);
      expect(isolated.book).toEqual(committed.book);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
