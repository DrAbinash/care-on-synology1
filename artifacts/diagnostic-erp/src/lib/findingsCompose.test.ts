import { describe, it, expect } from "vitest";
import { composeFindings } from "./findingsCompose";

describe("composeFindings", () => {
  it("groups findings by organ in anatomical order", () => {
    const r = composeFindings([
      { text: "No calculus or hydronephrosis.", section: "Kidneys", abnormal: false },
      { text: "Cholelithiasis with multiple calculi.", section: "Gall Bladder", abnormal: true },
      { text: "Normal in shape, size & echotexture.", section: "Liver", abnormal: false },
    ]);
    // Liver before Gall Bladder before Kidneys
    expect(r.findingsText).toBe(
      "Liver: Normal in shape, size & echotexture.\n" +
      "Gall Bladder: Cholelithiasis with multiple calculi.\n" +
      "Kidneys: No calculus or hydronephrosis.",
    );
  });

  it("collects impression lines from abnormal findings only, label-stripped", () => {
    const r = composeFindings([
      { text: "Normal liver.", section: "Liver", abnormal: false },
      { text: "Gall Bladder: Cholelithiasis.", section: "Gall Bladder", abnormal: true },
      { text: "Grade II fatty liver.", section: "Liver", abnormal: true },
    ]);
    expect(r.impressionLines).toEqual(["Cholelithiasis.", "Grade II fatty liver."]);
  });

  it("de-duplicates repeated sentences within a section", () => {
    const r = composeFindings([
      { text: "No focal lesion.", section: "Liver" },
      { text: "no focal lesion", section: "Liver" },
    ]);
    expect(r.findingsText).toBe("Liver: No focal lesion.");
  });

  it("returns empty structures for no input", () => {
    const r = composeFindings([]);
    expect(r.findingsText).toBe("");
    expect(r.impressionLines).toEqual([]);
  });

  it("merges several organs and abnormals into one insertable block", () => {
    const r = composeFindings([
      { text: "Hepatomegaly with fatty infiltration.", section: "Liver", abnormal: true },
      { text: "Cholelithiasis.", section: "Gall Bladder", abnormal: true },
      { text: "Both kidneys normal.", section: "Kidneys", abnormal: false },
    ]);
    expect(r.findingsText.split("\n")).toHaveLength(3);
    expect(r.impressionLines).toHaveLength(2);
  });
});
