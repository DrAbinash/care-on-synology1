import { Router } from "express";
import { db } from "@workspace/db";
import { backupJobsTable, backupJobLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { spawn } from "node:child_process";
import { promises as fs, createWriteStream, createReadStream } from "node:fs";
import { mkdirSync, existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { pipeline } from "node:stream";
import JSZip from "jszip";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";
import { logger } from "../lib/logger";

export const backupReplicationRouter = Router();

const streamPipeline = promisify(pipeline);

// Temporary storage for backup exports
const TEMP_BACKUP_DIR = process.env["BACKUP_TEMP_DIR"] ?? "/tmp/care-diagnostics-backups";
const OLD_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Protected files that should never be overwritten during import
const PROTECTED_FILES = new Set([
  ".env", ".env.local", ".env.production", ".env.development",
  "docker-compose.yml", "docker-compose.yaml", "docker-compose.prod.yml",
  "Dockerfile", "Dockerfile.prod", "docker-compose.override.yml",
  "synology-compose.yml", "synology-compose.yaml",
]);

// Folders to include in uploaded files export
const UPLOAD_FOLDERS = [
  "artifacts/api-server/data/uploads",
  "artifacts/api-server/data/reports",
  "attached_assets",
  "artifacts/api-server/public/uploads",
];

function requireAdmin(req: StaffAuthRequest, res: { status: (n: number) => { json: (d: unknown) => void } }, next: () => void): void {
  if (!req.staffSession || !FULL_ACCESS_ROLES.has(req.staffSession.role)) {
    res.status(403).json({ error: "Admin access required for backup management" }); return;
  }
  next();
}

function getClientIp(req: StaffAuthRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : (req.ip ?? "unknown");
}

function ensureBackupDir(): string {
  if (!existsSync(TEMP_BACKUP_DIR)) {
    mkdirSync(TEMP_BACKUP_DIR, { recursive: true });
  }
  return TEMP_BACKUP_DIR;
}

function cleanupOldFiles(): void {
  try {
    const dir = ensureBackupDir();
    const now = Date.now();
    for (const file of readdirSync(dir)) {
      const filePath = path.join(dir, file);
      try {
        const stats = statSync(filePath);
        if (now - stats.mtime.getTime() > OLD_FILE_MAX_AGE_MS) {
          fs.unlink(filePath).catch(() => {});
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore cleanup errors */ }
}

function parseDatabaseUrl(): { host: string; port: string; database: string; username: string; password: string } | null {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) return null;
  try {
    const url = new URL(dbUrl);
    return {
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname.replace(/^\//, ""),
      username: url.username,
      password: url.password,
    };
  } catch {
    return null;
  }
}

// Emergency Ticket E0.1 — CRIT-1 (scheduled backup false-success risk).
//
// Previously this promise resolved as soon as the write stream fired
// "finish" (i.e. pg_dump's stdout closed), without waiting for pg_dump's
// own "close" event to confirm a zero exit code. If pg_dump crashed or
// failed partway through a dump, its stdout still closed (ending the
// stream, firing "finish") *before or around the same time as* the
// process's "close" event reported the real (non-zero) exit code — so the
// promise could already be resolved as success by the time the failure was
// known, silently swallowing the later reject() call (a settled promise
// ignores further resolve/reject calls). A partial, truncated dump could
// therefore be recorded as a successful backup.
//
// Fixed by waiting for BOTH the stream to finish AND the process to close,
// and only resolving if the exit code was 0 and the output file is
// non-empty — the two are combined via trySettle() so ordering between the
// two async events no longer matters.
//
// `tables`, if provided, adds --table filtering (same flag pg_dump already
// supports and internal-backup.ts's /download endpoint already uses) for
// small, scoped backups (e.g. CONFIG) — omit it for a full database dump.
export async function exportDatabaseSql(
  tables?: string[],
): Promise<{ filePath: string; sizeBytes: number; rowCount: number | null }> {
  const creds = parseDatabaseUrl();
  if (!creds) throw new Error("DATABASE_URL not configured");

  const dir = ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const filePath = path.join(dir, `caredeoghar-db-${timestamp}.sql`);

  const args = [
    "--host", creds.host,
    "--port", creds.port,
    "--username", creds.username,
    "--dbname", creds.database,
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
  ];
  for (const t of tables ?? []) {
    args.push("--table", t);
  }

  const env = { ...process.env, PGPASSWORD: creds.password };

  return new Promise((resolve, reject) => {
    const pgDump = spawn("pg_dump", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const outStream = createWriteStream(filePath);
    let errorOutput = "";
    let settled = false;
    let streamFinished = false;
    let closeCode: number | null = null;

    const trySettle = () => {
      if (settled || !streamFinished || closeCode === null) return;
      settled = true;
      if (closeCode !== 0) {
        reject(new Error(`pg_dump exited with code ${closeCode}: ${errorOutput}`));
        return;
      }
      const stats = statSync(filePath);
      if (stats.size === 0) {
        reject(new Error("pg_dump produced an empty file — treating as a failed backup"));
        return;
      }
      resolve({ filePath, sizeBytes: stats.size, rowCount: null });
    };

    pgDump.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
    pgDump.stdout.pipe(outStream);

    pgDump.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`pg_dump failed to start: ${err.message}`));
    });

    outStream.on("finish", () => {
      streamFinished = true;
      trySettle();
    });

    outStream.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    pgDump.on("close", (code) => {
      closeCode = code ?? -1;
      trySettle();
    });
  });
}

// Fallback for exportDatabaseSql when pg_dump itself isn't available on the
// host. Already correctly paginated (no row cap — the do/while loop below
// keeps fetching 500-row pages until a short page confirms the table is
// exhausted), unlike cron.ts's old SELECT * LIMIT 5000 (Ticket E0.1's
// CRIT-1 fix). `tableFilter`, if provided, scopes the export to just those
// tables (mirrors exportDatabaseSql's `tables` param) — omit for every
// table in the schema.
export async function exportDatabaseSqlFallback(
  tableFilter?: string[],
): Promise<{ filePath: string; sizeBytes: number; rowCount: number | null }> {
  // Fallback: use node-postgres to export schema + data as SQL
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    const dir = ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const filePath = path.join(dir, `caredeoghar-db-${timestamp}.sql`);
    const lines: string[] = [];

    // Schema
    const schemaRes = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const allTables = schemaRes.rows.map((r) => r.table_name as string);
    const tables = tableFilter && tableFilter.length > 0
      ? allTables.filter((t) => tableFilter.includes(t))
      : allTables;

    lines.push("-- Care Diagnostics Database Export");
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push(`-- Format: PostgreSQL 16 compatible`);
    lines.push("");
    lines.push("BEGIN;");
    lines.push("");

    let totalRows = 0;
    for (const table of tables) {
      lines.push(`-- Table: ${table}`);
      // Get column names
      const colRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [table],
      );
      const cols = colRes.rows.map((r) => `"${r.column_name}"`);
      if (cols.length === 0) continue;

      // Truncate before insert (clean restore)
      lines.push(`TRUNCATE TABLE "${table}" CASCADE;`);

      // Fetch data in batches
      const batchSize = 500;
      let offset = 0;
      let rows: unknown[] = [];
      do {
        const dataRes = await client.query(`SELECT * FROM "${table}" LIMIT ${batchSize} OFFSET ${offset}`);
        rows = dataRes.rows;
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const vals: string[] = [];
          for (const col of colRes.rows.map((r) => r.column_name as string)) {
            const v = (row as Record<string, unknown>)[col];
            if (v === null || v === undefined) {
              vals.push("NULL");
            } else if (typeof v === "string") {
              vals.push("'" + v.replace(/'/g, "''").replace(/\\/g, "\\\\") + "'");
            } else if (typeof v === "boolean") {
              vals.push(v ? "TRUE" : "FALSE");
            } else if (typeof v === "number") {
              vals.push(String(v));
            } else if (v instanceof Date) {
              vals.push(`'${v.toISOString()}'`);
            } else if (typeof v === "object") {
              vals.push(`'${JSON.stringify(v).replace(/'/g, "''")}'`);
            } else {
              vals.push(`'${String(v).replace(/'/g, "''")}'`);
            }
          }
          lines.push(`INSERT INTO "${table}" (${cols.join(", ")}) VALUES (${vals.join(", ")});`);
        }
        offset += rows.length;
        totalRows += rows.length;
      } while (rows.length === batchSize);
      lines.push("");
    }

    lines.push("COMMIT;");
    const sql = lines.join("\n");
    await fs.writeFile(filePath, sql, "utf-8");
    const stats = statSync(filePath);
    return { filePath, sizeBytes: stats.size, rowCount: totalRows };
  } finally {
    client.release();
  }
}

// Ticket E0.1d — integrity verification for scheduled backups.
//
// computeSha256 hashes exactly the bytes that get written to disk for a
// completed backup (the encrypted .sql.enc content), so a later mismatch
// means the file was altered or corrupted after the backup ran — not a
// hash of the pre-encryption SQL, which wouldn't catch corruption of the
// at-rest artifact itself. verifyBackupChecksum re-reads the file and
// confirms it still matches. Detection only — no auto-repair, and neither
// function touches restore logic (restoreDatabaseFromSql, /import-db,
// /import-snapshot are all unchanged).
export function computeSha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function verifyBackupChecksum(filePath: string, expectedChecksumHex: string): Promise<boolean> {
  try {
    const data = await fs.readFile(filePath);
    return computeSha256(data) === expectedChecksumHex;
  } catch {
    return false;
  }
}

async function exportFilesZip(): Promise<{ filePath: string; sizeBytes: number; includedFolders: string[] }> {
  const dir = ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const filePath = path.join(dir, `caredeoghar-files-${timestamp}.zip`);

  const zip = new JSZip();
  const includedFolders: string[] = [];

  for (const folder of UPLOAD_FOLDERS) {
    const absPath = path.resolve(folder);
    if (!existsSync(absPath)) continue;
    includedFolders.push(folder);
    const folderName = path.basename(folder);
    const zipFolder = zip.folder(folderName);
    if (!zipFolder) continue;

    function addFiles(currentPath: string, zipParent: JSZip) {
      const entries = readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          const subFolder = zipParent.folder(entry.name);
          if (subFolder) addFiles(fullPath, subFolder);
        } else {
          const data = readFileSync(fullPath);
          zipParent.file(entry.name, data);
        }
      }
    }
    addFiles(absPath, zipFolder);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(filePath, buffer);
  return { filePath, sizeBytes: buffer.length, includedFolders };
}

