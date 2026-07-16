# CARE CT Gold Standard — Knowledge Packs

**Status:** v1 — 28 CT Knowledge Packs (21 enabled, 7 placeholder). Additive, backward-compatible.
**One line:** *CT is delivered as clinical content over the existing platform — no CT reporting workspace, no CT engine, no CT Copilot/Companion V2 was built.*

This document is the clinical + engineering rationale for the CT Gold Standard. It builds entirely on the CARE Knowledge Pack Engine (see `CARE_KNOWLEDGE_PACK_SPEC.md`) and the live content tables the Reporting Workspace already reads.

---

## 1. What was built (and what was deliberately NOT)

CT was added the way the Knowledge Pack Engine intends: **as data**. Every CT study is one `knowledge_packs` manifest row that *references* live per-study-type content by string key; the loader assembles it from the same tables MRI/USG use. No reporting code was written for CT.

**Built (all data / declarative):**
- 28 CT pack manifests in the `knowledge_packs` registry.
- Live clinical content for the core CT studies in the existing tables (`radiology_study_tabs`, `radiology_protocols`, `radiology_quick_findings`, `radiology_clinical_history_chips`, `radiology_quick_measurements`).
- Deterministic Copilot impression rules (`radiology_impression_rules`) and Knowledge Base reference articles (`radiology_knowledge_base`) for CT.
- One small, backward-compatible engine improvement (see §6) — the validator generalized from 8 to 15 gold-standard sections so CT packs can be scored per section.
- Engineering Cockpit extension: **Gold Standard Completion** gauge + **per-modality readiness** chips.

**NOT built (explicitly out of scope):** CT Reporting Workspace, CT-specific engines, CT Companion V2, CT Copilot V2, Template/Protocol/Measurement/Quick-Findings/Knowledge-Pack Engine V2. Companion rules are **data** (`companionRules` in the manifest + structured `questionsJson` on findings), never hardcoded React. Copilot **reuses** the existing generic modules (`copilotComparisonModule`, `copilotMeasurementModule`) plus the deterministic impression-rule store.

---

## 2. The 28 CT packs

`pack_id` = `ct.{slug(region)}`. `study_type` is the region key (single source of truth via `matchStudyRegion`); `builder_type` keys the Copilot impression rules; `knowledge_category` keys teaching/knowledge.

| # | Pack | study_type | builder_type | Category | Status |
|---|------|-----------|--------------|----------|--------|
| 1 | CT Brain Plain | CT Brain Plain | ct_brain | Brain | enabled |
| 2 | CT Brain Contrast | CT Brain Contrast | ct_brain | Brain | enabled |
| 3 | CT Stroke | CT Stroke | ct_stroke | Brain | enabled |
| 4 | CT Perfusion | CT Perfusion | ct_perfusion | Brain | enabled |
| 5 | CT Angiography Brain | CT Angiography Brain | ct_angiography_brain | Brain | enabled |
| 6 | CT Orbit | CT Orbit | ct_orbit | Head & Neck | placeholder |
| 7 | CT PNS | CT PNS | ct_pns | Head & Neck | enabled |
| 8 | CT Temporal Bone | CT Temporal Bone | ct_temporal_bone | Head & Neck | enabled |
| 9 | CT Neck | CT Neck | ct_neck | Head & Neck | placeholder |
| 10 | CT Facial Bones | CT Facial Bones | ct_facial_bones | Head & Neck | placeholder |
| 11 | CT Mandible | CT Mandible | ct_mandible | Head & Neck | placeholder |
| 12 | CT Mastoid | *(alias of CT Temporal Bone)* | ct_temporal_bone | Head & Neck | placeholder |
| 13 | CT Paranasal Sinuses | *(alias of CT PNS)* | ct_pns | Head & Neck | enabled |
| 14 | CT Chest Plain | CT Chest Plain | ct_chest | Chest | enabled |
| 15 | HRCT Chest | HRCT Chest | ct_hrct | Chest | enabled |
| 16 | CT Pulmonary Angiography | CT Pulmonary Angiography | ct_pulmonary_angiography | Chest | enabled |
| 17 | CT Abdomen Plain | CT Abdomen Plain | ct_abdomen | Abdomen | enabled |
| 18 | CECT Abdomen | CECT Abdomen | ct_abdomen | Abdomen | enabled |
| 19 | CT KUB | CT KUB | ct_kub | Abdomen | enabled |
| 20 | CT Urography | CT Urography | ct_urography | Abdomen | enabled |
| 21 | CT Pelvis | CT Pelvis | ct_pelvis | Pelvis | placeholder |
| 22 | CT Whole Abdomen | CT Whole Abdomen | ct_abdomen | Abdomen | enabled |
| 23 | CT Cervical Spine | CT Cervical Spine | ct_cervical_spine | Spine | enabled |
| 24 | CT Dorsal Spine | CT Dorsal Spine | ct_dorsal_spine | Spine | enabled |
| 25 | CT Lumbar Spine | CT Lumbar Spine | ct_lumbar_spine | Spine | enabled |
| 26 | CT Whole Spine | CT Whole Spine | ct_whole_spine | Spine | placeholder |
| 27 | CT Trauma (Polytrauma) | CT Trauma | ct_trauma | Abdomen | enabled |
| 28 | CT Oncology Follow-up | CT Oncology Follow-up | ct_oncology_followup | Abdomen | enabled |

