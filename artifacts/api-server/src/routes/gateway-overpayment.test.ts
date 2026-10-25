import { describe, expect, test, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// F3 — gateway overpayment protection.
//
// Root cause under test: every BILLPAY settle path (S2S webhook, browser
// callback, status poll) posts the gateway payment at face value and clamps
// the balance at zero. When the settled amount exceeds the outstanding (bill
// paid by other means between initiate and capture, or concurrent payment
// links), the excess sat silently inside paid_amount > total_amount — no flag,
// no audit, no books-sanity check, nothing for an admin to reconcile.
//
// These tests drive the REAL ICICI webhook handler (valid HMAC) against a
// mocked db and prove:
//   1. money is never discarded — the payment row keeps the FULL gateway
//      amount even when it exceeds the outstanding;
//   2. the excess is flagged — OVERPAYMENT notes marker, an
//      `overpayment_flagged` bill_audit row inside the same transaction, and
//      a warn log;
//   3. no auto-refund is issued and settlement arithmetic (balance clamp,
//      status) is unchanged;
//   4. the non-overpayment path is byte-for-byte the old behaviour (no audit
//      row, no marker);
//   5. idempotency and the cancelled-bill refusal still hold;
//   6. books-sanity surfaces bills whose paid_amount exceeds the total.

let billRow: Record<string, unknown> | null;
let existingPayments: Array<Record<string, unknown>>;
let insertedPayments: Array<Record<string, unknown>>;
let insertedAudits: Array<Record<string, unknown>>;
let billUpdates: Array<Record<string, unknown>>;
let paymentLogRows: Array<Record<string, unknown>>;

vi.mock("@workspace/db", () => {
  const chainFor = (table: { __name?: string }) => {
    const rows = async () => {
      if (table.__name === "bills") return billRow ? [billRow] : [];
      if (table.__name === "payments") return existingPayments;
      if (table.__name === "clinic_settings") return [{ v: "" }];
      if (table.__name === "online_bookings") return [];
      if (table.__name === "payment_logs") return paymentLogRows;
      return [];
    };
    const tail: Record<string, unknown> = { limit: rows };
    tail["for"] = () => ({ limit: rows });
    return {
      where: () => ({ ...tail, orderBy: () => ({ limit: rows }) }),
      ...tail,
      orderBy: () => ({ limit: rows }),
    };
  };
  const dbLike = {
    select: () => ({ from: (t: { __name?: string }) => chainFor(t) }),
    insert: (table: { __name?: string }) => ({
      values: (vals: Record<string, unknown>) => {
        if (table.__name === "payments") insertedPayments.push(vals);
        if (table.__name === "bill_audits") insertedAudits.push(vals);
        const result = [{ id: insertedPayments.length || 1 }];
        const thenable = Promise.resolve(result) as Promise<typeof result> & {
          returning: () => Promise<typeof result>;
        };
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
      transaction: async (cb: (tx: typeof dbLike) => Promise<unknown>) =>
        cb(dbLike),
    },
  };
});

vi.mock("@workspace/db/schema", () => ({
  billsTable: { __name: "bills", id: "id" },
  paymentsTable: {
    __name: "payments",
    id: "id",
    billId: "bill_id",
    referenceNumber: "reference_number",
    gatewayTxnId: "gateway_txn_id",
  },
  billAuditsTable: {
    __name: "bill_audits",
    billId: "bill_id",
    editedBy: "edited_by",
    reason: "reason",
    changeType: "change_type",
    oldValue: "old_value",
    newValue: "new_value",
  },
  onlineBookingsTable: { __name: "online_bookings", id: "id" },
  paymentLogsTable: {
    __name: "payment_logs",
    bookingRef: "booking_ref",
    createdAt: "created_at",
    requestPayload: "request_payload",
  },
  clinicSettingsTable: {
    __name: "clinic_settings",
    iciciSecretKey: "icici_secret_key",
  },
}));

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: warnSpy, error: vi.fn() },
}));
const voucherCalls: Array<Record<string, unknown>> = [];
vi.mock("../lib/auto-voucher", () => ({
  autoVoucherForPayment: vi.fn(async (opts: Record<string, unknown>) => {
    voucherCalls.push(opts);
  }),
}));
vi.mock("../lib/payments/PaymentEngine", () => ({
  PaymentEngine: { getProvider: vi.fn(), checkStatus: vi.fn() },
}));
vi.mock("../middleware/requireStaffAuth", () => ({
  requireStaffAuth: (_r: unknown, _s: unknown, next: () => void) => next(),
}));
// Use the real collector helper (it only needs db.select on payment_logs).

