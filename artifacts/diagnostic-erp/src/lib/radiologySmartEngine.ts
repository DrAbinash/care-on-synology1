// ── Phase 5: Structured Smart Reporting Engine ──
// Deterministic, rules-based text generation. NO AI.
// All generated text is fully editable, auditable, and explainable.

// ============================================================================
// 1. BUILDER DEFINITIONS
// ============================================================================

export interface SmartBuilderField {
  id: string;
  label: string;
  type: "select" | "multiselect" | "number" | "text" | "checkbox";
  options?: string[];
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  unit?: string;
}

export interface SmartBuilderSection {
  id: string;
  label: string;
  fields: SmartBuilderField[];
}

export interface SmartBuilder {
  type: string;
  label: string;
  studyType: string;
  sections: SmartBuilderSection[];
}

export const MRI_BRAIN_BUILDER: SmartBuilder = {
  type: "mri_brain",
  label: "MRI Brain",
  studyType: "MRI Brain",
  sections: [
    {
      id: "white_matter",
      label: "A. White Matter Disease",
      fields: [
        { id: "whiteMatter", type: "select", label: "White Matter", options: ["Normal", "Chronic Microangiopathic Changes", "Fazekas Grade 1", "Fazekas Grade 2", "Fazekas Grade 3"], required: true },
      ],
    },
    {
      id: "infarct",
      label: "B. Infarct",
      fields: [
        { id: "infarctPresent", type: "checkbox", label: "Infarct Present" },
        { id: "infarctType", type: "select", label: "Type", options: ["Acute", "Subacute", "Chronic", "Lacunar"], required: false },
        { id: "infarctLocation", type: "select", label: "Location", options: ["MCA Territory", "ACA Territory", "PCA Territory", "Basal Ganglia", "Thalamus", "Brainstem", "Cerebellum", "Custom Location"], required: false },
        { id: "infarctSide", type: "select", label: "Side", options: ["Right", "Left", "Bilateral"], required: false },
        { id: "infarctCustom", type: "text", label: "Custom Location", placeholder: "Enter custom location...", required: false },
      ],
    },
    {
      id: "hemorrhage",
      label: "C. Hemorrhage",
      fields: [
        { id: "hemorrhagePresent", type: "checkbox", label: "Hemorrhage Present" },
        { id: "hemorrhageType", type: "select", label: "Type", options: ["EDH", "SDH", "SAH", "IPH", "IVH"], required: false },
        { id: "hemorrhageLocation", type: "text", label: "Location", placeholder: "e.g., Right parietal", required: false },
        { id: "hemorrhageSide", type: "select", label: "Side", options: ["Right", "Left", "Bilateral"], required: false },
        { id: "hemorrhageThickness", type: "number", label: "Thickness", placeholder: "mm", min: 0, unit: "mm", required: false },
        { id: "midlineShift", type: "number", label: "Midline Shift", placeholder: "mm", min: 0, unit: "mm", required: false },
      ],
    },
    {
      id: "atrophy",
      label: "D. Brain Atrophy",
      fields: [
        { id: "atrophy", type: "select", label: "Atrophy", options: ["None", "Mild", "Moderate", "Severe"], required: true },
      ],
    },
    {
      id: "hydrocephalus",
      label: "E. Hydrocephalus",
      fields: [
        { id: "hydrocephalus", type: "select", label: "Hydrocephalus", options: ["None", "Mild", "Moderate", "Severe"], required: true },
      ],
    },
  ],
};

export const MRI_CERVICAL_SPINE_BUILDER: SmartBuilder = {
  type: "mri_cervical_spine",
  label: "MRI Cervical Spine",
  studyType: "MRI Cervical Spine",
  sections: [
    {
      id: "level_findings",
      label: "Level Findings",
      fields: [
        {
          id: "levels",
          type: "multiselect",
          label: "Levels",
          options: ["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1"],
          required: true,
        },
        {
          id: "findings",
          type: "multiselect",
          label: "Findings",
          options: [
            "Disc Desiccation",
            "Reduced Disc Height",
            "Diffuse Disc Bulge",
            "Posterocentral Protrusion",
            "Posterolateral Protrusion",
            "Disc Osteophyte Complex",
            "Facet Arthropathy",
            "Ligamentum Flavum Hypertrophy",
            "Cord Compression",
            "Foraminal Narrowing",
          ],
          required: true,
        },
      ],
    },
    {
      id: "canal",
      label: "Canal Diameter",
      fields: [
        { id: "canalDiameter", type: "number", label: "AP Canal Diameter", placeholder: "mm", min: 0, unit: "mm", required: false },
      ],
    },
  ],
};

export const MRI_LUMBAR_SPINE_BUILDER: SmartBuilder = {
  type: "mri_lumbar_spine",
  label: "MRI Lumbar Spine",
  studyType: "MRI Lumbar Spine",
  sections: [
    {
      id: "level_findings",
      label: "Level Findings",
      fields: [
        {
          id: "levels",
          type: "multiselect",
          label: "Levels",
          options: ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"],
          required: true,
        },
        {
          id: "findings",
          type: "multiselect",
          label: "Findings",
          options: [
            "Disc Desiccation",
            "Diffuse Bulge",
            "Protrusion",
            "Extrusion",
            "Annular Tear",
            "Nerve Root Compression",
            "Facet Hypertrophy",
            "Ligamentum Flavum Hypertrophy",
            "Canal Stenosis",
            "Foraminal Stenosis",
          ],
          required: true,
        },
      ],
    },
    {
      id: "canal",
      label: "Canal Diameter",
      fields: [
        { id: "canalDiameter", type: "number", label: "AP Canal Diameter", placeholder: "mm", min: 0, unit: "mm", required: false },
      ],
    },
  ],
};

