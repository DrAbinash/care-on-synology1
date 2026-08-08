import { describe, expect, test, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// F1 — canonical settlement idempotency across webhook / callback / poll.
//
// Root cause under test: the S2S webhook keyed payments.reference_number by
// the PROVIDER txnID while the callback and polling paths keyed it by OUR
// merchant reference — the same gateway payment could post twice under two
// different keys (2× paid + duplicate voucher). These tests drive the REAL
// ICICI webhook handler (valid HMAC) against a mocked db and prove the
// unified keying + the transition-safe dedupe guard.

let billRow: Record<string, unknown> | null;
let existingPayments: Array<Record<string, unknown>>;
let insertedPayments: Array<Record<string, unknown>>;
let billUpdates: Array<Record<string, unknown>>;

vi.mock("@workspace/db", () => {
  const chainFor = (table: { __name?: string }) => {
    const rows = async () => {
      if (table.__name === "bills") return billRow ? [billRow] : [];
      if (table.__name === "payments") return existingPayments;
      if (table.__name === "clinic_settings") return [{ v: "" }];
      if (table.__name === "online_bookings") return [];
      return [];
    };
    const tail: Record<string, unknown> = { limit: rows };
    tail["for"] = () => ({ limit: rows });
    return { where: () => tail, ...tail, orderBy: () => ({ limit: rows }) };
  };
  const dbLike = {
    select: () => ({ from: (t: { __name?: string }) => chainFor(t) }),
    insert: (table: { __name?: string }) => ({
      values: (vals: Record<string, unknown>) => {
        if (table.__name === "payments") insertedPayments.push(vals);
        const result = [{ id: insertedPayments.length || 1 }];
        const thenable = Promise.resolve(result) as Promise<typeof result> & {
          returning: () => Promise<typeof result>;
        };
        // Production settleBill uses .returning({ id }) after .values(...)
        thenable.returning = async () => result;
        return thenable;
      },
    }),
    update: (table: { __name?: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (table.__name === "bills") billUpdates.push(vals);
          return [];
        },
      }),
    }),
  };
  return {
    db: {
      ...dbLike,
      transaction: async (cb: (tx: typeof dbLike) => Promise<unknown>) => cb(dbLike),
    },
  };
});

vi.mock("@workspace/db/schema", () => ({
  billsTable: { __name: "bills", id: "id" },
  paymentsTable: {
    __name: "payments", id: "id", billId: "bill_id",
    referenceNumber: "reference_number", gatewayTxnId: "gateway_txn_id",
  },
  onlineBookingsTable: { __name: "online_bookings", id: "id" },
  paymentLogsTable: { __name: "payment_logs" },
  clinicSettingsTable: { __name: "clinic_settings", iciciSecretKey: "icici_secret_key" },
}));

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const voucherCalls: Array<Record<string, unknown>> = [];
vi.mock("../lib/auto-voucher", () => ({
  autoVoucherForPayment: vi.fn(async (opts: Record<string, unknown>) => { voucherCalls.push(opts); }),
}));
vi.mock("../lib/payments/PaymentEngine", () => ({ PaymentEngine: { getProvider: vi.fn(), checkStatus: vi.fn() } }));
vi.mock("../middleware/requireStaffAuth", () => ({ requireStaffAuth: (_r: unknown, _s: unknown, next: () => void) => next() }));

import { gatewayWebhookRouter, verifyIciciWebhookSignature } from "./gateway-webhooks";

const SECRET = "test-secret-key";
process.env.ICICI_SECRET_KEY = SECRET;

