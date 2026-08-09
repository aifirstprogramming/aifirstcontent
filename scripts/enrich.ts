#!/usr/bin/env bun
/**
 * Write the explanation a reader sees, and prove the exercise runs.
 *
 * This is the only place a model is used, and it runs at authoring time. Nothing
 * here happens when a reader asks for an exercise: the CLI and the VS Code
 * extension both read what this script committed. That is the whole point --
 * the extension has no model available, and an explanation that reworded itself
 * on every request would undercut the promise that the tool agrees with the book.
 *
 * A draft is published only when it actually ran (scripts/lib/verify.ts). A
 * generated explanation attached to broken code would be worse than none, since
 * it is presented as canonical.
 *
 * Deliberately not asked of the model:
 *   - the response. It stays byte-exact to the printed page; code that cannot run
 *     alone gets extra files from its scaffold instead.
 *   - the run command. Derived from kind and language, because a model asked for a
 *     command suggests `mvn test` on a machine with no Maven. The "how to run" line
 *     a reader sees is the command that was actually executed.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=...
 *   bun scripts/enrich.ts                 every draft
 *   bun scripts/enrich.ts --limit 5       first few, to check quality
 *   bun scripts/enrich.ts --book java
 *   bun scripts/enrich.ts --id java-4-01
 *   bun scripts/enrich.ts --fresh         ignore the cache for the selected targets
 *   bun scripts/enrich.ts --dry-run       verify only; no model calls, no writes
 *   bun scripts/enrich.ts --recheck       re-verify already-published examples
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";
import type { Example, Explanation, Scaffold, Step } from "../src/types";
import { suggestFilename } from "../src/filenames";
import { reorder } from "./lib/apply";
import { JUNIT_URL, displayCommand, junitAvailable, verify, verifyCommand } from "./lib/verify";

const ROOT = join(import.meta.dir, "..");
const BOOKS_DIR = join(ROOT, "books");
const CACHE_DIR = join(ROOT, "enrich-cache");

/**
 * Pinned deliberately. The cache key includes it, so changing the model is a
 * visible, intentional re-enrichment of the whole book rather than a silent
 * rewrite of text a reader has already seen in print.
 */
const MODEL = "claude-opus-5";

/** Bump when the instructions change, so cached output is regenerated. */
const PROMPT_VERSION = 5;

const CONCURRENCY = 4;

// --- what the model returns -------------------------------------------------
//
// Every field is required and "not needed" is expressed as an empty value, rather
// than omitting the field. Optional properties in a strict schema are a needless
// source of validation surprises for no gain here.

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "lines", "scaffoldFiles", "entrypoint", "stdin", "expectsUncaughtException"],
  properties: {
    summary: {
      type: "string",
      description: "One or two sentences on what this code does, for a beginner. No preamble.",
    },
    lines: {
      type: "array",
      description:
        "Line-by-line notes, in source order, covering only lines worth commenting on. " +
        "Each `code` MUST be copied verbatim from the response, including indentation.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "text"],
        properties: {
          code: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    scaffoldFiles: {
      type: "array",
      description:
        "Extra files needed to make the code runnable. Empty when the code runs on its own. " +
        "Never restate the exercise's own file here.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content", "fromExercise"],
        properties: {
          path: { type: "string" },
          content: {
            type: "string",
            description: "The file's contents. Empty when using fromExercise instead.",
          },
          fromExercise: {
            type: "string",
            description:
              "Id of another exercise whose code becomes this file's contents. Prefer this over " +
              "retyping a class that another exercise in the same chapter already defines, so the " +
              "two cannot drift apart. Empty string when supplying content directly.",
          },
        },
      },
    },
    entrypoint: {
      type: "string",
      description:
        "Which scaffold file to execute, when the exercise's own file is not runnable directly. " +
        "Empty string when the exercise's own file is the thing to run.",
    },
    stdin: {
      type: "string",
      description:
        "Sample input for code that reads from stdin, with a trailing newline per line entered. " +
        "Empty string when the code reads no input.",
    },
    expectsUncaughtException: {
      type: "boolean",
      description:
        "True when the exercise deliberately ends by throwing an uncaught exception to demonstrate " +
        "an error, so exiting non-zero is the correct outcome. False for everything else.",
    },
  },
} as const;

