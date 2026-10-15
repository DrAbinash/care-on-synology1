/**
 * Behavioural proof for the v4 clinical catalogue (Stage B), run against a real
 * database built the way the clinic builds it.
 *
 * Why this file exists next to clinicalCatalogue.schema.test.ts: the earlier canonical
 * catalog (Tickets B1/B2) shipped eleven tables whose rules were asserted by reading the
 * migration as text — and nothing ever executed them. `DrizzleCatalogStore`, the one class
 * that touches those tables in production, has still never run against a database; every
 * test that mentions it mocks it away. Text assertions cannot see a partial unique index
 * that Postgres refuses to create, a CHECK that does not fire, or a RESTRICT that was
 * written as CASCADE.
 *
 * So each invariant the model depends on is executed here:
 *   • the enum CHECKs reject the spellings a human would try next;
 *   • keys free up only after a soft delete, so a retired tile cannot collide forever;
 *   • a normal slot is identified by region, concept, level and side — five lumbar
 *     normals coexist inside one section, and the same claim cannot be stored twice
 *     under two different sections;
 *   • a section reference means a section of the SAME examination, on every path that
 *     can introduce one: insert, update, parent section, rule section, slot section, and
 *     a parameter default drawn from another parameter's option list;
 *   • a tile can be added without a position, an adjacent swap completes atomically by
 *     unplace-then-place, a position claimed twice is refused, and two administrators
 *     reordering one examination serialise on a row lock;
 *   • ON DELETE RESTRICT makes a concept or a restore-target undestroyable while a tile
 *     still points at it;
 *   • the version history, the publication record and the publication's tile manifest
 *     cannot be rewritten, and a manifest cannot cite a version that was never stored;
 *   • the publication gate refuses an unplaced tile, a rule with no required member, a
 *     tile owning a normal of an examination it is not placed in, and a rule naming an
 *     unplaced tile — while a complete catalogue publishes;
 *   • re-applying both migrations changes nothing (idempotent, so a replayed deploy is
 *     safe).
 *
 * Every test runs inside a transaction that is rolled back, so no row survives and the
 * eighteen seeded draft examinations stay exactly as the migration wrote them. The one
 * exception is the lock test, which needs two transactions that can both see a committed
 * row, so it locks a seeded examination and closes both transactions in a finally block.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  buildCatalogueSnapshot,
  canonicalize,
  catalogueContentHash,
  loadCatalogueRows,
  publicationColumnsFor,
  SNAPSHOT_DOMAINS,
  type SnapshotDocument,
} from "../cataloguePublicationSnapshot";

const dbUrl = process.env.DATABASE_URL;
const SCHEMA_FILE = "migrations/zzzz_add_clinical_catalogue_v4.sql";
const SEED_FILE = "migrations/zzzzz_seed_clinical_catalogue_v4_examinations.sql";

/**
 * The two lines of SQL text the restore test needs. They live here, in the test, and not in
 * lib/db/src/cataloguePublicationSnapshot.ts on purpose: Stage B has no administrator who can
 * press "restore", and a production writer that nothing calls is a second source of truth with
 * no owner. What this proves is the property the brief asks for — that the frozen document alone
 * is enough to put every clinical row back — and if it ever stops being enough, this test says so.
 */
