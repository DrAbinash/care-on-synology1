/**
 * Same-day post-closure markers (IST calendar).
 *
 * After a drawer / overall day close, billing stays allowed. Activity that
 * lands on the *same IST calendar day* as the close is "same-day after close"
 * and must stay loud in post-closure callouts AND stay distinctly marked when
 * those rows reappear as the next open-window / next-day additions.
 */
import { dateToISTString } from "./istDate";

export function isSameDayAfterClose(
  eventAt: Date | string | null | undefined,
  closedAt: Date | string | null | undefined,
): boolean {
  if (eventAt == null || closedAt == null) return false;
  const event = typeof eventAt === "string" ? new Date(eventAt) : eventAt;
  const closed = typeof closedAt === "string" ? new Date(closedAt) : closedAt;
  if (Number.isNaN(event.getTime()) || Number.isNaN(closed.getTime())) return false;
  if (!(event.getTime() > closed.getTime())) return false;
  return dateToISTString(event) === dateToISTString(closed);
}

export type SameDayAfterCloseSummary = {
  billCount: number;
  billTotal: number;
  paymentCount: number;
  paymentTotal: number;
};

export function emptySameDayAfterCloseSummary(): SameDayAfterCloseSummary {
  return { billCount: 0, billTotal: 0, paymentCount: 0, paymentTotal: 0 };
}

export function summarizeSameDayBills(
  bills: Array<{ createdAt?: Date | string | null; totalAmount?: number }>,
  closedAt: Date | string | null | undefined,
): Pick<SameDayAfterCloseSummary, "billCount" | "billTotal"> {
  let billCount = 0;
  let billTotal = 0;
  for (const b of bills) {
    if (!isSameDayAfterClose(b.createdAt, closedAt)) continue;
    billCount += 1;
    billTotal += Number(b.totalAmount ?? 0) || 0;
  }
  return { billCount, billTotal };
}

export function summarizeSameDayPayments(
  payments: Array<{ createdAt?: Date | string | null; amount?: number }>,
  closedAt: Date | string | null | undefined,
): Pick<SameDayAfterCloseSummary, "paymentCount" | "paymentTotal"> {
  let paymentCount = 0;
  let paymentTotal = 0;
  for (const p of payments) {
    if (!isSameDayAfterClose(p.createdAt, closedAt)) continue;
    paymentCount += 1;
    paymentTotal += Number(p.amount ?? 0) || 0;
  }
  return { paymentCount, paymentTotal };
}
