/**
 * mriDorsalLibrary.ts — the canonical MRI Dorsal / Thoracic Spine clinical prose.
 *
 * Source of truth: `docs/clinical-libraries/mri-dorsal-clinical-content-library.md`
 * (spec §SOURCE CONTENT: seeded prose must be verbatim from that library; the
 * composer may template level, laterality, measurement and severity but must
 * never invent clinical sentences).
 *
 * Every string here is a literal transcription of one library bullet or macro
 * line, minus the library's own `**` emphasis markers. `mriDorsalLibrary.test.ts`
 * reads the library file from disk and asserts each entry still appears in it,
 * so this module cannot drift into invented prose.
 *
 * Two-tier wording rule (spec §36): several library bullets state an etiologic
 * or syndromic conclusion ("tuberculous cold abscess", "osteoblastic/osteolytic
 * metastases", "spinal epidural lipomatosis", "schwannoma or meningioma"). That
 * wording exists verbatim here and is reachable ONLY from a tile or preset the
 * radiologist selects explicitly. No observation tile promotes a pattern into
 * one of those sentences by itself.
 *
 * Placeholders are kept exactly as the library writes them — `[T8-T9]`,
 * `[right/left]`, `[X] mm`, `[X]%`, `[T4 through T7]`, `[with / without]` — and
 * are substituted by `fillDxProse` (the shared `mriSpineProse` engine, dorsal
 * dialect). Anything the caller has not supplied stays bracketed so it renders
 * as a visible fill-in instead of being guessed.
 *
 * Pure functions and data only — no store, no React.
 */

import {
  DORSAL_PROSE_DIALECT,
  fillSpineProse,
  type SpineProseResult,
  type SpineProseVars,
} from "./mriSpineProse";

export type DxProseVars = SpineProseVars;
export type DxProseResult = SpineProseResult;

/** Library §1 Alignment & Curvature. */
export const DX_ALIGN = {
  normal:
    "Thoracic kyphosis is within normal limits. Normal alignment of the dorsal and dorsolumbar spine without listhesis.",
  hyperkyphosis:
    "Exaggerated thoracic kyphosis (hyperkyphosis), which may be secondary to postural changes or osteoporotic wedge fractures.",
  kyphosisReversal:
    "Reversal of thoracic kyphosis / straight thoracic spine alignment.",
  scoliosis:
    "Scoliotic deformity of the thoracic spine convex to the [right/left] centered at [T7/T8], with apex vertebral rotation.",
  gibbus:
    "Thoracolumbar junction kyphotic gibbus deformity centered at [T12-L1] secondary to focal vertebral collapse.",
  anterolisthesis:
    "Grade 1 anterolisthesis of [T12 on L1] measuring approximately [X] mm, secondary to traumatic injury or degenerative facet disease.",
  retrolisthesis:
    "Grade 1 retrolisthesis of [T11 on T12] measuring approximately [X] mm.",
  conusNormal:
    "Conus medullaris terminates normally at the [T12-L1 / L1] level.",
  /** Macro 1 / Macro 4 alignment lines, used by the cord-compression presets. */
  macroKyphosisPreserved: "Preserved thoracic kyphosis.",
  macroNoListhesis: "No listhesis.",
  macroAlignmentPreserved: "Thoracic alignment and kyphosis are preserved.",
  macroJunctionalAngulation:
    "Focal kyphotic angulation at the thoracolumbar junction ([T12-L1]).",
  macroFocalAngulation: "Focal angulation at [T6] secondary to vertebral collapse.",
  macroGibbusCentre: "Focal gibbus deformity centered at [T9-T10].",
} as const;

