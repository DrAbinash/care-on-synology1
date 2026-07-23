# Changelog

Notable, reviewable changes to CARE ERP. Newest first.

## [Unreleased]

### Accounting — Balance Sheet correctness + printable Schedule III statements — 2026-07-23

Fixes a real double-entry defect and adds filing-ready financial statements. **No change to voucher
wiring, bill balances, or the zero-sum ledger invariant** — this is a reporting-layer fix plus new UI.

**Fixed**
- **Balance Sheet never balanced when an account's sign was "abnormal" (HIGH).** The `/api/accounting/balance-sheet`
  builder only placed an account on the sheet when its balance sign matched a hard-coded expectation
  (asset ⇒ debit, liability ⇒ credit) **and** its Tally group was recognised; every other non-zero account
  — e.g. a Cash-in-Hand ledger driven to a *credit* (overdrawn) balance, or an account with an unmapped
  group — was silently dropped. Since the ledger is zero-sum, dropping any balance breaks the identity, which
  is why the UI showed `Difference: ₹19,515 / Liabilities ₹0.00`. The builder now places every non-P&L
  account by the **sign** of its closing balance (debit → assets, credit → liabilities & capital) and drops
  nothing, so `totalAssets === totalLiabilities` for any sequence of balanced vouchers.
- Report math extracted to a pure, database-free, unit-tested module
  (`api-server/src/lib/accounting/reportBuilders.ts`, 10 tests) covering the invariant and the exact reported
  scenario; the Trial Balance and P&L endpoints were rewired to the same builders with **identical** behaviour.

**Added**
- **Financial Statements tab** (`diagnostic-erp/.../accounting/FinancialStatements.tsx`) — Schedule III (Revised)
  Balance Sheet + Statement of Profit and Loss + Trial Balance, with comparative prior-year columns, a
  Note No. column, "In ₹", grouped line items and grand totals, matching the auditor-filed format.
