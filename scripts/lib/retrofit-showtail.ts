/** Deterministic helpers for rebuilding Showtail v2 bundles from native transcripts. */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Explanation } from "../../src/types";
import type { ShowtailV2Event } from "./showtail";

export interface RetrofitPlanInput {
  toolUseId: string;
  path: string;
  sha256: string;
}

export interface RetrofitExerciseInput {
  id: string;
  title?: string;
  description?: string;
  prompt?: string;
  promptSha256: string;
  responsePath?: string;
  entrypoint?: string;
  stdin?: string;
  explanation?: Explanation;
  legacyReport?: string;
  legacyReportSha256: string;
  sourceCheckpoint: string;
  sourceTreeSha256: string;
  bundle: string;
  sourceExcludes?: string[];
  capture?:
    | { mode: "native" }
    | {
        mode: "legacy-diff";
        integration: string;
        initialCheckpoint: string;
        initialTreeSha256: string;
      };
  checkpointOverlay?: {
    message: string;
    prompt: string;
    promptSha256: string;
    legacyReportSha256: string;
    sourceCheckpoint: string;
    sourceTreeSha256: string;
    capture: {
      mode: "legacy-diff";
      integration: string;
      initialCheckpoint: string;
      initialTreeSha256: string;
    };
  };
  plans?: RetrofitPlanInput[];
}

export interface RetrofitManifest {
  version: 1;
  book: string;
  bookFile: string;
  retrofitDate: string;
  showtailVersion: string;
  projectName: string;
  chapterTitle?: string;
  session: {
    integration: "claude" | "codex";
    id: string;
    transcript: string;
    sha256: string;
  };
  exercises: RetrofitExerciseInput[];
}

export interface CanonicalSourceTree {
  files: Map<string, string>;
  rawTreeSha256: string;
  canonicalTreeSha256: string;
  normalizedLineEndings: string[];
  excludedPaths: string[];
}

export const EXCLUDED_SOURCE_DIRS = new Set([
  ".git",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  "assets",
]);

export const EXCLUDED_SOURCE_FILES =
  /(^|\/)(screenshot[^/]*|\.DS_Store)$|\.(png|jpe?g|gif|webp|pyc|class)$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function explanation(value: unknown, label: string): Explanation {
  const item = record(value, label);
  if (!Array.isArray(item.lines)) throw new Error(`${label}.lines must be an array`);
  return {
    summary: string(item.summary, `${label}.summary`),
    lines: item.lines.map((value, index) => {
      const line = record(value, `${label}.lines[${index}]`);
      return {
        code: string(line.code, `${label}.lines[${index}].code`),
        text: string(line.text, `${label}.lines[${index}].text`),
      };
    }),
    ...(optionalString(item.run) ? { run: item.run as string } : {}),
  };
}

