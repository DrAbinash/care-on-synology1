/**
 * mriDorsoLumbarCatalog.ts — what the billed examination actually IS (spec §24).
 *
 * A Dorso-Lumbar study is its own composition. It is neither "dorsal screening +
 * LS screening" nor a dorsal report bolted to a lumbar report, so the thing that
 * decides the composition — the catalog row the clinic actually bills — has to be
 * auditable rather than guessed.
 *
 * This file therefore keeps three lists apart and never mixes them:
 *
 *  1. `CONFIRMED_CATALOG_ROWS` — rows read out of the clinic's own catalog
 *     export. Each carries its source so a later catalog change is a diff, not a
 *     rewrite of the resolver.
 *  2. `HEURISTIC_NAME_ALIASES` — spellings that are NOT in the export. They may
 *     resolve, but only with `provenance: "heuristic-alias"`, which the UI shows
 *     and the radiologist overrides.
 *  3. `RETIRED_CATALOG_ASSERTIONS` — codes an earlier revision of this code
 *     claimed as evidence without ever having seen the catalog. They are kept
 *     here, resolved to nothing, so the mistake cannot silently return.
 *
 * Anything that matches none of the three resolves to `"unknown"` with every
 * region absent: an unrecognised label never produces a clinical composition.
 *
 * Pure functions only — no store, no React, no database.
 */

import type { RegionRole, SpineScreeningRegion } from "./mriSpineScreeningSchema";

/**
 * The catalog export every confirmed row was read from. Evidence lives in data
 * fields on each row, not in a comment above the list: a future catalog change
 * is then a diff of rows and their sources, and a row that lost its evidence can
 * be found by machine.
 */
export const CATALOG_EVIDENCE_SOURCE = "test-catalog-2026-09-27.csv";
export const CATALOG_EVIDENCE_DATE = "2026-09-27";
/** Row count of the export the evidence was read from. */
export const CATALOG_EVIDENCE_ROWS = 452;

export type StudyComposition =
  | "dorsolumbar-dedicated"
  | "dorsal-dedicated"
  | "ls-dedicated"
  | "cervical-dedicated"
  | "whole-spine-screening"
  | "regional-screening"
  | "unknown";

export type CompositionProvenance = "catalog-code" | "catalog-name" | "heuristic-alias" | "none";

export type CatalogRoleSet = Partial<Record<SpineScreeningRegion, RegionRole>>;

export type ConfirmedCatalogRow = {
  /** `diagnostic_tests.code`. */
  code: string;
  /** `diagnostic_tests.name`, exactly as exported. */
  name: string;
  /** `diagnostic_tests.price`, kept only so the row can be re-found by hand. */
  price: string;
  composition: StudyComposition;
  roles: CatalogRoleSet;
  /** Where this row was read from — required, so no row ships without evidence. */
  evidenceSource: string;
  /** ISO date of that export. */
  evidenceDate: string;
  note?: string;
};

function catalogRow(
  row: Omit<ConfirmedCatalogRow, "evidenceSource" | "evidenceDate">
    & Partial<Pick<ConfirmedCatalogRow, "evidenceSource" | "evidenceDate">>,
): ConfirmedCatalogRow {
  return { evidenceSource: CATALOG_EVIDENCE_SOURCE, evidenceDate: CATALOG_EVIDENCE_DATE, ...row };
}

/**
 * A dedicated component of one examination. Thoracic and lumbar domains of a
 * Dorso-Lumbar study are dedicated anatomy, never independent screening modules
 * (spec §7) — that distinction is the whole reason this role exists.
 */
export const DEDICATED_COMPONENT_ROLE: RegionRole = "dedicated-component";

