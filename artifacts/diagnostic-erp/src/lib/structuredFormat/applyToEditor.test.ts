import { describe, expect, it } from "vitest";
import {
  impressionCandidateBlock,
  labeledFindingsBlock,
  stripPreviousGenerated,
} from "./applyToEditor";

describe("apply structured generation to editor", () => {
  it("builds a labeled findings block matching workspace cards", () => {
    const text = labeledFindingsBlock({
      "L4-L5": { normal: false, text: "Mild bulge at L4-L5." },
      Alignment: { normal: true, text: "Lordosis preserved." },
    });
    expect(text).toContain("L4-L5: Mild bulge at L4-L5.");
    expect(text).toContain("Alignment: Lordosis preserved.");
  });

  it("strips the exact previous generated block and keeps manual text", () => {
    const prev = "L4-L5: Mild bulge at L4-L5.";
    const existing = `Manual intro.\n\n${prev}\n\nKeep me.`;
    expect(stripPreviousGenerated(existing, prev)).toContain("Manual intro.");
    expect(stripPreviousGenerated(existing, prev)).toContain("Keep me.");
    expect(stripPreviousGenerated(existing, prev)).not.toContain("Mild bulge");
  });

  it("falls back to sentence-level strip when the block was edited in place", () => {
    const prev = "Alpha is seen.\nBeta is seen.";
    const existing = "Alpha is seen.\nBeta was edited by the radiologist.";
    const next = stripPreviousGenerated(existing, prev);
    expect(next).toContain("Beta was edited by the radiologist.");
    expect(next).not.toContain("Alpha is seen.");
  });

  it("dedupes impression candidates", () => {
    const block = impressionCandidateBlock([
      { text: "L4-L5 disc bulge.", weight: 0.7, fieldPathKey: "a" },
      { text: "L4-L5 disc bulge.", weight: 0.9, fieldPathKey: "b" },
      { text: "L5-S1 protrusion.", weight: 0.8, fieldPathKey: "c" },
    ]);
    expect(block.split("\n")).toHaveLength(2);
  });
});
