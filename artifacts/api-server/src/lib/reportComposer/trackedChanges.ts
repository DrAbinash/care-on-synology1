/**
 * Build tracked changes (DATA only — never HTML) from original vs proposed fields.
 * Job stays READY while individual changes remain PENDING/ACCEPTED/REJECTED/EDITED.
 */
import { randomUUID } from "node:crypto";
import { detectClinicalSignificance } from "./clinicalSignificance";
import type { ComposerDraftOutput, TrackedChange } from "./types";

function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function fieldChanges(
  field: TrackedChange["field"],
  original: string,
  proposed: string,
  jobId: number,
  model?: string,
): TrackedChange[] {
  const oNorm = (original ?? "").trim();
  const pNorm = (proposed ?? "").trim();
  if (!pNorm && !oNorm) return [];
  if (oNorm === pNorm) return [];

  const oSent = splitSentences(oNorm);
  const pSent = splitSentences(pNorm);
  const oSet = new Set(oSent.map((s) => s.toLowerCase()));
  const pSet = new Set(pSent.map((s) => s.toLowerCase()));
  const now = new Date().toISOString();
  const out: TrackedChange[] = [];

  // Whole-field replace when structure differs substantially
  if (oNorm && pNorm && oNorm !== pNorm) {
    const sig = detectClinicalSignificance(oNorm, pNorm);
    out.push({
      id: randomUUID(),
      source: "AI_COMPOSER",
      changeType: "REPLACE",
      field,
      originalText: oNorm,
      proposedText: pNorm,
      reviewState: "PENDING",
      clinicalSignificance: sig.significant,
      clinicalSignificanceReasons: sig.reasons,
      reason: "Full field composition",
      createdAt: now,
      jobId,
      model,
    });
  } else if (!oNorm && pNorm) {
    out.push({
      id: randomUUID(),
      source: "AI_COMPOSER",
      changeType: "ADD",
      field,
      originalText: "",
      proposedText: pNorm,
      reviewState: "PENDING",
      clinicalSignificance: false,
      clinicalSignificanceReasons: [],
      reason: "New content",
      createdAt: now,
      jobId,
      model,
    });
  }

  // Sentence-level adds for diff highlight (supplemental, same job)
  for (const s of pSent) {
    if (!oSet.has(s.toLowerCase()) && oNorm && pNorm && oNorm !== pNorm) {
      // Already covered by REPLACE — skip duplicates of whole field
      break;
    }
    void pSet;
  }

  return out;
}

export function buildTrackedChanges(opts: {
  jobId: number;
  model?: string;
  originalFindings: string;
  originalImpression: string;
  originalRecommendation: string;
  draft: ComposerDraftOutput;
}): TrackedChange[] {
  return [
    ...fieldChanges("FINDINGS", opts.originalFindings, opts.draft.findings, opts.jobId, opts.model),
    ...fieldChanges("IMPRESSION", opts.originalImpression, opts.draft.impression, opts.jobId, opts.model),
    ...fieldChanges(
      "RECOMMENDATION",
      opts.originalRecommendation,
      opts.draft.recommendation,
      opts.jobId,
      opts.model,
    ),
  ];
}

/** Merge accepted tracked changes into plain clinical text (no HTML). */
export function materializeAcceptedText(opts: {
  currentFindings: string;
  currentImpression: string;
  currentRecommendation: string;
  changes: TrackedChange[];
}): { findings: string; impression: string; recommendation: string } {
  let findings = opts.currentFindings;
  let impression = opts.currentImpression;
  let recommendation = opts.currentRecommendation;

  for (const c of opts.changes) {
    if (c.reviewState !== "ACCEPTED" && c.reviewState !== "EDITED") continue;
    if (c.field === "FINDINGS") findings = c.proposedText;
    if (c.field === "IMPRESSION") impression = c.proposedText;
    if (c.field === "RECOMMENDATION") recommendation = c.proposedText;
  }
  return { findings, impression, recommendation };
}
