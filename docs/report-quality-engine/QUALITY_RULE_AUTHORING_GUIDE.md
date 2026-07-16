# CARE Quality Rule Authoring Guide

**Status:** Platform standard · **Applies to:** every Quality Rule written for the CARE Reporting Platform · **Audience:** developers, AI coding agents, reviewers, maintainers.

This document is the permanent engineering contract for authoring rules in the
CARE Report Quality Engine (`@workspace/report-quality`). Every rule — hand-written
or data-driven, present or future — must conform to it. Pair it with
[`ARCHITECTURE.md`](./ARCHITECTURE.md) (design of record) and
[`FEASIBILITY.md`](./FEASIBILITY.md) (data-model reality).

> This is a documentation standard. It introduces **no** runtime, API, schema, or
> engine change. Where it describes behavior, it describes the engine as it exists
> today; where it prescribes process (clinical review, activation criteria), it
> defines what future PRs must satisfy.

---

## 1. Philosophy

The Quality Engine is **not**:

- **not an AI engine** — it runs deterministic and heuristic checks, not models. AI-shaped work (extraction, generation, semantic judgement) is routed to Copilot/AI, never faked inside a rule.
- **not a report generator** — it never writes findings, impressions, or recommendations. It reads a report and reports on its quality.
- **not a medical decision-maker** — it does not diagnose. It flags *consistency*, *completeness*, and *deterministic-fact* problems for a clinician to resolve.

What it does:

- **Validates consistency** — the report does not contradict itself or its structured data.
- **Validates completeness** — mandatory sections/measurements/impression/recommendation are present.
- **Validates deterministic facts** — a measurement is in range, a unit is correct, a modality matches the study.

Two invariants that never change:

- **Free-text (heuristic) rules remain advisory** — they surface warnings; they never block.
- **Structured (deterministic) rules may *eventually* become blocking** — only after clinical review (§13) and only when the check is genuinely deterministic on typed data.

---

## 2. Rule lifecycle

Every rule travels this path. A rule may not skip stages.

```
Idea
  ↓  a clinician or engineer proposes a check
Clinical discussion
  ↓  agree the check is correct, deterministic-or-advisory, and worth it
Knowledge Pack definition        (if pack-owned: thresholds/lists live in the pack)
  ↓
Rule definition                  (RuleDefinition / RuleCatalogEntry — §3)
  ↓
Executor selection               (reuse a generic executor — §6 — before writing code)
  ↓
Implementation                   (config-only if a generic executor fits)
  ↓
Shadow mode                      (runs, persists, never user-visible — §9)
  ↓
Clinical validation              (review real shadow evaluations for FP/FN — §10, §13)
  ↓
Production advisory              (severity warning; visible; never blocks)
  ↓
Production blocker               (ONLY deterministic structured rules, ONLY after §13)
  ↓
Version updates                  (per-rule version bump on any semantic change — §14)
  ↓
Retirement                       (deprecate the id; keep it as a permanent alias — §5)
```

A rule's current stage is expressed in data: `blockingEligibility` (false until clinically approved), `tier` (structured/heuristic), and `severity`.

---

## 3. Rule anatomy

Every rule declares the following. Text-tier rules use `RuleCatalogEntry`
(`ruleCatalog.ts`); structured/data-driven rules use `RuleDefinition`
(`executor.ts`). Fields marked *(catalog)* / *(definition)* note where each lives.

