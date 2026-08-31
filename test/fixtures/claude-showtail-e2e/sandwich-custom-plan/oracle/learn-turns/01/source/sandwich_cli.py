#!/usr/bin/env python3
"""Standard-library CLI for building sandwiches from a layered pantry."""

import argparse
import copy
import json
import sys
from pathlib import Path

LAYER_ORDER = ["bread", "protein", "cheese", "veggies", "condiments"]
REQUIRED_LAYERS = {"bread", "protein"}
MULTI_LAYERS = {"veggies", "condiments"}
DEFAULT_DATA_FILE = "sandwich_data.json"
DEFAULT_LOW_STOCK_THRESHOLD = 3


def default_pantry():
    return {
        "bread": {
            "sourdough": {"stock": 6, "allergens": ["gluten"], "substitutes": ["wheat", "gluten_free"]},
            "wheat": {"stock": 6, "allergens": ["gluten"], "substitutes": ["sourdough", "gluten_free"]},
            "gluten_free": {"stock": 4, "allergens": [], "substitutes": []},
        },
        "protein": {
            "turkey": {"stock": 5, "allergens": [], "substitutes": ["ham", "tofu"]},
            "ham": {"stock": 5, "allergens": [], "substitutes": ["turkey", "tofu"]},
            "tofu": {"stock": 4, "allergens": ["soy"], "substitutes": []},
        },
        "cheese": {
            "cheddar": {"stock": 5, "allergens": ["dairy"], "substitutes": ["swiss", "vegan_cheese"]},
            "swiss": {"stock": 5, "allergens": ["dairy"], "substitutes": ["vegan_cheese"]},
            "vegan_cheese": {"stock": 3, "allergens": [], "substitutes": []},
        },
        "veggies": {
            "lettuce": {"stock": 10, "allergens": [], "substitutes": ["spinach"]},
            "tomato": {"stock": 10, "allergens": [], "substitutes": []},
            "spinach": {"stock": 8, "allergens": [], "substitutes": ["lettuce"]},
        },
        "condiments": {
            "mayo": {"stock": 8, "allergens": ["egg"], "substitutes": ["vegan_mayo"]},
            "mustard": {"stock": 8, "allergens": [], "substitutes": []},
            "vegan_mayo": {"stock": 4, "allergens": [], "substitutes": ["mustard"]},
        },
    }


def default_data():
    return {"pantry": default_pantry(), "profiles": {}}


def load_data(path):
    p = Path(path)
    if not p.exists():
        data = default_data()
        save_data(path, data)
        return data
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_data(path, data):
    with Path(path).open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def find_ingredient_layer(pantry, ingredient_name):
    for layer in LAYER_ORDER:
        if ingredient_name in pantry[layer]:
            return layer
    return None


class ResolutionError(Exception):
    pass


def resolve_ingredient(pantry, layer, name, excluded_allergens):
    """Walk the [name] + substitutes chain for `layer`.

    Returns (chosen_name, note_or_None). Raises ResolutionError if nothing
    in the chain is a valid, in-stock, non-excluded ingredient.
    """
    catalog = pantry[layer]
    if name not in catalog:
        raise ResolutionError(f"unknown {layer} ingredient: {name!r}")

    chain = [name] + list(catalog[name].get("substitutes", []))
    tried = []
    for candidate in chain:
        info = catalog.get(candidate)
        if info is None:
            continue
        if info["stock"] <= 0:
            tried.append(f"{candidate} (out of stock)")
            continue
        if set(info["allergens"]) & set(excluded_allergens):
            tried.append(f"{candidate} (contains excluded allergen)")
            continue
        note = None
        if candidate != name:
            reason = "out of stock" if catalog[name]["stock"] <= 0 else "allergen exclusion"
            note = f"{layer}: {name} -> {candidate} ({reason})"
        return candidate, note

    raise ResolutionError(
        f"no available {layer} option for {name!r}; tried: {', '.join(tried) if tried else 'nothing available'}"
    )


