# 05 — USG Study-Type Template Coverage Audit

*Audit-only document. As-of commit: `15ed9dfc`.*

## Investigation summary

This audit read the full content of `artifacts/api-server/src/lib/usgReportTemplates.ts` (13 auto-fill templates), `artifacts/diagnostic-erp/src/lib/radiologyMasterTemplates.ts` (17 "Dr. Sugandha" master templates, 5 of them USG), the four `lib/db/src/schema/*.ts` template/catalog schemas, `FetalUsgLevel4.tsx` + its route/schema, `RadiologyWorklist.tsx` + `radiologyWorklist.ts`, the structured-report fixtures, the `seeds/radiology/content-packs/v1/*.yaml` seed packs, `RADIOLOGY_KNOWLEDGE_CATALOG.md`, `CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md`, `Antigravity/02_AUDITS/RADIOLOGY_KNOWLEDGE_BASE_AUDIT.md`, `UsgDopplerReporting.tsx`, and the billing catalog importer.

Three distinct "template" layers exist in this codebase, and are distinguished throughout this document:

1. **`usgReportTemplates.ts`** — 13 fixed `UsgTemplateId`s with an auto-fill renderer that pulls from `usg_measurements`/`usg_doppler_measurements` (approved values only).
2. **`radiologyMasterTemplates.ts`** (`ALL_MASTER_TEMPLATES`) — 17 locked "master" templates (findings/impression/advice/variants), 5 of them USG (Abdomen, Pelvis, Doppler, Obstetric, Breast) plus a generic `USG_SMALL_PARTS_MASTER` and `FETAL_ECHO_MASTER`.
3. **`seeds/radiology/content-packs/v1/*.yaml` + `RADIOLOGY_KNOWLEDGE_CATALOG.md`** — the rich structured-finding catalog (parameters, severities, tiles, aliases). Only **`usg_abdomen.yaml`** and **`usg_kub.yaml`** exist for USG; the design spec's own roadmap section explicitly lists USG Obstetric, USG Thyroid/Neck, and USG Scrotum as "next tranche."

A fourth, separate system — **`FetalUsgLevel4.tsx`** + `lib/db/src/schema/fetalUsgLevel4.ts` — is a full bespoke obstetric measurement/checklist/report module, independent of `usgReportTemplates.ts`.

An internal audit (`Antigravity/02_AUDITS/RADIOLOGY_KNOWLEDGE_BASE_AUDIT.md`) already confirms the gap pattern found here: *"Obstetric ultrasound is completely missing from database presets... Thyroid and breast lack DB presets/smart builders... Carotid Doppler is present in DB presets, but lacks a corresponding Smart Builder... Lower/upper limb venous/arterial Doppler is missing"* — from the DB-preset layer specifically. The code-level `usgReportTemplates.ts` layer is more complete than that DB layer, as shown below.

---

## 1. General

| Study Type | Status | Evidence |
|---|---|---|
| Whole Abdomen | EXISTING | `usgReportTemplates.ts` (`WHOLE_ABDOMEN` full template); `radiologyMasterTemplates.ts` (`USG_ABDOMEN_MASTER`, 4 variants incl. fatty liver Gr I/II); `seeds/radiology/content-packs/v1/usg_abdomen.yaml` (26-finding structured catalog per `RADIOLOGY_KNOWLEDGE_CATALOG.md` Part 5) |
| KUB | EXISTING | `usgReportTemplates.ts`; `seeds/radiology/content-packs/v1/usg_kub.yaml`; `RADIOLOGY_KNOWLEDGE_CATALOG.md` Part 6 |
| Pelvis | EXISTING (generic) | `usgReportTemplates.ts` (`PELVIS_FEMALE`, TV/TA combined); `radiologyMasterTemplates.ts` (`USG_PELVIS_MASTER`) — no rich seed-catalog YAML exists, so depth is shallow vs. Abdomen/KUB |
| Prostate | EXISTING | `usgReportTemplates.ts` (`PROSTATE`, volume/shape/median-lobe); `radiologyQuickAddData.ts` (prostatomegaly quick-add); `radiologyMeasurementLibrary.ts` (`usg-prostate` volume field) |
| PVR (post-void residue) | PARTIAL | Only a sub-field inside KUB and Prostate templates ("Post-void residue: ___ ml"); shared severity scale in `RADIOLOGY_KNOWLEDGE_CATALOG.md` §0.4/§5.6 — no standalone PVR study/template |
| Appendix | PARTIAL | Finding entry only, inside the Whole Abdomen catalog: "appendix (probe tenderness, diameter) — appendicitis = Significant." No standalone appendix template anywhere |
| Hernia | MISSING | Every "hernia" hit in the repo is MRI spine disc-herniation content or unrelated test fixtures — nothing for abdominal-wall/inguinal USG hernia |
| Ascites | PARTIAL | Finding entry only ("Ascites mild/mod/gross" severity scale); `WHOLE_ABDOMEN` template has a bare "Free fluid: Nil" line — no dedicated ascites-cause/grading template |

