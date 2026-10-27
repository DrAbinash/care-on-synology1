import { describe, it, expect } from "vitest";
import {
  filterRegionNamesForModality,
  matchStudyRegion,
  matchStudyRegionByCoreAnatomy,
  nextStudyRegions,
  resolveAutoStudyRegion,
} from "./studyRegion";

// Region names in display (sortOrder) order — generic modality-neutral regions
// sort before the modality-prefixed CT tabs, exactly as radiology_study_tabs is
// seeded (generic Brain/Spine/Abdomen at low sort_order, "CT …" tabs at 900+).
const REGIONS = [
  "Brain",
  "Cervical Spine",
  "Spine",
  "Abdomen",
  "Chest",
  "CT Brain Plain",
  "CT Cervical Spine",
  "CT Chest Plain",
  "CT Whole Abdomen",
];

describe("matchStudyRegion — most-specific (longest) wins", () => {
  it("routes a CT study to its CT tab, not the shorter generic region", () => {
    // The workspace passes `${modality} ${studyDescription}` as the hint.
    expect(matchStudyRegion("CT CT Brain Plain", REGIONS)).toBe("CT Brain Plain");
    expect(matchStudyRegion("CT CT Cervical Spine", REGIONS)).toBe("CT Cervical Spine");
    expect(matchStudyRegion("CT CT Chest Plain", REGIONS)).toBe("CT Chest Plain");
    expect(matchStudyRegion("CT CT Whole Abdomen", REGIONS)).toBe("CT Whole Abdomen");
  });

  it("does NOT regress the single-match generic regions (MRI/other modalities)", () => {
    expect(matchStudyRegion("MRI Brain", REGIONS)).toBe("Brain");
    expect(matchStudyRegion("MRI Cervical Spine", REGIONS)).toBe("Cervical Spine");
    expect(matchStudyRegion("USG Abdomen", REGIONS)).toBe("Abdomen");
  });

  it("is case-insensitive and tolerates null/empty hints", () => {
    expect(matchStudyRegion("ct brain plain study", REGIONS)).toBe("CT Brain Plain");
    expect(matchStudyRegion(null, REGIONS)).toBeNull();
    expect(matchStudyRegion("", REGIONS)).toBeNull();
    expect(matchStudyRegion("Nuclear medicine bone scan", REGIONS)).toBeNull();
  });

  it("breaks ties by display order (first / lowest sortOrder among equal length)", () => {
    // Two equally-long region names both substring-match → the earlier one wins.
    expect(matchStudyRegion("scan AA BB extra", ["AA", "BB"])).toBe("AA");
  });
});

describe("filterRegionNamesForModality", () => {
  const MIXED = [
    "Brain",
    "Cervical Spine",
    "CT Brain Plain",
    "CT Cervical Spine",
    "X-Ray Chest PA",
    "X-Ray Ankle",
    "USG Abdomen",
  ];

  it("keeps generic MRI regions and drops CT / X-Ray / USG tabs", () => {
    expect(filterRegionNamesForModality(MIXED, "MR")).toEqual(["Brain", "Cervical Spine"]);
    expect(filterRegionNamesForModality(MIXED, "MRI")).toEqual(["Brain", "Cervical Spine"]);
  });

  it("keeps only CT-prefixed tabs for CT studies", () => {
    expect(filterRegionNamesForModality(MIXED, "CT")).toEqual(["CT Brain Plain", "CT Cervical Spine"]);
  });

  it("keeps only X-Ray tabs for CR/DX", () => {
    expect(filterRegionNamesForModality(MIXED, "CR")).toEqual(["X-Ray Chest PA", "X-Ray Ankle"]);
  });
});

