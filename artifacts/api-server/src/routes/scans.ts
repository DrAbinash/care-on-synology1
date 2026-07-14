import { Router } from "express";
import { z } from "zod/v4";
import { db, scannedDocumentsTable, clinicSettingsTable } from "@workspace/db";
import { SAFE_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from "@workspace/db/schema";
import { eq, and, lt, desc, sql } from "drizzle-orm";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { logger } from "../lib/logger";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import type { Response } from "express";
import { generateImageVariants } from "../lib/ocr/imageVariants";

/**
 * Shared document-scan persistence service. Reuses the SAME storage
 * convention as routes/uploads.ts (data/uploads/, relative storagePath,
 * metadata-only DB rows) rather than a new storage mechanism — the
 * scanned_documents table only adds the module/entityType/entityId/
 * scanSource/ocrStatus metadata that uploadFilesTable doesn't carry, since
 * this table is meant to be the shared attachment point for Form F,
 * Patient Registration, Expenses, and Banking specifically.
 */
export const scansRouter = Router();

const UPLOAD_BASE_DIR = join(process.cwd(), "data", "uploads");
const SCAN_SUBDIR = "scanned";

function sanitiseFilename(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "unnamed";
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (clean.length === 0) return "scan.bin";
  return clean.length > 200 ? clean.slice(0, 200) : clean;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const MODULES = ["form-f", "patients", "expenses", "banking"] as const;
const DOC_TYPES = ["id-card", "bill", "bank-statement", "photo", "other"] as const;
const SCAN_SOURCES = ["tvs", "bridge", "upload", "mobile", "webcam"] as const;

const CreateScanBody = z.object({
  module: z.enum(MODULES),
  entityType: z.string().min(1).max(60),
  entityId: z.number().int().positive().optional(),
  docType: z.enum(DOC_TYPES),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  base64Data: z.string().min(1).max(35 * 1024 * 1024),
  scanSource: z.enum(SCAN_SOURCES),
  deviceLabel: z.string().max(200).optional(),
  /** Downscale-if-larger-than (processed variant only). Default 2000px — see imageVariants.ts. */
  maxWidth: z.number().int().positive().max(6000).optional(),
  /** JPEG re-encode quality 1-100 (processed + thumbnail variants). Default 88. */
  jpegQuality: z.number().int().min(1).max(100).optional(),
});

/**
 * POST /api/scans — persist a captured document's bytes + metadata.
 * entityId is optional: a scan can be persisted before its owning record is
 * saved (e.g. mid-registration), then linked later via POST /:id/link.
 */
scansRouter.post("/", requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
  const parsed = CreateScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scan body", details: parsed.error.issues });
    return;
  }
  const { module, entityType, entityId, docType, fileName, mimeType, base64Data, scanSource, deviceLabel, maxWidth, jpegQuality } = parsed.data;

  if (!SAFE_MIME_TYPES.has(mimeType)) {
    res.status(400).json({ error: `MIME type "${mimeType}" is not supported. Use JPG, PNG, WEBP, HEIC, or PDF.` });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, "base64");
  } catch {
    res.status(400).json({ error: "Invalid base64 data" });
    return;
  }
  if (buffer.byteLength > MAX_UPLOAD_SIZE_BYTES) {
    res.status(413).json({ error: `File too large. Max allowed is ${Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB.` });
    return;
  }

  const subDir = join(SCAN_SUBDIR, module);
  const targetDir = join(UPLOAD_BASE_DIR, subDir);
  ensureDir(targetDir);

  const safeName = sanitiseFilename(fileName);
  const uniquePrefix = crypto.randomBytes(8).toString("hex");

  // ── Generate the three stored variants ──
  // Original is stored byte-for-byte (legal-evidence copy). Processed +
  // thumbnail are derived JPEGs — see imageVariants.ts for exactly what
  // preprocessing is applied and when a variant can legitimately be null
  // (PDFs, or an image format sharp can't decode in this deployment).
  const variants = await generateImageVariants(base64Data, mimeType, { maxWidth, jpegQuality });
  if (variants.variantsError) {
    logger.warn({ variantsError: variants.variantsError, mimeType }, "scanned-document variant generation incomplete");
  }

  const originalStoredName = `${uniquePrefix}_${safeName}`;
  const originalStoragePath = join(subDir, originalStoredName);
  const originalFullPath = join(UPLOAD_BASE_DIR, originalStoragePath);

  let processedStoragePath: string | null = null;
  let processedFullPath: string | null = null;
  let thumbnailStoragePath: string | null = null;
  let thumbnailFullPath: string | null = null;

  try {
    writeFileSync(originalFullPath, variants.original.buffer);

    if (variants.processed) {
      processedStoragePath = join(subDir, `${uniquePrefix}_processed.jpg`);
      processedFullPath = join(UPLOAD_BASE_DIR, processedStoragePath);
      writeFileSync(processedFullPath, variants.processed.buffer);
    }
    if (variants.thumbnail) {
      thumbnailStoragePath = join(subDir, `${uniquePrefix}_thumb.jpg`);
      thumbnailFullPath = join(UPLOAD_BASE_DIR, thumbnailStoragePath);
      writeFileSync(thumbnailFullPath, variants.thumbnail.buffer);
    }
  } catch (err) {
    logger.error({ err, path: originalFullPath }, "Failed to write scanned document");
    res.status(500).json({ error: "Failed to store scanned document" });
    return;
  }

  try {
    const [record] = await db
      .insert(scannedDocumentsTable)
      .values({
        module,
        entityType,
        entityId: entityId ?? null,
        docType,
        filename: safeName,
        storagePath: originalStoragePath,
        mimeType,
        sizeBytes: buffer.byteLength,
        processedStoragePath,
        processedSizeBytes: variants.processed ? variants.processed.buffer.byteLength : null,
        thumbnailStoragePath,
        thumbnailSizeBytes: variants.thumbnail ? variants.thumbnail.buffer.byteLength : null,
        scanSource,
        deviceLabel: deviceLabel ?? null,
        userId: req.staffSession?.id ?? null,
        isLinked: entityId ? "true" : "false",
        linkedAt: entityId ? new Date() : null,
      })
      .returning();

    res.status(201).json({
      id: record.id,
      storagePath: record.storagePath,
      url: `/uploads/${record.storagePath}`,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      processedUrl: record.processedStoragePath ? `/uploads/${record.processedStoragePath}` : null,
      thumbnailUrl: record.thumbnailStoragePath ? `/uploads/${record.thumbnailStoragePath}` : null,
      blurScore: variants.processed?.blurScore ?? null,
      isBlurred: variants.processed?.isBlurred ?? null,
      variantsError: variants.variantsError ?? null,
      isLinked: record.isLinked === "true",
      createdAt: record.createdAt,
    });
  } catch (err) {
    try { unlinkSync(originalFullPath); } catch { /* ignore */ }
    try { if (processedFullPath) unlinkSync(processedFullPath); } catch { /* ignore */ }
    try { if (thumbnailFullPath) unlinkSync(thumbnailFullPath); } catch { /* ignore */ }
    logger.error({ err }, "Failed to record scanned document metadata");
    res.status(500).json({ error: "Failed to save scan metadata" });
  }
});

