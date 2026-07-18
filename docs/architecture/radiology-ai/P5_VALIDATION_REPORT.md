# Phase P5 — Production Hardening & End-to-End Validation Report

**Scope:** Treat the CARE ERP Radiology AI Platform (P0–P4) as feature-complete and drive it toward
production readiness: validate every workflow, hunt and fix bugs, harden, and assess readiness. No new
features were added — only bug fixes, security hardening, and the minimum code needed to close defects.

---

## 0. Execution environment & honesty statement (read first)

This validation ran in an **isolated CI sandbox with NO live infrastructure**. Verified directly:

| Dependency | Present? | Consequence |
|---|---|---|
| PostgreSQL (`DATABASE_URL`) | **No** | No live DB reads/writes; DB-backed flows validated by code trace + logic tests only |
| Orthanc / Conquest / PACS | **No** (`:8042` refused) | No real DICOM ingestion, C-STORE, MPPS, or Storage Commitment |
| DICOM sample files | **No** (`0` `*.dcm` in repo) | No real study to push through the pipeline |
| OHIF / Weasis viewers | **No** | No real viewer open / deep-link round-trip |
| Docker / services | **No** | Cannot stand up the stack |

**Therefore: no real DICOM/PACS/viewer/DB integration test was performed, and none is claimed.** Every
item below is explicitly tagged **REAL** (executed here), **STATIC** (verified by reading/tracing code or
running pure logic), or **STAGING-REQUIRED** (needs the live stack; exact procedure given in §15). I have
not marked any simulated check as a real integration test.

**What WAS executed for real, in this environment:**
- Full TypeScript typecheck (libs + api-server + diagnostic-erp) — **clean**.
- Full test suite — **2645 tests pass** (was 2626 at end of P4; +19 P5 tests). 7 test *files* fail only on
  `DATABASE_URL`-at-import (pre-existing; payments/diagnostics; not AI areas).
- Grounding CI (doc↔code) — **105/105** claims hold (was 101).
- Migration-order preflight — **no violations**.
- A three-front **adversarial code review** (AI backend seams, safety invariants, workspace binding) plus an
  empirical SSRF-parser test — this surfaced the bugs fixed in §8.

---

## 1. End-to-end validation — PASS/FAIL checklist (Part A, 14 steps)

Legend: ✅ verified · ⚠️ verified statically, needs staging to confirm end-to-end · ⛔ staging-only (cannot run here).

