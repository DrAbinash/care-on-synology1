-- AI Caller Credentials — Epic 2, Feature 2.1.
-- See lib/db/src/schema/aiCallerCredentials.ts for the design rationale
-- this mirrors. Written by hand against db-patch-entrypoint.sh's
-- idempotent feature-migration path, same as add_knowledge_base.sql —
-- every statement uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS ai_caller_credentials (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  channel TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_caller_credentials_key_hash_idx ON ai_caller_credentials (key_hash);
CREATE INDEX IF NOT EXISTS ai_caller_credentials_channel_idx ON ai_caller_credentials (channel);

CREATE TABLE IF NOT EXISTS ai_caller_audit_log (
  id SERIAL PRIMARY KEY,
  credential_id TEXT,
  credential_name TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code TEXT NOT NULL DEFAULT '',
  allowed BOOLEAN NOT NULL,
  deny_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_caller_audit_log_created_at_idx ON ai_caller_audit_log (created_at);
CREATE INDEX IF NOT EXISTS ai_caller_audit_log_allowed_idx ON ai_caller_audit_log (allowed);
