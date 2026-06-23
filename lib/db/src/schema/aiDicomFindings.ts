import {
  pgTable, serial, integer, text, boolean, timestamp, index, real,
} from "drizzle-orm/pg-core";

// Phase 3: AI-Powered DICOM Findings — auto-suggested findings from DICOM metadata
// Each row stores an AI-generated finding suggestion based on parsed DICOM tags.
// Status: pending | reviewed | accepted | rejected
export const aiDicomFindingsTable = pgTable(
  "ai_dicom_findings",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id").notNull(),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    // Parsed DICOM metadata used for suggestion
    modality: text("modality"),
    bodyPart: text("body_part"),
    studyDescription: text("study_description"),
    // AI-generated findings
    suggestedFindings: text("suggested_findings"),
    suggestedImpression: text("suggested_impression"),
    // Confidence 0-100
    confidenceScore: real("confidence_score"),
    // Safety label
    aiSafetyLabel: text("ai_safety_label").notNull().default("AI Draft – Requires Radiologist Review"),
    // Review workflow
    status: text("status").notNull().default("pending"), // pending | reviewed | accepted | rejected
    reviewedById: integer("reviewed_by_id"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedNotes: text("reviewed_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    worklistIdx: index("ai_dicom_findings_wl_idx").on(t.worklistId),
    uidIdx: index("ai_dicom_findings_uid_idx").on(t.studyInstanceUID),
    statusIdx: index("ai_dicom_findings_status_idx").on(t.status),
  }),
);
export type AiDicomFinding = typeof aiDicomFindingsTable.$inferSelect;