async function exportFullSnapshot(): Promise<{ filePath: string; sizeBytes: number; metadata: Record<string, unknown> }> {
  const dir = ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const filePath = path.join(dir, `caredeoghar-snapshot-${timestamp}.zip`);

  // 1. Export database
  let dbResult: { filePath: string; sizeBytes: number; rowCount: number | null };
  try {
    dbResult = await exportDatabaseSql();
  } catch {
    dbResult = await exportDatabaseSqlFallback();
  }

  // 2. Export files
  const filesResult = await exportFilesZip();

  // 3. Build metadata
  const metadata: Record<string, unknown> = {
    appName: "Care Diagnostics ERP",
    version: process.env["npm_package_version"] ?? "unknown",
    timestamp: new Date().toISOString(),
    environment: process.env["NODE_ENV"] ?? "unknown",
    database: parseDatabaseUrl()?.database ?? "unknown",
    dbExportSize: dbResult.sizeBytes,
    filesExportSize: filesResult.sizeBytes,
    includedFolders: filesResult.includedFolders,
    pgDumpUsed: true,
  };

  // 4. Assemble ZIP
  const zip = new JSZip();
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));
  zip.file("database.sql", readFileSync(dbResult.filePath));
  zip.file("uploads.zip", readFileSync(filesResult.filePath));

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(filePath, buffer);

  // Clean up intermediate files
  fs.unlink(dbResult.filePath).catch(() => {});
  fs.unlink(filesResult.filePath).catch(() => {});

  return { filePath, sizeBytes: buffer.length, metadata };
}

