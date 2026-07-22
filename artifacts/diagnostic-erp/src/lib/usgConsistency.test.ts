import { describe, it, expect } from "vitest";
import { generateUsgFinding } from "./usgFindingBuilder";
import { findingDefById } from "./usgOrganLibrary";
import { addFinding, emptySection, composeImpression } from "./usgReportComposer";
import { checkReportConsistency, hasBlockingConsistencyWarnings } from "./usgConsistency";

const renalDef = findingDefById("renal_calculus")!;
const prostateDef = findingDefById("prostatomegaly")!;

function renalSection() {
  return addFinding(emptySection("right_kidney", "Right kidney"),
    generateUsgFinding(renalDef, { side: "Right", location: "Middle calyx", number: "Single", size: "5.5", shadowing: "Present", hydronephrosis: "None" }).object);
}

describe("P2.7 report/impression consistency", () => {
  it("clean report (impression matches findings) → no issues", () => {
    const s = renalSection();
    const issues = checkReportConsistency([s], composeImpression([s]));
    expect(issues).toEqual([]);
  });

  it("flags an abnormal finding missing from the Impression", () => {
    const s = renalSection();
    const issues = checkReportConsistency([s], []); // empty impression
    expect(issues.some((i) => i.code === "abnormal_not_in_impression" && i.organ === "Right kidney")).toBe(true);
  });

  it("flags a negation that contradicts an existing finding", () => {
    const s = { ...renalSection(), text: "A calculus is seen. No calculus in the left kidney." };
    const issues = checkReportConsistency([s], []);
    expect(issues.some((i) => i.code === "negation_conflict")).toBe(true);
    expect(hasBlockingConsistencyWarnings(issues)).toBe(true);
  });

  it("surfaces a finding-builder warning (prostate manual-volume mismatch)", () => {
    const s = addFinding(emptySection("prostate", "Prostate"),
      generateUsgFinding(prostateDef, { ap: "3.4", tr: "3.1", cc: "2.4", manual_volume: "35", override_reason: "cart", clinical_finding: "Prostatomegaly" }).object);
    const issues = checkReportConsistency([s], composeImpression([s]));
    expect(issues.some((i) => i.code === "finding_warning" && /differs materially/i.test(i.message))).toBe(true);
  });

  it("flags a laterality mismatch between finding and impression", () => {
    const s = renalSection(); // right-sided
    const issues = checkReportConsistency([s], ["Left nephrolithiasis without hydronephrosis."]);
    expect(issues.some((i) => i.code === "laterality_mismatch")).toBe(true);
  });

  it("advisory issues are not blocking", () => {
    const s = renalSection();
    const issues = checkReportConsistency([s], []); // only the advisory 'not in impression'
    expect(issues.every((i) => i.severity === "advisory")).toBe(true);
    expect(hasBlockingConsistencyWarnings(issues)).toBe(false);
  });
});
