-- report_finding_instances — the authoritative physical home of the
-- structured "FindingInstance" object (Radiology Implementation Roadmap,
-- Ticket A1; Strand A of the approved consolidation architecture).
--
-- Wave-1, non-partitioned shape: a simple bigserial PK. Partitioning by
-- created_at is a separate, later, sentinel-gated migration (Strand N) —
-- never bundled into this one.
--
-- Brand-new, empty table: no existing rows, so no backfill/lock concerns.
-- finding_id is NOT NULL with no default deliberately (every FindingInstance
-- row must reference a finding going forward) — this is safe because it is
-- part of the initial CREATE TABLE, not an ADD COLUMN on a populated table.
--
-- Nothing reads or writes this table yet. It ships empty and inert; Ticket
-- A3 owns wiring an actual writer behind ff_radiology_structured_core.

CREATE TABLE IF NOT EXISTS report_finding_instances (
  id                bigserial PRIMARY KEY,
  draft_id          integer,
  report_id         integer,
  finding_id        integer NOT NULL,
  anatomic_zone_id  integer,
  structure_id      integer,
  category          text NOT NULL DEFAULT '',
  modality          text NOT NULL DEFAULT '',
  structured_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  catalog_version   text NOT NULL DEFAULT '0',
  source            text NOT NULL DEFAULT 'manual',
  confirmed         boolean NOT NULL DEFAULT false,
  confirmed_by      text,
  confirmed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz
);

CREATE INDEX IF NOT EXISTS rfi_draft_idx   ON report_finding_instances (draft_id);
CREATE INDEX IF NOT EXISTS rfi_report_idx  ON report_finding_instances (report_id);
CREATE INDEX IF NOT EXISTS rfi_finding_idx ON report_finding_instances (finding_id);
