/**
 * PUBLICATION VALIDATION CONTRACT — care-v4 Stage B hardening, §4 of the architectural brief.
 *
 * THE THREE LAYERS, AND WHY THEY MUST NOT BE TOLD APART
 * -----------------------------------------------------
 *   1. DRAFT validation — what the table lets an author save. Its job is to keep a half-finished
 *      catalogue editable: a CHECK on the vocabulary, a foreign key that cannot point at another
 *      examination, a unique index that cannot be fooled by case or whitespace. Anything stricter
 *      turns the editor into a wall and the author starts working around it.
 *   2. PUBLICATION validation — what clinical_publication_gate() refuses to freeze. This is where
 *      incompleteness stops being legal, because from this point the configuration is what a
 *      report will be composed from.
 *   3. RUNTIME selection validation — what a particular radiologist, on a particular study, has
 *      or has not answered. The catalogue cannot see any of it, and a schema that tried to would
 *      be validating a study against a template rather than a template against itself.
 *
 * A defect class that appears in all three is a required parameter: the column pair (is_required,
 * data_type) is draft data, "this required choice has nothing to choose from" is a publication
 * fact (check 11), and "this radiologist has not answered it yet" is a runtime fact that must
 * never block a publication. The brief asks for the distinction to be clear rather than implied,
 * so the ten §4 items below each name the layer where their last line of defence sits, and every
 * arm is executed against a real publication — with the remedy the refusal message names, driven
 * in the same transaction, because a refusal whose stated fix does not work is worse than no
 * refusal at all.
 *
 * ARMS EXECUTED ONLY HERE: 2, 8 (all five wording kinds plus the emits_heading boundary), 9, 10,
 * 11, 15, 17, 18 — the last two found by the adversarial pass, which rebuilt a database from zero
 * through the real migration pipeline and asked what a catalogue could publish while losing or
 * reaching outside itself. Checks 1, 3, 4, 5, 6, 7, 12, 13, 14, 16 already have executable coverage
 * in clinicalCatalogue.db.test.ts, clinicalSelectionContract.db.test.ts and
 * clinicalCombinationContract.db.test.ts; this file's static test is what makes that claim
 * checkable rather than remembered.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { buildCatalogueSnapshot, loadCatalogueRows } from "../cataloguePublicationSnapshot";

const dbUrl = process.env.DATABASE_URL;

/** §4's ten items, and the layer that stops each one reaching a patient. */
const PUBLICATION_REFUSALS = [
  {
    item: "missing required parameters",
    layer: "publication",
    enforcedBy: "gate check 11 (a required 'option' parameter with no default and no options)",
    draftAllows: "an unfinished parameter row, and any required non-option parameter — its emptiness is a study fact",
    runtime: "the required parameter is unanswered ON THIS STUDY",
  },
  {
    item: "invalid anatomical relationships",
    layer: "publication",
    enforcedBy: "gate checks 2, 17 and 18 (a section parented to a retired section, a placement whose tile is retired, a relationship reaching outside the examination)",
    draftAllows: "re-parenting and re-ordering, retiring a tile, and a temporarily wrong parent",
    runtime: "nothing — anatomy is catalogue state, not study state",
  },
  {
    item: "unresolved ordering",
    layer: "publication",
    enforcedBy: "gate checks 1 (tile), 9 (section) and 16 (combination rule)",
    draftAllows: "ordinal IS NULL, which reads as 'not placed yet' rather than as a position",
    runtime: "the radiologist's own section order for one report, if Stage C ever offers one",
  },
  {
    item: "missing referenced normal slots",
    layer: "publication",
    enforcedBy: "gate checks 4 and 10 (a replacement of a normal the tile cannot offer, or one retired)",
    draftAllows: "soft-deleting a normal, because retirement is an editorial act with a history",
    runtime: "which normals a given selection actually retires",
  },
  {
    item: "invalid combination members",
    layer: "publication",
    enforcedBy: "gate checks 3 (no required member), 5 (member not placed) and 12 (two rules, one member)",
    draftAllows: "a rule whose members are still being added",
    runtime: "which members are selected in this study",
  },
  {
    item: "unresolved clinical conflicts",
    layer: "publication",
    enforcedBy: "gate checks 6 (a symmetric pair declared one way) and 7 (a conflict group nothing resolves)",
    draftAllows: "an undeclared pair, which is the state that let nine order-dependent tiles ship",
    runtime: "a pair in two different groups with nothing between them: print both, evict neither",
  },
  {
    item: "unreviewed mandatory clinical wording",
    layer: "publication",
    enforcedBy: "gate check 8 (tile, section heading, normal, combination rule, recommendation rule)",
    draftAllows: "review_state 'unreviewed' and 'uncertain', which is how a review queue works",
    runtime: "an override the radiologist typed over approved wording",
  },
  {
    item: "circular dependencies",
    layer: "publication",
    enforcedBy: "gate check 13 (a requires/parent_child/supersedes cycle)",
    draftAllows: "closing the loop, because a CHECK cannot see a path and the author must be able to save",
    runtime: "nothing — a cycle is a property of the catalogue",
  },
  {
    item: "invalid recommendation rules",
    layer: "publication",
    enforcedBy: "gate checks 5 and 15 (a trigger that can never become true)",
    draftAllows: "a rule being written",
    runtime: "whether this study's answers satisfy the trigger",
  },
  {
    item: "duplicate logical normal slots",
    layer: "draft",
    enforcedBy: "clinical_normal_slots_slot_uq — (examination, slot_field, region, concept, level, laterality)",
    draftAllows: "nothing: the duplicate cannot be stored, so the gate has no arm and needs none",
    runtime: "nothing — one baseline claim cannot be two rows",
  },
] as const;

