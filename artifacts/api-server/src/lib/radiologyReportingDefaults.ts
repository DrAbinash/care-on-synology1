/**
 * radiologyReportingDefaults.ts
 *
 * Factory defaults for the Reporting Workspace configuration, used by the
 * "Restore defaults" actions in the Radiology Quick Select settings page.
 *
 * These MIRROR the SQL seeds that provision a fresh database:
 *   - Clinical history chips → migrations/z_add_radiology_clinical_history_and_protocol_default.sql
 *   - Protocols             → migrations/add_radiology_protocols.sql
 *
 * A restore re-applies these defaults for a given study region without
 * touching any admin-added custom rows (upsert on the natural key), so it is
 * always safe to run. Kept here in TS (not read from SQL) because the restore
 * runs at request time, long after the one-shot migration has been recorded.
 */

export interface ClinicalHistoryChipDefault {
  studyType: string;
  displayLabel: string;
  insertedText: string;
  sortOrder: number;
}

export const CLINICAL_HISTORY_CHIP_DEFAULTS: ClinicalHistoryChipDefault[] = [
  // MRI Brain
  { studyType: "Brain", displayLabel: "Headache", insertedText: "Headache.", sortOrder: 10 },
  { studyType: "Brain", displayLabel: "Vomiting", insertedText: "Vomiting.", sortOrder: 20 },
  { studyType: "Brain", displayLabel: "Seizure", insertedText: "History of seizures.", sortOrder: 30 },
  { studyType: "Brain", displayLabel: "Vertigo", insertedText: "Vertigo.", sortOrder: 40 },
  { studyType: "Brain", displayLabel: "Stroke symptoms", insertedText: "Sudden onset weakness with suspected cerebrovascular event.", sortOrder: 50 },
  { studyType: "Brain", displayLabel: "Memory loss", insertedText: "Progressive memory loss.", sortOrder: 60 },
  { studyType: "Brain", displayLabel: "Altered sensorium", insertedText: "Altered sensorium.", sortOrder: 70 },
  { studyType: "Brain", displayLabel: "Trauma", insertedText: "History of head injury.", sortOrder: 80 },
  { studyType: "Brain", displayLabel: "Visual disturbance", insertedText: "Visual disturbance.", sortOrder: 90 },
  { studyType: "Brain", displayLabel: "Limb weakness", insertedText: "Limb weakness.", sortOrder: 100 },
  // MRI Cervical Spine
  { studyType: "Cervical Spine", displayLabel: "Neck pain", insertedText: "Neck pain.", sortOrder: 10 },
  { studyType: "Cervical Spine", displayLabel: "Cervical radiculopathy", insertedText: "Cervical radiculopathy.", sortOrder: 20 },
  { studyType: "Cervical Spine", displayLabel: "Upper-limb weakness", insertedText: "Upper limb weakness.", sortOrder: 30 },
  { studyType: "Cervical Spine", displayLabel: "Numbness", insertedText: "Numbness.", sortOrder: 40 },
  { studyType: "Cervical Spine", displayLabel: "Myelopathy", insertedText: "Clinical features of myelopathy.", sortOrder: 50 },
  { studyType: "Cervical Spine", displayLabel: "Trauma", insertedText: "History of trauma.", sortOrder: 60 },
  { studyType: "Cervical Spine", displayLabel: "Stiffness", insertedText: "Neck stiffness.", sortOrder: 70 },
  { studyType: "Cervical Spine", displayLabel: "Tingling", insertedText: "Tingling sensation.", sortOrder: 80 },
  { studyType: "Cervical Spine", displayLabel: "Post-operative", insertedText: "Post-operative status.", sortOrder: 90 },
  { studyType: "Cervical Spine", displayLabel: "Gait difficulty", insertedText: "Difficulty in gait.", sortOrder: 100 },
  // MRI Lumbar Spine
  { studyType: "LS Spine", displayLabel: "Low backache", insertedText: "Low backache.", sortOrder: 10 },
  { studyType: "LS Spine", displayLabel: "Radiculopathy", insertedText: "Radiculopathy.", sortOrder: 20 },
  { studyType: "LS Spine", displayLabel: "Sciatica", insertedText: "Sciatica.", sortOrder: 30 },
  { studyType: "LS Spine", displayLabel: "Leg weakness", insertedText: "Lower limb weakness.", sortOrder: 40 },
  { studyType: "LS Spine", displayLabel: "Numbness", insertedText: "Numbness.", sortOrder: 50 },
  { studyType: "LS Spine", displayLabel: "Neurogenic claudication", insertedText: "Neurogenic claudication.", sortOrder: 60 },
  { studyType: "LS Spine", displayLabel: "Foot drop", insertedText: "Foot drop.", sortOrder: 70 },
  { studyType: "LS Spine", displayLabel: "Trauma", insertedText: "History of trauma.", sortOrder: 80 },
  { studyType: "LS Spine", displayLabel: "Post-operative", insertedText: "Post-operative status.", sortOrder: 90 },
  { studyType: "LS Spine", displayLabel: "Spondylolisthesis", insertedText: "Suspected spondylolisthesis.", sortOrder: 100 },
];

