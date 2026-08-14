import { describe, expect, test, vi, beforeEach } from "vitest";

// F1 — duplicate-payment reconciliation: suspects report + reversible
// supersession. Financial records are NEVER deleted: the duplicate is marked
// superseded in favor of the survivor, the bill's paid/balance is restored,
// and a reversal voucher is posted through the existing auto-voucher engine.
// Router-stack technique; REAL handlers, mocked db.

let paymentsById: Map<number, Record<string, unknown>>;
let billRow: Record<string, unknown> | null;
let executeRows: Array<Record<string, unknown>>;
let paymentUpdates: Array<Record<string, unknown>>;
let billUpdates: Array<Record<string, unknown>>;
let voucherCalls: Array<Record<string, unknown>>;
let auditCalls: Array<Record<string, unknown>>;
let selectSeq: number[];

vi.mock("@workspace/db", () => {
  const dbLike = {
    select: () => ({
      from: (table: { __name?: string }) => {
        const rows = async () => {
          if (table.__name === "payments") {
            const id = selectSeq.shift();
            const row = id != null ? paymentsById.get(id) : undefined;
            return row ? [row] : [];
          }
          if (table.__name === "bills") return billRow ? [billRow] : [];
          return [];
        };
        const tail: Record<string, unknown> = { limit: rows };
        tail["for"] = () => ({ limit: rows });
        return { where: () => tail, ...tail };
      },
    }),
    update: (table: { __name?: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (table.__name === "payments") paymentUpdates.push(vals);
          if (table.__name === "bills") billUpdates.push(vals);
          return [];
        },
      }),
    }),
    insert: () => ({ values: () => Promise.resolve([]) }),
  };
  return {
    db: {
      ...dbLike,
      transaction: async (cb: (tx: typeof dbLike) => Promise<unknown>) => cb(dbLike),
      execute: async () => ({ rows: executeRows }),
    },
    billsTable: { __name: "bills", id: "id" },
    paymentsTable: { __name: "payments", id: "id" },
    patientsTable: { __name: "patients" },
  };
});

vi.mock("@workspace/db/schema", () => ({
  accountsTable: { __name: "accounts" },
  vouchersTable: { __name: "vouchers" },
  voucherAuditsTable: { __name: "voucher_audits" },
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({ geminiParseBankStatement: vi.fn() }));
vi.mock("../lib/ocr/localDocumentOcr", () => ({ parseBankStatementLocal: vi.fn() }));
vi.mock("../lib/accounting/reportBuilders", () => ({
  buildTrialBalance: vi.fn(), buildProfitLoss: vi.fn(), buildBalanceSheet: vi.fn(),
}));
vi.mock("../lib/audit", () => ({
  auditFromRequest: vi.fn(async (_r: unknown, payload: Record<string, unknown>) => { auditCalls.push(payload); }),
}));
vi.mock("../lib/auto-voucher", () => ({
  autoVoucherForPayment: vi.fn(async (opts: Record<string, unknown>) => { voucherCalls.push(opts); }),
}));
vi.mock("../middleware/requireStaffAuth", () => ({
  requireAdminRole: Object.assign((_r: unknown, _s: unknown, next: () => void) => next(), { __adminGate: true }),
}));

import accountingRouter from "./accounting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLayer(method: "get" | "post", path: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (accountingRouter as any).stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200, body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function makeReq(params: Record<string, string>, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  return {
    params, body, query, headers: {},
    staffSession: { subjectId: 1, subjectName: "Dr Abinash", role: "super_admin", permissions: [] },
    log: { error: vi.fn() },
  };
}

const suspectsLayer = getLayer("get", "/duplicate-payment-suspects");
const supersedeLayer = getLayer("post", "/payments/:id/supersede");
const suspectsHandler = suspectsLayer.route.stack[suspectsLayer.route.stack.length - 1].handle;
const supersedeHandler = supersedeLayer.route.stack[supersedeLayer.route.stack.length - 1].handle;

