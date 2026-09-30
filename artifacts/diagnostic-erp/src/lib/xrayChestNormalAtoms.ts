/**
 * xrayChestNormalAtoms.ts — projection-aware NORMAL baseline (spec §5).
 *
 * Prose is taken from the canonical chest library
 * (docs/clinical-libraries/xray-chest-clinical-content-library.md §1–§2).
 * Every sentence here is also the `baselineReplaces` contract used by the
 * abnormal atoms in xrayChestSubMasters.ts, so the baseline text and the
 * supersession contract cannot drift apart.
 *
 * The baseline is aware of what the film can actually support: a normal
 * cardiac-size line is never emitted on an AP projection, and a clear
 * costophrenic-angle line is never emitted when the angles are not included.
 * A report must not claim a view was assessed when it was not (spec §2).
 *
 * Pure functions only — no store, no React.
 */
import {
  chestAtomsToPatches,
  chestBundleId,
  type ChestAtomSpec,
} from "./xrayChestAtoms";
import type { XrayTechniqueContext } from "./xrayChestViews";

export const CHEST_NORMAL_SENTENCES = {
  trachea: "Trachea is central.",
  cardiacNormal:
    "Cardiomediastinal silhouette is within normal limits for the projection.",
  cardiacNotAssessed:
    "The cardiac size cannot be accurately assessed on this AP projection.",
  lungsClear: "Bilateral lung fields are clear without focal air-space opacity.",
  expansion: "Both lungs are adequately expanded.",
  vasculature: "Pulmonary vascular markings are within normal limits.",
  hila: "Hila are not enlarged.",
  mediastinum: "Mediastinum is not widened.",
  costophrenic: "Costophrenic angles are clear.",
  pleura: "No pleural effusion or pneumothorax.",
  diaphragm: "Diaphragms are normal in position and contour.",
  upperAbdomen: "The visible upper abdomen is unremarkable.",
  noFreeAir: "No subdiaphragmatic free gas is demonstrated.",
  bones: "Visualized osseous structures show no acute abnormality.",
  softTissues: "Visualized soft tissues are unremarkable.",
  noDevices: "No lines, tubes or devices are identified.",
} as const;

export type ChestNormalConcept =
  | "trachea"
  | "cardiac_silhouette"
  | "lung_fields"
  | "lung_expansion"
  | "pulmonary_vasculature"
  | "hila"
  | "mediastinum"
  | "costophrenic_angles"
  | "pleura"
  | "diaphragm"
  | "upper_abdomen"
  | "subdiaphragmatic_free_air"
  | "osseous_structures"
  | "soft_tissues"
  | "lines_tubes_devices_absent";

const SECTION: Partial<Record<ChestNormalConcept, string>> = {
  trachea: "central airways",
  cardiac_silhouette: "cardiac silhouette",
  mediastinum: "mediastinum",
  hila: "hila",
  pulmonary_vasculature: "pulmonary vasculature",
  costophrenic_angles: "pleura",
  pleura: "pleura",
  diaphragm: "diaphragm",
  upper_abdomen: "upper abdomen",
  subdiaphragmatic_free_air: "upper abdomen",
  osseous_structures: "bones",
  soft_tissues: "soft tissues",
  lines_tubes_devices_absent: "lines and tubes",
};

export function buildChestNormalAtomSpecs(
  ctx: XrayTechniqueContext,
): ChestAtomSpec[] {
  const S = CHEST_NORMAL_SENTENCES;
  const atoms: ChestAtomSpec[] = [];

  const push = (concept: ChestNormalConcept, findings: string) => {
    atoms.push({
      concept,
      conflictGroup: concept,
      anatomicalSection: SECTION[concept] ?? "chest",
      findings,
      // Normal sentences are a materialized baseline, not abnormalities.
      role: "baseline",
    });
  };

  push("trachea", S.trachea);
  push("lung_fields", S.lungsClear);

  // A low-volume film cannot support an expansion claim (spec §1, §2).
  if (ctx.adequacy.inspiration !== "limited") {
    push("lung_expansion", S.expansion);
  }

  // Projection-aware cardiac interpretation — the core of spec §2 / §11.
  push(
    "cardiac_silhouette",
    ctx.performed.pa ? S.cardiacNormal : S.cardiacNotAssessed,
  );

  // Rotation invalidates mediastinal width and hilar symmetry claims.
  if (ctx.adequacy.rotation !== "limited") {
    push("mediastinum", S.mediastinum);
    push("hila", S.hila);
  }

  push("pulmonary_vasculature", S.vasculature);

  // Apices / angles off the film cannot be called clear.
  if (ctx.adequacy.fieldInclusion !== "limited") {
    push("costophrenic_angles", S.costophrenic);
  }

  push("pleura", S.pleura);
  push("diaphragm", S.diaphragm);
  push("upper_abdomen", S.upperAbdomen);
  push("subdiaphragmatic_free_air", S.noFreeAir);
  push("osseous_structures", S.bones);
  push("soft_tissues", S.softTissues);
  push("lines_tubes_devices_absent", S.noDevices);

  return atoms;
}

export function buildChestNormalAtoms(opts: {
  region?: string;
  ctx: XrayTechniqueContext;
  bundleId?: string;
}): { bundleId: string; observations: ReturnType<typeof chestAtomsToPatches> } {
  const region = opts.region ?? "Chest";
  const bundleId = opts.bundleId ?? chestBundleId("normal", "chest");
  return {
    bundleId,
    observations: chestAtomsToPatches(
      region,
      bundleId,
      buildChestNormalAtomSpecs(opts.ctx),
    ),
  };
}