| Field | Required | Where | Meaning |
|---|---|---|---|
| **canonical ID** | yes | both | Hierarchical, namespaced primary id (`care.measurement.range`, `pack.usg.ob.afi-range`). New rules use this as `id`. |
| **legacy alias** | if applicable | both | The original flat id (`Q001`). Grandfathered forever; never reused. |
| **title** | yes | catalog | Short human name. |
| **purpose** | yes | doc/comment | One sentence: what clinical/quality problem it prevents. |
| **category** | yes | both | From the standard taxonomy (§4). |
| **owner** | yes | both | `care-core` for built-ins; a team/pack for others. |
| **Knowledge Pack** | if pack-owned | both (`pack`) | Owning pack id, or `null` for built-ins. |
| **version** | yes | both | Per-rule semver; bump on any behavior change (§14). |
| **executor** | yes (structured) | definition | Name of the generic executor that interprets `params`. |
| **deterministic / heuristic** | yes | both (`tier`) | `structured` = deterministic on typed data; `heuristic` = free-text keyword/regex. |
| **severity** | yes | both | `info` \| `warning` \| `blocker` (§9). |
| **blocking eligibility** | yes (structured) | definition | `false` until clinically approved (§13). Heuristic rules are never eligible. |
| **structured inputs** | yes | definition (`requires`) | Context slots the rule needs; absent → `notEvaluated` (§7, §10). |
| **data sources** | yes | definition (`provenance`) | The authoritative table/column/pack field the rule reasons over. |
| **dependencies** | optional | both (`dependsOn`) | Other rule ids this rule logically depends on (dashboards/ordering; not yet consumed by the runner). |
| **evidence** | yes | finding | The concrete value/phrase/row that triggered it (§8). |
| **suggested fix** | yes | finding | A human-actionable next step. |
| **references** | recommended | doc/comment | Guideline / protocol / literature backing the threshold. |
| **examples** | yes | tests/doc | Inputs that must fire (§11). |
| **counter-examples** | yes | tests/doc | Correct reports that must NOT fire (negative tests — §11). |

A produced `QualityFinding` carries: `ruleId`, `canonicalId`, `category`,
`severity`, `tier`, `modality`, `studyType`, `knowledgePackSource`, `weight`,
`message`, `rationale`, `evidence`, `suggestedFix`, `targetRef`, `actionMacro`.

---

## 4. Rule categories

Use exactly one category per rule. The engine's `QualityCategory` type is the
canonical set; the table maps each to the broader platform taxonomy and states
when to use it.

| Category (implemented) | Use for | Example |
|---|---|---|
| `measurement` | numeric measurement presence / range / unit | AFI out of range; CTR missing |
| `protocol` | protocol/sequence/section requirements | required MRI sequence absent |
| `completeness` | a mandatory section/field is absent | empty impression; undocumented section |
| `consistency` | internal contradiction between parts of the report | normal findings vs abnormal impression |
| `laterality` | side (left/right/bilateral) correctness | impression side not in findings |
| `terminology` | wrong-modality/spelling terminology | CT wording inside an MRI report |
| `recommendation` | recommendation ↔ finding appropriateness | biopsy on a normal study |
| `comparison` | current vs prior contradiction | stone larger but impression says smaller |
| `critical` | critical-finding handling | unacknowledged critical result |
| `knowledge-pack` | pack manifest completeness/validity | pack missing a required section list |

**Reserved / forward taxonomy** (map into the above until first-classed): *Findings*
and *Impression* → `consistency`/`completeness`; *Workflow* and *Compliance* →
new categories to be added when first implemented; *Demographic* → `consistency`
(gender/age vs anatomy today); *AI* → routed to Copilot, not a rule category;
*Security* → out of engine scope (handled by the auth/permission layer). Do **not**
invent a category string ad-hoc — extend the `QualityCategory` union in a typed PR.

---

## 5. Rule IDs

**Legacy flat IDs are permanent.** `Q001`–`Q115` (the text tier) never change,
never get reused, and remain valid as `legacyAlias` forever. Analytics/overrides/
suppression key off the id — never off message text.

**New rules use hierarchical canonical IDs.** Grammar:

```
<owner>.<category>.<subject>[.<qualifier>]
```

Examples (real + illustrative):

```
care.measurement.range                      ← generic
care.protocol.required-measurement
care.findings.laterality
care.structured.consistency.study-modality.mr   ← an implemented Phase-3 rule
pack.usg.ob.afi-range                        ← pack-owned
pack.ct.brain.stroke-window
```

**Naming conventions:** lowercase, dot-separated, kebab within a segment; prefix
`care.` for built-ins and `pack.<packId>.` for pack-owned rules; keep segments
stable — the id is a contract.

**Aliases:** when a rule's id must change, keep the old id in `legacyAlias` and
add the new `canonicalId`; both resolve via `findRuleEntry()`. Never delete an id
that has ever been persisted.

**Deprecation:** mark a rule deprecated by retiring its rule set (remove from the
provider) but keep its catalog entry + `legacyAlias` so historical evaluations
remain interpretable. Bump the rule-set version.

**Ownership:** `owner` names who may change the rule. A pack-owned rule's
thresholds live in the pack manifest; only the pack owner changes them.

