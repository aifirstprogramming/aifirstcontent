/**
 * Exercise id parsing, validation, and resolution.
 *
 * Ids are authored, never derived, so a learner's progress log survives
 * retitling, reordering, and insertion of new examples. Format:
 *
 *   <tag>-<chapter>-<seq>[.<step>]     py-2-06, py-2-06.1, java-3-05.4
 *
 * `tag` is the short book tag (py, java), `chapter` the chapter number, `seq` a
 * zero-padded per-chapter counter, and the optional `.step` addresses one step
 * of a multi-step example.
 */

import type { Content, Example, Step } from "./types";

export const ID_PATTERN = /^([a-z][a-z0-9]*)-(\d+)-(\d+)(?:\.(\d+))?$/;

export interface ParsedId {
  tag: string;
  chapter: number;
  seq: number;
  /** Present only for step ids. */
  step?: number;
  /** The owning example's id (the id itself, for example ids). */
  exampleId: string;
}

export function parseId(id: string): ParsedId | null {
  const m = ID_PATTERN.exec(id.trim());
  if (!m) return null;
  const [, tag, chapter, seq, step] = m;
  const exampleId = `${tag}-${chapter}-${seq}`;
  return {
    tag,
    chapter: Number(chapter),
    seq: Number(seq),
    step: step === undefined ? undefined : Number(step),
    exampleId,
  };
}

export function isValidId(id: string): boolean {
  return parseId(id) !== null;
}

/** Sort key for stable ordering across books, used by `next` and listings. */
export function compareIds(a: string, b: string): number {
  const pa = parseId(a);
  const pb = parseId(b);
  if (!pa || !pb) return a.localeCompare(b);
  return (
    pa.tag.localeCompare(pb.tag) ||
    pa.chapter - pb.chapter ||
    pa.seq - pb.seq ||
    (pa.step ?? 0) - (pb.step ?? 0)
  );
}

export class AmbiguousIdError extends Error {
  constructor(
    readonly input: string,
    readonly candidates: string[],
  ) {
    super(
      `"${input}" matches ${candidates.length} exercises: ${candidates.slice(0, 8).join(", ")}${
        candidates.length > 8 ? ", ..." : ""
      }`,
    );
    this.name = "AmbiguousIdError";
  }
}

export class UnknownIdError extends Error {
  constructor(readonly input: string) {
    super(`No exercise matches "${input}"`);
    this.name = "UnknownIdError";
  }
}

export type Resolved =
  | { kind: "example"; example: Example }
  | { kind: "step"; step: Step; example: Example };

/**
 * Resolve user input to an example or a single step.
 *
 * Tries exact match, then case-insensitive, then unique-prefix. A prefix that
 * matches several exercises throws rather than guessing, because silently
 * picking one would apply the wrong code to a learner's file.
 */
export function resolve(input: string, content: Content): Resolved {
  const raw = input.trim();
  if (!raw) throw new UnknownIdError(input);

  const byId = new Map<string, Resolved>();
  for (const example of content.examples) {
    byId.set(example.id, { kind: "example", example });
  }
  // Step ids are registered after examples so a single-prompt example — whose
  // step id equals its example id — resolves as an example, showing its title
  // and description rather than a bare prompt.
  for (const step of content.steps) {
    if (!byId.has(step.id)) {
      const example = content.examples.find((e) => e.id === step.exampleId)!;
      byId.set(step.id, { kind: "step", step, example });
    }
  }

  const exact = byId.get(raw);
  if (exact) return exact;

  const lower = raw.toLowerCase();
  for (const [id, hit] of byId) {
    if (id.toLowerCase() === lower) return hit;
  }

  const prefixed = [...byId.keys()].filter((id) => id.toLowerCase().startsWith(lower));
  if (prefixed.length === 1) return byId.get(prefixed[0])!;
  if (prefixed.length > 1) {
    // A prefix naming exactly one example plus its own steps (e.g. "py-2-06"
    // matching py-2-06.1/.2) is unambiguous: the learner means the example.
    const asExample = byId.get(prefixed.find((id) => !id.includes(".")) ?? "");
    const allSameExample = prefixed.every((id) => parseId(id)?.exampleId === parseId(prefixed[0])?.exampleId);
    if (asExample && allSameExample) return asExample;
    throw new AmbiguousIdError(input, prefixed.sort(compareIds));
  }

  throw new UnknownIdError(input);
}
