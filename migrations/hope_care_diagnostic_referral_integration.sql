-- ============================================================================
-- HOPE Hospital ERP → CARE Diagnostics — inter-organisation diagnostic
-- referral platform (Phase 1).
--
-- 100% ADDITIVE. Creates only new integration tables. Does not touch, alter or
-- drop any existing table — in particular none of the frozen accounting tables
-- (bills, payments, vouchers, accounts, expenses) or the core patients / orders
-- / diagnostic_tests / packages / doctors tables. It only REFERENCES those
-- core tables (created earlier in the Drizzle step), never modifies them.
--
-- Safe to run repeatedly: every statement is IF NOT EXISTS / ON CONFLICT.
-- Forward-only. See docs/hope-care-integration/ and HOW_TO_ADD_DB_MIGRATIONS.md.
-- ============================================================================

-- ── Integration partners (inbound service-to-service credentials) ───────────
CREATE TABLE IF NOT EXISTS integration_partners (
  id                    SERIAL PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  direction             TEXT NOT NULL DEFAULT 'inbound',
  key_hash              TEXT,
  key_prefix            TEXT,
  callback_url          TEXT,
  source_org_code       TEXT NOT NULL DEFAULT '',
  destination_org_code  TEXT NOT NULL DEFAULT 'CARE',
  permissions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_per_min    INTEGER NOT NULL DEFAULT 120,
  is_active             BOOLEAN NOT NULL DEFAULT false,
  last_used_at          TIMESTAMPTZ,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_partner_audit_log (
  id            SERIAL PRIMARY KEY,
  partner_id    INTEGER,
  partner_code  TEXT NOT NULL DEFAULT '',
  method        TEXT NOT NULL DEFAULT '',
  path          TEXT NOT NULL DEFAULT '',
  allowed       BOOLEAN NOT NULL DEFAULT false,
  deny_reason   TEXT,
  status_code   TEXT NOT NULL DEFAULT '',
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integration_partner_audit_partner_idx ON integration_partner_audit_log (partner_id);
CREATE INDEX IF NOT EXISTS integration_partner_audit_created_idx ON integration_partner_audit_log (created_at);

-- ── HOPE ↔ CARE patient crosswalk ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS external_patient_links (
  id                SERIAL PRIMARY KEY,
  source_system     TEXT NOT NULL,
  source_patient_id TEXT NOT NULL,
  care_patient_id   INTEGER REFERENCES patients(id),
  link_status       TEXT NOT NULL DEFAULT 'probable',
  match_method      TEXT NOT NULL DEFAULT '',
  confidence        NUMERIC(5,2) NOT NULL DEFAULT 0,
  match_details     TEXT,
  confirmed_by      TEXT,
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS external_patient_links_source_idx ON external_patient_links (source_system, source_patient_id);
CREATE INDEX IF NOT EXISTS external_patient_links_care_idx ON external_patient_links (care_patient_id);
-- At most one CONFIRMED link per (source_system, source_patient_id).
CREATE UNIQUE INDEX IF NOT EXISTS external_patient_links_confirmed_uidx
  ON external_patient_links (source_system, source_patient_id)
  WHERE link_status = 'confirmed';

CREATE TABLE IF NOT EXISTS external_patient_link_events (
  id                SERIAL PRIMARY KEY,
  link_id           INTEGER REFERENCES external_patient_links(id),
  source_system     TEXT NOT NULL DEFAULT '',
  source_patient_id TEXT NOT NULL DEFAULT '',
  care_patient_id   INTEGER,
  event_type        TEXT NOT NULL,
  from_status       TEXT,
  to_status         TEXT,
  actor             TEXT,
  reason            TEXT,
  metadata          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS external_patient_link_events_link_idx ON external_patient_link_events (link_id);

-- ── HOPE ↔ CARE referring-doctor crosswalk ──────────────────────────────────
CREATE TABLE IF NOT EXISTS external_provider_links (
  id                    SERIAL PRIMARY KEY,
  source_system         TEXT NOT NULL,
  source_provider_id    TEXT NOT NULL,
  source_provider_name  TEXT NOT NULL DEFAULT '',
  source_specialization TEXT,
  source_registration_no TEXT,
  care_doctor_id        INTEGER REFERENCES doctors(id),
  link_status           TEXT NOT NULL DEFAULT 'confirmed',
  match_method          TEXT NOT NULL DEFAULT '',
  confidence            NUMERIC(5,2) NOT NULL DEFAULT 0,
  confirmed_by          TEXT,
  confirmed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS external_provider_links_confirmed_uidx
  ON external_provider_links (source_system, source_provider_id)
  WHERE link_status IN ('confirmed', 'created_new');

-- ── Canonical service catalogue mapping (HOPE code/name → CARE test/package) ─
CREATE TABLE IF NOT EXISTS service_catalogue_mappings (
  id                      SERIAL PRIMARY KEY,
  source_system           TEXT NOT NULL,
  source_code             TEXT,
  source_name             TEXT NOT NULL DEFAULT '',
  source_name_normalized  TEXT NOT NULL DEFAULT '',
  source_modality         TEXT,
  care_test_id            INTEGER REFERENCES diagnostic_tests(id),
  care_package_id         INTEGER REFERENCES packages(id),
  care_display_name       TEXT,
  department              TEXT,
  modality                TEXT,
  specimen_type           TEXT,
  mapping_type            TEXT NOT NULL DEFAULT 'one_to_one',
  mapping_status          TEXT NOT NULL DEFAULT 'pending_review',
  confidence              NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  effective_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to            TIMESTAMPTZ,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_by              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS service_catalogue_mappings_code_idx ON service_catalogue_mappings (source_system, source_code);
CREATE INDEX IF NOT EXISTS service_catalogue_mappings_name_idx ON service_catalogue_mappings (source_system, source_name_normalized);
CREATE INDEX IF NOT EXISTS service_catalogue_mappings_status_idx ON service_catalogue_mappings (mapping_status);

CREATE TABLE IF NOT EXISTS service_catalogue_mapping_synonyms (
  id                  SERIAL PRIMARY KEY,
  mapping_id          INTEGER NOT NULL REFERENCES service_catalogue_mappings(id),
  synonym             TEXT NOT NULL,
  synonym_normalized  TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS service_catalogue_mapping_synonyms_uidx
  ON service_catalogue_mapping_synonyms (mapping_id, synonym_normalized);
CREATE INDEX IF NOT EXISTS service_catalogue_mapping_synonyms_norm_idx
  ON service_catalogue_mapping_synonyms (synonym_normalized);

-- ── Diagnostic referrals (header) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diagnostic_referrals (
  id                              SERIAL PRIMARY KEY,
  referral_uuid                   TEXT NOT NULL UNIQUE,
  idempotency_key                 TEXT UNIQUE,
  source_org                      TEXT NOT NULL DEFAULT 'HOPE',
  destination_org                 TEXT NOT NULL DEFAULT 'CARE',
  source_patient_id               TEXT NOT NULL,
  source_encounter_id             TEXT,
  source_prescription_id          TEXT,
  patient_name                    TEXT NOT NULL DEFAULT '',
  patient_first_name              TEXT,
  patient_last_name               TEXT,
  patient_age                     INTEGER,
  patient_age_unit                TEXT DEFAULT 'years',
  patient_dob                     TEXT,
  patient_gender                  TEXT,
  patient_phone                   TEXT,
  patient_address                 TEXT,
  patient_email                   TEXT,
  source_doctor_id                TEXT,
  referring_doctor_name           TEXT,
  referring_doctor_specialization TEXT,
  referring_doctor_reg_no         TEXT,
  department                      TEXT,
  clinical_history                TEXT,
  provisional_diagnosis           TEXT,
  requested_date                  TIMESTAMPTZ,
  priority                        TEXT NOT NULL DEFAULT 'routine',
  pregnancy_status                TEXT,
  attachments                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_status                  TEXT NOT NULL DEFAULT 'not_recorded',
  consent_metadata                JSONB,
  notes                           TEXT,
  status                          TEXT NOT NULL DEFAULT 'RECEIVED_BY_CARE',
  care_patient_id                 INTEGER REFERENCES patients(id),
  patient_link_id                 INTEGER REFERENCES external_patient_links(id),
  care_doctor_id                  INTEGER REFERENCES doctors(id),
  care_order_id                   INTEGER REFERENCES orders(id),
  match_status                    TEXT NOT NULL DEFAULT 'unmatched',
  mapping_status                  TEXT NOT NULL DEFAULT 'unmapped',
  created_by_partner_id           INTEGER REFERENCES integration_partners(id),
  created_by                      TEXT,
  received_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS diagnostic_referrals_status_idx ON diagnostic_referrals (status);
CREATE INDEX IF NOT EXISTS diagnostic_referrals_source_patient_idx ON diagnostic_referrals (source_org, source_patient_id);
CREATE INDEX IF NOT EXISTS diagnostic_referrals_care_patient_idx ON diagnostic_referrals (care_patient_id);
CREATE INDEX IF NOT EXISTS diagnostic_referrals_priority_idx ON diagnostic_referrals (priority);
CREATE INDEX IF NOT EXISTS diagnostic_referrals_received_idx ON diagnostic_referrals (received_at);
CREATE INDEX IF NOT EXISTS diagnostic_referrals_partner_idx ON diagnostic_referrals (created_by_partner_id);

-- ── Diagnostic referral items (per-test state) ──────────────────────────────
CREATE TABLE IF NOT EXISTS diagnostic_referral_items (
  id                  SERIAL PRIMARY KEY,
  referral_id         INTEGER NOT NULL REFERENCES diagnostic_referrals(id),
  line_no             INTEGER NOT NULL DEFAULT 0,
  source_test_code    TEXT,
  source_test_name    TEXT NOT NULL DEFAULT '',
  source_modality     TEXT,
  source_category     TEXT,
  mapping_id          INTEGER REFERENCES service_catalogue_mappings(id),
  care_test_id        INTEGER REFERENCES diagnostic_tests(id),
  care_package_id     INTEGER REFERENCES packages(id),
  care_display_name   TEXT,
  department          TEXT,
  modality            TEXT,
  item_status         TEXT NOT NULL DEFAULT 'prescribed',
  decision            TEXT,
  change_reason       TEXT,
  changed_by          TEXT,
  is_added_by_care    BOOLEAN NOT NULL DEFAULT false,
  care_order_test_id  INTEGER REFERENCES order_tests(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS diagnostic_referral_items_referral_idx ON diagnostic_referral_items (referral_id);
CREATE INDEX IF NOT EXISTS diagnostic_referral_items_status_idx ON diagnostic_referral_items (item_status);
CREATE INDEX IF NOT EXISTS diagnostic_referral_items_test_idx ON diagnostic_referral_items (care_test_id);

-- ── Diagnostic referral events (append-only audit) ──────────────────────────
CREATE TABLE IF NOT EXISTS diagnostic_referral_events (
  id            SERIAL PRIMARY KEY,
  referral_id   INTEGER NOT NULL REFERENCES diagnostic_referrals(id),
  item_id       INTEGER REFERENCES diagnostic_referral_items(id),
  event_type    TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT,
  actor_type    TEXT NOT NULL DEFAULT 'system',
  actor_id      TEXT,
  actor_name    TEXT,
  organisation  TEXT,
  reason        TEXT,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS diagnostic_referral_events_referral_idx ON diagnostic_referral_events (referral_id);
CREATE INDEX IF NOT EXISTS diagnostic_referral_events_created_idx ON diagnostic_referral_events (created_at);

-- ── Transactional outbox (CARE → HOPE) + delivery attempts ──────────────────
CREATE TABLE IF NOT EXISTS integration_outbox (
  id                SERIAL PRIMARY KEY,
  event_id          TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  event_version     TEXT NOT NULL DEFAULT '1.0',
  idempotency_key   TEXT NOT NULL UNIQUE,
  correlation_id    TEXT,
  aggregate_type    TEXT NOT NULL DEFAULT 'diagnostic_referral',
  aggregate_id      TEXT,
  partner_id        INTEGER REFERENCES integration_partners(id),
  source_org        TEXT NOT NULL DEFAULT 'CARE',
  destination_org   TEXT NOT NULL DEFAULT 'HOPE',
  payload           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 8,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at         TIMESTAMPTZ,
  locked_by         TEXT,
  last_error        TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integration_outbox_status_idx ON integration_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS integration_outbox_correlation_idx ON integration_outbox (correlation_id);

CREATE TABLE IF NOT EXISTS integration_delivery_attempts (
  id            SERIAL PRIMARY KEY,
  outbox_id     INTEGER NOT NULL REFERENCES integration_outbox(id),
  attempt_no    INTEGER NOT NULL,
  status        TEXT NOT NULL,
  http_status   INTEGER,
  response_body TEXT,
  error         TEXT,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integration_delivery_attempts_outbox_idx ON integration_delivery_attempts (outbox_id);

-- ── External result links (CARE result ↔ HOPE order) ────────────────────────
CREATE TABLE IF NOT EXISTS external_result_links (
  id                  SERIAL PRIMARY KEY,
  referral_id         INTEGER NOT NULL REFERENCES diagnostic_referrals(id),
  referral_item_id    INTEGER REFERENCES diagnostic_referral_items(id),
  care_order_id       INTEGER,
  care_report_id      INTEGER,
  care_study_id       INTEGER,
  result_type         TEXT NOT NULL DEFAULT 'pathology',
  source_system       TEXT NOT NULL DEFAULT 'HOPE',
  source_order_id     TEXT,
  report_status       TEXT NOT NULL DEFAULT 'final',
  is_critical         BOOLEAN NOT NULL DEFAULT false,
  critical_ack_status TEXT,
  critical_ack_by     TEXT,
  critical_ack_at     TIMESTAMPTZ,
  finalised_at        TIMESTAMPTZ,
  finalising_doctor   TEXT,
  report_ref          TEXT,
  emitted_outbox_id   INTEGER REFERENCES integration_outbox(id),
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS external_result_links_referral_idx ON external_result_links (referral_id);
-- Idempotent result linkage: one link per (item, pathology report) and per
-- (item, radiology study), so the reconciler never double-emits a result.
CREATE UNIQUE INDEX IF NOT EXISTS external_result_links_report_uidx
  ON external_result_links (referral_item_id, care_report_id)
  WHERE care_report_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS external_result_links_study_uidx
  ON external_result_links (referral_item_id, care_study_id)
  WHERE care_study_id IS NOT NULL;

-- ── Feature flag row (server-side gate; default OFF) ────────────────────────
INSERT INTO feature_flags (key, enabled, description)
VALUES ('ff_hope_care_referrals', false, 'HOPE → CARE diagnostic referral integration (inbound API, referral inbox, outbox). Default off.')
ON CONFLICT (key) DO NOTHING;
