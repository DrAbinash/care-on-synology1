# CARE Radiology — Master Clinical Knowledge Catalog (v1)

**Author:** Chief Radiology Knowledge Designer, CARE ERP
**Date:** 2026-07-09
**Status:** Product content specification. No code, no schema, no APIs, no architecture. Engineers will later convert this catalog into seeds/settings for: Quick Select, Parameter Library, Structured Reporting, AI Copilot, Search, Impression Builder, and Analytics.
**Companions:** `RADIOLOGY_WORKSTATION_UX_REVIEW.md` (interaction grammar: tiles, mnemonics, `/macros`, ghost impressions) and `AI_RADIOLOGIST_EXPERIENCE_SPEC.md` (AI surfaces and safety laws). This document supplies the *clinical vocabulary* those systems speak.

**Design intent:** This is a working radiologist's phrasebook, not a textbook. Every entry exists because it is dictated many times a day in an Indian diagnostic center. Optimized for speed, repeatability, and the reporting patterns that cover ~90% of daily volume; the long tail stays free-text.

---

# Part 0 — Catalog conventions and shared libraries

Everything below is defined **once** and reused by every study section. Reuse is the product: one severity ladder, one laterality set, one recommendation library means one muscle memory and clean analytics.

## 0.1 Entry anatomy

Every **finding entry** in this catalog carries up to six attachable elements:

| Element | Meaning |
|---|---|
| **Finding text** | The sentence(s) injected into Findings, with `{parameter}` slots |
| **Parameters** | Slot values from the shared Parameter Library (§0.3) — site, side, size, severity, count… |
| **Impression fragment** | The one-line conclusion the Impression Builder assembles from |
| **Recommendation** | Optional, from the shared Recommendation Library (§0.5) |
| **Criticality tag** | None / Significant / **Critical** (critical triggers the escalation workflow) |
| **Synonyms** | Search/dictation aliases that resolve to this entry |

A **Quick Select tile** = one finding entry with sensible defaults pre-filled. Firing a tile injects finding + impression fragment; parameters are editable inline afterward (tab-through slots). A **combo tile** fires several entries at once (e.g., "Fatty liver Gr I + hepatomegaly").

## 0.2 Keyboard alias grammar

- **Tile mnemonics:** 2–4 characters, unique *within the open study type* (context makes them short). Shown on the tile; fired via the mnemonic overlay or `/mnemonic`.
- **Global macros:** `/name` works everywhere (e.g., `/nad`, `/clincorr`).
- Convention: consonant skeleton of the phrase (`PIVD` → `pv45` for the L4-5 tile), digits for level/grade (`fl2` = fatty liver grade 2). No mnemonic is a prefix of another within the same study.

## 0.3 Shared Parameter Library (reused across all studies)

| Parameter set | Values |
|---|---|
| **Severity (global ladder)** | Mild · Moderate · Severe (+ "Gross" allowed for hydronephrosis/hydrocephalus) |
| **Laterality** | Right · Left · Bilateral · Midline (+ "Bilateral, R>L / L>R") |
| **Size** | mm / cm, 1–3 dimensions; auto-formats ("~6 mm", "2.1 × 1.8 cm") |
| **Count** | Single · Few (2–5) · Multiple · Innumerable |
| **Course/age** | Acute · Subacute · Chronic · Acute-on-chronic · Old/healed |
| **Change vs prior** | New · Stable · Increased · Decreased · Resolved |
| **Margin** | Well-defined · Ill-defined · Spiculated · Lobulated |
| **Echo/density/intensity** | Anechoic/hypo/iso/hyper-echoic · hypo/iso/hyper-dense · T1/T2/FLAIR/DWI signal descriptors |
| **Enhancement** | None · Homogeneous · Heterogeneous · Ring · Nodular · Peripheral |
| **Vertebral levels** | C1–S1 grid; disc spaces C2-3…L5-S1 |
| **Lung zones (CXR)** | Upper/Mid/Lower zone × R/L |
| **Lung lobes (CT)** | RUL · RML · RLL · LUL · Lingula · LLL |
| **Liver segments** | I–VIII (optional; lobe R/L acceptable for USG) |
| **Renal calculus site** | Upper/Mid/Lower calyx · Pelvis · PUJ · Upper/Mid/Distal ureter · VUJ |
| **Breast locator** | Side + quadrant (UOQ/UIQ/LOQ/LIQ/central/retroareolar) + clock position + depth (ant/mid/post) |
| **Venous segments (lower limb)** | CFV · SFJ · FV(SFV) · Popliteal · PTV/peroneal · GSV above/below knee · SSV · SPJ · Perforators (distance from ankle/knee in cm) |
| **Disc morphology** | Bulge (diffuse) · Protrusion · Extrusion · Sequestration; zone: Central · R/L paracentral · R/L foraminal · Extraforaminal |
| **Root involvement** | Abutting · Indenting · Compressing (traversing/exiting root named) |

## 0.4 Shared severity/grading scales (named scales referenced by studies)

Fatty liver Gr I–III · Hydronephrosis mild/mod/gross · Fazekas 1–3 · Modic I–III · Meyerding I–IV · CTR % (CXR) · BI-RADS 0–6 · Breast density a–d · Canal stenosis mild/mod/severe · Prostate grade I–III (by volume 20–40/40–60/>60 g) · CT severity score /25 (HRCT, retained for infective scoring) · PVR significant/insignificant.

## 0.5 Shared Recommendation Library

| Code | Text (practice-editable) |
|---|---|
| `clincorr` | Clinical correlation is suggested. |
| `fup-usg6w` / `fup-3m` / `fup-6m` | Follow-up {USG/imaging} after {6 weeks / 3 / 6 months}. |
| `spec-uro` / `-neuro` / `-nsx` / `-ortho` / `-pulmo` / `-gyn` / `-onc` / `-surg` | {Specialist} consultation is advised. |
| `cect` / `cemri` / `mrcp` / `ctkub` / `hrct` / `mra-mrv` / `cta` | Further evaluation with {study} is suggested. |
| `biopsy` | Histopathological / FNAC correlation is suggested. |
| `lab-lft` / `-rft` / `-urine` / `-sputum` | Correlation with {LFT / RFT / urine routine / sputum AFB-CBNAAT} advised. |
| `physio` | Physiotherapy and analgesics as per treating physician. |
| `urgent` | **Urgent {specialist} attention advised — findings communicated to referring doctor at {time}.** (auto-fills from escalation workflow) |

## 0.6 Critical Findings Registry (escalation-tagged across the catalog)