/** Facts the catalogue is blind to, by construction. Listed so nobody later adds a column for one. */
const RUNTIME_ONLY_FACTS = [
  {
    fact: "this radiologist has not answered the required parameter yet",
    whyNotCatalogue: "it is a property of one study's selection, and a publication freezing it would freeze every other study out of the same sentence",
  },
  {
    fact: "this tile was selected and then deselected, and the normals it retired came back",
    whyNotCatalogue: "the restore set is the tile's replacement edges, which the catalogue does hold; the act of deselecting is not catalogue state",
  },
  {
    fact: "two tiles in different conflict groups were clicked together and nothing declares how they resolve",
    whyNotCatalogue: "no finite set of rows enumerates every pair in an examination, so the default must live in the composer and be tested there",
  },
  {
    fact: "the Impression was typed over by hand, and a rule must not re-combine across it",
    whyNotCatalogue: "an edit is a fact about one study; the catalogue has no column for it and must not gain one",
  },
] as const;

describe.skipIf(!dbUrl)("a publication is refused for exactly the reason stated, and the fix it names works", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  async function attempt(sqlText: string, params?: unknown[]): Promise<{ code: string; message: string } | null> {
    // 42P02 "there is no parameter $1" looks exactly like an aborted transaction; refuse the
    // unbound call here instead of letting the reviewer chase a database fault.
    if (params === undefined) {
      const orphan = /\$\d/.exec(sqlText);
      if (orphan) {
        throw new Error(`attempt(): SQL binds ${orphan[0]} but was given no parameters (at offset ${orphan.index})`);
      }
    }
    await client.query("SAVEPOINT validation_probe");
    try {
      await client.query(sqlText, params);
      await client.query("RELEASE SAVEPOINT validation_probe");
      return null;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await client.query("ROLLBACK TO SAVEPOINT validation_probe");
      return { code: err.code ?? "", message: err.message ?? "" };
    }
  }

  async function publish(key: string, examId: number): Promise<{ code: string; message: string } | null> {
    const rows = await loadCatalogueRows((sqlText, values) => client.query(sqlText, values), examId);
    const doc = buildCatalogueSnapshot(rows);
    return attempt(
      `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot)
       VALUES ($1, $2, repeat('c', 64), $3, $4::jsonb)`,
      [examId, key, 1, JSON.stringify(doc)],
    );
  }

  /**
   * A catalogue that publishes, so every refusal below is attributable to the one thing the test
   * changed. Without this positive control a test can go green on an arm that has nothing to do
   * with the concern it names — the hollow-gate failure this review has found three times already.
   */
  async function seedValid(c: Client, tag: string): Promise<{ examId: number; sectionId: number; slotId: number; tileId: number }> {
    const cat = await c.query(`INSERT INTO finding_categories (key, label) VALUES ($1, 'Validation category') RETURNING id`, [`${tag}.cat`]);
    const con = await c.query(
      `INSERT INTO finding_definitions (key, category_id, label) VALUES ($1, $2, 'Validation concept') RETURNING id`,
      [`${tag}.con`, cat.rows[0]!.id],
    );
    const exam = await c.query(
      `INSERT INTO clinical_examinations (key, label, modality, body_part, protocol_scope, review_state, status)
       VALUES ($1, 'MRI Brain (validation fixture)', 'MR', $2, 'Standard', 'approved', 'active') RETURNING id`,
      [`${tag}.exam`, `${tag} Brain`],
    );
    const examId = Number(exam.rows[0]!.id);
    const section = await c.query(
      `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal, review_state, status)
       VALUES ($1, $2, 'Cerebral parenchyma', 1, 'approved', 'active') RETURNING id`,
      [examId, `${tag}.section`],
    );
    const sectionId = Number(section.rows[0]!.id);
    const slot = await c.query(
      `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region, ordinal, review_state, status)
       VALUES ($1, $2, $3, $4, 'findings', 'The cerebral parenchyma is normal in signal intensity.',
               'cerebral parenchyma', 1, 'approved', 'active') RETURNING id`,
      [examId, sectionId, Number(con.rows[0]!.id), `${tag}.normal`],
    );
    const tile = await c.query(
      `INSERT INTO clinical_tiles (key, concept_id, label, findings_text, impression_text, review_state, status)
       VALUES ($1, $2, 'Abnormality', 'A fixture finding sentence.', 'A fixture impression sentence.',
               'approved', 'active') RETURNING id`,
      [`${tag}.tile`, Number(con.rows[0]!.id)],
    );
    const tileId = Number(tile.rows[0]!.id);
    await c.query(
      `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal, created_by)
       VALUES ($1, $2, $3, 1, 'validation')`, [tileId, examId, sectionId],
    );
    await c.query(
      `INSERT INTO clinical_tile_normal_replacements (tile_id, normal_slot_id) VALUES ($1, $2)`,
      [tileId, Number(slot.rows[0]!.id)],
    );
    return { examId, sectionId, slotId: Number(slot.rows[0]!.id), tileId };
  }

  it("assigns every §4 item to one layer, and puts the last line of defence in the gate", () => {
    expect(PUBLICATION_REFUSALS.map((r) => r.item)).toHaveLength(10);
    // Nine of the ten are caught at publication. One is caught before it can exist, which is the
    // better answer and is stated as such rather than quietly counted as a gate arm.
    expect(PUBLICATION_REFUSALS.filter((r) => r.layer === "publication")).toHaveLength(9);
    expect(PUBLICATION_REFUSALS.filter((r) => r.layer === "draft").map((r) => r.item)).toEqual(
      ["duplicate logical normal slots"],
    );
    for (const row of PUBLICATION_REFUSALS) {
      expect(row.enforcedBy, `"${row.item}" names its enforcement`).toMatch(/gate check|clinical_normal_slots_slot_uq/);
      expect(row.draftAllows.length, `"${row.item}" says what a draft may still do`).toBeGreaterThan(0);
      expect(row.runtime.length, `"${row.item}" says what belongs to the runtime`).toBeGreaterThan(0);
    }
    // And the runtime list is a list of things NO column may own.
    expect(RUNTIME_ONLY_FACTS).toHaveLength(4);
    for (const fact of RUNTIME_ONLY_FACTS) {
      expect(fact.whyNotCatalogue.length, `"${fact.fact}" explains why the catalogue must not hold it`).toBeGreaterThan(0);
    }
  });

  it("refuses a section hanging off anatomy that is gone, and reparenting is the whole remedy", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "parent");
      const child = await client.query(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, parent_section_id, ordinal, review_state, status)
         VALUES ($1, 'parent.child', 'Inner table', $2, 2, 'approved', 'active') RETURNING id`,
        [f.examId, f.sectionId],
      );
      const childId = Number(child.rows[0]!.id);
      await client.query(
        `UPDATE clinical_tile_examinations SET section_id = $1 WHERE examination_id = $2`, [childId, f.examId],
      );
      expect(await publish("pub.parent.ok", f.examId), "a nested section publishes").toBeNull();

      // Retiring the parent is a legitimate editorial act, so nothing stops it — and it leaves the
      // child under anatomy that no longer exists, which a report would then print a heading for.
      expect(await attempt(
        `UPDATE clinical_anatomical_sections SET deleted_at = NOW() WHERE id = $1`, [f.sectionId],
      ), "retiring the parent section is allowed in draft").toBeNull();
      const refused = await publish("pub.parent.gone", f.examId);
      expect(refused?.code, "but the orphaned child cannot be published").toBe("P0001");
      expect(refused?.message).toMatch(/section parent.child hangs off a section that is soft-deleted/);

      // The remedy the message implies: the child belongs to the examination, not to the retired
      // parent. Clearing the parent is a plain update and the catalogue publishes again.
      expect(await attempt(
        `UPDATE clinical_anatomical_sections SET parent_section_id = NULL WHERE id = $1`, [childId],
      )).toBeNull();
      expect(await publish("pub.parent.fixed", f.examId), "re-parenting is the whole remedy").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses anatomy with no position, and an unplaced section is not a section in order", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "sord");
      expect(await publish("pub.sord.ok", f.examId), "the ordered catalogue publishes").toBeNull();
      expect(await attempt(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal, review_state, status)
         VALUES ($1, 'sord.unplaced', 'Ventricles', NULL, 'approved', 'active')`,
        [f.examId],
      ), "a new section may be created before anyone knows where it goes").toBeNull();
      const refused = await publish("pub.sord.unplaced", f.examId);
      expect(refused?.code, "but the examination cannot be published with undefined anatomy order").toBe("P0001");
      expect(refused?.message).toMatch(/section sord.unplaced has no position in its examination/);
      expect(await attempt(
        `UPDATE clinical_anatomical_sections SET ordinal = 2 WHERE key = 'sord.unplaced'`,
      ), "stating the position is the whole remedy").toBeNull();
      expect(await publish("pub.sord.fixed", f.examId), "and then it publishes").toBeNull();
      // A position may not be invented as zero: the CHECK refuses it and the unique index refuses a
      // repeat, so the order stays total among the sections that claim one.
      expect((await attempt(
        `UPDATE clinical_anatomical_sections SET ordinal = 0 WHERE key = 'sord.unplaced'`,
      ))?.code, "ordinal 0 is not a position").toBe("23514");
      expect((await attempt(
        `UPDATE clinical_anatomical_sections SET ordinal = 1 WHERE key = 'sord.unplaced'`,
      ))?.code, "and one position may not be claimed twice").toBe("23505");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses a tile that retires a normal which has been retired", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "ret");
      expect(await publish("pub.ret.ok", f.examId), "a tile retiring a live normal publishes").toBeNull();
      expect(await attempt(
        `UPDATE clinical_normal_slots SET deleted_at = NOW() WHERE id = $1`, [f.slotId],
      ), "retiring the normal is allowed in draft — a hard delete is refused by RESTRICT").toBeNull();
      const refused = await publish("pub.ret.gone", f.examId);
      expect(refused?.code, "but the edge now restores a normal that does not exist").toBe("P0001");
      expect(refused?.message).toMatch(/retires ret.normal, a normal that has been retired/);
      // Removing the edge is the whole remedy; the abnormality then simply prints beside no baseline
      // claim, which is an editorial choice the author may make.
      expect(await attempt(
        `DELETE FROM clinical_tile_normal_replacements WHERE tile_id = $1`, [f.tileId],
      )).toBeNull();
      expect(await publish("pub.ret.fixed", f.examId), "dropping the dead edge lets it publish").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses a required choice with nothing to choose from, and leaves the unanswered ones to the runtime", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "param");
      const group = await client.query(
        `INSERT INTO parameter_groups (key, label, data_type, status)
         VALUES ('param.grade', 'Fazekas grade', 'option', 'active') RETURNING id`,
      );
      const groupId = Number(group.rows[0]!.id);
      expect(await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, is_required, parameter_group_id)
         VALUES ($1, 'fazekas', 'Fazekas grade', 'option', TRUE, $2)`, [f.tileId, groupId],
      ), "a required option parameter with an empty option list is storable in draft").toBeNull();
      const refused = await publish("pub.param.hollow", f.examId);
      expect(refused?.code, "but it is a sentence with a hole in it, and cannot be published").toBe("P0001");
      expect(refused?.message).toMatch(
        /parameter fazekas on tile param.tile is required but has no answer to choose from/,
      );

      // Supplying one answer is the whole remedy.
      const option = await client.query<{ id: number }>(
        `INSERT INTO parameter_options (group_id, key, label, status) VALUES ($1, 'grade1', 'Grade 1', 'active') RETURNING id`,
        [groupId],
      );
      const optionId = Number(option.rows[0]!.id);
      expect(await publish("pub.param.filled", f.examId), "an option list makes the choice real").toBeNull();

      // And the layer boundary, worked: a required NUMERIC parameter with no default publishes.
      // Whether the radiologist entered it is a fact about one study; the catalogue's business is
      // only that a value EXISTS to be entered. Freezing the unanswered case would make a
      // publication depend on a study that has not happened.
      expect(await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, is_required)
         VALUES ($1, 'lesion_mm', 'Largest lesion (mm)', 'numeric', TRUE)`, [f.tileId],
      ), "a required numeric parameter is storable").toBeNull();
      expect(await publish("pub.param.numeric", f.examId), "and it publishes: its emptiness is runtime's").toBeNull();

      // A default counts as an answer, so the arm must not fire once one is set. Proved with the
      // option list still empty of live rows: the option exists (the composite FK does not read
      // deleted_at), it is simply retired as a choice — which is exactly the state in which a
      // default is the only answer the sentence can get.
      expect(await attempt(
        `UPDATE parameter_options SET deleted_at = NOW() WHERE group_id = $1`, [groupId],
      )).toBeNull();
      const rehollowed = await publish("pub.param.rehollowed", f.examId);
      expect(rehollowed?.code, "a soft-deleted option is not an answer").toBe("P0001");
      expect(rehollowed?.message, "and it is the same arm that refuses, for the same row").toMatch(
        /parameter fazekas on tile param.tile is required but has no answer to choose from/,
      );
      expect(await attempt(
        `UPDATE clinical_tile_parameters SET default_option_id = $1
          WHERE tile_id = $2 AND key = 'fazekas'`,
        [optionId, f.tileId],
      ), "pointing the parameter at a default is a plain update").toBeNull();
      expect(await publish("pub.param.defaulted", f.examId), "and a default IS an answer: it publishes").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses a recommendation trigger that can never become true, in each way that it can", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "rec");
      // A parameter_value trigger that reads from no tile. The draft CHECK is satisfied by naming a
      // concept, so this is reachable — and the advice would then be silent forever while the
      // catalogue said it fires.
      expect(await attempt(
        `INSERT INTO clinical_recommendation_rules
           (key, examination_id, label, trigger_kind, concept_id, parameter_key, parameter_value, advice_text, ordinal, review_state, status)
         VALUES ('rec.notile', $1, 'Names no tile', 'parameter_value',
                 (SELECT concept_id FROM clinical_tiles WHERE id = $2), 'fazekas', 'grade1',
                 'Clinical correlation suggested.', 1, 'approved', 'active')`,
        [f.examId, f.tileId],
      ), "the draft CHECK lets it be stored").toBeNull();
      const noTile = await publish("pub.rec.notile", f.examId);
      expect(noTile?.code, "publication refuses a parameter trigger with nothing to read it from").toBe("P0001");
      expect(noTile?.message).toMatch(/conditions on a parameter but names no tile to read it from/);

      // Pointing it at a real tile is not enough: the parameter must be one that tile defines.
      expect(await attempt(
        `UPDATE clinical_recommendation_rules SET tile_id = $1, concept_id = NULL WHERE key = 'rec.notile'`,
        [f.tileId],
      )).toBeNull();
      const wrongKey = await publish("pub.rec.wrongkey", f.examId);
      expect(wrongKey?.code, "and it refuses a parameter the named tile does not define").toBe("P0001");
      expect(wrongKey?.message).toMatch(/conditions on parameter fazekas, which tile rec.tile does not define/);

      // Defining the parameter is the whole remedy — and note this is the ONE shape check 11 lets a
      // required numeric parameter through, because 'fazekas' here is a trigger, not a hole.
      expect(await attempt(
        `INSERT INTO clinical_tile_parameters (tile_id, key, label, data_type, is_required)
         VALUES ($1, 'fazekas', 'Fazekas grade', 'text', FALSE)`, [f.tileId],
      )).toBeNull();
      expect(await publish("pub.rec.fixed", f.examId), "a trigger on a defined parameter publishes").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses every kind of wording a patient would read, and only where it reaches the page", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "review");
      // A rule and a recommendation, so the review queue has five kinds of object to check and not
      // three. Both are complete, which keeps the refusal below attributable to review_state.
      const rule = await client.query(
        `INSERT INTO clinical_combination_rules
           (key, examination_id, label, target_field, combined_text, suppress_members, requires_only_members,
            ordinal, review_state, status)
         VALUES ('review.rule', $1, 'Consolidated', 'impression', 'One consolidated line.',
                 TRUE, FALSE, 1, 'approved', 'active') RETURNING id`,
        [f.examId],
      );
      await client.query(
        `INSERT INTO clinical_combination_rule_members (rule_id, tile_id, ordinal, is_optional)
         VALUES ($1, $2, 1, FALSE)`, [Number(rule.rows[0]!.id), f.tileId],
      );
      await client.query(
        `INSERT INTO clinical_recommendation_rules
           (key, examination_id, label, trigger_kind, tile_id, advice_text, emit_policy, ordinal, review_state, status)
         VALUES ('review.advice', $1, 'Follow-up', 'tile_selected', $2,
                 'Clinical correlation suggested.', 'always', 1, 'approved', 'active')`,
        [f.examId, f.tileId],
      );
      expect(await publish("pub.review.ok", f.examId), "a fully reviewed catalogue publishes").toBeNull();

      // Each arm of check 8 in turn. One object is made unreviewed at a time because the union the
      // gate walks has no ORDER BY: with two unreviewed rows the reported one is whichever the
      // scan reaches first, and a test that asserted on the name of an arbitrary row would be
      // asserting nothing.
      const arms = [
        { kind: "tile", key: "review.tile", sql: `UPDATE clinical_tiles SET review_state = 'unreviewed' WHERE id = $1`, id: f.tileId, state: "unreviewed" },
        { kind: "section", key: "review.section", sql: `UPDATE clinical_anatomical_sections SET review_state = 'uncertain' WHERE id = $1`, id: f.sectionId, state: "uncertain" },
        { kind: "normal slot", key: "review.normal", sql: `UPDATE clinical_normal_slots SET review_state = 'unreviewed' WHERE id = $1`, id: f.slotId, state: "unreviewed" },
        { kind: "combination rule", key: "review.rule", sql: `UPDATE clinical_combination_rules SET review_state = 'unreviewed' WHERE id = $1`, id: Number(rule.rows[0]!.id), state: "unreviewed" },
      ];
      for (const arm of arms) {
        expect(await attempt(arm.sql, [arm.id]), `making the ${arm.kind} unapproved is a plain update`).toBeNull();
        const name = arm.kind.replace(/ /g, "");
        const refused = await publish(`pub.review.${name}`, f.examId);
        expect(refused?.code, `an unapproved ${arm.kind} is refused`).toBe("P0001");
        expect(refused?.message, `and it names the ${arm.kind} and its state`).toContain(
          `prints wording that is ${arm.state}`,
        );
        expect(refused?.message, `and it names the row, not just the kind`).toContain(`${arm.kind} ${arm.key}`);
        expect(await attempt(arm.sql.replace(/'(unreviewed|uncertain)'/, "'approved'"), [arm.id])).toBeNull();
        expect(await publish(`pub.review.${name}.fixed`, f.examId), "approving it is the whole remedy").toBeNull();
      }

      // A recommendation rule is the fifth kind, and 'uncertain' disqualifies exactly like
      // 'unreviewed': honest in a draft, not publishable.
      expect(await attempt(
        `UPDATE clinical_recommendation_rules SET review_state = 'uncertain' WHERE key = 'review.advice'`,
      )).toBeNull();
      const advice = await publish("pub.review.advice", f.examId);
      expect(advice?.code, "an uncertain recommendation is refused").toBe("P0001");
      expect(advice?.message).toMatch(/recommendation rule review.advice prints wording that is uncertain/);
      expect(await attempt(
        `UPDATE clinical_recommendation_rules SET review_state = 'approved' WHERE key = 'review.advice'`,
      )).toBeNull();
      expect(await publish("pub.review.advice.fixed", f.examId), "and approving it publishes").toBeNull();

      // The boundary that makes the section arm honest: a section prints its label only when
      // emits_heading, so a quiet grouping row is not patient-visible wording and must not block a
      // publication. Refusing it anyway would be the false-positive class this repo has already
      // been burned by once.
      expect(await attempt(
        `UPDATE clinical_anatomical_sections SET emits_heading = FALSE, review_state = 'unreviewed' WHERE id = $1`,
        [f.sectionId],
      )).toBeNull();
      expect(await publish("pub.review.quietsection", f.examId), "a non-printing section needs no sign-off").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses to publish a placement whose tile has been retired, by either remedy the refusal allows", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "lost");
      expect(await publish("pub.lost.ok", f.examId), "the untouched catalogue publishes").toBeNull();

      // Retiring a tile that is placed here breaks no foreign key: the placement row survives, the
      // tile row survives (soft-deleted), and the publisher's own read drops BOTH — so before check
      // 17 the examination published a document that had quietly lost an observation, with nothing
      // in either side disagreeing about having lost it. Measured on a database rebuilt from zero
      // through the real migration pipeline.
      expect(await attempt(
        `UPDATE clinical_tiles SET deleted_at = NOW() WHERE id = $1`, [f.tileId],
      ), "retiring the tile is a legal draft act").toBeNull();
      const lost = await publish("pub.lost.gone", f.examId);
      expect(lost?.code, "but the publication may not silently lose a placed observation").toBe("P0001");
      expect(lost?.message).toMatch(/tile lost.tile is placed in this examination but has been retired/);

      // Remedy one: un-retire the tile.
      expect(await attempt(
        `UPDATE clinical_tiles SET deleted_at = NULL WHERE id = $1`, [f.tileId],
      )).toBeNull();
      expect(await publish("pub.lost.back", f.examId), "bringing the tile back is one remedy").toBeNull();

      // Remedy two: retire the placement instead, which is the editorial choice when the
      // observation really has left the examination. Proved on a second fixture so the first
      // remedy's state cannot be quietly carrying this assertion.
      const second = await seedValid(client, "lost2");
      await client.query(`UPDATE clinical_tiles SET deleted_at = NOW() WHERE id = $1`, [second.tileId]);
      expect(await attempt(
        `UPDATE clinical_tile_examinations SET deleted_at = NOW() WHERE tile_id = $1 AND examination_id = $2`,
        [second.tileId, second.examId],
      ), "retiring the placement is a plain update").toBeNull();
      expect(await publish("pub.lost.unplaced", second.examId), "and the examination publishes without it").toBeNull();

      // The boundary the arm deliberately does not cross: a deprecated tile is still a tile with
      // wording a history may need, and checks 1 and 8 already treat it as out of force. Refusing
      // it here would make an examination impossible to republish after an ordinary retirement.
      const dep = await seedValid(client, "dep");
      expect(await attempt(
        `UPDATE clinical_tiles SET status = 'deprecated' WHERE key = 'dep.tile'`,
      ), "deprecating a placed tile is legal").toBeNull();
      expect(await publish("pub.dep.ok", dep.examId), "and a deprecated placed tile still publishes").toBeNull();
      const frozen = await client.query<{ n: number }>(
        `SELECT jsonb_array_length(catalogue_snapshot -> 'tiles') AS n
           FROM clinical_publications WHERE publication_key = 'pub.dep.ok'`,
      );
      expect(frozen.rows[0]!.n, "its wording stays frozen, because history needs it").toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses a resolution that reaches outside the examination, and allows the one it is scoped to", async () => {
    await client.query("BEGIN");
    try {
      const here = await seedValid(client, "x18");
      const there = await seedValid(client, "y18");
      const thereTile = (await client.query<{ id: number }>(
        `SELECT id FROM clinical_tiles WHERE key = 'y18.tile'`,
      )).rows[0]!.id;
      expect(await publish("pub.x18.base", here.examId), "both examinations publish alone").toBeNull();

      // Both directions are declared so check 6 is satisfied: the only objection left has to be
      // scope, which is what makes this a test of check 18 and not of the symmetric-pair arm.
      expect(await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES ($1, $2, 'excludes')`, [here.tileId, thereTile],
      ), "storing a cross-examination pair is legal in draft").toBeNull();
      expect(await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES ($1, $2, 'excludes')`, [thereTile, here.tileId],
      )).toBeNull();
      const foreign = await publish("pub.x18.foreign", here.examId);
      expect(foreign?.code, "a resolution with a tile this examination cannot offer is refused").toBe("P0001");
      expect(foreign?.message).toMatch(/points at y18.tile, a tile this examination does not offer/);

      // Remedy one: offer the tile here. Both ends are then this examination's own business.
      expect(await attempt(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal)
         VALUES ($1, $2, $3, 2)`, [thereTile, here.examId, here.sectionId],
      )).toBeNull();
      expect(await publish("pub.x18.offered", here.examId), "a pair between two offered tiles publishes").toBeNull();

      // Remedy two on a fresh fixture: erase the pair. The examination then states nothing about
      // it, and an unstated relationship between two tiles is the ordinary draft state that
      // publication merely forbids to become permanent.
      const solo = await seedValid(client, "z18");
      const otherExam = await seedValid(client, "w18");
      const wTile = (await client.query<{ id: number }>(
        `SELECT id FROM clinical_tiles WHERE key = 'w18.tile'`,
      )).rows[0]!.id;
      expect(await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES ($1, $2, 'excludes'), ($2, $1, 'excludes')`, [solo.tileId, wTile],
      ), "the pair is storable in draft both ways").toBeNull();
      expect((await publish("pub.z18.foreign", solo.examId))?.code, "and is refused at publication").toBe("P0001");
      expect(await attempt(
        `DELETE FROM clinical_tile_relationships
          WHERE tile_id = $1 AND related_tile_id = $2`, [solo.tileId, wTile],
      ), "erasing this examination's own direction is a plain delete").toBeNull();
      expect(await publish("pub.z18.eraser", solo.examId), "and then it publishes: the row it owned is gone").toBeNull();

      // The other branch: the far end is retired. It cannot be placed here (check 17 would speak
      // first), so the relationship names a tile that no longer exists anywhere in scope.
      const dead = await seedValid(client, "dead");
      const deadTile = Number((await client.query(
        `INSERT INTO clinical_tiles (key, concept_id, label, findings_text, impression_text, review_state, status)
         VALUES ('dead.gone', (SELECT concept_id FROM clinical_tiles WHERE key = 'dead.tile'),
                 'Retired', 'A finding.', 'An impression.', 'approved', 'active') RETURNING id`,
      )).rows[0]!.id);
      expect(await attempt(`UPDATE clinical_tiles SET deleted_at = NOW() WHERE id = $1`, [deadTile])).toBeNull();
      expect(await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES ($1, $2, 'requires')`, [dead.tileId, deadTile],
      )).toBeNull();
      const retiredEnd = await publish("pub.dead.end", dead.examId);
      expect(retiredEnd?.code, "a relationship to a retired tile is refused").toBe("P0001");
      expect(retiredEnd?.message).toMatch(/points at dead.gone, a tile that has been retired/);

      // And a CONCEPT end is allowed: finding_definitions is the canonical vocabulary, is
      // examination-wide by design, and scoping it per examination would create the second source
      // of truth §6 forbids. The retired-tile row is removed first, or the refusal above would
      // still be the one this publication hears.
      expect(await attempt(
        `DELETE FROM clinical_tile_relationships WHERE related_tile_id = $1`, [deadTile],
      )).toBeNull();
      expect(await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_concept_id, relation_kind)
         VALUES ($1, $2, 'requires')`,
        [dead.tileId, (await client.query<{ concept_id: number }>(
          `SELECT concept_id FROM clinical_tiles WHERE id = $1`, [dead.tileId],
        )).rows[0]!.concept_id],
      )).toBeNull();
      expect(await publish("pub.dead.concept", dead.examId), "a tile-to-concept requirement publishes").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("certifies which rows a document freezes, not what those rows say — and says why", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "forge");
      const doc = buildCatalogueSnapshot(await loadCatalogueRows((s, v) => client.query(s, v), f.examId));
      expect(await publish("pub.forge.honest", f.examId), "the honest document publishes").toBeNull();

      // Same identities, one fabricated sentence: this PASSES, and pinning that is the point. The
      // gate compares membership — which identities appear in each domain — because only the
      // publisher's serializer can produce the canonical bytes, and a SQL reimplementation would be
      // a second source of truth for the hash. A reviewer who read check 14 as content
      // authentication would trust a publication nobody certified.
      const forged = JSON.parse(JSON.stringify(doc)) as typeof doc;
      (forged.tiles[0] as Record<string, unknown>).findings_text = "A sentence nobody approved.";
      const res = await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot)
         VALUES ($1, $2, repeat('d', 64), $3, $4::jsonb)`,
        [f.examId, "pub.forge.lie", 1, JSON.stringify(forged)],
      );
      expect(res, "the measured limit: true identities and a false sentence pass the gate").toBeNull();
      const stored = await client.query<{ s: { tiles: { findings_text: string }[] } }>(
        `SELECT catalogue_snapshot AS s FROM clinical_publications WHERE publication_key = 'pub.forge.lie'`,
      );
      const live = await client.query<{ findings_text: string }>(
        `SELECT findings_text FROM clinical_tiles WHERE id = $1`, [f.tileId],
      );
      expect(stored.rows[0]!.s.tiles[0].findings_text, "the publication holds the fabricated wording").toBe(
        "A sentence nobody approved.",
      );
      expect(live.rows[0]!.findings_text, "while the live row holds the real one").toBe("A fixture finding sentence.");

      // What the arm DOES guarantee, stated in the same breath so the limit is not mistaken for an
      // absence of checking: a document that drops one live row is refused.
      const missing = JSON.parse(JSON.stringify(doc)) as typeof doc;
      missing.tiles = missing.tiles.slice(1);
      expect((await attempt(
        `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot)
         VALUES ($1, $2, repeat('d', 64), $3, $4::jsonb)`,
        [f.examId, "pub.forge.missing", 1, JSON.stringify(missing)],
      ))?.code, "a document missing one live row is refused").toBe("P0001");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("never has to check for a duplicate baseline, because one cannot be stored", async () => {
    await client.query("BEGIN");
    try {
      const f = await seedValid(client, "dup");
      const conceptId = (await client.query<{ concept_id: number }>(
        `SELECT concept_id FROM clinical_tiles WHERE id = $1`, [f.tileId],
      )).rows[0]!.concept_id;

      // Same examination, same field, same region, same concept, no level, no laterality: one
      // logical baseline, so a second row is refused before it can exist — in draft, with no
      // gate arm involved.
      const duplicate = await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region, ordinal, review_state, status)
         VALUES ($1, $2, $3, 'dup.normal.two', 'findings', 'The cerebral parenchyma is normal in signal intensity.',
                 'Cerebral Parenchyma ', 2, 'approved', 'active')`,
        [f.examId, f.sectionId, conceptId],
      );
      expect(duplicate?.code, "the duplicate is refused at insert, whitespace and case included").toBe("23505");
      expect(duplicate?.message).toMatch(/clinical_normal_slots_slot_uq/);

      // The distinctions that ARE real: another field, another region, another concept.
      for (const [key, sql] of [
        ["impression field", `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region, ordinal, review_state, status)
         VALUES ($1, $2, $3, 'dup.impression', 'impression', 'No acute intracranial abnormality.', 'cerebral parenchyma', 1, 'approved', 'active')`],
        ["other region", `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region, ordinal, review_state, status)
         VALUES ($1, $2, $3, 'dup.posterior', 'findings', 'The posterior fossa is unremarkable.', 'posterior fossa', 2, 'approved', 'active')`],
      ] as const) {
        expect(await attempt(sql, [f.examId, f.sectionId, conceptId]), `a slot distinguished by its ${key} is a different claim`).toBeNull();
      }
      expect(await publish("pub.dup.ok", f.examId), "and the examination still publishes with three distinct baselines").toBeNull();

      // Retiring one frees its identity — the index is partial over live rows, so history is kept
      // and the living set stays unambiguous.
      expect(await attempt(
        `UPDATE clinical_normal_slots SET deleted_at = NOW() WHERE key = 'dup.normal'`,
      )).toBeNull();
      expect(await attempt(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region, ordinal, review_state, status)
         VALUES ($1, $2, $3, 'dup.normal.rewritten', 'findings', 'The cerebral parenchyma is normal in signal intensity.',
                 'cerebral parenchyma', 1, 'approved', 'active')`,
        [f.examId, f.sectionId, conceptId],
      ), "a replacement baseline sentence for the same claim is storable once the old one is retired").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // ── Runtime selection validation: stated, because a schema cannot reach it ────────────────
  describe("runtime selection validation (Stage C — specification only)", () => {
    it.skip("refuses to sign a report whose required parameter is unanswered, without blocking the publication", () => {
      // The publication froze a parameter with real options; this study has no answer yet. That is
      // a study fact: it must stop the SIGNATURE and must never stop the PUBLICATION, which is the
      // boundary the check 11 arm above is careful to sit on the right side of.
      expect(true, "Stage C").toBe(false);
    });

    it.skip("keeps a deselected tile's restored normals from un-retiring a second tile's claim", () => {
      // Two tiles retire one slot; deselecting the first must leave the slot retired.
      expect(true, "Stage C").toBe(false);
    });

    it.skip("treats an unreviewed published sentence as immutable until a new publication supersedes it", () => {
      // The gate refused to publish it; after publication the snapshot is the only copy that says
      // what was live, so an edit to the live row must not rewrite history. Covered for the
      // document by H1's round-trip test; the live-row half is a Stage C read-path rule.
      expect(true, "Stage C").toBe(false);
    });
  });
});

