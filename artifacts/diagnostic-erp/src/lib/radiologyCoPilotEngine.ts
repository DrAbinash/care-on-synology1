// ─── AI Radiologist Co-Pilot Engine ───
// Client-side advisory reasoning, checklists, prior comparisons, and reminders.

export interface CoPilotSuggestion {
  id: string;
  type: "clinical" | "checklist" | "contradiction" | "comparison" | "reminder";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  actionableText?: string;
  actionMacro?: string; // name of action to trigger in UI
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

// ─── 1. Real-Time Clinical Observer Rules ───
export function observeReportText(
  modality: string,
  studyDescription: string,
  text: string,
  region?: string | null,
): CoPilotSuggestion[] {
  const suggestions: CoPilotSuggestion[] = [];
  const normalized = text.toLowerCase();
  const studyHaystack = (region ?? studyDescription).toLowerCase();

  // Rule: Disc protrusion documented -> Foraminal stenosis not described
  if (normalized.includes("protrusion") || normalized.includes("herniation") || normalized.includes("bulge")) {
    if (!normalized.includes("foraminal") && !normalized.includes("stenosis") && !normalized.includes("foramina")) {
      suggestions.push({
        id: "spine-foraminal",
        type: "clinical",
        severity: "warning",
        title: "Foraminal Narrowing Unreported",
        message: "You documented a disc protrusion/bulge but neural foramina or exiting nerve roots are not described.",
        actionableText: "Insert template placeholder for neural foramina",
        actionMacro: "insertForaminalPlaceholder",
      });
    }
  }

  // Rule: Diffusion restriction -> ADC not mentioned
  if (normalized.includes("diffusion restriction") || normalized.includes("restricted diffusion") || normalized.includes("dwi hyperintense")) {
    if (!normalized.includes("adc")) {
      suggestions.push({
        id: "brain-adc",
        type: "clinical",
        severity: "critical",
        title: "ADC Mention Missing",
        message: "Diffusion restriction is described, but the Apparent Diffusion Coefficient (ADC) correlation is not mentioned.",
        actionableText: "Insert: 'correlating with corresponding hypointensity on ADC map'",
      });
    }
  }

  // Rule: Enhancing lesion -> Consider spectroscopy
  if (normalized.includes("enhancing") || normalized.includes("enhancement") || normalized.includes("ring-enhancing")) {
    if (!normalized.includes("spectroscopy") && !normalized.includes("mrs") && studyHaystack.includes("brain")) {
      suggestions.push({
        id: "brain-spectroscopy",
        type: "clinical",
        severity: "info",
        title: "Consider MR Spectroscopy",
        message: "An enhancing lesion is described in the brain. Advanced spectroscopy recommendation is advised to differentiate etiology.",
        actionableText: "Add recommendation for MR Spectroscopy",
        actionMacro: "addSpectroscopyRecommendation",
      });
    }
  }

  // Rule: Tumor present -> Perilesional edema not mentioned
  if (normalized.includes("tumor") || normalized.includes("mass") || normalized.includes("glioma") || normalized.includes("metastasis")) {
    if (!normalized.includes("edema") && !normalized.includes("mass effect") && !normalized.includes("swelling")) {
      suggestions.push({
        id: "tumor-edema",
        type: "clinical",
        severity: "warning",
        title: "Perilesional Edema Unspecified",
        message: "Tumor/mass described but presence or absence of perilesional edema/mass effect is not documented.",
        actionableText: "Insert: 'No significant perilesional edema or mass effect is seen.'",
      });
    }
  }

  // Rule: Hydrocephalus mentioned -> Evans Index available
  if (normalized.includes("hydrocephalus") || normalized.includes("ventricles are enlarged") || normalized.includes("ventriculomegaly")) {
    if (!normalized.includes("evans") && !normalized.includes("index")) {
      suggestions.push({
        id: "hydrocephalus-evans",
        type: "clinical",
        severity: "info",
        title: "Measure Evans Index",
        message: "Hydrocephalus is described. Consider adding Evans Index to quantify ventricular enlargement.",
        actionableText: "Insert: 'Evans index is calculated at ___.'",
      });
    }
  }

  // Rule: Acute infarct described -> MRA/CTA recommended
  if (normalized.includes("acute infarct") || normalized.includes("acute stroke")) {
    if (!normalized.includes("mra") && !normalized.includes("cta") && !normalized.includes("angiography")) {
      suggestions.push({
        id: "infarct-angio",
        type: "clinical",
        severity: "warning",
        title: "Recommend Angiography",
        message: "Acute infarct documented. Vascular status assessment (MRA or CTA) is highly recommended.",
        actionableText: "Append MRA/CTA follow-up recommendation",
        actionMacro: "addAngioRecommendation",
      });
    }
  }

  // Rule: Lesion measured but margins/boundary not described
  if (/\b\d+\s*(?:mm|cm)\b/.test(normalized)) {
    if (!normalized.includes("margin") && !normalized.includes("border") && !normalized.includes("circumscribed") && !normalized.includes("ill-defined")) {
      suggestions.push({
        id: "lesion-margins",
        type: "clinical",
        severity: "info",
        title: "Lesion Margins Undescribed",
        message: "You measured a lesion/nodule, but did not describe its margins (e.g. well-circumscribed vs. ill-defined).",
        actionableText: "Insert: 'margins are well-circumscribed'",
      });
    }
  }

  return suggestions;
}

// ─── 2. Smart Clinical Reminders ───
export function getSmartReminders(modality: string, studyDescription: string, region?: string | null): CoPilotSuggestion[] {
  const suggestions: CoPilotSuggestion[] = [];
  const desc = (region ?? studyDescription).toLowerCase();
  const mod = modality.toUpperCase();

  if (desc.includes("brain") || desc.includes("head")) {
    if (mod.includes("MR")) {
      suggestions.push({
        id: "rem-mr-brain",
        type: "reminder",
        severity: "info",
        title: "Brain MRI Checklist Recommendations",
        message: "For brain tumor/demyelination protocols, consider contrast enhancement, MR perfusion, spectroscopy, and MRV.",
      });
    } else if (mod.includes("CT")) {
      suggestions.push({
        id: "rem-ct-brain",
        type: "reminder",
        severity: "info",
        title: "CT Brain Vascular Check",
        message: "If intracranial hemorrhage or hyperdense vessel sign is present, consider recommending CTA or follow-up MRI.",
      });
    }
  } else if (desc.includes("spine")) {
    suggestions.push({
      id: "rem-spine",
      type: "reminder",
      severity: "info",
      title: "Spine Level Correlation",
      message: "Always correlate findings with clinical dermatomes/myotomes. Check sagittal STIR for occult marrow edema.",
    });
  } else if (desc.includes("pregnancy") || desc.includes("obstetric") || desc.includes("fetal") || desc.includes("obg")) {
    suggestions.push({
      id: "rem-ob",
      type: "reminder",
      severity: "info",
      title: "Obstetric Metrics",
      message: "Verify AFI (Amniotic Fluid Index) measurements and Umbilical/Uterine Doppler indices if fetal growth restriction is suspected.",
    });
  } else if (desc.includes("mammography") || desc.includes("breast")) {
    suggestions.push({
      id: "rem-mammo",
      type: "reminder",
      severity: "info",
      title: "BI-RADS Classification",
      message: "Ensure BI-RADS category completion and suggest targeted breast ultrasound or biopsy correlation if Category 4/5.",
    });
  } else if (mod.includes("US")) {
    suggestions.push({
      id: "rem-usg",
      type: "reminder",
      severity: "info",
      title: "US Doppler Correlation",
      message: "If vascular structures or focal masses are detected, consider recommending color Doppler evaluation or MRI/CT correlation.",
    });
  }

  return suggestions;
}

// ─── 3. Checklist Generator ───
export function getChecklist(modality: string, studyDescription: string, region?: string | null): ChecklistItem[] {
  const desc = (region ?? studyDescription).toLowerCase();
  const mod = modality.toUpperCase();

  if (desc.includes("brain") || desc.includes("head")) {
    return [
      { id: "brain-dwi", label: "DWI Sequences", checked: false },
      { id: "brain-adc", label: "ADC Maps", checked: false },
      { id: "brain-swi", label: "SWI/GRE (Hemorrhage)", checked: false },
      { id: "brain-contrast", label: "Post-Contrast T1", checked: false },
      { id: "brain-ventricles", label: "Ventricles & Sulci", checked: false },
      { id: "brain-midline", label: "Midline Structures", checked: false },
      { id: "brain-cisterns", label: "Basal Cisterns", checked: false },
      { id: "brain-orbits", label: "Orbits & Pituitary", checked: false },
    ];
  }

  if (desc.includes("spine")) {
    return [
      { id: "spine-canal", label: "Canal AP Diameter", checked: false },
      { id: "spine-foramina", label: "Neural Foramina", checked: false },
      { id: "spine-cord", label: "Cord Signal & Calibre", checked: false },
      { id: "spine-marrow", label: "Marrow Signal (T1/STIR)", checked: false },
      { id: "spine-ligaments", label: "Ligaments (PLL/FL)", checked: false },
      { id: "spine-facets", label: "Facet Joints", checked: false },
      { id: "spine-alignment", label: "Alignment & Sagittal slip", checked: false },
    ];
  }

  if (mod.includes("US")) {
    return [
      { id: "usg-liver", label: "Liver & Echotexture", checked: false },
      { id: "usg-gb", label: "Gallbladder & Wall thickness", checked: false },
      { id: "usg-cbd", label: "CBD Diameter", checked: false },
      { id: "usg-pancreas", label: "Pancreas", checked: false },
      { id: "usg-spleen", label: "Spleen Size", checked: false },
      { id: "usg-kidneys", label: "Kidneys & Pelvicalyceal system", checked: false },
      { id: "usg-bladder", label: "Urinary Bladder & Pre/Post Void", checked: false },
    ];
  }

  // Fallback default checklist
  return [
    { id: "gen-findings", label: "Primary Findings", checked: false },
    { id: "gen-measurements", label: "Measurements", checked: false },
    { id: "gen-impression", label: "Impression Correlation", checked: false },
  ];
}

// ─── 4. Prior Study Comparison Intelligence ───
export interface PriorComparisonResult {
  metricName: string;
  previousValue: number | string;
  currentValue: number | string;
  diffText: string;
  changePercent?: number;
  status: "growth" | "regression" | "stable" | "resolved" | "unknown";
}

export function comparePriorMetrics(
  previousData: Record<string, string | number>,
  currentData: Record<string, string | number>
): PriorComparisonResult[] {
  const results: PriorComparisonResult[] = [];

  const metricsToCompare = [
    { key: "measurement", name: "Lesion Dimension" },
    { key: "volume", name: "Lesion Volume" },
    { key: "lesionCount", name: "Lesion Count" },
    { key: "midlineShift", name: "Midline Shift" },
    { key: "ventricleSize", name: "Ventricular Width" },
    { key: "discSize", name: "Disc Bulge Size" },
    { key: "slipPercent", name: "Spondylolisthesis Slip %" },
    { key: "efw", name: "Estimated Fetal Weight" },
    { key: "afi", name: "Amniotic Fluid Index" },
  ];

  for (const m of metricsToCompare) {
    const prev = previousData[m.key];
    const curr = currentData[m.key];

    if (prev !== undefined && curr !== undefined) {
      if (typeof prev === "number" && typeof curr === "number") {
        const diff = curr - prev;
        const changePercent = prev !== 0 ? Math.round((diff / prev) * 100) : 0;
        let status: "growth" | "regression" | "stable" | "resolved" = "stable";

        if (changePercent > 5) {
          status = "growth";
        } else if (changePercent < -5) {
          status = curr === 0 ? "resolved" : "regression";
        }

        const diffText = diff > 0 ? `+${diff.toFixed(1)} (${changePercent}%)` : `${diff.toFixed(1)} (${changePercent}%)`;

        results.push({
          metricName: m.name,
          previousValue: prev,
          currentValue: curr,
          diffText,
          changePercent,
          status,
        });
      } else {
        // String comparisons (e.g. BI-RADS category values)
        results.push({
          metricName: m.name,
          previousValue: prev,
          currentValue: curr,
          diffText: `${prev} -> ${curr}`,
          status: prev === curr ? "stable" : "unknown",
        });
      }
    }
  }

  // Handle BI-RADS specifically
  if (previousData.birads !== undefined && currentData.birads !== undefined) {
    const prevB = String(previousData.birads);
    const currB = String(currentData.birads);
    results.push({
      metricName: "BI-RADS Category",
      previousValue: prevB,
      currentValue: currB,
      diffText: `${prevB} to ${currB}`,
      status: prevB === currB ? "stable" : "unknown",
    });
  }

  return results;
}
