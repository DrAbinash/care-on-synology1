/**
 * SELECTION-STATE CONTRACT — care-v4 Stage B hardening, §2 of the architectural brief.
 *
 * WHAT THIS FILE IS
 * -----------------
 * A contract Stage C has to satisfy, written so that the parts the database can already enforce
 * are executed here and the parts that need a composer are stated as skipped tests with a checkable
 * sentence. It is not a composer, and it does not pretend to test one: no report is composed, no
 * runtime selection state is stored, and nothing here runs in the clinic.
 *
 * WHY IT EXISTS AT ALL
 * --------------------
 * PR #1014 measured nine pairs of shipped MRI Brain tiles that print different clinical content
 * depending on which was clicked first, on `origin/main` = `1841668b`. Every one of them is the
 * same underlying hole: the catalogue has no place to record what should happen when two tiles are
 * selected together, so the answer falls out of the merge code's order of operations. A schema
 * cannot fix a runtime, but it can refuse to publish a configuration whose answer is unstated —
 * which is what check 6 and check 7 of clinical_publication_gate() now do, and what this file
 * proves they do.
 *
 * THE STATEMENTS THAT TURN OUT TO BE DATABASE FACTS, MEASURED HERE
 * ---------------------------------------------------------------
 *   • an unresolved pair is not publishable, in either direction of "unresolved";
 *   • "these two deliberately coexist" is a row, not an absence — so the absence of a row can no
 *     longer be read as a decision, which is precisely how the nine pairs survived;
 *   • a baseline normal is retired by an edge, never by prose, so deselecting has exactly one
 *     restore set;
 *   • which tiles compete (resolution) and which tile prints first (order) are stored in different
 *     columns and changing one provably leaves the other byte-identical.
 *
 * THE ONE LIMIT WORTH STATING RATHER THAN HIDING
 * ---------------------------------------------
 * The gate resolves a pair when the pair is *named*: inside a conflict group, or by an explicit
 * relationship row. Two tiles in different groups with no row between them are not "declared
 * compatible" — they are undeclared, and no finite set of rows can enumerate every pair in an
 * examination. So the runtime rule Stage C must implement is the default, and it is stated as a
 * skipped test below: an undeclared pair prints both and evicts neither.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { buildCatalogueSnapshot, canonicalize, loadCatalogueRows } from "../cataloguePublicationSnapshot";

const dbUrl = process.env.DATABASE_URL;

/**
 * The seven states §2 of the brief names. `enforcedBy` is the object that makes the state a fact
 * rather than an intention; `stage` says who has to act. A state whose enforcement is "Stage C"
 * is not a defect in Stage B — it is a state the database cannot see, and pretending otherwise
 * would be the kind of confident wrong verdict this review has been chasing.
 */
const SELECTION_STATES = [
  {
    state: "A",
    name: "selected",
    radiologistDid: "clicked a tile, so its observation is part of the report",
    catalogueSays: "the tile is placed in the examination with an ordinal (clinical_tile_examinations)",
    enforcedBy: "clinical_tile_examinations + clin_tile_exam_uq + clin_tile_exam_ordinal_uq",
    stage: "B",
  },
  {
    state: "B",
    name: "explicitly deselected",
    radiologistDid: "clicked it again; the observation leaves the report",
    catalogueSays: "nothing — deselection is a study-level act, not a catalogue edit",
    enforcedBy: "the tile's normal-replacement edge set, which IS the restore set",
    stage: "C",
  },
  {
    state: "C",
    name: "mutually exclusive replacement",
    radiologistDid: "selected the second of two tiles that cannot both be true",
    catalogueSays: "'excludes' declared in BOTH directions, or 'supersedes' in the one direction that names the winner",
    enforcedBy: "clinical_tile_relationships + gate check 6 (a one-directional symmetric pair is refused)",
    stage: "B",
  },
  {
    state: "D",
    name: "compatible simultaneous",
    radiologistDid: "selected two findings that are both true at once",
    catalogueSays: "'coexists' in BOTH directions (or 'combines_with'), which is a stated decision",
    enforcedBy: "gate check 7 (a conflict-group pair with nothing declared is refused)",
    stage: "B",
  },
  {
    state: "E",
    name: "parent-child",
    radiologistDid: "selected a child finding whose meaning depends on its parent",
    catalogueSays: "'parent_child' from child to parent; a cycle among directional kinds is refused",
    enforcedBy: "gate check 13 (no composition order exists for a cycle)",
    stage: "B",
  },
  {
    state: "F",
    name: "normal suppression",
    radiologistDid: "selected an abnormality that makes one baseline sentence false",
    catalogueSays: "clinical_tile_normal_replacements: tile → the ONE slot whose normal it retires",
    enforcedBy: "the edge table, its composite FKs, and gate checks 4 and 10",
    stage: "B",
  },
  {
    state: "G",
    name: "explicit radiologist override",
    radiologistDid: "typed over what the catalogue produced, or kept a finding the rules retire",
    catalogueSays: "nothing, deliberately: an override is a fact about a study, not about the catalogue",
    enforcedBy: "no catalogue column exists; Stage C must record it beside the observation ledger",
    stage: "C",
  },
] as const;

