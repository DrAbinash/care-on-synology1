-- ─────────────────────────────────────────────────────────────────────────────
-- CARE CLINICAL REPORTING ENGINE v4.0 — Stage B: the unified clinical catalogue
--
-- ── WHAT THIS IS ───────────────────────────────────────────────────────────────
-- ADDITIVE AND DORMANT. Thirteen new tables that extend the existing canonical
-- radiology catalogue (migrations/add_radiology_catalog.sql — parameter_groups,
-- finding_definitions and their seven edge tables) with the six things that file
-- does not model at all: an examination, an authoring tile, a normal-observation
-- slot, an anatomical section order, a selection relationship, and a publication.
--
-- NO RUNTIME CODE READS THESE TABLES YET. Nothing in artifacts/api-server or
-- artifacts/diagnostic-erp queries them, so no report, no bill, no registration
-- and no signed record changes behaviour as a result of this migration. The read
-- path arrives in Stage C (observation ownership engine) and Stage G (workspace
-- integration), behind a feature flag.
--
-- ── WHY EXTEND AND NOT REPLACE ─────────────────────────────────────────────────
-- The brief (§20) demands ONE authoritative clinical catalogue and forbids "another
-- parallel catalogue". The canonical one already exists but is empty by measured
-- fact: finding_definitions holds 0 rows while radiology_quick_findings holds 363
-- real seeded rows and the TypeScript tile catalogue holds 101 live tiles. So the
-- design reuses what is genuinely good in the existing catalog — its concept rows
-- (finding_definitions), its reusable parameter library (parameter_groups /
-- parameter_options, which become load-bearing for the first time here), its
-- bigserial keys, immutable text `key`, soft-delete and (status, version)
-- conventions — and adds only the missing entities. Adding `clinical_tiles`
-- alongside `radiology_quick_findings` without touching either is deliberate:
-- Stage H migrates the content and then retires the legacy surface (Stage J).
--
-- ── SAFETY ─────────────────────────────────────────────────────────────────────
--   • Forward-only: CREATE TABLE / CREATE INDEX IF NOT EXISTS only. No DROP TABLE,
--     no TRUNCATE, no DELETE, no ALTER of any table that holds production data.
--     Re-runnable any number of times.
--   • No foreign key points at a production table, and no production table gains a
--     foreign key pointing here. The catalogue is self-contained plus references to
--     the (equally dormant) catalog tables — the discipline the B1/B2 file already
--     states, kept intact.
--   • CHECK constraints are new for this family. The B1/B2 tables have none, so
--     their enums live only in the service layer — which every SQL content seed
--     (Stage H) bypasses. Enforcing the vocabulary in the database is the point.
--   • Identifier names are kept ≤ 63 bytes: Postgres silently truncates longer
--     ones, and scripts/audit-migration-ledger.mjs then reports a migration that
--     succeeded as a failure because the constraint exists under a different name.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Examination ───────────────────────────────────────────────────────────
-- The unit of billing and reporting: modality + body part + protocol scope.
-- Today that triple exists in three competing places (structured_report_templates
-- (modality, body_part, study_type, protocol_key), radiology_protocols, and the
-- free-text study_type of radiology_quick_findings, which holds 58 distinct values)
-- and none of them is authoritative. template_key stays an unenforced text column
-- with the codebase's "FK-soft" idiom: structured_report_templates is a production
-- table with int4 ids, and a catalogue that FKs into production turns a dormant
-- schema into a live dependency.
CREATE TABLE IF NOT EXISTS clinical_examinations (
  id              BIGSERIAL PRIMARY KEY,
  key             TEXT NOT NULL,
  label           TEXT NOT NULL,
  modality        TEXT NOT NULL
                  CHECK (modality IN ('XR','CT','MR','US','MG','DX','NM','PT','DOPPLER','ECHO','USG_OB')),
  body_part       TEXT NOT NULL,
  protocol_scope  TEXT NOT NULL DEFAULT 'Standard',
  template_key    TEXT,
  -- Administrative, not clinical: 'unreviewed' means the scope itself has not been
  -- confirmed by a radiologist against what the clinic actually bills.
  review_state    TEXT NOT NULL DEFAULT 'unreviewed'
                  CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_examinations_key_uq ON clinical_examinations (key) WHERE deleted_at IS NULL;
-- A billed examination must not be ambiguous: one live row per modality+body part+scope.
CREATE UNIQUE INDEX IF NOT EXISTS clinical_examinations_scope_uq
  ON clinical_examinations (modality, LOWER(TRIM(body_part)), LOWER(TRIM(protocol_scope))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_examinations_modality_idx ON clinical_examinations (modality, status);

-- ── 2. Anatomical section, with an explicit ordinal ──────────────────────────
-- §16 forbids alphabetical ordering and requires ordering metadata an
-- administrator can change. Today the clinical order survives as three different
-- string-matching layers with zero integers: a YAML array nothing imports, the
-- array position inside structured_report_templates.sections_json, and a bare
-- anatomical_section TEXT label. An ordinal unique per examination makes the
-- order total, so composition can never depend on Map insertion order.
CREATE TABLE IF NOT EXISTS clinical_anatomical_sections (
  id                BIGSERIAL PRIMARY KEY,
  examination_id    BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  key               TEXT NOT NULL,
  label             TEXT NOT NULL,
  parent_section_id BIGINT REFERENCES clinical_anatomical_sections (id) ON DELETE RESTRICT,
  section_field     TEXT NOT NULL DEFAULT 'findings'
                    CHECK (section_field IN ('findings','impression','recommendation')),
  ordinal           INTEGER NOT NULL,
  emits_heading     BOOLEAN NOT NULL DEFAULT TRUE,
  review_state      TEXT NOT NULL DEFAULT 'unreviewed'
                    CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note       TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version           INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_sections_key_uq ON clinical_anatomical_sections (examination_id, key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clinical_sections_ordinal_uq ON clinical_anatomical_sections (examination_id, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_sections_parent_idx ON clinical_anatomical_sections (parent_section_id);

-- ── 3. Normal observation slot ───────────────────────────────────────────────
-- The baseline sentence an examination asserts by default, as DATA. This is what
-- makes a tile's "replaces this normal" (§2) a resolvable reference instead of the
-- substring match it is today: baselineReplaces is free text compared with
-- String.includes(), which is why 6 tiles currently claim to retire one sentence
-- and 13 unfilled "___" blanks ship to print. level/laterality/region mirror
-- lib/baseline-manifest's slotKey so the TS manifests and the catalogue agree.
CREATE TABLE IF NOT EXISTS clinical_normal_slots (
  id              BIGSERIAL PRIMARY KEY,
  examination_id  BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  section_id      BIGINT REFERENCES clinical_anatomical_sections (id) ON DELETE RESTRICT,
  concept_id      BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  key             TEXT NOT NULL,
  slot_field      TEXT NOT NULL DEFAULT 'findings' CHECK (slot_field IN ('findings','impression')),
  rendered_text   TEXT NOT NULL,
  level           TEXT,
  laterality      TEXT CHECK (laterality IS NULL OR laterality IN ('left','right','bilateral','midline')),
  region          TEXT,
  ordinal         INTEGER NOT NULL DEFAULT 0,
  review_state    TEXT NOT NULL DEFAULT 'unreviewed'
                  CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_normal_slots_key_uq ON clinical_normal_slots (examination_id, key) WHERE deleted_at IS NULL;
-- One normal per anatomical slot, or "which sentence does deselecting restore?"
-- has no single answer. COALESCE because level/laterality are legitimately NULL.
CREATE UNIQUE INDEX IF NOT EXISTS clinical_normal_slots_slot_uq
  ON clinical_normal_slots (examination_id, slot_field, COALESCE(section_id, 0), COALESCE(LOWER(TRIM(level)), ''), COALESCE(LOWER(TRIM(laterality)), ''))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_normal_slots_exam_idx ON clinical_normal_slots (examination_id, ordinal);

-- ── 4. Tile ──────────────────────────────────────────────────────────────────
-- The clickable clinical observation. A tile is NOT a concept: two tiles ("Fazekas
-- grade 1", "Fazekas grade 2") share one concept and one conflict group, and one
-- concept may be offered under several protocol scopes. concept_id is therefore
-- NOT NULL — the engine must be able to say which canonical concept a sentence
-- asserts, which is exactly what radiology_quick_findings cannot do (it has no
-- concept column at all, measured by the C3 audit).
CREATE TABLE IF NOT EXISTS clinical_tiles (
  id                   BIGSERIAL PRIMARY KEY,
  key                  TEXT NOT NULL,
  concept_id           BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  label                TEXT NOT NULL,
  tile_category        TEXT NOT NULL DEFAULT 'abnormal'
                       CHECK (tile_category IN ('normal','abnormal','variant','critical','technique','history','system')),
  findings_text        TEXT NOT NULL DEFAULT '',
  impression_text      TEXT NOT NULL DEFAULT '',
  recommendation_text  TEXT NOT NULL DEFAULT '',
  technique_text       TEXT NOT NULL DEFAULT '',
  -- Mutual exclusion within one concept family ('fazekas', 'hemorrhage'). TEXT to
  -- match the shipped column it migrates from; "one concept, one group" is enforced
  -- by a query-level guard, not a constraint, because grades legitimately share.
  conflict_group       TEXT NOT NULL DEFAULT '',
  review_state         TEXT NOT NULL DEFAULT 'unreviewed'
                       CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note          TEXT,
  provenance_kind      TEXT NOT NULL DEFAULT 'unrecorded'
                       CHECK (provenance_kind IN ('unrecorded','admin','quick_select_seed','content_pack','yaml_pack','migrated','radiologist_authored')),
  provenance_ref       TEXT,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version              INTEGER NOT NULL DEFAULT 1,
  created_by           TEXT,
  updated_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_tiles_key_uq ON clinical_tiles (key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_tiles_concept_idx ON clinical_tiles (concept_id);
CREATE INDEX IF NOT EXISTS clinical_tiles_conflict_idx ON clinical_tiles (conflict_group) WHERE conflict_group <> '' AND deleted_at IS NULL;

-- ── 5. Tile × examination placement ──────────────────────────────────────────
-- Where a tile appears and in what order, per examination. Separate from the tile
-- itself so one tile can serve several protocol scopes without duplicating its
-- clinical wording — duplication is how two copies drift apart.
CREATE TABLE IF NOT EXISTS clinical_tile_examinations (
  id              BIGSERIAL PRIMARY KEY,
  tile_id         BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  examination_id  BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  section_id      BIGINT REFERENCES clinical_anatomical_sections (id) ON DELETE RESTRICT,
  ordinal         INTEGER NOT NULL DEFAULT 0,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_exam_uq ON clinical_tile_examinations (tile_id, examination_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_exam_ordinal_uq ON clinical_tile_examinations (examination_id, COALESCE(section_id, 0), ordinal) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_tile_exam_exam_idx ON clinical_tile_examinations (examination_id, ordinal);

-- ── 6. Tile version snapshot ─────────────────────────────────────────────────
-- Append-only. version on the row itself overwrites, so "what did the radiologist
-- publish?" would be unrecoverable — and a signed report must be able to name the
-- wording it was composed from years later. Nothing here is edited in place.
CREATE TABLE IF NOT EXISTS clinical_tile_versions (
  id            BIGSERIAL PRIMARY KEY,
  tile_id       BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  version       INTEGER NOT NULL,
  snapshot_json JSONB NOT NULL,
  change_note   TEXT,
  published_by  TEXT,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_versions_uq ON clinical_tile_versions (tile_id, version);
CREATE INDEX IF NOT EXISTS clin_tile_versions_tile_idx ON clinical_tile_versions (tile_id, published_at);

-- ── 7. Declarative parameter contract ────────────────────────────────────────
-- Today a tile's parameters are inferred by regex from the sentence prose
-- (quickSelectParameterContract.ts scans /\{(side|severity)\}/), so {level},
-- {value} and {chronicity} are outside the contract entirely and an unanswered
-- token can silently delete its own grammatical chunk. Declaring parameters here —
-- bound to the existing reusable parameter library — makes "requires" a fact
-- about the tile rather than a property of its wording.
CREATE TABLE IF NOT EXISTS clinical_tile_parameters (
  id                 BIGSERIAL PRIMARY KEY,
  tile_id            BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  key                TEXT NOT NULL,
  label              TEXT NOT NULL,
  parameter_group_id BIGINT REFERENCES parameter_groups (id) ON DELETE RESTRICT,
  default_option_id  BIGINT REFERENCES parameter_options (id) ON DELETE RESTRICT,
  data_type          TEXT NOT NULL DEFAULT 'option'
                     CHECK (data_type IN ('option','numeric','text','boolean','laterality','severity','level')),
  is_required        BOOLEAN NOT NULL DEFAULT TRUE,
  allow_multiple     BOOLEAN NOT NULL DEFAULT FALSE,
  unit               TEXT,
  min_value          NUMERIC,
  max_value          NUMERIC,
  ordinal            INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT,
  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_params_key_uq ON clinical_tile_parameters (tile_id, LOWER(TRIM(key))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_tile_params_tile_idx ON clinical_tile_parameters (tile_id, ordinal);

-- ── 8. Tile → normal slot replacement ────────────────────────────────────────
-- Which normals this tile retires, as real foreign keys. The edge table (not a
-- column) because one tile can retire several sentences — "Acute infarct" retires
-- both the parenchyma normal and the DWI normal — and because deselecting must
-- restore exactly what this tile removed, which is the RESTORE half of ownership.
CREATE TABLE IF NOT EXISTS clinical_tile_normal_replacements (
  id              BIGSERIAL PRIMARY KEY,
  tile_id         BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  normal_slot_id  BIGINT NOT NULL REFERENCES clinical_normal_slots (id) ON DELETE RESTRICT,
  ordinal         INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_replaces_uq ON clinical_tile_normal_replacements (tile_id, normal_slot_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_tile_replaces_slot_idx ON clinical_tile_normal_replacements (normal_slot_id);

-- ── 9. Selection relationships ───────────────────────────────────────────────
-- Parent/child, requires, excludes, supersedes. This is the relationship the pack
-- format already declares (`extends`) and the importer silently flattens away, so
-- it has never survived into a table. Exactly one target: a tile, or a concept for
-- rules that must hold however the tile is later split.
CREATE TABLE IF NOT EXISTS clinical_tile_relationships (
  id                 BIGSERIAL PRIMARY KEY,
  tile_id            BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  related_tile_id    BIGINT REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  related_concept_id BIGINT REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  relation_kind      TEXT NOT NULL
                     CHECK (relation_kind IN ('parent_child','requires','excludes','supersedes','combines_with')),
  condition_json     JSONB,
  ordinal            INTEGER NOT NULL DEFAULT 0,
  review_state       TEXT NOT NULL DEFAULT 'unreviewed'
                     CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note        TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,
  CHECK (num_nonnulls(related_tile_id, related_concept_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_rel_uq
  ON clinical_tile_relationships (tile_id, relation_kind, COALESCE(related_tile_id, 0), COALESCE(related_concept_id, 0))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_tile_rel_kind_idx ON clinical_tile_relationships (relation_kind);

-- ── 10. Deterministic combination rules ──────────────────────────────────────
-- "When A and B are both selected, print this one consolidated sentence." This has
-- NO implementation anywhere today: B-02 deliberately made the merge layer
-- incapable of combining (reportFieldMerge.ts appends anything not provably
-- identical), and the richer combo_tiles recipe shape exists only in YAML that
-- nothing imports. Hence the silent gap §9 points at — Fazekas plus another white
-- matter finding yields two separate lines.
CREATE TABLE IF NOT EXISTS clinical_combination_rules (
  id                    BIGSERIAL PRIMARY KEY,
  key                   TEXT NOT NULL,
  examination_id        BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  section_id            BIGINT REFERENCES clinical_anatomical_sections (id) ON DELETE RESTRICT,
  label                 TEXT NOT NULL,
  target_field          TEXT NOT NULL DEFAULT 'impression'
                        CHECK (target_field IN ('findings','impression','recommendation')),
  combined_text         TEXT NOT NULL,
  -- Retire the members' own contributions, or leave them and just add a summary?
  suppress_members      BOOLEAN NOT NULL DEFAULT FALSE,
  -- §12: "when only the liver is abnormal" — the rule must be able to require that
  -- nothing else abnormal is present, so it cannot fire over an unrelated finding.
  requires_only_members BOOLEAN NOT NULL DEFAULT FALSE,
  ordinal               INTEGER NOT NULL DEFAULT 0,
  review_state          TEXT NOT NULL DEFAULT 'unreviewed'
                        CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note           TEXT,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version               INTEGER NOT NULL DEFAULT 1,
  created_by            TEXT,
  updated_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_combo_rules_key_uq ON clinical_combination_rules (examination_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_combo_rules_exam_idx ON clinical_combination_rules (examination_id, target_field, ordinal);

CREATE TABLE IF NOT EXISTS clinical_combination_rule_members (
  id             BIGSERIAL PRIMARY KEY,
  rule_id        BIGINT NOT NULL REFERENCES clinical_combination_rules (id) ON DELETE RESTRICT,
  tile_id        BIGINT REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  concept_id     BIGINT REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  required_value TEXT,
  is_optional    BOOLEAN NOT NULL DEFAULT FALSE,
  ordinal        INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT,
  updated_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  CHECK (num_nonnulls(tile_id, concept_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_combo_member_uq
  ON clinical_combination_rule_members (rule_id, COALESCE(tile_id, 0), COALESCE(concept_id, 0))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_combo_member_rule_idx ON clinical_combination_rule_members (rule_id, ordinal);

-- ── 11. Conditional recommendation rules ─────────────────────────────────────
-- §13: advice is emitted by condition, and when nothing qualifies the section is
-- OMITTED rather than printed as "No recommendations." emit_policy carries that in
-- the data, so omission is a rule the catalogue owns instead of a special case in
-- a component.
CREATE TABLE IF NOT EXISTS clinical_recommendation_rules (
  id              BIGSERIAL PRIMARY KEY,
  key             TEXT NOT NULL,
  examination_id  BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  label           TEXT NOT NULL,
  trigger_kind    TEXT NOT NULL
                  CHECK (trigger_kind IN ('tile_selected','concept_present','parameter_value','only_abnormal_present','no_abnormal_present')),
  tile_id         BIGINT REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  concept_id      BIGINT REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  parameter_key   TEXT,
  parameter_value TEXT,
  advice_text     TEXT NOT NULL,
  priority        TEXT CHECK (priority IS NULL OR priority IN ('routine','urgent','critical')),
  emit_policy     TEXT NOT NULL DEFAULT 'always'
                  CHECK (emit_policy IN ('always','when_no_other','when_only')),
  ordinal         INTEGER NOT NULL DEFAULT 0,
  review_state    TEXT NOT NULL DEFAULT 'unreviewed'
                  CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_rec_rules_key_uq ON clinical_recommendation_rules (examination_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_rec_rules_exam_idx ON clinical_recommendation_rules (examination_id, ordinal);

-- ── 12. Publication ──────────────────────────────────────────────────────────
-- An immutable record of what was live when it was published, and the token the
-- read path caches against. §19 requires unpublished edits to be inert and §23
-- requires caching with correct invalidation; both need a durable "the approved
-- content changed at this point" marker, and neither can be derived from rows that
-- are edited in place.
CREATE TABLE IF NOT EXISTS clinical_publications (
  id              BIGSERIAL PRIMARY KEY,
  examination_id  BIGINT REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  publication_key TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  summary_json    JSONB,
  notes           TEXT,
  published_by    TEXT,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_publications_key_uq ON clinical_publications (publication_key);
CREATE INDEX IF NOT EXISTS clin_publications_exam_idx ON clinical_publications (examination_id, published_at);
