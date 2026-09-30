/**
 * xrayChestContradictions.ts — chest radiography contradiction + technique
 * awareness on top of the EXISTING warning surface
 * (impressionContradictionWarnings → ImpressionWarningStrip / Copilot).
 *
 * Mirrors mriBrainContradictions.ts: declarative normal-vs-abnormal rules,
 * denial-safe sentence matching, technique-dependent statement gating.
 * Warnings only — the validator never rewrites clinical interpretation.
 */
import {
  assessCardiacSize,
  parseXrayChestViews,
  unsupportedTechniqueStatements,
  type XrayTechniqueContext,
} from "./xrayChestViews";
import { unfilledChestTokens } from "./xrayChestAtoms";
import { unanchoredComparisonWarning } from "./xrayChestComparison";

export type ChestContradictionRule = {
  id: string;
  normalRe: RegExp;
  abnormalRe: RegExp;
  label: string;
};

/**
 * Spec §17, one rule per required detection. A sentence is only "abnormal" when
 * it is not itself a denial, so the normal line ("No pleural effusion or
 * pneumothorax.") can never fire its own abnormality.
 */
export const CHEST_CONTRADICTION_RULES: readonly ChestContradictionRule[] = [
  {
    id: "clear_lungs_opacity",
    normalRe: /lung fields? (are )?clear|bilateral lung fields? are clear|no focal (air[- ]space )?opacity|no (air[- ]space )?consolidation|lungs? (are )?clear/i,
    abnormalRe: /focal (air[- ]space )?opacity|consolidation|air bronchogram|cavit|multifocal (air[- ]space )?opacit|mass[- ]like opacity|nodule|reticulonodular|interstitial (opacit|pattern)|miliary/i,
    label: "“Lungs are clear / no focal opacity” coexists with a parenchymal opacity.",
  },
  {
    id: "no_effusion_effusion",
    // "No large effusion or pneumothorax" is the live seeded X-Ray protocol
    // wording, so the denial is matched as a phrase rather than as "no effusion".
    normalRe: /no[, ]+(large |small |pleural )?effusion|no pleural effusion|costophrenic angles? (are )?clear|angles? are sharp/i,
    abnormalRe: /pleural effusion|costophrenic (angle )?blunting|loculated (pleural )?(collection|opacity)|layering effusion/i,
    label: "“No pleural effusion” coexists with an effusion.",
  },
  {
    id: "no_pneumothorax_pneumothorax",
    normalRe: /no[, ]+(large |small |tension )?pneumothorax|no (left|right) pneumothorax/i,
    abnormalRe: /visceral pleural line|pneumothorax|hydropneumothorax|air[- ]fluid level with (absent|peripheral) lung markings/i,
    label: "“No pneumothorax” coexists with a pneumothorax.",
  },
  {
    id: "normal_cardiac_cardiomegaly",
    normalRe: /cardiac (size|silhouette) (is )?(normal|not enlarged|within normal limits)|normal heart size|no cardiomegaly|cardiothoracic ratio (is )?normal/i,
    abnormalRe: /cardiomegaly|cardiac silhouette is enlarged|heart (is )?enlarged|increased cardiothoracic ratio/i,
    label: "“Normal cardiac size” coexists with cardiomegaly.",
  },
  {
    id: "normal_mediastinum_widening",
    normalRe: /mediastinum (is )?not widened|mediastinal width (is )?normal|normal mediastinal contour|cardiomediastinal silhouette is within normal limits/i,
    abnormalRe: /mediastinal widening|widened mediastinum|mediastinum (is )?widened/i,
    label: "“Normal mediastinum” coexists with mediastinal widening.",
  },
  {
    id: "no_device_device",
    normalRe: /no lines?[, ,] tubes? (or|and) devices?|no (support )?(device|line|tube)|no tubes? or lines?/i,
    abnormalRe: /endotracheal tube|enteric tube|nasogastric tube|central venous catheter|\bcvc\b|\bpicc\b|intercostal drain|chest drain|pacemaker|defibrillator|sternotomy wires?|prosthetic valve|surgical clips?|staple lines?/i,
    label: "“No lines, tubes or devices” coexists with a device finding.",
  },
  {
    id: "normal_study_significant_abnormality",
    normalRe: /normal study|no acute cardiopulmonary (abnormality|process)|no active cardiopulmonary abnormality|normal chest radiograph/i,
    abnormalRe: /pneumothorax|tension|consolidation|large .*effusion|subdiaphragmatic free gas|pneumoperitoneum|free (air|gas) under the diaphragm|fracture|malpositioned|mediastinal widening|miliary|hemothorax|contusion/i,
    label: "A normal-study statement coexists with a significant abnormality.",
  },
  {
    id: "no_fracture_fracture",
    normalRe: /no acute (bony|osseous) abnormality|no (rib|clavicular) fracture|visuali[sz]ed osseous structures (are )?(normal|unremarkable)|visuali[sz]ed bony (thorax|structures) (and soft tissues )?(is|are) (normal|unremarkable)/i,
    abnormalRe: /rib fracture|clavicular fracture|fracture of the|dislocated|dislocation|scoliotic (alignment )?fracture/i,
    label: "“No acute bony abnormality” coexists with a fracture.",
  },
];

