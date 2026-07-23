-- =============================================================================
-- Migration: operational-health cockpit feature flag.
--
-- No new tables — the cockpit aggregates existing tables read-only and raises
-- alerts into the existing anomaly_alerts model. This migration only seeds the
-- feature flag (OFF / Shadow Mode). Idempotent.
-- =============================================================================

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_ops_cockpit', FALSE, 'Unified operational-health cockpit + proactive anomaly alerts (raises anomaly_alerts, notifies admins)')
ON CONFLICT (key) DO NOTHING;