interface ModelOutput {
  summary: string;
  lines: { code: string; text: string }[];
  scaffoldFiles: { path: string; content: string; fromExercise: string }[];
  entrypoint: string;
  stdin: string;
  expectsUncaughtException: boolean;
}

const SYSTEM = `You write the canonical explanation for exercises in the "AI First" programming books
(Apress). A reader sees your words verbatim, in a CLI and in a VS Code extension, as the
book's own explanation of the code. Write for someone learning to program.

Hard rules:

1. NEVER restate, reformat, or "fix" the exercise's code. It is reproduced exactly from the
   printed page. If it cannot run on its own, add surrounding files in scaffoldFiles.
2. Every "code" value in lines MUST be copied character-for-character from the response,
   including indentation. Do not paraphrase a line, merge two lines, or invent one.
3. Cover the lines that teach something. Skip closing braces and blank lines. A short program
   may need three notes; a long one should still skip the obvious.
4. Explain what the line does and why, in one or two plain sentences. No hedging, no restating
   the code in words ("this line prints X" adds nothing to print(X) -- say what it is for).
   Every note must be a complete, grammatical sentence that reads well on a printed page. Re-read
   each one before returning it: a half-finished clause is worse than no note at all.
5. Only python3, java, and javac are available. There is no Maven, no Gradle, no pip install,
   and no network. JUnit tests run through the JUnit console launcher, so a Java test needs no
   build file. If you would need a tool that is not available, leave scaffoldFiles empty.
6. stdin is required if and only if the code reads input. Choose values that reach the
   behaviour the exercise teaches -- if it branches on temperature, pick one that fires the
   branch being demonstrated.

7. If the code refers to a class that another exercise in the same chapter defines, add a
   scaffold file with fromExercise set to that exercise's id. Do not retype the class.
8. Set expectsUncaughtException only when the exercise's point is that it throws -- a comment
   like "this call will throw" is the signal. Those programs exit non-zero on purpose.

On scaffolding, be conservative. Most exercises run as they are. A Java class with no main
method is expected to be compiled, not run, so it needs nothing. Add files only when the code
genuinely cannot be exercised otherwise -- for example a fragment that has to be called from
somewhere.`;

/** Top-level types an exercise's code defines, for the sibling manifest. */
function definedTypes(code: string): string[] {
  return [...code.matchAll(/\b(?:class|interface|record|enum)\s+([A-Z][\w$]*)/g)].map((m) => m[1]);
}

/**
 * The other exercises in this chapter, and what each defines.
 *
 * Every JUnit test in Java chapter 6 failed the first run because the class under
 * test is defined by an earlier exercise and the model had no way to know which.
 * With this manifest it can reference that exercise instead of inventing the class.
 */
function siblings(example: Example, all: Example[]): string {
  const peers = all.filter(
    (e) => e.bookTag === example.bookTag && e.chapterNumber === example.chapterNumber && e.id !== example.id,
  );
  const lines: string[] = [];
  for (const p of peers) {
    const types = new Set<string>();
    for (const s of p.steps) for (const t of definedTypes(s.response)) types.add(t);
    const what = types.size > 0 ? `defines ${[...types].join(", ")}` : "no top-level type";
    lines.push(`  ${p.id}  ${p.title} — ${what}`);
  }
  return lines.join("\n");
}

function userPrompt(
  example: Example,
  step: Step,
  all: Example[],
  retryOf?: { command: string; output: string },
): string {
  const parts = [
    `Book: ${example.bookTitle}`,
    `Chapter: ${example.chapterTitle}`,
    `Exercise: ${example.id} — ${example.title}`,
    `Language: ${example.language}`,
    `Kind: ${example.kind}`,
    "",
    `The reader's prompt was:`,
    step.prompt,
    "",
    `The code printed in the book (do not change it):`,
    "```",
    step.response,
    "```",
  ];

  const peers = siblings(example, all);
  if (peers) {
    parts.push(
      "",
      "Other exercises in this chapter. If this code refers to a class one of them defines,",
      "use fromExercise with that id rather than writing the class yourself:",
      peers,
    );
  }
  if (retryOf) {
    parts.push(
      "",
      `A previous attempt did not run. The command was:`,
      retryOf.command,
      "",
      `It produced:`,
      "```",
      retryOf.output.slice(0, 4000),
      "```",
      "",
      "Fix this by supplying or correcting the scaffold and stdin. Do not change the exercise's code.",
    );
  }
  return parts.join("\n");
}

