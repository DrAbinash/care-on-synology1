# MIGRATION LEDGER AUDIT

Read-only. Run it before any production migration, and after any deploy that
reported a migration error.

## Why this exists

`docker/db-patch-entrypoint.sh` decides whether a migration still needs to run by
looking at what the ledger already says about it:

- a Drizzle file is skipped when its SHA-256 is in `drizzle.__drizzle_migrations`;
- a feature file is skipped when its name **and** hash are in
  `public.schema_migrations_log`.

The ledger is therefore the only memory the deploy has. Until PR #955 the Drizzle
step ran `psql` with `ON_ERROR_STOP=0` — required, because two historical
statements are self-inconsistent on an empty database — and that same flag makes
`psql` exit 0 whatever happened, while the output was piped through four
`grep -v`s into `|| true`. A migration could fail, be recorded as applied, and be
skipped on every subsequent deploy.

The fix stops that from happening again. It cannot say whether it already
happened. Any database deployed before the fix may hold ledger rows that assert a
schema the database does not have — and the deploy will never look at those files
again.

## What the audit does

`scripts/audit-migration-ledger.mjs` compares the ledger's claims with the
database:

1. reads `schema_migrations_log`, `drizzle.__drizzle_migrations`,
   `schema_deploy_state` and `system_database_identity`;
2. for every migration the ledger says was applied, opens the SQL file it names
   and extracts the schema effects that file declares — `CREATE/DROP TABLE`,
   `ADD/DROP/RENAME COLUMN`, `CREATE/DROP INDEX`, `ADD/DROP CONSTRAINT`,
   `CREATE/DROP VIEW`;
3. folds those effects in **the order the statements appear in the file**, then in
   the order the entrypoint runs the files, so a column dropped by one migration
   and re-added by a later one resolves to "present" and is not reported;
4. compares the folded result with `information_schema` and `pg_catalog`;
5. checks the objects the API refuses to start without, by name.

Run it with the repository at (or after) the revision that deployed the database:
an effect can only be verified against a file that still exists. A ledger row
whose file has been deleted is reported as `ORPHAN_RECORD` and is **not** judged —
the audit refuses to guess what a file it cannot read used to contain.

Statements inside `DO $$ … $$` blocks and inside function/trigger bodies are
**counted but never asserted**: they are conditional at run time, so treating
them as a promise would accuse migrations that did nothing wrong.

It is read-only by construction, not by convention: the session is opened with
`default_transaction_read_only=on` and the script **aborts if that did not take
effect**. It issues `SELECT`s only. It never updates, deletes or inserts a ledger
row, never re-runs a migration, and never applies DDL.

```sh
DATABASE_URL=postgresql://erp@127.0.0.1:5432/diagnostic_erp node scripts/audit-migration-ledger.mjs
DATABASE_URL=… node scripts/audit-migration-ledger.mjs --json=audit.json   # machine-readable
DATABASE_URL=… node scripts/audit-migration-ledger.mjs --strict            # warnings also exit 1
```

On the NAS, run it inside the image that already has `scripts/` and its dependencies, mounted
against the same read-only SQL directories `care-schema-verify` uses. `DATABASE_URL` comes from the
service environment, so no password is typed and nothing is written outside the deploy checkout:

```sh
docker compose run --rm --no-deps schema-verify \
  node scripts/audit-migration-ledger.mjs --json=output/ledger-audit.json
```

`--no-deps` starts no database and no API; the container runs one command and exits. The `migrate`
stage bakes `scripts/node_modules` into the image (see the note in `docker-compose.yml` about why
`scripts/` is deliberately **not** bind-mounted), which is also why `pg` is imported lazily inside
`main()` here: the audit's tests must not need it. `care-db-patch-v2` itself is
`postgres:16-alpine` and has no Node, so it cannot run this — the audit is a documented pre-deploy
step, not something the patch container enforces.

`care-db` publishes only `127.0.0.1:${DB_HOST_PORT:-5400}`, so a host-side psql probe needs both
the port and the password:

```sh
docker exec care-db psql -U erp -d diagnostic_erp -Atc "select count(*) from schema_migrations_log"
```

## Reading the findings