Abdomen, KUB, Pelvis, and Prostate are the strongest studies in the whole codebase. PVR, Appendix, and Ascites are real clinical entities but only exist as sub-fields/findings buried inside the Whole Abdomen or KUB templates, not as addressable study types a radiologist could select from a worklist dropdown. Hernia has zero USG-specific presence.

---

## 2. Obstetric

| Study Type | Status | Evidence |
|---|---|---|
| Early Pregnancy | EXISTING | `usgReportTemplates.ts` (`OB_EARLY`: GS/YS/CRL/FHR); `FetalUsgLevel4.tsx` (dedicated "Early Pregnancy" card); `fetalUsgLevel4.ts` schema (crl/msd/yolkSac/fetalHeartRate columns); `STUDY_TYPES` includes `"early"` |
| Viability | PARTIAL | No dedicated study/template; cardiac-activity present/absent is one line inside `OB_EARLY` and the FHR field in the Early Pregnancy card |
| Dating | PARTIAL | `suggestTemplate()` explicitly routes "dating" text → `OB_EARLY`; GA/EDD panel exists but there's no distinct "Dating Scan" template separate from Early Pregnancy |
| NT/NB | EXISTING | `FetalUsgLevel4.tsx` dedicated "NT Scan" card (NT mm, Nasal Bone present/absent/hypoplastic, Ductus Venosus, Tricuspid Flow); schema columns; `STUDY_TYPES` includes `"nt"` and a worklist filter button |
| Anomaly (Level 2) | EXISTING | `usgReportTemplates.ts` (`OB_ANOMALY` full anatomical-survey template); `FetalUsgLevel4.tsx` 15-point anomaly checklist tab; `fetalUsgChecklistsTable` schema |
| Growth | EXISTING | `usgReportTemplates.ts` (`OB_GROWTH`); `FetalUsgLevel4.tsx` Biometry + Liquor/Placenta cards; growth-chart tab |
| BPP | EXISTING | `FetalUsgLevel4.tsx` dedicated BPP card (breathing/movement/tone/AFI/total/NST); schema columns; no BPP-specific narrative in `usgReportTemplates.ts` — findings/impression are free-text in the Report tab |
| Doppler (obstetric) | EXISTING | `FetalUsgLevel4.tsx` dedicated Doppler card (UA PI/RI/S-D, MCA PI/RI, CPR, DV PI/A-wave, uterine artery PI/RI); schema columns; distinct from the limb/carotid `usgReportTemplates.ts` Doppler IDs |
| Cervical Length | EXISTING (as field) | `FetalUsgLevel4.tsx` (value + auto interpretation); schema `cervicalLength`/`cervicalLengthInterpretation`; checklist `cervix` field — embedded, not a standalone report but genuinely captured with interpretation logic |
| Multiple Pregnancy | EXISTING | `FetalUsgLevel4.tsx` dedicated Twin Pregnancy card (Twin A/B full biometry + discordance %); `isTwin`/`chorionicity`/`amnionicity` columns; `"twin"` filter |

Obstetric is, counter-intuitively, the **best-covered** category — but almost entirely through `FetalUsgLevel4.tsx`, not through `usgReportTemplates.ts`. See below for exactly what it covers.

---

## 3. Gynaecology

| Study Type | Status | Evidence |
|---|---|---|
| TVS | PARTIAL | `PELVIS_FEMALE` template is explicitly titled "USG PELVIS — FEMALE (TV / TA)" — generic, not TVS-protocol-specific; the test catalog lists "TRANSVAGINAL SONOGRAPHY (TVS)" as a *billable test* only |
| Follicular Monitoring | MISSING | Only appears as a billable line item (₹2500) — no serial-visit tracking, no report template, no mention in `smartRadiology.ts` or any template file |
| Infertility | MISSING | Zero hits anywhere in the codebase for an infertility workup study/template |
| Uterus | PARTIAL/REUSABLE | Field set only inside `PELVIS_FEMALE`: size/position/myometrium/endometrium, and `USG_PELVIS_MASTER` |
| Ovaries | PARTIAL/REUSABLE | Field set only inside `PELVIS_FEMALE`: R/L ovary size + bare "Follicles: ___" placeholder; `smartRadiology.ts` has an AI rule for "adnexal cyst / ovarian cyst / follicular cyst / corpus luteum" (missed-finding suggestion, not a report template) |

