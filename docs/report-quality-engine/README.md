# CARE Universal Report Quality Engine (PR #101)

The final clinical safety & quality layer for the CARE Reporting Platform: **one**
deterministic quality engine that verifies every report — MRI, USG, CT, X-Ray, and
every future modality — for clinical completeness, internal consistency, and quality,
before it leaves the department.

This is **not** an AI project and **not** a new reporting workflow. It is a
consolidation of the quality logic that already exists across the platform into a
single canonical layer, plus the targeted new checks and data structuring that make
deterministic clinical verification possible.

## Why this starts with an audit

An audit of the platform at `HEAD` (15 agents, every reporting subsystem, 154 API
routes, 133 DB schemas) found that report-quality logic is **not missing** — it is
**scattered across six-plus overlapping engines**, three disjoint persistence tables,
and a sign-time audit blob. The primary risk of PR #101 is therefore shipping a
*seventh* parallel engine. The architecture here **extends and consolidates**; it does
not build V2s of anything.

- **[AUDIT + ARCHITECTURE](./ARCHITECTURE.md)** — what already exists (with file paths),
  the reuse map per requirement, the one canonical engine design, DB changes, integration
  points, the anti-duplication list, and the phased plan.
- **[FEASIBILITY](./FEASIBILITY.md)** — the candid data-model assessment: which checks are
  deterministic *today*, which need minimal structuring, which are heuristic-only, and
  which route to Copilot/AI.

## The one hard truth

The signed report is **free text** (`patient_reports.body` is HTML narrative).
Deterministic clinical checks are genuinely achievable today for **USG / OB / fetal /
Doppler / spine / saved-measurements** (typed data), but are **heuristic-warn-only** for
the CT / MR / X-ray narrative body until the dormant "D1 structured" layer is activated
(Phase 8 — the foundational bet). The engine reports honestly which checks it *could not*
evaluate rather than overclaiming determinism it cannot back.

## Decisions of record

| Decision | Choice |
|---|---|
| **Scope** | All 9 phases (0–8), landed as independently-shippable increments. |
| **Block policy** | Hard-block finalize **only on deterministic (structured-tier) blockers**. Heuristic text-scan findings stay warn-only, so radiologists are never gated by a false positive. |
| **Branch / PR** | Fresh branch `claude/report-quality-engine`; this PR (#101) anchored by this design doc. |

## Phase status

| Phase | Description | Status |
|---|---|---|
| 0 | Contract + shared `lib/report-quality/` package (no behavior change) | ✅ Landed |
| 1 | Route the live badge + Copilot through the one runner | ⏳ Planned |
| 2 | One server endpoint + canonical persistence (migration `0008`) | ⏳ Planned |
| 3 | Cheap deterministic unlocks (measurement `isAbnormal`, reference ranges, required sections, modality normalizer) | ⏳ Planned |
| 4 | Generalize structured USG/fetal/Doppler/spine rules | ⏳ Planned |
| 5 | Unified finalize gate + override | ⏳ Planned |
| 6 | Admin quality dashboard + trends | ⏳ Planned |
| 7 | Knowledge-pack clinical rules | ⏳ Planned |
| 8 | Activate D1 dual-write — universal structured checks | ⏳ Planned |

Each phase is a separate reviewable commit. This README's phase table is updated as
phases land.
