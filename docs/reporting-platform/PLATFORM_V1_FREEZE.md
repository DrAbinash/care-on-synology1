# CARE Reporting Platform — v1.0 Architecture Freeze Declaration

## Declaration

**The CARE Reporting Platform architecture is hereby frozen at Version 1.0.**

The platform — one workspace, one Companion, one Copilot, one Quality Engine,
one Comparison engine, one Knowledge Pack engine, one Measurement registry, one
Clinical Recommendation Registry, one print pipeline, one contract suite — is
**feature complete as architecture**. From this point forward, engineering
effort should overwhelmingly focus on **clinical knowledge**: Knowledge Packs,
protocols, templates, measurements, quality rules and recommendations —
**not platform redesign**. No V2 of anything.

Canonical references: `CARE_REPORTING_PLATFORM_ARCHITECTURE_V1.md` (handbook),
`HOW_TO_ADD_NEW_MODALITY.md` (extension guide), `platform-contract.test.ts`
(mechanical enforcement).

---

## Design Principles — the Platform Constitution

These seven principles govern every future change. They are the constitution of
the CARE Reporting Platform: a proposal that violates one of them is rejected by
default, and the burden of proof lies on the proposal, not the platform.

1. **One Workspace.**
   Never build modality-specific reporting workspaces.
2. **One Engine.**
   Every capability must extend an existing engine whenever possible.
3. **Content over Code.**
   New modalities are added through Knowledge Packs, protocols, measurements,
   templates, quality rules, and recommendations — not new software
   architecture.
4. **Deterministic Before AI.**
   If a rule can be implemented deterministically, do not use AI.
5. **AI Advises, Humans Decide.**
   AI may suggest but never silently modify or finalize reports.
6. **Backward Compatibility.**
   Public contracts are additive; breaking changes require a platform version
   change.
7. **Measure Before Building.**
   Every new architectural proposal must begin with an audit demonstrating that
   existing infrastructure cannot satisfy the requirement.

Enforcement: principles 1–3 are checked mechanically by the contract suite
(single-engine invariants, no modality forks); 4–5 are embodied in the Quality
Engine, Copilot and Recommendation Registry designs (deterministic rules,
advisory-only `why`-explained suggestions, explicit human insertion); 6 is the
Platform Contract v1 below; 7 is the audit-first discipline every platform PR
to date has followed.

---

## Platform Contract v1 (Step 4 — frozen public contracts)

Future changes to every contract below must be **additive** (new optional
fields/keys/entries); breaking changes require a major-version RFC and are
expected never.

| Contract | Frozen surface |
|---|---|
| **Knowledge Pack manifest** | Keys: `companionRules`, `comparisonMeasurements`, `copilotModules`, `criticalFindings`, `notApplicableSections`, `qualityRules`, `recommendations`, `references`, `reportingNotes`. Row: `pack_id` (`<mod>.<slug>`), semver `version`, `status` (`enabled/placeholder/disabled`), `is_system`. Enforced by the contract suite's known-keys test. |
| **Measurement Registry** | `radiology_quick_measurements` (study_type, label, template text, units); viewer/DICOM-SR import shape `{label, value, unit, imported}`; protocol `required_measurements` tokens are substrings of rendered text. |
| **Quality Rule contract** | `RuleDefinition` (id, canonicalId, legacyAlias, category, tier, severity, modalities, owner, pack, version, executor, params, requires, dependsOn, weight, blockingEligibility, provenance) + the 7 generic executors + `QualityReport` DTO (score, findings, counts, notEvaluated, versions, runtimeMs). Governed by `QUALITY_RULE_AUTHORING_GUIDE.md`. Stable rule ids forever; `Q001–Q115` grandfathered as aliases. |
| **Recommendation Registry** | `ClinicalRecommendation` (id `rec.*`, title, description, trigger union [measurement/comparison/finding-text/condition], measurementRefs, qualityRuleRefs, knowledgePackRefs, modalities, severity, priority, evidenceLevel, followUp, rationale, contraindications, references, followUpQuestions, version) + pure `matchRecommendations()` / `recommendationQuestions()` / `legacyFollowUpDatabase()`. |
| **Comparison contract** | `radiologyComparison` engine inputs (current vs prior body + measurements) and significant-change output `{label, deltaText}` — the shape recommendations and Copilot consume. |
| **Companion API** | One panel; props-driven composition (protocol/history/findings/measurements/region/copilot-context callbacks); `companionEligible` gate; `CompanionAssembly` server payload; degrades gracefully inside `ModuleErrorBoundary`. |
| **Copilot API** | `registerCopilotModule({id,label,kind,analyze})`; `CopilotContext` (threaded by the workspace: text, measurements, prior, critical, usgCompanion) and `CopilotItem` (id, category, severity, title, detail, **why**, confidence, insertText/Target) — advisory only. |
| **Workspace extension API** | Right-tab/panel composition inside the one workspace; `?modality=&accession=` deep link; study-tab resolver (most-specific wins). No modality branches. |
| **Admin APIs** | Pack routes (list/stats/assemble/validate/import/export, `is_system` guards); template/protocol/findings CRUD; Recommendation Registry Manager (read-only over versioned data). |
| **Contract-test expectations** | Per-modality capability matrix, negative contracts, single-engine invariants, region matrix, pack hygiene, perf reporting — one `MODALITIES` row per modality. |

