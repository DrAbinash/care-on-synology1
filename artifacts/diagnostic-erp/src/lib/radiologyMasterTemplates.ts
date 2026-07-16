// ── Dr. Sugandha Locked Master Template Library ──
// Phase 3: Premium Radiology Workstation
// These are locked master templates. Users can VIEW, USE, CLONE, SAVE PERSONAL VERSIONS.
// Only Admin/Super Admin can edit master templates.

export interface MasterTemplate {
  id: string;
  label: string;
  category: string;
  modality: string;
  bodyPart: string;
  isLocked: true;
  isMaster: true;
  author: "Dr. Sugandha";
  // Full report template
  title: string;
  technique: string;
  findings: string;
  impression: string;
  advice: string;
  // One-click complete variants
  variants?: MasterTemplateVariant[];
  // Measurement placeholders
  measurements?: string[];
  // Critical findings to watch for
  criticalWatchList?: string[];
  // Priority classification
  defaultPriority?: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
}

export interface MasterTemplateVariant {
  id: string;
  label: string;
  findings: string;
  impression: string;
  priority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
  // Trigger keywords for auto-detection
  triggerKeywords: string[];
}

// ── MRI Brain ──
export const MRI_BRAIN_MASTER: MasterTemplate = {
  id: "mri-brain-master",
  label: "MRI Brain",
  category: "Brain",
  modality: "MR",
  bodyPart: "BRAIN",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI BRAIN",
  technique: "MRI of the brain was performed on a 1.5T/3T scanner using T1W, T2W, FLAIR, DWI, and SWI sequences in axial, coronal, and sagittal planes.",
  findings: `BRAIN PARENCHYMA: Normal signal intensity on all sequences.
VENTRICULAR SYSTEM: Normal size and configuration.
MIDLINE: No shift.
CRANIAL NERVES: Visualized portions normal.
EXTRACRANIAL SOFT TISSUES: Normal.
No focal lesion, hemorrhage, or infarct seen.`,
  impression: "Normal MRI brain study.",
  advice: "No follow-up required.",
  criticalWatchList: [
    "acute infarct",
    "intracranial hemorrhage",
    "midline shift",
    "mass effect",
    "hydrocephalus",
    "herniation",
  ],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-brain-normal",
      label: "Normal Brain",
      findings: "BRAIN PARENCHYMA: Normal signal intensity on all sequences.\nVENTRICLES: Normal size and configuration.\nMIDLINE: No shift.\nNo focal lesion, hemorrhage, or infarct.",
      impression: "Normal MRI brain study.",
      priority: "NORMAL",
      triggerKeywords: ["normal brain", "normal mri brain"],
    },
    {
      id: "mri-brain-senile",
      label: "Senile Changes",
      findings: "BRAIN PARENCHYMA: Mild diffuse cerebral atrophy with prominent sulci and ventricles.\nPERIVENTRICULAR: Multiple punctate hyperintense foci on FLAIR — Fazekas Grade I.\nNo mass lesion, hemorrhage, or acute infarct.",
      impression: "Senile cerebral atrophy with mild periventricular ischemic changes (Fazekas Grade I).",
      priority: "MINOR",
      triggerKeywords: ["senile", "atrophy", "fazekas"],
    },
    {
      id: "mri-brain-fazekas2",
      label: "Fazekas Grade II",
      findings: "PERIVENTRICULAR WHITE MATTER: Multiple hyperintense foci on T2/FLAIR with beginning confluence (≥ 5 mm, < 10 mm) — Fazekas Grade II.\nBRAIN PARENCHYMA: Otherwise normal.\nVENTRICLES: Normal.\nNo acute infarct or hemorrhage.",
      impression: "Chronic microangiopathic ischemic changes (Fazekas Grade II).",
      priority: "MINOR",
      triggerKeywords: ["fazekas ii", "fazekas grade ii", "fazekas 2", "beginning confluence"],
    },
    {
      id: "mri-brain-empty-sella",
      label: "Empty Sella",
      findings: "SELLA TURCICA: Enlarged, predominantly filled with CSF signal.\nPITUITARY: Flattened along the floor.\nOPTIC CHIASMA: Normal.\nNo suprasellar mass.",
      impression: "Empty sella turcica.",
      priority: "MINOR",
      triggerKeywords: ["empty sella", "partially empty sella"],
    },
    {
      id: "mri-brain-inf",
      label: "Acute Infarct",
      findings: "HYPERINTENSE area on T2/FLAIR with restricted diffusion on DWI and low ADC in the ___ territory, suggestive of acute infarct.\nNo hemorrhagic transformation.\nMASS EFFECT: Mild.",
      impression: "Acute infarct in the ___ territory.",
      priority: "CRITICAL",
      triggerKeywords: ["acute infarct", "dw hyperintense", "restricted diffusion", "acute ischemia"],
    },
    {
      id: "mri-brain-hem",
      label: "Intracranial Hemorrhage",
      findings: "HYPERINTENSE on T1 and T2/FLAIR with blooming on SWI in the ___ region, suggestive of intraparenchymal hemorrhage.\nMass effect: Present.\nMidline shift: ___ mm.",
      impression: "Intracranial hemorrhage in the ___ region with mass effect.",
      priority: "CRITICAL",
      triggerKeywords: ["hemorrhage", "bleed", "intracranial hemorrhage", "swi blooming"],
    },
    {
      id: "mri-brain-hydro",
      label: "Hydrocephalus",
      findings: "VENTRICULAR SYSTEM: Dilated lateral and third ventricles.\nTemporal horns prominent.\nTransependymal CSF seepage noted on FLAIR.\nFourth ventricle: Normal.\nNo obstructing lesion.",
      impression: "Hydrocephalus.",
      priority: "SIGNIFICANT",
      triggerKeywords: ["hydrocephalus", "ventricular dilatation", "dilated ventricles"],
    },
  ],
};

