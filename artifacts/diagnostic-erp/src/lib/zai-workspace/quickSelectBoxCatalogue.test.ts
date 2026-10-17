/**
 * The strip's read path onto the database box catalogue.
 *
 * These are the guarantees that make deleting the localStorage tile strip safe:
 * a box reaches the section it was authored for, the ten cross-region boxes the
 * seed wrote with `study_type = ''` still reach every region, a multi-region
 * study still sees all of its segments, and nothing about a box's clinical
 * ownership is lost on the way to the chip.
 */
import { describe, expect, it } from "vitest";
import {
  lookupBoxesForContext,
  quickSelectBoxField,
  quickSelectBoxSentence,
  quickSelectBoxTile,
  quickSelectBoxWrittenText,
  type QuickSelectCatalogueBox,
} from "./quickSelectBoxCatalogue";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { matchStudyRegion } from "../studyRegion";

const REGIONS = ["Brain", "Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine"];

function ctxFor(description: string) {
  const region = matchStudyRegion(`MR ${description}`, REGIONS);
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: description,
    regions: region ? [region] : [],
    source: region ? "auto" : "unresolved",
  });
}

function box(over: Partial<QuickSelectCatalogueBox> & { id: number; label: string }): QuickSelectCatalogueBox {
  return {
    studyType: "",
    findingText: "",
    impressionText: "",
    techniqueText: "",
    recommendationText: "",
    ...over,
  };
}

describe("which section a box belongs to", () => {
  it("reads the field column, so a findings box is never offered in Impression", () => {
    const boxes = [
      box({ id: 1, label: "Disc bulge", field: "findings", studyType: "LS Spine", findingText: "Disc bulge at L4-L5." }),
      box({ id: 2, label: "Follow-up scan", field: "impression", studyType: "LS Spine", impressionText: "Follow-up scan advised." }),
    ];
    const impression = lookupBoxesForContext(boxes, "impression", "MR", ctxFor("MRI LS Spine"));
    expect(impression.map((b) => b.id)).toEqual([2]);
    const findings = lookupBoxesForContext(boxes, "findings", "MR", ctxFor("MRI LS Spine"));
    expect(findings.map((b) => b.id)).toEqual([1]);
  });

  it("falls back to findings when field is absent, because that is the column default", () => {
    expect(quickSelectBoxField(box({ id: 1, label: "x" }))).toBe("findings");
    expect(quickSelectBoxField(box({ id: 1, label: "x", field: "   " }))).toBe("findings");
  });

  it("falls back rather than inventing a section for a value the union does not have", () => {
    expect(quickSelectBoxField(box({ id: 1, label: "x", field: "conclusion" }))).toBe("findings");
  });

  it("shows the sentence this section owns", () => {
    const b = box({
      id: 1,
      label: "x",
      field: "impression",
      findingText: "Findings prose.",
      impressionText: "Impression prose.",
      techniqueText: "Technique prose.",
      recommendationText: "Advice prose.",
    });
    expect(quickSelectBoxSentence(b, "impression")).toBe("Impression prose.");
    expect(quickSelectBoxSentence(b, "findings")).toBe("Findings prose.");
    expect(quickSelectBoxSentence(b, "technique")).toBe("Technique prose.");
    expect(quickSelectBoxSentence(b, "recommendation")).toBe("Advice prose.");
  });

  it("reads a clinicalHistory box out of findingText, where the seed put it", () => {
    // primaryTextField() has no clinicalHistory arm, so the seed wrote those 11
    // tiles' sentences into finding_text. A history strip that read a column the
    // seed never wrote would render eleven empty chips.
    const b = box({ id: 1, label: "Trauma", field: "clinicalHistory", findingText: "Road traffic accident." });
    expect(quickSelectBoxSentence(b, "clinicalHistory")).toBe("Road traffic accident.");
  });
});

