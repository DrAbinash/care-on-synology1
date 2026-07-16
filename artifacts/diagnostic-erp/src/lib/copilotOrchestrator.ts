/**
 * copilotOrchestrator.ts — the CARE Radiology Copilot's reasoning core (PR #80).
 *
 * This does NOT introduce a second engine. It ORCHESTRATES the pieces that
 * already exist — `observeReportText` (radiologyCoPilotEngine) for live findings
 * analysis, and `computeQualityScore` / `validateReport` (reportValidator) — into
 * a single, uniformly-shaped `CopilotReport` matching the Copilot panel's section
 * taxonomy, and ADDS the deterministic capabilities those pieces don't cover yet:
 * structured contradictions, differential diagnosis, recommendation/follow-up
 * suggestions, missing-observation detection, an impression-completeness check,
 * and measurement reminders.
 *
 * Every item carries a plain-language `why` (Part 15), a `confidence` (Part 16),
 * and — crucially — is advisory only: an item may offer `insertText`, but nothing
 * here mutates a report. Acceptance happens in the UI (Part 17 safety).
 *
 * Pure and alias-free (imports only sibling libs) so it runs under the root
 * vitest config, same reasoning as commandPalette.ts / structuredFindings.ts.
 * The knowledge base below is data, not code — PR #81 grows it without touching
 * the engine.
 */
import { observeReportText, type CoPilotSuggestion } from "./radiologyCoPilotEngine";
import { computeQualityScore, type QualityInput } from "./reportValidator";

export type CopilotCategory =
  | "suggestion" // live findings analysis (Part 2)
  | "missing" // possible missing observations (Part 3)
  | "contradiction" // contradiction detection (Part 4)
  | "impression" // impression validator (Part 5)
  | "recommendation" // recommendation / follow-up (Parts 6, 9)
  | "differential" // differential diagnosis (Part 7)
  | "measurement" // structured measurement reminder (Part 10)
  | "critical"; // critical-result safety (MRI PR 3)

export type Confidence = "high" | "medium" | "low";
export type InsertTarget = "findings" | "impression" | "recommendation";
export type Severity = "info" | "warning" | "critical";

export interface CopilotItem {
  id: string;
  category: CopilotCategory;
  severity: Severity;
  title: string;
  detail: string;
  /** Plain-language justification shown behind "Why?" (Part 15). */
  why: string;
  confidence: Confidence;
  /** One-click insertable text — advisory only; the UI owns acceptance (Part 17). */
  insertText?: string;
  insertTarget?: InsertTarget;
  /** A phrase to locate for "Go to conflict" (Part 4). */
  matchText?: string;
}

export type QualityBand = "Excellent" | "Good" | "Needs Review";

export interface CopilotReport {
  items: CopilotItem[];
  quality: { score: number; band: QualityBand; issues: string[] };
}

export interface CopilotContext {
  modality: string;
  studyDescription: string;
  clinicalHistory: string;
  findings: string;
  impression: string[];
  recommendation: string;
  technique: string;
  /** Labels of currently-selected structured findings (context, Part 13). */
  selectedFindingLabels: string[];
  checklistPercent?: number;
  missingRequiredMeasurements?: string[];
  /** Previous-study context (MRI PR 1) — populated by the workspace when a prior
   *  is selected, so the comparison module can advise without re-fetching. */
  prior?: {
    available: boolean;
    dateIso?: string;
    studyName?: string;
    /** Measurement labels whose interval change is clinically meaningful. */
    significantChanges?: { label: string; deltaText: string }[];
  };
  /** Accepted viewer/DICOM-SR measurements (MRI PR 2) — populated by the
   *  workspace from the existing useViewerMeasurements hook, so the measurement
   *  module can flag values captured in the viewer but missing from the report. */
  viewerMeasurements?: { label: string; value: number; unit: string; imported: boolean }[];
  /** Critical-result context (MRI PR 3) — per-study critical watch terms (reused
   *  from radiologyMasterTemplates `criticalWatchList`) plus the current state of
   *  the existing "Mark Critical Finding" toggle and the F5 communication
   *  checklist, so the critical-results module can advise without new state. */
  criticalWatchList?: string[];
  criticalMarked?: boolean;
  criticalCommunicated?: boolean;
  /** CARE USG Companion (Phase 1) — the Companion panel threads its
   *  machine-measurement outcome up here (imported / rejected / modified /
   *  missing), so the existing Copilot can advise on it WITHOUT a second
   *  Copilot. Populated only for ultrasound studies; the module is a no-op
   *  when absent. */
  usgCompanion?: {
    studyType: string;
    imported: { label: string; value: string }[];
    rejected: { label: string; value: string }[];
    modified: { label: string; value: string }[];
    missing: string[];
    /** Phase 2 — sentences auto-populated by the Companion, for review advice. */
    autoPopulated?: { section: string; text: string; kind: string }[];
  };
}