def build_sandwich(data, selections, excluded_allergens):
    """Resolve all requested layers atomically, then decrement stock.

    `selections` maps layer -> str (single-choice layers) or list[str]
    (multi layers). Returns a result dict with assembly steps,
    substitutions, and warnings. Raises ResolutionError without mutating
    state if a required layer cannot be resolved.
    """
    pantry = data["pantry"]
    excluded_allergens = set(excluded_allergens or [])

    resolved = {}  # layer -> list of chosen ingredient names
    substitutions = []
    warnings = []

    for layer in LAYER_ORDER:
        requested = selections.get(layer)
        if not requested:
            continue
        names = requested if layer in MULTI_LAYERS else [requested]
        chosen_names = []
        for name in names:
            try:
                chosen, note = resolve_ingredient(pantry, layer, name, excluded_allergens)
            except ResolutionError:
                if layer in REQUIRED_LAYERS:
                    raise
                warnings.append(f"{layer}: skipped {name!r} ({sys.exc_info()[1]})")
                continue
            chosen_names.append(chosen)
            if note:
                substitutions.append(note)
            allergens = pantry[layer][chosen]["allergens"]
            if allergens:
                warnings.append(f"{chosen} ({layer}) contains allergen(s): {', '.join(allergens)}")
        if chosen_names:
            resolved[layer] = chosen_names

    for req in REQUIRED_LAYERS:
        if req not in resolved:
            raise ResolutionError(f"required layer {req!r} has no resolvable ingredient")

    steps = []
    bread_name = resolved["bread"][0]
    steps.append(f"Place bottom slice of {bread_name.replace('_', ' ')} bread")
    for layer in ["protein", "cheese", "veggies", "condiments"]:
        for ingredient in resolved.get(layer, []):
            steps.append(f"Add {ingredient.replace('_', ' ')}")
    steps.append(f"Top with second slice of {bread_name.replace('_', ' ')} bread")

    consumed = {}
    for layer, names in resolved.items():
        for ingredient in names:
            amount = 2 if layer == "bread" else 1
            pantry[layer][ingredient]["stock"] -= amount
            consumed[ingredient] = consumed.get(ingredient, 0) + amount

    return {
        "steps": steps,
        "substitutions": substitutions,
        "warnings": warnings,
        "consumed": consumed,
        "resolved": resolved,
    }


def format_assembly_timeline(result, name):
    lines = [f"Assembly Timeline for {name!r}:"]
    for i, step in enumerate(result["steps"], start=1):
        lines.append(f"  {i}. {step}")
    if result["substitutions"]:
        lines.append("Substitutions:")
        for note in result["substitutions"]:
            lines.append(f"  - {note}")
    if result["warnings"]:
        lines.append("Warnings:")
        for note in result["warnings"]:
            lines.append(f"  - {note}")
    return "\n".join(lines)


def format_grocery_list(pantry, threshold=DEFAULT_LOW_STOCK_THRESHOLD):
    low = []
    for layer in LAYER_ORDER:
        for ingredient, info in pantry[layer].items():
            if info["stock"] <= threshold:
                low.append((layer, ingredient, info["stock"]))
    if not low:
        return f"Grocery List (threshold={threshold}): pantry is well stocked."
    lines = [f"Grocery List (threshold={threshold}):"]
    for layer, ingredient, stock in sorted(low):
        lines.append(f"  - {ingredient} ({layer}): {stock} remaining, reorder soon")
    return "\n".join(lines)


def format_inventory(pantry):
    lines = ["Pantry Inventory:"]
    for layer in LAYER_ORDER:
        lines.append(f"{layer.upper()}:")
        for ingredient, info in sorted(pantry[layer].items()):
            allergens = ", ".join(info["allergens"]) if info["allergens"] else "none"
            substitutes = ", ".join(info["substitutes"]) if info["substitutes"] else "none"
            lines.append(
                f"  - {ingredient}: stock={info['stock']}, allergens=[{allergens}], substitutes=[{substitutes}]"
            )
    return "\n".join(lines)


def format_profiles(profiles):
    if not profiles:
        return "No saved sandwich profiles."
    lines = ["Saved Sandwich Profiles:"]
    for name, selections in sorted(profiles.items()):
        parts = []
        for layer in LAYER_ORDER:
            value = selections.get(layer)
            if not value:
                continue
            if isinstance(value, list):
                parts.append(f"{layer}={'+'.join(value)}")
            else:
                parts.append(f"{layer}={value}")
        lines.append(f"  - {name}: {', '.join(parts)}")
    return "\n".join(lines)


