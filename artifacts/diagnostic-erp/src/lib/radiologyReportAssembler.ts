// ── True Report Assembler ──
// Phase 3: Premium Radiology Workstation
// Combines multiple structured findings / master templates into a single coherent report.
// Removes duplicates, merges sections, auto-creates impression, sorts anatomically.

export interface AssembledFinding {
  id: string;
  label: string;
  category: string;
  bodyPart: string;
  findings: string;
  impression: string;
  priority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
}

export interface AssembledReport {
  title: string;
  findingsBySection: { section: string; findings: string[] }[];
  impression: string[];
  advice: string;
  priority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
  qualityScore: number;
  warnings: string[];
  usedItems: string[];
}

// ── Anatomical sorting order ──
const ANATOMICAL_ORDER: string[] = [
  "BRAIN",
  "CERVICAL SPINE",
  "DORSAL SPINE",
  "LS SPINE",
  "WHOLE SPINE",
  "PITUITARY",
  "CHEST",
  "ABDOMEN",
  "LIVER",
  "GALLBLADDER",
  "PANCREAS",
  "SPLEEN",
  "KIDNEY",
  "BLADDER",
  "PROSTATE",
  "PELVIS",
  "UTERUS",
  "OVARY",
  "BREAST",
  "VASCULAR",
  "FETAL HEAD",
  "FETAL ABDOMEN",
  "FETAL FEMUR",
  "FETUS",
  "PLACENTA",
  "AMNIOTIC FLUID",
  "CERVIX",
  "SMALL PARTS",
  "OBSTETRIC",
  "FETAL HEART",
  "GENERAL",
];

function getSectionPriority(bodyPart: string): number {
  const idx = ANATOMICAL_ORDER.findIndex((a) =>
    bodyPart.toUpperCase().includes(a)
  );
  return idx === -1 ? 999 : idx;
}

// ── Duplicate detection ──
function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]/g, "")
    .trim();
}

function isDuplicate(a: string, b: string): boolean {
  const na = normalizeForDedup(a);
  const nb = normalizeForDedup(b);
  // Exact match
  if (na === nb) return true;
  // One contains the other (subsumption)
  if (na.length > 30 && nb.length > 30) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
}

function deduplicateFindings(findings: string[]): string[] {
  const result: string[] = [];
  for (const f of findings) {
    const normalized = normalizeForDedup(f);
    const isDup = result.some((r) => isDuplicate(r, f));
    if (!isDup && normalized.length > 0) {
      result.push(f);
    }
  }
  return result;
}

// ── Normal-statement deduplication ──
const NORMAL_PHRASES = [
  "normal",
  "no abnormality",
  "no focal lesion",
  "no mass",
  "no hemorrhage",
  "no infarct",
  "no acute",
  "no definite",
  "adequate",
  "unremarkable",
  "within normal limits",
];

function isNormalStatement(text: string): boolean {
  const lower = text.toLowerCase();
  return NORMAL_PHRASES.some((p) => lower.includes(p));
}

function deduplicateNormalStatements(findings: string[]): string[] {
  const normals = findings.filter(isNormalStatement);
  const nonNormals = findings.filter((f) => !isNormalStatement(f));
  // If we have abnormal findings, keep only one normal per section
  if (nonNormals.length > 0 && normals.length > 1) {
    return [normals[0], ...nonNormals];
  }
  return findings;
}

// ── Auto-impression builder ──
function buildImpression(items: AssembledFinding[]): string[] {
  const impressions: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item.impression || item.impression.trim().length === 0) continue;
    const norm = normalizeForDedup(item.impression);
    if (seen.has(norm)) continue;
    seen.add(norm);
    impressions.push(item.impression);
  }

  // Sort: critical first, then significant, then minor, then normal
  const priorityOrder = { CRITICAL: 0, SIGNIFICANT: 1, MINOR: 2, NORMAL: 3 };
  const withPriority = items.map((item, i) => ({
    impression: item.impression,
    priority: item.priority,
    index: i,
  }));

  withPriority.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 4;
    const pb = priorityOrder[b.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });

  return withPriority
    .map((w) => w.impression)
    .filter((imp) => imp && imp.trim().length > 0)
    .filter((imp, i, arr) => {
      const norm = normalizeForDedup(imp);
      return arr.findIndex((a) => normalizeForDedup(a) === norm) === i;
    });
}

