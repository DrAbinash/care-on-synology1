/**
 * mriDorsoLumbarLibrary.ts — the canonical MRI Dorso-Lumbar clinical prose.
 *
 * Source of truth: `docs/clinical-libraries/mri-dorsolumbar-clinical-content-library.md`.
 * Every string below is a literal transcription of one library bullet, label or
 * macro line, minus the library's own markdown markers. `mriDorsoLumbarLibrary.test.ts`
 * reads that file from disk and asserts each entry still appears in it, so this
 * module cannot drift into invented prose — the same discipline the dorsal and
 * lumbar libraries are held to.
 *
 * Two things make this library different from its two neighbours, and both are
 * deliberate. It is not a concatenation of a dorsal report and a lumbar report:
 * its sentences describe one examination whose coverage crosses the junction, so
 * the normal wording says "within the imaged coverage" rather than naming a
 * fixed T1-S1 range. And it names the question instead of an example value
 * ("at [level]", "[degree] canal compromise", "[cord/conus] compression"), which
 * is why `mriSpineProse` grew generic slots and per-group values.
 *
 * Two-tier wording rule: several bullets state an etiologic or syndromic
 * conclusion (hemangioma, myelomalacia, tuberculous etiology / Pott disease,
 * OLF / OPLL, DISH, metastasis, dAVF, specific tumour type). That wording is
 * kept verbatim and is reachable only from a tile or preset the radiologist
 * selects explicitly — never promoted from a pattern by itself.
 *
 * Pure functions and data only — no store, no React.
 */

import {
  fillSpineProse,
  type SpineProseDialect,
  type SpineProseResult,
  type SpineProseVars,
} from "./mriSpineProse";

export type DlProseVars = SpineProseVars;
export type DlProseResult = SpineProseResult;

/**
 * Dorso-lumbar prose spans both dialects: a level may be `T11-T12`, `T12-L1`,
 * `L3-L4`, `L5-S1` or the transitional `L5-T`, and a vertebra may be thoracic,
 * lumbar or sacral.
 */
export const DORSOLUMBAR_PROSE_DIALECT: SpineProseDialect = {
  discLevelRe:
    /^(?:[TDLS]\d{1,2}[\s]*(?:on|to|-)[\s]*[TDLS]\d{1,2}|[TDLS]\d{1,2}[\s]*(?:on|to|-)[\s]*T)$/i,
  vertebraRe: /^(?:[TD]\d{1,2}|L[1-6]|S1)$/i,
  sideVertebraRe: /^(left|right)\s+([TD]\d{1,2}|L\d|S1)$/i,
  genericSlots: true,
};

/** Library §1 Coverage / Numbering. */
export const DL_COVER = {
  numberingDocumented:
    "Vertebral numbering and acquired coverage are documented from the available localizer / whole-spine reference where present.",
  junctionIncluded: "The thoracolumbar junction is included when actually covered.",
  transitionalCaution:
    "Transitional vertebral anatomy or uncertain numbering is present; level designation should be correlated with whole-spine/localizer imaging before intervention.",
  limitedCoverage:
    "Limited superior/inferior coverage prevents complete assessment of the entire thoracic or lumbar spine.",
} as const;

/** Library §2 Alignment & Curvature. */
export const DL_ALIGN = {
  normal: "Alignment of the visualized dorsal, thoracolumbar and lumbar spine is maintained.",
  curvesPreserved:
    "Thoracic kyphosis and lumbar lordosis are preserved within the imaged coverage.",
  hyperkyphosis: "Exaggerated thoracic kyphosis.",
  kyphosisStraightened: "Straightening / reversal of thoracic kyphosis.",
  lordosisLost: "Loss / straightening of lumbar lordosis.",
  junctionKyphosis: "Focal thoracolumbar junction kyphosis / gibbus deformity.",
  scoliosis: "Scoliotic curvature convex to the [right/left], apex at [level].",
  listhesis: "Anterolisthesis / retrolisthesis of [vertebra] over [vertebra], measuring [X] mm.",
} as const;