Acute intracranial hemorrhage (any) · Midline shift ≥ 5 mm · Acute large-territory infarct · Cerebral herniation · Acute DVT (femoro-popliteal) · Tension/large pneumothorax · Massive pleural effusion with shift · Ectopic pregnancy signs / hemoperitoneum · Obstructed infected kidney (pyonephrosis) · Testicular/ovarian torsion signs · BI-RADS 5 · Aggressive/impending cord compression · Aortic aneurysm ≥ 5 cm or dissection flap. *(Registry is practice-editable; each entry links to the `urgent` recommendation and the critical-results workflow.)*

## 0.7 Global normal statements (`/nad` family)

Every study defines one **Normal Study tile** (full normal template, one keystroke) plus **per-region normal lines** used by the completeness engine to fill unaddressed regions *on radiologist confirmation only*. Global macro `/nad`: "No significant abnormality detected."

---

# Part 1 — MRI Brain

**Alias prefix context:** study open = brain; mnemonics below are local.

### 1.1 Categories
Normal & variants · Infarct/ischemia · Small-vessel disease & atrophy · Hemorrhage · Infection/granuloma (NCC, tuberculoma) · Space-occupying lesion · Demyelination · Hydrocephalus/CSF spaces · Sella/pituitary · CP angle/IAC · Sinuses, orbits & incidentals.

### 1.2 Common findings (top daily entries)
| Finding | Key parameters | Criticality |
|---|---|---|
| Acute infarct (DWI restriction) | territory (MCA/ACA/PCA/PICA/watershed/lacunar), side, size | **Critical** if large territory |
| Chronic lacunar infarcts | site, count | — |
| Small-vessel ischemic changes | Fazekas 1–3 | — |
| Diffuse cerebral atrophy | severity, age-appropriateness | — |
| Calcified granuloma (old NCC/tuberculoma) | site, count | — |
| Ring-enhancing lesion (NCC vs tuberculoma workup) | site, size, edema, scolex present/absent | Significant |
| Microbleeds on SWI/GRE | distribution (lobar/deep), count | — |
| Intracranial hemorrhage (site, volume) | site, volume (ABC/2), midline shift | **Critical** |
| Hydrocephalus | severity, obstructive/communicating, Evans index | Significant |
| Extra-axial mass (meningioma pattern) | site, size, dural tail | Significant |
| Intra-axial mass (glioma/mets pattern) | site, size, edema, count | Significant |
| Demyelinating plaques | periventricular/juxtacortical/infratentorial, count | Significant |
| Mucosal thickening PNS · Empty sella · Arachnoid cyst · Mega cisterna magna | site/size | — |

### 1.3 Reusable parameters
Vascular territory · lobe/deep-structure site list · course (acute/subacute/chronic) · enhancement · perilesional edema (none/mild/marked) · mass effect (none/effacement/midline shift mm) · Fazekas · Evans index.

### 1.4 Severity options
Global ladder + Fazekas 1–3 (SVID) + atrophy (mild/mod/severe; "appropriate for age") + hydrocephalus (mild/mod/gross) + midline shift (mm, **≥5 mm auto-tags critical**).

### 1.5 Laterality/location
Global laterality + lobes (frontal/parietal/temporal/occipital/cerebellar/brainstem) + deep sites (basal ganglia, thalamus, corona radiata, centrum semiovale, periventricular WM) + territories.

### 1.6 Measurement fields
Lesion size (3D) · midline shift mm · Evans index (auto-calc) · third-ventricle width · hematoma volume ABC/2 (auto-calc) · sella dimensions · pituitary height.

### 1.7 Impression phrases
- "No acute infarct, hemorrhage, mass lesion or abnormal enhancement." *(normal)*
- "Acute infarct in the {side} {territory} territory."
- "Chronic small-vessel ischemic changes (Fazekas {grade}) with age-appropriate cerebral atrophy."
- "{Count} calcified granuloma(s) — sequelae of old neurocysticercosis/tuberculoma; no perilesional edema."
- "Ring-enhancing lesion {site} with perilesional edema — neurocysticercosis vs tuberculoma; suggested workup as below."
- "Communicating hydrocephalus, {severity}."
- "Extra-axial dural-based mass {site} — likely meningioma."

### 1.8 Recommendations
`cemri` (if plain) · `mra-mrv` (infarct/venous) · `spec-neuro` / `spec-nsx` · `fup-3m` (granuloma with edema) · `urgent` (critical registry) · CSF/clinical workup line for demyelination.

### 1.9 Synonyms/abbreviations
SVID = small-vessel ischemic disease/changes · SOL = space-occupying lesion · NCC = neurocysticercosis · lacune = lacunar infarct · "blooming" = SWI/GRE susceptibility · PVWM = periventricular white matter · E/O = evidence of · MLS = midline shift.

### 1.10 Quick Select button groups
**Row 1 (pinned):** `nb` Normal brain · `svi` SVID+atrophy combo · `ain` Acute infarct · `gran` Calcified granuloma · `nad-pns` PNS clear.
**Groups:** Infarct (acute/lacunar/chronic/territory grid) · SVID & Atrophy · Granuloma/Infection (calcified/ring-enhancing/tuberculoma) · Hemorrhage (ICH/SDH/SAH sites) · SOL (extra-axial/intra-axial/mets) · CSF (hydrocephalus/atrophy/cysts) · Incidentals (sinusitis, empty sella, mega cisterna).

### 1.11 Keyboard aliases
`nb` normal brain · `ain` acute infarct · `lac` lacunar · `svi` SVID combo · `f1/f2/f3` Fazekas · `gran` granuloma · `rel` ring-enhancing lesion · `hcp` hydrocephalus · `ich` hemorrhage · `men` meningioma pattern · `dem` demyelination · `pns` sinusitis · `atr` atrophy.

### 1.12 AI assistance opportunities
Territory inference from dictated site ("left corona radiata" → suggests MCA-perforator territory) · Fazekas suggestion from WM description · ABC/2 and Evans auto-calc with interpretation ghost · critical escalation on hemorrhage/large infarct sentences · NCC-vs-tuberculoma differential card with discriminators · prior-lesion count delta ("granulomas: 3 → 3, stable").

---

# Part 2 — MRI Lumbosacral (LS) Spine

**Reuse note:** disc morphology, zones, root involvement, Modic, listhesis parameters here are the **shared spine set** — Part 3 (cervical) reuses them wholesale.

### 2.1 Categories
Normal · Alignment & curvature · Per-level disc pathology (L1-2 → L5-S1) · Canal & foraminal stenosis · Listhesis & pars · Facets/ligamentum flavum · Vertebral marrow (Modic, hemangioma, collapse) · Cord/conus/roots · Paraspinal & SI joints · Incidentals (Tarlov, renal, uterine).

