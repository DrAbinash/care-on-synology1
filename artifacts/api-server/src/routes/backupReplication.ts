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
import { resolveBackupDataFolders, resolveDataDir } from "../lib/backupHealth";
import { decryptBackupToSql } from "../lib/backupCrypto";

export const backupReplicationRouter = Router();

const streamPipeline = promisify(pipeline);

// Temporary storage for backup exports
const TEMP_BACKUP_DIR = process.env["BACKUP_TEMP_DIR"] ?? "/tmp/care-diagnostics-backups";
const OLD_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Config-only backup scope. Exported so the scheduler (cron.ts) and the manual
// "Run now" path cannot drift to different table lists for the same job type.
export const CONFIG_BACKUP_TABLES = ["clinic_settings", "email_settings", "printer_settings", "pacs_settings"];

// Protected files that should never be overwritten during import
const PROTECTED_FILES = new Set([
  ".env", ".env.local", ".env.production", ".env.development",
  "docker-compose.yml", "docker-compose.yaml", "docker-compose.prod.yml",
  "Dockerfile", "Dockerfile.prod", "docker-compose.override.yml",
  "synology-compose.yml", "synology-compose.yaml",
]);

// Folders to include in the uploaded-files export — resolved to the REAL
// runtime data dir (CWD/data, i.e. /app/data in Docker) rather than the old
// repo-relative paths that silently resolved to a nonexistent
// /app/artifacts/... under the container and zipped nothing. See
// lib/backupHealth.resolveBackupDataFolders.

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
    lines.push("--");
    lines.push("-- WARNING: DATA ONLY — this fallback exporter emits TRUNCATE + INSERT and");
    lines.push("-- does NOT contain CREATE TABLE/INDEX statements. It can only be restored");
    lines.push("-- into a database whose schema already exists (run migrations first).");
    lines.push("-- It is used only when the pg_dump binary is unavailable; a pg_dump");
    lines.push("-- artifact is schema-complete and is always preferred for disaster recovery.");
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

      // Fetch data in batches.
      //
      // ORDER BY ctid is REQUIRED, not cosmetic: LIMIT/OFFSET without an ORDER
      // BY has no defined row order in Postgres, so successive pages could
      // silently skip rows (data missing from the backup) or repeat them
      // (duplicate-key failures on restore). ctid is the physical row location
      // — always present, no dependency on a primary key existing, and stable
      // for the duration of this read.
      const batchSize = 500;
      let offset = 0;
      let rows: unknown[] = [];
      do {
        const dataRes = await client.query(`SELECT * FROM "${table}" ORDER BY ctid LIMIT ${batchSize} OFFSET ${offset}`);
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

/**
 * Map a zip entry back to the exact file it came from.
 *
 * exportFilesZip() writes entries as "<label>/<nested>/<path>", where <label> is
 * one of resolveBackupDataFolders()'s labels (uploads, reports, object-storage,
 * attached_assets), each of which is a DIFFERENT root under CARE_DATA_DIR.
 *
 * The import path used to do `path.basename(name)` and write everything into a
 * single hardcoded, CWD-relative "artifacts/api-server/data/uploads". That was
 * wrong three ways at once, and silently:
 *   1. It flattened the tree — "uploads/2026/07/scan.pdf" became "scan.pdf", so
 *      every DB row pointing at the original relative path broke after a restore.
 *   2. It merged four separate roots into one, so two files legitimately named
 *      report.pdf in different folders overwrote each other while BOTH were
 *      counted in filesRestored — data loss reported as success.
 *   3. It ignored CARE_DATA_DIR, so in Docker the files landed in
 *      /app/artifacts/... instead of the mounted /app/data volume — i.e. outside
 *      persistent storage and where nothing reads them.
 *
 * Returns null for an entry that must be skipped (traversal attempt). Using
 * basename() did incidentally prevent zip-slip, so the structural fix has to
 * re-establish that guarantee explicitly: the resolved path must stay inside its
 * root.
 */
export function resolveRestoreTarget(
  entryName: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): { targetPath: string; label: string; relativePath: string } | null {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/")) return null;
  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  // Reject traversal outright rather than trying to sanitize it away.
  if (segments.some((s) => s === "." || s === "..")) return null;

  const folders = resolveBackupDataFolders(env, cwd);
  const matched = folders.find((f) => f.label === segments[0]);
  // A labelled entry keeps its remaining path inside that root. An unlabelled
  // entry (a hand-made or pre-label zip) goes to the uploads root, structure
  // intact, instead of being flattened.
  const root = matched ? matched.path : path.join(resolveDataDir(env, cwd), "uploads");
  const label = matched ? matched.label : "uploads";
  const rest = matched ? segments.slice(1) : segments;
  if (rest.length === 0) return null;

  const relativePath = rest.join("/");
  const targetPath = path.resolve(root, ...rest);
  // Belt-and-braces: even after the ".." check, confirm containment.
  const rootResolved = path.resolve(root);
  if (targetPath !== rootResolved && !targetPath.startsWith(rootResolved + path.sep)) return null;

  return { targetPath, label, relativePath };
}

/**
 * Restore every file entry in a zip to its correct root, preserving structure.
 * Shared by /import-files and /import-snapshot so the two cannot drift.
 */
async function restoreFilesFromZip(zip: JSZip): Promise<{
  filesRestored: number; skippedProtected: string[]; skippedUnsafe: string[]; byLabel: Record<string, number>;
}> {
  let filesRestored = 0;
  const skippedProtected: string[] = [];
  const skippedUnsafe: string[] = [];
  const byLabel: Record<string, number> = {};

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (PROTECTED_FILES.has(path.basename(name).toLowerCase())) {
      skippedProtected.push(name);
      logger.info({ file: name }, "Skipping protected file during import");
      continue;
    }
    const target = resolveRestoreTarget(name);
    if (!target) {
      skippedUnsafe.push(name);
      logger.warn({ file: name }, "Skipping unsafe/unmappable zip entry during import");
      continue;
    }
    const parent = path.dirname(target.targetPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    const fileData = await entry.async("nodebuffer");
    await fs.writeFile(target.targetPath, fileData);
    filesRestored++;
    byLabel[target.label] = (byLabel[target.label] ?? 0) + 1;
  }

  return { filesRestored, skippedProtected, skippedUnsafe, byLabel };
}

async function exportFilesZip(): Promise<{ filePath: string; sizeBytes: number; includedFolders: string[]; missingFolders: string[]; fileCount: number }> {
  const dir = ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const filePath = path.join(dir, `caredeoghar-files-${timestamp}.zip`);

  const zip = new JSZip();
  const includedFolders: string[] = [];
  const missingFolders: string[] = [];
  let fileCount = 0;

  for (const folder of resolveBackupDataFolders()) {
    if (!existsSync(folder.path)) { missingFolders.push(folder.label); continue; }
    includedFolders.push(folder.label);
    const zipFolder = zip.folder(folder.label);
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
          fileCount++;
        }
      }
    }
    addFiles(folder.path, zipFolder);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(filePath, buffer);
  return { filePath, sizeBytes: buffer.length, includedFolders, missingFolders, fileCount };
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
    missingFolders: filesResult.missingFolders,
    fileCount: filesResult.fileCount,
    // Loud, recorded signal instead of silent success: a snapshot whose files
    // portion captured zero files is almost certainly a misconfigured data
    // path, not an empty clinic.
    filesWarning: filesResult.fileCount === 0
      ? `No files captured (missing folders: ${filesResult.missingFolders.join(", ") || "none"}). Check CARE_DATA_DIR / the /app/data volume mount.`
      : null,
    pgDumpUsed: true,
  };
  if (filesResult.fileCount === 0) {
    logger.warn({ missingFolders: filesResult.missingFolders }, "[backup] files snapshot captured ZERO files — data path likely misconfigured");
  }

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

