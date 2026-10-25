import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

/**
 * report_custody_events — the append-only chain of custody for a PHYSICAL report.
 *
 * One row per accountable human act. Never updated in place, never deleted: a
 * correction inserts a new row pointing at the row it corrects and closes that
 * row's `validUntil`. This is the record that answers "who handled this report,
 * and when" when a report is lost, mis-delivered or disputed — which nothing
 * else in the schema could answer, because `patient_reports.status='delivered'`
 * means "shared via PDF/WhatsApp/Email/Print at least once" and printing sets it.
 *
 * Soft references only (report_id / patient_id / bill_id are plain integers),
 * matching report_delivery_receipts: no FK ordering constraint on a restored
 * volume, and no way for a custody row to be lost to a cascade.
 *
 * Created by migrations/zzzzzzzzzzzzzzzzzzzzzzz_report_delivery_custody.sql.
 */

export const REPORT_CUSTODY_EVENTS = [
  "REPORT_PREPARED",
  "SIGNED_PAPER_TRANSFERRED",
  "RECEIVED_AT_DELIVERY_COUNTER",
  "PHYSICALLY_HANDED_OVER",
  "DELIVERY_CORRECTED",
  "CUSTODY_DISCREPANCY_RECORDED",
  "REMOVED_FROM_COUNTER",
] as const;

export type ReportCustodyEvent = (typeof REPORT_CUSTODY_EVENTS)[number];

export const REPORT_CUSTODY_OUTCOMES = ["completed", "discrepancy"] as const;

/**
 * The physical states a report can be in, derived from the ledger. `null` means
 * "not in the physical system" — it is what every pre-go-live row reads as, and
 * it is never backfilled, because a print-derived `delivered` is not evidence
 * that paper reached the counter.
 */
export const REPORT_PHYSICAL_STATES = [
  "AT_REPORTING",
  "IN_TRANSIT",
  "AT_COUNTER",
  "HANDED_OVER",
  "DISCREPANCY",
] as const;

export type ReportPhysicalState = (typeof REPORT_PHYSICAL_STATES)[number];

export const reportCustodyEventsTable = pgTable(
  "report_custody_events",
  (t) => ({
    id: serial("id").primaryKey(),
    event: text("event").notNull(),
    outcome: text("outcome").notNull().default("completed"),
    /** NULL while this row is the current state; set when a correction closes it. */
    validUntil: timestamp("valid_until", { withTimezone: true }),

    reportId: integer("report_id").notNull(),
    /** Amendment-chain ordinal at the time of the act — a superseded revision
     *  stays distinguishable from the one the patient should have been given. */
    reportRevision: integer("report_revision").notNull().default(1),
    reportNumber: text("report_number").notNull(),
    origin: text("origin"),

    patientId: integer("patient_id").notNull(),
    billId: integer("bill_id"),
    orderId: integer("order_id"),
    orderTestId: integer("order_test_id"),
    accessionNumber: text("accession_number"),
    /** Test NAME only. A custody row must never carry report body text — the
     *  delivery counter is not entitled to the clinical content. */
    testName: text("test_name"),

    /** Snapshots taken from the authenticated session, never from the request
     *  body, so a renamed or deleted account cannot retroactively change who
     *  acknowledged the paper. */
    actorUserId: integer("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    sessionId: integer("session_id").notNull(),
    sessionIp: text("session_ip"),
    sessionUserAgent: text("session_user_agent"),

    scannedCode: text("scanned_code"),
    /** Required with no default: an event without its verification evidence is
     *  indistinguishable from an event that verified nothing. */
    verification: jsonb("verification").notNull(),
    paymentSnapshot: jsonb("payment_snapshot").notNull(),

    recipientCategory: text("recipient_category"),
    recipientName: text("recipient_name"),
    overrideReason: text("override_reason"),
    overrideByUserId: integer("override_by_user_id"),
    /** Batch receiving records one event per report; these tie them back to the
     *  single clerk action that produced them. */
    batchId: uuid("batch_id"),
    batchSeq: integer("batch_seq"),
    correctsEventId: integer("corrects_event_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => ({
    eventChk: check(
      "report_custody_events_event_chk",
      sql`${t.event} IN ('REPORT_PREPARED', 'SIGNED_PAPER_TRANSFERRED', 'RECEIVED_AT_DELIVERY_COUNTER', 'PHYSICALLY_HANDED_OVER', 'DELIVERY_CORRECTED', 'CUSTODY_DISCREPANCY_RECORDED', 'REMOVED_FROM_COUNTER')`,
    ),
    outcomeChk: check("report_custody_events_outcome_chk", sql`${t.outcome} IN ('completed', 'discrepancy')`),
    /** A replayed request writes one event, not two. */
    idempotencyUq: uniqueIndex("rce_idempotency_uq").on(t.idempotencyKey),
    /** One open counter receipt per report revision, however many clerks confirm
     *  at once. A duplicate scan is refused by the database, not only by the UI. */
    openReceiptUq: uniqueIndex("rce_open_receipt_uq")
      .on(t.reportId, t.reportRevision)
      .where(sql`${t.event} = 'RECEIVED_AT_DELIVERY_COUNTER' AND ${t.validUntil} IS NULL`),
    /** A report cannot be handed over twice. */
    openHandoverUq: uniqueIndex("rce_open_handover_uq")
      .on(t.reportId, t.reportRevision)
      .where(sql`${t.event} = 'PHYSICALLY_HANDED_OVER' AND ${t.validUntil} IS NULL`),
    byReport: index("rce_report_idx").on(t.reportId, t.createdAt),
    byPatient: index("rce_patient_idx").on(t.patientId),
    byBill: index("rce_bill_idx").on(t.billId),
    byActor: index("rce_actor_idx").on(t.actorUserId, t.createdAt),
    byEvent: index("rce_event_idx").on(t.event, t.createdAt),
    byBatch: index("rce_batch_idx").on(t.batchId, t.batchSeq),
  }),
);

export type ReportCustodyEventRow = typeof reportCustodyEventsTable.$inferSelect;
export type InsertReportCustodyEvent = typeof reportCustodyEventsTable.$inferInsert;

/**
 * The ledger's authority is the events themselves. `patient_reports.physical_state`
 * is a derived, indexed projection maintained in the same transaction as the
 * event that produced it — so a queue read is fast, and a suspected drift can
 * always be recomputed from this table rather than trusted.
 */
