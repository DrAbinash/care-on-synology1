# CARE ERP — Route & Service Map

_Authoritative map of the deployed containers and the application routes they serve._
_Last updated: 2026-07 (final stabilization). Source of truth: `docker-compose.yml`, `artifacts/api-server/src/routes/index.ts`, `artifacts/diagnostic-erp/src/App.tsx`._

---

## 1. Deployment topology (Synology Container Manager / `docker compose`)

Startup order is enforced by `depends_on` conditions:

```
care-db (healthy)
  └─> care-db-patch-v2  (applies migrations, exits 0)
        └─> care-schema-verify  (verifies schema, exits 0)
              └─> care-api  (starts only after both above succeed; healthcheck gates)
                    └─> care-web  (nginx; starts only after care-api is healthy)
```

### Core services (defined in `docker-compose.yml`)

| Service | Container name | Image / build | Internal port | Published port | Volumes | Depends on | Health check | Restart |
|---|---|---|---|---|---|---|---|---|
| `db` | `care-db` | `postgres:16-alpine` | 5432 | `${DB_HOST_PORT:-5400}:5432` | `db_data` (external: `care_main_db_data`) | — | `pg_isready` | `unless-stopped` |
| `db-patch-v2` | `care-db-patch-v2` | `postgres:16-alpine` + `docker/db-patch-entrypoint.sh` | — | — | `docker/db-patch-entrypoint.sh`, `lib/db/drizzle`, `migrations/` (all :ro) | `db` healthy | — (runs once, exits 0) | `no` |
| `schema-verify` | `care-schema-verify` | build `Dockerfile` target `migrate` | — | — | `lib/db/drizzle`, `migrations/`, `.git` (:ro), repo (:rw for report) | `db` healthy, `db-patch-v2` completed | — (runs once) | `no` |
| `api` | `care-api` | build `Dockerfile` target `api` | 8080 | — (reached via nginx) | `object_storage`, `uploads_data` | `db` healthy, `db-patch-v2` + `schema-verify` completed | `curl /health` | `unless-stopped` |
| `web` | `care-web` | build `Dockerfile` target `web` (nginx) | 80 | `${HOST_PORT:-8888}:80` | — | `api` healthy | `wget /nginx-health` | `unless-stopped` |
| `migrate` | `care-migrate` | build `Dockerfile` target `migrate` | — | — | — | `db` healthy | — | `no` (profile `manual` — **not** started by a normal `up`) |

**Only `care-db` and `care-web` publish host ports.** `care-api` is reached exclusively through nginx (`care-web`) — it has no published port.

`care-migrate` is **manual/emergency only** (`--profile manual`). It runs the Drizzle TypeScript migrator (`db-deploy.ts`) — the same migrations by an alternative path — and is also the approved container for one-off owner-reviewed data scripts (e.g. Phase-F template consolidation).

### External / integration services (NOT in this compose — configured by env vars)

These run outside the CARE compose stack (on the NAS, a Windows PC, or the LAN) and are wired in purely through environment variables. The verifier treats an unset URL as **SKIPPED — NOT CONFIGURED**.

| Integration | Env var(s) | Typical location | Health probe used by verifier |
|---|---|---|---|
| Orthanc PACS | `ORTHANC_URL` / `ORTHANC_INTERNAL_URL` (+ `ORTHANC_USERNAME`/`PASSWORD`) | `care-pacs` on NAS / LAN `:8042` | `GET /system` |
| OHIF viewer | `OHIF_URL` / `OHIF_INTERNAL_URL` | LAN `:3010` | `GET /` |
| Ollama (LLM) | `OLLAMA_URL` / `OLLAMA_PRIMARY_URL` / `OLLAMA_FALLBACK_URL` | Windows PC / LAN `http://172.16.1.140:11434` | `GET /api/tags` (+ model-pulled check) |
| CARE AI Gateway | `AI_GATEWAY_URL` / `USG_AI_GATEWAY_URL` | custom gateway | `GET /health` |
| Conquest PACS (alt) | `CONQUEST_URL`, `CONQUEST_HOST`, `CONQUEST_PORT`, `CONQUEST_AE_TITLE` | LAN | (n/a — used when `PACS_PROVIDER=conquest`) |
| WhatsApp (Evolution) | `EVOLUTION_API_URL` (+ `WHATSAPP_*`) | LAN / cloud | `GET /` |
| n8n automations | `N8N_URL` | LAN / cloud | `GET /healthz` |
| Document scan bridge | `VITE_SCAN_BRIDGE_URL` | each billing PC `:8766` | (per-workstation) |
| Fingerprint bridge | `FINGERPRINT_BRIDGE_SECRET` | each workstation | (per-workstation) |

