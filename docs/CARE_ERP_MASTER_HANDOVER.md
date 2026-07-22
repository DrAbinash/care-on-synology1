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
| `CARE_ERP_TROUBLESHOOTING.md` | Something is broken — symptom-driven fixes |
| `CARE_ERP_RECOVERY_GUIDE.md` | Restore/recover data & access safely |
| `CARE_ERP_OPEN_ISSUES.md` | Audit findings, what was fixed, what's still open |
| `HOW_TO_ADD_DB_MIGRATIONS.md` | Adding a schema change safely |

## One command to check everything
```sh
pnpm operations:verify-deployment        # PASS / FAIL / WARNING / SKIPPED per subsystem
pnpm operations:verify-deployment --json  # same, for the Admin dashboard
pnpm db:smoke                             # prove clean-boot + upgrade safety on a scratch DB
node scripts/check-migration-order.cjs    # static migration-order preflight
```

## Architecture in one breath
6 core containers — `care-db` → `care-db-patch-v2` (migrations) → `care-schema-verify` → `care-api` (Express, :8080) → `care-web` (nginx, :8888); `care-migrate` is manual-only. Orthanc/OHIF/Ollama/CARE-AI-Gateway/Evolution/n8n are **external** integrations wired by env vars (not compose services). Radiology + USG reporting is one canonical workspace (`RadiologyReportingWorkspace`); AI routes through the canonical provider layer (Ollama default `qwen3:14b`). PCPNDT/Form F is **fail-closed**. See the service map for detail.

## Stabilization status (this pass)
- ✅ **Clean-database bootstrap proven** end-to-end against real Postgres (`pnpm db:smoke` → 23/23); the `feature_flags` clean-boot hard-stop and the `admin_sessions` order problem are fixed.
- ✅ **Upgrade safety proven** — full migration re-run over populated data loses/duplicates nothing; a **signed report stays byte-identical**.
- ✅ **Typecheck green**; **full Vitest suite 253 files / 3303 tests / 0 failures** (real Postgres, sequential).
- ✅ **Deployment verifier** shipped (`pnpm operations:verify-deployment`, JSON-capable).
- ✅ **Provider hardening** — `qwen3:14b` is the approved default Ollama model everywhere; stale `llama3`/`gpt-oss` fallbacks and stale `.env.example` corrected.
- ✅ **10 audit findings** triaged; all Critical/High fixed (see OPEN_ISSUES).
- 📝 Two benign clean-boot Drizzle warnings documented; external LAN services (Ollama/Orthanc/OHIF) validate on the clinic network, not in a build sandbox.
- 🔜 Open for after the pause: USG owner-review UI simplification (§9), broader security deep-dive.

**Final status: READY WITH DOCUMENTED INFRASTRUCTURE LIMITATIONS** — the application, migrations, and deployment path are verified and safe; the only caveats are external LAN services that can only be exercised on the clinic network (validate on the NAS with the verifier).

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
