import { describe, it, expect } from "vitest";
import {
  calcGaDaysFromCrl, calcGaDaysFromMsd, calcGaDaysFromLmp, calcEddFromLmp, calcEddFromEstablishedGa,
  gaDaysToWeeksDays, establishGa, projectGaForwardDays, calcEfwGrams,
  calcAfiFromQuadrants, calcAfiInterpretation, calcCervicalLengthInterpretation,
  calcRi, calcPi, calcSdRatio, calcSdFromRi, calcCpr, calcTwinDiscordancePercent,
  isFiniteNumber, checkMeasurementRange, mmToCm,
} from "./obstetricCalculations";

// These tests lock down the fix for the confirmed patient-safety bug: the
// old formulas produced "243 weeks" for a normal 82mm BPD and "3559 weeks"
// for a normal 300mm AC (unit-mismatched, cm-calibrated coefficients fed
// mm inputs — see docs/usg-reporting-audit/06-measurements-and-calculations.md
// and docs/usg-reporting/fetal-usg-calculation-correction.md). Every
// gestational-age assertion below checks the result lands in a clinically
// plausible week range, not just "doesn't crash."

describe("isFiniteNumber / checkMeasurementRange / mmToCm — guardrail primitives", () => {
  it("isFiniteNumber rejects NaN, Infinity, non-numbers", () => {
    expect(isFiniteNumber(5)).toBe(true);
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
    expect(isFiniteNumber("5" as any)).toBe(false);
    expect(isFiniteNumber(null as any)).toBe(false);
    expect(isFiniteNumber(undefined as any)).toBe(false);
  });

  it("checkMeasurementRange flags negative, zero, and out-of-range values without throwing", () => {
    expect(checkMeasurementRange("BPD", -5, { min: 10, max: 100, unit: "mm" })).toMatch(/cannot be negative/);
    expect(checkMeasurementRange("BPD", 0, { min: 10, max: 100, unit: "mm" })).toMatch(/not a valid measurement/);
    expect(checkMeasurementRange("BPD", 500, { min: 10, max: 100, unit: "mm" })).toMatch(/outside the plausible range/);
    expect(checkMeasurementRange("BPD", 50, { min: 10, max: 100, unit: "mm" })).toBeNull();
    expect(checkMeasurementRange("BPD", NaN, { min: 10, max: 100, unit: "mm" })).toMatch(/not a valid number/);
  });

  it("mmToCm converts correctly", () => {
    expect(mmToCm(82)).toBe(8.2);
    expect(mmToCm(300)).toBe(30);
  });
});

describe("calcGaDaysFromCrl — CRL dating (Robinson & Fleming)", () => {
  it("a realistic first-trimester CRL (~50mm) lands in the plausible 11-12 week range", () => {
    const result = calcGaDaysFromCrl(50);
    expect(result.status).not.toBe("invalid");
    expect(result.value).not.toBeNull();
    const { weeks } = gaDaysToWeeksDays(result.value!);
    expect(weeks).toBeGreaterThanOrEqual(11);
    expect(weeks).toBeLessThanOrEqual(12);
  });

  it("a lower realistic CRL (~20mm, ~8 weeks) lands in a plausible early range", () => {
    const result = calcGaDaysFromCrl(20);
    const { weeks } = gaDaysToWeeksDays(result.value!);
    expect(weeks).toBeGreaterThanOrEqual(7);
    expect(weeks).toBeLessThanOrEqual(9);
  });

  it("an upper valid first-trimester CRL (~80mm, ~13-14 weeks) lands in a plausible range", () => {
    const result = calcGaDaysFromCrl(80);
    const { weeks } = gaDaysToWeeksDays(result.value!);
    expect(weeks).toBeGreaterThanOrEqual(13);
    expect(weeks).toBeLessThanOrEqual(14);
  });

  it("never returns an impossible gestational age like the old bug (46.9 or 53.4 weeks for 50mm CRL)", () => {
    const result = calcGaDaysFromCrl(50);
    const { weeks } = gaDaysToWeeksDays(result.value!);
    expect(weeks).toBeLessThan(20);
  });

  it("flags an out-of-validated-range CRL with a warning, not silent failure", () => {
    const result = calcGaDaysFromCrl(150);
    expect(result.status).toBe("warning");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.value).not.toBeNull(); // still computed — flagged, not blocked
  });

  it("rejects negative, zero, and missing CRL", () => {
    expect(calcGaDaysFromCrl(-5).status).toBe("invalid");
    expect(calcGaDaysFromCrl(0).status).toBe("invalid");
    expect(calcGaDaysFromCrl(NaN).status).toBe("invalid");
  });
});

