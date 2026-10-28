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
 * as a WHOLE PHRASE in the hint, the MOST SPECIFIC (longest name) wins WITHIN THE
 * PRIMARY EXAMINATION CLAUSE; ties are broken by display order (sortOrder), so
 * the result stays deterministic. If the primary clause names no anatomy at all,
 * the whole hint is searched, so a study that resolves today never becomes
 * unresolved.
 *
 * "Longest wins" is required for multi-modality dispatch: study-tab names are
 * scoped per modality (e.g. the generic "Brain" for MRI alongside "CT Brain
 * Plain" for CT, or "Spine" alongside "CT Cervical Spine"). A plain first-in-
 * sortOrder match would resolve a "CT Brain Plain" study to the shorter, lower-
 * sorted "Brain" region and pull the wrong modality's content. Because a longer
 * region name can only match when the hint literally contains that whole phrase,
 * preferring it is strictly more specific and does not regress the single-match
 * cases (e.g. MRI "Brain" still resolves to "Brain").
 *
 * Longest-wins was never a rule about WHICH EXAMINATION THIS IS, though it became
 * one. `radiology_study_tabs` is seeded with the bare names 'LS Spine', 'Cervical
 * Spine', 'Dorsal Spine', 'Whole Spine', so "MRI LS SPINE WITH SCREENING WHOLE
 * SPINE" contains an 8-character primary and an 11-character supplementary, and
 * the supplementary won: a lumbar examination opened the whole-spine report.
 * "MRI BRAIN WITH CERVICAL SPINE SCREENING" lost Brain to Cervical Spine the same
 * way, and "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING" loses cervical to the
 * 21-character 'Whole Spine Screening' tab. Which examination mis-resolves is
 * decided by tab-name length and word order, not by anything clinical.
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

/**
 * A connective that introduces the SUPPLEMENTARY part of an examination name:
 * "MRI LS SPINE WITH SCREENING WHOLE SPINE", "MRI BRAIN + CERVICAL SPINE
 * SCREENING", "MRI CERVICAL SPINE AND DORSAL SCREENING". The anatomy named
 * before it is the examination the patient was booked for; the anatomy after it
 * is extra coverage the report has to describe as a section, not become.
 */
const SUPPLEMENTARY_CLAUSE_RE = /\b(?:with|and|plus)\b|\+/i;

/** The part of the hint that names the primary examination. */
export function primaryExaminationClause(hint: string): string {
  const at = SUPPLEMENTARY_CLAUSE_RE.exec(hint)?.index ?? -1;
  return at > 0 ? hint.slice(0, at) : hint;
}

/**
 * A region name matches only as a WHOLE PHRASE: neither side of the matched
 * span may continue a word.
 *
 * The bare `text.includes(name)` this replaces let the 2-character nuchal-
 * translucency tab "NT" match inside "co-nt-rast", "a-nt-erior", "joi-nt" and
 * "sy-nt-hetic". `resolveAutoStudyRegion` ranks the billed procedure name above
 * the DICOM StudyDescription, so an MRI Brain booked under any package name
 * carrying those two letters resolved to "NT" and opened the first-trimester
 * obstetric protocol: a signed report for a 46-year-old man whose TECHNIQUE
 * described transabdominal scanning at 11–13+6 weeks and whose IMPRESSION
 * reported a ductus venosus a-wave. Nothing downstream could catch it — the
 * Findings, Impression and Recommendation all agreed with each other, and
 * `filterRegionNamesForModality` keeps "NT" for MR because an unprefixed tab
 * name classifies as GENERIC.
 *
 * `[a-z0-9]` rather than `\b` on purpose: DICOM descriptions are also written
 * underscore-delimited ("MRI_SCREENING_WHOLE_SPINE", which `studyTabFamily`
 * handles explicitly), and `\b` counts `_` as a word character, so `\bbrain\b`
 * would stop matching "mri_brain" — a study that resolves today would become
 * unresolved.
 *
 * A boundary is demanded only on the sides where the tab name itself has a word
 * character, so "X-Ray Whole Spine (Scoliosis)" is not required to be followed
 * by punctuation-free text.
 */
const REGION_PHRASE_PATTERNS = new Map<string, RegExp>();

function regionPhrasePattern(name: string): RegExp {
  const lower = name.toLowerCase();
  const cached = REGION_PHRASE_PATTERNS.get(lower);
  if (cached) return cached;
  const body = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = /^[a-z0-9]/.test(lower) ? "(?<![a-z0-9])" : "";
  const trail = /[a-z0-9]$/.test(lower) ? "(?![a-z0-9])" : "";
  const pattern = new RegExp(`${lead}${body}${trail}`, "i");
  REGION_PHRASE_PATTERNS.set(lower, pattern);
  return pattern;
}

function longestContainedRegion(text: string, orderedRegionNames: string[]): string | null {
  let best: string | null = null;
  for (const name of orderedRegionNames) {
    if (!name || !regionPhrasePattern(name).test(text)) continue;
    // Strictly-greater keeps the FIRST (lowest sortOrder) region among equal
    // lengths, preserving the original deterministic tie-break.
    if (best === null || name.length > best.length) best = name;
  }
  return best;
}

export function matchStudyRegion(
  hint: string | null | undefined,
  orderedRegionNames: string[],
): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  const primary = primaryExaminationClause(h);
  return longestContainedRegion(primary, orderedRegionNames) ?? longestContainedRegion(h, orderedRegionNames);
}

