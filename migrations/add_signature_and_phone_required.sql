-- Feature Migration: Per-user bill signature image + configurable phone requirement
-- Purpose:
--   1. users.signature_data_url — staff member's uploaded signature image
--      (base64 data URL, same convention as photo_data_url). Printed on
--      that user's bills in place of a blank "Authorised Signature" line.
--      Uploaded from Settings → Users (add/edit user dialog).
--   2. clinic_settings.patient_phone_required — when TRUE (default,
--      matching existing behavior), phone number is mandatory on the
--      Patients page's Add/Edit Patient forms. When FALSE, staff can
--      register patients there without a phone. Kiosk and online-booking
--      self-registration ALWAYS require a phone regardless of this flag.
--      Toggled from Settings → Clinic Info.
-- Idempotent: Safe to run on every deployment via care-db-patch-v2
-- Auto-discovered and applied from migrations/ directory

ALTER TABLE IF EXISTS users
ADD COLUMN IF NOT EXISTS signature_data_url TEXT;

ALTER TABLE IF EXISTS clinic_settings
ADD COLUMN IF NOT EXISTS patient_phone_required BOOLEAN NOT NULL DEFAULT TRUE;
