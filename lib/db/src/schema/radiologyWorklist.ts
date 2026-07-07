import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// radiology_worklist — populated by external PACS (Conquest) via the internal
// intake API. Parallel to radiology_studies (the ERP's own billing-driven
// workflow). This table is the PACS-pushed mirror that drives RIS automation.
//
// Statuses (uppercase to distinguish from the existing snake_case worklist):
//   STUDY_RECEIVED → AI_DRAFT_READY → REPORT_IN_PROGRESS → REPORT_FINAL → DELIVERED
export const radiologyWorklistTable = pgTable(
  "radiology_worklist",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id"),              // optional FK → radiology_studies.id
    patientId: integer("patient_id"),          // resolved FK → patients.id (null if unmatched)
    dicomPatientId: text("dicom_patient_id"),  // raw DICOM PatientID field (any string format)
    patientMatchStatus: text("patient_match_status").notNull().default("UNMATCHED"), // MATCHED | UNMATCHED
    patientName: text("patient_name").notNull(),
    age: text("age"),
    sex: text("sex"),
    modality: text("modality").notNull().default("OT"),
    studyDescription: text("study_description"),
    studyDate: text("study_date"),
    accessionNumber: text("accession_number"), // nullable, NOT globally unique — see radiologyWorklist.ts header note
    studyInstanceUID: text("study_instance_uid"),
    aeTitle: text("ae_title"),
    ipAddress: text("ip_address"),
    port: integer("port"),
    referringDoctor: text("referring_doctor"),
    weasisUrl: text("weasis_url"),
    // ← PACS auto-puller metadata
    sourcePacs: text("source_pacs"),
    sourceAeTitle: text("source_ae_title"),
    dicomMetadata: text("dicom_metadata"),
    // Worklist lifecycle status
    status: text("status").notNull().default("STUDY_RECEIVED"),
    assignedRadiologist: text("assigned_radiologist"),
    // AI draft state: NONE | PENDING | READY | ERROR
    aiDraftStatus: text("ai_draft_status").notNull().default("NONE"),
    aiDraftJson: text("ai_draft_json"),        // JSON of last AI draft payload
    // Phase 11: Radiologist feedback on AI draft (thumbs up/down + text)
    aiFeedback: text("ai_feedback"),
    aiFeedbackAt: timestamp("ai_feedback_at", { withTimezone: true }),
    reportId: integer("report_id"),            // FK → patient_reports.id once saved
    // Delivery: null | READY_TO_SEND | SENT
    // NOTE: automated sending is NOT implemented yet — only flag the status.
    deliveryStatus: text("delivery_status"),
    // Anti-forgery mismatch protection fields
    matchScore: text("match_score").notNull().default("RED"),
    matchPoints: integer("match_points").notNull().default(0),
    matchReasons: text("match_reasons"),
    matchWarnings: text("match_warnings"),
    matchDecision: text("match_decision").notNull().default("PENDING"),
    matchApprovedBy: text("match_approved_by"),
    matchApprovedAt: timestamp("match_approved_at", { withTimezone: true }),
    matchOverrideReason: text("match_override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    // accession_number is external DICOM data and can legitimately repeat
    // across different studies when a modality is misconfigured (e.g. a
    // referring doctor's name pushed instead of a real accession) — it is
    // NOT globally unique. study_instance_uid is the true DICOM identifier,
    // so that's what's enforced unique here (nulls excluded so older rows
    // without a UID are unaffected).
    byAccession: index("radiology_worklist_accession_idx").on(t.accessionNumber),
    uidUq: uniqueIndex("radiology_worklist_uid_uq").on(t.studyInstanceUID).where(sql`${t.studyInstanceUID} IS NOT NULL`),
    byUid: index("radiology_worklist_uid_idx").on(t.studyInstanceUID),
    byStatus: index("radiology_worklist_status_idx").on(t.status),
    byPatient: index("radiology_worklist_patient_idx").on(t.patientId),
  }),
);

// radiology_audit_log — immutable append-only log for the RIS automation.
// Actions: STUDY_RECEIVED | AI_DRAFT_GENERATED | REPORT_EDITED | REPORT_FINAL
//          STATUS_CHANGED | DELIVERY_STATUS_CHANGED | REPORT_STATUS_UPDATED
export const radiologyAuditLogTable = pgTable(
  "radiology_audit_log",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id"),
    accessionNumber: text("accession_number"),
    action: text("action").notNull(),
    actor: text("actor"),
    details: text("details"),                  // JSON string with contextual data
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorklist: index("radiology_audit_log_worklist_idx").on(t.worklistId),
    byAction: index("radiology_audit_log_action_idx").on(t.action),
  }),
);

export type RadiologyWorklist = typeof radiologyWorklistTable.$inferSelect;
export type RadiologyAuditLog = typeof radiologyAuditLogTable.$inferSelect;
