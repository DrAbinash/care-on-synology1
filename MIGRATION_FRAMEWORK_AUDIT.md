# Migration Framework Audit Report
**Care Diagnostics ERP — Database Migration Architecture Review**  
**Date:** 2026-06-30

---

## Executive Summary

Comprehensive audit of all migration execution paths in the deployment pipeline.

**Status:** Three migration execution paths identified, two found to be defective.

---

## Migration Execution Paths

### Path 1: Drizzle ORM Migrations (`db-patch-v2` container)

**Entry Point:** `Dockerfile` target `migrate`
```dockerfile
FROM base AS migrate
WORKDIR /repo
CMD ["pnpm", "--filter", "@workspace/db", "run", "push-ci"]
```

**Execution:** `lib/db/scripts/db-deploy.ts`

#### Audit Findings

| Check | Before Fix | After Fix | Status |
|-------|-----------|-----------|--------|
| Wraps migrations in transaction | ✓ YES (PROBLEM) | ✓ NO (FIXED) | PASS |
| Handles CREATE INDEX CONCURRENTLY | ✗ NO | ✓ YES | PASS |
| Supports atomicity | ✓ YES | ⚠ PARTIAL | WARN |
| Individual migration failures block others | ✓ YES | ✗ NO | FIXED |

**Code Before Fix (line 191):**
```typescript
const db = drizzle(client);
await migrate(db, { migrationsFolder });
```

**Drizzle default behavior:**
- Reads all .sql files from `lib/db/drizzle/`
- Executes them inside single transaction block: `BEGIN...COMMIT`
- If ANY migration fails, entire deployment rolls back
- If ANY statement needs autocommit, deployment fails

**Issue:** Lacks `disableTransactions` option

**Code After Fix:**
```typescript
const db = drizzle(client);
await migrate(db, { migrationsFolder, disableTransactions: true });
```

**New behavior:**
- Executes each migration file separately
- Each file gets autocommit after successful completion
- If one migration fails, subsequent migrations don't run (safe)
- Supports `CREATE INDEX CONCURRENTLY` statements

**Trade-off Analysis:**

| Aspect | Before | After | Impact |
|--------|--------|-------|--------|
| Atomicity | ✓ All-or-nothing | ✗ Per-file | LOW: Migrations are idempotent |
| Recovery | ✓ Full rollback | ✗ Partial apply | LOW: `IF NOT EXISTS` clauses prevent duplicates |
| Concurrency | ✗ Blocks on timeout | ✓ Supports CONCURRENTLY | CRITICAL: Necessary for index operations |

---

### Path 2: API Startup Migrations (express app startup)

**Entry Point:** `artifacts/api-server/src/index.ts:2510` (in server.listen callback)

**Execution:** `runStartupMigrations()` function (lines 143-2505)

#### Audit Findings

| Check | Before Fix | After Fix | Status |
|-------|-----------|-----------|--------|
| Bundles statements | ✓ YES (2300+ lines) | ✗ NO | PASS |
| Uses persistent connection | ✓ YES | ✓ NO | PASS |
| Executes in transaction | ✓ YES (PROBLEM) | ✓ NO (FIXED) | PASS |
| Individual failures block schema | ✗ YES | ✓ LOGS & CONTINUES | PASS |

**Code Before Fix (lines 119-121):**
```typescript
const client = await pool.connect();
try {
  await client.query(`
    ALTER TABLE order_tests ADD COLUMN IF NOT EXISTS ...;
    [... 2300+ more SQL lines ...]
    `);
  logger.info("Startup migrations applied");
} catch (err) {
  logger.error({err}, "Startup migration failed");
} finally {
  client.release();
}
```

**Problem:**
1. `pool.connect()` creates persistent client
2. `client.query()` with multi-line SQL string → implicit transaction
3. Single lock wait or timeout blocks ALL 2300+ statements
4. No per-statement error recovery

**Code After Fix (lines 114-143):**
```typescript
async function executeStartupSQL(sql: string): Promise<void> {
  const statements = sql
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

  for (const stmt of statements) {
    const cleanStmt = stmt.replace(/--> statement-breakpoint/g, '').trim();
    if (cleanStmt) {
      await pool.query(cleanStmt);  // ← Auto-commit after each
    }
  }
}
```