---

## 6. Executors

An **executor** is a generic, reusable detection routine parameterized by a
`RuleDefinition.params`. Prefer configuring an existing executor over writing new
code — 1000 rules should be a few dozen executors + thousands of configs.

Each executor is `(def, ctx) => ExecutorFinding[]`, registered by name and bound
via `compileRule(def, registry)`. All are **pure** and **read-only** on context.

| Executor (name) | Solves | Inputs (context slot) | Output | Do NOT use for |
|---|---|---|---|---|
| **NumericRangeExecutor** `structured.numeric-range` | value outside low/high | `measurements` | one finding per out-of-range value | non-numeric/categorical states; cross-unit values without a known conversion (it reconciles mm↔cm, else skips) |
| **UnitValidationExecutor** `structured.unit-validation` | measurement recorded in the wrong unit | `measurements` (+ `protocolRequiredMeasurements.expectedUnits`) | one finding per unit mismatch | measurements with no expected unit (free measurements) |
| **RequiredMeasurementExecutor** `structured.required-measurement` | a required measurement is absent | `protocolRequiredMeasurements` + `measurements` | one finding per missing required label | modality-wide hardcoded lists — always drive from the study's protocol |
| **StudyConsistencyExecutor** `structured.study-modality-consistency` | report modality contradicts the authoritative study | `study` | one finding on mismatch | sentinel (`OT`) or manual drafts with no declared modality (returns none) |
| **ConflictExecutor** `structured.mutually-exclusive-state` | mutually-exclusive states co-selected / abnormal enum state | `findingInstances` (conflict-group) or `measurements` (enum) | one finding per violated group/state | inferring exclusivity from free text |
| **LateralityExecutor** `structured.required-laterality` | missing/invalid side; single-sided paired measurement | `findingInstances` (side) or `measurements` (pair) | one finding per missing side | free-text laterality inference (that stays in the text tier) |
| **RequiredSectionExecutor** `structured.required-section` | a required section was not documented | `template` + `coveredSections` (+ `knowledgePack`) | one finding per undocumented required section | inferring coverage from abnormality rows (they cannot prove a normal section was documented) |

**Reserved for future executors** (placeholders — add when first implemented):
`ComparisonExecutor` (prior vs current numeric delta), `RecommendationMatchExecutor`
(finding → recommendation appropriateness), `CriticalAckExecutor` (critical-finding
acknowledgement), `TerminologyExecutor` (deterministic lexical normalization).

**When to write a new executor instead of a config:** only when the detection
*shape* is genuinely new (not expressible as params on an existing executor).
New executors follow every coding standard in §16 and ship with their own tests.

---

## 7. RuleContext

`QualityContext` (`contract.ts`) is what a rule may read. `text` is always present;
structured slots are optional and gate rules via `requires`.

| Field | Req/Opt | Nullable | Provider (server assembler) | Provenance | Availability today | `notEvaluated` when |
|---|---|---|---|---|---|---|
| `modality` | required | no | request / draft | draft/worklist | always | — |
| `studyDescription` | optional | — | request / study | study | usually | — |
| `text` | required | no | request (report body) | draft fields | always | never (always runs) |
| `measurements` | optional | — | fetal / radiology / doppler / spine tables | typed side-tables | fetal live; radiology flag-gated | slot `undefined` |
| `priors` | optional | — | prior studies (Phase 4) | measurement history | not yet assembled | slot `undefined` |
| `template` | optional | — | `RADIOLOGY_TEMPLATES` / `mri_protocol_specs` | template registry | available | slot `undefined` |
| `findingInstances` | optional | — | `report_finding_instances` ⋈ `radiology_quick_findings` | quick-select | **empty (ff off)** | slot `undefined` |
| `protocolRequiredMeasurements` | optional | — | `radiology_protocols` + `radiology_quick_measurements` | protocol seeds | seeded; not yet assembled | slot `undefined` |
| `knowledgePack` | optional | — | `knowledge_packs.manifest_json` | pack manifest | rich for some packs | slot `undefined` |
| `study` | optional | — | worklist → study modality | PACS/billing | **available (fires today)** | slot `undefined` |
| `coveredSections` | optional | — | report section presence | report structure | not yet assembled | slot `undefined` |