| # | Step | Result | Basis |
|---|---|---|---|
| 1 | DICOM ingestion (Orthanc, metadata, UIDs, modality) | ⛔ STAGING | No Orthanc/DICOM here; ingestion path is the existing dicom-pull-agent (unchanged). §15.1 |
| 2 | Canonical Study + Snapshot + hash + revision + **immutability** | ⚠️→✅ STATIC | `canonicalStudy.ts`, `studySnapshot.ts` (`computeContentHash`, `decideRevision`); immutability now **DB-enforced** (P5 fix §8.8). Logic unit-tested. |
| 3 | AI pipeline (manifest, image selection, gateway, capability, prompt/model/digest, rules, grounding) | ⚠️ STATIC | `shadowPipeline.ts` wires snapshot→selection→manifest→gateway→`runDeterministicQuality`→`applyTrustGauntlet`; all pure stages unit-tested. Live model run = STAGING. |
| 4 | Provisional report (`ai_shadow_drafts`): immutable, versioned, linked | ✅ STATIC | Append-only DB trigger + **now UNIQUE `(study,version)`** (P5 fix §8.3); links to snapshot/manifest present. |
| 5 | Workspace panel: Accept / Edit / Ignore / Accept-All → **only** `radiology_report_drafts`; autosave; AI never overwrites human edits | ✅ STATIC | Adversarial trace confirmed the core contract holds (functional `setRawFindings`, append-only, human-first). One cross-study state bug found & fixed (§8.7). |
| 6 | Voice edits accepted findings; human edits win | ✅ STATIC | Accepted text enters via `onInsertText`→existing editor→existing voice/autosave; no AI write-back path. |
| 7 | Finalize → `patient_reports`; radiologist is author; AI never signs; amendment chain intact | ✅ STATIC | AI-isolation guard (now hardened, §8.7) proves no AI module writes reports/amendments/signs. Finalize = existing lifecycle. |
| 8 | DICOM SR + Encapsulated PDF; export queue; bidirectional links; SOP UIDs | ⚠️ STATIC | `buildSrContentTree` (TID 1500) + `dicom_sr_documents` + reuse of existing `dicom_sr_export_queue`; byte-encode/C-STORE = STAGING. |
| 9 | PACS receives SR/PDF; Storage Commitment; MPPS | ⛔ STAGING | Status tables + API present; live DIMSE = STAGING. §15.9 |
| 10 | OHIF + Weasis: open study/series/SOP/evidence, report links | ⛔ STAGING | Deep-link builders pure + unit-tested (`buildOhifDeepLink`/`buildWeasisDeepLink`); live viewer = STAGING. §15.10 |
| 11 | AI timeline (immutable versions) + comparison viewer | ✅ STATIC | `buildAiTimeline` + `compareAiVersions` pure + unit-tested; immutability now DB-enforced. |
| 12 | Feedback dataset stores finding/action/reason/laterality/measurement/confidence/prompt/model version | ✅ STATIC | Capture path persists all fields (`recordDraftFeedback`); de-identified export excludes free-text `reason`/edited text (P5 fix §8.6). |
| 13 | FHIR export | ✅ STATIC | `toFhirBundle` (R4) + `fhir_export_log`; resources-only, no external send (by design). |
| 14 | Rollback | ✅ STATIC | Flag-based instant kill-switch + additive/idempotent migrations; verified §14. |

**Part B — multi-modality (MR/CT/US/XR):** ⛔ STAGING. The pipeline is modality-aware
(`selectImageAnchors` strategy per modality; `ai_modality_policies`) but no modality study exists here.
Procedure to validate each modality is in §15.

**Part C — failure testing (AI/Orthanc/DB/queue/commit/viewer/network down):** ⚠️ STATIC. The design is
degrade-never-block: the job engine retries via `dicom_retry_queue`; the pipeline degrades to
deterministic-only on provider failure (`provenance.degraded`); gateway circuit breaker from
`ai_provider_health_logs`; export enqueue is decoupled from the report. Fault-injection against the live
stack is STAGING (§15).

---

## 2. Gates re-validated

All P0–P4 gates (G1–G22) were re-checked statically and by their pure tests; the integration wiring is
connected (verified): the AI pipeline is registered on the existing job engine
(`RADIOLOGY_JOB_HANDLERS[AI_SHADOW_PIPELINE_JOB]` → gateway provider), scheduler crons are master-flag
gated, `/api/ai` + `/api/ai/interop` are mounted and reachable, and the schema exports are complete.

## 3. Database tables exercised (by the validated code paths)

`canonical_study`, `study_snapshots`, `ai_processing_manifests`, `ai_shadow_drafts`, `ai_evidence`,
`ai_model_capabilities`, `ai_model_versions`, `ai_golden_cases`, `ai_evaluation_runs`,
`ai_feature_policies`, `ai_scheduler_config`, `ai_modality_policies`, `ai_radiologist_preferences`,
`ai_draft_feedback`, `dicom_sr_documents`, `encapsulated_pdf_exports`, `presentation_states`,
`segmentation_objects`, `mpps_events`, `storage_commitments`, `fhir_export_log`, and (reused)
`dicom_sr_export_queue`, `radiology_studies`, `radiology_worklist`, `dicom_incoming_studies`,
`ai_job_queue`, `audit_logs`. (Exercised by code trace/logic here; live row I/O = STAGING.)

## 4. APIs exercised (static contract validation)

