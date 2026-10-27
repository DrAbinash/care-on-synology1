import { describe, expect, test, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Corridor audit F4a — misleading receipt-verification messages.
//
// Root cause under test: GET /api/verify/bill/:billNumber rendered
// "❌ SECURITY BREACH" for EVERY non-matching scan, including (a) a URL with
// no ?hash= at all (hand-typed/truncated link) and (b) a genuine receipt
// printed before the clinic audited an edit to the bill (discount
// correction, waived due, super-admin amount fix) — telling a patient
// holding honest paper that the clinic had been tampered with.
//
// The fix distinguishes three honest outcomes without touching the hash
// itself (historical receipts keep verifying — pinned by the golden-hash
// test at the bottom):
//   missing hash            -> "Cannot verify" (inconclusive, warn tone)
//   mismatch + audit edit   -> "Outdated receipt" (clinic edited after print)
//   mismatch + no such edit -> "Verification failed" (no breach language)

let billRow: Record<string, unknown> | null;
let patientRow: Record<string, unknown> | null;
let clinicRow: Record<string, unknown> | null;
let stalenessRows: Array<Record<string, unknown>>;
let billUpdates: Array<Record<string, unknown>>;

import { getTableName } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nameOf(t: any): string {
  try {
    return t?.__name || getTableName(t);
  } catch {
    return "";
  }
}

vi.mock("@workspace/db", () => {
  // Drizzle builders are thenables; production awaits them directly
  // (`.where(cond)`, bare `.limit(1)`) and via `.leftJoin().where()`.
  // The bill_audits chain applies the same changeType filter the route's
  // inArray() encodes — this list IS the spec for "which audited edits make
  // an older receipt stale"; adding "reprint" here (or in verify.ts) would
  // make the reprint-regression test below fail, which is the point.
  const STALENESS = new Set([
    "discount",
    "subtotal",
    "taxAmount",
    "totalAmount",
    "balance_waived",
    "test_swapped",
    "test-cancelled",
    "tests-cancelled",
    "tests_cancelled_cascade",
  ]);
  const rowsFor = (name: string) => {
    if (name === "bills") return billRow ? [billRow] : [];
    if (name === "patients") return patientRow ? [patientRow] : [];
    if (name === "clinic_settings") return clinicRow ? [clinicRow] : [];
    if (name === "order_tests") return [];
    if (name === "bill_audits")
      return stalenessRows.filter((r) => STALENESS.has(String(r.changeType)));
    return [];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chainFor = (table: unknown): any => {
    const name = nameOf(table);
    const rows = async () => rowsFor(name);
    const thenable: Record<string, unknown> = {
      limit: rows,
      orderBy: () => ({ limit: rows }),
      for: () => ({ limit: rows }),
      then: (
        onFulfilled: (v: unknown) => unknown,
        onRejected: (e: unknown) => unknown,
      ) => Promise.resolve().then(rows).then(onFulfilled, onRejected),
    };
    return {
      where: () => thenable,
      leftJoin: () => ({ where: () => thenable }),
      ...thenable,
    };
  };
  return {
    db: {
      select: (_fields?: Record<string, unknown>) => ({
        from: (t: unknown) => chainFor(t),
      }),
      insert: () => ({ values: async () => [] }),
      update: (t: unknown) => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            if (nameOf(t) === "bills") billUpdates.push(vals);
            return [];
          },
        }),
      }),
    },
    billsTable: {
      __name: "bills",
      id: "id",
      billNumber: "bill_number",
      status: "status",
      patientId: "patient_id",
      orderId: "order_id",
      qrScanCount: "qr_scan_count",
    },
    patientsTable: {
      __name: "patients",
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
      patientId: "patient_id",
    },
    clinicSettingsTable: { __name: "clinic_settings", id: "id", name: "name" },
    orderTestsTable: {
      __name: "order_tests",
      orderId: "order_id",
      testId: "test_id",
    },
    testsTable: { __name: "tests", id: "id" },
    billAuditsTable: {
      __name: "bill_audits",
      billId: "bill_id",
      changeType: "change_type",
      id: "id",
    },
  };
});

