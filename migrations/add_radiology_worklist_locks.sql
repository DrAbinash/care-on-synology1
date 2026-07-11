-- =============================================================================
-- M1.6A: Study locking / claiming on the radiology worklist.
-- Additive, idempotent. Column names match the lockUserId/lockUserName/
-- lockTime/lockLastActivityAt/lockWorkstation placeholder keys the
-- pacs-worklist API already returned (as NULL literals) and the worklist
-- page's dormant LockBadge already renders. Lock expiry is derived from
-- lock_last_activity_at + the pacs_settings radiology_lock_ttl_seconds TTL
-- (no expires_at column), so TTL changes apply to existing locks immediately.
-- =============================================================================
ALTER TABLE IF EXISTS radiology_worklist
  ADD COLUMN IF NOT EXISTS lock_user_id integer,
  ADD COLUMN IF NOT EXISTS lock_user_name text,
  ADD COLUMN IF NOT EXISTS lock_time timestamptz,
  ADD COLUMN IF NOT EXISTS lock_last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_workstation text;

-- Claim/next-eligible scans filter on the lock owner; keep it cheap.
CREATE INDEX IF NOT EXISTS radiology_worklist_lock_user_idx
  ON radiology_worklist (lock_user_id)
  WHERE lock_user_id IS NOT NULL;
