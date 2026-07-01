import { describe, expect, test, vi } from "vitest";
import crypto from "node:crypto";

// gateway-webhooks.ts imports `db` from @workspace/db at module top level,
// which throws unconditionally at import time when DATABASE_URL is not set.
// verifyIciciWebhookSignature/verifyHdfcWebhookSignature are pure — they
// never touch the database — so mocking the module prevents the load-time
// throw without affecting what is under test. Same pattern as
// day-close.test.ts / auto-voucher.test.ts.
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("@workspace/db/schema", () => ({
  billsTable: {}, paymentsTable: {}, onlineBookingsTable: {}, paymentLogsTable: {}, clinicSettingsTable: {},
}));
vi.mock("../lib/auto-voucher", () => ({ autoVoucherForPayment: async () => undefined }));
vi.mock("../lib/payments/PaymentEngine", () => ({ PaymentEngine: { getProvider: async () => null, verifyPayment: async () => ({ success: false }) } }));
vi.mock("../middleware/requireStaffAuth", () => ({ requireStaffAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));

import { verifyIciciWebhookSignature, verifyHdfcWebhookSignature } from "./gateway-webhooks";

// SECURITY REGRESSION SUITE: these tests exist specifically because the
// previous implementation of both checks was `if (signature && secret) {
// verify }` — a forged request that simply OMITTED the signature field
// skipped verification entirely and was trusted. Every "missing" case below
// must return false (reject); only a correctly-signed request may return
// true.

describe("verifyIciciWebhookSignature", () => {
  const secretKey = "test-icici-secret";

  function sign(body: Record<string, string>, key = secretKey): string {
    const keys = Object.keys(body).sort();
    const hashText = keys.map((k) => body[k]).join("");
    return crypto.createHmac("sha256", key).update(hashText).digest("hex");
  }

  test("accepts a correctly-signed payload", () => {
    const body: Record<string, string> = { merchantTxnNo: "OB202607ABCDEF", txnStatus: "SUC", amount: "500" };
    body.secureHash = sign(body);
    expect(verifyIciciWebhookSignature(body, secretKey)).toBe(true);
  });

  test("REGRESSION: rejects a forged payload with secureHash simply omitted", () => {
    const body: Record<string, string> = { merchantTxnNo: "OB202607ABCDEF", txnStatus: "SUC", amount: "500" };
    // No secureHash field at all — this is exactly the forged-webhook shape
    // that previously bypassed verification entirely.
    expect(verifyIciciWebhookSignature(body, secretKey)).toBe(false);
  });

  test("rejects a payload with an empty-string secureHash", () => {
    const body: Record<string, string> = { merchantTxnNo: "OB202607ABCDEF", txnStatus: "SUC", amount: "500", secureHash: "" };
    expect(verifyIciciWebhookSignature(body, secretKey)).toBe(false);
  });

  test("rejects when secretKey is not configured, even with a present secureHash", () => {
    const body: Record<string, string> = { merchantTxnNo: "OB202607ABCDEF", txnStatus: "SUC", amount: "500", secureHash: "anything" };
    expect(verifyIciciWebhookSignature(body, "")).toBe(false);
    expect(verifyIciciWebhookSignature(body, null)).toBe(false);
    expect(verifyIciciWebhookSignature(body, undefined)).toBe(false);
  });

  test("rejects a mismatched/tampered signature", () => {
    const body: Record<string, string> = { merchantTxnNo: "OB202607ABCDEF", txnStatus: "SUC", amount: "500" };
    body.secureHash = sign(body);
    // Attacker tampers with the amount after the hash was computed.
    body.amount = "999999";
    expect(verifyIciciWebhookSignature(body, secretKey)).toBe(false);
  });

  test("rejects a signature computed with the wrong secret", () => {
    const body: Record<string, string> = { merchantTxnNo: "OB202607ABCDEF", txnStatus: "SUC", amount: "500" };
    body.secureHash = sign(body, "wrong-secret");
    expect(verifyIciciWebhookSignature(body, secretKey)).toBe(false);
  });
});

describe("verifyHdfcWebhookSignature", () => {
  const merchantId = "TEST_MERCHANT";
  const secretKey = "test-hdfc-secret";
  const orderId = "OB202607FEDCBA";
  const status = "SUCCESS";

  function sign(mId = merchantId, oId = orderId, st = status, key = secretKey): string {
    return crypto.createHash("sha256").update(`${mId}|${oId}|${st}|${key}`).digest("hex");
  }

  test("accepts a correctly-signed payload", () => {
    const receivedSignature = sign();
    expect(verifyHdfcWebhookSignature({ orderId, status, receivedSignature, merchantId, secretKey })).toBe(true);
  });

  test("REGRESSION: rejects a forged payload with the signature field simply omitted", () => {
    expect(verifyHdfcWebhookSignature({ orderId, status, receivedSignature: undefined, merchantId, secretKey })).toBe(false);
    expect(verifyHdfcWebhookSignature({ orderId, status, receivedSignature: "", merchantId, secretKey })).toBe(false);
  });

  test("rejects when merchantId is not configured", () => {
    const receivedSignature = sign();
    expect(verifyHdfcWebhookSignature({ orderId, status, receivedSignature, merchantId: "", secretKey })).toBe(false);
  });

  test("rejects when secretKey is not configured", () => {
    const receivedSignature = sign();
    expect(verifyHdfcWebhookSignature({ orderId, status, receivedSignature, merchantId, secretKey: "" })).toBe(false);
  });

  test("rejects a tampered status (attacker flips FAILED to SUCCESS post-signing)", () => {
    const receivedSignature = sign(merchantId, orderId, "FAILED");
    expect(verifyHdfcWebhookSignature({ orderId, status: "SUCCESS", receivedSignature, merchantId, secretKey })).toBe(false);
  });

  test("rejects a signature computed with the wrong secret", () => {
    const receivedSignature = sign(merchantId, orderId, status, "wrong-secret");
    expect(verifyHdfcWebhookSignature({ orderId, status, receivedSignature, merchantId, secretKey })).toBe(false);
  });
});