/**
 * Projection / plan / scope words that X-ray (and CT) Study Tabs carry in
 * their names but a billed procedure name usually does not. They are excluded
 * from the core-anatomy comparison, and used afterwards only to prefer the
 * most specific tab the hint actually names.
 */
const STUDY_TAB_VIEW_TOKENS = new Set([
  "pa",
  "ap",
  "lat",
  "lateral",
  "erect",
  "supine",
  "portable",
  "lordotic",
  "oblique",
  "obliq",
  "view",
  "views",
  "plain",
  "screening",
  "contrast",
  "11x14",
  "bl",
  "ul",
  "b",
  "l",
  "r",
]);

export function studyRegionTokens(value: string): string[] {
  const raw = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  // Abbreviation re-join. DICOM descriptions and billed names frequently
  // carry dotted or spaced abbreviations — "L.S. SPINE", "L S SPINE",
  // "T.L.S." — which the punctuation strip splits into single letters the
  // Study Tabs never use ("ls" is a tab token; "l","s" are not). Re-join each
  // run of single-letter tokens (pairs AND triples) so the abbreviation token
  // exists in the hint. Only the START of a run joins: "t l s" produces "tl"
  // and "tls" but NOT "ls", so "T.L.S." cannot masquerade as lumbar-sacral.
  // The single letters stay too — view tokens like "b"/"l" still match
  // individually, and nothing that resolved before can change, because these
  // joins are additions.
  const joined: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]!;
    joined.push(token);
    if (token.length !== 1) continue;
    if (i > 0 && raw[i - 1]!.length === 1) continue; // not the start of a run
    const a = raw[i + 1];
    if (a?.length === 1) {
      const pair = token + a;
      if (!joined.includes(pair)) joined.push(pair);
      const b = raw[i + 2];
      if (b?.length === 1) {
        const triple = pair + b;
        if (!joined.includes(triple)) joined.push(triple);
      }
    }
  }
  return joined;
}

/**
 * Abbreviations the billing catalogue uses for an anatomy a Study Tab spells
 * out. The keys are TAB tokens; the values are hint tokens that mean the same
 * thing.
 *
 * Live evidence (test-catalog export 2026-09-28): the lumbar films are billed as
 * `XRAYLSPINE` "X-RAY LS SPINE LAT" and `XR028` "XRAY LS SPINE AP/LAT", while the
 * Study Tab is "X-Ray Lumbar Spine". "ls" is not "lumbar", so the token fallback
 * still resolved nothing and these two studies opened with no protocol, no quick
 * findings and no content pack.
 *
 * `dl` ("XRAY DL SPINE AP/LAT", `XR022`) is deliberately NOT mapped to the dorsal
 * tab: a dorsolumbar study covers the thoracolumbar junction, and quietly filing
 * it under the dorsal-spine protocol would apply the wrong protocol to a patient
 * rather than leaving the radiologist to choose. It stays unresolved.
 */
