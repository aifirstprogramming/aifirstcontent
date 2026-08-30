import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveReplay } from "../scripts/lib/import-showtail";
import { parseShowtailReport } from "../scripts/lib/showtail";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function rawV2() {
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-30T00:00:00.000Z",
    displayName: "demo-project",
    sessionId: "session-1",
    turns: [
      {
        prompt: { text: "Build the demo project" },
        aiOutputs: [],
        codeChanges: [],
        toolCalls: [],
        events: [
          {
            sequence: 0,
            type: "assistant_text",
            text: "Let me understand the design first.",
          },
          {
            sequence: 1,
            type: "tool_use",
            toolUseId: "ask-1",
            toolName: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Which gameplay?",
                  header: "Gameplay",
                  options: [
                    { label: "Top down", description: "Explore a map." },
                    {
                      label: "Platformer",
                      description: "Jump across platforms.",
                    },
                  ],
                },
                {
                  question: "Which challenge?",
                  header: "Challenge",
                  options: [
                    {
                      label: "Collect items",
                      description: "Collect every item.",
                    },
                    { label: "Avoid enemies", description: "Dodge enemies." },
                  ],
                },
                {
                  question: "Which visuals?",
                  header: "Visuals",
                  options: [
                    {
                      label: "PNG sprites",
                      description: "Load generated sprites.",
                    },
                    { label: "Shapes", description: "Draw simple shapes." },
                  ],
                },
              ],
            },
          },
          {
            sequence: 2,
            type: "tool_result",
            toolUseId: "ask-1",
            content: {
              answers: {
                Gameplay: "Top down",
                Challenge: "Collect items",
                Visuals: "PNG sprites",
              },
            },
          },
          {
            sequence: 3,
            type: "tool_use",
            toolUseId: "ask-2",
            toolName: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "How should sprites be created?",
                  header: "Assets",
                  options: [
                    {
                      label: "Generate PNG",
                      description: "Generate them locally.",
                    },
                    {
                      label: "Provide files",
                      description: "Wait for supplied files.",
                    },
                  ],
                },
              ],
            },
          },
          {
            sequence: 4,
            type: "tool_result",
            toolUseId: "ask-2",
            content: { answers: { Assets: "Generate PNG" } },
          },
          {
            sequence: 5,
            type: "tool_use",
            toolUseId: "check-pil",
            toolName: "Bash",
            input: { command: "python3 -c 'import PIL'" },
          },
          {
            sequence: 6,
            type: "tool_result",
            toolUseId: "check-pil",
            exitCode: 0,
            stdout: "",
            stderr: "",
          },
          { sequence: 7, type: "assistant_text", text: "Pillow is available." },
          {
            sequence: 8,
            type: "plan_snapshot",
            plan: "# Demo plan\n\nWrite two files and run the program.",
          },
          { sequence: 9, type: "plan_approved" },
          {
            sequence: 10,
            type: "assistant_text",
            text: "Now I will implement the approved plan.",
          },
          {
            sequence: 11,
            type: "tool_use",
            toolUseId: "write-main",
            toolName: "Write",
            input: {
              file_path: "/workspace/main.py",
              content: "from helper import value\nprint(value)\n",
            },
          },
          {
            sequence: 12,
            type: "tool_result",
            toolUseId: "write-main",
            content: "written",
          },
          {
            sequence: 13,
            type: "tool_use",
            toolUseId: "write-helper",
            toolName: "Write",
            input: {
              file_path: "/workspace/helper.py",
              content: "value = 'ok'\n",
            },
          },
          {
            sequence: 14,
            type: "tool_result",
            toolUseId: "write-helper",
            content: "written",
          },
          {
            sequence: 15,
            type: "tool_use",
            toolUseId: "run",
            toolName: "Bash",
            input: { command: "python3 main.py" },
          },
          {
            sequence: 16,
            type: "tool_result",
            toolUseId: "run",
            exitCode: 0,
            stdout: "ok\n",
            stderr: "",
          },
          {
            sequence: 17,
            type: "assistant_text",
            text: "The demo is complete and working.",
          },
          {
            sequence: 18,
            type: "plan_snapshot",
            plan: "# Implementation notes\n\nThis was not the approved plan.",
          },
        ],
      },
    ],
  };
}

