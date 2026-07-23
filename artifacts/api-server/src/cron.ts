import cron from "node-cron";
import { db } from "@workspace/db";
import {
  emailSettingsTable, billsTable, billAuditsTable, paymentsTable,
  doctorsTable, commissionRulesTable, orderTestsTable, ordersTable, testsTable,
  dicomNodesTable, dicomPullJobsTable, whatsappSettingsTable,
  expensesTable, patientsTable,
} from "@workspace/db/schema";
import { sendDailySummaryEmail, sendCommissionMonthEndEmail, sendMonthlyAuditEmail } from "./email";
import { runBooksSanity } from "./routes/books-sanity";
import { exportDatabaseSql, exportDatabaseSqlFallback, computeSha256 } from "./routes/backupReplication";
import { auditRunsTable, watchdogStatusTable } from "@workspace/db/schema";
import { gte, and, lte, eq, inArray, isNull, or, lt, sql, ne } from "drizzle-orm";
import { encryptBackup } from "@workspace/crypto";
import {
  startDimsePullAgent,
  stopDimsePullAgent,
  isDimsePullAgentRunning,
} from "./services/dicom-pull-agent/dimse-agent";
import { runRadiologyJobTick } from "./lib/radiologyJobs";
import { RADIOLOGY_JOB_HANDLERS } from "./lib/radiologyJobHandlers";
import { runScheduledAuditChainVerification } from "./lib/auditVerification";
import { todayIST, istHourMinute } from "./lib/istDate";
import { classifyPaymentMethod, isDigitalSettlement, isPhysicalCash } from "./lib/paymentMethodClassifier";

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
  scheduleRecall();
  scheduleFeedbackInvites();
  scheduleOpsAnomalyScan();
  scheduleRadiologyJobs();
  scheduleAuditChainVerify();
  scheduleAiSchedulerModes();
  scheduleQueueDisplayAlerts();

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

// ── Phase P3: AI Scheduler modes (Night Batch / Reprocessing / Learning) ─────
// Each handler is internally gated by the ff_radiology_ai master flag, so these
// crons are a hard no-op until an admin enables AI. They only ENQUEUE onto the
// existing radiology job engine — no new worker or queue is created here.
function scheduleAiSchedulerModes() {
  // Night Batch — every 30 min; runNightBatch itself checks the night window is
  // configured via the scheduler config and skips finalized/unchanged studies.
  cron.schedule("*/30 23,0,1,2,3,4,5 * * *", async () => {
    try {
      const { runNightBatch } = await import("./lib/ai/schedulerService");
      const r = await runNightBatch();
      if (r.enqueued > 0) console.log(`[cron] AI night batch: enqueued ${r.enqueued}/${r.considered}`);
    } catch (err) {
      console.error("[cron] AI night batch failed:", err);
    }
  });
  // Scheduled Reprocessing — weekly, Sunday 02:00.
  cron.schedule("0 2 * * 0", async () => {
    try {
      const { runScheduledReprocessing } = await import("./lib/ai/schedulerService");
      const r = await runScheduledReprocessing();
      if (r.enqueued > 0) console.log(`[cron] AI reprocessing: enqueued ${r.enqueued}/${r.considered}`);
    } catch (err) {
      console.error("[cron] AI reprocessing failed:", err);
    }
  });
  // Learning aggregation — weekly, Sunday 03:00 (no auto-retrain; summary only).
  cron.schedule("0 3 * * 0", async () => {
    try {
      const { runLearningAggregation } = await import("./lib/ai/schedulerService");
      const summary = await runLearningAggregation();
      console.log(`[cron] AI learning aggregation:`, summary);
    } catch (err) {
      console.error("[cron] AI learning aggregation failed:", err);
    }
  });
  console.log("[cron] AI scheduler modes registered (gated by ff_radiology_ai)");
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
      const { lte, inArray, asc } = await import("drizzle-orm");
      const fs = require("fs");
      const path = require("path");
      const crypto = require("crypto");
      const zlib = require("zlib");

      const RETENTION_DAYS = 730; // 2 years kept hot; older records live in cold archive files
      const BATCH = 5000;
      const archiveDir = path.join(process.cwd(), "data", "archives", "audit-logs");
      fs.mkdirSync(archiveDir, { recursive: true });

      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

      // Gate G2 — archive-before-purge, with NO unarchived deletes.
      // Prior bug: archived at most 5,000 rows but then deleted EVERY row <= cutoff,
      // silently destroying the unarchived remainder on any backlog > 5,000.
      // Now we page through the backlog and delete ONLY the exact ids we have
      // durably written to a checksummed archive file in this iteration.
      let totalArchived = 0;
      for (;;) {
        const batch = await db
          .select()
          .from(auditLogsTable)
          .where(lte(auditLogsTable.createdAt, cutoff))
          .orderBy(asc(auditLogsTable.id))
          .limit(BATCH);
        if (batch.length === 0) break;

        const archiveName = `audit_archive_${cutoff.toISOString().slice(0, 10)}_${Date.now()}_${totalArchived}.json.gz`;
        const archivePath = path.join(archiveDir, archiveName);
        const payload = JSON.stringify({
          archivedAt: new Date().toISOString(),
          retentionDays: RETENTION_DAYS,
          count: batch.length,
          logs: batch,
        });
        const compressed = zlib.gzipSync(payload);
        // Write the archive + its checksum BEFORE deleting anything.
        fs.writeFileSync(archivePath, compressed);
        const checksum = crypto.createHash("sha256").update(compressed).digest("hex");
        fs.writeFileSync(`${archivePath}.sha256`, checksum);

        const ids = batch.map((r: { id: number }) => r.id);
        await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, ids));
        totalArchived += batch.length;
        console.log(`[cron] Audit log archive batch: ${batch.length} rows → ${archiveName} (SHA-256 ${checksum.slice(0, 16)}...)`);
        if (batch.length < BATCH) break;
      }

      if (totalArchived === 0) return;
      console.log(`[cron] Audit log retention complete: ${totalArchived} rows archived + purged (archive-before-purge, no unarchived deletes).`);
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