export const USG_ABDOMEN_BUILDER: SmartBuilder = {
  type: "usg_abdomen",
  label: "USG Abdomen",
  studyType: "USG Abdomen",
  sections: [
    {
      id: "liver",
      label: "A. Liver",
      fields: [
        { id: "fattyLiver", type: "select", label: "Fatty Liver", options: ["Normal", "Grade 1", "Grade 2", "Grade 3"], required: true },
      ],
    },
    {
      id: "gallbladder",
      label: "B. Gall Bladder",
      fields: [
        { id: "gallbladder", type: "select", label: "Gall Bladder", options: ["Normal", "Sludge", "Single Calculus", "Multiple Calculi", "Wall Thickening"], required: true },
      ],
    },
    {
      id: "kidney",
      label: "C. Kidney",
      fields: [
        { id: "kidney", type: "select", label: "Kidney", options: ["Normal", "Calculus", "Hydronephrosis", "Cortical Thinning"], required: true },
      ],
    },
    {
      id: "obstetric",
      label: "D. Obstetric (if applicable)",
      fields: [
        { id: "cr", type: "number", label: "CRL", placeholder: "mm", min: 0, unit: "mm", required: false },
        { id: "bpd", type: "number", label: "BPD", placeholder: "mm", min: 0, unit: "mm", required: false },
        { id: "hc", type: "number", label: "HC", placeholder: "mm", min: 0, unit: "mm", required: false },
        { id: "ac", type: "number", label: "AC", placeholder: "mm", min: 0, unit: "mm", required: false },
        { id: "fl", type: "number", label: "FL", placeholder: "mm", min: 0, unit: "mm", required: false },
      ],
    },
  ],
};

export const MRI_KNEE_BUILDER: SmartBuilder = {
  type: "mri_knee",
  label: "MRI Knee",
  studyType: "MRI Knee",
  sections: [
    {
      id: "meniscus",
      label: "A. Meniscus findings",
      fields: [
        { id: "medialMeniscus", type: "select", label: "Medial Meniscus", options: ["Normal", "Horizontal Tear", "Radial Tear", "Bucket Handle Tear", "Complex Tear"], required: true },
        { id: "lateralMeniscus", type: "select", label: "Lateral Meniscus", options: ["Normal", "Horizontal Tear", "Radial Tear", "Complex Tear"], required: true },
      ],
    },
    {
      id: "ligaments",
      label: "B. Ligaments findings",
      fields: [
        { id: "aclState", type: "select", label: "ACL State", options: ["Intact", "Sprain", "Partial Tear", "Complete Tear"], required: true },
        { id: "pclState", type: "select", label: "PCL State", options: ["Intact", "Sprain", "Tear"], required: true },
      ],
    },
  ],
};

export const MRI_SHOULDER_BUILDER: SmartBuilder = {
  type: "mri_shoulder",
  label: "MRI Shoulder",
  studyType: "MRI Shoulder",
  sections: [
    {
      id: "rotator_cuff",
      label: "A. Rotator Cuff Tendons",
      fields: [
        { id: "supraspinatus", type: "select", label: "Supraspinatus", options: ["Intact", "Tendinosis", "Partial Thickness Tear", "Full Thickness Tear"], required: true },
        { id: "infraspinatus", type: "select", label: "Infraspinatus", options: ["Intact", "Tendinosis", "Tear"], required: true },
      ],
    },
  ],
};

export const CT_BRAIN_BUILDER: SmartBuilder = {
  type: "ct_brain",
  label: "CT Brain",
  studyType: "CT Brain",
  sections: [
    {
      id: "ct_bleed",
      label: "A. Hemorrhage / Infarct",
      fields: [
        { id: "ctHemorrhage", type: "select", label: "Hemorrhage", options: ["None", "Acute EDH", "Acute SDH", "SAH", "Intraparenchymal Bleed"], required: true },
        { id: "ctInfarct", type: "select", label: "Infarct", options: ["None", "Acute Infarct MCA", "Chronic Lacunar Infarct"], required: true },
      ],
    },
  ],
};

export const CT_CHEST_BUILDER: SmartBuilder = {
  type: "ct_chest",
  label: "CT Chest",
  studyType: "CT Chest",
  sections: [
    {
      id: "ct_lung_parenchyma",
      label: "A. Lung Parenchyma",
      fields: [
        { id: "ctNodules", type: "select", label: "Nodules", options: ["None", "Solitary Pulmonary Nodule", "Multiple Nodules"], required: true },
        { id: "ctConsolidation", type: "checkbox", label: "Consolidation Present" },
        { id: "ctEmphysema", type: "checkbox", label: "Emphysema Present" },
      ],
    },
  ],
};

export const XRAY_CHEST_BUILDER: SmartBuilder = {
  type: "xray_chest",
  label: "X-Ray Chest",
  studyType: "X-Ray Chest",
  sections: [
    {
      id: "lung_fields",
      label: "A. Lung Fields & Pleura",
      fields: [
        { id: "opacityType", type: "select", label: "Opacities / Consolidation", options: ["None", "Consolidation Present", "Pleural Effusion Present", "Pneumothorax Present", "Large PE"], required: true },
      ],
    },
  ],
};

export const USG_PELVIS_BUILDER: SmartBuilder = {
  type: "usg_pelvis",
  label: "USG Pelvis",
  studyType: "USG Pelvis",
  sections: [
    {
      id: "uterus",
      label: "A. Uterus",
      fields: [
        { id: "uterusState", type: "select", label: "Uterus", options: ["Normal", "Anteverted", "Retroverted", "Fibroid Present", "Bulky"], required: true }
      ]
    },
    {
      id: "ovaries",
      label: "B. Ovaries",
      fields: [
        { id: "ovariesState", type: "select", label: "Ovaries", options: ["Normal", "Polycystic", "Cyst Present"], required: true }
      ]
    }
  ]
};

