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
 * Fallback language derivation from the filename.
 *
 * Books now declare `language` themselves; this remains only so a pack authored
 * before that field existed still loads. Prefer the declared value.
 */
export function languageFromFilename(filename: string): Language | undefined {
  const lower = basename(filename).toLowerCase();
  if (lower.includes("python")) return "python";
  if (lower.includes("java")) return "java";
  return undefined;
}

/**
 * Does this code read from stdin?
 *
 * Derived rather than authored so it cannot fall out of sync with the code it
 * describes. A runner needs to know because an assistant has no way to type into
 * a running program: such an exercise needs its sample `stdin` or a real
 * terminal.
 */
const INTERACTIVE_PATTERN = /\binput\s*\(|\bScanner\b|\bBufferedReader\b|System\.in|\breadLine\b/;

export function readsStdin(code: string): boolean {
  return INTERACTIVE_PATTERN.test(code);
}

/**
 * Last-resort tag derivation, for a pack authored before books declared one:
 * take the prefix of the first exercise id, e.g. "py" from "py-1-01".
 */
function tagFromExamples(raw: RawBook): string | undefined {
  for (const section of raw.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      const id = chapter.examples?.[0]?.id;
      const m = id?.match(/^([a-z][a-z0-9]*)-/);
      if (m) return m[1];
    }
  }
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
    // Declared identity wins; filename sniffing is only a fallback for packs
    // authored before those fields existed.
    const language = raw.language ?? languageFromFilename(filename);
    if (!language) {
      if (strict) throw new Error(`Book "${filename}" has no language and none can be derived from its name`);
      continue;
    }
    const bookId = bookIdFromFilename(filename);
    const tag = raw.tag ?? tagFromExamples(raw) ?? bookId;
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
            interactive: false,
            bookId,
            bookTag: tag,
            bookTitle: raw.title,
            sectionTitle: rawSection.title,
            chapterTitle: rawChapter.title,
            chapterNumber,
          };

          example.steps = buildSteps(rawExample, example.id, language);
          example.interactive = example.steps.some((s) => s.interactive);
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

    books.push({ id: bookId, tag, title: raw.title, language, sections });
  }

  return { books, examples, steps, version: options.version };
}

function buildSteps(rawExample: RawExample, exampleId: string, language: Language): Step[] {
  if (Array.isArray(rawExample.prompts) && rawExample.prompts.length > 0) {
    const total = rawExample.prompts.length;
    return rawExample.prompts.map((step, i) => {
      const response = normalizeResponse(step.response);
      return {
        id: step.id ?? `${exampleId}.${i + 1}`,
        prompt: step.prompt,
        response,
        language,
        index: i + 1,
        total,
        exampleId,
        interactive: readsStdin(response),
        ...(step.stdin === undefined ? {} : { stdin: step.stdin }),
      };
    });
  }

  if (rawExample.prompt) {
    // Single-prompt example: the step id is the example id, so callers can treat
    // both authored forms uniformly.
    const response = normalizeResponse(rawExample.response);
    return [
      {
        id: exampleId,
        prompt: rawExample.prompt,
        response,
        language,
        index: 1,
        total: 1,
        exampleId,
        interactive: readsStdin(response),
        ...(rawExample.stdin === undefined ? {} : { stdin: rawExample.stdin }),
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