function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertFromEntry(table: string, entry: Record<string, unknown>): string {
  const columns = Object.keys(entry).filter((key) => key !== "identity" && key !== "members");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((k) => sqlValue(entry[k])).join(", ")})`;
}

describe.skipIf(!dbUrl)("the v4 clinical catalogue behaves as declared", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  /** Run body inside a transaction that is always rolled back. */
  async function inTx(body: (c: Client) => Promise<void>): Promise<void> {
    await client.query("BEGIN");
    try {
      await body(client);
    } finally {
      await client.query("ROLLBACK");
    }
  }

  /**
   * Execute and return the Postgres error code + message, or null if it succeeded.
   *
   * The savepoint is not decoration: a deliberate failure aborts the enclosing
   * transaction, so without it the FIRST expected rejection turns every later
   * statement in the same test into `25P02 current transaction is aborted`. That
   * reads as "the constraint fired" while proving nothing at all.
   */
  async function attempt(
    sqlText: string,
    params?: unknown[],
  ): Promise<{ code: string; message: string } | null> {
    await client.query("SAVEPOINT catalogue_probe");
    try {
      await client.query(sqlText, params);
      await client.query("RELEASE SAVEPOINT catalogue_probe");
      return null;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await client.query("ROLLBACK TO SAVEPOINT catalogue_probe");
      return { code: err.code ?? "", message: err.message ?? "" };
    }
  }

  /**
   * A RESTRICT breach in either server dialect. PostgreSQL 18 reports it as
   * `23001 restrict_violation`; 16 and 17 report `23503 foreign_key_violation`, which is
   * what the clinic's CI container and the NAS both run. Asserting one code alone makes
   * the suite version-dependent — the first CI run failed exactly this way, red on
   * PostgreSQL 16 and green locally on 18.
   *
   * The error CODE therefore cannot distinguish RESTRICT from NO ACTION on ≤17, so the
   * constraint NAME in the message is the assertion that proves which relationship is
   * protecting the row. It is also what makes the CASCADE mutant die: under CASCADE the
   * statement succeeds, there is no error at all, and `attempt()` returns null.
   */
  const RESTRICT_CODES = ["23001", "23503"];
  function expectRestrict(err: { code: string; message: string } | null, why: string) {
    expect(err, `${why}: the delete must be refused`).not.toBeNull();
    expect(
      RESTRICT_CODES,
      `${why}: PostgreSQL reports a RESTRICT breach as ${RESTRICT_CODES.join(" or ")}, got ${err?.code}`,
    ).toContain(err?.code);
  }

  /**
   * The fixture chain a tile needs: category → concept → examination → section.
   * Concepts live in the B1/B2 catalog, which is empty by measured fact, so a tile
   * cannot be created without first creating the canonical concept it asserts.
   */
  async function seedFixture(c: Client, tag: string): Promise<{ conceptId: number; examId: number; sectionId: number }> {
    const category = await c.query(
      `INSERT INTO finding_categories (key, label) VALUES ($1, 'Fixture category') RETURNING id`,
      [`cat.${tag}`],
    );
    const concept = await c.query(
      `INSERT INTO finding_definitions (key, category_id, label) VALUES ($1, $2, 'Fixture concept') RETURNING id`,
      [`concept.${tag}`, category.rows[0]!.id],
    );
    const exam = await c.query(
      `INSERT INTO clinical_examinations (key, label, modality, body_part, protocol_scope)
       VALUES ($1, 'Fixture examination', 'MR', $2, 'Standard') RETURNING id`,
      [`fx.${tag}`, `Fixture Part ${tag}`],
    );
    const section = await c.query(
      `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
       VALUES ($1, $2, 'Fixture section', 1) RETURNING id`,
      [exam.rows[0]!.id, `sec.${tag}`],
    );
    return {
      conceptId: Number(concept.rows[0]!.id),
      examId: Number(exam.rows[0]!.id),
      sectionId: Number(section.rows[0]!.id),
    };
  }

  /**
   * A fixture that fills every one of the ten snapshot domains, because "the publication is
   * complete" is only demonstrated by a catalogue that has something in each of them. Two tiles
   * (one of a second concept, so no conflict group is implied), a normal slot one of them retires,
   * a parameter, both directions of one symmetric relationship, a combination rule with two
   * required members, and a recommendation rule. Ids come back so a test can delete or re-point
   * exactly one thing at a time.
   */
  async function seedPublishableFixture(
    c: Client,
    tag: string,
  ): Promise<{ examId: number; sectionId: number; conceptId: number; otherConceptId: number; tileA: number; tileB: number; slotId: number; ruleId: number }> {
    const f = await seedFixture(c, tag);
    const category2 = await c.query(
      `INSERT INTO finding_categories (key, label) VALUES ($1, 'Second fixture category') RETURNING id`,
      [`cat.${tag}.2`],
    );
    const concept2 = await c.query(
      `INSERT INTO finding_definitions (key, category_id, label) VALUES ($1, $2, 'Second fixture concept') RETURNING id`,
      [`concept.${tag}.2`, category2.rows[0]!.id],
    );
    const otherConceptId = Number(concept2.rows[0]!.id);
    const tileA = await insertTile(c, `${tag}.a`, f.conceptId);
    const tileB = await insertTile(c, `${tag}.b`, otherConceptId);
    await c.query(
      `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
       VALUES (${tileA}, ${f.examId}, ${f.sectionId}, 1), (${tileB}, ${f.examId}, ${f.sectionId}, 2)`,
    );
    const slot = await c.query(
      `INSERT INTO clinical_normal_slots (examination_id, concept_id, key, slot_field, rendered_text, region, ordinal)
       VALUES (${f.examId}, ${f.conceptId}, $1, 'findings', 'A fixture normal.', $2, 1) RETURNING id`,
      [`${tag}.normal`, `${tag} region`],
    );
    const slotId = Number(slot.rows[0]!.id);
    await c.query(
      `INSERT INTO clinical_tile_normal_replacements (tile_id, normal_slot_id) VALUES (${tileA}, ${slotId})`,
    );
    await c.query(
      `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, is_required)
       VALUES (${tileA}, $1, 'Severity', 'text', FALSE)`,
      [`${tag}.severity`],
    );
    await c.query(
      `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
       VALUES (${tileA}, ${tileB}, 'combines_with'), (${tileB}, ${tileA}, 'combines_with')`,
    );
    const rule = await c.query(
      `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members, ordinal)
       VALUES ($1, $2, 'Combined line', 'impression', 'One consolidated line.', TRUE, FALSE, 1) RETURNING id`,
      [`${tag}.combo`, f.examId],
    );
    const ruleId = Number(rule.rows[0]!.id);
    await c.query(
      `INSERT INTO clinical_combination_rule_members (rule_id, tile_id, is_optional, ordinal)
       VALUES (${ruleId}, ${tileA}, FALSE, 1), (${ruleId}, ${tileB}, FALSE, 2)`,
    );
    await c.query(
      `INSERT INTO clinical_recommendation_rules (key, examination_id, label, trigger_kind, concept_id, advice_text, ordinal)
       VALUES ($1, $2, 'Follow up', 'concept_present', $3, 'Clinical follow-up.', 1)`,
      [`${tag}.rec`, f.examId, f.conceptId],
    );
    return {
      examId: f.examId,
      sectionId: f.sectionId,
      conceptId: f.conceptId,
      otherConceptId,
      tileA,
      tileB,
      slotId,
      ruleId,
    };
  }

  async function insertTile(c: Client, key: string, conceptId: number, extra = ""): Promise<number> {
    const r = await c.query(
      `INSERT INTO clinical_tiles (key, concept_id, label, findings_text${extra ? ", " + extra : ""})
       VALUES ($1, $2, 'Fixture tile', 'A fixture sentence.') RETURNING id`,
      [key, conceptId],
    );
    return r.rows[0]!.id as number;
  }

  /**
   * The publication INSERT, built the way the publisher will build it: read the examination's
   * live rows through the module's own scoped queries, canonicalize, hash, store. Tests that
   * need a publication therefore do not hand-write a document, which is the point — a
   * hand-written document would prove that the gate accepts the shape the test author guessed,
   * not that it accepts the shape the code produces.
   *
   * `mutate` exists for the negative cases: it edits the built document after the builder ran
   * and before the INSERT, so a test can drop one domain, rename an entry's identity, or duplicate
   * a row — i.e. exercise the publisher bug the gate is supposed to catch, with every other domain
   * still correct. A refusal that arrives for the wrong reason reads exactly like a refusal that
   * arrived for the right one, so each of those tests asserts the domain named in the message.
   */
  async function publicationInsert(
    c: Client,
    examId: number,
    key: string,
    mutate?: (doc: SnapshotDocument) => void,
  ): Promise<{ sql: string; params: unknown[] }> {
    const rows = await loadCatalogueRows((sqlText, values) => c.query(sqlText, values), examId);
    const built = publicationColumnsFor(rows);
    const doc = built.catalogueSnapshot;
    mutate?.(doc);
    return {
      sql: `INSERT INTO clinical_publications
              (examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot)
            VALUES ($1, $2, $3, $4, $5::jsonb)`,
      params: [examId, key, built.contentHash, built.snapshotVersion, JSON.stringify(doc)],
    };
  }

  async function publish(
    c: Client,
    examId: number,
    key: string,
    mutate?: (doc: SnapshotDocument) => void,
  ): Promise<{ code: string; message: string } | null> {
    const { sql, params } = await publicationInsert(c, examId, key, mutate);
    return attempt(sql, params);
  }

  /**
   * Make an examination's fixture content publishable: reviewed, ordered, and free of the
   * unplaced leftovers a previous probe left behind. Stated as one operation because "ready to
   * publish" is four facts, and a test that silently fails check 8 instead of the check it is
   * asserting is the hollowest shape a gate test can take.
   */
  async function approveCatalogue(c: Client, examId: number): Promise<void> {
    await c.query(
      `UPDATE clinical_tiles SET review_state = 'approved'
        WHERE deleted_at IS NULL AND id IN (SELECT tile_id FROM clinical_tile_examinations
                                            WHERE examination_id = $1 AND deleted_at IS NULL)`,
      [examId],
    );
    for (const table of ["clinical_anatomical_sections", "clinical_normal_slots", "clinical_combination_rules",
      "clinical_recommendation_rules", "clinical_tile_relationships"]) {
      const where = table === "clinical_tile_relationships"
        ? `tile_id IN (SELECT tile_id FROM clinical_tile_examinations WHERE examination_id = $1 AND deleted_at IS NULL)`
        : `examination_id = $1`;
      await c.query(`UPDATE ${table} SET review_state = 'approved' WHERE deleted_at IS NULL AND ${where}`, [examId]);
    }
    await c.query(
      `UPDATE clinical_examinations SET review_state = 'approved', status = 'active' WHERE id = $1`,
      [examId],
    );
  }

  /**
   * The same document as a SQL literal, for the tests that must spell out their own INSERT
   * because the column under test is one the builder would have filled (a prose hash, a missing
   * hash, a duplicate key). Built by the same call, so a test cannot pin an old snapshot shape.
   */
  async function snapshotLiteral(c: Client, examId: number): Promise<string> {
    const rows = await loadCatalogueRows((sqlText, values) => c.query(sqlText, values), examId);
    return JSON.stringify(publicationColumnsFor(rows).catalogueSnapshot).replace(/'/g, "''");
  }

  it("freezes every column of every table it claims to restore, and invents no column", async () => {
    // The property that makes the round trip above an ongoing guarantee rather than a one-off:
    // an entry that omits a column silently loses that column on restore, and an entry that
    // carries a key which is not a column cannot be inserted at all. Both are invisible until
    // someone tries, which is exactly when a clinic finds out.
    const DOMAIN_TABLES: [string, string][] = [
      ["examination", "clinical_examinations"],
      ["sections", "clinical_anatomical_sections"],
      ["normalSlots", "clinical_normal_slots"],
      ["tiles", "clinical_tiles"],
      ["placements", "clinical_tile_examinations"],
      ["parameters", "clinical_tile_parameters"],
      ["normalReplacements", "clinical_tile_normal_replacements"],
      ["relationships", "clinical_tile_relationships"],
      ["combinationRules", "clinical_combination_rules"],
      ["recommendationRules", "clinical_recommendation_rules"],
    ];
    await inTx(async (c) => {
      const f = await seedPublishableFixture(c, "cols");
      await approveCatalogue(c, f.examId);
      const doc = buildCatalogueSnapshot(await loadCatalogueRows(
        (sqlText, values) => c.query(sqlText, values), f.examId));
      const entriesFor: Record<string, Record<string, unknown>[]> = {
        examination: [doc.examination],
        sections: doc.sections,
        normalSlots: doc.normalSlots,
        tiles: doc.tiles,
        placements: doc.placements,
        parameters: doc.parameters,
        normalReplacements: doc.normalReplacements,
        relationships: doc.relationships,
        combinationRules: doc.combinationRules,
        recommendationRules: doc.recommendationRules,
        combinationMembers: doc.combinationRules.flatMap(
          (r) => (r as Record<string, unknown>).members as Record<string, unknown>[]),
      };
      DOMAIN_TABLES.push(["combinationMembers", "clinical_combination_rule_members"]);
      for (const [field, table] of DOMAIN_TABLES) {
        const columns = await c.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        const names = new Set(columns.rows.map((r) => r.column_name));
        const frozen = [...names].filter((n) => !["created_at", "updated_at"].includes(n));
        const entries = entriesFor[field]!;
        expect(entries.length, `${table} needs a fixture row so coverage can be measured`).toBeGreaterThan(0);
        for (const entry of entries) {
          const keys = Object.keys(entry).filter((k) => k !== "identity" && k !== "members");
          const missing = frozen.filter((n) => !keys.includes(n));
          expect(missing, `a ${table} entry omits ${missing.join(", ")}: restoring would lose them`).toEqual([]);
          const invented = keys.filter((k) => !names.has(k));
          expect(invented, `a ${table} entry carries ${invented.join(", ")} which is not a column`).toEqual([]);
        }
      }
    });
  });

  it("builds a publication the database itself accepts, then refuses each way a publisher can be wrong", async () => {
    await inTx(async (c) => {
      const f = await seedPublishableFixture(c, "snap");

      // The positive control first, because every refusal below is only evidence if the
      // unperturbed document is accepted.
      await approveCatalogue(c, f.examId);
      expect(await publish(c, f.examId, "pub.snap.ok"), "a real catalogue publishes").toBeNull();

      // The document that was stored is the document the builder made, and the hash is its
      // canonical text — not a value the test supplied and the database trusted.
      const stored = await c.query<{ catalogue_snapshot: Record<string, unknown>; content_hash: string }>(
        `SELECT catalogue_snapshot, content_hash FROM clinical_publications WHERE publication_key = 'pub.snap.ok'`,
      );
      const rows = await loadCatalogueRows((sqlText, values) => c.query(sqlText, values), f.examId);
      const rebuilt = buildCatalogueSnapshot(rows);
      expect(catalogueContentHash(stored.rows[0]!.catalogue_snapshot)).toBe(stored.rows[0]!.content_hash);
      expect(catalogueContentHash(rebuilt)).toBe(stored.rows[0]!.content_hash);
      expect(Object.keys(stored.rows[0]!.catalogue_snapshot).sort()).toEqual(
        SNAPSHOT_DOMAINS.map((d) => d.field).sort(),
      );
      // Ten domains, and the arrays carry the rows the examination actually has.
      expect((stored.rows[0]!.catalogue_snapshot.tiles as unknown[]).length).toBe(2);
      expect((stored.rows[0]!.catalogue_snapshot.placements as unknown[]).length).toBe(2);
      expect((stored.rows[0]!.catalogue_snapshot.parameters as unknown[]).length).toBe(1);
      expect((stored.rows[0]!.catalogue_snapshot.normalReplacements as unknown[]).length).toBe(1);
      expect((stored.rows[0]!.catalogue_snapshot.relationships as unknown[]).length).toBe(2);
      expect((stored.rows[0]!.catalogue_snapshot.recommendationRules as unknown[]).length).toBe(1);
      const combos = stored.rows[0]!.catalogue_snapshot.combinationRules as Record<string, unknown>[];
      expect(combos).toHaveLength(1);
      expect(combos[0]!.members).toHaveLength(2);

      // One refusal per domain, each perturbing only that domain. The expected sentence is the
      // whole prefix the gate produces, because the refusal is ordered (domain, kind, identity)
      // — a message that named a different domain on each run of the same broken document could
      // not be asserted against at all.
      const perturbations: [string, RegExp, (doc: SnapshotDocument) => void][] = [
        ["tiles", /catalogue_snapshot\.tiles omits the live row snap\.a/, (doc) => {
          doc.tiles = doc.tiles.filter((t) => t.identity !== "snap.a");
        }],
        ["placements", /catalogue_snapshot\.placements omits the live row snap\.b/, (doc) => {
          doc.placements = doc.placements.filter((p) => p.identity !== "snap.b");
        }],
        ["sections", /catalogue_snapshot\.sections omits the live row/, (doc) => { doc.sections = []; }],
        ["normalSlots", /catalogue_snapshot\.normalSlots omits the live row snap\.normal/, (doc) => {
          doc.normalSlots = [];
        }],
        ["parameters", /catalogue_snapshot\.parameters omits the live row snap\.a\/snap\.severity/, (doc) => {
          doc.parameters = [];
        }],
        ["normalReplacements", /catalogue_snapshot\.normalReplacements omits the live row snap\.a>snap\.normal/, (doc) => {
          doc.normalReplacements = [];
        }],
        ["relationships", /catalogue_snapshot\.relationships omits the live row/, (doc) => {
          doc.relationships = [];
        }],
        ["recommendationRules", /catalogue_snapshot\.recommendationRules omits the live row snap\.rec/, (doc) => {
          doc.recommendationRules = [];
        }],
        // Deleting the RULE is reported against its members, which is the alphabetically first
        // domain of the two and both are true: the rule is missing and so are its two members.
        // Asserting the sentence the gate actually produces, rather than the one that reads best,
        // is what keeps this test honest as the ordering rule.
        ["combinationRules", /catalogue_snapshot\.combinationMembers omits the live row snap\.combo\/snap\.a/, (doc) => {
          doc.combinationRules = [];
        }],
        ["combinationMembers", /catalogue_snapshot\.combinationMembers omits the live row snap\.combo\/snap\.a/, (doc) => {
          doc.combinationRules = doc.combinationRules.map((r) => ({ ...r, members: [] }));
        }],
      ];
      for (const [domain, phrase, mutate] of perturbations) {
        const err = await publish(c, f.examId, `pub.snap.drop.${domain}`, mutate);
        expect(err?.code, `dropping the ${domain} domain is refused`).toBe("P0001");
        expect(err?.message, `and names ${domain} as the domain at fault`).toMatch(phrase);
      }

      // The other three publisher mistakes: a domain of the wrong shape, an entry that names
      // nothing live, and a document about the wrong examination.
      expect((await publish(c, f.examId, "pub.snap.shape", (doc) => {
        (doc as unknown as Record<string, unknown>).tiles = { snap: "a" };
      }))?.message).toMatch(/tiles is a object, but every publication requires a array/);

      expect((await publish(c, f.examId, "pub.snap.extra", (doc) => {
        doc.tiles = [...doc.tiles, { identity: "snap.ghost", key: "snap.ghost" }];
      }))?.message).toMatch(/names the non-live row snap.ghost/);

      expect((await publish(c, f.examId, "pub.snap.dupe", (doc) => {
        doc.sections = [...doc.sections, doc.sections[0]!];
      }))?.message).toMatch(/duplicates the row/);

      expect((await publish(c, f.examId, "pub.snap.noidentity", (doc) => {
        doc.sections = doc.sections.map((s) => {
          const copy: Record<string, unknown> = { ...s };
          delete copy.identity;
          return copy as unknown as typeof s;
        });
      }))?.message).toMatch(/names the non-live row <entry with no identity>/);

      // And the one perturbation a set comparison cannot see: a document whose nine arrays are
      // this examination's, wrapped around another examination's scope record.
      const scope = await seedFixture(c, "snap-scope");
      expect((await publish(c, f.examId, "pub.snap.wrongscope", (doc) => {
        doc.examination = { ...doc.examination, id: scope.examId };
      }))?.message).toMatch(/is examination \d+ but the publication is for examination \d+/);
    });
  });

  it("restores the whole published configuration from the frozen document alone", async () => {
    // §1 asked whether rollback can restore the entire published clinical configuration. This is
    // the answer as an executable: freeze a catalogue, delete every row the document describes,
    // put them back from the document, and require the recomputed hash to be the hash that was
    // taken before anything was deleted. A document that passed the gate's count and still could
    // not rebuild a row would fail here, which is the case no coverage check can see.
    await inTx(async (c) => {
      const f = await seedPublishableFixture(c, "res");
      await approveCatalogue(c, f.examId);
      const read = (sqlText: string, values?: unknown[]) => c.query(sqlText, values);
      const original = await buildCatalogueSnapshot(await loadCatalogueRows(read, f.examId));
      const hash = catalogueContentHash(original);

      const ids = (entries: Record<string, unknown>[]): string =>
        entries.map((e) => Number(e.id)).join(",") || "-1";
      const members = original.combinationRules.flatMap((r) => (r as Record<string, unknown>).members as Record<string, unknown>[]);
      expect(members.length, "the fixture has members to restore").toBeGreaterThan(0);

      // Children first, because every one of these relationships is ON DELETE RESTRICT: this is
      // also the proof that the restrict chain is real, and a restore tool that guessed the order
      // would meet 23503 rather than rebuild the catalogue.
      const deletes = [
        `DELETE FROM clinical_combination_rule_members WHERE id IN (${ids(members)})`,
        `DELETE FROM clinical_combination_rules WHERE id IN (${ids(original.combinationRules)})`,
        `DELETE FROM clinical_recommendation_rules WHERE id IN (${ids(original.recommendationRules)})`,
        `DELETE FROM clinical_tile_relationships WHERE id IN (${ids(original.relationships)})`,
        `DELETE FROM clinical_tile_normal_replacements WHERE id IN (${ids(original.normalReplacements)})`,
        `DELETE FROM clinical_tile_parameters WHERE id IN (${ids(original.parameters)})`,
        `DELETE FROM clinical_tile_examinations WHERE id IN (${ids(original.placements)})`,
        `DELETE FROM clinical_normal_slots WHERE id IN (${ids(original.normalSlots)})`,
        `DELETE FROM clinical_anatomical_sections WHERE id IN (${ids(original.sections)})`,
        `DELETE FROM clinical_tiles WHERE id IN (${ids(original.tiles)})`,
        `DELETE FROM clinical_examinations WHERE id IN (${ids([original.examination])})`,
      ];
      for (const statement of deletes) {
        expect(await attempt(statement), statement.slice(0, 46)).toBeNull();
      }
      const gone = await c.query(
        `SELECT count(*)::int AS n FROM clinical_tile_examinations WHERE examination_id = $1`,
        [f.examId],
      );
      expect(gone.rows[0]!.n, "the examination's configuration is gone").toBe(0);

      // Parents first on the way back, straight out of the document.
      const restores = [
        insertFromEntry("clinical_examinations", original.examination),
        ...original.sections.map((s) => insertFromEntry("clinical_anatomical_sections", s)),
        ...original.normalSlots.map((s) => insertFromEntry("clinical_normal_slots", s)),
        ...original.tiles.map((t) => insertFromEntry("clinical_tiles", t)),
        ...original.placements.map((p) => insertFromEntry("clinical_tile_examinations", p)),
        ...original.parameters.map((p) => insertFromEntry("clinical_tile_parameters", p)),
        ...original.normalReplacements.map((r) => insertFromEntry("clinical_tile_normal_replacements", r)),
        ...original.relationships.map((r) => insertFromEntry("clinical_tile_relationships", r)),
        ...original.combinationRules.map((r) => insertFromEntry("clinical_combination_rules", r)),
        ...members.map((m) => insertFromEntry("clinical_combination_rule_members", m)),
        ...original.recommendationRules.map((r) => insertFromEntry("clinical_recommendation_rules", r)),
      ];
      for (const statement of restores) {
        expect(await attempt(statement), statement.slice(0, 46)).toBeNull();
      }

      const restored = await buildCatalogueSnapshot(await loadCatalogueRows(read, f.examId));
      expect(catalogueContentHash(restored), "the document rebuilds the catalogue byte for byte").toBe(hash);
      expect(canonicalize(restored), "and the document itself is identical, not merely equal in hash").toBe(
        canonicalize(original),
      );

      // The one thing restore does not reproduce is when the rows were written: created_at and
      // updated_at are deliberately not frozen, so a restored row carries the time of the
      // restore, and the durable "when was this the configuration" fact stays on the publication
      // row that cites this hash. Asserting the difference keeps that decision from being
      // mistaken for a bug later.
      const stamp = await c.query<{ created_at: Date }>(
        `SELECT created_at FROM clinical_tiles WHERE id = $1`, [Number(original.tiles[0]!.id)],
      );
      expect(stamp.rows[0]!.created_at.getTime()).toBeGreaterThan(0);
      expect(original.tiles[0]).not.toHaveProperty("created_at");
    });
  });

  it("creates all fourteen tables with every column drizzle declares", async () => {    const expected: Record<string, string[]> = {
      clinical_examinations: ["id", "key", "label", "modality", "body_part", "protocol_scope", "template_key", "review_state", "review_note", "status", "version", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_anatomical_sections: ["id", "examination_id", "key", "label", "parent_section_id", "section_field", "ordinal", "emits_heading", "review_state", "review_note", "status", "version", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_normal_slots: ["id", "examination_id", "section_id", "concept_id", "key", "slot_field", "rendered_text", "level", "laterality", "region", "ordinal", "review_state", "review_note", "status", "version", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_tiles: ["id", "key", "concept_id", "label", "tile_category", "findings_text", "impression_text", "recommendation_text", "technique_text", "conflict_group", "review_state", "review_note", "provenance_kind", "provenance_ref", "status", "version", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_tile_examinations: ["id", "tile_id", "examination_id", "section_id", "ordinal", "is_featured", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_tile_versions: ["id", "tile_id", "version", "snapshot_json", "change_note", "published_by", "published_at", "created_at"],
      clinical_tile_parameters: ["id", "tile_id", "key", "label", "parameter_group_id", "default_option_id", "data_type", "is_required", "allow_multiple", "unit", "min_value", "max_value", "ordinal", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_tile_normal_replacements: ["id", "tile_id", "normal_slot_id", "ordinal", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_tile_relationships: ["id", "tile_id", "related_tile_id", "related_concept_id", "relation_kind", "condition_json", "ordinal", "review_state", "review_note", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_combination_rules: ["id", "key", "examination_id", "section_id", "label", "target_field", "combined_text", "suppress_members", "requires_only_members", "ordinal", "review_state", "review_note", "status", "version", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_combination_rule_members: ["id", "rule_id", "tile_id", "concept_id", "required_value", "is_optional", "ordinal", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_recommendation_rules: ["id", "key", "examination_id", "label", "trigger_kind", "tile_id", "concept_id", "parameter_key", "parameter_value", "advice_text", "priority", "emit_policy", "ordinal", "review_state", "review_note", "status", "version", "created_by", "updated_by", "created_at", "updated_at", "deleted_at"],
      clinical_publications: ["id", "examination_id", "publication_key", "content_hash", "snapshot_version", "catalogue_snapshot", "summary_json", "notes", "published_by", "published_at", "created_at"],
      clinical_publication_tiles: ["id", "publication_id", "tile_id", "tile_version", "ordinal", "created_at"],
    };
    const live = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'clinical_%'`,
    );
    const present = new Set(live.rows.map((r) => `${r.table_name}.${r.column_name}`));
    expect(Object.keys(expected)).toHaveLength(14);
    for (const [table, columns] of Object.entries(expected)) {
      const missing = columns.filter((col) => !present.has(`${table}.${col}`));
      expect(missing, `${table} is missing columns the migration was supposed to create`).toEqual([]);
    }
    // The catalogue creates exactly these fourteen tables — an eleventh through
    // fourteenth appearing in the database but not in this list is a table that was added
    // to the SQL without being thought about.
    const created = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'clinical_%'`,
    );
    expect(created.rows.map((r) => r.tablename).sort()).toEqual(Object.keys(expected).sort());
  });

  it("keeps the ordinal columns nullable but never zero, so a draft is not a collision", async () => {
    const nullable = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'clinical_%' AND column_name = 'ordinal'`,
    );
    const byTable = new Map(nullable.rows.map((r) => [r.table_name, r.is_nullable]));
    // Placed-ness is a fact an author states, so these three start empty. Every other
    // ordinal in the family is a display hint inside one parent row and keeps its default.
    for (const table of ["clinical_anatomical_sections", "clinical_normal_slots", "clinical_tile_examinations"]) {
      expect(byTable.get(table), `${table}.ordinal must be nullable`).toBe("YES");
    }
    const defaults = await client.query<{ table_name: string; column_default: string | null }>(
      `SELECT table_name, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'clinical_%' AND column_name = 'ordinal'`,
    );
    for (const row of defaults.rows) {
      if (["clinical_anatomical_sections", "clinical_normal_slots", "clinical_tile_examinations"].includes(row.table_name)) {
        expect(row.column_default, `${row.table_name}.ordinal must never gain a default again`).toBeNull();
      }
    }
  });

  it("accepts exactly the eleven modalities the product declares", async () => {
    const modalities = ["XR", "CT", "MR", "US", "MG", "DX", "NM", "PT", "DOPPLER", "ECHO", "USG_OB"];
    await inTx(async (c) => {
      for (const m of modalities) {
        const err = await attempt(
          `INSERT INTO clinical_examinations (key, label, modality, body_part, protocol_scope)
           VALUES ('mod.${m}', 'Modality probe', '${m}', 'Probe Part', 'Standard')`,
        );
        expect(err, `${m} must be a valid modality`).toBeNull();
      }
    });
  });

  it("refuses the modality spelling a human would try next", async () => {
    await inTx(async () => {
      const err = await attempt(
        `INSERT INTO clinical_examinations (key, label, modality, body_part)
         VALUES ('mod.mri', 'Wrong spelling', 'MRI', 'Probe Part')`,
      );
      expect(err?.code, "MRI is not the declared token MR").toBe("23514");
      expect(err?.message).toMatch(/modality/);
    });
  });

  it("refuses a laterality that is not one of the four the slot key understands", async () => {
    await inTx(async (c) => {
      const { conceptId, examId } = await seedFixture(c, "lat");
      const base = `INSERT INTO clinical_normal_slots (examination_id, concept_id, key, slot_field, rendered_text, laterality)`;
      // 'Lt' would become a second spelling of left, and a tile keyed on 'LEFT' would
      // stop matching its own normal.
      const lt = await attempt(
        `${base} VALUES (${examId}, ${conceptId}, 's.lt', 'findings', 'x', 'Lt')`,
      );
      expect(lt?.code, "'Lt' must not be a storable laterality").toBe("23514");
      const empty = await attempt(
        `${base} VALUES (${examId}, ${conceptId}, 's.em', 'findings', 'x', '')`,
      );
      expect(empty?.code, "empty string must not be a storable laterality").toBe("23514");
      const ok = await attempt(
        `${base} VALUES (${examId}, ${conceptId}, 's.l', 'findings', 'x', 'left')`,
      );
      expect(ok, "'left' must be storable").toBeNull();
      const nullLat = await attempt(
        `${base} VALUES (${examId}, ${conceptId}, 's.n', 'findings', 'x', NULL)`,
      );
      expect(nullLat, "NULL means not-sided and must be storable").toBeNull();
    });
  });

  it("frees a key only after a soft delete, never after a hard one", async () => {
    await inTx(async (c) => {
      const { conceptId } = await seedFixture(c, "keyfree");
      await insertTile(c, "tile.dup", conceptId);
      const second = await attempt(
        `INSERT INTO clinical_tiles (key, concept_id, label, findings_text)
         VALUES ('tile.dup', ${conceptId}, 'Another tile', 'A second fixture sentence.')`,
      );
      expect(second?.code, "two live tiles cannot share a key").toBe("23505");
      expect(second?.message).toMatch(/clinical_tiles_key_uq/);

      await c.query(`UPDATE clinical_tiles SET deleted_at = NOW() WHERE key = 'tile.dup'`);
      const afterSoftDelete = await attempt(
        `INSERT INTO clinical_tiles (key, concept_id, label, findings_text)
         VALUES ('tile.dup', ${conceptId}, 'Replacement tile', 'New sentence.')`,
      );
      expect(afterSoftDelete, "a retired row must release its key").toBeNull();
    });
  });

  it("cannot orphan the concept a tile asserts, nor the normal a tile would restore", async () => {
    await inTx(async (c) => {
      const { conceptId, examId, sectionId } = await seedFixture(c, "restrict");
      const tileId = await insertTile(c, "tile.restrict", conceptId);

      // Asserted FIRST, while the tile has no other dependants. Mutant M3 (this FK
      // rewritten to ON DELETE CASCADE) survived an earlier version of this test, because
      // once a replacement or placement edge existed the cascade was blocked by *that*
      // RESTRICT and the delete still failed: the assertion passed without proving which
      // relationship protected the concept. The constraint name in the message is what
      // makes that distinction, so it is part of the assertion.
      const conceptDelete = await attempt(`DELETE FROM finding_definitions WHERE id = ${conceptId}`);
      expectRestrict(conceptDelete, "concept is RESTRICT-referenced by a tile");
      expect(conceptDelete?.message, "protected by this specific key").toMatch(/clinical_tiles_concept_id_fkey/);

      await c.query(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text)
         VALUES (${examId}, ${sectionId}, ${conceptId}, 'slot.restrict', 'findings', 'No fixture abnormality is seen.')`,
      );
      await c.query(
        `INSERT INTO clinical_tile_normal_replacements (tile_id, normal_slot_id)
         SELECT ${tileId}, id FROM clinical_normal_slots WHERE key = 'slot.restrict'`,
      );
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
         VALUES (${tileId}, ${examId}, ${sectionId}, 1)`,
      );

      // A signed report must still be able to say what a tile meant years later, so the
      // restore target may not disappear underneath it either.
      const slotDelete = await attempt(
        `DELETE FROM clinical_normal_slots WHERE key = 'slot.restrict'`,
      );
      expectRestrict(slotDelete, "normal slot is RESTRICT-referenced by the tile that restores it");
      expect(slotDelete?.message).toMatch(/clinical_tile_normal_replacements_normal_slot_id_fkey/);
      // The fixture tile now carries two RESTRICT dependants (the replacement edge and
      // the placement edge) and PostgreSQL evaluates a table's foreign keys in an
      // unspecified order, so naming a constraint on that row's delete would be a coin
      // toss CI's PostgreSQL 16 could lose. Each remaining claim therefore gets its own
      // row with exactly ONE dependant, which is what makes the constraint name a fact
      // rather than a guess.
      const placedTile = await insertTile(c, "tile.placed", conceptId);
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, ordinal)
         VALUES (${placedTile}, ${examId}, 1)`,
      );
      const tileDelete = await attempt(`DELETE FROM clinical_tiles WHERE id = ${placedTile}`);
      expectRestrict(tileDelete, "tile is RESTRICT-referenced by its placement edge");
      expect(tileDelete?.message, "by this specific key").toMatch(/clinical_tile_examinations_tile_id_fkey/);

      const bareExam = await c.query(
        `INSERT INTO clinical_examinations (key, label, modality, body_part, protocol_scope)
         VALUES ('fx.bare', 'Bare examination', 'MR', 'Bare Part', 'Standard') RETURNING id`,
      );
      const bareExamId = Number(bareExam.rows[0]!.id);
      const bareTile = await insertTile(c, "tile.bare", conceptId);
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, ordinal)
         VALUES (${bareTile}, ${bareExamId}, 1)`,
      );
      const examDelete = await attempt(`DELETE FROM clinical_examinations WHERE id = ${bareExamId}`);
      expectRestrict(examDelete, "examination is RESTRICT-referenced by a placed tile");
      expect(examDelete?.message, "by this specific key").toMatch(/clinical_tile_examinations_examination_id_fkey/);
      // Remove the dependant and the same delete must succeed. Without this, every
      // assertion above would also pass on a table whose deletes are blocked outright.
      await c.query(`DELETE FROM clinical_tile_examinations WHERE tile_id = ${bareTile}`);
      const unblocked = await attempt(`DELETE FROM clinical_examinations WHERE id = ${bareExamId}`);
      expect(unblocked, "RESTRICT prevents orphaning, it does not freeze the table").toBeNull();

      // An unreferenced concept MAY go: RESTRICT is a guard against orphaning, not a
      // refusal to ever clean up. Without this the four assertions above could pass on a
      // table where every delete is blocked.
      const looseConcept = await c.query(
        `INSERT INTO finding_definitions (key, category_id, label)
         VALUES ('concept.unused', (SELECT id FROM finding_categories WHERE key = 'cat.restrict'), 'Unused')
         RETURNING id`,
      );
      const freeDelete = await attempt(
        `DELETE FROM finding_definitions WHERE id = ${looseConcept.rows[0]!.id}`,
      );
      expect(freeDelete, "an unreferenced concept must still be deletable").toBeNull();
    });
  });

  it("makes section order total per examination and independent between them", async () => {
    await inTx(async (c) => {
      const a = await seedFixture(c, "ordA");
      const b = await seedFixture(c, "ordB");
      // The fixture already owns ordinal 1 in each examination.
      const dup = await attempt(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
         VALUES (${a.examId}, 'sec.a2', 'Second section', 1)`,
      );
      expect(dup?.code, "two sections cannot claim ordinal 1 in one examination").toBe("23505");
      const next = await attempt(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
         VALUES (${b.examId}, 'sec.b2', 'Second section elsewhere', 2)`,
      );
      // Ordinals are scoped to the examination, so a second examination is not held
      // hostage by the first one's numbering.
      expect(next, "ordinal 2 in a different examination is fine").toBeNull();
      const freeInA = await attempt(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
         VALUES (${a.examId}, 'sec.a3', 'Third in A', 3)`,
      );
      expect(freeInA, "ordinal 3 is unused in examination A").toBeNull();
      const clash = await attempt(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
         VALUES (${a.examId}, 'sec.a4', 'Also third in A', 3)`,
      );
      expect(clash?.code, "but a second claim on ordinal 3 in A is refused").toBe("23505");
    });
  });

  it("keys a normal slot on region, concept, level and side — not on its section", async () => {
    await inTx(async (c) => {
      const { conceptId, examId } = await seedFixture(c, "slots");
      const other = await c.query(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
         VALUES ($1, 'sec.slots.two', 'Second section', 2) RETURNING id`,
        [examId],
      );
      const section2 = Number(other.rows[0]!.id);
      const concept2 = await c.query(
        `INSERT INTO finding_definitions (key, category_id, label)
         VALUES ('concept.slots.two', (SELECT category_id FROM finding_definitions WHERE id = $1), 'Second concept')
         RETURNING id`,
        [conceptId],
      ).then((r) => Number(r.rows[0]!.id));

      const ins = (key: string, opts: { section?: number; concept?: number; level?: string; laterality?: string; region?: string } = {}) =>
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, level, laterality, region)
         VALUES (${examId}, ${opts.section ?? "NULL"}, ${opts.concept ?? conceptId}, '${key}', 'findings',
                 'A fixture normal.', ${opts.level ? `'${opts.level}'` : "NULL"},
                 ${opts.laterality ? `'${opts.laterality}'` : "NULL"},
                 ${opts.region ? `'${opts.region}'` : "NULL"})`;

      expect(await attempt(ins("s1", { region: "parenchyma" })), "the first normal for a slot is accepted").toBeNull();
      // The claim the key exists to prevent — the same anatomical assertion twice — must
      // be caught even when the two rows are filed under DIFFERENT sections. Under the
      // previous key (section, level, laterality) both of these stored.
      expect((await attempt(ins("s2", { region: "parenchyma" })))?.code,
        "the same slot claimed twice in one section is refused").toBe("23505");
      expect((await attempt(ins("s3", { region: "parenchyma", section: section2 })))?.code,
        "and the same slot claimed under a different section is refused too").toBe("23505");

      // A different concept is a different assertion about the same anatomy.
      expect(await attempt(ins("s4", { region: "parenchyma", concept: concept2 })),
        "a second concept in the same region is a second slot").toBeNull();
      // The LS Spine case: each level is its own slot, so six levels coexist.
      expect(await attempt(ins("s5", { region: "parenchyma", concept: concept2, level: "L4-L5" })),
        "a different level is a different slot").toBeNull();
      expect(await attempt(ins("s6", { region: "parenchyma", concept: concept2, level: "L4-L5", laterality: "left" })),
        "a different side is a different slot").toBeNull();
      // …and padding must not smuggle in a duplicate. The laterality CHECK pins the
      // vocabulary to lowercase, so 'LEFT' is rejected before the index is consulted —
      // this probe isolates TRIM on the level, which has no CHECK of its own.
      expect((await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, concept_id, key, slot_field, rendered_text, level, laterality, region)
         VALUES (${examId}, ${concept2}, 's7', 'findings', 'A fixture normal.', ' L4-L5 ', 'left', 'parenchyma')`,
      ))?.code, "padding must not create a second claim on one slot").toBe("23505");
      expect((await attempt(ins("s8", { region: "parenchyma", concept: concept2, laterality: "LEFT" })))?.code,
        "'LEFT' is refused as a laterality, not normalised").toBe("23514");
    });
  });

  it("holds the normals one examination actually needs, in four modalities", async () => {
    // The brief's requirement, executed: several legitimate normals must coexist, because
    // a catalogue that cannot store them cannot suppress or restore them either. Each of
    // these is a real anatomy set, not a permutation of one row.
    await inTx(async (c) => {
      const f = await seedFixture(c, "many");
      const sectionId = f.sectionId;
      const concepts = await c.query<{ id: number }>(
        `WITH new(key, label) AS (VALUES
            ('c.many.disc','intervertebral disc'), ('c.many.facet','facet joint'),
            ('c.many.flavum','ligamentum flavum'), ('c.many.form','neural foramina'),
            ('c.many.canal','spinal canal'))
         INSERT INTO finding_definitions (key, category_id, label)
         SELECT key, (SELECT category_id FROM finding_definitions WHERE key = 'concept.many'), label FROM new
         RETURNING id`,
      );
      const regions = ["intervertebral disc", "facet joints", "ligamentum flavum", "neural foramina", "spinal canal"];
      for (let i = 0; i < concepts.rows.length; i += 1) {
        expect(await attempt(
          `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, level, region)
           VALUES (${f.examId}, ${sectionId}, ${concepts.rows[i]!.id}, 's.many.${i}', 'findings',
                   'A fixture normal.', 'L4-L5', '${regions[i]}')`,
        ), `lumbar normal ${regions[i]} at L4-L5 must be storable`).toBeNull();
      }
      const stored = await c.query(
        `SELECT count(*)::int AS n FROM clinical_normal_slots WHERE key LIKE 's.many.%'`,
      );
      expect(stored.rows[0]!.n, "five distinct lumbar normals share one section and one level").toBe(5);
    });
  });

  it("requires exactly one target on a relationship and on a combination member", async () => {
    await inTx(async (c) => {
      const f = await seedFixture(c, "rel");
      const t1 = await insertTile(c, "tile.rel.a", f.conceptId);
      const t2 = await insertTile(c, "tile.rel.b", f.conceptId);

      const none = await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, relation_kind) VALUES (${t1}, 'requires')`,
      );
      expect(none?.code, "a relationship must point at something").toBe("23514");
      const both = await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, related_concept_id, relation_kind)
         VALUES (${t1}, ${t2}, ${f.conceptId}, 'requires')`,
      );
      expect(both?.code, "a relationship must not point at two things").toBe("23514");
      const one = await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES (${t1}, ${t2}, 'parent_child')`,
      );
      expect(one).toBeNull();

      await c.query(
        `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members)
         VALUES ('combo.rel', ${f.examId}, 'Fixture combo', 'impression', 'One consolidated line.', FALSE, FALSE)`,
      );
      const ruleId = (await c.query(`SELECT id FROM clinical_combination_rules WHERE key = 'combo.rel'`)).rows[0]!.id;
      expect((await attempt(
        `INSERT INTO clinical_combination_rule_members (rule_id) VALUES (${ruleId})`,
      ))?.code, "a member set entry must name a tile or a concept").toBe("23514");
      expect((await attempt(
        `INSERT INTO clinical_combination_rule_members (rule_id, tile_id, concept_id) VALUES (${ruleId}, ${t1}, ${f.conceptId})`,
      ))?.code).toBe("23514");
      expect(await attempt(
        `INSERT INTO clinical_combination_rule_members (rule_id, tile_id) VALUES (${ruleId}, ${t1})`,
      )).toBeNull();
    });
  });

  it("makes an unanswered parameter required by default, not silently optional", async () => {
    await inTx(async (c) => {
      const { conceptId } = await seedFixture(c, "param");
      const tileId = await insertTile(c, "tile.param", conceptId);
      await c.query(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type)
         VALUES (${tileId}, 'side', 'Side', 'laterality')`,
      );
      const row = await c.query<{ is_required: boolean }>(
        `SELECT is_required FROM clinical_tile_parameters WHERE tile_id = $1 AND key = 'side'`,
        [tileId],
      );
      // The B-09 defect class: an unfilled {side} rendered as fluent prose. Required by
      // default means a new parameter cannot be born unguardable.
      expect(row.rows[0]!.is_required).toBe(true);

      const optOut = await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, is_required)
         VALUES (${tileId}, 'note', 'Optional note', 'text', FALSE)`,
      );
      expect(optOut).toBeNull();
    });
  });

  it("bounds a numeric parameter only when the author declares a range", async () => {
    await inTx(async (c) => {
      const { conceptId } = await seedFixture(c, "range");
      const tileId = await insertTile(c, "tile.range", conceptId);
      expect(await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, unit, min_value, max_value)
         VALUES (${tileId}, 'size', 'Long axis', 'numeric', 'mm', 1, 400)`,
      )).toBeNull();
      // min > max is a rule that can never be answered. This revision of the test used to
      // assert the opposite ("the database does NOT reject it") and called it a documented
      // gap; the review closed it with a named CHECK, so the inverted pair is now refused
      // while an ordinary range still stores.
      expect((await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, min_value, max_value)
         VALUES (${tileId}, 'bad', 'Inverted', 'numeric', 400, 1)`,
      ))?.code, "an inverted range must never be stored").toBe("23514");
      // One bound alone is a legal half-range, and no bounds at all is a free numeric.
      expect(await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, min_value)
         VALUES (${tileId}, 'half', 'Lower bound only', 'numeric', 1)`,
      )).toBeNull();
      expect(await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type)
         VALUES (${tileId}, 'free', 'No range', 'numeric')`,
      )).toBeNull();
    });
  });

  it("can express every recommendation policy §13 needs and refuses a made-up one", async () => {
    await inTx(async (c) => {
      const { examId, conceptId } = await seedFixture(c, "rec");
      const ins = (key: string, policy: string) =>
        `INSERT INTO clinical_recommendation_rules (key, examination_id, label, trigger_kind, concept_id, advice_text, emit_policy)
         VALUES ('${key}', ${examId}, 'Fixture advice', 'concept_present', ${conceptId}, 'Correlate clinically.', '${policy}')`;
      for (const policy of ["always", "when_no_other", "when_only"]) {
        expect(await attempt(ins(`rec.${policy}`, policy)), policy).toBeNull();
      }
      // 'never' is not a policy: a rule that never emits is dead content, and §13's
      // omission case is expressed by when_only / an empty section, not by suppression.
      expect((await attempt(ins("rec.never", "never")))?.code).toBe("23514");
      const prio = await attempt(
        `INSERT INTO clinical_recommendation_rules (key, examination_id, label, trigger_kind, concept_id, advice_text, priority)
         VALUES ('rec.p', ${examId}, 'Urgent advice', 'concept_present', ${conceptId}, 'Urgent contact.', 'immediately')`,
      );
      expect(prio?.code, "priority vocabulary is routine|urgent|critical").toBe("23514");
      expect(prio?.message, "and it is the priority CHECK that fires, not the trigger target")
        .toMatch(/_priority_check/);
    });
  });

  it("keeps publication history append-only and never overwritable", async () => {
    const HASH = "a".repeat(64);
    await inTx(async (c) => {
      const { examId } = await seedFixture(c, "pub");
      await approveCatalogue(c, examId);
      const snap = await snapshotLiteral(c, examId);
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, catalogue_snapshot)
         VALUES (${examId}, 'pub.1', '${snap}')`,
      ))?.code, "content_hash is NOT NULL: a publication must be addressable by its hash").toBe("23502");
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash)
         VALUES (${examId}, 'pub.nosnap', '${HASH}')`,
      ))?.message, "and so is the snapshot: a publication that carries no document restores nothing")
        .toMatch(/catalogue_snapshot/);
      // The column's own CHECK catches the document that was never filled in, which is the
      // shape a publisher bug produces; check 14 of the gate catches the document that was
      // filled in wrongly, which is a shape no publisher intends.
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, catalogue_snapshot)
         VALUES (${examId}, 'pub.blank', '${HASH}', '{}'::jsonb)`,
      ))?.code, "an empty snapshot is not a publication").toBe("23514");
      // The shape is the point. A column that can hold prose cannot be compared, so
      // "did the catalogue change?" would have no answer — and this is the token a signed
      // report cites. Measured: the previous revision stored the value below.
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, catalogue_snapshot)
         VALUES (${examId}, 'pub.prose', 'see the attached note', '${snap}')`,
      ))?.code, "a hash column that accepts prose verifies nothing").toBe("23514");
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, catalogue_snapshot)
         VALUES (${examId}, 'pub.prefixed', 'sha256:aaaa', '${snap}')`,
      ))?.code, "a prefixed digest is not the 64 lowercase hex digits the CHECK declares").toBe("23514");
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot)
         VALUES (${examId}, 'pub.version', '${HASH}', 0, '${snap}')`,
      ))?.code, "snapshot_version 0 is not a serialization convention").toBe("23514");
      await c.query(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, catalogue_snapshot)
         VALUES (${examId}, 'pub.1', '${HASH}', '${snap}')`,
      );
      // Not a partial index: two publications of the same key are history, and the second
      // must not silently replace the first — that is how a cache token stops being a fact.
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, catalogue_snapshot)
         VALUES (${examId}, 'pub.1', '${"b".repeat(64)}', '${snap}')`,
      ))?.code).toBe("23505");
      // Immutable, not merely unique: a signed report cites this row to say what it was
      // composed from, so an UPDATE that leaves the row in place still destroys the fact.
      expect((await attempt(
        `UPDATE clinical_publications SET content_hash = '${"b".repeat(64)}' WHERE publication_key = 'pub.1'`,
      ))?.code, "a published record must not be rewritable").toBe("P0001");
      expect((await attempt(
        `DELETE FROM clinical_publications WHERE publication_key = 'pub.1'`,
      ))?.code, "a published record must not be deletable").toBe("P0001");
      const cols = await c.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'clinical_tile_versions' AND column_name = 'deleted_at'`,
      );
      expect(cols.rows, "a version history must not be soft-deletable").toEqual([]);
    });
  });

  it("cannot rewrite the version history a signed report cites", async () => {
    await inTx(async (c) => {
      const { conceptId } = await seedFixture(c, "hist");
      const tileId = await insertTile(c, "tile.hist", conceptId);
      await c.query(
        `INSERT INTO clinical_tile_versions (tile_id, version, snapshot_json)
         VALUES (${tileId}, 1, '{"label":"as published"}')`,
      );
      // Measured on the previous revision: this UPDATE succeeded and the stored snapshot
      // changed under the report that cited version 1, with no trace that it had.
      const rewrite = await attempt(
        `UPDATE clinical_tile_versions SET snapshot_json = '{"label":"silently rewritten"}'
          WHERE tile_id = ${tileId} AND version = 1`,
      );
      expect(rewrite?.code, "version 1 of a tile is a fact, not a cell").toBe("P0001");
      expect((await attempt(
        `DELETE FROM clinical_tile_versions WHERE tile_id = ${tileId} AND version = 1`,
      ))?.code, "the history cannot be erased either").toBe("P0001");
      const stored = await c.query<{ snapshot_json: unknown }>(
        `SELECT snapshot_json FROM clinical_tile_versions WHERE tile_id = $1 AND version = 1`,
        [tileId],
      );
      expect(stored.rows[0]!.snapshot_json).toEqual({ label: "as published" });
      // Appending the next version is the only way content moves.
      expect(await attempt(
        `INSERT INTO clinical_tile_versions (tile_id, version, snapshot_json)
         VALUES (${tileId}, 2, '{"label":"revised"}')`,
      ), "a new version is always allowed").toBeNull();
      expect((await attempt(
        `INSERT INTO clinical_tile_versions (tile_id, version, snapshot_json)
         VALUES (${tileId}, 2, '{"label":"duplicate"}')`,
      ))?.code, "one row per tile per version").toBe("23505");
      expect((await attempt(
        `INSERT INTO clinical_tile_versions (tile_id, version, snapshot_json)
         VALUES (${tileId}, 0, '{"label":"zero"}')`,
      ))?.code, "version 0 is not a version").toBe("23514");
    });
  });

  it("names the exact wording a publication released, and cannot name one that does not exist", async () => {
    // Without the manifest a publication is a hash: rollback has nothing to restore and a
    // signed report cannot say which catalogue built it.
    await inTx(async (c) => {
      const { conceptId, examId, sectionId } = await seedFixture(c, "mani");
      const tileId = await insertTile(c, "tile.mani", conceptId);
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
         VALUES (${tileId}, ${examId}, ${sectionId}, 1)`,
      );
      await c.query(
        `INSERT INTO clinical_tile_versions (tile_id, version, snapshot_json)
         VALUES (${tileId}, 1, '{"findings_text":"A fixture sentence."}')`,
      );
      await approveCatalogue(c, examId);
      expect(await publish(c, examId, "pub.mani"), "the manifest test's publication is accepted").toBeNull();
      const pubId = (await c.query(
        `SELECT id FROM clinical_publications WHERE publication_key = 'pub.mani'`,
      )).rows[0]!.id as number;

      expect(await attempt(
        `INSERT INTO clinical_publication_tiles (publication_id, tile_id, tile_version, ordinal)
         VALUES (${pubId}, ${tileId}, 1, 1)`,
      ), "a published tile version is storable").toBeNull();
      expect((await attempt(
        `INSERT INTO clinical_publication_tiles (publication_id, tile_id, tile_version, ordinal)
         VALUES (${pubId}, ${tileId}, 1, 2)`,
      ))?.code, "one manifest row per tile per publication").toBe("23505");
      // The citation is a foreign key, so it cannot point at a wording nobody snapshotted.
      // A second publication is needed to reach it, because (publication, tile) is itself
      // unique — the dangerous shape is an off-by-one version on a tile that IS cited.
      expect(await publish(c, examId, "pub.mani.v7"), "a second publication is history, not a replacement").toBeNull();
      const pubV7 = (await c.query(
        `SELECT id FROM clinical_publications WHERE publication_key = 'pub.mani.v7'`,
      )).rows[0]!.id as number;
      expect((await attempt(
        `INSERT INTO clinical_publication_tiles (publication_id, tile_id, tile_version, ordinal)
         VALUES (${pubV7}, ${tileId}, 7, 1)`,
      ))?.code, "version 7 of this tile was never published").toBe("23503");

      const tile2 = await insertTile(c, "tile.mani2", conceptId);
      expect((await attempt(
        `INSERT INTO clinical_publication_tiles (publication_id, tile_id, tile_version, ordinal)
         VALUES (${pubId}, ${tile2}, 1, 4)`,
      ))?.code, "a tile with no stored version at all cannot be cited").toBe("23503");

      // And the manifest is history: rewriting it re-points a citation that a report has
      // already made.
      expect((await attempt(
        `UPDATE clinical_publication_tiles SET tile_version = 1 WHERE publication_id = ${pubId} AND tile_id = ${tileId}`,
      )), "an identical update is a no-op the trigger still refuses").not.toBeNull();
      expect((await attempt(
        `DELETE FROM clinical_publication_tiles WHERE publication_id = ${pubId}`,
      ))?.code, "the manifest cannot be emptied").toBe("P0001");
      // Deleting the publication while a manifest names it is refused twice over: the
      // append-only trigger fires first, so RESTRICT never gets the chance.
      expect(["P0001", "23001", "23503"], "a cited publication cannot be destroyed").toContain(
        (await attempt(`DELETE FROM clinical_publications WHERE id = ${pubId}`))?.code,
      );
    });
  });

  // ── Review §2: a section reference must mean "a section of THIS examination" ──────────
  it("refuses every cross-examination reference the first revision accepted", async () => {
    await inTx(async (c) => {
      const brain = await seedFixture(c, "xexam-brain");
      const spine = await seedFixture(c, "xexam-spine");
      const tile = await insertTile(c, "tile.xexam", brain.conceptId);

      // 1. The positive control first: if a legitimate pairing stopped working, the guard
      //    would simply have made the catalogue unusable.
      expect(await attempt(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
         VALUES (${tile}, ${brain.examId}, ${brain.sectionId}, 1)`,
      ), "a tile placed in its own examination's section must still work").toBeNull();

      // 2. The brief's own example — an MRI Brain tile assigned to an MRI Cervical Spine
      //    section. A foreign key on section_id alone accepted it, because the section
      //    existed; it just belonged to a different examination.
      expect((await attempt(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
         VALUES (${tile}, ${spine.examId}, ${brain.sectionId}, 2)`,
      ))?.code, "a placement may not bridge two examinations").toBe("23503");

      // 3. The same violation introduced later, by an editor moving a tile that is
      //    already placed. An INSERT-time-only check would let this through.
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, ordinal)
         VALUES (${tile}, ${spine.examId}, 5)`,
      );
      expect((await attempt(
        `UPDATE clinical_tile_examinations SET section_id = ${brain.sectionId}
          WHERE tile_id = ${tile} AND examination_id = ${spine.examId}`,
      ))?.code, "re-parenting cannot smuggle a cross-examination reference in").toBe("23503");

      // 4. A normal slot of one examination filed under another examination's anatomy.
      expect((await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region)
         VALUES (${spine.examId}, ${brain.sectionId}, ${brain.conceptId}, 's.xexam', 'findings',
                 'A fixture normal.', 'parenchyma')`,
      ))?.code, "a normal must live under its own examination's sections").toBe("23503");
      expect(await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region)
         VALUES (${brain.examId}, ${brain.sectionId}, ${brain.conceptId}, 's.xexam.ok', 'findings',
                 'A fixture normal.', 'parenchyma')`,
      ), "and the same statement with a matching examination is accepted").toBeNull();

      // 5. A section nested inside another examination's section, and one nested inside
      //    itself. The first is the §16 order becoming meaningless; the second is an
      //    order that never terminates.
      expect((await attempt(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, parent_section_id, ordinal)
         VALUES (${spine.examId}, 'sec.xexam.child', 'Foreign child', ${brain.sectionId}, 9)`,
      ))?.code, "anatomy may not nest across examinations").toBe("23503");
      const selfParent = await c.query(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
         VALUES (${spine.examId}, 'sec.xexam.self', 'Self parent', 9) RETURNING id`,
      );
      const selfId = Number(selfParent.rows[0]!.id);
      expect((await attempt(
        `UPDATE clinical_anatomical_sections SET parent_section_id = ${selfId} WHERE id = ${selfId}`,
      ))?.code, "a section may not be its own parent").toBe("23514");

      // 6. A combination rule that would print into another examination's section.
      expect((await attempt(
        `INSERT INTO clinical_combination_rules (key, examination_id, section_id, label, target_field, combined_text, suppress_members, requires_only_members)
         VALUES ('combo.xexam', ${spine.examId}, ${brain.sectionId}, 'Foreign rule', 'impression',
                 'A consolidated line.', FALSE, FALSE)`,
      ))?.code, "a rule may not reference unrelated anatomy").toBe("23503");
      expect(await attempt(
        `INSERT INTO clinical_combination_rules (key, examination_id, section_id, label, target_field, combined_text, suppress_members, requires_only_members)
         VALUES ('combo.xexam.ok', ${spine.examId}, ${spine.sectionId}, 'Own rule', 'impression',
                 'A consolidated line.', FALSE, FALSE)`,
      ), "the same rule against its own section is accepted").toBeNull();

      // 7. A parameter default taken from a different parameter's option list. MATCH
      //    SIMPLE would skip a composite key with a NULL half, so the companion CHECK is
      //    what closes that door.
      const groups = await c.query<{ id: number }>(
        `INSERT INTO parameter_groups (key, label) VALUES ('pg.xexam.a','Severity'), ('pg.xexam.b','Size') RETURNING id`,
      );
      const [groupA, groupB] = groups.rows.map((r) => Number(r.id));
      const optionA = await c.query(
        `INSERT INTO parameter_options (group_id, key, label) VALUES (${groupA}, 'po.a', 'Mild') RETURNING id`,
      );
      const optId = Number(optionA.rows[0]!.id);
      expect((await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, parameter_group_id, default_option_id)
         VALUES (${tile}, 'param.xexam', 'Severity', ${groupB}, ${optId})`,
      ))?.code, "a Size parameter may not default to a Severity option").toBe("23503");
      expect(await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, parameter_group_id, default_option_id)
         VALUES (${tile}, 'param.xexam.ok', 'Severity', ${groupA}, ${optId})`,
      ), "the matching group and option is accepted").toBeNull();
      expect((await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, default_option_id)
         VALUES (${tile}, 'param.xexam.orphan', 'No group', ${optId})`,
      ))?.code, "an option with no group is a half-filled composite key").toBe("23514");

      // 8. Existing valid records remain compatible: nothing above disturbed the eighteen
      //    seeded scopes, and every accepted statement is still readable.
      const seeded = await c.query(
        `SELECT count(*)::int AS n FROM clinical_examinations
          WHERE key LIKE 'mr.%' OR key LIKE 'ct.%' OR key LIKE 'us.%' OR key LIKE 'mg.%' OR key LIKE 'xr.%'`,
      );
      expect(seeded.rows[0]!.n, "the guard changed no seeded row").toBe(18);
      const readable = await c.query(
        `SELECT count(*)::int AS n FROM clinical_tile_examinations WHERE tile_id = $1`,
        [tile],
      );
      expect(readable.rows[0]!.n, "the two legitimate placements are both there").toBe(2);
    });
  });

  // ── Review §4: ordering that an administrator can actually use ─────────────────────────
  it("lets a tile be added without a position, and reordered without a collision", async () => {
    await inTx(async (c) => {
      const f = await seedFixture(c, "order");
      // Six tiles: five belong to this fixture's examination, the sixth is the one placed in
      // a second examination below, because a shared tile would make the position-collision
      // probes ambiguous about which placement row refused.
      const tiles = await c.query<{ id: number }>(
        `WITH new(key) AS (VALUES ('o.1'),('o.2'),('o.3'),('o.4'),('o.5'),('o.6'))
         INSERT INTO clinical_tiles (key, concept_id, label, findings_text)
         SELECT key, $1, 'Ordered tile', 'A fixture sentence.' FROM new RETURNING id`,
        [f.conceptId],
      );
      const ids = tiles.rows.map((r) => Number(r.id));

      // Requirement 1: adding must not fail. The previous revision gave every placement the
      // same implicit position (DEFAULT 0) and a unique index, so the SECOND tile added to
      // an examination could not be stored at all.
      for (const id of ids.slice(0, 5)) {
        expect(await attempt(
          `INSERT INTO clinical_tile_examinations (tile_id, examination_id) VALUES (${id}, ${f.examId})`,
        ), `tile ${id} added with no position stated`).toBeNull();
      }
      const unplaced = await c.query(
        `SELECT count(*)::int AS n FROM clinical_tile_examinations
          WHERE examination_id = $1 AND ordinal IS NULL`,
        [f.examId],
      );
      expect(unplaced.rows[0]!.n, "five tiles are waiting to be placed").toBe(5);

      // A position belongs to an examination (and within it, to a section): two examinations
      // both starting at position 1 is normal, not a collision. An index that forgot the
      // examination half would make the second clinic scope unauthorable — so position 1 is
      // claimed here first, and the other examination then attempts the same number. Both
      // statements must be measured: the first is legal, the second is a real collision.
      await c.query(`UPDATE clinical_tile_examinations SET ordinal = 1 WHERE tile_id = ${ids[0]}`);
      const second = await seedFixture(c, "order-b");
      expect(await attempt(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
         VALUES (${ids[5]}, ${second.examId}, ${second.sectionId}, 1)`,
      ), "position 1 in a DIFFERENT examination is independent").toBeNull();
      await c.query(`DELETE FROM clinical_tile_examinations WHERE tile_id = ${ids[5]}`);

      // 0 is not a position, and inside ONE examination a position is claimed once. This row
      // already exists with no ordinal, so nothing but the position index can refuse it —
      // naming it in the message is what separates this from a key-collision accident.
      expect((await attempt(
        `UPDATE clinical_tile_examinations SET ordinal = 0 WHERE tile_id = ${ids[1]}`,
      ))?.code, "ordinal 0 is refused").toBe("23514");
      const sameExam = await attempt(
        `UPDATE clinical_tile_examinations SET ordinal = 1 WHERE tile_id = ${ids[1]}`,
      );
      expect(sameExam?.code, "two tiles may not claim position 1").toBe("23505");
      expect(sameExam?.message, "and it is the POSITION index which refused").toMatch(
        /clin_tile_exam_ordinal_uq/,
      );
      await c.query(`UPDATE clinical_tile_examinations SET ordinal = 2 WHERE tile_id = ${ids[1]}`);

      // Requirement 3 + 4: an adjacent swap, atomically, by unplacing then placing. The
      // naive two-UPDATE version is refused, which is the point: the collision is visible
      // instead of silently overwriting a neighbour.
      expect((await attempt(
        `UPDATE clinical_tile_examinations SET ordinal = 2 WHERE tile_id = ${ids[0]};
         UPDATE clinical_tile_examinations SET ordinal = 1 WHERE tile_id = ${ids[1]}`,
      ))?.code, "a swap that never releases a position is refused").toBe("23505");
      expect(await attempt(
        `UPDATE clinical_tile_examinations SET ordinal = NULL WHERE tile_id IN (${ids[0]}, ${ids[1]});
         UPDATE clinical_tile_examinations SET ordinal = 2 WHERE tile_id = ${ids[0]};
         UPDATE clinical_tile_examinations SET ordinal = 1 WHERE tile_id = ${ids[1]}`,
      ), "the documented protocol swaps two neighbours").toBeNull();

      // Requirement 5: moving a tile into another section of its own examination.
      await c.query(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal)
         VALUES (${f.examId}, 'sec.order.two', 'Second section', 2)`,
      );
      expect(await attempt(
        `UPDATE clinical_tile_examinations SET section_id = (
            SELECT id FROM clinical_anatomical_sections WHERE key = 'sec.order.two'
         ), ordinal = 3 WHERE tile_id = ${ids[2]}`,
      ), "moving between sections of the same examination is a normal edit").toBeNull();

      // Requirement 2 + 7: the stored order is the anatomy's, never the click order. Five
      // tiles placed bottom-up must read back top-down, with ties impossible because a
      // position cannot be claimed twice.
      await c.query(
        `UPDATE clinical_tile_examinations SET ordinal = 4 WHERE tile_id = ${ids[3]};
         UPDATE clinical_tile_examinations SET ordinal = 5 WHERE tile_id = ${ids[4]}`,
      );
      const readBack = await c.query<{ tile_key: string }>(
        `SELECT k.key AS tile_key FROM clinical_tile_examinations p
           JOIN clinical_tiles k ON k.id = p.tile_id
          WHERE p.examination_id = $1
          ORDER BY p.ordinal`,
        [f.examId],
      );
      expect(readBack.rows.map((r) => r.tile_key), "retrieval follows the stored ordinals")
        .toEqual(["o.2", "o.1", "o.3", "o.4", "o.5"]);
    });
  });

  it("serialises two administrators reordering the same examination", async () => {
    // Requirement 5 of §4: concurrent edits must not silently overwrite each other. The
    // protocol is a row lock on the examination, taken before the positions are rewritten.
    // The subject is one of the eighteen seeded scopes, because a lock test needs two
    // transactions that can both SEE the row — a fixture inside a rolled-back transaction
    // would be invisible to the second connection, and the lock would appear to work.
    const row = await client.query<{ id: string }>(
      `SELECT id FROM clinical_examinations WHERE key = 'mr.brain'`,
    );
    expect(row.rows.length, "the seeded MRI Brain scope exists to lock").toBe(1);
    const examId = Number(row.rows[0]!.id);
    const other = new Client({ connectionString: dbUrl });
    await other.connect();
    let secondWriterIn = false;
    let blocked: Promise<unknown> | null = null;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT id FROM clinical_examinations WHERE id = ${examId} FOR UPDATE`);
      blocked = other.query("BEGIN").then(() => other.query(
        `SELECT id FROM clinical_examinations WHERE id = ${examId} FOR UPDATE`,
      )).then(() => { secondWriterIn = true; });
      // The second writer must wait, not proceed. 1.5 s is generous on a CI runner and
      // still fails loudly if the lock is missing, because an unlocked read returns
      // immediately.
      await new Promise((r) => setTimeout(r, 1500));
      expect(secondWriterIn, "the second reorder must wait for the first, not interleave").toBe(false);
      await client.query("ROLLBACK");
      await blocked;
      expect(secondWriterIn, "and it proceeds as soon as the first releases the row").toBe(true);
      await other.query("ROLLBACK");
    } finally {
      // A test that leaves the shared connection inside an open transaction poisons every
      // test that runs after it in the file, so both transactions are closed here.
      await client.query("ROLLBACK").catch(() => undefined);
      // The pending lock-wait belongs to a test that has already concluded; letting it
      // reject after the assertion would surface as an unhandled error and be blamed on
      // the next test in the file.
      blocked?.catch(() => undefined);
      await other.end().catch(() => undefined);
    }
  });

  // ── Review §5: publication is where a draft's incompleteness stops being legal ────────
  it("refuses to publish a catalogue that cannot print in a defined order", async () => {
    const HASH = "d".repeat(64);
    await inTx(async (c) => {
      const f = await seedFixture(c, "gate");
      const tiles = await c.query<{ id: number }>(
        `WITH new(key) AS (VALUES ('g.1'),('g.2'),('g.3'),('g.4'))
         INSERT INTO clinical_tiles (key, concept_id, label, findings_text)
         SELECT key, $1, 'Gate tile', 'A fixture sentence.' FROM new RETURNING id`,
        [f.conceptId],
      );
      const [one, two, three, four] = tiles.rows.map((r) => Number(r.id));

      // Rule 1: an unplaced tile is not an order. A draft may be unordered; a publication
      // may not, because composing would fall back to whatever the database read first.
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
         VALUES (${one}, ${f.examId}, ${f.sectionId}, 1), (${two}, ${f.examId}, ${f.sectionId}, 2)`,
      );
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id)
         VALUES (${four}, ${f.examId}, ${f.sectionId})`,
      );
      const unplaced = await publish(c, f.examId, "pub.gate.unplaced");
      expect(unplaced?.code, "publishing with an unplaced tile is refused").toBe("P0001");
      expect(unplaced?.message, "and says which tile").toMatch(/with no ordinal/);
      // Placing it is the whole remedy, and the refusal left no publication behind.
      expect((await attempt(
        `UPDATE clinical_tile_examinations SET ordinal = 3 WHERE tile_id = ${four}`,
      )), "placing it is the whole remedy").toBeNull();
      const left = await c.query(
        `SELECT count(*)::int AS n FROM clinical_publications WHERE publication_key = 'pub.gate.unplaced'`,
      );
      expect(left.rows[0]!.n, "a refused publication leaves no row behind").toBe(0);

      // Rule 3: a combination rule with no required member would print an impression
      // against a selection nobody made (§27). The ordinal is here because this fixture is
      // published twice more below and expects SUCCESS: a rule with no stated precedence is
      // refused by check 16, and the two concerns must not be confused in one test.
      const otherExam = await seedFixture(c, "gate-empty");
      await c.query(
        `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members, ordinal)
         VALUES ('combo.empty', ${otherExam.examId}, 'Only optional members', 'impression',
                 'An invented impression.', FALSE, FALSE, 1)`,
      );
      await c.query(
        `INSERT INTO clinical_combination_rule_members (rule_id, concept_id, is_optional)
         VALUES ((SELECT id FROM clinical_combination_rules WHERE key = 'combo.empty'), ${f.conceptId}, TRUE)`,
      );
      const emptyRule = await publish(c, otherExam.examId, "pub.gate.empty");
      expect(emptyRule?.code, "a rule that requires nothing is refused at publication").toBe("P0001");
      expect(emptyRule?.message).toMatch(/no required member/);
      // …but the draft itself stays legal, because an author adding members one at a time
      // is in the middle of building the rule.
      const ruleRow = await c.query<{ id: number }>(
        `SELECT id FROM clinical_combination_rules WHERE key = 'combo.empty'`,
      );
      expect((await attempt(
        `INSERT INTO clinical_combination_rule_members (rule_id, concept_id, is_optional)
         VALUES (${ruleRow.rows[0]!.id}, ${f.conceptId}, FALSE)`,
      ))?.code, "one member may not be both optional and required").toBe("23505");
      expect(await attempt(
        `UPDATE clinical_combination_rule_members SET is_optional = FALSE
          WHERE rule_id = ${ruleRow.rows[0]!.id}`,
      ), "the author making it required is a plain update").toBeNull();
      await approveCatalogue(c, otherExam.examId);
      expect(await publish(c, otherExam.examId, "pub.gate.fixed"), "and then it publishes").toBeNull();

      // Rule 4: a tile may only retire a normal of an examination it is placed in.
      await c.query(
        `INSERT INTO clinical_normal_slots (examination_id, concept_id, key, slot_field, rendered_text, region)
         VALUES (${f.examId}, ${f.conceptId}, 's.gate.normal', 'findings', 'A fixture normal.', 'gate region')`,
      );
      expect((await attempt(
        `INSERT INTO clinical_tile_normal_replacements (tile_id, normal_slot_id)
         VALUES (${three}, (SELECT id FROM clinical_normal_slots WHERE key = 's.gate.normal'))`,
      )), "the edge itself is storable: tile 3 is a real tile").toBeNull();
      const foreignNormal = await publish(c, f.examId, "pub.gate.foreign");
      expect(foreignNormal?.code, "a tile that owns a baseline it cannot offer is refused").toBe("P0001");
      expect(foreignNormal?.message).toMatch(/retires a normal of an examination it is not placed in/);

      // Rule 5: a rule may not name a tile the examination cannot offer. The replacement edge
      // is re-pointed at a placed tile first, so the refusal below is check 5's and not a second
      // sighting of check 4 — which the previous revision of this test also relied on and which
      // is invisible in the message unless the probe is ordered this way. The three statements
      // are one probe, and the rollback that attempt() performs is what keeps the rule out of
      // the fixture for the publishable case below.
      await c.query(
        `UPDATE clinical_tile_normal_replacements SET tile_id = ${one}
          WHERE normal_slot_id = (SELECT id FROM clinical_normal_slots WHERE key = 's.gate.normal')`,
      );
      expect((await attempt(
        `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members)
         VALUES ('combo.unplaced', ${f.examId}, 'Names an unplaced tile', 'impression',
                 'A consolidated line.', TRUE, FALSE);
         INSERT INTO clinical_combination_rule_members (rule_id, tile_id, is_optional)
         VALUES ((SELECT id FROM clinical_combination_rules WHERE key = 'combo.unplaced'), ${three}, FALSE)`,
      )), "the rule and its member are storable in draft").toBeNull();
      const unplacedMember = await publish(c, f.examId, "pub.gate.member");
      expect(unplacedMember?.code, "a rule over a tile nobody can select is refused").toBe("P0001");
      expect(unplacedMember?.message).toMatch(/names a tile that is not placed/);

      // The publishable case: everything placed, every rule grounded in a selectable tile,
      // and every printed sentence reviewed. The probe rule is removed by name rather than
      // left to a savepoint rollback, because a fixture that becomes clean only as a side
      // effect of an earlier failure is a fixture nobody can read.
      await c.query(
        `DELETE FROM clinical_combination_rule_members
          WHERE rule_id = (SELECT id FROM clinical_combination_rules WHERE key = 'combo.unplaced')`,
      );
      await c.query(`DELETE FROM clinical_combination_rules WHERE key = 'combo.unplaced'`);
      await c.query(
        `DELETE FROM clinical_tile_normal_replacements
          WHERE normal_slot_id = (SELECT id FROM clinical_normal_slots WHERE key = 's.gate.normal')`,
      );
      await approveCatalogue(c, f.examId);
      expect(await publish(c, f.examId, "pub.gate.ok"), "a complete catalogue publishes").toBeNull();

      // A publication that names no examination is refused, and the reason is the gate itself:
      // every check above is a statement about one examination's rows, so the previous revision
      // let `INSERT INTO clinical_publications (publication_key, content_hash)` through with an
      // early return — a citable "published" record for content no check ever looked at. The
      // committed test that pinned that behaviour as intended asserted it was "allowed"; it is
      // now the regression this line replaces.
      const global = await attempt(
        `INSERT INTO clinical_publications (publication_key, content_hash) VALUES ('pub.gate.global', '${"d".repeat(64)}')`,
      );
      expect(global?.code, "a publication must name the examination whose configuration it freezes").toBe("23502");
      expect(global?.message).toMatch(/examination_id/);
    });
  });

  it("refuses the clinical nonsense an administrator can type into a draft", async () => {
    await inTx(async (c) => {
      const f = await seedFixture(c, "nonsense");
      const tile = await insertTile(c, "tile.nonsense", f.conceptId);

      // A tile that excludes itself can never be selected, and a rule that points at
      // nothing matches nothing.
      expect((await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES (${tile}, ${tile}, 'excludes')`,
      ))?.code, "no self-relationship").toBe("23514");
      // A tile that renders nothing when clicked is the silent-failure class, not a style
      // problem: all four text columns empty means the strip shows a button with no text.
      expect((await attempt(
        `INSERT INTO clinical_tiles (key, concept_id, label) VALUES ('tile.blank', ${f.conceptId}, 'Blank tile')`,
      ))?.code, "a tile must carry some clinical text").toBe("23514");
      expect((await attempt(
        `INSERT INTO clinical_tiles (key, concept_id, label, findings_text) VALUES ('', ${f.conceptId}, 'Blank key', 'x')`,
      ))?.code, "the key is the handle a publication cites").toBe("23514");
      // A range nobody can satisfy.
      const group = await c.query(`INSERT INTO parameter_groups (key, label) VALUES ('pg.nonsense','Range') RETURNING id`);
      expect((await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, parameter_group_id, data_type, min_value, max_value)
         VALUES (${tile}, 'p.size', 'Long axis', ${Number(group.rows[0]!.id)}, 'numeric', 40, 5)`,
      ))?.code, "min_value above max_value can never be answered").toBe("23514");
      // A recommendation conditioned on a parameter it never names.
      expect((await attempt(
        `INSERT INTO clinical_recommendation_rules (key, examination_id, label, trigger_kind, tile_id, parameter_value, advice_text)
         VALUES ('rec.orphan', ${f.examId}, 'Orphan condition', 'parameter_value', ${tile}, 'mild',
                 'An unrelated piece of advice.')`,
      ))?.code, "a parameter condition needs the parameter it conditions on").toBe("23514");
      // A rule that fires on every report of the examination because it names nothing.
      expect((await attempt(
        `INSERT INTO clinical_recommendation_rules (key, examination_id, label, trigger_kind, advice_text)
         VALUES ('rec.nobody', ${f.examId}, 'No target', 'tile_selected', 'Advice for everyone.')`,
      ))?.code, "tile_selected must name a tile").toBe("23514");
      // The two combination flags are clinical decisions, so neither can be defaulted, and
      // each is asserted BY NAME: a probe that only checks the SQLSTATE passes when the
      // other column fires, which is exactly how a "both flags omitted" case hid the fact
      // that restoring a DEFAULT to either one left the suite green.
      const bothOmitted = await attempt(
        `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text)
         VALUES ('combo.nodefault', ${f.examId}, 'Flags omitted', 'impression', 'A line.')`,
      );
      expect(bothOmitted?.code, "both flags may not be omitted").toBe("23502");
      const suppressOnly = await attempt(
        `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text, suppress_members)
         VALUES ('combo.nodefault.a', ${f.examId}, 'Requires omitted', 'impression', 'A line.', TRUE)`,
      );
      expect(suppressOnly?.code, "requires_only_members may not be defaulted").toBe("23502");
      expect(suppressOnly?.message, "and it is THAT column which refused").toMatch(/requires_only_members/);
      const requiresOnly = await attempt(
        `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text, requires_only_members)
         VALUES ('combo.nodefault.b', ${f.examId}, 'Suppress omitted', 'impression', 'A line.', TRUE)`,
      );
      expect(requiresOnly?.code, "suppress_members may not be defaulted").toBe("23502");
      expect(requiresOnly?.message, "and it is THAT column which refused").toMatch(/suppress_members/);
      // A normal sentence that says nothing cannot be suppressed or restored.
      expect((await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, concept_id, key, slot_field, rendered_text, region)
         VALUES (${f.examId}, ${f.conceptId}, 's.blank', 'findings', '', 'blank region')`,
      ))?.code, "rendered_text must not be empty").toBe("23514");
    });
  });

  // ── Review §5H: the owner's Fazekas case, expressed as catalogue data ──────────────────
  it("can express two anatomical findings and one consolidated impression", async () => {
    await inTx(async (c) => {
      const f = await seedFixture(c, "fazekas");
      const concepts = await c.query<{ id: number }>(
        `WITH new(key, label) AS (VALUES ('c.faz','white matter hyperintensity'), ('catro','cerebral atrophy'))
         INSERT INTO finding_definitions (key, category_id, label)
         SELECT key, (SELECT category_id FROM finding_definitions WHERE key = 'concept.fazekas'), label FROM new
         RETURNING id`,
      );
      const [faz, atrophy] = concepts.rows.map((r) => Number(r.id));
      const tiles = await c.query<{ id: number }>(
        `INSERT INTO clinical_tiles (key, concept_id, label, findings_text, impression_text, conflict_group)
         VALUES ('fazekas.grade1', $1, 'Fazekas grade 1',
                 'Fazekas grade 1 white matter hyperintensities.', 'Mild chronic small-vessel change.', 'fazekas'),
                ('senile.changes',  $2, 'Senile changes',
                 'Mild age-related cerebral atrophy.', 'Mild age-related cerebral atrophy.', '')
         RETURNING id`,
        [faz, atrophy],
      );
      const [tFaz, tAtrophy] = tiles.rows.map((r) => Number(r.id));
      for (const [id, ordinal] of [[tFaz, 1], [tAtrophy, 2]] as const) {
        expect(await attempt(
          `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
           VALUES (${id}, ${f.examId}, ${f.sectionId}, ${ordinal})`,
        ), `tile ${id} placed`).toBeNull();
      }

      // The consolidated sentence the owner asked for: two separate anatomical
      // observations, ONE impression, no duplicate, no extra recommendation, and no model
      // call anywhere in it — so the rule and its members must be plain rows.
      // ordinal 1 is stated because a rule that is published must say where it sits (§3).
      expect(await attempt(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, section_id, label, target_field, combined_text, suppress_members, requires_only_members, ordinal, status)
         VALUES ('combo.fazekas.senile', ${f.examId}, ${f.sectionId},
                 'Fazekas plus senile changes', 'impression',
                 'Mild chronic small-vessel ischemic changes (Fazekas grade 1) with mild age-related cerebral atrophy.',
                 TRUE, FALSE, 1, 'active')`,
      ), "the rule is storable").toBeNull();
      const ruleId = (await c.query(
        `SELECT id FROM clinical_combination_rules WHERE key = 'combo.fazekas.senile'`,
      )).rows[0]!.id as number;
      for (const [ordinal, tileId] of [[1, tFaz], [2, tAtrophy]] as const) {
        expect(await attempt(
          `INSERT INTO clinical_combination_rule_members (rule_id, tile_id, ordinal, is_optional)
           VALUES (${ruleId}, ${tileId}, ${ordinal}, FALSE)`,
        ), "both observations are required members").toBeNull();
      }
      const shape = await c.query<{ n: string; suppress: boolean; only_members: boolean; field: string; members: string }>(
        `SELECT r.key AS n, r.suppress_members AS suppress, r.requires_only_members AS only_members,
                r.target_field AS field,
                (SELECT count(*)::text FROM clinical_combination_rule_members m
                  WHERE m.rule_id = r.id AND NOT m.is_optional) AS members
           FROM clinical_combination_rules r WHERE r.key = 'combo.fazekas.senile'`,
      );
      expect(shape.rows[0]!.field, "the combination writes the Impression").toBe("impression");
      expect(shape.rows[0]!.suppress, "it replaces the members rather than adding to them").toBe(true);
      expect(shape.rows[0]!.only_members, "it may still fire alongside an unrelated finding").toBe(false);
      expect(shape.rows[0]!.members, "two required observations, both selectable").toBe("2");
      // Grades share a conflict group and a concept family without becoming one concept.
      expect(await attempt(
        `INSERT INTO clinical_tile_versions (tile_id, version, snapshot_json)
         VALUES (${tFaz}, 1, '{"findings_text":"Fazekas grade 1 white matter hyperintensities."}')`,
      ), "the wording the rule combines is snapshottable").toBeNull();
      // And the examination as a whole is publishable, so the composer will find a
      // complete, ordered catalogue rather than a half-built one. Review is part of "complete":
      // the gate refuses unreviewed wording, so the fixture states the radiologist's sign-off
      // rather than slipping past the check.
      await approveCatalogue(c, f.examId);
      expect(await publish(c, f.examId, "pub.fazekas"), "the Fazekas catalogue publishes").toBeNull();
    });
  });

  it("seeds the eighteen §21 examinations as drafts and blocks an ambiguous scope", async () => {
    const census = await client.query<{ status: string; review_state: string; n: string }>(
      `SELECT status, review_state, count(*)::text AS n FROM clinical_examinations
        WHERE key LIKE 'mr.%' OR key LIKE 'ct.%' OR key LIKE 'us.%' OR key LIKE 'mg.%' OR key LIKE 'xr.%'
        GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    const total = census.rows.reduce((s, r) => s + Number(r.n), 0);
    expect(total, "seeded examinations").toBe(18);
    expect(census.rows.every((r) => r.status === "draft"), "nothing published").toBe(true);
    const uncertain = census.rows.filter((r) => r.review_state === "uncertain").reduce((s, r) => s + Number(r.n), 0);
    expect(uncertain, "three scopes carry a recorded clinical uncertainty").toBe(3);

    await inTx(async () => {
      const dup = await attempt(
        `INSERT INTO clinical_examinations (key, label, modality, body_part, protocol_scope)
         VALUES ('mr.brain.alt', 'Second name for the same scope', 'MR', ' BRAIN ', ' STANDARD ')`,
      );
      expect(dup?.code, "one live row per modality + body part + scope").toBe("23505");
    });
  });

  it("re-applies both migrations without changing anything", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const before = await client.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM clinical_examinations)::text AS n`,
    );
    await inTx(async (c) => {
      for (const file of [SCHEMA_FILE, SEED_FILE]) {
        const sqlText = readFileSync(join(repoRoot, file), "utf8");
        const err = await c.query(sqlText).then(() => null).catch((e: Error) => e);
        expect(err, `${file} must be re-runnable`).toBeNull();
      }
    });
    const after = await client.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM clinical_examinations)::text AS n`,
    );
    expect(after.rows[0]!.n, "replay must not duplicate or lose a seeded row").toBe(before.rows[0]!.n);
  });
});
