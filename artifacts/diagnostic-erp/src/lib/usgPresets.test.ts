import { describe, it, expect } from "vitest";
import { resolvePreset, presetsForSex, presetByKey, USG_PRESETS } from "./usgPresets";

describe("preset registry", () => {
  it("every preset resolves to a known organ set", () => {
    for (const p of USG_PRESETS) {
      const r = resolvePreset(p.key, { sex: "male" });
      expect(r.preset.key).toBe(p.key);
      expect(Array.isArray(r.organs)).toBe(true);
    }
  });
  it("unknown preset falls back to whole abdomen", () => {
    expect(resolvePreset("nope").preset.key).toBe("whole_abdomen");
  });
});

describe("sex filtering", () => {
  it("KUB male includes prostate, not uterus/ovaries", () => {
    const keys = resolvePreset("kub", { sex: "male" }).organs.map((o) => o.key);
    expect(keys).toEqual(["right_kidney", "left_kidney", "urinary_bladder", "prostate"]);
  });
  it("KUB female drops prostate", () => {
    const keys = resolvePreset("kub", { sex: "female" }).organs.map((o) => o.key);
    expect(keys).toEqual(["right_kidney", "left_kidney", "urinary_bladder"]);
  });
  it("female pelvis is restricted from male patients (presetsForSex)", () => {
    const maleKeys = presetsForSex("male").map((p) => p.key);
    expect(maleKeys).toContain("male_pelvis");
    expect(maleKeys).not.toContain("female_pelvis");
    const femaleKeys = presetsForSex("female").map((p) => p.key);
    expect(femaleKeys).toContain("female_pelvis");
    expect(femaleKeys).not.toContain("male_pelvis");
  });
});

describe("clinical modifiers", () => {
  it("post-cholecystectomy removes the gallbladder from expected organs and marks it absent", () => {
    const r = resolvePreset("whole_abdomen", { sex: "male", modifiers: ["post_cholecystectomy"] });
    expect(r.organs.map((o) => o.key)).not.toContain("gallbladder");
    expect(r.absent.map((a) => a.organKey)).toContain("gallbladder");
    expect(r.absent[0].statement).toMatch(/surgically absent/i);
  });
  it("nephrectomy removes only the named kidney", () => {
    const r = resolvePreset("renal", { sex: "male", modifiers: ["nephrectomy_left"] });
    const keys = r.organs.map((o) => o.key);
    expect(keys).toContain("right_kidney");
    expect(keys).not.toContain("left_kidney");
  });
  it("post-hysterectomy removes the uterus for a female pelvis", () => {
    const r = resolvePreset("female_pelvis", { sex: "female", modifiers: ["post_hysterectomy"] });
    expect(r.organs.map((o) => o.key)).not.toContain("uterus");
    expect(r.absent.map((a) => a.organKey)).toContain("uterus");
  });
  it("limitation modifiers add a note without removing organs", () => {
    const r = resolvePreset("renal", { sex: "male", modifiers: ["bowel_gas_limitation"] });
    expect(r.organs.length).toBe(3);
    expect(r.limitations.join(" ")).toMatch(/bowel gas/i);
  });
});
