# Phase P3 — Clinical Workflow Integration (Scheduler · Workspace) Report

**Scope:** Gates **G10 (AI Scheduler)** and **G11 (Radiologist Workspace Integration)** from
`V1.1_IMPLEMENTATION_CONSTITUTION.md`. **The first radiologist-visible phase** — and therefore the
most safety-sensitive. **Everything is feature-flagged; AI is OFF by default for everyone**; only an
explicitly enabled pilot radiologist sees anything. The radiologist remains the only signer — AI never
signs. Strangler Pattern throughout (reuse: the existing job engine, cron, feature-flags backbone,
staff auth, workspace, and the P0–P2 pipeline).

---

## 1. Implementation summary

| Area | Gate | What shipped (reusing existing infra) | Status |
|---|---|---|---|
| Scheduler | G10 | ONE scheduler *policy layer* over the existing `radiologyJobs` engine — 5 modes (Immediate, Night Batch, On-demand, Scheduled Reprocessing, Learning) + full config. **No new worker/queue.** | ✅ |
| Workspace | G11 | Feature-flagged **AI Draft Panel** in the existing reporting workspace: grounded findings only, evidence + confidence, provenance, Accept/Edit/Ignore, shadow status. | ✅ |
| Feature flags | G11 | Master flag (`ff_radiology_ai`, reuses the existing `feature_flags` backbone) + per hospital/radiologist/modality/study-type policies + shadow/pilot/production modes. **Default OFF.** | ✅ |
| Preferences | G11 | Per-radiologist preferences (auto-generate/open, style, badges, thumbnails, auto-compare, auto-measurements, language, structured). | ✅ |
| Modality policies | G10 | Per-modality mode (immediate / night_batch / manual / disabled) for MR/CT/CR/US/MG/Doppler. | ✅ |
| Voice | G11 | The panel's Accept/Edit/Ignore actions + an `onInsertText` hook to hand accepted text to the report editor (full voice-over-draft wiring is a staging step — see §11). | ◑ (hook shipped) |

---

## 2. Gates completed (G10–G11)

- **G10 AI Scheduler** — a policy layer, not a queue. `decideScheduling` (pure) chooses per study across
  the 5 modes; `scheduleStudy` enqueues via the existing `enqueueAiShadowJob` → the existing runner.
  Config (`ai_scheduler_config`): night start/end, quiet hours, GPU/CPU limits, max concurrent, retry,
  include priors/OCR, skip finalized/unchanged. Night Batch / Scheduled Reprocessing / Learning run as
  crons in the existing `cron.ts`, each hard-gated by the master flag. Queue dashboard / running / failed /
  cancel reuse the existing `jobBacklogCounts` / `listDeadLetterJobs`.
- **G11 Workspace Integration** — `AiDraftPanel` renders in `RadiologyReportingWorkspace.tsx` (one guarded
  mount) and shows **grounded findings only** (from the P1/P2 shadow tables), evidence anchors, confidence,
  prior/measurement references, provenance, and shadow status, with an **Accept / Edit / Ignore** workflow.
  It renders **nothing** unless `visibleToRadiologist` (pilot/production). It never writes or signs a report.

---

## 3. Files changed

**New — schema/migration:** `lib/db/src/schema/aiClinicalConfig.ts`, `migrations/add_ai_clinical_config.sql`.
**New — api-server `lib/ai/`:** `aiPolicy.ts`, `aiScheduler.ts` (pure, + `.test.ts` each), `clinicalConfigService.ts`,
`schedulerService.ts`, `draftService.ts`. **New route:** `routes/aiClinical.ts`.
**New — frontend:** `lib/aiClient.ts`, `components/ai/AiDraftPanel.tsx`, `components/ai/AiSettingsPanel.tsx`.
**Modified:** `lib/db/src/schema/index.ts`, `routes/index.ts` (mount `/api/ai`), `cron.ts` (register scheduler crons),
`RadiologyReportingWorkspace.tsx` (import + one guarded `<AiDraftPanel/>` mount), `scripts/grounding.manifest.json` (+17 → 76).

---

## 4. Database migrations

`migrations/add_ai_clinical_config.sql` — 5 additive tables (`ai_feature_policies`, `ai_scheduler_config`,
`ai_modality_policies`, `ai_radiologist_preferences`, `ai_draft_feedback`). Idempotent; passes
`check-migration-order.cjs`. **Seeds SAFE defaults:** the master flag `ff_radiology_ai` is inserted **disabled**,
and every modality policy is **`disabled`** — so a fresh deploy shows AI to nobody.