**Aliasing:** *CT Mastoid* shares *CT Temporal Bone* content and *CT Paranasal Sinuses* shares *CT PNS* content (same `study_type`/`builder_type`) — the pack engine's reference-by-key design means these need no duplicated content.

---

## 3. Per-pack section coverage

Each pack is scored across the 15 Gold-Standard sections the validator checks:

`template · protocol · clinicalHistory · quickFindings · structuredFindings · measurements · checklist · companion · copilot · recommendations · previousComparison · criticalFindings · teaching · knowledge · references`

| Section | Backing store | CT source |
|---|---|---|
| template | `structured_report_templates` | **not seeded for CT** — Workspace falls back to protocol `normal_text` (see §5) |
| protocol · checklist · measurements · recommendations | `radiology_protocols` | 15 core CT protocols (technique / normal / recommendation / required-measurements / checklist) |
| clinicalHistory | `radiology_clinical_history_chips` | CT history chips |
| quickFindings · structuredFindings | `radiology_quick_findings` | CT findings, high-yield ones carrying structured `questionsJson` |
| measurements | `radiology_quick_measurements` | CT measurement templates |
| companion | `manifest.companionRules` + structured `questionsJson` | data prompts (e.g. *"Stone → level? size? hydronephrosis?"*) |
| copilot | `radiology_impression_rules` (by `builder_type`) + `manifest.copilotModules` | 21 deterministic CT rules + reused generic modules |
| previousComparison | `manifest.comparisonMeasurements` | per-study tracked measurements |
| criticalFindings | `manifest.criticalFindings` | per-study red-flag watch terms |
| knowledge | `radiology_knowledge_base` (by `category`) | 14 CT classification/reference articles |
| references | `manifest.references` | per-study guideline references |
| teaching | `teaching_cases` | **not seeded for CT** — future |

### Readiness by pack (live-verified against the migration set)

Two sections are universally absent for CT today — a dedicated structured **template** row and **teaching** cases — so a CT pack's ceiling is 13/15 (**87%**). This is intentional (see §5) and identical for MRI/USG packs that also lean on protocol normal-text.

| Readiness | Packs |
|---|---|
| **87%** (13/15) — full live content | CT Brain Plain · CECT Abdomen · CT Cervical Spine · HRCT Chest · CT KUB · CT Pulmonary Angiography |
| **73%** (11/15) | CT Chest Plain · CT Oncology Follow-up · CT Stroke · CT Trauma |
| **67%** (10/15) | CT Angiography Brain · CT Lumbar Spine · CT PNS · CT Urography |
| **60%** (9/15) | CT Paranasal Sinuses · CT Temporal Bone |
| **40–47%** — manifest-rich, live protocol pending | CT Brain Contrast · CT Dorsal Spine · CT Whole Abdomen · CT Abdomen Plain · CT Perfusion |
| **27–47%** — placeholder (manifest only, awaiting live content) | CT Mastoid · CT Facial Bones · CT Mandible · CT Neck · CT Orbit · CT Whole Spine · CT Pelvis |

**Gold Standard Completion (average over the 21 enabled packs): 69%** — the figure surfaced on the Engineering Cockpit. Even the thinnest enabled packs carry the full manifest clinical layer (companion / copilot / critical-findings / recommendations / comparison / references) and resolve shared Copilot rules + Knowledge Base via their `builder_type` / `category` siblings.

---

## 4. Companion & Copilot as data

**Companion** follow-up prompts are stored two ways, both data:
1. `manifest.companionRules` — free-text clinical prompts, e.g.
   - CT KUB: *"Calculus → side? location? size (mm)? density (HU)?"*, *"Hydronephrosis → side? grade? hydroureter to level?"*
   - CT Brain: *"Intracranial hemorrhage → volume (ABC/2)? midline shift? IVH? hydrocephalus?"*
   - HRCT: *"Interstitial pattern → fibrosis? honeycombing? traction bronchiectasis? UIP vs non-UIP?"*
   - CECT Abdomen: *"Appendicitis → diameter (mm)? appendicolith? collection?"*
2. Structured `questionsJson` on the finding row — turns a finding into a fill-in-the-blanks structured template (e.g. CT KUB *Renal Calculus* asks side / location / size / HU and templates them into the finding + impression text).

