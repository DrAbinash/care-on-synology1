import { describe, it, expect } from "vitest";
import { composeReport, type BaseSection } from "./findingsCompose";

const USG_ABDOMEN: BaseSection[] = [
  { section: "Liver", normal: "Normal in size and echotexture. No focal lesion." },
  { section: "Gall Bladder", normal: "Normal wall thickness. No calculus." },
  { section: "Pancreas", normal: "Normal in size and echotexture." },
  { section: "Kidneys", normal: "Both kidneys normal. No hydronephrosis." },
];

describe("composeReport — template-driven, abnormal replaces normal", () => {
  it("keeps all normals when nothing abnormal is selected", () => {
    const r = composeReport(USG_ABDOMEN, []);
    expect(r.lines).toHaveLength(4);
    expect(r.lines.every((l) => !l.abnormal)).toBe(true);
    expect(r.impressionLines).toEqual([]);
    expect(r.findingsText).toContain("Gall Bladder: Normal wall thickness. No calculus.");
  });

  it("an abnormal finding REPLACES that organ's normal line", () => {
    const r = composeReport(USG_ABDOMEN, [
      { text: "Cholelithiasis with multiple calculi.", section: "Gall Bladder", abnormal: true },
    ]);
    const gb = r.lines.find((l) => l.section === "Gall Bladder")!;
    expect(gb.abnormal).toBe(true);
    expect(gb.text).toBe("Cholelithiasis with multiple calculi.");
    // the normal GB line is gone
    expect(r.findingsText).not.toContain("Normal wall thickness. No calculus.");
    // other organs stay normal
    expect(r.lines.find((l) => l.section === "Liver")!.abnormal).toBe(false);
  });

  it("abnormal findings also become impression lines (in anatomical body order)", () => {
    const r = composeReport(USG_ABDOMEN, [
      { text: "Cholelithiasis.", section: "Gall Bladder", abnormal: true },
      { text: "Grade II fatty liver.", section: "Liver", abnormal: true },
    ]);
    // Liver precedes Gall Bladder in house order, so the impression follows suit
    expect(r.impressionLines).toEqual(["Grade II fatty liver.", "Cholelithiasis."]);
  });

  it("keeps house anatomical order (Liver → Gall Bladder → Kidneys)", () => {
    const r = composeReport(USG_ABDOMEN, [
      { text: "Simple cortical cyst.", section: "Kidneys", abnormal: true },
    ]);
    expect(r.lines.map((l) => l.section)).toEqual(["Liver", "Gall Bladder", "Pancreas", "Kidneys"]);
  });

  it("multiple abnormals for one organ combine into that organ's line", () => {
    const r = composeReport(USG_ABDOMEN, [
      { text: "Cholelithiasis.", section: "Gall Bladder", abnormal: true },
      { text: "Gall bladder wall oedema.", section: "Gall Bladder", abnormal: true },
    ]);
    const gb = r.lines.find((l) => l.section === "Gall Bladder")!;
    expect(gb.text).toBe("Cholelithiasis. Gall bladder wall oedema.");
    expect(r.impressionLines).toHaveLength(2);
  });

  it("an abnormal for an organ not in the base is appended in anatomical order", () => {
    const r = composeReport(USG_ABDOMEN, [
      { text: "Mild splenomegaly.", section: "Spleen", abnormal: true },
    ]);
    // Spleen sorts after Pancreas per house order
    const idxPancreas = r.lines.findIndex((l) => l.section === "Pancreas");
    const idxSpleen = r.lines.findIndex((l) => l.section === "Spleen");
    expect(idxSpleen).toBeGreaterThan(idxPancreas);
    expect(r.lines.find((l) => l.section === "Spleen")!.abnormal).toBe(true);
  });

  it("works with no base template (free composition)", () => {
    const r = composeReport(undefined, [
      { text: "No acute haemorrhage.", section: "Brain Parenchyma", abnormal: false },
      { text: "Right MCA infarct.", section: "Brain Parenchyma", abnormal: true },
    ]);
    // abnormal wins the section line
    const bp = r.lines.find((l) => l.section === "Brain Parenchyma")!;
    expect(bp.abnormal).toBe(true);
    expect(bp.text).toBe("Right MCA infarct.");
    expect(r.impressionLines).toEqual(["Right MCA infarct."]);
  });

  it("strips a leading organ label from impression lines", () => {
    const r = composeReport(USG_ABDOMEN, [
      { text: "Gall Bladder: Cholelithiasis with sludge.", section: "Gall Bladder", abnormal: true },
    ]);
    expect(r.impressionLines).toEqual(["Cholelithiasis with sludge."]);
  });
});