// --- cache -----------------------------------------------------------------

function cacheKey(example: Example, step: Step, attempt: number): string {
  const h = createHash("sha256");
  h.update(
    [step.prompt, step.response, example.kind, example.language, MODEL, String(PROMPT_VERSION), String(attempt)].join(
      " ",
    ),
  );
  return h.digest("hex").slice(0, 32);
}

function readCache(key: string): ModelOutput | undefined {
  const path = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ModelOutput;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, value: ModelOutput): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `${key}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

// --- the model call --------------------------------------------------------

const client = new Anthropic();

async function generate(
  example: Example,
  step: Step,
  attempt: number,
  retryOf?: { command: string; output: string },
): Promise<{ output: ModelOutput; cached: boolean }> {
  // The sibling manifest is part of the prompt, so it is not part of the cache key:
  // it is derived from the same content the key already covers.
  const key = cacheKey(example, step, attempt);
  const hit = fresh ? undefined : readCache(key);
  if (hit) return { output: hit, cached: true };

  // Streaming because max_tokens is generous: a non-streaming request at this size
  // risks an HTTP timeout on a long explanation.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [{ role: "user", content: userPrompt(example, step, content.examples, retryOf) }],
  } as never);

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error(`model declined: ${JSON.stringify(message.stop_details ?? null)}`);
  }
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no text block in response");

  const output = JSON.parse(text.text) as ModelOutput;
  writeCache(key, output);
  return { output, cached: false };
}

// --- validation of what came back ------------------------------------------

/**
 * Reject an explanation that quotes code the exercise does not contain.
 *
 * This is the cheap guard against the failure that would matter most: a plausible
 * walkthrough of a line the reader cannot find on the page.
 */
function checkLines(step: Step, out: ModelOutput): string[] {
  const source = new Set(
    step.response
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const bad: string[] = [];
  for (const line of out.lines) {
    const t = line.code.trim();
    if (t === "") continue;
    if (!source.has(t)) bad.push(line.code);
  }
  return bad;
}

/**
 * Reject notes that are obviously unfinished.
 *
 * This cannot judge whether an explanation is *good* -- that needs a human, and
 * reviewing it is the real cost of this phase. It only catches the mechanical
 * failures: an empty note, a stub, or a sentence that stops mid-clause.
 */
function checkProse(out: ModelOutput): string[] {
  const bad: string[] = [];
  if (out.summary.trim().split(/\s+/).length < 5) bad.push(`summary too short: "${out.summary}"`);
  for (const line of out.lines) {
    const t = line.text.trim();
    if (t.split(/\s+/).length < 4) bad.push(`note too short for \`${line.code.trim()}\`: "${t}"`);
    else if (!/[.!?]$/.test(t)) bad.push(`note is unpunctuated for \`${line.code.trim()}\`: "${t}"`);
  }
  return bad;
}

function toScaffold(out: ModelOutput): Scaffold | undefined {
  if (out.scaffoldFiles.length === 0) return undefined;
  return {
    files: out.scaffoldFiles.map((f) =>
      // A reference beats a copy: if the class this exercise needs is defined by
      // another exercise, pointing at it means the two cannot drift apart.
      f.fromExercise
        ? { path: f.path, fromExercise: f.fromExercise }
        : { path: f.path, content: f.content },
    ),
    ...(out.entrypoint ? { entrypoint: out.entrypoint } : {}),
  };
}

// --- writing back ----------------------------------------------------------

interface Enriched {
  id: string;
  explanation: Explanation;
  scaffold?: Scaffold;
  stdin?: string;
  expectsException?: boolean;
}

