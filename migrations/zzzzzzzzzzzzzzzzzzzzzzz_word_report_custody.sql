-- =============================================================================
-- Migration: a custody event may name an EXAMINATION instead of a report row.
--
-- WHY THIS EXISTS
--   Most radiology reports in this clinic are typed in Microsoft Word. A Word
--   report never becomes a `patient_reports` row: the only place an externally
--   produced report is recorded is `radiology_report_attachments`, whose own
--   route header states that it is "deliberately NOT wired into
--   patient_reports". That is correct for a clinical document store and wrong
--   for a chain of custody, because the ledger's `report_id`/`report_number`
--   were both NOT NULL — so the paper the counter actually holds was the one
--   thing the ledger could not describe.
--
--   The alternative (creating a `patient_reports` row per Word report) was
--   considered and rejected by the owner: it would put a body-less row into the
--   official clinical record, which every report list, print and share surface
--   then reads as a report. The counter's record is about PAPER, so it belongs
--   in the paper ledger.
--
-- DESIGN
--   An event now names its physical item in exactly one of two ways:
--     • `report_id` set      — a report this app produced (Composer path).
--     • `report_id` NULL and
--       `order_test_id` set  — the paper for one billed examination, which is
--                              what a Word report is identified by.
--   The CHECK below makes "neither" impossible, so no event can be written that
--   does not say what paper it is about.
--
--   The two new partial unique indexes are the real change, and they are
--   deliberately NOT restricted to `report_id IS NULL`. Every custody write also
--   fills `order_test_id` when it knows one, so "one examination's paper can be
--   at the counter once, and can leave once" is enforced for BOTH kinds at the
--   same time. Without that, a Word registration and a Composer receipt of the
--   same examination would both be open at once, and the duplicate the ledger
--   exists to catch would be visible only in the UI.
--
--   Nothing is backfilled and nothing is rewritten: relaxing NOT NULL removes a
--   constraint, it does not touch a value. Every pre-existing row keeps its
--   `report_id`.
--
-- Idempotent: re-runnable on every deployment. `DROP NOT NULL` is a no-op when
-- already applied; the constraint is dropped-if-exists and re-added; the indexes
-- are CREATE IF NOT EXISTS. No DELETE, no UPDATE, no data rewritten.
-- =============================================================================

ALTER TABLE report_custody_events
  ALTER COLUMN report_id DROP NOT NULL;

ALTER TABLE report_custody_events
  ALTER COLUMN report_number DROP NOT NULL;

-- An event must name the paper it is about, by report or by examination.
ALTER TABLE report_custody_events
  DROP CONSTRAINT IF EXISTS report_custody_events_targets_something_chk;
ALTER TABLE report_custody_events
  ADD CONSTRAINT report_custody_events_targets_something_chk
  CHECK (report_id IS NOT NULL OR order_test_id IS NOT NULL);

-- One un-closed counter receipt per examination, whichever way the event names
-- its paper. `valid_until IS NULL` keeps a supervisor correction from blocking
-- the re-acknowledgment it exists to allow.
CREATE UNIQUE INDEX IF NOT EXISTS rce_open_receipt_exam_uq
  ON report_custody_events (order_test_id)
  WHERE event = 'RECEIVED_AT_DELIVERY_COUNTER' AND valid_until IS NULL
    AND order_test_id IS NOT NULL;

-- An examination's paper cannot be handed over twice, and cannot be handed over
-- by two clerks at once — the same guarantee the report-keyed index gives a
-- Composer report.
CREATE UNIQUE INDEX IF NOT EXISTS rce_open_handover_exam_uq
  ON report_custody_events (order_test_id)
  WHERE event = 'PHYSICALLY_HANDED_OVER' AND valid_until IS NULL
    AND order_test_id IS NOT NULL;

-- The counter reads one examination's history constantly; without this every
-- bill scan is a sequential scan of the ledger.
CREATE INDEX IF NOT EXISTS rce_order_test_idx
  ON report_custody_events (order_test_id, created_at);
