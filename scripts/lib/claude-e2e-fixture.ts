/** Generate one test-only progressive book from a Claude/Showtail capture. */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { RawBook, RawPromptStep } from "../../src/types";
import { deriveReplay, type ImportDiagnostic } from "./import-showtail";
import { parseShowtailReport } from "./showtail";

export interface ClaudeE2ETurn {
  prompt: string;
  responsePath: string;
  source: string;
}

export interface ClaudeE2ECapture {
  schemaVersion: 1;
  id: string;
  exerciseId: string;
  title: string;
  turns: ClaudeE2ETurn[];
  [key: string]: unknown;
}

export interface ClaudeE2EFixtureResult {
  capture?: ClaudeE2ECapture;
  book?: RawBook;
  diagnostics: ImportDiagnostic[];
}

function error(field: string, message: string): ImportDiagnostic {
  return { category: "missing", severity: "error", field, message };
}

function captureManifest(value: unknown): ClaudeE2ECapture {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("capture.json must contain an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new Error("capture.schemaVersion must be 1");
  for (const field of ["id", "exerciseId", "title"])
    if (typeof raw[field] !== "string" || raw[field] === "")
      throw new Error(`capture.${field} must be a non-empty string`);
  if (!Array.isArray(raw.turns) || raw.turns.length === 0)
    throw new Error("capture.turns must be a non-empty array");
  const turns = raw.turns.map((value, index): ClaudeE2ETurn => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`capture.turns[${index}] must be an object`);
    const turn = value as Record<string, unknown>;
    for (const field of ["prompt", "responsePath", "source"])
      if (typeof turn[field] !== "string" || turn[field] === "")
        throw new Error(
          `capture.turns[${index}].${field} must be a non-empty string`,
        );
    return {
      prompt: turn.prompt as string,
      responsePath: turn.responsePath as string,
      source: turn.source as string,
    };
  });
  return { ...(raw as ClaudeE2ECapture), turns };
}

function sourceFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if ([".claude", ".showtail", "__pycache__"].includes(entry.name))
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else
        files.set(
          relative(root, path).replace(/\\/g, "/"),
          readFileSync(path, "utf8"),
        );
    }
  };
  visit(root);
  return files;
}

function response(files: Map<string, string>, path: string): string | undefined {
  const value = files.get(path);
  if (value === undefined) return undefined;
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

export function generateClaudeE2EFixture(
  fixture: string,
): ClaudeE2EFixtureResult {
  let capture: ClaudeE2ECapture;
  try {
    capture = captureManifest(
      JSON.parse(readFileSync(join(fixture, "capture.json"), "utf8")),
    );
  } catch (cause) {
    return {
      diagnostics: [
        error(
          "capture.json",
          cause instanceof Error ? cause.message : String(cause),
        ),
      ],
    };
  }

  const reportPath = join(fixture, "bundle", "report.json");
  const reportText = readFileSync(reportPath, "utf8");
  const report = parseShowtailReport(JSON.parse(reportText));
  const diagnostics: ImportDiagnostic[] = [];
  const prompts: RawPromptStep[] = [];
  let initialFiles = new Map<string, string>();
  for (let index = 0; index < capture.turns.length; index++) {
    const turn = capture.turns[index]!;
    const matches = report.turns.flatMap((candidate, reportIndex) =>
      candidate.prompt.text === turn.prompt ? [reportIndex] : [],
    );
    if (matches.length !== 1) {
      diagnostics.push(
        error(
          `turns[${index}].prompt`,
          `Expected one exact Showtail prompt match; found ${matches.length}`,
        ),
      );
      continue;
    }
    const reportIndex = matches[0]!;
    const files = sourceFiles(join(fixture, turn.source));
    const primary = response(files, turn.responsePath);
    if (primary === undefined) {
      diagnostics.push(
        error(
          `turns[${index}].responsePath`,
          `${turn.responsePath} is missing from the source checkpoint`,
        ),
      );
      continue;
    }
    const derived = deriveReplay({
      report,
      reportText,
      turnIndex: reportIndex,
      sourceFiles: files,
      response: primary,
      initialFiles,
    });
    diagnostics.push(...derived.diagnostics);
    if (derived.replay && derived.scaffold)
      prompts.push({
        id: `${capture.exerciseId}.${index + 1}`,
        prompt: turn.prompt,
        response: primary,
        scaffold: derived.scaffold,
        replay: derived.replay,
      });
    initialFiles = files;
  }

  if (
    diagnostics.some((item) => item.severity === "error") ||
    prompts.length !== capture.turns.length
  )
    return { capture, diagnostics };

  return {
    capture,
    diagnostics,
    book: {
      title: `AI First Claude E2E: ${capture.title}`,
      tag: "py",
      language: "python",
      sections: [
        {
          title: "Integration Tests",
          chapters: [
            {
              title: "Chapter 98 - Claude Showtail E2E",
              examples: [
                {
                  id: capture.exerciseId,
                  title: capture.title,
                  kind: "project",
                  prompts,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