const has = (haystack: string, needle: string) => haystack.includes(needle);
const hasAny = (haystack: string, needles: string[]) => needles.some((n) => haystack.includes(n));

// ── Knowledge base (data, not logic) ────────────────────────────────────────
// Each trigger fires when its phrase (or a selected structured finding) is in the
// findings AND none of the observation's "satisfiedBy" phrases are present yet.

interface MissingRule {
  id: string;
  trigger: string[]; // any phrase in findings (lower-case)
  studyIncludes?: string; // optional study-description gate
  observation: string; // what to prompt for
  satisfiedBy: string[]; // phrases that mean it's already covered
  confidence: Confidence;
  why: string;
}

const MISSING_RULES: MissingRule[] = [
  // Brain — acute infarct (Part 3 example)
  { id: "brain-swi", trigger: ["acute infarct", "acute stroke", "restricted diffusion"], studyIncludes: "brain", observation: "SWI/GRE for haemorrhagic transformation", satisfiedBy: ["swi", "gre", "haemorrhag", "hemorrhag", "blooming"], confidence: "high", why: "Acute infarcts require SWI/GRE to exclude haemorrhagic transformation before thrombolysis decisions." },
  { id: "brain-midline", trigger: ["acute infarct", "large territory", "mass"], studyIncludes: "brain", observation: "Midline shift / mass effect", satisfiedBy: ["midline", "mass effect", "herniation"], confidence: "medium", why: "Territorial infarcts and masses can cause midline shift; its presence/absence should be stated." },
  { id: "brain-ventricles", trigger: ["acute infarct", "atrophy", "hydrocephalus"], studyIncludes: "brain", observation: "Ventricles & sulci", satisfiedBy: ["ventricle", "sulci", "sulcal"], confidence: "low", why: "Ventricular size and sulcal pattern give context for volume loss or obstruction." },
  { id: "brain-sinuses", trigger: ["infarct", "headache"], studyIncludes: "brain", observation: "Paranasal sinuses / mastoids", satisfiedBy: ["sinus", "mastoid"], confidence: "low", why: "Incidental sinus/mastoid disease is commonly present and worth a line." },
  // LS spine — disc bulge (Part 3 example)
  { id: "ls-canal", trigger: ["disc bulge", "disc protrusion", "disc herniation"], studyIncludes: "spine", observation: "Central canal diameter / stenosis", satisfiedBy: ["canal", "stenosis", "thecal"], confidence: "high", why: "A disc bulge's significance depends on its effect on the central canal." },
  { id: "ls-foramina", trigger: ["disc bulge", "disc protrusion", "disc herniation"], studyIncludes: "spine", observation: "Neural foramina", satisfiedBy: ["foramin", "foramen"], confidence: "high", why: "Foraminal narrowing determines radicular symptoms and is expected with a bulge." },
  { id: "ls-nerve", trigger: ["disc bulge", "disc protrusion", "disc herniation"], studyIncludes: "spine", observation: "Traversing / exiting nerve root", satisfiedBy: ["nerve root", "traversing", "exiting"], confidence: "medium", why: "Nerve-root contact/compression is the clinically actionable consequence of a bulge." },
  { id: "ls-desiccation", trigger: ["disc bulge", "disc protrusion"], studyIncludes: "spine", observation: "Disc desiccation / height", satisfiedBy: ["desicc", "disc height", "dehydrat"], confidence: "low", why: "Desiccation and height loss describe the degenerative context of the bulge." },
  { id: "ls-modic", trigger: ["disc bulge", "endplate", "degenerative"], studyIncludes: "spine", observation: "Modic endplate changes", satisfiedBy: ["modic", "endplate"], confidence: "low", why: "Modic changes are a recognised pain correlate at the affected level." },
  // Cervical cord
  { id: "cx-myelomalacia", trigger: ["cord compression", "cord signal", "myelomalac"], studyIncludes: "spine", observation: "Cord signal change / myelomalacia", satisfiedBy: ["myelomalac", "cord signal", "t2 hyperintens"], confidence: "high", why: "Cord signal change alters prognosis and surgical urgency in compression." },
];

