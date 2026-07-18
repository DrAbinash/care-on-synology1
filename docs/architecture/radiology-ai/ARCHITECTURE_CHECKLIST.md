# Radiology AI Platform — Architecture Checklist

A running conformance checklist against the constitution's non-negotiable principles (§22) and the
ONE-of-each guarantees. Tick items only when they are enforced **in code**, not merely intended.

## ONE-of-each guarantees

| Guarantee | Enforced today | Notes |
|---|---|---|
| One canonical study object | 🟡 Partial (P0) | `canonical_study` crosswalk + FK exist; consumers migrate in later phases. |
| One job engine | ✅ (P1) | AI jobs run on the existing `radiologyJobs.ts` runner (`ai_shadow_pipeline` handler); no second engine/worker/queue. |
| One scheduler | ✅ (P3) | Policy layer (`aiScheduler`/`schedulerService`) above the one job engine; no embedded queue. |
| One AI gateway | ✅ (P2) | `requestStructuredReport` in `lib/ai-providers` (hardened, not parallel); it is the shadow pipeline's inference seam. |
| One rules engine | ✅ (pre-existing, wired P2) | `lib/report-quality` runs before AI via `runDeterministicQuality`. |
| One measurement engine | ✅ (pre-existing) | `lib/measurements`. |
| One evidence store | ✅ (P1) | `ai_evidence` + `validateEvidenceAnchor` grounding gate (reused by the P2 gauntlet). |
| One processing manifest | ✅ (P1) | `ai_processing_manifests` + `computeInputHash`; P2 records real model+digest. |
| One evaluation framework | ✅ (P2) | golden set + runs + shadow/candidate/live human gate. |

## Non-negotiable principles — P0 conformance

- [x] **Backend-only, no clinical-workflow change** — P0 touches schema/routes/cron/CI only; no UI, no radiologist path.
- [x] **Deterministic before AI** — P0 adds no AI behavior at all.
- [x] **Backward compatible / incremental** — additive table, `NOT VALID` FK, idempotent migration, no deletes.
- [x] **Local-first PHI / egress controlled** — SSRF hardened; exact-endpoint allowlist added (`AI_EGRESS_ALLOWLIST`).
- [x] **Reproducible / grounded** — every load-bearing doc claim is machine-checked (G1); build fails on drift.
- [x] **Server-side identity** — `study_id` resolved server-side; client-supplied ids no longer trusted.
- [x] **No unarchived audit loss** — audit retention is archive-before-purge.
- [ ] **AI never blocks / degrade-never-block** — N/A in P0 (no AI path yet); enforced from G4 onward.
- [ ] **No finding without evidence** — G5/G9.
- [ ] **JSON-first reporting** — G11.

## Grounding claims coverage (G1)

The grounding manifest (`scripts/grounding.manifest.json`) currently pins **22** claims spanning the
Canonical Study identity, `ai_job_queue`, `dicom_incoming_studies` (real arrival signal), the worklist
`ai_draft_status` enum, the audit spine, the SSRF/egress fix, the one job engine (`radiologyJobs.ts`), and
the P0 migration. Extend this manifest whenever a design doc begins to depend on a concrete
table / column / function.