// ── Quality scoring ──
function calculateQualityScore(items: AssembledFinding[]): number {
  let score = 100;
  // Deduct for missing impressions
  const missingImpressions = items.filter((i) => !i.impression || i.impression.trim().length === 0);
  score -= missingImpressions.length * 10;
  // Deduct for placeholders
  const placeholderCount = items.reduce((sum, i) => {
    const matches = i.findings.match(/___/g);
    return sum + (matches?.length ?? 0);
  }, 0);
  score -= placeholderCount * 3;
  // Deduct for duplicate findings
  const allFindings = items.flatMap((i) => i.findings.split("\n").filter((f) => f.trim().length > 10));
  const seen = new Set<string>();
  let dupes = 0;
  for (const f of allFindings) {
    const norm = normalizeForDedup(f);
    if (seen.has(norm)) dupes++;
    seen.add(norm);
  }
  score -= dupes * 5;
  // Deduct for missing measurements
  const missingMeasurements = items.some((i) => i.findings.includes("___ mm") || i.findings.includes("___ cc"));
  if (missingMeasurements) score -= 5;
  // Clamp
  return Math.max(0, Math.min(100, score));
}

// ── Main assembler ──
export function assembleReportFromItems(
  items: AssembledFinding[],
  combinedTitle?: string
): AssembledReport {
  // Group by body part
  const byBodyPart = new Map<string, AssembledFinding[]>();
  for (const item of items) {
    const existing = byBodyPart.get(item.bodyPart) ?? [];
    existing.push(item);
    byBodyPart.set(item.bodyPart, existing);
  }

  // Sort sections anatomically
  const sortedSections = Array.from(byBodyPart.entries()).sort((a, b) => {
    const pa = getSectionPriority(a[0]);
    const pb = getSectionPriority(b[0]);
    return pa - pb;
  });

  // Build findings by section
  const findingsBySection = sortedSections.map(([section, sectionItems]) => {
    const allFindings = sectionItems.flatMap((i) =>
      i.findings.split("\n").filter((f) => f.trim().length > 0)
    );
    const deduped = deduplicateFindings(deduplicateNormalStatements(allFindings));
    return { section, findings: deduped };
  });

  // Filter out sections with only normal statements if there are abnormal sections
  const hasAbnormal = findingsBySection.some((s) =>
    s.findings.some((f) => !isNormalStatement(f))
  );
  const filteredSections = hasAbnormal
    ? findingsBySection.filter((s) =>
        s.findings.some((f) => !isNormalStatement(f))
      )
    : findingsBySection;

  // Build impression
  const impression = buildImpression(items);

  // Determine priority
  const priorityOrder = { CRITICAL: 0, SIGNIFICANT: 1, MINOR: 2, NORMAL: 3 };
  let maxPriority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL" = "NORMAL";
  for (const item of items) {
    const p = priorityOrder[item.priority] ?? 4;
    const current = priorityOrder[maxPriority] ?? 4;
    if (p < current) maxPriority = item.priority;
  }

  // Quality score
  const qualityScore = calculateQualityScore(items);

  // Warnings
  const warnings: string[] = [];
  const placeholderCount = items.reduce((sum, i) => {
    const matches = i.findings.match(/___/g);
    return sum + (matches?.length ?? 0);
  }, 0);
  if (placeholderCount > 0) warnings.push(`${placeholderCount} measurement placeholder(s) need values`);
  if (impression.length === 0) warnings.push("No impression generated — add impressions to individual findings");

  // Advice
  const advice = maxPriority === "CRITICAL"
    ? "URGENT: Critical findings require immediate attention and clinical correlation."
    : maxPriority === "SIGNIFICANT"
    ? "Clinical correlation and follow-up recommended."
    : maxPriority === "MINOR"
    ? "Routine follow-up as clinically indicated."
    : "No follow-up required.";

  return {
    title: combinedTitle ?? items.map((i) => i.label).join(" + "),
    findingsBySection: filteredSections,
    impression,
    advice,
    priority: maxPriority,
    qualityScore,
    warnings,
    usedItems: items.map((i) => i.label),
  };
}

