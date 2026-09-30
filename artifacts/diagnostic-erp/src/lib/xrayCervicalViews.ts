/**
 * xrayCervicalViews.ts — first-class VIEW / ADEQUACY state for cervical
 * radiography (spec §2).
 *
 * Same architecture as xrayChestViews.ts, which is deliberately mirrored rather
 * than abstracted: the repo's spine modules (mriCervicalLevelState /
 * mriLumbarLevelState / mriDorsalLevelState) each own their own vocabulary, and
 * cervical radiography needs views that exist nowhere in MRI — open-mouth
 * odontoid, swimmer's, flexion/extension, and a recorded inferior visualization
 * limit. The Technique field remains the single source of truth: no DB change,
 * the state persists, prints and reopens with the report.
 *
 * The three gates that make this file worth having:
 *  - odontoid / C1-C2 statements need an odontoid view that was adequately seen;
 *  - a structured foraminal claim needs the oblique view for that side;
 *  - any dynamic statement needs flexion AND extension actually performed.
 * None of them can be satisfied by a Study Tab name — views are recorded, never
 * inferred (spec §2, §5, §8, §10).
 *
 * Pure functions only — no store, no React.
 */

export type XrayCervicalViewKey =
  | "ap"
  | "lateral"
  | "odontoid"
  | "obliqueRight"
  | "obliqueLeft"
  | "flexion"
  | "extension"
  | "swimmers"
  | "other";

export type XrayCervicalAdequacyKey =
  | "c7t1Visualization"
  | "odontoidVisualization"
  | "lateralMassVisualization"
  | "rotation"
  | "motion";

export type XrayAdequacyGrade = "adequate" | "limited" | "unknown";

/** Lowest cervical level the film actually shows (spec §2, §5). */
export type VisualizedInferiorLevel = "C5" | "C6" | "C7" | "T1" | "T2" | "unknown";

export type XrayCervicalTechniqueContext = {
  performed: Record<XrayCervicalViewKey, boolean>;
  adequacy: Record<XrayCervicalAdequacyKey, XrayAdequacyGrade>;
  visualizedInferiorLevel: VisualizedInferiorLevel;
  /** True when the technique text names a view, a limitation or a level. */
  hasTechniqueSignal: boolean;
};

export const XRAY_CERVICAL_VIEW_LABELS: Record<XrayCervicalViewKey, string> = {
  ap: "AP",
  lateral: "lateral",
  odontoid: "open-mouth odontoid",
  obliqueRight: "right oblique",
  obliqueLeft: "left oblique",
  flexion: "flexion",
  extension: "extension",
  swimmers: "swimmer's",
  other: "other projection",
};

export const XRAY_CERVICAL_ADEQUACY_LABELS: Record<XrayCervicalAdequacyKey, string> = {
  c7t1Visualization: "C7-T1 visualization",
  odontoidVisualization: "odontoid visualization",
  lateralMassVisualization: "C1 lateral masses",
  rotation: "rotation",
  motion: "motion",
};

