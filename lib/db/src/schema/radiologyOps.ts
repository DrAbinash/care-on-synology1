/**
 * radiologyOps.ts — Ticket BEND-1 (Backend v1 closure).
 *
 * Operational durability tables for the radiology backend:
 *
 *  - radiology_redelivery_obligations: the durable D10 store for "a recipient
 *    who received an earlier revision is owed the amended report". One OPEN
 *    obligation per (amended revision, channel, recipient); recipients are
 *    stored MASKED plus a fingerprint (sha256) for matching — the raw address
 *    stays only where it already lives (report_shares), under the existing
 *    permission policy.
 *  - radiology_pacs_archive_revisions: per-report-REVISION PACS archive state
 *    (the legacy per-study columns keep only the latest attempt and overwrite
 *    the Orthanc instance id; this table preserves every revision's record).
 *  - radiology_ops_checks: latest results of operational verifications
 *    (audit-chain, structured drift, backup, restore-verification) so health
 *    can report last-verified time + result instead of guessing.
 */

import {
  pgTable, serial, text, integer, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Re-delivery obligations (D10 closure) ───────────────────────────────────

export const radiologyRedeliveryObligationsTable = pgTable(
  "radiology_redelivery_obligations",
  {
    id: serial("id").primaryKey(),
    /** Chain root (patient_reports.id of revision 1). */
    rootReportId: integer("root_report_id").notNull(),
    /** The amended revision this obligation is FOR (delivery target). */
    reportId: integer("report_id").notNull(),
    /** Sequence number of reportId within its chain (D7 linkage). */
    sequenceNumber: integer("sequence_number").notNull(),
    channel: text("channel").notNull(), // whatsapp | email | pdf | print | pacs
    /** Masked display form (never the raw address). */
    recipientMasked: text("recipient_masked").notNull(),
    /** sha256(channel + ":" + normalized raw recipient) — matching only. */
    recipientFingerprint: text("recipient_fingerprint").notNull(),
    /** pending | acknowledged | dismissed | queued | sent | failed | completed */
    status: text("status").notNull().default("pending"),
    /** report_shares.id of the PRIOR delivery that created this duty. */
    sourceShareId: integer("source_share_id"),
    /** The prior revision that was delivered to this recipient. */
    sourceReportId: integer("source_report_id"),
    failureReason: text("failure_reason"),
    actedBy: text("acted_by"),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byRoot: index("rro_root_idx").on(t.rootReportId),
    byReport: index("rro_report_idx").on(t.reportId),
    byStatus: index("rro_status_idx").on(t.status),
    // NOTE: the "one OPEN obligation per (report, channel, recipient)" rule is
    // a PARTIAL unique index (WHERE status IN open states) created in the
    // migration — drizzle-orm's pgTable can't express partial uniqueness.
  }),
);
export type RadiologyRedeliveryObligation = typeof radiologyRedeliveryObligationsTable.$inferSelect;

// ── Per-revision PACS archive state ──────────────────────────────────────────

export const radiologyPacsArchiveRevisionsTable = pgTable(
  "radiology_pacs_archive_revisions",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),          // radiology_studies.id
    reportId: integer("report_id").notNull(),        // the archived revision
    rootReportId: integer("root_report_id"),
    sequenceNumber: integer("sequence_number"),
    /** pending | success | failed | superseded (a newer revision archived) */
    status: text("status").notNull().default("pending"),
    orthancInstanceId: text("orthanc_instance_id"),
    detail: text("detail"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("rpar_study_idx").on(t.studyId),
    byReport: uniqueIndex("rpar_report_uq").on(t.reportId), // one row per revision
    byStatus: index("rpar_status_idx").on(t.status),
  }),
);
export type RadiologyPacsArchiveRevision = typeof radiologyPacsArchiveRevisionsTable.$inferSelect;

// ── Operational verification results ────────────────────────────────────────

export const radiologyOpsChecksTable = pgTable(
  "radiology_ops_checks",
  {
    id: serial("id").primaryKey(),
    /** audit_chain | structured_drift | restore_verification | consistency */
    checkName: text("check_name").notNull(),
    /** pass | warn | fail */
    status: text("status").notNull(),
    detail: jsonb("detail"),
    ranBy: text("ran_by"),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byNameTime: index("roc_name_time_idx").on(t.checkName, t.ranAt),
  }),
);
export type RadiologyOpsCheck = typeof radiologyOpsChecksTable.$inferSelect;
