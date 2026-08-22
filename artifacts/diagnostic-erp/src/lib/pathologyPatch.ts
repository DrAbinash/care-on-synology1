/**
 * pathologyPatch.ts — smart pathology overlays on a whole-report draft.
 *
 * Reuses reportFieldMerge sentence split/dedupe and provenance rules.
 * A Quick Select / macro patch owns an anatomical block (anatomicalSection /
 * conflictGroup / baselineReplaces — already on clinic Quick Findings).
 * Matching normal or contradictory sentences in Findings/Impression are
 * replaced; unrelated and manually edited sentences are left alone.
 */

import {
  mergeReportFieldContentWithProvenance,
  normalizeForDedupe,
  splitToSentences,
  type FieldProvenanceMap,
  type InsertSource,
} from "./reportFieldMerge";
import { applySide, type Side } from "./sideSwap";
import { fillTemplate, type AbnormalityInstance } from "./abnormalityEngine";
import { stripNormalImpressionLines } from "./quickFindingsMerge";

export type PathologyOwnership = {
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
};

export type ReportNarrative = {
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
};

export type NarrativeProvenance = Partial<Record<keyof ReportNarrative, FieldProvenanceMap>>;

export type PathologyIncoming = {
  findings?: string;
  impression?: string;
  technique?: string;
  recommendation?: string;
};

const ANATOMY_ALIASES: Array<{ key: string; re: RegExp }> = [
  // Brain / CNS
  { key: "basal ganglia", re: /basal ganglia|putamen|caudate|globus pallidus|internal capsule/i },
  { key: "white matter", re: /white matter|fazekas|periventricular/i },
  { key: "mca", re: /\bmca\b|middle cerebral/i },
  { key: "ventricle", re: /ventricular system|ventricles|cisternal/i },
  // Spine
  { key: "disc", re: /\bdisc\b|herniation|bulge/i },
  { key: "cord", re: /spinal cord|thecal sac|canal stenosis/i },
  // Abdomen / USG organs
  { key: "liver", re: /\bliver\b|hepatic|hepatomegaly/i },
  { key: "gallbladder", re: /\bgallbladder\b|gall bladder|cholecyst/i },
  { key: "cbd", re: /\bcbd\b|common bile duct|choledoch/i },
  { key: "pancreas", re: /\bpancreas\b|pancreatic/i },
  { key: "spleen", re: /\bspleen\b|splenic/i },
  { key: "kidney", re: /\bkidney\b|renal|kidneys/i },
  { key: "ureter", re: /\bureter\b|ureteric/i },
  { key: "bladder", re: /\bbladder\b|urinary bladder|vesical/i },
  { key: "prostate", re: /\bprostate\b|prostatic/i },
  { key: "uterus", re: /\buterus\b|uterine|endometri/i },
  { key: "ovary", re: /\bovary\b|ovarian|adnexa/i },
  { key: "appendix", re: /\bappendix\b|appendiceal|vermiform/i },
  { key: "bowel", re: /\bbowel\b|intestin|colon|sigmoid|rectum/i },
  { key: "aorta", re: /\baorta\b|aortic/i },
  { key: "thyroid", re: /\bthyroid\b|thyroidal/i },
  { key: "breast", re: /\bbreast\b|mammary/i },
];

const PATHOLOGY_TERMS = [
  // Severe / acute
  "hemorrhage", "haemorrhage", "infarct", "restricted diffusion",
  "herniation", "stenosis", "fracture", "mass", "tumor", "tumour", "lesion",
  // USG-common abnormalities
  "fatty liver", "fatty infiltration", "hepatomegaly", "cholelithiasis",
  "cholecystitis", "sludge", "polyp", "cyst", "calculus", "calculi",
  "nephrolith", "nephrolithiasis", "hydronephrosis", "hydroureter",
  "prostatomegaly", "pyelonephritis", "cystitis", "ascites",
  "pleural effusion", " collection", "abscess", "pancreatitis",
  "appendicitis", "obstruction", "perforation", "metastasis",
  "cirrhosis", "fibrosis", "echogenic", "hypoechoic",
  "hyperechoic", "heterogeneous", "focal", "nodule",
];

const DENIAL = /\b(no|without|absence of|unremarkable|normal|not identified|not seen|free of|no evidence|no definite|no obvious|no apparent|no focal|no significant|no abnormal|no mass|no lesion|no collection|no effusion|no hernia|no fracture|no displacement)\b/i;

