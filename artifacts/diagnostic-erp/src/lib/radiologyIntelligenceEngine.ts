// ─── Radiologist Intelligence Engine ───
// Phase 2D: Production-grade intelligence layer for the Unified Reporting Workspace.
// All functions are pure, client-side, and operate on text only.
// No external API calls. No database changes.

// ─── 1. Structured Findings + Impression Pairs ───

export interface StructuredFinding {
  id: string;
  label: string;
  findings: string;
  impression: string;
  category: string; // e.g. "USG", "MRI Brain", "MRI Spine"
  priority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
  // Keywords that trigger this finding when seen in text
  triggerKeywords: string[];
  // Impression template that can be derived from this finding
  impressionTemplate: string;
}

// Expanded structured findings for all 13 requested items
export const STRUCTURED_FINDINGS: StructuredFinding[] = [
  // USG
  {
    id: "usg-fl1",
    label: "Fatty Liver Grade I",
    category: "USG",
    priority: "MINOR",
    findings: "LIVER: Normal size. Diffuse increased echotexture with slightly impaired intrahepatic vessel definition — Grade I fatty liver.",
    impression: "Grade I fatty liver.",
    triggerKeywords: ["fatty liver", "grade i", "grade 1", "increased echotexture", "diffuse echotexture"],
    impressionTemplate: "Grade I fatty liver.",
  },
  {
    id: "usg-fl2",
    label: "Fatty Liver Grade II",
    category: "USG",
    priority: "MINOR",
    findings: "LIVER: Normal size. Marked diffuse increased echotexture with moderately impaired intrahepatic vessel definition and mild posterior beam attenuation — Grade II fatty liver.",
    impression: "Grade II fatty liver.",
    triggerKeywords: ["fatty liver", "grade ii", "grade 2", "markedly increased echotexture", "posterior attenuation"],
    impressionTemplate: "Grade II fatty liver.",
  },
  {
    id: "usg-fl3",
    label: "Fatty Liver Grade III",
    category: "USG",
    priority: "MINOR",
    findings: "LIVER: Normal size. Severe diffuse increased echotexture with markedly impaired intrahepatic vessel definition and significant posterior beam attenuation — Grade III fatty liver.",
    impression: "Grade III fatty liver.",
    triggerKeywords: ["fatty liver", "grade iii", "grade 3", "severe diffuse", "significant attenuation"],
    impressionTemplate: "Grade III fatty liver.",
  },
  {
    id: "usg-gb",
    label: "GB Calculus",
    category: "USG",
    priority: "MINOR",
    findings: "GALLBLADDER: Distended. Multiple echogenic foci with posterior acoustic shadowing within the lumen. Wall thickness normal. CBD not dilated.",
    impression: "Gallbladder calculi.",
    triggerKeywords: ["gallbladder", "calculi", "gallstone", "echogenic foci", "shadowing", "cbd not dilated"],
    impressionTemplate: "Gallbladder calculi.",
  },
  {
    id: "usg-renal",
    label: "Renal Calculus",
    category: "USG",
    priority: "MINOR",
    findings: "KIDNEYS: Echogenic focus with posterior acoustic shadowing in the ___ kidney, measuring ___ mm. No hydronephrosis. Other kidney normal.",
    impression: "Renal calculus in the ___ kidney.",
    triggerKeywords: ["renal", "kidney", "calculus", "echogenic focus", "hydronephrosis"],
    impressionTemplate: "Renal calculus in the ___ kidney.",
  },
  {
    id: "usg-prostate",
    label: "Prostatomegaly",
    category: "USG",
    priority: "MINOR",
    findings: "PROSTATE: Enlarged, measuring approximately ___ cc. Capsular outline regular. Internal echotexture homogeneous. No focal lesion. Residual urine: ___ ml.",
    impression: "Prostatomegaly.",
    triggerKeywords: ["prostate", "enlarged", "prostatomegaly", "residual urine"],
    impressionTemplate: "Prostatomegaly.",
  },
  {
    id: "usg-appendix",
    label: "Acute Appendicitis",
    category: "USG",
    priority: "SIGNIFICANT",
    findings: "APPENDIX: Non-compressible, thickened (___ mm), blind-ending tubular structure in the right iliac fossa. Periappendiceal fat stranding and free fluid noted.",
    impression: "Features suggestive of acute appendicitis.",
    triggerKeywords: ["appendix", "appendicitis", "non-compressible", "periappendiceal", "blind-ending"],
    impressionTemplate: "Features suggestive of acute appendicitis.",
  },
  {
    id: "usg-hydro",
    label: "Hydronephrosis",
    category: "USG",
    priority: "SIGNIFICANT",
    findings: "KIDNEYS: Pelvicalyceal system dilated in the ___ kidney. Cortical thickness preserved. No perinephric fluid. Ureteric jet normal.",
    impression: "Hydronephrosis, ___ kidney.",
    triggerKeywords: ["hydronephrosis", "pelvicalyceal", "dilated", "cortical thickness"],
    impressionTemplate: "Hydronephrosis, ___ kidney.",
  },
  // MRI Brain
  {
    id: "mri-faz1",
    label: "Fazekas Grade I",
    category: "MRI Brain",
    priority: "MINOR",
    findings: "PERIVENTRICULAR WHITE MATTER: Few punctate hyperintense foci on T2/FLAIR (< 5 mm) — Fazekas Grade I.",
    impression: "Fazekas Grade I white matter changes.",
    triggerKeywords: ["fazekas", "grade i", "grade 1", "punctate", "periventricular"],
    impressionTemplate: "Fazekas Grade I white matter changes.",
  },
  {
    id: "mri-faz2",
    label: "Fazekas Grade II",
    category: "MRI Brain",
    priority: "MINOR",
    findings: "PERIVENTRICULAR WHITE MATTER: Multiple confluent hyperintense foci on T2/FLAIR (5–10 mm) with beginning confluence — Fazekas Grade II.",
    impression: "Fazekas Grade II white matter changes.",
    triggerKeywords: ["fazekas", "grade ii", "grade 2", "confluent", "beginning confluence"],
    impressionTemplate: "Fazekas Grade II white matter changes.",
  },
  {
    id: "mri-faz3",
    label: "Fazekas Grade III",
    category: "MRI Brain",
    priority: "SIGNIFICANT",
    findings: "PERIVENTRICULAR WHITE MATTER: Large confluent areas of hyperintensity on T2/FLAIR (> 10 mm) with bridging — Fazekas Grade III.",
    impression: "Fazekas Grade III white matter changes.",
    triggerKeywords: ["fazekas", "grade iii", "grade 3", "large confluent", "bridging"],
    impressionTemplate: "Fazekas Grade III white matter changes.",
  },
  {
    id: "mri-infarct",
    label: "Acute Infarct",
    category: "MRI Brain",
    priority: "CRITICAL",
    findings: "HYPERINTENSE area on T2/FLAIR with restricted diffusion on DWI and low ADC in the ___ territory, suggestive of acute infarct. No hemorrhagic transformation.",
    impression: "Acute infarct in the ___ territory.",
    triggerKeywords: ["infarct", "acute", "restricted diffusion", "dwi", "low adc", "hyperintense"],
    impressionTemplate: "Acute infarct in the ___ territory.",
  },
  {
    id: "mri-hydro",
    label: "Hydrocephalus",
    category: "MRI Brain",
    priority: "SIGNIFICANT",
    findings: "VENTRICULAR SYSTEM: Dilated lateral and third ventricles. Temporal horns prominent. Transependymal CSF seepage noted on FLAIR. Fourth ventricle normal.",
    impression: "Hydrocephalus.",
    triggerKeywords: ["hydrocephalus", "dilated ventricles", "transependymal", "temporal horns"],
    impressionTemplate: "Hydrocephalus.",
  },
  {
    id: "mri-senile",
    label: "Senile Changes",
    category: "MRI Brain",
    priority: "MINOR",
    findings: "BRAIN PARENCHYMA: Mild diffuse cerebral atrophy with prominent sulci and ventricles. Multiple punctate periventricular hyperintensities on FLAIR. No mass lesion.",
    impression: "Senile cerebral atrophy with periventricular ischemic changes.",
    triggerKeywords: ["senile", "atrophy", "prominent sulci", "periventricular ischemic"],
    impressionTemplate: "Senile cerebral atrophy with periventricular ischemic changes.",
  },
  {
    id: "mri-gliosis",
    label: "Gliosis",
    category: "MRI Brain",
    priority: "MINOR",
    findings: "BRAIN PARENCHYMA: T2/FLAIR hyperintense foci in the periventricular/deep white matter — likely chronic ischemic gliosis. No restricted diffusion.",
    impression: "Chronic ischemic gliosis.",
    triggerKeywords: ["gliosis", "chronic ischemic", "flair hyperintense", "deep white matter"],
    impressionTemplate: "Chronic ischemic gliosis.",
  },
  {
    id: "mri-empty",
    label: "Empty Sella",
    category: "MRI Brain",
    priority: "MINOR",
    findings: "SELLA TURCICA: Enlarged, predominantly filled with CSF signal. Pituitary gland flattened along the floor. No suprasellar mass.",
    impression: "Empty sella turcica.",
    triggerKeywords: ["empty sella", "csf signal", "pituitary flattened", "suprasellar"],
    impressionTemplate: "Empty sella turcica.",
  },
  {
    id: "mri-demyelination",
    label: "Demyelination",
    category: "MRI Brain",
    priority: "SIGNIFICANT",
    findings: "BRAIN: Multiple hyperintense lesions in the periventricular white matter, juxtacortical, and infratentorial regions. Some lesions show enhancement. Dawson fingers noted.",
    impression: "Demyelinating disease — likely multiple sclerosis.",
    triggerKeywords: ["demyelination", "dawson fingers", "juxtacortical", "infratentorial", "multiple sclerosis"],
    impressionTemplate: "Demyelinating disease — likely multiple sclerosis.",
  },
  // MRI Cervical
  {
    id: "mri-cs-desiccation",
    label: "Disc Desiccation",
    category: "MRI Cervical",
    priority: "MINOR",
    findings: "CERVICAL SPINE: ___ intervertebral disc shows loss of T2 hyperintense signal with mild height reduction — disc desiccation.",
    impression: "Disc desiccation at ___ level.",
    triggerKeywords: ["disc desiccation", "loss of t2", "height reduction", "cervical"],
    impressionTemplate: "Disc desiccation at ___ level.",
  },
  {
    id: "mri-cs-osteophyte",
    label: "Disc Osteophyte Complex",
    category: "MRI Cervical",
    priority: "SIGNIFICANT",
    findings: "CERVICAL SPINE: ___ level — disc osteophyte complex with endplate osteophytes and spondylotic bar formation, indenting the thecal sac.",
    impression: "Disc osteophyte complex at ___ level.",
    triggerKeywords: ["osteophyte", "spondylotic", "endplate", "cervical", "bar formation"],
    impressionTemplate: "Disc osteophyte complex at ___ level.",
  },
  {
    id: "mri-cs-canal",
    label: "Canal Narrowing",
    category: "MRI Cervical",
    priority: "SIGNIFICANT",
    findings: "SPINAL CANAL: Narrowed at ___ level. AP diameter reduced. No cord signal change.",
    impression: "Canal narrowing at ___ level.",
    triggerKeywords: ["canal narrowing", "ap diameter", "spinal canal", "reduced", "cervical"],
    impressionTemplate: "Canal narrowing at ___ level.",
  },
  {
    id: "mri-cs-cord",
    label: "Cord Compression",
    category: "MRI Cervical",
    priority: "CRITICAL",
    findings: "SPINAL CORD: Compression at ___ level. T2 hyperintense signal within the cord suggestive of myelomalacia.",
    impression: "Cord compression with myelomalacia at ___ level.",
    triggerKeywords: ["cord compression", "myelomalacia", "t2 hyperintense", "cord signal", "cervical"],
    impressionTemplate: "Cord compression with myelomalacia at ___ level.",
  },
  {
    id: "mri-cs-myelopathy",
    label: "Myelopathy",
    category: "MRI Cervical",
    priority: "CRITICAL",
    findings: "SPINAL CORD: T2 hyperintense signal at ___ level. Cord slightly expanded. Surrounding CSF space effaced. Clinical correlation for myelopathy.",
    impression: "Cervical myelopathy at ___ level.",
    triggerKeywords: ["myelopathy", "cord expanded", "csf space effaced", "cervical"],
    impressionTemplate: "Cervical myelopathy at ___ level.",
  },
  // MRI LS Spine
  {
    id: "mri-ls-bulge",
    label: "Disc Bulge",
    category: "MRI LS Spine",
    priority: "MINOR",
    findings: "LUMBAR SPINE: ___ level — broad-based disc bulge, indenting the anterior thecal sac. No focal herniation.",
    impression: "Disc bulge at ___ level.",
    triggerKeywords: ["disc bulge", "broad-based", "thecal sac", "indenting", "lumbar"],
    impressionTemplate: "Disc bulge at ___ level.",
  },
  {
    id: "mri-ls-protrusion",
    label: "Disc Protrusion",
    category: "MRI LS Spine",
    priority: "SIGNIFICANT",
    findings: "LUMBAR SPINE: ___ level — disc protrusion with focal contour abnormality, extending ___ mm beyond the vertebral margin, indenting the thecal sac.",
    impression: "Disc protrusion at ___ level.",
    triggerKeywords: ["disc protrusion", "focal contour", "vertebral margin", "lumbar"],
    impressionTemplate: "Disc protrusion at ___ level.",
  },
  {
    id: "mri-ls-extrusion",
    label: "Disc Extrusion",
    category: "MRI LS Spine",
    priority: "CRITICAL",
    findings: "LUMBAR SPINE: ___ level — disc extrusion with migrated fragment. Thecal sac and nerve root compression.",
    impression: "Disc extrusion with nerve root compression at ___ level.",
    triggerKeywords: ["disc extrusion", "migrated fragment", "nerve root", "compression", "lumbar"],
    impressionTemplate: "Disc extrusion with nerve root compression at ___ level.",
  },
  {
    id: "mri-ls-facet",
    label: "Facet Arthropathy",
    category: "MRI LS Spine",
    priority: "MINOR",
    findings: "LUMBAR SPINE: ___ level — facet joint arthropathy with subchondral sclerosis, irregularity, and hypertrophy. Joint effusion minimal.",
    impression: "Facet arthropathy at ___ level.",
    triggerKeywords: ["facet arthropathy", "subchondral sclerosis", "hypertrophy", "lumbar"],
    impressionTemplate: "Facet arthropathy at ___ level.",
  },
  {
    id: "mri-ls-lf",
    label: "Ligamentum Flavum Hypertrophy",
    category: "MRI LS Spine",
    priority: "SIGNIFICANT",
    findings: "LUMBAR SPINE: LIGAMENTUM FLAVUM: Thickened at ___ level, contributing to canal narrowing. Measured ___ mm.",
    impression: "Ligamentum flavum hypertrophy at ___ level.",
    triggerKeywords: ["ligamentum flavum", "thickened", "canal narrowing", "lumbar"],
    impressionTemplate: "Ligamentum flavum hypertrophy at ___ level.",
  },
  {
    id: "mri-ls-stenosis",
    label: "Canal Stenosis",
    category: "MRI LS Spine",
    priority: "CRITICAL",
    findings: "SPINAL CANAL: Severe narrowing at ___ level. AP diameter reduced to ___ mm. Thecal sac compressed. No cord signal change.",
    impression: "Canal stenosis at ___ level.",
    triggerKeywords: ["canal stenosis", "severe narrowing", "ap diameter", "thecal sac compressed", "lumbar"],
    impressionTemplate: "Canal stenosis at ___ level.",
  },
];

