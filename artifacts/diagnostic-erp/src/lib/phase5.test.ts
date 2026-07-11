import { describe, it, expect } from "vitest";
import { computeChecklistStatus, summarizeChecklist, parseChecklist } from "./checklistEngine";
import { rankSuggestions, isLearnableAddition, LEARNING_THRESHOLD, type LearnedPattern } from "./learningEngine";
import { computeQualityScore } from "./reportValidator";

// ── Checklist engine ──────────────────────────────────────────────────────────

describe("computeChecklistStatus", () => {
  const checklist = ["Skull", "Subdural", "Epidural", "SAH", "Midline shift", "Ventricles"];

  it("marks items addressed when a selected finding label matches", () => {
    const status = computeChecklistStatus(checklist, [
      { label: "Midline shift", tags: "" },
      { label: "Hemorrhage", tags: "subdural, sdh" },
    ]);
    expect(status.find((i) => i.label === "Midline shift")?.addressed).toBe(true);
    expect(status.find((i) => i.label === "Subdural")?.addressed).toBe(true); // matched via tags
    expect(status.find((i) => i.label === "Skull")?.addressed).toBe(false);
  });

  it("is case and punctuation insensitive", () => {
    const status = computeChecklistStatus(["SAH"], [{ label: "sah  ", tags: "" }]);
    expect(status[0].addressed).toBe(true);
  });

  it("returns nothing addressed when no findings selected", () => {
    const status = computeChecklistStatus(checklist, []);
    expect(status.every((i) => !i.addressed)).toBe(true);
  });
});

describe("summarizeChecklist", () => {
  it("computes percent and remaining list", () => {
    const status = computeChecklistStatus(["A", "B", "C", "D"], [{ label: "A", tags: "" }, { label: "C", tags: "" }]);
    const summary = summarizeChecklist(status);
    expect(summary.total).toBe(4);
    expect(summary.addressed).toBe(2);
    expect(summary.percent).toBe(50);
    expect(summary.remaining).toEqual(["B", "D"]);
  });

  it("treats an empty checklist as 100% complete", () => {
    expect(summarizeChecklist(computeChecklistStatus([], [])).percent).toBe(100);
  });
});

describe("parseChecklist", () => {
  it("parses a valid JSON array", () => {
    expect(parseChecklist('["Skull","SAH"]')).toEqual(["Skull", "SAH"]);
  });
  it("returns [] for malformed/missing JSON", () => {
    expect(parseChecklist("not json")).toEqual([]);
    expect(parseChecklist(null)).toEqual([]);
    expect(parseChecklist(undefined)).toEqual([]);
  });
});

// ── Learning engine ───────────────────────────────────────────────────────────

describe("rankSuggestions", () => {
  const patterns: LearnedPattern[] = [
    { triggerLabel: "Ring lesion", suggestedText: "Recommend MRI with contrast.", occurrenceCount: 5, lastUsedAt: "2026-07-01" },
    { triggerLabel: "Ring lesion", suggestedText: "Consider tuberculoma.", occurrenceCount: 2, lastUsedAt: "2026-07-05" },
    { triggerLabel: "Infarct", suggestedText: "MRA advised.", occurrenceCount: 10, lastUsedAt: "2026-07-01" },
  ];

  it("only returns patterns at or above the threshold", () => {
    const ranked = rankSuggestions(patterns, "Ring lesion");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].suggestedText).toBe("Recommend MRI with contrast.");
  });

  it("filters by trigger label case-insensitively", () => {
    expect(rankSuggestions(patterns, "ring lesion")).toHaveLength(1);
  });

  it("returns nothing for an unknown trigger", () => {
    expect(rankSuggestions(patterns, "Unknown finding")).toEqual([]);
  });

  it("sorts by occurrence count descending", () => {
    const many: LearnedPattern[] = [
      { triggerLabel: "X", suggestedText: "a", occurrenceCount: 4, lastUsedAt: "2026-01-01" },
      { triggerLabel: "X", suggestedText: "b", occurrenceCount: 9, lastUsedAt: "2026-01-01" },
    ];
    expect(rankSuggestions(many, "X").map((p) => p.suggestedText)).toEqual(["b", "a"]);
  });

  it("threshold constant is used consistently", () => {
    expect(LEARNING_THRESHOLD).toBeGreaterThan(1);
  });
});

describe("isLearnableAddition", () => {
  it("rejects short text", () => {
    expect(isLearnableAddition("ok", "Ring lesion is noted.")).toBe(false);
  });
  it("rejects text identical to the template", () => {
    expect(isLearnableAddition("Ring lesion is noted.", "Ring lesion is noted.")).toBe(false);
  });
  it("accepts a genuine addition", () => {
    expect(isLearnableAddition("Recommend MRI with contrast for further evaluation.", "Ring lesion is noted.")).toBe(true);
  });
});

// ── Protocol-aware quality score ─────────────────────────────────────────────

describe("computeQualityScore with checklist + required measurements", () => {
  it("deducts for incomplete checklist", () => {
    const complete = computeQualityScore({
      technique: "t", clinicalHistory: "h", findings: "f findings text here today.",
      impression: ["imp."], recommendation: "r", checklistPercent: 100,
    });
    const incomplete = computeQualityScore({
      technique: "t", clinicalHistory: "h", findings: "f findings text here today.",
      impression: ["imp."], recommendation: "r", checklistPercent: 50,
    });
    expect(incomplete.score).toBeLessThan(complete.score);
    expect(incomplete.issues.some((i) => i.includes("checklist"))).toBe(true);
  });

  it("deducts for missing required measurements", () => {
    const q = computeQualityScore({
      technique: "t", clinicalHistory: "h", findings: "f findings text here today.",
      impression: ["imp."], recommendation: "r", missingRequiredMeasurements: ["Canal diameter"],
    });
    expect(q.issues.some((i) => i.includes("Canal diameter"))).toBe(true);
  });

  it("does not deduct when checklist is 100% and nothing missing", () => {
    const q = computeQualityScore({
      technique: "t", clinicalHistory: "h", findings: "f findings text here today.",
      impression: ["imp."], recommendation: "r", checklistPercent: 100, missingRequiredMeasurements: [],
    });
    expect(q.score).toBe(100);
  });
});
