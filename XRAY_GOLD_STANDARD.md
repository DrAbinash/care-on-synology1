# CARE X-Ray Gold Standard — Knowledge Packs

**Status:** v1 — 40 X-Ray (Digital Radiography) Knowledge Packs (19 enabled, 21 placeholder). Additive, backward-compatible.
**One line:** *X-Ray is a first-class modality delivered as clinical content over the existing platform — no X-Ray workspace, no X-Ray engine, no Companion/Copilot V2.*

Built on the CARE Knowledge Pack Engine (`CARE_KNOWLEDGE_PACK_SPEC.md`), alongside the MRI, USG, and CT Gold Standards. Adding a new X-Ray examination is now primarily a clinical-content task.

---

## 1. Clinical rationale

Plain radiography is **descriptive first**. Unlike CT/MRI, most radiographs carry no routine measurement — forcing one would be clinically wrong. The X-Ray Gold Standard therefore:

- Seeds measurements **only where they are standard of care**: cardiothoracic ratio (chest), Cobb angle (scoliosis), vertebral body height loss and listhesis (spine), joint space (knee OA), stone size (KUB), ET-tube-to-carina distance and prevertebral soft-tissue thickness.
- Marks `measurements` **not-applicable** in the manifest of descriptive packs so the readiness score is not penalised for a correct absence (see §6 — the one minimal engine change).
- Puts the clinical intelligence where it belongs for radiographs: **structured findings** (fill-in-the-blank Companion prompts), **rule-based Copilot impressions**, **critical-finding** watch terms, and **qualitative comparison** targets (fracture healing, alignment, effusion, hardware position).

X-Ray is the highest-volume modality in most departments, so the flagship general studies (Chest PA/AP/Portable, Erect Abdomen, KUB, Pelvis, the common trauma joints, and the spine) are fully authored; the long tail of small-bone/skull/face studies is registered with complete clinical manifests and promoted to full live content incrementally.

---

## 2. Pack list — 40 studies

`pack_id` = `xr.{slug(region)}`; `study_type` is the region key; extremity trauma studies **share** the `xr_extremity` `builder_type` so one deterministic Copilot rule set (fracture / dislocation / lipohaemarthrosis / OA) covers them all.

| Group | Packs (status) |
|---|---|
| **Chest** | Chest PA ✅ · Chest AP ✅ · Portable Chest ✅ · Chest Lateral ○ · Ribs ○ · Sternum ○ |
| **Abdomen** | Abdomen AP ✅ · Erect Abdomen ✅ · KUB ✅ |
| **Pelvis / Hip** | Pelvis AP ✅ · Hip ✅ · Sacrum ○ · Coccyx ○ |
| **Lower limb** | Knee ✅ · Ankle ✅ · Femur ○ · Leg ○ · Foot ○ |
| **Upper limb** | Shoulder ✅ · Wrist ✅ · Hand ✅ · Clavicle ○ · Scapula ○ · Humerus ○ · Elbow ○ · Forearm ○ · Finger ○ · Thumb ○ |
| **Spine** | Cervical Spine ✅ · Dorsal Spine ✅ · Lumbar Spine ✅ · Whole Spine (scoliosis) ✅ |
| **Skull / Head & Neck** | Skull ✅ · Soft Tissue Neck ✅ · Facial Bones ○ · Nasal Bones ○ · Mandible ○ · TM Joint ○ · Paranasal Sinuses ○ · Mastoid ○ |

✅ enabled (full live content) · ○ placeholder (complete manifest, live content pending). **19 enabled, 21 placeholder.**

Every pack declares: Metadata, Protocol, Clinical History Chips, Quick + Structured Findings, Measurements (where applicable), Required Measurements, Checklist, Recommendations, Critical Findings, Companion Rules, Copilot Rules/Modules, Comparison Rules, Quality Rules, References, Version, Dependencies. Template and Teaching Notes are platform-level sections not seeded for X-Ray (see §5).

---

## 3. Coverage — per-section backing store