def _split_csv(value):
    if not value:
        return None
    return [v.strip() for v in value.split(",") if v.strip()]


def cmd_inventory(args, data):
    print(format_inventory(data["pantry"]))
    return 0


def cmd_build(args, data):
    selections = {
        "bread": args.bread,
        "protein": args.protein,
        "cheese": args.cheese,
        "veggies": _split_csv(args.veggies),
        "condiments": _split_csv(args.condiments),
    }
    excluded = _split_csv(args.exclude) or []
    try:
        result = build_sandwich(data, selections, excluded)
    except ResolutionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    name = args.save or "unnamed sandwich"
    print(format_assembly_timeline(result, name))
    print()
    print(format_grocery_list(data["pantry"]))

    if args.save:
        data["profiles"][args.save] = {
            layer: (selections[layer] if layer in MULTI_LAYERS else selections[layer])
            for layer in LAYER_ORDER
            if selections.get(layer)
        }
    return 0


def cmd_profiles(args, data):
    print(format_profiles(data["profiles"]))
    return 0


def cmd_rebuild(args, data):
    profile = data["profiles"].get(args.name)
    if profile is None:
        print(f"error: no saved profile named {args.name!r}", file=sys.stderr)
        return 1
    excluded = _split_csv(args.exclude) or []
    try:
        result = build_sandwich(data, profile, excluded)
    except ResolutionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(format_assembly_timeline(result, args.name))
    print()
    print(format_grocery_list(data["pantry"]))
    return 0


def cmd_restock(args, data):
    layer = find_ingredient_layer(data["pantry"], args.ingredient)
    if layer is None:
        print(f"error: unknown ingredient {args.ingredient!r}", file=sys.stderr)
        return 1
    if args.amount <= 0:
        print("error: amount must be positive", file=sys.stderr)
        return 1
    data["pantry"][layer][args.ingredient]["stock"] += args.amount
    print(f"Restocked {args.ingredient} ({layer}): +{args.amount}, "
          f"now {data['pantry'][layer][args.ingredient]['stock']}")
    return 0


def cmd_grocery_list(args, data):
    print(format_grocery_list(data["pantry"], threshold=args.threshold))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="sandwich_cli", description="Build sandwiches from a layered pantry.")
    parser.add_argument("--data-file", default=DEFAULT_DATA_FILE, help="path to the JSON persistence file")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("inventory", help="show the full layered pantry")

    p_build = sub.add_parser("build", help="build a sandwich")
    p_build.add_argument("--bread", required=True)
    p_build.add_argument("--protein", required=True)
    p_build.add_argument("--cheese")
    p_build.add_argument("--veggies", help="comma-separated list")
    p_build.add_argument("--condiments", help="comma-separated list")
    p_build.add_argument("--exclude", help="comma-separated allergens to exclude")
    p_build.add_argument("--save", help="save this selection as a named profile")

    sub.add_parser("profiles", help="list saved sandwich profiles")

    p_rebuild = sub.add_parser("rebuild", help="rebuild a saved profile")
    p_rebuild.add_argument("name")
    p_rebuild.add_argument("--exclude", help="comma-separated allergens to exclude")

    p_restock = sub.add_parser("restock", help="add stock to an ingredient")
    p_restock.add_argument("ingredient")
    p_restock.add_argument("amount", type=int)

    p_grocery = sub.add_parser("grocery-list", help="show consolidated low-stock report")
    p_grocery.add_argument("--threshold", type=int, default=DEFAULT_LOW_STOCK_THRESHOLD)

    return parser


COMMANDS = {
    "inventory": cmd_inventory,
    "build": cmd_build,
    "profiles": cmd_profiles,
    "rebuild": cmd_rebuild,
    "restock": cmd_restock,
    "grocery-list": cmd_grocery_list,
}


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    data = load_data(args.data_file)
    handler = COMMANDS[args.command]
    rc = handler(args, data)
    save_data(args.data_file, data)
    return rc


if __name__ == "__main__":
    sys.exit(main())