| Code | Meaning | Who decides |
| --- | --- | --- |
| `RECORDED_BUT_ABSENT` | the ledger says this migration ran; an object it declares is not there (or an object it dropped is still there) | **must be explained before deploying** |
| `CRITICAL_TABLE_MISSING` / `CRITICAL_COLUMN_MISSING` | an object the API cannot start without is absent | **must be explained before deploying** |
| `CONTENT_DRIFT` | the file on disk no longer matches the recorded hash — care-db-patch-v2 updates the hash and does **not** re-apply, so the database holds the old content's effects | decide whether the changed statements were ever applied |
| `DRIZZLE_HASH_UNMATCHED` / `LEDGER_ROW_UNMATCHED` | the two trackers disagree about what ran | explain which one is right |
| `ORPHAN_RECORD` | a ledger row names a file that no longer exists (history compaction, or a deleted migration) | informational unless the object is also missing |
| `CONSTRAINT_UNDER_OTHER_NAME` | the key a migration declared is absent by that name, but the same key on the same columns exists under another name — the effect applied, the identifier changed | informational; read the replacement, it may differ in `ON DELETE` behaviour |
| `NOT_IN_LEDGER` | a file exists that the ledger has never seen — it will be applied on the next deploy | expected on a database built by `pnpm db:bootstrap` or `drizzle-kit push` rather than by the container |

## Four Postgres facts the parser has to respect

Each of these was found by running the audit and reading a finding that could not
be true. They are pinned by `scripts/audit-migration-ledger.test.mjs` (27 tests,
no database needed) because an audit that cries wolf gets ignored, and the clinic's
wolf was 167 lines long before these were fixed.

1. **A capture group that is not named will shift.** The identifier sub-pattern
   contained a group of its own, so `ALTER TABLE x ADD COLUMN y` was read as a
   column called `x.x` — every column in the repository. Every group the parser
   reads is now named, and the test forbids unnamed groups in the pattern table.
2. **`"public"."tbl"` is not one identifier token.** The old pattern stopped at
   the quote, so an injected `CREATE TABLE "public"."ledger_probe_second"` was
   reported as a missing table called `public`.
3. **Statements fold in file order, not pattern order.** `0006_jazzy_mojo` drops
   `tat_modality_idx` and recreates it 300 lines later; collected per DDL form,
   the drop landed last and the audit accused the migration of leaving an index
   behind that the next statement had just created.
4. **Postgres truncates identifiers to 63 bytes and says nothing.** Six foreign
   keys of 65–71 characters were reported as never applied. `pgTrunc()` applies the
   same rule to the declared name before looking it up. Truncation is not fuzzy
   matching: two names that differ inside the first 63 bytes stay distinct, and the
   `form_f_records` pair below is resolved by *key equivalence*, not by name.

   Measured on the server rather than assumed — a 76-character key name:

   ```
   ALTER TABLE trunc_probe ADD CONSTRAINT a_70_char_name_aaaa… (76 chars) FOREIGN KEY (ref) REFERENCES trunc_probe(id);
   → ALTER TABLE                                   (no error, no notice)
   → stored conname: a_70_char_name_aaa…aaa        length 63
   ```

**Read-only is enforced, not promised.** The session option
`default_transaction_read_only=on` is what the script connects with, and the same
option refuses a write:

```
PGOPTIONS='-c default_transaction_read_only=on' psql … -c "update schema_migrations_log set name='tampered' …"
→ ERROR:  cannot execute UPDATE in a read-only transaction
```

Every statement in the script is a `SELECT` or a `SHOW` — including the existence
probes, which are `SELECT to_regclass($1) IS NOT NULL`. There is no DDL, no ledger
write, and no re-application of any migration file anywhere in it.

**Key equivalence.** `migrations/zzzzzzz_bill_dependent_referential_integrity.sql`
conditionally drops Drizzle's `form_f_records_bill_id_bills_id_fk` and reinstalls
the same foreign key as `form_f_records_bill_id_fk` with `ON DELETE SET NULL`. The
drop lives in a `DO $$ … $$` block, which the audit deliberately never asserts, so
the earlier migration looked like a failure. The audit now asks whether the effect
— a foreign key on `form_f_records(bill_id)` — is present, reports it as applied,
and adds an informational line naming the constraint that actually holds it. That
`ON DELETE` difference is a real clinical fact, so it is surfaced rather than
swallowed.

## Known limitations and false positives

Counted over the 204 migration files this audit reads, so the size of each blind
spot is known rather than guessed:

