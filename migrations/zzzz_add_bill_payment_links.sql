-- =============================================================================
-- Migration: online payment links for bills — bill_payment_links.
--
-- FINANCIAL FREEZE SAFE: additive, NEW table only. It records links this
-- feature generates; it NEVER touches bills / payments / vouchers / accounts.
-- Payment settlement continues to run entirely through the existing sanctioned
-- gateway webhook (which settles any BILLPAY-<billId>-* reference).
--
-- Self-contained: soft reference (bill_id is a plain integer, no FK), so
-- alphabetical ordering is irrelevant (named zzzz_* to sort last). Idempotent
-- DDL-add only — no DROP / DELETE / UPDATE. Feature-flagged OFF
-- (ff_online_payment_links) — no books-affecting behavior until enabled.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bill_payment_links (
  id                  serial PRIMARY KEY,
  bill_id             integer        NOT NULL,
  token               text           NOT NULL,
  txn_ref             text           NOT NULL,          -- BILLPAY-<billId>-<token>
  gateway             text,
  amount              numeric(10,2)  NOT NULL,
  redirect_url        text,
  status              text           NOT NULL DEFAULT 'created', -- created | sent | expired | cancelled | failed
  channel             text           NOT NULL DEFAULT 'whatsapp',
  sent_to             text,
  provider_message_id text,
  last_error          text,
  expires_at          timestamptz,
  created_by          text,
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bill_payment_links_token_uq  ON bill_payment_links (token);
CREATE INDEX IF NOT EXISTS bill_payment_links_bill_idx         ON bill_payment_links (bill_id);
CREATE INDEX IF NOT EXISTS bill_payment_links_status_idx       ON bill_payment_links (status);

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_online_payment_links', FALSE, 'Online payment links / partial payments for bills (reuses sanctioned gateway; disabled pending sign-off)')
ON CONFLICT (key) DO NOTHING;
