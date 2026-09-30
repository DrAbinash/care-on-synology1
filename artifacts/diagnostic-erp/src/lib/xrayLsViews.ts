/**
 * xrayLsViews.ts — first-class VIEW / ADEQUACY / COVERAGE state for lumbosacral
 * radiography (spec §2).
 *
 * Mirrors xrayCervicalViews.ts deliberately rather than abstracting a shared
 * "xraySpineViews" module: the repo's spine family already gives each segment its
 * own vocabulary (mriLumbarLevelState / mriCervicalLevelState /
 * mriDorsalLevelState), and LS films need coverage dimensions that exist nowhere
 * in the cervical model — the lumbosacral junction, the posterior elements the
 * pars claim depends on, T12-L1 inclusion and the SI joints. The Technique field
 * stays the single source of truth: no schema change, the state persists, prints
 * and reopens with the report.
 *
 * The gates this exists to enforce (spec §2, §7, §8, §9, §13):
 *  - a pars / spondylolysis claim needs a lateral film with the posterior
 *    elements actually adequately seen, and a unilateral defect additionally
 *    needs an oblique — "do not diagnose a pars defect from an equivocal
 *    projection alone";
 *  - any dynamic claim needs flexion AND extension;
 *  - L5-S1 statements need the lumbosacral junction visualized (or a spot view);
 *  - T12-L1 statements need the upper junction in the field of view;
 *  - SI-joint statements need an AP that actually shows them.
 *
 * One parsing rule differs from the chest and cervical modules and matters a
 * great deal: the seeded LS protocol text is "AP and lateral views of the lumbar
 * spine (with flexion-extension views where indicated)". A conditional or a
 * requirement is not an achievement, so clauses that say "where indicated", "if
 * indicated", "not performed" or "not included" never set a view — while the AP
 * and the lateral carried by the same sentence still do.
 *
 * Pure functions only — no store, no React.
 */

export type XrayLsViewKey =
  | "ap"
  | "lateral"
  | "obliqueRight"
  | "obliqueLeft"
  | "flexion"
  | "extension"
  | "spotL5S1"
  | "other";

export type XrayLsAdequacyKey =
  | "l5s1Visualization"
  | "posteriorElementVisualization"
  | "t12l1Included"
  | "siJointVisualization"
  | "rotation"
  | "motion";

export type XrayAdequacyGrade = "adequate" | "limited" | "unknown";

export type XrayLsTechniqueContext = {
  performed: Record<XrayLsViewKey, boolean>;
  adequacy: Record<XrayLsAdequacyKey, XrayAdequacyGrade>;
  /** Lowest segment the film demonstrably shows: "L5-S1", "S1" or "unknown". */
  inferiorCoverage: "L5-S1" | "S1" | "unknown";
  hasTechniqueSignal: boolean;
};

export const XRAY_LS_VIEW_LABELS: Record<XrayLsViewKey, string> = {
  ap: "AP",
  lateral: "lateral",
  obliqueRight: "right oblique",
  obliqueLeft: "left oblique",
  flexion: "flexion",
  extension: "extension",
  spotL5S1: "spot L5-S1",
  other: "other projection",
};

export const XRAY_LS_ADEQUACY_LABELS: Record<XrayLsAdequacyKey, string> = {
  l5s1Visualization: "L5-S1 visualization",
  posteriorElementVisualization: "posterior elements",
  t12l1Included: "T12-L1 inclusion",
  siJointVisualization: "sacroiliac joints",
  rotation: "rotation",
  motion: "motion",
};

