// ── Advanced Measurement Library ──
// Phase 3: Premium Radiology Workstation
// One-click measurement templates with anatomical placeholders

export interface MeasurementTemplate {
  id: string;
  label: string;
  category: string;
  modality: string;
  bodyPart: string;
  // The measurement text with ___ placeholders
  template: string;
  // Normal range reference
  normalRange?: string;
  // Unit
  unit?: string;
  // One-click insert into findings
  insertText: string;
}

export interface MeasurementCategory {
  id: string;
  label: string;
  icon: string;
  templates: MeasurementTemplate[];
}

// ── MRI Cervical Spine Measurements ──
const MRI_CERVICAL_MEASUREMENTS: MeasurementTemplate[] = [
  {
    id: "mri-cerv-ap-canal",
    label: "AP Canal Diameter",
    category: "MRI Cervical",
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    template: "AP canal diameter at C___-___: ___ mm (normal ≥ 13 mm)",
    normalRange: "≥ 13 mm",
    unit: "mm",
    insertText: "AP canal diameter at C___-___: ___ mm (normal ≥ 13 mm)",
  },
  {
    id: "mri-cerv-cord",
    label: "Cord Diameter",
    category: "MRI Cervical",
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    template: "Spinal cord diameter at C___-___: ___ mm (normal 7-9 mm)",
    normalRange: "7-9 mm",
    unit: "mm",
    insertText: "Spinal cord diameter at C___-___: ___ mm (normal 7-9 mm)",
  },
  {
    id: "mri-cerv-disc-height",
    label: "Disc Height",
    category: "MRI Cervical",
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    template: "Disc height at C___-___: ___ mm",
    normalRange: "4-5 mm",
    unit: "mm",
    insertText: "Disc height at C___-___: ___ mm",
  },
  {
    id: "mri-cerv-retrolisthesis",
    label: "Retrolisthesis",
    category: "MRI Cervical",
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    template: "Retrolisthesis at C___-___: ___ mm",
    normalRange: "0 mm",
    unit: "mm",
    insertText: "Retrolisthesis at C___-___: ___ mm",
  },
];

// ── MRI LS Spine Measurements ──
const MRI_LS_MEASUREMENTS: MeasurementTemplate[] = [
  {
    id: "mri-ls-ap-canal",
    label: "AP Canal Diameter",
    category: "MRI LS",
    modality: "MR",
    bodyPart: "LS SPINE",
    template: "AP canal diameter at L___-___: ___ mm (normal ≥ 15 mm)",
    normalRange: "≥ 15 mm",
    unit: "mm",
    insertText: "AP canal diameter at L___-___: ___ mm (normal ≥ 15 mm)",
  },
  {
    id: "mri-ls-foraminal",
    label: "Foraminal Dimensions",
    category: "MRI LS",
    modality: "MR",
    bodyPart: "LS SPINE",
    template: "Foraminal dimensions at L___-___: ___ mm (normal ≥ 5 mm)",
    normalRange: "≥ 5 mm",
    unit: "mm",
    insertText: "Foraminal dimensions at L___-___: ___ mm (normal ≥ 5 mm)",
  },
  {
    id: "mri-ls-disc-height",
    label: "Disc Height",
    category: "MRI LS",
    modality: "MR",
    bodyPart: "LS SPINE",
    template: "Disc height at L___-___: ___ mm",
    normalRange: "7-10 mm",
    unit: "mm",
    insertText: "Disc height at L___-___: ___ mm",
  },
  {
    id: "mri-ls-slip",
    label: "Spondylolisthesis",
    category: "MRI LS",
    modality: "MR",
    bodyPart: "LS SPINE",
    template: "Spondylolisthesis at L___-___: ___ mm",
    normalRange: "0 mm",
    unit: "mm",
    insertText: "Spondylolisthesis at L___-___: ___ mm",
  },
];

