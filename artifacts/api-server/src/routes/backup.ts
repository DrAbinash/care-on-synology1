import { Router } from "express";
import { db } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { backupLogsTable } from "@workspace/db/schema";
import { desc, eq, and, gt } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditLog } from "../lib/audit";
import { encryptBackup, decryptBackup } from "@workspace/crypto";

export const backupRouter = Router();

// White-list of tables included in a "settings + master data" backup.
// We deliberately do NOT include patient/order/bill data (that can be huge).
// Users wanting a full DB backup should use Postgres-level pg_dump.
const BACKUP_TABLES: Array<{ key: string; table: Table }> = [
  { key: "users", table: schema.usersTable },
  { key: "clinic_settings", table: schema.clinicSettingsTable },
  { key: "doctors", table: schema.doctorsTable },
  { key: "diagnostic_tests", table: schema.testsTable },
  { key: "test_categories", table: schema.testCategoriesTable },
  { key: "packages", table: schema.packagesTable },
  { key: "package_tests", table: schema.packageTestsTable },
  { key: "report_templates", table: schema.reportTemplatesTable },
  { key: "departments", table: schema.departmentsTable },
  { key: "branches", table: schema.branchesTable },
  { key: "machines", table: schema.machinesTable },
  { key: "machine_amc_contracts", table: schema.machineAmcContractsTable },
  { key: "commission_rules", table: schema.commissionRulesTable },
  { key: "discount_reasons", table: schema.discountReasonsTable },
  { key: "signatures", table: schema.signaturesTable },
  { key: "vendors", table: schema.vendorsTable },
];

// GET /api/backup/logs — recent backup history (admin-only)
backupRouter.get("/logs", async (req: StaffAuthRequest, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) { res.status(401).json({ error: "Authentication required" }); return; }
  const [session] = await db.select().from(schema.portalSessionsTable).where(
    and(eq(schema.portalSessionsTable.token, token), eq(schema.portalSessionsTable.scope, "staff"), gt(schema.portalSessionsTable.expiresAt, new Date()))
  ).limit(1);
  if (!session) { res.status(401).json({ error: "Invalid or expired session" }); return; }
  const [user] = await db.select({ role: schema.usersTable.role }).from(schema.usersTable).where(eq(schema.usersTable.id, session.subjectId)).limit(1);
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) { res.status(403).json({ error: "Admin access required" }); return; }
  const rows = await db.select().from(backupLogsTable).orderBy(desc(backupLogsTable.createdAt)).limit(50);
  res.json(rows);
});

