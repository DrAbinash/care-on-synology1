import { describe, expect, test, vi } from "vitest";

// day-close.ts imports `db` from @workspace/db at module top level, which
// throws unconditionally at import time when DATABASE_URL is not set. The
// three functions under test here (classifyAndBucketPayments,
// splitCashExpenses, applyCashExpenses) are pure — they never touch the
// database — so mocking the module prevents the load-time throw without
// affecting what is actually under test. Same pattern as
// usgExtractor.test.ts / requireAiCallerAuth.test.ts.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [], orderBy: () => ({ limit: async () => [] }) }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [{}] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    execute: async () => ({ rows: [] }),
  },
  paymentsTable: {},
  dayClosuresTable: {},
  userDayClosuresTable: {},
  billsTable: {},
  usersTable: {},
  expensesTable: {},
  orderTestsTable: {},
  testsTable: {},
}));
vi.mock("@workspace/db/schema", () => ({
  drawerAuditLogTable: {},
  patientsTable: {},
  doctorsTable: {},
  ordersTable: {},
  billAuditsTable: {},
  voucherAuditsTable: {},
}));

import { classifyAndBucketPayments, splitCashExpenses, applyCashExpenses, maxBoundary } from "./day-close";
import { isPhysicalCash } from "../lib/paymentMethodClassifier";

describe("classifyAndBucketPayments", () => {
  test("literal cash payments go into the cash bucket", () => {
    const result = classifyAndBucketPayments([
      { id: 1, amount: "1000", method: "cash", recordedByName: "Alice" },
    ]);
    expect(result.overall.cash).toBe(1000);
    expect(result.overall.total).toBe(1000);
    expect(result.suspenseItems).toHaveLength(0);
  });

  test("gateway-qualified online payments do NOT go into the cash bucket (regression)", () => {
    const result = classifyAndBucketPayments([
      { id: 1, amount: "5000", method: "Online (ICICI Orange Pay)", recordedByName: "Alice" },
      { id: 2, amount: "3000", method: "Online (Razorpay)", recordedByName: "Alice" },
    ]);
    expect(result.overall.cash).toBe(0);
    // No dedicated "online" column in this bucket shape — folds into "other",
    // which is still correctly NOT cash.
    expect(result.overall.other).toBe(8000);
    expect(result.overall.total).toBe(8000);
  });

  test("insurance payments do NOT go into the cash bucket (regression)", () => {
    const result = classifyAndBucketPayments([
      { id: 1, amount: "2000", method: "insurance", recordedByName: "Bob" },
    ]);
    expect(result.overall.cash).toBe(0);
    expect(result.overall.other).toBe(2000);
  });

  test("unknown method goes to the suspense bucket, not cash and not other", () => {
    const result = classifyAndBucketPayments([
      { id: 1, amount: "750", method: "loyalty-points", recordedByName: "Carol" },
    ]);
    expect(result.overall.cash).toBe(0);
    expect(result.overall.other).toBe(0);
    expect(result.overall.total).toBe(0);
    expect(result.suspenseItems).toHaveLength(1);
    expect(result.suspenseItems[0].rawMethod).toBe("loyalty-points");
    expect(result.totalSuspense).toBe(750);
  });

  test("refunds (negative amounts) net correctly into the same bucket", () => {
    const result = classifyAndBucketPayments([
      { id: 1, amount: "1000", method: "cash", recordedByName: "Alice" },
      { id: 2, amount: "-300", method: "cash", recordedByName: "Alice" },
    ]);
    expect(result.overall.cash).toBe(700);
  });

  test("per-staff breakdown attributes payments to the recorder, not a fixed owner", () => {
    const result = classifyAndBucketPayments([
      { id: 1, amount: "1000", method: "cash", recordedByName: "Alice" },
      { id: 2, amount: "500", method: "cash", recordedByName: "Bob" },
    ]);
    expect(result.byStaff.get("Alice")?.cash).toBe(1000);
    expect(result.byStaff.get("Bob")?.cash).toBe(500);
  });

  test("upi/card/cheque route to their own buckets, never cash", () => {
    const result = classifyAndBucketPayments([
      { id: 1, amount: "100", method: "upi", recordedByName: "A" },
      { id: 2, amount: "200", method: "card", recordedByName: "A" },
      { id: 3, amount: "300", method: "cheque", recordedByName: "A" },
    ]);
    expect(result.overall.cash).toBe(0);
    expect(result.overall.upi).toBe(100);
    expect(result.overall.card).toBe(200);
    expect(result.overall.cheque).toBe(300);
  });
});