`/api/ai/*` (policy, preferences, draft, generate, draft/:id/feedback, scheduler, modality-policies,
policies, queue, jobs/:id/cancel) and `/api/ai/interop/*` (timeline, versions, comparison, evidence,
status, structured-report, fhir-export, feedback-dataset). Gating, Zod validation, and role/flag checks
verified by reading each handler; live HTTP round-trip = STAGING.

---

## 5. Performance report

**Not measurable here** (no DB/stack). Assessed structurally instead:
- **No blocking work on the request path.** AI generation runs on the existing async job engine, never in
  the reporting request. Express 5 async errors forward to the global handler.
- **Idempotency/dedup** short-circuits redundant pipeline runs (snapshot hash, manifest `inputHash` —
  **now unique**, §8.4), so reprocessing is cheap.
- **Indexes** exist on every hot lookup (study UID, version, input hash, draft id, feedback draft/action).
- **Bounded fan-out:** image selection caps at 20 anchors; the gateway has timeouts + circuit breaker.

Bottleneck candidates to measure on staging (with method) are listed in §15.12 (ingest, snapshot, AI
generation, SR encode, viewer launch). No premature optimization was applied.

## 6. Security report (Part E)

The adversarial security review found and this phase **fixed** the following (details/severity in §8):
- **SSRF (HIGH):** `/radiology-ollama/test` took a client-controlled `allowLocal` flag → an authenticated
  low-privilege SSRF oracle against loopback/LAN/metadata. **Fixed** — the flag now comes from the saved
  admin policy, and the endpoint requires the AI permission.
- **SSRF filter bypass (MED-HIGH):** `localhost.` (trailing dot) and IPv4-mapped IPv6
  (`[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`) evaded the guard (empirically confirmed). **Fixed** —
  host canonicalization (`canonicalHostsForGuard`), now a pure, unit-tested module.
- **PHI in "de-identified" feedback dataset (MED):** free-text `reason` was emitted verbatim. **Fixed** —
  free-text `reason` and edited text are excluded from the export (still captured in the DB for authorized,
  non-de-identified analytics).
- **Flag-gating hole (MED):** interop SR/FHIR/feedback **export** endpoints ran even with `ff_radiology_ai`
  OFF. **Fixed** — exports now require the master flag on **and** admin.

**Invariants confirmed to hold:** AI never writes `patient_reports`/amendments/signatures (isolation guard,
now hardened against alias/raw-SQL/`delete`-draft evasion); `ai_shadow_drafts` is insert-only in code +
DB-trigger-enforced append-only; clinical/interop **reads** default OFF; the highest-PHI feedback field
(edited report text) is dropped from exports. **Local-first PHI:** the gateway's PHI-egress policy
(`phi_eligible`, local-first chain) is unchanged and intact.

**Residual security items (documented, not fixed — see §9):** DNS-rebinding/TOCTOU on the Ollama fetch; the
legacy `/radiology-ollama` proxy sitting outside the master flag and defaulting fail-open.

## 7. DICOM & viewer interoperability report

- **DICOM conformance (foundation):** SR = TID 1500 content tree (findings TEXT + measurements NUM +
  impression + IMAGE evidence refs + per-series UID map), verified by unit tests. Encapsulated PDF, GSPS,
  SEG are storage/link foundations. MPPS + Storage Commitment are status layers. The byte encoding and DIMSE
  associations run through the **existing** DICOM agent + Orthanc — P5 adds no second DICOM stack. Full
  Conformance Statement authoring + live C-STORE/commit = STAGING (§15).
- **Viewer interoperability:** OHIF (`StudyInstanceUIDs`/`SeriesInstanceUID`/`initialSopInstanceUid`) and
  Weasis (`$dicom:get` narrowed by study/series/object) deep-links are pure + unit-tested and reuse the
  hardened `studyLaunchService` for base-URL/network selection. Live open in both viewers = STAGING (§15.10).

---

## 8. Bugs discovered & FIXED

All found via the P5 adversarial review + empirical testing; all fixed and covered by tests/typecheck.

