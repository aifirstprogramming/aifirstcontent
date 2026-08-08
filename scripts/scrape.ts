#!/usr/bin/env bun
/**
 * Compare the book manuscripts against the content pack, and optionally apply.
 *
 * The books are the source of truth for the code a reader sees, but which
 * differences to accept is editorial, so this reports by default and only writes
 * when asked. What it will and will not apply automatically is documented in
 * scripts/lib/apply.ts — in short, it applies what it can be certain of and
 * reports the fuzzy cases for a human.
 *
 * Usage:
 *   bun scripts/scrape.ts                  report both books
 *   bun scripts/scrape.ts --book java      one book
 *   bun scripts/scrape.ts --new            list new examples individually
 *   bun scripts/scrape.ts --show <id>      shipped vs manuscript for one id
 *   bun scripts/scrape.ts --write          apply, then run `bun run ids`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { applyToBook, bookChapters, type Classification } from "./lib/apply";
import { codeKey, promptKey, readParagraphs } from "./lib/docx";
import { BOOKS, manuscriptFiles, mineBook, type BookConfig, type MinedExample } from "./lib/mine";

const BOOKS_DIR = join(import.meta.dir, "..", "books");

interface ShippedStep {
  id: string;
  prompt: string;
  response: string;
  chapter: number;
  exampleId: string;
  title: string;
  status?: string;
}

function bookFile(tag: string): string {
  for (const name of readdirSync(BOOKS_DIR).filter((f) => f.endsWith(".json"))) {
    if (JSON.parse(readFileSync(join(BOOKS_DIR, name), "utf8")).tag === tag) return name;
  }
  throw new Error(`No book file with tag "${tag}"`);
}

function shippedSteps(filename: string): ShippedStep[] {
  const book = JSON.parse(readFileSync(join(BOOKS_DIR, filename), "utf8"));
  const out: ShippedStep[] = [];
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      const num = Number(/chapter\s+(\d+)/i.exec(chapter.title)?.[1] ?? 0);
      for (const ex of chapter.examples ?? []) {
        for (const st of ex.prompts ?? [ex]) {
          const resp = Array.isArray(st.response) ? st.response.join("\n") : (st.response ?? "");
          out.push({
            id: st.id ?? ex.id,
            prompt: st.prompt,
            response: resp,
            chapter: num,
            exampleId: ex.id,
            title: ex.title,
            status: ex.status,
          });
        }
      }
    }
  }
  return out;
}

// --- similarity ------------------------------------------------------------

/** Enough code that an exact match is unlikely to be a coincidence. */
function substantial(code: string): boolean {
  const lines = code.split("\n").filter((l) => l.trim() !== "");
  return lines.length >= 2 && code.replace(/\s/g, "").length >= 40;
}

/** Jaccard overlap of significant words. */
function overlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      promptKey(s)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  // Jaccard, not min-size: "Write a Hello World app" and "Write a program that
  // says hello three times" share two words and would otherwise look alike.
  return shared / (wa.size + wb.size - shared);
}