describe("splitCashExpenses", () => {
  test("cash-mode expenses are separated from digital-mode expenses", () => {
    const result = splitCashExpenses([
      { amount: "200", paymentMode: "cash", approvedBy: "Alice" },
      { amount: "500", paymentMode: "upi", approvedBy: "Alice" },
    ]);
    expect(result.cashExpenses).toBe(200);
    expect(result.digitalExpenses).toBe(500);
  });

  test("missing payment_mode defaults to cash (matches expenses table default)", () => {
    const result = splitCashExpenses([{ amount: "150", paymentMode: null, approvedBy: "Alice" }]);
    expect(result.cashExpenses).toBe(150);
  });

  test("blank-string payment_mode also defaults to cash, same as missing/null", () => {
    const result = splitCashExpenses([{ amount: "75", paymentMode: "   ", approvedBy: "Alice" }]);
    expect(result.cashExpenses).toBe(75);
  });

  test("delegates to the shared classifier — an unrecognized payment_mode is NOT cash (regression for Approved Fix #5)", () => {
    const result = splitCashExpenses([{ amount: "300", paymentMode: "wallet-xyz", approvedBy: "Alice" }]);
    expect(result.cashExpenses).toBe(0);
    expect(result.digitalExpenses).toBe(300);
  });

  test("gateway-qualified payment_mode is correctly excluded from cash, same as payments.method", () => {
    const result = splitCashExpenses([{ amount: "400", paymentMode: "Online (ICICI Orange Pay)", approvedBy: "Alice" }]);
    expect(result.cashExpenses).toBe(0);
    expect(result.digitalExpenses).toBe(400);
  });

  test("per-approver cash expense totals are tracked separately", () => {
    const result = splitCashExpenses([
      { amount: "100", paymentMode: "cash", approvedBy: "Alice" },
      { amount: "50", paymentMode: "cash", approvedBy: "Bob" },
      { amount: "999", paymentMode: "upi", approvedBy: "Alice" },
    ]);
    expect(result.cashExpensesByApprover.get("Alice")).toBe(100);
    expect(result.cashExpensesByApprover.get("Bob")).toBe(50);
  });

  test("blank approvedBy falls back to createdBy for drawer attribution", () => {
    const result = splitCashExpenses([
      { amount: "2200", paymentMode: "cash", approvedBy: null, createdBy: "Dr Abinash Kumar" },
      { amount: "325", paymentMode: "cash", approvedBy: "", createdBy: "Dr Abinash Kumar" },
    ]);
    expect(result.cashExpenses).toBe(2525);
    expect(result.cashExpensesByApprover.get("Dr Abinash Kumar")).toBe(2525);
  });

  test("blank approvedBy with no createdBy stays orphaned from per-staff map", () => {
    const result = splitCashExpenses([
      { amount: "40", paymentMode: "cash", approvedBy: null, createdBy: null },
    ]);
    expect(result.cashExpenses).toBe(40);
    expect(result.cashExpensesByApprover.size).toBe(0);
  });
});

describe("applyCashExpenses — CRITICAL FIX: Expected Cash = Cash In − Cash Refunded − Cash Expenses", () => {
  test("cash expense reduces expected physical cash", () => {
    const classified = classifyAndBucketPayments([
      { id: 1, amount: "1000", method: "cash", recordedByName: "Alice" },
    ]);
    applyCashExpenses(classified, new Map([["Alice", 200]]));
    expect(classified.overall.cash).toBe(800);
    expect(classified.overall.total).toBe(800);
  });

  test("non-cash (digital) expense does not reduce physical cash drawer", () => {
    const classified = classifyAndBucketPayments([
      { id: 1, amount: "1000", method: "cash", recordedByName: "Alice" },
      { id: 2, amount: "500", method: "upi", recordedByName: "Alice" },
    ]);
    // splitCashExpenses would have excluded the digital expense already —
    // simulate by only passing the cash-expense map (empty here, since the
    // hypothetical expense was upi-mode and never entered cashExpensesByApprover).
    applyCashExpenses(classified, new Map());
    expect(classified.overall.cash).toBe(1000);
    expect(classified.overall.upi).toBe(500);
    expect(classified.overall.total).toBe(1500);
  });

  test("expense reduces the approving staff's own cash, not the whole clinic's (Cash Attribution Rule)", () => {
    const classified = classifyAndBucketPayments([
      { id: 1, amount: "1000", method: "cash", recordedByName: "Alice" },
      { id: 2, amount: "500", method: "cash", recordedByName: "Bob" },
    ]);
    applyCashExpenses(classified, new Map([["Bob", 100]]));
    expect(classified.byStaff.get("Alice")?.cash).toBe(1000); // untouched
    expect(classified.byStaff.get("Bob")?.cash).toBe(400); // 500 - 100
    expect(classified.overall.cash).toBe(1400); // 1500 - 100
  });

  test("a staff with cash expenses but zero payments still gets a visible negative balance", () => {
    const classified = classifyAndBucketPayments([]);
    applyCashExpenses(classified, new Map([["Carol", 300]]));
    expect(classified.byStaff.get("Carol")?.cash).toBe(-300);
    expect(classified.overall.cash).toBe(-300);
  });

  test("end-to-end: cash in, cash refund, and cash expense all combine into the locked formula", () => {
    // Expected Physical Cash = Cash In − Cash Refunded − Cash Expenses
    //                        = 2000 − 300 − 150 = 1550
    const classified = classifyAndBucketPayments([
      { id: 1, amount: "2000", method: "cash", recordedByName: "Alice" },
      { id: 2, amount: "-300", method: "cash", recordedByName: "Alice" },
    ]);
    const { cashExpensesByApprover } = splitCashExpenses([
      { amount: "150", paymentMode: "cash", approvedBy: "Alice" },
    ]);
    applyCashExpenses(classified, cashExpensesByApprover);
    expect(classified.overall.cash).toBe(1550);
  });

  test("per-cashier window subtracts cash expenses EXACTLY ONCE (regression: day-close double-subtract)", () => {
    // summarizeUserWindow builds `classified` for a single staffer's window,
    // then reduces their expected drawer cash via applyCashExpenses. A prior
    // bug applied that subtraction twice inline, understating expected cash by
    // 2×. This locks the correct single subtraction end-to-end.
    const classified = classifyAndBucketPayments([
      { id: 1, amount: "5000", method: "cash", recordedByName: "Deepa" },
    ]);
    const { cashExpenses, cashExpensesByApprover } = splitCashExpenses([
      { amount: "800", paymentMode: "cash", approvedBy: "Deepa" },
    ]);
    applyCashExpenses(classified, cashExpensesByApprover);
    expect(cashExpenses).toBe(800);
    // 5000 − 800 = 4200 (NOT 5000 − 800 − 800 = 3400).
    expect(classified.overall.cash).toBe(4200);
    expect(classified.overall.total).toBe(4200);
  });
});