### 2.2 Common findings
| Finding | Parameters | Notes |
|---|---|---|
| Lumbar spondylosis / early degenerative changes | — | The daily workhorse header |
| Straightening/loss of lumbar lordosis | ± muscle spasm | |
| Disc desiccation | level(s) | |
| Diffuse disc bulge | level, thecal indentation | |
| Disc protrusion/extrusion (**PIVD**) | level, morphology, zone, root involvement | Core entry |
| Annular fissure | level | |
| Canal stenosis | level, severity, AP diameter | |
| Neural foraminal narrowing | level, side, severity | |
| Ligamentum flavum thickening / facet arthropathy | level(s) | |
| Spondylolisthesis | level, Meyerding grade, ± lysis | |
| Modic end-plate changes | level, type I–III | |
| Vertebral hemangioma / Schmorl's nodes / Tarlov cyst | site, size | Incidentals |
| Vertebral collapse | level, acute vs chronic, marrow signal | Significant |

### 2.3 Reusable parameters
Shared spine set: level grid · disc morphology · zone · root involvement (traversing/exiting root auto-named from level) · Modic type · Meyerding grade · canal AP diameter.

### 2.4 Severity options
Canal stenosis mild/mod/severe · foraminal narrowing mild/mod/severe (per side) · Meyerding I–IV · thecal indentation vs compression.

### 2.5 Laterality/location
Central · R/L paracentral · R/L foraminal · extraforaminal; levels L1-2…L5-S1; roots L1–S1.

### 2.6 Measurement fields
Canal AP diameter per level (mm) · herniation size (mm) · listhesis translation (mm → auto Meyerding) · conus level (normal at/above L1-2).

### 2.7 Impression phrases
- "Straightening of lumbar lordosis with early lumbar spondylosis. No significant disc herniation or canal stenosis." *(near-normal)*
- "Lumbar spondylosis with {level} {morphology} ({zone}) causing {severity} canal stenosis and {side} neural foraminal narrowing, {root involvement} the {root} nerve root(s)."
- "Grade {n} spondylolisthesis of {vertebra} over {vertebra} with bilateral pars defects."
- "Multi-level degenerative disc disease, worst at {level} as detailed above."

### 2.8 Recommendations
`spec-ortho` / `spec-nsx` (severe stenosis/compression) · `physio` · `clincorr` (correlate with radicular symptoms/side) · screening whole-spine MRI (multi-level disease) · DEXA correlation (osteoporotic collapse).

### 2.9 Synonyms/abbreviations
**PIVD** = prolapsed intervertebral disc (dominant Indian term; maps to protrusion/extrusion entries) · DDD = degenerative disc disease · LSS = lumbar canal stenosis · LFH = ligamentum flavum hypertrophy · listhesis · "disc-osteophyte complex."

### 2.10 Quick Select button groups
**The Level × Morphology grid** (signature tile group): rows L1-2…L5-S1 × columns Bulge / Protrusion / Extrusion — one tap = level-tagged finding with zone/severity slots. **Other groups:** Normal & alignment · Stenosis (canal/foraminal per level) · Listhesis · Marrow (Modic/hemangioma/collapse) · Incidentals.
**Pinned:** `nls` normal study · `spond` spondylosis header · `pv45` L4-5 protrusion · `pv5s1` L5-S1 protrusion · `lith` listhesis.

### 2.11 Keyboard aliases
`nls` normal LS · `spond` spondylosis · `strl` straightened lordosis · `db{level}` bulge (e.g., `db45`) · `pv{level}` protrusion · `ex{level}` extrusion · `cs{level}` canal stenosis · `fn{level}` foraminal narrowing · `lith{level}` listhesis · `mod1/2/3` Modic · `hem` hemangioma · `tar` Tarlov.

### 2.12 AI assistance opportunities
**Per-level table auto-assembly** from free dictation (structured shadow) · root-consistency lint (L4-5 paracentral → traversing L5; flags mismatch with dictated root) · impression auto-ordering worst-level-first · severity suggestion from AP diameter · symptom-side vs finding-side consistency check against the indication.

---

# Part 3 — MRI Cervical Spine

**Reuses the shared spine set from Part 2** (levels C2-3…C7-T1). Only cervical-specific content listed.

### 3.1 Categories
Normal · Alignment (straightening/reversal of cervical lordosis) · Per-level disc-osteophyte disease · Canal stenosis & **cord signal** · Uncovertebral/facet arthropathy · Foraminal narrowing · Craniovertebral junction · Marrow · Incidentals (thyroid, retropharynx).

### 3.2 Common findings
Cervical spondylosis · straightened/reversed lordosis (± spasm) · disc desiccation · **disc-osteophyte complex** {level} indenting the thecal sac / cord · protrusion/extrusion per level (C5-6 and C6-7 dominate) · uncovertebral arthropathy with foraminal narrowing · canal stenosis with cord compression · **cord signal change/myelomalacia** {level} (Significant) · ossified posterior longitudinal ligament (OPLL) · atlantoaxial interval widening (Significant).

### 3.3–3.5 Parameters / severity / laterality
Shared spine set; add: cord involvement ladder — *indenting thecal sac → abutting cord → indenting cord → compressing cord with signal change* (this 4-step ladder is the cervical severity spine of the report). Levels C2-3…C7-T1.

### 3.6 Measurement fields
Canal AP diameter per level · cord AP diameter at maximal compression · disc herniation mm · ADI (atlantodental interval).

### 3.7 Impression phrases
- "Straightening of cervical lordosis with early cervical spondylosis. No cord compression or myelopathy signal." *(near-normal)*
- "Cervical spondylosis with {level} disc-osteophyte complex {cord ladder step}, with {severity} canal stenosis."
- "{Level} cord signal change consistent with compressive myelopathy — surgical opinion advised."

### 3.8 Recommendations
`spec-ortho`/`spec-nsx` (cord compression/myelopathy → paired with urgent tone) · `physio` (cervical spondylosis, collar advice per physician) · flexion-extension views (instability/ADI).

### 3.9 Synonyms
Cervical PIVD · DOC = disc-osteophyte complex · UV arthropathy = uncovertebral · myelomalacia = cord gliosis/signal change · CVJ.

### 3.10 Quick Select groups
Level × Morphology grid (C2-3…C7-T1) · Cord ladder tiles (4 steps, level-tagged) · Alignment · Foramina/UV · Pinned: `ncs` normal cervical · `cspond` · `doc56`, `doc67` · `cord` signal change.

### 3.11 Keyboard aliases
`ncs` normal · `cspond` · `strc` straightened lordosis · `doc{level}` (e.g., `doc56`) · `cpv{level}` protrusion · `ccs{level}` canal stenosis · `myl{level}` myelomalacia · `uv{level}` uncovertebral · `opll`.

### 3.12 AI assistance
Cord-ladder step suggestion from dictated description · myelopathy sentence → auto-suggest surgical-opinion recommendation · same per-level table assembly and root-consistency lint as LS (C5-6 → C6 root) · prior comparison of cord signal extent.

