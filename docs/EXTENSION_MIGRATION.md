# Handoff: migrate the VS Code extension onto `@aifirst/content`

**Repo to change:** `aifirstprogramming/aifirstextension` (currently v1.4.0, published to the VS Code
Marketplace as `AIFirstProgramming.ai-first-programming`).

**Nothing in this repo (`aifirstcontent`) needs to change.** It is already released and consumed in
production by the `aifirst` CLI.

---

## Why

The books print a prompt and the exact code it produces. Both the CLI and the extension promise a
reader the *same* answer. Today they each implement that promise separately:

| Logic | Extension | Shared package |
|---|---|---|
| Walk book JSON → flat prompt list | `AIFirstLanguageModelProvider.loadPromptsFromBooks()` and again in `AIBookProvider` | `loadFromDirectory` / `loadFromRaw` |
| Join `response: string[]` with `\n` | inline in both files (3 call sites) | `normalizeResponse` |
| Derive language from filename | inline | declared `language`, filename as fallback |
| Prompt → response matching | `findMatchingPrompt()` + `searchEntries()` | `findMatch` / `findMatchingStep` |

Two implementations of "which code does this prompt produce" is a correctness risk, not just
duplication: they can drift, and a reader would get different code in VS Code than in the terminal
with no way to tell which matches the page. The CLI already migrated. This task finishes the job.

The matcher in this package was lifted **verbatim** from the extension's own
`AIFirstLanguageModelProvider`, so this is a de-duplication, not a behaviour change. That is the bar:
**the extension must behave identically afterwards.**

---

## Consuming the package

```jsonc
// aifirstextension/package.json
"dependencies": {
  "@aifirst/content": "github:aifirstprogramming/aifirstcontent#v1.1.1"
}
```

Pin **v1.1.1 or later**. Earlier tags do not build `dist/` on install and the import will resolve to
nothing. (A git install ships `src/` only; `v1.1.1` added a `prepare` script so npm compiles the
CommonJS build during install. Verified: `npm install github:aifirstprogramming/aifirstcontent#main`
produces `dist/`, and `require("@aifirst/content")` works under CommonJS.)

The extension compiles with `module: Node16` → CommonJS, which resolves the package's `types` and
`default` conditions to `dist/`. That is why `prepare` matters. (Bun resolves a `bun` condition to
`src/` instead, which is how the CLI consumes it — irrelevant here.)

### API you need

```ts
import {
  loadFromRaw, loadFromDirectory,   // book JSON -> Content
  normalizeResponse,                // string | string[] -> string
  findMatch, findMatchingStep, unwrapPromptTag,
  type Content, type Example, type Step, type Book,
} from "@aifirst/content";
```

`Content` is `{ books, examples, steps }`. An `Example` is a titled book item and owns one or more
`Step`s; each `Step` has `{ id, prompt, response, language, index, total, exampleId }`. **A
single-prompt example synthesises one step whose id equals the example id**, so you never branch on
the two authored forms — this replaces the `if (example.prompt) … if (example.prompts) …` duplication
in both current files.

`Step` is a superset of the extension's current `PromptEntry` (`{prompt, response, language}`), so
`findMatch` accepts it directly.

---

## Where the books come from

The extension currently ships `book_content/*.json` in the `.vsix` and reads it from `extensionPath`.
After migration that directory should be **deleted** — this repo is the single source of truth.

Recommended: import the JSON through the package's subpath export and use `loadFromRaw`, which avoids
resolving a runtime path inside a packaged extension:

```ts
import python from "@aifirst/content/books/ai-first-python-programming.json";
import java from "@aifirst/content/books/ai-first-java-programming.json";

const content = loadFromRaw([
  { filename: "ai-first-python-programming.json", book: python as never },
  { filename: "ai-first-java-programming.json", book: java as never },
]);
```

Needs `"resolveJsonModule": true` in `tsconfig.json`.

> **Packaging is the trap here.** The extension has *zero* runtime dependencies today; this is the
> first one. `.vscodeignore` excludes `**/*.ts` and `**/tsconfig.json` but not `node_modules`, so
> `vsce` will bundle the dependency — but **verify it rather than assume**:
>
> ```sh
> npx vsce package
> unzip -l *.vsix | grep -E "@aifirst|books/"
> ```
>
> The `.vsix` must contain `node_modules/@aifirst/content/dist/*.js` and the `books/*.json`. If it
> doesn't, either fix `.vscodeignore` or bundle with esbuild instead. Installing the built `.vsix`
> into a clean VS Code and opening the Books panel is the only real proof.

---

## What to change

### `src/AIFirstLanguageModelProvider.ts` (345 lines)

Delete and replace with package calls:

- `loadPromptsFromBooks()` → `loadFromRaw(...)` once, keep the lazy/`indexLoaded` behaviour if you like
- `findMatchingPrompt()` → `findMatch(prompt, content.steps, editorLanguage)`
- `searchEntries()` → delete (it *is* `searchEntries` in the package)
- the `<prompt>…</prompt>` regex → `unwrapPromptTag()`
- the two `Array.isArray(response) ? join('\n')` sites → gone, the loader normalizes

