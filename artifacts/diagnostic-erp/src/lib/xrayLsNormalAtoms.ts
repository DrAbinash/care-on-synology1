/**
 * xrayLsNormalAtoms.ts — the coverage- AND numbering-aware normal baseline
 * (spec §5, §6).
 *
 * Prose comes from the canonical library
 * (docs/clinical-libraries/xray-ls-spine-clinical-content-library.md §2), and
 * every sentence here is also the `baselineReplaces` contract the abnormal atoms
 * use, so the baseline text and the supersession contract cannot drift apart.
 * That is why each section has exactly ONE sentence per state: supersession in
 * the ledger is a text match, and a baseline that reworded itself per level list
 * would leave a stale "everything is preserved" line sitting next to a new
 * "L4-L5 disc-space narrowing".
 *
 * Two rules make this more than a text block:
 *  1. a normal lumbosacral spine may only be certified for what the recorded
 *     views can see — the lumbosacral junction, the posterior elements, T12-L1
 *     and the sacroiliac joints each have their own coverage dimension, and each
 *     gets its own state-specific sentence rather than a blanket normal;
 *  2. a transitional or unanchored study must not read as a confidently numbered
 *     five-segment spine. Spec §6: "Transitional anatomy/numbering uncertainty
 *     must prevent falsely confident level-specific normal prose." So the disc
 *     line is scoped to the levels adequately visualized, and the numbering
 *     atom states the basis and the caution before any level is named.
 *
 * Pure functions only — no store, no React.
 */
import { LS_JUNCTION_LEVEL } from "./xrayLsLevels";
import {
  composeLsNumberingSentence,
  lsLevelSpecificNormalAllowed,
  type LsNumbering,
} from "./xrayLsNumbering";
import { lsAtomsToPatches, lsBundleId, type LsAtomSpec } from "./xrayLsAtoms";
import {
  assessL5S1,
  assessPars,
  LS_JUNCTION_SENTENCES,
  LS_SI_SENTENCES,
  LS_T12L1_SENTENCES,
  lsL5S1NormalSentence,
  lsSiJointNormalSentence,
  lsT12L1CoverageSentence,
  type XrayLsTechniqueContext,
} from "./xrayLsViews";

export const LS_NORMAL_SENTENCES = {
  alignment: "Lumbar lordosis and alignment are maintained.",
  alignmentNotAssessed:
    "Sagittal alignment and lordosis cannot be assessed, as no lateral view is recorded.",
  vertebrae: "Vertebral body heights are preserved.",
  discs: "Intervertebral disc spaces are preserved at the levels adequately visualized.",
  posteriorElements: "Visualized posterior elements are intact.",
  parsNotAssessed:
    "The pars interarticularis is not assessed, as the posterior elements are not recorded as adequately visualized.",
  noFracture: "No acute fracture or listhesis is identified.",
  noHardware: "No lumbar spinal instrumentation or fusion hardware is seen.",
  siPreserved: LS_SI_SENTENCES.preserved,
  siHedged: LS_SI_SENTENCES.hedged,
  siNotAssessed: LS_SI_SENTENCES.notAssessed,
  junctionAdequate: LS_JUNCTION_SENTENCES.adequate,
  junctionHedged: LS_JUNCTION_SENTENCES.hedged,
  junctionNotAdequate: LS_JUNCTION_SENTENCES.notAdequate,
  t12l1Included: LS_T12L1_SENTENCES.included,
  t12l1Excluded: LS_T12L1_SENTENCES.excluded,
  t12l1NotRecorded: LS_T12L1_SENTENCES.notRecorded,
  // "vertebral bodies" is the anatomicalSection of the vertebra line, and the
  // ledger's section matcher lets a new atom absorb any existing sentence that
  // names its own section. Worded with "vertebrae", the numbering line stays a
  // line of its own instead of being silently replaced by "Vertebral body
  // heights are preserved." — which would delete the study's numbering basis.
  numberingStandard: "Five lumbar-type vertebrae are counted, and numbering is standard.",
  numberingUnsetCaution:
    "Segment levels below are therefore described as counted, not as an assumed L5-S1 junction.",
  numberingCaution:
    "Level labels follow the numbering basis stated above; segment-specific statements should be read with that caution.",
  impression:
    "No acute osseous abnormality identified on the provided lumbosacral spine radiographs.",
} as const;

