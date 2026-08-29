/**
 * quickFindingsMerge.ts — exact-match append/remove helpers for Quick Findings
 * deselection and legacy surfaces.
 *
 * Automated report-field INSERTION in the Radiology Reporting Workspace uses
 * reportFieldMerge via zustand mergeField. These helpers remain for:
 *   - exact verbatim removal (removeBlock / removeImpression)
 *   - legacy workspace / USG composer / render engine surfaces
 */

/** Appends `block` as its own paragraph unless the exact block already exists. */
export function mergeBlock(existing: string, block: string): string {
  const trimmedBlock = block.trim();
  if (!trimmedBlock) return existing;
  if (existing.includes(trimmedBlock)) return existing; // no duplicate lines
  const base = existing.trimEnd();
  return base ? `${base}\n${trimmedBlock}` : trimmedBlock;
}

/** Removes the exact block if still present verbatim; otherwise no-op. */
export function removeBlock(existing: string, block: string): string {
  const trimmedBlock = block.trim();
  if (!trimmedBlock || !existing.includes(trimmedBlock)) return existing;
  return existing
    .replace(trimmedBlock, "")
    .replace(/\n{3,}/g, "\n\n") // collapse the gap left behind
    .replace(/^\n+/, "")
    .trimEnd();
}

/** Adds an impression line to an array unless an identical line exists. */
export function mergeImpression(lines: string[], line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || lines.some((l) => l.trim() === trimmed)) return lines;
  return [...lines, trimmed];
}

/** Removes an exactly-matching impression line; edited lines are kept. */
export function removeImpression(lines: string[], line: string): string[] {
  const trimmed = line.trim();
  const idx = lines.findIndex((l) => l.trim() === trimmed);
  if (idx === -1) return lines;
  return [...lines.slice(0, idx), ...lines.slice(idx + 1)];
}

/** Heuristic: template / protocol “normal study” impression lines. */
const NORMAL_IMPRESSION_RE =
  /\b(no significant (abnormality|intracranial|pathology)|within normal limits|unremarkable|appears? normal|normal (mri|ct|usg|ultrasound|study|brain|scan)|no (focal|acute|significant) (lesion|abnormality)|all imaged structures are within normal|no definite (abnormality|evidence of|sign of|focus)|no (obvious|apparent) (abnormality|pathology))\b/i;

export function isNormalImpressionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return NORMAL_IMPRESSION_RE.test(t);
}

/**
 * When an abnormal impression is added, drop leftover normal-study lines so
 * the Impression section does not keep “Normal MRI Brain…” next to pathology.
 * Exact template defaults can also be passed via `knownNormals`.
 */
export function stripNormalImpressionLines(
  lines: string[],
  opts?: { knownNormals?: string[]; onlyIfAbnormal?: boolean },
): string[] {
  const known = new Set(
    (opts?.knownNormals ?? []).map((s) => s.trim()).filter(Boolean),
  );
  const hasAbnormal = lines.some((l) => {
    const t = l.trim();
    return t && !known.has(t) && !isNormalImpressionLine(t);
  });
  if (opts?.onlyIfAbnormal && !hasAbnormal) return lines;
  return lines.filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (known.has(t)) return false;
    return !isNormalImpressionLine(t);
  });
}
