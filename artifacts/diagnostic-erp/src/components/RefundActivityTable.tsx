/**
 * RefundActivityTable.tsx — the refund rows of an owner's activity log.
 *
 * Two screens list the refunds an owner has to read without opening the bill: My
 * Daily Summary's activity log and the Dashboard's control logs. They render this
 * one table so the same refund cannot answer "which bill, whose study, why was the
 * money back" on one screen and print a database row id on the other — which is
 * exactly how the two lists had drifted.
 *
 * Every column is a fact the server already knows. A cell that has nothing to show
 * says so ("no reason recorded", "No referral") instead of going blank, because a
 * blank cannot be told apart from a bug.
 */

import { Link } from "wouter";
import { Clock } from "lucide-react";

/** What kind of refund it was, read out of the payment note server-side. */
export type RefundKind = "cancellation" | "test-cancel" | "test-swap" | "refund" | "other";

const REFUND_KIND_LABEL: Record<RefundKind, string> = {
  cancellation: "full cancellation",
  "test-cancel": "test cancelled",
  "test-swap": "test swapped",
  refund: "refund",
  other: "refund · unclassified",
};

export type RefundActivityRow = {
  id: number;
  billId: number;
  /** The clinic's bill number. The row id is never a substitute for it. */
  billNumber?: string | null;
  amount: number;
  method: string;
  /** Who paid the cash out — not the same person as who made the bill. */
  recordedBy?: string | null;
  patientName?: string | null;
  referringDoctor?: string | null;
  billStatus?: string | null;
  refundKind?: RefundKind;
  reason?: string | null;
  createdAt: string;
  /** Omit on a screen that never looked it up; the "of 5 Oct" badge stays quiet. */
  billCreatedAt?: string | null;
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function time(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

/**
 * "of 5 Oct" when the refund is against a bill raised on a different day than the
 * one the money went back on — today's drawer paying for an earlier transaction.
 * Days are compared in Asia/Kolkata, not UTC: 19:30Z on 7 Oct is 01:00 IST on
 * 8 Oct, and calling that an old bill would be wrong. Returns null when either
 * date is missing or they agree.
 */
export function billRaisedOnAnotherDay(billCreatedAt: string, refundedAt: string): string | null {
  const dayKey = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  };
  const billDay = dayKey(billCreatedAt);
  const refundDay = dayKey(refundedAt);
  if (!billDay || !refundDay || billDay === refundDay) return null;
  return new Date(billCreatedAt).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
}

const TH = "px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300";

export function RefundActivityTable({
  refunds,
  testId,
}: {
  refunds: RefundActivityRow[];
  testId: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid={testId}>
        <thead className="bg-gray-50 dark:bg-muted/30 sticky top-0">
          <tr>
            <th className={`${TH} whitespace-nowrap`}>Bill #</th>
            <th className={TH}>Patient</th>
            <th className={TH}>Referral doctor</th>
            <th className={`${TH} whitespace-nowrap`}>Refunded</th>
            <th className={TH}>Reason</th>
            <th className={`${TH} whitespace-nowrap`}>When · by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-card-border">
          {refunds.map((r) => {
            const oldBillDay = r.billCreatedAt
              ? billRaisedOnAnotherDay(r.billCreatedAt, r.createdAt)
              : null;
            return (
              <tr key={r.id} className="hover:bg-amber-50/50 dark:hover:bg-muted/20">
                <td className="px-3 py-2 font-semibold whitespace-nowrap">
                  <Link href={`/billing/${r.billId}`} className="text-primary hover:underline">
                    {r.billNumber || `#${r.billId}`}
                  </Link>
                  {oldBillDay && (
                    <span
                      className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-100 text-gray-600 dark:bg-muted dark:text-gray-300"
                      title={`Bill raised on ${oldBillDay}`}
                    >
                      of {oldBillDay}
                    </span>
                  )}
                  {r.billStatus === "cancelled" && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                      bill cancelled
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[150px] truncate">
                  {r.patientName || "—"}
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[150px] truncate">
                  {r.referringDoctor || <span className="text-gray-400">No referral</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="font-semibold text-amber-700 dark:text-amber-400">{inr(Math.abs(Number(r.amount)))}</span>
                  <span className="text-gray-500"> via {r.method}</span>
                  <span className="block text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                    {REFUND_KIND_LABEL[r.refundKind ?? "refund"]}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[260px]">
                  {r.reason
                    ? <span className="line-clamp-2">{r.reason}</span>
                    : <span className="text-gray-400 italic" data-testid={`${testId}-no-reason`}>no reason recorded</span>}
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                  <span className="flex items-center gap-1"><Clock size={10} />{time(r.createdAt)}</span>
                  <span className="block text-[10px] text-gray-500">{r.recordedBy || "Unknown"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
