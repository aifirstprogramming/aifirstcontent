import contextlib
import io
import json
import os
import tempfile
import unittest

import habit_tracker as ht


class LoadSaveDataTests(unittest.TestCase):
    def test_load_missing_file_returns_empty_structure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "missing.json")
            self.assertEqual(ht.load_data(path), {"habits": {}})

    def test_load_invalid_json_returns_empty_structure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "bad.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{not valid json")
            self.assertEqual(ht.load_data(path), {"habits": {}})

    def test_save_then_load_round_trip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "habits.json")
            data = {
                "habits": {
                    "read": {
                        "created": "2026-01-01",
                        "completions": [],
                        "weekly_goal": 7,
                    }
                }
            }
            ht.save_data(path, data)
            self.assertEqual(ht.load_data(path), data)

    def test_save_writes_sorted_readable_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "habits.json")
            data = {"habits": {"z": {"created": "2026-01-01", "completions": []}}}
            ht.save_data(path, data)
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
            self.assertEqual(json.loads(raw), data)
            self.assertTrue(raw.endswith("\n"))


class AddHabitTests(unittest.TestCase):
    def test_add_new_habit(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-30")
        self.assertEqual(
            data["habits"]["exercise"],
            {"created": "2026-08-30", "completions": [], "weekly_goal": 7},
        )

    def test_add_duplicate_habit_raises(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-30")
        with self.assertRaises(ValueError):
            ht.add_habit(data, "exercise", "2026-08-31")


class CompleteHabitTests(unittest.TestCase):
    def test_complete_unknown_habit_raises(self):
        data = {"habits": {}}
        with self.assertRaises(ValueError):
            ht.complete_habit(data, "exercise", "2026-08-30")

    def test_complete_adds_date(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01")
        ht.complete_habit(data, "exercise", "2026-08-30")
        self.assertEqual(data["habits"]["exercise"]["completions"], ["2026-08-30"])

    def test_complete_is_idempotent_for_same_date(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01")
        ht.complete_habit(data, "exercise", "2026-08-30")
        ht.complete_habit(data, "exercise", "2026-08-30")
        self.assertEqual(data["habits"]["exercise"]["completions"], ["2026-08-30"])

    def test_complete_keeps_dates_sorted(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01")
        ht.complete_habit(data, "exercise", "2026-08-30")
        ht.complete_habit(data, "exercise", "2026-08-15")
        self.assertEqual(
            data["habits"]["exercise"]["completions"],
            ["2026-08-15", "2026-08-30"],
        )


class ListHabitsTests(unittest.TestCase):
    def test_list_empty(self):
        self.assertEqual(ht.list_habits({"habits": {}}, "2026-08-30"), [])

    def test_list_sorted_by_name_with_summary(self):
        data = {"habits": {}}
        ht.add_habit(data, "read", "2026-08-01", weekly_goal=7)
        ht.add_habit(data, "exercise", "2026-08-02", weekly_goal=3)
        ht.complete_habit(data, "exercise", "2026-08-10")
        ht.complete_habit(data, "exercise", "2026-08-05")
        rows = ht.list_habits(data, "2026-08-10")
        self.assertEqual(
            rows,
            [
                ("exercise", "2026-08-02", 2, "2026-08-10", 3, 1),
                ("read", "2026-08-01", 0, "-", 7, 0),
            ],
        )

    def test_list_defaults_as_of_date_to_today(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01")
        rows = ht.list_habits(data)
        self.assertEqual(rows[0][0], "exercise")


class FormatHabitListTests(unittest.TestCase):
    def test_format_empty(self):
        self.assertEqual(ht.format_habit_list([]), "No habits tracked yet.")

    def test_format_includes_header_and_rows(self):
        rows = [("exercise", "2026-08-02", 2, "2026-08-10", 3, 1)]
        output = ht.format_habit_list(rows)
        self.assertIn("NAME", output)
        self.assertIn("GOAL", output)
        self.assertIn("STREAK", output)
        self.assertIn("exercise", output)
        self.assertIn("2026-08-10", output)


class WeekBoundsTests(unittest.TestCase):
    def test_monday_as_of(self):
        self.assertEqual(ht.week_bounds("2026-08-24"), ("2026-08-24", "2026-08-30"))

    def test_sunday_as_of(self):
        self.assertEqual(ht.week_bounds("2026-08-30"), ("2026-08-24", "2026-08-30"))

    def test_midweek_as_of(self):
        self.assertEqual(ht.week_bounds("2026-08-27"), ("2026-08-24", "2026-08-30"))


class CompletionsInRangeTests(unittest.TestCase):
    def test_counts_inclusive_range(self):
        completions = ["2026-08-24", "2026-08-27", "2026-08-30", "2026-08-31"]
        self.assertEqual(
            ht.completions_in_range(completions, "2026-08-24", "2026-08-30"), 3
        )

    def test_empty_completions(self):
        self.assertEqual(ht.completions_in_range([], "2026-08-24", "2026-08-30"), 0)


class StreakTests(unittest.TestCase):
    def test_empty_completions_has_no_streak(self):
        self.assertEqual(ht.current_streak([], "2026-08-30"), 0)

    def test_streak_ending_today(self):
        completions = ["2026-08-28", "2026-08-29", "2026-08-30"]
        self.assertEqual(ht.current_streak(completions, "2026-08-30"), 3)

    def test_streak_alive_when_yesterday_completed(self):
        completions = ["2026-08-28", "2026-08-29"]
        self.assertEqual(ht.current_streak(completions, "2026-08-30"), 2)

    def test_streak_broken_by_gap(self):
        completions = ["2026-08-20", "2026-08-28"]
        self.assertEqual(ht.current_streak(completions, "2026-08-30"), 0)

    def test_longest_streak_across_multiple_runs(self):
        completions = [
            "2026-08-01",
            "2026-08-02",
            "2026-08-10",
            "2026-08-11",
            "2026-08-12",
            "2026-08-13",
            "2026-08-30",
        ]
        self.assertEqual(ht.longest_streak(completions), 4)

    def test_longest_streak_empty(self):
        self.assertEqual(ht.longest_streak([]), 0)


class SetWeeklyGoalTests(unittest.TestCase):
    def test_set_weekly_goal_updates_existing_habit(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01")
        ht.set_weekly_goal(data, "exercise", 3)
        self.assertEqual(data["habits"]["exercise"]["weekly_goal"], 3)

    def test_set_weekly_goal_unknown_habit_raises(self):
        data = {"habits": {}}
        with self.assertRaises(ValueError):
            ht.set_weekly_goal(data, "ghost", 3)

    def test_set_weekly_goal_rejects_non_positive(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01")
        with self.assertRaises(ValueError):
            ht.set_weekly_goal(data, "exercise", 0)

    def test_add_habit_rejects_non_positive_goal(self):
        data = {"habits": {}}
        with self.assertRaises(ValueError):
            ht.add_habit(data, "exercise", "2026-08-01", weekly_goal=0)

    def test_add_habit_default_goal(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01")
        self.assertEqual(data["habits"]["exercise"]["weekly_goal"], 7)


class BuildReportRowsTests(unittest.TestCase):
    def test_status_met_vs_in_progress(self):
        data = {"habits": {}}
        ht.add_habit(data, "exercise", "2026-08-01", weekly_goal=3)
        ht.add_habit(data, "read", "2026-08-01", weekly_goal=7)
        for d in ["2026-08-24", "2026-08-25", "2026-08-26"]:
            ht.complete_habit(data, "exercise", d)
        for d in ["2026-08-24", "2026-08-25"]:
            ht.complete_habit(data, "read", d)
        rows = ht.build_report_rows(data, "2026-08-27")
        self.assertEqual(
            rows,
            [
                ("exercise", 3, 3, 3, "Met"),
                ("read", 7, 2, 0, "In Progress"),
            ],
        )

    def test_empty_data(self):
        self.assertEqual(ht.build_report_rows({"habits": {}}, "2026-08-30"), [])


class FormatReportMarkdownTests(unittest.TestCase):
    def test_matches_approved_table_format(self):
        rows = [
            ("exercise", 3, 2, 5, "In Progress"),
            ("read", 7, 7, 12, "Met"),
        ]
        expected = (
            "# Habit Progress Report (as of 2026-08-30)\n"
            "\n"
            "| Habit | Weekly Goal | This Week | Streak | Status |\n"
            "| --- | --- | --- | --- | --- |\n"
            "| exercise | 3 | 2/3 | 5 | In Progress |\n"
            "| read | 7 | 7/7 | 12 | Met |\n"
        )
        self.assertEqual(ht.format_report_markdown(rows, "2026-08-30"), expected)

    def test_empty_rows(self):
        expected = (
            "# Habit Progress Report (as of 2026-08-30)\n"
            "\n"
            "No habits tracked yet.\n"
        )
        self.assertEqual(ht.format_report_markdown([], "2026-08-30"), expected)


class CliIntegrationTests(unittest.TestCase):
    def run_cli(self, argv):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = ht.main(argv)
        return code, stdout.getvalue()

    def test_add_list_complete_flow(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")

            code, out = self.run_cli(
                ["--file", data_file, "add", "exercise", "--date", "2026-08-01"]
            )
            self.assertEqual(code, 0)
            self.assertIn("Added habit 'exercise'", out)

            code, out = self.run_cli(
                ["--file", data_file, "complete", "exercise", "--date", "2026-08-30"]
            )
            self.assertEqual(code, 0)
            self.assertIn("Completed habit 'exercise' for 2026-08-30", out)

            code, out = self.run_cli(
                ["--file", data_file, "list", "--date", "2026-08-30"]
            )
            self.assertEqual(code, 0)
            self.assertIn("exercise", out)
            self.assertIn("2026-08-30", out)

            with open(data_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
            self.assertEqual(
                saved,
                {
                    "habits": {
                        "exercise": {
                            "created": "2026-08-01",
                            "completions": ["2026-08-30"],
                            "weekly_goal": 7,
                        }
                    }
                },
            )

    def test_add_duplicate_returns_error_code(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            self.run_cli(["--file", data_file, "add", "read", "--date", "2026-08-01"])
            code, _ = self.run_cli(
                ["--file", data_file, "add", "read", "--date", "2026-08-02"]
            )
            self.assertEqual(code, 1)

    def test_complete_unknown_habit_returns_error_code(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            code, _ = self.run_cli(
                ["--file", data_file, "complete", "ghost", "--date", "2026-08-30"]
            )
            self.assertEqual(code, 1)

    def test_list_on_empty_data_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            code, out = self.run_cli(["--file", data_file, "list"])
            self.assertEqual(code, 0)
            self.assertIn("No habits tracked yet.", out)

    def test_add_with_goal_option(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            code, out = self.run_cli(
                [
                    "--file",
                    data_file,
                    "add",
                    "exercise",
                    "--date",
                    "2026-08-01",
                    "--goal",
                    "3",
                ]
            )
            self.assertEqual(code, 0)
            self.assertIn("goal 3/week", out)
            with open(data_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
            self.assertEqual(saved["habits"]["exercise"]["weekly_goal"], 3)


class GoalCommandTests(unittest.TestCase):
    def run_cli(self, argv):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = ht.main(argv)
        return code, stdout.getvalue()

    def test_goal_updates_existing_habit(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            self.run_cli(["--file", data_file, "add", "read", "--date", "2026-08-01"])
            code, out = self.run_cli(["--file", data_file, "goal", "read", "4"])
            self.assertEqual(code, 0)
            self.assertIn("Set weekly goal for 'read' to 4", out)
            with open(data_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
            self.assertEqual(saved["habits"]["read"]["weekly_goal"], 4)

    def test_goal_unknown_habit_returns_error_code(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            code, _ = self.run_cli(["--file", data_file, "goal", "ghost", "3"])
            self.assertEqual(code, 1)

    def test_goal_rejects_non_positive_value(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            self.run_cli(["--file", data_file, "add", "read", "--date", "2026-08-01"])
            code, _ = self.run_cli(["--file", data_file, "goal", "read", "0"])
            self.assertEqual(code, 1)


class ReportCommandTests(unittest.TestCase):
    def run_cli(self, argv):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = ht.main(argv)
        return code, stdout.getvalue()

    def _seed_data(self, data_file):
        self.run_cli(
            ["--file", data_file, "add", "exercise", "--date", "2026-08-01", "--goal", "3"]
        )
        self.run_cli(
            ["--file", data_file, "add", "read", "--date", "2026-08-01", "--goal", "7"]
        )
        for d in ["2026-08-24", "2026-08-25", "2026-08-26"]:
            self.run_cli(["--file", data_file, "complete", "exercise", "--date", d])
        for d in ["2026-08-24", "2026-08-25"]:
            self.run_cli(["--file", data_file, "complete", "read", "--date", d])

    def test_report_to_stdout(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            self._seed_data(data_file)
            code, out = self.run_cli(
                ["--file", data_file, "report", "--date", "2026-08-27"]
            )
            self.assertEqual(code, 0)
            expected = (
                "# Habit Progress Report (as of 2026-08-27)\n"
                "\n"
                "| Habit | Weekly Goal | This Week | Streak | Status |\n"
                "| --- | --- | --- | --- | --- |\n"
                "| exercise | 3 | 3/3 | 3 | Met |\n"
                "| read | 7 | 2/7 | 0 | In Progress |\n"
            )
            self.assertEqual(out, expected)

    def test_report_output_file_matches_stdout(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            self._seed_data(data_file)

            code, stdout_out = self.run_cli(
                ["--file", data_file, "report", "--date", "2026-08-27"]
            )
            self.assertEqual(code, 0)

            output_file = os.path.join(tmpdir, "report.md")
            code, _ = self.run_cli(
                [
                    "--file",
                    data_file,
                    "report",
                    "--date",
                    "2026-08-27",
                    "--output",
                    output_file,
                ]
            )
            self.assertEqual(code, 0)
            with open(output_file, "r", encoding="utf-8") as f:
                file_out = f.read()
            self.assertEqual(file_out, stdout_out)

    def test_reports_are_byte_identical_across_runs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            self._seed_data(data_file)

            report_1 = os.path.join(tmpdir, "report1.md")
            report_2 = os.path.join(tmpdir, "report2.md")
            self.run_cli(
                [
                    "--file",
                    data_file,
                    "report",
                    "--date",
                    "2026-08-27",
                    "--output",
                    report_1,
                ]
            )
            self.run_cli(
                [
                    "--file",
                    data_file,
                    "report",
                    "--date",
                    "2026-08-27",
                    "--output",
                    report_2,
                ]
            )
            with open(report_1, "rb") as f:
                bytes_1 = f.read()
            with open(report_2, "rb") as f:
                bytes_2 = f.read()
            self.assertEqual(bytes_1, bytes_2)

    def test_report_on_empty_data_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "habits.json")
            code, out = self.run_cli(
                ["--file", data_file, "report", "--date", "2026-08-27"]
            )
            self.assertEqual(code, 0)
            self.assertIn("No habits tracked yet.", out)


if __name__ == "__main__":
    unittest.main()
