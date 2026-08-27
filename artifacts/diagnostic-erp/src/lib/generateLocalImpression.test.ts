import { describe, expect, it } from "vitest";
import { generateLocalImpression, isAbnormalFindingLine } from "./generateLocalImpression";

const GULU_FINDINGS = `
White Matter
• Multiple hyperintense foci are seen in the periventricular, deep, and subcortical white matter on FLAIR and T2-weighted sequences.
• These changes are consistent with Fazekas Grade II small vessel ischemic changes.
• No diffusion restriction is present to suggest acute infarction.
Cerebral Hemispheres
• Normal morphology and signal characteristics.
• Gray-white matter differentiation is preserved.
Basal Ganglia and Thalami
• Chronic lacunar infarcts are noted in the bilateral basal ganglia.
• Otherwise, morphology and signal intensity are preserved.
• No evidence of acute hemorrhage or calcification.
Brainstem and Posterior Fossa
• Brainstem is normal.
• Mild cerebellar atrophy is noted.
Other Observations
• No mass lesion, midline shift, or hydrocephalus.
• No abnormal susceptibility foci on SWI.
• No extra-axial fluid collections. No Post contrast enhancement
`.trim();

describe("generateLocalImpression", () => {
  it("picks abnormal lines from mixed findings (not only Normal)", () => {
    const lines = generateLocalImpression(GULU_FINDINGS);
    expect(lines.some((l) => /Fazekas/i.test(l))).toBe(true);
    expect(lines.some((l) => /lacunar infarct/i.test(l))).toBe(true);
    expect(lines.some((l) => /cerebellar atrophy/i.test(l))).toBe(true);
    expect(lines[0]).not.toMatch(/no significant abnormality/i);
    // Pure normal filler must not dominate
    expect(lines.every((l) => !/^Brainstem is normal/i.test(l))).toBe(true);
  });

  it("uses abnormal structured sections when present", () => {
    const lines = generateLocalImpression("ignored free text that is long enough here", {
      "White Matter": { normal: true, text: "Normal." },
      "Basal Ganglia": { normal: false, text: "Chronic lacunes bilaterally." },
    });
    expect(lines).toEqual(["Basal Ganglia: Chronic lacunes bilaterally."]);
  });

  it("detects pathology text even when structured card is marked Normal", () => {
    const lines = generateLocalImpression("", {
      "White Matter": {
        normal: true,
        text: "Multiple hyperintense foci consistent with Fazekas Grade II changes.",
      },
    });
    expect(lines[0]).toMatch(/Fazekas/i);
  });

  it("falls back to free text when structured cards are all normal without pathology", () => {
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

  it("classifies normal vs abnormal lines", () => {
    expect(isAbnormalFindingLine("Brainstem is normal.")).toBe(false);
    expect(isAbnormalFindingLine("Mild cerebellar atrophy is noted.")).toBe(true);
    expect(isAbnormalFindingLine("Chronic lacunar infarcts are noted in the bilateral basal ganglia.")).toBe(true);
  });
});
