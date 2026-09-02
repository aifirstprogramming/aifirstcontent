#!/usr/bin/env bun
/** Embed canonical binary exercise assets into the JSON content pack. */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RawBook, RawExample, RawPromptStep, ScaffoldFile } from "../src/types";

const root = join(import.meta.dir, "..");
const bookPath = join(root, "books", "ai-first-python-programming.json");
const assetRoot = join(root, "assets", "python", "save-the-duckling");
const check = process.argv.includes("--check");
const exerciseIds = new Set([
  "py-9-01",
  "py-9-02",
  "py-9-03",
  "py-10-01",
  "py-10-02",
  "py-10-03",
]);
const assetNames = [
  "bush.png",
  "duckling.png",
  "fox.png",
  "grass_tile.png",
  "mother_duck.png",
  "rock.png",
  "sibling_1.png",
  "sibling_2.png",
  "sibling_3.png",
  "water_tile.png",
];

const assets: ScaffoldFile[] = assetNames.map((name) => ({
  path: `assets/${name}`,
  contentBase64: readFileSync(join(assetRoot, name)).toString("base64"),
}));

const book = JSON.parse(readFileSync(bookPath, "utf8")) as RawBook;
let changed = false;
const found = new Set<string>();

function syncTarget(target: RawExample | RawPromptStep): void {
  if (!exerciseIds.has(target.id)) return;
  found.add(target.id);
  if (!target.scaffold) throw new Error(`${target.id} has no scaffold`);
  const textFiles = target.scaffold.files.filter((file) => file.contentBase64 === undefined);
  const files = [...textFiles, ...assets].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(files) !== JSON.stringify(target.scaffold.files)) {
    target.scaffold.files = files;
    changed = true;
  }
}

for (const section of book.sections)
  for (const chapter of section.chapters)
    for (const example of chapter.examples)
      for (const target of example.prompts ?? [example])
        syncTarget(target);

const missing = [...exerciseIds].filter((id) => !found.has(id));
if (missing.length > 0) throw new Error(`Missing duckling exercises: ${missing.join(", ")}`);

if (check) {
  if (changed) {
    console.error("Duckling binary assets are out of sync. Run `bun run sync-assets`.");
    process.exit(1);
  }
  console.log(`Duckling assets are in sync (${assets.length} files).`);
} else {
  if (changed) writeFileSync(bookPath, `${JSON.stringify(book, null, 2)}\n`);
  console.log(`${changed ? "Synced" : "Already synced"} ${assets.length} duckling assets.`);
}
