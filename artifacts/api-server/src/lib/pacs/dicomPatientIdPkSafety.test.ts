/**
 * Clinical identity safety: DICOM PatientID must never score as a match
 * solely because it equals CARE's internal patients.id (serial PK).
 */
import { describe, expect, test } from "vitest";
import { calculateMatchScore } from "./matchingEngine";
import { classifyMatchLane } from "./nameReferralLink";
import { matchAllowsFinalize } from "../radiologyIdentity";

describe("DICOM PatientID must not match internal PK", () => {
  test("numeric PatientID equal to bill.patientId (PK) does not award ID points", () => {
    const result = calculateMatchScore(
      {
        patientName: "MODALITY OTHER PATIENT",
        dicomPatientId: "42",
        modality: "MR",
        accessionNumber: "",
        studyDescription: "MRI Brain",
      },
      {
        id: 1,
        patientId: 42,
        patientName: "Care Registered Patient",
        patientUHID: "CD-1001",
        modality: "MRI",
        accessionNumber: "ACC-OTHER",
        testName: "MRI Brain",
      },
    );
    expect(result.reasons.some((r) => r.includes("internal database ID"))).toBe(false);
    expect(result.reasons.some((r) => r.includes("Patient ID / UHID"))).toBe(false);
    // PK collision alone must not look like an identity-key match
    expect(classifyMatchLane(result)).toBe("name_referral");
    expect(result.score).not.toBe("GREEN");
    expect(matchAllowsFinalize({ matchScore: result.score, matchDecision: "PENDING" })).toBe(false);
  });

  test("legitimate UHID / patient-facing ID still scores +30", () => {
    const result = calculateMatchScore(
      {
        patientName: "Rita Sharma",
        dicomPatientId: "CD-1001",
        modality: "MR",
        accessionNumber: "",
      },
      {
        id: 2,
        patientId: 99,
        patientName: "Rita Sharma",
        patientUHID: "CD-1001",
        modality: "MRI",
        accessionNumber: "ACC-LEGIT",
        testName: "MRI Brain",
      },
    );
    expect(result.reasons.some((r) => r.includes("Patient ID / UHID matches exactly"))).toBe(true);
    expect(result.points).toBeGreaterThanOrEqual(30);
    expect(classifyMatchLane(result)).toBe("id_keys");
  });

  test("leading-zero PatientIDs are external strings, not coerced PKs", () => {
    // "0042" must not match UHID "42" after clean (zeros preserved) and must
    // not be treated as internal id 42.
    const vsPk = calculateMatchScore(
      {
        patientName: "X",
        dicomPatientId: "0042",
        modality: "CT",
        accessionNumber: "",
      },
      {
        id: 3,
        patientId: 42,
        patientName: "Y",
        patientUHID: "CD-OTHER",
        modality: "CT",
        accessionNumber: "A1",
        testName: "CT Head",
      },
    );
    expect(vsPk.reasons.some((r) => r.includes("Patient ID"))).toBe(false);

    const vsUhid42 = calculateMatchScore(
      {
        patientName: "X",
        dicomPatientId: "0042",
        modality: "CT",
        accessionNumber: "",
      },
      {
        id: 4,
        patientId: 7,
        patientName: "X",
        patientUHID: "42",
        modality: "CT",
        accessionNumber: "A2",
        testName: "CT Head",
      },
    );
    expect(vsUhid42.reasons.some((r) => r.includes("Patient ID / UHID"))).toBe(false);

    const exactPadded = calculateMatchScore(
      {
        patientName: "X",
        dicomPatientId: "000123",
        modality: "CT",
        accessionNumber: "",
      },
      {
        id: 5,
        patientId: 123,
        patientName: "X",
        patientUHID: "000123",
        modality: "CT",
        accessionNumber: "A3",
        testName: "CT Head",
      },
    );
    expect(exactPadded.reasons.some((r) => r.includes("Patient ID / UHID matches exactly"))).toBe(true);
  });

  test("name-only similarity does not become an id_keys lane or GREEN by itself", () => {
    const result = calculateMatchScore(
      {
        patientName: "Asha Same",
        dicomPatientId: "UNKNOWN-PID",
        modality: "MR",
        accessionNumber: "",
      },
      {
        id: 6,
        patientId: 50,
        patientName: "Asha Same",
        patientUHID: "CD-OTHER",
        modality: "MRI",
        accessionNumber: "ACC-NAME",
        testName: "Something Else Entirely",
      },
    );
    expect(result.reasons.some((r) => r.includes("Patient ID"))).toBe(false);
    expect(classifyMatchLane(result)).toBe("name_referral");
    expect(result.score).not.toBe("GREEN");
  });
});