/**
 * Restore a backup artifact into the live database.
 *
 * Decrypts FIRST. This function used to hand `filePath` straight to
 * `psql --file`, so every encrypted backup the scheduler produced (.sql.enc)
 * failed here with a SQL syntax error on its own ciphertext — the scheduled
 * backups were effectively unrestorable. decryptBackupToSql() now normalizes
 * openssl-encrypted, legacy-envelope and plaintext dumps to plaintext SQL
 * before psql sees them, and the temp plaintext is always removed afterwards
 * (a decrypted clinical database must not linger on disk).
 */
async function restoreDatabaseFromSql(filePath: string): Promise<{ rowCount: number | null; message: string; cipherFormat: string }> {
  const creds = parseDatabaseUrl();
  if (!creds) throw new Error("DATABASE_URL not configured");

  const decrypted = await decryptBackupToSql(filePath, ensureBackupDir());
  const sqlPath = decrypted.sqlPath;
  const cleanup = async () => {
    if (decrypted.producedTempFile) await fs.unlink(sqlPath).catch(() => {});
  };

  const env = { ...process.env, PGPASSWORD: creds.password };

  try {
    return await new Promise<{ rowCount: number | null; message: string; cipherFormat: string }>((resolve, reject) => {
    const psql = spawn("psql", [
      "--host", creds.host,
      "--port", creds.port,
      "--username", creds.username,
      "--dbname", creds.database,
      "--file", sqlPath,
      "--single-transaction",
      // Without this psql reports exit 0 even when individual statements fail,
      // which would report a half-applied restore as a success.
      "--set", "ON_ERROR_STOP=1",
    ], { env, stdio: ["ignore", "pipe", "pipe"] });

    let errorOutput = "";
    let output = "";
    psql.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
    psql.stdout.on("data", (chunk) => { output += String(chunk); });

    psql.on("error", (err) => reject(new Error(`psql failed to start: ${err.message}`)));
    psql.on("close", (code) => {
      if (code === 0) {
        resolve({
          rowCount: null,
          message: `Database restored successfully (source: ${decrypted.format})`,
          cipherFormat: decrypted.format,
        });
      } else {
        reject(new Error(`psql exited with code ${code}: ${errorOutput}`));
      }
    });
    });
  } finally {
    await cleanup();
  }
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
        // Previously this recorded SUCCESS with notes claiming the tables were
        // "exported via existing /api/backup/run endpoint" while exporting
        // NOTHING — filePath null, sizeBytes 0, green in the UI, zero bytes on
        // disk. It now performs the real scoped dump (same table list the
        // scheduler uses) so a CONFIG job produces a restorable artifact.
        const result = await exportDatabaseSql(CONFIG_BACKUP_TABLES);
        filePath = result.filePath;
        sizeBytes = result.sizeBytes;
        notes = `Config tables exported: ${path.basename(result.filePath)} (${(result.sizeBytes / 1024).toFixed(1)} KB). Tables: ${CONFIG_BACKUP_TABLES.join(", ")}`;
      } else {
        // Never record an unimplemented backup type as a completed backup. A
        // green "success" row with no file is the single most dangerous thing a
        // backup system can report — throwing puts it in the catch block below,
        // where it is recorded as failed with an actionable message.
        throw new Error(
          `Backup type "${job.backupType}" is not implemented — no backup was produced. ` +
          "Use DB, FULL, CONFIG, REPORTS or DICOM_METADATA.",
        );
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

// ─── GET /api/admin/backup-replication/files ──────────────────────────────────
// Backup artifacts already present ON THE SERVER, so a restore does not have to
// go through the browser upload path.
//
// This exists because /upload receives the whole file base64-encoded inside a
// JSON body, and app.ts caps express.json() at 5mb — with base64's ~33% overhead
// that is a hard ceiling of roughly 3.6 MB, far below any real clinic dump. The
// restore buttons were therefore unusable for exactly the backups that matter.
// Scheduled jobs already write to their destinationPath (typically a NAS mount),
// and manual exports stay in the temp backup dir, so in practice the file the
// admin needs to restore is already reachable by the server.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
backupReplicationRouter.get("/files", requireAdmin as any, async (_req, res): Promise<void> => {
  const dirs = new Set<string>([ensureBackupDir()]);
  try {
    const jobs = await db.select().from(backupJobsTable);
    for (const j of jobs) {
      if (j.destinationPath && j.destinationPath.trim()) dirs.add(j.destinationPath.trim());
    }
  } catch (err) {
    logger.warn({ err }, "Could not read backup jobs while listing server-side backups");
  }

  const BACKUP_EXT = /\.(sql|zip|enc|gz)$/i;
  const files: Array<{ filePath: string; fileName: string; directory: string; sizeBytes: number; modifiedAt: string; encrypted: boolean }> = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err) {
      logger.warn({ err, dir }, "Could not list backup directory");
      continue;
    }
    for (const name of entries) {
      if (!BACKUP_EXT.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        files.push({
          filePath: full,
          fileName: name,
          directory: dir,
          sizeBytes: st.size,
          modifiedAt: st.mtime.toISOString(),
          encrypted: /\.enc$/i.test(name),
        });
      } catch { /* unreadable entry — skip */ }
    }
  }
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  res.json({ files, directories: [...dirs] });
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
    let fileNotes = "";
    if (uploadsEntry) {
      const uploadsData = await uploadsEntry.async("nodebuffer");
      const uploadsZip = await JSZip.loadAsync(uploadsData);
      const restored = await restoreFilesFromZip(uploadsZip);
      filesRestored = restored.filesRestored;
      fileNotes = ` Files by folder: ${JSON.stringify(restored.byLabel)}.` +
        (restored.skippedProtected.length ? ` Skipped ${restored.skippedProtected.length} protected.` : "") +
        (restored.skippedUnsafe.length ? ` Skipped ${restored.skippedUnsafe.length} unsafe entries.` : "");
    }

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_snapshot",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath),
      reason: `Snapshot restored. DB + ${filesRestored} files.${fileNotes} Pre-backup: ${preBackupFile ? path.basename(preBackupFile) : "failed"}`,
    });

    res.json({ ok: true, message: "Snapshot restored", filesRestored, notes: fileNotes.trim() || undefined, preBackupFile: preBackupFile ? path.basename(preBackupFile) : null });
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

    const restored = await restoreFilesFromZip(zip);
    const filesRestored = restored.filesRestored;

    await auditFromRequest(sReq, {
      userId: sReq.staffSession?.subjectId ?? null,
      userName: sReq.staffSession?.subjectName ?? "unknown",
      role: sReq.staffSession?.role ?? "unknown",
      action: "backup_import_files",
      module: "backups",
      entityType: "backup_file",
      entityId: path.basename(uploadedFilePath),
      reason: `Files imported: ${filesRestored} restored by folder ${JSON.stringify(restored.byLabel)}` +
        (restored.skippedProtected.length ? `; ${restored.skippedProtected.length} protected skipped` : "") +
        (restored.skippedUnsafe.length ? `; ${restored.skippedUnsafe.length} unsafe skipped` : ""),
    });

    res.json({
      ok: true,
      filesRestored,
      byFolder: restored.byLabel,
      skippedProtected: restored.skippedProtected.length,
      skippedUnsafe: restored.skippedUnsafe.length,
    });
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
