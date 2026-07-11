-- Ticket D5 — Final Report Persistence and Controlled Renderer Cutover.
--
-- Registers the D5 feature flag (default OFF), consistent with the
-- add_radiology_feature_flags.sql seed convention. No schema change: the
-- patient_reports columns D5 writes (structured_json, render_engine_version,
-- template_version, catalog_version) already exist from Ticket A2
-- (add_radiology_structured_json_columns.sql) and are nullable/dormant.
--
-- Gate semantics: when OFF (default), POST /api/patient-reports behaves
-- byte-identically to today. When ON, a radiology report created from a
-- study-linked draft additionally attempts the structured signed path
-- (canonical D1 document + D4-rendered body), falling back to the legacy
-- path — with the reason recorded — whenever the structured path cannot
-- proceed safely. Turning the flag OFF again instantly restores pure legacy
-- behavior; nothing depends on structured_json being present.

INSERT INTO feature_flags (key, description) VALUES
  ('ff_radiology_structured_final', 'Sign/finalize radiology reports through the canonical D1 structured pipeline (D2 writer + D1 validator + D4 renderer) with legacy fallback (Ticket D5). Legacy finalize remains the default when OFF.')
ON CONFLICT (key) DO NOTHING;
