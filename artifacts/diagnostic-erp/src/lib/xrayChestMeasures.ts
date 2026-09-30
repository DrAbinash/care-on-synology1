/**
 * xrayChestMeasures.ts — every numeric chest threshold in one tested place.
 *
 * Convention inherited from the MRI Brain family: clinical thresholds live in
 * the tested module, never in the palette catalog or JSX
 * (see mriBrainSubMasters.ts header).
 *
 * Two safety rules shape this file:
 *  - a cardiothoracic ratio is only meaningful on a PA frontal film, so an AP
 *    measurement is reported as unassessable rather than as a number
 *    (spec §2, §11);
 *  - tension physiology is a pattern of signs plus clinical context, never a
 *    size threshold (spec §8).
 *
 * Pure functions only — no store, no React.
 */
import { chestAtomsToPatches, chestBundleId, type ChestAtomSpec } from "./xrayChestAtoms";

/** BTS-style visual estimation bands for a pneumothorax rim width. */
export const PNEUMOTHORAX_SMALL_MAX_CM = 1;
export const PNEUMOTHORAX_MODERATE_MAX_CM = 2;

/** Adult cardiothoracic ratio above which the silhouette is called enlarged. */
export const CARDIOTHORACIC_RATIO_UPPER_NORMAL = 0.5;

export type SizeBand = "small" | "moderate" | "large";

export function pneumothoraxBand(rimCm: number | null | undefined): SizeBand | null {
  if (rimCm === null || rimCm === undefined || !Number.isFinite(rimCm) || rimCm <= 0) return null;
  if (rimCm < PNEUMOTHORAX_SMALL_MAX_CM) return "small";
  if (rimCm <= PNEUMOTHORAX_MODERATE_MAX_CM) return "moderate";
  return "large";
}

export type EffusionSize = "small" | "moderate" | "large";

/**
 * Effusion size on a frontal film is a description of the meniscus, not a
 * volume. The band drives severity only.
 */
export function effusionSeverity(size: EffusionSize | null | undefined): string | undefined {
  if (size === "large") return "severe";
  if (size === "moderate") return "moderate";
  if (size === "small") return "mild";
  return undefined;
}

/**
 * Projection-gated cardiac size. Returns null when the film cannot support the
 * statement at all — the caller must then write the AP caveat instead.
 */
export function ctrIsEnlarged(
  ctr: number | null | undefined,
  paAvailable: boolean,
): boolean | null {
  if (!paAvailable) return null;
  if (ctr === null || ctr === undefined || !Number.isFinite(ctr) || ctr <= 0) return null;
  return ctr > CARDIOTHORACIC_RATIO_UPPER_NORMAL;
}

export type TensionSigns = {
  mediastinalShiftAway?: boolean;
  hemidiaphragmDepressed?: boolean;
  ribSpacingWidened?: boolean;
  contralateralCompression?: boolean;
};

/**
 * The radiographic pattern that may raise concern for tension. This is a
 * description of signs — it does NOT label the study "tension pneumothorax",
 * which stays a radiologist selection with clinical context (spec §8).
 */
export function tensionSignPresent(signs: TensionSigns): boolean {
  return Boolean(
    signs.mediastinalShiftAway
    || signs.hemidiaphragmDepressed
    || signs.ribSpacingWidened
    || signs.contralateralCompression,
  );
}

export function composePneumothoraxSentence(opts: {
  laterality: "right" | "left";
  rimCm?: number | null;
  band?: SizeBand | null;
}): string {
  const band = opts.band ?? pneumothoraxBand(opts.rimCm);
  const head = `Visceral pleural line with absent peripheral lung markings on the ${opts.laterality}`;
  if (!band) return `${head}.`;
  return `${head}; ${band} pneumothorax${opts.rimCm ? ` (rim approximately ${opts.rimCm} cm)` : ""}.`;
}

export function composeEffusionSentence(opts: {
  laterality: "right" | "left";
  size?: EffusionSize | null;
  loculated?: boolean;
}): string {
  const base = opts.size
    ? `${opts.size[0].toUpperCase()}${opts.size.slice(1)} ${opts.laterality} pleural effusion.`
    : `Blunting of ${opts.laterality} costophrenic angle.`;
  return opts.loculated ? `${base} Appears loculated.` : base;
}

