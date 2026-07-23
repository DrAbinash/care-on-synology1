import { describe, it, expect } from "vitest";
import {
  abhaDigits, isValidAbhaNumber, formatAbhaNumber,
  isValidAbhaAddress, normalizeAbhaAddress, yearOfBirthFrom,
  buildLinkCareContextRequest, consentPermits,
} from "./abdmProtocol";

describe("ABHA number", () => {
  it("validates exactly 14 digits, ignoring formatting", () => {
    expect(isValidAbhaNumber("12-3456-7890-1234")).toBe(true);
    expect(isValidAbhaNumber("12345678901234")).toBe(true);
    expect(isValidAbhaNumber("1234567890123")).toBe(false); // 13
    expect(isValidAbhaNumber("123456789012345")).toBe(false); // 15
    expect(isValidAbhaNumber(null)).toBe(false);
  });
  it("formats to XX-XXXX-XXXX-XXXX", () => {
    expect(formatAbhaNumber("12345678901234")).toBe("12-3456-7890-1234");
    expect(formatAbhaNumber("12-3456-7890-1234")).toBe("12-3456-7890-1234");
    expect(formatAbhaNumber("bad")).toBeNull();
  });
  it("abhaDigits strips non-digits", () => {
    expect(abhaDigits("12-34 ab56")).toBe("123456");
  });
});

describe("ABHA address", () => {
  it("accepts handle@registrar, rejects malformed", () => {
    expect(isValidAbhaAddress("asha@sbx")).toBe(true);
    expect(isValidAbhaAddress("asha.rao_1@abdm")).toBe(true);
    expect(isValidAbhaAddress("Asha@SBX")).toBe(true); // case-insensitive
    expect(isValidAbhaAddress("asha@")).toBe(false);
    expect(isValidAbhaAddress("@sbx")).toBe(false);
    expect(isValidAbhaAddress("asha sbx")).toBe(false);
    expect(isValidAbhaAddress(".asha@sbx")).toBe(false); // cannot start with dot
    expect(isValidAbhaAddress(null)).toBe(false);
  });
  it("normalises to lower case, or null when invalid", () => {
    expect(normalizeAbhaAddress("  Asha@SBX ")).toBe("asha@sbx");
    expect(normalizeAbhaAddress("nope")).toBeNull();
  });
});

describe("yearOfBirthFrom", () => {
  it("extracts a plausible 4-digit year", () => {
    expect(yearOfBirthFrom("1990-05-15")).toBe(1990);
    expect(yearOfBirthFrom("1990")).toBe(1990);
    expect(yearOfBirthFrom("35 yrs")).toBeNull();
    expect(yearOfBirthFrom("3050")).toBeNull(); // out of range
  });
});

describe("buildLinkCareContextRequest", () => {
  it("builds a deterministic link payload", () => {
    const payload = buildLinkCareContextRequest({
      requestId: "req-1", timestamp: "2026-07-23T10:00:00Z",
      abhaAddress: "asha@sbx", patientReferenceId: "42", patientDisplay: "Asha Rao",
      careContexts: [{ careContextRef: "order:ORD-1", display: "CBC — 23 Jul 2026" }],
    });
    expect(payload.requestId).toBe("req-1");
    const link = payload.link as any;
    expect(link.patient.referenceNumber).toBe("42");
    expect(link.patient.careContexts).toEqual([
      { referenceNumber: "order:ORD-1", display: "CBC — 23 Jul 2026", hiType: "DiagnosticReport" },
    ]);
  });
});

describe("consentPermits", () => {
  const now = new Date("2026-07-23T10:00:00Z");
  it("requires GRANTED, unexpired, matching hiType and date window", () => {
    const base = {
      status: "GRANTED", expiry: "2026-12-31T00:00:00Z", hiTypes: "DiagnosticReport,Prescription",
      permissionFrom: "2026-01-01T00:00:00Z", permissionTo: "2026-12-31T00:00:00Z",
    };
    expect(consentPermits(base, "DiagnosticReport", new Date("2026-06-01"), now)).toBe(true);
    expect(consentPermits({ ...base, status: "REQUESTED" }, "DiagnosticReport", new Date("2026-06-01"), now)).toBe(false);
    expect(consentPermits({ ...base, expiry: "2026-07-01T00:00:00Z" }, "DiagnosticReport", new Date("2026-06-01"), now)).toBe(false); // expired
    expect(consentPermits(base, "ImagingStudy", new Date("2026-06-01"), now)).toBe(false); // hiType not allowed
    expect(consentPermits(base, "DiagnosticReport", new Date("2025-06-01"), now)).toBe(false); // before window
    expect(consentPermits(base, "DiagnosticReport", new Date("2027-06-01"), now)).toBe(false); // after window
  });
  it("permits any hiType when the consent lists none", () => {
    expect(consentPermits({ status: "GRANTED", hiTypes: null }, "Anything", new Date("2026-06-01"), now)).toBe(true);
  });
});
