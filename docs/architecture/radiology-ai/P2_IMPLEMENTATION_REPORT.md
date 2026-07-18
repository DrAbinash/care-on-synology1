# Phase P2 — Trust Layer (AI Gateway · Evaluation · Rules-Before-AI) Report

**Scope:** Gates **G7 (AI Gateway)**, **G8 (Evaluation Framework)**, **G9 (Rules Before AI)** from
`V1.1_IMPLEMENTATION_CONSTITUTION.md`. **Backend only, still SHADOW MODE** — the P1 stub is replaced by
a real AI Gateway, but no radiologist sees output, no reporting workflow/UI changes. Built with the
Strangler Pattern: the "AI Gateway" is the hardened evolution of `lib/ai-providers`, "Rules Before AI"
reuses `lib/report-quality`, and both plug into the existing P1 pipeline seam — no parallel systems.

---

## 1. Implementation summary

| Task | Gate | What shipped (reusing existing code) | Status |
|---|---|---|---|
| AI Gateway | G7 | `requestStructuredReport` in **`lib/ai-providers`** — capability routing, model digest pinning, local-first PHI policy, timeout, retry, circuit breaker (from the existing `ai_provider_health_logs`), provider fallback, schema projection, JSON validation/repair. Reuses `generateAiResponse` / `resolveTaskRoute`. | ✅ |
| Evaluation | G8 | Golden dataset + evaluation runs + regression metrics + **shadow → candidate → live** lifecycle with a **human approval gate**. Pure metrics in `lib/ai-providers/evaluation.ts`; DB runner in api-server. | ✅ |
| Rules Before AI | G9 | Reuses **`runQualityEngine`** (deterministic, before AI); a trust gauntlet (grounding, laterality, negation, contradiction) that **quarantines** invalid findings; **deterministic overrides AI**; **degrade-to-deterministic** on AI failure. | ✅ |

The registered pipeline handler now injects the **AI Gateway** (`gatewayInferenceProvider`) at the P1
inference seam, replacing the stub. The pipeline stores the (validated + quarantined) draft, manifest
(with the **real model version/digest**), and evidence — all shadow.

---

## 2. Gates completed (G7–G9)

- **G7 AI Gateway** — one entry point; ERP never learns the model; degrades (never throws) on total failure.
  - *Capability Registry* (`ai_model_capabilities`): per-model vision/grounded-JSON/long-context + digest + PHI-eligibility.
  - *Provider routing*: reuses `resolveTaskRoute`/`ai_model_routes`; `buildProviderChain` orders **local-first** and filters by capability + PHI.
  - *Model digest/version pinning*: recorded per run in the immutable Processing Manifest (`model@digest`).
  - *Prompt Registry integration*: the versioned prompt store (`ai_prompt_library_versions`) is the version authority; the pipeline pins `promptVersion`.
  - *Schema projection*: `projectSchemaForProvider` (OpenAI json_schema / Gemini responseSchema / Ollama format); server-side `validateProvisionalReport` is the authoritative gate.
  - *Resilience*: `withTimeout`, bounded retry, `computeCircuitState` (derived from `ai_provider_health_logs`), local→cloud fallback.
- **G8 Evaluation Framework** — `ai_golden_cases`, `ai_evaluation_runs`, `ai_evaluation_case_results`, `ai_model_versions`.
  - `runEvaluation` scores a version against the golden set (critical-finding recall, structured-report validation rate).
  - `decideVersionPromotion` + `approveVersion`: metrics alone can only reach **candidate**; **live requires a human**.
- **G9 Rules Before AI** — `runDeterministicQuality` (reuses `runQualityEngine`) runs the deterministic engine over the structured draft; `applyTrustGauntlet` grounds every finding (reusing P1 `validateEvidenceAnchor`), checks laterality/negation/contradiction, quarantines failures, and lets deterministic findings override AI. On gateway failure the pipeline degrades to a deterministic-only draft (`degraded=true`).

---