// ─── 2. Impression Auto-Sync Engine ───

export function suggestImpression(findings: string): string | null {
  const lower = findings.toLowerCase();
  const suggestions: string[] = [];

  for (const sf of STRUCTURED_FINDINGS) {
    const matched = sf.triggerKeywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (matched) {
      suggestions.push(sf.impression);
    }
  }

  if (suggestions.length === 0) return null;
  if (suggestions.length === 1) return suggestions[0];
  // Multiple findings: combine intelligently
  return combineImpressions(suggestions);
}

/** Combine multiple impressions into a single coherent sentence. */
function combineImpressions(impressions: string[]): string {
  // Deduplicate
  const unique = [...new Set(impressions)];
  if (unique.length === 1) return unique[0];

  // Simple combination: join with semicolons
  return unique.join("; ");
}

// ─── 3. Finding Conflict Detection ───

export interface Conflict {
  severity: "WARNING" | "ERROR";
  message: string;
  conflictingIds: string[];
  resolution?: string;
}

const CONFLICT_PAIRS: { keywordsA: string[]; keywordsB: string[]; message: string; resolution: string }[] = [
  {
    keywordsA: ["normal brain", "normal signal", "no focal lesion", "no abnormality"],
    keywordsB: ["infarct", "hemorrhage", "mass", "tumor", "lesion", "hematoma", "abscess"],
    message: "Normal brain findings combined with abnormal pathology",
    resolution: "Remove the normal finding or keep the abnormal finding",
  },
  {
    keywordsA: ["normal cervical", "normal alignment", "all discs normal"],
    keywordsB: ["cord compression", "myelomalacia", "myelopathy", "disc herniation", "severe canal stenosis"],
    message: "Normal cervical spine combined with cord compression",
    resolution: "Remove the normal finding or keep the abnormal finding",
  },
  {
    keywordsA: ["normal abdomen", "normal liver", "normal kidney", "normal spleen"],
    keywordsB: ["fatty liver", "calculi", "calculus", "hydronephrosis", "appendicitis", "pancreatitis"],
    message: "Normal abdomen findings combined with abnormal pathology",
    resolution: "Remove the normal finding or keep the abnormal finding",
  },
  {
    keywordsA: ["normal ls spine", "normal lumbar", "all discs normal"],
    keywordsB: ["canal stenosis", "cord compression", "disc extrusion", "spondylolisthesis"],
    message: "Normal lumbar spine combined with severe pathology",
    resolution: "Remove the normal finding or keep the abnormal finding",
  },
  {
    keywordsA: ["clear bilaterally", "normal chest", "normal cxr"],
    keywordsB: ["pneumonia", "effusion", "pneumothorax", "cardiomegaly", "tuberculosis", "mass"],
    message: "Normal chest findings combined with abnormal pathology",
    resolution: "Remove the normal finding or keep the abnormal finding",
  },
];

