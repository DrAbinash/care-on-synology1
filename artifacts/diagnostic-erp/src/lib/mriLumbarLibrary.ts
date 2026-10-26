/**
 * mriLumbarLibrary.ts — the canonical MRI Lumbar Spine clinical prose.
 *
 * Source of truth: `docs/clinical-libraries/mri-lumbar-clinical-content-library.md`
 * (spec §SOURCE CONTENT: "Seeded/preset prose MUST be verbatim from that
 * canonical library; the composer may template variables such as level, side,
 * measurement, severity and direction, but must never invent clinical
 * sentences").
 *
 * Every string here is a literal transcription of one library bullet or macro
 * line, minus the library's own `**` emphasis markers. `mriLumbarLibrary.test.ts`
 * reads the library file from disk and asserts each entry still appears in it,
 * so this module cannot drift into invented prose.
 *
 * Placeholders are kept exactly as the library writes them — `[L4-L5 / L5-S1]`,
 * `[left/right]`, `[X] mm`, `[X]%`, `[superiorly/inferiorly]` — and are
 * substituted by `fillLsProse`. Anything the caller has not supplied stays
 * bracketed so it renders as a visible fill-in instead of being guessed.
 *
 * Pure functions and data only — no store, no React.
 */

import {
  fillSpineProse,
  isUnfilledSpineProse,
  LUMBAR_PROSE_DIALECT,
  type SpineProseDirection,
  type SpineProseResult,
  type SpineProseSide,
  type SpineProseSlot,
  type SpineProseVars,
} from "./mriSpineProse";

export type LsSide = SpineProseSide;
export type LsDirection = SpineProseDirection;

/** The prose types live in the shared engine; these are the lumbar spellings. */
export type LsProseVars = SpineProseVars;
export type LsProseSlot = SpineProseSlot;
export type LsProseResult = SpineProseResult;

/** Library §1 Alignment & Curvature. */
export const LS_ALIGN = {
  normal: "Lumbar lordosis is well preserved. Normal lumbar alignment without listhesis.",
  lordosisLoss:
    "Loss of normal lumbar lordosis, which may be secondary to muscle spasm or positional factors.",
  lordosisReversal:
    "Reversal of lumbar lordosis with kyphotic angulation apex at [L4-L5 / L5-S1].",
  anterolisthesisDegenerative:
    "Grade 1 anterolisthesis of [L4 on L5 / L5 on S1] measuring approximately [X] mm, secondary to degenerative disc and facet disease (degenerative spondylolisthesis).",
  anterolisthesisIsthmic:
    "Grade 1 anterolisthesis of [L5 on S1] measuring approximately [X] mm, secondary to bilateral pars interarticularis defects (isthmic spondylolisthesis).",
  retrolisthesis:
    "Grade 1 retrolisthesis of [L2 on L3 / L3 on L4] measuring approximately [X] mm.",
  lstv:
    "Lumbosacral transitional vertebra (LSTV) noted with partial/complete sacralization of L5 / lumbarization of S1 (Castellvi Type [I/II/III/IV]).",
  scoliosis:
    "Degenerative scoliotic curvature of the lumbar spine convex to the [right/left] centered at [L3-L4], with secondary endplate tilt and disc height asymmetry.",
  conusNormal:
    "Conus medullaris terminates normally at the [L1 / L1-L2] level.",
} as const;

