/**
 * The X-ray auto-GREEN rule is the one place a patient's bill can be attached
 * without a person, so every leg of it is tested as a requirement, not a bonus.
 *
 * Owner ruling 7 Nov 2026: name + body area + referring doctor is strong enough
 * to link an X-ray film silently. Each case below removes exactly one of those
 * proofs and expects the row to fall back to YELLOW review.
 *
 * Pure function, no database, no clock — the same evidence must give the same
 * answer wherever it is asked (the linker and the intake re-score both call it).
 */
import { describe, expect, it } from "vitest";
import {
  XRAY_AUTO_GREEN_NAME_FLOOR,
  XRAY_AUTO_GREEN_REFERRER_FLOOR,
  qualifiesForXrayAutoGreen,
  type XrayAutoGreenEvidence,
} from "./xrayAutoGreen";

/** What calculateMatchScore actually pushes for a film that agrees on everything. */
const FULL: XrayAutoGreenEvidence = {
  modality: "CR",
  reasons: [
    "Patient name matches confidently (similarity: 100%)",
    "Referring doctor matches (100%)",
    "Modality matches (CR)",
    "Study description matches billing test name keywords",
    "Study date is within 24 hours of billing",
    "Gender matches",
    "Age matches within 5 years",
  ],
  // The accession warning is what every real film carries: the CS-7 sends none.
  warnings: ["Accession number differs or is missing on one record"],
  nameSimilarity: 1,
  referringDoctorSimilarity: 1,
};

const withReasons = (drop: string, over: Partial<XrayAutoGreenEvidence> = {}): XrayAutoGreenEvidence => ({
  ...FULL,
  reasons: FULL.reasons.filter((r) => !r.startsWith(drop)),
  ...over,
});

