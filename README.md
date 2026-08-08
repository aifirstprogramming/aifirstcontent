# @aifirst/content

Canonical content for the [AI First](https://aifirstprogramming.com) Apress book series, plus the
shared TypeScript loader and prompt matcher.

This repo is the **single source of truth** for book examples. Two consumers depend on it:

- [`aifirstcli`](https://github.com/aifirstprogramming/aifirstcli) — the `aifirst` CLI, which embeds
  the content pack and serves canonical answers to Claude Code, Codex, and Antigravity.
- [`aifirstextension`](https://github.com/aifirstprogramming/aifirstextension) — the AI First VS Code
  extension.

Both resolve a learner's prompt through the same `matcher.ts` in this package. That is deliberate: it
makes "you get exactly the answer printed in the book" a structural property of the system rather than
something two codebases have to independently remember to do.

## Layout

```
books/                  authored book content, one JSON per book
schema/                 JSON Schema for books/*.json
src/
  types.ts              raw (on-disk) and normalized types
  loader.ts             walk book JSON -> flat examples and steps
  matcher.ts            prompt -> response matching (exact, partial, fuzzy)
  ids.ts                exercise id parse/validate/resolve
scripts/
  add-ids.ts            assign ids to new content (idempotent)
  validate.ts           CI gate: schema + global id uniqueness + strict load
```

## Content model

A book declares its own identity, so adding a book to the series is a content change and never a code
change in the CLI or the extension:

```jsonc
{ "title": "AI First Python Programming",
  "tag": "py",           // prefix for this book's exercise ids
  "language": "python",  // matches VS Code's language ids
  "sections": [ ... ] }
```

A book is `sections → chapters → examples`. An example is authored in one of two forms, never both:

```jsonc
// single prompt
{ "id": "py-1-01", "title": "Hello World", "description": "...",
  "prompt": "Write a Hello World app", "response": "print(\"Hello, World!\")" }

// progressive steps, where each step typically modifies the previous result
{ "id": "py-3-01", "title": "Temperature Hat Check", "description": "...",
  "prompts": [
    { "id": "py-3-01.1", "prompt": "...", "response": ["line", "line"] },
    { "id": "py-3-01.2", "prompt": "Modify this code to ...", "response": ["..."] }
  ] }
```

`response` may be a string or an array of lines; arrays are joined with `\n`. The loader normalizes
this so consumers only ever see a single string, and `test/golden.test.ts` asserts the normalization is
byte-exact against the authored JSON.

For single-prompt examples the loader synthesizes one step whose id **equals** the example id, so
consumers never need to branch on which authored form was used.

## Exercise ids

Ids are **authored, never derived**: `<bookTag>-<chapter>-<seq>[.<step>]`, e.g. `py-2-06`,
`java-3-05.4`. Book tags are `py` and `java`.

This matters because learner progress is keyed on these ids. Deriving them from array position would
renumber every later exercise the moment an author inserts one mid-chapter, silently corrupting
progress logs; deriving them from titles would break on the retitling that happens throughout editing.

Rules:

- An id, once published, is never renumbered or reused.
- Ids are unique across **all** books, enforced by `scripts/validate.ts` in CI.
- Step ids are always `<exampleId>.<n>`, 1-based and contiguous.

Adding new content: author it without ids, then run `bun run ids`. The script only fills in missing ids
and seeds its counter past the highest existing one in the chapter, so it never disturbs published ids.

## Exercises that read input

Eleven steps read from stdin (`input()`, `Scanner`). Those carry a sample:

```jsonc
{ "id": "py-3-10", "prompt": "...", "response": [...], "stdin": "stop\n" }
```

This is not optional polish. An assistant cannot type into a running program — Claude Code's `!`
prefix does not attach an interactive stdin
([claude-code#47103](https://github.com/anthropics/claude-code/issues/47103)) — so without a sample,
those exercises could never be completed through one. `scripts/validate.ts` fails if an input-reading
step has no sample, and the loader derives the `interactive` flag from the code itself so it cannot
drift from what the code actually does.

Choose samples that reach the behaviour the exercise teaches. The three Temperature Hat Check steps
use `5`, `20` and `35` so the `if`, the `else` and the `elif` each actually fire.

When a learner runs an exercise from a real terminal, the CLI attaches their keyboard instead and the
sample is unused.

## Importing from the manuscripts

`bun run scrape` compares the Word manuscripts against this pack and reports; add
`--write` to apply, then `bun run ids`.

```sh
bun run scrape                 # report both books, write nothing
bun run scrape --book java     # one book
bun run scrape --new           # list new examples individually
bun run scrape --show py-3-08  # ours vs the book, for one exercise
bun run scrape --write         # apply, then: bun run ids && bun run check
```

The manuscript paths are hard-coded in `scripts/lib/mine.ts` and point at a local
Nextcloud folder, **so this cannot run in CI** — it is an authoring tool. Its
output is committed; CI validates the result.

What it applies automatically and what it refuses to is the design, documented in
`scripts/lib/apply.ts`. Briefly: it takes the book's code when only the code
differs, and the book's prompt when only the prompt differs. It retires an
exercise the manuscripts no longer contain, keeping the id so a learner's existing
progress entry still refers to something. It imports new exercises as drafts. It
never applies a change where both the prompt and the code moved, because that
pairing is only ever a guess — those are reported for a human.

Two conventions make this possible, one per book:

- **Java** labels prompts: `Prompt: …` in a body paragraph, followed by the code
  listing it produced. Pseudo-code and syntax listings have no label, which is how
  they stay out.
- **Python** does not label them. A prompt is Code-styled prose, and so is program
  output, so they cannot be told apart by their text. What is reliable is
  structure: a prompt always precedes the listing it generated, so the scraper
  anchors on listings and walks *back*.

Expect imperfection at the edges and check the `suspect` list it prints — prompts
that do not read like an instruction are usually stray program output. Every
published example is executed by `bun run run-exercises`, which is what actually
caught output being stored as an exercise's code.

## Progress unit

Learner progress is tracked per **example** (38 today), not per step. Steps are individually viewable
and applicable, but the titled example is the unit the book presents and therefore the unit a learner
thinks in.

## Development

```sh
bun install
bun run check      # validate + test + both typecheck configs
bun run build      # emit dist/ (CommonJS + .d.ts) for the VS Code extension
```

There are two tsconfigs on purpose. `tsconfig.json` builds `src/` to CommonJS because the VS Code
extension compiles with `module: Node16`. `tsconfig.test.json` typechecks the tests and scripts as ESM,
since those run under Bun and use `import.meta`.

## Current coverage

| Book | Examples | Chapters with content |
|---|---|---|
| AI First Python Programming | 21 | 1–3 of 10 |
| AI First Java Programming | 17 | 1–3 of 12 |

Chapters are authored ahead of their examples, so empty chapters are a normal state — the loader keeps
them, and consumers must skip rather than error on them. Progress percentages are computed over
authored examples only, so a learner never sees a misleading denominator.

## Changing the matcher

Don't, without changing the extension in lockstep. The algorithm in `matcher.ts` is lifted verbatim
from the extension's original `AIFirstLanguageModelProvider`, and `test/matcher.test.ts` pins its
behavior against every authored prompt. A scoring tweak here changes which code a reader is shown.
