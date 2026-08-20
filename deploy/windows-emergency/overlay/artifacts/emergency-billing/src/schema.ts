export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_services (
  id integer PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  price numeric(12,2) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS cached_doctors (
  id integer PRIMARY KEY,
  name text NOT NULL,
  specialization text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cached_patients (
  id integer PRIMARY KEY,
  patient_id text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  gender text NOT NULL DEFAULT '',
  date_of_birth text,
  age_value integer,
  age_unit text
);
CREATE INDEX IF NOT EXISTS cached_patients_phone_idx ON cached_patients (phone);
CREATE INDEX IF NOT EXISTS cached_patients_name_idx ON cached_patients (lower(first_name), lower(last_name));
CREATE INDEX IF NOT EXISTS cached_patients_uhid_idx ON cached_patients (patient_id);

CREATE TABLE IF NOT EXISTS cached_staff (
  id integer PRIMARY KEY,
  name text NOT NULL,
  username text NOT NULL,
  role text NOT NULL,
  pin_hash text NOT NULL,
  max_discount numeric(8,2) NOT NULL DEFAULT 0,
  permissions text
);

CREATE TABLE IF NOT EXISTS cached_discount_reasons (
  reason text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS emergency_sessions (
  uuid text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by_staff_id integer NOT NULL,
  started_by_staff_name text NOT NULL,
  reason text NOT NULL,
  workstation text,
  ended_at timestamptz,
  ended_by_staff_id integer,
  ended_by_staff_name text
);

CREATE TABLE IF NOT EXISTS emergency_transactions (
  uuid text PRIMARY KEY,
  bill_number text NOT NULL UNIQUE,
  session_uuid text NOT NULL REFERENCES emergency_sessions(uuid),
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_staff_id integer NOT NULL,
  created_by_staff_name text NOT NULL,
  voided_at timestamptz,
  voided_by_staff_name text,
  void_reason text,
  payload_json jsonb NOT NULL,
  care_bill_id integer,
  reconciled_at timestamptz
);

CREATE TABLE IF NOT EXISTS emergency_audit (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  staff_id integer,
  staff_name text NOT NULL,
  action text NOT NULL,
  entity_uuid text,
  detail text,
  ip text
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token text PRIMARY KEY,
  staff_id integer NOT NULL,
  staff_name text NOT NULL,
  role text NOT NULL,
  max_discount numeric(8,2) NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS emergency_txn_session_idx ON emergency_transactions (session_uuid);
CREATE INDEX IF NOT EXISTS emergency_txn_status_idx ON emergency_transactions (status);
CREATE INDEX IF NOT EXISTS emergency_audit_at_idx ON emergency_audit (at);

-- Windows Emergency CARE: per-record push/reconcile metadata (additive, idempotent).
ALTER TABLE emergency_transactions ADD COLUMN IF NOT EXISTS sync_status text;
ALTER TABLE emergency_transactions ADD COLUMN IF NOT EXISTS sync_error text;
ALTER TABLE emergency_transactions ADD COLUMN IF NOT EXISTS synced_at timestamptz;
ALTER TABLE emergency_transactions ADD COLUMN IF NOT EXISTS source_device_id text;
ALTER TABLE emergency_transactions ADD COLUMN IF NOT EXISTS care_destination_id integer;
ALTER TABLE emergency_transactions ADD COLUMN IF NOT EXISTS sync_detail jsonb;
`;