// ── Multi-study composer ──
export function composeMultiStudy(
  studies: AssembledFinding[],
  combinedTitle?: string
): AssembledReport {
  return assembleReportFromItems(studies, combinedTitle);
}

// ── Smart impression builder ──
export function buildSmartImpression(
  findings: string[],
  knownImpressions: string[]
): string {
  const deduped = [...new Set(knownImpressions)].filter((i) => i.trim().length > 0);
  if (deduped.length === 0) return "";
  if (deduped.length === 1) return deduped[0];

  // Combine multiple impressions into a coherent summary
  const parts: string[] = [];
  const critical = deduped.filter((i) =>
    /critical|urgent|emergency|hemorrhage|infarct|compression|stenosis/i.test(i)
  );
  const significant = deduped.filter((i) =>
    /significant|moderate|severe|mass|tumor|lesion/i.test(i) && !critical.includes(i)
  );
  const minor = deduped.filter((i) =>
    /mild|minor|minimal|small|few/i.test(i) && !critical.includes(i) && !significant.includes(i)
  );
  const normal = deduped.filter((i) =>
    /normal|unremarkable|no abnormality/i.test(i) && !critical.includes(i) && !significant.includes(i) && !minor.includes(i)
  );

  if (critical.length > 0) parts.push(...critical);
  if (significant.length > 0) parts.push(...significant);
  if (minor.length > 0) parts.push(...minor);
  if (normal.length > 0 && parts.length === 0) parts.push(...normal);

  return parts.join("\n");
}

// ── Auto-detect from text ──
export interface DetectedFinding {
  label: string;
  bodyPart: string;
  priority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
  impression: string;
}

