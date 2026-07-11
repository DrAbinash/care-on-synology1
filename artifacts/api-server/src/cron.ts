import cron from "node-cron";
import { db } from "@workspace/db";
import {
  emailSettingsTable, billsTable, billAuditsTable, paymentsTable,
  doctorsTable, commissionRulesTable, orderTestsTable, ordersTable, testsTable,
  dicomNodesTable, dicomPullJobsTable, whatsappSettingsTable,
} from "@workspace/db/schema";
import { sendDailySummaryEmail, sendCommissionMonthEndEmail, sendMonthlyAuditEmail } from "./email";
import { runBooksSanity } from "./routes/books-sanity";
import { exportDatabaseSql, exportDatabaseSqlFallback, computeSha256 } from "./routes/backupReplication";
import { auditRunsTable, watchdogStatusTable } from "@workspace/db/schema";
import { gte, and, lte, eq, inArray, isNull, or, lt } from "drizzle-orm";
import { encryptBackup } from "@workspace/crypto";
import {
  startDimsePullAgent,
  stopDimsePullAgent,
  isDimsePullAgentRunning,
} from "./services/dicom-pull-agent/dimse-agent";
import { runRadiologyJobTick } from "./lib/radiologyJobs";
import { RADIOLOGY_JOB_HANDLERS } from "./lib/radiologyJobHandlers";
import { runScheduledAuditChainVerification } from "./lib/auditVerification";

let currentTask: ReturnType<typeof cron.schedule> | null = null;
// Track already-fired events per day to avoid double-firing
const firedToday = new Set<string>();

export function startCronScheduler() {
  scheduleDaily();
  scheduleMonthEndCommission();
  scheduleDicomAutoPull();
  scheduleMonthlyAudit();
  scheduleBankingAutoSync();
  scheduleFraudDetection();
  scheduleAutomatedBackups();
  scheduleSessionIdleSweep();
  scheduleAuditLogPurge();
  schedulePacsPullerWatchdog();
  scheduleWhatsappReminders();
  scheduleRadiologyJobs();
  scheduleAuditChainVerify();

  // Start the in-process DIMSE pull agent if enabled.
  // When ENABLE_DICOM_PULL_AGENT is set, the agent polls for pull jobs and
  // executes C-FIND / C-MOVE natively via dcmjs-dimse (no external PC needed).
  const enableDimse =
    process.env["ENABLE_DICOM_PULL_AGENT"] === "1" ||
    process.env["ENABLE_DICOM_PULL_AGENT"] === "true";
  if (enableDimse && !isDimsePullAgentRunning()) {
    startDimsePullAgent();
    console.log("[cron] In-process DIMSE pull agent started");
  }
}

// ── BEND-1: durable radiology job runner ─────────────────────────────────────
// Every minute: requeue stale running claims (worker-restart safety), then
// run up to 5 due jobs. Bounded retries + dead-letter live in radiologyJobs;
// handlers are idempotent, so a crash between attempts never double-sends.
function scheduleRadiologyJobs() {
  cron.schedule("* * * * *", async () => {
    try {
      const result = await runRadiologyJobTick(RADIOLOGY_JOB_HANDLERS, { maxJobs: 5 });
      if (result.ran.length > 0 || result.requeuedStale > 0) {
        console.log("[cron] radiology jobs:", JSON.stringify(result));
      }
    } catch (err) {
      console.error("[cron] radiology job tick failed:", err);
    }
  });
}

// ── BEND-1: scheduled audit-chain verification (safe default cadence) ────────
// Daily windowed verification of the most recent slice; the result persists
// to radiology_ops_checks so health reports last-verified time + outcome.
// Detection only — a broken chain is NEVER resealed.
function scheduleAuditChainVerify() {
  cron.schedule("15 4 * * *", async () => {
    try {
      await runScheduledAuditChainVerification();
    } catch (err) {
      console.error("[cron] audit-chain verification failed:", err);
    }
  });
}

// ── Automated Backup Scheduler ────────────────────────────────────────────────────────
// Every minute, check backup_jobs for enabled jobs whose schedule should fire.
// Supports cron expressions and simple keywords: DAILY, HOURLY, WEEKLY, MANUAL.
function scheduleAutomatedBackups() {
  cron.schedule("* * * * *", async () => {
    try {
      await fireScheduledBackups();
    } catch (err) {
      console.error("[cron] Scheduled backup runner failed:", err);
    }
  });
  console.log("[cron] Automated backup scheduler started (checks every minute)");
}