function bookFiles(): string[] {
  return readdirSync(BOOKS_DIR).filter((f) => f.endsWith(".json"));
}

/**
 * Apply results and publish the examples whose every step verified.
 *
 * An example is published only when all of its steps passed, so a progressive
 * exercise never appears with a step that does not run.
 */
function writeResults(enriched: Map<string, Enriched>, verified: Set<string>): number {
  let changed = 0;
  for (const filename of bookFiles()) {
    const path = join(BOOKS_DIR, filename);
    const book = JSON.parse(readFileSync(path, "utf8"));
    let touched = false;

    for (const section of book.sections ?? []) {
      for (const chapter of section.chapters ?? []) {
        for (let i = 0; i < (chapter.examples ?? []).length; i++) {
          const ex = chapter.examples[i];
          const steps: Record<string, unknown>[] = ex.prompts ?? [ex];
          let allVerified = steps.length > 0;

          for (const st of steps) {
            const sid = (st.id as string) ?? ex.id;
            const result = enriched.get(sid);
            if (result) {
              st.explanation = result.explanation;
              if (result.scaffold) st.scaffold = result.scaffold;
              if (result.stdin !== undefined) st.stdin = result.stdin;
              if (result.expectsException) st.expectsException = true;
              if (result.expectsException) st.expectsException = true;
              touched = true;
              changed++;
            }
            if (!verified.has(sid)) allVerified = false;
          }

          if (allVerified && ex.status === "draft") {
            delete ex.status;
            touched = true;
          }

          chapter.examples[i] = reorder(ex);
          if (ex.prompts) ex.prompts = ex.prompts.map((s: Record<string, unknown>) => reorder(s));
        }
      }
    }

    if (touched) writeFileSync(path, `${JSON.stringify(book, null, 2)}\n`);
  }
  return changed;
}

// --- main ------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const limit = flag("--limit") ? Number(flag("--limit")) : undefined;
const onlyBook = flag("--book");
const onlyId = flag("--id");
const dryRun = argv.includes("--dry-run");
// Regenerate rather than reuse. Needed when a cached attempt was recorded against a
// harness bug: the output is stale, but nothing about the exercise changed, so the
// cache key is identical and bumping PROMPT_VERSION would rewrite all 111.
const fresh = argv.includes("--fresh");
const recheck = argv.includes("--recheck");

const content = loadFromDirectory(BOOKS_DIR, { includeUnpublished: true, strict: false });
const responseOf = (id: string): string | undefined =>
  content.steps.find((s) => s.id === id)?.response ?? content.examples.find((e) => e.id === id)?.steps[0]?.response;

let targets = content.examples.filter((e) => (recheck ? true : e.status === "draft"));
if (onlyBook) targets = targets.filter((e) => e.bookTag === onlyBook);
if (onlyId) targets = targets.filter((e) => e.id === onlyId);
if (limit !== undefined) targets = targets.slice(0, limit);

if (!junitAvailable() && targets.some((e) => e.kind === "test" && e.language === "java")) {
  console.log(`! Java tests cannot be verified: no JUnit launcher.\n  curl -sSLo ~/.aifirst-toolcache/junit-console.jar ${JUNIT_URL}\n`);
}

interface Outcome {
  id: string;
  status: "published" | "failed" | "skipped";
  detail?: string;
  cached: boolean;
}

const outcomes: Outcome[] = [];
const enriched = new Map<string, Enriched>();
const verified = new Set<string>();

