/**
 * FIELD-SCOPED COMBINATION CONTRACT — care-v4 Stage B hardening, §3 of the architectural brief.
 *
 * WHAT THIS FILE IS
 * -----------------
 * The executable statement of what a combination rule is allowed to do, written against the real
 * database. It does not compose a report: no sentence in this file is printed anywhere. It answers
 * one question — when two observations are combined into one line, which parts of the report may
 * that touch — and it answers it with rows that either insert or do not, and publications that
 * either succeed or are refused.
 *
 * THE SENTENCE THE BRIEF ASKS FOR
 * -------------------------------
 *     Do not suppress Findings simply because the corresponding Impression statements are combined.
 *
 * That is not a policy note; it is a shape. A rule row has exactly one `target_field`, and
 * `suppress_members` is a boolean, so there is no value any author can store that means "combine
 * the Impression and also delete the anatomical Findings". Test 2 proves the constructive half of
 * that: two rules over the SAME two tiles at the SAME precedence position in two DIFFERENT fields
 * publish, because a collision is defined within a field and not across a report.
 *
 * WHAT IS ENFORCED WHERE
 * ----------------------
 *   • closed field vocabulary            → CHECK clinical_combination_rules.target_field
 *   • no cross-field suppression         → the column set (there is nothing to write it in)
 *   • precedence per (examination,field) → unique index, among live non-deprecated rules
 *   • a rule must require something      → gate check 3
 *   • members must be selectable         → gate check 5
 *   • two rules may not claim one member → gate check 12
 *   • unreviewed wording stays in draft   → gate check 8
 *   • a rule must state its precedence   → gate check 16 (this file found the gap; see test 6)
 * The four runtime behaviours at the bottom are Stage C and are skipped, not silently absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  buildCatalogueSnapshot,
  catalogueContentHash,
  canonicalize,
  loadCatalogueRows,
} from "../cataloguePublicationSnapshot";

const dbUrl = process.env.DATABASE_URL;

/**
 * Every requirement §3 names, with the object that discharges it. A requirement whose enforcement
 * is "Stage C" is a requirement the database cannot see — recording that plainly is what stops a
 * later reviewer from reading this file as proof that composition behaves.
 */
const COMBINATION_CONTRACT = [
  {
    concern: "rules control Findings, Impression and Recommendations independently",
    enforcedBy: "target_field CHECK + gate check 12 scoping overlap per (examination, field)",
    stage: "B",
  },
  {
    concern: "combining Impressions must not suppress the Findings they rest on",
    enforcedBy: "the column set: suppress_members is boolean and names no field",
    stage: "B",
  },
  {
    concern: "member suppression is a stated act, never a default",
    enforcedBy: "suppress_members / requires_only_members NOT NULL with no DEFAULT",
    stage: "B",
  },
  {
    concern: "precedence between two rules writing one field",
    enforcedBy: "clin_combo_rules_field_ordinal_uq + gate check 16 (a live rule with no ordinal)",
    stage: "B",
  },
  {
    concern: "overlapping combinations",
    enforcedBy: "gate check 12 refuses two live rules claiming one required member",
    stage: "B",
  },
  {
    concern: "several rules matching the same selection at once",
    enforcedBy: "gate checks 3, 5, 12, 16 make the set lawful; applying it in order is Stage C",
    stage: "C",
  },
  {
    concern: "an Impression the radiologist edited by hand",
    enforcedBy: "nothing in the catalogue: an edit is a fact about one study",
    stage: "C",
  },
  {
    concern: "deselecting a member after a combination has fired",
    enforcedBy: "the member rows are the restore set per field; re-evaluation is Stage C",
    stage: "C",
  },
] as const;

const RULE_FIELDS = ["findings", "impression", "recommendation"] as const;

