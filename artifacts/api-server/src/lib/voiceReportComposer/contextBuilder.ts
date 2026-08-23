/**
 * Minimal context for Voice Report Composer — no full app state dump.
 */
import type { VoiceObservation } from "./schema";

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
