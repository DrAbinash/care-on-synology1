-- Ticket E0.1d — adds a nullable checksum column to backup_job_logs so a
-- completed scheduled backup's SHA-256 (computed over the encrypted .sql.enc
-- content actually written to disk) can be recorded and later re-verified
-- against the file. Nullable-only, no default, no rewrite lock — matches
-- upload_files.checksum's existing naming/shape. Idempotent.
ALTER TABLE backup_job_logs ADD COLUMN IF NOT EXISTS checksum TEXT;
