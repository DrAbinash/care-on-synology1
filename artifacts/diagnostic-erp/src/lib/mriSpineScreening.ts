/**
 * mriSpineScreening.ts — the shared engine behind the three spine screening
 * modules (spec §22-§33).
 *
 * Three clinically distinct palettes, ONE engine. Cervical, dorsal and LS
 * screening differ only as DATA (`mriSpineScreeningSchemas.ts`): anatomy,
 * sections and coarse options. Everything else — roles, sequence gating,
 * normal→abnormal reconciliation, prose emission, the once-only limitation
 * statement, impression promotion, recommendations, validation, provenance and
 * undo — is implemented here once and reused by all three.
 *
 * Reconciliation model: a region's ledger prose is REBUILT from its structured
 * selection state (`removeMacroBundle(bundleId)` then `applyMacroBundle`), and
 * every atom carries
 *   conflictGroup = screen-<region>-<section>   (namespaced per region)
 *   level         = cervical | dorsal | lumbar  (region bucket)
 * so choosing an abnormality supersedes that section's normal sentence without
 * ever reaching into another region's observations.
 *
 * Prose rule: options reuse CARE's shipped screening sentences; where none
 * exists the engine renders the radiologist's own structured choice as
 * "<Section>: <option label>" instead of inventing clinical sentences.
 *
 * Pure functions only — no React, no store instance.
 */

import {
  screeningAxialDetailAllowed,
  type SpineSequenceKey,
  type SpineSequencesAvailable,
} from "./mriSpineSequences";
import {
  lumbarLevelKeyStrings,
  type LumbarNumberingState,
} from "./mriSpineNumbering";
import {
  findScreeningOption,
  roleImpliesPerformed,
  screeningConflictGroup,
  screeningLevelBucket,
  SPINE_SCREENING_REGIONS,
  type RegionRole,
  type RegionScreeningSchema,
  type ScreeningOption,
  type ScreeningSection,
  type SpineScreeningRegion,
} from "./mriSpineScreeningSchema";
import { SCREENING_LIMITATION_TEXT } from "./zai-workspace/baselines/screeningLimitation";
import { splitToSentences } from "./reportFieldMerge";
import type { SpineAtomSpec } from "./mriSpineAtoms";

export type ScreeningSide = "left" | "right" | "bilateral";

export type ScreeningSelectionValue = {
  optionId: string;
  /** Approximate level, only where the schema offers level selection. */
  level?: string;
  side?: ScreeningSide;
  mm?: number;
};

export type ScreeningRegionState = {
  role: RegionRole;
  /** Bound to the role (`role !== 'absent'`), always overridable (§23). */
  performed: boolean;
  /** sectionKey -> selections (single choice unless the section is multi). */
  selections: Record<string, ScreeningSelectionValue[]>;
  /** Radiologist override of an option's default impression promotion (§31). */
  significance: Record<string, boolean>;
  /** "Dedicated MRI <region> spine suggested." — selected, never automatic. */
  recommendationSelected: boolean;
};

export type ScreeningState = Record<SpineScreeningRegion, ScreeningRegionState>;

export type ScreeningGateNotice = {
  region: SpineScreeningRegion;
  sectionKey: string;
  optionId: string;
  reason: "axial" | "sequence";
  missing: SpineSequenceKey[];
  limitation: string;
};

export type ScreeningBuildResult = {
  bundleId: string;
  region: SpineScreeningRegion;
  atoms: SpineAtomSpec[];
  /** Findings sentences actually emitted, in section order. */
  lines: Array<{ sectionKey: string; text: string }>;
  /** Choices the protocol cannot support, downgraded to limitation wording. */
  notices: ScreeningGateNotice[];
  impressionLines: string[];
  recommendationLines: string[];
  /** The standard limitation sentence, once for this region's build. */
  limitation: string;
};

export type SchemaMap = Record<SpineScreeningRegion, RegionScreeningSchema>;

