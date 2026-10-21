/**
 * Smart Dictation region policy — the six owner-approved MRI examinations.
 *
 * Task 15 (Part E): full ChatGPT-style Smart Dictation ships for exactly
 * these MRI examinations and nothing else:
 *
 *   1. MRI Brain (complete)                 — region "Brain"
 *   2. MRI LS Spine (complete)              — region "LS Spine"
 *   3. MRI Cervical Spine (complete)        — region "Cervical Spine"
 *   4. MRI LS Spine screening               — region "LS Spine" (Screening)
 *   5. MRI Cervical Spine screening         — region "Cervical Spine" (Screening)
 *   6. MRI Whole Spine screening            — region "Whole Spine" (Screening)
 *
 * The screening variants reuse the same region names (protocolScope
 * "Screening" in the report-formats library), so the region gate covers all
 * six with four names. "Dorsal Spine" is admitted only as a whole-spine
 * companion (the whole-spine screening format reports cervical + dorsal), so
 * dorsal dictations inside a whole-spine study compose; a standalone dorsal
 * study is not one of the six and the full gate below keeps it out.
 *
 * Every other modality (USG — including the USG Studio's own assistant —
 * CT, X-ray, MG) stays outside Smart Dictation.
 */

/** Canonical region names for the six examinations. */
export const SMART_DICTATION_REGION_NAMES = [
  "Brain",
  "LS Spine",
  "Cervical Spine",
  "Whole Spine",
] as const;

/** Human-readable exam list for prompts and UI copy. */
export const SMART_DICTATION_EXAMS = [
  "MRI Brain (complete)",
  "MRI LS Spine (complete)",
  "MRI Cervical Spine (complete)",
  "MRI LS Spine screening",
  "MRI Cervical Spine screening",
  "MRI Whole Spine screening",
] as const;

const REGION_RE =
  /\b(?:brain|ls spine|ls-spine|lumbar|lumbosacral|lumbo(?:sacral)?|cervical|whole spine|whole-spine|dorsal)\b/i;

/** Loose container for matching free-form region strings ("MRI Whole Spine — Screening"). */
const REGION_HINT_RE =
  /brain|ls\s*spine|lumbar|lumbosacral|cervical|whole\s*spine|dorsal/i;

/**
 * Is this study one of the six Smart Dictation examinations?
 * The runtime strings come from the workspace's matchedStudyRegion
 * ("Brain", "LS Spine", "Cervical Spine", "Whole Spine", "Dorsal Spine",
 * or a full study-description string such as "MRI Whole Spine — Screening").
 * Dorsal alone is NOT admitted — it only composes inside a whole-spine study,
 * which the caller signals by passing the whole-spine region string.
 */
export function smartDictationRegionSupported(region?: string | null): boolean {
  if (!region) return false;
  const r = String(region).trim();
  if (!r) return false;
  // Canonical names first (exact family match, no substring surprises).
  const canonical = REGION_RE.test(r);
  if (!canonical) return false;
  // A standalone "Dorsal Spine" study is not one of the six examinations.
  if (/^\s*dorsal(?:\s+spine)?\s*$/i.test(r)) return false;
  // "Dorsal" as a pure region name (workspace tabs) is out unless the string
  // also names the whole spine.
  if (/^dorsal/i.test(r) && !/whole/i.test(r)) return false;
  return true;
}

/** Hint-only matcher for loose strings that may embed the region ("MRI Brain 1234"). */
export function smartDictationRegionHint(region?: string | null): boolean {
  if (!region) return false;
  const r = String(region).trim();
  if (/^\s*dorsal(?:\s+spine)?\s*$/i.test(r)) return false;
  if (/^dorsal/i.test(r) && !/whole/i.test(r)) return false;
  return REGION_HINT_RE.test(r);
}

/** The spine families a region covers — used to scope the phrase catalog. */
export function regionFamilies(region?: string | null): {
  brain: boolean;
  lumbar: boolean;
  cervical: boolean;
  dorsal: boolean;
} {
  const r = (region ?? "").toLowerCase();
  const wholeSpine = /whole\s*spine/.test(r);
  return {
    brain: /brain/.test(r),
    lumbar: wholeSpine || /ls\s*spine|lumbar|lumbosacral/.test(r),
    cervical: wholeSpine || /cervical/.test(r),
    dorsal: wholeSpine || /dorsal/.test(r),
  };
}
