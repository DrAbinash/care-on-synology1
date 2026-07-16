-- PR #101 Phase 2.5 — normalized, queryable quality findings.
-- Written alongside report_quality_evaluations.findings_json (kept as the
-- immutable full-fidelity record). These rows let dashboards aggregate by
-- rule_id / canonical_id / category / severity at scale. Idempotent.

CREATE TABLE IF NOT EXISTS "report_quality_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"evaluation_id" integer NOT NULL,
	"report_draft_id" integer,
	"report_id" integer,
	"rule_id" text NOT NULL,
	"canonical_id" text,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"tier" text NOT NULL,
	"modality" text,
	"study_type" text,
	"knowledge_pack_source" text,
	"weight" integer,
	"message" text,
	"evidence" text,
	"suggested_fix" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rqf_eval_idx" ON "report_quality_findings" ("evaluation_id");
CREATE INDEX IF NOT EXISTS "rqf_rule_idx" ON "report_quality_findings" ("rule_id");
CREATE INDEX IF NOT EXISTS "rqf_canonical_idx" ON "report_quality_findings" ("canonical_id");
CREATE INDEX IF NOT EXISTS "rqf_draft_idx" ON "report_quality_findings" ("report_draft_id");
CREATE INDEX IF NOT EXISTS "rqf_category_idx" ON "report_quality_findings" ("category");
CREATE INDEX IF NOT EXISTS "rqf_severity_idx" ON "report_quality_findings" ("severity");