export const MRI_DORSAL_SPINE_BUILDER: SmartBuilder = {
  type: "mri_dorsal_spine",
  label: "MRI Dorsal Spine",
  studyType: "MRI Dorsal Spine",
  sections: [
    {
      id: "dorsal_levels",
      label: "Dorsal Level Findings",
      fields: [
        { id: "levels", type: "multiselect", label: "Levels", options: ["D1-D2", "D2-D3", "D3-D4", "D4-D5", "D5-D6", "D6-D7", "D7-D8", "D8-D9", "D9-D10", "D10-D11", "D11-D12"], required: true },
        { id: "findings", type: "multiselect", label: "Findings", options: ["Disc Desiccation", "Bulge", "Protrusion", "Cord Compression"], required: true }
      ]
    }
  ]
};

export const CT_PNS_BUILDER: SmartBuilder = {
  type: "ct_pns",
  label: "CT PNS",
  studyType: "CT PNS",
  sections: [
    {
      id: "sinuses",
      label: "Paranasal Sinuses",
      fields: [
        { id: "maxillarySinus", type: "select", label: "Maxillary Sinus", options: ["Clear", "Mucosal Thickening", "Fluid Level"], required: true },
        { id: "frontalSinus", type: "select", label: "Frontal Sinus", options: ["Clear", "Mucosal Thickening"], required: true }
      ]
    }
  ]
};

export const MRI_MRA_BRAIN_BUILDER: SmartBuilder = {
  type: "mri_mra_brain",
  label: "MRI MRA Brain",
  studyType: "MRI MRA Brain",
  sections: [
    {
      id: "vessels",
      label: "A. Intracranial Vessels (MRA)",
      fields: [
        { id: "vesselsState", type: "select", label: "Vessels State", options: ["Normal", "Mild Stenosis", "Severe Stenosis", "Aneurysm Present", "Occlusion"], required: true },
        { id: "vesselName", type: "text", label: "Vessel Name", placeholder: "e.g., Right MCA, Basilar", required: false },
      ],
    },
  ],
};

export const ALL_BUILDERS: SmartBuilder[] = [
  MRI_BRAIN_BUILDER,
  MRI_MRA_BRAIN_BUILDER,
  MRI_CERVICAL_SPINE_BUILDER,
  MRI_LUMBAR_SPINE_BUILDER,
  MRI_KNEE_BUILDER,
  MRI_SHOULDER_BUILDER,
  CT_BRAIN_BUILDER,
  CT_CHEST_BUILDER,
  XRAY_CHEST_BUILDER,
  USG_ABDOMEN_BUILDER,
  USG_PELVIS_BUILDER,
  MRI_DORSAL_SPINE_BUILDER,
  CT_PNS_BUILDER,
];

export function getBuilderForStudyType(studyType: string): SmartBuilder | undefined {
  return ALL_BUILDERS.find((b) => b.studyType.toLowerCase() === studyType.toLowerCase());
}

export function getBuilderForType(builderType: string): SmartBuilder | undefined {
  return ALL_BUILDERS.find((b) => b.type === builderType);
}

export function detectBuilderType(modality: string, studyDescription?: string | null): string | null {
  const desc = (studyDescription ?? "").toLowerCase();
  const mod = (modality ?? "").toLowerCase();

  if (mod === "mr" || mod === "mri") {
    if (desc.includes("mra") || desc.includes("angiogram") || desc.includes("angio")) return "mri_mra_brain";
    if (desc.includes("brain")) return "mri_brain";
    if (desc.includes("cervical")) return "mri_cervical_spine";
    if (desc.includes("lumbar") || desc.includes("lumbo") || desc.includes("lumbosacral") || desc.includes("spine") || desc.includes("ls")) return "mri_lumbar_spine";
    if (desc.includes("dorsal")) return "mri_dorsal_spine";
    if (desc.includes("knee")) return "mri_knee";
    if (desc.includes("shoulder")) return "mri_shoulder";
  }
  if (mod === "ct") {
    if (desc.includes("brain") || desc.includes("head")) return "ct_brain";
    if (desc.includes("chest") || desc.includes("thorax")) return "ct_chest";
    if (desc.includes("pns") || desc.includes("sinus")) return "ct_pns";
  }
  if (mod === "us" || mod === "ultrasound" || mod === "usg") {
    if (desc.includes("abdomen") || desc.includes("abdominal")) return "usg_abdomen";
    if (desc.includes("pelvis") || desc.includes("pelvic")) return "usg_pelvis";
    return "usg_abdomen";
  }
  if (mod === "xr" || mod === "xray" || mod === "x-ray" || mod === "cr" || mod === "dx") {
    if (desc.includes("chest") || desc.includes("cxr")) return "xray_chest";
  }
  return null;
}

// ============================================================================
// 2. REPORT GENERATION
// ============================================================================

export interface GeneratedReport {
  findings: string;
  impression: string;
  severity: string;
  priority: string;
  recommendations: string[];
  matchedRules: string[];
  isEmpty: boolean;
}

export interface ImpressionRule {
  id: string;
  name: string;
  conditions: RuleCondition[];
  text: string;
  severity: string;
  priority: string;
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: string | string[] | number;
}

function evaluateRule(condition: RuleCondition, selections: Record<string, unknown>): boolean {
  const val = selections[condition.field];
  if (condition.operator === "equals") return val === condition.value;
  if (condition.operator === "not_equals") return val !== condition.value;
  if (condition.operator === "includes") {
    if (Array.isArray(val)) return (condition.value as string[]).some((v) => val.includes(v));
    return String(val).includes(condition.value as string);
  }
  if (condition.operator === "not_includes") {
    if (Array.isArray(val)) return !(condition.value as string[]).some((v) => val.includes(v));
    return !String(val).includes(condition.value as string);
  }
  if (condition.operator === "greater_than") return Number(val) > Number(condition.value);
  if (condition.operator === "less_than") return Number(val) < Number(condition.value);
  if (condition.operator === "greater_equal") return Number(val) >= Number(condition.value);
  if (condition.operator === "less_equal") return Number(val) <= Number(condition.value);
  return false;
}