// Catch-up safe: fires as soon as each configured slot's time has passed on
// any day the container happens to be up, as long as today (IST) isn't
// already the persisted slot's last-sent date. Unlike the old exact-minute-
// match + in-memory Set approach, a redeploy/crash during the configured
// minute no longer permanently skips that slot's email — the very next tick
// after restart catches up. dailySummaryLastSentSlots is only stamped by a
// successful SCHEDULED send (inside fireDailySummary), never by the manual
// "Send Summary Now" button, so a manual test-send never blocks the real
// scheduled sends later that day.
//
// Up to 3 times/day are supported via dailySummaryTimes (a JSON array of
// "HH:MM" strings). Times are compared in IST — the same timezone the rest
// of the ERP's "today" logic uses (see istDate.ts) — rather than the
// server process's own local time (which defaults to UTC in this
// container), since comparing in server-local time was the reason the
// scheduled send silently fired 5.5 hours off from what admins configured.
function scheduleDaily() {
  cron.schedule("* * * * *", async () => {
    try {
      const [settings] = await db.select().from(emailSettingsTable).limit(1);
      if (!settings || !settings.dailySummaryEnabled) return;

      let times: string[] = [];
      try {
        const parsed = JSON.parse(settings.dailySummaryTimes || "[]");
        if (Array.isArray(parsed)) times = parsed.filter((t): t is string => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t));
      } catch { /* malformed — treat as no configured times */ }
      if (times.length === 0) return;

      let lastSentSlots: Record<string, string> = {};
      try {
        const parsed = JSON.parse(settings.dailySummaryLastSentSlots || "{}");
        if (parsed && typeof parsed === "object") lastSentSlots = parsed;
      } catch { /* malformed — treat as never sent */ }

      const now = new Date();
      const todayStr = todayIST(now);
      const { hour: nowHour, minute: nowMinute } = istHourMinute(now);

      for (const time of times) {
        const [hour, minute] = time.split(":").map(Number);
        const scheduledTimePassed =
          nowHour > hour || (nowHour === hour && nowMinute >= minute);

        if (scheduledTimePassed && lastSentSlots[time] !== todayStr) {
          await fireDailySummary({ scheduled: true, slot: time });
        }
      }
    } catch (err) {
      console.error("[cron] daily summary check failed:", err);
    }
  });

  console.log("[cron] Daily summary scheduler started (checks every minute, catch-up safe, IST-based, up to 3 sends/day)");
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

      // Report-delivery unread reminders — reminds ONLY reports staff explicitly
      // sent (not a bulk scan) that remain unread after 24h, capped at one. Fixed
      // daily pass at 12:00 server time; the worker no-ops unless
      // ff_report_delivery_receipts is enabled.
      {
        const key = `wa-report-delivery-${dateKey}`;
        if (now.getHours() === 12 && now.getMinutes() === 0 && !firedToday.has(key)) {
          firedToday.add(key);
          const { runReportDeliveryReminders } = await import("./routes/reportDeliveryTracking");
          const r = await runReportDeliveryReminders();
          console.log(`[cron] WhatsApp report-delivery reminders: sent=${r.sent} failed=${r.failed} total=${r.total}${r.skipped ? ` (skipped: ${r.reason})` : ""}`);
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

export async function runWhatsappReportDeliveryReminders() {
  const { runReportDeliveryReminders } = await import("./routes/reportDeliveryTracking");
  return runReportDeliveryReminders();
}

// Recall / follow-up engine — once daily at 10:00 server time: derive due
// recalls from recently-delivered reports, then WhatsApp the due ones. Both
// steps no-op unless ff_recall_engine is enabled. Idempotent generation.
function scheduleRecall() {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const dateKey = now.toISOString().split("T")[0];
      const key = `recall-${dateKey}`;
      if (now.getHours() === 10 && now.getMinutes() === 0 && !firedToday.has(key)) {
        firedToday.add(key);
        const { runRecallGeneration, runRecallSends } = await import("./routes/recall");
        const gen = await runRecallGeneration();
        const sent = await runRecallSends();
        console.log(`[cron] Recall: queued=${gen.queued} scanned=${gen.scanned} sent=${sent.sent} failed=${sent.failed}${sent.skipped ? ` (skipped: ${sent.reason})` : ""}`);
      }
    } catch (err) {
      console.error("[cron] Recall check failed:", err);
    }
  });
  console.log("[cron] Recall scheduler started (checks every minute)");
}

