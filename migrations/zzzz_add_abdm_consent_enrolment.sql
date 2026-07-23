-- =============================================================================
-- Migration: ABDM/ABHA consent-request lifecycle + ABHA enrolment sessions.
--
-- Additive extension of the existing ABDM scaffold (add_abdm_abha_integration.sql).
-- Adds the HIU-initiated consent REQUEST side (the existing
-- abdm_consent_artefacts table is receive-only) plus OTP enrolment sessions.
-- Self-contained (no FK to other tables), named zzzz_* to sort last. Idempotent
-- DDL-add only. Feature-flagged OFF (ff_abdm_abha); real gateway calls still
-- require ABDM_ENABLED + credentials at runtime.
-- =============================================================================

CREATE TABLE IF NOT EXISTS abdm_consent_requests (
  id            serial PRIMARY KEY,
  request_id    text        NOT NULL,
  patient_id    integer,
  abha_address  text,
  purpose_code  text        NOT NULL DEFAULT 'CAREMGT',
  purpose_text  text,
  hi_types      text,
  date_from     timestamptz,
  date_to       timestamptz,
  expiry        timestamptz,
  status        text        NOT NULL DEFAULT 'REQUESTED', -- REQUESTED | GRANTED | DENIED | REVOKED | EXPIRED
  consent_id    text,
  initiated_by  text,
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS abdm_consent_requests_request_uq ON abdm_consent_requests (request_id);
CREATE INDEX IF NOT EXISTS abdm_consent_requests_status_idx        ON abdm_consent_requests (status);
CREATE INDEX IF NOT EXISTS abdm_consent_requests_patient_idx       ON abdm_consent_requests (patient_id);

CREATE TABLE IF NOT EXISTS abha_enrolment_sessions (
  id                serial PRIMARY KEY,
  txn_id            text        NOT NULL,
  patient_id        integer,
  method            text        NOT NULL,               -- aadhaar-otp | mobile-otp
  identifier_last4  text,                                -- last 4 only, never the full identifier
  status            text        NOT NULL DEFAULT 'pending', -- pending | otp_sent | verified | created | failed
  step              text        NOT NULL DEFAULT 'otp_requested',
  scope             text,
  abha_link_id      integer,
  last_error        text,
  raw               jsonb,
  expires_at        timestamptz,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS abha_enrolment_sessions_txn_uq   ON abha_enrolment_sessions (txn_id);
CREATE INDEX IF NOT EXISTS abha_enrolment_sessions_patient_idx     ON abha_enrolment_sessions (patient_id);

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_abdm_abha', FALSE, 'ABDM/ABHA health-ID + consent (enrolment sessions, consent request lifecycle); gateway calls also need ABDM_ENABLED')
ON CONFLICT (key) DO NOTHING;
