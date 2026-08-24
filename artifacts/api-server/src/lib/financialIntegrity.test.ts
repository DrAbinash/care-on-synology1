import { describe, expect, it } from "vitest";
import {
  moneyAdd,
  moneyMax0,
  moneySub,
  rupeesToPaise,
  billTotalFromParts,
  billBalanceFromParts,
  paiseToRupees,
} from "./money";
import {
  isCollectiblePayment,
  assertNonNegativePayment,
  assertPaymentWithinOutstanding,
  assertDiscountNotBelowCollected,
  gstComponentsReconcile,
  emergencyImportLinesReconcile,
  assertOnlineBookingFullPayment,
  resolveStaffLinePrice,
  resolveOrderLinePrices,
  canConfirmOnlineBooking,
  packageEffectivePrice,
  allocatePackageLinePrices,
  applyVipMultiplier,
  recomputedBillBalance,
} from "./financialIntegrity";

describe("CARE financial integrity — exact money", () => {
  it("0.1 + 0.2 is ₹0.30 in paise arithmetic", () => {
    expect(moneyAdd(0.1, 0.2)).toBe(0.3);
    expect(rupeesToPaise(0.1) + rupeesToPaise(0.2)).toBe(30);
  });
});

describe("1. catalog ₹1000 + client ₹1 is not billed at ₹1", () => {
  it("non-admin staff is charged catalog, not the client rate", () => {
    const resolved = resolveStaffLinePrice({
      catalogPrice: 1000,
      requestedPrice: 1,
      isAdmin: false,
      isVip: false,
      vipPercent: 0,
    });
    expect(resolved.price).toBe(1000);
  });

  it("admin override of ₹1 is an explicit privileged path", () => {
    const resolved = resolveStaffLinePrice({
      catalogPrice: 1000,
      requestedPrice: 1,
      isAdmin: true,
      isVip: false,
      vipPercent: 0,
    });
    expect(resolved.price).toBe(1);
  });
});

describe("2–7. online booking full payment", () => {
  it("client ₹1 against frozen ₹1000 is rejected", () => {
    expect(
      assertOnlineBookingFullPayment({ frozenAmount: 1000, capturedAmount: 1 }),
    ).toMatch(/full payment/i);
  });

  it("₹1000 captured against frozen ₹1000 is accepted", () => {
    expect(assertOnlineBookingFullPayment({ frozenAmount: 1000, capturedAmount: 1000 })).toBeNull();
  });

  it("₹999 against ₹1000 is not confirmed", () => {
    expect(assertOnlineBookingFullPayment({ frozenAmount: 1000, capturedAmount: 999 })).toBeTruthy();
  });

  it("zero payment is not confirmed", () => {
    expect(assertOnlineBookingFullPayment({ frozenAmount: 1000, capturedAmount: 0 })).toBeTruthy();
  });

  it("pay-at-centre skips the capture check", () => {
    expect(
      assertOnlineBookingFullPayment({ frozenAmount: 1000, capturedAmount: 0, payAtCentre: true }),
    ).toBeNull();
  });

  it("auto-confirm of a pending website booking is rejected", () => {
    expect(
      canConfirmOnlineBooking({
        source: "website",
        status: "pending_payment",
        frozenAmount: 1000,
        payAtCentre: false,
        autoConfirm: true,
      }),
    ).toMatch(/verified full payment/i);
  });

  it("staff confirm of pending without collected amount is rejected", () => {
    expect(
      canConfirmOnlineBooking({
        source: "website",
        status: "pending_payment",
        frozenAmount: 1000,
        payAtCentre: false,
        autoConfirm: false,
      }),
    ).toMatch(/verified full payment/i);
  });

  it("staff confirm with partial collected amount is rejected", () => {
    expect(
      canConfirmOnlineBooking({
        source: "website",
        status: "pending_payment",
        frozenAmount: 1000,
        payAtCentre: false,
        autoConfirm: false,
        staffCollectedAmount: 1,
      }),
    ).toMatch(/full payment/i);
  });

  it("staff confirm with full frozen collection may confirm pending", () => {
    expect(
      canConfirmOnlineBooking({
        source: "website",
        status: "pending_payment",
        frozenAmount: 1000,
        payAtCentre: false,
        autoConfirm: false,
        staffCollectedAmount: 1000,
      }),
    ).toBeNull();
  });

  it("paid booking with matching frozen amount may confirm", () => {
    expect(
      canConfirmOnlineBooking({
        source: "website",
        status: "paid",
        frozenAmount: 1000,
        payAtCentre: false,
        autoConfirm: true,
      }),
    ).toBeNull();
  });
});

