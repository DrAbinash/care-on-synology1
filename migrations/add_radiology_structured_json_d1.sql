-- Canonical D1 structured-report persistence for radiology DRAFTS
-- (Radiology Implementation Roadmap, Ticket D3; consumes D1 spec + D2 writer).
--
-- radiology_report_drafts is an existing, populated, hot table. The column
-- added here is NULLABLE with NO DEFAULT, so the ALTER is a metadata-only
-- operation (no table rewrite, no full-table scan, only a brief ACCESS
-- EXCLUSIVE lock to update the catalog).
--
-- WHY A NEW COLUMN, not the existing structured_json:
--   radiology_report_drafts.structured_json is already owned by Ticket A4 (a
--   denormalized cache of report_finding_instances) and read by Ticket A5's
--   drift detector. The D1 document is an entirely different JSON shape;
--   writing it into structured_json would make A5 permanently report drift and
--   corrupt the A4 cache contract. D3 therefore persists to its own column and
--   leaves A4/A5 untouched.
--
-- Nothing writes this column unless BOTH ff_radiology_structured_core AND
-- ff_radiology_structured_d1_draft are enabled (both default OFF). No behavior
-- changes as a result of this migration.

ALTER TABLE radiology_report_drafts ADD COLUMN IF NOT EXISTS structured_json_d1 jsonb;

-- Register the D3 feature flag (default OFF), consistent with the
-- add_radiology_feature_flags.sql seed convention. Independent of
-- ff_radiology_structured_core so that enabling the already-shipped A3.2/A4/A5
-- structured pipeline does NOT also start the (new, unproven) D1 draft write —
-- D3 additionally requires core to be on, but has its own off-switch.
INSERT INTO feature_flags (key, description) VALUES
  ('ff_radiology_structured_d1_draft', 'Persist canonical D1 structured_json for compatible radiology drafts via the D2 writer (Ticket D3). Requires ff_radiology_structured_core.')
ON CONFLICT (key) DO NOTHING;