const DUP = { id: 90, billId: 42, amount: "500.00", method: "Online (ICICI Orange Pay)", settlementStatus: "captured", supersededBy: null };
const SURVIVOR = { id: 89, billId: 42, amount: "500.00", method: "Online (ICICI Orange Pay)", settlementStatus: "captured", supersededBy: null };

beforeEach(() => {
  paymentsById = new Map([[90, { ...DUP }], [89, { ...SURVIVOR }]]);
  billRow = { id: 42, billNumber: "0042", paidAmount: "1000.00", totalAmount: "500.00", refundAmount: "0.00" };
  executeRows = [];
  paymentUpdates = [];
  billUpdates = [];
  voucherCalls = [];
  auditCalls = [];
  selectSeq = [90, 89]; // handler loads duplicate first, then survivor
});

describe("authorization", () => {
  test("both reconciliation routes carry the admin gate", () => {
    for (const layer of [suspectsLayer, supersedeLayer]) {
      expect(layer.route.stack[0].handle.__adminGate).toBe(true);
    }
  });
});

describe("GET /accounting/duplicate-payment-suspects", () => {
  test("returns the report rows (read-only)", async () => {
    executeRows = [{ bill_id: 42, payment_a: 89, payment_b: 90, amount: "500.00" }];
    const res = makeRes();
    await suspectsHandler(makeReq({}, {}, {}), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.suspects).toHaveLength(1);
    expect(paymentUpdates).toHaveLength(0);
  });
});

describe("POST /accounting/payments/:id/supersede", () => {
  test("marks the duplicate superseded, restores the bill, posts a REVERSAL voucher, audits with reason — deletes nothing", async () => {
    const res = makeRes();
    await supersedeHandler(makeReq({ id: "90" }, { duplicateOfPaymentId: 89, reason: "webhook+callback double post" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, supersededPaymentId: 90, survivingPaymentId: 89 });
    // Supersession, not deletion:
    expect(paymentUpdates).toHaveLength(1);
    expect(paymentUpdates[0]).toMatchObject({ settlementStatus: "superseded", supersededBy: 89 });
    // Bill restored: 1000 − 500 = 500 paid → balance 0 (total 500) → still 'paid'
    expect(billUpdates[0]["paidAmount"]).toBe("500.00");
    expect(billUpdates[0]["balanceAmount"]).toBe("0.00");
    // Reversal voucher through the EXISTING engine, negative amount:
    expect(voucherCalls).toHaveLength(1);
    expect(voucherCalls[0]["amount"]).toBe(-500);
    expect(voucherCalls[0]["billNumber"]).toBe("0042");
    // Audited with the mandatory reason:
    expect(auditCalls[0]).toMatchObject({ action: "void", entityType: "payment", entityId: "90", reason: "webhook+callback double post" });
  });

  test("guards: self-supersede, cross-bill, amount mismatch, already-superseded, non-online — all rejected without side effects", async () => {
    const cases: Array<{ params?: Record<string, string>; body?: Record<string, unknown>; mutate?: () => void; expectStatus: number }> = [
      { body: { duplicateOfPaymentId: 90, reason: "self supersede" }, expectStatus: 400 },
      { mutate: () => { paymentsById.get(89)!["billId"] = 43; }, expectStatus: 409 },
      { mutate: () => { paymentsById.get(89)!["amount"] = "400.00"; }, expectStatus: 409 },
      { mutate: () => { paymentsById.get(90)!["settlementStatus"] = "superseded"; }, expectStatus: 409 },
      { mutate: () => { paymentsById.get(90)!["method"] = "cash"; }, expectStatus: 409 },
      { body: { duplicateOfPaymentId: 89, reason: "hi" }, expectStatus: 400 }, // reason too short
    ];
    for (const c of cases) {
      paymentsById = new Map([[90, { ...DUP }], [89, { ...SURVIVOR }]]);
      selectSeq = [90, 89];
      c.mutate?.();
      const res = makeRes();
      await supersedeHandler(makeReq(c.params ?? { id: "90" }, c.body ?? { duplicateOfPaymentId: 89, reason: "valid reason here" }), res);
      expect(res.statusCode).toBe(c.expectStatus);
    }
    expect(paymentUpdates).toHaveLength(0);
    expect(voucherCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });
});
