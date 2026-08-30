import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
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
  test("publishes the four authoritative checkpoint exercises", () => {
    const chapter = book.sections
      .flatMap((section) => section.chapters)
      .find((candidate) => candidate.title === manifest.chapterTitle)!;
    expect(chapter.examples.map((example) => example.id)).toEqual([
      "py-10-01",
      "py-10-02",
      "py-10-03",
      "py-10-04",
    ]);
    expect(chapter.examples.map((example) => example.title)).toEqual([
      "Design a Level Editor",
      "Centralize Level JSON Saving",
      "Add Undo and Redo",
      "Animate a Beatability Pathfinder",
    ]);
    expect(
      chapter.examples.some((example) =>
        example.prompt?.toLowerCase().includes("desert"),
      ),
    ).toBe(false);
  });

  test("records immutable evidence and the explicit Copilot legacy reconstruction", () => {
    for (const exercise of manifest.exercises) {
      const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
      const legacy = readFileSync(
        join(exerciseRoot, "legacy", "report-v1.json"),
      );
      const reportText = readFileSync(
        join(exerciseRoot, "bundle", "report.json"),
        "utf8",
      );
      const report = JSON.parse(reportText);
      const audit = JSON.parse(
        readFileSync(join(exerciseRoot, "retrofit.json"), "utf8"),
      );
      const files = sourceFiles(join(exerciseRoot, "bundle", "source"));
      expect(JSON.parse(legacy.toString("utf8")).schemaVersion ?? 1).toBe(1);
      expect(sha256(legacy)).toBe(exercise.legacyReportSha256);
      expect(report.schemaVersion).toBe(2);
      expect(report.turns).toHaveLength(1);
      expect(report.turns[0].prompt.text).toBe(target(exercise.id).prompt);
      expect(audit.outputs.reportSha256).toBe(sha256(reportText));
      expect(audit.outputs.sourceTreeSha256).toBe(canonicalTreeSha256(files));
      expect(files.has("levels/level_4.json")).toBe(false);
      expect(audit.normalizations.excludedSourcePaths).toEqual([
        "levels/level_4.json",
      ]);
    }

    const exercise = manifest.exercises.find((item) => item.id === "py-10-02")!;
    const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
    const audit = JSON.parse(
      readFileSync(join(exerciseRoot, "retrofit.json"), "utf8"),
    );
    const report = JSON.parse(
      readFileSync(join(exerciseRoot, "bundle", "report.json"), "utf8"),
    );
    expect(audit.session.integration).toBe("github-copilot");
    expect(audit.session.reconstructedFrom).toBe(
      "showtail-v1-code-changes-and-source-checkpoints",
    );
    expect(
      report.turns[0].events.filter(
        (event: { type: string; toolName?: string }) =>
          event.type === "tool_use" && event.toolName === "Edit",
      ),
    ).toHaveLength(2);
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
        response: response(step.response),
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
      ["py-10-04", "py-10-03"],
    ]);
  });

  test("retains questionless plan mode for the undo exercise", () => {
    const undo = target("py-10-03");
    expect(undo.replay?.workflow?.questions).toEqual([]);
    expect(undo.replay?.workflow?.canonicalAnswers).toEqual({});
    expect(undo.replay?.workflow?.canonicalPlan).toContain(
      "Undo/Redo for the Level Editor",
    );
  });
});