import { verifyRouter } from "./verify";
import { buildBillAuditHash } from "../lib/billAuditHash";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(router: any, path: string, method: "get") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const verifyHandler = getHandler(verifyRouter, "/bill/:billNumber", "get");

// The fixture whose golden hash was computed with the ORIGINAL FNV-1a
// implementation before this change (node --experimental-strip-types) —
// if this ever changes, every historical printed receipt stops verifying.
const FIXTURE = {
  billNumber: "BILL-2026-0042",
  createdAt: "2026-03-15T09:30:00.000Z",
  totalAmount: 4899.5,
  operatorId: "Priya Sharma",
};

function makeReq(hash: string | undefined) {
  return {
    params: { billNumber: FIXTURE.billNumber },
    query: hash === undefined ? {} : { hash },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRes(): any {
  const res: Record<string, unknown> = {
    statusCode: 200,
    sent: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    send(body: unknown) {
      this.sent = body;
      return this;
    },
    json(payload: unknown) {
      this.sent = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  billRow = {
    id: 42,
    billNumber: FIXTURE.billNumber,
    totalAmount: String(FIXTURE.totalAmount),
    paidAmount: "4899.50",
    balanceAmount: "0.00",
    status: "paid",
    createdAt: FIXTURE.createdAt,
    createdByName: FIXTURE.operatorId,
    cancelledAt: null,
    orderId: 3,
    patientId: 7,
    qrScanCount: 2,
    receiptVerificationCount: 2,
    pdfDownloadCount: 0,
  };
  patientRow = {
    id: 7,
    firstName: "Ravi",
    lastName: "Kumar",
    patientId: "P-0007",
    dateOfBirth: null,
    createdAt: "2025-01-01T00:00:00Z",
  };
  clinicRow = { id: 1, name: "Care Diagnostics", logoDataUrl: null };
  stalenessRows = [];
  billUpdates = [];
});

describe("GET /api/verify/bill/:billNumber — matched hash (regression)", () => {
  test("a genuine receipt still verifies green and increments analytics once", async () => {
    const res = makeRes();
    await verifyHandler(makeReq(buildBillAuditHash(FIXTURE)), res);
    expect(res.statusCode).toBe(200);
    const html = res.sent as string;
    expect(html).toContain("VERIFIED GENUINE RECEIPT");
    expect(billUpdates).toHaveLength(1);
    expect(billUpdates[0]["qrScanCount"]).toBe(3);
    expect(billUpdates[0]["receiptVerificationCount"]).toBe(3);
  });
});

describe("missing hash is inconclusive, not a breach (corridor audit F4a)", () => {
  test("no ?hash= renders the Cannot-verify page with the honest explanation", async () => {
    const res = makeRes();
    await verifyHandler(makeReq(undefined), res);
    expect(res.statusCode).toBe(400);
    const html = res.sent as string;
    expect(html).toContain("Cannot verify");
    expect(html).toContain("No integrity code on this scan");
    expect(html).toContain(FIXTURE.billNumber);
    expect(html).not.toContain("SECURITY BREACH");
  });

  test("a missing hash never increments verification analytics", async () => {
    await verifyHandler(makeReq(undefined), makeRes());
    expect(billUpdates).toHaveLength(0);
  });
});

describe("mismatch with an audited post-print edit is an outdated receipt (F4a)", () => {
  test.each([
    ["discount", "a discount correction"],
    ["balance_waived", "a waived due"],
    ["totalAmount", "a super-admin amount fix"],
    ["test_swapped", "a test swap"],
    ["tests_cancelled_cascade", "a cancelled test"],
  ])("%s renders the Outdated-receipt page", async (changeType) => {
    stalenessRows = [{ id: 9, changeType }];
    const res = makeRes();
    await verifyHandler(makeReq("DEADBEEF"), res);
    expect(res.statusCode).toBe(400);
    const html = res.sent as string;
    expect(html).toContain("Outdated receipt");
    expect(html).toContain("out of date");
    expect(html).toContain(FIXTURE.billNumber);
    expect(html).not.toContain("SECURITY BREACH");
    expect(html).not.toContain("Cannot verify");
  });

  test("analytics are not incremented for an outdated receipt", async () => {
    stalenessRows = [{ id: 9, changeType: "discount" }];
    await verifyHandler(makeReq("DEADBEEF"), makeRes());
    expect(billUpdates).toHaveLength(0);
  });
});

describe("mismatch with no financial edit is a plain verification failure (F4a)", () => {
  test("no audit rows at all renders the failure page without breach language", async () => {
    const res = makeRes();
    await verifyHandler(makeReq("DEADBEEF"), res);
    expect(res.statusCode).toBe(400);
    const html = res.sent as string;
    expect(html).toContain("Verification failed");
    expect(html).toContain("does not match our records");
    // The clinic-facing diagnostic codes remain, for desk comparison.
    expect(html).toContain("DEADBEEF");
    expect(html).not.toContain("SECURITY BREACH");
  });

  test.each([
    ["reprint", "a reprint never changes the hashed payload"],
    ["payment_collected", "a later payment never changes the hashed payload"],
    ["refund_processed", "a refund never changes the hashed payload"],
    ["due_date", "a due-date change never changes the hashed payload"],
  ])("%s must NOT read as an outdated receipt — %s", async (changeType) => {
    stalenessRows = [{ id: 9, changeType }];
    const res = makeRes();
    await verifyHandler(makeReq("DEADBEEF"), res);
    const html = res.sent as string;
    expect(html).not.toContain("Outdated receipt");
    expect(html).toContain("Verification failed");
  });
});

describe("unknown bills are unchanged (regression)", () => {
  test("a bill number that does not exist still renders Not Found", async () => {
    billRow = null;
    const res = makeRes();
    await verifyHandler(makeReq("DEADBEEF"), res);
    expect(res.statusCode).toBe(404);
    expect(res.sent as string).toContain("could not be verified");
  });
});

describe("the hash itself is untouched (historical receipts keep verifying)", () => {
  test("GOLDEN: the fixture still hashes to the pre-change FNV-1a value 9C83C896", () => {
    // Computed with the original implementation before this PR. If this
    // assertion fails, the QR payload/format changed and every receipt
    // already in patients' hands stops verifying — that is F4b territory
    // (deferred), never a side effect of F4a.
    expect(buildBillAuditHash(FIXTURE)).toBe("9C83C896");
  });

  test("a second historical fixture (old bill-number format) is also stable", () => {
    expect(
      buildBillAuditHash({
        billNumber: "0042",
        createdAt: "2026-01-01T10:00:00.000Z",
        totalAmount: 500,
        operatorId: "Op",
      }),
    ).toBe("2C4418B6");
  });
});

// ── Source contracts ────────────────────────────────────────────────────────

describe("verify.ts source contracts", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "verify.ts"), "utf8");

  test("the words SECURITY BREACH are gone from every outcome", () => {
    expect(src).not.toContain("SECURITY BREACH");
  });

  test("the three outcomes are wired to their distinct renderers", () => {
    expect(src).toContain("renderInconclusive");
    expect(src).toContain("renderOutdated");
    expect(src).toContain("renderTampered");
    expect(src.match(/renderInconclusive\(/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(src.match(/renderOutdated\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("the missing-hash branch runs before analytics, so it can never count", () => {
    const missingIdx = src.indexOf("if (!printedHash)");
    const analyticsIdx = src.indexOf("qrScanCount: (billRow.qrScanCount");
    expect(missingIdx).toBeGreaterThan(-1);
    expect(analyticsIdx).toBeGreaterThan(missingIdx);
  });

  test("the staleness probe reads bill_audits before choosing the message", () => {
    const mismatchIdx = src.indexOf("if (!hashMatches) {");
    const probeIdx = src.indexOf(
      "inArray(billAuditsTable.changeType",
      mismatchIdx,
    );
    const tamperedIdx = src.indexOf(
      'res.status(400).type("text/html").send(renderTampered',
      mismatchIdx,
    );
    expect(mismatchIdx).toBeGreaterThan(-1);
    expect(probeIdx).toBeGreaterThan(mismatchIdx);
    expect(tamperedIdx).toBeGreaterThan(probeIdx);
  });
});