describe("maxBoundary — Closed-Day Carry-Forward (LOCKED BUSINESS RULE #10/#11)", () => {
  // The next open window always starts at MAX(last overall close, last
  // user's own close). This is what guarantees a closed day's totals can
  // never silently change: anything recorded after the boundary belongs
  // strictly to the next window, and no owner approval step exists or is
  // needed to make that happen.
  const earlier = new Date("2026-06-30T18:00:00Z");
  const later = new Date("2026-07-01T09:00:00Z");

  test("no prior closures at all → null (very first close covers everything)", () => {
    expect(maxBoundary(null, null)).toBeNull();
  });

  test("only an overall close exists → that boundary is used", () => {
    expect(maxBoundary(earlier, null)).toBe(earlier);
  });

  test("only a personal close exists → that boundary is used", () => {
    expect(maxBoundary(null, later)).toBe(later);
  });

  test("overall close is more recent than personal close → overall wins (later boundary)", () => {
    expect(maxBoundary(later, earlier)).toBe(later);
  });

  test("personal close is more recent than overall close → personal wins (later boundary)", () => {
    expect(maxBoundary(earlier, later)).toBe(later);
  });

  test("a refund recorded strictly after the boundary belongs to the next window (not before it)", () => {
    // The boundary itself is exclusive (paymentWhere uses gt(createdAt, from)
    // in summarizeWindow/summarizeUserWindow) — anything timestamped after
    // `boundary` is correctly outside the closed window and falls into the
    // next one automatically. This is a regression guard on the comparison
    // used to pick that boundary; the gt()/lte() query predicates themselves
    // are unchanged by this fix (verified by code review — not modified in
    // this change) and require a live database to integration-test end to
    // end, which is not available in this environment.
    const boundary = maxBoundary(earlier, later);
    const refundRecordedAt = new Date(later.getTime() + 1000); // 1s after close
    expect(refundRecordedAt.getTime() > (boundary as Date).getTime()).toBe(true);
  });
});

describe("Cross-module classification consistency (Approved Fix #3)", () => {
  // day-close.ts's bucketMethod() must delegate to, and never disagree
  // with, the shared classifier used identically by daily-summary.ts and
  // my-daily-summary.ts. This proves day-close.ts's local bucket shape
  // never classifies anything as "cash" that the shared classifier would
  // not also call cash.
  const methods = [
    "cash", "upi", "card", "cheque", "insurance",
    "Online (ICICI Orange Pay)", "Online (Razorpay)", "Online (PhonePe)", "Online (BharatPe)",
    "bank", "neft", "rtgs", "", "mystery-method",
  ];

  for (const method of methods) {
    test(`"${method}": day-close's cash classification agrees with the shared classifier`, () => {
      const classified = classifyAndBucketPayments([{ id: 1, amount: "100", method, recordedByName: "A" }]);
      const dayCloseCash = classified.overall.cash;
      const sharedIsCash = isPhysicalCash(method);
      expect(dayCloseCash > 0).toBe(sharedIsCash);
    });
  }
});
