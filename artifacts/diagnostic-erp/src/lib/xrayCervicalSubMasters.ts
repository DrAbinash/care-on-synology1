/**
 * xrayCervicalSpineSubMasters.ts — the X-ray Cervical Spine clinical sub-master
 * catalog (spec §3–§12; canonical prose from
 * docs/clinical-libraries/xray-cervical-spine-clinical-content-library.md).
 *
 * Like xrayChestSubMasters.ts and mriBrainSubMasters.ts this file is CONTENT:
 * it compiles tiles into ledger atoms and touches no state. The store remains
 * the only reconciler, so slot identity, provenance, baseline supersession,
 * manual protection and undo behave exactly as they do elsewhere in CARE.
 *
 * Rules encoded here:
 *  - view / adequacy gating (spec §2): odontoid and C1-C2 tiles require a
 *    recorded odontoid view; foraminal tiles require the oblique for the side
 *    being reported; dynamic tiles require flexion AND extension; C7-T1 tiles
 *    require the film to reach C7-T1. A gated tile is never silently applied —
 *    the canvas disables it and names the missing view;
 *  - abnormal atoms carry the exact normal sentence they supersede via
 *    `baselineReplaces`, taken from CERVICAL_NORMAL_SENTENCES, so "disc spaces
 *    preserved" reconciles with "C5-C6 disc-space narrowing" instead of
 *    contradicting it (spec §5);
 *  - radiography stays radiography: no cord signal, no canal stenosis grade, no
 *    disc desiccation, no Pfirrmann, no Modic, no traversing/exiting root
 *    attribution. Those are MRI conclusions and are not importable here
 *    (spec §1);
 *  - descriptive, not diagnostic: straightening is never called muscle spasm, a
 *    lytic lesion is never called metastasis, a disc/endplate destructive
 *    pattern is never called infection, and instability is only written when the
 *    radiologist selects it (spec §6, §10, §11, §12);
 *  - the uncovertebral joints are cervical-specific and are kept as their own
 *    section — they are not folded into a lumbar abstraction (spec §4);
 *  - thresholds are in xrayCervicalMeasures.ts, dynamic arithmetic in
 *    xrayCervicalDynamic.ts, never here (spec §13).
 */
import {
  cervicalAtom,
  cervicalAtomsToPatches,
  cervicalBundleId,
  type CervicalAtomSpec,
  type CervicalTemplateContext,
} from "./xrayCervicalAtoms";
import {
  buildCervicalNormalAtoms,
  CERVICAL_NORMAL_SENTENCES,
} from "./xrayCervicalNormalAtoms";
import {
  assessForaminal,
  c7t1Visualized,
  missingCervicalViewLabels,
  XRAY_CERVICAL_ADEQUACY_LABELS,
  XRAY_CERVICAL_VIEW_LABELS,
  type XrayCervicalAdequacyKey,
  type XrayCervicalTechniqueContext,
  type XrayCervicalViewKey,
} from "./xrayCervicalViews";

const N = CERVICAL_NORMAL_SENTENCES;

/** The §14 composition order, stated once so palettes and tiles follow it. */
export const CERVICAL_FINDINGS_SECTIONS = [
  "technique / views",
  "alignment",
  "vertebral bodies",
  "disc spaces",
  "posterior elements",
  "facets",
  "uncovertebral joints",
  "foramina",
  "craniocervical junction",
  "soft tissues",
  "hardware",
  "other",
] as const;

export type CervicalSection = (typeof CERVICAL_FINDINGS_SECTIONS)[number];

export type CervicalTile = {
  id: string;
  label: string;
  group: string;
  /** Hidden behind "Show advanced / rare tiles". */
  advanced?: boolean;
  /** Every one of these projections must be recorded as performed. */
  requires?: XrayCervicalViewKey[];
  /** At least one of these projections must be recorded. */
  requiresAny?: XrayCervicalViewKey[];
  /** Adequacy dimensions that must be RECORDED AS ADEQUATE, not merely unlisted. */
  requiresAdequate?: XrayCervicalAdequacyKey[];
  /** The film must demonstrably reach C7-T1 (spec §2, §4, §5). */
  requiresC7T1?: boolean;
  /** Side-specific oblique gating through assessForaminal(). */
  foraminalGate?: boolean;
  /** Matches a critical pattern of the seeded cervical knowledge pack. */
  criticalPattern?: boolean;
  atoms: CervicalAtomSpec[];
};

export type CervicalSubMasterId =
  | "routine"
  | "degenerative"
  | "trauma"
  | "alignment"
  | "dynamic"
  | "congenital"
  | "infection"
  | "tumor"
  | "postoperative"
  | "advanced";

export type CervicalSubMaster = {
  id: CervicalSubMasterId;
  label: string;
  hint: string;
  tiles: CervicalTile[];
};

/**
 * Palette order follows the report the radiologist writes: the shared core
 * first, then the two patterns that make up most cervical films, then the
 * injuries, then the rest — with "More / advanced" last (spec §3).
 */
export const CERVICAL_SUBMASTER_IDS: CervicalSubMasterId[] = [
  "routine",
  "degenerative",
  "trauma",
  "alignment",
  "dynamic",
  "congenital",
  "infection",
  "tumor",
  "postoperative",
  "advanced",
];

/* ─────────────────────────── atom helpers ─────────────────────────────── */

/** A statement about the cervical discs, superseding the "preserved" baseline. */
const DISC = (findings: string, extra: Partial<CervicalAtomSpec> = {}): CervicalAtomSpec =>
  cervicalAtom("cervical_disc_space", findings, {
    conflictGroup: "cervical_disc_space",
    anatomicalSection: "disc spaces",
    baselineReplaces: N.discsAll,
    ...extra,
  });

/** A statement about a vertebral body, superseding the height baseline. */
const VERTEBRA = (concept: string, findings: string, extra: Partial<CervicalAtomSpec> = {}): CervicalAtomSpec =>
  cervicalAtom(concept, findings, {
    conflictGroup: extra.conflictGroup ?? concept,
    anatomicalSection: "vertebral bodies",
    ...extra,
  });

/** An alignment / listhesis statement. */
const ALIGN = (concept: string, findings: string, extra: Partial<CervicalAtomSpec> = {}): CervicalAtomSpec =>
  cervicalAtom(concept, findings, {
    conflictGroup: extra.conflictGroup ?? concept,
    anatomicalSection: "alignment",
    view: "lateral",
    ...extra,
  });

/** A craniocervical / odontoid statement. */
const CCJ = (concept: string, findings: string, extra: Partial<CervicalAtomSpec> = {}): CervicalAtomSpec =>
  cervicalAtom(concept, findings, {
    conflictGroup: extra.conflictGroup ?? concept,
    anatomicalSection: "craniocervical junction",
    level: "C1-C2",
    ...extra,
  });

/** A soft-tissue statement, superseding the "not widened" baseline. */
const SOFT = (concept: string, findings: string, extra: Partial<CervicalAtomSpec> = {}): CervicalAtomSpec =>
  cervicalAtom(concept, findings, {
    conflictGroup: extra.conflictGroup ?? concept,
    anatomicalSection: "soft tissues",
    ...extra,
  });

/** A hardware statement, superseding the "no instrumentation" baseline. */
const HARDWARE = (findings: string, extra: Partial<CervicalAtomSpec> = {}): CervicalAtomSpec =>
  cervicalAtom("cervical_hardware", findings, {
    conflictGroup: "cervical_hardware",
    anatomicalSection: "hardware",
    baselineReplaces: N.noHardware,
    ...extra,
  });

/* ─────────────────────────── the catalog ──────────────────────────────── */