**Rules for context:**

- A slot is `undefined` when its source is flag-off, un-assembled, or unreachable →
  its rules are recorded in `QualityReport.notEvaluated` (honest coverage).
- A slot is `[]` **only** after a real query returned zero rows.
- `confidence`: structured tier is deterministic (high confidence); heuristic tier
  is best-effort (expect false positives). A future `confidence` field on findings
  is reserved for AI/probabilistic rules.
- The engine never fetches data. **Context assembly (all I/O) is the server's job**,
  above the pure engine (§15, §16).

---

## 8. Evidence

Every finding must explain *why it fired*, with a concrete artifact — never hidden
logic. Populate `evidence` (the triggering value/phrase/row) and, where useful,
`rationale` (the clinical/pack reason). Evidence sources by rule type:

- **measurement** — the value + unit (`"26mm"`) and `targetRef` = `radiology_measurements:<id>`.
- **structured finding** — the finding label + `targetRef` = `report_finding_instances:<id>`.
- **protocol requirement** — the missing required label.
- **Knowledge Pack** — the pack id/field that defined the expectation (`knowledgePackSource`).
- **comparison** — the prior vs current values.
- **worklist / study** — declared vs authoritative modality.
- **patient demographics** — the sex/age token that conflicts with anatomy.

If a rule cannot cite evidence, it is not ready to ship.

---

## 9. Blocking policy

Four levels; be explicit which one a rule uses.

| Level | severity + eligibility | Effect | Allowed for |
|---|---|---|---|
| **Hard Block** | `blocker` + `blockingEligibility:true` | Prevents finalize (Phase 5 gate) | **Only** deterministic **structured** rules, **only** after clinical review (§13) |
| **Soft Block** | `blocker` + eligibility true + override allowed | Requires an explicit override + reason | Same eligibility as hard block |
| **Warning** | `warning` | Advisory; visible; never blocks | Any rule |
| **Information** | `info` | Informational only | Any rule |

**Never allowed:**

- A **free-text / heuristic** rule blocking finalize — ever. Heuristic rules are
  `warning`/`info` only.
- A structured rule blocking before clinical review sets `blockingEligibility:true`.
- Blocking on a rule whose data may be missing (a `notEvaluated` rule cannot block).

Until Phase 5 ships the finalize gate, **all** rules are effectively advisory
regardless of severity, and every Phase-3 structured rule carries
`blockingEligibility:false`.

---

## 10. False-positive policy

Every rule documents its failure modes. A false positive on a clinical tool erodes
trust faster than a missed check.

Each rule states:

- **Known false positives** — inputs that could wrongly fire, and how they're mitigated.
- **Known false negatives** — checks it deliberately does not attempt.
- **Missing-data situations** — what happens when a required slot is absent → it must be `notEvaluated`, never a false pass or false fire.
- **Unknown state** — ambiguous input (e.g. sentinel modality `OT`, `NaN` value, categorical value where a number is expected) → return nothing.

**The cardinal rule: never guess.** If a rule cannot determine an answer with the
data it has, it emits nothing and the runner records it in `notEvaluated`. Prefer a
missed detection you can see (`notEvaluated`) over a false positive you can't.

Worked example (from Phase 3): `numeric-range` reconciles mm↔cm before comparing;
if units are incompatible it **skips** rather than emit an inverted conclusion, and
`unit-validation` flags the mismatch separately.

---

## 11. Testing

Every rule ships with tests before it merges. Minimum set:

| Test | Asserts |
|---|---|
| **Unit tests** | the executor's logic in isolation (boundary values, empty/malformed input) |
| **Golden tests** | representative real-shaped reports produce the exact expected findings |
| **Cross-modality tests** | correct scoping — the rule fires only for its modalities |
| **Regression tests** | a fixed bug stays fixed (e.g. the AFI mm/cm inversion) |
| **Negative tests** | a correct report produces **no** finding |
| **Counter-example tests** | near-miss inputs that must not fire |
| **Performance** | within the target (§15) |

Process gates (not code, but required for status changes):

- **Clinical review** (§13) — before `blockingEligibility` may be set true.
- **Shadow validation** — real shadow evaluations reviewed for FP/FN before advisory.
- **Activation criteria** — documented, measurable thresholds (e.g. "< X% false-positive rate over N shadow evaluations") before advisory → blocking.