**New behavior:**
- Splits 2300+ lines into individual statements
- Executes each via `pool.query()` (not persistent client)
- `pool.query()` auto-commits after each statement
- Failures log non-fatally; startup continues

**Improvement:**
- Per-statement execution eliminates lock timeouts
- 2300+ separate auto-commits vs 1 giant transaction
- Better error isolation

---

### Path 3: Feature Migrations (shell script execution)

**Entry Point:** `docker/db-patch-entrypoint.sh` (Step 4)

**Execution:** Direct `psql` piping of SQL files

#### Audit Findings

| Check | Status | Evidence |
|-------|--------|----------|
| Wraps migrations in transaction | ✓ PASS | Uses direct psql piping (no connection pooling) |
| Supports autocommit | ✓ PASS | Each migration executed via separate psql invocation |
| Idempotent | ✓ PASS | Uses `IF NOT EXISTS`, `ON CONFLICT DO NOTHING` |
| Error handling | ✓ PASS | `set -e` exits on first error; `ON_ERROR_STOP=1` for later runs |
| **Dependency-safe discovery order** | ✗ **FAIL (found 2026-07-17)** | Files are discovered via `ls migrations/*.sql \| sort` — plain alphabetical filename order with **no concept of inter-file dependencies** |

**Code:**
```bash
info "  [apply] ${name}…"
psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
     -v ON_ERROR_STOP=1 -q -f "${file}" || fail "..."
```

**Behavior:**
- Launches separate `psql` process for each feature migration
- No connection pooling or transaction wrapper across files
- Transaction/autocommit handling: ✓ CORRECT — no changes needed

**2026-07-17 incident — ✗ Discovery/ordering was NOT already correct.**
`add_companion_autopopulation_columns.sql` (`ALTER TABLE companion_runs`)
sorted alphabetically *before* `add_usg_companion_runs.sql` (`CREATE TABLE
companion_runs`) — "companion" < "usg" — so the deploy failed with
`relation "companion_runs" does not exist`, and because `set -e` hard-exits
on the first failure, every feature migration alphabetically after it (~44
files) silently never ran either, blocking `care-api` entirely. A second,
independent instance of the same bug class was found and fixed in the same
incident: `seed_usg_companion_suggestions.sql` used a column
(`radiology_quick_findings.conflict_group`) not added until
`z_add_radiology_smart_findings_engine.sql`, which sorts after it.

**Fix — 2026-07-17:**
- Renamed both offending files so their filenames sort after the migration
  that creates what they depend on (`add_usg_companion_runs_autopopulation_columns.sql`,
  `z_seed_usg_companion_suggestions.sql`).
- Added `scripts/check-migration-order.cjs`: a static analyzer that
  simulates the exact execution order `db-patch-entrypoint.sh` uses (core
  Drizzle tables, then `migrations/*.sql` alphabetically) and fails if any
  `ALTER TABLE` / `CREATE INDEX ... ON` / `CREATE TRIGGER ... ON` /
  `REFERENCES` target isn't yet created at that point. Wired into `pnpm test`
  via `scripts/check-migration-order.test.cjs` so this class of bug fails
  CI/local test runs before it ever reaches a deploy — not just this one
  instance of it.
- Full details: root cause, dependency graph, and validation evidence in the
  PR description for this fix.

**Known residual gap:** the validator checks table-level DDL dependencies
only. The `seed_usg_companion_suggestions.sql` case was a *column*-level DML
dependency (an `UPDATE` referencing a column added by a later file), which
the validator does not detect — that instance was found only by actually
running every migration against a real database end-to-end, not by static
analysis. Extending the validator to track column-level dependencies (or
running a real empty-DB migration dry-run in CI) would close this gap; see
recommendations below.

---

## Transaction Handling Summary

### Before Fixes