/** Library §2 Vertebral Bodies & Marrow Signal. */
export const LS_BONE = {
  normal:
    "Vertebral body heights and marrow signal intensities are normal throughout the lumbar spine.",
  noFocalLesion: "No focal osseous lesion or acute compression fracture.",
  modic1:
    "Subchondral Modic Type I degenerative endplate changes at [L4-L5 / L5-S1] (T1 hypointense, T2/STIR hyperintense), indicating active inflammatory bone marrow edema.",
  modic2:
    "Subchondral Modic Type II degenerative endplate changes at [L4-L5 / L5-S1] (T1 hyperintense, T2 isointense/hyperintense), indicating fatty marrow conversion.",
  modic3:
    "Subchondral Modic Type III degenerative endplate changes at [L4-L5 / L5-S1] (T1 and T2 hypointense), indicating subchondral sclerosis.",
  acuteFracture:
    "Acute compression fracture of the [L1 / L2] vertebral body with approximately [X]% anterior height loss and marked T2/STIR hyperintense marrow edema.",
  chronicFracture:
    "Chronic benign compression wedge fracture of [L1] without surrounding T2/STIR bone marrow edema.",
  hemangioma:
    "T1 and T2 hyperintense lesion with signal loss on fat-suppressed sequences within the [L3] vertebral body, characteristic of a benign hemangioma.",
  osteophytes:
    "Prominent anterior and posterior marginal osteophytes centered at [L3-L4 and L4-L5].",
  multifocalMarrow:
    "Multifocal patchy T1 hypointense and T2/STIR hyperintense marrow signal alterations involving multiple lumbar vertebrae, concerning for osseous metastases or systemic marrow infiltrating disorder.",
  schmorl:
    "Intraspongy disc herniation (Schmorl's node) involving the superior/inferior endplate of [L3 / L4] with surrounding reactive edema.",
} as const;

/** Library §3 Intervertebral Discs. */
export const LS_DISC = {
  normal:
    "Intervertebral disc heights and signal intensities are preserved throughout the lumbar spine.",
  noHerniation: "No posterior disc bulge, protrusion, or extrusion.",
  desiccation:
    "Multilevel disc desiccation with disc height loss, most pronounced at [L4-L5 and L5-S1].",
  hiz:
    "High-intensity zone (HIZ) in the posterior annulus fibrosus at [L4-L5 / L5-S1] on T2-weighted images, representing an acute/subacute radial annular tear.",
  diffuseBulge:
    "Diffuse posterior disc bulge at [L3-L4] indenting the ventral thecal sac without significant central canal stenosis.",
  discOsteophyteComplex:
    "Broad-based posterior disc-osteophyte complex at [L4-L5] causing flattening of the ventral thecal sac and mild canal stenosis.",
  centralProtrusion:
    "Central disc protrusion at [L4-L5] measuring approximately [X] mm in AP dimension, indenting the ventral thecal sac.",
  paracentralExtrusion:
    "Right paracentral disc extrusion at [L5-S1] measuring [X] mm (AP) x [X] mm (transverse), extending inferiorly into the right lateral recess and compressing the descending right S1 nerve root.",
  sequestration:
    "Sequestered disc fragment at [L4-L5] migrated [superiorly/inferiorly] by [X] mm, demonstrating peripheral enhancement and severe central canal stenosis.",
  extraforaminal:
    "Far lateral / extraforaminal disc herniation at [L4-L5] causing direct compression of the exiting left L4 nerve root.",
  discitis:
    "Infective discitis-osteomyelitis centered at [L4-L5] with fluid-signal disc destruction, severe endplate erosion, and diffuse T2 hyperintensity with enhancement.",
} as const;

/** Library §4 Central Canal, Conus Medullaris & Cauda Equina. */
export const LS_CANAL = {
  normal:
    "Central canal is patent throughout. The conus medullaris terminates normally at [L1] with normal signal intensity and morphology.",
  caudaNormal:
    "Cauda equina nerve roots are freely floating and symmetrically distributed within the thecal sac.",
  mildStenosis:
    "Mild central canal stenosis at [L3-L4] with effacement of the ventral CSF space (AP diameter = [X] mm).",
  moderateStenosis:
    "Moderate central canal stenosis at [L4-L5] secondary to circumferential disc bulge and ligamentum flavum hypertrophy (AP diameter = [X] mm).",
  severeStenosis:
    "Severe central canal stenosis at [L4-L5] with complete effacement of the CSF space and crowding/compression of the cauda equina nerve roots (AP diameter = [X] mm).",
  tetheredCord:
    "Tethered cord with low-lying conus medullaris terminating at the [L3 / L4] level, associated with a thickened filum terminale / intrafilar lipoma.",
  arachnoiditis:
    "Intradural clumping and peripheral adherence of cauda equina nerve roots (\"empty thecal sac\" sign), diagnostic of chronic lumbar arachnoiditis.",
  conusSignal:
    "T2 hyperintense signal within the conus medullaris at [L1], concerning for compressive myelopathy, ischemia, or demyelinating plaque.",
} as const;