/**
 * PR #1014's register, copied from artifacts/diagnostic-erp/src/lib/quickSelectClickOrderCensus.test.ts
 * on refs/remotes/prx/1014 (nine pairs, measured 2026-10-15). Each entry carries the resolution
 * this contract requires, and whether the clinical *wording* of that resolution still needs the
 * radiologist's sign-off — which is a separate question from the mechanism, and the brief asks for
 * both to be distinguishable.
 */
const ORDER_DEPENDENT_PAIRS = [
  { left: "Normal brain parenchyma (brain_parenchyma)", right: "Cerebral edema (edema)", resolution: "F", wording: "ratified" },
  { left: "Normal brain parenchyma (brain_parenchyma)", right: "Demyelinating lesion (demyelinating)", resolution: "F", wording: "ratified" },
  { left: "Normal brain parenchyma (brain_parenchyma)", right: "Fazekas 1 (fazekas)", resolution: "F", wording: "ratified" },
  { left: "Normal brain parenchyma (brain_parenchyma)", right: "Fazekas 2 (fazekas)", resolution: "F", wording: "ratified" },
  { left: "Normal brain parenchyma (brain_parenchyma)", right: "Fazekas 3 (fazekas)", resolution: "F", wording: "ratified" },
  { left: "Normal brain parenchyma (brain_parenchyma)", right: "Lacunar infarcts (lacunar)", resolution: "F", wording: "ratified" },
  { left: "Normal brain parenchyma (brain_parenchyma)", right: "Subarachnoid hemorrhage (subarachnoid hemorrhage)", resolution: "F", wording: "ratified" },
  { left: "Normal ventricles (ventricular)", right: "Hydrocephalus (hydrocephalus)", resolution: "F", wording: "ratified" },
  // The only pair in the register that is not a normal versus an abnormal. Whether a recurrent
  // glioma and cerebral edema are both stated, or edema is folded into the tumour line, is a
  // radiologist's call — the mechanism below declares 'coexists' because printing both is the
  // conservative answer, and the wording is explicitly awaiting review.
  { left: "Glioma recurrence (tumor recurrence)", right: "Cerebral edema (edema)", resolution: "D", wording: "awaiting radiologist review" },
] as const;

const ABNORMAL_TILES = [
  "edema", "demyelinating", "fazekas1", "fazekas2", "fazekas3", "lacunar",
  "subarachnoid", "hydrocephalus", "tumor_recurrence",
] as const;