export async function fireScheduledBackups() {
  const { backupJobsTable, backupJobLogsTable } = await import("@workspace/db/schema");
  const { sendBackupFailureEmail } = await import("./email");
  const now = new Date();

  const jobs = await db
    .select()
    .from(backupJobsTable)
    .where(eq(backupJobsTable.isEnabled, true));

  for (const job of jobs) {
    if (!job.schedule || job.schedule === "MANUAL") continue;

    // Should this schedule fire right now?
    let shouldFire = false;
    const s = job.schedule.trim().toUpperCase();
    const lastRun = job.lastRunAt ? new Date(job.lastRunAt) : null;

    if (s === "DAILY") {
      shouldFire = !lastRun || (now.getTime() - lastRun.getTime()) > 23 * 60 * 60 * 1000;
      // Only fire at 02:00 local time (configurable; here hardcoded for safety window)
      shouldFire = shouldFire && now.getHours() === 2 && now.getMinutes() === 0;
    } else if (s === "HOURLY") {
      shouldFire = !lastRun || (now.getTime() - lastRun.getTime()) > 55 * 60 * 1000;
      shouldFire = shouldFire && now.getMinutes() === 0;
    } else if (s === "WEEKLY") {
      shouldFire = !lastRun || (now.getTime() - lastRun.getTime()) > 6 * 24 * 60 * 60 * 1000;
      shouldFire = shouldFire && now.getDay() === 0 && now.getHours() === 2 && now.getMinutes() === 0;
    } else if (s === "* * * * *" || s === "*/1 * * * *") {
      // Every minute — useful for testing; limited to jobs with < 1 MB expected size
      shouldFire = !lastRun || (now.getTime() - lastRun.getTime()) > 55_000;
    } else if (s.includes("*")) {
      // Basic cron expression check — minute-level granularity only
      const minutePart = s.split(" ")[0];
      if (minutePart === "*" || minutePart === String(now.getMinutes())) {
        shouldFire = !lastRun || (now.getTime() - lastRun.getTime()) > (parseInt(minutePart, 10) || 1) * 60_000;
      }
    }

    if (!shouldFire) continue;

    // Deduplicate: skip if already started this exact minute
    const dedupeKey = `backup-job-${job.id}-${now.toISOString().slice(0, 16)}`;
    if (firedToday.has(dedupeKey)) continue;
    firedToday.add(dedupeKey);

    const startedAt = new Date();
    const [logRow] = await db.insert(backupJobLogsTable).values({
      jobId: job.id,
      status: "running",
      startedAt,
      notes: "Triggered by cron scheduler",
    }).returning();

    let rowCount: number | null = 0;
    let sizeBytes = 0;
    let filePath: string | null = null;
    let notes = "";
    let checksum: string | null = null;

    try {
      if (job.backupType === "DB" || job.backupType === "FULL" || job.backupType === "CONFIG") {
        // Master-data backup via pg_dump (Ticket E0.1 / CRIT-1 fix).
        //
        // Previously this ran SELECT * FROM ${table} LIMIT 5000 per table
        // with no pagination — any table over 5000 rows was silently
        // truncated, and the job was unconditionally marked "success"
        // regardless. pg_dump has no row cap, and DB/FULL omit a table
        // allowlist entirely (a full dump — no list to fall out of sync
        // with schema changes, unlike the old hardcoded table arrays, one
        // of which had already drifted and was missing patient_reports).
        // CONFIG stays scoped to a few small config tables via --table
        // filtering. exportDatabaseSql/exportDatabaseSqlFallback (see
        // backupReplication.ts) only resolve once the export is verified
        // complete — a failed or truncated pg_dump run rejects instead of
        // silently resolving, so it lands in the catch block below and is
        // correctly recorded as "failed", never "success".
        const scopedTables: Record<string, string[] | undefined> = {
          CONFIG: ["clinic_settings", "email_settings", "printer_settings", "pacs_settings"],
          DB: undefined,
          FULL: undefined,
        };
        const tableFilter = scopedTables[job.backupType];

        let dump: { filePath: string; sizeBytes: number; rowCount: number | null };
        try {
          dump = await exportDatabaseSql(tableFilter);
        } catch (pgDumpErr) {
          console.warn(`[cron] pg_dump unavailable for backup job #${job.id}, using fallback exporter:`, pgDumpErr);
          dump = await exportDatabaseSqlFallback(tableFilter);
        }

        sizeBytes = dump.sizeBytes;
        rowCount = dump.rowCount;
        const sql = require("fs").readFileSync(dump.filePath, "utf-8");

        // Ticket E0.1d — SHA-256 over the encrypted content, exactly as it
        // will be written to disk, so a later verifyBackupChecksum() call
        // against the file on disk detects any corruption of the at-rest
        // artifact (not just of the pre-encryption SQL).
        const enc = encryptBackup(sql);
        checksum = computeSha256(enc);

        // Write to disk if destinationPath provided
        if (job.destinationPath) {
          try {
            const dir = require("path").dirname(job.destinationPath);
            require("fs").mkdirSync(dir, { recursive: true });
            const dest = `${job.destinationPath}/backup_${job.jobName}_${new Date().toISOString().replace(/[:.]/g, "-")}.sql.enc`;
            require("fs").writeFileSync(dest, enc);
            filePath = dest;
            notes = `Backup saved to ${dest} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB, SHA-256: ${checksum})`;
          } catch (e: unknown) {
            notes = `In-memory backup; disk write failed: ${e instanceof Error ? e.message : String(e)}`;
          }
        } else {
          notes = `In-memory ${job.backupType} backup (${(sizeBytes / 1024 / 1024).toFixed(2)} MB, SHA-256: ${checksum})`;
        }

        // The unencrypted intermediate dump must not linger on disk.
        require("fs").unlink(dump.filePath, () => {});
      } else {
        notes = `${job.backupType} backup type not yet implemented in scheduler.`;
      }

      // Retention cleanup: purge old backups from destination path
      if (job.destinationPath && job.retentionDays && job.retentionDays > 0) {
        try {
          const fs = require("fs");
          const path = require("path");
          const files = fs.readdirSync(job.destinationPath).filter((f: string) => f.startsWith("backup_" + job.jobName));
          const cutoff = Date.now() - job.retentionDays * 24 * 60 * 60 * 1000;
          let removed = 0;
          for (const f of files) {
            const stat = fs.statSync(path.join(job.destinationPath, f));
            if (stat.mtimeMs < cutoff) {
              fs.unlinkSync(path.join(job.destinationPath, f));
              removed++;
            }
          }
          if (removed > 0) notes += `; Purged ${removed} old backup(s)`;
        } catch { /* ignore cleanup errors */ }
      }

      await db.update(backupJobLogsTable).set({
        status: "success",
        completedAt: new Date(),
        rowCount,
        sizeBytes,
        filePath,
        notes,
        encrypted: true,
        checksum,
      }).where(eq(backupJobLogsTable.id, logRow?.id ?? 0));

      await db.update(backupJobsTable).set({
        lastRunAt: startedAt,
        lastStatus: "success",
        lastError: null,
      }).where(eq(backupJobsTable.id, job.id));

      console.log(`[cron] Backup job #${job.id} (${job.jobName}) completed: ${notes}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await db.update(backupJobLogsTable).set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: msg,
        notes: notes || msg,
        encrypted: true,
      }).where(eq(backupJobLogsTable.id, logRow?.id ?? 0));

      await db.update(backupJobsTable).set({
        lastRunAt: startedAt,
        lastStatus: "failed",
        lastError: msg,
      }).where(eq(backupJobsTable.id, job.id));

      console.error(`[cron] Backup job #${job.id} (${job.jobName}) failed: ${msg}`);
      await sendBackupFailureEmail({
        jobName: job.jobName,
        errorMessage: msg,
        backupType: job.backupType,
        completedAt: new Date(),
      });
    }
  }
}

// ── Session idle sweep ──────────────────────────────────────────────────────────────────────────────
// Every 5 minutes: delete staff sessions whose last_activity_at is older than
// the configured idle timeout. Patient sessions are also swept but only with
// a generous 24-hour blanket timeout (they don't have last_activity_at tracking).
function scheduleSessionIdleSweep() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const { portalSessionsTable, clinicSettingsTable } = await import("@workspace/db/schema");
      const { sql } = await import("drizzle-orm");
      const [cfg] = await db.select({ idleMinutes: clinicSettingsTable.sessionIdleTimeoutMinutes }).from(clinicSettingsTable).limit(1);
      const idleMinutes = cfg?.idleMinutes ?? 30;
      if (idleMinutes <= 0) return;

      const result = await db.delete(portalSessionsTable).where(
        and(
          eq(portalSessionsTable.scope, "staff"),
          sql`${portalSessionsTable.lastActivityAt} < NOW() - INTERVAL '${idleMinutes} minutes'`,
        ),
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[cron] Session sweep: invalidated ${result.rowCount} idle staff session(s)`);
      }
    } catch (err) {
      console.error("[cron] Session idle sweep failed:", err);
    }
  });
  console.log("[cron] Session idle sweep started (runs every 5 minutes)");
}

// ── Audit Log Retention & Archival ────────────────────────────────────────────────────────────
// Daily at 03:00: purge audit logs older than 2 years (730 days). Before
// deleting, archive them to a compressed JSON file with SHA-256 checksum so
// tampering is detectable.  Only the most recent 730 days are kept in the
// primary table for fast queries; older records are in cold storage files.
function scheduleAuditLogPurge() {
  cron.schedule("0 3 * * *", async () => {
    try {
      const { auditLogsTable } = await import("@workspace/db/schema");
      const { sql, lte } = await import("drizzle-orm");
      const fs = require("fs");
      const path = require("path");
      const crypto = require("crypto");
      const zlib = require("zlib");

      const RETENTION_DAYS = 730; // 2 years
      const archiveDir = path.join(process.cwd(), "data", "archives", "audit-logs");
      fs.mkdirSync(archiveDir, { recursive: true });

      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const oldLogs = await db
        .select()
        .from(auditLogsTable)
        .where(lte(auditLogsTable.createdAt, cutoff))
        .limit(5000);

      if (oldLogs.length === 0) return;

      const archiveName = `audit_archive_${cutoff.toISOString().slice(0, 10)}_${Date.now()}.json.gz`;
      const archivePath = path.join(archiveDir, archiveName);

      const payload = JSON.stringify({
        archivedAt: new Date().toISOString(),
        retentionDays: RETENTION_DAYS,
        count: oldLogs.length,
        logs: oldLogs,
      });
      const compressed = zlib.gzipSync(payload);
      fs.writeFileSync(archivePath, compressed);

      const checksum = crypto.createHash("sha256").update(compressed).digest("hex");
      fs.writeFileSync(`${archivePath}.sha256`, checksum);

      // Now delete the archived rows
      await db.delete(auditLogsTable).where(lte(auditLogsTable.createdAt, cutoff));

      console.log(`[cron] Audit log archive: ${oldLogs.length} rows archived to ${archiveName} (${compressed.length} bytes, SHA-256 ${checksum.slice(0, 16)}...)`);
    } catch (err) {
      console.error("[cron] Audit log purge/archive failed:", err);
    }
  });
  console.log("[cron] Audit log retention purge started (runs daily at 03:00, keeps 2 years)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Money-Trail Audit auto-run
// Fires at 06:00 on the 1st of every month. Snapshots the previous calendar
// month's Books-Sanity report into audit_runs (source="cron", completedAt=null
// so it shows as "auto-run, awaiting review"), then emails the headline +
// anomaly summary to the configured admin email.
// ─────────────────────────────────────────────────────────────────────────────

function scheduleMonthlyAudit() {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      if (now.getDate() !== 1) return;
      if (now.getHours() !== 6 || now.getMinutes() !== 0) return;

      const key = `monthly-audit-${now.toISOString().slice(0, 10)}`;
      if (firedToday.has(key)) return;
      firedToday.add(key);

      await fireMonthlyAudit(now);
    } catch (err) {
      console.error("[cron] monthly audit check failed:", err);
    }
  });

  console.log("[cron] Monthly money-trail audit scheduler started (fires at 06:00 on day 1 of each month)");
}

function pad2(n: number) { return String(n).padStart(2, "0"); }

export async function fireMonthlyAudit(now: Date): Promise<void> {
  // Previous calendar month: from = first day of prev month, to = last day of prev month
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);  // day 0 of this month = last of prev
  const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);
  const from = `${prevMonthStart.getFullYear()}-${pad2(prevMonthStart.getMonth() + 1)}-${pad2(prevMonthStart.getDate())}`;
  const to = `${prevMonthEnd.getFullYear()}-${pad2(prevMonthEnd.getMonth() + 1)}-${pad2(prevMonthEnd.getDate())}`;

  console.log(`[cron] Running monthly money-trail audit for ${from} → ${to}`);

  // Restart-safe dedupe: if a cron-source audit already exists for this exact
  // period (e.g. process restarted between 06:00 and the next-month boundary),
  // skip the run rather than inserting a duplicate.
  const existing = await db.select({ id: auditRunsTable.id }).from(auditRunsTable)
    .where(and(eq(auditRunsTable.source, "cron"), eq(auditRunsTable.periodFrom, from), eq(auditRunsTable.periodTo, to)))
    .limit(1);
  if (existing.length > 0) {
    console.log(`[cron] Monthly audit for ${from} → ${to} already exists (#${existing[0].id}); skipping.`);
    return;
  }

  const report = await runBooksSanity({ from, to });
  const anomalyCount = report.anomalies.reduce((s, a) => s + a.count, 0);
  const highCount = report.anomalies.filter((a) => a.severity === "high").reduce((s, a) => s + a.count, 0);
  const totalImpact = report.anomalies.reduce((s, a) => s + (a.totalAmount || 0), 0);

  let inserted: typeof auditRunsTable.$inferSelect;
  try {
    [inserted] = await db.insert(auditRunsTable).values({
      periodFrom: from,
      periodTo: to,
      completedAt: null,
      completedBy: null,
      source: "cron",
      notes: null,
      anomalyCount,
      highCount,
      totalImpact: String(totalImpact),
      snapshot: report,
    }).returning();
  } catch (err) {
    // Unique-index violation: another worker beat us to the insert. Treat
    // as a no-op so cron retries don't crash the loop.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("audit_runs_cron_unique_idx") || msg.includes("duplicate key")) {
      console.log(`[cron] Monthly audit for ${from} → ${to} was inserted concurrently; skipping.`);
      return;
    }
    throw err;
  }

  // Best-effort email — never fails the audit save
  try {
    const result = await sendMonthlyAuditEmail({
      auditId: inserted.id,
      periodFrom: from,
      periodTo: to,
      anomalyCount,
      highCount,
      totalImpact,
      report,
    });
    if (result.ok) {
      await db.update(auditRunsTable).set({ emailSentAt: new Date() }).where(eq(auditRunsTable.id, inserted.id));
      console.log(`[cron] Monthly audit #${inserted.id} emailed`);
    } else {
      console.warn(`[cron] Monthly audit #${inserted.id} saved but email failed: ${result.error}`);
    }
  } catch (err) {
    console.error("[cron] monthly audit email send threw:", err);
  }
}

