# CARE ERP — Environment Variable Master Matrix

_The single authoritative reference for every environment variable the CARE ERP reads._
_Generated from a full `process.env` / `import.meta.env` sweep of the codebase during final stabilization (2026-07). Keep this in sync with `.env.example` and `docker-compose.yml`._

**Legend** — Req: ✅ required / ⬜ optional · Secret: 🔑 secret (never log/commit/return) / — non-secret · RR: restart required after change (compose env) / runtime = also editable in Admin.

> **Golden rule:** never hard-code hosts, ports, models, or keys in code. Runtime PACS/AI settings in the Admin UI (`pacs_settings`, AI provider settings) override env at runtime; env values are the boot defaults. Health-check impact is what `pnpm operations:verify-deployment` reports.

---

## Core / Database / Auth

| Variable | Service | Req | Secret | Format / Example | Default | Verifier check |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | api, schema-verify, migrate | ✅ | 🔑 | `postgres://erp:pw@db:5432/diagnostic_erp` | built from `DB_*` | Database/connectivity |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | db, api | ✅ | 🔑 (pw) | `erp` / strong / `diagnostic_erp` | `erp` / `changeme` / `diagnostic_erp` | — |
| `DB_HOST` / `DB_HOST_PORT` | db-patch, db | ⬜ | — | `db` / `5400` | `db` / `5400` | — |
| `HOST_PORT` | web | ⬜ | — | `8888` | `8888` | Frontend/web root |
| `PORT` | api | ⬜ | — | `8080` | `8080` | API liveness |
| `NODE_ENV` | api | ✅ | — | `production` | `development` | — |
| `LOG_LEVEL` | api | ⬜ | — | `info`/`debug` | `info` | — |
| `APP_NAME` | api, db-patch, schema-verify | ✅ | — | `care-erp` (DB-identity stamp) | `care-erp` | — |
| `APP_ENVIRONMENT` | db-patch | ⬜ | — | `production` | `production` | — |
| `JWT_SECRET` | api | ✅ | 🔑 | 64-char random | — (compose fails if unset) | — |
| `SESSION_SECRET` | api | ✅ | 🔑 | 64-char random | — (compose fails if unset) | — |
| `INTERNAL_API_KEY` | api | ⬜ | 🔑 | random (PACS intake agent) | empty | — |
| `ALLOWED_ORIGINS` | api | ⬜ | — | CSV of origins | same-origin | — |
| `PUBLIC_BASE_URL` / `APP_PUBLIC_URL` | api | ⬜ | — | `https://caredeoghar.com` | `https://caredeoghar.com` | — |
| `OBJECT_STORAGE_DIR` | api | ⬜ | — | `/app/data/object-storage` | same | Operational/disk |
| `BOOTSTRAP_ADMIN_FORCE` | api | ⬜ | — | `false` (⚠️ never `true` in steady state) | `false` | — |
| `BOOTSTRAP_ADMIN_EMAIL/NAME/PIN/ROLE` | api | ⬜ | 🔑 (pin) | first-run seed only | see `.env.example` | — |
| `SUPER_ADMIN_USB_KEY` | api | ⬜ | 🔑 | hardware bypass id | unset | — |
| `ENABLE_SCHEDULERS` | api | ⬜ | — | `true`/`false` (cron jobs) | enabled | — |
| `TZ` | api | ⬜ | — | `Asia/Kolkata` | system | — |

## Versioning / build (set by `deploy-synology.sh` / `bump-build.cjs`)
`ERP_VERSION`, `BUILD_NUMBER`, `RELEASE_NAME`, `GIT_COMMIT`, `GIT_BRANCH`, `GIT_TAG`, `BUILD_DATE` — all optional, non-secret, surfaced by `/api/system/version` and the verifier's "deployed version" check.

## Schema verification
| Variable | Req | Format | Default | Notes |
|---|---|---|---|---|
| `SCHEMA_REPAIR` | ⬜ | `true`/`false` | `false` | `true` = allow ADD COLUMN/CREATE IF NOT EXISTS auto-repair |
| `SCHEMA_VERIFY_STRICT` | ⬜ | `true`/`false` | `false` | `true` = any drift blocks `care-api` start |

---

## PACS / DICOM (Orthanc / OHIF / Conquest)