/** GET /api/scans/:id — fetch one scan's metadata (bytes served via the existing /uploads static route). */
scansRouter.get("/:id", requireStaffAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [record] = await db.select().from(scannedDocumentsTable).where(eq(scannedDocumentsTable.id, id)).limit(1);
  if (!record) { res.status(404).json({ error: "Scan not found" }); return; }

  res.json({
    ...record,
    url: `/uploads/${record.storagePath}`,
    processedUrl: record.processedStoragePath ? `/uploads/${record.processedStoragePath}` : null,
    thumbnailUrl: record.thumbnailStoragePath ? `/uploads/${record.thumbnailStoragePath}` : null,
    isLinked: record.isLinked === "true",
  });
});

const LinkBody = z.object({ entityId: z.number().int().positive() });

/** POST /api/scans/:id/link — attach a previously-unlinked scan to its owning record once saved. */
scansRouter.post("/:id/link", requireStaffAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = LinkBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "entityId required" }); return; }

  const [updated] = await db
    .update(scannedDocumentsTable)
    .set({ entityId: parsed.data.entityId, isLinked: "true", linkedAt: new Date() })
    .where(eq(scannedDocumentsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Scan not found" }); return; }

  res.json({ ...updated, isLinked: true });
});

/** DELETE /api/scans/:id — unlink a scan from its entity (does not delete the file; see purge-unlinked for cleanup). */
scansRouter.delete("/:id", requireStaffAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [updated] = await db
    .update(scannedDocumentsTable)
    .set({ entityId: null, isLinked: "false", linkedAt: null })
    .where(eq(scannedDocumentsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Scan not found" }); return; }

  res.json({ success: true });
});

/**
 * POST /api/scans/purge-unlinked — delete scanned_documents rows (and their
 * files) that are still unlinked and older than clinic_settings.scanRetentionDays.
 * Exposed as an admin-triggered endpoint for now — this phase does not wire
 * up a cron scheduler; an operator (or a future scheduled task) calls this
 * periodically.
 */
scansRouter.post("/purge-unlinked", requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
  const [settings] = await db.select({ scanRetentionDays: clinicSettingsTable.scanRetentionDays }).from(clinicSettingsTable).limit(1);
  const retentionDays = settings?.scanRetentionDays ?? 30;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const stale = await db
    .select()
    .from(scannedDocumentsTable)
    .where(and(eq(scannedDocumentsTable.isLinked, "false"), lt(scannedDocumentsTable.createdAt, cutoff)))
    .orderBy(desc(scannedDocumentsTable.createdAt))
    .limit(500);

  let deletedFiles = 0;
  let deletedRows = 0;
  for (const row of stale) {
    const paths = [row.storagePath, row.processedStoragePath, row.thumbnailStoragePath].filter((p): p is string => !!p);
    for (const p of paths) {
      const fullPath = join(UPLOAD_BASE_DIR, p);
      try {
        if (existsSync(fullPath)) { unlinkSync(fullPath); deletedFiles++; }
      } catch (err) {
        logger.warn({ err, storagePath: p }, "Failed to delete stale scan file");
      }
    }
    await db.delete(scannedDocumentsTable).where(eq(scannedDocumentsTable.id, row.id));
    deletedRows++;
  }

  res.json({ ok: true, retentionDays, cutoff, deletedRows, deletedFiles, candidateCount: stale.length });
});