describe("nextStudyRegions — last-clicked becomes primary", () => {
  it("adds an unselected region as primary without dropping others", () => {
    expect(nextStudyRegions(["Brain"], "LS Spine")).toEqual(["LS Spine", "Brain"]);
  });

  it("promotes a selected non-primary region instead of deselecting it", () => {
    expect(nextStudyRegions(["LS Spine", "Brain"], "Brain")).toEqual(["Brain", "LS Spine"]);
  });

  it("deselects the current primary when other regions remain", () => {
    expect(nextStudyRegions(["Brain", "LS Spine"], "Brain")).toEqual(["LS Spine"]);
  });

  it("refuses to drop the last remaining region", () => {
    expect(nextStudyRegions(["Brain"], "Brain")).toBeNull();
  });
});

describe("resolveAutoStudyRegion — billed procedure primary, DICOM fallback", () => {
  const MRI_REGIONS = ["Brain", "Cervical Spine", "LS Spine", "Spine", "Abdomen", "Chest"];

  it("prefers billed test name over a conflicting DICOM StudyDescription", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      billedTestName: "MRI LS Spine",
      studyDescription: "MRI Brain Plain",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.source).toBe("billed");
    expect(match.region).toBe("LS Spine");
    expect(match.billedRegion).toBe("LS Spine");
    expect(match.dicomRegion).toBe("Brain");
  });

  it("falls back to DICOM when billed name does not match any Study Tab", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      billedTestName: "Special Package A",
      studyDescription: "MRI Cervical Spine",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.source).toBe("dicom");
    expect(match.region).toBe("Cervical Spine");
    expect(match.billedRegion).toBeNull();
    expect(match.dicomRegion).toBe("Cervical Spine");
  });

  it("uses billed when DICOM is empty or unmatched", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      billedTestName: "MRI Brain",
      studyDescription: "",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match).toEqual({
      region: "Brain",
      source: "billed",
      billedRegion: "Brain",
      dicomRegion: null,
    });
  });

  it("returns unresolved when neither hint matches", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      billedTestName: "Unknown package",
      studyDescription: "Nuclear medicine bone scan",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.region).toBeNull();
    expect(match.source).toBeNull();
  });
});

/**
 * Live billed-catalog evidence (test-catalog export, 2026-09-28): the centre
 * bills exactly one chest radiograph — code `XRAY-CHEST`, name `CHEST X-RAY`,
 * and the worklist delivers the modality as `CR`. The Study Tabs seeded by
 * migrations/zzzz_xr_gold_standard_content.sql are the four below. The billed
 * name is NOT a substring of any tab name ("x-ray chest pa" ∉ "cr chest x-ray",
 * word order differs), so before the token fallback this study resolved to
 * nothing and opened with no protocol, no quick findings and no content pack.
 */
