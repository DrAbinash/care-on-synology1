// Pure, DB-free helpers for the ABDM consent-request lifecycle + ABHA enrolment.
// No crypto, no I/O, no gateway calls — fully unit-testable. Payload builders
// produce the request bodies; the route layer adds ids/tokens and posts them.

export type ConsentStatus = "REQUESTED" | "GRANTED" | "DENIED" | "REVOKED" | "EXPIRED";

// Allowed lifecycle transitions. A request starts REQUESTED; it can be granted
// or denied (typically by the Consent Manager), and a granted consent can later
// be revoked or expire. Terminal states have no outgoing transitions.
const CONSENT_TRANSITIONS: Record<ConsentStatus, ConsentStatus[]> = {
  REQUESTED: ["GRANTED", "DENIED", "REVOKED", "EXPIRED"],
  GRANTED: ["REVOKED", "EXPIRED"],
  DENIED: [],
  REVOKED: [],
  EXPIRED: [],
};

export function isConsentStatus(s: string): s is ConsentStatus {
  return s === "REQUESTED" || s === "GRANTED" || s === "DENIED" || s === "REVOKED" || s === "EXPIRED";
}

export function canTransitionConsent(from: string, to: string): boolean {
  if (!isConsentStatus(from) || !isConsentStatus(to)) return false;
  return CONSENT_TRANSITIONS[from].includes(to);
}

/** Last 4 digits of an identifier (Aadhaar/mobile) — everything else is dropped
 *  so no full identifier is ever persisted. */
export function last4(identifier: string | null | undefined): string {
  const digits = (identifier ?? "").replace(/\D/g, "");
  return digits.slice(-4);
}

export interface ConsentRequestInput {
  requestId: string;
  abhaAddress: string;
  hiTypes: string[];
  purposeCode: string;
  purposeText?: string;
  dateFrom: string;   // ISO
  dateTo: string;     // ISO
  expiry: string;     // ISO
  hiuId: string;
  requesterName?: string;
}

/** Build the HIU consent-request body for the gateway (shape mirrors the ABDM
 *  consent-request-init contract; encryption/signing is added by the transport). */
export function buildConsentRequestPayload(i: ConsentRequestInput): Record<string, unknown> {
  return {
    requestId: i.requestId,
    timestamp: i.dateFrom,
    consent: {
      purpose: { text: i.purposeText ?? i.purposeCode, code: i.purposeCode },
      patient: { id: i.abhaAddress },
      hiu: { id: i.hiuId },
      requester: { name: i.requesterName ?? "CARE Diagnostics" },
      hiTypes: i.hiTypes,
      permission: {
        accessMode: "VIEW",
        dateRange: { from: i.dateFrom, to: i.dateTo },
        dataEraseAt: i.expiry,
        frequency: { unit: "HOUR", value: 1, repeats: 0 },
      },
    },
  };
}

export interface EnrolmentOtpInput {
  txnId: string;
  method: "aadhaar-otp" | "mobile-otp";
  identifier: string;   // full Aadhaar/mobile — used only to build the payload, never persisted
  scope?: string;
}

/** Build the enrolment "request OTP" body. */
export function buildEnrolmentOtpPayload(i: EnrolmentOtpInput): Record<string, unknown> {
  return {
    txnId: i.txnId,
    scope: i.scope ? [i.scope] : ["abha-enrol"],
    loginHint: i.method === "aadhaar-otp" ? "aadhaar" : "mobile",
    otpSystem: i.method === "aadhaar-otp" ? "aadhaar" : "abdm",
    authData: { authMethods: [i.method === "aadhaar-otp" ? "otp" : "mobile-otp"], otp: { txnId: i.txnId, value: i.identifier } },
  };
}

export interface EnrolmentVerifyInput {
  txnId: string;
  otp: string;
}

/** Build the enrolment "verify OTP" body. */
export function buildEnrolmentVerifyPayload(i: EnrolmentVerifyInput): Record<string, unknown> {
  return {
    txnId: i.txnId,
    authData: { authMethods: ["otp"], otp: { txnId: i.txnId, value: i.otp } },
  };
}
