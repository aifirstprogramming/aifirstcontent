/**
 * Local, uncommitted configuration for the authoring scripts.
 *
 * Two things live here that must never reach the repository: where the book
 * manuscripts are on this machine (the books are not open source), and the API key
 * the enrichment script uses. Both are read from `manuscripts.json`, which is
 * gitignored, or from the environment.
 *
 * Nothing the CLI or the extension ships reads this. Only the manuscript,
 * Showtail-import and enrichment authoring tools do, and CI has neither the file
 * nor the key.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface LocalConfig {
  java?: { root?: string; replays?: string };
  py?: { root?: string; replays?: string };
  /** Used by scripts/enrich.ts. ANTHROPIC_API_KEY takes precedence. */
  anthropicApiKey?: string;
}

const ROOT = join(import.meta.dir, "..", "..");

/** Override with AIFIRST_MANUSCRIPTS to keep the config outside the checkout. */
export function configPath(): string {
  return process.env.AIFIRST_MANUSCRIPTS ?? join(ROOT, "manuscripts.json");
}

export function configHelp(path: string): string {
  return [
    `No local config at ${path}.`,
    "",
    "The books are not in this repository, so the authoring scripts need to be told",
    "where they are:",
    "",
    "    cp manuscripts.example.json manuscripts.json",
    "    $EDITOR manuscripts.json",
    "",
    "manuscripts.json is gitignored. Set AIFIRST_MANUSCRIPTS to keep it elsewhere.",
  ].join("\n");
}

/**
 * Is git actually ignoring this file?
 *
 * Checked before handing out a secret rather than trusting that .gitignore still
 * says what it said when this was written. A key in a tracked file is one `git add
 * -A` away from being published, and the whole point of putting it here is that it
 * cannot be.
 */
function isIgnored(path: string): boolean {
  // Resolve first: AIFIRST_MANUSCRIPTS is commonly relative, and comparing a
  // relative path against an absolute root silently concluded "outside the
  // checkout, not git's business" — which disabled this check entirely.
  const abs = resolve(path);
  if (!abs.startsWith(`${ROOT}/`)) return true;
  try {
    execFileSync("git", ["check-ignore", "-q", abs], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let cached: LocalConfig | undefined;

export function readLocalConfig(): LocalConfig {
  if (cached) return cached;
  const path = configPath();
  if (!existsSync(path)) throw new Error(configHelp(path));
  try {
    cached = JSON.parse(readFileSync(path, "utf8")) as LocalConfig;
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  return cached;
}

/**
 * The Anthropic key for the enrichment script.
 *
 * The environment wins, so a machine that already exports ANTHROPIC_API_KEY needs
 * no config change, and nothing here can override a deliberately-set variable.
 */
export function anthropicApiKey(): string {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;

  const path = configPath();
  if (!existsSync(path)) {
    throw new Error(
      `No API key. Export ANTHROPIC_API_KEY, or add "anthropicApiKey" to ${path}.\n\n${configHelp(path)}`,
    );
  }

  const key = readLocalConfig().anthropicApiKey;
  if (!key) {
    throw new Error(
      `No API key. Export ANTHROPIC_API_KEY, or add "anthropicApiKey" to ${path}.`,
    );
  }

  if (!isIgnored(path)) {
    throw new Error(
      `${path} holds an API key but git is not ignoring it.\n` +
        `Add it to .gitignore before running this — a key in a tracked file is one\n` +
        `"git add -A" away from being published.`,
    );
  }

  // Not fatal: a permissive mode is a problem on a shared machine and harmless on a
  // laptop, and refusing to run would be the wrong call for either.
  try {
    const mode = statSync(path).mode & 0o077;
    if (mode !== 0) {
      console.error(`! ${path} is readable by other users. chmod 600 ${path}`);
    }
  } catch {
    // Permission bits are advisory here; a stat failure is not worth stopping for.
  }

  return key;
}

export { dirname };
