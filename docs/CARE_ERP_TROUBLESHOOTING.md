# CARE ERP — Troubleshooting Guide (symptom-driven)

_For a future debugger during the development pause. Find the symptom, follow the row. Every command is read-only or safe unless marked ⚠️._

**First move for almost anything:**
```sh
pnpm operations:verify-deployment        # one-shot health of the whole stack
docker ps --format '{{.Names}}\t{{.Status}}'   # container health at a glance
```
The verifier's PASS/FAIL/WARNING/SKIPPED lines point you straight at the failing subsystem and print a remediation hint per finding.

> **When NOT to proceed (applies to every row):** if the action would delete/overwrite patient, report, or billing data, or mutate a **signed/finalized** report — stop and escalate. Migrations are forward-only; there are no automatic rollbacks of data. Take a DB backup (`docker exec care-db pg_dump …`) before any ⚠️ step.

---

### 1. Container Manager / `docker compose up` does not start
- **Likely cause:** a required secret is unset (`JWT_SECRET`, `SESSION_SECRET`, `ICICI_SECRET_KEY` — compose has `:?` guards), or the external `care_main_db_data` volume is missing.
- **Affected:** whole stack.
- **First log:** the `docker compose up` output itself (it names the missing var).
- **Command:** `docker compose config >/dev/null` (validates `.env` interpolation).
- **Expected:** no error; prints nothing.
- **Safe correction:** set the named var in `.env` (see `CARE_ERP_ENVIRONMENT_MATRIX.md`). For the volume: `docker volume create care_main_db_data`.
- **Rollback:** none needed (nothing started).
- **Don't proceed if:** the missing volume already exists elsewhere with real data — attaching a fresh empty volume would look like total data loss. Verify the volume first.

### 2. `care-api` unhealthy / restarting
- **Likely cause:** DB not reachable, schema not ready, or a startup exception.
- **Affected:** all API + frontend calls.
- **First log:** `docker logs --tail=100 care-api`
- **Command:** `curl -fsS http://localhost:8080/health` (inside the api container: `docker exec care-api curl -fsS localhost:8080/health`)
- **Expected:** `{"ok":true,...}` once Node is listening (liveness has no DB dependency).
- **Safe correction:** if `/health` is fine but `/api/health/schema` 503s → migrations didn't complete → see row 3. If `/health` fails → check `care-db` health and `DATABASE_URL`.
- **Rollback:** redeploy the previous image tag (`ERP_VERSION`/`BUILD_NUMBER`).
- **Don't proceed if:** the DB identity guard failed (see logs "DB IDENTITY MISMATCH") — that means `.env` points at the **wrong database**; fix the env, never force past it.

### 3. Database migration failure (`care-db-patch-v2` exits non-zero)
- **Likely cause:** a feature migration referenced a table/column not yet created (ordering), or a genuine SQL error.
- **Affected:** deploy halts; `care-api` never starts.
- **First log:** `docker logs care-db-patch-v2` → find the `✗ Feature migration FAILED: <file>` line. **Every migration alphabetically after it never ran.**
- **Command (host, safe, no DB):** `node scripts/check-migration-order.cjs` — statically finds ordering violations (DDL **and** DML). Then `pnpm db:smoke` against a throwaway DB to reproduce end-to-end.
- **Expected:** checker prints "No ordering violations"; smoke prints "MIGRATION SMOKE: PASS".
- **Safe correction:** fix the offending `migrations/*.sql` (idempotent guards; correct filename ordering per `HOW_TO_ADD_DB_MIGRATIONS.md`), re-deploy. The entrypoint skips already-applied files by hash.
- **Rollback:** remove the bad migration file (removing a file never touches the DB) and redeploy; write a compensating migration if data was already changed.
- **Don't proceed if:** you're tempted to edit an **already-applied** Drizzle migration (`lib/db/drizzle/*.sql`) — don't; use an additive `migrations/*.sql` compatibility file instead.

### 4. Blank / white frontend
- **Likely cause:** nginx up but API unreachable, a stale asset cache, or a JS crash with no error boundary.
- **Affected:** browser only.
- **First log:** `docker logs --tail=50 care-web`; browser devtools console.
- **Command:** `curl -I http://localhost:8888/` and `curl -fsS http://localhost:8888/nginx-health`
- **Expected:** `200` and `ok`.
- **Safe correction:** hard-refresh (cache-bust); confirm `care-api` healthy (row 2); check `VITE_API_BASE_URL` was baked correctly at build. On a per-page crash the app now shows an error state instead of a blank page (see error-recovery); report the diagnostic ID shown.
- **Rollback:** redeploy previous web image.
- **Don't proceed if:** clearing browser storage — it won't fix a server-side 5xx and can log the user out mid-task.

