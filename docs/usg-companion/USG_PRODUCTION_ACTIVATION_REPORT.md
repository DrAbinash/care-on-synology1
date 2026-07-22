# USG Companion — Production Activation Report

**Status: USG COMPANION READY FOR OWNER REVIEW — CLASSIC FALLBACK AVAILABLE.**
Not clinically validated. Not yet for Dr. Sugandha (owner approval first).

> **Deployment honesty:** the code and the one-click activation control plane are
> complete and build-verified. The **actual deploy to the Synology production
> stack is the owner's step** — this build environment is an isolated cloud
> container with **no access** to the Synology NAS / Container Manager / registry.
> Nothing here claims a Synology deployment happened. §Deploy gives the exact
> steps.

---

## 1. What is delivered (merged / open PRs)

Branch base: `feature/website-login-redirection`.

| Area | PR(s) | State |
|---|---|---|
| P3–P9 vertical integration (7 slices) | #158,#160–#165,#167,#168,#171–#175 | merged |
| GAP 2 pregnancy timeline UI | #177 | merged |
| GAP 9 synthetic demo mode | #179 | merged |
| GAP 11 clinic test package | #178 | merged |
| **Activation control plane** (this) | this branch `claude/usg-activation-control-plane` | open |

## 2. Activation groups (the production flag policy)

**GROUP A — safe, deterministic (enable after build/route tests; no infra).**
`ff_radiology_usg_workspace` · `_companion_p2` · `_prior_intelligence` ·
`_pregnancy_timeline` · `_ob_canonical` · `_doppler_canonical`.
→ One click: **Admin ▸ USG Rollout ▸ "Enable safe features (Group A)"** (audited).

**GROUP B — infra-dependent (enable ONLY when health passes).**
| Flag | Needs |
|---|---|
| `ff_radiology_usg_dicom_extraction` | Orthanc |
| `ff_radiology_usg_exact_provenance` | Viewer |
| `ff_radiology_usg_cine` | Viewer |
| `ff_radiology_usg_report_to_pacs` | Orthanc |
| `ff_radiology_usg_ai_assistant` | AI gateway |
| `ff_radiology_usg_ai_growth` | AI gateway |
→ **"Enable infra features where healthy"** enables only those whose health check
passes now; the rest stay OFF and show *Needs Orthanc / Needs Viewer / Needs AI
Gateway* with remediation. The whole workspace stays usable regardless.

**GROUP C — always-on safety (never flag-toggled):** PCPNDT fail-closed, auth,
study locking, signed-report immutability, AI write-guard, no fetal sex,
cross-patient protection, no unapproved-measurement insertion, audit.

## 3. Live routes (after deploy + Group A enable)

- `/radiology/usg/:studyId` — USG Companion workspace (Group A).
- `/radiology/usg-demo` — synthetic demo (admin/radiologist; writes nothing).
- `/radiology/usg-rollout` — Admin activation / readiness / kill switch.
- `/radiology/report/:studyId` — Classic Workspace (always the fallback).

## 4. Feature status labels

| Label | Meaning |
|---|---|
| **LIVE** | flag ON, feature in use |
| **AVAILABLE** | safe to enable now (Group A, or Group B with healthy infra) |
| **UNAVAILABLE — INFRASTRUCTURE** | Group B, health check failing (Needs Orthanc/Viewer/AI Gateway) |
| **OWNER REVIEW PENDING** | built + activatable, awaiting Dr. Abinash |
| **CLINIC VALIDATION PENDING** | not validated on real studies |

## 5. Test totals (this session, real test Postgres)

Full-workspace `pnpm typecheck` clean; **api-server + diagnostic-erp production
builds succeed**; flag-source scan + flag-dependency validation green;
~100 unit/integration tests incl. real-Postgres integration for extraction
provenance, prior/timeline, OB/Doppler, PACS eligibility, cine key-frame, plus
the write-guard/no-fetal-sex/no-fabricated-frame/cross-patient guards. No
DB-dependent test skipped when `DATABASE_URL` is set.

## 6. Fallback & kill switch

- USG page crash → `ModuleErrorBoundary` + "Open Classic Workspace"; draft text preserved by the canonical draft store.
- Extraction/viewer/AI/PACS failure → reporting continues; the failing feature degrades to its unavailable state.
- **Kill switch** (Admin ▸ USG Rollout) disables all USG flags at once → worklist returns to Classic.

## 7. Deploy (owner's step — exact runbook)

1. Merge this PR (+ any remaining open ones) into `feature/website-login-redirection`.
2. On the Synology, pull the branch and rebuild via **Container Manager** (the project's normal workflow — not an ad-hoc deploy). Images: `care-api` + `care-frontend` + `care-migrate`.
3. Confirm health: frontend loads, `GET /api/health` ok, DB migrations applied ("Startup migrations applied"), auth works, worklist + Classic reporting unchanged.
4. Open **`/radiology/usg-rollout`** as admin → click **"Enable safe features (Group A)"**. Verify the USG workspace + demo load with no crash/routing loop.
5. Run the infra **health panel**; click **"Enable infra features where healthy"** — only healthy ones turn on.
6. Every activation is written to `usg_audit_log`.

Do **not** enable legacy-route redirects automatically. Do **not** finalize a real patient report during activation.

## 8. Remaining physical / infrastructure checks (not done here)

Require live infrastructure — see `USG_CLINIC_TEST_PACKAGE.md`:
- Orthanc reachability + Voluson SR/private-tag extraction (T2/T5).
- OHIF viewer frame navigation + cine playback (T3/T4).
- AI gateway authenticated health + generation (T10/T11).
- Live PACS encapsulated-PDF push + Weasis/OHIF read-back (T14).

## 9. Remaining code gaps (documented, not blocking owner review of what's built)

`USG_INTEGRATION_STATUS.md` lists them: full OB parity (NT/anomaly-checklist/
cervix/viability), SR-primary extraction swap, viewer navigation UI, cine player
UI, AI gateway generation + growth notes, pilot-user targeting. Each is scoped;
none blocks Group A owner review.

## 10. Owner review sequence (Dr. Abinash)

See `USG_CLINIC_TEST_PACKAGE.md` and the demo route. Recommended: open the demo →
normal abdomen → renal calculus → cholelithiasis → prostate volume →
pelvis/fibroid → pregnancy timeline → anomaly (where present) → Doppler →
cine fixture → AI (or unavailable state) → PCPNDT block → PACS dry-run (when
Orthanc healthy) → Return to Classic → kill switch + restore. Mark PASS/FAIL/
COMMENT per item.

## 11. Rollback

Disable any flag (or the kill switch) on `/radiology/usg-rollout` → the feature
hides and Classic returns; no data lost. No schema to reverse (activation adds no
tables). Legacy `/fetal-usg` and Classic Workspace remain intact for rollback.

---

**Final status: USG COMPANION LIVE FOR OWNER REVIEW (after deploy + one-click
Group A) — CLASSIC FALLBACK AVAILABLE. Not clinically validated. Not for Dr.
Sugandha until Dr. Abinash approves.**
