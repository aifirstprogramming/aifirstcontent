/** Remove author-machine identity and paths without changing replay semantics. */

import type { ShowtailReport, ShowtailTurn, ShowtailV2Event } from "./showtail";

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function relativeSourcePath(value: string, sourcePaths: string[]): string | undefined {
  const normalized = normalizePath(value);
  const matches = sourcePaths
    .filter((path) => normalized === path || normalized.endsWith(`/${path}`))
    .sort((left, right) => right.length - left.length);
  const selected = matches[0] ?? (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)
    ? normalized
    : undefined);
  if (!selected || selected.split("/").includes("..")) return undefined;
  return selected;
}

function relativeWorkspacePath(value: string, roots: string[]): string | undefined {
  const normalized = normalizePath(value);
  for (const root of roots) {
    if (normalized === root) return ".";
    if (!normalized.startsWith(`${root}/`)) continue;
    const relative = normalized.slice(root.length + 1);
    if (relative && !relative.split("/").includes("..")) return relative;
  }
  return undefined;
}

function workspaceRoots(events: ShowtailV2Event[], sourcePaths: string[]): string[] {
  const roots = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool_use") continue;
    const input = object(event.input);
    const rawPath = typeof input?.file_path === "string"
      ? input.file_path
      : typeof input?.path === "string"
        ? input.path
        : undefined;
    if (!rawPath) continue;
    const normalized = normalizePath(rawPath);
    for (const sourcePath of sourcePaths) {
      if (normalized === sourcePath || !normalized.endsWith(`/${sourcePath}`)) continue;
      roots.add(normalized.slice(0, -sourcePath.length).replace(/\/$/, ""));
    }
  }
  return [...roots].sort((left, right) => right.length - left.length);
}