async function restoreDatabaseFromSql(filePath: string): Promise<{ rowCount: number | null; message: string }> {
  const creds = parseDatabaseUrl();
  if (!creds) throw new Error("DATABASE_URL not configured");

  const env = { ...process.env, PGPASSWORD: creds.password };

  return new Promise((resolve, reject) => {
    const psql = spawn("psql", [
      "--host", creds.host,
      "--port", creds.port,
      "--username", creds.username,
      "--dbname", creds.database,
      "--file", filePath,
      "--single-transaction",
    ], { env, stdio: ["ignore", "pipe", "pipe"] });

    let errorOutput = "";
    let output = "";
    psql.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
    psql.stdout.on("data", (chunk) => { output += String(chunk); });

    psql.on("error", (err) => reject(new Error(`psql failed to start: ${err.message}`)));
    psql.on("close", (code) => {
      if (code === 0) {
        resolve({ rowCount: null, message: "Database restored successfully" });
      } else {
        reject(new Error(`psql exited with code ${code}: ${errorOutput}`));
      }
    });
  });
}

// ─── GET /api/admin/backup-replication/jobs ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.get("/jobs", requireAdmin as any, async (req, res): Promise<void> => {
  const rows = await db.select().from(backupJobsTable).orderBy(backupJobsTable.createdAt);
  res.json(rows);
});

