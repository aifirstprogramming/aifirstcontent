#!/usr/bin/env bun
/** Rebuild deterministic Showtail v2 bundles from archived native transcripts. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { RawBook, RawExample, RawPromptStep } from "../src/types";
import {
  canonicalizeLegacyDiffReport,
  canonicalizeExerciseReport,
  canonicalSourceTree,
  readRetrofitManifest,
  resolveArchiveInput,
  resolveArchiveInputBySha256,
  sha256,
  stableJson,
  type RetrofitExerciseInput,
} from "./lib/retrofit-showtail";
import { sanitizeShowtailReport } from "./lib/sanitize-showtail";
import { parseShowtailReport } from "./lib/showtail";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const manifestPath = resolve(
  value("--manifest") ??
    join(ROOT, "replays", "python", "chapter-09", "retrofit-manifest.json"),
);
const archiveInput =
  value("--archive") ?? process.env.AIFIRST_SHOWTAIL_ARCHIVE;
const write = args.includes("--write");
const jsonOutput =
  args.includes("--format") && value("--format") === "json";
const showtailCommand = value("--showtail") ?? "showtail";

if (!archiveInput)
  throw new Error(
    "Provide the authoritative archive with --archive or AIFIRST_SHOWTAIL_ARCHIVE",
  );
const archiveRoot = resolve(archiveInput);
if (!existsSync(archiveRoot))
  throw new Error(`Authoritative archive does not exist: ${archiveRoot}`);

const manifest = readRetrofitManifest(manifestPath);
const bookPath = resolve(ROOT, manifest.bookFile);
const book = JSON.parse(readFileSync(bookPath, "utf8")) as RawBook;

interface Target {
  parent: RawExample;
  step: RawExample | RawPromptStep;
}

function target(id: string): Target | undefined {
  for (const section of book.sections ?? [])
    for (const chapter of section.chapters ?? [])
      for (const parent of chapter.examples ?? [])
        for (const step of parent.prompts ?? [parent])
          if ((step.id ?? parent.id) === id) return { parent, step };
  return undefined;
}

function chapterForNewExamples() {
  if (!manifest.chapterTitle)
    throw new Error(
      `Book ${manifest.book} has missing exercises but manifest.chapterTitle is not set`,
    );
  for (const section of book.sections ?? [])
    for (const chapter of section.chapters ?? [])
      if (chapter.title === manifest.chapterTitle) return chapter;
  throw new Error(`Book ${manifest.book} has no chapter ${manifest.chapterTitle}`);
}

function withoutFinalNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

async function run(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd: commandRoot,
    env: commandEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0)
    throw new Error(
      `${command.join(" ")} failed with exit ${proc.exitCode}\n${stderr || stdout}`,
    );
  return stdout;
}

function verifyHash(path: string, expected: string, label: string): Buffer {
  const content = readFileSync(path);
  const actual = sha256(content);
  if (actual !== expected)
    throw new Error(`${label} hash mismatch: expected ${expected}, found ${actual}`);
  return content;
}

function textFiles(files: Map<string, string>): Array<{ path: string; content: string }> {
  return [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, content }));
}

function existingFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) out.push(relative(root, path).replace(/\\/g, "/"));
    }
  };
  visit(root);
  return out.sort((left, right) => left.localeCompare(right));
}

function outputPaths(exercise: RetrofitExerciseInput) {
  const root = resolve(dirname(manifestPath), exercise.bundle);
  const manifestRoot = resolve(dirname(manifestPath));
  if (root !== manifestRoot && !root.startsWith(`${manifestRoot}/`))
    throw new Error(`Bundle path escapes the manifest directory: ${exercise.bundle}`);
  return {
    root,
    bundle: join(root, "bundle"),
    report: join(root, "bundle", "report.json"),
    source: join(root, "bundle", "source"),
    audit: join(root, "retrofit.json"),
  };
}

const temp = mkdtempSync(join(tmpdir(), "aifirst-showtail-retrofit-"));
const commandRoot = join(temp, "workspace");
const home = join(temp, "home");
mkdirSync(commandRoot, { recursive: true });
mkdirSync(home, { recursive: true });
const commandEnv = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  SHOWTAIL_IDENTITY_EMAIL: "retrofit@aifirst.local",
  SHOWTAIL_IDENTITY_NAME: "AI First Retrofit",
};

try {
  const version = (await run([showtailCommand, "--version"])).trim();
  if (version !== manifest.showtailVersion)
    throw new Error(
      `Expected Showtail ${manifest.showtailVersion}, found ${version}`,
    );
  const transcriptPath = resolveArchiveInput(
    archiveRoot,
    manifest.session.transcript,
  );
  verifyHash(transcriptPath, manifest.session.sha256, "Native transcript");

  await run([
    showtailCommand,
    "track",
    commandRoot,
    "--project",
    manifest.projectName,
    "--json",
  ]);
  await run([
    showtailCommand,
    "import",
    manifest.session.integration,
    "--file",
    transcriptPath,
  ]);
  const reportResult = JSON.parse(
    await run([
      showtailCommand,
      "report",
      "--format",
      "json",
      "--no-open",
      "--no-sync",
      "--json",
    ]),
  ) as { reportPath?: string };
  if (!reportResult.reportPath)
    throw new Error("Showtail did not return a JSON report path");
  const rawReport = JSON.parse(readFileSync(reportResult.reportPath, "utf8"));

  let bookChanged = false;
  const generated = manifest.exercises.map((exercise) => {
    const source = canonicalSourceTree(
      archiveRoot,
      exercise.sourceCheckpoint,
      exercise.sourceExcludes,
    );
    let found = target(exercise.id);
    if (!found) {
      if (
        !exercise.title ||
        !exercise.prompt ||
        !exercise.responsePath
      )
        throw new Error(
          `${exercise.id} is missing from the book and needs title, prompt, and responsePath in the retrofit manifest`,
        );
      const response = source.files.get(exercise.responsePath);
      if (response === undefined)
        throw new Error(
          `${exercise.id} responsePath is not in the source checkpoint: ${exercise.responsePath}`,
        );
      const created: RawExample = {
        id: exercise.id,
        title: exercise.title,
        ...(exercise.description ? { description: exercise.description } : {}),
        kind: "project",
        prompt: exercise.prompt,
        response: withoutFinalNewline(response),
        ...(exercise.stdin !== undefined ? { stdin: exercise.stdin } : {}),
        ...(exercise.explanation
          ? { explanation: exercise.explanation }
          : {}),
      };
      chapterForNewExamples().examples.push(created);
      found = { parent: created, step: created };
      bookChanged = true;
    }
    const { step } = found;
    if (exercise.stdin !== undefined && step.stdin !== exercise.stdin) {
      step.stdin = exercise.stdin;
      bookChanged = true;
    }
    if (
      exercise.explanation &&
      JSON.stringify(step.explanation) !== JSON.stringify(exercise.explanation)
    ) {
      step.explanation = exercise.explanation;
      bookChanged = true;
    }
    const prompt = step.prompt ?? exercise.prompt ?? "";
    if (sha256(prompt) !== exercise.promptSha256)
      throw new Error(`${exercise.id} prompt hash no longer matches the manifest`);
    const legacyPath = exercise.legacyReport
      ? resolveArchiveInput(archiveRoot, exercise.legacyReport)
      : resolveArchiveInputBySha256(
          archiveRoot,
          exercise.legacyReportSha256,
        );
    const legacyBuffer = verifyHash(
      legacyPath,
      exercise.legacyReportSha256,
      `${exercise.id} legacy report`,
    );
    const legacyReport = JSON.parse(legacyBuffer.toString("utf8"));
    if (source.rawTreeSha256 !== exercise.sourceTreeSha256)
      throw new Error(
        `${exercise.id} source checkpoint hash mismatch: expected ${exercise.sourceTreeSha256}, found ${source.rawTreeSha256}`,
      );
    const capture = exercise.capture ?? { mode: "native" as const };
    let initialSource:
      | ReturnType<typeof canonicalSourceTree>
      | undefined;
    const report =
      capture.mode === "legacy-diff"
        ? (() => {
            initialSource = canonicalSourceTree(
              archiveRoot,
              capture.initialCheckpoint,
              exercise.sourceExcludes,
            );
            if (initialSource.rawTreeSha256 !== capture.initialTreeSha256)
              throw new Error(
                `${exercise.id} initial checkpoint hash mismatch: expected ${capture.initialTreeSha256}, found ${initialSource.rawTreeSha256}`,
              );
            return canonicalizeLegacyDiffReport({
              legacyReport,
              prompt,
              sessionId: `legacy-${exercise.legacyReportSha256.slice(0, 12)}-${exercise.id}`,
              exerciseId: exercise.id,
              initialFiles: initialSource.files,
              sourceFiles: source.files,
            });
          })()
        : canonicalizeExerciseReport({
            rawReport,
            legacyReport,
            prompt,
            sessionId: manifest.session.id,
          });
    const turn = (report.turns as Array<Record<string, unknown>>)[0]!;
    const events = turn.events as Array<Record<string, unknown>>;
    for (const plan of exercise.plans ?? []) {
      const path = resolveArchiveInput(archiveRoot, plan.path);
      const content = verifyHash(path, plan.sha256, `${exercise.id} plan`)
        .toString("utf8")
        .replace(/\r\n/g, "\n")
        .replace(/\n$/, "");
      const snapshot = events.find(
        (event) => event.type === "plan_snapshot" && event.plan === content,
      );
      if (!snapshot || snapshot.plan !== content)
        throw new Error(
          `${exercise.id} archived plan does not match the native transcript`,
        );
    }
    const reportText = stableJson(
      sanitizeShowtailReport(
        parseShowtailReport(report),
        [...source.files.keys()],
      ),
    );
    const sourceFiles = textFiles(source.files);
    const audit = {
      version: 1,
      exerciseId: exercise.id,
      retrofitDate: manifest.retrofitDate,
      showtailVersion: version,
      session: {
        integration:
          capture.mode === "legacy-diff"
            ? capture.integration
            : manifest.session.integration,
        id:
          capture.mode === "legacy-diff"
            ? `legacy-${exercise.legacyReportSha256.slice(0, 12)}-${exercise.id}`
            : manifest.session.id,
        ...(capture.mode === "native"
          ? {
              sha256: manifest.session.sha256,
            }
          : {
              reconstructedFrom: "showtail-v1-code-changes-and-source-checkpoints",
              initialCheckpoint: capture.initialCheckpoint,
              initialTreeSha256: capture.initialTreeSha256,
              initialCanonicalTreeSha256:
                initialSource!.canonicalTreeSha256,
            }),
      },
      promptSha256: exercise.promptSha256,
      legacyReport: {
        sha256: exercise.legacyReportSha256,
      },
      sourceCheckpoint: {
        rawTreeSha256: source.rawTreeSha256,
        canonicalTreeSha256: source.canonicalTreeSha256,
      },
      plans: (exercise.plans ?? []).map(({ path: _path, ...plan }) => plan),
      normalizations: {
        scopedToCanonicalPrompt: true,
        eventSequencesRenumbered: true,
        generatedAtPreservedFromV1: true,
        lineEndings: source.normalizedLineEndings,
        excludedSourcePaths: source.excludedPaths,
        excludedGeneratedAssets: true,
      },
      outputs: {
        reportSha256: sha256(reportText),
        sourceTreeSha256: source.canonicalTreeSha256,
      },
    };
    return {
      exercise,
      paths: outputPaths(exercise),
      reportText,
      sourceFiles,
      auditText: stableJson(audit),
    };
  });

  const results = generated.map((item) => {
    const current = (path: string): Buffer | undefined =>
      existsSync(path) ? readFileSync(path) : undefined;
    const changed =
      current(item.paths.report)?.toString("utf8") !== item.reportText ||
      current(item.paths.audit)?.toString("utf8") !== item.auditText ||
      item.sourceFiles.some(
        (file) =>
          current(join(item.paths.source, file.path))?.toString("utf8") !==
          file.content,
      ) ||
      existingFiles(item.paths.source).join("\0") !==
        item.sourceFiles.map((file) => file.path).join("\0");
    if (write && changed) {
      mkdirSync(item.paths.bundle, { recursive: true });
      rmSync(item.paths.source, { recursive: true, force: true });
      mkdirSync(item.paths.source, { recursive: true });
      writeFileSync(item.paths.report, item.reportText);
      for (const file of item.sourceFiles) {
        const path = join(item.paths.source, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content);
      }
      writeFileSync(item.paths.audit, item.auditText);
    }
    return {
      exerciseId: item.exercise.id,
      bundle: item.paths.bundle,
      changed,
      written: write && changed,
    };
  });

  if (write && bookChanged)
    writeFileSync(bookPath, `${JSON.stringify(book, null, 2)}\n`);

  if (jsonOutput)
    console.log(JSON.stringify({ write, bookChanged, results }, null, 2));
  else
    for (const result of results)
      console.log(
        `${result.written ? "WROTE" : result.changed ? "CHANGE" : "OK"} ${result.exerciseId} -> ${result.bundle}`,
      );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