> **Do not confuse the medical-imaging inference backend with Ollama LLM config.** Ollama (`OLLAMA_*`) is the text/vision LLM used for report suggestions. PACS/DICOM (`ORTHANC_*`, `OHIF_*`, `WADO_*`) is the imaging backend. They are independent.

> **Historical note:** a standalone "Federated Radiology Service" (`artifacts/radiology-service`, its own DB) was scaffolded in compose but never built; it was removed 2026-07-07. Radiology reporting is fully integrated into `care-api` / the diagnostic-erp frontend. There is no separate radiology container.

---

## 2. API route surface (`care-api`, mounted under `/api`)

Routers are registered in `artifacts/api-server/src/routes/index.ts`. Auth guards:
`requireStaffAuth` + `requireStaffPermission("/x")` for staff routes, `requireAdminRole` for admin-only.

### Unauthenticated / infrastructure
| Path | Purpose |
|---|---|
| `GET /health` | Liveness (no auth, no DB) — used by the Docker healthcheck |
| `GET /api/health/schema` | Readiness — verifies `schema_deploy_state.db_patch_ok` + critical columns |
| `GET /api/system/version` | Deployed version / commit / build |
| `GET /nginx-health` | nginx liveness (answered by nginx, no API upstream) |

### Key authenticated groups (representative — see `index.ts` for the full list)
| Prefix | Guard | Subsystem |
|---|---|---|
| `/api/feature-flags` | read public / PATCH admin | Server-side feature flags (`ff_radiology_*`) |
| `/api/patients` | staff + `/patients` | Patient records |
| `/api/orders`, `/api/bills`, `/api/payments` | staff + permission | Billing / orders |
| `/api/reports` | staff + `/reports` | Report delivery |
| `/api/radiology-worklist*`, `/api/radiology/*` | staff | Canonical radiology worklist + reporting |
| `/api/care-usg-companion`, `/api/usg*` (extraction, doppler, reports, ai, cine, prior, pacs-return, admin) | staff / admin | USG Companion (P0–P9) |
| `/api/form-f` | staff | PCPNDT Form F |
| `/api/ai*`, `/api/ai-reporting`, `/api/ai-model*` | staff / admin | AI providers, model routing, gateway |
| `/api/admin/operations` | admin | Operational health / admin ops |
| `/api/accounting`, `/api/banking`, `/api/expenses`, `/api/commission` | staff + permission | Finance |
| `/api/display`, `/api/settings/queue-display`, `/api/payment-display` | token / public | Queue & payment displays |
| `/api/gateway-webhooks` | signature | Payment gateway callbacks (ICICI etc.) |
| `/api/hope-referrals`, `/api/integration/admin` | staff / admin | HOPE→CARE referral integration |

---

## 3. Frontend routes (`care-web` SPA, `artifacts/diagnostic-erp/src/App.tsx`)

All SPA routes return the app shell (HTTP 200); auth is enforced client-side + by the API.

| Route | Component | Notes |
|---|---|---|
| `/radiology/reporting`, `/radiology/study/:id`, `/radiology/usg/:studyId` | `RadiologyReportingWorkspace` | **THE canonical radiology/USG reporting workspace.** Old report routes redirect here. |
| `/radiology/usg-demo` | `UsgDemoMode` | Write-free USG demo (owner review) — see §10 |
| `/radiology/usg-rollout` | `UsgAdminReadiness` | USG activation control plane (Groups A/B/C, health-gated) |
| `/radiology/usg-admin-settings` | `UsgAdminSettings` | USG admin settings |
| `/radiology/usg-measurements[/:uid]` | `UsgMeasurementReview` | Measurement review |
| `/display/*`, `/display/payment-qr[...]` | queue / payment displays | Public kiosk displays |

---

## 4. One-line verification

```sh
pnpm operations:verify-deployment          # human-readable, all services
pnpm operations:verify-deployment --json    # machine-readable (Admin dashboard)
```

See `docs/CARE_ERP_ENVIRONMENT_MATRIX.md` for every variable each service reads.