/** GET /api/scans — list scans for a given module/entity, for a review UI. */
const ListQuery = z.object({
  module: z.enum(MODULES).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
});

scansRouter.get("/", requireStaffAuth, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query" }); return; }
  const q = parsed.data;

  const conditions = [];
  if (q.module) conditions.push(eq(scannedDocumentsTable.module, q.module));
  if (q.entityId) conditions.push(eq(scannedDocumentsTable.entityId, q.entityId));
  const where = conditions.length ? and(...conditions) : undefined;
  const offset = (q.page - 1) * q.pageSize;

  const [rows, total] = await Promise.all([
    db.select().from(scannedDocumentsTable).where(where).orderBy(desc(scannedDocumentsTable.createdAt)).limit(q.pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(scannedDocumentsTable).where(where),
  ]);

  res.json({
    data: rows.map((r: typeof scannedDocumentsTable.$inferSelect) => ({
      ...r,
      url: `/uploads/${r.storagePath}`,
      processedUrl: r.processedStoragePath ? `/uploads/${r.processedStoragePath}` : null,
      thumbnailUrl: r.thumbnailStoragePath ? `/uploads/${r.thumbnailStoragePath}` : null,
      isLinked: r.isLinked === "true",
    })),
    pagination: { page: q.page, pageSize: q.pageSize, total: total[0]?.count ?? 0 },
  });
});