export const XRAY_CERVICAL_SUB_MASTERS: readonly CervicalSubMaster[] = [
  // ── 1. Routine / Normal — the shared cervical core (spec §4) ────────────
  {
    id: "routine",
    label: "Routine",
    hint: "The shared cervical core every film comments on, in report order.",
    tiles: [
      {
        id: "rt-alignment",
        label: "Alignment and lordosis maintained",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          cervicalAtom("cervical_alignment", N.alignment, {
            role: "baseline",
            anatomicalSection: "alignment",
            view: "lateral",
          }),
        ],
      },
      {
        id: "rt-alignment-lines",
        label: "Four alignment lines intact",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          cervicalAtom("cervical_alignment_lines", N.alignmentLines, {
            role: "baseline",
            anatomicalSection: "alignment",
            view: "lateral",
          }),
        ],
      },
      {
        id: "rt-vertebrae",
        label: "Vertebral body heights preserved",
        group: "Vertebrae",
        atoms: [
          cervicalAtom("vertebral_body_height", N.vertebrae, {
            role: "baseline",
            anatomicalSection: "vertebral bodies",
          }),
        ],
      },
      {
        id: "rt-no-fracture",
        label: "No acute fracture or listhesis",
        group: "Vertebrae",
        atoms: [
          cervicalAtom("no_acute_fracture", N.noFracture, {
            role: "baseline",
            anatomicalSection: "vertebral bodies",
          }),
        ],
      },
      {
        id: "rt-discs",
        label: "Disc spaces preserved",
        group: "Discs",
        atoms: [
          cervicalAtom("cervical_disc_space", N.discsAll, {
            role: "baseline",
            anatomicalSection: "disc spaces",
          }),
        ],
      },
      {
        id: "rt-posterior",
        label: "Posterior elements intact",
        group: "Posterior elements",
        atoms: [
          cervicalAtom("posterior_elements", N.posteriorElements, {
            role: "baseline",
            anatomicalSection: "posterior elements",
          }),
        ],
      },
      {
        id: "rt-facets",
        label: "Facets unremarkable",
        group: "Posterior elements",
        atoms: [
          cervicalAtom("facet_joint_normal", N.facets, {
            role: "baseline",
            anatomicalSection: "facets",
          }),
        ],
      },
      {
        id: "rt-uncovertebral",
        label: "Uncovertebral joints preserved",
        group: "Posterior elements",
        atoms: [
          cervicalAtom("uncovertebral_joints", N.uncovertebral, {
            role: "baseline",
            anatomicalSection: "uncovertebral joints",
          }),
        ],
      },
      {
        id: "rt-foramina",
        label: "Foramina patent (oblique views)",
        group: "Foramina",
        foraminalGate: true,
        atoms: [
          cervicalAtom("neural_foramina", N.foramina, {
            role: "baseline",
            anatomicalSection: "foramina",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "rt-ccj",
        label: "Odontoid / C1-C2 (when seen)",
        group: "Craniocervical",
        requires: ["odontoid"],
        atoms: [
          cervicalAtom("odontoid_integrity", N.odontoid, {
            role: "baseline",
            anatomicalSection: "craniocervical junction",
            level: "C1-C2",
            view: "odontoid",
          }),
        ],
      },
      {
        id: "rt-prevertebral",
        label: "Prevertebral soft tissues not widened",
        group: "Soft tissues",
        requires: ["lateral"],
        atoms: [
          cervicalAtom("prevertebral_soft_tissue", N.prevertebral, {
            role: "baseline",
            anatomicalSection: "soft tissues",
            view: "lateral",
          }),
        ],
      },
      {
        id: "rt-no-hardware",
        label: "No instrumentation",
        group: "Hardware",
        atoms: [
          cervicalAtom("cervical_no_hardware", N.noHardware, {
            role: "baseline",
            anatomicalSection: "hardware",
          }),
        ],
      },
    ],
  },

  // ── 2. Degenerative / cervical spondylosis (spec §7; library §5, §9) ────
  {
    id: "degenerative",
    label: "Degenerative",
    hint: "Per-level spondylotic change. Findings and impression share one source.",
    tiles: [
      {
        id: "dg-osteophytes",
        label: "Marginal osteophytes",
        group: "Vertebrae / endplates",
        atoms: [
          VERTEBRA("osteophytes", "Marginal osteophytes at [level].", {
            baselineReplaces: N.vertebrae,
          }),
        ],
      },
      {
        id: "dg-endplate-sclerosis",
        label: "Endplate sclerosis / irregularity",
        group: "Vertebrae / endplates",
        atoms: [
          VERTEBRA("cervical_endplate_sclerosis", "Endplate sclerosis and irregularity at [level]."),
        ],
      },
      {
        id: "dg-disc-mild",
        label: "Mild disc-space reduction",
        group: "Disc spaces",
        atoms: [DISC("Mild disc-space reduction at [level].", { severity: "mild" })],
      },
      {
        id: "dg-disc-moderate",
        label: "Moderate disc-space reduction",
        group: "Disc spaces",
        atoms: [DISC("Moderate disc-space reduction at [level].", { severity: "moderate" })],
      },
      {
        id: "dg-disc-severe",
        label: "Severe disc-space reduction",
        group: "Disc spaces",
        atoms: [DISC("Severe disc-space reduction at [level].", { severity: "severe" })],
      },
      {
        id: "dg-disc-endplate-osteophytes",
        label: "Disc space narrowed with endplate osteophytes",
        group: "Disc spaces",
        atoms: [
          DISC("Disc-space narrowing with endplate osteophytes at [level]."),
          VERTEBRA("osteophytes", "Marginal osteophytes at [level].", {
            conflictGroup: "osteophytes",
            baselineReplaces: N.vertebrae,
          }),
        ],
      },
      {
        id: "dg-vacuum",
        label: "Vacuum phenomenon",
        group: "Disc spaces",
        atoms: [DISC("Gas within the [level] disc space (vacuum phenomenon).", { concept: "vacuum_phenomenon", conflictGroup: "vacuum_phenomenon" })],
      },
      {
        id: "dg-c7t1",
        label: "C7-T1 disc-space narrowing",
        group: "Disc spaces",
        requiresC7T1: true,
        atoms: [DISC("Disc-space narrowing at C7-T1.", { level: "C7-T1" })],
      },
      {
        id: "dg-facet",
        label: "Facet arthropathy",
        group: "Facets",
        atoms: [
          cervicalAtom("cervical_facet_arthropathy", "Facet arthropathy with joint hypertrophy at [level].", {
            anatomicalSection: "facets",
            baselineReplaces: N.facets,
          }),
        ],
      },
      {
        id: "dg-uncovertebral",
        label: "Uncovertebral hypertrophy",
        group: "Uncovertebral joints",
        atoms: [
          cervicalAtom("uncovertebral_arthropathy", "Uncovertebral joint hypertrophy at [level].", {
            anatomicalSection: "uncovertebral joints",
            baselineReplaces: N.uncovertebral,
          }),
        ],
      },
      {
        id: "dg-foraminal-mild",
        label: "Foraminal narrowing (mild)",
        group: "Foramina",
        foraminalGate: true,
        atoms: [
          cervicalAtom(
            "foraminal_stenosis",
            "[Side] neural foraminal narrowing at [level] on the oblique views.",
            {
              anatomicalSection: "foramina",
              severity: "mild",
              supportsLaterality: true,
              baselineReplaces: N.foramina,
            },
          ),
        ],
      },
      {
        id: "dg-foraminal-moderate",
        label: "Foraminal narrowing (moderate)",
        group: "Foramina",
        foraminalGate: true,
        atoms: [
          cervicalAtom(
            "foraminal_stenosis",
            "[Side] neural foraminal narrowing at [level] on the oblique views.",
            {
              anatomicalSection: "foramina",
              severity: "moderate",
              supportsLaterality: true,
              baselineReplaces: N.foramina,
            },
          ),
        ],
      },
      {
        id: "dg-degenerative-listhesis",
        label: "Degenerative listhesis",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          ALIGN("spondylolisthesis", "Degenerative anterolisthesis of [upper] over [lower] at [level].", {
            impression: "Degenerative listhesis at [level].",
            baselineReplaces: N.noFracture,
            severity: "moderate",
          }),
        ],
      },
      {
        id: "dg-multilevel",
        label: "Multilevel spondylosis",
        group: "Pattern",
        atoms: [
          DISC("Multilevel marginal osteophytes with disc-space reduction and endplate sclerosis.", {
            concept: "cervical_spondylosis",
            conflictGroup: "cervical_spondylosis",
            anatomicalSection: "disc spaces",
            baselineReplaces: N.discsAll,
            impression: "Multilevel cervical spondylotic changes, most pronounced at [level].",
          }),
        ],
      },
    ],
  },

  // ── 3. Trauma (spec §9; library §10) — authored critical-first ─────────
  {
    id: "trauma",
    label: "Trauma",
    hint: "Unstable injury first. An inadequate series cannot exclude injury.",
    tiles: [
      {
        id: "tr-fracture-dislocation",
        label: "Fracture-dislocation / perched facet",
        group: "Unstable injury",
        criticalPattern: true,
        requires: ["lateral"],
        atoms: [
          cervicalAtom(
            "cervical_facet_dislocation",
            "Perched / dislocated facet at [level] with abnormal alignment of the segment.",
            {
              anatomicalSection: "posterior elements",
              view: "lateral",
              severity: "severe",
              baselineReplaces: N.noFracture,
              impression: "Cervical fracture-dislocation at [level] — unstable injury.",
              recommendation:
                "Urgent CT cervical spine and spinal precautions; MRI for ligamentous or cord injury.",
            },
          ),
        ],
      },
      {
        id: "tr-odontoid-fracture",
        label: "Odontoid fracture",
        group: "Unstable injury",
        criticalPattern: true,
        requires: ["odontoid"],
        requiresAdequate: ["odontoidVisualization"],
        atoms: [
          CCJ(
            "odontoid_fracture",
            "Fracture through the base of the odontoid with displacement of the fragments.",
            {
              view: "odontoid",
              severity: "severe",
              baselineReplaces: N.odontoid,
              impression: "Odontoid fracture — unstable craniocervical injury.",
              recommendation: "CT cervical spine for fracture characterization; spinal precautions.",
            },
          ),
        ],
      },
      {
        id: "tr-odontoid-suspicion",
        label: "Suspected odontoid injury (lateral film)",
        group: "Unstable injury",
        criticalPattern: true,
        requires: ["lateral"],
        atoms: [
          CCJ(
            "odontoid_fracture",
            "Suspicion of an odontoid fracture on the lateral view; an open-mouth odontoid view or CT is required for assessment.",
            {
              view: "lateral",
              severity: "severe",
              impression: "Suspected odontoid fracture — C1-C2 injury is not excluded on these views.",
              recommendation: "Open-mouth odontoid view or CT cervical spine; maintain spinal precautions.",
            },
          ),
        ],
      },
      {
        id: "tr-adi-widening",
        label: "Widened atlanto-dental interval",
        group: "Unstable injury",
        criticalPattern: true,
        requires: ["lateral"],
        requiresAny: ["lateral", "odontoid"],
        atoms: [
          CCJ("atlanto_axial_instability", "Atlanto-dental interval of [mm] mm, wider than the upper limit of normal.", {
            view: "lateral",
            severity: "severe",
            baselineReplaces: N.odontoid,
            impression: "Widened atlanto-dental interval; significance is selected by the reporting radiologist.",
            recommendation: "CT and flexion/extension assessment as clinically appropriate; spinal precautions.",
          }),
        ],
      },
      {
        id: "tr-prevertebral-swelling",
        label: "Prevertebral soft-tissue swelling",
        group: "Occult injury",
        criticalPattern: true,
        requires: ["lateral"],
        atoms: [
          SOFT("prevertebral_swelling", "Prevertebral soft-tissue swelling at [level].", {
            view: "lateral",
            baselineReplaces: N.prevertebral,
            severity: "moderate",
            impression: "Prevertebral soft-tissue swelling at [level] — consider occult injury.",
            recommendation: "CT cervical spine if the abnormality is not otherwise explained.",
          }),
        ],
      },
      {
        id: "tr-compression-fracture",
        label: "Compression fracture with height loss",
        group: "Fracture",
        requires: ["lateral"],
        atoms: [
          VERTEBRA("compression_fracture", "Compression fracture of [level] with loss of vertebral body height.", {
            view: "lateral",
            baselineReplaces: N.noFracture,
            severity: "moderate",
            impression: "Acute compression fracture at [level] with vertebral height loss.",
          }),
        ],
      },
      {
        id: "tr-burst-fracture",
        label: "Burst-type fracture with retropulsion",
        group: "Fracture",
        requires: ["lateral"],
        atoms: [
          VERTEBRA("burst_fracture", "Burst-type fracture of [level] with retropulsion of the posterior cortex.", {
            view: "lateral",
            baselineReplaces: N.noFracture,
            severity: "severe",
            impression: "Burst fracture at [level] — CT and surgical correlation advised.",
            recommendation: "CT cervical spine; MRI for cord assessment.",
          }),
        ],
      },
      {
        id: "tr-cortical-disruption",
        label: "Cortical step / disruption",
        group: "Fracture",
        requires: ["lateral"],
        atoms: [
          VERTEBRA("cervical_cortical_disruption", "Cortical step / disruption of [level] without displaced fracture.", {
            view: "lateral",
            baselineReplaces: N.noFracture,
          }),
        ],
      },
      {
        id: "tr-spinous-fracture",
        label: "Spinous process / posterior element fracture",
        group: "Fracture",
        atoms: [
          cervicalAtom("posterior_element_fracture", "Fracture of the spinous process / lamina at [level].", {
            anatomicalSection: "posterior elements",
            baselineReplaces: N.posteriorElements,
          }),
        ],
      },
      {
        id: "tr-c1-fracture",
        label: "C1 ring / lateral mass fracture",
        group: "Fracture",
        requires: ["odontoid"],
        requiresAdequate: ["lateralMassVisualization"],
        atoms: [
          CCJ("c1_fracture", "Fracture of the C1 ring / lateral mass.", {
            view: "odontoid",
            baselineReplaces: N.odontoid,
            severity: "moderate",
          }),
        ],
      },
      {
        id: "tr-lateral-mass-asymmetry",
        label: "C1 lateral-mass asymmetry",
        group: "Craniocervical",
        requires: ["odontoid"],
        atoms: [
          CCJ("c1_lateral_mass_asymmetry", "[Side] C1 lateral-mass asymmetry, with technical rotation considered.", {
            view: "odontoid",
            supportsLaterality: true,
            baselineReplaces: N.odontoid,
          }),
        ],
      },
      {
        id: "tr-subluxation",
        label: "Listhesis with malalignment",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          ALIGN("spondylolisthesis", "Anterolisthesis of [upper] over [lower] at [level] with malalignment.", {
            baselineReplaces: N.noFracture,
            impression: "Post-traumatic listhesis at [level].",
            severity: "severe",
          }),
        ],
      },
      {
        id: "tr-line-disruption",
        label: "Alignment line disruption",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_alignment_line_disruption", "Disruption of the [line] alignment line at [level].", {
            baselineReplaces: N.alignmentLines,
            severity: "moderate",
          }),
        ],
      },
      {
        id: "tr-inadequate-series",
        label: "Series inadequate to exclude injury",
        group: "Adequacy",
        atoms: [
          cervicalAtom("cervical_series_inadequate", "The radiographic series is technically inadequate to exclude cervical injury.", {
            anatomicalSection: "technique / views",
            impression: "Inadequate radiographic series — injury is not excluded.",
            recommendation:
              "Relevant anatomy is not adequately visualized; CT cervical spine is recommended when clinical suspicion persists.",
          }),
        ],
      },
      {
        id: "tr-precautions",
        label: "Spinal precautions (seeded wording)",
        group: "Advice",
        atoms: [
          cervicalAtom("cervical_spinal_precautions", "Spinal precautions are advised pending clinical and radiological clearance.", {
            anatomicalSection: "other",
            recommendation:
              "Spinal precautions should be maintained until clinically and radiologically cleared. A CT cervical spine is recommended for a suspected or inadequately-imaged fracture, and MRI for cord or ligamentous injury.",
          }),
        ],
      },
    ],
  },

  // ── 4. Alignment / listhesis (spec §6; library §3) ─────────────────────
  {
    id: "alignment",
    label: "Alignment",
    hint: "Lordosis, curvature, listhesis and the four lines. Straightening stays descriptive.",
    tiles: [
      {
        id: "al-lordosis-preserved",
        label: "Preserved lordosis",
        group: "Lordosis",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_lordosis", "Preserved cervical lordosis.", {
            role: "baseline",
            state: "preserved",
            baselineReplaces: N.alignment,
          }),
        ],
      },
      {
        id: "al-lordosis-straight",
        label: "Straightened lordosis",
        group: "Lordosis",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_lordosis", "Straightening of the normal cervical lordosis.", {
            state: "straightened",
            severity: "mild",
            baselineReplaces: N.alignment,
            impression: "Loss of the normal cervical lordosis.",
          }),
        ],
      },
      {
        id: "al-lordosis-reversed",
        label: "Reversed lordosis",
        group: "Lordosis",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_lordosis", "Reversal of the normal cervical lordosis.", {
            state: "reversed",
            severity: "moderate",
            baselineReplaces: N.alignment,
            impression: "Reversal of cervical lordosis.",
          }),
        ],
      },
      {
        id: "al-lordosis-nonspecific",
        label: "Straightening — nonspecific wording",
        group: "Lordosis",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_lordosis", "Straightening of the cervical lordosis, a nonspecific finding on radiography.", {
            state: "straightened",
            baselineReplaces: N.alignment,
            impression: "Loss of cervical lordosis, nonspecific.",
          }),
        ],
      },
      {
        id: "al-scoliosis",
        label: "Cervical scoliosis",
        group: "Curvature",
        requires: ["ap"],
        atoms: [
          cervicalAtom("cervical_scoliosis", "Cervical scoliosis with lateral curvature on the frontal projection.", {
            anatomicalSection: "alignment",
            view: "ap",
            severity: "mild",
          }),
        ],
      },
      {
        id: "al-anterolisthesis",
        label: "Anterolisthesis",
        group: "Listhesis",
        requires: ["lateral"],
        atoms: [
          ALIGN("spondylolisthesis", "Anterolisthesis of [upper] over [lower].", {
            baselineReplaces: N.noFracture,
            impression: "Anterolisthesis at [level].",
          }),
        ],
      },
      {
        id: "al-retrolisthesis",
        label: "Retrolisthesis",
        group: "Listhesis",
        requires: ["lateral"],
        atoms: [
          ALIGN("spondylolisthesis", "Retrolisthesis of [upper] over [lower].", {
            state: "retrolisthesis",
            baselineReplaces: N.noFracture,
            impression: "Retrolisthesis at [level].",
          }),
        ],
      },
      {
        id: "al-listhesis-graded",
        label: "Listhesis with Meyerding grade",
        group: "Listhesis",
        requires: ["lateral"],
        atoms: [
          ALIGN("spondylolisthesis", "Grade [grade] anterolisthesis of [upper] over [lower].", {
            baselineReplaces: N.noFracture,
            impression: "Grade [grade] anterolisthesis at [level].",
          }),
        ],
      },
      {
        id: "al-line-anterior",
        label: "Anterior vertebral line",
        group: "Lines",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_alignment_lines", "The anterior vertebral line is smooth and continuous.", {
            role: "baseline",
            view: "lateral",
          }),
        ],
      },
      {
        id: "al-line-posterior",
        label: "Posterior vertebral line",
        group: "Lines",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_alignment_lines", "The posterior vertebral line is smooth and continuous.", {
            role: "baseline",
            conflictGroup: "cervical_alignment_lines_posterior",
          }),
        ],
      },
      {
        id: "al-line-spinolaminar",
        label: "Spinolaminar line",
        group: "Lines",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_alignment_lines", "The spinolaminar line is smooth and continuous.", {
            role: "baseline",
            conflictGroup: "cervical_alignment_lines_spinolaminar",
          }),
        ],
      },
      {
        id: "al-line-posterior-spinous",
        label: "Posterior spinous line",
        group: "Lines",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_alignment_lines", "The posterior spinous line is smooth and continuous.", {
            role: "baseline",
            conflictGroup: "cervical_alignment_lines_posterior_spinous",
          }),
        ],
      },
      {
        id: "al-line-abnormal",
        label: "Abnormal alignment line",
        group: "Lines",
        requires: ["lateral"],
        atoms: [
          ALIGN("cervical_alignment_line_disruption", "Abnormality of the [line] alignment line at [level].", {
            conflictGroup: "cervical_alignment_line_disruption",
            baselineReplaces: N.alignmentLines,
          }),
        ],
      },
    ],
  },

  // ── 5. Dynamic flexion / extension (spec §10; library §11) ─────────────
  {
    id: "dynamic",
    label: "Dynamic",
    hint: "Only active when flexion AND extension were performed. No threshold calls instability.",
    tiles: [
      {
        id: "dy-translation",
        label: "Translation greater in flexion",
        group: "Translation",
        requires: ["flexion", "extension"],
        atoms: [
          cervicalAtom("cervical_dynamic_translation", "Anterior translation at [level] is greater in flexion than in extension.", {
            anatomicalSection: "alignment",
            state: "translation",
          }),
        ],
      },
      {
        id: "dy-angulation",
        label: "Increased angular change",
        group: "Angulation",
        requires: ["flexion", "extension"],
        atoms: [
          cervicalAtom("cervical_dynamic_angulation", "Increased segmental angulation at [level] on flexion compared with extension.", {
            anatomicalSection: "alignment",
          }),
        ],
      },
      {
        id: "dy-instability",
        label: "Dynamic instability (radiologist-selected)",
        group: "Interpretation",
        criticalPattern: true,
        requires: ["flexion", "extension"],
        atoms: [
          cervicalAtom("cervical_dynamic_instability", "Dynamic instability is demonstrated at [level] on the flexion-extension study.", {
            anatomicalSection: "alignment",
            severity: "severe",
            impression: "Dynamic instability at [level] on flexion/extension views; interpretation selected by the radiologist.",
            recommendation: "Clinical and surgical correlation; MRI for ligamentous injury if indicated.",
          }),
        ],
      },
      {
        id: "dy-stable",
        label: "No dynamic instability",
        group: "Interpretation",
        requires: ["flexion", "extension"],
        atoms: [
          cervicalAtom("cervical_dynamic_instability", "No dynamic instability is demonstrated on the flexion-extension study.", {
            anatomicalSection: "alignment",
            state: "stable",
          }),
        ],
      },
      {
        id: "dy-rom",
        label: "Range-of-motion limitation",
        group: "Technique",
        requires: ["flexion", "extension"],
        atoms: [
          cervicalAtom("cervical_range_of_motion_limitation", "Range of motion is limited, reducing the dynamic assessment.", {
            anatomicalSection: "technique / views",
          }),
        ],
      },
      {
        id: "dy-not-performed",
        label: "Dynamic views not performed",
        group: "Technique",
        atoms: [
          cervicalAtom("cervical_dynamic_not_assessed", "Flexion and extension views were not performed, so dynamic stability is not assessed.", {
            anatomicalSection: "technique / views",
          }),
        ],
      },
    ],
  },

  // ── 6. Congenital / developmental (spec §11; library §12) ──────────────
  {
    id: "congenital",
    label: "Congenital",
    hint: "Descriptive segmentation findings; syndromic labels stay with the radiologist.",
    tiles: [
      {
        id: "cg-block-vertebra",
        label: "Block vertebra (fusion)",
        group: "Segmentation",
        atoms: [
          VERTEBRA("block_vertebra", "Failure of segmentation (block vertebra) at [level] with anterior and posterior fusion."),
        ],
      },
      {
        id: "cg-cervical-rib",
        label: "Cervical rib",
        group: "Segmentation",
        atoms: [
          cervicalAtom("cervical_rib", "Cervical rib arising from [level].", {
            anatomicalSection: "other",
            level: "C7",
          }),
        ],
      },
      {
        id: "cg-transitional",
        label: "Transitional anatomy",
        group: "Segmentation",
        atoms: [
          VERTEBRA("transitional_vertebra", "Transitional vertebra at [level] with hybrid cervical / thoracic segmentation."),
        ],
      },
      {
        id: "cg-assimilation",
        label: "Occipital assimilation of C1",
        group: "Craniocervical",
        requires: ["lateral"],
        atoms: [
          CCJ("occipital_assimilation", "Partial occipital assimilation of the C1 anterior arch.", {
            view: "lateral",
            baselineReplaces: N.odontoid,
          }),
        ],
      },
      {
        id: "cg-spina-bifida",
        label: "Posterior element defect (spina bifida occulta)",
        group: "Posterior elements",
        atoms: [
          cervicalAtom("cervical_spina_bifida", "Posterior element defect at [level] consistent with spina bifida occulta.", {
            anatomicalSection: "posterior elements",
            baselineReplaces: N.posteriorElements,
          }),
        ],
      },
      {
        id: "cg-segmentation-other",
        label: "Other segmentation anomaly",
        group: "Segmentation",
        atoms: [VERTEBRA("segmentation_anomaly", "Other segmentation anomaly at [level].")],
      },
    ],
  },

  // ── 7. Infection / destructive pattern (spec §11; library §13) ─────────
  {
    id: "infection",
    label: "Infection",
    hint: "Radiography raises suspicion; etiology and activity need correlation.",
    tiles: [
      {
        id: "in-disc-endplate",
        label: "Disc narrowing with endplate destruction",
        group: "Disc / endplate",
        atoms: [
          DISC("Disc-space narrowing with adjacent endplate irregularity and destruction at [level].", {
            concept: "disc_endplate_destruction",
            conflictGroup: "disc_endplate_destruction",
            impression: "Destructive change involving the [level] disc and adjacent endplates — infection requires clinical and cross-sectional correlation.",
            recommendation: "MRI and clinical / laboratory correlation for infective spondylodiscitis.",
            severity: "severe",
          }),
        ],
      },
      {
        id: "in-vertebral-destruction",
        label: "Vertebral body destruction / collapse",
        group: "Vertebra",
        atoms: [
          VERTEBRA("vertebral_body_destruction", "Vertebral body destruction with loss of height at [level].", {
            baselineReplaces: N.vertebrae,
            impression: "Vertebral body destruction at [level] — infection, tumour and other causes require correlation.",
            recommendation: "MRI and clinical correlation; CT for osseous detail.",
            severity: "severe",
          }),
        ],
      },
      {
        id: "in-prevertebral",
        label: "Prevertebral soft-tissue swelling",
        group: "Soft tissues",
        requires: ["lateral"],
        atoms: [
          SOFT("prevertebral_swelling", "Prevertebral soft-tissue swelling at [level].", {
            view: "lateral",
            baselineReplaces: N.prevertebral,
            recommendation: "Clinical correlation and MRI if a prevertebral collection is suspected.",
          }),
        ],
      },
      {
        id: "in-focal",
        label: "Other focal destructive change",
        group: "Vertebra",
        atoms: [
          VERTEBRA("focal_destructive_lesion", "Focal destructive osseous change at [level].", {
            conflictGroup: "focal_destructive_lesion",
            impression: "Focal destructive lesion at [level] — cause not established on radiography.",
            recommendation: "MRI or CT correlation according to the clinical question.",
          }),
        ],
      },
      {
        id: "in-endplate-only",
        label: "Endplate irregularity without disc loss",
        group: "Disc / endplate",
        atoms: [
          VERTEBRA("cervical_endplate_sclerosis", "Endplate irregularity at [level] with preserved disc height.", {
            anatomicalSection: "vertebral bodies",
          }),
        ],
      },
    ],
  },

  // ── 8. Tumor / osseous lesion (spec §11; library §14) ──────────────────
  {
    id: "tumor",
    label: "Tumour",
    hint: "Lesion pattern only. Radiography never names a cause.",
    tiles: [
      {
        id: "tu-lytic",
        label: "Focal lytic lesion",
        group: "Lesion",
        atoms: [
          VERTEBRA("focal_lytic_lesion", "Focal lytic lesion of [level].", {
            impression: "Focal lytic osseous lesion at [level] — cause not established on radiography.",
            recommendation: "Clinical correlation; MRI or CT and targeted investigation as indicated.",
          }),
        ],
      },
      {
        id: "tu-sclerotic",
        label: "Focal sclerotic lesion",
        group: "Lesion",
        atoms: [
          VERTEBRA("focal_sclerotic_lesion", "Focal sclerotic lesion of [level].", {
            impression: "Focal sclerotic osseous lesion at [level].",
            recommendation: "Correlate clinically; consider CT or MRI for characterization.",
          }),
        ],
      },
      {
        id: "tu-mixed",
        label: "Mixed lytic / sclerotic lesion",
        group: "Lesion",
        atoms: [
          VERTEBRA("focal_mixed_lesion", "Mixed lytic and sclerotic lesion of [level].", {
            impression: "Mixed lytic-sclerotic lesion at [level] — correlation advised.",
            recommendation: "Clinical correlation with MRI or CT; targeted investigation as indicated.",
          }),
        ],
      },
      {
        id: "tu-collapse",
        label: "Vertebral collapse with height loss",
        group: "Vertebra",
        atoms: [
          VERTEBRA("vertebral_collapse", "Vertebral body collapse at [level] with loss of height.", {
            baselineReplaces: N.vertebrae,
            impression: "Vertebral body collapse at [level].",
            recommendation: "Correlate for cause; MRI for marrow oedema and acuity when available.",
          }),
        ],
      },
      {
        id: "tu-multiple",
        label: "Multiple osseous lesions",
        group: "Lesion",
        atoms: [
          VERTEBRA("multiple_osseous_lesions", "Multiple focal osseous lesions at the levels seen.", {
            impression: "Multiple focal osseous lesions — aetiology requires clinical correlation.",
            recommendation: "Correlate clinically and biochemically; CT or MRI for characterization.",
          }),
        ],
      },
      {
        id: "tu-pathologic-reminder",
        label: "Indeterminate lesion — descriptive wording",
        group: "Reminder",
        advanced: true,
        atoms: [
          VERTEBRA("focal_destructive_lesion", "Indeterminate osseous abnormality at [level], not characterized on radiography.", {
            conflictGroup: "focal_destructive_lesion",
            impression: "Indeterminate osseous lesion at [level]; radiography cannot establish the cause.",
            recommendation: "Further imaging according to the clinical question.",
          }),
        ],
      },
    ],
  },

  // ── 9. Post-operative (spec §12; library §15) ──────────────────────────
  {
    id: "postoperative",
    label: "Post-op",
    hint: "Continuity, position, convincing lucency and adjacent segments — without overstating loosening.",
    tiles: [
      {
        id: "po-acdf",
        label: "ACDF with plate and screws",
        group: "Construct",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Anterior cervical discectomy and fusion at [level] with plate and screws in position.", {
            view: "lateral",
            impression: "Post-operative anterior cervical fusion at [level].",
          }),
        ],
      },
      {
        id: "po-posterior-fixation",
        label: "Posterior fixation",
        group: "Construct",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Posterior cervical fixation at [level] with lateral mass screws and rods.", {
            view: "lateral",
            impression: "Posterior cervical instrumentation at [level].",
          }),
        ],
      },
      {
        id: "po-cage",
        label: "Interbody cage / spacer",
        group: "Construct",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Interbody cage / spacer at [level] in position.", { view: "lateral" }),
        ],
      },
      {
        id: "po-continuity-intact",
        label: "Hardware continuous, in position",
        group: "Continuity",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Hardware is continuous and in position without perihardware lucency.", {
            view: "lateral",
            conflictGroup: "cervical_hardware_continuity",
            state: "intact",
          }),
        ],
      },
      {
        id: "po-breakage",
        label: "Hardware breakage",
        group: "Continuity",
        criticalPattern: true,
        requires: ["lateral"],
        atoms: [
          HARDWARE("Hardware breakage is demonstrated at [level].", {
            view: "lateral",
            conflictGroup: "cervical_hardware_continuity",
            state: "fractured",
            severity: "severe",
            impression: "Cervical hardware breakage at [level].",
            recommendation: "Clinical correlation; CT for hardware integrity and fusion status.",
          }),
        ],
      },
      {
        id: "po-migration",
        label: "Hardware migration",
        group: "Position",
        criticalPattern: true,
        requires: ["lateral"],
        atoms: [
          HARDWARE("Hardware migration is demonstrated at [level].", {
            view: "lateral",
            conflictGroup: "cervical_hardware_position",
            state: "migrated",
            severity: "severe",
            impression: "Cervical hardware migration at [level].",
            recommendation: "Compare with prior studies; CT and surgical correlation advised.",
          }),
        ],
      },
      {
        id: "po-suspected-failure",
        label: "Suspected hardware failure",
        group: "Continuity",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Interrupted hardware is suspected at [level], to be confirmed on dedicated views or CT.", {
            view: "lateral",
            conflictGroup: "cervical_hardware_continuity",
            state: "suspected",
          }),
        ],
      },
      {
        id: "po-lucency-equivocal",
        label: "Equivocal perihardware lucency",
        group: "Lucency",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Equivocal perihardware lucency, which alone does not indicate loosening.", {
            view: "lateral",
            conflictGroup: "cervical_hardware_lucency",
            state: "equivocal",
          }),
        ],
      },
      {
        id: "po-lucency-convincing",
        label: "Convincing perihardware lucency",
        group: "Lucency",
        criticalPattern: true,
        requires: ["lateral"],
        atoms: [
          HARDWARE("Convincing perihardware lucency at [level], concerning for loosening.", {
            view: "lateral",
            conflictGroup: "cervical_hardware_lucency",
            state: "convincing",
            severity: "moderate",
            impression: "Perihardware lucency concerning for loosening at [level].",
            recommendation: "Clinical and surgical correlation; CT for fusion status.",
          }),
        ],
      },
      {
        id: "po-alignment-maintained",
        label: "Alignment maintained across construct",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Alignment is maintained across the instrumented segment.", {
            view: "lateral",
            conflictGroup: "cervical_hardware_alignment",
          }),
        ],
      },
      {
        id: "po-fused",
        label: "Fusion established",
        group: "Fusion",
        requires: ["lateral"],
        atoms: [
          HARDWARE("Bridging fusion is evident at the operated levels.", {
            view: "lateral",
            conflictGroup: "cervical_hardware_fusion",
            state: "fused",
          }),
        ],
      },
      {
        id: "po-not-fused",
        label: "No bridging fusion",
        group: "Fusion",
        requires: ["lateral"],
        atoms: [
          HARDWARE("No bridging fusion is evident at the operated levels.", {
            view: "lateral",
            conflictGroup: "cervical_hardware_fusion",
            state: "not_fused",
            impression: "No radiographic evidence of fusion at the operated levels.",
            recommendation: "CT for fusion assessment.",
          }),
        ],
      },
      {
        id: "po-adjacent-segment",
        label: "Adjacent-segment degeneration",
        group: "Adjacent segments",
        atoms: [
          cervicalAtom("adjacent_segment_degeneration", "Degenerative change at the levels adjacent to the construct with disc-space height loss and marginal osteophytes.", {
            anatomicalSection: "disc spaces",
            baselineReplaces: N.discsAll,
          }),
        ],
      },
    ],
  },

  // ── 10. More / advanced (spec §3) ──────────────────────────────────────
  {
    id: "advanced",
    label: "More / advanced",
    hint: "Less common cervical patterns and the statements that need a specific view.",
    tiles: [
      {
        id: "ad-c7t1-preserved",
        label: "C7-T1 disc preserved (film reaches T1)",
        group: "Cervicothoracic junction",
        requiresC7T1: true,
        atoms: [DISC("Disc height preserved at C7-T1.", { level: "C7-T1" })],
      },
      {
        id: "ad-swimmers",
        label: "Swimmer's view for the junction",
        group: "Cervicothoracic junction",
        requires: ["swimmers"],
        atoms: [
          cervicalAtom("cervical_swimmers_view", "Swimmer's projection used to demonstrate the cervicothoracic junction.", {
            anatomicalSection: "technique / views",
            view: "swimmers",
          }),
        ],
      },
      {
        id: "ad-ccj-aligned",
        label: "Craniocervical junction aligned",
        group: "Craniocervical",
        requires: ["lateral"],
        requiresAdequate: ["odontoidVisualization"],
        atoms: [
          CCJ("craniocervical_junction_alignment", "The craniocervical junction is aligned with a normal basion-dental relationship.", {
            view: "lateral",
            baselineReplaces: N.odontoid,
          }),
        ],
      },
      {
        id: "ad-odontoid-not-seen",
        label: "Odontoid not adequately seen",
        group: "Craniocervical",
        atoms: [
          CCJ("odontoid_not_assessed", "The odontoid is not adequately visualized, so the C1-C2 complex is not assessed.", {
            anatomicalSection: "technique / views",
            impression: "Odontoid not adequately visualized; C1-C2 injury is not excluded.",
            recommendation: "Open-mouth odontoid view or CT cervical spine.",
          }),
        ],
      },
      {
        id: "ad-c7t1-not-seen",
        label: "C7-T1 not adequately seen",
        group: "Cervicothoracic junction",
        atoms: [
          cervicalAtom("cervical_c7t1_not_assessed", "C7-T1 is not adequately visualized on the lateral projection.", {
            anatomicalSection: "technique / views",
            level: "C7-T1",
            impression: "C7-T1 not adequately visualized.",
            recommendation: "Swimmer's projection or CT cervical spine when the junction is clinically relevant.",
          }),
        ],
      },
      {
        id: "ad-opll",
        label: "Ossification of the posterior longitudinal ligament",
        group: "Canal / ligament",
        advanced: true,
        requires: ["lateral"],
        atoms: [
          VERTEBRA("ossification_posterior_longitudinal", "Ossification along the posterior aspect of the vertebral bodies at [level].", {
            view: "lateral",
            impression: "Ossification of the posterior longitudinal ligament at [level].",
            recommendation: "MRI for cord assessment when clinically indicated.",
          }),
        ],
      },
      {
        id: "ad-flowing-osteophytes",
        label: "Flowing anterior osteophytes (descriptive)",
        group: "Vertebrae",
        advanced: true,
        requires: ["lateral"],
        atoms: [
          VERTEBRA("osteophytes", "Flowing anterior osteophytes across contiguous levels with relatively preserved disc heights.", {
            view: "lateral",
            baselineReplaces: N.vertebrae,
            impression: "Flowing anterior osteophytes across contiguous cervical levels.",
          }),
        ],
      },
      {
        id: "ad-prevertebral-calcification",
        label: "Prevertebral calcification",
        group: "Soft tissues",
        requires: ["lateral"],
        atoms: [
          SOFT("prevertebral_calcification", "Prevertebral soft-tissue calcification.", { view: "lateral" }),
        ],
      },
      {
        id: "ad-prevertebral-gas",
        label: "Prevertebral gas",
        group: "Soft tissues",
        requires: ["lateral"],
        criticalPattern: true,
        atoms: [
          SOFT("prevertebral_gas", "Gas within the prevertebral soft tissues.", {
            view: "lateral",
            impression: "Prevertebral gas — correlate clinically and for recent instrumentation or infection.",
          }),
        ],
      },
      {
        id: "ad-lordotic-apical",
        label: "Apical (lordotic) projection note",
        group: "Technique",
        atoms: [
          cervicalAtom("cervical_projection_note", "Lordotic frontal projection used to demonstrate the cervical apex.", {
            anatomicalSection: "technique / views",
            view: "ap",
          }),
        ],
      },
      {
        id: "ad-rotation-limited",
        label: "Rotation limits the film",
        group: "Technique",
        atoms: [
          cervicalAtom("cervical_rotation_limitation", "Patient rotation limits assessment of alignment, the lateral masses and the oblique views.", {
            anatomicalSection: "technique / views",
            impression: "Rotation limits the assessment on this study.",
          }),
        ],
      },
    ],
  },
];

