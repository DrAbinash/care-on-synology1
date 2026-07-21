-- Queue Display: orientation, extended theme colors, and kiosk-mode toggles.
-- See lib/db/src/schema/queueDisplaySettings.ts for design rationale.
-- Every statement is idempotent (IF NOT EXISTS) per db-patch-entrypoint.sh
-- convention, same as add_queue_display_settings.sql.

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS background_color TEXT NOT NULL DEFAULT '';
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS card_background_color TEXT NOT NULL DEFAULT '';
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS text_color TEXT NOT NULL DEFAULT '';

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS layout_orientation TEXT NOT NULL DEFAULT 'portrait';

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS kiosk_wake_lock BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS kiosk_auto_fullscreen BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS kiosk_auto_reload BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS kiosk_prevent_exit BOOLEAN NOT NULL DEFAULT TRUE;
