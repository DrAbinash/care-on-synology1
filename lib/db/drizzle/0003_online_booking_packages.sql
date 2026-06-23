-- Add online booking package whitelist column
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS online_booking_allowed_package_ids TEXT NOT NULL DEFAULT '[]';