export function detectConflicts(findings: string): Conflict[] {
  const lower = findings.toLowerCase();
  const conflicts: Conflict[] = [];

  for (const pair of CONFLICT_PAIRS) {
    const hasA = pair.keywordsA.some((k) => lower.includes(k));
    const hasB = pair.keywordsB.some((k) => lower.includes(k));
    if (hasA && hasB) {
      conflicts.push({
        severity: "WARNING",
        message: pair.message,
        conflictingIds: [],
        resolution: pair.resolution,
      });
    }
  }

  return conflicts;
}

// ─── 4. Report Quality Checker ───

export interface QualityCheck {
  pass: boolean;
  score: number; // 0-100
  checks: { id: string; label: string; pass: boolean; message?: string }[];
  warnings: string[];
}

export function runQualityCheck(findings: string, impression: string): QualityCheck {
  const checks: { id: string; label: string; pass: boolean; message?: string }[] = [];
  const warnings: string[] = [];

  // 1. Missing impression
  const hasImpression = impression.trim().length > 0;
  checks.push({
    id: "impression",
    label: "Impression present",
    pass: hasImpression,
    message: hasImpression ? undefined : "Impression section is empty",
  });
  if (!hasImpression) warnings.push("Impression missing — add a conclusion");

  // 2. Empty findings
  const hasFindings = findings.trim().length > 0;
  checks.push({
    id: "findings",
    label: "Findings present",
    pass: hasFindings,
    message: hasFindings ? undefined : "Findings section is empty",
  });
  if (!hasFindings) warnings.push("Findings section empty — add observations");

  // 3. Unfinished placeholders
  const placeholderMatches = findings.match(/___/g);
  const hasPlaceholders = (placeholderMatches?.length ?? 0) > 0;
  checks.push({
    id: "placeholders",
    label: "No unfinished placeholders",
    pass: !hasPlaceholders,
    message: hasPlaceholders ? `${placeholderMatches!.length} placeholder(s) remaining (___)` : undefined,
  });
  if (hasPlaceholders) warnings.push(`${placeholderMatches!.length} placeholder(s) need to be filled in`);

  // 4. Duplicate statements
  const lines = findings.split(/\n/).map((l) => l.trim().toLowerCase()).filter((l) => l.length > 10);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) duplicates.push(line);
    seen.add(line);
  }
  const hasDuplicates = duplicates.length > 0;
  checks.push({
    id: "duplicates",
    label: "No duplicate statements",
    pass: !hasDuplicates,
    message: hasDuplicates ? `${duplicates.length} duplicate statement(s) detected` : undefined,
  });
  if (hasDuplicates) warnings.push(`${duplicates.length} duplicate statement(s) detected`);

  // 5. Conflicts
  const conflicts = detectConflicts(findings);
  const hasConflicts = conflicts.length > 0;
  checks.push({
    id: "conflicts",
    label: "No conflicting findings",
    pass: !hasConflicts,
    message: hasConflicts ? `${conflicts.length} conflict(s) detected` : undefined,
  });
  if (hasConflicts) warnings.push(`Conflicting findings detected: ${conflicts.map((c) => c.message).join("; ")}`);

  // 6. Blank conclusion in impression
  const impressionLines = impression.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const hasBlankConclusion = impressionLines.length === 0 || impressionLines.every((l) => l.length < 5);
  checks.push({
    id: "conclusion",
    label: "Impression has conclusion",
    pass: !hasBlankConclusion,
    message: hasBlankConclusion ? "Impression is too short or empty" : undefined,
  });
  if (hasBlankConclusion) warnings.push("Impression is too short — add a conclusion");

  // 7. Missing measurements
  const hasMeasurement = /\d+\s*(mm|cm|cc|ml|g)/i.test(findings);
  const mightNeedMeasurement = /lesion|mass|tumor|calcification|stone|hematoma|fluid collection/i.test(findings);
  checks.push({
    id: "measurements",
    label: "Measurements present if needed",
    pass: !mightNeedMeasurement || hasMeasurement,
    message: mightNeedMeasurement && !hasMeasurement ? "Measurements may be needed for described lesions" : undefined,
  });
  if (mightNeedMeasurement && !hasMeasurement) warnings.push("Consider adding measurements for described lesions");

  // Score calculation
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const score = Math.round((passed / total) * 100);

  return { pass: score >= 80, score, checks, warnings };
}

