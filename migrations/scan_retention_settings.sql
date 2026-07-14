-- Configurable retention period (days) for unlinked/temporary scanned
-- documents before automatic cleanup.
-- Care Diagnostics scanner infrastructure overhaul — Phase 4.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS with a DEFAULT for existing rows.

ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS scan_retention_days INTEGER NOT NULL DEFAULT 30;
