/**
 * xrayChestSubMasters.ts — the X-ray Chest clinical sub-master catalog.
 *
 * One observation model, sixteen palettes (spec §3). This file is CONTENT: it
 * compiles tiles into ledger atoms and never touches state, exactly like
 * mriBrainSubMasters.ts. The store remains the single reconciler.
 *
 * Rules encoded here:
 *  - tiles that need a projection are gated by xrayChestViews (`requires`) and
 *    by recorded technique adequacy (`requiresAdequate`) — an AP film cannot
 *    support a cardiac-size tile, a film without a lateral cannot support a
 *    retrosternal-space tile (spec §2);
 *  - abnormal atoms reuse the baseline normal concepts / `baselineReplaces`
 *    sentences from xrayChestNormalAtoms, so "lungs clear" reconciles instead of
 *    contradicting "consolidation" (spec §5);
 *  - descriptive language stays descriptive: TB-pattern, COPD, edema and
 *    malignancy labels are never asserted by a tile — the radiologist selects
 *    them (spec §6, §7, §9, §10, §12);
 *  - clinical thresholds live in xrayChestMeasures.ts, not here (spec §11);
 *  - comparison atoms require a dated prior and are built in
 *    xrayChestComparison.ts (spec §15).
 */
import {
  chestAtom,
  chestAtomsToPatches,
  chestBundleId,
  type ChestAtomSpec,
  type ChestTemplateContext,
} from "./xrayChestAtoms";
import {
  buildChestNormalAtoms,
  CHEST_NORMAL_SENTENCES,
} from "./xrayChestNormalAtoms";
import type { XrayAdequacyKey, XrayTechniqueContext, XrayViewKey } from "./xrayChestViews";
import { XRAY_ADEQUACY_LABELS, XRAY_VIEW_LABELS } from "./xrayChestViews";

const N = CHEST_NORMAL_SENTENCES;

export type ChestTile = {
  id: string;
  label: string;
  group: string;
  /** Hidden behind "More / advanced" inside the palette. */
  advanced?: boolean;
  /** Projections that must be performed for this tile to be usable. */
  requires?: XrayViewKey[];
  /** Adequacy dimensions that must not be recorded as "limited". */
  requiresAdequate?: XrayAdequacyKey[];
  /** Adult-only wording (e.g. involution / emphysema patterns). */
  adultOnly?: boolean;
  /** Only offered on pediatric studies. */
  pediatricOnly?: boolean;
  /** Matches the canonical library's critical-pattern list (§19). */
  criticalPattern?: boolean;
  atoms: ChestAtomSpec[];
};

export type ChestSubMasterId =
  | "routine"
  | "infection"
  | "tb"
  | "edema"
  | "pleural"
  | "pneumothorax"
  | "collapse"
  | "copd"
  | "ild"
  | "nodule"
  | "trauma"
  | "cardiac"
  | "pediatric"
  | "icu"
  | "postop"
  | "advanced";

export type ChestSubMaster = {
  id: ChestSubMasterId;
  label: string;
  hint: string;
  tiles: ChestTile[];
};

export const CHEST_SUBMASTER_IDS: ChestSubMasterId[] = [
  "routine",
  "infection",
  "tb",
  "edema",
  "pleural",
  "pneumothorax",
  "collapse",
  "copd",
  "ild",
  "nodule",
  "trauma",
  "cardiac",
  "pediatric",
  "icu",
  "postop",
  "advanced",
];

/** A lung observation always supersedes the "clear lungs" baseline sentence. */
const LUNG = (findings: string, extra: Partial<ChestAtomSpec> = {}): ChestAtomSpec =>
  chestAtom(extra.concept ?? "air_space_opacity", findings, {
    ...extra,
    conflictGroup: extra.conflictGroup ?? "lung_opacity",
    anatomicalSection: extra.anatomicalSection ?? "lung",
    baselineReplaces: extra.baselineReplaces ?? N.lungsClear,
  });

const PLEURAL = (concept: string, findings: string, extra: Partial<ChestAtomSpec> = {}): ChestAtomSpec =>
  chestAtom(concept, findings, {
    conflictGroup: extra.conflictGroup ?? "pleural_abnormality",
    anatomicalSection: "pleura",
    baselineReplaces: extra.baselineReplaces ?? N.pleura,
    ...extra,
  });

const CARDIAC = (concept: string, findings: string, extra: Partial<ChestAtomSpec> = {}): ChestAtomSpec =>
  chestAtom(concept, findings, {
    conflictGroup: extra.conflictGroup ?? "cardiac_size",
    anatomicalSection: "cardiac silhouette",
    baselineReplaces: extra.baselineReplaces ?? N.cardiacNormal,
    ...extra,
  });

const BONE = (concept: string, findings: string, extra: Partial<ChestAtomSpec> = {}): ChestAtomSpec =>
  chestAtom(concept, findings, {
    conflictGroup: extra.conflictGroup ?? "osseous_abnormality",
    anatomicalSection: "bones",
    baselineReplaces: extra.baselineReplaces ?? N.bones,
    ...extra,
  });

export const XRAY_CHEST_SUB_MASTERS: readonly ChestSubMaster[] = [
  // ── 1. Routine / Normal ────────────────────────────────────────────────
  {
    id: "routine",
    label: "Routine",
    hint: "Shared chest core — the structures every film comments on.",
    tiles: [
      {
        id: "rt-airways",
        label: "Trachea / central airways",
        group: "Core",
        atoms: [chestAtom("trachea", "Trachea is central.", { anatomicalSection: "central airways" })],
      },
      {
        id: "rt-tracheal-deviation",
        label: "Tracheal deviation",
        group: "Core",
        atoms: [
          LUNG("Trachea is deviated to the [side].", {
            concept: "tracheal_deviation",
            conflictGroup: "tracheal_deviation",
            anatomicalSection: "central airways",
            baselineReplaces: N.trachea,
          }),
        ],
      },
      {
        id: "rt-lungs-clear",
        label: "Lungs clear",
        group: "Core",
        atoms: [chestAtom("lung_fields", N.lungsClear, { role: "baseline", anatomicalSection: "lung" })],
      },
      {
        id: "rt-vasculature",
        label: "Vascular markings normal",
        group: "Core",
        atoms: [
          chestAtom("pulmonary_vasculature", N.vasculature, {
            role: "baseline",
            anatomicalSection: "pulmonary vasculature",
          }),
        ],
      },
      {
        id: "rt-hila",
        label: "Hila normal",
        group: "Core",
        atoms: [
          chestAtom("hila", N.hila, { role: "baseline", anatomicalSection: "hila" }),
        ],
      },
      {
        id: "rt-angles-clear",
        label: "Costophrenic angles clear",
        group: "Core",
        requiresAdequate: ["fieldInclusion"],
        atoms: [
          chestAtom("costophrenic_angles", N.costophrenic, {
            role: "baseline",
            anatomicalSection: "pleura",
            baselineReplaces: "",
          }),
        ],
      },
      {
        id: "rt-bones",
        label: "No acute bony abnormality",
        group: "Core",
        atoms: [
          chestAtom("osseous_structures", N.bones, { role: "baseline", anatomicalSection: "bones" }),
        ],
      },
      {
        id: "rt-soft-tissues",
        label: "Soft tissues unremarkable",
        group: "Core",
        atoms: [
          chestAtom("soft_tissues", N.softTissues, { role: "baseline", anatomicalSection: "soft tissues" }),
        ],
      },
      {
        id: "rt-upper-abdomen",
        label: "Visible upper abdomen unremarkable",
        group: "Core",
        atoms: [
          chestAtom("upper_abdomen", N.upperAbdomen, { role: "baseline", anatomicalSection: "upper abdomen" }),
        ],
      },
      {
        id: "rt-clinic-normal-line",
        label: "Normal impression (clinic wording)",
        group: "Core",
        advanced: true,
        atoms: [
          chestAtom("chest_normal_impression", "", {
            conflictGroup: "chest_normal_impression",
            anatomicalSection: "impression",
            impression: "No active cardiopulmonary abnormality identified on this radiograph.",
            role: "baseline",
          }),
        ],
      },
    ],
  },

  // ── 2. Infection / Pneumonia ───────────────────────────────────────────
  {
    id: "infection",
    label: "Infection",
    hint: "Air-space and infective patterns. No microbiologic label is asserted.",
    tiles: [
      {
        id: "in-focal",
        label: "Focal air-space opacity",
        group: "Air-space",
        atoms: [
          LUNG("Focal air-space opacity involving the [side] [zone].", {
            concept: "air_space_opacity",
            impression: "Focal [side] [zone] air-space opacity/consolidation.",
            level: "upper zone",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "in-multifocal",
        label: "Multifocal opacity",
        group: "Air-space",
        atoms: [
          LUNG("Multifocal air-space opacities involving both lung fields.", {
            concept: "multifocal_opacity",
            conflictGroup: "lung_opacity",
            impression: "Multifocal air-space opacities, infective/inflammatory pattern in the appropriate clinical setting.",
            laterality: "bilateral",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "in-consolidation",
        label: "Lobar/segmental consolidation",
        group: "Air-space",
        atoms: [
          LUNG("Lobar/segmental consolidation involving the [side] [zone].", {
            concept: "consolidation",
            impression: "Consolidation in the [side] [zone], suspicious for infective change in the appropriate clinical setting.",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "in-air-bronchogram",
        label: "Air bronchograms",
        group: "Air-space",
        atoms: [
          LUNG("Air bronchograms are seen within the area of consolidation.", {
            concept: "air_bronchogram",
            conflictGroup: "lung_opacity",
          }),
        ],
      },
      {
        id: "in-peribronchial",
        label: "Patchy peribronchial opacities",
        group: "Air-space",
        atoms: [
          LUNG("Patchy peribronchial air-space opacities.", { concept: "peribronchial_opacity" }),
        ],
      },
      {
        id: "in-cavitation",
        label: "Cavitary change",
        group: "Air-space",
        atoms: [
          LUNG("Cavitary change within an area of consolidation.", {
            concept: "cavitation",
            impression: "Cavitary change within an area of consolidation.",
          }),
        ],
      },
      {
        id: "in-associated-effusion",
        label: "Associated pleural effusion",
        group: "Associated findings",
        atoms: [
          PLEURAL("pleural_effusion", "Associated [side] pleural effusion.", {
            impression: "Associated [side] pleural effusion.",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "in-no-etiology",
        label: "No etiology asserted (reminder)",
        group: "Safety",
        advanced: true,
        atoms: [
          chestAtom("infection_disclaimer", "", {
            conflictGroup: "infection_disclaimer",
            anatomicalSection: "recommendation",
            recommendation:
              "Microbiologic etiology cannot be assigned from radiography alone; correlate clinically and with microbiology where indicated.",
          }),
        ],
      },
    ],
  },

  // ── 3. TB pattern ──────────────────────────────────────────────────────
  {
    id: "tb",
    label: "TB pattern",
    hint: "Descriptive pattern only. Active tuberculosis is a radiologist selection.",
    tiles: [
      {
        id: "tb-upper-zone",
        label: "Upper-zone heterogeneous opacity",
        group: "Pattern",
        atoms: [
          LUNG("Upper-zone predominant heterogeneous opacity on the [side].", {
            concept: "upper_zone_opacity",
            impression: "Upper-zone predominant heterogeneous opacity, pattern requiring clinical correlation.",
            level: "upper zone",
          }),
        ],
      },
      {
        id: "tb-fibro-cavitary",
        label: "Fibro-cavitary change",
        group: "Pattern",
        atoms: [
          LUNG("Fibro-cavitary change in the upper zone on the [side].", {
            concept: "fibro_cavitary_change",
            impression: "Fibro-cavitary change in the [side] upper zone.",
            level: "upper zone",
          }),
        ],
      },
      {
        id: "tb-apical-cap",
        label: "Apical pleuroparenchymal thickening",
        group: "Pattern",
        atoms: [
          LUNG("Apical pleuroparenchymal thickening on the [side].", {
            concept: "apical_pleural_thickening",
            conflictGroup: "pleural_abnormality",
            anatomicalSection: "pleura",
            baselineReplaces: N.pleura,
            level: "apex",
          }),
        ],
      },
      {
        id: "tb-volume-loss",
        label: "Volume loss with hilar elevation",
        group: "Pattern",
        atoms: [
          LUNG("Volume loss with elevation of the ipsilateral hilum.", {
            concept: "volume_loss_hilar_elevation",
            conflictGroup: "volume_loss",
            level: "upper zone",
          }),
        ],
      },
      {
        id: "tb-granuloma",
        label: "Calcified granuloma",
        group: "Pattern",
        atoms: [
          LUNG("Calcified granuloma in the [side] lung.", {
            concept: "calcified_granuloma",
            impression: "Calcified granuloma, healed granulomatous change.",
          }),
        ],
      },
      {
        id: "tb-miliary",
        label: "Miliary-pattern nodules",
        group: "Pattern",
        criticalPattern: true,
        atoms: [
          LUNG("Miliary-pattern innumerable tiny nodules distributed through both lung fields.", {
            concept: "miliary_nodules",
            conflictGroup: "lung_opacity",
            impression: "Miliary-pattern nodular opacities bilaterally.",
            laterality: "bilateral",
            severity: "severe",
          }),
        ],
      },
      {
        id: "tb-nodes",
        label: "Hilar/mediastinal nodal enlargement pattern",
        group: "Pattern",
        requiresAdequate: ["rotation"],
        atoms: [
          chestAtom("mediastinal_lymphadenopathy", "Hilar and mediastinal lymph-node enlargement pattern, where visible.", {
            conflictGroup: "hilar_abnormality",
            anatomicalSection: "hila",
            baselineReplaces: N.hila,
            impression: "Hilar/mediastinal lymph-node enlargement pattern.",
          }),
        ],
      },
      {
        id: "tb-not-active",
        label: "Do not assert active TB (reminder)",
        group: "Safety",
        advanced: true,
        atoms: [
          chestAtom("tb_disclaimer", "", {
            conflictGroup: "tb_disclaimer",
            anatomicalSection: "impression",
            impression:
              "Imaging pattern described. Active tuberculosis is NOT asserted by this report and requires radiologist selection with clinical and microbiological correlation.",
          }),
        ],
      },
    ],
  },

  // ── 4. Edema / cardiac failure pattern ─────────────────────────────────
  {
    id: "edema",
    label: "Edema",
    hint: "Vascular redistribution and interstitial/air-space edema patterns.",
    tiles: [
      {
        id: "ed-redistribution",
        label: "Vascular redistribution / congestion",
        group: "Vessels",
        atoms: [
          chestAtom("pulmonary_vascular_redistribution", "Pulmonary vascular redistribution/congestion.", {
            conflictGroup: "pulmonary_vascularity",
            anatomicalSection: "pulmonary vasculature",
            baselineReplaces: N.vasculature,
            impression: "Pulmonary vascular congestion.",
          }),
        ],
      },
      {
        id: "ed-interstitial",
        label: "Interstitial oedema",
        group: "Parenchyma",
        atoms: [
          LUNG("Bilateral perihilar interstitial opacities with septal/interstitial lines.", {
            concept: "interstitial_edema",
            conflictGroup: "lung_opacity",
            impression: "Bilateral pulmonary interstitial oedema pattern.",
            laterality: "bilateral",
          }),
        ],
      },
      {
        id: "ed-air-space",
        label: "Air-space oedema",
        group: "Parenchyma",
        criticalPattern: true,
        atoms: [
          LUNG("Bilateral perihilar air-space opacities in a batwing distribution.", {
            concept: "air_space_edema",
            conflictGroup: "lung_opacity",
            impression: "Bilateral pulmonary air-space oedema pattern.",
            laterality: "bilateral",
            severity: "severe",
          }),
        ],
      },
      {
        id: "ed-cuffing",
        label: "Peribronchial cuffing",
        group: "Parenchyma",
        requiresAdequate: ["motion"],
        atoms: [
          LUNG("Peribronchial cuffing.", { concept: "peribronchial_cuffing", conflictGroup: "lung_opacity" }),
        ],
      },
      {
        id: "ed-effusions",
        label: "Bilateral pleural effusions",
        group: "Pleura",
        atoms: [
          PLEURAL("pleural_effusion", "Bilateral pleural effusions.", {
            impression: "Bilateral pleural effusions.",
            laterality: "bilateral",
          }),
        ],
      },
      {
        id: "ed-cardiomegaly",
        label: "Cardiomegaly (PA only)",
        group: "Cardiac",
        requires: ["pa"],
        atoms: [
          CARDIAC("cardiomegaly", "Cardiac silhouette is enlarged.", {
            impression: "Cardiomegaly.",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "ed-not-heart-failure",
        label: "Do not infer cardiac failure (reminder)",
        group: "Safety",
        advanced: true,
        atoms: [
          chestAtom("edema_disclaimer", "", {
            conflictGroup: "edema_disclaimer",
            anatomicalSection: "impression",
            impression:
              "Radiographic features of pulmonary vascular/interstitial oedema. Cardiac failure is not inferred from a single nonspecific opacity and requires clinical correlation.",
          }),
        ],
      },
    ],
  },

  // ── 5. Pleural disease ─────────────────────────────────────────────────
  {
    id: "pleural",
    label: "Pleura",
    hint: "Effusion, loculation, thickening and calcification.",
    tiles: [
      {
        id: "pl-blunting",
        label: "Angle blunting",
        group: "Effusion",
        requiresAdequate: ["fieldInclusion"],
        atoms: [
          PLEURAL("pleural_effusion", "Blunting of [side] costophrenic angle.", {
            conflictGroup: "pleural_effusion",
            impression: "[Side] pleural effusion (small).",
            severity: "mild",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pl-small",
        label: "Small effusion",
        group: "Effusion",
        atoms: [
          PLEURAL("pleural_effusion", "Small [side] pleural effusion.", {
            conflictGroup: "pleural_effusion",
            impression: "[Side] pleural effusion.",
            severity: "mild",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pl-moderate",
        label: "Moderate effusion",
        group: "Effusion",
        atoms: [
          PLEURAL("pleural_effusion", "Moderate [side] pleural effusion.", {
            conflictGroup: "pleural_effusion",
            impression: "[Side] pleural effusion (moderate).",
            severity: "moderate",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pl-large",
        label: "Large effusion",
        group: "Effusion",
        criticalPattern: true,
        atoms: [
          PLEURAL("pleural_effusion", "Large [side] pleural effusion with contralateral mediastinal shift.", {
            conflictGroup: "pleural_effusion",
            impression: "Large [side] pleural effusion with major mass effect.",
            severity: "severe",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pl-loculated",
        label: "Loculated collection",
        group: "Effusion",
        atoms: [
          PLEURAL("loculated_effusion", "Loculated pleural opacity on the [side].", {
            conflictGroup: "pleural_abnormality",
            impression: "Loculated [side] pleural collection.",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pl-thickening",
        label: "Pleural thickening",
        group: "Pleural surface",
        atoms: [
          PLEURAL("pleural_thickening", "Pleural thickening on the [side].", {
            conflictGroup: "pleural_abnormality",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pl-calcification",
        label: "Pleural calcification",
        group: "Pleural surface",
        atoms: [
          PLEURAL("pleural_calcification", "Pleural calcification on the [side].", {
            conflictGroup: "pleural_abnormality",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pl-hydropneumothorax",
        label: "Hydropneumothorax",
        group: "Pleural surface",
        criticalPattern: true,
        atoms: [
          PLEURAL("hydropneumothorax", "Hydropneumothorax with an air-fluid level on the [side].", {
            conflictGroup: "pneumothorax",
            impression: "[Side] hydropneumothorax.",
            severity: "severe",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
    ],
  },

  // ── 6. Pneumothorax ────────────────────────────────────────────────────
  {
    id: "pneumothorax",
    label: "Pneumothorax",
    hint: "Size and side. Tension is a pattern of signs, never a size threshold.",
    tiles: [
      {
        id: "pt-line",
        label: "Visceral pleural line",
        group: "Pneumothorax",
        atoms: [
          chestAtom("pneumothorax", "Visceral pleural line with absent peripheral lung markings on the [side].", {
            conflictGroup: "pneumothorax",
            anatomicalSection: "pleura",
            baselineReplaces: N.pleura,
            impression: "[Side] pneumothorax.",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pt-small",
        label: "Small pneumothorax",
        group: "Pneumothorax",
        atoms: [
          chestAtom("pneumothorax", "Small [side] pneumothorax.", {
            conflictGroup: "pneumothorax",
            anatomicalSection: "pleura",
            baselineReplaces: N.pleura,
            impression: "Small [side] pneumothorax.",
            severity: "mild",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pt-large",
        label: "Large / new pneumothorax",
        group: "Pneumothorax",
        criticalPattern: true,
        atoms: [
          chestAtom("pneumothorax", "Large [side] pneumothorax with associated partial lung collapse.", {
            conflictGroup: "pneumothorax",
            anatomicalSection: "pleura",
            baselineReplaces: N.pleura,
            impression: "Large [side] pneumothorax.",
            severity: "severe",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pt-tension-signs",
        label: "Tension-pattern signs",
        group: "Pneumothorax",
        criticalPattern: true,
        atoms: [
          chestAtom("tension_pattern_signs", "Mediastinal shift away from the affected side with depression of the hemidiaphragm, raising concern for tension physiology in the appropriate clinical setting.", {
            conflictGroup: "pneumothorax",
            anatomicalSection: "pleura",
            baselineReplaces: N.pleura,
            impression:
              "Pneumothorax with tension-pattern radiographic signs; tension physiology to be correlated clinically.",
            severity: "severe",
          }),
        ],
      },
      {
        id: "pt-not-by-size",
        label: "Tension is not size-derived (reminder)",
        group: "Safety",
        advanced: true,
        atoms: [
          chestAtom("pneumothorax_disclaimer", "", {
            conflictGroup: "pneumothorax_disclaimer",
            anatomicalSection: "impression",
            impression:
              "Tension pneumothorax is not labelled from size alone; it requires radiographic signs and clinical context selected by the radiologist.",
          }),
        ],
      },
    ],
  },

  // ── 7. Collapse / atelectasis ──────────────────────────────────────────
  {
    id: "collapse",
    label: "Collapse",
    hint: "Volume-loss signs. Lobar collapse and atelectasis remain descriptive.",
    tiles: [
      {
        id: "co-linear",
        label: "Linear / subsegmental band",
        group: "Volume loss",
        atoms: [
          LUNG("Linear subsegmental atelectatic band in the [side] [zone].", {
            concept: "atelectasis",
            conflictGroup: "volume_loss",
            impression: "Subsegmental atelectatic change.",
          }),
        ],
      },
      {
        id: "co-lobar",
        label: "Lobar/segmental volume loss",
        group: "Volume loss",
        atoms: [
          LUNG("Lobar/segmental volume loss on the [side].", {
            concept: "lobar_collapse",
            conflictGroup: "volume_loss",
            impression: "Collapse/atelectatic change on the [side].",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "co-diaphragm",
        label: "Elevated hemidiaphragm",
        group: "Volume loss",
        atoms: [
          chestAtom("elevated_hemidiaphragm", "Elevated [side] hemidiaphragm.", {
            conflictGroup: "diaphragm_abnormality",
            anatomicalSection: "diaphragm",
            baselineReplaces: N.diaphragm,
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "co-fissure",
        label: "Fissural displacement",
        group: "Volume loss",
        atoms: [
          LUNG("Fissural displacement consistent with volume loss.", {
            concept: "fissural_displacement",
            conflictGroup: "volume_loss",
          }),
        ],
      },
      {
        id: "co-shift",
        label: "Shift toward volume loss",
        group: "Volume loss",
        requiresAdequate: ["rotation"],
        atoms: [
          chestAtom("ipsilateral_shift", "Hilar and mediastinal shift toward the side of volume loss.", {
            conflictGroup: "volume_loss",
            anatomicalSection: "mediastinum",
            baselineReplaces: N.mediastinum,
            impression: "Volume loss with ipsilateral mediastinal shift.",
          }),
        ],
      },
      {
        id: "co-compensatory",
        label: "Compensatory hyperinflation",
        group: "Volume loss",
        atoms: [
          LUNG("Compensatory hyperinflation of the adjacent lung.", {
            concept: "compensatory_hyperinflation",
            conflictGroup: "lung_volume",
          }),
        ],
      },
    ],
  },

  // ── 8. COPD / emphysema ────────────────────────────────────────────────
  {
    id: "copd",
    label: "COPD",
    hint: "Hyperinflation and emphysematous change; COPD is not diagnosed from one sign.",
    tiles: [
      {
        id: "cp-hyperinflation",
        label: "Hyperinflated lungs",
        group: "Hyperinflation",
        requiresAdequate: ["inspiration"],
        adultOnly: true,
        atoms: [
          chestAtom("hyperinflation", "Hyperinflated lungs.", {
            conflictGroup: "lung_volume",
            anatomicalSection: "lung",
            baselineReplaces: N.expansion,
            impression: "Hyperinflation.",
          }),
        ],
      },
      {
        id: "cp-flat-diaphragm",
        label: "Flattened diaphragms",
        group: "Hyperinflation",
        requiresAdequate: ["inspiration"],
        atoms: [
          chestAtom("flattened_diaphragms", "Flattened diaphragms.", {
            conflictGroup: "diaphragm_abnormality",
            anatomicalSection: "diaphragm",
            baselineReplaces: N.diaphragm,
          }),
        ],
      },
      {
        id: "cp-retrosternal",
        label: "Increased retrosternal space (lateral)",
        group: "Hyperinflation",
        requires: ["lateral"],
        advanced: true,
        atoms: [
          chestAtom("retrosternal_clear_space_increased", "Increased retrosternal clear space on the lateral projection.", {
            conflictGroup: "lung_volume",
            anatomicalSection: "mediastinum",
          }),
        ],
      },
      {
        id: "cp-attenuated",
        label: "Attenuated peripheral markings",
        group: "Hyperinflation",
        requiresAdequate: ["motion"],
        atoms: [
          chestAtom("attenuated_vascular_markings", "Attenuated peripheral vascular markings.", {
            conflictGroup: "pulmonary_vascularity",
            anatomicalSection: "pulmonary vasculature",
            baselineReplaces: N.vasculature,
          }),
        ],
      },
      {
        id: "cp-bullae",
        label: "Bullous change",
        group: "Hyperinflation",
        atoms: [
          LUNG("Bullous change in the [side] upper zone.", {
            concept: "bullae",
            conflictGroup: "lung_lucency",
            level: "upper zone",
          }),
        ],
      },
      {
        id: "cp-bronchitic",
        label: "Chronic bronchitic markings",
        group: "Hyperinflation",
        adultOnly: true,
        atoms: [
          LUNG("Increased bronchovascular markings, chronic bronchitic pattern.", {
            concept: "chronic_bronchitic_markings",
            conflictGroup: "lung_opacity",
          }),
        ],
      },
      {
        id: "cp-not-copd",
        label: "Hyperinflation alone is not COPD (reminder)",
        group: "Safety",
        advanced: true,
        atoms: [
          chestAtom("copd_disclaimer", "", {
            conflictGroup: "copd_disclaimer",
            anatomicalSection: "impression",
            impression:
              "Hyperinflation/emphysematous change described. Chronic obstructive pulmonary disease is not diagnosed from hyperinflation alone and requires clinical correlation.",
          }),
        ],
      },
    ],
  },

  // ── 9. ILD / diffuse lung disease ──────────────────────────────────────
  {
    id: "ild",
    label: "ILD",
    hint: "Diffuse interstitial patterns; CT characterisation remains a selection.",
    tiles: [
      {
        id: "il-reticular",
        label: "Reticular / reticulonodular",
        group: "Interstitial",
        requiresAdequate: ["motion"],
        atoms: [
          LUNG("Bilateral reticular/reticulonodular interstitial opacities.", {
            concept: "interstitial_opacity",
            conflictGroup: "lung_opacity",
            impression: "Bilateral diffuse interstitial pulmonary opacities.",
            laterality: "bilateral",
          }),
        ],
      },
      {
        id: "il-predominance",
        label: "Predominance pattern",
        group: "Interstitial",
        atoms: [
          LUNG("Interstitial opacities with peripheral and lower-zone predominance.", {
            concept: "interstitial_predominance",
            conflictGroup: "lung_opacity",
            level: "lower zone",
          }),
        ],
      },
      {
        id: "il-low-volume",
        label: "Reduced lung volumes",
        group: "Interstitial",
        requiresAdequate: ["inspiration"],
        atoms: [
          chestAtom("reduced_lung_volumes", "Reduced lung volumes.", {
            conflictGroup: "lung_volume",
            anatomicalSection: "lung",
            baselineReplaces: N.expansion,
          }),
        ],
      },
      {
        id: "il-fibrosis",
        label: "Coarse fibrotic change",
        group: "Interstitial",
        atoms: [
          LUNG("Coarse fibrotic change with volume loss in the [side] lung.", {
            concept: "fibrosis",
            conflictGroup: "lung_opacity",
          }),
        ],
      },
      {
        id: "il-honeycomb",
        label: "Honeycomb-pattern lucencies",
        group: "Interstitial",
        advanced: true,
        requiresAdequate: ["motion"],
        atoms: [
          LUNG("Honeycomb-pattern lucencies, where radiographically evident.", {
            concept: "honeycombing",
            conflictGroup: "lung_lucency",
          }),
        ],
      },
      {
        id: "il-ct",
        label: "CT characterisation (selected)",
        group: "Recommendation",
        advanced: true,
        atoms: [
          chestAtom("ct_recommendation", "", {
            conflictGroup: "ct_recommendation",
            anatomicalSection: "recommendation",
            recommendation:
              "Radiography suggests diffuse interstitial lung disease; HRCT correlation may be selected for characterisation.",
          }),
        ],
      },
    ],
  },

  // ── 10. Nodule / mass ──────────────────────────────────────────────────
  {
    id: "nodule",
    label: "Nodule / Mass",
    hint: "Descriptive lesion characterisation. No benign or malignant label.",
    tiles: [
      {
        id: "no-solitary",
        label: "Solitary nodule",
        group: "Lesion",
        atoms: [
          LUNG("Solitary rounded pulmonary nodule in the [side] [zone].", {
            concept: "pulmonary_nodule",
            conflictGroup: "pulmonary_nodule",
            impression: "Pulmonary nodule/mass-like opacity requiring further characterization as selected by the radiologist.",
          }),
        ],
      },
      {
        id: "no-multiple",
        label: "Multiple nodules",
        group: "Lesion",
        atoms: [
          LUNG("Multiple pulmonary nodules of varying size through both lung fields.", {
            concept: "pulmonary_nodules",
            conflictGroup: "pulmonary_nodule",
            impression: "Multiple pulmonary nodules requiring further characterization as selected by the radiologist.",
            laterality: "bilateral",
          }),
        ],
      },
      {
        id: "no-mass",
        label: "Mass-like opacity",
        group: "Lesion",
        atoms: [
          LUNG("Mass-like opacity measuring approximately [size] in the [side] [zone].", {
            concept: "mass_like_opacity",
            conflictGroup: "pulmonary_nodule",
            impression: "Mass-like pulmonary opacity requiring further characterization as selected by the radiologist.",
          }),
        ],
      },
      {
        id: "no-calcified",
        label: "Visible calcification",
        group: "Lesion",
        atoms: [
          LUNG("Calcification is visible within the lesion.", {
            concept: "lesion_calcification",
            conflictGroup: "pulmonary_nodule",
          }),
        ],
      },
      {
        id: "no-ct",
        label: "CT correlation (selected)",
        group: "Recommendation",
        atoms: [
          chestAtom("ct_recommendation", "", {
            conflictGroup: "ct_recommendation",
            anatomicalSection: "recommendation",
            recommendation: "CT correlation may be selected for further characterization.",
          }),
        ],
      },
    ],
  },

  // ── 11. Trauma ─────────────────────────────────────────────────────────
  {
    id: "trauma",
    label: "Trauma",
    hint: "Acute traumatic signs. A normal film does not exclude occult injury.",
    tiles: [
      {
        id: "tr-rib",
        label: "Rib fracture",
        group: "Chest wall",
        atoms: [
          BONE("rib_fracture", "Rib fracture, [side] [level], where visible.", {
            conflictGroup: "fracture",
            impression: "Rib fracture, [side].",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "tr-clavicle",
        label: "Clavicular fracture",
        group: "Chest wall",
        atoms: [
          BONE("clavicle_fracture", "Clavicular fracture on the [side].", {
            conflictGroup: "fracture",
            impression: "Clavicular fracture.",
          }),
        ],
      },
      {
        id: "tr-pneumothorax",
        label: "Pneumothorax pattern",
        group: "Pleura",
        criticalPattern: true,
        atoms: [
          chestAtom("pneumothorax", "[Side] pneumothorax in the trauma setting.", {
            conflictGroup: "pneumothorax",
            anatomicalSection: "pleura",
            baselineReplaces: N.pleura,
            impression: "Traumatic [side] pneumothorax.",
            severity: "severe",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "tr-hemothorax",
        label: "Hemothorax pattern",
        group: "Pleura",
        criticalPattern: true,
        atoms: [
          PLEURAL("hemothorax", "Pleural fluid-density collection on the [side], haemothorax pattern in the trauma setting.", {
            conflictGroup: "pleural_effusion",
            impression: "[Side] haemothorax pattern.",
            severity: "severe",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "tr-contusion",
        label: "Pulmonary contusion pattern",
        group: "Parenchyma",
        atoms: [
          LUNG("Non-segmental air-space opacity underlying the site of impact, contusion pattern.", {
            concept: "pulmonary_contusion",
            conflictGroup: "lung_opacity",
            impression: "Pulmonary contusion pattern.",
          }),
        ],
      },
      {
        id: "tr-emphysema",
        label: "Subcutaneous emphysema",
        group: "Chest wall",
        criticalPattern: true,
        atoms: [
          chestAtom("subcutaneous_emphysema", "Subcutaneous emphysema in the [side] chest wall.", {
            conflictGroup: "soft_tissue_abnormality",
            anatomicalSection: "soft tissues",
            baselineReplaces: N.softTissues,
            impression: "Subcutaneous emphysema.",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "tr-mediastinum",
        label: "Mediastinal widening",
        group: "Mediastinum",
        criticalPattern: true,
        requiresAdequate: ["rotation"],
        atoms: [
          chestAtom("mediastinal_widening", "Mediastinal widening.", {
            conflictGroup: "mediastinal_abnormality",
            anatomicalSection: "mediastinum",
            baselineReplaces: N.mediastinum,
            impression: "Mediastinal widening.",
            severity: "severe",
          }),
        ],
      },
      {
        id: "tr-not-exclusion",
        label: "Normal film does not exclude injury (reminder)",
        group: "Safety",
        atoms: [
          chestAtom("trauma_disclaimer", "", {
            conflictGroup: "trauma_disclaimer",
            anatomicalSection: "impression",
            impression:
              "A normal chest radiograph does not exclude occult thoracic injury; clinical and imaging follow-up as indicated.",
          }),
        ],
      },
    ],
  },

  // ── 12. Cardiac / mediastinal ──────────────────────────────────────────
  {
    id: "cardiac",
    label: "Cardiac",
    hint: "Cardiomediastinal contour, aorta, hila and pulmonary arteries.",
    tiles: [
      {
        id: "ca-enlarged",
        label: "Cardiac silhouette enlarged (PA)",
        group: "Cardiac",
        requires: ["pa"],
        atoms: [
          CARDIAC("cardiomegaly", "Cardiac silhouette is enlarged for the projection.", {
            impression: "Cardiomegaly.",
            severity: "moderate",
          }),
        ],
      },
      {
        id: "ca-ap-cannot-assess",
        label: "Size not assessable (AP)",
        group: "Cardiac",
        requires: ["ap"],
        atoms: [
          CARDIAC("cardiac_size_not_assessed", "The cardiac silhouette cannot be assessed for size on this AP projection; AP magnification exaggerates heart size.", {
            conflictGroup: "cardiac_size",
            baselineReplaces: N.cardiacNormal,
          }),
        ],
      },
      {
        id: "ca-aorta",
        label: "Aortic unfolding / calcification",
        group: "Mediastinum",
        adultOnly: true,
        atoms: [
          chestAtom("aortic_calcification", "Aortic unfolding with atherosclerotic calcification.", {
            conflictGroup: "mediastinal_abnormality",
            anatomicalSection: "mediastinum",
            baselineReplaces: N.mediastinum,
          }),
        ],
      },
      {
        id: "ca-widening",
        label: "Mediastinal widening",
        group: "Mediastinum",
        requiresAdequate: ["rotation"],
        atoms: [
          chestAtom("mediastinal_widening", "Mediastinal widening.", {
            conflictGroup: "mediastinal_abnormality",
            anatomicalSection: "mediastinum",
            baselineReplaces: N.mediastinum,
            impression: "Mediastinal widening.",
          }),
        ],
      },
      {
        id: "ca-hilar",
        label: "Hilar prominence",
        group: "Hila",
        atoms: [
          chestAtom("hilar_prominence", "Hilar prominence on the [side].", {
            conflictGroup: "hilar_abnormality",
            anatomicalSection: "hila",
            baselineReplaces: N.hila,
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "ca-pa-prominence",
        label: "Pulmonary artery prominence",
        group: "Hila",
        atoms: [
          chestAtom("pulmonary_artery_prominence", "Prominent pulmonary arteries.", {
            conflictGroup: "pulmonary_vascularity",
            anatomicalSection: "pulmonary vasculature",
            baselineReplaces: N.vasculature,
          }),
        ],
      },
      {
        id: "ca-paratracheal",
        label: "Paratracheal opacity",
        group: "Mediastinum",
        atoms: [
          LUNG("[Side] paratracheal opacity.", {
            concept: "paratracheal_opacity",
            conflictGroup: "mediastinal_abnormality",
            anatomicalSection: "mediastinum",
            baselineReplaces: N.mediastinum,
          }),
        ],
      },
      {
        id: "ca-tracheal-deviation",
        label: "Tracheal deviation",
        group: "Airways",
        atoms: [
          chestAtom("tracheal_deviation", "Trachea is deviated toward the [side].", {
            conflictGroup: "tracheal_deviation",
            anatomicalSection: "central airways",
            baselineReplaces: N.trachea,
          }),
        ],
      },
    ],
  },

  // ── 13. Pediatric ──────────────────────────────────────────────────────
  {
    id: "pediatric",
    label: "Pediatric",
    hint: "Age and projection-aware paediatric observations.",
    tiles: [
      {
        id: "pd-expansion",
        label: "Lung expansion",
        group: "Pediatric",
        pediatricOnly: true,
        atoms: [
          chestAtom("lung_expansion", "Both lungs are adequately expanded.", {
            conflictGroup: "lung_volume",
            anatomicalSection: "lung",
            role: "baseline",
          }),
        ],
      },
      {
        id: "pd-peribronchial",
        label: "Perihilar / peribronchial markings",
        group: "Pediatric",
        pediatricOnly: true,
        atoms: [
          LUNG("Increased perihilar and peribronchial markings.", {
            concept: "peribronchial_markings",
            conflictGroup: "lung_opacity",
            laterality: "bilateral",
          }),
        ],
      },
      {
        id: "pd-focal",
        label: "Focal air-space opacity",
        group: "Pediatric",
        pediatricOnly: true,
        atoms: [
          LUNG("Focal air-space opacity in the [side] [zone].", {
            concept: "air_space_opacity",
            conflictGroup: "lung_opacity",
            impression: "Focal [side] [zone] air-space opacity/consolidation.",
          }),
        ],
      },
      {
        id: "pd-thymus",
        label: "Thymic contour (age-appropriate)",
        group: "Pediatric",
        pediatricOnly: true,
        advanced: true,
        atoms: [
          chestAtom("thymic_contour", "Thymic contour is present and age-appropriate.", {
            conflictGroup: "mediastinal_abnormality",
            anatomicalSection: "mediastinum",
            baselineReplaces: N.mediastinum,
          }),
        ],
      },
      {
        id: "pd-thymus-not-mass",
        label: "Thymus is not a mass (reminder)",
        group: "Safety",
        pediatricOnly: true,
        advanced: true,
        atoms: [
          chestAtom("thymic_disclaimer", "", {
            conflictGroup: "thymic_disclaimer",
            anatomicalSection: "impression",
            impression:
              "The normal thymic contour is not interpreted as a mediastinal mass in this age group.",
          }),
        ],
      },
      {
        id: "pd-pleural",
        label: "Pleural abnormality",
        group: "Pediatric",
        pediatricOnly: true,
        atoms: [
          PLEURAL("pleural_effusion", "[Side] pleural effusion.", {
            conflictGroup: "pleural_effusion",
            impression: "[Side] pleural effusion.",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "pd-cardiac",
        label: "Cardiomediastinal silhouette (age/projection)",
        group: "Pediatric",
        pediatricOnly: true,
        atoms: [
          CARDIAC("cardiomediastinal_age_appropriate", "Cardiomediastinal silhouette is appropriate for age and projection.", {
            conflictGroup: "cardiac_size",
          }),
        ],
      },
    ],
  },

  // ── 14. Post-procedure / ICU ───────────────────────────────────────────
  {
    id: "icu",
    label: "ICU / Lines",
    hint: "Compact palette for lines, tubes and devices at the bedside.",
    tiles: [
      {
        id: "ic-et-tube",
        label: "Endotracheal tube",
        group: "Airway",
        atoms: [
          chestAtom("et_tube_position", "Endotracheal tube in situ; the tip is not adequately visualised for positional assessment.", {
            conflictGroup: "et_tube_position",
            anatomicalSection: "lines and tubes",
            baselineReplaces: N.noDevices,
          }),
        ],
      },
      {
        id: "ic-enteric",
        label: "Enteric tube",
        group: "Airway",
        atoms: [
          chestAtom("enteric_tube_position", "Enteric tube coursing below the diaphragm; the distal tip is included.", {
            conflictGroup: "enteric_tube_position",
            anatomicalSection: "lines and tubes",
            baselineReplaces: N.noDevices,
          }),
        ],
      },
      {
        id: "ic-cvc",
        label: "Central line / PICC",
        group: "Vascular",
        atoms: [
          chestAtom("cvc_position", "Central venous catheter via the [side] approach; tip position requires the dedicated device form to be recorded.", {
            conflictGroup: "cvc_position",
            anatomicalSection: "lines and tubes",
            baselineReplaces: N.noDevices,
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "ic-drain",
        label: "Intercostal drain",
        group: "Vascular",
        criticalPattern: true,
        atoms: [
          chestAtom("chest_drain_position", "Intercostal drain in situ on the [side].", {
            conflictGroup: "chest_drain_position",
            anatomicalSection: "lines and tubes",
            baselineReplaces: N.noDevices,
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "ic-pleural-air",
        label: "Pleural air / fluid",
        group: "Pleura",
        atoms: [
          PLEURAL("pneumothorax", "Persistent [side] pneumothorax with drain in situ.", {
            conflictGroup: "pneumothorax",
            impression: "Persistent [side] pneumothorax with drain in situ.",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "ic-no-device-claim",
        label: "Never invent a tip distance (reminder)",
        group: "Safety",
        advanced: true,
        atoms: [
          chestAtom("device_disclaimer", "", {
            conflictGroup: "device_disclaimer",
            anatomicalSection: "impression",
            impression:
              "Device positions are recorded descriptively; tip distances are entered only when actually measured and vascular placement is not declared without adequate visualization.",
          }),
        ],
      },
    ],
  },

  // ── 15. Post-operative ─────────────────────────────────────────────────
  {
    id: "postop",
    label: "Post-op",
    hint: "Thoracic surgical change, hardware and interval comparison.",
    tiles: [
      {
        id: "po-sternotomy",
        label: "Post-sternotomy change",
        group: "Surgical",
        atoms: [
          chestAtom("sternotomy_change", "Post-sternotomy change with sternotomy wires in situ.", {
            conflictGroup: "post_surgical_change",
            anatomicalSection: "bones",
            baselineReplaces: N.bones,
          }),
        ],
      },
      {
        id: "po-wires-intact",
        label: "Sternotomy wires intact",
        group: "Surgical",
        atoms: [
          chestAtom("sternotomy_wires", "Sternotomy wires are intact and in expected alignment.", {
            conflictGroup: "sternotomy_wires",
            anatomicalSection: "lines and tubes",
            baselineReplaces: N.noDevices,
          }),
        ],
      },
      {
        id: "po-volume-loss",
        label: "Post-thoracic surgery volume loss",
        group: "Surgical",
        atoms: [
          LUNG("Post-surgical volume loss on the [side].", {
            concept: "postop_volume_loss",
            conflictGroup: "volume_loss",
            impression: "Post-surgical volume loss, [side].",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "po-clips",
        label: "Surgical clips / staples",
        group: "Surgical",
        atoms: [
          chestAtom("surgical_clips", "Surgical clips/staples in the [side] thorax.", {
            conflictGroup: "surgical_hardware_other",
            anatomicalSection: "lines and tubes",
            baselineReplaces: N.noDevices,
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "po-valve",
        label: "Prosthetic valve",
        group: "Surgical",
        atoms: [
          chestAtom("prosthetic_valve", "Prosthetic cardiac valve replacement device in situ.", {
            conflictGroup: "prosthetic_valve",
            anatomicalSection: "lines and tubes",
            baselineReplaces: N.noDevices,
          }),
        ],
      },
      {
        id: "po-air-fluid",
        label: "Pleural air / fluid post-op",
        group: "Pleura",
        atoms: [
          PLEURAL("hydropneumothorax", "Post-operative hydropneumothorax on the [side].", {
            conflictGroup: "pneumothorax",
            impression: "Post-operative [side] hydropneumothorax.",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
    ],
  },

  // ── 16. More / Advanced (diaphragm, upper abdomen, safety) ────────────────
  {
    id: "advanced",
    label: "More / Advanced",
    hint: "Diaphragm, upper abdomen, rare patterns and cross-cutting safety tiles.",
    tiles: [
      {
        id: "ad-free-air",
        label: "Subdiaphragmatic free gas",
        group: "Diaphragm",
        criticalPattern: true,
        requires: ["pa"],
        atoms: [
          chestAtom("pneumoperitoneum", "Subdiaphragmatic free gas is demonstrated beneath the [side] hemidiaphragm.", {
            conflictGroup: "free_air",
            anatomicalSection: "upper abdomen",
            baselineReplaces: N.noFreeAir,
            impression: "Subdiaphragmatic free gas — pneumoperitoneum.",
            severity: "severe",
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "ad-eventration",
        label: "Eventration pattern",
        group: "Diaphragm",
        advanced: true,
        atoms: [
          chestAtom("eventration", "Eventration pattern of the [side] hemidiaphragm.", {
            conflictGroup: "diaphragm_abnormality",
            anatomicalSection: "diaphragm",
            baselineReplaces: N.diaphragm,
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "ad-hiatus",
        label: "Hiatus hernia pattern",
        group: "Diaphragm",
        advanced: true,
        atoms: [
          chestAtom("hiatus_hernia", "Retrocardiac air-fluid level consistent with a hiatus hernia pattern.", {
            conflictGroup: "hiatus_hernia",
            anatomicalSection: "diaphragm",
            baselineReplaces: N.diaphragm,
            impression: "Hiatus hernia pattern.",
          }),
        ],
      },
      {
        id: "ad-elevated",
        label: "Elevated hemidiaphragm",
        group: "Diaphragm",
        atoms: [
          chestAtom("elevated_hemidiaphragm", "Elevated [side] hemidiaphragm.", {
            conflictGroup: "diaphragm_abnormality",
            anatomicalSection: "diaphragm",
            baselineReplaces: N.diaphragm,
            laterality: "right",
            supportsLaterality: true,
          }),
        ],
      },
      {
        id: "ad-technique-limitation",
        label: "State a technique limitation",
        group: "Technique",
        atoms: [
          chestAtom("technique_limitation", "Technical limitation materially affects interpretation as stated in the technique.", {
            conflictGroup: "technique_limitation",
            anatomicalSection: "technique",
          }),
        ],
      },
      {
        id: "ad-comparison-line",
        label: "Comparison with prior study",
        group: "Comparison",
        atoms: [
          chestAtom("comparison_reference", "Comparison made with a prior study dated [date].", {
            conflictGroup: "comparison_reference",
            anatomicalSection: "comparison",
          }),
        ],
      },
    ],
  },

];

export function chestSubMasterById(id: string): ChestSubMaster | undefined {
  return XRAY_CHEST_SUB_MASTERS.find((sm) => sm.id === id);
}

/**
 * Capability gate: a tile is offered only when every required projection was
 * performed and no required adequacy dimension is recorded as limited.
 */
export function tileAvailable(
  tile: ChestTile,
  ctx: XrayTechniqueContext,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const key of tile.requires ?? []) {
    if (!ctx.performed[key]) missing.push(XRAY_VIEW_LABELS[key]);
  }
  for (const key of tile.requiresAdequate ?? []) {
    if (ctx.adequacy[key] === "limited") missing.push(`${XRAY_ADEQUACY_LABELS[key]} (limited)`);
  }
  return { ok: missing.length === 0, missing };
}

export function buildTilePatch(
  tile: ChestTile,
  region = "Chest",
  template: ChestTemplateContext = {},
): { bundleId: string; observations: ReturnType<typeof chestAtomsToPatches> } {
  const bundleId = chestBundleId("tile", tile.id);
  return { bundleId, observations: chestAtomsToPatches(region, bundleId, tile.atoms, template) };
}

export type ChestPresetContext = {
  region?: string;
  ctx: XrayTechniqueContext;
  /** Fill-in values the radiologist actually chose; absent values stay tokens. */
  laterality?: "right" | "left" | "bilateral" | null;
  zone?: string | null;
  size?: string | null;
  level?: string | null;
  priorDate?: string | null;
};

export type ChestPreset = {
  id: string;
  label: string;
  subMasterId: ChestSubMasterId;
  /** Declared on the preset, not hard-coded in the UI (MRI Brain's wart). */
  requires?: XrayViewKey[];
  requiresAdequate?: XrayAdequacyKey[];
  criticalPattern?: boolean;
  build: (ctx: ChestPresetContext) => {
    bundleId: string;
    observations: ReturnType<typeof chestAtomsToPatches>;
  };
};

const templateFrom = (ctx: ChestPresetContext): ChestTemplateContext => ({
  laterality: ctx.laterality ?? null,
  zone: ctx.zone ?? null,
  size: ctx.size ?? null,
  level: ctx.level ?? null,
  priorDate: ctx.priorDate ?? null,
});

const tileAtoms = (subMasterId: ChestSubMasterId, tileId: string): ChestTile | undefined =>
  chestSubMasterById(subMasterId)?.tiles.find((t) => t.id === tileId);

function presetFromTiles(
  presetId: string,
  tileRefs: Array<[ChestSubMasterId, string]>,
) {
  return (ctx: ChestPresetContext) => {
    const region = ctx.region ?? "Chest";
    const bundleId = chestBundleId("preset", presetId);
    const atoms: ChestAtomSpec[] = [];
    for (const [sm, tile] of tileRefs) {
      const t = tileAtoms(sm, tile);
      if (t) atoms.push(...t.atoms);
    }
    return {
      bundleId,
      observations: chestAtomsToPatches(region, bundleId, atoms, templateFrom(ctx)),
    };
  };
}

export const XRAY_CHEST_PRESETS: readonly ChestPreset[] = [
  {
    id: "normal-chest-pa",
    label: "Normal chest (PA)",
    subMasterId: "routine",
    requires: ["pa"],
    // One-click Normal baseline (spec §5). The projection-aware sentence set
    // comes from xrayChestNormalAtoms, so a PA baseline never claims what an AP
    // film cannot support. The impression itself stays the platform's
    // system-owned normal line, which auto-yields to any abnormality.
    build: (ctx) =>
      buildChestNormalAtoms({
        region: ctx.region ?? "Chest",
        ctx: ctx.ctx,
        bundleId: chestBundleId("preset", "normal-chest-pa"),
      }),
  },
  {
    id: "normal-chest-ap",
    label: "Normal chest (AP / portable)",
    subMasterId: "routine",
    requires: ["ap"],
    build: (ctx) =>
      buildChestNormalAtoms({
        region: ctx.region ?? "Chest",
        ctx: ctx.ctx,
        bundleId: chestBundleId("preset", "normal-chest-ap"),
      }),
  },
  {
    id: "lobar-pneumonia",
    label: "Lobar pneumonia",
    subMasterId: "infection",
    build: presetFromTiles("lobar-pneumonia", [
      ["infection", "in-consolidation"],
      ["infection", "in-air-bronchogram"],
    ]),
  },
  {
    id: "multifocal-pneumonia-effusion",
    label: "Multifocal pneumonia + effusion",
    subMasterId: "infection",
    build: presetFromTiles("multifocal-pneumonia-effusion", [
      ["infection", "in-multifocal"],
      ["infection", "in-associated-effusion"],
    ]),
  },
  {
    id: "tb-fibro-cavitary",
    label: "Fibro-cavitary TB pattern",
    subMasterId: "tb",
    build: presetFromTiles("tb-fibro-cavitary", [
      ["tb", "tb-upper-zone"],
      ["tb", "tb-fibro-cavitary"],
      ["tb", "tb-volume-loss"],
    ]),
  },
  {
    id: "miliary-pattern",
    label: "Miliary pattern",
    subMasterId: "tb",
    criticalPattern: true,
    build: presetFromTiles("miliary-pattern", [["tb", "tb-miliary"]]),
  },
  {
    id: "pulmonary-edema",
    label: "Pulmonary oedema pattern",
    subMasterId: "edema",
    build: presetFromTiles("pulmonary-edema", [
      ["edema", "ed-redistribution"],
      ["edema", "ed-interstitial"],
      ["edema", "ed-effusions"],
    ]),
  },
  {
    id: "cardiomegaly-edema-pa",
    label: "Cardiomegaly + oedema (PA)",
    subMasterId: "edema",
    requires: ["pa"],
    build: presetFromTiles("cardiomegaly-edema-pa", [
      ["edema", "ed-cardiomegaly"],
      ["edema", "ed-redistribution"],
      ["edema", "ed-air-space"],
    ]),
  },
  {
    id: "moderate-effusion",
    label: "Moderate unilateral effusion",
    subMasterId: "pleural",
    build: presetFromTiles("moderate-effusion", [["pleural", "pl-moderate"]]),
  },
  {
    id: "large-effusion-mass-effect",
    label: "Large effusion with mass effect",
    subMasterId: "pleural",
    criticalPattern: true,
    build: presetFromTiles("large-effusion-mass-effect", [["pleural", "pl-large"]]),
  },
  {
    id: "small-pneumothorax",
    label: "Small pneumothorax",
    subMasterId: "pneumothorax",
    build: presetFromTiles("small-pneumothorax", [["pneumothorax", "pt-small"]]),
  },
  {
    id: "tension-pattern-pneumothorax",
    label: "Tension-pattern pneumothorax",
    subMasterId: "pneumothorax",
    criticalPattern: true,
    build: presetFromTiles("tension-pattern-pneumothorax", [
      ["pneumothorax", "pt-large"],
      ["pneumothorax", "pt-tension-signs"],
    ]),
  },
  {
    id: "lobar-collapse",
    label: "Lobar collapse",
    subMasterId: "collapse",
    build: presetFromTiles("lobar-collapse", [
      ["collapse", "co-lobar"],
      ["collapse", "co-diaphragm"],
      ["collapse", "co-fissure"],
    ]),
  },
  {
    id: "copd-hyperinflation",
    label: "Hyperinflation / emphysema",
    subMasterId: "copd",
    requiresAdequate: ["inspiration"],
    build: presetFromTiles("copd-hyperinflation", [
      ["copd", "cp-hyperinflation"],
      ["copd", "cp-flat-diaphragm"],
      ["copd", "cp-attenuated"],
    ]),
  },
  {
    id: "ild-diffuse",
    label: "Diffuse interstitial pattern",
    subMasterId: "ild",
    build: presetFromTiles("ild-diffuse", [
      ["ild", "il-reticular"],
      ["ild", "il-predominance"],
    ]),
  },
  {
    id: "solitary-nodule-ct",
    label: "Solitary nodule + CT selected",
    subMasterId: "nodule",
    build: presetFromTiles("solitary-nodule-ct", [
      ["nodule", "no-solitary"],
      ["nodule", "no-ct"],
    ]),
  },
  {
    id: "major-trauma",
    label: "Major traumatic abnormality",
    subMasterId: "trauma",
    criticalPattern: true,
    build: presetFromTiles("major-trauma", [
      ["trauma", "tr-pneumothorax"],
      ["trauma", "tr-rib"],
      ["trauma", "tr-emphysema"],
      ["trauma", "tr-not-exclusion"],
    ]),
  },
  {
    id: "pneumoperitoneum",
    label: "Subdiaphragmatic free gas",
    subMasterId: "advanced",
    requires: ["pa"],
    criticalPattern: true,
    build: presetFromTiles("pneumoperitoneum", [["advanced", "ad-free-air"]]),
  },
  {
    id: "icu-devices",
    label: "ICU device survey",
    subMasterId: "icu",
    build: presetFromTiles("icu-devices", [
      ["icu", "ic-et-tube"],
      ["icu", "ic-enteric"],
      ["icu", "ic-cvc"],
      ["icu", "ic-drain"],
    ]),
  },
  {
    id: "postop-sternotomy",
    label: "Post-sternotomy",
    subMasterId: "postop",
    build: presetFromTiles("postop-sternotomy", [
      ["postop", "po-sternotomy"],
      ["postop", "po-wires-intact"],
      ["postop", "po-clips"],
    ]),
  },
  {
    id: "pediatric-normal",
    label: "Normal paediatric chest",
    subMasterId: "pediatric",
    build: presetFromTiles("pediatric-normal", [
      ["pediatric", "pd-expansion"],
      ["pediatric", "pd-cardiac"],
      ["pediatric", "pd-thymus"],
    ]),
  },
];

export function chestPresetById(id: string): ChestPreset | undefined {
  return XRAY_CHEST_PRESETS.find((p) => p.id === id);
}

/**
 * Tiles and presets that map onto the canonical library's critical-pattern list
 * (§19). Surfaced to prompt the EXISTING CARE critical-result workflow — the
 * radiologist still marks and communicates; nothing here auto-flags, and no
 * recipient or time is ever fabricated (spec §18).
 */
export function chestCriticalTileIds(): string[] {
  return XRAY_CHEST_SUB_MASTERS.flatMap((sm) =>
    sm.tiles.filter((t) => t.criticalPattern).map((t) => t.id),
  );
}

export function chestPresetIsCritical(preset: ChestPreset): boolean {
  return Boolean(preset.criticalPattern);
}
