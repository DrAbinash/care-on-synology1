# Background AI Report Composer — Deliverable (A–X)

**Verdict: SAFE FOR ONE-CASE CLINIC TEST** after NAS pull/rebuild + migration. Do **not** auto-merge; human review first. Overnight vision AI may remain paused.

**Canonical input model (Guard 8): Model B** — the frozen composition snapshot is the authoritative AI input. Server computes revision/hashes from that snapshot and verifies optional persisted-report tokens. The worker never re-reads the live editor. Apply is **client-side only** through Zustand (`applyAiComposerAccepted` + undo snapshot).

---

## A. Existing architecture reused
- `RadiologyReportingWorkspace.tsx` host chrome
- `zai-workspace/store.ts` undo / provenance / `applyAiComposerAccepted`
- Voice Composer preview patterns + `pathologyPatch` / `reportFieldMerge` provenance
- `resolveComposerRuntime` (`ollama_composer_*`) — text only
- `dicom_retry_queue` + `radiologyJobs` with new `ai_report_compose` on **other** consumer (never overnight tick)

## B. New components
- Schema: `ai_report_compose_jobs`, worklist `ai_compose_*`, clinic composer settings
- Server: `lib/reportComposer/*`, `routes/reportComposer.ts`, handler registration
- Client: `ReportComposerAssistant`, `useReportComposer`, worklist badges/filters, Local AI settings panel

## C. Job/queue model
Statuses: QUEUED → COMPOSING → READY | STALE_READY | FAILED | CANCELLED | OBSOLETE | DISCARDED | APPLIED  
Kinds: FULL_REPORT | IMPRESSION | SECTION_EDIT | SELECTION_EDIT | TRANSLATE | REPHRASE | SHORTEN | EXPAND  
Tracked-change reviewState (separate): PENDING | ACCEPTED | REJECTED | EDITED

## D. Snapshot/revision safety
Server hashes snapshot; freshness endpoint flips READY→STALE_READY when live editor diverges. STALE blocks blind Apply.

## E. Composer input
Structured snapshot: history/technique/findings/impression/recommendation + deduped observations + template section names. No DICOM pixels.

## F. Output validation
JSON draft + grounded abnormality check; unsupported terms → FAILED. Recommendation optional.

## G–H. QS / macro / voice
Observations from voice session + client snapshot; dedupe by concept/level/text. Apply via store, not server overwrite.

## I. Worklist
Separate `ai_compose_status` badges (1A). Filters + optional Sort AI status.

## J. Reporting Workspace UI
Compose in Background, Generate Impression, Review, Apply, Discard, Regenerate, micro-command bar.

## K. Stale-draft handling
STALE banner; Compare/Regenerate; no one-click blind apply.

## L. Model/runtime
Existing composer model/fallback/ctx/temp/timeout + Background ON / Review ON / Auto OFF / Concurrency 1.

## M. PHI/security
Logs: jobId, status, model, latency, lengths, safeError. Snapshots pruned after retention days. No HTML colors in clinical text.

## N. Tests + counts
- Unit: clinical significance, snapshot hash, validation, tracked changes, materialize — **15**
- Request: enqueue 202, synthetic test, process-now no auto-apply — **3**
- **Total 18 passing** in this suite

## O. Synthetic LS Spine walkthrough (local / deterministic)
1. Findings start: “No significant disc bulge.”
2. Observations: L4-5 bulge + L5-S1 desiccation + voice facet hypertrophy
3. Enqueue FULL_REPORT → process-now → READY with tracked REPLACE (no HTML)
4. Accept → `applyAiComposerAccepted` → one Undo restores prior
5. Mid-edit before completion → freshness → STALE_READY

## P. Synthetic Brain walkthrough
Fazekas 2 + ventricles; impression inventing hemorrhage → validation `unsupported_abnormality` → FAILED. Report unchanged.

## Q. Screenshots/video
UI wired; full GUI demo pending NAS deploy with composer model. Unit/request evidence above.

## R. DB migrations
`migrations/add_ai_report_composer.sql`

