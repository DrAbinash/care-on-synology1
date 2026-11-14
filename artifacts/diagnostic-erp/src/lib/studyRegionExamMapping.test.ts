import { describe, it, expect } from "vitest";
import {
  filterRegionNamesForModality,
  primaryExaminationClause,
  resolveAutoStudyRegion,
} from "./studyRegion";

/**
 * Item 9 of the 13-November review: examination / anatomy / protocol mapping.
 *
 * Every fixture name below is copied from live data, not invented:
 *   - the tabs are the two active CT brain rows of `radiology_study_tabs`
 *     (id 57 "CT Brain Plain", sortOrder 900, 1 active protocol; id 58
 *     "CT Brain Contrast", sortOrder 901, 0 active protocols);
 *   - the names are `bills`→`order_tests`→`diagnostic_tests.test_name` strings
 *     with their 90-day volumes: NCCT HEAD 535, CT BRAIN 494,
 *     CE / CONTRAST CT BRAIN 58, CT CONTRAST BRAIN 18.
 * "WITH CONTRAST" spellings are not billed today; they are in the committed
 * catalogue (`DYNAMIC MR SELLA WITH CONTRAST`, `MRI NECK (PLAIN WITH CONTRAST)`
 * in `scripts/src/import-test-catalog.ts`), which is what a fresh database is
 * seeded from, so they are pinned here rather than left to the next install.
 */

const CT_BRAIN_TABS = ["CT Brain Plain", "CT Brain Contrast"];
/** The same two rows with the sortOrder tie broken the other way. */
const CT_BRAIN_TABS_CONTRAST_FIRST = ["CT Brain Contrast", "CT Brain Plain"];
const CT_ABDOMEN_TABS = ["CT Abdomen Plain", "CECT Abdomen"];
const CT_ABDOMEN_TABS_CECT_FIRST = ["CECT Abdomen", "CT Abdomen Plain"];

function open(
  billedTestName: string,
  orderedRegionNames: string[] = CT_BRAIN_TABS,
  modality = "CT",
): string | null {
  return resolveAutoStudyRegion({ modality, billedTestName, orderedRegionNames }).region;
}

describe("the contrast state the bill asserts decides which tab of the same anatomy opens", () => {
  it("keeps a study that says no contrast on the plain tab", () => {
    // Before the veto these two resolved the CONTRAST tab: within the shared
    // anatomy the qualifier only ever added a bonus, so a tab named "Contrast"
    // could win a study whose own name denied contrast.
    expect(open("CT BRAIN WITHOUT CONTRAST")).toBe("CT Brain Plain");
    expect(open("CT BRAIN NON CONTRAST")).toBe("CT Brain Plain");
  });

  it("answers the same whichever of the two tabs the clinic sorts first", () => {
    // The old answer came out of sortOrder, not out of the examination: with
    // the contrast row first, a non-contrast brain had no rule against it.
    expect(open("NCCT BRAIN", CT_BRAIN_TABS_CONTRAST_FIRST)).toBe("CT Brain Plain");
    expect(open("CT BRAIN WITHOUT CONTRAST", CT_BRAIN_TABS_CONTRAST_FIRST)).toBe("CT Brain Plain");
  });

  it("routes the contrast study to the contrast tab", () => {
    expect(open("CE / CONTRAST CT BRAIN")).toBe("CT Brain Contrast");
    expect(open("CT CONTRAST BRAIN")).toBe("CT Brain Contrast");
    expect(open("CT BRAIN WITH CONTRAST")).toBe("CT Brain Contrast");
    expect(open("CT CONTRAST BRAIN", CT_BRAIN_TABS_CONTRAST_FIRST)).toBe("CT Brain Contrast");
  });

  it("reads a two-phase study as contrast, which is what was given", () => {
    // `both` is a phase description, not a denial, so it must not be vetoed out
    // of the contrast tab — every enhanced MRI in the clinic is written this way.
    expect(open("CT BRAIN WITH AND WITHOUT CONTRAST")).toBe("CT Brain Contrast");
    expect(open("CT BRAIN WITH AND WITHOUT CONTRAST", CT_BRAIN_TABS_CONTRAST_FIRST)).toBe("CT Brain Contrast");
  });

  it("never treats silence as a side of the argument", () => {
    // "CT BRAIN" names no qualifier, so both tabs stay eligible and the
    // display-order tie-break is untouched — nothing that resolved before
    // stops resolving.
    expect(open("CT BRAIN")).toBe("CT Brain Plain");
    expect(open("CT BRAIN", CT_BRAIN_TABS_CONTRAST_FIRST)).toBe("CT Brain Contrast");
  });

  it("resolves the 535 NCCT HEAD examinations, which reached no Study Tab at all", () => {
    // `head` and `brain` are the same examination in this clinic's own naming:
    // `radiologyQuickAddData.ts` keywords the CT Brain study as "ct head" /
    // "head ct", and the golden CT-Brain-Plain case writes its technique as
    // "Plain CT head without contrast". Measured before the mapping landed,
    // "NCCT HEAD" was the largest single unresolved name in the 90-day census.
    expect(open("NCCT HEAD")).toBe("CT Brain Plain");
  });
});

