-- =============================================================================
-- Migration: Postgres performance tuning (persists across redeploy)
-- Date: 2026-08-15
-- =============================================================================
-- PROBLEM: Postgres checkpoints were taking 15-63 seconds, freezing all writes
-- during heavy billing. The default settings (max_wal_size=1GB,
-- checkpoint_timeout=5min) are too aggressive for a Synology NAS with HDD storage.
--
-- FIX: Use ALTER SYSTEM to set tuning parameters that:
--   1. Allow larger WAL files so checkpoints happen less often
--   2. Spread checkpoint writes over a longer period
--   3. Allocate more memory for shared buffers and caching
--
-- PERSISTENCE: ALTER SYSTEM writes to postgresql.auto.conf in the data directory.
-- The db_data volume (care_main_db_data) is external and persistent, so these
-- settings survive docker-compose down/up, docker-compose up --build, and even
-- container recreation. This migration re-applies them on every deploy as a
-- safety net — if someone manually resets the config, the next deploy fixes it.
--
-- NOTE: shared_buffers requires a Postgres restart to take effect. The
-- migration applies the setting, but the actual memory allocation only changes
-- on next docker restart. max_wal_size, checkpoint_timeout, and
-- checkpoint_completion_target take effect immediately via pg_reload_conf().
-- This migration does NOT restart Postgres — that would block deployment.
-- The settings will take full effect on the next natural restart or manual
-- `docker restart care-db`.
-- =============================================================================

-- Increase WAL size so checkpoints happen less often (was 1GB default)
ALTER SYSTEM SET max_wal_size = '2GB';

-- Checkpoint every 15 minutes instead of every 5 (was 5min default)
ALTER SYSTEM SET checkpoint_timeout = '15min';

-- Spread checkpoint writes over 90% of the timeout window (was 0.9 default,
-- but explicitly set to ensure it survives any future config reset)
ALTER SYSTEM SET checkpoint_completion_target = '0.9';

-- Allocate 1GB for shared buffers (was 128MB default — too low for a clinic)
-- Requires Postgres restart to take full effect.
ALTER SYSTEM SET shared_buffers = '1GB';

-- Tell Postgres the OS can cache up to 4GB (was 4GB default, but explicitly
-- set so it survives config resets)
ALTER SYSTEM SET effective_cache_size = '4GB';

-- Reload the config so non-restart settings take effect immediately
SELECT pg_reload_conf();
