/**
 * Pure due-waiver planner — unpaid receivable → additional discount.
 *
 * NEVER touches paidAmount / refundAmount / payments. Callers apply the
 * returned patch under a bill-row FOR UPDATE lock.
 */
import {
  billBalanceFromParts,
  billTotalFromParts,
  moneyAdd,
} from "./money";
import { assertDiscountNotBelowCollected } from "./financialIntegrity";

export type DueWaiverBillSnapshot = {
  status: string;
  subtotal: unknown;
  taxAmount?: unknown;
  paidAmount: unknown;
  refundAmount?: unknown;
  discount: unknown;
  totalAmount: unknown;
};

export type DueWaiverPlanOk = {
  ok: true;
  waivedAmount: number;
  oldDiscount: number;
  newDiscount: number;
  oldTotal: number;
  newTotal: number;
  paidAmount: number;
  refundAmount: number;
  oldBalance: number;
  newBalance: number;
  newStatus: "paid" | "partial" | "pending";
};

export type DueWaiverPlanErr = {
  ok: false;
  httpStatus: 400 | 403 | 409;
  error: string;
};

export type DueWaiverPlan = DueWaiverPlanOk | DueWaiverPlanErr;

export function planDueWaiver(
  bill: DueWaiverBillSnapshot,
  opts: {
    maxDiscountPct?: number | null;
    role?: string | null;
    fullAccessRoles?: ReadonlySet<string>;
  } = {},
): DueWaiverPlan {
  if (bill.status === "cancelled") {
    return {
      ok: false,
      httpStatus: 409,
      error: "Bill is cancelled — due cannot be waived",
    };
  }

  const subtotal = Number(bill.subtotal);
  const taxAmount = Number(bill.taxAmount ?? 0);
  const paidAmount = Number(bill.paidAmount);
  const refundAmount = Number(bill.refundAmount ?? 0);
  const oldDiscount = Number(bill.discount);
  const oldTotal = Number(bill.totalAmount);
  const oldBalance = billBalanceFromParts(oldTotal, paidAmount, refundAmount);

  if (refundAmount > 0.01) {
    return {
      ok: false,
      httpStatus: 409,
      error:
        "Due waiver is not allowed on a bill that already has refunds. Use an audited bill correction instead.",
    };
  }
  if (oldBalance <= 0.01) {
    return {
      ok: false,
      httpStatus: 409,
      error: "This bill has no outstanding balance to waive",
    };
  }

  const newDiscount = moneyAdd(oldDiscount, oldBalance);
  if (newDiscount > subtotal + 0.01) {
    return {
      ok: false,
      httpStatus: 409,
      error: "Outstanding amount cannot be represented as a discount on this bill",
    };
  }

  const fullAccess = opts.fullAccessRoles;
  const role = opts.role ?? null;
  const isFullAccess = role != null && fullAccess != null && fullAccess.has(role);
  if (!isFullAccess && newDiscount > 0) {
    const maxPct = opts.maxDiscountPct ?? 0;
    const maxAllowed = Math.round(((subtotal * maxPct) / 100) * 100) / 100;
    if (newDiscount > maxAllowed + 0.01) {
      return {
        ok: false,
        httpStatus: 403,
        error: `Your maximum allowed discount is ${maxPct}% (₹${maxAllowed.toFixed(2)} on this bill). Please ask an admin to waive this due.`,
      };
    }
  }

  const newTotal = billTotalFromParts(subtotal, newDiscount, taxAmount);
  const discountGate = assertDiscountNotBelowCollected({
    subtotal,
    discount: newDiscount,
    tax: taxAmount,
    collectedNet: paidAmount,
  });
  if (discountGate) {
    return { ok: false, httpStatus: 400, error: discountGate };
  }

  // paidAmount and refundAmount intentionally unchanged — this is not a refund.
  const newBalance = billBalanceFromParts(newTotal, paidAmount, refundAmount);
  const newStatus: DueWaiverPlanOk["newStatus"] =
    newBalance <= 0.01 ? "paid" : paidAmount > 0 ? "partial" : "pending";

  return {
    ok: true,
    waivedAmount: oldBalance,
    oldDiscount,
    newDiscount,
    oldTotal,
    newTotal,
    paidAmount,
    refundAmount,
    oldBalance,
    newBalance,
    newStatus,
  };
}
