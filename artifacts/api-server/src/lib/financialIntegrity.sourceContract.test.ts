/**
 * Source-text contracts: CARE financial helpers must stay wired into live routes.
 * These greps catch accidental unwiring without needing a full DB.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function src(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("financialIntegrity source contracts", () => {
  it("orders.ts allocates packages via resolveOrderLinePrices", () => {
    const text = src("routes/orders.ts");
    expect(text).toContain("resolveOrderLinePrices");
    expect(text).toContain("parsePackageIds");
    expect(text).toContain("packageEffectivePrice");
    expect(text).toContain("moneyAdd");
  });

  it("onlineBookingCreate freezes catalog amount and ignores client total", () => {
    const text = src("services/onlineBookingCreate.ts");
    expect(text).toContain("const catalogAmount = await computeCatalogAmount");
    expect(text).toContain("const amount = catalogAmount");
    expect(text).not.toMatch(/const amount = Number\(input\.totalAmount\)/);
  });

  it("public-booking.ts freezes gateway charges to booking total", () => {
    const text = src("routes/public-booking.ts");
    expect(text).toContain("frozenBookingAmount");
    expect(text).toContain("capturedMatchesFrozen");
    expect(text).toContain("assertOnlineBookingFullPayment");
  });

  it("bills.ts discount/payment/delete/create use integrity helpers", () => {
    const text = src("routes/bills.ts");
    expect(text).toContain("assertDiscountNotBelowCollected");
    expect(text).toContain("assertNonNegativePayment");
    expect(text).toContain("assertPaymentWithinOutstanding");
    expect(text).toContain("delete(vouchersTable)");
    expect(text).toContain("bill_deleted");
    expect(text).toContain("ledgerId: nextLedgerId");
    expect(text).toContain("isCollectiblePayment");
    expect(text).toContain("billTotalFromParts");
    expect(text).toContain("billBalanceFromParts");
    expect(text).toContain("scaleLinePaiseToTotal");
    expect(text).toContain("formFRecordsTable).set({ billId: null })");
    expect(text).toContain("testTokensTable).set({ billId: null })");
  });

  it("online-bookings confirmBookingInternal gates confirmation", () => {
    const text = src("routes/online-bookings.ts");
    expect(text).toContain("canConfirmOnlineBooking");
    expect(text).toContain("authoritativeTotal: Number(booking.totalAmount)");
    expect(text).toContain("staffCollectedAmount");
  });

  it("day-close and daily-summary filter collectible payments", () => {
    expect(src("routes/day-close.ts")).toContain("isCollectiblePayment");
    expect(src("routes/daily-summary.ts")).toContain("isCollectiblePayment");
  });

  it("reports exclude non-collectible settlement statuses", () => {
    const text = src("routes/reports.ts");
    expect(text).toContain("isCollectiblePayment");
    expect(text).toContain("INVALID_COLLECTION_STATUSES");
  });

  it("emergencyReconcile reconciles imported lines before insert", () => {
    expect(src("lib/emergencyReconcile.ts")).toContain("emergencyImportLinesReconcile");
  });

  it("billing desk forwards packageIds to order create", () => {
    expect(src("routes/billingDeskSave.ts")).toContain("packageIds: payload.packageIds");
  });
});
