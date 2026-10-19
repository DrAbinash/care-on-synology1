# AI Composer — the real gaps

**Scope.** Every gap found while reconstructing the current state, each with the seven attributes the
owner asked for: clinical importance, what exists today, the exact missing integration, source files,
the smallest safe correction, the tests that would prove it, and what it depends on.

Read at `origin/main 80a09df4`. Companion to `AI_COMPOSER_CURRENT_STATE.md` (what exists) and
`AI_COMPOSER_WORKFLOW.md` (how it flows). Corrections are ordered by clinical weight, and each one is
deliberately the *smallest* thing that closes the gap — this is a list of things to evaluate, not a
licence to rewrite working systems.

**One rule observed throughout:** none of these corrections may weaken an existing control. Where a
gap is "this door can never open", the correction is to cut the key or to say plainly that there is no
key — never to remove the door.

## Severity key

| | Meaning |
| --- | --- |
| **S1** | Can put a wrong or unattributed statement in front of a radiologist, or on paper |
| **S2** | Removes visibility or accountability from something that already happens |
| **S3** | Wasted capability, or a divergence between documentation and execution |

## Index

| ID | Gap | Sev | Smallest correction |
| --- | --- | --- | --- |
| G-1 | AI attribution is lost on reload | S1 | persist `fieldProvenance` in `structured_json` |
| G-2 | No unresolved-placeholder rule in the Composer validator | S1 | add one rule, reusing the #1057 vocabulary |
| G-3 | Copilot Insert writes AI text with no tracked change | S1 | record the insert as a tracked change |
| G-4 | `verify` and `amend` never call the unreviewed-AI gate | S1 | prove the ordering, or add the call |
| G-5 | The three-way clinical distinction is a prompt wish | S1 | one validator rule |
| G-6 | Capability routing is dead; `resolveModelPin` ignores its model argument | S2 | fix the pin query, then decide the table's fate |
| G-7 | Audit evidence columns are written and shown to nobody | S2 | four fields in the existing page |
| G-8 | Interactive audit-write failures are swallowed | S2 | apply `strictAudit` to the interactive writers |
| G-9 | No server observations table | S2 | a read-only server view, not a new store |
| G-10 | Cloud composer vision can never open | S3 | wire a proof producer, or say there is none |
| G-11 | De-identification and burned-in OCR are built and never called | S3 | one call site, or retire them |
| G-12 | `DICOM_REDACTION_PERFORMED = false` must stay honest | S2 | documentation only |
| G-13 | No measured basis for any model choice | S2 | persist A/B runs into `ai_evaluation_runs` |
| G-14 | `ai_job_queue` and `admitJob` are a second, non-running orchestration | S3 | mark it, or retire it |
| G-15 | No byte limit at key-image attach time | S3 | one check in the existing handler |
| G-16 | `vision-trial` silently truncates the image set | S3 | refuse instead of slice |
| G-17 | All three interactive cloud arms mislabel every image as JPEG | S3 | carry the MIME, or sniff it once for all three |
| G-18 | No `num_ctx` escalation after `CONTEXT_BUDGET_EXCEEDED` | S3 | one bounded retry |
| G-19 | Truncation is diagnosed and never persisted | S3 | two columns |
| G-20 | Comparison workspace has zero tests | S3 | request-level tests |
| G-21 | Apply is a whole-field replace | S3 | document it; do not redesign |
| G-22 | Two auto-compose switches, one of which does nothing | S3 | delete the dead setting or wire it |
| G-23 | Personal templates and macros are per-browser | S3 | out of scope unless the owner asks |
| G-24 | 73 request-level tests skip silently without `DATABASE_URL` | S2 | make CI say how many ran |

---

## S1 — can reach the radiologist or the paper

### G-1 — AI attribution is lost on reload

**Clinical importance.** A radiologist reopening a draft cannot tell which sentences the AI wrote. The
provisional/authoritative distinction the whole Composer design rests on survives only until the first
reload. Worse, hydration's fallback can only emit ledger-derived sources or `"template"`, so AI prose
comes back labelled as *template* — a stronger claim than the truth.

**What exists.** Apply marks every sentence provenance `ai-draft` (`store.ts:4620-4633`). The save
payload writes `observationLedger` (`useDraftPersistence.ts:495`) and the restore path reads back
structured format state, ledger, viewer measurements, canal AP, spine state, vascular technique, region
transitions, quick-select ids and linked studies (`:290-345`).

**Exact missing integration.** `fieldProvenance` is in neither the save payload nor the restore list.
The only occurrence in the file is `fieldProvenance: {}` at `:259`, which is the different-patient
*refusal* branch.

**Source files.** `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts:259,290-345,495`;
`artifacts/diagnostic-erp/src/lib/observationLedger.ts` (the `extractCare*` reader family);
`store.ts:3681,4620-4633`; `lib/db/src/schema/radiologyReportGenerator.ts:42` (`structuredJson`).

**Smallest safe correction.** Add a `careFieldProvenance` key to the existing `structured_json` payload
and an `extractCareFieldProvenance` reader beside the other seven, following the pattern already used
for `extractCareObservationLedger`, `extractCareCanalApProvenance` and `extractCareRegionTransitions`.
**No migration** — the column is `jsonb`. Nothing else changes; the write is additive, so an old draft
restores exactly as it does today.

**Required tests.** Extend `radiologyWorkspaceDraftRoundTrip.request.test.ts` with an R8: apply an AI
change, save, reload, assert every `ai-draft` sentence still reads `ai-draft` and none reads
`template`. Mutation-prove it: delete the new reader and the test must go red.

**Depends on.** Nothing. This is the cheapest S1 in the list.

### G-2 — No unresolved-placeholder rule in the Composer validator

**Clinical importance.** A draft containing `___ mm` or `{token}` is a draft that asks a radiologist to
finish the AI's sentence. If it is accepted and signed, a placeholder reaches paper.

**What exists.** `validateComposerOutput` (`validateOutput.ts:1889`) refuses missing measurements
(`:177`), laterality swaps (`:227`), level changes (`:281`), severity escalations (`:302`), canal
divergences (`:551`), conservation losses (`:880`), relation losses (`:1309`) and dropped observations
(`:1616`), and a failure fails the job with no partial write (`jobService.ts:566-581`). The same
defect class **was closed on the Quick Select path** by PR #1057, including a finalize-side guard.

**Exact missing integration.**