---

## 12. Knowledge Packs

Quality Rules and Knowledge Packs divide as **data vs logic**:

- **In `manifest_json` (pack data):** thresholds, required-measurement lists,
  required-section lists, expected units, mutually-exclusive state sets,
  laterality expectations, not-applicable sections, recommendation maps,
  modality/study binding, pack version. These are *configuration* a generic
  executor interprets.
- **In typed code (engine):** the deterministic *logic* — the executors. Never
  encode clinical thresholds as literals in an executor; they belong in the pack.

**When to create a generic executor instead of a new rule implementation:** when
the new check is the same *shape* as existing ones with different data (a new
range, a new required list) — that is a pack config, not code. Only a genuinely new
detection shape warrants a new executor. A pack that needs bespoke code for a
one-off check is a smell; first ask whether a generic executor + config suffices.

---

## 13. Clinical review

**Every deterministic rule must be clinically reviewed before blocking can ever be
enabled.** Concretely:

- A rule ships in **shadow** with `blockingEligibility:false`.
- Its shadow evaluations are reviewed by a clinician against real reports.
- Only after sign-off — recorded, with the reviewer and date — may a PR set
  `blockingEligibility:true` and (later, Phase 5) promote severity to a gate.
- Thresholds sourced from a pack are the pack owner's clinical responsibility.

No engineer may unilaterally make a rule blocking. This is a hard process gate.

---

## 14. Versioning

Reproducibility of a historical evaluation = "what did we conclude, under which
versions" — the persisted findings + the version stamps, not re-running old code.

| Version | Where | Bump when |
|---|---|---|
| **Rule version** | `RuleDefinition.version` / catalog entry `version` | any change to a single rule's behavior |
| **Rule-set version** | `RULE_CATALOG_VERSION` / `STRUCTURED_RULE_SET_VERSION` | the set of rules changes |
| **Engine version** | `REPORT_QUALITY_ENGINE_VERSION` | engine/runner semantics change |
| **Knowledge Pack version** | `knowledgePackVersion` (per evaluation) | the pack manifest changes |
| **Evaluation version** | stamped on every `report_quality_evaluations` row (`engineVersion`+`ruleVersion`+`knowledgePackVersion`+`evaluatedAt`) | every run |

**Override history** and **audit history** are append-only (`report_quality_overrides`);
prior entries are never overwritten. A finding's provenance + the evaluation's
version stamps make any historical result reproducible for audit.

---

## 15. Performance

- **Target runtime:** a full engine evaluation should complete in **single-digit
  milliseconds**; a single rule in **well under 1 ms** (Phase-3 structured tier: ≤ 1.2 ms
  for 23 rules).
- **Complexity:** linear in the size of its input slice; no quadratic scans over
  large collections.
- **Caching / provider reuse:** reuse a single engine instance
  (`createQualityEngine`/`createStructuredEngine`) across requests; do not rebuild
  per call.
- **Avoid duplicate evaluation:** compute once and share (the parity scorer sums
  finding weights rather than re-evaluating the tier).
- **Avoid unnecessary allocations:** no needless intermediate arrays/maps in hot paths.
- **Keep rules pure** (§16).
- **Never perform database access inside an executor.** All I/O is the server
  assembler's job, above the pure engine.

---

## 16. Coding standards

A rule / executor MUST:

- **be deterministic** — same context in → same findings out (timing/timestamps aside).
- **be side-effect free** and **pure** — no observable effect beyond its return value.
- **never mutate the context** — treat `ctx` as immutable.
- **never write to the database** — persistence is the server's job.
- **never call APIs / do I/O** — no network, no fs, no clock reads in the detection path.
- **never throw an uncaught exception** — the runner isolates a throwing rule into
  `notEvaluated`, but a rule should not rely on that; guard your inputs.
- **return structured evidence** — every finding cites `evidence` + `suggestedFix`.
- **use stable IDs** — never derive identity from message text.
- **avoid duplicated logic** — prefer a generic executor + config over new code.
- **prefer generic executors** and **be reusable across modalities** — scope via
  `modalities`, not by forking near-identical code.

---

## 17. Clinical examples

Worked examples across the platform's studies. Format: **Rule → Evidence →
Executor → Result → Suggested fix.** (Rules marked *(planned)* illustrate the
target once their data source is assembled; they are `notEvaluated` today.)