/** Library §2 Vertebral Bodies & Marrow Signal. */
export const DX_BONE = {
  normal:
    "Vertebral body heights and marrow signal intensities are maintained throughout the dorsal and dorsolumbar spine.",
  noFocalLesion:
    "No acute compression fracture, focal lytic/sclerotic lesion, or marrow infiltrative process.",
  modic1:
    "Subchondral Modic Type I degenerative endplate changes at [T12-L1] (T1 hypointense, T2/STIR hyperintense), indicating active inflammatory bone marrow edema.",
  modic2:
    "Subchondral Modic Type II degenerative endplate changes at [T11-T12] (T1 hyperintense, T2 isointense/hyperintense), indicating fatty marrow replacement.",
  acuteCompressionFracture:
    "Acute wedge compression fracture of the [T12] vertebral body with approximately [X]% anterior height loss and marked T2/STIR hyperintense marrow edema.",
  burstFracture:
    "Acute burst fracture of the [L1] vertebral body with posterior cortex retropulsion extending [X] mm into the spinal canal.",
  chronicWedging:
    "Chronic wedging of the [T8] vertebral body without abnormal T2/STIR marrow edema.",
  dish:
    "Continuous bridging ossification along the anterior longitudinal ligament involving at least four contiguous vertebral levels ([T7 through T10]), characteristic of Diffuse Idiopathic Skeletal Hypertrophy (DISH).",
  ankylosingSpondylitis:
    "Prominent anterior and lateral bridging syndesmophytes (\"bamboo spine\") in an ankylosed dorsal spine.",
  multifocalMarrow:
    "Multiple rounded T1 hypointense and T2/STIR hyperintense osseous lesions scattered throughout the thoracic vertebrae, highly concerning for osteoblastic/osteolytic metastases.",
  hemangioma:
    "Well-demarcated T1 and T2 hyperintense lesion with signal drop on fat-suppressed sequences in the [T6] body, characteristic of a benign hemangioma.",
  schmorl:
    "Schmorl's node (intraosseous disc herniation) involving the [superior/inferior] endplate of [T11 / T12] with surrounding reactive marrow edema.",
  /** Macro 2 / Macro 3 / Macro 5 marrow lines. */
  macroBurstBody:
    "Acute burst fracture of the [T12] vertebral body with approximately X% anterior height loss and disruption of the posterior cortical margin.",
  macroBurstBodyUnmeasured:
    "Acute burst fracture of the [T12] vertebral body with anterior height loss and disruption of the posterior cortical margin.",
  macroBodyEdema:
    "Diffuse T1 hypointense and T2/STIR hyperintense bone marrow edema involving the entire [T12] body.",
  macroRetropulsion:
    "Retropulsed bony fragment from the posterior superior endplate projecting X mm into the spinal canal.",
  macroRetropulsionUnmeasured:
    "Retropulsed bony fragment from the posterior superior endplate projecting into the spinal canal.",
  macroConfluentInfection:
    "Confluent T1 hypointensity and T2/STIR hyperintensity involving the [T9-T10] vertebral bodies with extensive endplate erosion and cortical destruction.",
  macroMarrowReplacement:
    "Replacement of the normal fatty marrow signal within the [T6] vertebral body by confluent T1 hypointense and T2/STIR hyperintense abnormal tissue.",
  macroPathologicalFracture:
    "Pathological compression fracture of [T6] with approximately X% height loss and extension of tumor tissue into the pedicles and posterior elements.",
  macroPathologicalFractureUnmeasured:
    "Pathological compression fracture of [T6] with height loss and extension of tumor tissue into the pedicles and posterior elements.",
  macroMultifocalPatchy:
    "Multifocal patchy marrow lesions noted within the [T2] vertebral bodies.",
  macroHeightsPreserved:
    "Vertebral heights are preserved without acute fracture.",
} as const;

