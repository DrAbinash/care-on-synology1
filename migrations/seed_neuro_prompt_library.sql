-- ============================================================================
-- Phase 2: Neuro-Specific AI Prompt Library Seed
-- Date:     2026-06-27
-- Owner:    dr_abinash  (also seeded to care_diagnostics as system prompts)
-- Safe:     ON CONFLICT DO NOTHING — idempotent, re-runnable
-- Tables:   ai_prompt_library, ai_prompt_library_versions
-- ============================================================================

-- Ensure tables exist (safe if already there)
CREATE TABLE IF NOT EXISTS ai_prompt_library (
  id           SERIAL PRIMARY KEY,
  name         TEXT    NOT NULL,
  modality     TEXT    NOT NULL,
  prompts_json JSONB   NOT NULL DEFAULT '{}',
  version      INTEGER NOT NULL DEFAULT 1,
  library_owner TEXT   NOT NULL DEFAULT 'care_diagnostics',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   TEXT,
  updated_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_lib_name_owner_uq
  ON ai_prompt_library (name, library_owner);

CREATE TABLE IF NOT EXISTS ai_prompt_library_versions (
  id           SERIAL PRIMARY KEY,
  library_id   INTEGER NOT NULL,
  version      INTEGER NOT NULL,
  prompts_json JSONB   NOT NULL DEFAULT '{}',
  change_notes TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SEED: MRI Brain neuro-specific prompts for Dr. Abinash
-- Each row = one category.
-- prompts_json keys: system, impression, findings, differential, followup, quality, polish, formatting, image_review
-- ============================================================================

DO $$
DECLARE
  v_id INTEGER;
  v_prompts JSONB;
  v_name TEXT;
  v_owner TEXT := 'dr_abinash';
  v_modality TEXT := 'MRI';

  -- ── 1. MRI Brain — Standard Neuro ──────────────────────────────────────────
  v_brain_standard JSONB := jsonb_build_object(
    'system',
    'You are a senior neuroradiologist with subspecialty expertise in brain MRI. You produce concise, accurate, radiologist-level reports using standard RSNA and ACR terminology. You never diagnose — you describe findings and generate differential diagnoses. All impressions require radiologist verification.',

    'impression',
    'Based on the MRI brain findings below, generate a concise IMPRESSION suitable for a final radiology report.

Structure your response as numbered points:
1. Primary finding or "No acute intracranial abnormality" if unremarkable
2. Differential diagnosis where applicable (most likely → least likely)
3. Relevant negative findings that rule out emergencies
4. Recommended follow-up if indicated

Rules:
- Use standard neuroradiology terminology (e.g. "periventricular white matter T2/FLAIR hyperintensities", "restricted diffusion DWI/ADC", "susceptibility artefact SWI")
- State lesion location anatomically (lobe, gyrus, eloquent cortex proximity)
- State measurements in mm for any mass or lesion
- Do NOT use lay language
- Maximum 5 points, each 1–2 lines

FINDINGS:',

    'findings',
    'Review the following MRI brain report text and extract structured key findings.

For each finding, provide:
- Anatomic location (precise: lobe, gyrus, deep/superficial, laterality)
- Sequence signal characteristics (T1/T2/FLAIR/DWI/SWI)
- Size if measurable (mm × mm × mm)
- Enhancement pattern if contrast given
- Clinical significance (incidental / relevant / critical)

Format as a numbered list. Flag any CRITICAL or URGENT findings at the top.

REPORT TEXT:',

    'differential',
    'Given the following MRI brain findings, generate a differential diagnosis list.

For each diagnosis:
- State the likelihood (most likely / possible / less likely)
- State the key supporting MRI features
- State what additional workup would confirm or exclude it

Order from most probable to least probable. Include no more than 5 diagnoses. Use standard neuroradiology nomenclature.

FINDINGS:',

    'followup',
    'Based on these MRI brain findings, recommend appropriate follow-up.

Consider:
1. Urgency (immediate / within 24 h / 1 week / 3 months / 6 months / 1 year)
2. Imaging modality for follow-up (MRI / CT / CTA / DSA / MRA / PET)
3. Clinical referral if indicated (Neurology / Neurosurgery / Oncology / Stroke team)
4. Any additional sequences recommended (perfusion / spectroscopy / functional MRI)

Be concise. State "No follow-up imaging required" if findings are benign and stable.

FINDINGS:',

    'quality',
    'Review this MRI brain report for quality and completeness.

Check for:
1. Is the technique adequately described? (field strength, sequences, planes, contrast if used)
2. Are all standard anatomical regions commented upon? (parenchyma, ventricles, posterior fossa, vasculature, meninges, orbits/PNS if imaged)
3. Is DWI/ADC assessed for acute restriction?
4. Are white matter abnormalities graded (Fazekas scale if applicable)?
5. Is the impression consistent with the findings described?
6. Are measurements provided for any focal lesion?
7. Is clinical history correlated?

Return: [PASS] or [FAIL] for each check with a brief explanation.

REPORT TEXT:',

    'polish',
    'Rewrite the following MRI brain findings section in professional radiologist language.

Rules:
- Preserve all factual content exactly — do not add or remove findings
- Use standard neuroradiology terminology
- Use consistent nomenclature (T1W/T2W/FLAIR/DWI/ADC/SWI not "T1/T2 images")
- Remove informal language, filler phrases, repetition
- Write in present tense, passive voice where standard
- Keep sentences concise — one observation per sentence

ORIGINAL TEXT:',

    'formatting',
    'Format the following MRI brain report according to the Care Diagnostics standard structure:

TECHNIQUE:
[Standard technique description — preserve if given, standardise if vague]

FINDINGS:
BRAIN PARENCHYMA:
[parenchymal findings]

WHITE MATTER:
[white matter findings]

VENTRICULAR SYSTEM / CSF SPACES:
[ventricular findings]

POSTERIOR FOSSA:
[posterior fossa findings]

MIDLINE STRUCTURES:
[midline findings]

SELLAR / PARASELLAR REGION:
[sellar findings]

ORBITS / PNS / MASTOIDS:
[incidental extracranial findings]

VASCULAR FLOW VOIDS / MRA:
[vascular findings if MRA acquired]

IMPRESSION:
[numbered impression points]

Fill in each section from the report text below. Write "Unremarkable" for sections with no positive findings.

REPORT TEXT:',

    'image_review',
    'You are reviewing an MRI brain image. Describe what you observe systematically:

1. PARENCHYMA: signal abnormalities on T1/T2/FLAIR — location, size, character
2. DIFFUSION: restricted diffusion on DWI? ADC dark? Territory?
3. SWI/GRE: susceptibility? Haemorrhage? Calcification? Microbleeds?
4. VENTRICLES: size, symmetry, transependymal signal
5. POSTERIOR FOSSA: cerebellum, brainstem, fourth ventricle
6. VASCULATURE: if MRA present — vessel patency, calibre, aneurysm
7. EXTRAAXIAL: subdural/epidural collections, leptomeningeal signal
8. INCIDENTAL: osseous, orbital, sinus

Flag any CRITICAL findings immediately at the top.

State "not assessable" for any sequence not visible in the image.'
  );

  -- ── 2. MRI Brain — Acute Stroke ────────────────────────────────────────────
  v_brain_stroke JSONB := jsonb_build_object(
    'system',
    'You are a neuroradiologist specialising in stroke imaging. Your primary output is a time-critical radiology report aimed at guiding thrombolysis and thrombectomy decisions. You use precise DWI/ADC/FLAIR/SWI/MRA terminology. You always calculate ASPECTS score when describing MCA territory infarcts. You flag large vessel occlusion (LVO) as CRITICAL.',

    'impression',
    'Generate a STROKE PROTOCOL MRI impression based on these findings.

Structure:
1. Acute infarction: location / arterial territory / DWI-ADC confirmation / size estimate
2. DWI-FLAIR mismatch: FLAIR positive or negative? (guides onset-time window)
3. Haemorrhage: SWI/GRE result — haemorrhagic transformation? Microbleeds count?
4. Large vessel status: MRA — occlusion / stenosis / tandem lesion?
5. ASPECTS score: (if MCA territory) — state score / components affected
6. Clinical recommendation: thrombolysis window open? LVO → thrombectomy candidate?

CRITICAL FLAGS:
- Large vessel occlusion → label as [LVO — URGENT]
- Haemorrhagic transformation → label as [HAEMORRHAGE — CONTRAINDICATION TO THROMBOLYSIS]
- Basilar thrombosis → label as [BASILAR OCCLUSION — EMERGENCY]

FINDINGS:',

    'findings',
    'Extract stroke-protocol-specific findings from the following MRI text:

Report in this order:
1. DWI: restricted diffusion — territory, size (ASPECTS if MCA), laterality
2. ADC: confirmation — dark (true restriction) or bright (shine-through)?
3. FLAIR: positive or negative in DWI territory? (onset timing)
4. SWI/GRE: susceptibility vessel sign? Haemorrhagic transformation? Microbleed count?
5. MRA: vessel patency — occlusion at which level? Residual flow?
6. T2/FLAIR: established infarct, old infarcts, leukoaraiosis

REPORT TEXT:',

    'differential',
    'Differential diagnosis for the following acute stroke MRI findings. Include:
1. Ischaemic stroke (which territory, which mechanism: cardioembolic / large-artery / small-vessel / cryptogenic)
2. Mimics if DWI restriction pattern atypical: abscess / hypercellular tumour / PRES / CJD
3. State key discriminating feature for each mimic

FINDINGS:',

    'followup',
    'Stroke protocol follow-up recommendations:

1. Immediate action: thrombolysis / thrombectomy eligibility (cite DWI-FLAIR mismatch, ASPECTS, LVO)
2. Urgent referral: Neurology stroke team / Interventional radiology
3. Imaging follow-up: MRI / CT 24–48 h (haemorrhagic transformation check post-thrombolysis)
4. Vascular workup: CTA neck (carotid stenosis), bubble echo (PFO), cardiac monitoring
5. Longer-term: MRI 3 months if lacunar / small vessel

FINDINGS:',

    'quality',
    'Quality check for stroke protocol MRI report:

1. DWI and ADC both described and consistent? [PASS/FAIL]
2. FLAIR-DWI mismatch explicitly stated? [PASS/FAIL]
3. SWI/GRE haemorrhage and microbleed assessment? [PASS/FAIL]
4. MRA vessel status documented? [PASS/FAIL]
5. ASPECTS score calculated for MCA territory infarcts? [PASS/FAIL]
6. Thrombolysis / thrombectomy eligibility stated? [PASS/FAIL]
7. Onset time window mentioned? [PASS/FAIL]

REPORT TEXT:',

    'polish',
    'Rewrite this acute stroke MRI report with precise stroke-protocol terminology. Preserve all facts. Use: DWI, ADC, FLAIR, SWI, MRA-TOF. State ASPECTS explicitly for MCA territory. Identify LVO if present. Remove informal language.

ORIGINAL TEXT:',

    'formatting',
    'Format this stroke MRI report into Care Diagnostics stroke protocol structure:

TECHNIQUE:
[Stroke protocol — DWI/ADC/FLAIR/T2/SWI/MRA-TOF — time from door to imaging]

DWI / ADC — RESTRICTED DIFFUSION:

FLAIR / T2 — ESTABLISHED INFARCT vs DWI MISMATCH:

GRE / SWI — HAEMORRHAGE & VESSEL SIGN:

MRA — VESSEL OCCLUSION / STENOSIS:

POSTERIOR FOSSA & BRAINSTEM:

EXTRA-AXIAL SPACES & MIDLINE:

THROMBOLYSIS / THROMBECTOMY ELIGIBILITY:
[State: ASPECTS score, DWI-FLAIR mismatch, LVO present/absent, haemorrhage absent/present]

IMPRESSION:
[Numbered, with urgency labels]

REPORT TEXT:',

    'image_review',
    'Stroke protocol MRI image review. Report in order:
1. DWI: bright signal — territory (MCA/ACA/PCA/posterior circulation/lacunar)? ASPECTS components?
2. ADC: dark in same territory (confirms true restriction)?
3. FLAIR: signal change in DWI territory (YES = >4.5 h onset / NO = <4.5 h, thrombolysis candidate)?
4. SWI: susceptibility vessel sign (dark MCA/basilar)? Haemorrhagic transformation? Microbleeds?
5. MRA: vessel flow visible / absent? Occlusion level (M1/M2/ICA/basilar)?
6. OVERALL: acute stroke confirmed? LVO present? Thrombolysis window?

CRITICAL: Flag LVO immediately.'
  );

  -- ── 3. MRI Brain — Tumour Assessment ───────────────────────────────────────
  v_brain_tumour JSONB := jsonb_build_object(
    'system',
    'You are a neuroradiologist with expertise in brain tumour imaging. You produce detailed, structured oncologic MRI reports using WHO CNS tumour classification terminology (2021). You describe enhancement patterns, mass effect, infiltration, and DWI/ADC characteristics relevant to tumour grading. You always recommend multidisciplinary team (MDT) discussion for new intracranial masses.',

    'impression',
    'Generate an oncologic MRI brain impression for the following findings.

Structure:
1. Mass characterisation: location / size (mm × mm × mm) / T1/T2 signal / enhancement pattern
2. Grade inference: low-grade features (no enhancement, T2 bright, no necrosis) vs high-grade (ring enhancement, central necrosis, low ADC)
3. Primary vs metastatic differential: single vs multiple lesions, cortical/subcortical/deep, other sites
4. Mass effect: midline shift (mm) / herniation risk / eloquent cortex proximity
5. Recommendation: biopsy / staging CT / MDT discussion / follow-up MRI timeline

FINDINGS:',

    'findings',
    'Extract and structure tumour-specific findings from the following MRI text:

1. Location: lobe, gyrus, hemisphere, deep vs superficial, eloquent cortex proximity
2. Morphology: size (3 axes mm), margins (well/ill-defined), internal architecture (solid/cystic/necrotic)
3. Signal: T1 (hypo/iso/hyper), T2 (hypo/iso/hyper), FLAIR (signal, peritumoral oedema extent)
4. Diffusion: DWI hyperintense? ADC value if quantified (low = hypercellular)
5. Perfusion: if available — rCBV, peak height (high = high-grade)
6. Enhancement: pattern (homogeneous / ring / nodular / no enhancement), degree (mild/moderate/intense)
7. Mass effect: sulcal effacement, midline shift, ventricular compression, herniation
8. Multiplicity: single vs multiple lesions

REPORT TEXT:',

    'differential',
    'Differential diagnosis for this intracranial mass on MRI:

For each diagnosis:
- Likelihood: most likely / possible / less likely
- Supporting MRI features (specific sequences)
- Discriminating features from main differential
- Recommended confirmatory test

Include: GBM, metastasis, CNS lymphoma, low-grade glioma, meningioma, abscess (if ring enhancement present), demyelinating pseudotumour

FINDINGS:',

    'followup',
    'Post-MRI follow-up recommendations for intracranial mass:

1. Urgency: surgical biopsy (within X days) vs observation
2. MDT referral: Neurosurgery / Neuro-oncology / Radiation oncology
3. Staging: CT chest/abdomen/pelvis if metastasis suspected
4. Pre-op imaging: functional MRI (eloquent cortex) / MR spectroscopy / perfusion
5. Follow-up if biopsy deferred: MRI brain with contrast in X months
6. Other: lumbar puncture for leptomeningeal / PET scan indication

FINDINGS:',

    'quality',
    'Tumour MRI quality check:

1. Pre- and post-contrast T1 both performed and described? [PASS/FAIL]
2. DWI/ADC included (tumour cellularity)? [PASS/FAIL]
3. Enhancement pattern described (ring/homo/nodular/none)? [PASS/FAIL]
4. Lesion measured in 3 planes? [PASS/FAIL]
5. Mass effect / midline shift quantified? [PASS/FAIL]
6. Peritumoral oedema extent described? [PASS/FAIL]
7. Multiple lesions screened? [PASS/FAIL]
8. MDT discussion recommended? [PASS/FAIL]

REPORT TEXT:',

    'polish',
    'Rewrite this brain tumour MRI report with precise neuro-oncology terminology (WHO CNS 2021). Preserve all facts. Include: enhancement pattern, ADC characteristics, mass effect grading. Remove vague terms (e.g. "bright signal" → "T2/FLAIR hyperintensity"). State measurements explicitly.

ORIGINAL TEXT:',

    'formatting',
    'Format this brain tumour MRI report:

TECHNIQUE:
[Pre and post-contrast sequences — field strength — contrast agent and dose]

BRAIN PARENCHYMA:
MASS CHARACTERISTICS:
  Location:
  Size (mm × mm × mm):
  Morphology (solid/cystic/necrotic):
  T1 signal:
  T2/FLAIR signal:
  Peritumoral oedema:

DIFFUSION:
  DWI signal:
  ADC map:

POST-CONTRAST ENHANCEMENT:
  Pattern:
  Degree:

MASS EFFECT:
  Midline shift:
  Ventricular compression:
  Herniation:

REMAINDER OF BRAIN:
[other findings]

IMPRESSION:
[Numbered — with MDT recommendation]

REPORT TEXT:',

    'image_review',
    'Brain tumour MRI image review:
1. Lesion location: lobe, hemisphere, cortical/subcortical/deep, eloquent cortex?
2. T2/FLAIR: hyperintense? Peritumoral oedema extent?
3. DWI: restricted? (low ADC = hypercellular = high-grade)
4. T1 pre-contrast: hypointense (glioma), hyperintense (haemorrhage/melanoma/protein)
5. T1 post-contrast: enhancement pattern? (ring = GBM/met/abscess; homogeneous = meningioma; no enhancement = low-grade)
6. SWI: haemorrhage? Calcification? Tumour vascularity?
7. Mass effect: midline shift mm? Herniation?
8. Multiplicity: single or multiple lesions?
9. Overall assessment: primary CNS tumour vs metastasis vs other?'
  );

  -- ── 4. MRI Brain — White Matter Disease ─────────────────────────────────────
  v_brain_wm JSONB := jsonb_build_object(
    'system',
    'You are a neuroradiologist specialising in white matter and demyelinating disease. You apply Fazekas scale, McDonald criteria terminology, and distinguish ischaemic from inflammatory white matter disease. You produce structured impressions that guide neurology referral.',

    'impression',
    'Generate an impression for white matter disease on MRI brain.

Structure:
1. Primary finding: WM hyperintensity distribution (periventricular / subcortical / mixed / juxtacortical / infratentorial)
2. Fazekas grade: 0 (none) / 1 (punctate) / 2 (early confluent) / 3 (large confluent) — state separately for periventricular and subcortical
3. Aetiology differential: ischaemic small vessel / demyelinating (MS/NMO) / inflammatory / infectious / metabolic
4. Active vs chronic: enhancement on post-contrast T1? New lesions vs old (FLAIR bright, T1 dark "black holes")?
5. Atrophy: cortical atrophy / deep grey matter volume loss if present
6. Recommendation: Neurology referral / CSF / evoked potentials / follow-up MRI

FINDINGS:',

    'findings',
    'Extract white matter findings from this MRI brain text:

1. Distribution: periventricular / subcortical / juxtacortical / infratentorial (cerebellum, brainstem, spinal cord if mentioned)
2. Fazekas scale: periventricular (0-3) / subcortical (0-3)
3. Morphology: punctate / ovoid (Dawson fingers) / confluent / ring-shaped
4. DWI: any acute restriction?
5. Enhancement: any Gd-enhancing lesions (active demyelination)?
6. T1 "black holes": chronic lesions with permanent axonal loss?
7. Associated findings: corpus callosum involvement / juxtacortical / U-fibre sparing or involvement

REPORT TEXT:',

    'differential',
    'Differential for white matter hyperintensities on MRI brain:

1. Ischaemic small vessel disease (microvascular): age-related, cardiovascular risk factors, subcortical predominance
2. Multiple sclerosis: periventricular, juxtacortical, infratentorial, Dawson fingers, McDonald criteria
3. NMOSD: long cord lesions, area postrema, optic nerve, postrema involvement
4. Migraine-related: young patient, subcortical, bilateral
5. CNS vasculitis: irregular distribution, leptomeningeal enhancement
6. Infection: PML (JC virus), HIV encephalitis, Lyme
7. CADASIL: anterior temporal / external capsule pattern

State discriminating features and recommended workup for each.

FINDINGS:',

    'followup',
    'Follow-up recommendations for white matter disease:

1. Urgency: active enhancement → urgent Neurology (demyelinating workup within 2 weeks)
2. Investigations: CSF oligoclonal bands / IgG index, AQP4-IgG, MOG-IgG, VEP, SSEP
3. If ischaemic: cardiovascular risk assessment, carotid Doppler, echo, Holter
4. Next MRI: 3–6 months with contrast (disease activity) vs 1 year (stable)
5. Disability staging: if MS suspected, arrange formal McDonald criteria assessment

FINDINGS:',

    'quality',
    'White matter disease MRI quality check:

1. FLAIR acquired and adequately suppressed? [PASS/FAIL]
2. Fazekas grade documented for periventricular AND subcortical WM? [PASS/FAIL]
3. Post-contrast T1 for active lesion detection? [PASS/FAIL]
4. Juxtacortical and infratentorial regions assessed? [PASS/FAIL]
5. T1 black holes documented? [PASS/FAIL]
6. Aetiology differential provided? [PASS/FAIL]
7. Neurology referral recommended if appropriate? [PASS/FAIL]

REPORT TEXT:',

    'polish',
    'Rewrite this white matter disease MRI report with precise neuroradiology terminology. Apply: Fazekas scale, Dawson fingers, periventricular/juxtacortical/infratentorial, T1 black holes, McDonald criteria language. Remove vague language.

ORIGINAL TEXT:',

    'formatting',
    'Format this white matter disease MRI report:

TECHNIQUE:
[sequences — contrast status]

WHITE MATTER:
  Periventricular: [Fazekas grade 0-3 — description]
  Subcortical: [Fazekas grade 0-3 — description]
  Juxtacortical: [present/absent — U-fibres]
  Infratentorial: [cerebellum / brainstem lesions]

ACTIVE LESIONS (Post-Contrast):
  [Gd-enhancing lesions — number / location / ring vs open-ring]

CHRONIC LESIONS:
  [T1 black holes — number / location]

REMAINDER OF BRAIN PARENCHYMA:
VENTRICULAR SYSTEM:
CORTICAL ATROPHY:

IMPRESSION:
[Fazekas grade — aetiology — activity — recommendation]

REPORT TEXT:',

    'image_review',
    'White matter disease MRI image review:
1. FLAIR: white matter hyperintensities — periventricular (touching ventricle?) / subcortical / juxtacortical (touching cortex?) / infratentorial?
2. Distribution pattern: Dawson fingers (ovoid, perpendicular to ventricle)? Anterior temporal? External capsule?
3. Fazekas: periventricular grade (0/1/2/3)? Subcortical grade (0/1/2/3)?
4. DWI: any acute restriction?
5. Post-Gd T1: any enhancing lesions (ring/open-ring = active demyelination)?
6. T1: black holes (hypointense, corresponding to FLAIR lesions = chronic axonal loss)?
7. Overall: ischaemic pattern vs demyelinating vs other?'
  );

  -- ── 5. MRI Spine — Cervical/LS/Dorsal ──────────────────────────────────────
  v_spine JSONB := jsonb_build_object(
    'system',
    'You are a musculoskeletal and spine neuroradiologist. You produce structured MRI spine reports using standard spine nomenclature (NASS/RSNA disc nomenclature, Modic classification, Pfirrmann grading, Muhle cord compression grading). You always assess for urgent cord compression and myelopathy.',

    'impression',
    'Generate a spine MRI impression from the following findings.

Structure:
1. Level-by-level disc assessment (worst level first): herniation type / location / nerve root impact
2. Canal stenosis grade at each affected level (mild/moderate/severe with cross-sectional area if measured)
3. Cord/conus signal: T2 hyperintensity (myelopathy)? Grade 0–3 myelopathy?
4. Alignment: spondylolisthesis grade (Meyerding I–IV)? Kyphosis/lordosis?
5. Bone marrow: Modic changes / fracture / STIR-positive oedema?
6. Recommendation: neurosurgical referral threshold / conservative management / follow-up

Urgent: Flag cord compression with myelopathy as [CORD COMPRESSION — URGENT NEUROSURGICAL REFERRAL]

FINDINGS:',

    'findings',
    'Extract structured spine MRI findings:

For each disc level (superior to inferior):
- Disc height: maintained / reduced
- Disc signal: T2 bright (hydrated) / dark (desiccated — Pfirrmann III/IV/V)
- Disc morphology: normal / bulge / protrusion / extrusion / sequestration
- Location: central / subarticular / foraminal / extraforaminal (side)
- Endplate changes: Modic 0/I/II/III

For each level:
- Canal AP diameter / cross-sectional area (if measured)
- Ligamentum flavum: normal / hypertrophied / ossified (thickness mm)
- Foraminal stenosis: normal / mild / moderate / severe (side)
- Nerve root compression: Y/N (which root)

Global:
- Cord/conus: location, signal (T2 hyperintensity = myelopathy?)
- Alignment: curvature, listhesis grade and direction
- Bone marrow: STIR-positive levels?

REPORT TEXT:',

    'differential',
    'Spine MRI differential diagnosis for the following findings:

If canal stenosis / disc pathology:
1. Degenerative disc disease / spondylosis (most common)
2. Disc herniation — subtype and location
3. OPLL / ossification of ligamentum flavum
4. Epidural lipomatosis
5. Epidural haematoma / abscess (if STIR-positive + clinical urgency)

If cord T2 signal change:
1. Compressive myelopathy (most common)
2. Multiple sclerosis cord plaque
3. NMOSD
4. Syrinx / Chiari malformation
5. Cord infarction / AVM

FINDINGS:',

    'followup',
    'Spine MRI follow-up recommendations:

1. Urgent (cord compression + myelopathy): same-day Neurosurgery referral
2. Urgent (cauda equina syndrome): emergency surgical referral
3. Elective (radiculopathy, no myelopathy): physiotherapy / pain management / spine surgeon OPD
4. Conservative: core strengthening, NSAIDs, nerve root injection if foraminal
5. Imaging: CT spine if ossified ligament / OPLL; contrast MRI if infection/tumour suspected
6. Follow-up MRI: 6–12 weeks if conservative; post-op MRI at 3 months

FINDINGS:',

    'quality',
    'Spine MRI quality check:

1. Sagittal T1, T2 and STIR all present? [PASS/FAIL]
2. Axial sequences at all disc levels (individually angled)? [PASS/FAIL]
3. Conus level documented? [PASS/FAIL]
4. All disc levels assessed (superior to inferior)? [PASS/FAIL]
5. Canal stenosis graded? [PASS/FAIL]
6. Cord signal documented? [PASS/FAIL]
7. Modic changes classified? [PASS/FAIL]
8. Myelopathy grade stated if cord signal abnormal? [PASS/FAIL]

REPORT TEXT:',

    'polish',
    'Rewrite this spine MRI report with precise nomenclature: Modic classification, Pfirrmann grading, NASS/RSNA disc herniation terminology (bulge/protrusion/extrusion/sequestration), Muhle myelopathy grading. Remove informal terms. Quantify canal stenosis where measurements given.

ORIGINAL TEXT:',

    'formatting',
    'Format this spine MRI report:

TECHNIQUE:
[sequences — planes — contrast if given]

ALIGNMENT & CURVATURE:
VERTEBRAL BODIES & BONE MARROW:
INTERVERTEBRAL DISCS:
  L1-2 / C2-3 / T1-2 etc.:
  [Pfirrmann grade, herniation type/location, canal impact]
SPINAL CANAL:
  [AP diameter or cross-sectional area at stenotic levels]
CORD / CONUS MEDULLARIS:
  [location, signal, myelopathy grade if applicable]
NEURAL FORAMINA:
  [bilateral assessment — stenosis grade]
FACET JOINTS & POSTERIOR ELEMENTS:
PARASPINAL SOFT TISSUES:

IMPRESSION:
[level-by-level, worst first, with urgency flags]

REPORT TEXT:',

    'image_review',
    'Spine MRI image review:
1. T2 sagittal: disc signal (bright=hydrated/dark=desiccated)? Cord/conus signal (bright = myelopathy)?
2. T1 sagittal: bone marrow (normal/fatty/oedematous)? Modic pattern?
3. STIR sagittal: bone marrow oedema? Level of STIR positivity?
4. T2 axial (each level): central canal compromise? Foraminal stenosis (left/right)? Nerve root compression?
5. Alignment: lordosis/kyphosis normal? Spondylolisthesis (grade)?
6. Overall: myelopathy present? Emergency findings?'
  );

BEGIN
  -- ── Insert MRI Brain Standard ─────────────────────────────────────────────
  v_name := 'MRI Brain';
  INSERT INTO ai_prompt_library (name, modality, prompts_json, version, library_owner, is_active, is_system, created_by)
  VALUES (v_name, v_modality, v_brain_standard, 1, v_owner, TRUE, TRUE, 'phase2-seed')
  ON CONFLICT (name, library_owner) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO ai_prompt_library_versions (library_id, version, prompts_json, change_notes, created_by)
    VALUES (v_id, 1, v_brain_standard, 'Phase 2 seed — standard neuro prompts', 'phase2-seed');
  END IF;

  -- ── Insert MRI Brain Stroke ───────────────────────────────────────────────
  v_name := 'MRI Brain Stroke';
  v_id := NULL;
  INSERT INTO ai_prompt_library (name, modality, prompts_json, version, library_owner, is_active, is_system, created_by)
  VALUES (v_name, v_modality, v_brain_stroke, 1, v_owner, TRUE, TRUE, 'phase2-seed')
  ON CONFLICT (name, library_owner) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO ai_prompt_library_versions (library_id, version, prompts_json, change_notes, created_by)
    VALUES (v_id, 1, v_brain_stroke, 'Phase 2 seed — acute stroke protocol prompts', 'phase2-seed');
  END IF;

  -- ── Insert MRI Brain Tumour ───────────────────────────────────────────────
  v_name := 'MRI Brain Tumour';
  v_id := NULL;
  INSERT INTO ai_prompt_library (name, modality, prompts_json, version, library_owner, is_active, is_system, created_by)
  VALUES (v_name, v_modality, v_brain_tumour, 1, v_owner, TRUE, TRUE, 'phase2-seed')
  ON CONFLICT (name, library_owner) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO ai_prompt_library_versions (library_id, version, prompts_json, change_notes, created_by)
    VALUES (v_id, 1, v_brain_tumour, 'Phase 2 seed — neuro-oncology prompts', 'phase2-seed');
  END IF;

  -- ── Insert MRI Brain White Matter ─────────────────────────────────────────
  v_name := 'MRI Brain White Matter';
  v_id := NULL;
  INSERT INTO ai_prompt_library (name, modality, prompts_json, version, library_owner, is_active, is_system, created_by)
  VALUES (v_name, v_modality, v_brain_wm, 1, v_owner, TRUE, TRUE, 'phase2-seed')
  ON CONFLICT (name, library_owner) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO ai_prompt_library_versions (library_id, version, prompts_json, change_notes, created_by)
    VALUES (v_id, 1, v_brain_wm, 'Phase 2 seed — white matter disease prompts', 'phase2-seed');
  END IF;

  -- ── Insert MRI Spine (covers cervical, LS, dorsal) ────────────────────────
  v_name := 'MRI Spine';
  v_id := NULL;
  INSERT INTO ai_prompt_library (name, modality, prompts_json, version, library_owner, is_active, is_system, created_by)
  VALUES (v_name, v_modality, v_spine, 1, v_owner, TRUE, TRUE, 'phase2-seed')
  ON CONFLICT (name, library_owner) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO ai_prompt_library_versions (library_id, version, prompts_json, change_notes, created_by)
    VALUES (v_id, 1, v_spine, 'Phase 2 seed — spine MRI prompts', 'phase2-seed');
  END IF;

  -- ── Mirror to care_diagnostics as shared system prompts ───────────────────
  INSERT INTO ai_prompt_library (name, modality, prompts_json, version, library_owner, is_active, is_system, created_by)
  SELECT name, modality, prompts_json, 1, 'care_diagnostics', TRUE, TRUE, 'phase2-seed'
  FROM ai_prompt_library
  WHERE library_owner = 'dr_abinash' AND is_system = TRUE
  ON CONFLICT (name, library_owner) DO NOTHING;

  RAISE NOTICE 'Phase 2 prompt seed complete — dr_abinash and care_diagnostics libraries updated';
END $$;
