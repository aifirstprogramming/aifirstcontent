/**
 * Loads book JSON into the normalized `Content` shape.
 *
 * Deliberately split so the content can come from disk (the extension, and the
 * CLI's refreshable pack) or from already-parsed objects (the CLI's binary-
 * embedded pack, where there is no readable directory). Only
 * `loadFromDirectory` touches the filesystem.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  Book,
  Chapter,
  Content,
  Example,
  Language,
  RawBook,
  RawExample,
  RawResponse,
  Section,
  Step,
} from "./types";

/**
 * Collapse the two authored response forms into one string.
 *
 * Arrays are joined with "\n" — the same normalization the VS Code extension has
 * always applied, so responses stay byte-identical to what readers have seen.
 */
export function normalizeResponse(response: RawResponse | undefined): string {
  if (response === undefined) return "";
  return Array.isArray(response) ? response.join("\n") : response;
}

/**
 * Language is derived from the filename, matching the extension's long-standing
 * behavior (`ai-first-python-programming.json` -> python).
 */
export function languageFromFilename(filename: string): Language | undefined {
  const lower = basename(filename).toLowerCase();
  if (lower.includes("python")) return "python";
  if (lower.includes("java")) return "java";
  return undefined;
}

/** "ai-first-python-programming.json" -> "ai-first-python-programming" */
export function bookIdFromFilename(filename: string): string {
  return basename(filename).replace(/\.json$/i, "");
}

/** "Chapter 12: Project: Mobile Voice Journal" -> 12 (0 when unparseable). */
export function chapterNumberFromTitle(title: string): number {
  const m = title.match(/chapter\s+(\d+)/i);
  return m ? Number(m[1]) : 0;
}

export interface RawEntry {
  filename: string;
  book: RawBook;
}

export interface LoadOptions {
  /** Content pack version, surfaced by `aifirst doctor`. */
  version?: string;
  /**
   * Throw when an example lacks an id instead of skipping it. The CLI and
   * extension both pass true; only tooling that inspects half-authored content
   * wants the lenient path.
   */
  strict?: boolean;
}

/** Build normalized content from already-parsed book JSON. */
export function loadFromRaw(entries: RawEntry[], options: LoadOptions = {}): Content {
  const strict = options.strict ?? true;
  const books: Book[] = [];
  const examples: Example[] = [];
  const steps: Step[] = [];

  for (const { filename, book: raw } of [...entries].sort((a, b) => a.filename.localeCompare(b.filename))) {
    const language = languageFromFilename(filename);
    if (!language) {
      if (strict) throw new Error(`Cannot derive a language from book filename "${filename}"`);
      continue;
    }
    const bookId = bookIdFromFilename(filename);
    const sections: Section[] = [];

    for (const rawSection of raw.sections ?? []) {
      const chapters: Chapter[] = [];

      for (const rawChapter of rawSection.chapters ?? []) {
        const chapterNumber = chapterNumberFromTitle(rawChapter.title);
        const chapterExamples: Example[] = [];

        for (const rawExample of rawChapter.examples ?? []) {
          if (!rawExample.id) {
            if (strict) {
              throw new Error(
                `Example "${rawExample.title}" in ${filename} / ${rawChapter.title} has no id. ` +
                  `Run "bun scripts/add-ids.ts" in the content repo.`,
              );
            }
            continue;
          }

          const example: Example = {
            id: rawExample.id,
            title: rawExample.title,
            description: rawExample.description,
            language,
            steps: [],
            multiStep: Array.isArray(rawExample.prompts) && rawExample.prompts.length > 0,
            bookId,
            bookTitle: raw.title,
            sectionTitle: rawSection.title,
            chapterTitle: rawChapter.title,
            chapterNumber,
          };

          example.steps = buildSteps(rawExample, example.id, language);
          if (example.steps.length === 0) {
            // An example with neither a prompt nor prompts is a content bug, not
            // something to surface to a learner as an empty exercise.
            if (strict) {
              throw new Error(`Example ${rawExample.id} in ${filename} has no prompt or prompts`);
            }
            continue;
          }

          chapterExamples.push(example);
          examples.push(example);
          steps.push(...example.steps);
        }

        chapters.push({
          title: rawChapter.title,
          number: chapterNumber,
          goal: rawChapter.goal,
          examples: chapterExamples,
        });
      }

      sections.push({ title: rawSection.title, chapters });
    }

    books.push({ id: bookId, title: raw.title, language, sections });
  }

  return { books, examples, steps, version: options.version };
}

function buildSteps(rawExample: RawExample, exampleId: string, language: Language): Step[] {
  if (Array.isArray(rawExample.prompts) && rawExample.prompts.length > 0) {
    const total = rawExample.prompts.length;
    return rawExample.prompts.map((step, i) => ({
      id: step.id ?? `${exampleId}.${i + 1}`,
      prompt: step.prompt,
      response: normalizeResponse(step.response),
      language,
      index: i + 1,
      total,
      exampleId,
    }));
  }

  if (rawExample.prompt) {
    // Single-prompt example: the step id is the example id, so callers can treat
    // both authored forms uniformly.
    return [
      {
        id: exampleId,
        prompt: rawExample.prompt,
        response: normalizeResponse(rawExample.response),
        language,
        index: 1,
        total: 1,
        exampleId,
      },
    ];
  }

  return [];
}

/** Load every books/*.json in a directory. */
export function loadFromDirectory(dir: string, options: LoadOptions = {}): Content {
  const entries: RawEntry[] = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((filename) => ({
      filename,
      book: JSON.parse(readFileSync(join(dir, filename), "utf8")) as RawBook,
    }));
  return loadFromRaw(entries, options);
}
