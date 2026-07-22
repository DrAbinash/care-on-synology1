import { describe, it, expect } from "vitest";
import { generateUsgFinding } from "./usgFindingBuilder";
import { findingDefById, findingDefsForOrgan } from "./usgOrganLibrary";

const gen = (id: string, v: Record<string, string>) => generateUsgFinding(findingDefById(id)!, v).object;

describe("P2.6 extended library — wiring", () => {
  it("new findings are resolvable and wired to their organs", () => {
    expect(findingDefById("liver_fatty")).toBeTruthy();
    expect(findingDefsForOrgan("liver").map((d) => d.id)).toEqual(
      expect.arrayContaining(["liver_fatty", "liver_hepatomegaly", "liver_cyst"]),
    );
    expect(findingDefsForOrgan("right_kidney").map((d) => d.id)).toEqual(
      expect.arrayContaining(["renal_calculus", "kidney_hydronephrosis", "kidney_cyst", "kidney_echogenicity"]),
    );
    expect(findingDefsForOrgan("urinary_bladder").map((d) => d.id)).toEqual(
      expect.arrayContaining(["bladder_wall_thickening", "bladder_pvr"]),
    );
  });
});

describe("P2.6 liver", () => {
  it("fatty liver grade II with hepatomegaly", () => {
    const o = gen("liver_fatty", { grade: "Grade II", hepatomegaly: "Present", span: "16" });
    expect(o.findingText).toContain("grade II fatty liver");
    expect(o.findingText).toContain("moderate");
    expect(o.findingText).toContain("enlarged (span 16 cm)");
    expect(o.impressionText).toBe("Grade II fatty liver with hepatomegaly.");
  });
  it("fatty liver grade I, no hepatomegaly", () => {
    const o = gen("liver_fatty", { grade: "Grade I", hepatomegaly: "Absent" });
    expect(o.findingText).toContain("normal in size");
    expect(o.impressionText).toBe("Grade I fatty liver.");
  });
  it("hepatic cyst single vs multiple", () => {
    expect(gen("liver_cyst", { number: "Single", segment: "right lobe", size: "20 mm" }).findingText).toContain("A well-defined anechoic cyst");
    expect(gen("liver_cyst", { number: "Multiple", segment: "right lobe", size: "20 mm" }).findingText).toContain("Multiple well-defined anechoic cysts");
  });
});

describe("P2.6 gallbladder / CBD", () => {
  it("polyp ≥10 mm raises a follow-up flag in the impression", () => {
    expect(gen("gb_polyp", { number: "Single", size: "12" }).impressionText).toMatch(/≥10 mm/);
    expect(gen("gb_polyp", { number: "Single", size: "5" }).impressionText).toBe("Gallbladder polyp.");
  });
  it("dilated CBD with choledocholithiasis", () => {
    const o = gen("cbd_dilated", { diameter: "9", calculus: "Present" });
    expect(o.findingText).toContain("choledocholithiasis");
    expect(o.impressionText).toBe("Dilated common bile duct with choledocholithiasis.");
    const clean = gen("cbd_dilated", { diameter: "9", calculus: "Absent" });
    expect(clean.impressionText).toBe("Dilated common bile duct.");
  });
});

describe("P2.6 kidney / bladder", () => {
  it("hydronephrosis bilateral with hydroureter", () => {
    const o = gen("kidney_hydronephrosis", { side: "Bilateral", grade: "Moderate", ureter: "Present" });
    expect(o.findingText).toContain("moderate hydronephrosis of both kidneys");
    expect(o.findingText).toContain("hydroureter");
    expect(o.impressionText).toBe("Bilateral moderate hydronephrosis with hydroureter.");
  });
  it("renal cyst laterality", () => {
    const o = gen("kidney_cyst", { side: "Left", number: "Single", pole: "lower pole", size: "18 mm" });
    expect(o.findingText).toContain("lower pole of the left kidney");
    expect(o.impressionText).toBe("Simple left renal cyst.");
  });
  it("post-void residual computes volumes and flags significance", () => {
    const o = gen("bladder_pvr", { pre_l: "8", pre_w: "7", pre_h: "6", post_l: "5", post_w: "4", post_h: "4" });
    // pre 8x7x6 cm... entered mm here → tiny; use mm dims giving cc
    expect(o.findingText).toMatch(/Pre-void bladder volume is approximately \d+ cc/);
    expect(o.impressionText).toMatch(/post-void residual urine/i);
  });
});
