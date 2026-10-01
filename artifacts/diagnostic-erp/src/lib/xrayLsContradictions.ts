/**
 * xrayLsContradictions.ts — lumbosacral radiography contradiction, coverage and
 * numbering checks, feeding the EXISTING validation surface
 * (impressionContradictionWarnings → ImpressionWarningStrip / Copilot) exactly as
 * xrayChestContradictions.ts and xrayCervicalContradictions.ts do.
 *
 * Spec §18 lists the detections; this file adds the two that only lumbar
 * radiography needs:
 *  - numbering consistency through `lsNumberingConsistencyIssues`, because in a
 *    lumbar report a wrong level is commoner than a missed sign, and "LSTV with
 *    conflicting labels" is a text problem no spell-check catches;
 *  - derived-value consistency, because a Meyerding grade and the slip percentage
 *    it was derived from can disagree once the radiologist edits one of them.
 *
 * Warnings only. Nothing here rewrites or deletes clinical interpretation — the
 * radiologist always has the last word.
 */
import { meyerdingFromSlipPercent } from "./mriSpineGrading";
import { unfilledLsTokens } from "./xrayLsAtoms";
import { lsLevelsInText } from "./xrayLsLevels";
import {
  UNSET_LS_NUMBERING,
  lsNumberingConsistencyIssues,
  type LsNumbering,
} from "./xrayLsNumbering";
import {
  assessDynamic,
  assessL5S1,
  assessPars,
  assessSiJoints,
  assessT12L1,
  parseXrayLsViews,
  unsupportedLsTechniqueStatements,
  type XrayLsTechniqueContext,
} from "./xrayLsViews";

/** "is" or "are", whichever the sentence uses. */
const COPULA = "(?:is|are|remains|appears(?:s)?)";

export type LsContradictionRule = {
  id: string;
  normalRe: RegExp;
  abnormalRe: RegExp;
  label: string;
};

/**
 * One entry per required §18 text detection. A sentence counts as abnormal only
 * when it is not itself a denial, so "No acute fracture or listhesis is
 * identified." can never trigger its own fracture rule.
 */
export const LS_CONTRADICTION_RULES: readonly LsContradictionRule[] = [
  {
    id: "normal_alignment_listhesis",
    normalRe: new RegExp(
      `lumbar (?:lordosis and )?alignment ${COPULA} maintained|alignment ${COPULA} normal|normal alignment|no (acute )?fracture or listhesis|listhesis ${COPULA} not identified|no listhesis|lordosis ${COPULA} (?:maintained|preserved|normal)`,
      "i",
    ),
    abnormalRe:
      /anterolisthesis|retrolisthesis|spondylolisthesis|\blisthesis of\b|subluxation|malalignment|spondylolysis/i,
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
      /no acute fracture|no fracture|no (acute )?(osseous|bony) abnormality|vertebral body heights? (?:are|is|remain) (?:preserved|normal|maintained)|no (acute )?injury identified/i,
    abnormalRe:
      /fracture|cortical (?:step|disruption)|burst|wedging|loss of (?:vertebral body )?height|collapse/i,
    label: "“No fracture / preserved heights” coexists with a fracture or collapse.",
  },
  {
    id: "normal_study_significant_abnormality",
    normalRe:
      /no acute osseous abnormality|normal (?:lumbosacral|lumbar) (?:spine|radiograph|series)|unremarkable (?:lumbosacral|lumbar) spine|(?:lumbosacral|lumbar) spine (?:is|are) normal|no significant abnormality/i,
    abnormalRe:
      /fracture|dislocation|instability|listhesis|destructive|lytic|sclerotic|collapse|loosening|hardware (?:breakage|migration)|ankyllosis|ankylosis|not excluded|inadequate/i,
    label:
      "A normal-study statement coexists with a significant lumbosacral abnormality.",
  },
  {
    id: "no_hardware_hardware",
    normalRe:
      /no (lumbar )?(spinal )?instrumentation|no hardware|no (surgical )?(fixation|implant)|no fusion hardware|no (cement|screws) (?:seen|identified)/i,
    abnormalRe:
      /pedicle (?:screw|screws)|rod(?:s)?\b|interbody (?:cage|spacer)|cement|arthrodesis|laminectomy|instrument(?:ed|ation) at/i,
    label: "“No instrumentation” coexists with a post-operative finding.",
  },
  {
    id: "si_preserved_ankylosis",
    normalRe:
      /sacroiliac joints? (?:show|are) no (?:gross )?(?:radiographic )?abnormality|sacroiliac joints? (?:are|appear) (?:preserved|normal|unremarkable)|si joints? (?:are )?(?:preserved|normal|unremarkable)/i,
    abnormalRe:
      /ankylosis|ankylosed|sacroiliitis|sacroiliac (?:joint )?(?:narrowing|sclerosis|irregularity|destruction|fusion)/i,
    label: "“Sacroiliac joints normal” coexists with a sacroiliac abnormality.",
  },
  {
    id: "pars_intact_defect",
    normalRe:
      /pars (?:interarticularis )?(?:is|are|intact)|no pars (?:defect|lysis)|pars(?:es)? (?:are|is) (?:intact|normal|unremarkable)|visualized posterior elements (?:are )?intact/i,
    abnormalRe: /pars (?:defect|lysis|fracture)|spondylolysis|cortical defect through the pars/i,
    label: "“Pars intact” coexists with a pars defect.",
  },
  {
    id: "numbering_standard_vs_transitional",
    normalRe: /five lumbar[- ]type (?:vertebrae|vertebral bodies)|normal five (?:lumbar )?segments|standard numbering/i,
    abnormalRe:
      /transitional lumbosacral|sacrali[sz]ation|lumbari[sz]ation|castellvi|sixth lumbar|l6|neoarticulation|pseudoarthrosis of the transverse process/i,
    label: "A standard five-segment statement coexists with transitional anatomy.",
  },
];

