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
  /**
   * Sample input for an exercise that reads stdin.
   *
   * Required for interactive exercises (enforced by scripts/validate.ts) because
   * an assistant cannot type into a running program — Claude Code's `!` prefix
   * does not attach an interactive stdin. Without a sample, those exercises
   * could never be completed through an assistant at all.
   */
  stdin?: string;
  explanation?: Explanation;
  scaffold?: Scaffold;
  /** See Step.expectsException. */
  expectsException?: boolean;
}

/**
 * An example is authored in one of two forms: a single prompt/response pair, or
 * a `prompts` array of progressive steps (each step typically modifies the
 * previous one's output).
 */
/**
 * How runnable an example is, which decides how a runner can execute it.
 *
 * Later chapters teach Maven projects, classes with no entry point, and JUnit
 * tests. Those are not single files that can be run, and pretending otherwise
 * would break the rule that an exercise is complete only when it ran.
 */
export type Kind = "program" | "class" | "test" | "snippet" | "project";

/**
 * Publication state. Absent means published.
 *
 * `draft`    imported from a manuscript but not yet explained or proved to run.
 * `retired`  no longer in the book. Kept so a learner's existing progress entry
 *            still refers to something, but not served.
 */
export type Status = "draft" | "retired";

/**
 * A pre-computed walkthrough of an exercise's code.
 *
 * Stored in the pack rather than generated when a reader asks, for two reasons: an
 * explanation that changes wording every time undermines the promise that the tool
 * agrees with the printed book, and the VS Code extension has no model available to
 * generate one at all.
 */
export interface Explanation {
  summary: string;
  /** Only the lines worth commenting on, in source order. */
  lines: { code: string; text: string }[];
  /** Human-readable note on how to run it. */
  run?: string;
}

/**
 * Extra files that make a non-runnable example runnable.
 *
 * The response is never modified -- it stays byte-exact to the printed page -- so a
 * class with no entry point, or a fragment that needs surrounding code, gets what it
 * needs from here instead.
 */
export interface Scaffold {
  files: ScaffoldFile[];
  /** Which file to execute, when it is not the exercise's own file. */
  entrypoint?: string;
}

export interface ScaffoldFile {
  path: string;
  content?: string;
  /** Reuse another exercise's response, so the two cannot drift apart. */
  fromExercise?: string;
}

export interface RawExample {
  id: string;
  title: string;
  description?: string;
  kind?: Kind;
  status?: Status;
  prompt?: string;
  response?: RawResponse;
  prompts?: RawPromptStep[];
  /** Sample input; see RawPromptStep.stdin. */
  stdin?: string;
  explanation?: Explanation;
  scaffold?: Scaffold;
  /** See Step.expectsException. */
  expectsException?: boolean;
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
  /**
   * Short id prefix for this book's exercises, e.g. "py" in py-2-06.
   *
   * Declared rather than inferred: more books are in the pipeline, and their
   * identity should not be knowledge encoded in a filename regex in two repos.
   */
  tag: string;
  language: Language;
  sections: RawSection[];
}

// ---------------------------------------------------------------------------
// Normalized shape
// ---------------------------------------------------------------------------

/**
 * Language ids match VS Code's, since the extension filters on them.
 *
 * Open rather than a closed union: the series is adding books, and a new one
 * should need content and a release, not a type change in two repos. The named
 * members still give autocomplete for the languages published today.
 */
export type Language = "python" | "java" | (string & {});

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
  /**
   * True when the response reads from stdin, so a runner must supply input or
   * attach a terminal. Derived from the code, not authored.
   */
  interactive: boolean;
  /** Authored sample input, present whenever `interactive` is true. */
  stdin?: string;
  /** Pre-computed walkthrough; see Explanation. */
  explanation?: Explanation;
  /** Extra files needed to run this step; see Scaffold. */
  scaffold?: Scaffold;
  /**
   * The code throws on purpose, to demonstrate an error, so a non-zero exit is the
   * expected outcome. A runner must not treat that as failure -- Chapter 4's coffee
   * examples end with a call the book itself comments as "will throw".
   */
  expectsException?: boolean;
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
  /** True when any step reads stdin. */
  interactive: boolean;
  kind: Kind;
  /** Absent when published; see Status. */
  status?: Status;
  scaffold?: Scaffold;
  bookId: string;
  /** Short book id prefix, e.g. "py". Used to scope commands to one book. */
  bookTag: string;
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
  /** Short id prefix used by this book's exercises, e.g. "py". */
  tag: string;
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
