/**
 * anatomyMetadataAudit — a read-only inventory of the clinical anatomy metadata
 * CARE already ships, and the measurable distance between what exists and what
 * anatomical ordering of Findings would need.
 *
 * C2 established that Findings order depends on the order a radiologist clicked,
 * and that a safe anatomical re-order is not currently possible. This module does
 * NOT reorder anything and does NOT participate in report composition — it is
 * imported by its own test and by `scripts/audit-clinical-anatomy-metadata.mjs`
 * and by nothing else. It takes the data as arguments and declares no imports at
 * all, so it cannot drag the reporting runtime (or a database) into a tool run.
 *
 * The rule set distinguishes four states, because collapsing them is how a
 * coverage report starts lying:
 *   PRESENT          a usable, recognised value
 *   MISSING          applicable, and absent
 *   NOT_APPLICABLE   this entity kind has no business carrying the field
 *   UNKNOWN          a value is there, but it resolves to nothing known
 * UNKNOWN is never counted as PRESENT, and never guessed at.
 */

export type FieldStatus = "PRESENT" | "MISSING" | "NOT_APPLICABLE" | "UNKNOWN";
export type Severity = "ERROR" | "WARNING" | "INFORMATIONAL" | "REQUIRES_RADIOLOGIST_REVIEW";

export type AuditFinding = {
  rule: string;
  severity: Severity;
  /** Stable, human-identifiable subject: `MRI Brain / Acute infarct (DWI)`. */
  subject: string;
  detail: string;
};

export type FieldAudit = { status: FieldStatus; value: string; note?: string };

/** The subset of a Quick Select tile this audit reads. Structural, so the ERP
 *  type stays the single definition and this module imports nothing. */
export interface AuditTile {
  id: string;
  label: string;
  field: string;
  category?: string;
  scopeModality?: string;
  scopeBodyPart?: string;
  sentence: string;
  concept?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  properties?: string;
}

export interface AuditContentPack {
  concept: string;
  aliases: readonly string[];
  regions?: readonly string[];
  modalities?: readonly string[];
}

export interface AuditManifestObservation {
  concept: string;
  field: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  level?: string;
  laterality?: string;
  region?: string;
  renderedText: string;
}

export interface AuditManifest {
  /** Catalogue identifier, e.g. `MRI Brain — Standard Normal`. */
  name: string;
  revision?: string;
  modality?: string;
  bodyPart?: string;
  protocolScope?: string;
  observations: readonly AuditManifestObservation[];
}

/** One `INSERT INTO radiology_quick_findings …` block, already parsed. Parsing
 *  SQL is done by the caller so this module stays free of file-system access. */
export interface AuditSeedBatch {
  file: string;
  rowCount: number;
  columns: readonly string[];
  /** Per-column count of rows whose value is a non-empty, non-placeholder literal. */
  populated: Readonly<Record<string, number>>;
}

/**
 * The examinations the clinical-metadata readiness review asks about, in the
 * catalogue's own `scopeModality` / `scopeBodyPart` spelling where one exists.
 *
 * This is a review schedule, not clinical data: it says which questions the
 * audit must be able to answer, and a scope listed here with no findings tile
 * is reported as an explicit zero (C3-R24) rather than being silently absent.
 * Where the review name and the catalogue name only *probably* match — US
 * "Abdomen" for a whole-abdomen scan, MR "LS Spine" for a lumbar request — that
 * is recorded as a mapping question in the review register, not resolved here.
 */
export const RADIOLOGY_READINESS_SCOPES: readonly { modality: string; bodyPart: string }[] = Object.freeze([
  { modality: "MR", bodyPart: "Brain" },
  { modality: "MR", bodyPart: "Cervical Spine" },
  { modality: "MR", bodyPart: "Dorsal Spine" },
  { modality: "MR", bodyPart: "LS Spine" },
  { modality: "CT", bodyPart: "Brain" },
  { modality: "US", bodyPart: "Abdomen" },
  { modality: "MR", bodyPart: "MRCP" },
  { modality: "US", bodyPart: "Lower Limb Arterial Doppler" },
  { modality: "US", bodyPart: "Lower Limb Venous Doppler" },
  { modality: "MG", bodyPart: "Breast" },
  { modality: "XR", bodyPart: "Chest" },
]);

/** What one seed SQL file contributes, kept as counts so no sentence text is copied. */
export type SeedRowCensus = {
  file: string;
  rowCount: number;
  section: number;
  conflictGroup: number;
  baselineReplaces: number;
  templateTokensInSection: number;
  unparsedRows: number;
  hasConceptColumn: boolean;
};

export interface AuditInput {
  tiles: readonly AuditTile[];
  packs: readonly AuditContentPack[];
  manifests: readonly AuditManifest[];
  seedBatches?: readonly AuditSeedBatch[];
  /** `findingsCompose.SECTION_ORDER` — the Findings-Library vocabulary. */
  librarySectionOrder?: readonly string[];
  /**
   * Examinations the reader needs an answer for. A scope with no findings tile
   * is reported as an explicit zero, because "no metadata exists" and "nothing
   * was checked" otherwise look identical in the output.
   */
  requestedScopes?: readonly { modality: string; bodyPart: string }[];
}

