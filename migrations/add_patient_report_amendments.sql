-- Ticket D7 — Structured Report Amendment Chain.
--
-- New linkage table for STRUCTURED report amendments: every amendment creates
-- a brand-new signed patient_reports row; this table links parent → amendment
-- and pins the chain root. Signed rows are never modified in place.
--
-- Chain shape is DB-enforced:
--   UNIQUE(original_report_id) — a report is amended at most once (linear,
--     never forked; concurrent double-amend fails the constraint, not a race).
--   UNIQUE(amended_report_id)  — a report is the amendment of at most one
--     parent; with fresh serial ids this makes cycles structurally impossible.
--
-- Additive only. The legacy report_amendments table (draft-keyed free-text
-- addendum log) is untouched and unrelated. No feature-flag row is added:
-- the amend endpoint is gated on ff_radiology_structured_final (amendments
-- are part of the structured signed WRITE path, D5).

CREATE TABLE IF NOT EXISTS patient_report_amendments (
  id                    serial PRIMARY KEY,
  original_report_id    integer NOT NULL,
  amended_report_id     integer NOT NULL,
  root_report_id        integer NOT NULL,
  original_document_id  text NOT NULL,
  amended_document_id   text NOT NULL,
  sequence_number       integer NOT NULL DEFAULT 1,
  reason                text NOT NULL,
  amended_by_id         integer,
  amended_by_name       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_report_amendments_original_uq ON patient_report_amendments (original_report_id);
CREATE UNIQUE INDEX IF NOT EXISTS patient_report_amendments_amended_uq ON patient_report_amendments (amended_report_id);
CREATE INDEX IF NOT EXISTS patient_report_amendments_root_idx ON patient_report_amendments (root_report_id);
