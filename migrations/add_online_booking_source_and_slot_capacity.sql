-- Online booking: source channel + per-slot capacity identity
--
-- 1. online_bookings.source — website | kiosk | reception | phone
-- 2. online_bookings.slot_modality — optional modality-scoped capacity key
-- 3. online_bookings.capacity_override_reason — admin override note
-- 4. index for occupancy queries used by website/kiosk/reception together
--
-- Slot definitions (value/label/maxBookings/modality) stay in
-- clinic_settings.booking_time_slots JSON — no new slot table.
-- Safe to re-run.

ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'website';

ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS slot_modality TEXT NOT NULL DEFAULT '';

ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS capacity_override_reason TEXT;

CREATE INDEX IF NOT EXISTS online_bookings_slot_capacity_idx
  ON online_bookings (selected_date, time_slot, slot_modality);
