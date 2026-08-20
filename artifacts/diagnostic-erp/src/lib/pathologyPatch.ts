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
  { key: "basal ganglia", re: /basal ganglia|putamen|caudate|globus pallidus|internal capsule/i },
  { key: "white matter", re: /white matter|fazekas|periventricular/i },
  { key: "mca", re: /\bmca\b|middle cerebral/i },
  { key: "ventricle", re: /ventricular system|ventricles|cisternal/i },
  { key: "disc", re: /\bdisc\b|herniation|bulge/i },
  { key: "cord", re: /spinal cord|thecal sac|canal stenosis/i },
];

const PATHOLOGY_TERMS = [
  "hemorrhage", "haemorrhage", "infarct", "restricted diffusion",
  "herniation", "stenosis", "fracture", "mass", "tumor", "tumour", "lesion",
];

const DENIAL = /\b(no|without|absence of|unremarkable|normal|not identified|not seen|free of)\b/i;

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
    for (const s of splitToSentences(existing)) {
      const owned = (baseline && s.includes(baseline))
        || sentenceMentions(s, keys)
        || (asserted.length > 0 && deniesPathology(s, asserted));
      if (!owned) {
        kept.push(s);
        continue;
      }
      if (isManualSentence(s, provenance) && !opts.force) {
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
  if (asserted.length > 0) {
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
