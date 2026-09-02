import { describe, expect, it } from "vitest";
import {
  computeCollectibleForReconciliation,
  computeGrossRestoreForTestCancelRefunds,
  computeRefundsExcludedFromCollectible,
  computeRefundsOnBillsCancelledByMe,
  computeRefundsOnCancelledBillsCreatedInPeriod,
  computeTestCancelRefundsAmount,
  isTestCancelRefund,
} from "./dailySummaryCollectible";

const START = new Date("2026-08-01T00:00:00+05:30");
const END = new Date("2026-08-01T23:59:59.999+05:30");
const CREATED_TODAY = new Date("2026-08-01T10:00:00+05:30");
const CREATED_YESTERDAY = new Date("2026-07-31T10:00:00+05:30");

describe("computeRefundsOnCancelledBillsCreatedInPeriod", () => {
  it("excludes same-day cancel+refund (Vikram scenario)", () => {
    const excluded = computeRefundsOnCancelledBillsCreatedInPeriod(
      [{
        amount: "-11500",
        billStatus: "cancelled",
        billCreatedAt: CREATED_TODAY,
      }],
      START,
      END,
    );
    expect(excluded).toBe(11500);
  });

  it("does not exclude refund on old bill cancelled today (creation-date helper)", () => {
    const excluded = computeRefundsOnCancelledBillsCreatedInPeriod(
      [{
        amount: "-11500",
        billStatus: "cancelled",
        billCreatedAt: CREATED_YESTERDAY,
      }],
      START,
      END,
    );
    expect(excluded).toBe(0);
  });

  it("does not exclude partial refund on active bill created today", () => {
    const excluded = computeRefundsOnCancelledBillsCreatedInPeriod(
      [{
        amount: "-2000",
        billStatus: "paid",
        billCreatedAt: CREATED_TODAY,
      }],
      START,
      END,
    );
    expect(excluded).toBe(0);
  });

  it("excludes all refunds on a same-day bill that was later cancelled", () => {
    const excluded = computeRefundsOnCancelledBillsCreatedInPeriod(
      [
        { amount: "-2000", billStatus: "cancelled", billCreatedAt: CREATED_TODAY },
        { amount: "-9500", billStatus: "cancelled", billCreatedAt: CREATED_TODAY },
      ],
      START,
      END,
    );
    expect(excluded).toBe(11500);
  });
});

describe("computeRefundsOnBillsCancelledByMe", () => {
  it("excludes refunds on bills this staff cancelled, including old bills", () => {
    const excluded = computeRefundsOnBillsCancelledByMe(
      [
        { amount: "-3400", billId: 10, billStatus: "cancelled", billCreatedAt: CREATED_YESTERDAY },
        { amount: "-500", billId: 11, billStatus: "paid", billCreatedAt: CREATED_TODAY },
      ],
      [10],
    );
    expect(excluded).toBe(3400);
  });
});