/** Library §3 Vertebral Bodies / Marrow / Endplates. */
export const DL_BONE = {
  normal: "Vertebral body heights and marrow signal are maintained within the imaged coverage.",
  noFracture: "No acute compression fracture or focal destructive marrow lesion is identified.",
  acuteFracture:
    "Acute/subacute compression or wedge fracture with T1 hypointense and STIR hyperintense marrow edema.",
  burst: "Burst-fracture pattern with posterior cortical involvement and retropulsion.",
  chronicWedging: "Chronic vertebral wedging without marrow edema.",
  endplateChange: "Endplate irregularity / sclerosis.",
  modic: "Modic type I / II / III endplate change where sequence criteria are fulfilled.",
  schmorl: "Schmorl node with / without surrounding reactive marrow signal.",
  hemangioma:
    "Focal T1/T2 hyperintense lesion with fat-suppression characteristics compatible with hemangioma when selected by the radiologist.",
  marrowReplacing: "Focal or multifocal marrow-replacing lesion.",
  collapse: "Vertebral collapse / pathological-fracture pattern.",
} as const;

/** Library §4 Intervertebral Discs — the supported level findings. */
export const DL_DISC = {
  preserved: "preserved disc height/signal",
  desiccation: "desiccation",
  reducedSpace: "reduced disc space",
  diffuseBulge: "diffuse bulge",
  broadProtrusion: "broad-based protrusion",
  focalProtrusion: "focal protrusion",
  extrusion: "extrusion",
  migration: "migration when demonstrated",
  inflammatorySignal: "endplate/disc inflammatory signal",
  calcified: "calcified/low-signal disc component as descriptive observation",
} as const;

/** Library §5 Thoracic Canal / Cord. */
export const DL_CANAL = {
  cordNormal: "Visualized thoracic spinal cord demonstrates normal caliber and signal.",
  noCanalCompromise:
    "No significant thoracic canal compromise is identified within the imaged coverage.",
  thecalIndentation: "Ventral/dorsal thecal sac indentation.",
  canalNarrowing: "Central canal narrowing at [level].",
  cordFlattening: "Cord flattening / compression.",
  cordSignal: "Intrinsic T2/STIR cord hyperintensity.",
  myelomalacia: "Cord volume loss / myelomalacic pattern when selected.",
  epiduralAbnormality: "Epidural abnormality.",
  ossificationPattern:
    "OLF / OPLL pattern where radiologist-selected; CT may better characterize ossification.",
} as const;

/** Library §6 Thoracolumbar Junction / Conus — a first-class section. */
export const DL_JUNCTION = {
  conusNormal:
    "Conus medullaris terminates at the documented level and demonstrates normal signal, when adequately covered.",
  alignment: "T10-L2 junctional alignment.",
  discDisease: "T11-T12, T12-L1 and L1-L2 disc/endplate disease where covered.",
  fracture: "Junctional fracture / retropulsion.",
  plc: "Posterior ligamentous complex observations.",
  epidural: "Epidural collection / hematoma / mass.",
  conusLevel: "Conus level.",
  conusCaliberSignal: "Conus caliber and signal.",
  conusCompression: "Conus compression.",
  conusSignal: "Intrinsic conus T2/STIR signal.",
  transition: "Transition from cord to conus to cauda equina.",
  extension: "Paravertebral / psoas extension when included.",
} as const;

/** Library §7 Lumbar Canal / Lateral Recess / Neural Elements. */
export const DL_LUMBAR = {
  thecalCompression: "thecal sac compression",
  canalStenosis: "central canal narrowing",
  recessStenosis: "right/left lateral recess narrowing",
  foraminalStenosis: "neural foraminal narrowing",
  traversingRoot: "traversing-root contact/impingement suggestion using the established lumbar level model",
  exitingRoot: "exiting-root contact/impingement suggestion using the established lumbar level model",
  facet: "facet arthropathy",
  flavum: "ligamentum flavum hypertrophy",
  cauda: "cauda-equina crowding/compression",
  epidural: "epidural abnormality",
} as const;

/** Library §8 Neural Foramina. */
export const DL_FORAMEN = {
  thoracic: "right/left foraminal narrowing or lesion at [level].",
  lumbar: "right/left foraminal narrowing with exiting-root relationship where supported.",
} as const;

