import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// POST /bills/:id/swap-test could persist a NEGATIVE totalAmount.
//
// cancel-test and cancel-refund-tests both recompute a bill's total from a
// changed set of active tests using the same formula: cap the existing
// discount at the new (smaller) subtotal, floor the result at zero, and add
// back tax. swap-test must use the same canonical money helpers.

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
  test("caps the carried-over discount at the new (post-swap) subtotal via paise min", () => {
    const region = swapTestRegion();
    expect(region).toContain("Math.min(rupeesToPaise(oldDiscount), rupeesToPaise(newSubtotal))");
    expect(region).toContain("moneyMax0");
  });

  test("recalculates total via billTotalFromParts (floored paise math + tax)", () => {
    expect(swapTestRegion()).toContain("billTotalFromParts(newSubtotal, newDiscount, bill.taxAmount)");
  });

  test("the capped discount is actually persisted back onto the bill", () => {
    expect(swapTestRegion()).toContain("discount: newDiscount.toFixed(2)");
  });

  test("never regresses to the old bare subtraction with no cap, floor, or tax", () => {
    expect(swapTestRegion()).not.toContain("const newTotal = newSubtotal - oldDiscount;");
  });

  test("cancel-test — same discount-cap / billTotalFromParts formula", () => {
    const region = cancelTestRegion();
    expect(region).toContain("Math.min(rupeesToPaise(oldDiscount), rupeesToPaise(newSubtotal))");
    expect(region).toContain("billTotalFromParts(newSubtotal, newDiscount, bill.taxAmount)");
  });
});