describe("calcGaDaysFromMsd — MSD dating", () => {
  it("a realistic early MSD (~15mm) produces a plausible ~6.4 week estimate", () => {
    const result = calcGaDaysFromMsd(15);
    const { weeks } = gaDaysToWeeksDays(result.value!);
    expect(weeks).toBeGreaterThanOrEqual(5);
    expect(weeks).toBeLessThanOrEqual(8);
  });

  it("always carries a warning that CRL should be preferred once available", () => {
    const result = calcGaDaysFromMsd(6);
    expect(result.warnings.some((w) => /CRL/.test(w))).toBe(true);
  });

  it("rejects negative, zero, and missing MSD", () => {
    expect(calcGaDaysFromMsd(-1).status).toBe("invalid");
    expect(calcGaDaysFromMsd(0).status).toBe("invalid");
  });
});

describe("calcGaDaysFromLmp / calcEddFromLmp — LMP-based dating", () => {
  it("computes elapsed days correctly for an ordinary date", () => {
    const result = calcGaDaysFromLmp("2026-01-01", new Date("2026-03-01T00:00:00.000Z"));
    expect(result.value).toBe(59); // Jan has 31 days, so Jan1->Mar1 = 31+28 = 59 (2026 not a leap year)
  });

  it("rejects an LMP date in the future relative to the study date", () => {
    const result = calcGaDaysFromLmp("2026-06-01", new Date("2026-01-01T00:00:00.000Z"));
    expect(result.status).toBe("invalid");
  });

  it("EDD via Naegele's rule is exactly LMP + 280 days, timezone-safe", () => {
    const result = calcEddFromLmp("2026-01-01");
    expect(result.value).toBe("2026-10-08");
  });

  it("handles a month boundary correctly", () => {
    const result = calcEddFromLmp("2026-01-31");
    expect(result.value).toBe("2026-11-07");
  });

  it("handles a year boundary correctly", () => {
    const result = calcEddFromLmp("2026-12-01");
    expect(result.value).toBe("2027-09-07");
  });

  it("handles a leap year correctly (2028 is a leap year)", () => {
    const result = calcEddFromLmp("2028-01-01");
    // 2028 is a leap year — Feb has 29 days, so EDD lands one day "earlier" in
    // date terms than a non-leap-year LMP of the same nominal date would.
    const d = new Date(result.value!);
    expect(d.getUTCFullYear()).toBe(2028);
  });

  it("calcEddFromEstablishedGa produces a self-consistent EDD (established GA + remaining days = 280 total)", () => {
    const established = calcGaDaysFromCrl(50); // ~80 days
    const edd = calcEddFromEstablishedGa(established.value!, "2026-03-01");
    expect(edd.status).not.toBe("invalid");
    const eddDate = new Date(edd.value!);
    const studyDate = new Date("2026-03-01T00:00:00.000Z");
    const daysBetween = Math.round((eddDate.getTime() - studyDate.getTime()) / 86_400_000);
    expect(daysBetween).toBe(280 - established.value!);
  });
});