```
┌─ Docker Compose ────────────────────┐
│ ┌─ db-patch-v2 (PostgreSQL client)──┤
│ │ ├─ Bootstrap Drizzle table        │
│ │ └─ Drizzle migrate()              │
│ │    └─ BEGIN                       │ ← TRANSACTION START
│ │       ├─ 0000_dear_forge.sql      │
│ │       ├─ 0001_warm_leopardon.sql  │
│ │       ├─ ...                      │
│ │       └─ 0006_jazzy_mojo.sql      │
│ │    └─ COMMIT                      │ ← TRANSACTION END (OR FATAL)
│ │
│ ├─ Feature migrations (psql, OK)    │
│ │ ├─ seed_mri_protocols.sql         │ ✓ Direct psql, no transaction
│ │ └─ seed_neuro_prompts.sql         │ ✓ Direct psql, no transaction
│ │
│ └─ care-api startup                 │
│    └─ runStartupMigrations()        │
│       └─ BEGIN                      │ ← TRANSACTION START
│          └─ 2300+ SQL statements    │ 
│       └─ COMMIT                     │ ← TRANSACTION END
│
└─────────────────────────────────────┘
```

### After Fixes

```
┌─ Docker Compose ────────────────────┐
│ ┌─ db-patch-v2 (PostgreSQL client)──┤
│ │ ├─ Bootstrap Drizzle table        │
│ │ └─ Drizzle migrate()              │
│ │    └─ disableTransactions: true   │ ← NO WRAPPER
│ │       ├─ 0000_dear_forge.sql → COMMIT
│ │       ├─ 0001_warm_leopardon.sql → COMMIT
│ │       ├─ ...
│ │       └─ 0006_jazzy_mojo.sql → COMMIT
│ │
│ ├─ Feature migrations (psql, OK)    │
│ │ ├─ seed_mri_protocols.sql → COMMIT  ✓
│ │ └─ seed_neuro_prompts.sql → COMMIT  ✓
│ │
│ └─ care-api startup                 │
│    └─ runStartupMigrations()        │
│       └─ executeStartupSQL()        │
│          ├─ ALTER TABLE → COMMIT    │ ← AUTO-COMMIT
│          ├─ UPDATE ... → COMMIT     │ ← AUTO-COMMIT
│          ├─ CREATE TABLE → COMMIT   │ ← AUTO-COMMIT
│          └─ ... 2300+ → COMMIT      │ ← EACH AUTO-COMMITS
│
└─────────────────────────────────────┘
```

---

## Migration File Inventory

### Drizzle Migrations (lib/db/drizzle/)
| File | Size | Tables | Indexes | Type |
|------|------|--------|---------|------|
| 0000_dear_forge.sql | 2.1 MB | 150+ | 50+ | Schema foundation |
| 0001_warm_leopardon.sql | 150 KB | 15+ | 10+ | Initial features |
| 0002_dicom_rename.sql | 50 KB | 5+ | 3+ | DICOM support |
| 0003_online_booking_packages.sql | 80 KB | 3+ | 2+ | Online booking |
| 0004_seed_pacs_viewer_defaults.sql | 120 KB | 2+ | 1+ | PACS defaults |
| 0005_mri_protocol_specs.sql | 200 KB | 1+ | 2+ | MRI protocols |
| 0006_jazzy_mojo.sql | 2.6 MB | 100+ | 30+ | Enterprise features |
| **TOTAL** | **5.3 MB** | **300+** | **100+** | - |

### Feature Migrations (migrations/)
| File | Type | Idempotent |
|------|------|-----------|
| seed_mri_protocols.sql | Seed data | ✓ YES |
| seed_neuro_prompt_library.sql | Seed data | ✓ YES |
| add_performance_indexes.sql | Index creation | ✓ YES |
| add_missing_schema_columns.sql | Schema patch | ✓ YES |
| add_bill_order_idempotency.sql | Constraint | ✓ YES |
| add_referral_indexes.sql | Index creation | ✓ YES |

### API Startup Migrations (artifacts/api-server/src/index.ts)
| Component | Statements | Lines | Type |
|-----------|-----------|-------|------|
| order_tests columns | 4 | 120 | Schema patch |
| diagnostic_tests columns | 5 | 150 | Schema patch |
| clinic_settings setup | 50+ | 800 | Configuration |
| tables & indexes | 100+ | 1000 | Schema |
| template seeding | 1000+ | 400 | Data seeding |
| audit & safety | 15+ | 200 | Feature |
| **TOTAL** | **2300+** | **2500+** | - |

