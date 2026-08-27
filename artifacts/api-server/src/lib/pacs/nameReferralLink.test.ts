import { describe, expect, it } from "vitest";
import type { BilledTestInput, DicomInput } from "./matchingEngine";
import {
  capNameReferralAutoScore,
  classifyMatchLane,
  normalizeStudyDateIso,
  pickNameReferralSuggestions,
  rankBillCandidate,
  selectUniqueNameReferralAutoLink,
  studyDateSearchWindow,
} from "./nameReferralLink";

function dicom(over: Partial<DicomInput> = {}): DicomInput {
  return {
    patientName: "Pihu Kumari",
    dicomPatientId: "E42561-26-08-27-129",
    age: null,
    sex: "O",
    modality: "US",
    studyDescription: null,
    accessionNumber: "",
    studyDate: "20260827",
    referringDoctor: "Dr Sanjay",
    ...over,
  };
}

function bill(over: Partial<BilledTestInput> & { id: number }): BilledTestInput {
  return {
    patientId: 10,
    patientName: "Pihu Kumari",
    patientUHID: "UHID-999",
    age: "25 Y",
    sex: "F",
    testName: "USG Whole Abdomen",
    modality: "USG",
    accessionNumber: "ACC-20260827-US-01",
    billNumber: "B-1",
    studyDate: "2026-08-27",
    referringDoctor: "Dr. Sanjay Kumar",
    ...over,
  };
}

describe("nameReferralLink", () => {
  it("normalizes DICOM and ERP study dates into a search window", () => {
    expect(normalizeStudyDateIso("20260827")).toBe("2026-08-27");
    expect(normalizeStudyDateIso("2026-08-27")).toBe("2026-08-27");
    expect(studyDateSearchWindow("20260827", 1)).toEqual({
      from: "2026-08-26",
      to: "2026-08-28",
    });
  });

  it("classifies id-key matches separately from name±referral", () => {
    const withAcc = rankBillCandidate(
      dicom({ accessionNumber: "ACC-20260827-US-01", dicomPatientId: null }),
      bill({ id: 1 }),
    );
    expect(classifyMatchLane({
      score: withAcc.score,
      points: withAcc.points,
      reasons: withAcc.reasons,
      warnings: withAcc.warnings,
    })).toBe("id_keys");

    const nameOnly = rankBillCandidate(dicom(), bill({ id: 2 }));
    expect(nameOnly.lane).toBe("name_referral");
    expect(nameOnly.suggestable).toBe(true);
    expect(nameOnly.nameSimilarity).toBeGreaterThanOrEqual(0.85);
  });

  it("suggests unique name+doctor match and auto-links when alone", () => {
    const ranked = [
      rankBillCandidate(dicom(), bill({ id: 11 })),
      rankBillCandidate(dicom(), bill({ id: 12, patientName: "Rina Devi", referringDoctor: "Dr Other" })),
    ];
    const suggestions = pickNameReferralSuggestions(ranked, 5);
    expect(suggestions.map((s) => s.studyId)).toEqual([11]);

    const auto = selectUniqueNameReferralAutoLink(ranked);
    expect(auto?.studyId).toBe(11);
    expect(capNameReferralAutoScore(auto!.score === "GREEN" ? "GREEN" : auto!.score)).toBe("YELLOW");
  });

  it("does not auto-link ambiguous same-name pile — suggestions still show", () => {
    const ranked = [
      rankBillCandidate(dicom({ referringDoctor: null }), bill({ id: 1, referringDoctor: null })),
      rankBillCandidate(
        dicom({ referringDoctor: null }),
        bill({ id: 2, patientName: "Pihu Kumari", referringDoctor: null, accessionNumber: "ACC-20260827-US-02" }),
      ),
    ];
    expect(selectUniqueNameReferralAutoLink(ranked)).toBeNull();
    expect(pickNameReferralSuggestions(ranked).length).toBe(2);
  });

  it("blocks auto-link on referring-doctor conflict but may still suggest on strong name", () => {
    const ranked = [
      rankBillCandidate(
        dicom({ referringDoctor: "Dr Sanjay" }),
        bill({ id: 3, referringDoctor: "Dr Completely Different" }),
      ),
    ];
    expect(ranked[0]!.autoLinkEligible).toBe(false);
    expect(ranked[0]!.suggestable).toBe(true);
    expect(selectUniqueNameReferralAutoLink(ranked)).toBeNull();
  });

  it("rejects modality mismatch for suggestions and auto-link", () => {
    const ranked = [
      rankBillCandidate(dicom({ modality: "CT" }), bill({ id: 4, modality: "USG" })),
    ];
    expect(ranked[0]!.suggestable).toBe(false);
    expect(ranked[0]!.autoLinkEligible).toBe(false);
  });
});
