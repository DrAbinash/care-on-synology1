-- Server-side feature flag backbone (Radiology Implementation Roadmap,
-- Ticket T0.1). Backs isFeatureEnabledServer() / GET+PATCH /api/feature-flags.
--
-- The existing client-only localStorage flags (staffSession.ts
-- FEATURE_FLAG_DEFAULTS) are untouched and keep working exactly as before —
-- this table is consulted only for "ff_radiology_" prefixed keys, where the
-- server value wins once the frontend has hydrated from it. All rows seed
-- with enabled=false: no radiology behavior changes as a result of this
-- migration. Each key corresponds to a strand in the approved consolidation
-- architecture / implementation roadmap and is turned on only when that
-- strand's own ticket wires it up.

CREATE TABLE IF NOT EXISTS feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (key, description) VALUES
  ('ff_radiology_structured_core',  'FindingInstance dual-write into report_finding_instances (Roadmap Strand A)'),
  ('ff_radiology_catalog',          'Canonical radiology catalog API — findings, parameters, aliases (Roadmap B1/B2)'),
  ('ff_radiology_render_v2',        'Merged renderEngine as the sole report text producer (Roadmap Strand F)'),
  ('ff_radiology_measurement_pool', 'Finding-independent measurement pool + attach/detach (Roadmap Strand C)'),
  ('ff_radiology_classification',   'Data-driven classification/grading engine, e.g. TI-RADS/NIHSS (Roadmap Strand D)'),
  ('ff_radiology_modality_expand',  'Canonical modality vocabulary incl. XA/IR, NM, PT (Roadmap Strand E)'),
  ('ff_radiology_catalog_delta',    'Versioned per-modality catalog bundles + delta sync (Roadmap Strand H)'),
  ('ff_radiology_search_v2',        'Fuzzy/synonym search with pg_trgm + client index (Roadmap Strand G)'),
  ('ff_radiology_hierarchy',        'Optional Zone/Structure anatomic hierarchy layers (Roadmap Strand I)'),
  ('ff_radiology_presets',          'Doctor/Department/Hospital preset resolution (Roadmap Strand J)'),
  ('ff_radiology_voice_structured', 'Voice dictation slot-filling into structured findings (Roadmap Strand K)'),
  ('ff_radiology_multiwindow',      'Dockable/floating multi-monitor reporting workspace (Roadmap Strand L)'),
  ('ff_radiology_ai_assist',        'AI-assisted suggestions with human confirmation gate (Roadmap Strand M)'),
  ('ff_radiology_scale_partition',  'report_finding_instances partitioning + read-replica routing (Roadmap Strand N)')
ON CONFLICT (key) DO NOTHING;