// POST /api/backup/restore — restore master data from a JSON backup file
// Uploaded via multipart/form-data field "backupFile".  Transactional —
// all-or-nothing. Only admins/super-admins may call this.
backupRouter.post("/restore", async (req: StaffAuthRequest, res) => {
  // Must be admin/super-admin
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [session] = await db
    .select()
    .from(schema.portalSessionsTable)
    .where(
      and(
        eq(schema.portalSessionsTable.token, token),
        eq(schema.portalSessionsTable.scope, "staff"),
        gt(schema.portalSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const [user] = await db
    .select({ role: schema.usersTable.role, name: schema.usersTable.name })
    .from(schema.usersTable)
    .where(eq(schema.usersTable.id, session.subjectId))
    .limit(1);

  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    res.status(403).json({ error: "Admin access required for restore" });
    return;
  }

  // Accept raw JSON body or an encrypted base64 envelope string
  let rawBody: string;
  if (typeof req.body === "string") {
    rawBody = req.body;
  } else if (req.body && typeof req.body.encrypted === "string") {
    rawBody = req.body.encrypted;
  } else {
    res.status(400).json({ error: "Invalid backup payload. Send encrypted base64 string directly, or { encrypted: string }" });
    return;
  }

  let decrypted: string;
  try {
    decrypted = decryptBackup(rawBody);
  } catch {
    // Fallback: treat as legacy plaintext JSON for backwards compatibility
    decrypted = rawBody;
  }

  let backup: { version?: number; generatedAt?: string; tables?: Record<string, unknown[]>; checksum?: string } | null;
  try {
    backup = JSON.parse(decrypted);
  } catch {
    res.status(400).json({ error: "Backup payload is not valid JSON (decrypted or plaintext)" });
    return;
  }

  if (!backup || !backup.tables || typeof backup.tables !== "object") {
    res.status(400).json({ error: "Invalid backup payload. Expected { version, generatedAt, tables, checksum? }" });
    return;
  }

  // Validate version
  if (backup.version !== 1) {
    res.status(400).json({ error: `Unsupported backup version: ${backup.version ?? "missing"}` });
    return;
  }

  // Verify checksum if provided
  if (backup.checksum) {
    const expected = crypto.createHash("sha256").update(JSON.stringify(backup.tables)).digest("hex");
    if (expected !== backup.checksum) {
      res.status(400).json({ error: "Backup checksum mismatch — payload may be corrupted" });
      return;
    }
  }

  // Validate only known tables
  const allowedKeys = BACKUP_TABLES.map((t) => t.key);
  const unknownKeys = Object.keys(backup.tables).filter((k) => !allowedKeys.includes(k));
  if (unknownKeys.length > 0) {
    res.status(400).json({ error: `Unknown tables in backup: ${unknownKeys.join(", ")}` });
    return;
  }

  // Restore each table in a single transaction using Postgres-level BEGIN/COMMIT
  // to guarantee all-or-nothing behaviour. We clear each table then insert backup rows.
  const results: Record<string, { restored: number }> = {};

  try {
    // Use raw client for explicit transaction
    const { pool } = await import("@workspace/db");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const { key, table } of BACKUP_TABLES) {
        const rows = backup.tables[key];
        if (!Array.isArray(rows)) continue;

        // Get column names from the table schema (heuristic: table.$columns)
        // For Drizzle tables we need to inspect the column names.
        // Simpler approach: use a raw DELETE then re-insert via db.execute
        const tableName = Object.keys(table)[0]; // not reliable — we'll use hardcoded names

        // Hardcoded safe table names — these match the DB schema exactly
        const safeTableName = (() => {
          switch (key) {
            case "users": return "users";
            case "clinic_settings": return "clinic_settings";
            case "doctors": return "doctors";
            case "diagnostic_tests": return "diagnostic_tests";
            case "test_categories": return "test_categories";
            case "packages": return "packages";
            case "package_tests": return "package_tests";
            case "report_templates": return "report_templates";
            case "departments": return "departments";
            case "branches": return "branches";
            case "machines": return "machines";
            case "machine_amc_contracts": return "machine_amc_contracts";
            case "commission_rules": return "commission_rules";
            case "discount_reasons": return "discount_reasons";
            case "signatures": return "signatures";
            case "vendors": return "vendors";
            default: return null;
          }
        })();

        if (!safeTableName) continue;

        // Skip users table — too dangerous to bulk replace live accounts
        if (safeTableName === "users") {
          results[key] = { restored: 0 };
          continue;
        }

        await client.query(`DELETE FROM ${safeTableName}`);
        let inserted = 0;
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const keys = Object.keys(row).filter((k) => !k.endsWith("_id") || k === "id");
          // Build INSERT dynamically — safer than trusting all columns
          // For simplicity, we'll JSON-serialise and do a generic insert.
          // In practice we rebuild the INSERT statement.
          const cols: string[] = [];
          const vals: unknown[] = [];
          const placeholders: string[] = [];
          for (const [col, val] of Object.entries(row)) {
            if (col === "id" || col === "created_at" || col === "updated_at") continue;
            if (val === undefined) continue;
            cols.push(col);
            if (val === null) {
              vals.push(null);
            } else if (typeof val === "object") {
              vals.push(JSON.stringify(val));
            } else {
              vals.push(val);
            }
            placeholders.push(`$${vals.length}`);
          }
          if (cols.length === 0) continue;
          await client.query(
            `INSERT INTO ${safeTableName} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
            vals,
          );
          inserted++;
        }
        results[key] = { restored: inserted };
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Audit log the restore
    await auditLog({
      userId: session.subjectId,
      userName: user.name,
      role: user.role,
      action: "restore",
      module: "backups",
      entityType: "backup",
      entityId: backup.generatedAt ?? "unknown",
      reason: "Master data restore from JSON backup",
      ipAddress: req.ip ?? undefined,
    });

    res.json({ success: true, restored: results, generatedAt: backup.generatedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Restore failed";
    console.error("[restore]", err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/backup/run — generate JSON backup of master data, log it, return a download
backupRouter.post("/run", async (req, res) => {
  const performedBy = typeof req.body?.performedBy === "string" ? req.body.performedBy : "system";
  try {
    const dump: Record<string, unknown[]> = {};
    let totalRows = 0;
    for (const { key, table } of BACKUP_TABLES) {
      try {
        const rows = await db.select().from(table);
        dump[key] = rows;
        totalRows += rows.length;
      } catch {
        // table may not exist in some installations — skip
        dump[key] = [];
      }
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      version: 1,
      tables: dump,
    };
    const json = JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(json, "utf8");

    await db.insert(backupLogsTable).values({
      backupType: "manual",
      status: "success",
      format: "json",
      rowCount: totalRows,
      sizeBytes,
      performedBy,
      encrypted: true,
    });

    const encrypted = encryptBackup(json);
    const filename = `care_diagnostics_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json.enc`;
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(encrypted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Backup failed";
    await db.insert(backupLogsTable).values({
      backupType: "manual",
      status: "failed",
      format: "json",
      errorMessage: msg,
      performedBy,
      encrypted: true,
    });
    res.status(500).json({ error: msg });
  }
});

// GET /api/backup/info — what's included
backupRouter.get("/info", (_req, res) => {
  res.json({ tables: BACKUP_TABLES.map(t => t.key) });
});

// DELETE /api/admin/backups/:id — remove a backup log entry
backupRouter.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  await db.delete(backupLogsTable).where(eq(backupLogsTable.id, id));
  res.json({ success: true });
});