/* ─────────────────────────── availability ─────────────────────────────── */

export type CervicalAvailability = { ok: boolean; missing: string[]; reason?: string };

type CervicalGateRequirements = Pick<
  CervicalTile,
  "requires" | "requiresAny" | "requiresAdequate" | "requiresC7T1" | "foraminalGate"
>;

/**
 * The one gate implementation shared by tiles and presets (spec §2, §6, §7,
 * §10). Missing capability is reported in the words the canvas shows, so the
 * radiologist sees which view to obtain rather than a silently unavailable
 * tile.
 */
function cervicalGate(
  req: CervicalGateRequirements,
  ctx: XrayCervicalTechniqueContext,
  template: CervicalTemplateContext,
): CervicalAvailability {
  const missing: string[] = [];

  for (const key of req.requires ?? []) {
    if (!ctx.performed[key]) missing.push(XRAY_CERVICAL_VIEW_LABELS[key]);
  }

  if (req.requiresAny?.length) {
    const anyPerformed = req.requiresAny.some((k) => ctx.performed[k]);
    if (!anyPerformed) {
      missing.push(
        `one of ${req.requiresAny.map((k) => XRAY_CERVICAL_VIEW_LABELS[k]).join(" / ")}`,
      );
    }
  }

  for (const key of req.requiresAdequate ?? []) {
    // Strict reading of the mandate: the dimension must be RECORDED AS ADEQUATE.
    // "unknown" is not good enough for a tile that certifies an area the film may
    // not have shown, which is how a missed odontoid fracture stays missed.
    if (ctx.adequacy[key] !== "adequate") {
      missing.push(`${XRAY_CERVICAL_ADEQUACY_LABELS[key]} (not recorded as adequate)`);
    }
  }

  if (req.requiresC7T1 && !c7t1Visualized(ctx)) {
    missing.push(
      `C7-T1 visualization (recorded inferior limit: ${
        ctx.visualizedInferiorLevel === "unknown" ? "not recorded" : ctx.visualizedInferiorLevel
      })`,
    );
  }

  if (req.foraminalGate) {
    const side = template.laterality ?? "bilateral";
    const gate = assessForaminal(ctx, side);
    if (!gate.allowed) {
      return { ok: false, missing: [shortForaminalReason(ctx, side)], reason: gate.reason };
    }
  }

  if (req.requires?.includes("flexion") && req.requires.includes("extension")) {
    const missingViews = missingCervicalViewLabels(ctx, ["flexion", "extension"]);
    if (missingViews.length === 2) {
      return {
        ok: false,
        missing: ["flexion and extension views"],
        reason:
          "Dynamic translation requires both positions; neither flexion nor extension is recorded, and a neutral film cannot demonstrate instability.",
      };
    }
  }

  return { ok: missing.length === 0, missing };
}

