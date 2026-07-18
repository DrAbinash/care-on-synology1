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
| G12 | P4 | DICOM SR (TID 1500) content model → existing `dicom_sr_export_queue` (additional export) | ✅ Done | 2026-07-18 |
| G13 | P4 | Encapsulated PDF exports (versioned storage/link layer) | ✅ Done | 2026-07-18 |
| G14 | P4 | GSPS presentation-state foundation (storage interface only) | ✅ Done | 2026-07-18 |
| G15 | P4 | DICOM SEG foundation (storage interface only) | ✅ Done | 2026-07-18 |
| G16 | P4 | MPPS events + Storage Commitment status | ✅ Done | 2026-07-18 |
| G17 | P4 | HL7/FHIR R4 backend mappers → `fhir_export_log` (no external send) | ✅ Done | 2026-07-18 |
| G18 | P4 | Viewer sync deep-links (OHIF/Weasis) over existing `studyLaunchService` | ✅ Done | 2026-07-18 |
| G19 | P4 | Immutable AI timeline (append-only version history) | ✅ Done | 2026-07-18 |
| G20 | P4 | AI version comparison (AI-vs-AI diff) | ✅ Done | 2026-07-18 |
| G21 | P4 | Human feedback dataset (de-identified; no retraining) | ✅ Done | 2026-07-18 |
| G22 | P4 | Enterprise API surface `/api/ai/interop` (gated) | ✅ Done | 2026-07-18 |

## Phase status

- **P0 — Foundation:** ✅ **Complete** (G1, G2, G3). See `P0_IMPLEMENTATION_REPORT.md`.
- **P1 — Execution:** ✅ **Complete** (G4, G5, G6) — shadow mode. See `P1_IMPLEMENTATION_REPORT.md`.
- **P2 — Trust:** ✅ **Complete** (G7, G8, G9) — shadow mode. See `P2_IMPLEMENTATION_REPORT.md`.
- **P3 — Clinical:** ✅ **Complete** (G10, G11) — the FIRST radiologist-visible phase, fully feature-flagged (AI OFF by default; pilot-only). See `P3_IMPLEMENTATION_REPORT.md`. One scheduler over the existing engine (5 modes), a gated `/api/ai` surface, and a flag-guarded AI Draft Panel in the workspace. Radiologist is the only signer.
- **P4 — Enterprise Interoperability:** ✅ **Complete** (G12–G22). See `P4_IMPLEMENTATION_REPORT.md`. Standards-based exchange as **additional** exports/interfaces: DICOM SR (TID 1500) via the existing SR export queue, encapsulated PDF, GSPS/SEG foundations, MPPS + Storage Commitment status, FHIR R4 mappers (resources only), viewer deep-links over the existing launch service, the immutable AI timeline, AI-vs-AI comparison, and a de-identified feedback dataset (no retraining). All behind the P3 gate; exports admin-only; AI still never signs, writes the report, or auto-learns.
- **P5 — Production Hardening & Validation:** ✅ **Complete** (no new gates — validation + hardening). See `P5_VALIDATION_REPORT.md`. Full typecheck/2645 tests/105-claim grounding/migration-order all green; a three-front adversarial review closed 11 real defects (2 SSRF, 2 concurrency data-integrity races, a PHI-in-feedback-export leak, an interop flag-gating hole, a workspace cross-study state bug, snapshot/truncate immutability + guard hardening). Core safety spine confirmed intact (AI never signs/writes reports/auto-learns; default-OFF). **Recommendation: READY FOR CLINICAL PILOT, conditional on the staging DICOM/PACS/viewer/DB E2E** (no live stack in CI). Residual items (DNS-rebind pinning, legacy Ollama-proxy flag-gating, legacy auto-prefill) documented with remediation.
- **P6 / Frontier:** ⬜ later (not begun).

## Hard prerequisites still open (from the audit / constitution)

- Audit-archive completeness — **addressed in P0/G2** (archive-before-purge). ✅
- Backup 5,000-row truncation (CRIT-1) — already fixed pre-blueprint (`cron.ts`, Ticket E0.1). ✅ (no action)
- `ai_job_queue.study_id` FK — **addressed in P0/G3** (`NOT VALID`; validate after orphan reconciliation). ✅
