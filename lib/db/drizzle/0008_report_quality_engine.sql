-- PR #101 Phase 2 — canonical Report Quality Engine persistence (append-only).
-- Runs alongside the legacy report_quality_checks / report_quality_gates
-- (untouched). Idempotent: safe to apply on every deployment.

CREATE TABLE IF NOT EXISTS "report_quality_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_draft_id" integer,
	"report_id" integer,
	"source" text NOT NULL DEFAULT 'unknown',
	"modality" text,
	"study_type" text,
	"score" integer NOT NULL,
	"blocking_count" integer NOT NULL DEFAULT 0,
	"warning_count" integer NOT NULL DEFAULT 0,
	"info_count" integer NOT NULL DEFAULT 0,
	"evaluated_rule_count" integer NOT NULL DEFAULT 0,
	"deterministic_rule_count" integer NOT NULL DEFAULT 0,
	"heuristic_rule_count" integer NOT NULL DEFAULT 0,
	"not_evaluated_json" text NOT NULL DEFAULT '[]',
	"runtime_ms" integer NOT NULL DEFAULT 0,
	"engine_version" text NOT NULL,
	"rule_version" text NOT NULL,
	"knowledge_pack_version" text,
	"findings_json" text NOT NULL DEFAULT '[]',
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rqe_draft_idx" ON "report_quality_evaluations" ("report_draft_id");
CREATE INDEX IF NOT EXISTS "rqe_report_idx" ON "report_quality_evaluations" ("report_id");
CREATE INDEX IF NOT EXISTS "rqe_modality_idx" ON "report_quality_evaluations" ("modality");
CREATE INDEX IF NOT EXISTS "rqe_created_idx" ON "report_quality_evaluations" ("created_at");

CREATE TABLE IF NOT EXISTS "report_quality_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"evaluation_id" integer,
	"report_draft_id" integer,
	"rule_id" text NOT NULL,
	"action" text NOT NULL DEFAULT 'override',
	"reason" text NOT NULL,
	"overridden_by_id" integer,
	"overridden_by_name" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rqo_eval_idx" ON "report_quality_overrides" ("evaluation_id");
CREATE INDEX IF NOT EXISTS "rqo_draft_idx" ON "report_quality_overrides" ("report_draft_id");
CREATE INDEX IF NOT EXISTS "rqo_rule_idx" ON "report_quality_overrides" ("rule_id");
