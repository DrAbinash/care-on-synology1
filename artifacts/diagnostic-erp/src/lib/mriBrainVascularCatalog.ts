/**
 * mriBrainVascularCatalog.ts — what the booking says the vascular part of this
 * study IS (mra/mrv spec §2), kept strictly apart from what was performed.
 *
 * Four capabilities share one brain report, so the module needs a role per vascular
 * domain rather than one flag:
 *
 *   dedicated          a dedicated acquisition of that domain, reported in full
 *   basic-screening    the limited intracranial angiographic screening that rides
 *                      inside a routine MRI Brain (§14)
 *   accompanying       vascular content present because another study carries it
 *   absent             nothing to report for that domain
 *
 * The decisive rule is §2's last paragraph: "Billing label alone must not fabricate
 * a performed vascular sequence." This resolver therefore only ever proposes
 * ROLES. Whether TOF or contrast-enhanced angiography was actually acquired comes
 * from the technique text in `mriBrainVascularTechnique.ts`, and the radiologist
 * overrides both.
 *
 * Evidence discipline mirrors the Dorso-Lumbar resolver, because guessing here has
 * a specific failure mode: a lower-limb "MR ANGIOGRAPHY" booking would otherwise
 * light up an intracranial arterial panel. Confirmed rows, ambiguous names and
 * explicitly-excluded other-site angiography are three separate lists, and every
 * confirmed row carries the export it came from as DATA rather than as a comment.
 *
 * Pure functions only — no store, no React.
 */

export const VASCULAR_CATALOG_EVIDENCE_SOURCE = "test-catalog-2026-09-27.csv";
export const VASCULAR_CATALOG_EVIDENCE_DATE = "2026-09-27";

/** The vascular domains this task reports. */
export type VascularDomain = "mraIntracranial" | "mraNeck" | "mrv" | "mraBasicScreening";

export const VASCULAR_DOMAINS: VascularDomain[] = [
  "mraIntracranial",
  "mraNeck",
  "mrv",
  "mraBasicScreening",
];

export type VascularModuleRole = "dedicated" | "basic-screening" | "accompanying" | "absent";

export type VascularRoles = Record<VascularDomain, VascularModuleRole>;

export type VascularComposition =
  | "brain-only"
  | "brain-with-basic-mra-screening"
  | "brain-plus-mra-intracranial"
  | "brain-plus-mrv"
  | "brain-plus-mra-and-mrv"
  | "mra-intracranial-dedicated"
  | "mra-neck-dedicated"
  | "mrv-dedicated"
  | "unknown";

export type VascularProvenance = "catalog-code" | "catalog-name" | "heuristic-alias" | "none";

export type ConfirmedVascularRow = {
  code: string;
  name: string;
  price: string;
  composition: VascularComposition;
  roles: Partial<Record<VascularDomain, VascularModuleRole>>;
  evidenceSource: string;
  evidenceDate: string;
  note?: string;
};

function row(r: Omit<ConfirmedVascularRow, "evidenceSource" | "evidenceDate">): ConfirmedVascularRow {
  return {
    evidenceSource: VASCULAR_CATALOG_EVIDENCE_SOURCE,
    evidenceDate: VASCULAR_CATALOG_EVIDENCE_DATE,
    ...r,
  };
}

/**
 * Read straight from the live export. `MRA OF NECK AND CEREBRAL VESSELS` is the one
 * row that books both arterial domains, and the neck-only rows are kept separate
 * from the brain rows so a carotid study never grows a circle-of-Willis panel.
 */