export type LsNormalConcept =
  | "ls_numbering_basis"
  | "ls_alignment"
  | "ls_vertebral_body_height"
  | "ls_disc_space"
  // Not ls_-prefixed: #778 made posterior_elements one canonical concept for
  // radiography and MR alike, so the lumbosacral baseline emits that id and the
  // role ("baseline") keeps it out of the impression.
  | "posterior_elements"
  | "ls_l5s1_junction"
  | "ls_si_joints"
  | "ls_no_acute_fracture"
  | "ls_no_hardware";

const SECTION: Record<LsNormalConcept, string> = {
  ls_numbering_basis: "numbering",
  ls_alignment: "alignment",
  ls_vertebral_body_height: "vertebral bodies",
  ls_disc_space: "disc spaces",
  posterior_elements: "posterior elements",
  ls_l5s1_junction: "alignment",
  ls_si_joints: "sacroiliac joints",
  ls_no_acute_fracture: "vertebral bodies",
  ls_no_hardware: "hardware",
};

export function buildLsNormalAtomSpecs(
  ctx: XrayLsTechniqueContext,
  numbering: LsNumbering,
): LsAtomSpec[] {
  const S = LS_NORMAL_SENTENCES;
  const atoms: LsAtomSpec[] = [];

  const push = (
    concept: LsNormalConcept,
    findings: string,
    extra: Partial<LsAtomSpec> = {},
  ) => {
    atoms.push({
      concept,
      conflictGroup: extra.conflictGroup ?? concept,
      anatomicalSection: SECTION[concept],
      findings,
      // Normal sentences are a materialized baseline, not abnormalities.
      role: "baseline",
      ...extra,
    });
  };

  // Numbering first (spec §17 order: technique/views, then numbering): the report
  // says how its levels were derived before it names any level.
  push("ls_numbering_basis", composeNumberingBaseline(numbering));

  // Alignment and lordosis are lateral-view statements (spec §2, §4).
  push(
    "ls_alignment",
    ctx.performed.lateral ? S.alignment : S.alignmentNotAssessed,
    ctx.performed.lateral ? { view: "lateral" } : {},
  );

  push("ls_vertebral_body_height", S.vertebrae);
  push("ls_no_acute_fracture", S.noFracture);

  // Disc spaces: one stable sentence, scoped to what was seen. The junction and
  // upper-coverage caveats are their own atoms, so an abnormal disc selection
  // always supersedes exactly this line (spec §6 reconciliation).
  push("ls_disc_space", S.discs);

  // Posterior elements / pars: gated by the projection that can see them.
  push(
    "posterior_elements",
    assessPars(ctx).allowed ? S.posteriorElements : S.parsNotAssessed,
    assessPars(ctx).allowed && ctx.performed.lateral ? { view: "lateral" } : {},
  );

  // Coverage dimensions the library insists on being stated explicitly.
  const junctionSeen = assessL5S1(ctx).allowed;
  push("ls_l5s1_junction", lsL5S1NormalSentence(ctx), {
    level: junctionSeen ? LS_JUNCTION_LEVEL : undefined,
    baselineReplaces: "",
  });
  push("ls_si_joints", lsSiJointNormalSentence(ctx), {
    view: ctx.performed.ap ? "ap" : undefined,
  });

  // Spec §5 lists hardware in the shared LS core; the post-operative atoms
  // supersede exactly this sentence.
  push("ls_no_hardware", S.noHardware);

  return atoms;
}

/**
 * The numbering line inside the normal baseline. A confident standard film needs
 * one short factual sentence; anything else states the basis and the caution so
 * that "normal" never silently implies a five-segment spine.
 */
