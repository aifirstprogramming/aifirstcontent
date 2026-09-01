#!/usr/bin/env bun
/** Rebuild sanitized exercise bundles from a local Showtail v2 archive. */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { Explanation, RawBook, RawExample, RawResponse } from "../src/types";
import { reorder } from "./lib/apply";
import { readParagraphs } from "./lib/docx";
import { deriveReplay } from "./lib/import-showtail";
import type { MinedExample } from "./lib/mine";
import {
  EXCLUDED_SOURCE_DIRS,
  EXCLUDED_SOURCE_FILES,
  canonicalTreeSha256,
  sha256,
  stableJson,
} from "./lib/retrofit-showtail";
import {
  parseShowtailReport,
  type ShowtailReport,
  type ShowtailV2Event,
} from "./lib/showtail";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const manifestPath = resolve(
  value("--manifest") ??
    join(ROOT, "replays", "java", "pocketcfo", "retrofit-manifest.json"),
);
const archivePath = value("--archive");
const chapter11Path = value("--chapter11");
const chapter12Path = value("--chapter12");
const write = args.includes("--write");
const jsonOutput = value("--format") === "json";

if (!archivePath || !chapter11Path || !chapter12Path) {
  throw new Error(
    "Provide --archive, --chapter11, and --chapter12; source artifacts remain local and are never copied into the repository",
  );
}

type SegmentMode = "full" | "post-approval";

interface SegmentInput {
  turn: number;
  mode: SegmentMode;
}

interface CheckpointInput {
  label: string;
  archivePrefix: string;
  canonicalTreeSha256: string;
  correctionPaths?: string[];
}

interface ExerciseInput {
  id: string;
  title: string;
  description: string;
  promptSha256: string;
  responseSha256: string;
  responsePath: string;
  responseMatch: "exact" | "excerpt";
  primaryTurn: number;
  segments: SegmentInput[];
  checkpoint?: CheckpointInput;
  bundle: string;
  explanation: Explanation;
}

interface ChapterInput {
  number: number;
  title: string;
  goal: string;
  manuscript: "chapter11" | "chapter12";
  exercises: ExerciseInput[];
}

interface NormalizationInput {
  id: string;
  path: string;
  optional?: boolean;
  skipIfContains?: string;
  oldText: string;
  newText: string;
}

interface Manifest {
  version: 1;
  book: "java";
  bookFile: string;
  retrofitDate: string;
  reportSha256: string;
  normalizations?: NormalizationInput[];
  chapters: ChapterInput[];
}

function manifest(): Manifest {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (parsed.version !== 1 || parsed.book !== "java")
    throw new Error("Unsupported v2 archive retrofit manifest");
  return parsed;
}

function rawResponse(response: string): RawResponse {
  const lines = response.split("\n");
  return lines.length > 1 ? lines : response;
}

function archiveFiles(path: string): Record<string, Uint8Array> {
  if (!existsSync(path)) throw new Error(`Archive does not exist: ${path}`);
  return unzipSync(new Uint8Array(readFileSync(path)));
}

function reportFromArchive(
  files: Record<string, Uint8Array>,
  expectedSha256: string,
): { report: ShowtailReport; text: string } {
  const candidates = Object.entries(files).filter(
    ([path]) => path.startsWith("showtail-reports/") && path.endsWith(".json"),
  );
  const matches = candidates.filter(([, content]) => sha256(Buffer.from(content)) === expectedSha256);
  if (matches.length !== 1)
    throw new Error(`Expected one Showtail report with hash ${expectedSha256}; found ${matches.length}`);
  const text = Buffer.from(matches[0]![1]).toString("utf8");
  const report = parseShowtailReport(JSON.parse(text));
  if (report.schemaVersion !== 2) throw new Error("The archived Showtail report is not schema version 2");
  return { report, text };
}

function sourceTree(
  files: Record<string, Uint8Array>,
  prefix: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    if (!path.startsWith(prefix) || path.endsWith("/")) continue;
    const rel = path.slice(prefix.length).replace(/\\/g, "/");
    if (!rel || rel.split("/").some((part) => EXCLUDED_SOURCE_DIRS.has(part))) continue;
    if (EXCLUDED_SOURCE_FILES.test(rel) || content.includes(0)) continue;
    out.set(rel, Buffer.from(content).toString("utf8").replace(/\r\n/g, "\n"));
  }
  return out;
}

