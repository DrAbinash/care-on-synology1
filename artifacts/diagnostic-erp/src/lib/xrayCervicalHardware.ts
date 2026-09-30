/**
 * xrayCervicalHardware.ts — the post-operative cervical spine (spec §12,
 * library §15).
 *
 * Plain films answer three questions about cervical instrumentation: is it
 * still where it was put, is it still whole, and has the segment around it
 * changed. They do not establish loosening on their own — equivocal perihardware
 * lucency is a common, benign finding — so this module separates what is seen
 * (`absent` / `equivocal` / `convincing`) from what is concluded, and the word
 * "loosening" is only ever written when the radiologist has chosen
 * `convincing`. That is the "do not overstate loosening" rule made structural
 * rather than advisory.
 *
 * No MRI-only content is imported: no cord signal, no canal stenosis grade, no
 * disc desiccation. Adjacent-segment degeneration is described in radiographic
 * terms (disc height, osteophytes, endplate change), which is what a film can
 * actually show.
 *
 * Pure functions only — no store, no React.
 */
import { normalizeCervicalLevel } from "./xrayCervicalLevels";
import { CERVICAL_NORMAL_SENTENCES } from "./xrayCervicalNormalAtoms";
import {
  cervicalAtomsToPatches,
  cervicalBundleId,
  type CervicalAtomSpec,
} from "./xrayCervicalAtoms";
import type { XrayCervicalTechniqueContext } from "./xrayCervicalViews";

export type CervicalHardwareProcedure =
  | "acdf"
  | "posterior_fixation"
  | "combined_front_back"
  | "cage_only"
  | "other";

export type CervicalHardwareComponent = "plate" | "screws" | "rods" | "cage" | "laminar_clip" | "other";

/** Radiologist's read of hardware continuity — never inferred by the system. */
export type CervicalHardwareContinuity = "not_assessed" | "intact" | "suspected" | "fractured";

/** Position of the hardware relative to where it was placed. */
export type CervicalHardwarePosition = "not_assessed" | "unchanged" | "suspected" | "migrated";

/**
 * Perihardware lucency, graded by how convincing it looks. The distinction
 * between `equivocal` and `convincing` is the whole point: only the latter may
 * be described as concerning for loosening.
 */
export type CervicalHardwareLucency = "not_assessed" | "absent" | "equivocal" | "convincing";

export type CervicalHardwareInput = {
  procedure?: CervicalHardwareProcedure;
  /** Operated levels; every one is normalized so the report numbers consistently. */
  levels?: Array<string | null | undefined>;
  components?: CervicalHardwareComponent[];
  continuity?: CervicalHardwareContinuity;
  position?: CervicalHardwarePosition;
  lucency?: CervicalHardwareLucency;
  /** Alignment across the construct, in the radiologist's words. */
  alignmentNote?: string | null;
  /** Fusion / arthrodesis status as the radiologist reads it. */
  fusion?: "not_assessed" | "healed" | "equivocal" | "not_fused";
  adjacentSegmentDegeneration?: boolean;
  adjacentSegmentLevels?: Array<string | null | undefined>;
  /** Free text the radiologist adds about the construct. */
  note?: string | null;
};

export const CERVICAL_HARDWARE_PROCEDURE_LABELS: Record<CervicalHardwareProcedure, string> = {
  acdf: "anterior cervical discectomy and fusion",
  posterior_fixation: "posterior cervical fixation",
  combined_front_back: "combined anterior and posterior cervical surgery",
  cage_only: "interbody cage / spacer",
  other: "cervical instrumentation",
};

export const CERVICAL_HARDWARE_COMPONENT_LABELS: Record<CervicalHardwareComponent, string> = {
  plate: "plate",
  screws: "screws",
  rods: "rods",
  cage: "cage / spacer",
  laminar_clip: "laminar clip",
  other: "other hardware",
};

