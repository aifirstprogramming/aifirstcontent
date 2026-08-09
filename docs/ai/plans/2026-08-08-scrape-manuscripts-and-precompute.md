<!-- Captured from a Claude Code session. Do not edit: this is a historical record. -->

> **AI development artifact — implementation plan.**
> This is the plan Claude Code proposed and worked from, captured verbatim from the session that
> produced it. It records the reasoning, the measurements and the trade-offs behind the change.
> It is *history, not documentation*: where it disagrees with the code, the code is right.
>
> | | |
> | --- | --- |
> | **Session** | `62a2fb7f` |
> | **Date approved** | 2026-08-08 |
> | **Outcome** | **Shipped** — `083c364` … `886c56d`, released as v1.2.0 and v1.3.0 (38 → 139 exercises) |

---

# Scrape the manuscripts into the content pack, and make everything a reader sees pre-computed

## Context

The content pack holds 38 examples covering chapters 1–3 of each book. The manuscripts are far
ahead: Java has chapters 1–9 written, Python 1–7 plus an Appendix. Every example was hand-entered,
so the pack has already drifted from the books — verified below — and each new chapter means another
manual sweep.

A second problem surfaced while using the CLI. When a reader asks for an exercise, the assistant
improvises a line-by-line explanation of the code. That explanation is different every time, and the
**VS Code extension cannot produce one at all** — it injects book content statically with no model
behind it. The same applies to making an exercise runnable: anything that needs a model at runtime is
unavailable in the editor.

So the governing principle for this work: **everything a reader sees is pre-computed, tested, and
committed.** An LLM is used at conversion time, never at runtime. That completes the determinism goal
the project started from — identical answers, and now identical explanations, on every surface.

## Feasibility: measured, not assumed

I prototyped extraction against every chapter (scripts under `<scratch>/`,
to be ported to TypeScript).

**Java** — every prompt is labelled `Prompt: …` in a `BodyText` paragraph, followed by a `Code` run.
Consistent across ch2–9: **99 prompts, 97 with code**. Pseudo-code and syntax listings have no
preceding prompt, which is exactly how they're excluded.

**Python** — no label; the algorithm you described works. Anchor on each listing and walk back to the
nearest `Code`-styled prose paragraph:

| | ch2 | ch3 | ch4 | ch5 | ch6 | ch7 | Appendix |
|---|---|---|---|---|---|---|---|
| examples | 7 | 16 | 15 | 16 | 15 | 14 | 12 |
| output listings separated | 6 | 8 | 10 | 5 | 3 | 3 | 14 |

Program output is itself a listing, so a listing whose walk-back lands on an already-claimed prompt is
output, not a new example. That falls out of the algorithm with no caption-text guessing.

**Indentation is encoded differently per book** and both are recoverable — this was the subtlest thing
found, because getting it wrong produces code that looks identical in a terminal but isn't byte-equal,
and for Python isn't runnable:

- Java: `<w:tab/>` elements → expand to 4 spaces
- Python: literal **U+00A0** non-breaking spaces interleaved with spaces (`"\xa0 \xa0 "` = 4 columns)

Reproduction of the shipped 38: Java 21/24 prompts, Python 16/24. The gaps are informative, not
failures — see drift below.

## Decisions

| Area | Decision |
|---|---|
| Explanations | `summary` + `lines[{code,text}]` + `run`, stored in the pack. |
| Non-runnable examples | `response` stays byte-exact to the page; add `scaffold` files and a run command around it. |
| Enrichment | Local `bun scripts/enrich.ts`, cached by content hash, output committed. CI validates only — no API key, no model in the gate. |
| Sequencing | Four phases, each shippable: report → import → enrich → consumers. |

Assumptions I'm making unless you say otherwise:

- **Canonical sources** are the two paths you gave. `Author Revision Chapters/`,
  `Submitted Chapters (old)/` and `Chapters_v1/` are treated as history and ignored. The Python
  `Appendix.docx` **is** a real content chapter ("Core Concepts") and is included.
- **Ids never change.** Existing examples are matched by normalised prompt text and keep their id and
  their multi-step grouping. New content becomes one example per listing; merging into progressive
  steps stays a human edit.
- **Chapter 1 of both books is hand-maintained** — Java ch1 has zero code blocks and Python ch1's
  Hello World is a screenshot. The scraper never retires an example merely because it couldn't find it.
- **Drift direction is yours to set in Phase 1.** Nothing is rewritten without `--write`.

## Schema additions

`aifirstcontent/schema/content.schema.json` and `src/types.ts`:

```jsonc
{
  "id": "java-6-04",
  "title": "Intro JUnit test for Thermostat",
  "prompt": "Would you create an intro JUnit test for Thermostat.java …",
  "response": "…@Test…",          // byte-exact from the printed page, always
  "kind": "test",                  // program | snippet | class | test | project
  "status": "draft",               // omitted once enriched and verified
  "stdin": "5\n",                  // when the program reads input
  "explanation": {
    "summary": "…",
    "lines": [{ "code": "@Test", "text": "…" }],
    "run": "mvn -q test"
  },
  "scaffold": {                    // only when response can't run alone
    "files": [
      { "path": "pom.xml", "content": "…" },
      { "path": "src/main/java/Thermostat.java", "fromExercise": "java-6-02" }
    ],
    "run": ["mvn", "-q", "test"]
  }
}
```

`fromExercise` reuses another exercise's response rather than duplicating it, so the two can't drift.

