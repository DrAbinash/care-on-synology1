import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// GET /mobile-bill-desk/bills/:id's "items" list included cancelled
// order_tests at full price, with no status field to tell them apart from
// active ones. bills.ts already excludes cancelled tests when it recomputes
// subtotal/totalAmount on cancel/swap, so a bill with any cancelled test
// showed a per-item price list that summed to MORE than the Subtotal
// displayed right below it in the mobile app (bill-detail.tsx) — a visible
// billing-desk reconciliation mismatch with no explanation in the payload.
//
// Source-contract style (no DB), matching bills.swapTestTotals.test.ts:
// asserts the items query excludes cancelled tests at the source, so a
// regression back to the unfiltered query fails CI.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "mobileBillDesk.ts"), "utf8");

function handlerRegion(): string {
  const start = src.indexOf('mobileBillDeskRouter.get("/bills/:id"');
  expect(start, "GET /bills/:id handler must exist").toBeGreaterThan(-1);
  const end = src.indexOf("export { mobileBillDeskRouter }", start);
  expect(end, "router export (region boundary) must exist").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("GET /mobile-bill-desk/bills/:id — items reconcile with subtotal", () => {
  test("the items query excludes cancelled order_tests", () => {
    expect(handlerRegion()).toContain('ne(orderTestsTable.status, "cancelled")');
  });

  test("never regresses to the bare orderId-only filter that included cancelled tests", () => {
    const region = handlerRegion();
    // The old, buggy filter had ONLY this condition (no `and(...)` wrapping
    // an orderId + status pair) — matching it exactly (not as a substring
    // of the fixed `and(eq(orderId...), ne(status...))` call) would mean the
    // status exclusion regressed.
    expect(region).not.toMatch(/\.where\(eq\(orderTestsTable\.orderId, bill\.orderId\)\),/);
  });
});
