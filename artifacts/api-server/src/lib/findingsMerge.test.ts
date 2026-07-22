import { describe, it, expect } from "vitest";
import { mergeFindings } from "./findingsMerge";

describe("mergeFindings", () => {
  it("merges several findings into one report, grouped by section", () => {
    const r = mergeFindings({
      title: "USG Whole Abdomen",
      findings: [
        { text: "Normal in shape, size & echotexture.", section: "Liver", abnormal: false },
        { text: "Cholelithiasis with multiple calculi.", section: "Gall Bladder", abnormal: true },
        { text: "No calculus or hydronephrosis.", section: "Kidneys", abnormal: false },
      ],
    });
    expect(r.counts.findings).toBe(3);
    expect(r.counts.sections).toBe(3);
    // house anatomical order: Liver before Gall Bladder before Kidneys
    expect(r.sections.map((s) => s.section)).toEqual(["Liver", "Gall Bladder", "Kidneys"]);
    expect(r.findingsText).toContain("Liver: Normal in shape, size & echotexture.");
    expect(r.findingsText).toContain("Gall Bladder: Cholelithiasis with multiple calculi.");
  });

  it("builds a numbered impression from the abnormal findings only", () => {
    const r = mergeFindings({
      findings: [
        { text: "Normal liver.", section: "Liver", abnormal: false },
        { text: "Cholelithiasis.", section: "Gall Bladder", abnormal: true },
        { text: "Grade II fatty liver.", section: "Liver", abnormal: true },
      ],
    });
    expect(r.impressionText).toBe("1. Cholelithiasis.\n2. Grade II fatty liver.");
    expect(r.counts.abnormal).toBe(2);
  });

  it("emits the normal impression when nothing abnormal is selected", () => {
    const r = mergeFindings({
      findings: [{ text: "Normal study.", section: "Liver", abnormal: false }],
    });
    expect(r.impressionText).toBe("No significant abnormality detected.");
  });

  it("respects a custom normal impression", () => {
    const r = mergeFindings({
      findings: [{ text: "Normal.", section: "Brain Parenchyma" }],
      normalImpression: "Normal study.",
    });
    expect(r.impressionText).toBe("Normal study.");
  });

  it("de-duplicates identical sentences within a section", () => {
    const r = mergeFindings({
      findings: [
        { text: "No focal lesion.", section: "Liver" },
        { text: "no focal lesion", section: "Liver" }, // same, different case/punct
        { text: "No focal lesion.", section: "Spleen" }, // different section kept
      ],
    });
    const liver = r.sections.find((s) => s.section === "Liver")!;
    expect(liver.lines).toHaveLength(1);
    expect(r.counts.findings).toBe(2);
  });

  it("multiple abnormal findings across organs merge into one coherent impression", () => {
    const r = mergeFindings({
      title: "CT Whole Abdomen",
      findings: [
        { text: "Cholelithiasis.", section: "Gall Bladder", abnormal: true },
        { text: "Simple cortical cyst in the right kidney.", section: "Kidneys", abnormal: true },
        { text: "Hepatomegaly with fatty infiltration.", section: "Liver", abnormal: true },
      ],
    });
    // impression numbered, all three present
    expect(r.impressionText.split("\n")).toHaveLength(3);
    expect(r.impressionText).toContain("1.");
    expect(r.impressionText).toContain("3.");
    expect(r.plainText).toContain("CT WHOLE ABDOMEN");
    expect(r.plainText).toContain("FINDINGS:");
    expect(r.plainText).toContain("IMPRESSION:");
  });

  it("strips a leading organ label from impression lines", () => {
    const r = mergeFindings({
      findings: [{ text: "Gall Bladder: Cholelithiasis with sludge.", section: "Gall Bladder", abnormal: true }],
    });
    expect(r.impressionText).toBe("1. Cholelithiasis with sludge.");
  });

  it("handles empty selection safely", () => {
    const r = mergeFindings({ findings: [] });
    expect(r.counts.findings).toBe(0);
    expect(r.impressionText).toBe("No significant abnormality detected.");
    expect(r.sections).toHaveLength(0);
  });

  it("includes technique when provided", () => {
    const r = mergeFindings({
      title: "CT Brain",
      technique: "Non-contrast axial sections of the brain.",
      findings: [{ text: "No acute haemorrhage.", section: "Brain Parenchyma", abnormal: false }],
    });
    expect(r.plainText).toContain("TECHNIQUE:");
    expect(r.plainText).toContain("Non-contrast axial sections");
  });
});
