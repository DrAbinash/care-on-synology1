#!/usr/bin/env node
/**
 * grounding-check.cjs — Documentation↔Code grounding preflight (Phase P0 / Gate G1)
 * ============================================================================
 * Care Diagnostics ERP · Hospital RIS/PACS
 *
 * WHY THIS EXISTS
 *   The v1 architecture blueprint drifted from the code: it asserted tables,
 *   columns and functions that did not exist, or misstated their names/types.
 *   An architecture document that disagrees with the schema is a defect, not a
 *   design. This script mechanically validates every load-bearing architecture
 *   claim against the actual source, and FAILS THE BUILD if any claim is false.
 *
 *   It is pure static analysis — no database, no dependencies, no side effects,
 *   safe to run anywhere. It is deliberately dependency-free (plain Node,
 *   `require` only) so it runs in CI, on deploy hosts, and locally without an
 *   install step — the same discipline as scripts/check-migration-order.cjs.
 *
 * THE CONTRACT
 *   Claims live in scripts/grounding.manifest.json. Each claim is one of:
 *     { "kind": "table",    "table": "<db_name>", "file": "<path>" }
 *     { "kind": "column",   "table": "<db_name>", "column": "<db_col>", "file": "<path>" }
 *     { "kind": "function", "name": "<fnName>", "file": "<path>" }
 *     { "kind": "contains", "file": "<path>", "text": "<substring>" }
 *     { "kind": "contains", "file": "<path>", "pattern": "<regex source>" }
 *   Every claim carries an optional "note" describing the architecture fact it
 *   pins. Add a claim here whenever a design doc starts to depend on a concrete
 *   table / column / function, and this check keeps the doc honest forever.
 *
 * USAGE
 *   node scripts/grounding-check.cjs            # human-readable report
 *   node scripts/grounding-check.cjs --json      # machine-readable
 *
 * EXIT CODE
 *   0  every claim holds
 *   1  at least one claim is contradicted by the code (build must fail)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(__dirname, "grounding.manifest.json");
const JSON_MODE = process.argv.includes("--json");

function readFileSafe(rel) {
  const abs = path.join(ROOT, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whitespace-tolerant matcher for `pgTable(\n  "<name>",` (the name may sit on
 *  the next line, as it does throughout the schema). Returns the match start
 *  index, or -1. */
function tableMarkerIndex(src, table) {
  const m = new RegExp(`pgTable\\(\\s*"${escapeRe(table)}"`).exec(src);
  return m ? m.index : -1;
}

/** Extract the drizzle pgTable(…"<name>"…) block for one table. Pragmatic:
 *  from the table marker to the start of the next pgTable( or EOF. Good enough
 *  to scope column checks to the right table in multi-table schema files. */
function tableBlock(src, table) {
  const i = tableMarkerIndex(src, table);
  if (i === -1) return null;
  const nextRe = /pgTable\(/g;
  nextRe.lastIndex = i + 8;
  const next = nextRe.exec(src);
  return src.slice(i, next ? next.index : src.length);
}

function checkClaim(claim) {
  const file = claim.file;
  const src = file ? readFileSafe(file) : null;
  if (file && src === null) {
    return { ok: false, detail: `file not found: ${file}` };
  }
  switch (claim.kind) {
    case "table": {
      const ok = tableMarkerIndex(src, claim.table) !== -1;
      return { ok, detail: ok ? `table ${claim.table}` : `no pgTable("${claim.table}") in ${file}` };
    }
    case "column": {
      const block = tableBlock(src, claim.table);
      if (!block) return { ok: false, detail: `table ${claim.table} not found in ${file}` };
      const ok = block.includes(`("${claim.column}")`);
      return { ok, detail: ok ? `${claim.table}.${claim.column}` : `column ${claim.column} not in table ${claim.table} (${file})` };
    }
    case "function": {
      const re = new RegExp(`\\bfunction\\s+${claim.name}\\b|\\b(const|let)\\s+${claim.name}\\s*=`);
      const ok = re.test(src);
      return { ok, detail: ok ? `function ${claim.name}` : `function ${claim.name} not defined in ${file}` };
    }
    case "contains": {
      if (typeof claim.pattern === "string") {
        const ok = new RegExp(claim.pattern).test(src);
        return { ok, detail: ok ? `matches /${claim.pattern}/` : `pattern /${claim.pattern}/ not found in ${file}` };
      }
      const ok = src.includes(claim.text);
      return { ok, detail: ok ? `contains "${claim.text}"` : `text "${claim.text}" not found in ${file}` };
    }
    default:
      return { ok: false, detail: `unknown claim kind: ${claim.kind}` };
  }
}

function main() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch (err) {
    console.error(`grounding-check: cannot read ${MANIFEST}: ${err.message}`);
    process.exit(1);
  }
  const claims = Array.isArray(manifest.claims) ? manifest.claims : [];
  const results = claims.map((c) => ({ claim: c, ...checkClaim(c) }));
  const failures = results.filter((r) => !r.ok);

  if (JSON_MODE) {
    console.log(JSON.stringify({
      total: results.length,
      passed: results.length - failures.length,
      failed: failures.length,
      failures: failures.map((f) => ({ claim: f.claim, detail: f.detail })),
    }, null, 2));
  } else {
    const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", RESET = "\x1b[0m";
    console.log(`grounding-check: ${results.length} architecture claims\n`);
    for (const r of results) {
      const tag = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      const note = r.claim.note ? ` ${DIM}— ${r.claim.note}${RESET}` : "";
      console.log(`  ${tag} ${r.detail}${note}`);
    }
    console.log("");
    if (failures.length === 0) {
      console.log(`${GREEN}✓ All ${results.length} architecture claims hold against the code.${RESET}`);
    } else {
      console.log(`${RED}✗ ${failures.length} of ${results.length} claims are contradicted by the code:${RESET}`);
      for (const f of failures) console.log(`    - ${f.detail}`);
      console.log(`\nEither fix the code, or update the architecture docs + scripts/grounding.manifest.json to match reality.`);
    }
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
