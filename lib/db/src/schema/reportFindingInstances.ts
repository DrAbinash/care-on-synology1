import { pgTable, bigserial, integer, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * report_finding_instances — the authoritative physical home of the
 * structured "FindingInstance" object (Radiology Implementation Roadmap,
 * Ticket A1; Strand A of the approved consolidation architecture).
 *
 * This is the FIRST, non-partitioned wave-1 shape. Partitioning by
 * created_at is a later, separate, sentinel-gated ticket (Strand N) — this
 * table starts with a simple bigserial PK.
 *
 * Deliberately NOT wired to any route yet (Ticket A3 owns the dual-write).
 * findingId/draftId/reportId/anatomicZoneId/structureId are reference-by-
 * value (plain integer columns, no `.references()` FK), matching this
 * codebase's established convention for linking to catalog/config rows by
 * id or name rather than a DB-enforced FK — see radiology_quick_findings'
 * study_type-by-name link to radiology_study_tabs for the existing
 * precedent this follows.
 */
export const reportFindingInstancesTable = pgTable(
  "report_finding_instances",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    draftId: integer("draft_id"),
    reportId: integer("report_id"),
    findingId: integer("finding_id").notNull(),
    // Instance-level anatomy (optional, passthrough) — populated by a future
    // hierarchy ticket (Strand I). Nullable so every insert this table will
    // ever receive works whether or not that strand has landed.
    anatomicZoneId: integer("anatomic_zone_id"),
    structureId: integer("structure_id"),
    category: text("category").notNull().default(""),
    modality: text("modality").notNull().default(""),
    structuredJson: jsonb("structured_json").notNull().default({}),
    catalogVersion: text("catalog_version").notNull().default("0"),
    // manual | quickselect | voice | ai | ohif | weasis | dicom_sr
    source: text("source").notNull().default("manual"),
    confirmed: boolean("confirmed").notNull().default(false),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Nullable, no defaultNow(): keeps every future ADD COLUMN-style change
    // to this table metadata-only (no NOT NULL DEFAULT rewrite lock) once
    // it holds real rows — see the roadmap's Ticket F-series lock-annotation
    // rule this table is designed to satisfy from day one.
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("rfi_draft_idx").on(table.draftId),
    index("rfi_report_idx").on(table.reportId),
    index("rfi_finding_idx").on(table.findingId),
  ],
);

export type ReportFindingInstance = typeof reportFindingInstancesTable.$inferSelect;
export type InsertReportFindingInstance = typeof reportFindingInstancesTable.$inferInsert;
