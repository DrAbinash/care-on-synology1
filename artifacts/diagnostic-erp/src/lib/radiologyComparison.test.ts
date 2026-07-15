import { describe, it, expect } from "vitest";
import {
  formatStudyDate, comparisonBanner, buildComparisonSentence,
  formatMeasurementChange, compareMeasurementRows, extractMeasurements, INTERVAL_CHANGES,
} from "./radiologyComparison";

describe("formatStudyDate", () => {
  it("formats an ISO date, timezone-safe", () => {
    expect(formatStudyDate("2025-06-12")).toBe("12 June 2025");
    expect(formatStudyDate("2025-06-12T09:30:00Z")).toBe("12 June 2025");
  });
  it("passes non-dates through and handles empty", () => {
    expect(formatStudyDate("")).toBe("");
    expect(formatStudyDate("unknown")).toBe("unknown");
  });
});

describe("comparisonBanner", () => {
  it("names the study when given, else falls back", () => {
    expect(comparisonBanner("2025-06-12", "MRI LS Spine")).toBe("Compared with MRI LS Spine dated 12 June 2025.");
    expect(comparisonBanner("2025-06-12")).toBe("Compared with the previous study dated 12 June 2025.");
  });
});

describe("buildComparisonSentence — matches the spec examples", () => {
  it("progressed with qualifier + study/date", () => {
    expect(buildComparisonSentence("progressed", {
      finding: "the L4-L5 disc protrusion", priorDateIso: "2025-06-12", priorStudyName: "MRI", qualifier: "mild",
    })).toBe("Compared with MRI dated 12 June 2025, there is mild interval progression of the L4-L5 disc protrusion.");
  });
  it("stable reads naturally without a prefix", () => {
    expect(buildComparisonSentence("stable", { finding: "the chronic small-vessel ischemic changes" }))
      .toBe("No significant interval change is seen in the chronic small-vessel ischemic changes.");
  });
  it("resolved", () => {
    expect(buildComparisonSentence("resolved", { finding: "acute infarct" }))
      .toBe("The previously seen acute infarct has resolved.");
  });
  it("new / improved / not-comparable / indeterminate", () => {
    expect(buildComparisonSentence("new", { finding: "a lesion", priorDateIso: "2025-01-01" })).toMatch(/newly seen/);
    expect(buildComparisonSentence("improved", { finding: "the effusion", priorDateIso: "2025-01-01" })).toMatch(/interval improvement of the effusion/);
    expect(buildComparisonSentence("not-comparable", { finding: "the mass" })).toMatch(/not directly comparable/);
    expect(buildComparisonSentence("indeterminate", { finding: "the change" })).toMatch(/indeterminate/);
  });
  it("falls back to a generic finding when none given", () => {
    expect(buildComparisonSentence("stable", {})).toBe("No significant interval change is seen in the described finding.");
  });
  it("exposes all seven classifications", () => {
    expect(INTERVAL_CHANGES.map((c) => c.value)).toEqual([
      "new", "stable", "improved", "progressed", "resolved", "not-comparable", "indeterminate",
    ]);
  });
});

describe("formatMeasurementChange", () => {
  it("signs the delta and percent", () => {
    expect(formatMeasurementChange(12, 15)).toEqual({ delta: 3, deltaText: "+3", percentText: "+25%" });
    expect(formatMeasurementChange(8, 7)).toEqual({ delta: -1, deltaText: "-1", percentText: "-12%" });
  });
  it("handles a zero prior (no percent)", () => {
    expect(formatMeasurementChange(0, 5).percentText).toBe("—");
  });
});

describe("compareMeasurementRows — safety", () => {
  it("diffs matched rows and preserves units", () => {
    const rows = compareMeasurementRows(
      [{ label: "Lesion AP", value: 12, unit: "mm" }, { label: "Canal diameter", value: 8, unit: "mm" }],
      [{ label: "Lesion AP", value: 15, unit: "mm" }, { label: "Canal diameter", value: 7, unit: "mm" }],
    );
    expect(rows.find((r) => r.label === "Lesion AP")).toMatchObject({ previous: 12, current: 15, deltaText: "+3 mm", percentText: "+25%", comparable: true });
    expect(rows.find((r) => r.label === "Canal diameter")).toMatchObject({ deltaText: "-1 mm", comparable: true });
  });
  it("never infers change from missing data", () => {
    const rows = compareMeasurementRows([], [{ label: "New measure", value: 5, unit: "mm" }]);
    expect(rows[0]).toMatchObject({ previous: null, current: 5, comparable: false, note: "No prior value" });
  });
  it("flags a unit mismatch instead of diffing", () => {
    const rows = compareMeasurementRows(
      [{ label: "Size", value: 1.2, unit: "cm" }],
      [{ label: "Size", value: 15, unit: "mm" }],
    );
    expect(rows[0]).toMatchObject({ comparable: false, delta: null });
    expect(rows[0].note).toMatch(/Unit mismatch/);
  });
  it("extracts measurements from report text and diffs them", () => {
    const prior = extractMeasurements("AP canal diameter at L4-L5 measures approximately 8 mm. The lesion measures 12 mm.");
    const current = extractMeasurements("AP canal diameter at L4-L5 measures approximately 7.2 mm. The lesion measures 15 mm.");
    expect(prior).toEqual(expect.arrayContaining([{ label: expect.stringMatching(/canal diameter/i), value: 8, unit: "mm" }]));
    const rows = compareMeasurementRows(prior, current);
    const lesion = rows.find((r) => /lesion/i.test(r.label));
    expect(lesion).toMatchObject({ previous: 12, current: 15, comparable: true, percentText: "+25%" });
  });

  it("lists current-first, then prior-only, matched case-insensitively", () => {
    const rows = compareMeasurementRows(
      [{ label: "Old only", value: 3, unit: "mm" }, { label: "shared", value: 2, unit: "mm" }],
      [{ label: "Shared", value: 4, unit: "mm" }],
    );
    expect(rows.map((r) => r.label)).toEqual(["Shared", "Old only"]);
    expect(rows[0].comparable).toBe(true);
  });
});