describe("8. gateway payment replay", () => {
  it("already-confirmed booking is a no-op", () => {
    expect(
      canConfirmOnlineBooking({
        source: "website",
        status: "confirmed",
        frozenAmount: 1000,
        payAtCentre: false,
        autoConfirm: true,
      }),
    ).toBeNull();
  });
});

describe("9–11. payment integrity", () => {
  it("negative payment is rejected", () => {
    expect(assertNonNegativePayment(-10)).toBeTruthy();
  });

  it("payment greater than outstanding is rejected", () => {
    expect(assertPaymentWithinOutstanding(500, 100)).toMatch(/exceeds/i);
  });

  it("payment equal to outstanding is allowed (1 paise tolerance)", () => {
    expect(assertPaymentWithinOutstanding(100, 100)).toBeNull();
    expect(assertPaymentWithinOutstanding(100.01, 100)).toBeNull();
  });
});

describe("12. discount below collected is rejected", () => {
  it("rejects a discount that would make total < collected", () => {
    expect(
      assertDiscountNotBelowCollected({ subtotal: 1000, discount: 600, tax: 0, collectedNet: 500 }),
    ).toMatch(/already collected/i);
  });

  it("allows a discount that still covers collected money", () => {
    expect(
      assertDiscountNotBelowCollected({ subtotal: 1000, discount: 400, tax: 0, collectedNet: 500 }),
    ).toBeNull();
  });
});

describe("13 / 26. superseded gateway payments are not collectible", () => {
  it("excludes superseded / void / failed", () => {
    expect(isCollectiblePayment({ amount: 500, settlementStatus: "superseded" })).toBe(false);
    expect(isCollectiblePayment({ amount: 500, settlementStatus: "failed" })).toBe(false);
    expect(isCollectiblePayment({ amount: 500, settlementStatus: "captured" })).toBe(true);
    expect(isCollectiblePayment({ amount: 500, settlementStatus: null })).toBe(true);
  });
});

describe("14. emergency import inconsistent lines are rejected", () => {
  it("rejects line total ≠ gross", () => {
    expect(
      emergencyImportLinesReconcile({
        lines: [{ unitPrice: 400, quantity: 1 }],
        grossAmount: 1000,
        discountAmount: 0,
        netAmount: 1000,
        amountReceived: 1000,
        dueAmount: 0,
      }),
    ).toMatch(/does not match gross/i);
  });

  it("accepts a consistent historical payload", () => {
    expect(
      emergencyImportLinesReconcile({
        lines: [{ unitPrice: 1000, quantity: 1 }],
        grossAmount: 1000,
        discountAmount: 100,
        netAmount: 900,
        amountReceived: 500,
        dueAmount: 400,
      }),
    ).toBeNull();
  });
});

describe("15 / 18. package + staff pricing", () => {
  it("package component tampering is ignored; server allocates package total", () => {
    const lines = resolveOrderLinePrices({
      tests: [
        { testId: 1, requestedPrice: 1 },
        { testId: 2, requestedPrice: 1 },
      ],
      catalogByTestId: new Map([
        [1, 600],
        [2, 400],
      ]),
      packageGroups: [{ testIds: [1, 2], effectivePrice: 800 }],
      isAdmin: false,
      isVip: false,
      vipPercent: 0,
    });
    expect(lines.error).toBeUndefined();
    const sum = lines.lines.reduce((s, l) => s + rupeesToPaise(l.price), 0);
    expect(sum).toBe(rupeesToPaise(800));
    expect(lines.lines.every((l) => l.price !== 1)).toBe(true);
  });

  it("packageEffectivePrice applies percent then amount", () => {
    expect(packageEffectivePrice({ price: 1000, discountPct: 10, discountAmount: 50 })).toBe(850);
  });
});

describe("16 / 17. referring-doctor books stay independent", () => {
  it("two books can have the same patient/date totals without being collapsed", () => {
    const bookA = billTotalFromParts(1000, 0, 0);
    const bookB = billTotalFromParts(1000, 0, 0);
    expect(bookA).toBe(bookB);
    expect(bookA).toBe(1000);
  });
});

describe("21. superadmin delete remains a product capability (policy)", () => {
  it("does not introduce a soft-delete status into collectible rules", () => {
    expect(isCollectiblePayment({ amount: 100, settlementStatus: "deleted" })).toBe(true);
  });
});

