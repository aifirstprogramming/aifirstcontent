/** Build the test-only rocket book from a Showtail bundle and final source tree. */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { RawBook } from "../../src/types";
import { deriveReplay, type ImportDiagnostic } from "./import-showtail";
import { parseShowtailReport } from "./showtail";

export interface RocketFixtureResult {
  book?: RawBook;
  diagnostics: ImportDiagnostic[];
}

function sourceFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__pycache__") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".py")) {
        files.set(
          relative(root, path).replace(/\\/g, "/"),
          readFileSync(path, "utf8"),
        );
      }
    }
  };
  visit(root);
  return files;
}

export function generateRocketFixture(bundle: string): RocketFixtureResult {
  const reportPath = join(bundle, "report.json");
  const reportText = readFileSync(reportPath, "utf8");
  const report = parseShowtailReport(JSON.parse(reportText));
  const files = sourceFiles(join(bundle, "source"));
  const response = files.get("rocket_sim.py");
  if (!response) {
    return {
      diagnostics: [
        {
          category: "missing",
          severity: "error",
          field: "responsePath",
          message: "rocket_sim.py is missing from the final source tree",
        },
      ],
    };
  }
  const derived = deriveReplay({
    report,
    reportText,
    turnIndex: 0,
    sourceFiles: files,
    response: response.endsWith("\n") ? response.slice(0, -1) : response,
    initialFiles: new Map(),
  });
  if (!derived.replay || !derived.scaffold)
    return { diagnostics: derived.diagnostics };
  const prompt = report.turns[0]?.prompt.text ?? "";
  const book: RawBook = {
    title: "AI First Rocket Replay Fixture",
    tag: "py",
    language: "python",
    sections: [
      {
        title: "Integration Tests",
        chapters: [
          {
            title: "Chapter 99 - Showtail Replay",
            examples: [
              {
                id: "py-99-01",
                title: "Deterministic Rocket Simulation",
                kind: "project",
                prompt,
                response: response.endsWith("\n")
                  ? response.slice(0, -1)
                  : response,
                scaffold: derived.scaffold,
                replay: derived.replay,
              },
            ],
          },
        ],
      },
    ],
  };
  return { book, diagnostics: derived.diagnostics };
}