// ── MRI Cervical Spine ──
export const MRI_CERVICAL_MASTER: MasterTemplate = {
  id: "mri-cervical-master",
  label: "MRI Cervical Spine",
  category: "Spine",
  modality: "MR",
  bodyPart: "CERVICAL SPINE",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI CERVICAL SPINE",
  technique: "MRI of the cervical spine was performed using T1W, T2W, and STIR sequences in sagittal and axial planes.",
  findings: `CERVICAL ALIGNMENT: Normal lordotic curvature.
VERTEBRAL BODIES: Normal height, signal, and alignment.
DISCS: Normal T2 hyperintense signal at all levels.
SPINAL CANAL: Adequate AP diameter at all levels.
CORD: Normal signal.
NEURAL FORAMINA: Patent.
PARASPINAL SOFT TISSUES: Normal.
No disc lesion, canal stenosis, or cord compression.`,
  impression: "Normal MRI cervical spine.",
  advice: "No follow-up required.",
  measurements: ["AP canal diameter at C5-C6", "Cord diameter at C5-C6"],
  criticalWatchList: ["cord compression", "severe canal stenosis", "myelomalacia", "fracture"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-cerv-normal",
      label: "Normal Cervical Spine",
      findings: "CERVICAL SPINE: Normal alignment. All discs normal. No canal stenosis.\nSPINAL CORD: Normal signal.",
      impression: "Normal MRI cervical spine.",
      priority: "NORMAL",
      triggerKeywords: ["normal cervical"],
    },
    {
      id: "mri-cerv-spond",
      label: "Cervical Spondylosis",
      findings: "CERVICAL SPINE: Degenerative changes.\nC4-C5: Disc desiccation with posterior disc bulge.\nC5-C6: Disc bulge with mild canal narrowing (AP diameter ___ mm).\nCORD: Normal signal.\nNo cord compression.",
      impression: "Cervical spondylosis with disc bulges at C4-C5 and C5-C6. No cord compression.",
      priority: "MINOR",
      triggerKeywords: ["cervical spondylosis", "disc bulge", "disc desiccation"],
    },
    {
      id: "mri-cerv-trauma",
      label: "Cervical Trauma",
      findings: "CERVICAL SPINE: Loss of normal lordosis.\nC___: Vertebral body fracture with retropulsion.\nSPINAL CANAL: Narrowed.\nCORD: T2 hyperintense signal at C___ level, suggestive of cord contusion/edema.\nPREVERTEBRAL SOFT TISSUE: Swelling.",
      impression: "Cervical spine fracture at C___ with spinal cord contusion/edema.",
      priority: "CRITICAL",
      triggerKeywords: ["cervical trauma", "fracture", "cord contusion", "retropulsion"],
    },
  ],
};

// ── MRI Dorsal Spine ──
export const MRI_DORSAL_MASTER: MasterTemplate = {
  id: "mri-dorsal-master",
  label: "MRI Dorsal Spine",
  category: "Spine",
  modality: "MR",
  bodyPart: "DORSAL SPINE",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI DORSAL SPINE",
  technique: "MRI of the dorsal spine was performed using T1W, T2W, and STIR sequences in sagittal and axial planes.",
  findings: `DORSAL ALIGNMENT: Normal kyphotic curvature.
VERTEBRAL BODIES: Normal height, signal, and alignment.
DISCS: Normal T2 hyperintense signal at all levels.
SPINAL CANAL: Adequate AP diameter at all levels.
CORD: Normal signal.
No disc lesion, canal stenosis, or cord compression.`,
  impression: "Normal MRI dorsal spine.",
  advice: "No follow-up required.",
  criticalWatchList: ["cord compression", "severe canal stenosis", "fracture", "myelomalacia"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-dorsal-normal",
      label: "Normal Dorsal Spine",
      findings: "DORSAL SPINE: Normal alignment. All discs normal. No canal stenosis.\nCORD: Normal signal.",
      impression: "Normal MRI dorsal spine.",
      priority: "NORMAL",
      triggerKeywords: ["normal dorsal"],
    },
    {
      id: "mri-dorsal-disc",
      label: "Dorsal Disc Bulge",
      findings: "DORSAL SPINE: D___-___: Disc desiccation with posterior bulge, indenting the anterior thecal sac.\nCORD: Normal signal.\nNo cord compression.",
      impression: "Dorsal disc bulge at D___-___. No cord compression.",
      priority: "MINOR",
      triggerKeywords: ["dorsal disc", "dorsal bulge"],
    },
  ],
};

