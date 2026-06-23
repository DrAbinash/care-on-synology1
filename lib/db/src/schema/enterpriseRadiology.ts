import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  numeric,
  index,
} from "drizzle-orm/pg-core";

// ─── radiologist_performance_stats ────────────────────────────────────────────
// Aggregated daily/weekly performance metrics per radiologist for analytics
// dashboards. Updated by a background cron job.
export const radiologistPerformanceStatsTable = pgTable(
  "radiologist_performance_stats",
  {
    id: serial("id").primaryKey(),
    radiologistId: integer("radiologist_id").notNull(),
    radiologistName: text("radiologist_name").notNull(),
    periodType: text("period_type").notNull().default("daily"), // daily | weekly | monthly
    periodDate: text("period_date").notNull(), // YYYY-MM-DD or YYYY-WNN or YYYY-MM
    totalStudies: integer("total_studies").notNull().default(0),
    reportedStudies: integer("reported_studies").notNull().default(0),
    preliminaryReports: integer("preliminary_reports").notNull().default(0),
    finalReports: integer("final_reports").notNull().default(0),
    avgTatMinutes: integer("avg_tat_minutes"), // turnaround time in minutes
    statStudies: integer("stat_studies").notNull().default(0),
    emergencyStudies: integer("emergency_studies").notNull().default(0),
    routineStudies: integer("routine_studies").notNull().default(0),
    aiDraftsUsed: integer("ai_drafts_used").notNull().default(0),
    aiDraftsAccepted: integer("ai_drafts_accepted").notNull().default(0),
    criticalFindingsFlagged: integer("critical_findings_flagged").notNull().default(0),
    modalityBreakdown: text("modality_breakdown").notNull().default("{}"), // JSON: {"MR":5,"CT":3}
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byRadPeriod: index("perf_stats_rad_period_idx").on(t.radiologistId, t.periodType, t.periodDate),
    byDate: index("perf_stats_date_idx").on(t.periodDate),
  }),
);

// ─── critical_findings_alerts ─────────────────────────────────────────────────
// Life-threatening or urgent findings flagged by AI or radiologist.
// Triggers push/SMS/email to on-call radiologist and supervisor.
export const criticalFindingsAlertsTable = pgTable(
  "critical_findings_alerts",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id"),
    studyId: integer("study_id"),
    accessionNumber: text("accession_number").notNull(),
    patientId: integer("patient_id"),
    patientName: text("patient_name").notNull(),
    modality: text("modality").notNull().default("OT"),
    studyDescription: text("study_description"),
    severity: text("severity").notNull().default("high"), // stat | emergency | high | medium
    findingType: text("finding_type").notNull(), // stroke | hemorrhage | fracture | tumor | etc
    description: text("description").notNull(),
    flaggedBy: text("flagged_by").notNull(), // AI or radiologist name
    flaggedById: integer("flagged_by_id"),
    aiConfidence: numeric("ai_confidence", { precision: 3, scale: 2 }), // 0.00-1.00
    acknowledged: boolean("acknowledged").notNull().default(false),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    escalatedTo: text("escalated_to"), // supervisor name
    escalationSent: boolean("escalation_sent").notNull().default(false),
    notificationChannels: text("notification_channels").notNull().default("[]"), // ["push","email","sms"]
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    status: text("status").notNull().default("active"), // active | acknowledged | resolved | dismissed
  },
  (t) => ({
    byWorklist: index("cf_alert_worklist_idx").on(t.worklistId),
    byStatus: index("cf_alert_status_idx").on(t.status),
    bySeverity: index("cf_alert_severity_idx").on(t.severity),
    byCreated: index("cf_alert_created_idx").on(t.createdAt),
  }),
);

// ─── ai_server_health_log ─────────────────────────────────────────────────────
// Tracks AI provider API health: latency, success rate, quota usage.
// Updated by every AI call and by a periodic health-check cron.
export const aiServerHealthLogTable = pgTable(
  "ai_server_health_log",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(), // gemini | openai | anthropic
    model: text("model"),
    endpoint: text("endpoint"),
    status: text("status").notNull().default("unknown"), // healthy | degraded | down | unknown
    latencyMs: integer("latency_ms"),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    httpStatus: integer("http_status"),
    tokensUsed: integer("tokens_used"),
    quotaRemaining: integer("quota_remaining"),
    checkType: text("check_type").notNull().default("actual_call"), // actual_call | periodic_ping | manual
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byProvider: index("ai_health_provider_idx").on(t.provider),
    byStatus: index("ai_health_status_idx").on(t.status),
    byCreated: index("ai_health_created_idx").on(t.createdAt),
  }),
);

