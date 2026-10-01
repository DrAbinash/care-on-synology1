/**
 * X-ray Lumbosacral Spine NUMBERING resolver (spec §4, §6, §12, §18; library §3,
 * §14). The highest-priority safety module in this feature: a lumbar radiograph
 * report goes wrong by calling the wrong segment L5, not by missing a subtle
 * sign. Every test below is a case where CARE must either derive labels from an
 * explicit designated L5 or refuse to make level-specific claims.
 */
import { describe, expect, it } from "vitest";
import {
  CASTELLVI_TYPES,
  LS_NUMBERING_BASIS_OPTIONS,
  UNSET_LS_NUMBERING,
  composeLsNumberingCaution,
  composeLsNumberingSentence,
  lsLevelSpecificNormalAllowed,
  lsNumberingAllowsTransitionalLevels,
  lsNumberingAllowedLevels,
  lsNumberingConfidence,
  lsNumberingConsistencyIssues,
  lsNumberingDiscLabels,
  lsNumberingIsEstablished,
  lsNumberingVertebraLabels,
  parseLsNumbering,
  parseLsNumberingFromText,
  type LsNumbering,
} from "./xrayLsNumbering";

const n = (partial: Partial<LsNumbering>): LsNumbering => ({ ...UNSET_LS_NUMBERING, ...partial });

const STANDARD_5 = n({ basis: "standard", lumbarTypeCount: 5, designatedL5Position: 5 });
const LSTV_6 = n({ basis: "lstv", lumbarTypeCount: 6, designatedL5Position: 5 });
const LUMBARIZED_6 = n({ basis: "lumbarization", lumbarTypeCount: 6, designatedL5Position: 5 });
const SACRALIZED_5 = n({ basis: "sacralization", lumbarTypeCount: 5, designatedL5Position: 5 });
const WHOLE_SPINE_5 = n({ basis: "wholeSpineLocalizer", lumbarTypeCount: 5, designatedL5Position: 5 });

describe("numbering is never assumed", () => {
  it("treats a fresh study as unestablished, low-confidence, with no usable labels", () => {
    expect(lsNumberingIsEstablished(UNSET_LS_NUMBERING)).toBe(false);
    expect(lsNumberingConfidence(UNSET_LS_NUMBERING)).toBe("reduced");
    expect(lsNumberingVertebraLabels(UNSET_LS_NUMBERING)).toEqual([]);
    expect(lsNumberingDiscLabels(UNSET_LS_NUMBERING)).toEqual([]);
    expect(lsNumberingAllowedLevels(UNSET_LS_NUMBERING)).toEqual([]);
    expect(lsNumberingAllowsTransitionalLevels(UNSET_LS_NUMBERING)).toBe(false);
    expect(lsLevelSpecificNormalAllowed(UNSET_LS_NUMBERING)).toBe(false);
  });

  it("states the caution that forbids assuming the lowest mobile segment", () => {
    // spec §4 verbatim requirement.
    expect(composeLsNumberingCaution(UNSET_LS_NUMBERING)).toContain(
      "do not assume the lowest mobile segment is L5-S1",
    );
    expect(composeLsNumberingSentence(UNSET_LS_NUMBERING)).toContain(
      "The number of lumbar-type vertebrae is not established",
    );
    expect(composeLsNumberingSentence(UNSET_LS_NUMBERING)).toContain(
      "is not assumed to be L5",
    );
  });

  it("offers every documented basis except the absence of one", () => {
    expect(LS_NUMBERING_BASIS_OPTIONS.map((o) => o.value)).not.toContain("unset");
    expect(LS_NUMBERING_BASIS_OPTIONS).toHaveLength(7);
  });
});

