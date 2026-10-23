/**
 * @vitest-environment node
 *
 * Source contract: contradiction warnings must actually WIRE through.
 *
 * contradictionCheck.test.ts pins the pure checker and
 * composer.contradiction.test.ts pins the observable behavior; this pin
 * guards the WIRING a green unit suite can silently lose:
 *
 *   1. composer.ts runs checkContradictions on BOTH success paths — the LLM
 *      return AND the phrase-catalog fallback return. A refactor that wires
 *      only one lane lets the other lane ship contradictions silently.
 *   2. The route carries `warnings` on the success response — the client
 *      treats absence as clean, so a dropped field means dropped warnings.
 *   3. The checker reuses the validator's pathology vocabulary and the
 *      composer's concept stem, so the three lists can never drift apart.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = __dirname;
const composerSource = readFileSync(join(here, "composer.ts"), "utf8");
const routeSource = readFileSync(join(here, "..", "..", "routes", "voiceReportComposer.ts"), "utf8");
const checkerSource = readFileSync(join(here, "contradictionCheck.ts"), "utf8");
const validatorSource = readFileSync(join(here, "validator.ts"), "utf8");

describe("contradiction-check wiring (source contract)", () => {
  it("composer.ts checks contradictions on BOTH success paths", () => {
    const calls = composerSource.match(/checkContradictions\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // Warnings attach only when non-empty — the client treats absence as clean.
    expect(composerSource).toMatch(/warnings\.length\s*\?\s*\{\s*warnings\s*\}/);
  });

  it("the route response carries the warnings next to the plan", () => {
    // The ok:true response shape: plan + diagnostics + provenance + warnings.
    expect(routeSource).toMatch(/warnings:\s*result\.warnings/);
  });

  it("the checker reuses the validator's pathology vocabulary — one list, never two", () => {
    expect(validatorSource).toMatch(/export const PATHOLOGY_TERMS/);
    expect(checkerSource).toMatch(/PATHOLOGY_TERMS/);
  });

  it("the checker reuses the composer's concept stem — one stem, never two", () => {
    expect(composerSource).toMatch(/export function conceptStem/);
    expect(checkerSource).toMatch(/conceptStem/);
  });
});
