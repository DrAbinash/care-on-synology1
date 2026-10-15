-- ─────────────────────────────────────────────────────────────────────────────
-- CARE CLINICAL REPORTING ENGINE v4.0 — Stage B: the unified clinical catalogue
--
-- ── WHAT THIS IS ───────────────────────────────────────────────────────────────
-- ADDITIVE AND DORMANT. Fourteen new tables that extend the existing canonical
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
--     Re-runnable any number of times. The two objects that are dropped and recreated
--     are this file's own triggers, on tables that hold nothing but catalogue rows;
--     `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER` is how a trigger is re-written
--     without ALTER, and it cannot lose a production row because no production table
--     carries these triggers.
--   • No foreign key points at a production table, and no production table gains a
--     foreign key pointing here. The catalogue is self-contained plus references to
--     the (equally dormant) catalog tables — the discipline the B1/B2 file already
--     states, kept intact.
--   • CHECK constraints are new for this family. The B1/B2 tables have none, so
--     their enums live only in the service layer — which every SQL content seed
--     (Stage H) bypasses. Enforcing the vocabulary in the database is the point.
--   • Every table-level CHECK, and every foreign key this file adds, is named
--     EXPLICITLY. Unnamed table-level constraints become `<table>_check`, `_check1`,
--     `_check2` in the order they are written, so adding one later silently renames
--     the others — and scripts/audit-migration-ledger.mjs then reports a migration
--     that applied cleanly as RECORDED_BUT_ABSENT because the constraint it looked for
--     is now called something else. Column-level CHECKs keep Postgres's own
--     `<table>_<column>_check`, which is derived from the column name rather than from
--     position; that is stable while a column carries one CHECK, and a second CHECK on
--     the same column must therefore be named. scripts/…schema.test.ts asserts the rule.
--   • Identifier names are kept ≤ 63 bytes: Postgres silently truncates longer
--     ones, and scripts/audit-migration-ledger.mjs then reports a migration that
--     succeeded as a failure because the constraint exists under a different name.
--
-- ── WHAT THE INDEPENDENT REVIEW ADDED (Stage B r2) ─────────────────────────────
-- Ten defect families were reproduced as fifteen executable probes against a database
-- built by the first revision, each inside a rolled-back transaction, before any of this
-- was written. Each is closed by a named object:
--   • A foreign key on section_id did not prove the section belonged to the row's own
--     examination. A brain placement could sit in a lumbar section, a section could
--     take a parent from another examination, and a combination rule could point at
--     another examination's anatomy. Closed by composite foreign keys onto
--     (examination_id, id) — see clinical_slot_section_same_exam_fkey and friends.
--   • A parameter's default option could come from a different parameter group.
--     Closed by clin_tile_param_option_in_group_fkey.
--   • The normal-slot identity index keyed on section + level + laterality and omitted
--     the anatomical structure, so a lumbar spine could hold a disc normal OR a facet
--     normal but not both, while the same claim could be stored twice under two
--     sections. Re-keyed onto the runtime's own slot identity
--     (region | concept | level | laterality) — see section 3.
--   • Placement ordinals were NOT NULL DEFAULT 0 and unique, so adding a second tile
--     to an examination failed, and swapping two neighbours failed. Ordinals are now
--     nullable ("not yet placed"), a placement is never assigned an implicit position,
--     and publication refuses an examination with unplaced tiles.
--   • A relationship could point a tile at itself; a tile could carry no clinical text
--     at all; a combination rule could list only optional members and so fire an
--     impression nobody selected; content_hash could hold prose; min_value could exceed
--     max_value; and the version history could be UPDATEd in place, which silently
--     changed what "version 1 of this tile" meant while leaving a signed report's
--     citation apparently intact. Closed by named CHECKs, by the publication gate (the
--     all-optional rule is a fact about a set of member rows, not about one row), and
--     by clinical_append_only_guard(), which the publication record and the new
--     manifest also use.
--   • Rollback and "which catalogue built this report" had no answer, because a
--     publication recorded a hash and nothing else. This one was found by reading the
--     model, not by a probe. clinical_publication_tiles is the manifest: which tile at
--     which stored version, and it is a real foreign key onto clinical_tile_versions
--     (tile_id, version), so a publication cannot name a wording that was never
--     snapshotted.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Prerequisite: the parameter library's own composite key ───────────────
-- `clinical_tile_parameters` (table 7) must not accept a default answer from a
-- different parameter's option list, and the only way a foreign key can say that is to
-- reference (group_id, id). Adding the key here is additive and forward-only: it changes
-- no column, no data and no existing constraint of the B1/B2 catalog, and the catalog is
-- empty by measured fact (parameter_options holds 0 rows), so nothing can violate it on
-- the way in. It is created before table 7 because a foreign key cannot reference a key
-- that does not exist yet.
CREATE UNIQUE INDEX IF NOT EXISTS parameter_options_group_id_uq ON parameter_options (group_id, id);

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
--
-- ordinal is nullable on purpose: a new section is created before anyone knows where
-- it belongs, and an implicit position (the DEFAULT 0 this file originally had on
-- placements) means the second one added to an examination fails. NULL reads as
-- "not yet placed", which is a fact about the draft rather than a lie about order, and
-- the publication gate refuses to publish an examination with unplaced anatomy.
CREATE TABLE IF NOT EXISTS clinical_anatomical_sections (
  id                BIGSERIAL PRIMARY KEY,
  examination_id    BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  key               TEXT NOT NULL CHECK (key <> ''),
  label             TEXT NOT NULL,
  parent_section_id BIGINT,
  section_field     TEXT NOT NULL DEFAULT 'findings'
                    CHECK (section_field IN ('findings','impression','recommendation')),
  ordinal           INTEGER,
  emits_heading     BOOLEAN NOT NULL DEFAULT TRUE,
  review_state      TEXT NOT NULL DEFAULT 'unreviewed'
                    CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note       TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by        TEXT,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  -- The composite foreign-key target, declared inside this CREATE TABLE because a
  -- foreign key cannot reference a key that does not exist yet and an index created
  -- after this statement is too late for the constraint below. `id` is already unique,
  -- but a foreign key can only reference a key whose leading column is the
  -- examination, so this pair is declared once here and referenced by every table that
  -- carries both an examination and a section.
  CONSTRAINT clinical_sections_exam_id_uq UNIQUE (examination_id, id),
  -- A section of one examination may not be nested inside another examination's
  -- section, and may not nest inside itself. (examination_id, id) is the only target
  -- that can say the first part; a section referencing itself would be an order that
  -- never terminates, which is the second part.
  CONSTRAINT clinical_section_parent_same_exam_fkey
    FOREIGN KEY (examination_id, parent_section_id)
    REFERENCES clinical_anatomical_sections (examination_id, id) ON DELETE RESTRICT,
  CONSTRAINT clinical_sections_ordinal_positive_chk CHECK (ordinal IS NULL OR ordinal > 0),
  CONSTRAINT clinical_sections_parent_not_self_chk CHECK (parent_section_id IS NULL OR parent_section_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_sections_key_uq ON clinical_anatomical_sections (examination_id, key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clinical_sections_ordinal_uq ON clinical_anatomical_sections (examination_id, ordinal) WHERE deleted_at IS NULL AND ordinal IS NOT NULL;
CREATE INDEX IF NOT EXISTS clinical_sections_parent_idx ON clinical_anatomical_sections (parent_section_id);

-- ── 3. Normal observation slot ───────────────────────────────────────────────
-- The baseline sentence an examination asserts by default, as DATA. This is what
-- makes a tile's "replaces this normal" (§2) a resolvable reference instead of the
-- substring match it is today: baselineReplaces is free text compared with
-- String.includes(), which is why 6 tiles currently claim to retire one sentence
-- and 13 unfilled "___" blanks ship to print.
--
-- ── IDENTITY: what makes one normal slot one slot ──────────────────────────────
-- This file originally keyed a slot on (examination, field, section, level,
-- laterality). That is not the identity the reporting runtime uses, and the mismatch
-- broke the catalogue in both directions, both reproduced against a database built by
-- this file:
--
--   • An MRI lumbar spine has one anatomical section at L4-L5 and five legitimate
--     normal statements inside it — disc, facet joints, ligamentum flavum, neural
--     foramina, spinal canal. Under the old key the second one was refused
--     (duplicate key ... clinical_normal_slots_slot_uq), so the catalogue could not
--     hold the normals the examination actually needs.
--   • The same claim — "basal ganglia are normal", one region, one concept, no level,
--     no laterality — could be stored twice, once with a section and once without,
--     because section was in the key. Two rows answering the same question is the
--     duplicate the key existed to prevent.
--
-- The runtime already settled this. lib/baseline-manifest/src/index.ts documents the
-- persisted slot identity as `region | concept | level | laterality`, and
-- buildSlotKey in artifacts/diagnostic-erp/src/lib/observationSlot.ts builds exactly
-- that. So the catalogue keys a normal slot on the same four dimensions, scoped to the
-- examination and the field, and `section_id` becomes placement metadata (where the
-- sentence prints) rather than identity (what the sentence is about). That is also
-- what makes the Doppler case work: patency, flow direction, compressibility and
-- spectral waveform of one vessel are four slots because they are four concepts, not
-- four spellings of one region.
--
-- `key` stays the stable handle the Studio and a published catalogue cite, unique per
-- examination, so a slot can be renamed in wording without changing what it is.
CREATE TABLE IF NOT EXISTS clinical_normal_slots (
  id              BIGSERIAL PRIMARY KEY,
  examination_id  BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  section_id      BIGINT,
  concept_id      BIGINT NOT NULL REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  key             TEXT NOT NULL CHECK (key <> ''),
  slot_field      TEXT NOT NULL DEFAULT 'findings' CHECK (slot_field IN ('findings','impression')),
  rendered_text   TEXT NOT NULL CHECK (rendered_text <> ''),
  level           TEXT,
  laterality      TEXT CHECK (laterality IS NULL OR laterality IN ('left','right','bilateral','midline')),
  region          TEXT,
  ordinal         INTEGER,
  review_state    TEXT NOT NULL DEFAULT 'unreviewed'
                  CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  -- The normal of one examination may not hang off another examination's section.
  CONSTRAINT clinical_slot_section_same_exam_fkey
    FOREIGN KEY (examination_id, section_id)
    REFERENCES clinical_anatomical_sections (examination_id, id) ON DELETE RESTRICT,
  CONSTRAINT clinical_normal_slots_ordinal_positive_chk CHECK (ordinal IS NULL OR ordinal > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_normal_slots_key_uq ON clinical_normal_slots (examination_id, key) WHERE deleted_at IS NULL;
-- One normal per slot, where a slot is the runtime's own identity. Without this,
-- "which sentence does deselecting the abnormal restore?" has no single answer.
-- COALESCE folds the legitimately-NULL dimensions: an absent region is the wildcard
-- the runtime uses (SLOT_WILDCARD), and an absent level or laterality means the
-- statement is not level- or side-specific.
CREATE UNIQUE INDEX IF NOT EXISTS clinical_normal_slots_slot_uq
  ON clinical_normal_slots (
    examination_id, slot_field,
    COALESCE(LOWER(TRIM(region)), '*'),
    concept_id,
    COALESCE(LOWER(TRIM(level)), ''),
    COALESCE(LOWER(TRIM(laterality)), '')
  ) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_normal_slots_exam_idx ON clinical_normal_slots (examination_id, ordinal);
CREATE INDEX IF NOT EXISTS clinical_normal_slots_concept_idx ON clinical_normal_slots (concept_id);

-- ── 4. Tile ──────────────────────────────────────────────────────────────────
-- The clickable clinical observation. A tile is NOT a concept: two tiles ("Fazekas
-- grade 1", "Fazekas grade 2") share one concept and one conflict group, and one
-- concept may be offered under several protocol scopes. concept_id is therefore
-- NOT NULL — the engine must be able to say which canonical concept a sentence
-- asserts, which is exactly what radiology_quick_findings cannot do (it has no
-- concept column at all, measured by the C3 audit).
CREATE TABLE IF NOT EXISTS clinical_tiles (
  id                   BIGSERIAL PRIMARY KEY,
  key                  TEXT NOT NULL CHECK (key <> ''),
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
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by           TEXT,
  updated_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ,
  -- A tile that carries no sentence in any field is a button that does nothing. The
  -- legacy surface has these: rows in radiology_quick_findings whose only content is a
  -- template placeholder. A click that silently produces no text is the defect the v4
  -- engine exists to remove, so it cannot even be stored.
  CONSTRAINT clinical_tiles_carries_some_text_chk
    CHECK (findings_text <> '' OR impression_text <> '' OR recommendation_text <> '' OR technique_text <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_tiles_key_uq ON clinical_tiles (key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_tiles_concept_idx ON clinical_tiles (concept_id);
CREATE INDEX IF NOT EXISTS clinical_tiles_conflict_idx ON clinical_tiles (conflict_group) WHERE conflict_group <> '' AND deleted_at IS NULL;

-- ── 5. Tile × examination placement ──────────────────────────────────────────
-- Where a tile appears and in what order, per examination. Separate from the tile
-- itself so one tile can serve several protocol scopes without duplicating its
-- clinical wording — duplication is how two copies drift apart.
--
-- ORDERING: ordinal is nullable and has no default, because both of those were
-- defects here. Measured against a database built by this file: two placements added
-- to one examination without naming a position both took the implicit 0 and the second
-- insert died on clin_tile_exam_ordinal_uq, so "add a tile to an examination" failed
-- for everyone who did not think to compute a position first; and swapping two
-- neighbours failed on the first UPDATE, because the unique index is checked per row
-- and cannot be deferred while it is a partial index. NULL means "not yet placed":
-- legal in a draft, refused at publication by clinical_publication_gate. A reordering
-- is therefore an unplace-then-place sequence in one transaction — the block goes to
-- NULL first, so no intermediate state can collide, and one writer never sees another's
-- half-moved order. Concurrent edits are serialised by locking the examination row
-- first (SELECT ... FOR UPDATE), which is the same protocol the money paths already
-- use; the unique index then makes any interleaving that did happen a loud failure
-- rather than a silent overwrite.
CREATE TABLE IF NOT EXISTS clinical_tile_examinations (
  id              BIGSERIAL PRIMARY KEY,
  tile_id         BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  examination_id  BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  section_id      BIGINT,
  ordinal         INTEGER,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  -- A tile placed in one examination may not sit in another examination's section.
  CONSTRAINT clin_tile_exam_section_same_exam_fkey
    FOREIGN KEY (examination_id, section_id)
    REFERENCES clinical_anatomical_sections (examination_id, id) ON DELETE RESTRICT,
  CONSTRAINT clin_tile_exam_ordinal_positive_chk CHECK (ordinal IS NULL OR ordinal > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_exam_uq ON clinical_tile_examinations (tile_id, examination_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_exam_ordinal_uq ON clinical_tile_examinations (examination_id, COALESCE(section_id, 0), ordinal) WHERE deleted_at IS NULL AND ordinal IS NOT NULL;
CREATE INDEX IF NOT EXISTS clin_tile_exam_exam_idx ON clinical_tile_examinations (examination_id, ordinal);
CREATE INDEX IF NOT EXISTS clin_tile_exam_tile_idx ON clinical_tile_examinations (tile_id);

-- ── 6. Tile version snapshot ─────────────────────────────────────────────────
-- Append-only. version on the row itself overwrites, so "what did the radiologist
-- publish?" would be unrecoverable — and a signed report must be able to name the
-- wording it was composed from years later. Nothing here is edited in place.
CREATE TABLE IF NOT EXISTS clinical_tile_versions (
  id            BIGSERIAL PRIMARY KEY,
  tile_id       BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  version       INTEGER NOT NULL CHECK (version >= 1),
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
  key                TEXT NOT NULL CHECK (key <> ''),
  label              TEXT NOT NULL,
  parameter_group_id BIGINT REFERENCES parameter_groups (id) ON DELETE RESTRICT,
  default_option_id  BIGINT,
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
  deleted_at         TIMESTAMPTZ,
  -- The default answer must be one of this parameter's own answers. Two foreign keys,
  -- one per column, would accept a severity parameter whose default is a laterality
  -- option from another group — measured: this file accepted exactly that row. The
  -- composite key (group_id, id) is declared on parameter_options below so the
  -- database, not the service layer, owns the pairing.
  CONSTRAINT clin_tile_param_option_in_group_fkey
    FOREIGN KEY (parameter_group_id, default_option_id)
    REFERENCES parameter_options (group_id, id) ON DELETE RESTRICT,
  -- A default option with no group cannot be validated by that foreign key at all
  -- (MATCH SIMPLE skips a partially-NULL key), so the group is required whenever an
  -- option is named.
  CONSTRAINT clin_tile_param_group_when_default_chk
    CHECK (default_option_id IS NULL OR parameter_group_id IS NOT NULL),
  -- A range nobody can satisfy is worse than no range: the value would be refused on
  -- every entry. Measured: min 40 with max 5 stored without complaint.
  CONSTRAINT clin_tile_param_range_chk
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
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
                     CHECK (relation_kind IN ('parent_child','requires','excludes','supersedes','combines_with','coexists')),
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
  -- Named explicitly, like every other table-level CHECK in this file: an unnamed one
  -- becomes clinical_tile_relationships_check, and a second unnamed CHECK silently
  -- renames it. See the SAFETY note above.
  CONSTRAINT clin_tile_rel_single_target_chk CHECK (num_nonnulls(related_tile_id, related_concept_id) = 1),
  -- A tile that excludes, requires or supersedes itself is a rule that can never be
  -- satisfied and never stops firing. Measured: this file stored it without comment.
  -- Cycles across two or more tiles are NOT refused HERE, because a CHECK sees one row and
  -- an author mid-edit is entitled to save a graph that is temporarily cyclic; they are
  -- refused at PUBLICATION by clinical_publication_gate, which is the point where a cycle
  -- would otherwise reach a patient.
  -- 'coexists' is in the vocabulary so that a pair meant to print together is a STATED
  -- relationship rather than the absence of one. With only 'excludes' and 'supersedes'
  -- available, "nothing was declared" and "these two deliberately coexist" are the same set
  -- of rows, and no check can tell them apart — which is precisely how PR #1014's
  -- order-dependent pairs survived: an undeclared relationship is not a decision. Whether a
  -- pair coexists is a radiologist's call (§27), recorded in review_state.
  CONSTRAINT clin_tile_rel_not_self_chk CHECK (related_tile_id IS NULL OR related_tile_id <> tile_id)
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
  key                   TEXT NOT NULL CHECK (key <> ''),
  examination_id        BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  section_id            BIGINT,
  label                 TEXT NOT NULL,
  target_field          TEXT NOT NULL DEFAULT 'impression'
                        CHECK (target_field IN ('findings','impression','recommendation')),
  combined_text         TEXT NOT NULL CHECK (combined_text <> ''),
  -- Retire the members' own contributions, or leave them and just add a summary?
  -- Deliberately NO DEFAULT. The owner's Fazekas case requires one consolidated
  -- Impression with no duplicate; a default of FALSE would print the two member
  -- sentences AND the summary, which is the exact defect this table exists to fix, and
  -- a default is a silent clinical decision. The author states it.
  -- SCOPE, and it is deliberately narrow: this retires the members' contributions to
  -- TARGET_FIELD and to nothing else. Combining two Impressions must never remove the two
  -- anatomical Findings they were built from — those sentences are the evidence the
  -- Impression rests on, and a report that prints a conclusion while withholding its
  -- observations is the failure §27 forbids. The guarantee is structural, not a promise:
  -- this table has one target_field and no column that names a field to suppress, so a
  -- cross-field suppression cannot be stored. An author who wants both fields consolidated
  -- writes two rules, one per field, each with its own precedence.
  suppress_members      BOOLEAN NOT NULL,
  -- §12: "when only the liver is abnormal" — the rule must be able to require that
  -- nothing else abnormal is present, so it cannot fire over an unrelated finding.
  -- Also no default: TRUE and FALSE mean two different things about when a sentence
  -- may be printed, and an omitted column should not choose between them.
  requires_only_members BOOLEAN NOT NULL,
  -- Precedence WITHIN ONE FIELD. Two live rules writing the same field of one examination
  -- at the same position leave the composer free to pick either, which is the same class of
  -- defect as a tile with no anatomical position: the printed report would depend on which
  -- row the database happened to read first. Nullable with no default for exactly the reason
  -- clinical_tile_examinations.ordinal is: a rule under construction has no precedence yet,
  -- and claiming one is an act of authoring, not a side effect of the insert.
  ordinal               INTEGER,
  review_state          TEXT NOT NULL DEFAULT 'unreviewed'
                        CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note           TEXT,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by            TEXT,
  updated_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  -- A rule of one examination may not print into another examination's section.
  CONSTRAINT clin_combo_rule_section_same_exam_fkey
    FOREIGN KEY (examination_id, section_id)
    REFERENCES clinical_anatomical_sections (examination_id, id) ON DELETE RESTRICT,
  CONSTRAINT clin_combo_rules_ordinal_positive_chk CHECK (ordinal IS NULL OR ordinal > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_combo_rules_key_uq ON clinical_combination_rules (examination_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_combo_rules_exam_idx ON clinical_combination_rules (examination_id, target_field, ordinal);
-- One precedence position per (examination, field), among the rules that are actually in
-- force. A deprecated rule keeps its history but stops competing for a position.
CREATE UNIQUE INDEX IF NOT EXISTS clin_combo_rules_field_ordinal_uq
  ON clinical_combination_rules (examination_id, target_field, ordinal)
  WHERE deleted_at IS NULL AND ordinal IS NOT NULL AND status <> 'deprecated';

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
  -- A combination is a statement about a set of observations, and each member names one
  -- of them: either the tile that must be selected, or the concept that must be present.
  CONSTRAINT clin_combo_member_single_target_chk CHECK (num_nonnulls(tile_id, concept_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_combo_member_uq
  ON clinical_combination_rule_members (rule_id, COALESCE(tile_id, 0), COALESCE(concept_id, 0))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_combo_member_rule_idx ON clinical_combination_rule_members (rule_id, ordinal);
-- A combination is a statement about a SET of observations, so it must name at least one
-- observation it requires. A rule whose only members are optional fires against an empty
-- selection and prints a clinical sentence nobody selected — measured: this file stored
-- such a rule without complaint. "Has a required member" is a fact about the member rows
-- rather than about any single row, so it cannot be a CHECK; it is enforced at
-- publication by clinical_publication_gate, and this index is what that lookup uses. The
-- draft state stays legal, because an author adding members one at a time is in the
-- middle of building the rule.
CREATE INDEX IF NOT EXISTS clin_combo_member_required_idx
  ON clinical_combination_rule_members (rule_id) WHERE NOT is_optional AND deleted_at IS NULL;

-- ── 11. Conditional recommendation rules ─────────────────────────────────────
-- §13: advice is emitted by condition, and when nothing qualifies the section is
-- OMITTED rather than printed as "No recommendations." emit_policy carries that in
-- the data, so omission is a rule the catalogue owns instead of a special case in
-- a component.
CREATE TABLE IF NOT EXISTS clinical_recommendation_rules (
  id              BIGSERIAL PRIMARY KEY,
  key             TEXT NOT NULL CHECK (key <> ''),
  examination_id  BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  label           TEXT NOT NULL,
  trigger_kind    TEXT NOT NULL
                  CHECK (trigger_kind IN ('tile_selected','concept_present','parameter_value','only_abnormal_present','no_abnormal_present')),
  tile_id         BIGINT REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  concept_id      BIGINT REFERENCES finding_definitions (id) ON DELETE RESTRICT,
  parameter_key   TEXT,
  parameter_value TEXT,
  advice_text     TEXT NOT NULL CHECK (advice_text <> ''),
  priority        TEXT CHECK (priority IS NULL OR priority IN ('routine','urgent','critical')),
  emit_policy     TEXT NOT NULL DEFAULT 'always'
                  CHECK (emit_policy IN ('always','when_no_other','when_only')),
  ordinal         INTEGER NOT NULL DEFAULT 0,
  review_state    TEXT NOT NULL DEFAULT 'unreviewed'
                  CHECK (review_state IN ('unreviewed','approved','uncertain')),
  review_note     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  -- Every trigger kind names what it looks at: a tile, a concept, or a parameter on the
  -- already-selected observations. A rule that names none is a recommendation that
  -- fires on every report of that examination, which is advice nobody asked for.
  CONSTRAINT clin_rec_rule_has_trigger_target_chk
    CHECK (trigger_kind IN ('only_abnormal_present','no_abnormal_present') OR num_nonnulls(tile_id, concept_id) >= 1),
  -- A parameter condition needs the parameter it conditions on.
  CONSTRAINT clin_rec_rule_param_key_when_value_chk
    CHECK (parameter_value IS NULL OR parameter_key IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_rec_rules_key_uq ON clinical_recommendation_rules (examination_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clin_rec_rules_exam_idx ON clinical_recommendation_rules (examination_id, ordinal);

-- ── 12. Publication ──────────────────────────────────────────────────────────
-- An immutable record of what was live when it was published, and the token the
-- read path caches against. §19 requires unpublished edits to be inert and §23
-- requires caching with correct invalidation; both need a durable "the approved
-- content changed at this point" marker, and neither can be derived from rows that
-- are edited in place.
--
-- content_hash is validated as a lowercase SHA-256 hex digest. Measured: this file
-- stored 'see attached note' in it. A hash is the cache key and the drift detector, so
-- prose in that column silently defeats both — every publication compares unequal to
-- every other, and Stage F's "has the live content changed since this publication?"
-- question stops having an answer.
--
-- catalogue_snapshot is what makes a publication a RESTORABLE STATE and not a list.
-- A manifest of tile versions cannot answer "what did the whole configuration say":
-- the sections and their order, the normal wording, the parameters and their defaults,
-- the replacement and conflict relationships, the combination and recommendation rules
-- and every review state are each edited in place elsewhere, so a historical report's
-- catalogue could not be reassembled from it, and rollback could not be total. One
-- immutable document per publication carries all of it, in TEN domains — examination,
-- sections, normalSlots, tiles, placements, parameters, normalReplacements,
-- relationships, combinationRules (each entry with its own members nested inside) and
-- recommendationRules — which is the twelve questions §1 of the review asks about, with
-- review status and section order carried as fields of the entries they belong to rather
-- than as domains of their own.
--
-- What it does NOT freeze, deliberately: the canonical vocabulary the domains point at by
-- id — finding_definitions, parameter_groups, parameter_options. Those are B1/B2 tables
-- with their own admin-gated lifecycle and their own live content, and freezing them here
-- would put a second copy of the clinic's concept list inside every publication. The
-- consequence is stated rather than hidden: a report published today cites a concept
-- whose label can still be edited tomorrow, so "the exact wording of every sentence" is
-- exact for the tile text and approximate for the option text. If that has to be closed,
-- it is an `eleventh domain + snapshot_version = 2`, which is the reason the version column
-- exists instead of an assumption.
--
-- The shape, the canonical ordering and the hash rule are defined in
-- lib/db/src/cataloguePublicationSnapshot.ts and asserted there by tests, because a
-- serialization convention that lives only in prose is how two publishers disagree about
-- the same catalogue. The hash is sha256 over the canonical text, so drift is detected by
-- recomputing it from the live rows — never by byte-comparing jsonb, whose key order is
-- Postgres' business, not ours.
CREATE TABLE IF NOT EXISTS clinical_publications (
  id                 BIGSERIAL PRIMARY KEY,
  -- NOT NULL, and this is the gate's own integrity, not tidiness. Every check in
  -- clinical_publication_gate() is a statement about one examination's rows, so a
  -- publication with no examination skipped all of them. Measured, not argued: the
  -- previous revision of this file carried `IF exam IS NULL THEN RETURN NEW`, and
  -- clinicalCatalogue.db.test.ts asserted that `INSERT INTO clinical_publications
  -- (publication_key, content_hash) VALUES ('pub.gate.global', <64 hex>)` returns NULL —
  -- i.e. a committed test pinned the bypass as intended behaviour. That row is a citable
  -- "the catalogue was published" record for content no gate ever looked at, which is the
  -- exact hole §4 of the review exists to close. A publication is the frozen state OF an
  -- examination; to publish the whole catalogue is to publish each examination, which also
  -- gives rollback a unit that means something clinically.
  examination_id     BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT,
  publication_key    TEXT NOT NULL CHECK (publication_key <> ''),
  content_hash       TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  -- Which serialization convention produced the document, so a later format can be read
  -- without guessing. Never defaulted to "whatever the newest code assumes".
  snapshot_version   INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version >= 1),
  -- A publication whose snapshot is an empty object answers nothing, which is the failure
  -- this column exists to remove. The gate checks that it actually covers the live rows;
  -- this CHECK only refuses the document that was never filled in.
  catalogue_snapshot JSONB NOT NULL CHECK (catalogue_snapshot <> '{}'::jsonb),
  summary_json       JSONB,
  notes              TEXT,
  published_by       TEXT,
  published_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_publications_key_uq ON clinical_publications (publication_key);
CREATE INDEX IF NOT EXISTS clin_publications_exam_idx ON clinical_publications (examination_id, published_at);

-- ── 13. Publication manifest: which tile, at which stored version ────────────
-- A publication that records only a hash cannot be rolled back and cannot be cited.
-- That was the state this file shipped in: §F of the review asked whether rollback can
-- restore a complete catalogue state and whether a report can name the catalogue
-- version it was composed from, and on the tables above both answers were no. The
-- manifest is the missing link — one row per tile in the published set, pointing at a
-- row of clinical_tile_versions by (tile_id, version), so:
--   • rollback is a re-application of the named versions, not a guess from prose;
--   • a signed report can cite publication_key and resolve the exact wording of every
--     sentence it printed, years later, which is the same guarantee B-10/#944 and
--     #981/#983 were built to give images;
--   • the foreign key onto (tile_id, version) means a publication cannot name a
--     wording that was never snapshotted, and clinical_append_only_guard means the
--     wording it does name cannot be rewritten afterwards.
-- examination_id is not repeated here: it is the publication's own, and a tile that is
-- not placed in that examination is refused by clinical_publication_gate.
CREATE TABLE IF NOT EXISTS clinical_publication_tiles (
  id              BIGSERIAL PRIMARY KEY,
  publication_id  BIGINT NOT NULL REFERENCES clinical_publications (id) ON DELETE RESTRICT,
  tile_id         BIGINT NOT NULL REFERENCES clinical_tiles (id) ON DELETE RESTRICT,
  tile_version    INTEGER NOT NULL CHECK (tile_version >= 1),
  ordinal         INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only a version that was actually snapshotted may be published.
  CONSTRAINT clin_pub_tile_version_fkey
    FOREIGN KEY (tile_id, tile_version)
    REFERENCES clinical_tile_versions (tile_id, version) ON DELETE RESTRICT,
  CONSTRAINT clin_pub_tile_ordinal_positive_chk CHECK (ordinal IS NULL OR ordinal > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS clin_pub_tile_uq ON clinical_publication_tiles (publication_id, tile_id);
CREATE INDEX IF NOT EXISTS clin_pub_tile_tile_idx ON clinical_publication_tiles (tile_id);
CREATE INDEX IF NOT EXISTS clin_pub_tile_pub_idx ON clinical_publication_tiles (publication_id, ordinal);

-- ── 14. Two invariants that are facts about a SET of rows ───────────────────
-- A CHECK sees one row; a foreign key sees one column pair. Three of the rules this
-- catalogue needs are neither:
--
--   1. Publication must refuse an examination whose tiles have no place in the order
--      (§16: order is metadata, and "no metadata yet" is not a printable order).
--   2. A combination rule must name at least one required member, or it prints a
--      clinical sentence against an empty selection.
--   3. A tile may only retire a normal of an examination it is placed in, and a rule
--      may only combine tiles placed in the examination the rule belongs to. Neither
--      is expressible as a foreign key: a tile can be placed in several examinations,
--      so no single column pair names the relationship.
--
-- They are enforced here rather than in the service layer for the same reason the
-- vocabulary CHECKs are: Stage H seeds clinical content with SQL, and a SQL seed does
-- not call the service layer. Both objects are named explicitly, use only features
-- present since PostgreSQL 9.x (plpgsql, RAISE EXCEPTION, statement-level row checks),
-- and are re-runnable: CREATE OR REPLACE for the functions, DROP TRIGGER IF EXISTS then
-- CREATE TRIGGER for the triggers, which is how a trigger is replaced without ALTERing
-- a table. Both fire on tables this migration creates, on rows only the catalogue
-- authoring path writes, so no production path can be blocked by them.
CREATE OR REPLACE FUNCTION clinical_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The version history and the publication record are the catalogue's audit trail:
  -- a signed report cites them to say what it was composed from. If they can be
  -- rewritten, the citation is worth nothing. Measured against a database built by this
  -- file: UPDATE on clinical_tile_versions replaced the stored snapshot, so "version 1
  -- of this tile" silently became different text with no trace.
  RAISE EXCEPTION '% is append-only: % is refused (care-v4 clinical catalogue)',
    TG_TABLE_NAME, TG_OP
    USING HINT = 'Insert a new row instead. A published wording that must change gets a new version, and the publication that cited the old one keeps citing it.';
END;
$$;

CREATE OR REPLACE FUNCTION clinical_publication_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  exam     BIGINT := NEW.examination_id;
  problem  TEXT;
BEGIN
  -- There is deliberately no "if the publication names no examination, allow it" arm
  -- here. The column is NOT NULL, so such a row cannot reach this function at all, and
  -- the reason it is NOT NULL is in the comment on clinical_publications above: an arm
  -- that returns early is an arm every one of the fifteen checks below stops existing for.
  --
  -- 1. Every live tile placed in the examination must have a position, and no
  --    position may be claimed twice. The second cannot happen (the unique index
  --    refuses it), so this is the first.
  SELECT 'tile ' || k.key || ' is placed in this examination with no ordinal'
    INTO problem
    FROM clinical_tile_examinations p
    JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
   WHERE p.examination_id = exam AND p.deleted_at IS NULL AND p.ordinal IS NULL
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §16)', problem;
  END IF;

  -- 2. Anatomy must be ordered and must not be nested inside a retired section.
  SELECT 'section ' || s.key || ' hangs off a section that is soft-deleted or belongs to another examination'
    INTO problem
    FROM clinical_anatomical_sections s
    LEFT JOIN clinical_anatomical_sections par
           ON par.id = s.parent_section_id AND par.deleted_at IS NULL
   WHERE s.examination_id = exam AND s.deleted_at IS NULL
     AND s.parent_section_id IS NOT NULL AND par.id IS NULL
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §16)', problem;
  END IF;

  -- 3. A live combination rule must require at least one observation.
  SELECT 'combination rule ' || r.key || ' has no required member'
    INTO problem
    FROM clinical_combination_rules r
   WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
     AND NOT EXISTS (
       SELECT 1 FROM clinical_combination_rule_members m
        WHERE m.rule_id = r.id AND m.deleted_at IS NULL AND NOT m.is_optional
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §27: no clinical assertion without a selected observation)', problem;
  END IF;

  -- 4. A tile may only retire a normal of an examination it is actually placed in.
  SELECT 'tile ' || k.key || ' retires a normal of an examination it is not placed in'
    INTO problem
    FROM clinical_tile_normal_replacements nr
    JOIN clinical_tiles k ON k.id = nr.tile_id AND k.deleted_at IS NULL
    JOIN clinical_normal_slots ns ON ns.id = nr.normal_slot_id AND ns.deleted_at IS NULL
   WHERE ns.examination_id = exam
     AND NOT EXISTS (
       SELECT 1 FROM clinical_tile_examinations p
        WHERE p.tile_id = nr.tile_id AND p.examination_id = exam AND p.deleted_at IS NULL
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 cross-examination reference)', problem;
  END IF;

  -- 5. A rule may only combine tiles placed in its own examination, and so may a
  --    recommendation.
  SELECT 'combination rule ' || r.key || ' names a tile that is not placed in this examination'
    INTO problem
    FROM clinical_combination_rules r
    JOIN clinical_combination_rule_members m ON m.rule_id = r.id AND m.deleted_at IS NULL
   WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
     AND m.tile_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM clinical_tile_examinations p
        WHERE p.tile_id = m.tile_id AND p.examination_id = exam AND p.deleted_at IS NULL
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 cross-examination reference)', problem;
  END IF;

  SELECT 'recommendation rule ' || r.key || ' names a tile that is not placed in this examination'
    INTO problem
    FROM clinical_recommendation_rules r
   WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
     AND r.tile_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM clinical_tile_examinations p
        WHERE p.tile_id = r.tile_id AND p.examination_id = exam AND p.deleted_at IS NULL
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 cross-examination reference)', problem;
  END IF;

  -- 6. A symmetric relationship declared in one direction only has no winner. 'excludes'
  --    and 'coexists' describe a PAIR, so a row from A to B without its mirror is not a
  --    decision — it is a rule whose result depends on which tile the composer happens to
  --    visit first, which is the mechanism PR #1014 measured. 'supersedes' is deliberately
  --    excluded from this check: it names its own winner, so one direction IS the decision.
  SELECT 'relationship ' || r.relation_kind || ' between ' || a.key || ' and ' || b.key
         || ' is declared in one direction only'
    INTO problem
    FROM clinical_tile_relationships r
    JOIN clinical_tiles a ON a.id = r.tile_id AND a.deleted_at IS NULL
    JOIN clinical_tiles b ON b.id = r.related_tile_id AND b.deleted_at IS NULL
   WHERE r.deleted_at IS NULL
     AND r.relation_kind IN ('excludes','coexists')
     AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                  WHERE p.tile_id = a.id AND p.examination_id = exam AND p.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                  WHERE p.tile_id = b.id AND p.examination_id = exam AND p.deleted_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM clinical_tile_relationships back
        WHERE back.tile_id = b.id AND back.related_tile_id = a.id
          AND back.relation_kind = r.relation_kind AND back.deleted_at IS NULL
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §2: an undeclared winner is a click-order bug waiting to happen)', problem;
  END IF;

  -- 7. An unresolved clinical conflict. Two live tiles in one examination that share a
  --    conflict group and have NO relationship between them in either direction are not
  --    "known to coexist" — nothing says so. Publication is the last point where that can
  --    be caught before a patient sees it, and where the clinical answer is genuinely
  --    undecided it is recorded as 'coexists' with review_state, not left blank.
  WITH placed AS (
    SELECT k.id, k.key, k.conflict_group
      FROM clinical_tile_examinations p
      JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
     WHERE p.examination_id = exam AND p.deleted_at IS NULL AND k.conflict_group <> ''
  )
  SELECT 'tiles ' || a.key || ' and ' || b.key || ' share conflict group ' || a.conflict_group
         || ' and nothing declares how they resolve'
    INTO problem
    FROM placed a
    JOIN placed b ON b.conflict_group = a.conflict_group AND b.id > a.id
   WHERE NOT EXISTS (
     SELECT 1 FROM clinical_tile_relationships r
      WHERE r.deleted_at IS NULL
        AND r.relation_kind IN ('excludes','supersedes','coexists')
        AND ((r.tile_id = a.id AND r.related_tile_id = b.id)
          OR (r.tile_id = b.id AND r.related_tile_id = a.id))
   )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §27: no clinical assertion without a stated relationship)', problem;
  END IF;

  -- 8. Mandatory clinical wording must be reviewed. A tile, a normal, a section heading, or an
  --    active rule that prints a sentence nobody has approved is not publishable content; the
  --    same fact that makes 'uncertain' honest in a draft makes it disqualifying at publication.
  --    A section is in this list because emits_heading prints its label on the page: an
  --    unreviewed heading is wording the patient reads.
  SELECT kind || ' ' || key || ' prints wording that is ' || state
    INTO problem
    FROM (
      SELECT 'tile' AS kind, k.key, k.review_state AS state
        FROM clinical_tile_examinations p
        JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
       WHERE p.examination_id = exam AND p.deleted_at IS NULL AND k.status <> 'deprecated'
         AND k.review_state <> 'approved'
      UNION ALL
      SELECT 'section', s.key, s.review_state
        FROM clinical_anatomical_sections s
       WHERE s.examination_id = exam AND s.deleted_at IS NULL AND s.status <> 'deprecated'
         AND s.emits_heading AND s.review_state <> 'approved'
      UNION ALL
      SELECT 'normal slot', n.key, n.review_state
        FROM clinical_normal_slots n
       WHERE n.examination_id = exam AND n.deleted_at IS NULL AND n.status <> 'deprecated'
         AND n.review_state <> 'approved'
      UNION ALL
      SELECT 'combination rule', r.key, r.review_state
        FROM clinical_combination_rules r
       WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
         AND r.review_state <> 'approved'
      UNION ALL
      SELECT 'recommendation rule', r.key, r.review_state
        FROM clinical_recommendation_rules r
       WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
         AND r.review_state <> 'approved'
    ) u
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §27: unreviewed clinical wording stays in draft)', problem;
  END IF;

  -- 9. Anatomy must be fully ordered. An unplaced tile was check 1; a section with no
  --    position makes the order of everything under it undefined.
  SELECT 'section ' || s.key || ' has no position in its examination'
    INTO problem
    FROM clinical_anatomical_sections s
   WHERE s.examination_id = exam AND s.deleted_at IS NULL AND s.ordinal IS NULL
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §16)', problem;
  END IF;

  -- 10. A normal that was retired cannot be the normal a tile replaces. The cross-check
  --     above silently drops a soft-deleted slot out of its own join, so a replacement
  --     pointing at a retired normal would pass it and then do nothing at all.
  SELECT 'tile ' || k.key || ' retires ' || ns.key || ', a normal that has been retired'
    INTO problem
    FROM clinical_tile_normal_replacements nr
    JOIN clinical_tiles k ON k.id = nr.tile_id AND k.deleted_at IS NULL
    JOIN clinical_normal_slots ns ON ns.id = nr.normal_slot_id
   WHERE ns.examination_id = exam AND nr.deleted_at IS NULL AND ns.deleted_at IS NOT NULL
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4: a replacement whose normal is gone leaves the abnormality printed beside a baseline nobody declared)', problem;
  END IF;

  -- 11. A required choice parameter must have something to choose from. A required
  --     'option'-typed parameter with no default and an empty (or absent) option list is a
  --     sentence with a hole in it: the composer either prints the placeholder or drops the
  --     clause, and both are the defect the parameter contract exists to remove.
  SELECT 'parameter ' || tp.key || ' on tile ' || k.key || ' is required but has no answer to choose from'
    INTO problem
    FROM clinical_tile_examinations p
    JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
    JOIN clinical_tile_parameters tp ON tp.tile_id = k.id AND tp.deleted_at IS NULL
   WHERE p.examination_id = exam AND p.deleted_at IS NULL
     AND tp.is_required AND tp.data_type = 'option'
     AND tp.default_option_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM parameter_options o
        WHERE o.group_id = tp.parameter_group_id AND o.deleted_at IS NULL
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §9: an unanswered required parameter)', problem;
  END IF;

  -- 12. Two active rules may not claim the same required observation for the same field.
  --     Whichever order they are applied in, one of the two consolidated sentences would
  --     have to be discarded, and nothing in the catalogue says which — so precedence is
  --     stated by ordinal (unique per examination and field) AND overlap is refused.
  SELECT 'combination rules ' || a.key || ' and ' || b.key
         || ' both claim a required member for the ' || a.target_field || ' field'
    INTO problem
    FROM clinical_combination_rules a
    JOIN clinical_combination_rules b
      ON b.examination_id = a.examination_id AND b.target_field = a.target_field AND b.id > a.id
     AND b.deleted_at IS NULL AND b.status <> 'deprecated'
   WHERE a.examination_id = exam AND a.deleted_at IS NULL AND a.status <> 'deprecated'
     AND EXISTS (
       SELECT 1
         FROM clinical_combination_rule_members ma
         JOIN clinical_combination_rule_members mb
           ON mb.rule_id = b.id AND mb.deleted_at IS NULL AND NOT mb.is_optional
          AND COALESCE(mb.tile_id, -1) = COALESCE(ma.tile_id, -1)
          AND COALESCE(mb.concept_id, -1) = COALESCE(ma.concept_id, -1)
        WHERE ma.rule_id = a.id AND ma.deleted_at IS NULL AND NOT ma.is_optional
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §3: overlapping combinations have no defined precedence)', problem;
  END IF;

  -- 13. A directional relationship cycle. Refused here rather than at edit time: an author
  --     building a chain is allowed to save a graph that is temporarily wrong, and a CHECK
  --     cannot see a path. 'excludes', 'coexists' and 'combines_with' are symmetric by
  --     definition, so their two-node loops are not cycles in this sense; the three kinds
  --     walked below each point somewhere, and a loop among them means no composition order
  --     exists. The depth cap is a second line of defence, not the detection.
  WITH RECURSIVE placed AS (
    SELECT k.id
      FROM clinical_tile_examinations p
      JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
     WHERE p.examination_id = exam AND p.deleted_at IS NULL
  ), edges AS (
    SELECT r.tile_id AS from_id, r.related_tile_id AS to_id
      FROM clinical_tile_relationships r
      -- Both ends restricted to this examination's placed set, so the cycle reported is
      -- one this examination can actually reach. A loop that runs through a tile not
      -- placed here cannot reorder the print sequence here.
      JOIN placed a ON a.id = r.tile_id
      JOIN placed b ON b.id = r.related_tile_id
     WHERE r.deleted_at IS NULL
       AND r.relation_kind IN ('requires','parent_child','supersedes')
  ), walk AS (
    SELECT e.from_id AS origin, e.to_id AS at, ARRAY[e.from_id] AS path,
           e.to_id = e.from_id AS cyclic
      FROM edges e
    UNION ALL
    SELECT w.origin, e.to_id, w.path || w.at, e.to_id = ANY (w.path || w.at)
      FROM walk w
      JOIN edges e ON e.from_id = w.at
     WHERE NOT w.cyclic AND array_length(w.path, 1) < 20
  )
  SELECT 'tile ' || k.key || ' takes part in a requires/parent_child/supersedes cycle'
    INTO problem
    FROM walk w
    JOIN clinical_tiles k ON k.id = w.origin
   WHERE w.cyclic
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §4: no composition order exists)', problem;
  END IF;

  -- 14. The snapshot is the published state, so it has to agree with the live rows it
  --     claims to freeze. Three separate refusals, because three different publisher
  --     mistakes produce one symptom ("the document is not the configuration"): a domain
  --     missing entirely, a domain of the wrong JSON shape, and a domain that covers the
  --     wrong rows. The third compares on each entry's `identity` — the stable,
  --     examination-scoped handle the publisher writes — and in BOTH directions: a count is
  --     satisfied by the right number of the wrong tiles, and a one-directional set check is
  --     satisfied by a document that also names rows that were never live. Duplicate
  --     identities get their own refusal because a set comparison cannot see them: two
  --     copies of a member of the set are both "in" the set.
  --
  --     Ten domains, because the brief's completeness question names twelve things a
  --     published catalogue has to answer (tile wording, normal wording, sections, section
  --     order, placements, parameters and defaults, replacement rules, conflict
  --     relationships, combination rules, recommendation rules, review status, examination
  --     scope) and a tile-version manifest answers none of them except wording. Parameters,
  --     replacements and relationships are each a separate table with its own lifecycle, so
  --     each is a separate domain; combination members nest inside their rule because a
  --     member of a rule that is not in the document is meaningless, and the flattened set
  --     comparison below still sees every one of them.
  --
  --     Scope of each domain is stated in the FROM clause, and lib/db/src/
  --     cataloguePublicationSnapshot.ts is the only other place those ten predicates exist.
  --     The two are proved to agree by a test that publishes a real builder-produced
  --     document for a real fixture catalogue and then perturbs one domain at a time: SQL
  --     and TypeScript computing different identities cannot survive that.
  --
  --     The hash is deliberately NOT recomputed here. pgcrypto is not installed for this
  --     repository (measured: pg_available_extensions returns no row for it, and no
  --     migration in migrations/ calls digest()), so hash↔document agreement is enforced by
  --     the publisher and asserted in cataloguePublicationSnapshot.test.ts. A CHECK that
  --     cannot compute the value it validates is a comment, not a constraint.
  SELECT 'catalogue_snapshot.' || need.field || ' is '
         || CASE WHEN NOT (NEW.catalogue_snapshot ? need.field) THEN 'absent'
                 ELSE 'a ' || jsonb_typeof(NEW.catalogue_snapshot -> need.field) END
         || ', but every publication requires a ' || need.shape
    INTO problem
    FROM (VALUES
      ('examination',        'object'),
      ('sections',           'array'),
      ('normalSlots',        'array'),
      ('tiles',              'array'),
      ('placements',         'array'),
      ('parameters',         'array'),
      ('normalReplacements', 'array'),
      ('relationships',      'array'),
      ('combinationRules',   'array'),
      ('recommendationRules','array')
    ) AS need(field, shape)
   WHERE NOT (NEW.catalogue_snapshot ? need.field)
      OR jsonb_typeof(NEW.catalogue_snapshot -> need.field) IS DISTINCT FROM need.shape
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §1: a publication that does not carry every domain freezes nothing)', problem;
  END IF;

  -- The arrays below are scoped by examination, but the examination object is not: without
  -- this arm a publisher with one row of each domain in hand could wrap another
  -- examination's scope record around them and every set comparison would still pass,
  -- because each of those comparisons asks "is this live row in the document", never
  -- "whose examination is this document about".
  SELECT 'catalogue_snapshot.examination is examination '
         || coalesce(NEW.catalogue_snapshot -> 'examination' ->> 'id', '<no id>')
         || ' but the publication is for examination ' || exam::text
    INTO problem
   WHERE coalesce(NEW.catalogue_snapshot -> 'examination' ->> 'id', '') <> exam::text
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §1: a snapshot of the wrong examination restores the wrong configuration)', problem;
  END IF;

  -- A rule entry without a "members" array is refused before the comparison below, not by
  -- it: jsonb_array_elements() of a non-array raises, so the publisher would get an opaque
  -- server error instead of a sentence naming the domain it forgot to freeze.
  SELECT 'catalogue_snapshot.combinationRules entry '
         || coalesce(rule.value ->> 'identity', '<no identity>')
         || ' has a "members" field that is '
         || coalesce(jsonb_typeof(rule.value -> 'members'), 'absent')
    INTO problem
    FROM jsonb_array_elements(NEW.catalogue_snapshot -> 'combinationRules') AS rule(value)
   WHERE jsonb_typeof(rule.value -> 'members') IS DISTINCT FROM 'array'
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §3: a rule frozen without its members cannot be restored)', problem;
  END IF;

  WITH live(field, identity) AS (
    SELECT 'sections', s.key
      FROM clinical_anatomical_sections s
     WHERE s.examination_id = exam AND s.deleted_at IS NULL
    UNION ALL
    SELECT 'normalSlots', n.key
      FROM clinical_normal_slots n
     WHERE n.examination_id = exam AND n.deleted_at IS NULL
    UNION ALL
    SELECT 'tiles', k.key
      FROM clinical_tile_examinations p
      JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
     WHERE p.examination_id = exam AND p.deleted_at IS NULL
    UNION ALL
    -- Same live set as 'tiles', different payload: 'tiles' freezes what the observation
    -- says, 'placements' freezes where it prints. They coincide because a placement row
    -- cannot exist without a tile and a published examination cannot carry a tile nobody
    -- placed, which is exactly the redundancy a coverage check has to be told about
    -- rather than allowed to hide.
    SELECT 'placements', k.key
      FROM clinical_tile_examinations p
      JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
     WHERE p.examination_id = exam AND p.deleted_at IS NULL
    UNION ALL
    SELECT 'parameters', tk.key || '/' || tp.key
      FROM clinical_tile_parameters tp
      JOIN clinical_tiles tk ON tk.id = tp.tile_id AND tk.deleted_at IS NULL
     WHERE tp.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                    WHERE p.tile_id = tp.tile_id AND p.examination_id = exam
                      AND p.deleted_at IS NULL)
    UNION ALL
    SELECT 'normalReplacements', k.key || '>' || ns.key
      FROM clinical_tile_normal_replacements nr
      JOIN clinical_tiles k ON k.id = nr.tile_id AND k.deleted_at IS NULL
      JOIN clinical_normal_slots ns ON ns.id = nr.normal_slot_id AND ns.deleted_at IS NULL
     WHERE nr.deleted_at IS NULL AND ns.examination_id = exam
       AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                    WHERE p.tile_id = nr.tile_id AND p.examination_id = exam
                      AND p.deleted_at IS NULL)
    UNION ALL
    -- A relationship is configuration of ITS tile, so it is in scope when that tile is
    -- placed here, whether or not the other end is. An edge pointing outside the
    -- examination is inert for it, and freezing it is what makes restore total. b is
    -- joined without the soft-delete filter because the row exists and names a key; a
    -- relationship to a retired tile still has to come back on restore.
    SELECT 'relationships',
           a.key || '~' || r.relation_kind || '~'
           || COALESCE(b.key, 'concept:' || r.related_concept_id::text)
      FROM clinical_tile_relationships r
      JOIN clinical_tiles a ON a.id = r.tile_id AND a.deleted_at IS NULL
      LEFT JOIN clinical_tiles b ON b.id = r.related_tile_id
     WHERE r.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                    WHERE p.tile_id = r.tile_id AND p.examination_id = exam
                      AND p.deleted_at IS NULL)
    UNION ALL
    SELECT 'combinationRules', r.key
      FROM clinical_combination_rules r
     WHERE r.examination_id = exam AND r.deleted_at IS NULL
    UNION ALL
    SELECT 'combinationMembers',
           cr.key || '/' || COALESCE(k.key, 'concept:' || m.concept_id::text)
      FROM clinical_combination_rule_members m
      JOIN clinical_combination_rules cr ON cr.id = m.rule_id
                                        AND cr.examination_id = exam
                                        AND cr.deleted_at IS NULL
      LEFT JOIN clinical_tiles k ON k.id = m.tile_id
     WHERE m.deleted_at IS NULL
    UNION ALL
    SELECT 'recommendationRules', r.key
      FROM clinical_recommendation_rules r
     WHERE r.examination_id = exam AND r.deleted_at IS NULL
  ), doc(field, identity) AS (
    SELECT f.field, value ->> 'identity'
      FROM (VALUES ('sections'),('normalSlots'),('tiles'),('placements'),('parameters'),
                   ('normalReplacements'),('relationships'),('combinationRules'),
                   ('recommendationRules')) AS f(field)
     CROSS JOIN LATERAL jsonb_array_elements(NEW.catalogue_snapshot -> f.field) AS v(value)
    UNION ALL
    SELECT 'combinationMembers', member.value ->> 'identity'
      FROM jsonb_array_elements(NEW.catalogue_snapshot -> 'combinationRules') AS rule(value)
     CROSS JOIN LATERAL jsonb_array_elements(rule.value -> 'members') AS member(value)
  )
  , diff AS (
    SELECT 'omits' AS kind, l.field, l.identity
      FROM live l
     WHERE NOT EXISTS (SELECT 1 FROM doc d
                        WHERE d.field = l.field AND d.identity = l.identity)
    UNION ALL
    SELECT 'names', d.field, d.identity
      FROM doc d
     WHERE NOT EXISTS (SELECT 1 FROM live l
                        WHERE l.field = d.field AND l.identity = d.identity)
    UNION ALL
    SELECT 'duplicates', d.field, d.identity
      FROM doc d GROUP BY d.field, d.identity HAVING count(*) > 1
  )
  -- coalesce on the identity is load-bearing: an entry carrying no "identity" field
  -- compares unequal to every live row, so it is correctly reported as non-live — but
  -- '… names the non-live row ' || NULL is NULL, which sets problem to NULL, and the very
  -- defect this statement exists to catch would walk straight through the IF below.
  SELECT 'catalogue_snapshot.' || diff.field || ' '
         || CASE diff.kind
              WHEN 'omits' THEN 'omits the live row '
              WHEN 'names' THEN 'names the non-live row '
              ELSE 'duplicates the row '
            END
         || coalesce(diff.identity, '<entry with no identity>')
    INTO problem
    FROM diff
   -- Deterministic, and not for cosmetics: a diff can hold many rows, and a report that names a
   -- different domain on each run of the same broken document cannot be asserted against. So the
   -- refusal is always the alphabetically-first domain, then kind, then identity — which is why
   -- deleting a combination rule reports its orphaned members first.
   ORDER BY diff.field, diff.kind, diff.identity
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §1: a publication must freeze exactly the examination''s live row set, and a duplicated entry makes one catalogue hash differently depending on the publisher''s loop order)', problem;
  END IF;

  -- 15. An unsatisfiable recommendation trigger. 'parameter_value' reads a parameter off
  --     a tile: with no tile there is nothing to read it from, and with a parameter key
  --     the tile does not define the condition can never become true. Either way the
  --     advice is silent forever while the catalogue says it fires, which is the failure
  --     mode §23 of the plan assigns to the runtime but is fully decidable from the rows
  --     at publication time.
  SELECT 'recommendation rule ' || r.key
         || ' conditions on a parameter but names no tile to read it from'
    INTO problem
    FROM clinical_recommendation_rules r
   WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
     AND r.trigger_kind = 'parameter_value' AND r.tile_id IS NULL
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §4: an unsatisfiable recommendation trigger)', problem;
  END IF;

  SELECT 'recommendation rule ' || r.key || ' conditions on parameter ' || r.parameter_key
         || ', which tile ' || k.key || ' does not define'
    INTO problem
    FROM clinical_recommendation_rules r
    JOIN clinical_tiles k ON k.id = r.tile_id AND k.deleted_at IS NULL
   WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
     AND r.trigger_kind = 'parameter_value'
     AND r.parameter_key IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM clinical_tile_parameters tp
        WHERE tp.tile_id = r.tile_id AND tp.deleted_at IS NULL
          AND tp.key = r.parameter_key
     )
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §4: an unsatisfiable recommendation trigger)', problem;
  END IF;

  -- 16. Every rule in force must state its precedence. A placed tile (check 1) and a section
  --     (check 9) already have to say where they sit; a combination rule was the third ordering
  --     object and the only one a publication could freeze without a position. Two rules of one
  --     field with no ordinals are applied in whatever order the reader's scan produces, and one
  --     rule with no ordinal leaves the same hole for the next author to fall into: the frozen
  --     document would say "these observations consolidate into this sentence" and stay silent on
  --     where that sentence belongs, so the restoring composer invents a tiebreak and the
  --     invention becomes the configuration. Nullable in the table because a rule under
  --     construction has not been placed yet — the refusal is at publication, like check 1.
  --     The predicate is `status <> 'deprecated'` for the same reason the unique index and check
  --     12 use it: the three must not disagree about who is in force.
  SELECT 'combination rule ' || r.key || ' has no stated precedence for the ' || r.target_field || ' field'
    INTO problem
    FROM clinical_combination_rules r
   WHERE r.examination_id = exam AND r.deleted_at IS NULL AND r.status <> 'deprecated'
     AND r.ordinal IS NULL
   LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'clinical catalogue cannot be published: % (care-v4 §3: no composition order for an unplaced rule)', problem;
  END IF;

  RETURN NEW;
END;
$$;

-- DROP then CREATE, because Postgres has no CREATE OR REPLACE TRIGGER before 14 and the
-- clinic builds on 16: IF NOT EXISTS would be wrong here (a stale trigger body from an
-- earlier revision of this file must not survive).
DROP TRIGGER IF EXISTS clin_tile_versions_append_only ON clinical_tile_versions;
CREATE TRIGGER clin_tile_versions_append_only
  BEFORE UPDATE OR DELETE ON clinical_tile_versions
  FOR EACH ROW EXECUTE FUNCTION clinical_append_only_guard();

DROP TRIGGER IF EXISTS clin_publications_append_only ON clinical_publications;
CREATE TRIGGER clin_publications_append_only
  BEFORE UPDATE OR DELETE ON clinical_publications
  FOR EACH ROW EXECUTE FUNCTION clinical_append_only_guard();

-- The manifest is part of the citation, not a cache of it: if a manifest row could be
-- re-pointed at a different tile version, "this report was composed from publication
-- P, which named version 3" would stop meaning anything.
DROP TRIGGER IF EXISTS clin_pub_tiles_append_only ON clinical_publication_tiles;
CREATE TRIGGER clin_pub_tiles_append_only
  BEFORE UPDATE OR DELETE ON clinical_publication_tiles
  FOR EACH ROW EXECUTE FUNCTION clinical_append_only_guard();

-- DEFERRABLE so a bulk Stage-H seed can SET CONSTRAINTS ... DEFERRED and write the
-- bundle in any order; INITIALLY IMMEDIATE so the default is that the refusal lands on
-- the INSERT itself. A gate that only fires at COMMIT cannot be tested by a transaction
-- that rolls back, and every database test in this family rolls back.
DROP TRIGGER IF EXISTS clin_publication_gate ON clinical_publications;
CREATE CONSTRAINT TRIGGER clin_publication_gate
  AFTER INSERT ON clinical_publications
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION clinical_publication_gate();