// ─── 5. Abnormality Priority Engine ───

export type Priority = "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";

export const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  NORMAL: { label: "Normal", color: "text-green-700", bg: "bg-green-100" },
  MINOR: { label: "Minor", color: "text-blue-700", bg: "bg-blue-100" },
  SIGNIFICANT: { label: "Significant", color: "text-amber-700", bg: "bg-amber-100" },
  CRITICAL: { label: "Critical", color: "text-red-700", bg: "bg-red-100" },
};

export function classifyPriority(findings: string, impression: string): Priority {
  const combined = (findings + " " + impression).toLowerCase();

  // CRITICAL: life-threatening, emergency
  const criticalKeywords = [
    "hemorrhage", "hematoma", "infarct", "stroke", "cord compression", "myelopathy",
    "myelomalacia", "abscess", "extrusion", "tension pneumothorax", "rupture",
    "apoplexy", "mass effect", "midline shift", "herniation",
  ];
  if (criticalKeywords.some((k) => combined.includes(k))) return "CRITICAL";

  // SIGNIFICANT: needs intervention, surgery, or urgent follow-up
  const significantKeywords = [
    "stenosis", "severe", "protrusion", "herniation", "hydrocephalus", "pneumonia",
    "effusion", "pneumothorax", "appendicitis", "pancreatitis", "hydronephrosis",
    "metastases", "demyelination", "tuberculosis", "spondylolisthesis", "modic",
  ];
  if (significantKeywords.some((k) => combined.includes(k))) return "SIGNIFICANT";

  // MINOR: chronic, stable, incidental
  const minorKeywords = [
    "fatty liver", "disc desiccation", "disc bulge", "facet arthropathy", "facet hypertrophy",
    "degenerative", "fazekas", "senile", "gliosis", "atrophy", "empty sella",
    "schmorl", "loss of lordosis", "calcification", "cyst", "cardiomegaly",
  ];
  if (minorKeywords.some((k) => combined.includes(k))) return "MINOR";

  // NORMAL
  const normalKeywords = [
    "normal", "no abnormality", "no focal lesion", "no significant", "no mass",
    "clear bilaterally", "unremarkable", "intact",
  ];
  if (normalKeywords.some((k) => combined.includes(k))) return "NORMAL";

  return "MINOR";
}