describe("Showtail v2 replay derivation", () => {
  test("derives a grouped workflow, conditional follow-up, operations, and final source", () => {
    const raw = rawV2();
    const reportText = JSON.stringify(raw);
    const result = deriveReplay({
      report: parseShowtailReport(raw),
      reportText,
      turnIndex: 0,
      sourceFiles: new Map([
        ["main.py", "from helper import value\nprint(value)\n"],
        ["helper.py", "value = 'ok'\n"],
      ]),
      response: "from helper import value\nprint(value)",
      initialFiles: new Map(),
    });
    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.responsePath).toBe("main.py");
    expect(result.scaffold?.entrypoint).toBe("main.py");
    expect(result.replay?.prePlanEvents).toEqual([
      { type: "text", text: "Let me understand the design first." },
    ]);
    expect(
      result.replay?.workflow?.questions.map((question) => [
        question.id,
        question.group,
      ]),
    ).toEqual([
      ["gameplay", "group_1"],
      ["challenge", "group_1"],
      ["visuals", "group_1"],
      ["assets", undefined],
    ]);
    expect(result.replay?.workflow?.questions[3].when).toEqual({
      gameplay: "top_down",
      challenge: "collect_items",
      visuals: "png_sprites",
    });
    expect(result.replay?.workflow?.canonicalAnswers).toEqual({
      gameplay: "top_down",
      challenge: "collect_items",
      visuals: "png_sprites",
      assets: "generate_png",
    });
    expect(result.replay?.workflow?.canonicalPlan).toBe(
      "# Demo plan\n\nWrite two files and run the program.",
    );
    expect(
      result.replay?.workflow?.interludes?.[0].events.map(
        (event) => event.type,
      ),
    ).toEqual(["operation", "text"]);
    expect(result.replay?.events?.map((event) => event.type)).toEqual([
      "text",
      "operation",
      "operation",
      "operation",
    ]);
    expect(result.replay?.completionText).toBe(
      "The demo is complete and working.",
    );
    expect(
      result.replay?.operations.map((operation) => operation.type),
    ).toEqual(["write", "write", "command"]);
    expect(result.replay?.source).toMatchObject({
      kind: "showtail",
      turnIndex: 0,
      sessionId: "session-1",
    });
  });

  test("rejects legacy reports for executable content import", () => {
    const report = parseShowtailReport({
      generatedAt: "2026-08-30T00:00:00.000Z",
      displayName: "legacy",
      turns: [
        {
          prompt: { text: "Build it" },
          aiOutputs: [{ text: "Done" }],
          codeChanges: [],
          toolCalls: [],
        },
      ],
    });
    const result = deriveReplay({
      report,
      reportText: "{}",
      turnIndex: 0,
      sourceFiles: new Map([["main.py", "print('ok')\n"]]),
      response: "print('ok')",
    });
    expect(result.replay).toBeUndefined();
    expect(
      result.diagnostics
        .filter((item) => item.severity === "error")
        .map((item) => item.field),
    ).toEqual(["operations", "workflow"]);
  });

  test("fails closed when structured command results omit an exit code", () => {
    const raw = rawV2();
    const runResult = raw.turns[0].events.find(
      (event) => event.sequence === 16,
    )!;
    delete runResult.exitCode;
    const result = deriveReplay({
      report: parseShowtailReport(raw),
      reportText: JSON.stringify(raw),
      turnIndex: 0,
      sourceFiles: new Map([
        ["main.py", "from helper import value\nprint(value)\n"],
        ["helper.py", "value = 'ok'\n"],
      ]),
      response: "from helper import value\nprint(value)",
      initialFiles: new Map(),
    });
    expect(result.replay).toBeUndefined();
    expect(
      result.diagnostics.some(
        (item) =>
          item.field === "tool_result.exitCode" && item.severity === "error",
      ),
    ).toBe(true);
  });

  test("infers exit code zero from an explicitly successful shell result", () => {
    const raw = rawV2();
    const runResult = raw.turns[0].events.find(
      (event) => event.sequence === 16,
    )!;
    delete runResult.exitCode;
    Object.assign(runResult, { isError: false });
    const result = deriveReplay({
      report: parseShowtailReport(raw),
      reportText: JSON.stringify(raw),
      turnIndex: 0,
      sourceFiles: new Map([
        ["main.py", "from helper import value\nprint(value)\n"],
        ["helper.py", "value = 'ok'\n"],
      ]),
      response: "from helper import value\nprint(value)",
      initialFiles: new Map(),
    });
    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.replay?.operations.at(-1)).toMatchObject({
      type: "command",
      expectedExitCode: 0,
    });
    expect(result.diagnostics).toContainEqual({
      category: "inferred",
      severity: "info",
      field: "tool_result.exitCode",
      message: "Successful shell result implies exit code 0",
    });
  });

  test("normalizes archived Windows Python commands and volatile runtime output", () => {
    const raw = rawV2();
    for (const sequence of [11, 13]) {
      const write = raw.turns[0].events.find(
        (event) => event.sequence === sequence,
      )!;
      const input = write.input as { file_path: string };
      input.file_path = `C:\\Users\\author\\demo\\${input.file_path.split("/").at(-1)}`;
    }
    const run = raw.turns[0].events.find((event) => event.sequence === 15)!;
    run.input = {
      command: 'cd "C:\\Users\\author\\demo" && python main.py',
    };
    const result = raw.turns[0].events.find((event) => event.sequence === 16)!;
    result.stdout =
      "pygame 2.6.1 (SDL 2.28.4, Python 3.11.9)\r\n" +
      "Hello from the pygame community. https://www.pygame.org/contribute.html\r\n" +
      "C:\\Users\\author\\demo\\assets\r\n";
    const derived = deriveReplay({
      report: parseShowtailReport(raw),
      reportText: JSON.stringify(raw),
      turnIndex: 0,
      sourceFiles: new Map([
        ["main.py", "from helper import value\nprint(value)\n"],
        ["helper.py", "value = 'ok'\n"],
      ]),
      response: "from helper import value\nprint(value)",
      initialFiles: new Map(),
    });
    const command = derived.replay?.events?.find(
      (event) =>
        event.type === "operation" && event.operation.type === "command",
    );
    expect(command).toEqual({
      type: "operation",
      operation: {
        type: "command",
        command: ["bash", "-lc", 'cd "." && python3 main.py'],
        expectedExitCode: 0,
        expectedStderr: "",
      },
    });
    expect(derived.diagnostics).toContainEqual({
      category: "inferred",
      severity: "info",
      field: "tool_result.stdout",
      message:
        "Ignored environment-specific Python/pygame version output while preserving exit-code verification",
    });
  });

  test("preserves plan approval even when Claude asked no design questions", () => {
    const raw = {
      schemaVersion: 2,
      generatedAt: "2026-08-30T00:00:00.000Z",
      displayName: "plan-only",
      turns: [
        {
          prompt: { text: "Add undo support" },
          aiOutputs: [],
          codeChanges: [],
          toolCalls: [],
          events: [
            {
              sequence: 0,
              type: "tool_use",
              toolUseId: "read",
              toolName: "Read",
              input: { file_path: "/workspace/main.py" },
            },
            {
              sequence: 1,
              type: "tool_result",
              toolUseId: "read",
              content: "old",
            },
            {
              sequence: 2,
              type: "plan_snapshot",
              plan: "# Undo plan\n\nTrack snapshots before each edit.",
            },
            { sequence: 3, type: "plan_approved" },
            {
              sequence: 4,
              type: "tool_use",
              toolUseId: "write",
              toolName: "Write",
              input: { file_path: "/workspace/main.py", content: "new\n" },
            },
            {
              sequence: 5,
              type: "tool_result",
              toolUseId: "write",
              content: "written",
            },
            { sequence: 6, type: "assistant_text", text: "Undo support is ready." },
          ],
        },
      ],
    };
    const derived = deriveReplay({
      report: parseShowtailReport(raw),
      reportText: JSON.stringify(raw),
      turnIndex: 0,
      sourceFiles: new Map([["main.py", "new\n"]]),
      initialFiles: new Map([["main.py", "old\n"]]),
      response: "new",
    });
    expect(derived.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(derived.replay?.workflow).toEqual({
      questions: [],
      canonicalAnswers: {},
      canonicalPlan: "# Undo plan\n\nTrack snapshots before each edit.",
    });
    expect(derived.replay?.prePlanEvents).toEqual([
      { type: "operation", operation: { type: "read", path: "main.py" } },
    ]);
    expect(derived.replay?.completionText).toBe("Undo support is ready.");
  });
});