**Copilot** reuses the existing generic modules (`copilotComparisonModule` for prior-study comparison, `copilotMeasurementModule` for measurement completeness) declared per pack in `manifest.copilotModules`. CT-specific deterministic advice comes from 21 `radiology_impression_rules` keyed by `builder_type`, using the `{field, operator, value}` condition shape the existing impression engine understands — they fire only when their condition matches and never hallucinate. No CT Copilot component was created.

**Recommendations & Critical findings** are rule-based and per-study (`manifest.recommendations` / `manifest.criticalFindings` + protocol `recommendation_text`), so they are deterministic and reviewable, not generated.

---

## 5. Known limitations (honest)

- **No structured report template for CT.** CT packs do not seed `structured_report_templates`; the Reporting Workspace uses each protocol's `normal_text` as the baseline report (the same fallback MRI plain-text studies use). This caps CT pack readiness at 13/15. A structured CT template layer is future work and additive.
- **No CT teaching cases.** `teaching_cases` has no CT rows yet; the `teaching` section reads 0 for all CT packs.
- **Five enabled packs are manifest-rich but thin on live protocol content** (CT Brain Contrast, CT Abdomen Plain, CT Whole Abdomen, CT Dorsal Spine, CT Perfusion). They are reportable via shared `builder_type`/`category` content and full manifest clinical rules; dedicated protocol/finding rows are the next increment. The validator correctly reports these as `warn`, and the Cockpit's Warnings count reflects them.
- **Seven placeholder packs** (Orbit, Neck, Facial Bones, Mandible, Mastoid, Pelvis, Whole Spine) carry a complete clinical manifest (companion/critical/recommendation) but await live protocol + finding content. They are intentionally `placeholder` so the validator does not flag them as broken.
- **Impression rules are dormant until a CT builder surfaces their fields.** The rules are valid, keyed data today; they activate wherever a builder exposes the referenced fields, exactly as the platform's existing rule store is designed. No field-config React was added (that would be a CT engine).

---

## 6. The one engine change (minimum, backward-compatible)

Per the task's escape hatch ("make only the minimum backward-compatible improvement required"), the pack **validator** was generalized so packs can be scored per Gold-Standard section:

- `PackManifest` gained `companionRules` and `recommendations` (declarative, defaulting empty — MRI/USG manifests are unaffected).
- `PackCoverage` gained `structuredFindings` (findings carrying `questionsJson`) and `checklistProtocols` (protocols carrying a checklist).
- `PACK_SECTIONS` went from 8 → 15 sections; `validatePack` now emits one issue per missing section with a `readinessPercent` and a per-section `sections` map.
- `/stats` gained `goldStandardCompletion` (average readiness) and `modalityReadiness` (per-modality average), surfaced in the Engineering Cockpit.

No content was moved, no reporting/measurement/copilot engine was created, and MRI/USG pack behaviour is unchanged (12 validator unit tests cover the new scoring).

---

## 7. Roadmap (all additive)

1. Promote the 5 thin enabled packs to full readiness (dedicated protocols + structured findings).
2. Author live protocol + finding content for the 7 placeholders → promote to enabled.
3. Add structured CT report templates (`structured_report_templates`) to lift the `template` section.
4. Seed CT `teaching_cases` per category.
5. Extend structured `questionsJson` coverage to more findings for richer Companion prompts.

Each step is pure content/registry work — no platform redesign.

---

## 8. Files in this change

**Content migrations (data; run alphabetically AFTER all `z*` schema migrations, hence `zzzz_` prefix):**
- `migrations/zzzz_ct_knowledge_packs.sql` — the 28 pack manifests.
- `migrations/zzzz_ct_gold_standard_content.sql` — study tabs, protocols, quick findings (with `questionsJson`/`suggests`/`conflict_group`), history chips, measurements.
- `migrations/zzzz_ct_impression_rules_knowledge.sql` — Copilot impression rules + Knowledge Base articles (idempotent via `INSERT … SELECT … WHERE NOT EXISTS`, as these tables have no unique constraint).

**Engine + UI (the minimum change):**
- `artifacts/api-server/src/lib/knowledgePackManifest.ts` — 15-section validator + readiness.
- `artifacts/api-server/src/lib/knowledgePackManifest.test.ts` — 12 unit tests.
- `artifacts/api-server/src/routes/radiologyKnowledgePacks.ts` — coverage + `/stats` readiness fields.
- `artifacts/diagnostic-erp/src/pages/RadiologyOperationsDashboard.tsx` — Gold Standard Completion gauge + per-modality readiness.

All migrations were verified against a real PostgreSQL instance: applied cleanly in alphabetical order, idempotent on re-run, and every `manifest_json` parses as a valid JSON object.
