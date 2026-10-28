/**
 * quickFindingsMerge.ts — exact-match append/remove helpers for Quick Findings
 * deselection and legacy surfaces.
 *
 * Automated report-field INSERTION in the Radiology Reporting Workspace uses
 * reportFieldMerge via zustand mergeField. These helpers remain for:
 *   - exact verbatim removal (removeBlock / removeImpression)
 *   - legacy workspace / USG composer / render engine surfaces
 *   - provenance-aware normal-impression stripping (PR #662 §2)
 */

import type { FieldProvenanceMap, InsertSource } from "./reportFieldMerge";
import { normalizeForDedupe } from "./reportFieldMerge";

/** Appends `block` as its own paragraph unless the exact block already exists. */
export function mergeBlock(existing: string, block: string): string {
  const trimmedBlock = block.trim();
  if (!trimmedBlock) return existing;
  if (existing.includes(trimmedBlock)) return existing; // no duplicate lines
  const base = existing.trimEnd();
  return base ? `${base}\n${trimmedBlock}` : trimmedBlock;
}

/**
 * Removes the exact block if still present verbatim; otherwise no-op.
 *
 * The gap the block occupied is closed with it. Two shapes, because a block
 * occupies different text depending on how it got there:
 *
 *  * The line, or the run of lines, it was written on. `mergeBlock` and
 *    `moveIncomingIntoSection` each write a block as its own line, so the LINE
 *    is the block and its newline goes with it. Leaving the empty line behind
 *    strands a blank paragraph exactly where the finding sat — between a section
 *    heading and its prose, which is not the shape the approved normal was
 *    written in. Measured on deselection of the CT Brain "Acute Infarct" box,
 *    where the Findings section came back a line longer than the normal it
 *    replaced.
 *
 *  * One sentence inside a longer line. Cutting it leaves TWO spaces where it
 *    stood, because the sentence had a space on each side and the cut took
 *    neither. Measured as
 *    "…Homogeneous echotexture.␣␣Intrahepatic biliary radicles…" after
 *    deselecting the USG "Fatty Liver Gr I" box.
 */
export function removeBlock(existing: string, block: string): string {
  const trimmedBlock = block.trim();
  if (!trimmedBlock || !existing.includes(trimmedBlock)) return existing;
  const lines = existing.split("\n");
  const blockLines = trimmedBlock.split("\n").map((l) => l.trim());
  const runAt = lines.findIndex((_, i) => blockLines.every((b, k) => (lines[i + k] ?? "").trim() === b));
  let next: string;
  if (runAt >= 0) {
    lines.splice(runAt, blockLines.length);
    next = lines.join("\n");
  } else {
    // Touch only the line a single-line block was cut from: its own spacing is
    // the one thing this removal can have disturbed, and normalising the whole
    // field would rewrite prose the deselection never spoke to.
    const at = lines.findIndex((l) => l.includes(trimmedBlock));
    next = at < 0
      ? existing.replace(trimmedBlock, "")
      : lines
        .map((l, i) => i === at
          ? l.replace(trimmedBlock, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "")
          : l)
        .join("\n");
  }
  return next
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

/** Heuristic: template / protocol "normal study" impression lines. */
const NORMAL_IMPRESSION_RE =
  /\b(no significant (abnormality|intracranial|pathology)|within normal limits|unremarkable|appears? normal|normal (mri|ct|usg|ultrasound|study|brain|scan)|no (focal|acute|significant) (lesion|abnormality)|no (?:focal|acute|significant|gross|obvious|apparent)(?:[ ]+[a-z]+){1,3}[ ]+(?:lesions?|abnormalit(?:y|ies)|pathology)\b|all imaged structures are within normal|no definite (abnormality|evidence of|sign of|focus)|no (obvious|apparent) (abnormality|pathology))\b/i;

export function isNormalImpressionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return NORMAL_IMPRESSION_RE.test(t);
}

/**
 * When an abnormal impression is added, drop leftover normal-study lines so
 * the Impression section does not keep "Normal MRI Brain…" next to pathology.
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

/**
 * PR #662 §2 — Provenance-aware normal-impression stripping.
 *
 * Sources that OWN their text (radiologist-controlled) are NEVER stripped:
 *   - manual                (radiologist typed it)
 *   - radiologist-voice     (radiologist dictated it)
 *   - quick-select          (QS observation — owned by the patch ledger)
 *   - quick-findings        (Quick Findings observation — owned by ledger)
 *   - structured-template   (Structured Finding — owned by ledger)
 *   - structured-template-candidate (Structured impression candidate)
 *   - macro                 (Chocolate macro — owned by ledger)
 *   - system                (System-owned patch — yields via removeLedgerObservation)
 *
 * Sources that are TEMPLATE DEFAULTS (auto-strippable when abnormal arrives):
 *   - template / template-a / template-b  (Full Report Format defaults)
 *   - protocol                            (protocol-applied defaults)
 *   - companion                           (companion inserts)
 *   - ai-draft                             (AI composer draft — presentational)
 *
 * Lines with NO provenance entry are CONSERVATIVELY KEPT (might be a manual
 * edit that hasn't propagated provenance yet).
 */
const OWNED_SOURCES: ReadonlySet<InsertSource> = new Set<InsertSource>([
  "manual",
  "radiologist-voice",
  "quick-select",
  "quick-findings",
  "structured-template",
  "structured-template-candidate",
  "macro",
  "system",
]);

/**
 * Returns true if the sentence's provenance includes any owned source.
 * If the sentence has no provenance entry, returns true (conservative keep).
 */
function sentenceIsOwned(
  sentence: string,
  provenance: FieldProvenanceMap | undefined,
): boolean {
  const key = normalizeForDedupe(sentence);
  if (!key) return true;
  const sources = provenance?.[key];
  if (!sources || sources.length === 0) return true; // unknown → keep
  return sources.some((s) => OWNED_SOURCES.has(s));
}

/**
 * Provenance-aware version of `stripNormalImpressionLines`.
 *
 * Strips normal-impression lines ONLY when their provenance indicates a
 * template-default source (template / protocol / companion / ai-draft).
 * Manual / voice / QS / structured / macro / system contributions are
 * NEVER stripped by this function — they survive intact and continue to
 * be owned by their original producers.
 *
 * This is the function `pathologyPatch.overlayPathology` should call when
 * abnormal content is inserted. The legacy `stripNormalImpressionLines`
 * remains for non-ledger paths (renderEngine / formatSlotMerge) that don't
 * have access to provenance.
 */
export function stripNormalImpressionLinesProvenanceAware(
  lines: string[],
  opts: {
    knownNormals?: string[];
    onlyIfAbnormal?: boolean;
    provenance?: FieldProvenanceMap;
  },
): string[] {
  const provenance = opts.provenance;
  const known = new Set(
    (opts.knownNormals ?? []).map((s) => s.trim()).filter(Boolean),
  );
  const hasAbnormal = lines.some((l) => {
    const t = l.trim();
    return t && !known.has(t) && !isNormalImpressionLine(t);
  });
  if (opts.onlyIfAbnormal && !hasAbnormal) return lines;
  return lines.filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (known.has(t)) return false;
    if (!isNormalImpressionLine(t)) return true; // keep abnormal lines
    // It's a normal-impression line — check provenance before stripping.
    if (sentenceIsOwned(t, provenance)) return true; // owned → keep
    return false; // template-default → strip
  });
}

