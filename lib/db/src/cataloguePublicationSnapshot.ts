/*
 * Canonical publication snapshot — care-v4 Stage B, §1 of the architectural hardening.
 *
 * WHAT THIS IS FOR
 * ----------------
 * `clinical_publications.catalogue_snapshot` is the only artefact that says what the whole
 * published clinical configuration was — and, since Stage B r4, the only artefact that says it.
 * Before it there were two others: a per-tile version history, and a publication→tile manifest whose
 * foreign key pointed into it. Both are gone, because this document freezes every column of every
 * row it claims (measured: a tile entry carries all twenty), so a manifest row was a second copy of
 * a fact the publication already owned and the version history had no writer at all. The question
 * the manifest was built to answer — which wording was live — is answered by this document alone:
 * sections and their order, normal wording, parameters and their defaults, replacement and
 * conflict relationships, combination rules with their members, recommendation rules and every
 * review state are edited in place in their own tables, so a historical report could not be
 * reassembled and rollback could not be total. This module is the one definition of the
 * document that fixes that — its domains, the identity each entry carries, the order entries
 * are written in, and the hash rule. The database half of the contract is
 * clinical_publication_gate() in migrations/zzzz_add_clinical_catalogue_v4.sql, check 14, which
 * compares this document against the live rows domain by domain; the two are proved to agree by
 * clinicalCatalogue.db.test.ts, which publishes a builder-produced document and then perturbs
 * one domain at a time.
 *
 * THE READ SIDE IS HERE TOO
 * -------------------------
 * verifyStoredPublication(), loadVerifiedPublication() and loadCurrentPublication() are the only
 * supported way to get a publication back out of the database. They exist because check 14 compares
 * MEMBERSHIP and not column values, which the migration says out loud: a consumer that reads
 * `catalogue_snapshot` with its own SELECT gets no hash check, no version check and no completeness
 * check, and the document it composes from is then only as trustworthy as the writer that produced
 * it. The block above verifyStoredPublication() states exactly what that guard does and does not
 * prove — including that no runtime path calls it yet, because Stage B has no runtime path.
 *
 * WHY A CONVENTION LIVES IN CODE AND NOT IN PROSE
 * -----------------------------------------------
 * Two publishers that disagree about key order or about array order produce different hashes for
 * one identical catalogue, and then "has the published content changed?" has no answer. So the
 * rules are executable here:
 *
 *   1. Object keys are emitted sorted by code point, at every depth.
 *   2. Array entries are ordered by (ordinal NULLS LAST, identity) — never by the order a SELECT
 *      happened to return, and never by Map insertion order.
 *   3. Every entry in every array domain carries `identity`, the examination-scoped stable
 *      handle the gate compares against.
 *   4. Timestamps are emitted as ISO-8601 UTC, so a build on a +05:30 box and a build on a
 *      UTC runner produce the same bytes.
 *   5. Integer-valued strings below 2^53 are emitted as JSON numbers, because node-postgres
 *      returns BIGINT as a string and Drizzle returns it as a number; leaving that difference in
 *      place would make the hash depend on which driver the publisher used. Non-integer strings
 *      (NUMERIC clinical thresholds such as `min_value`) are left exactly as they arrived —
 *      converting them to a JS number would silently round a value the clinic entered.
 *   6. `created_at` and `updated_at` are NOT frozen. A content hash that moves with the clock is
 *      not a content hash: two publishers snapshotting the same unchanged catalogue at different
 *      seconds would disagree, which is the one question the hash exists to answer. Restore
 *      therefore stamps the rows it recreates with the time of the restore, and the durable
 *      "when was this the configuration" fact stays where it belongs — on the publication row
 *      (`published_at`, `published_by`), which is itself append-only. `created_by` and
 *      `updated_by` ARE frozen: who wrote a sentence is clinical attribution, not clock noise.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * No SQL, no database connection, no runtime report composition, no restore writer. Freezing and
 * ordering the configuration is Stage B; deciding which sentences print is Stage C; writing the
 * restored rows back is a publisher tool that should be built against this document when there is
 * an administrator who needs it, not before. The canonical vocabulary the domains point at by id
 * (finding_definitions, parameter_groups, parameter_options) is also not frozen — see the
 * migration comment on clinical_publications for the consequence and for why `snapshot_version`
 * is the field that would carry an eleventh domain.
 */