export function evaluateImpressionRules(
  selections: Record<string, unknown>,
  rules: ImpressionRule[]
): { matched: ImpressionRule[]; severity: string; priority: string } {
  const matched = rules.filter((r) => r.conditions.every((c) => evaluateRule(c, selections)));
  const severities = matched.map((r) => r.severity);
  const priorities = matched.map((r) => r.priority);
  const severityRank = { critical: 4, severe: 3, urgent: 2, moderate: 1, normal: 0 };
  const severity = severities.sort((a, b) => (severityRank[b as keyof typeof severityRank] ?? 0) - (severityRank[a as keyof typeof severityRank] ?? 0))[0] ?? "normal";
  const priority = priorities.sort((a, b) => (severityRank[b as keyof typeof severityRank] ?? 0) - (severityRank[a as keyof typeof severityRank] ?? 0))[0] ?? "normal";
  return { matched, severity, priority };
}

export const DEFAULT_SEED_RULES: ImpressionRule[] = [
  { id: "acute_infarct_mca", name: "Acute Infarct MCA", conditions: [{ field: "infarctType", operator: "equals", value: "Acute" }, { field: "infarctLocation", operator: "equals", value: "MCA Territory" }], text: "Acute infarct involving the MCA territory.", severity: "critical", priority: "critical" },
  { id: "edh", name: "EDH", conditions: [{ field: "hemorrhageType", operator: "equals", value: "EDH" }], text: "Extradural hematoma with associated mass effect.", severity: "critical", priority: "critical" },
  { id: "grade3_fatty", name: "Grade 3 Fatty Liver", conditions: [{ field: "fattyLiver", operator: "equals", value: "Grade 3" }], text: "Severe fatty infiltration of liver.", severity: "severe", priority: "urgent" },
  { id: "bulge_nerve", name: "Bulge + Nerve Root Compression", conditions: [{ field: "findings", operator: "includes", value: ["Diffuse Bulge", "Nerve Root Compression"] }], text: "Diffuse disc bulge causing compression upon bilateral exiting nerve roots.", severity: "moderate", priority: "urgent" },
  { id: "severe_stenosis", name: "Severe Canal Stenosis", conditions: [{ field: "canalDiameter", operator: "less_than", value: "5" }], text: "Severe spinal canal stenosis.", severity: "critical", priority: "critical" },
  { id: "cord_compression", name: "Cord Compression", conditions: [{ field: "findings", operator: "includes", value: "Cord Compression" }], text: "Spinal cord compression — urgent neurosurgical evaluation.", severity: "critical", priority: "critical" },
  { id: "sdh", name: "SDH", conditions: [{ field: "hemorrhageType", operator: "equals", value: "SDH" }], text: "Subdural hematoma with associated mass effect.", severity: "critical", priority: "critical" },
  { id: "sah", name: "SAH", conditions: [{ field: "hemorrhageType", operator: "equals", value: "SAH" }], text: "Subarachnoid hemorrhage with associated mass effect.", severity: "critical", priority: "critical" },
  { id: "iph", name: "IPH", conditions: [{ field: "hemorrhageType", operator: "equals", value: "IPH" }], text: "Intraparenchymal hemorrhage with associated mass effect.", severity: "critical", priority: "critical" },
  { id: "ivh", name: "IVH", conditions: [{ field: "hemorrhageType", operator: "equals", value: "IVH" }], text: "Intraventricular hemorrhage with associated mass effect.", severity: "critical", priority: "critical" },
];

export const BUILDER_TECHNIQUES: Record<string, string> = {
  mri_brain: "Multiplanar multisequence MRI of brain.",
  mri_mra_brain: "Magnetic resonance angiography (MRA) of intracranial vessels.",
  mri_cervical_spine: "Multiplanar multisequence MRI of cervical spine.",
  mri_lumbar_spine: "Multiplanar multisequence MRI of lumbar spine.",
  mri_dorsal_spine: "Multiplanar multisequence MRI of dorsal spine.",
  mri_knee: "Multiplanar multisequence MRI of knee.",
  mri_shoulder: "Multiplanar multisequence MRI of shoulder.",
  ct_brain: "Non-contrast CT scan of brain.",
  ct_chest: "High-resolution chest CT scan.",
  ct_pns: "CT scan of paranasal sinuses.",
  usg_abdomen: "Transabdominal real-time ultrasonography of abdomen.",
  usg_pelvis: "Transabdominal real-time ultrasonography of pelvis.",
  xray_chest: "Digital PA view chest radiograph.",
};

// ── MRI Brain ──
function generateMriBrainFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];

  // White Matter
  const wm = sel.whiteMatter as string;
  if (wm === "Normal") parts.push("White matter: No hyperintense lesions on T2/FLAIR.");
  else if (wm === "Chronic Microangiopathic Changes") parts.push("White matter: Chronic microangiopathic changes seen on T2/FLAIR.");
  else if (wm === "Fazekas Grade 1") parts.push("White matter: Scattered periventricular and deep white matter hyperintensities (Fazekas Grade 1).");
  else if (wm === "Fazekas Grade 2") parts.push("White matter: Confluent periventricular and deep white matter hyperintensities (Fazekas Grade 2).");
  else if (wm === "Fazekas Grade 3") parts.push("White matter: Extensive confluent periventricular and deep white matter hyperintensities extending to subcortical regions (Fazekas Grade 3).");

  // Infarct
  if (sel.infarctPresent === true) {
    const type = sel.infarctType as string;
    const location = sel.infarctLocation as string;
    const side = sel.infarctSide as string;
    const custom = sel.infarctCustom as string;
    let loc = location;
    if (location === "Custom Location" && custom) loc = custom;
    if (side) loc = `${side} ${loc}`;
    if (type && loc) parts.push(`Infarct: ${type} infarct involving the ${loc}.`);
  }

  // Hemorrhage
  if (sel.hemorrhagePresent === true) {
    const type = sel.hemorrhageType as string;
    const location = sel.hemorrhageLocation as string;
    const side = sel.hemorrhageSide as string;
    const thickness = sel.hemorrhageThickness as number;
    const shift = sel.midlineShift as number;
    let desc = `${type} seen in the ${side} ${location}`;
    if (thickness) desc += `, thickness ${thickness} mm`;
    if (shift) desc += `; midline shift ${shift} mm`;
    desc += ".";
    parts.push(`Hemorrhage: ${desc}`);
  }

  // Atrophy
  const atrophy = sel.atrophy as string;
  if (atrophy === "None") parts.push("Brain volume: Normal.");
  else if (atrophy === "Mild") parts.push("Brain volume: Mild cerebral atrophy with mild sulcal prominence.");
  else if (atrophy === "Moderate") parts.push("Brain volume: Moderate cerebral atrophy with prominent sulci and ventricles.");
  else if (atrophy === "Severe") parts.push("Brain volume: Severe cerebral atrophy with marked prominence of sulci and ventricles.");

  // Hydrocephalus
  const hydro = sel.hydrocephalus as string;
  if (hydro === "None") parts.push("Ventricular system: Normal size and configuration.");
  else if (hydro === "Mild") parts.push("Ventricular system: Mild ventriculomegaly.");
  else if (hydro === "Moderate") parts.push("Ventricular system: Moderate ventriculomegaly with hydrocephalus.");
  else if (hydro === "Severe") parts.push("Ventricular system: Severe ventriculomegaly with hydrocephalus.");

  return parts.length ? parts.join("\n") : "No findings selected.";
}

