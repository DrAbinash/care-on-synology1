-- Emergency Billing reconciliation (CARE / DS1522+).
-- Does NOT create an emergency billing database. DS225+ uses a separate volume.
-- Idempotency key: emergency_transaction_uuid (unique).

CREATE TABLE IF NOT EXISTS emergency_reconciliation_batches (
  id serial PRIMARY KEY,
  batch_uuid text NOT NULL UNIQUE,
  emergency_session_uuid text,
  source_nas text,
  import_method text NOT NULL,
  supplied_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  already_imported_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  skipped_review_count integer NOT NULL DEFAULT 0,
  result_json jsonb,
  imported_by text NOT NULL,
  imported_by_user_id integer,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_imported_transactions (
  id serial PRIMARY KEY,
  emergency_transaction_uuid text NOT NULL,
  original_emg_bill_number text NOT NULL,
  emergency_session_uuid text,
  care_bill_id integer REFERENCES bills(id),
  care_patient_id integer REFERENCES patients(id),
  match_class text,
  import_method text NOT NULL,
  batch_id integer REFERENCES emergency_reconciliation_batches(id),
  original_created_at timestamptz,
  original_staff text,
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  payload_json jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS emergency_imported_txn_uuid_uq
  ON emergency_imported_transactions (emergency_transaction_uuid);

CREATE INDEX IF NOT EXISTS emergency_imported_txn_bill_idx
  ON emergency_imported_transactions (care_bill_id);

CREATE INDEX IF NOT EXISTS emergency_imported_txn_emg_no_idx
  ON emergency_imported_transactions (original_emg_bill_number);

CREATE TABLE IF NOT EXISTS emergency_nas_config (
  id serial PRIMARY KEY,
  base_url text,
  fetch_token text,
  fetch_token_set boolean NOT NULL DEFAULT false,
  last_fetch_at timestamptz,
  last_master_push_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE emergency_nas_config ADD COLUMN IF NOT EXISTS fetch_token text;

INSERT INTO emergency_nas_config (id, base_url)
SELECT 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM emergency_nas_config WHERE id = 1);
