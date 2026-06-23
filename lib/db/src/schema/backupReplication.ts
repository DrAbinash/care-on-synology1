import { pgTable, serial, text, boolean, timestamp, integer, bigint, index } from "drizzle-orm/pg-core";

/**
 * Backup job configuration — each row describes one replication job
 * (DB export, report files, DICOM metadata, etc.).
 */
export const backupJobsTable = pgTable("backup_jobs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  // DB | REPORTS | DICOM_METADATA | CONFIG | FULL
  backupType: text("backup_type").notNull(),
  // LOCAL | SYNOLOGY_NAS | S3_COMPATIBLE | GOOGLE_DRIVE_PLACEHOLDER
  destinationType: text("destination_type").notNull(),
  destinationPath: text("destination_path"),
  // cron expression e.g. "0 2 * * *" or "MANUAL"
  schedule: text("schedule").notNull().default("MANUAL"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),  // success | failed | running
  lastError: text("last_error"),
  retentionDays: integer("retention_days").notNull().default(30),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Log of every backup job execution.
 */
export const backupJobLogsTable = pgTable(
  "backup_job_logs",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    status: text("status").notNull(), // running | success | failed
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    rowCount: integer("row_count"),
    filePath: text("file_path"),
    errorMessage: text("error_message"),
    notes: text("notes"),
    encrypted: boolean("encrypted").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byJob: index("backup_job_log_job_idx").on(t.jobId),
  }),
);

export type BackupJob = typeof backupJobsTable.$inferSelect;
export type BackupJobLog = typeof backupJobLogsTable.$inferSelect;