const VIEW_PATTERNS: Array<{ key: XrayLsViewKey; re: RegExp }> = [
  { key: "ap", re: /\bap\b|antero[- ]?posterior/i },
  { key: "lateral", re: /\blat\b|\blateral\b/i },
  { key: "obliqueRight", re: /right oblique|\bro\b/i },
  { key: "obliqueLeft", re: /left oblique|\blo\b/i },
  { key: "flexion", re: /\bflexion\b|\bflexed\b/i },
  { key: "extension", re: /\bextension\b|\bextended\b/i },
  { key: "spotL5S1", re: /spot(?:\s|-)?(l5[- ]?s1)?|l5[- ]s1 (?:spot|view)|coned[- ]?down|cone[- ]down/i },
  { key: "other", re: /\boblique\b|(\bferguson\b)|(\bdecubitus\b)|(\bstanding\b)/i },
];

/**
 * A view named inside a conditional, a requirement or a negation is not a
 * recorded view. This is what stops the seeded "(with flexion-extension views
 * where indicated)" from opening the dynamic workflow on a neutral film.
 */
const NOT_A_PERFORMANCE =
  /where indicated|if indicated|when indicated|as indicated|as (?:needed|required)|may (?:be|include)|can (?:be|include)|consider|not performed|not obtained|not included|not done|were not|was not|not available|adequacy requires|requires? (?:visualization|inclusion|assessment)/i;

/** A clause that denies rather than records: "no oblique views", "not included". */
const DENIES_VIEWS = /\bno\b|\bnone\b|\bneither\b|\bnot\b|^\s*nil\b/i;

/** Words that separate one performance claim from the next inside a sentence. */
const CLAUSE_SEPARATORS = /([,;]|\bwith\b|\bincluding\b|\bplus\b|\bwithout\b|\bexcept\b|\bunless\b)/i;

/**
 * The performance claims of a technique description, one clause at a time.
 *
 * Clause rather than sentence granularity is not a nicety: the LS protocol that
 * ships in `zzzz_xr_gold_standard_content.sql` is "AP and lateral views of the
 * lumbar spine (with flexion-extension views where indicated).". Dropping the
 * whole sentence because it carries a conditional would also drop the AP and the
 * lateral, and the SI-joint and pars gates that read those views would then
 * refuse statements the film genuinely supports. So the conditional
 * parenthetical is removed and the rest of the sentence is kept, and a clause
 * introduced by "without"/"except" states absence rather than a view.
 */
function performanceClauses(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|[\n]+/)) {
    const stripped = sentence.replace(/\(([^)]*)\)/g, (whole, inner: string) =>
      NOT_A_PERFORMANCE.test(inner) ? " " : whole,
    );
    const parts = stripped.split(CLAUSE_SEPARATORS);
    for (let i = 0; i < parts.length; i += 2) {
      const raw = (parts[i] ?? "").trim();
      if (!raw) continue;
      const separator = (parts[i - 1] ?? "").toLowerCase();
      if (/without|except|unless/.test(separator)) continue;
      if (NOT_A_PERFORMANCE.test(raw)) continue;
      if (DENIES_VIEWS.test(raw)) continue;
      out.push(raw);
    }
  }
  return out;
}

/**
 * Adequacy rules. Four of the six dimensions are *visibility* dimensions — a
 * subject plus a seeing-verb, and the polarity is decided by whether the clause
 * negates or hedges it — and two are *polarity* dimensions where the words that
 * name the problem ("rotation", "motion artifact") also appear in the reassuring
 * sentence ("No significant rotation."), so they need their own pair of patterns.
 *
 * A hedge is graded as a limitation, not as adequacy: "The sacroiliac joints,
 * where visualized, are unremarkable." is the seeded normal prose precisely
 * because the writer is not claiming the joints were fully seen, and CARE must
 * not read its own caution back as an adequacy certificate.
 */
const VISUALIZATION_NEGATION =
  /\bnot\b|\bno\b|\bpoorly\b|\binadequat|\bhidden\b|\bcannot\b|\bfails?\b|\blimited\b|\bdifficult\b/i;

/**
 * Words that limit a dimension on their own, without needing a seeing-verb in
 * the same clause: "The posterior elements are obscured by bowel gas." records a
 * limitation but never says what was seen. A bare negation ("No fracture at
 * L5-S1.") is not one of these, so it cannot turn adequacy off.
 */