---

# Part 4 — CT Brain (NCCT Head)

The trauma/stroke workhorse; speed and critical-escalation matter most here.

### 4.1 Categories
Normal · Hemorrhage (ICH/IVH/SDH/EDH/SAH) · Infarct/hypodensity · Trauma (fractures, contusions, pneumocephalus) · Mass effect & herniation · Hydrocephalus & atrophy · Calcifications/granulomas · Sinuses, mastoids, orbits & bones.

### 4.2 Common findings
| Finding | Parameters | Criticality |
|---|---|---|
| Normal NCCT (trauma-negative read) | — | — |
| Acute intraparenchymal hemorrhage | site, volume ABC/2, IVH extension, MLS | **Critical** |
| Acute SDH / EDH | side, site, max thickness mm, MLS | **Critical** |
| Chronic SDH / acute-on-chronic | side, thickness, MLS | Significant→Critical |
| SAH (sulcal/basal cisterns) | distribution | **Critical** |
| Hemorrhagic contusions | site(s), count | **Critical** |
| Undisplaced/depressed skull fracture | bone, depression depth | Significant |
| Acute infarct hypodensity ± dense-vessel sign | territory, extent | **Critical** if large |
| Chronic infarct/gliosis · lacunes | site | — |
| Diffuse cerebral edema (effaced sulci/cisterns) | — | **Critical** |
| Midline shift | mm, direction | **Critical ≥5 mm** |
| Hydrocephalus · atrophy · calcified granuloma · sinusitis/mastoiditis | standard | — |

### 4.3–4.5 Parameters / severity / laterality
Site list & territories shared with MRI Brain (Part 1). Severity anchored on **numbers**: hematoma volume, thickness (mm), MLS (mm), cistern status (open/effaced). Laterality global.

### 4.6 Measurement fields
Hematoma volume ABC/2 (auto-calc) · SDH/EDH max thickness · MLS · ventricle indices · depression depth.

### 4.7 Impression phrases
- "No evidence of intracranial hemorrhage, mass effect or midline shift. No fracture of the skull vault." *(the trauma-negative line)*
- "Acute {side} {site} {SDH/EDH} of max thickness {mm} with {mm} midline shift — **neurosurgical emergency; findings communicated.**"
- "Acute intraparenchymal hemorrhage {site}, volume ~{ml} ml, with {IVH extension / mass effect as above}."
- "Hypodensity in {territory} territory consistent with acute/subacute infarct — MRI with DWI suggested if clinically indicated."
- "Age-related cerebral atrophy with chronic small-vessel changes. No acute abnormality."

### 4.8 Recommendations
`urgent` + `spec-nsx` (critical registry) · repeat NCCT in 24 h / after clinical change (contusion, thin SDH) · `cemri` + DWI (suspected early infarct) · `cta` (SAH → aneurysm workup) · `clincorr`.

### 4.9 Synonyms
NCCT = plain CT head · SDH/EDH/SAH/IVH · MLS = midline shift · dense MCA sign · "hyperdense" = acute blood · contre-coup · #\ = fracture (search maps "fracture", "#").

### 4.10 Quick Select groups
**Pinned:** `nct` trauma-negative normal · `sdh` · `ich` · `inf` acute infarct · `mls` midline shift.
Groups: Hemorrhage grid (type × site) · Trauma (fracture/contusion/pneumocephalus) · Infarct (acute/chronic/lacunar) · Pressure (edema/MLS/herniation/hydrocephalus) · Incidentals.

### 4.11 Keyboard aliases
`nct` normal · `ich` · `sdh` / `edh` / `sah` / `ivh` · `con` contusions · `fx` fracture · `inf` acute infarct · `cinf` chronic · `mls` · `hcp` · `atr` · `gran` · `mast` mastoiditis.

### 4.12 AI assistance
ABC/2 auto-volume with severity ghost · **instant critical escalation** on hemorrhage/MLS sentences (the highest-value escalation in the product) · dense-vessel + hypodensity pattern → "consider stroke workflow" card · 24-h-repeat recommendation pairing for contusions/thin SDH · trauma checklist completeness (vault, base, facial bones, C1-2 if included).

---

# Part 5 — USG Whole Abdomen

The highest-volume study in Indian centers. Organized strictly **organ-by-organ** — the report *is* the checklist.

### 5.1 Categories (= organ checklist)
Liver · Gallbladder & CBD · Pancreas · Spleen · Kidneys (R/L) · Ureters · Urinary bladder · Prostate / Uterus & adnexa · Free fluid, nodes & bowel · Impression.

