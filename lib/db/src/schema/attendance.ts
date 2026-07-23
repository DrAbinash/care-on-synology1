import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

/**
 * Enterprise attendance foundation — Phase 2 primitives, shipped additively.
 *
 * The existing `staff_attendance` table (schema/staff.ts) is a per-day SUMMARY
 * (one row per staff per date). It is kept as-is. This file adds the immutable
 * RAW event log that sits underneath it, so:
 *   - every punch from every source is preserved verbatim and never mutated,
 *   - re-imports are idempotent (unique dedupe_key),
 *   - imports/device syncs are auditable via an import-run ledger.
 *
 * Nothing here activates payroll or auto-computes salary. Gated by
 * ff_hr_attendance_management / ff_hr_biometric_attendance (Shadow Mode).
 */

// One row per import/sync batch (CSV upload, device poll, admin action) so a
// partial failure is diagnosable and a re-run is a no-op.
export const attendanceImportRunsTable = pgTable(
  "attendance_import_runs",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // usb-bridge | csv_import | api_import | ...
    deviceId: text("device_id"),
    status: text("status").notNull().default("completed"), // running | completed | failed | partial
    totalCount: integer("total_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    startedByUserId: integer("started_by_user_id"),
    startedByName: text("started_by_name"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    sourceIdx: index("attendance_import_runs_source_idx").on(t.source),
  }),
);

// Immutable raw punch events. Never updated except by explicit administrative
// supersession (a new row + audit), never deleted. dedupe_key makes re-import a
// no-op; for the interactive bridge, the single-use punch token already
// prevents replays and the key carries the punch identity for the audit trail.
export const attendanceRawPunchesTable = pgTable(
  "attendance_raw_punches",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    source: text("source").notNull(), // matches staff_attendance.source strings
    direction: text("direction").notNull().default("unknown"), // in | out | unknown
    punchTs: timestamp("punch_ts", { withTimezone: true }).notNull(),
    deviceId: text("device_id"),
    templateId: integer("template_id"), // bridge_fingerprint_templates.id (no FK — loose coupling)
    score: integer("score"),
    // Stable identity of the physical punch; UNIQUE → idempotent re-ingest.
    dedupeKey: text("dedupe_key").notNull(),
    importRunId: integer("import_run_id").references(() => attendanceImportRunsTable.id, {
      onDelete: "set null",
    }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffIdx: index("attendance_raw_punches_staff_idx").on(t.staffId),
    staffTsIdx: index("attendance_raw_punches_staff_ts_idx").on(t.staffId, t.punchTs),
    dedupeUq: uniqueIndex("attendance_raw_punches_dedupe_uq").on(t.dedupeKey),
  }),
);

export type AttendanceImportRun = typeof attendanceImportRunsTable.$inferSelect;
export type AttendanceRawPunch = typeof attendanceRawPunchesTable.$inferSelect;
