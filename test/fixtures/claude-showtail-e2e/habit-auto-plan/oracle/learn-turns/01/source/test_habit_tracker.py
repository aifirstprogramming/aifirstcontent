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
            data = {"habits": {"read": {"created": "2026-01-01", "completions": []}}}
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
            {"created": "2026-08-30", "completions": []},
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
        self.assertEqual(ht.list_habits({"habits": {}}), [])

    def test_list_sorted_by_name_with_summary(self):
        data = {"habits": {}}
        ht.add_habit(data, "read", "2026-08-01")
        ht.add_habit(data, "exercise", "2026-08-02")
        ht.complete_habit(data, "exercise", "2026-08-10")
        ht.complete_habit(data, "exercise", "2026-08-05")
        rows = ht.list_habits(data)
        self.assertEqual(
            rows,
            [
                ("exercise", "2026-08-02", 2, "2026-08-10"),
                ("read", "2026-08-01", 0, "-"),
            ],
        )


class FormatHabitListTests(unittest.TestCase):
    def test_format_empty(self):
        self.assertEqual(ht.format_habit_list([]), "No habits tracked yet.")

    def test_format_includes_header_and_rows(self):
        rows = [("exercise", "2026-08-02", 2, "2026-08-10")]
        output = ht.format_habit_list(rows)
        self.assertIn("NAME", output)
        self.assertIn("exercise", output)
        self.assertIn("2026-08-10", output)


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

            code, out = self.run_cli(["--file", data_file, "list"])
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


if __name__ == "__main__":
    unittest.main()