import { gatewayWebhookRouter } from "./gateway-webhooks";
import {
  computeGatewayOverpayment,
  OVERPAYMENT_AUDIT_CHANGE_TYPE,
} from "../lib/payments/overpayment";

const SECRET = "test-secret-key";
process.env.ICICI_SECRET_KEY = SECRET;

function signedIciciBody(
  fields: Record<string, string>,
): Record<string, string> {
  const body = { ...fields };
  const keys = Object.keys(body).sort();
  const hashText = keys.map((k) => body[k]).join("");
  body.secureHash = crypto
    .createHmac("sha256", SECRET)
    .update(hashText)
    .digest("hex");
  return body;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (gatewayWebhookRouter as any).stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods.post,
  );
  if (!layer) throw new Error(`POST ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  return res;
}

const iciciWebhook = getHandler("/icici-webhook");

const MERCHANT_REF = "BILLPAY-42-A1B2C3";
const PROVIDER_TXN = "ICICI-TXN-999888";

beforeEach(() => {
  billRow = {
    id: 42,
    paidAmount: "0.00",
    totalAmount: "500.00",
    refundAmount: "0.00",
    billNumber: "0042",
    createdByName: "Desk Cashier",
    status: "pending",
  };
  existingPayments = [];
  insertedPayments = [];
  insertedAudits = [];
  billUpdates = [];
  paymentLogRows = [
    {
      requestPayload: JSON.stringify({
        initiatedByName: "Desk Cashier",
        redirectUrl: "https://example.test",
      }),
    },
  ];
  voucherCalls.length = 0;
  warnSpy.mockClear();
});

// ── 1. Pure detection math (paise-exact, db-numeric strings) ──────────────────

describe("computeGatewayOverpayment", () => {
  test("settling above the outstanding is detected with the exact excess", () => {
    // Bill fully paid (500 of 500): outstanding is 0, so the whole gateway
    // capture is excess.
    const r = computeGatewayOverpayment({
      totalAmount: "500.00",
      paidAmount: "500.00",
      refundAmount: "0.00",
      settledAmount: 200,
    });
    expect(r.detected).toBe(true);
    expect(r.outstandingBefore).toBe(0);
    expect(r.excess).toBe(200);
  });

  test("partial bill: excess = settled − remaining outstanding", () => {
    const r = computeGatewayOverpayment({
      totalAmount: "500.00",
      paidAmount: "400.00",
      refundAmount: "0.00",
      settledAmount: 250,
    });
    expect(r.detected).toBe(true);
    expect(r.outstandingBefore).toBe(100);
    expect(r.excess).toBe(150);
  });

  test("settling within the outstanding is not an overpayment", () => {
    const r = computeGatewayOverpayment({
      totalAmount: "500.00",
      paidAmount: "400.00",
      refundAmount: "0.00",
      settledAmount: 100,
    });
    expect(r.detected).toBe(false);
    expect(r.excess).toBe(0);
  });

  test("settling exactly the outstanding is not an overpayment", () => {
    const r = computeGatewayOverpayment({
      totalAmount: "500.00",
      paidAmount: "0.00",
      refundAmount: "0.00",
      settledAmount: 500,
    });
    expect(r.detected).toBe(false);
  });

  test("one paisa of excess is float noise, not money (MONEY_EPS_PAISE tolerance)", () => {
    const eps = computeGatewayOverpayment({
      totalAmount: "100.00",
      paidAmount: "0.00",
      refundAmount: "0.00",
      settledAmount: 100.01,
    });
    expect(eps.detected).toBe(false);
    const real = computeGatewayOverpayment({
      totalAmount: "100.00",
      paidAmount: "0.00",
      refundAmount: "0.00",
      settledAmount: 100.02,
    });
    expect(real.detected).toBe(true);
    expect(real.excess).toBe(0.02);
  });

  test("a gateway payment on a fully-paid-then-refunded bill is 100% excess", () => {
    // paid=500 then refunded=500: outstanding is 0 by the same
    // total − paid − refund invariant the settle paths enforce.
    const r = computeGatewayOverpayment({
      totalAmount: "500.00",
      paidAmount: "500.00",
      refundAmount: "500.00",
      settledAmount: 500,
    });
    expect(r.detected).toBe(true);
    expect(r.outstandingBefore).toBe(0);
    expect(r.excess).toBe(500);
  });
});

// ── 2. S2S webhook settle — overpayment flagged, money preserved ─────────────

describe("ICICI S2S webhook — gateway overpayment protection", () => {
  test("webhook amount beyond the outstanding: payment keeps FULL amount, notes marked, audit row written, bill clamped", async () => {
    // Bill was already settled by other means between initiate and capture.
    billRow = {
      id: 42,
      paidAmount: "500.00",
      totalAmount: "500.00",
      refundAmount: "0.00",
      balanceAmount: "0.00",
      billNumber: "0042",
      createdByName: "Desk Cashier",
      status: "paid",
    };
    await iciciWebhook(
      {
        body: signedIciciBody({
          merchantTxnNo: MERCHANT_REF,
          txnID: PROVIDER_TXN,
          amount: "200.00",
          txnStatus: "SUC",
        }),
      },
      makeRes(),
    );

    // Money actually received is never discarded: payment row at the FULL amount.
    expect(insertedPayments).toHaveLength(1);
    expect(insertedPayments[0]["amount"]).toBe("200.00");
    expect(insertedPayments[0]["referenceNumber"]).toBe(MERCHANT_REF);
    expect(insertedPayments[0]["gatewayTxnId"]).toBe(PROVIDER_TXN);

    // Notes marker on the NEW row only.
    expect(String(insertedPayments[0]["notes"])).toContain("OVERPAYMENT");
    expect(String(insertedPayments[0]["notes"])).toContain("200.00");

    // Durable flag: bill_audits row inside the same settlement transaction.
    expect(insertedAudits).toHaveLength(1);
    expect(insertedAudits[0]["billId"]).toBe(42);
    expect(insertedAudits[0]["changeType"]).toBe(OVERPAYMENT_AUDIT_CHANGE_TYPE);
    const auditPayload = JSON.parse(
      String(insertedAudits[0]["newValue"]),
    ) as Record<string, unknown>;
    expect(auditPayload["excess"]).toBe(200);
    expect(auditPayload["outstandingBefore"]).toBe(0);
    expect(auditPayload["merchantRef"]).toBe(MERCHANT_REF);
    expect(auditPayload["gatewayTxnId"]).toBe(PROVIDER_TXN);
    expect(auditPayload["action"]).toBe("flagged_for_admin_reconciliation");

    // Settlement arithmetic unchanged: paid grows by the full amount, balance clamps, status stays paid.
    expect(billUpdates).toHaveLength(1);
    expect(billUpdates[0]["paidAmount"]).toBe("700.00");
    expect(billUpdates[0]["balanceAmount"]).toBe("0.00");
    expect(billUpdates[0]["status"]).toBe("paid");

    // No auto-refund: exactly one voucher (the receipt for the payment),
    // never a negative-amount / refund voucher.
    expect(voucherCalls).toHaveLength(1);
    expect(Number(voucherCalls[0]?.["amount"])).toBe(200);

    // The warn surfaces the flag for operations.
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[1] ?? "").includes("overpayment"),
      ),
    ).toBe(true);
  });

  test("partial bill overpay: excess = settled − outstanding (400 of 500 paid, gateway takes 250)", async () => {
    billRow = {
      id: 42,
      paidAmount: "400.00",
      totalAmount: "500.00",
      refundAmount: "0.00",
      balanceAmount: "100.00",
      billNumber: "0042",
      createdByName: "Desk Cashier",
      status: "partial",
    };
    await iciciWebhook(
      {
        body: signedIciciBody({
          merchantTxnNo: MERCHANT_REF,
          txnID: PROVIDER_TXN,
          amount: "250.00",
          txnStatus: "SUC",
        }),
      },
      makeRes(),
    );
    expect(insertedPayments[0]["amount"]).toBe("250.00");
    expect(String(insertedPayments[0]["notes"])).toContain("OVERPAYMENT");
    expect(insertedAudits).toHaveLength(1);
    const auditPayload = JSON.parse(
      String(insertedAudits[0]["newValue"]),
    ) as Record<string, unknown>;
    expect(auditPayload["excess"]).toBe(150);
    expect(billUpdates[0]["paidAmount"]).toBe("650.00");
  });

  test("REGRESSION (behaviour preserved): a normal within-outstanding settle writes NO audit row and NO marker", async () => {
    await iciciWebhook(
      {
        body: signedIciciBody({
          merchantTxnNo: MERCHANT_REF,
          txnID: PROVIDER_TXN,
          amount: "500.00",
          txnStatus: "SUC",
        }),
      },
      makeRes(),
    );
    expect(insertedPayments).toHaveLength(1);
    expect(insertedPayments[0]["amount"]).toBe("500.00");
    expect(String(insertedPayments[0]["notes"])).not.toContain("OVERPAYMENT");
    expect(insertedAudits).toHaveLength(0);
    expect(billUpdates).toHaveLength(1);
    expect(billUpdates[0]["paidAmount"]).toBe("500.00");
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[1] ?? "").includes("overpayment"),
      ),
    ).toBe(false);
  });

  test("idempotency guard still wins: an already-recorded payment settles nothing even if it overpaid", async () => {
    billRow = {
      id: 42,
      paidAmount: "500.00",
      totalAmount: "500.00",
      refundAmount: "0.00",
      balanceAmount: "0.00",
      billNumber: "0042",
      createdByName: "Desk Cashier",
      status: "paid",
    };
    existingPayments = [
      { id: 7, referenceNumber: MERCHANT_REF, gatewayTxnId: null },
    ];
    await iciciWebhook(
      {
        body: signedIciciBody({
          merchantTxnNo: MERCHANT_REF,
          txnID: PROVIDER_TXN,
          amount: "200.00",
          txnStatus: "SUC",
        }),
      },
      makeRes(),
    );
    expect(insertedPayments).toHaveLength(0);
    expect(insertedAudits).toHaveLength(0);
    expect(billUpdates).toHaveLength(0);
  });

  test("cancelled-bill refusal unchanged: no payment, no audit row, no voucher", async () => {
    billRow = {
      id: 42,
      paidAmount: "0.00",
      totalAmount: "500.00",
      refundAmount: "0.00",
      balanceAmount: "0.00",
      billNumber: "0042",
      createdByName: "Desk Cashier",
      status: "cancelled",
    };
    await iciciWebhook(
      {
        body: signedIciciBody({
          merchantTxnNo: MERCHANT_REF,
          txnID: PROVIDER_TXN,
          amount: "500.00",
          txnStatus: "SUC",
        }),
      },
      makeRes(),
    );
    expect(insertedPayments).toHaveLength(0);
    expect(insertedAudits).toHaveLength(0);
    expect(billUpdates).toHaveLength(0);
    expect(voucherCalls).toHaveLength(0);
  });
});

// ── 3. Source contracts — the other settle paths + books-sanity wiring ───────

describe("overpayment wiring (callback, poll, books-sanity) — source contracts", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(resolve(HERE, rel), "utf8");

  test("public-booking BILLPAY callback detects, flags in notes, and writes the audit row in-transaction", () => {
    const src = read("./public-booking.ts");
    const billPayIdx = src.indexOf('merchantTxnNo.startsWith("BILLPAY-")');
    const slice = src.slice(billPayIdx, billPayIdx + 12000);
    expect(slice).toContain("computeGatewayOverpayment");
    expect(slice).toContain("overpaymentNotesSuffix");
    expect(slice).toContain("recordOverpaymentAudit");
  });

  test("bill status-poll detects, flags in notes, and writes the audit row in-transaction", () => {
    const src = read("./bills.ts");
    const pollIdx = src.indexOf("gateway-payment-status/:txnRef");
    const slice = src.slice(pollIdx, pollIdx + 12000);
    expect(slice).toContain("computeGatewayOverpayment");
    expect(slice).toContain("overpaymentNotesSuffix");
    expect(slice).toContain("recordOverpaymentAudit");
  });

  test("books-sanity lists bills whose paid_amount exceeds the total as a high-severity anomaly", () => {
    const src = read("./books-sanity.ts");
    expect(src).toContain(
      "paid_amount::numeric > (b.total_amount::numeric + 0.01)",
    );
    expect(src).toContain("Overpayment: collected beyond the bill total");
    expect(src).toContain("overpayment_flagged");
  });

  test("settle paths never auto-refund an overpayment (no refund route call, negative voucher, or gateway void)", () => {
    const webhooks = read("./gateway-webhooks.ts");
    expect(webhooks).toContain("no auto-refund");
    expect(webhooks).not.toContain("/refund");
    const booking = read("./public-booking.ts");
    expect(booking).not.toContain("amount: -amount");
  });

  test("the overpayment flag is additive: no bills UPDATE beyond the existing settlement columns", () => {
    // The F3 wiring must not add new UPDATEs to bills beyond paid/balance/status.
    const src = read("./gateway-webhooks.ts");
    const settleIdx = src.indexOf("async function settleBill");
    const slice = src.slice(settleIdx, settleIdx + 9000);
    const updateCount = (slice.match(/\.update\(billsTable\)/g) ?? []).length;
    expect(updateCount).toBe(1);
  });
});
