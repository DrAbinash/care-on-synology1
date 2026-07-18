# Changelog

Notable, reviewable changes to CARE ERP. Newest first.

## [Unreleased]

### Radiology AI Platform — Phase P2 (Trust Layer, Shadow Mode) — 2026-07-18

The AI Gateway, Evaluation Framework, and Rules-Before-AI (gates G7–G9), still **SHADOW MODE** — the P1
stub is replaced by a real gateway, but no radiologist sees output and no reporting workflow/UI changed.
Built with the Strangler Pattern (reuse, no parallel implementations).

**Added — G7 AI Gateway** (hardened evolution of `lib/ai-providers`, reusing its provider routing)
- `requestStructuredReport` — capability routing, **model digest/version pinning** (`ai_model_capabilities`),
  local-first PHI policy, timeout, retry, **circuit breaker** (derived from the existing
  `ai_provider_health_logs`), provider fallback, **schema projection**, and JSON **validation/repair**.
- `gatewayInferenceProvider` replaces the P1 stub at the pipeline's inference seam (still shadow).

**Added — G8 Evaluation Framework**
- `ai_golden_cases`, `ai_evaluation_runs`, `ai_evaluation_case_results`, `ai_model_versions`.
- `runEvaluation` (critical-finding recall + structured-report validation), and a
  **shadow → candidate → live** lifecycle where **live requires explicit human approval** (`approveVersion`).

**Added — G9 Rules Before AI**
- Reuses `runQualityEngine` (deterministic engine runs over the structured draft before AI).
- Trust gauntlet: evidence **grounding** (reuses P1 `validateEvidenceAnchor`), **laterality**, **negation**,
  and **contradiction** checks that **quarantine** invalid findings; **deterministic findings override AI**;
  **degrade-to-deterministic** when the gateway fails.

**Migration** `migrations/add_ai_gateway_and_evaluation.sql` (5 additive tables, idempotent).

**Verification** — typecheck (libs + api-server) ✅; `pnpm test` → **2582 pass** (+38 P2 tests; same 7
pre-existing `DATABASE_URL` file errors); grounding (59) + migration-order ✅. End-to-end/DB/provider paths
require staging (no DB/Orthanc/providers in this environment) — see `P2_IMPLEMENTATION_REPORT.md` §8.

### Radiology AI Platform — Phase P1 (AI Execution Layer, Shadow Mode) — 2026-07-18

Backend AI execution infrastructure running in **SHADOW MODE** (gates G4–G6). **No radiologist-facing
output, no report changes, no reporting UI, no AI Gateway/model call.** Nothing is exposed to radiologists.

**Added**
- **Immutable Study Snapshot** (`study_snapshots`) — order-independent content hash of the actual DICOM
  instance set; late-arriving series create a new revision and supersede (never overwrite) the previous one.
- **Processing Manifest** (`ai_processing_manifests`) — immutable record of study identity, snapshot hash,
  model/prompt/pack/rules/measurement versions, image selection, timestamps, and a reproducibility `input_hash`.
- **Evidence Store** (`ai_evidence`) — per-finding anchors (series/SOP/frame, measurement ref, confidence)
  with a grounding gate (`validateEvidenceAnchor`). Heatmap evidence type + `overlay_ref` are **reserved only**.
- **Shadow structured draft** (`ai_shadow_drafts`) — JSON-first provisional report, shadow-only.
- **Structured, modality-aware image selection** (`selectImageAnchors` / `selectStudyImages`) returning
  `{seriesUid, sopUid, frameNumber, imageData}` with full provenance (G6).
- **AI execution on the existing job engine** — `ai_shadow_pipeline` handler registered in
  `RADIOLOGY_JOB_HANDLERS`; enqueued via the existing `enqueueRadiologyJob`. **No new scheduler/worker/queue.**
- **Reserved inference seam** (`shadowInference.ts`) — the single interface the P2 AI Gateway plugs into;
  P1 uses a stub that calls no model.
- Migration `migrations/add_ai_execution_shadow.sql` (four shadow tables, idempotent, additive) and
  +18 grounding claims (now 40).

**Verification**
- `pnpm typecheck:libs` ✅, api-server typecheck ✅, `pnpm test` → **2544 pass** (+31 P1 tests; same 7
  pre-existing `DATABASE_URL` file errors), grounding (40) + migration-order checks ✅.

### Radiology AI Platform — Phase P0 (Foundation) — 2026-07-18

Backend foundation for the Radiology AI Platform (gates G1–G3 of
`docs/architecture/radiology-ai/V1.1_IMPLEMENTATION_CONSTITUTION.md`). **No clinical-workflow change,
no radiologist-facing UI, no AI features** — this phase only strengthens the backend so later AI phases
have a reliable foundation.

**Added**
- **Canonical Study crosswalk** (`canonical_study` table + `lib/db/src/schema/canonicalStudy.ts`) keyed on
  `studyInstanceUID`, backfilled from `radiology_studies`. (G3)
- **Server-side study-id resolution** (`artifacts/api-server/src/lib/canonicalStudy.ts`): `POST /ai-jobs`
  now resolves/validates the study server-side and accepts the canonical `studyInstanceUid`; client-supplied
  ids are never trusted verbatim. (G3)
- **`ai_job_queue.study_id → radiology_studies.id` foreign key** (Drizzle `.references()` + a `NOT VALID`
  migration). (G3)
- **Grounding CI** (`scripts/grounding-check.cjs` + `scripts/grounding.manifest.json` + vitest gate):
  mechanically validates that documentation's table/column/function claims match the code; wired into
  `build` and `pnpm test` so the build fails on documentation↔code drift. (G1)
- **Exact-endpoint egress allowlist** via `AI_EGRESS_ALLOWLIST` (authoritative when set, even in LAN mode). (G2)
- Migration `migrations/add_canonical_study_crosswalk.sql` (idempotent, forward/backward compatible, `NOT VALID` FK).
- Docs: `P0_IMPLEMENTATION_REPORT.md`, `IMPLEMENTATION_TRACKER.md`, `ARCHITECTURE_CHECKLIST.md`, `P0_MIGRATION_GUIDE.md`.

**Fixed (security — G2)**
- **SSRF guard** (`radiologyOllama.ts`): the `100.64.0.0/10` CGNAT/Tailscale tailnet range is now blocked
  outside Local/LAN mode (previously reachable), cloud-metadata hosts (`169.254.169.254`, `metadata.google.internal`)
  are blocked unconditionally (even in Local/LAN mode), and IPv6 unique-local is covered.
- **Audit-log retention** (`cron.ts`): retention is now **archive-before-purge in batches**, deleting only the
  ids durably written to a checksummed archive — eliminating the prior path that archived at most 5,000 rows
  but deleted every row past the cutoff (unarchived data loss on any backlog > 5,000).

**Verification**
- `pnpm typecheck:libs` ✅, `pnpm --filter @workspace/api-server typecheck` ✅, `pnpm test` → 2513 pass
  (7 pre-existing test files error only on missing `DATABASE_URL`), grounding + migration-order checks ✅.
