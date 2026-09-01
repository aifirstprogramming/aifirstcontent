#!/usr/bin/env bun
/**
 * CI gate for books/*.json.
 *
 * Checks, in order:
 *   1. JSON Schema conformance (schema/content.schema.json)
 *   2. Global id uniqueness across every book
 *   3. Step ids agreeing with their parent example id and position
 *   4. The content loads cleanly through the shared strict loader
 *
 * Check 2 is the one that protects learner logs: a duplicated id would make two
 * different exercises share a progress entry.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { loadFromRaw, type RawEntry } from "../src/loader";
import type { PlanWorkflow, RawBook, ReplayEvent, ReplayOperation } from "../src/types";

const ROOT = join(import.meta.dir, "..");
const BOOKS_DIR = join(ROOT, "books");

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

// --- 1. Schema -------------------------------------------------------------

const schema = JSON.parse(readFileSync(join(ROOT, "schema", "content.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const filenames = readdirSync(BOOKS_DIR)
  .filter((f) => f.toLowerCase().endsWith(".json"))
  .sort();

if (filenames.length === 0) fail("books/ contains no .json files");

const entries: RawEntry[] = [];

for (const filename of filenames) {
  const book = JSON.parse(readFileSync(join(BOOKS_DIR, filename), "utf8")) as RawBook;
  entries.push({ filename, book });

  if (!validate(book)) {
    for (const e of validate.errors ?? []) {
      fail(`${filename}: ${e.instancePath || "/"} ${e.message}`);
    }
  }
}

// --- 2 & 3. Ids ------------------------------------------------------------

const seen = new Map<string, string>(); // id -> where it was first seen

for (const { filename, book } of entries) {
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      for (const example of chapter.examples ?? []) {
        const where = `${filename} / ${chapter.title} / "${example.title}"`;

        if (seen.has(example.id)) {
          fail(`duplicate id "${example.id}": ${where} and ${seen.get(example.id)}`);
        } else {
          seen.set(example.id, where);
        }

        (example.prompts ?? []).forEach((step, i) => {
          if (seen.has(step.id)) {
            fail(`duplicate id "${step.id}": ${where} step ${i + 1} and ${seen.get(step.id)}`);
          } else {
            seen.set(step.id, `${where} step ${i + 1}`);
          }

          const expected = `${example.id}.${i + 1}`;
          if (step.id !== expected) {
            fail(`step id "${step.id}" should be "${expected}" (${where})`);
          }
        });
      }
    }
  }
}

// --- 4. Loads through the shared loader ------------------------------------

let exampleCount = 0;
let stepCount = 0;
let interactiveCount = 0;
let draftCount = 0;
let retiredCount = 0;
for (const { book } of entries) {
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      for (const ex of chapter.examples ?? []) {
        if (ex.status === "draft") draftCount++;
        if (ex.status === "retired") retiredCount++;
      }
    }
  }
}
try {
  // Published only: a draft has not been explained or proved to run yet, so the
  // requirements below deliberately do not apply to it.
  const content = loadFromRaw(entries, { strict: true });
  exampleCount = content.examples.length;
  stepCount = content.steps.length;

  // 5. Every published step must carry its pre-computed explanation.
  //
  // The VS Code extension has no model, so an explanation missing here is an
  // explanation no reader ever sees. Drafts are exempt: that is what draft means.
  for (const step of content.steps) {
    if (!step.explanation) {
      fail(`${step.id} is published but has no explanation. Run "bun run enrich".`);
      continue;
    }
    if (step.explanation.summary.trim() === "") fail(`${step.id} has an empty explanation summary`);
  }

  // 6. Every exercise that reads input must carry a sample.
  //
  // An assistant cannot type into a running program — Claude Code's `!` prefix
  // does not attach an interactive stdin — so an interactive exercise with no
  // sample input can never be completed through one. Catching that here keeps
  // new content from quietly reintroducing the problem.
  for (const step of content.steps) {
    if (!step.interactive) continue;
    interactiveCount++;
    if (step.stdin === undefined) {
      fail(
        `${step.id} reads input but has no "stdin" sample. ` +
          `Add one that lets the program run to completion.`,
      );
    }
  }

  // 7. Exercise dependencies are explicit, unique, and valid for the language.
  for (const example of content.examples) {
    const seenDependencies = new Set<string>();
    for (const dependency of example.dependencies ?? []) {
      const key = `${dependency.kind}:${dependency.package}:${dependency.module}`;
      if (seenDependencies.has(key)) fail(`${example.id} declares duplicate dependency ${dependency.package}`);
      seenDependencies.add(key);
      if (dependency.kind === "python-package" && example.language !== "python") {
        fail(`${example.id} declares Python package ${dependency.package} but its language is ${example.language}`);
      }
    }
  }

  // 8. Scaffold files must have exactly one valid content source.
  for (const step of content.steps) {
    for (const file of step.scaffold?.files ?? []) {
      const sources = [file.content, file.contentBase64, file.fromExercise]
        .filter((value) => value !== undefined).length;
      if (sources !== 1) fail(`${step.id} scaffold file ${file.path} must have exactly one content source`);
      if (file.contentBase64 !== undefined) {
        const decoded = Buffer.from(file.contentBase64, "base64");
        if (decoded.length === 0 || decoded.toString("base64") !== file.contentBase64) {
          fail(`${step.id} scaffold file ${file.path} has invalid base64 content`);
        }
      }
    }
  }

  // 9. Every published step must have a deterministic replay.
  for (const step of content.steps) {
    if (!step.replay || step.replay.operations.length === 0) {
      fail(`${step.id} is published but has no replay operations`);
      continue;
    }
    for (const [index, operation] of step.replay.operations.entries()) {
      validateOperation(step.id, `replay operation ${index + 1}`, operation);
    }
    const initialId = step.replay.initialState?.fromExercise;
    if (initialId) {
      const initial = content.steps.find((candidate) => candidate.id === initialId);
      if (!initial) fail(`${step.id} replay references unknown initial exercise ${initialId}`);
      else if ((initial.scaffold?.files.length ?? 0) === 0) {
        fail(`${step.id} initial exercise ${initialId} has no scaffold files`);
      }
    }
    validateEvents(step.id, "replay event", step.replay.events ?? []);
    validateEvents(step.id, "pre-plan event", step.replay.prePlanEvents ?? [], true);
    if (step.replay.workflow) validateWorkflow(step.id, step.replay.workflow);
  }
} catch (e) {
  fail(`strict load failed: ${(e as Error).message}`);
}

function unsafeReplayPath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path) || path.split(/[\\/]+/).includes("..");
}

function validateOperation(stepId: string, label: string, operation: ReplayOperation): void {
  const path = operation.type === "command" ? operation.cwd : operation.path;
  if (path !== undefined && unsafeReplayPath(path)) {
    fail(`${stepId} ${label} has an unsafe path "${path}"`);
  }
  if (operation.type === "command" && operation.command.length === 0) {
    fail(`${stepId} ${label} has an empty command`);
  }
}

function validateEvents(stepId: string, label: string, events: ReplayEvent[], prePlan = false): void {
  events.forEach((event, index) => {
    if (event.type !== "operation") return;
    validateOperation(stepId, `${label} ${index + 1}`, event.operation);
    if (prePlan && event.operation.type !== "read" && !(event.operation.type === "command" && event.operation.readOnly)) {
      fail(`${stepId} pre-plan event ${index + 1} must be a read or a command marked readOnly`);
    }
  });
}

function validateWorkflow(stepId: string, workflow: PlanWorkflow): void {
  const questions = new Map<string, Set<string>>();
  for (const [index, question] of workflow.questions.entries()) {
    if (questions.has(question.id)) fail(`${stepId} workflow has duplicate question id "${question.id}"`);
    const options = new Set<string>();
    for (const option of question.options) {
      if (options.has(option.id)) fail(`${stepId} workflow question ${question.id} has duplicate option "${option.id}"`);
      options.add(option.id);
    }
    questions.set(question.id, options);
    for (const [dependency, answer] of Object.entries(question.when ?? {})) {
      const prior = workflow.questions.slice(0, index).find((candidate) => candidate.id === dependency);
      if (!prior) {
        fail(`${stepId} workflow question ${question.id} depends on unknown or later question "${dependency}"`);
      } else if (!prior.options.some((option) => option.id === answer)) {
        fail(`${stepId} workflow question ${question.id} depends on unknown option "${dependency}=${answer}"`);
      }
    }
  }

  const completedGroups = new Set<string>();
  let currentGroup: string | undefined;
  for (const question of workflow.questions) {
    if (question.group === currentGroup) continue;
    if (currentGroup) completedGroups.add(currentGroup);
    currentGroup = question.group;
    if (currentGroup && completedGroups.has(currentGroup)) {
      fail(`${stepId} workflow question group "${currentGroup}" must be contiguous`);
    }
  }

  validateAnswers(stepId, "canonical workflow", workflow, workflow.canonicalAnswers);
  const interludeQuestions = new Set<string>();
  for (const [index, interlude] of (workflow.interludes ?? []).entries()) {
    if (!questions.has(interlude.afterQuestion)) {
      fail(`${stepId} workflow interlude ${index + 1} follows unknown question "${interlude.afterQuestion}"`);
    }
    if (interludeQuestions.has(interlude.afterQuestion)) {
      fail(`${stepId} workflow has more than one interlude after "${interlude.afterQuestion}"`);
    }
    interludeQuestions.add(interlude.afterQuestion);
    validateEvents(stepId, `workflow interlude ${interlude.afterQuestion} event`, interlude.events, true);
  }
  const variantIds = new Set<string>();
  for (const variant of workflow.variants ?? []) {
    if (variantIds.has(variant.id)) fail(`${stepId} workflow has duplicate variant id "${variant.id}"`);
    variantIds.add(variant.id);
    validateAnswers(stepId, `variant ${variant.id}`, workflow, variant.answers);
    variant.operations.forEach((operation, index) =>
      validateOperation(stepId, `variant ${variant.id} operation ${index + 1}`, operation));
    validateEvents(stepId, `variant ${variant.id} event`, variant.events ?? []);
  }
}

function validateAnswers(
  stepId: string,
  label: string,
  workflow: PlanWorkflow,
  answers: Record<string, string>,
): void {
  const known = new Set(workflow.questions.map((question) => question.id));
  for (const questionId of Object.keys(answers)) {
    if (!known.has(questionId)) fail(`${stepId} ${label} answers unknown question "${questionId}"`);
  }
  for (const question of workflow.questions) {
    const applicable = Object.entries(question.when ?? {}).every(([id, option]) => answers[id] === option);
    const answer = answers[question.id];
    if (!applicable) {
      if (answer !== undefined) fail(`${stepId} ${label} answers inapplicable question "${question.id}"`);
      continue;
    }
    if (answer === undefined) {
      fail(`${stepId} ${label} has no answer for applicable question "${question.id}"`);
    } else if (!question.options.some((option) => option.id === answer)) {
      fail(`${stepId} ${label} uses unknown option "${question.id}=${answer}"`);
    }
  }
}

// --- Report ----------------------------------------------------------------

if (errors.length > 0) {
  console.error(`✗ ${errors.length} problem(s) in books/:\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const unpublished =
  draftCount || retiredCount ? `, ${draftCount} draft, ${retiredCount} retired (not served)` : "";
console.log(
  `✓ ${filenames.length} book(s), ${exampleCount} published examples, ${stepCount} steps ` +
    `(${interactiveCount} interactive, all with sample input)${unpublished}, ` +
    `${seen.size} unique ids, schema valid.`,
);