// ── MRI LS Spine ──
export const MRI_LS_MASTER: MasterTemplate = {
  id: "mri-ls-master",
  label: "MRI LS Spine",
  category: "Spine",
  modality: "MR",
  bodyPart: "LS SPINE",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI LS SPINE",
  technique: "MRI of the lumbosacral spine was performed using T1W, T2W, and STIR sequences in sagittal and axial planes.",
  findings: `LS ALIGNMENT: Normal lordotic curvature.
VERTEBRAL BODIES: Normal height, signal, and alignment.
DISCS: Normal T2 hyperintense signal at all levels.
SPINAL CANAL: Adequate AP diameter at all levels.
CONUS: At L1-L2 level, normal signal.
NEURAL FORAMINA: Patent.
No disc lesion, canal stenosis, or nerve root compression.`,
  impression: "Normal MRI LS spine.",
  advice: "No follow-up required.",
  measurements: ["AP canal diameter at L4-L5", "Foraminal dimensions at L4-L5 and L5-S1"],
  criticalWatchList: ["severe canal stenosis", "cord compression", "conus abnormality", "cauda equina compression"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-ls-normal",
      label: "Normal LS Spine",
      findings: "LS SPINE: Normal alignment. All discs normal. No canal stenosis.\nCONUS: At L1-L2, normal signal.",
      impression: "Normal MRI LS spine.",
      priority: "NORMAL",
      triggerKeywords: ["normal ls", "normal lumbar"],
    },
    {
      id: "mri-ls-disc-bulge",
      label: "LS Disc Bulge",
      findings: "LS SPINE: L4-L5 and L5-S1: Disc desiccation with posterior bulge.\nSPINAL CANAL: Mildly narrowed at L4-L5.\nNEURAL FORAMINA: Mildly narrowed at L5-S1 bilaterally.\nCONUS: Normal.",
      impression: "Degenerative lumbar spondylotic changes with disc bulges at L4-L5 and L5-S1, mild canal and foraminal narrowing.",
      priority: "MINOR",
      triggerKeywords: ["disc bulge", "lumbar bulge", "ls disc"],
    },
    {
      id: "mri-ls-stenosis",
      label: "LS Canal Stenosis",
      findings: "LS SPINE: L4-L5: Severe canal stenosis (AP diameter ___ mm).\nL5-S1: Disc bulge with facet hypertrophy.\nNEURAL FORAMINA: Severely narrowed at L4-L5 bilaterally.\nCONUS: Normal.",
      impression: "Severe lumbar canal stenosis at L4-L5 with bilateral foraminal narrowing. Surgical evaluation recommended.",
      priority: "SIGNIFICANT",
      triggerKeywords: ["canal stenosis", "lumbar stenosis", "severe canal"],
    },
  ],
};

// ── Whole Spine Screening ──
export const MRI_WHOLE_SPINE_MASTER: MasterTemplate = {
  id: "mri-whole-spine-master",
  label: "Whole Spine Screening",
  category: "Spine",
  modality: "MR",
  bodyPart: "WHOLE SPINE",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI WHOLE SPINE SCREENING",
  technique: "MRI whole spine screening was performed using T1W, T2W, and STIR sagittal sequences from the cervical to the sacral region.",
  findings: `CERVICAL SPINE: Normal alignment. No disc lesion. No canal stenosis.
DORSAL SPINE: Normal alignment. No disc lesion. No canal stenosis.
LS SPINE: Normal alignment. No disc lesion. No canal stenosis.
CORD: Normal signal throughout.
CONUS: At L1-L2, normal signal.
No mass, fracture, or cord compression.`,
  impression: "Normal MRI whole spine screening.",
  advice: "No follow-up required.",
  criticalWatchList: ["cord compression", "severe canal stenosis", "fracture", "mass"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-wss-normal",
      label: "Normal Whole Spine",
      findings: "CERVICAL, DORSAL, and LS SPINE: All normal. No disc lesions. No canal stenosis.\nCORD: Normal signal.",
      impression: "Normal MRI whole spine screening.",
      priority: "NORMAL",
      triggerKeywords: ["normal whole spine", "whole spine normal"],
    },
  ],
};

