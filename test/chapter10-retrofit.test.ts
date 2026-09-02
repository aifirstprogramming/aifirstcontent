import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { RawBook, RawExample, RawPromptStep, RawResponse } from "../src/types";
import { deriveReplay } from "../scripts/lib/import-showtail";
import {
  canonicalTreeSha256,
  readRetrofitManifest,
  sha256,
} from "../scripts/lib/retrofit-showtail";
import { parseShowtailReport } from "../scripts/lib/showtail";

const root = join(import.meta.dir, "..");
const manifestPath = join(
  root,
  "replays",
  "python",
  "chapter-10",
  "retrofit-manifest.json",
);
const manifest = readRetrofitManifest(manifestPath);
const book = JSON.parse(
  readFileSync(join(root, manifest.bookFile), "utf8"),
) as RawBook;

function response(value: RawResponse | undefined): string {
  return Array.isArray(value) ? value.join("\n") : value ?? "";
}

function target(id: string): RawExample | RawPromptStep {
  for (const section of book.sections)
    for (const chapter of section.chapters)
      for (const parent of chapter.examples)
        for (const step of parent.prompts ?? [parent])
          if ((step.id ?? parent.id) === id) return step;
  throw new Error(`Missing ${id}`);
}

function sourceFiles(sourceRoot: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else
        files.set(
          relative(sourceRoot, path).replace(/\\/g, "/"),
          readFileSync(path, "utf8"),
        );
    }
  };
  visit(sourceRoot);
  return files;
}

function scaffoldFiles(step: RawExample | RawPromptStep): Map<string, string> {
  return new Map(
    (step.scaffold?.files ?? []).flatMap((file) =>
      file.content === undefined ? [] : [[file.path, file.content] as const],
    ),
  );
}

