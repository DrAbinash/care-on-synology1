-- Payment Gateway Diagnostics — ICICI Orange Pay troubleshooting dashboard.
-- See lib/db/src/schema/paymentGatewayDiagnostics.ts for the design rationale.
-- Written by hand against db-patch-entrypoint.sh's idempotent feature-migration
-- path, same as add_ai_caller_credentials.sql — every statement uses IF NOT EXISTS.
--
-- Diagnostic/observability data only. Does not participate in billing
-- calculations and does not gate the payment flow. Safe to add, safe to
-- prune later, does not touch any existing table.

CREATE TABLE IF NOT EXISTS payment_gateway_diagnostics (
  id SERIAL PRIMARY KEY,

  gateway TEXT NOT NULL DEFAULT 'icici',
  stage TEXT NOT NULL,
  merchant_txn_no TEXT,
  booking_ref TEXT,

  success BOOLEAN NOT NULL DEFAULT FALSE,
  http_status INTEGER,
  response_code TEXT,
  response_message TEXT,

  request_url TEXT,
  request_payload TEXT,
  request_headers TEXT,

  response_body TEXT,
  redirect_uri TEXT,
  tran_ctx TEXT,
  secure_hash_masked TEXT,

  amount TEXT,
  currency TEXT DEFAULT 'INR',
  merchant_id TEXT,
  aggregator_id TEXT,
  return_url TEXT,
  callback_url TEXT,
  public_base_url TEXT,
  client_ip TEXT,
  forwarded_for TEXT,
  user_agent TEXT,
  referer TEXT,
  origin TEXT,

  git_commit TEXT,
  docker_image_version TEXT,
  build_timestamp TEXT,
  environment TEXT,

  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pg_diag_gateway_idx ON payment_gateway_diagnostics (gateway);
CREATE INDEX IF NOT EXISTS pg_diag_stage_idx ON payment_gateway_diagnostics (stage);
CREATE INDEX IF NOT EXISTS pg_diag_success_idx ON payment_gateway_diagnostics (success);
CREATE INDEX IF NOT EXISTS pg_diag_merchant_txn_idx ON payment_gateway_diagnostics (merchant_txn_no);
CREATE INDEX IF NOT EXISTS pg_diag_created_idx ON payment_gateway_diagnostics (created_at);