/**
 * Read from the export named in `CATALOG_EVIDENCE_SOURCE`. Codes `MRIC`, `MRID`,
 * `MRIL` and `MRI020` are the four dedicated spine examinations; `MRI020` is
 * "MRI DL SPINE", and because dorsal already holds its own code (`MRID`) "DL"
 * cannot be an abbreviation for dorsal here — it is the dorso-lumbar study,
 * priced like every other dedicated spine exam. The same DL convention appears
 * as `CTDLSP` and `XR022` beside separate thoracic/dorsal rows in those
 * modalities.
 */
export const CONFIRMED_CATALOG_ROWS: ConfirmedCatalogRow[] = [
  catalogRow({ code: "MRIC", name: "MRI CERVICAL SPINE", price: "8500.00", composition: "cervical-dedicated", roles: { cervical: "primary-dedicated" } }),
  catalogRow({ code: "MRID", name: "MRI DORSAL SPINE", price: "8500.00", composition: "dorsal-dedicated", roles: { dorsal: "primary-dedicated" } }),
  catalogRow({ code: "MRIL", name: "MRI LS SPINE", price: "8500.00", composition: "ls-dedicated", roles: { ls: "primary-dedicated" } }),
  catalogRow({
    code: "MRI020",
    name: "MRI DL SPINE",
    price: "8500.00",
    composition: "dorsolumbar-dedicated",
    roles: { dorsal: DEDICATED_COMPONENT_ROLE, ls: DEDICATED_COMPONENT_ROLE },
    note: "Dedicated dorso-lumbar examination: one coverage-aware study spanning thoracic, thoracolumbar junction and lumbar domains.",
  }),
  catalogRow({ code: "MRI016", name: "MRI CERVICAL SPINE SCREENING", price: "3000.00", composition: "regional-screening", roles: { cervical: "primary-screening" } }),
  catalogRow({ code: "MRI021", name: "MRI DORSAL SPINE SCREENING", price: "3000.00", composition: "regional-screening", roles: { dorsal: "primary-screening" } }),
  catalogRow({ code: "MRISCREENINGDORSAL", name: "MRI SCREENING DORSAL SPINE", price: "3000.00", composition: "regional-screening", roles: { dorsal: "primary-screening" }, note: "Second catalog row for dorsal screening; same composition as MRI021." }),
  catalogRow({ code: "MRI037", name: "MRI LS SPINE SCREENING", price: "3000.00", composition: "regional-screening", roles: { ls: "primary-screening" } }),
  catalogRow({ code: "MRI062", name: "MRI WHOLE SPINE SCREENING", price: "9000.00", composition: "whole-spine-screening", roles: { cervical: "primary-screening", dorsal: "primary-screening", ls: "primary-screening" } }),
  catalogRow({ code: "MRICEWSS", name: "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING", price: "14500.00", composition: "cervical-dedicated", roles: { cervical: "primary-dedicated", dorsal: "accompanying-screening", ls: "accompanying-screening" } }),
  catalogRow({ code: "MRI038", name: "MRI LS SPINE WITH SCREENING WHOLE SPINE", price: "14500.00", composition: "ls-dedicated", roles: { ls: "primary-dedicated", cervical: "accompanying-screening", dorsal: "accompanying-screening" } }),
];

/**
 * Spellings that carry the meaning but have no row in the export. They resolve,
 * always as `heuristic-alias`, so the canvas can say "this came from the name,
 * not the catalog" and the radiologist can correct it.
 *
 * Tokens are matched as substrings of the punctuation-free name, because
 * "DORSOLUMBAR" contains neither word as a whole token. Every alias therefore
 * requires both halves of the junction, so a plain "MRI LUMBAR SPINE" or
 * "MRI DORSAL SPINE" booking can never be pulled into it. Short three-letter
 * forms such as "TLS" are deliberately absent — too easy to match by accident.
 */