export function detectFindingsFromText(text: string): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const lower = text.toLowerCase();

  // Critical patterns
  const criticalPatterns = [
    { pattern: /acute infarct|restricted diffusion|dw hyperintense|acute ischemia/i, label: "Acute Infarct", bodyPart: "BRAIN", impression: "Acute infarct detected." },
    { pattern: /hemorrhage|bleed|hyperdense|swi blooming/i, label: "Intracranial Hemorrhage", bodyPart: "BRAIN", impression: "Intracranial hemorrhage detected." },
    { pattern: /cord compression|myelomalacia|myelopathy/i, label: "Cord Compression", bodyPart: "SPINE", impression: "Spinal cord compression with myelomalacia." },
    { pattern: /severe canal stenosis|obliteration|obliterated canal/i, label: "Severe Canal Stenosis", bodyPart: "SPINE", impression: "Severe canal stenosis." },
    { pattern: /tension pneumothorax|tension pneumo/i, label: "Tension Pneumothorax", bodyPart: "CHEST", impression: "Tension pneumothorax — emergency." },
    { pattern: /hydrocephalus|dilated ventricles|transependymal/i, label: "Hydrocephalus", bodyPart: "BRAIN", impression: "Hydrocephalus." },
    { pattern: /sol|mass lesion|space.occupying|tumor/i, label: "Space-Occupying Lesion", bodyPart: "BRAIN", impression: "Space-occupying lesion — further evaluation required." },
  ];

  const significantPatterns = [
    { pattern: /disc protrusion|herniation|extrusion/i, label: "Disc Protrusion", bodyPart: "SPINE", impression: "Disc protrusion/herniation." },
    { pattern: /moderate canal stenosis|moderate narrowing/i, label: "Moderate Canal Stenosis", bodyPart: "SPINE", impression: "Moderate canal stenosis." },
    { pattern: /fazekas grade ii|fazekas ii|beginning confluence/i, label: "Fazekas Grade II", bodyPart: "BRAIN", impression: "Chronic microangiopathic ischemic changes (Fazekas II)." },
    { pattern: /pituitary adenoma|macroadenoma|suprasellar mass/i, label: "Pituitary Adenoma", bodyPart: "PITUITARY", impression: "Pituitary macroadenoma." },
  ];

  const minorPatterns = [
    { pattern: /disc bulge|broad.based bulge/i, label: "Disc Bulge", bodyPart: "SPINE", impression: "Disc bulge." },
    { pattern: /disc desiccation|loss of t2/i, label: "Disc Desiccation", bodyPart: "SPINE", impression: "Disc desiccation." },
    { pattern: /facet arthropathy|facet hypertrophy/i, label: "Facet Arthropathy", bodyPart: "SPINE", impression: "Facet arthropathy." },
    { pattern: /fazekas grade i|fazekas i|punctate/i, label: "Fazekas Grade I", bodyPart: "BRAIN", impression: "Mild periventricular ischemic changes (Fazekas I)." },
    { pattern: /empty sella|partially empty sella/i, label: "Empty Sella", bodyPart: "BRAIN", impression: "Empty sella turcica." },
    { pattern: /fatty liver grade i|fatty liver i/i, label: "Fatty Liver Grade I", bodyPart: "ABDOMEN", impression: "Grade I fatty liver." },
    { pattern: /fatty liver grade ii|fatty liver ii/i, label: "Fatty Liver Grade II", bodyPart: "ABDOMEN", impression: "Grade II fatty liver." },
    { pattern: /renal calculus|kidney stone|echogenic focus/i, label: "Renal Calculus", bodyPart: "KIDNEY", impression: "Renal calculus." },
  ];

  for (const p of criticalPatterns) {
    if (p.pattern.test(lower)) {
      findings.push({ label: p.label, bodyPart: p.bodyPart, priority: "CRITICAL", impression: p.impression });
    }
  }
  for (const p of significantPatterns) {
    if (p.pattern.test(lower)) {
      findings.push({ label: p.label, bodyPart: p.bodyPart, priority: "SIGNIFICANT", impression: p.impression });
    }
  }
  for (const p of minorPatterns) {
    if (p.pattern.test(lower)) {
      findings.push({ label: p.label, bodyPart: p.bodyPart, priority: "MINOR", impression: p.impression });
    }
  }

  return findings;
}

// ── QA Guard: comprehensive pre-finalize checks ──
export interface QAGuardResult {
  score: number; // 0-100
  passed: boolean;
  checks: { id: string; label: string; pass: boolean; message?: string }[];
  criticalAlerts: string[];
  canOverride: boolean;
}

