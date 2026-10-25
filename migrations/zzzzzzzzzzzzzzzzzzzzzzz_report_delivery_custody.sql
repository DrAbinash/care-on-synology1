-- =============================================================================
-- Migration: report delivery chain of custody — the physical report ledger.
--
-- WHY THIS EXISTS
--   Nothing in the schema records "this signed piece of paper was acknowledged
--   at the delivery counter" or "this paper was handed to the patient". The one
--   endpoint that claimed to deliver a report (POST /api/resolve-barcode/
--   reports/:id/deliver) only set patient_reports.status='delivered', which the
--   table's own comment defines as "shared via PDF/WhatsApp/Email/Print at
--   least once" — and printing already sets it. So physical handover was
--   indistinguishable from a staff member previewing a PDF, and a lost or
--   disputed report had no recorded custodian.
--
-- DESIGN
--   report_custody_events is append-only: one row per accountable human act,
--   never updated in place, never deleted. A correction inserts a new row that
--   points at the row it corrects (corrects_event_id) and closes the old row's
--   validity (valid_until); the original content, actor and timestamp stay
--   readable forever.
--   "Open" (valid_until IS NULL) means "this is the current physical state".
--   The two partial unique indexes below make that a database guarantee rather
--   than a convention: one report revision can have at most one un-closed
--   counter receipt and at most one un-closed handover, however many clerks
--   press the button at once. Both are named so a concurrency test can assert
--   WHICH relationship protected the row.
--   Actor columns are snapshots (name and role at the time) plus the
--   authenticated subject_id, so a renamed or deleted staff account cannot
--   retroactively change who did what. Nothing here trusts a client-supplied
--   name: the route writes them from req.staffSession.
--
--   Soft references only (report_id/patient_id/bill_id are plain integers, no
--   FK), matching report_delivery_receipts — so alphabetical ordering is
--   irrelevant and a restored volume cannot fail on referential order.
--   Idempotent DDL-add only: no DROP, no DELETE, no UPDATE, no data rewritten.
--   Safe to re-run on every deployment; existing rows and every pre-existing
--   report are untouched, and history is NOT backfilled (a print-derived
--   'delivered' must never be converted into a physical handover event).
-- =============================================================================

CREATE TABLE IF NOT EXISTS report_custody_events (
  id                  serial PRIMARY KEY,
  -- REPORT_PREPARED | SIGNED_PAPER_TRANSFERRED | RECEIVED_AT_DELIVERY_COUNTER |
  -- PHYSICALLY_HANDED_OVER | DELIVERY_CORRECTED | CUSTODY_DISCREPANCY_RECORDED |
  -- REMOVED_FROM_COUNTER
  -- The CHECK exists because the previous delivery writer invented a mode
  -- ("HANDED") that sat outside its table's documented vocabulary, so no
  -- consumer could recognise a real handover.
  event               text        NOT NULL,
  outcome             text        NOT NULL DEFAULT 'completed', -- completed | discrepancy
  valid_until         timestamptz,                -- NULL while this row is the current state

  report_id           integer     NOT NULL,
  report_revision     integer     NOT NULL DEFAULT 1,
  report_number       text        NOT NULL,       -- snapshot: survives any later edit
  origin              text,                       -- care_composer | word_registered

  patient_id          integer     NOT NULL,
  bill_id             integer,
  order_id            integer,
  order_test_id       integer,
  accession_number    text,
  test_name           text,                       -- test NAME only; never the report body

  actor_user_id       integer     NOT NULL,
  actor_name          text        NOT NULL,
  actor_role          text        NOT NULL,
  session_id          integer     NOT NULL,
  session_ip          text,
  session_user_agent  text,

  scanned_code        text,                       -- what was physically scanned, verbatim
  -- Required, no default: an event without its verification evidence is how a
  -- missing field later reads as "nothing changed".
  verification        jsonb       NOT NULL,
  payment_snapshot    jsonb       NOT NULL,

  recipient_category  text,                       -- patient | authorised_representative
  recipient_name      text,                       -- only where operationally required
  override_reason     text,
  override_by_user_id integer,
  batch_id            uuid,                       -- groups one clerk action (batch receiving)
  batch_seq           integer,
  corrects_event_id   integer,
  idempotency_key     text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_custody_events_event_chk CHECK (event IN (
    'REPORT_PREPARED', 'SIGNED_PAPER_TRANSFERRED', 'RECEIVED_AT_DELIVERY_COUNTER',
    'PHYSICALLY_HANDED_OVER', 'DELIVERY_CORRECTED', 'CUSTODY_DISCREPANCY_RECORDED',
    'REMOVED_FROM_COUNTER'
  )),
  CONSTRAINT report_custody_events_outcome_chk CHECK (outcome IN ('completed', 'discrepancy'))
);

