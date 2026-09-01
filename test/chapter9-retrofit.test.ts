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
  "chapter-09",
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

describe("Python chapter 9 Showtail retrofit", () => {
  test("commits sanitized v2 evidence and hash-only legacy provenance", () => {
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
      expect(report.sessionId).toBe(manifest.session.id);
      expect(report.turns).toHaveLength(1);
      expect(report.turns[0].prompt.text).toBe(target(exercise.id).prompt);
      expect(audit.outputs.reportSha256).toBe(sha256(reportText));
      expect(audit.outputs.sourceTreeSha256).toBe(canonicalTreeSha256(files));
      expect(reportText).not.toMatch(/(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)/);
      expect([...files.values()].every((content) => !content.includes("\r"))).toBe(
        true,
      );
    }
  });

  test("the normal v2 importer exactly regenerates all three exercises", () => {
    let initialFiles: Map<string, string> | undefined;
    let initialExerciseId: string | undefined;
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

  test("records the captured starting exercise for standalone fallback", () => {
    expect(target("py-9-01").replay?.initialState).toBeUndefined();
    expect(target("py-9-02").replay?.initialState).toEqual({
      fromExercise: "py-9-01",
    });
    expect(target("py-9-03").replay?.initialState).toEqual({
      fromExercise: "py-9-02",
    });
  });
});