/** Fraction of shared non-blank code lines. */
function lineOverlap(a: string, b: string): number {
  const lines = (s: string) =>
    new Set(
      codeKey(s)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
  const la = lines(a);
  const lb = lines(b);
  if (la.size === 0 || lb.size === 0) return 0;
  let shared = 0;
  for (const l of la) if (lb.has(l)) shared++;
  return shared / Math.min(la.size, lb.size);
}

/** Human-readable summary of how two code blocks differ. */
function describeDiff(ours: string, theirs: string): string {
  const a = codeKey(ours).split("\n");
  const b = codeKey(theirs).split("\n");
  const nonBlank = (x: string[]) => x.filter((l) => l.trim() !== "").join("\n");
  if (nonBlank(a) === nonBlank(b)) {
    const d = b.filter((l) => !l.trim()).length - a.filter((l) => !l.trim()).length;
    const n = Math.abs(d);
    return d > 0
      ? `ours is missing ${n} blank line${n === 1 ? "" : "s"}`
      : `ours has ${n} extra blank line${n === 1 ? "" : "s"}`;
  }
  return `code changed (${a.length} lines ours, ${b.length} theirs)`;
}

/**
 * Pair revised exercises — prompt reworded *and* code changed — globally.
 *
 * Greedy over the best-scoring pairs rather than first-come, because an earlier
 * example would otherwise claim a mined match that suits a later one better.
 */
function assignRevisions(
  unmatched: ShippedStep[],
  mined: MinedExample[],
  minedIsShipped: (m: MinedExample) => boolean,
): Map<string, MinedExample> {
  const free = mined.filter((m) => m.response && !minedIsShipped(m));
  const pairs: { id: string; mined: MinedExample; score: number }[] = [];
  for (const st of unmatched) {
    for (const m of free) {
      // A revision rewords the prompt but keeps most of the code, so require both.
      if (lineOverlap(st.response, m.response!) < 0.4) continue;
      const score = overlap(st.prompt, m.prompt);
      // Deliberately high: a weak match pairs unrelated exercises, and a wrong
      // pairing costs more than reporting one extra new example.
      if (score < 0.5) continue;
      pairs.push({ id: st.id, mined: m, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const out = new Map<string, MinedExample>();
  const used = new Set<MinedExample>();
  for (const p of pairs) {
    if (out.has(p.id) || used.has(p.mined)) continue;
    out.set(p.id, p.mined);
    used.add(p.mined);
  }
  return out;
}

// --- classify one book -----------------------------------------------------

interface Counts {
  drift: number;
  reworded: number;
  revised: number;
  unmined: number;
  absent: number;
  added: number;
}

interface Report {
  lines: string[];
  plan: Classification;
  counts: Counts;
  perChapter: Map<number, { total: number; withCode: number }>;
  minedCount: number;
  shippedCount: number;
}

function classify(cfg: BookConfig, detailNew: boolean): Report {
  const filename = bookFile(cfg.tag);
  const mined = mineBook(cfg);
  const shipped = shippedSteps(filename);
  const chaptersInBook = bookChapters(BOOKS_DIR, filename);

  // Every word of the manuscripts, for telling absence apart from a missed
  // extraction.
  const fullText = promptKey(
    manuscriptFiles(cfg)
      .flatMap(({ path }) => readParagraphs(path).map((p) => p.text))
      .join("\n"),
  );

  const byPrompt = new Map<string, MinedExample>();
  for (const m of mined) if (!byPrompt.has(promptKey(m.prompt))) byPrompt.set(promptKey(m.prompt), m);
  const byCode = new Map<string, MinedExample>();
  for (const m of mined) if (m.response && !byCode.has(codeKey(m.response))) byCode.set(codeKey(m.response), m);

  const shippedPromptKeys = new Set(shipped.map((s) => promptKey(s.prompt)));
  const revisions = assignRevisions(
    shipped.filter((s) => !byPrompt.has(promptKey(s.prompt)) && s.status !== "retired"),
    mined,
    (m) => shippedPromptKeys.has(promptKey(m.prompt)),
  );

  const lines: string[] = [];
  const plan: Classification = { drift: [], reworded: [], retire: [], add: [] };
  const counts: Counts = { drift: 0, reworded: 0, revised: 0, unmined: 0, absent: 0, added: 0 };
  const claimed = new Set<string>();

  for (const st of shipped) {
    // Already retired: nothing left to decide about it, but its prompt still
    // accounts for a mined example so it is not re-imported as new.
    if (st.status === "retired") {
      claimed.add(promptKey(st.prompt));
      continue;
    }

    const key = promptKey(st.prompt);
    const m = byPrompt.get(key);

    if (m) {
      claimed.add(key);
      if (m.chapter !== st.chapter && m.chapter !== 0) {
        lines.push(`  moved    ${st.id.padEnd(12)} chapter ${st.chapter} -> ${m.chapter}`);
      }
      if (!m.response) {
        lines.push(`  no-code  ${st.id.padEnd(12)} prompt found but no listing (screenshot?)`);
        continue;
      }
      if (codeKey(m.response) !== codeKey(st.response)) {
        counts.drift++;
        plan.drift.push({ id: st.id, response: m.response });
        lines.push(`  drift    ${st.id.padEnd(12)} ${describeDiff(st.response, m.response)}`);
      }
      continue;
    }

    // Code identical, prompt rewritten.
    const sameCode = byCode.get(codeKey(st.response));
    if (sameCode && substantial(st.response) && overlap(st.prompt, sameCode.prompt) >= 0.4) {
      claimed.add(promptKey(sameCode.prompt));
      counts.reworded++;
      plan.reworded.push({ id: st.id, prompt: sameCode.prompt });
      lines.push(`  reworded ${st.id.padEnd(12)} code unchanged, prompt rewritten`);
      lines.push(`             ours : ${st.prompt.slice(0, 66)}`);
      lines.push(`             book : ${sameCode.prompt.slice(0, 66)}`);
      continue;
    }

    // Both changed. Only ever a fuzzy guess, so it is reported and never applied:
    // mistakenly pairing two exercises would overwrite a good one.
    const revised = revisions.get(st.id);
    if (revised) {
      claimed.add(promptKey(revised.prompt));
      counts.revised++;
      lines.push(`  revised  ${st.id.padEnd(12)} prompt and code both changed — confirm by hand`);
      lines.push(`             ours : ${st.prompt.slice(0, 66)}`);
      lines.push(`             book : ${revised.prompt.slice(0, 66)}`);
      continue;
    }

    // An extraction gap must never be mistaken for a deletion.
    if (fullText.includes(promptKey(st.prompt))) {
      counts.unmined++;
      lines.push(`  unmined  ${st.id.padEnd(12)} in the text but not extracted — "${st.title}"`);
      continue;
    }

    counts.absent++;
    plan.retire.push(st.id);
    lines.push(`  absent   ${st.id.padEnd(12)} not in the manuscripts — retiring "${st.title}"`);
  }

  // Everything mined that the pack doesn't already account for.
  const fresh = mined.filter((m) => m.response && !claimed.has(promptKey(m.prompt)));

  const perChapter = new Map<number, { total: number; withCode: number }>();
  for (const m of mined) {
    const e = perChapter.get(m.chapter) ?? { total: 0, withCode: 0 };
    e.total++;
    if (m.response) e.withCode++;
    perChapter.set(m.chapter, e);
  }

  const freshByChapter = new Map<number, MinedExample[]>();
  for (const f of fresh) freshByChapter.set(f.chapter, [...(freshByChapter.get(f.chapter) ?? []), f]);

  lines.push("");
  lines.push(`  new      ${fresh.length} example(s) to import as drafts:`);
  for (const c of [...freshByChapter.keys()].sort((a, b) => a - b)) {
    const list = freshByChapter.get(c)!;
    if (!chaptersInBook.has(c)) {
      // Never invent a chapter: a caption number we can't place is a content
      // question, not something to guess at.
      lines.push(
        `             ch${String(c).padEnd(3)} ${String(list.length).padStart(3)}   SKIPPED — no chapter ${c} in the pack`,
      );
      continue;
    }
    const kinds = new Map<string, number>();
    for (const f of list) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    lines.push(
      `             ch${String(c).padEnd(3)} ${String(list.length).padStart(3)}   ` +
        [...kinds.entries()].map(([k, n]) => `${n} ${k}`).join(", "),
    );
    for (const f of list) {
      counts.added++;
      plan.add.push({
        chapter: c,
        example: {
          title: f.suggestedTitle || f.prompt.slice(0, 60),
          kind: f.kind,
          status: "draft",
          prompt: f.prompt,
          response: f.response!,
        },
      });
      if (detailNew) lines.push(`                    [${f.kind}] ${f.prompt.slice(0, 84)}`);
    }
  }

  return { lines, plan, counts, perChapter, minedCount: mined.length, shippedCount: shipped.length };
}

// --- main ------------------------------------------------------------------

const argv = process.argv.slice(2);
const only = argv.includes("--book") ? argv[argv.indexOf("--book") + 1] : undefined;
const showId = argv.includes("--show") ? argv[argv.indexOf("--show") + 1] : undefined;
const detailNew = argv.includes("--new");
const write = argv.includes("--write");

const totals: Counts = { drift: 0, reworded: 0, revised: 0, unmined: 0, absent: 0, added: 0 };

for (const cfg of BOOKS) {
  if (only && only !== cfg.tag) continue;
  const filename = bookFile(cfg.tag);

  if (showId) {
    const st = shippedSteps(filename).find((s) => s.id === showId);
    if (!st) continue;
    const m = mineBook(cfg).find((x) => promptKey(x.prompt) === promptKey(st.prompt));
    console.log(`--- ${showId} shipped ---\n${codeKey(st.response)}`);
    console.log(`\n--- ${showId} manuscript ---\n${m?.response ? codeKey(m.response) : "(not found)"}\n`);
    continue;
  }

  const report = classify(cfg, detailNew);
  console.log("=".repeat(76));
  console.log(`${cfg.tag.toUpperCase()}  ${report.minedCount} mined, ${report.shippedCount} shipped steps`);
  console.log("=".repeat(76));
  console.log(
    "  " +
      [...report.perChapter.keys()]
        .sort((a, b) => a - b)
        .map((c) => `ch${c}:${report.perChapter.get(c)!.total}/${report.perChapter.get(c)!.withCode}`)
        .join("  ") +
      "   (mined/with-code)",
  );
  console.log();
  for (const l of report.lines) console.log(l);
  console.log();

  for (const k of Object.keys(totals) as (keyof Counts)[]) totals[k] += report.counts[k];

  if (write) {
    const notes = applyToBook(BOOKS_DIR, filename, report.plan);
    console.log(`  wrote ${filename}: ${notes.length} change(s)`);
    console.log();
  }
}

if (!showId) {
  console.log("=".repeat(76));
  console.log(
    `${totals.added} new, ${totals.drift} drifted, ${totals.reworded} reworded, ` +
      `${totals.revised} revised, ${totals.unmined} unmined, ${totals.absent} retired.`,
  );
  console.log(
    write
      ? "Applied. Now run `bun run ids`, then `bun run check`."
      : "Nothing written. Re-run with --write to apply.",
  );
}