describe("partial test-cancel refund attribution", () => {
  it("detects REFUND (test cancel) notes from cancel-refund-tests", () => {
    expect(isTestCancelRefund("REFUND (test cancel): patient request")).toBe(true);
    expect(isTestCancelRefund("REFUND: overcharge")).toBe(false);
    expect(isTestCancelRefund(null)).toBe(false);
  });

  it("Abinash partial-cancels ₹1500 on Vijay's paid bill — Vijay unchanged, Abinash −1500, no Short", () => {
    const testCancelRefund = {
      amount: "-1500",
      billId: 42,
      billStatus: "paid",
      billCreatedAt: CREATED_TODAY,
      notes: "REFUND (test cancel): part cancel",
    };

    // Creator (Vijay): mutated total is 8500; restore +1500 → gross 10000 again.
    const vijayGrossMutated = 8500;
    const vijayRestore = computeGrossRestoreForTestCancelRefunds([testCancelRefund], [42]);
    expect(vijayRestore).toBe(1500);
    const vijay = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: vijayGrossMutated + vijayRestore,
      duesCollectedTotal: 0,
      cancelledAmount: 0,
      cashRefunded: 0,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 0,
      outstanding: 0,
    });
    expect(vijay).toBe(10000);

    // Canceller (Abinash): refund counts as cancelledAmount; exclude from refunds.
    const abinashTestCancel = computeTestCancelRefundsAmount([testCancelRefund]);
    const abinashExcluded = computeRefundsExcludedFromCollectible([testCancelRefund], []);
    expect(abinashTestCancel).toBe(1500);
    expect(abinashExcluded).toBe(1500);
    const abinash = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 0,
      duesCollectedTotal: 0,
      cancelledAmount: abinashTestCancel,
      cashRefunded: 1500,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: abinashExcluded,
      outstanding: 0,
    });
    expect(abinash).toBe(-1500);

    // All-staff cross-check: restore + cancel + excluded refund → nets once.
    const allStaff = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: vijayGrossMutated + vijayRestore,
      duesCollectedTotal: 0,
      cancelledAmount: abinashTestCancel,
      cashRefunded: 1500,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: abinashExcluded,
      outstanding: 0,
    });
    // physicalCashInHand = cashIn 10000 − refund 1500 = 8500
    expect(allStaff).toBe(8500);
  });

  it("does not restore gross for test-cancel refunds on bills outside the gross set", () => {
    const restore = computeGrossRestoreForTestCancelRefunds(
      [{ amount: "-1500", billId: 99, notes: "REFUND (test cancel): x" }],
      [42],
    );
    expect(restore).toBe(0);
  });

  it("de-dupes test-cancel refund when bill is also fully cancelled", () => {
    const row = {
      amount: "-1500",
      billId: 10,
      billStatus: "cancelled",
      billCreatedAt: CREATED_TODAY,
      notes: "REFUND (test cancel): then voided",
    };
    expect(computeRefundsExcludedFromCollectible([row], [10])).toBe(1500);
  });
});

describe("computeCollectibleForReconciliation", () => {
  it("same-day create + cancel + refund nets to zero collectible impact", () => {
    const collectible = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 11500,
      duesCollectedTotal: 0,
      cancelledAmount: 11500,
      cashRefunded: 11500,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 11500,
      outstanding: 0,
    });
    expect(collectible).toBe(0);
  });

  it("old bill full refund today subtracts refund once when this staff did not cancel", () => {
    const collectible = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 300000,
      duesCollectedTotal: 0,
      cancelledAmount: 0,
      cashRefunded: 11500,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 0,
      outstanding: 2000,
    });
    expect(collectible).toBe(300000 - 11500 - 2000);
  });

  it("partial refund on active bill created today subtracts only partial amount", () => {
    const collectible = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 11500,
      duesCollectedTotal: 0,
      cancelledAmount: 0,
      cashRefunded: 2000,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 0,
      outstanding: 9500,
    });
    expect(collectible).toBe(0);
  });

  it("₹3400: Vijay created+collected; Abinash cancelled and paid the refund", () => {
    const vijay = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 3400,
      duesCollectedTotal: 0,
      cancelledAmount: 0,
      cashRefunded: 0,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 0,
      outstanding: 0,
    });
    expect(vijay).toBe(3400);

    const abinash = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 0,
      duesCollectedTotal: 0,
      cancelledAmount: 3400,
      cashRefunded: 3400,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 3400,
      outstanding: 0,
    });
    expect(abinash).toBe(-3400);
  });

  it("old bill cancelled today hits the canceller, not the original creator", () => {
    const canceller = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 0,
      duesCollectedTotal: 0,
      cancelledAmount: 3400,
      cashRefunded: 3400,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 3400,
      outstanding: 0,
    });
    expect(canceller).toBe(-3400);

    const originalCreator = computeCollectibleForReconciliation({
      grossBilledIncludingCancelled: 0,
      duesCollectedTotal: 0,
      cancelledAmount: 0,
      cashRefunded: 0,
      digitalRefunded: 0,
      refundsOnBillsCancelledByMe: 0,
      outstanding: 0,
    });
    expect(originalCreator).toBe(0);
  });
});