---

## 5. Feature flags

| Flag / scope | Effect | Default |
|---|---|---|
| `ff_radiology_ai` (global master, `feature_flags`) | Hard gate for ALL AI. Off ⇒ AI invisible everywhere. | **OFF** |
| `ai_feature_policies` scope=`hospital` | Enable/disable per hospital | none (OFF) |
| scope=`modality` | Enable/disable per modality | none (OFF) |
| scope=`study_type` | Enable/disable per study type | none (OFF) |
| scope=`radiologist` | Enable a single **pilot** radiologist | none (OFF) |
| mode `shadow` / `pilot` / `production` | shadow=compute only (never shown); pilot/production=visible | shadow |

Resolution is **most-specific-wins** (radiologist > study_type > modality > hospital > global); no match ⇒ OFF.
A radiologist is shown AI only when the master flag is ON **and** a matching policy is enabled **and** its mode
is pilot/production (`visibleToRadiologist`). Pure logic in `aiPolicy.ts`, unit-tested.

---

## 6. Scheduler architecture

```
study arrival / STAT / manual click / cron
        │
        ▼
AI Scheduler (policy — aiScheduler.ts / schedulerService.ts)
  · resolve modality mode + config + quiet/night windows + skip rules
  · decideScheduling() → {enqueue?, mode}
        │  (enqueue only)
        ▼
enqueueAiShadowJob()  ──►  EXISTING radiology job engine (radiologyJobs runner)
                              · SKIP LOCKED · retry · dead-letter (unchanged)
        │
        ▼
AI Shadow Pipeline (P1/P2)  ──►  shadow tables (snapshot/manifest/evidence/draft)
        │
        ▼
AiDraftPanel reads the draft (only when visibleToRadiologist)
```