export function cervicalTileAvailability(
  tile: CervicalTile,
  ctx: XrayCervicalTechniqueContext,
  template: CervicalTemplateContext = {},
): CervicalAvailability {
  return cervicalGate(tile, ctx, template);
}

export function cervicalPresetAvailability(
  preset: CervicalPreset,
  ctx: XrayCervicalTechniqueContext,
  template: CervicalTemplateContext = {},
): CervicalAvailability {
  return cervicalGate(preset, ctx, template);
}

function shortForaminalReason(
  ctx: XrayCervicalTechniqueContext,
  side: "right" | "left" | "bilateral",
): string {
  if (side === "bilateral") {
    const absent = (["obliqueRight", "obliqueLeft"] as XrayCervicalViewKey[]).filter(
      (k) => !ctx.performed[k],
    );
    return absent.length
      ? `${absent.map((k) => XRAY_CERVICAL_VIEW_LABELS[k]).join(" and ")} not recorded`
      : "oblique views limited by rotation";
  }
  const key: XrayCervicalViewKey = side === "right" ? "obliqueRight" : "obliqueLeft";
  return ctx.performed[key]
    ? `${XRAY_CERVICAL_VIEW_LABELS[key]} limited by rotation`
    : `${XRAY_CERVICAL_VIEW_LABELS[key]} not recorded`;
}

