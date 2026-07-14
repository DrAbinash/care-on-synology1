import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Generic, module-agnostic record of a scanned/uploaded document, reused by
 * Form F, Patient Registration, Expenses, and Banking — the shared document
 * scan service's persistence layer. Modeled on the (module, entityType,
 * entityId) convention already used by auditLogsTable rather than inventing
 * a new polymorphic-reference pattern.
 *
 * Bytes are NOT stored in this table — storagePath points into the same
 * data/uploads/ tree (and uploadFilesTable convention) already used by
 * routes/uploads.ts. This table only holds metadata + OCR status, so it can
 * be queried/reported on without touching file storage.
 */
export const scannedDocumentsTable = pgTable("scanned_documents", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(), // 'form-f' | 'patients' | 'expenses' | 'banking'
  entityType: text("entity_type").notNull(), // e.g. 'form_f_record', 'patient', 'expense', 'bank_transaction'
  entityId: integer("entity_id"), // nullable: unlinked temp scans have no entity yet
  docType: text("doc_type").notNull(), // 'id-card' | 'bill' | 'bank-statement' | 'photo' | 'other'
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(), // relative path under data/uploads/
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  scanSource: text("scan_source").notNull(), // 'tvs' | 'bridge' | 'upload' | 'mobile' | 'webcam'
  deviceLabel: text("device_label"),
  userId: integer("user_id"),
  ocrStatus: text("ocr_status").notNull().default("pending"), // pending | success | failed | skipped
  ocrConfidence: integer("ocr_confidence"),
  isLinked: text("is_linked").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
});

export const insertScannedDocumentSchema = createInsertSchema(scannedDocumentsTable).omit({ id: true, createdAt: true });
export type ScannedDocument = typeof scannedDocumentsTable.$inferSelect;
export type InsertScannedDocument = z.infer<typeof insertScannedDocumentSchema>;
