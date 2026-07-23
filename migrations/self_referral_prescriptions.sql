-- Self-referral OPD auto-prescriptions (PCPNDT stabilization PR 2)
--
-- For every self-referral/walk-in Form F test patient, the clinic's
-- sonologist performs a complimentary obstetrical checkup (see the
-- Self-Referral OPD register) and an advice prescription is auto-generated
-- and digitally signed. One prescription per Form F record (UNIQUE), with
-- the signature snapshot and a SHA-256 content hash captured at signing
-- time so later edits to the signature master can never alter an already
-- signed prescription.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS self_referral_prescriptions (
  id                       SERIAL PRIMARY KEY,
  form_f_record_id         INTEGER NOT NULL UNIQUE,
  patient_id               INTEGER,
  patient_name             TEXT NOT NULL DEFAULT '',
  spouse_father            TEXT NOT NULL DEFAULT '',
  age                      TEXT NOT NULL DEFAULT '',
  prescription_date        TEXT NOT NULL DEFAULT '',
  advice_text              TEXT NOT NULL DEFAULT '',
  doctor_name              TEXT NOT NULL DEFAULT '',
  doctor_qualifications    TEXT NOT NULL DEFAULT '',
  doctor_registration_no   TEXT NOT NULL DEFAULT '',
  signature_id             INTEGER,
  signature_image_data_url TEXT,
  content_hash             TEXT NOT NULL DEFAULT '',
  signed_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS self_referral_prescriptions_patient_idx
  ON self_referral_prescriptions (patient_id);