export function runQAGuard(findings: string, impression: string, measurements: string[] = []): QAGuardResult {
  const checks: { id: string; label: string; pass: boolean; message?: string }[] = [];
  const criticalAlerts: string[] = [];
  let score = 100;

  // 1. Missing findings
  const hasFindings = findings.trim().length > 20;
  checks.push({ id: "findings", label: "Findings present", pass: hasFindings });
  if (!hasFindings) { score -= 15; criticalAlerts.push("Findings section is empty or too short"); }

  // 2. Missing impression
  const hasImpression = impression.trim().length > 0;
  checks.push({ id: "impression", label: "Impression present", pass: hasImpression });
  if (!hasImpression) { score -= 20; criticalAlerts.push("Impression is missing"); }

  // 3. Duplicate text
  const lines = findings.split(/\n/).map((l) => l.trim().toLowerCase()).filter((l) => l.length > 10);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const line of lines) {
    const norm = line.replace(/\s+/g, " ");
    if (seen.has(norm)) dupes.push(line);
    seen.add(norm);
  }
  const hasDuplicates = dupes.length > 0;
  checks.push({ id: "duplicates", label: "No duplicate text", pass: !hasDuplicates, message: hasDuplicates ? `${dupes.length} duplicate(s) found` : undefined });
  if (hasDuplicates) { score -= 10; criticalAlerts.push(`${dupes.length} duplicate statement(s) found`); }

  // 4. Conflicts
  const detected = detectFindingsFromText(findings);
  const criticalCount = detected.filter((d) => d.priority === "CRITICAL").length;
  checks.push({ id: "conflicts", label: "No conflicting findings", pass: criticalCount === 0, message: criticalCount > 0 ? `${criticalCount} critical finding(s) detected` : undefined });
  if (criticalCount > 0) { score -= 15; criticalAlerts.push(`Critical findings detected: ${detected.filter((d) => d.priority === "CRITICAL").map((d) => d.label).join(", ")}`); }

  // 5. Missing measurements
  const hasMeasurementPlaceholders = /___\s*(mm|cc|cm|ml|g)/i.test(findings);
  checks.push({ id: "measurements", label: "Measurements filled", pass: !hasMeasurementPlaceholders, message: hasMeasurementPlaceholders ? "Measurement placeholders remaining" : undefined });
  if (hasMeasurementPlaceholders) { score -= 8; criticalAlerts.push("Measurements have unfilled placeholders (___)"); }

  // 6. Placeholder text
  const hasPlaceholders = /___/.test(findings) || /___/.test(impression);
  checks.push({ id: "placeholders", label: "No placeholders", pass: !hasPlaceholders, message: hasPlaceholders ? "Unfilled placeholders present" : undefined });
  if (hasPlaceholders) { score -= 10; criticalAlerts.push("Placeholder text (___) needs to be filled in"); }

  // 7. Grammar issues (basic)
  const grammarIssues = findings.match(/\s\s+/g);
  const hasGrammarIssues = (grammarIssues?.length ?? 0) > 3;
  checks.push({ id: "grammar", label: "Grammar clean", pass: !hasGrammarIssues, message: hasGrammarIssues ? "Extra spacing detected" : undefined });
  if (hasGrammarIssues) score -= 3;

  // 8. Impression mismatch
  const impressionLower = impression.toLowerCase();
  const findingsLower = findings.toLowerCase();
  const impressionMismatch = impression.length > 0 && detected.length > 0 && detected.some((d) => !impressionLower.includes(d.label.toLowerCase()));
  checks.push({ id: "mismatch", label: "Impression matches findings", pass: !impressionMismatch, message: impressionMismatch ? "Impression may not cover all findings" : undefined });
  if (impressionMismatch) { score -= 7; criticalAlerts.push("Impression may not fully cover all detected findings"); }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  // Can override if score >= 60
  const canOverride = score >= 60;

  return {
    score,
    passed: score >= 85,
    checks,
    criticalAlerts,
    canOverride,
  };
}

// ── Critical Finding Detector ──
export interface CriticalFinding {
  label: string;
  priority: "CRITICAL";
  message: string;
  location?: string;
}

export function detectCriticalFindings(findings: string): CriticalFinding[] {
  const detected = detectFindingsFromText(findings);
  return detected
    .filter((d) => d.priority === "CRITICAL")
    .map((d) => ({
      label: d.label,
      priority: "CRITICAL" as const,
      message: `${d.label} detected in ${d.bodyPart}. Immediate attention required.`,
      location: d.bodyPart,
    }));
}

// ── Previous Report Intelligence ──
export interface PreviousReportChange {
  type: "stable" | "improved" | "progressed" | "new" | "resolved";
  label: string;
  description: string;
}

export function compareWithPrevious(
  currentFindings: string,
  previousFindings: string
): PreviousReportChange[] {
  const changes: PreviousReportChange[] = [];
  const current = detectFindingsFromText(currentFindings);
  const previous = detectFindingsFromText(previousFindings);

  const currentLabels = new Set(current.map((c) => c.label));
  const previousLabels = new Set(previous.map((p) => p.label));

  // New findings
  for (const c of current) {
    if (!previousLabels.has(c.label)) {
      changes.push({ type: "new", label: c.label, description: `New finding: ${c.label}` });
    }
  }

  // Resolved findings
  for (const p of previous) {
    if (!currentLabels.has(p.label)) {
      changes.push({ type: "resolved", label: p.label, description: `Resolved: ${p.label}` });
    }
  }

  // Stable findings
  for (const c of current) {
    if (previousLabels.has(c.label)) {
      changes.push({ type: "stable", label: c.label, description: `Stable: ${c.label}` });
    }
  }

  return changes;
}

