/**
 * studyRegion — resolve the study region (a radiology_study_tabs.name, e.g.
 * "Brain", "Cervical Spine", "LS Spine") for the study currently open in the
 * Reporting Workspace, from its free-text hint (modality + study description).
 *
 * This is the SINGLE source of the region-matching rule. After a region is
 * resolved, consumers must use ReportingStudyContext (see reportingStudyContext.ts)
 * rather than re-parsing modality + StudyDescription.
 *
 * Both the right-side QuickFindingsPanel (which drives its protocol dropdown)
 * and the workspace (which drives the study-specific Clinical History chips and
 * the near-Technique protocol dropdown) call this, so all three resolve to the
 * same region — no duplicated matching logic and no divergence.
 *
 * Semantics: among the configured regions whose name appears (case-insensitively)
 * as a substring of the hint, the MOST SPECIFIC (longest name) wins; ties are
 * broken by display order (sortOrder), so the result stays deterministic.
 *
 * "Longest wins" is required for multi-modality dispatch: study-tab names are
 * scoped per modality (e.g. the generic "Brain" for MRI alongside "CT Brain
 * Plain" for CT, or "Spine" alongside "CT Cervical Spine"). A plain first-in-
 * sortOrder match would resolve a "CT Brain Plain" study to the shorter, lower-
 * sorted "Brain" region and pull the wrong modality's content. Because a longer
 * region name can only match when the hint literally contains that whole phrase,
 * preferring it is strictly more specific and does not regress the single-match
 * cases (e.g. MRI "Brain" still resolves to "Brain").
 */

/** Classify a study-tab name into a modality family for Study Setup filtering. */
export function regionTabModalityFamily(name: string): "CT" | "XR" | "US" | "GENERIC" {
  const upper = name.trim().toUpperCase();
  if (/^(CT|HRCT)\b/.test(upper)) return "CT";
  if (/^X-RAY\b/.test(upper)) return "XR";
  if (/^(USG|US)\b/.test(upper)) return "US";
  return "GENERIC";
}

/**
 * Filter study-tab / region names for the open study's modality so MRI Study
 * Setup does not show CT / X-Ray / USG chips (and vice versa).
 */
export function filterRegionNamesForModality(
  names: string[],
  modality: string | null | undefined,
): string[] {
  const m = (modality ?? "").trim().toUpperCase();
  if (!m) return names;
  const isMr = m === "MR" || m.startsWith("MR");
  const isCt = m === "CT" || m.startsWith("CT");
  const isUs = m === "US" || m.startsWith("US");
  const isXr =
    m === "CR" || m === "DX" || m === "XR" || m === "XA" || m === "RF"
    || m.includes("X-RAY") || m.includes("XRAY");

  return names.filter((name) => {
    const family = regionTabModalityFamily(name);
    if (isMr) return family === "GENERIC";
    if (isCt) return family === "CT";
    if (isXr) return family === "XR";
    if (isUs) return family === "US" || family === "GENERIC";
    return true;
  });
}

export function matchStudyRegion(
  hint: string | null | undefined,
  orderedRegionNames: string[],
): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  let best: string | null = null;
  for (const name of orderedRegionNames) {
    if (!name || !h.includes(name.toLowerCase())) continue;
    // Strictly-greater keeps the FIRST (lowest sortOrder) region among equal
    // lengths, preserving the original deterministic tie-break.
    if (best === null || name.length > best.length) best = name;
  }
  return best;
}

/**
 * Last-clicked region becomes primary (index 0). That is what drives macros,
 * Quick Select, and structured suggestions.
 *
 * - Not selected → add as primary (other regions stay selected).
 * - Selected but not primary → promote, do not deselect.
 * - Current primary with other regions still selected → deselect it.
 * - The last remaining region cannot be removed (returns null).
 */
export function nextStudyRegions(current: string[], regionName: string): string[] | null {
  const idx = current.indexOf(regionName);
  if (idx === 0 && current.length === 1) return null;
  if (idx === 0) return current.filter((r) => r !== regionName);
  if (idx > 0) return [regionName, ...current.filter((r) => r !== regionName)];
  return [regionName, ...current];
}

/** Body-part family display name for cascading Study / Region picker. */
export type StudyTabFamily = string;

export const STUDY_TAB_FAMILY_ORDER: readonly StudyTabFamily[] = [
  "Brain",
  "Spine",
  "Head & Neck",
  "Chest",
  "Abdomen & Pelvis",
  "Extremities & Joints",
  "Breast",
  "Other",
] as const;

