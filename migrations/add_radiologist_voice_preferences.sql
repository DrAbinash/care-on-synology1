-- M1.6B3 — per-radiologist voice-layer preferences, layered over the
-- clinic-wide pacs_settings "voice" category. Additive and idempotent.
-- "inherit" / '' means the clinic default applies; user values may only
-- tighten policy (enabled_override='off', confirmation_policy='strict') or
-- pick personal ergonomics.

CREATE TABLE IF NOT EXISTS radiologist_voice_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  enabled_override TEXT NOT NULL DEFAULT 'inherit',
  ptt_key TEXT NOT NULL DEFAULT 'inherit',
  default_mode TEXT NOT NULL DEFAULT 'inherit',
  confirmation_policy TEXT NOT NULL DEFAULT 'inherit',
  language TEXT NOT NULL DEFAULT '',
  auto_punctuation TEXT NOT NULL DEFAULT 'inherit',
  input_device TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