### 5.2 Common findings
| Organ | Daily entries |
|---|---|
| Liver | **Fatty liver Gr I/II/III** · hepatomegaly (span) · coarse echotexture (CLD pattern) · simple cyst · hemangioma pattern · focal lesion (workup) |
| GB/CBD | Cholelithiasis (single/multiple, size) · GB sludge · wall thickening (acute chole pattern ± Murphy's) · polyp (size) · contracted GB · CBD dilation (mm) · post-cholecystectomy status |
| Pancreas | Normal/obscured by gas (honest-limitation line) · bulky/edematous · calcifications (chronic pancreatitis) |
| Spleen | Splenomegaly (span) · accessory spleen |
| Kidneys | Renal calculus (site set §0.3, size) · **hydronephrosis mild/mod/gross** ± hydroureter · cortical cyst (simple) · raised echogenicity with maintained/lost CMD (medical renal disease Gr I–III) · contracted kidney · PCKD pattern · duplex/ectopic/absent |
| Bladder | Wall thickening (cystitis pattern) · VUJ calculus · diverticulum · significant PVR |
| Prostate | Prostatomegaly grade I–III with volume (g) ± median lobe · significant PVR |
| Uterus/adnexa | Bulky uterus · fibroid(s) (site: submucosal/intramural/subserosal, size) · ET (mm) · simple ovarian cyst · hemorrhagic cyst · PCO morphology · free fluid in POD |
| General | Ascites (mild/mod/gross) · mesenteric nodes · appendix (probe tenderness, diameter) — **appendicitis = Significant** |

### 5.3 Reusable parameters
Organ span/size · echotexture · calculus site+size · CMD preserved/lost · PVR ml · fibroid site ladder · cyst descriptors (simple/complex).

### 5.4 Severity options
Fatty liver Gr I–III · hydronephrosis mild/mod/gross · medical renal disease Gr I–III · prostatomegaly Gr I–III · ascites mild/mod/gross.

### 5.5 Laterality/location
Global laterality per kidney/ovary/adnexa · calculus site set · liver lobe/segment · fibroid position.

### 5.6 Measurement fields (the USG numbers block)
Liver span · spleen span · both kidneys (length × width, cortical thickness) · CBD · portal vein · GB wall · aorta · prostate volume (auto from 3D) + PVR (pre/post void, auto %) · uterus 3D + ET · ovarian volumes · follicle sizes · calculus mm · appendix diameter.

### 5.7 Impression phrases
- "Grade {I/II/III} fatty liver. Rest of the visualized abdominal organs are unremarkable." *(the single most-used line in the product)*
- "Cholelithiasis ({count}, largest {mm}). No sonographic evidence of cholecystitis."
- "{Side} {site} calculus ({mm}) with {severity} hydro(uretero)nephrosis."
- "Bilateral medical renal disease, Grade {n} — correlate with RFT."
- "Prostatomegaly, Grade {n} (~{g} g) with {significant/insignificant} post-void residue."
- "Bulky uterus with {count} intramural fibroid(s), largest {size} — suggest GYN correlation."
- "No significant abnormality detected in the visualized abdominal organs." *(normal study)*

### 5.8 Recommendations
`lab-lft` (fatty liver) · `lab-rft` (renal disease) · `spec-uro` + `ctkub` (obstructive calculus) · `spec-surg` (acute chole/appendicitis, pair `urgent` if hot) · `spec-gyn` · `fup-usg6w` (hemorrhagic cyst) · `mrcp` (CBD dilation unexplained) · triphasic CT/CEMRI (focal liver lesion).

### 5.9 Synonyms
USG = ultrasound · FL = fatty liver · HM/SM = hepato/splenomegaly · CMD = corticomedullary differentiation · PVR = post-void residue · POD = pouch of Douglas · ET = endometrial thickness · PCO(S) · MRD = medical renal disease · KUB · GB · "calculus/stone" both searchable.

### 5.10 Quick Select button groups
Tabs mirror the organ checklist; each organ tab has its normal line + top entries. **Pinned combo tiles:** `fl1`/`fl2`/`fl3` (fatty liver grade + rest-normal impression) · `nab` full normal abdomen · `chole` gallstones · `rcal` renal calculus (side/site/size slots) · `pros2` prostatomegaly Gr II + PVR.

### 5.11 Keyboard aliases
`nab` normal abdomen · `fl1/2/3` · `hm` hepatomegaly · `sm` splenomegaly · `chole` · `gbwt` GB wall thickening · `cbd` CBD dilation · `rcal` / `lcal` renal calculus R/L · `hn1/2/3` hydronephrosis mild/mod/gross · `mrd1/2/3` · `cyst` renal cyst · `pros1/2/3` · `fib` fibroid · `ova` ovarian cyst · `asc` ascites · `app` appendicitis.

### 5.12 AI assistance
**Organ-checklist completeness** (gutter mark per unaddressed organ; confirm-to-fill normal lines) · size-vs-age/sex interpretation on every measurement (spans, kidney lengths, ET vs menstrual phase from indication) · grade suggestion (fatty liver from echo description, MRD from CMD text) · auto-pairing of finding→recommendation (calculus → uro/CT KUB) · PVR percentage auto-calc with significance ghost.

---

# Part 6 — USG KUB

Focused subset of Part 5 — **reuses kidney/ureter/bladder/prostate entries wholesale**; exists as its own study because it's ordered constantly for renal colic.

### 6.1 Categories
Kidneys R/L · Ureters · Bladder · Prostate (males >40 / if requested) · Free fluid.

### 6.2 Common findings
All renal/bladder/prostate entries from §5.2, plus KUB-specific: **hydroureteronephrosis with level of obstruction** · VUJ calculus (with bladder well distended note) · ureteric calculus with proximal HUN · perinephric fluid (Significant — forniceal rupture pattern) · pyonephrosis pattern (internal echoes in dilated PCS — **Critical**) · bladder debris/cystitis · bilateral renal calculi (statuses per side).

### 6.3–6.6 Parameters / severity / laterality / measurements
As Part 5 renal set. Extra: obstruction level (PUJ/upper/mid/VUJ) · bladder distension adequacy (limitation line if poor) · stone-free vs residual (post-treatment follow-ups).

### 6.7 Impression phrases
- "No calculus or hydronephrosis in either kidney. Bladder and visualized ureters unremarkable." *(normal KUB)*
- "{Side} {site} ureteric calculus ({mm}) with {severity} proximal hydroureteronephrosis."
- "Bilateral renal calculi as detailed, without hydronephrosis — urology follow-up advised."
- "Dilated {side} PCS with internal echoes — ?pyonephrosis. **Urgent urology referral; findings communicated.**"

### 6.8 Recommendations
`spec-uro` · `ctkub` (radiolucent suspicion / surgical planning) · `lab-urine` + `lab-rft` · hydration + strain-urine note per physician · `fup-usg6w` post-lithotripsy · `urgent` (pyonephrosis/obstructed infected kidney).

### 6.9 Synonyms
HUN = hydroureteronephrosis · PCS = pelvicalyceal system · VUJ/PUJ · DJ stent (in-situ status entry) · "renal colic screen."

### 6.10 Quick Select groups
Side-by-side R/L kidney columns with identical tiles (calculus/HN/cyst/MRD) · Ureter level strip · Bladder · Pinned: `nkub` · `rvuj`/`lvuj` VUJ calculus · `hun` · `djs` DJ stent in situ.

### 6.11 Keyboard aliases
`nkub` normal · `rcal`/`lcal` · `hun` (+side/grade slots) · `rvuj`/`lvuj` · `puj` · `pyo` pyonephrosis · `djs` stent in situ · `pvr`.

### 6.12 AI assistance
Obstruction-level inference (calculus site → expected HUN pattern; flags mismatch) · post-treatment comparison ghost ("6 mm VUJ calculus in prior — not seen today; stone passed?") · pyonephrosis criticality escalation · auto-suggest CT KUB when symptoms + negative USG (from indication).

---

# Part 7 — Doppler Lower Limb

Two distinct daily studies sharing one segment map: **Venous (DVT / varicose veins)** and **Arterial**.

### 7.1 Categories
Venous–DVT (compressibility per segment) · Venous–insufficiency (reflux mapping) · Perforators · Arterial (waveforms, stenosis, ABI) · Soft tissue (Baker's cyst, edema, collection).

### 7.2 Common findings
| Sub-study | Entries |
|---|---|
| DVT | Non-compressible {segment} with echogenic thrombus (acute) — **Critical (femoro-popliteal)** · partially recanalized/chronic thrombus with wall thickening · calf-vein DVT (Significant) · normal compressible study |
| Varicose | SFJ incompetence with GSV reflux ({duration}s, {diameter} mm) · SPJ/SSV incompetence · incompetent perforator(s) at {cm} from ankle/knee ({mm}) · dilated tortuous superficial varicosities · post-EVLT/surgery status |
| Arterial | Triphasic flow all segments (normal) · monophasic/biphasic {segment} · plaque with {%} stenosis ({segment}) · occlusion {segment} with distal collaterals · ABI {value} per side |
| Soft tissue | Baker's cyst (size, ruptured?) · subcutaneous edema/cellulitis pattern · collection |

### 7.3 Reusable parameters
Venous segment set (§0.3) · reflux duration (s; >0.5 s superficial, >1.0 s deep = significant) · vein diameter · thrombus age (acute/subacute/chronic) · waveform (tri/bi/monophasic) · stenosis % · ABI (auto-interpret: normal ≥0.9, claudication 0.5–0.9, critical <0.5).

### 7.4 Severity options
DVT extent (segments involved, proximal vs calf) · reflux significant/gross · stenosis <50 / 50–70 / >70 / occlusion · ABI bands.

### 7.5 Laterality/location
Side mandatory on every entry · segment sets · perforator distance in cm.

### 7.6 Measurement fields
Vein diameters (SFJ, GSV thigh/knee/calf, SSV) · reflux durations per site · perforator size+location · PSV per arterial station + ratios · ABI both sides (auto-calc from pressures).

### 7.7 Impression phrases
- "No evidence of deep venous thrombosis in the {side} lower limb. Normal phasic flow with augmentation." *(normal DVT screen)*
- "**Acute DVT involving {segments} of the {side} lower limb — urgent physician attention; findings communicated.**"
- "{Side} SFJ incompetence with significant GSV reflux ({s} s) and incompetent perforators at {cm} — surgical/vascular opinion advised."
- "Normal triphasic arterial flow in the {side} lower limb. ABI {value}."
- "Significant ({%}) stenosis of {segment} with monophasic distal flow — vascular surgery referral advised."

### 7.8 Recommendations
`urgent` + physician/vascular (acute proximal DVT) · `spec-surg`/vascular (varicose surgical mapping, critical ischemia) · compression stockings/limb elevation per physician · CT/MR angiography (arterial planning) · repeat Doppler after anticoagulation.

### 7.9 Synonyms
DVT · SFJ/SPJ · GSV/SSV (long/short saphenous) · SFV = femoral vein (legacy term searchable) · ABI = ankle-brachial index · EVLT · "varicose mapping."

### 7.10 Quick Select groups
**Segment map tiles** (visual limb diagram doubling as buttons — tap segment, pick state: normal/thrombus/reflux) · DVT column · Varicose column (SFJ/GSV/SSV/perforator) · Arterial column (waveform per station) · Pinned: `ndvt` normal venous · `dvt` acute DVT · `sfji` SFJ incompetence · `nart` normal arterial.

### 7.11 Keyboard aliases
`ndvt` · `dvt` (+segment slots) · `cdvt` chronic · `sfji` / `spji` · `gsvr` GSV reflux · `perf` perforator · `nart` · `mono` monophasic · `sten` stenosis · `abi` · `baker` Baker's cyst.

### 7.12 AI assistance
Segment-map auto-fill from dictation ("CFV and fem vein non-compressible" → map paints red, sentence assembles) · proximal-DVT critical escalation · reflux-duration significance ghost · ABI auto-calc + band interpretation · post-anticoagulation comparison ("thrombus now partially recanalized vs 12-Jun study").

---

# Part 8 — Mammography

The most **structured** study: BI-RADS discipline is built into the content itself.

### 8.1 Categories
Breast composition (a–d) · Masses · Calcifications · Asymmetries · Architectural distortion · Associated features (skin/nipple/trabecular) · Axilla · Comparison with priors · **BI-RADS assessment + management (paired, inseparable)**.

### 8.2 Common findings
Well-circumscribed equal-density mass (fibroadenoma pattern) · obscured/indistinct/spiculated-margin mass · typically benign calcifications (vascular, coarse "popcorn", rim, milk-of-calcium, dystrophic) · suspicious calcifications (amorphous/fine pleomorphic/fine linear-branching) with distribution (grouped/linear/segmental/regional) · focal/global asymmetry · developing asymmetry · architectural distortion · skin thickening/retraction · nipple retraction · axillary node (normal fatty hilum vs dense/rounded) · post-surgical scar (stable) · benign intramammary node.

### 8.3 Reusable parameters
Breast locator (§0.3: side+quadrant+clock+depth) · mass descriptors (shape oval/round/irregular; margin circumscribed→spiculated ladder; density) · calcification morphology+distribution · composition a–d · change vs prior.

### 8.4 Severity options
**BI-RADS 0–6 is the severity scale.** Margin/morphology ladders order benign→suspicious. Density a–d qualifies sensitivity (auto-adds "dense breast limits sensitivity; USG correlation advised" for c/d).

### 8.5 Laterality/location
Breast locator mandatory on every finding; bilateral handling (each breast assessed separately; **overall BI-RADS = worst side**).

### 8.6 Measurement fields
Mass size (2D) · distance from nipple · calcification-cluster extent · node cortical thickness · comparison delta vs prior (auto).

### 8.7 Impression phrases (locked to management)
- "BI-RADS 1 — Negative. Routine screening as per age." / "BI-RADS 2 — Benign findings ({named}). Routine screening."
- "BI-RADS 3 — Probably benign {finding}. Short-interval follow-up mammogram in 6 months advised."
- "BI-RADS 4{a/b/c} — Suspicious {finding} at {locator}. **Tissue diagnosis (biopsy) recommended.**"
- "BI-RADS 5 — Highly suggestive of malignancy. **Biopsy and breast surgery/oncology referral advised; findings communicated.**" *(Critical)*
- "BI-RADS 0 — Incomplete. Additional views/USG correlation required before final assessment."
- Dense-breast rider auto-appends for composition c/d.

### 8.8 Recommendations
Bound to BI-RADS (above) — the pairing is enforced, not optional: `fup-6m` (3) · `biopsy` (4/5) · `spec-onc`/breast surgeon (5) · USG correlation (0, dense breasts, palpable lump) · comparison-view retrieval note when priors unavailable.

### 8.9 Synonyms
MMG = mammogram/mammography · FA = fibroadenoma pattern · UOQ/UIQ/LOQ/LIQ · "microcalcs" · CC/MLO views · "lump" (maps to palpable-area annotation) · ACR density.

### 8.10 Quick Select groups
Composition strip (a–d, one mandatory) · Mass builder (shape→margin→density→locator slot-chain) · Calcification builder (morphology→distribution) · Benign library (typically-benign one-tappers) · **BI-RADS bar** (0–6; tapping injects assessment + bound management) · Pinned: `b1` `b2` `mmn` bilateral normal.

### 8.11 Keyboard aliases
`mmn` normal both breasts · `da/db/dc/dd` composition · `fa` fibroadenoma-pattern mass · `spic` spiculated mass · `bcal` benign calcs · `scal` suspicious calcs · `asym` · `dist` distortion · `b0`–`b6` BI-RADS (with `b4a/b/c`) · `axn` axillary node.

### 8.12 AI assistance
**Descriptor↔BI-RADS consistency gate** (spiculated margin + BI-RADS 2 = blocking lint) · management-pairing enforcement (BI-RADS without its bound recommendation cannot sign) · prior-comparison delta on mass size/new calcifications · dense-breast rider automation · laterality lint against clinical side ("lump right" in indication vs left-only findings → flag) · BI-RADS 5 critical escalation.

---

# Part 9 — Chest X-ray

Highest throughput, shortest report — the catalog optimizes for the **two-line read**.

### 9.1 Categories
Normal · Lung fields (by zone) · TB & sequelae · Pleura · Heart & mediastinum · Hila · Diaphragm & subdiaphragm · Bones & soft tissue · Tubes/lines (portable/ICU).

### 9.2 Common findings
| Group | Entries |
|---|---|
| Normal | "Lung fields are clear. CP angles free. Cardiac size normal." |
| Infective | Consolidation {zone(s)} · patchy infiltrates · air-bronchogram note |
| TB (Indian staple) | Fibrocalcific changes {upper zone(s)} — **old healed Koch's** · active Koch's pattern (upper-zone infiltrates ± cavity) · miliary pattern (**Significant**) · pleural thickening/calcification |
| Pleura | Effusion (mild/mod/massive; blunted CP angle as minimal marker) · pneumothorax ({%}/complete; tension signs = **Critical**) · hydropneumothorax |
| Cardiac | Cardiomegaly (CTR %) · pulmonary venous congestion/edema pattern |
| Airways | Hyperinflated fields (COPD pattern) · prominent bronchovascular markings |
| Mass/nodule | Nodule/mass {zone, size} (**Significant**) · cavity {zone} · hilar prominence/lymphadenopathy |
| Bones/other | Rib fracture(s) · scoliosis · elevated hemidiaphragm · free gas under diaphragm (**Critical**) · ET tube/CV line/ICD position (ICU set) |

### 9.3 Reusable parameters
Zone set (§0.3) · CTR (auto from two measurements) · effusion severity · pattern descriptors (reticular/nodular/miliary/patchy).

### 9.4 Severity options
Effusion mild/mod/massive · pneumothorax partial/complete/tension · cardiomegaly by CTR (>0.5 PA) · "extensive vs patchy" for infiltrates.

### 9.5 Laterality/location
Zone × side grid on every parenchymal finding; CP angle R/L; hemidiaphragm R/L.

### 9.6 Measurement fields
CTR (auto-calc + interpretation) · effusion height (if measured) · nodule/mass size · ICD/tube tip position note.

### 9.7 Impression phrases
- "No significant abnormality detected." *(the daily #1)*
- "{Zone} consolidation — infective etiology likely; suggest clinical correlation and follow-up X-ray after treatment."
- "Fibrocalcific changes in {zone(s)} — sequelae of old healed Koch's. No active lesion seen."
- "Upper-zone infiltrates with cavitation — active Koch's to be excluded; sputum CBNAAT advised."
- "{Side} pleural effusion, {severity}." / "**{Side} pneumothorax — urgent attention; findings communicated.**"
- "Cardiomegaly (CTR {value}). Suggest echocardiographic correlation."
- "{Size} nodule/mass {zone} — HRCT chest advised for characterization."
- "Free gas under the right hemidiaphragm — **surgical emergency; findings communicated.**"

### 9.8 Recommendations
`lab-sputum` (CBNAAT/AFB — active TB pattern) · `hrct` (nodule/mass/equivocal) · follow-up CXR after 2 weeks of treatment · echo correlation (cardiomegaly) · lateral view / expiratory film · `urgent` (tension pneumothorax, free gas, massive effusion).

### 9.9 Synonyms
CXR PA · **Koch's = pulmonary TB** (search must map both ways) · NAD · CP angle · CTR · PTX = pneumothorax · "haziness/opacity" → infiltrate/consolidation entries · COPD/hyperinflation · ICD = intercostal drain.

### 9.10 Quick Select groups
**Pinned:** `nadx` normal CXR · `kochs` old-healed combo · `cons` consolidation (zone slots) · `eff` effusion · `cmg` cardiomegaly.
Groups: Zone grid (tap zone → pick pattern) · TB set (old/active/miliary/pleural) · Pleura · Cardiac · ICU/portable set (tubes/lines with position ladder).

### 9.11 Keyboard aliases
`nadx` normal · `cons{zone}` (e.g., `consrl` right-lower) · `kochs` old-healed · `aktb` active pattern · `mil` miliary · `eff` (+side/severity) · `ptx` pneumothorax · `cmg` cardiomegaly · `hyp` hyperinflation · `nod` nodule · `gas` free gas · `ribfx`.

### 9.12 AI assistance
CTR auto-calc + cardiomegaly ghost · zone completeness (both apices, both CP angles addressed) · TB-pattern → CBNAAT recommendation pairing · pneumothorax/free-gas critical escalation · prior-film comparison ("consolidation resolving vs 22-Jun film") · ICU line-position lint (tip descriptors vs expected landmarks).

---

# Part 10 — HRCT Chest

Pattern-first reporting: the catalog's job is to turn *pattern + distribution* into differential and recommendation quickly.

### 10.1 Categories
Normal · Infective (incl. TB spectrum) · Pattern library (GGO/consolidation/nodules/tree-in-bud/mosaic/crazy-paving) · Fibrosing ILD (UIP/NSIP probable) · Airways (bronchiectasis, bronchiolitis) · Nodule/Mass (Fleischner track) · Cavitary disease · Pleura · Mediastinum & nodes · Severity scoring.

### 10.2 Common findings
| Group | Entries |
|---|---|
| Infective/TB | Centrilobular nodules with **tree-in-bud** {lobe(s)} (active infective/Koch's) · consolidation ± breakdown/cavity · miliary (random micronodules) — **Significant** · fibrocalcific + traction changes (sequelae) · lymphadenopathy ± necrotic centers |
| GGO family | GGO {lobes, %} · crazy-paving · organizing-pneumonia pattern (peripheral consolidation) |
| Fibrosis | Subpleural basal reticulation + honeycombing + traction bronchiectasis (**UIP pattern**) · GGO-predominant with subpleural sparing (**NSIP pattern**) · extent % |
| Airways | Bronchiectasis (cylindrical/varicose/cystic; lobes) ± mucus plugging · mosaic attenuation/air-trapping |
| Nodule/Mass | Solid nodule {size, lobe} (Fleischner slot) · part-solid/GGN · spiculated mass ± nodes (**Significant**) · cavitary lesion (wall thin/thick) |
| Pleura/other | Effusion (HU note) · pneumothorax · pericardial effusion · emphysema (centrilobular/paraseptal, extent) |
| Score | CT severity score {n}/25 (infective, lobe-wise) |

### 10.3 Reusable parameters
Lobe set · pattern descriptors · distribution (upper/lower, central/peripheral, subpleural/peribronchovascular) · nodule character (solid/part-solid/GGN) · node short-axis + necrosis flag · extent %.

### 10.4 Severity options
Extent (mild <25% / moderate 25–50% / extensive >50%) · CT severity /25 · bronchiectasis type ladder · emphysema extent · effusion size.

### 10.5 Laterality/location
Lobe × side everywhere; distribution qualifiers; node stations simplified (paratracheal/subcarinal/hilar/axillary — full IASLC optional).

### 10.6 Measurement fields
Nodule size (avg of long+short, auto) · mass size · cavity wall thickness · node short axis · effusion depth · fibrosis extent % · severity score (lobe-wise auto-sum).

### 10.7 Impression phrases
- "No significant abnormality in the lung parenchyma, airways, pleura or mediastinum." *(normal)*
- "Tree-in-bud nodularity with {consolidation/cavitation} in {lobes} — active infective etiology, likely Koch's; sputum CBNAAT advised."
- "Fibrocalcific and traction changes {lobes} — sequelae of old infection. No active lesion."
- "GGOs involving ~{%} of lung parenchyma — viral/atypical infective etiology; CT severity score {n}/25."
- "UIP pattern of fibrosing ILD ({extent}) — pulmonology referral and PFT correlation advised."
- "{Type} bronchiectasis {lobes} with mucus plugging."
- "Solid nodule {size} in {lobe} — Fleischner-based follow-up as below." / "Spiculated mass {size, lobe} with {nodes} — **CT-guided biopsy / PET-CT and oncology referral advised.**"

### 10.8 Recommendations
`lab-sputum` (CBNAAT) · `spec-pulmo` + PFT (ILD) · Fleischner follow-up slots (nodule size/risk → interval; AI pre-fills, radiologist confirms) · `biopsy` / PET-CT / `spec-onc` (mass) · `fup-3m`/`fup-6m` CT · airway clearance/pulmo opinion (bronchiectasis).

### 10.9 Synonyms
HRCT · GGO/GGN · TIB = tree-in-bud · ILD/UIP/NSIP · honeycombing · crazy-paving · "post-Koch's sequelae" · CTSS = CT severity score · Fleischner · mediastinal LAP = lymphadenopathy.

### 10.10 Quick Select button groups
**Pattern wall** (GGO/consolidation/TIB/mosaic/crazy-paving/honeycombing — tap pattern → lobe grid) · TB set (active/sequelae/miliary/nodes) · Fibrosis set (UIP/NSIP builders) · Airways · Nodule builder (size→character→Fleischner slot) · Pinned: `nhr` normal · `tib` active infective · `seq` sequelae · `uip` · `bx` bronchiectasis.

### 10.11 Keyboard aliases
`nhr` normal HRCT · `ggo` · `cons` · `tib` · `mil` · `seq` sequelae · `uip` / `nsip` · `bx` bronchiectasis · `emp` emphysema · `nod` nodule (Fleischner) · `mass` · `cav` cavity · `lap` lymphadenopathy · `ctss` severity score.

### 10.12 AI assistance
**Pattern+distribution → differential card** (basal subpleural honeycombing → UIP-first list with discriminators) · Fleischner recommendation auto-slotting from nodule size/character + risk from indication · lobe-wise severity auto-sum · TB-activity language guard (lint if "active" and "sequelae" both applied to same lobe without qualifier) · prior-CT nodule tracking (links to lesion registry / follow-up sparklines) · node-station labeling assist.

---

# Part 11 — Cross-study libraries and governance

## 11.1 What is shared (single source, many studies)
- **Parameter Library** (§0.3) — every study binds to the same sets; analytics can therefore ask "all findings with severity=severe this month" across modalities.
- **Recommendation Library** (§0.5) — one editable list; every impression pairing references it.
- **Critical Findings Registry** (§0.6) — one list drives escalation everywhere.
- **Spine set** (Part 2 ↔ 3), **renal set** (Part 5 ↔ 6), **brain site/territory set** (Part 1 ↔ 4) are explicitly shared blocks.
- **Synonym dictionary** — all §x.9 entries merge into one search thesaurus; search and dictation resolve "Koch's", "PIVD", "stone", "NAD" etc. to canonical entries.

## 11.2 Content governance (product-level)
- Every entry carries: owner (designated radiologist-editor), version, review date, and status (draft/active/retired). Retired entries stop appearing in Quick Select but remain resolvable in old reports and search.
- Practice-level customization is **additive and phrasal**: centers may edit wording, add tiles, re-pin groups — but severity scales, BI-RADS/management pairing, and the critical registry are governed centrally with sign-off.
- The AI Copilot consumes only **active** catalog entries as its suggestion vocabulary; it may propose *new candidate entries* from frequently-typed free text ("you've typed this sentence 14 times — add as tile?"), which enter as drafts for the editor.
- Quarterly content review driven by analytics: tiles never fired → retire candidates; free-text phrases frequently repeated → tile candidates; recommendations frequently deleted → wording review.

## 11.3 Seed-conversion guidance for engineers (content shape only)
Each study section converts to: category list → finding entries (with the six-element anatomy of §0.1) → parameter bindings (referencing §0.3 sets by name, not copies) → impression fragments → recommendation bindings (§0.5 codes) → tile groups with pin order → alias table → synonym list → AI-opportunity flags (which entries participate in which copilot features). Nothing in this document prescribes storage, format, or API — only the content and its relationships.

## 11.4 Coverage roadmap (after these ten)
Next tranche by Indian-center volume: USG Obstetric (NT/anomaly/growth — needs its own document owing to structured biometry) · USG Thyroid/Neck (TI-RADS) · USG Scrotum · MRI Knee · MRI Shoulder · CT PNS · CECT Abdomen · Echo (structured measurements module) · Barium/IVP legacy set.

---

## Closing note

Ten studies, one grammar: shared parameters, shared severities, shared recommendations, shared critical registry — with each study contributing only its own vocabulary. Converted to seeds, this catalog gives Quick Select its tiles, the Impression Builder its fragments, the Copilot its safe suggestion space, Search its thesaurus, and Analytics a clean cross-modality spine — and gives the radiologist the thing that actually matters: the sentence they were about to write, one keystroke away.
