import { describe, expect, test } from "vitest";
import { canTransitionConsent, isConsentStatus, last4, buildConsentRequestPayload, buildEnrolmentOtpPayload, buildEnrolmentVerifyPayload } from "./abdmConsentProtocol";

describe("consent transitions", () => {
  test("valid transitions", () => {
    expect(canTransitionConsent("REQUESTED", "GRANTED")).toBe(true);
    expect(canTransitionConsent("REQUESTED", "DENIED")).toBe(true);
    expect(canTransitionConsent("GRANTED", "REVOKED")).toBe(true);
    expect(canTransitionConsent("GRANTED", "EXPIRED")).toBe(true);
  });
  test("invalid transitions", () => {
    expect(canTransitionConsent("DENIED", "GRANTED")).toBe(false);
    expect(canTransitionConsent("REVOKED", "GRANTED")).toBe(false);
    expect(canTransitionConsent("GRANTED", "DENIED")).toBe(false); // can't deny an already-granted consent
    expect(canTransitionConsent("EXPIRED", "REVOKED")).toBe(false);
  });
  test("unknown statuses never transition", () => {
    expect(canTransitionConsent("FOO", "GRANTED")).toBe(false);
    expect(canTransitionConsent("REQUESTED", "BAR")).toBe(false);
  });
  test("isConsentStatus", () => {
    expect(isConsentStatus("GRANTED")).toBe(true);
    expect(isConsentStatus("nope")).toBe(false);
  });
});

describe("last4", () => {
  test("keeps only the last 4 digits", () => {
    expect(last4("123456789012")).toBe("9012");
    expect(last4("+91 98765 43210")).toBe("3210");
    expect(last4("12")).toBe("12");
    expect(last4(null)).toBe("");
  });
});

describe("payload builders", () => {
  test("consent request payload carries hiTypes + date range", () => {
    const p = buildConsentRequestPayload({
      requestId: "r1", abhaAddress: "asha@sbx", hiTypes: ["DiagnosticReport"], purposeCode: "CAREMGT",
      dateFrom: "2026-01-01T00:00:00Z", dateTo: "2026-06-01T00:00:00Z", expiry: "2026-12-01T00:00:00Z", hiuId: "HIU1",
    }) as any;
    expect(p.requestId).toBe("r1");
    expect(p.consent.hiTypes).toEqual(["DiagnosticReport"]);
    expect(p.consent.patient.id).toBe("asha@sbx");
    expect(p.consent.permission.dateRange.from).toBe("2026-01-01T00:00:00Z");
  });
  test("enrolment OTP + verify payloads carry txnId", () => {
    expect((buildEnrolmentOtpPayload({ txnId: "t1", method: "mobile-otp", identifier: "9876543210" }) as any).txnId).toBe("t1");
    expect((buildEnrolmentVerifyPayload({ txnId: "t1", otp: "123456" }) as any).authData.otp.value).toBe("123456");
  });
});