// ── MRI Pituitary ──
export const MRI_PITUITARY_MASTER: MasterTemplate = {
  id: "mri-pituitary-master",
  label: "MRI Pituitary",
  category: "Brain",
  modality: "MR",
  bodyPart: "PITUITARY",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI PITUITARY",
  technique: "MRI pituitary was performed using T1W, T2W, and dynamic contrast-enhanced sequences in coronal and sagittal planes.",
  findings: `PITUITARY: Normal size (8mm x 6mm x 4mm) and signal.
SELLA TURCICA: Normal size.
OPTIC CHIASMA: Normal. No compression.
CAVERNOUS SINUS: Normal.
BRAIN PARENCHYMA: Normal.
VENTRICLES: Normal.`,
  impression: "Normal MRI pituitary study.",
  advice: "No follow-up required.",
  criticalWatchList: ["pituitary adenoma", "mass effect", "optic chiasma compression", "apoplexy"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-pit-normal",
      label: "Normal Pituitary",
      findings: "PITUITARY: Normal size (8mm x 6mm x 4mm) and signal.\nSELLA: Normal.\nOPTIC CHIASMA: Normal.\nCAVERNOUS SINUS: Normal.",
      impression: "Normal MRI pituitary study.",
      priority: "NORMAL",
      triggerKeywords: ["normal pituitary"],
    },
    {
      id: "mri-pit-empty",
      label: "Empty Sella",
      findings: "SELLA TURCICA: Enlarged, predominantly filled with CSF signal.\nPITUITARY: Flattened along the floor.\nOPTIC CHIASMA: Normal.\nNo suprasellar mass.",
      impression: "Empty sella turcica.",
      priority: "MINOR",
      triggerKeywords: ["empty sella", "partially empty sella"],
    },
    {
      id: "mri-pit-adenoma",
      label: "Pituitary Adenoma",
      findings: "PITUITARY: Enlarged (18mm x 14mm x 12mm), T1 hypointense, T2 isointense.\nSELLA TURCICA: Expanded.\nOPTIC CHIASMA: Compressed.\nCAVERNOUS SINUS: Normal.",
      impression: "Pituitary macroadenoma.",
      priority: "SIGNIFICANT",
      triggerKeywords: ["pituitary adenoma", "macroadenoma", "pituitary mass"],
    },
  ],
};

// ── MRI Brain + MRA ──
export const MRI_BRAIN_MRA_MASTER: MasterTemplate = {
  id: "mri-brain-mra-master",
  label: "MRI Brain + MRA",
  category: "Brain",
  modality: "MR",
  bodyPart: "BRAIN",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI BRAIN WITH MRA",
  technique: "MRI brain with MRA was performed using T1W, T2W, FLAIR, DWI, SWI, and 3D-TOF MRA sequences.",
  findings: `BRAIN PARENCHYMA: Normal signal on all sequences.
VENTRICLES: Normal size and configuration.
MIDLINE: No shift.
CIRCLE OF WILLIS: Patent. No aneurysm or stenosis.
CAROTID/VERTEBRAL: Normal flow.
No intracranial abnormality.`,
  impression: "Normal MRI brain and MRA.",
  advice: "No follow-up required.",
  criticalWatchList: ["aneurysm", "stenosis", "acute infarct", "hemorrhage"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-brain-mra-normal",
      label: "Normal Brain + MRA",
      findings: "BRAIN: Normal.\nCIRCLE OF WILLIS: Patent. No aneurysm.\nCAROTID/VERTEBRAL: Normal.",
      impression: "Normal MRI brain and MRA.",
      priority: "NORMAL",
      triggerKeywords: ["normal brain mra", "normal mra"],
    },
  ],
};

// ── MRI Brain + Cervical ──
export const MRI_BRAIN_CERVICAL_MASTER: MasterTemplate = {
  id: "mri-brain-cervical-master",
  label: "MRI Brain + Cervical",
  category: "Combined",
  modality: "MR",
  bodyPart: "BRAIN,CERVICAL",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "MRI BRAIN WITH MRI CERVICAL SPINE",
  technique: "MRI brain and cervical spine were performed using T1W, T2W, FLAIR, DWI, and STIR sequences.",
  findings: `BRAIN: Normal signal. No lesion. No hemorrhage. No infarct.
CERVICAL SPINE: Normal alignment. All discs normal. No canal stenosis.
SPINAL CORD: Normal signal.
VENTRICLES: Normal.`,
  impression: "Normal MRI brain and cervical spine.",
  advice: "No follow-up required.",
  criticalWatchList: ["cord compression", "severe canal stenosis", "acute infarct", "hemorrhage"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "mri-brain-cerv-normal",
      label: "Normal Brain + Cervical",
      findings: "BRAIN: Normal.\nCERVICAL SPINE: Normal.\nCORD: Normal signal.",
      impression: "Normal MRI brain and cervical spine.",
      priority: "NORMAL",
      triggerKeywords: ["normal brain cervical", "normal combined"],
    },
  ],
};

