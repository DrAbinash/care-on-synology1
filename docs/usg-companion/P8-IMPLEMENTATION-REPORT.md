# USG Companion — Phase P8 (AI assistant)

**Branch:** `claude/usg-companion-p8-ai` (stacked on P7 `claude/usg-companion-p7-cine`).
**Flags:** `ff_radiology_usg_ai_assistant`, `ff_radiology_usg_ai_growth` — **default OFF**.

P8 adds an **advisory-only** AI assistant. Every non-negotiable AI safety rule is
encoded as pure, tested logic. AI here can propose draft suggestions and nothing
more — it cannot sign, finalize, write to `patient_reports`, bypass Form F, emit
fetal sex, or overwrite radiologist text. It **reuses the canonical AI enablement
policy** (`ai/aiPolicy`) rather than introducing a second AI gate, and feeds the
canonical draft lifecycle rather than a parallel AI report store.

## Gap map

- The canonical AI subsystem has enablement (`resolveAiEnablement`), drafts, and
  shadow inference, but there was **no USG-specific suggestion envelope** binding
  AI output to the draft-only, accept-only, PCPNDT-safe contract.
- Needed a **hard, override-free write guard** so no code path can route AI output
  into a signed/finalized store.

## Delivered (pure + unit-tested)

| Export | Guarantee |
|---|---|
| `assertAiWriteAllowed(target)` | Hard guard: **throws `AiWriteViolationError`** for any target other than `draft_suggestion` (patient_reports / finalize / sign all rejected). No override parameter exists. |
| `buildUsgAiSuggestion(...)` | Every suggestion is **accept-only** (`status:"suggested"`, `requiresHumanAcceptance:true`, `writeTarget:"draft_suggestion"`) and **blocks fetal sex / gender content** at construction (PCPNDT). Confidence clamped to [0,1]. |
| `gateUsgAiVisibility(enablement)` | AI is shown **only** when the canonical `resolveAiEnablement` result is `visibleToRadiologist`. |
| `acceptSuggestionIntoDraft(...)` | Applies a suggestion **only on explicit human acceptance**, **non-destructively** (append, never overwrite; idempotent; preserves existing radiologist text). Re-asserts the write guard. |

**Tests:** 10 new (`usgAiAssistant`) — all green, including negative tests proving the guard throws for every finalized/signed target and that sex/gender content is refused. Full-workspace `pnpm typecheck` 0 errors; flag-registry validation (`radiologyOpsHealth`) green with the two new entries.

## Non-negotiable constraints honored

- **AI never signs/finalizes/writes to `patient_reports`.** Enforced by an override-free throwing guard, tested against every such target.
- **AI never bypasses Form F / emits fetal sex.** Sex/gender content is refused at construction; the PCPNDT gate remains the canonical fail-closed check.
- **AI never overwrites text silently.** Acceptance is explicit and append-only.
- **No second AI gate / store.** Reuses `resolveAiEnablement`; output is a draft suggestion for the canonical lifecycle.
- **Flags default OFF, `wired:false`.**

## Remaining P8 integration (documented, needs a live model gateway)

1. Behind `ff_radiology_usg_ai_assistant`: connect the canonical inference
   provider (`ai/gatewayInferenceProvider`) to emit `UsgAiSuggestion`s, gated by
   `gateUsgAiVisibility` and rendered as accept/dismiss chips in the workspace.
2. Behind `ff_radiology_usg_ai_growth`: derive growth-note suggestions from the P4
   pregnancy timeline — advisory only, never auto-classifying IUGR/macrosomia.
3. Log every accept/dismiss through the canonical audit trail.
4. **Clinic validation needs a live model gateway** and was not exercised in CI
   (documented, not faked).

**Flags stay OFF** until validated.

## Classification

**CODE COMPLETE (safety core) — GATEWAY WIRING & CLINIC VALIDATION PENDING.**
