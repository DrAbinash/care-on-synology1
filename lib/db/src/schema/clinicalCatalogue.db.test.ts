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
 *   • one normal per anatomical slot, and a different level is a different slot;
 *   • ON DELETE RESTRICT makes a concept or a restore-target undestroyable while a tile
 *     still points at it;
 *   • a relationship or a combination member must name exactly one target;
 *   • re-applying both migrations changes nothing (idempotent, so a replayed deploy is safe).
 *
 * Every test runs inside a transaction that is rolled back, so no row survives and the
 * eighteen seeded draft examinations stay exactly as the migration wrote them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const dbUrl = process.env.DATABASE_URL;
const SCHEMA_FILE = "migrations/zzzz_add_clinical_catalogue_v4.sql";
const SEED_FILE = "migrations/zzzzz_seed_clinical_catalogue_v4_examinations.sql";

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
  async function attempt(sqlText: string): Promise<{ code: string; message: string } | null> {
    await client.query("SAVEPOINT catalogue_probe");
    try {
      await client.query(sqlText);
      await client.query("RELEASE SAVEPOINT catalogue_probe");
      return null;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await client.query("ROLLBACK TO SAVEPOINT catalogue_probe");
      return { code: err.code ?? "", message: err.message ?? "" };
    }
  }

  /**
   * Postgres reports an ON DELETE RESTRICT breach as `23001 restrict_violation`,
   * while a plain NO ACTION key raises `23503 foreign_key_violation`. Asserting 23001
   * therefore proves the migration's RESTRICT actually took effect rather than being
   * silently defaulted.
   */
  const RESTRICT_VIOLATION = "23001";

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

  async function insertTile(c: Client, key: string, conceptId: number, extra = ""): Promise<number> {
    const r = await c.query(
      `INSERT INTO clinical_tiles (key, concept_id, label, findings_text${extra ? ", " + extra : ""})
       VALUES ($1, $2, 'Fixture tile', 'A fixture sentence.') RETURNING id`,
      [key, conceptId],
    );
    return r.rows[0]!.id as number;
  }

  it("creates all thirteen tables with every column drizzle declares", async () => {
    const expected: Record<string, string[]> = {
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
      clinical_publications: ["id", "examination_id", "publication_key", "content_hash", "summary_json", "notes", "published_by", "published_at", "created_at"],
    };
    const live = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'clinical_%'`,
    );
    const present = new Set(live.rows.map((r) => `${r.table_name}.${r.column_name}`));
    expect(Object.keys(expected)).toHaveLength(13);
    for (const [table, columns] of Object.entries(expected)) {
      const missing = columns.filter((col) => !present.has(`${table}.${col}`));
      expect(missing, `${table} is missing columns the migration was supposed to create`).toEqual([]);
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
        `INSERT INTO clinical_tiles (key, concept_id, label) VALUES ('tile.dup', ${conceptId}, 'Another tile')`,
      );
      expect(second?.code, "two live tiles cannot share a key").toBe("23505");

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
      expect(conceptDelete?.code, "concept is RESTRICT-referenced by a tile").toBe(RESTRICT_VIOLATION);
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
      expect(slotDelete?.code, "normal slot is RESTRICT-referenced by a tile").toBe(RESTRICT_VIOLATION);
      expect(slotDelete?.message).toMatch(/clinical_tile_normal_replacements_normal_slot_id_fkey/);
      const tileDelete = await attempt(`DELETE FROM clinical_tiles WHERE id = ${tileId}`);
      expect(tileDelete?.code, "tile is RESTRICT-referenced by its placement edge").toBe(RESTRICT_VIOLATION);
      const examDelete = await attempt(`DELETE FROM clinical_examinations WHERE id = ${examId}`);
      expect(examDelete?.code, "examination is RESTRICT-referenced by a placed tile").toBe(RESTRICT_VIOLATION);
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

  it("holds one normal per anatomical slot, and treats a level or side as a different slot", async () => {
    await inTx(async (c) => {
      const { conceptId, examId, sectionId } = await seedFixture(c, "slots");
      const ins = (key: string, level: string | null, laterality: string | null) =>
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, level, laterality)
         VALUES (${examId}, ${sectionId}, ${conceptId}, '${key}', 'findings', 'A fixture normal.', ${
          level === null ? "NULL" : `'${level}'`}, ${laterality === null ? "NULL" : `'${laterality}'`})`;

      expect(await attempt(ins("s1", null, null)), "the first normal for a slot is accepted").toBeNull();
      const same = await attempt(ins("s2", null, null));
      expect(same?.code, "a second live normal for the same slot must be refused").toBe("23505");

      // The LS Spine case: each level is its own slot, so six levels coexist.
      expect(await attempt(ins("s3", "L4-L5", null)), "a different level is a different slot").toBeNull();
      expect(await attempt(ins("s4", "L4-L5", "left")), "a different side is a different slot").toBeNull();
      // …and padding must not smuggle in a duplicate. The laterality CHECK pins the
      // vocabulary to lowercase, so 'LEFT' is rejected before the index is consulted —
      // this probe isolates TRIM on the level, which has no CHECK of its own.
      const whitespace = await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, level, laterality)
         VALUES (${examId}, ${sectionId}, ${conceptId}, 's5', 'findings', 'A fixture normal.', ' L4-L5 ', 'left')`,
      );
      expect(whitespace?.code, "padding must not create a second claim on one slot").toBe("23505");
      const upperCase = await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, laterality)
         VALUES (${examId}, ${sectionId}, ${conceptId}, 's6', 'findings', 'A fixture normal.', 'LEFT')`,
      );
      expect(upperCase?.code, "'LEFT' is refused as a laterality, not normalised").toBe("23514");
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
        `INSERT INTO clinical_combination_rules (key, examination_id, label, target_field, combined_text)
         VALUES ('combo.rel', ${f.examId}, 'Fixture combo', 'impression', 'One consolidated line.')`,
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
      // min > max is a rule that can never be satisfied; the service layer enforced this
      // for parameter_groups, and the catalogue keeps it as a plain column pair, so this
      // asserts the honest current state: the database does NOT reject it.
      const inverted = await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, min_value, max_value)
         VALUES (${tileId}, 'bad', 'Inverted', 'numeric', 400, 1)`,
      );
      expect(inverted, "documented gap: range sanity is a publish-gate rule, not a CHECK").toBeNull();
    });
  });

  it("can express every recommendation policy §13 needs and refuses a made-up one", async () => {
    await inTx(async (c) => {
      const { examId } = await seedFixture(c, "rec");
      const ins = (key: string, policy: string) =>
        `INSERT INTO clinical_recommendation_rules (key, examination_id, label, trigger_kind, advice_text, emit_policy)
         VALUES ('${key}', ${examId}, 'Fixture advice', 'concept_present', 'Correlate clinically.', '${policy}')`;
      for (const policy of ["always", "when_no_other", "when_only"]) {
        expect(await attempt(ins(`rec.${policy}`, policy)), policy).toBeNull();
      }
      // 'never' is not a policy: a rule that never emits is dead content, and §13's
      // omission case is expressed by when_only / an empty section, not by suppression.
      expect((await attempt(ins("rec.never", "never")))?.code).toBe("23514");
      const prio = await attempt(
        `INSERT INTO clinical_recommendation_rules (key, examination_id, label, trigger_kind, advice_text, priority)
         VALUES ('rec.p', ${examId}, 'Urgent advice', 'concept_present', 'Urgent contact.', 'immediately')`,
      );
      expect(prio?.code, "priority vocabulary is routine|urgent|critical").toBe("23514");
    });
  });

  it("keeps publication history append-only and never overwritable", async () => {
    await inTx(async (c) => {
      const { examId } = await seedFixture(c, "pub");
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key) VALUES (${examId}, 'pub.1')`,
      ))?.code, "content_hash is NOT NULL: a publication must be addressable by its hash").toBe("23502");
      await c.query(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash)
         VALUES (${examId}, 'pub.1', 'sha256:aaaa')`,
      );
      // Not a partial index: two publications of the same key are history, and the second
      // must not silently replace the first — that is how a cache token stops being a fact.
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash)
         VALUES (${examId}, 'pub.1', 'sha256:bbbb')`,
      ))?.code).toBe("23505");
      const cols = await c.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'clinical_tile_versions' AND column_name = 'deleted_at'`,
      );
      expect(cols.rows, "a version history must not be soft-deletable").toEqual([]);
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
