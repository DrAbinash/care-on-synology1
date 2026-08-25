import { describe, expect, it } from "vitest";
import { generateLocalImpression } from "./generateLocalImpression";

describe("generateLocalImpression", () => {
  it("summarizes free-text findings into sentences", () => {
    const lines = generateLocalImpression(
      "Multiple white matter foci are seen. Chronic lacunes are present in basal ganglia. No acute infarct.",
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatch(/white matter/i);
  });

  it("uses abnormal structured sections when present", () => {
    const lines = generateLocalImpression("ignored free text that is long enough here", {
      "White Matter": { normal: true, text: "Normal." },
      "Basal Ganglia": { normal: false, text: "Chronic lacunes bilaterally." },
    });
    expect(lines).toEqual(["Basal Ganglia: Chronic lacunes bilaterally."]);
  });

  it("falls back to free text when structured cards are all normal", () => {
    const lines = generateLocalImpression(
      "Moderate Fazekas grade II changes are noted. Mild cerebellar atrophy is present.",
      {
        "White Matter": { normal: true, text: "Normal white matter." },
        Cortex: { normal: true, text: "Normal cortex." },
      },
    );
    expect(lines[0]).toMatch(/Fazekas/i);
    expect(lines.some((l) => /cerebellar/i.test(l))).toBe(true);
  });
});
