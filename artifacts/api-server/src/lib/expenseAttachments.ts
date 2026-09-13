/**
 * Expense supporting-document attachments (bill / invoice / receipt / memo).
 *
 * Documentary only — never creates/reverses vouchers or changes money fields.
 * Bytes live under data/uploads/expenses/ on the persistent uploads_data volume.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  expenseAttachmentsTable,
  expensesTable,
  EXPENSE_ATTACHMENT_MIME_TYPES,
  MAX_EXPENSE_ATTACHMENT_BYTES,
  type ExpenseAttachmentDocType,
  type ExpenseAttachmentSource,
} from "@workspace/db/schema";

const UPLOAD_BASE_DIR = join(process.cwd(), "data", "uploads");
const EXPENSE_SUBDIR = "expenses";

/** Same semantics as legacy expenses.receipt_image_hash (hash of base64 payload). */
export function legacyReceiptHashFromDataUrl(receiptImageUrl: string): string | null {
  try {
    const trimmed = receiptImageUrl.trim();
    if (!trimmed) return null;
    const m = /^data:[^;]+;base64,(.+)$/s.exec(trimmed);
    const payload = m ? m[1] : trimmed;
    return createHash("sha256").update(payload).digest("hex");
  } catch {
    return null;
  }
}

export type DuplicateAttachmentHit = {
  attachmentId: number;
  expensePk: number;
  expenseId: string | null;
  originalFilename: string;
  source: string;
  createdAt: Date | null;
  viaLegacyReceiptHash?: boolean;
};

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sanitiseFilename(raw: string): string {
  const base = (raw || "document").replace(/\\/g, "/").split("/").pop() ?? "document";
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!clean) return "document.bin";
  return clean.length > 180 ? clean.slice(0, 180) : clean;
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}

function assertSafeRelativePath(rel: string): string {
  const normalised = rel.replace(/\\/g, "/");
  if (!normalised || normalised.startsWith("/") || normalised.includes("..")) {
    throw Object.assign(new Error("Invalid storage path"), { status: 400 });
  }
  if (!normalised.startsWith(`${EXPENSE_SUBDIR}/`)) {
    throw Object.assign(new Error("Attachment path outside expenses store"), { status: 400 });
  }
  return normalised;
}

export function hashFileBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function decodeDataUrlOrBase64(input: string): { buffer: Buffer; mimeType: string | null } {
  const trimmed = input.trim();
  const m = /^data:([^;]+);base64,(.+)$/s.exec(trimmed);
  if (m) {
    return { buffer: Buffer.from(m[2], "base64"), mimeType: m[1] || null };
  }
  return { buffer: Buffer.from(trimmed, "base64"), mimeType: null };
}

function sniffMime(buffer: Buffer, claimed: string): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  if (EXPENSE_ATTACHMENT_MIME_TYPES.has(claimed)) return claimed;
  return null;
}

export async function findDuplicateExpenseAttachments(
  contentHash: string,
): Promise<DuplicateAttachmentHit[]> {
  const rows = await db
    .select({
      attachmentId: expenseAttachmentsTable.id,
      expensePk: expenseAttachmentsTable.expenseId,
      originalFilename: expenseAttachmentsTable.originalFilename,
      source: expenseAttachmentsTable.source,
      createdAt: expenseAttachmentsTable.createdAt,
      expensePublicId: expensesTable.expenseId,
    })
    .from(expenseAttachmentsTable)
    .leftJoin(expensesTable, eq(expensesTable.id, expenseAttachmentsTable.expenseId))
    .where(
      and(
        eq(expenseAttachmentsTable.contentHash, contentHash),
        isNull(expenseAttachmentsTable.deletedAt),
      ),
    )
    .orderBy(desc(expenseAttachmentsTable.id))
    .limit(10);

  return rows.map((r) => ({
    attachmentId: r.attachmentId,
    expensePk: r.expensePk,
    expenseId: r.expensePublicId ?? null,
    originalFilename: r.originalFilename,
    source: r.source,
    createdAt: r.createdAt,
  }));
}

