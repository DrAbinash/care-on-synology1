import { describe, expect, test, vi, beforeEach } from "vitest";

// F2 — sync-billing backfill hardening.
//
// Proves the dedup that stops the desk-payment doubling and the prepay
// double-voucher: sync skips payments already vouchered (by payment_id OR by
// an amount-matched legacy receipt voucher on the same bill), skips refunds
// and F1-superseded payments, dry-runs without writing, and links what it
// does create via payment_id. Router-stack technique, mocked db.

let accountsRows: Array<Record<string, unknown>>;
let paymentJoinRows: Array<Record<string, unknown>>;
let voucherRows: Array<Record<string, unknown>>;
let monthCountRows: Array<Record<string, unknown>>;
let insertedVouchers: Array<Record<string, unknown>>;
let auditCalls: Array<Record<string, unknown>>;

vi.mock("@workspace/db", () => {
  const dbLike = {
    select: (proj?: Record<string, unknown>) => ({
      from: (table: { __name?: string }) => {
        // vouchers month-count query uses .where(like(...)) then awaits
        const monthCount = { then: (r: (v: unknown) => void) => r(monthCountRows) };
        const chain: Record<string, unknown> = {
          leftJoin: () => ({ orderBy: async () => paymentJoinRows }),
          orderBy: async () => paymentJoinRows,
          where: () => monthCount,
          then: (r: (v: unknown) => void) => {
            if (table.__name === "accounts") return r(accountsRows);
            if (table.__name === "vouchers") return r(voucherRows);
            return r([]);
          },
        };
        return chain;
      },
    }),
    insert: (table: { __name?: string }) => ({
      values: (vals: Record<string, unknown>) => {
        if (table.__name === "vouchers") insertedVouchers.push(vals);
        return Promise.resolve([]);
      },
    }),
    execute: async () => ({ rows: [] }),
  };
  return {
    db: dbLike,
    billsTable: { __name: "bills", id: "id" },
    paymentsTable: { __name: "payments", id: "id", billId: "bill_id" },
    patientsTable: { __name: "patients" },
  };
});

vi.mock("@workspace/db/schema", () => ({
  accountsTable: { __name: "accounts" },
  vouchersTable: { __name: "vouchers", voucherNumber: "voucher_number", paymentId: "payment_id", billId: "bill_id", amount: "amount", type: "type", reference: "reference" },
  voucherAuditsTable: { __name: "voucher_audits" },
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({ geminiParseBankStatement: vi.fn() }));
vi.mock("../lib/ocr/localDocumentOcr", () => ({ parseBankStatementLocal: vi.fn() }));
vi.mock("../lib/accounting/reportBuilders", () => ({ buildTrialBalance: vi.fn(), buildProfitLoss: vi.fn(), buildBalanceSheet: vi.fn() }));
vi.mock("../lib/auto-voucher", () => ({
  autoVoucherForPayment: vi.fn(),
  resolveMethodAccount: (method: string) => {
    const m = (method || "").toLowerCase();
    if (m === "cash" || !m) return { name: "Cash in Hand", type: "cash", tallyGroup: "Cash-in-Hand" };
    if (m.includes("online") || m === "upi" || m === "card") return { name: "Online Collections", type: "bank", tallyGroup: "Bank Accounts" };
    if (m === "insurance") return { name: "Insurance Collections", type: "bank", tallyGroup: "Bank Accounts" };
    return { name: "Unclassified Collections (Needs Review)", type: "bank", tallyGroup: "Bank Accounts" };
  },
  ensureAccount: async (name: string) => {
    if (name.includes("Cash")) return "1";
    if (name.includes("Insurance")) return "4";
    if (name.includes("Unclassified")) return "5";
    return "2";
  },
}));
vi.mock("../lib/audit", () => ({ auditFromRequest: vi.fn(async (_r: unknown, p: Record<string, unknown>) => { auditCalls.push(p); }) }));
vi.mock("../middleware/requireStaffAuth", () => ({
  requireAdminRole: Object.assign((_r: unknown, _s: unknown, next: () => void) => next(), { __adminGate: true }),
}));
vi.mock("../lib/istDate", () => ({ todayIST: () => "2026-07-23", dateToISTString: (d: unknown) => String(d).slice(0, 10) }));

import accountingRouter from "./accounting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLayer(path: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (accountingRouter as any).stack.find((l: any) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`POST ${path} not found`);
  return layer;
}
function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  return res;
}
function makeReq(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  return { body, query, headers: {}, staffSession: { subjectId: 1, subjectName: "Dr Abinash", role: "super_admin", permissions: [] }, log: { error: vi.fn() } };
}

const layer = getLayer("/sync-billing");
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