function sentences(text: string): string[] {
  return text
    .split(/[.\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasAbnormalSentence(text: string, re: RegExp): boolean {
  return sentences(text).some((s) => {
    if (!re.test(s)) return false;
    const negativeForm = /\bno\b|\bnot\b|\bwithout\b|\babsence\b|\bfree of\b/i;
    return !negativeForm.test(s);
  });
}

/**
 * A cardiac-size CONCLUSION, excluding sentences that carry their own
 * limitation. Radiologists mix the sub-master with the live seeded X-Ray
 * protocol text ("The cardiac size cannot be accurately assessed on the AP
 * projection."), which names the cardiac silhouette precisely to say it is NOT
 * assessable — flagging that as an unsupported conclusion would be a false
 * positive on correct reporting.
 */
const CARDIAC_CLAIM = /\bcardiac (size|silhouette)\b|\bheart size\b|cardiothoracic ratio|cardiomegaly/i;
const CARDIAC_LIMITATION =
  /cannot be (accurately |reliably |fully |adequately )?(assessed|evaluated|determined|appreciated|confirmed|shown)|not (accurately |reliably |fully |adequately )?(assessed|evaluated|determinable|appreciated|assessable)|is not assessable|allowing for (the )?(ap|portable|supine|projection)|\bmagnification\b|overestimat/i;

function claimsUnqualifiedCardiacSize(text: string): boolean {
  return sentences(text).some((s) => CARDIAC_CLAIM.test(s) && !CARDIAC_LIMITATION.test(s));
}

export function chestTextContradictions(opts: {
  findingsText: string;
  impressionText?: string;
  techniqueText?: string;
  /** Pre-parsed technique context; parsed from `techniqueText` when omitted. */
  viewCtx?: XrayTechniqueContext;
}): string[] {
  const combined = [opts.findingsText, opts.impressionText ?? ""].join("\n");
  const ctx = opts.viewCtx ?? parseXrayChestViews(opts.techniqueText);
  const warnings: string[] = [];

  for (const rule of CHEST_CONTRADICTION_RULES) {
    if (rule.normalRe.test(combined) && hasAbnormalSentence(combined, rule.abnormalRe)) {
      warnings.push(`X-ray Chest: ${rule.label}`);
    }
  }

  // Technique-dependent statements vs documented technique, and the projection
  // reason behind a cardiac one (spec §2, §7, §11, §17). An AP film that is not
  // recorded at all is exactly the "PA-only assumption on AP" failure the
  // fallback catch below exists to catch, so the cardiac check runs whether or
  // not the technique names a view.
  const cardiac = assessCardiacSize(ctx);
  const cardiacReason = cardiac.allowed ? null : (cardiac.caveat ?? cardiac.blocked);
  const techniqueDetails = ctx.hasTechniqueSignal ? unsupportedTechniqueStatements(ctx, combined) : [];
  let cardiacFlagged = false;
  for (const detail of techniqueDetails) {
    if (cardiacReason && /cardiac|cardiomegaly/i.test(detail)) {
      cardiacFlagged = true;
      warnings.push(`X-ray Chest: the report contains ${detail} — ${cardiacReason}`);
    } else {
      warnings.push(`X-ray Chest: the report contains ${detail}.`);
    }
  }
  if (!cardiacFlagged && !cardiac.allowed && claimsUnqualifiedCardiacSize(combined)) {
    warnings.push(
      `X-ray Chest: ${cardiacReason} A cardiac-size conclusion is being drawn from a projection that cannot support it.`,
    );
  }

  // Comparison language needs a dated prior reference (spec §15, §17).
  const comparison = unanchoredComparisonWarning(combined);
  if (comparison) warnings.push(`X-ray Chest: ${comparison}.`);

  // Unresolved fill-in tokens must never reach a signed report.
  const tokens = [...new Set(unfilledChestTokens(combined))];
  if (tokens.length) {
    warnings.push(
      `X-ray Chest: unfilled placeholder${tokens.length > 1 ? "s" : ""} still present (${tokens.join(", ")}).`,
    );
  }

  return [...new Set(warnings)];
}
