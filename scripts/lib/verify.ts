/**
 * Prove an exercise runs, before it is published.
 *
 * A draft becomes visible to readers only if it passes here, so this is the gate
 * that keeps a generated explanation from being attached to code that does not work.
 *
 * Two rules shape the design:
 *
 *   1. The response is never modified. It is byte-exact to the printed page. Code
 *      that cannot run alone gets extra files from its scaffold instead.
 *   2. The run command is derived here, not chosen by a model. A model asked for a
 *      command will happily suggest `mvn test` on a machine with no Maven; deriving
 *      it from kind and language means it either runs or the kind is wrong.
 *
 * What "passes" means depends on the kind, because not every exercise is a program:
 *
 *   program  executes and exits 0
 *   class    compiles (Java) or imports without error (Python) -- a class with no
 *            entry point has nothing to execute, and pretending otherwise would
 *            mean inventing a driver the book never showed
 *   test     the test suite passes
 *   snippet  executes, once its scaffold supplies the surrounding code
 *   project  not verifiable here; stays a draft
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCommand, suggestFilename } from "../../src/filenames";
import type { Example, Scaffold, Step } from "../../src/types";

/** JUnit console launcher, fetched once. Java `test` exercises need it. */
export const JUNIT_JAR = join(
  process.env.HOME ?? "/tmp",
  ".aifirst-toolcache",
  "junit-console.jar",
);

export const JUNIT_URL =
  "https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/1.10.2/" +
  "junit-platform-console-standalone-1.10.2.jar";

export function junitAvailable(): boolean {
  return existsSync(JUNIT_JAR);
}

export interface VerifyResult {
  ok: boolean;
  /** What was actually executed, for the failure report. */
  command: string;
  output: string;
  /** Set when the kind cannot be verified on this machine at all. */
  skipped?: string;
}

/**
 * Did the program run and then throw, as opposed to failing to build?
 *
 * Some exercises teach exception handling by deliberately throwing -- Chapter 4's
 * coffee examples end with a call the text describes as "will throw the particular
 * error". Those exit non-zero on purpose, so requiring exit 0 would reject working
 * code. The distinction that matters is whether the program got as far as running:
 * it must have produced output and died with an exception, not a compile error.
 */
function threwAtRuntime(stdout: string, stderr: string): boolean {
  if (stdout.trim() === "") return false;
  if (/^\S+\.java:\d+: error:/m.test(stderr)) return false;
  return /Exception|Error\b/.test(stderr) || /Traceback \(most recent call last\)/.test(stderr);
}

/** Java's public class name decides the filename, so read it from the code. */
function javaClassName(code: string): string | undefined {
  return code.match(/(?:public\s+)?(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)/)?.[1];
}

