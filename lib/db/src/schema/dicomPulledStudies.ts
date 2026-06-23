import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

// dicom_pulled_studies — deduplication registry for every study the pull agent
// has retrieved. Checked before issuing any C-MOVE/C-GET to avoid re-pulling
// studies already in the local PACS store.
export const dicomPulledStudiesTable = pgTable("dicom_pulled_studies", {
  id: serial("id").primaryKey(),
  studyInstanceUID:  text("study_instance_uid").notNull().unique(),
  accessionNumber:   text("accession_number"),
  modality:          text("modality"),
  sourceAeTitle:     text("source_ae_title"),
  sourceIp:          text("source_ip"),
  patientName:       text("patient_name"),
  patientId:         text("patient_id"),
  studyDate:         text("study_date"),
  studyTime:         text("study_time"),
  // status lifecycle: NEW → PULLED → PUSHED_TO_PACS (happy path)
  //                         └─ FAILED (error path, goes to retry queue)
  //                   NEW → DUPLICATE_SKIPPED (already present)
  status:            text("status").notNull().default("NEW"),
  hashSignature:     text("hash_signature"),       // sha256(studyUID+date+patient)
  retryCount:        integer("retry_count").notNull().default(0),
  lastError:         text("last_error"),
  pulledAt:          timestamp("pulled_at", { withTimezone: true }),
  pushedToPacsAt:    timestamp("pushed_to_pacs_at", { withTimezone: true }),
  rawPayload:        jsonb("raw_payload"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DicomPulledStudy = typeof dicomPulledStudiesTable.$inferSelect;

// dicom_failed_retrieval_queue — retry queue for failed C-MOVE/C-GET operations.
// The pull agent enqueues failures here; the ERP or the agent itself processes
// retries with exponential back-off.
export const dicomFailedRetrievalQueueTable = pgTable("dicom_failed_retrieval_queue", {
  id: serial("id").primaryKey(),
  studyInstanceUID:  text("study_instance_uid").notNull(),
  accessionNumber:   text("accession_number"),
  modality:          text("modality"),
  sourceAeTitle:     text("source_ae_title"),
  sourceIp:          text("source_ip"),
  failureType:       text("failure_type"),    // C_MOVE_FAILED | C_GET_FAILED | PUSH_FAILED | TIMEOUT
  errorMessage:      text("error_message"),
  retryCount:        integer("retry_count").notNull().default(0),
  maxRetries:        integer("max_retries").notNull().default(5),
  nextRetryAt:       timestamp("next_retry_at", { withTimezone: true }),
  // status: PENDING → IN_PROGRESS → RESOLVED | ABANDONED
  status:            text("status").notNull().default("PENDING"),
  resolvedAt:        timestamp("resolved_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DicomFailedRetrievalQueueItem = typeof dicomFailedRetrievalQueueTable.$inferSelect;