export const HEURISTIC_NAME_ALIASES: Array<{
  key: string;
  /** Normalized fragments, ALL of which must appear. */
  tokens: string[];
  composition: StudyComposition;
  roles: CatalogRoleSet;
}> = [
  {
    key: "ALIAS-DORSO-LUMBAR-NAME",
    tokens: ["DORSO", "LUMBAR"],
    composition: "dorsolumbar-dedicated",
    roles: { dorsal: DEDICATED_COMPONENT_ROLE, ls: DEDICATED_COMPONENT_ROLE },
  },
  {
    key: "ALIAS-THORACO-LUMBAR-NAME",
    tokens: ["THORACO", "LUMBAR"],
    composition: "dorsolumbar-dedicated",
    roles: { dorsal: DEDICATED_COMPONENT_ROLE, ls: DEDICATED_COMPONENT_ROLE },
  },
];

/**
 * Assertions an earlier revision made about the catalog without evidence. They
 * resolve to nothing on purpose, and the disproof is recorded as data so nobody
 * re-adds them as a "fix".
 */
export type RetiredCatalogAssertion = {
  code: string;
  /** The claim that was retracted, exactly as it was written. */
  wasClaimedAs: string;
  /** What the audited evidence actually says. */
  reason: string;
  /** Export or seed the disproof was read from. */
  evidenceSource: string;
  /** ISO date the retraction was verified. */
  retractedOn: string;
};

export const RETIRED_CATALOG_ASSERTIONS: RetiredCatalogAssertion[] = [
  {
    code: "MRI039",
    wasClaimedAs: "MRI DORSOLUMBAR SPINE",
    reason: 'Absent from the catalog export; scripts/src/import-test-catalog.ts generates MRI039 as "MRI MAMMOGRAPHY B/L".',
    evidenceSource: CATALOG_EVIDENCE_SOURCE,
    retractedOn: CATALOG_EVIDENCE_DATE,
  },
  {
    code: "MRIDWSS",
    wasClaimedAs: "MRI DORSAL SPINE WITH WHOLE SPINE SCREENING",
    reason: "No such code in the catalog export; name-based resolution still reaches that composition.",
    evidenceSource: CATALOG_EVIDENCE_SOURCE,
    retractedOn: CATALOG_EVIDENCE_DATE,
  },
];

export type CompositionInput = {
  code?: string | null;
  name?: string | null;
  studyDescription?: string | null;
  protocolName?: string | null;
  reportTitle?: string | null;
};

export type ResolvedStudyComposition = {
  composition: StudyComposition;
  provenance: CompositionProvenance;
  /** The catalog code / alias key that decided it, for the UI to show its work. */
  matchedKey: string | null;
  matchedLabel: string | null;
  roles: Record<SpineScreeningRegion, RegionRole>;
  /** True when the answer came from a catalog row rather than a name guess. */
  evidenceBacked: boolean;
  /** Export the deciding row was read from; null for a name-only inference. */
  evidenceSource: string | null;
  evidenceDate: string | null;
  note: string | null;
};

const ALL_REGIONS: SpineScreeningRegion[] = ["cervical", "dorsal", "ls"];

function absentRoles(): Record<SpineScreeningRegion, RegionRole> {
  return { cervical: "absent", dorsal: "absent", ls: "absent" };
}

function withRoles(set: CatalogRoleSet): Record<SpineScreeningRegion, RegionRole> {
  const roles = absentRoles();
  for (const region of ALL_REGIONS) roles[region] = set[region] ?? "absent";
  return roles;
}