// ── MRI Cervical Spine ──
function generateMriCervicalFindings(sel: Record<string, unknown>): string {
  const levels = sel.levels as string[];
  const findings = sel.findings as string[];
  const canal = sel.canalDiameter as number;
  const parts: string[] = [];

  if (levels && levels.length > 0 && findings && findings.length > 0) {
    const levelStr = levels.join(", ");
    const findingsStr = findings.join(", ");
    parts.push(`${levelStr}: ${findingsStr}.`);
  }

  if (canal !== undefined && canal !== null && !Number.isNaN(canal)) {
    let severity = "normal";
    if (canal > 10) severity = "none";
    else if (canal >= 8 && canal <= 10) severity = "mild";
    else if (canal >= 5 && canal < 8) severity = "moderate";
    else if (canal < 5) severity = "severe";
    const labels: Record<string, string> = {
      none: "No significant spinal canal stenosis",
      mild: "Mild spinal canal stenosis",
      moderate: "Moderate spinal canal stenosis",
      severe: "Severe spinal canal stenosis",
    };
    parts.push(`Canal diameter: ${canal} mm — ${labels[severity]}.`);
  }

  return parts.length ? parts.join("\n") : "No findings selected.";
}

// ── MRI Lumbar Spine ──
function generateMriLumbarFindings(sel: Record<string, unknown>): string {
  const levels = sel.levels as string[];
  const findings = sel.findings as string[];
  const canal = sel.canalDiameter as number;
  const parts: string[] = [];

  if (levels && levels.length > 0 && findings && findings.length > 0) {
    const levelStr = levels.join(", ");
    const findingsStr = findings.join(", ");
    parts.push(`${levelStr}: ${findingsStr}.`);
  }

  if (canal !== undefined && canal !== null && !Number.isNaN(canal)) {
    let severity = "normal";
    if (canal > 10) severity = "none";
    else if (canal >= 8 && canal <= 10) severity = "mild";
    else if (canal >= 5 && canal < 8) severity = "moderate";
    else if (canal < 5) severity = "severe";
    const labels: Record<string, string> = {
      none: "No significant spinal canal stenosis",
      mild: "Mild spinal canal stenosis",
      moderate: "Moderate spinal canal stenosis",
      severe: "Severe spinal canal stenosis",
    };
    parts.push(`Canal diameter: ${canal} mm — ${labels[severity]}.`);
  }

  return parts.length ? parts.join("\n") : "No findings selected.";
}

// ── MRI Dorsal Spine ──
function generateMriDorsalFindings(sel: Record<string, unknown>): string {
  const levels = sel.levels as string[];
  const findings = sel.findings as string[];
  const parts: string[] = [];
  if (levels && levels.length > 0 && findings && findings.length > 0) {
    parts.push(`${levels.join(", ")}: ${findings.join(", ")}.`);
  }
  return parts.length ? parts.join("\n") : "No findings selected.";
}

// ── USG Abdomen ──
function generateUsgAbdomenFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];

  // Liver
  const fl = sel.fattyLiver as string;
  if (fl === "Normal") parts.push("Liver: Normal size, shape, and echotexture. No focal lesion.");
  else if (fl === "Grade 1") parts.push("Liver: Mild increase in echotexture with mild attenuation of posterior wall (Grade 1 fatty liver).");
  else if (fl === "Grade 2") parts.push("Liver: Moderate increase in echotexture with moderate attenuation of posterior wall (Grade 2 fatty liver).");
  else if (fl === "Grade 3") parts.push("Liver: Marked increase in echotexture with marked attenuation of posterior wall (Grade 3 fatty liver).");

  // Gallbladder
  const gb = sel.gallbladder as string;
  if (gb === "Normal") parts.push("Gallbladder: Normal wall thickness. No calculus.");
  else if (gb === "Sludge") parts.push("Gallbladder: Sludge seen within the lumen.");
  else if (gb === "Single Calculus") parts.push("Gallbladder: Single calculus seen within the lumen.");
  else if (gb === "Multiple Calculi") parts.push("Gallbladder: Multiple calculi seen within the lumen.");
  else if (gb === "Wall Thickening") parts.push("Gallbladder: Wall thickening noted.");

  // Kidney
  const k = sel.kidney as string;
  if (k === "Normal") parts.push("Kidneys: Both normal size. No hydronephrosis / calculus.");
  else if (k === "Calculus") parts.push("Kidneys: Calculus seen.");
  else if (k === "Hydronephrosis") parts.push("Kidneys: Hydronephrosis present.");
  else if (k === "Cortical Thinning") parts.push("Kidneys: Cortical thinning noted.");

  // Obstetric
  const cr = sel.cr as number;
  const bpd = sel.bpd as number;
  const hc = sel.hc as number;
  const ac = sel.ac as number;
  const flVal = sel.fl as number;
  const obstetricParts: string[] = [];
  if (cr) { const ga = calculateGAFromCRL(cr); if (ga) obstetricParts.push(`CRL ${cr} mm → GA ${ga.weeks}+${ga.days} wks`); }
  if (bpd) { const ga = calculateGAFromBPD(bpd); if (ga) obstetricParts.push(`BPD ${bpd} mm → GA ${ga.weeks}+${ga.days} wks`); }
  if (hc) { const ga = calculateGAFromHC(hc); if (ga) obstetricParts.push(`HC ${hc} mm → GA ${ga.weeks}+${ga.days} wks`); }
  if (ac) { const ga = calculateGAFromAC(ac); if (ga) obstetricParts.push(`AC ${ac} mm → GA ${ga.weeks}+${ga.days} wks`); }
  if (flVal) { const ga = calculateGAFromFL(flVal); if (ga) obstetricParts.push(`FL ${flVal} mm → GA ${ga.weeks}+${ga.days} wks`); }
  if (obstetricParts.length > 0) {
    parts.push(`Obstetric: ${obstetricParts.join("; ")}.`);
  }

  return parts.length ? parts.join("\n") : "No findings selected.";
}