interface DifferentialRule {
  id: string;
  trigger: string[];
  title: string;
  differentials: string[];
  confidence: Confidence;
  why: string;
}

const DIFFERENTIAL_RULES: DifferentialRule[] = [
  { id: "ddx-ring", trigger: ["ring enhancing", "ring-enhancing", "ring lesion"], title: "Ring-enhancing lesion", differentials: ["Neurocysticercosis", "Tuberculoma", "Metastasis", "Abscess", "High-grade glioma"], confidence: "medium", why: "A ring-enhancing lesion has a classic short differential; correlation with clinical/lab context narrows it." },
  { id: "ddx-t2wm", trigger: ["t2 hyperintense white matter", "white matter hyperintensit", "demyelinat"], title: "T2 hyperintense white-matter lesions", differentials: ["Small-vessel ischaemia", "Demyelination (MS)", "Migraine-related", "Vasculitis"], confidence: "low", why: "White-matter hyperintensities are non-specific; the pattern and age guide the differential." },
  { id: "ddx-marrow", trigger: ["marrow replacement", "marrow infiltrat", "multiple lytic"], title: "Marrow infiltrative pattern", differentials: ["Metastases", "Multiple myeloma", "Lymphoma", "Haemopoietic hyperplasia"], confidence: "low", why: "Diffuse marrow signal abnormality warrants a marrow-infiltration differential." },
];

interface RecommendationRule {
  id: string;
  trigger: string[];
  text: string;
  confidence: Confidence;
  why: string;
}

const RECOMMENDATION_RULES: RecommendationRule[] = [
  { id: "rec-mra", trigger: ["acute infarct", "acute stroke"], text: "MR angiography of the intracranial vessels is advised if clinically indicated.", confidence: "high", why: "Acute infarct warrants vascular assessment to identify a treatable arterial lesion." },
  { id: "rec-neurosurg", trigger: ["cord compression", "severe canal stenosis", "cauda equina"], text: "Neurosurgical consultation is advised.", confidence: "high", why: "Cord compression / severe stenosis / cauda equina are surgical-urgency findings." },
  { id: "rec-contrast", trigger: ["suspicious", "neoplasm", "tumour", "tumor", "mass lesion"], text: "Contrast-enhanced MRI is advised for further characterisation.", confidence: "medium", why: "A suspicious mass is better characterised with contrast (enhancement pattern, margins)." },
  { id: "rec-birads", trigger: ["bi-rads 4", "bi-rads 5", "birads 4", "birads 5"], text: "Tissue sampling / biopsy correlation is advised.", confidence: "high", why: "BI-RADS 4/5 lesions require histological correlation." },
];

// Findings that are clinically important enough to expect in the Impression (Part 5).
const IMPORTANT_FINDING_TERMS: { term: string; label: string }[] = [
  { term: "canal stenosis", label: "canal stenosis" },
  { term: "cord compression", label: "cord compression" },
  { term: "acute infarct", label: "acute infarct" },
  { term: "haemorrhage", label: "haemorrhage" },
  { term: "hemorrhage", label: "hemorrhage" },
  { term: "mass", label: "a mass lesion" },
  { term: "fracture", label: "a fracture" },
  { term: "nerve root", label: "nerve-root involvement" },
];

