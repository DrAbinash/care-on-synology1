# Phase P0 — Foundation Implementation Report

**Scope:** Gates **G1 (grounding CI)**, **G2 (security fixes)**, **G3 (Canonical Study crosswalk)**
from `V1.1_IMPLEMENTATION_CONSTITUTION.md` §20/§21. **Backend only. No clinical-workflow change,
no radiologist-facing UI, no AI features.** Nothing beyond P0 was implemented.

---

## 1. Implementation summary

| Task | Gate | What shipped | Status |
|---|---|---|---|
| 1 | G3 | Canonical Study crosswalk (`canonical_study` table), `ai_job_queue.study_id → radiology_studies.id` FK, and **server-side study-id resolution** (client-supplied ids no longer trusted). | ✅ |
| 2 | G1 | Zero-dependency **grounding checker** (`scripts/grounding-check.cjs`) + claims manifest, wired into `build` and the vitest suite. Build/test fails when docs and code disagree. | ✅ |
| 3 | G2 | **SSRF hardening** (tailnet `100.64.0.0/10` now blocked, cloud-metadata always blocked, exact-endpoint egress allowlist) and **audit-retention fix** (archive-before-purge; no unarchived deletes). | ✅ |
| 4 | — | One idempotent, forward/backward-compatible, production-safe migration (`NOT VALID` FK). | ✅ |
| 5 | — | CHANGELOG, implementation tracker, architecture checklist, migration guide, this report. | ✅ |

**Verification (run in this environment):** `pnpm typecheck:libs` ✅ · `pnpm --filter @workspace/api-server typecheck` ✅ ·
`pnpm test` → **2513 tests pass** (7 pre-existing test *files* error only on missing `DATABASE_URL`, an environment
condition, none in changed areas) · `node scripts/grounding-check.cjs` ✅ (and correctly **exits 1** on an injected false
claim) · `node scripts/check-migration-order.cjs` ✅.

---

## 2. Files changed

**New (6):**

- `lib/db/src/schema/canonicalStudy.ts` — `canonical_study` Drizzle table (the thin crosswalk).
- `artifacts/api-server/src/lib/canonicalStudy.ts` — `resolveRadiologyStudyId()` + `ensureCanonicalStudy()` (server-side identity resolution).
- `migrations/add_canonical_study_crosswalk.sql` — the production migration (table + backfill + FK).
- `scripts/grounding-check.cjs` — the grounding checker (zero-dependency).
- `scripts/grounding.manifest.json` — 22 machine-checked architecture claims.
- `scripts/grounding-check.test.mjs` — vitest gate that runs the checker.

**Modified (7):**

- `lib/db/src/schema/radiologyWorkflow.ts` — `ai_job_queue.study_id` gains `.references(() => radiologyStudiesTable.id)`.
- `lib/db/src/schema/index.ts` — export the new table.
- `artifacts/api-server/src/routes/radiologyWorkflow.ts` — `POST /ai-jobs` resolves the study server-side (accepts `studyInstanceUid`; validates any `studyId`).
- `artifacts/api-server/src/routes/radiologyOllama.ts` — hardened `validateOllamaUrl` (metadata always-block, tailnet range, egress allowlist).
- `artifacts/api-server/src/cron.ts` — audit-log retention now archives-before-purge in batches, deleting only archived ids.
- `package.json` — `check:grounding` script; grounding gate prepended to `build`.
- `vitest.config.ts` — include `scripts/**/*.test.mjs`.

---

## 3. Database migrations

`migrations/add_canonical_study_crosswalk.sql` (auto-applied in alphabetical order by
`docker/db-patch-entrypoint.sh`). It:

1. `CREATE TABLE IF NOT EXISTS canonical_study` (+ unique index on `study_instance_uid`, index on `radiology_study_id`).
2. Backfills `canonical_study` from `radiology_studies` rows that already carry a `study_instance_uid` (`ON CONFLICT DO NOTHING`).
3. Adds `ai_job_queue_study_id_fkey` (`ai_job_queue.study_id → radiology_studies.id`) **`NOT VALID`** via a `pg_constraint` existence guard.

**Idempotent** (safe to run repeatedly), **forward-compatible** (only additive), **backward-compatible**
(existing rows untouched; `NOT VALID` skips the historical-row scan and never blocks), and it references
only pre-existing core tables. `node scripts/check-migration-order.cjs` passes.

---

## 4. Architecture decisions

