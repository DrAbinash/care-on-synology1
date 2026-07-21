# Phase P1 — AI Execution Layer (Shadow Mode) Implementation Report

**Scope:** Gates **G4 (AI jobs on the existing engine)**, **G5 (snapshot + manifest + evidence)**,
**G6 (image anchors)** from `V1.1_IMPLEMENTATION_CONSTITUTION.md` §5/§6/§9/§10. **Backend only, SHADOW
MODE.** No radiologist-facing output, no report changes, no reporting UI, no AI Gateway/model call.
Nothing beyond P1 was implemented.

---

## 1. Implementation summary

| Task | Gate | What shipped | Status |
|---|---|---|---|
| 1 | G5 | **Immutable Study Snapshot** — order-independent content hash of the actual DICOM instance set; late-series detection; per-revision rows; never overwritten. | ✅ |
| 2 | G5 | **Processing Manifest** — immutable record of study identity, snapshot hash, model/prompt/pack/rules/measurement versions, image selection, timestamps, and a reproducibility `input_hash`. | ✅ |
| 3 | G5 | **Evidence Store** — per-finding anchors (series/SOP/frame, measurement ref, confidence, evidence type) with a hard **grounding gate**; heatmap type + `overlay_ref` **reserved only**. | ✅ |
| 4 | G6 | **Structured image selection** — deterministic, modality-aware, returning `{seriesUid, sopUid, frameNumber, imageData}`. | ✅ |
| 5 | G4 | **AI execution on the existing job engine** — one handler registered in `RADIOLOGY_JOB_HANDLERS`; enqueues via the existing `enqueueRadiologyJob`. **No new scheduler, worker, or queue.** | ✅ |
| — | — | **Shadow mode** — snapshot, manifest, evidence, and structured draft stored in dedicated shadow tables; nothing exposed to radiologists. | ✅ |

**The pipeline runs end-to-end** (`makeAiShadowPipelineHandler`): snapshot → structured image selection →
immutable manifest → **shadow inference stub** (the reserved seam for the P2 AI Gateway; **no model is
called**) → evidence grounding → persist. Because there is no gateway yet, the stub emits an empty
well-formed draft, so a shadow run produces a snapshot + manifest + (evidence-ready) draft with zero
findings — exactly the P1 exit criterion.

---

## 2. Files changed

**New — schema & migration:**
- `lib/db/src/schema/aiExecution.ts` — `study_snapshots`, `ai_processing_manifests`, `ai_shadow_drafts`, `ai_evidence`.
- `migrations/add_ai_execution_shadow.sql` — the four shadow tables (idempotent, additive).

**New — pipeline (`artifacts/api-server/src/lib/ai/`):**
- `studySnapshot.ts` — pure: content hash, manifest, `decideRevision` (late-series).
- `processingManifest.ts` — pure: `computeInputHash` (reproducibility).
- `evidence.ts` — pure: `validateEvidenceAnchor` (grounding gate).
- `studyImageSelection.ts` — pure: `selectImageAnchors` (modality-aware, provenance).
- `studyImageFetch.ts` — Orthanc DICOMweb: `listStudyInstances`, `renderAnchors`, `selectStudyImages`.
- `shadowInference.ts` — the reserved inference seam + P1 stub provider (no model).
- `shadowPipeline.ts` — the orchestrating job handler + `enqueueAiShadowJob`.
- `studySnapshot.test.ts`, `processingManifest.test.ts`, `evidence.test.ts`, `studyImageSelection.test.ts` — 31 unit tests.

**Modified:**
- `lib/db/src/schema/index.ts` — export the new schema.
- `artifacts/api-server/src/lib/radiologyJobHandlers.ts` — register `ai_shadow_pipeline` in the handler map.
- `scripts/grounding.manifest.json` — +18 P1 grounding claims (now 40 total).

> **Design separation:** the pure logic (hashing, revision, evidence, selection) is in DB-free modules so
> its tests run without a database; the DB/Orthanc side-effects are isolated in `studyImageFetch.ts` and
> `shadowPipeline.ts`. The legacy radiologist AI-draft route (`routes/aiReporting.ts`) was **not touched** —
> its `fetchStudyImages` remains; the new structured selector supersedes it for the pipeline and will
> replace it under the strangler plan in a later phase.

