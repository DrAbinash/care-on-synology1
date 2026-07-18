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

## 8. Test results

- `pnpm typecheck:libs` ✅ · `pnpm --filter @workspace/api-server typecheck` ✅ · **`pnpm --filter @workspace/diagnostic-erp typecheck` ✅** (the panel, settings, client, and workspace mount all compile).
- `pnpm test` → **2599 passed** (was 2582; +17 P3 tests). The 7 failing test files error only on missing
  `DATABASE_URL` (no DB in this sandbox) — all pre-existing, none in changed areas.
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