function sentences(text: string): string[] {
  return text
    .split(/[.\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DENIAL = /\bno\b|\bnot\b|\bwithout\b|\babsence\b|\bfree of\b|unremarkable|not identified/i;

function hasAbnormalSentence(text: string, re: RegExp): boolean {
  return sentences(text).some((s) => re.test(s) && !DENIAL.test(s));
}

/**
 * Disc narrowing must be matched disc-for-disc: "L5-S1 disc space is preserved"
 * and "L4-L5 disc-space narrowing" are both true, while the same level called
 * both preserved and narrowed is the error spec §18 asks for.
 */
function sameLevelDiscContradiction(text: string): string | null {
  const preserved = new Set<string>();
  const narrowed = new Set<string>();
  for (const s of sentences(text)) {
    const levels = lsLevelsInText(s);
    if (!levels.length) continue;
    const isNarrowed = /(disc[- ]space (narrowing|reduction|loss)|reduced disc|narrowed disc|disc height (loss|reduction))/i.test(s);
    // "The L4-L5 disc space is preserved", "disc heights are maintained at
    // L4-L5" and "normal disc space at L4-L5" are all the same claim, so the
    // copula and word order are allowed to vary.
    const isPreserved =
      !isNarrowed &&
      /disc(?: ?(?:height|space|spaces))?[^.]{0,18}?(?:preserved|maintained|normal|not narrowed)/i.test(s);
    if (isPreserved) levels.forEach((l) => preserved.add(l));
    if (isNarrowed) levels.forEach((l) => narrowed.add(l));
  }
  const both = [...narrowed].filter((l) => preserved.has(l));
  if (!both.length) return null;
  return `The ${both.join(", ")} disc is described as both preserved and narrowed.`;
}

/**
 * A sentence that WITHHOLDS a claim is not a claim. Each gate looks for the
 * phrase-level denial of its own subject rather than any "no" in the sentence —
 * "L5-S1 narrowing with no fracture" must still be gated, while "no pars defect"
 * must not be.
 */
const CLAIM_WITHHELD: Record<"pars" | "dynamic" | "junction" | "upper" | "si", RegExp> = {
  pars:
    /no (acute )?(pars|spondylolysis)|pars (?:is |are )?(?:not|poorly|intact)|cannot be (?:assessed|evaluated)|not (?:adequately )?visuali[sz]ed|not assessed|equivocal|where visuali[sz]ed/i,
  dynamic:
    /no (dynamic )?instability|instability is not|without instability|views (?:were )?not (?:performed|obtained)|not (?:assessed|performed)|cannot be (?:assessed|evaluated)|neutral films/i,
  junction:
    /l5[- ]?s1 (?:is |are )?(?:not|poorly|inadequately)|lumbosacral junction (?:is |are )?(?:not|poorly)|not visuali[sz]ed|obscured|cannot be (?:assessed|evaluated|certified)|where visuali[sz]ed/i,
  upper:
    /t12[- ]?l1 (?:is )?not (?:included|visuali[sz]ed|seen)|thoracolumbar junction (?:is )?not|not included|inclusion .*not recorded/i,
  si:
    /sacroiliac joints? (?:are |is )?(?:not|poorly|unremarkable where)|where visuali[sz]ed|not assessed|cannot be assessed/i,
};

/** Text with the withholding sentences removed, for the whole-report technique pass. */
function claimBearingText(text: string): string {
  const withheld = Object.values(CLAIM_WITHHELD);
  return sentences(text)
    .filter((s) => !withheld.some((re) => re.test(s)))
    .join(" ");
}

/** Which side a sentence is talking about. */
function sideInSentence(sentence: string): "right" | "left" | "bilateral" {
  const hasRight = /\bright\b/i.test(sentence);
  const hasLeft = /\bleft\b/i.test(sentence);
  if (hasRight && hasLeft) return "bilateral";
  if (hasRight) return "right";
  if (hasLeft) return "left";
  return "bilateral";
}

const PARS_CLAIM = /\bpars\b|spondylolysis|scottie/i;
const DYNAMIC_CLAIM =
  /flexion|extension|dynamic (?:translation|instability)|instability|translation (?:at|in) flexion/i;
const SI_ABNORMAL_CLAIM =
  /ankylos(?:is|ed)|sacroiliitis|sacroiliac (?:joint )?(?:narrowing|sclerosis|irregularity|destruction|fusion)/i;

export type LsContradictionOptions = {
  findingsText: string;
  impressionText?: string;
  techniqueText?: string;
  /** Pre-parsed technique context; parsed from `techniqueText` when omitted. */
  viewCtx?: XrayLsTechniqueContext;
  /** The study's numbering record; unestablished when omitted. */
  numbering?: LsNumbering | null;
};

const PREFIX = "X-ray Lumbosacral Spine";

/**
 * The §18 warning list for a lumbosacral report. The prefix keeps the chest and
 * cervical convention so the strip reads which study family raised each warning.
 */
export function lsTextContradictions(opts: LsContradictionOptions): string[] {
  const combined = [opts.findingsText, opts.impressionText ?? ""].join("\n");
  const ctx = opts.viewCtx ?? parseXrayLsViews(opts.techniqueText);
  const numbering = opts.numbering ?? UNSET_LS_NUMBERING;
  const warnings: string[] = [];

  // Declarative normal-vs-abnormal rules (§18 items 1-4, 9, 10, 13).
  for (const rule of LS_CONTRADICTION_RULES) {
    if (rule.normalRe.test(combined) && hasAbnormalSentence(combined, rule.abnormalRe)) {
      warnings.push(`${PREFIX}: ${rule.label}`);
    }
  }

  // Same-level disc self-contradiction, the precise form of §18 item 2.
  const sameLevel = sameLevelDiscContradiction(combined);
  if (sameLevel) warnings.push(`${PREFIX}: ${sameLevel}`);

  // Hardware described as both intact and failed (§18 item 10).
  const hardwareText = sentences(combined).filter((s) => /hardware|instrument|screw|rod|cement|cage/i.test(s));
  if (
    hardwareText.some((s) => /grossly (?:intact|maintained)|continuity is maintained|no convincing perihardware lucency/i.test(s)) &&
    hardwareText.some((s) => /breakage|fractured (?:rod|screw)|migration|concerning for loosening/i.test(s))
  ) {
    warnings.push(
      `${PREFIX}: hardware is described as grossly intact while breakage, migration or convincing loosening is also recorded.`,
    );
  }

  // Equivocal lucency promoted into a loosening diagnosis (§15, §18).
  if (
    /equivocal (?:perihardware )?lucency|lucency .*equivocal/i.test(combined) &&
    /\bloosening\b/i.test(combined) &&
    !/not diagnostic of loosening|concerning for loosening/i.test(combined)
  ) {
    warnings.push(
      `${PREFIX}: an equivocal perihardware lucency is reported as loosening — the library permits a diagnosis only from a convincing lucency.`,
    );
  }

  // Level / numbering consistency (§18 items 6, 7, 8, 11).
  for (const issue of lsNumberingConsistencyIssues(combined, numbering)) {
    warnings.push(`${PREFIX}: level / numbering — ${issue.detail}`);
  }

  // Derived measurement consistency (§18 item 12): a Meyerding grade must agree
  // with the slip percentage in the same sentence.
  for (const gradeWarning of derivedMeasurementWarnings(combined)) {
    warnings.push(`${PREFIX}: ${gradeWarning}`);
  }

  // View / coverage gated claims (§18 items 5, 6, and §2, §9, §13).
  const parsGate = assessPars(ctx);
  const parsUnilateralGate = assessPars(ctx, { unilateral: true });
  const dynamicGate = assessDynamic(ctx);
  const junctionGate = assessL5S1(ctx);
  const upperGate = assessT12L1(ctx);
  const siGate = assessSiJoints(ctx);
  const seen = new Set<string>();
  const push = (text: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    warnings.push(text);
  };

  for (const s of sentences(combined)) {
    if (!parsGate.allowed && PARS_CLAIM.test(s) && !CLAIM_WITHHELD.pars.test(s)) {
      push(`${PREFIX}: pars / posterior elements — ${parsGate.reason}`);
    }
    if (
      !parsUnilateralGate.allowed &&
      /unilateral|(?:right|left) pars|one side/i.test(s) &&
      PARS_CLAIM.test(s) &&
      !CLAIM_WITHHELD.pars.test(s)
    ) {
      push(`${PREFIX}: a unilateral pars defect — ${parsUnilateralGate.reason}`);
    }
    if (!dynamicGate.allowed && DYNAMIC_CLAIM.test(s) && !CLAIM_WITHHELD.dynamic.test(s)) {
      push(`${PREFIX}: dynamic — ${dynamicGate.reason}`);
    }
    if (
      !junctionGate.allowed &&
      /l5[- ]?s1|lumbosacral junction/i.test(s) &&
      /preserved|normal|narrowing|intact|no (?:listhesis|fracture|defect)|reduction/i.test(s) &&
      !CLAIM_WITHHELD.junction.test(s)
    ) {
      push(`${PREFIX}: L5-S1 — ${junctionGate.reason}`);
    }
    if (!upperGate.allowed && /t12[- ]?l1|thoracolumbar junction/i.test(s) && !CLAIM_WITHHELD.upper.test(s)) {
      push(`${PREFIX}: T12-L1 — ${upperGate.reason}`);
    }
    if (SI_ABNORMAL_CLAIM.test(s) && !CLAIM_WITHHELD.si.test(s)) {
      const side = sideInSentence(s);
      const gate = siGate.allowed
        ? ctx.adequacy.siJointVisualization === "adequate"
          ? null
          : {
              reason:
                "The sacroiliac joints are not recorded as adequately visualized, so a specific sacroiliac abnormality is not supportable.",
            }
        : siGate;
      if (gate) {
        push(
          `${PREFIX}: sacroiliac joints (${side}) — ${gate.reason}`,
        );
      }
    }
  }

  // Technique statements the recorded views cannot support (§2). Sentences that
  // disclaim their own subject are removed first — see claimBearingText().
  const claimText = claimBearingText(combined);
  if (ctx.hasTechniqueSignal && claimText) {
    for (const detail of unsupportedLsTechniqueStatements(ctx, claimText)) {
      push(`${PREFIX}: the report contains ${detail}.`);
    }
  } else if (!ctx.hasTechniqueSignal && claimText) {
    push(
      `${PREFIX}: no views are recorded in the technique field, so pars, dynamic, junction and sacroiliac statements cannot be supported.`,
    );
  }

  // Catalog tokens that were never filled in must never reach the patient.
  const unfilled = unfilledLsTokens(combined);
  if (unfilled.length) {
    push(
      `${PREFIX}: unfinished placeholder${unfilled.length > 1 ? "s" : ""} ${[...new Set(unfilled)].join(
        ", ",
      )} — choose the level, side or measurement before finalizing.`,
    );
  }

  return [...new Set(warnings)];
}

/**
 * A sentence that quotes both a Meyerding grade and a slip percentage must be
 * internally consistent: grade II is 25-50% of the vertebral body width. This is
 * §18's "derived measurement inconsistency" and the commonest way an edited
 * spondylolisthesis line ends up wrong.
 */
export function derivedMeasurementWarnings(text: string): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    const percentMatch = /(\d{1,3}(?:\.\d)?)\s*%\s*(?:of(?:\s*the)?\s*(?:vertebral\s+body)?\s*(?:ap\s+)?width|slip)/i.exec(
      s,
    );
    const gradeMatch = /meyerding\s*(?:grade\s*)?(0|I{1,3}|IV)\b/i.exec(s);
    if (!percentMatch || !gradeMatch) continue;
    const percent = Number(percentMatch[1]);
    if (!Number.isFinite(percent)) continue;
    const expected = meyerdingFromSlipPercent(percent);
    const stated = gradeMatch[1].toUpperCase();
    if (expected === null) {
      out.push(
        `"${stated}" is quoted with ${percent}%, which is not a valid slip percentage of the vertebral body width.`,
      );
      continue;
    }
    if (stated !== expected && !(stated === "0" && percent <= 0)) {
      out.push(
        `Meyerding grade ${stated} does not match the measured ${percent}% slip — ${percent}% is grade ${expected}. Recompute the grade from the measurement rather than editing one of them.`,
      );
    }
  }
  return out;
}

/**
 * Impression prioritization for lumbar radiography (spec §17): fracture or
 * destructive lesion first, then listhesis / radiologist-selected instability,
 * then major degeneration, then deformity, then transitional anatomy, then a
 * post-operative issue. The ledger composes impressions in apply order and does
 * not re-rank by severity, so the catalog is authored critical-first and this
 * ordering is what the canvas and validation expose.
 */
export const LS_IMPRESSION_PRIORITY: readonly RegExp[] = [
  /fracture|destructive|collapse|lytic|sclerotic|lesion|burst|dislocation/i,
  /instability|listhesis|spondylolisthesis|spondylolysis|pars|subluxation|malalignment/i,
  /spondyl|stenosis|degenerative|disc[- ]space|osteophyte|facet/i,
  /scoliosis|cobb|curvature|deformity|lordosis/i,
  /transitional|castellvi|sacrali[sz]ation|lumbari[sz]ation|spina bifida/i,
  /hardware|instrumentation|post[- ]?operative|fusion|loosening|breakage|migration|laminectomy|cement/i,
];

export function lsImpressionPriorityIndex(line: string): number {
  const i = LS_IMPRESSION_PRIORITY.findIndex((re) => re.test(line));
  return i === -1 ? LS_IMPRESSION_PRIORITY.length : i;
}

/**
 * §17 prioritization check, advisory only. A report assembled by clicking can put
 * a spondylosis line above a fracture line; that deserves a warning, while
 * silently re-ordering the radiologist's impression does not.
 */
export function lsImpressionOrderWarnings(impressionLines: string[]): string[] {
  const ranked = impressionLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ line, rank: lsImpressionPriorityIndex(line) }));

  for (let i = 1; i < ranked.length; i++) {
    const current = ranked[i]!;
    const ahead = ranked.slice(0, i).filter((x) => x.rank > current.rank);
    if (!ahead.length) continue;
    return [
      `${PREFIX}: “${current.line}” is listed after a lower-priority finding — spec §17 puts fracture and destructive lesions ahead of listhesis, degeneration, deformity, transitional anatomy and post-operative change.`,
    ];
  }
  return [];
}

