#!/usr/bin/env node
/**
 * Preview reports without deploying anything.
 *
 *   pnpm preview:reports
 *
 * A NAS deploy takes the clinic down and takes a long time, so report wording and
 * layout have to be judged somewhere else first. This runs the repo's own report
 * renderers — the Quick Select patch engine, the print body builder, the
 * presentation template and the PDF generator — over synthetic patients, and writes
 * the result to tmp/report-preview/ (gitignored). Nothing connects to a database,
 * nothing is stored, and the clinic is untouched.
 *
 * The cases come from reportPreviewHarness.test.ts, which fails if a case renders
 * wrong, so the pack you are looking at is the pack the tests vouch for.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Forward slashes on purpose: vitest matches the CLI filter against POSIX module
// ids, so a backslashed path finds no test file and exits 1 on Windows.
const harness = "artifacts/diagnostic-erp/src/lib/reportPreviewHarness.test.ts";
const outDir = path.join(root, "tmp", "report-preview");
const index = path.join(outDir, "index.html");

// Vitest is driven through node directly. On Windows `npx` and `vitest.CMD` need a
// shell (Node refuses to spawn .cmd without one), and a shell mangles the paths this
// script prints — so run the installed CLI file and stay on one code path everywhere.
const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitestCli)) {
  console.error(`Vitest is not installed at ${vitestCli}. Run \`pnpm install\` first.`);
  process.exit(1);
}

const run = spawnSync(process.execPath, [vitestCli, "run", harness], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TZ: "UTC" },
});
if (run.status !== 0) {
  console.error("\nThe preview harness did not pass (or did not run), so nothing was opened.");
  console.error("Read the failure above before trusting any file in tmp/report-preview/.");
  process.exit(run.status ?? 1);
}

if (!existsSync(index)) {
  console.error(`\nThe harness passed but ${index} is missing.`);
  process.exit(1);
}

const audit = JSON.parse(readFileSync(path.join(outDir, "audit.json"), "utf8"));

console.log("\nReports rendered — no server, no database, no deploy, nothing stored.\n");
for (const row of audit) {
  console.log(`  ${row.title}`);
  console.log(`    ${row.note}`);
  const bold = (row.printedBoldFindings ?? []).length;
  const advice = String(row.recommendationText ?? "").trim().split(/\n+/).filter(Boolean).length;
  console.log(
    `    ${row.headingLabels.length} sub-heading(s), ${row.printedTables} table(s)`
      + `, ${bold} findings line(s) bold on paper, ${advice} advice line(s)`,
  );
}
console.log(`\nOpen this file to read them side by side:\n  ${index}\n`);

// A path in a terminal is not something everyone can click, so ask the desktop.
const opener = process.platform === "win32"
  ? { cmd: "cmd", args: ["/c", "start", "", index] }
  : process.platform === "darwin"
    ? { cmd: "open", args: [index] }
    : { cmd: "xdg-open", args: [index] };
const opened = spawnSync(opener.cmd, opener.args, { stdio: "ignore" });
if (opened.status !== 0) console.log("If no browser appeared, open that file from Explorer/Finder instead.\n");
