# Habit Tracker: Weekly Goals, Streaks, and Markdown Report

## Context

The base tracker (`habit_tracker.py`, `test_habit_tracker.py`) supports `add`,
`list`, and `complete` against a JSON file. It has no notion of a target
cadence per habit, no streak calculation, and no reporting output. This
enhancement adds weekly goals per habit, current/longest streak calculation,
and a new `report` command that emits a deterministic Markdown progress
report. Report format chosen by user: a compact Markdown table, one row per
habit, with Weekly Goal / This Week / Streak / Status columns.

## Data model change

Habit records gain a `weekly_goal` field (int, default `7` if absent from
older data files, applied at read time in `load_data`/a small migration
helper so existing JSON files without the field keep working).

```json
"exercise": {"created": "2026-08-01", "completions": [...], "weekly_goal": 3}
```

## New / changed functions in `habit_tracker.py`

- `add_habit(data, name, date, weekly_goal=7)` — store `weekly_goal` on creation.
- `set_weekly_goal(data, name, weekly_goal)` — update an existing habit's goal; raises `ValueError` if habit is unknown or goal is not a positive int.
- `week_bounds(as_of_date)` — return `(monday_str, sunday_str)` for the ISO Mon–Sun week containing `as_of_date` (`datetime.date.fromisoformat` + `timedelta`, weekday()-based).
- `completions_in_range(completions, start, end)` — count completions with `start <= date <= end`.
- `current_streak(completions, as_of_date)` — consecutive-day streak ending at `as_of_date`; if `as_of_date` has no completion, anchor at `as_of_date - 1 day` (streak not yet broken); walk backwards while consecutive days are present.
- `longest_streak(completions)` — longest run of consecutive calendar days across all completions.
- `build_report_rows(data, as_of_date)` — per habit (sorted by name): `(name, weekly_goal, this_week_count, streak, status)` where `status` is `"Met"` if `this_week_count >= weekly_goal` else `"In Progress"`.
- `format_report_markdown(rows, as_of_date)` — render the table shown in the approved preview, header `# Habit Progress Report (as of {as_of_date})`.

All new functions take an explicit date string rather than calling
`datetime.date.today()` internally, matching the existing pattern (`add`/`complete`
already thread an explicit `date` through), so report generation is pure and
reproducible given the same data + as-of date.

## CLI changes

- `add`: new `--goal N` option (default `7`, must be a positive int — argparse `type=int`).
- New `goal` subcommand: `habit_tracker.py goal <name> <N>` → calls `set_weekly_goal`, saves, prints confirmation; non-zero exit on error (unknown habit / non-positive N).
- New `report` subcommand:
  - `--date` (as-of date, default `today_str()`, same convention as `add`/`complete`).
  - `--output PATH` (optional; if given, write Markdown to file instead of stdout).
  - Always builds report via `build_report_rows` + `format_report_markdown`; no other side effects (does not mutate/save habit data).
- `list` output gains two columns, `GOAL` and `STREAK`, computed via the same `current_streak`/`weekly_goal` helpers, so the enhancement is visible without needing the report. (`list_habits`/`format_habit_list` signatures updated accordingly; this touches existing tests for those two functions.)

## Tests (`test_habit_tracker.py`)

Add test classes/cases:
- `WeekBoundsTests` — Monday, Sunday, and mid-week `as_of` dates resolve to the correct Mon–Sun bounds.
- `StreakTests` — empty completions → 0; streak broken by a gap; streak alive when yesterday (not today) was completed; `longest_streak` across multiple runs including an all-time-best run that isn't the current one.
- `WeeklyGoalTests` — `set_weekly_goal` success/error paths; `add_habit` default goal; goal met vs in-progress classification in `build_report_rows`.
- `ReportFormattingTests` — `format_report_markdown` exact string match against the approved table format for a small fixed dataset.
- `CliReportIntegrationTests`:
  - `report` via `main()` with `--date` prints expected Markdown to stdout.
  - `report --output FILE` writes the file; content matches stdout-mode output for the same inputs.
  - **Byte-identical check**: call `main()` twice with identical args/data/`--date` (two temp output files, or two stdout captures), then `assertEqual` the raw bytes/text of both runs.
  - `goal` subcommand success and error (unknown habit, non-positive goal) exit codes.
- Update existing `ListHabitsTests`/`FormatHabitListTests` expectations for the new `GOAL`/`STREAK` columns.

## Verification

1. `python3 -m unittest -v` — all tests (existing 18 + new ones) pass.
2. Manual CLI smoke test in a scratch temp dir (mirroring the base-feature verification): `add` a couple of habits with `--goal`, `complete` several dates spanning a streak and a gap, run `list`, run `report` to stdout, run `report --output r1.md` and `report --output r2.md` with the same `--date`, then `cmp -s r1.md r2.md` (or `diff`) to confirm byte-identical output, and inspect the Markdown content directly.
3. Clean up the scratch directory afterward, as done for the base feature.

Finish with the exact sentence: `Habit tracker planning enhancement complete.`