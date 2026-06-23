---
name: Drizzle push hazard on this DB
description: Why blind drizzle-kit push is dangerous in this repo and what to do instead
---

Running `pnpm --filter @workspace/db run push` (drizzle-kit push) against this
database triggers a DANGEROUS interactive prompt about an UNRELATED rename
(it confuses `report_delivery_logs` vs `kiosk_payment_sessions`). Accepting it
could drop/rename a live table.

**Why:** the live DB has drifted from what drizzle-kit infers from the schema, so
push wants to "reconcile" unrelated tables.

**How to apply:** for additive schema changes (new table / new index), apply the
SQL DIRECTLY via `psql "$DATABASE_URL"` (use `CREATE ... IF NOT EXISTS`), and keep
the Drizzle schema file in sync for types. Only use `push-force` if you have fully
reviewed the generated statements. Never accept the interactive rename blindly.
