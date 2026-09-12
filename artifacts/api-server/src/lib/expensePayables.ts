/**
 * Expense Entry V2 — pure domain helpers.
 * BILL VALUE ≠ MONEY PAID.
 */

export type PaymentStatus = "PAID" | "PART_PAID" | "DUE" | "VOID";

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function derivePaymentStatus(opts: {
  billAmount: number;
  totalPaid: number;
  isVoid?: boolean;
}): PaymentStatus {
  if (opts.isVoid) return "VOID";
  const bill = roundMoney(Math.max(0, opts.billAmount));
  const paid = roundMoney(Math.max(0, opts.totalPaid));
  if (paid <= 0) return "DUE";
  if (paid + 0.001 >= bill) return "PAID";
  return "PART_PAID";
}

export function balanceDue(billAmount: number, totalPaid: number): number {
  return roundMoney(Math.max(0, roundMoney(billAmount) - roundMoney(totalPaid)));
}

export function assertPaymentAllowed(opts: {
  billAmount: number;
  alreadyPaid: number;
  newPayment: number;
}):
  | { ok: true; nextPaid: number; nextDue: number; nextStatus: PaymentStatus }
  | { ok: false; error: string } {
  const bill = roundMoney(opts.billAmount);
  const already = roundMoney(opts.alreadyPaid);
  const pay = roundMoney(opts.newPayment);
  if (!(pay > 0)) return { ok: false, error: "Payment amount must be greater than zero" };
  const due = balanceDue(bill, already);
  if (pay > due + 0.001) {
    return {
      ok: false,
      error: `Payment ₹${pay.toFixed(2)} exceeds balance due ₹${due.toFixed(2)}`,
    };
  }
  const nextPaid = roundMoney(already + pay);
  return {
    ok: true,
    nextPaid,
    nextDue: balanceDue(bill, nextPaid),
    nextStatus: derivePaymentStatus({ billAmount: bill, totalPaid: nextPaid }),
  };
}

/** Physical-cash impact for day-close: only literal cash outflows count. */
export function isCashPaymentMode(mode: string | null | undefined): boolean {
  const m = (mode ?? "").trim().toLowerCase();
  if (!m) return true;
  return m === "cash";
}

export function summarizeExpenseMoney(opts: {
  billAmount: number;
  totalPaid: number;
  isVoid?: boolean;
}): {
  billAmount: number;
  totalPaid: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
} {
  const billAmount = roundMoney(opts.billAmount);
  const totalPaid = roundMoney(opts.totalPaid);
  return {
    billAmount,
    totalPaid,
    balanceDue: balanceDue(billAmount, totalPaid),
    paymentStatus: derivePaymentStatus({
      billAmount,
      totalPaid,
      isVoid: opts.isVoid,
    }),
  };
}
