/**
 * xrayChestViews.ts — first-class VIEW / ADEQUACY state for chest radiography.
 *
 * Mirrors mriBrainSequences.ts: a key union, a parser over the Technique free
 * text, a conservative gate, and a statement-rule table. No DB change — the
 * Technique field is the single source of truth the workspace already has and
 * already persists, prints and reopens.
 *
 * The difference that matters clinically: an AP film is not a PA film. Cardiac
 * size is only assessable on a frontal PA projection, so every projection
 * dependent statement is gated here rather than in prose (spec §2, §7, §11).
 *
 * Views are *recorded*, never inferred from which Study Tab was picked: the
 * four chest tabs (X-Ray Chest PA / AP / Portable Chest / Lateral) name a
 * projection in their tab label, and a mis-picked tab must not be able to make
 * the report claim a view that was not performed.
 *
 * Pure functions only — no store, no React.
 */

export type XrayViewKey =
  | "pa"
  | "ap"
  | "apErect"
  | "apSupine"
  | "portableAp"
  | "lateral"
  | "lordotic"
  | "other";

export type XrayAdequacyKey =
  | "inspiration"
  | "rotation"
  | "penetration"
  | "motion"
  | "fieldInclusion";

export type XrayAdequacyGrade = "adequate" | "limited" | "unknown";

export type XrayTechniqueContext = {
  performed: Record<XrayViewKey, boolean>;
  adequacy: Record<XrayAdequacyKey, XrayAdequacyGrade>;
  /** True when the technique text names at least one view or limitation. */
  hasTechniqueSignal: boolean;
};

export const XRAY_VIEW_LABELS: Record<XrayViewKey, string> = {
  pa: "PA",
  ap: "AP",
  apErect: "AP erect",
  apSupine: "AP supine",
  portableAp: "portable AP",
  lateral: "lateral",
  lordotic: "lordotic",
  other: "other projection",
};

export const XRAY_ADEQUACY_LABELS: Record<XrayAdequacyKey, string> = {
  inspiration: "inspiration",
  rotation: "rotation",
  penetration: "penetration",
  motion: "motion",
  fieldInclusion: "field inclusion",
};

/**
 * `ap` is the general frontal-AP key and is true for every AP variant, so
 * gating can ask one question ("is any AP projection performed?") instead of
 * enumerating the positional qualifiers at every call site.
 *
 * The two-letter abbreviations are word-bounded and the spelled-out forms are
 * written in full: "eroposterior" is the tail of ANTEROposterior, so a loose
 * pattern would read an AP film as a PA one and hand cardiac size back to a
 * projection that cannot support it.
 */
const VIEW_PATTERNS: Array<{ key: XrayViewKey; re: RegExp }> = [
  { key: "pa", re: /\bpa\b|postero[- ]?anterior/i },
  { key: "ap", re: /\bap\b|antero[- ]?posterior/i },
  { key: "apErect", re: /\berect\b/i },
  { key: "apSupine", re: /\bsupine\b|\bdecubitus\b|lying\s+down/i },
  { key: "portableAp", re: /\bportable\b|\bat the bedside\b|bedside\b|\bicu\b/i },
  { key: "lateral", re: /\blat\b|\blateral\b/i },
  { key: "lordotic", re: /\blordotic\b|\blordosis\b/i },
  { key: "other", re: /\boblique\b|\bright anterior oblique\b|\bleft anterior oblique\b|\brao\b|\blao\b/i },
];

const INSPIRATION_ADEQUATE = /adequate inspiration|full inspiration|well expanded|satisfactory inspiration|adequately expanded/i;
const INSPIRATION_LIMITED = /low[- ]volume|poor inspiration|incomplete inspiration|inadequate inspiration|shallow breath|crowding of (the )?bronchovascular|under[- ]inflated|low lung volume/i;

// Patterns are written so an adequate form and a limited form cannot both fire
// on the same sentence. The bare words are the trap: "No significant rotation"
// and "No motion artifact" are adequacy statements that contain the very words
// a limitation search would match, so rotation/motion name the limitation
// phrase and motion guards its own negation.
const ROTATION_ADEQUATE = /no (significant )?rotation|not rotated|without rotation/i;
const ROTATION_LIMITED = /rotation limits|patient rotation|\brotated\b|malrotation|spinous process deviat/i;

