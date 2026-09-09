import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { RawBook, RawExample, RawResponse } from "../src/types";
import {
  deriveReplay,
  responseExcerptMatches,
  responseExcerptWithElisionsMatches,
  type ResponseMatch,
} from "../scripts/lib/import-showtail";
import { canonicalTreeSha256, sha256 } from "../scripts/lib/retrofit-showtail";
import { parseShowtailReport } from "../scripts/lib/showtail";

const root = join(import.meta.dir, "..");
const manifestPath = join(root, "replays", "java", "pocketcfo", "retrofit-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  bookFile: string;
  chapters: Array<{
    number: number;
    title: string;
    exercises: Array<{
      id: string;
      title: string;
      promptSha256: string;
      responseSha256: string;
      responsePath: string;
      responseMatch: ResponseMatch;
      responseElisions?: string[];
      bundle: string;
      segments: Array<{ turn: number; mode: string }>;
    }>;
  }>;
};
const exercises = manifest.chapters.flatMap((chapter) => chapter.exercises);
const book = JSON.parse(readFileSync(join(root, manifest.bookFile), "utf8")) as RawBook;

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

function scaffoldFiles(example: RawExample): Map<string, string> {
  return new Map(
    (example.scaffold?.files ?? []).flatMap((file) =>
      file.content === undefined ? [] : [[file.path, file.content] as const],
    ),
  );
}

