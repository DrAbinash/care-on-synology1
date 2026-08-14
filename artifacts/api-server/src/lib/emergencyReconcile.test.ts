import { describe, expect, it } from "vitest";
import {
  buildEmergencyOrderNotes,
  emergencyClientRef,
  emergencyOrderClientRef,
  mapEmergencyGender,
  synthesizeDob,
} from "./emergencyReconcileHelpers";
import { SOURCE } from "@workspace/emergency-billing";

describe("emergency reconcile helpers", () => {
  it("uses emg:uuid as CARE bill client_ref", () => {
    expect(emergencyClientRef("11111111-1111-4111-8111-111111111111")).toBe(
      "emg:11111111-1111-4111-8111-111111111111",
    );
    expect(emergencyOrderClientRef("11111111-1111-4111-8111-111111111111")).toBe(
      "emg-ord:11111111-1111-4111-8111-111111111111",
    );
  });

  it("maps sex conservatively", () => {
    expect(mapEmergencyGender("M")).toBe("male");
    expect(mapEmergencyGender("female")).toBe("female");
    expect(mapEmergencyGender("")).toBe("other");
  });

  it("synthesizes DOB from age when missing", () => {
    expect(synthesizeDob({ dateOfBirth: "1984-02-01", ageValue: 40, ageUnit: "years" })).toBe("1984-02-01");
    const dob = synthesizeDob({ dateOfBirth: null, ageValue: 10, ageUnit: "years", at: new Date("2026-08-14T00:00:00.000Z") });
    expect(dob.startsWith("2016-")).toBe(true);
  });

  it("embeds LOCAL_EMERGENCY provenance in order notes", () => {
    const notes = buildEmergencyOrderNotes({
      emergencyTransactionUuid: "11111111-1111-4111-8111-111111111111",
      emergencyBillNumber: "EMG-20260814-00001",
      emergencySessionUuid: "22222222-2222-4222-8222-222222222222",
      status: "PENDING",
      createdAt: "2026-08-14T04:51:00.000Z",
      createdByStaffId: 3,
      createdByStaffName: "Reception",
      patient: {
        carePatientId: 1, uhid: "P-00001", firstName: "A", lastName: "B",
        sex: "M", ageValue: 1, ageUnit: "years", dateOfBirth: null, mobile: "9",
      },
      referringDoctorId: null,
      referringDoctorName: null,
      lines: [],
      grossAmount: 0, discountAmount: 0, discountReason: null, netAmount: 0,
      amountReceived: 0, dueAmount: 0, payments: [], notes: null, tariffSyncedAt: null,
    });
    expect(notes).toContain(`source=${SOURCE}`);
    expect(notes).toContain("EMG-20260814-00001");
    expect(notes).toContain("11111111-1111-4111-8111-111111111111");
  });
});