const PENETRATION_ADEQUATE = /adequate penetration|satisfactory penetration|normal penetration/i;
const PENETRATION_LIMITED = /under[- ]?penetration|over[- ]?penetration|poor penetration|inadequate penetration/i;

const MOTION_ADEQUATE = /no motion|without motion|no movement artefact|no movement artifact/i;
const MOTION_LIMITED =
  /(?<!\bno )\bmotion (artifact|artefact)|(?<!\bno )\bmovement (artifact|artefact)|blurring due to motion/i;

const FIELD_ADEQUATE = /are (fully|adequately|clearly) included|complete inclusion|included in full/i;
const FIELD_LIMITED = /not (fully |adequately |clearly )?included|incomplete inclusion|excluded from (the )?(field|image)|costophrenic angles? not (seen|included|visuali[sz]ed)|apices? not (seen|included|visuali[sz]ed)|foreshortened/i;

const ADEQUACY_PATTERNS: Record<
  XrayAdequacyKey,
  { limited: RegExp; adequate: RegExp }
> = {
  inspiration: { limited: INSPIRATION_LIMITED, adequate: INSPIRATION_ADEQUATE },
  rotation: { limited: ROTATION_LIMITED, adequate: ROTATION_ADEQUATE },
  penetration: { limited: PENETRATION_LIMITED, adequate: PENETRATION_ADEQUATE },
  motion: { limited: MOTION_LIMITED, adequate: MOTION_ADEQUATE },
  fieldInclusion: { limited: FIELD_LIMITED, adequate: FIELD_ADEQUATE },
};

/**
 * An explicit adequate statement for the dimension is checked first: the
 * negative forms ("No significant rotation.", "No motion artifact.") contain
 * the very words the limitation patterns look for, and reading them as a
 * limitation would invert the technique report.
 */
