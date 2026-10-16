-- Self-service Quick Select authoring: the strip's boxes move from the browser to the server,
-- with father → son ownership, per-user stars and click counts, and an audit of every edit.
--
-- WHY THIS FILE EXISTS
-- The boxes a radiologist clicks in the Reporting Workspace's Quick Select strip are defined in
-- a TypeScript data file (`quick-select-tiles.data.ts`) and, when the doctor edits one, in the
-- browser's localStorage under `zai-rad-quickselect-v1`. Neither is the clinic's data. A box
-- authored at the reporting desk therefore dies with the browser cache and never reaches the
-- second workstation, which is why every wording change so far has had to be made by editing
-- source and shipping a deploy.
--
-- Meanwhile `radiology_quick_findings` already stores exactly the shape this needs — one row
-- carrying finding / impression / technique / recommendation text, an admin-gated CRUD API and
-- an admin page. This migration makes that table the single home for every box and adds the
-- columns the authoring UI needs on top of it. No second table of boxes is created, and the
-- localStorage copy is retired by the client change that reads from here.
--
-- WHAT EACH NEW COLUMN IS FOR
--   parent_id          father → son ownership. NULL is a father or a standalone box. A father is
--                      a real clinical box that writes its own sentences; clicking it also offers
--                      its sons. Exactly two levels — a son may not be a father.
--   son_kind           '' | 'grade' | 'include' | 'list'. A 'grade' son RETIRES the father's own
--                      wording in the sections the son fills; an 'include' son ADDS its own
--                      wording; a 'list' son is navigation and writes nothing.
--   field              the section the box primarily writes, which is also the strip tab its tree
--                      lives under: findings | impression | recommendation | technique |
--                      clinicalHistory.
--   mnemonic           the search shortcut printed on the box.
--   concept            clinical concept id from CLINICAL_CONTENT_PACKS. This is what decides
--                      whether a box may conclude (isImpressionworthyAbnormal) and which scaffold
--                      normals it supersedes. Without it a box cannot be checked against the
--                      concept registry at all — the DEF-3 class of defect is a box whose prose
--                      reached Findings and could not reach the Impression.
--   scope_modality     MR / CT / USG / XR …, alongside the existing study_type (the region).
--   factory_key        stable identity of the shipped definition this row came from. Deliberately
--                      NOT the label: a box the doctor renames must not be resurrected under its
--                      old name by the next deploy.
--   factory_definition JSON snapshot of that shipped wording. Non-empty is what makes
--                      "Restore defaults" a real action rather than a button that does nothing.
--   customized_at      set when the clinic's wording diverges from factory_definition.
--
-- THE DEPLOY CONTRACT THESE THREE COLUMNS BUY
-- The owner's requirement is that an edit made in the clinic survives every deploy. The refresh
-- that runs at seed time therefore obeys: a row with factory_key set and customized_at NULL is
-- overwritten with the new factory wording; a row with customized_at set is never touched; a
-- factory_key that exists in no row is inserted. Shipping new built-in content can then only
-- ever add boxes or update ones nobody has edited.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No trigger. The two-level ownership rule needs a join, so it is enforced in the write API
--     and pinned by tests; a new trigger also breaks the repo's table-census scripts.
--   * No foreign key from the history table to the box. A box can be deleted and the record of
--     who wrote what must outlive it — hence the label and study_type snapshot on each row.
--   * No backfill of parent_id, factory_key or concept. Every existing row stays a top-level,
--     clinic-owned, concept-less box, which is what it is today; the seed script adopts the
--     factory ones by (study_type, label) and stamps their keys, without rewriting wording the
--     clinic has already changed.
--   * No NOT NULL without a default, no rewrite of an earlier file. The chain is append-only
--     because the clinic's database has already run those files.
--
-- SAFE AGAINST THE CURRENT PRODUCTION SCHEMA
-- Every statement is idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
-- `CREATE INDEX IF NOT EXISTS`), so a database built by `drizzle-kit push` and one built by this
-- chain converge on the same shape. The target table is created by
-- `add_radiology_quick_findings.sql`, which sorts before any `z`-prefixed file.

ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS parent_id integer;
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS son_kind text NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS field text NOT NULL DEFAULT 'findings';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS mnemonic text NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS concept text NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS scope_modality text NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS factory_key text NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS factory_definition text NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS customized_at timestamptz;

-- One factory definition may own at most one row. Clinic-authored rows all carry '' and are
-- excluded by the predicate, so they cannot collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS radiology_quick_findings_factory_key_uq
  ON radiology_quick_findings (factory_key)
  WHERE factory_key <> '';

CREATE INDEX IF NOT EXISTS radiology_quick_findings_parent_idx
  ON radiology_quick_findings (parent_id, is_active, sort_order);

-- ── Per-radiologist click counts ─────────────────────────────────────────────
-- The second key of the strip's ordering: starred first (radiology_quick_favorites, already
-- exists), then most used. A counter, not an audit trail, so it cascades with the box.
CREATE TABLE IF NOT EXISTS radiology_quick_finding_usage (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  finding_id integer NOT NULL REFERENCES radiology_quick_findings (id) ON DELETE CASCADE,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS radiology_quick_finding_usage_user_finding_uq
  ON radiology_quick_finding_usage (user_id, finding_id);

CREATE INDEX IF NOT EXISTS radiology_quick_finding_usage_finding_idx
  ON radiology_quick_finding_usage (finding_id);

-- ── Authoring audit ──────────────────────────────────────────────────────────
-- One row per changed field per act, so the history view can show the before/after wording
-- rather than only "someone edited this". finding_id is a plain integer on purpose: the box may
-- be deleted and the record must remain readable, which is why label and study_type are copied.
CREATE TABLE IF NOT EXISTS radiology_quick_finding_history (
  id serial PRIMARY KEY,
  finding_id integer NOT NULL,
  factory_key text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  study_type text NOT NULL DEFAULT '',
  user_id integer,
  user_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  field_name text NOT NULL DEFAULT '',
  old_value text,
  new_value text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS radiology_quick_finding_history_finding_idx
  ON radiology_quick_finding_history (finding_id, changed_at);

CREATE INDEX IF NOT EXISTS radiology_quick_finding_history_changed_idx
  ON radiology_quick_finding_history (changed_at);