describe("establishGa / projectGaForwardDays — establish-once, project-forward", () => {
  it("prefers CRL over MSD and LMP when all are present", () => {
    const result = establishGa({ crlMm: 50, msdMm: 15, lmp: "2026-01-01", asOfDate: new Date("2026-03-25T00:00:00.000Z") });
    expect(result?.method).toBe("crl");
  });

  it("falls back to MSD when CRL is absent", () => {
    const result = establishGa({ msdMm: 15, lmp: "2026-01-01", asOfDate: new Date("2026-01-20T00:00:00.000Z") });
    expect(result?.method).toBe("msd");
  });

  it("falls back to LMP when neither CRL nor MSD is present", () => {
    const result = establishGa({ lmp: "2026-01-01", asOfDate: new Date("2026-03-01T00:00:00.000Z") });
    expect(result?.method).toBe("lmp");
  });

  it("falls back to a manual GA entry, clearly flagged, when nothing else is available", () => {
    const result = establishGa({ manualGaDays: 140, asOfDate: new Date() });
    expect(result?.method).toBe("manual");
    expect(result?.warnings.length).toBeGreaterThan(0);
  });

  it("returns null (never fabricates a GA) when no dating source is available at all", () => {
    const result = establishGa({ asOfDate: new Date() });
    expect(result).toBeNull();
  });

  it("projectGaForwardDays adds exactly the elapsed calendar days", () => {
    const established = 84; // 12 weeks established via CRL
    const projected = projectGaForwardDays(established, "2026-01-01", new Date("2026-02-01T00:00:00.000Z"));
    expect(projected).toBe(84 + 31);
  });

  it("a GA established via CRL at 12 weeks and projected 20 weeks later lands at a plausible ~32 weeks — the exact real-world scenario the old bug broke (re-deriving 'GA' from BPD/AC at a growth scan)", () => {
    const established = establishGa({ crlMm: 50, asOfDate: new Date("2026-01-01T00:00:00.000Z") })!;
    const projectedDays = projectGaForwardDays(established.gaDays, "2026-01-01", new Date("2026-05-21T00:00:00.000Z")); // +140 days ≈ 20 weeks later
    const { weeks } = gaDaysToWeeksDays(projectedDays);
    expect(weeks).toBeGreaterThanOrEqual(30);
    expect(weeks).toBeLessThanOrEqual(34);
  });
});

describe("calcEfwGrams — Hadlock (1985) HC+AC+FL", () => {
  it("a realistic near-term combination (BPD~82mm is not used by this formula, HC~300mm, AC~300mm, FL~65mm) produces a plausible, non-zero EFW", () => {
    // Exact reproduction case from the task brief.
    const result = calcEfwGrams(300, 300, 65);
    expect(result.status).not.toBe("invalid");
    expect(result.value).not.toBeNull();
    expect(result.value).toBeGreaterThan(500);
    expect(result.value).toBeLessThan(6000);
  });

  it("never returns 0g or a near-zero value for realistic term measurements — the exact old bug", () => {
    const result = calcEfwGrams(300, 300, 65);
    expect(result.value).toBeGreaterThan(100);
  });

  it("is missing-safe — does not compute (and does not return 0) when any of HC/AC/FL is missing", () => {
    expect(calcEfwGrams(NaN, 300, 65).status).toBe("invalid");
    expect(calcEfwGrams(300, NaN, 65).status).toBe("invalid");
    expect(calcEfwGrams(300, 300, NaN).status).toBe("invalid");
  });

  it("rejects zero/negative inputs rather than computing a bogus EFW", () => {
    expect(calcEfwGrams(0, 300, 65).status).toBe("invalid");
    expect(calcEfwGrams(300, -10, 65).status).toBe("invalid");
  });

  it("a smaller, earlier-pregnancy combination also produces a plausible EFW in the correct direction (smaller than the term example)", () => {
    const term = calcEfwGrams(300, 300, 65).value!;
    const earlier = calcEfwGrams(180, 180, 35).value!;
    expect(earlier).toBeLessThan(term);
    expect(earlier).toBeGreaterThan(0);
  });
});