-- A replayed request writes one event, not two.
CREATE UNIQUE INDEX IF NOT EXISTS rce_idempotency_uq
  ON report_custody_events (idempotency_key);
-- One un-closed counter receipt per report revision, whatever concurrent staff do.
CREATE UNIQUE INDEX IF NOT EXISTS rce_open_receipt_uq
  ON report_custody_events (report_id, report_revision)
  WHERE event = 'RECEIVED_AT_DELIVERY_COUNTER' AND valid_until IS NULL;
-- A report cannot be handed over twice.
CREATE UNIQUE INDEX IF NOT EXISTS rce_open_handover_uq
  ON report_custody_events (report_id, report_revision)
  WHERE event = 'PHYSICALLY_HANDED_OVER' AND valid_until IS NULL;

CREATE INDEX IF NOT EXISTS rce_report_idx  ON report_custody_events (report_id, created_at);
CREATE INDEX IF NOT EXISTS rce_patient_idx ON report_custody_events (patient_id);
CREATE INDEX IF NOT EXISTS rce_bill_idx    ON report_custody_events (bill_id);
CREATE INDEX IF NOT EXISTS rce_actor_idx   ON report_custody_events (actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS rce_event_idx   ON report_custody_events (event, created_at);
CREATE INDEX IF NOT EXISTS rce_batch_idx   ON report_custody_events (batch_id, batch_seq);

-- ── Report identity and derived physical state ─────────────────────────────
-- `origin` distinguishes a Composer report from one registered during the
-- Word transition, so one ledger and one dashboard serve both and the Word
-- path can retire without deleting anything.
ALTER TABLE patient_reports ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'care_composer';
-- Derived projection of the ledger, for indexed queue reads. NULL means "not in
-- the physical system" — legacy rows are never backfilled into a fake receipt.
-- The ledger stays the authority; report_custody_events is what a dispute reads.
ALTER TABLE patient_reports ADD COLUMN IF NOT EXISTS physical_state text;
ALTER TABLE patient_reports ADD COLUMN IF NOT EXISTS physical_state_at timestamptz;
CREATE INDEX IF NOT EXISTS patient_reports_physical_state_idx
  ON patient_reports (physical_state, physical_state_at);

-- ── Operational policy: is a dispatch acknowledgment required before receipt? ─
-- Default false = today's informal workflow: signed paper simply arrives at the
-- counter and the counter acknowledges it. No dispatch actor or timestamp is
-- invented while this is off.
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS require_report_dispatch_acknowledgment
  boolean NOT NULL DEFAULT false;

-- ── Scan attempts are NOT custody events; they belong to the existing audit ──
-- table, which already carries user_id / method / device_id. Additive and
-- nullable so every existing scanner surface keeps working unchanged.
ALTER TABLE scan_audit_logs ADD COLUMN IF NOT EXISTS scanned_code text;
ALTER TABLE scan_audit_logs ADD COLUMN IF NOT EXISTS linked_report_id integer;
ALTER TABLE scan_audit_logs ADD COLUMN IF NOT EXISTS page text;
