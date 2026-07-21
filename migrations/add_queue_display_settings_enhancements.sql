-- Queue Display: wait-time estimate toggle, voice announcement, language,
-- patient WhatsApp ping, branding/video interstitial, quiet hours, and
-- staff offline-TV alerts. See lib/db/src/schema/queueDisplaySettings.ts
-- for design rationale. Idempotent (IF NOT EXISTS), same convention as
-- add_queue_display_settings.sql / add_queue_display_theme_kiosk.sql.

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS show_wait_estimate BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS voice_announcement_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS patient_ping_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS patient_ping_tokens_before INTEGER NOT NULL DEFAULT 2;

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS show_media BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS media_items TEXT NOT NULL DEFAULT '[]';
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS media_interval_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS media_duration_seconds INTEGER NOT NULL DEFAULT 30;

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT NOT NULL DEFAULT '';
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT NOT NULL DEFAULT '';
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS quiet_hours_dim_percent INTEGER NOT NULL DEFAULT 40;

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS staff_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS staff_alert_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS staff_alert_after_minutes INTEGER NOT NULL DEFAULT 10;
