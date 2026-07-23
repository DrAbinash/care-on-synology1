-- Critical-finding acknowledgement repair (stabilization PR 3).
-- Adds the metadata the canonical ack/notify workflow records:
--   acknowledged_role / acknowledged_note — who acknowledged (role from the
--     authenticated session) and their optional note;
--   notified_by / notification_note — WHO recorded the notification attempt
--     (session identity) and the attempt's note;
--   notification_delivered — nullable: NULL means not verifiable (phone /
--     in-person); reserved for future verifiable channels. Never used to
--     pretend delivery happened.
-- Filename starts with the stem of zz_schema_reconcile_20260709.sql (which
-- creates radiology_critical_findings) so it sorts after it by construction.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS only.

ALTER TABLE "radiology_critical_findings" ADD COLUMN IF NOT EXISTS "acknowledged_role" text;
ALTER TABLE "radiology_critical_findings" ADD COLUMN IF NOT EXISTS "acknowledged_note" text;
ALTER TABLE "radiology_critical_findings" ADD COLUMN IF NOT EXISTS "notified_by" text;
ALTER TABLE "radiology_critical_findings" ADD COLUMN IF NOT EXISTS "notification_note" text;
ALTER TABLE "radiology_critical_findings" ADD COLUMN IF NOT EXISTS "notification_delivered" boolean;
