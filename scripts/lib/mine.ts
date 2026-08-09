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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readParagraphs, type Paragraph } from "./docx";
import { configHelp, configPath, readLocalConfig } from "./localconfig";

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
  /** Whether the book's Appendix is part of the book. Neither is, today. */
  includeAppendix: boolean;
}

/**
 * What is true about each book regardless of whose machine this runs on.
 *
 * Where the manuscripts actually live is not here: the books are not open source,
 * so their paths belong in a local config file rather than in a public repository.
 */
const BOOK_SHAPE: Omit<BookConfig, "root">[] = [
  {
    tag: "java",
    language: "java",
    includeAppendix: false,
  },
  {
    tag: "py",
    language: "python",
    // The Python Appendix is not part of the book yet and may never be, so it is
    // not a chapter and its examples are not imported.
    includeAppendix: false,
  },
];

/**
 * The books to scrape, with the manuscript root for each.
 *
 * Read lazily and validated up front, so a missing or stale path is one clear
 * message rather than an empty scrape that looks like "nothing changed".
 */
export function books(): BookConfig[] {
  const path = configPath();
  const raw = readLocalConfig() as Record<string, { root?: string } | undefined>;

  const out: BookConfig[] = [];
  for (const shape of BOOK_SHAPE) {
    const root = raw[shape.tag]?.root;
    if (!root) {
      // A book with no configured path is skipped rather than fatal: someone may
      // hold only one manuscript, and scraping the other is still useful.
      continue;
    }
    if (!existsSync(root)) {
      throw new Error(`${path}: the ${shape.tag} root does not exist: ${root}`);
    }
    out.push({ ...shape, root });
  }

  if (out.length === 0) throw new Error(configHelp(path));
  return out;
}

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
/**
 * Captions that introduce program output rather than code.
 *
 * Needed because some exercises show their code as a screenshot and only the
 * *output* as a text listing — py-3-10 is one. Walking back from such a listing
 * finds the right prompt but the wrong body, and the result is output stored as
 * an exercise's code. Execution caught it; this stops it happening.
 */
const OUTPUT_CAPTION =
  /\b(output|printed|prints|printout|result(?:s|ing)? (?:of|from)|console|terminal|displayed)\b/i;

/**
 * Config listings are book content but not exercises.
 *
 * Chapter 6 shows a pom.xml `<dependencies>` block. Mining it as Java produced a
 * file that cannot compile, and no scaffold can fix that -- it is XML.
 */
const CONFIG_BODY = /^\s*<[a-zA-Z?!]/;

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

/**
 * Control-flow keywords that start a statement, never a prompt.
 *
 * Deliberately excludes `print`: "Print the price of a specified item using an f
 * string" is a real exercise, and rejecting leading keywords wholesale threw it
 * away. Only keywords that cannot begin an instruction are listed.
 */
const CONTROL_FLOW = /^(for|while|elif|else|try|except|finally|with|return|yield|def|class|import|from|public|private|static|void)\b/i;

/**
 * Program output very often reads "Label: value" — "Total in cash register: $18",
 * "Color: Blue, Type: Sedan". No prompt in either book is phrased that way, and
 * such lines are Code-styled prose, so nothing else distinguishes them.
 */
const LABELLED_VALUE = /: *\S/;

/**
 * Words that make a line an instruction. Used only to flag a prompt as suspect
 * for review, never to reject one — the list could never be complete, and a
 * missing verb would silently drop a real exercise.
 */
const INSTRUCTION = /\b(write|create|modif|updat|use|using|add|ask|help|print|make|generat|show|build|convert|sort|find|calculat|describ|handl|chang|remov|check|take|explain|implement|fix|unpack|declar|initialis|initializ|refactor|replac)/i;

/** Does this prompt read like an instruction? Informational, not a filter. */
export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION.test(text) || text.trim().endsWith("?");
}

/** Are all parentheses accounted for? A fragment like `else "tie!")` is not. */
function balanced(t: string): boolean {
  let depth = 0;
  for (const ch of t) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * A prompt reads like a sentence; code does not.
 *
 * Every rule here was added because something real slipped through: docstrings
 * ("\"\"\"Check if the pet has enough energy…\"\"\"") are Code-styled prose and were
 * mined as prompts, as were fragments like `for pet in self.__pets` and one line
 * of program output.
 */
function isProse(text: string): boolean {
  const t = text.trim();
  if (t.length < 15 || t.length > 500) return false;
  if (CODEY.test(t)) return false;
  if (t.endsWith(":")) return false; // block opener, so: code
  if (/^(\"\"\"|''')/.test(t) || /(\"\"\"|''')$/.test(t)) return false; // docstring
  if (CONTROL_FLOW.test(t)) return false;
  if (/\bself\.|__/.test(t)) return false; // attribute access or dunder: code
  if (!balanced(t)) return false;
  // "Label: value" is the shape of program output, not of any prompt in either
  // book. This is the last of the output lines that reads as prose.
  if (LABELLED_VALUE.test(t) && !INSTRUCTION.test(t)) return false;
  // Five words, not four: it excludes stray output such as "Inventory change: 9
  // items" while keeping the shortest real prompt, "Write a Hello World app".
  return t.split(/\s+/).length >= 5;
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
    // A listing captioned as output is the program's transcript, not its code. The
    // Python side already skipped these; Java anchors on the prompt label and so had
    // no caption check at all, which is how java-7-01 stored its own output.
    if (caption && OUTPUT_CAPTION.test(caption)) {
      i = k;
      continue;
    }
    // A pom.xml fragment is instructional but not an exercise; mined as Java it
    // could never compile, and no scaffold can make XML into a program.
    //
    // This loop advances `i` by hand, so skipping must step past the listing too. A
    // bare `continue` here spins on the same paragraph forever -- it hung the scraper.
    if (CONFIG_BODY.test(response)) {
      i = k;
      continue;
    }
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
    // An output listing never supplies an example's code, and must not claim the
    // prompt either: doing so would hide the real listing behind an already-taken
    // prompt.
    if (OUTPUT_CAPTION.test(paras[i].text)) continue;

    // Body of this listing: the following run of one consistent style.
    let k = i + 1;
    if (k >= paras.length || !BODY_STYLES.has(paras[k].style)) continue;
    const bodyStyle = paras[k].style;
    const body: string[] = [];
    // Stop at prose. A prompt is Code-styled and so is the commentary that follows a
    // listing, so "the next run of one style" swallowed a whole paragraph of text into
    // py-4-01's code and made it unrunnable.
    while (k < paras.length && paras[k].style === bodyStyle && !isProse(paras[k].text)) {
      body.push(paras[k++].text);
    }
    const listing = body.join("\n").replace(/\s+$/, "");
    if (CONFIG_BODY.test(listing)) continue;
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
