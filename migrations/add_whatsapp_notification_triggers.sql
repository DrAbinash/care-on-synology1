-- Adds WhatsApp automation-trigger settings to whatsapp_settings.
-- See lib/db/src/schema/whatsappSettings.ts for the column semantics.
--
-- All idempotent (ADD COLUMN IF NOT EXISTS) and safe to run repeatedly.
-- New automated patient-facing sends default to OFF; the bill-created toggle
-- defaults ON so the pre-existing on-bill send behaviour is preserved.

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS auto_send_bill_created        BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS appointment_reminder_enabled  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS appointment_reminder_time     TEXT    NOT NULL DEFAULT '18:00';

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS appointment_reminder_template TEXT    NOT NULL DEFAULT '';

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS dues_reminder_enabled         BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS dues_reminder_time            TEXT    NOT NULL DEFAULT '11:00';

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS dues_reminder_min_amount      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS dues_reminder_template        TEXT    NOT NULL DEFAULT '';