describe("PocketCFO Java chapter retrofit", () => {
  test("publishes the eight manuscript exercises in chapter order", () => {
    expect(exercises.map((exercise) => exercise.id)).toEqual([
      "java-11-01",
      "java-11-02",
      "java-12-01",
      "java-12-02",
      "java-12-03",
      "java-12-04",
      "java-12-05",
      "java-12-06",
    ]);
    for (const chapterInput of manifest.chapters) {
      const chapter = book.sections
        .flatMap((section) => section.chapters)
        .find((candidate) => candidate.title === chapterInput.title)!;
      expect(chapter.examples.map((example) => example.id)).toEqual(
        chapterInput.exercises.map((exercise) => exercise.id),
      );
      expect(chapter.examples.every((example) => example.kind === "project")).toBe(true);
      expect(chapter.examples.every((example) => example.status === undefined)).toBe(true);
    }
  });

  test("keeps manuscript prompts and printed excerpts immutable", () => {
    for (const exercise of exercises) {
      const example = target(exercise.id);
      const source = scaffoldFiles(example).get(exercise.responsePath);
      expect(sha256(example.prompt ?? ""), exercise.id).toBe(exercise.promptSha256);
      expect(sha256(response(example.response)), exercise.id).toBe(exercise.responseSha256);
      expect(source, `${exercise.id} response source`).toBeDefined();
      const matches = exercise.responseMatch === "excerpt-with-elisions"
        ? responseExcerptWithElisionsMatches(
            response(example.response),
            source!,
            exercise.responseElisions ?? [],
          )
        : responseExcerptMatches(response(example.response), source!);
      expect(matches, exercise.id).toBe(true);
    }
  });

  test("regenerates every replay and scaffold from the sanitized bundles", () => {
    let initialFiles: Map<string, string> | undefined;
    let initialExerciseId: string | undefined;
    for (const exercise of exercises) {
      const example = target(exercise.id);
      const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
      const reportText = readFileSync(join(exerciseRoot, "bundle", "report.json"), "utf8");
      const report = parseShowtailReport(JSON.parse(reportText));
      const files = sourceFiles(join(exerciseRoot, "bundle", "source"));
      const derived = deriveReplay({
        report,
        reportText,
        turnIndex: 0,
        sourceFiles: files,
        response: response(example.response),
        responsePath: exercise.responsePath,
        responseMatch: exercise.responseMatch,
        responseElisions: exercise.responseElisions,
        initialFiles,
        initialExerciseId,
      });
      expect(
        derived.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        exercise.id,
      ).toEqual([]);
      expect(derived.replay, exercise.id).toEqual(example.replay);
      expect(derived.scaffold, exercise.id).toEqual(example.scaffold);
      initialFiles = files;
      initialExerciseId = exercise.id;
    }
  });

  test("links every progressive project to the preceding checkpoint", () => {
    expect(exercises.map((exercise) => [
      exercise.id,
      target(exercise.id).replay?.initialState?.fromExercise ?? null,
    ])).toEqual([
      ["java-11-01", null],
      ["java-11-02", "java-11-01"],
      ["java-12-01", "java-11-02"],
      ["java-12-02", "java-12-01"],
      ["java-12-03", "java-12-02"],
      ["java-12-04", "java-12-03"],
      ["java-12-05", "java-12-04"],
      ["java-12-06", "java-12-05"],
    ]);
  });

  test("records deterministic derivative evidence without private source artifacts", () => {
    const forbidden = /\/Users\/|[A-Za-z]:\\Users\\|\/home\/[A-Za-z0-9._-]+|\b(?:Nextcloud|OneDrive|Dropbox)\b|-at-[a-z0-9.-]+-com\b|claude-logs/i;
    expect(readFileSync(manifestPath, "utf8")).not.toMatch(forbidden);
    expect(
      JSON.stringify(exercises.map((exercise) => target(exercise.id))),
    ).not.toMatch(forbidden);
    for (const exercise of exercises) {
      const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
      const reportText = readFileSync(join(exerciseRoot, "bundle", "report.json"), "utf8");
      const auditText = readFileSync(join(exerciseRoot, "retrofit.json"), "utf8");
      const audit = JSON.parse(auditText);
      const files = sourceFiles(join(exerciseRoot, "bundle", "source"));
      expect(reportText, exercise.id).not.toMatch(forbidden);
      expect(auditText, exercise.id).not.toMatch(forbidden);
      expect(audit.privacy.originalArtifactsCommitted).toBe(false);
      expect(audit.outputs.reportSha256).toBe(sha256(reportText));
      expect(audit.outputs.sourceTreeSha256).toBe(canonicalTreeSha256(files));
    }
  });

  test("uses the final numeric-priority plan and audits the uncaptured CSV correction", () => {
    const priorityExercise = exercises.find((exercise) => exercise.id === "java-12-04")!;
    expect(priorityExercise.segments.map((segment) => segment.turn)).toEqual([
      29, 30, 32, 33, 34, 36, 38, 39, 40,
    ]);
    expect(priorityExercise.segments.some((segment) => segment.turn === 27 || segment.turn === 28)).toBe(false);
    const example = target("java-12-04");
    expect(example.replay?.workflow?.canonicalPlan).toContain(
      "Numeric category priority + spend-rank comparison",
    );
    const audit = JSON.parse(
      readFileSync(
        join(dirname(manifestPath), priorityExercise.bundle, "retrofit.json"),
        "utf8",
      ),
    );
    expect(audit.corrections).toEqual([
      {
        path: "sample-data/sample-transactions.csv",
        beforeSha256: "435ce49dccacac0bfd38a4e7ee545301da88ba4e561e49a1d0a75bc01099d362",
        afterSha256: "679d117da68e8286653b934bd85cd32bfd2ad965900130c6dd057a9b870a270e",
      },
    ]);
    expect(audit.outputs.sourceTreeSha256).toBe(
      "fc5e55bb2a56a80e873edfcbe12ee57a6f8b4aae0efb94f12826a683f8eb6000",
    );
  });

  test("recovers the reallocation approval and verifies the new final checkpoint", () => {
    const finalExercise = exercises.at(-1)!;
    expect(finalExercise.id).toBe("java-12-06");
    expect(finalExercise.segments.map((segment) => segment.turn)).toEqual([43, 45, 47, 49]);
    const example = target(finalExercise.id);
    expect(example.replay?.workflow?.canonicalPlan).toContain(
      "Reallocation preview: category cut",
    );
    const audit = JSON.parse(
      readFileSync(
        join(dirname(manifestPath), finalExercise.bundle, "retrofit.json"),
        "utf8",
      ),
    );
    expect(audit.source.approvalRecovery).toEqual({
      method: "exit-plan-mode-already-ended",
      turn: 43,
      resultSha256: "248f9072b6f6cc23977a2c7d35574811aaf9bc288391225097c7e0d4b181c77f",
    });
    expect(audit.checkpoint.canonicalTreeSha256).toBe(
      "6ae40356315c8b02bfcb802abbd771a757661b2972a8c1338cf0516f25af9ee0",
    );
    expect(audit.corrections).toEqual([
      {
        path: "sample-data/sample-transactions-sep.csv",
        afterSha256: "a2a4492c569d3449d12df0d705871cd313323f52b658300a4753947196fd0855",
      },
    ]);
  });

  test("normalizes contribution dates so every historical checkpoint remains testable", () => {
    for (const exercise of exercises) {
      const exerciseRoot = join(dirname(manifestPath), exercise.bundle);
      const service = readFileSync(
        join(
          exerciseRoot,
          "bundle",
          "source",
          "src/main/java/com/example/finance/SavingsGoalService.java",
        ),
        "utf8",
      );
      const audit = JSON.parse(readFileSync(join(exerciseRoot, "retrofit.json"), "utf8"));
      expect(service, exercise.id).toContain(
        "goalContributionRepository.add(dateWithinMonth(month), goalName, amount);",
      );
      expect(service, exercise.id).toContain("private LocalDate dateWithinMonth(YearMonth month)");
      expect(service, exercise.id).not.toContain(
        "goalContributionRepository.add(LocalDate.now(), goalName, amount);",
      );
      expect(audit.normalizations.length, exercise.id).toBeGreaterThan(0);
    }
  });
});
