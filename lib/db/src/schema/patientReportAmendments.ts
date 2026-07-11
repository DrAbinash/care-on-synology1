import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// patient_report_amendments — Ticket D7. The linkage table for the STRUCTURED
// report amendment chain: each row records that one signed patient_reports row
// was amended by exactly one NEW signed patient_reports row. The signed rows
// themselves are never modified — a chain is walked through this table.
//
// Chain shape is enforced by the DATABASE, not application checks:
//   • UNIQUE(original_report_id) — a report can be amended at most once
//     (linear chain, never forked; also makes concurrent double-amend a
//     constraint violation instead of a race).
//   • UNIQUE(amended_report_id) — a report can BE the amendment of at most
//     one parent (no merging), which together with the fresh-serial identity
//     of every amendment row makes cycles structurally impossible: a new row
//     id cannot appear earlier in any chain.
//
// DISTINCT from the legacy report_amendments table (smartRadiology.ts), which
// is a draft-keyed free-text addendum log for the legacy flow — untouched.
export const patientReportAmendmentsTable = pgTable(
  "patient_report_amendments",
  {
    id: serial("id").primaryKey(),
    /** The signed patient_reports row being amended (the parent). */
    originalReportId: integer("original_report_id").notNull(),
    /** The NEW signed patient_reports row that amends it. */
    amendedReportId: integer("amended_report_id").notNull(),
    /** The first report of the chain — equals originalReportId for the first
     *  amendment, carried forward on every later one (O(1) chain queries). */
    rootReportId: integer("root_report_id").notNull(),
    /** D1 document_ids on both sides (audit/troubleshooting without JSON digs). */
    originalDocumentId: text("original_document_id").notNull(),
    amendedDocumentId: text("amended_document_id").notNull(),
    /** 1 for the first amendment of a chain, then 2, 3, … */
    sequenceNumber: integer("sequence_number").notNull().default(1),
    /** Mandatory human reason — also recorded on the finalize audit row. */
    reason: text("reason").notNull(),
    amendedById: integer("amended_by_id"),
    amendedByName: text("amended_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    originalUq: uniqueIndex("patient_report_amendments_original_uq").on(t.originalReportId),
    amendedUq: uniqueIndex("patient_report_amendments_amended_uq").on(t.amendedReportId),
    rootIdx: index("patient_report_amendments_root_idx").on(t.rootReportId),
  }),
);

export type PatientReportAmendment = typeof patientReportAmendmentsTable.$inferSelect;
