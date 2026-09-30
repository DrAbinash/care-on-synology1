/**
 * mriSpineScreeningRoles.ts — catalog code / billed exam → region roles
 * (spec §23).
 *
 * Mirrors the existing `billedStudyType` / `pickStructuredTemplate` precedent:
 * the billed exam name (and its catalog code) is the only place the clinic
 * records what was actually purchased, so it is what decides which screening
 * modules exist. No new table, no migration, no billing change.
 *
 * Roles are a DEFAULT. The canvas header always lets the radiologist override
 * them, because a screening region can be added or abandoned at the scanner.
 *
 * Pure functions only.
 */

import {
  roleImpliesPerformed,
  type RegionRole,
  type SpineScreeningRegion,
} from "./mriSpineScreeningSchema";
import {
  DEDICATED_COMPONENT_ROLE,
  resolveStudyComposition,
  type CompositionProvenance,
  type StudyComposition,
} from "./mriDorsoLumbarCatalog";

export type BilledStudyInput = {
  /** Catalog code from `diagnostic_tests.code`, e.g. "MRI038". */
  code?: string | null;
  /** Billed exam name, e.g. "MRI LS SPINE WITH SCREENING WHOLE SPINE". */
  name?: string | null;
  studyDescription?: string | null;
  protocolName?: string | null;
  reportTitle?: string | null;
};

export type ResolvedScreeningRoles = {
  roles: Record<SpineScreeningRegion, RegionRole>;
  /** The dictionary entry that matched, so the UI can show its work. */
  matchedKey: string | null;
  matchedLabel: string | null;
  /**
   * Present when a catalog row or an explicit alias decided the answer. A
   * dedicated Dorso-Lumbar examination is a composition, not a role pair, so the
   * canvas needs it to stop offering its own domains as screening modules.
   */
  composition?: StudyComposition;
  provenance?: CompositionProvenance;
};

type RoleSet = Partial<Record<SpineScreeningRegion, RegionRole>>;

/**
 * Dictionary of catalog code / billed-name → role set. Order matters: the most
 * specific entries (dedicated + screening combinations) match first.
 */
export const SCREENING_ROLE_DICTIONARY: Array<{
  key: string;
  label: string;
  codes: string[];
  /** Normalized name fragments, ALL of which must appear. */
  nameAll: string[];
  roles: RoleSet;
}> = [
  {
    key: "MRICEWSS",
    label: "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING",
    codes: ["MRICEWSS"],
    nameAll: ["CERVICAL", "WHOLE", "SCREENING"],
    roles: { cervical: "primary-dedicated", dorsal: "accompanying-screening", ls: "accompanying-screening" },
  },
  {
    key: "MRI038",
    label: "MRI LS SPINE WITH SCREENING WHOLE SPINE",
    codes: ["MRI038"],
    nameAll: ["LS", "WHOLE", "SCREENING"],
    roles: { ls: "primary-dedicated", cervical: "accompanying-screening", dorsal: "accompanying-screening" },
  },
  {
    key: "MRIDWSS",
    label: "MRI DORSAL SPINE WITH WHOLE SPINE SCREENING",
    // No such code exists in the catalog export — see RETIRED_CATALOG_ASSERTIONS.
    // The name rule stays, because a study can be booked under that wording
    // without the code; only the invented code is not claimed as evidence.
    codes: [],
    nameAll: ["DORSAL", "WHOLE", "SCREENING"],
    roles: { dorsal: "primary-dedicated", cervical: "accompanying-screening", ls: "accompanying-screening" },
  },
  {
    key: "MRI062",
    label: "MRI WHOLE SPINE SCREENING",
    codes: ["MRI062"],
    nameAll: ["WHOLE", "SCREENING"],
    roles: { cervical: "primary-screening", dorsal: "primary-screening", ls: "primary-screening" },
  },
  {
    key: "MRI016",
    label: "MRI CERVICAL SPINE SCREENING",
    codes: ["MRI016"],
    nameAll: ["CERVICAL", "SCREENING"],
    roles: { cervical: "primary-screening" },
  },
  {
    key: "MRI021",
    label: "MRI DORSAL SPINE SCREENING",
    codes: ["MRI021", "MRISCREENINGDORSAL"],
    nameAll: ["DORSAL", "SCREENING"],
    roles: { dorsal: "primary-screening" },
  },
  {
    key: "MRI037",
    label: "MRI LS SPINE SCREENING",
    codes: ["MRI037"],
    nameAll: ["LS", "SCREENING"],
    roles: { ls: "primary-screening" },
  },
];

