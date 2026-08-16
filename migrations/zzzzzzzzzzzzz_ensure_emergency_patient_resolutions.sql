-- Production drift: zzzzzzzzzzz_emergency_billing_reconciliation.sql is marked
-- applied in schema_migrations, but care-schema-verify still reports
-- emergency_patient_resolutions missing. Re-assert CREATE TABLE IF NOT EXISTS
-- so emergency patient-resolve inserts cannot 500. Safe to re-run; no data rewrite.

CREATE TABLE IF NOT EXISTS emergency_patient_resolutions (
  id serial PRIMARY KEY,
  emergency_transaction_uuid text NOT NULL,
  action text NOT NULL,
  care_patient_id integer REFERENCES patients(id),
  care_patient_label text,
  resolved_by_staff_id integer,
  resolved_by_staff_name text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  note text
);

CREATE UNIQUE INDEX IF NOT EXISTS emergency_patient_resolutions_uuid_uq
  ON emergency_patient_resolutions (emergency_transaction_uuid);