export const CONFIRMED_VASCULAR_ROWS: ConfirmedVascularRow[] = [
  row({
    code: "MRI005",
    name: "MRA OF NECK AND CEREBRAL VESSELS",
    price: "10000.00",
    composition: "mra-intracranial-dedicated",
    roles: { mraIntracranial: "dedicated", mraNeck: "dedicated" },
    note: "One booking, two dedicated arterial territories; the Findings order keeps them in separate sections.",
  }),
  row({
    code: "MRI009",
    name: "MRI BRAIN + ANGIO",
    price: "11000.00",
    composition: "brain-plus-mra-intracranial",
    roles: { mraIntracranial: "dedicated" },
    note: "The angiographic component is booked with the brain study; the name does not limit it to a screening acquisition, so it is treated as dedicated and the radiologist narrows it if the performed sequence is limited.",
  }),
  row({
    code: "MRI044",
    name: "MRI NECK VESSELS / CAROTID ARTERY",
    price: "8500.00",
    composition: "mra-neck-dedicated",
    roles: { mraNeck: "dedicated" },
  }),
  row({
    code: "MRI045",
    name: "MRI NECK+ANGIO",
    price: "12500.00",
    composition: "mra-neck-dedicated",
    roles: { mraNeck: "dedicated" },
    note: "Neck vessels, not brain. No intracranial domain is implied.",
  }),
  row({
    code: "MRINECKW",
    name: "MRI NECK WITH ANGIO",
    price: "12500.00",
    composition: "mra-neck-dedicated",
    roles: { mraNeck: "dedicated" },
  }),
];

/**
 * Booked names that are real but do not identify a vascular SITE. Resolving them
 * to a brain module would be the invention this file exists to prevent, so they
 * stay here with the reason, and the UI asks the radiologist what was performed.
 */
export type AmbiguousVascularRow = {
  code: string;
  name: string;
  price: string;
  reason: string;
  evidenceSource: string;
  evidenceDate: string;
};

export const AMBIGUOUS_VASCULAR_ROWS: AmbiguousVascularRow[] = [
  {
    code: "MRIANGIO",
    name: "MR ANGIOGRAPHY",
    price: "4500.00",
    reason: "No site in the billed name. The export separately books lower-limb, upper-limb and renal MR angiography, so 'MR ANGIOGRAPHY' alone cannot establish an intracranial or neck study.",
    evidenceSource: VASCULAR_CATALOG_EVIDENCE_SOURCE,
    evidenceDate: VASCULAR_CATALOG_EVIDENCE_DATE,
  },
  {
    code: "MRI004",
    name: "MR VENOGRAPHY",
    price: "3500.00",
    reason: "No site in the billed name; the export also books lower-limb venography (MRIVENO, MRIVENOl).",
    evidenceSource: VASCULAR_CATALOG_EVIDENCE_SOURCE,
    evidenceDate: VASCULAR_CATALOG_EVIDENCE_DATE,
  },
];

/**
 * Vascular bookings at OTHER sites. Listed positively so an exclusion is a decision
 * with a reason rather than an absence of a match.
 */
export const NON_CEREBRAL_VASCULAR_CODES = [
  "MRANGIO",
  "MRIVENO",
  "MRIVENOl",
  "MRIULANGIO",
  "MRI051",
] as const;

// Upper-cased on purpose: the live export carries one code with a lowercase letter
// (`MRIVENOl`), and the comparison key is always normalised.
const NON_CEREBRAL_SET = new Set<string>(NON_CEREBRAL_VASCULAR_CODES.map((c) => c.toUpperCase()));

/**
 * Billed names confirmed in the live export but missing from the repository's own
 * import seed (`scripts/src/import-test-catalog.ts`). Named here so the seed
 * cross-check in the test suite stays true without pretending the seed is the
 * catalog: the seed generates codes by array position, and those positional codes do
 * not match the codes CARE actually runs with, so only the NAMES corroborate.
 */
export const LIVE_EXPORT_ONLY_VASCULAR_NAMES: Array<{ name: string; reason: string }> = [
  {
    name: "MRI NECK WITH ANGIO",
    reason: "Live code MRINECKW in the 2026-09-27 export; the repository seed books the neck under MRI NECK+ANGIO only.",
  },
];

/** Every domain absent — the state before anything is known. */
export function emptyVascularRoles(): VascularRoles {
  return {
    mraIntracranial: "absent",
    mraNeck: "absent",
    mrv: "absent",
    mraBasicScreening: "absent",
  };
}

export type VascularCompositionInput = {
  code?: string | null;
  name?: string | null;
  studyDescription?: string | null;
  protocolName?: string | null;
  reportTitle?: string | null;
  modality?: string | null;
  region?: string | null;
};