| Limitation | Measured in this repository | What it means when reading the output |
| --- | --- | --- |
| **Conditional DDL inside `DO $$ … $$` is never asserted** | 38 guarded blocks holding 34 `CREATE`/`ALTER`/`DROP` statements across 15 files (most in `add_runtime_startup_columns.sql`, `add_ai_shadow_uniqueness_hardening.sql`, `add_referral_indexes.sql`) | A statement that ran only under a runtime condition proves nothing, so it is excluded. The cost: a conditional `CREATE` that never ran is invisible here. |
| **The mirror case is solved for constraints only** | — | When a *guarded* later migration drops an object an earlier one declared, a constraint is rescued by key equivalence (below). A guarded `DROP COLUMN` / `DROP INDEX` / `DROP TABLE` of that same kind still yields `RECORDED_BUT_ABSENT`. The line is true about the object and wrong about the blame. |
| **Columns declared inline in a `CREATE TABLE` body are not decomposed** | most of the schema's columns are written that way | Only the table's existence is asserted. A table created with a missing column reads as applied; the 12 named `CRITICAL_COLUMNS` are what guard the important cases. |
| **A `DROP TABLE a, b, c` list asserts only the first target** | 0 such statements today | Currently vacuous. If one is added, `b` and `c` go unchecked — silently, which is the safe direction. |
| **Truncated names are matched on their first 63 bytes** | 6 declared names exceed 63 bytes, and all 6 truncate to **different** prefixes | Unambiguous today. Two future names sharing a 63-byte prefix would be indistinguishable to the lookup — and Postgres itself refuses the second creation, so that would surface at deploy time rather than silently. |
| **An unqualified object is accepted in any schema** | — | Deliberate: matching `public` only would invent findings, because search_path decides. The cost is that an object sitting in the *wrong* schema reads as present. |
| **Data statements are invisible** | 275 `INSERT`/`UPDATE`/`DELETE` statements in the migration tree | A migration that half-applied its data is precisely what a schema audit cannot see — which is why remediation keeps "restore from backup" on the list. |
| **Types, defaults and nullability are not compared** | — | Two databases can differ there and this audit will say they match. `scripts/db-schema-verify.cjs` covers part of that from the other direction. |
| **It reads the working tree, not the deployed commit** | — | Run it from a checkout of the revision that actually deployed the database. A dirty or older checkout changes the verdict; `ORPHAN_RECORD` is what a deleted file looks like. |

So a `RECORDED_BUT_ABSENT` line is a question with a precise subject — *this object,
declared by this recorded file, is not in this database* — and not a verdict about
which statement failed, or who removed it. That is still the most useful thing to
know before a deploy, because the deploy itself will never ask it.

## Detection proved on synthetic databases

Three throwaway databases on a scratch Postgres, built by running the shipped
`docker/db-patch-entrypoint.sh` with only its two directory lines repointed at the
worktree. No patient data, no clinic database.

The demonstration injects one Drizzle file into `lib/db/drizzle/meta/_journal.json`
whose second statement fails on purpose:

```sql
CREATE TABLE "public"."ledger_probe_first" ("id" serial PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE "public"."ledger_probe_second" ("id" serial PRIMARY KEY,
  "ref" integer NOT NULL REFERENCES "public"."ledger_probe_target" ("id"));
```

`ledger_probe_target` does not exist, so statement one succeeds and statement two
errors — the definition of a partially applied migration. The injection is scratch
work: it is added, used, then reverted with `git checkout --` before any commit.