// ── Brain Measurements ──
const BRAIN_MEASUREMENTS: MeasurementTemplate[] = [
  {
    id: "brain-ventricle",
    label: "Ventricular Measurement",
    category: "Brain",
    modality: "MR",
    bodyPart: "BRAIN",
    template: "Lateral ventricle: ___ mm (normal < 15 mm)",
    normalRange: "< 15 mm",
    unit: "mm",
    insertText: "Lateral ventricle: ___ mm (normal < 15 mm)",
  },
  {
    id: "brain-third-vent",
    label: "Third Ventricle",
    category: "Brain",
    modality: "MR",
    bodyPart: "BRAIN",
    template: "Third ventricle: ___ mm (normal < 10 mm)",
    normalRange: "< 10 mm",
    unit: "mm",
    insertText: "Third ventricle: ___ mm (normal < 10 mm)",
  },
  {
    id: "brain-evans",
    label: "Evans Index",
    category: "Brain",
    modality: "MR",
    bodyPart: "BRAIN",
    template: "Evans index: ___ (normal < 0.33)",
    normalRange: "< 0.33",
    unit: "ratio",
    insertText: "Evans index: ___ (normal < 0.33)",
  },
  {
    id: "brain-midline",
    label: "Midline Shift",
    category: "Brain",
    modality: "MR",
    bodyPart: "BRAIN",
    template: "Midline shift: ___ mm",
    normalRange: "0 mm",
    unit: "mm",
    insertText: "Midline shift: ___ mm",
  },
  {
    id: "brain-mass",
    label: "Mass Measurement",
    category: "Brain",
    modality: "MR",
    bodyPart: "BRAIN",
    template: "Mass: ___ x ___ x ___ mm",
    normalRange: "N/A",
    unit: "mm",
    insertText: "Mass: ___ x ___ x ___ mm",
  },
];

// ── USG Abdomen Measurements ──
const USG_ABD_MEASUREMENTS: MeasurementTemplate[] = [
  {
    id: "usg-liver",
    label: "Liver Span",
    category: "USG Abdomen",
    modality: "US",
    bodyPart: "LIVER",
    template: "Liver span: ___ mm (normal 100-160 mm)",
    normalRange: "100-160 mm",
    unit: "mm",
    insertText: "Liver span: ___ mm (normal 100-160 mm)",
  },
  {
    id: "usg-spleen",
    label: "Spleen Size",
    category: "USG Abdomen",
    modality: "US",
    bodyPart: "SPLEEN",
    template: "Spleen size: ___ mm (normal 80-120 mm)",
    normalRange: "80-120 mm",
    unit: "mm",
    insertText: "Spleen size: ___ mm (normal 80-120 mm)",
  },
  {
    id: "usg-kidney",
    label: "Kidney Size",
    category: "USG Abdomen",
    modality: "US",
    bodyPart: "KIDNEY",
    template: "Kidney: ___ mm (normal 90-120 mm)",
    normalRange: "90-120 mm",
    unit: "mm",
    insertText: "Kidney: ___ mm (normal 90-120 mm)",
  },
  {
    id: "usg-cbd",
    label: "CBD Diameter",
    category: "USG Abdomen",
    modality: "US",
    bodyPart: "CBD",
    template: "CBD diameter: ___ mm (normal < 6 mm; post-cholecystectomy < 8 mm)",
    normalRange: "< 6 mm",
    unit: "mm",
    insertText: "CBD diameter: ___ mm (normal < 6 mm; post-cholecystectomy < 8 mm)",
  },
  {
    id: "usg-prostate",
    label: "Prostate Volume",
    category: "USG Abdomen",
    modality: "US",
    bodyPart: "PROSTATE",
    template: "Prostate: ___ x ___ x ___ mm; volume: ___ cc (normal < 30 cc)",
    normalRange: "< 30 cc",
    unit: "cc",
    insertText: "Prostate: ___ x ___ x ___ mm; volume: ___ cc (normal < 30 cc)",
  },
  {
    id: "usg-residual",
    label: "Residual Urine",
    category: "USG Abdomen",
    modality: "US",
    bodyPart: "BLADDER",
    template: "Residual urine: ___ ml",
    normalRange: "< 50 ml",
    unit: "ml",
    insertText: "Residual urine: ___ ml",
  },
];