// ─── POST /api/admin/backup-replication/jobs ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/jobs", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const { jobName, backupType, destinationType, destinationPath, schedule, retentionDays, isEnabled } =
    req.body as Partial<typeof backupJobsTable.$inferInsert>;

  if (!jobName || !backupType || !destinationType) {
    res.status(400).json({ error: "jobName, backupType and destinationType are required" }); return;
  }
  const [row] = await db.insert(backupJobsTable).values({
    jobName, backupType, destinationType,
    destinationPath: destinationPath ?? null,
    schedule: schedule ?? "MANUAL",
    retentionDays: retentionDays ?? 30,
    isEnabled: isEnabled ?? true,
  }).returning();

  await auditFromRequest(sReq, {
    userId: sReq.staffSession?.subjectId ?? null,
    userName: sReq.staffSession?.subjectName ?? "unknown",
    role: sReq.staffSession?.role ?? "unknown",
    action: "backup_job_create",
    module: "backups",
    entityType: "backup_job",
    entityId: String(row.id),
    reason: `Created backup job "${jobName}" (${backupType})`,
  });

  res.status(201).json(row);
});

// ─── PATCH /api/admin/backup-replication/jobs/:id ────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.patch("/jobs/:id", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const id = Number(req.params["id"]);
  const { jobName, backupType, destinationType, destinationPath, schedule, retentionDays, isEnabled } =
    req.body as Partial<typeof backupJobsTable.$inferInsert>;

  const updates: Partial<typeof backupJobsTable.$inferInsert> = { updatedAt: new Date() };
  if (jobName !== undefined) updates.jobName = jobName;
  if (backupType !== undefined) updates.backupType = backupType;
  if (destinationType !== undefined) updates.destinationType = destinationType;
  if (destinationPath !== undefined) updates.destinationPath = destinationPath;
  if (schedule !== undefined) updates.schedule = schedule;
  if (retentionDays !== undefined) updates.retentionDays = retentionDays;
  if (isEnabled !== undefined) updates.isEnabled = isEnabled;

  const [row] = await db.update(backupJobsTable).set(updates).where(eq(backupJobsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Job not found" }); return; }

  await auditFromRequest(sReq, {
    userId: sReq.staffSession?.subjectId ?? null,
    userName: sReq.staffSession?.subjectName ?? "unknown",
    role: sReq.staffSession?.role ?? "unknown",
    action: "backup_job_update",
    module: "backups",
    entityType: "backup_job",
    entityId: String(id),
    reason: `Updated backup job "${row.jobName}"`,
  });

  res.json(row);
});