This is the weakest category in the codebase. Everything gynae-specific collapses into the one generic `PELVIS_FEMALE` template, which has no follicle-tracking table, no infertility-workup structure, and no TVS-specific protocol content (endometrial pattern, cervix, adnexal mass characterization ladders). Follicular monitoring and infertility exist only as a line item in the *billing* test catalog — a patient can be billed for the test, but there is no reporting workspace support at all.

---

## 4. Small Parts

| Study Type | Status | Evidence |
|---|---|---|
| Thyroid | EXISTING | `usgReportTemplates.ts` (`THYROID` template + TIRADS field, `suggestTemplate` regex); DB-preset/smart-builder layer is separately confirmed missing by the knowledge-base audit |
| Breast | EXISTING | `usgReportTemplates.ts` (`BREAST`, BIRADS field); `radiologyMasterTemplates.ts` (`USG_BREAST_MASTER` with variant) |
| Scrotum | EXISTING | `usgReportTemplates.ts` (`SCROTUM`: testes/epididymis/hydrocele/varicocele/vascularity) |
| Neck | PARTIAL | Folded into the Thyroid template, titled "USG THYROID + NECK," with a single "Cervical LN: No significant adenopathy" line — no standalone neck-mass/lymph-node template independent of thyroid |
| Soft Tissue | REUSABLE-FROM-MRI | `radiologyMasterTemplates.ts` (`USG_SMALL_PARTS_MASTER`) is a deliberately generic placeholder ("STRUCTURE: Normal in size, shape, and echotexture...") meant to be reused for any small part — no lipoma/abscess/collection-specific content, but the mechanism (generic master + clone-to-personal-library) is directly reusable |
| MSK (USG) | MISSING | Only MRI has MSK content (knee/shoulder/wrist/ankle seed packs); no USG musculoskeletal (tendon/rotator-cuff/joint effusion) content anywhere |

Thyroid, Breast, and Scrotum are solid at the `usgReportTemplates.ts` layer even though the knowledge-base audit flags them as missing at the DB-preset/smart-builder layer — worth reconciling which layer the new workspace should build on. Neck and Soft Tissue are thin/generic, and USG-specific MSK is a genuine gap.

---

## 5. Doppler

| Study Type | Status | Evidence |
|---|---|---|
| Carotid | EXISTING | `usgReportTemplates.ts` (`CAROTID_DOPPLER`: IMT, plaque); fixture `example5DopplerCarotid.json` (full structured-report golden example with stenosis %, PSV/EDV/ICA-CCA ratio) |
| Arterial (limb) | EXISTING | `usgReportTemplates.ts` (`ARTERIAL_DOPPLER`, ABI); `seeds/radiology/content-packs/v1/doppler_ll.yaml` + `RADIOLOGY_KNOWLEDGE_CATALOG.md` Part 7 (full structured catalog: waveform, stenosis %, ABI bands) |
| Venous (limb) | EXISTING | `usgReportTemplates.ts` (`VENOUS_DOPPLER`, compressibility/augmentation); same `doppler_ll.yaml` seed pack (DVT + varicose-vein content) |
| Renal | REUSABLE-FROM (generic Doppler mechanism) | `UsgDopplerReporting.tsx` vessel presets include "Renal Artery/Vein (R/L)" — measurement capture already exists — but no `RENAL_DOPPLER` entry in `UsgTemplateId` and `suggestTemplate()` has no renal-specific regex branch, so it silently falls through to `ARTERIAL_DOPPLER` |
| Portal | REUSABLE-FROM | "Portal Vein" is the *default* vessel preset in `UsgDopplerReporting.tsx`; no dedicated template ID or portal-hypertension-specific content (flow direction, congestion index) |
| Hepatic | REUSABLE-FROM | "Hepatic Artery"/"Hepatic Vein" presets exist; no dedicated template |
| Obstetric (cross-ref) | EXISTING | Same evidence as §2 above; also "Uterine Artery (R/L)", "Umbilical Artery", "Middle Cerebral Artery", "Ductus Venosus" are vessel presets in `UsgDopplerReporting.tsx`, overlapping with `FetalUsgLevel4`'s dedicated Doppler fields |
| Penile | MISSING | Not in `VESSEL_PRESETS`; no template; would require manual "Other" vessel entry with zero protocol content |
| AV Fistula | MISSING | Not in `VESSEL_PRESETS`; no maturation/stenosis/flow-volume protocol content anywhere |

Doppler is architecturally interesting: `UsgDopplerReporting.tsx` is a **generic, vessel-name-driven measurement capture UI** (any vessel can be logged, with "Other" for free text) feeding `usg_doppler_measurements`, which `autoGenerateReport()` renders through exactly 3 fixed template IDs (Arterial/Venous/Carotid). Renal, Portal, and Hepatic Doppler *can already be measured* through the existing UI/table but have no dedicated report template or `suggestTemplate()` routing — one `UsgTemplateId` + one `switch` case away from working. Penile and AV Fistula have neither measurement presets nor templates.

