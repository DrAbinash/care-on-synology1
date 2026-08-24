/**
 * Guards against cross-modality AI draft autofill (e.g. "Normal chest radiograph"
 * landing on a CT Brain study). Used by workspace hydrate and unit tests.
 */

export function studyLooksLikeChest(studyDescription?: string | null, modality?: string | null): boolean {
  const desc = (studyDescription ?? "").toLowerCase();
  const mod = (modality ?? "").toLowerCase();
  if (/\bchest\b|\bcxr\b|\bthorax\b|\bthoracic\b/.test(desc)) return true;
  if ((mod === "xr" || mod === "cr" || mod === "dx" || mod === "xray") && /\bchest\b/.test(desc)) return true;
  return false;
}

export function studyLooksLikeBrain(studyDescription?: string | null): boolean {
  const desc = (studyDescription ?? "").toLowerCase();
  return /\bbrain\b|\bcranial\b|\bcranium\b|\bhead\b|\bncct\b|\bcerebral\b/.test(desc);
}

/**
 * Returns false when impression wording clearly belongs to another body region
 * than the open study (clinical-safety gate for silent AI autofill).
 */
export function impressionMatchesStudyContext(
  impression: string,
  opts: { modality?: string | null; studyDescription?: string | null },
): boolean {
  const text = (impression ?? "").trim().toLowerCase();
  if (!text) return true;

  const desc = opts.studyDescription ?? "";
  const mod = opts.modality ?? "";
  const isChestStudy = studyLooksLikeChest(desc, mod);
  const isBrainStudy = studyLooksLikeBrain(desc);

  const mentionsChestRadiograph =
    /\bchest\s+radiograph\b/.test(text)
    || /\bnormal\s+chest\b/.test(text)
    || /\bcxr\b/.test(text)
    || (/\bradiograph\b/.test(text) && /\bchest\b/.test(text));

  if (mentionsChestRadiograph && !isChestStudy) return false;
  if (mentionsChestRadiograph && isBrainStudy) return false;

  // CT/MR brain must not accept bare "chest" impressions.
  if (isBrainStudy && /\bchest\b/.test(text) && !/\bbrain\b|\bintracranial\b|\bcalvarium\b/.test(text)) {
    return false;
  }

  return true;
}