| # | Severity | Bug | Fix |
|---|---|---|---|
| 8.1 | **HIGH** (SSRF) | `/radiology-ollama/test` used a **client-supplied** `allowLocal`, bypassing the private/LAN guard; endpoint had only `requireStaffAuth` | Derive `allowLocal` from the saved `ollamaLocalOnly` policy; require `canUseAi` |
| 8.2 | **MED-HIGH** (SSRF) | `localhost.` + IPv4-mapped-IPv6 reached loopback/LAN/metadata (verified) | `canonicalHostsForGuard` canonicalizes trailing-dot + embedded IPv4; extracted to a pure, unit-tested module |
| 8.3 | **HIGH** (data integrity) | `(study_instance_uid, version)` was a **plain** index → concurrent jobs could insert duplicate versions | Schema → `uniqueIndex`; migration adds the unique index (guarded); pipeline retries version on conflict |
| 8.4 | **MED** (data integrity) | `input_hash` idempotency was a racy check-then-insert on a **plain** index → duplicate manifests + duplicated work | Schema → `uniqueIndex`; `onConflictDoNothing` makes a raced run a clean no-op |
| 8.5 | **MED-HIGH** (wrong state) | `AiDraftPanel` never reset `handled` across studies → next study's findings render as already-handled and become silently un-insertable | Reset `handled` on `studyInstanceUid` / new draft |
| 8.6 | **MED** (PHI) | Free-text `reason` emitted into the "de-identified" feedback export | Exclude free-text `reason` + edited text from the export; keep in DB |
| 8.7 | **MED** (gating) | Interop SR/FHIR/feedback **exports** ran with the master flag OFF | `requireAdminAndEnabled` gate on the three export endpoints |
| 8.8 | **MED** (def-in-depth) | `study_snapshots` "immutable" was code-only (no DB enforcement) | Column-guarded trigger: allow only `is_current`/`superseded_at`, reject content change/delete |
| 8.9 | **LOW** (def-in-depth) | `ai_shadow_drafts` append-only trigger missed `TRUNCATE` | Statement-level `BEFORE TRUNCATE` guard |
| 8.10 | **LOW** | `buildInteropReport` could export an unvalidated draft despite its contract | Filter `validated = true` |
| 8.11 | **LOW** (guard quality) | AI-isolation guard evadable (alias/raw-SQL) + missing `delete(draft)` rule | Added raw-SQL patterns + the missing rule (scoped to the P0–P4 AI subsystem) |

## 9. Remaining issues (documented, NOT fixed — with remediation)

Deferred deliberately: each is either pre-existing behavior outside the P0–P4 build whose change carries
regression risk in the final hardening phase, or needs substantial new implementation. None affects the
core safety spine (AI never signs/writes reports/auto-learns; default-OFF).

1. **DNS-rebinding / TOCTOU on Ollama fetch (MED, conditional).** The guard checks the hostname string;
   `fetch` re-resolves DNS, so a public name that passes could resolve to a private IP at connect time.
   *Remediation:* resolve the host, validate the **resolved IP**, and pin it through a custom
   `lookup`/agent (or a small proxy allowlist by IP). Deferred because a naive resolve-and-pin can break
   legitimate hostname-based/local-DNS Ollama configs; needs staging to tune.
2. **Legacy `/radiology-ollama` proxy outside the master flag + fail-open (MED).** `ollamaEnabled` defaults
   ENABLED when the column is null, and this surface (incl. `/multi-review` → external Gemini when a key is
   set) is not under `ff_radiology_ai`. Pre-P0 behavior. *Remediation:* bring it under
   `resolveAiEnablementForUser` and default-OFF; requires a product decision (it may be relied on today).
3. **Legacy `aiDraftJson` auto-prefill (MED).** A separate Cockpit effect fill-empty-injects AI findings
   into the editor without an explicit Accept (the P3 panel correctly requires Accept). Fill-empty-only, so
   it never overwrites typed human text. *Remediation:* gate it behind the same confirm as `importAiDraft`.
4. **Manual template/snippet replace-without-confirm (LOW, non-AI).** `applyNormalSnippet`/`applyUsgTemplate`
   replace typed findings without a confirm (unlike master-template/AI-import). Possibly by design.
   *Remediation:* add the `hasTyped` confirm for consistency.
