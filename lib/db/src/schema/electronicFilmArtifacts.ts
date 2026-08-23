import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { radiologyStudiesTable } from "./radiology";
import { integrationOutboxTable } from "./integrationOutbox";

/** Ingest checkpoints for DicomToWindows → CARE electronic film pipeline. */
export const ELECTRONIC_FILM_INGEST_STATUSES = [
  "DISCOVERED",
  "FETCHING",
  "FETCHED",
  "MATCHED",
  "MATCH_REQUIRED",
  "STORED",
  "HOPE_PENDING",
  "HOPE_SENT",
  "FAILED",
] as const;

export type ElectronicFilmIngestStatus = typeof ELECTRONIC_FILM_INGEST_STATUSES[number];

export const ELECTRONIC_FILM_MATCH_METHODS = [
  "STUDY_UID",
  "ACCESSION",
  "ORDER",
  "MANUAL",
] as const;

export type ElectronicFilmMatchMethod = typeof ELECTRONIC_FILM_MATCH_METHODS[number];

export const electronicFilmArtifactsTable = pgTable(
  "electronic_film_artifacts",
  {
    id: serial("id").primaryKey(),
    sourceSystem: text("source_system").notNull().default("DICOMTOWINDOWS"),
    sourceJobKey: text("source_job_key").notNull(),
    ingestStatus: text("ingest_status").notNull().default("DISCOVERED"),
    studyId: integer("study_id").references(() => radiologyStudiesTable.id),
    orderId: integer("order_id"),
    patientId: integer("patient_id"),
    studyInstanceUid: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    dicomPatientId: text("dicom_patient_id"),
    modality: text("modality"),
    studyDescription: text("study_description"),
    studyDate: text("study_date"),
    sourceAe: text("source_ae"),
    filmSessionUid: text("film_session_uid"),
    identitySummary: text("identity_summary"),
    matchMethod: text("match_method"),
    matchedBy: text("matched_by"),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    matchLocked: boolean("match_locked").notNull().default(false),
    filePath: text("file_path"),
    fileName: text("file_name"),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    artifactHash: text("artifact_hash"),
    previewPath: text("preview_path"),
    pageCount: integer("page_count"),
    imageCount: integer("image_count"),
    version: integer("version").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededById: integer("superseded_by_id"),
    hopeDeliveryStatus: text("hope_delivery_status"),
    hopeSentAt: timestamp("hope_sent_at", { withTimezone: true }),
    hopeDocumentRef: text("hope_document_ref"),
    emittedOutboxId: integer("emitted_outbox_id").references(() => integrationOutboxTable.id),
    accessToken: text("access_token"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    errorMessage: text("error_message"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    sourceJobUq: uniqueIndex("electronic_film_source_job_uidx").on(t.sourceSystem, t.sourceJobKey),
    studyIdx: index("electronic_film_study_idx").on(t.studyId),
    ingestStatusIdx: index("electronic_film_ingest_status_idx").on(t.ingestStatus),
  }),
);

export type ElectronicFilmArtifact = typeof electronicFilmArtifactsTable.$inferSelect;
export type InsertElectronicFilmArtifact = typeof electronicFilmArtifactsTable.$inferInsert;
