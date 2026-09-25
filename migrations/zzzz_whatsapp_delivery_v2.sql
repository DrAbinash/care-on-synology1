-- WhatsApp Delivery v2 (Lane 1 = wa.me staff-click only; no Meta/Cloud API).
-- Additive only.

-- Patient consent on master
ALTER TABLE patients ADD COLUMN IF NOT EXISTS whatsapp_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS whatsapp_consented_by TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS whatsapp_consented_at TIMESTAMPTZ;

-- Clinic delivery settings
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS whatsapp_delivery_routing TEXT NOT NULL DEFAULT 'patient_only';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS whatsapp_auto_offer_after_print BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS whatsapp_clicktochat_number TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS whatsapp_remember_station_choice BOOLEAN NOT NULL DEFAULT TRUE;

-- Staff-click delivery queue (pending → sent)
CREATE TABLE IF NOT EXISTS wa_delivery_queue (
  id                  SERIAL PRIMARY KEY,
  kind                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  patient_phone       TEXT NOT NULL DEFAULT '',
  doctor_phone        TEXT NOT NULL DEFAULT '',
  prefilled_message   TEXT NOT NULL DEFAULT '',
  record_id           TEXT NOT NULL DEFAULT '',
  patient_name        TEXT NOT NULL DEFAULT '',
  booking_ref         TEXT NOT NULL DEFAULT '',
  source              TEXT NOT NULL DEFAULT '',
  created_by_name     TEXT NOT NULL DEFAULT '',
  sent_by_name        TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_delivery_queue_status_idx ON wa_delivery_queue (status);
CREATE INDEX IF NOT EXISTS wa_delivery_queue_kind_idx ON wa_delivery_queue (kind);

-- Delivery audit (owner Settings → Audit)
CREATE TABLE IF NOT EXISTS wa_delivery_audit (
  id                SERIAL PRIMARY KEY,
  actor             TEXT NOT NULL DEFAULT '',
  kind              TEXT NOT NULL,
  record_id         TEXT NOT NULL DEFAULT '',
  masked_phone      TEXT NOT NULL DEFAULT '****',
  token_expiry      TIMESTAMPTZ,
  channel           TEXT NOT NULL DEFAULT 'wa-me',
  consent_override  BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_delivery_audit_created_idx ON wa_delivery_audit (created_at);