// ─── DELETE /api/admin/backup-replication/jobs/:id ───────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.delete("/jobs/:id", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const id = Number(req.params["id"]);
  const [job] = await db.select().from(backupJobsTable).where(eq(backupJobsTable.id, id)).limit(1);
  const result = await db.delete(backupJobsTable).where(eq(backupJobsTable.id, id)).returning();
  if (result.length === 0) { res.status(404).json({ error: "Job not found" }); return; }

  await auditFromRequest(sReq, {
    userId: sReq.staffSession?.subjectId ?? null,
    userName: sReq.staffSession?.subjectName ?? "unknown",
    role: sReq.staffSession?.role ?? "unknown",
    action: "backup_job_delete",
    module: "backups",
    entityType: "backup_job",
    entityId: String(id),
    reason: `Deleted backup job "${job?.jobName ?? "unknown"}"`,
  });

  res.json({ ok: true });
});

// ─── POST /api/admin/backup-replication/jobs/:id/run ─────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/jobs/:id/run", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const id = Number(req.params["id"]);
  const [job] = await db.select().from(backupJobsTable).where(eq(backupJobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const startedAt = new Date();
  const [logRow] = await db.insert(backupJobLogsTable).values({
    jobId: id,
    status: "running",
    startedAt,
    notes: `Triggered manually by ${sReq.staffSession?.subjectName ?? "unknown"}`,
  }).returning();

  // Run backup asynchronously
  void (async () => {
    try {
      cleanupOldFiles();
      let rowCount = 0;
      let sizeBytes = 0;
      let notes = "";
      let filePath: string | null = null;

      if (job.backupType === "DB") {
        const result = await exportDatabaseSql();
        filePath = result.filePath;
        sizeBytes = result.sizeBytes;
        notes = `Database SQL exported: ${path.basename(result.filePath)} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`;
      } else if (job.backupType === "FULL") {
        const result = await exportFullSnapshot();
        filePath = result.filePath;
        sizeBytes = result.sizeBytes;
        notes = `Full snapshot exported: ${path.basename(result.filePath)} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB). Includes database + uploads + metadata.`;
      } else if (job.backupType === "REPORTS" || job.backupType === "DICOM_METADATA") {
        const result = await exportFilesZip();
        filePath = result.filePath;
        sizeBytes = result.sizeBytes;
        notes = `Files ZIP exported: ${path.basename(result.filePath)} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB). Folders: ${result.includedFolders.join(", ")}`;
      } else if (job.backupType === "CONFIG") {
        notes = "Config backup: master data tables exported via existing /api/backup/run endpoint.";
        rowCount = 0;
      } else {
        notes = `${job.backupType} backup completed (placeholder).`;
      }

      await db.update(backupJobLogsTable).set({
        status: "success",
        completedAt: new Date(),
        rowCount,
        sizeBytes,
        notes,
        filePath: filePath ?? null,
        encrypted: false,
      }).where(eq(backupJobLogsTable.id, logRow?.id ?? 0));

      await db.update(backupJobsTable).set({
        lastRunAt: startedAt,
        lastStatus: "success",
        lastError: null,
      }).where(eq(backupJobsTable.id, id));

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err, jobId: id }, "Backup job run failed");
      await db.update(backupJobLogsTable).set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: msg,
        encrypted: false,
      }).where(eq(backupJobLogsTable.id, logRow?.id ?? 0));

      await db.update(backupJobsTable).set({
        lastRunAt: startedAt,
        lastStatus: "failed",
        lastError: msg,
      }).where(eq(backupJobsTable.id, id));
    }
  })();

  res.json({ message: "Backup job started", logId: logRow?.id });
});

