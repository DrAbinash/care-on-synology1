-- Form F ID scan: default Preferred Scanning Source → Webcam (camera).
-- Safe to re-run: SET DEFAULT is idempotent; UPDATE only touches rows still
-- on the old seed value ('mobile'). Applied automatically by care-db-patch-v2
-- (see HOW_TO_ADD_DB_MIGRATIONS.md — no manual psql on Synology deploy).

ALTER TABLE IF EXISTS clinic_settings
  ALTER COLUMN preferred_scanner SET DEFAULT 'camera';

UPDATE clinic_settings
SET preferred_scanner = 'camera'
WHERE preferred_scanner = 'mobile';