| Variable | Req | Secret | Example | Default | Feature |
|---|---|---|---|---|---|
| `PACS_PROVIDER` | ⬜ | — | `orthanc` / `conquest` | `orthanc` | selects backend |
| `PACS_VIEWER_TYPE` | ⬜ | — | `ohif` / `weasis` | `ohif` | viewer |
| `ORTHANC_URL` | ⬜ | — | `http://192.168.1.137:8042` | empty | Orthanc (browser/Weasis reachable) |
| `ORTHANC_INTERNAL_URL` | ⬜ | — | `http://care-orthanc:8042` | `http://care-orthanc:8042` | container→container health probe |
| `ORTHANC_USERNAME` / `ORTHANC_PASSWORD` | ⬜ | 🔑 | `admin` / … | empty | Orthanc auth |
| `ALLOW_PRIVATE_IPS` | ⬜ | — | `true` | `true` | allow API to call LAN IPs (SSRF guard relaxed for PACS) |
| `OHIF_URL` / `OHIF_INTERNAL_URL` | ⬜ | — | `http://192.168.1.137:3010` | empty | OHIF viewer |
| `WADO_URL` / `WEASIS_WADO_PUBLIC_URL` | ⬜ | — | `http://192.168.1.137:8042/wado` | empty | WADO for viewers |
| `ORTHANC_AE_TITLE` / `ORTHANC_IP` / `ORTHANC_WORKLIST_DIR` | ⬜ | — | — | — | DICOM worklist / C-STORE |
| `ORTHANC_CHANGES_POLLER` / `ORTHANC_POLL_INTERVAL_MS` | ⬜ | — | `true` / `5000` | — | change-feed poller |
| `CONQUEST_URL` / `CONQUEST_HOST` / `CONQUEST_PORT` / `CONQUEST_AE_TITLE` | ⬜ | — | LAN | — | alt PACS |
| `PACS_AE_TITLE` | ⬜ | — | `CARE` | — | our AE title |
| `DICOM_UPLOAD_MAX_BYTES` | ⬜ | — | `524288000` | 512 MB | upload cap |

## Network defaults (Phase B — override only if the clinic network changes)
Backend: `NETWORK_LAN_HOST`, `NETWORK_TAILSCALE_HOST`, `NETWORK_PUBLIC_DOMAIN`, `ORTHANC_HTTP_PORT`, `ORTHANC_DICOM_PORT`, `OHIF_HTTP_PORT`, `ERP_HTTP_PORT`, `CONQUEST_DICOM_PORT`.
Frontend (Vite, baked at build): `VITE_NETWORK_LAN_HOST`, `VITE_NETWORK_TAILSCALE_HOST`, `VITE_NETWORK_PUBLIC_DOMAIN`, `VITE_ORTHANC_HTTP_PORT`, `VITE_OHIF_HTTP_PORT`, `VITE_ERP_HTTP_PORT`, `VITE_API_BASE_URL`, `VITE_ASSET_BASE_URL`, `VITE_SCAN_BRIDGE_URL`.
All optional; defaults live in `artifacts/api-server/src/lib/networkDefaults.ts` and `artifacts/diagnostic-erp/src/lib/networkProfiles.ts`.

---

## AI — Ollama (LLM) + CARE AI Gateway + cloud providers

| Variable | Req | Secret | Example | Default | Notes |
|---|---|---|---|---|---|
| `OLLAMA_URL` / `OLLAMA_PRIMARY_URL` / `OLLAMA_FALLBACK_URL` | ⬜ | — | `http://172.16.1.140:11434` | empty | on-prem LLM endpoint (LAN-only, never public) |
| `OLLAMA_DEFAULT_MODEL` | ⬜ | — | `qwen3:14b` | `qwen3:14b` | **default reporting model.** Approved: `qwen3:14b`, `gpt-oss:20b`, `gemma3:12b`. Stored provider default wins at runtime. |
| `AI_GATEWAY_URL` / `USG_AI_GATEWAY_URL` | ⬜ | — | custom | empty | CARE AI Gateway health endpoint |
| `AI_EGRESS_ALLOWLIST` | ⬜ | — | CSV hosts | empty | restricts AI outbound egress |
| `AI_INTEGRATIONS_GEMINI_API_KEY` / `_BASE_URL` | ⬜ | 🔑 | key / URL | unset | Gemini provider |
| `RAG_EMBED_MODEL` | ⬜ | — | model id | — | embeddings |

> Cloud provider keys (OpenAI / Anthropic / Gemini) are stored **encrypted in the DB** via AI Provider Settings, not in env — the env keys above are optional bootstrap fallbacks. Keys are never returned by the API or logged. Test Connection uses the **selected** model (verified by `providerModel.test.ts`).