/** Strip leading modality prefixes before body-part keyword matching. */
export function stripStudyTabModalityPrefix(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/^(MRI|MR|CT|HRCT|X-RAY|USG|US|DOPPLER)\b[\s:_-]*/i, "")
    .trim();
}

/**
 * For combined study names ("Brain + Cervical Spine"), the first primary
 * segment after prefix-stripping wins so classification stays deterministic.
 */
function primaryStudyTabSegment(remainder: string): string {
  const parts = remainder.split(/\s*[+/&]\s*/).map((p) => p.trim()).filter(Boolean);
  return parts[0] || remainder;
}

/**
 * Classify a study-tab name into a body-part family.
 * Spine is checked before Brain on the primary segment so mixed keyword
 * leftovers do not flip; combined names use the first segment after strip.
 */
export function studyTabFamily(name: string): StudyTabFamily {
  const stripped = stripStudyTabModalityPrefix(name);
  const primary = primaryStudyTabSegment(stripped || String(name ?? "").trim());
  const t = primary.toLowerCase();
  const rawUpper = String(name ?? "").toUpperCase();

  // Spine first (deterministic vs Brain for leftover multi-keyword strings)
  if (
    rawUpper.includes("SCREENING_WHOLE_SPINE")
    || /\bspine\b/.test(t)
    || /\bcervical\b/.test(t)
    || /\bdorsal\b/.test(t)
    || /\bthoracic\b/.test(t)
    || /\blumbar\b/.test(t)
    || /\bls\b/.test(t)
    || /\bsacrum\b/.test(t)
    || /\bsacroiliac\b/.test(t)
  ) {
    return "Spine";
  }

  if (
    /\bbrain\b/.test(t)
    || /\bpituitary\b/.test(t)
    || /\bcereb/.test(t)
    || /\bmra\b/.test(t)
    || /\bskull\b/.test(t)
    || /stroke\s+protocol/.test(t)
  ) {
    return "Brain";
  }

  if (
    /\bpns\b/.test(t)
    || /\bsinus/.test(t)
    || /\borbit/.test(t)
    || /\bneck\b/.test(t)
    || /\bface\b/.test(t)
    || /\btmj\b/.test(t)
    || /\bnasopharynx\b/.test(t)
  ) {
    return "Head & Neck";
  }

  if (/\bchest\b/.test(t) || /\bthorax\b/.test(t) || /\bhrct\b/.test(t)) {
    return "Chest";
  }

  if (
    /\babdomen\b/.test(t)
    || /\babdominal\b/.test(t)
    || /\bkub\b/.test(t)
    || /\brenal\b/.test(t)
    || /\burinary\b/.test(t)
    || /\bbladder\b/.test(t)
    || /\bprostate\b/.test(t)
    || /\bobstetric/.test(t)
    || /\bob\b/.test(t)
    || /\bpelvis\b/.test(t)
    || /\bliver\b/.test(t)
    || /\bhepat/.test(t)
  ) {
    return "Abdomen & Pelvis";
  }

  if (
    /\bknee\b/.test(t)
    || /\bshoulder\b/.test(t)
    || /\bhip\b/.test(t)
    || /\bwrist\b/.test(t)
    || /\bankle\b/.test(t)
    || /\belbow\b/.test(t)
    || /\bhand\b/.test(t)
    || /\bfoot\b/.test(t)
    || /\bjoint\b/.test(t)
  ) {
    return "Extremities & Joints";
  }

  if (/\bbreast\b/.test(t) || /\bmammog/.test(t)) {
    return "Breast";
  }

  return "Other";
}

export type StudyTabRefLike = { id: number; name: string };

/** Group study tabs by body-part family; omit empty families; preserve display order. */
export function groupStudyTabsByFamily(
  tabs: StudyTabRefLike[],
): Array<{ family: StudyTabFamily; tabs: StudyTabRefLike[] }> {
  const buckets = new Map<StudyTabFamily, StudyTabRefLike[]>();
  for (const family of STUDY_TAB_FAMILY_ORDER) buckets.set(family, []);
  for (const tab of tabs) {
    const family = studyTabFamily(tab.name);
    const list = buckets.get(family) ?? buckets.get("Other")!;
    list.push(tab);
  }
  return STUDY_TAB_FAMILY_ORDER
    .map((family) => ({ family, tabs: buckets.get(family) ?? [] }))
    .filter((g) => g.tabs.length > 0);
}
