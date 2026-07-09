# CARE Radiology — Knowledge Seed Specification (v1)

**Author:** Radiology Knowledge Seed Architect, CARE ERP
**Date:** 2026-07-09
**Source of truth:** `RADIOLOGY_KNOWLEDGE_CATALOG.md` (approved). This document converts that catalog into implementation-ready seed data specifications. No application code, no SQL, no UI design — structured content only, clean enough for direct conversion into JSON/YAML/DB seeds.
**Consumers:** Quick Select · Parameter Library · Structured Reporting · AI Copilot · Search · Impression Builder · Analytics.

---

# 1. Master seed specification

## 1.1 Entity model (content shape, not storage)

| Entity | Identity | Notes |
|---|---|---|
| **Study type** | `study.<key>` | 10 seeded below; carries aliases, report sections, tile groups |
| **Finding** | `<study>.<finding_key>` | The atomic seed unit; every finding is Quick-Select-tile-ready |
| **Parameter set** | `param.<key>` | Shared library §2.1; findings bind by reference, never copy |
| **Severity scale** | `sev.<key>` | Shared library §2.2 |
| **Laterality set** | `lat.<key>` | Shared library §2.3 |
| **Location set** | `loc.<key>` | Shared library §2.4 |
| **Measurement field** | `meas.<key>` | Shared library §2.5; `auto_calc` flag where derived |
| **Recommendation** | `rec.<key>` | Shared library §2.6; findings reference codes, never free text |
| **Critical entry** | `crit.<key>` | Shared library §2.7; linked findings trigger escalation suggestion |
| **Combo tile** | `combo.<study>.<key>` | Ordered list of member findings fired together |
| **Normal template** | `tpl.normal.<study>` | Shared library §2.10 |

## 1.2 Field conventions (apply to every finding block)

- **Omitted field = default:** `criticality: none`, `normal_variant: false`, `recommendation_code: []`, `parameters: []`, `severity_options: null`, `common_combo_tiles: []`.
- `default_sentence` and `impression_fragment` use `{slot}` placeholders; slot names match the bound parameter/measurement keys. Unfilled optional slots collapse cleanly (no dangling commas).
- `keyboard_aliases` are unique **within their study** (rules in §2.9). `synonyms` feed the global search/dictation thesaurus (§2.8).
- `criticality` values: `none` · `significant` · `critical: crit.<key>` · `critical_if: "<condition> -> crit.<key>"`.
- Every finding renders as a Quick Select tile by default (`tile: true` implied); `tile: false` marks reference-only entries (rare).
- Language locked to Indian diagnostic-center reporting phrasing; wording is practice-editable post-seed, keys are not.

---

# 2. Shared libraries

## 2.1 Parameter library

```yaml
param.size:            {type: measurement, units: [mm, cm], dims: 1-3, render: "~{v} mm / {a} x {b} cm"}
param.count:           {type: choice, values: [single, few (2-5), multiple, innumerable]}
param.course:          {type: choice, values: [acute, subacute, chronic, acute-on-chronic, old/healed]}
param.change:          {type: choice, values: [new, stable, increased, decreased, resolved]}
param.margin:          {type: choice, values: [well-defined, ill-defined, lobulated, spiculated]}
param.enhancement:     {type: choice, values: [none, homogeneous, heterogeneous, ring, nodular, peripheral]}
param.echotexture:     {type: choice, values: [anechoic, hypoechoic, isoechoic, hyperechoic, mixed echogenicity]}
param.ct_density:      {type: choice, values: [hypodense, isodense, hyperdense, mixed density]}
param.mr_signal:       {type: choice, values: [T1 hypo, T1 hyper, T2/FLAIR hyper, T2 hypo, DWI restricted, SWI blooming]}
param.edema:           {type: choice, values: [no perilesional edema, mild perilesional edema, marked perilesional edema]}
param.disc_morphology: {type: choice, values: [diffuse bulge, protrusion, extrusion, sequestration]}
param.disc_zone:       {type: choice, values: [central, right paracentral, left paracentral, right foraminal, left foraminal, extraforaminal]}
param.root_involvement:{type: choice, values: [abutting, indenting, compressing]}
param.cord_ladder:     {type: choice, ordered: true, values: [indenting the thecal sac, abutting the cord, indenting the cord, compressing the cord with signal change]}
param.waveform:        {type: choice, values: [triphasic, biphasic, monophasic]}
param.thrombus_age:    {type: choice, values: [acute (echogenic, non-compressible, distended), chronic (echogenic wall-adherent, partially recanalized)]}
param.calc_morphology: {type: choice, values: [vascular, coarse popcorn, rim, milk-of-calcium, dystrophic, amorphous, fine pleomorphic, fine linear-branching], benign_cutoff_index: 4}
param.calc_distribution:{type: choice, values: [grouped, linear, segmental, regional, diffuse]}
param.mass_shape:      {type: choice, values: [oval, round, irregular]}
param.nodule_character:{type: choice, values: [solid, part-solid, ground-glass]}
param.lung_distribution:{type: choice, values: [upper-predominant, lower-predominant, peripheral/subpleural, central/peribronchovascular, diffuse]}
param.bronchiectasis_type:{type: choice, values: [cylindrical, varicose, cystic]}
param.fibroid_site:    {type: choice, values: [submucosal, intramural, subserosal, fundal, cervical]}
param.gb_status:       {type: choice, values: [well distended, contracted, post-cholecystectomy]}
param.cmd:             {type: choice, values: [preserved, partially lost, lost]}
param.tube_position:   {type: choice, values: [in appropriate position, low/high — repositioning suggested, malpositioned]}
```

## 2.2 Severity library

```yaml
sev.global:      {values: [mild, moderate, severe]}
sev.hydro:       {values: [mild, moderate, gross]}
sev.ascites:     {values: [mild, moderate, gross]}
sev.effusion:    {values: [mild, moderate, massive]}
sev.fazekas:     {values: [Fazekas I, Fazekas II, Fazekas III]}
sev.fatty_liver: {values: [Grade I, Grade II, Grade III]}
sev.mrd:         {values: [Grade I, Grade II, Grade III], label: medical renal disease}
sev.prostate:    {values: [Grade I (20-40 g), Grade II (40-60 g), Grade III (>60 g)], derive_from: meas.prostate_volume}
sev.modic:       {values: [Modic type I, Modic type II, Modic type III]}
sev.meyerding:   {values: [Grade I, Grade II, Grade III, Grade IV], derive_from: meas.listhesis_pct}
sev.canal:       {values: [mild, moderate, severe], applies: canal/foraminal stenosis}
sev.stenosis_pct:{values: ["<50%", "50-70%", ">70%", occlusion]}
sev.extent_lung: {values: [mild (<25%), moderate (25-50%), extensive (>50%)]}
sev.ptx:         {values: [minimal, moderate, complete, tension]}
sev.abi:         {bands: [{">=0.9": normal}, {"0.5-0.89": claudication range}, {"<0.5": critical ischemia}], derive_from: meas.abi}
sev.acr_density: {values: [a (fatty), b (scattered), c (heterogeneously dense), d (extremely dense)], rider_on: [c, d], rider: "Dense breast tissue limits sensitivity; ultrasound correlation is advised."}
sev.birads:
  values: ["0", "1", "2", "3", "4a", "4b", "4c", "5", "6"]
  mandatory_management: true       # assessment cannot seed/sign without its bound line
  management:
    "0":  "Incomplete — additional views/ultrasound correlation required before final assessment."
    "1":  "Negative. Routine screening as per age."
    "2":  "Benign findings. Routine screening as per age."
    "3":  "Probably benign. Short-interval follow-up mammogram in 6 months is advised."
    "4a": "Suspicious (low). Tissue diagnosis (biopsy) is recommended."
    "4b": "Suspicious (moderate). Tissue diagnosis (biopsy) is recommended."
    "4c": "Suspicious (high). Tissue diagnosis (biopsy) is recommended."
    "5":  "Highly suggestive of malignancy. Biopsy and breast surgery/oncology referral advised."
    "6":  "Known biopsy-proven malignancy. Oncology management as planned."
  criticality: {"5": crit.birads5}
```

## 2.3 Laterality library

```yaml
lat.rl:   [right, left]
lat.rlb:  [right, left, bilateral, "bilateral, right > left", "bilateral, left > right"]
lat.mid:  [right, left, bilateral, midline]
```

## 2.4 Location/anatomy library

```yaml
loc.brain_sites:      [frontal, parietal, temporal, occipital, cerebellar, brainstem, basal ganglia, thalamus, corona radiata, centrum semiovale, periventricular white matter, corpus callosum]
loc.vascular_territory:[MCA, ACA, PCA, PICA, watershed, lacunar/perforator]
loc.spine_lumbar:     {vertebrae: [L1, L2, L3, L4, L5, S1], discs: [L1-2, L2-3, L3-4, L4-5, L5-S1], roots: [L1, L2, L3, L4, L5, S1]}
loc.spine_cervical:   {vertebrae: [C1, C2, C3, C4, C5, C6, C7, T1], discs: [C2-3, C3-4, C4-5, C5-6, C6-7, C7-T1], roots: [C3, C4, C5, C6, C7, C8]}
loc.root_map:         {rule: "traversing root = lower vertebra of disc level; exiting root = upper", examples: {"L4-5 paracentral": "traversing L5", "L5-S1 foraminal": "exiting L5", "C5-6": "C6 root"}}
loc.lung_zones:       [right upper zone, right mid zone, right lower zone, left upper zone, left mid zone, left lower zone]
loc.lung_lobes:       [RUL, RML, RLL, LUL, lingula, LLL]
loc.liver:            {lobes: [right, left, caudate], segments: [I, II, III, IV, V, VI, VII, VIII], segments_optional: true}
loc.renal_calculus:   [upper calyx, mid calyx, lower calyx, renal pelvis, PUJ, upper ureter, mid ureter, distal ureter, VUJ]
loc.breast_locator:   {side: lat.rl, quadrant: [UOQ, UIQ, LOQ, LIQ, central, retroareolar], clock: 1-12, depth: [anterior, middle, posterior], distance_from_nipple: cm}
loc.venous_ll:        [CFV, SFJ, femoral vein (SFV), popliteal vein, posterior tibial veins, peroneal veins, GSV above knee, GSV below knee, SSV, SPJ, perforators (cm from ankle/knee)]
loc.arterial_ll:      [CFA, SFA, popliteal artery, ATA, PTA, peroneal artery, DPA]
loc.node_stations:    [right paratracheal, left paratracheal, prevascular, subcarinal, hilar (R/L), axillary (R/L), mesenteric, retroperitoneal]
loc.uterus_ovary:     [uterus (fundus/body/cervix), right ovary, left ovary, right adnexa, left adnexa, pouch of Douglas]
```

## 2.5 Measurement unit library

```yaml
units: [mm, cm, ml, g, "%", ratio, seconds, degrees, HU, weeks]

meas.lesion_size_3d:  {unit: mm/cm, dims: up to 3}
meas.midline_shift:   {unit: mm, critical_at: ">= 5 -> crit.midline_shift"}
meas.evans_index:     {unit: ratio, auto_calc: "frontal horn width / max internal skull diameter", flag: "> 0.30 = ventriculomegaly"}
meas.abc2_volume:     {unit: ml, auto_calc: "A x B x C / 2"}
meas.sdh_thickness:   {unit: mm}
meas.canal_ap:        {unit: mm, per: disc level}
meas.cord_ap:         {unit: mm, at: maximal compression}
meas.adi:             {unit: mm, flag: "> 3 adult / > 5 child"}
meas.listhesis_mm:    {unit: mm, auto_derive: sev.meyerding via % of endplate}
meas.liver_span:      {unit: cm, flag: "> 15.5 hepatomegaly (adult)"}
meas.spleen_span:     {unit: cm, flag: "> 12-13 splenomegaly (adult)"}
meas.kidney_size:     {unit: cm, per_side: true, fields: [length, width, cortical thickness]}
meas.cbd:             {unit: mm, flag: "> 6 (post-chole > 8-10)"}
meas.portal_vein:     {unit: mm, flag: "> 13"}
meas.gb_wall:         {unit: mm, flag: "> 3 (fasting)"}
meas.prostate_volume: {unit: g, auto_calc: "L x W x H x 0.52", derive: sev.prostate}
meas.pvr:             {unit: ml, fields: [pre-void, post-void], auto_calc: "% retention", flag: "significant per practice setting (default > 50 ml)"}
meas.et:              {unit: mm, label: endometrial thickness, context: menstrual phase from indication}
meas.calculus_size:   {unit: mm}
meas.appendix_diam:   {unit: mm, flag: "> 6 with probe tenderness"}
meas.ctr:             {unit: ratio, auto_calc: "cardiac width / thoracic width", flag: "> 0.50 on PA = cardiomegaly"}
meas.nodule_avg:      {unit: mm, auto_calc: "(long + short) / 2", feeds: rec.fleischner}
meas.cavity_wall:     {unit: mm}
meas.node_short_axis: {unit: mm, flag: "> 10 significant"}
meas.ctss:            {unit: /25, auto_calc: "sum of lobe scores (0-5 x 5 lobes)"}
meas.vein_diameter:   {unit: mm, sites: [SFJ, GSV thigh, GSV knee, GSV calf, SSV]}
meas.reflux_duration: {unit: seconds, flag: "> 0.5 superficial / > 1.0 deep = significant"}
meas.psv:             {unit: cm/s, per: arterial station, ratios: true}
meas.abi:             {unit: ratio, auto_calc: "ankle pressure / brachial pressure", per_side: true, derive: sev.abi}
meas.mass_size_2d:    {unit: mm/cm, dims: 2}
meas.effusion_depth:  {unit: mm}
```

## 2.6 Recommendation code library

```yaml
rec.clincorr:     "Clinical correlation is suggested."
rec.fup_usg6w:    "Follow-up ultrasound after 6 weeks is suggested."
rec.fup_3m:       "Follow-up imaging after 3 months is suggested."
rec.fup_6m:       "Follow-up imaging after 6 months is suggested."
rec.fup_cxr2w:    "Follow-up chest X-ray after 2 weeks of treatment is suggested."
rec.repeat_ncct24h: "Repeat NCCT head after 24 hours or earlier if clinical deterioration."
rec.spec_uro:     "Urology consultation is advised."
rec.spec_neuro:   "Neurology consultation is advised."
rec.spec_nsx:     "Neurosurgical consultation is advised."
rec.spec_ortho:   "Orthopaedic consultation is advised."
rec.spec_pulmo:   "Pulmonology consultation is advised."
rec.spec_gyn:     "Gynaecological correlation is advised."
rec.spec_onc:     "Oncology referral is advised."
rec.spec_surg:    "Surgical consultation is advised."
rec.spec_vasc:    "Vascular surgery opinion is advised."
rec.spec_breast:  "Breast surgery consultation is advised."
rec.cect:         "Contrast-enhanced CT is suggested for further evaluation."
rec.cemri:        "Contrast-enhanced MRI is suggested for further evaluation."
rec.mrcp:         "MRCP is suggested for further evaluation."
rec.ctkub:        "NCCT KUB is suggested for further evaluation."
rec.hrct:         "HRCT chest is suggested for further evaluation."
rec.mra_mrv:      "MR angiography/venography is suggested as clinically indicated."
rec.cta:          "CT angiography is suggested."
rec.biopsy:       "Histopathological / FNAC correlation is suggested."
rec.petct:        "PET-CT is suggested for staging/characterization."
rec.lab_lft:      "Correlation with liver function tests is advised."
rec.lab_rft:      "Correlation with renal function tests is advised."
rec.lab_urine:    "Correlation with urine routine/microscopy is advised."
rec.lab_sputum:   "Sputum for AFB / CBNAAT is advised."
rec.physio:       "Physiotherapy and analgesics as per treating physician."
rec.echo_corr:    "Echocardiographic correlation is suggested."
rec.pft:          "Pulmonary function tests are advised."
rec.usg_corr:     "Ultrasound correlation is advised."
rec.screening_spine: "Screening MRI of the whole spine is suggested."
rec.dexa:         "DEXA / bone density correlation is suggested."
rec.fleischner:   {template: "Follow-up CT chest at {interval} as per Fleischner guidelines.", slots: [interval], filled_by: AI from meas.nodule_avg + risk, confirm: radiologist}
rec.fup_mmg6m:    "Short-interval follow-up mammogram in 6 months is advised."   # bound to BI-RADS 3
rec.urgent:       {template: "URGENT {specialist} attention is advised — findings communicated to the referring doctor at {time}.", slots: [specialist, time], filled_by: escalation workflow}
```

## 2.7 Critical finding registry

Every entry: linked finding keys → escalation suggestion (`rec.urgent` pre-filled + critical-results workflow prompt).

