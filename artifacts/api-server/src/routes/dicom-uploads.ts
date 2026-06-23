/**
 * DICOM / Imaging Upload Route — Streaming Multipart with Disk Storage
 *
 * Architecture principle: ERP stores patient/study METADATA in PostgreSQL.
 * Actual imaging bytes are stored on disk (or future object storage / PACS).
 * This route is mounted BEFORE any express.json() body parser so multer can
 * handle the multipart stream directly without competing with JSON parsing.
 *
 * Future PACS integration:
 *   - Orthanc/Conquest stores DICOM bytes in their native format
 *   - ERP receives study metadata (patientId, accessionNumber, studyUid)
 *     and stores a reference (orthancStudyId, storagePath, etc.)
 *   - This route is a fallback for direct DICOM uploads before PACS is configured
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { db, uploadFilesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { logger } from "../lib/logger";
import { DICOM_MIME_TYPES, MAX_DICOM_UPLOAD_SIZE_BYTES } from "@workspace/db/schema";
import { mkdirSync, existsSync, createWriteStream, unlinkSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import crypto from "node:crypto";

export const dicomUploadsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const DICOM_BASE_DIR = join(process.cwd(), "data", "uploads", "dicom");

/** Max file size — configurable via DICOM_UPLOAD_MAX_BYTES env var (defaults 512 MB). */
const FILE_SIZE_LIMIT = MAX_DICOM_UPLOAD_SIZE_BYTES;

/** Safe extension map derived from validated MIME type. */
const MIME_TO_EXT: Record<string, string> = {
  "application/dicom": ".dcm",
  "application/dicom+json": ".json",
  "application/dicom+xml": ".xml",
  "image/dicom-rle": ".dcm",
  "image/jpeg": ".jpg",
  "image/jphc": ".jph",
  "image/jp2": ".jp2",
  "image/jpx": ".jpx",
  "image/x-jls": ".jls",
  "image/x-dicom-rle": ".dcm",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sanitiseFilename(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "unnamed";
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (clean.length === 0) return "unnamed.dcm";
  if (clean.length > 200) return clean.slice(0, 200);
  return clean;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTER SETUP — diskStorage (never memoryStorage for DICOM)
// ─────────────────────────────────────────────────────────────────────────────

const dicomUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(DICOM_BASE_DIR);
      cb(null, DICOM_BASE_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = (MIME_TO_EXT[file.mimetype] ?? extname(file.originalname)) || ".dcm";
      const prefix = crypto.randomBytes(8).toString("hex");
      cb(null, `dcm-${prefix}-${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (DICOM_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`MIME type "${file.mimetype}" is not an accepted imaging format. Allowed: ${Array.from(DICOM_MIME_TYPES).join(", ")}`));
    }
  },
  limits: {
    fileSize: FILE_SIZE_LIMIT,
    files: 1, // one file per request for simplicity and safety
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dicom-uploads — single-file streaming upload
// ─────────────────────────────────────────────────────────────────────────────

const UploadMetaBody = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  studyUid: z.string().min(1).max(64).optional(),
  accessionNumber: z.string().min(1).max(32).optional(),
  modality: z.string().min(1).max(8).optional(),
  description: z.string().min(1).max(255).optional(),
});

dicomUploadsRouter.post(
  "/",
  requireStaffAuth,
  (req: StaffAuthRequest, res: Response, next) => {
    // Catch multer errors here so they don't bubble as unhandled
    dicomUpload.single("file")(req as unknown as Request, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: `File too large. Max allowed is ${(FILE_SIZE_LIMIT / (1024 * 1024)).toFixed(0)} MB.` });
          return;
        }
        res.status(400).json({ error: `Upload error: ${err.message}` });
        return;
      }
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
        return;
      }
      next();
    });
  },
  async (req: StaffAuthRequest, res: Response) => {
    const file = (req as unknown as Request).file;
    if (!file) {
      res.status(400).json({ error: "No file received. Send as multipart/form-data with field name 'file'." });
      return;
    }

    // Validate metadata from body (also sent as multipart fields)
    const meta = UploadMetaBody.safeParse(req.body);
    if (!meta.success) {
      // Rollback the uploaded file since metadata is invalid
      try { await unlink(file.path); } catch { /* ignore */ }
      res.status(400).json({ error: "Invalid metadata", details: meta.error.issues });
      return;
    }

    const { patientId, studyUid, accessionNumber, modality, description } = meta.data;

    // Compute SHA-256 checksum by streaming (no RAM buffering)
    const hash = crypto.createHash("sha256");
    const stream = createWriteStream(file.path, { flags: "r" }); // just to get file stats
    // Actually, we already have the file on disk — use fs promises for hash
    const { createReadStream } = await import("node:fs");
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(file.path);
      rs.on("data", (chunk: Buffer) => hash.update(chunk));
      rs.on("end", () => resolve());
      rs.on("error", reject);
    });
    const checksum = hash.digest("hex");

    // Build storage path relative to upload root
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const subDir = join("dicom", today);
    const finalDir = join(process.cwd(), "data", "uploads", subDir);
    await mkdir(finalDir, { recursive: true });

    const finalName = `${crypto.randomBytes(8).toString("hex")}_${file.filename}`;
    const finalPath = join(finalDir, finalName);
    const storagePath = join(subDir, finalName);

    // Move file to final location (or rename)
    const { rename } = await import("node:fs/promises");
    await rename(file.path, finalPath);

    // Record only METADATA in PostgreSQL — never binary data
    try {
      const [record] = await db
        .insert(uploadFilesTable)
        .values({
          patientId: patientId ?? null,
          module: "dicom",
          fileName: sanitiseFilename(file.originalname),
          mimeType: file.mimetype,
          sizeBytes: file.size,
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
        checksum: record.checksum,
        studyUid: studyUid ?? null,
        accessionNumber: accessionNumber ?? null,
        modality: modality ?? null,
        createdAt: record.createdAt,
        note: "Imaging bytes stored on disk. PostgreSQL stores only metadata.",
      });
    } catch (err) {
      // Rollback file on DB failure
      try { await unlink(finalPath); } catch { /* ignore */ }
      logger.error({ err }, "Failed to record DICOM upload metadata");
      res.status(500).json({ error: "Failed to save upload metadata" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dicom-uploads — list DICOM uploads
// ─────────────────────────────────────────────────────────────────────────────

const ListQuery = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  patientId: z.coerce.number().positive().optional(),
});

dicomUploadsRouter.get("/", requireStaffAuth, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const q = parsed.data;

  const conditions = [
    eq(uploadFilesTable.isDeleted, "false"),
    eq(uploadFilesTable.module, "dicom"),
  ];
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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/dicom-uploads/:id — soft-delete
// ─────────────────────────────────────────────────────────────────────────────

dicomUploadsRouter.delete("/:id", requireStaffAuth, async (req, res) => {
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
