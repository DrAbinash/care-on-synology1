# Smart Dictation — Deployment Configuration Recommendations

**Status: APPROVED by the owner on 2026-10-23 — the timeout default is now
90 s in code.** Every recommendation below is either already shipped in
code or the code default now carries it; the remaining action is the clinic's
regular deploy (pull + rebuild on the Synology). No live instance was touched
remotely from the development environment.

Basis: the Smart Dictation confirmation run of 2026-10-22/23 (16 clinical
cases × 2 reps per model, production prompt, `think:false`,
`num_ctx:4096`, `temperature:0.1`, 45 s budget, against the real Ollama on
the AI PC), plus the follow-up GPU probes (cold start, keep_alive pin,
two-radiologist concurrency, cross-workload residency). Full evidence
tables live with the benchmark package; this document records the decisions
and the exact setting each one maps to.

---

## 1. Recommended production configuration

| Setting | Recommended value | Where it lives | Note |
|---|---|---|---|
| Primary composer model | `qwen3:14b` | Settings → Radiology → Voice → composer model (`clinic_settings.ollamaComposerModel`) | The only ladder model that preserved every dictated measurement, level and laterality in every required rep and invented nothing. 13 PASS / 3 FAIL, none of the fails a fabrication. |
| Fallback model | **leave unset (empty)** | `clinic_settings.ollamaComposerFallbackModel` = NULL/empty | qwen3:8b and qwen3:4b fabricate (8b omitted canal stenosis, dropped a 9.2 mm measurement, invented signal change; 4b fabricated a normal-brain sentence on an abnormal study) **and the production parser accepts their output silently**. A fallback that applies fabrications is worse than a visible failure — and after the preservation fix, failure is visible and retryable. |
| Thinking mode | `think:false` | Already hardcoded in the request body (`api-server/src/lib/voiceReportComposer/composer.ts:544`) | No action needed. Reasoning mode blew the budget in probes (108–120 s on 14b) and leaked chain-of-thought into output on gpt-oss. |
| Structured output | JSON schema request (not bare `format:"json"`) | Already the default request path (composer.ts `requestOnce`, schema-first with `format:"json"` for models that refuse it) | No action needed. The ladder showed schema costs nothing warm (35.7 s vs 38.7 s — the schema path is actually ~3.7 s faster because it trims ~70 output tokens) and cuts invalid-JSON risk. |
| Compose timeout | **90 seconds** | **Shipped as the code default** (`runtimeConfig.ts`, pinned by `runtimeConfig.default.sourceContract.test.ts`). Production runs on the default (no `clinic_settings.ollamaComposerTimeoutSeconds` override exists), so the next deploy activates 90 s with no Settings action. An explicit Settings value (clamp 10–120 s) still wins if ever set. | 45 s measured a 3.1 % timeout rate at cold start (LS-1 rep 1, first request, 45.0 s) and loses every contended request (second concurrent radiologist: 60.4 s; post-eviction reload: 55.7 s). 90 s covers the worst measured case with ~49 % margin. |
| `keep_alive` (model residency pin) | **30 minutes** | **Shipped in code** — the compose request body now sends `keep_alive:"30m"` (composer.ts `ollamaGenerateJson`), so no AI-PC action is needed. (`OLLAMA_KEEP_ALIVE=30m` on the Ollama service remains an equivalent alternative for other lanes.) | Optimization only. Removes the 4–19 s reload from the common case. The cross-workload probe proved the pin does NOT survive another model loading (medgemma loaded → 14b came back on the default lease → 19.4 s reload → 55.7 s total), so **the pin must ride WITH the 90 s timeout, never instead of it**. |
| `num_ctx` / `temperature` | 4096 / 0.1 | `clinic_settings.ollamaComposerNumCtx`, `ollamaComposerTemperature` (already the defaults) | Values the ladder was run at; do not "tune" upward without re-running the ladder. |
| Concurrency expectation | One in-flight compose request on this GPU | Operational awareness only (no setting) | Two simultaneous dictations serialise (A: 35.1 s, B: 60.4 s — ~37 s was queue). With 90 s, B now succeeds; plan capacity around one composer at a time. |
| Model pin / digest | Keep the pinned digest for reproducibility | Model management on the AI PC | The 14b pin verified byte-identical (16/16) across the benchmark. Re-pin and re-run the harness if the weights are ever re-pulled. |

## 2. Why no automatic fallback

The clinically safe failure mode is the one this configuration produces: a
**visible, retryable failure with the radiologist's words preserved**. The
failed-dictation preservation fix guarantees exactly that — the words stay
in the conversation thread and one Retry re-sends them. A silent fallback to
8b/4b converts a visible failure into an invisible fabrication applied to
the report; the ladder evidence (8b: 32/32 plans accepted by the parser
including the ones with invented findings) shows production would not catch
it. Accuracy first; a fast wrong model fails.

## 3. Verification after applying (deploy-gate checklist)

Run these against the configured instance before declaring the clinic live:

1. `/api/radiology/voice-report-composer/models` lists `qwen3:14b` as the
   selected composer model, fallback unset.
2. Compose a synthetic (non-PHI) transcript and confirm the request path
   uses the schema (diagnostics `schemaOk: true`, `think:false`).
3. Stop the Ollama service mid-attempt: the panel must show the error turn
   with the dictated words **in the conversation**, plus a Retry button that
   re-sends the same words.
4. Kill the request at 80 s: the turn must still complete inside the 90 s
   budget (no premature 45 s abort).
5. After 30 idle minutes plus one compose: latency should show no reload
   step (pin held). After loading a different model, expect one slow
   compose (reload) — this is the documented pin limitation, covered by
   the 90 s budget.

## 4. Out of scope for this change

- No change to the AI PC's live Ollama service or model set.
- No change to any `clinic_settings` row.
- The `keep_alive` code option (b) originally named here has since shipped as
  its own small change with its own tests (`keep_alive:"30m"` in
  `composer.ts` `ollamaGenerateJson`, pinned by `composer.provider.test.ts`).
