# CARE ERP — NAS Validation Checklist (clinic network)

_Run this on the Synology NAS, on the clinic LAN, to establish the known-good deployment baseline before the development pause. Every step here can ONLY be performed on the clinic network (it touches LAN services and the live DB). Nothing here is destructive._

**Fastest path:** most checks are covered by one command —
```sh
pnpm operations:verify-deployment          # human-readable
pnpm operations:verify-deployment --json    # for Admin dashboard / archiving
```
Run it first, then use the per-check rows below to confirm criteria and to cover the checks the verifier can't automate (USG demo isolation, PCPNDT, signed-report immutability, kill switch).

Conventions: `psql` shortcut → `docker exec care-db psql -U erp -d diagnostic_erp -tAc "<SQL>"`. Record PASS / WARNING / FAIL per row.

---

| # | Check | Command / UI step | PASS | WARNING | FAIL |
|---|---|---|---|---|---|
| 1 | **PostgreSQL** | `docker exec care-db pg_isready -U erp -d diagnostic_erp` | `... accepting connections` | — | any other output / container not `healthy` |
| 2 | **All migrations** | `psql "SELECT value FROM schema_deploy_state WHERE key='total_migrations';"` and `docker logs care-db-patch-v2 \| tail -20` | patch log ends `✓ All migrations complete — API may start`; `care-db-patch-v2` exited 0 | log shows a benign "already exists" only | log shows `✗ Feature migration FAILED` or exit ≠ 0 |
| 3 | **Schema verification** | `psql "SELECT value FROM schema_deploy_state WHERE key IN ('db_patch_ok','schema_verify_status');"` + `curl -fsS http://localhost:8080/api/health/schema` | `db_patch_ok=true`, `schema_verify_status=sql_pass`/`full_pass`, and `/api/health/schema` → **200** | `schema_verify_status=full_fail` (drift) but `/api/health/schema` still 200 | `/api/health/schema` → 503, or `db_patch_ok≠true` |
| 4 | **Orthanc** | `curl -fsS $ORTHANC_URL/system` (e.g. `http://192.168.1.137:8042/system`) | 200 with `"Version"` | reachable but non-2xx, OR unreachable **and** PACS not in use today | configured + required for today's work but unreachable/401 |
| 5 | **OHIF** | open `http://<ohif-host>:3010` in a browser on the LAN | viewer loads | slow / partial but usable, or not configured | blank/error and viewing is needed |
| 6 | **Ollama endpoint** | `curl -fsS http://172.16.1.140:11434/api/tags` | 200 with a `models` array | reachable but empty, or AI intentionally off | unreachable while AI reporting is expected |
| 7 | **Installed `qwen3:14b`** | `curl -s http://172.16.1.140:11434/api/tags \| grep -o 'qwen3:14b'` | prints `qwen3:14b` | another approved model present (`gpt-oss:20b`/`gemma3:12b`) but not qwen3:14b | endpoint up but no approved model pulled → `ollama pull qwen3:14b` |
| 8 | **AI provider test** | Admin → AI Provider Settings → **Test Connection** (model `qwen3:14b`) | "Connected" using the selected model | connects on a fallback model | test fails / times out |
| 9 | **AI job queue** | `psql "SELECT count(*) FROM ai_job_queue WHERE status IN ('failed','error') AND retry_count>=COALESCE(max_retries,3);"` | `0` | 1–5 permanently-failed jobs (review + re-queue) | large/growing backlog of failures |
| 10 | **WhatsApp (Meta Cloud API)** | `curl -fsS -H "Authorization: Bearer $WHATSAPP_AUTOMATION_SECRET" $CARE_URL/api/internal/automations/whatsapp/health` | `{"ok":true,...}` | `featureEnabled:false` (ff_whatsapp_cloud_api off) but WhatsApp not in use today | `ok:false` or unreachable while WhatsApp is expected to be live |
| 11 | **n8n** | `curl -fsS $N8N_URL/healthz` | `{"status":"ok"}` / 200 | unreachable but no automations depend on it | required automations down |
| 12 | **PACS return** | `psql "SELECT count(*) FROM dicom_sr_export_queue WHERE export_status IN ('failed','error');"` | `0` (finalized reports safe regardless) | a few failures — retry from Admin after fixing PACS | many failures + PACS destination misconfigured |
| 13 | **Study locks** | `psql "SELECT count(*) FROM radiology_study_locks WHERE COALESCE(last_activity_at,lock_time) < now() - interval '2 hours';"` | `0` | 1–3 stale locks (clear from Admin once confirmed idle) | many stale locks blocking reporting |
| 14 | **Backup status** | `psql "SELECT max(created_at) FROM backup_logs WHERE status IN ('success','completed');"` (or `backup_jobs.last_run_at`) | a success within **26h** | 26–48h old | none, or > 48h, or last status = failed |
| 15 | **USG demo isolation** | open `/radiology/usg-demo`; then `psql "SELECT max(created_at) FROM patient_reports;"` **before and after** clicking every card | banner "DEMO — synthetic data only"; `patient_reports` max timestamp **unchanged**; no new worklist/Form-F rows; Reset works | — | any new patient/report/worklist/Form-F row appears, or a network write is observed in devtools |
| 16 | **PCPNDT fail-closed** | attempt to finalize an obstetric USG with an incomplete Form F (on a test study) | finalize **refused** — 409 `pcpndt_compliance_required`; no report signed | — | finalize succeeds without a valid Form F, OR fetal sex is recorded/returned anywhere |
| 17 | **Signed-report immutability** | pick a finalized report id N: `psql "SELECT md5(body\|\|status\|\|coalesce(signed_at::text,'')) FROM patient_reports WHERE id=N;"` — record, then attempt an edit via the UI, re-run | edit of a signed report is blocked; hash **unchanged** | an amendment creates a NEW versioned row (original hash unchanged) | the original signed row's hash changes |
| 18 | **Feature-flag kill switch** | Admin → Feature Flags → toggle a `ff_radiology_usg_*` flag OFF | the feature hides immediately; **normal reporting still works**; no data change | UI needs a refresh to reflect the flag | reporting breaks, or the flag has no effect (not wired) |