| Section | Backing store | X-Ray source |
|---|---|---|
| template | `structured_report_templates` | **not seeded** — Workspace falls back to protocol `normal_text` |
| protocol · checklist · required-measurements · recommendations | `radiology_protocols` | 19 X-Ray protocols (PA/AP/portable/erect/trauma/spine/scoliosis views) |
| clinicalHistory | `radiology_clinical_history_chips` | X-Ray history chips |
| quickFindings · structuredFindings | `radiology_quick_findings` | descriptive findings; high-yield ones carry structured `questionsJson` |
| measurements | `radiology_quick_measurements` | **only where standard** (CTR, Cobb, vertebral height, listhesis, joint space, stone size, prevertebral ST, ET-tube distance) |
| companion | `manifest.companionRules` + `questionsJson` | data prompts (see §4) |
| copilot | `radiology_impression_rules` (by `builder_type`) + `manifest.copilotModules` | 24 deterministic X-Ray rules + reused generic modules |
| previousComparison | `manifest.comparisonMeasurements` | qualitative + quantitative targets (fracture healing, alignment, effusion, nodule, hardware, Cobb) |
| criticalFindings | `manifest.criticalFindings` | per-study red-flags (see §4) |
| knowledge | `radiology_knowledge_base` (by `category`) | 13 X-Ray reference articles |
| references | `manifest.references` | per-study references |
| teaching | `teaching_cases` | **not seeded** — future |

### Readiness (live-verified against the migration set)

| Readiness | Packs |
|---|---|
| **87%** (13/15) — full measurement-applicable content | Chest PA · KUB · Knee · Cervical Spine · Dorsal Spine · Lumbar Spine · Whole Spine · Soft Tissue Neck |
| **86%** (12/14) — full descriptive content (measurements N/A) | Portable Chest · Pelvis AP · Shoulder · Wrist |
| **64–79%** — enabled, leaner live findings | Erect Abdomen · Ankle · Hip · Skull · Chest AP · Abdomen AP · Hand |
| **42%** avg — placeholder (manifest only) | the 21 long-tail studies |

**Gold Standard Completion (average over the 19 enabled packs): 80%.** Average over all 40: **60%.** These surface on the Engineering Cockpit's per-modality readiness — **no dashboard code was added**; the generic Gold Standard Completion gauge and per-modality readiness chips built for CT pick up X-Ray automatically.

The universal ceiling of 13/15 (87%) for even a fully-authored pack reflects the two platform-level sections X-Ray does not seed — a structured **template** (radiographs use protocol `normal_text`) and **teaching cases**.

---

## 4. Companion, Copilot, Comparison & Critical findings — as data

**Companion** (manifest `companionRules` + structured `questionsJson`), never hardcoded:
- Fracture → displacement? angulation? intra-articular extension? soft-tissue swelling?
- Chest opacity → lobar or diffuse? air bronchogram? effusion? collapse?
- Cardiomegaly → CTR? upper-lobe diversion / pulmonary edema?
- ET tube → tip-to-carina distance? NG tube → below diaphragm, midline, tip in stomach?
- Scoliosis → Cobb angle? apex? convexity? Risser grade?

**Copilot** reuses the generic `copilotComparisonModule` / `copilotMeasurementModule` (declared per pack in `manifest.copilotModules`). CT-style deterministic advice comes from **24 `radiology_impression_rules`** keyed by `builder_type`, using the `{field, operator, value}` shape the existing engine understands — a rule fires only on match and never hallucinates. Extremity trauma studies share `xr_extremity`, so the fracture/dislocation/lipohaemarthrosis/OA rules are authored once and cover shoulder → foot. **No X-Ray Copilot V2.**

**Previous Comparison** (`manifest.comparisonMeasurements`) — fracture healing, alignment, lung opacity, pleural effusion, nodule size, hardware/tube position, joint degeneration, Cobb-angle progression, stone size.