---

## FetalUsgLevel4 — exact coverage

`FetalUsgLevel4.tsx` + `lib/db/src/schema/fetalUsgLevel4.ts` is a self-contained obstetric module, separate from `usgReportTemplates.ts`. Its `studyType` enum is `["early", "nt", "anomaly", "growth", "doppler", "bpp", "twin", "followup"]`. Mapped against the requested list:

- **Covers directly, with dedicated UI cards + schema columns:** Early Pregnancy, NT/NB, Anomaly/Level 2, Growth, obstetric Doppler, BPP, Multiple Pregnancy.
- **Covers as embedded fields, not as a distinct study type:** Cervical Length (measurement + interpretation on every study regardless of `studyType`), Viability (cardiac-activity field inside the Early Pregnancy card), Dating (GA/EDD panel common to all study types).
- **Does NOT cover:** anything Gynaecological (no TVS/follicular/uterus/ovary path — this module is obstetric-only), Small Parts, General abdomen/pelvis, or non-obstetric Doppler (carotid/limb/renal/etc. — those route through `usgReportTemplates.ts` + `UsgDopplerReporting.tsx` instead).

So the answer to "does `FetalUsgLevel4` cover Anomaly/NT-NB/Growth/BPP already" is **yes, directly and well** — arguably the most mature single module in the whole USG stack — but it does not extend to any of the other four requested categories.

---

## Overall coverage estimate

Tabulating all 37 distinct study types (Obstetric Doppler counted once, cross-referenced between the Obstetric and Doppler sections):

- **EXISTING:** 18 (Whole Abdomen, KUB, Pelvis, Prostate, Early Pregnancy, NT/NB, Anomaly, Growth, BPP, Obstetric Doppler, Cervical Length, Multiple Pregnancy, Thyroid, Breast, Scrotum, Carotid, Arterial, Venous)
- **PARTIAL:** 9 (PVR, Appendix, Ascites, Viability, Dating, TVS, Uterus, Ovaries, Neck)
- **REUSABLE-FROM (generic mechanism, no content yet):** 4 (Soft Tissue, Renal Doppler, Portal Doppler, Hepatic Doppler)
- **MISSING:** 6 (Hernia, Follicular Monitoring, Infertility, MSK-USG, Penile Doppler, AV Fistula Doppler)

**≈31 of 37 (84%)** have at least partial support; **18 of 37 (49%)** have a genuinely usable, dedicated template today. The gaps cluster almost entirely in Gynaecology (2/5 missing, rest thin) and the exotic-vessel end of Doppler (2/9 missing, 3/9 reusable-only).

## Is the template mechanism a good foundation, or does it need redesign?

**Good foundation, worth building on — with one consolidation decision needed first.** The individual mechanisms are sound:

- `usgReportTemplates.ts`'s pattern (fixed `TemplateId` union → `suggestTemplate()` regex router → `switch`-based renderer pulling only `status==="approved"` measurements) is simple, safety-conscious (low-confidence values never auto-inserted), and trivially extensible — adding Renal/Portal/Hepatic/Penile/AV-Fistula Doppler is genuinely "add an ID, add a `switch` case, extend the regex," since `UsgDopplerReporting.tsx` already captures arbitrary named vessels.
- `radiologyMasterTemplates.ts`'s locked-master + clone-to-personal-version + variant/trigger-keyword pattern already generalizes well (used for both MRI and USG) and the generic small-parts/pelvis masters show the intended reuse path for new studies.
- The richest layer — the `seeds/radiology/content-packs/v1/*.yaml` + shared-libraries catalog — is explicitly designed for exactly this kind of expansion (parameter/severity/laterality libraries shared across studies, additive-only versioning, new-study-claims-new-prefix convention) and its own roadmap already names USG Obstetric, Thyroid/Neck, and Scrotum as the next tranche.

The real risk isn't the mechanism, it's that **three parallel systems currently do overlapping work** (the 13-ID `usgReportTemplates.ts`, the 17-entry `radiologyMasterTemplates.ts`, and the not-yet-built rich YAML catalog), plus a fourth bespoke module (`FetalUsgLevel4`) that doesn't talk to either. Before building the ~19 missing/partial study types, decide which layer is authoritative (this audit's read: the YAML catalog is the intended long-term source of truth per the design spec, with `usgReportTemplates.ts` as the interim renderer) — otherwise the new USG Reporting Workspace will become a fifth parallel system rather than completing the existing one.
