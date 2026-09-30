/**
 * mriSpineScreeningSchema.ts — the data contract behind the three spine
 * screening modules (spec §22).
 *
 * Cervical, dorsal and LS screening are three clinically distinct palettes
 * because each region has different anatomy. They are NOT three engines and
 * NOT one identical form: one schema-driven renderer draws any region from its
 * schema, and every schema is plain data.
 *
 * Prose rule (spec §SOURCE CONTENT): screening is not covered by the canonical
 * lumbar library, so `prose` is only ever set to wording CARE already ships in
 * production (the owned screening normals in `zai-workspace/baselines/` and the
 * screening entries of `report-formats-library.ts`). Where no production
 * sentence exists, `prose` stays undefined and the engine renders the
 * radiologist's own structured choice as "<Section>: <option label>" instead of
 * inventing clinical sentences.
 */

import type { SpineSequenceKey } from "./mriSpineSequences";

export type SpineScreeningRegion = "cervical" | "dorsal" | "ls";

export const SPINE_SCREENING_REGIONS: SpineScreeningRegion[] = ["cervical", "dorsal", "ls"];

/**
 * One field expresses the whole product shape (spec §22/§23): a dedicated
 * primary study, a screening-only study of that region, a screening region
 * accompanying another primary, or not performed at all.
 */
export type RegionRole =
  | "primary-dedicated"
  /**
   * A dedicated anatomical domain of one multi-region examination. A Dorso-Lumbar
   * study's thoracic and lumbar halves are dedicated coverage inside a single
   * composition — never two independent screening modules — so they cannot reuse
   * `primary-dedicated` (which names the study's one primary region) or any
   * screening role.
   */
  | "dedicated-component"
  | "primary-screening"
  | "accompanying-screening"
  | "absent";

export type ScreeningOption = {
  id: string;
  /** Coarse screening wording shown on the chip. */
  label: string;
  /** Canonical concept used for same-slot reconciliation. */
  concept: string;
  /** The normal / "no abnormality" choice of the section. */
  normal?: boolean;
  /**
   * Default impression-promotion flag (spec §31). Pre-set from the listed
   * critical-grade items and always overridable by the radiologist.
   */
  significant?: boolean;
  /** Cannot be concluded from sagittal-only screening (spec §32). */
  axialDependent?: boolean;
  /** Needs contrast to be stated at all (spec §35). */
  requires?: SpineSequenceKey[];
  /** Production prose template; `{level}` / `{side}` / `{mm}` are substituted. */
  prose?: string;
  /** This option offers approximate level selection. */
  levelChoices?: "cervical" | "thoracic" | "lumbar-resolver";
  /** Only selectable with a level attached. */
  levelRequired?: boolean;
};

export type ScreeningSection = {
  key: string;
  label: string;
  /** Several abnormalities may coexist (default: one choice per section). */
  multi?: boolean;
  options: ScreeningOption[];
};

export type RegionScreeningSchema = {
  region: SpineScreeningRegion;
  label: string;
  /** Heading line emitted in Findings — must match formatSlotMerge's SCREENING_HEADING. */
  heading: string;
  sections: ScreeningSection[];
  /** One-click normal preset (spec §27). */
  normalPreset: {
    id: string;
    label: string;
    /** sectionKey -> optionId */
    selections: Record<string, string>;
    /** Verbatim production sentences for the preset, in section order. */
    lines: string[];
  };
  /** Spec §24-26 recommendation, offered only when the radiologist selects it. */
  recommendation: string;
  /** Level options where the schema declares approximate level selection. */
  levelOptions: Record<string, string[]>;
};

export const CERVICAL_SCREENING_LEVELS = [
  "C2-C3",
  "C3-C4",
  "C4-C5",
  "C5-C6",
  "C6-C7",
  "C7-T1",
];

export const THORACIC_SCREENING_LEVELS = [
  "T1-T2",
  "T2-T3",
  "T3-T4",
  "T4-T5",
  "T5-T6",
  "T6-T7",
  "T7-T8",
  "T8-T9",
  "T9-T10",
  "T10-T11",
  "T11-T12",
  "T12-L1",
];

/** `screen-<region>-<section>` keeps reconciliation and undo inside one region (spec §22). */
export function screeningConflictGroup(
  region: SpineScreeningRegion,
  sectionKey: string,
): string {
  return `screen-${region}-${sectionKey}`;
}

/** Region bucket used as the observation level so regions never share a slot. */
export function screeningLevelBucket(region: SpineScreeningRegion): string {
  return region === "ls" ? "lumbar" : region;
}

export function roleImpliesPerformed(role: RegionRole): boolean {
  return role !== "absent";
}

export function isScreeningRole(role: RegionRole): boolean {
  return role === "primary-screening" || role === "accompanying-screening";
}

export function findScreeningOption(
  schema: RegionScreeningSchema,
  sectionKey: string,
  optionId: string,
): ScreeningOption | null {
  const section = schema.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  return section.options.find((o) => o.id === optionId) ?? null;
}

export function screeningSectionLevels(
  schema: RegionScreeningSchema,
  option: ScreeningOption,
): string[] {
  if (!option.levelChoices) return [];
  if (option.levelChoices === "cervical") return schema.levelOptions.cervical ?? CERVICAL_SCREENING_LEVELS;
  if (option.levelChoices === "thoracic") return schema.levelOptions.thoracic ?? THORACIC_SCREENING_LEVELS;
  return schema.levelOptions.lumbar ?? [];
}
