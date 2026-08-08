/**
 * Extract prompt/response pairs from the book manuscripts.
 *
 * The two books mark prompts differently, so there are two strategies:
 *
 *   Java    Prompts are labelled. A BodyText paragraph reading "Prompt: …" is
 *           followed by the Code run it produced. Pseudo-code and syntax
 *           listings have no preceding label, which is how they stay out.
 *
 *   Python  Prompts are not labelled at all: they are Code-styled prose, and so
 *           is program output, so they cannot be told apart by their text. What
 *           is reliable is the structure — a prompt always precedes the listing
 *           it generated. So anchor on each listing and walk *back* to the
 *           nearest Code-styled prose paragraph.
 *
 *           Program output is itself a listing, and walking back from one lands
 *           on a prompt an earlier listing already claimed. A listing whose
 *           prompt is already taken is therefore output, not a new example. That
 *           falls out of the algorithm with no caption-text guessing.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readParagraphs, type Paragraph } from "./docx";

export type BookTag = "java" | "py";

/** How runnable an example is, which decides how the CLI can execute it. */
export type Kind = "program" | "class" | "test" | "snippet" | "project";

export interface MinedExample {
  book: BookTag;
  /** Chapter the example belongs to, from the listing caption where possible. */
  chapter: number;
  prompt: string;
  response: string | null;
  /** Listing caption, verbatim. */
  caption: string | null;
  /** Nearest preceding heading, which often reads better as a title. */
  heading: string | null;
  suggestedTitle: string | null;
  kind: Kind;
  source: string;
}

export interface BookConfig {
  tag: BookTag;
  language: string;
  root: string;
  /**
   * Whether the book's Appendix carries exercises. Python's Appendix is a real
   * content chapter ("Core Concepts") whose listings keep chapter-2 numbering;
   * Java's is a data-type reference table with no prompts.
   */
  includeAppendix: boolean;
}

export const BOOKS: BookConfig[] = [
  {
    tag: "java",
    language: "java",
    root: "/home/steve/Nextcloud/Book Writing/AI First Java Programming",
    includeAppendix: false,
  },
  {
    tag: "py",
    language: "python",
    root: "/home/steve/Nextcloud/Book Writing/AI First Python Programming/Chapters",
    includeAppendix: true,
  },
];

const PROMPT_LABEL = /^\s*prompt\s*[:\-–]\s*(.+)$/i;
/**
 * "Code Block 4-3: title", "Listing 4-1. description".
 *
 * The sequence part may be a placeholder in a chapter still being written
 * ("Listing 4-x."), so it is matched loosely — the chapter number is the part we
 * actually need.
 */