describe("billed chest radiograph → Study Tab (live catalog shape)", () => {
  const LIVE_TABS = [
    "Brain",
    "Cervical Spine",
    "LS Spine",
    "CT Brain Plain",
    "CT Chest Plain",
    "X-Ray Chest PA",
    "X-Ray Chest AP",
    "X-Ray Portable Chest",
    "X-Ray Chest Lateral",
    "USG Abdomen",
  ];
  const xrTabs = filterRegionNamesForModality(LIVE_TABS, "CR");

  it("keeps only the X-Ray tabs for a CR study", () => {
    expect(xrTabs).toEqual([
      "X-Ray Chest PA",
      "X-Ray Chest AP",
      "X-Ray Portable Chest",
      "X-Ray Chest Lateral",
    ]);
  });

  it("resolves the billed CHEST X-RAY to the reference PA tab", () => {
    const match = resolveAutoStudyRegion({
      modality: "CR",
      billedTestName: "CHEST X-RAY",
      studyDescription: "",
      orderedRegionNames: xrTabs,
    });
    expect(match).toEqual({
      region: "X-Ray Chest PA",
      source: "billed",
      billedRegion: "X-Ray Chest PA",
      dicomRegion: null,
    });
  });

  it("honours the projection when the billed name or DICOM states one", () => {
    const cases: Array<[string, string]> = [
      ["X-RAY CHEST AP", "X-Ray Chest AP"],
      ["X-RAY PORTABLE CHEST", "X-Ray Portable Chest"],
      ["X-RAY CHEST LATERAL", "X-Ray Chest Lateral"],
    ];
    for (const [billed, expected] of cases) {
      const match = resolveAutoStudyRegion({
        modality: "CR",
        billedTestName: billed,
        studyDescription: "",
        orderedRegionNames: xrTabs,
      });
      expect(match.region).toBe(expected);
      expect(match.source).toBe("billed");
    }
  });

  it("still uses the DICOM StudyDescription when the billed name is generic", () => {
    const match = resolveAutoStudyRegion({
      modality: "CR",
      billedTestName: "RADIOLOGY PROCEDURE — SUNDAY PACKAGE",
      studyDescription: "PORTABLE CHEST",
      orderedRegionNames: xrTabs,
    });
    expect(match.source).toBe("dicom");
    expect(match.region).toBe("X-Ray Portable Chest");
  });

  it("does not hijack a CT or USG chest onto the plain-film tabs", () => {
    const ctTabs = filterRegionNamesForModality(LIVE_TABS, "CT");
    expect(
      resolveAutoStudyRegion({
        modality: "CT",
        billedTestName: "CT CHEST",
        studyDescription: "",
        orderedRegionNames: ctTabs,
      }).region,
    ).toBe("CT Chest Plain");
    expect(
      resolveAutoStudyRegion({
        modality: "US",
        billedTestName: "USG CHEST",
        studyDescription: "",
        orderedRegionNames: filterRegionNamesForModality(LIVE_TABS, "US"),
      }).region,
    ).toBeNull();
  });

  it("leaves an unrelated plain study unresolved instead of guessing", () => {
    const match = resolveAutoStudyRegion({
      modality: "CR",
      billedTestName: "X-RAY KUB",
      studyDescription: "",
      orderedRegionNames: xrTabs,
    });
    expect(match.region).toBeNull();
    expect(match.source).toBeNull();
  });
});

describe("matchStudyRegionByCoreAnatomy — token fallback", () => {
  const TABS = ["X-Ray Chest PA", "X-Ray Chest AP", "X-Ray Portable Chest", "X-Ray Chest Lateral"];

  it("matches on whole core-anatomy tokens only", () => {
    expect(matchStudyRegionByCoreAnatomy("cr chest x-ray", TABS)).toBe("X-Ray Chest PA");
    expect(matchStudyRegionByCoreAnatomy("CHEST", TABS)).toBe("X-Ray Chest PA");
    // "cat" contains no chest token; a partial word must never match.
    expect(matchStudyRegionByCoreAnatomy("x-ray lumbar spine", TABS)).toBeNull();
    expect(matchStudyRegionByCoreAnatomy("", TABS)).toBeNull();
    expect(matchStudyRegionByCoreAnatomy(null, TABS)).toBeNull();
  });

  it("prefers the tab sharing a projection word with the hint", () => {
    expect(matchStudyRegionByCoreAnatomy("x-ray chest ap view", TABS)).toBe("X-Ray Chest AP");
    expect(matchStudyRegionByCoreAnatomy("portable chest radiograph", TABS)).toBe("X-Ray Portable Chest");
    expect(matchStudyRegionByCoreAnatomy("chest lateral view", TABS)).toBe("X-Ray Chest Lateral");
  });

  it("never overrides a substring match (precedence unchanged)", () => {
    expect(matchStudyRegion("CR X-Ray Chest AP", TABS)).toBe("X-Ray Chest AP");
  });
});

