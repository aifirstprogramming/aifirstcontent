import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import sandwich_cli as sc


class SandwichCliTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.data_file = str(Path(self._tmp.name) / "sandwich_data.json")

    def run_cli(self, args):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            rc = sc.main(["--data-file", self.data_file] + args)
        return rc, stdout.getvalue()

    def read_data(self):
        with open(self.data_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def write_data(self, data):
        with open(self.data_file, "w", encoding="utf-8") as f:
            json.dump(data, f)


class TestInventory(SandwichCliTestCase):
    def test_fresh_file_initializes_default_pantry(self):
        self.assertFalse(Path(self.data_file).exists())
        rc, out = self.run_cli(["inventory"])
        self.assertEqual(rc, 0)
        self.assertIn("BREAD:", out)
        self.assertIn("sourdough", out)
        self.assertTrue(Path(self.data_file).exists())
        data = self.read_data()
        self.assertEqual(data["pantry"]["bread"]["sourdough"]["stock"], 6)


class TestBuild(SandwichCliTestCase):
    def test_full_build_decrements_stock_and_orders_timeline(self):
        rc, out = self.run_cli([
            "build", "--bread", "sourdough", "--protein", "turkey",
            "--cheese", "cheddar", "--veggies", "lettuce,tomato",
            "--condiments", "mayo",
        ])
        self.assertEqual(rc, 0)
        self.assertIn("Assembly Timeline for 'unnamed sandwich':", out)

        lines = [l.strip() for l in out.splitlines() if l.strip().startswith(tuple("1234567"))]
        steps = [l.split(". ", 1)[1] for l in lines]
        self.assertEqual(steps[0], "Place bottom slice of sourdough bread")
        self.assertEqual(steps[-1], "Top with second slice of sourdough bread")
        self.assertIn("Add turkey", steps)
        self.assertIn("Add cheddar", steps)
        self.assertIn("Add lettuce", steps)
        self.assertIn("Add tomato", steps)
        self.assertIn("Add mayo", steps)

        data = self.read_data()
        self.assertEqual(data["pantry"]["bread"]["sourdough"]["stock"], 4)
        self.assertEqual(data["pantry"]["protein"]["turkey"]["stock"], 4)
        self.assertEqual(data["pantry"]["cheese"]["cheddar"]["stock"], 4)
        self.assertEqual(data["pantry"]["veggies"]["lettuce"]["stock"], 9)
        self.assertEqual(data["pantry"]["veggies"]["tomato"]["stock"], 9)
        self.assertEqual(data["pantry"]["condiments"]["mayo"]["stock"], 7)

    def test_grocery_list_included_in_build_output(self):
        rc, out = self.run_cli(["build", "--bread", "sourdough", "--protein", "turkey"])
        self.assertEqual(rc, 0)
        self.assertIn("Grocery List", out)

    def test_out_of_stock_triggers_substitution(self):
        data = sc.default_data()
        data["pantry"]["cheese"]["cheddar"]["stock"] = 0
        self.write_data(data)

        rc, out = self.run_cli([
            "build", "--bread", "sourdough", "--protein", "turkey", "--cheese", "cheddar",
        ])
        self.assertEqual(rc, 0)
        self.assertIn("Substitutions:", out)
        self.assertIn("cheese: cheddar -> swiss", out)

        result_data = self.read_data()
        self.assertEqual(result_data["pantry"]["cheese"]["cheddar"]["stock"], 0)
        self.assertEqual(result_data["pantry"]["cheese"]["swiss"]["stock"], 4)

    def test_allergen_exclusion_triggers_substitution(self):
        rc, out = self.run_cli([
            "build", "--bread", "sourdough", "--protein", "turkey",
            "--cheese", "cheddar", "--exclude", "dairy",
        ])
        self.assertEqual(rc, 0)
        self.assertIn("cheese: cheddar -> vegan_cheese", out)
        self.assertIn("allergen exclusion", out)

        data = self.read_data()
        self.assertEqual(data["pantry"]["cheese"]["cheddar"]["stock"], 5)
        self.assertEqual(data["pantry"]["cheese"]["vegan_cheese"]["stock"], 2)

    def test_required_layer_unresolvable_fails_atomically(self):
        data = sc.default_data()
        for bread in data["pantry"]["bread"].values():
            bread["allergens"] = ["gluten"]
        self.write_data(data)

        rc, out = self.run_cli([
            "build", "--bread", "sourdough", "--protein", "turkey", "--exclude", "gluten",
        ])
        self.assertEqual(rc, 1)

        unchanged = self.read_data()
        self.assertEqual(unchanged["pantry"]["bread"]["sourdough"]["stock"], 6)
        self.assertEqual(unchanged["pantry"]["protein"]["turkey"]["stock"], 5)

    def test_unknown_ingredient_errors(self):
        rc, out = self.run_cli([
            "build", "--bread", "rye", "--protein", "turkey",
        ])
        self.assertEqual(rc, 1)

    def test_save_persists_profile(self):
        rc, out = self.run_cli([
            "build", "--bread", "sourdough", "--protein", "turkey",
            "--cheese", "cheddar", "--save", "blt",
        ])
        self.assertEqual(rc, 0)
        data = self.read_data()
        self.assertIn("blt", data["profiles"])
        self.assertEqual(data["profiles"]["blt"]["bread"], "sourdough")
        self.assertEqual(data["profiles"]["blt"]["protein"], "turkey")
        self.assertEqual(data["profiles"]["blt"]["cheese"], "cheddar")


class TestProfiles(SandwichCliTestCase):
    def test_no_profiles_message(self):
        rc, out = self.run_cli(["profiles"])
        self.assertEqual(rc, 0)
        self.assertIn("No saved sandwich profiles.", out)

    def test_profiles_lists_saved(self):
        self.run_cli([
            "build", "--bread", "sourdough", "--protein", "turkey", "--save", "basic",
        ])
        rc, out = self.run_cli(["profiles"])
        self.assertEqual(rc, 0)
        self.assertIn("basic", out)
        self.assertIn("bread=sourdough", out)


class TestRebuild(SandwichCliTestCase):
    def test_rebuild_uses_saved_profile_and_resubstitutes(self):
        self.run_cli([
            "build", "--bread", "sourdough", "--protein", "turkey",
            "--cheese", "cheddar", "--save", "blt",
        ])
        data = self.read_data()
        data["pantry"]["cheese"]["cheddar"]["stock"] = 0
        self.write_data(data)

        rc, out = self.run_cli(["rebuild", "blt"])
        self.assertEqual(rc, 0)
        self.assertIn("Assembly Timeline for 'blt':", out)
        self.assertIn("cheese: cheddar -> swiss", out)

    def test_rebuild_unknown_profile_errors(self):
        rc, out = self.run_cli(["rebuild", "nope"])
        self.assertEqual(rc, 1)


class TestGroceryList(SandwichCliTestCase):
    def test_well_stocked_message(self):
        rc, out = self.run_cli(["grocery-list", "--threshold", "1"])
        self.assertEqual(rc, 0)
        self.assertIn("well stocked", out)

    def test_low_stock_reported(self):
        data = sc.default_data()
        data["pantry"]["cheese"]["vegan_cheese"]["stock"] = 1
        self.write_data(data)
        rc, out = self.run_cli(["grocery-list"])
        self.assertEqual(rc, 0)
        self.assertIn("vegan_cheese", out)
        self.assertIn("reorder soon", out)

    def test_threshold_option(self):
        rc, out = self.run_cli(["grocery-list", "--threshold", "10"])
        self.assertEqual(rc, 0)
        self.assertIn("sourdough", out)


class TestRestock(SandwichCliTestCase):
    def test_restock_increases_and_persists(self):
        rc, out = self.run_cli(["restock", "cheddar", "5"])
        self.assertEqual(rc, 0)
        self.assertIn("now 10", out)

        rc2, out2 = self.run_cli(["inventory"])
        self.assertEqual(rc2, 0)
        self.assertIn("cheddar: stock=10", out2)

    def test_restock_unknown_ingredient_errors(self):
        rc, out = self.run_cli(["restock", "rye", "5"])
        self.assertEqual(rc, 1)

    def test_restock_nonpositive_amount_errors(self):
        rc, out = self.run_cli(["restock", "cheddar", "0"])
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main()
