/**
 * @vitest-environment node
 *
 * Source contract: the LLM compose path normalizes plan sections against the
 * region's canonical vocabulary, and the prompt teaches that vocabulary.
 *
 * The unit contracts in regionSections.test.ts pin the pure functions; this
 * pin guards the WIRING. If a refactor drops the normalizePlanSections call
 * from composer.ts (or the "Region sections" line from contextBuilder.ts),
 * every unit test can stay green while the live model keeps inventing section
 * names — the exact production failure documented in
 * migrations/z_fix_radiology_smart_findings_sections.sql.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const composerSource = readFileSync(join(__dirname, "composer.ts"), "utf8");
const contextBuilderSource = readFileSync(join(__dirname, "contextBuilder.ts"), "utf8");

describe("region section vocabulary (source contract)", () => {
  it("composer.ts normalizes every parsed LLM plan against the region's sections", () => {
    // First-pass and repaired plans alike funnel through the same `plan`.
    expect(composerSource).toMatch(/normalizePlanSections\(\s*plan,\s*region/);
  });

  it("the custom phrases' own sections join the allowed vocabulary", () => {
    // Authored phrases carry their own anatomicalSection; normalization must
    // not strip what the radiologist taught the system.
    expect(composerSource).toMatch(/customSectionKeys/);
  });

  it("contextBuilder.ts states the region's sections in the compose prompt", () => {
    expect(contextBuilderSource).toContain("Region sections");
    expect(contextBuilderSource).toMatch(/sectionKeysForPrompt/);
  });
});