## Validation report (Step 7 — re-run at freeze)

All re-verified against the live tree on this branch:

- ✅ No duplicate engines; no modality-specific workspace/Companion/Copilot/
  Quality Engine (contract-suite invariants — ALL PASS).
- ✅ No orphan registries: every registry export has real consumers (verified
  per-symbol); every recommendation anchors to a pack/rule/measurement/
  condition; every pack id unique across 89 packs.
- ✅ No circular dependencies: registries import nothing
  (`clinicalRecommendations.ts` has zero imports); Copilot modules depend one
  way on the orchestrator; the resolver is a leaf.
- ✅ No conflicting clinical advice (one entry per measurement × comparator ×
  modality — ALL PASS).
- ✅ No dead public APIs found in the new surfaces; legacy pages are alive by
  policy (see Migration Guide) and pinned by `canonicalWorkspaceRouting.test.ts`.
- ✅ No undocumented extension points: every extension path is in the handbook
  §7 and the extension guide.

## Platform readiness scores (Step 8)

Scale: 1–5. Honest, not aspirational.

| Subsystem | Arch | Docs | Extensibility | Clinical | DevEx | Maintainability | Scalability | Future-modality |
|---|---|---|---|---|---|---|---|---|
| Workspace | 5 | 5 | 4 | 5 | 3¹ | 3¹ | 5 | 5 |
| Knowledge Packs | 5 | 5 | 5 | 4² | 5 | 5 | 5 | 5 |
| Measurements | 5 | 4 | 5 | 4² | 4 | 5 | 5 | 5 |
| Templates/Protocols/Findings/History | 5 | 4 | 5 | 4² | 5 | 5 | 5 | 5 |
| Companion | 4³ | 5 | 4 | 5 (US) / 4 (CT) | 4 | 4 | 5 | 4 |
| Copilot | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| Quality Engine | 5 | 5 | 5 | 4⁴ | 5 | 5 | 5 | 5 |
| Recommendation Registry | 5 | 5 | 5 | 4⁵ | 5 | 5 | 5 | 5 |
| Comparison | 5 | 4 | 5 | 5 | 4 | 5 | 5 | 5 |
| Print/Voice/Viewer | 5 | 4 | 4 | 5 | 4 | 4 | 5 | 5 |
| Cockpit/Admin | 4 | 5 | 4 | n/a | 4 | 4 | 4 | 5 |
| Contract Tests | 5 | 5 | 5 | n/a | 5 | 5 | 5 | 5 |

**Overall platform architecture score: 4.8 / 5.**

### Technical debt (honest)

