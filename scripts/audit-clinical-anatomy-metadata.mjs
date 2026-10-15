#!/usr/bin/env node
/**
 * Audit CARE's clinical anatomy metadata without touching a report or a database.
 *
 *   pnpm audit:anatomy                 # run the guards, print the audit
 *   pnpm audit:anatomy --baseline      # also rewrite the committed coverage snapshot
 *
 * The next clinical milestone (ordering Findings by anatomy) can only be built on
 * metadata that is known to be complete, and C2 established that it is not. This
 * script measures what the catalogues actually carry — concepts, anatomical
 * sections, conflict groups, baseline ownership — and writes the result to
 * tmp/clinical-metadata-audit/ (gitignored): `audit.md` to read, `coverage.json`
 * to diff. Nothing connects to a database, nothing is stored in the clinic, and
 * no report text is produced or changed.
 *
 * Vitest is the runtime because the catalogue modules live behind the ERP's `@/`
 * path aliases; the same approach as preview-reports.mjs. The regression suite
 * runs first, so a printed report is always a report from an audit whose own
 * guards were just proved to fire.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Forward slashes on purpose: vitest matches the CLI filter against POSIX module
// ids, so a backslashed path finds no test file and exits 1 on Windows.
const SUITE = "artifacts/diagnostic-erp/src/lib/clinicalMetadata";
const outDir = path.join(root, "tmp", "clinical-metadata-audit");

const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitestCli)) {
  console.error(`Vitest is not installed at ${vitestCli}. Run \`pnpm install\` first.`);
  process.exit(1);
}

const writeBaseline = process.argv.includes("--baseline");

let revision = "(revision unknown)";
try {
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  if (git.status === 0) revision = git.stdout.trim();
} catch {
  // A missing git only affects the label on the snapshot, never a count.
}

// No `--root`: vitest takes the working directory, and a Windows backslashed
// root passed on the command line does not match the POSIX module ids it filters.
const args = ["run", SUITE];

const run = spawnSync(process.execPath, [vitestCli, ...args], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    TZ: "UTC",
    C3_AUDIT_REPORT: "1",
    C3_SOURCE_REVISION: revision,
    ...(writeBaseline ? { C3_WRITE_BASELINE: "1" } : {}),
  },
});
if (run.status !== 0) {
  console.error("\nThe metadata audit did not pass its own guards, so nothing here should be trusted.");
  console.error("Read the failure above before using anything in tmp/clinical-metadata-audit/.");
  process.exit(run.status ?? 1);
}

console.log(`\nSource revision: ${revision}`);
console.log(`Report:   ${path.join(outDir, "audit.md")}`);
console.log(`Snapshot: ${path.join(outDir, "coverage.json")}`);
if (writeBaseline) {
  console.log("The committed baseline at artifacts/diagnostic-erp/src/lib/clinicalMetadata/coverage-baseline.json was rewritten.");
  console.log("Read the diff before committing it: a baseline is what future CI calls a regression.");
} else {
  console.log("Commit the baseline explicitly with `pnpm audit:anatomy --baseline` when a coverage change is intended.");
}
