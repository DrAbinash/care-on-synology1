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

**Every example below must also carry the study identity the workspace already has.**
`worklistId` is mandatory — the server resolves the study and the report of record from
that one anchor (#905) and answers `compose_worklist_required` if it is absent, before any
model is contacted. Send `studyId` when you have it (it must agree with the worklist row,
or `compose_study_conflict`), and `reportId` when the workspace knows it; omitting
`reportId` is legal and the server derives it. The examples show only the fields that
distinguish one operation from another, not a complete body.

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
- Each of the three operations is routable on its own task key, asked before the generic
  one: `report_composer_professionalize`, `report_composer_combine`,
  `report_composer_observations`, then `report_composer`. Adding those keys to
  `AI_TASK_CATALOG` is what makes them rows in the existing Model Routing screen, so the
  measured model boundary is an administrator's setting and not a constant in code:
  prose transformation runs on every installed local model, while structuring a dictation
  was measured usable on `qwen3:14b` only. `composerTaskKeys()` is exported so the order is
  testable rather than inferred from a resolver.
- Falling through a task key is not substituting a provider. A route naming a provider with
  no adapter is refused even when it came from an operation-specific row.
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
`level_dropped`, `laterality_dropped`, `section_dropped`, `severity_dropped`,
`morphology_dropped`, `location_dropped`, `grade_changed`,
`measurement_repositioned`, `certainty_escalation`, `clinical_polarity_flip`,
`denied_finding_asserted`,
`invented_normal_finding`, `technique_invention`, `contrast_status_changed`,
`PHI_TEXT_CLOUD_BLOCKED`, `cloud_vision_not_allowed`. Every one of these arrives with
`job.safeError` plus a `provenance.degradedReason` written as a sentence, not a code.

The last seven are the relation guards (§2/§3 of the owner's brief): they fire when every
fact survived and the medicine still changed — a canal diameter moved to another level, a
suspected finding stated as definite, a documented extrusion returned as "no extrusion", a
normal cord for anatomy nobody described, 3T or an extra sequence or a comparison study the
study never had, and contrast that was not given. They are errors, so the job never reaches
READY, and each has a positive control proving the honest wording of the same report passes.

`clinical_polarity_flip` covers one direction only — a documented abnormality returned as a
negative. Its reverse, a denied finding returned as asserted, is `denied_finding_asserted`,
which #915 already owns for the narrative fields with a stricter per-sentence rule that runs
for every kind. Merging the two branches showed both guards firing on the same inverted
sentence, so the relation guard's duplicate arm was deleted and #915's rule is now also put
through the structured `OBSERVATIONS` rows, whose three narrative fields are empty by design.
One inverted finding, one code, one sentence for the radiologist to read.

The seven `compose_source_*` codes (§AA) are a different class from all of the above: they
are raised **before** a model is contacted, so they arrive on the `POST /jobs` response as
HTTP 409 with `error` = the clinician sentence, and there is no job, no `safeError` and no
draft to review. A workspace that only renders refusals found on a job will show nothing at
all for them. `processComposeJob` can also raise the same codes on a job that was queued
before a source's patient link moved; those do arrive as `job.safeError`.

## Y.8 Deterministic independence

With AI switched off or unreachable, `deterministicCompose` still answers
`FULL_REPORT`/`IMPRESSION`/edit kinds from the snapshot. For the three new kinds it
returns the radiologist's **own text unchanged** (`PROFESSIONALIZE`, `COMBINE`) or an
explicit "no mechanical equivalent" (`OBSERVATIONS`), with a warning naming that no model
ran. The deterministic reporting engine does not gain a dependency on any of this.

Measured on this head, and worth knowing before a clinic night with the AI off: a
`COMBINE` that really carries a second report **fails** on the deterministic path. The
fallback echoes the study's own text and cannot merge, so the conservation guard fires on
the supplied report's facts — `level_dropped,laterality_dropped,morphology_dropped,location_dropped`
for a cervical source added to a lumbar report (`composeSourceIdentity.request.test.ts` 20,
which also asserts the refusal is a conservation code and not a `compose_source_*` one, so
the two guards cannot be confused by whoever reads the failed job). The suite's 17b case is
the other half: a source whose facts the anchor already restates, which the fallback can
echo and which therefore does reach READY. That is the guard working — no model means no
merge — and a merge that quietly dropped the second study would be worse. It is a `FAILED`
job with a named cause, not a silent downgrade, and the workspace should say "no model was
available to combine these" rather than showing an empty draft.

## Y.9 Measured on the clinic AI PC (11 Oct 2026, `192.168.1.250:11434`, head `ac3d4bd0`)

`RUN_LIVE_OLLAMA=1` drives the shipped prompts, transport, JSON contract **and the
shipped validator** over six synthetic cases per model. 16 of the 18 model calls were
accepted; the two refusals below are the guard working, not the harness failing. Seconds
are wall time for the call; the token figure is what the vendor reported. The table is
generated from that run's own log (`node tmp/919-live-table.cjs <log>`), because a
transcribed measurement becomes a rumour.

| operation | gemma3:12b | medgemma1.5:4b | qwen3:14b |
| --- | --- | --- | --- |
| professionalize MRI LS spine (8.2 mm canal, right S1 extrusion) | 29.4 s / 2,248 accepted | 7.1 s / 2,177 accepted | 25.8 s / 2,210 accepted |
| rephrase MRI cervical ("make more professional") | 14.8 s / 1,953 accepted | 2.9 s / 1,922 accepted | 8.6 s / 1,902 accepted |
| professionalize MRI brain (Fazekas 2) | 14.9 s / 2,035 accepted | 2.8 s / 1,998 accepted | 9.0 s / 2,009 accepted |
| professionalize whole-spine screening | 21.5 s / 2,125 accepted | 3.4 s / 2,067 accepted | 11.2 s / 2,081 accepted |
| combine cervical + lumbar | 36.4 s / 2,409 accepted | **blocked** — discarded the lumbar study (`measurement_mutation`, `measurement_dropped`, `level_dropped`, `laterality_dropped`, `severity_dropped`, `morphology_dropped`, `location_dropped`) | 15.9 s / 2,321 accepted |
| observations dictated shorthand | **blocked** — 1 row from a 4-fact dictation (`measurement_dropped`, `morphology_dropped`, `location_dropped`) | 9.0 s / 2,407 accepted, 4 rows | 26.0 s / 2,422 accepted, 4 rows |

The same run also re-generated a `FULL_REPORT` from scratch on `gemma3:12b`: 41.7 s, all
eight observations, four levels and the bilateral laterality preserved, no measurement
invented.

So, stated plainly: **text transformation works on every installed local model, `combine`
works on the two larger models and not on `medgemma1.5:4b`, and structured extraction from
dictation works on `qwen3:14b` and on `medgemma1.5:4b` — and not on `gemma3:12b`, which
compresses four dictated facts into one row.** Nothing here was tuned for; a model that
loses a measurement is configured away from that operation, not trained. No
language-quality claim is being made about diagnostic accuracy — the cases are synthetic
and a radiologist has not read them on a screen.

Five defects these runs found and fixed. The first three came from the earlier run; the
last two were found by THIS one, which is why the matrix is re-run whenever a guard
changes — a guard change can only be judged against answers nobody scripted.

1. A faithful COMBINE was **blocked** as invented content, because "what the radiologist
   supplied" did not include the second report the model had been given — and, in the
   other direction, a merge that silently dropped that report could not fail.
2. "no acute infarct or **hemorrhage**" was blocked as an invented abnormality against a
   dictation that said **haemorrhage** — a spelling, not a fact.
3. `gemma3:12b` returned chat markdown (`**Cervical Spine:**`) and every guard passed it.
   CARE renders reports as plain text into print HTML and PDF, so those asterisks would
   have reached the report of record; emphasis markers are now stripped at the parse
   boundary, before validation and before storage.
4. **The row pruner deleted a faithful observation because of the model's choice of
   label.** `qwen3:14b` filed the dictated "canal 8.2 mm" under the canonical concept
   "canal stenosis"; "stenosis" is not in the dictation, so the row was dropped, the
   8.2 mm went with it, and the conservation rule then failed the job for a loss the
   pruner itself had caused. A concept unsupported *only as a label* now keeps the row
   and names the mismatch to the reviewer; a concept unsupported in the row's own text is
   still deleted. This is what made Operation 1 pass on `medgemma1.5:4b` as well as
   `qwen3:14b` — it had been answering correctly all along.
5. **A structure is licensed by any wording the radiologist used for it.** Three answers
   were blocked for "inventing a normal spinal cord" in reports that dictated
   `Cord signal normal.` / `no cord signal abnormality`: the model wrote the longer name
   and the guard compared the longer name. Adding `vertebral` as an alias then produced a
   fresh false positive — a lumbar report blocked for inventing a normal *vertebral
   artery* over the phrase "at the L1 vertebral level" — so aliases are limited to short
   forms that cannot denote a different structure.

# Z. Integration guide for the Reporting Workspace (2026-10-11)

Written for the agent that owns the workspace UI. Every frontend symbol below was read in
this tree, with its file:line, rather than assumed.

## Z.1 The boundary with the deterministic generator

| action | what it is | whose |
| --- | --- | --- |
| **Generate Professional Report** | deterministic report assembly from the format + observation ledger, no model in the loop | PR #917 — `generateProfessionalReport` in `lib/zai-workspace/store.ts`, button `data-testid="generate-professional-report"` |
| **Professionalize Report** | AI rewrite of the report the radiologist already has | this contract, `jobKind: "PROFESSIONALIZE"` |
| **Structure Observations** | AI proposal of observation rows from dictated shorthand | this contract, `jobKind: "OBSERVATIONS"` |
| **Combine Reports** | AI synthesis of the current report with reports the app supplied | this contract, `jobKind: "COMBINE"` |

`generateProfessionalReport` is on `main` as of #917, and this branch is merged onto it.
Nothing here renames it, writes to it, or replaces it — the AI operations produce a
**proposal** and the deterministic generator produces the **report**. Keep them two buttons
with two names.

#920 later fixed the same clinical defect on the deterministic side — a denied finding
reading as a positive one — inside `generateLocalImpression.ts` (`assertsAbnormality`,
`isAbnormalFindingLine`) and the impression-refresh path. The composer validator does not
import either function, and nothing in this branch re-pins them: the deterministic side
decides what a *generated* report may conclude, `denied_finding_asserted` decides what a
*model* may propose. Two surfaces, one rule each, no shared code to break.

## Z.2 What the caller must send

- `snapshot.worklistId` is **mandatory**. The server resolves the study and the report of
  record from that one anchor (#905) and answers `compose_worklist_required` before any
  model is contacted. `studyId` may be sent and must agree with the worklist row, or
  `compose_study_conflict`. `reportId` may be omitted — the server derives it.
- The rest of the snapshot is what `buildSnapshot()` already produces
  (`hooks/useReportComposer.ts:211`): findings, impression, technique, observations from
  `deriveComposeObservations(appliedPathologyPatches)` (`lib/reportComposer/composeObservations.ts:158`),
  and the hash mirror the server recomputes. Do not build a second snapshot shape.
- Operation-specific additions: `instruction` for a refine, and for `COMBINE` the array
  `additionalReports`. Each entry must name a CARE study — `worklistId` (a
  `radiology_worklist.id`) and/or `reportId` (a `patient_reports.id`) — beside its text:
  `[{ worklistId, reportId, studyInstanceUid, label, modality, region, findings, impression }]`.
  CARE resolves those references and proves the source belongs to the same patient as the
  study being reported (§AA). A source that names no study is refused.

## Z.3 Lifecycle the UI already knows

`QUEUED → COMPOSING → READY | FAILED`, then `STALE_READY` if the live report moved underneath
it, then `APPLIED | DISCARDED | CANCELLED | OBSOLETE`.

- Poll `GET /jobs/:id`. The consumer now polls every 20 s with a re-entrancy guard, so a
  click is answered in about the time the model takes rather than up to a minute.
- Review per change with `/changes/:changeId/accept` and `/reject`; nothing is written to the
  report by accepting a change.
- The write happens in `applyAccepted()` (`hooks/useReportComposer.ts:401`): freshness
  recheck, STALE refusal, clinical-significance guard, `materializeAcceptedText(...)`
  (`:15`, used at `:488`), then `applyAiComposerAccepted(...)`
  (`lib/zai-workspace/store.ts`, declared at `:911` and implemented at `:3250` on the merged
  head), then `opts.persistAccepted(tag)`
  (`:518`) and `/applied` containment proof. **Reuse this path; do not write another applier.**
  `applyAiComposerAccepted` deliberately does not touch `appliedPathologyPatches` — AI wording
  is presentation, never a ledger edit.
- `OBSERVATIONS` has no Apply path: `/applied` is refused with `compose_nothing_to_apply`.
  Rows are proposals to review; the route by which an accepted row becomes an observation is
  the workspace's own ledger action, not this API. Nothing may generate a final report from
  unreviewed extraction, and that is enforced server-side rather than by convention.
- The signed-report protections are unchanged: a finalized report refuses composition at
  enqueue (`finalized`) and refuses the write at apply (`refuseSignedMutation`, store.ts:3278
  on the merged head).

## Z.4 Provider, model and cost are reported, not guessed

`GET /jobs/:id` returns `job.provider` and `job.usage` (prompt/completion/total tokens, and
cost where the vendor reports it) alongside the model already on the row. The route that
answered is chosen per operation (§Y.6): `report_composer_<operation>` then
`report_composer` then the clinic default. An unavailable provider is refused by name and
nothing is dialled — there is no silent substitution of a different provider or model, and a
cloud failure never falls back to Ollama.

## Z.5 Sequencing that matters, measured rather than guessed

`inputHash` is computed from the snapshot the client froze. If the deterministic generator
rewrites Findings first, an AI proposal queued against the earlier text arrives `STALE_READY`
— correctly, because the report did move. So the order is **AI apply → deterministic
generate**, never the reverse, and an operation whose proposal went stale should be re-run
against the new text rather than forced.

## Z.6 Refusal handling in the UI

Every refusal in §Y.7 arrives as `job.safeError` plus a `provenance.degradedReason` that is a
sentence written for a radiologist. Surface the sentence; do not show the code. A relation
guard refusal (`measurement_repositioned`, `certainty_escalation`, `technique_invention`, …)
means the model's answer lost or invented something, and the report is untouched — say that,
because the failure the owner is guarding against is a lost measurement nobody noticed.

## AA. Who each combined report belongs to (COMBINE source identity)

A `COMBINE` merges a second report into the study being reported. Until this section the
only evidence that the second report was this patient's was the browser's own caption, so a
stale tab or a wrong row in a prior-study list could put another person's findings into this
person's report — and every clinical guard in §Y.7 would stay silent, because each fact in
the wrong patient's report is faithfully present.

**The rule.** Every entry in `additionalReports` must carry `worklistId` and/or `reportId`,
and CARE looks both up (`verifyComposeSourceIdentities`, `composeIdentity.ts`) using the same
rows the anchor and the finalize path treat as authoritative — `radiology_worklist`,
`patient_reports`, plus the billed study cross-checked against its worklist row exactly as
`bindRadiologyReportIdentity` does. The source's patient must be the anchor's patient, and
**both must be known**: a study not yet linked to a patient is refused on either side. Two
references on one source must describe one study. No name, date, accession or `label` is
read by any part of this — the caption is for the clinician's eye only.

**Where it is enforced, twice.** `POST /jobs` refuses before a job exists (HTTP 409, `error`
= the sentence, no `jobId`). `processComposeJob` re-checks before building the prompt, because
the queue is a background worker: a study can be re-linked in Match Center, or signed by
another workstation, while its combination waits — and a job queued before this gate existed
has no identity on it at all. The model never sees an unverified merge, which is the whole of
"AI cannot override an identity refusal".

| code | what it means | what the UI should do |
| --- | --- | --- |
| `compose_source_unidentified` | the source names no CARE study | offer to pick the study from the patient's own list; do not offer "combine anyway" |
| `compose_source_unmatched` | that study has no patient linked | send the clinician to Match Center |
| `compose_source_anchor_unverified` | the study being reported has no patient linked | same, and it applies to every source in the request |
| `compose_source_not_found` | the row is gone (deleted, or the id was never a study) | re-open the other study and retry |
| `compose_source_conflict` | the source's own rows disagree about which study/patient it is | report it as a data problem, not a user error |
| `compose_source_patient_mismatch` | it is another patient's report | stop; this is the refusal the whole section exists for |
| `compose_source_uid_conflict` | the declared DICOM UID is not the row's | re-read the study, do not let the caller edit the UID |

Each message arrives with a position when more than one source was sent — `(report 2 of 3)` —
so the clinician knows which entry to fix.

**The identifiers are kept.** The resolved record per source — `worklistId`, `studyId`,
`reportId`, `reportNumber`, `patientId`, `studyInstanceUID`, `modality`, `worklistStatus`,
`signed`, `position`, and the caption — is written into the job's `validation_json` (which is
how provider and usage are already recorded; the table gains no column) and is returned by
`GET /jobs/:id` as `job.validation.sourceIdentities`. `studyInstanceUID` is the row's value,
never the caller's. Show it: a merged report that cannot say which study each half came from
is not reviewable.

**Signed sources are preserved.** A signed prior study is the normal thing to combine, and it
is read-only here: the composer's own writes (`aiComposeStatus`, `aiComposeJobId`) land only
on the anchor, and the source's `patient_reports` and worklist rows are asserted
byte-identical before and after (`composeSourceIdentity.request.test.ts` 17). The job can
never be applied into a source — Apply resolves the anchor alone (#905) — and an anchor
signed while its combination waits is refused at composition with `compose_locked` (case 16),
which is the case that also proves the worker's re-check reads the anchor afresh.

**What is narrower than before.** A report CARE does not hold — an outside printout typed
into the box — has no row to resolve, so it is refused. "Confirm every source belongs to the
intended patient" and "accept unverifiable pasted text" cannot both hold. The route in is
CARE's own: attach/link that study so it has a patient, a UID and a report of record, and it
combines like any other.

**What is still the clinician's claim.** The *narrative* still arrives from the browser, so
identity is proved for the named study, not for the words typed under it. Binding the text to
the row was tried and rejected: a signed report's `body` and a draft's `findings_sections`
are not byte-equal to the editor's text (the print formatters own them), so an equality gate
would refuse honest merges. A mis-transcription is caught by the conservation and relation
guards and by the radiologist's review — say so in the UI rather than implying the machine
proved the wording.

**Freshness.** The references join `canonicalAdditionalReportsHashPayload`, on both mirrors,
so pointing the picker at a different study is a different request and the earlier READY draft
goes `STALE_READY` instead of staying applicable. Snapshots with no `additionalReports` hash
exactly as before.

**With no model available** (`deterministicCompose`) a real merge fails: the fallback echoes
the study's own text, cannot merge, and conservation refuses it (`…level_dropped,laterality_dropped,
morphology_dropped,location_dropped`). Case 20 asserts that the refusal is a conservation code
and *not* a `compose_source_*` one, so the two guards can never be confused from the failed
job, and that the sources are still named on the record.

