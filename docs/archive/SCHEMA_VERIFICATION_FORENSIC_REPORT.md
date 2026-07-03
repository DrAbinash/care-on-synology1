# Schema Verification Forensic Report
**Date:** 2026-06-29  
**Commit:** 703a55a5  
**Status:** ✅ RESOLVED

---

## 1. Root Cause

Three columns defined in the Drizzle **TypeScript** schema (`lib/db/src/schema/`) were never included in any **SQL migration file**. The TypeScript ORM schema and the SQL migration files drifted out of sync.

This caused the SQL schema verifier in `docker/db-patch-entrypoint.sh` to report `SCHEMA FAIL: Missing columns` on every deployment, blocking API startup.

---

## 2. Missing Schema Objects

| Table | Column | Type | Default | Defined In | Missing From |
|---|---|---|---|---|---|
| `clinic_settings` | `ollama_enabled` | `boolean NOT NULL` | `false` | `clinicSettings.ts:ollamaEnabled` | All SQL files |
| `clinic_settings` | `ollama_model` | `text` | `NULL` | `clinicSettings.ts` | `0000_dear_forge.sql` |
| `bills` | `original_total` | `numeric(10,2) NOT NULL` | `0` | `bills.ts:originalTotal` | All SQL files |

---

## 3. Why Migrations Missed Them

### `clinic_settings.ollama_enabled`

`add_ollama_columns_to_clinic_settings.sql` was written by hand to add Ollama integration fields. It included `ollama_base_url`, `ollama_model`, `ollama_local_only`, and `ollama_known_models` — but **`ollama_enabled` (the on/off boolean flag) was omitted**. Without this column, the Ollama feature flag switch has no storage, and settings cannot be saved.

The column exists in `clinicSettings.ts` as:
```typescript
ollamaEnabled: boolean("ollama_enabled").notNull().default(false),
```
But `drizzle-kit generate` was not run after this addition, so no SQL migration was produced.

### `clinic_settings.ollama_model` (also in verifier list)

Present in `add_ollama_columns_to_clinic_settings.sql`. The verifier expected it and it was being added by that migration. Included in the new migration as `IF NOT EXISTS` (no-op on existing databases).

### `bills.original_total`

Added to `lib/db/src/schema/bills.ts` as:
```typescript
originalTotal: numeric("original_total", { precision: 10, scale: 2 }).notNull().default("0"),
```
`drizzle-kit generate` was not run after this change. The column does not appear in `0000_dear_forge.sql` CREATE TABLE bills. It was referenced by the verifier but could not have been created by any migration.

---

## 4. Files Modified

| File | Action |
|---|---|
| `migrations/add_missing_schema_columns.sql` | **CREATED** — adds 3 missing columns |
| `docker/db-patch-entrypoint.sh` | **UPDATED** — full per-column diagnostic output |

---

## 5. SQL Generated

```sql
-- clinic_settings.ollama_enabled
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS ollama_enabled boolean NOT NULL DEFAULT false;

-- clinic_settings.ollama_model (belt-and-suspenders)
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS ollama_model text;

-- bills.original_total
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS original_total numeric(10, 2) NOT NULL DEFAULT 0;
```

All statements use `ADD COLUMN IF NOT EXISTS` — safe on fresh and existing databases. No data is modified. No columns are dropped.

---

## 6. Verification Output Before Fix

```
Running SQL schema verification...
✓ Core tables: all present
✗ SCHEMA FAIL: Missing columns — API will NOT start
  Missing columns: clinic_settings.ollama_enabled, clinic_settings.ollama_model, bills.original_total
```

Single comma-separated line — no table grouping, no context.

---

## 7. Verification Output After Fix

```
Running SQL schema verification...
✓ Core tables: all present
✓ Critical columns: all present (40/40)
✓ Schema state recorded: N tables, N columns, N indexes
✓ All migrations complete — API may start
```

If columns are missing in the future, the output will be:

```
✗ SCHEMA FAIL: Missing columns — API will NOT start

  The following columns are expected by the ERP but not present in PostgreSQL:

    Table: bills
      ✗ original_total
    Table: clinic_settings
      ✗ ollama_enabled

  Root cause: column defined in Drizzle TS schema but missing from SQL migrations.
  Fix:        git pull && docker compose up -d --build
```

---

## 8. Future Prevention Recommendations

### Mandatory: always run `drizzle-kit generate` after schema changes

```bash
# After modifying any lib/db/src/schema/*.ts file:
cd lib/db
pnpm drizzle-kit generate

# Commit BOTH the TS file AND the new SQL file
git add lib/db/drizzle/ lib/db/drizzle/meta/_journal.json
git commit -m "db: migration for new column"
```

### The schema verifier is a safety net, not a substitute for correct migrations

The verifier checks 40 critical columns. It will catch drift but it only covers the columns it knows about. Any new column added to the TS schema must also be in a SQL migration — the verifier list must be updated to include it.

### When adding a new column to the ERP schema

1. Add to `lib/db/src/schema/tableName.ts`
2. Run `pnpm drizzle-kit generate` in `lib/db/`
3. Verify the new `.sql` file was created in `lib/db/drizzle/`
4. If it's a critical column, add it to the verifier list in `docker/db-patch-entrypoint.sh`
5. Commit all four: TS schema, SQL migration, journal JSON, entrypoint

---

_Care Diagnostics ERP · Hospital RIS/PACS · Deoghar, Jharkhand_