**`status: "draft"`** is how Phase 2 lands incrementally without shipping half-finished exercises:
`loadFromRaw` in `src/loader.ts` filters drafts out unless asked for them, so the CLI and the extension
never serve one, and `validate.ts` exempts drafts from the stdin/explanation requirements. A chapter
becomes visible when it's enriched and verified.

## Phase 1 — scraper and drift report (no writes)

New `aifirstcontent/scripts/scrape.ts`, run as `bun scripts/scrape.ts [--book java|py] [--report]`.
Port of the working prototype:

- docx reading: unzip `word/document.xml` and walk paragraphs for `(pStyle, text)`, expanding
  `<w:tab/>` and normalising U+00A0. Needs a zip reader — add `fflate` as a **devDependency** (dev-only
  script, never shipped to consumers).
- Java strategy: label-anchored. Python strategy: listing-anchored walk-back.
- Titles from the `CodeCaption` (`Code Block 4-3: Intro function example` → `Intro function example`).
- Chapter number from the caption or the `ChapterTitle`.

Output is a report, not a write:

```
drift    java-2-03  ours has one extra blank line
drift    py-3-08    ours is missing 2 blank lines
absent   java-2-07  not in any Java chapter
absent   java-3-02  not in any Java chapter
moved    py-2-05    Chapter 2 -> Appendix (Core Concepts)
new      94 examples across java ch4-9, py ch4-7 + Appendix
```

Already-known drift to confirm: `java-2-03` (our extra blank line), `py-3-08` (missing blank lines),
`java-2-07` and `java-3-02` (verified absent from the manuscripts), and six `py-2-*` that moved into the
Appendix — restructuring, not deletion.

**Deliverable: you decide what's canonical before anything is written.**

## Phase 2 — import (`--write`)

Writes new examples as `status: "draft"` with prompt, response, title, `kind` (inferred: has `main` →
program, `@Test` → test, no class/entry point → snippet/class), and applies confirmed drift fixes.
Reuses `scripts/add-ids.ts` for id assignment so per-chapter sequences continue and nothing renumbers.

Idempotent by construction: re-running against unchanged manuscripts produces no diff. CI already
enforces that for `add-ids`; extend the same check to `scrape`.

## Phase 3 — enrich, verified by execution

New `aifirstcontent/scripts/enrich.ts`. For each draft example, one LLM call producing structured
output: `explanation`, plus `scaffold` and `stdin` where needed. Then **it must actually run** —
materialise `response` plus any scaffold into a temp dir and execute, reusing `suggestFilename` and
`runCommand` from `src/filenames.ts` and the harness in `scripts/run-exercises.ts`. Only a passing
example loses its `draft` status.

- Model pinned explicitly (`claude-opus-5`), and **the cache key includes the model id** so a model
  bump is a deliberate, visible re-enrichment rather than a silent rewrite of the whole book.
- Cache keyed on `hash(prompt + response + kind + model)` in `enrich-cache/`, committed. Unchanged
  examples are never regenerated, which is what makes repeated runs cheap.
- Failures stay `draft` and are listed, never silently shipped.

## Phase 4 — consumers render the stored text

- `aifirstcli/src/commands/show.ts` and `run.ts` print `explanation.summary` and the line-by-line
  walkthrough from the pack.
- `src/skills/content.ts`: the skill must present the **stored** explanation rather than writing its
  own — the same rule that already forbids it from writing the code. This is the change that makes the
  CLI and the extension agree.
- `run.ts` materialises `scaffold.files` (resolving `fromExercise`) and uses `scaffold.run`.
- The extension shows the explanation in its webview. That work belongs with the migration handoff in
  `aifirstcontent/docs/EXTENSION_MIGRATION.md`, which should be updated to mention it.

## Verification

- **Phase 1**: run the scraper over the 38 shipped examples; every reported drift must be explainable
  by hand (as `java-2-03` and `py-3-08` already were). Re-running produces an identical report.
- **Phase 2**: `bun run check` stays green; `scrape --write` twice in a row yields no second diff.
- **Phase 3**: `scripts/run-exercises.ts` executes every non-draft example — the existing gate, now
  covering scaffolded ones too. A second `enrich` run reports everything cached and writes nothing.
- **Phase 4**: `aifirst show java-1-01` prints the stored explanation verbatim; two runs are identical;
  the same text appears in the extension. End-to-end in a sandbox home as in previous rounds.
- Content CI gains: drafts excluded from the pack, every non-draft has an explanation, `scrape` is
  idempotent.

## Risks

- **Volume.** ~194 candidate examples against 38 today. Phase 1 is deliberately read-only so the size
  of the change is visible before committing to it.
- **Enrichment quality.** Generated explanations need review; a wrong explanation is worse than none
  because it's presented as canonical. Recommend reviewing per chapter, and that review is the real
  cost of Phase 3 — not the API calls.
- **Scaffolding for Maven/JUnit chapters** requires `mvn` and a JDK to verify. CI has the JDK; Maven
  needs adding. Expect the first Java ch6 scaffold to need hand-correction.
- **Python precision/recall.** The walk-back rule is good but not perfect; captions occasionally
  introduce output that reads like code. Phase 1's report is the place to catch it.
- **Explanation size.** Line-by-line notes for ~194 examples will grow the pack severalfold, and it's
  embedded in the CLI binary. Worth measuring in Phase 3; if it's material, explanations could move to
  a separate subpath export that only the surfaces needing them import.
