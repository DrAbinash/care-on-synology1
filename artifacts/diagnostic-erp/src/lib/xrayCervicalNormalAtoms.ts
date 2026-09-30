/**
 * xrayCervicalNormalAtoms.ts — the coverage-aware NORMAL baseline (spec §5).
 *
 * Prose comes from the canonical cervical library
 * (docs/clinical-libraries/xray-cervical-spine-clinical-content-library.md §2).
 * Each sentence here is also the `baselineReplaces` contract the abnormal atoms
 * use, so the baseline text and the supersession contract cannot drift apart.
 *
 * The rule that makes this module more than a text block: a normal cervical
 * spine may only be certified for what the recorded views can see. The library
 * itself writes "Odontoid and C1-C2 alignment are unremarkable WHEN ADEQUATELY
 * VISUALIZED", and the seeded XR protocol checklist asks for
 * "Adequacy (C7-T1 seen)" — so the preset downgrades those lines to their
 * qualified form, and omits a disc-space certification that would silently
 * include C7-T1 on a film that stops at C6.
 *
 * Pure functions only — no store, no React.
 */
import {
  cervicalAtomsToPatches,
  cervicalBundleId,
  type CervicalAtomSpec,
} from "./xrayCervicalAtoms";
import {
  assessC7T1,
  assessOdontoid,
  c7t1Visualized,
  type XrayCervicalTechniqueContext,
} from "./xrayCervicalViews";
import { CERVICAL_DISC_LEVELS } from "./xrayCervicalLevels";

export const CERVICAL_NORMAL_SENTENCES = {
  alignment: "Cervical alignment and lordosis are maintained.",
  alignmentNotAssessed:
    "Sagittal alignment cannot be assessed, as no lateral view is recorded.",
  alignmentLines:
    "The anterior vertebral, posterior vertebral, spinolaminar and posterior spinous lines are smooth and continuous.",
  vertebrae: "Vertebral body heights are preserved.",
  discsAll: "Intervertebral disc spaces are preserved.",
  posteriorElements: "Visualized posterior elements are intact.",
  facets: "Facet joints are unremarkable at the levels seen.",
  uncovertebral: "Uncovertebral joints are preserved.",
  foramina: "Neural foramina are patent on the oblique views.",
  noFracture: "No acute fracture or listhesis is identified.",
  prevertebral: "Prevertebral soft tissues are not widened.",
  noHardware: "No anterior or posterior cervical instrumentation is seen.",
  odontoid: "Odontoid and C1-C2 alignment are unremarkable when adequately visualized.",
  odontoidConfirmed: "Odontoid and C1-C2 alignment are unremarkable.",
  c7t1NotVisualized: "C7-T1 is not adequately visualized on this study.",
  impression:
    "No acute osseous abnormality identified on the provided cervical spine radiographs.",
} as const;

export type CervicalNormalConcept =
  | "cervical_alignment"
  | "vertebral_body_height"
  | "cervical_disc_space"
  | "posterior_elements"
  | "no_acute_fracture"
  | "prevertebral_soft_tissue"
  | "odontoid_integrity"
  | "cervical_no_hardware";

const SECTION: Record<CervicalNormalConcept, string> = {
  cervical_alignment: "alignment",
  vertebral_body_height: "vertebral bodies",
  cervical_disc_space: "disc spaces",
  posterior_elements: "posterior elements",
  no_acute_fracture: "vertebral bodies",
  prevertebral_soft_tissue: "soft tissues",
  odontoid_integrity: "craniocervical junction",
  cervical_no_hardware: "hardware",
};

export function buildCervicalNormalAtomSpecs(
  ctx: XrayCervicalTechniqueContext,
): CervicalAtomSpec[] {
  const S = CERVICAL_NORMAL_SENTENCES;
  const atoms: CervicalAtomSpec[] = [];

  const push = (
    concept: CervicalNormalConcept,
    findings: string,
    extra: Partial<CervicalAtomSpec> = {},
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

  // Sagittal alignment and lordosis are lateral-view statements (spec §2).
  if (ctx.performed.lateral) {
    push("cervical_alignment", S.alignment, { view: "lateral" });
  } else {
    push("cervical_alignment", S.alignmentNotAssessed, { severity: undefined });
  }

  push("vertebral_body_height", S.vertebrae);
  push("no_acute_fracture", S.noFracture);
  push("posterior_elements", S.posteriorElements);
  push("prevertebral_soft_tissue", S.prevertebral, { baselineReplaces: "" });

  // Disc spaces: certify only to the recorded inferior limit (spec §4, §5).
  if (c7t1Visualized(ctx)) {
    push("cervical_disc_space", S.discsAll);
  } else {
    const seen = ctx.visualizedInferiorLevel;
    const lastLevel =
      seen !== "unknown"
        ? CERVICAL_DISC_LEVELS.filter((l) => l.endsWith(`-${seen}`) || l.includes(seen)).slice(-1)[0]
        : undefined;
    push(
      "cervical_disc_space",
      lastLevel
        ? `Disc spaces are preserved from C2-C3 to ${lastLevel}. ${S.c7t1NotVisualized}`
        : `Disc spaces are preserved where visualized. ${assessC7T1(ctx).reason ?? S.c7t1NotVisualized}`,
    );
  }

  // Odontoid: only an adequately seen odontoid view supports an unqualified
  // normal line; everything else keeps the library's qualified wording.
  push(
    "odontoid_integrity",
    assessOdontoid(ctx).allowed && ctx.adequacy.odontoidVisualization === "adequate"
      ? S.odontoidConfirmed
      : S.odontoid,
    {
      level: "C1-C2",
      view: ctx.performed.odontoid ? "odontoid" : undefined,
    },
  );

  // Spec §4 lists visible hardware in the shared cervical core, and spec §12's
  // post-operative atoms supersede exactly this sentence.
  push("cervical_no_hardware", S.noHardware);

  return atoms;
}

export function buildCervicalNormalAtoms(opts: {
  region?: string;
  ctx: XrayCervicalTechniqueContext;
  bundleId?: string;
}): { bundleId: string; observations: ReturnType<typeof cervicalAtomsToPatches> } {
  const region = opts.region ?? "Cervical Spine";
  const bundleId = opts.bundleId ?? cervicalBundleId("normal", "cervical");
  return {
    bundleId,
    observations: cervicalAtomsToPatches(region, bundleId, buildCervicalNormalAtomSpecs(opts.ctx)),
  };
}

/** The one-click normal impression line (also the system-normal seed). */
export const CERVICAL_NORMAL_IMPRESSION = CERVICAL_NORMAL_SENTENCES.impression;
