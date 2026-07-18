/**
 * Canonical Study crosswalk — Phase P0 / Gate G3.
 *
 * The single logical study identity, anchored on `studyInstanceUID` (the DICOM
 * imaging identity), mapping it to the existing spines:
 *   - radiology_studies.id  — the integer surrogate used by orders, bills,
 *     patient_reports and ai_job_queue.study_id (the order/financial spine).
 *   - radiology_worklist.id — the PACS-pushed reporting/queue spine.
 *   - dicom_incoming_studies.id — the acquisition-gateway arrival record.
 *
 * This is a THIN crosswalk, not a fourth study spine: it holds no clinical
 * data, only the mapping. Its own `id` is the stable `canonicalStudyId`
 * surrogate referenced by later phases. See
 * docs/architecture/radiology-ai/V1.1_IMPLEMENTATION_CONSTITUTION.md §4.
 */
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { radiologyStudiesTable } from "./radiology";

export const canonicalStudyTable = pgTable(
  "canonical_study",
  {
    id: serial("id").primaryKey(), // the stable canonicalStudyId surrogate
    // Canonical imaging identity. Unique — one canonical study per DICOM UID.
    studyInstanceUid: text("study_instance_uid").notNull().unique(),
    // Order/financial spine surrogate (nullable until a study row is linked).
    radiologyStudyId: integer("radiology_study_id").references(() => radiologyStudiesTable.id),
    // Reporting/queue spine (radiology_worklist.id) — nullable, no hard FK so a
    // crosswalk row can exist before the worklist entry does.
    worklistId: integer("worklist_id"),
    // Acquisition-gateway arrival record (dicom_incoming_studies.id) — nullable.
    dicomIncomingId: integer("dicom_incoming_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    radStudyIdx: index("canonical_study_rad_study_idx").on(t.radiologyStudyId),
  }),
);
export type CanonicalStudy = typeof canonicalStudyTable.$inferSelect;
