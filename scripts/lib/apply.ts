/**
 * Apply a scrape to books/*.json.
 *
 * What is applied automatically, and what is not, is the whole design here.
 *
 *   drift     the prompt matches exactly and only the code differs, so the
 *             manuscript's code replaces ours. The book is the source of truth
 *             for the code a reader sees.
 *   reworded  the code matches exactly and only the prompt differs, so the
 *             manuscript's prompt replaces ours.
 *   absent    the exercise is not in the manuscripts at all, so it is retired:
 *             kept in the file with its id, but no longer served.
 *   new       imported as a draft, invisible until it has been explained and
 *             proved to run.
 *
 *   revised   both prompt and code changed, which is only ever a fuzzy guess.
 *             Never applied — it is reported for a human to confirm, because
 *             mistakenly pairing two exercises would overwrite a good one.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codeKey, promptKey } from "./docx";
import type { MinedExample } from "./mine";

export interface Classification {
  drift: { id: string; response: string }[];
  reworded: { id: string; prompt: string }[];
  retire: string[];
  add: { chapter: number; example: NewExample }[];
}

export interface NewExample {
  title: string;
  kind: string;
  status: "draft";
  prompt: string;
  response: string;
}

/** Key order kept stable so diffs stay readable and re-runs are byte-identical. */
export const EXAMPLE_KEYS = [
  "id",
  "title",
  "description",
  "kind",
  "status",
  "prompt",
  "prompts",
  "response",
  "stdin",
  "expectsException",
  "explanation",
  "scaffold",
];

export function reorder(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EXAMPLE_KEYS) if (k in obj) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
}

/** A response is stored as an array of lines when it has more than one. */
function storeResponse(code: string): string | string[] {
  const lines = code.split("\n");
  return lines.length > 1 ? lines : code;
}

export function applyToBook(booksDir: string, filename: string, plan: Classification): string[] {
  const path = join(booksDir, filename);
  const book = JSON.parse(readFileSync(path, "utf8"));
  const notes: string[] = [];

  const driftById = new Map(plan.drift.map((d) => [d.id, d.response]));
  const rewordById = new Map(plan.reworded.map((r) => [r.id, r.prompt]));
  const retire = new Set(plan.retire);

  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      const chapterNumber = Number(/chapter\s+(\d+)/i.exec(chapter.title)?.[1] ?? 0);

      for (let i = 0; i < (chapter.examples ?? []).length; i++) {
        const ex = chapter.examples[i];
        const steps: Record<string, unknown>[] = ex.prompts ?? [ex];

        for (const st of steps) {
          const sid = (st.id as string) ?? ex.id;
          if (driftById.has(sid)) {
            st.response = storeResponse(driftById.get(sid)!);
            notes.push(`updated code   ${sid}`);
          }
          if (rewordById.has(sid)) {
            st.prompt = rewordById.get(sid)!;
            notes.push(`updated prompt ${sid}`);
          }
        }

        // Retire only when the whole example is gone: a multi-step exercise with
        // one surviving step is still in the book.
        const allStepsGone = steps.every((st) => retire.has(((st.id as string) ?? ex.id)));
        if (allStepsGone && steps.length > 0 && retire.has(((steps[0].id as string) ?? ex.id))) {
          ex.status = "retired";
          notes.push(`retired        ${ex.id}`);
        }

        chapter.examples[i] = reorder(ex);
        if (ex.prompts) ex.prompts = ex.prompts.map((s: Record<string, unknown>) => reorder(s));
      }

      // New examples are appended in manuscript order, so ids run in book order.
      const additions = plan.add.filter((a) => a.chapter === chapterNumber);
      for (const { example } of additions) {
        chapter.examples.push(
          reorder({
            title: example.title,
            kind: example.kind,
            status: example.status,
            prompt: example.prompt,
            response: storeResponse(example.response),
          }),
        );
        notes.push(`added draft    ch${chapterNumber}  ${example.title.slice(0, 48)}`);
      }
    }
  }

  writeFileSync(path, JSON.stringify(book, null, 2) + "\n");
  return notes;
}

/** Chapters present in a book, so additions for a missing chapter can be reported. */
export function bookChapters(booksDir: string, filename: string): Set<number> {
  const book = JSON.parse(readFileSync(join(booksDir, filename), "utf8"));
  const out = new Set<number>();
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      out.add(Number(/chapter\s+(\d+)/i.exec(chapter.title)?.[1] ?? 0));
    }
  }
  return out;
}

export { codeKey, promptKey };
export type { MinedExample };