export async function runRecallNow() {
  const { runRecallGeneration, runRecallSends } = await import("./routes/recall");
  const generated = await runRecallGeneration();
  const sent = await runRecallSends();
  return { generated, sent };
}

// Post-report feedback / NPS invites — once daily at 10:30 server time. Mints
// tokenized links for recently-delivered reports and WhatsApps them. No-ops
// unless ff_feedback_nps is enabled. Idempotent (unique report_id).
function scheduleFeedbackInvites() {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const dateKey = now.toISOString().split("T")[0];
      const key = `feedback-${dateKey}`;
      if (now.getHours() === 10 && now.getMinutes() === 30 && !firedToday.has(key)) {
        firedToday.add(key);
        const { runFeedbackInvites } = await import("./routes/feedback");
        const r = await runFeedbackInvites();
        console.log(`[cron] Feedback invites: created=${r.created} sent=${r.sent} failed=${r.failed}${r.skipped ? ` (skipped: ${r.reason})` : ""}`);
      }
    } catch (err) {
      console.error("[cron] Feedback invite check failed:", err);
    }
  });
  console.log("[cron] Feedback invite scheduler started (checks every minute)");
}

export async function runFeedbackInvitesNow() {
  const { runFeedbackInvites } = await import("./routes/feedback");
  return runFeedbackInvites();
}

// Operational-health anomaly scan — every 30 minutes. Evaluates live metrics
// against thresholds and raises anomaly_alerts (deduped) + notifies admins.
// No-ops unless ff_ops_cockpit is enabled.
function scheduleOpsAnomalyScan() {
  cron.schedule("*/30 * * * *", async () => {
    try {
      const { runOpsAnomalyScan } = await import("./routes/opsCockpit");
      const r = await runOpsAnomalyScan();
      if (!r.skipped && (r.created > 0 || r.scanned > 0)) {
        console.log(`[cron] Ops anomaly scan: scanned=${r.scanned} created=${r.created} deduped=${r.deduped}`);
      }
    } catch (err) {
      console.error("[cron] Ops anomaly scan failed:", err);
    }
  });
  console.log("[cron] Ops anomaly scanner started (every 30 min)");
}