// ── DICOM Auto-Pull scheduler ────────────────────────────────────────────────
// Every 5 minutes: find all active nodes with autoPull=true whose last pull
// is older than their configured pullIntervalSeconds (or never pulled), and
// create a new dicom_pull_job for each. The local DICOM Pull Agent picks these
// jobs up and executes the actual findscu + movescu commands.

function scheduleDicomAutoPull() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      await fireDicomAutoPull();
    } catch (err) {
      console.error("[cron] DICOM auto-pull check failed:", err);
    }
  });
  console.log("[cron] DICOM auto-pull scheduler started (checks every 5 minutes)");
}

async function fireDicomAutoPull() {
  const now = new Date();

  // Fetch all active nodes with autoPull enabled
  const nodes = await db.select().from(dicomNodesTable)
    .where(and(eq(dicomNodesTable.isActive, true), eq(dicomNodesTable.autoPull, true)));

  if (nodes.length === 0) return;

  for (const node of nodes) {
    const intervalMs = (node.pullIntervalSeconds ?? 300) * 1000;
    const lastPull   = node.lastPullAt ? new Date(node.lastPullAt).getTime() : 0;
    const dueAt      = lastPull + intervalMs;

    if (now.getTime() < dueAt) continue; // not yet due

    // Check if there's already a pending or running job for this node
    const [existing] = await db.select({ id: dicomPullJobsTable.id })
      .from(dicomPullJobsTable)
      .where(
        and(
          eq(dicomPullJobsTable.nodeId, node.id),
          or(
            eq(dicomPullJobsTable.status, "pending"),
            eq(dicomPullJobsTable.status, "running"),
          ),
        ),
      )
      .limit(1);

    if (existing) continue; // already queued

    // Calculate date range
    const todayStr = now.toISOString().split("T")[0];
    const hoursBack = node.queryLookbackHours ?? 24;
    const daysBack = Math.max(1, Math.ceil(hoursBack / 24));
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - (daysBack - 1));
    fromDate.setHours(0, 0, 0, 0);
    const fromStr = fromDate.toISOString().split("T")[0];

    await db.insert(dicomPullJobsTable).values({
      nodeId:       node.id,
      triggerType:  "auto",
      status:       "pending",
      queryDateFrom: fromStr,
      queryDateTo:   todayStr,
    });

    console.log(`[cron] Created auto pull job for DICOM node ${node.aeTitle} (${node.modality})`);
  }
}