// ── One-click report generator ──
export interface OneClickReport {
  id: string;
  label: string;
  modality: string;
  bodyPart: string;
  title: string;
  findings: string;
  impression: string;
  priority: "NORMAL" | "MINOR" | "SIGNIFICANT" | "CRITICAL";
}

export const ONE_CLICK_REPORTS: OneClickReport[] = [
  {
    id: "mri-brain-normal",
    label: "MRI Brain Normal",
    modality: "MR",
    bodyPart: "BRAIN",
    title: "MRI BRAIN",
    findings: "BRAIN PARENCHYMA: Normal signal intensity on all sequences.\nVENTRICLES: Normal size and configuration.\nMIDLINE: No shift.\nNo focal lesion, hemorrhage, or infarct.",
    impression: "Normal MRI brain study.",
    priority: "NORMAL",
  },
  {
    id: "mri-brain-senile",
    label: "MRI Brain Senile Changes",
    modality: "MR",
    bodyPart: "BRAIN",
    title: "MRI BRAIN",
    findings: "BRAIN PARENCHYMA: Mild diffuse cerebral atrophy with prominent sulci and ventricles.\nPERIVENTRICULAR: Multiple punctate hyperintense foci on FLAIR — Fazekas Grade I.\nNo mass lesion, hemorrhage, or acute infarct.",
    impression: "Senile cerebral atrophy with mild periventricular ischemic changes (Fazekas Grade I).",
    priority: "MINOR",
  },
  {
    id: "mri-brain-infarct",
    label: "MRI Brain Infarct",
    modality: "MR",
    bodyPart: "BRAIN",
    title: "MRI BRAIN",
    findings: "HYPERINTENSE area on T2/FLAIR with restricted diffusion on DWI and low ADC in the ___ territory, suggestive of acute infarct.\nNo hemorrhagic transformation.\nMASS EFFECT: Mild.",
    impression: "Acute infarct in the ___ territory.",
    priority: "CRITICAL",
  },
  {
    id: "mri-brain-hemorrhage",
    label: "MRI Brain Hemorrhage",
    modality: "MR",
    bodyPart: "BRAIN",
    title: "MRI BRAIN",
    findings: "HYPERINTENSE on T1 and T2/FLAIR with blooming on SWI in the ___ region, suggestive of intraparenchymal hemorrhage.\nMass effect: Present.\nMidline shift: ___ mm.",
    impression: "Intracranial hemorrhage in the ___ region with mass effect.",
    priority: "CRITICAL",
  },
  {
    id: "mri-brain-hydrocephalus",
    label: "MRI Brain Hydrocephalus",
    modality: "MR",
    bodyPart: "BRAIN",
    title: "MRI BRAIN",
    findings: "VENTRICULAR SYSTEM: Dilated lateral and third ventricles.\nTemporal horns prominent.\nTransependymal CSF seepage noted on FLAIR.\nFourth ventricle: Normal.\nNo obstructing lesion.",
    impression: "Hydrocephalus.",
    priority: "SIGNIFICANT",
  },
  {
    id: "mri-pituitary-empty",
    label: "MRI Pituitary Empty Sella",
    modality: "MR",
    bodyPart: "PITUITARY",
    title: "MRI PITUITARY",
    findings: "SELLA TURCICA: Enlarged, predominantly filled with CSF signal.\nPITUITARY: Flattened along the floor.\nOPTIC CHIASMA: Normal.\nNo suprasellar mass.",
    impression: "Empty sella turcica.",
    priority: "MINOR",
  },
  {
    id: "mri-cervical-spondylosis",
    label: "MRI Cervical Spondylosis",
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    title: "MRI CERVICAL SPINE",
    findings: "CERVICAL SPINE: Degenerative changes.\nC4-C5: Disc desiccation with posterior disc bulge.\nC5-C6: Disc bulge with mild canal narrowing (AP diameter ___ mm).\nCORD: Normal signal.\nNo cord compression.",
    impression: "Cervical spondylosis with disc bulges at C4-C5 and C5-C6. No cord compression.",
    priority: "MINOR",
  },
  {
    id: "mri-cervical-trauma",
    label: "MRI Cervical Trauma",
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    title: "MRI CERVICAL SPINE",
    findings: "CERVICAL SPINE: Loss of normal lordosis.\nC___: Vertebral body fracture with retropulsion.\nSPINAL CANAL: Narrowed.\nCORD: T2 hyperintense signal at C___ level, suggestive of cord contusion/edema.\nPREVERTEBRAL SOFT TISSUE: Swelling.",
    impression: "Cervical spine fracture at C___ with spinal cord contusion/edema.",
    priority: "CRITICAL",
  },
  {
    id: "mri-ls-disc-bulge",
    label: "MRI LS Disc Bulge",
    modality: "MR",
    bodyPart: "LS SPINE",
    title: "MRI LS SPINE",
    findings: "LS SPINE: L4-L5 and L5-S1: Disc desiccation with posterior bulge.\nSPINAL CANAL: Mildly narrowed at L4-L5.\nNEURAL FORAMINA: Mildly narrowed at L5-S1 bilaterally.\nCONUS: Normal.",
    impression: "Degenerative lumbar spondylotic changes with disc bulges at L4-L5 and L5-S1, mild canal and foraminal narrowing.",
    priority: "MINOR",
  },
  {
    id: "mri-ls-stenosis",
    label: "MRI LS Canal Stenosis",
    modality: "MR",
    bodyPart: "LS SPINE",
    title: "MRI LS SPINE",
    findings: "LS SPINE: L4-L5: Severe canal stenosis (AP diameter ___ mm).\nL5-S1: Disc bulge with facet hypertrophy.\nNEURAL FORAMINA: Severely narrowed at L4-L5 bilaterally.\nCONUS: Normal.",
    impression: "Severe lumbar canal stenosis at L4-L5 with bilateral foraminal narrowing. Surgical evaluation recommended.",
    priority: "SIGNIFICANT",
  },
  {
    id: "usg-abdomen-normal",
    label: "USG Abdomen Normal",
    modality: "US",
    bodyPart: "ABDOMEN",
    title: "USG ABDOMEN",
    findings: "LIVER: Normal in size, shape, and echotexture. No focal lesion.\nGALLBLADDER: Normal wall thickness. No calculus.\nPANCREAS: Normal size and echotexture.\nSPLEEN: Normal size.\nKIDNEYS: Both normal size. No hydronephrosis.\nBLADDER: Normal wall.\nNo free fluid.",
    impression: "Normal USG abdomen.",
    priority: "NORMAL",
  },
  {
    id: "usg-abdomen-fl",
    label: "USG Fatty Liver",
    modality: "US",
    bodyPart: "ABDOMEN",
    title: "USG ABDOMEN",
    findings: "LIVER: Normal size. Diffuse increased echotexture with slightly impaired intrahepatic vessel definition — Grade I fatty liver.",
    impression: "Grade I fatty liver.",
    priority: "MINOR",
  },
  {
    id: "usg-abdomen-renal",
    label: "USG Renal Calculus",
    modality: "US",
    bodyPart: "ABDOMEN",
    title: "USG ABDOMEN",
    findings: "KIDNEYS: Echogenic focus with posterior acoustic shadowing in the ___ kidney, measuring ___ mm. No hydronephrosis.",
    impression: "Renal calculus in the ___ kidney.",
    priority: "MINOR",
  },
];

export function findOneClickReport(id: string): OneClickReport | undefined {
  return ONE_CLICK_REPORTS.find((r) => r.id === id);
}

export function searchOneClickReports(
  query: string,
  modality?: string,
  bodyPart?: string
): OneClickReport[] {
  const q = query.toLowerCase();
  return ONE_CLICK_REPORTS.filter((r) => {
    const matchQuery =
      r.label.toLowerCase().includes(q) ||
      r.bodyPart.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q);
    const matchModality = !modality || r.modality === modality;
    const matchBodyPart = !bodyPart || r.bodyPart === bodyPart;
    return matchQuery && matchModality && matchBodyPart;
  });
}
