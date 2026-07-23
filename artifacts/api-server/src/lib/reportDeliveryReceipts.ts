// Delivery-receipt persistence for STAFF-SELECTED WhatsApp report sends.
// Isolated here so the shared routes/whatsapp.ts webhook only needs a single
// import + fire-and-forget call. Additive, non-financial, never throws.
import { db } from "@workspace/db";
import { reportDeliveryReceiptsTable } from "@workspace/db/schema";
import { and, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { logger } from "./logger";

export type MetaReceiptStatus = "sent" | "delivered" | "read" | "failed";

export interface MetaStatusEntry {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ title?: string; message?: string; code?: number }>;
}

// Monotonic rank so an out-of-order callback can never regress a receipt
// (e.g. a late "delivered" arriving after "read" must not undo the read state).
const RANK: Record<MetaReceiptStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 2 };

/** Normalize a raw Meta status string to one of our tracked states (pure; unit-tested). */
export function normalizeMetaStatus(raw: string | undefined | null): MetaReceiptStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "sent" || s === "delivered" || s === "read" || s === "failed") return s;
  return null;
}

/** Convert a Meta unix-seconds timestamp string to a Date, falling back to now. */
export function receiptTimestamp(ts: string | undefined | null): Date {
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return new Date();
}

/**
 * Apply a batch of Meta `statuses[]` callbacks to tracked receipts.
 * Fire-and-forget: any failure is logged, never thrown (the webhook has
 * already 200-ed Meta before this runs).
 */
export async function applyReportDeliveryReceiptStatuses(statuses: MetaStatusEntry[]): Promise<void> {
  if (!Array.isArray(statuses) || statuses.length === 0) return;
  for (const st of statuses) {
    const providerMessageId = st.id;
    const mapped = normalizeMetaStatus(st.status);
    if (!providerMessageId || !mapped) continue;
    const at = receiptTimestamp(st.timestamp);
    try {
      if (mapped === "read") {
        await db.update(reportDeliveryReceiptsTable)
          .set({ status: "read", readAt: sql`COALESCE(${reportDeliveryReceiptsTable.readAt}, ${at})`, deliveredAt: sql`COALESCE(${reportDeliveryReceiptsTable.deliveredAt}, ${at})` })
          .where(and(eq(reportDeliveryReceiptsTable.providerMessageId, providerMessageId), notInArray(reportDeliveryReceiptsTable.status, ["read"])));
      } else if (mapped === "delivered") {
        await db.update(reportDeliveryReceiptsTable)
          .set({ status: "delivered", deliveredAt: sql`COALESCE(${reportDeliveryReceiptsTable.deliveredAt}, ${at})` })
          .where(and(eq(reportDeliveryReceiptsTable.providerMessageId, providerMessageId), notInArray(reportDeliveryReceiptsTable.status, ["read", "delivered", "failed"])));
      } else if (mapped === "failed") {
        const errMsg = st.errors?.[0]?.message || st.errors?.[0]?.title || "delivery failed";
        await db.update(reportDeliveryReceiptsTable)
          .set({ status: "failed", failedAt: at, lastError: errMsg })
          .where(and(eq(reportDeliveryReceiptsTable.providerMessageId, providerMessageId), notInArray(reportDeliveryReceiptsTable.status, ["read", "delivered"])));
      }
      // 'sent' is the insert-time default — no downgrade needed.
      void RANK; // rank table documents intended ordering; guards above enforce it
    } catch (err) {
      logger.warn({ err, providerMessageId, status: mapped }, "[report-delivery-receipts] status apply failed (non-fatal)");
    }
  }
}

export interface RecordReceiptInput {
  reportId?: number | null;
  patientId?: number | null;
  providerMessageId?: string | null;
  phone: string;
  reportNumber?: string | null;
  testName?: string | null;
  patientName?: string | null;
  viewerUrl?: string | null;
  status: "sent" | "failed";
  sentBy?: string | null;
  sentByName?: string | null;
  lastError?: string | null;
}

/** Insert a receipt row for a staff-triggered send. Returns the new id (or null on failure). */
export async function recordReceipt(input: RecordReceiptInput): Promise<number | null> {
  try {
    const [row] = await db.insert(reportDeliveryReceiptsTable).values({
      reportId: input.reportId ?? null,
      patientId: input.patientId ?? null,
      providerMessageId: input.providerMessageId ?? null,
      phone: input.phone,
      reportNumber: input.reportNumber ?? null,
      testName: input.testName ?? null,
      patientName: input.patientName ?? null,
      viewerUrl: input.viewerUrl ?? null,
      status: input.status,
      failedAt: input.status === "failed" ? new Date() : null,
      sentBy: input.sentBy ?? null,
      sentByName: input.sentByName ?? null,
      lastError: input.lastError ?? null,
    }).returning({ id: reportDeliveryReceiptsTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "[report-delivery-receipts] recordReceipt failed (non-fatal)");
    return null;
  }
}

/**
 * Receipts eligible for an unread-reminder: still sent/delivered (never read),
 * older than `olderThanHours`, and under the reminder cap. Ordered oldest-first.
 */
export async function findRemindableReceipts(opts: { olderThanHours: number; maxReminders: number; limit?: number }) {
  const cutoff = new Date(Date.now() - opts.olderThanHours * 60 * 60 * 1000);
  return db.select().from(reportDeliveryReceiptsTable)
    .where(and(
      inArray(reportDeliveryReceiptsTable.status, ["sent", "delivered"]),
      lt(reportDeliveryReceiptsTable.sentAt, cutoff),
      lt(reportDeliveryReceiptsTable.remindersCount, opts.maxReminders),
    ))
    .orderBy(reportDeliveryReceiptsTable.sentAt)
    .limit(opts.limit ?? 200);
}

/** Bump the reminder counter after a reminder send. */
export async function markReminded(id: number, providerMessageId?: string | null): Promise<void> {
  try {
    await db.update(reportDeliveryReceiptsTable)
      .set({
        remindersCount: sql`${reportDeliveryReceiptsTable.remindersCount} + 1`,
        lastReminderAt: new Date(),
        ...(providerMessageId ? { providerMessageId } : {}),
      })
      .where(eq(reportDeliveryReceiptsTable.id, id));
  } catch (err) {
    logger.warn({ err, id }, "[report-delivery-receipts] markReminded failed (non-fatal)");
  }
}
