/**
 * Where an exercise's code should be written.
 *
 * Lives here rather than in the CLI because two things need to agree: the CLI
 * writing a learner's file, and the content repo's CI actually executing every
 * exercise. If they disagreed, CI could pass on a filename the learner never
 * gets.
 */

import type { Example, Step } from "./types";

function words(title: string): string[] {
  return title
    .replace(/[^A-Za-z0-9 ]+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function snakeCase(title: string): string {
  return words(title)
    .map((w) => w.toLowerCase())
    .join("_");
}

export function pascalCase(title: string): string {
  return words(title)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/**
 * Pick a filename the exercise will actually run from.
 *
 * Java is the interesting case: `javac` rejects a file whose name doesn't match
 * its public class, so the class name is read out of the code rather than guessed
 * from the exercise title.
 */
export function suggestFilename(example: Example, step: Step = example.steps[example.steps.length - 1]): string {
  if (example.language === "java") {
    // interface/enum/record too, not just class: javac rejects any public type
    // whose filename does not match, and the books declare all four.
    const m = step.response.match(
      /(?:public\s+)?(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/,
    );
    return `${m ? m[1] : pascalCase(example.title) || "Main"}.java`;
  }
  return `${snakeCase(example.title) || "main"}.py`;
}

/** How to execute a written file, given the exercise's language. */
export function runCommand(language: string, path: string): string[] | undefined {
  if (language === "python") return ["python3", path];
  // JDK 11+ runs a single source file directly, so a learner needs no separate
  // compile step and no build tool.
  if (language === "java") return ["java", path];
  return undefined;
}
