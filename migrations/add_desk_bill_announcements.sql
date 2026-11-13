-- desk_bill_announcements — the ledger's witness of bills a desk PRINTED but has
-- not yet DELIVERED.
--
-- When /api/billing/save refuses (LAN drop, NAS reboot, a deploy's 5xx window)
-- the billing desk queues the bill in that browser's localStorage and prints a
-- PROVISIONAL receipt anyway. Until now a queue that never replayed left no
-- server-side trace at all, so cash sat in a drawer while every report correctly
-- said nothing. The desk announces its outstanding queue on each sync tick,
-- before it attempts the replay; delivery is derived by joining client_ref to
-- bills, so there is no client-settable "synced" flag to lose.
--
-- Alerting data, not accounting data: total_amount sizes an alarm and is never
-- posted to the ledger. Ids and amounts only — no PHI.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS desk_bill_announcements (
  id                       SERIAL PRIMARY KEY,

  client_ref               TEXT NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'pending',

  provisional_bill_number  TEXT,
  patient_id               INTEGER,
  test_count               INTEGER NOT NULL DEFAULT 0,
  total_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,

  workstation              TEXT,
  announced_by             TEXT,
  announced_by_id          INTEGER,
  last_error               TEXT,

  first_announced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_announced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at             TIMESTAMPTZ
);

-- One witness per submission: the desk re-announces the same bill every tick.
CREATE UNIQUE INDEX IF NOT EXISTS desk_bill_announcements_client_ref_uq
  ON desk_bill_announcements (client_ref);

-- The outstanding scan's filter is state = 'pending' ordered by age since the
-- FIRST announcement — a stuck bill is re-announced every tick, so the column
-- the alarm sorts by has to be the one a re-announcement does not move.
CREATE INDEX IF NOT EXISTS desk_bill_announcements_state_idx
  ON desk_bill_announcements (state, first_announced_at);
