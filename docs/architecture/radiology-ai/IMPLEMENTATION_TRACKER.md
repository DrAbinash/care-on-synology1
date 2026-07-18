# Radiology AI Platform — Implementation Tracker

Live status of the gated build order from `V1.1_IMPLEMENTATION_CONSTITUTION.md` §20/§21.
Update this file as gates land. **Do not build a gate before its prerequisites are ✅.**

| Gate | Phase | Description | Status | Landed |
|---|---|---|---|---|
| **G1** | P0 | Mechanized documentation↔code grounding CI | ✅ Done | 2026-07-18 |
| **G2** | P0 | Security: egress allowlist + SSRF hardening + audit archive-before-purge | ✅ Done | 2026-07-18 |
| **G3** | P0 | Canonical Study crosswalk + `ai_job_queue.study_id` FK + server-side resolution | ✅ Done | 2026-07-18 |
| G4 | P1 | One Job Engine wired to AI jobs (reuse `radiologyJobs.ts` runner + `idempotencyKey`) | ✅ Done | 2026-07-18 |
| G5 | P1 | Immutable Study Snapshot + Processing Manifest + Evidence Store | ✅ Done | 2026-07-18 |
| G6 | P1 | Structured image selection returns `{seriesUid, sopUid, frameNumber}` anchors | ✅ Done | 2026-07-18 |
| G7 | P2 | AI Gateway hardening — Capability + Prompt Registry + schema projection | ✅ Done | 2026-07-18 |
| G8 | P2 | Evaluation Framework + Golden Dataset (ADR D-17) | ✅ Done | 2026-07-18 |
| G9 | P2 | Rules Engine before AI + grounding gate on findings | ✅ Done | 2026-07-18 |
| G10 | P3 | AI Scheduler + 5 processing modes (Immediate first) | ✅ Done | 2026-07-18 |
| G11 | P3 | Reporting integration (workspace AI panel, feature flags, voice hook) | ✅ Done | 2026-07-18 |
| G12 | P4 | DICOM SR (TID 1500) encoder + multi-hospital tenant fairness | ⬜ Not started | — |

## Phase status

- **P0 — Foundation:** ✅ **Complete** (G1, G2, G3). See `P0_IMPLEMENTATION_REPORT.md`.
- **P1 — Execution:** ✅ **Complete** (G4, G5, G6) — shadow mode. See `P1_IMPLEMENTATION_REPORT.md`.
- **P2 — Trust:** ✅ **Complete** (G7, G8, G9) — shadow mode. See `P2_IMPLEMENTATION_REPORT.md`.
- **P3 — Clinical:** ✅ **Complete** (G10, G11) — the FIRST radiologist-visible phase, fully feature-flagged (AI OFF by default; pilot-only). See `P3_IMPLEMENTATION_REPORT.md`. One scheduler over the existing engine (5 modes), a gated `/api/ai` surface, and a flag-guarded AI Draft Panel in the workspace. Radiologist is the only signer.
- **P4 — Enterprise:** ⬜ next (DICOM SR encoder, critical-findings consolidation, mammography content, multi-hospital fairness/federation).
- **P3 — Clinical:** ⬜ blocked on P2. **No provisional report reaches a radiologist before G5, G6, G8, G9.**
- **P4 — Enterprise / P5 — Frontier:** ⬜ later.

## Hard prerequisites still open (from the audit / constitution)

- Audit-archive completeness — **addressed in P0/G2** (archive-before-purge). ✅
- Backup 5,000-row truncation (CRIT-1) — already fixed pre-blueprint (`cron.ts`, Ticket E0.1). ✅ (no action)
- `ai_job_queue.study_id` FK — **addressed in P0/G3** (`NOT VALID`; validate after orphan reconciliation). ✅