export async function runOpsAnomalyScanNow() {
  const { runOpsAnomalyScan } = await import("./routes/opsCockpit");
  return runOpsAnomalyScan();
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

// force=true bypasses the dailySummaryEnabled toggle, used by the manual
// "Send Summary Now" admin button — it never stamps dailySummaryLastSentSlots
// (scheduled stays false), so a manual preview never blocks the real
// scheduled send later that day.
export async function runDailySummary(force = false) {
  return fireDailySummary({ scheduled: false, force });
}

export async function runMonthEndCommission(now: Date = new Date()) {
  return fireMonthEndCommission(now);
}

async function fireDailySummary(opts: { scheduled: boolean; force?: boolean; slot?: string }) {
  try {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const inToday = (col: any) => and(gte(col, todayStart), lte(col, todayEnd));

    const [bills, payments, audits, expenses, newPatients, orderTestRows] = await Promise.all([
      db.select().from(billsTable).where(inToday(billsTable.createdAt)),
      db.select().from(paymentsTable).where(inToday(paymentsTable.createdAt)),
      db.select().from(billAuditsTable).where(inToday(billAuditsTable.createdAt)),
      db.select().from(expensesTable).where(inToday(expensesTable.createdAt)),
      db.select().from(patientsTable).where(inToday(patientsTable.createdAt)),
      db
        .select({ testName: testsTable.name })
        .from(orderTestsTable)
        .innerJoin(ordersTable, eq(orderTestsTable.orderId, ordersTable.id))
        .innerJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(and(inToday(ordersTable.createdAt), ne(orderTestsTable.status, "cancelled"))),
    ]);

    const totalRevenue = payments.reduce((s, p) => s + Number(p.amount), 0);
    const totalBills = bills.length;
    const paidBills = bills.filter(b => b.status === "paid").length;
    const pendingBills = bills.filter(b => b.status === "pending" || b.status === "partial").length;
    const totalPayments = totalRevenue;
    const billsEdited = new Set(audits.map(a => a.billId)).size;

    // Cash vs. digital vs. unclassified/suspense — same locked business rule
    // (never silently fold an unrecognized method into cash or digital) used
    // by daily-summary.ts, reused here via the shared classifier lib.
    let cashCollected = 0, digitalCollected = 0, unclassifiedCollected = 0;
    for (const p of payments) {
      const amt = Number(p.amount);
      if (isPhysicalCash(p.method)) cashCollected += amt;
      else if (isDigitalSettlement(p.method)) digitalCollected += amt;
      else unclassifiedCollected += amt;
    }

    const nonCancelledBills = bills.filter(b => b.status !== "cancelled");
    const discountsGiven = bills.reduce((s, b) => s + Number(b.discount || 0), 0);
    const refundsAndCancellations =
      bills.filter(b => b.status === "cancelled").reduce((s, b) => s + Number(b.refundAmount || 0), 0);
    const averageBillValue = nonCancelledBills.length > 0
      ? nonCancelledBills.reduce((s, b) => s + Number(b.totalAmount), 0) / nonCancelledBills.length
      : 0;

    let cashExpenses = 0, digitalExpenses = 0;
    for (const e of expenses) {
      const amt = Number(e.amount);
      if (isPhysicalCash(e.paymentMode)) cashExpenses += amt;
      else digitalExpenses += amt;
    }

    const outstandingResult = await db.execute<{ total: string }>(
      sql`SELECT COALESCE(SUM(balance_amount::numeric), 0)::text AS total FROM bills WHERE status IN ('pending','partial') AND balance_amount::numeric > 0`
    );
    const outstandingRows = (outstandingResult as unknown as { rows?: Array<{ total: string }> }).rows
      ?? (outstandingResult as unknown as Array<{ total: string }>);
    const totalOutstandingDues = outstandingRows[0]?.total ?? "0";

    const staffTotals = new Map<string, number>();
    for (const p of payments) {
      const name = p.recordedByName || "Unknown";
      staffTotals.set(name, (staffTotals.get(name) || 0) + Number(p.amount));
    }
    const staffWise = [...staffTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount }));

    const testCounts = new Map<string, number>();
    for (const row of orderTestRows) {
      testCounts.set(row.testName, (testCounts.get(row.testName) || 0) + 1);
    }
    const topTests = [...testCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // My Activity Logs: recent bill edits/audits today (max 10 most recent)
    const billMap = new Map(bills.map(b => [b.id, b.billNumber]));
    const activityLogs = audits
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, 10)
      .map(a => ({
        billNumber: billMap.get(a.billId) || `Bill ${a.billId}`,
        editor: a.editedBy || "Unknown",
        action: a.changeType || "edited",
      }));

    // Outstanding Bills: breakdown by status (clinic-wide, not just today's)
    const outstandingBreakdownResult = await db.execute<{ status: string; count: string; total: string }>(
      sql`SELECT status, COUNT(*)::text AS count, COALESCE(SUM(balance_amount::numeric), 0)::text AS total FROM bills WHERE status IN ('pending','partial') AND balance_amount::numeric > 0 GROUP BY status ORDER BY status`
    );
    const outstandingBreakdownRows = (outstandingBreakdownResult as unknown as { rows?: Array<{ status: string; count: string; total: string }> }).rows
      ?? (outstandingBreakdownResult as unknown as Array<{ status: string; count: string; total: string }>);
    const outstandingBills = outstandingBreakdownRows.map(r => ({
      status: r.status.charAt(0).toUpperCase() + r.status.slice(1),
      count: r.count,
      amount: Number(r.total),
    }));

    // Discount Given: breakdown of discounts by reason (today's bills only)
    const discountBreakdown = new Map<string, number>();
    for (const b of bills) {
      if (Number(b.discount || 0) > 0) {
        const reason = b.discountReason || "No reason specified";
        discountBreakdown.set(reason, (discountBreakdown.get(reason) || 0) + Number(b.discount));
      }
    }
    const discountDetails = [...discountBreakdown.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, amount]) => ({ reason, amount }));

    const today = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    await sendDailySummaryEmail({
      date: today,
      totalRevenue,
      totalBills,
      paidBills,
      pendingBills,
      totalPayments,
      billsEdited,
      cashCollected,
      digitalCollected,
      unclassifiedCollected,
      discountsGiven,
      refundsAndCancellations,
      averageBillValue,
      newPatients: newPatients.length,
      totalOutstandingDues: Number(totalOutstandingDues || 0),
      cashExpenses,
      digitalExpenses,
      staffWise,
      topTests,
      activityLogs,
      outstandingBills,
      discountDetails,
    }, { force: opts.force });

    if (opts.scheduled && opts.slot) {
      const [settingsRow] = await db
        .select({ id: emailSettingsTable.id, dailySummaryLastSentSlots: emailSettingsTable.dailySummaryLastSentSlots })
        .from(emailSettingsTable)
        .limit(1);
      if (settingsRow) {
        let slots: Record<string, string> = {};
        try {
          const parsed = JSON.parse(settingsRow.dailySummaryLastSentSlots || "{}");
          if (parsed && typeof parsed === "object") slots = parsed;
        } catch { /* malformed — start fresh */ }
        slots[opts.slot] = todayIST(now);
        await db
          .update(emailSettingsTable)
          .set({ dailySummaryLastSentSlots: JSON.stringify(slots) })
          .where(eq(emailSettingsTable.id, settingsRow.id));
      }
    }

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