const ANATOMY_HINT_SYNONYMS: Record<string, readonly string[]> = {
  lumbar: ["ls", "lumbosacral", "lumbo"],
  lumbosacral: ["ls", "lumbar"],
  // The reverse direction: the Study Tab abbreviates ("LS Spine") while the
  // hint spells it out ("MRI LUMBAR SPINE", "MR LUMBOSACRAL SPINE"). Scanner
  // StudyDescriptions routinely spell the anatomy in full, and without this
  // mapping the tab's "ls" token found nothing in the hint — the study fell
  // to the generic "Spine" tab, killing the protocol, the Smart Dictation
  // gate and the readiness score until someone clicked the region by hand.
  ls: ["lumbar", "lumbosacral", "lumbo"],
};

export function coreTokenInHint(token: string, hintTokens: Set<string>): boolean {
  if (hintTokens.has(token)) return true;
  return (ANATOMY_HINT_SYNONYMS[token] ?? []).some((synonym) => hintTokens.has(synonym));
}

/**
 * Token-aware fallback for the real naming gap between the billing catalogue
 * and the Study Tabs.
 *
 * Live evidence (test-catalog export): the only chest radiograph the centre
 * bills is code `XRAY-CHEST`, name `CHEST X-RAY`. The chest tabs are
 * "X-Ray Chest PA" / "X-Ray Chest AP" / "X-Ray Portable Chest" / "X-Ray Chest
 * Lateral". `matchStudyRegion` is a substring test, and "x-ray chest pa" is not
 * inside "cr chest x-ray" — word order differs — so the study resolved to
 * nothing and opened with no protocol, no quick findings and no content pack.
 *
 * A tab is a candidate when every one of its CORE ANATOMY tokens (modality
 * prefix and projection words removed) appears in the hint, directly or through
 * `ANATOMY_HINT_SYNONYMS`. Among candidates, the one sharing the most projection
 * words with the hint wins; a bare "CHEST X-RAY" therefore lands on the first
 * (lowest sortOrder) chest tab — the reference PA tab — rather than on nothing.
 *
 * This only ever overrides a substring match with a STRICTLY MORE SPECIFIC tab
 * (more core anatomy tokens matched — see resolveAutoStudyRegion), and it never
 * matches on a partial
 * word, so the billed > dicom > unresolved precedence and the longest-wins
 * contract are unchanged.
 */
export function matchStudyRegionByCoreAnatomy(
  hint: string | null | undefined,
  orderedRegionNames: string[],
): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (!studyRegionTokens(h).length) return null;
  // The same primary-examination rule as the substring match: this fallback is
  // reached for exactly the multi-word billed names where a supplementary
  // screening tab can also earn the projection-word bonus below.
  const primary = primaryExaminationClause(h);
  return coreAnatomyBest(primary, orderedRegionNames) ?? coreAnatomyBest(h, orderedRegionNames);
}

function coreAnatomyBest(hint: string, orderedRegionNames: string[]): string | null {
  const hintTokens = new Set(studyRegionTokens(hint));
  if (!hintTokens.size) return null;

  let best: string | null = null;
  let bestCoreSize = 0;
  let bestViewOverlap = -1;

  for (const name of orderedRegionNames) {
    if (!name) continue;
    const tokens = studyRegionTokens(stripStudyTabModalityPrefix(name));
    const core = tokens.filter((t) => !STUDY_TAB_VIEW_TOKENS.has(t));
    if (!core.length) continue;
    if (!core.every((t) => coreTokenInHint(t, hintTokens))) continue;

    const viewOverlap = tokens.filter((t) => STUDY_TAB_VIEW_TOKENS.has(t) && hintTokens.has(t)).length;
    // More core anatomy matched = more specific. Ties prefer more shared
    // projection words, then the earlier (lower sortOrder) tab.
    if (core.length > bestCoreSize || (core.length === bestCoreSize && viewOverlap > bestViewOverlap)) {
      best = name;
      bestCoreSize = core.length;
      bestViewOverlap = viewOverlap;
    }
  }
  return best;
}

