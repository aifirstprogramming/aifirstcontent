/**
 * Minimal .docx reader: paragraphs with their Word style, and faithful text.
 *
 * Dev-only — used by the scraper, never shipped to consumers.
 *
 * The interesting part is reconstructing code indentation, which the two books
 * encode differently and which naive text extraction silently loses. Getting it
 * wrong produces code that looks correct in a terminal but isn't byte-equal to
 * the page, and Python code that won't run at all:
 *
 *   Java    <w:tab/> elements before the text, one per indent level.
 *   Python  literal U+00A0 non-breaking spaces interleaved with ordinary spaces,
 *           e.g. "    " for four columns.
 *
 * So runs are walked in document order (a tab has to land where it occurs) and
 * non-breaking spaces are normalised to ordinary ones.
 */

import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

/** How many spaces one <w:tab/> represents in a code listing. */
export const TAB_WIDTH = 4;

export interface Paragraph {
  /** Word paragraph style, e.g. Code, CodeCaption, BodyTextCont, ChapterTitle. */
  style: string;
  text: string;
}

const decoder = new TextDecoder();

/** Read word/document.xml out of a .docx. */
function documentXml(path: string): string {
  const files = unzipSync(new Uint8Array(readFileSync(path)), {
    filter: (f) => f.name === "word/document.xml",
  });
  const entry = files["word/document.xml"];
  if (!entry) throw new Error(`${path} has no word/document.xml — not a .docx?`);
  return decoder.decode(entry);
}

/**
 * Split the body into paragraphs.
 *
 * Hand-rolled rather than XML-parsed: we need the *order* of `<w:t>` text and
 * `<w:tab/>` markers within a paragraph, which is exactly what a DOM walk over
 * text nodes throws away, and a full parser buys nothing else here.
 */
export function readParagraphs(path: string): Paragraph[] {
  const xml = documentXml(path);
  const out: Paragraph[] = [];

  // Paragraphs are <w:p …> … </w:p>, possibly self-closing.
  const paraRe = /<w:p(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/w:p>)/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml)) !== null) {
    const inner = m[1] ?? "";
    const styleMatch = inner.match(/<w:pStyle\s+w:val="([^"]*)"/);
    out.push({ style: styleMatch ? styleMatch[1] : "Normal", text: paragraphText(inner) });
  }
  return out;
}

/** Text of one paragraph, preserving tabs, breaks and literal spacing. */
function paragraphText(inner: string): string {
  let text = "";
  // Tokens that contribute characters, in document order.
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t\s*\/>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(inner)) !== null) {
    const token = m[0];
    if (token.startsWith("<w:tab")) {
      text += " ".repeat(TAB_WIDTH);
    } else if (token.startsWith("<w:br")) {
      text += "\n";
    } else {
      text += decodeEntities(m[1] ?? "");
    }
  }
  // Word uses non-breaking spaces for Python indentation; they are ordinary
  // spaces as far as the code is concerned.
  return text.replace(/ /g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    // Ampersand last, so the replacements above can't re-trigger.
    .replace(/&amp;/g, "&");
}

/**
 * Normalise the typographic characters Word substitutes as you type.
 *
 * Applied when *comparing* text, never when storing code: a curly quote inside a
 * string literal is a real difference, but Word's em-dash in prose is not worth
 * reporting as drift.
 */
export function normalizeTypography(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ");
}

/** Collapse to a comparison key: typography, case and whitespace insensitive. */
export function promptKey(s: string): string {
  return normalizeTypography(s).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Compare code ignoring only trailing whitespace per line and typography. */
export function codeKey(s: string): string {
  return normalizeTypography(s)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}
