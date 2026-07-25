-- Monthly referral-activity summary email.
-- Carries referral COUNTS and billed amounts only — never a commission figure,
-- rate or payout. Off by default, so an existing clinic sends nothing new until
-- an admin turns it on.
ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS monthly_referral_summary_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS monthly_referral_summary_last_sent TEXT NOT NULL DEFAULT '';
