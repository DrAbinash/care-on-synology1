/**
 * Minimal context for Voice Report Composer — no full app state dump.
 */
import type { VoiceObservation } from "./schema";
import type { CatalogPhrase } from "./phraseCatalog";

export type ComposerContextInput = {
  modality?: string;
  region?: string;
  reportTitle?: string;
  findingsText?: string;
  impressionText?: string;
  techniqueText?: string;
  transcript: string;
  priorTranscript?: string;
  priorObservations?: VoiceObservation[];
  generateImpressionOnly?: boolean;
  /**
   * Radiologist-authored findings (Settings → Radiology → Voice) compiled from
   * radiology_smart_dictation_phrases. They join the built-in catalog in every
   * match/regeneration/prompt pass; empty/absent → shipped V1 behavior.
   */
  customPhrases?: CatalogPhrase[];
};

export function buildComposerPrompt(ctx: ComposerContextInput, catalogBlock: string): string {
  const priorObs = ctx.priorObservations?.length
    ? JSON.stringify(ctx.priorObservations.map((o) => ({
      id: o.id,
      concept: o.concept,
      level: o.level,
      findingsText: o.findingsText,
    })))
    : "[]";

  if (ctx.generateImpressionOnly) {
    return [
      "You are a radiology REPORT COMPOSER. The radiologist is authoritative.",
      "Generate ONLY an impression summary from accepted findings. Do NOT invent new abnormalities.",
      "Return strict JSON only — no markdown.",
      "",
      `Modality: ${ctx.modality ?? "MR"}`,
      `Region: ${ctx.region ?? "unknown"}`,
      `Report: ${ctx.reportTitle ?? ""}`,
      "",
      "Current Findings:",
      ctx.findingsText ?? "",
      "",
      "Return JSON:",
      '{"operation":"report_change_plan","observations":[],"impressionUpdate":"<one impression paragraph>","uncertainties":[],"clarificationRequired":null}',
    ].join("\n");
  }

  return [
    "You are a radiology REPORT COMPOSER — NOT a diagnostic authority.",
    "The radiologist dictated findings while viewing images. Map intent to CARE report structure.",
    "Prefer CARE catalog phrases when they match. Do NOT rewrite the entire report.",
    "Do NOT invent measurements, levels, laterality, grading, or priors unless stated.",
    "CARRY DICTATED VALUES VERBATIM into findingsText when the transcript states them:",
    "measurements with their exact number and unit (\"9.2 mm\" — never round, convert or",
    "drop them), anatomical levels, laterality (left/right/bilateral) and severity words.",
    "If a dictated value cannot be mapped safely, say so via uncertainties or",
    "clarificationRequired — never drop it silently.",
    "CONVERSATIONAL CORRECTIONS (Smart Dictation): if the transcript asks to REMOVE a finding",
    "(\"remove ligamentum flavum hypertrophy\") emit one observation with operation=\"remove\" and",
    "targetObservationId from the active observations. If it restates severity or side",
    "(\"make L4-L5 narrowing moderate on the left\") emit operation=\"update\" on the matching",
    "active observation, regenerating findingsText from the SAME catalog wording with only",
    "the dictated severity/side/level. Never invent a target that is not in the active list.",
    "If level reference is ambiguous, set clarificationRequired and observations=[].",
    "Return strict JSON only — no markdown, no HTML.",
    "",
    `Modality: ${ctx.modality ?? "MR"}`,
    `Region: ${ctx.region ?? "unknown"}`,
    `Report: ${ctx.reportTitle ?? ""}`,
    "",
    "Relevant existing Findings (snippet):",
    truncate(ctx.findingsText ?? "", 1200),
    "",
    "Prior voice context transcript:",
    ctx.priorTranscript?.trim() || "(none)",
    "",
    "Active observations from prior dictation:",
    priorObs,
    "",
    "CARE phrase catalog (prefer these wordings):",
    catalogBlock,
    "",
    "Radiologist transcript (authoritative):",
    ctx.transcript,
    "",
    "JSON schema:",
    '{"operation":"report_change_plan","observations":[{"concept":"...","level":"L4-L5","findingsText":"...","impressionText":"...","anatomicalSection":"disc","conflictGroup":"disc","baselineReplaces":"...","operation":"add"}],"removeConflictingBaselineConcepts":["..."],"impressionCandidates":["..."],"uncertainties":[],"clarificationRequired":null}',
  ].join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