export function cervicalSubMasterById(id: string): CervicalSubMaster | undefined {
  return XRAY_CERVICAL_SUB_MASTERS.find((sm) => sm.id === id);
}

export function buildCervicalTilePatch(
  tile: CervicalTile,
  region = "Cervical Spine",
  template: CervicalTemplateContext = {},
): { bundleId: string; observations: ReturnType<typeof cervicalAtomsToPatches> } {
  const bundleId = cervicalBundleId("tile", tile.id);
  return { bundleId, observations: cervicalAtomsToPatches(region, bundleId, tile.atoms, template) };
}

/* ─────────────────────────── presets ──────────────────────────────────── */

export type CervicalPresetContext = {
  region?: string;
  ctx: XrayCervicalTechniqueContext;
  laterality?: "right" | "left" | "bilateral" | null;
  level?: string | null;
  upperLevel?: string | null;
  lowerLevel?: string | null;
  mm?: string | null;
  percent?: string | null;
  degrees?: string | null;
};

export type CervicalPreset = {
  id: string;
  label: string;
  subMasterId: CervicalSubMasterId;
  requires?: XrayCervicalViewKey[];
  requiresAdequate?: XrayCervicalAdequacyKey[];
  requiresC7T1?: boolean;
  foraminalGate?: boolean;
  criticalPattern?: boolean;
  build: (ctx: CervicalPresetContext) => {
    bundleId: string;
    observations: ReturnType<typeof cervicalAtomsToPatches>;
  };
};