function scheduleDaily() {
  cron.schedule("* * * * *", async () => {
    try {
      const [settings] = await db.select().from(emailSettingsTable).limit(1);
      if (!settings || !settings.dailySummaryEnabled) return;

      const now = new Date();
      const [hour, minute] = settings.dailySummaryTime.split(":").map(Number);
      const key = `daily-${now.toISOString().split("T")[0]}`;

      if (now.getHours() === hour && now.getMinutes() === minute && !firedToday.has(key)) {
        firedToday.add(key);
        await fireDailySummary();
      }
    } catch (err) {
      console.error("[cron] daily summary check failed:", err);
    }
  });

  console.log("[cron] Daily summary scheduler started (checks every minute)");
}

// ── WhatsApp reminder scheduler ───────────────────────────────────────────────
// Every minute, checks whatsapp_settings for the configured appointment- and
// dues-reminder times and fires each at most once per day. Both are off by
// default; the run functions themselves re-check the enabled flags, so a
// setting flipped off mid-day never sends. Times use the same server-local
// clock convention as the daily-summary scheduler above.
function scheduleWhatsappReminders() {
  cron.schedule("* * * * *", async () => {
    try {
      const [settings] = await db.select().from(whatsappSettingsTable).limit(1);
      if (!settings || !settings.enabled) return;

      const now = new Date();
      const dateKey = now.toISOString().split("T")[0];

      if (settings.appointmentReminderEnabled && settings.appointmentReminderTime) {
        const [h, m] = settings.appointmentReminderTime.split(":").map(Number);
        const key = `wa-appt-${dateKey}`;
        if (now.getHours() === h && now.getMinutes() === m && !firedToday.has(key)) {
          firedToday.add(key);
          const { runAppointmentReminders } = await import("./routes/whatsapp");
          const r = await runAppointmentReminders();
          console.log(`[cron] WhatsApp appointment reminders: sent=${r.sent} failed=${r.failed} total=${r.total}${r.skipped ? ` (skipped: ${r.reason})` : ""}`);
        }
      }

      if (settings.duesReminderEnabled && settings.duesReminderTime) {
        const [h, m] = settings.duesReminderTime.split(":").map(Number);
        const key = `wa-dues-${dateKey}`;
        if (now.getHours() === h && now.getMinutes() === m && !firedToday.has(key)) {
          firedToday.add(key);
          const { runDuesReminders } = await import("./routes/whatsapp");
          const r = await runDuesReminders();
          console.log(`[cron] WhatsApp dues reminders: sent=${r.sent} failed=${r.failed} total=${r.total}${r.skipped ? ` (skipped: ${r.reason})` : ""}`);
        }
      }
    } catch (err) {
      console.error("[cron] WhatsApp reminder check failed:", err);
    }
  });

  console.log("[cron] WhatsApp reminder scheduler started (checks every minute)");
}

