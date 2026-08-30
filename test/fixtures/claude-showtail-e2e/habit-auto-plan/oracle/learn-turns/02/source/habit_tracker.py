#!/usr/bin/env python3
"""Deterministic standard-library habit tracker CLI backed by a JSON file."""

import argparse
import datetime
import json
import os
import sys

DEFAULT_DATA_FILE = "habits.json"
DEFAULT_WEEKLY_GOAL = 7


def today_str():
    return datetime.date.today().isoformat()


def _parse_date(date_str):
    return datetime.date.fromisoformat(date_str)


def load_data(path):
    if not os.path.exists(path):
        return {"habits": {}}
    with open(path, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError:
            return {"habits": {}}
    if "habits" not in data:
        data["habits"] = {}
    for habit in data["habits"].values():
        habit.setdefault("weekly_goal", DEFAULT_WEEKLY_GOAL)
    return data


def save_data(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def add_habit(data, name, date, weekly_goal=DEFAULT_WEEKLY_GOAL):
    if name in data["habits"]:
        raise ValueError(f"habit {name!r} already exists")
    if weekly_goal < 1:
        raise ValueError("weekly_goal must be a positive integer")
    data["habits"][name] = {
        "created": date,
        "completions": [],
        "weekly_goal": weekly_goal,
    }


def set_weekly_goal(data, name, weekly_goal):
    if name not in data["habits"]:
        raise ValueError(f"habit {name!r} does not exist")
    if weekly_goal < 1:
        raise ValueError("weekly_goal must be a positive integer")
    data["habits"][name]["weekly_goal"] = weekly_goal


def complete_habit(data, name, date):
    if name not in data["habits"]:
        raise ValueError(f"habit {name!r} does not exist")
    completions = data["habits"][name]["completions"]
    if date not in completions:
        completions.append(date)
        completions.sort()


def week_bounds(as_of_date):
    """Return (monday_str, sunday_str) for the ISO Mon-Sun week containing as_of_date."""
    day = _parse_date(as_of_date)
    monday = day - datetime.timedelta(days=day.weekday())
    sunday = monday + datetime.timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


def completions_in_range(completions, start, end):
    return sum(1 for c in completions if start <= c <= end)


def current_streak(completions, as_of_date):
    """Consecutive-day streak ending at as_of_date (or unbroken through yesterday)."""
    if not completions:
        return 0
    completion_set = set(completions)
    anchor = _parse_date(as_of_date)
    if anchor.isoformat() not in completion_set:
        anchor -= datetime.timedelta(days=1)
        if anchor.isoformat() not in completion_set:
            return 0
    streak = 0
    while anchor.isoformat() in completion_set:
        streak += 1
        anchor -= datetime.timedelta(days=1)
    return streak


def longest_streak(completions):
    """Longest run of consecutive calendar days across all completions."""
    if not completions:
        return 0
    days = sorted(_parse_date(c) for c in set(completions))
    best = current = 1
    for prev, nxt in zip(days, days[1:]):
        if (nxt - prev).days == 1:
            current += 1
        else:
            current = 1
        best = max(best, current)
    return best


def list_habits(data, as_of_date=None):
    """Return a deterministically ordered list of (name, created, count, last, goal, streak) tuples."""
    as_of_date = as_of_date or today_str()
    result = []
    for name in sorted(data["habits"]):
        habit = data["habits"][name]
        completions = habit["completions"]
        last = completions[-1] if completions else "-"
        goal = habit.get("weekly_goal", DEFAULT_WEEKLY_GOAL)
        streak = current_streak(completions, as_of_date)
        result.append((name, habit["created"], len(completions), last, goal, streak))
    return result


def format_habit_list(rows):
    if not rows:
        return "No habits tracked yet."
    lines = [
        f"{'NAME':<20}{'CREATED':<12}{'COMPLETIONS':<13}{'LAST':<12}"
        f"{'GOAL':<6}{'STREAK':<8}"
    ]
    for name, created, count, last, goal, streak in rows:
        lines.append(
            f"{name:<20}{created:<12}{count:<13}{last:<12}{goal:<6}{streak:<8}"
        )
    return "\n".join(lines)


def build_report_rows(data, as_of_date):
    """Return (name, weekly_goal, this_week_count, streak, status) per habit, sorted by name."""
    week_start, week_end = week_bounds(as_of_date)
    result = []
    for name in sorted(data["habits"]):
        habit = data["habits"][name]
        completions = habit["completions"]
        goal = habit.get("weekly_goal", DEFAULT_WEEKLY_GOAL)
        this_week = completions_in_range(completions, week_start, week_end)
        streak = current_streak(completions, as_of_date)
        status = "Met" if this_week >= goal else "In Progress"
        result.append((name, goal, this_week, streak, status))
    return result


def format_report_markdown(rows, as_of_date):
    lines = [f"# Habit Progress Report (as of {as_of_date})", ""]
    if not rows:
        lines.append("No habits tracked yet.")
        return "\n".join(lines) + "\n"
    lines.append("| Habit | Weekly Goal | This Week | Streak | Status |")
    lines.append("| --- | --- | --- | --- | --- |")
    for name, goal, this_week, streak, status in rows:
        lines.append(f"| {name} | {goal} | {this_week}/{goal} | {streak} | {status} |")
    return "\n".join(lines) + "\n"


def build_parser():
    parser = argparse.ArgumentParser(prog="habit_tracker", description=__doc__)
    parser.add_argument(
        "--file", default=DEFAULT_DATA_FILE, help="path to the JSON data file"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    add_parser = subparsers.add_parser("add", help="add a new habit")
    add_parser.add_argument("name", help="name of the habit")
    add_parser.add_argument(
        "--date", default=None, help="creation date (YYYY-MM-DD), defaults to today"
    )
    add_parser.add_argument(
        "--goal",
        type=int,
        default=DEFAULT_WEEKLY_GOAL,
        help="weekly completion goal (positive integer), defaults to 7",
    )

    list_parser = subparsers.add_parser("list", help="list all habits")
    list_parser.add_argument(
        "--date",
        default=None,
        help="as-of date (YYYY-MM-DD) for streak calculation, defaults to today",
    )

    complete_parser = subparsers.add_parser("complete", help="mark a habit complete")
    complete_parser.add_argument("name", help="name of the habit")
    complete_parser.add_argument(
        "--date", default=None, help="completion date (YYYY-MM-DD), defaults to today"
    )

    goal_parser = subparsers.add_parser("goal", help="set a habit's weekly goal")
    goal_parser.add_argument("name", help="name of the habit")
    goal_parser.add_argument("value", type=int, help="new weekly goal (positive integer)")

    report_parser = subparsers.add_parser("report", help="print a Markdown progress report")
    report_parser.add_argument(
        "--date",
        default=None,
        help="as-of date (YYYY-MM-DD) for the report, defaults to today",
    )
    report_parser.add_argument(
        "--output", default=None, help="write the report to this file instead of stdout"
    )

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    data = load_data(args.file)

    if args.command == "add":
        date = args.date or today_str()
        try:
            add_habit(data, args.name, date, weekly_goal=args.goal)
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        save_data(args.file, data)
        print(f"Added habit {args.name!r} (created {date}, goal {args.goal}/week).")
        return 0

    if args.command == "list":
        as_of_date = args.date or today_str()
        print(format_habit_list(list_habits(data, as_of_date)))
        return 0

    if args.command == "complete":
        date = args.date or today_str()
        try:
            complete_habit(data, args.name, date)
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        save_data(args.file, data)
        print(f"Completed habit {args.name!r} for {date}.")
        return 0

    if args.command == "goal":
        try:
            set_weekly_goal(data, args.name, args.value)
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        save_data(args.file, data)
        print(f"Set weekly goal for {args.name!r} to {args.value}.")
        return 0

    if args.command == "report":
        as_of_date = args.date or today_str()
        rows = build_report_rows(data, as_of_date)
        report = format_report_markdown(rows, as_of_date)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"Report written to {args.output}.")
        else:
            print(report, end="")
        return 0

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