// ─── 6. Smart Impression Suggestions ───

export function suggestSmartImpression(findings: string): string | null {
  const lower = findings.toLowerCase();
  const activeFindings = STRUCTURED_FINDINGS.filter((sf) =>
    sf.triggerKeywords.some((kw) => lower.includes(kw.toLowerCase())),
  );

  if (activeFindings.length === 0) return null;
  if (activeFindings.length === 1) return activeFindings[0].impression;

  // Multi-finding logic: try to find a coherent combined impression
  const categories = [...new Set(activeFindings.map((f) => f.category))];
  const priorities = activeFindings.map((f) => f.priority);
  const highestPriority = priorities.includes("CRITICAL") ? "CRITICAL" : priorities.includes("SIGNIFICANT") ? "SIGNIFICANT" : "MINOR";

  // If multiple findings in the same category, combine
  if (categories.length === 1 && categories[0] === "MRI LS Spine") {
    const hasBulge = lower.includes("bulge");
    const hasFacet = lower.includes("facet");
    const hasLF = lower.includes("ligamentum flavum");
    const hasStenosis = lower.includes("stenosis");
    const hasProtrusion = lower.includes("protrusion");
    const hasExtrusion = lower.includes("extrusion");
    const hasDesiccation = lower.includes("desiccation");

    if (hasExtrusion) return "Lumbar disc extrusion with nerve root compression.";
    if (hasStenosis) return "Lumbar canal stenosis with degenerative spondylotic changes.";
    if (hasProtrusion && hasFacet) return "Lumbar disc protrusion with facet arthropathy.";
    if (hasBulge && hasFacet && hasLF) return "Degenerative lumbar spondylotic changes with associated canal narrowing.";
    if (hasBulge && hasDesiccation) return "Degenerative disc disease with multilevel disc desiccation and bulge.";
  }

  if (categories.length === 1 && categories[0] === "MRI Cervical") {
    const hasCord = lower.includes("cord compression") || lower.includes("myelomalacia") || lower.includes("myelopathy");
    const hasOsteophyte = lower.includes("osteophyte");
    const hasCanal = lower.includes("canal narrowing") || lower.includes("stenosis");
    const hasDesiccation = lower.includes("desiccation");

    if (hasCord) return "Cervical cord compression with myelomalacia — urgent neurosurgical evaluation advised.";
    if (hasOsteophyte && hasCanal) return "Cervical spondylotic myelopathy with canal narrowing.";
    if (hasOsteophyte && hasDesiccation) return "Cervical degenerative disc disease with osteophyte formation.";
  }

  if (categories.length === 1 && categories[0] === "MRI Brain") {
    const hasInfarct = lower.includes("infarct") || lower.includes("stroke");
    const hasHemorrhage = lower.includes("hemorrhage") || lower.includes("hematoma");
    const hasFazekas = lower.includes("fazekas");
    const hasGliosis = lower.includes("gliosis") || lower.includes("chronic ischemic");
    const hasSenile = lower.includes("senile") || lower.includes("atrophy");
    const hasDemyelination = lower.includes("demyelination") || lower.includes("multiple sclerosis");
    const hasEmpty = lower.includes("empty sella");

    if (hasInfarct) return "Acute cerebral infarct.";
    if (hasHemorrhage) return "Intracranial hemorrhage.";
    if (hasDemyelination) return "Demyelinating disease — likely multiple sclerosis.";
    if (hasFazekas && hasGliosis) return "Chronic small vessel ischemic changes with periventricular white matter disease.";
    if (hasFazekas && hasSenile) return "Senile cerebral atrophy with periventricular ischemic changes.";
    if (hasEmpty && hasSenile) return "Senile cerebral atrophy with empty sella.";
    if (hasFazekas) return "Fazekas white matter changes.";
    if (hasSenile) return "Senile cerebral atrophy.";
  }

  if (categories.length === 1 && categories[0] === "USG") {
    const hasFL = lower.includes("fatty liver");
    const hasGB = lower.includes("gallbladder") || lower.includes("calculi");
    const hasRenal = lower.includes("renal") || lower.includes("kidney") && lower.includes("calculus");
    const hasProstate = lower.includes("prostate");
    const hasAppendix = lower.includes("appendicitis");
    const hasHydro = lower.includes("hydronephrosis");

    if (hasAppendix) return "Features suggestive of acute appendicitis.";
    if (hasHydro && hasRenal) return "Renal calculus with hydronephrosis.";
    if (hasRenal) return "Renal calculus.";
    if (hasFL && hasGB) return "Fatty liver with gallbladder calculi.";
    if (hasFL && hasProstate) return "Fatty liver with prostatomegaly.";
    if (hasFL) return "Fatty liver.";
    if (hasGB) return "Gallbladder calculi.";
    if (hasProstate) return "Prostatomegaly.";
    if (hasHydro) return "Hydronephrosis.";
  }

  // Fallback: combine all unique impressions
  const uniqueImpressions = [...new Set(activeFindings.map((f) => f.impression))];
  return uniqueImpressions.join("; ");
}

