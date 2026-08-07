/**
 * Prompt -> canonical response matching.
 *
 * This algorithm is lifted verbatim from the VS Code extension's
 * `AIFirstLanguageModelProvider.findMatchingPrompt()` / `searchEntries()`. It
 * lives here so the CLI and the extension resolve a learner's prompt through
 * exactly the same code path — that identity is what makes "the same answers as
 * the book" a structural property rather than a convention.
 *
 * Do not "improve" the scoring without updating the extension in lockstep: a
 * change here silently changes which code a reader sees in one surface but not
 * the other.
 */

import type { Language, Step } from "./types";

/** Anything with a prompt and a language can be matched. */
export interface Matchable {
  prompt: string;
  language: Language;
}

/**
 * Inline chat and agent mode wrap the real query in `<prompt>...</prompt>`.
 * Unwrap it so matching sees what the learner actually typed.
 */
export function unwrapPromptTag(text: string): string {
  const m = text.match(/<prompt>([\s\S]*?)<\/prompt>/i);
  return m ? m[1].trim() : text;
}

/**
 * Find the entry whose prompt best matches `userPrompt`.
 *
 * When `language` is given, matching is restricted strictly to that language and
 * returns null rather than falling back — a Python reader must never be handed
 * Java code. When it is absent or "plaintext" (an unsaved buffer, or a bare
 * terminal invocation), each language group is exhausted in turn so a Java entry
 * cannot win merely by sharing one extra word.
 */
export function findMatch<T extends Matchable>(
  userPrompt: string,
  entries: readonly T[],
  language?: string,
): T | null {
  if (entries.length === 0) return null;

  if (language && language !== "plaintext") {
    const scoped = entries.filter((e) => e.language === language);
    if (scoped.length === 0) return null;
    return searchEntries(userPrompt, scoped);
  }

  const python = entries.filter((e) => e.language === "python");
  const java = entries.filter((e) => e.language === "java");
  const other = entries.filter((e) => e.language !== "python" && e.language !== "java");

  for (const group of [python, java, other]) {
    if (group.length === 0) continue;
    const m = searchEntries(userPrompt, group);
    if (m) return m;
  }
  return null;
}

/** Tiered search within one language group: exact, then partial, then fuzzy. */
export function searchEntries<T extends Matchable>(userPrompt: string, entries: readonly T[]): T | null {
  const normalizedUserPrompt = userPrompt.toLowerCase().trim();

  // 1. Exact match (case-insensitive)
  for (const entry of entries) {
    if (entry.prompt.toLowerCase().trim() === normalizedUserPrompt) return entry;
  }

  // 2. Partial match (either contains the other)
  for (const entry of entries) {
    const stored = entry.prompt.toLowerCase().trim();
    if (normalizedUserPrompt.includes(stored) || stored.includes(normalizedUserPrompt)) return entry;
  }

  // 3. Fuzzy match: word overlap above 50%, ignoring words of 1-2 characters.
  let bestMatch: T | null = null;
  let bestScore = 0;
  const userWords = normalizedUserPrompt.split(/\s+/).filter((w) => w.length > 2);

  for (const entry of entries) {
    const storedWords = entry.prompt
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const commonWords = userWords.filter((word) => storedWords.includes(word));
    const score = commonWords.length / Math.max(userWords.length, storedWords.length);

    if (score > bestScore && score > 0.5) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestMatch;
}

/** Convenience wrapper for the common case of matching over loaded steps. */
export function findMatchingStep(
  userPrompt: string,
  steps: readonly Step[],
  language?: string,
): Step | null {
  return findMatch(unwrapPromptTag(userPrompt), steps, language);
}
