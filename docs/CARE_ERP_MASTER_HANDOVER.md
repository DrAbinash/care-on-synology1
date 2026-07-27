# CARE ERP — Master Handover

_Final stabilization handover before the one-month development pause. Start here._

## What this is
The CARE ERP is a diagnostic-centre platform (billing, orders, pathology, radiology/USG reporting, PACS, AI-assisted reporting, payments, messaging). This document is the index for operating and debugging it **without repository archaeology** during the pause.

## Handover document set
| Doc | Use it when |
|---|---|
| **CARE_ERP_MASTER_HANDOVER.md** (this) | Orientation, status, owner review checklist |
| `CARE_ERP_ROUTE_AND_SERVICE_MAP.md` | "What container/route serves X?" |
| `CARE_ERP_ENVIRONMENT_MATRIX.md` | "What does env var X do? Is it required/secret?" |
| `CARE_ERP_DEPLOYMENT_RUNBOOK.md` | Deploying / rolling back on the NAS |
| `CARE_ERP_NAS_VALIDATION_CHECKLIST.md` | Clinic-network go/no-go checklist (PASS/WARN/FAIL) |
| `CARE_ERP_TROUBLESHOOTING.md` | Something is broken — symptom-driven fixes |
| `CARE_ERP_RECOVERY_GUIDE.md` | Restore/recover data & access safely |
| `CARE_ERP_BACKUP_RESTORE.md` | **Back up the database and restore from a backup (tested step-by-step)** |
| `CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md` | **Bring the whole system up on a second Synology NAS in minutes** |
| `CARE_ERP_SECURITY_REVIEW.md` | Router-surface + login security review (no Critical/High) |
| `CARE_ERP_OPEN_ISSUES.md` | Audit findings, what was fixed, what's still open |
| `HOW_TO_ADD_DB_MIGRATIONS.md` | Adding a schema change safely (+ Drizzle re-baseline procedure) |

## One command to check everything
```sh
pnpm operations:verify-deployment        # PASS / FAIL / WARNING / SKIPPED per subsystem
pnpm operations:verify-deployment --json  # same, for the Admin dashboard
pnpm db:smoke                             # prove clean-boot + upgrade safety on a scratch DB
pnpm db:bootstrap                         # build a test/dev DB from the authentic migration path
node scripts/check-migration-order.cjs    # static migration-order preflight
```
CI (`.github/workflows/ci.yml`) runs the typecheck, migration-order, grounding, full test suite and clean-boot smoke on every PR + integration-branch push, so these gates are enforced automatically now, not just locally.

## Architecture in one breath
6 core containers — `care-db` → `care-db-patch-v2` (migrations) → `care-schema-verify` → `care-api` (Express, :8080) → `care-web` (nginx, :8888); `care-migrate` is manual-only. Orthanc/OHIF/Ollama/CARE-AI-Gateway/n8n are **external** integrations wired by env vars (not compose services). Radiology + USG reporting is one canonical workspace (`RadiologyReportingWorkspace`); AI routes through the canonical provider layer (Ollama default `qwen3:14b`). PCPNDT/Form F is **fail-closed**. See the service map for detail.

## Stabilization status
- ✅ **Clean-database bootstrap proven** end-to-end against real Postgres (`pnpm db:smoke` → 23/23); the `feature_flags` clean-boot hard-stop and the `admin_sessions` order problem are fixed. **Both** the container path (`care-db-patch-v2`) and the manual `care-migrate` path now clean-boot an empty database.
- ✅ **Upgrade safety proven** — full migration re-run over populated data loses/duplicates nothing; a **signed report stays byte-identical**.
- ✅ **Typecheck green**; **full Vitest suite 255 files / 3322 tests / 0 failures** (real Postgres, sequential).
- ✅ **CI added** (`.github/workflows/ci.yml`) — typecheck, migration-order, grounding, tests, clean-boot smoke on every PR. First run green.
- ✅ **Deployment verifier** shipped (`pnpm operations:verify-deployment`, JSON-capable) + wired into Admin Operational Health (Ollama+model, AI/PACS queues, study locks).
- ✅ **Provider hardening** — `qwen3:14b` is the approved default Ollama model everywhere; stale `llama3`/`gpt-oss` fallbacks and stale `.env.example` corrected.
- ✅ **USG Companion Basic/Advanced** progressive disclosure (Basic default hides technical detail; capability one click away) — panel-only, canonical workspace untouched.
- ✅ **Security pass** across ~153 routers + login/session — **no Critical/High findings** (`CARE_ERP_SECURITY_REVIEW.md`); login is strong (bcrypt + lockout + WebAuthn + LAN-restrict).
- ✅ **Backup/restore + second-NAS disaster recovery** documented and the round-trip tested (`CARE_ERP_BACKUP_RESTORE.md`, `CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md`).
- 📝 Two benign clean-boot Drizzle warnings are filtered + documented; a true history re-baseline is a documented prod-DB-in-hand maintenance task.
- 🔜 Left for you (not code): run the NAS validation checklist on the clinic LAN; config hardening (change bootstrap PIN, WebAuthn for admins, confirm backups); optional Drizzle re-baseline.

**Final status: READY WITH DOCUMENTED INFRASTRUCTURE LIMITATIONS** — the application, migrations, both deploy paths, backup/restore and disaster recovery are verified and documented; the only caveats are external LAN services that can only be exercised on the clinic network (validate on the NAS with the verifier + `CARE_ERP_NAS_VALIDATION_CHECKLIST.md`).

Nothing here enables real clinical usage automatically — all USG/AI features stay behind their existing rollout flags (kill switch = disable the flag in Admin → Feature Flags).

---

## Owner review checklist (for Dr. Abinash)
Do these in order on the deployed NAS. Mark **PASS / FAIL / COMMENT**.

| # | Step | How | PASS/FAIL | Comment |
|---|---|---|---|---|
| 1 | Login | Open `http://<nas>:8888`, sign in | | |
| 2 | Open Operational Health | Admin → Operational Health | | |
| 3 | Confirm core services | verifier tiles: DB, API, schema all green | | |
| 4 | Open USG Demo | `/radiology/usg-demo` — shows "DEMO — NO REAL PATIENT DATA" | | |
| 5 | Normal whole abdomen | demo card → report renders | | |
| 6 | Renal calculus | demo card → findings render | | |
| 7 | Cholelithiasis | demo card | | |
| 8 | Prostate calculation | demo card → volume computed | | |
| 9 | Female pelvis / fibroid | demo card | | |
| 10 | Pregnancy timeline | demo card → timeline renders | | |
| 11 | Anomaly checklist | demo card | | |
| 12 | Doppler | demo card (obstetric/venous) | | |
| 13 | Viewer | Open Viewer (Orthanc/OHIF) — or graceful "unavailable" | | |
| 14 | AI test | AI suggestion demo / Test Connection uses `qwen3:14b` | | |
| 15 | PCPNDT simulation | demo "PCPNDT Block" — action refused (fail-closed) | | |
| 16 | PACS dry run | demo "PACS Dry Run" — no real push | | |
| 17 | Return to Classic | button restores Classic workspace | | |
| 18 | Kill switch | disable a `ff_radiology_usg_*` flag → feature hides, reporting still works | | |
| 19 | Recovery | (optional) follow RECOVERY_GUIDE §E admin recovery on a test box | | |
| 20 | Final comments | overall readiness notes | | |

Expected: every step PASS, or a benign COMMENT for an external service you haven't wired yet (Viewer/AI show a clean "unavailable" state, never a white screen).
