/*
 * Canonical publication snapshot — the pure half of the contract.
 *
 * These tests run without a database. They pin the serialization convention that the hash is
 * taken over, because the whole value of content_hash rests on it: if two publishers can produce
 * different bytes for one unchanged catalogue, "has the published content changed?" has no
 * answer, and the drift detector that Stage F is built on becomes a coin toss. The companion
 * half — that the database agrees with this module about the ten domains and their identities —
 * is in lib/db/src/schema/clinicalCatalogue.db.test.ts, which publishes a document built here.
 */

import { describe, expect, it } from "vitest";
import {
  MEMBER_FIELD,
  SNAPSHOT_DOMAINS,
  SNAPSHOT_VERSION,
  buildCatalogueSnapshot,
  canonicalize,
  catalogueContentHash,
  publicationColumnsFor,
  type CatalogueRows,
} from "./cataloguePublicationSnapshot";

function examinationRow(id = 7): Record<string, unknown> {
  return {
    id,
    key: "MRIBRAIN",
    label: "MRI Brain",
    modality: "MR",
    body_part: "Brain",
    protocol_scope: "Standard",
    template_key: null,
    review_state: "approved",
    review_note: null,
    status: "active",
    version: 1,
    created_by: "abinash",
    updated_by: "abinash",
    created_at: new Date("2026-10-15T04:00:00.000Z"),
    updated_at: new Date("2026-10-15T04:00:00.000Z"),
    deleted_at: null,
  };
}

function tileRow(id: number, key = `t.${id}`): Record<string, unknown> {
  return {
    id,
    key,
    concept_id: 100 + id,
    label: `Tile ${key}`,
    tile_category: "abnormal",
    findings_text: `findings for ${key}`,
    impression_text: "",
    recommendation_text: "",
    technique_text: "",
    conflict_group: "",
    review_state: "approved",
    review_note: null,
    status: "active",
    version: 1,
    created_by: null,
    updated_by: null,
    created_at: new Date("2026-10-15T04:00:00.000Z"),
    updated_at: new Date("2026-10-15T04:00:00.000Z"),
    deleted_at: null,
  };
}

function sectionRow(id: number, key: string, ordinal: number | null): Record<string, unknown> {
  return {
    id,
    examination_id: 7,
    key,
    label: key,
    parent_section_id: null,
    section_field: "findings",
    ordinal,
    emits_heading: true,
    review_state: "approved",
    review_note: null,
    status: "active",
    version: 1,
    created_by: null,
    updated_by: null,
    created_at: new Date("2026-10-15T04:00:00Z"),
    updated_at: new Date("2026-10-15T04:00:00Z"),
    deleted_at: null,
  };
}

function placementRow(tileId: number, tileKey: string, ordinal: number | null): Record<string, unknown> {
  return {
    id: 500 + tileId,
    tile_id: tileId,
    examination_id: 7,
    section_id: null,
    ordinal,
    is_featured: false,
    created_by: null,
    updated_by: null,
    created_at: new Date("2026-10-15T04:00:00Z"),
    updated_at: new Date("2026-10-15T04:00:00Z"),
    deleted_at: null,
    tile_key: tileKey,
  };
}

function rowsWith(overrides: Partial<CatalogueRows> = {}): CatalogueRows {
  return {
    examination: examinationRow(),
    sections: [sectionRow(11, "s.b", 2), sectionRow(12, "s.a", 1)],
    normalSlots: [],
    tiles: [tileRow(2, "t.2"), tileRow(1, "t.1")],
    placements: [placementRow(2, "t.2", 2), placementRow(1, "t.1", 1)],
    parameters: [],
    normalReplacements: [],
    relationships: [],
    combinationRules: [],
    combinationMembers: [],
    recommendationRules: [],
    ...overrides,
  };
}