- **Print · PDF · Word** export, each report on its **own separate sheet** (`diagnostic-erp/src/lib/statementExport.ts`,
  reusing the app's jsPDF/docx export stack). One shared row model drives the screen view and both exports.

**Changed**
- The Trial Balance / P&L / Balance Sheet queries now use the shared `FINANCIAL_QUERY_OPTIONS` (immediate
  refetch on open + 15s live refresh), so opening a report tab no longer shows stale cached numbers.

### Radiology AI Platform — Phase P5 (Production Hardening & End-to-End Validation) — 2026-07-18

Feature-complete hardening pass — **no new features**. A three-front adversarial review (AI backend seams,
safety invariants, workspace binding) plus empirical testing found and this phase **fixed 11 real defects**;
the core safety spine was confirmed intact (AI never signs, never writes `patient_reports`, never
auto-learns; everything default-OFF and flag-gated). See
`docs/architecture/radiology-ai/P5_VALIDATION_REPORT.md`.

**Security fixes**
- **SSRF (HIGH):** `/radiology-ollama/test` took a client-controlled `allowLocal` flag — an authenticated
  low-privilege SSRF oracle. Now derives it from the saved admin policy and requires the AI permission.
- **SSRF filter bypass (MED-HIGH):** `localhost.` (trailing dot) and IPv4-mapped IPv6
  (`[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`) evaded the guard (empirically confirmed). Added host
  canonicalization; the whole SSRF guard is extracted to a pure, unit-tested module (`lib/ssrf/ollamaUrlGuard.ts`).
- **PHI in "de-identified" feedback dataset (MED):** free-text `reason` (+ edited text) is no longer emitted
  in the export (still captured in `ai_draft_feedback` for authorized analytics).
- **Interop flag-gating hole (MED):** SR/FHIR/feedback **export** endpoints now require `ff_radiology_ai` ON
  **and** admin (previously admin-only, live even with AI off).

**Data-integrity / immutability fixes**
- **Duplicate provisional versions (HIGH):** `(study_instance_uid, version)` is now **UNIQUE**; the pipeline
  retries the version on conflict — two concurrent jobs can no longer both write "v2".
- **Racy manifest idempotency (MED):** `input_hash` is now **UNIQUE** with `onConflictDoNothing`, so a raced
  reprocess is a clean no-op instead of duplicating work.
- **Snapshot immutability now DB-enforced:** a column-guarded trigger allows only the `is_current`/
  `superseded_at` supersede and rejects any content change/delete; `ai_shadow_drafts` gains a `TRUNCATE` guard.
- **`buildInteropReport`** now only exports `validated` drafts (honors its contract).

**Workspace fix**
- **AI Draft Panel cross-study state (MED-HIGH):** `handled` (accept/edit/reject) is reset when the study or
  draft version changes — previously a prior study's state leaked in and made the new study's findings render
  as already-handled and silently un-insertable.

**Hardening**
- AI-isolation guard extended: raw-SQL patterns + a missing `delete(radiology_report_drafts)` rule (closes
  alias/raw-SQL evasion for the P0–P4 AI subsystem).
- Migration `add_ai_shadow_uniqueness_hardening.sql` — additive, idempotent, **duplicate-guarded** unique
  indexes (no hard-fail on legacy data). Grounding 101 → **105** claims. Full suite **2645 pass**.

**Assessment:** READY FOR CLINICAL PILOT (AI default-OFF, pilot-only), conditional on the staging
DICOM/PACS/viewer/DB end-to-end run (no live stack in CI). Not yet cleared for full production. Residual
items (DNS-rebind pinning, legacy Ollama-proxy gating, legacy auto-prefill) documented with remediation.

### Radiology AI Platform — Phase P4 (Enterprise Interoperability & Clinical Exchange) — 2026-07-18

The standards-based **exchange** layer (gates G12–G22). Everything ships as **additional** exports /
interfaces — nothing replaces the report. Strangler Pattern throughout: byte-level DICOM/DIMSE runs through
the **existing** DICOM agent + Orthanc and the **existing** `dicom_sr_export_queue`; identity comes from the
P0 canonical crosswalk; structured content comes from the P1/P2 immutable provisional store. Still behind the
P3 master flag + per-scope gating (default OFF); exports are admin-only. **AI still never signs, never writes
`patient_reports`, and never auto-learns** (the feedback dataset is analytics/export only).

**Added — DICOM & imaging exchange**
- **DICOM SR (G12):** pure TID 1500 content model (`srContentModel.buildSrContentTree`) → `dicom_sr_documents`;
  DIMSE hand-off reuses the existing `dicom_sr_export_queue` (no new worker). SR is an additional SOP instance.
- **Encapsulated PDF (G13):** versioned `encapsulated_pdf_exports` storage/link layer (encoding via existing Orthanc path).
- **GSPS / SEG foundations (G14/G15):** `presentation_states` / `segmentation_objects` storage interfaces only —
  no overlay editor, no segmentation engine.
- **MPPS + Storage Commitment (G16):** `mpps_events` + `storage_commitments` status tables + status API.

**Added — HL7/FHIR & viewer**
- **FHIR R4 (G17):** pure mappers for `DiagnosticReport` / `ImagingStudy` / `Observation` / `ServiceRequest`
  → `fhir_export_log`. Resources only; **no external send**.
- **Viewer sync (G18):** pure OHIF/Weasis deep-links anchored on G6 evidence (study→series→instance), built
  over the existing `studyLaunchService` base-URL selection; findings without an anchor are flagged.

**Added — AI history & feedback**
- **Immutable AI timeline (G19):** `buildAiTimeline` over the append-only `ai_shadow_drafts` version history + feedback.
- **AI comparison (G20):** `compareAiVersions` — added/removed/changed findings, measurement deltas, impression
  and model/prompt change (AI-vs-AI only).
- **Human feedback dataset (G21):** `buildFeedbackDataset` — de-identified JSONL + stats; **no retraining**.
- **Enterprise APIs (G22):** `/api/ai/interop` (timeline, versions, comparison, evidence+links, status, SR/FHIR
  export, feedback dataset), gated like the clinical router; exports admin-only.

**Database** — `migrations/add_ai_interop.sql`: 7 additive tables + 6 additive `ai_draft_feedback` columns;
idempotent; sorts after `add_ai_clinical_config.sql`; passes `check-migration-order.cjs`.

**Safety / verification** — the AI isolation guard now recurses into `lib/ai/interop/` and covers
`routes/aiInterop.ts`. Grounding manifest 76 → **101** claims. Typechecks clean; **2626 tests pass** (21 new
pure interop cases). See `docs/architecture/radiology-ai/P4_IMPLEMENTATION_REPORT.md`.

### Radiology AI Platform — Phase P3 (Clinical Workflow Integration) — 2026-07-18

The **first radiologist-visible** phase (gates G10–G11), fully **feature-flagged: AI is OFF by default for
everyone**; only an explicitly enabled pilot radiologist sees anything. The radiologist remains the only
signer — **AI never signs**. Strangler Pattern (reuse the existing job engine, cron, feature-flags backbone,
staff auth, and workspace).

**Added — G10 AI Scheduler** (a policy layer over the existing `radiologyJobs` engine — no new worker/queue)
- 5 modes: Immediate, Night Batch, On-demand (`POST /api/ai/generate`), Scheduled Reprocessing, Learning
  aggregation (no auto-retrain). Config in `ai_scheduler_config` (night/quiet windows, GPU/CPU limits, max
  concurrency, retry, include priors/OCR, skip finalized/unchanged). Night-batch/reprocess/learning run as
  crons in the existing `cron.ts`, each hard-gated by the master flag. Queue dashboard / cancel reuse the
  existing job-engine counters. Per-modality policies (`ai_modality_policies`): immediate/night_batch/manual/disabled.

**Added — G11 Workspace integration**
- A feature-flagged **AI Draft Panel** in `RadiologyReportingWorkspace.tsx`: grounded findings only,
  evidence + confidence, provenance, shadow status, and an **Accept / Edit / Ignore** workflow with an
  `onInsertText` hook for the report editor. Renders nothing unless AI is visible for the radiologist.
- **Feature flags**: master `ff_radiology_ai` (reuses the `feature_flags` backbone) + per
  hospital/radiologist/modality/study-type policies (`ai_feature_policies`) with shadow/pilot/production modes,
  resolved most-specific-wins (default OFF). Per-radiologist **preferences** (`ai_radiologist_preferences`).
- Gated `/api/ai` router (policy, preferences, draft, generate, feedback, admin scheduler/modality/queue).
- Feedback capture (`ai_draft_feedback`) for the learning aggregation.

**Migration** `migrations/add_ai_clinical_config.sql` (5 tables) — seeds the master flag **OFF** and every
modality **disabled**, so a fresh deploy shows AI to nobody.

**Completion patch — AI draft storage + editor binding.** Made `ai_shadow_drafts` the **immutable, versioned**
provisional report store (new columns `version`/`canonical_study_id`/`snapshot_revision`/`ai_job_id`/`model_digest`/
`prompt_version`/`validated` + a DB trigger `ai_shadow_drafts_immutable_guard` rejecting UPDATE/DELETE; regeneration
inserts `version+1`). Bound the workspace editor: **Accept/Edit** insert into the existing `radiology_report_drafts`
findings editor (via `setRawFindings`/autosave), **Ignore/Reject** record feedback only, **Accept all** grounded;
voice operates on the inserted text; the **saved human draft always wins** over AI on reopen (AI never auto-prefills).
**AI never writes `patient_reports`, the working draft, or amendments, and never signs** — enforced by a static guard
test. Full storage map in `P3_IMPLEMENTATION_REPORT.md` §7.5.

**Verification** — typecheck (libs + api-server + **frontend**) ✅; `pnpm test` → **2607 pass** (+17 P3 +8 patch tests;
same 7 pre-existing `DATABASE_URL` file errors); grounding (83) + migration-order ✅. DB-backed services, the
`/api/ai` endpoints end-to-end, and live panel/voice rendering require staging — see `P3_IMPLEMENTATION_REPORT.md` §11.

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
