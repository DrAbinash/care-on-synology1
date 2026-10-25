/**
 * @vitest-environment node
 *
 * Source contract: the compose timeout DEFAULT is 90 seconds — in the source AND
 * in the database the clinic actually runs.
 *
 * Owner approval (2026-10-23, deploy-gate recommendation doc): 45 s measured
 * a 3.1 % cold-start timeout rate (LS-1 rep 1, first request) and loses every
 * contended request (second concurrent dictation: 60.4 s; post-eviction
 * reload: 55.7 s) — 90 s covers the worst measured case with ~49 % margin.
 *
 * This file used to assert only the two 90s in runtimeConfig.ts, on the stated
 * premise that "Production runs on the DEFAULT (no clinic_settings override
 * exists)". That premise was false, and the test was green for the whole time it
 * was false. `ollama_composer_timeout_seconds` was created
 * `integer NOT NULL DEFAULT 45`, so the row always carries a materialised 45,
 * `row.ollamaComposerTimeoutSeconds ?? 90` never reaches its right-hand side, and
 * the clinic ran at 45 s. Grepping the source cannot see that: the value lives in
 * the database. The second assertion below reads migrations/ the way
 * docker/db-patch-entrypoint.sh applies it, so the gate now checks the deployed
 * fact rather than one spelling of it.
 *
 * The clamp stays 10–120: an explicit clinic_settings value
 * (ollamaComposerTimeoutSeconds) still wins over the default.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const source = readFileSync(join(__dirname, "runtimeConfig.ts"), "utf8");
const migrationsDir = resolve(__dirname, "../../../../../migrations");

/**
 * The default a freshly migrated database ends up with, derived by replaying every
 * statement in migrations/ that writes one for this column, in the alphabetical
 * order the deploy entrypoint uses. Returns null if nothing ever set it.
 */
function deployedTimeoutDefault(): string | null {
  let current: string | null = null;
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    // Strip `--` comments first: the rollback recipe quoted in a header names
    // SET DEFAULT 45 and must not be read as a statement the deploy will run.
    const sql = readFileSync(join(migrationsDir, file), "utf8").replace(/--.*$/gm, "");
    // Covers both the ADD COLUMN that created the column and a later SET DEFAULT.
    for (const m of sql.matchAll(/ollama_composer_timeout_seconds[\s\S]{0,80}?DEFAULT\s+(\d+)/gi)) {
      current = m[1];
    }
  }
  return current;
}

describe("compose timeout default (source contract)", () => {
  it("defaults to 90 seconds — the approved deploy-gate value", () => {
    // The initializer and the row fallback must BOTH say 90.
    const inits = source.match(/let timeoutSeconds = (\d+);/);
    expect(inits?.[1], "timeout initializer not found").toBe("90");
    const fallback = source.match(/row\.ollamaComposerTimeoutSeconds \?\? (\d+)/);
    expect(fallback?.[1], "row fallback not found").toBe("90");
  });

  it("the DEPLOYED column default is 90, not just the source fallback", () => {
    // The `?? 90` above is unreachable on a NOT NULL column, so the number the
    // clinic runs is whichever migration wrote the default last.
    expect(deployedTimeoutDefault(), "no migration sets this column's default").toBe("90");
  });

  it("keeps the 10–120 second clamp — explicit settings still win", () => {
    expect(source).toMatch(/Math\.max\(10, Math\.min\(120, Number\(row\.ollamaComposerTimeoutSeconds/);
  });
});