export function inferOwnership(label: string, texts: string[]): PathologyOwnership {
  // Legacy fallback only — prefer explicit Quick Select / chocolate metadata.
  // Do not call this to auto-persist clinically significant ownership.
  const hay = `${label}\n${texts.join("\n")}`;
  for (const a of ANATOMY_ALIASES) {
    if (a.re.test(hay)) return { anatomicalSection: a.key, conflictGroup: a.key };
  }
  const term = PATHOLOGY_TERMS.find((t) => hay.toLowerCase().includes(t));
  if (term) return { conflictGroup: term };
  return { anatomicalSection: (label || "").trim() || undefined };
}

function anatomyKeys(ownership: PathologyOwnership, incoming: string): string[] {
  const keys = new Set<string>();
  const section = (ownership.anatomicalSection ?? "").trim().toLowerCase();
  if (section) keys.add(section);
  const group = (ownership.conflictGroup ?? "").trim().toLowerCase();
  if (group) keys.add(group);
  for (const a of ANATOMY_ALIASES) {
    if (a.re.test(incoming) || (section && a.re.test(section))) keys.add(a.key);
  }
  return [...keys];
}

function sentenceMentions(sentence: string, keys: string[]): boolean {
  const s = sentence.toLowerCase();
  return keys.some((k) => k.length >= 3 && s.includes(k));
}

function assertedPathology(text: string): string[] {
  const lower = text.toLowerCase();
  return PATHOLOGY_TERMS.filter((t) => {
    if (!lower.includes(t)) return false;
    const idx = lower.indexOf(t);
    const window = lower.slice(Math.max(0, idx - 40), idx);
    return !DENIAL.test(window);
  });
}

function deniesPathology(sentence: string, terms: string[]): boolean {
  const lower = sentence.toLowerCase();
  return terms.some((t) => lower.includes(t) && DENIAL.test(lower));
}

function isManualSentence(sentence: string, provenance: FieldProvenanceMap | undefined): boolean {
  const key = normalizeForDedupe(sentence);
  const src = provenance?.[key];
  if (!src || src.length === 0) return false;
  return src.length === 1 && src[0] === "manual";
}

/** Template/protocol-sourced sentences should always be replaceable by pathology.
 * Only purely manual sentences need the ambiguous/force guard.
 */
function isProtectedManualSentence(sentence: string, provenance: FieldProvenanceMap | undefined): boolean {
  const key = normalizeForDedupe(sentence);
  const src = provenance?.[key];
  if (!src || src.length === 0) return false;
  // If any source is manual AND no other source contributed, it's a protected manual edit.
  // Template/protocol/quick-select-sourced sentences are always eligible for replacement.
  if (src.length === 1 && src[0] === "manual") return true;
  // If manual co-exists with other sources, the radiologist edited a template line — protect it.
  if (src.includes("manual")) return true;
  return false;
}

export function applySideToIncoming(incoming: PathologyIncoming, side: Side | ""): PathologyIncoming {
  if (!side) return incoming;
  const inst: AbnormalityInstance = {
    side, severity: "", chronicity: "", level: "", value: "",
  };
  const fill = (t?: string) => {
    if (!t) return t;
    if (t.includes("{side}")) return fillTemplate(t, inst);
    return applySide(t, side);
  };
  return {
    findings: fill(incoming.findings),
    impression: fill(incoming.impression),
    technique: fill(incoming.technique),
    recommendation: fill(incoming.recommendation),
  };
}

export interface PathologyPatchResult {
  narrative: ReportNarrative;
  provenance: NarrativeProvenance;
  /** True when a manually edited anatomy sentence would have been replaced. */
  ambiguous: boolean;
  replacedSentences: string[];
}

/**
 * Overlay pathology text onto a whole-report narrative.
 * Never drops unrelated sentences. Manual anatomy sentences are kept and
 * flagged `ambiguous` so the existing overwrite dialog can confirm.
 */