**Critical findings** (`manifest.criticalFindings`) — tension pneumothorax, large pleural effusion, free subdiaphragmatic air / pneumoperitoneum, bowel obstruction, neck-of-femur / unstable pelvic fracture, cervical instability & prevertebral widening, depressed skull fracture, airway foreign body, retropharyngeal abscess, misplaced ET / NG tube.

**Recommendations** are rule-based and per-study (`manifest.recommendations` + protocol `recommendation_text`): clinical / CT / MRI / ultrasound correlation, follow-up radiograph, orthopaedic opinion, emergency referral — deterministic, never generated.

---

## 5. Known limitations (honest)

- **No structured report template for X-Ray** — packs use each protocol's `normal_text` as the baseline report (the same fallback CT and MRI plain-text studies use). Caps readiness at 13/15.
- **No X-Ray teaching cases** — `teaching_cases` has no X-Ray rows yet.
- **7 enabled packs are leaner** (Chest AP, Abdomen AP, Hand, Ankle, Hip, Skull, Erect Abdomen at 64–79%): they carry a protocol + full manifest but fewer dedicated structured findings. They are reportable today; richer structured findings are the next increment.
- **21 placeholder packs** carry a complete clinical manifest (companion / copilot / critical / recommendations / comparison / references) but await live protocol + finding content. They are intentionally `placeholder` so the validator does not flag them as broken.
- **Impression rules are dormant until a builder surfaces their fields** — valid, keyed data today; they activate wherever a builder exposes the referenced fields, as the platform's rule store is designed. No field-config React was added.

---

## 6. The one engine change (minimum, backward-compatible)

Per the task's escape hatch ("smallest backward-compatible enhancement required"), the manifest/validator gained **`notApplicableSections`**:

- A pack may declare Gold-Standard sections that are clinically not-applicable (for X-Ray, `["measurements"]` on descriptive studies). Those sections are **excluded from the readiness denominator and not flagged as missing**.
- Defaults to empty, so MRI / USG / CT packs are scored exactly as before (verified — 14 validator unit tests, up from 12).

This makes "Clinical Readiness" meaningful for a descriptive modality instead of permanently docking every radiograph for an absence that is correct. It benefits any future descriptive modality.

No content was moved; no reporting / measurement / copilot engine was created; MRI/USG/CT behaviour is unchanged.

---

## 7. Remaining studies & future roadmap (all additive)

1. Promote the 7 leaner enabled packs to full readiness (more structured findings).
2. Author live protocol + finding content for the 21 placeholders (Chest Lateral, Ribs, Sternum, Sacrum, Coccyx, Femur, Leg, Foot, Clavicle, Scapula, Humerus, Elbow, Forearm, Finger, Thumb, Facial Bones, Nasal Bones, Mandible, TM Joint, PNS, Mastoid) → promote to enabled.
3. Add structured X-Ray report templates (`structured_report_templates`) to lift the `template` section.
4. Seed X-Ray `teaching_cases`.

Each step is pure content/registry work — no platform redesign.

---

## 8. Files in this change

**Content migrations (data; `zzzz_` prefix → run alphabetically AFTER every `z*` schema migration):**
- `migrations/zzzz_xr_knowledge_packs.sql` — the 40 pack manifests (replaces PR#97 placeholders).
- `migrations/zzzz_xr_gold_standard_content.sql` — study tabs, protocols, quick + structured findings, history chips, measurements (only where standard).
- `migrations/zzzz_xr_impression_rules_knowledge.sql` — Copilot impression rules + Knowledge Base articles (idempotent via `INSERT … SELECT … WHERE NOT EXISTS`).

**Engine (the minimum change):**
- `artifacts/api-server/src/lib/knowledgePackManifest.ts` — `notApplicableSections`, N/A-aware readiness.
- `artifacts/api-server/src/lib/knowledgePackManifest.test.ts` — 14 unit tests.

**Dashboard:** unchanged — the generic Gold Standard Completion gauge + per-modality readiness (added for CT) surface X-Ray automatically.

All migrations verified against a real PostgreSQL: applied cleanly in alphabetical order, idempotent on re-run, and every `manifest_json` parses as a valid JSON object.
