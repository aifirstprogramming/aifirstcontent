#!/usr/bin/env bun
/** Regenerate the committed test-only book from the untouched rocket bundle. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateRocketFixture } from "./lib/rocket-fixture";

const fixture = join(
  import.meta.dir,
  "..",
  "test",
  "fixtures",
  "rocket-showtail",
);
const output = join(fixture, "generated", "books", "rocket-python.json");
const result = generateRocketFixture(join(fixture, "bundle"));
const errors = result.diagnostics.filter((item) => item.severity === "error");
if (!result.book || errors.length > 0) {
  for (const item of result.diagnostics)
    console.error(
      `${item.severity} ${item.category} ${item.field}: ${item.message}`,
    );
  process.exit(1);
}
mkdirSync(join(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(result.book, null, 2)}\n`);
console.log(output);