function gradeAdequacy(text: string, key: XrayAdequacyKey): XrayAdequacyGrade {
  const { limited, adequate } = ADEQUACY_PATTERNS[key];
  const list = text
    .split(/[.\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.some((s) => adequate.test(s))) return "adequate";
  if (list.some((s) => limited.test(s))) return "limited";
  return "unknown";
}

export function parseXrayChestViews(
  text: string | null | undefined,
): XrayTechniqueContext {
  const t = (text ?? "").trim();
  const performed = {} as Record<XrayViewKey, boolean>;
  for (const { key, re } of VIEW_PATTERNS) {
    performed[key] = t.length > 0 && re.test(t);
  }
  // An erect / supine / portable qualifier is only a projection when the film
  // is frontal-AP: "lateral view, erect" must not invent an AP projection.
  const frontalAp = performed.ap;
  performed.apErect = frontalAp && /erect/i.test(t);
  performed.apSupine = frontalAp && (/\bsupine\b|\bdecubitus\b/i.test(t));
  performed.portableAp = frontalAp && (/\bportable\b|bedside|\bicu\b/i.test(t));

  const adequacy = {} as Record<XrayAdequacyKey, XrayAdequacyGrade>;
  let adequacySignal = false;
  (Object.keys(ADEQUACY_PATTERNS) as XrayAdequacyKey[]).forEach((key) => {
    const g = t.length > 0 ? gradeAdequacy(t, key) : "unknown";
    adequacy[key] = g;
    if (g !== "unknown") adequacySignal = true;
  });

  const viewSignal = VIEW_PATTERNS.some(({ key }) => performed[key] && key !== "other");
  return {
    performed,
    adequacy,
    hasTechniqueSignal: viewSignal || adequacySignal,
  };
}

/** Empty key list is permissive, matching sequenceAllows()'s contract. */
export function chestViewAllows(
  ctx: XrayTechniqueContext,
  key: XrayViewKey | XrayViewKey[],
): boolean {
  const keys = Array.isArray(key) ? key : [key];
  return keys.every((k) => ctx.performed[k]);
}

export function missingViewLabels(
  ctx: XrayTechniqueContext,
  keys: XrayViewKey[],
): string[] {
  return keys.filter((k) => !ctx.performed[k]).map((k) => XRAY_VIEW_LABELS[k]);
}

export function adequacyLimitedLabels(ctx: XrayTechniqueContext): string[] {
  return (Object.keys(ADEQUACY_PATTERNS) as XrayAdequacyKey[]).filter(
    (k) => ctx.adequacy[k] === "limited",
  ).map((k) => XRAY_ADEQUACY_LABELS[k]);
}

/** True when at least one frontal projection was performed (PA or AP). */
export function hasFrontalView(ctx: XrayTechniqueContext): boolean {
  return ctx.performed.pa || ctx.performed.ap;
}

export type CardiacAssessment = {
  allowed: boolean;
  /** AP films magnify the heart — the caveat the report must carry. */
  caveat?: string;
  /** Why a cardiac-size statement cannot be made at all. */
  blocked?: string;
};

/**
 * Projection-aware cardiac interpretation (spec §2, §7, §11). PA frontal → the
 * cardiac silhouette may be reported. AP-only → size is reportable only with
 * the magnification caveat, never as "cardiac size is normal" / cardiomegaly.
 * No frontal view at all → no cardiac-size statement.
 */
export function assessCardiacSize(ctx: XrayTechniqueContext): CardiacAssessment {
  if (ctx.performed.pa) return { allowed: true };
  if (ctx.performed.ap) {
    return {
      allowed: false,
      caveat:
        "The cardiac size cannot be accurately assessed on the AP projection; AP magnification can exaggerate heart size.",
    };
  }
  return {
    allowed: false,
    blocked:
      "No frontal (PA or AP) projection is recorded, so cardiac size is not assessed on this study.",
  };
}

/**
 * Statements that a projection or an adequate technique must support. Same
 * shape as SEQUENCE_STATEMENT_RULES: the contradiction checker warns when the
 * narrative asserts something the recorded technique cannot carry (spec §2, §17).
 */
export const TECHNIQUE_STATEMENT_RULES: Array<{
  /** Views that must all be performed for the statement to be supportable. */
  requires?: XrayViewKey[];
  /** Adequacy dimension that must not be "limited". */
  requiresAdequate?: XrayAdequacyKey;
  re: RegExp;
  label: string;
}> = [
  {
    // "PA-only assumption on AP": any unqualified cardiac-size verdict needs a
    // PA frontal film; on AP the report must say so (see assessCardiacSize).
    requires: ["pa"],
    re: /\bcardiac (size|silhouette)\b[^.]*\bnormal\b|\bnormal heart size\b|cardiothoracic ratio[^.]{0,30}\bnormal\b/i,
    label: "an unqualified normal-cardiac-size statement",
  },
  {
    requires: ["pa"],
    re: /\bcardiomegaly\b|heart (is )?enlarged|cardiac (silhouette is )?enlarged|increased cardiothoracic ratio/i,
    label: "a cardiomegaly assertion",
  },
  {
    requires: ["lateral"],
    re: /retrosternal (clear )?space|increased retrosternal|anterior (mediastinal )?silhouette on the lateral/i,
    label: "a lateral-view-dependent statement",
  },
  {
    requiresAdequate: "fieldInclusion",
    re: /costophrenic angles? (are )?clear|no (blunting of the )?costophrenic|angles? are sharp/i,
    label: "a costophrenic-angle assessment",
  },
  {
    requiresAdequate: "inspiration",
    re: /lung (volumes?|fields?)? (are )?(adequately |well )?expanded|fully expanded|hyperinflated|flattened diaphragms?/i,
    label: "a lung-volume statement",
  },
  {
    requiresAdequate: "rotation",
    re: /mediastinal width (is )?normal|no mediastinal widening|hilar (symmetry|contours?) (are )?normal/i,
    label: "a rotation-dependent mediastinal or hilar statement",
  },
  {
    requiresAdequate: "penetration",
    re: /retrocardiac (space|opacity) (is )?normal|no retrocardiac abnormality|behind the heart (is )?clear/i,
    label: "a penetration-dependent retrocardiac statement",
  },
  {
    requiresAdequate: "motion",
    re: /fine interstitial (detail|markings)|no early interstitial change|sharply defined fissures/i,
    label: "a motion-dependent fine-detail statement",
  },
];

/**
 * Canonical Technique sentences owned by this module. The canvas writes them
 * and parses them back, so a recorded view is both visible in the printed
 * report and machine-checkable — and toggling one never rewrites the
 * radiologist's own technique prose.
 */
export const XRAY_VIEW_SENTENCES: Record<Exclude<XrayViewKey, "other">, string> = {
  pa: "PA erect chest radiograph.",
  ap: "AP chest radiograph.",
  apErect: "Erect positioning.",
  apSupine: "Supine positioning.",
  portableAp: "Portable examination performed at the bedside.",
  lateral: "Additional lateral projection obtained.",
  lordotic: "Lordotic projection obtained.",
};

export const XRAY_ADEQUACY_SENTENCES: Record<
  XrayAdequacyKey,
  { adequate: string; limited: string }
> = {
  inspiration: {
    adequate: "Adequate inspiration.",
    limited: "Low-volume film with crowding of bronchovascular markings.",
  },
  rotation: {
    adequate: "No significant rotation.",
    limited: "Patient rotation limits assessment of mediastinal width and hilar symmetry.",
  },
  penetration: {
    adequate: "Adequate penetration.",
    limited: "Underpenetration limits assessment of the mediastinum and retrocardiac region.",
  },
  motion: {
    adequate: "No motion artifact.",
    limited: "Motion artifact limits assessment of fine interstitial detail.",
  },
  fieldInclusion: {
    adequate: "Apices and costophrenic angles are fully included.",
    limited: "The apices and/or costophrenic angles are not fully included.",
  },
};

/** Split on sentence boundaries, keeping any non-sentence remainder intact. */
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
 * Remove only the sentences belonging to ONE dimension. Toggling the lateral
 * must not erase a recorded PA, and clearing rotation must not clear
 * inspiration — each key owns exactly its own canonical sentences.
 */
function removeSentences(text: string, doomed: Set<string>): string {
  return joinSentences(toSentences(text).filter((s) => !doomed.has(s)));
}

export function toggleViewInTechnique(
  text: string | null | undefined,
  key: XrayViewKey,
  on: boolean,
): string {
  // "other" has no canonical sentence — the radiologist writes the projection.
  if (key === "other") return (text ?? "").trim();
  const base = removeSentences((text ?? "").trim(), new Set([XRAY_VIEW_SENTENCES[key]]));
  const ordered = toSentences(base);
  if (on) ordered.push(XRAY_VIEW_SENTENCES[key]);
  return joinSentences(ordered);
}

export function setAdequacyInTechnique(
  text: string | null | undefined,
  key: XrayAdequacyKey,
  grade: XrayAdequacyGrade,
): string {
  const pair = XRAY_ADEQUACY_SENTENCES[key];
  const base = removeSentences((text ?? "").trim(), new Set([pair.adequate, pair.limited]));
  const ordered = toSentences(base);
  if (grade !== "unknown") ordered.push(grade === "adequate" ? pair.adequate : pair.limited);
  return joinSentences(ordered);
}

/**
 * AP magnification caveat the report must carry when heart size is discussed on
 * a projection that overestimates it (spec §2 "AP magnification must not be
 * treated like PA").
 */
export function apMagnificationCaveat(ctx: XrayTechniqueContext): string | null {
  if (ctx.performed.pa) return null;
  if (ctx.performed.ap) {
    return "Allowing for AP projection and magnification,";
  }
  return null;
}

/** Statements in `text` that the recorded technique cannot support. */
export function unsupportedTechniqueStatements(
  ctx: XrayTechniqueContext,
  text: string,
): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const out: string[] = [];
  for (const rule of TECHNIQUE_STATEMENT_RULES) {
    if (!rule.re.test(t)) continue;
    if (rule.requires && !rule.requires.every((k) => ctx.performed[k])) {
      out.push(`${rule.label} — performed views: ${missingViewLabels(ctx, rule.requires).join(", ")} not recorded`);
      continue;
    }
    if (rule.requiresAdequate && ctx.adequacy[rule.requiresAdequate] === "limited") {
      out.push(`${rule.label} — ${XRAY_ADEQUACY_LABELS[rule.requiresAdequate]} recorded as limited`);
    }
  }
  return out;
}