// ── USG Pelvis ──
function generateUsgPelvisFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sel.uterusState) parts.push(`Uterus: ${sel.uterusState}.`);
  if (sel.ovariesState) parts.push(`Ovaries: ${sel.ovariesState}.`);
  return parts.length ? parts.join("\n") : "No findings selected.";
}

// ── CT PNS ──
function generateCtPnsFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sel.maxillarySinus) parts.push(`Maxillary Sinuses: ${sel.maxillarySinus}.`);
  if (sel.frontalSinus) parts.push(`Frontal Sinuses: ${sel.frontalSinus}.`);
  return parts.length ? parts.join("\n") : "No findings selected.";
}

// ── Obstetric GA Calculation ──
function calculateGAFromCRL(mm: number): { weeks: number; days: number } | null {
  if (mm <= 0) return null;
  // Hadlock formula: GA = 40.9 + 3.2 * ln(CRL in mm) — simplified table
  const ga = 40.9 + 3.2 * Math.log(mm);
  const weeks = Math.floor(ga / 7);
  const days = Math.round(ga % 7);
  return { weeks, days };
}
function calculateGAFromBPD(mm: number): { weeks: number; days: number } | null {
  if (mm <= 0) return null;
  const ga = 9.54 + 1.482 * mm + 0.0164 * mm * mm;
  const weeks = Math.floor(ga);
  const days = Math.round((ga - weeks) * 7);
  return { weeks, days };
}
function calculateGAFromHC(mm: number): { weeks: number; days: number } | null {
  if (mm <= 0) return null;
  const ga = 10.3 + 0.028 * mm + 0.00167 * mm * mm;
  const weeks = Math.floor(ga);
  const days = Math.round((ga - weeks) * 7);
  return { weeks, days };
}
function calculateGAFromAC(mm: number): { weeks: number; days: number } | null {
  if (mm <= 0) return null;
  const ga = 8.14 + 0.034 * mm + 0.0012 * mm * mm;
  const weeks = Math.floor(ga);
  const days = Math.round((ga - weeks) * 7);
  return { weeks, days };
}
function calculateGAFromFL(mm: number): { weeks: number; days: number } | null {
  if (mm <= 0) return null;
  const ga = 10.35 + 0.175 * mm + 0.0012 * mm * mm;
  const weeks = Math.floor(ga);
  const days = Math.round((ga - weeks) * 7);
  return { weeks, days };
}

function generateMriKneeFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sel.medialMeniscus) parts.push(`Medial Meniscus: ${sel.medialMeniscus}.`);
  if (sel.lateralMeniscus) parts.push(`Lateral Meniscus: ${sel.lateralMeniscus}.`);
  if (sel.aclState) parts.push(`ACL: ${sel.aclState}.`);
  if (sel.pclState) parts.push(`PCL: ${sel.pclState}.`);
  return parts.join("\n");
}

function generateMriShoulderFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sel.supraspinatus) parts.push(`Supraspinatus Tendon: ${sel.supraspinatus}.`);
  if (sel.infraspinatus) parts.push(`Infraspinatus Tendon: ${sel.infraspinatus}.`);
  return parts.join("\n");
}

function generateCtBrainFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sel.ctHemorrhage) parts.push(`Hemorrhage: ${sel.ctHemorrhage}.`);
  if (sel.ctInfarct) parts.push(`Infarct: ${sel.ctInfarct}.`);
  return parts.join("\n");
}

function generateCtChestFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sel.ctNodules) parts.push(`Nodules: ${sel.ctNodules}.`);
  if (sel.ctConsolidation === true) parts.push("Lungs: Areas of focal airspace consolidation present.");
  if (sel.ctEmphysema === true) parts.push("Lungs: Centrilobular emphysematous changes noted.");
  return parts.join("\n");
}

function generateXrayChestFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sel.opacityType && sel.opacityType !== "None") parts.push(`Lung fields: ${sel.opacityType}.`);
  else parts.push("Lung fields: Both lung fields are clear. No focal consolidation, pneumothorax, or pleural effusion.");
  return parts.join("\n");
}

function generateMriMraBrainFindings(sel: Record<string, unknown>): string {
  const parts: string[] = [];
  const state = sel.vesselsState as string;
  const name = sel.vesselName as string;

  if (state === "Normal") {
    parts.push("MRA Brain: Major intracranial arteries demonstrate normal caliber and flow signal. No aneurysm, stenosis, or occlusion.");
  } else if (state) {
    let desc = `${state}`;
    if (name) desc += ` involving the ${name}`;
    parts.push(`MRA Brain: ${desc}.`);
  }
  return parts.join("\n");
}

