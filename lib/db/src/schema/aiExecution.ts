/**
 * AI Execution Layer — Phase P1 (SHADOW MODE). Gates G4/G5/G6.
 *
 * These tables store the internal output of the AI execution pipeline. They are
 * SHADOW-ONLY: nothing here is exposed to radiologists or merged into reports in
 * P1. See docs/architecture/radiology-ai/V1.1_IMPLEMENTATION_CONSTITUTION.md
 * §5/§9/§10 and P1_IMPLEMENTATION_REPORT.md.
 *
 *   study_snapshots        — immutable, per-revision instance manifest + content hash
 *   ai_processing_manifests — immutable record of HOW a draft was produced (reproducibility)
 *   ai_shadow_drafts        — the structured provisional report (shadow; never exposed)
 *   ai_evidence             — per-finding evidence anchors (series/SOP/frame/measurement)
 */
import {
  pgTable, serial, integer, text, boolean, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { radiologyStudiesTable } from "./radiology";

// ── Immutable Study Snapshot ────────────────────────────────────────────────
// One row per (study_instance_uid, revision). A new content hash → a new
// revision; an existing snapshot is NEVER overwritten (late-arriving series
// create a new revision and supersede — not mutate — the previous one).
export const studySnapshotsTable = pgTable(
  "study_snapshots",
  {
    id: serial("id").primaryKey(),
    studyInstanceUid: text("study_instance_uid").notNull(),
    radiologyStudyId: integer("radiology_study_id").references(() => radiologyStudiesTable.id),
    revision: integer("revision").notNull().default(1),
    // sha256 over the study's instance set (order-independent). Changes iff the
    // instance set changes.
    contentHash: text("content_hash").notNull(),
    seriesCount: integer("series_count").notNull().default(0),
    instanceCount: integer("instance_count").notNull().default(0),
    // The instance manifest: [{ seriesUid, sopUid, modality, seriesNumber, ... }]
    instancesJson: jsonb("instances_json").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uidRevKey: uniqueIndex("study_snapshot_uid_rev_key").on(t.studyInstanceUid, t.revision),
    uidHashKey: uniqueIndex("study_snapshot_uid_hash_key").on(t.studyInstanceUid, t.contentHash),
    uidIdx: index("study_snapshot_uid_idx").on(t.studyInstanceUid),
  }),
);
export type StudySnapshot = typeof studySnapshotsTable.$inferSelect;

// ── Processing Manifest (immutable) ─────────────────────────────────────────
// The reproducibility spine: exactly which snapshot, model, prompt, pack, rules,
// and image set produced a draft. Written once; never updated in place.
export const aiProcessingManifestsTable = pgTable(
  "ai_processing_manifests",
  {
    id: serial("id").primaryKey(),
    studySnapshotId: integer("study_snapshot_id").notNull().references(() => studySnapshotsTable.id),
    studyInstanceUid: text("study_instance_uid").notNull(),
    snapshotContentHash: text("snapshot_content_hash").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    knowledgePackVersion: text("knowledge_pack_version").notNull(),
    rulesVersion: text("rules_version").notNull(),
    measurementEngineVersion: text("measurement_engine_version").notNull(),
    // The selected image set: [{ seriesUid, sopUid, frameNumber }]
    imageSelectionJson: jsonb("image_selection_json").notNull(),
    // sha256 over (snapshot hash + all versions + selection). Drives reprocessing.
    inputHash: text("input_hash").notNull(),
    degraded: boolean("degraded").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    snapIdx: index("ai_manifest_snapshot_idx").on(t.studySnapshotId),
    inputHashIdx: index("ai_manifest_input_hash_idx").on(t.inputHash),
    uidIdx: index("ai_manifest_uid_idx").on(t.studyInstanceUid),
  }),
);
export type AiProcessingManifest = typeof aiProcessingManifestsTable.$inferSelect;

// ── Structured Provisional Report — the IMMUTABLE, VERSIONED AI draft store ──
// This is the canonical store for the VALIDATED structured provisional report.
// It is append-only and DB-enforced immutable (a BEFORE UPDATE/DELETE trigger,
// see migrations/add_ai_provisional_report_versioning.sql). Regeneration inserts
// a NEW version; an old draft is never overwritten. It is NOT the human report:
// accepted content flows through the existing radiology_report_drafts editor and
// finalizes into patient_reports via the radiologist's own workflow. Raw provider
// output is transient (never persisted here) — only the validated report is stored.
export const aiShadowDraftsTable = pgTable(
  "ai_shadow_drafts",
  {
    id: serial("id").primaryKey(),
    // Monotonic version per study (regeneration → version+1; never overwritten).
    version: integer("version").notNull().default(1),
    manifestId: integer("manifest_id").notNull().references(() => aiProcessingManifestsTable.id),
    studySnapshotId: integer("study_snapshot_id").notNull().references(() => studySnapshotsTable.id),
    studyInstanceUid: text("study_instance_uid").notNull(),
    radiologyStudyId: integer("radiology_study_id").references(() => radiologyStudiesTable.id),
    // Direct links required of the immutable provisional record (also reachable
    // via manifest/snapshot; duplicated here for queryability + audit clarity).
    canonicalStudyId: integer("canonical_study_id"),
    snapshotRevision: integer("snapshot_revision"),
    aiJobId: integer("ai_job_id"),
    modelDigest: text("model_digest"),
    promptVersion: text("prompt_version"),
    validated: boolean("validated").notNull().default(true),
    source: text("source").notNull().default("ai_shadow"),
    // The VALIDATED structured provisional report (JSON-first). Immutable.
    draftJson: jsonb("draft_json").notNull(),
    findingCount: integer("finding_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    manifestIdx: index("ai_shadow_draft_manifest_idx").on(t.manifestId),
    uidIdx: index("ai_shadow_draft_uid_idx").on(t.studyInstanceUid),
    uidVersionIdx: index("ai_shadow_draft_uid_version_idx").on(t.studyInstanceUid, t.version),
  }),
);
export type AiShadowDraft = typeof aiShadowDraftsTable.$inferSelect;

// ── Evidence Store ──────────────────────────────────────────────────────────
// Per-finding evidence anchors. `evidence_type` includes the value "heatmap" as
// a RESERVED future type (DICOM GSPS/SEG) — `overlay_ref` is its reserved slot,
// never populated in P1.
export const aiEvidenceTable = pgTable(
  "ai_evidence",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id").notNull().references(() => aiShadowDraftsTable.id),
    manifestId: integer("manifest_id").notNull().references(() => aiProcessingManifestsTable.id),
    findingKey: text("finding_key").notNull(),
    evidenceType: text("evidence_type").notNull(), // image | measurement | heatmap (reserved)
    seriesInstanceUid: text("series_instance_uid"),
    sopInstanceUid: text("sop_instance_uid"),
    frameNumber: integer("frame_number"),
    measurementRef: text("measurement_ref"),
    confidence: integer("confidence"), // 0-100
    // Reserved for future heatmap/overlay reference (GSPS/SEG). Unused in P1.
    overlayRef: text("overlay_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    draftIdx: index("ai_evidence_draft_idx").on(t.draftId),
    findingIdx: index("ai_evidence_finding_idx").on(t.findingKey),
  }),
);
export type AiEvidence = typeof aiEvidenceTable.$inferSelect;
