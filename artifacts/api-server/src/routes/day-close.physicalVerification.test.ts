import { describe, expect, it, vi } from "vitest";

// Same constraint `day-close.varianceSign.test.ts` documents: day-close.ts pulls
// `db` from @workspace/db at module scope, which throws at import time without
// DATABASE_URL. Everything under test here is pure (a status decision and two
// request schemas), so the mock exists only to let the module load.
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

import {
  BulkStaffCloseBody,
  DRAWER_STATUS_NOT_VERIFIED,
  UserCloseBody,
  staffCloseAuditAction,
  staffDrawerStatus,
} from "./day-close";

/**
 * A drawer that nobody counted must not record as Balanced.
 *
 * Both close forms pre-fill every actual from the system's own expected totals, so
 * an untouched submit produces variance 0 — indistinguishable on paper from a
 * perfect count. Measured on the live clinic 2026-10-13: twelve consecutive staff
 * closes, all `variance 0.00`, empty `variance_note`, `denominations IS NULL`.
 */
describe("staffDrawerStatus — zero variance is not a verification", () => {
  it("records an un-counted drawer as not physically verified", () => {
    expect(
      staffDrawerStatus({ variance: 0, physicallyCounted: false, denominationsEntered: false }),
    ).toBe(DRAWER_STATUS_NOT_VERIFIED);
  });

  it("earns Balanced only when someone says they counted", () => {
    expect(
      staffDrawerStatus({ variance: 0, physicallyCounted: true, denominationsEntered: false }),
    ).toBe("balanced");
  });

  it("treats note-by-note counts as a physical count without a second tick", () => {
    expect(
      staffDrawerStatus({ variance: 0, physicallyCounted: false, denominationsEntered: true }),
    ).toBe("balanced");
  });

  it("calls money that is not right a mismatch whatever was asserted about it", () => {
    // A shortage must never be softened into "Not Physically Verified": the
    // drawer is demonstrably wrong, and that needs an admin, not a footnote.
    for (const physicallyCounted of [true, false]) {
      for (const denominationsEntered of [true, false]) {
        expect(
          staffDrawerStatus({ variance: -500, physicallyCounted, denominationsEntered }),
        ).toBe("mismatch");
        expect(
          staffDrawerStatus({ variance: 250, physicallyCounted, denominationsEntered }),
        ).toBe("mismatch");
      }
    }
  });

  it("names the three outcomes it can produce, so a screen cannot fall through", () => {
    // MyDailySummary / DayClose look the status up in a config map with an
    // `?? open` fallback. A fourth value would silently read as an open drawer.
    const seen = new Set<string>();
    for (const variance of [0, -1, 1]) {
      for (const physicallyCounted of [true, false]) {
        for (const denominationsEntered of [true, false]) {
          seen.add(staffDrawerStatus({ variance, physicallyCounted, denominationsEntered }));
        }
      }
    }
    expect([...seen].sort()).toEqual(
      [DRAWER_STATUS_NOT_VERIFIED, "balanced", "mismatch"].sort(),
    );
  });

  // The row-for-row twin of `predictedCloseLabel agrees with the server` in
  // artifacts/diagnostic-erp/src/lib/dayCloseVocabulary.test.ts. The screen tells
  // the cashier what the close will record; if these two tables ever disagree, the
  // form promises one thing and the row stores another.
  const TRUTH: Array<[number, boolean, boolean, string]> = [
    [0, false, false, DRAWER_STATUS_NOT_VERIFIED],
    [0, true, false, "balanced"],
    [0, false, true, "balanced"],
    [0, true, true, "balanced"],
    [-500, false, false, "mismatch"],
    [-500, true, false, "mismatch"],
    [-500, false, true, "mismatch"],
    [-500, true, true, "mismatch"],
    [250, false, false, "mismatch"],
    [250, true, false, "mismatch"],
    [250, false, true, "mismatch"],
    [250, true, true, "mismatch"],
  ];
  it.each(TRUTH)("variance %i, counted %s, denominations %s → %s", (
    variance,
    physicallyCounted,
    denominationsEntered,
    expected,
  ) => {
    expect(staffDrawerStatus({ variance, physicallyCounted, denominationsEntered })).toBe(expected);
  });
});

describe("staffCloseAuditAction — the trail says what was actually done", () => {
  it("logs an un-counted close as closed_unverified, not closed", () => {
    expect(staffCloseAuditAction(DRAWER_STATUS_NOT_VERIFIED)).toBe("closed_unverified");
    expect(staffCloseAuditAction("balanced")).toBe("closed");
    expect(staffCloseAuditAction("mismatch")).toBe("mismatch_detected");
  });

  it("never writes the same verb for a counted and an un-counted close", () => {
    expect(staffCloseAuditAction(DRAWER_STATUS_NOT_VERIFIED))
      .not.toBe(staffCloseAuditAction("balanced"));
  });
});

describe("UserCloseBody — silence means nobody counted", () => {
  const actuals = { cash: 500, upi: 0, card: 0, cheque: 0, other: 0 };

  it("defaults physicallyCounted to false rather than to the flattering value", () => {
    expect(UserCloseBody.parse({ actuals }).physicallyCounted).toBe(false);
  });

  it("keeps an explicit assertion", () => {
    expect(UserCloseBody.parse({ actuals, physicallyCounted: true }).physicallyCounted).toBe(true);
  });

  it("still accepts a body written before the checkbox existed", () => {
    // Older clients (and the mobile webview) post without the field; the close
    // must go through, recording as unverified rather than failing or claiming
    // a count it never got.
    const parsed = UserCloseBody.safeParse({ actuals, varianceNote: "", notes: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.physicallyCounted).toBe(false);
  });
});

describe("BulkStaffCloseBody — one click is allowed, but it must say why", () => {
  it("refuses a bulk close with no reason", () => {
    expect(BulkStaffCloseBody.safeParse({}).success).toBe(false);
    expect(BulkStaffCloseBody.safeParse({ notes: "end of day" }).success).toBe(false);
  });

  it("refuses a reason too short to be a reason", () => {
    expect(BulkStaffCloseBody.safeParse({ reason: "ab" }).success).toBe(false);
  });

  it("accepts a stated reason, with or without notes", () => {
    expect(BulkStaffCloseBody.safeParse({ reason: "Cashier was off" }).success).toBe(true);
    expect(
      BulkStaffCloseBody.safeParse({ reason: "Cashier was off", notes: "Aggregate verified" }).success,
    ).toBe(true);
  });

  it("does not require a denomination count — only the reason", () => {
    const parsed = BulkStaffCloseBody.safeParse({ reason: "Closed at handover" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty("denominations");
  });

  it("will not accept a claim that anybody counted", () => {
    // The bulk path fills actuals from expected, so a caller must not be able to
    // arrive holding both `autoBalance` and an assertion that the money was
    // counted. Dropping this from the schema is what re-creates the original
    // defect: a force-closed drawer that records as Balanced.
    const parsed = BulkStaffCloseBody.safeParse({
      reason: "Closed at handover",
      physicallyCounted: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty("physicallyCounted");
  });
});