export function generateSmartReport(
  builderType: string,
  selections: Record<string, unknown>
): GeneratedReport {
  let findings = "";
  switch (builderType) {
    case "mri_brain": findings = generateMriBrainFindings(selections); break;
    case "mri_mra_brain": findings = generateMriMraBrainFindings(selections); break;
    case "mri_cervical_spine": findings = generateMriCervicalFindings(selections); break;
    case "mri_lumbar_spine": findings = generateMriLumbarFindings(selections); break;
    case "mri_dorsal_spine": findings = generateMriDorsalFindings(selections); break;
    case "mri_knee": findings = generateMriKneeFindings(selections); break;
    case "mri_shoulder": findings = generateMriShoulderFindings(selections); break;
    case "ct_brain": findings = generateCtBrainFindings(selections); break;
    case "ct_chest": findings = generateCtChestFindings(selections); break;
    case "ct_pns": findings = generateCtPnsFindings(selections); break;
    case "xray_chest": findings = generateXrayChestFindings(selections); break;
    case "usg_abdomen": findings = generateUsgAbdomenFindings(selections); break;
    case "usg_pelvis": findings = generateUsgPelvisFindings(selections); break;
    default: findings = "No findings selected.";
  }

  const ruleResult = evaluateImpressionRules(selections, DEFAULT_SEED_RULES);
  const impressions = ruleResult.matched.map((r) => r.text);
  const impression = impressions.length ? impressions.join("\n") : "No significant abnormality.";

  const recommendations: string[] = [];
  if (ruleResult.severity === "critical" || ruleResult.severity === "severe") {
    recommendations.push("Urgent clinical correlation and management advised.");
  }
  if (ruleResult.severity === "urgent") {
    recommendations.push("Clinical correlation advised.");
  }

  return {
    findings,
    impression,
    severity: ruleResult.severity,
    priority: ruleResult.priority,
    recommendations,
    matchedRules: ruleResult.matched.map((r) => r.name),
    isEmpty: findings === "No findings selected.",
  };
}

export function generateImpressionText(
  builderType: string,
  selections: Record<string, unknown>
): string {
  const ruleResult = evaluateImpressionRules(selections, DEFAULT_SEED_RULES);
  if (ruleResult.matched.length === 0) return "No significant abnormality.";
  return ruleResult.matched.map((r) => r.text).join("\n");
}

export function generateRecommendations(
  severity: string,
  matchedRules: string[]
): string[] {
  const recs: string[] = [];
  if (severity === "critical" || severity === "severe") {
    recs.push("Urgent clinical correlation and management advised.");
  } else if (severity === "urgent") {
    recs.push("Clinical correlation advised.");
  } else {
    recs.push("Routine follow-up.");
  }
  if (matchedRules.includes("Cord Compression")) {
    recs.push("Urgent neurosurgical evaluation recommended.");
  }
  if (matchedRules.includes("Acute Infarct MCA")) {
    recs.push("Immediate stroke protocol activation recommended.");
  }
  return recs;
}

// ── Combined Title Composer ──
export function generateCombinedTitle(builderTypes: string[]): string {
  if (builderTypes.length === 0) return "RADIOLOGY REPORT";
  
  const normalized = builderTypes.map(t => t.toLowerCase());

  // 1. MRI Whole Spine check
  const hasCervical = normalized.includes("mri_cervical_spine");
  const hasLumbar = normalized.includes("mri_lumbar_spine");
  const hasDorsal = normalized.includes("mri_dorsal_spine");
  if (hasCervical && hasLumbar && hasDorsal) {
    return "MRI WHOLE SPINE";
  }

  // 2. MRI Brain + Screening Cervical Spine
  if (normalized.includes("mri_brain") && normalized.includes("mri_cervical_spine")) {
    return "MRI BRAIN WITH SCREENING MRI CERVICAL SPINE";
  }

  // 3. MRI Brain + LS Spine
  if (normalized.includes("mri_brain") && normalized.includes("mri_lumbar_spine")) {
    return "MRI BRAIN WITH SCREENING MRI LUMBOSACRAL SPINE";
  }

  // 4. MRI Brain + MRA
  if (normalized.includes("mri_brain") && normalized.includes("mri_mra_brain")) {
    return "MRI BRAIN WITH MRA BRAIN";
  }

  // 5. MRI Cervical + Dorsal Spine
  if (normalized.includes("mri_cervical_spine") && normalized.includes("mri_dorsal_spine")) {
    return "MRI CERVICAL AND DORSAL SPINE";
  }

  // 6. MRI Lumbar + Whole Spine Screening
  if (normalized.includes("mri_lumbar_spine") && (normalized.includes("mri_cervical_spine") || normalized.includes("mri_dorsal_spine"))) {
    return "MRI LUMBAR WITH WHOLE SPINE SCREENING";
  }

  // 4. USG Abdomen + Pelvis
  if (normalized.includes("usg_abdomen") && normalized.includes("usg_pelvis")) {
    return "USG ABDOMEN AND PELVIS";
  }

  // 5. CT Brain + PNS
  if (normalized.includes("ct_brain") && normalized.includes("ct_pns")) {
    return "CT BRAIN AND PNS";
  }

  // Default clean join
  const labels = builderTypes.map(t => {
    const b = getBuilderForType(t);
    return b ? b.label.toUpperCase() : t.toUpperCase().replace("_", " ");
  });

  if (labels.length === 2) {
    return `${labels[0]} AND ${labels[1]}`;
  }
  if (labels.length > 2) {
    const last = labels.pop();
    return `${labels.join(", ")} AND ${last}`;
  }
  return labels[0];
}