describe("Showtail bundle import command", () => {
  test("imports committed retrofit manifests without manuscript configuration", async () => {
    for (const [chapter, exerciseIds] of [
      ["chapter-09", ["py-9-01", "py-9-02", "py-9-03"]],
      ["chapter-10", ["py-10-01", "py-10-02", "py-10-03", "py-10-04"]],
    ] as const) {
      const proc = Bun.spawn(
        [
          process.execPath,
          "run",
          join(import.meta.dir, "..", "scripts", "import-showtail.ts"),
          "--manifest",
          join(
            import.meta.dir,
            "..",
            "replays",
            "python",
            chapter,
            "retrofit-manifest.json",
          ),
          "--format",
          "json",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      expect(proc.exitCode, stderr).toBe(0);
      const result = JSON.parse(stdout);
      expect(
        result.results.map((item: { exerciseId: string }) => item.exerciseId),
      ).toEqual(exerciseIds);
      expect(
        result.results.every((item: { changed: boolean }) => !item.changed),
      ).toBe(true);
    }
  });

  test("matches manuscript-derived prompts and writes a replayable draft", async () => {
    root = mkdtempSync(join(tmpdir(), "aifirst-showtail-import-"));
    const booksDir = join(root, "books");
    const chaptersDir = join(root, "chapters");
    const replaysDir = join(root, "replays");
    const bundle = join(replaysDir, "demo");
    const source = join(bundle, "source");
    mkdirSync(booksDir, { recursive: true });
    mkdirSync(chaptersDir, { recursive: true });
    mkdirSync(source, { recursive: true });
    const response = "print('hello')";
    writeFileSync(
      join(booksDir, "python.json"),
      JSON.stringify(
        {
          title: "Python",
          tag: "py",
          language: "python",
          sections: [
            {
              title: "Part",
              chapters: [
                {
                  title: "Chapter 1",
                  examples: [
                    {
                      id: "py-1-99",
                      title: "Imported Demo",
                      kind: "program",
                      status: "draft",
                      prompt: "Build the imported demo",
                      response,
                    },
                  ],
                },
              ],
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(source, "main.py"), `${response}\n`);
    writeFileSync(
      join(bundle, "report.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          generatedAt: "2026-08-30T00:00:00.000Z",
          displayName: "imported-demo",
          turns: [
            {
              prompt: { text: "Build the imported demo" },
              events: [
                {
                  sequence: 0,
                  type: "assistant_text",
                  text: "I will create and run the demo.",
                },
                {
                  sequence: 1,
                  type: "tool_use",
                  toolUseId: "write",
                  toolName: "Write",
                  input: {
                    file_path: "/workspace/main.py",
                    content: `${response}\n`,
                  },
                },
                {
                  sequence: 2,
                  type: "tool_result",
                  toolUseId: "write",
                  content: "written",
                },
                {
                  sequence: 3,
                  type: "tool_use",
                  toolUseId: "run",
                  toolName: "Bash",
                  input: { command: "python3 main.py" },
                },
                {
                  sequence: 4,
                  type: "tool_result",
                  toolUseId: "run",
                  exitCode: 0,
                  stdout: "hello\n",
                  stderr: "",
                },
                {
                  sequence: 5,
                  type: "assistant_text",
                  text: "The imported demo works.",
                },
              ],
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    const config = join(root, "manuscripts.json");
    writeFileSync(
      config,
      JSON.stringify({ py: { root: chaptersDir, replays: replaysDir } }) + "\n",
    );
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        join(import.meta.dir, "..", "scripts", "import-showtail.ts"),
        "--book",
        "py",
        "--write",
        "--format",
        "json",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          AIFIRST_MANUSCRIPTS: config,
          AIFIRST_BOOKS_DIR: booksDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    expect(proc.exitCode, stderr).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.results[0]).toMatchObject({
      book: "py",
      bundle: "demo",
      exerciseId: "py-1-99",
      changed: true,
    });
    const book = JSON.parse(
      readFileSync(join(booksDir, "python.json"), "utf8"),
    );
    const example = book.sections[0].chapters[0].examples[0];
    expect(example.kind).toBe("program");
    expect(example.scaffold).toEqual({
      files: [{ path: "main.py", content: `${response}\n` }],
      entrypoint: "main.py",
    });
    expect(example.replay.prompt).toBe("Build the imported demo");
    expect(
      example.replay.operations.map(
        (operation: { type: string }) => operation.type,
      ),
    ).toEqual(["write", "command"]);
    expect(example.replay.completionText).toBe("The imported demo works.");
    expect(example.replay.source.reportSha256).toMatch(/^[a-f0-9]{64}$/);

    const rerun = Bun.spawn(
      [
        process.execPath,
        "run",
        join(import.meta.dir, "..", "scripts", "import-showtail.ts"),
        "--book",
        "py",
        "--write",
        "--format",
        "json",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          AIFIRST_MANUSCRIPTS: config,
          AIFIRST_BOOKS_DIR: booksDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [rerunStdout, rerunStderr] = await Promise.all([
      new Response(rerun.stdout).text(),
      new Response(rerun.stderr).text(),
    ]);
    await rerun.exited;
    expect(rerun.exitCode, rerunStderr).toBe(0);
    expect(JSON.parse(rerunStdout).results[0].changed).toBe(false);
  });
});
