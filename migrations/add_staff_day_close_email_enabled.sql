-- Toggle for staff day-close reconciliation emails (Settings → Email).
ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS staff_day_close_email_enabled BOOLEAN NOT NULL DEFAULT TRUE;