¹ The workspace is one 5.8k-line component — correct architecture, heavy file;
candidate for mechanical section extraction (no behaviour change) someday.
² Clinical content breadth: 28 placeholder packs, CT/XR quick-finding breadth,
CT `required_measurements` token alignment, CT/XR structured templates,
teaching-case seeding — all data backlog, no code.
³ Companion carries USG-era naming and USG-shaped detection/prior fields
(cosmetic for CT); rename/generalisation is deferred polish.
⁴ Quality Engine migration is mid-flight **by design**: text tier live at
parity, structured tier shadow, ~10 legacy quality surfaces intentionally
retained until parity proven (Phases 4+); the finalize gate is not yet enabled.
⁵ Recommendation override/ignored telemetry needs a schema addition (future).

## Migration guide (Step 9 — how each modality reached the platform)

| Modality | Legacy path | How it was unified | What remains & why | Retirement |
|---|---|---|---|---|
| **MRI** | Master templates + early workspace | The workspace WAS built canonical for MRI (MRI PRs 1–5: comparison, measurements, critical, combinations, resilience) | Master library remains as the template source | Nothing to retire |
| **USG** | Separate `UsgReporting`/`UsgDopplerReporting` pages + PCPNDT flows | Canonical-workspace consolidation (M1.1) routed USG through the one workspace; Companion Phases 1–2 composed the machine pipeline; PCPNDT guard preserved on finalize | Legacy USG pages remain routed + deprecated-labeled (`canonicalWorkspaceRouting.test.ts` pins this) because historical links/workflows still resolve there | Retire after usage telemetry shows zero traffic; never silently |
| **CT** | None (new) | Added as pure content (PR #97 gold standard) + two reuse fixes (resolver most-specific-match, Companion gate) — proof the platform scales by data | — | n/a |
| **X-Ray** | None (new) | Pure content (40 packs); zero platform changes; validated by the contract suite | 21 placeholder packs pending content | n/a |
| **Quality (cross-modality)** | ~10 scattered validators/engines | Shadow-first strangler: canonical `lib/report-quality` wraps `reportValidator` at byte parity; structured tier shadow | All legacy quality surfaces remain until prod parity (freeze policy: no deletion mid-migration) | Phases 4+ per the quality roadmap, each gated on parity evidence |
| **Recommendations** | Hardcoded `FOLLOW_UP_DATABASE` | Migrated into the Clinical Recommendation Registry; legacy DB now derived, API unchanged | The derived legacy shape remains so `RadiologyAICopilotPanel` is untouched | Consumers may move to the registry directly at leisure |

## Future roadmap (post-freeze — content and completion, not redesign)

1. **Quality Engine Phases 4+** — structured-rule expansion, prod parity
   evidence, then the deterministic finalize gate (per prior decisions:
   blocking only on deterministic structured blockers).
2. **Clinical content sprint** — close the §Technical-debt data backlog;
   promote placeholder packs.
3. **Recommendation telemetry** — acceptance/override events (one append-only
   table) to light up the dashboard's override/ignored metrics.
4. **New modalities as content** — Mammography, DEXA, Fluoroscopy, PET-CT per
   the extension guide.
5. **Deferred polish** — Companion rename/generalisation; workspace file
   splitting (mechanical only); per-modality Playwright smoke tests.

## Developer onboarding (Step 14)

Read in order: ① Handbook (`CARE_REPORTING_PLATFORM_ARCHITECTURE_V1.md`) —
the system in one document; ② `HOW_TO_ADD_NEW_MODALITY.md` — how you'll
actually contribute (it's data); ③ `QUALITY_RULE_AUTHORING_GUIDE.md` — before
touching quality rules; ④ run `platform-contract.test.ts` and read its
assertions — the architecture, mechanically. The one thing to internalise:
**if you're writing an engine, you're doing it wrong.**

## Executive summary (Step 15)

The CARE Reporting Platform is one deterministic, modality-agnostic radiology
reporting system in which MRI, USG, CT and X-Ray are data-defined clients of
shared engines. Its architecture — proven by CT and X-Ray onboarding with
near-zero code, enforced by a permanent contract suite, governed by frozen v1
contracts — is complete and stable. Clinical intelligence (quality rules,
recommendations, packs) is versioned, reviewed data with honest provenance,
never hardcoded and never AI-decided. **Architecture is frozen at v1.0; the
platform's future is clinical content.**
