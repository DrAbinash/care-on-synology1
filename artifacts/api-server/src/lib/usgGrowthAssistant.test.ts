import { describe, it, expect } from "vitest";
import { buildGrowthNotes } from "./usgGrowthAssistant";
import type { PregnancyTimeline, TimelinePoint } from "./usgPregnancyTimeline";

const pt = (over: Partial<TimelinePoint>): TimelinePoint => ({
  studyInstanceUID: "1.2." + (over.date ?? "x"),
  date: "2024-01-01",
  gaByDatesDays: null, gaByUltrasoundDays: null, gaDisplay: null,
  efwGrams: null, crlMm: null, bpdMm: null, hcMm: null, acMm: null, flMm: null, afiCm: null,
  placenta: null, presentation: null,
  ...over,
});
const tl = (points: TimelinePoint[]): PregnancyTimeline => ({ points, trends: [], established: null });

describe("usgGrowthAssistant — deterministic growth notes", () => {
  it("returns nothing when there is only one (or zero) scans", () => {
    expect(buildGrowthNotes(tl([]))).toEqual([]);
    expect(buildGrowthNotes(tl([pt({ date: "2024-01-01", efwGrams: 500 })]))).toEqual([]);
  });

  it("summarises interval EFW growth from the two most recent scans", () => {
    const notes = buildGrowthNotes(tl([
      pt({ date: "2024-01-01", efwGrams: 1000, gaDisplay: "28w 0d" }),
      pt({ date: "2024-01-15", efwGrams: 1280, gaDisplay: "30w 0d" }),
    ]));
    const efw = notes.find((n) => n.section === "Growth" && /Estimated fetal weight/.test(n.text));
    expect(efw).toBeTruthy();
    expect(efw!.kind).toBe("growth_note");
    expect(efw!.text).toContain("increased from 1000 g to 1280 g");
    expect(efw!.text).toContain("over 14 days");
    expect(efw!.text).toContain("20 g/day"); // 280 / 14
    expect(efw!.evidence).toMatchObject({ from_g: 1000, to_g: 1280, interval_days: 14, per_day_g: 20 });
  });

  it("reports an AFI trend as values only — never oligo/poly classification", () => {
    const notes = buildGrowthNotes(tl([
      pt({ date: "2024-01-01", afiCm: 12 }),
      pt({ date: "2024-01-15", afiCm: 8 }),
    ]));
    const afi = notes.find((n) => n.section === "Liquor")!;
    expect(afi.text).toContain("decreased from 12 cm to 8 cm");
    expect(afi.text.toLowerCase()).not.toMatch(/oligo|poly|hydramnios/);
  });

  it("never emits percentiles, IUGR/macrosomia, or fetal-sex language", () => {
    const notes = buildGrowthNotes(tl([
      pt({ date: "2024-01-01", efwGrams: 900, afiCm: 14 }),
      pt({ date: "2024-01-10", efwGrams: 1100, afiCm: 13 }),
      pt({ date: "2024-01-20", efwGrams: 1350, afiCm: 12 }),
    ]));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n.text.toLowerCase()).not.toMatch(/percentile|iugr|growth restriction|macrosom|sga|lga|\bmale\b|\bfemale\b|\bboy\b|\bgirl\b|gender|\bsex\b/);
    }
  });

  it("adds a serial-context note when >=3 EFW points exist", () => {
    const notes = buildGrowthNotes(tl([
      pt({ date: "2024-01-01", efwGrams: 900 }),
      pt({ date: "2024-01-10", efwGrams: 1100 }),
      pt({ date: "2024-01-20", efwGrams: 1350 }),
    ]));
    expect(notes.some((n) => /3 EFW data points/.test(n.text))).toBe(true);
  });
});
