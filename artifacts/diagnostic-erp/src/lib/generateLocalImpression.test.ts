import { describe, expect, it } from "vitest";
import {
  assertsAbnormality,
  generateLocalImpression,
  IMPRESSION_LINE_CAP,
  isAbnormalFindingLine,
} from "./generateLocalImpression";

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

/**
 * Every sentence below is a real line from CARE's own shipped normal formats, or
 * a dictated sentence shaped like one. The old classifier read the first group as
 * findings, because `ABNORMAL_CUE_RE` matches a word and the negation in front of
 * it does not cancel the word — "No acute infarct is seen." arrived in the
 * Impression of a normal brain, and "Lumbar facet joints are unremarkable."
 * arrived there simply for being longer than 24 characters. The second group is
 * the regression guard: none of this may be lost while the first is being fixed.
 */
describe("assertsAbnormality — a denial is not a finding", () => {
  const DENIED = [
    "No acute infarct is seen.",
    "No intracranial hemorrhage is seen.",
    "No midline shift is seen.",
    "No restricted diffusion is seen on DWI/ADC.",
    "No extra-axial collection is identified.",
    "There is no evidence of hemorrhage.",
    "No mass lesion, midline shift, or hydrocephalus.",
    "No abnormal susceptibility foci on SWI.",
    "No diffusion restriction is present to suggest acute infarction.",
    "L4-L5: No significant disc bulge or protrusion is seen.",
    // The three shapes above each sat six words from their denial, and the
    // shipped per-level normals are not short: 32 of CARE's own 152 baseline
    // sentences read as findings, because `L4-L5: ` pushed the opening `No` out
    // of the look-back window and `^` never reached it behind a label. These are
    // the sentences that actually broke, copied from the baselines themselves.
    "C5-C6: No spinal canal or thecal sac compression is seen.",
    "C2-C3: No exiting or traversing nerve root compression is seen.",
    "L1-L2: No spinal canal or thecal sac compression is seen.",
    "Cervical spine: No gross spinal canal compromise is seen.",
    "Brain parenchyma shows no gross signal abnormality on screening sequences.",
    "Lumbar facet joints are unremarkable.",
    "Ligamentum flavum is not hypertrophied.",
    "Cauda equina nerve roots are normally distributed.",
    "Flow voids in major intracranial vessels are preserved.",
    "Ventricular system and cisternal spaces are normal in size and configuration.",
    "Otherwise, morphology and signal intensity are preserved.",
    "A 2 cm lesion is not seen in the frontal lobe.",
  ];

  const ASSERTED = [
    "Acute infarct in the left MCA territory.",
    "No hemorrhage, but a small infarct is present.",
    "Mild cerebellar atrophy is noted.",
    "Chronic lacunar infarcts are noted in the bilateral basal ganglia.",
    "Multiple hyperintense foci are seen in the periventricular white matter on FLAIR.",
    "These changes are consistent with Fazekas Grade II small vessel ischemic changes.",
    "Moderate disc bulge with bilateral neural foraminal narrowing.",
    "Compressive myelopathy at C4-C5 with intramedullary T2 hyperintensity.",
    "Normal study; a small lesion is noted in the right temporal tip.",
    // Reading a level label as metadata must not turn the sentence after it into
    // a denial: these are what a radiologist types over a cervical normal.
    "C5-C6: Disc herniation with cord compression.",
    "L4-L5: Moderate canal stenosis with thecal sac compression.",
    "C4-C5: No spinal canal stenosis, but a disc herniation is present.",
  ];

  for (const line of DENIED) {
    it(`keeps the denial out of the conclusion: ${line}`, () => {
      expect(assertsAbnormality(line)).toBe(false);
      expect(isAbnormalFindingLine(line)).toBe(false);
    });
  }

  for (const line of ASSERTED) {
    it(`keeps the finding in the conclusion: ${line}`, () => {
      expect(assertsAbnormality(line)).toBe(true);
      expect(isAbnormalFindingLine(line)).toBe(true);
    });
  }

  it("does not report a normal sentence at all when the findings are entirely normal", () => {
    const lines = generateLocalImpression(
      "No acute infarct is seen. Lumbar facet joints are unremarkable. Ventricles are normal in size.",
    );
    expect(lines).toEqual(["No significant abnormality detected."]);
  });

  // An Impression that itemises six of twelve abnormalities and stays silent about
  // the other six reads as a complete answer. The cap may shorten a Conclusion; it
  // may not make it untrue.
  const abnormalAt = (n: number) =>
    Array.from({ length: n }, (_, i) => `Broad-based disc bulge at L${i + 1}-L${i + 2} with neural foraminal narrowing.`);

  it("names the findings a capped Conclusion could not itemise", () => {
    const lines = generateLocalImpression(abnormalAt(12).join("\n"));
    expect(lines).toHaveLength(IMPRESSION_LINE_CAP + 1);
    expect(lines.slice(0, IMPRESSION_LINE_CAP)).toEqual(abnormalAt(12).slice(0, IMPRESSION_LINE_CAP));
    expect(lines[IMPRESSION_LINE_CAP]).toMatch(/2 further significant findings not itemised above/i);
  });

  it("adds no overflow line when everything fits under the cap", () => {
    const lines = generateLocalImpression(abnormalAt(IMPRESSION_LINE_CAP).join("\n"));
    expect(lines).toHaveLength(IMPRESSION_LINE_CAP);
    expect(lines.some((l) => /not itemised/i.test(l))).toBe(false);
  });

  it("caps the structured-section path with the same honesty", () => {
    const sections: Record<string, { normal: boolean; text: string }> = {};
    abnormalAt(11).forEach((text, i) => {
      sections[`Level ${i + 1}`] = { normal: false, text };
    });
    const lines = generateLocalImpression("ignored", sections);
    expect(lines).toHaveLength(IMPRESSION_LINE_CAP + 1);
    expect(lines[IMPRESSION_LINE_CAP]).toMatch(/1 further significant finding not itemised above/i);
  });
});