// ── CT Brain ──
export const CT_BRAIN_MASTER: MasterTemplate = {
  id: "ct-brain-master",
  label: "CT Brain",
  category: "Brain",
  modality: "CT",
  bodyPart: "BRAIN",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "CT BRAIN",
  technique: "Non-contrast CT brain was performed in axial plane.",
  findings: `BRAIN PARENCHYMA: Normal attenuation.
VENTRICULAR SYSTEM: Normal size and configuration.
MIDLINE: No shift.
SKULL VAULT: Intact.
No hemorrhage, infarct, or mass lesion.`,
  impression: "Normal CT brain study.",
  advice: "No follow-up required.",
  criticalWatchList: ["acute hemorrhage", "midline shift", "mass effect", "fracture", "hydrocephalus"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "ct-brain-normal",
      label: "Normal CT Brain",
      findings: "BRAIN: Normal attenuation. No hemorrhage. No infarct.\nVENTRICLES: Normal.\nMIDLINE: No shift.",
      impression: "Normal CT brain study.",
      priority: "NORMAL",
      triggerKeywords: ["normal ct brain", "ct brain normal"],
    },
    {
      id: "ct-brain-hem",
      label: "CT Brain Hemorrhage",
      findings: "HYPERDENSE area in the ___ region, suggestive of acute hemorrhage.\nMass effect: Present.\nMidline shift: ___ mm.\nVentricular effacement: Present.",
      impression: "Acute intracranial hemorrhage in the ___ region with mass effect.",
      priority: "CRITICAL",
      triggerKeywords: ["ct hemorrhage", "acute bleed", "hyperdense"],
    },
  ],
};

// ── HRCT Chest ──
export const HRCT_CHEST_MASTER: MasterTemplate = {
  id: "hrct-chest-master",
  label: "HRCT Chest",
  category: "Chest",
  modality: "CT",
  bodyPart: "CHEST",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "HRCT CHEST",
  technique: "HRCT chest was performed in axial, coronal, and sagittal planes using lung and mediastinal windows.",
  findings: `LUNGS: Normal aeration. No consolidation, nodules, or interstitial changes.
PLEURA: Normal. No effusion.
MEDIASTINUM: Normal.
HEART: Normal size.
AIRWAYS: Patent. No bronchial wall thickening.
BONES: No lytic or sclerotic lesion.
No acute abnormality.`,
  impression: "Normal HRCT chest.",
  advice: "No follow-up required.",
  criticalWatchList: ["pneumothorax", "tension pneumothorax", "massive consolidation", "pulmonary embolism"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "hrct-chest-normal",
      label: "Normal HRCT Chest",
      findings: "LUNGS: Normal. No consolidation. No nodules.\nPLEURA: Normal.\nMEDIASTINUM: Normal.",
      impression: "Normal HRCT chest.",
      priority: "NORMAL",
      triggerKeywords: ["normal hrct", "normal chest ct"],
    },
  ],
};

// ── USG Abdomen ──
export const USG_ABDOMEN_MASTER: MasterTemplate = {
  id: "usg-abdomen-master",
  label: "USG Abdomen",
  category: "Abdomen",
  modality: "US",
  bodyPart: "ABDOMEN",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "USG ABDOMEN",
  technique: "Ultrasound of the abdomen was performed using a convex probe in supine and decubitus positions.",
  findings: `LIVER: Normal in size, shape, and echotexture. No focal lesion.
GALLBLADDER: Normal wall thickness. No calculus.
PANCREAS: Normal size and echotexture.
SPLEEN: Normal size.
KIDNEYS: Both normal size. No hydronephrosis.
BLADDER: Normal wall.
No free fluid.`,
  impression: "Normal USG abdomen.",
  advice: "No follow-up required.",
  measurements: ["Liver span", "Spleen size", "Kidney size", "CBD diameter", "Prostate volume"],
  criticalWatchList: ["free fluid", "mass", "obstruction", "portal vein thrombosis"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "usg-abd-normal",
      label: "Normal Abdomen",
      findings: "LIVER: Normal.\nGALLBLADDER: Normal. No calculus.\nPANCREAS: Normal.\nSPLEEN: Normal.\nKIDNEYS: Both normal.\nBLADDER: Normal.",
      impression: "Normal USG abdomen.",
      priority: "NORMAL",
      triggerKeywords: ["normal usg abdomen", "normal abdomen usg"],
    },
    {
      id: "usg-abd-fl1",
      label: "Fatty Liver Grade I",
      findings: "LIVER: Normal size. Diffuse increased echotexture with slightly impaired intrahepatic vessel definition — Grade I fatty liver.",
      impression: "Grade I fatty liver.",
      priority: "MINOR",
      triggerKeywords: ["fatty liver grade i", "fatty liver i", "grade 1 fatty liver"],
    },
    {
      id: "usg-abd-fl2",
      label: "Fatty Liver Grade II",
      findings: "LIVER: Normal size. Marked diffuse increased echotexture with moderately impaired intrahepatic vessel definition and mild posterior beam attenuation — Grade II fatty liver.",
      impression: "Grade II fatty liver.",
      priority: "MINOR",
      triggerKeywords: ["fatty liver grade ii", "fatty liver ii", "grade 2 fatty liver"],
    },
    {
      id: "usg-abd-renal",
      label: "Renal Calculus",
      findings: "KIDNEYS: Echogenic focus with posterior acoustic shadowing in the ___ kidney, measuring ___ mm. No hydronephrosis.",
      impression: "Renal calculus in the ___ kidney.",
      priority: "MINOR",
      triggerKeywords: ["renal calculus", "kidney stone", "renal stone"],
    },
  ],
};

