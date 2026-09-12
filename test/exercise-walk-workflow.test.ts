import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const workflow = (name: string) =>
  readFileSync(join(root, ".github", "workflows", name), "utf8");

describe("full exercise walk automation", () => {
  test("runs both verification modes with the required runtimes and preserves its report", () => {
    const walk = workflow("exercise-walk.yml");
    expect(walk).toContain("workflow_call:");
    expect(walk).toContain('java-version: "21"');
    expect(walk).toContain("sudo apt-get install --no-install-recommends -y maven");
    expect(walk).toContain("--isolated --sequential --report test-results/book-walk/report.json");
    expect(walk).toContain("if: always()");
  });

  test("gates pull requests, main, and releases", () => {
    expect(workflow("ci.yml")).toContain("uses: ./.github/workflows/exercise-walk.yml");
    const release = workflow("release.yml");
    expect(release).toContain("uses: ./.github/workflows/exercise-walk.yml");
    expect(release).toContain("needs: exercise-walk");
  });
});
