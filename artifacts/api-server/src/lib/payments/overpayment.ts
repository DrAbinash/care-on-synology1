/**
 * Gateway overpayment detection — corridor audit finding F3.
 *
 * WHY: every BILLPAY settle path (S2S webhook, browser callback, status poll,
 * manual reconcile) records the gateway payment at face value and clamps the
 * bill's balance at zero. The money is never lost — the payment row and the
 * receipt voucher carry the full received amount — but nothing notices when
 * the gateway took MORE than the bill still owed. The excess sits invisible
 * inside paid_amount > total_amount: no flag, no audit entry, no books-sanity
 * check, nothing for an administrator to reconcile or refund.
 *
 * WHEN IT HAPPENS: the amount is only capped against the outstanding at
 * INITIATE time (initiate-gateway-payment / bill payment links). Between
 * initiation and capture the outstanding can shrink — the bill gets paid by
 * another means (cash, UPI entry, second link, desk edit) — so a successful
 * capture can exceed the remaining outstanding. The gateway is the source of
 * truth for money actually debited from the patient, so the capture is
 * recorded in full and the excess is flagged, never discarded.
 *
 * WHAT THIS MODULE DOES — and deliberately does NOT do:
 *   • Detects: settled amount > outstanding at settle time (paise-exact,
 *     locked bill row read inside the caller's settlement transaction).
 *   • Records: an `overpayment_flagged` bill_audit row, and a notes marker on
 *     the NEW payment row only — historical rows are never rewritten.
 *   • Surfaces: books-sanity lists bills whose paid_amount exceeds the bill
 *     total (books-sanity.ts, check 9), which also nets any settle path or
 *     era that predates the settle-time flag.
 *   • Does NOT auto-refund, does NOT cancel/void the gateway transaction, and
 *     does NOT change settlement arithmetic: the payment posts at the full
 *     received amount, the balance clamps at zero, the status becomes
 *     "paid". Refunding the excess stays a human decision made through the
 *     existing POST /api/bills/:id/refund route (which caps refunds at the
 *     amount currently paid, so refunding the excess is always possible).
 */
import type { db } from "@workspace/db";
import { billAuditsTable } from "@workspace/db/schema";
import { billBalanceFromParts, paiseToRupees, rupeesToPaise } from "../money";

/** bill_audits.change_type for an overpayment flagged at settle time. */
export const OVERPAYMENT_AUDIT_CHANGE_TYPE = "overpayment_flagged";

/** Repo-standard transaction handle type (see auto-voucher.ts, inventoryStockLock.ts). */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type GatewayOverpayment = {
  detected: boolean;
  /** Outstanding (total − paid − refund) before this settlement posts, rupees. */
  outstandingBefore: number;
  /** Money received beyond the outstanding, rupees. > 0 only when detected. */
  excess: number;
};

/**
 * Pure, paise-exact overpayment test for a gateway settle about to post.
 *
 * `paidAmount` is the bill's stored paid amount (already net of refunds — the
 * manual refund route decrements it), so the outstanding is
 * total − paid − refund, the same invariant every settle path enforces.
 *
 * Tolerance mirrors MONEY_EPS_PAISE (1 paise): an excess of exactly one paisa
 * is float noise, not money worth a flag.
 */
export function computeGatewayOverpayment(opts: {
  totalAmount: unknown;
  paidAmount: unknown;
  refundAmount: unknown;
  settledAmount: unknown;
}): GatewayOverpayment {
  const { totalAmount, paidAmount, refundAmount, settledAmount } = opts;
  const outstandingBefore = billBalanceFromParts(
    totalAmount,
    paidAmount,
    refundAmount,
  );
  const settledPaise = rupeesToPaise(settledAmount);
  const excessPaise = settledPaise - rupeesToPaise(outstandingBefore);
  const detected = Number.isFinite(excessPaise) && excessPaise > 1;
  return {
    detected,
    outstandingBefore,
    excess: detected ? paiseToRupees(excessPaise) : 0,
  };
}

/**
 * Marker appended to the NEW payment row's notes so the overpayment is
 * visible exactly where staff read the payment history. Set at insert time
 * only — historical payment rows are never edited.
 */
export function overpaymentNotesSuffix(o: {
  excess: number;
  outstandingBefore: number;
}): string {
  return (
    ` OVERPAYMENT: gateway payment exceeded the outstanding ₹${o.outstandingBefore.toFixed(2)}` +
    ` by ₹${o.excess.toFixed(2)} — flagged for admin reconciliation/refund.` +
    ` Full amount kept on the books; no auto-refund issued.`
  );
}

/**
 * Insert the durable `overpayment_flagged` audit row INSIDE the caller's
 * settlement transaction. If the audit insert fails the settlement rolls
 * back — an overpayment must never settle silently (the gateway retries
 * webhooks, and poll/callback paths are user-retriggerable, so a transient
 * failure self-heals instead of hiding money).
 */
export async function recordOverpaymentAudit(
  tx: DbTx,
  opts: {
    billId: number;
    excess: number;
    outstandingBefore: number;
    settledAmount: number;
    merchantRef: string | null;
    gatewayTxnId: string | null;
    performedBy?: string | null;
  },
): Promise<void> {
  await tx.insert(billAuditsTable).values({
    billId: opts.billId,
    editedBy: opts.performedBy?.trim() || "Gateway Settle",
    reason: "Gateway payment exceeded the bill's outstanding balance",
    changeType: OVERPAYMENT_AUDIT_CHANGE_TYPE,
    oldValue: `outstanding=₹${opts.outstandingBefore.toFixed(2)}, settled=₹${opts.settledAmount.toFixed(2)}`,
    newValue: JSON.stringify({
      excess: Number(opts.excess.toFixed(2)),
      outstandingBefore: Number(opts.outstandingBefore.toFixed(2)),
      settledAmount: Number(opts.settledAmount.toFixed(2)),
      merchantRef: opts.merchantRef ?? null,
      gatewayTxnId: opts.gatewayTxnId ?? null,
      action: "flagged_for_admin_reconciliation",
      note: "No auto-refund issued. Refund the excess via Bill → Refund, or adjust with documented approval.",
    }),
  });
}