### 5. Login loop / can't log in
- **Likely cause:** `SESSION_SECRET`/`JWT_SECRET` changed (invalidates sessions), clock skew, or no admin user seeded.
- **Affected:** auth.
- **First log:** `docker logs care-api | grep -i "bootstrap\|session\|auth"`
- **Command:** verifier "auth endpoint" check; `docker exec care-db psql -U erp -d diagnostic_erp -c "select count(*) from users;"`
- **Expected:** users count ≥ 1.
- **Safe correction:** if 0 users → set `BOOTSTRAP_ADMIN_FORCE=true`, redeploy, log in with the bootstrap email + default PIN, change PIN, then set `BOOTSTRAP_ADMIN_FORCE=false` and redeploy again.
- **Rollback:** restore the previous `SESSION_SECRET` to revive existing sessions.
- **Don't proceed if:** leaving `BOOTSTRAP_ADMIN_FORCE=true` — it resets the admin PIN on **every** restart (security hole).

### 6. Orthanc unavailable (Open Viewer fails; reporting still works)
- **Likely cause:** Orthanc container down, wrong `ORTHANC_URL`, or a Docker-bridge IP set instead of a LAN IP.
- **Affected:** DICOM viewer / PACS return only. **Reporting remains usable.**
- **First log:** `docker logs care-api | grep -i orthanc`
- **Command:** `curl -fsS $ORTHANC_URL/system` (verifier: PACS/Orthanc).
- **Expected:** JSON with `"Version"`.
- **Safe correction:** point `ORTHANC_URL`/`WEASIS_WADO_PUBLIC_URL` at a real LAN/Tailscale address (never `172.17–172.31.x.x` bridge IPs); set `ALLOW_PRIVATE_IPS=true`. If only the dashboard shows red but users can view, set `ORTHANC_INTERNAL_URL` for the hairpin-NAT probe.
- **Rollback:** n/a (external service).
- **Don't proceed if:** you'd block report finalization on Orthanc — the design keeps reporting independent of the viewer.

### 7. OHIF not loading
- **Likely cause:** OHIF container down or `OHIF_URL` wrong; report editor is unaffected.
- **First log/command:** `curl -I $OHIF_URL` (verifier: PACS/OHIF).
- **Expected:** 200/3xx.
- **Safe correction:** fix `OHIF_URL`; confirm OHIF can reach Orthanc's DICOMweb. The report editor must never full-page-crash when OHIF is down (error-recovery).
- **When not to proceed:** don't switch `PACS_VIEWER_TYPE` in production without confirming the alternate viewer is reachable.

### 8. Ollama unavailable / AI Test Connection fails
- **Likely cause:** Ollama host down, LAN-unreachable, or the endpoint is (correctly) not publicly exposed.
- **Affected:** AI suggestions only. **Manual reporting is unaffected** and AI controls show an "unavailable" state.
- **First log:** `docker logs care-api | grep -i "ollama\|ai provider"`
- **Command:** `curl -fsS http://172.16.1.140:11434/api/tags` (verifier: AI/Ollama + configured-model check).
- **Expected:** JSON `models[]` including the configured model.
- **Safe correction:** bring the Ollama host up; ensure it's LAN-reachable from `care-api`; `ALLOW_PRIVATE_IPS=true`.
- **When not to proceed:** don't expose port 11434 publicly (Cloudflare) — Ollama stays LAN-only.

### 9. Selected AI model ignored / wrong model used
- **Likely cause:** the request omitted a model **and** no stored provider default is set → the built-in fallback (`qwen3:14b`) is used; or the chosen model isn't pulled on the Ollama host.
- **First log:** `docker logs care-api | grep -i "model"`.
- **Command:** verifier "configured Ollama model" line (tells you if the model is pulled). Confirm the stored default in Admin → AI Provider Settings.
- **Expected:** chosen model appears in `/api/tags` and in the request.
- **Safe correction:** set the intended model as the provider **default** (Admin), or pass it explicitly. If missing on the host: `ollama pull <model>`. Approved: `qwen3:14b` (default), `gpt-oss:20b`, `gemma3:12b`.
- **When not to proceed:** don't hard-code a model in code — precedence is explicit → stored default → `qwen3:14b`.

### 10. Report save fails
- **Likely cause:** transient DB/API error or a study-lock conflict.
- **Affected:** reporting workspace.
- **First log:** `docker logs care-api | grep -i "save-draft\|report"`.
- **Command:** verifier API/worklist; check `radiology_study_locks`.
- **Expected:** endpoint reachable; no stale lock on your study.
- **Safe correction:** the editor must **not** clear on a save failure — retry from the unsaved-warning banner. If a stale lock blocks you (idle >2h), clear it from Admin, or ⚠️ `DELETE FROM radiology_study_locks WHERE last_activity_at < now() - interval '2 hours';`
- **When not to proceed:** never finalize while a save is failing (risk of a partial/again-locked report); resolve the save first.

