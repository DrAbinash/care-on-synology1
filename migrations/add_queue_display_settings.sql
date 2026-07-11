-- Queue Display Settings — configurable TV / kiosk queue-display screens
-- (USG Room, X-Ray Room, Reception, etc.)
-- See lib/db/src/schema/queueDisplaySettings.ts for design rationale.
-- Every statement is idempotent (IF NOT EXISTS) per db-patch-entrypoint.sh
-- convention, same as add_payment_gateway_diagnostics.sql.
--
-- Presentation/config only. Does not touch test_tokens, bills, or any
-- protected business logic. Reads live token data from the existing
-- /api/display/queue(-stream) endpoints via ledger_id/departments.

CREATE TABLE IF NOT EXISTS queue_display_settings (
  id SERIAL PRIMARY KEY,
  room_key TEXT NOT NULL,

  display_name TEXT NOT NULL DEFAULT 'Care Diagnostics',
  location TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  show_logo BOOLEAN NOT NULL DEFAULT TRUE,
  show_display_name BOOLEAN NOT NULL DEFAULT TRUE,
  show_location BOOLEAN NOT NULL DEFAULT TRUE,

  room_title TEXT NOT NULL DEFAULT 'USG ROOM',
  show_room_title BOOLEAN NOT NULL DEFAULT TRUE,

  show_now_serving BOOLEAN NOT NULL DEFAULT TRUE,
  show_next_patients BOOLEAN NOT NULL DEFAULT TRUE,
  next_patient_count INTEGER NOT NULL DEFAULT 5,

  show_qr_booking BOOLEAN NOT NULL DEFAULT TRUE,
  qr_image_url TEXT NOT NULL DEFAULT '',
  qr_heading TEXT NOT NULL DEFAULT 'AVOID THE QUEUE',
  qr_subheading TEXT NOT NULL DEFAULT 'BOOK ONLINE',
  qr_description TEXT NOT NULL DEFAULT 'Scan the QR code to book your appointment online',
  qr_button_text TEXT NOT NULL DEFAULT 'SCAN TO BOOK',

  instruction_items TEXT NOT NULL DEFAULT '[{"id":"1","icon":"👤","text":"Please keep your token ready","color":"#fbbf24","enabled":true},{"id":"2","icon":"🧑‍🤝‍🧑","text":"One attendant per patient","color":"#60a5fa","enabled":true},{"id":"3","icon":"🔇","text":"Silence your mobile phone","color":"#4ade80","enabled":true}]',

  show_announcement BOOLEAN NOT NULL DEFAULT TRUE,
  announcement_text TEXT NOT NULL DEFAULT 'Token numbers may change. Please listen for your number.',

  phone TEXT NOT NULL DEFAULT '',
  show_phone BOOLEAN NOT NULL DEFAULT TRUE,
  website TEXT NOT NULL DEFAULT '',
  show_website BOOLEAN NOT NULL DEFAULT TRUE,
  slogan TEXT NOT NULL DEFAULT 'We care for you',
  show_slogan BOOLEAN NOT NULL DEFAULT TRUE,

  theme_mode TEXT NOT NULL DEFAULT 'dark',
  primary_color TEXT NOT NULL DEFAULT '#03a814',
  secondary_color TEXT NOT NULL DEFAULT '#075fe0',
  accent_color TEXT NOT NULL DEFAULT '#ffe600',

  ledger_id INTEGER NOT NULL DEFAULT 1,
  departments TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_display_settings_room_key_idx
  ON queue_display_settings (room_key);

-- Seed the USG room row so GET /api/settings/queue-display/usg works
-- immediately after migration, with the defaults matching the reference photo.
INSERT INTO queue_display_settings (room_key, room_title, location)
SELECT 'usg', 'USG ROOM', 'Deoghar'
WHERE NOT EXISTS (SELECT 1 FROM queue_display_settings WHERE room_key = 'usg');