const VIEW_PATTERNS: Array<{ key: XrayCervicalViewKey; re: RegExp }> = [
  { key: "ap", re: /\bap\b|antero[- ]?posterior/i },
  { key: "lateral", re: /\blat\b|\blateral\b/i },
  {
    key: "odontoid",
    re: /odontoid|open[- ]mouth|(\bfossa[- ]?oval\b)|(\b(c1[- ]c2|atlanto[- ]?axial)\s+view)/i,
  },
  { key: "obliqueRight", re: /right oblique|\broblique\b|\bro\b/i },
  { key: "obliqueLeft", re: /left oblique|\bloblique\b|\blo\b/i },
  { key: "flexion", re: /\bflexion\b|\bflexed\b/i },
  { key: "extension", re: /\bextension\b|\bextended\b/i },
  { key: "swimmers", re: /swimmer'?s?|(\bswimmer\b)/i },
  { key: "other", re: /\boblique\b|(\bhorizontal beam\b)|(\bdecubitus\b)/i },
];

/**
 * The inferior-visualization limit. Written and read back as one canonical
 * sentence, so "the film stops at C6" is machine-checkable and the normal
 * baseline cannot certify C7-T1 on it (spec §5).
 */
const INFERIOR_LEVEL_PATTERNS: Array<{ level: VisualizedInferiorLevel; re: RegExp }> = [
  { level: "T2", re: /\bextends? to t2\b|\bup to t2\b|\bt2 (?:is )?visuali[sz]ed\b/i },
  { level: "T1", re: /\bextends? to t1\b|\bup to t1\b|\bt1 (?:is )?visuali[sz]ed\b|\bc7[- ]t1 (?:is |are )?(?:clearly |adequately |fully )?visuali[sz]ed|\bc7[- ]t1 (?:seen|demonstrated|included)\b/i },
  { level: "C7", re: /\bextends? to c7\b|\bup to c7\b|\bc7 (?:is )?visuali[sz]ed\b/i },
  { level: "C6", re: /\bextends? to c6\b|\bup to c6\b|\bc6 (?:is )?visuali[sz]ed\b/i },
  { level: "C5", re: /\bextends? to c5\b|\bup to c5\b|\bc5 (?:is )?visuali[sz]ed\b/i },
];

/** Phrases that explicitly say the lower cervical spine is NOT seen. */
const INFERIOR_LEVEL_INADEQUATE =
  /c7[- ]t1 (?:is |was |are )?(?:not|poorly|inadequately|not adequately)\s*(?:seen|visuali[sz]ed|demonstrated|included)|lower cervical (?:spine )?(?:is )?not (?:seen|visuali[sz]ed)|inadequate (?:visualization|demonstration) of c7[- ]t1|\bc7[- ]t1 (?:not seen|obscured)|cannot (?:be )?assessed (?:at|through) c7[- ]t1/i;

const C7T1_ADEQUATE = /c7[- ]t1 (?:is |are )?(?:adequately |clearly |fully |well )?(?:visuali[sz]ed|seen|demonstrated|included)|c7[- ]t1 (?:is |are )?adequate/i;
const C7T1_LIMITED = INFERIOR_LEVEL_INADEQUATE;

const ODONTOID_ADEQUATE =
  /odontoid (?:is |was )?(?:adequately |clearly |well |fully )?visuali[sz]ed|odontoid (?:is )?(?:adequate|well seen)|c1[- ]c2 (?:is |are )?adequately visuali[sz]ed|open[- ]mouth view (?:is )?adequate/i;
const ODONTOID_LIMITED =
  /odontoid (?:is |was )?(?:not|poorly|inadequately|not adequately)\s*(?:seen|visuali[sz]ed|demonstrated)|odontoid (?:not seen|obscured|masked)|c1[- ]c2 (?:is |are )?not (?:seen|visuali[sz]ed|demonstrated)|open[- ]mouth view (?:is )?(?:inadequate|poor|not diagnostic|obscured)/i;

const LATERAL_MASS_ADEQUATE =
  /c1 lateral masses (?:are |is )?(?:adequately |clearly )?visuali[sz]ed|lateral masses (?:are )?(?:adequate|well seen)/i;
const LATERAL_MASS_LIMITED =
  /c1 lateral masses (?:are )?not (?:adequately )?visuali[sz]ed|lateral masses (?:are )?(?:poorly|inadequately) seen|lateral masses (?:are )?obscured/i;

const ROTATION_ADEQUATE = /no (?:significant )?rotation|not rotated|without rotation/i;
const ROTATION_LIMITED = /rotation limits|patient rotation|\brotated\b|malrotation|spinous process deviat/i;

const MOTION_ADEQUATE = /no motion|without motion|no movement artefact|no movement artifact/i;
const MOTION_LIMITED =
  /(?<!\bno )\bmotion (?:artifact|artefact)|(?<!\bno )\bmovement (?:artifact|artefact)|blurring due to motion/i;

const ADEQUACY_PATTERNS: Record<
  XrayCervicalAdequacyKey,
  { limited: RegExp; adequate: RegExp }
> = {
  c7t1Visualization: { limited: C7T1_LIMITED, adequate: C7T1_ADEQUATE },
  odontoidVisualization: { limited: ODONTOID_LIMITED, adequate: ODONTOID_ADEQUATE },
  lateralMassVisualization: { limited: LATERAL_MASS_LIMITED, adequate: LATERAL_MASS_ADEQUATE },
  rotation: { limited: ROTATION_LIMITED, adequate: ROTATION_ADEQUATE },
  motion: { limited: MOTION_LIMITED, adequate: MOTION_ADEQUATE },
};

/**
 * Adequate first: the negative forms ("No significant rotation.", "No motion
 * artifact.") contain the very words the limitation patterns look for, and
 * reading them as a limitation would invert the technique report.
 */
function gradeAdequacy(text: string, key: XrayCervicalAdequacyKey): XrayAdequacyGrade {
  const { limited, adequate } = ADEQUACY_PATTERNS[key];
  const list = text
    .split(/[.\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.some((s) => adequate.test(s))) return "adequate";
  if (list.some((s) => limited.test(s))) return "limited";
  return "unknown";
}

function gradeInferiorLevel(text: string): VisualizedInferiorLevel {
  if (INFERIOR_LEVEL_INADEQUATE.test(text)) return "unknown";
  for (const { level, re } of INFERIOR_LEVEL_PATTERNS) {
    if (re.test(text)) return level;
  }
  return "unknown";
}

export function parseXrayCervicalViews(
  text: string | null | undefined,
): XrayCervicalTechniqueContext {
  const t = (text ?? "").trim();
  const performed = {} as Record<XrayCervicalViewKey, boolean>;
  for (const { key, re } of VIEW_PATTERNS) {
    performed[key] = t.length > 0 && re.test(t);
  }

  const adequacy = {} as Record<XrayCervicalAdequacyKey, XrayAdequacyGrade>;
  let adequacySignal = false;
  (Object.keys(ADEQUACY_PATTERNS) as XrayCervicalAdequacyKey[]).forEach((key) => {
    const g = t.length > 0 ? gradeAdequacy(t, key) : "unknown";
    adequacy[key] = g;
    if (g !== "unknown") adequacySignal = true;
  });

  const visualizedInferiorLevel = t.length > 0 ? gradeInferiorLevel(t) : "unknown";

  const viewSignal = VIEW_PATTERNS.some(({ key }) => performed[key] && key !== "other");
  return {
    performed,
    adequacy,
    visualizedInferiorLevel,
    hasTechniqueSignal:
      viewSignal || adequacySignal || visualizedInferiorLevel !== "unknown",
  };
}

/** Empty key list is permissive, matching chestViewAllows()'s contract. */
export function cervicalViewAllows(
  ctx: XrayCervicalTechniqueContext,
  key: XrayCervicalViewKey | XrayCervicalViewKey[],
): boolean {
  const keys = Array.isArray(key) ? key : [key];
  return keys.every((k) => ctx.performed[k]);
}

export function missingCervicalViewLabels(
  ctx: XrayCervicalTechniqueContext,
  keys: XrayCervicalViewKey[],
): string[] {
  return keys.filter((k) => !ctx.performed[k]).map((k) => XRAY_CERVICAL_VIEW_LABELS[k]);
}

export function cervicalAdequacyLimitedLabels(ctx: XrayCervicalTechniqueContext): string[] {
  return (Object.keys(ADEQUACY_PATTERNS) as XrayCervicalAdequacyKey[])
    .filter((k) => ctx.adequacy[k] === "limited")
    .map((k) => XRAY_CERVICAL_ADEQUACY_LABELS[k]);
}

/** True when the film demonstrably reaches C7-T1. */
export function c7t1Visualized(ctx: XrayCervicalTechniqueContext): boolean {
  if (ctx.adequacy.c7t1Visualization === "limited") return false;
  return ctx.visualizedInferiorLevel === "T1" || ctx.visualizedInferiorLevel === "T2";
}

export type CervicalGate = {
  allowed: boolean;
  /** Why the statement cannot be made — also the wording the canvas shows. */
  reason?: string;
};

/**
 * Odontoid / C1-C2 interpretation (spec §8). An inadequately seen odontoid is
 * the classic missed fracture, so a normal odontoid line is only permitted when
 * the view exists and was actually diagnostic.
 */
export function assessOdontoid(ctx: XrayCervicalTechniqueContext): CervicalGate {
  if (!ctx.performed.odontoid) {
    return {
      allowed: false,
      reason:
        "No open-mouth odontoid view is recorded, so the odontoid and C1-C2 lateral masses are not assessed on this study.",
    };
  }
  if (ctx.adequacy.odontoidVisualization === "limited") {
    return {
      allowed: false,
      reason:
        "The odontoid view is recorded as inadequately visualized, so odontoid and C1-C2 integrity cannot be certified from it.",
    };
  }
  return { allowed: true };
}

/**
 * Structured foraminal assessment (spec §6). Requires the oblique that shows
 * that side; a rotated film invalidates the comparison either way.
 */
export function assessForaminal(
  ctx: XrayCervicalTechniqueContext,
  side: "right" | "left" | "bilateral",
): CervicalGate {
  const needed: XrayCervicalViewKey[] =
    side === "bilateral" ? ["obliqueRight", "obliqueLeft"] : [side === "right" ? "obliqueRight" : "obliqueLeft"];
  const missing = missingCervicalViewLabels(ctx, needed);
  if (missing.length) {
    return {
      allowed: false,
      reason: `Neural foraminal assessment requires the ${needed.map((k) => XRAY_CERVICAL_VIEW_LABELS[k]).join(" and ")} view, which ${missing.length > 1 ? "were" : "was"} not performed (${missing.join(", ")}).`,
    };
  }
  if (ctx.adequacy.rotation === "limited") {
    return {
      allowed: false,
      reason:
        "Patient rotation limits the oblique views, so a structured foraminal assessment is not supportable.",
    };
  }
  return { allowed: true };
}

/**
 * Dynamic interpretation (spec §10). Translation and angular change only exist
 * between positions, so both flexion and extension must have been performed;
 * a single positional film may be described but cannot carry a dynamic claim.
 */
export function assessDynamic(ctx: XrayCervicalTechniqueContext): CervicalGate {
  const missing = missingCervicalViewLabels(ctx, ["flexion", "extension"]);
  if (missing.length === 2) {
    return {
      allowed: false,
      reason:
        "No flexion or extension views are recorded, so dynamic alignment cannot be assessed. Neutral films cannot demonstrate instability.",
    };
  }
  if (missing.length === 1) {
    return {
      allowed: false,
      reason: `Dynamic translation requires both positions; the ${missing.join(", ")} view was not performed.`,
    };
  }
  if (ctx.adequacy.c7t1Visualization === "limited") {
    return {
      allowed: false,
      reason:
        "The lower cervical spine is not adequately visualized, so translation at the lower levels cannot be measured.",
    };
  }
  return { allowed: true };
}

/** C7-T1 disc-space statement gate (spec §4, §5 — "when seen"). */
export function assessC7T1(ctx: XrayCervicalTechniqueContext): CervicalGate {
  if (c7t1Visualized(ctx)) return { allowed: true };
  if (ctx.adequacy.c7t1Visualization === "limited") {
    return {
      allowed: false,
      reason: "C7-T1 is recorded as not adequately visualized on this study.",
    };
  }
  return {
    allowed: false,
    reason:
      "The inferior visualization limit is not recorded, so C7-T1 cannot be certified on this study.",
  };
}

/**
 * Statements that a performed view or an adequate technique must support
 * (spec §2, §15). Same shape as TECHNIQUE_STATEMENT_RULES in the chest module.
 */
export const CERVICAL_TECHNIQUE_STATEMENT_RULES: Array<{
  requires?: XrayCervicalViewKey[];
  requiresAdequate?: XrayCervicalAdequacyKey[];
  /** Also blocked when the inferior limit does not reach this level. */
  requiresInferiorLevel?: "T1";
  re: RegExp;
  label: string;
}> = [
  {
    requires: ["odontoid"],
    re: /\bodontoid\b|dens|atlanto[- ]?(?:axial|dental)|\bc1[- ]c2\b|\blateral masses?\b/i,
    label: "an odontoid / C1-C2 statement",
  },
  {
    requiresAdequate: ["odontoidVisualization"],
    re: /odontoid (?:is |was )?(?:intact|normal|unremarkable)|atlanto[- ]?axial alignment (?:is )?(?:maintained|normal)/i,
    label: "a normal odontoid / atlanto-axial certification",
  },
  {
    re: /neural foramina? (?:are |is )?(?:patent|normal|clear)|foraminal (?:narrowing|stenosis|reduction)/i,
    // Side-specific adequacy is checked by assessForaminal(); the rule below
    // catches the general case where no oblique exists at all.
    requires: ["obliqueRight", "obliqueLeft"],
    label: "a foraminal statement",
  },
  {
    requires: ["flexion", "extension"],
    re: /flexion|extension|dynamic translation|instability/i,
    label: "a dynamic-alignment statement",
  },
  {
    requiresInferiorLevel: "T1",
    re: /c7[- ]t1/i,
    label: "a C7-T1 statement",
  },
];

export function unsupportedCervicalTechniqueStatements(
  ctx: XrayCervicalTechniqueContext,
  text: string | null | undefined,
): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const out: string[] = [];
  for (const rule of CERVICAL_TECHNIQUE_STATEMENT_RULES) {
    if (!rule.re.test(t)) continue;
    // A rule with only a "requiresAdequate" dimension is checked independently
    // of the view requirement, so list the reason that actually failed.
    if (rule.requires && !rule.requires.every((k) => ctx.performed[k])) {
      // An "or" requirement: foraminal rules accept either oblique if present.
      const anyPresent = rule.requires.some((k) => ctx.performed[k]);
      if (!(rule.label.startsWith("a foraminal") && anyPresent)) {
        out.push(`${rule.label} without ${rule.requires.map((k) => XRAY_CERVICAL_VIEW_LABELS[k]).join(" + ")} recorded`);
        continue;
      }
    }
    if (rule.requiresAdequate && rule.requiresAdequate.some((k) => ctx.adequacy[k] === "limited")) {
      out.push(
        `${rule.label} although ${rule.requiresAdequate
          .filter((k) => ctx.adequacy[k] === "limited")
          .map((k) => XRAY_CERVICAL_ADEQUACY_LABELS[k])
          .join(", ")} is recorded as limited`,
      );
      continue;
    }
    if (rule.requiresInferiorLevel === "T1" && !c7t1Visualized(ctx)) {
      out.push(`${rule.label} when the inferior visualization limit is ${ctx.visualizedInferiorLevel}`);
    }
  }
  return out;
}

/* ───────────────────────── canonical Technique sentences ────────────────── */

/**
 * Canonical Technique sentences owned by this module. The canvas writes them
 * and parses them back, so a recorded view is visible in the printed report and
 * machine-checkable, and toggling one never rewrites the radiologist's own
 * technique prose.
 */
export const XRAY_CERVICAL_VIEW_SENTENCES: Record<Exclude<XrayCervicalViewKey, "other">, string> = {
  ap: "AP cervical radiograph.",
  lateral: "Lateral cervical radiograph.",
  odontoid: "Open-mouth odontoid view.",
  obliqueRight: "Right oblique views.",
  obliqueLeft: "Left oblique views.",
  flexion: "Flexion view.",
  extension: "Extension view.",
  swimmers: "Swimmer's view.",
};

export const XRAY_CERVICAL_ADEQUACY_SENTENCES: Record<
  XrayCervicalAdequacyKey,
  { adequate: string; limited: string }
> = {
  c7t1Visualization: {
    adequate: "C7-T1 is adequately visualized.",
    limited: "C7-T1 is not adequately visualized.",
  },
  odontoidVisualization: {
    adequate: "The odontoid is adequately visualized.",
    limited: "The odontoid is not adequately visualized.",
  },
  lateralMassVisualization: {
    adequate: "The C1 lateral masses are adequately visualized.",
    limited: "The C1 lateral masses are not adequately visualized.",
  },
  rotation: {
    adequate: "No significant rotation.",
    limited: "Patient rotation limits assessment of alignment and the oblique views.",
  },
  motion: {
    adequate: "No motion artifact.",
    limited: "Motion artifact limits assessment of fine osseous detail.",
  },
};

export const XRAY_CERVICAL_INFERIOR_LEVEL_SENTENCES: Record<
  Exclude<VisualizedInferiorLevel, "unknown">,
  string
> = {
  C5: "The inferior visualization extends to C5.",
  C6: "The inferior visualization extends to C6.",
  C7: "The inferior visualization extends to C7.",
  T1: "The inferior visualization extends to T1.",
  T2: "The inferior visualization extends to T2.",
};

function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinSentences(list: string[]): string {
  return list.reduce((acc, s) => (acc ? `${acc} ${s}` : s), "").trim();
}

/**
 * Remove only the sentences belonging to ONE key. Recording a lateral must not
 * erase a recorded odontoid view; each key owns exactly its own sentences.
 * Sentences this module ever wrote are removed; radiologist prose is preserved.
 */
function removeOwned(text: string, doomed: Set<string>): string {
  return joinSentences(
    toSentences(text).filter((s) => !doomed.has(s) && !doomed.has(s.replace(/\s+/g, " "))),
  );
}

export function toggleCervicalViewInTechnique(
  text: string | null | undefined,
  key: XrayCervicalViewKey,
  on: boolean,
): string {
  // "other" has no canonical sentence — the radiologist writes the projection,
  // so the model can never assert a view it did not record.
  if (key === "other") return (text ?? "").trim();
  const base = removeOwned((text ?? "").trim(), new Set([XRAY_CERVICAL_VIEW_SENTENCES[key]]));
  const ordered = toSentences(base);
  if (on) ordered.push(XRAY_CERVICAL_VIEW_SENTENCES[key]);
  return joinSentences(ordered);
}

export function setCervicalAdequacyInTechnique(
  text: string | null | undefined,
  key: XrayCervicalAdequacyKey,
  grade: XrayAdequacyGrade,
): string {
  const pair = XRAY_CERVICAL_ADEQUACY_SENTENCES[key];
  const base = removeOwned((text ?? "").trim(), new Set([pair.adequate, pair.limited]));
  const ordered = toSentences(base);
  if (grade !== "unknown") ordered.push(grade === "adequate" ? pair.adequate : pair.limited);
  return joinSentences(ordered);
}

export function setCervicalInferiorLevelInTechnique(
  text: string | null | undefined,
  level: VisualizedInferiorLevel,
): string {
  const doomed = new Set<string>(Object.values(XRAY_CERVICAL_INFERIOR_LEVEL_SENTENCES));
  const base = removeOwned((text ?? "").trim(), doomed);
  const ordered = toSentences(base);
  if (level !== "unknown") ordered.push(XRAY_CERVICAL_INFERIOR_LEVEL_SENTENCES[level]);
  return joinSentences(ordered);
}

/**
 * The wording a normal odontoid line must take when the view cannot support it
 * (spec §5: a normal preset must not falsely certify inadequately seen anatomy).
 */
export function odontoidNotAssessedSentence(ctx: XrayCervicalTechniqueContext): string {
  return assessOdontoid(ctx).allowed
    ? "Odontoid and C1-C2 alignment are unremarkable."
    : "The odontoid and C1-C2 are unremarkable when adequately visualized on the views obtained.";
}