/**
 * Claims about a level the recorded film cannot show. The junction claim is the
 * one that matters clinically: an obscured L5-S1 reported as normal is how a
 * spondylolisthesis stays hidden.
 */
export function lsUncoveredLevelClaims(
  text: string,
  ctx: XrayLsTechniqueContext,
  numbering?: LsNumbering | null,
): string[] {
  const out: string[] = [];
  const junction = assessL5S1(ctx);
  const upper = assessT12L1(ctx);
  for (const s of sentences(text)) {
    if (CLAIM_WITHHELD.junction.test(s) || CLAIM_WITHHELD.dynamic.test(s)) continue;
    if (!junction.allowed && /l5[- ]?s1|lumbosacral junction/i.test(s)) {
      out.push(`${PREFIX}: ${s.trim()} — ${junction.reason}`);
    }
    if (!upper.allowed && /t12[- ]?l1|thoracolumbar junction/i.test(s) && !CLAIM_WITHHELD.upper.test(s)) {
      out.push(`${PREFIX}: ${s.trim()} — ${upper.reason}`);
    }
  }
  if (numbering) {
    for (const issue of lsNumberingConsistencyIssues(text, numbering)) {
      out.push(`${PREFIX}: level / numbering — ${issue.detail}`);
    }
  }
  return [...new Set(out)];
}