// ─── 7. Previous Report Comparison ───

export interface ComparisonResult {
  summary: string;
  changes: { type: "NEW" | "INCREASED" | "DECREASED" | "UNCHANGED" | "RESOLVED"; description: string }[];
  comparisonSentence: string;
}

export function compareReports(
  currentFindings: string,
  currentImpression: string,
  previousFindings: string,
  previousImpression: string,
  previousDate?: string | null,
): ComparisonResult {
  const changes: { type: "NEW" | "INCREASED" | "DECREASED" | "UNCHANGED" | "RESOLVED"; description: string }[] = [];

  const currentActive = STRUCTURED_FINDINGS.filter((sf) =>
    sf.triggerKeywords.some((kw) => currentFindings.toLowerCase().includes(kw.toLowerCase())),
  );
  const previousActive = STRUCTURED_FINDINGS.filter((sf) =>
    sf.triggerKeywords.some((kw) => previousFindings.toLowerCase().includes(kw.toLowerCase())),
  );

  const currentIds = new Set(currentActive.map((f) => f.id));
  const previousIds = new Set(previousActive.map((f) => f.id));

  // New findings
  for (const f of currentActive) {
    if (!previousIds.has(f.id)) {
      changes.push({ type: "NEW", description: f.label });
    }
  }

  // Resolved findings
  for (const f of previousActive) {
    if (!currentIds.has(f.id)) {
      changes.push({ type: "RESOLVED", description: f.label });
    }
  }

  // Unchanged
  for (const f of currentActive) {
    if (previousIds.has(f.id)) {
      changes.push({ type: "UNCHANGED", description: f.label });
    }
  }

  // Size comparison heuristic
  const currentSize = extractSize(currentFindings);
  const previousSize = extractSize(previousFindings);
  if (currentSize && previousSize) {
    if (currentSize > previousSize * 1.2) {
      changes.push({ type: "INCREASED", description: `Lesion size increased from ${previousSize}mm to ${currentSize}mm` });
    } else if (currentSize < previousSize * 0.8) {
      changes.push({ type: "DECREASED", description: `Lesion size decreased from ${previousSize}mm to ${currentSize}mm` });
    }
  }

  const dateStr = previousDate ? ` dated ${previousDate}` : "";

  let summary: string;
  if (changes.length === 0) {
    summary = "No significant interval change";
  } else if (changes.every((c) => c.type === "UNCHANGED")) {
    summary = "No significant interval change";
  } else if (changes.some((c) => c.type === "NEW")) {
    summary = "New findings detected";
  } else if (changes.some((c) => c.type === "RESOLVED")) {
    summary = "Some findings have resolved";
  } else {
    summary = "Interval changes noted";
  }

  const comparisonSentence =
    summary === "No significant interval change"
      ? `No significant interval change compared to prior study${dateStr}.`
      : `${summary} compared to prior study${dateStr}.`;

  return { summary, changes, comparisonSentence };
}