export function composeCtrSentence(opts: {
  ctr: number | null | undefined;
  paAvailable: boolean;
}): string {
  if (!opts.paAvailable) {
    return "Allowing for AP projection and magnification, the cardiac silhouette cannot be accurately assessed.";
  }
  const enlarged = ctrIsEnlarged(opts.ctr, true);
  if (enlarged === null) return "Cardiac silhouette is within normal limits for projection.";
  return enlarged
    ? `Cardiac silhouette is enlarged; cardiothoracic ratio approximately ${opts.ctr}.`
    : `Cardiac silhouette is not enlarged; cardiothoracic ratio approximately ${opts.ctr}.`;
}

export type ChestMeasureInput = {
  region?: string;
  bundleId?: string;
  pneumothorax?: { laterality: "right" | "left"; rimCm?: number | null; band?: SizeBand | null } | null;
  effusion?: { laterality: "right" | "left"; size?: EffusionSize | null; loculated?: boolean } | null;
  ctr?: number | null;
  paAvailable?: boolean;
};

export function chestMeasuresHasContent(input: ChestMeasureInput): boolean {
  return Boolean(input.pneumothorax || input.effusion || (input.ctr && input.ctr > 0));
}

/**
 * Measurements materialize as ordinary ledger atoms carrying `measurement`, so
 * they participate in slot identity, provenance and undo like every other
 * observation.
 */
export function buildChestMeasureAtoms(input: ChestMeasureInput): {
  bundleId: string;
  observations: ReturnType<typeof chestAtomsToPatches>;
} {
  const region = input.region ?? "Chest";
  const bundleId = input.bundleId ?? chestBundleId("measures", "chest");
  const atoms: ChestAtomSpec[] = [];

  if (input.pneumothorax) {
    const band = input.pneumothorax.band ?? pneumothoraxBand(input.pneumothorax.rimCm);
    atoms.push({
      concept: "pneumothorax",
      conflictGroup: "pneumothorax",
      anatomicalSection: "pleura",
      findings: composePneumothoraxSentence({
        laterality: input.pneumothorax.laterality,
        rimCm: input.pneumothorax.rimCm,
        band,
      }),
      impression: `${input.pneumothorax.laterality[0].toUpperCase()}${input.pneumothorax.laterality.slice(1)} pneumothorax${band ? ` (${band})` : ""}.`,
      laterality: input.pneumothorax.laterality,
      severity: band === "large" ? "severe" : band === "moderate" ? "moderate" : "mild",
      measurement: input.pneumothorax.rimCm ? `rim ${input.pneumothorax.rimCm} cm` : undefined,
      supportsLaterality: true,
    });
  }

  if (input.effusion) {
    atoms.push({
      concept: "pleural_effusion",
      conflictGroup: "pleural_effusion",
      anatomicalSection: "pleura",
      findings: composeEffusionSentence({
        laterality: input.effusion.laterality,
        size: input.effusion.size,
        loculated: input.effusion.loculated,
      }),
      impression: `${input.effusion.laterality[0].toUpperCase()}${input.effusion.laterality.slice(1)} pleural effusion${input.effusion.size ? ` (${input.effusion.size})` : ""}.`,
      laterality: input.effusion.laterality,
      severity: effusionSeverity(input.effusion.size),
      state: input.effusion.loculated ? "loculated" : undefined,
      supportsLaterality: true,
    });
  }

  if (input.ctr && input.ctr > 0) {
    const enlarged = ctrIsEnlarged(input.ctr, Boolean(input.paAvailable));
    atoms.push({
      concept: enlarged === true ? "cardiomegaly" : "cardiac_silhouette",
      conflictGroup: "cardiac_size",
      anatomicalSection: "cardiac silhouette",
      findings: composeCtrSentence({ ctr: input.ctr, paAvailable: Boolean(input.paAvailable) }),
      impression:
        enlarged === true
          ? "Cardiomegaly, allowing for projection."
          : enlarged === false
            ? "Normal cardiac size for projection."
            : undefined,
      measurement: `CTR ${input.ctr}`,
      severity: enlarged === true ? "moderate" : undefined,
    });
  }

  return { bundleId, observations: chestAtomsToPatches(region, bundleId, atoms) };
}