import { createHash } from "node:crypto";

export const SNAPSHOT_VERSION = 1;

/** A row exactly as the publisher's query returned it: column names, plus the join columns. */
export type SnapshotRow = Record<string, unknown>;

export type SnapshotDomainField =
  | "examination"
  | "sections"
  | "normalSlots"
  | "tiles"
  | "placements"
  | "parameters"
  | "normalReplacements"
  | "relationships"
  | "combinationRules"
  | "recommendationRules";

export type DomainSpec = {
  /** The document key. Also the string check 14 of the gate names in its refusal. */
  field: SnapshotDomainField;
  shape: "object" | "array";
  /**
   * Columns the publisher's query adds so an identity can be built (a placement is scoped by
   * its tile's key, a relationship by both ends'). They are not columns of the frozen table and
   * are stripped from the entry, so an entry's key set is exactly the table's column set plus
   * `identity`.
   */
  joinColumns: readonly string[];
  /**
   * The identity expression, which must match the corresponding arm of the `live` CTE in check
   * 14 byte for byte in meaning. The separators ( '/', '>', '~', 'concept:' ) are part of the
   * contract: changing one changes every publication hash, so it is a snapshot_version bump.
   */
  identity: (row: SnapshotRow) => string;
};

const concept = (value: unknown, domain: string): string => `concept:${part(value, "related concept id", domain)}`;

export const SNAPSHOT_DOMAINS: readonly DomainSpec[] = [
  {
    field: "examination",
    shape: "object",
    joinColumns: [],
    // Not compared as an identity; the gate compares the entry's own `id` against the
    // publication's examination_id so a document cannot wrap one examination's scope record
    // around another examination's rows.
    identity: (row) => part(row.id, "id", "examination"),
  },
  {
    field: "sections",
    shape: "array",
    joinColumns: [],
    identity: (row) => part(row.key, "key", "sections"),
  },
  {
    field: "normalSlots",
    shape: "array",
    joinColumns: [],
    identity: (row) => part(row.key, "key", "normalSlots"),
  },
  {
    field: "tiles",
    shape: "array",
    joinColumns: [],
    identity: (row) => part(row.key, "key", "tiles"),
  },
  {
    field: "placements",
    shape: "array",
    joinColumns: ["tile_key"],
    identity: (row) => part(row.tile_key, "tile key", "placements"),
  },
  {
    field: "parameters",
    shape: "array",
    joinColumns: ["tile_key"],
    // tile.key is globally unique and clin_tile_params_key_uq makes (tile_id, key) unique, so
    // this composition is unique within an examination — which a bare parameter key is not:
    // 'severity' exists on dozens of tiles.
    identity: (row) =>
      `${part(row.tile_key, "tile key", "parameters")}/${part(row.key, "key", "parameters")}`,
  },
  {
    field: "normalReplacements",
    shape: "array",
    joinColumns: ["tile_key", "normal_slot_key"],
    identity: (row) =>
      `${part(row.tile_key, "tile key", "normalReplacements")}>${part(row.normal_slot_key, "normal slot key", "normalReplacements")}`,
  },
  {
    field: "relationships",
    shape: "array",
    joinColumns: ["tile_key", "related_tile_key"],
    // The kind is inside the identity because A→B can legitimately carry more than one
    // relationship row ('excludes' and 'coexists' would contradict, but 'requires' and
    // 'supersedes' do not), and clin_tile_rel_uq makes (tile, kind, target) the unique key.
    identity: (row) => {
      const target = stringify(row.related_tile_key);
      return (
        `${part(row.tile_key, "tile key", "relationships")}~` +
        `${part(row.relation_kind, "relation kind", "relationships")}~` +
        (target === "" ? concept(row.related_concept_id, "relationships") : target)
      );
    },
  },
  {
    field: "combinationRules",
    shape: "array",
    joinColumns: [],
    identity: (row) => part(row.key, "key", "combinationRules"),
  },
  {
    field: "recommendationRules",
    shape: "array",
    joinColumns: [],
    identity: (row) => part(row.key, "key", "recommendationRules"),
  },
];