describe("region scoping reuses the strip's existing matcher", () => {
  const boxes = [
    box({ id: 1, label: "Brain box", field: "findings", studyType: "Brain", findingText: "Brain prose." }),
    box({ id: 2, label: "Cervical box", field: "findings", studyType: "Cervical Spine", findingText: "Cervical prose." }),
    box({ id: 3, label: "LS box", field: "findings", studyType: "LS Spine", findingText: "LS prose." }),
    box({ id: 4, label: "Cross-region box", field: "findings", studyType: "", findingText: "Clinical correlation." }),
  ];

  it("offers the region's own boxes and the cross-region ones, and nothing else", () => {
    const got = lookupBoxesForContext(boxes, "findings", "MR", ctxFor("MRI Brain Plain"));
    expect(got.map((b) => b.label).sort()).toEqual(["Brain box", "Cross-region box"]);
  });

  it("keeps the seed's study_type='' sentinel working for every region", () => {
    // The ten cross-region boxes are the only reason a ''-row exists at all; if
    // the read path dropped them they would be unreachable and the seed would
    // have shipped ten dead rows.
    for (const description of ["MRI Brain Plain", "MRI Cervical Spine", "MRI LS Spine"]) {
      const got = lookupBoxesForContext(boxes, "findings", "MR", ctxFor(description));
      expect(got.map((b) => b.label), description).toContain("Cross-region box");
    }
  });

  it("ranks the region's own box ahead of a cross-region one", () => {
    const got = lookupBoxesForContext(boxes, "findings", "MR", ctxFor("MRI Brain Plain"));
    expect(got[0]?.label).toBe("Brain box");
  });

  it("widens a Whole Spine study to all three segments, as the tile strip already did", () => {
    const got = lookupBoxesForContext(boxes, "findings", "MR", ctxFor("MRI Whole Spine"));
    expect(got.map((b) => b.label).sort()).toEqual(["Cervical box", "Cross-region box", "LS box"]);
  });

  it("does not widen into a region that is not part of the study", () => {
    const got = lookupBoxesForContext(boxes, "findings", "MR", ctxFor("MRI Whole Spine"));
    expect(got.map((b) => b.label)).not.toContain("Brain box");
  });

  it("offers nothing region-scoped when no region resolved, only the cross-region boxes", () => {
    const unresolved = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "",
      regions: [],
      source: "unresolved",
    });
    const got = lookupBoxesForContext(boxes, "findings", "MR", unresolved);
    expect(got.map((b) => b.label)).toEqual(["Cross-region box"]);
  });

  it("drops a box whose own sentence for this section is empty", () => {
    // Offered but unwritable: clicking it would write only the other sections it
    // carries, so an Impression click changes Findings and leaves Impression alone.
    const hollow = [
      box({ id: 1, label: "Hollow", field: "impression", studyType: "Brain", impressionText: "   ", findingText: "Findings prose." }),
      box({ id: 2, label: "Solid", field: "impression", studyType: "Brain", impressionText: "Impression prose." }),
    ];
    const got = lookupBoxesForContext(hollow, "impression", "MR", ctxFor("MRI Brain Plain"));
    expect(got.map((b) => b.label)).toEqual(["Solid"]);
  });
});

describe("the parameter scan sees every sentence one click writes", () => {
  it("finds a {side} carried only in Technique", () => {
    // The defect this closes: inference and the refusal guard both read all four
    // columns, so a box like this declares laterality and refuses until a side is
    // chosen. A strip that scanned only the tile's three sentence fields would
    // offer no side chip, and the box could never be applied at all.
    const b = box({
      id: 1,
      label: "Sided technique",
      field: "findings",
      studyType: "Knee",
      findingText: "Effusion present.",
      techniqueText: "{side} knee imaged.",
    });
    expect(quickSelectBoxWrittenText(b)).toContain("{side}");
    expect(quickSelectBoxTile(b, "findings").sentence).not.toContain("{side}");
  });

  it("reports no parameter for a box that carries none", () => {
    const b = box({ id: 1, label: "Plain", field: "findings", findingText: "No parameter here." });
    expect(quickSelectBoxWrittenText(b)).not.toContain("{");
  });
});

describe("nothing clinical is lost on the way to the chip", () => {
  it("carries concept, ownership, properties and chrome onto the tile", () => {
    const b = box({
      id: 42,
      label: "Foraminal stenosis",
      field: "findings",
      studyType: "Cervical Spine",
      scopeModality: "MR",
      mnemonic: "FS",
      category: "abnormal",
      concept: "foraminal_stenosis",
      anatomicalSection: "C5-C6",
      conflictGroup: "stenosis",
      baselineReplaces: "No foraminal stenosis.",
      properties: '{"slot":"foraminal"}',
      findingText: "{side} neural foraminal stenosis at C5-C6.",
    });
    const tile = quickSelectBoxTile(b, "findings");
    expect(tile.id).toBe("42");
    expect(tile.scopeBodyPart).toBe("Cervical Spine");
    expect(tile.scopeModality).toBe("MR");
    expect(tile.mnemonic).toBe("FS");
    expect(tile.category).toBe("abnormal");
    expect(tile.concept).toBe("foraminal_stenosis");
    expect(tile.anatomicalSection).toBe("C5-C6");
    expect(tile.conflictGroup).toBe("stenosis");
    expect(tile.baselineReplaces).toBe("No foraminal stenosis.");
    expect(tile.properties).toBe('{"slot":"foraminal"}');
  });

  it("normalizes a category the chrome has no colour for, instead of rendering undefined", () => {
    expect(quickSelectBoxTile(box({ id: 1, label: "x", category: "incidental" }), "findings").category).toBe("normal");
    expect(quickSelectBoxTile(box({ id: 1, label: "x", category: null }), "findings").category).toBe("normal");
    expect(quickSelectBoxTile(box({ id: 1, label: "x" }), "findings").category).toBe("normal");
  });

  it("leaves an empty ownership column undefined, because '' is a sentence to the engine", () => {
    // quickFindingPatch's own comment: an empty baselineReplaces is not "no
    // baseline", it is a sentence to look for.
    const tile = quickSelectBoxTile(
      box({ id: 1, label: "x", concept: "", anatomicalSection: "", conflictGroup: "", baselineReplaces: "" }),
      "findings",
    );
    expect(tile.concept).toBeUndefined();
    expect(tile.anatomicalSection).toBeUndefined();
    expect(tile.conflictGroup).toBeUndefined();
    expect(tile.baselineReplaces).toBeUndefined();
  });
});