// ── Obstetric Measurements ──
const OBSTETRIC_MEASUREMENTS: MeasurementTemplate[] = [
  {
    id: "ob-bpd",
    label: "BPD",
    category: "Obstetric",
    modality: "US",
    bodyPart: "FETAL HEAD",
    template: "BPD: ___ mm (GA ___ weeks)",
    normalRange: "Variable",
    unit: "mm",
    insertText: "BPD: ___ mm",
  },
  {
    id: "ob-hc",
    label: "HC",
    category: "Obstetric",
    modality: "US",
    bodyPart: "FETAL HEAD",
    template: "HC: ___ mm (GA ___ weeks)",
    normalRange: "Variable",
    unit: "mm",
    insertText: "HC: ___ mm",
  },
  {
    id: "ob-ac",
    label: "AC",
    category: "Obstetric",
    modality: "US",
    bodyPart: "FETAL ABDOMEN",
    template: "AC: ___ mm (GA ___ weeks)",
    normalRange: "Variable",
    unit: "mm",
    insertText: "AC: ___ mm",
  },
  {
    id: "ob-fl",
    label: "FL",
    category: "Obstetric",
    modality: "US",
    bodyPart: "FETAL FEMUR",
    template: "FL: ___ mm (GA ___ weeks)",
    normalRange: "Variable",
    unit: "mm",
    insertText: "FL: ___ mm",
  },
  {
    id: "ob-efw",
    label: "EFW",
    category: "Obstetric",
    modality: "US",
    bodyPart: "FETUS",
    template: "EFW: ___ g (GA ___ weeks)",
    normalRange: "Variable",
    unit: "g",
    insertText: "EFW: ___ g",
  },
  {
    id: "ob-afv",
    label: "AFV",
    category: "Obstetric",
    modality: "US",
    bodyPart: "AMNIOTIC FLUID",
    template: "AFV: ___ cm (normal 8-18 cm)",
    normalRange: "8-18 cm",
    unit: "cm",
    insertText: "AFV: ___ cm (normal 8-18 cm)",
  },
  {
    id: "ob-placenta",
    label: "Placenta Thickness",
    category: "Obstetric",
    modality: "US",
    bodyPart: "PLACENTA",
    template: "Placenta thickness: ___ mm (normal 20-40 mm)",
    normalRange: "20-40 mm",
    unit: "mm",
    insertText: "Placenta thickness: ___ mm (normal 20-40 mm)",
  },
  {
    id: "ob-cervix",
    label: "Cervical Length",
    category: "Obstetric",
    modality: "US",
    bodyPart: "CERVIX",
    template: "Cervical length: ___ mm (normal ≥ 25 mm)",
    normalRange: "≥ 25 mm",
    unit: "mm",
    insertText: "Cervical length: ___ mm (normal ≥ 25 mm)",
  },
];

// ── All Measurements ──
export const ALL_MEASUREMENT_TEMPLATES: MeasurementTemplate[] = [
  ...MRI_CERVICAL_MEASUREMENTS,
  ...MRI_LS_MEASUREMENTS,
  ...BRAIN_MEASUREMENTS,
  ...USG_ABD_MEASUREMENTS,
  ...OBSTETRIC_MEASUREMENTS,
];

export const MEASUREMENT_CATEGORIES: MeasurementCategory[] = [
  { id: "mri-cervical", label: "MRI Cervical", icon: "Brain", templates: MRI_CERVICAL_MEASUREMENTS },
  { id: "mri-ls", label: "MRI LS", icon: "Brain", templates: MRI_LS_MEASUREMENTS },
  { id: "brain", label: "Brain", icon: "Brain", templates: BRAIN_MEASUREMENTS },
  { id: "usg-abd", label: "USG Abdomen", icon: "ScanLine", templates: USG_ABD_MEASUREMENTS },
  { id: "obstetric", label: "Obstetric", icon: "Baby", templates: OBSTETRIC_MEASUREMENTS },
];

// ── Helpers ──
export function findMeasurementById(id: string): MeasurementTemplate | undefined {
  return ALL_MEASUREMENT_TEMPLATES.find((m) => m.id === id);
}

export function searchMeasurements(
  query: string,
  category?: string,
  modality?: string
): MeasurementTemplate[] {
  const q = query.toLowerCase();
  return ALL_MEASUREMENT_TEMPLATES.filter((m) => {
    const matchQuery =
      m.label.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.bodyPart.toLowerCase().includes(q);
    const matchCategory = !category || m.category === category;
    const matchModality = !modality || m.modality === modality;
    return matchQuery && matchCategory && matchModality;
  });
}

export function getMeasurementsByCategory(categoryId: string): MeasurementTemplate[] {
  return ALL_MEASUREMENT_TEMPLATES.filter((m) => {
    const cat = MEASUREMENT_CATEGORIES.find((c) => c.id === categoryId);
    return cat?.templates.some((t) => t.id === m.id);
  });
}
