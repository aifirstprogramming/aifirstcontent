import { createHash } from "node:crypto";
import { posix } from "node:path";
import type {
  PlanOption,
  PlanQuestion,
  PlanWorkflow,
  Replay,
  ReplayEvent,
  ReplayOperation,
  Scaffold,
  ScaffoldFile,
} from "../../src/types";
import type { ShowtailReport, ShowtailTurn, ShowtailV2Event } from "./showtail";

export type DiagnosticCategory = "direct" | "inferred" | "missing";
export type DiagnosticSeverity = "info" | "warning" | "error";

export interface ImportDiagnostic {
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  field: string;
  message: string;
}

export interface DerivedReplay {
  replay?: Replay;
  scaffold?: Scaffold;
  responsePath?: string;
  diagnostics: ImportDiagnostic[];
}

export interface DeriveReplayOptions {
  report: ShowtailReport;
  reportText: string;
  turnIndex: number;
  sourceFiles: Map<string, string>;
  response: string;
  /**
   * Project chapters often print an excerpt from a larger source file. When set,
   * this identifies that authoritative file instead of requiring a whole-file
   * byte match.
   */
  responsePath?: string;
  responseMatch?: "exact" | "excerpt";
  /** Run a project through this file when the displayed response is a helper module. */
  entrypoint?: string;
  initialFiles?: Map<string, string>;
  initialExerciseId?: string;
  binaryFiles?: ScaffoldFile[];
}

const MUTATING_TOOLS = new Set(["write", "edit"]);
const IGNORED_TOOLS = new Set([
  "askuserquestion",
  "enterplanmode",
  "exitplanmode",
]);

function diagnostic(
  category: DiagnosticCategory,
  severity: DiagnosticSeverity,
  field: string,
  message: string,
): ImportDiagnostic {
  return { category, severity, field, message };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\([^)]*recommended[^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!normalized) return fallback;
  return /^[a-z]/.test(normalized) ? normalized : `option_${normalized}`;
}

function withoutFinalNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

