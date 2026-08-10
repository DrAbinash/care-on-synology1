-- Staff demand requests — department staff ask store for supplies; store approves/issues.
CREATE TABLE IF NOT EXISTS inventory_demand_requests (
  id              serial PRIMARY KEY,
  item_id         integer REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name       text NOT NULL,
  quantity        numeric(10,2) NOT NULL,
  unit            text NOT NULL DEFAULT 'pcs',
  department      text,
  urgency         text NOT NULL DEFAULT 'normal',
  notes           text,
  status          text NOT NULL DEFAULT 'pending',
  requested_by    text NOT NULL,
  requested_by_id integer,
  reviewed_by     text,
  reviewed_at     timestamptz,
  issued_at       timestamptz,
  rejection_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_demand_requests_status_idx ON inventory_demand_requests (status);
CREATE INDEX IF NOT EXISTS inventory_demand_requests_created_idx ON inventory_demand_requests (created_at DESC);
