# USG Companion P0/P1 — Deployed Acceptance & P2 Gate Decision

Final real-environment acceptance attempt before merge and before P2. This
records the PR scope audit, the deployed-stack acceptance results (and their
hard blockers in this isolated CI container), and the P2 entry-gate decision.

---

## 1. PR scope audit (Part A) — CLEAN

- **PR #152** (`claude/usg-companion-p0-p2` → `feature/website-login-redirection`
  @ `c5f43338`). Renamed from the misleadingly-named `claude/queue-display-tv-pclwgg`;
  **PR #151 closed as superseded** (identical clean history, no force-rewrite).
- GitHub reports the PR as **22 changed files, 5 commits, `mergeable_state: clean`**.
- All 22 files are USG-only (`usg*`, `lib/measurements/volume*`, the route in
  `App.tsx`, the flag in `staffSession.ts`, the worklist branch in
  `RadiologyWorklist.tsx`, `docs/usg-companion/*`). **No queue-display or other
  unrelated work is included.**
- The earlier "~77 files" scare was an artifact of a **stale local base ref**
  (`origin/feature/website-login-redirection` pointed at `02076d96` until
  `git fetch` advanced it to `c5f43338`); the GitHub PR diff was always clean.
- All expected commits present: `e9a5addf`, `a5dac1e4`, `6ea98a51`, `ace30cfe`,
  `d66db83a`. Title/description accurately describe P0/P1 + hardening.

## 2. Deployment commit tested