/** Require every nonblank manuscript line to occur in source order. */
export function responseExcerptMatches(response: string, source: string): boolean {
  const expected = withoutFinalNewline(response)
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
  const actual = withoutFinalNewline(source)
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  let cursor = 0;
  for (const line of expected) {
    const found = actual.indexOf(line, cursor);
    if (found < 0) return false;
    cursor = found + 1;
  }
  return expected.length > 0;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function absolutePath(value: string): boolean {
  const normalized = normalizePath(value);
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function safeRelativePath(
  value: string,
  sourcePaths: string[],
): string | undefined {
  const normalized = normalizePath(value);
  const suffixes = sourcePaths.filter(
    (path) => normalized === path || normalized.endsWith(`/${path}`),
  );
  const selected =
    suffixes.sort((left, right) => right.length - left.length)[0] ??
    (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
      ? undefined
      : normalized);
  if (
    !selected ||
    posix.isAbsolute(selected) ||
    selected.split("/").includes("..")
  )
    return undefined;
  return selected;
}

function safeWorkspacePath(
  value: string,
  sourcePaths: string[],
  workspaceRoots: string[],
): string | undefined {
  const sourcePath = safeRelativePath(value, sourcePaths);
  if (sourcePath) return sourcePath;
  const normalized = normalizePath(value);
  for (const root of workspaceRoots) {
    if (!normalized.startsWith(`${root}/`)) continue;
    const relative = normalized.slice(root.length + 1);
    if (
      relative &&
      !posix.isAbsolute(relative) &&
      !relative.split("/").includes("..")
    )
      return relative;
  }
  return undefined;
}

function capturedWorkspaceRoots(
  events: ShowtailV2Event[],
  sourcePaths: string[],
): string[] {
  const roots = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool_use") continue;
    const input = object(event.input);
    const rawPath = string(input?.file_path) ?? string(input?.path);
    if (!rawPath || !absolutePath(rawPath)) continue;
    const normalized = normalizePath(rawPath);
    for (const sourcePath of sourcePaths) {
      if (normalized === sourcePath || !normalized.endsWith(`/${sourcePath}`))
        continue;
      roots.add(normalized.slice(0, -sourcePath.length).replace(/\/$/, ""));
    }
  }
  return [...roots].sort((left, right) => right.length - left.length);
}

function normalizeCommandPaths(command: string, roots: string[]): string {
  let normalized = command.replace(/\\\r?\n/g, "").replace(/\\/g, "/");
  normalized = normalized.replace(
    /^([^\n]+);\s*echo (["'])exit=\$\?\2$/gm,
    (_match, invocation: string, quote: string) =>
      `${invocation} || AIFIRST_REPLAY_STATUS=$?; echo ${quote}exit=\${AIFIRST_REPLAY_STATUS:-0}${quote}; unset AIFIRST_REPLAY_STATUS`,
  );
  const referencedRoots = roots.filter((root) => normalized.includes(root));
  const directoryTargets = [...normalized.matchAll(/\bcd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)].map(
    (match) => match[1]!.replace(/^['"]|['"]$/g, ""),
  );
  const changesDirectory = directoryTargets.some(
    (target) => !referencedRoots.some((root) => target.includes(root)),
  );
  if (changesDirectory && referencedRoots.length > 0) {
    for (const root of referencedRoots)
      normalized = normalized.split(root).join('"$AIFIRST_REPLAY_ROOT"');
    normalized = `AIFIRST_REPLAY_ROOT=$(pwd)\n${normalized}`;
  } else {
    for (const root of roots) normalized = normalized.split(root).join(".");
  }
  normalized = normalized.replace(
    /\bpython(?=\s+(?:--version\b|-c\b|-m\b|[A-Za-z0-9_./-]+\.py\b))/g,
    "python3",
  );
  return normalized.replace(
    /grep -n "([^"]*)\/\[([^"]*)"/g,
    (_match, before: string, after: string) =>
      `grep -Fn "${before}[${after}"`,
  );
}

function capturedWorkspaceOutput(value: string, roots: string[]): boolean {
  const normalized = normalizePath(value);
  return normalized.includes("<workspace>") ||
    normalized.includes("<author-home>") ||
    roots.some((root) => normalized.includes(root));
}

function normalizeOutput(value: string | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n");
}

function stripVolatileGitInspections(command: string): {
  command: string;
  stripped: boolean;
} {
  let stripped = false;
  const lines = command.split("\n").filter((line) => {
    const inspection = /^(?:\s*cd\s+[^&]+&&\s*)?git\s+(?:status|diff|log)\b/.test(
      line,
    );
    if (inspection) stripped = true;
    return !inspection;
  });
  return { command: lines.join("\n").trim(), stripped };
}

function toolResults(events: ShowtailV2Event[]): Map<string, ShowtailV2Event> {
  return new Map(
    events
      .filter((event) => event.type === "tool_result" && event.toolUseId)
      .map((event) => [event.toolUseId!, event]),
  );
}

function parseAnswers(content: unknown): Record<string, string> {
  const direct = object(content);
  if (direct) {
    const values = object(direct.answers) ?? direct;
    return Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  if (typeof content !== "string") return {};
  try {
    return parseAnswers(JSON.parse(content));
  } catch {
    const assigned = [...content.matchAll(/"([^"]+)"\s*=\s*"([^"]+)"/g)].map(
      (match) => [match[1], match[2]] as const,
    );
    return Object.fromEntries(assigned);
  }
}

interface AnswerResolution {
  answer?: string;
  problem?: "ambiguous";
}

function answerFor(
  question: PlanQuestion,
  answers: Record<string, string>,
): AnswerResolution {
  const raw =
    answers[question.question] ??
    answers[question.header] ??
    answers[question.id];
  if (!raw?.trim()) return {};
  const label = raw.trim();
  const exact = question.options.filter(
    (option) => option.label.trim().toLowerCase() === label.toLowerCase(),
  );
  if (exact.length === 1) return { answer: exact[0]!.id };
  if (exact.length > 1) return { problem: "ambiguous" };
  const wanted = slug(raw, "answer");
  const normalized = question.options.filter(
    (option) => slug(option.label, "option") === wanted || option.id === wanted,
  );
  if (normalized.length === 1) return { answer: normalized[0]!.id };
  if (normalized.length > 1) return { problem: "ambiguous" };

  const used = new Set(question.options.map((option) => option.id));
  const base = slug(label, "custom_option").replace(/_+$/, "");
  let id = base;
  for (let suffix = 2; used.has(id); suffix++) id = `${base}_${suffix}`;
  question.options.push({
    id,
    label,
    description: "Captured learner-authored choice.",
  });
  return { answer: id };
}

function questionsFromTool(
  event: ShowtailV2Event,
  askIndex: number,
  usedQuestionIds: Set<string>,
  usedOptionIds: Map<string, Set<string>>,
): PlanQuestion[] {
  const input = object(event.input);
  const rawQuestions = Array.isArray(input?.questions) ? input.questions : [];
  const grouped = rawQuestions.length > 1 ? `group_${askIndex + 1}` : undefined;
  return rawQuestions.map((rawQuestion, questionIndex) => {
    const item = object(rawQuestion) ?? {};
    const question =
      string(item.question) ?? `Question ${askIndex + 1}.${questionIndex + 1}`;
    const header = string(item.header) ?? `Question ${askIndex + 1}`;
    let id = slug(header, `question_${askIndex + 1}_${questionIndex + 1}`);
    for (let suffix = 2; usedQuestionIds.has(id); suffix++)
      id = `${slug(header, "question")}_${suffix}`;
    usedQuestionIds.add(id);
    const optionIds = new Set<string>();
    usedOptionIds.set(id, optionIds);
    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const options: PlanOption[] = rawOptions.map((rawOption, optionIndex) => {
      const option = object(rawOption) ?? {};
      const label = string(option.label) ?? `Option ${optionIndex + 1}`;
      let optionId = slug(label, `option_${optionIndex + 1}`);
      for (let suffix = 2; optionIds.has(optionId); suffix++)
        optionId = `${slug(label, "option")}_${suffix}`;
      optionIds.add(optionId);
      return {
        id: optionId,
        label: label.replace(/\s*\([^)]*recommended[^)]*\)\s*$/i, ""),
        description: string(option.description) ?? label,
      };
    });
    return {
      id,
      question,
      header: header.slice(0, 12),
      options,
      ...(grouped ? { group: grouped } : {}),
    };
  });
}

function statusText(event: ShowtailV2Event): string {
  const input = object(event.input);
  const detail =
    string(input?.description) ?? string(input?.name) ?? string(input?.prompt);
  return detail ? `${event.toolName}(${detail})` : (event.toolName ?? "Tool");
}

function isExternalPathTool(
  event: ShowtailV2Event,
  sourcePaths: string[],
): boolean {
  const name = event.toolName?.toLowerCase();
  if (name !== "write" && name !== "edit" && name !== "read") return false;
  const input = object(event.input);
  const rawPath = string(input?.file_path) ?? string(input?.path);
  return Boolean(
    rawPath && absolutePath(rawPath) && !safeRelativePath(rawPath, sourcePaths),
  );
}

function operationFromTool(
  event: ShowtailV2Event,
  result: ShowtailV2Event | undefined,
  sourcePaths: string[],
  workspaceRoots: string[],
  readOnly: boolean,
  diagnostics: ImportDiagnostic[],
): ReplayOperation | undefined {
  const name = event.toolName?.toLowerCase();
  const input = object(event.input) ?? {};
  if (
    !name ||
    IGNORED_TOOLS.has(name) ||
    name === "agent" ||
    name === "background task"
  )
    return undefined;
  if (name === "write") {
    const rawPath = string(input.file_path) ?? string(input.path);
    const content = string(input.content);
    const path = rawPath ? safeRelativePath(rawPath, sourcePaths) : undefined;
    if (!path && rawPath && absolutePath(rawPath)) {
      diagnostics.push(
        diagnostic(
          "direct",
          "info",
          "externalWrite",
          `Ignored non-workspace Write: ${rawPath}`,
        ),
      );
      return undefined;
    }
    if (!path || content === undefined) {
      diagnostics.push(
        diagnostic(
          "missing",
          "error",
          "tool_use.Write",
          "Write requires a safe path and full content",
        ),
      );
      return undefined;
    }
    return { type: "write", path, content };
  }
  if (name === "edit") {
    const rawPath = string(input.file_path) ?? string(input.path);
    const path = rawPath ? safeRelativePath(rawPath, sourcePaths) : undefined;
    const oldText = string(input.old_string) ?? string(input.oldText);
    const newText = string(input.new_string) ?? string(input.newText);
    if (!path && rawPath && absolutePath(rawPath)) {
      diagnostics.push(
        diagnostic(
          "direct",
          "info",
          "externalEdit",
          `Ignored non-workspace Edit: ${rawPath}`,
        ),
      );
      return undefined;
    }
    if (!path || oldText === undefined || newText === undefined) {
      diagnostics.push(
        diagnostic(
          "missing",
          "error",
          "tool_use.Edit",
          "Edit requires a safe path plus old and new text",
        ),
      );
      return undefined;
    }
    return {
      type: "edit",
      path,
      oldText,
      newText,
      ...(input.replace_all === true || input.replaceAll === true
        ? { replaceAll: true }
        : {}),
    };
  }
  if (name === "read") {
    const rawPath = string(input.file_path) ?? string(input.path);
    const path = rawPath
      ? safeWorkspacePath(rawPath, sourcePaths, workspaceRoots)
      : undefined;
    if (!path && rawPath && absolutePath(rawPath)) {
      diagnostics.push(
        diagnostic(
          "direct",
          "info",
          "externalRead",
          `Preserved non-workspace Read as status: ${rawPath}`,
        ),
      );
      return undefined;
    }
    if (!path) {
      diagnostics.push(
        diagnostic(
          "missing",
          "error",
          "tool_use.Read",
          "Read requires a safe workspace-relative path",
        ),
      );
      return undefined;
    }
    return { type: "read", path };
  }
  if (name === "bash" || name === "shell" || name === "powershell") {
    const rawCommand = string(input.command);
    const portable = rawCommand
      ? stripVolatileGitInspections(rawCommand)
      : undefined;
    const command = portable?.command
      ? normalizeCommandPaths(portable.command, workspaceRoots)
      : undefined;
    if (portable?.stripped) {
      diagnostics.push(
        diagnostic(
          "inferred",
          "info",
          "tool_use.Bash",
          "Removed environment-specific git inspection from replay command",
        ),
      );
      if (!command) return undefined;
    }
    if (!command) {
      diagnostics.push(
        diagnostic(
          "missing",
          "error",
          "tool_use.Bash",
          "Shell tool input is missing command text",
        ),
      );
      return undefined;
    }
    const exitCode =
      result?.exitCode ?? (result?.isError === false ? 0 : undefined);
    if (!result || exitCode === undefined) {
      diagnostics.push(
        diagnostic(
          "missing",
          "error",
          "tool_result.exitCode",
          "Shell replay requires a structured exit code",
        ),
      );
      return undefined;
    }
    if (result.exitCode === undefined) {
      diagnostics.push(
        diagnostic(
          "inferred",
          "info",
          "tool_result.exitCode",
          "Successful shell result implies exit code 0",
        ),
      );
    }
    const stdout = normalizeOutput(result.stdout);
    const stderr = normalizeOutput(result.stderr);
    const volatileTestTiming = /\bRan \d+ tests? in \d+(?:\.\d+)?s\b/.test(stdout);
    const volatileRuntimeOutput =
      /(?:^|\n)Python \d+\.\d+|(?:^|\n)pygame(?:-ce)? \d+\.\d+|Hello from the pygame community/.test(
        stdout,
      );
    const volatileDirectoryListing = /(?:^|&&\s*)ls\s+-la(?:\s|$)/.test(
      command,
    );
    const volatileStdoutPath = capturedWorkspaceOutput(stdout, workspaceRoots);
    const volatileStderrPath = capturedWorkspaceOutput(stderr, workspaceRoots);
    if (volatileTestTiming) {
      diagnostics.push(
        diagnostic(
          "inferred",
          "info",
          "tool_result.stdout",
          "Ignored volatile unittest duration while preserving exit-code verification",
        ),
      );
    }
    if (volatileRuntimeOutput) {
      diagnostics.push(
        diagnostic(
          "inferred",
          "info",
          "tool_result.stdout",
          "Ignored environment-specific Python/pygame version output while preserving exit-code verification",
        ),
      );
    }
    if (volatileDirectoryListing) {
      diagnostics.push(
        diagnostic(
          "inferred",
          "info",
          "tool_result.stdout",
          "Ignored environment-specific directory listing while preserving exit-code verification",
        ),
      );
    }
    if (volatileStdoutPath || volatileStderrPath) {
      diagnostics.push(
        diagnostic(
          "inferred",
          "info",
          "tool_result.output",
          "Ignored captured authoring workspace paths while preserving exit-code verification",
        ),
      );
    }
    return {
      type: "command",
      command: ["bash", "-lc", command],
      ...(readOnly ? { readOnly: true } : {}),
      expectedExitCode: exitCode,
      ...(!readOnly
        ? {
            ...(!volatileTestTiming &&
            !volatileRuntimeOutput &&
            !volatileDirectoryListing &&
            !volatileStdoutPath
              ? { expectedStdout: stdout }
              : {}),
            ...(!volatileStderrPath ? { expectedStderr: stderr } : {}),
          }
        : {}),
    };
  }
  return undefined;
}

function replayEvents(
  events: ShowtailV2Event[],
  sourcePaths: string[],
  workspaceRoots: string[],
  diagnostics: ImportDiagnostic[],
  readOnly: boolean,
): ReplayEvent[] {
  const results = toolResults(events);
  const out: ReplayEvent[] = [];
  for (const event of events) {
    if (event.type === "assistant_text" && event.text)
      out.push({ type: "text", text: event.text });
    if (event.type !== "tool_use") continue;
    const operation = operationFromTool(
      event,
      event.toolUseId ? results.get(event.toolUseId) : undefined,
      sourcePaths,
      workspaceRoots,
      readOnly,
      diagnostics,
    );
    if (operation) out.push({ type: "operation", operation });
    else if (
      event.toolName &&
      !IGNORED_TOOLS.has(event.toolName.toLowerCase()) &&
      !isExternalPathTool(event, sourcePaths)
    ) {
      out.push({ type: "status", text: statusText(event) });
    }
  }
  return out;
}

function lastAssistantAsCompletion(events: ReplayEvent[]): {
  events: ReplayEvent[];
  completionText?: string;
} {
  let lastOperation = -1;
  events.forEach((event, index) => {
    if (event.type === "operation") lastOperation = index;
  });
  for (let index = events.length - 1; index > lastOperation; index--) {
    const event = events[index];
    if (event.type === "text") {
      const completionText = event.text;
      return {
        events: events.filter((_, eventIndex) => eventIndex !== index),
        completionText,
      };
    }
  }
  return { events };
}

function deriveWorkflow(
  turn: ShowtailTurn,
  sourcePaths: string[],
  workspaceRoots: string[],
  diagnostics: ImportDiagnostic[],
): {
  workflow?: PlanWorkflow;
  prePlanEvents?: ReplayEvent[];
  replayStart: number;
} {
  const events = turn.events ?? [];
  const asks = events.filter(
    (event) =>
      event.type === "tool_use" &&
      event.toolName?.toLowerCase() === "askuserquestion",
  );
  const approval = events.find((event) => event.type === "plan_approved");
  const planEvent = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "plan_snapshot" &&
        event.plan &&
        (!approval || event.sequence < approval.sequence),
    );
  if (asks.length === 0 && !planEvent && !approval) return { replayStart: 0 };
  const results = toolResults(events);
  const usedQuestionIds = new Set<string>();
  const usedOptionIds = new Map<string, Set<string>>();
  const questions: PlanQuestion[] = [];
  const canonicalAnswers: Record<string, string> = {};
  const interludes: NonNullable<PlanWorkflow["interludes"]> = [];
  const priorAnswers: Record<string, string> = {};
  for (let askIndex = 0; askIndex < asks.length; askIndex++) {
    const ask = asks[askIndex];
    const derived = questionsFromTool(
      ask,
      askIndex,
      usedQuestionIds,
      usedOptionIds,
    );
    const result = ask.toolUseId ? results.get(ask.toolUseId) : undefined;
    const answers = parseAnswers(result?.content);
    for (const question of derived) {
      if (askIndex > 0) question.when = { ...priorAnswers };
      const resolution = answerFor(question, answers);
      if (resolution.problem === "ambiguous")
        diagnostics.push(
          diagnostic(
            "missing",
            "error",
            `workflow.answers.${question.id}`,
            "AskUserQuestion answer matches more than one offered option",
          ),
        );
      else if (!resolution.answer)
        diagnostics.push(
          diagnostic(
            "missing",
            "error",
            `workflow.answers.${question.id}`,
            "AskUserQuestion result does not identify the selected option",
          ),
        );
      else {
        canonicalAnswers[question.id] = resolution.answer;
        priorAnswers[question.id] = resolution.answer;
      }
      questions.push(question);
    }
    if (!result || derived.length === 0) continue;
    const nextAskSequence =
      asks[askIndex + 1]?.sequence ?? Number.POSITIVE_INFINITY;
    const boundary =
      events.find(
        (event) =>
          event.type === "plan_snapshot" || event.type === "plan_approved",
      )?.sequence ?? Number.POSITIVE_INFINITY;
    const between = events.filter(
      (event) =>
        event.sequence > result.sequence &&
        event.sequence < Math.min(nextAskSequence, boundary),
    );
    const captured = replayEvents(
      between,
      sourcePaths,
      workspaceRoots,
      diagnostics,
      true,
    );
    if (captured.length > 0)
      interludes.push({ afterQuestion: derived.at(-1)!.id, events: captured });
  }
  if (!planEvent?.plan)
    diagnostics.push(
      diagnostic(
        "missing",
        "error",
        "workflow.canonicalPlan",
        "No plan snapshot was exported",
      ),
    );
  if (!approval)
    diagnostics.push(
      diagnostic(
        "missing",
        "error",
        "workflow.approval",
        "No plan approval boundary was exported",
      ),
    );
  const planningBoundary =
    asks[0]?.sequence ??
    planEvent?.sequence ??
    approval?.sequence ??
    0;
  const prePlanEvents = replayEvents(
    events.filter((event) => event.sequence < planningBoundary),
    sourcePaths,
    workspaceRoots,
    diagnostics,
    true,
  );
  return {
    workflow: planEvent?.plan
      ? {
          questions,
          canonicalAnswers,
          canonicalPlan: planEvent.plan,
          ...(interludes.length > 0 ? { interludes } : {}),
        }
      : undefined,
    ...(prePlanEvents.length > 0 ? { prePlanEvents } : {}),
    replayStart: approval ? approval.sequence + 1 : Number.POSITIVE_INFINITY,
  };
}

function fallbackOperations(
  sourceFiles: Map<string, string>,
  events: ReplayEvent[],
): ReplayOperation[] {
  const writes: ReplayOperation[] = [...sourceFiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ type: "write", path, content }));
  let lastMutation = -1;
  events.forEach((event, index) => {
    if (
      event.type === "operation" &&
      (event.operation.type === "write" || event.operation.type === "edit")
    )
      lastMutation = index;
  });
  const verification = events
    .slice(lastMutation + 1)
    .filter(
      (event): event is Extract<ReplayEvent, { type: "operation" }> =>
        event.type === "operation" && event.operation.type === "command",
    )
    .map((event) => event.operation);
  return [...writes, ...verification];
}

function replayNeedsInitialState(
  initialFiles: Map<string, string> | undefined,
  events: ReplayEvent[],
): boolean {
  if (!initialFiles || initialFiles.size === 0) return false;
  const created = new Set<string>();
  for (const event of events) {
    if (event.type !== "operation") continue;
    const operation = event.operation;
    if (
      (operation.type === "read" || operation.type === "edit") &&
      !created.has(operation.path) &&
      initialFiles.has(operation.path)
    ) return true;
    if (operation.type === "write" || operation.type === "edit") {
      created.add(operation.path);
    }
  }
  return false;
}

function validateFinalState(
  initialFiles: Map<string, string> | undefined,
  events: ReplayEvent[],
  sourceFiles: Map<string, string>,
): { problems: string[]; needsInitialState: boolean } {
  const state = new Map(initialFiles ?? []);
  const problems: string[] = [];
  let needsInitialState = false;
  for (const event of events) {
    if (event.type !== "operation") continue;
    const operation = event.operation;
    if (operation.type === "write")
      state.set(operation.path, operation.content);
    if (operation.type === "edit") {
      const current = state.get(operation.path);
      if (current === undefined && !initialFiles) {
        needsInitialState = true;
        continue;
      }
      if (current === undefined || !current.includes(operation.oldText))
        problems.push(
          `${operation.path}: captured edit does not apply to the initial state`,
        );
      else
        state.set(
          operation.path,
          operation.replaceAll
            ? current.split(operation.oldText).join(operation.newText)
            : current.replace(operation.oldText, operation.newText),
        );
    }
  }
  if (!needsInitialState)
    for (const [path, content] of sourceFiles)
      if (state.get(path) !== content)
        problems.push(`${path}: replay result differs from supplied source`);
  return { problems, needsInitialState };
}

export function auditLegacyReport(report: ShowtailReport): ImportDiagnostic[] {
  if (report.schemaVersion === 2) return [];
  return [
    diagnostic(
      "direct",
      "info",
      "prompt",
      "Prompt and assistant display text are available",
    ),
    diagnostic(
      "inferred",
      "warning",
      "eventOrder",
      "Ordering can only be merged from independent timestamps",
    ),
    diagnostic(
      "missing",
      "error",
      "operations",
      "Write/Edit inputs and structured command results are not present",
    ),
    diagnostic(
      "missing",
      "error",
      "workflow",
      "Questions, answers, plan snapshots, and approval boundaries are not present",
    ),
  ];
}

export function deriveReplay(options: DeriveReplayOptions): DerivedReplay {
  const diagnostics: ImportDiagnostic[] = [];
  const turn = options.report.turns[options.turnIndex];
  if (!turn)
    return {
      diagnostics: [
        diagnostic(
          "missing",
          "error",
          "turn",
          `Turn ${options.turnIndex} does not exist`,
        ),
      ],
    };
  if (options.report.schemaVersion !== 2 || !turn.events)
    return { diagnostics: auditLegacyReport(options.report) };
  const sourcePaths = [...options.sourceFiles.keys()].sort();
  const workspaceRoots = capturedWorkspaceRoots(turn.events, sourcePaths);
  const responseMatches = options.responsePath
    ? (() => {
        const content = options.sourceFiles.get(options.responsePath!);
        if (content === undefined) return [];
        const matches = options.responseMatch === "excerpt"
          ? responseExcerptMatches(options.response, content)
          : withoutFinalNewline(content) === withoutFinalNewline(options.response);
        return matches ? [options.responsePath!] : [];
      })()
    : sourcePaths.filter(
        (path) =>
          withoutFinalNewline(options.sourceFiles.get(path)!) ===
          withoutFinalNewline(options.response),
      );
  if (responseMatches.length !== 1)
    diagnostics.push(
      diagnostic(
        "missing",
        "error",
        "responsePath",
        options.responsePath
          ? `The declared response source ${options.responsePath} does not match the manuscript ${options.responseMatch ?? "exact"} response`
          : `Expected one source file matching the manuscript response; found ${responseMatches.length}`,
      ),
    );
  const workflow = deriveWorkflow(
    turn,
    sourcePaths,
    workspaceRoots,
    diagnostics,
  );
  const postApproval = turn.events.filter(
    (event) => event.sequence >= workflow.replayStart,
  );
  const rawReplayEvents = replayEvents(
    postApproval,
    sourcePaths,
    workspaceRoots,
    diagnostics,
    false,
  );
  const completion = lastAssistantAsCompletion(rawReplayEvents);
  const finalState = validateFinalState(
    options.initialFiles,
    completion.events,
    options.sourceFiles,
  );
  for (const problem of finalState.problems)
    diagnostics.push(diagnostic("inferred", "error", "finalState", problem));
  if (finalState.needsInitialState) {
    diagnostics.push(
      diagnostic(
        "inferred",
        "warning",
        "initialState",
        "Edit replay could not be validated because no preceding exercise state matched",
      ),
    );
  }
  if (
    completion.events.filter((event) => event.type === "operation").length === 0
  )
    diagnostics.push(
      diagnostic(
        "missing",
        "error",
        "events",
        "No executable post-approval operations were captured",
      ),
    );
  const hasErrors = diagnostics.some((item) => item.severity === "error");
  if (hasErrors) return { diagnostics };
  const reportSha256 = createHash("sha256")
    .update(options.reportText)
    .digest("hex");
  const needsInitialState = replayNeedsInitialState(options.initialFiles, [
    ...(workflow.prePlanEvents ?? []),
    ...(workflow.workflow?.interludes ?? []).flatMap((interlude) => interlude.events),
    ...completion.events,
  ]);
  const replay: Replay = {
    prompt: turn.prompt.text,
    ...(options.initialExerciseId && needsInitialState
      ? { initialState: { fromExercise: options.initialExerciseId } }
      : {}),
    operations: fallbackOperations(options.sourceFiles, completion.events),
    ...(workflow.prePlanEvents
      ? { prePlanEvents: workflow.prePlanEvents }
      : {}),
    events: completion.events,
    ...(completion.completionText
      ? { completionText: completion.completionText }
      : {}),
    ...(workflow.workflow ? { workflow: workflow.workflow } : {}),
    source: {
      kind: "showtail",
      reportSha256,
      generatedAt: options.report.generatedAt,
      turnIndex: options.turnIndex,
      ...(options.report.sessionId
        ? { sessionId: options.report.sessionId }
        : {}),
    },
  };
  const scaffold: Scaffold = {
    files: [
      ...[...options.sourceFiles.entries()].map(([path, content]) => ({ path, content })),
      ...(options.binaryFiles ?? []),
    ].sort((left, right) => left.path.localeCompare(right.path)),
    entrypoint: options.entrypoint ?? responseMatches[0],
  };
  diagnostics.push(
    diagnostic(
      "direct",
      "info",
      "assistantText",
      "Assistant text and raw tool events were imported directly",
    ),
  );
  diagnostics.push(
    diagnostic(
      "direct",
      "info",
      "sourceFiles",
      "Final files came from the supplied source directory",
    ),
  );
  diagnostics.push(
    diagnostic(
      "inferred",
      "info",
      "workflow.when",
      "Later question calls depend conservatively on prior canonical answers",
    ),
  );
  return { replay, scaffold, responsePath: responseMatches[0], diagnostics };
}