export function defaultScreeningRegionState(role: RegionRole = "absent"): ScreeningRegionState {
  return {
    role,
    performed: roleImpliesPerformed(role),
    selections: {},
    significance: {},
    recommendationSelected: false,
  };
}

export function defaultScreeningState(
  roles?: Partial<Record<SpineScreeningRegion, RegionRole>>,
): ScreeningState {
  const out = {} as ScreeningState;
  for (const region of SPINE_SCREENING_REGIONS) {
    out[region] = defaultScreeningRegionState(roles?.[region] ?? "absent");
  }
  return out;
}

/** Regions that may contribute prose, in fixed report order (§28/§30). */
export function performedScreeningRegions(state: ScreeningState): SpineScreeningRegion[] {
  return SPINE_SCREENING_REGIONS.filter(
    (region) => state[region]?.performed && state[region]?.role !== "absent",
  );
}

/**
 * Whole Spine Screening is a composition label, never a fourth clinical schema
 * (§28). Two or more screening regions group under it in the UI.
 */
export function wholeSpineScreeningLabel(state: ScreeningState): string | null {
  const screening = SPINE_SCREENING_REGIONS.filter(
    (region) =>
      state[region]?.performed
      && (state[region]?.role === "primary-screening"
        || state[region]?.role === "accompanying-screening"),
  );
  return screening.length >= 2 ? "Whole Spine Screening" : null;
}

/** A screening-only study has no dedicated findings block (§23/§30). */
export function isScreeningOnlyReport(state: ScreeningState): boolean {
  const performed = performedScreeningRegions(state);
  return performed.length > 0
    && performed.every((region) => state[region].role === "primary-screening");
}

/**
 * Guard only (spec §33): by the role model a region never holds two roles, so
 * this catches manual override putting screening wording on a region that is
 * also the dedicated primary study.
 */
export function roleConflict(state: ScreeningState): string[] {
  const warnings: string[] = [];
  for (const region of SPINE_SCREENING_REGIONS) {
    const regionState = state[region];
    if (regionState?.role !== "primary-dedicated" || !regionState.performed) continue;
    const hasSelection = Object.values(regionState.selections).some((list) => (list ?? []).length > 0);
    if (hasSelection) {
      warnings.push(
        `${region}: this region is the dedicated primary study, so screening statements for it are duplicative. Report it once in the dedicated section.`,
      );
    }
  }
  return warnings;
}

export function screeningRegionBundleId(region: SpineScreeningRegion): string {
  return `spm-screen-${region}`;
}

/** Levels offered for an option — LS always comes from the numbering resolver. */
export function availableScreeningLevels(
  option: ScreeningOption,
  schema: RegionScreeningSchema,
  numbering?: LumbarNumberingState | null,
): string[] {
  if (option.levelChoices === "lumbar-resolver") {
    return numbering ? lumbarLevelKeyStrings(numbering) : [];
  }
  if (option.levelChoices === "cervical") {
    return schema.levelOptions.cervical ?? [];
  }
  if (option.levelChoices === "thoracic") {
    return schema.levelOptions.thoracic ?? [];
  }
  return [];
}

export function screeningOptionAvailability(
  option: ScreeningOption,
  sequences: SpineSequencesAvailable,
): { available: boolean; reason?: ScreeningGateNotice["reason"]; missing: SpineSequenceKey[] } {
  if (option.axialDependent && !screeningAxialDetailAllowed(sequences)) {
    return { available: false, reason: "axial", missing: ["axial"] };
  }
  const requires = option.requires ?? [];
  const missing = requires.filter((k) => !sequences[k]);
  if (missing.length > 0) return { available: false, reason: "sequence", missing };
  return { available: true, missing: [] };
}

