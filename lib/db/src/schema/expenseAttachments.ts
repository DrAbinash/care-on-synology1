import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Documentary attachments for Expense Entry V2 (bill / invoice / receipt / memo).
 *
 * Bytes live on the Synology-backed uploads volume (`data/uploads/…`).
 * This table is metadata only — never store file base64 here.
 * Attachment actions MUST NOT affect billAmount, payments, vouchers, or day-close.
 */
export const expenseAttachmentsTable = pgTable(
  "expense_attachments",
  {
    id: serial("id").primaryKey(),
    expenseId: integer("expense_id").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** bill | invoice | receipt | cash_memo | supporting_document */
    documentType: text("document_type").notNull().default("supporting_document"),
    /** Relative path under data/uploads/ — never expose raw host paths to clients. */
    storagePath: text("storage_path").notNull(),
    /** Optional JPEG thumbnail relative path (images only). */
    thumbnailStoragePath: text("thumbnail_storage_path"),
    /** SHA-256 hex of raw file bytes (duplicate detection). */
    contentHash: text("content_hash").notNull(),
    /** MANUAL_UPLOAD | CAMERA | AI_SCAN */
    source: text("source").notNull().default("MANUAL_UPLOAD"),
    uploadedBy: text("uploaded_by"),
    uploadedById: integer("uploaded_by_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete — void/audit must retain evidence. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (t) => [
    index("expense_attachments_expense_id_idx").on(t.expenseId),
    index("expense_attachments_content_hash_idx").on(t.contentHash),
  ],
);

export const insertExpenseAttachmentSchema = createInsertSchema(expenseAttachmentsTable).omit({
  id: true,
  createdAt: true,
});
export type ExpenseAttachment = typeof expenseAttachmentsTable.$inferSelect;
export type InsertExpenseAttachment = z.infer<typeof insertExpenseAttachmentSchema>;

export const EXPENSE_ATTACHMENT_SOURCES = ["MANUAL_UPLOAD", "CAMERA", "AI_SCAN"] as const;
export type ExpenseAttachmentSource = (typeof EXPENSE_ATTACHMENT_SOURCES)[number];

export const EXPENSE_ATTACHMENT_DOC_TYPES = [
  "bill",
  "invoice",
  "receipt",
  "cash_memo",
  "supporting_document",
] as const;
export type ExpenseAttachmentDocType = (typeof EXPENSE_ATTACHMENT_DOC_TYPES)[number];

/** Allowed MIME types for expense supporting documents. */
export const EXPENSE_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export const MAX_EXPENSE_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB
