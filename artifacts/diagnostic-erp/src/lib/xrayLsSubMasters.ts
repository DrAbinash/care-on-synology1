/**
 * xrayLsSubMasters.ts — the X-ray Lumbosacral Spine clinical sub-master catalog
 * (spec §3–§15; canonical prose from
 * docs/clinical-libraries/xray-ls-spine-clinical-content-library.md).
 *
 * Like xrayChestSubMasters.ts and xrayCervicalSubMasters.ts this file is
 * CONTENT: it compiles tiles into ledger atoms and touches no state. The store
 * remains the only reconciler, so slot identity, provenance, baseline
 * supersession, manual protection and undo behave exactly as elsewhere in CARE.
 *
 * Rules encoded here:
 *  - view / adequacy / coverage gating (spec §2): a pars tile needs a lateral or
 *    oblique film with the posterior elements recorded as adequate, a unilateral
 *    defect additionally needs an oblique, dynamic tiles need flexion AND
 *    extension, L5-S1 tiles need demonstrated lumbosacral coverage, T12-L1 tiles
 *    need the upper junction in the field of view, and SI tiles need an AP. A
 *    gated tile is never silently applied — the canvas disables it and names what
 *    is missing;
 *  - numbering gating (spec §4): every level-bearing tile additionally requires
 *    an established numbering basis. An L5-S1 statement on a film that has not
 *    said how L5 was chosen is the single commonest lumbar report error, so the
 *    tile is unavailable until the basis is set rather than being written with an
 *    assumed level;
 *  - abnormal atoms carry the exact normal sentence they supersede via
 *    `baselineReplaces`, always taken from LS_BASELINE_CONTRACTS, so "disc spaces
 *    preserved" reconciles with "L4-L5 disc-space narrowing" instead of
 *    contradicting it (spec §6);
 *  - radiography stays radiography: no canal stenosis grade, no cauda or root
 *    compression, no disc desiccation or signal change, no Pfirrmann, no Modic,
 *    no marrow oedema. Those are MRI conclusions and are not importable here
 *    (spec §1); the seeded LS recommendation hands those questions to MRI;
 *  - descriptive, not diagnostic: straightening is never called muscle spasm, a
 *    destructive disc/endplate pattern is never called infection, a lytic lesion
 *    is never called metastasis, transitional anatomy is never called Bertolotti
 *    syndrome, nonspecific SI sclerosis is never called axial
 *    spondyloarthritis, equivocal lucency is never called loosening, and
 *    instability is only written when the radiologist selects it (spec §7, §9,
 *    §12, §13, §14, §15);
 *  - thresholds and arithmetic live in xrayLsMeasures.ts and
 *    xrayLsDynamic.ts, never here (spec §16).
 */
import {
  lsAtom,
  lsAtomsToPatches,
  lsBundleId,
  type LsAtomSpec,
  type LsTemplateContext,
} from "./xrayLsAtoms";
import {
  LS_BASELINE_CONTRACTS,
  LS_NORMAL_SENTENCES,
  buildLsNormalAtoms,
} from "./xrayLsNormalAtoms";
import {
  assessDynamic,
  assessForaminal,
  assessL5S1,
  assessPars,
  assessSiJoints,
  assessT12L1,
  missingLsViewLabels,
  LS_JUNCTION_SENTENCES,
  LS_SI_SENTENCES,
  XRAY_LS_ADEQUACY_LABELS,
  XRAY_LS_VIEW_LABELS,
  type XrayLsAdequacyKey,
  type XrayLsTechniqueContext,
  type XrayLsViewKey,
} from "./xrayLsViews";
import {
  UNSET_LS_NUMBERING,
  lsNumberingIsEstablished,
  type LsNumbering,
} from "./xrayLsNumbering";

const N = LS_BASELINE_CONTRACTS;

/** The §17 composition order, stated once so palettes and tiles follow it. */
export const LS_FINDINGS_SECTIONS = [
  "technique / views",
  "numbering",
  "alignment",
  "vertebral bodies",
  "disc spaces",
  "posterior elements",
  "facets",
  "pars interarticularis",
  "sacroiliac joints",
  "hardware",
  "soft tissues",
  "other",
] as const;

export type LsSection = (typeof LS_FINDINGS_SECTIONS)[number];

export type LsGateRequirements = {
  /** Every one of these projections must be recorded as performed. */
  requires?: XrayLsViewKey[];
  /** At least one of these projections must be recorded. */
  requiresAny?: XrayLsViewKey[];
  /** Adequacy dimensions that must be RECORDED AS ADEQUATE, not merely unlisted. */
  requiresAdequate?: XrayLsAdequacyKey[];
  /** The film must demonstrably include the lumbosacral junction (spec §2). */
  requiresJunction?: boolean;
  /** T12-L1 must be in the field of view (spec §5). */
  requiresT12L1?: boolean;
  /** An AP projection must exist before the SI joints are commented on (§13). */
  requiresSiJoints?: boolean;
  /** Pars assessment through assessPars(), optionally the unilateral form. */
  parsGate?: "any" | "unilateral";
  /** Side-specific foraminal assessment through assessForaminal(). */
  foraminalGate?: boolean;
  /** Flexion AND extension must be recorded (spec §9). */
  dynamicGate?: boolean;
  /** A level-bearing tile needs an established numbering basis (spec §4). */
  requiresNumbering?: boolean;
};

export type LsTile = LsGateRequirements & {
  id: string;
  label: string;
  group: string;
  /** Hidden behind "Show advanced / rare tiles". */
  advanced?: boolean;
  /** Matches a critical pattern of the seeded xr.lumbar_spine knowledge pack. */
  criticalPattern?: boolean;
  atoms: LsAtomSpec[];
};

export type LsSubMasterId =
  | "routine"
  | "degenerative"
  | "listhesis"
  | "trauma"
  | "deformity"
  | "transitional"
  | "infection"
  | "tumor"
  | "postoperative"
  | "dynamic"
  | "sacroiliac"
  | "advanced";

export type LsSubMaster = {
  id: LsSubMasterId;
  label: string;
  hint: string;
  tiles: LsTile[];
};

/**
 * Palette order follows the spec's own list (spec §3): routine, degenerative,
 * listhesis/pars, trauma, deformity, transitional, infection, tumour,
 * post-operative, dynamic, sacroiliac, then the advanced catch-all.
 */
export const LS_SUBMASTER_IDS: LsSubMasterId[] = [
  "routine",
  "degenerative",
  "listhesis",
  "trauma",
  "deformity",
  "transitional",
  "infection",
  "tumor",
  "postoperative",
  "dynamic",
  "sacroiliac",
  "advanced",
];

/* ───────────────────────────── atom helpers ────────────────────────────── */

const ALIGN = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, { anatomicalSection: "alignment", ...extra });

const BODY = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, { anatomicalSection: "vertebral bodies", ...extra });

const DISC = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, {
    anatomicalSection: "disc spaces",
    baselineReplaces: N.discs,
    ...extra,
  });

const POST = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, {
    anatomicalSection: "posterior elements",
    baselineReplaces: N.posteriorElements,
    ...extra,
  });

const FACET = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, {
    anatomicalSection: "facets",
    supportsLaterality: true,
    ...extra,
  });

const PARS = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, {
    anatomicalSection: "pars interarticularis",
    supportsLaterality: true,
    baselineReplaces: N.posteriorElements,
    ...extra,
  });

const NUM = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, { anatomicalSection: "numbering", ...extra });

const SI = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, {
    anatomicalSection: "sacroiliac joints",
    supportsLaterality: true,
    ...extra,
  });

