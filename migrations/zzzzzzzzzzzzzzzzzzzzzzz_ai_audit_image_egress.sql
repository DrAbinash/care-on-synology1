-- STAGE 1 PR-A: the AI audit log must be able to say whether pixels left the building.
--
-- WHY THIS FILE EXISTS
-- `ai_reporting_audit_logs` already records an image send, but only as
-- `provider` + `num_images`. `provider` is a NAME. The clinic's own locality rule
-- (`classifyEffectiveLocality`, lib/ai-providers/src/providerLocality.ts) says a
-- provider's locality must be derived from the network destination it resolved to,
-- never from what it is called — that is the whole reason PR #907 exists. So the
-- audit row could not answer the one question an image-egress review asks: did
-- this patient's images go to a machine outside the clinic, and on whose
-- authority? Four separate tables hold a job id (ai_report_compose_jobs,
-- dicom_retry_queue, the self-test run, the shadow pipeline), and none of them
-- could be named in the row.
--
-- WHAT THESE COLUMNS ADD
--   endpoint_locality     `local` | `cloud` as derived from the resolved endpoint
--                         at send time; `unknown` when nothing was resolved.
--   job_reference         `compose_job:17`, `shadow_job:9`, `self_test:<iso>`.
--                         Text on purpose: an integer FK would point at exactly
--                         one of four tables and silently lie about the others.
--   correlation_id        ties the HTTP request to the job that served it.
--   image_source_types    comma-separated `radiology_report_key_images.source_type`
--                         values — provenance, so a viewport capture is
--                         distinguishable from a phantom an operator supplied.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No image bytes, no base64, no prompt text, no captions. The columns above
--     are the whole of what is added, and the writer that fills them is tested to
--     refuse a payload field. The existing `prompt_text` column is NOT extended to
--     the new sends: a Composer prompt carries the radiologist's own sentences,
--     and an audit table is not where they belong.
--   * No NOT NULL, no default, no backfill. A row written before this file ran
--     cannot be made to claim it knew its endpoint locality, and a column that
--     defaults to `local` would make every historical send look safe.
--   * No new index. These columns are read by the audit viewer's existing
--     `byCreated`/`byStudy` scans; a locality index on a two-value column invites
--     a planner to stop using the ones that matter.
--   * No rewrite of any earlier migration. The chain is append-only because the
--     clinic's database has already run those files.
--
-- SAFE AGAINST THE CURRENT PRODUCTION SCHEMA
-- `ADD COLUMN IF NOT EXISTS` is a no-op where `drizzle-kit push` already created
-- the columns, so a migration-built clinic database and a development database
-- converge on the same shape. The table is created by
-- `zz_schema_reconcile_20260709.sql`, and `zzz_ai_audit_anonymized_default.sql`
-- sets its `anonymized` default; both sort before this file, which
-- `node scripts/check-migration-order.cjs` verifies.

ALTER TABLE ai_reporting_audit_logs
  ADD COLUMN IF NOT EXISTS endpoint_locality text;

ALTER TABLE ai_reporting_audit_logs
  ADD COLUMN IF NOT EXISTS job_reference text;

ALTER TABLE ai_reporting_audit_logs
  ADD COLUMN IF NOT EXISTS correlation_id text;

ALTER TABLE ai_reporting_audit_logs
  ADD COLUMN IF NOT EXISTS image_source_types text;
