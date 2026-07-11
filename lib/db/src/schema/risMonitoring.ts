/**
 * RIS/PACS Production Monitoring & Hardening Schema — Phase 11
 * Tables for retry queues, storage tracking, backup verification,
 * report delivery, critical escalation, and system health snapshots.
 */

import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

// ── 1. DICOM Retry Queue ──────────────────────────────────────────────────────────────────────────────────

export const dicomRetryQueueTable = pgTable(
  "dicom_retry_queue",
  {
    id: serial("id").primaryKey(),
    operationType: text("operation_type").notNull(),
    // dicom_move | dicom_store | erp_push | ocr_extraction | ai_extraction | pacs_sync
    entityId: integer("entity_id"),          // study_id / report_id / order_id
    entityType: text("entity_type").notNull(), // study | report | order | bill
    failureReason: text("failure_reason"),
    errorDetailsJson: text("error_details_json"),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(5),
    status: text("status").notNull().default("pending"),
    // pending | retrying | running | success | failed | abandoned
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // BEND-1 — durable job-execution columns (this table previously had retry
    // fields but NO worker; the radiology job runner now drains it).
    payload: jsonb("payload"),
    idempotencyKey: text("idempotency_key"),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    opTypeIdx: index("retry_op_type_idx").on(t.operationType),
    statusIdx: index("retry_status_idx").on(t.status),
    entityIdx: index("retry_entity_idx").on(t.entityType, t.entityId),
  }),
);
export type DicomRetryQueue = typeof dicomRetryQueueTable.$inferSelect;

// ── 2. Storage Metrics ─────────────────────────────────────────────────────────────────────────────────────

export const storageMetricsTable = pgTable(
  "storage_metrics",
  {
    id: serial("id").primaryKey(),
    snapshotDate: timestamp("snapshot_date", { withTimezone: true }).notNull().defaultNow(),
    totalBytesUsed: integer("total_bytes_used"),
    totalStudies: integer("total_studies"),
    studiesByModalityJson: text("studies_by_modality_json"), // {"US": 45, "CT": 12, ...}
    dailyGrowthBytes: integer("daily_growth_bytes"),
    archiveBytes: integer("archive_bytes"),
    hotStorageBytes: integer("hot_storage_bytes"),
    thresholdPercent: integer("threshold_percent").notNull().default(80),
    alertTriggered: boolean("alert_triggered").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index("storage_date_idx").on(t.snapshotDate),
    alertIdx: index("storage_alert_idx").on(t.alertTriggered),
  }),
);
export type StorageMetric = typeof storageMetricsTable.$inferSelect;

// ── 3. Backup Verification ──────────────────────────────────────────────────────────────────────────────────

export const backupVerificationTable = pgTable(
  "backup_verification",
  {
    id: serial("id").primaryKey(),
    backupType: text("backup_type").notNull(), // db | pacs_images | full | config
    status: text("status").notNull().default("pending"), // success | failed | pending | in_progress
    lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    sizeBytes: integer("size_bytes"),
    rowCount: integer("row_count"),
    restoreTestStatus: text("restore_test_status").default("not_tested"),
    // pass | fail | not_tested
    restoreTestedAt: timestamp("restore_tested_at", { withTimezone: true }),
    restoreTestDetails: text("restore_test_details"),
    alertSent: boolean("alert_sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    typeIdx: index("backup_type_idx").on(t.backupType),
    statusIdx: index("backup_status_idx").on(t.status),
  }),
);
export type BackupVerification = typeof backupVerificationTable.$inferSelect;

// ── 4. Report Delivery Tracking ────────────────────────────────────────────────────────────────────────────────

export const reportDeliveryTrackingTable = pgTable(
  "report_delivery_tracking",
  {
    id: serial("id").primaryKey(),
    reportDraftId: integer("report_draft_id").notNull(),
    studyId: integer("study_id"),
    patientId: integer("patient_id"),
    whatsappSentAt: timestamp("whatsapp_sent_at", { withTimezone: true }),
    whatsappStatus: text("whatsapp_status").default("pending"),
    // pending | sent | delivered | failed
    printStatus: text("print_status").default("pending"),
    // pending | printed | failed
    portalViewedAt: timestamp("portal_viewed_at", { withTimezone: true }),
    portalViewCount: integer("portal_view_count").notNull().default(0),
    deliveryFailureLogJson: text("delivery_failure_log_json"),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    draftIdx: index("delivery_draft_idx").on(t.reportDraftId),
    studyIdx: index("delivery_study_idx").on(t.studyId),
  }),
);
export type ReportDeliveryTracking = typeof reportDeliveryTrackingTable.$inferSelect;

// ── 5. Critical Escalation Log ────────────────────────────────────────────────────────────────────────────────

export const criticalEscalationTable = pgTable(
  "critical_escalation_log",
  {
    id: serial("id").primaryKey(),
    criticalFindingId: integer("critical_finding_id").notNull(),
    escalationLevel: integer("escalation_level").notNull().default(1),
    // 1 = initial notify | 2 = senior radiologist | 3 = department head
    escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
    escalatedTo: text("escalated_to"),           // staff name
    escalatedToRole: text("escalated_to_role"),   // radiologist | admin | head
    notificationMethod: text("notification_method"), // whatsapp | sms | email | in_app | phone
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
    resolutionStatus: text("resolution_status").default("open"),
    // open | acknowledged | resolved | escalated
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    findingIdx: index("esc_finding_idx").on(t.criticalFindingId),
    statusIdx: index("esc_status_idx").on(t.resolutionStatus),
  }),
);
export type CriticalEscalation = typeof criticalEscalationTable.$inferSelect;

// ── 6. System Health Snapshot ─────────────────────────────────────────────────────────────────────────────────

export const systemHealthSnapshotTable = pgTable(
  "system_health_snapshot",
  {
    id: serial("id").primaryKey(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
    apiHealth: text("api_health").notNull().default("ok"),     // ok | degraded | down
    dbHealth: text("db_health").notNull().default("ok"),
    pacsHealth: text("pacs_health").notNull().default("ok"),
    aiServiceHealth: text("ai_service_health").notNull().default("ok"),
    frontendHealth: text("frontend_health").notNull().default("ok"),
    diskUsagePercent: integer("disk_usage_percent"),
    memoryUsagePercent: integer("memory_usage_percent"),
    uptimeMinutes: integer("uptime_minutes"),
    detailsJson: text("details_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    snapIdx: index("health_snap_idx").on(t.snapshotAt),
    apiIdx: index("health_api_idx").on(t.apiHealth),
  }),
);
export type SystemHealthSnapshot = typeof systemHealthSnapshotTable.$inferSelect;
