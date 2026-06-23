---
name: AI tables deploy via runStartupMigrations
description: How new tables reach prod/fresh deploys in api-server without drizzle-kit push
---

New tables added for incremental features (e.g. `ai_prompt_templates`, `ai_model_routes`)
must be registered in `runStartupMigrations()` in `artifacts/api-server/src/index.ts`
as idempotent `CREATE TABLE IF NOT EXISTS` + `CREATE [UNIQUE] INDEX IF NOT EXISTS`
statements that mirror the Drizzle schema column-for-column.

**Why:** This DB avoids `drizzle-kit push` (see drizzle-push-hazard). Tables created
only via ad-hoc `psql` exist on the dev DB but are MISSING on fresh/prod deploys,
so the feature 500s in production. The startup migration block is the actual deploy
path — it runs on every boot and logs "Startup migrations applied".

**How to apply:** After creating a Drizzle schema + ad-hoc SQL on dev, also append
the matching `IF NOT EXISTS` DDL to the `runStartupMigrations` SQL block. Keep
column types/defaults and index names identical to the schema. Restart api-server
and verify with `psql "$DATABASE_URL" -c "\dt <table>"`.