**Modes:** *Immediate* (arrival/STAT/manual → now; STAT bypasses quiet hours); *Night Batch* (cron in the
night window; skips finalized/unchanged); *On-demand* (`POST /api/ai/generate`); *Scheduled Reprocessing*
(weekly cron; the pipeline's `inputHash` dedup makes it a no-op unless a version changed); *Learning*
(weekly cron; aggregates feedback — **no auto-retrain**). Admission control (`admitJob`) enforces max
concurrency + GPU/CPU ceilings (real GPU/CPU metrics are supplied in staging).

---

## 7. Workspace integration

`AiDraftPanel` (fixed-position, collapsible, flag-guarded) mounted once in the workspace. It shows only
**grounded** findings (the gauntlet-passed set from P2; the quarantined set is shown as a count, never as
findings), each with laterality, confidence, image evidence (series/SOP/frame) and measurement references,
plus the impression and the immutable provenance (model/prompt/rules versions, degraded flag). Actions:
**Accept** (records feedback + `onInsertText` to the editor), **Edit**, **Ignore/Reject** (records feedback).
`AiSettingsPanel` provides radiologist preferences and (for admins) modality policies, pilot enablement, and
scheduler config. The panel and settings talk only to the gated `/api/ai` endpoints; **no report write, no
signature** path is touched.

---

## 7.5 AI draft storage map (P3 completion patch)

The complete storage chain, with **actual table and column names**. The boundary is absolute: AI writes
only the AI stores; the human report is written only through the existing radiologist draft/finalize workflow.

| # | Stage | Where it lives (table.column) | Properties |
|---|---|---|---|
| 1 | **Raw provider response** | **Transient** — held in memory during the gateway call (`requestStructuredReport` provider `text`), validated, then discarded. Deliberately **not persisted** as canonical (avoids storing ungrounded/PHI-bearing raw text). `ai_job_queue.result_json` (TEXT) and `dicom_retry_queue.payload` are execution artifacts, **not** the report store. | transient/audit-only |
| 2 | **Validated structured provisional report** | `ai_shadow_drafts.draft_json` (**JSONB**) | **immutable + versioned** — trigger `ai_shadow_drafts_immutable_guard` rejects UPDATE/DELETE |
| 3 | **Accepted grounded findings** | `ai_shadow_drafts.draft_json.findings` (gauntlet-passed). On **Accept** → inserted into `radiology_report_drafts.raw_findings` via the editor (`setRawFindings` → existing autosave). Feedback in `ai_draft_feedback (action='accept')`. | human-gated insert |
| 4 | **Quarantined findings** | `ai_shadow_drafts.draft_json.quarantined` (kept for audit; shown only as a count, never as findings) | never surfaced |
| 5 | **Processing Manifest** | `ai_processing_manifests` (`model_version`+digest, `prompt_version`, `snapshot_content_hash`, `input_hash`, `rules_version`, `image_selection_json`) | immutable |
| 6 | **Evidence anchors** | `ai_evidence` (`series_instance_uid`, `sop_instance_uid`, `frame_number`, `measurement_ref`, `confidence`) linked by `draft_id`+`manifest_id` | append-only |
| 7 | **Radiologist working draft** | **`radiology_report_drafts`** (`raw_findings`, `impression`, `recommendation`, `structured_json`, `status='DRAFT'`) — the EXISTING human store | mutable, human-owned |
| 8 | **Final signed report** | **`patient_reports`** — written only by the EXISTING finalize endpoint (re-reads `radiology_report_drafts`, stamps `draft.final_report_id`) | radiologist-signed only |
| 9 | **Amendments** | the existing `patient_report_amendments` lifecycle | human-controlled |

**The immutable provisional record (`ai_shadow_drafts`) is directly linked** to: `canonical_study_id`,
`snapshot_revision` (+ `study_snapshot_id`), `manifest_id` (Processing Manifest), `ai_job_id` (the AI job),
`model_digest`, and `prompt_version` — plus a monotonic `version`.

**Required-architecture compliance:**

- ✅ Raw provider output is transient (not canonical). `ai_job_queue.result_json` is **not** the report store.
- ✅ Validated provisional report lives in a **dedicated, immutable (trigger-enforced), versioned JSONB** record.
- ✅ Linked to canonicalStudyId, snapshot revision, Processing Manifest, AI job, model digest, prompt version.
- ✅ **Regeneration inserts a new version** (`nextProvisionalVersion` → `version+1`); an old draft is never overwritten (DB trigger).
- ✅ Accepted content is written through the **existing** `radiology_report_drafts` editor/autosave — not a parallel store.
- ✅ Final content is written only through the **existing** finalize/sign workflow into `patient_reports`.
- ✅ **AI never writes `patient_reports`, the working draft, or amendments, and never signs** — enforced by the static guard test `aiIsolation.test.ts`.
- ✅ Saved human draft **always wins** over AI on reopen; AI is never auto-prefilled (`chooseReportPrefill`); reopening restores content from `radiology_report_drafts`, not from the AI result.

### Editor binding (completed)

`AiDraftPanel` actions bind to the existing workspace editor: **Accept**/**Edit** insert the formatted finding
(`formatFindingForInsertion`) into `rawFindings` via `onInsertText → setRawFindings → appendToFindings`, which
the existing autosave persists to `radiology_report_drafts`; **Ignore/Reject** record feedback only
(`shouldInsertOnAction` gates insertion). **Accept all** confirms then inserts all grounded findings. Because
inserts land in the normal findings editor state, the **existing voice dictation** operates on the same text
and can replace or extend inserted AI content. **Finalize** is unchanged — it flows through the existing
finalize endpoint under the radiologist's authenticated permissions; there is **no AI-specific signing path**.

## 8. Test results

- `pnpm typecheck:libs` ✅ · `pnpm --filter @workspace/api-server typecheck` ✅ · **`pnpm --filter @workspace/diagnostic-erp typecheck` ✅** (the panel, settings, client, and workspace mount all compile).
- `pnpm test` → **2607 passed** (was 2582; +17 P3 tests +8 completion-patch tests). The 7 failing test files
  error only on missing `DATABASE_URL` (no DB in this sandbox) — all pre-existing, none in changed areas.
- **Completion-patch tests (8):** AI draft **immutability** guard + **regeneration → new version**
  (`provisionalVersioning`); **AI isolation** static guard — no AI module writes `patient_reports`, the working
  draft, or amendments, or signs (`aiIsolation`); **editor binding** — accept/edit insert & ignore/reject don't,
  saved human draft wins over AI on reopen (`aiDraftBinding`).
- P3 suite (2 files, 17 tests): **policy** (master-off ⇒ OFF, default OFF, shadow-not-visible, single pilot
  visible, most-specific-wins radiologist-disable overrides global, per-modality) · **scheduler** (night/quiet
  window wrap, manual-always, skip finalized/unchanged, disabled/manual modalities, immediate vs quiet-defer,
  STAT bypass, night-batch defer + STAT jump, admission control GPU/CPU/concurrency).
- Grounding CI: **76 claims** ✅ · migration-order ✅.

**Requires staging validation** (no `DATABASE_URL`/Orthanc/providers here): the DB-backed services
(`resolveAiEnablementForUser`, `scheduleStudy`, `getLatestDraftForStudy`, night/reprocess/learning crons),
the `/api/ai` endpoints end-to-end, and the panel's live rendering + voice-over-draft editor wiring.

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI accidentally visible to a non-pilot user. | Low | High | Triple gate: master flag OFF by default + policy default OFF + `visibleToRadiologist` requires pilot/production; unit-tested. Seed migration ships master OFF. |
| Panel edit accidentally writes/signs a report. | Very low | High | The panel calls only `/api/ai` (read + feedback); it has no report-write or sign path. Signing is untouched. |
| Scheduler enqueues a flood. | Low | Medium | Batch functions are LIMIT-bounded and gated; `admitJob` caps concurrency; STAT-only during quiet hours. |
| GPU/CPU limits not enforced without real metrics. | Expected | Low | `admitJob` accepts metrics; wiring real GPU/CPU probes is a staging step (documented). |
| The one workspace edit could affect layout. | Low | Low | The mount is a fixed-position overlay that renders `null` when disabled (the default); typecheck passes; behind the flag. |
| Voice-over-draft not fully wired to the editor. | Expected | Low | `onInsertText` hook shipped; deep editor/voice binding is a staging integration (§11). |

---

## 10. Rollback plan

**Instant (no deploy):** set `feature_flags.ff_radiology_ai = false` (or delete matching `ai_feature_policies`
rows) — AI vanishes for everyone immediately; the panel renders nothing.

**Code:** revert the P3 commit. The only radiologist-path change is one guarded overlay mount and a mounted,
fully-gated router; reverting removes both. P0–P2 untouched.

**Database (manual — NOT auto-applied):**

```sql
DROP TABLE IF EXISTS ai_draft_feedback;
DROP TABLE IF EXISTS ai_radiologist_preferences;
DROP TABLE IF EXISTS ai_modality_policies;
DROP TABLE IF EXISTS ai_scheduler_config;
DROP TABLE IF EXISTS ai_feature_policies;
DELETE FROM feature_flags WHERE key = 'ff_radiology_ai';
```

---

## 11. Staging validation guide

AI is OFF by default after deploy — these steps turn it on for one pilot user and verify safety. (Assumes a
staging env with `DATABASE_URL`, Orthanc, and a configured local model + capability-registry row from P2 §8.)

1. **AI disabled globally** — after deploy, open the workspace as any radiologist; confirm **no AI panel** appears
   (`GET /api/ai/policy` → `visibleToRadiologist: false`).
2. **Enable one pilot radiologist** — as admin: turn on the master flag
   (`feature_flags.ff_radiology_ai = true`), set one modality to a live mode
   (`PUT /api/ai/modality-policies {modality:"CT", mode:"immediate"}`), and enable the pilot
   (`PUT /api/ai/policies {scope:"radiologist", scopeKey:"<staffId>", enabled:true, mode:"pilot"}`).
   Confirm the pilot sees the panel and other radiologists still do not.
3. **Generate one AI draft** — pilot clicks **Generate** (or Immediate mode on arrival); drive the tick; confirm a
   shadow draft appears in the panel.
4. **Only grounded findings appear** — confirm the panel lists only grounded findings; a seeded ungrounded/quarantined
   finding shows as a "quarantined" count, never as a finding.
5. **Radiologist edits are preserved** — Accept/Edit a finding; confirm `ai_draft_feedback` records the action and the
   accepted text reaches the report editor (via `onInsertText`); the radiologist's report content is authoritative.
6. **AI never auto-signs** — confirm there is no path from the panel to finalize/sign; the report is signed only by the
   radiologist via the existing lifecycle.
7. **Scheduler processes studies** — enqueue via Immediate + confirm the job runs on the existing engine; check the
   admin queue dashboard (`GET /api/ai/queue`) shows running/failed/backlog; cancel a job (`POST /api/ai/jobs/:id/cancel`).
8. **Night Batch** — within the night window, run `POST /api/ai/scheduler/run/night-batch` (or wait for the cron);
   confirm eligible unprocessed studies are enqueued and finalized/unchanged ones are skipped.
9. **Immediate Mode** — with a modality set to `immediate`, confirm a routine arrival enqueues outside quiet hours and
   a STAT study enqueues even during quiet hours.
10. **Rollback by flags** — set `ff_radiology_ai = false`; confirm the panel disappears for the pilot immediately and
    all `/api/ai` reads return "not enabled" — no code deploy required.

---

## What was explicitly NOT done (deferred)

No DICOM SR encoder, multi-hospital federation, knowledge graph, digital twin, multi-agent AI, or pathology
integration. P3 stops here.