const VISUALIZATION_LIMIT_ALONE =
  /obscured|overlap|nondiagnostic|degrad|cannot (?:be )?(?:assessed|seen|visuali[sz]ed|demonstrated|included)|not (?:seen|visuali[sz]ed|demonstrated|included|assessable|demonstrable)|poorly visuali[sz]ed|inadequate(?:ly)? visuali[sz]ed/i;

const VISUALIZATION_HEDGE =
  /where (?:visuali[sz]ed|seen|shown|demonstrated|included|assessed)|to the extent|as far as|insofar|\bpartially\b/i;

const VISUALIZATION_VERB =
  /visuali[sz]|demonstrat|\bseen\b|\bshown\b|includ|assess|evaluat|surveyed/i;

type LsAdequacyRule =
  | { kind: "visibility"; subject: RegExp }
  | { kind: "polarity"; adequate: RegExp; limited: RegExp };

const ADEQUACY_RULES: Record<XrayLsAdequacyKey, LsAdequacyRule> = {
  l5s1Visualization: {
    kind: "visibility",
    subject: /l5[- ]?s1|lumbosacral junction|sacrum|\bs1\b/i,
  },
  posteriorElementVisualization: {
    kind: "visibility",
    subject: /posterior element|\bpars\b|\bparsi\b|\bparses\b|pedicle|scottie/i,
  },
  t12l1Included: {
    kind: "visibility",
    subject: /t12[- ]?l1|thoracolumbar junction|upper lumbar/i,
  },
  siJointVisualization: {
    kind: "visibility",
    subject: /sacroiliac|\bsi joints?\b/i,
  },
  rotation: {
    kind: "polarity",
    adequate: /no (?:significant )?rotation|not rotated|without rotation|adequate rotation/i,
    limited:
      /rotation limits|patient rotation|\brotated\b|malrotation|asymmetric (?:iliac wings|pedicles)|rotation degrades/i,
  },
  motion: {
    kind: "polarity",
    adequate: /no motion|without motion|no movement (?:artifact|artefact)|no blur/i,
    limited:
      /motion (?:artifact|artefact)|movement (?:artifact|artefact)|blurring due to motion|degraded by motion/i,
  },
};

