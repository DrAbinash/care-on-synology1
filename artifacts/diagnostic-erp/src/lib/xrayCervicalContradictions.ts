/**
 * xrayCervicalContradictions.ts — cervical radiography contradiction and
 * technique-awareness checks, feeding the EXISTING validation surface
 * (impressionContradictionWarnings → ImpressionWarningStrip / Copilot), exactly
 * as xrayChestContradictions.ts does for the chest.
 *
 * Spec §15 lists ten detections. They are implemented as declarative
 * normal-vs-abnormal rules plus four structural checks that only this modality
 * needs:
 *  - view-gated claims (odontoid, foraminal, dynamic, C7-T1) are matched against
 *    the recorded Technique state rather than guessed from the study name;
 *  - level / numbering consistency uses the cervical level vocabulary, because a
 *    "C5 over C7" listhesis is a real editing error that no spell-check catches;
 *  - hardware statements are checked against the lucency wording, so equivocal
 *    lucency cannot silently become "loosening";
 *  - unfilled bracket tokens are surfaced before the report can print them.
 *
 * Warnings only. Nothing here rewrites or deletes clinical interpretation — the
 * radiologist always has the last word.
 */
import { unfilledCervicalTokens } from "./xrayCervicalAtoms";
import {
  cervicalLevelConsistencyIssues,
  cervicalLevelsInText,
  normalizeCervicalLevel,
} from "./xrayCervicalLevels";
import {
  assessC7T1,
  assessDynamic,
  assessForaminal,
  assessOdontoid,
  parseXrayCervicalViews,
  unsupportedCervicalTechniqueStatements,
  XRAY_CERVICAL_VIEW_LABELS,
  type XrayCervicalTechniqueContext,
} from "./xrayCervicalViews";
import { cervicalHardwareContradiction } from "./xrayCervicalHardware";

export type CervicalContradictionRule = {
  id: string;
  normalRe: RegExp;
  abnormalRe: RegExp;
  label: string;
};

/**
 * One entry per required §15 text detection. A sentence counts as abnormal only
 * when it is not itself a denial, so "No acute fracture or listhesis is
 * identified." can never trigger its own fracture rule.
 */
/** "is" or "are", whichever the sentence uses. */
const COPULA = "(?:is|are|remains|appears(?:s)?)";

export const CERVICAL_CONTRADICTION_RULES: readonly CervicalContradictionRule[] = [
  {
    id: "normal_alignment_listhesis",
    normalRe: new RegExp(
      `cervical alignment (?:and lordosis )?${COPULA} maintained|alignment ${COPULA} normal|normal alignment|no (acute )?fracture or listhesis|listhesis ${COPULA} not identified|no listhesis|lordosis ${COPULA} (?:maintained|preserved|normal)`,
      "i",
    ),
    abnormalRe:
      /anterolisthesis|retrolisthesis|spondylolisthesis|\blisthesis of\b|subluxation|malalignment|translated (over|on)/i,
    label:
      "“Normal alignment / no listhesis” coexists with a listhesis or malalignment statement.",
  },
  {
    id: "preserved_disc_narrowed_disc",
    normalRe: new RegExp(
      `disc spaces? ${COPULA} (?:all )?preserved|disc heights? ${COPULA} (?:maintained|preserved|normal)|intervertebral disc spaces? ${COPULA} (?:preserved|normal)|no disc[- ]space (?:narrowing|reduction)`,
      "i",
    ),
    abnormalRe:
      /disc[- ]space (narrowing|reduction|loss)|reduced disc (height|space)|narrowed disc|disc height (loss|reduction)/i,
    label: "“Disc spaces preserved” coexists with disc-space narrowing.",
  },
  {
    id: "no_fracture_fracture",
    normalRe:
      /no acute fracture|no fracture|no (acute )?(osseous|bony) abnormality|no acute osseous abnormality|vertebral bodies? (?:are|is|unremarkable)|vertebral bodies? (?:are|is) (?:normal|unremarkable)|no (acute )?injury identified/i,
    abnormalRe:
      /fracture|cortical (step|disruption)|odontoid (fracture|break)|perched facet|facet dislocation|burst[- ]type/i,
    label: "“No fracture / no acute osseous abnormality” coexists with a fracture.",
  },
  {
    id: "normal_prevertebral_swelling",
    normalRe: new RegExp(
      `prevertebral soft tissues? ${COPULA} not widened|prevertebral (?:soft tissue )?thickness ${COPULA} normal|normal prevertebral|no prevertebral soft[- ]?tissue swelling|prevertebral tissues? ${COPULA} unremarkable`,
      "i",
    ),
    abnormalRe:
      /prevertebral soft[- ]tissue (swelling|widening|widened)|widened prevertebral|prevertebral (swelling|collection|haematoma|hæmatoma|abscess)/i,
    label:
      "“Prevertebral soft tissues are not widened” coexists with prevertebral swelling.",
  },
  {
    id: "normal_study_significant_abnormality",
    normalRe:
      /no acute osseous abnormality|normal cervical (?:spine )?(?:radiograph|series)|unremarkable cervical spine|cervical spine (?:is|are) normal|no significant abnormality/i,
    abnormalRe:
      /fracture|dislocation|instability|odontoid (fracture|break)|listhesis|destructive|lytic|sclerotic lesion|collapse|prevertebral (swelling|gas)|loosening|hardware (breakage|migration)|not excluded|inadequate/i,
    label:
      "A normal-study statement coexists with a significant cervical abnormality.",
  },
  {
    id: "no_hardware_hardware",
    normalRe: /no (anterior or posterior )?cervical instrumentation|no hardware|no (surgical )?(fixation|implant)|no instrumentation seen/i,
    abnormalRe:
      /\bacdf\b|plate and screws|lateral mass screws|cervical (hardware|instrumentation)|interbody (cage|spacer)|rods\b/i,
    label: "“No cervical instrumentation” coexists with a hardware finding.",
  },
  {
    id: "foramina_patent_narrowed",
    normalRe: new RegExp(
      `neural foramina? ${COPULA} (?:all )?patent|foramina? ${COPULA} normal|no foraminal narrowing|foraminal (?:width|height) preserved`,
      "i",
    ),
    abnormalRe: /foraminal narrowing|neural foraminal (narrowing|stenosis|reduction)|foraminal stenosis|narrowed foramen/i,
    label: "“Neural foramina patent” coexists with foraminal narrowing.",
  },
];