// Manual triggers used by the internal-cron endpoints (and callable in tests).
export async function runWhatsappAppointmentReminders() {
  const { runAppointmentReminders } = await import("./routes/whatsapp");
  return runAppointmentReminders();
}

export async function runWhatsappDuesReminders() {
  const { runDuesReminders } = await import("./routes/whatsapp");
  return runDuesReminders();
}

function scheduleMonthEndCommission() {
  // Check every minute — fires at 20:00 on the last day of each month
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();

      // 20:00 exactly
      if (hour !== 20 || minute !== 0) return;

      // Check if today is the last day of the month
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (tomorrow.getMonth() === now.getMonth()) return; // not last day

      const key = `commission-${now.toISOString().split("T")[0]}`;
      if (firedToday.has(key)) return;
      firedToday.add(key);

      await fireMonthEndCommission(now);
    } catch (err) {
      console.error("[cron] month-end commission check failed:", err);
    }
  });

  console.log("[cron] Month-end commission scheduler started (fires at 20:00 on last day of month)");
}

export async function runDailySummary() {
  return fireDailySummary();
}

export async function runMonthEndCommission(now: Date = new Date()) {
  return fireMonthEndCommission(now);
}

async function fireDailySummary() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [bills, payments, audits] = await Promise.all([
      db.select().from(billsTable).where(
        and(gte(billsTable.createdAt, todayStart), lte(billsTable.createdAt, todayEnd))
      ),
      db.select().from(paymentsTable).where(
        and(gte(paymentsTable.createdAt, todayStart), lte(paymentsTable.createdAt, todayEnd))
      ),
      db.select().from(billAuditsTable).where(
        and(gte(billAuditsTable.createdAt, todayStart), lte(billAuditsTable.createdAt, todayEnd))
      ),
    ]);

    const totalRevenue = payments.reduce((s, p) => s + Number(p.amount), 0);
    const totalBills = bills.length;
    const paidBills = bills.filter(b => b.status === "paid").length;
    const pendingBills = bills.filter(b => b.status === "pending" || b.status === "partial").length;
    const totalPayments = payments.reduce((s, p) => s + Number(p.amount), 0);
    const billsEdited = new Set(audits.map(a => a.billId)).size;

    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    await sendDailySummaryEmail({
      date: today,
      totalRevenue,
      totalBills,
      paidBills,
      pendingBills,
      totalPayments,
      billsEdited,
    });

    console.log(`[cron] Daily summary sent for ${today}`);
  } catch (err) {
    console.error("[cron] Failed to send daily summary:", err);
  }
}

