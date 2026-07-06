/**
 * sentenceDiff.ts — sentence-level diff for Follow-up Mode.
 *
 * Compares a previous report's text with the current draft, sentence by
 * sentence, and classifies each as unchanged / added / removed. Sentence
 * granularity (not word-level) keeps the highlight readable for medical
 * prose and avoids noisy character diffs.
 *
 * Pure, dependency-free, unit-tested (phase3.test.ts).
 */

export type DiffKind = "unchanged" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

function splitSentences(text: string): string[] {
  return (text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Diffs previous vs current text. Order: removed lines are interleaved
 * where they occurred in the previous report; added lines where they occur
 * in the current one — implemented as: walk current (unchanged/added), then
 * append previous-only lines (removed) grouped at the end of the section.
 */
export function diffSentences(previous: string, current: string): DiffLine[] {
  const prevSentences = splitSentences(previous);
  const currSentences = splitSentences(current);
  const prevSet = new Set(prevSentences.map(norm));
  const currSet = new Set(currSentences.map(norm));

  const out: DiffLine[] = [];
  for (const s of currSentences) {
    out.push({ kind: prevSet.has(norm(s)) ? "unchanged" : "added", text: s });
  }
  for (const s of prevSentences) {
    if (!currSet.has(norm(s))) out.push({ kind: "removed", text: s });
  }
  return out;
}

/** Convenience counts for a diff (used by the Follow-up panel header). */
export function diffSummary(lines: DiffLine[]): { added: number; removed: number; unchanged: number } {
  let added = 0, removed = 0, unchanged = 0;
  for (const l of lines) {
    if (l.kind === "added") added++;
    else if (l.kind === "removed") removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}
