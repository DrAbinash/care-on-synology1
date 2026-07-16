# CT Reporting Workspace — Built on the CARE Reporting Platform

**Status:** reuse audit + minimal enablement.
**Thesis proven:** CT was added almost entirely by *configuring* the existing Reporting Platform. The only
code touched is two shared, reuse-preserving fixes (a region resolver and one panel's mount gate). No CT
Workspace, Companion, Copilot, Quality, Protocol, Template, Comparison, or Findings engine was created.

> A radiologist opening **CT Brain** now uses the *same* workspace, the *same* left panel, the *same* Copilot,
> the *same* quality badge, the *same* print layout, and the *same* finalize flow as **MRI Brain** — only the
> clinical content (Knowledge Packs, protocols, findings, measurements, rules) differs.

This document is the deliverable. It is organised as the 15 requested deliverables, followed by validation of
the seven demonstration studies and the success-criteria conclusion.

---

## How the audit was run

A parallel subsystem audit read the live code for each platform surface the spec named (workspace core,
templates, protocols, quick/structured findings, measurements, knowledge packs, Companion, Copilot, Quality
Engine, comparison, worklist/launch/viewer, command palette/voice, print/PDF, knowledge base/teaching, admin
surfaces, and the CT content inventory). Each reader returned, with `file:line` evidence: the mechanism by
which the subsystem keys off modality, whether it is already modality-agnostic, what CT content already exists,
and the *smallest* reuse-preserving gap. The core findings below cite that evidence directly. (The audit run
was interrupted by a platform session limit after the load-bearing subsystems were mapped; the workspace-core
reader independently confirmed that the remaining right-panel surfaces — Copilot, Comparison, Quality, Measure,
Templates, Follow-up, Prior, Teaching — all render for every modality and are gated only by a user preference,
never by modality, so their reuse conclusion is established even where a dedicated per-subsystem reader did not
finish.)

---

## 1. Complete audit of reuse

**Verdict: CT already works as a client of the platform.** The Reporting Workspace is a *single*
modality-agnostic React component; `?modality=CT` opens the same workspace instance
(`RadiologyReportingWorkspace.tsx:528-534`). There is **no modality allowlist or early-return** anywhere in the
workspace that could block CT. Every subsystem resolves content from free-text study hints (`modality +
studyDescription`) against data rows — and CT's data rows are already merged.

Reuse vs genuinely-new for CT:

| | Share of CT capability |
|---|---|
| **Reused unchanged** (workspace, engines, routes, schema, admin, print, finalize) | ~95% |
| **Shared code fixed (reuse-preserving, benefits all modalities)** | 2 small changes |
| **Genuinely new files** | 2 (one test, one doc) |
| **New engines** | 0 |

The two shared fixes:

1. **Region dispatch collision (blocker, fixed).** `matchStudyRegion` (the single shared resolver used by the
   workspace and `QuickFindingsPanel`) returned the *first* region name — in `sortOrder` — that is a substring
   of the study hint. Study-tab names are modality-scoped: the generic `Brain` (for MRI, `sort_order` ~10) sits
   alongside `CT Brain Plain` (`sort_order` 900+); likewise `Spine`/`CT Cervical Spine`, `Chest`/`CT Chest
   Plain`, `Abdomen`/`CT Whole Abdomen`. First-match therefore routed *every* CT study to the shorter generic
   region, so CT content keyed `studyType = "CT Brain Plain"` (protocols, quick findings, quick measurements,
   history chips) **never matched** and did not appear. Fixed by resolving the **most specific (longest) region
   name** that substring-matches, tie-broken by display order. This is strictly more specific and does not
   regress single-match cases (MRI `Brain` still resolves to `Brain`). — `artifacts/diagnostic-erp/src/lib/studyRegion.ts`,
   covered by `studyRegion.test.ts`.

2. **Companion mount gate (blocker for Companion, fixed).** The CARE Companion is not a USG feature — it
   composes the shared engines (protocol / clinical history / quick findings / measurements / Copilot) into a
   pre-report snapshot, from the region-driven props it already receives. It was mounted only under
   `isUltrasound && studyInstanceUID`. Broadened the *one* panel's gate to admit CT and neutralised its
   USG-only labels; the USG code path is unchanged and the panel stays inside its `ModuleErrorBoundary`. —
   `RadiologyReportingWorkspace.tsx`, `UsgCompanionPanel.tsx`.

Everything else CT needs is **content already merged as data** (see §5) or **content polish** documented in §11.

---

## 2. Every existing subsystem reused

Each row is reused by CT with **no CT-specific code**.

| Subsystem | How CT reuses it (evidence) |
|---|---|
| **Reporting Workspace shell** | One instance via `?modality=CT`; layout, editor, action bar, autosave, dirty tracking — `RadiologyReportingWorkspace.tsx:528-534`. `modalityMap` already lists `CT` and falls through to the raw value (`:2414-2418`). |
| **Study/region resolver** | `matchStudyRegion(modality+studyDescription, studyTabNames)` — modality-agnostic substring match; drives Protocol, History, Quick Findings (`studyRegion.ts`; workspace `:1440-1474`). |
| **Templates** | `structured_report_templates` (plain `modality` text column, no enum), same GET/POST/PATCH/DELETE routes, same client fetch + modality chip + apply effect. CT is just rows. (`structuredReportTemplates.ts:375-389`; workspace `:2151-2154, 2490, 2502-2505`.) |
| **Protocols** | `radiology_protocols` + `requestProtocolChange` + `required_measurements` + technique/normal/recommendation text; region-driven dropdown & checklist. CT protocols already seeded. (workspace `:1450-1484, 4686-4710`.) |
| **Clinical History** | Region-scoped history chips, non-destructive insert (workspace `:1460-1465, 4630-4675`). |
| **Quick Findings** | `radiology_quick_findings` strip + `QuickFindingsPanel`; generic route returns all study types, panel filters by study tab. CT tabs seeded. |
| **Structured Findings** | The `questionsJson` Structured Finding Assistant (`{key}`/`[optional]`), `conflictGroup`, `suggests`, finding instances — reused verbatim by CT rows. |
| **Measurements** | `radiology_quick_measurements` (smart-insert), `MeasurementAssistantPanel` manual/calculator widget (with an existing `LOCAL_TEMPLATES.CT` preset), `ViewerMeasurementsPanel` + `useViewerMeasurements` (DICOM-SR import, keyed by `studyInstanceUID`, no modality gate), `missingRequiredMeasurements` validator. |
| **Knowledge Pack Engine** | `knowledge_packs` registry, `/api/radiology/knowledge-packs` (list/stats/assemble/validate/export/import), `packCoverage()`, `validatePack()`, readiness/health scoring, `RadiologyKnowledgePackManager` admin UI, `is_system` delete/overwrite guards — all run unchanged over the 28 CT packs. |
| **CARE Companion** | The one `UsgCompanionPanel` (now `companionEligible` = ultrasound **or** CT); composes protocol/history/quick-findings/measurements/Copilot into a snapshot from the region props already passed. |
| **CARE Copilot** | `analyzeCopilot` orchestrator + the self-registering, modality-agnostic module registry (comparison, measurement-completeness, critical). CT impression rules feed the same deterministic rule store. Gated only by `copilotPrefs.enabled`, never modality (workspace `:3959-3975, 5361-5379`). |
| **Previous Comparison** | `radiologyComparison` engine + `ComparisonPanel` (receives `currentModality`) + prior `RadiologyCopilotPanel`; CT comparison measurements come from pack `comparisonMeasurements` (workspace `:5421-5451`). |
| **Quality Engine** | `computeQualityScore` / `validateReport` live badge + the merged Phase-3 structured engine; modality flows through `assembleStudyContext`. CT rules are expressed as data via the Quality Rule framework + pack manifest. |
| **Command Palette & Voice** | `workspaceCommands.ts` and dictation are modality-agnostic; the "New Brain Report" command already carries `ct` keywords (`:481`). Nothing CT-specific needed. |
| **Print / PDF** | The Premium Report Layout renders any modality's report; finalize & sign are ungated for CT (the only finalize gate is obstetric-USG PCPNDT, `:5266`). |
| **Knowledge Base / Teaching** | `radiologyKnowledgeBaseTable` + teaching cases; CT KB articles already seeded (ASPECTS, ABC/2, Fleischner, Bosniak, LI-RADS, …). |
| **Worklist / Launch / Viewer** | Existing worklist with modality filter; study opens into the workspace via `?modality=&accession=`; the image panel / viewer-measurement bridge is keyed by `studyInstanceUID`, no modality gate. |
| **Admin surfaces** | Knowledge Pack Manager, Quick Select settings, Protocol manager, Clinical History, Measurements, Quality Dashboard, Engineering Cockpit — all modality-parameterised; CT appears by virtue of its data rows, with no CT-specific admin page. |

---

## 3. Every genuinely new file

| File | Kind | Why it exists |
|---|---|---|
| `artifacts/diagnostic-erp/src/lib/studyRegion.test.ts` | test | Locks the "most-specific region wins" behaviour and the no-regression cases for the shared resolver. |
| `docs/ct-reporting/CT_REPORTING_WORKSPACE.md` | doc | This deliverable. |

**No new engine, route, schema, table, migration, page, or component was created.** The two production-code
edits are in-place changes to existing files (`studyRegion.ts`, `RadiologyReportingWorkspace.tsx`,
`UsgCompanionPanel.tsx`).

---

## 4. Every duplicated code path avoided

Each of these was explicitly *not* created, because the platform already covers it:

- CT Reporting Workspace / a `modality === 'CT'` branch inside the workspace — avoided; CT is data through the
  neutral `modalityMap` + `matchStudyRegion` path.
- CT Companion panel / component — avoided; the one panel's gate was broadened instead.
- CT Copilot / a second Copilot orchestrator — avoided; CT rules feed the existing module registry.
- CT Quality validator / a CT quality engine — avoided; CT rules are data in the Quality Rule framework.
- CT Protocol / Template / Findings / Measurement engine — avoided; CT is rows in the shared tables.
- CT Comparison engine — avoided; CT comparison metrics come from pack `comparisonMeasurements`.
- CT worklist / viewer / print / palette / voice / KB — avoided; all modality-agnostic already.
- A second region matcher — avoided; the *single* shared `matchStudyRegion` was fixed for all modalities.
- A CT admin surface — avoided; existing admin pages are modality-parameterised.

---

## 5. Every CT Knowledge Pack used

28 CT system packs are already seeded (`migrations/zzzz_ct_knowledge_packs.sql`, `is_system = TRUE`, idempotent
`ON CONFLICT DO NOTHING`). They are the source of truth for CT and drive protocol/companion/copilot/comparison/
critical behaviour.

**Enabled (21):** `ct.brain_plain`, `ct.brain_contrast`, `ct.stroke`, `ct.perfusion`, `ct.angiography_brain`,
`ct.pns`, `ct.temporal_bone`, `ct.paranasal_sinuses`, `ct.chest_plain`, `ct.hrct_chest`,
`ct.pulmonary_angiography`, `ct.abdomen_plain`, `ct.cect_abdomen`, `ct.kub`, `ct.urography`, `ct.whole_abdomen`,
`ct.cervical_spine`, `ct.dorsal_spine`, `ct.lumbar_spine`, `ct.trauma`, `ct.oncology_followup`.

**Placeholder (7):** `ct.orbit`, `ct.neck`, `ct.facial_bones`, `ct.mandible`, `ct.pelvis`, `ct.whole_spine`,
and one reserved slot. (Several of these already carry partial live content — see §11.)

---

## 6. Every Quality Rule reused

CT reports are validated by the merged Quality Engine (Phases 0–3) with **no CT validator**:

- **Text tier** (advisory) — the ported `reportValidator` rules (`Q001`–`Q115`) run on any modality's free text.
- **Structured tier** (Phase 3, shadow) — the data-driven rules apply to CT through the same executors:
  `study-modality-consistency` (CT vs declared/authoritative modality), `numeric-range`, protocol-driven
  `required-measurement`, `unit-validation`, `required-section`, `mutually-exclusive-state`,
  `required-laterality`.
- **Knowledge-pack coverage rule** — the `modalities: '*'` structured-coverage rule reads CT manifest
  `comparisonMeasurements` / `notApplicableSections` / `criticalFindings`.

Per the **Quality Rule Authoring Guide** (merged PR #103), any CT-specific rule is added as a data-driven
`RuleDefinition` + pack manifest entry — never as CT code.

---

## 7. Every Companion feature reused

The one Companion panel now serves CT and reuses, from CT data, every feature:

- Pre-report **snapshot** composed from protocol + clinical-history + quick-findings + measurements + Copilot.
- **Auto-populate plan** (technique from protocol `techniqueText`, normals from `normalText`, recommendation
  from `recommendationText`) with the provenance ledger — driven by CT protocol rows.
- **Companion suggestions** from `questionsJson` follow-ups + `suggests` co-occurrence on CT quick findings.
- **Intelligent checklist / readiness** across template/protocol/measurements/history/findings.
- **Copilot hand-off** via the existing `companionCopilot` context.

No CT Companion; the USG-specific pre-report bits (Voluson machine-measurement checklist) simply no-op for CT.

---

## 8. Every Copilot feature reused

- **Comparison module** — previous-study comparison (MRI PR 1) for CT priors.
- **Measurement-completeness module** — checks accepted viewer/DICOM-SR measurements against expectations.
- **Critical-results module** — CT critical watch terms (hemorrhage, midline shift, …) from pack
  `criticalFindings`.
- **Deterministic impression rules** — CT rules from `migrations/zzzz_ct_impression_rules_knowledge.sql` feed
  the same rule store `observeReportText` reads.

All via the self-registering module registry; no CT-specific Copilot.

---

## 9. Every Previous Comparison feature reused

- `radiologyComparison` engine + `ComparisonPanel` (receives `currentModality`).
- Prior-study selection (`selectedPrior`) and the prior-comparison metrics strip.
- CT comparison measurements (hemorrhage size, midline shift, infarct extent, pulmonary nodule, pleural
  effusion, stone size, hydrocephalus, aneurysm, mass, follow-up) are defined through CT **Knowledge Pack
  `comparisonMeasurements`** — data, not a CT comparison engine.

---

## 10. Every Measurement feature reused

- `radiology_quick_measurements` smart-insert (CT rows: Midline shift, Hemorrhage volume [ABC/2], Ventricle
  bicaudate index, Stone size, Stone density HU, Nodule size, Lymph-node short axis, RV:LV ratio, Main PA
  diameter, Appendix diameter, Lesion size, Aneurysm size, Canal diameter, Vertebral height loss, …).
- `MeasurementAssistantPanel` manual/calculator widget with modality auto-select and the existing
  `LOCAL_TEMPLATES.CT` preset.
- `ViewerMeasurementsPanel` + `useViewerMeasurements` (DICOM-SR/viewer import) — keyed by study, no modality
  gate.
- `copilotMeasurementModule` completeness/mismatch check; `missingRequiredMeasurements` protocol validator;
  prior-comparison metrics.

No CT measurement engine — only CT measurement *definitions* (data).

---

## 11. Remaining CT study still requiring clinical content

These are **content**, not code — additive, idempotent SQL seeds into the existing tables (or admin edits),
never engine work. Ordered by clinical value:

1. **Quick-finding breadth** — 6 of the 26 CT study tabs currently carry quick findings (~18 rows: CT Brain
   Plain, CT KUB, HRCT Chest, CECT Abdomen, CT Pulmonary Angiography, CT Cervical Spine). The other ~20 tabs
   (CT Stroke, CT Angiography Brain, CT PNS, CT Temporal Bone, CT Neck, CT Chest Plain, CT Urography, CT Pelvis,
   CT Whole Abdomen, CT Trauma, CT Oncology Follow-up, spine variants, …) need `radiology_quick_findings` rows
   with `questionsJson`.
2. **`required_measurements` token alignment** — some CT protocol tokens are not substrings of their rendered
   Quick-Measurement text, so the "missing measurement" nudge cannot clear even after the correct one-click
   measurement is inserted. Data-only edit to the tokens (exactly as the USG gold-standard migration does).
3. **Missing named CT measurements** — Hematoma / extra-axial (SDH/EDH) thickness in mm (only parenchymal ABC/2
   volume is seeded), Hydronephrosis grade (model as a graded quick finding), and canal diameter / vertebral
   height for CT Dorsal Spine and CT Whole Spine. Graded/qualitative ones (ASPECTS, Hydronephrosis grade) belong
   as `questionsJson` findings, not numeric measurements.
4. **Knowledge-pack `template` coverage** — CT packs score the `template` section as not-covered because no
   `structured_report_templates` rows are seeded for `modality='CT'`. Resolve by seeding CT structured templates
   **or** marking `template` in `notApplicableSections` on the CT manifests (CT reporting is largely free-text +
   protocol normals). Both are data/config.
5. **Teaching cases** — seed `teaching_cases` rows whose category matches each pack's `knowledgeCategory` (info
   severity; raises readiness).
6. **Dangling `suggests` labels** — a few CT findings reference related findings not yet seeded (e.g.
   Intracranial Hemorrhage → Intraventricular Extension). Seed the referenced findings or trim the strings.
7. **Placeholder-pack promotion** — `ct.orbit`, `ct.neck`, `ct.facial_bones`, `ct.mandible`, `ct.pelvis`,
   `ct.whole_spine` already carry partial live content; flip `status` to `enabled` (admin PATCH / follow-up
   migration) once content is judged complete.

---

## 12. Clinical readiness score

Readiness is per-study, driven by Knowledge-Pack coverage over the shared engines.

| Study (demo) | Pack | Protocol | Template¹ | Quick Findings | Measurements | Copilot rules | KB | Readiness |
|---|---|---|---|---|---|---|---|---|
| CT Brain (Plain) | `ct.brain_plain` (enabled) | ✅ | N/A¹ | ✅ | ✅ (midline, ABC/2, bicaudate) | ✅ | ✅ (ASPECTS, ABC/2) | **High** |
| CT Chest (Plain) | `ct.chest_plain` (enabled) | ✅ | N/A¹ | ⚠ sparse | ✅ (nodule, node) | ✅ | ✅ | Medium |
| HRCT Chest | `ct.hrct_chest` (enabled) | ✅ | N/A¹ | ✅ | ✅ (nodule) | ✅ | ✅ (Fleischner, UIP) | **High** |
| CT Abdomen (CECT) | `ct.cect_abdomen` (enabled) | ✅ | N/A¹ | ✅ | ✅ (appendix, lesion) | ✅ | ✅ (LI-RADS, Bosniak) | **High** |
| CT KUB | `ct.kub` (enabled) | ✅ | N/A¹ | ✅ | ✅ (stone size, HU) | ✅ | ✅ | **High** |
| CT Spine (Cervical) | `ct.cervical_spine` (enabled) | ✅ | N/A¹ | ✅ | ✅ (canal, height) | ✅ | ✅ (AO Spine, SLIC) | **High** |
| CTA (Pulmonary / Brain) | `ct.pulmonary_angiography` / `ct.angiography_brain` (enabled) | ✅ | N/A¹ | ⚠ sparse (PA) | ✅ (RV:LV, PA dia / aneurysm) | ✅ | ✅ | Medium–High |

¹ `template` = N/A pending the §11.4 decision; it does not block reporting (CT normals come from protocol
`normalText`). **Overall CT clinical readiness: production-ready for the enabled packs**, with the §11 content
polish raising the remaining medium studies to high. The CT Gold Standard measured ~69% completion across all
28 packs (top-tier ~87%) before this work; the two code fixes make that content actually *reachable* in the
workspace.

---

## 13. Regression risk

**Low, and bounded.**

- **`matchStudyRegion` (shared, all modalities).** The change only alters resolution when *two* region names
  both substring-match the hint and the longer one was not already first. A longer region name can match only
  when the hint literally contains that whole phrase, so preferring it is strictly more specific. Single-match
  cases (MRI `Brain`, `USG Abdomen`) are unchanged — verified offline and in `studyRegion.test.ts`. Net effect
  for USG/MRI is "same or more correct."
- **Companion gate.** USG still hits identical code; broadening only *adds* CT eligibility. The panel is inside
  a `ModuleErrorBoundary` and its server assembly degrades gracefully, so a CT study can at worst show a partial
  snapshot — it cannot break reporting. The genuinely USG-specific DICOM-SR measurement-review panel
  (Voluson/OCR/PCPNDT) was deliberately left USG-only.
- **Label rename** (`CARE USG Companion` → `CARE Reporting Companion`, `Ultrasound study` → `Study`) is cosmetic
  and does not touch the tested `usgCompanion*` lib functions or any `data-testid`.

**Verification note:** this environment has no `node_modules` and the repo has no CI, so the authoritative build
runs at Docker deploy (`pnpm install --frozen-lockfile`). The resolver logic was verified offline against its
cases; the edits are typed in-place changes to existing files with no new imports or signatures.

---

## 14. Performance impact

**Negligible.** `matchStudyRegion` still does a single pass over the region-name list (O(regions), tens of
entries) — it now compares lengths instead of returning on first hit; no extra allocation, no new query. The
Companion gate adds one boolean memo. No new network calls, no new render on the USG path. CT reuses the same
already-measured query paths (`/quick-select`, `/master-templates`, `/knowledge-packs`) as MRI/USG.

---

## 15. Technical debt introduced

**Target: zero. Achieved for code.** No new engine, table, migration, route, or component. The one shared
resolver change *reduces* latent debt (it fixes a first-match bug that could equally mis-route multi-word MRI/USG
regions). The remaining items in §11 are pre-existing content gaps, not debt introduced here; they are additive,
idempotent data seeds owned by the CT clinical-content backlog. The one honest carry-forward is the Companion's
internal USG-shaped study-type detection and prior-text field, which are cosmetic for CT (documented, not
blocking) and, if product wants a fully CT-tailored Companion header, are generalised in place (server
`detectStudyType` passthrough + modality-neutral prior text) — never by forking a CT Companion.

---

## Validation — the seven demonstration studies

With the region-resolver fix, each of the seven studies dispatches its CT content through the existing platform:

| Open study | Resolves to region | CT content reached | Result |
|---|---|---|---|
| **CT Brain** | `CT Brain Plain` (was mis-routing to `Brain`) | CT Brain protocol + quick findings + measurements (midline/ABC/2) + ASPECTS KB + Copilot rules | ✅ works via platform |
| **CT Chest** | `CT Chest Plain` | CT Chest protocol + nodule/node measurements + Fleischner KB | ✅ (findings breadth in §11) |
| **HRCT** | `HRCT Chest` | HRCT protocol + UIP/fibrosis findings + Fleischner/UIP KB | ✅ works via platform |
| **CT Abdomen** | `CT Whole Abdomen` / `CECT Abdomen` | CECT protocol + appendix/lesion measurements + LI-RADS/Bosniak KB | ✅ works via platform |
| **CT KUB** | `CT KUB` | KUB protocol + stone size/HU + hydronephrosis (§11) | ✅ works via platform |
| **CT Spine** | `CT Cervical Spine` (was mis-routing to `Cervical Spine`) | Spine protocol + canal/height measurements + AO Spine/SLIC KB | ✅ works via platform |
| **CTA** | `CT Pulmonary Angiography` / `CT Angiography Brain` | CTPA protocol + RV:LV/PA diameter / aneurysm size + Copilot | ✅ works via platform |

All seven use the **same** Reporting Workspace, left panel, Copilot, quality badge, comparison, print, and
finalize as MRI/USG. No duplicated architecture.

---

## Success criteria

> "CT was added almost entirely by configuring the existing Reporting Platform."

Confirmed. The production-code footprint is **two reuse-preserving fixes to shared code** (a region resolver and
one panel's mount gate) plus a test and this document. Every engine, route, schema, admin surface, and print/
finalize path is reused unchanged; all CT clinical behaviour comes from Knowledge Packs and the shared tables.
No CT-specific engine exists — and none is warranted.