async function fireMonthEndCommission(now: Date) {
  try {
    // Month boundaries
    const fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const toDate   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const fromStr  = fromDate.toISOString().split("T")[0];
    const toStr    = toDate.toISOString().split("T")[0];
    const month    = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    // Fetch all doctors, rules, tests
    const doctors  = await db.select().from(doctorsTable);
    const allRules = await db.select().from(commissionRulesTable);
    const allTests = await db.select().from(testsTable);
    const testMap  = new Map(allTests.map(t => [t.id, t]));

    // Fetch orders for the month
    const orders = await db.select().from(ordersTable)
      .where(and(gte(ordersTable.createdAt, fromDate), lte(ordersTable.createdAt, toDate)));

    const orderIds = orders.map(o => o.id);
    const orderTests = orderIds.length
      ? await db.select().from(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds))
      : [];

    const report = doctors.map(doctor => {
      const doctorOrders = orders.filter(o => o.doctorId === doctor.id);
      const rules = allRules.filter(r => r.doctorId === doctor.id && r.isActive);

      let totalRevenue = 0, totalCommission = 0, testCount = 0;
      for (const order of doctorOrders) {
        const ots = orderTests.filter(ot => ot.orderId === order.id);
        for (const ot of ots) {
          const test = testMap.get(ot.testId);
          const price = Number(ot.price);
          totalRevenue += price;
          testCount++;

          // Apply rules (same logic as commission route)
          let matched = rules.find(r => {
            if (!r.isExclusive) return false;
            if (r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(ot.testId);
            if (r.scope === "category" && r.categories && test) return (JSON.parse(r.categories) as string[]).includes(test.category || "");
            return false;
          });
          if (!matched) matched = rules.find(r => {
            if (r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(ot.testId);
            if (r.scope === "category" && r.categories && test) return (JSON.parse(r.categories) as string[]).includes(test.category || "");
            return r.scope === "all";
          });
          if (matched) {
            const val = Number(matched.value);
            totalCommission += matched.type === "percentage" ? (price * val) / 100 : val;
          } else {
            const defVal = Number(doctor.defaultCommission);
            if (defVal > 0) totalCommission += doctor.defaultCommissionType === "percentage" ? (price * defVal) / 100 : defVal;
          }
        }
      }

      return {
        doctor: { name: doctor.name, specialization: doctor.specialization ?? "" },
        orderCount: doctorOrders.length,
        testCount,
        totalRevenue,
        totalCommission,
        effectiveRate: totalRevenue > 0 ? Number(((totalCommission / totalRevenue) * 100).toFixed(2)) : 0,
      };
    }).filter(r => r.orderCount > 0);

    const grandTotal = {
      doctors: report.length,
      orders: report.reduce((s, r) => s + r.orderCount, 0),
      revenue: report.reduce((s, r) => s + r.totalRevenue, 0),
      commission: report.reduce((s, r) => s + r.totalCommission, 0),
    };

    await sendCommissionMonthEndEmail({ month, from: fromStr, to: toStr, report, grandTotal });
    console.log(`[cron] Month-end commission email sent for ${month}`);
  } catch (err) {
    console.error("[cron] Failed to send month-end commission email:", err);
  }
}

// ── Banking Auto-Sync (every 5 minutes) ──────────────────────────────────────────────────────────────

function scheduleBankingAutoSync() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      await fireBankingAutoSync();
    } catch (err) {
      console.error("[cron] Banking auto-sync failed:", err);
    }
  });
  console.log("[cron] Banking auto-sync scheduler started (runs every 5 minutes)");
}

