import { describe, expect, it } from "vitest";
import {
  computeCollectibleForReconciliation,
  computeRefundsOnBillsCancelledByMe,
  computeRefundsOnCancelledBillsCreatedInPeriod,
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