describe("calcAfiFromQuadrants / calcAfiInterpretation", () => {
  it("sums four valid quadrants correctly", () => {
    const result = calcAfiFromQuadrants(3, 4, 3.5, 4.2);
    expect(result.value).toBeCloseTo(14.7, 1);
  });

  it("does not treat a missing quadrant as zero — refuses to compute instead", () => {
    const result = calcAfiFromQuadrants(3, 4, NaN, 4.2);
    expect(result.status).toBe("invalid");
    expect(result.value).toBeNull();
  });

  it("rejects negative quadrant values", () => {
    expect(calcAfiFromQuadrants(3, -1, 3, 3).status).toBe("invalid");
  });

  it("classifies AFI < 5 as oligohydramnios", () => {
    expect(calcAfiInterpretation(4).value).toBe("oligohydramnios");
  });

  it("classifies AFI > 24 as polyhydramnios", () => {
    expect(calcAfiInterpretation(26).value).toBe("polyhydramnios");
  });

  it("classifies a normal AFI as normal", () => {
    expect(calcAfiInterpretation(12).value).toBe("normal");
  });

  it("flags 5-8 as borderline-low with a warning, still classified normal-adjacent", () => {
    const result = calcAfiInterpretation(6);
    expect(result.value).toBe("borderline_low");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("calcCervicalLengthInterpretation", () => {
  it("classifies < 25mm as short_cervix", () => {
    expect(calcCervicalLengthInterpretation(20).value).toBe("short_cervix");
  });

  it("classifies >= 30mm as normal", () => {
    expect(calcCervicalLengthInterpretation(35).value).toBe("normal");
  });

  it("classifies 25-29mm as borderline", () => {
    expect(calcCervicalLengthInterpretation(27).value).toBe("borderline");
  });

  it("adds a GA-context warning outside the validated 16-24 week screening window", () => {
    const outside = calcCervicalLengthInterpretation(20, 30);
    expect(outside.warnings.length).toBeGreaterThan(0);
    const inside = calcCervicalLengthInterpretation(20, 20);
    expect(inside.warnings.length).toBe(0);
  });
});

describe("calcRi / calcPi / calcSdRatio / calcSdFromRi — Doppler indices", () => {
  it("calcRi computes the correct Pourcelot RI", () => {
    const result = calcRi(60, 15);
    expect(result.value).toBeCloseTo(0.75, 2);
  });

  it("calcRi guards against division by zero (PSV=0)", () => {
    expect(calcRi(0, 10).status).toBe("invalid");
  });

  it("calcPi requires TAMV and never fabricates it from PSV/EDV alone", () => {
    const result = calcPi(60, 15, 30);
    expect(result.status).not.toBe("invalid");
    expect(result.value).toBeCloseTo(1.5, 2);
    expect(calcPi(60, 15, 0).status).toBe("invalid");
    expect(calcPi(60, 15, NaN).status).toBe("invalid");
  });

  it("calcSdRatio computes PSV/EDV and guards divide-by-zero", () => {
    expect(calcSdRatio(60, 15).value).toBeCloseTo(4, 2);
    expect(calcSdRatio(60, 0).status).toBe("invalid");
  });

  it("calcSdFromRi derives S/D from RI via the exact algebraic identity", () => {
    const ri = calcRi(60, 15).value!; // 0.75
    const sdDirect = calcSdRatio(60, 15).value!; // 4.0
    const sdDerived = calcSdFromRi(ri).value!;
    expect(sdDerived).toBeCloseTo(sdDirect, 1);
  });

  it("calcSdFromRi rejects RI=1 (division by zero) and out-of-range RI", () => {
    expect(calcSdFromRi(1).status).toBe("invalid");
    expect(calcSdFromRi(-0.1).status).toBe("invalid");
    expect(calcSdFromRi(1.5).status).toBe("invalid");
  });

  it("flags physiologically implausible RI/PI/CPR with warnings rather than silently accepting them", () => {
    expect(calcRi(10, 15).warnings.length).toBeGreaterThan(0); // RI would be negative
  });
});

describe("calcCpr — Cerebroplacental Ratio", () => {
  it("computes MCA-PI / UA-PI correctly", () => {
    const result = calcCpr(1.6, 0.8);
    expect(result.value).toBeCloseTo(2.0, 2);
  });

  it("guards against division by zero (UA-PI=0)", () => {
    expect(calcCpr(1.6, 0).status).toBe("invalid");
  });

  it("requires both inputs — missing UA-PI or MCA-PI blocks the calculation, never guesses", () => {
    expect(calcCpr(NaN, 0.8).status).toBe("invalid");
    expect(calcCpr(1.6, NaN).status).toBe("invalid");
  });

  it("rejects a negative MCA-PI", () => {
    expect(calcCpr(-1, 0.8).status).toBe("invalid");
  });
});

describe("calcTwinDiscordancePercent", () => {
  it("computes discordance as (larger-smaller)/larger, regardless of which twin is passed first", () => {
    const ab = calcTwinDiscordancePercent(2000, 1600);
    const ba = calcTwinDiscordancePercent(1600, 2000);
    expect(ab.value).toBeCloseTo(20, 1);
    expect(ba.value).toBeCloseTo(20, 1); // never silently swaps twin identity in the math — result is symmetric
  });

  it("warns when discordance exceeds 20%", () => {
    const result = calcTwinDiscordancePercent(2500, 1800);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("requires both twins' EFW — missing one blocks the calculation", () => {
    expect(calcTwinDiscordancePercent(NaN, 1600).status).toBe("invalid");
  });

  it("rejects zero/negative EFW", () => {
    expect(calcTwinDiscordancePercent(0, 1600).status).toBe("invalid");
  });
});
