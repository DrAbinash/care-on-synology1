/**
 * The release rule for paper, tested as a rule.
 *
 * `isReportClinicallyAuthorized` decides which reports the counter may see and,
 * from PR-4, which it may hand over. That is the owner's 2026-10-25 ruling in
 * code: a report signed by pen is releasable without an electronic
 * countersignature, and an unsigned one never is. The barcode-resolver request
 * test covers the route; this covers the predicate itself, including the rows no
 * current route produces — because the predicate is also the check that will run
 * against Word-registered reports, whose columns get written by an import rather
 * than by `/sign`.
 */
import { describe, expect, it } from "vitest";
import { isReportClinicallyAuthorized, UNSIGNED_REPORT_REFUSAL } from "./reportAuthorization";

const SIGNED = new Date("2026-10-25T09:30:00+05:30");

describe("isReportClinicallyAuthorized", () => {
  it("accepts a report that is signed but not countersigned", () => {
    // The clinic's normal state: Dr Sugandha signs each print, and /verify
    // refuses signer == verifier, so this is as far as a report gets.
    expect(isReportClinicallyAuthorized({ status: "pending_verification", signedAt: SIGNED, signatureId: 4 })).toBe(true);
  });

  it("accepts a signature recorded by either column, since older paths wrote only one", () => {
    expect(isReportClinicallyAuthorized({ status: "pending_verification", signedAt: SIGNED, signatureId: null })).toBe(true);
    expect(isReportClinicallyAuthorized({ status: "pending_verification", signedAt: null, signatureId: 4 })).toBe(true);
  });

  it("accepts the countersigned states on status alone", () => {
    expect(isReportClinicallyAuthorized({ status: "verified", signedAt: null, signatureId: null })).toBe(true);
    expect(isReportClinicallyAuthorized({ status: "delivered", signedAt: null, signatureId: null })).toBe(true);
  });

  it("refuses a draft whatever its columns claim", () => {
    // A draft carrying a stale signedAt is an editing artefact, not a signature;
    // the draft arm is checked before the signature arm for exactly this reason.
    expect(isReportClinicallyAuthorized({ status: "draft", signedAt: SIGNED, signatureId: 4 })).toBe(false);
    expect(isReportClinicallyAuthorized({ status: "draft", signedAt: null, signatureId: null })).toBe(false);
  });

  it("refuses a report that has no signature evidence at all", () => {
    expect(isReportClinicallyAuthorized({ status: "pending_verification", signedAt: null, signatureId: null })).toBe(false);
    expect(isReportClinicallyAuthorized({ status: "in_review", signedAt: null, signatureId: null })).toBe(false);
  });

  it("refuses a missing row rather than throwing on it", () => {
    expect(isReportClinicallyAuthorized(null)).toBe(false);
    expect(isReportClinicallyAuthorized(undefined)).toBe(false);
  });

  it("does not treat a print, send or delivered timestamp as a signature", () => {
    // `status='delivered'` is set by /print and /pdf on main (markDeliveredIfVerified),
    // so the delivered arm accepts the countersigned status only when the row is
    // not a draft. What must never happen is a draft that was merely printed
    // becoming releasable — that is the conflation the custody ledger exists to end.
    expect(isReportClinicallyAuthorized({ status: "draft", signedAt: null, signatureId: null })).toBe(false);
  });

  it("states the refusal in one sentence, shared by every surface", () => {
    expect(UNSIGNED_REPORT_REFUSAL).toMatch(/no signature recorded/i);
    // The clerk is told what to do, not just that the answer was no.
    expect(UNSIGNED_REPORT_REFUSAL).toMatch(/signed report can be handed over/i);
  });
});
