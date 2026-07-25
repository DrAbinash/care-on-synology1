-- Hope partner booking: a separate test/package selection for the Hope-branded
-- public booking page (/book?source=hope).
--
-- Care admins already choose which tests and packages the public booking page
-- offers (online_booking_allowed_*). That list is global, so Hope's page showed
-- Care's whole online catalogue even though Hope only sends patients for its own
-- investigations. These two columns hold Hope's narrower selection, picked from
-- the same Care catalogue in Settings, so the items booked are still Care rows
-- with Care ids and Care prices and the billing continues to happen in Care.
--
-- Additive and inert: empty "[]" means "not configured", and the booking page
-- then falls back to the global online_booking_allowed_* list exactly as today.
-- No billing, voucher, or payment column is touched.

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS hope_booking_allowed_test_ids TEXT NOT NULL DEFAULT '[]';

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS hope_booking_allowed_package_ids TEXT NOT NULL DEFAULT '[]';