describe("billed lumbosacral radiograph → Study Tab (live catalog shape)", () => {
  // Live test-catalog export 2026-09-28, in Study Tab sortOrder.
  const SPINE_TABS = [
    "X-Ray Dorsal Spine",
    "X-Ray Lumbar Spine",
    "X-Ray Whole Spine (Scoliosis)",
    "X-Ray Sacrum",
    "X-Ray Coccyx",
    "X-Ray Chest PA",
  ];

  it("resolves the billed 'LS SPINE' names to the lumbar Study Tab", () => {
    // `XR028` = "XRAY LS SPINE AP/LAT", `XRAYLSPINE` = "X-RAY LS SPINE LAT".
    expect(
      resolveAutoStudyRegion({
        modality: "CR",
        billedTestName: "XRAY LS SPINE AP/LAT",
        orderedRegionNames: filterRegionNamesForModality(SPINE_TABS, "CR"),
      }).region,
    ).toBe("X-Ray Lumbar Spine");
    expect(
      resolveAutoStudyRegion({
        modality: "CR",
        billedTestName: "X-RAY LS SPINE LAT",
        orderedRegionNames: filterRegionNamesForModality(SPINE_TABS, "CR"),
      }).region,
    ).toBe("X-Ray Lumbar Spine");
  });

  it("keeps the billed-name precedence over a DICOM description", () => {
    const match = resolveAutoStudyRegion({
      modality: "CR",
      billedTestName: "XRAY LS SPINE AP/LAT",
      studyDescription: "XR LUMBAR SPINE",
      orderedRegionNames: filterRegionNamesForModality(SPINE_TABS, "CR"),
    });
    expect(match.source).toBe("billed");
    expect(match.region).toBe("X-Ray Lumbar Spine");
  });

  it("does not file a dorsolumbar study under the dorsal protocol", () => {
    // `XR022` = "XRAY DL SPINE AP/LAT". A dorsolumbar film covers the
    // thoracolumbar junction; silently applying the dorsal-spine protocol would
    // report the wrong region, so it stays unresolved for a manual choice.
    expect(
      resolveAutoStudyRegion({
        modality: "CR",
        billedTestName: "XRAY DL SPINE AP/LAT",
        orderedRegionNames: filterRegionNamesForModality(SPINE_TABS, "CR"),
      }).region,
    ).toBeNull();
    // A spelled-out dorsal name still resolves by substring.
    expect(
      resolveAutoStudyRegion({
        modality: "CR",
        billedTestName: "X-RAY DORSAL SPINE AP/LAT",
        orderedRegionNames: filterRegionNamesForModality(SPINE_TABS, "CR"),
      }).region,
    ).toBe("X-Ray Dorsal Spine");
  });

  it("leaves sacrum and coccyx alone, and never cross-matches the chest", () => {
    const tabs = filterRegionNamesForModality(SPINE_TABS, "CR");
    expect(matchStudyRegionByCoreAnatomy("cr x-ray sacrum ap", tabs)).toBe("X-Ray Sacrum");
    expect(matchStudyRegionByCoreAnatomy("cr ls spine ap", tabs)).toBe("X-Ray Lumbar Spine");
    expect(matchStudyRegionByCoreAnatomy("cr ls spine ap", ["X-Ray Chest PA"])).toBeNull();
    // The chest fallback is unchanged by the lumbar synonyms.
    expect(matchStudyRegionByCoreAnatomy("cr chest x-ray", tabs)).toBe("X-Ray Chest PA");
  });
});

/**
 * The primary examination must decide the reporting format. A screening clause
 * names a SUPPLEMENTARY region, and "longest region name wins" alone let that
 * supplementary region outrank the examination the patient was actually booked
 * for: an MRI LS Spine with whole-spine screening resolved to "Whole Spine",
 * and the workspace then opened the whole-spine report — documenting cervical
 * and dorsal levels that were never the question asked.
 *
 * Region names below are the bare names as `radiology_study_tabs` is actually
 * seeded (migrations use 'LS Spine', 'Cervical Spine', 'Dorsal Spine',
 * 'Whole Spine', 'Whole Spine Screening'), and the hints are the real billed
 * names from the centre's test catalogue (MRI038, MRICEWSS, MRI037, MRI021,
 * MRI062) prefixed with the modality exactly as the workspace composes them.
 */