describe("canonicalization", () => {
  it("orders object keys by code point at every depth", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("keeps arrays in the order given, so ordinal order survives and input order does not", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([{ z: 1 }, { a: 2 }])).toBe('[{"z":1},{"a":2}]');
  });

  it("produces the same text for two objects that differ only in key insertion order", () => {
    expect(canonicalize({ one: 1, two: 2 })).toBe(canonicalize({ two: 2, one: 1 }));
  });

  it("drops undefined instead of emitting a field that jsonb would discard anyway", () => {
    expect(canonicalize({ keep: 1, dropped: undefined })).toBe('{"keep":1}');
    expect(catalogueContentHash({ a: 1, b: undefined })).toBe(catalogueContentHash({ a: 1 }));
  });

  it("refuses a non-finite number rather than hashing a value Postgres cannot store", () => {
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalize({ n: NaN })).toThrow(/non-finite/);
  });

  it("renders a Date as ISO-8601 UTC, so a +05:30 build and a UTC build agree", () => {
    const date = new Date("2026-10-15T04:00:00Z");
    expect(canonicalize({ at: date })).toBe(`{"at":"${date.toISOString()}"}`);
  });
});

describe("driver-independent scalars", () => {
  it("normalises whole-number strings to numbers, because int8 arrives as a string and a number", () => {
    expect(canonicalize({ id: "42" })).toBe(canonicalize({ id: 42 }));
    expect(catalogueContentHash({ id: "42" })).toBe(catalogueContentHash({ id: 42 }));
  });

  it("leaves a NUMERIC clinical threshold exactly as supplied rather than rounding it", () => {
    // 10.50 and 10.5 are different published values: the clinic entered the precision.
    expect(canonicalize({ min_value: "10.50" })).toBe('{"min_value":"10.50"}');
    expect(catalogueContentHash({ v: "10.50" })).not.toBe(catalogueContentHash({ v: "10.5" }));
  });

  it("leaves an int8 beyond safe-integer precision as the string that represents it exactly", () => {
    const huge = "9007199254740993"; // 2^53 + 1, not representable as a JS number
    expect(canonicalize({ id: huge })).toBe(`{"id":"${huge}"}`);
  });
});

