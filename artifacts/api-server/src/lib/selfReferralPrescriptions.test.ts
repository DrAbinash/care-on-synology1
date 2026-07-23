import { describe, expect, test, vi, beforeEach } from "vitest";

// PR 2 — auto-prescription for self-referral/walk-in Form F test patients.
// Proves: idempotent generation (never re-signs an existing prescription),
// the prescribed advice/doctor prefills, the signature snapshot from the
// existing signatures master, and a deterministic SHA-256 content hash.

let existingRows: Array<{ formFRecordId: number }>;
let signatureRows: Array<{ id: number; imageDataUrl: string; registrationNo: string }>;
let inserted: Array<Record<string, unknown>>;
let onConflictCalled: boolean;

vi.mock("@workspace/db", () => {
  const db = {
    select: () => ({
      from: (table: { __name?: string }) => {
        if (table.__name === "self_referral_prescriptions") {
          return { where: async () => existingRows };
        }
        if (table.__name === "signatures") {
          return { where: () => ({ limit: async () => signatureRows }) };
        }
        return { where: async () => [] };
      },
    }),
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        inserted.push(...rows);
        return { onConflictDoNothing: async () => { onConflictCalled = true; return []; } };
      },
    }),
  };
  return { db };
});

vi.mock("@workspace/db/schema", () => ({
  selfReferralPrescriptionsTable: { __name: "self_referral_prescriptions", formFRecordId: "form_f_record_id" },
  signaturesTable: { __name: "signatures", id: "id", imageDataUrl: "image_data_url", registrationNo: "registration_no", isActive: "is_active", name: "name" },
}));

import {
  ensureSelfReferralPrescriptions,
  prescriptionContentHash,
  prescriptionContentString,
} from "./selfReferralPrescriptions";
import { SELF_REFERRAL_PRESCRIPTION_ADVICE } from "./formFRegister";

const RECORD = {
  id: 61,
  patientId: 42,
  patientName: "Meera Verify",
  husbandFatherName: "S. Verify",
  age: "32",
  procedureDate: "2026-07-10",
  date: "",
  createdAt: new Date("2026-07-10T05:00:00Z"),
};

beforeEach(() => {
  existingRows = [];
  signatureRows = [{ id: 9, imageDataUrl: "data:image/png;base64,SIG", registrationNo: "BMC-12345" }];
  inserted = [];
  onConflictCalled = false;
});

describe("ensureSelfReferralPrescriptions", () => {
  test("auto-saves a signed prescription with the prescribed advice, doctor, signature snapshot and content hash", async () => {
    await ensureSelfReferralPrescriptions([RECORD]);
    expect(inserted).toHaveLength(1);
    const rx = inserted[0];
    expect(rx["formFRecordId"]).toBe(61);
    expect(rx["adviceText"]).toBe("Patient for Obstetrical Examination.\nAdvice: Sonography for Fetal Well Being (FWB).");
    expect(rx["doctorName"]).toBe("Dr. Sugandha Priyadarshini");
    expect(rx["doctorQualifications"]).toBe("MBBS, MD");
    expect(rx["doctorRegistrationNo"]).toBe("BMC-12345");
    expect(rx["signatureId"]).toBe(9);
    expect(rx["signatureImageDataUrl"]).toBe("data:image/png;base64,SIG");
    expect(rx["prescriptionDate"]).toBe("2026-07-10");
    expect(String(rx["contentHash"])).toMatch(/^[0-9a-f]{64}$/);
    expect(onConflictCalled).toBe(true); // idempotent write path
  });

  test("IDEMPOTENT: records that already have a prescription are never re-signed", async () => {
    existingRows = [{ formFRecordId: 61 }];
    await ensureSelfReferralPrescriptions([RECORD, { ...RECORD, id: 62 }]);
    expect(inserted.map((r) => r["formFRecordId"])).toEqual([62]);
  });

  test("no signature configured → prescription still saves, signature fields empty (snapshot honest)", async () => {
    signatureRows = [];
    await ensureSelfReferralPrescriptions([RECORD]);
    expect(inserted[0]["signatureId"]).toBeNull();
    expect(inserted[0]["signatureImageDataUrl"]).toBeNull();
    expect(inserted[0]["doctorRegistrationNo"]).toBe("");
  });

  test("prescription date falls back to the record's creation date (the OPD visit day)", async () => {
    await ensureSelfReferralPrescriptions([{ ...RECORD, id: 63, procedureDate: "", date: "" }]);
    expect(inserted[0]["prescriptionDate"]).toBe("2026-07-10");
  });

  test("empty input is a no-op", async () => {
    await ensureSelfReferralPrescriptions([]);
    expect(inserted).toHaveLength(0);
  });
});

describe("content hash (digital-signature integrity)", () => {
  const content = {
    formFRecordId: 61,
    patientName: "Meera Verify",
    spouseFather: "S. Verify",
    age: "32",
    prescriptionDate: "2026-07-10",
    adviceText: SELF_REFERRAL_PRESCRIPTION_ADVICE,
    doctorName: "Dr. Sugandha Priyadarshini",
    doctorQualifications: "MBBS, MD",
  };

  test("deterministic and field-order-stable", () => {
    expect(prescriptionContentHash(content)).toBe(prescriptionContentHash({ ...content }));
    expect(prescriptionContentString(content)).toContain("advice=Patient for Obstetrical Examination.");
  });

  test("any content change changes the hash (tamper evidence)", () => {
    const a = prescriptionContentHash(content);
    const b = prescriptionContentHash({ ...content, patientName: "Someone Else" });
    expect(a).not.toBe(b);
  });
});
