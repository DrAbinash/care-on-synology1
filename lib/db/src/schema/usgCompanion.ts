/**
 * usgCompanion.ts — CARE USG Companion (Phase 1) telemetry.
 *
 * ONE small events table, `companion_runs`, recording what the USG Companion
 * did for each study so the Dashboard "Companion Status" card can report
 * extraction success/failure, average imported measurements, average time
 * saved, machine used and the most-common missing measurements.
 *
 * This is TELEMETRY ONLY. It never duplicates measurement storage — the
 * measurements themselves stay in usg_measurements / usg_doppler_measurements.
 * A row here is a best-effort summary written by the Companion panel when it
 * assembles / imports for a study; failing to write one must never affect
 * reporting (fire-and-forget, matching the usg_audit_log discipline).
 */

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ── companion_runs ────────────────────────────────────────────────────────────
// One row per study the Companion touched (upserted by studyInstanceUID — the
// canonical cross-system id). Aggregated by /api/care-usg-companion/dashboard-stats.
export const companionRunsTable = pgTable(
  "companion_runs",
  {
    id: serial("id").primaryKey(),

    // linkage — mirrors usg_extraction_logs / usg_measurements
    worklistId: integer("worklist_id"),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    patientId: integer("patient_id"),

    // recognised study + reused engines
    detectedStudyType: text("detected_study_type"), // UsgTemplateId, e.g. OB_GROWTH
    templateId: text("template_id"),                // template auto-selected
    protocolApplied: text("protocol_applied"),      // protocol name auto-applied, or null

    // machine (from DICOM Manufacturer / Model / Station tags)
    machineManufacturer: text("machine_manufacturer"),
    machineModel: text("machine_model"),
    machineName: text("machine_name"),

    // extraction outcome (mirrors usg_extraction_logs.status semantics)
    extractionStatus: text("extraction_status").notNull().default("none"), // completed | failed | none

    // companion lifecycle: assembled → imported (measurements pushed to report)
    status: text("status").notNull().default("assembled"),

    // measurement outcome counts (drive "Average Imported Measurements" + "Missing")
    measurementsExpected: integer("measurements_expected").notNull().default(0),
    measurementsFound: integer("measurements_found").notNull().default(0),
    measurementsImported: integer("measurements_imported").notNull().default(0),
    missingMeasurementsJson: text("missing_measurements_json").notNull().default("[]"),

    // workflow completeness at assembly time (0-100, pure workflow, NOT AI)
    readinessScore: integer("readiness_score").notNull().default(0),

    // estimate: manual-entry seconds avoided by importing machine measurements
    timeSavedSeconds: integer("time_saved_seconds").notNull().default(0),

    warningsJson: text("warnings_json").notNull().default("[]"),

    createdBy: text("created_by"),
    createdById: integer("created_by_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("companion_runs_study_idx").on(t.studyInstanceUID),
    byStatus: index("companion_runs_status_idx").on(t.status),
    byMachine: index("companion_runs_machine_idx").on(t.machineManufacturer),
    byCreated: index("companion_runs_created_idx").on(t.createdAt),
  }),
);

export type CompanionRun = typeof companionRunsTable.$inferSelect;
export type InsertCompanionRun = typeof companionRunsTable.$inferInsert;