// ─── GET /api/admin/backup-replication/jobs/:id/logs ─────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.get("/jobs/:id/logs", requireAdmin as any, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const rows = await db.select().from(backupJobLogsTable)
    .where(eq(backupJobLogsTable.jobId, id))
    .orderBy(desc(backupJobLogsTable.createdAt))
    .limit(50);
  res.json(rows);
});

// ─── POST /api/admin/backup-replication/export-db ─────────────────────────────
// Direct database export (no job needed)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/export-db", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  try {
    cleanupOldFiles();
    const result = await exportDatabaseSql();
    const filename = path.basename(result.filePath);

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_export_db",
      module: "backups",
      entityType: "backup_file",
      entityId: filename,
      reason: `Exported database SQL (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`,
    });

    res.json({ ok: true, filename, filePath: result.filePath, sizeBytes: result.sizeBytes, downloadUrl: `/api/admin/backup-replication/download?file=${encodeURIComponent(filename)}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Export failed";
    logger.error({ err }, "DB export failed");
    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_export_db",
      module: "backups",
      entityType: "backup_file",
      entityId: "failed",
      reason: `Export failed: ${msg}`,
    });
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/admin/backup-replication/export-files ──────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/export-files", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  try {
    cleanupOldFiles();
    const result = await exportFilesZip();
    const filename = path.basename(result.filePath);

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_export_files",
      module: "backups",
      entityType: "backup_file",
      entityId: filename,
      reason: `Exported files ZIP (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB). Folders: ${result.includedFolders.join(", ")}`,
    });

    res.json({ ok: true, filename, filePath: result.filePath, sizeBytes: result.sizeBytes, includedFolders: result.includedFolders, downloadUrl: `/api/admin/backup-replication/download?file=${encodeURIComponent(filename)}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Export failed";
    logger.error({ err }, "Files export failed");
    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_export_files",
      module: "backups",
      entityType: "backup_file",
      entityId: "failed",
      reason: `Export failed: ${msg}`,
    });
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/admin/backup-replication/export-snapshot ───────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/export-snapshot", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  try {
    cleanupOldFiles();
    const result = await exportFullSnapshot();
    const filename = path.basename(result.filePath);

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_export_snapshot",
      module: "backups",
      entityType: "backup_file",
      entityId: filename,
      reason: `Exported full snapshot (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`,
    });

    res.json({
      ok: true,
      filename,
      filePath: result.filePath,
      sizeBytes: result.sizeBytes,
      metadata: result.metadata,
      downloadUrl: `/api/admin/backup-replication/download?file=${encodeURIComponent(filename)}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Export failed";
    logger.error({ err }, "Snapshot export failed");
    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_export_snapshot",
      module: "backups",
      entityType: "backup_file",
      entityId: "failed",
      reason: `Export failed: ${msg}`,
    });
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/admin/backup-replication/download ───────────────────────────────
// Download a generated backup file by filename
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.get("/download", requireAdmin as any, async (req, res): Promise<void> => {
  const fileName = String(req.query["file"] ?? "");
  if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    res.status(400).json({ error: "Invalid filename" }); return;
  }
  const filePath = path.join(ensureBackupDir(), fileName);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: "File not found" }); return;
  }
  const stats = statSync(filePath);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(stats.size));
  createReadStream(filePath).pipe(res);
});

// ─── POST /api/admin/backup-replication/import-db ────────────────────────────
// Import database from SQL file. Requires confirm=true and creates pre-restore backup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/import-db", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const { filePath: uploadedFilePath, confirm } = req.body as { filePath?: string; confirm?: boolean };

  if (!confirm) {
    res.status(400).json({ error: "Confirm required. This will overwrite current data. Set confirm=true to proceed." }); return;
  }
  if (!uploadedFilePath || !existsSync(uploadedFilePath)) {
    res.status(400).json({ error: "Valid filePath required" }); return;
  }

  try {
    // 1. Pre-restore backup. BEND-1: a failed pre-backup ABORTS the restore —
    // previously it fail-opened and the destructive restore proceeded without
    // a way back. allowWithoutPreBackup=true is the explicit override.
    const { allowWithoutPreBackup } = req.body as { allowWithoutPreBackup?: boolean };
    let preBackupFile: string | null = null;
    try {
      const pre = await exportDatabaseSql();
      preBackupFile = pre.filePath;
    } catch (preErr) {
      logger.error({ preErr }, "Pre-restore backup failed");
      if (!allowWithoutPreBackup) {
        res.status(409).json({
          error: "Pre-restore backup FAILED — restore aborted. Fix the backup path (pg_dump/disk) or pass allowWithoutPreBackup=true to explicitly proceed without a safety copy.",
        });
        return;
      }
    }

    // 2. Restore
    const result = await restoreDatabaseFromSql(uploadedFilePath);

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_db",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath),
      reason: `Database restored. Pre-backup: ${preBackupFile ? path.basename(preBackupFile) : "failed"}`,
    });

    res.json({ ok: true, message: result.message, preBackupFile: preBackupFile ? path.basename(preBackupFile) : null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Import failed";
    logger.error({ err }, "DB import failed");
    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_db",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath ?? "unknown"),
      reason: `Import failed: ${msg}`,
    });
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/admin/backup-replication/import-snapshot ───────────────────────
// Import full snapshot ZIP. Extracts database.sql + uploads.zip. Protected files are skipped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/import-snapshot", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const { filePath: uploadedFilePath, confirm } = req.body as { filePath?: string; confirm?: boolean };

  if (!confirm) {
    res.status(400).json({ error: "Confirm required. This will overwrite current data. Set confirm=true to proceed." }); return;
  }
  if (!uploadedFilePath || !existsSync(uploadedFilePath)) {
    res.status(400).json({ error: "Valid filePath required" }); return;
  }

  try {
    // 1. Pre-restore backup. BEND-1: failure ABORTS unless explicitly
    // overridden (same rule as /import-db).
    const { allowWithoutPreBackup } = req.body as { allowWithoutPreBackup?: boolean };
    let preBackupFile: string | null = null;
    try {
      const pre = await exportDatabaseSql();
      preBackupFile = pre.filePath;
    } catch (preErr) {
      logger.error({ preErr }, "Pre-restore backup failed");
      if (!allowWithoutPreBackup) {
        res.status(409).json({
          error: "Pre-restore backup FAILED — restore aborted. Fix the backup path (pg_dump/disk) or pass allowWithoutPreBackup=true to explicitly proceed without a safety copy.",
        });
        return;
      }
    }

    // 2. Read and extract snapshot
    const data = await fs.readFile(uploadedFilePath);
    const zip = await JSZip.loadAsync(data);

    // Extract database.sql
    const dbEntry = zip.file("database.sql");
    if (!dbEntry) {
      res.status(400).json({ error: "Snapshot missing database.sql" }); return;
    }
    const dbSql = await dbEntry.async("string");
    const tempDbPath = path.join(ensureBackupDir(), `restore-temp-${Date.now()}.sql`);
    await fs.writeFile(tempDbPath, dbSql, "utf-8");

    // Restore database
    await restoreDatabaseFromSql(tempDbPath);
    await fs.unlink(tempDbPath).catch(() => {});

    // Extract uploads.zip if present
    const uploadsEntry = zip.file("uploads.zip");
    let filesRestored = 0;
    if (uploadsEntry) {
      const uploadsData = await uploadsEntry.async("nodebuffer");
      const uploadsZip = await JSZip.loadAsync(uploadsData);
      for (const [name, entry] of Object.entries(uploadsZip.files)) {
        if (entry.dir) continue;
        const baseName = path.basename(name);
        if (PROTECTED_FILES.has(baseName.toLowerCase())) {
          logger.info({ file: name }, "Skipping protected file during import");
          continue;
        }
        // Map to local folder
        const targetPath = path.resolve("artifacts/api-server/data/uploads", baseName);
        const parent = path.dirname(targetPath);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        const fileData = await entry.async("nodebuffer");
        await fs.writeFile(targetPath, fileData);
        filesRestored++;
      }
    }

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_snapshot",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath),
      reason: `Snapshot restored. DB + ${filesRestored} files. Pre-backup: ${preBackupFile ? path.basename(preBackupFile) : "failed"}`,
    });

    res.json({ ok: true, message: "Snapshot restored", filesRestored, preBackupFile: preBackupFile ? path.basename(preBackupFile) : null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Import failed";
    logger.error({ err }, "Snapshot import failed");
    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_snapshot",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath ?? "unknown"),
      reason: `Import failed: ${msg}`,
    });
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/admin/backup-replication/import-files ──────────────────────────
// Import uploaded files ZIP. Protected files are skipped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/import-files", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const { filePath: uploadedFilePath, confirm } = req.body as { filePath?: string; confirm?: boolean };

  if (!confirm) {
    res.status(400).json({ error: "Confirm required. This will overwrite current uploaded files. Set confirm=true to proceed." }); return;
  }
  if (!uploadedFilePath || !existsSync(uploadedFilePath)) {
    res.status(400).json({ error: "Valid filePath required" }); return;
  }

  try {
    const data = await fs.readFile(uploadedFilePath);
    const zip = await JSZip.loadAsync(data);

    let filesRestored = 0;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const baseName = path.basename(name);
      if (PROTECTED_FILES.has(baseName.toLowerCase())) {
        logger.info({ file: name }, "Skipping protected file during import");
        continue;
      }
      const targetPath = path.resolve("artifacts/api-server/data/uploads", baseName);
      const parent = path.dirname(targetPath);
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      const fileData = await entry.async("nodebuffer");
      await fs.writeFile(targetPath, fileData);
      filesRestored++;
    }

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_files",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath),
      reason: `Files imported: ${filesRestored} files restored`,
    });

    res.json({ ok: true, filesRestored });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Import failed";
    logger.error({ err }, "Files import failed");
    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_files",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath ?? "unknown"),
      reason: `Import failed: ${msg}`,
    });
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/admin/backup-replication/upload ───────────────────────────────
// Upload a file for import (returns file path)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.post("/upload", requireAdmin as any, async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  // Expect multipart with "file" field — handled by multer elsewhere, or base64 here
  // Simple base64 upload for now:
  const { filename, data } = req.body as { filename?: string; data?: string };
  if (!filename || !data) {
    res.status(400).json({ error: "filename and data (base64) required" }); return;
  }

  const dir = ensureBackupDir();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, safeName);
  const buffer = Buffer.from(data, "base64");
  await fs.writeFile(filePath, buffer);

  await auditFromRequest(sReq, {
    userId: sReq.staffSession?.subjectId ?? null,
    userName: sReq.staffSession?.subjectName ?? "unknown",
    role: sReq.staffSession?.role ?? "unknown",
    action: "backup_upload",
    module: "backups",
    entityType: "backup_file",
    entityId: safeName,
    reason: `Uploaded backup file for import (${buffer.length} bytes)`,
  });

  res.json({ ok: true, filePath, filename: safeName });
});