// ── USG Pelvis ──
export const USG_PELVIS_MASTER: MasterTemplate = {
  id: "usg-pelvis-master",
  label: "USG Pelvis",
  category: "Pelvis",
  modality: "US",
  bodyPart: "PELVIS",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "USG PELVIS",
  technique: "Ultrasound of the pelvis was performed using a convex and transvaginal probe.",
  findings: `UTERUS: Normal size, anteverted, homogeneous echotexture.
ENDOMETRIUM: Normal thickness and echotexture.
OVARIES: Both normal size and echotexture. No cyst or mass.
CUL-DE-SAC: No free fluid.
BLADDER: Normal wall.
No abnormality.`,
  impression: "Normal USG pelvis.",
  advice: "No follow-up required.",
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "usg-pelvis-normal",
      label: "Normal Pelvis",
      findings: "UTERUS: Normal.\nENDOMETRIUM: Normal.\nOVARIES: Both normal.\nNo free fluid.",
      impression: "Normal USG pelvis.",
      priority: "NORMAL",
      triggerKeywords: ["normal pelvis", "normal usg pelvis"],
    },
  ],
};

// ── USG Doppler ──
export const USG_DOPPLER_MASTER: MasterTemplate = {
  id: "usg-doppler-master",
  label: "USG Doppler",
  category: "Vascular",
  modality: "US",
  bodyPart: "VASCULAR",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "USG DOPPLER STUDY",
  technique: "Color Doppler and spectral Doppler studies were performed using a linear and convex probe.",
  findings: `VASCULAR: Normal flow pattern. No stenosis or thrombosis.
WAVE FORMS: Normal triphasic pattern.
RESISTIVE INDEX: Normal.
No abnormality.`,
  impression: "Normal Doppler study.",
  advice: "No follow-up required.",
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "usg-doppler-normal",
      label: "Normal Doppler",
      findings: "VASCULAR: Normal flow. No stenosis. No thrombosis.",
      impression: "Normal Doppler study.",
      priority: "NORMAL",
      triggerKeywords: ["normal doppler", "normal usg doppler"],
    },
  ],
};

// ── USG Obstetric ──
export const USG_OBSTETRIC_MASTER: MasterTemplate = {
  id: "usg-obstetric-master",
  label: "USG Obstetric",
  category: "Obstetric",
  modality: "US",
  bodyPart: "OBSTETRIC",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "USG OBSTETRIC",
  technique: "Obstetric ultrasound was performed using a convex probe with B-mode, color Doppler, and M-mode.",
  findings: `SINGLE LIVE INTRAUTERINE GESTATION.
FETAL PRESENTATION: Cephalic/ breech.
FETAL HEART: Normal rate and rhythm.
PLACENTA: Anterior/ posterior, grade ___.
AMNIOTIC FLUID: Adequate.
No gross fetal anomaly.
BIOMETRIC PARAMETERS:
  BPD: ___ mm
  HC: ___ mm
  AC: ___ mm
  FL: ___ mm
  EFW: ___ g`,
  impression: "Single live intrauterine gestation. Biometric parameters appropriate for gestational age.",
  advice: "Routine antenatal follow-up.",
  measurements: ["BPD", "HC", "AC", "FL", "EFW"],
  criticalWatchList: ["oligohydramnios", "polyhydramnios", "fetal anomaly", "placental abruption", "IUGR"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "usg-obst-normal",
      label: "Normal Obstetric",
      findings: "SINGLE LIVE INTRAUTERINE GESTATION.\nFETAL HEART: Normal.\nPLACENTA: Normal.\nAMNIOTIC FLUID: Adequate.\nNo gross anomaly.",
      impression: "Single live intrauterine gestation. Biometric parameters appropriate for gestational age.",
      priority: "NORMAL",
      triggerKeywords: ["normal obstetric", "normal usg obstetric", "live intrauterine"],
    },
  ],
};

// ── Fetal Echo ──
export const FETAL_ECHO_MASTER: MasterTemplate = {
  id: "fetal-echo-master",
  label: "Fetal Echo",
  category: "Obstetric",
  modality: "US",
  bodyPart: "FETAL HEART",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "FETAL ECHOCARDIOGRAPHY",
  technique: "Fetal echocardiography was performed using a high-frequency convex probe with color Doppler and M-mode.",
  findings: `CARDIAC SITUS: Normal.
FOUR-CHAMBER VIEW: Normal. No septal defect.
OUTFLOW TRACTS: Normal.
GREAT VESSELS: Normal alignment.
DOPPLER: Normal flow across valves.
No congenital heart anomaly.`,
  impression: "Normal fetal echocardiography.",
  advice: "Routine antenatal follow-up.",
  criticalWatchList: ["congenital heart anomaly", "septal defect", "outflow obstruction", "arrhythmia"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "fetal-echo-normal",
      label: "Normal Fetal Echo",
      findings: "CARDIAC SITUS: Normal.\nFOUR-CHAMBER: Normal.\nOUTFLOW TRACTS: Normal.\nGREAT VESSELS: Normal.",
      impression: "Normal fetal echocardiography.",
      priority: "NORMAL",
      triggerKeywords: ["normal fetal echo", "normal fetal heart"],
    },
  ],
};