```yaml
crit.ich:            {findings: [ctbr.ich, ctbr.sah, ctbr.contusions, mrbr.hemorrhage], specialist: neurosurgical}
crit.sdh_edh:        {findings: [ctbr.sdh, ctbr.edh], specialist: neurosurgical}
crit.midline_shift:  {trigger: "meas.midline_shift >= 5 mm", specialist: neurosurgical}
crit.large_infarct:  {findings: [mrbr.acute_infarct, ctbr.acute_infarct], condition: "large/major territory", specialist: neurology (stroke)}
crit.diffuse_edema:  {findings: [ctbr.diffuse_edema], specialist: neurosurgical}
crit.cord_compression:{findings: [mrcs.cord_signal], condition: "acute/progressive deficit in indication", specialist: spine surgery}
crit.acute_prox_dvt: {findings: [dopll.acute_dvt], condition: "femoro-popliteal segments", specialist: physician/vascular}
crit.tension_ptx:    {findings: [cxr.pneumothorax], condition: "tension or complete", specialist: emergency/pulmonology}
crit.massive_effusion:{findings: [cxr.pleural_effusion], condition: "massive with mediastinal shift", specialist: pulmonology}
crit.free_gas:       {findings: [cxr.free_gas], specialist: surgical}
crit.pyonephrosis:   {findings: [uskb.pyonephrosis], specialist: urology}
crit.birads5:        {findings: [mmg.birads_assessment], condition: "category 5", specialist: breast surgery/oncology}
crit.critical_ischemia:{findings: [dopll.arterial_occlusion], condition: "ABI < 0.5 or acute occlusion", specialist: vascular surgery}
```

## 2.8 Synonym/abbreviation library (global thesaurus)

Per-finding `synonyms` merge into this; global cross-cutting entries:

```yaml
kochs: pulmonary tuberculosis        pivd: disc protrusion/extrusion
nad: no abnormality detected         sol: space-occupying lesion
svid: small-vessel ischemic changes  hun: hydroureteronephrosis
pcs: pelvicalyceal system            mls: midline shift
ptx: pneumothorax                    lap: lymphadenopathy
fl: fatty liver                      hm / sm: hepatomegaly / splenomegaly
cmd: corticomedullary differentiation pvr: post-void residue
et: endometrial thickness            pod: pouch of Douglas
doc: disc-osteophyte complex         tib: tree-in-bud
ggo: ground-glass opacity            ctss: CT severity score
stone: calculus                      lump: palpable area (mammo annotation)
microcalcs: microcalcifications      #: fracture
"b/l": bilateral                     e/o: evidence of
ncc: neurocysticercosis              mrd: medical renal disease
dj stent: double-J ureteric stent    evlt: endovenous laser treatment
```

## 2.9 Keyboard alias rules

```yaml
rules:
  - Tile mnemonics: 2-4 lowercase chars, unique within study context; digits encode level/grade/side by convention.
  - Consonant-skeleton derivation (protrusion L4-5 -> pv45; fatty liver Gr 2 -> fl2).
  - No alias may be a strict prefix of another alias in the same study (rejected at seed validation).
  - Global /macros (e.g. /nad, /clincorr) live in a separate namespace; study mnemonics never shadow them.
  - Level-slotted aliases use the pattern <stem><level-digits>: db34, pv45, ex5s1 (s1 for L5-S1), doc56, ccs67.
  - Grade-slotted aliases: <stem><grade>: fl1..fl3, hn1..hn3, mrd1..mrd3, pros1..pros3, f1..f3 (Fazekas), b0..b6 (BI-RADS, plus b4a/b4b/b4c).
  - Side prefix where side is intrinsic: r/l (rcal, lcal, rvuj, lvuj).
  - Reserved global: nad, urgent, clincorr.
validation: seed pipeline must reject duplicate or prefix-colliding aliases per study.
```

## 2.10 Normal study templates