/** Check legacy expenses.receipt_image_hash (SHA-256 of base64 payload). */
export async function findLegacyReceiptHashDuplicates(
  legacyHash: string,
): Promise<DuplicateAttachmentHit[]> {
  const legacy = await db
    .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
    .from(expensesTable)
    .where(
      and(
        eq(expensesTable.receiptImageHash, legacyHash),
        sql`${expensesTable.paymentStatus} <> 'VOID'`,
      ),
    )
    .limit(5);
  return legacy.map((r) => ({
    attachmentId: 0,
    expensePk: r.id,
    expenseId: r.expenseId,
    originalFilename: "(legacy receipt image)",
    source: "AI_SCAN",
    createdAt: null,
    viaLegacyReceiptHash: true,
  }));
}

export type CreateExpenseAttachmentInput = {
  expensePk: number;
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
  source: ExpenseAttachmentSource;
  documentType?: ExpenseAttachmentDocType;
  uploadedBy?: string | null;
  uploadedById?: number | null;
  notes?: string | null;
  attachAnyway?: boolean;
};

export async function createExpenseAttachment(input: CreateExpenseAttachmentInput) {
  const [expense] = await db
    .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
    .from(expensesTable)
    .where(eq(expensesTable.id, input.expensePk))
    .limit(1);
  if (!expense) throw Object.assign(new Error("Expense not found"), { status: 404 });

  const sniffed = sniffMime(input.buffer, input.mimeType);
  if (!sniffed || !EXPENSE_ATTACHMENT_MIME_TYPES.has(sniffed)) {
    throw Object.assign(new Error("Unsupported file type. Allowed: JPG, PNG, WEBP, PDF."), {
      status: 400,
    });
  }
  if (input.buffer.byteLength <= 0) {
    throw Object.assign(new Error("Empty file"), { status: 400 });
  }
  if (input.buffer.byteLength > MAX_EXPENSE_ATTACHMENT_BYTES) {
    throw Object.assign(new Error("File too large. Maximum size is 15 MB."), { status: 413 });
  }

  const contentHash = hashFileBuffer(input.buffer);
  const duplicates = await findDuplicateExpenseAttachments(contentHash);
  if (duplicates.length && !input.attachAnyway) {
    throw Object.assign(
      new Error("Duplicate document detected. Pass attachAnyway=true to attach anyway."),
      { status: 409, duplicates },
    );
  }

  const safeName = sanitiseFilename(input.originalFilename);
  const ext = extensionForMime(sniffed);
  const unique = randomBytes(8).toString("hex");
  const finalName = safeName.toLowerCase().endsWith(ext) ? safeName : `${safeName}${ext}`;
  const storedName = `${expense.expenseId}_${unique}_${finalName}`;
  const relPath = `${EXPENSE_SUBDIR}/${storedName}`;
  ensureDir(join(UPLOAD_BASE_DIR, EXPENSE_SUBDIR));
  writeFileSync(join(UPLOAD_BASE_DIR, relPath), input.buffer);

  const [row] = await db
    .insert(expenseAttachmentsTable)
    .values({
      expenseId: expense.id,
      originalFilename: safeName,
      mimeType: sniffed,
      sizeBytes: input.buffer.byteLength,
      documentType: input.documentType ?? "supporting_document",
      storagePath: relPath,
      contentHash,
      source: input.source,
      uploadedBy: input.uploadedBy ?? null,
      uploadedById: input.uploadedById ?? null,
      notes: input.notes ?? null,
    })
    .returning();

  return { attachment: row!, duplicates };
}

