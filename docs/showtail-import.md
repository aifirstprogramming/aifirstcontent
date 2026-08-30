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