export type TileRecord = {
  subject: string;
  label: string;
  modality: string;
  bodyPart: string;
  field: string;
  /** The tile's own clinical category (`normal` | `abnormal` | `variant` | `critical`). */
  category: string;
  concept: FieldAudit;
  anatomicalSection: FieldAudit;
  conflictGroup: FieldAudit;
  baselineReplaces: FieldAudit;
  laterality: FieldAudit;
  level: FieldAudit;
  sortOrder: FieldAudit;
  contentPack: FieldAudit;
};

export type ManifestRecord = {
  name: string;
  revision: string;
  modality: string;
  bodyPart: string;
  observationCount: number;
  findingsObservationCount: number;
  distinctConcepts: number;
  repeatingConcepts: string[];
  sectionsInOrder: string[];
  observationsWithoutSection: number;
};

export type CoverageByScope = {
  scope: string;
  modality: string;
  bodyPart: string;
  field: string;
  tiles: number;
  withConcept: number;
  conceptResolves: number;
  withAnatomicalSection: number;
  sectionKnown: number;
  withConflictGroup: number;
  withBaselineReplaces: number;
  lateralityApplicable: number;
  lateralityDeclared: number;
  levelApplicable: number;
  levelDeclared: number;
  mappedToManifestConcept: number;
  unresolvedPlacement: number;
};

export type AuditResult = {
  findings: AuditFinding[];
  tiles: TileRecord[];
  manifests: ManifestRecord[];
  coverage: CoverageByScope[];
  /** Per-file census of the seeded rows the audit actually read. */
  seeds: SeedRowCensus[];
  counts: Record<Severity, number>;
  totals: {
    tiles: number;
    findingsTiles: number;
    packs: number;
    manifests: number;
    /** Findings tiles carrying a concept that resolves to a content pack. */
    conceptBearingTiles: number;
    /** …and that also match a concept the examination's own baseline declares. */
    manifestMappedTiles: number;
    errorCount: number;
  };
};

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const BLANK_MEASURE_RE = /_{2,}/;
/** A real inter-vertebral level: C1-C2 … S1-S2, allowing `L4/L5`. */
const LOOKS_LIKE_LEVEL_RE = /[CSLDT]\d{1,2}\s*[-/]\s*(?:S?1|[CSLDT]\d{1,2})/i;
const VALID_LATERALITY = new Set(["left", "right", "bilateral", "present"]);
/** The only parameters `quickSelectParameterContract.ts` resolves (`QuickSelectParameterName`). */
// `level` joined the Quick Select parameter contract at Phase 3, item B
// (2026-10-21): the strip offers a level control and the boundary validates the
// value, so a parameterized spine tile's {level} is a parameter a click can
// resolve — not an unresolved token the C3 rule flags.
const KNOWN_QUICK_SELECT_PARAMS = new Set(["side", "severity", "level"]);
/** Highest vertebra that exists per region. A well-formed string can still name
 *  a level that is not real — "L7-L9" matches the pattern but lumbar vertebrae
 *  stop at L5, and an impossible level in a baseline would silently break the
 *  level-keyed ordering a later milestone depends on. */
const MAX_VERTEBRA_BY_REGION: Record<string, number> = { C: 7, T: 12, L: 5, S: 5 };

function isPlausibleLevel(raw: string): boolean {
  const t = raw.trim();
  const m = t.match(/^([CTLS]\d{1,2})\s*[-/]\s*(S1|[CTLS]\d{1,2})$/i);
  if (!m) return false;
  const parts = [m[1]!.toUpperCase(), m[2]!.toUpperCase()] as const;
  for (const p of parts) {
    const region = p[0]!;
    const n = Number(p.slice(1));
    if (!Number.isFinite(n) || n < 1 || n > (MAX_VERTEBRA_BY_REGION[region] ?? 0)) return false;
  }
  return true;
}