export type AutoStudyRegionMatch = {
  region: string | null;
  /** Which hint produced `region`. null when unresolved. */
  source: "billed" | "dicom" | null;
  billedRegion: string | null;
  dicomRegion: string | null;
};

function composeStudyRegionHint(
  modality: string | null | undefined,
  freeText: string | null | undefined,
): string {
  const mod = (modality ?? "").trim();
  const text = (freeText ?? "").trim();
  if (!mod && !text) return "";
  if (!text) return mod;
  if (!mod) return text;
  return `${mod} ${text}`;
}

/**
 * Auto region at study-open: billed procedure name first, DICOM / worklist
 * StudyDescription second. Manual overrides stay outside this helper.
 */
export function resolveAutoStudyRegion(opts: {
  modality?: string | null;
  studyDescription?: string | null;
  /** Catalog / order test name (`testName` or `billedTestName` from worklist). */
  billedTestName?: string | null;
  orderedRegionNames: string[];
}): AutoStudyRegionMatch {
  const regions = opts.orderedRegionNames;
  const billedHint = composeStudyRegionHint(opts.modality, opts.billedTestName);
  const dicomHint = composeStudyRegionHint(opts.modality, opts.studyDescription);

  const billedRegion = billedHint ? resolveHintRegion(billedHint, regions) : null;
  const dicomRegion = dicomHint ? resolveHintRegion(dicomHint, regions) : null;

  if (billedRegion) {
    return { region: billedRegion, source: "billed", billedRegion, dicomRegion };
  }
  if (dicomRegion) {
    return { region: dicomRegion, source: "dicom", billedRegion: null, dicomRegion };
  }

  return { region: null, source: null, billedRegion: null, dicomRegion: null };
}

/**
 * One hint, two matchers, one answer.
 *
 * The substring match stays the spine of resolution (longest contained region
 * wins, exactly as documented). The token-aware core-anatomy match now runs on
 * EVERY hint — not only the ones the substring matcher missed — but it may
 * only ever UPGRADE the answer to a strictly more specific tab (more core
 * anatomy tokens), never swap it sideways. This closes the live gap where a
 * spelled-out description ("MRI LUMBAR SPINE") substring-matched only the
 * generic "Spine" tab and stopped there: the core-anatomy matcher, which
 * knows "ls" and "lumbar" name the same anatomy, never got to say "LS Spine".
 * A hint the substring matcher already resolved to its best specific tab is
 * untouched — same tab, or not strictly more specific, means no change.
 */
function resolveHintRegion(hint: string, orderedRegionNames: string[]): string | null {
  const substringMatch = matchStudyRegion(hint, orderedRegionNames);
  const coreMatch = matchStudyRegionByCoreAnatomy(hint, orderedRegionNames);
  if (!substringMatch) return coreMatch;
  if (!coreMatch || coreMatch === substringMatch) return substringMatch;
  return regionCoreTokenCount(coreMatch) > regionCoreTokenCount(substringMatch)
    ? coreMatch
    : substringMatch;
}

/** How many core anatomy tokens a Study Tab's name carries — its specificity.
 * "LS Spine" (2) is strictly more specific than "Spine" (1); "Cervical Spine"
 * (2) is not more specific than "LS Spine" (2). */
function regionCoreTokenCount(name: string): number {
  const tokens = studyRegionTokens(stripStudyTabModalityPrefix(name));
  return tokens.filter((t) => !STUDY_TAB_VIEW_TOKENS.has(t)).length;
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