function composeNumberingBaseline(numbering: LsNumbering): string {
  const S = LS_NORMAL_SENTENCES;
  if (lsLevelSpecificNormalAllowed(numbering)) return S.numberingStandard;
  const caution = numbering.basis === "unset" ? S.numberingUnsetCaution : S.numberingCaution;
  return `${composeLsNumberingSentence(numbering)} ${caution}`;
}

/** The coverage atom list a canvas shows beside the one-click normal. */
export function buildLsNormalCoverageNotes(
  ctx: XrayLsTechniqueContext,
  numbering: LsNumbering,
): string[] {
  const notes: string[] = [];
  if (!assessL5S1(ctx).allowed) notes.push(lsL5S1NormalSentence(ctx));
  if (!ctx.performed.lateral) notes.push(LS_NORMAL_SENTENCES.alignmentNotAssessed);
  if (!assessPars(ctx).allowed) notes.push(LS_NORMAL_SENTENCES.parsNotAssessed);
  notes.push(lsT12L1CoverageSentence(ctx));
  if (ctx.adequacy.siJointVisualization !== "adequate") notes.push(lsSiJointNormalSentence(ctx));
  if (!lsLevelSpecificNormalAllowed(numbering)) notes.push(LS_NORMAL_SENTENCES.numberingCaution);
  return notes;
}

export function buildLsNormalAtoms(opts: {
  region?: string;
  ctx: XrayLsTechniqueContext;
  numbering: LsNumbering;
  bundleId?: string;
}): { bundleId: string; observations: ReturnType<typeof lsAtomsToPatches> } {
  const region = opts.region ?? "Lumbar Spine";
  const bundleId = opts.bundleId ?? lsBundleId("normal", "ls");
  return {
    bundleId,
    observations: lsAtomsToPatches(
      region,
      bundleId,
      buildLsNormalAtomSpecs(opts.ctx, opts.numbering),
    ),
  };
}

/** The one-click normal impression line (also the system-normal seed). */
export const LS_NORMAL_IMPRESSION = LS_NORMAL_SENTENCES.impression;

/**
 * The numbering record written as a ledger observation.
 *
 * LS adds no schema column: the numbering basis is persisted exactly the way the
 * Technique field persists views — as report prose the feature can read back
 * (parseLsNumberingFromText). One bundle per basis means switching the basis
 * replaces the previous statement instead of stacking two contradictory ones, and
 * the radiologist's manual edits are protected by the store's normal rules.
 */
export function buildLsNumberingAtoms(opts: {
  region?: string;
  numbering: LsNumbering;
  bundleId?: string;
}): { bundleId: string; observations: ReturnType<typeof lsAtomsToPatches> } {
  const region = opts.region ?? "Lumbar Spine";
  const bundleId = opts.bundleId ?? lsBundleId("numbering", opts.numbering.basis);
  return {
    bundleId,
    observations: lsAtomsToPatches(region, bundleId, [
      {
        concept: "ls_numbering_basis",
        conflictGroup: "ls_numbering_basis",
        anatomicalSection: "numbering",
        findings: composeLsNumberingSentence(opts.numbering),
        role: "baseline",
      },
    ]),
  };
}

/**
 * The contracts an abnormal tile may supersede, exported as one object so the
 * catalog cannot invent a baseline sentence the builder never writes.
 */
export const LS_BASELINE_CONTRACTS = {
  alignment: LS_NORMAL_SENTENCES.alignment,
  alignmentNotAssessed: LS_NORMAL_SENTENCES.alignmentNotAssessed,
  vertebrae: LS_NORMAL_SENTENCES.vertebrae,
  discs: LS_NORMAL_SENTENCES.discs,
  posteriorElements: LS_NORMAL_SENTENCES.posteriorElements,
  parsNotAssessed: LS_NORMAL_SENTENCES.parsNotAssessed,
  noFracture: LS_NORMAL_SENTENCES.noFracture,
  noHardware: LS_NORMAL_SENTENCES.noHardware,
  siPreserved: LS_NORMAL_SENTENCES.siPreserved,
  junctionAdequate: LS_NORMAL_SENTENCES.junctionAdequate,
  t12l1Excluded: LS_NORMAL_SENTENCES.t12l1Excluded,
} as const;