```
$ grep -n "___\|placeholder\|{token}\|unresolved" artifacts/api-server/src/lib/reportComposer/validateOutput.ts
1743:        if (!dictationMeasurements.has(token)) problems.push(`measurement ${token}`);
```

One hit, about measurement tokens in dictation. No placeholder rule.

**Source files.** `artifacts/api-server/src/lib/reportComposer/validateOutput.ts`; the `AiFailureCode`
union it reports into; the #1057 placeholder vocabulary already in the tree (finalize guard + store
backstop).

**Smallest safe correction.** One rule inside `validateComposerOutput` that reuses the #1057 detector
rather than writing a second one, plus a matching `AiFailureCode`. Do not invent a new placeholder
vocabulary — the point of reusing #1057 is that one spelling of "unresolved" is enforced everywhere.

**Required tests.** A composer job whose model output contains `___ mm` fails with the new code and
writes nothing; a `{token}` output likewise; a clean output still passes (positive control). Mutation:
remove the rule, the two negatives must go red.

**Depends on.** Nothing, but it should land with G-5 so the validator is touched once.

### G-3 — Copilot Insert writes AI text with no tracked change

**Clinical importance.** The unreviewed-AI finalize gate is what stops an AI sentence reaching a signed
report without a human looking at it. Copilot Insert bypasses it: the text lands in the editor with no
`TrackedChange`, so `checkUnreviewedAiFinalize` has nothing to see.

**What exists.** Copilot rail items Insert (append via `insertCopilotText`) or dismiss
(`acknowledgeCopilotItem`) — `components/radiology/zai-workspace/copilot-rail.tsx:70`. The gate itself
is sound: `unreviewedAiGuard.ts:146`, three production call sites (`patient-reports.ts:2122,2518`,
`internal-radiology.ts:1248`), failing closed on a DB error
(`unreviewedAiGuard.failClosed.test.ts`).

**Exact missing integration.** `insertCopilotText` does not write a review-state record. Every other
AI-to-text door does: Composer changes carry `reviewState` PENDING/ACCEPTED/REJECTED
(`lib/reportComposer/api.ts:78-90`), and `AiDraftPanel` stages per-finding through `onStageProposal`
("Accept stages for Composer Apply — AI never writes the report alone",
`AiDraftPanel.tsx:88-99,155-157`).

**Source files.** `copilot-rail.tsx:38-72`; `store.ts` (`insertCopilotText`);
`lib/reportComposer/unreviewedAiGuard.ts:42-198`; the `aiReview` state the guard reads.

**Smallest safe correction.** Have `insertCopilotText` record the inserted span in the same
unreviewed-AI state the guard already reads, so the gate covers it without a new subsystem. Do **not**
add a second guard or a second review vocabulary — the owner's standing constraint against a competing
audit subsystem applies here.

**Required tests.** Insert copilot text → finalize is refused by the server gate; review it → finalize
succeeds. Mutation: drop the record and the refusal test must go red.

**Depends on.** Nothing. Needs care not to double-count text that also arrives as a Composer change.

### G-4 — `verify` and `amend` never call the unreviewed-AI gate

**Clinical importance.** If either can be the *first* human attestation on a report carrying unreviewed
AI text, the "AI is never the signer, and unreviewed AI cannot be finalized" invariant has a hole.

**What exists.** Three call sites, all verified:

```
$ grep -rn "checkUnreviewedAiFinalize" artifacts --include=*.ts | grep -v '\.test\.'
routes/internal-radiology.ts:51 (import)  :1248 (call)
routes/patient-reports.ts:50    (import)  :2122 (POST /)   :2518 (POST /:id/sign)
```

`/:id/verify` (`patient-reports.ts:2639`) and `/:id/amend` (`:1585`) are not among them. `/:id/sign`
refuses a structured-signed report and points at `/verify` for countersign (`:2465-2478`).

**Exact missing integration.** A proof, or a call. The code reading is reassuring — `/sign` refusing
and redirecting to `/verify` implies verify is always a *second* signature, so the first already passed
the gate at `:2518`. But no test asserts that ordering, and `/:id/amend` has its own entry conditions
(reason, `ff_radiology_structured_final`, structured sign authority, a parent whose `structuredJson`
carries `audit.signature.state === "final"`, linear chain — `:1594-1627`) which do imply a signed
parent, again unproven.

**Source files.** `routes/patient-reports.ts:1585-1650,2436-2634,2639`;
`lib/reportComposer/unreviewedAiGuard.ts:146`; `lib/peerReview.ts` (not yet read end to end — a
countersign path may live there).

**Smallest safe correction.** First, a request-level test that proves the ordering: a report with
unreviewed AI text cannot reach `verify` or `amend` without having passed `sign`. **If that test
passes, no code changes** — the gap is documentation, and this entry becomes a recorded proof rather
than a repair. If it fails, add the guard call at the top of the offending handler.

**Required tests.** (a) Create a report with unreviewed AI text → `sign` refuses. (b) Attempt `verify`
on the same report → refuses, or is unreachable because the report is not signed. (c) `amend` on a
parent that never passed the gate → refuses. (d) Positive control: a fully reviewed report verifies.

**Depends on.** Nothing. This is the gap where the correct answer may be "already safe — here is the
proof", and it should be resolved that way rather than by adding a redundant call.

### G-5 — The three-way clinical distinction is a prompt wish, not a rule

**Clinical importance.** "Abnormality demonstrated" / "no abnormality identified in adequately
visualized anatomy" / "anatomy or sequences not sufficiently evaluated" are three different clinical
claims. A model that collapses them into "normal" has made a stronger statement than the images
support, and on a screenshot-selected subset that is the most likely failure mode there is.