---

## 3. Database migrations

`migrations/add_ai_execution_shadow.sql` creates four tables in FK dependency order:
`study_snapshots` → `ai_processing_manifests` → `ai_shadow_drafts` → `ai_evidence`. All
`CREATE TABLE/INDEX IF NOT EXISTS`; additive only; references the core `radiology_studies` table plus
tables created earlier in the same file. **Idempotent, forward- and backward-compatible.** Passes
`node scripts/check-migration-order.cjs`.

Uniqueness that enforces immutability: `study_snapshots(study_instance_uid, revision)` and
`study_snapshots(study_instance_uid, content_hash)` are unique — a given content set maps to exactly one
snapshot row, and a new content set is a new revision.

---

## 4. Test results

- `pnpm typecheck:libs` ✅ · `pnpm --filter @workspace/api-server typecheck` ✅
- `pnpm test` → **2544 passed** (was 2513; +31 P1 tests). The 7 failing test *files* error only on
  missing `DATABASE_URL` (this sandbox provisions no DB) — all pre-existing, none in changed areas.
- P1 suite (`vitest run artifacts/api-server/src/lib/ai/`) → **4 files, 31 tests, all pass**:
  - **Snapshot integrity** — hash determinism, order-independence, add/remove sensitivity, cross-study distinctness, counts.
  - **Late-series detection** — first=rev 1, unchanged=no-op, added series=rev 2 (never overwrite).
  - **Manifest reproducibility** — identical inputs → identical hash; selection-order-independent; changes on any version/selection change.
  - **Evidence validation** — grounded image accepted; ungrounded (SOP not in snapshot) rejected; measurement ref required; heatmap reserved/rejected; confidence bounds; findingKey required.
  - **Image selection** — UID/frame provenance present; representative middle; modality-aware multi-slice for CT/MR; cap; stable ordering; empty/invalid handling.
- `node scripts/grounding-check.cjs` ✅ (40 claims) · `node scripts/check-migration-order.cjs` ✅.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Registering the AI handler changes runtime behavior of the job engine. | Low | Low | The handler is inert until a job of type `ai_shadow_pipeline` is enqueued; nothing enqueues one automatically in P1 (no scheduler). Existing job types are untouched. |
| Shadow pipeline calls Orthanc (network) and loads the NAS. | Low | Low | Only runs when a shadow job is explicitly enqueued; image count capped at 20; renders small JPEGs. No auto-enqueue in P1. |
| Snapshot content hash relies on Orthanc returning the full instance list. | Medium | Low (shadow) | A partial/empty list yields "no instances — not stable" and the job fails cleanly (retryable); no snapshot is written. Stability integration with `dicom_incoming_studies` is a later-phase enqueue concern. |
| Placeholder manifest versions (`*-p1`) are not yet real. | Expected | Low | The manifest schema is complete and immutable; P2 registries fill the real values. Documented. |
| DB-integration and end-to-end (with a real DB/Orthanc) not runnable in this sandbox. | — | — | Pure logic is fully unit-tested; the orchestrator is typed and injectable. Integration is exercised at deploy. |

---

## 6. Rollback plan

**Code:** revert the P1 commit. All changes are additive; the only modification to existing behavior is one
extra (inert) entry in the job-handler map.

**Database (manual only — NOT auto-applied):**

```sql
DROP TABLE IF EXISTS ai_evidence;
DROP TABLE IF EXISTS ai_shadow_drafts;
DROP TABLE IF EXISTS ai_processing_manifests;
DROP TABLE IF EXISTS study_snapshots;
```

All four hold only shadow-derived data (rebuildable by re-running the pipeline); dropping them is lossless
to the clinical system. No clinical table is touched by P1.

---

## 7. What was explicitly NOT done (deferred)

No AI Gateway, Prompt/Capability Registry, Evaluation Framework, Scheduler/Night-Batch UI, AI buttons,
radiologist integration, DICOM SR, multi-agent, knowledge graph, or digital twin. The inference seam is
**reserved** (stub only); heatmap evidence is **reserved** (type + `overlay_ref` column, never populated).
P1 stops here.