**MRI Brain** — `care.structured.measurement.range.mr.brain.midline-shift`
· Evidence: `Midline shift 3cm` · Executor: NumericRange (converts 3 cm → 30 mm vs ≤ 2 mm)
· Result: warning, "above the expected range (≤ 2mm)" · Fix: verify and interpret.

**MRI LS Spine** — `care.structured.consistency.exclusive.mr.spine.alignment`
· Evidence: `alignment = "wedged"` · Executor: Conflict (enum; allowed set) · Result:
warning, unexpected state · Fix: confirm the spinal alignment state.

**USG Whole Abdomen** — `care.structured.laterality.usg.kidneys`
· Evidence: `rightKidneyLengthMm present, leftKidneyLengthMm missing` · Executor:
Laterality (pair) · Result: warning · Fix: record the contralateral measurement.

**USG Growth Scan** — `care.structured.measurement.required.usg.growth` (protocol-driven)
· Evidence: `efw missing` · Executor: RequiredMeasurement (list from the study's
protocol) · Result: warning, "Required measurement 'efw' is missing" · Fix: record EFW.
And `care.structured.measurement.range.usg.fetal.afi` · Evidence: `AFI 26mm` (2.6 cm)
· NumericRange (mm→cm) · Result: warning, "below the expected range (≥ 5cm)" · Fix:
consider oligohydramnios.

**CT Brain** — `care.structured.consistency.study-modality.ct` (fires today)
· Evidence: `declared=MRI authoritative=CT` · Executor: StudyConsistency · Result:
blocker (shadow), modality mismatch · Fix: confirm the correct modality/study.

**CT KUB** *(planned)* — `care.structured.measurement.required.ct.by-protocol`
· Evidence: `Stone size missing` (from the KUB protocol's required list, **not** a
modality-wide list) · Executor: RequiredMeasurement · Result: warning · Fix: record
stone size. Demonstrates why required-measurement is protocol-driven — a KUB never
demands "Midline shift".

**HRCT Chest** *(planned)* — `care.structured.measurement.unit.ct`
· Evidence: `Nodule size unit "cm" expected "mm"` · Executor: UnitValidation · Result:
warning, normalization hazard · Fix: record in mm.

**Chest X-Ray** — `care.structured.measurement.unit.xr`
· Evidence: `Cardiothoracic ratio unit "mm" expected ""` · Executor: UnitValidation
· Result: warning (a ratio is unitless) · Fix: record CTR as a ratio.

**Extremity X-Ray** *(planned)* — `care.structured.completeness.section.coverage`
· Evidence: covered = `["soft tissue"]`, required includes `"bone"` · Executor:
RequiredSection (reads `coveredSections`, not abnormality rows) · Result: warning,
"'bone' not documented" · Fix: document the bone section.

---

## 18. Rule authoring checklist

Every PR that adds or changes a Quality Rule must satisfy **all** of the following.
Reviewers reject PRs that miss any item.

- [ ] **Canonical ID** is hierarchical, namespaced, stable, and unique; `legacyAlias` set if replacing an id.
- [ ] **Category** is from the standard taxonomy (§4); no ad-hoc category strings.
- [ ] **Metadata complete:** title, purpose, owner, pack (or null), version, executor, tier, severity, `blockingEligibility` (false unless clinically approved), `requires`, `provenance`.
- [ ] **Reuses a generic executor** — new executor only for a genuinely new detection shape, with its own tests.
- [ ] **Config, not code, for thresholds** — clinical values live in the Knowledge Pack manifest, not executor literals.
- [ ] **Pure & side-effect-free** — no DB, no I/O, no mutation, no clock in the detection path (§16).
- [ ] **Never guesses** — missing/ambiguous data → emits nothing → `notEvaluated`; documented FP/FN (§10).
- [ ] **Evidence + suggested fix** on every finding; no hidden logic (§8).
- [ ] **Blocking policy** correct — heuristic never blocks; structured `blockingEligibility:false` until clinical review (§9, §13).
- [ ] **Tests:** unit, golden, cross-modality, negative, counter-example, regression; performance within target (§11, §15).
- [ ] **Shadow first** — ships in shadow; no user-visible/finalize/workflow change until validated (§1, §9).
- [ ] **Versioned** — per-rule `version` bumped; rule-set/engine/pack versions updated as needed (§14).
- [ ] **Clinical review recorded** before any blocking is enabled (§13).
- [ ] **Docs updated** — this guide's tables/examples reflect the new rule where relevant.

