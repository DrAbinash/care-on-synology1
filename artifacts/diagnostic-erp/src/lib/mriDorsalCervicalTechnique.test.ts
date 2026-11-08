import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickQuickProtocol,
  pickQuickProtocolForBilledName,
  protocolsForStudyTabDetailed,
} from "./pickQuickProtocol";

// -----------------------------------------------------------------------------
// The last two MRI examinations whose Technique had no honest row behind it.
// Measured 2026-11-08 in the clinic database (`care-db`, 112 tabs / 86 protocols
// / 15 of them MRI after PR #1295) — not in a factory-seeded local copy:
//
// DORSAL SPINE — tab 4, owns ZERO protocols, and the generic "Spine" tab (id 2)
//   that a segment inherits from also owns zero. So `pickQuickProtocolForBilledName`
//   and `pickQuickProtocol` both return null for a booked "MRI DORSAL SPINE",
//   `applyDefaultTechniqueForRegion` takes its tab-fallback branch, and the
//   Technique field holds `radiology_study_tabs.technique_text` (145 chars, a
//   different sentence from the owned baseline's) while the dropdown itself has
//   nothing to offer and no active protocol is highlighted. The examination is
//   described by a tab default, not by a protocol the desk can see or choose.
//
// CERVICAL SPINE — tab 3 owns two rows and the WRONG one is authoritative:
//   id 83 "MRI CERVICAL SPINE SCREENING SCR"  is_default=t is_gold_standard=t sort 0  technique_text = ''  (0 chars)
//   id 11 "MRI Cervical Spine"                is_default=f is_gold_standard=t sort 110 technique_text = 103 chars
//   #83 was created in the clinic on 2026-08-30 with an empty technique and has
//   been the tab's default ever since, so `pickQuickProtocol` answers the star
//   option that inserts nothing, and a plain cervical booking whose billed name
//   matches neither row auto-loads "" — the ★ in the strip is a dead button.
//   Filling #83 alone would make that worse, not better: precedence is
//   isDefault → isGoldStandard → lowest sortOrder, and both rows are gold, so a
//   screening sentence dropped on the tab's default would describe FULL cervical
//   studies as limited. So this file fills the blank AND moves the flags onto the
//   dedicated row, which is what the factory catalogue already says.
//
// No clinical prose is authored here. The dorsal sentences are the owned dorsal
// baseline's own (`mriDorsalStandardNormal.ts`) and the screening sentence is the
// owned cervical screening baseline's own (`mriCervicalScreeningNormal.ts`) — the
// same single-owner rule PR #1295 followed for Dorso-Lumbar.
// -----------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SEEDED = "zzzzzzzzzzzzzzzzzzzzzzzz_mri_dorsal_and_cervical_screening_technique.sql";
const defaults = read("artifacts/api-server/src/lib/radiologyReportingDefaults.ts");
const migration = read(`migrations/${SEEDED}`);

const dorsalBaseline = read(
  "artifacts/diagnostic-erp/src/lib/zai-workspace/baselines/mriDorsalStandardNormal.ts",
);
const cervicalScreening = read(
  "artifacts/diagnostic-erp/src/lib/zai-workspace/baselines/mriCervicalScreeningNormal.ts",
);

/** Quote a TS string literal the way a SQL literal must carry it. */
const sqlize = (s: string) => s.replace(/'/g, "''");

const DORSAL_TECHNIQUE = dorsalBaseline.match(/technique:\s*"((?:[^"\\]|\\.)*)",/)?.[1] ?? "";
const DORSAL_IMPRESSION = dorsalBaseline.match(
  /MRI_DORSAL_STANDARD_NORMAL_IMPRESSION =\s*"((?:[^"\\]|\\.)*)";/,
)?.[1] ?? "";
const SCREENING_TECHNIQUE = cervicalScreening.match(/technique:\s*\n?\s*"((?:[^"\\]|\\.)*)",/)?.[1] ?? "";

const DORSAL_TAB = "Dorsal Spine";
const CERVICAL_TAB = "Cervical Spine";
const DORSAL_PROTOCOL = "MRI Dorsal Spine";
const DEDICATED_CERVICAL = "MRI Cervical Spine";
const SCREENING_CERVICAL = "MRI CERVICAL SPINE SCREENING SCR";

/** A row shaped like the radiology_protocols rows the API returns. */
const protocol = (over: Record<string, unknown>) => ({
  id: 1, name: "", studyType: "", modality: "MRI", techniqueText: "",
  isGoldStandard: true, isDefault: true, sortOrder: 100, isActive: true, ...over,
});

