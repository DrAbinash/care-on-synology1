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

  /**
   * A canned template cannot know whether the patient has an older study, so none
   * of them may say the appearance is stable.
   *
   * Exactly one of the 61 did, and it was the least suspicious place to find it:
   * `MG Breast — BI-RADS 2 (Benign)` closed its findings with "Stable compared to
   * prior." and its impression with "Stable fibroadenomas" — while its OWN
   * technique line read "Comparison with prior mammogram dated ____", an unfilled
   * blank. The report therefore rested a comparison on a study it never
   * identified, and printed the blank that proves it. Stability is not a finding a
   * template can carry; it is a claim about a comparator the radiologist has to
   * name. The morphology sentences around it are the clinic's own wording and are
   * untouched — this rule removes a comparison, not a description.
   *
   * Scanned over all four prose sections of every format, so re-adding the sentence
   * anywhere in the library fails here with its name in the list.
   */
  it("asserts no comparison with a study it cannot identify", () => {
    const COMPARISON = /\b(stable compared|compared to prior|compared with prior|stable since|no significant interval change|no interval change|similar compared|unchanged)\b/i;
    const offenders = DEFAULT_REPORT_FORMATS
      .map((f) => {
        const body = [f.technique, f.findings, f.impression, f.recommendation]
          .filter(Boolean).join(" | ");
        const hits = body.match(new RegExp(COMPARISON.source, "gi")) || [];
        return hits.length ? `${f.name} -> ${JSON.stringify(hits)}` : null;
      })
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it("counts the formats that still print an unfilled blank, so the number cannot quietly grow", () => {
    // Not a pass/fail rule — a measurement the owner has to see. A blank is correct
    // in a template the radiologist fills before printing, and wrong when a sentence
    // depends on it (the case above). Reported, not silently rewritten.
    const withBlank = DEFAULT_REPORT_FORMATS.filter((f) =>
      [f.technique, f.findings, f.impression, f.recommendation]
        .filter(Boolean).some((t) => /_{2,}/.test(String(t))));
    expect(withBlank.length).toBeLessThanOrEqual(23);
    expect(withBlank.map((f) => f.name)).toContain("MG Breast — BI-RADS 5 (Highly suspicious)");
  });
});