export function applyPathologyPatch(opts: {
  existing: ReportNarrative;
  incoming: PathologyIncoming;
  ownership: PathologyOwnership;
  provenance?: NarrativeProvenance;
  source?: InsertSource;
  /** When true, replace matching manually edited anatomy sentences. */
  force?: boolean;
}): PathologyPatchResult {
  const source: InsertSource = opts.source ?? "quick-findings";
  const incomingHay = [
    opts.incoming.findings, opts.incoming.impression,
    opts.incoming.technique, opts.incoming.recommendation,
  ].filter(Boolean).join("\n");
  const keys = anatomyKeys(opts.ownership, incomingHay);
  const asserted = assertedPathology(incomingHay);
  const baseline = (opts.ownership.baselineReplaces ?? "").trim();
  let ambiguous = false;
  const replacedSentences: string[] = [];

  const patchField = (
    field: "findings" | "impression",
    existing: string,
    incoming: string | undefined,
    provenance: FieldProvenanceMap | undefined,
  ): { text: string; provenance: FieldProvenanceMap } => {
    const kept: string[] = [];
    // Extract organ keys from incoming text for broad anatomical matching
    const incomingOrgans = new Set<string>();
    for (const a of ANATOMY_ALIASES) {
      if (a.re.test(incomingHay)) incomingOrgans.add(a.key);
    }
    for (const s of splitToSentences(existing)) {
      const owned = (baseline && s.includes(baseline))
        || sentenceMentions(s, keys)
        || (asserted.length > 0 && deniesPathology(s, asserted))
        // Broad organ match: if incoming text targets liver and existing sentence
        // also mentions liver, replace the normal sentence (even without explicit ownership)
        || (incomingOrgans.size > 0 && asserted.length > 0 &&
            [...incomingOrgans].some((org) => sentenceMentions(s, [org])));
      if (!owned) {
        kept.push(s);
        continue;
      }
      if (isProtectedManualSentence(s, provenance) && !opts.force) {
        ambiguous = true;
        kept.push(s);
        continue;
      }
      replacedSentences.push(s);
    }
    const keptText = kept.join("\n");
    const keptProv: FieldProvenanceMap = {};
    for (const s of kept) {
      const k = normalizeForDedupe(s);
      if (k && provenance?.[k]) keptProv[k] = provenance[k]!;
    }
    if (!incoming?.trim()) {
      return { text: keptText, provenance: keptProv };
    }
    return mergeReportFieldContentWithProvenance({
      field,
      existing: keptText,
      incoming,
      source,
      existingProvenance: keptProv,
    });
  };

  const findings = patchField(
    "findings",
    opts.existing.findings,
    opts.incoming.findings,
    opts.provenance?.findings,
  );

  const impressionIncoming = opts.incoming.impression ?? "";
  const impression = patchField(
    "impression",
    opts.existing.impression,
    impressionIncoming || undefined,
    opts.provenance?.impression,
  );
  let impressionText = impression.text;
  // Strip normal impression lines whenever the incoming text contains
  // abnormal content (pathology terms OR non-empty abnormal findings text
  // that replaces template normals). Also strip when the patch replaced
  // any existing sentences (indicating template normal was overridden).
  const hasAbnormalContent = asserted.length > 0 || replacedSentences.length > 0;
  if (hasAbnormalContent) {
    impressionText = stripNormalImpressionLines(
      splitToSentences(impressionText),
      { onlyIfAbnormal: true },
    ).join("\n");
  }

  const technique = opts.incoming.technique?.trim()
    ? mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: opts.existing.technique,
      incoming: opts.incoming.technique,
      source,
      existingProvenance: opts.provenance?.technique ?? {},
    })
    : { text: opts.existing.technique, provenance: opts.provenance?.technique ?? {} };

  const recommendation = opts.incoming.recommendation?.trim()
    ? mergeReportFieldContentWithProvenance({
      field: "recommendation",
      existing: opts.existing.recommendation,
      incoming: opts.incoming.recommendation,
      source,
      existingProvenance: opts.provenance?.recommendation ?? {},
    })
    : { text: opts.existing.recommendation, provenance: opts.provenance?.recommendation ?? {} };

  return {
    narrative: {
      clinicalHistory: opts.existing.clinicalHistory,
      technique: technique.text,
      findings: findings.text,
      impression: impressionText,
      recommendation: recommendation.text,
    },
    provenance: {
      clinicalHistory: opts.provenance?.clinicalHistory,
      technique: technique.provenance,
      findings: findings.provenance,
      impression: impression.provenance,
      recommendation: recommendation.provenance,
    },
    ambiguous,
    replacedSentences,
  };
}

/** Exact-replace previously inserted pathology text after a laterality change. */
export function relateralizeOwnedText(
  fieldText: string,
  previous: string,
  next: string,
): string {
  const prev = previous.trim();
  const nxt = next.trim();
  if (!prev || prev === nxt) return fieldText;
  if (!fieldText.includes(prev)) return fieldText;
  return fieldText.replace(prev, nxt);
}