const HARDWARE = (findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom("ls_postop_hardware", findings, {
    anatomicalSection: "hardware",
    baselineReplaces: N.noHardware,
    ...extra,
  });

const SOFT = (concept: string, findings: string, extra: Partial<LsAtomSpec> = {}): LsAtomSpec =>
  lsAtom(concept, findings, { anatomicalSection: "soft tissues", ...extra });

/* ────────────────────────────── the catalog ────────────────────────────── */

export const XRAY_LS_SUB_MASTERS: readonly LsSubMaster[] = [
  // ── 1. Routine / Normal — the shared LS core, in report order ──────────
  {
    id: "routine",
    label: "Routine",
    hint: "Coverage, numbering and the shared lumbosacral core every film comments on.",
    tiles: [
      {
        id: "rt-numbering-standard",
        label: "Numbering: five lumbar-type vertebrae",
        group: "Numbering",
        atoms: [
          NUM("ls_numbering_basis", LS_NORMAL_SENTENCES.numberingStandard, {
            baselineReplaces: "",
          }),
        ],
      },
      {
        id: "rt-alignment",
        label: "Lordosis and alignment maintained",
        group: "Alignment",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_alignment", N.alignment, {
            role: "baseline",
            view: "lateral",
            baselineReplaces: "",
          }),
        ],
      },
      {
        id: "rt-vertebrae",
        label: "Vertebral body heights preserved",
        group: "Vertebrae",
        atoms: [
          BODY("ls_vertebral_body_height", N.vertebrae, { role: "baseline", baselineReplaces: "" }),
        ],
      },
      {
        id: "rt-no-fracture",
        label: "No acute fracture or listhesis",
        group: "Vertebrae",
        atoms: [
          BODY("ls_no_acute_fracture", N.noFracture, { role: "baseline", baselineReplaces: "" }),
        ],
      },
      {
        id: "rt-discs",
        label: "Disc spaces preserved",
        group: "Discs",
        atoms: [DISC("ls_disc_space", N.discs, { role: "baseline", baselineReplaces: "" })],
      },
      {
        id: "rt-posterior",
        label: "Posterior elements intact",
        group: "Posterior elements",
        parsGate: "any",
        atoms: [
          POST("ls_posterior_elements", N.posteriorElements, {
            role: "baseline",
            baselineReplaces: "",
          }),
        ],
      },
      {
        id: "rt-junction-adequate",
        label: "Lumbosacral junction adequately visualized",
        group: "Coverage",
        requiresJunction: true,
        atoms: [
          ALIGN("ls_l5s1_junction", N.junctionAdequate, {
            level: "L5-S1",
            role: "baseline",
            baselineReplaces: "",
          }),
        ],
      },
      {
        id: "rt-si-preserved",
        label: "Sacroiliac joints preserved",
        group: "Sacroiliac joints",
        requiresSiJoints: true,
        atoms: [
          SI("ls_si_joints", N.siPreserved, {
            view: "ap",
            role: "baseline",
            baselineReplaces: "",
          }),
        ],
      },
      {
        id: "rt-no-hardware",
        label: "No instrumentation",
        group: "Hardware",
        atoms: [BODY("ls_no_hardware", N.noHardware, { anatomicalSection: "hardware", role: "baseline", baselineReplaces: "" })],
      },
      {
        id: "rt-coverage-l5s1",
        label: "L5-S1 not adequately visualized",
        group: "Coverage",
        atoms: [
          ALIGN("ls_l5s1_junction", LS_JUNCTION_SENTENCES.notAdequate, {
            conflictGroup: "ls_l5s1_junction",
          }),
        ],
      },
      {
        id: "rt-coverage-bowel",
        label: "Obscured by bowel gas / stool",
        group: "Coverage",
        atoms: [
          ALIGN(
            "ls_coverage_bowel",
            "The lower lumbar and lumbosacral segments are partially obscured by bowel gas and stool, limiting assessment of the posterior elements and the L5-S1 junction.",
          ),
        ],
      },
      {
        id: "rt-coverage-t12l1-out",
        label: "T12-L1 not included",
        group: "Coverage",
        atoms: [ALIGN("ls_coverage_t12l1", N.t12l1Excluded)],
      },
      {
        id: "rt-coverage-rotation",
        label: "Rotation limits assessment",
        group: "Coverage",
        atoms: [
          ALIGN(
            "ls_coverage_rotation",
            "Patient rotation limits assessment of alignment, the posterior elements and the intervertebral foramina.",
          ),
        ],
      },
      {
        id: "rt-coverage-motion",
        label: "Motion degrades fine detail",
        group: "Coverage",
        atoms: [
          ALIGN(
            "ls_coverage_motion",
            "Motion artifact degrades fine osseous detail on the provided radiographs.",
          ),
        ],
      },
      {
        id: "rt-coverage-osteopenia",
        label: "Osteopenia limits bony detail",
        group: "Coverage",
        atoms: [
          BODY(
            "ls_coverage_osteopenia",
            "Generalized osteopenia reduces bony detail, limiting detection of subtle cortical disruption.",
            { impression: "Osteopenia; limited bony detail." },
          ),
        ],
      },
      {
        id: "rt-straightening",
        label: "Loss of lumbar lordosis (descriptive)",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          ALIGN("ls_lordosis_loss", "Loss of the normal lumbar lordosis with straightening of the lumbar curve on the lateral radiograph.", {
            view: "lateral",
            baselineReplaces: N.alignment,
            impression: "Loss of lumbar lordosis.",
            // Deliberately no "muscle spasm" / "antalgic" attribution (spec §6).
          }),
        ],
      },
      {
        id: "rt-hyperlordosis",
        label: "Increased lumbar lordosis",
        group: "Alignment",
        requires: ["lateral"],
        atoms: [
          ALIGN("ls_lordosis_increased", "Exaggerated lumbar lordosis on the lateral radiograph.", {
            view: "lateral",
            baselineReplaces: N.alignment,
            impression: "Increased lumbar lordosis.",
          }),
        ],
      },
    ],
  },

  // ── 2. Degenerative (spec §7; library §5, §6, §9) ──────────────────────
  {
    id: "degenerative",
    label: "Degenerative",
    hint: "Per-level spondylotic change. No disc signal, canal or root conclusions — those are MRI.",
    tiles: [
      {
        id: "dg-disc-narrowing",
        label: "Disc-space narrowing",
        group: "Discs",
        requiresNumbering: true,
        atoms: [
          DISC("ls_disc_narrowing", "Reduced disc-space height at [level].", {
            impression: "Disc-space narrowing at [level].",
          }),
        ],
      },
      // Library §6 grades the reduction, and a graded line is what the referring
      // clinician reads. Same concept, so the grades are alternative statements
      // about one disc rather than three observations at the same level.
      {
        id: "dg-disc-mild",
        label: "Disc-space narrowing — mild",
        group: "Discs",
        requiresNumbering: true,
        atoms: [
          DISC("ls_disc_narrowing", "Mild reduction of disc-space height at [level].", {
            severity: "mild",
            impression: "Mild disc-space narrowing at [level].",
          }),
        ],
      },
      {
        id: "dg-disc-moderate",
        label: "Disc-space narrowing — moderate",
        group: "Discs",
        requiresNumbering: true,
        atoms: [
          DISC("ls_disc_narrowing", "Moderate reduction of disc-space height at [level].", {
            severity: "moderate",
            impression: "Moderate disc-space narrowing at [level].",
          }),
        ],
      },
      {
        id: "dg-disc-severe",
        label: "Disc-space narrowing — severe",
        group: "Discs",
        requiresNumbering: true,
        atoms: [
          DISC("ls_disc_narrowing", "Severe reduction of disc-space height at [level], with near bone-on-bone apposition.", {
            severity: "severe",
            impression: "Severe disc-space narrowing at [level].",
          }),
        ],
      },
      {
        id: "dg-osteophytes",
        label: "Marginal osteophytes",
        group: "Vertebrae",
        requiresNumbering: true,
        atoms: [
          BODY("ls_osteophytes", "Marginal osteophytes at [level] with disc-space height loss.", {
            baselineReplaces: N.vertebrae,
            impression: "Marginal osteophytes at [level].",
          }),
        ],
      },
      {
        id: "dg-endplate-sclerosis",
        label: "Endplate sclerosis",
        group: "Vertebrae",
        requiresNumbering: true,
        atoms: [
          BODY("ls_endplate_sclerosis", "Endplate sclerosis at [level].", {
            baselineReplaces: N.vertebrae,
            impression: "Endplate sclerosis at [level].",
          }),
        ],
      },
      {
        id: "dg-endplate-irregularity",
        label: "Endplate irregularity",
        group: "Vertebrae",
        requiresNumbering: true,
        atoms: [
          BODY("ls_endplate_irregularity", "Irregularity of the endplates at [level].", {
            baselineReplaces: N.vertebrae,
          }),
        ],
      },
      {
        id: "dg-vacuum",
        label: "Vacuum phenomenon",
        group: "Discs",
        requiresNumbering: true,
        requiresAdequate: ["posteriorElementVisualization"],
        atoms: [
          DISC("ls_vacuum_phenomenon", "Intradiscal gas (vacuum phenomenon) at [level].", {
            impression: "Intradiscal gas at [level], a degenerative sign.",
          }),
        ],
      },
      {
        id: "dg-facet",
        label: "Facet arthropathy",
        group: "Facets",
        requiresAny: ["lateral", "obliqueRight", "obliqueLeft"],
        requiresNumbering: true,
        atoms: [
          FACET("ls_facet_arthropathy", "Facet joint arthropathy with sclerosis and joint-space narrowing at [level], [side].", {
            impression: "Facet arthropathy at [level], [side].",
          }),
        ],
      },
      {
        id: "dg-foraminal-narrowing",
        label: "Foraminal narrowing (oblique)",
        group: "Facets",
        foraminalGate: true,
        requiresNumbering: true,
        atoms: [
          FACET("ls_foraminal_narrowing", "Narrowing of the neural foramen at [level], [side], on the oblique projection.", {
            impression: "Foraminal narrowing at [level], [side].",
            // No root compression or canal conclusion from a foramen (spec §7).
          }),
        ],
      },
      {
        id: "dg-degenerative-listhesis",
        label: "Degenerative listhesis",
        group: "Alignment",
        requiresJunction: true,
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_degenerative_listhesis", "Degenerative [direction] of [upper] over [lower] at [level] with facet arthropathy and disc-space narrowing.", {
            impression: "Degenerative [direction] at [level].",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "dg-multilevel",
        label: "Multilevel spondylotic change",
        group: "Discs",
        requiresNumbering: true,
        atoms: [
          DISC("ls_multilevel_degeneration", "Multilevel marginal osteophytes, disc-space narrowing and endplate sclerosis, most pronounced at [level].", {
            impression: "Multilevel lumbar spondylotic/degenerative changes, most pronounced at [level].",
          }),
        ],
      },
      {
        id: "dg-modic-free-language",
        label: "Endplate change (radiographic pattern)",
        group: "Vertebrae",
        requiresNumbering: true,
        atoms: [
          BODY(
            "ls_endplate_change_pattern",
            "Endplate irregularity with adjacent sclerosis at [level]. Marrow and disc signal change cannot be assessed on radiography.",
            { impression: "Degenerative endplate change at [level]." },
          ),
        ],
      },
      {
        id: "dg-schmorl",
        label: "Schmorl-node appearance",
        group: "Vertebrae",
        requiresNumbering: true,
        requiresAdequate: ["posteriorElementVisualization"],
        atoms: [
          BODY("ls_schmorl_node", "Central endplate herniation (Schmorl-node appearance) of [level].", {
            baselineReplaces: N.vertebrae,
          }),
        ],
      },
    ],
  },

  // ── 3. Spondylolisthesis / pars (spec §8; library §4, §7, §8) ──────────
  {
    id: "listhesis",
    label: "Listhesis / Pars",
    hint: "Direction, level and grade. Meyerding is derived only from a measured slip percentage.",
    tiles: [
      {
        id: "ls-anterolisthesis",
        label: "Anterolisthesis",
        group: "Listhesis",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_anterolisthesis", "[direction] of [upper] over [lower] at [level].", {
            direction: "anterolisthesis",
            impression: "[direction] of [upper] over [lower].",
            severity: "moderate",
            view: "lateral",
          }),
        ],
      },
      {
        id: "ls-retrolisthesis",
        label: "Retrolisthesis",
        group: "Listhesis",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_retrolisthesis", "Retrolisthesis of [upper] over [lower] at [level].", {
            direction: "retrolisthesis",
            impression: "Retrolisthesis of [upper] over [lower].",
            severity: "moderate",
            view: "lateral",
          }),
        ],
      },
      {
        id: "ls-lateral-listhesis",
        label: "Lateral translation / scoliotic listhesis",
        group: "Listhesis",
        requires: ["ap"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_lateral_listhesis", "Lateral translation of [upper] over [lower] at [level] on the AP projection.", {
            direction: "lateral translation",
            impression: "Lateral listhesis at [level].",
            view: "ap",
          }),
        ],
      },
      {
        id: "ls-pars-defect",
        label: "Pars defect (bilateral)",
        group: "Pars",
        parsGate: "any",
        requiresNumbering: true,
        atoms: [
          PARS("ls_pars_defect", "Cortical defect through the pars interarticularis of [level], bilateral.", {
            impression: "Bilateral pars defect at [level].",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "ls-pars-defect-unilateral",
        label: "Pars defect (unilateral, oblique)",
        group: "Pars",
        parsGate: "unilateral",
        requiresNumbering: true,
        atoms: [
          PARS("ls_pars_defect_unilateral", "Defect through the [side] pars interarticularis of [level], demonstrated on the oblique projection.", {
            laterality: "right",
            impression: "[Side] pars defect at [level].",
          }),
        ],
      },
      {
        id: "ls-pars-equivocal",
        label: "Equivocal pars lucency",
        group: "Pars",
        requiresAny: ["lateral", "obliqueRight", "obliqueLeft"],
        requiresNumbering: true,
        atoms: [
          PARS("ls_pars_equivocal", "A luency projecting through the pars of [level] is equivocal and may represent overlap; oblique projections are advised if clinically indicated.", {
            impression: "Equivocal pars lucency at [level].",
          }),
        ],
      },
      {
        id: "ls-isthmic",
        label: "Isthmic spondylolisthesis (pars + slip)",
        group: "Listhesis",
        parsGate: "any",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          PARS("ls_pars_defect", "Cortical defect through the pars interarticularis of [level].", {
            conflictGroup: "ls_pars_defect",
          }),
          ALIGN("ls_isthmic_listhesis", "[direction] of [upper] over [lower] at [level] in association with the pars defect.", {
            direction: "anterolisthesis",
            impression: "Isthmic [direction] at [level].",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "ls-high-grade",
        label: "High-grade slip / spondyloptosis",
        group: "Listhesis",
        requires: ["lateral"],
        requiresJunction: true,
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          ALIGN("ls_high_grade_listhesis", "High-grade [direction] of [upper] over [lower] at [level] with [pct]% translation of the vertebral body width.", {
            direction: "anterolisthesis",
            impression: "High-grade [direction] at [level].",
            severity: "high",
          }),
        ],
      },
      {
        id: "ls-listhesis-measured",
        label: "Slip with measured translation",
        group: "Listhesis",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_listhesis_measured", "[direction] of [upper] over [lower] at [level], [mm] mm translating [pct]% of the measured vertebral body AP diameter.", {
            direction: "anterolisthesis",
            impression: "[direction] at [level], [grade] (Meyerding, derived from the measured slip).",
          }),
        ],
      },
    ],
  },

  // ── 4. Trauma (spec §10; library §11) ──────────────────────────────────
  {
    id: "trauma",
    label: "Trauma",
    hint: "Height loss and cortical disruption. Plain films are not asked to assess the canal or ligaments.",
    tiles: [
      {
        id: "tr-compression",
        label: "Compression fracture with height loss",
        group: "Compression",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          BODY("ls_compression_fracture", "Compression fracture of [level] with approximately [pct]% loss of vertebral body height.", {
            baselineReplaces: N.vertebrae,
            impression: "Compression fracture of [level] with approximately [pct]% height loss.",
            severity: "moderate",
            view: "lateral",
          }),
        ],
      },
      {
        id: "tr-wedge",
        label: "Anterior wedge deformity",
        group: "Compression",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          BODY("ls_wedge_deformity", "Anterior wedging of [level] without convincing posterior cortical disruption.", {
            baselineReplaces: N.vertebrae,
            impression: "Anterior wedging of [level].",
          }),
        ],
      },
      {
        id: "tr-burst-suspicion",
        label: "Burst-pattern suspicion",
        group: "Compression",
        requires: ["lateral", "ap"],
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          BODY("ls_burst_pattern", "Comminuted vertebral body fracture of [level] with widening of the posterior cortex, a burst pattern. Canal and neural compromise cannot be assessed on radiography.", {
            baselineReplaces: N.vertebrae,
            impression: "Burst-pattern fracture of [level] — CT is indicated.",
            severity: "high",
            recommendation: "CT of the lumbar spine is recommended for fracture morphology; MRI for canal, cauda and ligamentous assessment.",
          }),
        ],
      },
      {
        id: "tr-retropulsion",
        label: "Retropulsed fragment (when visible)",
        group: "Compression",
        requires: ["lateral"],
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          BODY("ls_retropulsion", "Posterior cortical disruption at [level] with a retropulsed fragment projected over the canal on the lateral radiograph. Canal compromise cannot be graded from radiography.", {
            impression: "Retropulsed fragment at [level] — CT/MRI correlation.",
            severity: "high",
          }),
        ],
      },
      {
        id: "tr-cortical-disruption",
        label: "Cortical disruption, level indeterminate",
        group: "Fracture",
        atoms: [
          BODY("ls_cortical_disruption", "Cortical disruption is identified at [level].", {
            baselineReplaces: N.noFracture,
            impression: "Cortical disruption at [level].",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "tr-posterior-element",
        label: "Posterior element fracture",
        group: "Fracture",
        requiresAdequate: ["posteriorElementVisualization"],
        requiresNumbering: true,
        atoms: [
          POST("ls_posterior_element_fracture", "Fracture through the posterior elements at [level].", {
            impression: "Posterior element fracture at [level].",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "tr-transverse-process",
        label: "Transverse process fracture",
        group: "Fracture",
        requiresNumbering: true,
        atoms: [
          POST("ls_transverse_process_fracture", "Fracture of the transverse process at [level].", {
            impression: "Transverse process fracture at [level].",
          }),
        ],
      },
      {
        id: "tr-fracture-dislocation",
        label: "Fracture-dislocation",
        group: "Fracture",
        requires: ["lateral", "ap"],
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          ALIGN("ls_fracture_dislocation", "Marked malalignment with translation and angulation at [level] consistent with a fracture-dislocation.", {
            baselineReplaces: N.alignment,
            impression: "Fracture-dislocation at [level] — urgent clinical correlation.",
            severity: "high",
          }),
        ],
      },
      {
        id: "tr-malalignment",
        label: "Acute malalignment without fracture",
        group: "Alignment",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_acute_malalignment", "Segmental malalignment at [level] without a convincingly demonstrated fracture line.", {
            baselineReplaces: N.alignment,
            impression: "Malalignment at [level] without demonstrable fracture.",
          }),
        ],
      },
      {
        id: "tr-sacral-suspicion",
        label: "Suspected sacral fracture",
        group: "Sacrum",
        requiresJunction: true,
        atoms: [
          BODY("ls_sacral_fracture_suspicion", "Cortical irregularity through the sacrum is suspected; the sacrum is optimally assessed on CT.", {
            impression: "Suspected sacral fracture — CT correlation.",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "tr-no-fracture",
        label: "No acute fracture (limited study caveat)",
        group: "Fracture",
        atoms: [
          BODY("ls_no_acute_fracture", "No acute fracture or listhesis is identified on these views.", {
            role: "baseline",
            baselineReplaces: "",
          }),
        ],
      },
    ],
  },

  // ── 5. Deformity / scoliosis (spec §11; library §12) ───────────────────
  {
    id: "deformity",
    label: "Deformity",
    hint: "Curvature direction and apex; a Cobb angle only when deliberately measured.",
    tiles: [
      {
        id: "df-dextro",
        label: "Dextroconvex curvature",
        group: "Curvature",
        requires: ["ap"],
        atoms: [
          ALIGN("ls_dextroconvex", "Dextroconvex lumbar curvature with the apex at [level] on the AP radiograph.", {
            baselineReplaces: N.alignment,
            impression: "Dextroconvex lumbar scoliosis, apex [level].",
            view: "ap",
          }),
        ],
      },
      {
        id: "df-levo",
        label: "Levoconvex curvature",
        group: "Curvature",
        requires: ["ap"],
        atoms: [
          ALIGN("ls_levoconvex", "Levoconvex lumbar curvature with the apex at [level] on the AP radiograph.", {
            baselineReplaces: N.alignment,
            impression: "Levoconvex lumbar scoliosis, apex [level].",
            view: "ap",
          }),
        ],
      },
      {
        id: "df-cobb",
        label: "Cobb angle (measured)",
        group: "Measurement",
        requires: ["ap"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_cobb_deformity", "Cobb angle between [upper] and [lower] measures [deg] degrees on the standing AP radiograph.", {
            impression: "Lumbar scoliosis, Cobb angle [deg] degrees between [upper] and [lower].",
            view: "ap",
          }),
        ],
      },
      {
        id: "df-coronal",
        label: "Coronal imbalance",
        group: "Curvature",
        requires: ["ap"],
        atoms: [
          ALIGN("ls_coronal_imbalance", "Coronal imbalance with the C7 plumb line (where included) displaced from the sacral midline.", {
            impression: "Coronal imbalance.",
            view: "ap",
          }),
        ],
      },
      {
        id: "df-rotation",
        label: "Vertebral rotation described",
        group: "Curvature",
        requires: ["ap"],
        requiresNumbering: true,
        atoms: [
          BODY("ls_vertebral_rotation", "Rotational deformity of the vertebrae at the curve apex ([level]).", {
            impression: "Apical vertebral rotation at [level].",
          }),
        ],
      },
      {
        id: "df-degenerative-scoliosis",
        label: "Degenerative scoliosis with spondylosis",
        group: "Curvature",
        requires: ["ap", "lateral"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_degenerative_scoliosis", "Degenerative lumbar curvature with multilevel disc-space narrowing and facet arthropathy, most marked at [level].", {
            baselineReplaces: N.alignment,
            impression: "Degenerative lumbar scoliosis, most marked at [level].",
          }),
        ],
      },
      {
        id: "df-sacral-obliquity",
        label: "Pelvic obliquity / sacral tilting",
        group: "Curvature",
        requires: ["ap"],
        atoms: [
          ALIGN("ls_pelvic_obliquity", "Pelvic obliquity with sacral tilting; a lower-limb discrepancy cannot be assessed on this study.", {
            impression: "Pelvic obliquity.",
            view: "ap",
          }),
        ],
      },
    ],
  },

  // ── 6. Transitional anatomy (spec §12; library §3, §14) ────────────────
  {
    id: "transitional",
    label: "Transitional",
    hint: "Numbering-affecting anatomy. Castellvi is radiologist-selected; the eponym is never auto-applied.",
    tiles: [
      {
        id: "tr-large-tp",
        label: "Enlarged transverse process",
        group: "Transitional anatomy",
        requiresNumbering: true,
        atoms: [
          POST("ls_transverse_process_enlarged", "Enlarged [side] transverse process of [level].", {
            supportsLaterality: true,
            impression: "Enlarged [side] transverse process of [level].",
          }),
        ],
      },
      {
        id: "tr-pseudoarticulation",
        label: "Pseudoarticulation with the sacrum",
        group: "Transitional anatomy",
        requiresJunction: true,
        requiresNumbering: true,
        atoms: [
          POST("ls_transitional_pseudoarticulation", "Neoarticulation between the enlarged transverse process of [level] and the sacral ala, [side].", {
            supportsLaterality: true,
            impression: "Transitional vertebra with pseudoarticulation, [side].",
          }),
        ],
      },
      {
        id: "tr-fusion",
        label: "Fusion with the sacrum",
        group: "Transitional anatomy",
        requiresJunction: true,
        requiresNumbering: true,
        atoms: [
          POST("ls_transitional_fusion", "Partial fusion of the transverse process of [level] with the sacral ala, [side].", {
            supportsLaterality: true,
            impression: "Transitional lumbosacral anatomy with partial sacral fusion, [side].",
          }),
        ],
      },
      {
        id: "tr-sacralization",
        label: "Sacralization of the lowest lumbar vertebra",
        group: "Numbering",
        requiresJunction: true,
        atoms: [
          NUM("ls_sacralization", "Sacralization of the lowest lumbar-type vertebra; four mobile lumbar-type segments are counted above a partially incorporated body."),
          NUM("ls_numbering_basis", "Numbering is anchored by designating the lowest prominent lumbar-type vertebra as L5.", {
            conflictGroup: "ls_numbering_basis",
          }),
        ],
      },
      {
        id: "tr-lumbarization",
        label: "Lumbarization of S1",
        group: "Numbering",
        requiresJunction: true,
        atoms: [
          NUM("ls_lumbarization", "Lumbarization of the first sacral segment; six lumbar-type vertebrae are counted."),
          NUM("ls_numbering_basis", "Numbering is anchored by designating the lowest prominent lumbar-type vertebra as L5.", {
            conflictGroup: "ls_numbering_basis",
          }),
        ],
      },
      {
        id: "tr-castellvi",
        label: "Castellvi type (radiologist-selected)",
        group: "Transitional anatomy",
        requiresJunction: true,
        requiresNumbering: true,
        atoms: [
          POST("ls_castellvi", "Transitional lumbosacral vertebra, Castellvi type [grade], as selected by the reporting radiologist.", {
            impression: "Transitional lumbosacral vertebra, Castellvi type [grade].",
          }),
        ],
      },
      {
        id: "tr-numbering-caution",
        label: "Numbering caution statement",
        group: "Numbering",
        atoms: [
          NUM(
            "ls_numbering_basis",
            "The number of lumbar-type vertebrae is not established on these radiographs; segment levels are described as counted and the lowest lumbar-type segment is not assumed to be L5.",
            { conflictGroup: "ls_numbering_basis" },
          ),
        ],
      },
      {
        id: "tr-spina-bifida",
        label: "Spina bifida occulta of L5/S1",
        group: "Posterior elements",
        requiresAdequate: ["posteriorElementVisualization"],
        atoms: [
          POST("ls_spina_bifida", "Deficiency of the posterior arch at [level] consistent with spina bifida occulta.", {
            impression: "Spina bifida occulta at [level].",
          }),
        ],
      },
    ],
  },

  // ── 7. Infection / destructive pattern (spec §14; library §15) ─────────
  {
    id: "infection",
    label: "Infection / Destructive",
    hint: "Destructive patterns only. Etiology requires correlation and is never auto-assigned.",
    tiles: [
      {
        id: "in-disc-endplate",
        label: "Disc narrowing with endplate destruction",
        group: "Destructive pattern",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          DISC("ls_disc_destruction", "Marked disc-space loss at [level] with destruction and irregularity of the adjacent endplates.", {
            impression: "Destructive disc/endplate pattern at [level] — infection and neoplasm require clinical and MR correlation.",
            severity: "high",
          }),
        ],
      },
      {
        id: "in-vertebral-collapse",
        label: "Vertebral collapse with endplate loss",
        group: "Destructive pattern",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          BODY("ls_pathologic_collapse", "Loss of vertebral body height of [level] with endplate destruction rather than a preserved cortical hinge.", {
            baselineReplaces: N.vertebrae,
            impression: "Vertebral collapse with endplate destruction at [level].",
            severity: "high",
          }),
        ],
      },
      {
        id: "in-paravertebral",
        label: "Paravertebral soft-tissue abnormality",
        group: "Soft tissues",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          SOFT("ls_paravertebral_soft_tissue", "Paravertebral soft-tissue prominence at [level] on the lateral radiograph.", {
            impression: "Paravertebral soft-tissue abnormality at [level].",
            view: "lateral",
          }),
        ],
      },
      {
        id: "in-multilevel-destruction",
        label: "Multilevel destruction",
        group: "Destructive pattern",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          BODY("ls_multilevel_destruction", "Two or more adjacent vertebral bodies with endplate destruction and disc-space loss at [level].", {
            baselineReplaces: N.vertebrae,
            impression: "Adjacent-segment destructive pattern at [level].",
            severity: "high",
            recommendation: "MRI with contrast is recommended for suspected infection; clinical and laboratory correlation is required.",
          }),
        ],
      },
      {
        id: "in-etiology-disclaimer",
        label: "Etiology not assigned from radiography",
        group: "Disclaimers",
        atoms: [
          NUM(
            "ls_etiology_disclaimer",
            "A radiographic destructive pattern does not establish an etiologic diagnosis; infection, tumour and post-radiatic change require clinical, laboratory and cross-sectional correlation.",
            { anatomicalSection: "other" },
          ),
        ],
      },
    ],
  },

  // ── 8. Tumour / osseous lesion (spec §14; library §16) ─────────────────
  {
    id: "tumor",
    label: "Osseous Lesion",
    hint: "Lytic, sclerotic and mixed patterns. A lesion is never called metastasis here.",
    tiles: [
      {
        id: "tu-lytic",
        label: "Focal lytic lesion",
        group: "Lesion",
        requiresNumbering: true,
        atoms: [
          BODY("ls_lytic_lesion", "Focal lytic lesion of [level] without a sclerotic rim.", {
            baselineReplaces: N.vertebrae,
            impression: "Focal lytic lesion at [level] — correlation for a primary or secondary osseous lesion.",
            severity: "high",
          }),
        ],
      },
      {
        id: "tu-sclerotic",
        label: "Focal sclerotic lesion",
        group: "Lesion",
        requiresNumbering: true,
        atoms: [
          BODY("ls_sclerotic_lesion", "Focal sclerotic lesion of [level].", {
            baselineReplaces: N.vertebrae,
            impression: "Focal sclerotic lesion at [level].",
          }),
        ],
      },
      {
        id: "tu-mixed",
        label: "Mixed lytic-sclerotic lesion",
        group: "Lesion",
        requiresNumbering: true,
        atoms: [
          BODY("ls_mixed_lesion", "Mixed lytic and sclerotic lesion of [level].", {
            baselineReplaces: N.vertebrae,
            impression: "Mixed density osseous lesion at [level].",
            severity: "high",
          }),
        ],
      },
      {
        id: "tu-multifocal",
        label: "Multifocal lesions",
        group: "Lesion",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          BODY("ls_multifocal_lesions", "Multifocal lytic and sclerotic lesions involving [level] and adjacent vertebrae.", {
            baselineReplaces: N.vertebrae,
            impression: "Multifocal osseous lesions — correlation for known malignancy.",
            severity: "high",
            recommendation: "Cross-sectional imaging and clinical correlation for known primary malignancy.",
          }),
        ],
      },
      {
        id: "tu-pedicle",
        label: "Absent / involved pedicle (winking owl)",
        group: "Posterior elements",
        requires: ["ap"],
        requiresNumbering: true,
        atoms: [
          POST("ls_pedicle_lesion", "Non-visualization of the [side] pedicle at [level] on the AP radiograph, suggesting pedicular destruction.", {
            supportsLaterality: true,
            impression: "Absent [side] pedicle at [level].",
            severity: "high",
            view: "ap",
          }),
        ],
      },
      {
        id: "tu-pathologic-fracture",
        label: "Pathological fracture pattern",
        group: "Lesion",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          BODY("ls_pathologic_fracture", "Loss of height of [level] through a region of pre-existing focal osseous abnormality, a pathological fracture pattern.", {
            baselineReplaces: N.vertebrae,
            impression: "Pathological fracture of [level].",
            severity: "high",
          }),
        ],
      },
      {
        id: "tu-haemangioma",
        label: "Vertebral haemangioma-like pattern",
        group: "Lesion",
        advanced: true,
        requiresNumbering: true,
        atoms: [
          BODY("ls_haemangioma_pattern", "Vertical striations with coarse trabeculation of [level], a haemangioma-like pattern.", {
            impression: "Benign-appearing vertebral lesion at [level] with coarse vertical striations.",
          }),
        ],
      },
      {
        id: "tu-etiology-disclaimer",
        label: "No automatic malignancy label",
        group: "Disclaimers",
        atoms: [
          NUM(
            "ls_neoplasm_disclaimer",
            "An indeterminate osseous lesion is not assigned a benign or malignant diagnosis from radiography alone.",
            { anatomicalSection: "other" },
          ),
        ],
      },
    ],
  },

  // ── 9. Post-operative (spec §15; library §17) ──────────────────────────
  {
    id: "postoperative",
    label: "Post-operative",
    hint: "Procedures, implants, graded lucency and adjacent-segment change.",
    tiles: [
      {
        id: "po-laminectomy",
        label: "Laminectomy",
        group: "Procedure",
        requiresNumbering: true,
        atoms: [
          HARDWARE("Laminectomy at [level] with absence of the spinous process and lamina.", {
            impression: "Post-operative laminectomy at [level].",
          }),
        ],
      },
      {
        id: "po-instrumentation-intact",
        label: "Instrumentation grossly intact",
        group: "Instrumentation",
        requiresNumbering: true,
        atoms: [
          HARDWARE("Pedicle screws and rods at [level] are grossly intact with maintained alignment and no convincing perihardware lucency.", {
            impression: "Posterior instrumentation at [level], grossly intact.",
          }),
        ],
      },
      {
        id: "po-interbody",
        label: "Interbody cage / spacer",
        group: "Instrumentation",
        requiresNumbering: true,
        atoms: [
          HARDWARE("Interbody cage/spacer at [level] with maintained disc-space height.", {
            impression: "Interbody fusion at [level].",
          }),
        ],
      },
      {
        id: "po-cement",
        label: "Vertebroplasty / kyphoplasty cement",
        group: "Instrumentation",
        requiresNumbering: true,
        atoms: [
          HARDWARE("Intravertebral cement at [level] following vertebroplasty/kyphoplasty, without convincing cement extrusion beyond the cortex.", {
            impression: "Vertebral augmentation at [level].",
          }),
        ],
      },
      {
        id: "po-cement-extrusion",
        label: "Suspected cement extrusion",
        group: "Complication",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          HARDWARE("Cement at [level] projects beyond the vertebral cortex, suspicious for extrusion; canal and root involvement cannot be assessed radiographically.", {
            impression: "Suspected cement extrusion at [level] — CT correlation.",
            severity: "high",
          }),
        ],
      },
      {
        id: "po-breakage",
        label: "Hardware breakage",
        group: "Complication",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          HARDWARE("Cortical discontinuity through the [side] rod/screw at [level], consistent with hardware breakage.", {
            supportsLaterality: true,
            impression: "Hardware breakage at [level].",
            severity: "high",
          }),
        ],
      },
      {
        id: "po-migration",
        label: "Hardware migration",
        group: "Complication",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          HARDWARE("Change in the position of the [side] pedicle screw at [level] compared with the expected position, consistent with hardware migration.", {
            supportsLaterality: true,
            impression: "Hardware migration at [level].",
            severity: "high",
          }),
        ],
      },
      {
        id: "po-lucency-convincing",
        label: "Convincing perihardware lucency",
        group: "Complication",
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          HARDWARE("Convincing perihardware lucency at [level], concerning for loosening.", {
            impression: "Convincing perihardware lucency at [level], concerning for loosening.",
            severity: "high",
          }),
        ],
      },
      {
        id: "po-lucency-equivocal",
        label: "Equivocal perihardware lucency (not diagnostic)",
        group: "Complication",
        requiresNumbering: true,
        atoms: [
          HARDWARE("Equivocal lucency at the bone-implant interface at [level]; overlap limits assessment and this is not diagnostic of loosening on plain radiographs.", {
            impression: "Equivocal perihardware lucency at [level], not diagnostic of loosening.",
          }),
        ],
      },
      {
        id: "po-fusion-mass",
        label: "Fusion mass / arthrodesis",
        group: "Procedure",
        requiresNumbering: true,
        atoms: [
          HARDWARE("Fusion mass spanning [level] without convincing bridging bone across the facet joint.", {
            impression: "Arthrodesis attempt at [level] without definite bridging fusion.",
          }),
        ],
      },
      {
        id: "po-adjacent-segment",
        label: "Adjacent-segment degeneration",
        group: "Adjacent segments",
        requiresNumbering: true,
        atoms: [
          DISC("adjacent_segment_degeneration", "Adjacent-segment degeneration at [level] with disc-space height loss, marginal osteophytes and endplate sclerosis.", {
            impression: "Adjacent-segment degeneration at [level].",
          }),
        ],
      },
      {
        id: "po-alignment",
        label: "Post-operative alignment maintained",
        group: "Alignment",
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_postop_alignment", "Alignment is maintained across the instrumented segments at [level].", {
            view: "lateral",
            baselineReplaces: N.alignment,
          }),
        ],
      },
    ],
  },

  // ── 10. Dynamic instability (spec §9; library §10) ─────────────────────
  {
    id: "dynamic",
    label: "Dynamic",
    hint: "Flexion/extension only. CARE holds no instability threshold; the radiologist selects it.",
    tiles: [
      {
        id: "dy-translation-change",
        label: "Translation change (from the Measure panel)",
        group: "Motion",
        dynamicGate: true,
        requiresNumbering: true,
        atoms: [
          // The numbers and their provenance are produced by buildLsDynamicAtoms;
          // this tile only states that the paired positions were compared.
          ALIGN(
            "ls_dynamic_reviewed",
            "Paired neutral, flexion and extension radiographs were compared at [level]; measured translation and angulation are recorded with their provenance.",
          ),
        ],
      },
      {
        id: "dy-angulation-change",
        label: "Angular change (from the Measure panel)",
        group: "Motion",
        dynamicGate: true,
        requiresNumbering: true,
        atoms: [
          // One [deg] token cannot carry two different measurements; the panel
          // records the values, this tile records that the comparison was made.
          ALIGN(
            "ls_dynamic_angulation_reviewed",
            "Segmental angulation at [level] was compared between neutral, flexion and extension; the measured angular change is recorded with its provenance.",
          ),
        ],
      },
      {
        id: "dy-instability",
        label: "Instability (radiologist-selected)",
        group: "Interpretation",
        dynamicGate: true,
        requiresNumbering: true,
        criticalPattern: true,
        atoms: [
          ALIGN("ls_dynamic_instability", "The reporting radiologist interprets [level] as dynamically unstable on the paired flexion and extension radiographs.", {
            impression: "Dynamic instability at [level].",
            severity: "high",
          }),
        ],
      },
      {
        id: "dy-motion-limitation",
        label: "Limited segmental motion (selected)",
        group: "Interpretation",
        dynamicGate: true,
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_dynamic_motion_limitation", "Limited segmental motion at [level] is reported by the reporting radiologist on the paired positions.", {
            impression: "Limited motion at [level].",
          }),
        ],
      },
      {
        id: "dy-no-change",
        label: "No significant change between positions",
        group: "Motion",
        dynamicGate: true,
        requiresNumbering: true,
        atoms: [
          ALIGN("ls_dynamic_reassuring", "Translation and angulation do not change appreciably between neutral, flexion and extension at [level].", {
            impression: "No dynamic instability at [level].",
          }),
        ],
      },
      {
        id: "dy-not-performed",
        label: "Dynamic views not performed",
        group: "Coverage",
        atoms: [
          ALIGN(
            "ls_dynamic_not_performed",
            "Flexion and extension views were not performed; dynamic instability cannot be assessed on these neutral radiographs.",
            { anatomicalSection: "technique / views" },
          ),
        ],
      },
    ],
  },

  // ── 11. Sacroiliac / associated (spec §13; library §13) ────────────────
  {
    id: "sacroiliac",
    label: "Sacroiliac",
    hint: "Gross findings only — nonspecific sclerosis is never called sacroiliitis.",
    tiles: [
      {
        id: "si-preserved",
        label: "SI joints preserved",
        group: "Sacroiliac joints",
        requiresSiJoints: true,
        atoms: [
          SI("ls_si_joints", N.siPreserved, { view: "ap", role: "baseline", baselineReplaces: "" }),
        ],
      },
      {
        id: "si-sclerosis",
        label: "SI sclerosis (nonspecific)",
        group: "Sacroiliac joints",
        requiresSiJoints: true,
        requiresAdequate: ["siJointVisualization"],
        atoms: [
          SI("ls_si_sclerosis", "Periarticular sclerosis of the [side] sacroiliac joint.", {
            impression: "Nonspecific [side] sacroiliac sclerosis.",
            view: "ap",
          }),
        ],
      },
      {
        id: "si-narrowing",
        label: "SI joint-space narrowing",
        group: "Sacroiliac joints",
        requiresSiJoints: true,
        requiresAdequate: ["siJointVisualization"],
        atoms: [
          SI("ls_si_narrowing", "Narrowing of the [side] sacroiliac joint.", {
            impression: "[Side] sacroiliac joint narrowing.",
            view: "ap",
          }),
        ],
      },
      {
        id: "si-irregularity",
        label: "SI joint irregularity",
        group: "Sacroiliac joints",
        requiresSiJoints: true,
        requiresAdequate: ["siJointVisualization"],
        atoms: [
          SI("ls_si_irregularity", "Irregularity of the [side] sacroiliac joint surface.", {
            impression: "[Side] sacroiliac joint irregularity.",
            view: "ap",
          }),
        ],
      },
      {
        id: "si-ankylosis",
        label: "SI ankylosis / fusion",
        group: "Sacroiliac joints",
        requiresSiJoints: true,
        requiresAdequate: ["siJointVisualization"],
        atoms: [
          SI("ls_si_ankylosis", "Apparent ankylosis of the [side] sacroiliac joint.", {
            impression: "[Side] sacroiliac ankylosis.",
            severity: "moderate",
            view: "ap",
          }),
        ],
      },
      {
        id: "si-asymmetric",
        label: "Asymmetric SI abnormality",
        group: "Sacroiliac joints",
        requiresSiJoints: true,
        requiresAdequate: ["siJointVisualization"],
        atoms: [
          SI("ls_si_asymmetric", "Asymmetric appearance of the sacroiliac joints, more abnormal on the [side].", {
            impression: "Asymmetric sacroiliac joint appearance.",
            view: "ap",
          }),
        ],
      },
      {
        id: "si-inflammation-disclaimer",
        label: "No automatic inflammatory label",
        group: "Disclaimers",
        atoms: [
          SI(
            "ls_si_disclaimer",
            "Nonspecific sacroiliac sclerosis or irregularity is not labelled as inflammatory sacroiliitis or axial spondyloarthritis; MRI and clinical assessment are required if inflammatory disease is suspected.",
            { impression: "No inflammatory sacroiliitis diagnosed from these radiographs." },
          ),
        ],
      },
      {
        id: "si-not-assessed",
        label: "SI joints not assessed",
        group: "Coverage",
        atoms: [
          SI("ls_si_joints", LS_SI_SENTENCES.notAssessed, {
            conflictGroup: "ls_si_joints",
          }),
        ],
      },
      {
        id: "si-sacrum",
        label: "Sacrum / sacral ala abnormality",
        group: "Sacrum",
        requiresJunction: true,
        atoms: [
          BODY("ls_sacrum_lesion", "Abnormality of the sacral ala/sacral body at [level], better characterized on CT.", {
            impression: "Sacral abnormality.",
          }),
        ],
      },
    ],
  },

  // ── 12. More / advanced (spec §3) ──────────────────────────────────────
  {
    id: "advanced",
    label: "More / advanced",
    hint: "Rare and pattern-level observations, kept descriptive.",
    tiles: [
      {
        id: "ad-dish",
        label: "Flowing anterior ossification",
        group: "Hyperostotic",
        advanced: true,
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          BODY("ls_flowing_ossification", "Flowing anterior ossification across at least four contiguous vertebral bodies with preserved disc height, a hyperostotic pattern.", {
            baselineReplaces: N.vertebrae,
            impression: "Flowing anterior ossification, hyperostotic pattern.",
            view: "lateral",
          }),
        ],
      },
      {
        id: "ad-calcific-tendon",
        label: "Enthesophyte / tendinous calcification",
        group: "Soft tissues",
        advanced: true,
        atoms: [
          SOFT("ls_enthesophyte", "Calcification at the [side] iliac crest/spinal enthesesis, an enthesophyte.", {
            supportsLaterality: true,
            impression: "Enthesopathic calcification.",
          }),
        ],
      },
      {
        id: "ad-post-radiation",
        label: "Post-radiation change",
        group: "Other",
        advanced: true,
        requiresNumbering: true,
        atoms: [
          BODY("ls_post_radiation", "Mixed sclerosis with vertebral body squareness and endplate change in a distribution consistent with prior irradiation at [level].", {
            impression: "Post-radiation osseous change at [level].",
          }),
        ],
      },
      {
        id: "ad-gas",
        label: "Gas within the spinal canal / foramen",
        group: "Other",
        advanced: true,
        requiresAdequate: ["posteriorElementVisualization"],
        atoms: [
          POST("ls_canal_gas", "Tubular gas projected over the spinal canal at [level]. This is a radiographic observation; canal contents cannot be assessed on plain films.", {
            impression: "Gas projected over the canal at [level].",
          }),
        ],
      },
      {
        id: "ad-ligament-ossification",
        label: "Ligamentous ossification",
        group: "Other",
        advanced: true,
        requires: ["lateral"],
        requiresNumbering: true,
        atoms: [
          POST("ls_ligament_ossification", "Linear ossification along the posterior element line at [level], suggesting ligamentous ossification. Thecal compression cannot be assessed radiographically.", {
            impression: "Posterior ligamentous ossification at [level].",
          }),
        ],
      },
      {
        id: "ad-diffuse-sclerosis",
        label: "Diffuse sclerosis of the lumbar spine",
        group: "Bone density",
        advanced: true,
        atoms: [
          BODY("ls_diffuse_sclerosis", "Diffuse increased density of the lumbar vertebrae.", {
            baselineReplaces: N.vertebrae,
            impression: "Diffuse vertebral sclerosis — correlation for a metabolic or myeloproliferative cause.",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "ad-broad-tp",
        label: "Broad / sacralized transverse process",
        group: "Transitional anatomy",
        advanced: true,
        requiresNumbering: true,
        atoms: [
          POST("ls_broad_transverse_process", "Broadened transverse process of [level] articulating with the sacrum.", {
            impression: "Broad transverse process at [level].",
          }),
        ],
      },
      {
        id: "ad-sacral-tract",
        label: "Spinal dysraphism-associated marker",
        group: "Posterior elements",
        advanced: true,
        requiresAdequate: ["posteriorElementVisualization"],
        atoms: [
          POST("ls_dysraphism_marker", "Posterior arch defect at [level] with an associated soft-tissue marker; spinal dysraphism requires MR assessment.", {
            impression: "Posterior arch defect at [level] with a soft-tissue marker.",
            recommendation: "MRI of the lumbosacral spine is recommended for suspected dysraphism.",
          }),
        ],
      },
      {
        id: "ad-not-assessed",
        label: "Canal / cauda / roots not assessable",
        group: "Disclaimers",
        atoms: [
          NUM(
            "ls_not_assessable",
            "The spinal canal, cauda equina, nerve roots and marrow signal cannot be assessed on plain radiographs.",
            { anatomicalSection: "other", impression: "MRI is required for canal, root or marrow assessment." },
          ),
        ],
      },
    ],
  },
];

/* ────────────────────────────── availability ───────────────────────────── */

export type LsAvailability = { ok: boolean; missing: string[]; reason?: string };

type LsGateContext = {
  ctx: XrayLsTechniqueContext;
  numbering?: LsNumbering | null;
};

function lsGate(
  req: LsGateRequirements,
  gate: LsGateContext,
  template: LsTemplateContext,
): LsAvailability {
  const ctx = gate.ctx;
  // A canvas that has not established numbering passes null, and null must fall
  // back to the unestablished record rather than satisfying a numbering gate.
  const numbering = gate.numbering ?? UNSET_LS_NUMBERING;
  const missing: string[] = [];

  for (const key of req.requires ?? []) {
    if (!ctx.performed[key]) missing.push(XRAY_LS_VIEW_LABELS[key]);
  }

  if (req.requiresAny?.length) {
    if (!req.requiresAny.some((k) => ctx.performed[k])) {
      missing.push(`one of ${req.requiresAny.map((k) => XRAY_LS_VIEW_LABELS[k]).join(" / ")}`);
    }
  }

  for (const key of req.requiresAdequate ?? []) {
    // Strict reading of the mandate: the dimension must be RECORDED AS ADEQUATE.
    // "unknown" is not sufficient for a tile that certifies an area the film may
    // not have shown, which is how an obscured pars defect stays undiagnosed.
    if (ctx.adequacy[key] !== "adequate") {
      missing.push(`${XRAY_LS_ADEQUACY_LABELS[key]} (not recorded as adequate)`);
    }
  }

  if (req.requiresNumbering && !lsNumberingIsEstablished(numbering)) {
    return {
      ok: false,
      missing: ["numbering basis (not established)"],
      reason:
        "Establish the numbering basis before naming a level. Lumbar segment labels depend on whether a transitional vertebra is present and which body is designated L5 (spec §4).",
    };
  }

  if (req.requiresJunction) {
    const gate5 = assessL5S1(ctx);
    if (!gate5.allowed) {
      return { ok: false, missing: ["lumbosacral junction coverage"], reason: gate5.reason };
    }
  }

  if (req.requiresT12L1) {
    const gateUp = assessT12L1(ctx);
    if (!gateUp.allowed) {
      return { ok: false, missing: ["T12-L1 inclusion"], reason: gateUp.reason };
    }
  }

  if (req.requiresSiJoints) {
    const gateSi = assessSiJoints(ctx);
    if (!gateSi.allowed) {
      return { ok: false, missing: ["AP projection for the sacroiliac joints"], reason: gateSi.reason };
    }
  }

  if (req.parsGate) {
    const gatePars = assessPars(ctx, { unilateral: req.parsGate === "unilateral" });
    if (!gatePars.allowed) {
      return {
        ok: false,
        missing: missingLsViewLabels(ctx, req.parsGate === "unilateral" ? ["obliqueRight", "obliqueLeft"] : ["lateral"]),
        reason: gatePars.reason,
      };
    }
  }

  if (req.foraminalGate) {
    const side = template.laterality ?? "bilateral";
    const gateForaminal = assessForaminal(ctx, side);
    if (!gateForaminal.allowed) {
      const needed: XrayLsViewKey[] =
        side === "bilateral"
          ? ["obliqueRight", "obliqueLeft"]
          : [side === "right" ? "obliqueRight" : "obliqueLeft"];
      return {
        ok: false,
        missing: missingLsViewLabels(ctx, needed),
        reason: gateForaminal.reason,
      };
    }
  }

  if (req.dynamicGate) {
    const gateDyn = assessDynamic(ctx);
    if (!gateDyn.allowed) {
      return { ok: false, missing: ["flexion and extension views"], reason: gateDyn.reason };
    }
  }

  return { ok: missing.length === 0, missing };
}

export function lsTileAvailability(
  tile: LsTile,
  ctx: XrayLsTechniqueContext,
  template: LsTemplateContext = {},
  numbering?: LsNumbering | null,
): LsAvailability {
  return lsGate(tile, { ctx, numbering }, template);
}

export function lsPresetAvailability(
  preset: LsPreset,
  ctx: XrayLsTechniqueContext,
  template: LsTemplateContext = {},
  numbering?: LsNumbering | null,
): LsAvailability {
  return lsGate(preset, { ctx, numbering }, template);
}

export function lsSubMasterById(id: string): LsSubMaster | undefined {
  return XRAY_LS_SUB_MASTERS.find((sm) => sm.id === id);
}

export function buildLsTilePatch(
  tile: LsTile,
  region = "Lumbar Spine",
  template: LsTemplateContext = {},
): { bundleId: string; observations: ReturnType<typeof lsAtomsToPatches> } {
  const bundleId = lsBundleId("tile", tile.id);
  return { bundleId, observations: lsAtomsToPatches(region, bundleId, tile.atoms, template) };
}

/* ──────────────────────────────── presets ──────────────────────────────── */

export type LsPresetContext = LsGateContext & {
  region?: string;
  laterality?: "right" | "left" | "bilateral" | null;
  level?: string | null;
  upperLevel?: string | null;
  lowerLevel?: string | null;
  mm?: string | null;
  percent?: string | null;
  degrees?: string | null;
  grade?: string | null;
  direction?: LsTemplateContext["direction"] | null;
};

export type LsPreset = LsGateRequirements & {
  id: string;
  label: string;
  subMasterId: LsSubMasterId;
  /** Matches a critical pattern of the seeded xr.lumbar_spine knowledge pack. */
  criticalPattern?: boolean;
  build: (ctx: LsPresetContext) => {
    bundleId: string;
    observations: ReturnType<typeof lsAtomsToPatches>;
  };
};

const presetTemplate = (ctx: LsPresetContext): LsTemplateContext => ({
  laterality: ctx.laterality ?? null,
  level: ctx.level ?? null,
  upperLevel: ctx.upperLevel ?? null,
  lowerLevel: ctx.lowerLevel ?? null,
  mm: ctx.mm ?? null,
  percent: ctx.percent ?? null,
  degrees: ctx.degrees ?? null,
  grade: ctx.grade ?? null,
  direction: ctx.direction ?? null,
});

const lsTilesFrom = (
  ...refs: Array<[LsSubMasterId, string]>
): LsAtomSpec[] => {
  const atoms: LsAtomSpec[] = [];
  for (const [sm, tileId] of refs) {
    const tile = lsSubMasterById(sm)?.tiles.find((t) => t.id === tileId);
    if (tile) atoms.push(...tile.atoms);
  }
  return atoms;
};

function lsPresetFromTiles(presetId: string, refs: Array<[LsSubMasterId, string]>) {
  return (ctx: LsPresetContext) => {
    const bundleId = lsBundleId("preset", presetId);
    return {
      bundleId,
      observations: lsAtomsToPatches(
        ctx.region ?? "Lumbar Spine",
        bundleId,
        lsTilesFrom(...refs),
        presetTemplate(ctx),
      ),
    };
  };
}

/**
 * Presets are the one-click clinical stories the palettes are made of. Normal
 * presets come first, then the critical patterns, so the canvas can offer the
 * commonest action before the rarest (spec §6, §19).
 */
export const XRAY_LS_PRESETS: readonly LsPreset[] = [
  {
    id: "ls-normal",
    label: "Normal lumbosacral spine",
    subMasterId: "routine",
    build: (ctx) =>
      buildLsNormalAtoms({
        region: ctx.region ?? "Lumbar Spine",
        ctx: ctx.ctx,
        numbering: ctx.numbering ?? UNSET_LS_NUMBERING,
      }),
  },
  {
    id: "ls-normal-concise",
    label: "Normal study (core lines only)",
    subMasterId: "routine",
    requires: ["lateral"],
    requiresJunction: true,
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-normal-concise", [
      ["routine", "rt-numbering-standard"],
      ["routine", "rt-alignment"],
      ["routine", "rt-vertebrae"],
      ["routine", "rt-no-fracture"],
      ["routine", "rt-discs"],
      ["routine", "rt-posterior"],
      ["routine", "rt-si-preserved"],
      ["routine", "rt-no-hardware"],
    ]),
  },
  {
    id: "ls-degenerative-multilevel",
    label: "Multilevel lumbar spondylosis",
    subMasterId: "degenerative",
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-degenerative-multilevel", [
      ["degenerative", "dg-multilevel"],
      ["degenerative", "dg-facet"],
    ]),
  },
  {
    id: "ls-degenerative-with-listhesis",
    label: "Spondylosis with degenerative listhesis",
    subMasterId: "degenerative",
    requires: ["lateral"],
    requiresJunction: true,
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-degenerative-with-listhesis", [
      ["degenerative", "dg-multilevel"],
      ["listhesis", "ls-degenerative-listhesis"],
    ]),
  },
  {
    id: "ls-anterolisthesis-measured",
    label: "Anterolisthesis with measured slip",
    subMasterId: "listhesis",
    requires: ["lateral"],
    requiresJunction: true,
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-anterolisthesis-measured", [
      ["listhesis", "ls-listhesis-measured"],
    ]),
  },
  {
    id: "ls-isthmic-spondylolisthesis",
    label: "Isthmic spondylolisthesis",
    subMasterId: "listhesis",
    requires: ["lateral"],
    parsGate: "any",
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-isthmic-spondylolisthesis", [
      ["listhesis", "ls-isthmic"],
    ]),
  },
  {
    id: "ls-pars-defect-bilateral",
    label: "Bilateral pars defect",
    subMasterId: "listhesis",
    parsGate: "any",
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-pars-defect-bilateral", [["listhesis", "ls-pars-defect"]]),
  },
  {
    id: "ls-pars-defect-unilateral",
    label: "Unilateral pars defect (oblique)",
    subMasterId: "listhesis",
    parsGate: "unilateral",
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-pars-defect-unilateral", [
      ["listhesis", "ls-pars-defect-unilateral"],
    ]),
  },
  {
    id: "ls-pars-equivocal",
    label: "Equivocal pars lucency",
    subMasterId: "listhesis",
    requiresAny: ["lateral", "obliqueRight", "obliqueLeft"],
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-pars-equivocal", [["listhesis", "ls-pars-equivocal"]]),
  },
  {
    id: "ls-compression-fracture",
    label: "Compression fracture with height loss",
    subMasterId: "trauma",
    requires: ["lateral"],
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-compression-fracture", [["trauma", "tr-compression"]]),
  },
  {
    id: "ls-burst-fracture",
    label: "Burst-pattern fracture (critical)",
    subMasterId: "trauma",
    requires: ["lateral", "ap"],
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-burst-fracture", [["trauma", "tr-burst-suspicion"]]),
  },
  {
    id: "ls-fracture-dislocation",
    label: "Fracture-dislocation (critical)",
    subMasterId: "trauma",
    requires: ["lateral", "ap"],
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-fracture-dislocation", [["trauma", "tr-fracture-dislocation"]]),
  },
  {
    id: "ls-retropulsion",
    label: "Retropulsed fragment (critical)",
    subMasterId: "trauma",
    requires: ["lateral"],
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-retropulsion", [
      ["trauma", "tr-burst-suspicion"],
      ["trauma", "tr-retropulsion"],
    ]),
  },
  {
    id: "ls-scoliosis-cobb",
    label: "Scoliosis with measured Cobb angle",
    subMasterId: "deformity",
    requires: ["ap"],
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-scoliosis-cobb", [
      ["deformity", "df-dextro"],
      ["deformity", "df-cobb"],
      ["deformity", "df-rotation"],
    ]),
  },
  {
    id: "ls-transitional-castellvi",
    label: "Transitional vertebra with Castellvi type",
    subMasterId: "transitional",
    requiresJunction: true,
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-transitional-castellvi", [
      ["transitional", "tr-pseudoarticulation"],
      ["transitional", "tr-castellvi"],
    ]),
  },
  {
    id: "ls-sacralization",
    label: "Sacralization of the lowest lumbar vertebra",
    subMasterId: "transitional",
    requiresJunction: true,
    build: lsPresetFromTiles("ls-sacralization", [["transitional", "tr-sacralization"]]),
  },
  {
    id: "ls-lumbarization",
    label: "Lumbarization of S1",
    subMasterId: "transitional",
    requiresJunction: true,
    build: lsPresetFromTiles("ls-lumbarization", [["transitional", "tr-lumbarization"]]),
  },
  {
    id: "ls-destructive-disc",
    label: "Destructive disc / endplate pattern (critical)",
    subMasterId: "infection",
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-destructive-disc", [
      ["infection", "in-disc-endplate"],
      ["infection", "in-etiology-disclaimer"],
    ]),
  },
  {
    id: "ls-multifocal-lesions",
    label: "Multifocal osseous lesions (critical)",
    subMasterId: "tumor",
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-multifocal-lesions", [
      ["tumor", "tu-multifocal"],
      ["tumor", "tu-etiology-disclaimer"],
    ]),
  },
  {
    id: "ls-pathologic-fracture",
    label: "Pathological fracture (critical)",
    subMasterId: "tumor",
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-pathologic-fracture", [
      ["tumor", "tu-pathologic-fracture"],
      ["tumor", "tu-etiology-disclaimer"],
    ]),
  },
  {
    id: "ls-postop-intact",
    label: "Posterior instrumentation, intact",
    subMasterId: "postoperative",
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-postop-intact", [
      ["postoperative", "po-instrumentation-intact"],
      ["postoperative", "po-alignment"],
    ]),
  },
  {
    id: "ls-postop-failure",
    label: "Hardware failure (critical)",
    subMasterId: "postoperative",
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-postop-failure", [["postoperative", "po-breakage"]]),
  },
  {
    id: "ls-postop-loosening",
    label: "Convincing perihardware lucency (critical)",
    subMasterId: "postoperative",
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-postop-loosening", [["postoperative", "po-lucency-convincing"]]),
  },
  {
    id: "ls-dynamic-instability",
    label: "Dynamic instability, radiologist-selected (critical)",
    subMasterId: "dynamic",
    dynamicGate: true,
    requiresNumbering: true,
    criticalPattern: true,
    build: lsPresetFromTiles("ls-dynamic-instability", [
      ["dynamic", "dy-translation-change"],
      ["dynamic", "dy-instability"],
    ]),
  },
  {
    id: "ls-dynamic-reassuring",
    label: "No significant change on flexion / extension",
    subMasterId: "dynamic",
    dynamicGate: true,
    requiresNumbering: true,
    build: lsPresetFromTiles("ls-dynamic-reassuring", [["dynamic", "dy-no-change"]]),
  },
  {
    id: "ls-si-degenerative",
    label: "Sacroiliac degenerative change",
    subMasterId: "sacroiliac",
    requiresSiJoints: true,
    requiresAdequate: ["siJointVisualization"],
    build: lsPresetFromTiles("ls-si-degenerative", [
      ["sacroiliac", "si-sclerosis"],
      ["sacroiliac", "si-narrowing"],
      ["sacroiliac", "si-inflammation-disclaimer"],
    ]),
  },
  {
    id: "ls-coverage-limited",
    label: "Limited study: junction obscured",
    subMasterId: "routine",
    build: lsPresetFromTiles("ls-coverage-limited", [
      ["routine", "rt-coverage-l5s1"],
      ["routine", "rt-coverage-bowel"],
      ["routine", "rt-no-hardware"],
    ]),
  },
];

export function lsPresetById(id: string): LsPreset | undefined {
  return XRAY_LS_PRESETS.find((p) => p.id === id);
}

/** Tiles whose wording matches a seeded xr.lumbar_spine critical finding. */
export function lsCriticalTileIds(): string[] {
  const ids: string[] = [];
  for (const sm of XRAY_LS_SUB_MASTERS) {
    for (const tile of sm.tiles) if (tile.criticalPattern) ids.push(tile.id);
  }
  return ids;
}

export function lsPresetIsCritical(preset: LsPreset): boolean {
  return Boolean(preset.criticalPattern);
}

export function lsSectionOrder(section: string | null | undefined): number {
  const index = LS_FINDINGS_SECTIONS.indexOf(
    (section ?? "") as (typeof LS_FINDINGS_SECTIONS)[number],
  );
  return index < 0 ? LS_FINDINGS_SECTIONS.length : index;
}

export function isLsSectionName(section: string | null | undefined): boolean {
  return (LS_FINDINGS_SECTIONS as readonly string[]).includes(section ?? "");
}
