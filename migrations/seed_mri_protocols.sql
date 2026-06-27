-- ============================================================================
-- Migration: mri_protocol_specs
-- Date:       2026-06-27
-- Author:     Phase 1 MRI Protocol Documentation
-- Safe to re-run: uses ON CONFLICT DO NOTHING
-- ============================================================================

-- Table: mri_protocol_specs
CREATE TABLE IF NOT EXISTS mri_protocol_specs (
  id                      SERIAL PRIMARY KEY,
  protocol_key            TEXT NOT NULL,
  name                    TEXT NOT NULL,
  modality                TEXT NOT NULL,
  body_part               TEXT NOT NULL,
  field_strength_t        TEXT NOT NULL DEFAULT '1.5T/3T',
  indications             JSONB NOT NULL DEFAULT '[]',
  sequences               JSONB NOT NULL DEFAULT '[]',
  quality_checklist       JSONB NOT NULL DEFAULT '[]',
  estimated_scan_time_min INTEGER,
  coverage_notes          TEXT,
  contrast_agent          TEXT,
  contrast_timing_notes   TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  is_system               BOOLEAN NOT NULL DEFAULT FALSE,
  radiologist_notes       TEXT,
  tech_notes              TEXT,
  created_by              TEXT,
  updated_by              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mri_protocol_specs_key_uq   ON mri_protocol_specs (protocol_key);
CREATE INDEX        IF NOT EXISTS mri_protocol_specs_mod_idx  ON mri_protocol_specs (modality);
CREATE INDEX        IF NOT EXISTS mri_protocol_specs_bp_idx   ON mri_protocol_specs (body_part);
CREATE INDEX        IF NOT EXISTS mri_protocol_specs_act_idx  ON mri_protocol_specs (is_active);

-- Table: mri_protocol_quality_results
CREATE TABLE IF NOT EXISTS mri_protocol_quality_results (
  id             SERIAL PRIMARY KEY,
  study_id       INTEGER NOT NULL,
  draft_id       INTEGER,
  protocol_id    INTEGER NOT NULL,
  results        JSONB NOT NULL DEFAULT '{}',
  overall_grade  TEXT NOT NULL DEFAULT 'acceptable',
  quality_notes  TEXT,
  completed_by   TEXT NOT NULL,
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mri_pq_study_idx    ON mri_protocol_quality_results (study_id);
CREATE INDEX IF NOT EXISTS mri_pq_draft_idx    ON mri_protocol_quality_results (draft_id);
CREATE INDEX IF NOT EXISTS mri_pq_protocol_idx ON mri_protocol_quality_results (protocol_id);

-- updated_at trigger (re-entrant)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS mri_protocol_specs_uat    ON mri_protocol_specs;
DROP TRIGGER IF EXISTS mri_pq_results_uat        ON mri_protocol_quality_results;
CREATE TRIGGER mri_protocol_specs_uat    BEFORE UPDATE ON mri_protocol_specs            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER mri_pq_results_uat        BEFORE UPDATE ON mri_protocol_quality_results   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SEED — factory protocols (ON CONFLICT DO NOTHING = safe to re-run)
-- ============================================================================

INSERT INTO mri_protocol_specs
  (protocol_key, name, modality, body_part, field_strength_t, estimated_scan_time_min, is_system,
   indications, quality_checklist, sequences, coverage_notes, radiologist_notes, tech_notes)
VALUES

-- ── MRI BRAIN PLAIN ──────────────────────────────────────────────────────────
('MRI_BRAIN_PLAIN','MRI Brain Plain','MRI','BRAIN','1.5T/3T',35,TRUE,
 '["Headache with red flag features","New-onset seizure / epilepsy","TIA workup (non-urgent)","Cognitive decline / dementia screening","Post-traumatic brain injury (subacute/chronic)","CNS disease surveillance (MS, tumour)","Pre-lumbar-puncture screening"]',
 '[
   {"id":"motion_artifact","label":"No significant motion artifact","description":"All sequences free of ghosting. T2 and FLAIR most susceptible. Rescan if diagnostic quality impaired.","failAction":"reject"},
   {"id":"snr_adequate","label":"Signal-to-noise ratio adequate","description":"Grey-white differentiation visible on T1. Subcortical U-fibres distinct from cortex on T2.","failAction":"warn"},
   {"id":"coverage_complete","label":"Coverage complete (foramen magnum to vertex)","description":"T2 and FLAIR axial slices must include foramen magnum and vertex. Posterior fossa mandatory.","failAction":"reject"},
   {"id":"all_sequences_present","label":"All 6 protocol sequences present","description":"T1-SAG, T2-AX, FLAIR-AX, DWI-AX, SWI-AX, MRA-TOF. Document any omission with reason.","failAction":"warn"},
   {"id":"flair_csf_suppression","label":"FLAIR CSF suppression adequate","description":"Ventricular CSF must appear dark. Incomplete suppression invalidates WM pathology detection.","failAction":"reject"},
   {"id":"dwi_adc_pair","label":"DWI and ADC map both present","description":"ADC mandatory to confirm true restriction vs T2 shine-through. Never report acute infarct without ADC.","failAction":"reject"},
   {"id":"swi_blurring","label":"SWI assessable (not blurred near skull base)","description":"Skull base susceptibility is normal. Assess parenchyma for pathologic blooming.","failAction":"note"}
 ]',
 '[
   {"name":"T1 Sagittal Localiser","abbreviation":"T1-SAG","plane":"Sagittal","technique":"Fast SE localiser","trMs":500,"teMs":20,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Anatomic reference, midline, pituitary, posterior fossa morphology","findingsSensitivity":["Anatomy","Corpus callosum","Posterior fossa"],"sortOrder":1},
   {"name":"T2 Axial FSE","abbreviation":"T2-AX","plane":"Axial","technique":"Fast Spin Echo","trMs":4500,"teMs":110,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Broad parenchymal survey — oedema, gliosis, demyelination, tumour","findingsSensitivity":["Oedema","Gliosis","Tumour","Demyelination","Hydrocephalus"],"sortOrder":2},
   {"name":"FLAIR Axial","abbreviation":"FLAIR","plane":"Axial","technique":"Inversion Recovery FSE (TI ~2300 ms at 3T / ~2100 ms at 1.5T)","trMs":8500,"teMs":120,"tiMs":2300,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"CSF-suppressed: WM disease, cortical lesions, SAH, leptomeningeal spread","findingsSensitivity":["White matter hyperintensities","MS plaques","Cortical infarcts","SAH","Encephalitis","Small vessel disease"],"sortOrder":3},
   {"name":"DWI Axial","abbreviation":"DWI","plane":"Axial","technique":"EPI b=0 & b=1000 s/mm² with ADC map","trMs":null,"teMs":null,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":1000,"includesAdcMap":true,"contrastRequired":false,"purpose":"Acute diffusion restriction — cytotoxic oedema. ADC < 620 um2/s in infarct core.","findingsSensitivity":["Acute stroke (< 24 h)","Abscess","Epidermoid","Lymphoma","High-grade tumour"],"sortOrder":4},
   {"name":"GRE / SWI Axial","abbreviation":"SWI","plane":"Axial","technique":"Susceptibility-Weighted Imaging (2 mm, 0 gap)","trMs":null,"teMs":null,"tiMs":null,"flipAngle":15,"sliceThicknessMm":2,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Paramagnetic substances: haemoglobin breakdown, calcification, iron deposition, microbleeds, CVT","findingsSensitivity":["Microhaemorrhages","Haemorrhagic transformation","Cavernoma","CVT","Calcification","Iron"],"sortOrder":5},
   {"name":"MRA TOF (Circle of Willis)","abbreviation":"MRA-TOF","plane":"Axial 3D","technique":"3D Time-of-Flight non-contrast MRA (1 mm isotropic)","trMs":null,"teMs":null,"tiMs":null,"sliceThicknessMm":1,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Non-contrast angiography: vessel occlusion, stenosis, aneurysm (>= 3 mm), AVM","findingsSensitivity":["ICA/MCA/ACA/PCA occlusion","Stenosis","Aneurysm","AVM","Vessel hypoplasia"],"sortOrder":6}
 ]',
 'Axial slices: foramen magnum to vertex. FLAIR and T2 in same plane for direct comparison. MRA slab: skull base to 40 mm above thalami.',
 'DWI-FLAIR mismatch: DWI positive + FLAIR negative = onset < 4.5 h (thrombolysis candidate). Fazekas scale (0-3) for WM hyperintensities on FLAIR. SWI susceptibility vessel sign = large vessel thrombosis. Always inspect posterior fossa on dedicated coronal/sagittal if clinically suspected.',
 'Head coil. Remove all metallic items. Contraindications: pacemaker, cochlear implant (absolute). FLAIR TI: 3T = 2300 ms, 1.5T = 2100 ms. SWI slab covers full cerebrum. MRA slab: skull base to vertex.'
),

-- ── MRI BRAIN CONTRAST ────────────────────────────────────────────────────────
('MRI_BRAIN_CONTRAST','MRI Brain with Gadolinium Contrast','MRI','BRAIN','1.5T/3T',50,TRUE,
 '["Known/suspected intracranial tumour","Leptomeningeal carcinomatosis","Post-op tumour surveillance","Active CNS infection (meningitis, abscess, encephalitis)","MS active lesion detection","Vasculitis / inflammatory disease","Cranial nerve palsy (perineural spread)","CSF leak / intracranial hypotension","Post-radiotherapy change vs recurrence"]',
 '[
   {"id":"motion_artifact","label":"No motion artifact (pre and post contrast)","description":"Post-contrast sequences especially vulnerable if patient moves. Repeat if non-diagnostic.","failAction":"reject"},
   {"id":"snr_adequate","label":"SNR adequate pre and post contrast","description":"Pre-contrast T1 baseline must match post-contrast noise level for true enhancement detection.","failAction":"warn"},
   {"id":"coverage_complete","label":"Coverage complete — skull base to vertex all planes","description":"All three post-contrast planes (axial, sagittal, coronal) must cover full brain.","failAction":"reject"},
   {"id":"all_sequences_present","label":"All 8 protocol sequences acquired","description":"Pre: T1-SAG, T2-AX, FLAIR-AX, DWI-AX, SWI-AX. Post-Gd: T1-AX-FS, T1-SAG-FS, T1-COR-FS.","failAction":"warn"},
   {"id":"flair_csf_suppression","label":"FLAIR CSF suppression adequate","description":"Required for leptomeningeal FLAIR signal interpretation.","failAction":"reject"},
   {"id":"dwi_adc_pair","label":"DWI and ADC map present","description":"Required for tumour grading (ADC histogram) and abscess characterisation.","failAction":"reject"},
   {"id":"contrast_timing","label":"Post-contrast delay 5-10 minutes","description":"Early phase (< 3 min) shows vascular enhancement only. Delayed phase required for leptomeningeal / IAC / skull base.","failAction":"warn"},
   {"id":"post_gd_fat_sat","label":"Fat saturation on all post-Gd sequences","description":"Fat sat essential for dural, orbital, skull base enhancement detection. Incomplete = non-diagnostic.","failAction":"warn"}
 ]',
 '[
   {"name":"T1 Sagittal (pre-contrast)","abbreviation":"T1-SAG-PRE","plane":"Sagittal","technique":"Fast SE","trMs":500,"teMs":20,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Pre-contrast reference, subacute haemorrhage, fat, melanin","findingsSensitivity":["Subacute haemorrhage","Fat lesion","Melanin"],"sortOrder":1},
   {"name":"T2 Axial FSE (pre-contrast)","abbreviation":"T2-AX","plane":"Axial","technique":"Fast Spin Echo","trMs":4500,"teMs":110,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Mass extent, oedema, cyst vs solid","findingsSensitivity":["Oedema","Tumour extent","Cyst"],"sortOrder":2},
   {"name":"FLAIR Axial (pre-contrast)","abbreviation":"FLAIR","plane":"Axial","technique":"Inversion Recovery FSE TI ~2300 ms","trMs":8500,"teMs":120,"tiMs":2300,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"WM infiltration, leptomeningeal FLAIR signal, cortical lesions","findingsSensitivity":["Tumour infiltration","Leptomeningeal disease","WM lesions","Encephalitis"],"sortOrder":3},
   {"name":"DWI Axial (pre-contrast)","abbreviation":"DWI","plane":"Axial","technique":"EPI b=0 & b=1000 with ADC","trMs":null,"teMs":null,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":1000,"includesAdcMap":true,"contrastRequired":false,"purpose":"Tumour cellularity (low ADC = high grade), abscess, epidermoid","findingsSensitivity":["High-grade tumour","Abscess","Epidermoid","Lymphoma"],"sortOrder":4},
   {"name":"SWI Axial (pre-contrast)","abbreviation":"SWI","plane":"Axial","technique":"Susceptibility-Weighted Imaging 2 mm","trMs":null,"teMs":null,"tiMs":null,"flipAngle":15,"sliceThicknessMm":2,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Tumour haemorrhage, cavernoma, radiation microbleeds","findingsSensitivity":["Tumour haemorrhage","Cavernoma","Microbleeds"],"sortOrder":5},
   {"name":"Post-Gd T1 Axial FS","abbreviation":"T1-POST-AX","plane":"Axial","technique":"T1 FSE fat-sat, 5 min post-Gd","trMs":500,"teMs":20,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":true,"purpose":"BBB disruption, enhancement pattern, leptomeningeal enhancement","findingsSensitivity":["Tumour enhancement","Meningeal enhancement","Active MS plaque"],"sortOrder":6},
   {"name":"Post-Gd T1 Sagittal FS","abbreviation":"T1-POST-SAG","plane":"Sagittal","technique":"T1 FSE fat-sat, post-Gd","trMs":500,"teMs":20,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":true,"purpose":"Pituitary, posterior fossa, corpus callosum, spinal drop mets","findingsSensitivity":["Pituitary adenoma","Leptomeningeal mets","Posterior fossa enhancement"],"sortOrder":7},
   {"name":"Post-Gd T1 Coronal FS","abbreviation":"T1-POST-COR","plane":"Coronal","technique":"T1 FSE fat-sat, post-Gd","trMs":500,"teMs":20,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":true,"purpose":"Cavernous sinus, IAC, cranial nerves, orbital apex, skull base perineural spread","findingsSensitivity":["Cavernous sinus","IAC enhancement","Perineural spread","Dural vs leptomeningeal"],"sortOrder":8}
 ]',
 'Post-contrast planes must match pre-contrast slice position for direct comparison. Standard Gd 0.1 mmol/kg; double-dose for leptomeningeal or lymphoma on request.',
 'Enhancement patterns: Ring (thick irregular = GBM/met; thin smooth = abscess). Homogeneous = meningioma (dural tail), schwannoma. Nodular = metastasis. Leptomeningeal (sulcal) = carcinomatosis, meningitis, neurosarcoid. Pachymeningeal (dural) = post-LP, SDH, mets. No enhancement does not exclude malignancy (low-grade glioma, steroid-treated lymphoma).',
 'IV cannula 20-22G antecubital. eGFR > 30 ml/min required (check within 3 months). Flush 20 ml saline before and after Gd. Start post-contrast at 5 min. Prioritise coronal for IAC/perineural spread.'
),

-- ── MRI STROKE PROTOCOL ───────────────────────────────────────────────────────
('MRI_STROKE_PROTOCOL','MRI Brain Stroke Protocol','MRI','BRAIN','1.5T/3T',20,TRUE,
 '["Acute neurological deficit suggestive of ischaemic stroke (within 24 h)","TIA with high-risk features (ABCD2 >= 4)","Wake-up stroke or uncertain onset time","Posterior circulation syndrome","Suspected basilar artery thrombosis","Pre-thrombectomy imaging"]',
 '[
   {"id":"motion_artifact","label":"No motion artifact on DWI or FLAIR","description":"DWI is EPI-based — extremely susceptible to motion ghosting. Rescan immediately.","failAction":"reject"},
   {"id":"dwi_adc_pair","label":"DWI and ADC map both present","description":"ADC confirmation mandatory. Never diagnose stroke on DWI alone. ADC value documentation required.","failAction":"reject"},
   {"id":"flair_csf_suppression","label":"FLAIR CSF suppression adequate","description":"Required for DWI-FLAIR mismatch (onset time) assessment.","failAction":"reject"},
   {"id":"swi_blurring","label":"SWI assessable (not degraded by motion)","description":"Microbleed count for thrombolysis candidacy. Document if non-diagnostic.","failAction":"warn"},
   {"id":"mra_coverage","label":"MRA covers Circle of Willis and posterior circulation","description":"Slab must include M1/M2 MCA, ACA, PCA, basilar, intracranial vertebrals, ICA terminus.","failAction":"reject"},
   {"id":"acquisition_time_target","label":"Total acquisition time <= 20 minutes","description":"Door-to-image target for acute stroke. Thrombolysis/thrombectomy decision depends on prompt imaging.","failAction":"note"}
 ]',
 '[
   {"name":"DWI Axial (FIRST — acquire immediately)","abbreviation":"DWI","plane":"Axial","technique":"EPI b=0 & b=1000 s/mm² with ADC map","trMs":null,"teMs":null,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":1000,"includesAdcMap":true,"contrastRequired":false,"purpose":"PRIORITY: acute cytotoxic oedema within minutes of onset. ADC < 620 um2/s = infarct core. Report immediately.","findingsSensitivity":["Acute infarct (minutes to 7 days)","Lacunar infarct","Brainstem infarct"],"sortOrder":1},
   {"name":"FLAIR Axial","abbreviation":"FLAIR","plane":"Axial","technique":"Inversion Recovery FSE TI ~2300 ms","trMs":8500,"teMs":120,"tiMs":2300,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"DWI-FLAIR mismatch: FLAIR negative = onset < 4.5 h (thrombolysis window). FLAIR positive = established infarct.","findingsSensitivity":["Established infarct (> 4-6 h)","Slow flow (ivy sign)","Old infarcts"],"sortOrder":2},
   {"name":"T2 Axial FSE","abbreviation":"T2-AX","plane":"Axial","technique":"Fast Spin Echo","trMs":4500,"teMs":110,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Oedema, mass lesions, established infarct cortical ribbon, vessel flow void loss","findingsSensitivity":["Oedema > 6 h","Flow void loss (thrombosis)","Haemorrhage"],"sortOrder":3},
   {"name":"GRE / SWI Axial","abbreviation":"SWI","plane":"Axial","technique":"Susceptibility-Weighted Imaging 2 mm","trMs":null,"teMs":null,"tiMs":null,"flipAngle":15,"sliceThicknessMm":2,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Haemorrhagic transformation, susceptibility vessel sign (clot), microbleeds (thrombolysis risk)","findingsSensitivity":["Haemorrhagic transformation","Susceptibility vessel sign","Microbleeds","CVT"],"sortOrder":4},
   {"name":"MRA TOF (Circle of Willis)","abbreviation":"MRA-TOF","plane":"Axial 3D","technique":"3D Time-of-Flight non-contrast MRA 1 mm","trMs":null,"teMs":null,"tiMs":null,"sliceThicknessMm":1,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Vessel occlusion (LVO — MCA M1/M2, ICA, basilar), stenosis, tandem lesion","findingsSensitivity":["Large vessel occlusion","ICA dissection","Basilar thrombosis","Intracranial stenosis","Aneurysm"],"sortOrder":5},
   {"name":"T1 Axial","abbreviation":"T1-AX","plane":"Axial","technique":"Fast SE / Gradient Echo","trMs":500,"teMs":20,"tiMs":null,"sliceThicknessMm":5,"interSliceGapMm":1,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Subacute haemorrhage T1-bright (methaemoglobin), fat lesion, baseline","findingsSensitivity":["Subacute haemorrhage","Cavernoma rim"],"sortOrder":6}
 ]',
 'DWI must be first sequence. Alert radiologist immediately for acute infarct. MRA acquired last to maximise DWI/FLAIR processing time.',
 'ASPECTS score on DWI (10 = normal; <= 6 = poor prognosis / relative CI thrombectomy). DWI-FLAIR mismatch = thrombolysis window open. LVO on MRA = call Neurology immediately. Brainstem DWI: request 3 mm slices if posterior circulation stroke suspected. Exclude haemorrhage on SWI before thrombolysis.',
 'TIME-CRITICAL protocol. Alert radiologist as patient enters scanner. Do not wait for full acquisition. NIHSS and last-known-well time mandatory before scan.'
),

-- ── MRI LS SPINE ─────────────────────────────────────────────────────────────
('MRI_LS_SPINE','MRI Lumbosacral Spine','MRI','SPINE_LS','1.5T/3T',30,TRUE,
 '["Low back pain with radiculopathy (sciatica, L4/L5/S1 distribution)","Disc herniation assessment","Lumbar canal stenosis","Spondylolisthesis","Post-operative spine / failed back","Cauda equina syndrome (emergency)","Suspected spondylodiscitis","Malignant cord or cauda compression"]',
 '[
   {"id":"motion_artifact","label":"No motion artifact on sagittal sequences","description":"Sagittal T1, T2, STIR must be free of motion ghost. CSF pulsation artefact on T2 is common.","failAction":"reject"},
   {"id":"coverage_complete","label":"Coverage L1 to S2 inclusive (conus visible)","description":"Sagittal must include T12-L1 junction superiorly and sacrum inferiorly. Conus must be documented.","failAction":"reject"},
   {"id":"all_sequences_present","label":"All 4 sequences acquired","description":"T1-SAG, T2-SAG, STIR-SAG, T2-AX at L1-2 through L5-S1.","failAction":"warn"},
   {"id":"axial_disc_angulation","label":"Axial slices angled to each disc endplate","description":"Each disc level axial must be individually angled on scout. Straight axials non-diagnostic for foraminal disease.","failAction":"warn"},
   {"id":"stir_fat_suppression","label":"STIR fat suppression homogeneous","description":"Inhomogeneous fat suppression invalidates bone marrow oedema detection.","failAction":"warn"},
   {"id":"conus_visualised","label":"Conus medullaris visible and level documented","description":"Normal conus: T12-L2. Cord tethering or infiltration must not be missed.","failAction":"reject"}
 ]',
 '[
   {"name":"T1 Sagittal FSE","abbreviation":"T1-SAG","plane":"Sagittal","technique":"Fast SE TR ~600 ms / TE ~15 ms","trMs":600,"teMs":15,"tiMs":null,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Bone marrow (Modic I/II), disc height, conus, epidural fat anatomy","findingsSensitivity":["Bone marrow infiltration","Modic changes","Disc height","Conus","Epidural fat"],"sortOrder":1},
   {"name":"T2 Sagittal FSE","abbreviation":"T2-SAG","plane":"Sagittal","technique":"Fast SE TR ~3500 ms / TE ~110 ms","trMs":3500,"teMs":110,"tiMs":null,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Disc hydration, annular tear (HIZ), cord signal, CSF compression, ligamentum flavum hypertrophy","findingsSensitivity":["Disc desiccation","Annular tear (HIZ)","Cord signal","CSF compression","Facet hypertrophy"],"sortOrder":2},
   {"name":"STIR Sagittal","abbreviation":"STIR-SAG","plane":"Sagittal","technique":"STIR TI ~150 ms fat-suppressed T2","trMs":3000,"teMs":40,"tiMs":150,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Bone marrow oedema: Modic I, insufficiency fracture, spondylodiscitis, metastasis","findingsSensitivity":["Vertebral marrow oedema","Fracture acuity","Spondylodiscitis","Metastasis","Sacral insufficiency fracture"],"sortOrder":3},
   {"name":"T2 Axial FSE (disc levels L1-2 to L5-S1)","abbreviation":"T2-AX","plane":"Axial","technique":"Fast SE 3 mm angled to disc endplate","trMs":3500,"teMs":110,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Disc herniation morphology/direction, canal cross-sectional area, foraminal compression, nerve root","findingsSensitivity":["Central disc herniation","Subarticular disc","Foraminal disc","Far-lateral disc","Canal stenosis","Nerve root compression"],"sortOrder":4}
 ]',
 'Sagittal: L1 to S2. Axial: separate slab per disc level L1-2 to L5-S1, angled to endplate individually.',
 'Disc herniation nomenclature: Bulge (circumferential) / Protrusion (base > dome) / Extrusion (dome > base, may migrate) / Sequestration (free fragment). Location: Central / Subarticular / Foraminal / Extraforaminal. Modic: I = T1 dark T2 bright (oedema/active) / II = T1 bright T2 bright (fatty/chronic) / III = T1 dark T2 dark (sclerosis). Canal stenosis: mild > 100 mm2 / moderate 75-100 mm2 / severe < 75 mm2.',
 '3T preferred for foraminal detail. Axial: 3 slabs at 5 disc levels (L1-2 to L5-S1), angled individually on scout. Add post-contrast T1 FS sagittal and axial if spondylodiscitis suspected.'
),

-- ── MRI CERVICAL SPINE ────────────────────────────────────────────────────────
('MRI_CERVICAL_SPINE','MRI Cervical Spine','MRI','SPINE_CERVICAL','1.5T/3T',30,TRUE,
 '["Cervical radiculopathy (C5-C8 dermatomal distribution)","Cervical myelopathy (gait disturbance, hand clumsiness, UMN signs)","Cervical disc herniation","OPLL assessment","Post-traumatic cervical injury","Craniocervical junction anomaly","Cord syrinx evaluation"]',
 '[
   {"id":"motion_artifact","label":"No swallowing artifact on sagittal sequences","description":"Swallowing ghosting on cervical sagittal is most common artefact. Use anterior saturation band. Rescan if severe.","failAction":"reject"},
   {"id":"coverage_complete","label":"Coverage foramen magnum to C7-T1 disc","description":"Sagittal must include foramen magnum superiorly and C7-T1 junction inferiorly. Craniocervical junction mandatory.","failAction":"reject"},
   {"id":"all_sequences_present","label":"All 4 core sequences acquired","description":"T1-SAG, T2-SAG, STIR-SAG, T2-AX (C2-3 to C7-T1). GRE-AX if trauma/haemorrhagic myelopathy.","failAction":"warn"},
   {"id":"craniocervical_junction_included","label":"Craniocervical junction fully included","description":"C1-C2 relationship, odontoid, foramen magnum must be assessable for atlanto-axial instability and Chiari.","failAction":"warn"},
   {"id":"axial_disc_angulation","label":"Axial slices angled to each disc level","description":"C2-3 through C7-T1 individually angled on scout. Straight axials inadequate for foraminal assessment.","failAction":"warn"},
   {"id":"stir_fat_suppression","label":"STIR fat suppression homogeneous","description":"Air-bone interface at C7-T1 may degrade suppression. Document if non-diagnostic at lower levels.","failAction":"warn"}
 ]',
 '[
   {"name":"T1 Sagittal FSE","abbreviation":"T1-SAG","plane":"Sagittal","technique":"Fast SE TR ~600 ms / TE ~15 ms","trMs":600,"teMs":15,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Bone marrow, disc height, cord morphology, epidural fat, foramen magnum","findingsSensitivity":["Bone marrow infiltration","Disc height","Cord atrophy","OPLL","Extramedullary lesion"],"sortOrder":1},
   {"name":"T2 Sagittal FSE","abbreviation":"T2-SAG","plane":"Sagittal","technique":"Fast SE TR ~3500 ms / TE ~110 ms","trMs":3500,"teMs":110,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Cord signal change (myelopathy), disc herniation, CSF outline, foramen magnum, syrinx","findingsSensitivity":["Cord T2 hyperintensity (myelopathy)","Disc herniation","Syrinx","CSF flow","Cord compression grade"],"sortOrder":2},
   {"name":"STIR Sagittal","abbreviation":"STIR-SAG","plane":"Sagittal","technique":"STIR TI ~150 ms","trMs":3000,"teMs":40,"tiMs":150,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Bone marrow oedema, ligamentous injury in trauma, cord contusion signal","findingsSensitivity":["Vertebral oedema","Ligamentous injury","Cord contusion","Discitis-osteomyelitis"],"sortOrder":3},
   {"name":"T2 Axial FSE","abbreviation":"T2-AX","plane":"Axial","technique":"Fast SE 3 mm angled to disc","trMs":3500,"teMs":110,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Cord cross-section, canal dimensions, foraminal stenosis, uncovertebral hypertrophy","findingsSensitivity":["Cord signal cross-section","Foraminal narrowing","Uncinate hypertrophy","Central/paracentral disc","Ligamentum flavum"],"sortOrder":4},
   {"name":"GRE Axial (trauma / myelopathy)","abbreviation":"GRE-AX","plane":"Axial","technique":"Gradient Echo T2* 3 mm","trMs":null,"teMs":null,"tiMs":null,"flipAngle":15,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Cord haemorrhage (poor prognosis), OPLL calcification extent, microbleeds","findingsSensitivity":["Haemorrhagic cord contusion","OPLL calcification","Microhaemorrhage"],"sortOrder":5}
 ]',
 'Sagittal: foramen magnum to C7-T1. Axial: C2-3 to C7-T1 individually angled. FOV: include posterior elements and prevertebral soft tissues.',
 'Myelopathy grading: Grade 0 (no cord signal). Grade 1 (T2 hyperintensity only). Grade 2 (T2 + T1 hypointensity = poor prognosis). Grade 3 (atrophy + signal). Cord compression: Muhle Grade 0-3. Document: cord AP diameter at compression, signal change, multi-level disease, foramen magnum competence.',
 'Cervical spine coil. Saturation band on anterior neck (swallowing). Phase-encode direction: S-I to reduce swallowing ghost onto cord. Slices angled parallel to disc endplates. Extend FOV to C7-T1. Add post-contrast T1 FS sagittal and axial for infection or tumour.'
),

-- ── MRI DORSAL SPINE ─────────────────────────────────────────────────────────
('MRI_DORSAL_SPINE','MRI Dorsal (Thoracic) Spine','MRI','SPINE_THORACIC','1.5T/3T',30,TRUE,
 '["Thoracic myelopathy","Thoracic disc herniation","Vertebral fracture / collapse (benign vs pathological)","Suspected spinal metastases","Spondylodiscitis (thoracic)","Cord syrinx (thoracic)","MS cord plaques / NMO lesion"]',
 '[
   {"id":"motion_artifact","label":"No cardiac/respiratory pulsation on cord","description":"CSF pulsation artefact significant in thoracic spine. Use cardiac gating if cord signal equivocal.","failAction":"warn"},
   {"id":"coverage_complete","label":"Coverage T1 to T12-L1 (conus visible)","description":"Sagittal must include T1 vertebra superiorly and conus medullaris inferiorly.","failAction":"reject"},
   {"id":"all_sequences_present","label":"3 sagittal + targeted axial sequences","description":"T1-SAG, T2-SAG, STIR-SAG mandatory. Axial at symptomatic levels.","failAction":"warn"},
   {"id":"stir_fat_suppression","label":"STIR fat suppression homogeneous","description":"Thoracic STIR susceptible to field inhomogeneity. Ensure adequate suppression at mid and lower levels.","failAction":"warn"}
 ]',
 '[
   {"name":"T1 Sagittal FSE","abbreviation":"T1-SAG","plane":"Sagittal","technique":"Fast SE 4 mm","trMs":600,"teMs":15,"tiMs":null,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Bone marrow, vertebral collapse height, cord morphology, epidural space","findingsSensitivity":["Vertebral marrow replacement","Collapse","Cord atrophy","Extradural mass"],"sortOrder":1},
   {"name":"T2 Sagittal FSE","abbreviation":"T2-SAG","plane":"Sagittal","technique":"Fast SE 4 mm","trMs":3500,"teMs":110,"tiMs":null,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Cord signal, disc morphology, CSF column, conus level, syrinx","findingsSensitivity":["Cord T2 hyperintensity","Disc herniation","Syrinx","CSF flow","Conus position"],"sortOrder":2},
   {"name":"STIR Sagittal","abbreviation":"STIR-SAG","plane":"Sagittal","technique":"STIR TI ~150 ms","trMs":3000,"teMs":40,"tiMs":150,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Bone marrow oedema (fracture acuity, metastasis, spondylodiscitis), cord oedema in trauma","findingsSensitivity":["Acute vs chronic fracture","Vertebral metastasis","Discitis","Cord oedema","NMO cord lesion"],"sortOrder":3},
   {"name":"T2 Axial FSE (symptomatic levels)","abbreviation":"T2-AX","plane":"Axial","technique":"Fast SE 4 mm angled to disc","trMs":3500,"teMs":110,"tiMs":null,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Canal stenosis, cord shape/signal, disc herniation laterality, ossified ligamentum flavum","findingsSensitivity":["Canal stenosis","Cord signal at compression","Ligamentum flavum ossification","Disc herniation laterality"],"sortOrder":4}
 ]',
 'Sagittal: T1 to T12-L1. FOV width includes posterior elements and rib heads. Axial: level-specific at pathology.',
 'Fracture acuity: STIR-positive = acute/subacute (< 3 months). STIR-negative = chronic. Osteoporotic fracture: concave superior endplate, no soft tissue mass. Pathological fracture: convex expanded cortex, paravertebral soft tissue mass, multiple levels, pedicle involvement. Ligamentum flavum ossification: T1 hypointense, T2 hypointense, posterior canal compromise.',
 'Cardiac gating recommended if cord myelopathy is primary concern. Non-gated acceptable for vertebral lesion characterisation. Note vertebral levels carefully — count from C2 inferiorly using localiser. Add post-contrast T1 FS sagittal and axial for infection or tumour.'
),

-- ── MRI KNEE ─────────────────────────────────────────────────────────────────
('MRI_KNEE','MRI Knee','MRI','KNEE','1.5T/3T',25,TRUE,
 '["Suspected meniscal tear","ACL or PCL tear","Collateral ligament injury","Articular cartilage assessment (OA, chondral defect)","Bone marrow oedema / contusion","Occult fracture","Patellar instability / chondromalacia","Posterolateral corner injury","PVNS","Post-operative knee assessment"]',
 '[
   {"id":"motion_artifact","label":"No motion artifact","description":"Patient must remain still throughout. Even mild motion degrades meniscal signal.","failAction":"reject"},
   {"id":"coverage_complete","label":"Coverage distal femur to tibial tubercle","description":"All sequences include distal femoral epiphysis superiorly and tibial tubercle (patellar tendon insertion) inferiorly.","failAction":"reject"},
   {"id":"all_sequences_present","label":"All 4 sequences acquired","description":"PD-FS-SAG, PD-FS-COR, T2-FS-AX, T1-SAG.","failAction":"warn"},
   {"id":"fat_sat_homogeneous","label":"Fat suppression homogeneous (PD-FS and T2-FS)","description":"Inhomogeneous fat sat invalidates cartilage and meniscal fluid signal. Repeat if failure present over joint.","failAction":"reject"},
   {"id":"meniscal_horn_coverage","label":"Meniscal posterior horns fully included on sagittal","description":"Posterior horn of medial meniscus most commonly torn. Sagittal slices must extend to medial and lateral gutters.","failAction":"reject"}
 ]',
 '[
   {"name":"PD Fat-Sat Sagittal","abbreviation":"PD-FS-SAG","plane":"Sagittal","technique":"PD FSE with fat saturation 3 mm 0 gap","trMs":3000,"teMs":40,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"PRIMARY: menisci, ACL, PCL, articular cartilage. Fat suppression highlights meniscal tear fluid signal.","findingsSensitivity":["Meniscal tear","ACL integrity","PCL signal","Cartilage thinning","Subchondral oedema"],"sortOrder":1},
   {"name":"PD Fat-Sat Coronal","abbreviation":"PD-FS-COR","plane":"Coronal","technique":"PD FSE with fat saturation 3 mm 0 gap","trMs":3000,"teMs":40,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Meniscal horns and body, MCL / LCL anatomy, medial and lateral compartment cartilage","findingsSensitivity":["Meniscal root tear","MCL/LCL injury","Compartment cartilage","Meniscal horn morphology"],"sortOrder":2},
   {"name":"T2 Fat-Sat Axial","abbreviation":"T2-FS-AX","plane":"Axial","technique":"T2 FSE fat saturation 4 mm 0 gap","trMs":4000,"teMs":80,"tiMs":null,"sliceThicknessMm":4,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Patella, trochlear groove, patellar tendon, Hoffa fat, bursae, joint effusion, posterolateral corner","findingsSensitivity":["Chondromalacia patellae","Patellar tendinopathy","Retinacular tear","Effusion/haemarthrosis","Bursitis"],"sortOrder":3},
   {"name":"T1 Sagittal FSE","abbreviation":"T1-SAG","plane":"Sagittal","technique":"T1 FSE 3 mm 0 gap (no fat suppression)","trMs":500,"teMs":20,"tiMs":null,"sliceThicknessMm":3,"interSliceGapMm":0,"bValue":null,"includesAdcMap":false,"contrastRequired":false,"purpose":"Bone marrow (fracture, AVN, tumour), PVNS haemosiderin (T1 dark), anatomic reference","findingsSensitivity":["Bone marrow lesion","Osteochondral defect","PVNS (T1 dark haemosiderin)","Lipoma arborescens"],"sortOrder":4}
 ]',
 'Sagittal: lateral to medial femoral condyle (include gutters). Coronal: posterior capsule to patellar apex. Axial: quadriceps tendon to tibial tuberosity. All 3 mm with 0 gap.',
 'Meniscal grading: 0 = normal / 1 = globular intrasubstance signal / 2 = linear not reaching surface / 3 = signal reaching articular surface = TEAR. ACL: assess fibre continuity (sagittal), Blumensaat line, Segond fracture (coronal = pathognomonic). Cartilage ICRS 0-4. Always assess: both horns both menisci, ACL + PCL, both collaterals, patellofemoral cartilage, bone marrow, posterolateral corner (popliteus, arcuate ligament, fibular collateral).',
 'Dedicated knee coil. Position in 10-15 deg external rotation (relaxes ACL). No contrast for standard study. Contrast only for post-op scar vs re-tear (indirect arthrography). Direct MR arthrography (Gd intra-articular) for labral / PVNS — separate booking.'
)

ON CONFLICT (protocol_key) DO NOTHING;

-- Verify
DO $$
DECLARE cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt FROM mri_protocol_specs WHERE is_system = TRUE;
  RAISE NOTICE 'mri_protocol_specs: % system protocols seeded', cnt;
END $$;
