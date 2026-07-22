import { describe, it, expect } from "vitest";
import {
  comparisonSuggestion, buildComparisonSuggestions, composeComparisonParagraph,
} from "./usgComparisonText";
import { compareMeasurements, type MeasurementPoint } from "./usgStructuredComparison";

const m = (key: string, value: string, over: Partial<MeasurementPoint> = {}): MeasurementPoint => ({
  key, label: key, value, ...over,
});

describe("P4.5 usgComparisonText — editable, evidence-bearing suggestions", () => {
  it("states the change and always cites both values", () => {
    const [row] = compareMeasurements([m("size", "12 mm")], [m("size", "10 mm")], { intervalDays: 30 });
    const s = comparisonSuggestion(row);
    expect(s.text).toContain("10 mm");
    expect(s.text).toContain("12 mm");
    expect(s.evidence.current).toBe("12 mm");
    expect(s.evidence.prior).toBe("10 mm");
    expect(s.evidence.percentChange).toBe(20);
    expect(s.evidence.intervalDays).toBe(30);
  });

  it("never asserts clinical progression in the draft text", () => {
    const [row] = compareMeasurements([m("size", "40 mm")], [m("size", "10 mm")]);
    const s = comparisonSuggestion(row);
    expect(s.text).not.toMatch(/worse|progress|response|malignan|concern/i);
  });

  it("flags new / resolved / caveated rows as needing review", () => {
    const [newRow] = compareMeasurements([m("nodule", "5 mm")], []);
    expect(comparisonSuggestion(newRow).needsReview).toBe(true);
    const [resolvedRow] = compareMeasurements([], [m("nodule", "5 mm")]);
    expect(comparisonSuggestion(resolvedRow).needsReview).toBe(true);
  });

  it("does not mark a plain unchanged row as needing review", () => {
    const [row] = compareMeasurements([m("size", "10 mm")], [m("size", "10 mm")]);
    expect(comparisonSuggestion(row).needsReview).toBe(false);
  });

  it("drops unchanged rows from the draft unless requested", () => {
    const rows = compareMeasurements(
      [m("a", "10 mm"), m("b", "20 mm")],
      [m("a", "10 mm"), m("b", "15 mm")],
    );
    expect(buildComparisonSuggestions(rows)).toHaveLength(1);
    expect(buildComparisonSuggestions(rows, { includeUnchanged: true })).toHaveLength(2);
  });

  it("composes a paragraph without inserting it anywhere (returns text only)", () => {
    const rows = compareMeasurements([m("size", "12 mm")], [m("size", "10 mm")]);
    const paragraph = composeComparisonParagraph(buildComparisonSuggestions(rows));
    expect(paragraph).toContain("size");
    expect(composeComparisonParagraph([])).toBe("");
  });
});
