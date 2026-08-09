# AI development artifacts

This content package was built with [Claude Code](https://claude.com/claude-code). Before each
substantial change, the agent wrote a plan — the problem, what it measured rather than assumed, the
design decisions and their alternatives, the phases, and how the result would be verified. Those
plans were reviewed and approved before any code was written.

They lived in the agent's session history, which is local to one machine and disappears with it.
This directory checks them into the repository so that anyone working on the project can read *why*
the content pipeline looks the way it does, not just what it does.

## How to read these

**They are history, not documentation.** Each plan describes the code as it was expected to become
at one moment. Where a plan and the code disagree, the code is right. For current behaviour read the
[README](../../README.md) and the [schema](../../schema/content.schema.json).

Each file opens with a provenance block: the session it came from, the date it was approved, and
whether it shipped. The body below that block is **verbatim** — deliberately not cleaned up, because
an edited plan is no longer evidence of what was actually decided. The only alteration is that
absolute paths from the machine it ran on were replaced with `<scratch>/` and `~/`.

## Plans

| Plan | Date | Outcome |
| --- | --- | --- |
| [Scrape the manuscripts, and pre-compute everything a reader sees](plans/2026-08-08-scrape-manuscripts-and-precompute.md) — the import pipeline that took the pack from 38 hand-entered examples to 139 imported ones, each with a stored explanation and each verified by execution | 2026-08-08 | Shipped as v1.2.0 and v1.3.0 |

## Related documents already in this repository

- [`docs/EXTENSION_MIGRATION.md`](../EXTENSION_MIGRATION.md) — the handoff written for the VS Code
  extension's migration onto this package. The plan that consumed it lives in the
  [extension repository](https://github.com/aifirstprogramming/aifirstextension/blob/main/docs/ai/plans/2026-08-08-migrate-onto-aifirst-content.md).

## Sessions behind this repository

This package was extracted from the `aifirst` CLI so that the CLI and the VS Code extension could
not drift apart — one matcher, one copy of the content, two surfaces. That extraction and
everything after it happened in session `62a2fb7f` (2026-08-07 → 08-09), which also built the CLI;
the fuller session index is in the
[CLI repository](https://github.com/aifirstprogramming/aifirstcli/blob/main/docs/ai/README.md).

## Adding to this directory

When a plan is approved in a Claude Code session, save it here before the session ends — the
transcript is not a durable store. Keep the body verbatim, add the same provenance block, scrub any
absolute local paths, and add a row to the table above.
