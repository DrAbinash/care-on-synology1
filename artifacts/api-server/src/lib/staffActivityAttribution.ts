/**
 * Staff Activity row builder — action-based attribution (immutable per actor).
 *
 * Bills Created  → bill_created_by (createdByName)
 * Cash Collected → payment_collected_by (recordedByName, amount > 0, cash)
 * Bills Cancelled → bill_cancelled_by (cancelledByName)
 * Cash Refunded  → refund_processed_by (recordedByName, amount < 0, cash)
 *
 * Cancellation by User2 must NOT reduce User1's Bills Created or Cash Collected.
 */

export type StaffActivityBill = {
  createdByName: string | null;
  totalAmount: number | string;
  status: string;
};

export type StaffActivityCancel = {
  cancelledByName: string | null;
  totalAmount: number | string;
};

export type StaffActivityPayment = {
  recordedByName: string | null;
  amount: number | string;
  method: string | null;
  isCash: boolean;
  isDigital: boolean;
  isKnown: boolean;
};

export type StaffActivityRow = {
  name: string;
  billsCreated: number;
  cashCollected: number;
  digitalCollected: number;
  billsCancelled: number;
  cashRefunded: number;
  digitalRefunded: number;
  billCreateCount: number;
  cancellationCount: number;
};

export function buildStaffActivityRows(opts: {
  staffNames: string[];
  bills: StaffActivityBill[];
  cancelledByActor: StaffActivityCancel[];
  payments: StaffActivityPayment[];
}): StaffActivityRow[] {
  return opts.staffNames.map((name) => {
    const created = opts.bills.filter((b) => b.createdByName === name);
    const cancelled = opts.cancelledByActor.filter((b) => b.cancelledByName === name);
    const payPos = opts.payments.filter(
      (p) => p.recordedByName === name && Number(p.amount) > 0 && p.isKnown,
    );
    const payNeg = opts.payments.filter(
      (p) => p.recordedByName === name && Number(p.amount) < 0 && p.isKnown,
    );

    return {
      name,
      billsCreated: created.reduce((s, b) => s + Number(b.totalAmount), 0),
      billCreateCount: created.length,
      cashCollected: payPos.reduce((s, p) => s + (p.isCash ? Number(p.amount) : 0), 0),
      digitalCollected: payPos.reduce((s, p) => s + (p.isDigital ? Number(p.amount) : 0), 0),
      billsCancelled: cancelled.reduce((s, b) => s + Number(b.totalAmount), 0),
      cancellationCount: cancelled.length,
      cashRefunded: payNeg.reduce((s, p) => s + (p.isCash ? Math.abs(Number(p.amount)) : 0), 0),
      digitalRefunded: payNeg.reduce((s, p) => s + (p.isDigital ? Math.abs(Number(p.amount)) : 0), 0),
    };
  });
}

/** Clinic net cash from cash collections − cash refunds (not a per-staff drawer balance). */
export function netClinicCash(cashCollected: number, cashRefunded: number): number {
  return cashCollected - cashRefunded;
}

/**
 * Bill audit changeTypes that are operational events (create/pay/cancel/refund),
 * not document edits. Excluded from "Bill Edits" in My Activity Log / Control Logs.
 * PR #358 added bill_created + payment_collected for cash reconciliation — those
 * must not flood the edits tab.
 */
export const BILL_AUDIT_OPERATIONAL_CHANGE_TYPES = [
  "bill_created",
  "payment_collected",
  "referral",
  "bill_cancelled",
  "refund_processed",
  "tests_cancelled_cascade",
] as const;
