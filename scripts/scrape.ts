#!/usr/bin/env bun
/**
 * Compare the book manuscripts against the content pack.
 *
 * Read-only by design in this phase: it reports what the manuscripts say and how
 * the pack differs, and writes nothing. The books are the source of truth for the
 * code a reader sees, but which differences to accept is an editorial decision,
 * so the report comes first.
 *
 * Usage:
 *   bun scripts/scrape.ts                    report both books
 *   bun scripts/scrape.ts --book java        one book
 *   bun scripts/scrape.ts --new              list new examples in detail
 *   bun scripts/scrape.ts --show <id>        shipped vs manuscript for one id
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { codeKey, promptKey, readParagraphs } from "./lib/docx";
import { BOOKS, manuscriptFiles, mineBook, type BookTag, type MinedExample } from "./lib/mine";

const BOOKS_DIR = join(import.meta.dir, "..", "books");

interface ShippedStep {
  id: string;
  prompt: string;
  response: string;
  chapter: number;
  exampleId: string;
  title: string;
  multiStep: boolean;
}

function shippedSteps(tag: BookTag): ShippedStep[] {
  const out: ShippedStep[] = [];
  for (const name of readdirSync(BOOKS_DIR).filter((f) => f.endsWith(".json"))) {
    const book = JSON.parse(readFileSync(join(BOOKS_DIR, name), "utf8"));
    if (book.tag !== tag) continue;
    for (const section of book.sections ?? []) {
      for (const chapter of section.chapters ?? []) {
        const num = Number(/chapter\s+(\d+)/i.exec(chapter.title)?.[1] ?? 0);
        for (const ex of chapter.examples ?? []) {
          const steps = ex.prompts ?? [ex];
          for (const st of steps) {
            const resp = Array.isArray(st.response) ? st.response.join("\n") : (st.response ?? "");
            out.push({
              id: st.id ?? ex.id,
              prompt: st.prompt,
              response: resp,
              chapter: num,
              exampleId: ex.id,
              title: ex.title,
              multiStep: Boolean(ex.prompts),
            });
          }
        }
      }
    }
  }
  return out;
}

/** Enough code that an exact match is unlikely to be a coincidence. */
function substantial(code: string): boolean {
  const lines = code.split("\n").filter((l) => l.trim() !== "");
  return lines.length >= 2 && code.replace(/\s/g, "").length >= 40;
}