// ─── pacs_archive_lifecycle ───────────────────────────────────────────────────
// Manages study compression and tiered storage lifecycle.
// Studies older than N days get compressed; older than M days archived to cold storage.
export const pacsArchiveLifecycleTable = pgTable(
  "pacs_archive_lifecycle",
  {
    id: serial("id").primaryKey(),
    studyInstanceUID: text("study_instance_uid").notNull().unique(),
    accessionNumber: text("accession_number"),
    modality: text("modality"),
    patientId: integer("patient_id"),
    originalSizeBytes: numeric("original_size_bytes", { precision: 20, scale: 0 }),
    compressedSizeBytes: numeric("compressed_size_bytes", { precision: 20, scale: 0 }),
    compressionRatio: numeric("compression_ratio", { precision: 5, scale: 2 }),
    compressionMethod: text("compression_method"), // jpeg2000 | rle | none
    tier: text("tier").notNull().default("hot"), // hot | warm | cold | archived
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    movedToTierAt: timestamp("moved_to_tier_at", { withTimezone: true }),
    scheduledForArchiveAt: timestamp("scheduled_for_archive_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    restoreCount: integer("restore_count").notNull().default(0),
    autoCompressed: boolean("auto_compressed").notNull().default(false),
    retentionDays: integer("retention_days"), // configured retention policy
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byUid: index("archive_uid_idx").on(t.studyInstanceUID),
    byTier: index("archive_tier_idx").on(t.tier),
    byPatient: index("archive_patient_idx").on(t.patientId),
  }),
);

// ─── watchdog_status ──────────────────────────────────────────────────────────
// Tracks health of background services and triggers auto-restart.
export const watchdogStatusTable = pgTable(
  "watchdog_status",
  {
    id: serial("id").primaryKey(),
    serviceName: text("service_name").notNull().unique(), // dicom_pull_agent | pacs_bridge | ai_worker | etc
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("unknown"), // healthy | degraded | down | restarting
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    lastError: text("last_error"),
    restartCount: integer("restart_count").notNull().default(0),
    maxRestarts: integer("max_restarts").notNull().default(5),
    autoRestartEnabled: boolean("auto_restart_enabled").notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    checkIntervalSeconds: integer("check_interval_seconds").notNull().default(60),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    metadata: text("metadata").notNull().default("{}"), // JSON with extra info
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStatus: index("watchdog_status_idx").on(t.status),
    byHeartbeat: index("watchdog_heartbeat_idx").on(t.lastHeartbeat),
  }),
);

// ─── ris_sync_status ──────────────────────────────────────────────────────────
// Real-time RIS worklist sync health tracking.
export const risSyncStatusTable = pgTable(
  "ris_sync_status",
  {
    id: serial("id").primaryKey(),
    syncType: text("sync_type").notNull(), // dicom_mwl | pacs_pull | hl7_adt | ai_draft | report_delivery
    sourceSystem: text("source_system").notNull(), // conquest | orthanc | hl7_bridge | etc
    targetSystem: text("target_system").notNull(), // erp | pacs | ai_server
    status: text("status").notNull().default("idle"), // idle | syncing | synced | error | paused
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    itemsPending: integer("items_pending").notNull().default(0),
    itemsSynced: integer("items_synced").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    avgSyncTimeMs: integer("avg_sync_time_ms"),
    errorMessage: text("error_message"),
    errorCount: integer("error_count").notNull().default(0),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    bySyncType: index("ris_sync_type_idx").on(t.syncType),
    byStatus: index("ris_sync_status_idx").on(t.status),
  }),
);

export type RadiologistPerformanceStat = typeof radiologistPerformanceStatsTable.$inferSelect;
export type CriticalFindingsAlert = typeof criticalFindingsAlertsTable.$inferSelect;
export type AiServerHealthLog = typeof aiServerHealthLogTable.$inferSelect;
export type PacsArchiveLifecycle = typeof pacsArchiveLifecycleTable.$inferSelect;
export type WatchdogStatus = typeof watchdogStatusTable.$inferSelect;
export type RisSyncStatus = typeof risSyncStatusTable.$inferSelect;
