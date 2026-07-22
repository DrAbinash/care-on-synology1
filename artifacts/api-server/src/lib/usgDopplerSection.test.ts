import { describe, it, expect } from "vitest";
import { buildDopplerSection } from "./usgDopplerSection";

describe("P5.2 usgDopplerSection — canonical Doppler via the one engine", () => {
  it("computes RI and S/D from PSV/EDV", () => {
    const r = buildDopplerSection([{ vessel: "Umbilical artery", psv: 40, edv: 10 }]);
    expect(r.vessels[0].ri).toBeCloseTo(0.75, 2);
    expect(r.vessels[0].sdRatio).toBeCloseTo(4, 2);
    expect(r.section.text).toMatch(/Umbilical artery/);
    expect(r.section.normal).toBe(true);
  });

  it("computes PI only when TAMV is present (never fabricated)", () => {
    const withTamv = buildDopplerSection([{ vessel: "MCA", psv: 40, edv: 10, tamv: 20 }]);
    expect(withTamv.vessels[0].pi).toBeCloseTo(1.5, 2);
    const without = buildDopplerSection([{ vessel: "MCA", psv: 40, edv: 10 }]);
    expect(without.vessels[0].pi).toBeNull();
  });

  it("flags absent and reversed end-diastolic flow descriptively (correlate clinically)", () => {
    const absent = buildDopplerSection([{ vessel: "Umbilical artery", psv: 40, edv: 0 }]);
    expect(absent.vessels[0].sdRatio).toBeNull();
    expect(absent.vessels[0].flags.join(" ")).toMatch(/absent end-diastolic flow — correlate clinically/i);
    expect(absent.section.normal).toBe(false);

    const reversed = buildDopplerSection([{ vessel: "Umbilical artery", psv: 40, edv: -5 }]);
    expect(reversed.vessels[0].ri).toBeNull();
    expect(reversed.vessels[0].flags.join(" ")).toMatch(/reversed end-diastolic flow/i);
  });

  it("computes CPR from MCA-PI and paired UA-PI and flags CPR < 1", () => {
    const r = buildDopplerSection([{ vessel: "MCA", psv: 40, edv: 10, tamv: 40, pairedUaPi: 2 }]);
    // PI = (40-10)/40 = 0.75; CPR = 0.75/2 = 0.375 → < 1.
    expect(r.vessels[0].cpr).toBeCloseTo(0.38, 2);
    expect(r.impression.join(" ")).toMatch(/cerebroplacental ratio below 1\.0/i);
  });

  it("never surfaces engine error text as a report warning for absent/reversed flow", () => {
    const r = buildDopplerSection([{ vessel: "Umbilical artery", psv: 40, edv: -5 }]);
    expect(r.warnings.join(" ")).not.toMatch(/division by zero|cannot be negative/i);
  });

  it("does not auto-diagnose — flags only ask for correlation", () => {
    const r = buildDopplerSection([{ vessel: "Umbilical artery", psv: 40, edv: 0 }]);
    const blob = `${r.section.text} ${r.impression.join(" ")}`.toLowerCase();
    expect(blob).not.toMatch(/\b(iugr|growth restriction|hypoxia|distress|abnormal fetus)\b/);
  });
});
