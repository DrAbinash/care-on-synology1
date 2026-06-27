/**
 * MRI Protocol Specifications
 *
 * Stores machine-readable MRI acquisition protocol definitions.
 * Each row describes one protocol (e.g. "MRI Brain Plain 3T") with its
 * constituent sequences, quality-assurance checklist, and clinical indications.
 *
 * The data lives in the DB so radiologists/admin can override factory defaults
 * without a code deploy.  The factory seeds are injected by migration
 * /migrations/seed_mri_protocols.sql which should run once on first boot.
 *
 * Relationships:
 *   radiology_report_drafts.template_id → protocol_id (advisory, not FK)
 *   mri_protocol_quality_results.protocol_id → mri_protocol_specs.id
 */

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Sequence descriptor (stored as JSONB elements) ────────────────────────────

export interface MriSequenceSpec {
  name: string;            // "FLAIR Axial", "DWI Axial", …
  abbreviation: string;    // "FLAIR", "DWI", "T2", "GRE/SWI", "MRA-TOF", …
  plane: string;           // "Axial" | "Sagittal" | "Coronal" | "Multi-planar"
  technique: string;       // "Inversion recovery FSE", "Echo-planar EPI", …
  trMs?: number | null;    // Repetition time (ms)  — null when variable/vendor
  teMs?: number | null;    // Echo time (ms)
  tiMs?: number | null;    // Inversion time (ms) — FLAIR/STIR only
  flipAngle?: number | null; // degrees — GRE/bSSFP
  sliceThicknessMm: number;
  interSliceGapMm?: number | null;
  bValue?: number | null;  // DWI only (s/mm²)
  includesAdcMap?: boolean;
  fieldStrengthT?: number | null; // 1.5 | 3.0 — null means both
  contrastRequired: boolean;
  purpose: string;         // Clinical rationale, concise sentence
  findingsSensitivity: string[]; // What this sequence best detects
  sortOrder: number;
}

// ── Quality-assurance checklist item ─────────────────────────────────────────

export interface MriQaChecklistItem {
  id: string;              // machine key, e.g. "motion_artifact"
  label: string;           // Human label shown in UI
  description: string;     // Instructions for the technologist / radiologist
  failAction: "warn" | "reject" | "note"; // What happens if this item fails
}

// ── mri_protocol_specs ────────────────────────────────────────────────────────

export const mriProtocolSpecsTable = pgTable(
  "mri_protocol_specs",
  {
    id: serial("id").primaryKey(),

    // Unique machine key that matches RADIOLOGY_TEMPLATES templateId
    // e.g. "MRI_BRAIN_PLAIN", "MRI_BRAIN_CONTRAST", "MRI_STROKE_PROTOCOL"
    protocolKey: text("protocol_key").notNull(),

    name: text("name").notNull(),                   // "MRI Brain Plain"
    modality: text("modality").notNull(),            // "MRI"
    bodyPart: text("body_part").notNull(),           // "BRAIN" | "SPINE_LS" | …
    fieldStrengthT: text("field_strength_t").notNull().default("1.5T/3T"),
    // Clinical indications (JSON string[])
    indications: jsonb("indications").notNull().default([]),
    // Ordered sequence specifications (JSON MriSequenceSpec[])
    sequences: jsonb("sequences").notNull().default([]),
    // QA checklist items (JSON MriQaChecklistItem[])
    qualityChecklist: jsonb("quality_checklist").notNull().default([]),
    // Approximate total scan time in minutes
    estimatedScanTimeMin: integer("estimated_scan_time_min"),
    // Coverage guidance (free text)
    coverageNotes: text("coverage_notes"),
    // Contrast agent details when contrastRequired = true
    contrastAgent: text("contrast_agent"),           // "Gadolinium-DTPA 0.1 mmol/kg IV"
    contrastTimingNotes: text("contrast_timing_notes"),
    // Whether this protocol is active / available for selection
    isActive: boolean("is_active").notNull().default(true),
    // Whether this row was seeded by the system (vs. added by admin)
    isSystem: boolean("is_system").notNull().default(false),
    // Notes for radiologist reading the protocol card
    radiologistNotes: text("radiologist_notes"),
    // Notes for the MRI technologist
    techNotes: text("tech_notes"),

    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byKey: uniqueIndex("mri_protocol_specs_key_uq").on(t.protocolKey),
    byModality: index("mri_protocol_specs_modality_idx").on(t.modality),
    byBodyPart: index("mri_protocol_specs_body_part_idx").on(t.bodyPart),
    byActive: index("mri_protocol_specs_active_idx").on(t.isActive),
  }),
);

export type MriProtocolSpec = typeof mriProtocolSpecsTable.$inferSelect;
export type NewMriProtocolSpec = typeof mriProtocolSpecsTable.$inferInsert;

// ── mri_protocol_quality_results ─────────────────────────────────────────────
// Radiologist fills this in per-study to record which QA items passed/failed.

export const mriProtocolQualityResultsTable = pgTable(
  "mri_protocol_quality_results",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    draftId: integer("draft_id"),
    protocolId: integer("protocol_id").notNull(), // FK → mri_protocol_specs.id
    // Compact result map: { [checklistItemId]: "pass" | "fail" | "na" }
    results: jsonb("results").notNull().default({}),
    // Overall quality verdict
    overallGrade: text("overall_grade").notNull().default("acceptable"),
    // acceptable | suboptimal | non-diagnostic
    qualityNotes: text("quality_notes"),
    completedBy: text("completed_by").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("mri_pq_results_study_idx").on(t.studyId),
    byDraft: index("mri_pq_results_draft_idx").on(t.draftId),
    byProtocol: index("mri_pq_results_protocol_idx").on(t.protocolId),
  }),
);

export type MriProtocolQualityResult = typeof mriProtocolQualityResultsTable.$inferSelect;
export type NewMriProtocolQualityResult = typeof mriProtocolQualityResultsTable.$inferInsert;
