/**
 * Replace the previous structured-generated block, then the caller mergeFields
 * the new block. Exact previous text first; sentence-level fallback so an
 * in-place edit of one sentence is not treated as the whole block.
 */

import { normalizeForDedupe, splitToSentences } from "../reportFieldMerge";
import type { FindingsMap, ImpressionCandidate } from "./types";

export function labeledFindingsBlock(map: FindingsMap): string {
  return Object.entries(map)
    .filter(([, v]) => v.text.trim())
    .map(([label, v]) => `${label}: ${v.text}`)
    .join("\n\n");
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

export function stripPreviousGenerated(existing: string, previous: string): string {
  const prev = previous.trim();
  if (!prev) return existing;
  if (existing.includes(prev)) {
    return existing.replace(prev, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  const prevKeys = new Set(
    splitToSentences(prev).map((s) => normalizeForDedupe(s)).filter(Boolean),
  );
  if (prevKeys.size === 0) return existing;
  return splitToSentences(existing)
    .filter((s) => !prevKeys.has(normalizeForDedupe(s)))
    .join("\n");
}