export interface ProtocolDefault {
  name: string;
  studyType: string;
  modality: string;
  checklistJson: string;
  techniqueText: string;
  normalText: string;
  isGoldStandard: boolean;
  isDefault: boolean;
  sortOrder: number;
}

export const PROTOCOL_DEFAULTS: ProtocolDefault[] = [
  { name: "MRI Brain Routine", studyType: "Brain", modality: "MRI",
    checklistJson: '["Parenchyma","Ventricles","Basal ganglia","Posterior fossa","Sinuses","Skull base"]',
    techniqueText: "Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, DWI, and GRE sequences.",
    normalText: "Brain parenchyma shows normal signal intensity. Ventricular system and sulcal spaces are normal. No midline shift. Posterior fossa structures are unremarkable. Paranasal sinuses and skull base are normal.",
    isGoldStandard: true, isDefault: true, sortOrder: 10 },
  { name: "MRI Brain Trauma", studyType: "Brain", modality: "MRI",
    checklistJson: '["Skull","Extra-axial hemorrhage","Subdural","Epidural","SAH","DAI","SWI blooming","Diffusion restriction","Midline shift","Ventricles","Sinuses","Skull base"]',
    techniqueText: "Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, DWI, GRE/SWI sequences for trauma protocol.",
    normalText: "No extra-axial hemorrhage, subdural, or epidural collection. No SWI blooming to suggest diffuse axonal injury. No diffusion restriction. No midline shift. Skull and skull base are intact.",
    isGoldStandard: true, isDefault: false, sortOrder: 20 },
  { name: "MRI Brain Stroke", studyType: "Brain", modality: "MRI",
    checklistJson: '["Diffusion restriction","ADC correlation","Vessel territory","Hemorrhagic transformation","Midline shift","MRA vessels"]',
    techniqueText: "Multiplanar multisequence MRI of the brain was performed including DWI, ADC, FLAIR, GRE, and MRA sequences for stroke protocol.",
    normalText: "No acute diffusion restriction. No hemorrhagic transformation. No midline shift. Intracranial vasculature shows normal flow-related signal.",
    isGoldStandard: true, isDefault: false, sortOrder: 30 },
  { name: "MRI Brain Epilepsy", studyType: "Brain", modality: "MRI",
    checklistJson: '["Hippocampus","Mesial temporal sclerosis","Cortical dysplasia","Gray-white differentiation","Ventricles"]',
    techniqueText: "Multiplanar multisequence MRI of the brain was performed including thin-section coronal T2/FLAIR through the hippocampi for epilepsy protocol.",
    normalText: "Bilateral hippocampi show normal size, signal, and internal architecture. No mesial temporal sclerosis. Gray-white matter differentiation is preserved. No cortical dysplasia identified.",
    isGoldStandard: true, isDefault: false, sortOrder: 40 },
  { name: "MRI Brain Dementia", studyType: "Brain", modality: "MRI",
    checklistJson: '["Global atrophy","Hippocampal volume","White matter changes","Ventricles","Microhemorrhages"]',
    techniqueText: "Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, and SWI sequences for dementia/volumetric assessment.",
    normalText: "No disproportionate global or hippocampal atrophy for age. No significant white matter ischemic changes. No microhemorrhages on SWI.",
    isGoldStandard: true, isDefault: false, sortOrder: 50 },
  { name: "MRI Brain Contrast", studyType: "Brain", modality: "MRI",
    checklistJson: '["Pre-contrast findings","Enhancement pattern","Ring enhancement","Leptomeningeal enhancement"]',
    techniqueText: "Multiplanar multisequence MRI of the brain was performed pre- and post-intravenous contrast administration.",
    normalText: "No abnormal parenchymal or leptomeningeal enhancement identified.",
    isGoldStandard: true, isDefault: false, sortOrder: 60 },
  { name: "MRI Pituitary", studyType: "Brain", modality: "MRI",
    checklistJson: '["Gland size","Gland signal","Stalk","Optic chiasm","Cavernous sinus"]',
    techniqueText: "Dedicated thin-section MRI of the sella and pituitary was performed including dynamic contrast sequences.",
    normalText: "Pituitary gland is normal in size and signal. Infundibulum is midline. Optic chiasm is not compressed. Cavernous sinuses are normal bilaterally.",
    isGoldStandard: true, isDefault: false, sortOrder: 70 },
  { name: "MRI IAC", studyType: "Brain", modality: "MRI",
    checklistJson: '["7th/8th nerve complex","Vestibule and cochlea","Cerebellopontine angle"]',
    techniqueText: "High-resolution T2 (FIESTA/CISS) MRI of the internal auditory canals was performed.",
    normalText: "Bilateral 7th and 8th cranial nerve complexes are normal. No cerebellopontine angle mass. Cochlea and vestibule are normal.",
    isGoldStandard: true, isDefault: false, sortOrder: 80 },
  { name: "MRI Orbit", studyType: "Brain", modality: "MRI",
    checklistJson: '["Globe","Optic nerve","Extraocular muscles","Retro-orbital fat"]',
    techniqueText: "Dedicated MRI of the orbits was performed including fat-suppressed T2 and post-contrast sequences.",
    normalText: "Both globes are normal in size and signal. Optic nerves are normal in caliber and signal. Extraocular muscles are normal. No retro-orbital mass.",
    isGoldStandard: true, isDefault: false, sortOrder: 90 },
  { name: "MRI LS Spine", studyType: "LS Spine", modality: "MRI",
    checklistJson: '["Alignment","Lordosis","Vertebral marrow","End plates","Disc hydration","Disc bulges","Facet joints","Canal","Foramina","Cord","Cauda","SI joints"]',
    techniqueText: "Multiplanar multisequence MRI of the lumbosacral spine was performed including T1, T2, and STIR sequences.",
    normalText: "Normal lumbar alignment and lordosis. Vertebral marrow and endplates are normal. Discs show normal hydration and height. No significant disc bulge. Facet joints are unremarkable. Spinal canal and neural foramina are patent. Conus and cauda equina are normal. SI joints are unremarkable.",
    isGoldStandard: true, isDefault: true, sortOrder: 100 },
  { name: "MRI Cervical Spine", studyType: "Cervical Spine", modality: "MRI",
    checklistJson: '["Alignment","Lordosis","Vertebral marrow","Disc hydration","Disc bulges","Canal","Foramina","Cord signal"]',
    techniqueText: "Multiplanar multisequence MRI of the cervical spine was performed including T1, T2, and STIR sequences.",
    normalText: "Normal cervical alignment and lordosis. Vertebral marrow is normal. Discs show normal hydration and height. Spinal canal and neural foramina are patent. Cord shows normal signal intensity throughout.",
    isGoldStandard: true, isDefault: true, sortOrder: 110 },
  { name: "MRI Whole Spine", studyType: "Whole Spine", modality: "MRI",
    checklistJson: '["Alignment","Vertebral marrow","Disc levels","Canal","Cord signal","Conus level"]',
    techniqueText: "Multiplanar multisequence MRI of the whole spine was performed including T1 and T2 sequences.",
    normalText: "Normal spinal alignment throughout. Vertebral marrow is normal at all levels. Spinal canal is patent throughout. Cord shows normal signal and caliber. Conus terminates at a normal level.",
    isGoldStandard: true, isDefault: true, sortOrder: 120 },
];