describe.skipIf(!dbUrl)("the selection-state contract is expressible, and the ambiguous cases are refused", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  async function attempt(sqlText: string, params?: unknown[]): Promise<{ code: string; message: string } | null> {
    // A placeholder with no bind parameter is refused by Postgres as 42P02 "there is no parameter
    // $1", which reads like a broken transaction and sends the reviewer hunting a database fault
    // that does not exist. The bug is in the caller, so fail where it was made.
    if (params === undefined) {
      const orphan = /\$\d/.exec(sqlText);
      if (orphan) {
        throw new Error(`attempt(): SQL binds ${orphan[0]} but was given no parameters (at offset ${orphan.index})`);
      }
    }
    await client.query("SAVEPOINT contract_probe");
    try {
      await client.query(sqlText, params);
      await client.query("RELEASE SAVEPOINT contract_probe");
      return null;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await client.query("ROLLBACK TO SAVEPOINT contract_probe");
      return { code: err.code ?? "", message: err.message ?? "" };
    }
  }

  async function publish(key: string, examId: number): Promise<{ code: string; message: string } | null> {
    const rows = await loadCatalogueRows((sqlText, values) => client.query(sqlText, values), examId);
    const doc = buildCatalogueSnapshot(rows);
    return attempt(
      `INSERT INTO clinical_publications (examination_id, publication_key, content_hash, snapshot_version, catalogue_snapshot)
       VALUES ($1, $2, repeat('a', 64), $3, $4::jsonb)`,
      [examId, key, 1, JSON.stringify(doc)],
    );
  }

  /**
   * The nine register tiles, the two baseline normals they bear on, and the declared resolutions.
   * Built as data because the point of the contract is that the resolution lives in the catalogue,
   * not in whichever sentence the merge code reaches first.
   */
  async function seedBrainSelectionFixture(c: Client, tag: string): Promise<number> {
    const category = await c.query(
      `INSERT INTO finding_categories (key, label) VALUES ($1, 'Contract category') RETURNING id`, [`${tag}.cat`],
    );
    const concept = await c.query(
      `INSERT INTO finding_definitions (key, category_id, label) VALUES ($1, $2, 'Contract concept') RETURNING id`,
      [`${tag}.con`, category.rows[0]!.id],
    );
    const conceptId = Number(concept.rows[0]!.id);
    const exam = await c.query(
      `INSERT INTO clinical_examinations (key, label, modality, body_part, protocol_scope, review_state, status)
       VALUES ($1, 'MRI Brain (contract fixture)', 'MR', $2, 'Standard', 'approved', 'active') RETURNING id`,
      [`${tag}.exam`, `${tag} Brain`],
    );
    const examId = Number(exam.rows[0]!.id);
    const sections: Record<string, number> = {};
    for (const [i, key] of ["parenchyma", "ventricles"].entries()) {
      const s = await c.query(
        `INSERT INTO clinical_anatomical_sections (examination_id, key, label, ordinal, review_state, status)
         VALUES ($1, $2, $3, $4, 'approved', 'active') RETURNING id`,
        [examId, `${tag}.${key}`, key === "parenchyma" ? "Cerebral parenchyma" : "Ventricles", i + 1],
      );
      sections[key] = Number(s.rows[0]!.id);
    }
    // Two baseline normals. Their identity is the runtime's own slot identity, so a section cannot
    // make two rows out of one claim or one row out of two claims.
    const slots: Record<string, number> = {};
    for (const [key, region, slotSection] of [
      ["normal.parenchyma", "cerebral parenchyma", sections.parenchyma],
      ["normal.ventricles", "ventricles", sections.ventricles],
    ] as const) {
      const n = await c.query(
        `INSERT INTO clinical_normal_slots (examination_id, section_id, concept_id, key, slot_field, rendered_text, region, ordinal, review_state, status)
         VALUES ($1, $2, $3, $4, 'findings', $5, $6, 1, 'approved', 'active') RETURNING id`,
        [examId, slotSection, conceptId, `${tag}.${key}`,
          key.endsWith("parenchyma")
            ? "The cerebral parenchyma is normal in signal intensity."
            : "The ventricles are normal in size and configuration.",
          region],
      );
      slots[key] = Number(n.rows[0]!.id);
    }
    const tiles: Record<string, number> = {};
    for (const [i, key] of ABNORMAL_TILES.entries()) {
      const Fazekas = /^fazekas/.test(key);
      const t = await c.query(
        `INSERT INTO clinical_tiles (key, concept_id, label, findings_text, impression_text, conflict_group, review_state, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', 'active') RETURNING id`,
        [
          `${tag}.tile.${key}`, conceptId, key,
          `A fixture sentence for ${key}.`, `A fixture impression for ${key}.`,
          Fazekas ? `${tag}.fazekas` : `${tag}.${key}`,
        ],
      );
      tiles[key] = Number(t.rows[0]!.id);
      await c.query(
        `INSERT INTO clinical_tile_examinations (tile_id, examination_id, section_id, ordinal, created_by)
         VALUES ($1, $2, $3, $4, 'contract')`,
        [tiles[key], examId, key === "hydrocephalus" ? sections.ventricles : sections.parenchyma, i + 1],
      );
    }
    // F — each abnormal retires exactly one baseline normal, by edge.
    for (const key of ABNORMAL_TILES) {
      const slot = key === "hydrocephalus" ? slots["normal.ventricles"] : slots["normal.parenchyma"];
      await c.query(
        `INSERT INTO clinical_tile_normal_replacements (tile_id, normal_slot_id) VALUES ($1, $2)`,
        [tiles[key], slot],
      );
    }
    // C — the three grades cannot all be true; declared in both directions, because a
    // one-directional 'excludes' is a rule whose winner depends on the visit order.
    const grades = ["fazekas1", "fazekas2", "fazekas3"];
    for (const a of grades) for (const b of grades) {
      if (a === b) continue;
      await c.query(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind) VALUES ($1, $2, 'excludes')`,
        [tiles[a], tiles[b]],
      );
    }
    // D — recurrence and edema are stated to coexist rather than left undeclared.
    for (const [a, b] of [["tumor_recurrence", "edema"], ["edema", "tumor_recurrence"]] as const) {
      await c.query(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind) VALUES ($1, $2, 'coexists')`,
        [tiles[a], tiles[b]],
      );
    }
    return examId;
  }

  it("states every one of the seven selection states, and which of them the database can already see", () => {
    expect(SELECTION_STATES.map((s) => s.state)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    // Four of the seven are enforced by the schema today. Two are study-level facts the catalogue
    // must not try to own. Saying which is which is the difference between a contract and a wish.
    expect(SELECTION_STATES.filter((s) => s.stage === "B").map((s) => s.state)).toEqual(["A", "C", "D", "E", "F"]);
    expect(SELECTION_STATES.filter((s) => s.stage === "C").map((s) => s.state)).toEqual(["B", "G"]);
    for (const state of SELECTION_STATES) {
      expect(state.catalogueSays.length, `${state.state} says what the catalogue holds`).toBeGreaterThan(0);
      expect(state.enforcedBy.length, `${state.state} names what enforces it`).toBeGreaterThan(0);
    }
  });

  it("refuses to publish a pair whose resolution nobody declared, in either direction of undeclared", async () => {
    await client.query("BEGIN");
    try {
      const examId = await seedBrainSelectionFixture(client, "decl");
      expect(await publish("pub.decl.ok", examId), "the fully declared fixture publishes").toBeNull();

      // Take away one direction of one 'excludes' pair: the pair is now a rule whose outcome
      // depends on which tile the composition walks first, which is the mechanism #1014 measured.
      expect((await attempt(
        `DELETE FROM clinical_tile_relationships
          WHERE tile_id = (SELECT id FROM clinical_tiles WHERE key = 'decl.tile.fazekas1')
            AND related_tile_id = (SELECT id FROM clinical_tiles WHERE key = 'decl.tile.fazekas2')
            AND relation_kind = 'excludes'`,
      )), "dropping one direction of an excludes pair is storable in draft").toBeNull();
      const halfDeclared = await publish("pub.decl.half", examId);
      expect(halfDeclared?.code, "…but the pair cannot be published").toBe("P0001");
      expect(halfDeclared?.message).toMatch(/is declared in one direction only/);

      await attempt(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES ((SELECT id FROM clinical_tiles WHERE key = 'decl.tile.fazekas1'),
                 (SELECT id FROM clinical_tiles WHERE key = 'decl.tile.fazekas2'), 'excludes')`,
      );

      // The other kind of undeclared: erase BOTH directions of one grade pair. Now nothing says how
      // the two resolve, and they share a conflict group, so the group itself is unresolved.
      await attempt(
        `DELETE FROM clinical_tile_relationships
          WHERE relation_kind = 'excludes'
            AND tile_id IN (SELECT id FROM clinical_tiles WHERE key IN ('decl.tile.fazekas1','decl.tile.fazekas2'))
            AND related_tile_id IN (SELECT id FROM clinical_tiles WHERE key IN ('decl.tile.fazekas1','decl.tile.fazekas2'))`,
      );
      const unresolvedGroup = await publish("pub.decl.unresolved", examId);
      expect(unresolvedGroup?.code, "a conflict group with no stated resolution is refused").toBe("P0001");
      expect(unresolvedGroup?.message).toMatch(/share conflict group decl.fazekas and nothing declares how they resolve/);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("carries normal suppression as an edge, so deselecting has exactly one restore set", async () => {
    await client.query("BEGIN");
    try {
      const examId = await seedBrainSelectionFixture(client, "rest");
      const rows = await client.query<{ tile_key: string; slot_keys: string }>(
        `SELECT k.key AS tile_key, string_agg(ns.key, ',' ORDER BY ns.key) AS slot_keys
           FROM clinical_tile_normal_replacements nr
           JOIN clinical_tiles k ON k.id = nr.tile_id
           JOIN clinical_normal_slots ns ON ns.id = nr.normal_slot_id
          WHERE ns.examination_id = $1
          GROUP BY k.key ORDER BY k.key`,
        [examId],
      );
      expect(rows.rows.map((r) => r.tile_key), "every register abnormal owns a baseline").toHaveLength(ABNORMAL_TILES.length);
      const hydro = rows.rows.find((r) => r.tile_key === "rest.tile.hydrocephalus");
      expect(hydro?.slot_keys, "hydrocephalus retires the ventricular normal and only that one").toBe("rest.normal.ventricles");
      const edema = rows.rows.find((r) => r.tile_key === "rest.tile.edema");
      expect(edema?.slot_keys).toBe("rest.normal.parenchyma");

      // There is no prose path to suppression: clinical_tiles carries no baseline_replaces column,
      // which is the defect that made the shipped behaviour order-dependent (String.includes()
      // against free text). The edge table is the only way a normal can be retired, so the restore
      // set of a deselected tile is a SELECT, not a guess.
      const columns = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'clinical_tiles' AND column_name = 'baseline_replaces'`,
      );
      expect(columns.rows[0]!.n, "a tile has no free-text column that can retire a normal").toBe(0);

      // A normal cannot be destroyed out from under the edge that restores it.
      const slotId = (await client.query<{ id: number }>(
        `SELECT id FROM clinical_normal_slots WHERE key = 'rest.normal.parenchyma'`,
      )).rows[0]!.id;
      const blocked = await attempt(`DELETE FROM clinical_normal_slots WHERE id = ${slotId}`);
      expect(["23001", "23503"], "RESTRICT protects the normal a tile would restore").toContain(blocked?.code);
      expect(blocked?.message).toMatch(/clinical_tile_normal_replacements|clinical_normal_slots_pkey/);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("keeps which tiles compete separate from which prints first", async () => {
    await client.query("BEGIN");
    try {
      const examId = await seedBrainSelectionFixture(client, "sep");
      const read = (sqlText: string, values?: unknown[]) => client.query(sqlText, values);
      const before = buildCatalogueSnapshot(await loadCatalogueRows(read, examId));

      // Re-order the anatomy: the first two parenchyma tiles swap positions, by the two-statement
      // protocol the architecture documents — unplace, then place. (A negative ordinal would be
      // refused by the positive CHECK, and a direct swap would collide on the unique index, which
      // is why the protocol exists.) Resolution is untouched, and that is not a claim: it is a
      // byte comparison of the two domains that carry it.
      await client.query(
        `UPDATE clinical_tile_examinations SET ordinal = NULL WHERE examination_id = $1 AND ordinal IN (1,2)`, [examId],
      );
      expect(await attempt(
        `UPDATE clinical_tile_examinations SET ordinal = 2
          WHERE examination_id = $1
            AND tile_id = (SELECT id FROM clinical_tiles WHERE key = 'sep.tile.edema')`,
        [examId],
      ), "the first tile moves to position two").toBeNull();
      expect(await attempt(
        `UPDATE clinical_tile_examinations SET ordinal = 1
          WHERE examination_id = $1
            AND tile_id = (SELECT id FROM clinical_tiles WHERE key = 'sep.tile.demyelinating')`,
        [examId],
      ), "and the second takes position one").toBeNull();
      const reordered = buildCatalogueSnapshot(await loadCatalogueRows(read, examId));
      expect(canonicalize(reordered.relationships), "re-ordering the anatomy did not change any resolution").toBe(
        canonicalize(before.relationships),
      );
      expect(canonicalize(reordered.normalReplacements), "…nor any baseline retirement").toBe(
        canonicalize(before.normalReplacements),
      );
      expect(canonicalize(reordered.placements), "…and the print order did change, because it is data").not.toBe(
        canonicalize(before.placements),
      );

      // And the converse: turning a declared coexistence into a declared exclusion leaves every
      // ordinal alone.
      await client.query(
        `UPDATE clinical_tile_relationships SET relation_kind = 'excludes'
          WHERE relation_kind = 'coexists'`,
      );
      const reResolved = buildCatalogueSnapshot(await loadCatalogueRows(read, examId));
      expect(canonicalize(reResolved.placements), "changing a resolution did not move anything").toBe(
        canonicalize(reordered.placements),
      );
      expect(canonicalize(reResolved.relationships).includes("coexists"), "…and the resolution itself moved").toBe(false);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("expresses parent-child without letting it become a cycle", async () => {
    await client.query("BEGIN");
    try {
      const examId = await seedBrainSelectionFixture(client, "pc");
      await client.query(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES ((SELECT id FROM clinical_tiles WHERE key = 'pc.tile.demyelinating'),
                 (SELECT id FROM clinical_tiles WHERE key = 'pc.tile.lacunar'), 'parent_child')`,
      );
      expect(await publish("pub.pc.ok", examId), "a child pointing at its parent publishes").toBeNull();

      // Close the loop. A CHECK cannot see a path and the author is entitled to save a graph that
      // is temporarily wrong, so this is refused where it would otherwise reach a patient.
      await client.query(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind)
         VALUES ((SELECT id FROM clinical_tiles WHERE key = 'pc.tile.lacunar'),
                 (SELECT id FROM clinical_tiles WHERE key = 'pc.tile.demyelinating'), 'parent_child')`,
      );
      const cycle = await publish("pub.pc.cycle", examId);
      expect(cycle?.code, "a two-node parent_child loop is refused").toBe("P0001");
      expect(cycle?.message).toMatch(/takes part in a requires\/parent_child\/supersedes cycle/);

      // A three-node loop through 'requires' too, because the composition walk has to be acyclic
      // whatever the directional kind.
      await client.query(`DELETE FROM clinical_tile_relationships WHERE relation_kind = 'parent_child'`);
      await client.query(
        `INSERT INTO clinical_tile_relationships (tile_id, related_tile_id, relation_kind) VALUES
         ((SELECT id FROM clinical_tiles WHERE key = 'pc.tile.edema'),
          (SELECT id FROM clinical_tiles WHERE key = 'pc.tile.hydrocephalus'), 'requires'),
         ((SELECT id FROM clinical_tiles WHERE key = 'pc.tile.hydrocephalus'),
          (SELECT id FROM clinical_tiles WHERE key = 'pc.tile.tumor_recurrence'), 'requires'),
         ((SELECT id FROM clinical_tiles WHERE key = 'pc.tile.tumor_recurrence'),
          (SELECT id FROM clinical_tiles WHERE key = 'pc.tile.edema'), 'requires')`,
      );
      const long = await publish("pub.pc.long", examId);
      expect(long?.code, "a three-tile requires chain that returns to its start is refused").toBe("P0001");
      expect(long?.message).toMatch(/cycle/);

      // And the chain that does NOT close is legal, so the gate is not simply banning the kind.
      await client.query(
        `DELETE FROM clinical_tile_relationships
          WHERE relation_kind = 'requires'
            AND tile_id = (SELECT id FROM clinical_tiles WHERE key = 'pc.tile.tumor_recurrence')`,
      );
      expect(await publish("pub.pc.chain", examId), "an open requires chain publishes").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("maps all nine measured pairs onto a declared resolution", async () => {
    await client.query("BEGIN");
    try {
      const examId = await seedBrainSelectionFixture(client, "map");
      expect(ORDER_DEPENDENT_PAIRS).toHaveLength(9);
      expect(ORDER_DEPENDENT_PAIRS.filter((p) => p.resolution === "F").length, "eight are normal versus abnormal").toBe(8);
      expect(ORDER_DEPENDENT_PAIRS.filter((p) => p.resolution === "D").length, "one is two abnormals that coexist").toBe(1);

      // NB: clinical_tile_relationships.tile_id is a clinical_tiles id, not a
      // clinical_tile_examinations id — the two serial spaces overlap numerically, so reading the
      // wrong one returns zero rows and looks like "nothing was declared" rather than "I queried
      // the wrong id space".
      const rows = await client.query<{ kind: string; n: string }>(
        `SELECT r.relation_kind AS kind, count(*)::text AS n
           FROM clinical_tile_relationships r
          WHERE r.tile_id IN (SELECT tile_id FROM clinical_tile_examinations WHERE examination_id = $1)
          GROUP BY 1 ORDER BY 1`, [examId],
      );
      const counts = new Map(rows.rows.map((r) => [r.kind, Number(r.n)]));
      expect(rows.rows.reduce((s, r) => s + Number(r.n), 0), "every declared relationship is counted").toBe(8);
      expect(counts.get("excludes"), "six ordered pairs among the three grades").toBe(6);
      expect(counts.get("coexists"), "the recurrence/edema pair is declared both ways").toBe(2);

      // Each abnormal retires the normal the pair names, which is state F for the eight.
      const retiring = await client.query<{ n: string }>(
        `SELECT count(DISTINCT nr.tile_id)::text AS n FROM clinical_tile_normal_replacements nr
          WHERE nr.normal_slot_id IN (SELECT id FROM clinical_normal_slots WHERE examination_id = $1)`, [examId],
      );
      expect(retiring.rows[0]!.n, "every register abnormal retires its baseline through an edge").toBe(
        String(ABNORMAL_TILES.length),
      );

      expect(await publish("pub.map", examId), "the mapped register is publishable").toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // ── Obligations Stage C has to discharge ────────────────────────────────────────────────
  // Skipped, not deleted: each one is a sentence a composer can be held to the moment it exists,
  // and none of them can be answered by a schema. They are written so that the test that turns
  // them green is unambiguous about which behaviour it is asserting.
  describe("runtime obligations (Stage C — specification only, no composer exists yet)", () => {
    it.skip("prints both members of an undeclared pair and evicts neither, in either click order", () => {
      // The default rule for the two tiles the catalogue does not relate: neither is in the other's
      // conflict group and no row points between them. Clicking a then b must yield the same
      // sentence multiset as b then a, and neither may delete the other's contribution. This is the
      // assertion that empties PR #1014's register, and the register must be deleted when it does.
      expect(true, "Stage C").toBe(false);
    });

    it.skip("restores exactly the normals the deselected tile retired, and no others", () => {
      // State B. The restore set is the tile's clinical_tile_normal_replacements rows — so this
      // must hold when the same tile retires two slots (the acute-infarct case) and when two tiles
      // retire the same slot (deselecting one must not un-retire the other's claim).
      expect(true, "Stage C").toBe(false);
    });

    it.skip("lets a superseding tile change selection but never delete an unrelated finding", () => {
      // State C: 'supersedes' names its winner, so the loser leaves; the contract is that nothing
      // else leaves. The shipped defect this pins is one abnormal evicting a second, unrelated
      // abnormal (Glioma recurrence <> Cerebral edema, #1014 pair nine).
      expect(true, "Stage C").toBe(false);
    });

    it.skip("records a radiologist override outside the catalogue and never re-applies a rule over it", () => {
      // State G: no clinical_* column can represent an override, which is deliberate — an override
      // is a fact about one study. Stage C must store it with the observation ledger and the
      // composer must not re-run a combination or a suppression against edited text.
      expect(true, "Stage C").toBe(false);
    });

    it.skip("keeps conflict resolution and anatomical rendering order as two independent inputs", () => {
      // Proved here for the DATA (the byte comparison above). The runtime half is that a report's
      // sentence order may change without altering which sentences exist, and vice versa.
      expect(true, "Stage C").toBe(false);
    });
  });

  it("awaits the radiologist on the wording it had to decide for itself", () => {
    // The mechanism for every pair is stated; the clinical wording of one of them is not the
    // schema's to invent. Recording which is which is what stops a reviewer later reading this
    // fixture as a ratified clinical opinion.
    const awaiting = ORDER_DEPENDENT_PAIRS.filter((p) => p.wording !== "ratified");
    expect(awaiting.map((p) => p.right)).toEqual(["Cerebral edema (edema)"]);
    for (const pair of awaiting) {
      expect(pair.left, "the pair keeps its identity").toContain("Glioma recurrence");
      expect(pair.resolution, "coexistence is the conservative mechanism, not a clinical conclusion").toBe("D");
    }
    expect(ABNORMAL_TILES).toHaveLength(9);
  });
});
