import { describe, expect, it } from "vitest";
import { mergeReportFieldContentWithProvenance } from "../reportFieldMerge";
import {
  applyStructuredFindingsPlan,
  impressionCandidateBlock,
  labeledFindingsBlock,
  labeledLinesFromMap,
  planStructuredFindingsUpdate,
  stripPreviousGenerated,
} from "./applyToEditor";

function mergeStructuredLine(current: string, incoming: string): string {
  return mergeReportFieldContentWithProvenance({
    field: "findings",
    existing: current,
    incoming,
    source: "structured-template",
  }).text;
}

function applyNext(
  existing: string,
  previousLines: Record<string, string>,
  nextMap: Parameters<typeof labeledLinesFromMap>[0],
) {
  const nextLines = labeledLinesFromMap(nextMap);
  const plan = planStructuredFindingsUpdate(existing, previousLines, nextLines);
  return {
    text: applyStructuredFindingsPlan(existing, plan, mergeStructuredLine),
    nextTracked: plan.nextTracked,
    plan,
  };
}

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

  it("does not reconstruct the document when the previous block was edited in place", () => {
    const prev = "Alpha is seen.\nBeta is seen.";
    const existing = "Alpha is seen.\nBeta was edited by the radiologist.";
    expect(stripPreviousGenerated(existing, prev)).toBe(existing);
  });

  it("dedupes impression candidates for Accept, without implying auto-merge", () => {
    const block = impressionCandidateBlock([
      { text: "L4-L5 disc bulge.", weight: 0.7, fieldPathKey: "a" },
      { text: "L4-L5 disc bulge.", weight: 0.9, fieldPathKey: "b" },
      { text: "L5-S1 protrusion.", weight: 0.8, fieldPathKey: "c" },
    ]);
    expect(block.split("\n")).toHaveLength(2);
  });

  it("findings planner does not emit an impression merge", () => {
    const plan = planStructuredFindingsUpdate(
      "",
      {},
      labeledLinesFromMap({ "L4-L5": { normal: false, text: "Mild bulge at L4-L5." } }),
    );
    expect(plan).toEqual({
      strip: [],
      merge: ["L4-L5: Mild bulge at L4-L5."],
      nextTracked: { "L4-L5": "L4-L5: Mild bulge at L4-L5." },
    });
    expect(JSON.stringify(plan)).not.toMatch(/impression/i);
  });
});

describe("structured regeneration never deletes radiologist prose", () => {
  it("keeps a manual edit of a generated sentence when another structured field changes", () => {
    const generatedL45 = "Mild bulge at L4-L5.";
    const first = applyNext("", {}, {
      "L4-L5": { normal: false, text: generatedL45 },
    });
    expect(first.text).toContain("L4-L5: Mild bulge at L4-L5.");

    const edited = first.text.replace(
      "L4-L5: Mild bulge at L4-L5.",
      "L4-L5: Severe central bulge at L4-L5 with canal stenosis.",
    );
    expect(edited).toContain("Severe central bulge");

    const second = applyNext(edited, first.nextTracked, {
      "L4-L5": { normal: false, text: generatedL45 },
      "L3-L4": { normal: false, text: "Small protrusion at L3-L4." },
    });

    expect(second.text).toContain("L4-L5: Severe central bulge at L4-L5 with canal stenosis.");
    expect(second.text).not.toContain("L4-L5: Mild bulge at L4-L5.");
    expect(second.text).toContain("L3-L4: Small protrusion at L3-L4.");
    expect(second.plan.merge).not.toContain("L4-L5: Mild bulge at L4-L5.");
    expect(second.nextTracked).not.toHaveProperty("L4-L5");
  });

  it("keeps an unrelated manual sentence byte-for-byte when another level changes", () => {
    const unrelated = "Follow-up  MRI in 6 months.";
    const first = applyNext("", {}, {
      "L4-L5": { normal: false, text: "Mild bulge at L4-L5." },
    });
    const existing = `${first.text}\n\n${unrelated}`;

    const second = applyNext(existing, first.nextTracked, {
      "L4-L5": { normal: false, text: "Mild bulge at L4-L5." },
      "L5-S1": { normal: false, text: "Tiny annular tear at L5-S1." },
    });

    const idx = second.text.indexOf(unrelated);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(second.text.slice(idx, idx + unrelated.length)).toBe(unrelated);
    expect(second.text).toContain("L4-L5: Mild bulge at L4-L5.");
    expect(second.text).toContain("L5-S1: Tiny annular tear at L5-S1.");
    expect(second.plan.strip).toEqual([]);
  });
});