export type ResolvedVascularComposition = {
  composition: VascularComposition;
  roles: VascularRoles;
  provenance: VascularProvenance;
  matchedKey: string | null;
  matchedLabel: string | null;
  evidenceSource: string | null;
  evidenceDate: string | null;
  /** True when a real vascular booking names no site, so nothing was asserted. */
  ambiguous: boolean;
  note: string;
};

function unknown(note: string, extra: Partial<ResolvedVascularComposition> = {}): ResolvedVascularComposition {
  return {
    composition: "unknown",
    roles: emptyVascularRoles(),
    provenance: "none",
    matchedKey: null,
    matchedLabel: null,
    evidenceSource: null,
    evidenceDate: null,
    ambiguous: false,
    note,
    ...extra,
  };
}

function fromRow(
  row: ConfirmedVascularRow,
  provenance: VascularProvenance,
  note: string,
): ResolvedVascularComposition {
  return {
    composition: row.composition,
    roles: { ...emptyVascularRoles(), ...row.roles },
    provenance,
    matchedKey: row.code,
    matchedLabel: row.name,
    evidenceSource: row.evidenceSource,
    evidenceDate: row.evidenceDate,
    ambiguous: false,
    note,
  };
}

export function vascularCatalogKey(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function vascularCatalogWords(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

const CEREBRAL_ARTERY_WORDS = /\bCEREBRAL\b|\bBRAIN\b|\bINTRACRANIAL\b|\bCIRCLE OF WILLIS\b|\bCAROTID\b|\bVERTEBRAL\b|\bNECK\b/;
const CEREBRAL_VENOUS_WORDS = /\bBRAIN\b|\bINTRACRANIAL\b|\bDURAL\b|\bVENOUS SINUS\b|\bSAGITTAL\b|\bTRANSVERSE\b/;

/**
 * Booked words that mean "angiography of the brain vessels" without a catalog code.
 * Deliberately narrower than the code list: `MR ANGIOGRAPHY` alone is on the
 * ambiguous side precisely because it cannot tell these apart.
 */
const NAME_ALIASES: Array<{ re: RegExp; composition: VascularComposition; roles: Partial<VascularRoles>; label: string }> = [
  {
    re: /\bMRA\b[^|]{0,40}\b(CEREBRAL|INTRACRANIAL|BRAIN|CIRCLE OF WILLIS)\b/,
    composition: "mra-intracranial-dedicated",
    roles: { mraIntracranial: "dedicated" },
    label: "intracranial MRA",
  },
  {
    re: /\bMRA\b[^|]{0,40}\b(NECK|CAROTID|VERTEBRAL)\b/,
    composition: "mra-neck-dedicated",
    roles: { mraNeck: "dedicated" },
    label: "neck MRA",
  },
  {
    re: /\bMRV\b[^|]{0,40}\b(BRAIN|INTRACRANIAL|DURAL|VENOUS SINUS)\b|\b(MRV|VENOGRAPHY)\b[^|]{0,40}\bSINUS\b/,
    composition: "mrv-dedicated",
    roles: { mrv: "dedicated" },
    label: "MR venography of the brain",
  },
];

/**
 * Resolve the vascular ROLES this booking proposes.
 *
 * Order matters and is auditable: an exact catalog code beats a billed name, which
 * beats a spelled-out alias; a confirmed other-site or site-less angiography stops
 * the resolution rather than falling through to a guess.
 */
export function resolveVascularComposition(
  input: VascularCompositionInput,
): ResolvedVascularComposition {
  const modality = (input.modality ?? "").trim().toUpperCase();
  if (modality && modality !== "MR" && modality !== "MRI") {
    return unknown(`Modality ${modality} is not MR, so no MR angiographic module is proposed.`);
  }

  const code = vascularCatalogKey(input.code);
  const name = vascularCatalogWords(input.name);

  const ambiguous = AMBIGUOUS_VASCULAR_ROWS.find(
    (r) => (code && r.code.toUpperCase() === code) || (name && vascularCatalogWords(r.name) === name),
  );
  if (ambiguous) {
    return {
      ...unknown(ambiguous.reason, {
        provenance: "catalog-code",
        matchedKey: ambiguous.code,
        matchedLabel: ambiguous.name,
        evidenceSource: ambiguous.evidenceSource,
        evidenceDate: ambiguous.evidenceDate,
      }),
      ambiguous: true,
    };
  }

  if (code && NON_CEREBRAL_SET.has(code)) {
    return {
      ...unknown(`${code} is angiography or venography at another site, so no cerebral vascular module applies.`),
      provenance: "catalog-code",
      matchedKey: code,
    };
  }

  const byCode = code
    ? CONFIRMED_VASCULAR_ROWS.find((r) => r.code.toUpperCase() === code)
    : undefined;
  if (byCode) return fromRow(byCode, "catalog-code", `Matched catalog code ${byCode.code}.`);

  const byName = name
    ? CONFIRMED_VASCULAR_ROWS.find((r) => vascularCatalogWords(r.name) === name)
    : undefined;
  if (byName) return fromRow(byName, "catalog-name", `Matched the billed name ${byName.name}.`);

  const blob = [name, vascularCatalogWords(input.studyDescription), vascularCatalogWords(input.protocolName), vascularCatalogWords(input.reportTitle)]
    .filter(Boolean)
    .join(" | ");
  for (const alias of NAME_ALIASES) {
    if (!alias.re.test(blob)) continue;
    // A neck/carotid phrase must not pass for a cerebral one: require the site
    // words this alias actually claims.
    if (alias.composition === "mra-intracranial-dedicated" && !CEREBRAL_ARTERY_WORDS.test(blob)) continue;
    if (alias.composition === "mrv-dedicated" && !CEREBRAL_VENOUS_WORDS.test(blob)) continue;
    return {
      ...fromRow(
        {
          code: alias.label,
          name: alias.label,
          price: "",
          composition: alias.composition,
          roles: alias.roles,
          evidenceSource: VASCULAR_CATALOG_EVIDENCE_SOURCE,
          evidenceDate: VASCULAR_CATALOG_EVIDENCE_DATE,
        },
        "heuristic-alias",
        `Inferred ${alias.label} from the recorded examination wording, not from a catalog code.`,
      ),
    };
  }

  if (/\bMRI BRAIN\b/.test(blob) || vascularCatalogKey(input.region).includes("BRAIN")) {
    return {
      ...unknown("A brain study with no angiographic booking; the vascular modules stay off until the radiologist states what was acquired."),
      composition: "brain-only",
      provenance: "catalog-name",
    };
  }

  return unknown("Nothing in the booking identifies a vascular composition, so no clinical module is assumed.");
}

/** Is this domain dedicated (full workflow) rather than screening or absent? */
export function isVascularDedicated(
  roles: VascularRoles | null | undefined,
  domain: VascularDomain,
): boolean {
  return roles?.[domain] === "dedicated";
}

/** Does any vascular content belong in this report at all? */
export function hasVascularContent(roles: VascularRoles | null | undefined): boolean {
  if (!roles) return false;
  return VASCULAR_DOMAINS.some((d) => roles[d] !== "absent");
}

/** Wording for the canvas header / billing match line. */
export function vascularCompositionSummary(resolved: ResolvedVascularComposition): string {
  const basis = resolved.provenance === "none"
    ? "unresolved"
    : resolved.provenance === "heuristic-alias"
      ? "inferred from the examination wording"
      : resolved.provenance === "catalog-name"
        ? "matched on the billed name"
        : `matched on catalog code ${resolved.matchedKey}`;
  const active = VASCULAR_DOMAINS.filter((d) => resolved.roles[d] !== "absent");
  return `${resolved.composition.replace(/-/g, " ")} · ${active.length ? active.join(", ") : "no vascular module"} (${basis})`;
}

/**
 * §14: the screening role is never a billing decision. A limited angiographic
 * acquisition inside a brain study is either recorded in the technique or stated by
 * the radiologist, so the resolver only ever proposes it as absent and the UI sets
 * it explicitly.
 */
export function screeningRoleFromBilling(): VascularModuleRole {
  return "absent";
}
