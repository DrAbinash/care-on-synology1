import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterRegionNamesForModality,
  resolveAutoStudyRegion,
} from "./studyRegion";
import { protocolsForStudyTabDetailed, quickFindingsForStudyTab } from "./pickQuickProtocol";
import { contentStudyTypes } from "./reportingStudyContext";

// -----------------------------------------------------------------------------
// What this suite exists for, measured before the fix (2026-11-08).
//
// Clinic database (`care-db`):
//   radiology_study_tabs  111 rows, NONE naming the Dorso-Lumbar examination.
//   radiology_protocols    85 rows, 14 of them MRI, NONE naming dorso-lumbar,
//                          and every row already carries a study_tab_id.
//   Spine (id 2) and Dorsal Spine (id 4) have ZERO protocols filed under them;
//   LS Spine (id 5) has exactly one — "MRI LS Spine".
//   24 of 13,304 radiology_worklist rows describe a dorso-lumbar study and all 24
//   use the abbreviation (16 plain `DL SPINE`, then `DL SPINE SCREENING`,
//   `DL SPINE + CON`, `DL SPINE WSS`, `CX+DL SPINE`); none spell it out.
//   `diagnostic_tests` books it as MRI020 / "MRI DL SPINE".
//
// The migrate-built local catalogue (factory seeds only) gives the same shape at
// 110 tabs / 81 protocols / 13 MRI rows, so neither reading is a clinic artifact.
//
// Which is why the two resolutions below both fail: "MRI DL SPINE" lands on the
// generic Spine tab, which owns no protocol, so the Technique dropdown has
// NOTHING to offer; "MRI DORSO LUMBAR SPINE" lands on LS Spine, whose only entry
// is the lumbar acquisition statement. PR #1293 taught the RESOLVER these
// spellings and the shared classifier already calls the answer segment
// `dorsolumbar`; the seed that gives it a tab to land on is what this migration
// adds. Nothing here invents clinical wording — the technique and normal
// sentences are the owned baseline's own.
// -----------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DL_TAB = "Dorso-Lumbar Spine";
const DL_PROTOCOL = "MRI Dorso-Lumbar Spine";

/** The generic, MR-visible spine tabs, in shipped sortOrder order. */
const MRI_TABS = [
  "Brain", "Spine", "Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine", DL_TAB,
];

const seeded = read("migrations/zzzzzzzzzzzzzzzzzzzzzzzz_mri_dorsolumbar_technique_protocol.sql");
const defaults = read("artifacts/api-server/src/lib/radiologyReportingDefaults.ts");
const ownedBaseline = read(
  "artifacts/diagnostic-erp/src/lib/zai-workspace/baselines/mriDorsoLumbarStandardNormal.ts",
);

/** The one technique sentence the repo already owns for this examination. */
const baselineTechnique = ownedBaseline.match(
  /technique:\s*\n?\s*"((?:[^"\\]|\\.)*)",/,
)?.[1] ?? "";
const baselineImpression = ownedBaseline.match(
  /impression:\s*\n?\s*"((?:[^"\\]|\\.)*)",/,
)?.[1] ?? "";

/** A row shaped like the shipped radiology_protocols rows the API returns. */
const protocol = (over: Record<string, unknown>) => ({
  id: 1, name: "", studyType: "", modality: "MRI", techniqueText: "",
  isGoldStandard: true, isDefault: true, sortOrder: 100, isActive: true, ...over,
});