/** Library §3 Intervertebral Discs. */
export const DX_DISC = {
  normal:
    "Intervertebral disc heights and T2 signal intensities are preserved throughout the dorsal spine.",
  noHerniation:
    "No central or focal disc herniation, cord flattening, or neural foraminal compromise.",
  desiccation:
    "Multilevel disc desiccation with disc height loss, most pronounced in the mid-to-lower thoracic spine ([T7-T8 through T11-T12]).",
  centralProtrusion:
    "Central disc protrusion at [T8-T9] measuring approximately [X] mm in AP dimension, indenting the ventral thecal sac.",
  calcifiedHerniation:
    "Calcified thoracic disc herniation at [T9-T10] measuring [X] mm, producing ventral cord flattening and focal CSF space effacement.",
  paracentralExtrusion:
    "Right paracentral disc extrusion at [T11-T12] measuring [X] mm (AP) x [X] mm (transverse), extending [inferiorly/superiorly] and displacing the descending thoracic spinal cord.",
  extraforaminal:
    "Far lateral / extraforaminal disc herniation at [T12-L1] compressing the exiting [T12] spinal nerve.",
  spondylodiscitis:
    "Infective spondylodiscitis centered at [T10-T11] characterized by fluid-signal disc destruction, endplate erosions, and diffuse enhancement, extending into the adjacent epidural space (Pott's spine / tuberculous spondylitis).",
  /** Macro disc lines. */
  macroDiscFluid:
    "T2 hyperintense fluid signal within the [T11-T12] disc space.",
  macroDiscDestruction:
    "Near-complete destruction of the [T9-T10] intervertebral disc space with fluid-signal replacement and peripheral enhancement.",
  macroDiscPreserved:
    "Intervertebral disc heights and signals adjacent to [T6] are relatively preserved.",
  macroMultilevelMildDesiccation:
    "Multilevel mild disc desiccation without large disc herniation.",
  macroFocalCalcified:
    "Focal calcified disc herniation at [T8-T9] as described below.",
} as const;

/** Library §4 Central Canal, Spinal Cord & Conus Medullaris. */
export const DX_CANAL = {
  normal: "Central canal is patent throughout the dorsal and dorsolumbar spine.",
  cordNormal:
    "Thoracic spinal cord and conus medullaris display normal caliber and uniform intrinsic signal intensity.",
  conusTerminates: "Conus medullaris terminates normally at [T12-L1 / L1].",
  severeStenosis:
    "Severe central canal stenosis at [T8-T9] secondary to posterior disc-osteophyte complex and ligamentum flavum thickening, with flattening of the spinal cord (AP diameter = [X] mm).",
  opll:
    "Ossification of the posterior longitudinal ligament (OPLL) along the dorsal aspect of [T4 through T7], producing continuous ventral spinal cord compression.",
  olf:
    "Ossification of the ligamentum flavum (OLF) at [T10-T11] projecting from the posterolateral canal walls, resulting in severe local canal narrowing and cord flattening.",
  cordSignal:
    "Focal area of intrinsically elevated T2/STIR signal intensity within the spinal cord at [T8-T9], compatible with compressive myelopathy / myelomalacia.",
  lowLyingConus:
    "Low-lying conus medullaris terminating at [L3] level, suspicious for tethered cord syndrome.",
  conusContusion:
    "Focal swelling and intrinsic T2/STIR hyperintensity within the conus medullaris at [T12-L1], secondary to traumatic contusion or acute ischemic myelopathy.",
  intraduralMass:
    "Intradural extramedullary mass at [T6-T7] causing smooth border cord displacement and severe canal narrowing, characteristic of a schwannoma or meningioma.",
  intramedullaryMass:
    "Intramedullary expansile T2 hyperintense mass extending from [T4 to T7] with heterogeneous enhancement, concerning for an ependymoma or astrocytoma.",
  /** Macro canal / cord lines. */
  macroCordCompressionLevel:
    "[T8-T9]: Central-to-[right/left] paracentral calcified disc extrusion measuring X mm in AP dimension, causing severe central canal stenosis and marked compression of the ventral spinal cord.",
  // The `X mm` above is a macro slot `fillDxProse` leaves standing when the
  // radiologist entered no measurement, so the tile would print the literal words
  // and assert a size nobody measured. These un-measured twins keep every clinical
  // clause and state none — the convention `df-anterolisthesis` already follows.
  // All four are seeded in the canonical clinical content library beside their
  // measured originals, which the verbatim prose guard requires.
  macroCordCompressionLevelUnmeasured:
    "[T8-T9]: Central-to-[right/left] paracentral calcified disc extrusion, causing severe central canal stenosis and marked compression of the ventral spinal cord.",
  macroCordSignalOedema:
    "Focal intrinsic T2/STIR hyperintensity within the compressed spinal cord at [T8-T9], compatible with compressive myelopathy / cord edema.",
  macroConusNormalL1: "The conus medullaris terminates normally at [T12-L1 / L1].",
  macroCanalRetropulsion:
    "Severe central canal stenosis at [T12] with retropulsed bone fragment impinging upon the conus medullaris.",
  macroConusEdema:
    "Focal T2 hyperintensity within the conus medullaris at [T12], indicative of edema / contusion.",
  macroEpiduralCordFlattening:
    "Subdural/epidural soft tissue component extending from [T9 to T10] measuring X mm in thickness, causing moderate-to-severe central canal stenosis and flattening of the ventral surface of the thoracic spinal cord.",
  macroEpiduralCordFlatteningUnmeasured:
    "Subdural/epidural soft tissue component extending from [T9 to T10], causing moderate-to-severe central canal stenosis and flattening of the ventral surface of the thoracic spinal cord.",
  macroOlfVShaped:
    "This results in V-shaped severe central canal narrowing (AP diameter X mm) with posterior compression of the spinal cord.",
  macroOlfVShapedUnmeasured:
    "This results in V-shaped severe central canal narrowing with posterior compression of the spinal cord.",
  macroOlfNodular:
    "[T10-T11]: Marked nodular thickening and hypointense signal on all pulse sequences along the posterolateral canal walls bilaterally, compatible with severe Ossification of the Ligamentum Flavum (OLF).",
  macroCordFlatteningWithOrWithout:
    "Mechanical flattening of the dorsal aspect of the spinal cord at [T10-T11], [with / without] intrinsic T2 hyperintensity.",
  macroCircumferentialEpidural:
    "Circumferential epidural soft tissue mass at [T6] measuring up to X mm in thickness, resulting in severe central canal stenosis and cord compression.",
  macroCircumferentialEpiduralUnmeasured:
    "Circumferential epidural soft tissue mass at [T6], resulting in severe central canal stenosis and cord compression.",
  levelsUnremarkable: "Unremarkable. No canal or foraminal stenosis.",
  levelsUnremarkableShort: "Unremarkable.",
} as const;