const CAPTION = /^\s*(?:code block|listing)\s*(\d+)\s*[-.]\s*([\dxX?]+)\s*[:.]?\s*(.*)$/i;
const HEADING = /^Heading[1-9]$|^ChapterTitle$/;
/** Characters and openings that mean "this is code, not an English sentence". */
const CODEY = /[{};=<>[\]]|^\s*(#|\/\/|import |from |public |def |class |print\()|\w+\(/;
/** Styles a listing body can use. The Python manuscripts are inconsistent here. */
const BODY_STYLES = new Set(["Code", "BodyTextFirst", "BodyTextCont"]);
/**
 * Styles a Python prompt may carry.
 *
 * Normally Code. Some prompts are mis-styled — one in the Appendix is tagged
 * TableCaption. Both are styles that should never hold running prose, so prose
 * found in them is a strong signal it is a prompt. Ordinary BodyText is
 * deliberately excluded: it is everywhere, and accepting it would turn narrative
 * paragraphs into prompts.
 */
const PROMPT_STYLES = new Set(["Code", "TableCaption"]);

/** Chapter files for a book, skipping historical copies and non-content files. */
export function manuscriptFiles(cfg: BookConfig): { chapter: number; path: string }[] {
  if (!existsSync(cfg.root)) throw new Error(`Manuscript folder not found: ${cfg.root}`);
  const out: { chapter: number; path: string }[] = [];
  for (const name of readdirSync(cfg.root).sort()) {
    if (!name.toLowerCase().endsWith(".docx") || name.startsWith("~$")) continue;
    const low = name.toLowerCase();
    // Front matter, scratch files, proposals and pre-edit copies are not content.
    if (/front matter|scratch|proposal|before /.test(low)) continue;
    if (low.includes("appendix")) {
      if (cfg.includeAppendix) out.push({ chapter: 0, path: join(cfg.root, name) });
      continue;
    }
    // Tolerates the "Chaper 1.docx" typo in the Python folder.
    const m = low.match(/cha\w*?\s*(\d+)/);
    if (m) out.push({ chapter: Number(m[1]), path: join(cfg.root, name) });
  }
  return out.sort((a, b) => a.chapter - b.chapter);
}

function parseCaption(text: string): { chapter: number; seq: number | null; rest: string } | null {
  const m = CAPTION.exec(text);
  if (!m) return null;
  const seq = /^\d+$/.test(m[2]) ? Number(m[2]) : null; // null for "4-x" placeholders
  return { chapter: Number(m[1]), seq, rest: m[3].trim() };
}

/** A prompt reads like a sentence; code does not. */
function isProse(text: string): boolean {
  const t = text.trim();
  if (t.length < 15 || t.length > 500) return false;
  if (CODEY.test(t)) return false;
  return t.split(/\s+/).length >= 4;
}

export function inferKind(language: string, code: string): Kind {
  if (/@Test\b/.test(code)) return "test";
  if (language === "java") {
    if (/static\s+void\s+main\s*\(/.test(code)) return "program";
    if (/\b(class|interface|enum|record)\s+\w+/.test(code)) return "class";
    return "snippet";
  }
  // Python: any top-level statement makes it runnable. Indented-only or pure
  // def/class bodies are snippets.
  const hasTopLevel = code
    .split("\n")
    .some((l) => l.trim() !== "" && !/^\s/.test(l) && !/^(def |class |import |from |#|@)/.test(l));
  if (hasTopLevel) return "program";
  if (/^\s*(def |class )/m.test(code)) return "snippet";
  return "snippet";
}

/** Title for the example: Java captions name it; Python captions describe it. */
function suggestTitle(tag: BookTag, caption: string | null, heading: string | null): string | null {
  if (tag === "java") {
    const parsed = caption ? parseCaption(caption) : null;
    if (parsed?.rest) return trimTitle(parsed.rest);
    return heading ? trimTitle(heading) : null;
  }
  // Python captions read "Code generated which creates the shopping list…" —
  // a description. The nearest heading is usually the better title.
  if (heading) return trimTitle(heading);
  const parsed = caption ? parseCaption(caption) : null;
  return parsed?.rest ? trimTitle(parsed.rest) : null;
}

function trimTitle(s: string): string {
  return s
    .replace(/^(the\s+)?code\s+(generated|that|which)\s+/i, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Track the nearest preceding heading as we scan. */
function headingsBefore(paras: Paragraph[]): (string | null)[] {
  const out: (string | null)[] = [];
  let current: string | null = null;
  for (const p of paras) {
    if (HEADING.test(p.style) && p.text.trim()) current = p.text.trim();
    out.push(current);
  }
  return out;
}

export function mineJava(paras: Paragraph[], cfg: BookConfig, fileChapter: number, source: string): MinedExample[] {
  const heads = headingsBefore(paras);
  const found: MinedExample[] = [];
  let i = 0;

  while (i < paras.length) {
    const label = PROMPT_LABEL.exec(paras[i].text);
    if (!label || paras[i].style === "Code") {
      i++;
      continue;
    }
    const prompt = label[1].trim();

    // Walk forward to the Code run this prompt produced, stopping if another
    // prompt intervenes (a prompt whose listing is a screenshot).
    let j = i + 1;
    while (j < paras.length && paras[j].style !== "Code") {
      if (PROMPT_LABEL.test(paras[j].text)) break;
      j++;
    }
    if (j >= paras.length || paras[j].style !== "Code") {
      found.push(blank(cfg, fileChapter, prompt, heads[i], source));
      i++;
      continue;
    }

    const body: string[] = [];
    let k = j;
    while (k < paras.length && paras[k].style === "Code") body.push(paras[k++].text);
    const caption = k < paras.length && paras[k].style === "CodeCaption" ? paras[k].text : null;
    const response = body.join("\n").replace(/\s+$/, "");
    const parsed = caption ? parseCaption(caption) : null;

    found.push({
      book: cfg.tag,
      chapter: parsed?.chapter ?? fileChapter,
      prompt,
      response: response || null,
      caption,
      heading: heads[i],
      suggestedTitle: suggestTitle(cfg.tag, caption, heads[i]),
      kind: inferKind(cfg.language, response),
      source,
    });
    i = k;
  }
  return found;
}

export function minePython(paras: Paragraph[], cfg: BookConfig, fileChapter: number, source: string): MinedExample[] {
  const heads = headingsBefore(paras);
  const found: MinedExample[] = [];
  const claimed = new Set<number>();

  for (let i = 0; i < paras.length; i++) {
    if (paras[i].style !== "CodeCaption") continue;

    // Body of this listing: the following run of one consistent style.
    let k = i + 1;
    if (k >= paras.length || !BODY_STYLES.has(paras[k].style)) continue;
    const bodyStyle = paras[k].style;
    const body: string[] = [];
    while (k < paras.length && paras[k].style === bodyStyle) body.push(paras[k++].text);
    const listing = body.join("\n").replace(/\s+$/, "");
    if (!listing.trim()) continue;

    // Walk back for the prompt, not crossing into the previous listing.
    let promptIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (paras[j].style === "CodeCaption") break;
      if (PROMPT_STYLES.has(paras[j].style) && isProse(paras[j].text)) {
        promptIdx = j;
        break;
      }
    }

    // No prompt, or one an earlier listing already used: this listing is program
    // output or a continuation, not a new example.
    if (promptIdx < 0 || claimed.has(promptIdx)) continue;
    claimed.add(promptIdx);

    const caption = paras[i].text;
    const parsed = parseCaption(caption);
    found.push({
      book: cfg.tag,
      chapter: parsed?.chapter ?? fileChapter,
      prompt: paras[promptIdx].text.trim(),
      response: listing,
      caption,
      heading: heads[promptIdx],
      suggestedTitle: suggestTitle(cfg.tag, caption, heads[promptIdx]),
      kind: inferKind(cfg.language, listing),
      source,
    });
  }
  return found;
}

function blank(cfg: BookConfig, chapter: number, prompt: string, heading: string | null, source: string): MinedExample {
  return {
    book: cfg.tag,
    chapter,
    prompt,
    response: null,
    caption: null,
    heading,
    suggestedTitle: heading ? trimTitle(heading) : null,
    kind: "snippet",
    source,
  };
}

/** Mine every chapter of a book. */
export function mineBook(cfg: BookConfig): MinedExample[] {
  const out: MinedExample[] = [];
  for (const { chapter, path } of manuscriptFiles(cfg)) {
    const paras = readParagraphs(path);
    const source = basename(path);
    out.push(
      ...(cfg.tag === "java"
        ? mineJava(paras, cfg, chapter, source)
        : minePython(paras, cfg, chapter, source)),
    );
  }
  return out;
}