- **AD-P0-1 — Crosswalk, not a merge.** `canonical_study` is a thin mapping keyed on `studyInstanceUID`;
  the three study spines are not merged (backward compatibility; constitution §4). Its `id` is the future `canonicalStudyId`.
- **AD-P0-2 — `NOT VALID` FK.** The `ai_job_queue.study_id` FK is added `NOT VALID` so it enforces every new
  insert without a blocking validation scan or lock on a production table with unknown legacy rows. A later
  `VALIDATE CONSTRAINT` can run out-of-band after any orphan reconciliation.
- **AD-P0-3 — Resolve, don't trust.** `POST /ai-jobs` now prefers the canonical `studyInstanceUid` and, for
  backward compatibility, still accepts a `studyId` — but always validates it against `radiology_studies`
  server-side. A client can no longer create an orphan job with an arbitrary id. No frontend caller does
  `POST /ai-jobs` today (only GET/PATCH), so this is a safe hardening.
- **AD-P0-4 — Grounding as a dependency-free gate.** The checker is plain Node (no install needed), mirroring
  `check-migration-order.cjs`, so it runs in CI, on deploy hosts, and locally. It is wired into `build`
  (hard gate) and `pnpm test` (vitest). The manifest is the extension point: pin a claim whenever a doc starts
  depending on a concrete table/column/function.
- **AD-P0-5 — Allowlist over blocklist for egress.** `AI_EGRESS_ALLOWLIST` (env; empty ⇒ legacy behavior) is
  authoritative when set — even in Local/LAN mode — giving the exact-endpoint control the constitution requires
  (§16) without breaking existing tailnet deployments. Cloud-metadata hosts are blocked unconditionally.
- **AD-P0-6 — Archive-before-purge, batched.** The audit cron writes a checksummed archive of each batch, then
  deletes **only** the ids it archived, looping until the backlog drains — eliminating the prior "archive 5,000,
  delete all" data-loss path while keeping memory bounded.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Legacy `ai_job_queue.study_id` rows reference non-existent studies → `VALIDATE CONSTRAINT` would fail later. | Medium | Low (FK is `NOT VALID`; new inserts safe) | Validation is deferred and optional; reconcile orphans first. New inserts are already correct. |
| A caller that posted a raw `studyId` to `POST /ai-jobs` with an id not in `radiology_studies` now gets `404`. | Low (no known caller) | Low | Backward-compatible for valid ids; the previous behavior created a broken orphan job anyway. |
| `AI_EGRESS_ALLOWLIST` misconfigured (typo) could block a legitimate Ollama endpoint. | Low | Medium (AI degraded, never clinical) | Empty by default (legacy behavior). Documented format. AI degradation never blocks reporting. |
| The migration runs before `radiology_studies` exists in some exotic order. | Very low | Medium | `radiology_studies` is a Drizzle **core** table (created before `migrations/*.sql`); `check-migration-order.cjs` confirms ordering. |
| Grounding manifest drifts (someone renames a column but not the manifest). | Medium | Low (that's the point) | The build/test fails loudly, forcing doc+code to move together. |
| Full DB-integration verification not possible in this sandbox (no `DATABASE_URL`). | — | — | Typecheck + 2513 unit tests + static migration checks pass; DB apply/rollback steps are documented in `P0_MIGRATION_GUIDE.md` for the deploy environment. |

---

## 6. Rollback plan

**Code:** revert the P0 commit (all changes are additive/behavioral; no data migration is destructive).

**Database (run manually only if required — NOT auto-applied):**

```sql
ALTER TABLE ai_job_queue DROP CONSTRAINT IF EXISTS ai_job_queue_study_id_fkey;
DROP TABLE IF EXISTS canonical_study;
```

Both are safe: dropping a `NOT VALID` FK is instant and lossless; `canonical_study` holds only derived mapping
data (rebuildable by re-running the migration's backfill). The audit-cron and SSRF changes are pure code —
reverting the commit restores prior behavior with no data implications. Removing `AI_EGRESS_ALLOWLIST` from the
environment reverts egress control to the (now tailnet-hardened) legacy path.

---

## 7. What was explicitly NOT done (deferred to later phases)

No AI Gateway, Scheduler, Ollama/MedGemma model calls, Prompt/Capability Registry, Evaluation Framework,
Evidence Store, Processing Manifest, DICOM SR, AI UI/buttons/settings, Knowledge Graph, multi-agent, or digital
twin. Phase P0 stops here.
