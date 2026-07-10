// ─────────────────────────────────────────────────────────────────────────────
// validate-radiology-content-packs — K1 pre-commit validation CLI.
//
// Validates every radiology YAML content pack in a directory (default:
// seeds/radiology/content-packs/v1) and exits non-zero on any error, so it can
// gate commits / CI before packs are imported. Validation is a read-only lint
// (no DB, no writes), safe to run anytime; the IMPORT pipeline (K2/K3) is what
// is gated behind ff_radiology_catalog.
//
// The canonical packs live in another branch; until that directory exists this
// script reports "no packs found" and exits 0. It becomes effective the moment
// the packs are merged — no code change required.
//
// Usage:  pnpm --filter @workspace/scripts validate:radiology-content [dir]
//   or:   pnpm validate:radiology-content [dir]
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadPacksFromDir } from "../../artifacts/api-server/src/lib/radiologyCatalog/packs/loader";
import { validatePacks } from "../../artifacts/api-server/src/lib/radiologyCatalog/packs/validator";

const dir = resolve(process.argv[2] ?? "seeds/radiology/content-packs/v1");

if (!existsSync(dir)) {
  console.log(`ℹ  No content-pack directory at ${dir}.`);
  console.log("   Nothing to validate yet — this becomes active once the canonical YAML packs are merged.");
  process.exit(0);
}

const packs = loadPacksFromDir(dir);
if (packs.length === 0) {
  console.log(`ℹ  No *.yaml packs found in ${dir}.`);
  process.exit(0);
}

const result = validatePacks(packs);

console.log(`Validated ${packs.length} pack(s) in ${dir}`);
if (result.warnings.length) {
  console.log(`\n⚠  ${result.warnings.length} warning(s):`);
  for (const w of result.warnings) console.log(`   [${w.code}] ${w.pack ?? ""} ${w.path ?? ""} — ${w.message}`);
}

if (!result.ok) {
  console.error(`\n✗  ${result.errors.length} error(s) — NO PARTIAL SUCCESS, import blocked:`);
  for (const e of result.errors) console.error(`   [${e.code}] ${e.pack ?? ""} ${e.path ?? ""} — ${e.message}`);
  process.exit(1);
}

console.log("\n✓  All content packs valid.");
process.exit(0);
