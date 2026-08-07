/**
 * Types for AI First book content.
 *
 * Two layers:
 *  - `Raw*` mirrors the on-disk JSON in books/ exactly, warts and all
 *    (notably `response` being either a string or an array of lines).
 *  - `Book` / `Chapter` / `Example` / `Step` is the normalized shape every
 *    consumer works with, produced by loader.ts.
 */

// ---------------------------------------------------------------------------
// On-disk shape
// ---------------------------------------------------------------------------

/** A response is authored either as one string or as an array of lines. */
export type RawResponse = string | string[];

export interface RawPromptStep {
  id: string;
  prompt: string;
  response: RawResponse;
}

/**
 * An example is authored in one of two forms: a single prompt/response pair, or
 * a `prompts` array of progressive steps (each step typically modifies the
 * previous one's output).
 */
export interface RawExample {
  id: string;
  title: string;
  description?: string;
  prompt?: string;
  response?: RawResponse;
  prompts?: RawPromptStep[];
}

export interface RawChapter {
  title: string;
  goal?: string;
  examples: RawExample[];
}

export interface RawSection {
  title: string;
  chapters: RawChapter[];
}

export interface RawBook {
  title: string;
  sections: RawSection[];
}

// ---------------------------------------------------------------------------
// Normalized shape
// ---------------------------------------------------------------------------

/** Language ids match VS Code's, since the extension filters on them. */
export type Language = "python" | "java";

/**
 * One prompt and its canonical response — the atomic unit an agent reproduces.
 *
 * For a single-prompt example the step's id equals the example's id, so callers
 * never need to special-case the two authored forms.
 */
export interface Step {
  id: string;
  prompt: string;
  /** Canonical response, always a single string (arrays joined with "\n"). */
  response: string;
  language: Language;
  /** 1-based position within the parent example. */
  index: number;
  /** Total steps in the parent example; 1 for single-prompt examples. */
  total: number;
  exampleId: string;
}

/** A titled example from the book. This is the unit learner progress is tracked against. */
export interface Example {
  id: string;
  title: string;
  description?: string;
  language: Language;
  /** Always at least one step. */
  steps: Step[];
  /** True when authored with a `prompts` array of progressive steps. */
  multiStep: boolean;
  bookId: string;
  bookTitle: string;
  sectionTitle: string;
  chapterTitle: string;
  chapterNumber: number;
}

export interface Chapter {
  title: string;
  number: number;
  goal?: string;
  examples: Example[];
}

export interface Section {
  title: string;
  chapters: Chapter[];
}

export interface Book {
  /** Slug derived from the filename, e.g. "ai-first-python-programming". */
  id: string;
  title: string;
  language: Language;
  sections: Section[];
}

/** Everything loaded, plus flat indexes for lookup. */
export interface Content {
  books: Book[];
  /** All examples, in book -> section -> chapter -> example order. */
  examples: Example[];
  /** All steps, in the same document order. Matching runs over these. */
  steps: Step[];
  /** Content pack version, when the pack declares one. */
  version?: string;
}