| database | entrypoint | what the deploy reported | what the audit reported |
| --- | --- | --- | --- |
| `care_hist_bad` | **before the fix** | exit 0, `db_patch_ok=true`, `✓ All migrations complete — API may start`, ledger row for `0099_ledger_probe` | 1 critical: `table public.ledger_probe_second is missing, although the ledger records 0099_ledger_probe as applied` |
| `care_fixed` | **after the fix (PR #955)** | exit 1, `Drizzle migration 0099_ledger_probe raised an unexpected error and was NOT recorded as applied — API will NOT start` | 0 `RECORDED_BUT_ABSENT`; 5 critical, all `CRITICAL_TABLE_MISSING`/`CRITICAL_COLUMN_MISSING` from the run stopping early, and 190 `NOT_IN_LEDGER` |
| `care_clean` | after the fix, no injection | exit 0, 204 migrations tracked | **0 critical, 0 warnings, 1 informational** — the single line being the `form_f_records` key above |

The first two rows are the point. The same repository, the same injection, the
same database server: before the fix the false completion was recorded, hashed and
would have been skipped on every later deploy, and the audit is the only thing that
sees it; after the fix the deploy stops out loud and the audit has nothing to find.
The third row is the control — the audit does not accuse a database that was built
correctly.

Run it against the clinic database the same way and treat the first column of that
table as the question to ask about any `RECORDED_BUT_ABSENT` line.

A database with **no `schema_migrations_log` at all** is a finding in itself: it
was not migrated by `care-db-patch-v2`, so nothing records what was applied and
the audit has no claims to test. The script says so and exits.

## The gate under the gate

`scripts/audit-migration-ledger.test.mjs` is part of `pnpm test`. It drives the
pure half of the audit — parse, fold, compare — with catalogues built from strings,
so the detection proof runs in CI on every push with no Postgres anywhere. It
includes the two controls that keep it honest: the same fold against a complete
catalogue must report **nothing**, and a parser made deliberately vacuous must
fail the suite rather than pass it.

Because those controls were written *after* four parser bugs, the mutants were
re-run against the final code: nine ways of breaking the audit (pattern-order fold,
no identifier truncation, quoted-dot parsing, keyword-as-column, positional group
shift, no key equivalence, suppressed info line, a parser returning nothing, and
judging unrecorded migrations) each turn the gate red, and the shipped file is
restored byte-identically afterwards.

Exit status is part of the contract, not an afterthought: `0` when the audit ran,
whatever it found; `1` when a critical finding needs a decision (or any finding,
under `--strict`); `1` when it could not connect or the session was not read-only.
An audit that finds a problem must not look like a crash, and a crash must not look
like a clean audit.

## Remediation

The order matters. Every step below is a human decision; none of them is
automated, and the audit will never perform one.

1. **Stop.** Do not deploy over a `RECORDED_BUT_ABSENT` finding. A deploy that
   starts now re-reads the same ledger and skips the very file that is wrong.
2. **Back up first**, and verify the backup is restorable
   (`docs/CARE_ERP_BACKUP_RESTORE.md`, `scripts/verify-backup-restore.sh`). Every
   option below is only safe because there is something to go back to.
3. **Establish what is actually missing.** Re-run the audit with `--json` and
   diff the object list against the migration file it names. The question to
   answer is narrow: did the statement never run, or did a *later* migration
   legitimately remove the object again? The fold already resolves the second
   case, so a reported object is normally the first.
4. **Choose one of three fixes**, in this order of preference:
   - **Write a new forward migration** that creates the missing object
     idempotently (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
     `CREATE INDEX IF NOT EXISTS`). This is the only option that needs no
     ledger surgery, and it is safe because the ledger's skip rule is per-file:
     a new file name is a new row. Constraints have no `IF NOT EXISTS` in
     Postgres, so wrap those in a `DO $$ … IF NOT EXISTS (SELECT 1 FROM
     pg_constraint …) … $$` guard.
   - **Re-apply the original file deliberately, by hand, after reading it.** Only
     when the file is idempotent end to end. Quote its statements into
     `docker exec -it care-db psql -U erp -d diagnostic_erp` yourself — never
     pipe a whole migration file, because a file that is *not* idempotent will
     half-run again and leave the same class of problem.
   - **Restore from a backup taken before the bad deploy**, then re-deploy with
     the fixed entrypoint. This is the right answer when data as well as schema
     is in question, because a migration's data statements are exactly what the
     schema audit cannot see.
5. **Do not delete or rewrite ledger rows** to make a finding disappear. Removing
   a `schema_migrations_log` row makes the next deploy re-run a migration that
   already ran partially — the failure mode documented in
   `HOW_TO_ADD_DB_MIGRATIONS.md` ("What a failed migration actually does"). If a
   ledger row is genuinely wrong, the fix is a new forward migration, and the row
   stays as the historical record of what the deploy believed.
6. **Re-run the audit** and require it to be clean before the next deploy, and
   keep `--json` output with the deploy record so the comparison over time is
   possible.

## Where it sits in the deploy

`docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md` step 4 runs this audit against the live
database **after** the backup is verified and **before** any image is rebuilt or
any migration is allowed to run. A `RECORDED_BUT_ABSENT` finding stops the
deploy.