export async function fireBankingAutoSync() {
  const { db } = await import("@workspace/db");
  const { bankAccountsTable, bankTransactionsTable } = await import("@workspace/db/schema");
  const { eq, and, gte } = await import("drizzle-orm");
  const { createProvider } = await import("./services/banking/BankProviderFactory");
  const { batchReconcile } = await import("./services/banking/ReconciliationEngine");

  const accounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.status, "active"));
  if (accounts.length === 0) return;

  let imported = 0;
  for (const account of accounts) {
    try {
      const config = (account.providerConfig as Record<string, unknown> | null) ?? undefined;
      const provider = await createProvider(account.provider, config);
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000); // last 48 hours
      const txs = await provider.getTransactions(account.maskedAccountNumber, { fromDate: since, limit: 200 });
      const values = txs.map((t) => ({
        bankAccountId: account.id,
        provider: account.provider,
        externalTransactionId: t.externalTransactionId,
        transactionDate: t.transactionDate,
        description: t.description,
        amount: String(t.amount),
        type: t.type,
        balanceAfter: t.balanceAfter !== undefined ? String(t.balanceAfter) : null,
        utr: t.utr ?? null,
        referenceNumber: t.referenceNumber ?? null,
        rawPayload: t.rawPayload ?? null,
        reconciliationStatus: "unreconciled" as const,
      }));
      if (values.length > 0) {
        await db.insert(bankTransactionsTable).values(values).onConflictDoNothing();
        imported += values.length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron] Auto-sync failed for ${account.provider} account #${account.id}:`, msg);
    }
  }

  if (imported > 0) {
    console.log(`[cron] Banking auto-sync imported ${imported} transactions`);
    // Run batch reconciliation on new transactions
    try {
      const result = await batchReconcile({ autoCloseThreshold: 80, performedBy: "cron" });
      console.log(`[cron] Auto-reconciliation: ${result.matched} matched, ${result.autoClosed} auto-closed, ${result.failed} failed`);
    } catch (err) {
      console.error("[cron] Auto-reconciliation failed:", err);
    }
  }
}

