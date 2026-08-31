#!/usr/bin/env python3
"""Deterministic standard-library habit tracker CLI backed by a JSON file."""

import argparse
import datetime
import json
import os
import sys

DEFAULT_DATA_FILE = "habits.json"


def today_str():
    return datetime.date.today().isoformat()


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
    return data


def save_data(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def add_habit(data, name, date):
    if name in data["habits"]:
        raise ValueError(f"habit {name!r} already exists")
    data["habits"][name] = {"created": date, "completions": []}


def complete_habit(data, name, date):
    if name not in data["habits"]:
        raise ValueError(f"habit {name!r} does not exist")
    completions = data["habits"][name]["completions"]
    if date not in completions:
        completions.append(date)
        completions.sort()


def list_habits(data):
    """Return a deterministically ordered list of (name, created, count, last) tuples."""
    result = []
    for name in sorted(data["habits"]):
        habit = data["habits"][name]
        completions = habit["completions"]
        last = completions[-1] if completions else "-"
        result.append((name, habit["created"], len(completions), last))
    return result


def format_habit_list(rows):
    if not rows:
        return "No habits tracked yet."
    lines = [f"{'NAME':<20}{'CREATED':<12}{'COMPLETIONS':<13}{'LAST':<12}"]
    for name, created, count, last in rows:
        lines.append(f"{name:<20}{created:<12}{count:<13}{last:<12}")
    return "\n".join(lines)


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

    subparsers.add_parser("list", help="list all habits")

    complete_parser = subparsers.add_parser("complete", help="mark a habit complete")
    complete_parser.add_argument("name", help="name of the habit")
    complete_parser.add_argument(
        "--date", default=None, help="completion date (YYYY-MM-DD), defaults to today"
    )

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    data = load_data(args.file)

    if args.command == "add":
        date = args.date or today_str()
        try:
            add_habit(data, args.name, date)
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        save_data(args.file, data)
        print(f"Added habit {args.name!r} (created {date}).")
        return 0

    if args.command == "list":
        print(format_habit_list(list_habits(data)))
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

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