/** The radiologist's structured choice, rendered as coarse screening prose. */
export function screeningProse(
  section: ScreeningSection,
  option: ScreeningOption,
  value: ScreeningSelectionValue,
): string {
  const template = option.prose ?? `${section.label}: ${option.label}`;
  let text = template;
  const level = (value.level ?? "").trim();
  text = text.replace(/\{level\}/g, level || "[level]");
  text = text.replace(/\{side\}/g, value.side ?? "[side]");
  text = text.replace(
    /\{mm\}/g,
    value.mm != null && Number.isFinite(value.mm) ? String(value.mm) : "[X]",
  );
  // A level-bearing option must name its level even when the shipped sentence
  // has no token for it, or the finding would be unlocalizable.
  if (level && option.levelChoices && !text.includes(level)) {
    text = `${level}: ${text}`;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Impression promotion default — always overridable by the radiologist (§31). */
export function screeningOptionSignificant(
  option: ScreeningOption,
  regionState: ScreeningRegionState,
): boolean {
  const override = regionState.significance[option.id];
  if (typeof override === "boolean") return override;
  if (option.normal) return false;
  return option.significant === true;
}

function selectedOptions(
  schema: RegionScreeningSchema,
  regionState: ScreeningRegionState,
): Array<{ section: ScreeningSection; option: ScreeningOption; value: ScreeningSelectionValue }> {
  const out: Array<{ section: ScreeningSection; option: ScreeningOption; value: ScreeningSelectionValue }> = [];
  for (const section of schema.sections) {
    for (const value of regionState.selections[section.key] ?? []) {
      const option = findScreeningOption(schema, section.key, value.optionId);
      if (!option) continue;
      out.push({ section, option, value });
    }
  }
  return out;
}

/**
 * Rebuild one screening region's observations from its selection state. Returns
 * data only — the caller applies it through the existing remove + apply pair,
 * so chips never hold parallel local state.
 */
export function buildScreeningRegionBundle(opts: {
  region: SpineScreeningRegion;
  schema: RegionScreeningSchema;
  state: ScreeningRegionState;
  sequences: SpineSequencesAvailable;
  numbering?: LumbarNumberingState | null;
  /** Study Tab / reporting region owning the ledger rows. */
  ledgerRegion?: string;
}): ScreeningBuildResult {
  const { region, schema, state } = opts;
  const bundleId = screeningRegionBundleId(region);
  const empty: ScreeningBuildResult = {
    bundleId,
    region,
    atoms: [],
    lines: [],
    notices: [],
    impressionLines: [],
    recommendationLines: [],
    limitation: "",
  };

  // No coverage for this region → no findings, no preset, no limitation line.
  if (!state.performed || state.role === "absent") return empty;

  const bucket = screeningLevelBucket(region);
  const section = (key: string) => screeningConflictGroup(region, key);
  const atoms: SpineAtomSpec[] = [];
  const lines: ScreeningBuildResult["lines"] = [];
  const notices: ScreeningGateNotice[] = [];
  const impressionLines: string[] = [];

  for (const { section: sec, option, value } of selectedOptions(schema, state)) {
    const gate = screeningOptionAvailability(option, opts.sequences);
    if (!gate.available) {
      // Limitation wording replaces the conclusion — the screening study is
      // never allowed to assert detail it cannot show (spec §32/§35).
      const limitation = `Screening of the ${schema.label.toLowerCase()} did not include ${gate.missing.join(" + ")} coverage, so ${sec.label.toLowerCase()} cannot be assessed on this study.`;
      notices.push({
        region,
        sectionKey: sec.key,
        optionId: option.id,
        reason: gate.reason ?? "sequence",
        missing: gate.missing,
        limitation,
      });
      atoms.push({
        concept: "screening_limitation",
        conflictGroup: section(`${sec.key}_coverage`),
        anatomicalSection: `screening ${region}`,
        findings: limitation,
        level: bucket,
        role: "screening",
      });
      continue;
    }

    const text = screeningProse(sec, option, value);
    lines.push({ sectionKey: sec.key, text });
    const significant = screeningOptionSignificant(option, state);
    const impression = significant ? `${schema.label}: ${text}` : undefined;
    atoms.push({
      concept: option.concept,
      conflictGroup: section(sec.key),
      anatomicalSection: `screening ${region}`,
      findings: text,
      impression,
      level: bucket,
      laterality: value.side,
      severity: option.normal ? "" : significant ? "significant" : "",
      measurement: value.mm != null ? String(value.mm) : undefined,
      state: option.normal ? "normal" : "abnormal",
      supportsLaterality: Boolean(value.side),
      role: "screening",
    });
    if (significant && impression) impressionLines.push(impression);
  }

  // Approximate level certainty: a screening region cannot promise the level
  // precision of a dedicated study.
  const levelsUsed = selectedOptions(schema, state).filter((s) => Boolean(s.value.level));
  if (levelsUsed.length > 0 && state.role !== "primary-dedicated") {
    atoms.push({
      concept: "screening_limitation",
      conflictGroup: section("level_certainty"),
      anatomicalSection: `screening ${region}`,
      findings: `Levels stated for the ${schema.label.toLowerCase()} are approximate, based on the coverage available on this screening study.`,
      level: bucket,
      role: "screening",
    });
  }

  const recommendationLines = state.recommendationSelected ? [schema.recommendation] : [];
  if (state.recommendationSelected) {
    atoms.push({
      concept: "screening_recommendation",
      conflictGroup: section("recommendation"),
      anatomicalSection: `screening ${region}`,
      findings: "",
      recommendation: schema.recommendation,
      level: bucket,
      role: "recommendation",
    });
  }

  return {
    bundleId,
    region,
    atoms,
    lines,
    notices,
    impressionLines,
    recommendationLines,
    limitation: lines.length > 0 ? SCREENING_LIMITATION_TEXT : "",
  };
}

export type ComposedScreeningFindings = {
  regions: Array<{ region: SpineScreeningRegion; heading: string; lines: string[] }>;
  limitation: string;
  groupingLabel: string | null;
  text: string;
  performed: SpineScreeningRegion[];
};

/**
 * Screening section of the Findings. Emission order is always cervical →
 * dorsal → ls, and the limitation statement is an emitter-level rule: exactly
 * once whether one, two or three modules are active (§29/§30).
 */
export function composeScreeningFindings(
  state: ScreeningState,
  schemas: SchemaMap,
  built: Partial<Record<SpineScreeningRegion, ScreeningBuildResult>>,
): ComposedScreeningFindings {
  const regions: ComposedScreeningFindings["regions"] = [];
  for (const region of performedScreeningRegions(state)) {
    const result = built[region];
    if (!result) continue;
    const lines = [...result.lines.map((l) => l.text)];
    for (const notice of result.notices) lines.push(notice.limitation);
    if (lines.length === 0) continue;
    regions.push({ region, heading: schemas[region].heading, lines });
  }
  const limitation = regions.length > 0 ? SCREENING_LIMITATION_TEXT : "";
  const body = regions.map((r) => `${r.heading}\n${r.lines.join(" ")}`).join("\n\n");
  const text = [body, limitation].filter(Boolean).join("\n\n");
  return {
    regions,
    limitation,
    groupingLabel: wholeSpineScreeningLabel(state),
    text,
    performed: performedScreeningRegions(state),
  };
}

/** Only significant screening abnormalities reach the Impression (§31). */
export function composeScreeningImpressionLines(
  state: ScreeningState,
  schemas: SchemaMap,
  built: Partial<Record<SpineScreeningRegion, ScreeningBuildResult>>,
): string[] {
  const lines: string[] = [];
  for (const region of performedScreeningRegions(state)) {
    for (const line of built[region]?.impressionLines ?? []) lines.push(line);
  }
  return lines;
}

/** Dedicated-study recommendations, only when the radiologist selected one. */
export function composeScreeningRecommendationLines(
  state: ScreeningState,
  built: Partial<Record<SpineScreeningRegion, ScreeningBuildResult>>,
): string[] {
  const lines: string[] = [];
  for (const region of performedScreeningRegions(state)) {
    for (const line of built[region]?.recommendationLines ?? []) lines.push(line);
  }
  return lines;
}

/**
 * Screening limitation atom — ONE row for the whole report, under its own
 * conflict group so rebuilding a region can never duplicate the sentence (§29).
 */
export function screeningLimitationAtom(): SpineAtomSpec {
  return {
    concept: "screening_limitation",
    conflictGroup: "screen-limitation",
    anatomicalSection: "screening",
    findings: SCREENING_LIMITATION_TEXT,
    role: "screening",
  };
}

export const SCREENING_LIMITATION_BUNDLE_ID = "spm-screen-limitation";

/**
 * Validate each screening module independently (§33). Warnings only — the
 * radiologist's wording is never rewritten.
 */
const SCREENING_TEXT_RULES: Array<{
  region: SpineScreeningRegion;
  label: string;
  normal: RegExp;
  abnormal: RegExp;
}> = [
  {
    region: "cervical",
    label: "Cervical screening",
    normal: /\bcervical\b[^.]*\b(?:cord[^.]*(?:grossly normal|normal)|no gross (?:cord|canal)|grossly normal)\b/i,
    abnormal: /\b(?:cord[^.]*(?:compression|hyperintensity|signal abnormality|myelopathy|syrinx)|c[-]?\d[^.]*disc (?:protrusion|extrusion|herniation)|(?:canal|foraminal) stenosis)\b/i,
  },
  {
    region: "dorsal",
    label: "Dorsal screening",
    normal: /\b(?:dorsal|thoracic)\b[^.]*(?:no significant disc(?: abnormality)?|disc spaces are maintained|appear normal|no canal stenosis)/i,
    abnormal: /\b(?:d[0-9]{1,2}|t[0-9]{1,2})[^.]*disc (?:protrusion|extrusion|herniation)|\bdorsal\b[^.]*(?:canal stenosis|cord signal|cord compression)/i,
  },
  {
    region: "ls",
    label: "LS screening",
    normal: /\b(?:no gross (?:canal |spinal )?stenosis|lumbar alignment is maintained|no significant disc herniation)\b/i,
    abnormal: /\b(?:severe|moderate)\b[^.]*(?:canal stenosis|neural compression|foraminal stenosis)/i,
  },
];

export function screeningTextContradictions(opts: {
  findingsText: string;
  impressionText: string;
  state: ScreeningState;
}): string[] {
  const blob = `${opts.findingsText ?? ""}\n${opts.impressionText ?? ""}`.trim();
  if (!blob) return [];
  const sentences = splitToSentences(blob);
  const warnings: string[] = [];

  for (const rule of SCREENING_TEXT_RULES) {
    if (!opts.state?.[rule.region]?.performed) continue;
    const normalHit = sentences.some((s) => rule.normal.test(s));
    const abnormalHit = sentences.some((s) => rule.abnormal.test(s));
    if (normalHit && abnormalHit) {
      warnings.push(
        `${rule.label}: the report states both a normal screening conclusion and an abnormality for the same region. Confirm which is intended — nothing has been changed.`,
      );
    }
  }

  // A screening module must not be asserted for a region that was not covered.
  for (const region of SPINE_SCREENING_REGIONS) {
    if (opts.state?.[region]?.performed) continue;
    const mention = new RegExp(`\\b${region === "ls" ? "lumbosacral|lumbar" : region}\\b[^.]*screening`, "i");
    if (sentences.some((s) => mention.test(s))) {
      warnings.push(
        `${region}: screening wording is present but this region was not marked as performed. Confirm the coverage.`,
      );
    }
  }

  return warnings;
}

/** Normal preset selections for a region, ready to store. */
export function screeningPresetSelections(
  schema: RegionScreeningSchema,
): Record<string, ScreeningSelectionValue[]> {
  const selections: Record<string, ScreeningSelectionValue[]> = {};
  for (const [sectionKey, optionId] of Object.entries(schema.normalPreset.selections)) {
    selections[sectionKey] = [{ optionId }];
  }
  return selections;
}