beforeEach(() => {
  accountsRows = [
    { id: 1, type: "cash", tallyGroup: "Cash-in-Hand" },
    { id: 2, type: "bank", tallyGroup: "Bank Accounts" },
    { id: 3, type: "income", tallyGroup: "Direct Income" },
  ];
  paymentJoinRows = [];
  voucherRows = [];
  monthCountRows = [];
  insertedVouchers = [];
  auditCalls = [];
});

const pay = (o: Partial<{ id: number; billId: number; amount: string; method: string; settlementStatus: string; createdAt: string }>) => ({
  p: { id: 1, billId: 10, amount: "500.00", method: "cash", settlementStatus: null, createdAt: "2026-07-05T06:30:00Z", ...o },
  b: { billNumber: "0042" },
});

describe("admin gate", () => {
  test("sync-billing carries the admin gate", () => {
    expect(layer.route.stack[0].handle.__adminGate).toBe(true);
  });
});

describe("dedup", () => {
  test("skips a payment already vouchered by payment_id", async () => {
    paymentJoinRows = [pay({ id: 7 })];
    voucherRows = [{ paymentId: 7, billId: 10, amount: "500.00", type: "receipt" }];
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.created).toBe(0);
    expect(insertedVouchers).toHaveLength(0);
  });

  test("skips a payment covered by a legacy amount-matched receipt voucher (payment_id NULL)", async () => {
    paymentJoinRows = [pay({ id: 8, amount: "750.00" })];
    voucherRows = [{ paymentId: null, billId: 10, amount: "750.00", type: "receipt" }];
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.created).toBe(0);
    expect(insertedVouchers).toHaveLength(0);
  });

  test("two same-amount payments consume two legacy vouchers (count-based), not one", async () => {
    paymentJoinRows = [pay({ id: 8, amount: "300.00" }), pay({ id: 9, amount: "300.00" })];
    voucherRows = [
      { paymentId: null, billId: 10, amount: "300.00", type: "receipt" },
      { paymentId: null, billId: 10, amount: "300.00", type: "receipt" },
    ];
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.created).toBe(0);
  });

  // Regression for the false-negative this dedup previously had: a
  // payment_id-LINKED voucher was ALSO counted into the legacy amount-pool, so
  // it could consume the pool slot meant for a DIFFERENT, genuinely unvouchered
  // sibling payment on the same bill — split/equal-instalment payments are
  // exactly this shape. One payment (id 20) already has a linked voucher; a
  // second same-bill, same-amount payment (id 21) does not and must still be
  // created, not silently swallowed by the first payment's own linked voucher.
  test("a payment_id-linked voucher does not shadow a different unvouchered sibling payment", async () => {
    paymentJoinRows = [pay({ id: 20, amount: "500.00" }), pay({ id: 21, amount: "500.00" })];
    voucherRows = [{ paymentId: 20, billId: 10, amount: "500.00", type: "receipt" }];
    monthCountRows = [];
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.created).toBe(1);
    expect(insertedVouchers).toHaveLength(1);
    expect(insertedVouchers[0]).toMatchObject({ paymentId: 21, billId: 10 });
  });

  test("creates a voucher for an uncovered payment, linked by payment_id and IST-dated", async () => {
    paymentJoinRows = [pay({ id: 11, amount: "999.00", method: "upi", createdAt: "2026-07-05T20:00:00Z" })];
    voucherRows = [];
    monthCountRows = [{ id: 1 }]; // one existing RV this month → next seq 2
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.created).toBe(1);
    expect(insertedVouchers).toHaveLength(1);
    expect(insertedVouchers[0]).toMatchObject({ paymentId: 11, type: "receipt", reference: "0042", date: "2026-07-05" });
    expect(insertedVouchers[0]["debitAccountId"]).toBe("2"); // upi → bank account
    expect(auditCalls).toHaveLength(1);
  });
});

describe("scope", () => {
  test("skips refund/reversal (non-positive) payments", async () => {
    paymentJoinRows = [pay({ id: 12, amount: "-200.00" }), pay({ id: 13, amount: "0.00" })];
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.created).toBe(0);
    expect(insertedVouchers).toHaveLength(0);
  });

  test("skips F1-superseded payments", async () => {
    paymentJoinRows = [pay({ id: 14, settlementStatus: "superseded" })];
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.created).toBe(0);
  });
});

describe("dry run", () => {
  test("dryRun reports what would be created and writes nothing", async () => {
    paymentJoinRows = [pay({ id: 15 }), pay({ id: 16, billId: 11 })];
    voucherRows = [];
    const res = makeRes();
    await handler(makeReq({ dryRun: true }), res);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.wouldCreate).toBe(2);
    expect(insertedVouchers).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });
});