function signedIciciBody(fields: Record<string, string>): Record<string, string> {
  const body = { ...fields };
  const keys = Object.keys(body).sort();
  const hashText = keys.map((k) => body[k]).join("");
  body.secureHash = crypto.createHmac("sha256", SECRET).update(hashText).digest("hex");
  return body;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (gatewayWebhookRouter as any).stack.find((l: any) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`POST ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json() { return this; },
  };
  return res;
}

const iciciWebhook = getHandler("/icici-webhook");

const MERCHANT_REF = "BILLPAY-42-A1B2C3";
const PROVIDER_TXN = "ICICI-TXN-999888";

beforeEach(() => {
  billRow = { id: 42, paidAmount: "0.00", totalAmount: "500.00", refundAmount: "0.00", billNumber: "0042" };
  existingPayments = [];
  insertedPayments = [];
  billUpdates = [];
  voucherCalls.length = 0;
});

describe("ICICI S2S webhook — canonical identifier keying", () => {
  test("sanity: our signed test payload passes the real signature check", () => {
    const body = signedIciciBody({ merchantTxnNo: MERCHANT_REF, txnID: PROVIDER_TXN, amount: "500.00", txnStatus: "SUC" });
    expect(verifyIciciWebhookSignature(body, SECRET)).toBe(true);
  });

  test("first delivery: reference_number = OUR merchant ref; provider txnID stored in gateway_txn_id; status captured", async () => {
    await iciciWebhook({ body: signedIciciBody({ merchantTxnNo: MERCHANT_REF, txnID: PROVIDER_TXN, amount: "500.00", txnStatus: "SUC" }) }, makeRes());
    expect(insertedPayments).toHaveLength(1);
    expect(insertedPayments[0]["referenceNumber"]).toBe(MERCHANT_REF);
    expect(insertedPayments[0]["gatewayTxnId"]).toBe(PROVIDER_TXN);
    expect(insertedPayments[0]["settlementStatus"]).toBe("captured");
    expect(billUpdates).toHaveLength(1);
    expect(billUpdates[0]["paidAmount"]).toBe("500.00");
  });

  test("REGRESSION (the double-post): webhook after the callback already recorded the payment → no second row, no second bill update", async () => {
    existingPayments = [{ id: 7, referenceNumber: MERCHANT_REF, gatewayTxnId: null }];
    await iciciWebhook({ body: signedIciciBody({ merchantTxnNo: MERCHANT_REF, txnID: PROVIDER_TXN, amount: "500.00", txnStatus: "SUC" }) }, makeRes());
    expect(insertedPayments).toHaveLength(0);
    expect(billUpdates).toHaveLength(0);
  });

  test("transition safety: a PRE-F1 row keyed by the provider txnID still dedupes", async () => {
    existingPayments = [{ id: 8, referenceNumber: PROVIDER_TXN, gatewayTxnId: null }];
    await iciciWebhook({ body: signedIciciBody({ merchantTxnNo: MERCHANT_REF, txnID: PROVIDER_TXN, amount: "500.00", txnStatus: "SUC" }) }, makeRes());
    expect(insertedPayments).toHaveLength(0);
    expect(billUpdates).toHaveLength(0);
  });

  test("a forged/unsigned webhook never reaches settlement (existing gate preserved)", async () => {
    await iciciWebhook({ body: { merchantTxnNo: MERCHANT_REF, txnID: PROVIDER_TXN, amount: "500.00", txnStatus: "SUC" } }, makeRes());
    expect(insertedPayments).toHaveLength(0);
  });
});

describe("callback + poll paths share the same keying (source contracts)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(resolve(HERE, rel), "utf8");

  test("public-booking callback stores gateway_txn_id, marks captured, and dedupes on either identifier column", () => {
    const src = read("./public-booking.ts");
    expect(src).toContain("gatewayTxnId: txnID || null");
    expect(src).toContain('settlementStatus: "captured"');
    expect(src).toContain("inArray(paymentsTable.gatewayTxnId, knownRefs)");
  });

  test("bill status-poll dedupes on either identifier column and marks captured", () => {
    const src = read("./bills.ts");
    expect(src).toContain("eq(paymentsTable.gatewayTxnId, txnRef)");
    const pollIdx = src.indexOf("gateway-payment-status/:txnRef");
    expect(src.slice(pollIdx, pollIdx + 4000)).toContain('settlementStatus: "captured"');
  });

  test("no settle path keys reference_number by the provider txnID anymore", () => {
    const webhooks = read("./gateway-webhooks.ts");
    expect(webhooks).not.toContain("gatewayTxnId: txnID || merchantTxnNo");
    expect(webhooks).not.toContain("gatewayTxnId: txnId || orderId");
    expect(webhooks).toContain("merchantRef: merchantTxnNo");
    expect(webhooks).toContain("merchantRef: orderId");
  });
});