/** Library §9 Posterior Elements / Ligaments. */
export const DL_POSTERIOR = {
  pedicles: "pedicles",
  laminae: "laminae",
  spinous: "spinous processes",
  facets: "facets",
  marrowLesion: "posterior-element marrow lesion",
  fracture: "posterior-element fracture",
  interspinous: "interspinous ligament injury pattern",
  flavum: "ligamentum flavum abnormality",
  plc: "posterior ligamentous complex observations",
  pars: "pars abnormalities only in anatomically appropriate lumbar coverage",
} as const;

/** Library §10 Costovertebral / Paravertebral / Psoas. */
export const DL_SOFT = {
  costovertebral: "costovertebral / costotransverse abnormality where visualized.",
  paravertebral: "paravertebral soft-tissue mass / collection.",
  psoas: "paravertebral and psoas abnormality when included.",
} as const;

/** Library §11 Degenerative Disease (mixed thoracic + lumbar, one wording). */
export const DL_DEGEN = {
  discDesiccation: "disc desiccation / disc-space reduction",
  osteophytes: "osteophytes",
  endplateDegeneration: "endplate degeneration",
  thoracicDisc: "thoracic disc protrusion/extrusion",
  lumbarDisc: "lumbar disc bulge/protrusion/extrusion",
  facet: "facet arthropathy",
  flavum: "ligamentum flavum hypertrophy",
  neuralEffect: "canal/recess/foraminal effects",
  cordEffect: "cord/conus/cauda effects according to level.",
} as const;

/** Library §12 Trauma. */
export const DL_TRAUMA = {
  fracture: "compression / wedge / burst fracture",
  posteriorWall: "posterior-wall involvement",
  retropulsion: "retropulsion",
  heightLoss: "vertebral height loss %",
  marrowEdema: "marrow edema",
  posteriorElement: "posterior-element injury",
  plc: "posterior ligamentous complex observations",
  epiduralHematoma: "epidural hematoma",
  canalCompromise: "canal compromise",
  neuralCompression: "cord / conus compression",
  signal: "intrinsic cord/conus T2 signal",
  softTissue: "paravertebral soft-tissue injury",
} as const;

/** Library §13 Infection / Spondylodiscitis. */
export const DL_INFECTION = {
  involved: "involved vertebrae/disc",
  endplate: "endplate erosion/destruction",
  marrowEdema: "marrow edema",
  collapse: "vertebral collapse",
  kyphosis: "kyphosis/gibbus",
  epidural: "epidural component",
  paravertebral: "pre/paravertebral collection",
  psoas: "psoas extension when covered",
  dimensions: "collection dimensions and craniocaudal extent",
  canal: "canal compromise",
  neural: "cord/conus/cauda compression",
  enhancement: "enhancement only when contrast performed",
} as const;

/** Library §14 Tumor / Marrow / Epidural Disease. */
export const DL_TUMOR = {
  marrowLesion: "focal/multifocal marrow lesion",
  collapse: "vertebral collapse/pathological fracture",
  posteriorElement: "posterior-element involvement",
  epidural: "epidural extension",
  paravertebral: "paravertebral extension",
  canal: "canal compromise",
  neural: "cord/conus/cauda effect",
  intradural: "intradural/intramedullary lesion where present",
  enhancement: "enhancement when contrast exists",
} as const;

/** Library §15 Intradural / Intramedullary / Vascular Pattern. */
export const DL_INTRADURAL = {
  intramedullary: "intramedullary cord/conus lesion",
  extramedullary: "intradural extramedullary lesion",
  expansion: "cord/conus expansion",
  signal: "intrinsic signal abnormality",
  flowVoid: "serpiginous perimedullary flow-void pattern",
  edema: "associated cord edema",
} as const;

/** Library §16 OLF / OPLL / DISH. */
export const DL_OSSIFICATION = {
  flavum: "ligamentum flavum low-signal thickening / suspected ossification",
  opl: "posterior longitudinal ligament low-signal thickening / suspected ossification",
  effect: "canal/cord effect",
  dish: "flowing/bridging anterior longitudinal ligament ossification pattern",
  ctNote: "MRI may suggest ossification; CT may be recommended for characterization.",
} as const;

/** Library §17 Post-operative. */
export const DL_POSTOP = {
  decompression: "decompression / laminectomy",
  fusion: "fixation / fusion",
  hardware: "screws / rods / cages",
  operatedLevels: "operated levels",
  alignment: "alignment",
  recurrent: "residual/recurrent canal compromise",
  collection: "epidural/postoperative collection",
  artifact: "hardware-related artifact",
  adjacent: "adjacent-level degeneration",
} as const;

