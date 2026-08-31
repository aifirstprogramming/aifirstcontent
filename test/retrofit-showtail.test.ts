import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalizeLegacyDiffReport,
  canonicalSourceTree,
  canonicalizeExerciseReport,
  sha256,
} from "../scripts/lib/retrofit-showtail";

describe("Showtail legacy retrofit helpers", () => {
  test("scopes one prompt and removes volatile report identifiers", () => {
    const report = canonicalizeExerciseReport({
      prompt: "Build it",
      sessionId: "native-session",
      legacyReport: {
        generatedAt: "2026-08-19T00:00:00.000Z",
        displayName: "legacy",
      },
      rawReport: {
        schemaVersion: 2,
        generatedAt: "volatile",
        displayName: "volatile",
        turns: [
          {
            prompt: {
              id: "volatile-prompt-id",
              text: "Build it",
              timestamp: "2026-08-19T01:00:00.000Z",
            },
            events: [
              {
                sequence: 99,
                sourceId: "volatile-event-id",
                type: "assistant_text",
                timestamp: "2026-08-19T01:00:01.000Z",
                text: "Working",
              },
              {
                sequence: 104,
                type: "tool_result",
                toolUseId: "run",
                exitCode: 1,
                isError: true,
                content: "Exit code 1",
              },
            ],
            aiOutputs: [{ text: "Working" }],
            codeChanges: [],
            toolCalls: [],
          },
          {
            prompt: { text: "Unrelated" },
            events: [{ sequence: 0, type: "assistant_text", text: "Ignore" }],
          },
        ],
      },
    });
    expect(report).toEqual({
      schemaVersion: 2,
      generatedAt: "2026-08-19T00:00:00.000Z",
      displayName: "legacy",
      sessionId: "native-session",
      turns: [
        {
          prompt: {
            text: "Build it",
            timestamp: "2026-08-19T01:00:00.000Z",
          },
          events: [
            {
              sequence: 0,
              type: "assistant_text",
              timestamp: "2026-08-19T01:00:01.000Z",
              text: "Working",
            },
            {
              sequence: 1,
              type: "tool_result",
              toolUseId: "run",
              content: "Exit code 1",
              isError: true,
              exitCode: 1,
            },
          ],
          aiOutputs: [{ text: "Working" }],
          codeChanges: [],
          toolCalls: [],
        },
      ],
    });
  });

  test("normalizes text checkpoints while hashing the untouched tree", () => {
    const root = mkdtempSync(join(tmpdir(), "aifirst-retrofit-source-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "main.py"), "print('ok')\r\n");
    writeFileSync(join(root, "assets", "sprite.png"), Buffer.from([0, 1, 2]));
    const source = canonicalSourceTree(root, ".");
    expect(source.files).toEqual(new Map([["main.py", "print('ok')\n"]]));
    expect(source.normalizedLineEndings).toEqual(["main.py"]);
    expect(source.rawTreeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.canonicalTreeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.rawTreeSha256).not.toBe(source.canonicalTreeSha256);
  });

  test("reconstructs only v1-reported paths from authoritative checkpoints", () => {
    const report = canonicalizeLegacyDiffReport({
      exerciseId: "py-10-02",
      prompt: "Centralize saving",
      sessionId: "legacy-session",
      initialFiles: new Map([
        ["level.py", "old level\n"],
        ["editor.py", "old editor\n"],
      ]),
      sourceFiles: new Map([
        ["level.py", "new level\n"],
        ["editor.py", "new editor\n"],
      ]),
      legacyReport: {
        generatedAt: "2026-08-29T00:00:00.000Z",
        displayName: "legacy",
        turns: [
          {
            prompt: {
              text: "Centralize saving",
              timestamp: "2026-08-25T10:00:00.000Z",
            },
            aiOutputs: [
              {
                text: "Keep JSON I/O together.",
                timestamp: "2026-08-25T10:00:01.000Z",
              },
            ],
            codeChanges: [],
            toolCalls: [],
          },
          {
            prompt: {
              text: "Centralize saving",
              timestamp: "2026-08-25T10:00:02.000Z",
            },
            aiOutputs: [],
            codeChanges: [
              {
                path: "editor.py",
                timestamp: "2026-08-25T10:00:03.000Z",
              },
              {
                path: "level.py",
                timestamp: "2026-08-25T10:00:04.000Z",
              },
            ],
            toolCalls: [],
          },
        ],
      },
    });
    expect(report.sessionId).toBe("legacy-session");
    const turn = (report.turns as Array<{ events: Array<Record<string, unknown>> }>)[0];
    expect(
      turn.events
        .filter((event) => event.type === "tool_use")
        .map((event) => [event.toolName, (event.input as { file_path: string }).file_path]),
    ).toEqual([
      ["Edit", "editor.py"],
      ["Edit", "level.py"],
    ]);
    expect(turn.events.find((event) => event.type === "assistant_text")?.text).toBe(
      "Keep JSON I/O together.",
    );
  });

  test("uses stable SHA-256 digests", () => {
    expect(sha256("duckling")).toBe(
      "3c6e2b168e490cd6ce26c83646240fae04e43f3ce3f1fd278421e49cea517f7f",
    );
  });
});