/**
 * Combination members are not a top-level domain: a member of a rule that is not in the document
 * is meaningless, so each rule entry carries its own `members` array. They are still compared
 * row-for-row by the gate, which flattens them under the synthetic field name below.
 */
export const MEMBER_FIELD = "combinationMembers";
const MEMBER_JOIN_COLUMNS = ["rule_key", "tile_key"] as const;
const memberIdentity = (row: SnapshotRow): string => {
  const target = stringify(row.tile_key);
  return (
    `${part(row.rule_key, "rule key", MEMBER_FIELD)}/` +
    (target === "" ? concept(row.concept_id, MEMBER_FIELD) : target)
  );
};

/** The live member set is scoped by rule, and a rule is scoped by examination. */
export type CombinationMemberRow = SnapshotRow & { rule_id: unknown; rule_key: unknown; tile_key?: unknown };

export type CatalogueRows = {
  examination: SnapshotRow;
  sections: SnapshotRow[];
  normalSlots: SnapshotRow[];
  tiles: SnapshotRow[];
  placements: SnapshotRow[];
  parameters: SnapshotRow[];
  normalReplacements: SnapshotRow[];
  relationships: SnapshotRow[];
  combinationRules: SnapshotRow[];
  combinationMembers: CombinationMemberRow[];
  recommendationRules: SnapshotRow[];
};

export type SnapshotEntry = Record<string, unknown> & { identity: string };
export type SnapshotDocument = Record<string, unknown> & {
  examination: SnapshotEntry;
  sections: SnapshotEntry[];
  normalSlots: SnapshotEntry[];
  tiles: SnapshotEntry[];
  placements: SnapshotEntry[];
  parameters: SnapshotEntry[];
  normalReplacements: SnapshotEntry[];
  relationships: SnapshotEntry[];
  combinationRules: SnapshotEntry[];
  recommendationRules: SnapshotEntry[];
};

const OMITTED_COLUMNS = ["created_at", "updated_at"] as const;

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * A piece of an identity that is missing is not "an entry with a short identity": it is a
 * publisher that forgot a join column, and the resulting document would name rows the gate
 * cannot match. So the builder refuses loudly instead of emitting a plausible-looking handle —
 * every wrong-identity defect below is silent after the INSERT, in a table nothing reads yet.
 */
function part(value: unknown, label: string, domain: string): string {
  const text = stringify(value);
  if (text === "") throw new Error(`catalogue snapshot: a ${domain} entry carries no ${label}`);
  return text;
}

/**
 * node-postgres hands back int8 and numeric as strings; Drizzle hands back numbers for the
 * bigint columns. Emitting both faithfully would make one catalogue hash differently depending
 * on which driver read it, so whole numbers that a JS number represents exactly are normalised
 * and everything else is left byte-for-byte as supplied. See rule 5 at the top of this file.
 */
function normalizeScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    if (/^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
    return value;
  }
  if (value === undefined) return null;
  return value;
}

/**
 * An entry is the table's own column set — every column, so a restore has every value it needs —
 * minus the clock columns and minus the publisher's join columns, plus `identity`.
 */
function freezeRow(row: SnapshotRow, joinColumns: readonly string[]): SnapshotEntry {
  const entry: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (column === "identity") continue;
    if ((OMITTED_COLUMNS as readonly string[]).includes(column)) continue;
    if (joinColumns.includes(column)) continue;
    entry[column] = typeof value === "object" && !(value instanceof Date) ? canonicalValue(value) : normalizeScalar(value);
  }
  return entry as SnapshotEntry;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return normalizeScalar(value);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      out[key] = canonicalValue(child);
    }
    return out;
  }
  return normalizeScalar(value);
}

/**
 * Total order for one domain: stated precedence first, identity as the tiebreak, so a catalogue
 * whose ordinals are all 0 or all NULL still serializes one way. Sorting by identity alone would
 * make the published document alphabetical, which is the ordering §16 of the plan forbids; sorting
 * by ordinal alone would leave ties to the input order, which is the thing being removed.
 */
function byOrderThenIdentity(a: SnapshotEntry, b: SnapshotEntry): number {
  const ao = a.ordinal === null || a.ordinal === undefined ? 1 : 0;
  const bo = b.ordinal === null || b.ordinal === undefined ? 1 : 0;
  if (ao !== bo) return ao - bo;
  const av = Number(a.ordinal ?? 0);
  const bv = Number(b.ordinal ?? 0);
  if (av !== bv) return av - bv;
  const ak = stringify(a.identity);
  const bk = stringify(b.identity);
  return ak < bk ? -1 : ak > bk ? 1 : 0;
}