async function enrichExample(example: Example): Promise<void> {
  for (const step of example.steps) {
    // --- verify-only path -------------------------------------------------
    if (dryRun) {
      const r = verify(example, step, step.scaffold, step.stdin, {
        responseOf,
        expectsUncaughtException: step.expectsException,
      });
      if (r.skipped) outcomes.push({ id: step.id, status: "skipped", detail: r.skipped, cached: true });
      else if (r.ok) {
        verified.add(step.id);
        outcomes.push({ id: step.id, status: "published", cached: true });
      } else {
        outcomes.push({ id: step.id, status: "failed", detail: firstLines(r.output), cached: true });
      }
      continue;
    }

    let cached = true;
    let lastFailure: { command: string; output: string } | undefined;
    let done = false;

    // One retry, told what went wrong. A second failure is reported rather than
    // hidden: the point of this gate is that unverified content stays unpublished.
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      let out: ModelOutput;
      try {
        const g = await generate(example, step, attempt, lastFailure);
        out = g.output;
        cached = cached && g.cached;
      } catch (e) {
        outcomes.push({ id: step.id, status: "failed", detail: (e as Error).message, cached: false });
        break;
      }

      const invented = checkLines(step, out);
      if (invented.length > 0) {
        lastFailure = {
          command: "(explanation check)",
          output: `these lines are not in the exercise's code:\n${invented.join("\n")}`,
        };
        continue;
      }

      const prose = checkProse(out);
      if (prose.length > 0) {
        lastFailure = { command: "(prose check)", output: prose.join("\n") };
        continue;
      }

      const scaffold = toScaffold(out);
      const stdin = out.stdin === "" ? undefined : out.stdin;
      const r = verify(example, step, scaffold, stdin, {
        responseOf,
        expectsUncaughtException: out.expectsUncaughtException,
      });

      if (r.skipped) {
        outcomes.push({ id: step.id, status: "skipped", detail: r.skipped, cached });
        done = true;
        break;
      }

      if (r.ok) {
        const mainFile = suggestFilename(example, step);
        const { commands: cmds } = verifyCommand(example, step, mainFile, scaffold);
        enriched.set(step.id, {
          id: step.id,
          explanation: {
            summary: out.summary,
            lines: out.lines,
            // Set here, not by the model: the line a reader is shown is the command
            // that actually ran.
            run: displayCommand(cmds, mainFile),
          },
          ...(scaffold ? { scaffold } : {}),
          ...(stdin !== undefined ? { stdin } : {}),
          // Persisted so CI reaches the same verdict without calling a model.
          ...(out.expectsUncaughtException ? { expectsException: true } : {}),
        });
        verified.add(step.id);
        outcomes.push({ id: step.id, status: "published", cached });
        done = true;
        break;
      }

      lastFailure = { command: r.command, output: r.output };
    }

    if (!done && lastFailure) {
      outcomes.push({
        id: step.id,
        status: "failed",
        detail: `${lastFailure.command}\n${firstLines(lastFailure.output)}`,
        cached,
      });
    }
  }
}

function firstLines(s: string, n = 4): string {
  return s.split("\n").slice(0, n).join("\n");
}

/** Bounded concurrency: enough to be quick, not enough to trip rate limits. */
async function runPool(items: Example[]): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await enrichExample(item);
      } catch (e) {
        outcomes.push({ id: item.id, status: "failed", detail: (e as Error).message, cached: false });
      }
    }
  });
  await Promise.all(workers);
}

console.log(
  `${dryRun ? "Verifying" : "Enriching"} ${targets.length} example(s) with ${MODEL} (prompt v${PROMPT_VERSION})…\n`,
);

await runPool(targets);

const published = outcomes.filter((o) => o.status === "published");
const failed = outcomes.filter((o) => o.status === "failed");
const skipped = outcomes.filter((o) => o.status === "skipped");

if (failed.length > 0) {
  console.log(`✗ ${failed.length} did not verify — staying draft:\n`);
  for (const f of failed.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${f.id}`);
    for (const line of (f.detail ?? "").split("\n")) console.log(`      ${line}`);
  }
  console.log();
}

if (skipped.length > 0) {
  console.log(`- ${skipped.length} not verifiable here:`);
  for (const s of skipped.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${s.id.padEnd(14)} ${s.detail}`);
  }
  console.log();
}

if (!dryRun) {
  const changed = writeResults(enriched, verified);
  console.log(`Wrote ${changed} explanation(s).`);
}

const generatedCount = published.filter((o) => !o.cached).length;
console.log(
  `✓ ${published.length} verified (${generatedCount} newly generated, ${published.length - generatedCount} from cache), ` +
    `${failed.length} failed, ${skipped.length} skipped.`,
);
if (!dryRun) console.log("Now run `bun run check`.");
process.exit(failed.length > 0 && targets.length === failed.length ? 1 : 0);
