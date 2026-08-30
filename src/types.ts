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

export type ReplayOperation =
  | { type: "write"; path: string; content: string }
  | { type: "edit"; path: string; oldText: string; newText: string; replaceAll?: boolean }
  | { type: "read"; path: string }
  | {
      type: "command";
      command: string[];
      cwd?: string;
      env?: Record<string, string>;
      stdin?: string;
      /** Required when a command is allowed to run before plan approval. */
      readOnly?: boolean;
      expectedExitCode?: number;
      expectedStdout?: string;
      expectedStderr?: string;
    };

export type ReplayEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "operation"; operation: ReplayOperation };

export interface PlanOption {
  /** Stable machine id stored in workflow and progress metadata. */
  id: string;
  label: string;
  description: string;
}

export interface PlanQuestion {
  id: string;
  question: string;
  header: string;
  options: PlanOption[];
  /** Adjacent questions with the same group are shown in one native dialog. */
  group?: string;
  /** Ask only when every earlier answer here matches. */
  when?: Record<string, string>;
}

export interface PlanVariant {
  id: string;
  /** Complete answer vector for every question applicable to this path. */
  answers: Record<string, string>;
  plan: string;
  operations: ReplayOperation[];
  commentary?: string[];
  events?: ReplayEvent[];
}

export interface PlanInterlude {
  /** Run after this question is answered and before planning advances. */
  afterQuestion: string;
  /** Only read-only operations are permitted before plan approval. */
  events: ReplayEvent[];
}

export interface PlanWorkflow {
  questions: PlanQuestion[];
  /** The choices used by the printed book and canonical replay. */
  canonicalAnswers: Record<string, string>;
  canonicalPlan: string;
  /** Captured read-only work between question groups and plan approval. */
  interludes?: PlanInterlude[];
  /** Optional deterministic alternatives available without an LLM. */
  variants?: PlanVariant[];
}

export interface Replay {
  /** Captured Showtail prompt that starts this replay. */
  prompt?: string;
  /** Ordered trusted operations to apply in the learner workspace. */
  operations: ReplayOperation[];
  /** Captured text shown around the operations, in display order. */
  commentary?: string[];
  /** Read-only captured activity that occurred before planning questions. */
  prePlanEvents?: ReplayEvent[];
  /** Ordered post-approval transcript. Preferred over parallel commentary/operations. */
  events?: ReplayEvent[];
  /** Captured final response after the last operation succeeds. */
  completionText?: string;
  /** Interactive planning that must finish before replay operations begin. */
  workflow?: PlanWorkflow;
  /** Authoring provenance used for safe, idempotent Showtail re-imports. */
  source?: {
    kind: "showtail";
    reportSha256: string;
    generatedAt: string;
    turnIndex: number;
    sessionId?: string;
  };
}

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
  replay?: Replay;
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
  replay?: Replay;
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
  replay?: Replay;
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
  /**
   * Subdirectory to write this exercise into, when its filename is shared with
   * another exercise. Absent for the common case of a name used once.
   *
   * See `exercisePath`: several exercises in a chapter deliberately evolve one
   * file, and in Java the filename is not ours to choose at all.
   */
  dir?: string;
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