---

## Payments (ICICI primary + alternates)

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `ICICI_SECRET_KEY` | ✅ (payments) | 🔑 | compose fails if unset; verifier: Payments/ICICI config |
| `ICICI_MERCHANT_ID` / `ICICI_AGGREGATOR_ID` | ⬜ | — | `100000000455452` / `…451` defaults |
| `ICICI_BASE_URL` / `ICICI_URL_PREFIX` | ⬜ | — | `https://pgpay.icicibank.com` / `/pg/api/v2` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | ⬜ | 🔑 | alternate gateway |
| `CASHFREE_APP_ID` / `CASHFREE_CLIENT_SECRET` | ⬜ | 🔑 | alternate |
| `PHONEPE_MERCHANT_ID` / `PHONEPE_API_SECRET` / `PHONEPE_SALT_INDEX` | ⬜ | 🔑 | alternate |
| `PAYU_MERCHANT_KEY` / `PAYU_MERCHANT_SALT` | ⬜ | 🔑 | alternate |
| `HDFC_MERCHANT_ID` / `HDFC_SECRET_KEY` / `HDFC_ACCESS_CODE` / `HDFC_BASE_URL` | ⬜ | 🔑 | alternate |
| `BHARATPE_MERCHANT_ID` / `BHARATPE_API_KEY` / `BHARATPE_API_SECRET` | ⬜ | 🔑 | alternate |

Gateway callbacks arrive at `/api/gateway-webhooks` and are signature-verified.

---

## Messaging — WhatsApp / Evolution / n8n

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `WHATSAPP_PROVIDER` | ⬜ | — | `evolution` / `cloud` |
| `EVOLUTION_API_URL` | ⬜ | — | Evolution API base (verifier: Messaging) |
| `WHATSAPP_BASE_URL` / `_API_KEY` / `_API_SECRET` / `_APP_SECRET` | ⬜ | 🔑 | provider creds |
| `WHATSAPP_ACCESS_TOKEN` / `_PHONE_NUMBER_ID` / `_BUSINESS_ACCOUNT_ID` | ⬜ | 🔑 | Cloud API |
| `WHATSAPP_VERIFY_TOKEN` / `_WEBHOOK_SECRET` | ⬜ | 🔑 | webhook verification |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | ⬜ | — | `91` |
| `N8N_URL` | ⬜ | — | automations (verifier: Messaging/n8n) |

---

## Storage / Backups / Bridges / Displays

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `BACKUP_PASSPHRASE` | ⬜ | 🔑 | encrypts backups |
| `BACKUP_TEMP_DIR` | ⬜ | — | scratch dir for backup jobs |
| `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` | ⬜ | — | object storage layout |
| `FINGERPRINT_BRIDGE_SECRET` | ⬜ | 🔑 | fingerprint scanner bridge |
| `DISPLAY_ACCESS_TOKEN` | ⬜ | 🔑 | queue/payment display auth |
| `BOUNDARY_API_KEY` | ⬜ | 🔑 | shared secret for boundary service |

## Verifier-only (diagnostics)
`VERIFY_API_URL`, `VERIFY_WEB_URL`, `VERIFY_SKIP_API`, `MIGRATION_SMOKE_ADMIN_URL`, `SMOKE_BASE_URL` — used only by `scripts/verify-deployment.mjs` / `migration-bootstrap-smoke.mjs`, never by the running app.

---

## Undocumented-in-`.env.example` (flagged during audit — see OPEN_ISSUES)
The following are read by code but were **absent** from `.env.example` before this pass and are now catalogued here: `AI_GATEWAY_URL`, `USG_AI_GATEWAY_URL`, `AI_EGRESS_ALLOWLIST`, `BACKUP_PASSPHRASE`, `BACKUP_TEMP_DIR`, `DISPLAY_ACCESS_TOKEN`, `BOUNDARY_API_KEY`, `ENABLE_SCHEDULERS`, all alternate payment providers (`RAZORPAY_*`, `CASHFREE_*`, `PHONEPE_*`, `PAYU_*`, `HDFC_*`, `BHARATPE_*`), most `WHATSAPP_*`, `EVOLUTION_API_URL`, `N8N_URL`, `CONQUEST_*`, `ORTHANC_AE_TITLE/IP/WORKLIST_DIR/CHANGES_POLLER/POLL_INTERVAL_MS`. None are required for a core deploy; add them only when enabling that integration.
