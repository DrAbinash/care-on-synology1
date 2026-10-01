/**
 * xrayLsHardware.ts — the post-operative lumbosacral film (spec §15; library §17).
 *
 * The library's prohibitions are the design: "Do not automatically diagnose
 * hardware loosening from equivocal lucency." A perihardware lucent line is a
 * *description*, and whether it means loosening is a radiologist judgement, so
 * this module grades lucency as `absent | equivocal | convincing` and only ever
 * writes the diagnostic wording for `convincing`. The same discipline applies to
 * continuity (intact / equivocal / broken) and position (maintained / equivocal /
 * migrated): an equivocal observation stays descriptive and is surfaced as a
 * warning rather than being promoted into a diagnosis.
 *
 * Adjacent-segment degeneration is a level-bearing statement, so it takes the
 * same numbering discipline as the rest of the feature: no level, no sentence.
 *
 * Pure functions only — no store, no React.
 */
import { normalizeLsLevel } from "./xrayLsLevels";
import { lsNumberingAllowedLevels, type LsNumbering } from "./xrayLsNumbering";
import { LS_NORMAL_SENTENCES } from "./xrayLsNormalAtoms";
import { lsAtomsToPatches, lsBundleId, type LsAtomSpec } from "./xrayLsAtoms";
import type { XrayLsTechniqueContext } from "./xrayLsViews";

export type LsHardwareProcedure =
  | "laminectomy"
  | "posteriorFusion"
  | "pedicleScrewsRods"
  | "interbodyCage"
  | "vertebroplasty"
  | "kyphoplasty"
  | "other";

export type LsHardwareContinuity = "intact" | "equivocal" | "broken" | "notAssessed";
export type LsHardwarePosition = "maintained" | "equivocal" | "migrated" | "notAssessed";
/** Graded deliberately: equivocal lucency must never read as loosening. */
export type LsHardwareLucency = "absent" | "equivocal" | "convincing" | "notAssessed";

export type LsHardwareInput = {
  procedures: LsHardwareProcedure[];
  components: string[];
  levels: string[];
  continuity: LsHardwareContinuity;
  position: LsHardwarePosition;
  lucency: LsHardwareLucency;
  /** Radiologist-selected adjacent-segment degeneration level, if any. */
  adjacentLevel?: string | null;
  fusionMassPresent?: boolean;
  note?: string | null;
};

export const LS_HARDWARE_PROCEDURE_LABELS: Record<LsHardwareProcedure, string> = {
  laminectomy: "laminectomy",
  posteriorFusion: "posterior fusion",
  pedicleScrewsRods: "pedicle screws and rods",
  interbodyCage: "interbody cage/spacer",
  vertebroplasty: "vertebroplasty",
  kyphoplasty: "kyphoplasty",
  other: "other spinal procedure",
};

export const LS_HARDWARE_CONTINUITY_OPTIONS: Array<{ value: LsHardwareContinuity; label: string }> = [
  { value: "intact", label: "Grossly intact" },
  { value: "equivocal", label: "Equivocal / partially obscured" },
  { value: "broken", label: "Broken" },
  { value: "notAssessed", label: "Not assessed" },
];

export const LS_HARDWARE_POSITION_OPTIONS: Array<{ value: LsHardwarePosition; label: string }> = [
  { value: "maintained", label: "Position maintained" },
  { value: "equivocal", label: "Position equivocal" },
  { value: "migrated", label: "Migrated" },
  { value: "notAssessed", label: "Not assessed" },
];

export const LS_HARDWARE_LUCENCY_OPTIONS: Array<{ value: LsHardwareLucency; label: string }> = [
  { value: "absent", label: "No perihardware lucency" },
  { value: "equivocal", label: "Equivocal perihardware lucency" },
  { value: "convincing", label: "Convincing perihardware lucency" },
  { value: "notAssessed", label: "Not assessed" },
];

const LEVEL_WORDS = (levels: string[]): string => {
  const cleaned = levels.map((l) => normalizeLsLevel(l)).filter((l): l is string => Boolean(l));
  if (!cleaned.length) return "";
  return ` at ${cleaned.join(", ")}`;
};

/** The procedure sentence: what was done, at which counted level. */
export function composeLsHardwareSentence(input: LsHardwareInput): string {
  const procedures = input.procedures.map((p) => LS_HARDWARE_PROCEDURE_LABELS[p]).filter(Boolean);
  const components = (input.components ?? []).map((c) => c.trim()).filter(Boolean);
  const at = LEVEL_WORDS(input.levels ?? []);
  const parts: string[] = [];
  if (procedures.length) {
    parts.push(`Post-operative changes of ${procedures.join(" and ")}${at} are noted.`);
  }
  if (components.length) {
    parts.push(`${components.join(", ")} ${components.length > 1 ? "are" : "is"} identified${at}.`);
  }
  if (input.fusionMassPresent) {
    parts.push(`Fusion mass is suggested${at}.`);
  }

  switch (input.continuity) {
    case "intact":
      parts.push(`Hardware continuity is grossly maintained${at}.`);
      break;
    case "equivocal":
      parts.push(`Hardware continuity is equivocal${at}; overlap limits assessment on the plain radiographs.`);
      break;
    case "broken":
      parts.push(`Hardware breakage is identified${at}.`);
      break;
    case "notAssessed":
      parts.push(`Hardware continuity is not assessed on these radiographs.`);
      break;
  }

  switch (input.position) {
    case "maintained":
      parts.push(`Hardware position is maintained${at}.`);
      break;
    case "equivocal":
      parts.push(`Hardware position is equivocal${at}.`);
      break;
    case "migrated":
      parts.push(`Hardware migration is identified${at}.`);
      break;
    case "notAssessed":
      parts.push(`Hardware position is not assessed on these radiographs.`);
      break;
  }

  // The graded one: only a convincing lucency may be described as concerning.
  switch (input.lucency) {
    case "absent":
      parts.push(`No convincing perihardware lucency${at}.`);
      break;
    case "equivocal":
      parts.push(
        `Equivocal perihardware lucency${at}; this is not diagnostic of loosening on plain radiographs.`,
      );
      break;
    case "convincing":
      parts.push(`Convincing perihardware lucency${at}, concerning for loosening.`);
      break;
    case "notAssessed":
      parts.push(`Perihardware lucency is not assessed${at}.`);
      break;
  }

  const note = (input.note ?? "").trim();
  if (note) parts.push(/[^.]$/.test(note) ? `${note}.` : note);
  return parts.join(" ");
}