function extractSize(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*mm/);
  return match ? parseFloat(match[1]) : null;
}

// ─── 8. Measurement Library ───

export interface MeasurementTemplate {
  id: string;
  label: string;
  category: string;
  defaultValue?: string;
  unit: string;
  templateText: string; // e.g. "Cervical canal AP diameter: ___ mm"
}

export const MEASUREMENT_TEMPLATES: MeasurementTemplate[] = [
  // MRI Spine
  { id: "mri-cs-canal-ap", label: "Cervical Canal AP", category: "MRI Spine", unit: "mm", templateText: "Cervical spinal canal AP diameter: ___ mm (normal > 10 mm)" },
  { id: "mri-ls-canal-ap", label: "Lumbar Canal AP", category: "MRI Spine", unit: "mm", templateText: "Lumbar spinal canal AP diameter: ___ mm (normal > 12 mm)" },
  { id: "mri-lesion-size", label: "Lesion Size", category: "MRI Brain", unit: "mm", templateText: "Lesion measures ___ x ___ x ___ mm" },
  // USG
  { id: "usg-liver", label: "Liver Size", category: "USG Abdomen", unit: "cm", templateText: "Liver size: ___ cm (normal 15–17 cm)" },
  { id: "usg-cbd", label: "CBD Diameter", category: "USG Abdomen", unit: "mm", templateText: "Common bile duct diameter: ___ mm (normal < 6 mm)" },
  { id: "usg-prostate", label: "Prostate Volume", category: "USG Abdomen", unit: "cc", templateText: "Prostate volume: ___ cc (normal < 25 cc)" },
  { id: "usg-spleen", label: "Spleen Size", category: "USG Abdomen", unit: "cm", templateText: "Spleen size: ___ cm (normal < 12 cm)" },
  // Obstetrics
  { id: "obs-bpd", label: "BPD", category: "Obstetrics", unit: "mm", templateText: "BPD: ___ mm" },
  { id: "obs-hc", label: "HC", category: "Obstetrics", unit: "mm", templateText: "HC: ___ mm" },
  { id: "obs-ac", label: "AC", category: "Obstetrics", unit: "mm", templateText: "AC: ___ mm" },
  { id: "obs-fl", label: "FL", category: "Obstetrics", unit: "mm", templateText: "FL: ___ mm" },
  { id: "obs-crl", label: "CRL", category: "Obstetrics", unit: "mm", templateText: "CRL: ___ mm" },
  { id: "obs-afi", label: "AFI", category: "Obstetrics", unit: "cm", templateText: "AFI: ___ cm (normal 8–18 cm)" },
];

// ─── 9. Knowledge Base ───

