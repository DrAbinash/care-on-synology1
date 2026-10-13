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
| 11 | `deploy-synology.sh` prints DEPLOYMENT COMPLETE when the API never started | **High** | Deployment | `deploy-synology.sh` step 5, `scripts/deploy-health.mjs` | Its health gate probed `localhost:8080`, which nothing publishes on the host, and both wait loops fell through on timeout — a failed deploy and a successful one printed the same banner | **#952** replaced it: `:238-241` records why 8080 was never the right probe, the migration loop now hard-fails (`:234`), and `:254` gates on `sudo "$NODE_BIN" scripts/deploy-health.mjs --wait --timeout-seconds "$DEPLOY_TIMEOUT" --host-port "$HOST_PORT"` (`DEPLOY_HEALTH_TIMEOUT_SECONDS:-300`), which checks the published address **and** the containers **and** the response bodies | ✅ FIXED in code — the corrected gate has still never run on the clinic box (it can only be observed during a real deploy) |
| 12 | Live production secrets are committed in the deploy templates | **High** | Config/security | `deploy/synology/care.env`, `deploy/synology/hope.env`, `deploy-synology.sh` | `SESSION_SECRET`, `JWT_SECRET`, `BACKUP_PASSPHRASE`, `CRON_SECRET`, `SUPER_ADMIN_USB_KEY`, `INTERNAL_API_KEY`, `OCR_WORKER_TOKEN` and both Hope keys are real 64-char values in tracked files, and the deploy script re-appends two of them into `.env` | Enumerated (values never printed) in `CARE_ERP_DEPLOYMENT_RUNBOOK.md` §12. Rotation touches CARE *and* HOPE and needs history purge + force-push, so it is reported rather than done | 🔴 OPEN (owner-blocked) |
| 13 | The patient-facing print/PDF path prints no accession number for a radiology report | **Medium** | Reporting | `artifacts/api-server/src/routes/patient-reports.ts` `renderReportVersionHtml` | The workspace preview, browser print and Download PDF all name the study (`UHID` + `ACC:`); the durable path that serves Report Hub print, PDF, WhatsApp/public-link share, email and the PACS archive printed only `Patient ID` (= `patients.patient_id`). A referring clinician holding the PDF could not match it to the DICOM study | **#954** did it, on the terms this row demanded: `renderReportVersionHtml` resolves the study through `loadReportAccessionForReport` (`patient-reports.ts:3137`) and prints `accessionPrintRow` **only** where the server can prove the accession belongs to that patient (`:3142`, `lib/reportStudyIdentity.ts`); `lib/reportStudyIdentity.request.test.ts` pins `pdf`, `public_pdf` and `email`, and prints nothing rather than another patient's identifier when the study reference collides in the shared id space | ✅ FIXED (#954) — residual: no human has read one real durable PDF on the box yet (`CARE_ERP_PREDEPLOYMENT_GATE.md` §C.9) |


## Verified-clean (checked, no issue found)
- **PCPNDT fail-closed:** `form-f.ts` server-side validation (Bug #15 null-bypass fix), `pcpndtCompliance.ts` canonical override roles, `usgAiAssistant.ts` explicitly never bypasses Form F nor emits fetal sex. No fail-open path found.
- **Canonical report writes:** `structuredReport/renderer.ts` is the canonical report producer (render-engine → `patient_reports`), not a bypass. No rogue direct writes found outside the lifecycle.
- **Auth guards:** sensitive routers in `routes/index.ts` carry `requireStaffAuth` + `requireStaffPermission`/`requireAdminRole`. Displays/webhooks use token/signature guards.
- **Production TODO/FIXME/HACK:** the matches found are placeholder strings / Aadhaar masking / UUID templates — no production-affecting TODOs.
- **Signed-report immutability:** proven byte-identical across a full migration re-run (`pnpm db:smoke`).

## Infrastructure limitations (not code issues — expected in a sandbox / need the real LAN)
- **Ollama** (`http://172.16.1.140:11434`), **Orthanc**, **OHIF**, **n8n** are LAN/host services not reachable from a build sandbox; the verifier reports them WARNING/SKIPPED there. On the clinic network they resolve normally. Validate on the NAS with `pnpm operations:verify-deployment`.
- `schema_deploy_state` / `schema_migration_lock` are created by `care-db-patch-v2` at deploy time (not by a migration), so a DB bootstrapped by any other path shows them absent until the first real deploy.

## OPEN (tracked for after the pause)

> **Correction 2026-10-13:** this heading used to read "none deployment-blocking". It is no
> longer true. The migration-ledger audit has never been run against the clinic database, and
> that is a **P0 gate** — see `CARE_ERP_PREDEPLOYMENT_GATE.md` Part 2 (CL-1) and
> `CARE_ERP_PRODUCTION_READINESS.md` §Decision. The three items below are still non-blocking.

- **USG owner-review UI simplification (§9):** progressive-disclosure Basic/Advanced restructuring of the USG Companion is a larger frontend effort; scoped but not completed in this pass.
- **Broader security deep-dive (§13):** authz/PHI-in-logs/SSRF spot-checks passed; a full line-by-line pass across all 100+ routers remains a good periodic exercise.
- Consider regenerating the Drizzle migration history cleanly (finding #10) at the next major migration consolidation, so clean-boot logs are warning-free.