/** Library §5 Neural Foramina & Extraforaminal Spaces. */
export const LS_FORAMEN = {
  normal: "Neural foramina and extraforaminal zones are patent bilaterally at all levels.",
  rootsNormal:
    "Exiting nerve roots are maintained within normal fat-filled foramina.",
  moderateForaminalNarrowing:
    "Moderate [right/left/bilateral] neural foraminal narrowing at [L4-L5] secondary to broad-based disc bulge and facet hypertrophy.",
  severeForaminalStenosis:
    "Severe [right/left] neural foraminal stenosis at [L5-S1] secondary to hypertrophic osteophytes and lateral disc extension, with direct impingement of the exiting [right/left] [L5] nerve root.",
  completeFatLoss:
    "Severe [right/left] neural foraminal stenosis at [L4-L5] with complete loss of perineural fat surrounding the exiting [right/left] [L4] nerve root.",
  extraforaminalDisc:
    "Extraforaminal disc protrusion at [L3-L4] compressing the exiting [right/left] [L3] nerve root in the extraforaminal space.",
} as const;

/** Library §6 Facet Joints, Ligamentum Flavum & Posterior Elements. */
export const LS_POSTERIOR = {
  facetNormal:
    "Facet joints demonstrate normal alignment, joint spaces, and articular cartilage.",
  lfNormal: "Ligamentum flavum and posterior elements are unremarkable.",
  facetArthropathy:
    "Bilateral facet joint arthropathy at [L4-L5 and L5-S1] with joint space narrowing, subchondral sclerosis, and osteophyte formation.",
  facetEffusion:
    "Right facet joint effusion with surrounding capsular edema at [L4-L5], compatible with acute facetitis.",
  synovialCyst:
    "Synovial cyst originating from the [left/right] [L4-L5] facet joint measuring [X] mm, projecting into the spinal canal/lateral recess and compressing the [L5] nerve root.",
  lfHypertrophy:
    "Hypertrophy and inward buckling of the ligamentum flavum at [L4-L5] measuring up to [X] mm in thickness, contributing to dorsal central canal narrowing.",
  parsDefect:
    "Bilateral defect in the pars interarticularis (spondylolysis) at [L5] with surrounding T2/STIR marrow edema, indicating acute/subacute pars stress reaction.",
} as const;

/** Library §7 Paraspinal Soft Tissues & Sacroiliac Joints. */
export const LS_SOFT_TISSUE = {
  normal: "Visualized paraspinal musculature and psoas muscles are unremarkable.",
  siNormal:
    "Visualized sacroiliac joints demonstrate normal joint alignment and articular margins.",
  psoasAbscess:
    "Psoas muscle abscess on the [left/right] measuring [X] x [X] cm with central fluid T2 hyperintensity and peripheral thick enhancement.",
  sacroiliitis:
    "Subchondral bone marrow edema and subchondral erosions involving the iliac and sacral aspects of the [left/right/bilateral] sacroiliac joint, consistent with active sacroiliitis.",
  muscleAtrophy:
    "Severe atrophy and fatty infiltration of the lumbar multifidus and erector spinae musculature.",
} as const;

