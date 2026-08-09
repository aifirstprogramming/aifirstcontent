<!-- Authored directly for this card. Do not edit: this is a historical record. -->

> **AI development artifact, implementation plan.**
> This is the plan behind a small workflow change, recorded the same way the Claude Code
> session plans in this directory are. It is *history, not documentation*: where it
> disagrees with the code, the code is right.
>
> | | |
> | --- | --- |
> | **Session** | N/A, authored directly for this card |
> | **Date approved** | 2026-08-09 |
> | **Outcome** | **Shipped** |

---

# Notify aifirstextension and aifirstcli when a release goes out

## Problem

`release.yml` tags, validates, and publishes `books/*.json` as release assets, then stops.
Nothing tells the consumers a new pack exists. I checked the extension's `package.json` and
confirmed it still pins v1.1.1 even though this repo has tagged v1.2.0, v1.3.0, and v1.4.0
since. The consumers only find out about new content if someone remembers to update them
by hand.

## What I verified rather than assumed

- `GITHUB_TOKEN` is scoped to the repo the workflow runs in, so it cannot call
  `POST /repos/{owner}/{repo}/dispatches` on a different repo. I confirmed this is why
  `CONTENT_DISPATCH_TOKEN`, a personal access token with `repo` scope, already exists as an
  Actions secret here rather than reusing the default token.
- `gh api ... -F client_payload[tag]="${GITHUB_REF_NAME}"` needs the capital `-F` so `gh`
  nests the value into a JSON object. A lowercase `-f` would send the key as a literal
  string instead, which the dispatch endpoint would reject.
- `main` has no branch protection on this repo, so this change lands by direct commit, not
  a PR.

## Decision

Append one step, `Notify consumers`, after `Publish` in the `release` job. It loops over
`aifirstextension` and `aifirstcli` and dispatches a `content-released` event to each,
carrying the release tag in `client_payload.tag`. No `|| true` or `continue-on-error`: if
the dispatch fails, the run goes red so the gap is visible, even though the release itself
already succeeded by that point.

Alternative I considered and rejected: a separate workflow file just for notification.
Keeping it as a step in `release.yml` means the notify attempt is tied to the exact run
that produced the release, with no risk of the two drifting out of sync on trigger
conditions.

## Known limitations

- `aifirstextension` needs its own `content-sync.yml` listener for this dispatch to do
  anything. Until that lands, the dispatch is a silent no-op: `gh api` gets a 204 and the
  run stays green, but no workflow fires on the other side. This step is safe to ship
  ahead of that listener; it just won't have an effect until the listener exists.
- `aifirstcli` receives the same dispatch but has no listener of its own in this feature's
  scope. That's accepted as-is: one loop for both consumers is simpler than special-casing
  one of them.
- If `CONTENT_DISPATCH_TOKEN` is ever rotated or revoked, this step fails loudly in the
  Action run, but that's the only place the failure is visible. Nothing on the consumer
  side complains that it stopped hearing about releases, so a token rotation is a
  silent-until-someone-checks-the-Actions-tab failure unless someone is watching this run.

## How I checked it

- `python3 -c "import yaml; ..."` confirmed the file parses and `Notify consumers` sits
  after `Publish` in `jobs.release.steps`.
- `grep -n "secrets.CONTENT_DISPATCH_TOKEN"` showed exactly one match, inside the new
  step's `env:` block, not inside any `run:` body.
- `grep -n "\-F client_payload\[tag\]"` confirmed the capital `-F` made it into the file.
- Did not cut a real release to test end to end, per the card's instruction. The next tag
  push exercises this naturally.
- `bun install --frozen-lockfile && bun run check` stayed green after this change, matching
  the baseline recorded before I started (this change touches only workflow YAML and
  `docs/ai/`, no source file).
