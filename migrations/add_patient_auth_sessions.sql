-- ============================================================================
-- Patient auth: server-side OTP challenges + sessions for the public
-- booking app — remediation for SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE.
-- ============================================================================
-- Additive + idempotent. A phone number alone must never unlock bookings or
-- lab reports: the patient proves control of the phone via an OTP delivered
-- out-of-band (WhatsApp), which mints a server-side session token (same model
-- as portal_sessions, scoped to a phone). OTP codes are stored only as
-- SHA-256 hashes and are never echoed in any API response.
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS patient_otp_codes;
--   DROP TABLE IF EXISTS patient_sessions;
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_otp_codes (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_otp_codes_phone_idx ON patient_otp_codes (phone);

CREATE TABLE IF NOT EXISTS patient_sessions (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_sessions_phone_idx ON patient_sessions (phone);
