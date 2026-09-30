/**
 * xrayChestLesions.ts — nodule / mass characterization on radiography (spec §10).
 *
 * Deliberately descriptive. Radiography cannot establish benignity, so nothing
 * here emits "benign", "malignant", "likely neoplastic" or a follow-up interval:
 * the impression line is the canonical library wording and the CT
 * recommendation is a radiologist-selected option, never automatic.
 *
 * Localisation is stored only as far as a plain film supports it: side, zone
 * (or lobe where the film shows it), and a measurement when one was taken.
 *
 * Pure functions only — no store, no React.
 */
import { chestAtomsToPatches, chestBundleId, type ChestAtomSpec } from "./xrayChestAtoms";
import type { IntervalChange } from "./radiologyComparison";

export type ChestZone =
  | "apex"
  | "upper zone"
  | "mid zone"
  | "lower zone"
  | "base"
  | "periphery"
  | "hilum"
  | "right upper lobe"
  | "right middle lobe"
  | "right lower lobe"
  | "left upper lobe"
  | "lingula"
  | "left lower lobe";

export type ChestLesionAppearance =
  | "rounded"
  | "irregular"
  | "mass-like"
  | "nodular"
  | "cavitary";

export type ChestLesionMargins = "well-defined" | "ill-defined" | "lobulated";

export type ChestLesionInput = {
  laterality: "right" | "left";
  zone?: ChestZone | null;
  /** mm when small, cm when large — the unit is carried with the value. */
  sizeMm?: number | null;
  appearance?: ChestLesionAppearance | null;
  margins?: ChestLesionMargins | null;
  calcified?: boolean;
  multiple?: boolean;
  /** Interval change — only settable when a prior study is actually referenced. */
  comparison?: IntervalChange | null;
  /** Radiologist-selected, never inferred. */
  recommendCt?: boolean;
  region?: string;
  bundleId?: string;
};

export function formatLesionSize(sizeMm: number | null | undefined): string | null {
  if (sizeMm === null || sizeMm === undefined || !Number.isFinite(sizeMm) || sizeMm <= 0) return null;
  if (sizeMm >= 30) return `${(sizeMm / 10).toFixed(1)} cm`;
  return `${Math.round(sizeMm)} mm`;
}

export function composeLesionSentence(lesion: ChestLesionInput): string {
  const parts: string[] = [];
  const appearance = lesion.multiple ? "multiple" : lesion.appearance ?? "rounded";
  const noun =
    lesion.appearance === "mass-like" || (lesion.sizeMm && lesion.sizeMm >= 30)
      ? "mass-like opacity"
      : lesion.multiple
        ? "pulmonary nodules"
        : "pulmonary nodule";

  parts.push(`${appearance[0].toUpperCase()}${appearance.slice(1)} ${noun}`);
  const size = formatLesionSize(lesion.sizeMm);
  if (size) parts.push(`measuring approximately ${size}`);
  if (lesion.margins) parts.push(`${lesion.margins} margins`);
  if (lesion.calcified) parts.push("with visible calcification");

  const where = lesion.zone
    ? `in the ${lesion.laterality} ${lesion.zone}`
    : `in the ${lesion.laterality} lung`;
  return `${parts.join(", ")} ${where}.`;
}

/**
 * Canonical library impression (§11 / §20). Further characterisation is
 * "as selected by the radiologist" — the sentence itself makes no judgement.
 */
export const CHEST_LESION_IMPRESSION_LINE =
  "Pulmonary nodule/mass-like opacity requiring further characterization as selected by the radiologist.";

export function buildChestLesionAtoms(lesion: ChestLesionInput): {
  bundleId: string;
  observations: ReturnType<typeof chestAtomsToPatches>;
} {
  const region = lesion.region ?? "Chest";
  const bundleId = lesion.bundleId ?? chestBundleId("lesion", `${lesion.laterality}-${lesion.zone ?? "lung"}`);

  const atoms: ChestAtomSpec[] = [
    {
      concept: lesion.multiple ? "pulmonary_nodules" : "pulmonary_nodule",
      conflictGroup: "pulmonary_nodule",
      anatomicalSection: "lung",
      findings: composeLesionSentence(lesion),
      impression: CHEST_LESION_IMPRESSION_LINE,
      laterality: lesion.laterality,
      level: lesion.zone ?? undefined,
      measurement: formatLesionSize(lesion.sizeMm) ?? undefined,
      state: lesion.calcified ? "calcified" : lesion.appearance ?? undefined,
      supportsLaterality: true,
    },
  ];

  if (lesion.recommendCt) {
    atoms.push({
      concept: "ct_recommendation",
      conflictGroup: "ct_recommendation",
      anatomicalSection: "recommendation",
      findings: "",
      recommendation: "CT correlation is recommended for further characterization of the opacity.",
    });
  }

  return { bundleId, observations: chestAtomsToPatches(region, bundleId, atoms) };
}

/**
 * Opacity findings that a "lungs are clear" baseline cannot coexist with
 * (spec §5 reconciliation, §17 validation).
 */
export const CHEST_FOCAL_OPACITY_RE =
  /\b(focal|lobar|segmental|airspace|air-space|consolidation|mass|nodule|opacity|opacification|cavitary|cavitation|reticulonodular|interstitial|ground[- ]glass|honeycomb)\b/i;