/** Do two prompts share enough words to be a rewording rather than a coincidence? */
function similar(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(
      promptKey(s)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.4;
}

/** Human-readable summary of how two code blocks differ. */
function describeDiff(ours: string, theirs: string): string {
  const a = codeKey(ours).split("\n");
  const b = codeKey(theirs).split("\n");
  const blankA = a.filter((l) => l.trim() === "").length;
  const blankB = b.filter((l) => l.trim() === "").length;
  const nonBlankA = a.filter((l) => l.trim() !== "").join("\n");
  const nonBlankB = b.filter((l) => l.trim() !== "").join("\n");

  if (nonBlankA === nonBlankB) {
    const d = blankB - blankA;
    return d > 0
      ? `ours is missing ${d} blank line${d === 1 ? "" : "s"}`
      : `ours has ${-d} extra blank line${-d === 1 ? "" : "s"}`;
  }
  const changed = Math.abs(b.length - a.length);
  return `code changed (${a.length} lines ours, ${b.length} theirs${changed ? `, ${changed} line delta` : ""})`;
}

const argv = process.argv.slice(2);
const only = argv.includes("--book") ? argv[argv.indexOf("--book") + 1] : undefined;
const showId = argv.includes("--show") ? argv[argv.indexOf("--show") + 1] : undefined;
const detailNew = argv.includes("--new");

let totalNew = 0;
let totalDrift = 0;
let totalAbsent = 0;

for (const cfg of BOOKS) {
  if (only && only !== cfg.tag) continue;

  const mined = mineBook(cfg);
  const shipped = shippedSteps(cfg.tag);

  // Every word of the manuscripts, for telling absence apart from a missed
  // extraction.
  const fullText = promptKey(
    manuscriptFiles(cfg)
      .flatMap(({ path }) => readParagraphs(path).map((p) => p.text))
      .join("\n"),
  );

  // Index the manuscript by prompt. First occurrence wins: a prompt repeated
  // across chapters (rare) is reported as new rather than silently merged.
  const byPrompt = new Map<string, MinedExample>();
  for (const m of mined) if (!byPrompt.has(promptKey(m.prompt))) byPrompt.set(promptKey(m.prompt), m);

  console.log("=".repeat(76));
  console.log(`${cfg.tag.toUpperCase()}  ${mined.length} mined, ${shipped.length} shipped steps`);
  console.log("=".repeat(76));

  // Per-chapter mining counts, so a chapter that yields nothing is obvious.
  const perChapter = new Map<number, { total: number; withCode: number }>();
  for (const m of mined) {
    const e = perChapter.get(m.chapter) ?? { total: 0, withCode: 0 };
    e.total++;
    if (m.response) e.withCode++;
    perChapter.set(m.chapter, e);
  }
  const chapters = [...perChapter.keys()].sort((a, b) => a - b);
  console.log(
    "  " +
      chapters.map((c) => `ch${c}:${perChapter.get(c)!.total}/${perChapter.get(c)!.withCode}`).join("  ") +
      "   (mined/with-code)",
  );
  console.log();

  if (showId) {
    const st = shipped.find((s) => s.id === showId);
    if (st) {
      const m = byPrompt.get(promptKey(st.prompt));
      console.log(`--- ${showId} shipped ---\n${codeKey(st.response)}`);
      console.log(`\n--- ${showId} manuscript ---\n${m?.response ? codeKey(m.response) : "(not found)"}\n`);
    }
    continue;
  }

  // Secondary index by code. A reworded prompt would otherwise be reported as
  // both an absent example and a new one, overstating the size of the change.
  const byCode = new Map<string, MinedExample>();
  for (const m of mined) {
    if (!m.response) continue;
    const key = codeKey(m.response);
    if (!byCode.has(key)) byCode.set(key, m);
  }

  const matchedPrompts = new Set<string>();

  for (const st of shipped) {
    const key = promptKey(st.prompt);
    let m = byPrompt.get(key);

    if (!m) {
      // Same exercise, different wording? Requires the code to be substantial and
      // the two prompts to actually resemble each other — short or common code
      // otherwise pairs unrelated exercises, which is worse than reporting both.
      const byCodeHit = byCode.get(codeKey(st.response));
      if (byCodeHit && substantial(st.response) && similar(st.prompt, byCodeHit.prompt)) {
        matchedPrompts.add(promptKey(byCodeHit.prompt));
        console.log(`  reworded ${st.id.padEnd(12)} code unchanged, prompt rewritten in the book`);
        console.log(`             ours : ${st.prompt.slice(0, 68)}`);
        console.log(`             book : ${byCodeHit.prompt.slice(0, 68)}`);
        continue;
      }
      // Distinguish "the book no longer has this" from "the extractor missed it".
      // Conflating them risks deleting a perfectly good example, so the prompt is
      // also searched for in the raw manuscript text.
      if (fullText.includes(promptKey(st.prompt))) {
        console.log(`  unmined  ${st.id.padEnd(12)} prompt is in the text but was not extracted — "${st.title}"`);
        continue;
      }
      totalAbsent++;
      console.log(`  absent   ${st.id.padEnd(12)} not in the manuscripts at all — "${st.title}"`);
      continue;
    }
    matchedPrompts.add(key);

    if (m.chapter !== st.chapter && m.chapter !== 0) {
      console.log(`  moved    ${st.id.padEnd(12)} chapter ${st.chapter} -> ${m.chapter} (${m.source})`);
    }
    if (!m.response) {
      console.log(`  no-code  ${st.id.padEnd(12)} prompt found but no listing (screenshot?)`);
      continue;
    }
    if (codeKey(m.response) !== codeKey(st.response)) {
      totalDrift++;
      console.log(`  drift    ${st.id.padEnd(12)} ${describeDiff(st.response, m.response)}`);
    }
  }

  // Anything mined that the pack doesn't have.
  const fresh = mined.filter((m) => m.response && !matchedPrompts.has(promptKey(m.prompt)));
  totalNew += fresh.length;
  const freshByChapter = new Map<number, MinedExample[]>();
  for (const f of fresh) freshByChapter.set(f.chapter, [...(freshByChapter.get(f.chapter) ?? []), f]);

  console.log();
  console.log(`  new      ${fresh.length} example(s) not in the pack:`);
  for (const c of [...freshByChapter.keys()].sort((a, b) => a - b)) {
    const list = freshByChapter.get(c)!;
    const kinds = new Map<string, number>();
    for (const f of list) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    const breakdown = [...kinds.entries()].map(([k, n]) => `${n} ${k}`).join(", ");
    console.log(`             ch${String(c).padEnd(3)} ${String(list.length).padStart(3)}   ${breakdown}`);
    if (detailNew) {
      for (const f of list) {
        console.log(`                    [${f.kind}] ${f.prompt.slice(0, 88)}`);
      }
    }
  }
  console.log();
}

if (!showId) {
  console.log("=".repeat(76));
  console.log(
    `${totalNew} new, ${totalDrift} drifted, ${totalAbsent} absent. ` +
      `Nothing written — this phase reports only.`,
  );
}