/**
 * The frozen document for one examination's live configuration. The caller supplies the rows the
 * gate's scope predicates describe — live (deleted_at IS NULL) rows in the examination's scope,
 * draft and deprecated status included, because a restore recreates a configuration rather than a
 * filtered view, and each entry carries its own `status` for the runtime to filter on.
 *
 * Nothing here validates. A document built from rows that should not have been published is a
 * faithful snapshot of a bad catalogue; refusing it is clinical_publication_gate's job, and
 * duplicating the decision here would give the same rule two owners.
 */
export function buildCatalogueSnapshot(rows: CatalogueRows): SnapshotDocument {
  const membersByRule = new Map<string, SnapshotEntry[]>();
  for (const member of rows.combinationMembers) {
    const ruleId = stringify(member.rule_id);
    const entry = freezeRow(member, [...MEMBER_JOIN_COLUMNS]);
    entry.identity = memberIdentity(member);
    const bucket = membersByRule.get(ruleId);
    if (bucket) bucket.push(entry);
    else membersByRule.set(ruleId, [entry]);
  }

  const arrays: Record<Exclude<SnapshotDomainField, "examination">, SnapshotRow[]> = {
    sections: rows.sections,
    normalSlots: rows.normalSlots,
    tiles: rows.tiles,
    placements: rows.placements,
    parameters: rows.parameters,
    normalReplacements: rows.normalReplacements,
    relationships: rows.relationships,
    combinationRules: rows.combinationRules,
    recommendationRules: rows.recommendationRules,
  };

  const document = {} as SnapshotDocument;
  for (const spec of SNAPSHOT_DOMAINS) {
    if (spec.shape === "object") {
      const entry = freezeRow(rows.examination, [...spec.joinColumns]);
      entry.identity = spec.identity(rows.examination);
      document.examination = entry;
      continue;
    }
    // The cast is not doing clinical work: `shape` and `field` are two columns of one record, so
    // TypeScript cannot know that the branch above already handled the one object domain.
    const entries = arrays[spec.field as Exclude<SnapshotDomainField, "examination">]
      .map((row) => {
        const entry = freezeRow(row, [...spec.joinColumns]);
        entry.identity = spec.identity(row);
        return entry;
      })
      .sort(byOrderThenIdentity);
    if (spec.field === "combinationRules") {
      for (const entry of entries) {
        entry.members = (membersByRule.get(stringify(entry.id)) ?? []).sort(byOrderThenIdentity);
      }
    }
    (document as Record<string, unknown>)[spec.field] = entries;
  }
  return document;
}

/**
 * Deterministic serialization: keys sorted at every depth (buildCatalogueSnapshot already sorted
 * them, but a document read back out of jsonb arrives in Postgres' order, and the drift detector
 * must reproduce the publisher's bytes), arrays in the order they are given, no insignificant
 * whitespace. This is the exact text the hash is taken over.
 */
export function canonicalize(value: unknown): string {
  const emit = (v: unknown): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("canonicalize: non-finite number in snapshot");
      return String(v);
    }
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") {
      // The int8 normalisation lives here as well as in freezeRow, so it applies to a document
      // read back out of jsonb too. canonicalize is the hash's definition, and a rule that only
      // holds for freshly-built documents is a rule the drift detector breaks on.
      const normalized = normalizeScalar(v);
      return typeof normalized === "number" ? String(normalized) : JSON.stringify(normalized);
    }
    if (Array.isArray(v)) return `[${v.map(emit).join(",")}]`;
    if (v instanceof Date) return JSON.stringify(normalizeScalar(v));
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => `${JSON.stringify(key)}:${emit(child)}`);
      return `{${entries.join(",")}}`;
    }
    throw new Error(`canonicalize: unsupported value of type ${typeof v}`);
  };
  return emit(value);
}

/** sha256 over the canonical text, lowercase hex — the shape content_hash's CHECK demands. */
export function catalogueContentHash(document: unknown): string {
  return createHash("sha256").update(canonicalize(document), "utf8").digest("hex");
}