## 3. Files changed

**New — `lib/ai-providers/` (the Gateway):** `reportContract.ts`, `circuitLogic.ts`, `circuitBreaker.ts`,
`capabilityLogic.ts`, `capabilityRegistry.ts`, `gateway.ts`, `evaluation.ts` (+ 5 `.test.ts`).
**New — `lib/db/src/schema/`:** `aiModelCapabilities.ts`, `aiEvaluation.ts`.
**New — `artifacts/api-server/src/lib/ai/`:** `gatewayInferenceProvider.ts`, `rulesBeforeAi.ts`,
`findingValidation.ts` (+ `.test.ts`), `evaluationRunner.ts`.
**New — migration:** `migrations/add_ai_gateway_and_evaluation.sql`.
**Modified:** `lib/ai-providers/src/index.ts` (export gateway modules), `lib/db/src/schema/index.ts`,
`artifacts/api-server/src/lib/ai/shadowInference.ts` (seam now carries images + provenance),
`artifacts/api-server/src/lib/ai/shadowPipeline.ts` (gateway inference + rules + gauntlet + degradation),
`artifacts/api-server/src/lib/radiologyJobHandlers.ts` (inject the gateway), `scripts/grounding.manifest.json` (+20 claims → 59).

> Sanctioned P1 touch: the inference seam (`shadowInference.ts`) gained an `images?` input and a
> `provenance` return — required to let the real gateway replace the stub and record the real model.
> The P1 snapshot/selection/manifest-dedup logic is unchanged.

---

## 4. Database migrations

`migrations/add_ai_gateway_and_evaluation.sql` — 5 additive tables (`ai_model_capabilities`,
`ai_model_versions`, `ai_golden_cases`, `ai_evaluation_runs`, `ai_evaluation_case_results`). Idempotent
(`IF NOT EXISTS`), forward/backward-compatible, no clinical table touched. Passes `check-migration-order.cjs`.

---

## 5. Test results

- `pnpm typecheck:libs` ✅ · `pnpm --filter @workspace/api-server typecheck` ✅
- `pnpm test` → **2582 passed** (was 2544; +38 P2 tests). The **7 failing test files error only on missing
  `DATABASE_URL`** (this sandbox provisions no DB) — all pre-existing, none in changed areas.
- P2 suite (6 files, 38 tests, all pass): **Gateway** (success, breaker-skip, provider fallback, degrade-on-all-fail,
  contract-invalid degrade, PHI-flag propagation) · **Registry** (local-first order, capability filter, PHI exclusion) ·
  **Contract** (validate, repair from fenced/dirty JSON, projection modes) · **Evaluation** (recall, validation rate,
  promotion gate incl. human-only-to-live) · **Failure** (timeout, all-providers-fail) · **Gauntlet** (grounding,
  laterality, negation, contradiction, quarantine, deterministic override).
- `grounding-check.cjs` ✅ (59 claims) · `check-migration-order.cjs` ✅.

**Could NOT be validated in this environment (no `DATABASE_URL`, no Orthanc, no configured providers):**
end-to-end pipeline execution against a real study; live provider calls / real model output; DB-backed
`selectProviderChain` / `runEvaluation` / `approveVersion`; circuit-state reads over real `ai_provider_health_logs`.
The pure orchestration + logic is fully unit-tested with injected fakes; the DB/provider seams are typed and
injectable. See the Staging Validation Guide (§8).

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gateway injected into the registered handler could run on a real study. | Low | Low (shadow) | Only runs when a shadow job is enqueued; nothing auto-enqueues (no scheduler until P3). Output is shadow-only. |
| Capability Registry empty in production → no eligible provider. | Medium | Low | Gateway degrades to an empty conforming draft (never throws); rows are seeded per §8. |
| PHI leak to a cloud provider. | Low | High | `buildProviderChain` excludes non-PHI-eligible cloud models when images are present; reuses the P0 egress allowlist. Verify seeding in staging. |
| Prompt/knowledge-pack versions are placeholders (`*-p2`). | Expected | Low | Manifest schema is complete + immutable; real prompt-registry wiring is a later phase. Documented. |
| Contradiction/laterality/negation heuristics are text-based (imperfect). | Medium | Low (shadow) | Failures quarantine (never surface); refined against golden cases before any radiologist exposure (P3+). |
| Deterministic-finding injection into the gauntlet is not yet populated. | Expected | Low | The override MECHANISM is implemented + tested; clinical injection from measurement critical-ranges is a later refinement. |

