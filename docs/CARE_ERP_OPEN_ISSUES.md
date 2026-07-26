# CARE ERP — Production Audit Findings & Open Issues

_Final stabilization audit (2026-07). "Status" = FIXED in this pass / DOCUMENTED (benign or infra-limited) / OPEN (tracked for after the pause)._

> **Newer pass:** a second stabilization round (2026-07-26) covered backup
> restorability, internal-endpoint auth, network exposure and the session idle
> sweep. Its findings — including two items that are **still open and
> owner-blocked** — are in
> [`CARE_ERP_STABILIZATION_HANDOFF.md`](./CARE_ERP_STABILIZATION_HANDOFF.md).
> Start there if you are picking this codebase up.

## Severity table

| # | Issue | Severity | Component | File(s) | Risk | Fix | Status |
|---|---|---|---|---|---|---|---|
| 1 | `INSERT INTO feature_flags` runs before the table is created (alphabetical order) | **Critical** | Migrations | `migrations/add_ai_clinical_config.sql`, `add_radiology_feature_flags.sql` | Clean-boot hard-stops; every later feature migration never runs; fresh install impossible | Added early idempotent `migrations/aaaa_bootstrap_feature_flags.sql` (no-op on prod) | ✅ FIXED |
| 2 | `admin_sessions` ALTER/DROP in Drizzle 0006 with no CREATE (the named migration-order problem) | **High** | Migrations | `lib/db/drizzle/0006_jazzy_mojo.sql`, `docker/db-patch-entrypoint.sh`, `lib/db/scripts/db-deploy.ts` | Clean-boot errors (swallowed by entrypoint, fatal in `care-migrate`); noisy logs | Gated clean-boot compat pre-seed (creates placeholder so 0006 drops it cleanly; never touches an existing DB) | ✅ FIXED |
| 3 | Migration order checker missed DML dependencies | **High** | Tooling | `scripts/check-migration-order.cjs` | Whole class of `INSERT/UPDATE/DELETE`-before-CREATE bugs (incl. #1) passed preflight | Added `INSERT_INTO`/`UPDATE_TABLE`/`DELETE_FROM` detection + regression tests (incl. `FOR UPDATE` guard) | ✅ FIXED |
| 4 | UTF-8 BOM in a migration file | **Medium** | Migrations | `migrations/add_performance_indexes.sql` | `psql` tolerates it but node-postgres/other tooling errors ("syntax error at or near") | Stripped BOM (portable); smoke tool also strips defensively | ✅ FIXED |
| 5 | `ff_radiology_usg_ai_growth` gated in backend but `wired:false` in registry | **High** | Feature flags | `artifacts/api-server/src/lib/radiologyFeatureFlagRegistry.ts` | Misleads the activation/ops-health/readiness system; fails the ops-health source-pin gate | Verified full vertical integration (backend gate + service + frontend consumers) → set `wired:true` | ✅ FIXED |
| 6 | Approved default model `qwen3:14b` missing from Ollama model list; fallback hard-coded `gpt-oss:20b` | **High** | AI providers | `lib/ai-providers/src/index.ts` | Mandated default reporting model unselectable from picker; wrong fallback when model omitted | `defaultModels=["qwen3:14b","gpt-oss:20b","gemma3:12b"]`; fallback → `qwen3:14b`; test updated | ✅ FIXED |
| 7 | Stale hard-coded `"llama3"` fallback model | **Medium** | AI providers | `artifacts/api-server/src/routes/radiologyOllama.ts` (×5) | Null-config fallback used a non-approved model | Changed fallback to approved `qwen3:14b` | ✅ FIXED |
| 8 | `.env.example` Ollama default stale (`medgemma:27b`) + a non-existent `gemma4:12b` | **Medium** | Config/docs | `.env.example` | Operators pointed at wrong/nonexistent models | Corrected to approved set, `qwen3:14b` default; placeholder → approved endpoint | ✅ FIXED |
| 9 | Many env vars read by code but absent from `.env.example` | **Medium** | Config/docs | `.env.example`, code | Undocumented config → deployment guesswork | Full inventory catalogued in `CARE_ERP_ENVIRONMENT_MATRIX.md` | ✅ DOCUMENTED |
| 10 | Drizzle 0006/0010 drop already-renamed/later-added columns on clean boot | **Low** | Migrations | `lib/db/drizzle/0006_*`, `0010_*` | Two benign "does not exist" warnings on clean boot (swallowed; final schema correct) | Proven no-ops by the smoke test (final schema verified); left as-is (cannot rewrite applied migrations) | 📝 DOCUMENTED (benign) |

## Verified-clean (checked, no issue found)
- **PCPNDT fail-closed:** `form-f.ts` server-side validation (Bug #15 null-bypass fix), `pcpndtCompliance.ts` canonical override roles, `usgAiAssistant.ts` explicitly never bypasses Form F nor emits fetal sex. No fail-open path found.
- **Canonical report writes:** `structuredReport/renderer.ts` is the canonical report producer (render-engine → `patient_reports`), not a bypass. No rogue direct writes found outside the lifecycle.
- **Auth guards:** sensitive routers in `routes/index.ts` carry `requireStaffAuth` + `requireStaffPermission`/`requireAdminRole`. Displays/webhooks use token/signature guards.
- **Production TODO/FIXME/HACK:** the matches found are placeholder strings / Aadhaar masking / UUID templates — no production-affecting TODOs.
- **Signed-report immutability:** proven byte-identical across a full migration re-run (`pnpm db:smoke`).

## Infrastructure limitations (not code issues — expected in a sandbox / need the real LAN)
- **Ollama** (`http://172.16.1.140:11434`), **Orthanc**, **OHIF**, **Evolution/n8n** are LAN/host services not reachable from a build sandbox; the verifier reports them WARNING/SKIPPED there. On the clinic network they resolve normally. Validate on the NAS with `pnpm operations:verify-deployment`.
- `schema_deploy_state` / `schema_migration_lock` are created by `care-db-patch-v2` at deploy time (not by a migration), so a DB bootstrapped by any other path shows them absent until the first real deploy.

## OPEN (tracked for after the pause — none deployment-blocking)
- **USG owner-review UI simplification (§9):** progressive-disclosure Basic/Advanced restructuring of the USG Companion is a larger frontend effort; scoped but not completed in this pass.
- **Broader security deep-dive (§13):** authz/PHI-in-logs/SSRF spot-checks passed; a full line-by-line pass across all 100+ routers remains a good periodic exercise.
- Consider regenerating the Drizzle migration history cleanly (finding #10) at the next major migration consolidation, so clean-boot logs are warning-free.