/**
 * The three columns a publication INSERT needs, from the rows the examination currently has.
 * Kept as one function so no caller can hash a document that is not the one it stores.
 */
export function publicationColumnsFor(rows: CatalogueRows): {
  catalogueSnapshot: SnapshotDocument;
  contentHash: string;
  snapshotVersion: number;
} {
  const catalogueSnapshot = buildCatalogueSnapshot(rows);
  return { catalogueSnapshot, contentHash: catalogueContentHash(catalogueSnapshot), snapshotVersion: SNAPSHOT_VERSION };
}

/**
 * Recomputation from a document already stored: what the drift detector compares against a fresh
 * snapshot of the live rows. Not byte-comparing jsonb on purpose — Postgres may reorder keys, so
 * equality is defined by the canonical text, exactly as it was at publication.
 *
 * It has one caller, verifyStoredPublication(), and that is the caller the migration's check 14
 * comment names. Before Stage B r4 it had none: the file delegated value-level integrity to a
 * function nothing invoked, which is how "the publisher is the guard" became a sentence about an
 * intention rather than about code.
 */
export function hashOfStoredSnapshot(catalogueSnapshot: unknown): string {
  return catalogueContentHash(catalogueSnapshot);
}

// ── The read side: what a consumer of a stored publication has to check ────────────────────────
//
// WHY THIS EXISTS AT ALL
// Check 14 of clinical_publication_gate() compares the document's MEMBERSHIP against the live rows
// and says, in the migration's own words, that it does not compare column values — so a document
// carrying the right identities with fabricated wording is accepted, and its content_hash matches it
// because the hash is computed over that same fabricated document. That is a deliberate trade (no
// SQL reimplementation of the serializer, no pgcrypto), and the compensating control it names is a
// stored publication's hash being recomputed from its stored jsonb. Nothing did that.
//
// WHAT IT CAN AND CANNOT CATCH, stated because a reviewer who assumes otherwise will be wrong:
// a hash recomputed from a document matches that document by construction, so this detects a
// publication whose two columns disagree — a publisher that hashed one document and stored another,
// a value that did not survive the jsonb round trip, a row written by something that bypassed
// publicationColumnsFor(). It does NOT detect a publication whose document agrees with itself but
// disagrees with the live catalogue; that is the drift check, and recomputeAgainstLiveRows() is
// where a caller with a connection performs it.
//
// WHAT IS NOT IMPLEMENTED, said plainly rather than implied: no runtime path calls any of this yet,
// because Stage B has no runtime path — nothing in the product reads a publication. The verifier is
// ready for integration and clinicalCatalogue.db.test.ts is the executable contract that says Stage C
// must integrate it: every assertion in that suite is written against a publication read back from a
// real server through loadVerifiedPublication()/loadCurrentPublication(), so a composer that reads
// `catalogue_snapshot` directly instead of through them has no cover to claim.
export const SUPPORTED_SNAPSHOT_VERSIONS: readonly number[] = [SNAPSHOT_VERSION];

/** A publication exactly as `SELECT * FROM clinical_publications` hands it back. */
export type PublicationRow = {
  id: unknown;
  examination_id: unknown;
  publication_key: unknown;
  content_hash: unknown;
  snapshot_version: unknown;
  catalogue_snapshot: unknown;
};

export type PublicationVerdict =
  | {
      ok: true;
      publicationId: number;
      examinationId: number;
      publicationKey: string;
      contentHash: string;
      snapshotVersion: number;
      document: SnapshotDocument;
    }
  | { ok: false; publicationId: number | null; failures: string[] };

/** Thrown by the assert* form, so a consumer that does not want a result object still cannot ignore one. */
export class PublicationIntegrityError extends Error {
  readonly publicationId: number | null;
  readonly failures: readonly string[];

  constructor(publicationId: number | null, failures: readonly string[]) {
    super(
      `publication ${publicationId ?? "unknown"} failed integrity verification: ${failures.join("; ")} ` +
        "(care-v4 §1: a publication that does not match its own hash is not evidence of anything)",
    );
    this.name = "PublicationIntegrityError";
    this.publicationId = publicationId;
    this.failures = failures;
  }
}

function asInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * One stored publication, checked without touching the database.
 *
 * Four refusals, and each is a distinct way a row can look like a publication while answering a
 * different question than the one a report is asking:
 *   1. a serialization convention this build does not know. Reading a version 2 document with the
 *      version 1 rules is guessing, and the version column exists so nobody has to guess.
 *   2. a document whose stored hash does not describe it.
 *   3. a domain missing or of the wrong shape. A partial document hashes perfectly — the hash covers
 *      what is there, not what should be — so without this check a publication that lost
 *      `recommendationRules` entirely would verify, and the report it composed would silently have
 *      no advice section. The vocabulary is SNAPSHOT_DOMAINS itself, so this cannot fall out of step
 *      with what the publisher writes.
 *   4. a document scoped to a different examination than the row names, which is the check-14 rule
 *      re-applied on the read side: a publication is evidence about ONE examination.
 */
export function verifyStoredPublication(row: PublicationRow): PublicationVerdict {
  const publicationId = asInt(row.id);
  const examinationId = asInt(row.examination_id);
  const failures: string[] = [];

  const snapshotVersion = asInt(row.snapshot_version);
  if (snapshotVersion === null || !SUPPORTED_SNAPSHOT_VERSIONS.includes(snapshotVersion)) {
    failures.push(`snapshot_version ${String(row.snapshot_version)} is not a convention this build can read (${SUPPORTED_SNAPSHOT_VERSIONS.join(", ")})`);
  }

  if (typeof row.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.content_hash)) {
    failures.push(`content_hash ${String(row.content_hash)} is not 64 lowercase hex`);
  }

  if (row.catalogue_snapshot === null || row.catalogue_snapshot === undefined || typeof row.catalogue_snapshot !== "object") {
    failures.push("catalogue_snapshot is not a JSON object");
  } else {
    if (typeof row.content_hash === "string") {
      const recomputed = hashOfStoredSnapshot(row.catalogue_snapshot);
      if (recomputed !== row.content_hash) {
        failures.push(`catalogue_snapshot hashes to ${recomputed}, not the stored ${row.content_hash}`);
      }
    }
    const document = row.catalogue_snapshot as Record<string, unknown>;
    for (const spec of SNAPSHOT_DOMAINS) {
      const field = document[spec.field];
      if (spec.shape === "object") {
        if (field === null || field === undefined || Array.isArray(field) || typeof field !== "object") {
          failures.push(`${spec.field} is ${Array.isArray(field) ? "an array" : field === undefined || field === null ? "absent" : `a ${typeof field}`}, but a publication requires it as an object`);
          continue;
        }
        const frozenExam = asInt((field as Record<string, unknown>).id);
        if (examinationId !== null && frozenExam !== null && frozenExam !== examinationId) {
          failures.push(`catalogue_snapshot.examination.id is ${String(frozenExam)} but the publication row names examination ${String(examinationId)}`);
        }
        continue;
      }
      if (!Array.isArray(field)) {
        failures.push(`${spec.field} is ${field === undefined || field === null ? "absent" : `a ${typeof field}`}, but a publication requires it as an array`);
        continue;
      }
      for (const [index, entry] of field.entries()) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          failures.push(`${spec.field}[${index}] is not an object`);
        } else if (typeof (entry as Record<string, unknown>).identity !== "string" || (entry as Record<string, unknown>).identity === "") {
          failures.push(`${spec.field}[${index}] carries no identity`);
        }
      }
    }
  }

  if (failures.length > 0) return { ok: false, publicationId, failures };

  return {
    ok: true,
    publicationId: publicationId as number,
    examinationId: examinationId as number,
    publicationKey: String(row.publication_key),
    contentHash: row.content_hash as string,
    snapshotVersion: snapshotVersion as number,
    document: row.catalogue_snapshot as SnapshotDocument,
  };
}

/** The throwing form, for a consumer that must not compose from an unverified document. */
export function assertStoredPublication(row: PublicationRow): Extract<PublicationVerdict, { ok: true }> {
  const verdict = verifyStoredPublication(row);
  if (!verdict.ok) throw new PublicationIntegrityError(verdict.publicationId, verdict.failures);
  return verdict;
}

/**
 * How a publication is read back. Named here because the column list is part of the contract: a
 * consumer that SELECTs `catalogue_snapshot` alone cannot verify anything, and a consumer that
 * SELECT * will be handed columns this function does not check.
 */
