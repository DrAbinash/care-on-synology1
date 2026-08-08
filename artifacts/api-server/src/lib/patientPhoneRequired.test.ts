import { describe, expect, it, vi, beforeEach } from "vitest";

const selectLimit = vi.fn();
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        limit: (...args: unknown[]) => selectLimit(...args),
      }),
    }),
  },
  clinicSettingsTable: { patientPhoneRequired: "patient_phone_required" },
}));

import { isClinicPatientPhoneRequired, phoneLooksPresent } from "./patientPhoneRequired";

describe("patientPhoneRequired (api)", () => {
  beforeEach(() => {
    selectLimit.mockReset();
  });

  it("phoneLooksPresent trims", () => {
    expect(phoneLooksPresent(" 9 ")).toBe(true);
    expect(phoneLooksPresent("  ")).toBe(false);
  });

  it("defaults to required when no clinic row", async () => {
    selectLimit.mockResolvedValueOnce([]);
    await expect(isClinicPatientPhoneRequired()).resolves.toBe(true);
  });

  it("reads clinic_settings.patient_phone_required", async () => {
    selectLimit.mockResolvedValueOnce([{ patientPhoneRequired: false }]);
    await expect(isClinicPatientPhoneRequired()).resolves.toBe(false);
    selectLimit.mockResolvedValueOnce([{ patientPhoneRequired: true }]);
    await expect(isClinicPatientPhoneRequired()).resolves.toBe(true);
  });

  it("defaults to required on DB/schema errors", async () => {
    selectLimit.mockRejectedValueOnce(new Error("column missing"));
    await expect(isClinicPatientPhoneRequired()).resolves.toBe(true);
  });
});