/** Adjacent-segment degeneration, level-bearing (library §17). */
export function composeLsAdjacentSegmentSentence(level: string | null | undefined): string | null {
  const norm = normalizeLsLevel(level ?? null);
  if (!norm) return null;
  return `Adjacent-segment degeneration at ${norm} with disc-space height loss, marginal osteophytes and endplate sclerosis.`;
}

export type LsHardwareWarning = { code: string; detail: string };

/**
 * Consistency of the hardware record itself. An equivocal observation is not a
 * contradiction, but pairing "grossly intact" with "broken" (or "absent" lucency
 * with a convincing one) is, and the radiologist needs to see it before the
 * report leaves the canvas.
 */
export function lsHardwareContradiction(input: LsHardwareInput): LsHardwareWarning[] {
  const warnings: LsHardwareWarning[] = [];
  if (input.continuity === "intact" && input.position === "migrated") {
    warnings.push({
      code: "hardware-intact-migrated",
      detail: "Hardware is described as grossly intact while migration is recorded — reconcile continuity and position.",
    });
  }
  if (input.lucency === "absent" && input.continuity === "broken") {
    warnings.push({
      code: "hardware-lucency-continuity",
      detail: "No perihardware lucency is recorded while hardware breakage is identified — confirm both statements.",
    });
  }
  if (!input.procedures.length && !input.components.length && !input.fusionMassPresent) {
    warnings.push({
      code: "hardware-no-substrate",
      detail: "A post-operative statement was written without naming any procedure, implant or fusion mass.",
    });
  }
  if (input.adjacentLevel && !normalizeLsLevel(input.adjacentLevel)) {
    warnings.push({
      code: "adjacent-level-unusable",
      detail: `"${input.adjacentLevel}" is not a thoracolumbosacral level, so adjacent-segment degeneration was not written.`,
    });
  }
  return warnings;
}

const HARDWARE_CONCEPT = "ls_postop_hardware";
// `adjacent_segment_degeneration` is already a shared spine concept whose pack
// declares the ls-spine / XR region+modality pair, so the lumbar tiles reuse it
// rather than registering a synonym that would split the ledger's identity.
const ADJACENT_CONCEPT = "adjacent_segment_degeneration";

export function buildLsHardwareAtoms(
  input: LsHardwareInput,
  _ctx: XrayLsTechniqueContext,
  opts: {
    region?: string;
    bundleId?: string;
    numbering?: LsNumbering | null;
  } = {},
): { bundleId: string; observations: ReturnType<typeof lsAtomsToPatches>; warnings: LsHardwareWarning[] } {
  const region = opts.region ?? "Lumbar Spine";
  const bundleId = opts.bundleId ?? lsBundleId("hardware", "ls");
  const atoms: LsAtomSpec[] = [];
  const warnings = lsHardwareContradiction(input);

  const levels = (input.levels ?? [])
    .map((l) => normalizeLsLevel(l))
    .filter((l): l is string => Boolean(l));
  const allowed = opts.numbering ? lsNumberingAllowedLevels(opts.numbering) : [];
  const unusable = levels.filter((l) => allowed.length > 0 && !allowed.includes(l));
  if (unusable.length) {
    warnings.push({
      code: "hardware-level-outside-numbering",
      detail: `${unusable.join(", ")} cannot be produced by the recorded numbering basis — anchor the numbering before labelling the operated level.`,
    });
  }
  const level = levels.find((l) => !unusable.includes(l));

  const findings = composeLsHardwareSentence({ ...input, levels });
  if (findings) {
    atoms.push({
      concept: HARDWARE_CONCEPT,
      anatomicalSection: "hardware",
      findings,
      level,
      // The one-click normal baseline says there is no hardware; this replaces it.
      baselineReplaces: LS_NORMAL_SENTENCES.noHardware,
      impression:
        input.continuity === "broken" || input.position === "migrated" || input.lucency === "convincing"
          ? "Post-operative hardware complication as described — clinical correlation and CT if indicated."
          : "Post-operative changes as described.",
      severity:
        input.continuity === "broken" || input.position === "migrated" || input.lucency === "convincing"
          ? "high"
          : undefined,
    });
  }

  const adjacent = composeLsAdjacentSegmentSentence(input.adjacentLevel);
  if (adjacent && !unusable.includes(normalizeLsLevel(input.adjacentLevel ?? null) ?? "")) {
    atoms.push({
      concept: ADJACENT_CONCEPT,
      anatomicalSection: "disc spaces",
      findings: adjacent,
      level: normalizeLsLevel(input.adjacentLevel ?? null) ?? undefined,
      impression: `Adjacent-segment degeneration${
        normalizeLsLevel(input.adjacentLevel ?? null) ? ` at ${normalizeLsLevel(input.adjacentLevel ?? null)}` : ""
      }.`,
    });
  }

  return { bundleId, observations: lsAtomsToPatches(region, bundleId, atoms), warnings };
}