describe("Python chapter 10 Showtail retrofit", () => {
  test("publishes only the three guided manuscript exercises", () => {
    const chapter = book.sections
      .flatMap((section) => section.chapters)
      .find((candidate) => candidate.title === manifest.chapterTitle)!;
    expect(chapter.examples.map((example) => example.id)).toEqual([
      "py-10-01",
      "py-10-02",
      "py-10-03",
    ]);
    expect(chapter.examples.map((example) => example.title)).toEqual([
      "Design a Level Editor",
      "Add Undo and Redo",
      "Animate a Beatability Pathfinder",
    ]);
    expect(chapter.examples.map((example) => example.prompt)).toEqual([
      "Design a level editor for the savetheduckling game.",
      "Implement undo/redo for the level editor.",
      "Create a path finding algorithm for the level editor to test if a level is beatable. Make it animated.",
    ]);
    expect(
      chapter.examples.some((example) =>
        /save_level_def|desert/i.test(example.prompt ?? ""),
      ),
    ).toBe(false);
  });

  test("records sanitized evidence and keeps the JSON-saving checkpoint internal", () => {
    for (const exercise of manifest.exercises) {
      const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
      const legacyPath = join(exerciseRoot, "legacy", "report-v1.json");
      const reportText = readFileSync(
        join(exerciseRoot, "bundle", "report.json"),
        "utf8",
      );
      const report = JSON.parse(reportText);
      const audit = JSON.parse(
        readFileSync(join(exerciseRoot, "retrofit.json"), "utf8"),
      );
      const files = sourceFiles(join(exerciseRoot, "bundle", "source"));
      expect(existsSync(legacyPath)).toBe(false);
      expect(exercise.legacyReport).toBeUndefined();
      expect(audit.legacyReport).toEqual({ sha256: exercise.legacyReportSha256 });
      expect(audit.privacy.originalArtifactsCommitted).toBe(false);
      expect(report.schemaVersion).toBe(2);
      expect(report.turns).toHaveLength(1);
      expect(report.turns[0].prompt.text).toBe(target(exercise.id).prompt);
      expect(audit.outputs.reportSha256).toBe(sha256(reportText));
      expect(audit.outputs.sourceTreeSha256).toBe(canonicalTreeSha256(files));
      expect(reportText).not.toMatch(/(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)/);
      expect(files.has("levels/level_4.json")).toBe(false);
      expect(audit.normalizations.excludedSourcePaths).toEqual([
        "levels/level_4.json",
      ]);
    }

    const exercise = manifest.exercises.find((item) => item.id === "py-10-01")!;
    const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
    const audit = JSON.parse(
      readFileSync(join(exerciseRoot, "retrofit.json"), "utf8"),
    );
    const report = JSON.parse(
      readFileSync(join(exerciseRoot, "bundle", "report.json"), "utf8"),
    );
    expect(exercise.checkpointOverlay?.capture.integration).toBe("github-copilot");
    expect(audit.checkpointOverlay.attachedToExercise).toBe("py-10-01");
    expect(audit.normalizations.bookCheckpointOverlay).toEqual([
      "level_editor.py",
      "level.py",
    ]);
    expect(
      report.turns[0].events.filter(
        (event: { type: string; toolName?: string }) =>
          event.type === "tool_use" && event.toolName === "Edit",
      ),
    ).toHaveLength(9);
    expect(
      report.turns[0].events.filter(
        (event: { type: string; text?: string }) =>
          event.type === "assistant_text" &&
          event.text?.startsWith("The chapter presents JSON loading and saving"),
      ),
    ).toHaveLength(1);
    expect(scaffoldFiles(target("py-10-01")).get("level.py")).toContain(
      "def save_level_def(level_def, path):",
    );
  });

  test("the normal v2 importer exactly regenerates the complete progression", () => {
    let initialFiles = scaffoldFiles(target("py-9-03"));
    let initialExerciseId = "py-9-03";
    for (const exercise of manifest.exercises) {
      const step = target(exercise.id);
      const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
      const reportText = readFileSync(
        join(exerciseRoot, "bundle", "report.json"),
        "utf8",
      );
      const report = parseShowtailReport(JSON.parse(reportText));
      const files = sourceFiles(join(exerciseRoot, "bundle", "source"));
      const derived = deriveReplay({
        report,
        reportText,
        turnIndex: 0,
        sourceFiles: files,
        initialFiles,
        initialExerciseId,
        binaryFiles: step.scaffold?.files.filter((file) => file.contentBase64 !== undefined),
        response: response(step.response),
        entrypoint: exercise.entrypoint,
      });
      expect(
        derived.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      ).toEqual([]);
      expect(derived.replay).toEqual(step.replay);
      expect(derived.scaffold).toEqual(step.scaffold);
      initialFiles = files;
      initialExerciseId = exercise.id;
    }
  });

  test("links every captured replay to its preceding project state", () => {
    expect(
      manifest.exercises.map((exercise) => [
        exercise.id,
        target(exercise.id).replay?.initialState?.fromExercise,
      ]),
    ).toEqual([
      ["py-10-01", "py-9-03"],
      ["py-10-02", "py-10-01"],
      ["py-10-03", "py-10-02"],
    ]);
  });

  test("embeds the tracked duckling PNGs in every project scaffold", () => {
    const assetRoot = join(root, "assets", "python", "save-the-duckling");
    const names = readdirSync(assetRoot).filter((name) => name.endsWith(".png")).sort();
    for (const id of ["py-9-01", "py-9-02", "py-9-03", "py-10-01", "py-10-02", "py-10-03"]) {
      const embedded = (target(id).scaffold?.files ?? [])
        .filter((file) => file.contentBase64 !== undefined)
        .sort((left, right) => left.path.localeCompare(right.path));
      expect(embedded.map((file) => file.path)).toEqual(names.map((name) => `assets/${name}`));
      for (const file of embedded) {
        expect(Buffer.from(file.contentBase64!, "base64")).toEqual(
          readFileSync(join(assetRoot, file.path.replace(/^assets\//, ""))),
        );
      }
    }
  });

  test("retains questionless plan mode for the undo exercise", () => {
    const undo = target("py-10-02");
    expect(undo.replay?.workflow?.questions).toEqual([]);
    expect(undo.replay?.workflow?.canonicalAnswers).toEqual({});
    expect(undo.replay?.workflow?.canonicalPlan).toContain(
      "Undo/Redo for the Level Editor",
    );
  });

  test("runs every chapter 10 exercise through the level editor", () => {
    for (const id of ["py-10-01", "py-10-02", "py-10-03"])
      expect(target(id).scaffold?.entrypoint).toBe("level_editor.py");
  });
});
