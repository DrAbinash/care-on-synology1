/**
 * Server-side study/impression context helpers for AI draft generation.
 * Mirrors diagnostic-erp/src/lib/aiDraftStudyContext.ts — keep behaviour aligned.
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

  if (isBrainStudy && /\bchest\b/.test(text) && !/\bbrain\b|\bintracranial\b|\bcalvarium\b/.test(text)) {
    return false;
  }

  return true;
}

/** Prefer study-specific prompt keys over bare modality (avoids CT Chest for CT Brain). */
export function resolveBuiltinPromptForStudy(
  templates: Record<string, string>,
  modality?: string | null,
  studyDescription?: string | null,
): string | null {
  const desc = (studyDescription ?? "").trim();
  const mod = (modality ?? "").trim();
  if (mod && desc && templates[`${mod} ${desc}`]) return templates[`${mod} ${desc}`];
  if (studyLooksLikeBrain(desc) && templates["CT Brain Report"]) return templates["CT Brain Report"];
  if (studyLooksLikeChest(desc, mod) && templates["X-ray Report"] && /^xr|cr|dx$/i.test(mod)) {
    return templates["X-ray Report"];
  }
  return null;
}