/** Dedicated primary exams with no screening component. */
const DEDICATED_TOKENS: Array<{ tokens: string[]; region: SpineScreeningRegion }> = [
  { tokens: ["CERVICAL"], region: "cervical" },
  { tokens: ["DORSAL"], region: "dorsal" },
  { tokens: ["THORACIC"], region: "dorsal" },
  { tokens: ["LS"], region: "ls" },
  { tokens: ["LUMBOSACRAL"], region: "ls" },
  { tokens: ["LUMBAR"], region: "ls" },
];

function normalize(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function codeNormalize(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A bare "DL" in an examination name is not evidence of anything on its own.
 *
 * In this clinic's catalog `MRI020 / MRI DL SPINE` is the dedicated
 * dorso-lumbar study: it is its own booked row, priced like the other
 * dedicated spine exams and separate from "MRI DORSAL SPINE SCREENING", so it resolves
 * through `CONFIRMED_CATALOG_ROWS`, not through this fallback. What remains here
 * is the case where a name says "DL" with no recognizable code: nothing is
 * assumed, because guessing here would silently route a dorso-lumbar examination
 * into a dorsal-only report (dorsal spec §28, dorso-lumbar spec §24).
 */
const AMBIGUOUS_DORSOLUMBAR_RE = /\bDL\b|DORSO\s*LUMBAR|DORSOLUMBAR/;

const AMBIGUOUS_DORSOLUMBAR_LABEL =
  "unresolved dorso-lumbar booking label: \"DL\" is not an abbreviation for dorsal spine in this catalog. "
  + "No region role is assumed — set the roles in the header if the performed study differs.";

function isExplicitlyDorsal(name: string): boolean {
  return /\bDORSAL\b|\bTHORACIC\b/.test(name);
}

const ALL_REGIONS: SpineScreeningRegion[] = ["cervical", "dorsal", "ls"];

function absentRoles(): Record<SpineScreeningRegion, RegionRole> {
  return { cervical: "absent", dorsal: "absent", ls: "absent" };
}

/**
 * Resolve which screening modules exist and in what role. Falls back to "no
 * screening" so a plain dedicated study never grows screening prose by accident.
 *
 * Catalog evidence is consulted first, so a confirmed code such as `MRI020`
 * resolves through the clinic's own catalog rather than through a name
 * heuristic, and a dedicated Dorso-Lumbar examination is expressed as dedicated
 * components of one study instead of two screening regions (spec §7, §24).
 */
export function resolveScreeningRoles(input: BilledStudyInput): ResolvedScreeningRoles {
  const composition = resolveStudyComposition(input);
  if (composition.composition !== "unknown") {
    return {
      roles: composition.roles,
      matchedKey: composition.matchedKey,
      matchedLabel: composition.matchedLabel,
      composition: composition.composition,
      provenance: composition.provenance,
    };
  }

  const code = codeNormalize(input.code);
  const name = normalize(input.name);
  const blob = [name, normalize(input.studyDescription), normalize(input.reportTitle)]
    .filter(Boolean)
    .join(" ");

  for (const entry of SCREENING_ROLE_DICTIONARY) {
    const codeHit = code.length > 0 && entry.codes.some((c) => codeNormalize(c) === code);
    const nameHit = entry.nameAll.length > 0 && entry.nameAll.every((token) => name.includes(` ${token} `) || name.startsWith(`${token} `) || name.endsWith(` ${token}`));
    if (codeHit || nameHit) {
      const roles = absentRoles();
      for (const region of ALL_REGIONS) roles[region] = entry.roles[region] ?? "absent";
      return { roles, matchedKey: entry.key, matchedLabel: entry.label };
    }
  }

  const roles = absentRoles();
  // A bare "DL" with no catalog row behind it names nothing this code may assume.
  if (AMBIGUOUS_DORSOLUMBAR_RE.test(name) && !isExplicitlyDorsal(name)) {
    return { roles: absentRoles(), matchedKey: "AMBIGUOUS_DORSOLUMBAR", matchedLabel: AMBIGUOUS_DORSOLUMBAR_LABEL };
  }

  // The study is "of" the region named before "WITH … SCREENING"; a region
  // mentioned after those words ("whole spine screening of the cervical and
  // dorsal spine") is a screened region, not the primary.
  const primarySegment = blob.split(/\b(?:WITH|SCREENING)\b/)[0] ?? "";
  const dedicatedInPrimary = DEDICATED_TOKENS.find((d) => primarySegment.includes(d.tokens[0]!));
  const dedicatedAnywhere = DEDICATED_TOKENS.find((d) => blob.includes(d.tokens[0]!));
  const wholeSpineWords = blob.includes("WHOLE") && blob.includes("SCREENING");

  if (wholeSpineWords) {
    if (dedicatedInPrimary) {
      roles[dedicatedInPrimary.region] = "primary-dedicated";
      for (const region of ALL_REGIONS) {
        if (region !== dedicatedInPrimary.region) roles[region] = "accompanying-screening";
      }
      return {
        roles,
        matchedKey: `DEDICATED_${dedicatedInPrimary.region.toUpperCase()}_PLUS_SCREENING`,
        matchedLabel: `dedicated ${dedicatedInPrimary.region} spine with whole-spine screening`,
      };
    }
    // Whole-spine screening wording without a recognizable catalog entry.
    for (const region of ALL_REGIONS) roles[region] = "primary-screening";
    return {
      roles,
      matchedKey: "WHOLE_SPINE_SCREENING_TEXT",
      matchedLabel: "whole spine screening (from text)",
    };
  }

  const dedicated = dedicatedInPrimary ?? dedicatedAnywhere;
  if (dedicated) {
    roles[dedicated.region] = "primary-dedicated";
    return {
      roles,
      matchedKey: `DEDICATED_${dedicated.region.toUpperCase()}`,
      matchedLabel: `dedicated ${dedicated.region} spine study`,
    };
  }

  return { roles, matchedKey: null, matchedLabel: null };
}

/** Regions the canvas may offer as screening modules for this study. */
export function offeredScreeningRegions(roles: Record<SpineScreeningRegion, RegionRole>): SpineScreeningRegion[] {
  // A region reported as the dedicated primary is never also its own screening
  // module (spec §23 invariant), and roles are single-valued by construction.
  // A dedicated component of one examination (thoracic and lumbar domains of a
  // Dorso-Lumbar study) is dedicated anatomy, not screening (dorso-lumbar §7).
  return ALL_REGIONS.filter(
    (region) =>
      roleImpliesPerformed(roles[region])
      && roles[region] !== "primary-dedicated"
      && roles[region] !== DEDICATED_COMPONENT_ROLE,
  );
}

/** The dedicated primary region, if any — used to hide its own screening module. */
export function dedicatedPrimaryRegion(roles: Record<SpineScreeningRegion, RegionRole>): SpineScreeningRegion | null {
  return ALL_REGIONS.find((region) => roles[region] === "primary-dedicated") ?? null;
}

export function screeningRolesSummary(roles: Record<SpineScreeningRegion, RegionRole>): string {
  return ALL_REGIONS.map((region) => `${region}=${roles[region]}`).join(" ");
}