**What exists.** The prompt asks for it: *"Do NOT claim complete MRI review. Absence on these frames is
not proof of normality"* (`composeEngine.ts:274-276`). `pruneUngroundedObservationRows`
(`validateOutput.ts:1705`) removes rows with no support. The `screening_limitation` concept already
exists in the catalogue (PR #937's ownership work), and the supersession rule already forbids printing
a whole-study normal over a recorded abnormality (`normalClaimSupersededBy` /
`sentenceOwnedBySlot`, PR #1071).

**Exact missing integration.** No validator rule refuses a *normal statement about anatomy the selected
images do not demonstrate*. The parts exist; nothing assembles them into a refusal.

**Source files.** `validateOutput.ts:1889` (add the rule); `composeEngine.ts:571,596-623,706` (the
selected-image set and its provenance, which is the evidence the rule needs); the existing
`screening_limitation` concept; `snapshot.ts:33-159`.

**Smallest safe correction.** One rule in `validateComposerOutput`: when the compose mode is
SELECTED_IMAGES and the output asserts a normal for a region not represented in the selected images'
provenance, fail the job with a named code and no partial write — reusing the existing
`screening_limitation` vocabulary rather than a new concept, exactly as the Stage-1 plan requires.

**Required tests.** A golden-ish battery of schematics: a normal for an unimaged region is refused; a
normal for an imaged region passes; a limitation statement passes; the rule does not fire on a
TEXT_ONLY job. Plus a mutation: disable the rule, the negatives must go red.

**Depends on.** The selected-image provenance must be trustworthy — which it is:
`resolveSelectedKeyImages.ts:141-231` carries `sourceType` and re-verifies ownership
(`keyImageOwnership.ts:66-190`). Should land with G-2 so the validator is touched once.

---

## S2 — visibility and accountability

### G-6 — Capability routing is dead, and the pin query is wrong

**Clinical importance.** Indirect but real: the platform cannot answer "which model was *supposed* to
run, and was it the one that did?" from data, because the table that would answer it is empty. Every
model-choice claim in the documentation is therefore an observation, not a record.

**What exists.** `ai_model_capabilities` is CREATEd (`migrations/add_ai_gateway_and_evaluation.sql:14`)
and indexed on `(provider, model)` (`:31`). `loadCapabilities` (`capabilityRegistry.ts:18-31`),
`resolveModelPin` (`:34-41`) and `selectProviderChain` (`:44-55`) read it. `buildProviderChain`
(`capabilityLogic.ts:28-49`) implements local-first ordering, capability filtering and the PHI-egress
filter — and is exercised only by `capabilityLogic.test.ts:11-33`.

**Exact missing integration.** No writer, no seed:

```
$ grep -rn "aiModelCapabilities" artifacts lib scripts --include=*.ts --include=*.sql   → 8 SELECT-side hits only
$ grep -rniE "insert.{0,60}ai_model_capabilities" artifacts lib scripts migrations       → (no output)
```

So `loadCapabilities()` returns `[]`, `selectProviderChain()` returns `[]`, and `requestStructuredReport`
would degrade with "no eligible provider (capability/PHI policy) — deterministic-only"
(`gateway.ts:91-92`) — except that its one production caller injects a chain
(`gatewayInferenceProvider.ts:322-330`), which is why that message has never been seen.

**A latent defect inside the dead code.** `resolveModelPin(provider, model)` filters on **provider
only** and takes `.limit(1)` (`capabilityRegistry.ts:34-41`) — the `model` argument never reaches the
query. Were the table populated, this returns an arbitrary row's digest for that provider.

**Source files.** `lib/ai-providers/src/capabilityRegistry.ts:18-55`; `capabilityLogic.ts:28-49`;
`gateway.ts:61-72,80-159`; `lib/ai/gatewayInferenceProvider.ts:308-332`;
`lib/db/src/schema/aiModelCapabilities.ts:12-37`; `routes/aiModelRoutes.ts:40-135` (the writer pattern
that *does* work, for `ai_model_routes`).

**Smallest safe correction, in two steps that must not be merged.**
1. **Fix `resolveModelPin` to filter on provider AND model.** One line. It is wrong today and must not
   become load-bearing while wrong.
2. **Then decide the table's fate.** Either give it a writer following the `aiModelRoutes.ts` pattern
   (upsert + delete behind `canConfigure`, mounted under an existing admin route, surfaced in the
   existing `AiModelRouting.tsx` page), or delete the table and the two dead functions. **Do not do
   both.** The owner's standing constraint against a second settings subsystem applies:
   `ai_model_routes` already has a writer and a UI.

   **Deleting does not "unify" capability authority, and no attempt should be made to.** There are
   already three *live* authorities, partitioned by provider arm inside `composeEngine.ts` — the
   probe-first three-state `assertVisionCapableModel` for Ollama (`:637-641`, refusing at `:652-664`),
   the hard-coded `assertModelSupportsCapability` → `BUILTIN_MODEL_CAPABILITIES` for cloud
   (`:665-667`), and per-endpoint `Settings.supportsVision` for `local_openai_compatible`
   (comment at `:681`). Each fails closed for its own arm, and a cloud arm cannot probe `/api/show`
   while the Ollama arm must not be reduced to a hard-coded list. The dead DB table is a *fourth*,
   unused authority; removing it is the correction. Collapsing the three live ones into one is a
   redesign, and is not proposed here.

**Required tests.** For step 1: `resolveModelPin("ollama","gemma3:12b")` returns that model's digest,
not another row's for the same provider. For step 2 (if wired): a request-level test that a capability
row changes the resolved chain, and that removing it degrades with the named message. For step 2 (if
deleted): the existing arm tests must still pass unchanged — `visionCapability.test.ts`,
`localOpenAiCompatible.provider.test.ts:467-468` and `cloudImagePolicy.stage1.test.ts:140,251` already
pin the fail-closed behaviour of all three live authorities.

**Depends on.** Step 2 depends on an owner decision. Step 1 depends on nothing.
**Interaction with PR #1080 — merged (`c4462041`), and it changes step 2's framing.** #1080 added
metadata-derived three-state capability detection on the interactive/overnight path, and its new
`lib/ai/localModelCapabilities.ts` **reuses `classifyOllamaModelCapability`** — the same classifier the
Composer's selected-image gate (`visionCapability.ts:45`) and the OCR resolver
(`ocrProviderResolver.ts:63`) already consult. Its own header forbids a second capability rule per
surface: "Do not 'improve' on it here; if a state is wrong, the classifier is wrong, and both surfaces
change." That is decisive evidence for the *delete* option over the *wire* option: a DB table would be
exactly the second rule the header rules out. #1080 does **not** add a writer to the dead table and
does **not** fix `resolveModelPin` (`capabilityRegistry.ts:34-41`), so step 1 stands unchanged.
Re-verified at `c4462041`: `git grep -l -e aiModelCapabilities -e ai_model_capabilities c4462041 --
'*.test.ts'` still returns nothing (exit 1), while the same grep form for `aiModelRoutes` returns 13
files.

### G-7 — Audit evidence columns are written and shown to nobody

**Clinical importance.** After an incident, "was this send local or cloud, which job, which images,
correlated to what" is the first question. The answers are in the database and not in the UI.

**What exists.** `ai_reporting_audit_logs` carries `endpointLocality`, `jobReference`, `correlationId`
and `imageSourceTypes` (written at `routes/aiReporting.ts:984-989`; schema
`lib/db/src/schema/aiReporting.ts:30-91`), and `recordImageSendAudit` derives locality from the send
layer's own answer, preferring executedLocality > resolvedUrl > "unknown"
(`imageSendAudit.ts:112-120,186`). The page exists: `AiAuditLog.tsx`, routed `/radiology/ai-audit-log`
(`App.tsx:581`), linked from `RadiologyAdvancedTools.tsx:189`, behind `canConfigure`
(`aiReporting.ts:2129`).

**Exact missing integration.**

```
$ grep -n "endpointLocality\|jobReference\|correlationId\|imageSourceTypes" artifacts/diagnostic-erp/src/pages/AiAuditLog.tsx
(no output)
```

The row interface (`AiAuditLog.tsx:18-36`) does not declare them.

**Source files.** `pages/AiAuditLog.tsx:18-120`; `routes/aiReporting.ts:2127-2144` (the read endpoint);
`lib/db/src/schema/aiReporting.ts:62-67` (the NULL-means-predates-the-column comment).

**Smallest safe correction.** Add the four fields to the page's row interface and render them, with the
schema's own caveat honoured: a NULL `endpointLocality` must display as "not recorded (pre-dates this
column)", never as "local". No route change, no schema change.

**Required tests.** A contract test that the page's row type includes all four fields; a request-level
test that the read endpoint returns them. `aiReporting.imageEgress.request.test.ts:199-231` already
asserts they land in real rows — extend it to assert the read endpoint returns them.

**Depends on.** Nothing.

### G-8 — Interactive audit-write failures are swallowed

**Clinical importance.** In Clinical mode an unfiled audit row is supposed to stop the send. On the
interactive routes it does not.

**What exists.** `recordImageSendAudit` never throws but returns `{filed}`
(`imageSendAudit.ts:153-204`); in Clinical mode (`strictAudit`) an unfiled CLOUD send fails the
Composer job (`jobService.ts:603-614`) and withholds the cloud shadow answer
(`gatewayInferenceProvider.ts:228`). The mode resolver is `aiSecurityPolicy.ts:31,68-69`
(development ⇒ `requireAttestation:false, strictAudit:false`; clinical ⇒ both true).

**Exact missing integration.** The interactive writers append `.catch(() => {})` unconditionally —
`aiReporting.ts:992` (`/query`), `:1703` (`/draft`), `:1839` (`/polish`); also `aiComparison.ts:215`.
`strictAudit` reaches cloud image sends only.

**Source files.** `routes/aiReporting.ts:967-992,1671-1703,1827-1839,1948-1965,2102`;
`routes/aiComparison.ts:196-215`; `lib/ai/aiSecurityPolicy.ts:31-227`;
`lib/ai/imageSendAudit.ts:153-204`.

**Smallest safe correction.** Where the send was cloud **and** the resolved mode is `clinical`, an
unfiled row should fail the request the way `jobService.ts:603-614` already fails the job. Local sends
keep the non-critical `.catch`, because a local audit miss is not a PHI event. This reuses the resolver
already threaded by #1078 (`aiReporting.ts:929`, `aiComparison.ts:181`) — no new policy framework.

**Required tests.** In clinical mode, a forced audit-insert failure on a cloud `/query` returns an
error and the response is withheld; the same failure on a local `/query` still returns the answer with
a logged warning. Mutation: remove the branch, the cloud test must go red.

**Depends on.** #1076/#1078 (merged). Must not change behaviour in development mode.

### G-9 — No server observations table

**Clinical importance.** The ledger is the only record of what a report asserts. It lives in the
browser and persists as opaque JSON inside `structured_json`, so no server rule can validate it, no
route can query it, and a crafted `save-draft` can persist a self-contradictory Findings/Impression
pair.

**What exists.** `appliedPathologyPatches` + `CanonicalObservation` in `store.ts`; identity
`region|concept|level|laterality` (`types.ts:11-15`); persistence at
`useDraftPersistence.ts:495`; four client-side consistency mechanisms (`deriveImpressionDependency`
`store.ts:602-630`, `mergeImpressionGuard.ts:25-36`, `withdrawSupersededNormals.ts:1-30`,
`normalBootstrap.ts`); a strong round-trip test (R2, `radiologyWorkspaceDraftRoundTrip.request.test.ts:250-336`).

**Exact missing integration.**

```
$ grep -rn "pgTable(" lib/db/src/schema/*.ts | grep -i observation
(no output)
```

The server sees observations only frozen inside a compose job's `input_snapshot_json`
(`aiReportComposer.ts:73`).

**Source files.** `lib/db/src/schema/radiologyReportGenerator.ts:42`;
`artifacts/api-server/src/lib/structuredJsonColumn.ts`; `routes/radiology-report-generator.ts:1717`
(save-draft), `:2115` (validate-draft).

**Smallest safe correction — and the constraint is hard here.** The owner has ruled against a second
observation ledger and against a competing store. So: **do not create a table.** The smallest safe step
is to make the *existing* `POST /validate-draft` (`:2115`) parse the `observationLedger` key out of
`structured_json` server-side and run the same contradiction checks the client runs, refusing the save
on a violation. That gives server-side enforcement with no new store, no migration and no second
vocabulary.

**Required tests.** A request-level test: a `save-draft` whose `structured_json` contains a normal
Impression over an abnormal Findings observation is refused; a consistent one is accepted. Mutation:
remove the server check, the negative must go red.

**Depends on.** The client rules must be extractable into a shared module — check whether
`mergeImpressionGuard.ts` and `withdrawSupersededNormals.ts` are already importable from a server
context before assuming this is small. If they are not, the honest answer is that this gap is larger
than one PR and should be scoped separately.

### G-12 — `DICOM_REDACTION_PERFORMED = false` must stay honest

**Clinical importance.** Every audit row files `anonymized: DICOM_REDACTION_PERFORMED`
(`aiComparison.ts:204,312`; `imageSendAudit.ts:177-181`). If a document, a UI label or a report ever
implies images are de-identified, that is a false statement about patient data.

**What exists.** `lib/ai/dicomRedaction.ts:17` — one constant, `false`. Its own docblock says "No code
path scrubs a prompt or masks a pixel today" (`:10-11`). `dicomRedaction.test.ts` asserts the constant
**is false** and statically scans every route writing `aiReportingAuditLogsTable` for a hard-coded
`anonymized: true`. `migrations/zzz_ai_audit_anonymized_default.sql:8-11` records that live DBs
previously defaulted `anonymized` to true — the default was corrected.

**Exact missing integration.** Nothing in code. The risk is documentary: `15-security-model.md` and the
Stage-1 architecture both discuss de-identification, and a reader could take the *existence* of
`imageDeidentification.ts` (342 lines, 23 tests) as evidence it runs. It does not (G-11).

**Source files.** `lib/ai/dicomRedaction.ts:1-17`; `lib/ai/imageDeidentification.ts:187-342`;
`15-security-model.md`; `STAGE1-AI-SCREENSHOT-REPORTING-ARCHITECTURE.md` §F.

**Smallest safe correction.** Documentation only, and the owner's constraint is explicit — *"DO NOT
simply delete the proof requirement"* and *"if the mechanism does not exist, DO NOT fabricate a proof
or bypass the gate"*. So: state in `15-security-model.md` that de-identification is **not wired**,
name the two modules that exist and are uncalled, and keep the constant `false`. `AiEgressInspector.tsx:232-235`
already warns that burned-in corner text cannot be stripped — that is the right posture and should be
pointed to as the model.

**Required tests.** `dicomRedaction.test.ts` already does the work. Add one assertion that no
documentation file under `docs/architecture/radiology-ai/` claims redaction is performed while the
constant is false — the repo already has grounding-check machinery (G1) for exactly this shape of
claim.

**Depends on.** Nothing. **Must not** be closed by flipping the constant.

### G-13 — No measured basis for any model choice

**Clinical importance.** Stage 1's acceptance is a model choice. Nothing on this platform can support
one, so any "use model X" recommendation — including in these documents — is an observation.

**What exists.** `runEvaluation` (`lib/ai/evaluationRunner.ts:36`) reads `ai_golden_cases`
(`:42`) and writes `ai_evaluation_runs` / `ai_evaluation_case_results` / `ai_model_versions` (`:11`).
The A/B harness `reportComposer/localVisionModelsAb.live.test.ts` exists, opt-in via
`RUN_LIVE_OLLAMA=1`. `IMPLEMENTATION_TRACKER.md` already marks G8 "⚠️ Built, not wired".

**Exact missing integration.**

```
$ grep -rn "runEvaluation" artifacts lib scripts --include=*.ts --include=*.mjs | grep -v '\.test\.'
artifacts/api-server/src/lib/ai/evaluationRunner.ts:36   (its own definition)
$ grep -rn "aiGoldenCases" … → only evaluationRunner.ts:11,42 and the schema
```

No caller; no golden rows; the harness prints `safeError`/`detail` but not `usage`, and its results are
not persisted.

**Source files.** `lib/ai/evaluationRunner.ts`; `lib/db/src/schema/aiEvaluation.ts:35`;
`reportComposer/localVisionModelsAb.live.test.ts`; `reportComposer/providers/ollamaComposerAdapter.ts`.

**Smallest safe correction.** Give `runEvaluation` one caller — an admin-triggered route beside the
existing `/api/radiology-ollama/pipeline-self-test` family (`radiologyOllama.ts:1020,1043,1067`) — and
have the A/B harness persist each run into `ai_evaluation_runs`, which **already exists**. Prefer
extending that table over a new run ledger. Also recover the two adapter diagnostics the Stage-1 plan
identified: the empty-text return (`ollamaComposerAdapter.ts:136-146`) is evaluated *before* the
`done_reason === "length"` branch (`:154-167`) and does not carry `done_reason`, so "spent the whole
budget reasoning" is reported as `empty_model_response`.

**Required tests.** A golden-case row + a stubbed model produces an `ai_evaluation_runs` row with the
expected verdicts; the adapter's empty return carries `done_reason` when the provider supplied one.

**Depends on.** Nothing structural. **Blocks** any defensible model-promotion decision, so it should
precede G-6 step 2.

### G-24 — 73 request-level tests skip silently without `DATABASE_URL`

**Clinical importance.** This is why a green CI run is not evidence that the AI paths work. The suites
that exercise real routes against a real database — including every identity, egress, ownership and
round-trip test cited in these documents — are wrapped in `describe.skipIf(!hasDatabaseUrl())` and
report green when skipped.

**What exists.** 73 `*.request.test.ts` files under `artifacts/api-server/src`. Named examples with
their skip lines: `pacsImagePicker.request.test.ts`, `imageSendAudit.request.test.ts:102`,
`aiReporting.imageEgress.request.test.ts:52`, `radiologyWorkspaceDraftRoundTrip.request.test.ts`,
`reportComposer.request.test.ts`, `signedContent.request.test.ts`, `composePersistence.request.test.ts`.

**Exact missing integration.** Nothing reports how many were skipped, so a CI log cannot distinguish
"44 egress tests passed" from "44 egress tests did not run".

**Source files.** `artifacts/api-server/src/testSupport/apiTestApp.ts` (the supertest boot);
`hasDatabaseUrl()`; the CI workflow.

**Smallest safe correction.** A CI step that prints the Vitest skipped-suite count and fails if a
named list of critical request suites skipped. Do **not** weaken the `skipIf` — local development
without Postgres is legitimate, and `AGENTS.md` documents the environmental skips as expected.

**Required tests.** The check itself: run it against a CI log with the suites skipped and confirm it
fails; against a log with them executed and confirm it passes.

**Depends on.** A CI change, which the owner must approve — this touches the pipeline, not the product.

---

## S3 — wasted capability, or docs that diverge from execution

### G-10 — Cloud composer vision can never open

**Clinical importance.** Low today (local-only is the Stage-1 policy) but it makes `gatewayPrivacy.ts`'s
most careful code unreadable: a reader sees a proof-checking door and assumes a key exists.

**What exists.** `assertGatewayPrivacy` (`gatewayPrivacy.ts:137-311`) is called by all three
cloud/composer adapters (`compatibleComposerAdapters.ts:116`, `deepseekVisionTrial.ts:145`,
`localOpenAiCompatibleComposerAdapter.ts:112`). With images present it demands a `PixelEgressProof`
whose `posture === "clean"` and whose image count matches exactly (`:222-240`), and it sends *the
proof's bytes*, not the caller's (`:287-295`).

**Exact missing integration.** No producer:

```
$ grep -rn "pixelProof\|PixelEgressProof" artifacts lib --include=*.ts | grep -v '\.test\.'
gatewayPrivacy.ts:68 (field)  :105 (type)  :223 (read)  :287 (read)
```

So `proof === null` always, and the result is `{ ok:false, safeError:"cloud_image_not_verified" }`
with the detail *"No on-premises verification that these images are free of patient identifiers, so
nothing was sent. Configure the local vision model, or keep this task on a local provider."*

**Source files.** `lib/reportComposer/providers/gatewayPrivacy.ts:105-311`;
`lib/ai/imageDeidentification.ts:260,319`; `lib/ai/localBurnedInOcr.ts:87`.

**Smallest safe correction.** This is G-11's other half: the proof producer **is**
`deidentifyImagesForCloudEgress`, which already returns verified-clean bytes and already refuses when
its OCR cannot attest. Wiring it produces the proof the door demands. **But** the owner has ruled that
Composer cloud image transmission must not be enabled without a separate approved implementation — so
the correction here is either (a) leave it closed and add a one-line comment at `:105` naming the
unbuilt producer, or (b) a separately approved PR. **Do not wire it as a side effect of another
change.** `aiReporting.imageEgress.request.test.ts:1097-1133` already tests the forged-proof shape and
must keep passing.

**Required tests.** If wired: a proof whose count is short by one refuses; a proof whose bytes differ
from the sent bytes refuses; a clean proof sends the proof's bytes. All three shapes are already
asserted for the deny side.

**Depends on.** G-11 and an explicit owner approval.

### G-11 — De-identification and burned-in OCR are built and never called

**What exists.** `deidentifyImageForCloudEgress` (`imageDeidentification.ts:260`) and
`deidentifyImagesForCloudEgress` (`:319`) — metadata-strip sharp re-encode at JPEG q90, a 12 MB cap,
burned-in identifier matching against the patient's own identifiers via `localBurnedInOcr`
(`:187-342`). 23 tests covering EXIF-carrying-name dropped, output bytes ≠ input bytes,
surname/DOB-variant/MRN blocking, no-model ⇒ refusal, an empty transcript ≠ clean, raw DICOM refused,
one bad image blocks the set.

**Exact missing integration.**

```
$ grep -rln "deidentifyImage" artifacts lib scripts
artifacts/api-server/src/lib/ai/imageDeidentification.test.ts
artifacts/api-server/src/lib/ai/imageDeidentification.ts

$ grep -rn "createLocalBurnedInOcrRunner" artifacts lib --include=*.ts | grep -v '\.test\.'
artifacts/api-server/src/lib/ai/localBurnedInOcr.ts:87   (its own definition)
```

**Smallest safe correction.** Either produce the `PixelEgressProof` from it (G-10, owner approval
required) or mark both modules clearly as unwired so the next reader does not assume they run. A third
option — deleting them — is **not** recommended: the tests encode real clinical requirements and the
owner's constraint is not to delete proof requirements.

**Depends on.** G-10, G-12.

### G-14 — `ai_job_queue` and `admitJob` are a second, non-running orchestration

**What exists.** `aiJobQueueTable` is inserted at `routes/radiologyWorkflow.ts:261`, listed at
`:229-232`, and status-updated by hand at `:285,293-295`. `aiScheduler.admitJob`
(`lib/ai/aiScheduler.ts:120`) implements admission control. `07-orchestration-and-night-processing.md`
describes this as the platform's orchestration.

**Exact missing integration.** No worker claims `ai_job_queue` rows, and `admitJob` has no caller. The
queues that *do* run are both on `dicom_retry_queue` (see `AI_COMPOSER_WORKFLOW.md`, "Two AI queues
exist; one runs").

**Smallest safe correction.** Documentation: mark G10's orchestration as built-and-exposed-but-not-running
in `IMPLEMENTATION_TRACKER.md` the way G8 already is, and add a header note to
`07-orchestration-and-night-processing.md`. Retiring the table and the route is a larger, separately
scoped decision — it has a rendering endpoint, so something may be displaying it.

**Depends on.** Nothing. Note the reuse audit §12 already recorded this; this entry confirms it is
still true at `80a09df4`.

### G-15 — No byte limit at key-image attach time

**What exists.** Compose-time 2.5 MB/image and 8 MB total (`resolveSelectedKeyImages.ts:26-27,198-214`);
print inline ceiling 2.5 MB (`frozenKeyImages.ts:37`); thumbnail 400 KB (`reportImages.ts:33`).
Attach re-fetches at `?quality=95&viewport=2000,2000` (`reportImages.ts:171-183`) and normalises to a
1800 px max edge (`frozenKeyImages.ts:39,90-110`).

**Exact missing integration.** No check in the attach handler — `POST /key-images/from-pacs`
(`radiology-report-generator.ts:3659`) — that the stored file is within a bound. A pathological render
is stored and only fails later, at compose or print — i.e. the failure surfaces at the moment it is
most expensive.

**Smallest safe correction.** One size check after normalisation and before the row insert, refusing
with a named error. The 8 MiB multipart limit already applies to *uploaded* images
(`radiology-report-generator.ts:163`); this closes the server-fetched path.

**Required tests.** An oversized fetch is refused and leaves no file and no row — mirroring the
existing cross-study negative in `pacsImagePicker.request.test.ts`.

**Depends on.** Nothing. Must not change the normalisation, which is correct.

### G-16 — `vision-trial` silently truncates the image set

**What exists.** `reportComposerRouter.post("/vision-trial")` (`reportComposer.ts:725-777`) applies a
mime whitelist (jpeg/png/webp), a ≤3.5 M char limit, and `.slice(0,6)` (`:746-762`). The comparison
route by contrast **rejects** rather than truncates (`aiComparison.ts:36-55,138-146`).

**Why it matters.** A trial that silently drops images reports a result for a different input than the
operator supplied. It is an admin diagnostic, not a clinical path — hence S3 — but it is the tool used
to decide whether a model can see.

**Smallest safe correction.** Refuse on excess, matching `aiComparison.ts`. One branch.

**Depends on.** Nothing. Note the Stage-1 plan already lists `/vision-trial` as an owner decision
(retire, or route through the same local-only + audit branch); this correction is compatible with
either outcome.

### G-17 — All three interactive cloud arms mislabel every image as JPEG

**What exists.** `AiQueryOptions.images` is a bare `string[]` (`lib/ai-providers/src/index.ts:278`) —
**it carries no MIME at all.** So each cloud arm hard-codes one: the OpenAI-compatible arm builds
`data:image/jpeg;base64,…` (`:531`), the Gemini arm sets `inlineData.mimeType:"image/jpeg"` (`:590`),
and the Anthropic arm sets `media_type:"image/jpeg"` (`:635`) even though its own type union at `:632`
admits png/gif/webp. A PNG's bytes travel labelled JPEG on every interactive cloud image call.

**The Composer path is correct by contrast** — `ComposerProviderImage` carries `mimeType`
(`gatewayPrivacy.ts:107`), the whitelist accepts jpeg/png/webp (`:205-207`), and the adapter forwards
the real value (`compatibleComposerAdapters.ts:132-133`). That is why this is S3 and not S2: the path
that sends clinic images today already labels them honestly.

**Smallest safe correction.** Not three separate edits. Either widen `AiQueryOptions.images` to carry
an optional MIME (defaulting to jpeg, so every existing caller still compiles), or add one shared
magic-byte sniffer used by all three arms. **Do not** fix only the Anthropic arm — that leaves two
identical defects in place and makes the next reader assume the others were checked.

**Required tests.** A PNG payload carries `image/png` on all three arms, and an unlabelled legacy
caller still produces `image/jpeg`.

**Depends on.** Nothing. Note the Anthropic arm is currently unreachable from the Composer because
there is no Anthropic Composer adapter (`assertComposerProviderPolicy.ts:112-116`) — but all three are
live on the interactive `/api/ai-reporting/*` path.

### G-18 — No `num_ctx` escalation after `CONTEXT_BUDGET_EXCEEDED`

**What exists.** `buildOllamaChatPayload` sends `options.num_ctx` only when the caller supplies it
(`index.ts:695`); omitting it leaves Ollama's ~4096 default — the documented root cause at
`contextBudget.ts:4-11` (six MRI JPEGs ≈ 6453 tokens rejected at 4096). The failure is correctly
classified as `CONTEXT_BUDGET_EXCEEDED` (`providerResourceErrors.ts:86-221`) and carried into
overnight provenance as a `resourceFailureCode` (`gatewayInferenceProvider.ts:280-302`).
`resolveInteractiveDraftNumCtx` prefers 8192 for multi-image (`contextBudget.ts:69-105`) and
`composerContextBudget.ts` sizes from ~1076 tokens/image with a 16,384 cloud ceiling, failing clearly
rather than truncating (`:1-60`).

**Exact missing integration.** Classification without remedy: the code names the cause and stops.

**Smallest safe correction.** One bounded retry at the next `num_ctx` step, only for
`CONTEXT_BUDGET_EXCEEDED`, only within the existing budget ceiling, and recorded in provenance
(`recoveredOnce` already exists as a field — `gatewayInferenceProvider.ts:301`). **Not** an unbounded
escalation: on a shared GPU a larger context can evict another model.

**Required tests.** A first call failing `CONTEXT_BUDGET_EXCEEDED` retries once at a larger `num_ctx`
and records `recoveredOnce: true`; a second failure does not retry.

**Depends on.** Nothing, but it should be measured against `gpuContextCleanRunner.ts` behaviour first,
since that module exists precisely to probe context residency without changing production defaults
(`:163`).

### G-19 — Truncation is diagnosed and never persisted

**What exists.** `AiQueryDiagnostics` carries `finishReason` and token counts (`index.ts:330-340`);
`OUTPUT_BUDGET_EXHAUSTED` is named in the shadow-draft pointer JSON
(`shadowDraftUsability.ts:60-61,190-191`); per-call `httpStatus`/`errorClass`/`errorCode` exist
(`index.ts:1397-1414`).

**Exact missing integration.** No audit, draft or report column records truncation. An interactive
`/query` or `/draft` row cannot distinguish a truncated answer from a short one. The audit table has
only `success` + `errorMessage` (`aiReporting.ts:990-991`).

**Smallest safe correction.** Two columns on `ai_reporting_audit_logs` — `finishReason` and a token
count — written from diagnostics that already exist. This is a schema change, so it needs a
forward-only `migrations/*.sql` and must pass `scripts/check-migration-order.cjs`,
`scripts/db-schema-verify.cjs`, `scripts/audit-migration-ledger.mjs` and
`lib/db/src/schema/migrationColumnParity.test.ts`. **Never `pnpm db:push`.**

**Depends on.** A migration, which raises its review cost. Consider deferring until G-7 (free) and G-13
(which needs run data anyway) are settled.

### G-20 — The comparison workspace has zero tests

**What exists.** A complete, careful sandbox (§11 of the workflow doc) with per-arm provenance, a
once-per-request egress resolution, a deliberate omission of `imageSourceTypes`, and honest UI
warnings.

**Exact missing integration.** No test of any kind for `routes/aiComparison.ts` or
`AiComparisonWorkspace.tsx`. Egress behaviour is covered only indirectly by `phiImageCloudGuard.test.ts`
and the DB-gated `aiReporting.imageEgress.request.test.ts`, which test `/query`.

**Also:** `POST /save-winner` accepts client-supplied text and does not verify it came from the named
provider/model (`aiComparison.ts:291-299`), and its audit insert failure is swallowed (`:215`).

**Smallest safe correction.** A `aiComparison.request.test.ts` following the existing convention,
covering: arm resolution from both shapes, the ≤6 arms and ≤6 images limits, a policy stop producing
`attempted:false`, an unattested cloud arm refused, `save-winner` writing exactly one audit row and
touching no report. Plus one line in `save-winner` recording that the text is operator-supplied, so the
audit row does not imply the model said it.

**Depends on.** Nothing.

### G-21 — Apply is a whole-field replace

**What exists.** `materializeAcceptedText` (`useReportComposer.ts:507`; server twin
`trackedChanges.ts:105-122`, ERP copy `lib/reportComposer/types.ts:467`) replaces the **whole field
text** for each accepted change (`trackedChanges.ts:34-51`). Accepting one FINDINGS change swaps the
entire Findings field.

**Why this is S3 and not S1.** It is gated four ways — freshness (`useReportComposer.ts:429,471`),
explicit Accept for clinically significant changes (`:476-486`), the signed-report witness
(`store.ts:4619`), and an undo frame with rollback on server refusal (`:551-560`). Nothing is silent.

**Smallest safe correction.** **Do not redesign this.** The correction is documentary: state the
granularity where a radiologist will see it, so accepting a Findings change is understood as replacing
the field. A sentence-level apply would be a substantial change to a working, tested, gated mechanism —
exactly what the owner's "priorities to evaluate, not permission to rewrite existing working systems"
excludes.

**Depends on.** Nothing.

### G-22 — Two auto-compose switches, one of which does nothing

**What exists.** `reportComposerAutoCompose` is a clinic setting
(`lib/db/src/schema/clinicSettings.ts:268`, `.notNull().default(false)`) with a checkbox at
`AiReportingSettings.tsx:1494`, a save payload at `:747` and a read-back at `:858`. Mode A obeys its
own localStorage key `care.instantReport.modeA.enabled`
(`lib/zai-workspace/instantReport.ts:37`) and is **default ON** — only an explicit `"0"` turns it off
(`:158-159`).

**Exact missing integration.** The clinic setting is stored and read by no behaviour. An administrator
who turns it off changes nothing, per browser.

**Smallest safe correction.** Either delete the setting and its control, or make it the server-side
default that seeds the localStorage key. **Deleting is safer**: the owner's constraint against a second
settings subsystem argues for one visible switch, and Mode A's is the one that works. Note this is a
clinic-settings change, which the owner must approve — *"do not modify production settings"* applies to
the deployed value, and removing a stored key is a schema-adjacent decision.

**Required tests.** A test asserting exactly one switch controls Mode A.

**Depends on.** An owner decision.

### G-23 — Personal templates and chocolate macros are per-browser

**What exists.** `personalReportTemplates.ts:104-123` and `snippet-macros-library.ts:41-43` (key
`zai-rad-snippetmacros-v1`) are localStorage-only; neither file contains an `api.` call. A separate
legacy `radiologist_macros` table exists at `/api/radiology-workflow/macros`
(`radiologyWorkflow.ts:320-337`), used only by `pages/RadiologistTools.tsx:33,42`.

**Clinical importance.** Low — nothing clinical is lost, but a radiologist's personal macros vanish on
a browser or workstation change, and a third macro store already exists server-side.

**Smallest safe correction.** Not recommended as a next-phase item. If the owner wants it, the
correction is to move personal macros onto the **existing** `radiologist_macros` table rather than add
a fourth system.

**Depends on.** An owner decision. Listed for completeness.

---

## 4. Gaps deliberately *not* in this list

Recorded so the absence is a decision, not an oversight.

| Not a gap | Why |
| --- | --- |
| "Cloud image egress is too strict" | It is correct. Door 1 is default-deny with session-derived attestation; door 2 refuses for want of a proof. Both fail in the safe direction and both name their remedy. G-10 asks for a comment, not a relaxation. |
| "The Composer should apply server-side" | The client-applies design is gated by a persisted baseline token, a server re-resolution of the study, and a cross-patient refusal (`jobService.ts:902`). Moving it is a redesign of a working mechanism. |
| "There should be one template system" | Five exist; three are server-backed and do different jobs (whole-report formats, structured templates, presentation templates). Consolidation is a large refactor with no clinical gain identified. |
| "`ai_job_queue` should be wired up" | Two queues already run on `dicom_retry_queue`. G-14 asks for the documentation to say so, not for a third engine. |
| "Add a second AI gateway" | Six seams exist and exactly one opens a socket. The correction is to describe them accurately (done, `AI_COMPOSER_CURRENT_STATE.md` §1.6), not to add a seventh. |
| "Make the ledger a server table" | Explicitly ruled out by the owner. G-9 proposes server-side *validation* of the existing JSON instead. |

## 5. Stale claims in existing documents

Corrections to make in the same documentation PR, so no reader acts on a superseded fact.
`STAGE1-*.md` cite `origin/main 6b64b2f0`; PRs #1074–#1082 have landed since.

| Document | Claim | Status at `80a09df4` |
| --- | --- | --- |
| `STAGE1-AI-SCREENSHOT-REPORTING-ARCHITECTURE.md` §F.2 | "`artifacts/api-server/src/lib/reportComposer/**` writes no audit row at all" | **STALE.** `recordImageSendAudit` is called at `jobService.ts:571`. |
| `STAGE1-IMPLEMENTATION-PLAN.md` PR-A | "`hardenedTransport` does not pass `signal` into `requestOptions`" | **STALE.** `hardenedTransport.ts:357` — `signal: init?.signal ?? undefined`. |
| `STAGE1-IMPLEMENTATION-PLAN.md` PR-A | "delete `endpointTrustPolicy.ts` after confirming the re-export removal" | **DONE.** The file does not exist in this tree. |
| `STAGE1-IMPLEMENTATION-PLAN.md` | "PR-A is a precondition, not started" | **DONE.** #1075/#1076/#1078/#1079 landed the security mode, the interactive egress threading and the comparison image path. |
| `04-ai-gateway.md` | Capability-driven provider routing over `ai_model_capabilities` | **DEAD.** No writer, no seed (G-6). |
| `07-orchestration-and-night-processing.md` | The `ai_job_queue` orchestration runs | **NOT RUNNING.** No worker, `admitJob` uncalled (G-14). |
| `15-security-model.md` | De-identification of images before cloud egress | **NOT WIRED.** Built, 23 tests, zero callers (G-11, G-12). |
| `README.md` | "One AI seam. All model calls go through the AI Gateway (`generateAiForTask`)" | **INACCURATE.** Six seams; the socket-opening one is `generateAiResponse` (`index.ts:1234`). |
| `IMPLEMENTATION_TRACKER.md` G8 | "Built, not wired" | **STILL ACCURATE.** Confirmed (G-13). |
| `IMPLEMENTATION_TRACKER.md` G10 | "✅ Done — AI Scheduler + 5 processing modes" | **OVERSTATED.** The scheduler's admission function has no caller (G-14). |

Still accurate and unchanged: no unresolved-placeholder check in `validateComposerOutput` (G-2);
`fieldProvenance` not persisted (G-1); `DICOM_REDACTION_PERFORMED = false` (G-12).
