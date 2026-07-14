import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Metadata for uploaded files stored on disk (not in PostgreSQL BLOBs).
 * The actual bytes live under data/uploads/<module>/ or an external store.
 */
export const uploadFilesTable = pgTable(
  "upload_files",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id"),        // nullable for non-patient uploads
    module: text("module").notNull(),          // reports | patient_documents | billing | temp | dicom | site_assets
    fileName: text("file_name").notNull(),     // original client filename (sanitized)
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(), // relative path under data/uploads/
    checksum: text("checksum"),                // optional SHA-256 for integrity
    uploadedBy: text("uploaded_by").notNull().default("system"),
    uploadedById: integer("uploaded_by_id"),
    isDeleted: text("is_deleted").notNull().default("false"), // soft delete flag
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("upload_patient_idx").on(table.patientId),
    index("upload_module_idx").on(table.module),
    index("upload_created_idx").on(table.createdAt),
  ],
);

export const insertUploadFileSchema = createInsertSchema(uploadFilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type UploadFile = typeof uploadFilesTable.$inferSelect;
export type InsertUploadFile = z.infer<typeof insertUploadFileSchema>;

// Safe MIME whitelist for general uploads (NOT DICOM)
export const SAFE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

// DICOM / imaging MIME whitelist — supports DICOM Part 10 files and common
// imaging formats that modalities or PACS viewers emit.  We intentionally do
// NOT include generic types like application/octet-stream to prevent abuse.
export const DICOM_MIME_TYPES = new Set([
  "application/dicom",                 // DICOM Part 10 (.dcm)
  "application/dicom+json",            // DICOMweb JSON
  "application/dicom+xml",             // DICOMweb XML
  "image/dicom-rle",                 // DICOM RLE-compressed
  "image/jpeg",                        // JPEG baseline (8-bit)
  "image/jphc",                      // JPEG-LS
  "image/jp2",                       // JPEG 2000 Part 1
  "image/jpx",                       // JPEG 2000 Part 2
  "image/x-jls",                     // JPEG-LS (legacy tag)
  "image/x-dicom-rle",               // RLE (legacy tag)
]);

/** 25 MB for standard document / image uploads (JSON base64 path). */
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

/** 512 MB for DICOM / imaging uploads (streaming multipart path).
 *  Override via DICOM_UPLOAD_MAX_BYTES env var. */
export const MAX_DICOM_UPLOAD_SIZE_BYTES = Number(process.env.DICOM_UPLOAD_MAX_BYTES) || 512 * 1024 * 1024;