5. **7 DB-dependent test files can't run without `DATABASE_URL` (pre-existing tech debt).** They import
   `@workspace/db` at module load. Not AI areas. *Remediation:* lazy-import or inject the DB in those
   payment/diagnostics tests (out of AI scope; left untouched to avoid destabilizing non-AI code).

## 10. Backup & recovery (Part F)

**STATIC PASS.** Backup is a full-DB `pg_dump` with a tested paginated fallback (`cron.test.ts`). Because
every AI artifact — snapshots, manifests, immutable drafts, evidence, prompt/capability registries, interop
tables — is a plain Postgres table, the existing full-DB backup covers them with no AI-specific mechanism.
AI-draft recovery = restore (rows are immutable). Live restore drill = STAGING (§15.13).

## 11. Production hardening review (Part G)

- **Logging/monitoring:** structured logger + global error handler (Express 5, no stack leak in prod); AI
  ops health already surfaced (`radiologyOpsHealth`). ✅
- **Error handling/retries:** job engine retries via `dicom_retry_queue`; pipeline degrades, never blocks;
  export decoupled. ✅
- **Migration safety:** all P5 migrations additive + idempotent; unique-index conversions are
  **duplicate-guarded** (DO-block) so a deploy never hard-fails on legacy data; passes order preflight. ✅
- **Config validation:** Zod on all AI endpoints; SSRF guard hardened. ✅
- **Resource cleanup/memory:** bounded image fan-out; no unbounded in-memory accumulation in the AI path. ✅
- **Concurrency:** the two duplicate-row races are closed by unique constraints + conflict handling. ✅
- **Tech debt:** no TODO/FIXME/HACK in AI code; SSRF guard extracted to a pure, testable module.

## 12. Test results (REAL, in this environment)

- Typecheck (libs + api-server + diagnostic-erp): **clean**.
- Test suite: **2645 pass** (+19 P5). New: SSRF guard suite (trailing-dot + IPv4-mapped-IPv6 bypass proofs,
  allowlist, LAN-mode), feedback de-identification (no `reason`/edited text emitted), plus the pre-existing
  interop/isolation suites (isolation guard extended). 7 failing *files* = pre-existing `DATABASE_URL`
  imports (payments/diagnostics), unrelated to AI.
- Grounding: **105/105**. Migration order: **clean**.

## 13. Risks

| Risk | Severity | Status |
|---|---|---|
| Real DICOM/PACS/viewer/DB E2E not run here | High (process) | **Open** — must pass on staging before production (§15) |
| DNS-rebinding on Ollama fetch | Med | Documented (§9.1) |
| Legacy Ollama proxy fail-open / off-flag | Med | Documented (§9.2) |
| Legacy auto-prefill without Accept | Med | Documented (§9.3) |
| Unique-index conversion on a DB with legacy duplicates | Low | Mitigated (duplicate-guarded migration; NOTICE, no hard fail) |

## 14. Rollback verification

- **Instant kill-switch (no deploy):** `feature_flags.ff_radiology_ai = false` → all `/api/ai` and
  `/api/ai/interop` reads return 204 and exports are refused. Verified by tracing the gates.
- **Code rollback:** P5 changes are additive/surgical; reverting restores prior behavior. The SSRF-guard
  extraction is behavior-preserving (same policy, re-imported).
- **Schema rollback:** every P5 migration is additive + idempotent with documented manual `DROP`s; unique
  indexes and triggers can be dropped without data loss. No destructive change was made.

## 15. Staging validation guide (to complete the REAL E2E)

Prereqs: staging with `DATABASE_URL`, Orthanc (+ DICOM agent), a configured local model + capability row,
OHIF + Weasis, and `ff_radiology_ai` enabled for one pilot user.