const SPINE_REGIONS = [
  "Brain",
  "LS Spine",
  "Cervical Spine",
  "Dorsal Spine",
  "Whole Spine",
  "Whole Spine Screening",
];

describe("matchStudyRegion — the primary examination wins over a screening region", () => {
  it("keeps LS Spine primary for 'MRI LS SPINE WITH SCREENING WHOLE SPINE'", () => {
    expect(matchStudyRegion("MR MRI LS SPINE WITH SCREENING WHOLE SPINE", SPINE_REGIONS)).toBe("LS Spine");
  });

  it("keeps Cervical Spine primary for 'MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING'", () => {
    expect(matchStudyRegion("MR MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING", SPINE_REGIONS)).toBe("Cervical Spine");
  });

  it("keeps Brain primary when the screening clause names the cervical spine", () => {
    expect(matchStudyRegion("MR MRI BRAIN WITH CERVICAL SPINE SCREENING", SPINE_REGIONS)).toBe("Brain");
  });

  it("still resolves a genuine whole-spine examination, screening variant included", () => {
    // No supplementary clause here: the whole spine IS the examination.
    expect(matchStudyRegion("MR MRI WHOLE SPINE", SPINE_REGIONS)).toBe("Whole Spine");
    expect(matchStudyRegion("MR MRI WHOLE SPINE SCREENING", SPINE_REGIONS)).toBe("Whole Spine Screening");
  });

  it("resolves a region-only screening examination to that region, not to the whole spine", () => {
    expect(matchStudyRegion("MR MRI LS SPINE SCREENING", SPINE_REGIONS)).toBe("LS Spine");
    expect(matchStudyRegion("MR MRI DORSAL SPINE SCREENING", SPINE_REGIONS)).toBe("Dorsal Spine");
    expect(matchStudyRegion("MR MRI CERVICAL SPINE SCREENING", SPINE_REGIONS)).toBe("Cervical Spine");
  });

  it("falls back to the whole examination name when the primary clause names no region", () => {
    // Nothing before the connective is an anatomy, so the screening rule must
    // not turn a resolvable study into an unresolved one.
    expect(matchStudyRegion("MR MRI WITH LS SPINE", SPINE_REGIONS)).toBe("LS Spine");
    expect(matchStudyRegion("MR MRI WITH WHOLE SPINE SCREENING", SPINE_REGIONS)).toBe("Whole Spine Screening");
    // A generic region in the primary clause still wins over the longer
    // supplementary tab: "of the spine" IS what was booked.
    expect(matchStudyRegion("MR MRI OF THE SPINE WITH WHOLE SPINE SCREENING", ["Spine", ...SPINE_REGIONS])).toBe("Spine");
  });

  it("does not change modality dispatch, which is why longest-wins exists", () => {
    expect(matchStudyRegion("CT CT Brain Plain", REGIONS)).toBe("CT Brain Plain");
    expect(matchStudyRegion("CT CT Whole Abdomen", REGIONS)).toBe("CT Whole Abdomen");
  });
});

describe("matchStudyRegionByCoreAnatomy — the same primary rule on the token fallback", () => {
  it("does not let a screening tab outrank the primary region", () => {
    // "Whole Spine Screening" scores a projection-word bonus (screening), which
    // is exactly how the fallback promoted the supplementary region today.
    expect(matchStudyRegionByCoreAnatomy("mri ls spine with whole spine screening", SPINE_REGIONS)).toBe("LS Spine");
    expect(matchStudyRegionByCoreAnatomy("mri brain with cervical spine screening", SPINE_REGIONS)).toBe("Brain");
  });

  it("keeps resolving a whole-spine screening study when that IS the examination", () => {
    expect(matchStudyRegionByCoreAnatomy("mri whole spine screening", SPINE_REGIONS)).toBe("Whole Spine Screening");
  });
});

