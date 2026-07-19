-- ============================================================================
-- Mobile app display config — admin-editable content for diagno-booking-mobile.
-- ============================================================================
-- Additive + idempotent. One JSON-as-text blob on the clinic_settings singleton
-- (same pattern as bill_print_settings_json): promo banner, services grid,
-- trust chips, tab visibility toggles, contact overrides, about text.
-- Served publicly via GET /api/public/mobile-config — the endpoint whitelists
-- what it exposes; secrets must never be stored in this blob.
--
-- Rollback (manual):
--   ALTER TABLE clinic_settings DROP COLUMN IF EXISTS mobile_app_config_json;
-- ============================================================================

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS mobile_app_config_json TEXT NOT NULL DEFAULT '{}';