function hasJavaMain(code: string): boolean {
  return /static\s+void\s+main\s*\(/.test(code);
}

/**
 * Write the exercise and its scaffold to a directory.
 *
 * `fromExercise` resolves through the whole pack so a scaffold can reuse an earlier
 * exercise's code rather than copying it -- copies drift, references cannot.
 */
export function materialize(
  dir: string,
  example: Example,
  step: Step,
  scaffold: Scaffold | undefined,
  responseOf: (exerciseId: string) => string | undefined,
): { mainFile: string; problems: string[] } {
  const problems: string[] = [];
  const mainFile = suggestFilename(example, step);
  writeFileSync(join(dir, mainFile), step.response.endsWith("\n") ? step.response : `${step.response}\n`);

  for (const file of scaffold?.files ?? []) {
    if (file.path.includes("..") || file.path.startsWith("/")) {
      problems.push(`scaffold path escapes the exercise directory: ${file.path}`);
      continue;
    }
    let content = file.content;
    if (file.fromExercise) {
      content = responseOf(file.fromExercise);
      if (content === undefined) {
        problems.push(`scaffold references unknown exercise ${file.fromExercise}`);
        continue;
      }
    }
    if (content === undefined) {
      problems.push(`scaffold file ${file.path} has neither content nor fromExercise`);
      continue;
    }
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`);
  }

  return { mainFile, problems };
}

/** The command that decides whether this exercise passes. */
export function verifyCommand(
  example: Example,
  step: Step,
  mainFile: string,
  scaffold: Scaffold | undefined,
): { argv: string[]; skipped?: string } {
  const entry = scaffold?.entrypoint;
  const kind = example.kind;

  if (example.language === "python") {
    // A scaffold entrypoint wins: for a snippet, the exercise's own file is
    // imported by the driver rather than run directly.
    if (entry) return { argv: ["python3", entry] };
    if (kind === "test") return { argv: ["python3", "-m", "unittest", "-v", mainFile.replace(/\.py$/, "")] };
    // `class` included: running the file executes its definitions, which catches a
    // syntax or name error without inventing a driver.
    return { argv: ["python3", mainFile] };
  }

  if (example.language === "java") {
    if (kind === "test") {
      if (!junitAvailable()) {
        return { argv: [], skipped: `JUnit launcher missing; fetch it to ${JUNIT_JAR}` };
      }
      return { argv: ["__junit__", mainFile] };
    }
    if (entry) return { argv: ["java", entry] };
    // The single-file source launcher needs an entry point. Without one, compiling
    // is the strongest honest check.
    if (kind === "class" || !hasJavaMain(step.response)) {
      return { argv: ["javac", "-d", "out", mainFile] };
    }
    return { argv: runCommand("java", mainFile) ?? ["java", mainFile] };
  }

  return { argv: [], skipped: `no verification defined for language ${example.language}` };
}

/**
 * Compile against JUnit, then run the suite.
 *
 * The classpath includes "." deliberately. Passing -cp with only the JUnit jar
 * *replaces* javac's default classpath of the current directory, so a test whose
 * scaffold supplies the class under test could no longer see it -- every Thermostat
 * test failed with "cannot find symbol" while the file sat right next to it.
 */
function runJunit(dir: string, mainFile: string, timeoutMs: number): VerifyResult {
  const cls = mainFile.replace(/\.java$/, "");
  const cp = `${JUNIT_JAR}:.`;
  const compile = spawnSync("javac", ["-cp", cp, "-sourcepath", ".", "-d", "out", mainFile], {
    cwd: dir,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (compile.status !== 0) {
    return {
      ok: false,
      command: `javac -cp junit:. -sourcepath . -d out ${mainFile}`,
      output: `${compile.stdout ?? ""}${compile.stderr ?? ""}`.trim(),
    };
  }
  const run = spawnSync(
    "java",
    ["-jar", JUNIT_JAR, "execute", "-cp", "out", "--select-class", cls, "--details=summary"],
    { cwd: dir, encoding: "utf8", timeout: timeoutMs },
  );
  return {
    ok: run.status === 0,
    command: `java -jar junit execute --select-class ${cls}`,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim(),
  };
}

/**
 * Is the exercise's own code even valid in its language?
 *
 * Checked separately because a scaffold `entrypoint` redirects execution to another
 * file, which means a broken response can pass by never being run. py-2-13 slipped
 * through exactly that way: its stored "code" was the program's terminal transcript,
 * and a scaffold ran something else. The response is what a reader copies, so it is
 * always checked on its own terms.
 */
function syntaxCheck(dir: string, language: string, mainFile: string, timeoutMs: number): VerifyResult | undefined {
  const argv =
    language === "python"
      ? ["python3", "-m", "py_compile", mainFile]
      : language === "java"
        ? ["javac", "-d", "syntax-out", "-proc:none", mainFile]
        : undefined;
  if (!argv) return undefined;

  const r = spawnSync(argv[0], argv.slice(1), { cwd: dir, encoding: "utf8", timeout: timeoutMs });
  if (r.status === 0) return undefined;
  const detail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return {
    ok: false,
    command: argv.join(" "),
    output: `the exercise's own code is not valid ${language}:\n${detail}`,
  };
}

export interface VerifyOptions {
  timeoutMs?: number;
  responseOf?: (exerciseId: string) => string | undefined;
  /**
   * The exercise demonstrates an uncaught exception, so a non-zero exit is the
   * expected outcome rather than a failure.
   */
  expectsUncaughtException?: boolean;
}

/** Materialize the exercise in a temp directory and run its verification. */
export function verify(
  example: Example,
  step: Step,
  scaffold: Scaffold | undefined,
  stdin: string | undefined,
  options: VerifyOptions = {},
): VerifyResult {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const responseOf = options.responseOf ?? (() => undefined);

  if (example.kind === "project") {
    return { ok: false, command: "", output: "", skipped: "project exercises are not verified here" };
  }

  const dir = mkdtempSync(join(tmpdir(), "aifirst-enrich-"));
  try {
    const { mainFile, problems } = materialize(dir, example, step, scaffold, responseOf);
    if (problems.length > 0) {
      return { ok: false, command: "", output: problems.join("\n") };
    }

    const { argv, skipped } = verifyCommand(example, step, mainFile, scaffold);
    if (skipped) return { ok: false, command: "", output: "", skipped };

    // Only when a scaffold entrypoint means the response would not otherwise run,
    // and never for a snippet: a fragment the book prints with an elision ("…", or
    // "//variables, constructor, and getStatus method") is not valid on its own by
    // design, and its scaffold is the only way to exercise it. Everywhere else the
    // run itself is the stronger check.
    if (scaffold?.entrypoint && example.kind !== "snippet") {
      const bad = syntaxCheck(dir, example.language, mainFile, timeoutMs);
      if (bad) return bad;
    }

    if (argv[0] === "__junit__") return runJunit(dir, mainFile, timeoutMs);

    mkdirSync(join(dir, "out"), { recursive: true });
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: dir,
      encoding: "utf8",
      timeout: timeoutMs,
      // An exercise that reads input and gets none would hang until the timeout,
      // so an empty string still closes the stream.
      input: stdin ?? "",
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const output = `${stdout}${stderr}`.trim();
    if (result.error) {
      return { ok: false, command: argv.join(" "), output: `${output}\n${result.error.message}`.trim() };
    }
    const ok =
      result.status === 0 ||
      ((options.expectsUncaughtException ?? false) && threwAtRuntime(stdout, stderr));
    return { ok, command: argv.join(" "), output };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A leftover temp dir is not worth failing a verification run over.
    }
  }
}
