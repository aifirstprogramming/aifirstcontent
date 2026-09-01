#!/usr/bin/env bun
/** Sanitize committed replay evidence and remove raw legacy reports. */

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseShowtailReport } from "./lib/showtail";
import { sanitizeShowtailReport } from "./lib/sanitize-showtail";
import { sha256, stableJson } from "./lib/retrofit-showtail";

const ROOT = join(import.meta.dir, "..");
const write = process.argv.includes("--write");
const manifestPaths = [
  join(ROOT, "replays", "python", "chapter-09", "retrofit-manifest.json"),
  join(ROOT, "replays", "python", "chapter-10", "retrofit-manifest.json"),
];

function sourcePaths(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else out.push(relative(root, path).replace(/\\/g, "/"));
    }
  };
  visit(root);
  return out.sort();
}

function removePathFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removePathFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "path" && key !== "transcript")
      .map(([key, item]) => [key, removePathFields(item)]),
  );
}

const results: Array<{ path: string; changed: boolean; removedLegacy: boolean }> = [];
for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exercises: Array<{
      id: string;
      bundle: string;
      legacyReport?: string;
      legacyReportSha256: string;
    }>;
  };
  let manifestChanged = false;
  for (const exercise of manifest.exercises) {
    const exerciseRoot = resolve(dirname(manifestPath), exercise.bundle);
    const reportPath = join(exerciseRoot, "bundle", "report.json");
    const sourceRoot = join(exerciseRoot, "bundle", "source");
    const auditPath = join(exerciseRoot, "retrofit.json");
    const parsed = parseShowtailReport(JSON.parse(readFileSync(reportPath, "utf8")));
    const reportText = stableJson(sanitizeShowtailReport(parsed, sourcePaths(sourceRoot)));
    const rawAudit = JSON.parse(readFileSync(auditPath, "utf8"));
    const audit = removePathFields(rawAudit) as Record<string, unknown>;
    const outputs = audit.outputs as Record<string, unknown>;
    outputs.reportSha256 = sha256(reportText);
    audit.privacy = {
      originalArtifactsCommitted: false,
      identitiesRemoved: true,
      workspacePathsNormalized: true,
    };
    const auditText = stableJson(audit);
    const legacyPath = join(exerciseRoot, "legacy", "report-v1.json");
    const changed =
      readFileSync(reportPath, "utf8") !== reportText ||
      readFileSync(auditPath, "utf8") !== auditText;
    const removedLegacy = existsSync(legacyPath);
    if (write && (changed || removedLegacy)) {
      const staging = `${exerciseRoot}.sanitize-${process.pid}`;
      const backup = `${exerciseRoot}.unsanitized-${process.pid}`;
      rmSync(staging, { recursive: true, force: true });
      rmSync(backup, { recursive: true, force: true });
      cpSync(exerciseRoot, staging, { recursive: true });
      writeFileSync(join(staging, "bundle", "report.json"), reportText);
      writeFileSync(join(staging, "retrofit.json"), auditText);
      rmSync(join(staging, "legacy"), { recursive: true, force: true });
      renameSync(exerciseRoot, backup);
      renameSync(staging, exerciseRoot);
      rmSync(backup, { recursive: true, force: true });
    }
    results.push({ path: relative(ROOT, exerciseRoot), changed, removedLegacy });
    if (exercise.legacyReport !== undefined) {
      delete exercise.legacyReport;
      manifestChanged = true;
    }
  }
  if (write && manifestChanged) writeFileSync(manifestPath, stableJson(manifest));
  if (!write && manifestChanged)
    results.push({ path: relative(ROOT, manifestPath), changed: true, removedLegacy: false });
}

for (const result of results)
  console.log(`${result.changed || result.removedLegacy ? write ? "WROTE" : "CHANGE" : "OK"} ${result.path}`);