const levelList = (levels: Array<string | null | undefined> | undefined): string[] => {
  const out: string[] = [];
  for (const raw of levels ?? []) {
    const norm = normalizeCervicalLevel(raw ?? null);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
};

const joinedLevels = (levels: string[]): string => {
  if (levels.length === 0) return "";
  if (levels.length === 1) return levels[0] as string;
  return `${levels.slice(0, -1).join(", ")} and ${levels[levels.length - 1]}`;
};

const componentPhrase = (components: CervicalHardwareComponent[]): string => {
  const labels = components.map((c) => CERVICAL_HARDWARE_COMPONENT_LABELS[c]);
  if (labels.length === 0) return "hardware";
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
};

/** Levels the input named that are not cervical — reported, never guessed. */
export function cervicalHardwareUnresolvedLevels(input: CervicalHardwareInput): string[] {
  const named = (input.levels ?? []).map((l) => (l ?? "").trim()).filter(Boolean);
  const resolved = new Set(levelList(input.levels));
  return named.filter((l) => !resolved.has(normalizeCervicalLevel(l) ?? ""));
}

export function composeCervicalHardwareSentence(input: CervicalHardwareInput): string {
  const levels = levelList(input.levels);
  const at = levels.length ? ` at ${joinedLevels(levels)}` : "";
  const procedure = CERVICAL_HARDWARE_PROCEDURE_LABELS[input.procedure ?? "other"];
  const parts: string[] = [`Evidence of ${procedure}${at}.`];

  const components = input.components ?? [];
  if (components.length) {
    parts.push(`${capitalize(componentPhrase(components))} visualized${at}.`);
  }

  const continuity = input.continuity ?? "not_assessed";
  if (continuity === "intact") {
    parts.push("The hardware is continuous without gross breakage.");
  } else if (continuity === "suspected") {
    parts.push("Interrupted hardware is suspected, to be confirmed on dedicated views or CT.");
  } else if (continuity === "fractured") {
    parts.push("Hardware breakage is demonstrated.");
  } else {
    parts.push("Hardware continuity is not specifically assessed.");
  }

  const position = input.position ?? "not_assessed";
  if (position === "unchanged") {
    parts.push("Hardware position is unchanged.");
  } else if (position === "suspected") {
    parts.push("Suspected hardware migration, requiring comparison with prior studies.");
  } else if (position === "migrated") {
    parts.push("Hardware migration is demonstrated.");
  }

  const lucency = input.lucency ?? "not_assessed";
  if (lucency === "absent") {
    parts.push("No perihardware lucency.");
  } else if (lucency === "equivocal") {
    parts.push(
      "Equivocal perihardware lucency, which alone does not indicate loosening.",
    );
  } else if (lucency === "convincing") {
    parts.push("Convincing perihardware lucency, concerning for loosening.");
  }

  const fusion = input.fusion ?? "not_assessed";
  if (fusion === "healed") parts.push("Fusion appears established at the operated levels.");
  else if (fusion === "equivocal") parts.push("Fusion status is equivocal on radiography.");
  else if (fusion === "not_fused") parts.push("No bridging fusion is evident at the operated levels.");

  const alignment = (input.alignmentNote ?? "").trim();
  if (alignment) parts.push(ensureSentence(alignment));

  const note = (input.note ?? "").trim();
  if (note) parts.push(ensureSentence(note));

  return parts.join(" ");
}

export function composeAdjacentSegmentSentence(input: CervicalHardwareInput): string {
  const levels = levelList(input.adjacentSegmentLevels);
  const at = levels.length ? ` at ${joinedLevels(levels)}` : " at the levels adjacent to the construct";
  return `Adjacent-segment degeneration${at} with disc-space height loss, marginal osteophytes and endplate sclerosis.`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ensureSentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export type CervicalHardwareResult = {
  bundleId: string;
  observations: ReturnType<typeof cervicalAtomsToPatches>;
  /** Problems with the input, so the canvas can show them instead of guessing. */
  warnings: string[];
};

/**
 * Post-operative atoms. One "hardware" atom carries the construct description,
 * one atom per operated level records the alignment of that segment, and
 * adjacent-segment degeneration is a separate observation so it does not
 * masquerade as a hardware problem.
 *
 * `ctx` is used for one thing only: a lucency or continuity claim needs a film
 * that can see it, so a study with no lateral view cannot support an anterior
 * plate assessment.
 */
export function buildCervicalHardwareAtoms(
  input: CervicalHardwareInput,
  ctx: XrayCervicalTechniqueContext,
  opts: { region?: string; bundleId?: string } = {},
): CervicalHardwareResult {
  const region = opts.region ?? "Cervical Spine";
  const bundleId = opts.bundleId ?? cervicalBundleId("hardware", "cervical");
  const warnings: string[] = [];
  const atoms: CervicalAtomSpec[] = [];

  const unresolved = cervicalHardwareUnresolvedLevels(input);
  for (const l of unresolved) warnings.push(`"${l}" is not a cervical level and was not recorded.`);

  const levels = levelList(input.levels);
  const needsLateral =
    input.continuity === "intact" ||
    input.continuity === "fractured" ||
    input.lucency === "absent" ||
    input.lucency === "convincing" ||
    input.fusion === "healed" ||
    input.fusion === "not_fused";
  if (needsLateral && !ctx.performed.lateral) {
    warnings.push(
      "No lateral cervical view is recorded, so hardware continuity, lucency and fusion status are not certified.",
    );
  }

  atoms.push({
    concept: "cervical_hardware",
    conflictGroup: "cervical_hardware",
    anatomicalSection: "hardware",
    findings: composeCervicalHardwareSentence(input),
    impression: "Post-operative cervical hardware as described.",
    // Instrumentation and the "no cervical instrumentation" baseline cannot both
    // be true, so recording hardware retires the normal line (spec §5).
    baselineReplaces: CERVICAL_NORMAL_SENTENCES.noHardware,
    level: levels.length === 1 ? levels[0] : undefined,
    severity:
      input.continuity === "fractured" || input.position === "migrated" || input.lucency === "convincing"
        ? "moderate"
        : undefined,
    state: input.continuity ?? "not_assessed",
    view: ctx.performed.lateral ? "lateral" : undefined,
  });

  if (input.adjacentSegmentDegeneration) {
    const adjLevels = levelList(input.adjacentSegmentLevels);
    atoms.push({
      concept: "adjacent_segment_degeneration",
      conflictGroup: "adjacent_segment_degeneration",
      anatomicalSection: "disc spaces",
      findings: composeAdjacentSegmentSentence(input),
      level: adjLevels.length === 1 ? adjLevels[0] : undefined,
      view: ctx.performed.lateral ? "lateral" : undefined,
    });
  }

  return { bundleId, observations: cervicalAtomsToPatches(region, bundleId, atoms), warnings };
}

/** Normal hardware plus demonstrated breakage is the §15 contradiction. */
export function cervicalHardwareContradiction(findingsText: string | null | undefined): string | null {
  const t = findingsText ?? "";
  const intact = /hardware is continuous|no (?:perihardware )?lucency|position is unchanged|without gross breakage/i.test(t);
  const broken = /hardware breakage is demonstrated|hardware migration is demonstrated|concerning for loosening/i.test(t);
  if (intact && broken) {
    return "Hardware is described as both intact and broken/migrated/loosened in the same report.";
  }
  const equivocal = /equivocal perihardware lucency/i.test(t);
  if (equivocal && /loosening/i.test(t) && !/does not indicate loosening/i.test(t)) {
    return "Equivocal perihardware lucency is described together with a loosening conclusion — only convincing lucency supports that word.";
  }
  return null;
}