const presetTemplate = (ctx: CervicalPresetContext): CervicalTemplateContext => ({
  laterality: ctx.laterality ?? null,
  level: ctx.level ?? null,
  upperLevel: ctx.upperLevel ?? null,
  lowerLevel: ctx.lowerLevel ?? null,
  mm: ctx.mm ?? null,
  percent: ctx.percent ?? null,
  degrees: ctx.degrees ?? null,
});

const tilesFrom = (
  ...refs: Array<[CervicalSubMasterId, string]>
): CervicalAtomSpec[] => {
  const atoms: CervicalAtomSpec[] = [];
  for (const [sm, tileId] of refs) {
    const tile = cervicalSubMasterById(sm)?.tiles.find((t) => t.id === tileId);
    if (tile) atoms.push(...tile.atoms);
  }
  return atoms;
};

function presetFromTiles(presetId: string, refs: Array<[CervicalSubMasterId, string]>) {
  return (ctx: CervicalPresetContext) => {
    const bundleId = cervicalBundleId("preset", presetId);
    return {
      bundleId,
      observations: cervicalAtomsToPatches(
        ctx.region ?? "Cervical Spine",
        bundleId,
        tilesFrom(...refs),
        presetTemplate(ctx),
      ),
    };
  };
}

/**
 * Authored critical-first inside each palette: the unstable-injury presets are
 * listed before the descriptive ones, matching how the chest catalog was ordered
 * and how the impression is composed (spec §14).
 */