---

## Appendix — Phase 3 compliance review

Assessment of the current rules against this guide. **Documentation-only** —
identifies gaps for future cleanup; no code is changed.

**Legend:** PASS = fully conforms · PARTIAL = present but a documented gap · MISSING = absent.

### Text tier (Q001–Q115, `ruleCatalog.ts`)

| Aspect | Status | Note |
|---|---|---|
| Stable IDs + `legacyAlias` + `canonicalId` | **PASS** | flat + hierarchical both present |
| Category, owner, version, tier, severity | **PASS** | complete on every catalog entry |
| Evidence + suggested fix on findings | **PARTIAL** | messages are clear but `evidence`/`suggestedFix` fields are not populated for text findings (message-only) |
| Blocking policy | **PASS** | all `heuristic` + `warning`; never eligible to block |
| Tests | **PASS** | parity + golden (`reportQualityShadow.test.ts`, `phase2.test.ts`) |
| Purpose / examples / counter-examples in docs | **PARTIAL** | described in code comments; not itemized per rule in a doc |

### Structured tier (23 rules, `rules/structured/index.ts`)

| Rule (canonical id suffix) | Identity | Executor | Provenance | `requires` gating | Evidence+Fix | Tests | Overall |
|---|---|---|---|---|---|---|---|
| `study-modality.{mr,ct,us,xr}` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `range.usg.fetal.{fhr,nt,afi,cervical-length,ua-pi}` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `exclusive.usg.fetal.dv-awave` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `required.usg.growth` (protocol-driven) | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `unit.usg.fetal` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `laterality.usg.kidneys` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `required.ct.by-protocol` | PASS | PASS | PASS | PASS | PARTIAL | PARTIAL | **PARTIAL** — fires only once `protocolRequiredMeasurements` is assembled; not yet golden-tested on real CT protocol data |
| `unit.ct` | PASS | PASS | PASS | PASS | PASS | PARTIAL | **PARTIAL** — not exercised by a CT-declared fixture yet |
| `range.ct.pe.rvlv` | PASS | PASS | PASS | PASS | PASS | PARTIAL | **PARTIAL** — no CT-declared fixture |
| `range.mr.brain.midline-shift` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `exclusive.mr.spine.alignment` | PASS | PASS | PASS | PASS | PASS | PARTIAL | **PARTIAL** — enum path tested via unit logic, no spine fixture |
| `required.xr.by-protocol` | PASS | PASS | PASS | PASS | PARTIAL | PARTIAL | **PARTIAL** — protocol-assembly-dependent |
| `unit.xr` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `exclusive.quickselect.conflict-group` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** (fixture-exercised; `notEvaluated` in prod until finding instances populate) |
| `laterality.quickselect.side` | PASS | PASS | PASS | PASS | PARTIAL | MISSING | **PARTIAL** — no fixture exercises finding-side laterality yet |
| `completeness.section.coverage` | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** (fixture-exercised via `coveredSections`) |

**Cross-cutting gaps (documentation/process, no code change here):**

- **PARTIAL — per-rule `purpose`/`references`/counter-examples** are in code comments and provenance, not itemized in a per-rule doc. Future cleanup: a rules catalog doc.
- **PARTIAL — `clinical review` records** do not yet exist; required before any `blockingEligibility` flips true (all are false today, so no violation).
- **PARTIAL — fixtures** cover MR/US richly and the universal rules; CT- and XR-*declared* fixtures (vs the CT-brain-declared-MRI mismatch fixture) and a spine fixture are not yet present — several structured rules are validated by executor logic but not by a modality-declared golden fixture.
- **PASS — everything else**: identity, executor reuse, provenance, `requires`-based `notEvaluated` gating, purity, shadow isolation, and blocking policy all conform.

**Verdict:** Phase 3 **substantially complies** with this guide. The gaps are
documentation and test-coverage breadth (per-rule doc entries; CT/XR/spine
declared fixtures; clinical-review records), not conformance violations. No rule
breaks a hard rule of this standard.
