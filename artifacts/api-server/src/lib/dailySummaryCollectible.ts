/**
 * Daily-summary collectible cross-check helpers.
 *
 * physicalCashInHand (cash in − cash refunds − expenses) is authoritative.
 * The billing-side collectible is a cross-check and must not double-subtract
 * when this staff cancels a bill AND records the auto-refund: cancelledAmount
 * already removes the bill total; refunds on bills they cancelled must not
 * reduce collectible again.
 *
 * Ownership: cancellation belongs to whoever cancelled (cancelledByName),
 * not whoever created the bill.
 *
 * Partial test cancel (cancel-refund-tests) mutates bill.totalAmount downward
 * and posts `REFUND (test cancel):…`. Without special handling that both:
 *   1) drops the creator's gross billed, and
 *   2) subtracts the canceller's refund from collectible
 * — causing a false Short and wrongly changing the creator's expected cash.
 * Treat those auto-refunds like full-bill cancel: restore creator gross by the
 * refund amount, add it to the canceller's cancelledAmount, and exclude the
 * refund from refundsForCollectible.
 */

/** Must match notes written by POST /bills/:id/cancel-refund-tests. */
export const TEST_CANCEL_REFUND_NOTES_PREFIX = "REFUND (test cancel)";

export function isTestCancelRefund(notes: string | null | undefined): boolean {
  return (notes ?? "").startsWith(TEST_CANCEL_REFUND_NOTES_PREFIX);
}

export type CollectibleRefundRow = {
  amount: number | string;
  billId?: number | null;
  billStatus: string | null;
  billCreatedAt: Date | string | null;
  notes?: string | null;
};

export type TestCancelRefundRow = {
  amount: number | string;
  billId?: number | null;
  notes?: string | null;
};

export function isBillCreatedInPeriod(
  billCreatedAt: Date | string | null | undefined,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (!billCreatedAt) return false;
  const created = billCreatedAt instanceof Date ? billCreatedAt : new Date(billCreatedAt);
  if (Number.isNaN(created.getTime())) return false;
  return created >= periodStart && created < periodEnd;
}

/**
 * @deprecated Prefer computeRefundsOnBillsCancelledByMe. Kept for older
 * call sites that still key off bill creation date.
 */
export function computeRefundsOnCancelledBillsCreatedInPeriod(
  refunds: CollectibleRefundRow[],
  periodStart: Date,
  periodEnd: Date,
): number {
  return refunds
    .filter((p) => {
      if (Number(p.amount) >= -0.0001) return false;
      if ((p.billStatus ?? "") !== "cancelled") return false;
      return isBillCreatedInPeriod(p.billCreatedAt, periodStart, periodEnd);
    })
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
}

/** Refunds this staff recorded on bills they cancelled (already in cancelledAmount). */
export function computeRefundsOnBillsCancelledByMe(
  refunds: CollectibleRefundRow[],
  cancelledBillIds: Iterable<number>,
): number {
  const ids = cancelledBillIds instanceof Set ? cancelledBillIds : new Set(cancelledBillIds);
  return refunds
    .filter((p) => {
      if (Number(p.amount) >= -0.0001) return false;
      if (p.billId == null) return false;
      return ids.has(p.billId);
    })
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
}

/**
 * Auto-refunds from partial test cancellation recorded by this staff.
 * These count as the canceller's cancelledAmount (cash left their drawer).
 */
export function computeTestCancelRefundsAmount(
  refunds: Array<Pick<TestCancelRefundRow, "amount" | "notes">>,
): number {
  return refunds
    .filter((p) => Number(p.amount) < -0.0001 && isTestCancelRefund(p.notes))
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
}

/**
 * Restore creator gross for same-period bills that had a test-cancel auto-refund.
 * billIdsInGross = bill ids already included in grossBilledIncludingCancelled.
 */
export function computeGrossRestoreForTestCancelRefunds(
  refunds: TestCancelRefundRow[],
  billIdsInGross: Iterable<number>,
): number {
  const ids = billIdsInGross instanceof Set ? billIdsInGross : new Set(billIdsInGross);
  return refunds
    .filter((p) => {
      if (Number(p.amount) >= -0.0001) return false;
      if (!isTestCancelRefund(p.notes)) return false;
      if (p.billId == null) return false;
      return ids.has(p.billId);
    })
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
}

/**
 * Full + partial cancel refund exclusions for collectible (avoid double-subtract).
 */
export function computeRefundsExcludedFromCollectible(
  refunds: CollectibleRefundRow[],
  cancelledBillIds: Iterable<number>,
): number {
  const onFullCancel = computeRefundsOnBillsCancelledByMe(refunds, cancelledBillIds);
  // Test-cancel refunds may also appear in onFullCancel if the bill was later
  // fully cancelled; de-dupe by summing unique payment rows via amount once.
  const ids = cancelledBillIds instanceof Set ? cancelledBillIds : new Set(cancelledBillIds);
  let testCancelOnly = 0;
  for (const p of refunds) {
    if (Number(p.amount) >= -0.0001) continue;
    if (!isTestCancelRefund(p.notes)) continue;
    if (p.billId != null && ids.has(p.billId)) continue; // already in onFullCancel
    testCancelOnly += Math.abs(Number(p.amount));
  }
  return onFullCancel + testCancelOnly;
}

export function computeCollectibleForReconciliation(opts: {
  grossBilledIncludingCancelled: number;
  duesCollectedTotal: number;
  /** Bills this staff cancelled in the window (any original bill date). */
  cancelledAmount: number;
  cashRefunded: number;
  digitalRefunded: number;
  refundsOnBillsCancelledByMe: number;
  outstanding: number;
}): number {
  const totalRefunds = opts.cashRefunded + opts.digitalRefunded;
  const refundsForCollectible = Math.max(
    0,
    totalRefunds - opts.refundsOnBillsCancelledByMe,
  );
  return (
    opts.grossBilledIncludingCancelled
    + opts.duesCollectedTotal
    - opts.cancelledAmount
    - refundsForCollectible
    - opts.outstanding
  );
}