// ── Fraud Detection (every 30 minutes) ─────────────────────────────────────────────────────────────

function scheduleFraudDetection() {
  cron.schedule("*/30 * * * *", async () => {
    try {
      const { runFraudDetection } = await import("./services/banking/FraudDetectionEngine");
      const result = await runFraudDetection();
      if (result.totalAlerts > 0) {
        console.log(`[cron] Fraud detection: ${result.totalAlerts} alerts raised`);
      }
    } catch (err) {
      console.error("[cron] Fraud detection failed:", err);
    }
  });
  console.log("[cron] Fraud detection scheduler started (runs every 30 minutes)");
}

// ── PACS Puller Stall Watchdog ────────────────────────────────────────────────
// Every 10 minutes: check if the DICOM pull agent has not heartbeated recently.
// If the last heartbeat is older than STALL_THRESHOLD_MINUTES, mark it as stalled
// and send an alert email so the radiologist isn't waiting on scans that aren't
// arriving. This catches network hiccups, Orthanc restarts, and silent agent hangs.
//
// The watchdog does NOT force-restart the agent (that would require a Docker
// restart which could lose in-flight DIMSE transfers). Instead it:
//   1. Updates watchdog_status.status = 'degraded'
//   2. Sends a one-off alert email (max one per stall period)
//   3. Logs clearly so monitoring dashboards pick it up

const STALL_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
const STALL_SERVICE_NAME  = "dicom_pull_agent";

function schedulePacsPullerWatchdog() {
  cron.schedule("*/10 * * * *", async () => {
    try {
      await checkPacsPullerStall();
    } catch (err) {
      console.error("[cron] PACS puller watchdog failed:", err);
    }
  });
  console.log("[cron] PACS puller stall watchdog started (checks every 10 minutes)");
}

async function checkPacsPullerStall() {
  // Only run if PACS/DICOM is configured
  if (!process.env["ORTHANC_URL"]) return;

  const [row] = await db
    .select()
    .from(watchdogStatusTable)
    .where(eq(watchdogStatusTable.serviceName, STALL_SERVICE_NAME))
    .limit(1);

  if (!row) return; // Not registered yet — agent hasn't started
  if (!row.lastHeartbeat) return; // Never started — not a stall

  const ageMs = Date.now() - row.lastHeartbeat.getTime();
  if (ageMs <= STALL_THRESHOLD_MS) return; // Healthy

  // Already marked degraded by a previous watchdog run — don't spam emails
  if (row.status === "degraded") return;

  // Mark as stalled in watchdog table
  await db
    .update(watchdogStatusTable)
    .set({
      status:    "degraded",
      lastError: `No heartbeat for ${Math.round(ageMs / 60000)} minutes (threshold: 20 min)`,
      updatedAt: new Date(),
    })
    .where(eq(watchdogStatusTable.id, row.id))
    .catch(() => {});

  const stalledMinutes = Math.round(ageMs / 60000);
  console.warn(
    `[watchdog] PACS pull agent stalled — last heartbeat ${stalledMinutes} minutes ago`,
  );

  // Send one alert email (uses the existing email module — best-effort)
  try {
    const { sendAlertEmail } = await import("./email");
    await sendAlertEmail({
      subject: `⚠️ PACS Pull Agent Stalled — ${stalledMinutes} minutes without activity`,
      html: [
        `<p><strong>Care Diagnostics — Automated Alert</strong></p>`,
        `<p>The DICOM pull agent has not sent a heartbeat for <strong>${stalledMinutes} minutes</strong>.</p>`,
        `<p>New studies from modalities may not be appearing in the worklist.</p>`,
        `<p><strong>Action required:</strong></p>`,
        `<ul>`,
        `  <li>Check the Radiology Operations Dashboard for current Orthanc status.</li>`,
        `  <li>Verify Orthanc is running and accessible: ${process.env["ORTHANC_URL"] || "check ORTHANC_URL env"}</li>`,
        `  <li>Check the care-api container logs: <code>docker logs care-api --tail 100</code></li>`,
        `  <li>If needed, restart the ERP stack to restart the pull agent.</li>`,
        `</ul>`,
        `<p style="color:#888;font-size:12px">This alert was generated by the automated PACS watchdog. It fires once per stall period and will not repeat until the agent recovers and stalls again.</p>`,
      ].join(""),
    });
  } catch {
    // Email failure is non-fatal — the DB record update above is the primary signal
  }
}