describe("CECT / NCCT spellings name a CT tab", () => {
  it("offers a CECT tab to the CT study and not to the MRI study", () => {
    // `regionTabModalityFamily` read "CECT Abdomen" as GENERIC, which is
    // exactly backwards for both callers of this filter: CT keeps only CT,
    // MR keeps only GENERIC.
    expect(filterRegionNamesForModality(CT_ABDOMEN_TABS, "CT")).toEqual(CT_ABDOMEN_TABS);
    expect(filterRegionNamesForModality(CT_ABDOMEN_TABS, "MR")).toEqual([]);
  });

  it("keeps a plain abdomen off the contrast tab even when it sorts first", () => {
    expect(open("CECT ABDOMEN", CT_ABDOMEN_TABS)).toBe("CECT Abdomen");
    expect(open("CT ABDOMEN WITHOUT CONTRAST", CT_ABDOMEN_TABS)).toBe("CT Abdomen Plain");
    expect(open("NCCT ABDOMEN", CT_ABDOMEN_TABS_CECT_FIRST)).toBe("CT Abdomen Plain");
  });

  it("still prefers the tab whose own qualifier the name repeats", () => {
    expect(open("CECT ABDOMEN", CT_ABDOMEN_TABS_CECT_FIRST)).toBe("CECT Abdomen");
  });

  it("opens a CECT tab for a name that spells the contrast out instead of abbreviating it", () => {
    // "cect" / "ncct" describe how the study was acquired, not what body part it
    // covers. While they sat in the anatomy-token set a tab named "CECT Abdomen"
    // demanded that the billed name repeat C-E-C-T, so the same examination
    // written out matched no tab at all — measured, mutant resolves null.
    expect(open("CT ABDOMEN WITH CONTRAST", CT_ABDOMEN_TABS)).toBe("CECT Abdomen");
    expect(open("CONTRAST CT ABDOMEN", CT_ABDOMEN_TABS)).toBe("CECT Abdomen");
    expect(open("CT ABDOMEN WITH CONTRAST", CT_ABDOMEN_TABS_CECT_FIRST)).toBe("CECT Abdomen");
  });
});

describe("primaryExaminationClause — a qualifier is not a second examination", () => {
  it("does not cut the contrast qualifier off the anatomy it qualifies", () => {
    expect(primaryExaminationClause("CT BRAIN WITH CONTRAST")).toBe("CT BRAIN WITH CONTRAST");
    expect(primaryExaminationClause("CT BRAIN WITH AND WITHOUT CONTRAST")).toBe(
      "CT BRAIN WITH AND WITHOUT CONTRAST",
    );
    expect(primaryExaminationClause("DYNAMIC MR SELLA WITH CONTRAST")).toBe(
      "DYNAMIC MR SELLA WITH CONTRAST",
    );
  });

  it("still cuts a supplementary anatomy clause, which is what RIS-001 needs", () => {
    expect(primaryExaminationClause("MRI LS SPINE WITH SCREENING WHOLE SPINE").trim()).toBe(
      "MRI LS SPINE",
    );
    expect(primaryExaminationClause("MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING").trim()).toBe(
      "MRI CERVICAL SPINE",
    );
    expect(primaryExaminationClause("MRI BRAIN + CX SCR").trim()).toBe("MRI BRAIN");
  });

  it("cuts after a qualified clause at the next connective, not at the qualifier", () => {
    expect(primaryExaminationClause("MRI BRAIN WITH CONTRAST AND CX SCR").trim()).toBe(
      "MRI BRAIN WITH CONTRAST",
    );
  });
});

describe("coverage is unchanged for a combined examination", () => {
  it("widens to the screening region without moving the format owner", () => {
    const tabs = ["Brain", "LS Spine", "Whole Spine", "Whole Spine Screening"];
    const r = resolveAutoStudyRegion({
      modality: "MR",
      billedTestName: "MRI LS SPINE WITH SCREENING WHOLE SPINE",
      orderedRegionNames: tabs,
    });
    expect(r.region).toBe("LS Spine");
    expect(r.regions.length).toBeGreaterThan(1);
    expect(r.regions[0]).toBe("LS Spine");
  });
});