describe("labels derive from the designated L5", () => {
  it("numbers a standard five-body film conventionally", () => {
    expect(lsNumberingVertebraLabels(STANDARD_5)).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(lsNumberingDiscLabels(STANDARD_5)).toEqual([
      "L1-L2",
      "L2-L3",
      "L3-L4",
      "L4-L5",
      "L5-S1",
    ]);
    expect(lsNumberingConfidence(STANDARD_5)).toBe("confident");
    expect(composeLsNumberingCaution(STANDARD_5)).toBeNull();
    // The trivial "designated L5" is not repeated as a designation statement.
    expect(composeLsNumberingSentence(STANDARD_5)).not.toContain("designated L5");
  });

  it("keeps a whole-spine / localizer basis confident only when five were counted", () => {
    expect(lsNumberingConfidence(WHOLE_SPINE_5)).toBe("confident");
    expect(
      lsNumberingConfidence(n({ basis: "wholeSpineLocalizer", lumbarTypeCount: null })),
    ).toBe("reduced");
  });

  it("labels a transitional film without inventing an L6", () => {
    // Six lumbar-type bodies counted with the fifth designated L5: the sixth is
    // a sacral-type segment, and the junction above it stays L5-S1.
    expect(lsNumberingVertebraLabels(LSTV_6)).toEqual(["L1", "L2", "L3", "L4", "L5", "S1"]);
    expect(lsNumberingDiscLabels(LSTV_6)).toEqual([
      "L1-L2",
      "L2-L3",
      "L3-L4",
      "L4-L5",
      "L5-S1",
    ]);
    expect(lsNumberingAllowsTransitionalLevels(LSTV_6)).toBe(true);
    expect(lsNumberingConfidence(LSTV_6)).toBe("reduced");
  });

  it("handles lumbarization and sacralization through the same anchor", () => {
    expect(lsNumberingVertebraLabels(LUMBARIZED_6)).toEqual(lsNumberingVertebraLabels(LSTV_6));
    expect(lsNumberingVertebraLabels(SACRALIZED_5)).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(composeLsNumberingCaution(SACRALIZED_5)).toContain(
      "level labels follow the designated L5",
    );
  });

  it("refuses labels when the count and the designation disagree", () => {
    // Three bodies above a designated L5 is four lumbar vertebrae: numbering from
    // L2 would be a silent invention, so the label set is empty instead.
    expect(lsNumberingVertebraLabels(n({ basis: "manual", lumbarTypeCount: 4, designatedL5Position: 4 }))).toEqual([]);
    // Six bodies with the sixth designated L5 would need an L0 above it.
    expect(lsNumberingVertebraLabels(n({ basis: "lstv", lumbarTypeCount: 6, designatedL5Position: 6 }))).toEqual([]);
    expect(lsNumberingAllowedLevels(n({ basis: "lstv", lumbarTypeCount: 6, designatedL5Position: 6 }))).toEqual([]);
  });

  it("treats an unanchored transitional count as no scheme at all", () => {
    const unanchored = n({ basis: "lumbarization", lumbarTypeCount: 6 });
    expect(lsNumberingVertebraLabels(unanchored)).toEqual([]);
    expect(lsNumberingDiscLabels(unanchored)).toEqual([]);
    expect(lsNumberingAllowsTransitionalLevels(unanchored)).toBe(true);
  });

  it("allows transitional L6/L7 labels only where a transitional basis exists", () => {
    expect(lsNumberingAllowsTransitionalLevels(LSTV_6)).toBe(true);
    expect(lsNumberingAllowsTransitionalLevels(STANDARD_5)).toBe(false);
    expect(
      lsNumberingAllowsTransitionalLevels(n({ basis: "manual", lumbarTypeCount: 7, designatedL5Position: 7 })),
    ).toBe(true);
  });

  it("keeps T12-L1 in the allowed set because it is coverage, not numbering", () => {
    expect(lsNumberingAllowedLevels(STANDARD_5)).toContain("T12-L1");
    expect(lsNumberingAllowedLevels(STANDARD_5)).toContain("S1");
  });
});