describe.skipIf(!dbUrl)("a combination rule reaches exactly one field of one examination", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  async function attempt(sqlText: string, params?: unknown[]): Promise<{ code: string; message: string } | null> {
    // Same reason as in the selection-contract suite: an unbound placeholder surfaces as Postgres
    // 42P02 "there is no parameter $1", which looks exactly like an aborted transaction.
    if (params === undefined) {
      const orphan = /\$\d/.exec(sqlText);
      if (orphan) {
        throw new Error(`attempt(): SQL binds ${orphan[0]} but was given no parameters (at offset ${orphan.index})`);
      }
    }
    await client.query("SAVEPOINT combo_probe");
    try {
      await client.query(sqlText, params);
      await client.query("RELEASE SAVEPOINT combo_probe");
      return null;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await client.query("ROLLBACK TO SAVEPOINT combo_probe");
      return { code: err.code ?? "", message: err.message ?? "" };
    }
  }

  async function publish(key: string, examId: number): Promise<{ code: string; message: string } | null> {
    const rows = await loadCatalogueRows((sqlText, values) => client.query(sqlText, values), examId);
    const doc = buildCatalogueSnapshot(rows);
    return attempt(
      `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot)
       VALUES ($1, $2, repeat('b', 64), $3, $4::jsonb)`,
      [examId, key, 1, JSON.stringify(doc)],
    );
  }

  /**
   * Three reviewable observations, placed and approved, and nothing else. Every rule in this file is
   * built on top of them, so a refusal can only come from the rule being examined — the discipline
   * that keeps a gate test from going green on an unrelated arm.
   */
  async function seedComboFixture(c: Client, tag: string): Promise<{ examId: number; tiles: Record<string, number> }> {
    const cat = await c.query(
      `INSERT INTO finding_categories (key, label) VALUES ($1, 'Combination category') RETURNING id`, [`${tag}.cat`],
    );
    const con = await c.query(
      `INSERT INTO finding_definitions (key, category_id, label) VALUES ($1, $2, 'Combination concept') RETURNING id`,
      [`${tag}.con`, cat.rows[0]!.id],
    );
    const exam = await c.query(
      `INSERT INTO clinical_examinations (key, label, modality, body_part, protocol_scope, review_state, status)
       VALUES ($1, 'MRI Brain (combination fixture)', 'MR', $2, 'Standard', 'approved', 'active') RETURNING id`,
      [`${tag}.exam`, `${tag} Brain`],
    );
    const examId = Number(exam.rows[0]!.id);
    await c.query(
      `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal, review_state, status)
       VALUES ($1, $2, 'Cerebral parenchyma', 1, 'approved', 'active')`,
      [examId, `${tag}.section`],
    );
    const sectionId = (await c.query<{ id: number }>(
      `SELECT id FROM clinical_anatomical_sections WHERE examination_id = $1`, [examId],
    )).rows[0]!.id;
    const tiles: Record<string, number> = {};
    for (const [i, key] of ["a", "b", "c"].entries()) {
      const t = await c.query(
        `INSERT INTO clinical_tiles (key, concept_id, label, findings_text, impression_text, review_state, status)
         VALUES ($1, $2, $3, $4, $5, 'approved', 'active') RETURNING id`,
        [`${tag}.tile.${key}`, Number(con.rows[0]!.id), key,
         `A fixture finding sentence for ${key}.`, `A fixture impression sentence for ${key}.`],
      );
      tiles[key] = Number(t.rows[0]!.id);
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal, created_by)
         VALUES ($1, $2, $3, $4, 'contract')`,
        [tiles[key], examId, sectionId, i + 1],
      );
    }
    return { examId, tiles };
  }

  /** Storable by construction: approved, active, preceded, and grounded in placed tiles. */
  async function addRule(
    c: Client,
    tag: string,
    opts: {
      key: string;
      field?: string;
      suppress?: boolean;
      onlyMembers?: boolean;
      ordinal?: number | null;
      examId: number;
      sectionId?: number;
      requiredTiles?: string[];
      optionalTiles?: string[];
      tiles: Record<string, number>;
      status?: string;
    },
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO clinical_combination_rules
         (key, examination_id, section_id, label, target_field, combined_text,
          suppress_members, requires_only_members, ordinal, review_state, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', $10) RETURNING id`,
      [
        `${tag}.${opts.key}`, opts.examId, opts.sectionId ?? null, opts.key, opts.field ?? "impression",
        `A consolidated sentence for ${opts.key}.`,
        opts.suppress ?? true, opts.onlyMembers ?? false,
        opts.ordinal === null ? null : (opts.ordinal ?? 1), opts.status ?? "active",
      ],
    );
    const ruleId = Number(r.rows[0]!.id);
    for (const [i, t] of (opts.requiredTiles ?? []).entries()) {
      await c.query(
        `INSERT INTO clinical_combination_rule_members (rule_id, tile_id, ordinal, is_optional)
         VALUES ($1, $2, $3, FALSE)`, [ruleId, opts.tiles[t]!, i + 1],
      );
    }
    for (const [i, t] of (opts.optionalTiles ?? []).entries()) {
      await c.query(
        `INSERT INTO clinical_combination_rule_members (rule_id, tile_id, ordinal, is_optional)
         VALUES ($1, $2, $3, TRUE)`, [ruleId, opts.tiles[t]!, i + 1],
      );
    }
    return ruleId;
  }

  it("names every §3 concern and says which of them a database can already hold", () => {
    expect(COMBINATION_CONTRACT).toHaveLength(8);
    for (const row of COMBINATION_CONTRACT) {
      expect(row.enforcedBy.length, `"${row.concern}" names its enforcement`).toBeGreaterThan(0);
      expect(["B", "C"], `"${row.concern}" says which stage discharges it`).toContain(row.stage);
    }
    // Six of the eight are Stage B facts today. Saying the number is the point: a contract that
    // cannot state how much of itself is executable is a design note.
    expect(COMBINATION_CONTRACT.filter((r) => r.stage === "B").length).toBe(5);
    expect(COMBINATION_CONTRACT.filter((r) => r.stage === "C").length).toBe(3);
  });

  it("writes exactly one field, from a closed vocabulary, with nothing left to default", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedComboFixture(client, "vocab");
      for (const field of RULE_FIELDS) {
        expect(await addRule(client, `rule.${field}`, {
          key: field, field, examId: f.examId, tiles: f.tiles, requiredTiles: ["a"],
        }), `a rule may write ${field}`).toBeGreaterThan(0);
      }
      // Deleting the second field's rule is not enough: the vocabulary has to be provably closed.
      for (const field of ["both", "impression,findings", "notes", "impression ", "IMPRESSION"]) {
        expect((await attempt(
          `INSERT INTO clinical_combination_rules
             (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members)
             VALUES ('vocab.bad.${field}', $1, 'Bad field', $2, 'A line.', TRUE, FALSE)`,
          [f.examId, field],
        ))?.code, `"${field}" is not a field a rule may write`).toBe("23514");
      }

      // The structural half of "do not suppress Findings because you combined an Impression":
      // there is no column to say it with. Checked both ways — a field-naming column other than
      // target_field would be a second source of scope, and a text suppress_members would let a
      // boolean column carry one.
      const cols = await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'clinical_combination_rules' ORDER BY column_name`,
      );
      const fieldish = cols.rows.filter((r) => r.column_name.toLowerCase().includes("field")).map((r) => r.column_name);
      expect(fieldish, "exactly one column names a field").toEqual(["target_field"]);
      const suppress = cols.rows.find((r) => r.column_name === "suppress_members");
      expect(suppress?.data_type, "suppress_members is a boolean, so it cannot carry a field").toBe("boolean");
      for (const name of ["suppress_field", "suppressed_fields", "findings_text", "impression_text"]) {
        expect(cols.rows.map((r) => r.column_name), `no column called ${name}`).not.toContain(name);
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("combines the Impressions of two tiles and leaves a Findings rule over the same two alone", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedComboFixture(client, "twin");
      const sectionId = (await client.query<{ id: number }>(
        `SELECT id FROM clinical_anatomical_sections WHERE examination_id = $1`, [f.examId],
      )).rows[0]!.id;

      // Same tiles, same precedence number, same examination — and no collision, because a claim
      // is a claim within a field. This is the brief's requirement turned into a publishable row.
      await addRule(client, "twin", {
        key: "impression.merged", field: "impression", suppress: true, ordinal: 1,
        examId: f.examId, sectionId, tiles: f.tiles, requiredTiles: ["a", "b"],
      });
      await addRule(client, "twin", {
        key: "findings.ordered", field: "findings", suppress: false, ordinal: 1,
        examId: f.examId, sectionId, tiles: f.tiles, requiredTiles: ["a", "b"],
      });
      expect(await publish("pub.twin.ok", f.examId), "two fields, one pair of observations").toBeNull();

      // And the publication freezes them as two distinct rules, not one merged intention. The
      // identity of a combination rule is its key, which is examination-scoped and carries the
      // fixture tag.
      const rows = await loadCatalogueRows((s, v) => client.query(s, v), f.examId);
      const doc = buildCatalogueSnapshot(rows);
      const byKey = new Map(doc.combinationRules.map((e) => [e.identity, e]));
      expect([...byKey.keys()].sort()).toEqual(["twin.findings.ordered", "twin.impression.merged"]);
      expect(byKey.get("twin.impression.merged")!.suppress_members).toBe(true);
      expect(byKey.get("twin.findings.ordered")!.suppress_members, "the Findings rule suppresses nothing").toBe(false);
      expect(byKey.get("twin.impression.merged")!.members, "each rule keeps its own members when it is restored")
        .toHaveLength(2);

      // The one shape that WOULD be a collision, refused so the difference is not just asserted:
      // a third rule joining the Impression at the position the Impression rule already holds.
      expect((await attempt(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
            ordinal, review_state, status)
         VALUES ('twin.third', $1, 'Same position again', 'impression', 'Another line.', TRUE, FALSE,
                 1, 'approved', 'active')`,
        [f.examId],
      ))?.code, "a field position may be claimed once").toBe("23505");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("holds precedence per field: one position each, positive, and released when a rule retires", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedComboFixture(client, "prec");
      await addRule(client, "prec", {
        key: "first", field: "impression", ordinal: 1, examId: f.examId, tiles: f.tiles, requiredTiles: ["a"],
      });

      // Same position, same field → refused.
      expect((await attempt(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
            ordinal, review_state, status)
         VALUES ('prec.same', $1, 'Same position', 'impression', 'A line.', TRUE, FALSE, 1, 'approved', 'active')`,
        [f.examId],
      ))?.code, "two live rules may not share a position in one field").toBe("23505");

      // Same position, another field → allowed, because the positions belong to different fields.
      expect(await attempt(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
            ordinal, review_state, status)
         VALUES ('prec.other', $1, 'Same number, other field', 'findings', 'A line.', TRUE, FALSE,
                 1, 'approved', 'active')`,
        [f.examId],
      ), "a position is scoped to its field").toBeNull();

      // A position that is not a position.
      for (const bad of [0, -1, -100]) {
        expect((await attempt(
          `INSERT INTO clinical_combination_rules
             (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
              ordinal, review_state, status)
           VALUES ($1, $2, 'Non-positive', 'impression', 'A line.', TRUE, FALSE, $3, 'approved', 'active')`,
          [`prec.bad.${bad}`, f.examId, bad],
        ))?.code, `ordinal ${bad} is not a precedence`).toBe("23514");
      }

      // No position is legal in the table: a rule being built has not been placed yet, and a
      // DEFAULT 0 would hand every unfinished rule the same first place. What refuses it is
      // publication — see the next-but-one test.
      expect(await attempt(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
            ordinal, review_state, status)
         VALUES ('prec.unplaced', $1, 'Under construction', 'impression', 'A line.', TRUE, FALSE,
                 NULL, 'approved', 'active')`,
        [f.examId],
      ), "a rule without precedence is storable").toBeNull();

      // Retiring a rule releases its position rather than squatting on it — the partial unique
      // index excludes 'deprecated' on purpose, so history stays readable and the slot is free.
      expect(await attempt(
        `UPDATE clinical_combination_rules SET status = 'deprecated' WHERE key = 'prec.first'`,
      ), "deprecating the first rule is a plain update").toBeNull();
      expect(await attempt(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
            ordinal, review_state, status)
         VALUES ('prec.replacement', $1, 'Takes the freed position', 'impression', 'A line.', TRUE, FALSE,
                 1, 'approved', 'active')`,
        [f.examId],
      ), "the position is reusable once its holder is deprecated").toBeNull();
      // A draft rule still competes: only 'deprecated' steps out of the way.
      expect((await attempt(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
            ordinal, review_state, status)
         VALUES ('prec.draft', $1, 'Draft in a taken position', 'impression', 'A line.', TRUE, FALSE,
                 1, 'approved', 'draft')`,
        [f.examId],
      ))?.code, "a draft rule holds a position too").toBe("23505");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses two live rules that both claim the same required observation for one field", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedComboFixture(client, "over");
      await addRule(client, "over", {
        key: "a", field: "impression", ordinal: 1, examId: f.examId, tiles: f.tiles, requiredTiles: ["a"],
      });
      await addRule(client, "over", {
        key: "b", field: "impression", ordinal: 2, examId: f.examId, tiles: f.tiles, requiredTiles: ["a"],
      });
      const clash = await publish("pub.over.clash", f.examId);
      expect(clash?.code, "a stated precedence does not license the overlap").toBe("P0001");
      expect(clash?.message, "and the refusal says which field is contested").toMatch(
        /both claim a required member for the impression field/,
      );

      // Separating the required members is the whole remedy.
      expect(await attempt(
        `UPDATE clinical_combination_rule_members SET tile_id = (SELECT id FROM clinical_tiles WHERE key = 'over.tile.c')
          WHERE rule_id = (SELECT id FROM clinical_combination_rules WHERE key = 'over.b')`,
      ), "giving the second rule its own observation is a plain update").toBeNull();
      expect(await publish("pub.over.fixed", f.examId), "and then it publishes").toBeNull();

      // A deprecated rival stops competing — the same predicate the unique index uses, so the two
      // arms cannot disagree about who is in force.
      expect(await attempt(
        `UPDATE clinical_combination_rules SET status = 'deprecated' WHERE key = 'over.a'`,
      )).toBeNull();
      expect(await publish("pub.over.retired", f.examId), "a retired rule claims nothing").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("does not let an overlap be dodged by making the shared member optional", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedComboFixture(client, "dodge");
      await addRule(client, "dodge", {
        key: "a", field: "impression", ordinal: 1, examId: f.examId, tiles: f.tiles, requiredTiles: ["a"],
      });
      // Rule b claims nothing required: it would fire on a selection that includes nothing.
      await addRule(client, "dodge", {
        key: "b", field: "impression", ordinal: 2, examId: f.examId, tiles: f.tiles, optionalTiles: ["a"],
      });
      const hollow = await publish("pub.dodge.hollow", f.examId);
      expect(hollow?.code, "an optional-only rule is refused by check 3, not quietly skipped").toBe("P0001");
      expect(hollow?.message, "and it names the rule by its key").toMatch(
        /combination rule dodge\.b has no required member/,
      );

      // And the fix is to require something the other rule does not, not to require nothing.
      expect(await attempt(
        `INSERT INTO clinical_combination_rule_members (rule_id, tile_id, ordinal, is_optional)
         VALUES ((SELECT id FROM clinical_combination_rules WHERE key = 'dodge.b'),
                 (SELECT id FROM clinical_tiles WHERE key = 'dodge.tile.b'), 1, FALSE)`,
      ), "adding a distinct required member is a plain insert").toBeNull();
      expect(await publish("pub.dodge.fixed", f.examId), "the two rules are now disjoint").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses to publish a rule whose precedence nobody stated", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedComboFixture(client, "npos");
      await addRule(client, "npos", {
        key: "unplaced", field: "impression", ordinal: null, examId: f.examId, tiles: f.tiles,
        requiredTiles: ["a", "b"],
      });
      const refused = await publish("pub.npos.unplaced", f.examId);
      // Placed tiles and ordered sections already have this arm (checks 1 and 9). A rule was the
      // one ordering object a publication could freeze without a position, which means the frozen
      // document states "these two sentences combine into one" and leaves the restoring composer to
      // invent where it sits.
      expect(refused?.code, "a live rule with no precedence is not publishable").toBe("P0001");
      expect(refused?.message, "and the refusal names the rule and the field").toMatch(
        /combination rule npos\.unplaced has no stated precedence for the impression field/,
      );

      // Stating it is the whole remedy, and nothing else about the rule had to change.
      expect(await attempt(
        `UPDATE clinical_combination_rules SET ordinal = 1 WHERE key = 'npos.unplaced'`,
      )).toBeNull();
      expect(await publish("pub.npos.fixed", f.examId), "a rule with a stated position publishes").toBeNull();

      // A deprecated rule is not a rule in force, so it is not required to hold a position: the
      // arm must use the same predicate as the unique index and check 12, or the three would
      // disagree about who counts. The ordinal has to be cleared on the way in — leaving it at 1
      // would make this step assert nothing, which is exactly how the first version of this test
      // survived a mutant that refused every unplaced rule regardless of status.
      expect(await attempt(
        `UPDATE clinical_combination_rules SET status = 'deprecated', ordinal = NULL WHERE key = 'npos.unplaced'`,
      )).toBeNull();
      expect(await publish("pub.npos.retired", f.examId), "a retired rule may keep its blank position").toBeNull();

      // …and stepping it back to 'draft' puts it back in force, because the gate's predicate is
      // `status <> 'deprecated'` — the same one the unique index and check 12 use. If the three
      // disagreed about who counts, a rule could hold a position in one arm and be exempt in
      // another, which is the class of defect the ratchet guards exist to catch. The ordinal goes
      // back to NULL with it: the step above placed the rule, and a placed draft has nothing left
      // for this arm to refuse.
      expect(await attempt(
        `UPDATE clinical_combination_rules SET status = 'draft', ordinal = NULL WHERE key = 'npos.unplaced'`,
      )).toBeNull();
      const drafted = await publish("pub.npos.draft", f.examId);
      expect(drafted?.code, "a draft rule with no precedence is refused too").toBe("P0001");
      expect(drafted?.message).toMatch(/has no stated precedence for the impression field/);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("freezes precedence into the publication, so a restored document replays the same order", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedComboFixture(client, "hash");
      const ruleId = await addRule(client, "hash", {
        key: "moving", field: "impression", ordinal: 1, examId: f.examId, tiles: f.tiles, requiredTiles: ["a"],
      });
      const rows = await loadCatalogueRows((s, v) => client.query(s, v), f.examId);
      const before = buildCatalogueSnapshot(rows);
      const held = before.combinationRules.find((e) => e.identity === "hash.moving");
      expect(held?.ordinal, "the frozen entry carries the position").toBe(1);

      // Moving the rule is a content change, so the hash must move with it. A hash that ignored
      // precedence would certify two catalogues that print differently as the same publication.
      expect(await attempt(
        `UPDATE clinical_combination_rules SET ordinal = 2 WHERE id = $1`, [ruleId],
      )).toBeNull();
      const after = buildCatalogueSnapshot(await loadCatalogueRows((s, v) => client.query(s, v), f.examId));
      expect(after.combinationRules.find((e) => e.identity === "hash.moving")?.ordinal).toBe(2);
      expect(catalogueContentHash(after), "the content hash moves with precedence").not.toBe(
        catalogueContentHash(before),
      );
      expect(canonicalize(after.combinationRules)).not.toBe(canonicalize(before.combinationRules));
      // Nothing else moved: only the precedence differs.
      expect(canonicalize(after.tiles), "the tiles are untouched").toBe(canonicalize(before.tiles));
      expect(await publish("pub.hash.moved", f.examId), "and the moved rule still publishes").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // ── Obligations Stage C has to discharge ────────────────────────────────────────────────
  describe("runtime obligations (Stage C — specification only, no composer exists yet)", () => {
    it.skip("applies an impression-field rule without touching the members' findings sentences", () => {
      // The schema makes cross-field suppression unstorable, so the Stage C fault to prevent is the
      // composer doing it in code: reading suppress_members as "drop the members from the report".
      // Assertion: after one rule with target_field='impression' and suppress_members=TRUE fires,
      // both members' findings_text are still present in Findings, in anatomical order.
      expect(true, "Stage C").toBe(false);
    });

    it.skip("never re-combines over an Impression the radiologist edited", () => {
      // §3 asks after an "explicitly edited Impression". No catalogue column can represent an edit,
      // which is correct — an edit is a fact about one study — so Stage C must carry the edited text
      // plus its own provenance and skip combination for that field. The CARE ERP precedent is the
      // signed-report mutation boundary: a guard in the writer, not in its callers.
      expect(true, "Stage C").toBe(false);
    });

    it.skip("re-evaluates a rule when a member is deselected, and restores only the field it writes", () => {
      // Deselecting tile a must un-fire the rule, print each remaining member's contribution again
      // in the rule's own field, and leave the other fields exactly as they were. Two rules over the
      // same pair in two fields (test 3) is the fixture this is written against.
      expect(true, "Stage C").toBe(false);
    });

    it.skip("applies several simultaneously applicable rules of one field in the stated order", () => {
      // The lawful set is what gate checks 3/5/12/16 guarantee. What remains is the walk: rules in
      // ordinal order, each seeing the previous rule's output for that field, and 'requires_only
      // members' evaluated against the selection rather than against the already-combined text.
      expect(true, "Stage C").toBe(false);
    });
  });

  it("keeps the recommendation field to one source of truth", async () => {
    await client.query("BEGIN");
    try {
      // target_field='recommendation' exists on combination rules AND there is a separate
      // clinical_recommendation_rules table, so the report's advice section has two catalogue
      // objects that can write it. This is not a defect to fix in Stage B — it is the one place
      // where §6's "no second clinical source of truth" needs an explicit ruling, so it is
      // recorded as a test with a checkable sentence rather than left for someone to discover:
      // a combination rule CONSOLIDATES observations already selected, a recommendation rule EMITS
      // advice by condition, and Stage C must define which of them owns a line the other produced.
      const f = await seedComboFixture(client, "recsrc");
      const recRuleId = await addRule(client, "recsrc", {
        key: "advice.merged", field: "recommendation", ordinal: 1, examId: f.examId, tiles: f.tiles,
        requiredTiles: ["a", "b"],
      });
      expect(recRuleId, "a combination rule may write Recommendations").toBeGreaterThan(0);
      expect(await attempt(
        `INSERT INTO clinical_recommendation_rules
           (key, examination_id, label, trigger_kind, tile_id, advice_text, emit_policy, ordinal, review_state, status)
         VALUES ('recsrc.advice', $1, 'Advice for tile a', 'tile_selected',
                 (SELECT id FROM clinical_tiles WHERE key = 'recsrc.tile.a'),
                 'A fixture piece of advice.', 'always', 1, 'approved', 'active')`,
        [f.examId],
      ), "and a recommendation rule can sit beside it").toBeNull();
      const kinds = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM clinical_combination_rules WHERE examination_id = $1 AND target_field = 'recommendation'`,
        [f.examId],
      );
      expect(kinds.rows[0]!.n, "one consolidation rule on that field, in this fixture").toBe("1");
      // Both objects exist, both are frozen by the snapshot, and neither is the other's fallback:
      // the recommendation RULES domain in the document holds the emitting rules, and the
      // combination rules hold the consolidation. Which prints where is a stated Stage C decision.
      const rows = await loadCatalogueRows((s, v) => client.query(s, v), f.examId);
      const doc = buildCatalogueSnapshot(rows);
      expect(doc.recommendationRules.map((e) => e.identity), "the emitter is frozen under its own key")
        .toEqual(["recsrc.advice"]);
      expect(doc.combinationRules.map((e) => e.identity), "the consolidator keeps its own domain").toEqual(
        ["recsrc.advice.merged"],
      );
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