---

## Exact criteria summary
- **PASS** = the check meets its "PASS" cell with no operator action needed.
- **WARNING** = degraded or not-configured, but **not deployment-blocking** — reporting/billing continue; schedule a fix. External services you don't use today are WARNING/skip, not FAIL.
- **FAIL** = deployment-blocking or a safety violation (rows 1–3, 15, 16, 17 are safety/■blocking — any FAIL there is a **no-go**).

## Go / No-Go rule for this baseline
- **GO** if rows **1, 2, 3, 15, 16, 17** are all PASS and no other row is FAIL. WARNINGs on external services (4–14) are acceptable for the baseline and tracked separately.
- **NO-GO** if any of rows 1, 2, 3, 15, 16, 17 is FAIL — do not open to clinical use; see `CARE_ERP_TROUBLESHOOTING.md` / `CARE_ERP_RECOVERY_GUIDE.md`.

## The `schema_deploy_state` signal (row 3 context)
`schema_deploy_state` is written as the **final** step of a successful migration by `care-db-patch-v2` (and, after the latest fix, by the manual `care-migrate` path too). Because `care-db-patch-v2` runs under `set -e` and only writes `db_patch_ok=true` at the very end, a failed migration exits non-zero (so `care-api` never starts) with the stamp **absent** — its absence is therefore a *signal of an incomplete migration, never a way to hide one*. If `pnpm operations:verify-deployment` reports "core tables present but schema_deploy_state absent", the DB was migrated by a non-standard path; re-run `docker compose up -d --build` to stamp it. `/api/health/schema` independently returns 503 until it is present.
