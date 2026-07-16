/**
 * clinicalRecommendations.ts — the CARE Clinical Recommendation Registry.
 *
 * ONE shared, data-driven registry of deterministic clinical recommendations —
 * NOT an engine. Every recommendation the platform surfaces (Copilot advisories,
 * Companion follow-up questions, the Follow-Up panel, Knowledge-Pack
 * recommendations) is an entry here; no recommendation is ever hardcoded inside
 * an MRI/USG/CT/X-Ray code path.
 *
 * Consumption model (reuse, no new engine):
 *  - `matchRecommendations()` is a pure lookup/filter over the registry (same
 *    stateless registry semantics as matchStudyRegion) fed by data the workspace
 *    ALREADY threads through CopilotContext: accepted viewer/quick measurements,
 *    previous-comparison significant changes, and report text.
 *  - Copilot consumes matches via copilotRecommendationModule (explains WHY —
 *    rationale/evidence/references in the existing `why` channel).
 *  - Companion consumes matches via `recommendationQuestions()` (asks useful
 *    follow-up questions; it does not create recommendations).
 *  - radiologyFollowUpEngine's FOLLOW_UP_DATABASE is now DERIVED from this
 *    registry (`legacyFollowUpDatabase()`), so the previously hardcoded
 *    follow-up conditions have a single source of truth.
 *  - Knowledge Packs ACTIVATE entries by pack id (`knowledgePackRefs`); packs do
 *    not duplicate the text.
 *
 * Deterministic only. No AI, no I/O, no state.
 */

export type RecommendationSeverity = "info" | "warning" | "critical";
export type RecommendationPriority = "routine" | "urgent" | "immediate";
export type EvidenceLevel = "guideline" | "consensus" | "local-policy";

/** Trigger conditions — all deterministic. */
export type RecommendationTrigger =
  | {
      kind: "measurement";
      /** Accepted measurement labels this trigger matches (case-insensitive). */
      labels: string[];
      comparator: ">" | ">=" | "<" | "<=";
      threshold: number;
      /** Unit the threshold is expressed in ("" = unitless ratio). */
      unit: "mm" | "cm" | "";
    }
  | {
      kind: "comparison";
      /** Prior-comparison measurement labels (matched against the existing
       *  radiologyComparison significant-change labels, case-insensitive). */
      labels: string[];
      direction: "increased" | "decreased" | "changed";
    }
  | {
      kind: "finding-text";
      /** Any of these phrases in findings/impression text (case-insensitive). */
      phrases: string[];
    }
  | {
      kind: "condition";
      /** Graded clinical condition, surfaced for explicit radiologist selection
       *  (the legacy Follow-Up panel flow) — never auto-inserted. */
      group: string;
      condition: string;
    };

export interface ClinicalRecommendation {
  /** Stable hierarchical id, e.g. rec.ct.kub.stone-urology */
  id: string;
  title: string;
  description: string;
  trigger: RecommendationTrigger;
  /** Measurement registry labels this recommendation reads (provenance). */
  measurementRefs: string[];
  /** Quality Engine rule ids (Q### / care.structured.*) this aligns with. */
  qualityRuleRefs: string[];
  /** Knowledge Packs that activate this entry (pack_id values). */
  knowledgePackRefs: string[];
  /** Modalities this entry can fire for ("*" = any). */
  modalities: string[];
  severity: RecommendationSeverity;
  priority: RecommendationPriority;
  evidenceLevel: EvidenceLevel;
  /** The recommended follow-up action + interval. */
  followUp: { action: string; interval: string };
  /** Rationale shown behind "Why?" — the explanation channel. */
  rationale: string;
  contraindications: string[];
  references: string[];
  /** Follow-up questions the Companion may ask when this entry matches. */
  followUpQuestions: string[];
  version: string;
}

export const CLINICAL_RECOMMENDATION_REGISTRY_VERSION = "1.0.0";

