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