One full-normal template per study (fires as the study's #1 tile; text practice-editable):

```yaml
tpl.normal.mri_brain: >
  Normal study. No acute infarct, hemorrhage, mass lesion or abnormal enhancement.
  Ventricles and sulci are normal. Posterior fossa structures are unremarkable.
  Visualized paranasal sinuses and orbits are clear.
tpl.normal.mri_ls_spine: >
  Normal lumbar lordosis. Vertebral bodies show normal alignment and marrow signal.
  Intervertebral discs show preserved height and hydration. No significant disc bulge,
  protrusion or canal stenosis. Conus and visualized cord are normal.
tpl.normal.mri_c_spine: >
  Normal cervical lordosis. Vertebral alignment and marrow signal are normal. Discs show
  preserved height and hydration without herniation. No canal stenosis, cord compression
  or abnormal cord signal. Craniovertebral junction is normal.
tpl.normal.ct_brain: >
  No evidence of intracranial hemorrhage, mass effect or midline shift. Grey-white
  differentiation is preserved. Ventricles and basal cisterns are normal. No fracture
  of the visualized skull vault. Visualized paranasal sinuses and mastoids are clear.
tpl.normal.usg_abdomen: >
  Liver is normal in size and echotexture; no focal lesion. Gallbladder is well distended
  with no calculus; CBD is not dilated. Pancreas and spleen are unremarkable. Both kidneys
  are normal in size and echotexture with preserved corticomedullary differentiation; no
  calculus or hydronephrosis. Urinary bladder is normal. No free fluid or lymphadenopathy.
tpl.normal.usg_kub: >
  Both kidneys are normal in size and echotexture; no calculus or hydronephrosis. Visualized
  ureters are not dilated. Urinary bladder is normal in outline; no calculus. No significant
  post-void residue.
tpl.normal.hrct_chest: >
  No significant abnormality in the lung parenchyma, airways, pleura or mediastinum.
  No consolidation, ground-glass opacity, nodule or fibrosis. No pleural effusion or
  significant mediastinal lymphadenopathy.
tpl.normal.cxr: >
  Both lung fields are clear. Costophrenic angles are free. Cardiac size is within normal
  limits. Bony thorax and soft tissues are unremarkable.
tpl.normal.doppler_ll_venous: >
  Deep veins of the examined lower limb are normal in caliber, compressible, and show
  normal phasic flow with augmentation. No evidence of deep venous thrombosis. No
  significant saphenous or perforator incompetence.
tpl.normal.doppler_ll_arterial: >
  Arteries of the examined lower limb show normal caliber, wall pattern and triphasic
  flow. No hemodynamically significant stenosis. ABI is within normal limits.
tpl.normal.mammography: >
  Both breasts show {composition} fibroglandular composition. No suspicious mass,
  microcalcification, asymmetry or architectural distortion. Skin and nipples are normal.
  Axillae are unremarkable. BI-RADS 1 — routine screening as per age.
```

---

# 3. Study-wise seed blocks

## 3.1 Study: MRI Brain

```yaml
study: mri_brain
modality: MR
aliases: [MRI brain, brain MRI, MR brain plain, CEMRI brain]
default_report_sections: [Clinical details, Technique, Findings, Impression, Advice]
quick_select_groups:
  - pinned: [mrbr.normal_study, mrbr.svid, mrbr.acute_infarct, mrbr.granuloma, mrbr.pns_sinusitis]
  - Infarct: [mrbr.acute_infarct, mrbr.lacunar_chronic, mrbr.chronic_infarct_gliosis]
  - SVID & atrophy: [mrbr.svid, mrbr.atrophy]
  - Granuloma/infection: [mrbr.granuloma, mrbr.ring_lesion]
  - Hemorrhage: [mrbr.hemorrhage, mrbr.microbleeds]
  - SOL: [mrbr.extraaxial_mass, mrbr.intraaxial_mass]
  - CSF spaces: [mrbr.hydrocephalus, mrbr.arachnoid_cyst]
  - Demyelination: [mrbr.demyelination]
  - Incidentals: [mrbr.pns_sinusitis, mrbr.empty_sella]

findings:
  - id_key: mrbr.normal_study
    display_name: Normal MRI brain
    category: Normal
    synonyms: [normal brain, NAD brain]
    keyboard_aliases: [nb]
    default_sentence: (tpl.normal.mri_brain)
    impression_fragment: "No acute infarct, hemorrhage, mass lesion or abnormal enhancement."
    normal_variant: true

  - id_key: mrbr.acute_infarct
    display_name: Acute infarct
    category: Infarct/Ischemia
    synonyms: [acute stroke, restricted diffusion, DWI restriction]
    keyboard_aliases: [ain]
    default_sentence: "Area of diffusion restriction with corresponding low ADC in the {location} — acute infarct in the {territory} territory."
    parameters: [param.size]
    laterality_options: lat.rlb
    location_options: [loc.brain_sites, loc.vascular_territory]
    measurement_fields: [meas.lesion_size_3d]
    impression_fragment: "Acute infarct in the {side} {territory} territory."
    recommendation_code: [rec.mra_mrv, rec.spec_neuro]
    criticality: "critical_if: large/major territory -> crit.large_infarct"

  - id_key: mrbr.lacunar_chronic
    display_name: Chronic lacunar infarcts
    category: Infarct/Ischemia
    synonyms: [lacunes, old lacunar infarcts]
    keyboard_aliases: [lac]
    default_sentence: "{count} chronic lacunar infarct(s) in the {location}."
    parameters: [param.count]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    impression_fragment: "Chronic lacunar infarcts as described."
    common_combo_tiles: [combo.mrbr.svid_age]

  - id_key: mrbr.chronic_infarct_gliosis
    display_name: Chronic infarct with gliosis
    category: Infarct/Ischemia
    synonyms: [old infarct, encephalomalacia, gliosis]
    keyboard_aliases: [cinf]
    default_sentence: "Gliotic area with encephalomalacic changes in the {location} — chronic infarct."
    laterality_options: lat.rlb
    location_options: [loc.brain_sites, loc.vascular_territory]
    impression_fragment: "Chronic infarct in the {side} {territory} territory."

  - id_key: mrbr.svid
    display_name: Small-vessel ischemic changes
    category: SVID & atrophy
    synonyms: [SVID, white matter ischemia, chronic ischemic changes, leukoaraiosis]
    keyboard_aliases: [svi, f1, f2, f3]
    default_sentence: "Few discrete/confluent T2/FLAIR hyperintensities in the periventricular and deep white matter — chronic small-vessel ischemic changes ({severity})."
    severity_options: sev.fazekas
    impression_fragment: "Chronic small-vessel ischemic changes ({severity})."
    common_combo_tiles: [combo.mrbr.svid_age]

  - id_key: mrbr.atrophy
    display_name: Cerebral atrophy
    category: SVID & atrophy
    synonyms: [age-related atrophy, cerebral volume loss]
    keyboard_aliases: [atr]
    default_sentence: "Prominent cerebral sulci and ventricles suggestive of {severity} diffuse cerebral atrophy{, appropriate for age}."
    severity_options: sev.global
    impression_fragment: "Diffuse cerebral atrophy, {severity}."
    common_combo_tiles: [combo.mrbr.svid_age]

  - id_key: mrbr.granuloma
    display_name: Calcified granuloma
    category: Granuloma/Infection
    synonyms: [old NCC, healed tuberculoma, calcified NCC]
    keyboard_aliases: [gran]
    default_sentence: "{count} calcified granuloma(s) in the {location} with blooming on SWI. No perilesional edema."
    parameters: [param.count, param.edema]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    impression_fragment: "Calcified granuloma(s) — sequelae of old neurocysticercosis/tuberculoma."
    recommendation_code: [rec.clincorr]

  - id_key: mrbr.ring_lesion
    display_name: Ring-enhancing lesion (NCC/tuberculoma workup)
    category: Granuloma/Infection
    synonyms: [ring enhancing lesion, NCC active, tuberculoma]
    keyboard_aliases: [rel]
    default_sentence: "Ring-enhancing lesion ({size}) in the {location} with {edema}{, eccentric scolex noted}."
    parameters: [param.size, param.edema, param.enhancement]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    measurement_fields: [meas.lesion_size_3d]
    impression_fragment: "Ring-enhancing lesion {location} — neurocysticercosis vs tuberculoma."
    recommendation_code: [rec.spec_neuro, rec.fup_3m]
    criticality: significant

  - id_key: mrbr.hemorrhage
    display_name: Intracranial hemorrhage (MR)
    category: Hemorrhage
    synonyms: [ICH, hematoma, bleed]
    keyboard_aliases: [ich]
    default_sentence: "{course} hematoma in the {location} ({size}), with {edema} and {mass effect}."
    parameters: [param.course, param.size, param.edema]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    measurement_fields: [meas.abc2_volume, meas.midline_shift]
    impression_fragment: "{course} intracranial hemorrhage {location}."
    recommendation_code: [rec.urgent]
    criticality: "critical: crit.ich"

  - id_key: mrbr.microbleeds
    display_name: Microbleeds (SWI)
    category: Hemorrhage
    synonyms: [microhemorrhages, SWI blooming foci]
    keyboard_aliases: [mb]
    default_sentence: "{count} foci of blooming on SWI in {distribution} distribution — microbleeds."
    parameters: [param.count]
    location_options: ["lobar", "deep/central", "mixed"]
    impression_fragment: "Cerebral microbleeds, {distribution} distribution."

  - id_key: mrbr.hydrocephalus
    display_name: Hydrocephalus
    category: CSF spaces
    synonyms: [ventriculomegaly, dilated ventricles]
    keyboard_aliases: [hcp]
    default_sentence: "Dilatation of the ventricular system ({severity}), {communicating/obstructive}. Evans index {value}."
    severity_options: sev.hydro
    measurement_fields: [meas.evans_index]
    impression_fragment: "{communicating/obstructive} hydrocephalus, {severity}."
    recommendation_code: [rec.spec_nsx]
    criticality: significant

  - id_key: mrbr.extraaxial_mass
    display_name: Extra-axial mass (meningioma pattern)
    category: SOL
    synonyms: [meningioma, dural-based mass]
    keyboard_aliases: [men]
    default_sentence: "Well-defined extra-axial dural-based mass ({size}) along the {location} with homogeneous enhancement and dural tail."
    parameters: [param.size, param.enhancement, param.edema]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    measurement_fields: [meas.lesion_size_3d, meas.midline_shift]
    impression_fragment: "Extra-axial dural-based mass {location} — likely meningioma."
    recommendation_code: [rec.cemri, rec.spec_nsx]
    criticality: significant

  - id_key: mrbr.intraaxial_mass
    display_name: Intra-axial mass (glioma/mets pattern)
    category: SOL
    synonyms: [SOL, glioma, metastasis, space occupying lesion]
    keyboard_aliases: [sol]
    default_sentence: "{count} intra-axial lesion(s) ({size}) in the {location} with {enhancement} enhancement and {edema}."
    parameters: [param.count, param.size, param.enhancement, param.edema]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    measurement_fields: [meas.lesion_size_3d, meas.midline_shift]
    impression_fragment: "Intra-axial mass lesion(s) as described — neoplastic etiology to be considered."
    recommendation_code: [rec.cemri, rec.spec_nsx, rec.biopsy]
    criticality: significant

  - id_key: mrbr.demyelination
    display_name: Demyelinating plaques
    category: Demyelination
    synonyms: [MS plaques, demyelination]
    keyboard_aliases: [dem]
    default_sentence: "{count} ovoid T2/FLAIR hyperintense lesions in periventricular/juxtacortical{/infratentorial} location, perpendicular to the ventricular margins — demyelinating plaques."
    parameters: [param.count]
    impression_fragment: "Demyelinating disease — clinical and CSF correlation advised."
    recommendation_code: [rec.spec_neuro, rec.clincorr]
    criticality: significant

  - id_key: mrbr.pns_sinusitis
    display_name: PNS mucosal thickening
    category: Incidentals
    synonyms: [sinusitis, mucosal thickening]
    keyboard_aliases: [pns]
    default_sentence: "Mucosal thickening in the {sinuses} sinuses."
    location_options: [maxillary, ethmoid, frontal, sphenoid, pansinus]
    laterality_options: lat.rlb
    impression_fragment: "Paranasal sinusitis."
    normal_variant: false

  - id_key: mrbr.arachnoid_cyst
    display_name: Arachnoid cyst
    category: Incidentals
    synonyms: [CSF intensity cyst]
    keyboard_aliases: [arc]
    default_sentence: "CSF-intensity extra-axial cyst ({size}) in the {location} — arachnoid cyst."
    parameters: [param.size]
    location_options: loc.brain_sites
    laterality_options: lat.rlb
    impression_fragment: "Arachnoid cyst {location} — incidental."
    normal_variant: true

  - id_key: mrbr.empty_sella
    display_name: Empty/partially empty sella
    category: Incidentals
    keyboard_aliases: [es]
    default_sentence: "Partially empty sella noted — usually an incidental finding."
    impression_fragment: "Partially empty sella — incidental."
    normal_variant: true

ai_assistance:
  missed_finding_checks:
    - Indication keyword vs report coverage (e.g. "headache ?SOL" -> mass/hydrocephalus addressed)
    - DWI series reported when stroke/deficit in indication
    - PNS/orbits line present (common medico-legal miss)
    - Prior report lesions (granuloma count) confirmed or resolved
  contradiction_checks:
    - Side mismatch between findings and impression
    - "acute infarct" text without DWI descriptor
    - Hemorrhage sentence without SWI/GRE mention
    - meas.midline_shift >= 5 without critical escalation started
  impression_suggestions:
    - Assemble from impression_fragments, worst-first (critical > significant > rest)
    - Auto-suggest territory from dictated site (corona radiata -> MCA perforator)
    - Fazekas grade ghost from WM description
  follow_up_suggestions:
    - Ring lesion -> rec.fup_3m pairing
    - Mass lesions -> rec.cemri if plain study
    - Acute infarct -> rec.mra_mrv
```

## 3.2 Study: MRI LS Spine

```yaml
study: mri_ls_spine
modality: MR
aliases: [MRI LS spine, lumbar spine MRI, MRI lumbosacral spine, LSS MRI]
default_report_sections: [Clinical details, Technique, Findings (with per-level table), Impression, Advice]
quick_select_groups:
  - pinned: [mrls.normal_study, mrls.spondylosis, mrls.protrusion(l4-5), mrls.protrusion(l5-s1), mrls.listhesis]
  - Level x Morphology grid: {rows: loc.spine_lumbar.discs, cols: [mrls.bulge, mrls.protrusion, mrls.extrusion]}
  - Alignment: [mrls.straightened_lordosis, mrls.listhesis]
  - Stenosis: [mrls.canal_stenosis, mrls.foraminal_narrowing, mrls.lf_facet]
  - Marrow: [mrls.modic, mrls.hemangioma, mrls.collapse]
  - Incidentals: [mrls.schmorl, mrls.tarlov]

findings:
  - id_key: mrls.normal_study
    display_name: Normal MRI LS spine
    category: Normal
    synonyms: [normal lumbar spine]
    keyboard_aliases: [nls]
    default_sentence: (tpl.normal.mri_ls_spine)
    impression_fragment: "No significant disc herniation or canal stenosis."
    normal_variant: true

  - id_key: mrls.spondylosis
    display_name: Lumbar spondylosis (header)
    category: Degenerative
    synonyms: [degenerative changes, DDD, lumbar spondylotic changes]
    keyboard_aliases: [spond]
    default_sentence: "Marginal osteophytes with disc desiccation at multiple levels — lumbar spondylosis."
    impression_fragment: "Lumbar spondylosis."
    common_combo_tiles: [combo.mrls.spond_strl]

  - id_key: mrls.straightened_lordosis
    display_name: Straightening of lumbar lordosis
    category: Alignment
    synonyms: [loss of lordosis, muscle spasm]
    keyboard_aliases: [strl]
    default_sentence: "Straightening of the lumbar lordosis — likely positional/muscle spasm."
    impression_fragment: "Straightened lumbar lordosis."
    common_combo_tiles: [combo.mrls.spond_strl]

  - id_key: mrls.desiccation
    display_name: Disc desiccation
    category: Degenerative
    synonyms: [disc dehydration, dark disc]
    keyboard_aliases: [des]
    default_sentence: "Reduced T2 signal of the {level} disc(s) — disc desiccation."
    location_options: loc.spine_lumbar.discs
    impression_fragment: null   # folds under spondylosis

  - id_key: mrls.bulge
    display_name: Diffuse disc bulge
    category: Disc
    synonyms: [annular bulge, disc bulge]
    keyboard_aliases: [db34, db45, db5s1]   # level-slotted stem: db
    default_sentence: "Diffuse posterior disc bulge at {level} indenting the thecal sac."
    location_options: loc.spine_lumbar.discs
    measurement_fields: [meas.canal_ap]
    impression_fragment: "Diffuse disc bulge at {level}."

  - id_key: mrls.protrusion
    display_name: Disc protrusion (PIVD)
    category: Disc
    synonyms: [PIVD, herniated disc, disc prolapse]
    keyboard_aliases: [pv34, pv45, pv5s1]   # stem: pv
    default_sentence: "Posterior {zone} disc protrusion at {level} ({size}) indenting the thecal sac and {root_involvement} the {root} nerve root(s), with {severity} canal stenosis."
    parameters: [param.disc_zone, param.root_involvement, param.size]
    severity_options: sev.canal
    location_options: [loc.spine_lumbar.discs, loc.root_map]
    measurement_fields: [meas.canal_ap]
    impression_fragment: "{level} {zone} disc protrusion causing {severity} canal stenosis, {root_involvement} the {root} root(s)."
    recommendation_code: [rec.physio, rec.clincorr]
    common_combo_tiles: [combo.mrls.pivd_classic]

  - id_key: mrls.extrusion
    display_name: Disc extrusion
    category: Disc
    synonyms: [extruded disc, sequestrated disc, migrated disc]
    keyboard_aliases: [ex45, ex5s1]   # stem: ex
    default_sentence: "{zone} disc extrusion at {level} ({size}) with {caudal/cranial} migration, compressing the {root} nerve root, with {severity} canal stenosis."
    parameters: [param.disc_zone, param.size]
    severity_options: sev.canal
    location_options: [loc.spine_lumbar.discs, loc.root_map]
    measurement_fields: [meas.canal_ap]
    impression_fragment: "{level} disc extrusion compressing the {root} root, {severity} canal stenosis."
    recommendation_code: [rec.spec_ortho, rec.spec_nsx]
    criticality: significant

  - id_key: mrls.annular_fissure
    display_name: Annular fissure
    category: Disc
    synonyms: [annular tear, HIZ]
    keyboard_aliases: [af]
    default_sentence: "High-intensity zone in the posterior annulus at {level} — annular fissure."
    location_options: loc.spine_lumbar.discs
    impression_fragment: "Annular fissure at {level}."

  - id_key: mrls.canal_stenosis
    display_name: Canal stenosis
    category: Stenosis
    synonyms: [LSS, spinal stenosis, canal narrowing]
    keyboard_aliases: [cs34, cs45, cs5s1]   # stem: cs
    default_sentence: "{severity} canal stenosis at {level} (AP diameter {mm} mm) due to disc bulge, ligamentum flavum thickening and facet arthropathy."
    severity_options: sev.canal
    location_options: loc.spine_lumbar.discs
    measurement_fields: [meas.canal_ap]
    impression_fragment: "{severity} canal stenosis at {level}."
    recommendation_code: [rec.spec_ortho]
    criticality: "significant if severe"

  - id_key: mrls.foraminal_narrowing
    display_name: Neural foraminal narrowing
    category: Stenosis
    synonyms: [foraminal stenosis, NFN]
    keyboard_aliases: [fn45, fn5s1]   # stem: fn
    default_sentence: "{severity} {side} neural foraminal narrowing at {level} {root_involvement} the exiting {root} nerve root."
    parameters: [param.root_involvement]
    severity_options: sev.canal
    laterality_options: lat.rlb
    location_options: [loc.spine_lumbar.discs, loc.root_map]
    impression_fragment: "{side} foraminal narrowing at {level}."

  - id_key: mrls.lf_facet
    display_name: Ligamentum flavum / facet hypertrophy
    category: Stenosis
    synonyms: [LFH, facet arthropathy]
    keyboard_aliases: [lff]
    default_sentence: "Ligamentum flavum thickening with facet arthropathy at {level(s)}."
    location_options: loc.spine_lumbar.discs
    impression_fragment: null   # folds into stenosis line

  - id_key: mrls.listhesis
    display_name: Spondylolisthesis
    category: Alignment
    synonyms: [listhesis, anterolisthesis, slip]
    keyboard_aliases: [lith45, lith5s1]   # stem: lith
    default_sentence: "Grade {grade} anterolisthesis of {vertebra} over {vertebra} ({mm} mm){, with bilateral pars defects}."
    severity_options: sev.meyerding
    location_options: loc.spine_lumbar.vertebrae
    measurement_fields: [meas.listhesis_mm]
    impression_fragment: "Grade {grade} spondylolisthesis {level}{ with pars defects}."
    recommendation_code: [rec.spec_ortho]

  - id_key: mrls.modic
    display_name: Modic end-plate changes
    category: Marrow
    synonyms: [end-plate changes, Modic]
    keyboard_aliases: [mod1, mod2, mod3]
    default_sentence: "{severity} end-plate changes at {level}."
    severity_options: sev.modic
    location_options: loc.spine_lumbar.discs
    impression_fragment: null

  - id_key: mrls.hemangioma
    display_name: Vertebral hemangioma
    category: Marrow
    synonyms: [haemangioma]
    keyboard_aliases: [hem]
    default_sentence: "T1/T2 hyperintense lesion in the {vertebra} vertebral body ({size}) — hemangioma."
    parameters: [param.size]
    location_options: loc.spine_lumbar.vertebrae
    impression_fragment: "Vertebral hemangioma {vertebra} — incidental."
    normal_variant: true

  - id_key: mrls.collapse
    display_name: Vertebral collapse
    category: Marrow
    synonyms: [compression fracture, wedge collapse]
    keyboard_aliases: [col]
    default_sentence: "{course} compression collapse of {vertebra} with {marrow edema present/absent}{, retropulsion causing canal compromise}."
    parameters: [param.course]
    location_options: loc.spine_lumbar.vertebrae
    impression_fragment: "{course} collapse of {vertebra}."
    recommendation_code: [rec.dexa, rec.spec_ortho]
    criticality: significant

  - id_key: mrls.schmorl
    display_name: Schmorl's nodes
    category: Incidentals
    keyboard_aliases: [sch]
    default_sentence: "Schmorl's nodes at {level(s)}."
    location_options: loc.spine_lumbar.discs
    impression_fragment: null
    normal_variant: true

  - id_key: mrls.tarlov
    display_name: Tarlov (perineural) cyst
    category: Incidentals
    keyboard_aliases: [tar]
    default_sentence: "Perineural (Tarlov) cyst(s) at {level} ({size})."
    parameters: [param.size]
    impression_fragment: "Tarlov cyst — incidental."
    normal_variant: true

ai_assistance:
  missed_finding_checks:
    - Every disc L1-2..L5-S1 addressed (per-level table completeness)
    - Conus level stated
    - Symptomatic side from indication addressed at findings level
  contradiction_checks:
    - Root-map lint (L4-5 paracentral must name traversing L5; flag mismatch)
    - Severity vs measurement (severe stenosis with normal AP diameter -> flag)
    - Side mismatch findings vs impression
  impression_suggestions:
    - Order worst level first; group multi-level disease into one line with "worst at {level}"
    - Auto-derive Meyerding from meas.listhesis_mm
  follow_up_suggestions:
    - Severe stenosis / extrusion -> rec.spec_nsx pairing
    - Osteoporotic collapse -> rec.dexa
    - Multi-level disease -> rec.screening_spine
```

## 3.3 Study: MRI Cervical Spine

```yaml
study: mri_c_spine
modality: MR
aliases: [MRI cervical spine, C-spine MRI, MRI neck spine]
default_report_sections: [Clinical details, Technique, Findings (with per-level table), Impression, Advice]
reuses: {parameter_sets: from mri_ls_spine (disc morphology, zones, root map), levels: loc.spine_cervical}
quick_select_groups:
  - pinned: [mrcs.normal_study, mrcs.cspondylosis, mrcs.doc(c5-6), mrcs.doc(c6-7), mrcs.cord_signal]
  - Level x Morphology grid: {rows: loc.spine_cervical.discs, cols: [mrcs.doc, mrcs.protrusion]}
  - Cord ladder: [mrcs.cord_ladder tiles x4]
  - Foramina/UV: [mrcs.uncovertebral, mrcs.foraminal_narrowing]

findings:
  - id_key: mrcs.normal_study
    display_name: Normal MRI cervical spine
    category: Normal
    keyboard_aliases: [ncs]
    default_sentence: (tpl.normal.mri_c_spine)
    impression_fragment: "No cord compression or myelopathy signal."
    normal_variant: true

  - id_key: mrcs.cspondylosis
    display_name: Cervical spondylosis (header)
    category: Degenerative
    synonyms: [cervical spondylotic changes, DDD cervical]
    keyboard_aliases: [cspond]
    default_sentence: "Marginal osteophytes with disc desiccation at multiple levels — cervical spondylosis."
    impression_fragment: "Cervical spondylosis."
    common_combo_tiles: [combo.mrcs.spond_strc]

  - id_key: mrcs.straightened_lordosis
    display_name: Straightening of cervical lordosis
    category: Alignment
    synonyms: [loss of cervical lordosis, reversal of lordosis]
    keyboard_aliases: [strc]
    default_sentence: "Straightening{/reversal} of the cervical lordosis — likely muscle spasm."
    impression_fragment: "Straightened cervical lordosis."
    common_combo_tiles: [combo.mrcs.spond_strc]

  - id_key: mrcs.doc
    display_name: Disc-osteophyte complex
    category: Disc
    synonyms: [DOC, disc osteophyte bar]
    keyboard_aliases: [doc34, doc45, doc56, doc67]   # stem: doc
    default_sentence: "Posterior disc-osteophyte complex at {level} {cord_ladder}, with {severity} canal stenosis (AP {mm} mm)."
    parameters: [param.cord_ladder]
    severity_options: sev.canal
    location_options: loc.spine_cervical.discs
    measurement_fields: [meas.canal_ap, meas.cord_ap]
    impression_fragment: "{level} disc-osteophyte complex {cord_ladder}, {severity} canal stenosis."
    recommendation_code: [rec.physio, rec.clincorr]
    common_combo_tiles: [combo.mrcs.doc_classic]

  - id_key: mrcs.protrusion
    display_name: Cervical disc protrusion
    category: Disc
    synonyms: [cervical PIVD]
    keyboard_aliases: [cpv56, cpv67]   # stem: cpv
    default_sentence: "{zone} disc protrusion at {level} ({size}) {cord_ladder}, {root_involvement} the {root} nerve root."
    parameters: [param.disc_zone, param.cord_ladder, param.root_involvement, param.size]
    location_options: [loc.spine_cervical.discs, loc.root_map]
    measurement_fields: [meas.canal_ap]
    impression_fragment: "{level} disc protrusion {cord_ladder}."

  - id_key: mrcs.uncovertebral
    display_name: Uncovertebral arthropathy
    category: Foramina
    synonyms: [UV arthropathy, uncinate hypertrophy]
    keyboard_aliases: [uv56, uv67]   # stem: uv
    default_sentence: "Uncovertebral arthropathy at {level} causing {severity} {side} neural foraminal narrowing."
    severity_options: sev.canal
    laterality_options: lat.rlb
    location_options: loc.spine_cervical.discs
    impression_fragment: "{side} foraminal narrowing at {level} (uncovertebral arthropathy)."

  - id_key: mrcs.foraminal_narrowing
    display_name: Cervical foraminal narrowing
    category: Foramina
    keyboard_aliases: [cfn56, cfn67]   # stem: cfn
    default_sentence: "{severity} {side} neural foraminal narrowing at {level} {root_involvement} the exiting {root} root."
    parameters: [param.root_involvement]
    severity_options: sev.canal
    laterality_options: lat.rlb
    location_options: [loc.spine_cervical.discs, loc.root_map]
    impression_fragment: "{side} foraminal narrowing at {level}."

  - id_key: mrcs.cord_signal
    display_name: Cord signal change / myelomalacia
    category: Cord
    synonyms: [myelomalacia, cord edema, compressive myelopathy]
    keyboard_aliases: [myl]
    default_sentence: "T2 hyperintense signal within the cord at {level} — compressive myelopathy/myelomalacia."
    location_options: loc.spine_cervical.discs
    measurement_fields: [meas.cord_ap]
    impression_fragment: "Cord signal change at {level} — compressive myelopathy. Surgical opinion advised."
    recommendation_code: [rec.spec_nsx, rec.urgent]
    criticality: "critical_if: acute/progressive deficit -> crit.cord_compression"

  - id_key: mrcs.opll
    display_name: OPLL
    category: Degenerative
    synonyms: [ossified posterior longitudinal ligament]
    keyboard_aliases: [opll]
    default_sentence: "Ossification of the posterior longitudinal ligament from {level} to {level} contributing to canal stenosis."
    location_options: loc.spine_cervical.vertebrae
    impression_fragment: "OPLL with canal stenosis as described."
    recommendation_code: [rec.spec_nsx]
    criticality: significant

ai_assistance:
  missed_finding_checks:
    - Every disc C2-3..C7-T1 addressed
    - Cord signal explicitly commented when any canal stenosis moderate+
    - CVJ line present
  contradiction_checks:
    - Cord-ladder step vs measurement (compressing cord with normal cord AP -> flag)
    - Root-map lint (C5-6 -> C6 root)
    - "myelomalacia" in findings without surgical-opinion advice -> nudge
  impression_suggestions:
    - Cord-ladder step drives impression severity ordering
    - Auto-suggest rec.spec_nsx when cord signal present
  follow_up_suggestions:
    - Instability suspicion / ADI abnormal -> flexion-extension views note
```

## 3.4 Study: CT Brain (NCCT Head)

```yaml
study: ct_brain
modality: CT
aliases: [NCCT head, CT head plain, plain CT brain, NCCT brain]
default_report_sections: [Clinical details, Technique, Findings, Impression, Advice]
quick_select_groups:
  - pinned: [ctbr.normal_trauma, ctbr.sdh, ctbr.ich, ctbr.acute_infarct, ctbr.mls]
  - Hemorrhage: [ctbr.ich, ctbr.sdh, ctbr.edh, ctbr.sah, ctbr.contusions]
  - Trauma: [ctbr.skull_fracture, ctbr.contusions]
  - Infarct: [ctbr.acute_infarct, ctbr.chronic_infarct]
  - Pressure: [ctbr.diffuse_edema, ctbr.mls, ctbr.hydrocephalus]
  - Chronic/incidental: [ctbr.atrophy_svid, ctbr.granuloma, ctbr.sinus_mastoid]

findings:
  - id_key: ctbr.normal_trauma
    display_name: Normal NCCT head (trauma-negative)
    category: Normal
    synonyms: [normal CT head, NAD head]
    keyboard_aliases: [nct]
    default_sentence: (tpl.normal.ct_brain)
    impression_fragment: "No evidence of intracranial hemorrhage, mass effect or midline shift. No fracture of the skull vault."
    normal_variant: true

  - id_key: ctbr.ich
    display_name: Intraparenchymal hemorrhage
    category: Hemorrhage
    synonyms: [ICH, hypertensive bleed, hematoma]
    keyboard_aliases: [ich]
    default_sentence: "Acute intraparenchymal hemorrhage in the {location} ({size}), volume ~{ml} ml{, with intraventricular extension}{, with {mm} mm midline shift}."
    parameters: [param.size]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    measurement_fields: [meas.abc2_volume, meas.midline_shift]
    impression_fragment: "Acute intraparenchymal hemorrhage {location} (~{ml} ml)."
    recommendation_code: [rec.urgent]
    criticality: "critical: crit.ich"

  - id_key: ctbr.sdh
    display_name: Subdural hematoma
    category: Hemorrhage
    synonyms: [SDH, subdural bleed, acute on chronic SDH]
    keyboard_aliases: [sdh]
    default_sentence: "{course} subdural hematoma along the {side} {convexity/falx/tentorium}, maximum thickness {mm} mm{, with {mm} mm midline shift}."
    parameters: [param.course]
    laterality_options: lat.rlb
    measurement_fields: [meas.sdh_thickness, meas.midline_shift]
    impression_fragment: "{course} {side} SDH ({mm} mm){ with midline shift}."
    recommendation_code: [rec.urgent, rec.repeat_ncct24h]
    criticality: "critical: crit.sdh_edh"

  - id_key: ctbr.edh
    display_name: Extradural hematoma
    category: Hemorrhage
    synonyms: [EDH, epidural hematoma]
    keyboard_aliases: [edh]
    default_sentence: "Biconvex extradural hematoma in the {side} {location} region, maximum thickness {mm} mm{, with adjacent fracture}{, with {mm} mm midline shift}."
    laterality_options: lat.rl
    location_options: loc.brain_sites
    measurement_fields: [meas.sdh_thickness, meas.midline_shift]
    impression_fragment: "{side} EDH ({mm} mm) — neurosurgical emergency."
    recommendation_code: [rec.urgent]
    criticality: "critical: crit.sdh_edh"

  - id_key: ctbr.sah
    display_name: Subarachnoid hemorrhage
    category: Hemorrhage
    synonyms: [SAH]
    keyboard_aliases: [sah]
    default_sentence: "Hyperdensity in the {sulci/basal cisterns/sylvian fissures} — subarachnoid hemorrhage."
    impression_fragment: "Subarachnoid hemorrhage — CT angiography advised to rule out aneurysm."
    recommendation_code: [rec.urgent, rec.cta]
    criticality: "critical: crit.ich"

  - id_key: ctbr.contusions
    display_name: Hemorrhagic contusions
    category: Trauma
    synonyms: [contusion, contre-coup]
    keyboard_aliases: [con]
    default_sentence: "{count} hemorrhagic contusion(s) in the {location}{, with surrounding edema}."
    parameters: [param.count, param.edema]
    laterality_options: lat.rlb
    location_options: loc.brain_sites
    measurement_fields: [meas.midline_shift]
    impression_fragment: "Hemorrhagic contusions as described."
    recommendation_code: [rec.urgent, rec.repeat_ncct24h]
    criticality: "critical: crit.ich"

  - id_key: ctbr.skull_fracture
    display_name: Skull fracture
    category: Trauma
    synonyms: [vault fracture, "#" skull, depressed fracture]
    keyboard_aliases: [fx]
    default_sentence: "{undisplaced/depressed} fracture of the {bone}{, depression depth {mm} mm}{, with overlying scalp hematoma}."
    location_options: [frontal bone, parietal bone, temporal bone, occipital bone, skull base]
    laterality_options: lat.rl
    impression_fragment: "{undisplaced/depressed} fracture of the {bone}."
    recommendation_code: [rec.spec_nsx]
    criticality: significant

  - id_key: ctbr.acute_infarct
    display_name: Acute infarct (hypodensity)
    category: Infarct
    synonyms: [early infarct, dense MCA sign, loss of grey-white differentiation]
    keyboard_aliases: [inf]
    default_sentence: "Hypodensity with loss of grey-white differentiation in the {territory} territory{, with hyperdense {vessel} sign} — acute/subacute infarct."
    laterality_options: lat.rl
    location_options: loc.vascular_territory
    impression_fragment: "Acute/subacute infarct in the {side} {territory} territory."
    recommendation_code: [rec.cemri, rec.spec_neuro]
    criticality: "critical_if: large territory -> crit.large_infarct"

  - id_key: ctbr.chronic_infarct
    display_name: Chronic infarct / lacunes
    category: Infarct
    synonyms: [old infarct, gliosis, lacunes]
    keyboard_aliases: [cinf]
    default_sentence: "Well-defined hypodensity in the {location} — chronic infarct/gliosis."
    laterality_options: lat.rlb
    location_options: [loc.brain_sites, loc.vascular_territory]
    impression_fragment: "Chronic infarct {location}."

  - id_key: ctbr.diffuse_edema
    display_name: Diffuse cerebral edema
    category: Pressure
    synonyms: [brain edema, effaced cisterns]
    keyboard_aliases: [ede]
    default_sentence: "Diffuse effacement of sulci and basal cisterns with loss of grey-white differentiation — diffuse cerebral edema."
    impression_fragment: "Diffuse cerebral edema — urgent neurosurgical attention advised."
    recommendation_code: [rec.urgent]
    criticality: "critical: crit.diffuse_edema"

  - id_key: ctbr.mls
    display_name: Midline shift
    category: Pressure
    synonyms: [MLS, mass effect]
    keyboard_aliases: [mls]
    default_sentence: "Midline shift of {mm} mm to the {side}."
    laterality_options: lat.rl
    measurement_fields: [meas.midline_shift]
    impression_fragment: "Midline shift {mm} mm."
    criticality: "critical_if: >= 5 mm -> crit.midline_shift"

  - id_key: ctbr.hydrocephalus
    display_name: Hydrocephalus (CT)
    category: Pressure
    keyboard_aliases: [hcp]
    default_sentence: "Dilated ventricular system ({severity}){, with periventricular ooze}."
    severity_options: sev.hydro
    measurement_fields: [meas.evans_index]
    impression_fragment: "Hydrocephalus, {severity}."
    recommendation_code: [rec.spec_nsx]
    criticality: significant

  - id_key: ctbr.atrophy_svid
    display_name: Atrophy + chronic small-vessel changes
    category: Chronic
    synonyms: [age-related changes, involutional changes]
    keyboard_aliases: [atr]
    default_sentence: "Prominent sulci and ventricles with periventricular white-matter hypodensities — age-related atrophy with chronic small-vessel ischemic changes."
    impression_fragment: "Age-related cerebral atrophy with chronic small-vessel changes. No acute abnormality."

  - id_key: ctbr.granuloma
    display_name: Calcified granuloma (CT)
    category: Chronic
    synonyms: [old NCC, calcified lesion]
    keyboard_aliases: [gran]
    default_sentence: "{count} punctate calcified granuloma(s) in the {location}."
    parameters: [param.count]
    location_options: loc.brain_sites
    impression_fragment: "Calcified granuloma — sequelae of old infection."

  - id_key: ctbr.sinus_mastoid
    display_name: Sinusitis / mastoiditis
    category: Incidentals
    keyboard_aliases: [mast]
    default_sentence: "Mucosal thickening/opacification of the {sinuses}{; mastoid air cells show {side} opacification}."
    laterality_options: lat.rlb
    impression_fragment: "Paranasal sinusitis{ / mastoiditis} as described."

ai_assistance:
  missed_finding_checks:
    - Trauma checklist: vault, skull base, facial bones, scalp, C1-2 if included
    - Cisterns status stated whenever any hemorrhage present
    - Fracture search reminder when scalp hematoma described
  contradiction_checks:
    - Hemorrhage described but trauma-negative impression line used -> block
    - meas.midline_shift >= 5 without escalation started -> block at sign
    - SDH thickness/MLS numbers in text vs measurement fields divergence
  impression_suggestions:
    - Auto-assemble hemorrhage + volume + MLS into one emergency line
    - ABC/2 auto-volume ghost when 3 diameters present
  follow_up_suggestions:
    - Contusion / thin SDH -> rec.repeat_ncct24h
    - SAH -> rec.cta pairing
    - Suspected early infarct -> rec.cemri (DWI)
```

## 3.5 Study: USG Whole Abdomen

```yaml
study: usg_abdomen
modality: US
aliases: [USG whole abdomen, ultrasound abdomen, USG abdomen & pelvis, W/A scan]
default_report_sections: [Liver, GB & CBD, Pancreas, Spleen, Kidneys, Ureters, Urinary bladder, Prostate / Uterus & adnexa, Free fluid & others, Impression, Advice]
quick_select_groups:
  - pinned: [usab.normal_study, usab.fatty_liver, usab.cholelithiasis, usab.renal_calculus, usab.prostatomegaly]
  - Liver: [usab.fatty_liver, usab.hepatomegaly, usab.cld, usab.liver_cyst, usab.hemangioma, usab.focal_lesion]
  - GB/CBD: [usab.cholelithiasis, usab.gb_sludge, usab.gb_wall, usab.gb_polyp, usab.cbd_dilated]
  - Spleen/Pancreas: [usab.splenomegaly, usab.pancreas_obscured]
  - Kidneys: [usab.renal_calculus, usab.hydronephrosis, usab.renal_cyst, usab.mrd]
  - Bladder/Prostate: [usab.cystitis, usab.prostatomegaly]
  - Uterus/Adnexa: [usab.fibroid, usab.bulky_uterus, usab.ovarian_cyst, usab.pco]
  - General: [usab.ascites, usab.mesenteric_nodes, usab.appendicitis]

findings:
  - id_key: usab.normal_study
    display_name: Normal USG abdomen
    category: Normal
    synonyms: [NAD abdomen, normal scan]
    keyboard_aliases: [nab]
    default_sentence: (tpl.normal.usg_abdomen)
    impression_fragment: "No significant abnormality detected in the visualized abdominal organs."
    normal_variant: true

  - id_key: usab.fatty_liver
    display_name: Fatty liver
    category: Liver
    synonyms: [hepatic steatosis, FL, fatty infiltration]
    keyboard_aliases: [fl1, fl2, fl3]
    default_sentence: "Liver shows diffusely increased echogenicity — {severity} fatty infiltration."
    severity_options: sev.fatty_liver
    measurement_fields: [meas.liver_span]
    impression_fragment: "{severity} fatty liver."
    recommendation_code: [rec.lab_lft]
    common_combo_tiles: [combo.usab.fl_rest_normal]

  - id_key: usab.hepatomegaly
    display_name: Hepatomegaly
    category: Liver
    synonyms: [HM, enlarged liver]
    keyboard_aliases: [hm]
    default_sentence: "Liver is enlarged (span {cm} cm) with normal echotexture."
    measurement_fields: [meas.liver_span]
    impression_fragment: "Hepatomegaly."
    common_combo_tiles: [combo.usab.fl_hm]

  - id_key: usab.cld
    display_name: Coarse echotexture (CLD pattern)
    category: Liver
    synonyms: [chronic liver disease, cirrhotic liver, coarse liver]
    keyboard_aliases: [cld]
    default_sentence: "Liver shows coarse echotexture with irregular surface{, and reduced span} — chronic liver parenchymal disease."
    measurement_fields: [meas.liver_span, meas.portal_vein]
    impression_fragment: "Chronic liver parenchymal disease — clinical and LFT correlation advised."
    recommendation_code: [rec.lab_lft, rec.clincorr]
    criticality: significant

  - id_key: usab.liver_cyst
    display_name: Simple hepatic cyst
    category: Liver
    keyboard_aliases: [lcy]
    default_sentence: "Well-defined anechoic cyst ({size}) in the {segment/lobe} of liver — simple hepatic cyst."
    parameters: [param.size]
    location_options: loc.liver
    impression_fragment: "Simple hepatic cyst — incidental."
    normal_variant: true

  - id_key: usab.hemangioma
    display_name: Hepatic hemangioma pattern
    category: Liver
    keyboard_aliases: [hmg]
    default_sentence: "Well-defined hyperechoic lesion ({size}) in the {segment/lobe} — likely hemangioma."
    parameters: [param.size]
    location_options: loc.liver
    impression_fragment: "Hepatic hemangioma — follow-up/contrast imaging if clinically indicated."
    recommendation_code: [rec.fup_usg6w]

  - id_key: usab.focal_lesion
    display_name: Focal liver lesion (workup)
    category: Liver
    synonyms: [liver SOL, hepatic mass]
    keyboard_aliases: [fll]
    default_sentence: "{count} {echotexture} focal lesion(s) ({size}) in the {segment/lobe} of liver."
    parameters: [param.count, param.echotexture, param.size, param.margin]
    location_options: loc.liver
    impression_fragment: "Focal hepatic lesion(s) — further characterization advised."
    recommendation_code: [rec.cect, rec.cemri]
    criticality: significant

  - id_key: usab.cholelithiasis
    display_name: Cholelithiasis
    category: GB/CBD
    synonyms: [gallstones, GB calculus, cholelithiasis]
    keyboard_aliases: [chole]
    default_sentence: "Gallbladder shows {count} calculus/calculi (largest {mm} mm) with posterior acoustic shadowing. Wall is normal."
    parameters: [param.count, param.gb_status]
    measurement_fields: [meas.calculus_size, meas.gb_wall]
    impression_fragment: "Cholelithiasis. No sonographic evidence of cholecystitis."
    recommendation_code: [rec.spec_surg]
    common_combo_tiles: [combo.usab.chole_rest_normal]

  - id_key: usab.gb_sludge
    display_name: GB sludge
    category: GB/CBD
    keyboard_aliases: [slg]
    default_sentence: "Echogenic non-shadowing sludge noted within the gallbladder."
    impression_fragment: "Gallbladder sludge."

  - id_key: usab.gb_wall
    display_name: GB wall thickening (cholecystitis pattern)
    category: GB/CBD
    synonyms: [acute cholecystitis, GB wall edema]
    keyboard_aliases: [gbwt]
    default_sentence: "Gallbladder wall is thickened ({mm} mm) with pericholecystic fluid{, positive sonographic Murphy's sign}{, with calculus impacted at neck}."
    measurement_fields: [meas.gb_wall]
    impression_fragment: "Acute calculous/acalculous cholecystitis — surgical consultation advised."
    recommendation_code: [rec.spec_surg, rec.urgent]
    criticality: significant

  - id_key: usab.gb_polyp
    display_name: GB polyp
    category: GB/CBD
    keyboard_aliases: [gbp]
    default_sentence: "Non-mobile, non-shadowing polypoidal lesion ({mm} mm) along the gallbladder wall — polyp."
    measurement_fields: [meas.calculus_size]
    impression_fragment: "Gallbladder polyp ({mm} mm) — follow-up ultrasound advised."
    recommendation_code: [rec.fup_6m]

  - id_key: usab.cbd_dilated
    display_name: CBD dilatation
    category: GB/CBD
    synonyms: [dilated CBD, biliary dilatation, IHBRD]
    keyboard_aliases: [cbd]
    default_sentence: "Common bile duct is dilated ({mm} mm){, with intrahepatic biliary radicle dilatation}{; distal CBD obscured by bowel gas}."
    measurement_fields: [meas.cbd]
    impression_fragment: "Biliary dilatation — MRCP advised for further evaluation."
    recommendation_code: [rec.mrcp]
    criticality: significant

  - id_key: usab.pancreas_obscured
    display_name: Pancreas obscured (limitation line)
    category: Pancreas
    keyboard_aliases: [pno]
    default_sentence: "Visualized pancreas is unremarkable; body/tail partially obscured by bowel gas."
    impression_fragment: null
    normal_variant: true

  - id_key: usab.splenomegaly
    display_name: Splenomegaly
    category: Spleen
    synonyms: [SM, enlarged spleen]
    keyboard_aliases: [sm]
    default_sentence: "Spleen is enlarged (span {cm} cm) with normal echotexture."
    measurement_fields: [meas.spleen_span]
    impression_fragment: "Splenomegaly."

  - id_key: usab.renal_calculus
    display_name: Renal calculus
    category: Kidneys
    synonyms: [kidney stone, renal stone, nephrolithiasis]
    keyboard_aliases: [rcal, lcal]
    default_sentence: "{side} kidney shows a calculus ({mm} mm) in the {site} with posterior acoustic shadowing."
    laterality_options: lat.rlb
    location_options: loc.renal_calculus
    measurement_fields: [meas.calculus_size]
    impression_fragment: "{side} renal calculus ({mm} mm, {site})."
    recommendation_code: [rec.spec_uro, rec.lab_urine]
    common_combo_tiles: [combo.usab.calc_hn]

  - id_key: usab.hydronephrosis
    display_name: Hydronephrosis
    category: Kidneys
    synonyms: [HN, PCS dilatation, hydroureteronephrosis]
    keyboard_aliases: [hn1, hn2, hn3]
    default_sentence: "{side} kidney shows {severity} hydronephrosis{ with proximal hydroureter}."
    severity_options: sev.hydro
    laterality_options: lat.rlb
    impression_fragment: "{severity} {side} hydro(uretero)nephrosis."
    recommendation_code: [rec.spec_uro]
    criticality: significant
    common_combo_tiles: [combo.usab.calc_hn]

  - id_key: usab.renal_cyst
    display_name: Simple renal cortical cyst
    category: Kidneys
    keyboard_aliases: [rcy]
    default_sentence: "Well-defined anechoic cortical cyst ({size}) in the {pole} of the {side} kidney."
    parameters: [param.size]
    laterality_options: lat.rlb
    location_options: [upper pole, interpolar, lower pole]
    impression_fragment: "Simple renal cortical cyst — incidental."
    normal_variant: true

  - id_key: usab.mrd
    display_name: Medical renal disease
    category: Kidneys
    synonyms: [raised cortical echogenicity, renal parenchymal disease]
    keyboard_aliases: [mrd1, mrd2, mrd3]
    default_sentence: "Both kidneys show increased cortical echogenicity with {cmd} corticomedullary differentiation — medical renal disease, {severity}."
    parameters: [param.cmd]
    severity_options: sev.mrd
    measurement_fields: [meas.kidney_size]
    impression_fragment: "Bilateral medical renal disease, {severity} — correlate with RFT."
    recommendation_code: [rec.lab_rft, rec.spec_uro]
    criticality: significant

  - id_key: usab.cystitis
    display_name: Cystitis pattern (bladder wall thickening)
    category: Bladder
    synonyms: [UB wall thickening]
    keyboard_aliases: [cys]
    default_sentence: "Urinary bladder wall is diffusely thickened with internal echoes — cystitis pattern (bladder under-distension to be excluded)."
    impression_fragment: "Cystitis — urine routine correlation advised."
    recommendation_code: [rec.lab_urine]

  - id_key: usab.prostatomegaly
    display_name: Prostatomegaly
    category: Prostate
    synonyms: [BPH, enlarged prostate, prostate enlargement]
    keyboard_aliases: [pros1, pros2, pros3]
    default_sentence: "Prostate is enlarged, {severity} (volume ~{g} g){, with median lobe indenting the bladder base}. Post-void residue {ml} ml ({significant/insignificant})."
    severity_options: sev.prostate
    measurement_fields: [meas.prostate_volume, meas.pvr]
    impression_fragment: "Prostatomegaly, {severity} with {significant/insignificant} post-void residue."
    recommendation_code: [rec.spec_uro]

  - id_key: usab.bulky_uterus
    display_name: Bulky uterus
    category: Uterus/Adnexa
    keyboard_aliases: [blk]
    default_sentence: "Uterus is bulky ({dims}) with {homogeneous/heterogeneous} myometrial echotexture. Endometrial thickness {mm} mm."
    measurement_fields: [meas.et]
    impression_fragment: "Bulky uterus."
    recommendation_code: [rec.spec_gyn]

  - id_key: usab.fibroid
    display_name: Uterine fibroid
    category: Uterus/Adnexa
    synonyms: [leiomyoma, myoma]
    keyboard_aliases: [fib]
    default_sentence: "{count} well-defined hypoechoic {site} fibroid(s), largest {size}."
    parameters: [param.count, param.size, param.fibroid_site]
    measurement_fields: [meas.et]
    impression_fragment: "Uterine fibroid(s) as described — gynaecological correlation advised."
    recommendation_code: [rec.spec_gyn]

  - id_key: usab.ovarian_cyst
    display_name: Ovarian cyst (simple/hemorrhagic)
    category: Uterus/Adnexa
    synonyms: [adnexal cyst, functional cyst]
    keyboard_aliases: [ova]
    default_sentence: "{side} ovary shows a {simple anechoic/hemorrhagic (reticular pattern)} cyst ({size}). No internal vascularity."
    parameters: [param.size]
    laterality_options: lat.rlb
    impression_fragment: "{side} ovarian cyst — follow-up ultrasound after 6 weeks advised."
    recommendation_code: [rec.fup_usg6w, rec.spec_gyn]

  - id_key: usab.pco
    display_name: Polycystic ovarian morphology
    category: Uterus/Adnexa
    synonyms: [PCO, PCOS pattern]
    keyboard_aliases: [pco]
    default_sentence: "Both ovaries are bulky with multiple small peripheral follicles — polycystic ovarian morphology."
    impression_fragment: "Polycystic ovarian morphology — hormonal/clinical correlation advised."
    recommendation_code: [rec.clincorr, rec.spec_gyn]

  - id_key: usab.ascites
    display_name: Ascites / free fluid
    category: General
    synonyms: [free fluid, peritoneal fluid]
    keyboard_aliases: [asc]
    default_sentence: "{severity} free fluid noted in the peritoneal cavity{, with internal echoes/septations}."
    severity_options: sev.ascites
    impression_fragment: "Ascites, {severity} — clinical correlation advised."
    recommendation_code: [rec.clincorr]
    criticality: significant

  - id_key: usab.mesenteric_nodes
    display_name: Mesenteric lymphadenopathy
    category: General
    synonyms: [mesenteric nodes, mesenteric adenitis]
    keyboard_aliases: [msn]
    default_sentence: "Few enlarged mesenteric lymph nodes (largest {mm} mm short axis), likely reactive."
    measurement_fields: [meas.node_short_axis]
    impression_fragment: "Mesenteric lymphadenopathy — likely reactive."

  - id_key: usab.appendicitis
    display_name: Acute appendicitis
    category: General
    synonyms: [appendicitis, inflamed appendix]
    keyboard_aliases: [app]
    default_sentence: "Appendix is dilated ({mm} mm), non-compressible with probe tenderness and surrounding echogenic fat — acute appendicitis."
    measurement_fields: [meas.appendix_diam]
    impression_fragment: "Acute appendicitis — urgent surgical consultation advised."
    recommendation_code: [rec.spec_surg, rec.urgent]
    criticality: significant

ai_assistance:
  missed_finding_checks:
    - Organ checklist: every default report section addressed or explicitly limited (gas/obscured line)
    - PVR reported when prostatomegaly present
    - ET reported with uterus findings; phase context from indication
  contradiction_checks:
    - "cholecystitis" impression without wall/Murphy descriptor
    - Calculus site = ureter/VUJ in USG abdomen -> suggest KUB-style HUN comment
    - Measurement in text vs measurement field divergence (spans, volumes)
  impression_suggestions:
    - "{FL grade} fatty liver. Rest of the visualized organs are unremarkable." assembly when only liver abnormal
    - Auto-pair finding -> recommendation (calculus -> uro; MRD -> RFT)
    - Prostate grade auto-derive from volume; PVR significance ghost
  follow_up_suggestions:
    - Hemorrhagic ovarian cyst -> rec.fup_usg6w
    - GB polyp -> rec.fup_6m
    - Unexplained CBD dilatation -> rec.mrcp
```
## 3.6 Study: USG KUB

```yaml
study: usg_kub
modality: US
aliases: [USG KUB, KUB scan, renal ultrasound, USG kidneys ureters bladder]
default_report_sections: [Right kidney, Left kidney, Ureters, Urinary bladder, Prostate (males), Impression, Advice]
include_findings:   # reused wholesale from usg_abdomen (same keys, KUB tile placement)
  [usab.renal_calculus, usab.hydronephrosis, usab.renal_cyst, usab.mrd, usab.cystitis, usab.prostatomegaly]
quick_select_groups:
  - pinned: [uskb.normal_study, uskb.vuj_calculus, uskb.hun_level, usab.renal_calculus, uskb.dj_stent]
  - Right kidney / Left kidney: mirrored columns of [usab.renal_calculus, usab.hydronephrosis, usab.renal_cyst, usab.mrd]
  - Ureter: [uskb.ureteric_calculus, uskb.hun_level]
  - Bladder/Prostate: [usab.cystitis, uskb.bladder_debris, usab.prostatomegaly]
  - Red flags: [uskb.pyonephrosis, uskb.perinephric_fluid]

findings:
  - id_key: uskb.normal_study
    display_name: Normal USG KUB
    category: Normal
    synonyms: [NAD KUB, normal renal scan]
    keyboard_aliases: [nkub]
    default_sentence: (tpl.normal.usg_kub)
    impression_fragment: "No calculus or hydronephrosis in either kidney. Bladder and visualized ureters unremarkable."
    normal_variant: true

  - id_key: uskb.ureteric_calculus
    display_name: Ureteric calculus with HUN
    category: Ureter
    synonyms: [ureteric stone, HUN, ureterolithiasis]
    keyboard_aliases: [ucal]
    default_sentence: "{side} {site} calculus ({mm} mm) with {severity} proximal hydroureteronephrosis."
    severity_options: sev.hydro
    laterality_options: lat.rl
    location_options: loc.renal_calculus   # ureteric subset
    measurement_fields: [meas.calculus_size]
    impression_fragment: "{side} {site} calculus ({mm} mm) with {severity} proximal hydroureteronephrosis."
    recommendation_code: [rec.spec_uro, rec.ctkub, rec.lab_urine]
    criticality: significant
    common_combo_tiles: [combo.uskb.colic_classic]

  - id_key: uskb.vuj_calculus
    display_name: VUJ calculus
    category: Ureter
    synonyms: [VUJ stone, vesicoureteric junction calculus]
    keyboard_aliases: [rvuj, lvuj]
    default_sentence: "Calculus ({mm} mm) at the {side} vesicoureteric junction with {severity} proximal hydroureteronephrosis. Bladder well distended at examination."
    severity_options: sev.hydro
    laterality_options: lat.rl
    measurement_fields: [meas.calculus_size]
    impression_fragment: "{side} VUJ calculus ({mm} mm) with {severity} hydroureteronephrosis."
    recommendation_code: [rec.spec_uro, rec.lab_urine]
    criticality: significant

  - id_key: uskb.hun_level
    display_name: Hydroureteronephrosis with obstruction level
    category: Ureter
    synonyms: [HUN, obstructive uropathy]
    keyboard_aliases: [hun]
    default_sentence: "{side} {severity} hydroureteronephrosis, traced up to the {level}; obstructing calculus {seen ({mm} mm)/not separately visualized}."
    severity_options: sev.hydro
    laterality_options: lat.rlb
    location_options: loc.renal_calculus
    impression_fragment: "{side} hydroureteronephrosis — obstruction at {level}."
    recommendation_code: [rec.ctkub, rec.spec_uro]
    criticality: significant

  - id_key: uskb.pyonephrosis
    display_name: Pyonephrosis pattern
    category: Red flags
    synonyms: [infected hydronephrosis, pus in PCS]
    keyboard_aliases: [pyo]
    default_sentence: "{side} kidney shows {severity} PCS dilatation with internal echoes/debris — ?pyonephrosis."
    severity_options: sev.hydro
    laterality_options: lat.rl
    impression_fragment: "?Pyonephrosis {side} — URGENT urology referral advised."
    recommendation_code: [rec.urgent, rec.spec_uro]
    criticality: "critical: crit.pyonephrosis"

  - id_key: uskb.perinephric_fluid
    display_name: Perinephric fluid (forniceal rupture pattern)
    category: Red flags
    keyboard_aliases: [pnf]
    default_sentence: "Perinephric fluid noted around the {side} kidney — suggestive of forniceal rupture in the setting of obstruction."
    laterality_options: lat.rl
    impression_fragment: "Perinephric fluid {side} — forniceal rupture likely; urgent urology opinion advised."
    recommendation_code: [rec.urgent, rec.spec_uro]
    criticality: significant

  - id_key: uskb.dj_stent
    display_name: DJ stent in situ
    category: Post-treatment
    synonyms: [double J stent, ureteric stent]
    keyboard_aliases: [djs]
    default_sentence: "{side} DJ stent in situ with upper coil in the renal pelvis and lower coil in the bladder. {Residual calculus/No residual calculus} seen."
    laterality_options: lat.rlb
    impression_fragment: "{side} DJ stent in situ; {residual status}."
    recommendation_code: [rec.spec_uro]

  - id_key: uskb.bladder_debris
    display_name: Bladder debris / cystitis
    category: Bladder
    keyboard_aliases: [bdb]
    default_sentence: "Internal echoes/debris within the urinary bladder with {mild wall thickening} — cystitis pattern."
    impression_fragment: "Cystitis — urine routine correlation advised."
    recommendation_code: [rec.lab_urine]

ai_assistance:
  missed_finding_checks:
    - Both kidneys individually addressed; PVR when prostate reported
    - Bladder distension adequacy stated (limitation line if poor)
    - Contralateral kidney status when unilateral obstruction found
  contradiction_checks:
    - Calculus site vs HUN side mismatch
    - VUJ calculus reported with "bladder empty" limitation -> flag
  impression_suggestions:
    - Auto-assemble side + site + size + HUN severity into a single colic line
    - Post-treatment comparison ghost (prior calculus resolved/passed)
  follow_up_suggestions:
    - Symptoms + negative USG -> rec.ctkub suggestion (from indication)
    - Post-lithotripsy/stent -> rec.fup_usg6w
```

## 3.7 Study: HRCT Chest

```yaml
study: hrct_chest
modality: CT
aliases: [HRCT chest, HRCT thorax, CT chest plain, HRCT lungs]
default_report_sections: [Clinical details, Technique, Lungs & airways, Pleura, Mediastinum & nodes, Bones/soft tissue, Impression, Advice]
quick_select_groups:
  - pinned: [hrct.normal_study, hrct.tib_active, hrct.sequelae, hrct.uip, hrct.bronchiectasis]
  - Pattern wall: [hrct.ggo, hrct.consolidation, hrct.tib_active, hrct.crazy_paving, hrct.mosaic, hrct.honeycombing(uip)]
  - TB set: [hrct.tib_active, hrct.miliary, hrct.sequelae, hrct.lymphadenopathy]
  - Fibrosis: [hrct.uip, hrct.nsip]
  - Airways: [hrct.bronchiectasis, hrct.mosaic]
  - Nodule/Mass: [hrct.nodule, hrct.mass, hrct.cavity]
  - Pleura/other: [hrct.effusion, hrct.emphysema, hrct.ctss]

findings:
  - id_key: hrct.normal_study
    display_name: Normal HRCT chest
    category: Normal
    keyboard_aliases: [nhr]
    default_sentence: (tpl.normal.hrct_chest)
    impression_fragment: "No significant abnormality in the lung parenchyma, airways, pleura or mediastinum."
    normal_variant: true

  - id_key: hrct.tib_active
    display_name: Tree-in-bud / active infective (Koch's) pattern
    category: Infective/TB
    synonyms: [TIB, centrilobular nodules, active Koch's, endobronchial spread]
    keyboard_aliases: [tib]
    default_sentence: "Clustered centrilobular nodules with tree-in-bud configuration in {lobes}{, with patchy consolidation}{, with thick-walled cavity ({mm} mm)}."
    parameters: [param.lung_distribution]
    location_options: loc.lung_lobes
    measurement_fields: [meas.cavity_wall]
    impression_fragment: "Active infective etiology, likely Koch's — sputum CBNAAT advised."
    recommendation_code: [rec.lab_sputum, rec.spec_pulmo]
    criticality: significant
    common_combo_tiles: [combo.hrct.active_tb]

  - id_key: hrct.consolidation
    display_name: Consolidation (CT)
    category: Infective
    synonyms: [air-space opacity, pneumonic consolidation]
    keyboard_aliases: [cons]
    default_sentence: "Consolidation with air bronchograms in {lobes}."
    location_options: loc.lung_lobes
    impression_fragment: "Consolidation {lobes} — infective etiology likely."
    recommendation_code: [rec.clincorr, rec.fup_cxr2w]

  - id_key: hrct.miliary
    display_name: Miliary nodules
    category: Infective/TB
    synonyms: [miliary TB, random micronodules]
    keyboard_aliases: [mil]
    default_sentence: "Innumerable discrete random micronodules distributed uniformly throughout both lungs — miliary pattern."
    impression_fragment: "Miliary pattern — disseminated Koch's to be excluded; urgent physician correlation advised."
    recommendation_code: [rec.lab_sputum, rec.spec_pulmo, rec.urgent]
    criticality: significant

  - id_key: hrct.sequelae
    display_name: Post-infective sequelae (fibrocalcific)
    category: Infective/TB
    synonyms: [old Koch's, post-TB sequelae, fibrocalcific changes]
    keyboard_aliases: [seq]
    default_sentence: "Fibrocalcific and fibro-atelectatic changes with traction bronchiectasis in {lobes} — sequelae of old infection. No active lesion."
    location_options: loc.lung_lobes
    impression_fragment: "Post-infective (old Koch's) sequelae {lobes}. No active lesion."

  - id_key: hrct.ggo
    display_name: Ground-glass opacities
    category: GGO family
    synonyms: [GGO, ground glass haze]
    keyboard_aliases: [ggo]
    default_sentence: "Patchy ground-glass opacities in {lobes} ({distribution}), involving approximately {pct}% of the lung parenchyma."
    parameters: [param.lung_distribution]
    severity_options: sev.extent_lung
    location_options: loc.lung_lobes
    measurement_fields: [meas.ctss]
    impression_fragment: "Ground-glass opacities ({extent}) — viral/atypical infective etiology likely."
    recommendation_code: [rec.clincorr]
    common_combo_tiles: [combo.hrct.viral_screen]

  - id_key: hrct.crazy_paving
    display_name: Crazy-paving pattern
    category: GGO family
    keyboard_aliases: [czp]
    default_sentence: "Ground-glass opacities with superimposed interlobular septal thickening — crazy-paving pattern, in {lobes}."
    location_options: loc.lung_lobes
    impression_fragment: "Crazy-paving pattern as described."

  - id_key: hrct.op_pattern
    display_name: Organizing pneumonia pattern
    category: GGO family
    synonyms: [OP pattern, peripheral consolidation]
    keyboard_aliases: [opp]
    default_sentence: "Peripheral/peribronchovascular patchy consolidation with reversed-halo areas — organizing pneumonia pattern."
    impression_fragment: "Organizing pneumonia pattern — pulmonology correlation advised."
    recommendation_code: [rec.spec_pulmo]

  - id_key: hrct.uip
    display_name: UIP pattern fibrosis
    category: Fibrosis
    synonyms: [UIP, honeycombing, IPF pattern]
    keyboard_aliases: [uip]
    default_sentence: "Subpleural basal-predominant reticulation with honeycombing and traction bronchiectasis — UIP pattern ({extent})."
    severity_options: sev.extent_lung
    impression_fragment: "UIP pattern of fibrosing ILD — pulmonology referral and PFT advised."
    recommendation_code: [rec.spec_pulmo, rec.pft]
    criticality: significant

  - id_key: hrct.nsip
    display_name: NSIP pattern
    category: Fibrosis
    synonyms: [NSIP, GGO-predominant fibrosis]
    keyboard_aliases: [nsip]
    default_sentence: "Basal-predominant ground-glass opacities with fine reticulation and subpleural sparing — NSIP pattern ({extent})."
    severity_options: sev.extent_lung
    impression_fragment: "NSIP pattern ILD — pulmonology referral; connective tissue workup as advised."
    recommendation_code: [rec.spec_pulmo, rec.pft]
    criticality: significant

  - id_key: hrct.bronchiectasis
    display_name: Bronchiectasis
    category: Airways
    synonyms: [dilated bronchi, traction bronchiectasis]
    keyboard_aliases: [bx]
    default_sentence: "{type} bronchiectasis in {lobes}{, with mucus plugging}{, with surrounding consolidation}."
    parameters: [param.bronchiectasis_type]
    location_options: loc.lung_lobes
    impression_fragment: "{type} bronchiectasis {lobes}."
    recommendation_code: [rec.spec_pulmo]

  - id_key: hrct.mosaic
    display_name: Mosaic attenuation / air-trapping
    category: Airways
    keyboard_aliases: [mos]
    default_sentence: "Mosaic attenuation with lobular air-trapping on expiratory sections — small-airway disease."
    impression_fragment: "Small-airway disease (air-trapping)."
    recommendation_code: [rec.pft]

  - id_key: hrct.emphysema
    display_name: Emphysema
    category: Airways
    synonyms: [centrilobular emphysema, bullae]
    keyboard_aliases: [emp]
    default_sentence: "{centrilobular/paraseptal} emphysematous changes, {extent}, predominantly in the upper lobes{, with bullae (largest {size})}."
    severity_options: sev.extent_lung
    impression_fragment: "Emphysematous changes, {extent}."
    recommendation_code: [rec.pft]

  - id_key: hrct.nodule
    display_name: Pulmonary nodule (Fleischner track)
    category: Nodule/Mass
    synonyms: [lung nodule, SPN, GGN]
    keyboard_aliases: [nod]
    default_sentence: "{character} nodule ({mm} mm average diameter) in the {lobe}, {margin}."
    parameters: [param.nodule_character, param.margin]
    location_options: loc.lung_lobes
    measurement_fields: [meas.nodule_avg]
    impression_fragment: "{character} pulmonary nodule ({mm} mm, {lobe}) — Fleischner-based follow-up as advised."
    recommendation_code: [rec.fleischner]
    criticality: significant

  - id_key: hrct.mass
    display_name: Lung mass (suspicious)
    category: Nodule/Mass
    synonyms: [lung mass, bronchogenic mass, spiculated mass]
    keyboard_aliases: [mass]
    default_sentence: "Spiculated soft-tissue mass ({size}) in the {lobe}{, abutting the pleura/chest wall}{, with mediastinal/hilar lymphadenopathy as below}."
    parameters: [param.size, param.margin]
    location_options: loc.lung_lobes
    measurement_fields: [meas.mass_size_2d, meas.node_short_axis]
    impression_fragment: "Suspicious {lobe} mass — CT-guided biopsy / PET-CT and oncology referral advised."
    recommendation_code: [rec.biopsy, rec.petct, rec.spec_onc]
    criticality: significant

  - id_key: hrct.cavity
    display_name: Cavitary lesion
    category: Nodule/Mass
    synonyms: [cavity, cavitating lesion]
    keyboard_aliases: [cav]
    default_sentence: "{thin/thick}-walled cavity ({size}, wall {mm} mm) in the {lobe}{, with surrounding nodules/consolidation}."
    parameters: [param.size]
    location_options: loc.lung_lobes
    measurement_fields: [meas.cavity_wall]
    impression_fragment: "Cavitary lesion {lobe} — infective (Koch's) vs neoplastic; sputum and further workup advised."
    recommendation_code: [rec.lab_sputum, rec.spec_pulmo]
    criticality: significant

  - id_key: hrct.lymphadenopathy
    display_name: Mediastinal/hilar lymphadenopathy
    category: Mediastinum
    synonyms: [LAP, mediastinal nodes, necrotic nodes]
    keyboard_aliases: [lap]
    default_sentence: "Enlarged {stations} lymph nodes (largest {mm} mm short axis){, with central necrosis}{, with calcification}."
    location_options: loc.node_stations
    measurement_fields: [meas.node_short_axis]
    impression_fragment: "Mediastinal lymphadenopathy as described{ — necrotic nodes favour Koch's}."
    recommendation_code: [rec.clincorr]

  - id_key: hrct.effusion
    display_name: Pleural effusion (CT)
    category: Pleura
    keyboard_aliases: [eff]
    default_sentence: "{side} pleural effusion ({severity}, depth {mm} mm{, HU {value}}){, with underlying collapse/consolidation}."
    severity_options: sev.effusion
    laterality_options: lat.rlb
    measurement_fields: [meas.effusion_depth]
    impression_fragment: "{side} pleural effusion, {severity}."
    recommendation_code: [rec.clincorr]

  - id_key: hrct.ctss
    display_name: CT severity score
    category: Scoring
    synonyms: [CTSS, lobe-wise score]
    keyboard_aliases: [ctss]
    default_sentence: "CT severity score: {n}/25 (lobe-wise scoring)."
    measurement_fields: [meas.ctss]
    impression_fragment: "CT severity score {n}/25."
    tile: true

ai_assistance:
  missed_finding_checks:
    - Every lobe addressed or "rest of the lungs clear" line present
    - Expiratory comment when mosaic pattern described
    - Node comment mandatory when mass present
  contradiction_checks:
    - '"active" and "sequelae" applied to the same lobe without qualifier -> flag'
    - Nodule measurement in text vs meas.nodule_avg divergence
    - UIP wording without basal/subpleural descriptors -> confirm
  impression_suggestions:
    - Pattern + distribution -> differential card (basal subpleural honeycombing -> UIP-first)
    - Auto lobe-wise CTSS sum
    - TB spectrum grouping (TIB + cavity + LAP -> single active-Koch's line)
  follow_up_suggestions:
    - Nodule -> rec.fleischner slotting from meas.nodule_avg + risk (radiologist confirms)
    - ILD -> rec.pft + rec.spec_pulmo pairing
    - Mass -> rec.petct + rec.biopsy pairing
```

## 3.8 Study: Chest X-ray

```yaml
study: cxr
modality: XR
aliases: [chest X-ray, CXR PA, X-ray chest, chest radiograph]
default_report_sections: [Findings, Impression, Advice]   # deliberately short — two-line read
quick_select_groups:
  - pinned: [cxr.normal_study, cxr.kochs_sequelae, cxr.consolidation, cxr.effusion, cxr.cardiomegaly]
  - Zone grid: {rows: loc.lung_zones, patterns: [consolidation, infiltrates, nodule]}
  - TB set: [cxr.kochs_sequelae, cxr.active_kochs, cxr.miliary]
  - Pleura: [cxr.effusion, cxr.pneumothorax, cxr.blunted_cp]
  - Cardiac: [cxr.cardiomegaly, cxr.congestion]
  - Other: [cxr.hyperinflation, cxr.nodule_mass, cxr.rib_fracture, cxr.free_gas]
  - ICU set: [cxr.tubes_lines]

findings:
  - id_key: cxr.normal_study
    display_name: Normal chest X-ray
    category: Normal
    synonyms: [NAD chest, normal CXR]
    keyboard_aliases: [nadx]
    default_sentence: (tpl.normal.cxr)
    impression_fragment: "No significant abnormality detected."
    normal_variant: true

  - id_key: cxr.consolidation
    display_name: Consolidation
    category: Infective
    synonyms: [pneumonia, air-space opacity, haziness]
    keyboard_aliases: [cons]
    default_sentence: "Homogeneous opacity in the {zone}{ with air bronchograms} — consolidation."
    location_options: loc.lung_zones
    impression_fragment: "{zone} consolidation — infective etiology likely."
    recommendation_code: [rec.clincorr, rec.fup_cxr2w]
    common_combo_tiles: [combo.cxr.pneumonia]

  - id_key: cxr.infiltrates
    display_name: Patchy infiltrates
    category: Infective
    synonyms: [patchy opacities, bronchopneumonia]
    keyboard_aliases: [infl]
    default_sentence: "Patchy non-homogeneous opacities in the {zone(s)}."
    location_options: loc.lung_zones
    impression_fragment: "Patchy infiltrates {zones} — infective etiology likely."
    recommendation_code: [rec.clincorr, rec.fup_cxr2w]

  - id_key: cxr.kochs_sequelae
    display_name: Old healed Koch's (fibrocalcific)
    category: TB
    synonyms: [old Koch's, fibrocalcific changes, healed TB]
    keyboard_aliases: [kochs]
    default_sentence: "Fibrocalcific opacities in the {zone(s)} with {apical pleural thickening}{, volume loss with tracheal shift}."
    location_options: loc.lung_zones
    impression_fragment: "Fibrocalcific changes {zones} — sequelae of old healed Koch's. No active lesion."
    common_combo_tiles: [combo.cxr.old_kochs]

  - id_key: cxr.active_kochs
    display_name: Active Koch's pattern
    category: TB
    synonyms: [active TB, upper zone infiltrates with cavity]
    keyboard_aliases: [aktb]
    default_sentence: "Non-homogeneous opacities in the {upper zone(s)}{, with cavitation}."
    location_options: loc.lung_zones
    impression_fragment: "Active Koch's to be excluded — sputum CBNAAT advised."
    recommendation_code: [rec.lab_sputum, rec.hrct]
    criticality: significant

  - id_key: cxr.miliary
    display_name: Miliary pattern (CXR)
    category: TB
    keyboard_aliases: [mil]
    default_sentence: "Innumerable discrete miliary nodules distributed uniformly in both lung fields."
    impression_fragment: "Miliary pattern — disseminated Koch's to be excluded; urgent physician correlation."
    recommendation_code: [rec.lab_sputum, rec.hrct, rec.urgent]
    criticality: significant

  - id_key: cxr.effusion
    display_name: Pleural effusion
    category: Pleura
    synonyms: [pleural fluid, hydrothorax]
    keyboard_aliases: [eff]
    default_sentence: "{side} pleural effusion ({severity}){, with underlying collapse}{, with mediastinal shift to the opposite side}."
    severity_options: sev.effusion
    laterality_options: lat.rlb
    impression_fragment: "{side} pleural effusion, {severity}."
    recommendation_code: [rec.clincorr]
    criticality: "critical_if: massive with mediastinal shift -> crit.massive_effusion"

  - id_key: cxr.blunted_cp
    display_name: Blunted CP angle
    category: Pleura
    synonyms: [CP angle blunting, minimal effusion]
    keyboard_aliases: [cpb]
    default_sentence: "Blunting of the {side} costophrenic angle — minimal effusion/pleural thickening."
    laterality_options: lat.rlb
    impression_fragment: "Blunted {side} CP angle — minimal effusion/thickening."

  - id_key: cxr.pneumothorax
    display_name: Pneumothorax
    category: Pleura
    synonyms: [PTX, collapsed lung]
    keyboard_aliases: [ptx]
    default_sentence: "{side} pneumothorax ({severity}) with visceral pleural edge visible{, with mediastinal shift to the opposite side — tension}."
    severity_options: sev.ptx
    laterality_options: lat.rl
    impression_fragment: "{side} pneumothorax ({severity}) — URGENT attention advised."
    recommendation_code: [rec.urgent]
    criticality: "critical_if: tension/complete -> crit.tension_ptx"

  - id_key: cxr.cardiomegaly
    display_name: Cardiomegaly
    category: Cardiac
    synonyms: [enlarged cardiac shadow, increased CTR]
    keyboard_aliases: [cmg]
    default_sentence: "Cardiac shadow is enlarged (CTR {value})."
    measurement_fields: [meas.ctr]
    impression_fragment: "Cardiomegaly — echocardiographic correlation suggested."
    recommendation_code: [rec.echo_corr]
    common_combo_tiles: [combo.cxr.chf_screen]

  - id_key: cxr.congestion
    display_name: Pulmonary venous congestion
    category: Cardiac
    synonyms: [CHF pattern, pulmonary edema, upper lobe diversion]
    keyboard_aliases: [cong]
    default_sentence: "Prominent upper-lobe vessels with perihilar haze{ and Kerley B lines} — pulmonary venous congestion."
    impression_fragment: "Features of pulmonary venous congestion — clinical/echo correlation."
    recommendation_code: [rec.echo_corr, rec.clincorr]
    criticality: significant

  - id_key: cxr.hyperinflation
    display_name: Hyperinflated lung fields
    category: Airways
    synonyms: [COPD pattern, emphysematous chest]
    keyboard_aliases: [hyp]
    default_sentence: "Both lung fields are hyperinflated with flattened domes of diaphragm — COPD pattern."
    impression_fragment: "Hyperinflated lungs — COPD; PFT correlation advised."
    recommendation_code: [rec.pft]

  - id_key: cxr.nodule_mass
    display_name: Nodule / mass opacity
    category: Nodule/Mass
    synonyms: [coin lesion, lung opacity, SPN]
    keyboard_aliases: [nod]
    default_sentence: "Well-defined {size} nodular/mass opacity in the {zone}."
    parameters: [param.size, param.margin]
    location_options: loc.lung_zones
    impression_fragment: "{zone} nodule/mass — HRCT chest advised for characterization."
    recommendation_code: [rec.hrct]
    criticality: significant

  - id_key: cxr.rib_fracture
    display_name: Rib fracture
    category: Bones
    synonyms: [rib #]
    keyboard_aliases: [ribfx]
    default_sentence: "Fracture of the {side} {rib number(s)} rib(s){, without underlying pneumothorax/hemothorax}."
    laterality_options: lat.rl
    impression_fragment: "{side} rib fracture(s) as described."
    recommendation_code: [rec.clincorr]

  - id_key: cxr.free_gas
    display_name: Free gas under diaphragm
    category: Emergency
    synonyms: [pneumoperitoneum, gas under diaphragm]
    keyboard_aliases: [gas]
    default_sentence: "Crescentic lucency of free gas under the {right} hemidiaphragm."
    impression_fragment: "Pneumoperitoneum — SURGICAL EMERGENCY; findings communicated."
    recommendation_code: [rec.urgent, rec.spec_surg]
    criticality: "critical: crit.free_gas"

  - id_key: cxr.tubes_lines
    display_name: Tubes & lines (ICU film)
    category: ICU
    synonyms: [ET tube, CV line, ICD, NG tube]
    keyboard_aliases: [tube]
    default_sentence: "{device} noted with tip {position}."
    parameters: [param.tube_position]
    impression_fragment: "{device} — {position}."
    criticality: "significant if malpositioned"

ai_assistance:
  missed_finding_checks:
    - Both apices and both CP angles addressed
    - Cardiac size comment present on PA films
    - Underlying PTX/effusion comment when rib fracture reported
  contradiction_checks:
    - CTR value vs cardiomegaly wording mismatch
    - "tension" descriptor without escalation started -> block
  impression_suggestions:
    - CTR auto-calc + cardiomegaly ghost
    - TB pattern -> CBNAAT pairing suggestion
    - Prior-film comparison line ("resolving vs film dated {date}")
  follow_up_suggestions:
    - Consolidation -> rec.fup_cxr2w
    - Nodule/mass -> rec.hrct
    - Equivocal apex -> apical lordotic/HRCT note
```

## 3.9 Study: Lower Limb Doppler

```yaml
study: doppler_ll
modality: US
aliases: [lower limb Doppler, venous Doppler, arterial Doppler, DVT scan, varicose vein Doppler]
default_report_sections: [Clinical details, Grey-scale & compressibility, Doppler findings (segment-wise), Measurements, Impression, Advice]
sub_studies: [venous_dvt, venous_varicose, arterial]
quick_select_groups:
  - pinned: [dopll.normal_venous, dopll.acute_dvt, dopll.sfj_incompetence, dopll.normal_arterial, dopll.perforator]
  - Segment map (venous): loc.venous_ll rendered as tappable limb diagram; states [normal, thrombus, reflux]
  - DVT: [dopll.acute_dvt, dopll.chronic_dvt, dopll.calf_dvt]
  - Varicose: [dopll.sfj_incompetence, dopll.spj_incompetence, dopll.perforator, dopll.varicosities]
  - Arterial: [dopll.normal_arterial, dopll.monophasic, dopll.stenosis, dopll.occlusion, dopll.abi]
  - Soft tissue: [dopll.baker, dopll.cellulitis]

findings:
  - id_key: dopll.normal_venous
    display_name: Normal venous Doppler (no DVT)
    category: DVT
    synonyms: [no DVT, DVT negative]
    keyboard_aliases: [ndvt]
    default_sentence: (tpl.normal.doppler_ll_venous)
    laterality_options: lat.rlb
    impression_fragment: "No evidence of deep venous thrombosis in the {side} lower limb."
    normal_variant: true

  - id_key: dopll.acute_dvt
    display_name: Acute DVT
    category: DVT
    synonyms: [deep vein thrombosis, venous thrombosis]
    keyboard_aliases: [dvt]
    default_sentence: "{segments} are distended, non-compressible and filled with {thrombus_age} echogenic thrombus with absent color flow."
    parameters: [param.thrombus_age]
    laterality_options: lat.rl
    location_options: loc.venous_ll
    measurement_fields: [meas.vein_diameter]
    impression_fragment: "Acute DVT involving {segments} of the {side} lower limb — URGENT physician attention; findings communicated."
    recommendation_code: [rec.urgent]
    criticality: "critical_if: femoro-popliteal segments -> crit.acute_prox_dvt"

  - id_key: dopll.chronic_dvt
    display_name: Chronic DVT / post-thrombotic changes
    category: DVT
    synonyms: [recanalized thrombus, post-thrombotic syndrome]
    keyboard_aliases: [cdvt]
    default_sentence: "{segments} show wall-adherent echogenic thrombus with partial recanalization and reduced compressibility — chronic DVT."
    laterality_options: lat.rl
    location_options: loc.venous_ll
    impression_fragment: "Chronic (partially recanalized) DVT {segments} — continue physician follow-up."
    recommendation_code: [rec.clincorr]

  - id_key: dopll.calf_dvt
    display_name: Calf-vein DVT
    category: DVT
    synonyms: [distal DVT, PTV thrombosis]
    keyboard_aliases: [cfdvt]
    default_sentence: "Non-compressible {posterior tibial/peroneal} veins with echogenic thrombus — calf-vein DVT."
    laterality_options: lat.rl
    impression_fragment: "Isolated calf-vein DVT {side} — physician correlation for anticoagulation decision."
    recommendation_code: [rec.clincorr]
    criticality: significant

  - id_key: dopll.sfj_incompetence
    display_name: SFJ incompetence with GSV reflux
    category: Varicose
    synonyms: [saphenofemoral incompetence, GSV reflux]
    keyboard_aliases: [sfji]
    default_sentence: "Saphenofemoral junction is incompetent with reflux of {sec} s on Valsalva/augmentation. GSV is dilated ({mm} mm at thigh, {mm} mm at knee) with reflux."
    laterality_options: lat.rlb
    measurement_fields: [meas.reflux_duration, meas.vein_diameter]
    impression_fragment: "{side} SFJ incompetence with significant GSV reflux — vascular surgical opinion advised."
    recommendation_code: [rec.spec_vasc]
    common_combo_tiles: [combo.dopll.varicose_map]

  - id_key: dopll.spj_incompetence
    display_name: SPJ/SSV incompetence
    category: Varicose
    synonyms: [saphenopopliteal incompetence, SSV reflux]
    keyboard_aliases: [spji]
    default_sentence: "Saphenopopliteal junction is incompetent with SSV reflux of {sec} s; SSV measures {mm} mm."
    laterality_options: lat.rlb
    measurement_fields: [meas.reflux_duration, meas.vein_diameter]
    impression_fragment: "{side} SPJ/SSV incompetence."
    recommendation_code: [rec.spec_vasc]

  - id_key: dopll.perforator
    display_name: Incompetent perforator(s)
    category: Varicose
    synonyms: [perforator incompetence]
    keyboard_aliases: [perf]
    default_sentence: "Incompetent perforator(s) ({mm} mm) at {cm} cm above the {medial malleolus/knee}."
    laterality_options: lat.rl
    measurement_fields: [meas.vein_diameter]
    impression_fragment: "Incompetent perforators at {locations} — marked for surgery."
    recommendation_code: [rec.spec_vasc]
    common_combo_tiles: [combo.dopll.varicose_map]

  - id_key: dopll.varicosities
    display_name: Superficial varicosities
    category: Varicose
    keyboard_aliases: [varx]
    default_sentence: "Multiple dilated tortuous superficial varicosities noted in the {leg/thigh}."
    laterality_options: lat.rlb
    impression_fragment: "Superficial varicosities as described."

  - id_key: dopll.normal_arterial
    display_name: Normal arterial Doppler
    category: Arterial
    synonyms: [triphasic flow, arterial normal]
    keyboard_aliases: [nart]
    default_sentence: (tpl.normal.doppler_ll_arterial)
    laterality_options: lat.rlb
    measurement_fields: [meas.abi]
    impression_fragment: "Normal arterial study of the {side} lower limb. ABI {value}."
    normal_variant: true

  - id_key: dopll.monophasic
    display_name: Monophasic/dampened flow
    category: Arterial
    synonyms: [dampened waveform, parvus tardus]
    keyboard_aliases: [mono]
    default_sentence: "{segments} show {waveform} dampened flow suggesting significant proximal disease."
    parameters: [param.waveform]
    laterality_options: lat.rl
    location_options: loc.arterial_ll
    measurement_fields: [meas.psv, meas.abi]
    impression_fragment: "Dampened distal flow — significant proximal arterial disease."
    recommendation_code: [rec.spec_vasc, rec.cta]
    criticality: significant

  - id_key: dopll.stenosis
    display_name: Arterial stenosis
    category: Arterial
    synonyms: [plaque with stenosis, PAD]
    keyboard_aliases: [sten]
    default_sentence: "Calcified/soft plaque in the {segment} causing {severity} stenosis (PSV {value} cm/s, ratio {value})."
    severity_options: sev.stenosis_pct
    laterality_options: lat.rl
    location_options: loc.arterial_ll
    measurement_fields: [meas.psv]
    impression_fragment: "{severity} stenosis of {segment}."
    recommendation_code: [rec.spec_vasc, rec.cta]
    criticality: significant

  - id_key: dopll.occlusion
    display_name: Arterial occlusion
    category: Arterial
    synonyms: [blocked artery, no flow]
    keyboard_aliases: [occl]
    default_sentence: "No color flow or Doppler signal in the {segment} — occlusion, with distal reformation via collaterals."
    laterality_options: lat.rl
    location_options: loc.arterial_ll
    measurement_fields: [meas.abi]
    impression_fragment: "Occlusion of {segment} — vascular surgery referral advised."
    recommendation_code: [rec.spec_vasc, rec.cta, rec.urgent]
    criticality: "critical_if: ABI < 0.5 or acute presentation -> crit.critical_ischemia"

  - id_key: dopll.abi
    display_name: ABI record
    category: Arterial
    keyboard_aliases: [abi]
    default_sentence: "ABI: right {value}, left {value}."
    measurement_fields: [meas.abi]
    impression_fragment: "ABI {value} ({band})."

  - id_key: dopll.baker
    display_name: Baker's cyst
    category: Soft tissue
    synonyms: [popliteal cyst]
    keyboard_aliases: [baker]
    default_sentence: "Well-defined cystic lesion ({size}) in the popliteal fossa communicating with the joint — Baker's cyst{, with rupture tracking into the calf}."
    parameters: [param.size]
    laterality_options: lat.rl
    impression_fragment: "{side} Baker's cyst{ (ruptured)} — can mimic DVT clinically."

  - id_key: dopll.cellulitis
    display_name: Cellulitis / subcutaneous edema
    category: Soft tissue
    synonyms: [subcutaneous edema, cobblestone appearance]
    keyboard_aliases: [cell]
    default_sentence: "Diffuse subcutaneous edema with cobblestone appearance in the {leg} — cellulitis pattern. No drainable collection."
    laterality_options: lat.rl
    impression_fragment: "Cellulitis {side} — no DVT, no collection."

ai_assistance:
  missed_finding_checks:
    - Every deep-vein segment addressed on DVT studies (segment-map completeness)
    - ABI recorded on all arterial studies
    - Baker's cyst / cellulitis considered when DVT-negative with swelling indication
  contradiction_checks:
    - Proximal DVT sentence without escalation started -> block at sign
    - Reflux labelled significant with duration below threshold -> flag
    - ABI value vs band wording mismatch
  impression_suggestions:
    - Segment-map auto-assembly into single DVT extent line
    - Reflux significance ghost from meas.reflux_duration
    - ABI band interpretation auto-append
  follow_up_suggestions:
    - Acute DVT -> repeat Doppler after anticoagulation note
    - Varicose mapping -> rec.spec_vasc pairing
    - Claudication-range ABI -> rec.cta suggestion
```

## 3.10 Study: Mammography

```yaml
study: mammography
modality: MG
aliases: [mammogram, MMG, bilateral mammography, screening mammogram]
default_report_sections: [Clinical details, Technique & comparison, Breast composition, Right breast, Left breast, Axillae, Impression (BI-RADS + management), Advice]
hard_rules:
  - Composition (sev.acr_density) is mandatory before sign-off.
  - Every study must end with a BI-RADS assessment; overall = worst side.
  - BI-RADS category cannot be inserted without its bound management line (sev.birads.mandatory_management).
quick_select_groups:
  - pinned: [mmg.normal_b1, mmg.composition, mmg.benign_mass, mmg.birads_assessment, mmg.axillary_node]
  - Composition strip: [a, b, c, d]
  - Mass builder: shape -> margin -> density -> locator (slot chain)
  - Calcification builder: morphology -> distribution -> locator
  - Benign library: [mmg.benign_calcs, mmg.postop_scar, mmg.intramammary_node]
  - Suspicious: [mmg.suspicious_mass, mmg.suspicious_calcs, mmg.asymmetry, mmg.distortion]
  - BI-RADS bar: [b0, b1, b2, b3, b4a, b4b, b4c, b5, b6]

findings:
  - id_key: mmg.normal_b1
    display_name: Normal mammogram (BI-RADS 1)
    category: Normal
    synonyms: [normal MMG, negative mammogram]
    keyboard_aliases: [mmn]
    default_sentence: (tpl.normal.mammography)
    impression_fragment: "BI-RADS 1 — Negative. Routine screening as per age."
    normal_variant: true

  - id_key: mmg.composition
    display_name: Breast composition (ACR a–d)
    category: Composition
    synonyms: [breast density, ACR density]
    keyboard_aliases: [da, db, dc, dd]
    default_sentence: "Both breasts show {composition} fibroglandular composition."
    severity_options: sev.acr_density   # c/d auto-append dense-breast rider
    impression_fragment: null
    tile: true

  - id_key: mmg.benign_mass
    display_name: Benign-appearing mass (fibroadenoma pattern)
    category: Mass
    synonyms: [FA, fibroadenoma, circumscribed mass]
    keyboard_aliases: [fa]
    default_sentence: "Well-circumscribed oval equal-density mass ({size}) in the {locator}{, with coarse popcorn calcification}."
    parameters: [param.mass_shape, param.margin, param.size]
    location_options: loc.breast_locator
    measurement_fields: [meas.mass_size_2d]
    impression_fragment: "Benign-appearing mass {locator} — likely fibroadenoma."
    recommendation_code: [rec.usg_corr]

  - id_key: mmg.suspicious_mass
    display_name: Suspicious mass
    category: Mass
    synonyms: [spiculated mass, irregular mass]
    keyboard_aliases: [spic]
    default_sentence: "Irregular high-density mass ({size}) with {margin} margins in the {locator}{, with associated suspicious calcifications}{, with skin/nipple retraction}."
    parameters: [param.mass_shape, param.margin, param.size]
    location_options: loc.breast_locator
    measurement_fields: [meas.mass_size_2d]
    impression_fragment: "Suspicious mass {locator} — see BI-RADS assessment."
    recommendation_code: [rec.biopsy]   # finalized via BI-RADS binding
    criticality: significant

  - id_key: mmg.benign_calcs
    display_name: Typically benign calcifications
    category: Calcifications
    synonyms: [vascular calcs, popcorn calcs, dystrophic calcs]
    keyboard_aliases: [bcal]
    default_sentence: "{morphology} calcifications in the {locator} — typically benign."
    parameters: [param.calc_morphology]   # benign subset
    location_options: loc.breast_locator
    impression_fragment: "Typically benign calcifications."

  - id_key: mmg.suspicious_calcs
    display_name: Suspicious microcalcifications
    category: Calcifications
    synonyms: [microcalcs, pleomorphic calcifications]
    keyboard_aliases: [scal]
    default_sentence: "{morphology} microcalcifications in {distribution} distribution in the {locator}, extent {mm} mm."
    parameters: [param.calc_morphology, param.calc_distribution]   # suspicious subset
    location_options: loc.breast_locator
    impression_fragment: "Suspicious microcalcifications {locator} — see BI-RADS assessment."
    recommendation_code: [rec.biopsy]
    criticality: significant

  - id_key: mmg.asymmetry
    display_name: Asymmetry / developing asymmetry
    category: Asymmetry
    keyboard_aliases: [asym]
    default_sentence: "{Focal/Global/Developing} asymmetry in the {locator}{, new compared with prior mammogram dated {date}}."
    parameters: [param.change]
    location_options: loc.breast_locator
    impression_fragment: "{type} asymmetry {locator} — see BI-RADS assessment."
    recommendation_code: [rec.usg_corr]
    criticality: "significant if developing/new"

  - id_key: mmg.distortion
    display_name: Architectural distortion
    category: Distortion
    keyboard_aliases: [dist]
    default_sentence: "Architectural distortion in the {locator} without definite central mass{, no prior surgery at this site}."
    location_options: loc.breast_locator
    impression_fragment: "Architectural distortion {locator} — see BI-RADS assessment."
    recommendation_code: [rec.biopsy]
    criticality: significant

  - id_key: mmg.skin_nipple
    display_name: Skin thickening / nipple retraction
    category: Associated features
    keyboard_aliases: [sknp]
    default_sentence: "{Skin thickening/Nipple retraction} noted in the {side} breast{, new compared with priors}."
    laterality_options: lat.rl
    impression_fragment: "Associated {feature} {side} — see BI-RADS assessment."
    criticality: significant

  - id_key: mmg.axillary_node
    display_name: Axillary lymph node
    category: Axilla
    synonyms: [axillary LAP]
    keyboard_aliases: [axn]
    default_sentence: "{side} axillary node(s): {normal with preserved fatty hilum / enlarged, dense, with loss of fatty hilum} ({mm} mm)."
    laterality_options: lat.rlb
    measurement_fields: [meas.node_short_axis]
    impression_fragment: "{side} axillary lymphadenopathy{ — suspicious morphology}."
    criticality: "significant if suspicious morphology"

  - id_key: mmg.postop_scar
    display_name: Post-operative/stable scar
    category: Benign
    keyboard_aliases: [scar]
    default_sentence: "Architectural distortion at the {locator} corresponding to prior surgery — stable compared with prior films."
    location_options: loc.breast_locator
    impression_fragment: "Stable post-surgical changes."
    normal_variant: true

  - id_key: mmg.intramammary_node
    display_name: Intramammary node
    category: Benign
    keyboard_aliases: [imn]
    default_sentence: "Small circumscribed node with fatty hilum in the {locator} — benign intramammary node."
    location_options: loc.breast_locator
    impression_fragment: null
    normal_variant: true

  - id_key: mmg.birads_assessment
    display_name: BI-RADS assessment (+ bound management)
    category: Assessment
    synonyms: [BI-RADS, birads category]
    keyboard_aliases: [b0, b1, b2, b3, b4a, b4b, b4c, b5, b6]
    default_sentence: null   # impression-only entry
    severity_options: sev.birads
    impression_fragment: "BI-RADS {category} — {bound management line}."
    recommendation_code: [bound via sev.birads.management]
    criticality: "critical_if: category 5 -> crit.birads5"
    tile: true

ai_assistance:
  missed_finding_checks:
    - Composition stated; both breasts individually addressed; axillae addressed
    - Palpable-lump side (from indication) explicitly addressed
    - Prior comparison line present when priors exist
  contradiction_checks:
    - Descriptor-vs-BI-RADS gate (spiculated/pleomorphic descriptors with BI-RADS <= 2 -> BLOCK)
    - BI-RADS present without management line -> BLOCK (structural)
    - Finding side vs indication side mismatch -> flag
  impression_suggestions:
    - Overall BI-RADS = worst side, auto-assembled with per-side lines
    - Dense-breast rider auto-append for composition c/d
  follow_up_suggestions:
    - BI-RADS 3 -> rec.fup_mmg6m (bound)
    - BI-RADS 0 -> additional views / rec.usg_corr
    - New/developing asymmetry -> rec.usg_corr pairing
```

---

# 4. Top 100 Quick Select tiles

Ranked by expected daily fire-rate in an Indian diagnostic center (v1 defaults; per-practice analytics re-rank after go-live). Format: rank · tile (finding id) · label.

| # | Tile | Label | # | Tile | Label |
|---|---|---|---|---|---|
| 1 | usab.fatty_liver (fl1) | Fatty liver Gr I | 51 | mrbr.hydrocephalus | Hydrocephalus |
| 2 | usab.normal_study | Normal USG abdomen | 52 | mrbr.ring_lesion | Ring-enhancing lesion |
| 3 | cxr.normal_study | Normal CXR | 53 | mrbr.microbleeds | Microbleeds |
| 4 | usab.fatty_liver (fl2) | Fatty liver Gr II | 54 | mrbr.extraaxial_mass | Meningioma pattern |
| 5 | mrls.normal_study | Normal MRI LS spine | 55 | mrbr.intraaxial_mass | Intra-axial SOL |
| 6 | mrls.protrusion (pv45) | PIVD L4-5 | 56 | ctbr.normal_trauma | NCCT trauma-negative |
| 7 | mrls.protrusion (pv5s1) | PIVD L5-S1 | 57 | ctbr.sdh | SDH |
| 8 | uskb.normal_study | Normal KUB | 58 | ctbr.ich | ICH |
| 9 | usab.cholelithiasis | Gallstones | 59 | ctbr.sah | SAH |
| 10 | usab.renal_calculus (rcal) | Right renal calculus | 60 | ctbr.acute_infarct | CT acute infarct |
| 11 | usab.renal_calculus (lcal) | Left renal calculus | 61 | ctbr.contusions | Contusions |
| 12 | mrbr.normal_study | Normal MRI brain | 62 | ctbr.skull_fracture | Skull fracture |
| 13 | mrbr.svid | SVID (Fazekas) | 63 | ctbr.mls | Midline shift |
| 14 | usab.prostatomegaly (pros2) | Prostatomegaly Gr II | 64 | ctbr.atrophy_svid | Atrophy + SVID (CT) |
| 15 | cxr.kochs_sequelae | Old Koch's | 65 | ctbr.granuloma | Granuloma (CT) |
| 16 | usab.hydronephrosis | Hydronephrosis | 66 | ctbr.edh | EDH |
| 17 | cxr.consolidation | Consolidation | 67 | hrct.normal_study | Normal HRCT |
| 18 | mrls.spondylosis | Lumbar spondylosis | 68 | hrct.ggo | GGO |
| 19 | mrcs.normal_study | Normal MRI C-spine | 69 | hrct.sequelae | Post-TB sequelae |
| 20 | usab.mrd (mrd2) | MRD Gr II | 70 | hrct.tib_active | Tree-in-bud active |
| 21 | uskb.vuj_calculus (rvuj) | Right VUJ calculus | 71 | hrct.bronchiectasis | Bronchiectasis |
| 22 | uskb.vuj_calculus (lvuj) | Left VUJ calculus | 72 | hrct.uip | UIP fibrosis |
| 23 | usab.hepatomegaly | Hepatomegaly | 73 | hrct.nodule | Nodule (Fleischner) |
| 24 | usab.renal_cyst | Renal cortical cyst | 74 | hrct.emphysema | Emphysema |
| 25 | usab.ovarian_cyst | Ovarian cyst | 75 | hrct.effusion | Effusion (CT) |
| 26 | usab.fibroid | Uterine fibroid | 76 | hrct.mass | Lung mass |
| 27 | mrls.straightened_lordosis | Straight lordosis (L) | 77 | hrct.lymphadenopathy | Mediastinal LAP |
| 28 | mrls.bulge (db45) | Bulge L4-5 | 78 | cxr.effusion | Pleural effusion |
| 29 | mrls.canal_stenosis (cs45) | Canal stenosis L4-5 | 79 | cxr.blunted_cp | Blunted CP angle |
| 30 | mrls.foraminal_narrowing | Foraminal narrowing | 80 | cxr.cardiomegaly | Cardiomegaly |
| 31 | mrls.listhesis | Listhesis | 81 | cxr.hyperinflation | COPD pattern |
| 32 | mrls.modic | Modic changes | 82 | cxr.active_kochs | Active Koch's |
| 33 | mrls.hemangioma | Hemangioma | 83 | cxr.infiltrates | Patchy infiltrates |
| 34 | mrls.extrusion (ex45) | Extrusion L4-5 | 84 | cxr.pneumothorax | Pneumothorax |
| 35 | mrcs.cspondylosis | Cervical spondylosis | 85 | cxr.nodule_mass | CXR nodule/mass |
| 36 | mrcs.doc (doc56) | DOC C5-6 | 86 | cxr.rib_fracture | Rib fracture |
| 37 | mrcs.doc (doc67) | DOC C6-7 | 87 | cxr.tubes_lines | ICU tubes/lines |
| 38 | mrcs.straightened_lordosis | Straight lordosis (C) | 88 | dopll.normal_venous | No DVT |
| 39 | mrcs.uncovertebral | UV arthropathy | 89 | dopll.acute_dvt | Acute DVT |
| 40 | usab.gb_wall | Cholecystitis | 90 | dopll.sfj_incompetence | SFJ incompetence |
| 41 | usab.splenomegaly | Splenomegaly | 91 | dopll.perforator | Perforators |
| 42 | usab.cld | CLD pattern | 92 | dopll.normal_arterial | Normal arterial |
| 43 | usab.gb_polyp | GB polyp | 93 | dopll.baker | Baker's cyst |
| 44 | usab.cbd_dilated | CBD dilated | 94 | dopll.cellulitis | Cellulitis |
| 45 | usab.ascites | Ascites | 95 | mmg.normal_b1 | MMG BI-RADS 1 |
| 46 | usab.pco | PCO morphology | 96 | mmg.composition | ACR density |
| 47 | usab.bulky_uterus | Bulky uterus | 97 | mmg.benign_mass | FA pattern |
| 48 | usab.appendicitis | Appendicitis | 98 | mmg.birads_assessment (b2) | BI-RADS 2 |
| 49 | uskb.hun_level | HUN with level | 99 | mmg.birads_assessment (b4a) | BI-RADS 4a |
| 50 | mrbr.granuloma | Granuloma | 100 | mmg.suspicious_calcs | Suspicious calcs |

# 5. Top 50 combo tiles

Combos fire ordered member findings in one gesture; impression assembles automatically. Format: combo id · members · label.

| # | Combo id | Members | Label |
|---|---|---|---|
| 1 | combo.usab.fl_rest_normal | fatty_liver(gr) + rest-normal lines + impression | "FL Gr {n}, rest NAD" |
| 2 | combo.usab.fl_hm | fatty_liver + hepatomegaly | FL + hepatomegaly |
| 3 | combo.usab.chole_rest_normal | cholelithiasis + rest-normal | Gallstones, rest NAD |
| 4 | combo.usab.calc_hn | renal_calculus + hydronephrosis (side-linked) | Calculus + HN |
| 5 | combo.uskb.colic_classic | ureteric_calculus + hun_level + rec.spec_uro | Renal colic classic |
| 6 | combo.usab.bph_screen | prostatomegaly + pvr + cystitis(optional) | BPH screen |
| 7 | combo.usab.fl2_chole | fatty_liver(2) + cholelithiasis | FL II + gallstones |
| 8 | combo.usab.cld_portal | cld + splenomegaly + ascites | CLD + portal HTN screen |
| 9 | combo.usab.pcod_screen | pco + bulky_uterus(optional) | PCOD screen |
| 10 | combo.usab.renal_screen_neg | both-kidneys-normal + bladder-normal | Renal screen negative |
| 11 | combo.usab.gyn_screen | bulky_uterus + fibroid + et | Gyn screen |
| 12 | combo.usab.acute_abd | gb_wall + appendicitis(alt) + ascites(optional) | Acute abdomen set |
| 13 | combo.mrls.spond_strl | spondylosis + straightened_lordosis | Spondylosis + spasm |
| 14 | combo.mrls.pivd_classic | spond_strl + protrusion(L4-5) + canal_stenosis | PIVD classic L4-5 |
| 15 | combo.mrls.pivd_5s1 | spond_strl + protrusion(L5-S1) + foraminal | PIVD classic L5-S1 |
| 16 | combo.mrls.two_level | protrusion(L4-5) + protrusion(L5-S1) | Two-level PIVD |
| 17 | combo.mrls.near_normal | straightened_lordosis + desiccation + "no herniation" | Near-normal LS |
| 18 | combo.mrls.listhesis_set | listhesis + canal_stenosis + pars note | Listhesis set |
| 19 | combo.mrls.osteoporotic | collapse + dexa rec | Osteoporotic collapse |
| 20 | combo.mrcs.spond_strc | cspondylosis + straightened_lordosis | C-spondylosis + spasm |
| 21 | combo.mrcs.doc_classic | spond_strc + doc(C5-6) + foraminal | DOC classic C5-6 |
| 22 | combo.mrbr.svid_age | svid + atrophy + lacunar(optional) | Age-related brain combo |
| 23 | combo.mrbr.stroke_screen | acute_infarct + mra_mrv rec + spec_neuro | Stroke screen positive |
| 24 | combo.mrbr.granuloma_stable | granuloma + no-edema + clincorr | Stable granuloma |
| 25 | combo.mrbr.headache_neg | normal_study + pns_sinusitis(optional) | Headache screen |
| 26 | combo.mrbr.seizure_screen | granuloma/ring_lesion + spec_neuro | Seizure workup |
| 27 | combo.mrbr.mets_screen | intraaxial_mass(multiple) + cemri + onc | Mets screen |
| 28 | combo.ctbr.trauma_neg | normal_trauma + no-fracture line | Trauma negative |
| 29 | combo.ctbr.sdh_emergency | sdh + mls + urgent | SDH emergency |
| 30 | combo.ctbr.stroke_ct | acute_infarct + cemri rec | CT stroke positive |
| 31 | combo.ctbr.contusion_set | contusions + skull_fracture + repeat24h | Contusion set |
| 32 | combo.cxr.old_kochs | kochs_sequelae + "no active" impression | Old Koch's stable |
| 33 | combo.cxr.pneumonia | consolidation + fup_cxr2w + clincorr | Pneumonia set |
| 34 | combo.cxr.chf_screen | cardiomegaly + congestion + echo rec | CHF screen |
| 35 | combo.cxr.copd_set | hyperinflation + pft rec | COPD set |
| 36 | combo.cxr.tb_active_set | active_kochs + sputum rec + hrct rec | Active TB workup |
| 37 | combo.cxr.effusion_set | effusion + clincorr | Effusion set |
| 38 | combo.hrct.active_tb | tib_active + cavity(optional) + lymphadenopathy + sputum | Active Koch's HRCT |
| 39 | combo.hrct.viral_screen | ggo + ctss | Viral pneumonia + score |
| 40 | combo.hrct.ild_workup | uip/nsip + pft + spec_pulmo | ILD workup |
| 41 | combo.hrct.bx_infective | bronchiectasis + tib + sputum | Infected bronchiectasis |
| 42 | combo.hrct.mass_workup | mass + lymphadenopathy + biopsy + petct | Mass workup |
| 43 | combo.dopll.varicose_map | sfj_incompetence + perforator + varicosities | Varicose full map |
| 44 | combo.dopll.dvt_emergency | acute_dvt + urgent | DVT emergency |
| 45 | combo.dopll.swelling_neg | normal_venous + cellulitis/baker(alt) | Swelling, DVT-negative |
| 46 | combo.mmg.screen_neg | composition + normal_b1 | Screening negative |
| 47 | combo.mmg.benign_set | composition + benign_mass + b2 | Benign screen (B2) |
| 48 | combo.uskb.stent_check | dj_stent + residual status | Stent check |
| 49 | combo.uskb.pyonephrosis_set | pyonephrosis + urgent + spec_uro | Pyonephrosis emergency |
| 50 | combo.usab.wa_male_neg | normal_study + prostate-normal + pvr | Male W/A negative |

# 6. Top 100 keyboard aliases

10 per study; study context disambiguates. Format: alias → target.

**MRI Brain:** `nb`→normal · `ain`→acute infarct · `lac`→lacunes · `svi`→SVID · `f2`→Fazekas II · `atr`→atrophy · `gran`→granuloma · `rel`→ring lesion · `hcp`→hydrocephalus · `pns`→sinusitis
**MRI LS Spine:** `nls`→normal · `spond`→spondylosis · `strl`→straight lordosis · `db45`→bulge L4-5 · `pv45`→PIVD L4-5 · `pv5s1`→PIVD L5-S1 · `ex45`→extrusion L4-5 · `cs45`→canal stenosis L4-5 · `lith45`→listhesis L4-5 · `mod2`→Modic II
**MRI C-Spine:** `ncs`→normal · `cspond`→spondylosis · `strc`→straight lordosis · `doc56`→DOC C5-6 · `doc67`→DOC C6-7 · `cpv56`→protrusion C5-6 · `uv56`→UV arthropathy C5-6 · `cfn56`→foraminal C5-6 · `myl`→myelomalacia · `opll`→OPLL
**CT Brain:** `nct`→trauma-negative · `ich`→ICH · `sdh`→SDH · `edh`→EDH · `sah`→SAH · `con`→contusions · `fx`→fracture · `inf`→acute infarct · `mls`→midline shift · `ede`→diffuse edema
**USG Abdomen:** `nab`→normal · `fl1`/`fl2`→fatty liver I/II · `hm`→hepatomegaly · `chole`→gallstones · `gbwt`→cholecystitis · `rcal`→right calculus · `hn2`→moderate HN · `mrd2`→MRD II · `pros2`→prostatomegaly II · `fib`→fibroid
**USG KUB:** `nkub`→normal · `ucal`→ureteric calculus · `rvuj`/`lvuj`→VUJ calculus R/L · `hun`→HUN with level · `pyo`→pyonephrosis · `pnf`→perinephric fluid · `djs`→DJ stent · `bdb`→bladder debris · `rcy`→renal cyst
**HRCT:** `nhr`→normal · `tib`→tree-in-bud · `seq`→sequelae · `ggo`→GGO · `mil`→miliary · `uip`→UIP · `bx`→bronchiectasis · `nod`→nodule · `mass`→mass · `lap`→LAP
**CXR:** `nadx`→normal · `cons`→consolidation · `kochs`→old Koch's · `aktb`→active pattern · `eff`→effusion · `ptx`→pneumothorax · `cmg`→cardiomegaly · `hyp`→hyperinflation · `gas`→free gas · `ribfx`→rib fracture
**Doppler LL:** `ndvt`→no DVT · `dvt`→acute DVT · `cdvt`→chronic DVT · `sfji`→SFJ incompetence · `spji`→SPJ incompetence · `perf`→perforators · `nart`→normal arterial · `mono`→monophasic · `sten`→stenosis · `abi`→ABI record
**Mammography:** `mmn`→normal B1 · `dc`→density c · `fa`→FA pattern · `spic`→suspicious mass · `bcal`→benign calcs · `scal`→suspicious calcs · `asym`→asymmetry · `dist`→distortion · `axn`→axillary node · `b4a`→BI-RADS 4a

# 7. Implementation notes for Sonnet

1. **Source of truth:** this document + `RADIOLOGY_KNOWLEDGE_CATALOG.md`. Where wording differs, this document wins (it is the seed-ready refinement). UX behavior (ghost text, tiles, escalation) comes from the two companion UX/AI specs — do not re-derive it here.
2. **Convert references, don't inline:** `sev.*`, `lat.*`, `loc.*`, `meas.*`, `rec.*`, `crit.*` are shared entities. Seed them once; findings must point to them by key. If you find yourself copying a value list into a finding, stop — bind by reference.
3. **Defaults:** omitted finding fields take the defaults in §1.2. `normal_variant: true` entries must never raise completeness nudges; they are also candidates for auto-fill-on-confirm normal lines.
4. **Sentence slots:** `{slot}` names must match the bound parameter/measurement keys exactly. Optional slots (marked with `{...}` inside braces in sentences) must collapse without leaving punctuation artifacts — treat sentence templates as ordered fragment lists, not raw strings, if that is easier to seed.
5. **Aliases:** run the §2.9 validation (uniqueness + no-prefix-collision per study) at seed time and fail loudly. Level-slotted stems (`db`, `pv`, `ex`, `cs`, `fn`, `lith`, `doc`, `cpv`, `uv`, `cfn`) expand to one alias per disc level of that study — seed the expansion, not the stem.
6. **Criticality:** `critical:` entries always link to their `crit.*` registry key; `critical_if:` carries a plain-language condition string the copilot evaluates — seed the condition text verbatim, do not attempt to formalize it.
7. **BI-RADS binding is structural:** seed `sev.birads` so that inserting a category *always* carries its management line; there must be no seed path that yields a category without management. Same pattern applies to future TI-RADS/PI-RADS scales.
8. **`rec.urgent` and `rec.fleischner` are templated recommendations** with slots filled by workflow/AI at runtime; seed the templates with slot markers intact.
9. **Combos:** seed as ordered member lists with optional members marked (`optional`, `alt` = choose-one). Side-linked combos (e.g. `combo.usab.calc_hn`) share one laterality slot across members.
10. **Tile ranking:** §4 order is the v1 default pin/sort order per study; seed it as initial weight, to be superseded by per-user usage analytics.
11. **Language:** all sentences are practice-editable content, keys are immutable API. Never rename an `id_key` after first release; retire and add instead (per catalog §11.2 governance).
12. **What NOT to seed from this doc:** no schema design, no API shapes, no UI layout — those belong to the frozen architecture and the companion specs. This document is content only.
