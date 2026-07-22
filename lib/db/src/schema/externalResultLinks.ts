import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { diagnosticReferralsTable, diagnosticReferralItemsTable } from "./diagnosticReferrals";
import { integrationOutboxTable } from "./integrationOutbox";

// ============================================================================
// External result link: ties a CARE result artefact (pathology patient_report
// or radiology study/report) back to the originating HOPE referral + order, so
// results can be returned to HOPE's longitudinal record and so re-emission is
// idempotent.
//
// Populated by the results reconciler (services/integration/resultsEmitter.ts)
// when a referral-linked order reaches a terminal reporting state. The
// reconciler is decoupled — it does NOT modify patient-reports.ts / radiology.ts.
// ============================================================================
export const externalResultLinksTable = pgTable("external_result_links", {
  id: serial("id").primaryKey(),
  referralId: integer("referral_id").notNull().references(() => diagnosticReferralsTable.id),
  referralItemId: integer("referral_item_id").references(() => diagnosticReferralItemsTable.id),
  careOrderId: integer("care_order_id"),
  careReportId: integer("care_report_id"), // patient_reports.id
  careStudyId: integer("care_study_id"), // radiology_studies.id
  resultType: text("result_type").notNull().default("pathology"), // pathology | radiology
  sourceSystem: text("source_system").notNull().default("HOPE"),
  sourceOrderId: text("source_order_id"), // HOPE diagnostic_orders.order_no
  // preliminary | final | amended
  reportStatus: text("report_status").notNull().default("final"),
  isCritical: boolean("is_critical").notNull().default(false),
  // pending | acknowledged | escalated
  criticalAckStatus: text("critical_ack_status"),
  criticalAckBy: text("critical_ack_by"),
  criticalAckAt: timestamp("critical_ack_at", { withTimezone: true }),
  // Phase 3: critical-result escalation tracking (re-notify if unacknowledged).
  escalationAttempts: integer("escalation_attempts").notNull().default(0),
  lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true }),
  finalisedAt: timestamp("finalised_at", { withTimezone: true }),
  finalisingDoctor: text("finalising_doctor"),
  reportRef: text("report_ref"), // secure report URL or internal ref
  // The outbox event that carried this result to HOPE (idempotency guard).
  emittedOutboxId: integer("emitted_outbox_id").references(() => integrationOutboxTable.id),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ExternalResultLink = typeof externalResultLinksTable.$inferSelect;
export type InsertExternalResultLink = typeof externalResultLinksTable.$inferInsert;
