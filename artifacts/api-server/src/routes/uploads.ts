import { Router } from "express";
import { z } from "zod/v4";
import { db, uploadFilesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { logger } from "../lib/logger";
import {
  SAFE_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
} from "@workspace/db/schema";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import type { Response } from "express";

export const uploadsRouter = Router();

/** Standard uploads directory — relative to api-server root. */
const UPLOAD_BASE_DIR = join(process.cwd(), "data", "uploads");

/**
 * Sanitise a filename: remove path traversal, keep extension, safe chars only.
 */
function sanitiseFilename(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "unnamed";
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (clean.length === 0) return "unnamed.bin";
  if (clean.length > 200) return clean.slice(0, 200);
  return clean;
}

/**
 * Derive a storage sub-folder from the module name. Reject if the module
 * contains path-separator characters to prevent traversal.
 */
function moduleSubDir(module: string): string {
  if (/[\\/\.\.]/.test(module)) throw new Error("Invalid module name");
  return module;
}

/**
 * Ensure the destination directory exists.
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * POST /api/uploads — upload a standard file via JSON base64.
 *
 * Body shape (sent as application/json):
 * {
 *   module: "reports" | "patient_documents" | "billing" | "site_assets",
 *   fileName: "report.pdf",
 *   mimeType: "application/pdf",
 *   base64Data: "base64encoded...",
 *   patientId?: 42,
 * }
 *
 * Limit: 25 MB decoded.  DICOM / large imaging must use /api/dicom-uploads
 * (streaming multipart) instead — this route is NOT suitable for imaging data.
 */
const UploadBody = z.object({
  module: z.string().min(1).max(50),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  base64Data: z.string().min(1).max(35 * 1024 * 1024), // generous base64 ceiling (~25 MB decoded)
  patientId: z.number().int().positive().optional(),
});

uploadsRouter.post("/", requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
  const parsed = UploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid upload body", details: parsed.error.issues });
    return;
  }

  const { module, fileName, mimeType, base64Data, patientId } = parsed.data;

  // MIME whitelist (standard uploads only — NO DICOM types)
  if (!SAFE_MIME_TYPES.has(mimeType)) {
    res.status(400).json({ error: `MIME type "${mimeType}" is not allowed for standard uploads. Use /api/dicom-uploads for imaging data.` });
    return;
  }

  // Decode and size check
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, "base64");
  } catch {
    res.status(400).json({ error: "Invalid base64 data" });
    return;
  }

  if (buffer.byteLength > MAX_UPLOAD_SIZE_BYTES) {
    res.status(413).json({ error: `File too large. Max allowed is 25 MB for standard uploads.` });
    return;
  }

  // Storage path
  const subDir = moduleSubDir(module);
  const targetDir = join(UPLOAD_BASE_DIR, subDir);
  ensureDir(targetDir);

  const safeName = sanitiseFilename(fileName);
  const uniquePrefix = crypto.randomBytes(8).toString("hex");
  const storedName = `${uniquePrefix}_${safeName}`;
  const storagePath = join(subDir, storedName);
  const fullPath = join(UPLOAD_BASE_DIR, storagePath);

  // Compute checksum
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  // Write to disk
  try {
    writeFileSync(fullPath, buffer);
  } catch (err) {
    logger.error({ err, path: fullPath }, "Failed to write uploaded file");
    res.status(500).json({ error: "Failed to store file" });
    return;
  }

  // Record in DB — only METADATA, never binary data
  try {
    const [record] = await db
      .insert(uploadFilesTable)
      .values({
        patientId: patientId ?? null,
        module,
        fileName: safeName,
        mimeType,
        sizeBytes: buffer.byteLength,
        storagePath,
        checksum,
        uploadedBy: req.staffSession?.subjectName ?? "unknown",
        uploadedById: req.staffSession?.id ?? null,
      })
      .returning();

    res.status(201).json({
      id: record.id,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      storagePath: record.storagePath,
      createdAt: record.createdAt,
    });
  } catch (err) {
    // Rollback file on DB failure
    try { unlinkSync(fullPath); } catch { /* ignore */ }
    logger.error({ err }, "Failed to record upload metadata");
    res.status(500).json({ error: "Failed to save upload metadata" });
  }
});

/**
 * GET /api/uploads — list uploads with optional filters.
 */
const ListQuery = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  module: z.string().optional(),
  patientId: z.coerce.number().positive().optional(),
});

uploadsRouter.get("/", requireStaffAuth, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const q = parsed.data;

  const conditions = [
    eq(uploadFilesTable.isDeleted, "false"),
  ];
  if (q.module) conditions.push(eq(uploadFilesTable.module, q.module));
  if (q.patientId) conditions.push(eq(uploadFilesTable.patientId, q.patientId));

  const where = and(...conditions);
  const offset = (q.page - 1) * q.pageSize;

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(uploadFilesTable)
      .where(where)
      .orderBy(desc(uploadFilesTable.createdAt))
      .limit(q.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(uploadFilesTable)
      .where(where),
  ]);

  const totalCount = total[0]?.count ?? 0;

  res.json({
    data: rows,
    pagination: {
      page: q.page,
      pageSize: q.pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / q.pageSize),
    },
  });
});

/**
 * DELETE /api/uploads/:id — soft-delete an upload record.
 */
uploadsRouter.delete("/:id", requireStaffAuth, async (req, res) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  await db
    .update(uploadFilesTable)
    .set({ isDeleted: "true" })
    .where(eq(uploadFilesTable.id, id));

  res.json({ success: true });
});
