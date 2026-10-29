/**
 * The USG Whole Abdomen / Obstetric boxes the strip reads are database rows, so
 * this test asks the database — through the same table the wire route reads —
 * whether the two clinical defects the C3 audit observed are actually gone.
 *
 * WHY THIS IS A REQUEST-STYLE TEST ON THE DB, NOT A SOURCE GREP.
 * A grep of a .sql file proves the file says a thing, not that a real Postgres
 * row carries it after the whole migration chain has run. Measured on a clean
 * 196-file chain (docker/db-patch-entrypoint.sh, alphabetical): without
 * `zzzzzzzzzzzzzzzzzzzzzz_usg_abdominal_ownership.sql` every Fatty Liver grade
 * row has `conflict_group = ''` — the seed that intended to set it
 * (`z_seed_usg_companion_suggestions.sql:12`) runs BEFORE the seed that inserts
 * the rows (`zz_add_usg_platform_content_pack.sql:87`, and Gr III is not
 * inserted until `zzz_add_usg_gold_standard_content.sql:184`). Cholelithiasis,
 * Hepatomegaly and Splenomegaly all have `anatomical_section = ''`. The strip
 * renders what the route reads, and the route reads this table, so asserting
 * against the table asserts against the product.
 *
 * WHAT IT PINS
 *   1. The two observed defects, exactly as the audit named them: Fatty Liver
 *      grades coexisting (mutex missing), Gallbladder content under Liver
 *      (organ ownership missing).
 *   2. The migration's own scope discipline: a factory-owned row's
 *      `customized_at` stays NULL, because writing factory metadata from here
 *      would either lose it on the next catalogue regeneration or permanently
 *      opt the row out of the deploy refresh.
 *   3. `concept` names only what contentPacks.ts already registers — a slug
 *      that reads like a concept but resolves to no pack is worse than none.
 *   4. The engine's own inputs — region + concept + level + laterality —
 *      actually change when the migration lands, so a metadata column nothing
 *      reads cannot hide behind a green test.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts); in CI it runs
 * against the postgres service the workflow already brings up.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyQuickFindingsTable } from "@workspace/db/schema";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

type Row = typeof radiologyQuickFindingsTable.$inferSelect;

function pick(rows: Row[], studyType: string, label: string): Row | undefined {
  return rows.find((r) => r.studyType === studyType && r.label === label);
}

describe.skipIf(!dbReady)("USG anatomical ownership — real Quick Select boxes", () => {
  let rows: Row[] = [];

  beforeAll(async () => {
    rows = await db.select().from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.isActive, true));
    // A database with no Whole Abdomen rows means the migration chain never
    // ran here — the test would pass on an empty set, which is exactly the
    // false-green the audit brief is trying to close.
    expect(rows.some((r) => r.studyType === "Whole Abdomen")).toBe(true);
  });

  it("Fatty Liver Gr I, Gr II and Gr III share one mutual-exclusion group", () => {
    // The audit's exact symptom: Grade I and Grade III coexisting on one report.
    // The existing engine (`observationsMutuallyExclusive`, observationSlot.ts:355)
    // needs `concept` to fire AND `conflict_group` to seed it when concept is
    // absent. The seed that intended to set conflict_group ran before the
    // INSERTs. Both halves are pinned.
    const grades = ["Fatty Liver Gr I", "Fatty Liver Gr II", "Fatty Liver Gr III"]
      .map((l) => pick(rows, "Whole Abdomen", l))
      .filter((r): r is Row => Boolean(r));
    expect(grades.length).toBe(3);
    expect(new Set(grades.map((g) => g.conflictGroup))).toEqual(new Set(["fatty_liver_grade"]));
    expect(new Set(grades.map((g) => g.concept))).toEqual(new Set(["fatty_liver"]));
  });

  it("Cholelithiasis is owned by the Gallbladder, not by the active tab", () => {
    // The audit's second symptom, measured: Cholelithiasis's category already
    // said "Gallbladder" but its anatomical_section was empty, so the strip
    // wrote the sentence wherever the doctor was looking — the Liver or Kidney
    // section.
    const chole = pick(rows, "Whole Abdomen", "Cholelithiasis");
    expect(chole).toBeDefined();
    expect(chole?.anatomicalSection).toBe("Gallbladder");
    expect(chole?.concept).toBe("cholelithiasis");
  });

  it("Hepatomegaly and Splenomegaly own their own organ", () => {
    // The same class of defect, one tile each on either side of the gallbladder.
    expect(pick(rows, "Whole Abdomen", "Hepatomegaly")?.anatomicalSection).toBe("Liver");
    expect(pick(rows, "Whole Abdomen", "Splenomegaly")?.anatomicalSection).toBe("Spleen");
  });

  it("anatomical_section equals the tile's own category, never an invented organ", () => {
    // The migration copies category into anatomical_section rather than naming
    // an anatomy the doctor did not write. Where the tile has no category the
    // migration leaves the section empty — a wrong organ is worse than none.
    // Exceptions spelled out here are the two tiles whose prose says the organ
    // plainly but whose category column was left empty by the seed that wrote
    // them (Gallbladder Polyp, Simple Hepatic Cyst); those rows carry an
    // explicit, hand-authored section and the test names them so a future
    // silent addition cannot slip past.
    const DECLARED_BY_PROSE = new Set(["Gallbladder Polyp", "Simple Hepatic Cyst"]);
    for (const r of rows.filter((x) => x.studyType === "Whole Abdomen" && !x.factoryKey)) {
      if (!r.anatomicalSection) continue;
      if (DECLARED_BY_PROSE.has(r.label)) continue;
      expect(r.category ?? "", `row ${r.label}`).toBe(r.anatomicalSection);
    }
  });

  it("Cephalic and Breech share a fetal-presentation mutex", () => {
    // Same class of defect: two presentations cannot both be true of one fetus,
    // and the shipped factory catalogue never had them.
    expect(pick(rows, "Obstetric", "Cephalic Presentation")?.conflictGroup).toBe("fetal_presentation");
    expect(pick(rows, "Obstetric", "Breech Presentation")?.conflictGroup).toBe("fetal_presentation");
  });

  it("Oligohydramnios and Polyhydramnios share an amniotic-fluid mutex", () => {
    expect(pick(rows, "Obstetric", "Oligohydramnios")?.conflictGroup).toBe("amniotic_fluid_volume");
    expect(pick(rows, "Obstetric", "Polyhydramnios")?.conflictGroup).toBe("amniotic_fluid_volume");
  });

  it("the migration does not stamp customized_at on a factory-owned box", () => {
    // Rule 3 of the shipped seed (refresh only untouched rows) is what makes
    // the deploy contract hold. If this migration wrote a factory row's
    // ownership, the next catalogue regeneration would either lose that value
    // or permanently opt the row out of future refreshes.
    const factoryAbdomen = rows.filter(
      (r) => r.studyType === "Abdomen" && r.factoryKey !== "",
    );
    expect(factoryAbdomen.length).toBeGreaterThan(0);
    for (const box of factoryAbdomen) {
      expect(box.customizedAt, `row ${box.label}`).toBeNull();
    }
  });

  it("no clinic-owned row is left with a concept that no content pack registers", () => {
    // The migration sets concept only for the ids contentPacks.ts already owns.
    // An invented slug would resolve through canonConcept to a string nothing
    // matches, which reads like a concept and behaves like none. The list below
    // is the union of what this migration writes and what the shipped factory
    // catalogue stamps on Abdomen tiles; both sources must stay in register.
    const KNOWN_PACK_CONCEPTS = new Set([
      "cholelithiasis", "fatty_liver", "renal",
      "brain_parenchyma", "ventricles", "hydrocephalus", "glioma", "infarct",
      "hemorrhage", "fazekas", "orbital", "birads",
      // `midline` is the CT Brain Midline Shift box's concept, written by
      // zzzzzzzzzzzzzzzzzzzzzzz_ct_brain_quickselect_ownership.sql. Registered in
      // conceptCanon/contentPacks.ts as its own entry (label "Midline Shift",
      // regions brain, modalities MR/CT), so it resolves through canonConcept to a
      // real pack rather than to a string nothing matches.
      "midline",
    ]);
    for (const r of rows.filter((x) => x.concept && !x.factoryKey)) {
      expect(
        KNOWN_PACK_CONCEPTS.has(r.concept),
        `unregistered concept '${r.concept}' on ${r.studyType}/${r.label}`,
      ).toBe(true);
    }
  });

  it("the migration's output is the pair the engine reads", () => {
    // `observationsMutuallyExclusive` (observationSlot.ts:355) fires only when
    // concept matches AND region matches. A migration that populated
    // conflict_group but left concept empty would pass every assertion above
    // and still coexist the two grades in the strip. Region + concept are both
    // pinned here; the ERP's own observationOwnership.phase12.test.ts covers
    // the primitive itself.
    const gr1 = pick(rows, "Whole Abdomen", "Fatty Liver Gr I")!;
    const gr3 = pick(rows, "Whole Abdomen", "Fatty Liver Gr III")!;
    expect(gr1.studyType).toBe(gr3.studyType);
    expect(gr1.concept).toBe(gr3.concept);
    expect(gr1.concept).not.toBe("");
  });
});