function safeArchivePath(archiveRoot: string, path: string): string {
  const root = resolve(archiveRoot);
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}/`))
    throw new Error(`Archive path escapes the configured root: ${path}`);
  return target;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function readRetrofitManifest(path: string): RetrofitManifest {
  const raw = record(JSON.parse(readFileSync(path, "utf8")), "manifest");
  if (raw.version !== 1) throw new Error("manifest.version must be 1");
  const session = record(raw.session, "manifest.session");
  const integration = session.integration;
  if (integration !== "claude" && integration !== "codex")
    throw new Error("manifest.session.integration must be claude or codex");
  if (!Array.isArray(raw.exercises) || raw.exercises.length === 0)
    throw new Error("manifest.exercises must be a non-empty array");
  return {
    version: 1,
    book: string(raw.book, "manifest.book"),
    bookFile: string(raw.bookFile, "manifest.bookFile"),
    retrofitDate: string(raw.retrofitDate, "manifest.retrofitDate"),
    showtailVersion: string(raw.showtailVersion, "manifest.showtailVersion"),
    projectName: string(raw.projectName, "manifest.projectName"),
    ...(optionalString(raw.chapterTitle)
      ? { chapterTitle: raw.chapterTitle as string }
      : {}),
    session: {
      integration,
      id: string(session.id, "manifest.session.id"),
      transcript: string(session.transcript, "manifest.session.transcript"),
      sha256: string(session.sha256, "manifest.session.sha256"),
    },
    exercises: raw.exercises.map((value, index) => {
      const item = record(value, `manifest.exercises[${index}]`);
      const plans = item.plans;
      if (plans !== undefined && !Array.isArray(plans))
        throw new Error(`manifest.exercises[${index}].plans must be an array`);
      const capture = item.capture;
      let parsedCapture: RetrofitExerciseInput["capture"];
      if (capture !== undefined) {
        const parsed = record(capture, `manifest.exercises[${index}].capture`);
        if (parsed.mode === "native") parsedCapture = { mode: "native" };
        else if (parsed.mode === "legacy-diff")
          parsedCapture = {
            mode: "legacy-diff",
            integration: string(
              parsed.integration,
              `manifest.exercises[${index}].capture.integration`,
            ),
            initialCheckpoint: string(
              parsed.initialCheckpoint,
              `manifest.exercises[${index}].capture.initialCheckpoint`,
            ),
            initialTreeSha256: string(
              parsed.initialTreeSha256,
              `manifest.exercises[${index}].capture.initialTreeSha256`,
            ),
          };
        else
          throw new Error(
            `manifest.exercises[${index}].capture.mode is unsupported`,
          );
      }
      const checkpointOverlay = item.checkpointOverlay;
      let parsedCheckpointOverlay: RetrofitExerciseInput["checkpointOverlay"];
      if (checkpointOverlay !== undefined) {
        const overlay = record(
          checkpointOverlay,
          `manifest.exercises[${index}].checkpointOverlay`,
        );
        const overlayCapture = record(
          overlay.capture,
          `manifest.exercises[${index}].checkpointOverlay.capture`,
        );
        if (overlayCapture.mode !== "legacy-diff")
          throw new Error(
            `manifest.exercises[${index}].checkpointOverlay.capture.mode must be legacy-diff`,
          );
        parsedCheckpointOverlay = {
          message: string(
            overlay.message,
            `manifest.exercises[${index}].checkpointOverlay.message`,
          ),
          prompt: string(
            overlay.prompt,
            `manifest.exercises[${index}].checkpointOverlay.prompt`,
          ),
          promptSha256: string(
            overlay.promptSha256,
            `manifest.exercises[${index}].checkpointOverlay.promptSha256`,
          ),
          legacyReportSha256: string(
            overlay.legacyReportSha256,
            `manifest.exercises[${index}].checkpointOverlay.legacyReportSha256`,
          ),
          sourceCheckpoint: string(
            overlay.sourceCheckpoint,
            `manifest.exercises[${index}].checkpointOverlay.sourceCheckpoint`,
          ),
          sourceTreeSha256: string(
            overlay.sourceTreeSha256,
            `manifest.exercises[${index}].checkpointOverlay.sourceTreeSha256`,
          ),
          capture: {
            mode: "legacy-diff",
            integration: string(
              overlayCapture.integration,
              `manifest.exercises[${index}].checkpointOverlay.capture.integration`,
            ),
            initialCheckpoint: string(
              overlayCapture.initialCheckpoint,
              `manifest.exercises[${index}].checkpointOverlay.capture.initialCheckpoint`,
            ),
            initialTreeSha256: string(
              overlayCapture.initialTreeSha256,
              `manifest.exercises[${index}].checkpointOverlay.capture.initialTreeSha256`,
            ),
          },
        };
      }
      const sourceExcludes = item.sourceExcludes;
      if (sourceExcludes !== undefined && !Array.isArray(sourceExcludes))
        throw new Error(
          `manifest.exercises[${index}].sourceExcludes must be an array`,
        );
      return {
        id: string(item.id, `manifest.exercises[${index}].id`),
        ...(optionalString(item.title) ? { title: item.title as string } : {}),
        ...(optionalString(item.description)
          ? { description: item.description as string }
          : {}),
        ...(optionalString(item.prompt)
          ? { prompt: item.prompt as string }
          : {}),
        promptSha256: string(
          item.promptSha256,
          `manifest.exercises[${index}].promptSha256`,
        ),
        ...(optionalString(item.legacyReport)
          ? { legacyReport: item.legacyReport as string }
          : {}),
        legacyReportSha256: string(
          item.legacyReportSha256,
          `manifest.exercises[${index}].legacyReportSha256`,
        ),
        sourceCheckpoint: string(
          item.sourceCheckpoint,
          `manifest.exercises[${index}].sourceCheckpoint`,
        ),
        sourceTreeSha256: string(
          item.sourceTreeSha256,
          `manifest.exercises[${index}].sourceTreeSha256`,
        ),
        bundle: string(item.bundle, `manifest.exercises[${index}].bundle`),
        ...(optionalString(item.responsePath)
          ? { responsePath: item.responsePath as string }
          : {}),
        ...(optionalString(item.entrypoint)
          ? { entrypoint: item.entrypoint as string }
          : {}),
        ...(optionalString(item.stdin) ? { stdin: item.stdin as string } : {}),
        ...(item.explanation !== undefined
          ? {
              explanation: explanation(
                item.explanation,
                `manifest.exercises[${index}].explanation`,
              ),
            }
          : {}),
        ...(sourceExcludes
          ? {
              sourceExcludes: sourceExcludes.map((path, pathIndex) =>
                string(
                  path,
                  `manifest.exercises[${index}].sourceExcludes[${pathIndex}]`,
                ),
              ),
            }
          : {}),
        ...(parsedCapture ? { capture: parsedCapture } : {}),
        ...(parsedCheckpointOverlay
          ? { checkpointOverlay: parsedCheckpointOverlay }
          : {}),
        ...(plans
          ? {
              plans: plans.map((plan, planIndex) => {
                const parsed = record(
                  plan,
                  `manifest.exercises[${index}].plans[${planIndex}]`,
                );
                return {
                  toolUseId: string(
                    parsed.toolUseId,
                    `manifest.exercises[${index}].plans[${planIndex}].toolUseId`,
                  ),
                  path: string(
                    parsed.path,
                    `manifest.exercises[${index}].plans[${planIndex}].path`,
                  ),
                  sha256: string(
                    parsed.sha256,
                    `manifest.exercises[${index}].plans[${planIndex}].sha256`,
                  ),
                };
              }),
            }
          : {}),
      };
    }),
  };
}

function allFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  visit(root);
  return out.sort((left, right) =>
    relative(root, left).localeCompare(relative(root, right)),
  );
}

function hashTree(root: string, files: Array<[string, Buffer]>): string {
  const hash = createHash("sha256");
  for (const [path, content] of files) {
    hash.update(relative(root, path).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function canonicalTreeSha256(files: Map<string, string>): string {
  const root = "/canonical";
  return hashTree(
    root,
    [...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([path, content]) =>
          [join(root, path), Buffer.from(content)] as [string, Buffer],
      ),
  );
}

export function canonicalSourceTree(
  archiveRoot: string,
  checkpointPath: string,
  excludedPaths: string[] = [],
): CanonicalSourceTree {
  const root = safeArchivePath(archiveRoot, checkpointPath);
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new Error(`Source checkpoint does not exist: ${checkpointPath}`);
  const rawFiles = allFiles(root).map(
    (path) => [path, readFileSync(path)] as [string, Buffer],
  );
  const files = new Map<string, string>();
  const normalizedLineEndings: string[] = [];
  const excluded = new Set(excludedPaths.map((path) => path.replace(/\\/g, "/")));
  for (const [path, data] of rawFiles) {
    const rel = relative(root, path).replace(/\\/g, "/");
    if (excluded.has(rel)) continue;
    const parts = rel.split("/");
    if (parts.some((part) => EXCLUDED_SOURCE_DIRS.has(part))) continue;
    if (EXCLUDED_SOURCE_FILES.test(rel) || data.includes(0)) continue;
    const rawText = data.toString("utf8");
    const content = rawText.replace(/\r\n/g, "\n");
    if (content !== rawText) normalizedLineEndings.push(rel);
    files.set(rel, content);
  }
  return {
    files,
    rawTreeSha256: hashTree(root, rawFiles),
    canonicalTreeSha256: canonicalTreeSha256(files),
    normalizedLineEndings,
    excludedPaths: [...excluded].sort(),
  };
}

export function resolveArchiveInput(archiveRoot: string, path: string): string {
  return safeArchivePath(archiveRoot, path);
}

export function resolveArchiveInputBySha256(
  archiveRoot: string,
  expectedSha256: string,
  suffix = ".json",
): string {
  const root = resolve(archiveRoot);
  const matches = allFiles(root).filter(
    (path) => path.endsWith(suffix) && sha256(readFileSync(path)) === expectedSha256,
  );
  if (matches.length !== 1)
    throw new Error(
      `Expected one ${suffix} archive input with SHA-256 ${expectedSha256}; found ${matches.length}`,
    );
  return matches[0]!;
}

function canonicalEvent(
  value: unknown,
  sequence: number,
): ShowtailV2Event {
  const event = record(value, `event ${sequence}`);
  const type = string(event.type, `event ${sequence}.type`);
  const allowed = new Set([
    "assistant_text",
    "user_text",
    "tool_use",
    "tool_result",
    "plan_snapshot",
    "plan_approved",
  ]);
  if (!allowed.has(type)) throw new Error(`Unsupported Showtail event type: ${type}`);
  return {
    sequence,
    type: type as ShowtailV2Event["type"],
    ...(optionalString(event.timestamp)
      ? { timestamp: event.timestamp as string }
      : {}),
    ...(optionalString(event.text) ? { text: event.text as string } : {}),
    ...(optionalString(event.toolUseId)
      ? { toolUseId: event.toolUseId as string }
      : {}),
    ...(optionalString(event.toolName)
      ? { toolName: event.toolName as string }
      : {}),
    ...(event.input === undefined ? {} : { input: event.input }),
    ...(event.content === undefined ? {} : { content: event.content }),
    ...(typeof event.isError === "boolean" ? { isError: event.isError } : {}),
    ...(optionalString(event.stdout) ? { stdout: event.stdout as string } : {}),
    ...(optionalString(event.stderr) ? { stderr: event.stderr as string } : {}),
    ...(Number.isInteger(event.exitCode)
      ? { exitCode: event.exitCode as number }
      : {}),
    ...(optionalString(event.plan) ? { plan: event.plan as string } : {}),
  };
}

function canonicalText(value: unknown): { text: string; timestamp?: string } {
  const item = record(value, "text summary");
  return {
    text: string(item.text, "text summary.text"),
    ...(optionalString(item.timestamp)
      ? { timestamp: item.timestamp as string }
      : {}),
  };
}

export interface CanonicalReportOptions {
  rawReport: unknown;
  legacyReport: unknown;
  prompt: string;
  sessionId: string;
}

export function canonicalizeExerciseReport(
  options: CanonicalReportOptions,
): Record<string, unknown> {
  const raw = record(options.rawReport, "Showtail v2 report");
  if (raw.schemaVersion !== 2)
    throw new Error("Showtail command did not emit schemaVersion 2");
  if (!Array.isArray(raw.turns)) throw new Error("Showtail v2 report has no turns");
  const matches = raw.turns.filter((value) => {
    const turn = record(value, "Showtail v2 turn");
    const prompt = record(turn.prompt, "Showtail v2 turn.prompt");
    return prompt.text === options.prompt;
  });
  if (matches.length !== 1)
    throw new Error(
      `Expected one Showtail v2 turn matching the exercise prompt; found ${matches.length}`,
    );
  const legacy = record(options.legacyReport, "legacy report");
  const turn = record(matches[0], "matched Showtail v2 turn");
  const prompt = record(turn.prompt, "matched Showtail v2 turn.prompt");
  if (!Array.isArray(turn.events) || turn.events.length === 0)
    throw new Error("Matched Showtail v2 turn has no ordered events");
  const codeChanges = Array.isArray(turn.codeChanges)
    ? turn.codeChanges.map((value) => {
        const item = record(value, "code change");
        return {
          path: string(item.path, "code change.path"),
          ...(optionalString(item.diff) ? { diff: item.diff as string } : {}),
          ...(optionalString(item.timestamp)
            ? { timestamp: item.timestamp as string }
            : {}),
        };
      })
    : [];
  const toolCalls = Array.isArray(turn.toolCalls)
    ? turn.toolCalls.map((value) => {
        const item = record(value, "tool call");
        return {
          toolName: string(item.toolName, "tool call.toolName"),
          text: string(item.text, "tool call.text"),
          ...(optionalString(item.timestamp)
            ? { timestamp: item.timestamp as string }
            : {}),
          ...(typeof item.isError === "boolean"
            ? { isError: item.isError }
            : {}),
        };
      })
    : [];
  return {
    schemaVersion: 2,
    generatedAt: string(legacy.generatedAt, "legacy report.generatedAt"),
    displayName: string(legacy.displayName, "legacy report.displayName"),
    sessionId: options.sessionId,
    turns: [
      {
        prompt: {
          text: options.prompt,
          ...(optionalString(prompt.timestamp)
            ? { timestamp: prompt.timestamp as string }
            : {}),
        },
        events: turn.events.map(canonicalEvent),
        aiOutputs: Array.isArray(turn.aiOutputs)
          ? turn.aiOutputs.map(canonicalText)
          : [],
        codeChanges,
        toolCalls,
      },
    ],
  };
}

function timestamp(value: unknown): string {
  return optionalString(value) ?? "9999-12-31T23:59:59.999Z";
}

export interface CanonicalLegacyDiffOptions {
  legacyReport: unknown;
  prompt: string;
  sessionId: string;
  exerciseId: string;
  initialFiles: Map<string, string>;
  sourceFiles: Map<string, string>;
}

/** Rebuild ordered edit events when v1 retained diffs but no native transcript. */
export function canonicalizeLegacyDiffReport(
  options: CanonicalLegacyDiffOptions,
): Record<string, unknown> {
  const legacy = record(options.legacyReport, "legacy report");
  if (!Array.isArray(legacy.turns)) throw new Error("legacy report has no turns");
  const turns = legacy.turns.filter((value) => {
    const turn = record(value, "legacy turn");
    const prompt = record(turn.prompt, "legacy turn.prompt");
    return prompt.text === options.prompt;
  });
  if (turns.length === 0)
    throw new Error(`Legacy report has no turn matching: ${options.prompt}`);

  const aiOutputs = turns
    .flatMap((value) => {
      const turn = record(value, "legacy turn");
      return Array.isArray(turn.aiOutputs) ? turn.aiOutputs.map(canonicalText) : [];
    })
    .sort((left, right) => timestamp(left.timestamp).localeCompare(timestamp(right.timestamp)));
  const codeChanges = turns
    .flatMap((value) => {
      const turn = record(value, "legacy turn");
      return Array.isArray(turn.codeChanges)
        ? turn.codeChanges.map((change) => {
            const item = record(change, "legacy code change");
            return {
              path: string(item.path, "legacy code change.path").replace(/\\/g, "/"),
              ...(optionalString(item.diff) ? { diff: item.diff as string } : {}),
              ...(optionalString(item.timestamp)
                ? { timestamp: item.timestamp as string }
                : {}),
            };
          })
        : [];
    })
    .sort((left, right) => timestamp(left.timestamp).localeCompare(timestamp(right.timestamp)));
  const toolCalls = turns
    .flatMap((value) => {
      const turn = record(value, "legacy turn");
      return Array.isArray(turn.toolCalls)
        ? turn.toolCalls.map((call) => {
            const item = record(call, "legacy tool call");
            return {
              toolName: string(item.toolName, "legacy tool call.toolName"),
              text: string(item.text, "legacy tool call.text"),
              ...(optionalString(item.timestamp)
                ? { timestamp: item.timestamp as string }
                : {}),
              ...(typeof item.isError === "boolean"
                ? { isError: item.isError }
                : {}),
            };
          })
        : [];
    })
    .sort((left, right) => timestamp(left.timestamp).localeCompare(timestamp(right.timestamp)));

  const changedPaths = [...new Set([
    ...options.initialFiles.keys(),
    ...options.sourceFiles.keys(),
  ])]
    .filter(
      (path) => options.initialFiles.get(path) !== options.sourceFiles.get(path),
    )
    .sort();
  const reportedPaths = [...new Set(codeChanges.map((change) => change.path))].sort();
  if (changedPaths.join("\0") !== reportedPaths.join("\0"))
    throw new Error(
      `Legacy code-change paths differ from the authoritative checkpoint: reported ${reportedPaths.join(", ") || "none"}; changed ${changedPaths.join(", ") || "none"}`,
    );

  const timeline: Array<
    | { timestamp?: string; kind: "assistant"; text: string }
    | { timestamp?: string; kind: "change"; path: string }
  > = [
    ...aiOutputs.map((output) => ({
      timestamp: output.timestamp,
      kind: "assistant" as const,
      text: output.text,
    })),
    ...codeChanges.map((change) => ({
      timestamp: change.timestamp,
      kind: "change" as const,
      path: change.path,
    })),
  ].sort((left, right) => timestamp(left.timestamp).localeCompare(timestamp(right.timestamp)));
  const events: ShowtailV2Event[] = [
    { sequence: 0, type: "user_text", text: options.prompt },
  ];
  for (const item of timeline) {
    if (item.kind === "assistant") {
      events.push({
        sequence: events.length,
        type: "assistant_text",
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
        text: item.text,
      });
      continue;
    }
    const before = options.initialFiles.get(item.path);
    const after = options.sourceFiles.get(item.path);
    if (after === undefined)
      throw new Error(`Legacy retrofit cannot reconstruct file deletion: ${item.path}`);
    const toolUseId = `retrofit-${options.exerciseId}-${events.length}`;
    events.push({
      sequence: events.length,
      type: "tool_use",
      ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      toolUseId,
      toolName: before === undefined ? "Write" : "Edit",
      input:
        before === undefined
          ? { file_path: item.path, content: after }
          : {
              file_path: item.path,
              old_string: before,
              new_string: after,
            },
    });
    events.push({
      sequence: events.length,
      type: "tool_result",
      ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      toolUseId,
      isError: false,
      content:
        "Reconstructed from Showtail v1 codeChanges and authoritative source checkpoints",
    });
  }

  const firstPrompt = turns
    .map((value) => record(record(value, "legacy turn").prompt, "legacy prompt"))
    .sort((left, right) => timestamp(left.timestamp).localeCompare(timestamp(right.timestamp)))[0]!;
  return {
    schemaVersion: 2,
    generatedAt: string(legacy.generatedAt, "legacy report.generatedAt"),
    displayName: string(legacy.displayName, "legacy report.displayName"),
    sessionId: options.sessionId,
    turns: [
      {
        prompt: {
          text: options.prompt,
          ...(optionalString(firstPrompt.timestamp)
            ? { timestamp: firstPrompt.timestamp as string }
            : {}),
        },
        events,
        aiOutputs,
        codeChanges,
        toolCalls,
      },
    ],
  };
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