function clauseList(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function gradeAdequacy(text: string, key: XrayLsAdequacyKey): XrayAdequacyGrade {
  const rule = ADEQUACY_RULES[key];
  const clauses = clauseList(text);
  if (rule.kind === "polarity") {
    // Adequate first: the reassuring forms quote the problem word ("no rotation"
    // contains "rotation"), so a limitation may only be recorded when no
    // explicit reassurance is present.
    if (clauses.some((c) => rule.adequate.test(c))) return "adequate";
    if (clauses.some((c) => rule.limited.test(c))) return "limited";
    return "unknown";
  }
  let sawAdequate = false;
  for (const clause of clauses) {
    if (!rule.subject.test(clause)) continue;
    // A limitation stated on its own terms ("obscured by bowel gas") never names
    // a seeing-verb, so it is tested before the verb requirement below.
    if (VISUALIZATION_LIMIT_ALONE.test(clause)) return "limited";
    if (!VISUALIZATION_VERB.test(clause)) continue;
    // Limitation wins over a later reassurance in the same technique field: an
    // unverified dimension must not be rescued by a stray positive sentence.
    if (VISUALIZATION_NEGATION.test(clause) || VISUALIZATION_HEDGE.test(clause)) return "limited";
    sawAdequate = true;
  }
  return sawAdequate ? "adequate" : "unknown";
}

const COVERAGE_NEGATIVE =
  /\b(?:l5[- ]?s1|lumbosacral junction|sacrum|s1)\b[^.]{0,30}?\b(?:not|poorly|inadequately|obscured|cannot)\b[^.]{0,25}?(?:seen|visuali[sz]ed|included|demonstrated|assessed)/i;

const COVERAGE_S1 =
  /includes? the sacrum|sacrum\b[^.]{0,25}?(?:visuali[sz]ed|included|demonstrated|seen)|below l5[- ]?s1|sacrum (?:is |are )?included/i;

const COVERAGE_L5S1 =
  /includes? the l5[- ]?s1 junction|l5[- ]?s1\b[^.]{0,25}?(?:visuali[sz]ed|included|demonstrated|seen)|lumbosacral junction\b[^.]{0,25}?(?:visuali[sz]ed|included|demonstrated)/i;

function gradeInferiorCoverage(text: string): XrayLsTechniqueContext["inferiorCoverage"] {
  const clauses = clauseList(text);
  const says = (re: RegExp) => clauses.some((c) => re.test(c));
  // A recorded limitation of the junction overrides any earlier positive: the
  // claim that matters for coverage is the one that says it was NOT seen.
  if (says(COVERAGE_NEGATIVE)) return "unknown";
  if (says(COVERAGE_S1)) return "S1";
  if (says(COVERAGE_L5S1)) return "L5-S1";
  return "unknown";
}

export function parseXrayLsViews(
  text: string | null | undefined,
): XrayLsTechniqueContext {
  const t = (text ?? "").trim();
  const performed = {} as Record<XrayLsViewKey, boolean>;
  const claiming = performanceClauses(t);
  for (const { key, re } of VIEW_PATTERNS) {
    performed[key] = t.length > 0 && claiming.some((s) => re.test(s));
  }

  const adequacy = {} as Record<XrayLsAdequacyKey, XrayAdequacyGrade>;
  let adequacySignal = false;
  (Object.keys(ADEQUACY_RULES) as XrayLsAdequacyKey[]).forEach((key) => {
    const g = t.length > 0 ? gradeAdequacy(t, key) : "unknown";
    adequacy[key] = g;
    if (g !== "unknown") adequacySignal = true;
  });

  const inferiorCoverage = t.length > 0 ? gradeInferiorCoverage(t) : "unknown";
  const viewSignal = VIEW_PATTERNS.some(({ key }) => performed[key] && key !== "other");

  return {
    performed,
    adequacy,
    inferiorCoverage,
    hasTechniqueSignal: viewSignal || adequacySignal || inferiorCoverage !== "unknown",
  };
}

export function lsViewAllows(
  ctx: XrayLsTechniqueContext,
  key: XrayLsViewKey | XrayLsViewKey[],
): boolean {
  const keys = Array.isArray(key) ? key : [key];
  return keys.every((k) => ctx.performed[k]);
}

export function missingLsViewLabels(
  ctx: XrayLsTechniqueContext,
  keys: XrayLsViewKey[],
): string[] {
  return keys.filter((k) => !ctx.performed[k]).map((k) => XRAY_LS_VIEW_LABELS[k]);
}

export function limitedLsAdequacyLabels(ctx: XrayLsTechniqueContext): string[] {
  return (Object.keys(ADEQUACY_RULES) as XrayLsAdequacyKey[])
    .filter((k) => ctx.adequacy[k] === "limited")
    .map((k) => XRAY_LS_ADEQUACY_LABELS[k]);
}

export type LsGate = { allowed: boolean; reason?: string };

/**
 * Pars interarticularis / spondylolysis (spec §7, §8; library §7). A defect is a
 * cortical luency through an oblique "Scottie dog" neck: a lateral film supports
 * "no convincing defect", while a unilateral defect claim needs an oblique as
 * well, and nothing is supportable when the posterior elements are obscured.
 */
export function assessPars(
  ctx: XrayLsTechniqueContext,
  opts: { unilateral?: boolean } = {},
): LsGate {
  if (!ctx.performed.lateral && !ctx.performed.obliqueRight && !ctx.performed.obliqueLeft) {
    return {
      allowed: false,
      reason:
        "No lateral or oblique view is recorded, so the pars interarticularis cannot be assessed.",
    };
  }
  if (ctx.adequacy.posteriorElementVisualization !== "adequate") {
    return {
      allowed: false,
      reason:
        "The posterior elements are not recorded as adequately visualized, so a pars assessment is not supportable — an equivocal projection alone cannot diagnose a defect.",
    };
  }
  if (opts.unilateral && !ctx.performed.obliqueRight && !ctx.performed.obliqueLeft) {
    return {
      allowed: false,
      reason:
        "A unilateral pars defect requires an oblique projection; only a lateral film is recorded.",
    };
  }
  if (ctx.adequacy.rotation === "limited") {
    return {
      allowed: false,
      reason: "Patient rotation limits the posterior-element assessment, so a pars defect cannot be established.",
    };
  }
  return { allowed: true };
}

/** Neural foramen / facet statements on the oblique for the side reported. */
export function assessForaminal(
  ctx: XrayLsTechniqueContext,
  side: "right" | "left" | "bilateral",
): LsGate {
  const needed: XrayLsViewKey[] =
    side === "bilateral"
      ? ["obliqueRight", "obliqueLeft"]
      : [side === "right" ? "obliqueRight" : "obliqueLeft"];
  const missing = missingLsViewLabels(ctx, needed);
  if (missing.length) {
    return {
      allowed: false,
      reason: `Side-specific foraminal assessment requires the ${needed
        .map((k) => XRAY_LS_VIEW_LABELS[k])
        .join(" and ")} view, which ${missing.length > 1 ? "were" : "was"} not performed (${missing.join(
        ", ",
      )}).`,
    };
  }
  if (ctx.adequacy.rotation === "limited") {
    return {
      allowed: false,
      reason: "Patient rotation limits the oblique views, so a side-specific foraminal assessment is not supportable.",
    };
  }
  return { allowed: true };
}

/** Dynamic instability needs both positions (spec §9). */
export function assessDynamic(ctx: XrayLsTechniqueContext): LsGate {
  const missing = missingLsViewLabels(ctx, ["flexion", "extension"]);
  if (missing.length === 2) {
    return {
      allowed: false,
      reason:
        "No flexion or extension views are recorded, so dynamic translation cannot be assessed. Neutral films cannot demonstrate instability.",
    };
  }
  if (missing.length === 1) {
    return {
      allowed: false,
      reason: `Dynamic translation requires both positions; the ${missing.join(", ")} view was not performed.`,
    };
  }
  return { allowed: true };
}

/** L5-S1 / lumbosacral-junction statements (spec §2, §5). */
export function assessL5S1(ctx: XrayLsTechniqueContext): LsGate {
  if (ctx.adequacy.l5s1Visualization === "limited") {
    return {
      allowed: false,
      reason:
        "The lumbosacral junction is recorded as not adequately visualized, so L5-S1 cannot be assessed on these films.",
    };
  }
  if (ctx.adequacy.l5s1Visualization === "adequate" || ctx.inferiorCoverage === "L5-S1" || ctx.inferiorCoverage === "S1") {
    return { allowed: true };
  }
  if (ctx.performed.spotL5S1) return { allowed: true };
  return {
    allowed: false,
    reason:
      "The coverage of the lumbosacral junction is not recorded, so L5-S1 cannot be certified on this study.",
  };
}

/** T12-L1 statements need the thoracolumbar junction in the field of view. */
export function assessT12L1(ctx: XrayLsTechniqueContext): LsGate {
  if (ctx.adequacy.t12l1Included === "adequate") return { allowed: true };
  if (ctx.adequacy.t12l1Included === "limited") {
    return {
      allowed: false,
      reason: "T12-L1 is recorded as not included in the field of view.",
    };
  }
  return {
    allowed: false,
    reason:
      "Inclusion of T12-L1 is not recorded, so the thoracolumbar junction cannot be commented on as normal.",
  };
}

/** SI-joint statements need an AP that shows them (spec §13). */
export function assessSiJoints(ctx: XrayLsTechniqueContext): LsGate {
  if (!ctx.performed.ap) {
    return {
      allowed: false,
      reason: "No AP projection is recorded, so the sacroiliac joints are not assessed on this study.",
    };
  }
  if (ctx.adequacy.siJointVisualization === "limited") {
    return {
      allowed: false,
      reason:
        "The sacroiliac joints are recorded as not adequately visualized, so an SI-joint assessment is not supportable.",
    };
  }
  return { allowed: true };
}

/**
 * Statements a recorded view or adequacy dimension must support (spec §2, §18).
 * Same shape as the chest and cervical rule tables.
 */
export const LS_TECHNIQUE_STATEMENT_RULES: Array<{
  requires?: XrayLsViewKey[];
  requiresAny?: XrayLsViewKey[];
  requiresAdequate?: XrayLsAdequacyKey[];
  requiresL5S1?: boolean;
  requiresT12L1?: boolean;
  requiresSiJoints?: boolean;
  re: RegExp;
  label: string;
}> = [
  {
    requiresAdequate: ["posteriorElementVisualization"],
    // Not a bare /lysis/: "ankylosis" is a sacroiliac word, not a pars word.
    re: /\bpars\b|\bparsi\b|spondylolysis|scottie|pedicles? (?:are |is )?(?:intact|normal|unremarkable)/i,
    label: "a pars / posterior-element statement",
  },
  {
    requiresAny: ["obliqueRight", "obliqueLeft"],
    requires: ["lateral"],
    re: /neural foramina? (?:are |is )?(?:patent|normal|clear)|foraminal (?:narrowing|stenosis)/i,
    label: "a foraminal statement",
  },
  {
    requires: ["flexion", "extension"],
    re: /flexion|extension|dynamic translation|instability/i,
    label: "a dynamic-alignment statement",
  },
  {
    requiresL5S1: true,
    re: /l5[- ]s1|lumbosacral junction/i,
    label: "an L5-S1 statement",
  },
  {
    requiresT12L1: true,
    re: /t12[- ]l1|thoracolumbar junction/i,
    label: "a T12-L1 statement",
  },
  {
    requiresSiJoints: true,
    re: /sacroiliac|\bsi joints?\b/i,
    label: "a sacroiliac-joint statement",
  },
  {
    // spec §13: a *specific* SI abnormality needs the joints demonstrably seen.
    // Nonspecific sclerosis must never become an automatic diagnosis, so the
    // descriptive claim is gated harder than the general "preserved" statement.
    requiresAdequate: ["siJointVisualization"],
    re: /ankylos(?:is|ed)|sacroiliitis|sacroiliac (?:joint )?(?:narrowing|sclerosis|irregularity|destruction)|\bsi joints? (?:narrowing|sclerosis|ankylos)/i,
    label: "a specific sacroiliac-joint abnormality",
  },
];

export function unsupportedLsTechniqueStatements(
  ctx: XrayLsTechniqueContext,
  text: string | null | undefined,
): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const out: string[] = [];

  for (const rule of LS_TECHNIQUE_STATEMENT_RULES) {
    if (!rule.re.test(t)) continue;

    if (rule.requires && rule.requires.some((k) => !ctx.performed[k])) {
      out.push(
        `${rule.label} without ${rule.requires
          .filter((k) => !ctx.performed[k])
          .map((k) => XRAY_LS_VIEW_LABELS[k])
          .join(" + ")} recorded`,
      );
      continue;
    }
    if (rule.requiresAny && !rule.requiresAny.some((k) => ctx.performed[k])) {
      out.push(
        `${rule.label} without ${rule.requiresAny
          .map((k) => XRAY_LS_VIEW_LABELS[k])
          .join(" or ")} recorded`,
      );
      continue;
    }
    if (rule.requiresAdequate && rule.requiresAdequate.some((k) => ctx.adequacy[k] !== "adequate")) {
      out.push(
        `${rule.label} although ${rule.requiresAdequate
          .filter((k) => ctx.adequacy[k] !== "adequate")
          .map((k) => XRAY_LS_ADEQUACY_LABELS[k])
          .join(", ")} is not recorded as adequate`,
      );
      continue;
    }
    if (rule.requiresL5S1 && !assessL5S1(ctx).allowed) {
      out.push(`${rule.label} — ${assessL5S1(ctx).reason}`);
      continue;
    }
    if (rule.requiresT12L1 && !assessT12L1(ctx).allowed) {
      out.push(`${rule.label} — ${assessT12L1(ctx).reason}`);
      continue;
    }
    if (rule.requiresSiJoints && !assessSiJoints(ctx).allowed) {
      out.push(`${rule.label} — ${assessSiJoints(ctx).reason}`);
    }
  }
  return out;
}