function sentences(text: string): string[] {
  return text
    .split(/[.\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DENIAL = /\bno\b|\bnot\b|\bwithout\b|\babsence\b|\bfree of\b|\bnegatif/i;

function hasAbnormalSentence(text: string, re: RegExp): boolean {
  return sentences(text).some((s) => re.test(s) && !DENIAL.test(s));
}

/**
 * Disc narrowing must be matched disc-for-disc: "Disc height preserved at
 * C7-T1" and "C5-C6 disc-space narrowing" are both true, while the same level
 * called both preserved and narrowed is the error the spec asks for (§15).
 */
function sameLevelDiscContradiction(text: string): string | null {
  const preserved = new Set<string>();
  const narrowed = new Set<string>();
  for (const s of sentences(text)) {
    const levels = cervicalLevelsInText(s);
    if (!levels.length) continue;
    const isNarrowed = /(disc[- ]space (narrowing|reduction|loss)|reduced disc|narrowed disc|disc height (loss|reduction))/i.test(s);
    const isPreserved =
      !isNarrowed &&
      /(disc (height|spaces?)|disc)[- ]?(preserved|maintained|normal|not narrowed)|disc heights? (are )?(preserved|maintained)/i.test(s);
    if (isPreserved) levels.forEach((l) => preserved.add(l));
    if (isNarrowed) levels.forEach((l) => narrowed.add(l));
  }
  const both = [...narrowed].filter((l) => preserved.has(l));
  if (!both.length) return null;
  return `The ${both.join(", ")} disc is described as both preserved and narrowed.`;
}

/**
 * A sentence that WITHHOLDS a claim is not a claim. Each gate therefore looks
 * for the phrase-level denial of its own subject rather than any "no" in the
 * sentence — "C5-C6 foraminal narrowing with no fracture" must still be gated,
 * while "no foraminal narrowing" must not be.
 */
const CLAIM_WITHHELD: Record<"odontoid" | "foraminal" | "dynamic" | "c7t1", RegExp> = {
  odontoid:
    /no (acute )?(odontoid|dens|c1[- ]c2|atlanto[- ]?axial)|odontoid (is )?(not|poorly)|not (adequately )?visuali[sz]ed|cannot be (assessed|evaluated)|not excluded|when (adequately )?visuali[sz]ed|where (adequately )?(visuali[sz]ed|seen)/i,
  foraminal:
    /no (significant |acute )?(neural )?foraminal|foramina? (are )?(all )?not narrowed|cannot be assessed|not (adequately )?assessed|where visualized/i,
  dynamic:
    /no (dynamic )?instability|instability is not|without instability|views (were )?not (performed|obtained)|not (assessed|performed)|cannot be (assessed|evaluated)/i,
  c7t1:
    /c7[- ]t1 (is )?(not|poorly|inadequately)|not (adequately )?visuali[sz]ed|cannot be (assessed|evaluated)|not seen|obscured/i,
};

/**
 * Text with the withholding sentences removed, for the whole-report technique
 * pass: "The odontoid is not adequately visualized." names the odontoid only to
 * disclaim it, and must not be reported as an unsupported odontoid statement.
 */
function claimBearingText(text: string): string {
  const withheld = Object.values(CLAIM_WITHHELD);
  return sentences(text)
    .filter((s) => !withheld.some((re) => re.test(s)))
    .join(" ");
}

/** Which side a foraminal sentence is talking about. */
function sideInSentence(sentence: string): "right" | "left" | "bilateral" {
  const hasRight = /\bright\b/i.test(sentence);
  const hasLeft = /\bleft\b/i.test(sentence);
  if (hasRight && hasLeft) return "bilateral";
  if (hasRight) return "right";
  if (hasLeft) return "left";
  return "bilateral";
}

const FORAMINAL_CLAIM =
  /foraminal (narrowing|stenosis|reduction)|neural foraminal (narrowing|stenosis)|foramina?\b.*\b(patent|narrowed|normal)/i;

const ODONTOID_CLAIM = /odontoid|atlanto[- ]?(axial|dental)|\bdens\b|c1[- ]c2|lateral masses?/i;

const DYNAMIC_CLAIM =
  /flexion|extension|dynamic (translation|instability|study)|instability|translation (at|in) flexion/i;

export type CervicalContradictionOptions = {
  findingsText: string;
  impressionText?: string;
  techniqueText?: string;
  /** Pre-parsed technique context; parsed from `techniqueText` when omitted. */
  viewCtx?: XrayCervicalTechniqueContext;
};

/**
 * The §15 warning list for a cervical report. Prefix keeps the chest surface's
 * convention so the strip reads which study family raised each warning.
 */
export function cervicalTextContradictions(opts: CervicalContradictionOptions): string[] {
  const combined = [opts.findingsText, opts.impressionText ?? ""].join("\n");
  const ctx = opts.viewCtx ?? parseXrayCervicalViews(opts.techniqueText);
  const warnings: string[] = [];

  // 1-8: declarative normal-vs-abnormal rules.
  for (const rule of CERVICAL_CONTRADICTION_RULES) {
    if (rule.normalRe.test(combined) && hasAbnormalSentence(combined, rule.abnormalRe)) {
      warnings.push(`X-ray Cervical Spine: ${rule.label}`);
    }
  }

  // 9: hardware described as both intact and failed (spec §12, §15).
  const hardware = cervicalHardwareContradiction(combined);
  if (hardware) warnings.push(`X-ray Cervical Spine: ${hardware}`);

  // 10: level / numbering consistency (spec §15).
  for (const issue of cervicalLevelConsistencyIssues(combined)) {
    warnings.push(`X-ray Cervical Spine: level / numbering — ${issue.detail}`);
  }

  // Same-level disc self-contradiction, the precise form of §15's second rule.
  const sameLevel = sameLevelDiscContradiction(combined);
  if (sameLevel) warnings.push(`X-ray Cervical Spine: ${sameLevel}`);

  // View-gated claims (spec §2, §6, §7, §8, §10, §15). Checked sentence by
  // sentence, because a report may legitimately certify one level and withhold
  // judgement on another.
  const odontoidGate = assessOdontoid(ctx);
  const dynamicGate = assessDynamic(ctx);
  const c7t1Gate = assessC7T1(ctx);
  let foraminalClaimWithoutViews = false;

  for (const s of sentences(combined)) {
    if (
      !odontoidGate.allowed &&
      ODONTOID_CLAIM.test(s) &&
      /intact|normal|unremarkable|maintained|preserved|no fracture/i.test(s) &&
      !CLAIM_WITHHELD.odontoid.test(s)
    ) {
      warnings.push(`X-ray Cervical Spine: odontoid / C1-C2 — ${odontoidGate.reason}`);
    }

    if (FORAMINAL_CLAIM.test(s) && !CLAIM_WITHHELD.foraminal.test(s)) {
      const side = sideInSentence(s);
      const gate = assessForaminal(ctx, side);
      if (!gate.allowed) {
        warnings.push(
          `X-ray Cervical Spine: foraminal — ${
            gate.reason ?? `requires the ${XRAY_CERVICAL_VIEW_LABELS[side === "left" ? "obliqueLeft" : "obliqueRight"]} view.`
          }`,
        );
        if (!ctx.hasTechniqueSignal) foraminalClaimWithoutViews = true;
      }
    }

    if (
      !dynamicGate.allowed &&
      DYNAMIC_CLAIM.test(s) &&
      !CLAIM_WITHHELD.dynamic.test(s)
    ) {
      warnings.push(`X-ray Cervical Spine: dynamic — ${dynamicGate.reason}`);
    }

    if (
      !c7t1Gate.allowed &&
      /c7[- ]t1/i.test(s) &&
      /preserved|normal|narrowing|patent|reduction|visuali[sz]ed/i.test(s) &&
      !CLAIM_WITHHELD.c7t1.test(s)
    ) {
      warnings.push(`X-ray Cervical Spine: C7-T1 — ${c7t1Gate.reason}`);
    }
  }

  // Technique statements the recorded views cannot support (spec §2). Sentences
  // that disclaim their own subject are removed first — see claimBearingText().
  const claimText = claimBearingText(combined);
  if (ctx.hasTechniqueSignal && claimText) {
    for (const detail of unsupportedCervicalTechniqueStatements(ctx, claimText)) {
      const text = `X-ray Cervical Spine: the report contains ${detail}.`;
      if (!warnings.includes(text)) warnings.push(text);
    }
  } else if (foraminalClaimWithoutViews) {
    warnings.push(
      "X-ray Cervical Spine: no views are recorded in the technique field, so foraminal, odontoid and dynamic statements cannot be supported.",
    );
  }

  // Catalog tokens that were never filled in must never reach the patient.
  const unfilled = unfilledCervicalTokens(combined);
  if (unfilled.length) {
    warnings.push(
      `X-ray Cervical Spine: unfinished placeholder${unfilled.length > 1 ? "s" : ""} ${[...new Set(unfilled)].join(", ")} — choose the level, side or measurement before finalizing.`,
    );
  }

  return [...new Set(warnings)];
}

/**
 * Impression prioritization for cervical radiography (spec §14): acute injury,
 * instability / listhesis, then significant degeneration, then a destructive
 * lesion, then a post-operative issue. The ledger composes impressions in
 * apply order and does not re-rank by severity, so the catalog is authored
 * critical-first and this ordering is what the canvas and validation expose.
 */
export const CERVICAL_IMPRESSION_PRIORITY: readonly RegExp[] = [
  /fracture|dislocation|odontoid|atlanto|prevertebral (swelling|gas)|injury/i,
  /instability|listhesis|subluxation|malalignment/i,
  /spondyl|stenosis|foraminal|disc[- ]space|degenerative/i,
  /destructive|lytic|sclerotic|collapse|lesion/i,
  /hardware|instrumentation|post[- ]?operative|fusion|loosening|breakage|migration/i,
];

export function cervicalImpressionPriorityIndex(line: string): number {
  const i = CERVICAL_IMPRESSION_PRIORITY.findIndex((re) => re.test(line));
  return i === -1 ? CERVICAL_IMPRESSION_PRIORITY.length : i;
}

/**
 * §14 prioritization check, advisory only: acute injury first, then instability /
 * listhesis, then significant degeneration, then a destructive lesion, then a
 * post-operative issue. The ledger composes impressions in apply order and does
 * not re-rank them, so an impression assembled by clicking can put a
 * spondylosis line above a fracture line. That deserves a warning; silently
 * re-ordering the radiologist's impression does not.
 */
export function cervicalImpressionOrderWarnings(impressionLines: string[]): string[] {
  const ranked = impressionLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ line, rank: cervicalImpressionPriorityIndex(line) }));

  for (let i = 1; i < ranked.length; i++) {
    const current = ranked[i]!;
    const ahead = ranked.slice(0, i).filter((x) => x.rank > current.rank);
    if (!ahead.length) continue;
    return [
      `X-ray Cervical Spine: “${current.line}” is listed after a lower-priority finding — spec §14 puts acute injury and instability ahead of degeneration, destruction and post-operative change.`,
    ];
  }
  return [];
}

/** True when the report asserts a level the recorded film cannot show. */
export function cervicalUnvisualizedLevelClaims(
  text: string,
  ctx: XrayCervicalTechniqueContext,
): string[] {
  if (ctx.visualizedInferiorLevel === "unknown" || ctx.visualizedInferiorLevel === "T1" || ctx.visualizedInferiorLevel === "T2") {
    return [];
  }
  const limit = normalizeCervicalLevel(ctx.visualizedInferiorLevel);
  const claims = cervicalLevelsInText(text).filter((l) => {
    if (!l.includes("-")) return false;
    const lower = l.split("-")[1] ?? "";
    return lower === "T1" || lower > (limit ?? "");
  });
  return claims.map(
    (l) => `X-ray Cervical Spine: ${l} is commented on although the recorded inferior visualization limit is ${ctx.visualizedInferiorLevel}.`,
  );
}