## S. Deployment steps
1. Pull branch / rebuild images  
2. `care-db-patch-v2` applies migration  
3. Restart `care-api` then `care-web`  
4. Settings → Local AI: set Report Composer model; Background ON; Review ON; Auto OFF

## T. Services to restart
`care-db-patch-v2` (once) → `care-api` → `care-web`

## U. Initial settings
Background ON, Review before apply ON, Auto compose OFF, Concurrency 1

## V. Live-only unknowns
GPU latency under load; Hindi translation quality; radiologist UX acceptance

## W. Rollback
Disable Background composer; cancel QUEUED jobs; ignore new columns

## X. Clinic gate
Run one MRI LS Spine case per Guard 14 acceptance checklist before enabling Auto Compose.

---

# Y. The three reporting-assistant operations — interface contract (2026-10-11)

For the Reporting Workspace Agent. **No new endpoint, no new table, no new contract.**
Everything below is the existing Composer job API with three added `jobKind` values and
two added snapshot fields, so the acceptance boundary (tracked changes, STALE, CAS, the
Apply proof, the finalize guard) is inherited rather than re-implemented a second time.

## Y.1 Which call to make, and which you must NOT make

| You want | Use | Not |
| --- | --- | --- |
| A complete report built from formats + observations, **no AI** | `generateProfessionalReport(ctx)` in `zai-workspace/store.ts` (PR #917) | never an AI call |
| Better prose for a report that already exists (AI optional assistant) | `POST /jobs` with `jobKind:"PROFESSIONALIZE"` | `generateProfessionalReport` — that replaces content, it does not review it |
| An instruction applied to the current report ("make the impression concise", "remove duplicate statements") | `POST /jobs` with `jobKind:"REPHRASE"` / `"SECTION_EDIT"` / `"SHORTEN"` + `snapshot.instruction` | a new natural-language endpoint |
| Merge a supplied report in (outside cervical, whole-spine screening) | `POST /jobs` with `jobKind:"COMBINE"` + `snapshot.additionalReports` | client-side string concatenation |
| Structured rows from dictated shorthand | `POST /jobs` with `jobKind:"OBSERVATIONS"` | `FULL_REPORT` — and there is **no Apply** for it (Y.5) |

`PROFESSIONALIZE` is the AI *proposal*; `generateProfessionalReport` is the deterministic
*author*. They are deliberately different names for different guarantees, and neither one
calls the other.

## Y.2 Endpoints (all already exist, mounted at `/api/radiology/report-composer`, `requireStaffAuth`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/jobs` | enqueue (202) — body `{ snapshot, jobKind, persistedContentToken? }` |
| GET | `/jobs/:id` | poll; `{ ok, job }` with `status`, `draft`, `trackedChanges`, `validation`, `provider`, `usage` |
| GET | `/latest?worklistId=` | the worklist's current job |
| POST | `/jobs/:id/freshness` | READY → STALE_READY when the live report moved |
| POST | `/jobs/:id/changes/:changeId/accept` · `/reject` | per-change review |
| POST | `/jobs/:id/applied` | two-phase proof: the accepted text must be in the study's report |
| POST | `/jobs/:id/discard` | drop the proposal |
| POST | `/test` · `/test/compare` | synchronous single-shot, for the settings screen and for measured comparisons |

## Y.3 Request examples

`snapshot` is the frozen Model B snapshot the workspace already builds. Only
`instruction` (already hashed into `inputHash`) and `additionalReports` (new, optional)
are added.

PROFESSIONALIZE — the radiologist's report is complete; AI improves the prose:

```json
POST /api/radiology/report-composer/jobs
{ "jobKind": "PROFESSIONALIZE",
  "snapshot": { "modality": "MRI", "region": "Lumbosacral Spine",
                "findings": "L4-L5 diffuse disc bulge, AP canal 8.2 mm …",
                "impression": "Canal stenosis at L4-L5.",
                "recommendation": "", "observations": [] } }
```

COMBINE — a second report the calling application established as the same patient/study:

```json
{ "jobKind": "COMBINE",
  "snapshot": { "findings": "…cervical findings…", "impression": "…",
                "additionalReports": [
                  { "label": "MRI LUMBOSACRAL SPINE (same patient, same day)",
                    "modality": "MRI", "region": "Lumbosacral Spine",
                    "findings": "…lumbar findings…", "impression": "…" } ] } }
```

`findings` alone is a valid entry (`impression` defaults to `""`).

OBSERVATIONS — dictated shorthand in, structured rows out:

```json
{ "jobKind": "OBSERVATIONS",
  "snapshot": { "findings": "L4-5 diffuse bulge, bilateral recess narrowing, LF hypertrophy, canal 8.2 mm." } }
```

REPHRASE with an instruction:

```json
{ "jobKind": "REPHRASE",
  "snapshot": { "findings": "…", "impression": "…", "instruction": "Make the impression concise." } }
```

## Y.4 Response

`202 { ok:true, jobId, deduped, status:"QUEUED", reportRevision, inputHash, sources }`,
then `GET /jobs/:id` reaches `READY` with:

```json
{ "ok": true, "job": {
    "status": "READY", "jobKind": "PROFESSIONALIZE",
    "draft": { "findings": "…", "impression": "…", "recommendation": "…",
               "observations": [ { "concept":"disc bulge", "level":"L4-5",
                                  "laterality":null, "measurement":"8.2 mm",
                                  "findingsText":"Diffuse disc bulge at L4-5." } ] },
    "trackedChanges": [ { "field":"FINDINGS", "reviewState":"PENDING", … } ],
    "provider": "ollama", "model": "gemma3:12b",
    "usage": { "promptTokens": 1482, "completionTokens": 611, "totalTokens": 2093,
               "approximateCostUsd": null },
    "validation": { "ok": true, "errors": [], "warnings": [],
                    "conservation": { "droppedMeasurements": [], "droppedLevels": [],
                                      "droppedLaterality": [], "droppedSections": [],
                                      "observationOnlyLosses": [] } } } }
```

`provider`, `usage` and `validation.conservation` are read out of the JSON this service
already writes at READY — no new columns, so no migration.

## Y.5 What each kind guarantees, mechanically

- `PROFESSIONALIZE`, `COMBINE`, `REPHRASE`, `SHORTEN`, `EXPAND`, `SECTION_EDIT`,
  `SELECTION_EDIT`, `TRANSLATE` are **preserving kinds** (`PRESERVING_COMPOSE_KINDS`).
  The whole report goes to the model — Findings, Impression, Recommendation, Technique,
  examination identity and every observation, with no character limit — and the shipped
  validator refuses the draft if a measurement, a level, a laterality or a whole section
  is missing from the answer: `measurement_dropped`, `level_dropped`, `laterality_dropped`,
  `section_dropped`. Before this, an oversized request was solved by cutting the report at
  1,200/600 characters and 12 observations.
- The model is never shown a truncated request. `planComposerTextContext` sizes the window
  per request; if input + answer reserve exceeds the local `num_ctx` (or the 16,384 cloud
  ceiling) the job FAILS with `composer_context_budget_exceeded` and names the remedy,
  instead of sending half a report and calling the answer successful.
- An answer that stops at the output ceiling is `composer_output_truncated`, not a
  half-read `malformed_json`.
- A `SELECTION_EDIT` that returns only the selected sentence is refused
  (`selection_edit_answer_truncated`) because Accept replaces the **whole** field.
- `OBSERVATIONS` answers in `draft.observations` only. Rows carrying a level, side,
  measurement or abnormality the dictation never stated are **dropped and named**; if no
  row survives, the job fails with `no_grounded_observations`. It has no Apply:
  `/jobs/:id/applied` refuses it with `compose_nothing_to_apply`, because an empty
  accepted-change set would otherwise be a vacuous APPLIED proof.
- Nothing is ever written to a report without review: changes land `PENDING`, and the
  finalization guard still refuses unreviewed AI content.

## Y.6 Provider selection, and the fallback that must not happen

- `sessionProvider` (workspace selector) → explicit override → Model Routing task route →
  **Ollama only when nobody named a provider**.
- A named provider CARE has no adapter for is refused with
  `composer_provider_not_supported` and the message names it. It used to be coerced to
  `ollama`, which silently decided local-vs-cloud on the radiologist's behalf.
- A provider switched OFF in AI Provider Settings is refused with
  `<provider>_provider_disabled` and never dials out. No `ai_provider_settings` row is not
  an OFF statement — environment-only configuration keeps working.
- **There is no cloud → Ollama fallback on the composer path.** A cloud failure is a
  FAILED job with the cloud provider named in `safeError`.
- The PHI gate (`assertGatewayPrivacy`) and the cloud-image default-deny run inside the
  cloud transport, before the request exists on the wire.

## Y.7 Failure vocabulary the workspace should surface

`composer_provider_not_supported`, `<provider>_provider_disabled`,
`<provider>_api_key_not_configured`, `composer_context_budget_exceeded`,
`composer_output_truncated`, `selection_edit_answer_truncated`, `malformed_json`,
`empty_model_response`, `no_grounded_observations`, `measurement_dropped`,
`level_dropped`, `laterality_dropped`, `section_dropped`, `PHI_TEXT_CLOUD_BLOCKED`,
`cloud_vision_not_allowed`. Every one of these arrives with
`job.safeError` plus a `provenance.degradedReason` written as a sentence, not a code.

## Y.8 Deterministic independence

With AI switched off or unreachable, `deterministicCompose` still answers
`FULL_REPORT`/`IMPRESSION`/edit kinds from the snapshot. For the three new kinds it
returns the radiologist's **own text unchanged** (`PROFESSIONALIZE`, `COMBINE`) or an
explicit "no mechanical equivalent" (`OBSERVATIONS`), with a warning naming that no model
ran. The deterministic reporting engine does not gain a dependency on any of this.

## Y.9 Measured on the clinic AI PC (11 Oct 2026, `192.168.1.250:11434`)

`RUN_LIVE_OLLAMA=1` drives the shipped prompts, transport, JSON contract **and the
shipped validator** over six synthetic cases per model. 17 of 19 answers were
accepted; the three refusals below are the guard working, not the harness failing.

| operation | gemma3:12b | medgemma1.5:4b | qwen3:14b |
| --- | --- | --- | --- |
| PROFESSIONALIZE MRI LS spine (8.2 mm canal, right S1 extrusion) | 20.2 s accepted | 6.9 s accepted | 25.4 s accepted |
| REPHRASE MRI cervical ("make more professional") | 11.2 s accepted | 2.7 s accepted | 7.9 s accepted |
| PROFESSIONALIZE MRI brain (Fazekas 2) | 11.2 s accepted | 2.6 s accepted | 8.2 s accepted |
| PROFESSIONALIZE whole-spine screening | 16.2 s accepted | 3.1 s accepted | 10.3 s accepted |
| COMBINE cervical + lumbar | 24.5 s accepted | **blocked** — discarded the lumbar study (`level_dropped`, `measurement_dropped`, `laterality_dropped`) | 19.1 s accepted |
| OBSERVATIONS dictated shorthand | **blocked** — 1 row from a 4-fact dictation | **blocked** — 1 row | 22.4 s accepted, 4 rows |

So, stated plainly: **text transformation works on every installed local model,
and structured extraction from dictation works only on `qwen3:14b`.** Nothing here
was tuned for; the 4 B models are configured away from Operation 1 rather than
trained. No language-quality claim is being made about diagnostic accuracy — the
cases are synthetic and a radiologist has not read them on a screen.

Two defects this run found and fixed (both would have made operations unusable in
the clinic while every mocked test stayed green):
1. a faithful COMBINE was **blocked** as invented content, because "what the
   radiologist supplied" did not include the second report the model had been
   given — and, in the other direction, a merge that silently dropped that report
   could not fail.
2. "no acute infarct or **hemorrhage**" was blocked as an invented abnormality
   against a dictation that said **haemorrhage** — a spelling, not a fact.
