import { describe, expect, test } from "vitest";
import {
  formatMwlPersonName,
  mwlStudyInstanceUid,
  mwlSeriesInstanceUid,
  mwlSopInstanceUid,
} from "./mwlWorklistWriter";

describe("MWL UIDs (Orthanc housekeeper requires non-empty Study/Series/SOP UIDs)", () => {
  test("generates stable numeric UIDs from accession", () => {
    const a = mwlStudyInstanceUid("ACC-2026-001");
    const b = mwlStudyInstanceUid("ACC-2026-001");
    expect(a).toBe(b);
    expect(a).toMatch(/^1\.2\.840\.9999\.care\.mwl\.study\.\d+$/);
    expect(mwlSeriesInstanceUid("ACC-2026-001")).toMatch(/^1\.2\.840\.9999\.care\.mwl\.series\.\d+$/);
    expect(mwlSopInstanceUid("ACC-2026-001")).toMatch(/^1\.2\.840\.9999\.care\.mwl\.sop\.\d+$/);
  });

  test("different accessions produce different study UIDs", () => {
    expect(mwlStudyInstanceUid("A1")).not.toBe(mwlStudyInstanceUid("A2"));
  });
});

describe("formatMwlPersonName (ERP → modality PN)", () => {
  test("converts Given Family to Family^Given", () => {
    expect(formatMwlPersonName("Abinash Singh")).toBe("Singh^Abinash");
    expect(formatMwlPersonName("Rita Kumar Sharma")).toBe("Sharma^Rita Kumar");
  });

  test("leaves existing caret PN alone", () => {
    expect(formatMwlPersonName("SINGH^ABINASH^^^MD")).toBe("SINGH^ABINASH^^^MD");
  });

  test("anonymous fallback", () => {
    expect(formatMwlPersonName("")).toBe("ANONYMOUS");
    expect(formatMwlPersonName(null)).toBe("ANONYMOUS");
  });
});