---

## 7. Rollback plan

**Code:** revert the P2 commit. The only behavioral change to a live path is the registered handler using
the gateway provider instead of the stub; reverting restores the P1 stub. P0/P1 are untouched otherwise.

**Database (manual — NOT auto-applied):**

```sql
DROP TABLE IF EXISTS ai_evaluation_case_results;
DROP TABLE IF EXISTS ai_evaluation_runs;
DROP TABLE IF EXISTS ai_golden_cases;
DROP TABLE IF EXISTS ai_model_versions;
DROP TABLE IF EXISTS ai_model_capabilities;
```

All hold registry/eval data only; dropping them is lossless to the clinical system.

---

## 8. Staging validation guide

Run these in a staging environment (real `DATABASE_URL`, Orthanc reachable, providers configured). AI stays
shadow throughout — nothing reaches a radiologist.

1. **Apply migrations** — deploy; confirm the 5 P2 tables exist (`\dt ai_model_*`, `ai_golden_cases`, `ai_evaluation_*`).
2. **Seed the Capability Registry** — insert at least the local model, e.g.:
   ```sql
   INSERT INTO ai_model_capabilities (provider, model, model_digest, supports_vision, supports_grounded_json, phi_eligible, is_local, is_enabled)
   VALUES ('ollama', 'medgemma', '<digest from /api/show>', true, true, true, true, true)
   ON CONFLICT (provider, model) DO NOTHING;
   ```
   For any cloud fallback, set `phi_eligible` deliberately and confirm `AI_EGRESS_ALLOWLIST` (P0) lists its host.
3. **Enqueue one shadow job** — for a study already in Orthanc:
   `enqueueAiShadowJob({ studyInstanceUid, radiologyStudyId })`, then drive the existing tick
   (`POST /api/radiology-ops/.../tick` or the cron). Confirm a row in `study_snapshots`, `ai_processing_manifests`
   (with `model_version` = `model@digest`), and `ai_shadow_drafts` (`source` = `ai_shadow` or `ai_shadow_degraded`).
4. **Verify local-first + PHI** — with images present, confirm the manifest's model is the local model; temporarily
   disable the local model and confirm it does NOT fall through to a non-PHI-eligible cloud model.
5. **Verify resilience** — point the local endpoint at an unreachable URL; confirm the job completes **degraded**
   (`degraded=true`, empty findings) and never blocks; confirm `ai_provider_health_logs` records failures and the
   breaker opens after the threshold.
6. **Verify the gauntlet** — seed a golden case whose reference draft contains a laterality/negation conflict and an
   ungrounded anchor; confirm they land in the draft's `quarantined` array, not `findings`.
7. **Run an evaluation** — seed `ai_golden_cases` + an `ai_model_versions` row (state `shadow`); call `runEvaluation`;
   confirm `ai_evaluation_runs.metrics_json` (critical recall, validation rate) and that a passing run moves the
   version to `candidate`. Confirm `approveVersion` moves `candidate → live` and REFUSES a non-candidate.
8. **Confirm no radiologist surface changed** — the reporting workspace, worklist, and reports are byte-identical;
   AI output exists only in the shadow tables.

---

## What was explicitly NOT done (deferred)

No scheduler, night batch, quiet hours, radiologist UI, AI buttons, AI report display, DICOM SR,
multi-hospital, knowledge graph, digital twin, organ companions, or auto-learning. P2 stops here.