describe("MRI Dorso-Lumbar Technique dropdown entry", () => {
  it("1. the technique line is the owned baseline's own sentence — one sentence, one owner", () => {
    expect(baselineTechnique).toContain("dorso-lumbar");
    expect(defaults).toContain(baselineTechnique);
    expect(seeded).toContain(baselineTechnique.replace(/'/g, "''"));
  });

  it("2. the factory catalogue ships a Dorso-Lumbar protocol on its own Study Tab", () => {
    const entry = defaults.match(
      /\{\s*name:\s*"MRI Dorso-Lumbar Spine",\s*studyType:\s*"([^"]*)",\s*modality:\s*"([^"]*)"[\s\S]{0,400}?isDefault:\s*(true|false),\s*sortOrder:\s*(\d+)/,
    );
    expect(entry, "PROTOCOL_DEFAULTS must carry an MRI Dorso-Lumbar Spine row").not.toBeNull();
    expect(entry![1]).toBe(DL_TAB);
    expect(entry![2]).toBe("MRI");
    expect(entry![3]).toBe("true");
    expect(Number(entry![4])).toBeGreaterThan(0);
    // The restore-defaults mirror and the seed must not drift into two sentences.
    expect(defaults).toContain(baselineImpression);
    expect(seeded).toContain(baselineImpression.replace(/'/g, "''"));
  });

  it("3. the seed creates the tab and files the protocol under it by subselect, never a hard-coded id", () => {
    // Anchored INSIDE each statement: a greedy [\s\S]* would let the tab INSERT
    // pass while naming a different tab, because the name appears again later.
    expect(seeded).toMatch(/INSERT INTO radiology_study_tabs[^;]*'Dorso-Lumbar Spine'[^;]*45/);
    expect(seeded).toMatch(/ON CONFLICT \(name\) DO NOTHING/);
    expect(seeded).toMatch(/INSERT INTO radiology_protocols[^;]*'MRI Dorso-Lumbar Spine', 'Dorso-Lumbar Spine', 'MRI'/);
    expect(seeded).toMatch(/ON CONFLICT DO NOTHING/);
    // The tab id must come from a name lookup, never from an assumed id.
    expect(seeded).toMatch(
      /SELECT id INTO \w+\s+FROM radiology_study_tabs\s+WHERE name = 'Dorso-Lumbar Spine'/);
    const insert = seeded.slice(seeded.indexOf("INSERT INTO radiology_protocols"));
    expect(insert.slice(0, 700), "the protocol must carry the looked-up id")
      .toMatch(/dl_tab_id/);
    expect(insert.slice(0, 700)).not.toMatch(/study_tab_id[\s\S]{0,40}\b\d{1,4}\b/);
    // Idempotence has to survive a re-run on a database that already has the row.
    expect(seeded).toMatch(/IF NOT EXISTS[\s\S]*radiology_study_tabs/);
  });

  it("4. every booked Dorso-Lumbar spelling resolves to its own tab, billed and DICOM", () => {
    for (const hint of ["DL SPINE", "MRI DL SPINE", "MRI DORSO LUMBAR SPINE",
      "MRI Dorsolumbar Spine", "MRI DORSOLUMBAR SPINE", "MRI THORACOLUMBAR SPINE"]) {
      const asBilled = resolveAutoStudyRegion({ modality: "MR", billedTestName: hint, orderedRegionNames: MRI_TABS });
      const asDicom = resolveAutoStudyRegion({ modality: "MR", studyDescription: hint, orderedRegionNames: MRI_TABS });
      expect(`${hint} billed -> ${asBilled.region}`).toBe(`${hint} billed -> ${DL_TAB}`);
      expect(`${hint} dicom -> ${asDicom.region}`).toBe(`${hint} dicom -> ${DL_TAB}`);
      expect(asBilled.regions).toEqual([DL_TAB]);
    }
  });

  it("5. a lumbar, dorsal or cervical booking still lands on its own tab — the new row steals nothing", () => {
    const plain: Array<[string, string]> = [
      ["MRI LS SPINE", "LS Spine"],
      ["MRI LUMBAR SPINE", "LS Spine"],
      ["MRI CERVICAL SPINE", "Cervical Spine"],
      ["MRI DORSAL SPINE", "Dorsal Spine"],
      ["MRI WHOLE SPINE", "Whole Spine"],
      ["MRI BRAIN", "Brain"],
    ];
    for (const [hint, want] of plain) {
      expect(resolveAutoStudyRegion({ modality: "MR", billedTestName: hint, orderedRegionNames: MRI_TABS }).region,
        hint).toBe(want);
      expect(resolveAutoStudyRegion({ modality: "MR", billedTestName: hint, orderedRegionNames: MRI_TABS }).region)
        .not.toBe(DL_TAB);
    }
  });

  it("6. the X-ray and CT Dorso-Lumbar films never reach the MR-only tab", () => {
    // The tab carries no modality prefix, so the modality filter keeps it out of
    // the CR/CT/DX region lists — and a radiograph cannot be filed under an MRI
    // acquisition statement even by a manual pick.
    for (const modality of ["CR", "DX", "CT"]) {
      const list = filterRegionNamesForModality(MRI_TABS, modality);
      expect(list, modality).not.toContain(DL_TAB);
      expect(resolveAutoStudyRegion({
        modality, billedTestName: modality === "CT" ? "CT DL SPINE" : "XRAY DL SPINE AP/LAT",
        orderedRegionNames: list,
      }).region, modality).not.toBe(DL_TAB);
    }
  });

  it("7. the dropdown pool for a Dorso-Lumbar study offers the DL technique, not the LS one", () => {
    const LS = protocol({ id: 10, name: "MRI LS Spine", studyType: "LS Spine", studyTabId: 5, sortOrder: 100,
      techniqueText: "Multiplanar multisequence MRI of the lumbosacral spine was performed including T1, T2, and STIR sequences." });
    const DL = protocol({ id: 13, name: DL_PROTOCOL, studyType: DL_TAB, studyTabId: 120, sortOrder: 105,
      techniqueText: baselineTechnique });
    const dlPool = protocolsForStudyTabDetailed([LS, DL], 120, DL_TAB).matched;
    expect(dlPool.map((p) => p.name)).toEqual([DL_PROTOCOL]);
    expect(dlPool[0]!.techniqueText).toBe(baselineTechnique);
    // The plain lumbar study still sees exactly its own row.
    expect(protocolsForStudyTabDetailed([LS, DL], 5, "LS Spine").matched.map((p) => p.name)).toEqual(["MRI LS Spine"]);
  });

  it("8. the shipped technique line names no unfilled slot and claims no fixed vertebral range", () => {
    expect(baselineTechnique).not.toMatch(/\[|\bTBD\b|…/);
    // The library's own prohibition: a Dorso-Lumbar study must not imply T1-S1.
    expect(baselineTechnique.toLowerCase()).not.toMatch(/t1\s*(?:to|-|through)\s*s1/);
  });

  it("9. giving the examination its own tab does not empty its Quick Findings panel", () => {
    // The panel matches boxes by tab id first and by the exact region name
    // second, and `radiology_quick_findings` has no Dorso-Lumbar rows — creating
    // the tab must not take away the spine boxes the study showed before it.
    const spineBoxes = [
      { id: 1, studyType: "Spine", studyTabId: null, isActive: true, sortOrder: 10, label: "Degenerative changes" },
      { id: 2, studyType: "LS Spine", studyTabId: null, isActive: true, sortOrder: 10, label: "L4-L5 disc bulge" },
    ];
    const own = quickFindingsForStudyTab(spineBoxes as never, 120, DL_TAB).matched;
    expect(own, "the new tab has no boxes of its own — this is the state the panel must survive").toHaveLength(0);
    // …and the classifier's inheritance rule is what the panel falls back to.
    expect(contentStudyTypes([DL_TAB])).toContain("Spine");
    expect(contentStudyTypes([DL_TAB])).not.toContain("LS Spine");
    const inherited = spineBoxes.filter((f) => contentStudyTypes([DL_TAB]).includes(f.studyType));
    expect(inherited.map((f) => f.label)).toEqual(["Degenerative changes"]);
    // A region that carries its own rows is untouched by the fallback.
    expect(quickFindingsForStudyTab(spineBoxes as never, 5, "LS Spine").matched.map((f) => f.label))
      .toEqual(["L4-L5 disc bulge"]);
  });

  it("10. no other seed claims this tab or this protocol, and mine runs after the factory boxes", () => {
    // Feature migrations run in filename order. Two seeds writing the same
    // natural key would make the shipped row depend on which one landed first,
    // and a seed before the Quick Select factory boxes could be overwritten by
    // them — so pin both the uniqueness and the order.
    const dir = join(ROOT, "migrations");
    const names = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
    const mine = "zzzzzzzzzzzzzzzzzzzzzzzz_mri_dorsolumbar_technique_protocol.sql";
    const boxes = names.find((n) => n.includes("quick_select_factory_boxes"));
    expect(names.indexOf(mine)).toBeGreaterThan(-1);
    expect(boxes).toBeTruthy();
    expect(names.indexOf(mine)).toBeGreaterThan(names.indexOf(boxes!));
    const seeders = names.filter((n) => {
      if (n === mine) return false;
      const text = readFileSync(join(dir, n), "utf8");
      return /INSERT INTO radiology_(study_tabs|protocols)[\s\S]*'(?:Dorso-Lumbar Spine|MRI Dorso-Lumbar Spine)'/i.test(text);
    });
    expect(seeders, `duplicate seed rows: ${seeders.join(", ")}`).toEqual([]);
  });
});