/** Library §8 Post-Surgical & Hardware Evaluation. */
export const LS_POSTOP = {
  normal:
    "Expected post-surgical changes without evidence of recurrent disc herniation, hardware failure, or pathological epidural collections.",
  priorLaminectomy:
    "Status post posterior laminectomy/discectomy at [L4-L5] on the [left/right] with expected surgical defect and resolution of prior mass effect.",
  recurrentDisc:
    "Recurrent/residual disc herniation at [L5-S1] on the [left/right], demonstrating non-enhancing soft tissue continuous with the disc space on post-contrast images.",
  epiduralFibrosis:
    "Post-operative epidural fibrosis / scar tissue surrounding the descending [S1] nerve root, demonstrating diffuse homogeneous enhancement on post-contrast T1-weighted images.",
  fusionIntact:
    "Status post posterior lumbar interbody fusion (PLIF/TLIF) at [L4-L5] with pedicle screws and interbody cage intact, demonstrating no perihardware lucency or loosening.",
  hardwareLoosening:
    "Perihardware T2 hyperintensity and circumferential halo sign surrounding the [left L5] pedicle screw, concerning for hardware loosening.",
  pseudomeningocele:
    "Post-operative fluid collection / pseudomeningocele extending from the operative site at [L4-L5] into the posterior subcutaneous soft tissues measuring [X] mm.",
} as const;

/**
 * Library §9 Structured Modular Reporting Macros — the level lines of the five
 * published macros, verbatim. These are the starting presets (spec §36).
 */
export const LS_MACRO_LINES = {
  macro1: {
    alignment: "Loss of normal lumbar lordosis.",
    alignmentTail: "No listhesis.",
    marrow: "Modic Type II degenerative changes at L4-L5 and L5-S1.",
    marrowTail: "Vertebral heights are preserved.",
    discs: "Multilevel disc desiccation and loss of disc height at L3-L4, L4-L5, and L5-S1.",
    unremarkableLevel: "Unremarkable. No canal or foraminal stenosis.",
    l3l4: "Mild diffuse disc bulge. No significant central or foraminal stenosis.",
    l4l5:
      "Broad-based posterior disc-osteophyte complex with bilateral facet and ligamentum flavum hypertrophy resulting in moderate central canal stenosis (AP diameter X mm) and severe bilateral neural foraminal stenosis.",
    l5s1:
      "Posterior disc protrusion and uncovertebral/facet osteophytes causing mild central canal stenosis and severe right neural foraminal stenosis with compression of the exiting right L5 nerve root.",
    conus: "Terminates normally at L1 without intrinsic signal abnormality.",
    impression: [
      "Multilevel lumbar spondylosis, most pronounced at L4-L5 and L5-S1.",
      "Moderate L4-L5 central canal stenosis and severe bilateral neural foraminal stenosis.",
      "Severe right L5-S1 neural foraminal stenosis with impingement of the exiting right L5 nerve root.",
    ],
  },
  macro2: {
    alignment: "Preserved lumbar lordosis.",
    alignmentTail: "No spondylolisthesis.",
    marrow: "Vertebral body heights and marrow signal intensities are normal.",
    discs: "Focal disc extrusion at L5-S1 as detailed below.",
    unremarkableRange: "Unremarkable.",
    l4l5: "Unremarkable. No central or foraminal stenosis.",
    l5s1:
      "Right paracentral disc extrusion measuring X mm (AP) x X mm (transverse) with inferior migration of X mm into the right lateral recess, causing severe compression and posterior displacement of the descending right S1 nerve root.",
    conus: "Terminates normally at L1. Cauda equina nerve roots are otherwise unremarkable.",
    impression: [
      "Right paracentral disc extrusion at L5-S1 with inferior migration, causing marked compression of the descending right S1 nerve root within the right lateral recess.",
    ],
  },
  macro3: {
    alignment: "Grade 1 anterolisthesis of L5 on S1 measuring approximately X mm.",
    marrow:
      "Bilateral pars interarticularis defects (spondylolysis) at L5 with surrounding T2/STIR bone marrow edema.",
    discs:
      "Uncapping of the L5-S1 intervertebral disc secondary to slip, with disc height loss.",
    l5s1:
      "Anterolisthesis combined with pseudo-disc bulge and hypertrophic pars defects leads to severe bilateral neural foraminal stenosis, left greater than right, with compression of the exiting L5 nerve roots bilaterally.",
    l5s1Tail:
      "The AP dimension of the central canal is preserved due to separation of the anterior and posterior elements.",
    impression: [
      "Grade 1 isthmic spondylolisthesis at L5-S1 secondary to bilateral L5 pars interarticularis defects.",
      "Severe bilateral L5-S1 neural foraminal stenosis with compression of the exiting L5 nerve roots.",
    ],
  },
  macro4: {
    alignment:
      "Lumbosacral transitional vertebra (LSTV) present with enlarged left transverse process forming a pseudoarthrosis with the sacral ala (Castellvi Type IIa).",
    marrow:
      "Subchondral sclerosis and edema surrounding the left L5-S1 pseudoarthrosis (Bertolotti syndrome).",
    discs: "Hypoplastic / desiccated disc space at the transitional L5-S1 level.",
    supratransitionalLabel: "L4-L5 (Mobile level above transition)",
    supratransitional:
      "Broad-based disc protrusion causing moderate central canal stenosis and mild bilateral neural foraminal narrowing.",
    transitionalLabel: "L5-S1 (Transitional level)",
    transitional: "Protected disc space with no central canal or neural foraminal stenosis.",
    impression: [
      "Lumbosacral transitional vertebra (Castellvi Type IIa) with reactive changes at the pseudoarthrosis, compatible with Bertolotti syndrome.",
      "Accelerated disc degeneration at the supratransitional level (L4-L5) causing moderate central canal stenosis.",
    ],
  },
  macro5: {
    alignment: "Preserved lumbar lordosis.",
    marrow:
      "Post-surgical defect in the posterior elements at L5 on the right, compatible with prior right L5 hemilaminectomy.",
    discs: "Disc height loss at L5-S1.",
    l5s1:
      "Soft tissue mass in the right epidural space / lateral recess at the operative site measuring X mm.",
    recurrentDisc:
      "On post-contrast T1-weighted images, the peripheral aspect shows intense enhancement while the central portion remains non-enhancing, compatible with recurrent disc extrusion.",
    fibrosis:
      "Surrounding confluent enhancing tissue envelopes the right S1 nerve root, consistent with post-surgical epidural fibrosis / scar tissue.",
    impression: [
      "Status post right L5 hemilaminectomy.",
      "Recurrent right paracentral disc extrusion at L5-S1 surrounded by extensive post-surgical epidural fibrosis, with persistent compression of the descending right S1 nerve root.",
    ],
  },
} as const;

