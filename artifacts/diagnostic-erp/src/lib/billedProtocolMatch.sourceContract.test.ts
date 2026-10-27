/**
 * Source contracts — the billed/protocol row actually drives the Technique
 * auto-pick. The unit contracts in billedProtocolMatch.test.ts pin the matcher
 * itself; these pins guard the WIRING, so the once-per-study auto-protocol
 * pass can never silently regress to region-default-only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const STUDY_SETUP = "hooks/useReportingStudySetup.ts";
const PICKER = "lib/pickQuickProtocol.ts";
const STUDY_REGION = "lib/studyRegion.ts";

describe("auto-Technique from the protocol/billing row — wiring", () => {
  it("1. the setup hook composes billed-name match BEFORE the region default", () => {
    const src = read(STUDY_SETUP);
    expect(src).toContain("pickQuickProtocolForBilledName");
    // The once-per-study auto-protocol pass: billed match first, default second.
    const effect = src.slice(
      src.indexOf("// Auto protocol once per study"),
      src.indexOf("// Region override: switch Technique dropdown"),
    );
    expect(effect).toContain("pickQuickProtocolForBilledName");
    expect(effect.indexOf("pickQuickProtocolForBilledName")).toBeLessThan(
      effect.indexOf("pickQuickProtocol("),
    );
    // ...and the fallback to the region default stays.
    expect(effect).toContain("?? pickQuickProtocol");
  });

  it("2. the billed name must reach the picker (billedProcedureName, not just region)", () => {
    const src = read(STUDY_SETUP);
    const effect = src.slice(
      src.indexOf("// Auto protocol once per study"),
      src.indexOf("// Region override: switch Technique dropdown"),
    );
    expect(effect).toContain("billedProcedureName");
  });

  it("3. region switches and the mismatch banner load respect the billed row too", () => {
    const src = read(STUDY_SETUP);
    const fn = src.slice(
      src.indexOf("const applyDefaultTechniqueForRegion"),
      src.indexOf("const syncTechniqueOnRegionChange"),
    );
    expect(fn).toContain("pickQuickProtocolForBilledName");
    expect(fn).toContain("?? pickQuickProtocol");
  });

  it("4. one tokenizer + one synonym list — the picker imports studyRegion's, never re-declares", () => {
    const picker = read(PICKER);
    expect(picker).toContain('from "./studyRegion"');
    expect(picker).toContain("studyRegionTokens");
    expect(picker).toContain("coreTokenInHint");
    // The abbreviation-rejoin + anatomy-synonym rule must not be duplicated.
    expect(picker).not.toContain("ANATOMY_HINT_SYNONYMS");
    const region = read(STUDY_REGION);
    expect(region).toContain("export function studyRegionTokens");
    expect(region).toContain("function coreTokenInHint");
  });
});
