-- CARE business-time integrity: forward-only cutover + append-only evidence.
-- Final policy PR 3a. ADDITIVE ONLY: no existing table is altered, no existing
-- column gains NOT NULL/CHECK, and no historical row is read, rewritten or
-- reclassified. Both tables are created empty and the singleton row is stamped
-- by Postgres at migration time, so the enforcement boundary is a trusted
-- database instant rather than a value any client or app server clock supplies.
--
-- The guard triggers copy the pattern already used for study_snapshots and
-- ai_shadow_drafts (migrations/add_ai_shadow_uniqueness_hardening.sql:82-97):
-- row-level UPDATE/DELETE rejection plus a statement-level TRUNCATE rejection,
-- because a row-level trigger cannot see TRUNCATE.

-- ---------------------------------------------------------------------------
-- 1. The cutover row: when CARE business-date enforcement begins.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS care_time_integrity_policy (
  id integer PRIMARY KEY,
  -- A CHECK on a brand-new table validates nothing retroactively; it exists to
  -- keep this a singleton, so there is exactly one answer to "is this action
  -- before or after enforcement?".
  CONSTRAINT care_time_integrity_policy_singleton CHECK (id = 1),
  enforcement_cutover_at timestamptz NOT NULL DEFAULT now(),
  cutover_source text NOT NULL DEFAULT 'postgres-migration-now',
  set_by_subject_id integer,
  set_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Stamp the boundary with the database clock at apply time. Idempotent so a
-- re-run of the migration path can never move it.
INSERT INTO care_time_integrity_policy (id, enforcement_cutover_at, cutover_source)
VALUES (1, now(), 'postgres-migration-now')
ON CONFLICT (id) DO NOTHING;

-- Forward-only, enforced where the data lives: the boundary may be raised later
-- by an authorised change, but it can never be lowered, and the row can never
-- be deleted to switch enforcement off.
CREATE OR REPLACE FUNCTION care_time_integrity_policy_reject_backward()
RETURNS trigger AS $$
BEGIN
  IF NEW.enforcement_cutover_at < OLD.enforcement_cutover_at THEN
    RAISE EXCEPTION 'care_time_integrity_policy.enforcement_cutover_at is forward-only: it may not be moved backwards (current %, attempted %)',
      OLD.enforcement_cutover_at, NEW.enforcement_cutover_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS care_time_integrity_policy_backward_guard ON care_time_integrity_policy;
CREATE TRIGGER care_time_integrity_policy_backward_guard
  BEFORE UPDATE ON care_time_integrity_policy
  FOR EACH ROW EXECUTE FUNCTION care_time_integrity_policy_reject_backward();

CREATE OR REPLACE FUNCTION care_time_integrity_policy_reject_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'care_time_integrity_policy cannot be deleted: removing the cutover row would silently disable business-date enforcement';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS care_time_integrity_policy_delete_guard ON care_time_integrity_policy;
CREATE TRIGGER care_time_integrity_policy_delete_guard
  BEFORE DELETE ON care_time_integrity_policy
  FOR EACH ROW EXECUTE FUNCTION care_time_integrity_policy_reject_delete();

-- ---------------------------------------------------------------------------
-- 2. Append-only evidence. Deliberately wide and nullable: recording an attempt
--    must never fail because of a constraint, and no column is required beyond
--    what the guard always knows (when, what CARE believed, what happened).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS care_time_integrity_events (
  -- Identity rather than a sequence default, matching the Drizzle declaration
  -- (bigint, mode number, generatedAlwaysAsIdentity) exactly.
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Class D: the database clock, not the Node clock and never a client value.
  occurred_at timestamptz NOT NULL DEFAULT now(),
  trusted_clinic_date text NOT NULL,
  event text NOT NULL,
  outcome text NOT NULL,
  code text,
  attempted_business_date text,
  endpoint text,
  method text,
  module text,
  entity_type text,
  entity_id text,
  actor_subject_id integer,
  actor_role text,
  -- Recorded as observed identity evidence; the authority is actor_subject_id.
  actor_display_name text,
  identity_source text NOT NULL DEFAULT 'authenticated-session',
  reason text,
  approver_subject_id integer,
  request_id text,
  meta_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS care_time_integrity_events_occurred_idx
  ON care_time_integrity_events (occurred_at);
CREATE INDEX IF NOT EXISTS care_time_integrity_events_actor_idx
  ON care_time_integrity_events (actor_subject_id, occurred_at);
CREATE INDEX IF NOT EXISTS care_time_integrity_events_kind_idx
  ON care_time_integrity_events (event, outcome, occurred_at);

CREATE OR REPLACE FUNCTION care_time_integrity_events_reject_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'care_time_integrity_events is append-only: evidence may not be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS care_time_integrity_events_append_only_guard ON care_time_integrity_events;
CREATE TRIGGER care_time_integrity_events_append_only_guard
  BEFORE UPDATE OR DELETE ON care_time_integrity_events
  FOR EACH ROW EXECUTE FUNCTION care_time_integrity_events_reject_mutation();

CREATE OR REPLACE FUNCTION care_time_integrity_events_reject_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'care_time_integrity_events is append-only: TRUNCATE is not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS care_time_integrity_events_truncate_guard ON care_time_integrity_events;
CREATE TRIGGER care_time_integrity_events_truncate_guard
  BEFORE TRUNCATE ON care_time_integrity_events
  FOR EACH STATEMENT EXECUTE FUNCTION care_time_integrity_events_reject_truncate();

COMMENT ON TABLE care_time_integrity_policy IS 'Forward-only cutover instant for CARE business-date enforcement; singleton row, never movable backwards.';
COMMENT ON TABLE care_time_integrity_events IS 'Append-only evidence of business-date rejections and authorised changes. Contains no request bodies, tokens or patient data.';
