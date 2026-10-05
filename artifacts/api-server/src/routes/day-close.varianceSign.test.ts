import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// day-close.ts imports `db` from @workspace/db at module top level, which throws
// unconditionally at import time when DATABASE_URL is not set (the same
// constraint day-close.test.ts documents). `drawerVariances` is pure — it never
// touches the database — so the mock below only exists to let the module load.
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

import { drawerVariances } from "./day-close";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("drawerVariances — counted minus expected, everywhere", () => {
  it("reports money missing from the drawer as negative", () => {
    // Counted ₹4,800 against an expected ₹5,300: ₹500 is gone. The card colours
    // a negative variance red, so the sign is the warning.
    const v = drawerVariances({
      countedCash: 4800, expectedCash: 5300,
      countedDigital: 9000, expectedDigital: 9500,
      countedTotal: 13800, expectedTotal: 14800,
    });
    expect(v.cashVariance).toBe(-500);
    expect(v.digitalVariance).toBe(-500);
    expect(v.totalVariance).toBe(-1000);
  });

  it("reports a surplus as positive", () => {
    const v = drawerVariances({
      countedCash: 5300, expectedCash: 4800,
      countedDigital: 9500, expectedDigital: 9000,
      countedTotal: 14800, expectedTotal: 13800,
    });
    expect(v.cashVariance).toBe(500);
    expect(v.digitalVariance).toBe(500);
    expect(v.totalVariance).toBe(1000);
  });

  it("calls an exact match zero, so the card says Balanced rather than ±₹0", () => {
    const v = drawerVariances({
      countedCash: 185050, expectedCash: 185050,
      countedDigital: 57950, expectedDigital: 57950,
      countedTotal: 243000, expectedTotal: 243000,
    });
    expect(v).toEqual({ cashVariance: 0, digitalVariance: 0, totalVariance: 0 });
  });

  it("never mixes direction between the three rows of one drawer", () => {
    // The defect this pins: the closed drawer computed counted-expected while
    // the reopened drawer computed expected-counted, so the SAME ₹500 shortage
    // showed as red "−₹500" before reopen and amber "+₹500" after — the operator
    // reopening a drawer to investigate a shortage was told the sign had flipped.
    const shortage = drawerVariances({
      countedCash: 100, expectedCash: 600,
      countedDigital: 200, expectedDigital: 700,
      countedTotal: 300, expectedTotal: 1300,
    });
    const signs = [shortage.cashVariance, shortage.digitalVariance, shortage.totalVariance];
    expect(signs.every((s) => s < 0)).toBe(true);
  });
});

describe("the drawer status payload cannot compute a variance by hand", () => {
  // There is no browser or DB harness for this route on this machine, so the
  // wiring is pinned at source and stated plainly: both branches must route
  // through `drawerVariances`, and no branch may write its own subtraction —
  // which is exactly how the two drifted apart in the first place.
  const api = readFileSync(join(__dirname, "day-close.ts"), "utf8");

  const payload = api.slice(
    api.indexOf("async function buildDrawerStatusPayload"),
    api.indexOf('dayCloseRouter.get("/my-drawer-status"'),
  );

  it("scans the payload builder, not the whole file", () => {
    expect(payload.length).toBeGreaterThan(1000);
    expect(payload).toContain("drawerStatus: \"reopened\" as const");
    expect(payload).toContain("drawerStatus: latestUserClose.drawerStatus");
  });

  it("routes both the reopened and the closed branch through the helper", () => {
    expect(payload.match(/drawerVariances\(\{/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("computes no variance inline, in either direction", () => {
    for (const field of ["cashVariance", "digitalVariance", "totalVariance"]) {
      const inline = new RegExp(`${field}:\\s*[^,\\n]*[-+][^,\\n]*,`);
      expect(payload, `a hand-written subtraction for ${field} reintroduces the sign drift`).not.toMatch(inline);
    }
  });
});