describe("normal prose needs confident numbering (spec §6)", () => {
  it("permits level-specific normal statements only on a confidently numbered study", () => {
    expect(lsLevelSpecificNormalAllowed(STANDARD_5)).toBe(true);
    expect(lsLevelSpecificNormalAllowed(WHOLE_SPINE_5)).toBe(true);
    expect(lsLevelSpecificNormalAllowed(LSTV_6)).toBe(false);
    expect(lsLevelSpecificNormalAllowed(SACRALIZED_5)).toBe(false);
    expect(lsLevelSpecificNormalAllowed(n({ basis: "manual", lumbarTypeCount: 5, designatedL5Position: 5 }))).toBe(false);
  });

  it("states the approximate-numbering caution in the Findings sentence", () => {
    const sentence = composeLsNumberingSentence(LSTV_6);
    expect(sentence).toContain("6 lumbar-type vertebrae are counted");
    expect(sentence).toContain("transitional lumbosacral vertebra");
    expect(sentence).toContain("designated L5 (labelled sequence L1, L2, L3, L4, L5, S1)");
    expect(sentence).toContain("Level numbering is therefore approximate");
  });

  it("records Castellvi type and evidence only as radiologist selections", () => {
    const withCastellvi = n({ ...LSTV_6, castellvi: "IIa", evidence: "Bilateral pseudoarthrosis" });
    const sentence = composeLsNumberingSentence(withCastellvi);
    expect(sentence).toContain("Castellvi type IIa transitional anatomy, as selected by the reporting radiologist.");
    // A fragment without punctuation is closed so the Findings stay readable.
    expect(sentence).toContain("Bilateral pseudoarthrosis.");
    expect(CASTELLVI_TYPES).toEqual(["Ia", "Ib", "IIa", "IIb", "IIIa", "IIIb", "IV"]);
  });
});

describe("numbering / level consistency (spec §18)", () => {
  const details = (text: string, numbering: LsNumbering) =>
    lsNumberingConsistencyIssues(text, numbering).map((i) => i.detail);

  it("is quiet on confident, conventional numbering", () => {
    expect(
      lsNumberingConsistencyIssues(
        "Disc spaces are preserved at L1-L2 through L5-S1. No listhesis.",
        STANDARD_5,
      ),
    ).toEqual([]);
  });

  it("catches LSTV with conflicting labels", () => {
    // The recorded scheme calls the extra body S1, so a report naming L6-S1
    // contradicts its own numbering.
    const issues = lsNumberingConsistencyIssues("Retrolisthesis at L6-S1.", LSTV_6);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("cannot be produced by the recorded numbering");
  });

  it("requires a designated L5 before labelling the lumbosacral junction", () => {
    const unanchored = n({ basis: "lstv", lumbarTypeCount: 6 });
    const issues = lsNumberingConsistencyIssues("Grade I anterolisthesis at L5-S1.", unanchored);
    expect(details("Grade I anterolisthesis at L5-S1.", unanchored).join(" ")).toContain(
      "without a designated L5",
    );
    expect(issues.some((i) => i.level === "L5-S1")).toBe(true);
  });

  it("catches a report claiming five vertebrae while six were counted", () => {
    expect(details("There are five lumbar vertebrae.", LSTV_6).join(" ")).toContain(
      "states five lumbar vertebrae while 6 lumbar-type bodies are recorded",
    );
  });

  it("rejects a Castellvi type on a study called standard", () => {
    const mixed = n({ ...STANDARD_5, castellvi: "Ia" });
    expect(details("Transitional anatomy is present.", mixed).join(" ")).toContain(
      "Castellvi type Ia is recorded while the numbering basis is standard",
    );
  });

  it("still reports levels outside the counted scheme and mis-keyed cervical labels", () => {
    const text = "There is L7 transverse process pseudoarthrosis with C5 mis-keyed.";
    const combined = details(text, STANDARD_5).join(" ");
    expect(combined).toContain("no transitional vertebra has been designated");
    expect(combined).toContain("cannot be produced by the recorded numbering");
    expect(combined).toContain("cervical numbering in a lumbosacral report");
  });

  it("returns nothing for empty prose", () => {
    expect(lsNumberingConsistencyIssues("", LSTV_6)).toEqual([]);
    expect(lsNumberingConsistencyIssues(null, STANDARD_5)).toEqual([]);
  });
});

describe("parseLsNumbering", () => {
  it("defaults anything unrecognised to an unestablished record", () => {
    expect(parseLsNumbering(null)).toEqual(UNSET_LS_NUMBERING);
    expect(parseLsNumbering("lstv")).toEqual(UNSET_LS_NUMBERING);
    expect(parseLsNumbering({ basis: "unknown-basis", lumbarTypeCount: 5 })).toEqual({
      basis: "unset",
      lumbarTypeCount: 5,
      designatedL5Position: null,
      evidence: null,
      castellvi: null,
    });
  });

  it("rejects wrong field types instead of coercing them", () => {
    const parsed = parseLsNumbering({
      basis: "lstv",
      lumbarTypeCount: "6",
      designatedL5Position: "5",
      castellvi: "IX",
      evidence: 42,
    });
    expect(parsed.basis).toBe("lstv");
    expect(parsed.lumbarTypeCount).toBeNull();
    expect(parsed.designatedL5Position).toBeNull();
    expect(parsed.castellvi).toBeNull();
    expect(parsed.evidence).toBeNull();
  });

  it("round-trips a complete record", () => {
    const record = n({ basis: "lstv", lumbarTypeCount: 6, designatedL5Position: 5, castellvi: "IIa", evidence: "Standing AP film" });
    expect(parseLsNumbering(record)).toEqual(record);
  });
});