export const XRAY_CERVICAL_PRESETS: readonly CervicalPreset[] = [
  // One-click normal baseline (spec §5). Coverage-aware: it never certifies an
  // odontoid or C7-T1 the recorded views cannot see.
  {
    id: "normal-cervical",
    label: "Normal cervical spine",
    subMasterId: "routine",
    requires: ["lateral"],
    build: (ctx) =>
      buildCervicalNormalAtoms({
        region: ctx.region ?? "Cervical Spine",
        ctx: ctx.ctx,
        bundleId: cervicalBundleId("preset", "normal-cervical"),
      }),
  },
  {
    id: "normal-cervical-full-series",
    label: "Normal cervical spine (odontoid + adequate C7-T1)",
    subMasterId: "routine",
    requires: ["lateral", "odontoid"],
    requiresAdequate: ["odontoidVisualization"],
    requiresC7T1: true,
    build: (ctx) =>
      buildCervicalNormalAtoms({
        region: ctx.region ?? "Cervical Spine",
        ctx: ctx.ctx,
        bundleId: cervicalBundleId("preset", "normal-cervical-full-series"),
      }),
  },

  // ── Trauma, critical first ────────────────────────────────────────────
  {
    id: "unstable-fracture-dislocation",
    label: "Unstable fracture-dislocation",
    subMasterId: "trauma",
    requires: ["lateral"],
    criticalPattern: true,
    build: presetFromTiles("unstable-fracture-dislocation", [
      ["trauma", "tr-fracture-dislocation"],
      ["trauma", "tr-line-disruption"],
      ["trauma", "tr-precautions"],
    ]),
  },
  {
    id: "odontoid-fracture",
    label: "Odontoid fracture",
    subMasterId: "trauma",
    requires: ["odontoid"],
    requiresAdequate: ["odontoidVisualization"],
    criticalPattern: true,
    build: presetFromTiles("odontoid-fracture", [
      ["trauma", "tr-odontoid-fracture"],
      ["trauma", "tr-precautions"],
    ]),
  },
  {
    id: "atlanto-axial-widening",
    label: "Widened atlanto-dental interval",
    subMasterId: "trauma",
    requires: ["lateral"],
    criticalPattern: true,
    build: presetFromTiles("atlanto-axial-widening", [
      ["trauma", "tr-adi-widening"],
      ["trauma", "tr-precautions"],
    ]),
  },
  {
    id: "prevertebral-swelling-occult",
    label: "Prevertebral swelling — occult injury",
    subMasterId: "trauma",
    requires: ["lateral"],
    criticalPattern: true,
    build: presetFromTiles("prevertebral-swelling-occult", [
      ["trauma", "tr-prevertebral-swelling"],
      ["trauma", "tr-inadequate-series"],
    ]),
  },
  {
    id: "trauma-fracture-ct",
    label: "Fracture with CT recommendation",
    subMasterId: "trauma",
    requires: ["lateral"],
    criticalPattern: true,
    build: presetFromTiles("trauma-fracture-ct", [
      ["trauma", "tr-compression-fracture"],
      ["trauma", "tr-precautions"],
    ]),
  },
  {
    id: "inadequate-series-trauma",
    label: "Inadequate series — injury not excluded",
    subMasterId: "trauma",
    build: presetFromTiles("inadequate-series-trauma", [["trauma", "tr-inadequate-series"]]),
  },

  // ── Alignment / listhesis ─────────────────────────────────────────────
  {
    id: "traumatic-listhesis",
    label: "Post-traumatic listhesis",
    subMasterId: "alignment",
    requires: ["lateral"],
    criticalPattern: true,
    build: presetFromTiles("traumatic-listhesis", [
      ["alignment", "al-anterolisthesis"],
      ["alignment", "al-line-posterior"],
      ["trauma", "tr-precautions"],
    ]),
  },
  {
    id: "straightened-lordosis",
    label: "Straightened lordosis (nonspecific)",
    subMasterId: "alignment",
    requires: ["lateral"],
    build: presetFromTiles("straightened-lordosis", [["alignment", "al-lordosis-nonspecific"]]),
  },
  {
    id: "degenerative-listhesis",
    label: "Degenerative listhesis",
    subMasterId: "degenerative",
    requires: ["lateral"],
    build: presetFromTiles("degenerative-listhesis", [
      ["degenerative", "dg-degenerative-listhesis"],
      ["degenerative", "dg-disc-moderate"],
      ["degenerative", "dg-facet"],
    ]),
  },

  // ── Degenerative ──────────────────────────────────────────────────────
  {
    id: "multilevel-spondylosis",
    label: "Multilevel cervical spondylosis",
    subMasterId: "degenerative",
    build: presetFromTiles("multilevel-spondylosis", [
      ["degenerative", "dg-multilevel"],
      ["degenerative", "dg-osteophytes"],
      ["degenerative", "dg-uncovertebral"],
      ["degenerative", "dg-facet"],
    ]),
  },
  {
    id: "spondylotic-foraminal-narrowing",
    label: "Spondylosis with foraminal narrowing",
    subMasterId: "degenerative",
    foraminalGate: true,
    build: presetFromTiles("spondylotic-foraminal-narrowing", [
      ["degenerative", "dg-multilevel"],
      ["degenerative", "dg-foraminal-moderate"],
    ]),
  },

  // ── Dynamic ───────────────────────────────────────────────────────────
  {
    id: "dynamic-instability",
    label: "Dynamic instability (flexion/extension)",
    subMasterId: "dynamic",
    requires: ["flexion", "extension"],
    criticalPattern: true,
    build: presetFromTiles("dynamic-instability", [
      ["dynamic", "dy-instability"],
      ["dynamic", "dy-translation"],
    ]),
  },
  {
    id: "dynamic-stable",
    label: "Dynamic study without instability",
    subMasterId: "dynamic",
    requires: ["flexion", "extension"],
    build: presetFromTiles("dynamic-stable", [["dynamic", "dy-stable"]]),
  },

  // ── Congenital / infection / tumour ───────────────────────────────────
  {
    id: "block-vertebra",
    label: "Block vertebra",
    subMasterId: "congenital",
    build: presetFromTiles("block-vertebra", [["congenital", "cg-block-vertebra"]]),
  },
  {
    id: "destructive-disc-endplate",
    label: "Destructive disc / endplate pattern",
    subMasterId: "infection",
    build: presetFromTiles("destructive-disc-endplate", [
      ["infection", "in-disc-endplate"],
      ["infection", "in-prevertebral"],
    ]),
  },
  {
    id: "focal-lytic-lesion",
    label: "Focal lytic lesion",
    subMasterId: "tumor",
    build: presetFromTiles("focal-lytic-lesion", [["tumor", "tu-lytic"]]),
  },
  {
    id: "vertebral-collapse-indeterminate",
    label: "Vertebral collapse — cause not established",
    subMasterId: "tumor",
    build: presetFromTiles("vertebral-collapse-indeterminate", [
      ["tumor", "tu-collapse"],
      ["tumor", "tu-pathologic-reminder"],
    ]),
  },

  // ── Post-operative ────────────────────────────────────────────────────
  {
    id: "postop-acdf-intact",
    label: "Post-op ACDF, hardware intact",
    subMasterId: "postoperative",
    requires: ["lateral"],
    build: presetFromTiles("postop-acdf-intact", [
      ["postoperative", "po-acdf"],
      ["postoperative", "po-continuity-intact"],
      ["postoperative", "po-alignment-maintained"],
    ]),
  },
  {
    id: "postop-hardware-failure",
    label: "Post-op hardware failure",
    subMasterId: "postoperative",
    requires: ["lateral"],
    criticalPattern: true,
    build: presetFromTiles("postop-hardware-failure", [
      ["postoperative", "po-breakage"],
      ["postoperative", "po-lucency-convincing"],
    ]),
  },
  {
    id: "postop-adjacent-segment",
    label: "Post-op adjacent-segment degeneration",
    subMasterId: "postoperative",
    build: presetFromTiles("postop-adjacent-segment", [
      ["postoperative", "po-acdf"],
      ["postoperative", "po-adjacent-segment"],
    ]),
  },

  // ── Adequacy ──────────────────────────────────────────────────────────
  {
    id: "junction-not-seen",
    label: "Cervicothoracic junction not visualized",
    subMasterId: "advanced",
    build: presetFromTiles("junction-not-seen", [
      ["advanced", "ad-c7t1-not-seen"],
      ["advanced", "ad-swimmers"],
    ]),
  },
];

export function cervicalPresetById(id: string): CervicalPreset | undefined {
  return XRAY_CERVICAL_PRESETS.find((p) => p.id === id);
}

export function cervicalCriticalTileIds(): string[] {
  const out: string[] = [];
  for (const sm of XRAY_CERVICAL_SUB_MASTERS) {
    for (const tile of sm.tiles) if (tile.criticalPattern) out.push(`${sm.id}/${tile.id}`);
  }
  return out;
}

export function cervicalPresetIsCritical(preset: CervicalPreset): boolean {
  return Boolean(preset.criticalPattern);
}

/**
 * Position of a section in the §14 composition order. Unknown sections sort
 * last, which validation uses to flag a tile that has drifted out of report
 * order rather than reordering the radiologist's own text.
 */
export function cervicalSectionOrder(section: string | null | undefined): number {
  const index = (CERVICAL_FINDINGS_SECTIONS as readonly string[]).indexOf(section ?? "other");
  return index === -1 ? CERVICAL_FINDINGS_SECTIONS.length : index;
}

export function isCervicalSectionName(section: string | null | undefined): boolean {
  return (CERVICAL_FINDINGS_SECTIONS as readonly string[]).includes(section ?? "");
}
