-- ─────────────────────────────────────────────────────────────────────────────
-- Radiology Canonical Catalog (Tickets B1 + B2) — FOUNDATION ONLY
--
-- Additive, dormant schema for the canonical parameter library + finding graph.
-- Nothing in the running system reads these tables yet; all endpoints that touch
-- them are gated behind the ff_radiology_catalog feature flag (default OFF). No
-- legacy table is modified or migrated. Safe to re-run any number of times:
-- CREATE TABLE / INDEX IF NOT EXISTS, inline FKs created with the table.
--
-- PKs are BIGSERIAL (bigint) by design — this catalog is referenced everywhere
-- for the long haul and must not inherit the int4 exhaustion risk of legacy
-- tables. It is self-contained: no FK points at any legacy int4 table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Parameter library ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parameter_groups (
  id             BIGSERIAL PRIMARY KEY,
  key            TEXT NOT NULL,
  label          TEXT NOT NULL,
  description    TEXT,
  data_type      TEXT NOT NULL DEFAULT 'option',
  unit           TEXT,
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'draft',
  version        INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT,
  updated_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS parameter_groups_key_uq ON parameter_groups (key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS parameter_groups_status_idx ON parameter_groups (status);

CREATE TABLE IF NOT EXISTS parameter_options (
  id          BIGSERIAL PRIMARY KEY,
  group_id    BIGINT NOT NULL REFERENCES parameter_groups (id) ON DELETE RESTRICT,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  code_system TEXT,
  code_value  TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS parameter_options_group_key_uq ON parameter_options (group_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS parameter_options_group_idx ON parameter_options (group_id, sort_order);

-- ── Finding catalog ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finding_categories (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  parent_id  BIGINT REFERENCES finding_categories (id) ON DELETE RESTRICT,
  modality   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'draft',
  version    INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_categories_key_uq ON finding_categories (key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_categories_parent_idx ON finding_categories (parent_id);

CREATE TABLE IF NOT EXISTS finding_definitions (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES finding_categories (id) ON DELETE RESTRICT,
  label       TEXT NOT NULL,
  description TEXT,
  narrative   TEXT,
  impression  TEXT,
  code_system TEXT,
  code_value  TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_definitions_key_uq ON finding_definitions (key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_definitions_category_idx ON finding_definitions (category_id);
CREATE INDEX IF NOT EXISTS finding_definitions_label_idx ON finding_definitions (label);

-- ── Finding graph (edges) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finding_parameter_bindings (
  id                 BIGSERIAL PRIMARY KEY,
  finding_id         BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  parameter_group_id BIGINT NOT NULL REFERENCES parameter_groups (id) ON DELETE RESTRICT,
  required           BOOLEAN NOT NULL DEFAULT FALSE,
  default_option_id  BIGINT REFERENCES parameter_options (id) ON DELETE RESTRICT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT,
  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_parameter_bindings_uq ON finding_parameter_bindings (finding_id, parameter_group_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_parameter_bindings_finding_idx ON finding_parameter_bindings (finding_id);
CREATE INDEX IF NOT EXISTS finding_parameter_bindings_group_idx ON finding_parameter_bindings (parameter_group_id);

CREATE TABLE IF NOT EXISTS finding_synonyms (
  id         BIGSERIAL PRIMARY KEY,
  finding_id BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  synonym    TEXT NOT NULL,
  normalized TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_synonyms_finding_norm_uq ON finding_synonyms (finding_id, normalized) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_synonyms_norm_idx ON finding_synonyms (normalized);

CREATE TABLE IF NOT EXISTS finding_aliases (
  id         BIGSERIAL PRIMARY KEY,
  finding_id BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  alias_key  TEXT NOT NULL,
  normalized TEXT NOT NULL,
  source     TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_aliases_normalized_uq ON finding_aliases (normalized) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_aliases_finding_idx ON finding_aliases (finding_id);

CREATE TABLE IF NOT EXISTS finding_locations (
  id         BIGSERIAL PRIMARY KEY,
  finding_id BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  laterality TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_locations_finding_key_uq ON finding_locations (finding_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_locations_finding_idx ON finding_locations (finding_id);

CREATE TABLE IF NOT EXISTS finding_recommendations (
  id                  BIGSERIAL PRIMARY KEY,
  finding_id          BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  recommendation_text TEXT NOT NULL,
  priority            TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_by          TEXT,
  updated_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS finding_recommendations_finding_idx ON finding_recommendations (finding_id);

CREATE TABLE IF NOT EXISTS finding_severity_bindings (
  id         BIGSERIAL PRIMARY KEY,
  finding_id BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  rank       INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_severity_bindings_finding_key_uq ON finding_severity_bindings (finding_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_severity_bindings_finding_idx ON finding_severity_bindings (finding_id);

CREATE TABLE IF NOT EXISTS finding_measurement_bindings (
  id         BIGSERIAL PRIMARY KEY,
  finding_id BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'mm',
  value_type TEXT NOT NULL DEFAULT 'numeric',
  min_value  NUMERIC,
  max_value  NUMERIC,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_measurement_bindings_finding_key_uq ON finding_measurement_bindings (finding_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS finding_measurement_bindings_finding_idx ON finding_measurement_bindings (finding_id);