describe("buildCatalogueSnapshot", () => {
  it("emits exactly the ten domains the publication gate requires", () => {
    const doc = buildCatalogueSnapshot(rowsWith());
    expect(Object.keys(doc).sort()).toEqual(
      [
        "combinationRules",
        "examination",
        "normalReplacements",
        "normalSlots",
        "parameters",
        "placements",
        "recommendationRules",
        "relationships",
        "sections",
        "tiles",
      ].sort(),
    );
    expect(SNAPSHOT_DOMAINS.map((d) => d.field).sort()).toEqual(Object.keys(doc).sort());
  });

  it("orders each domain by ordinal, then identity, so the document is not a SELECT artefact", () => {
    const doc = buildCatalogueSnapshot(rowsWith());
    expect(doc.sections.map((s) => s.identity)).toEqual(["s.a", "s.b"]);
    expect(doc.tiles.map((t) => t.identity)).toEqual(["t.1", "t.2"]);
    expect(doc.placements.map((p) => p.identity)).toEqual(["t.1", "t.2"]);
  });

  it("orders by identity when ordinals are all equal, which is the only thing a DEFAULT 0 leaves", () => {
    const rows = rowsWith({
      placements: [placementRow(2, "t.2", 0), placementRow(1, "t.1", 0)],
    });
    expect(buildCatalogueSnapshot(rows).placements.map((p) => p.identity)).toEqual(["t.1", "t.2"]);
  });

  it("puts a row nobody has placed after the rows that are placed, not first", () => {
    const rows = rowsWith({
      placements: [placementRow(3, "t.3", null), placementRow(1, "t.1", 1), placementRow(2, "t.2", 2)],
    });
    expect(buildCatalogueSnapshot(rows).placements.map((p) => p.identity)).toEqual(["t.1", "t.2", "t.3"]);
  });

  it("gives every array entry an identity, and it is the examination-scoped handle, not the id", () => {
    const doc = buildCatalogueSnapshot(rowsWith());
    for (const domain of SNAPSHOT_DOMAINS.filter((d) => d.shape === "array")) {
      for (const entry of (doc as Record<string, unknown>)[domain.field] as { identity: string }[]) {
        expect(entry.identity).not.toBe("");
      }
    }
    expect(doc.tiles[0].identity).toBe("t.1");
  });

  it("strips the publisher's join columns so an entry is the table's column set plus identity", () => {
    const doc = buildCatalogueSnapshot(rowsWith());
    expect(doc.placements[0]).not.toHaveProperty("tile_key");
    expect(Object.keys(doc.placements[0]).sort()).toEqual(
      ["id", "tile_id", "examination_id", "section_id", "ordinal", "is_featured", "created_by",
        "updated_by", "deleted_at", "identity"].sort(),
    );
  });

  it("freezes no clock column, because a hash that moves with the time is not a content hash", () => {
    const before = buildCatalogueSnapshot(rowsWith());
    const rows = rowsWith();
    rows.examination.updated_at = new Date("2027-01-01T00:00:00Z");
    rows.tiles[0].created_at = new Date("2000-01-01T00:00:00Z");
    const after = buildCatalogueSnapshot(rows);
    expect(canonicalize(after)).toBe(canonicalize(before));
    expect(after.examination).not.toHaveProperty("updated_at");
    // Attribution is not a clock: who wrote the sentence stays in the record.
    expect(after.examination.created_by).toBe("abinash");
  });

  it("nests each combination rule's members inside the rule that owns them", () => {
    const rows = rowsWith({
      combinationRules: [
        { id: 90, key: "c.2", examination_id: 7, ordinal: 2 },
        { id: 91, key: "c.1", examination_id: 7, ordinal: 1 },
      ],
      combinationMembers: [
        { id: 1, rule_id: 90, rule_key: "c.2", tile_id: 1, tile_key: "t.1", concept_id: null, is_optional: false, ordinal: 0 },
        { id: 2, rule_id: 91, rule_key: "c.1", tile_id: 2, tile_key: "t.2", concept_id: null, is_optional: true, ordinal: 0 },
      ],
    });
    const doc = buildCatalogueSnapshot(rows);
    expect(doc.combinationRules.map((r) => r.identity)).toEqual(["c.1", "c.2"]);
    const first = doc.combinationRules[0] as Record<string, unknown>;
    const members = first.members as { identity: string }[];
    expect(members.map((m) => m.identity)).toEqual(["c.1/t.2"]);
    expect(members[0]).not.toHaveProperty("rule_key");
    expect(members[0]).not.toHaveProperty("tile_key");
  });

  it("keys a member by its tile, or by the concept when the member is a concept requirement", () => {
    const rows = rowsWith({
      combinationRules: [{ id: 90, key: "c.1", examination_id: 7, ordinal: 1 }],
      combinationMembers: [
        { id: 1, rule_id: 90, rule_key: "c.1", tile_id: null, tile_key: null, concept_id: 44, ordinal: 0 },
        { id: 2, rule_id: 90, rule_key: "c.1", tile_id: 1, tile_key: "t.1", concept_id: null, ordinal: 0 },
      ],
    });
    const members = (buildCatalogueSnapshot(rows).combinationRules[0] as Record<string, unknown>)
      .members as { identity: string }[];
    expect(members.map((m) => m.identity)).toEqual(["c.1/concept:44", "c.1/t.1"]);
  });

  it("names a relationship by both ends and the kind, so A→B can carry more than one rule", () => {
    const rows = rowsWith({
      relationships: [
        { id: 1, tile_id: 1, tile_key: "t.1", relation_kind: "requires", related_tile_id: 2, related_tile_key: "t.2", related_concept_id: null, ordinal: 0 },
        { id: 2, tile_id: 1, tile_key: "t.1", relation_kind: "supersedes", related_tile_id: 2, related_tile_key: "t.2", related_concept_id: null, ordinal: 0 },
        { id: 3, tile_id: 2, tile_key: "t.2", relation_kind: "excludes", related_tile_id: null, related_tile_key: null, related_concept_id: 77, ordinal: 0 },
      ],
    });
    expect(buildCatalogueSnapshot(rows).relationships.map((r) => r.identity)).toEqual([
      "t.1~requires~t.2",
      "t.1~supersedes~t.2",
      "t.2~excludes~concept:77",
    ]);
  });

  it("separates a parameter's identity by its tile, because 'severity' is not unique", () => {
    const rows = rowsWith({
      parameters: [
        { id: 1, tile_id: 1, tile_key: "t.1", key: "severity", data_type: "severity", ordinal: 0 },
        { id: 2, tile_id: 2, tile_key: "t.2", key: "severity", data_type: "severity", ordinal: 0 },
      ],
    });
    expect(buildCatalogueSnapshot(rows).parameters.map((p) => p.identity)).toEqual(["t.1/severity", "t.2/severity"]);
  });

  it("refuses to invent an identity when the publisher forgot a join column", () => {
    const rows = rowsWith({ parameters: [{ id: 1, tile_id: 1, key: "severity" }] });
    expect(() => buildCatalogueSnapshot(rows)).toThrow(/a parameters entry carries no tile key/);
    const orphan = rowsWith({ placements: [{ id: 1, tile_id: 1, examination_id: 7, ordinal: 1 }] });
    expect(() => buildCatalogueSnapshot(orphan)).toThrow(/no tile key/);
  });

  it("carries jsonb columns through as structured values, not as text", () => {
    const rows = rowsWith({
      relationships: [
        { id: 1, tile_id: 1, tile_key: "t.1", relation_kind: "requires", related_tile_id: 2, related_tile_key: "t.2", condition_json: { b: 1, a: 2 } },
      ],
    });
    const entry = buildCatalogueSnapshot(rows).relationships[0] as Record<string, unknown>;
    expect(canonicalize(entry.condition_json)).toBe('{"a":2,"b":1}');
  });
});

