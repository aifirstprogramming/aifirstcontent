# Sandwich Builder CLI — Implementation Plan

## Context

The workspace is empty. The goal is a standard-library-only Python CLI for
building sandwiches. Through clarification, the user chose a richer design
than the defaults offered:

1. **Inventory/allergen model:** "Layered pantry inventory with substitutions
   and allergen exclusions" — ingredients are organized into sandwich
   "layers" (bread, protein, cheese, veggies, condiments); each ingredient
   tracks stock, allergen tags, and an ordered list of substitute
   ingredients used when the primary choice is out of stock or excluded.
2. **Output:** "Assembly timeline plus a consolidated grocery list" — each
   build prints a numbered, step-by-step construction sequence plus a
   grocery-list section of ingredients running low.
3. **Persistence:** "Named sandwich profiles stored in a single JSON file" —
   pantry stock and user-saved sandwich recipes ("profiles") persist across
   runs in one JSON file, addressable by name for rebuilding later.

This plan combines all three into one coherent app.

## Data Model

Single JSON file (default `sandwich_data.json`, overridable via `--data-file`
so tests can use isolated temp files) holding:

```json
{
  "pantry": {
    "bread":      {"sourdough": {"stock": 6, "allergens": ["gluten"], "substitutes": ["wheat", "gluten_free"]}, ...},
    "protein":    {...},
    "cheese":     {...},
    "veggies":    {...},
    "condiments": {...}
  },
  "profiles": {
    "blt_deluxe": {"bread": "sourdough", "protein": "turkey", "cheese": "cheddar",
                   "veggies": ["lettuce", "tomato"], "condiments": ["mayo"]}
  }
}
```

Layer order: `bread → protein → cheese → veggies → condiments`. `bread`,
`protein`, `cheese` are single-choice; `veggies`/`condiments` accept
comma-separated multiple choices. `bread` and `protein` are required layers;
`cheese`/`veggies`/`condiments` are optional. Bread consumes 2 stock units
(bottom + top slice); everything else consumes 1 unit per selection.

If the data file is missing, a built-in `DEFAULT_PANTRY` is used to
initialize it (small catalog per layer, enough to exercise substitution and
allergen-exclusion paths in tests: e.g. cheddar/swiss/vegan_cheese with
dairy tags and a substitute chain).

## Core Logic (`sandwich_cli.py`)

- `load_data(path)` / `save_data(path, data)` — JSON read/write, creating
  defaults on first load.
- `default_pantry()` — returns the built-in catalog.
- `resolve_ingredient(pantry, layer, name, excluded_allergens)` — walks the
  candidate chain `[name] + substitutes`, skipping any candidate that's
  unknown, out of stock, or has an excluded allergen; returns the chosen
  name plus a substitution note if it differs from the request, or `None`
  with a reason if nothing in the chain qualifies.
- `build_sandwich(data, selections, excluded_allergens)` — resolves every
  requested layer **without mutating stock first** (atomic: if a required
  layer can't be resolved, the whole build fails with no side effects), then
  decrements stock for the resolved choices and returns a result containing
  the ordered assembly steps, substitution notes, and allergen warnings.
- `format_assembly_timeline(result, name)` — numbered steps ("1. Place
  bottom slice of sourdough bread", ..., "N. Top with second slice of
  sourdough bread"), followed by "Substitutions:" and "Warnings:" sections
  when non-empty.
- `format_grocery_list(pantry, threshold=3)` — lists ingredients at/below
  the threshold across all layers, or a "well stocked" message if none.

## CLI Commands (argparse subparsers)

- `inventory` — print the full layered pantry (stock + allergens +
  substitutes).
- `build --bread NAME --protein NAME [--cheese NAME] [--veggies A,B]
  [--condiments A,B] [--exclude allergen,allergen] [--save NAME]` — resolves
  and builds, prints assembly timeline + grocery-list section, persists
  stock changes, optionally saves the selection as a named profile.
- `profiles` — list saved profile names and their ingredient selections.
- `rebuild NAME [--exclude ...]` — loads a saved profile's selections and
  re-runs `build_sandwich` against current stock (may trigger new
  substitutions if stock has changed).
- `restock INGREDIENT AMOUNT` — add stock to a named ingredient (searches
  all layers), persists.
- `grocery-list [--threshold N]` — prints the consolidated low-stock report
  for the whole pantry independent of any build.

All commands accept a global `--data-file PATH` (default
`sandwich_data.json`). Domain errors (unknown ingredient, unresolvable
required layer, unknown profile) print a message to stderr and cause
`main()` to return exit code 1; argparse handles malformed arguments itself.
`main(argv=None) -> int` is the single entry point so tests can call it
directly and capture stdout.

## Tests (`test_sandwich_cli.py`, `unittest`)

Each test uses a `tempfile.TemporaryDirectory` and a `--data-file` inside it
for isolation; call `main([...])` and capture output with
`contextlib.redirect_stdout`.

- Fresh data file auto-initializes default pantry (`inventory` output).
- Full build with all layers: correct stock decrements (bread -2, others
  -1) and correctly ordered assembly timeline.
- Out-of-stock substitution: zero out an ingredient's stock via `restock`
  (negative not allowed) or by pre-seeding the data file, then build and
  assert the substitute is chosen and noted.
- Allergen-exclusion substitution: `--exclude dairy` swaps cheese layer to
  a non-dairy substitute.
- Required layer with no valid candidate (e.g. excluding an allergen that
  eliminates all bread options with no substitutes left) → build fails,
  exit code 1, and pantry stock is unchanged (atomicity check).
- Unknown ingredient name → error, non-zero exit.
- `--save NAME` persists a profile; `profiles` command lists it; JSON file
  contains it.
- `rebuild NAME` reuses a saved profile and re-resolves against current
  stock (substitutes after stock depletion).
- `grocery-list` reports low-stock items at/below threshold, and a
  "well stocked" message when nothing qualifies.
- `restock` increases stock and persists across a second `main()` call
  reusing the same data file (persistence-across-runs check).

## Verification

1. `python3 -m unittest -v test_sandwich_cli.py` — all tests pass.
2. Manual CLI smoke test in the workspace:
   - `python3 sandwich_cli.py inventory`
   - `python3 sandwich_cli.py build --bread sourdough --protein turkey --cheese cheddar --veggies lettuce,tomato --condiments mayo --save blt`
   - `python3 sandwich_cli.py profiles`
   - `python3 sandwich_cli.py rebuild blt`
   - `python3 sandwich_cli.py grocery-list`
   - `python3 sandwich_cli.py build --bread sourdough --protein turkey --cheese cheddar --exclude dairy` (confirm substitution note)
3. Confirm no third-party imports — only `argparse`, `json`, `dataclasses`/
   plain dicts, `pathlib`, `sys`, `copy`, `unittest`, `tempfile`, `contextlib`.