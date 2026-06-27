-- Migration: Phase 1 MRI Protocol Specs tables
-- Tracks Drizzle migrations for mriProtocolSpecs and mriProtocolQualityResults
-- Added to journal so care-migrate and care-db-patch-v2 both recognise these tables

CREATE TABLE IF NOT EXISTS "mri_protocol_specs" (
  "id"                      serial PRIMARY KEY,
  "protocol_key"            text NOT NULL,
  "name"                    text NOT NULL,
  "modality"                text NOT NULL,
  "body_part"               text NOT NULL,
  "field_strength_t"        text NOT NULL DEFAULT '1.5T/3T',
  "indications"             jsonb NOT NULL DEFAULT '[]',
  "sequences"               jsonb NOT NULL DEFAULT '[]',
  "quality_checklist"       jsonb NOT NULL DEFAULT '[]',
  "estimated_scan_time_min" integer,
  "coverage_notes"          text,
  "contrast_agent"          text,
  "contrast_timing_notes"   text,
  "is_active"               boolean NOT NULL DEFAULT true,
  "is_system"               boolean NOT NULL DEFAULT false,
  "radiologist_notes"       text,
  "tech_notes"              text,
  "created_by"              text,
  "updated_by"              text,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mri_protocol_specs_key_uq" ON "mri_protocol_specs" ("protocol_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_protocol_specs_modality_idx" ON "mri_protocol_specs" ("modality");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_protocol_specs_body_part_idx" ON "mri_protocol_specs" ("body_part");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_protocol_specs_active_idx" ON "mri_protocol_specs" ("is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mri_protocol_quality_results" (
  "id"            serial PRIMARY KEY,
  "study_id"      integer NOT NULL,
  "draft_id"      integer,
  "protocol_id"   integer NOT NULL,
  "results"       jsonb NOT NULL DEFAULT '{}',
  "overall_grade" text NOT NULL DEFAULT 'acceptable',
  "quality_notes" text,
  "completed_by"  text NOT NULL,
  "completed_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_pq_results_study_idx"    ON "mri_protocol_quality_results" ("study_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_pq_results_draft_idx"    ON "mri_protocol_quality_results" ("draft_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_pq_results_protocol_idx" ON "mri_protocol_quality_results" ("protocol_id");
