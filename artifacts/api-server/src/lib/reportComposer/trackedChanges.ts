/**
 * Build tracked changes (DATA only — never HTML) from original vs proposed fields.
 * Job stays READY while individual changes remain PENDING/ACCEPTED/REJECTED/EDITED.
 */
import { randomUUID } from "node:crypto";
import { detectClinicalSignificance } from "./clinicalSignificance";
import type { ComposerDraftOutput, TrackedChange } from "./types";

/**
 * One tracked change per field, carrying that field's whole text.
 *
 * There used to be a second loop under the comment "Sentence-level adds for diff
 * highlight (supplemental, same job)". It was dead: its only statement was a `break`
 * guarded by the same condition that made the whole-field REPLACE above, and it
 * finished with `void pSet` to keep an unused set compiling. Nothing it could have
 * emitted ever reached a review panel, while the shape of the code claimed the
 * Composer diffed sentence by sentence — which is how the audit scored the review
 * surface as "whole-field, never per sentence" and found the loop in the act of
 * looking like a safety net. It is gone rather than fixed, because per-sentence
 * ACCEPT is not implementable on top of `materializeAcceptedText` (that merge assigns
 * the whole field from `proposedText`), and emitting sentence-shaped changes there
 * would make accepting one line silently delete the others.
 */
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

  const now = new Date().toISOString();
  const out: TrackedChange[] = [];

  if (oNorm && pNorm) {
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
