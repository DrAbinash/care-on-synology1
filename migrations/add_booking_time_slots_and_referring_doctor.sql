-- Online / kiosk booking: configurable time slots + referring doctor
--
-- 1. clinic_settings.booking_time_slots — JSON-as-text array of { value, label }
--    objects driving the "Select time slot" dropdown in the online booking form.
--    Admins edit these in Settings so the list matches the clinic's real opening
--    hours instead of the old hard-coded 7 AM–9 PM options. Default mirrors the
--    previous hard-coded list so existing installs behave identically until
--    changed.
--
-- 2. online_bookings.referring_doctor_id / referring_doctor_name — the referring
--    doctor chosen in the booking form (same idea as the Billing Desk picker).
--    Nullable: a self/walk-in booking has no referrer. On confirmation the id is
--    copied onto the created order's doctor_id.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS with defaults.

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS booking_time_slots TEXT NOT NULL DEFAULT '[{"value":"07:00 – 10:00","label":"Morning (7:00 – 10:00 AM)"},{"value":"10:00 – 13:00","label":"Late Morning (10:00 AM – 1:00 PM)"},{"value":"13:00 – 16:00","label":"Afternoon (1:00 – 4:00 PM)"},{"value":"16:00 – 19:00","label":"Evening (4:00 – 7:00 PM)"},{"value":"19:00 – 21:00","label":"Night (7:00 – 9:00 PM)"}]';

ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS referring_doctor_id INTEGER;

ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS referring_doctor_name TEXT;
