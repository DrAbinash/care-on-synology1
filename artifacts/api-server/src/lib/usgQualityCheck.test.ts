/**
 * Unresolved `___` blanks against the USG finalize gate.
 *
 * The USG skeletons in `lib/usgReportTemplates.ts` deliberately ship unfilled
 * blanks — `Cortex: ___ mm`, `Follicles: ___`, and the AI's
 * `[___ low confidence – verify]` marker — and `runQualityCheck` is the ONE thing
 * standing between one of those and a finalized, printed, patient-facing report
 * (`routes/usgReports.ts` refuses finalize on `!qcResult.passed`).
 *
 * It was not doing that job. The scan looked only inside the FINDINGS block
 * (`lower.match(/findings[:\s]+(.*?)(?=impression|$)/s)`), so a blank in the
 * impression, or above the findings label, was never counted at all; and even a
 * counted blank was only an error above three — one or two reported as a warning,
 * and a warning still returns `passed: true`. That threshold also made the answer
 * depend on line breaks: the same three blanks written on one line passed while
 * spread over four lines blocked.
 *
 * A report whose own text says "measure it here" and reaches the patient with the
 * underscores still on it is the defect; the fix is that no unresolved blank can be
 * finalized, wherever it sits. `POST /:id/finalize-force` remains the audited
 * super-admin override for a blank the radiologist stands behind.
 *
 * (This module had no test file before this one — the rule was never pinned.)
 */
import { describe, expect, it } from "vitest";
import { runQualityCheck, type QualityCheckInput } from "./usgQualityCheck";

function check(draftContent: string, over: Partial<QualityCheckInput> = {}) {
  return runQualityCheck({
    draftContent,
    templateType: "KUB",
    patientName: "Vitest Patient",
    patientAge: "41 Y",
    patientSex: "female",
    referringDoctor: "Dr Vitref",
    ...over,
  });
}

/** The placeholder rule, whichever list it landed in. A rule that reports in
 *  `warnings` has by construction not refused anything, so every case below reads
 *  both lists — checking only `errors` would let the old warning-only behaviour pass
 *  a test named "blocks finalization". */
const placeholderNotes = (r: { errors: string[]; warnings: string[] }) =>
  [...r.errors, ...r.warnings].filter((m) => /blank|placeholder/i.test(m));

describe("runQualityCheck — unresolved blanks", () => {
  it("finalizes a completed report", () => {
    // The control. Without it every assertion below could be satisfied by a check
    // that simply refuses everything.
    const r = check(
      "FINDINGS:\nBoth kidneys are normal in size and echotexture. Cortex 9 mm. No calculi.\nIMPRESSION:\nNormal renal ultrasound."
    );
    expect(r.errors).toEqual([]);
    expect(r.passed, JSON.stringify(r)).toBe(true);
    expect(placeholderNotes(r)).toEqual([]);
  });

  it("refuses a report with one unfilled blank in the findings", () => {
    const r = check(
      "FINDINGS:\nRight kidney 92 mm, cortex ___ mm. Left kidney normal.\nIMPRESSION:\nReduced right cortical thickness."
    );
    expect(r.passed, JSON.stringify(r)).toBe(false);
    expect(r.errors.filter((m) => /unfilled blank/i.test(m))).toHaveLength(1);
    expect(r.warnings.filter((m) => /unfilled blank/i.test(m)), "a warning cannot refuse anything").toEqual([]);
  });

  it("counts every blank, not every line", () => {
    // Three blanks, one line: the old rule saw one line, the old threshold needed
    // four of them, and this report finalized.
    const r = check(
      "FINDINGS:\nSpleen 11 cm. Kidneys: right ___ mm, left ___ mm, cortex ___ mm. No calculi.\nIMPRESSION:\nNormal abdominal ultrasound."
    );
    expect(placeholderNotes(r).join(" |")).toMatch(/3 unfilled blank/);
    expect(r.passed, JSON.stringify(r)).toBe(false);
  });

  it("sees a blank in the impression, which the findings-block scan never read", () => {
    const r = check(
      "FINDINGS:\nBoth kidneys are normal in size and echotexture.\nIMPRESSION:\nSolitary kidney, measurement ___ mm to be confirmed."
    );
    expect(r.passed, JSON.stringify(r)).toBe(false);
    expect(r.errors.filter((m) => /unfilled blank/i.test(m))).toHaveLength(1);
  });

  it("sees a blank above the findings label, which no block scan read either", () => {
    // The template's own header line (`UTERUS: ___ weeks size.` style): the region
    // the old regex matched starts AFTER the word FINDINGS, so this blank was
    // invisible however many times it appeared.
    const r = check(
      "UTERUS: ___ weeks size.\nFINDINGS:\nMyometrium is normal in echotexture.\nIMPRESSION:\nNormal pelvic ultrasound."
    );
    expect(r.passed, JSON.stringify(r)).toBe(false);
    expect(r.errors.filter((m) => /unfilled blank/i.test(m))).toHaveLength(1);
  });

  it("names the line that has to be filled", () => {
    // A refusal that only reports a count sends the sonographer hunting through a
    // long template for the blank the AI left behind.
    const r = check(
      "FINDINGS:\nRight kidney 92 mm, cortex ___ mm. Left kidney normal.\nIMPRESSION:\nReduced right cortical thickness."
    );
    expect(r.errors.join(" |")).toContain("Right kidney 92 mm, cortex ___ mm.");
  });

  it("still refuses nothing else differently: a missing impression is its own error", () => {
    // Guards the fold — the placeholder rule must not swallow the other checks.
    const r = check("FINDINGS:\nBoth kidneys are normal in size and echotexture.");
    expect(r.errors.filter((m) => /IMPRESSION/i.test(m)).length).toBeGreaterThan(0);
    expect(placeholderNotes(r), "no blank here").toEqual([]);
  });
});