function replaceRoots(value: string, roots: string[], replacement: string): string {
  let sanitized = value;
  for (const root of roots) {
    sanitized = sanitized.split(root).join(replacement);
    sanitized = sanitized.split(root.replace(/\//g, "\\")).join(replacement);
  }
  return sanitized;
}

function replaceIdentityTokens(value: string, tokens: string[]): string {
  let sanitized = value;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    sanitized = sanitized.replace(new RegExp(escaped, "gi"), "author");
  }
  return sanitized;
}

function sanitizeText(value: string, roots: string[], tokens: string[]): string {
  return replaceIdentityTokens(replaceRoots(value, roots, "<workspace>"), tokens)
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+\\\.claude\\plans\\[^\s"'`]+/gi, "<captured-plan>")
    .replace(/\/Users\/[^/\s"'`]+\/\.claude\/plans\/[^\s"'`]+/g, "<captured-plan>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/gi, "<author-home>")
    .replace(/\/Users\/[^/\s"'`]+/g, "<author-home>")
    .replace(/\/home\/[^/\s"'`]+/g, "<author-home>")
    .replace(/(^|\n)([dl-][rwx-]{9}\s+\d+\s+)[A-Za-z0-9._-]+(\s+\d+\s+)/g, "$1$2author$3")
    .replace(/\b[a-z0-9._-]+-at-(?:gmail|outlook|yahoo|protonmail)-com\b/gi, "author");
}

function sanitizeCommand(value: string, roots: string[], tokens: string[]): string {
  return replaceIdentityTokens(replaceRoots(value, roots, "."), tokens)
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+\\\.claude\\plans\\[^\s"'`]+/gi, "<captured-plan>")
    .replace(/\/Users\/[^/\s"'`]+\/\.claude\/plans\/[^\s"'`]+/g, "<captured-plan>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/gi, "<author-home>")
    .replace(/\/Users\/[^/\s"'`]+/g, "<author-home>")
    .replace(/\/home\/[^/\s"'`]+/g, "<author-home>");
}

function sanitizeValue(value: unknown, roots: string[], tokens: string[]): unknown {
  if (typeof value === "string") return sanitizeText(value, roots, tokens);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, roots, tokens));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, sanitizeValue(item, roots, tokens)]),
  );
}

function sanitizeEvents(
  events: ShowtailV2Event[],
  sourcePaths: string[],
  tokens: string[],
): ShowtailV2Event[] {
  const roots = workspaceRoots(events, sourcePaths);
  const droppedToolIds = new Set<string>();
  const out: ShowtailV2Event[] = [];
  for (const event of events) {
    if (event.type === "tool_use") {
      const name = event.toolName?.toLowerCase();
      const input = object(event.input) ?? {};
      if (name === "read" || name === "write" || name === "edit") {
        const rawPath = typeof input.file_path === "string"
          ? input.file_path
          : typeof input.path === "string"
            ? input.path
            : undefined;
        const path = rawPath
          ? relativeSourcePath(rawPath, sourcePaths) ?? relativeWorkspacePath(rawPath, roots)
          : undefined;
        if (!path) {
          if (event.toolUseId) droppedToolIds.add(event.toolUseId);
          continue;
        }
        const cleaned = sanitizeValue(input, roots, tokens) as Record<string, unknown>;
        delete cleaned.path;
        cleaned.file_path = path;
        out.push({ ...event, input: cleaned });
        continue;
      }
      if ((name === "bash" || name === "shell" || name === "powershell") && typeof input.command === "string") {
        out.push({ ...event, input: { ...input, command: sanitizeCommand(input.command, roots, tokens) } });
        continue;
      }
      out.push({ ...event, ...(event.input === undefined ? {} : { input: sanitizeValue(event.input, roots, tokens) }) });
      continue;
    }
    if (event.type === "tool_result") {
      if (event.toolUseId && droppedToolIds.has(event.toolUseId)) continue;
      out.push({
        ...event,
        ...(event.content === undefined ? {} : { content: sanitizeValue(event.content, roots, tokens) }),
        ...(event.stdout === undefined ? {} : { stdout: sanitizeText(event.stdout, roots, tokens) }),
        ...(event.stderr === undefined ? {} : { stderr: sanitizeText(event.stderr, roots, tokens) }),
      });
      continue;
    }
    out.push({
      ...event,
      ...(event.text === undefined ? {} : { text: sanitizeText(event.text, roots, tokens) }),
      ...(event.plan === undefined ? {} : { plan: sanitizeText(event.plan, roots, tokens) }),
    });
  }
  return out.map((event, sequence) => ({ ...event, sequence }));
}

function sanitizeTurn(turn: ShowtailTurn, sourcePaths: string[], tokens: string[]): ShowtailTurn {
  const events = turn.events ? sanitizeEvents(turn.events, sourcePaths, tokens) : undefined;
  const roots = turn.events ? workspaceRoots(turn.events, sourcePaths) : [];
  return {
    prompt: {
      ...turn.prompt,
      text: sanitizeText(turn.prompt.text, roots, tokens),
    },
    ...(events ? { events } : {}),
    aiOutputs: turn.aiOutputs.map((item) => ({ ...item, text: sanitizeText(item.text, roots, tokens) })),
    codeChanges: turn.codeChanges.map((change) => ({
      ...change,
      path: relativeSourcePath(change.path, sourcePaths) ?? sanitizeText(change.path, roots, tokens),
      ...(change.diff === undefined ? {} : { diff: sanitizeText(change.diff, roots, tokens) }),
    })),
    toolCalls: turn.toolCalls.map((call) => ({ ...call, text: sanitizeText(call.text, roots, tokens) })),
  };
}

function identityTokens(report: ShowtailReport): string[] {
  const text = JSON.stringify(report);
  const tokens = new Set<string>();
  const patterns = [
    /[A-Za-z]:[\\/]+Users[\\/]+([A-Za-z0-9._-]+)/g,
    /\/(?:Users|home)\/([A-Za-z0-9._-]+)/g,
    /C--Users-([A-Za-z0-9._-]+)/g,
  ];
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern))
      if (match[1] && match[1] !== "author") tokens.add(match[1]);
  return [...tokens];
}

export function sanitizeShowtailReport(
  report: ShowtailReport,
  sourcePaths: string[],
): ShowtailReport {
  const tokens = identityTokens(report);
  return {
    ...report,
    turns: report.turns.map((turn) => sanitizeTurn(turn, sourcePaths, tokens)),
  };
}
