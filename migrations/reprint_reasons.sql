-- Configurable "Reprint Reasons" preset list — mirrors discount_reasons.
-- Staff previously typed an arbitrary free-text reason when re-printing a
-- bill (e.g. "rr"); this table lets an admin curate a preset dropdown for
-- the Bill Detail re-print dialog, same pattern as Billing Desk's discount
-- reason picker.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS reprint_reasons (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