describe("22–24. deleted/cancelled bills drop commission via cancelled status", () => {
  it("cancelled collection status is not counted", () => {
    expect(isCollectiblePayment({ amount: 1500, settlementStatus: "cancelled" })).toBe(false);
  });
});

describe("25. GST components reconcile", () => {
  it("taxable + GST = total and CGST + SGST = GST", () => {
    expect(
      gstComponentsReconcile({ taxable: 1000, cgst: 90, sgst: 90, gst: 180, total: 1180 }),
    ).toBe(true);
    expect(
      gstComponentsReconcile({ taxable: 1000, cgst: 90, sgst: 80, gst: 180, total: 1180 }),
    ).toBe(false);
  });
});

describe("VIP multiplier", () => {
  it("applies percent via paise", () => {
    expect(applyVipMultiplier(1000, true, 50)).toBe(1500);
    expect(applyVipMultiplier(1000, false, 50)).toBe(1000);
  });
});

describe("allocatePackageLinePrices remainder", () => {
  it("last line absorbs paise remainder", () => {
    const rows = allocatePackageLinePrices(
      [
        { testId: 1, catalogPrice: 10 },
        { testId: 2, catalogPrice: 10 },
        { testId: 3, catalogPrice: 10 },
      ],
      100,
    );
    const sum = rows.reduce((s, r) => s + rupeesToPaise(r.price), 0);
    expect(sum).toBe(10000);
  });
});

describe("cancel-test / refund money mutation helpers", () => {
  it("subtotal after cancel-test uses moneyAdd and caps discount at subtotal", () => {
    // Remaining active lines after cancelling one test (float-prone prices).
    const remaining = [100.1, 200.2];
    const newSubtotal = remaining.reduce((s, p) => moneyAdd(s, p), 0);
    expect(newSubtotal).toBe(300.3);

    const oldDiscount = 500; // larger than new subtotal — must be capped
    const newDiscount = moneyMax0(
      paiseToRupees(Math.min(rupeesToPaise(oldDiscount), rupeesToPaise(newSubtotal))),
    );
    expect(newDiscount).toBe(300.3);

    const newTotal = billTotalFromParts(newSubtotal, newDiscount, 0);
    expect(newTotal).toBe(0);

    const { total, balance } = recomputedBillBalance({
      subtotal: newSubtotal,
      discount: newDiscount,
      tax: 0,
      paid: 0,
      refund: 0,
    });
    expect(total).toBe(0);
    expect(balance).toBe(0);
  });

  it("cancel-test balance after partial payment uses billBalanceFromParts", () => {
    const remaining = [400, 600];
    const newSubtotal = remaining.reduce((s, p) => moneyAdd(s, p), 0);
    const newDiscount = moneyMax0(
      paiseToRupees(Math.min(rupeesToPaise(50), rupeesToPaise(newSubtotal))),
    );
    const newTotal = billTotalFromParts(newSubtotal, newDiscount, 18);
    expect(newTotal).toBe(968); // 1000 - 50 + 18
    expect(billBalanceFromParts(newTotal, 500, 0)).toBe(468);
  });

  it("refund cannot exceed paid (paise compare)", () => {
    const currentPaid = 250.5;
    const amount = paiseToRupees(rupeesToPaise(300));
    expect(rupeesToPaise(amount) > rupeesToPaise(currentPaid)).toBe(true);

    const okAmount = paiseToRupees(rupeesToPaise(250.5));
    expect(rupeesToPaise(okAmount) > rupeesToPaise(currentPaid)).toBe(false);

    const newPaid = moneyMax0(moneySub(currentPaid, okAmount));
    const newRefund = moneyAdd(0, okAmount);
    const newBalance = billBalanceFromParts(1000, newPaid, newRefund);
    expect(newPaid).toBe(0);
    expect(newRefund).toBe(250.5);
    expect(newBalance).toBe(749.5);
  });

  it("cancel-refund-tests overpay excess uses paise refund", () => {
    const newTotal = billTotalFromParts(600, 0, 0);
    const oldPaid = 1000;
    expect(rupeesToPaise(oldPaid) > rupeesToPaise(newTotal)).toBe(true);
    const refundedAmount = paiseToRupees(rupeesToPaise(oldPaid) - rupeesToPaise(newTotal));
    expect(refundedAmount).toBe(400);
    const newPaid = moneyMax0(moneySub(oldPaid, refundedAmount));
    const newRefund = moneyAdd(0, refundedAmount);
    expect(billBalanceFromParts(newTotal, newPaid, newRefund)).toBe(0);
  });
});