function manuscriptExamples(path: string, chapter: number): MinedExample[] {
  if (!existsSync(path)) throw new Error(`Manuscript does not exist: ${path}`);
  const paragraphs = readParagraphs(path);
  const label = /^\s*prompt\s*[:\-–]\s*(.+)$/i;
  const found: MinedExample[] = [];
  for (let index = 0; index < paragraphs.length; index++) {
    const match = label.exec(paragraphs[index]!.text);
    if (!match || paragraphs[index]!.style === "Code") continue;
    let bodyStart = index + 1;
    while (bodyStart < paragraphs.length && paragraphs[bodyStart]!.style !== "Code") {
      if (label.test(paragraphs[bodyStart]!.text)) break;
      bodyStart++;
    }
    if (bodyStart >= paragraphs.length || paragraphs[bodyStart]!.style !== "Code")
      throw new Error(`Chapter ${chapter} prompt has no following code listing: ${match[1]}`);
    const body: string[] = [];
    let cursor = bodyStart;
    while (cursor < paragraphs.length && paragraphs[cursor]!.style === "Code")
      body.push(paragraphs[cursor++]!.text);
    found.push({
      book: "java",
      chapter,
      prompt: match[1]!.trim(),
      response: body.join("\n").replace(/\s+$/, ""),
      caption: cursor < paragraphs.length && paragraphs[cursor]!.style === "CodeCaption"
        ? paragraphs[cursor]!.text
        : null,
      heading: null,
      suggestedTitle: null,
      kind: "project",
      source: `Chapter${chapter}.docx`,
      prose: "",
    });
  }
  return found;
}

function projectPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\\/g, "/");
  const marker = "personal-finance-app/";
  const markerIndex = normalized.lastIndexOf(marker);
  const candidate = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized;
  if (!candidate || candidate.startsWith("/") || /^[A-Za-z]:\//.test(candidate)) return undefined;
  if (candidate.split("/").includes("..")) return undefined;
  return candidate.replace(/^\.\//, "");
}

function selectedEvents(report: ShowtailReport, segment: SegmentInput): ShowtailV2Event[] {
  const turn = report.turns[segment.turn];
  if (!turn?.events) throw new Error(`Showtail turn ${segment.turn} has no ordered events`);
  if (segment.mode === "full") return turn.events;
  const approval = turn.events.find((event) => event.type === "plan_approved");
  if (!approval) throw new Error(`Showtail turn ${segment.turn} has no plan approval boundary`);
  return turn.events.filter((event) => event.sequence > approval.sequence);
}

/**
 * A reconstructed baseline may predate the manuscript's final planning turn.
 * Keep the canonical plan first, then apply all project mutations after approval.
 */
function reportEvents(report: ShowtailReport, exercise: ExerciseInput): ShowtailV2Event[] {
  const primaryIndex = exercise.segments.findIndex(
    (segment) => segment.turn === exercise.primaryTurn && segment.mode === "full",
  );
  if (primaryIndex <= 0) return exercise.segments.flatMap((segment) => selectedEvents(report, segment));
  const primary = report.turns[exercise.primaryTurn]?.events;
  if (!primary) throw new Error(`${exercise.id} primary turn has no events`);
  const approval = primary.find((event) => event.type === "plan_approved");
  if (!approval) return exercise.segments.flatMap((segment) => selectedEvents(report, segment));
  return [
    ...primary.filter((event) => event.sequence <= approval.sequence),
    ...exercise.segments
      .slice(0, primaryIndex)
      .flatMap((segment) => selectedEvents(report, segment))
      .filter((event) => event.type === "tool_use" || event.type === "tool_result"),
    ...primary.filter((event) => event.sequence > approval.sequence),
    ...exercise.segments.slice(primaryIndex + 1).flatMap((segment) => selectedEvents(report, segment)),
  ];
}

function successfulEvents(events: ShowtailV2Event[]): ShowtailV2Event[] {
  const results = new Map(
    events
      .filter((event) => event.type === "tool_result" && event.toolUseId)
      .map((event) => [event.toolUseId!, event]),
  );
  const failed = new Set(
    events
      .filter((event) => event.type === "tool_result" && event.isError && event.toolUseId)
      .map((event) => event.toolUseId!),
  );
  for (const event of events) {
    if (
      event.type !== "tool_use" ||
      event.toolName?.toLowerCase() !== "bash" ||
      !event.toolUseId
    ) continue;
    const result = results.get(event.toolUseId);
    if (!result || (result.exitCode === undefined && result.isError !== false))
      failed.add(event.toolUseId);
  }
  return events.filter((event) => !event.toolUseId || !failed.has(event.toolUseId));
}

function applyEvents(state: Map<string, string>, events: ShowtailV2Event[]): void {
  for (const event of successfulEvents(events)) {
    if (event.type !== "tool_use") continue;
    const name = event.toolName?.toLowerCase();
    const input = event.input && typeof event.input === "object" && !Array.isArray(event.input)
      ? event.input as Record<string, unknown>
      : {};
    const path = projectPath(input.file_path ?? input.path);
    if (name === "write" && path && typeof input.content === "string") {
      state.set(path, input.content.replace(/\r\n/g, "\n"));
      continue;
    }
    if (name === "edit" && path) {
      const oldText = typeof input.old_string === "string" ? input.old_string : input.oldText;
      const newText = typeof input.new_string === "string" ? input.new_string : input.newText;
      const current = state.get(path);
      if (typeof oldText !== "string" || typeof newText !== "string" || current === undefined)
        throw new Error(`Captured edit for ${path} is missing its source state`);
      if (!current.includes(oldText)) throw new Error(`Captured edit text is absent from ${path}`);
      state.set(
        path,
        input.replace_all === true || input.replaceAll === true
          ? current.split(oldText).join(newText)
          : current.replace(oldText, newText),
      );
      continue;
    }
    if (name !== "bash" || typeof input.command !== "string" || !/\brm\b/.test(input.command)) continue;
    for (const match of input.command.matchAll(/["']([^"']*personal-finance-app\/[^"']+)["']/g)) {
      const removed = projectPath(match[1]);
      if (removed) state.delete(removed);
    }
  }
}

function withoutRedundantEdits(
  events: ShowtailV2Event[],
  initialFiles: Map<string, string> | undefined,
  normalizations: NormalizationInput[],
): ShowtailV2Event[] {
  if (!initialFiles) return events;
  const state = new Map(initialFiles);
  const dropped = new Set<string>();
  const adjusted = new Map<string, ShowtailV2Event>();
  const normalizeFragment = (value: string): string => {
    let normalized = value;
    for (const normalization of normalizations)
      if (normalized.includes(normalization.oldText))
        normalized = normalized.replace(normalization.oldText, normalization.newText);
    return normalized;
  };
  for (const event of successfulEvents(events)) {
    if (event.type !== "tool_use") continue;
    const input = event.input && typeof event.input === "object" && !Array.isArray(event.input)
      ? event.input as Record<string, unknown>
      : {};
    const path = projectPath(input.file_path ?? input.path);
    const name = event.toolName?.toLowerCase();
    if (name === "write" && path && typeof input.content === "string") {
      state.set(path, input.content.replace(/\r\n/g, "\n"));
      continue;
    }
    if (name !== "edit" || !path) continue;
    const rawOldText = typeof input.old_string === "string" ? input.old_string : input.oldText;
    const rawNewText = typeof input.new_string === "string" ? input.new_string : input.newText;
    const current = state.get(path);
    if (typeof rawOldText !== "string" || typeof rawNewText !== "string" || current === undefined) continue;
    let oldText: string = rawOldText;
    let newText: string = rawNewText;
    const representedNormalizations = normalizations.filter(
      (normalization) =>
        normalization.path === path &&
        (newText.includes(normalization.newText) ||
          Boolean(normalization.skipIfContains && newText.includes(normalization.skipIfContains))),
    );
    if (representedNormalizations.length > 0 && event.toolUseId) {
      let base = current;
      for (const normalization of representedNormalizations)
        if (normalization.skipIfContains && base.includes(normalization.newText))
          base = base.replace(normalization.newText, normalization.oldText);
      const normalizedOld = normalizeFragment(oldText);
      const normalizedNew = normalizeFragment(newText);
      if (base.includes(normalizedOld)) {
        const desired = input.replace_all === true || input.replaceAll === true
          ? base.split(normalizedOld).join(normalizedNew)
          : base.replace(normalizedOld, normalizedNew);
        if (desired === current) {
          dropped.add(event.toolUseId);
        } else {
          adjusted.set(event.toolUseId, {
            ...event,
            input: { ...input, old_string: current, new_string: desired },
          });
          state.set(path, desired);
        }
        continue;
      }
    }
    if (!current.includes(oldText)) {
      const normalizedOld = normalizeFragment(oldText);
      const normalizedNew = normalizeFragment(newText);
      if (current.includes(normalizedOld)) {
        oldText = normalizedOld;
        newText = normalizedNew;
        if (event.toolUseId)
          adjusted.set(event.toolUseId, {
            ...event,
            input: { ...input, old_string: oldText, new_string: newText },
          });
      }
    }
    if (!current.includes(oldText) && !adjusted.has(event.toolUseId ?? ""))
      throw new Error(`Replay-compatible edit could not be reconstructed for ${path} (${event.toolUseId ?? "unknown"})`);
    if (current.includes(oldText)) {
      state.set(
        path,
        input.replace_all === true || input.replaceAll === true
          ? current.split(oldText).join(newText)
          : current.replace(oldText, newText),
      );
    } else if (current.includes(newText) && event.toolUseId) {
      dropped.add(event.toolUseId);
    }
  }
  let compatible = events
    .filter((event) => !event.toolUseId || !dropped.has(event.toolUseId))
    .map((event) => event.toolUseId ? adjusted.get(event.toolUseId) ?? event : event);
  // Adjusting an earlier whole-file edit can make a later captured retry already
  // satisfied. Prune those idempotent retries using the exact events to be stored.
  for (let pass = 0; pass < 2; pass++) {
    const replayState = new Map(initialFiles);
    const redundant = new Set<string>();
    for (const event of successfulEvents(compatible)) {
      if (event.type !== "tool_use") continue;
      const input = event.input && typeof event.input === "object" && !Array.isArray(event.input)
        ? event.input as Record<string, unknown>
        : {};
      const path = projectPath(input.file_path ?? input.path);
      const name = event.toolName?.toLowerCase();
      if (name === "write" && path && typeof input.content === "string") {
        replayState.set(path, input.content.replace(/\r\n/g, "\n"));
        continue;
      }
      if (name !== "edit" || !path || !event.toolUseId) continue;
      const oldText = typeof input.old_string === "string" ? input.old_string : input.oldText;
      const newText = typeof input.new_string === "string" ? input.new_string : input.newText;
      const current = replayState.get(path);
      if (typeof oldText !== "string" || typeof newText !== "string" || current === undefined) continue;
      if (current.includes(oldText)) {
        replayState.set(
          path,
          input.replace_all === true || input.replaceAll === true
            ? current.split(oldText).join(newText)
            : current.replace(oldText, newText),
        );
      } else if (current.includes(newText)) {
        redundant.add(event.toolUseId);
      }
    }
    if (redundant.size === 0) break;
    compatible = compatible.filter((event) => !event.toolUseId || !redundant.has(event.toolUseId));
  }
  return compatible;
}

function applyNormalizations(
  files: Map<string, string>,
  normalizations: NormalizationInput[],
): Array<NormalizationInput & { beforeSha256: string; afterSha256: string; content: string }> {
  const applied: Array<NormalizationInput & {
    beforeSha256: string;
    afterSha256: string;
    content: string;
  }> = [];
  for (const normalization of normalizations) {
    const current = files.get(normalization.path);
    if (current === undefined) throw new Error(`Normalization source is missing: ${normalization.path}`);
    if (normalization.skipIfContains && current.includes(normalization.skipIfContains)) continue;
    if (!current.includes(normalization.oldText) && current.includes(normalization.newText)) continue;
    if (!current.includes(normalization.oldText) && normalization.optional) continue;
    if (!current.includes(normalization.oldText))
      throw new Error(`Normalization ${normalization.id} no longer applies to ${normalization.path}`);
    const content = current.replace(normalization.oldText, normalization.newText);
    files.set(normalization.path, content);
    applied.push({
      ...normalization,
      beforeSha256: sha256(current),
      afterSha256: sha256(content),
      content,
    });
  }
  return applied;
}

const replacements: Array<[RegExp, string]> = [
  [/[A-Za-z]:\\Users\\[^\\]+\\[^"'`\n]*\\personal-finance-app/gi, "."],
  [/\/(?:Users|home)\/[^/]+\/[^"'`\n]*\/personal-finance-app/g, "."],
  [/[A-Za-z]:\\Users\\[^\\]+\\(?:Nextcloud|OneDrive|Dropbox)\\[^"'`\n]*/gi, "<author-workspace>"],
  [/\/(?:Users|home)\/[^/]+\/(?:Nextcloud|OneDrive|Dropbox)\/[^"'`\n]*/g, "<author-workspace>"],
  [/<author-home>\/\.claude\/plans\/[A-Za-z0-9._-]+\.md/g, "<captured-plan>"],
  [/[A-Za-z]:\\Users\\[^\\\s"'`]+/gi, "<author-home>"],
  [/\/(?:Users|home)\/[^/\s"'`]+/g, "<author-home>"],
  [/<author-home>/g, "~"],
  [/<author-workspace>/g, "<workspace>"],
  [/\b[a-z0-9._-]+-at-[a-z0-9.-]+-com\b/gi, "author"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "author@example.invalid"],
];

function sanitizeString(value: string): string {
  let sanitized = value;
  for (const [pattern, replacement] of replacements)
    sanitized = sanitized.replace(pattern, replacement);
  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeValue(item)]),
  );
}

const ALLOWED_TOOLS = new Set([
  "askuserquestion",
  "enterplanmode",
  "exitplanmode",
  "read",
  "write",
  "edit",
  "bash",
]);

function sanitizeToolUse(event: ShowtailV2Event): ShowtailV2Event | undefined {
  const name = event.toolName?.toLowerCase();
  if (!name || !ALLOWED_TOOLS.has(name)) return undefined;
  const input = event.input && typeof event.input === "object" && !Array.isArray(event.input)
    ? event.input as Record<string, unknown>
    : {};
  if (name === "read" || name === "write" || name === "edit") {
    const path = projectPath(input.file_path ?? input.path);
    if (!path) return undefined;
    const cleaned = sanitizeValue(input) as Record<string, unknown>;
    delete cleaned.path;
    cleaned.file_path = path;
    return { ...event, input: cleaned };
  }
  const cleanedInput = event.input === undefined ? undefined : sanitizeValue(event.input);
  if (
    name === "bash" &&
    cleanedInput &&
    typeof cleanedInput === "object" &&
    !Array.isArray(cleanedInput) &&
    typeof (cleanedInput as Record<string, unknown>).command === "string" &&
    /<author-(?:home|workspace)>/.test((cleanedInput as Record<string, string>).command)
  ) return undefined;
  return { ...event, ...(cleanedInput === undefined ? {} : { input: cleanedInput }) };
}

function sanitizeEvents(
  exerciseId: string,
  prompt: string,
  events: ShowtailV2Event[],
  corrections: Array<{ path: string; content: string; message: string }>,
): ShowtailV2Event[] {
  const successful = successfulEvents(events);
  const keptToolIds = new Set<string>();
  const provisional: ShowtailV2Event[] = [
    { sequence: 0, type: "user_text", text: prompt },
  ];
  for (const event of successful) {
    if (event.type === "user_text") continue;
    if (event.type === "tool_use") {
      const cleaned = sanitizeToolUse(event);
      if (!cleaned) continue;
      if (cleaned.toolUseId) {
        keptToolIds.add(cleaned.toolUseId);
      }
      provisional.push(cleaned);
      continue;
    }
    if (event.type === "tool_result") {
      if (!event.toolUseId || !keptToolIds.has(event.toolUseId)) continue;
      const cleaned = { ...event };
      delete cleaned.content;
      delete cleaned.stdout;
      delete cleaned.stderr;
      const content = event.content === undefined ? undefined : sanitizeValue(event.content);
      const stdout = event.stdout === undefined ? undefined : sanitizeString(event.stdout);
      const stderr = event.stderr === undefined ? undefined : sanitizeString(event.stderr);
      if (content !== undefined) cleaned.content = content;
      if (stdout !== undefined) cleaned.stdout = stdout;
      if (stderr !== undefined) cleaned.stderr = stderr;
      provisional.push(cleaned);
      continue;
    }
    provisional.push({
      ...event,
      ...(event.text === undefined ? {} : { text: sanitizeString(event.text) }),
      ...(event.plan === undefined ? {} : { plan: sanitizeString(event.plan) }),
    });
  }

  let synthetic = 0;
  for (const correction of corrections) {
    const toolUseId = `${exerciseId}-checkpoint-${++synthetic}`;
    provisional.push({
      sequence: 0,
      type: "assistant_text",
      text: correction.message,
    });
    provisional.push({
      sequence: 0,
      type: "tool_use",
      toolUseId,
      toolName: "Write",
      input: { file_path: correction.path, content: correction.content },
    });
    provisional.push({
      sequence: 0,
      type: "tool_result",
      toolUseId,
      isError: false,
      content: "Reconstructed from the authoritative final source checkpoint",
    });
  }

  const toolIds = new Map<string, string>();
  let nextTool = 0;
  return provisional.map((event, sequence) => {
    let toolUseId = event.toolUseId;
    if (event.type === "tool_use" && toolUseId) {
      const replacement = `${exerciseId}-tool-${String(++nextTool).padStart(3, "0")}`;
      toolIds.set(toolUseId, replacement);
      toolUseId = replacement;
    } else if (toolUseId) {
      toolUseId = toolIds.get(toolUseId) ?? toolUseId;
    }
    return {
      ...event,
      sequence,
      ...(toolUseId ? { toolUseId } : {}),
    };
  });
}

function differences(left: Map<string, string>, right: Map<string, string>): string[] {
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((path) => left.get(path) !== right.get(path))
    .sort();
}

function writeSource(root: string, files: Map<string, string>): void {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [path, content] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function currentSource(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(root)) return out;
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else out.set(relative(root, path).replace(/\\/g, "/"), readFileSync(path, "utf8"));
    }
  };
  visit(root);
  return out;
}

function privacyProblems(text: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["macOS home path", /\/Users\//],
    ["Windows home path", /[A-Za-z]:\\Users\\/i],
    ["Linux home path", /\/home\/[A-Za-z0-9._-]+/],
    ["private sync folder", /\b(?:Nextcloud|OneDrive|Dropbox)\b/i],
    ["email-derived identity", /-at-[a-z0-9.-]+-com\b/i],
    ["raw log path", /claude-logs/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

const config = manifest();
const zipped = archiveFiles(resolve(archivePath));
const { report, text: rawReportText } = reportFromArchive(zipped, config.reportSha256);
const manuscripts = new Map<number, MinedExample[]>([
  [11, manuscriptExamples(resolve(chapter11Path), 11)],
  [12, manuscriptExamples(resolve(chapter12Path), 12)],
]);
const bookPath = resolve(ROOT, config.bookFile);
const book = JSON.parse(readFileSync(bookPath, "utf8")) as RawBook;
const state = new Map<string, string>();
let initialFiles: Map<string, string> | undefined;
let initialExerciseId: string | undefined;
let bookChanged = false;
const results: Array<{ id: string; changed: boolean; files: number }> = [];

for (const chapterInput of config.chapters) {
  const chapter = book.sections
    .flatMap((section) => section.chapters)
    .find((candidate) => new RegExp(`chapter\\s+${chapterInput.number}\\b`, "i").test(candidate.title));
  if (!chapter) throw new Error(`Book has no chapter ${chapterInput.number}`);
  if (chapter.title !== chapterInput.title || chapter.goal !== chapterInput.goal) {
    chapter.title = chapterInput.title;
    chapter.goal = chapterInput.goal;
    bookChanged = true;
  }

  const mined = manuscripts.get(chapterInput.number) ?? [];
  if (mined.length !== chapterInput.exercises.length)
    throw new Error(`Chapter ${chapterInput.number} yielded ${mined.length} prompts, expected ${chapterInput.exercises.length}`);

  const generated: RawExample[] = [];
  for (let index = 0; index < chapterInput.exercises.length; index++) {
    const exercise = chapterInput.exercises[index]!;
    const authored = mined[index]!;
    if (!authored.response) throw new Error(`${exercise.id} has no manuscript response`);
    if (sha256(authored.prompt) !== exercise.promptSha256)
      throw new Error(`${exercise.id} manuscript prompt hash changed`);
    if (sha256(authored.response) !== exercise.responseSha256)
      throw new Error(`${exercise.id} manuscript response hash changed`);

    const rawEvents = reportEvents(report, exercise);
    for (const segment of exercise.segments)
      applyEvents(state, selectedEvents(report, segment));

    const corrections: Array<{ path: string; content: string; beforeSha256?: string; afterSha256: string }> = [];
    let checkpointAudit: Record<string, unknown> | undefined;
    if (exercise.checkpoint) {
      const checkpoint = sourceTree(zipped, exercise.checkpoint.archivePrefix);
      const checkpointHash = canonicalTreeSha256(checkpoint);
      if (checkpointHash !== exercise.checkpoint.canonicalTreeSha256)
        throw new Error(`${exercise.id} checkpoint hash changed: ${checkpointHash}`);
      const changed = differences(state, checkpoint);
      const allowed = [...(exercise.checkpoint.correctionPaths ?? [])].sort();
      if (changed.join("\0") !== allowed.join("\0"))
        throw new Error(`${exercise.id} checkpoint differs at unexpected paths: ${changed.join(", ") || "none"}`);
      for (const path of allowed) {
        const content = checkpoint.get(path);
        if (content === undefined) throw new Error(`${exercise.id} correction removes unsupported path ${path}`);
        const before = state.get(path);
        corrections.push({
          path,
          content,
          ...(before === undefined ? {} : { beforeSha256: sha256(before) }),
          afterSha256: sha256(content),
        });
        state.set(path, content);
      }
      if (differences(state, checkpoint).length > 0)
        throw new Error(`${exercise.id} did not reconstruct the authoritative checkpoint`);
      checkpointAudit = {
        label: exercise.checkpoint.label,
        canonicalTreeSha256: checkpointHash,
      };
    }

    const snapshot = new Map([...state].sort(([left], [right]) => left.localeCompare(right)));
    const normalizations = applyNormalizations(snapshot, config.normalizations ?? []);
    const finalNormalizationByPath = new Map(
      normalizations.map((normalization) => [normalization.path, normalization]),
    );
    const syntheticCorrections = [
      ...corrections.map((correction) => ({
        path: correction.path,
        content: correction.content,
        message: `The authoritative project checkpoint contains an uncaptured update to ${correction.path}; applying that final source now.`,
      })),
      ...[...finalNormalizationByPath.values()]
        .filter((normalization) => initialFiles?.get(normalization.path) !== normalization.content)
        .map((normalization) => ({
          path: normalization.path,
          content: normalization.content,
          message:
            "The captured allocation used the authoring date. Applying the later month-aware implementation so this checkpoint remains deterministic.",
        })),
    ];

    const primary = report.turns[exercise.primaryTurn];
    if (!primary) throw new Error(`${exercise.id} primary turn ${exercise.primaryTurn} does not exist`);
    const sanitized = sanitizeEvents(
      exercise.id,
      authored.prompt,
      withoutRedundantEdits(rawEvents, initialFiles, config.normalizations ?? []),
      syntheticCorrections,
    );
    const scopedReport = {
      schemaVersion: 2,
      generatedAt: report.generatedAt,
      displayName: "PocketCFO",
      sessionId: `pocketcfo-${exercise.id}`,
      turns: [
        {
          prompt: {
            text: authored.prompt,
            ...(primary.prompt.timestamp ? { timestamp: primary.prompt.timestamp } : {}),
          },
          events: sanitized,
          aiOutputs: [],
          codeChanges: [],
          toolCalls: [],
        },
      ],
    };
    const reportText = stableJson(scopedReport);
    const privacy = privacyProblems(reportText);
    if (privacy.length > 0) throw new Error(`${exercise.id} sanitized report still contains ${privacy.join(", ")}`);
    const parsedReport = parseShowtailReport(scopedReport);
    const derived = deriveReplay({
      report: parsedReport,
      reportText,
      turnIndex: 0,
      sourceFiles: snapshot,
      response: authored.response,
      responsePath: exercise.responsePath,
      responseMatch: exercise.responseMatch,
      initialFiles,
      initialExerciseId,
    });
    const errors = derived.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0)
      throw new Error(`${exercise.id} replay import failed:\n${errors.map((item) => `- ${item.field}: ${item.message}`).join("\n")}`);
    if (!derived.replay || !derived.scaffold) throw new Error(`${exercise.id} produced no replay scaffold`);

    const created = reorder({
      id: exercise.id,
      title: exercise.title,
      description: exercise.description,
      kind: "project",
      prompt: authored.prompt,
      response: rawResponse(authored.response),
      explanation: exercise.explanation,
      scaffold: derived.scaffold,
      replay: derived.replay,
    }) as unknown as RawExample;
    generated.push(created);

    const exerciseRoot = resolve(dirname(manifestPath), exercise.bundle);
    const reportFile = join(exerciseRoot, "bundle", "report.json");
    const sourceRoot = join(exerciseRoot, "bundle", "source");
    const auditFile = join(exerciseRoot, "retrofit.json");
    const audit = {
      version: 1,
      exerciseId: exercise.id,
      retrofitDate: config.retrofitDate,
      source: {
        kind: "showtail-v2-archive",
        reportSha256: sha256(rawReportText),
        primaryTurn: exercise.primaryTurn,
        segments: exercise.segments,
      },
      manuscript: {
        promptSha256: exercise.promptSha256,
        responseSha256: exercise.responseSha256,
        responsePath: exercise.responsePath,
        responseMatch: exercise.responseMatch,
      },
      ...(checkpointAudit ? { checkpoint: checkpointAudit } : {}),
      corrections: corrections.map(({ content: _content, ...correction }) => correction),
      normalizations: normalizations.map(({ oldText: _old, newText: _new, content: _content, ...normalization }) => normalization),
      privacy: {
        originalArtifactsCommitted: false,
        identitiesRemoved: true,
        workspacePathsNormalized: true,
      },
      outputs: {
        reportSha256: sha256(reportText),
        sourceTreeSha256: canonicalTreeSha256(snapshot),
      },
    };
    const auditText = stableJson(audit);
    if (privacyProblems(auditText).length > 0) throw new Error(`${exercise.id} audit contains private source metadata`);
    const changed =
      !existsSync(reportFile) || readFileSync(reportFile, "utf8") !== reportText ||
      !existsSync(auditFile) || readFileSync(auditFile, "utf8") !== auditText ||
      canonicalTreeSha256(currentSource(sourceRoot)) !== canonicalTreeSha256(snapshot);
    if (write && changed) {
      mkdirSync(dirname(reportFile), { recursive: true });
      writeFileSync(reportFile, reportText);
      writeSource(sourceRoot, snapshot);
      writeFileSync(auditFile, auditText);
    }
    results.push({ id: exercise.id, changed, files: snapshot.size });
    initialFiles = snapshot;
    initialExerciseId = exercise.id;
  }

  if (JSON.stringify(chapter.examples) !== JSON.stringify(generated)) {
    chapter.examples = generated;
    bookChanged = true;
  }
}

if (write && bookChanged) writeFileSync(bookPath, `${JSON.stringify(book, null, 2)}\n`);

if (jsonOutput) {
  console.log(JSON.stringify({ write, bookChanged, results }, null, 2));
} else {
  for (const result of results)
    console.log(`${result.changed ? write ? "WROTE" : "CHANGE" : "OK"} ${result.id} (${result.files} files)`);
  console.log(`${bookChanged ? write ? "WROTE" : "CHANGE" : "OK"} ${relative(ROOT, bookPath)}`);
}
