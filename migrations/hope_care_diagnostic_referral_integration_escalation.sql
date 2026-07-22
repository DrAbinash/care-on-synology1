-- ============================================================================
-- HOPE → CARE diagnostic referral integration — Phase 3: critical-result
-- escalation tracking. Additive ALTERs to the (Phase 1) external_result_links
-- table so the escalation reconciler can re-notify unacknowledged critical
-- results and record each escalation attempt.
--
-- Sorts alphabetically AFTER hope_care_diagnostic_referral_integration.sql
-- (which CREATEs external_result_links): "...integration." < "...integration_".
-- Idempotent; ADD COLUMN IF NOT EXISTS with defaults. No DROP/TRUNCATE.
-- ============================================================================
ALTER TABLE external_result_links ADD COLUMN IF NOT EXISTS escalation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE external_result_links ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS external_result_links_critical_ack_idx
  ON external_result_links (critical_ack_status)
  WHERE is_critical = true;