### 11. PCPNDT block (report/finalize refused)
- **This is by design and fail-closed.** A missing/invalid Form F, or an attempt that could reveal fetal sex, blocks the action.
- **Affected:** obstetric USG reporting.
- **First log:** `docker logs care-api | grep -i "pcpndt\|form.f\|form_f"`.
- **Safe correction:** complete/attach the valid Form F; ensure the study is properly gated. **Do not** add a bypass, disable the check, or "fix" it by relaxing enforcement.
- **When not to proceed:** any change that would let reporting continue without Form F, or that records/returns fetal sex — this is a legal (PCPNDT) fail-closed control. Escalate instead.

### 12. PACS push / return fails (report already finalized)
- **Likely cause:** destination PACS unreachable or SR export error.
- **Affected:** DICOM SR return only. **The finalized report is safe and stays finalized.**
- **First log:** `docker logs care-api | grep -i "pacs return\|sr export"`.
- **Command:** `select count(*) from dicom_sr_export_queue where export_status in ('failed','error');` (verifier: PACS/SR queue).
- **Safe correction:** fix the PACS destination, then **retry from Admin** — the retry queue persists; no report is lost.
- **When not to proceed:** don't re-finalize or duplicate the report to force a push; use the retry queue.

### 13. Queue display blank
- **Likely cause:** `DISPLAY_ACCESS_TOKEN` mismatch or the display route not reachable.
- **First log/command:** `curl -I http://localhost:8888/display` (verifier: Frontend/queue display).
- **Safe correction:** re-issue/sync the display token; confirm the display URL and counter key.
- **When not to proceed:** displays are public kiosks — don't expose authenticated admin routes to fix them.

### 14. ICICI callback failure (payment not confirmed)
- **Likely cause:** signature mismatch, wrong `ICICI_*` config, or callback URL not reachable from the gateway.
- **First log:** `docker logs care-api | grep -i "icici\|gateway-webhook"`.
- **Command:** verifier Payments/ICICI config; confirm `ICICI_MERCHANT_ID`/`ICICI_SECRET_KEY`/`ICICI_BASE_URL`.
- **Safe correction:** correct the config; ensure `/api/gateway-webhooks` is publicly reachable (Cloudflare route) and the signature secret matches the gateway.
- **When not to proceed:** never mark a bill paid manually to "unblock" without confirming the gateway record — reconcile first.

### 15. WhatsApp unavailable
- **Likely cause:** Meta Cloud API credentials expired/revoked, `ff_whatsapp_cloud_api` disabled, emergency pause active, or shadow mode + empty allowlist blocking real sends.
- **Affected:** report-delivery notifications, appointment/dues reminders, OTP, payment links — all queue durably in `wa_outbox` and retry; nothing is silently lost.
- **First log/command:** `curl -fsS -H "Authorization: Bearer $WHATSAPP_AUTOMATION_SECRET" $CARE_URL/api/internal/automations/whatsapp/health` (verifier: Messaging); check Admin → Integrations → WhatsApp → Health for queued/dead-letter counts and the emergency-pause/shadow-mode state.
- **Safe correction:** refresh credentials via the unified settings page; resume from emergency pause if set; retry dead-lettered messages from the Health panel once fixed.
- **When not to proceed:** don't disable delivery tracking to hide failures — reports are still available in-app, and queued messages resume automatically once the underlying issue is fixed.

### 16. Disk full ("no space left on device")
- **Likely cause:** uploads/backups/build artifacts accumulation.
- **First log/command:** `df -h`; verifier Operational/disk (`<10%` free → WARN).
- **Safe correction:** ⚠️ delete old build artifacts, rotated backups, and stale uploads (deletes still succeed when writes fail, and freed space is immediately writable). Check `OBJECT_STORAGE_DIR` and backup dirs first.
- **When not to proceed:** never delete `db_data` or the current object storage; verify a file is truly stale before removing.

### 17. Backup stale / missing
- **Likely cause:** backup job disabled/failing.
- **First log/command:** `select job_name,last_run_at,last_status,last_error from backup_jobs;` (verifier: Operational/backup recency, WARN if >26h).
- **Safe correction:** re-enable/run the job (Admin → Backups); check `BACKUP_PASSPHRASE`/`BACKUP_TEMP_DIR` and disk space.
- **When not to proceed:** don't disable backup verification to clear the warning — fix the job.

---

## Escalation checklist
1. Run `pnpm operations:verify-deployment --json` and save the output.
2. Capture `docker logs` for the failing container (last 200 lines).
3. Note the deployed version (`/api/system/version`) and the git commit.
4. Do **not** run destructive SQL or edit applied migrations. Take a `pg_dump` before any ⚠️ step.
5. See `CARE_ERP_RECOVERY_GUIDE.md` for restore/rollback procedures.