**Do not pass a fourth argument to `findMatch`.** It takes an optional preferred-language order; the
default reproduces the extension's existing python→java→other fallthrough exactly. The CLI passes the
reader's chosen book; the extension must not, or behaviour changes.

**Preserve verbatim** — none of this is in the shared package and all of it is load-bearing:

- the `replace_string_in_file` tool-call path for inline chat (Ctrl+I), including the Keep/X overlay
- the untitled/empty-buffer placeholder workaround (inserting `\n` so the edit tool has something to
  replace, and passing `doc.uri.toString()` rather than `fsPath`)
- `reportSafely()`, which swallows the async rejection when Copilot Chat closes the stream
- `splitIntoChunks()` and the 10 ms streaming cadence
- `provideLanguageModelChatInformation()` metadata (id `ai-first-programming`, family `AIFirst`)
- the strict language scoping: when the editor has a real language, a miss returns null rather than
  falling back to the other book

### `src/AIBookProvider.ts` (205 lines)

Build the tree from `content.books` → `sections` → `chapters` → `examples` instead of re-walking raw
JSON. Its `response` array-joining also goes away.

### `src/AIBookWebViewProvider.ts` (334 lines)

Should need little or nothing — it renders whatever it is handed. Keep the Prism highlighting and copy
buttons as they are.

### Also

- delete `book_content/`
- bump to **1.5.0** and update `CHANGELOG.md`
- `IMPLEMENTATION_PLAN.md` describes the old inlined design; update or mark superseded

---

## New fields you can ignore (or use)

Content pack 1.1.x added, additively:

- books declare `tag` (`py`, `java`) and `language`, so adding a book needs no code change. The loader
  prefers them and falls back to filename sniffing.
- `Step.interactive` (derived from the code) and `Step.stdin` (authored sample input) for the eleven
  exercises that read input. The CLI uses these to run exercises unattended. The extension has no
  runner, so it can ignore them — though `interactive` would let the webview warn "this one asks for
  input".

### Pack 1.2.x: `explanation` — please do use this one

Every published step now carries the walkthrough a reader should see:

```ts
step.explanation?.summary        // one or two sentences
step.explanation?.lines          // [{ code, text }], in source order
step.explanation?.run            // the command that runs it
```

**This field exists because of the extension.** The CLI has a model behind it and could
improvise an explanation; the extension cannot, so before this the two surfaces
disagreed — the terminal explained the code and the editor just showed it. The text is
generated once at authoring time, verified by executing the exercise, and committed. The
CLI now renders exactly these words, so if the webview renders them too, both surfaces
and the printed page finally say the same thing.

Rendering it is a webview change, not a matching problem: `lines[].code` is copied
character-for-character from the response, so each note can be attached to its line
without fuzzy matching. Content CI enforces that every published step has one.

Two smaller fields come with it, both safe to ignore in a viewer:

- `scaffold` — extra files that make a fragment runnable, and `expectsException` for
  exercises that throw on purpose. Both matter only to something that executes code.
- `kind` (`program` / `class` / `test` / `snippet` / `project`) and `status`. The loader
  already hides drafts and retired examples, so a consumer never sees them.

---

## Verification

The requirement is *no behaviour change*, so test for exactly that.

1. **Golden diff of the matcher.** Before touching anything, dump the current mapping and compare
   after:

   ```ts
   // for every authored prompt, in each language scope, record what comes back
   for (const entry of promptIndex) {
     record(entry.prompt, editorLanguage, findMatchingPrompt(entry.prompt, editorLanguage)?.response);
   }
   ```

   Run it against the old code, then the new, and diff. It must be byte-identical across all 48 steps
   in both language scopes plus `undefined`/`plaintext`. This is the single highest-value check.

2. `npm run compile && npm run lint && npm test`.

3. **Package and inspect the `.vsix`** (see the packaging trap above), then install it into a clean
   VS Code.

4. **Manual pass on the walkthrough**, which automated tests don't cover:
   - Books panel: both books, all chapters including the empty ones, examples open
   - Copy prompt / copy response
   - Inline chat (Ctrl+I) in a **saved, non-empty** file → Keep/X overlay appears
   - Inline chat in an **untitled** buffer → the placeholder path still works
   - Chat panel (Ctrl+Shift+I) → fenced code block with Insert at Cursor
   - Model still appears as **AI First Programming** under the **AI First** provider group

5. Sanity: `unzip -p *.vsix extension/node_modules/@aifirst/content/books/ai-first-python-programming.json | head`
   should print real book JSON.

---

## Reference

- Package source: <https://github.com/aifirstprogramming/aifirstcontent> — `src/loader.ts`,
  `src/matcher.ts`, `src/types.ts`
- Its tests (`test/matcher.test.ts`) pin the matcher against every authored prompt; if you believe the
  package matches differently from the extension, that file is where to prove it
- The CLI's migration is a worked example: `aifirstcli/src/commands/show.ts` and `search.ts`
- `README.md` here documents the content model, ids and the interactive-exercise rules

## One caution

`matcher.ts` carries a comment asking that it not be "improved" without changing both consumers in
lockstep. After this migration that is finally enforceable — one implementation, two surfaces. Please
keep it that way: a scoring tweak silently changes which code a reader is shown.