// ─────────────────────────────────────────────────────────────────────────────
// Measurement-threshold entries — reuse Quality-Engine measurement outputs.
// Labels match the seeded radiology_quick_measurements / viewer SR labels.
// ─────────────────────────────────────────────────────────────────────────────
const MEASUREMENT_ENTRIES: ClinicalRecommendation[] = [
  {
    id: "rec.ct.kub.stone-urology",
    title: "Ureteric/renal stone >6 mm — urology opinion",
    description: "Calculi larger than 6 mm are unlikely to pass spontaneously.",
    trigger: { kind: "measurement", labels: ["Stone size"], comparator: ">", threshold: 6, unit: "mm" },
    measurementRefs: ["Stone size"],
    qualityRuleRefs: ["care.structured.required.by-protocol"],
    knowledgePackRefs: ["ct.kub", "ct.urography"],
    modalities: ["CT", "USG"],
    severity: "warning",
    priority: "urgent",
    evidenceLevel: "guideline",
    followUp: { action: "Urology opinion", interval: "Early (days)" },
    rationale: "Stones >6 mm have a low spontaneous passage rate; intervention (MET review, lithotripsy, ureteroscopy) is often required.",
    contraindications: [],
    references: ["EAU Urolithiasis guidelines"],
    followUpQuestions: ["Stone location (level)?", "Hydronephrosis present?", "Stone density (HU)?"],
    version: "1.0.0",
  },
  {
    id: "rec.ct.brain.midline-neurosurgery",
    title: "Midline shift >5 mm — urgent neurosurgical review",
    description: "Midline shift beyond 5 mm indicates significant mass effect.",
    trigger: { kind: "measurement", labels: ["Midline shift"], comparator: ">", threshold: 5, unit: "mm" },
    measurementRefs: ["Midline shift"],
    qualityRuleRefs: ["care.structured.range.brain.midline-shift"],
    knowledgePackRefs: ["ct.brain_plain", "ct.brain_contrast", "ct.trauma"],
    modalities: ["CT", "MRI"],
    severity: "critical",
    priority: "immediate",
    evidenceLevel: "guideline",
    followUp: { action: "Urgent neurosurgical review", interval: "Immediate" },
    rationale: "Shift >5 mm correlates with raised intracranial pressure and herniation risk; time-critical surgical decompression may be needed.",
    contraindications: [],
    references: ["Marshall/Rotterdam CT classification (TBI)"],
    followUpQuestions: ["Cause of shift (hemorrhage/mass/edema)?", "Basal cisterns effaced?", "Herniation?"],
    version: "1.0.0",
  },
  {
    id: "rec.usg.abdomen.cbd-lft",
    title: "CBD >7 mm — correlate with LFT",
    description: "A dilated common bile duct needs biochemical correlation.",
    trigger: { kind: "measurement", labels: ["CBD diameter", "CBD"], comparator: ">", threshold: 7, unit: "mm" },
    measurementRefs: ["CBD diameter"],
    qualityRuleRefs: ["care.structured.unit.usg"],
    knowledgePackRefs: ["usg.whole_abdomen"],
    modalities: ["USG", "CT", "MRI"],
    severity: "warning",
    priority: "routine",
    evidenceLevel: "consensus",
    followUp: { action: "Correlate with liver function tests; consider MRCP if obstructed", interval: "Days" },
    rationale: "CBD >7 mm (age/cholecystectomy adjusted) suggests biliary obstruction; LFTs distinguish obstructive from non-obstructive causes.",
    contraindications: ["Post-cholecystectomy mild dilatation may be normal"],
    references: ["Standard biliary sonography criteria"],
    followUpQuestions: ["Intrahepatic ducts dilated?", "Calculus or mass at the ampulla?", "Prior cholecystectomy?"],
    version: "1.0.0",
  },
  {
    id: "rec.ct.chest.nodule-fleischner",
    title: "Pulmonary nodule — Fleischner guidance",
    description: "Incidental nodule ≥6 mm requires Fleischner-based follow-up.",
    trigger: { kind: "measurement", labels: ["Nodule size"], comparator: ">=", threshold: 6, unit: "mm" },
    measurementRefs: ["Nodule size"],
    qualityRuleRefs: ["care.structured.required.ct.by-protocol"],
    knowledgePackRefs: ["ct.chest_plain", "ct.hrct_chest"],
    modalities: ["CT"],
    severity: "warning",
    priority: "routine",
    evidenceLevel: "guideline",
    followUp: { action: "CT chest follow-up per Fleischner 2017 (risk-stratified)", interval: "3–12 months by risk" },
    rationale: "Fleischner Society guidance stratifies incidental nodule surveillance by size, morphology and patient risk; ≥6 mm warrants scheduled follow-up.",
    contraindications: ["Not applicable to known malignancy or immunocompromise (separate pathways)"],
    references: ["Fleischner Society 2017 incidental nodule guidelines"],
    followUpQuestions: ["Solid or subsolid?", "Margins (smooth/spiculated)?", "Patient risk factors?"],
    version: "1.0.0",
  },
  {
    id: "rec.xr.chest.ctr-correlation",
    title: "CTR >0.5 — clinical correlation",
    description: "Cardiothoracic ratio above 0.5 on a PA film suggests cardiomegaly.",
    trigger: { kind: "measurement", labels: ["Cardiothoracic ratio"], comparator: ">", threshold: 0.5, unit: "" },
    measurementRefs: ["Cardiothoracic ratio"],
    qualityRuleRefs: ["care.structured.required.xr.by-protocol"],
    knowledgePackRefs: ["xr.chest_pa"],
    modalities: ["X-RAY"],
    severity: "info",
    priority: "routine",
    evidenceLevel: "consensus",
    followUp: { action: "Clinical correlation; echocardiography if clinically indicated", interval: "Routine" },
    rationale: "CTR >0.5 (PA, adequate inspiration) is the accepted radiographic threshold for cardiomegaly; AP films overestimate.",
    contraindications: ["AP/portable projection overestimates CTR"],
    references: ["Standard chest radiography criteria"],
    followUpQuestions: ["PA or AP projection?", "Pulmonary congestion or effusion?"],
    version: "1.0.0",
  },
  {
    id: "rec.usg.ob.crl-dating",
    title: "CRL inconsistent with dates — review dating",
    description: "Crown-rump length discordant with LMP-based gestational age.",
    trigger: { kind: "finding-text", phrases: ["crl inconsistent", "dates discrepancy", "discordant with lmp", "redating"] },
    measurementRefs: ["crl"],
    qualityRuleRefs: ["care.structured.range.fetal"],
    knowledgePackRefs: ["usg.nt", "usg.anomaly"],
    modalities: ["USG"],
    severity: "warning",
    priority: "routine",
    evidenceLevel: "guideline",
    followUp: { action: "Review pregnancy dating; establish EDD from first-trimester CRL", interval: "This visit" },
    rationale: "First-trimester CRL is the most accurate dating method; discordance >5–7 days from LMP dates warrants re-dating per obstetric guidelines.",
    contraindications: [],
    references: ["ISUOG first-trimester guidelines"],
    followUpQuestions: ["LMP reliable?", "Earlier scan available for dating?"],
    version: "1.0.0",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Comparison-triggered entries — reuse Previous Comparison significant changes.
// ─────────────────────────────────────────────────────────────────────────────
const COMPARISON_ENTRIES: ClinicalRecommendation[] = [
  {
    id: "rec.cmp.stone-progression",
    title: "Stone increased vs prior — document interval progression",
    description: "Calculus larger than on the previous study.",
    trigger: { kind: "comparison", labels: ["Stone size"], direction: "increased" },
    measurementRefs: ["Stone size"],
    qualityRuleRefs: [],
    knowledgePackRefs: ["ct.kub", "ct.urography"],
    modalities: ["CT", "USG"],
    severity: "warning",
    priority: "routine",
    evidenceLevel: "consensus",
    followUp: { action: "State interval progression explicitly; urology review of management", interval: "Days" },
    rationale: "Interval growth changes management (observation vs intervention); the report should quantify the change against the prior.",
    contraindications: [],
    references: ["EAU Urolithiasis guidelines"],
    followUpQuestions: ["New hydronephrosis compared with prior?"],
    version: "1.0.0",
  },
  {
    id: "rec.cmp.nodule-growth",
    title: "Pulmonary nodule grew — follow-up CT",
    description: "Nodule larger than on the previous CT.",
    trigger: { kind: "comparison", labels: ["Nodule size"], direction: "increased" },
    measurementRefs: ["Nodule size"],
    qualityRuleRefs: [],
    knowledgePackRefs: ["ct.chest_plain", "ct.hrct_chest", "ct.oncology_followup"],
    modalities: ["CT"],
    severity: "critical",
    priority: "urgent",
    evidenceLevel: "guideline",
    followUp: { action: "Short-interval follow-up CT / PET-CT or biopsy per Fleischner growth pathway", interval: "≤3 months" },
    rationale: "Demonstrated growth is the strongest single predictor of malignancy in a pulmonary nodule; growth exits routine surveillance.",
    contraindications: [],
    references: ["Fleischner Society 2017 incidental nodule guidelines"],
    followUpQuestions: ["Volume-doubling time estimable?", "New nodules elsewhere?"],
    version: "1.0.0",
  },
  {
    id: "rec.cmp.disc-worsened",
    title: "Disc herniation worsened — correlate with symptoms",
    description: "Interval worsening of a disc herniation vs the prior study.",
    trigger: { kind: "comparison", labels: ["Disc protrusion", "Canal diameter"], direction: "changed" },
    measurementRefs: ["Canal diameter"],
    qualityRuleRefs: [],
    knowledgePackRefs: ["ct.lumbar_spine", "ct.cervical_spine"],
    modalities: ["MRI", "CT"],
    severity: "warning",
    priority: "routine",
    evidenceLevel: "consensus",
    followUp: { action: "Correlate with current symptoms and neurological examination", interval: "This visit" },
    rationale: "Imaging progression only matters alongside the clinical picture; management is symptom-led, so the report should invite correlation.",
    contraindications: [],
    references: ["NASS lumbar disc herniation guidance"],
    followUpQuestions: ["New or progressive neurological deficit?"],
    version: "1.0.0",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Graded condition entries — the single source for the (previously hardcoded)
// Follow-Up panel database. Compact constructor keeps them reviewable.
// ─────────────────────────────────────────────────────────────────────────────
function cond(
  group: string, slug: string, condition: string, action: string, interval: string,
  priority: RecommendationPriority, rationale: string, packs: string[], modalities: string[],
): ClinicalRecommendation {
  const severity: RecommendationSeverity =
    priority === "immediate" ? "critical" : priority === "urgent" ? "warning" : "info";
  return {
    id: `rec.cond.${group}.${slug}`,
    title: condition,
    description: condition,
    trigger: { kind: "condition", group, condition },
    measurementRefs: [], qualityRuleRefs: [], knowledgePackRefs: packs, modalities,
    severity, priority, evidenceLevel: "consensus",
    followUp: { action, interval },
    rationale, contraindications: [], references: [], followUpQuestions: [],
    version: "1.0.0",
  };
}

const CONDITION_ENTRIES: ClinicalRecommendation[] = [
  cond("meningioma", "small", "Meningioma — Small, asymptomatic", "MRI Brain", "6-12 months", "routine", "Monitor growth. If stable, extend interval.", [], ["MRI", "CT"]),
  cond("meningioma", "large", "Meningioma — Large / symptomatic", "Neurosurgical referral", "Immediate", "urgent", "Symptomatic or large lesions require surgical evaluation.", [], ["MRI", "CT"]),
  cond("meningioma", "atypical", "Meningioma — Atypical / anaplastic", "MRI + oncology referral", "3 months", "urgent", "Atypical/anaplastic variants require aggressive surveillance.", [], ["MRI", "CT"]),
  cond("bi-rads-3", "default", "BI-RADS 3 — Probably benign", "Mammogram / Ultrasound", "6 months", "routine", "Short-interval follow-up to confirm stability.", ["usg.breast"], ["USG"]),
  cond("bi-rads-4", "default", "BI-RADS 4 — Suspicious", "Biopsy", "Immediate", "urgent", "Tissue diagnosis required.", ["usg.breast"], ["USG"]),
  cond("bi-rads-5", "default", "BI-RADS 5 — Highly suspicious", "Biopsy + staging", "Immediate", "urgent", "High probability of malignancy. Tissue diagnosis and staging.", ["usg.breast"], ["USG"]),
  cond("disc-prolapse", "mild", "Disc prolapse — Mild, no neurologic deficit", "Conservative management + follow-up MRI", "6-12 weeks", "routine", "Conservative management: physiotherapy, NSAIDs.", ["ct.lumbar_spine"], ["MRI", "CT"]),
  cond("disc-prolapse", "severe", "Disc prolapse — Severe / progressive deficit", "Neurosurgical / orthopedic referral", "Immediate", "urgent", "Progressive neurologic deficit requires surgical evaluation.", ["ct.lumbar_spine"], ["MRI", "CT"]),
  cond("cervical-stenosis", "mild", "Cervical canal stenosis — Mild", "Clinical follow-up", "6 months", "routine", "Monitor for progression.", ["ct.cervical_spine"], ["MRI", "CT"]),
  cond("cervical-stenosis", "moderate", "Cervical canal stenosis — Moderate", "MRI + neurosurgical referral", "3 months", "urgent", "Moderate stenosis may require surgical decompression.", ["ct.cervical_spine"], ["MRI", "CT"]),
  cond("cervical-stenosis", "severe", "Cervical canal stenosis — Severe / cord signal change", "Urgent neurosurgical referral", "Immediate", "immediate", "Severe stenosis with cord signal change is high risk for myelopathy.", ["ct.cervical_spine"], ["MRI", "CT"]),
  cond("lumbar-stenosis", "mild", "Lumbar canal stenosis — Mild", "Conservative management", "6 months", "routine", "Physiotherapy, activity modification.", ["ct.lumbar_spine"], ["MRI", "CT"]),
  cond("lumbar-stenosis", "severe", "Lumbar canal stenosis — Severe", "Neurosurgical referral", "2-4 weeks", "urgent", "Severe stenosis may require surgical decompression.", ["ct.lumbar_spine"], ["MRI", "CT"]),
  cond("hcc", "small", "HCC — Small (<2 cm)", "MRI + hepatology referral", "1-3 months", "urgent", "Small HCC: consider ablation/resection.", ["ct.cect_abdomen"], ["USG", "CT", "MRI"]),
  cond("hcc", "intermediate", "HCC — Intermediate (2-5 cm)", "Multidisciplinary tumor board", "2 weeks", "urgent", "Intermediate HCC: consider resection, TACE, or transplant.", ["ct.cect_abdomen"], ["USG", "CT", "MRI"]),
  cond("hcc", "large", "HCC — Large (>5 cm) / multifocal", "Staging + oncology referral", "Immediate", "urgent", "Large/multifocal HCC requires comprehensive staging.", ["ct.cect_abdomen"], ["USG", "CT", "MRI"]),
  cond("renal-mass", "bosniak-2f", "Renal mass — Bosniak IIF", "CT/MRI", "6 months", "routine", "Bosniak IIF requires surveillance for progression.", ["ct.cect_abdomen"], ["USG", "CT", "MRI"]),
  cond("renal-mass", "bosniak-3", "Renal mass — Bosniak III", "Urological referral + surgical evaluation", "Immediate", "urgent", "Bosniak III has significant malignancy risk.", ["ct.cect_abdomen"], ["USG", "CT", "MRI"]),
  cond("renal-mass", "bosniak-4", "Renal mass — Bosniak IV", "Urological referral + surgical evaluation", "Immediate", "urgent", "Bosniak IV is highly suspicious for malignancy.", ["ct.cect_abdomen"], ["USG", "CT", "MRI"]),
  cond("thyroid-nodule", "tirads-3", "Thyroid nodule — TI-RADS 3", "Ultrasound", "12 months", "routine", "Low suspicion. Annual surveillance.", ["usg.thyroid"], ["USG"]),
  cond("thyroid-nodule", "tirads-4", "Thyroid nodule — TI-RADS 4", "FNA biopsy", "Immediate", "urgent", "Moderate suspicion. Tissue diagnosis required.", ["usg.thyroid"], ["USG"]),
  cond("thyroid-nodule", "tirads-5", "Thyroid nodule — TI-RADS 5", "FNA biopsy + endocrine referral", "Immediate", "urgent", "High suspicion. Tissue diagnosis and management.", ["usg.thyroid"], ["USG"]),
  cond("pulmonary-nodule", "small", "Pulmonary nodule — <6 mm, low risk", "CT Chest", "12 months", "routine", "Low risk nodule: annual surveillance.", ["ct.chest_plain", "ct.hrct_chest"], ["CT", "X-RAY"]),
  cond("pulmonary-nodule", "intermediate", "Pulmonary nodule — 6-8 mm", "CT Chest", "3-6 months", "routine", "Intermediate size: short interval to confirm stability.", ["ct.chest_plain", "ct.hrct_chest"], ["CT", "X-RAY"]),
  cond("pulmonary-nodule", "large", "Pulmonary nodule — >8 mm or suspicious", "CT + PET-CT / biopsy", "Immediate", "urgent", "Large or suspicious nodule requires further evaluation.", ["ct.chest_plain", "ct.hrct_chest"], ["CT", "X-RAY"]),
  cond("aortic-aneurysm", "under-3", "AAA — <3 cm", "Ultrasound", "5 years", "routine", "Small AAA: low rupture risk.", ["usg.whole_abdomen"], ["USG", "CT"]),
  cond("aortic-aneurysm", "3-to-4", "AAA — 3-3.9 cm", "Ultrasound", "12 months", "routine", "Moderate size: annual surveillance.", ["usg.whole_abdomen"], ["USG", "CT"]),
  cond("aortic-aneurysm", "4-to-5", "AAA — 4-4.9 cm", "Ultrasound / CT", "6 months", "routine", "Larger size: more frequent surveillance.", ["usg.whole_abdomen"], ["USG", "CT"]),
  cond("aortic-aneurysm", "over-5", "AAA — >5 cm or rapid growth", "Vascular surgical referral", "Immediate", "urgent", "Large or rapidly growing AAA requires intervention.", ["usg.whole_abdomen"], ["USG", "CT"]),
  cond("gallbladder-polyp", "small", "Gallbladder polyp — <6 mm", "Ultrasound", "12 months", "routine", "Small polyp: low malignancy risk.", ["usg.whole_abdomen"], ["USG"]),
  cond("gallbladder-polyp", "intermediate", "Gallbladder polyp — 6-10 mm", "Ultrasound", "6 months", "routine", "Intermediate size: surveillance.", ["usg.whole_abdomen"], ["USG"]),
  cond("gallbladder-polyp", "large", "Gallbladder polyp — >10 mm or sessile", "Surgical referral", "Immediate", "urgent", "Large or sessile polyp: high malignancy risk.", ["usg.whole_abdomen"], ["USG"]),
  cond("hepatic-hemangioma", "typical", "Hepatic hemangioma — Typical, <5 cm", "None", "N/A", "routine", "Typical hemangioma: no follow-up needed.", ["usg.whole_abdomen"], ["USG", "CT", "MRI"]),
  cond("hepatic-hemangioma", "large", "Hepatic hemangioma — >5 cm or atypical", "MRI / follow-up", "6-12 months", "routine", "Large or atypical: confirm stability.", ["usg.whole_abdomen"], ["USG", "CT", "MRI"]),
  cond("fibroadenoma", "classic", "Fibroadenoma — Classic, <3 cm", "Ultrasound", "12 months", "routine", "Classic fibroadenoma: annual surveillance.", ["usg.breast"], ["USG"]),
  cond("fibroadenoma", "large", "Fibroadenoma — >3 cm or complex", "Biopsy / excision", "Immediate", "urgent", "Large or complex: tissue diagnosis.", ["usg.breast"], ["USG"]),
  cond("ovarian-cyst", "simple-small", "Simple ovarian cyst — <5 cm, premenopausal", "Ultrasound", "2-3 months", "routine", "Simple cyst: likely physiological.", ["usg.pelvis", "usg.tvs"], ["USG"]),
  cond("ovarian-cyst", "simple-large", "Simple ovarian cyst — >5 cm or postmenopausal", "MRI / follow-up", "3 months", "routine", "Large or postmenopausal: further evaluation.", ["usg.pelvis", "usg.tvs"], ["USG"]),
  cond("ovarian-cyst", "complex", "Complex ovarian cyst", "MRI + gynecology referral", "Immediate", "urgent", "Complex cyst: rule out malignancy.", ["usg.pelvis", "usg.tvs"], ["USG"]),
  cond("pancreatic-cyst", "small", "Pancreatic cyst — <2 cm, no features", "MRI/MRCP", "12 months", "routine", "Small cyst: surveillance.", ["ct.cect_abdomen"], ["CT", "MRI", "USG"]),
  cond("pancreatic-cyst", "high-risk", "Pancreatic cyst — >2 cm or high-risk features", "EUS + surgical referral", "Immediate", "urgent", "Large or high-risk features: tissue diagnosis.", ["ct.cect_abdomen"], ["CT", "MRI", "USG"]),
  cond("prostate-lesion", "pirads-3", "PI-RADS 3", "MRI + clinical correlation", "6 months", "routine", "Equivocal: short interval follow-up.", [], ["MRI"]),
  cond("prostate-lesion", "pirads-4", "PI-RADS 4", "Targeted biopsy", "Immediate", "urgent", "Likely clinically significant cancer.", [], ["MRI"]),
  cond("prostate-lesion", "pirads-5", "PI-RADS 5", "Targeted biopsy + staging", "Immediate", "urgent", "Highly likely clinically significant cancer.", [], ["MRI"]),
];

export const CLINICAL_RECOMMENDATION_REGISTRY: ClinicalRecommendation[] = [
  ...MEASUREMENT_ENTRIES,
  ...COMPARISON_ENTRIES,
  ...CONDITION_ENTRIES,
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure registry lookup — NOT an engine. Same stateless semantics as
// matchStudyRegion: input in, matched entries out. No I/O, no state.
// ─────────────────────────────────────────────────────────────────────────────
export interface RecommendationInput {
  modality: string;
  /** Accepted measurements (viewer/quick), as already threaded to Copilot. */
  measurements: { label: string; value: number; unit: string }[];
  /** Report free text (findings + impression), for finding-text triggers. */
  reportText: string;
  /** Previous-comparison significant changes (existing comparison output). */
  priorChanges: { label: string; deltaText: string }[];
}

export interface RecommendationMatch {
  recommendation: ClinicalRecommendation;
  /** Human-readable statement of what matched (evidence, never hidden logic). */
  matchedBecause: string;
}

const norm = (s: string) => (s ?? "").trim().toLowerCase();

/** mm/cm reconciliation (same convention as the Quality Engine executors). */
function toUnit(value: number, from: string, to: "mm" | "cm" | ""): number | null {
  const f = norm(from), t = to;
  if (t === "" || f === t || f === "") return value;
  if (f === "mm" && t === "cm") return value / 10;
  if (f === "cm" && t === "mm") return value * 10;
  return null; // incompatible units — never guess
}

function cmp(value: number, comparator: string, threshold: number): boolean {
  switch (comparator) {
    case ">": return value > threshold;
    case ">=": return value >= threshold;
    case "<": return value < threshold;
    case "<=": return value <= threshold;
    default: return false;
  }
}

export function matchRecommendations(input: RecommendationInput): RecommendationMatch[] {
  const modality = norm(input.modality);
  const text = norm(input.reportText);
  const out: RecommendationMatch[] = [];

  for (const rec of CLINICAL_RECOMMENDATION_REGISTRY) {
    // Modality scope: "*" or bidirectional prefix match on the letters-only
    // form, so spelling variants agree ("US" ↔ "USG", "X-RAY" ↔ "XRAY" ↔ "XR").
    if (!modality) continue;
    const letters = (s: string) => norm(s).replace(/[^a-z]/g, "");
    const mv = letters(modality);
    const inScope = rec.modalities.includes("*")
      || rec.modalities.some((m) => mv.startsWith(letters(m)) || letters(m).startsWith(mv));
    if (!inScope) continue;

    const t = rec.trigger;
    if (t.kind === "measurement") {
      for (const m of input.measurements) {
        if (!t.labels.some((l) => norm(l) === norm(m.label))) continue;
        const v = toUnit(m.value, m.unit, t.unit);
        if (v === null) continue; // incompatible unit — notEvaluated, never guess
        if (cmp(v, t.comparator, t.threshold)) {
          out.push({
            recommendation: rec,
            matchedBecause: `${m.label} ${m.value}${m.unit || ""} ${t.comparator} ${t.threshold}${t.unit || ""}`,
          });
          break;
        }
      }
    } else if (t.kind === "comparison") {
      for (const c of input.priorChanges) {
        if (!t.labels.some((l) => norm(c.label).includes(norm(l)))) continue;
        const delta = norm(c.deltaText);
        const dirOk = t.direction === "changed"
          || (t.direction === "increased" && /(increase|larger|grew|progress|worsen|\+)/.test(delta))
          || (t.direction === "decreased" && /(decrease|smaller|regress|improved|-)/.test(delta));
        if (dirOk) {
          out.push({ recommendation: rec, matchedBecause: `${c.label} ${c.deltaText} vs prior` });
          break;
        }
      }
    } else if (t.kind === "finding-text") {
      const hit = t.phrases.find((p) => text.includes(norm(p)));
      if (hit) out.push({ recommendation: rec, matchedBecause: `report mentions "${hit}"` });
    }
    // kind === "condition": surfaced via the Follow-Up panel on explicit
    // radiologist selection — never auto-matched from data.
  }
  return out;
}

/** Companion consumption — the Companion asks questions; it never creates
 *  recommendations. Returns the registry's follow-up questions for matches. */
export function recommendationQuestions(matches: RecommendationMatch[]): { id: string; question: string }[] {
  const out: { id: string; question: string }[] = [];
  for (const m of matches) {
    for (const q of m.recommendation.followUpQuestions) {
      out.push({ id: `${m.recommendation.id}:${q}`, question: q });
    }
  }
  return out;
}

/** Legacy derivation — the Follow-Up panel's database, now built FROM the
 *  registry so the conditions have a single source of truth. */
export function legacyFollowUpDatabase(): Record<string, { condition: string; followUp: string; interval: string; priority: string; rationale: string }[]> {
  const db: Record<string, { condition: string; followUp: string; interval: string; priority: string; rationale: string }[]> = {};
  for (const rec of CLINICAL_RECOMMENDATION_REGISTRY) {
    if (rec.trigger.kind !== "condition") continue;
    const g = rec.trigger.group;
    if (!db[g]) db[g] = [];
    db[g].push({
      condition: rec.trigger.condition,
      followUp: rec.followUp.action,
      interval: rec.followUp.interval,
      // The legacy shape used "critical" for the highest tier; preserve it.
      priority: rec.priority === "immediate" ? "critical" : rec.priority,
      rationale: rec.rationale,
    });
  }
  return db;
}