// ── Combined Technique Composer ──
export function generateCombinedTechnique(builderTypes: string[]): string {
  if (builderTypes.length === 0) return "";
  
  const normalized = builderTypes.map(t => t.toLowerCase());
  const hasMriBrain = normalized.includes("mri_brain");
  const hasMriCervical = normalized.includes("mri_cervical_spine");
  const hasMriLumbar = normalized.includes("mri_lumbar_spine");
  const hasMriDorsal = normalized.includes("mri_dorsal_spine");
  const hasMra = normalized.includes("mri_mra_brain");
  
  if (hasMriCervical && hasMriDorsal && hasMriLumbar) {
    return "Multiplanar multisequence MRI of cervical, dorsal and lumbar spine (whole spine) performed using standard sagittal and axial sequence protocol.";
  }
  if (hasMriBrain && hasMriCervical && hasMriLumbar) {
    return "Multiplanar multisequence MRI of brain with screening MRI cervical and lumbosacral spine performed using standard and limited sequence protocol.";
  }
  if (hasMriBrain && hasMra) {
    return "Multiplanar multisequence MRI of brain combined with 3D time-of-flight magnetic resonance angiography (MRA) of intracranial vessels.";
  }
  if (hasMriCervical && hasMriDorsal) {
    return "Multiplanar multisequence MRI of cervical and dorsal spine performed using standard sequence protocol.";
  }
  if (hasMriLumbar && (hasMriCervical || hasMriDorsal)) {
    return "Multiplanar multisequence MRI of lumbar spine combined with screening sagittal T2 sequence of whole spine.";
  }
  if (hasMriBrain && hasMriCervical) {
    return "Multiplanar multisequence MRI of brain with screening MRI cervical spine performed using limited planar and limited sequence protocol.";
  }
  if (hasMriBrain && hasMriLumbar) {
    return "Multiplanar multisequence MRI of brain with screening MRI lumbosacral spine performed using limited planar and limited sequence protocol.";
  }

  const list = builderTypes.map(t => BUILDER_TECHNIQUES[t] || `Standard study of ${t.replace("_", " ")}.`);
  return list.join(" ");
}

// ── Multi Study Composer ──
export function generateMultiStudyReport(
  builderTypes: string[],
  multiSelections: Record<string, Record<string, any>>
): { findings: string; impression: string; severity: string } {
  const findingsBlocks: string[] = [];
  const impressionPoints: string[] = [];
  let maxSeverity = "normal";
  const severityRank = { critical: 4, severe: 3, urgent: 2, moderate: 1, normal: 0 };

  for (const bType of builderTypes) {
    const builder = getBuilderForType(bType);
    if (!builder) continue;
    const sel = multiSelections[bType] || {};
    const report = generateSmartReport(bType, sel);
    
    // Add sectioned findings
    if (report.findings && report.findings !== "No findings selected.") {
      findingsBlocks.push(`${builder.label.toUpperCase()}\n${report.findings}`);
    }

    // Add unique impressions
    if (report.impression && report.impression !== "No significant abnormality.") {
      const pts = report.impression.split("\n").map(p => p.trim()).filter(Boolean);
      for (const p of pts) {
        if (!impressionPoints.includes(p)) impressionPoints.push(p);
      }
    }

    if (severityRank[report.severity as keyof typeof severityRank] > severityRank[maxSeverity as keyof typeof severityRank]) {
      maxSeverity = report.severity;
    }
  }

  const findingsText = findingsBlocks.join("\n\n");
  const impressionText = impressionPoints.length > 0 ? impressionPoints.join("\n") : "No significant abnormality.";

  return {
    findings: findingsText,
    impression: impressionText,
    severity: maxSeverity
  };
}

// ============================================================================
// 3. CANAL STENOSIS CLASSIFICATION
// ============================================================================

export function classifyCanalStenosis(diameterMm: number): {
  severity: string;
  label: string;
  description: string;
} {
  if (diameterMm > 10) {
    return { severity: "normal", label: "No Significant Stenosis", description: `Canal diameter ${diameterMm} mm — no significant stenosis.` };
  }
  if (diameterMm >= 8 && diameterMm <= 10) {
    return { severity: "mild", label: "Mild Stenosis", description: `Canal diameter ${diameterMm} mm — mild stenosis.` };
  }
  if (diameterMm >= 5 && diameterMm < 8) {
    return { severity: "moderate", label: "Moderate Stenosis", description: `Canal diameter ${diameterMm} mm — moderate stenosis.` };
  }
  return { severity: "severe", label: "Severe Stenosis", description: `Canal diameter ${diameterMm} mm — severe stenosis.` };
}

// ============================================================================
// 4. UTILITY
// ============================================================================

export function defaultSelections(builderType: string): Record<string, unknown> {
  switch (builderType) {
    case "mri_brain":
      return { whiteMatter: "Normal", atrophy: "None", hydrocephalus: "None" };
    case "mri_mra_brain":
      return { vesselsState: "Normal", vesselName: "" };
    case "mri_cervical_spine":
      return { levels: [], findings: [], canalDiameter: "" };
    case "mri_lumbar_spine":
      return { levels: [], findings: [], canalDiameter: "" };
    case "mri_dorsal_spine":
      return { levels: [], findings: [] };
    case "mri_knee":
      return { medialMeniscus: "Normal", lateralMeniscus: "Normal", aclState: "Intact", pclState: "Intact" };
    case "mri_shoulder":
      return { supraspinatus: "Intact", infraspinatus: "Intact" };
    case "ct_brain":
      return { ctHemorrhage: "None", ctInfarct: "None" };
    case "ct_chest":
      return { ctNodules: "None", ctConsolidation: false, ctEmphysema: false };
    case "ct_pns":
      return { maxillarySinus: "Clear", frontalSinus: "Clear" };
    case "xray_chest":
      return { opacityType: "None" };
    case "usg_abdomen":
      return { fattyLiver: "Normal", gallbladder: "Normal", kidney: "Normal" };
    case "usg_pelvis":
      return { uterusState: "Normal", ovariesState: "Normal" };
    default:
      return {};
  }
}
