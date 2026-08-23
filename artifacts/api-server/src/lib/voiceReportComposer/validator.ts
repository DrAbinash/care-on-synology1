/**
 * Clinical + report safety validation for voice change plans.
 */
import type { VoiceChangePlan, VoiceObservation } from "./schema";

type InsertSource =
  | "manual"
  | "quick-select"
  | "quick-findings"
  | "protocol"
  | "template"
  | "macro"
  | "companion"
  | "ai-draft"
  | "radiologist-voice";

type ProvenanceMap = Record<string, InsertSource[]>;

export type ComposerValidationInput = {
  plan: VoiceChangePlan;
  findingsText: string;
  impressionText: string;
  fieldProvenance?: {
    findings?: ProvenanceMap;
    impression?: ProvenanceMap;
  };
  protectedQuickFindingLabels?: string[];
  generateImpressionOnly?: boolean;
};

export type ComposerValidationResult = {
  ok: boolean;
  reason?: string;
  blockedObservations?: string[];
};

const PROTECTED_SOURCES: InsertSource[] = ["manual", "quick-findings", "quick-select"];

function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function splitToSentences(text: string): string[] {
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function isProtectedSentence(sentence: string, provenance: ProvenanceMap | undefined): boolean {
  const key = normalizeForDedupe(sentence);
  if (!key || !provenance?.[key]) return false;
  return provenance[key].some((s) => PROTECTED_SOURCES.includes(s));
}

function impressionIntroducesUnsupportedFinding(impression: string, findings: string): boolean {
  const findingLower = findings.toLowerCase();
  const impSentences = splitToSentences(impression);
  const pathologyTerms = [
    "hemorrhage", "infarct", "mass", "tumor", "stenosis", "herniation",
    "bulge", "fracture", "metastasis", "malignancy", "abscess",
  ];
  for (const s of impSentences) {
    const lower = s.toLowerCase();
    if (/\b(normal|unremarkable|no acute|no significant)\b/i.test(lower)) continue;
    for (const term of pathologyTerms) {
      if (lower.includes(term) && !findingLower.includes(term)) return true;
    }
  }
  return false;
}

function contradictsQuickFinding(observation: VoiceObservation, labels: string[]): boolean {
  const hay = `${observation.findingsText} ${observation.concept}`.toLowerCase();
  for (const label of labels) {
    const l = label.toLowerCase();
    if (!l) continue;
    if (/\b(no |without |normal)\b/i.test(hay) && hay.includes(l.split(" ")[0])) {
      return true;
    }
  }
  return false;
}

export function validateChangePlan(input: ComposerValidationInput): ComposerValidationResult {
  const { plan } = input;

  if (plan.clarificationRequired?.trim()) {
    return { ok: false, reason: plan.clarificationRequired.trim() };
  }

  if (plan.uncertainties?.some((u) => /ambiguous|which level|clarif/i.test(u))) {
    return { ok: false, reason: plan.uncertainties.find((u) => u.trim()) ?? "Ambiguous command" };
  }

  if (input.generateImpressionOnly) {
    const imp = plan.impressionUpdate?.trim();
    if (!imp) return { ok: false, reason: "No impression generated" };
    if (impressionIntroducesUnsupportedFinding(imp, input.findingsText)) {
      return { ok: false, reason: "Impression introduces finding not present in Findings" };
    }
    return { ok: true };
  }

  if (!plan.observations.length) {
    return { ok: false, reason: "No observations in change plan" };
  }

  const blocked: string[] = [];
  const findingsProv = input.fieldProvenance?.findings;

  for (const obs of plan.observations) {
    if (obs.operation === "remove") continue;

    if (contradictsQuickFinding(obs, input.protectedQuickFindingLabels ?? [])) {
      blocked.push(obs.concept);
      continue;
    }

    if (obs.baselineReplaces?.trim()) {
      for (const s of splitToSentences(input.findingsText)) {
        if (s.includes(obs.baselineReplaces) && isProtectedSentence(s, findingsProv)) {
          blocked.push(obs.concept);
        }
      }
    }
  }

  if (blocked.length) {
    return {
      ok: false,
      reason: "Cannot overwrite explicit manual or Quick Select finding",
      blockedObservations: blocked,
    };
  }

  const impCandidate = plan.impressionUpdate ?? plan.impressionCandidates?.[0];
  if (impCandidate && impressionIntroducesUnsupportedFinding(impCandidate, input.findingsText)) {
    return { ok: false, reason: "Impression introduces finding not present in Findings" };
  }

  return { ok: true };
}
