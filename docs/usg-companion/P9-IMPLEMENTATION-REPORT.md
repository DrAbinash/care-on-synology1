# USG Companion — Phase P9 (Production readiness)

**Branch:** `claude/usg-companion-p9-production` (stacked on P8 `claude/usg-companion-p8-ai`).
**Flag:** `ff_radiology_usg_sugandha_mode` — **default OFF**.

P9 closes the project with a **safe-rollout readiness evaluator**. It encodes the
one rollout rule — *a flag may be enabled only when its phase is clinic-validated
and its dependencies are already enabled* — as pure, tested logic. It **enables
nothing**; it only computes what is safe to enable and what is still blocking.

## Delivered (pure + unit-tested)

| Export | Capability |
|---|---|
| `USG_PHASE_PLAN` | Canonical phase → flag → dependency plan for P0–P8. **Every phase defaults to `code_complete`, never `clinic_validated`** — the truthful state, since no real clinic validation has occurred in this environment. |
| `canEnableFlag(flag, phases, enabled)` | A flag is enableable only when its phase is `clinic_validated` **and** every dependency flag is enabled; otherwise blocked with explicit reasons. |
| `evaluateUsgReadiness(phases?, enabled?)` | Aggregates enableable-now vs blocked and overall production-readiness. Default call reports **NOT production-ready**. |
| `sugandhaModeProfile()` | The curated single-radiologist baseline (P0–P2 only). Returns the **plan** — enables nothing; P3–P8 stay OFF until individually validated. |

**Tests:** 8 new (`usgProductionReadiness`) — all green, including a test asserting no default phase is `clinic_validated`. Full-workspace `pnpm typecheck` 0 errors; flag-registry validation green with the new entry.

## Non-negotiable constraints honored

- **Nothing enabled automatically.** The evaluator computes a plan; enabling stays a human, per-flag action.
- **No false validation claim.** No phase is marked clinic-validated; the default report is truthfully "not production-ready". (Per instruction: *do not claim real-clinic validation unless it actually occurred* — it did not, in this container.)
- **Flag default OFF, `wired:false`.**

## Whole-project state at P9

All ten P3–P8 feature flags plus the P9 rollout flag are registered with correct
dependency ordering and `wired:false`; the flag-registry validation
(`radiologyOpsHealth`) passes. 82 pure unit tests across P4–P9 are green; the
full-workspace typecheck is clean; the api-server production build succeeds.

**Stop condition honored:** per the master mission, work stops **before enabling
any new USG feature in production**. Every flag is OFF; the canonical
`RadiologyReportingWorkspace` still serves all USG studies.

## Remaining (human actions, need real staging/clinic)

1. Run the deployed staging smoke per `USG_COMPANION_MASTER_HANDOVER.md` for each
   phase; mark that phase `clinic_validated` only after it genuinely passes.
2. Enable flags per-phase via `canEnableFlag`, starting with the P0–P2 baseline
   for Dr. Sugandha, keeping canonical as fallback.
3. P3/P6/P7 need a live Orthanc/viewer; P8 needs a live model gateway.

## Classification

**CODE COMPLETE (all phases) — CLINIC VALIDATION & PER-FLAG ENABLEMENT PENDING (human actions).**