describe("parseLsNumberingFromText — the prose is the persisted state", () => {
  // There is no schema for numbering: the composed Findings sentence is what a
  // saved study reopens with. If the parser loses a basis, every level-bearing
  // tile silently switches off after a reload, so the round-trip is a contract.
  const roundTrip = (record: LsNumbering) => parseLsNumberingFromText(composeLsNumberingSentence(record));

  it("reads back a standard five-body record", () => {
    const parsed = roundTrip(STANDARD_5);
    expect(parsed.basis).toBe("standard");
    expect(parsed.lumbarTypeCount).toBe(5);
    expect(parsed.designatedL5Position).toBe(5);
    expect(lsLevelSpecificNormalAllowed(parsed)).toBe(true);
  });

  it("reads back a transitional record with its anchor and Castellvi type", () => {
    const parsed = roundTrip(n({ ...LSTV_6, castellvi: "IIa" }));
    expect(parsed.basis).toBe("lstv");
    expect(parsed.lumbarTypeCount).toBe(6);
    expect(parsed.designatedL5Position).toBe(5);
    expect(parsed.castellvi).toBe("IIa");
    expect(lsNumberingVertebraLabels(parsed)).toEqual(["L1", "L2", "L3", "L4", "L5", "S1"]);
  });

  it("reads back the whole-spine, sacralization and lumbarization bases", () => {
    expect(roundTrip(n({ basis: "wholeSpineLocalizer", lumbarTypeCount: 5, designatedL5Position: 5 })).basis).toBe(
      "wholeSpineLocalizer",
    );
    expect(roundTrip(WHOLE_SPINE_5).basis).toBe("wholeSpineLocalizer");
    expect(roundTrip(SACRALIZED_5).basis).toBe("sacralization");
    expect(roundTrip(LUMBARIZED_6).basis).toBe("lumbarization");
    expect(roundTrip(n({ basis: "manual", lumbarTypeCount: 5, designatedL5Position: 5 })).basis).toBe("manual");
  });

  it("reads back the baseline sentence the one-click normal writes", () => {
    expect(
      parseLsNumberingFromText("Five lumbar-type vertebrae are counted, and numbering is standard."),
    ).toEqual({
      basis: "standard",
      lumbarTypeCount: 5,
      designatedL5Position: 5,
      evidence: null,
      castellvi: null,
    });
    // Hand-dictated prose spells the count either way, and both must read back.
    expect(
      parseLsNumberingFromText("Five lumbar-type vertebral bodies are counted; numbering is standard.").basis,
    ).toBe("standard");
    expect(
      parseLsNumberingFromText("Six lumbar-type vertebrae identified; transitional lumbosacral vertebra.").lumbarTypeCount,
    ).toBe(6);
  });

  it("yields an unestablished record for anything it cannot place", () => {
    expect(parseLsNumberingFromText("Disc spaces are preserved at L3-L4.")).toEqual(UNSET_LS_NUMBERING);
    expect(parseLsNumberingFromText("")).toEqual(UNSET_LS_NUMBERING);
    expect(parseLsNumberingFromText(null)).toEqual(UNSET_LS_NUMBERING);
    // The explicit absence statement is unestablished too, never "standard".
    expect(parseLsNumberingFromText(composeLsNumberingSentence(UNSET_LS_NUMBERING))).toEqual(
      UNSET_LS_NUMBERING,
    );
  });

  it("never reports confidence from prose it only partially recognized", () => {
    const partial = parseLsNumberingFromText(
      "Transitional lumbosacral vertebra is present without a counted sequence.",
    );
    expect(partial.basis).toBe("lstv");
    expect(partial.lumbarTypeCount).toBeNull();
    expect(lsNumberingConfidence(partial)).toBe("reduced");
    expect(lsLevelSpecificNormalAllowed(partial)).toBe(false);
  });
});
