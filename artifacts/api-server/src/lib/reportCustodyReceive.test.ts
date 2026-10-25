/**
 * The counter's two rules, without a database.
 *
 * The request tests prove the workflow; this proves the decisions that are pure
 * functions of what was read, and runs on CI whether or not `DATABASE_URL` is
 * set — which matters, because the request file skips itself silently when it is
 * not, and a skipped suite reads as a passing one.
 */
import { describe, expect, it } from "vitest";
import {
  billNumberFromScannedCode,
  judgeReceipt,
  reasonMessage,
  RECEIVE_BATCH_LIMIT,
} from "./reportCustodyReceive";

describe("billNumberFromScannedCode — what a scanned code is allowed to name", () => {
  it("reads the QR the printed slip carries", () => {
    expect(
      billNumberFromScannedCode("https://care.example.org/api/verify/bill/2026100123?hash=a1b2c3d4"),
    ).toBe("2026100123");
  });

  it("reads the legacy BILL- prefix and a bare ten-digit bill number", () => {
    expect(billNumberFromScannedCode("BILL:2026100123")).toBe("2026100123");
    expect(billNumberFromScannedCode("2026100123")).toBe("2026100123");
  });

  it("does not mistake a phone number for a bill", () => {
    // The counter scans patient codes and phone numbers today; treating an
    // eleven-digit mobile as a bill number would receipt the wrong person's paper.
    expect(billNumberFromScannedCode("90000000001")).toBeNull();
    expect(billNumberFromScannedCode("123456789")).toBeNull();
  });

  it("does not treat a patient code as a bill", () => {
    expect(billNumberFromScannedCode("P-2025-0001")).toBeNull();
    expect(billNumberFromScannedCode("")).toBeNull();
  });
});

describe("judgeReceipt — the order of the checks is the policy", () => {
  const signed = { status: "pending_verification", signedAt: new Date(), signatureId: 4 };

  it("receives a hand-signed report that nobody has countersigned", () => {
    expect(judgeReceipt({ exists: true, ...signed, superseded: false, physicalState: null }))
      .toEqual({ verdict: "RECEIVED", authorized: true });
  });

  it("receives a countersigned report even when the signature columns are empty", () => {
    expect(
      judgeReceipt({ exists: true, status: "verified", signedAt: null, signatureId: null, superseded: false, physicalState: null }),
    ).toMatchObject({ verdict: "RECEIVED", authorized: true });
  });

  it("refuses a draft before anything else is considered", () => {
    // A draft carrying a stale signedAt must not be receiptable, and must not be
    // reported as "already at the counter" either.
    expect(
      judgeReceipt({ exists: true, status: "draft", signedAt: new Date(), signatureId: 4, superseded: false, physicalState: "AT_COUNTER" }),
    ).toMatchObject({ verdict: "NOT_SIGNED" });
  });

  it("reports handover as the end of the conversation, ahead of every other fact", () => {
    expect(
      judgeReceipt({ exists: true, status: "draft", signedAt: null, signatureId: null, superseded: true, physicalState: "HANDED_OVER" }),
    ).toMatchObject({ verdict: "ALREADY_HANDED_OVER" });
  });

  it("names a superseded revision rather than quietly receiving the old paper", () => {
    expect(judgeReceipt({ exists: true, ...signed, superseded: true, physicalState: null }))
      .toMatchObject({ verdict: "SUPERSEDED_REVISION", authorized: true });
  });

  it("still says SUPERSEDED when the old revision is already on the shelf", () => {
    // Both facts are true of this row, and the order is the policy: "a newer
    // signed version exists" is the one that changes what the clerk does next,
    // while "already received" would let them walk away satisfied. Swapping the
    // two checks is invisible to the case above, which is why this exists.
    expect(judgeReceipt({ exists: true, ...signed, superseded: true, physicalState: "AT_COUNTER" }))
      .toMatchObject({ verdict: "SUPERSEDED_REVISION" });
  });

  it("reports an existing receipt instead of creating a second one", () => {
    expect(judgeReceipt({ exists: true, ...signed, superseded: false, physicalState: "AT_COUNTER" }))
      .toMatchObject({ verdict: "ALREADY_AT_COUNTER" });
  });

  it("refuses a row that is not there", () => {
    expect(judgeReceipt({ exists: false, status: null, superseded: false, physicalState: null }))
      .toMatchObject({ verdict: "REPORT_NOT_FOUND" });
  });
});

describe("the refusal the clerk reads", () => {
  it("is a sentence for every reason, not a code", () => {
    const reasons = [
      "RECEIVED", "NOT_A_REPORT_CODE", "REPORT_NOT_FOUND", "NOT_SIGNED",
      "SUPERSEDED_REVISION", "ALREADY_AT_COUNTER", "ALREADY_HANDED_OVER", "CONCURRENT_DUPLICATE",
    ] as const;
    for (const r of reasons) {
      const text = reasonMessage(r);
      expect(text.length, `${r} has no clerk-facing sentence`).toBeGreaterThan(20);
      expect(text, `${r} leaked its enum into the UI`).not.toBe(r);
      expect(text.endsWith("."), `${r} is not a sentence`).toBe(true);
    }
  });

  it("states the batch cap once, from the same constant the route enforces", () => {
    expect(RECEIVE_BATCH_LIMIT).toBe(100);
  });
});