// ── USG Breast ──
export const USG_BREAST_MASTER: MasterTemplate = {
  id: "usg-breast-master",
  label: "USG Breast",
  category: "Breast",
  modality: "US",
  bodyPart: "BREAST",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "USG BREAST",
  technique: "Ultrasound of both breasts was performed using a high-frequency linear probe.",
  findings: `BREAST PARENCHYMA: Normal echotexture.
DUCTS: Not dilated.
No solid or cystic lesion.
AXILLA: No lymphadenopathy.
No abnormality.`,
  impression: "Normal USG breast.",
  advice: "No follow-up required.",
  criticalWatchList: ["solid lesion", "irregular mass", "lymphadenopathy", "calcification"],
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "usg-breast-normal",
      label: "Normal Breast",
      findings: "BREAST: Normal. No lesion. No lymphadenopathy.",
      impression: "Normal USG breast.",
      priority: "NORMAL",
      triggerKeywords: ["normal breast", "normal usg breast"],
    },
  ],
};

// ── USG Small Parts ──
export const USG_SMALL_PARTS_MASTER: MasterTemplate = {
  id: "usg-small-parts-master",
  label: "USG Small Parts",
  category: "Small Parts",
  modality: "US",
  bodyPart: "SMALL PARTS",
  isLocked: true,
  isMaster: true,
  author: "Dr. Sugandha",
  title: "USG SMALL PARTS",
  technique: "Ultrasound of the specified small part was performed using a high-frequency linear probe.",
  findings: `STRUCTURE: Normal in size, shape, and echotexture.
No mass, cyst, or calcification.
No abnormality.`,
  impression: "Normal USG small parts.",
  advice: "No follow-up required.",
  defaultPriority: "NORMAL",
  variants: [
    {
      id: "usg-small-normal",
      label: "Normal Small Parts",
      findings: "STRUCTURE: Normal. No lesion. No calcification.",
      impression: "Normal USG small parts.",
      priority: "NORMAL",
      triggerKeywords: ["normal small parts", "normal usg small parts"],
    },
  ],
};

// ── All Masters ──
export const ALL_MASTER_TEMPLATES: MasterTemplate[] = [
  MRI_BRAIN_MASTER,
  MRI_CERVICAL_MASTER,
  MRI_DORSAL_MASTER,
  MRI_LS_MASTER,
  MRI_WHOLE_SPINE_MASTER,
  MRI_PITUITARY_MASTER,
  MRI_BRAIN_MRA_MASTER,
  MRI_BRAIN_CERVICAL_MASTER,
  CT_BRAIN_MASTER,
  HRCT_CHEST_MASTER,
  USG_ABDOMEN_MASTER,
  USG_PELVIS_MASTER,
  USG_DOPPLER_MASTER,
  USG_OBSTETRIC_MASTER,
  FETAL_ECHO_MASTER,
  USG_BREAST_MASTER,
  USG_SMALL_PARTS_MASTER,
];

// ── Helpers ──
export function findMasterTemplateById(id: string): MasterTemplate | undefined {
  return ALL_MASTER_TEMPLATES.find((t) => t.id === id);
}

export function findMasterVariant(
  templateId: string,
  variantId: string
): MasterTemplateVariant | undefined {
  const t = findMasterTemplateById(templateId);
  return t?.variants?.find((v) => v.id === variantId);
}

export function searchMasterTemplates(
  query: string,
  modality?: string,
  category?: string
): MasterTemplate[] {
  const q = query.toLowerCase();
  return ALL_MASTER_TEMPLATES.filter((t) => {
    const matchQuery =
      t.label.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.bodyPart.toLowerCase().includes(q) ||
      t.title.toLowerCase().includes(q);
    const matchModality = !modality || t.modality === modality;
    const matchCategory = !category || t.category === category;
    return matchQuery && matchModality && matchCategory;
  });
}

/** Normalises a modality code so the workspace's short forms match the master
 *  templates' long forms ("MR" ↔ "MRI", "US"/"USG" ↔ "USG"). */
function normModality(m: string): string {
  const u = (m || "").toUpperCase().trim();
  if (u === "MR" || u === "MRI") return "MR";
  if (u === "US" || u === "USG" || u === "USE") return "US";
  return u;
}

/**
 * Collect the critical-finding watch terms for the master template(s) best
 * matching a study, so the workspace can seed critical-results detection
 * (criticalResults.ts) with study-specific red-flags WITHOUT duplicating those
 * per-study lists. Modality-normalised; matches the study description against
 * each template's label / bodyPart / title. De-duplicated; empty when nothing
 * matches (the built-in critical table still covers the generic emergencies).
 */
export function criticalWatchListFor(modality?: string | null, studyDescription?: string | null): string[] {
  const desc = (studyDescription || "").toLowerCase().trim();
  const mod = normModality(modality || "");
  const words = desc.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const terms = new Set<string>();
  for (const t of ALL_MASTER_TEMPLATES) {
    if (!t.criticalWatchList?.length) continue;
    if (mod && normModality(t.modality) !== mod) continue;
    const hay = `${t.label} ${t.bodyPart} ${t.title}`.toLowerCase();
    const matched = !!desc && (hay.includes(desc) || words.some((w) => hay.includes(w)));
    if (!matched) continue;
    for (const term of t.criticalWatchList) {
      const clean = term.trim();
      if (clean) terms.add(clean);
    }
  }
  return [...terms];
}