const dedicatedCervical = protocol({
  id: 11, name: DEDICATED_CERVICAL, studyType: CERVICAL_TAB, studyTabId: 3, sortOrder: 110,
  isDefault: true, techniqueText:
    "Multiplanar multisequence MRI of the cervical spine was performed including T1, T2, and STIR sequences.",
});
const screeningCervical = (over: Record<string, unknown> = {}) => protocol({
  id: 83, name: SCREENING_CERVICAL, studyType: CERVICAL_TAB, studyTabId: 3, sortOrder: 0,
  isDefault: false, isGoldStandard: false, techniqueText: SCREENING_TECHNIQUE, ...over,
});

describe("MRI Dorsal Spine technique protocol", () => {
  it("1. the dorsal technique and normal are the owned baseline's own sentences", () => {
    expect(DORSAL_TECHNIQUE).toMatch(/dorsal/i);
    expect(DORSAL_IMPRESSION).toMatch(/dorsal/i);
    expect(defaults).toContain(DORSAL_TECHNIQUE);
    expect(defaults).toContain(DORSAL_IMPRESSION);
    expect(migration).toContain(sqlize(DORSAL_TECHNIQUE));
    expect(migration).toContain(sqlize(DORSAL_IMPRESSION));
  });

  it("2. the factory catalogue ships the dorsal row on the existing Dorsal Spine tab", () => {
    const row = defaults.match(
      /\{\s*name:\s*"MRI Dorsal Spine",\s*studyType:\s*"([^"]*)",\s*modality:\s*"([^"]*)"[\s\S]{0,400}?checklistJson:\s*'(\[[^\]]*\])'[\s\S]{0,400}?isDefault:\s*(true|false),\s*sortOrder:\s*(\d+)/,
    );
    expect(row, "PROTOCOL_DEFAULTS must carry an MRI Dorsal Spine row").not.toBeNull();
    expect(row![1]).toBe(DORSAL_TAB);
    expect(row![2]).toBe("MRI");
    expect(row![4]).toBe("true");
    // Anatomy order: cervical 110 → dorsal here → whole spine 120.
    expect(Number(row![5])).toBeGreaterThan(110);
    expect(Number(row![5])).toBeLessThan(120);
    // The sequence checklist is deliberately empty: dorsal content arrives as
    // Quick Select factory boxes, and inventing a checklist here would be a second one.
    expect(row![3]).toBe("[]");
  });

  it("3. the dorsal seed files the protocol under a tab looked up BY NAME and creates no tab", () => {
    expect(migration).toMatch(
      /INSERT INTO radiology_protocols[\s\S]{0,900}FROM radiology_study_tabs t\s+WHERE t\.name = 'Dorsal Spine'/);
    expect(migration).toMatch(/'MRI Dorsal Spine',\s*'Dorsal Spine',\s*'MRI'/);
    // The tab id must never be assumed: the clinic's tab ids are not this file's.
    expect(migration).not.toMatch(/study_tab_id[^,\n]*\b4\b/);
    // A tab already exists for this region — creating a second one would split the
    // examination across two Study Tabs.
    expect(migration).not.toMatch(/INSERT INTO radiology_study_tabs/);
    // Nothing here rewrites the tab's own fallback sentence.
    expect(migration).not.toMatch(/UPDATE radiology_study_tabs/);
    // Replaying must be a no-op for a row the clinic already authored itself.
    expect(migration).toMatch(/NOT EXISTS[\s\S]{0,220}radiology_protocols/);
  });

  it("4. a dorsal booking gets a pickable protocol where it previously had none", () => {
    // Before: the tab owns nothing, so the pool is empty and no protocol applies.
    const spine = protocol({ id: 90, name: "MRI Spine", studyType: "Spine", studyTabId: 2, sortOrder: 90 });
    expect(protocolsForStudyTabDetailed([spine], 4, DORSAL_TAB).matched).toHaveLength(0);
    expect(pickQuickProtocol([spine], DORSAL_TAB, 4)).toBeNull();
    expect(pickQuickProtocolForBilledName([spine], "MRI DORSAL SPINE", DORSAL_TAB, 4)).toBeNull();

    // After: exactly its own row, chosen by both the default path and the billed name.
    const dorsal = protocol({
      id: 87, name: DORSAL_PROTOCOL, studyType: DORSAL_TAB, studyTabId: 4,
      sortOrder: 115, techniqueText: DORSAL_TECHNIQUE,
    });
    const pool = protocolsForStudyTabDetailed([spine, dorsal], 4, DORSAL_TAB).matched;
    expect(pool.map((p) => p.name)).toEqual([DORSAL_PROTOCOL]);
    expect(pickQuickProtocol([spine, dorsal], DORSAL_TAB, 4)?.techniqueText).toBe(DORSAL_TECHNIQUE);
    expect(pickQuickProtocolForBilledName([spine, dorsal], "MRI DORSAL SPINE", DORSAL_TAB, 4)?.name)
      .toBe(DORSAL_PROTOCOL);
    // The generic tab's own row, if the clinic ever files one, stays out of dorsal's way.
    expect(protocolsForStudyTabDetailed([spine, dorsal], 2, "Spine").matched.map((p) => p.name))
      .toEqual(["MRI Spine"]);
  });

  it("5. the dorsal sentence names no unfilled slot and claims no fixed vertebral range", () => {
    expect(DORSAL_TECHNIQUE).not.toMatch(/\[|\bTBD\b|…/);
    expect(DORSAL_TECHNIQUE.toLowerCase()).not.toMatch(/t1\s*(?:to|-|through)\s*s1/);
    expect(SCREENING_TECHNIQUE).not.toMatch(/\[|\bTBD\b|…/);
  });
});

describe("MRI Cervical Spine screening technique", () => {
  it("6. the screening fill is the owned screening baseline's own sentence, and says it is limited", () => {
    expect(SCREENING_TECHNIQUE).toMatch(/[Ll]imited/);
    expect(migration).toContain(sqlize(SCREENING_TECHNIQUE));
    // The dedicated cervical row keeps its own prose; the two can never be confused.
    expect(SCREENING_TECHNIQUE).not.toBe(dedicatedCervical.techniqueText);
    expect(dedicatedCervical.techniqueText).not.toMatch(/[Ll]imited/);
  });

  it("7. the fill only ever touches a BLANK technique — a written one is left alone", () => {
    // Source contract for the guard; the behavioural proof (a customised row
    // surviving a real apply) is measured on Postgres and quoted in the PR body,
    // because a unit test cannot execute the migration.
    const fill = migration.match(/UPDATE radiology_protocols\s+SET technique_text[\s\S]*?RETURNING/);
    expect(fill, "the cervical screening fill statement was not found").not.toBeNull();
    expect(fill![0]).toMatch(/btrim\(coalesce\(technique_text,\s*''\)\)\s*=\s*''/i);
    expect(fill![0]).toMatch(/lower\(trim\(name\)\)\s+LIKE\s+'mri cervical spine screening%'/i);
    expect(fill![0]).toMatch(/study_tab_id\s*=\s*\(SELECT id FROM radiology_study_tabs WHERE name = 'Cervical Spine'\)/);
    // The flag pair lives in the same statement, so it can only run on a row this
    // file actually filled — a customised row leaves the CTE empty.
    expect(fill![0]).toMatch(/is_default\s*=\s*FALSE/i);
    expect(fill![0]).toMatch(/is_gold_standard\s*=\s*FALSE/i);
    // Never a blanket rewrite, and never a DELETE of a clinic row.
    expect(migration.match(/SET technique_text/gi)).toHaveLength(1);
    expect(migration).not.toMatch(/DELETE FROM radiology_protocols/);
  });

  it("8. the tab's default and gold flags move to the dedicated row, so screening never speaks for a full study", () => {
    // The dedicated row as the clinic actually has it: NOT default, gold, sort 110.
    const prodDedicated = protocol({ ...dedicatedCervical, isDefault: false });

    // Today, in production: the never-authored blank row is the tab's default, so
    // the pick is that row and the Technique it writes is the empty string.
    const before = [prodDedicated, screeningCervical({
      isDefault: true, isGoldStandard: true, techniqueText: "",
    })];
    expect(pickQuickProtocol(before, CERVICAL_TAB, 3)?.name).toBe(SCREENING_CERVICAL);
    expect(pickQuickProtocol(before, CERVICAL_TAB, 3)?.techniqueText,
      "the ★ option today inserts nothing").toBe("");

    // Filling the blank and touching no flag: the screening sentence becomes the
    // technique of every full cervical MRI that the billed name matches nothing.
    const filledOnly = [prodDedicated, screeningCervical({ isDefault: true, isGoldStandard: true })];
    expect(pickQuickProtocol(filledOnly, CERVICAL_TAB, 3)?.techniqueText).toBe(SCREENING_TECHNIQUE);

    // Clearing is_default alone is not enough — precedence falls through to
    // isGoldStandard, and both rows are gold with the screening row at sort 0.
    const demotedOnly = [prodDedicated, screeningCervical({ isDefault: false, isGoldStandard: true })];
    expect(pickQuickProtocol(demotedOnly, CERVICAL_TAB, 3)?.techniqueText,
      "isDefault alone is not enough — precedence falls through to isGoldStandard")
      .toBe(SCREENING_TECHNIQUE);

    // This file's end state: both flags cleared on the filled row, dedicated row promoted.
    const after = [dedicatedCervical, screeningCervical()];
    expect(pickQuickProtocol(after, CERVICAL_TAB, 3)?.name).toBe(DEDICATED_CERVICAL);
    expect(pickQuickProtocol(after, CERVICAL_TAB, 3)?.techniqueText).toBe(dedicatedCervical.techniqueText);

    // The migration asserts both clears and the promote in SQL.
    expect(migration).toMatch(/is_default\s*=\s*FALSE/i);
    expect(migration).toMatch(/is_gold_standard\s*=\s*FALSE/i);
    expect(migration).toMatch(/SET is_default = TRUE[\s\S]{0,300}'MRI Cervical Spine'/);
  });

  it("9. the screening row is reachable by its own name, and the dedicated booking keeps its own", () => {
    const after = [dedicatedCervical, screeningCervical()];
    // Exact normalized name is pass 1 of the billed matcher.
    expect(pickQuickProtocolForBilledName(after, SCREENING_CERVICAL, CERVICAL_TAB, 3)?.name)
      .toBe(SCREENING_CERVICAL);
    expect(pickQuickProtocolForBilledName(after, "MRI CERVICAL SPINE", CERVICAL_TAB, 3)?.name)
      .toBe(DEDICATED_CERVICAL);
    // MEASURED LIMITATION, unchanged by this PR: the clinic named its row with a
    // trailing "SCR", so a booking billed as plain "MRI CERVICAL SPINE SCREENING"
    // still resolves to the dedicated row by phrase containment (its name is a
    // contiguous prefix of the billed string, the screening row's is not). Renaming
    // a clinic row is not this file's call — the desk selects it from the strip,
    // which is what it could not do while the row was blank.
    expect(pickQuickProtocolForBilledName(after, "MRI CERVICAL SPINE SCREENING", CERVICAL_TAB, 3)?.name)
      .toBe(DEDICATED_CERVICAL);
    // Nothing about this region leaks onto the neighbouring spine tabs.
    const dorsal = protocol({ id: 87, name: DORSAL_PROTOCOL, studyType: DORSAL_TAB, studyTabId: 4,
      sortOrder: 115, techniqueText: DORSAL_TECHNIQUE });
    expect(pickQuickProtocolForBilledName([...after, dorsal], "MRI DORSAL SPINE", DORSAL_TAB, 4)?.name)
      .toBe(DORSAL_PROTOCOL);
  });

  it("10. no other seed files the dorsal protocol or rewrites the cervical row's technique", () => {
    const names = readdirSync(join(ROOT, "migrations")).filter((n) => n.endsWith(".sql")).sort();
    expect(names).toContain(SEEDED);
    const boxes = names.find((n) => n.includes("quick_select_factory_boxes"));
    expect(boxes).toBeTruthy();
    // Feature migrations run in filename order; this one must land after the
    // Quick Select factory boxes it depends on not overwriting.
    expect(names.indexOf(SEEDED)).toBeGreaterThan(names.indexOf(boxes!));
    const rivals = names.filter((n) => {
      if (n === SEEDED) return false;
      const text = readFileSync(join(ROOT, "migrations", n), "utf8");
      return /INSERT INTO radiology_protocols[\s\S]{0,300}'MRI Dorsal Spine'/i.test(text)
        // Only the PROTOCOLS table: zzzzzzzzzzzzzzzzzzzzzzz_mri_spine_tab_segment_text.sql
        // legitimately rewrites a tab's own fallback sentence under an exact-match guard.
        || /UPDATE\s+radiology_protocols\s+SET[\s\S]{0,120}technique_text/i.test(text);
    });
    expect(rivals, `another seed already owns this: ${rivals.join(", ")}`).toEqual([]);
  });
});