/** Codes and names are matched on a punctuation-free form, never on display text. */
export function catalogKey(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function catalogWords(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function unknown(reason: string): ResolvedStudyComposition {
  return {
    composition: "unknown",
    provenance: "none",
    matchedKey: null,
    matchedLabel: null,
    roles: absentRoles(),
    evidenceBacked: false,
    evidenceSource: null,
    evidenceDate: null,
    note: reason,
  };
}

function fromRow(
  row: ConfirmedCatalogRow,
  provenance: CompositionProvenance,
  note: string | null,
): ResolvedStudyComposition {
  return {
    composition: row.composition,
    provenance,
    matchedKey: row.code,
    matchedLabel: row.name,
    roles: withRoles(row.roles),
    evidenceBacked: true,
    evidenceSource: row.evidenceSource,
    evidenceDate: row.evidenceDate,
    note,
  };
}

/**
 * Resolve what was actually bought. Code evidence beats name evidence, which
 * beats an alias; nothing is inferred from a single token such as "DL" unless a
 * confirmed row or an explicit alias carries it.
 */
export function resolveStudyComposition(input: CompositionInput): ResolvedStudyComposition {
  const code = catalogKey(input.code);
  const nameWords = catalogWords(input.name);

  if (code) {
    const row = CONFIRMED_CATALOG_ROWS.find((r) => catalogKey(r.code) === code);
    if (row) {
      if (nameWords && row.name && catalogWords(row.name) !== nameWords) {
        // Same code, different printed name: the catalog changed under us. The
        // composition still comes from the code, but the mismatch is surfaced.
        return fromRow(row, "catalog-code",
          `Catalog code ${row.code} is recorded as "${row.name}" in ${row.evidenceSource} but this study is labelled "${input.name}". Confirm the booking still matches the examination.`);
      }
      return fromRow(row, "catalog-code", row.note ?? null);
    }
    if (RETIRED_CATALOG_ASSERTIONS.some((r) => catalogKey(r.code) === code)) {
      return unknown(`Catalog code ${input.code} was once claimed as a spine composition without evidence; it resolves to nothing.`);
    }
  }

  const nameRow = CONFIRMED_CATALOG_ROWS.find((r) => catalogWords(r.name) === nameWords && nameWords.length > 0);
  if (nameRow) {
    return fromRow(nameRow, "catalog-name", nameRow.note ?? null);
  }

  const blob = [input.name, input.studyDescription, input.protocolName, input.reportTitle]
    .map(catalogWords)
    .filter(Boolean)
    .join(" ");
  if (blob) {
    for (const alias of HEURISTIC_NAME_ALIASES) {
      if (alias.tokens.every((token) => blob.includes(token))) {
        return {
          composition: alias.composition,
          provenance: "heuristic-alias",
          matchedKey: alias.key,
          matchedLabel: alias.composition.replace(/-/g, " "),
          roles: withRoles(alias.roles),
          evidenceBacked: false,
          evidenceSource: null,
          evidenceDate: null,
          note: "Composition inferred from the examination wording, not from a catalog code. Set the region roles if the performed study differs.",
        };
      }
    }
  }

  return unknown("No catalog code or recognised examination name identifies this study's composition; no clinical composition is assumed.");
}

/** Is this composition a dedicated Dorso-Lumbar examination? */
export function isDorsoLumbarDedicated(composition: StudyComposition | null | undefined): boolean {
  return composition === "dorsolumbar-dedicated";
}

/** Human wording for the canvas header / billing match line. */
export function compositionSummary(resolved: ResolvedStudyComposition): string {
  const label = resolved.matchedLabel ? `${resolved.matchedLabel} · ` : "";
  const basis = resolved.provenance === "none"
    ? "unresolved"
    : resolved.provenance === "heuristic-alias"
      ? "inferred from the examination name"
      : resolved.provenance === "catalog-name"
        ? "matched on the billed name"
        : `matched on catalog code ${resolved.matchedKey}`;
  return `${label}${resolved.composition.replace(/-/g, " ")} (${basis})`;
}

/**
 * The one statement a Dorso-Lumbar composition must never make: that its
 * thoracic and lumbar domains are two independent screening modules.
 */
export function dorsolumbarRolesAreOneComposition(
  roles: Record<SpineScreeningRegion, RegionRole>,
): boolean {
  return roles.dorsal === DEDICATED_COMPONENT_ROLE && roles.ls === DEDICATED_COMPONENT_ROLE;
}
