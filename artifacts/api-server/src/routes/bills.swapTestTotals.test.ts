import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// POST /bills/:id/swap-test could persist a NEGATIVE totalAmount.
//
// cancel-test and cancel-refund-tests both recompute a bill's total from a
// changed set of active tests using the same formula: cap the existing
// discount at the new (smaller) subtotal, floor the result at zero, and add
// back tax. swap-test recomputed the total as `newSubtotal - oldDiscount`
// with none of that — no cap, no floor, no tax term. A bill with subtotal
// ₹5000 and a flat ₹4500 discount (total ₹500), swapped to a test priced
// ₹300, wrote totalAmount = 300 - 4500 = -4200 straight into the bill,
// which then feeds SUM(totalAmount) dashboards and revenue reports.
//
// Source-contract style (no DB), matching bills.editAudit.test.ts in this
// same file: asserts the swap-test handler's recalculation matches the
// SAME formula its siblings already use, so a regression back to the bare
// `newSubtotal - oldDiscount` fails CI even without exercising the DB.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "bills.ts"), "utf8");

function handlerRegion(startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `${startMarker} must exist`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start);
  expect(end, `${endMarker} (region boundary) must exist`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const cancelTestRegion = () => handlerRegion('billsRouter.post("/:id/cancel-test"', 'billsRouter.post("/:id/cancel-refund-tests"');
const swapTestRegion = () => handlerRegion('billsRouter.post("/:id/swap-test"', 'billsRouter.post("/:id/initiate-gateway-payment"');

describe("POST /bills/:id/swap-test — total recalculation matches its siblings", () => {
  test("caps the carried-over discount at the new (post-swap) subtotal", () => {
    expect(swapTestRegion()).toContain("const newDiscount = Math.min(oldDiscount, newSubtotal)");
  });

  test("floors the recalculated total at zero", () => {
    expect(swapTestRegion()).toMatch(/const newTotal = Math\.max\(0, Math\.round\(\(newSubtotal - newDiscount \+ Number\(bill\.taxAmount\)\) \* 100\) \/ 100\)/);
  });

  test("the capped discount is actually persisted back onto the bill", () => {
    expect(swapTestRegion()).toContain("discount: newDiscount.toFixed(2)");
  });

  test("never regresses to the old bare subtraction with no cap, floor, or tax", () => {
    expect(swapTestRegion()).not.toContain("const newTotal = newSubtotal - oldDiscount;");
  });

  test("cancel-test — same discount-cap / floor / +tax formula (the pattern swap-test now matches)", () => {
    const region = cancelTestRegion();
    expect(region).toContain("const newDiscount = Math.min(oldDiscount, newSubtotal)");
    expect(region).toMatch(/Math\.max\(0, Math\.round\(\(newSubtotal - newDiscount \+ Number\(bill\.taxAmount\)\) \* 100\) \/ 100\)/);
  });
});
