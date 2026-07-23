-- ABDM / ABHA integration scaffold (additive, idempotent).
--
-- Stores a patient's ABHA identity, the CARE records ("care contexts") linked
-- to it for discovery in the patient's PHR app, consent artefacts granted by
-- the ABDM Consent Manager, and an audit log of gateway interactions.
--
-- Inert until ABDM_ENABLED=true and gateway credentials are configured; these
-- tables simply stay empty otherwise. Nothing here changes existing behaviour.
-- References only patients (created in the drizzle baseline) plus these tables.

-- A patient's ABHA (Ayushman Bharat Health Account) identity.
CREATE TABLE IF NOT EXISTS abha_links (
  id            SERIAL PRIMARY KEY,
  patient_id    INTEGER NOT NULL REFERENCES patients(id),
  abha_number   TEXT,                       -- 14-digit, formatted XX-XXXX-XXXX-XXXX
  abha_address  TEXT,                       -- e.g. asha@sbx / asha@abdm
  name          TEXT,
  gender        TEXT,
  year_of_birth INTEGER,
  status        TEXT NOT NULL DEFAULT 'linked',   -- linked | unlinked | pending
  linked_via    TEXT,                       -- aadhaar-otp | mobile-otp | demographic
  verified      BOOLEAN NOT NULL DEFAULT false,   -- confirmed via the gateway
  raw           JSONB,                      -- gateway response snapshot
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abha_links_patient_idx ON abha_links(patient_id);
-- At most one link per (patient, abha_address); one row per abha_number globally.
CREATE UNIQUE INDEX IF NOT EXISTS abha_links_patient_address_uq
  ON abha_links(patient_id, abha_address) WHERE abha_address IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS abha_links_number_uq
  ON abha_links(abha_number) WHERE abha_number IS NOT NULL;

-- CARE records made discoverable in the patient's PHR app under their ABHA.
CREATE TABLE IF NOT EXISTS abdm_care_contexts (
  id              SERIAL PRIMARY KEY,
  abha_link_id    INTEGER NOT NULL REFERENCES abha_links(id),
  patient_id      INTEGER NOT NULL REFERENCES patients(id),
  care_context_ref TEXT NOT NULL,           -- stable CARE ref, e.g. order:ORD-2026-0001
  display         TEXT NOT NULL,            -- human label shown to the patient
  hi_type         TEXT NOT NULL DEFAULT 'DiagnosticReport',
  linked          BOOLEAN NOT NULL DEFAULT false,  -- pushed to the gateway yet
  linked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abdm_care_contexts_patient_idx ON abdm_care_contexts(patient_id);
CREATE UNIQUE INDEX IF NOT EXISTS abdm_care_contexts_ref_uq
  ON abdm_care_contexts(abha_link_id, care_context_ref);

-- Consent artefacts granted by the ABDM Consent Manager that authorise sharing.
CREATE TABLE IF NOT EXISTS abdm_consent_artefacts (
  id              SERIAL PRIMARY KEY,
  consent_id      TEXT NOT NULL,            -- gateway consent artefact id
  patient_id      INTEGER REFERENCES patients(id),
  abha_address    TEXT,
  purpose_code    TEXT,
  purpose_text    TEXT,
  hiu_id          TEXT,                     -- health information user requesting
  status          TEXT NOT NULL DEFAULT 'REQUESTED', -- REQUESTED|GRANTED|DENIED|EXPIRED|REVOKED
  hi_types        TEXT,                     -- comma-separated HI types
  date_range_from TIMESTAMPTZ,
  date_range_to   TIMESTAMPTZ,
  expiry          TIMESTAMPTZ,
  granted_at      TIMESTAMPTZ,
  raw             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS abdm_consent_artefacts_consent_uq ON abdm_consent_artefacts(consent_id);
CREATE INDEX IF NOT EXISTS abdm_consent_artefacts_patient_idx ON abdm_consent_artefacts(patient_id);
CREATE INDEX IF NOT EXISTS abdm_consent_artefacts_status_idx ON abdm_consent_artefacts(status);

-- Audit log of every gateway interaction (outbound calls + inbound callbacks).
CREATE TABLE IF NOT EXISTS abdm_gateway_log (
  id             SERIAL PRIMARY KEY,
  direction      TEXT NOT NULL,             -- out | in
  endpoint       TEXT NOT NULL,
  request_id     TEXT,
  correlation_id TEXT,
  status_code    INTEGER,
  ok             BOOLEAN NOT NULL DEFAULT false,
  summary        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abdm_gateway_log_created_idx ON abdm_gateway_log(created_at);
