-- Clinic-wide Billing Print settings (Settings → Billing Print).
--
-- Before this column, bill print settings (default paper size/format, layout
-- & typography overrides, adminLock, …) were saved ONLY in each browser's
-- localStorage, per user — so the paper size the admin configured and
-- verified in the Settings live preview never reached other billing
-- counters. A counter still on the built-in A5-portrait default then sent
-- A5 print jobs to a printer tray loaded with A4 paper, which many drivers
-- rotate 90° to fit: bills printed sideways while the admin's preview looked
-- correct. Storing the settings here makes them clinic-wide; localStorage
-- remains a per-user override layer that adminLock can disable.
--
-- Stored as a JSON blob of Partial<BillPrintSettings> (see
-- artifacts/diagnostic-erp/src/lib/billPrintSettings.ts). "{}" = nothing
-- configured yet; every field falls back to built-in defaults client-side.
--
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS bill_print_settings_json TEXT NOT NULL DEFAULT '{}';