/** Library §5 Neural Foramina, Costovertebral Joints & Posterior Elements. */
export const DX_POSTERIOR = {
  normal:
    "Neural foramina and costovertebral joint spaces are patent bilaterally at all levels.",
  posteriorElementsIntact:
    "Posterior elements (pedicles, laminae, and spinous processes) are intact.",
  costovertebralArthropathy:
    "Hypertrophic costovertebral joint arthropathy at [T9-T10] with surrounding osteophytes projecting into the posterolateral canal and neural foramen.",
  foraminalNarrowing:
    "Neural foraminal narrowing at [T11-T12] on the [left/right] secondary to lateral disc protrusion and costovertebral osteophytes.",
  pedicleDestruction:
    "Unilateral pedicle destruction at [T8] (\"winking owl sign\" correlate), highly suspicious for focal metastatic involvement.",
  interspinousEdema:
    "Edema and fluid signal along the interspinous ligaments at [T11-T12 / T12-L1], indicative of hyperflexion sprain / interspinous ligament injury (Baastrup-like effect or acute trauma).",
  /** Macro ligament lines. */
  macroPlcDisruption:
    "Disruption of the posterior ligamentous complex (interspinous ligament and ligamentum flavum) at [T12-L1] demonstrated by focal hyperintense fluid signal on STIR.",
} as const;

/** Library §6 Paraspinal Soft Tissues & Extra-Axial Findings. */
export const DX_SOFT = {
  normal:
    "Visualized paraspinal soft tissues, mediastinal structures, pleural spaces, and retroperitoneum are within normal limits.",
  paraspinalAbscess:
    "Bilateral prevertebral and paraspinal soft tissue collection / abscess extending from [T8 to T11] measuring [X] cm in maximum thickness with peripheral thick enhancement, characteristic of tuberculous cold abscess.",
  epiduralLipomatosis:
    "Prominent dorsal epidural fat deposition from [T5 to T9] causing smooth anterior compression of the thecal sac, diagnostic of spinal epidural lipomatosis.",
  perimedullaryFlowVoids:
    "Multiple prominent, serpiginous flow voids along the dorsal subarachnoid space from [T6 to T12], highly concerning for a spinal dural arteriovenous fistula (dAVF).",
  pleuralEffusion:
    "Visualized [left/right] pleural effusion with underlying bibasilar passive atelectasis.",
  thoracicAorta:
    "Fusiform aneurysmal dilatation of the visualized descending thoracic aorta measuring up to [X] cm.",
  /** Macro soft-tissue lines. */
  macroColdAbscess:
    "Large [bilateral/right/left] prevertebral and paraspinal soft tissue collection extending from [T8 through T11], measuring X x X x X cm, demonstrating thick peripheral rim enhancement (cold abscess).",
  macroColdAbscessUnmeasured:
    "Large [bilateral/right/left] prevertebral and paraspinal soft tissue collection extending from [T8 through T11], demonstrating thick peripheral rim enhancement (cold abscess).",
} as const;