describe("qualifiesForXrayAutoGreen", () => {
  it("accepts the combination the owner asked for", () => {
    expect(qualifiesForXrayAutoGreen(FULL)).toBe(true);
  });

  it("refuses when the arriving study carries no body area", () => {
    // The leg the print-SCP OCR has to earn: an OCR transcript that names no
    // exam must not link silently just because two people share a name.
    expect(qualifiesForXrayAutoGreen(withReasons("Study description matches billing"))).toBe(false);
  });

  it("refuses when nobody referred the patient", () => {
    expect(qualifiesForXrayAutoGreen(withReasons("Referring doctor matches", {
      referringDoctorSimilarity: 0,
    }))).toBe(false);
  });

  it("refuses a referrer who merely fails to conflict", () => {
    // 64% is above the conflict threshold and below a match: the bill's doctor
    // and the film's doctor are different people and nothing proves otherwise.
    expect(
      qualifiesForXrayAutoGreen({
        ...FULL,
        referringDoctorSimilarity: 0.64,
        reasons: FULL.reasons.filter((r) => !r.startsWith("Referring doctor matches")),
      }),
    ).toBe(false);
  });

  it("refuses a name that is only Lane-B confident", () => {
    expect(
      qualifiesForXrayAutoGreen({
        ...FULL,
        nameSimilarity: XRAY_AUTO_GREEN_NAME_FLOOR - 0.01,
      }),
    ).toBe(false);
    // Floor sanity: the constant the rule reads is the one the test asserts.
    expect(
      qualifiesForXrayAutoGreen({ ...FULL, nameSimilarity: XRAY_AUTO_GREEN_NAME_FLOOR }),
    ).toBe(true);
    expect(
      qualifiesForXrayAutoGreen({ ...FULL, referringDoctorSimilarity: XRAY_AUTO_GREEN_REFERRER_FLOOR }),
    ).toBe(true);
  });

  it("refuses a film scanned on a different day", () => {
    expect(qualifiesForXrayAutoGreen(withReasons("Study date is within 24 hours"))).toBe(false);
  });

  it("refuses when the sex on the film disagrees with the bill", () => {
    expect(qualifiesForXrayAutoGreen(withReasons("Gender matches"))).toBe(false);
    expect(
      qualifiesForXrayAutoGreen({
        ...FULL,
        warnings: [...FULL.warnings, "Gender mismatch: DICOM shows M, billing shows F"],
      }),
    ).toBe(false);
  });

  it("stays out of ultrasound's way", () => {
    // Ultrasound keeps the YELLOW cap exactly as it behaved before this rule.
    expect(qualifiesForXrayAutoGreen({ ...FULL, modality: "US" })).toBe(false);
    expect(qualifiesForXrayAutoGreen({ ...FULL, modality: "MR" })).toBe(false);
    expect(qualifiesForXrayAutoGreen({ ...FULL, modality: "OT" })).toBe(false);
    expect(qualifiesForXrayAutoGreen({ ...FULL, modality: "DX" })).toBe(true);
  });

  it("leaves a keyed link to the accession lane", () => {
    // A row that matched on accession or UHID is proven by a work key. Promoting
    // it here would make two authorities answer one question.
    expect(
      qualifiesForXrayAutoGreen({
        ...FULL,
        reasons: [...FULL.reasons, "Accession number matches exactly"],
      }),
    ).toBe(false);
    expect(
      qualifiesForXrayAutoGreen({
        ...FULL,
        reasons: [...FULL.reasons, "Patient ID / UHID matches exactly"],
      }),
    ).toBe(false);
  });

  it("refuses a study reused across bills", () => {
    for (const warning of [
      "MODALITY_MISMATCH: Billed for CR but DICOM shows CT",
      "NAME_MISMATCH: Patient name differs completely",
      "DATE_MISMATCH: Study date differs from billing date by 6 days",
      "DUPLICATE_UID: Duplicate StudyInstanceUID across multiple worklist records",
      "BILL_LINKED_TO_MULTIPLE_STUDIES: Same bill linked to multiple unrelated DICOM studies",
    ]) {
      expect(qualifiesForXrayAutoGreen({ ...FULL, warnings: [...FULL.warnings, warning] })).toBe(false);
    }
  });

  it("does not let a missing accession veto the film it exists to link", () => {
    expect(qualifiesForXrayAutoGreen({ ...FULL, warnings: [] })).toBe(true);
  });

  it("refuses garbage similarity instead of treating it as a match", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(qualifiesForXrayAutoGreen({ ...FULL, nameSimilarity: bad })).toBe(false);
      expect(qualifiesForXrayAutoGreen({ ...FULL, referringDoctorSimilarity: bad })).toBe(false);
    }
  });

  // ── modes ─────────────────────────────────────────────────────────────────
  it("refuses the shape every real film arrives in, until the mode is widened", () => {
    // Measured on production for the 45 days to 7 Nov 2026: the X-ray console
    // sends a referring doctor on 0 of 144 films, and 2 of 30 print forwards.
    // This case is that population, so the trial's default is proven to be the
    // ruling as given rather than a rule that quietly ignores a leg.
    const noReferrer: XrayAutoGreenEvidence = {
      ...FULL,
      referringDoctorSimilarity: 0,
      reasons: FULL.reasons.filter((r) => !r.startsWith("Referring doctor matches")),
    };
    expect(qualifiesForXrayAutoGreen(noReferrer, "referrer")).toBe(false);
    expect(qualifiesForXrayAutoGreen(noReferrer, "name-area")).toBe(true);
  });

  it("widens the referrer leg only, never the rest of the proof", () => {
    const noReferrer = {
      ...FULL,
      referringDoctorSimilarity: 0,
      reasons: FULL.reasons.filter((r) => !r.startsWith("Referring doctor matches")),
    };
    // Every leg the modes share is still required in name-area mode.
    expect(
      qualifiesForXrayAutoGreen(
        { ...noReferrer, reasons: noReferrer.reasons.filter((r) => r !== "Gender matches") },
        "name-area",
      ),
    ).toBe(false);
    expect(
      qualifiesForXrayAutoGreen(
        {
          ...noReferrer,
          reasons: noReferrer.reasons.filter(
            (r) => r !== "Study description matches billing test name keywords",
          ),
        },
        "name-area",
      ),
    ).toBe(false);
    expect(qualifiesForXrayAutoGreen({ ...noReferrer, modality: "US" }, "name-area")).toBe(false);
  });

  it("keeps refusing a doctor who contradicts the bill, in both modes", () => {
    const conflict = {
      ...FULL,
      referringDoctorSimilarity: 0.2,
      reasons: FULL.reasons.filter((r) => !r.startsWith("Referring doctor matches")),
      warnings: [
        ...FULL.warnings,
        "Referring doctor name differs after cleaning titles/degrees (non-blocking)",
      ],
    };
    expect(qualifiesForXrayAutoGreen(conflict, "referrer")).toBe(false);
    expect(qualifiesForXrayAutoGreen(conflict, "name-area")).toBe(false);
  });

  it("switches the whole trial off", () => {
    expect(qualifiesForXrayAutoGreen(FULL, "off")).toBe(false);
    // The default is the ruling as given, not the widened mode.
    expect(qualifiesForXrayAutoGreen(FULL)).toBe(true);
  });
});
