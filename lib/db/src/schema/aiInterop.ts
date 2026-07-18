/**
 * AI Enterprise Interoperability — Phase P4 (Gates G12–G22).
 *
 * Additive backend storage + link tables for DICOM SR, encapsulated PDF, GSPS/SEG
 * foundations, MPPS / Storage Commitment status, and FHIR export. These are the
 * data layer; byte-level DICOM/DIMSE encoding and live PACS operations run
 * through the EXISTING DICOM agent (services/dicom-pull-agent) + Orthanc, and
 * `dicom_sr_export_queue` (smartRadiology.ts). Nothing here replaces the report:
 * SR/PDF/FHIR are ADDITIONAL exports linked to patient_reports.
 */
import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// ── G12: DICOM Structured Report (TID 1500 content model) ↔ ERP report ──────
export const dicomSrDocumentsTable = pgTable(
  "dicom_sr_documents",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id"), // patient_reports.id (bidirectional link)
    studyInstanceUid: text("study_instance_uid").notNull(),
    // The assigned SR SOP Instance UID (once encoded), and its series.
    srSeriesInstanceUid: text("sr_series_instance_uid"),
    srSopInstanceUid: text("sr_sop_instance_uid"),
    templateId: text("template_id").notNull().default("TID1500"),
    // The SR content tree (measurements/findings/impression/evidence + UID map).
    contentJson: jsonb("content_json").notNull(),
    status: text("status").notNull().default("pending"), // pending | encoded | stored | failed
    pacsInstanceId: text("pacs_instance_id"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    reportIdx: index("dicom_sr_doc_report_idx").on(t.reportId),
    uidIdx: index("dicom_sr_doc_uid_idx").on(t.studyInstanceUid),
  }),
);
export type DicomSrDocument = typeof dicomSrDocumentsTable.$inferSelect;

// ── G13: Encapsulated PDF exports (versioned) ───────────────────────────────
export const encapsulatedPdfExportsTable = pgTable(
  "encapsulated_pdf_exports",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id"),
    studyInstanceUid: text("study_instance_uid").notNull(),
    version: integer("version").notNull().default(1),
    sopInstanceUid: text("sop_instance_uid"),
    pdfSha256: text("pdf_sha256"),
    status: text("status").notNull().default("pending"), // pending | encoded | stored | failed
    pacsInstanceId: text("pacs_instance_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reportIdx: index("encap_pdf_report_idx").on(t.reportId),
    uidVerIdx: index("encap_pdf_uid_version_idx").on(t.studyInstanceUid, t.version),
  }),
);
export type EncapsulatedPdfExport = typeof encapsulatedPdfExportsTable.$inferSelect;

// ── G14: Presentation State (GSPS) foundation — overlays only, no editor ────
export const presentationStatesTable = pgTable(
  "presentation_states",
  {
    id: serial("id").primaryKey(),
    studyInstanceUid: text("study_instance_uid").notNull(),
    referencedSeriesUid: text("referenced_series_uid"),
    referencedSopUid: text("referenced_sop_uid"),
    kind: text("kind").notNull(), // measurement | arrow | roi | window
    payloadJson: jsonb("payload_json").notNull(),
    gspsSopInstanceUid: text("gsps_sop_instance_uid"),
    status: text("status").notNull().default("draft"), // draft | encoded | stored
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uidIdx: index("gsps_uid_idx").on(t.studyInstanceUid) }),
);
export type PresentationState = typeof presentationStatesTable.$inferSelect;

// ── G15: DICOM SEG foundation — storage interface only ──────────────────────
export const segmentationObjectsTable = pgTable(
  "segmentation_objects",
  {
    id: serial("id").primaryKey(),
    studyInstanceUid: text("study_instance_uid").notNull(),
    referencedSeriesUid: text("referenced_series_uid"),
    segSopInstanceUid: text("seg_sop_instance_uid"),
    label: text("label"),
    storageRef: text("storage_ref"), // object-store / PACS reference
    status: text("status").notNull().default("registered"), // registered | stored
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uidIdx: index("seg_uid_idx").on(t.studyInstanceUid) }),
);
export type SegmentationObject = typeof segmentationObjectsTable.$inferSelect;

// ── G16: MPPS events + Storage Commitment status ────────────────────────────
export const mppsEventsTable = pgTable(
  "mpps_events",
  {
    id: serial("id").primaryKey(),
    studyInstanceUid: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    mppsSopInstanceUid: text("mpps_sop_instance_uid"),
    status: text("status").notNull(), // IN_PROGRESS | COMPLETED | DISCONTINUED
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uidIdx: index("mpps_uid_idx").on(t.studyInstanceUid) }),
);
export type MppsEvent = typeof mppsEventsTable.$inferSelect;

export const storageCommitmentsTable = pgTable(
  "storage_commitments",
  {
    id: serial("id").primaryKey(),
    studyInstanceUid: text("study_instance_uid"),
    sopInstanceUid: text("sop_instance_uid"),
    transactionUid: text("transaction_uid"),
    status: text("status").notNull().default("requested"), // requested | committed | failed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({ uidIdx: index("storage_commit_uid_idx").on(t.studyInstanceUid) }),
);
export type StorageCommitment = typeof storageCommitmentsTable.$inferSelect;

// ── G17: FHIR export log (resources generated; no external send) ────────────
export const fhirExportLogTable = pgTable(
  "fhir_export_log",
  {
    id: serial("id").primaryKey(),
    resourceType: text("resource_type").notNull(), // DiagnosticReport | ImagingStudy | Observation | ServiceRequest
    reportId: integer("report_id"),
    studyInstanceUid: text("study_instance_uid"),
    resourceJson: jsonb("resource_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index("fhir_export_type_idx").on(t.resourceType),
    reportIdx: index("fhir_export_report_idx").on(t.reportId),
  }),
);
export type FhirExportLog = typeof fhirExportLogTable.$inferSelect;