/** Persist an AI-scan receipt data-URL as a filesystem attachment (no second upload). */
export async function attachFromReceiptDataUrl(opts: {
  expensePk: number;
  receiptImageUrl: string;
  uploadedBy?: string | null;
  uploadedById?: number | null;
  attachAnyway?: boolean;
}) {
  const { buffer, mimeType } = decodeDataUrlOrBase64(opts.receiptImageUrl);
  const mime =
    mimeType && EXPENSE_ATTACHMENT_MIME_TYPES.has(mimeType) ? mimeType : "image/jpeg";
  return createExpenseAttachment({
    expensePk: opts.expensePk,
    buffer,
    mimeType: mime,
    originalFilename: `ai-scan-${Date.now()}${extensionForMime(mime) || ".jpg"}`,
    source: "AI_SCAN",
    documentType: "bill",
    uploadedBy: opts.uploadedBy,
    uploadedById: opts.uploadedById,
    attachAnyway: opts.attachAnyway ?? true,
  });
}

export async function listExpenseAttachments(
  expensePk: number,
  opts?: { includeDeleted?: boolean },
) {
  const where = opts?.includeDeleted
    ? eq(expenseAttachmentsTable.expenseId, expensePk)
    : and(eq(expenseAttachmentsTable.expenseId, expensePk), isNull(expenseAttachmentsTable.deletedAt));
  return db
    .select()
    .from(expenseAttachmentsTable)
    .where(where)
    .orderBy(desc(expenseAttachmentsTable.id));
}

export async function countActiveAttachments(
  expensePks: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!expensePks.length) return map;
  const rows = await db
    .select({
      expenseId: expenseAttachmentsTable.expenseId,
      n: sql<number>`count(*)::int`,
    })
    .from(expenseAttachmentsTable)
    .where(
      and(inArray(expenseAttachmentsTable.expenseId, expensePks), isNull(expenseAttachmentsTable.deletedAt)),
    )
    .groupBy(expenseAttachmentsTable.expenseId);
  for (const r of rows) map.set(r.expenseId, Number(r.n));
  return map;
}

export async function getExpenseAttachment(expensePk: number, attachmentId: number) {
  const [row] = await db
    .select()
    .from(expenseAttachmentsTable)
    .where(
      and(
        eq(expenseAttachmentsTable.id, attachmentId),
        eq(expenseAttachmentsTable.expenseId, expensePk),
        isNull(expenseAttachmentsTable.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function resolveAttachmentAbsolutePath(storagePath: string): string {
  const rel = assertSafeRelativePath(storagePath);
  return join(UPLOAD_BASE_DIR, rel);
}

export function readAttachmentFile(storagePath: string): Buffer {
  const abs = resolveAttachmentAbsolutePath(storagePath);
  if (!existsSync(abs)) {
    throw Object.assign(new Error("Attachment file missing on disk"), { status: 404 });
  }
  return readFileSync(abs);
}

export async function softDeleteExpenseAttachment(opts: {
  expensePk: number;
  attachmentId: number;
  deletedBy?: string | null;
}) {
  const row = await getExpenseAttachment(opts.expensePk, opts.attachmentId);
  if (!row) throw Object.assign(new Error("Attachment not found"), { status: 404 });
  const [updated] = await db
    .update(expenseAttachmentsTable)
    .set({ deletedAt: new Date(), deletedBy: opts.deletedBy ?? null })
    .where(eq(expenseAttachmentsTable.id, row.id))
    .returning();
  return updated!;
}

/** Public DTO — never includes host filesystem paths. */
export function toAttachmentDto(row: typeof expenseAttachmentsTable.$inferSelect) {
  return {
    id: row.id,
    expensePk: row.expenseId,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    documentType: row.documentType,
    contentHash: row.contentHash,
    source: row.source,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    isImage: row.mimeType.startsWith("image/"),
    isPdf: row.mimeType === "application/pdf",
    viewUrl: `/api/expenses/${row.expenseId}/attachments/${row.id}/file`,
    downloadUrl: `/api/expenses/${row.expenseId}/attachments/${row.id}/file?download=1`,
  };
}

export function attachmentBasename(storagePath: string): string {
  return basename(storagePath);
}