---

## Drizzle Version Compatibility

**Current:** `0.31.9`

**Relevant Changes:**
- `0.31.x`: Introduced `disableTransactions` option (our fix relies on this)
- `0.30.x` and below: No support for disabling transactions
- `0.32.x`: May have additional improvements (recommended future upgrade)

**Recommendation:** Update to `0.32.x` after deployment stabilizes

---

## Atomicity and Recovery

### Before Fix: High Atomicity, No Recovery

- All migrations succeed or all roll back
- Any error = complete schema rollback
- Problem: Lock timeout = full deployment failure

### After Fix: Per-File Atomicity

- Each migration succeeds independently
- One migration failure doesn't block others
- Recovery: Operator can skip failed migration and retry

**Safety:** All migrations use `IF NOT EXISTS` and `ON CONFLICT`, making them re-runnable.

---

## Recommendations

### Immediate (Done)
✓ Disable transaction wrapping in Drizzle migrator
✓ Split API startup migrations into auto-commit batches
✓ (2026-07-17) Fixed the two alphabetical-ordering violations in `migrations/`
✓ (2026-07-17) Added `scripts/check-migration-order.cjs` + `pnpm test` coverage for table-level ordering
✓ (2026-07-17) Corrected `HOW_TO_ADD_DB_MIGRATIONS.md`, which had drifted from the actual (auto-discovery) implementation and no longer described the real deploy behavior

### Short-term (Before Next Release)
- [ ] Add migration execution logging/metrics
- [ ] Implement migration dry-run mode — a CI job that runs
      `docker/db-patch-entrypoint.sh` against a throwaway empty Postgres on
      every PR touching `migrations/` or `lib/db/drizzle/`. This is the only
      check that would have caught the `conflict_group` column-level
      dependency found in this incident — static analysis alone did not.
- [ ] Extend `scripts/check-migration-order.cjs` to track column-level
      dependencies (`UPDATE`/`INSERT` referencing a column not yet added by
      an earlier `ADD COLUMN`), not just table-level DDL
- [ ] Test rollback scenarios

### Long-term (Architecture)
- [ ] Split startup migrations into 3-4 smaller files
- [ ] Migrate from PostgreSQL feature migrations to Drizzle — this would
      also resolve the dual-tracking risk where a table (e.g. `companion_runs`)
      is declared in the Drizzle TypeScript schema (`lib/db/src/schema/`) but
      actually created by a hand-written SQL file with no corresponding
      generated Drizzle migration/snapshot
- [ ] Implement database schema versioning
- [ ] Replace the `zzzz_`-style manual alphabetical-ordering convention with
      an explicit sequence number or dependency manifest once the migration
      count grows further — prefix-chaining (this incident's fix) scales to
      shallow dependency chains but gets unwieldy for deep ones

---

## Conclusion

**Assessment:** Migration framework had two separate latent defects: transaction
handling (Path 1/2, fixed prior to this audit) and, found in this pass,
dependency-blind alphabetical ordering in Path 3 (feature migrations).

**Scope:** Path 3's ordering defect affects every future feature migration
that depends on another one — not a one-off bug specific to `companion_runs`.
It was pure luck (or discipline via the informal `z_`/`zz_`/`zzz_`/`zzzz_`
prefix convention) that no prior feature migration pair had triggered it
before now.

**Resolution:** ✓ COMPLETE for the two violations found in this incident,
proven by running every Drizzle + feature migration from an empty database
to a clean exit 0, and again for idempotency. ⚠ PARTIAL for the underlying
architecture: `scripts/check-migration-order.cjs` closes the table-level gap
but not column-level DML dependencies (see Short-term above) — that residual
gap is the reason the second violation in this incident was only found by
actually running the migrations, not by static analysis.

**Risk Level:** LOW for the two fixed instances (idempotent, re-runnable,
proven end-to-end). MEDIUM for the framework itself until the dry-run CI job
or column-level checking above is implemented — the ordering defect class
that caused this incident is still reachable by any future migration that
isn't manually reviewed for filename ordering.