export function getMasterCategories(): string[] {
  return [...new Set(ALL_MASTER_TEMPLATES.map((t) => t.category))].sort();
}

export function getMasterModalities(): string[] {
  return [...new Set(ALL_MASTER_TEMPLATES.map((t) => t.modality))].sort();
}

// ── Report Assembler: combine multiple master templates into one report ──
export interface AssembledReport {
  title: string;
  technique: string;
  findingsSections: { heading: string; text: string }[];
  impression: string;
  advice: string;
  priority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
  criticalAlerts: string[];
  usedTemplates: string[];
}

export function assembleReport(
  selectedTemplates: MasterTemplate[],
  selectedVariants: Map<string, string>, // templateId -> variantId
): AssembledReport {
  const usedTemplates: string[] = [];
  const findingsSections: { heading: string; text: string }[] = [];
  const impressions: string[] = [];
  const advices: string[] = [];
  const criticalAlerts: string[] = [];
  let maxPriority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL" = "NORMAL";
  const priorityOrder = ["NORMAL", "MINOR", "SIGNIFICANT", "CRITICAL"] as const;

  for (const template of selectedTemplates) {
    usedTemplates.push(template.label);
    const variantId = selectedVariants.get(template.id);
    const variant = variantId ? findMasterVariant(template.id, variantId) : undefined;

    const findings = variant?.findings ?? template.findings;
    const impression = variant?.impression ?? template.impression;
    const advice = template.advice;
    const priority = variant?.priority ?? template.defaultPriority ?? "NORMAL";

    findingsSections.push({
      heading: template.bodyPart,
      text: findings,
    });
    impressions.push(impression);
    if (advice) advices.push(advice);

    if (template.criticalWatchList) {
      criticalAlerts.push(...template.criticalWatchList);
    }

    const pIdx = priorityOrder.indexOf(priority);
    const maxIdx = priorityOrder.indexOf(maxPriority);
    if (pIdx > maxIdx) maxPriority = priority;
  }

  // Deduplicate impressions
  const dedupedImpressions = [...new Set(impressions)];

  // Deduplicate normal statements
  const normalPhrases = [
    "Normal MRI brain study.",
    "Normal MRI cervical spine.",
    "Normal MRI dorsal spine.",
    "Normal MRI LS spine.",
    "Normal MRI whole spine screening.",
    "Normal MRI pituitary study.",
    "Normal MRI brain and MRA.",
    "Normal MRI brain and cervical spine.",
    "Normal CT brain study.",
    "Normal HRCT chest.",
    "Normal USG abdomen.",
    "Normal USG pelvis.",
    "Normal Doppler study.",
    "Normal USG breast.",
    "Normal USG small parts.",
    "Normal fetal echocardiography.",
  ];

  const filteredImpressions = dedupedImpressions.filter(
    (imp, i) =>
      !normalPhrases.includes(imp) ||
      i === dedupedImpressions.findIndex((d) => d === imp)
  );

  const title =
    selectedTemplates.length === 1
      ? selectedTemplates[0].title
      : selectedTemplates.map((t) => t.title).join(" WITH ");

  const technique = selectedTemplates.map((t) => t.technique).join("\n\n");

  return {
    title,
    technique,
    findingsSections,
    impression: filteredImpressions.join("\n\n"),
    advice: [...new Set(advices)].join(" "),
    priority: maxPriority,
    criticalAlerts: [...new Set(criticalAlerts)],
    usedTemplates,
  };
}

// ── AI-ready hooks (no AI implementation, just infrastructure) ──
export interface AiReadyHooks {
  // Speech-to-text placeholder
  voiceDictation: boolean;
  // AI findings extraction placeholder
  aiFindingsExtraction: boolean;
  // AI measurements placeholder
  aiMeasurements: boolean;
  // AI comparison placeholder
  aiComparison: boolean;
  // AI drafting placeholder
  aiDrafting: boolean;
  // AI follow-up suggestions placeholder
  aiFollowUp: boolean;
}

export const DEFAULT_AI_READY_HOOKS: AiReadyHooks = {
  voiceDictation: false,
  aiFindingsExtraction: false,
  aiMeasurements: false,
  aiComparison: false,
  aiDrafting: false,
  aiFollowUp: false,
};

export function getAiReadyHooks(): AiReadyHooks {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("aiReadyHooks") : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<AiReadyHooks>) : {};
    return { ...DEFAULT_AI_READY_HOOKS, ...parsed };
  } catch {
    return { ...DEFAULT_AI_READY_HOOKS };
  }
}

export function setAiReadyHook<K extends keyof AiReadyHooks>(key: K, value: AiReadyHooks[K]): void {
  try {
    const current = getAiReadyHooks();
    current[key] = value;
    window.localStorage.setItem("aiReadyHooks", JSON.stringify(current));
  } catch { /* ignore */ }
}
