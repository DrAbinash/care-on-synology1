/**
 * Apply structured generation into the existing report editors.
 *
 * Findings: per labeled line (`L4-L5: …`) using the existing mergeField path.
 * A line that the radiologist edited in place is released — we do not strip it
 * and we do not re-insert the generated wording.
 *
 * Impression candidates are NOT applied here. They stay in the Structured
 * panel until Accept calls mergeField(..., "structured-template-candidate").
 */

import { normalizeForDedupe } from "../reportFieldMerge";
import type { FindingsMap, ImpressionCandidate } from "./types";

export type LabeledFindingsLines = Record<string, string>;

export type StructuredFindingsPlan = {
  strip: string[];
  merge: string[];
  nextTracked: LabeledFindingsLines;
};

export function labeledFindingsBlock(map: FindingsMap): string {
  return Object.values(labeledLinesFromMap(map)).join("\n\n");
}

export function labeledLinesFromMap(map: FindingsMap): LabeledFindingsLines {
  const out: LabeledFindingsLines = {};
  for (const [label, v] of Object.entries(map)) {
    if (!v.text.trim()) continue;
    out[label] = `${label}: ${v.text}`;
  }
  return out;
}

export function impressionCandidateBlock(candidates: ImpressionCandidate[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of candidates) {
    const t = c.text.trim();
    if (!t) continue;
    const key = normalizeForDedupe(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(t);
  }
  return lines.join("\n");
}

/** Exact previous block only — never reconstructs the document from sentences. */
export function stripPreviousGenerated(existing: string, previous: string): string {
  const prev = previous.trim();
  if (!prev) return existing;
  return stripExactChunks(existing, [prev]);
}

export function stripExactChunks(existing: string, chunks: string[]): string {
  if (chunks.length === 0) return existing;
  let out = existing;
  for (const chunk of chunks) {
    if (!chunk || !out.includes(chunk)) continue;
    out = out.replace(chunk, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Decide which previously generated labeled lines may be replaced.
 *
 * - Verbatim previous line still in the editor → strip it and merge the next
 *   line (or drop it if that key is now empty/normal).
 * - Previous line gone or edited → released; do not strip, do not re-merge.
 * - New keys → merge if the next line is not already present.
 */
export function planStructuredFindingsUpdate(
  existing: string,
  previousLines: LabeledFindingsLines,
  nextLines: LabeledFindingsLines,
): StructuredFindingsPlan {
  let remaining = existing;
  const strip: string[] = [];
  const merge: string[] = [];
  const nextTracked: LabeledFindingsLines = {};
  const keys = new Set([...Object.keys(previousLines), ...Object.keys(nextLines)]);

  for (const key of keys) {
    const prev = previousLines[key];
    const next = nextLines[key];
    const prevStillPresent = Boolean(prev && remaining.includes(prev));

    if (prev && prevStillPresent) {
      if (next && next === prev) {
        nextTracked[key] = next;
        continue;
      }
      strip.push(prev);
      remaining = stripExactChunks(remaining, [prev]);
      if (next) {
        merge.push(next);
        nextTracked[key] = next;
      }
      continue;
    }

    if (prev && !prevStillPresent) {
      // Radiologist owns this sentence now.
      continue;
    }

    if (next) {
      if (!remaining.includes(next)) merge.push(next);
      nextTracked[key] = next;
    }
  }

  return { strip, merge, nextTracked };
}

/** Apply a findings plan with the caller's merge (existing reportFieldMerge). */
export function applyStructuredFindingsPlan(
  existing: string,
  plan: StructuredFindingsPlan,
  mergeLine: (current: string, incoming: string) => string,
): string {
  let text = stripExactChunks(existing, plan.strip);
  for (const line of plan.merge) {
    text = mergeLine(text, line);
  }
  return text;
}