export interface KnowledgeEntry {
  id: string;
  title: string;
  tags: string[];
  findings: string;
  impression: string;
  teachingPoint?: string;
  modality: string;
  bodyPart: string;
}

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  {
    id: "kb-brain-mets",
    title: "Brain Metastases — Ring Enhancement",
    tags: ["Brain", "Oncology", "MRI"],
    modality: "MR",
    bodyPart: "BRAIN",
    findings: "Multiple ring-enhancing lesions with surrounding vasogenic edema. T1 hypointense, T2 hyperintense. Variable enhancement pattern.",
    impression: "Multiple intracranial metastases. Consider primary workup.",
    teachingPoint: "Ring enhancement suggests necrotic center. Vasogenic edema is disproportionate to lesion size in metastases.",
  },
  {
    id: "kb-brain-ms",
    title: "Multiple Sclerosis — Dawson Fingers",
    tags: ["Brain", "Demyelination", "MRI"],
    modality: "MR",
    bodyPart: "BRAIN",
    findings: "Ovoid periventricular lesions perpendicular to corpus callosum (Dawson fingers). Juxtacortical, infratentorial, and spinal cord lesions.",
    impression: "Demyelinating disease consistent with multiple sclerosis. McDonald criteria positive.",
    teachingPoint: "Dawson fingers are pathognomonic for MS. Dissemination in space and time required for diagnosis.",
  },
  {
    id: "kb-spine-ccs",
    title: "Cervical Canal Stenosis",
    tags: ["Spine", "Cervical", "Degenerative", "MRI"],
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    findings: "Cervical canal AP diameter < 10 mm. Cord compression with T2 hyperintense signal. Myelomalacia may be present.",
    impression: "Severe cervical canal stenosis with cord compression. Neurosurgical evaluation advised.",
    teachingPoint: "AP diameter < 10 mm is critical threshold. T2 cord signal = myelomalacia = poor prognosis without surgery.",
  },
  {
    id: "kb-abdomen-fatty",
    title: "Fatty Liver Grading",
    tags: ["Abdomen", "Liver", "USG"],
    modality: "US",
    bodyPart: "ABDOMEN",
    findings: "Grade I: Mild diffuse increase with preserved vessel definition. Grade II: Marked increase with impaired vessels and posterior attenuation. Grade III: Severe with poor visualization.",
    impression: "Fatty liver, Grade ___.",
    teachingPoint: "Posterior beam attenuation is the key differentiator between Grade I and II. Grade III may obscure deep structures.",
  },
  {
    id: "kb-chest-tb",
    title: "Pulmonary Tuberculosis — Cavitation",
    tags: ["Chest", "Infection", "X-ray", "CT"],
    modality: "CR",
    bodyPart: "CHEST",
    findings: "Upper zone cavitary lesion with surrounding infiltrate. Hilar lymphadenopathy. Tree-in-bud pattern on CT.",
    impression: "Active pulmonary tuberculosis with cavitary lesion.",
    teachingPoint: "Cavitation indicates active, infectious disease. Tree-in-bud = endobronchial spread.",
  },
  {
    id: "kb-msk-meniscus",
    title: "Meniscal Tear — MRI",
    tags: ["MSK", "Knee", "MRI"],
    modality: "MR",
    bodyPart: "KNEE",
    findings: "Meniscal tear with high signal reaching articular surface on T2. Displaced fragment possible. Bone marrow edema.",
    impression: "Meniscal tear with possible displaced fragment.",
    teachingPoint: "High signal must reach articular surface to be a tear. Grade I/II signal without surface extension is degeneration.",
  },
  {
    id: "kb-pelvis-ovarian",
    title: "Ovarian Torsion — Doppler USG",
    tags: ["Pelvis", "Ovarian", "Emergency", "USG"],
    modality: "US",
    bodyPart: "PELVIS",
    findings: "Enlarged ovary (> 4 cm) with peripheral follicles. Absent or reduced Doppler flow. Free fluid.",
    impression: "Ovarian torsion — emergency laparoscopy advised.",
    teachingPoint: "Absent Doppler flow is not 100% sensitive. Enlarged ovary with peripheral follicles is the key sign.",
  },
  {
    id: "kb-brain-sah",
    title: "Subarachnoid Hemorrhage — CT",
    tags: ["Brain", "Hemorrhage", "Emergency", "CT"],
    modality: "CT",
    bodyPart: "BRAIN",
    findings: "Hyperdense material in sulci, cisterns, and interhemispheric fissure. Intraventricular extension possible. Hydrocephalus.",
    impression: "Acute subarachnoid hemorrhage. CTA for aneurysm workup.",
    teachingPoint: "CT sensitivity drops after 1 week. Lumbar puncture if CT negative but clinical suspicion high.",
  },
];

export function searchKnowledgeBase(query: string, modality?: string, bodyPart?: string): KnowledgeEntry[] {
  const lower = query.toLowerCase();
  return KNOWLEDGE_BASE.filter((kb) => {
    const matchesQuery =
      kb.title.toLowerCase().includes(lower) ||
      kb.tags.some((t) => t.toLowerCase().includes(lower)) ||
      kb.findings.toLowerCase().includes(lower) ||
      kb.impression.toLowerCase().includes(lower);
    const matchesModality = !modality || kb.modality === modality;
    const matchesBodyPart = !bodyPart || kb.bodyPart === bodyPart;
    return matchesQuery && matchesModality && matchesBodyPart;
  });
}

export function getKnowledgeTags(): string[] {
  const allTags = KNOWLEDGE_BASE.flatMap((kb) => kb.tags);
  return [...new Set(allTags)].sort();
}