/* ───────────────────── canonical Technique sentences ───────────────────── */

export const XRAY_LS_VIEW_SENTENCES: Record<Exclude<XrayLsViewKey, "other">, string> = {
  ap: "AP lumbar radiograph.",
  lateral: "Lateral lumbar radiograph.",
  obliqueRight: "Right oblique views.",
  obliqueLeft: "Left oblique views.",
  flexion: "Flexion view.",
  extension: "Extension view.",
  spotL5S1: "Spot L5-S1 view.",
};

export const XRAY_LS_ADEQUACY_SENTENCES: Record<
  XrayLsAdequacyKey,
  { adequate: string; limited: string }
> = {
  l5s1Visualization: {
    adequate: "The L5-S1 junction is adequately visualized.",
    limited: "The L5-S1 junction is not adequately visualized.",
  },
  posteriorElementVisualization: {
    adequate: "The posterior elements are adequately visualized.",
    limited: "The posterior elements are not adequately visualized.",
  },
  t12l1Included: {
    adequate: "T12-L1 is included in the field of view.",
    limited: "T12-L1 is not included in the field of view.",
  },
  siJointVisualization: {
    adequate: "The sacroiliac joints are adequately visualized.",
    limited: "The sacroiliac joints are not adequately visualized.",
  },
  rotation: {
    adequate: "No significant rotation.",
    limited: "Patient rotation limits assessment of alignment, the posterior elements and the oblique views.",
  },
  motion: {
    adequate: "No motion artifact.",
    limited: "Motion artifact limits assessment of fine osseous detail.",
  },
};

