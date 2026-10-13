-- TOTP two-factor authentication for admin/super_admin accounts.
-- Per-user toggle (totp_enabled) plus system-wide enforcement (require_admin_2fa).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_backup_codes" jsonb;

ALTER TABLE "clinic_settings" ADD COLUMN IF NOT EXISTS "require_admin_2fa" boolean NOT NULL DEFAULT false;
