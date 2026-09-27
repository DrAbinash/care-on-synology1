import { describe, expect, it } from "vitest";
import {
  BUILTIN_ABNORMAL_PATTERNS,
  matchAbnormalPatterns,
  parseAbnormalPatternLibrary,
  selectedChipsAreAllBaselineNormal,
} from "./abnormalPatterns";

const lumbar = BUILTIN_ABNORMAL_PATTERNS.find((p) => p.id === "lumbar-degenerative-cascade")!;

describe("matchAbnormalPatterns", () => {
  it("ranks the lumbar cascade on a disc-bulge chip plus radiculopathy history, with reasons", () => {
    const hits = matchAbnormalPatterns({
      region: "LS Spine",
      modality: "MR",
      protocolName: "MRI LS Spine",
      selectedChipLabels: ["Disc herniation L4-L5"],
      clinicalHistory: "Lower back pain with radiculopathy right lower limb.",
      findingsText: "",
    });
    expect(hits[0]?.pattern.id).toBe("lumbar-degenerative-cascade");
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits[0]?.reasons.some((r) => r.includes("Disc herniation L4-L5"))).toBe(true);
    expect(hits[0]?.reasons.some((r) => /radiculopathy/i.test(r))).toBe(true);
    expect(hits[0]?.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("scores a normal-only chip set at zero", () => {
    expect(selectedChipsAreAllBaselineNormal(["Normal MRI brain"])).toBe(true);
    const hits = matchAbnormalPatterns({
      region: "Brain",
      modality: "MR",
      protocolName: "MRI Brain",
      selectedChipLabels: ["Normal MRI brain"],
      clinicalHistory: "small vessel fazekas",
      findingsText: "Fazekas grade 1 white matter lesions",
    });
    expect(hits).toEqual([]);
  });

  it("returns nothing when only one signal category hits", () => {
    const chipOnly = matchAbnormalPatterns({
      region: "LS Spine",
      modality: "MR",
      selectedChipLabels: ["Disc bulge L3-L4"],
      clinicalHistory: "",
      findingsText: "",
    });
    const historyOnly = matchAbnormalPatterns({
      region: "LS Spine",
      modality: "MR",
      selectedChipLabels: [],
      clinicalHistory: "radiculopathy",
      findingsText: "",
    });
    expect(chipOnly).toEqual([]);
    expect(historyOnly).toEqual([]);
  });

  it("suppresses a pattern that is applied or dismissed", () => {
    const base = {
      region: "LS Spine",
      modality: "MR",
      selectedChipLabels: ["Disc herniation L4-L5"],
      clinicalHistory: "radiculopathy",
      findingsText: "",
    };
    expect(matchAbnormalPatterns({
      ...base,
      appliedPatternIds: [lumbar.id],
    })).toEqual([]);
    expect(matchAbnormalPatterns({
      ...base,
      dismissedPatternIds: [lumbar.id],
    })).toEqual([]);
    expect(matchAbnormalPatterns({
      ...base,
      appliedBundleIds: [`pattern-${lumbar.id}-v${lumbar.version}`],
    })).toEqual([]);
  });

  it("falls back to built-in seeds when the library payload is missing or invalid", () => {
    expect(parseAbnormalPatternLibrary(null).map((p) => p.id)).toEqual(BUILTIN_ABNORMAL_PATTERNS.map((p) => p.id));
    expect(parseAbnormalPatternLibrary("{").map((p) => p.id)).toEqual(BUILTIN_ABNORMAL_PATTERNS.map((p) => p.id));
    expect(parseAbnormalPatternLibrary("")).toHaveLength(6);
  });
});
