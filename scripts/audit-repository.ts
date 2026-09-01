#!/usr/bin/env bun
/** Fail when private authoring material or high-confidence credentials enter the tree. */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface Finding {
  category: string;
  path: string;
  line?: number;
}

const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter((path) => path && existsSync(path));
const findings: Finding[] = [];
const add = (category: string, path: string, line?: number) => {
  if (!findings.some((item) => item.category === category && item.path === path && item.line === line))
    findings.push({ category, path, ...(line === undefined ? {} : { line }) });
};

const allowedRawFixture = (path: string): boolean =>
  /^test\/fixtures\/.+\/oracle\/.+\.(?:jsonl|log)$/.test(path);
const allowedBinary = (path: string): boolean =>
  /^assets\/.+\.(?:png|jpe?g|gif|webp)$/i.test(path);
const privateDataScope = (path: string): boolean =>
  /^(?:books|replays|docs)\//.test(path);

const secretPatterns: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ["credential URL", /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@/],
];
const privatePathPatterns: Array<[string, RegExp]> = [
  ["macOS author home", /\/Users\/[A-Za-z0-9._-]+/],
  ["Windows author home", /[A-Za-z]:\\Users\\[^\\\s"'`]+/i],
  ["Linux author home", /\/home\/[A-Za-z0-9._-]+/],
  ["private sync directory", /\b(?:Nextcloud|OneDrive|Dropbox)\b/i],
  ["email-derived identity slug", /\b[a-z0-9._-]+-at-(?:gmail|outlook|yahoo|protonmail)-com\b/i],
  ["raw authorship metadata", /"(?:authorship|contributors|actorSlug)"\s*:/],
];

for (const path of files) {
  if (path === ".showtail" || path.startsWith(".showtail/"))
    add("tracked Showtail state", path);
  if (/\.(?:docx?|pdf|zip|7z|tar|tgz)$/i.test(path))
    add("private manuscript/archive type", path);
  if (/\/legacy\/report-v1\.json$/.test(path))
    add("raw legacy replay report", path);
  if (/\.(?:jsonl|log)$/i.test(path) && !allowedRawFixture(path))
    add("unexpected raw session/log file", path);

  const data = readFileSync(path);
  if (data.includes(0)) {
    if (!allowedBinary(path)) add("unexpected binary/NUL file", path);
    continue;
  }
  const lines = data.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    for (const [category, pattern] of secretPatterns)
      if (pattern.test(line)) add(category, path, index + 1);
    if (privateDataScope(path))
      for (const [category, pattern] of privatePathPatterns)
        if (pattern.test(line)) add(category, path, index + 1);
  }
}

findings.sort((left, right) =>
  left.path.localeCompare(right.path) ||
  (left.line ?? 0) - (right.line ?? 0) ||
  left.category.localeCompare(right.category),
);

if (findings.length > 0) {
  console.error(`Repository privacy audit found ${findings.length} problem(s):`);
  for (const finding of findings)
    console.error(`  ${finding.path}${finding.line ? `:${finding.line}` : ""}  ${finding.category}`);
  process.exit(1);
}

console.log(`Repository privacy audit passed (${files.length} files scanned).`);