/**
 * Library §7 "Structured Modular Reporting Macros" — verbatim IMPRESSION lines.
 * The Findings lines that belong to these macros live with their section group
 * above (DX_ALIGN / DX_BONE / DX_DISC / DX_CANAL / DX_POSTERIOR / DX_SOFT) so a
 * preset can compose them without re-writing the library.
 */
export const DX_MACRO_LINES = {
  calcifiedDiscMyelopathy: {
    impression: [
      "[T8-T9] calcified central/[right/left] paracentral disc extrusion producing severe central canal stenosis.",
      "Associated thoracic spinal cord compression and intrinsic cord signal abnormality consistent with acute/subacute compressive myelopathy.",
    ],
  },
  thoracolumbarBurst: {
    impression: [
      "Acute [T12] burst fracture with retropulsion into the spinal canal causing severe canal narrowing.",
      "Associated posterior ligamentous complex injury at [T12-L1].",
      "Impingement and intrinsic T2 signal edema/contusion of the conus medullaris.",
    ],
  },
  tuberculousSpondylodiscitis: {
    impression: [
      "[T9-T10] infective spondylodiscitis with severe endplate destruction and focal kyphotic deformity, highly characteristic of tuberculous etiology (Pott's spine).",
      "Extensive rim-enhancing prevertebral, paraspinal, and anterior epidural cold abscesses.",
      "Severe central canal stenosis and thoracic spinal cord compression at [T9-T10].",
    ],
  },
  olfCanalStenosis: {
    impression: [
      "Severe [T10-T11] central canal stenosis secondary to Ossification of the Ligamentum Flavum (OLF).",
      "Associated dorsal compression of the thoracic spinal cord.",
    ],
  },
  osseousMetastasis: {
    impression: [
      "Multifocal osseous metastatic disease throughout the thoracic spine.",
      "Pathological compression fracture of [T6] with circumferential epidural tumor extension, causing severe central canal stenosis and spinal cord compression.",
    ],
  },
} as const;

/** Flat id → verbatim text, used by the library-verbatim test. */
export const DX_LIBRARY_PROSE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const groups: Array<[string, Record<string, string>]> = [
    ["align", DX_ALIGN as unknown as Record<string, string>],
    ["bone", DX_BONE as unknown as Record<string, string>],
    ["disc", DX_DISC as unknown as Record<string, string>],
    ["canal", DX_CANAL as unknown as Record<string, string>],
    ["posterior", DX_POSTERIOR as unknown as Record<string, string>],
    ["soft", DX_SOFT as unknown as Record<string, string>],
  ];
  for (const [prefix, group] of groups) {
    for (const [key, text] of Object.entries(group)) out[`${prefix}.${key}`] = text;
  }
  for (const [macro, lines] of Object.entries(DX_MACRO_LINES)) {
    for (const [key, value] of Object.entries(lines as unknown as Record<string, readonly string[]>)) {
      value.forEach((line, i) => {
        out[`${macro}.${key}.${i}`] = line;
      });
    }
  }
  return out;
})();

/**
 * Substitute dorsal library placeholders from structured input using the shared
 * spine prose engine. Unsupplied slots stay bracketed (never guessed).
 */
export function fillDxProse(template: string, vars: DxProseVars = {}): DxProseResult {
  return fillSpineProse(template, vars, DORSAL_PROSE_DIALECT);
}

/** Conus termination the radiologist must state — never defaulted silently. */
export const DX_CONUS_UNCONFIRMED = "[T12-L1 / L1]";

/** Rib-bearing levels: every thoracic disc level sits at a rib-bearing vertebra. */
export const DX_THORACIC_VERTEBRAE = [
  "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12",
] as const;
