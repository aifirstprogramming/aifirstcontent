# Showtail replay import

The authoring importer combines three sources without asking any one of them to
carry information it does not own:

- Word manuscript: chapter placement, title context, prompt and printed response.
- Showtail report: ordered Claude text, planning interactions and tool execution.
- `source/`: complete final text files produced by the captured session.

## Bundle layout

Each configured replay root contains one directory per example or progressive
step. A report may contain unrelated turns, but exactly one turn must match a book
prompt.

```text
bundle-name/
  report.json
  source/
    ... final source files ...
```

Generated assets, screenshots, caches, virtual environments and bytecode are not
imported. The printed response must match exactly one source file after ignoring a
single final newline; that file becomes the scaffold entrypoint.

## Showtail schema version 2

Version 2 retains the existing summary arrays and adds `turn.events`, ordered by a
stable integer `sequence`:

```ts
type EventType =
  | "assistant_text"
  | "user_text"
  | "tool_use"
  | "tool_result"
  | "plan_snapshot"
  | "plan_approved";

interface ShowtailEvent {
  sequence: number;
  timestamp?: string;
  type: EventType;
  text?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  content?: unknown;
  isError?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  plan?: string;
}
```

Showtail must preserve tool inputs for Write, Edit, Read, Bash,
AskUserQuestion, EnterPlanMode, ExitPlanMode and Agent-related tools. Shell results
must retain separate stdout, stderr and exit code. AskUserQuestion results must
retain the selected answers. Plan snapshots and approval boundaries must be
explicit.

These are generic Claude-session facts, not AI First-specific fields. Showtail v1
reports still import as display-only history but cannot create executable book
content.

## Retrofitting legacy v1 captures

The finite set of chapters authored before schema v2 uses a separate, one-time
retrofit command. It imports the original native CLI transcript through the
current Showtail release, scopes the resulting v2 report to each manuscript
prompt, and pairs it with the archived source checkpoint:

```bash
bun run retrofit-showtail -- \
  --archive "/path/to/authoritative-archive" \
  --showtail /path/to/showtail \
  --write

bun run import-showtail -- \
  --manifest replays/python/chapter-09/retrofit-manifest.json \
  --write
```

The committed manifest contains only archive-relative paths and SHA-256 hashes.
Native JSONL, plan files and supplementary author artifacts remain in the
external archive. Generated bundles retain the untouched v1 report, a
deterministic exercise-scoped v2 report, LF-normalized text source, and a
provenance audit. A hash mismatch or incomplete structured transcript fails the
whole conversion; the tool never fills missing facts from handcrafted replay
content.

When a supported integration's native transcript is unavailable but v1 retained
timestamped assistant text and code-change paths, a manifest may explicitly use
`capture.mode: "legacy-diff"`. The retrofit then verifies that those reported
paths exactly equal the files changed between two authoritative checkpoints and
reconstructs whole-file Edit events. The audit records the integration, both
checkpoint hashes, and `reconstructedFrom`; it is never presented as native
transcript capture. Per-exercise `sourceExcludes` similarly records manual runtime
artifacts, such as a level file saved interactively during GUI testing, that must
not be attributed to the AI replay.

## Deterministic derivation

- One AskUserQuestion call containing multiple questions becomes one group.
- Later question calls conservatively depend on every prior canonical answer.
- Read-only activity before the first question becomes `prePlanEvents`.
- Read-only activity after an answer and before the next question or plan becomes
  a workflow interlude.
- The last plan snapshot before approval becomes `canonicalPlan`.
- Post-approval assistant text and tool calls become replay events.
- The final assistant text after the last operation becomes `completionText`.
- Granular tool calls preserve native fidelity; fallback operations write the
  supplied final source tree and run captured post-mutation verification commands.

The importer simulates captured writes and edits when a preceding exercise state
is available and requires the result to equal `source/` byte-for-byte. Every
imported replay records its report digest and turn index so re-import is
idempotent and importer-owned data can be distinguished from manual edits.