describe("resolveAutoStudyRegion — the workspace entry point", () => {
  it("resolves the billed LS examination to LS Spine, not Whole Spine", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MR LSPINE SCREENING WHOLE SPINE",
      billedTestName: "MRI LS SPINE WITH SCREENING WHOLE SPINE",
      orderedRegionNames: SPINE_REGIONS,
    });
    expect(match.region).toBe("LS Spine");
    expect(match.source).toBe("billed");
  });

  it("keeps the billed-over-DICOM precedence intact", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MR WHOLE SPINE",
      billedTestName: "MRI LS SPINE",
      orderedRegionNames: SPINE_REGIONS,
    });
    expect(match.region).toBe("LS Spine");
    // The DICOM line says a whole spine; the billed line says the lumbar
    // examination, and the billed name is what the patient was booked for.
    expect(match.dicomRegion).toBe("Whole Spine");
  });
});

// ─── Live P1: the spelled-out / dotted lumbar descriptions (re-audit 2026-10-22) ──

describe("resolveAutoStudyRegion — scanner wording must land on the specific spine tab", () => {
  const MRI_REGIONS = ["Brain", "Cervical Spine", "LS Spine", "Spine", "Abdomen", "Chest"];

  it("a spelled-out DICOM description resolves to LS Spine, not the generic Spine tab", () => {
    // Live failure: direct open / reload of a billed MRI LS Spine study fell to
    // the generic "Spine" tab because the scanner description spelled the
    // anatomy out ("lumbar") and "lumbar" substring-matched only "Spine" —
    // protocol unattached, Smart Dictation gate dead, readiness 30/100.
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI LUMBAR SPINE WO",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.region).toBe("LS Spine");
    expect(match.source).toBe("dicom");
  });

  it("a dotted abbreviation (\"L.S. SPINE\") resolves to LS Spine", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI L.S. SPINE",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.region).toBe("LS Spine");
  });

  it("a spaced abbreviation (\"L S SPINE\") resolves to LS Spine", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "L S SPINE",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.region).toBe("LS Spine");
  });

  it("lumbosacral wording resolves to LS Spine", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MR LUMBOSACRAL SPINE",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.region).toBe("LS Spine");
  });

  it("the billed name still wins over the DICOM description", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      billedTestName: "MRI LS SPINE",
      studyDescription: "MRI LUMBAR SPINE WO",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.source).toBe("billed");
    expect(match.region).toBe("LS Spine");
  });

  it("the upgrade never swaps sideways: an equally specific core match loses to the substring answer", () => {
    // "mri cervical spine" substring-resolves to Cervical Spine; a core match
    // of LS Spine is NOT more specific (2 tokens each) and must not replace it.
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI CERVICAL SPINE SCREENING",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.region).toBe("Cervical Spine");
  });

  it("a generic hint stays generic — the rule upgrades, it never guesses", () => {
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI SPINE",
      orderedRegionNames: MRI_REGIONS,
    });
    expect(match.region).toBe("Spine");
  });

  it("the dorsolumbar non-decision survives the abbreviation joins", () => {
    // "dl" is deliberately unmapped: a dorsolumbar study covers the
    // thoracolumbar junction and must stay unresolved rather than be filed
    // under a protocol the patient may not have.
    const tabs = ["Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine"];
    const match = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI DL SPINE AP",
      orderedRegionNames: tabs,
    });
    expect(match.region).toBeNull();
  });

  it("a three-letter dotted abbreviation (\"T.L.S. SPINE\") reaches a TLS tab if one exists", () => {
    const ctTabs = ["CT Brain Plain", "CT Cervical Spine", "CT LS Spine", "CT TLS Spine"];
    const match = resolveAutoStudyRegion({
      modality: "CT",
      studyDescription: "CT T.L.S. SPINE",
      orderedRegionNames: ctTabs,
    });
    expect(match.region).toBe("CT TLS Spine");
  });
});