describe("content hash", () => {
  it("is a lowercase sha-256 hex digest, which is the shape content_hash's CHECK requires", () => {
    const hash = catalogueContentHash(buildCatalogueSnapshot(rowsWith()));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is the same for the same catalogue read in a different order", () => {
    const a = buildCatalogueSnapshot(rowsWith());
    const b = buildCatalogueSnapshot(
      rowsWith({
        tiles: [tileRow(1, "t.1"), tileRow(2, "t.2")],
        sections: [sectionRow(12, "s.a", 1), sectionRow(11, "s.b", 2)],
        placements: [placementRow(1, "t.1", 1), placementRow(2, "t.2", 2)],
      }),
    );
    expect(catalogueContentHash(a)).toBe(catalogueContentHash(b));
  });

  it("changes when a clinical value changes", () => {
    const before = catalogueContentHash(buildCatalogueSnapshot(rowsWith()));
    const rows = rowsWith();
    (rows.tiles[0] as Record<string, unknown>).findings_text = "revised wording";
    expect(catalogueContentHash(buildCatalogueSnapshot(rows))).not.toBe(before);
  });

  it("changes when an ordinal changes, because order is a clinical fact about the report", () => {
    const before = catalogueContentHash(buildCatalogueSnapshot(rowsWith()));
    const rows = rowsWith();
    (rows.placements[0] as Record<string, unknown>).ordinal = 9;
    expect(catalogueContentHash(buildCatalogueSnapshot(rows))).not.toBe(before);
  });

  it("survives a round trip through jsonb key reordering, which is how the drift detector reads it", () => {
    const doc = buildCatalogueSnapshot(rowsWith());
    const stored = JSON.parse(JSON.stringify({ z: doc }))["z"];
    const reordered = Object.fromEntries(Object.entries(stored).reverse());
    expect(catalogueContentHash(reordered)).toBe(catalogueContentHash(doc));
  });

  it("is what publicationColumnsFor stores and what it hashes, from one call", () => {
    const prepared = publicationColumnsFor(rowsWith());
    expect(prepared.snapshotVersion).toBe(SNAPSHOT_VERSION);
    expect(prepared.contentHash).toBe(catalogueContentHash(prepared.catalogueSnapshot));
    expect(prepared.catalogueSnapshot.examination.id).toBe(7);
  });
});

describe("the domain list as a contract", () => {
  it("names examination as the only object domain", () => {
    expect(SNAPSHOT_DOMAINS.filter((d) => d.shape === "object").map((d) => d.field)).toEqual(["examination"]);
    expect(SNAPSHOT_DOMAINS).toHaveLength(10);
  });

  it("keeps members a nested domain, so the flattened comparison has one name to use", () => {
    expect(SNAPSHOT_DOMAINS.map((d) => d.field)).not.toContain(MEMBER_FIELD);
    expect(MEMBER_FIELD).toBe("combinationMembers");
  });

  it("gives every domain a distinct field name", () => {
    const fields = SNAPSHOT_DOMAINS.map((d) => d.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});