const norm = (s: string | undefined | null): string =>
  (s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const isBlank = (s: string | undefined | null): boolean => !(s ?? "").trim();

/** `{side}`-style tokens, deduplicated, in first-seen order. */
function placeholdersOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

/** A value that is present but is actually a template token, not data. */
const isTemplateLiteral = (v: string): boolean => /^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(v.trim());

export function auditClinicalMetadata(input: AuditInput): AuditResult {
  const findings: AuditFinding[] = [];
  const push = (rule: string, severity: Severity, subject: string, detail: string): void => {
    findings.push({ rule, severity, subject, detail });
  };

  // ── indexes over the authoritative vocabularies ────────────────────────────
  const packIds = new Map<string, number>();
  const aliasOwners = new Map<string, Set<string>>();
  for (const p of input.packs) {
    packIds.set(p.concept, (packIds.get(p.concept) ?? 0) + 1);
    for (const a of [...p.aliases, p.concept]) {
      const k = norm(a);
      if (!k) continue;
      if (!aliasOwners.has(k)) aliasOwners.set(k, new Set());
      aliasOwners.get(k)!.add(p.concept);
    }
  }

  // Per-examination section vocabulary, from the clinic-approved baselines.
  const sectionsByExam = new Map<string, Set<string>>();
  const conceptsByExam = new Map<string, Set<string>>();
  const renderedByExam = new Map<string, Set<string>>();
  for (const m of input.manifests) {
    const exam = `${norm(m.modality)}/${norm(m.bodyPart)}`;
    if (!sectionsByExam.has(exam)) {
      sectionsByExam.set(exam, new Set());
      conceptsByExam.set(exam, new Set());
      renderedByExam.set(exam, new Set());
    }
    for (const o of m.observations) {
      if (!isBlank(o.anatomicalSection)) sectionsByExam.get(exam)!.add(norm(o.anatomicalSection));
      if (o.field === "findings") conceptsByExam.get(exam)!.add(norm(o.concept));
      renderedByExam.get(exam)!.add(norm(o.renderedText));
    }
  }

  // ── concept vocabulary health ──────────────────────────────────────────────
  for (const [concept, n] of packIds) {
    if (n > 1) {
      push("C3-R05", "ERROR", `contentPacks/${concept}`,
        `canonical concept "${concept}" is declared ${n} times; alias resolution becomes declaration-order dependent`);
    }
  }
  for (const [alias, owners] of aliasOwners) {
    if (owners.size > 1) {
      push("C3-R06", "REQUIRES_RADIOLOGIST_REVIEW", `alias/${alias}`,
        `alias "${alias}" is claimed by ${[...owners].sort().join(", ")} — the resolver keeps the first declaration, so one clinical term silently means one of these`);
    }
  }

  // ── baseline manifests ─────────────────────────────────────────────────────
  const manifests: ManifestRecord[] = [];
  for (const m of input.manifests) {
    const fObs = m.observations.filter((o) => o.field === "findings");
    const seen = new Set<string>();
    const repeating = new Set<string>();
    for (const o of fObs) {
      const c = norm(o.concept);
      if (!c) continue;
      if (seen.has(c)) repeating.add(c);
      seen.add(c);
    }
    // A repeated concept is only legitimate when a level or region tells the two
    // rows apart; otherwise ownership slots would silently collide.
    for (const c of repeating) {
      const rows = fObs.filter((o) => norm(o.concept) === c);
      const keys = rows.map((o) => `${norm(o.level)}|${norm(o.region)}`);
      const distinct = new Set(keys);
      if (distinct.size < rows.length) {
        push("C3-R07", "WARNING", `${m.name}/${c}`,
          `concept "${c}" repeats ${rows.length} times but only ${distinct.size} level/region combinations distinguish them`);
      } else {
        push("C3-R07", "INFORMATIONAL", `${m.name}/${c}`,
          `concept "${c}" repeats ${rows.length} times, distinguished by level/region — an ordering key must use (concept, level), not concept alone`);
      }
    }
    const sectionsInOrder: string[] = [];
    let withoutSection = 0;
    for (const o of fObs) {
      if (isBlank(o.anatomicalSection)) { withoutSection++; continue; }
      const s = (o.anatomicalSection ?? "").trim();
      if (!sectionsInOrder.includes(s)) sectionsInOrder.push(s);
    }
    for (const o of m.observations) {
      const lvl = (o.level ?? "").trim();
      if (lvl && LOOKS_LIKE_LEVEL_RE.test(lvl) && !isPlausibleLevel(lvl)) {
        push("C3-R08", "ERROR", `${m.name}/${o.concept}`,
          `anatomical level "${lvl}" is not a level that exists (C1-C7, T1-T12, L1-L5, S1-S5)`);
      }
      // Not gated on `lvl`: a manifest row can declare laterality without a
      // level, and a bad value there is just as unrankable.
      const lat = (o.laterality ?? "").trim();
      if (lat && !VALID_LATERALITY.has(lat.toLowerCase())) {
        push("C3-R09", "ERROR", `${m.name}/${o.concept}`, `laterality "${lat}" is not one of left|right|bilateral|present`);
      }
    }
    manifests.push({
      name: m.name,
      revision: m.revision ?? "(none)",
      modality: m.modality ?? "(none)",
      bodyPart: m.bodyPart ?? "(none)",
      observationCount: m.observations.length,
      findingsObservationCount: fObs.length,
      distinctConcepts: seen.size,
      repeatingConcepts: [...repeating].sort(),
      sectionsInOrder,
      observationsWithoutSection: withoutSection,
    });
  }

  // ── tiles ──────────────────────────────────────────────────────────────────
  const tiles: TileRecord[] = [];
  const coverage = new Map<string, CoverageByScope>();
  /** Normalised `modality/bodyPart` of every scope that has at least one findings tile. */
  const findingsScopes = new Set<string>();

  for (const t of input.tiles) {
    const modality = t.scopeModality ?? "(any)";
    const bodyPart = t.scopeBodyPart ?? "(any)";
    const subject = `${modality} ${bodyPart} / ${t.label}`;
    const exam = `${norm(modality)}/${norm(bodyPart)}`;
    const packSectionVocab = sectionsByExam.get(exam);
    const examConcepts = conceptsByExam.get(exam);
    const examRendered = renderedByExam.get(exam);

    const conceptValue = (t.concept ?? "").trim();
    const conceptResolves = conceptValue
      ? packIds.has(conceptValue) || (aliasOwners.get(norm(conceptValue))?.size ?? 0) > 0
      : false;
    const concept: FieldAudit = !conceptValue
      ? { status: "MISSING", value: "" }
      : conceptResolves
        ? { status: "PRESENT", value: conceptValue }
        : { status: "UNKNOWN", value: conceptValue, note: "no content pack declares this concept or alias" };
    // Concept resolution is required where anatomy has to be ranked — the
    // findings field. A recommendation tile with no concept is not a defect.
    if (!conceptValue && t.field === "findings") {
      push("C3-R01", "ERROR", subject, "a findings tile carries no concept, so it cannot be resolved or ranked");
    } else if (concept.status === "UNKNOWN") {
      push("C3-R02", "WARNING", subject, `concept "${conceptValue}" does not resolve to any content pack`);
    }

    // Laterality and level are not tile fields at all; they are only ever
    // declared through `properties` / a `{side}` token, or left to the prose.
    const props = new Set((t.properties ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    const tokens = placeholdersOf(t.sentence);
    const lateralityApplicable = props.has("side") || tokens.includes("side");
    const laterality: FieldAudit = lateralityApplicable
      ? { status: "PRESENT", value: "side", note: "declared via tile properties / {side} token" }
      : { status: "NOT_APPLICABLE", value: "" };

    const levelApplicable = LOOKS_LIKE_LEVEL_RE.test(t.sentence);
    const level: FieldAudit = levelApplicable
      ? { status: "UNKNOWN", value: "", note: "the prose names a level but no structured level field exists on a tile" }
      : { status: "NOT_APPLICABLE", value: "" };
    if (levelApplicable && t.field === "findings") {
      push("C3-R15", "REQUIRES_RADIOLOGIST_REVIEW", subject,
        "sentence names an inter-vertebral level; there is no level metadata to rank by, only prose to pattern-match");
    }

    const sectionValue = (t.anatomicalSection ?? "").trim();
    let section: FieldAudit;
    if (!sectionValue) {
      section = { status: "MISSING", value: "" };
    } else if (isTemplateLiteral(sectionValue)) {
      section = { status: "UNKNOWN", value: sectionValue, note: "a template token stored as data" };
    } else if (!packSectionVocab || packSectionVocab.size === 0) {
      section = { status: "UNKNOWN", value: sectionValue, note: "this examination has no baseline section vocabulary to check against" };
    } else if (packSectionVocab.has(norm(sectionValue))) {
      section = { status: "PRESENT", value: sectionValue };
    } else {
      section = { status: "UNKNOWN", value: sectionValue, note: "not a section this examination's baseline defines" };
    }
    if (t.field === "findings" && section.status === "MISSING") {
      push("C3-R03", "WARNING", subject,
        "no anatomicalSection; ordering by anatomy would have to guess it from the sentence");
    } else if (t.field === "findings" && section.status === "UNKNOWN") {
      push("C3-R04", "REQUIRES_RADIOLOGIST_REVIEW", subject,
        `anatomicalSection "${section.value}" is not defined by this examination's baseline — recorded as UNKNOWN, not mapped to a section by inference`);
    }

    const conflictValue = (t.conflictGroup ?? "").trim();
    const conflictGroup: FieldAudit = conflictValue
      ? { status: "PRESENT", value: conflictValue }
      : { status: "MISSING", value: "" };
    if (t.field === "findings" && !conflictValue) {
      push("C3-R10a", "WARNING", subject, "no conflictGroup; two tiles about the same anatomy will not recognise each other");
    }

    const baseValue = (t.baselineReplaces ?? "").trim();
    let baselineReplaces: FieldAudit;
    if (!baseValue) {
      baselineReplaces = { status: "NOT_APPLICABLE", value: "", note: "adds a sentence rather than retiring a normal" };
    } else if (!examRendered || examRendered.size === 0) {
      // Nothing to check against. This is not an invalid declaration — the
      // examination simply has no owned baseline manifest (C3-R20 reports it
      // once per examination rather than once per tile).
      baselineReplaces = { status: "UNKNOWN", value: baseValue, note: "this examination has no owned baseline manifest to check the target against" };
    } else {
      const known = examRendered.has(norm(baseValue));
      baselineReplaces = known
        ? { status: "PRESENT", value: baseValue }
        : { status: "UNKNOWN", value: baseValue, note: "no baseline observation of this examination renders that exact text" };
      if (baselineReplaces.status === "UNKNOWN") {
        // Deliberately NOT an error: retirement can still succeed through the
        // concept / conflictGroup path, so the exact-text mismatch is proven
        // metadata drift but not a proven clinical failure.
        push("C3-R10", "WARNING", subject,
          `baselineReplaces names "${baseValue}", which no observation in ${modality} ${bodyPart}'s baseline renders; the declaration is stale even though ownership may still resolve by concept`);
      }
    }

    const sortOrder: FieldAudit = { status: "NOT_APPLICABLE", value: "", note: "tiles have no sortOrder field; DB quick findings do" };
    const contentPack: FieldAudit = conceptResolves
      ? { status: "PRESENT", value: conceptValue }
      : { status: conceptValue ? "UNKNOWN" : "MISSING", value: conceptValue };

    if (t.field === "findings") {
      for (const tok of tokens) {
        // `quickSelectParameterContract.ts` recognises exactly two parameters and
        // the Quick Select bar builds its chips from the tile's own text, so a
        // token outside that set can be neither filled nor refused: it would
        // reach the report as a literal `{...}`. Note this is NOT about
        // `properties` — declaring a token there is a UI hint, not the contract.
        if (!KNOWN_QUICK_SELECT_PARAMS.has(tok)) {
          push("C3-R11", "ERROR", subject,
            `sentence requires {${tok}}, which is not a parameter the Quick Select parameter contract recognises (${[...KNOWN_QUICK_SELECT_PARAMS].join("|")})`);
        }
      }
      if (BLANK_MEASURE_RE.test(t.sentence)) {
        push("C3-R11b", "INFORMATIONAL", subject, "sentence ships an unfilled '___' measurement blank");
      }
      if (sentenceCount(t.sentence) > 1) {
        push("C3-R13", "INFORMATIONAL", subject,
          `one tile renders ${sentenceCount(t.sentence)} sentences; they are one observation and must move together`);
      }
    }

    tiles.push({
      subject, label: t.label, modality, bodyPart, field: t.field, category: t.category ?? "",
      concept, anatomicalSection: section, conflictGroup, baselineReplaces,
      laterality, level, sortOrder, contentPack,
    });

    if (t.field === "findings") {
      const key = `${modality}/${bodyPart}`;
      const c = coverage.get(key) ?? {
        scope: key, modality, bodyPart, field: "findings",
        tiles: 0, withConcept: 0, conceptResolves: 0, withAnatomicalSection: 0, sectionKnown: 0,
        withConflictGroup: 0, withBaselineReplaces: 0, lateralityApplicable: 0, lateralityDeclared: 0,
        levelApplicable: 0, levelDeclared: 0, mappedToManifestConcept: 0, unresolvedPlacement: 0,
      };
      c.tiles++;
      if (conceptValue) c.withConcept++;
      if (conceptResolves) c.conceptResolves++;
      if (sectionValue) c.withAnatomicalSection++;
      if (section.status === "PRESENT") c.sectionKnown++;
      if (conflictValue) c.withConflictGroup++;
      if (baseValue) c.withBaselineReplaces++;
      if (lateralityApplicable) { c.lateralityApplicable++; if (laterality.status === "PRESENT") c.lateralityDeclared++; }
      if (levelApplicable) { c.levelApplicable++; if (level.status === "PRESENT") c.levelDeclared++; }
      if (examConcepts?.has(norm(conceptValue))) c.mappedToManifestConcept++;
      if (section.status !== "PRESENT") c.unresolvedPlacement++;
      coverage.set(key, c);
      findingsScopes.add(exam);
    }
  }

  // ── examinations the caller asked about but the catalogue does not have ────
  // An audit that prints nothing for "MRI Dorsal Spine" reads the same as one
  // that found nothing wrong with it. Requested scopes with no findings tile get
  // an explicit zero row and a note, so "not covered by any metadata" is a
  // measured answer rather than an absence of one.
  for (const r of input.requestedScopes ?? []) {
    if (findingsScopes.has(`${norm(r.modality)}/${norm(r.bodyPart)}`)) continue;
    const scope = `${r.modality}/${r.bodyPart}`;
    coverage.set(scope, {
      scope, modality: r.modality, bodyPart: r.bodyPart, field: "findings",
      tiles: 0, withConcept: 0, conceptResolves: 0, withAnatomicalSection: 0, sectionKnown: 0,
      withConflictGroup: 0, withBaselineReplaces: 0, lateralityApplicable: 0, lateralityDeclared: 0,
      levelApplicable: 0, levelDeclared: 0, mappedToManifestConcept: 0, unresolvedPlacement: 0,
    });
    push("C3-R24", "INFORMATIONAL", `scope/${scope}`,
      "the Quick Select catalogue has no findings tile for this examination, so none of its metadata coverage can be measured — this is an absent catalogue, not a clean one");
  }

  // ── duplicate baseline ownership within one manifest ───────────────────────
  // Two observations claiming the identical (field, concept, level, region) own
  // the same slot: whichever is applied last silently wins, and an ordering key
  // built on that concept would be ambiguous by construction.
  for (const m of input.manifests) {
    const byKey = new Map<string, number>();
    for (const o of m.observations) {
      const k = `${o.field}|${norm(o.concept)}|${norm(o.level)}|${norm(o.region)}`;
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    for (const [k, n] of byKey) {
      if (n > 1) {
        const concept = k.split("|")[1] || "(blank)";
        push("C3-R22", "WARNING", `${m.name}/${concept}`,
          `${n} baseline observations own the same slot (field+concept+level+region = "${k}"), so they cannot be told apart by metadata alone`);
      }
    }
  }

  // ── one concept, several conflict groups across tiles ─────────────────────
  // The conflict group is what lets two tiles recognise each other as being
  // about the same anatomy. The same concept filed under two different groups
  // means those tiles will not see each other.
  {
    const groupsByConcept = new Map<string, Map<string, string[]>>();
    for (const t of input.tiles) {
      const c = norm(t.concept);
      if (!c) continue;
      const g = (t.conflictGroup ?? "").trim();
      if (!g) continue;
      if (!groupsByConcept.has(c)) groupsByConcept.set(c, new Map());
      const inner = groupsByConcept.get(c)!;
      const key = norm(g);
      if (!inner.has(key)) inner.set(key, []);
      inner.get(key)!.push(t.label);
    }
    for (const [concept, groups] of groupsByConcept) {
      if (groups.size > 1) {
        // Sorted, so the report is identical whatever order the catalogue was
        // supplied in — a Map's iteration order is otherwise insertion order.
        const detail = [...groups.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([g, labels]) => `"${g}" (${labels.sort().join(", ")})`)
          .join("; ");
        push("C3-R23", "WARNING", `concept/${concept}`,
          `tiles sharing concept "${concept}" file it under ${groups.size} different conflict groups: ${detail}`);
      }
    }
  }

  // ── examinations with findings tiles but no owned baseline ─────────────────
  // An owned manifest is what currently supplies anatomical order. Without one,
  // an examination has no approved section vocabulary for anything to rank
  // against, so this is reported once per examination rather than once per tile.
  {
    const examsWithTiles = new Set<string>();
    const labelByExam = new Map<string, string>();
    for (const t of input.tiles) {
      if (t.field !== "findings") continue;
      const exam = `${norm(t.scopeModality)}/${norm(t.scopeBodyPart)}`;
      examsWithTiles.add(exam);
      const label = `${t.scopeModality ?? "(any)"} ${t.scopeBodyPart ?? "(any)"}`;
      if (!labelByExam.has(exam)) labelByExam.set(exam, label);
    }
    for (const exam of [...examsWithTiles].sort()) {
      if (sectionsByExam.has(exam) && (sectionsByExam.get(exam)?.size ?? 0) > 0) continue;
      push("C3-R20", "INFORMATIONAL", `exam/${labelByExam.get(exam) ?? exam}`,
        "no owned baseline manifest exists for this examination, so it has no approved anatomical sequence for findings to be ordered against");
    }
  }

  // ── competing section vocabularies ─────────────────────────────────────────
  const librarySections = (input.librarySectionOrder ?? []).map(norm);
  if (librarySections.length) {
    const manifestSections = new Set<string>();
    for (const s of sectionsByExam.values()) for (const x of s) manifestSections.add(x);
    const libSet = new Set(librarySections);
    const overlap = [...manifestSections].filter((s) => libSet.has(s));
    // A Set has `.size`, not `.length` — reading `.length` here yields NaN, and
    // `NaN < 0.5` is false, so this rule would silently never fire.
    if (manifestSections.size > 0 && overlap.length / manifestSections.size < 0.5) {
      push("C3-R14", "WARNING", "findingsCompose/SECTION_ORDER",
        `the Findings Library orders by ${librarySections.length} section names while the baselines declare ${manifestSections.size}; only ${overlap.length} agree, so the two surfaces can present the same study in different anatomical orders`);
    }
  }

  // ── DB-seeded quick findings (static SQL, never a live database) ───────────
  for (const b of input.seedBatches ?? []) {
    const hasSection = b.columns.includes("anatomical_section");
    const hasConflict = b.columns.includes("conflict_group");
    const hasConcept = b.columns.includes("concept");
    if (!hasConcept) {
      push("C3-R17", "INFORMATIONAL", `seed/${b.file}`,
        "the radiology_quick_findings table has no concept column, so DB-seeded rows cannot participate in concept-based resolution at all");
    }
    // A column that is never even named in the INSERT is the commonest case here
    // (the USG packs), and it is a different fact from "named but left empty" —
    // both leave the row with no section, but only one was a deliberate choice.
    const sectionGap = (b.populated["anatomical_section"] ?? 0) < b.rowCount;
    if (sectionGap) {
      const missing = b.rowCount - (b.populated["anatomical_section"] ?? 0);
      push("C3-R18", "WARNING", `seed/${b.file}`,
        hasSection
          ? `${missing}/${b.rowCount} seeded rows carry no anatomical_section`
          : `all ${b.rowCount} rows are inserted without ever naming anatomical_section, so each defaults to empty`);
    }
    if (hasConflict && (b.populated["conflict_group"] ?? 0) === 0 && b.rowCount > 0) {
      push("C3-R19", "WARNING", `seed/${b.file}`, `${b.rowCount} rows declare no conflict_group`);
    }
    if (b.rowCount === 0) {
      push("C3-R21", "WARNING", `seed/${b.file}`,
        "an INSERT into radiology_quick_findings was found but no row parsed — the audit's denominator here is unreliable and must not be read as coverage");
    }
    const unparsed = b.populated["__unparsedRows"] ?? 0;
    if (unparsed > 0) {
      push("C3-R21", "WARNING", `seed/${b.file}`,
        `${unparsed} row(s) did not parse, so this file's counts understate what it seeds`);
    }
    const tmpl = b.populated["__template_section_tokens"] ?? 0;
    if (tmpl > 0) {
      // Not called invalid on purpose: a level-driven row may intend its section
      // to BE the chosen level (the LS Spine baseline likewise uses section
      // "L4-L5"). Whether that is deliberate is a clinical judgement, not a
      // deduction — so it is recorded, not resolved here.
      push("C3-R16", "REQUIRES_RADIOLOGIST_REVIEW", `seed/${b.file}`,
        `${tmpl} row(s) put a substitution token such as '{level}' in anatomical_section; either the section is deliberately dynamic or the column is being used as a level — which one is a clinical decision`);
    }
  }

  // Deterministic ordering: severity is irrelevant to identity, so sort by
  // (rule, subject, detail) — identical input always yields identical bytes.
  findings.sort((a, b) =>
    a.rule.localeCompare(b.rule) || a.subject.localeCompare(b.subject) || a.detail.localeCompare(b.detail));

  const counts: Record<Severity, number> = {
    ERROR: 0, WARNING: 0, INFORMATIONAL: 0, REQUIRES_RADIOLOGIST_REVIEW: 0,
  };
  for (const f of findings) counts[f.severity]++;

  const findingsTiles = tiles.filter((t) => t.field === "findings");
  return {
    findings,
    tiles,
    manifests: manifests.sort((a, b) => a.name.localeCompare(b.name)),
    coverage: [...coverage.values()].sort((a, b) => a.scope.localeCompare(b.scope)),
    seeds: (input.seedBatches ?? []).map((b) => ({
      file: b.file,
      rowCount: b.rowCount,
      section: b.populated["anatomical_section"] ?? 0,
      conflictGroup: b.populated["conflict_group"] ?? 0,
      baselineReplaces: b.populated["baseline_replaces"] ?? 0,
      templateTokensInSection: b.populated["__template_section_tokens"] ?? 0,
      unparsedRows: b.populated["__unparsedRows"] ?? 0,
      hasConceptColumn: b.columns.includes("concept"),
    })).sort((a, b) => a.file.localeCompare(b.file)),
    counts,
    totals: {
      tiles: tiles.length,
      findingsTiles: findingsTiles.length,
      packs: input.packs.length,
      manifests: manifests.length,
      conceptBearingTiles: findingsTiles.filter((t) => t.concept.status === "PRESENT").length,
      manifestMappedTiles: findingsTiles.filter((t) => t.concept.status === "PRESENT"
        && (conceptsByExam.get(`${norm(t.modality)}/${norm(t.bodyPart)}`)?.has(norm(t.concept.value)) ?? false)).length,
      errorCount: counts.ERROR,
    },
  };
}

/**
 * The machine-readable coverage snapshot. Derived only — every number here is
 * counted from the audit that just ran, so a snapshot can never disagree with
 * the data it is supposed to describe.
 */
export function buildCoverageBaseline(result: AuditResult, source: { revision: string }): object {
  return {
    "$schema": "care.clinical-metadata-coverage.v1",
    generatedBy: "scripts/audit-clinical-anatomy-metadata.mjs",
    sourceRevision: source.revision,
    totals: result.totals,
    severityCounts: result.counts,
    orderingFeasibility: measureOrderingFeasibility(result),
    byScope: result.coverage,
    seeds: result.seeds,
    manifests: result.manifests.map((m) => ({
      name: m.name,
      revision: m.revision,
      modality: m.modality,
      bodyPart: m.bodyPart,
      findingsObservationCount: m.findingsObservationCount,
      distinctConcepts: m.distinctConcepts,
      repeatingConcepts: m.repeatingConcepts,
      observationsWithoutSection: m.observationsWithoutSection,
      sectionsInOrder: m.sectionsInOrder,
    })),
  };
}

/**
 * Compare a fresh audit against an accepted baseline. Reports deterioration only
 * — an incomplete catalogue is a coverage gap, not a regression, so it must not
 * be able to fail CI on its own.
 */
export function diffAgainstBaseline(
  baseline: Record<string, unknown>,
  current: AuditResult,
): string[] {
  const problems: string[] = [];
  const baseTotals = (baseline.totals ?? {}) as Record<string, number>;
  const baseCounts = (baseline.severityCounts ?? {}) as Record<string, number>;

  if (typeof baseTotals.errorCount === "number" && current.counts.ERROR > baseTotals.errorCount) {
    problems.push(`ERROR count rose ${baseTotals.errorCount} -> ${current.counts.ERROR}`);
  }
  for (const sev of ["ERROR", "WARNING", "REQUIRES_RADIOLOGIST_REVIEW"] as const) {
    const before = baseCounts[sev] ?? 0;
    const now = current.counts[sev] ?? 0;
    if (now > before) problems.push(`${sev} count rose ${before} -> ${now}`);
  }

  const baseScopes = new Map<string, CoverageByScope>();
  for (const s of (baseline.byScope ?? []) as CoverageByScope[]) baseScopes.set(s.scope, s);
  for (const c of current.coverage) {
    const b = baseScopes.get(c.scope);
    if (!b) {
      // A new scope is not deterioration; but it must not silently arrive with
      // less concept coverage than the catalogue average it joined.
      continue;
    }
    if (c.sectionKnown < b.sectionKnown) {
      problems.push(`${c.scope}: known anatomical sections fell ${b.sectionKnown} -> ${c.sectionKnown}`);
    }
    if (c.conceptResolves < b.conceptResolves) {
      problems.push(`${c.scope}: resolvable concepts fell ${b.conceptResolves} -> ${c.conceptResolves}`);
    }
    if (c.withBaselineReplaces < b.withBaselineReplaces) {
      problems.push(`${c.scope}: tiles that retire a baseline normal fell ${b.withBaselineReplaces} -> ${c.withBaselineReplaces}`);
    }
  }
  const baseFeasibility = baseline.orderingFeasibility as OrderingFeasibility | undefined;
  if (baseFeasibility) {
    const now = measureOrderingFeasibility(current);
    if (now.safeRankKey < baseFeasibility.safeRankKey) {
      problems.push(`tiles with a safe anatomical rank key fell ${baseFeasibility.safeRankKey} -> ${now.safeRankKey}`);
    }
  }
  return problems;
}

/**
 * How much of the catalogue could be ordered by anatomy today, measured rather
 * than asserted. This is the question the next milestone has to answer before it
 * writes a reorder function, so it is computed from the audit every time.
 *
 * The definition of "safe" is deliberately narrow and is stated here rather than
 * buried in the code: a findings tile has a safe rank key only when its concept
 * resolves to a content pack, its `anatomicalSection` is one the examination's
 * own baseline manifest declares, and that examination has a baseline manifest at
 * all. Anything else would need the audit to guess placement from English prose,
 * which is the inference C2 refused to make.
 */
export type OrderingFeasibility = {
  findingsTiles: number;
  safeRankKey: number;
  needsClinicalMapping: number;
  noOrderingKey: number;
  multiSentenceTiles: number;
  tilesSharingOneBaselineTarget: number;
  conflictGroupsHoldingBothANormalAndAnAbnormal: string[];
  examsWithOwnedBaseline: number;
  examsWithoutOwnedBaseline: number;
};

export function measureOrderingFeasibility(result: AuditResult): OrderingFeasibility {
  const examKeys = new Set(
    result.manifests.map((m) => `${m.modality.toLowerCase()}/${m.bodyPart.toLowerCase()}`),
  );
  const findings = result.tiles.filter((t) => t.field === "findings");

  let safeRankKey = 0;
  let needsClinicalMapping = 0;
  let noOrderingKey = 0;
  for (const t of findings) {
    const conceptKnown = t.concept.status === "PRESENT";
    if (!conceptKnown) noOrderingKey++;
    else if (t.anatomicalSection.status === "PRESENT"
      && examKeys.has(`${t.modality.toLowerCase()}/${t.bodyPart.toLowerCase()}`)) safeRankKey++;
    else needsClinicalMapping++;
  }

  // Two tiles that retire the same baseline sentence would fight for one slot in
  // any ordering; recorded as a count of the tiles involved, not the pairs.
  const byTarget = new Map<string, number>();
  for (const t of findings) {
    if (t.baselineReplaces.status !== "PRESENT") continue;
    const k = t.baselineReplaces.value.toLowerCase();
    byTarget.set(k, (byTarget.get(k) ?? 0) + 1);
  }
  let sharing = 0;
  for (const n of byTarget.values()) if (n > 1) sharing += n;

  const groups = new Map<string, Set<string>>();
  for (const t of findings) {
    if (t.conflictGroup.status !== "PRESENT") continue;
    const g = groups.get(t.conflictGroup.value) ?? new Set<string>();
    g.add(t.category);
    groups.set(t.conflictGroup.value, g);
  }
  const mixed = [...groups.entries()]
    .filter(([, cats]) => cats.has("normal") && (cats.has("abnormal") || cats.has("critical")))
    .map(([g]) => g)
    .sort();

  const measuredExams = result.coverage.filter((c) => c.tiles > 0);
  const withBaseline = measuredExams.filter(
    (c) => examKeys.has(`${c.modality.toLowerCase()}/${c.bodyPart.toLowerCase()}`),
  );

  return {
    findingsTiles: findings.length,
    safeRankKey,
    needsClinicalMapping,
    noOrderingKey,
    multiSentenceTiles: result.findings.filter((f) => f.rule === "C3-R13").length,
    tilesSharingOneBaselineTarget: sharing,
    conflictGroupsHoldingBothANormalAndAnAbnormal: mixed,
    examsWithOwnedBaseline: withBaseline.length,
    examsWithoutOwnedBaseline: measuredExams.length - withBaseline.length,
  };
}
