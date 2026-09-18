import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * bridge_sync_log — CARE Reporting Studio bridge pull audit (append-only).
 *
 * Every successful GET /api/internal/reporting-studio/worklist inserts a row.
 * The /audit dead-man view derives last-sync-per-studio and 24h/7d totals from
 * this history (mirrors BACKUP_DEADMAN_MAX_AGE_HOURS philosophy).
 *
 * No PHI: modality counts + sentinel counters only. source_id is a studio
 * label or a short hash of the API key — never the raw secret.
 */
export const bridgeSyncLogTable = pgTable(
  "bridge_sync_log",
  {
    id: serial("id").primaryKey(),
    /** Studio identifier (x-studio-id header, or key:<sha256-16>). */
    sourceId: text("source_id").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    rowsServed: integer("rows_served").notNull().default(0),
    /** { "MR": 12, "US": 4, ... } */
    rowsByModality: jsonb("rows_by_modality").notNull().$type<Record<string, number>>().default({}),
    /** Aggregate sentinel flags from detectSentinels(). */
    sentinelCounters: jsonb("sentinel_counters")
      .notNull()
      .$type<{
        ageSuspicious: number;
        placeholderDob: number;
        blankAccession: number;
        blankReferringDoctor: number;
      }>()
      .default({
        ageSuspicious: 0,
        placeholderDob: 0,
        blankAccession: 0,
        blankReferringDoctor: 0,
      }),
    validationFailures: integer("validation_failures").notNull().default(0),
    statusFilter: text("status_filter"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySourceSynced: index("bridge_sync_log_source_synced_idx").on(t.sourceId, t.syncedAt),
    bySynced: index("bridge_sync_log_synced_at_idx").on(t.syncedAt),
  }),
);

export type BridgeSyncLog = typeof bridgeSyncLogTable.$inferSelect;