export const PUBLICATION_LOAD_QUERY = `SELECT id, examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot
                                        FROM clinical_publications WHERE id = $1`;

/** The governing publication of one examination, by the rule clinical_current_publications states. */
export const CURRENT_PUBLICATION_LOAD_QUERY = `SELECT id, examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot
                                                 FROM clinical_current_publications WHERE examination_id = $1`;

type Query = (sqlText: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Read one publication by id and verify it. A missing row is a failure, not a null: a report that
 * cites publication 7 in a database where 7 does not exist is the same class of defect as a report
 * citing a publication whose hash does not match, and a caller that had to branch on null would
 * eventually branch wrongly.
 */
export async function loadVerifiedPublication(query: Query, publicationId: number): Promise<Extract<PublicationVerdict, { ok: true }>> {
  const rows = (await query(PUBLICATION_LOAD_QUERY, [publicationId])).rows;
  if (rows.length === 0) {
    throw new PublicationIntegrityError(publicationId, [`no publication with id ${publicationId} exists in this database`]);
  }
  return assertStoredPublication(rows[0] as PublicationRow);
}

/** Read the governing publication of an examination and verify it. One row, or a refusal. */
export async function loadCurrentPublication(query: Query, examinationId: number): Promise<Extract<PublicationVerdict, { ok: true }>> {
  const rows = (await query(CURRENT_PUBLICATION_LOAD_QUERY, [examinationId])).rows;
  if (rows.length === 0) {
    throw new PublicationIntegrityError(null, [`examination ${examinationId} has no published catalogue`]);
  }
  if (rows.length > 1) {
    throw new PublicationIntegrityError(null, [`clinical_current_publications returned ${rows.length} governing publications for examination ${examinationId}`]);
  }
  return assertStoredPublication(rows[0] as PublicationRow);
}

/**
 * The other half of integrity: does a stored publication still describe the catalogue that is live
 * right now. This is NOT a validity check — a publication stays exactly as true of the moment it was
 * made as the clock runs — and it is what a publisher calls before re-publishing unchanged content,
 * and what an administrator calls to ask "has the published configuration drifted?".
 *
 * It needs a connection, so it is a function over the two pure ones rather than a rule inside
 * verifyStoredPublication().
 */
export async function recomputeAgainstLiveRows(
  query: Query,
  stored: Extract<PublicationVerdict, { ok: true }>,
): Promise<{ drifted: boolean; liveContentHash: string }> {
  const rows = await loadCatalogueRows(query, stored.examinationId);
  const liveContentHash = catalogueContentHash(buildCatalogueSnapshot(rows));
  return { drifted: liveContentHash !== stored.contentHash, liveContentHash };
}


/**
 * The ten scoped reads that produce the rows this module freezes, each taking the examination id
 * as $1 and each carrying the join columns `identity` needs. They are here, next to the identity
 * expressions they exist to feed, rather than embedded in a component, so there is one answer to
 * "what is in scope for publication" — and the gate's check 14 `live` CTE is the same ten
 * predicates stated in SQL.
 *
 * The pairing is not trusted to reading: clinicalCatalogue.db.test.ts publishes a document built
 * by running exactly these queries and requires the database to accept it, then perturbs one
 * domain at a time and requires a refusal naming that domain. A SQL predicate and a TypeScript
 * query that disagree about scope cannot survive that pair of assertions, whichever direction the
 * disagreement goes.
 *
 * `SELECT x.*` is deliberate: an entry has to carry every column of its row for a restore to be
 * total, so a publisher that started naming columns one at a time would quietly freeze a partial
 * configuration. The schema-parity guard in clinicalCatalogue.schema.test.ts is what notices when
 * a catalogue table gains a column that no domain covers.
 */
export const SNAPSHOT_SCOPE_QUERIES: Record<SnapshotDomainField | typeof MEMBER_FIELD, string> = {
  examination: `SELECT * FROM clinical_examinations WHERE id = $1 AND deleted_at IS NULL`,
  sections: `SELECT s.* FROM clinical_anatomical_sections s
              WHERE s.examination_id = $1 AND s.deleted_at IS NULL`,
  normalSlots: `SELECT n.* FROM clinical_normal_slots n
                WHERE n.examination_id = $1 AND n.deleted_at IS NULL`,
  tiles: `SELECT k.* FROM clinical_tile_examinations p
           JOIN clinical_tiles k ON k.id = p.tile_id AND k.deleted_at IS NULL
          WHERE p.examination_id = $1 AND p.deleted_at IS NULL`,
  placements: `SELECT e.*, k.key AS tile_key FROM clinical_tile_examinations e
                JOIN clinical_tiles k ON k.id = e.tile_id AND k.deleted_at IS NULL
               WHERE e.examination_id = $1 AND e.deleted_at IS NULL`,
  parameters: `SELECT tp.*, tk.key AS tile_key FROM clinical_tile_parameters tp
                JOIN clinical_tiles tk ON tk.id = tp.tile_id AND tk.deleted_at IS NULL
               WHERE tp.deleted_at IS NULL
                 AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                              WHERE p.tile_id = tp.tile_id AND p.examination_id = $1
                                AND p.deleted_at IS NULL)`,
  normalReplacements: `SELECT nr.*, k.key AS tile_key, ns.key AS normal_slot_key
                FROM clinical_tile_normal_replacements nr
                JOIN clinical_tiles k ON k.id = nr.tile_id AND k.deleted_at IS NULL
                JOIN clinical_normal_slots ns ON ns.id = nr.normal_slot_id AND ns.deleted_at IS NULL
               WHERE nr.deleted_at IS NULL AND ns.examination_id = $1
                 AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                              WHERE p.tile_id = nr.tile_id AND p.examination_id = $1
                                AND p.deleted_at IS NULL)`,
  relationships: `SELECT r.*, a.key AS tile_key, b.key AS related_tile_key
                FROM clinical_tile_relationships r
                JOIN clinical_tiles a ON a.id = r.tile_id AND a.deleted_at IS NULL
                LEFT JOIN clinical_tiles b ON b.id = r.related_tile_id
               WHERE r.deleted_at IS NULL
                 AND EXISTS (SELECT 1 FROM clinical_tile_examinations p
                              WHERE p.tile_id = r.tile_id AND p.examination_id = $1
                                AND p.deleted_at IS NULL)`,
  combinationRules: `SELECT r.* FROM clinical_combination_rules r
                     WHERE r.examination_id = $1 AND r.deleted_at IS NULL`,
  combinationMembers: `SELECT m.*, cr.key AS rule_key, k.key AS tile_key
                FROM clinical_combination_rule_members m
                JOIN clinical_combination_rules cr ON cr.id = m.rule_id
                                                 AND cr.examination_id = $1
                                                 AND cr.deleted_at IS NULL
                LEFT JOIN clinical_tiles k ON k.id = m.tile_id
               WHERE m.deleted_at IS NULL`,
  recommendationRules: `SELECT r.* FROM clinical_recommendation_rules r
                        WHERE r.examination_id = $1 AND r.deleted_at IS NULL`,
};

/** Read one examination's live configuration with the scoped queries above. */
export async function loadCatalogueRows(
  query: (sqlText: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
  examinationId: number,
): Promise<CatalogueRows> {
  const read = async (field: SnapshotDomainField | typeof MEMBER_FIELD): Promise<Record<string, unknown>[]> =>
    (await query(SNAPSHOT_SCOPE_QUERIES[field], [examinationId])).rows;
  const [examination, sections, normalSlots, tiles, placements, parameters, normalReplacements,
    relationships, combinationRules, combinationMembers, recommendationRules] = await Promise.all([
    read("examination"),
    read("sections"),
    read("normalSlots"),
    read("tiles"),
    read("placements"),
    read("parameters"),
    read("normalReplacements"),
    read("relationships"),
    read("combinationRules"),
    read(MEMBER_FIELD),
    read("recommendationRules"),
  ]);
  if (examination.length === 0) {
    throw new Error(`catalogue snapshot: examination ${examinationId} has no live row to freeze`);
  }
  return {
    examination: examination[0],
    sections,
    normalSlots,
    tiles,
    placements,
    parameters,
    normalReplacements,
    relationships,
    combinationRules,
    combinationMembers: combinationMembers as CombinationMemberRow[],
    recommendationRules,
  };
}
