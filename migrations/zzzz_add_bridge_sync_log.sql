-- =============================================================================
-- Migration: bridge_sync_log — Reporting Studio bridge pull audit / dead-man
--
-- Append-only log: one row per successful GET /worklist. Idempotent DDL-add
-- only — no DROP / DELETE / UPDATE. Safe to run on every deployment.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bridge_sync_log (
  id                   serial PRIMARY KEY,
  source_id            text        NOT NULL,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  rows_served          integer     NOT NULL DEFAULT 0,
  rows_by_modality     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sentinel_counters    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  validation_failures  integer     NOT NULL DEFAULT 0,
  status_filter        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bridge_sync_log_source_synced_idx
  ON bridge_sync_log (source_id, synced_at);

CREATE INDEX IF NOT EXISTS bridge_sync_log_synced_at_idx
  ON bridge_sync_log (synced_at);