/** Library §18 Deformity / Congenital / Transitional Anatomy. */
export const DL_DEFORMITY = {
  scoliosis: "scoliosis",
  kyphosis: "kyphosis/gibbus",
  segmentation: "segmentation anomaly",
  hemivertebra: "hemivertebra",
  blockVertebra: "block vertebra",
  lstv: "lumbosacral transitional vertebra when covered",
  numberingCaution: "numbering caution",
} as const;

/** Library §20 — the one screening limitation line, emitted exactly once. */
export const DL_SCREENING_LIMITATION =
  "SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.";

/** Library §12 / §13 macros, kept as the library wrote them. */
export const DL_MACROS = {
  thoracolumbarBurst: {
    id: "thoracolumbar-burst",
    label: "Thoracolumbar Junction Burst Fracture",
    findings:
      "Focal kyphotic angulation at the thoracolumbar junction. Acute burst fracture of the [T12/L1] vertebral body with approximately [X]% height loss and posterior cortical disruption. Retropulsed bony fragment projects approximately [X] mm into the spinal canal. Associated marrow edema is present. Posterior ligamentous complex abnormality is [present/suspected/not identified] on the available sequences. There is [degree] canal compromise with [cord/conus] compression and [presence/absence] of intrinsic T2/STIR signal abnormality.",
    impression: [
      "Acute burst fracture at [level] with retropulsion and [degree] canal compromise.",
      "Associated [cord/conus] effect as described.",
      "Posterior ligamentous complex injury is reported only when supported and radiologist-selected.",
    ],
  },
  junctionSpondylodiscitis: {
    id: "junction-spondylodiscitis",
    label: "Junction-crossing Spondylodiscitis",
    findings:
      "Abnormal marrow signal and endplate destruction involve [levels] with abnormal intervening disc signal. Associated pre/paravertebral soft-tissue component extends from [level] to [level], with [epidural/psoas] extension where present. There is [degree] canal compromise with effect on the [cord/conus/cauda].",
    impression: [
      "Imaging features of infective spondylodiscitis involving [levels], with associated soft-tissue/epidural extension as described.",
      "Tuberculous etiology / Pott disease is radiologist-selected and must not be generated solely from the presence of a paravertebral collection.",
    ],
  },
} as const;

/** Every prose string this module seeds, for the verbatim guard test. */
export const DL_LIBRARY_PROSE: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...DL_COVER,
    ...DL_ALIGN,
    ...DL_BONE,
    ...DL_DISC,
    ...DL_CANAL,
    ...DL_JUNCTION,
    ...DL_LUMBAR,
    ...DL_FORAMEN,
    ...DL_POSTERIOR,
    ...DL_SOFT,
    ...DL_DEGEN,
    ...DL_TRAUMA,
    ...DL_INFECTION,
    ...DL_TUMOR,
    ...DL_INTRADURAL,
    ...DL_OSSIFICATION,
    ...DL_POSTOP,
    ...DL_DEFORMITY,
    screeningLimitation: DL_SCREENING_LIMITATION,
    burstFindings: DL_MACROS.thoracolumbarBurst.findings,
    burstImpression1: DL_MACROS.thoracolumbarBurst.impression[0]!,
    burstImpression2: DL_MACROS.thoracolumbarBurst.impression[1]!,
    burstImpression3: DL_MACROS.thoracolumbarBurst.impression[2]!,
    spondyFindings: DL_MACROS.junctionSpondylodiscitis.findings,
    spondyImpression1: DL_MACROS.junctionSpondylodiscitis.impression[0]!,
    spondyImpression2: DL_MACROS.junctionSpondylodiscitis.impression[1]!,
  }).filter(([, value]) => /[A-Za-z]{4,}/.test(value)),
);

/** Substitute structured input into a library template. Never invents wording. */
export function fillDlProse(template: string, vars: DlProseVars = {}): DlProseResult {
  return fillSpineProse(template, vars, DORSOLUMBAR_PROSE_DIALECT);
}

/** The conus level the radiologist must state — never defaulted silently. */
export const DL_CONUS_UNCONFIRMED = "[T12/L1]";
