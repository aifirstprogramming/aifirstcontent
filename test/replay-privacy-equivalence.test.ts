import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { RawBook, RawExample, RawResponse } from "../src/types";
import { deriveReplay } from "../scripts/lib/import-showtail";
import { sanitizeShowtailReport } from "../scripts/lib/sanitize-showtail";
import { parseShowtailReport } from "../scripts/lib/showtail";

const root = join(import.meta.dir, "..");
const book = JSON.parse(
  readFileSync(join(root, "books", "ai-first-python-programming.json"), "utf8"),
) as RawBook;
const manifestPaths = [
  join(root, "replays", "python", "chapter-09", "retrofit-manifest.json"),
  join(root, "replays", "python", "chapter-10", "retrofit-manifest.json"),
];

function response(value: RawResponse | undefined): string {
  return Array.isArray(value) ? value.join("\n") : value ?? "";
}

function target(id: string): RawExample {
  for (const section of book.sections)
    for (const chapter of section.chapters)
      for (const example of chapter.examples)
        if (example.id === id) return example;
  throw new Error(`Missing ${id}`);
}

function sourceFiles(sourceRoot: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.set(relative(sourceRoot, path).replace(/\\/g, "/"), readFileSync(path, "utf8"));
    }
  };
  visit(sourceRoot);
  return files;
}

function normalizePrivateText(value: string): string {
  return value
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+\\savetheduckling/gi, "<workspace>")
    .replace(/\/Users\/[^/\s"'`]+\/savetheduckling/g, "<workspace>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+\\\.claude\\plans\\[^\s"'`]+/gi, "<captured-plan>")
    .replace(/\/Users\/[^/\s"'`]+\/\.claude\/plans\/[^\s"'`]+/g, "<captured-plan>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/gi, "<author-home>")
    .replace(/\/Users\/[^/\s"'`]+/g, "<author-home>")
    .replace(/\bC--Users-[A-Za-z0-9._-]+/gi, "C--Users-author")
    .replace(/(^|\n)([dl-][rwx-]{9}\s+\d+\s+)[A-Za-z0-9._-]+(\s+\d+\s+)/g, "$1$2author$3");
}

function semantic(value: unknown): unknown {
  if (typeof value === "string") return normalizePrivateText(value);
  if (Array.isArray(value)) return value.map(semantic);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "source")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, semantic(item)]),
  );
}

const expectedFingerprints: Record<string, string> = {
  "py-9-01": "7eb1ac355efe5acf18992596ca8ccc254c80de16c788625aef2706f772b70361",
  "py-9-02": "4cbffe5fac882b7d0b6e9e14e2aa816a016bb9c47fdd6a8c51abb2838a9cd5cc",
  "py-9-03": "4c1a5ed1972b34bf60dbb38c385503e6b78390bb87cfa9995d8df291622537d3",
  "py-10-01": "6f18ab5a873770607261db4ee39adf19bbf583bab90b7d92604155de8ff85882",
  "py-10-02": "9c23292d5f4b9892192a8a3c9e80caa26dc8ad53e09b0e5b4b9ed47f1d0897a0",
  "py-10-03": "1d44965c4d04de87b18006d086dfa442d401b78458360442a84a55029fe5b897",
};

function semanticFingerprint(example: RawExample): string {
  return createHash("sha256").update(JSON.stringify(semantic(example))).digest("hex");
}

describe("replay privacy sanitization", () => {
  test("preserves every learner-facing Python replay behavior", () => {
    let initialFiles: Map<string, string> | undefined;
    let initialExerciseId: string | undefined;
    for (const manifestPath of manifestPaths) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        exercises: Array<{ id: string; bundle: string; entrypoint?: string }>;
      };
      for (const exercise of manifest.exercises) {
        const example = target(exercise.id);
        const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
        const source = sourceFiles(join(exerciseRoot, "bundle", "source"));
        const rawReport = parseShowtailReport(
          JSON.parse(readFileSync(join(exerciseRoot, "bundle", "report.json"), "utf8")),
        );
        const sanitized = sanitizeShowtailReport(rawReport, [...source.keys()]);
        const reportText = `${JSON.stringify(sanitized, null, 2)}\n`;
        const derived = deriveReplay({
          report: sanitized,
          reportText,
          turnIndex: 0,
          sourceFiles: source,
          response: response(example.response),
          entrypoint: exercise.entrypoint,
          initialFiles,
          initialExerciseId,
          binaryFiles: example.scaffold?.files.filter(
            (file) => file.contentBase64 !== undefined,
          ),
        });
        expect(
          derived.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          exercise.id,
        ).toEqual([]);
        expect(semantic(derived.replay), exercise.id).toEqual(semantic(example.replay));
        expect(derived.scaffold, exercise.id).toEqual(example.scaffold);
        initialFiles = source;
        initialExerciseId = exercise.id;
      }
    }
  });

  test("matches the pre-sanitization semantic fingerprints", () => {
    for (const [id, expected] of Object.entries(expectedFingerprints))
      expect(semanticFingerprint(target(id)), id).toBe(expected);
  });
});