// ── Queue Display: patient "almost up" pings + staff offline-TV alerts ──────
// Both are off by default per room (queue_display_settings toggles). Runs
// every 2 minutes — frequent enough that a patient ping still feels timely,
// infrequent enough not to spam the WhatsApp provider on a busy queue.
function scheduleQueueDisplayAlerts() {
  cron.schedule("*/2 * * * *", async () => {
    try {
      const { runPatientPingSweep } = await import("./lib/queueDisplayPingScheduler");
      const r = await runPatientPingSweep();
      if (r.pinged > 0) console.log(`[cron] Queue display: sent ${r.pinged} patient ping(s)`);
    } catch (err) {
      console.error("[cron] Queue display patient ping sweep failed:", err);
    }
    try {
      await checkQueueDisplayOfflineAlerts();
    } catch (err) {
      console.error("[cron] Queue display offline-alert check failed:", err);
    }
  });
  console.log("[cron] Queue display patient-ping + offline-alert scheduler started (runs every 2 minutes)");
}

async function checkQueueDisplayOfflineAlerts() {
  const { queueDisplaySettingsTable } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { displayHeartbeatTracker } = await import("./lib/displayHeartbeatTracker");
  const { getWhatsAppService } = await import("./services/whatsapp/WhatsAppService");

  const rooms = await db.select().from(queueDisplaySettingsTable).where(eq(queueDisplaySettingsTable.staffAlertEnabled, true));
  if (rooms.length === 0) return;

  const service = getWhatsAppService();
  for (const room of rooms) {
    if (!room.staffAlertPhone) continue;
    const thresholdMs = room.staffAlertAfterMinutes * 60_000;
    const lastSeen = displayHeartbeatTracker.getLastSeen(room.roomKey);
    const offline = !lastSeen || Date.now() - lastSeen > thresholdMs;
    if (!offline) continue;

    const cooldownMs = 60 * 60_000; // re-alert at most once an hour while it stays down
    const lastAlerted = displayHeartbeatTracker.getLastAlertedAt(room.roomKey);
    if (lastAlerted && Date.now() - lastAlerted < cooldownMs) continue;

    const minutesDark = lastSeen ? Math.round((Date.now() - lastSeen) / 60_000) : null;
    const phone = service.normalizePhone(room.staffAlertPhone);
    const text = `Care Diagnostics: the "${room.roomTitle || room.roomKey}" queue display TV appears offline` +
      (minutesDark ? ` (no heartbeat for ${minutesDark} min)` : " (never connected)") +
      `. Please check the screen.`;

    displayHeartbeatTracker.markAlerted(room.roomKey);
    try {
      const result = await service.sendText(phone, text);
      if (!result.ok) console.warn(`[cron] Queue display offline alert failed for room ${room.roomKey}:`, result.error);
    } catch (err) {
      console.warn(`[cron] Queue display offline alert threw for room ${room.roomKey}:`, err);
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