// Contradiction pairs (Part 4): a "negation/normal" phrase vs. a "present" phrase.
const CONTRADICTION_PAIRS: { id: string; normal: string[]; present: string[]; label: string }[] = [
  { id: "con-normal-brain", normal: ["normal study", "unremarkable study", "no abnormal", "normal mri brain", "normal brain"], present: ["acute infarct", "haemorrhage", "hemorrhage", "mass", "infarct"], label: "a normal-study statement and a pathological finding" },
  { id: "con-nobleed", normal: ["no haemorrhage", "no hemorrhage", "no evidence of bleed", "no acute bleed"], present: ["acute bleed", "acute haemorrhage", "acute hemorrhage", "haematoma", "hematoma"], label: "“no haemorrhage” and an acute bleed" },
  { id: "con-nobulge", normal: ["no disc bulge", "no disc herniation", "no significant disc"], present: ["disc bulge", "disc herniation", "disc protrusion"], label: "“no disc bulge” and a described disc bulge" },
  { id: "con-nostenosis", normal: ["no canal stenosis", "no significant stenosis", "no central canal stenosis"], present: ["severe canal stenosis", "severe central canal stenosis", "moderate to severe canal stenosis"], label: "“no canal stenosis” and severe stenosis" },
];

/** Map a legacy CoPilotSuggestion (observeReportText) into a unified item. */
function fromLegacy(s: CoPilotSuggestion): CopilotItem {
  const category: CopilotCategory =
    s.type === "contradiction" ? "contradiction"
    : s.type === "reminder" ? "missing"
    : s.actionableText && /recommend|advis|angiograph|follow-up/i.test(s.actionableText) ? "recommendation"
    : "suggestion";
  const confidence: Confidence = s.severity === "critical" ? "high" : s.severity === "warning" ? "medium" : "low";
  return {
    id: `legacy:${s.id}`,
    category,
    severity: s.severity,
    title: s.title,
    detail: s.message,
    why: s.message,
    confidence,
    insertText: s.actionableText && s.actionableText.startsWith("Insert:")
      ? s.actionableText.replace(/^Insert:\s*/, "").replace(/^['"]|['"]$/g, "")
      : undefined,
    insertTarget: s.actionableText?.startsWith("Insert:") ? "findings" : undefined,
  };
}

/**
 * Produce the full Copilot report for the current reporting context. Pure and
 * synchronous — safe to run on every (debounced) keystroke; the UI decides what
 * to show and never auto-applies anything.
 */
export function analyzeCopilot(ctx: CopilotContext): CopilotReport {
  const items: CopilotItem[] = [];
  const findingsLower = ctx.findings.toLowerCase();
  const impressionLower = ctx.impression.join("\n").toLowerCase();
  const selectedLower = ctx.selectedFindingLabels.map((l) => l.toLowerCase());
  const inFindings = (needle: string) => has(findingsLower, needle) || selectedLower.some((l) => l.includes(needle));

  // 1. Live findings analysis — reuse the existing observer engine verbatim.
  if (ctx.findings.trim()) {
    for (const s of observeReportText(ctx.modality, ctx.studyDescription, ctx.findings)) {
      items.push(fromLegacy(s));
    }
  }

  const study = ctx.studyDescription.toLowerCase();

  // 2. Missing observations (knowledge base).
  for (const r of MISSING_RULES) {
    if (r.studyIncludes && !study.includes(r.studyIncludes)) continue;
    if (!r.trigger.some((t) => inFindings(t))) continue;
    if (hasAny(findingsLower, r.satisfiedBy)) continue;
    items.push({
      id: `missing:${r.id}`, category: "missing", severity: "info",
      title: `Consider: ${r.observation}`, detail: `${r.observation} is commonly documented for this pattern but was not found.`,
      why: r.why, confidence: r.confidence,
    });
  }

  // 3. Contradictions.
  const combined = `${findingsLower}\n${impressionLower}`;
  for (const c of CONTRADICTION_PAIRS) {
    const normalHit = c.normal.find((n) => has(combined, n));
    const presentHit = c.present.find((p) => has(combined, p));
    if (normalHit && presentHit) {
      items.push({
        id: `contradiction:${c.id}`, category: "contradiction", severity: "critical",
        title: "Possible contradiction", detail: `The report contains ${c.label}.`,
        why: `“${normalHit}” and “${presentHit}” appear together — one is likely stale. Review rather than auto-change.`,
        confidence: "medium", matchText: presentHit,
      });
    }
  }

  // 4. Impression validator — important findings not carried into the impression.
  for (const f of IMPORTANT_FINDING_TERMS) {
    if (has(findingsLower, f.term) && ctx.impression.length > 0 && !has(impressionLower, f.term.split(" ")[0])) {
      items.push({
        id: `impression:${f.term.replace(/\s+/g, "-")}`, category: "impression", severity: "warning",
        title: "Finding not reflected in Impression", detail: `Findings mention ${f.label}, but the Impression does not.`,
        why: "The Impression should surface every clinically important finding so referrers act on it.",
        confidence: "medium",
      });
    }
  }
  // …and the reverse: an impression claim with no basis in findings.
  for (const f of IMPORTANT_FINDING_TERMS) {
    if (has(impressionLower, f.term) && ctx.findings.trim() && !has(findingsLower, f.term.split(" ")[0])) {
      items.push({
        id: `impression-basis:${f.term.replace(/\s+/g, "-")}`, category: "impression", severity: "warning",
        title: "Impression not described in Findings", detail: `The Impression states ${f.label}, but the Findings do not describe it.`,
        why: "Every impression conclusion should be traceable to a described finding.",
        confidence: "medium",
      });
    }
  }

  // 5. Recommendations / follow-ups.
  for (const r of RECOMMENDATION_RULES) {
    if (!r.trigger.some((t) => inFindings(t) || has(impressionLower, t))) continue;
    if (has(ctx.recommendation.toLowerCase(), r.text.toLowerCase().slice(0, 18))) continue;
    items.push({
      id: `recommendation:${r.id}`, category: "recommendation", severity: "info",
      title: "Suggested recommendation", detail: r.text, why: r.why, confidence: r.confidence,
      insertText: r.text, insertTarget: "recommendation",
    });
  }

  // 6. Differential diagnosis.
  for (const d of DIFFERENTIAL_RULES) {
    if (!d.trigger.some((t) => inFindings(t))) continue;
    items.push({
      id: `differential:${d.id}`, category: "differential", severity: "info",
      title: `Differential — ${d.title}`, detail: d.differentials.join(" · "),
      why: d.why, confidence: d.confidence,
    });
  }

  // 7. Measurement reminder — a lesion/mass with no size stated.
  const lesionMentioned = hasAny(findingsLower, ["lesion", "mass", "nodule", "tumour", "tumor"]);
  const sizeStated = /\b\d+(\.\d+)?\s*(mm|cm)\b/.test(findingsLower);
  if (lesionMentioned && !sizeStated) {
    items.push({
      id: "measurement:lesion-size", category: "measurement", severity: "warning",
      title: "Measure the lesion", detail: "A lesion/mass is described without a size. Consider size, enhancement, mass effect and oedema.",
      why: "Quantifying a lesion enables follow-up comparison and downstream management.",
      confidence: "high",
    });
  }

  // 8. Quality score (reuse computeQualityScore) → band.
  const q = computeQualityScore(toQualityInput(ctx));
  const band: QualityBand = q.score >= 85 ? "Excellent" : q.score >= 65 ? "Good" : "Needs Review";

  return { items: dedupe(items), quality: { score: q.score, band, issues: q.issues } };
}

function toQualityInput(ctx: CopilotContext): QualityInput {
  return {
    findings: ctx.findings,
    impression: ctx.impression,
    technique: ctx.technique,
    clinicalHistory: ctx.clinicalHistory,
    recommendation: ctx.recommendation,
    checklistPercent: ctx.checklistPercent,
    missingRequiredMeasurements: ctx.missingRequiredMeasurements,
  };
}

/** Stable de-dupe by id, preserving first occurrence and severity order. */
function dedupe(items: CopilotItem[]): CopilotItem[] {
  const seen = new Set<string>();
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return items
    .filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export const CATEGORY_LABEL: Record<CopilotCategory, string> = {
  critical: "Critical Results",
  suggestion: "Current Suggestions",
  missing: "Possible Missing Findings",
  contradiction: "Potential Issues",
  impression: "Impression Check",
  recommendation: "Recommendations",
  differential: "Differential Diagnosis",
  measurement: "Measurements",
};
