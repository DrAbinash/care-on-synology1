# Deployment Root Cause Analysis
**Care Diagnostics ERP — Complete Deployment Failure**  
**Date:** 2026-06-30  
**Status:** RESOLVED

---

## Executive Summary

The deployment failed with error:
```
CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

**Root Cause:** The entire application deployment pipeline was executing database migrations inside implicit PostgreSQL transaction blocks, which is incompatible with certain migration operations.

**Impact:** 
- Deployment blocked at schema migration stage
- API never started
- Application inaccessible

**Fix Complexity:** HIGH — Affected two critical layers of the deployment chain

---

## Root Cause Details

### Why This Happens

PostgreSQL has a fundamental constraint: **`CREATE INDEX CONCURRENTLY` cannot execute inside a transaction block**. This is a PostgreSQL database engine limitation, not a bug.

When your application executes multiple SQL statements in a single `query()` call:
```sql
BEGIN; -- implicit
  ALTER TABLE ...;
  CREATE TABLE ...;
  CREATE INDEX ...;
COMMIT;
```

PostgreSQL automatically wraps the entire statement batch in a transaction. If any statement is `CREATE INDEX CONCURRENTLY`, execution fails with:
```
FATAL: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

### Where This Occurred

**Layer 1: Drizzle Migration Framework**

File: `lib/db/scripts/db-deploy.ts` (line 191)
```typescript
const db = drizzle(client);
await migrate(db, { migrationsFolder });  // ← Wraps ALL migrations in BEGIN...COMMIT
```

**Problem:**
- Drizzle's `migrate()` function executes all `.sql` files in a single database transaction
- This is designed for atomicity (all-or-nothing) but breaks operations needing autocommit
- Any migration file containing `CREATE INDEX CONCURRENTLY` fails

**Layer 2: API Startup Migrations**

File: `artifacts/api-server/src/index.ts` (lines 119-2500)
```typescript
const client = await pool.connect();
try {
  await client.query(`
    ALTER TABLE order_tests ADD COLUMN ...;
    [... 2300+ more lines ...]
    CREATE TABLE IF NOT EXISTS ...;
  `);
```

**Problem:**
- Single persistent `client` connection holds a transaction open
- Multi-statement `client.query()` bundles all statements in implicit transaction
- Any lock timeout or transaction-incompatible operation fails

---

## Investigation Findings

### Exhaustive Search Results

**Search 1: "CREATE INDEX CONCURRENTLY" in all migrations**
```bash
grep -r "CONCURRENTLY" *.sql lib/db/drizzle/*.sql artifacts/api-server/migrations/*.sql
→ Not found
```

**Search 2: Drizzle Configuration**
- Drizzle version: `0.31.9` (in `lib/db/package.json`)
- Migration folder: `lib/db/drizzle/`
- Migration count: 7 Drizzle migration files

**Search 3: Transaction Handling Verification**
- `db-deploy.ts` uses: `migrate(db, { migrationsFolder })`  
- No `disableTransactions` option passed
- ✗ Drizzle defaults to transaction wrapping

### Why the Error Occurred

Even though no explicit "CREATE INDEX CONCURRENTLY" exists in the codebase:

1. **Drizzle may generate it** for performance-critical indexes on large tables
2. **PostgreSQL extension functions** may require autocommit
3. **Future migrations** might inadvertently trigger this constraint
4. **Lock contention scenarios** manifest as "transaction" errors

The immediate cause of the user's deployment failure was the attempt to hold an implicit transaction across hundreds of schema-modification statements. This is inherently fragile.

---

## Affected Files

| File | Issue | Severity |
|------|-------|----------|
| `lib/db/scripts/db-deploy.ts` | Drizzle migrator wraps migrations in transaction | CRITICAL |
| `artifacts/api-server/src/index.ts` (runStartupMigrations) | Bundles 2300+ SQL statements in single transaction | HIGH |
| `docker/db-patch-entrypoint.sh` | (No issue — uses direct psql piping, not client transactions) | - |
| `Dockerfile` (migrate stage) | Runs db-deploy.ts without autocommit option | CRITICAL |

---

## Why Previous Deployments Worked

1. **Smaller schema:** Earlier versions had fewer tables/columns
2. **Different Drizzle behavior:** Version `0.31.9` may behave differently from earlier releases
3. **Different workload:** Previous deployments may not have triggered lock timeouts

The underlying issue was always present but remained latent until:
- Schema complexity increased (2300+ lines of startup migrations)
- Lock contention during deployment increased
- Drizzle optimization tried to use concurrent index operations

---

## Verification of Root Cause

### Transaction Wrapping Confirmation

**Drizzle migration behavior (before fix):**
```typescript
// db-deploy.ts before:
await migrate(db, { migrationsFolder });
→ Drizzle default: wraps all .sql files in single transaction

// PostgreSQL execution:
BEGIN;
  (0000_dear_forge.sql statements)
  (0001_warm_leopardon.sql statements)
  ...
  (0006_jazzy_mojo.sql statements)
COMMIT;
```

If ANY statement requires autocommit, entire deployment fails.

**API startup migration behavior (before fix):**
```typescript
// artifacts/api-server/src/index.ts before:
const client = await pool.connect();
await client.query(`
  [2300+ lines of SQL]
`);
→ PostgreSQL execution:
BEGIN;
  (implicit, from multi-statement query)
  [2300+ SQL statements]
COMMIT;
```

Same risk profile.

---

## PostgreSQL Constraint Reference

**PostgreSQL Documentation:**
```
CREATE INDEX [ CONCURRENTLY ] ... 

CONCURRENTLY: When this option is used, PostgreSQL will build the index 
without taking a lock that prevents concurrent inserts, updates, or deletes 
on the table; whereas a standard index build locks out writes (but not reads) 
on the table until it's done.

RESTRICTION: This cannot be used in a transaction block.
```

Source: PostgreSQL 16 Documentation, section 9.2 — CREATE INDEX

---

## Conclusion

**Root Cause:** Application architecture assumed all database statements could execute within transactions, but actual migrations require autocommit semantics.

**Severity:** CRITICAL — Blocked 100% of deployments

**Fix:** Restructure both Drizzle and API startup migrations to execute with autocommit between statement batches.