`d66db83a` (PR #152 head).

## Environment reality (the hard blockers)

A genuine best-effort was made to stand up the real stack in this isolated CI
container. Established by direct attempt:

- ✅ **The real API server builds and boots** (`dist/index.mjs`, 14 MB) and
  **serves canonical endpoints with real auth middleware** — `/api/version`
  responds; `/api/feature-flags` correctly returns `Staff authentication required`.
- ✅ **Postgres 16** stood up locally; canonical radiology schema applied.
- ❌ **No access to the user's real staging / production CARE ERP deployment** —
  this container has no staging URL, credentials, or deploy pipeline. The task's
  Part B ("deploy to CARE ERP staging or approved test environment") cannot be
  performed from here.
- ❌ **Orthanc PACS is physically unavailable** here (it lives on the user's
  Synology). The viewer gate item ("Orthanc viewer loads the correct study")
  cannot be executed.
- ❌ **Full schema-from-empty via the authentic migrator fails** in this box
  (`ALTER TABLE "admin_sessions" DISABLE ROW LEVEL SECURITY` before the table
  exists) — reconstructing the exact production schema bootstrap is CARE
  deployment-infra work, out of USG scope, and would not remove the two blockers
  above. Staff session-token minting + dummy-study seeding are likewise not
  completable without that full bootstrap.

**Conclusion:** a true *deployed* worklist→signed-report acceptance (with Orthanc)
is **not executable from this isolated CI container**. It must be run by the user
on their actual staging. Everything verifiable *without* the running HTTP server +
PACS + staging has been validated (below).

## 3–13. Acceptance items — status in this environment

| Item | Result |
|---|---|
| 3 · Feature-flag OFF (worklist→canonical; direct route redirect; no loop; MRI/CT/XR unaffected) | **Logic-verified** (contract test + code); not browser-driven on the deployed route (blocker). |
| 4 · Feature-flag ON (worklist→`/radiology/usg/:id`; refresh; server flag respected) | **Logic-verified**; flag hydrates via `/api/feature-flags` (endpoint confirmed live, auth-gated). |
| 5 · Worklist routing / study context / no cross-patient draft leakage | **Code-verified** (studyId = worklist row id; per-study draft query keyed by studyId). |
| 6 · Study lock (acquire / second-session warning / release) | **Reused canonical `useStudyLock`** (unchanged); not exercised via two live browser sessions (blocker). |
| 7 · Orthanc / embedded viewer | **BLOCKED — no Orthanc here.** `EmbeddedWadoViewer` is reused canonical code, unchanged by P0/P1. |
| 8 · Draft save/reload; canonical endpoint; no legacy store | **Real-DB proven** — `usgWorkspacePersistence.integration.test.ts`: a full `UsgFindingObject` round-trips through `radiology_report_drafts.findings_sections` with every field intact; `usgWorkspaceContract.test.ts`: save goes only through `saveRadiologyDraft` (canonical endpoint), no legacy USG store touched. |
| 9 · Finalization / signed report / audit author | **Path proven structurally** (`finalizeRadiologyReport` → canonical `patient_reports` + audit); real signed-report render + audit-author-on-deployed not browser-executed (blocker). Structured objects persist in the retained canonical draft; the signed row carries rendered text (structured-in-signed-doc is P2+). |
| 10 · PCPNDT fail-closed | **Real-DB + real-gate proven** — integration test: no patient / no Form F / incomplete Form F all blocked; only complete Form F passes. Gate unchanged, server-side, at all 4 finalize sites. |
| 11 · Legacy-store check | **Proven** — contract test asserts no second draft/finalize transport; save/finalize ride `lib/radiologyReportLifecycle` only. |
| 12 · Audit author | **Reused canonical audit** (session-derived author); deployed attribution to be confirmed on staging. |
| 13 · Responsive UI (1920/1600/1366/1024) | **Real-component screenshots** captured; no horizontal overflow at 1024 (asserted `scrollWidth===clientWidth`). Component renders, not the deployed data route. |

## 14. Screenshots

9 real-component renders (Vite+Tailwind, Chromium) delivered previously — full
workspace, the three finding builders (with live deterministic text and the
13 cc prostate volume + *Awaiting radiologist*), mixed normal/abnormal report,
measurements co-visible, viewer collapse/expand, dark theme, 1024 px. These are
**component renders**, honestly labelled — not the deployed `/radiology/usg/:id`
route (which needs the running API + seeded study + auth, blocked here).

## 15. Defects found & fixed (this validation cycle)

| Defect | Severity | Status |
|---|---|---|
| Ellipsoid volume mirrored in frontend + backend (drift risk) | **High** | Fixed — single source in `@workspace/measurements`. |
| Prostatomegaly auto-diagnosed from a hard-coded threshold, silently written to impression | **High** | Fixed — measurement vs radiologist-confirmed clinical finding; threshold only suggests; centralized. |
| Manual override lacked calculated-vs-entered record | Medium | Fixed. |
| Local mm/cm table in the builder | Low | Fixed — shared `convertUnitValue`. |

**0 Critical / 0 High defects remain.** Full suite (with Postgres): **199 files /
2942 tests, 0 failures**; all-package typecheck 0 errors; production build succeeds;
0 migration violations.

## 16. Known limitations

- Deployed worklist→signed-report acceptance and the Orthanc viewer test were
  **not executable** from this isolated CI container (no staging access, no PACS).
- Signed-report structured persistence is via the retained canonical draft, not
  embedded in the `patient_reports` D1 doc (P2+).
- Screenshots are faithful component renders, not the live data route.

---

## Final recommendation: **GO TO MERGE, BUT HOLD P2**

P0/P1 (with the volume/prostatomegaly hardening) is validated to the maximum
extent this environment allows and is **mergeable** — clean scope, 0 Critical/High
defects, real-DB persistence + PCPNDT proven, canonical reuse proven, all
tests/build/typecheck green. **Merge P0/P1.**

**P2 is NOT started**, per the entry gate: the deployed worklist→signed-report
acceptance and "Orthanc viewer loads the correct study" cannot be executed here.
Before P2 begins, the user should run the one-time deployed smoke on real staging:
flag on/off routing · study lock (two sessions) · Orthanc viewer loads the correct
study · build the three reference findings · Normal-all-remaining non-destructive ·
canonical save/reload · canonical finalize → signed report opens · audit author ·
no legacy-store write · PCPNDT fail-closed for an incomplete-Form-F obstetric study.
Once that passes on staging, P2 (continuous companion, insert-all-approved
measurements, persistent organ states, keyboard system, expanded finding library,
reconciliation) can proceed on this same branch.