/** Flat id → verbatim text, used by the library-verbatim test. */
export const LS_LIBRARY_PROSE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const groups: Array<[string, Record<string, string>]> = [
    ["align", LS_ALIGN as unknown as Record<string, string>],
    ["bone", LS_BONE as unknown as Record<string, string>],
    ["disc", LS_DISC as unknown as Record<string, string>],
    ["canal", LS_CANAL as unknown as Record<string, string>],
    ["foramen", LS_FORAMEN as unknown as Record<string, string>],
    ["posterior", LS_POSTERIOR as unknown as Record<string, string>],
    ["soft", LS_SOFT_TISSUE as unknown as Record<string, string>],
    ["postop", LS_POSTOP as unknown as Record<string, string>],
  ];
  for (const [prefix, group] of groups) {
    for (const [key, text] of Object.entries(group)) out[`${prefix}.${key}`] = text;
  }
  for (const [macro, lines] of Object.entries(LS_MACRO_LINES)) {
    for (const [key, value] of Object.entries(lines as unknown as Record<string, string | readonly string[]>)) {
      if (typeof value === "string") {
        out[`${macro}.${key}`] = value;
      } else {
        value.forEach((line, i) => {
          out[`${macro}.${key}.${i}`] = line;
        });
      }
    }
  }
  return out;
})();

/**
 * The bracketed-group template engine is shared with the other spine segments and
 * lives in mriSpineProse.ts; this binding is the lumbar dialect, so lumbar wording
 * is exactly what it was when the engine lived in this file.
 */
export function fillLsProse(
  template: string,
  vars: LsProseVars = {},
): LsProseResult {
  return fillSpineProse(template, vars, LUMBAR_PROSE_DIALECT);
}

/** Conus level the radiologist must confirm — never defaulted silently. */
export const LS_CONUS_UNCONFIRMED = "[L1 / L1-L2]";

export function isUnfilledProse(text: string): boolean {
  return isUnfilledSpineProse(text);
}
