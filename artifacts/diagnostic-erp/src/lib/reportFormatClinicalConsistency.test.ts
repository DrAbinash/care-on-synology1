/**
 * Every report format the workstation ships is a correct report. Each one was
 * written by the clinic, reviewed, and put in the canned library so that a
 * radiologist could start from it — so a rule that marks one up is wrong about the
 * rule, not about the format.
 *
 * This is the census the synthetic golden corpus cannot run. All 20 of the corpus's
 * correct reports were already quiet on the shared Findings↔Impression contract, so
 * the contract went from "5 divergences removed" to "11 correct templates marked up"
 * with no corpus test moving. Measured over `DEFAULT_REPORT_FORMATS` before the fix:
 * 7 brain formats told they denied restricted diffusion and also described an acute
 * infarct (each of them says "No acute infarct" — the regex matched inside its own
 * denial), a BI-RADS 2 mammogram told it denied the masses it describes as benign, a
 * glioma follow-up told it denied the lesion it concludes on, and two spine formats
 * told a level had moved when one section counted vertebrae and the other counted
 * disc spaces.
 *
 * The count matters because the contract is now an input to the signing gate and not
 * only to the badge: see evaluateImpressionDependency in ./observationLedger.ts. A
 * template that arms the dependency is a template the radiologist has to refresh or
 * override on every single use of it, and a rule that cries wolf on the clinic's own
 * normal brain format is a rule whose badge gets clicked through — which is how the
 * one real level mismatch in a month gets signed.
 *
 * All prose here is the clinic's own canned wording. None of it is a patient.
 */
import { describe, expect, it } from "vitest";
import { findingsImpressionContradictions, lateralityContradictions } from "@workspace/report-quality";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";

describe("the shipped report formats", () => {
  it("contradict nothing in themselves, on the contract both authoring paths share", () => {
    const markedUp: string[] = [];
    let scanned = 0;
    for (const format of DEFAULT_REPORT_FORMATS) {
      const findings = format.findings ?? "";
      const impression = format.impression ?? "";
      // A format with an empty section says nothing about that section, so it is not
      // scanned — and the equality below is what stops "scan less" from becoming a
      // way to pass. Every shipped format has both, so the count is the library size.
      if (!findings.trim() || !impression.trim()) continue;
      scanned += 1;
      for (const c of [
        ...lateralityContradictions(findings, impression),
        ...findingsImpressionContradictions(findings, impression),
      ]) {
        markedUp.push(`${format.name} [${c.ruleId}] ${c.message}`);
      }
    }
    expect(scanned).toBe(DEFAULT_REPORT_FORMATS.length);
    expect(markedUp).toEqual([]);
  });
});