export const XRAY_LS_COVERAGE_SENTENCES: Record<
  Exclude<XrayLsTechniqueContext["inferiorCoverage"], "unknown">,
  string
> = {
  "L5-S1": "The inferior coverage includes the L5-S1 junction.",
  S1: "The inferior coverage includes the sacrum below L5-S1.",
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

/** Remove only the sentences belonging to ONE key — never the radiologist's own prose. */
function removeOwned(text: string, doomed: Set<string>): string {
  return joinSentences(
    toSentences(text).filter((s) => !doomed.has(s) && !doomed.has(s.replace(/\s+/g, " "))),
  );
}

export function toggleLsViewInTechnique(
  text: string | null | undefined,
  key: XrayLsViewKey,
  on: boolean,
): string {
  // "other" has no canonical sentence: the radiologist writes the projection, so
  // the model can never assert a view it did not record.
  if (key === "other") return (text ?? "").trim();
  const base = removeOwned((text ?? "").trim(), new Set([XRAY_LS_VIEW_SENTENCES[key]]));
  const ordered = toSentences(base);
  if (on) ordered.push(XRAY_LS_VIEW_SENTENCES[key]);
  return joinSentences(ordered);
}

export function setLsAdequacyInTechnique(
  text: string | null | undefined,
  key: XrayLsAdequacyKey,
  grade: XrayAdequacyGrade,
): string {
  const pair = XRAY_LS_ADEQUACY_SENTENCES[key];
  const base = removeOwned((text ?? "").trim(), new Set([pair.adequate, pair.limited]));
  const ordered = toSentences(base);
  if (grade !== "unknown") ordered.push(grade === "adequate" ? pair.adequate : pair.limited);
  return joinSentences(ordered);
}

export function setLsCoverageInTechnique(
  text: string | null | undefined,
  coverage: XrayLsTechniqueContext["inferiorCoverage"],
): string {
  const doomed = new Set<string>(Object.values(XRAY_LS_COVERAGE_SENTENCES));
  const base = removeOwned((text ?? "").trim(), doomed);
  const ordered = toSentences(base);
  if (coverage !== "unknown") ordered.push(XRAY_LS_COVERAGE_SENTENCES[coverage]);
  return joinSentences(ordered);
}

/**
 * The coverage statements. Each dimension has exactly one sentence per state, and
 * those sentences are also the `baselineReplaces` contract the abnormal tiles
 * use, so the baseline text and the supersession contract cannot drift apart.
 */
export const LS_SI_SENTENCES = {
  preserved: "The sacroiliac joints show no gross radiographic abnormality.",
  hedged: "The sacroiliac joints, where visualized, are unremarkable.",
  notAssessed: "The sacroiliac joints are not assessed on the views obtained.",
} as const;

export const LS_JUNCTION_SENTENCES = {
  adequate: "The lumbosacral junction is adequately visualized.",
  hedged: "The lumbosacral junction, where visualized, is unremarkable.",
  notAdequate: "The lumbosacral junction is not adequately visualized on these radiographs.",
} as const;

export const LS_T12L1_SENTENCES = {
  included: "T12-L1 is included in the field of view.",
  excluded: "T12-L1 is not included in the field of view.",
  notRecorded: "Inclusion of T12-L1 is not recorded on these radiographs.",
} as const;

/**
 * The coverage sentence for the thoracolumbar junction. Three-way on purpose:
 * "not recorded" is a different fact from "recorded as excluded", and the second
 * one may not be written into a patient report on the first one's evidence.
 */
export function lsT12L1CoverageSentence(ctx: XrayLsTechniqueContext): string {
  if (ctx.adequacy.t12l1Included === "adequate") return LS_T12L1_SENTENCES.included;
  if (ctx.adequacy.t12l1Included === "limited") return LS_T12L1_SENTENCES.excluded;
  return LS_T12L1_SENTENCES.notRecorded;
}

/**
 * The normal-baseline SI-joint line. Three readings, not two: an AP film that
 * records no sacroiliac adequacy is precisely the case the seeded protocol
 * hedges ("where visualized, are unremarkable"), so full confidence requires an
 * explicit adequacy statement while the gate itself stays on the projection
 * (spec §13: cautious interpretation, never an automatic diagnosis).
 */
export function lsSiJointNormalSentence(ctx: XrayLsTechniqueContext): string {
  if (!assessSiJoints(ctx).allowed) return LS_SI_SENTENCES.notAssessed;
  if (ctx.adequacy.siJointVisualization !== "adequate") return LS_SI_SENTENCES.hedged;
  return LS_SI_SENTENCES.preserved;
}

/** The normal-baseline lumbosacral-junction line, coverage-aware (spec §2, §6). */
export function lsL5S1NormalSentence(ctx: XrayLsTechniqueContext): string {
  if (!assessL5S1(ctx).allowed) return LS_JUNCTION_SENTENCES.notAdequate;
  if (ctx.adequacy.l5s1Visualization !== "adequate" && ctx.inferiorCoverage === "unknown") {
    return LS_JUNCTION_SENTENCES.hedged;
  }
  return LS_JUNCTION_SENTENCES.adequate;
}