**Dataset (document exactly which you use):** (a) an existing local Orthanc study; else (b) Orthanc's public
sample set — `curl -O https://orthanc.uclouvain.be/downloads/sample-images/...` or the dcm4che
`dcm4che-test-data`; else (c) TCIA public collections (e.g. `TCGA-LUAD` CT, `QIN-BREAST` MR). Note the exact
StudyInstanceUID used.

1. **Ingest** the study into Orthanc; confirm it appears in the CARE worklist with correct
   patient/study/series/SOP UIDs, modality, acquisition datetime.
2. **Canonical + snapshot:** confirm `canonical_study` + `study_snapshots` rows; re-run ingest and confirm
   the snapshot hash is stable and a late series creates a NEW revision (never mutates) — and that a manual
   `UPDATE study_snapshots SET content_hash=…` is **rejected** by the new trigger.
3. **AI pipeline:** trigger generation; confirm `ai_processing_manifests` + `ai_shadow_drafts` (validated,
   versioned, linked); confirm a second concurrent trigger does **not** create a duplicate version (8.3/8.4).
4. **Workspace:** as the pilot, Accept/Edit/Ignore/Accept-All; confirm content lands **only** in
   `radiology_report_drafts`; switch to another study and confirm its findings are **not** pre-marked (8.5).
5. **Finalize:** sign as radiologist; confirm `patient_reports` author is the radiologist and no AI signing
   path exists; amendment chain intact.
6. **SR + PDF:** `POST /api/ai/interop/structured-report` and the PDF path; confirm `dicom_sr_documents` +
   a `dicom_sr_export_queue` row; drive the existing SR worker; confirm the SR SOP stores to Orthanc.
7. **PACS sync:** confirm Storage Commitment + MPPS status via `/api/ai/interop/status`.
8. **Viewers:** open the study in OHIF and Weasis via the workspace; click a finding → confirm jump to the
   exact series/SOP (evidence sync); confirm report links.
9. **Timeline + comparison:** generate ≥2 versions; confirm `/timeline` immutability and `/comparison`.
10. **Feedback:** confirm capture stores all fields; confirm the exported dataset omits free-text `reason`.
11. **FHIR:** `POST /fhir-export`; confirm `fhir_export_log` rows and **no external send**.
12. **Performance:** time ingest→worklist, snapshot, AI generation, SR encode, viewer launch; record.
13. **Failure injection:** stop AI/Orthanc/DB/viewer in turn; confirm degrade-never-block, retries, no data
    loss, no report corruption; take a `pg_dump`, restore to a scratch DB, verify AI drafts recover.
14. **Rollback:** set `ff_radiology_ai=false`; confirm the whole AI surface goes dark with no deploy.

## 16. Production readiness assessment & FINAL RECOMMENDATION

**Assessment.** The platform is architecturally sound and safe by construction: AI is default-OFF and
feature-flagged, runs shadow-first, never signs or writes the human report (guarded), and never auto-learns.
The P5 review confirmed the core safety contract holds and closed 11 real defects — including two genuine
SSRF issues and two data-integrity races — with tests, clean typecheck, 105/105 grounding, and a clean
migration preflight. Backup, rollback, error-handling, and migration-safety are in good shape.

**The one gating gap is process, not code:** no real DICOM/PACS/viewer/DB end-to-end run was possible in
this sandbox. That must be executed on staging (§15) before production.

### RECOMMENDATION: ✅ **READY FOR CLINICAL PILOT** — conditional on staging E2E; **NOT YET READY FOR FULL PRODUCTION**

- **Clinical pilot (AI OFF by default, one enabled pilot radiologist, shadow/pilot mode):** proceed. The
  safety spine is enforced, the surface is flag-gated, and rollback is a single flag.
- **Blockers to full production:** (1) complete the §15 staging E2E on real studies across MR/CT/US/XR with
  live PACS + both viewers; (2) resolve residual security items §9.1–9.2 (DNS-rebind pinning; bring the
  legacy Ollama proxy under the master flag); (3) run the failure-injection + backup-restore drill (§15.13).

Nothing beyond P5 (production hardening) was implemented. **No Phase P6 or new feature work was begun.**
