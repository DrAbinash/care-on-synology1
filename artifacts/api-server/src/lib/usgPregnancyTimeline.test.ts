import { describe, it, expect } from "vitest";
import { buildPregnancyTimeline, type TimelineScanInput } from "./usgPregnancyTimeline";

const scan = (over: Partial<TimelineScanInput>): TimelineScanInput => ({
  studyInstanceUID: "s", studyDate: "20240101", ...over,
});

describe("P4.4 usgPregnancyTimeline", () => {
  it("carries CRL / placenta / presentation through to the timeline point (GAP 2 UI fields)", () => {
    const t = buildPregnancyTimeline([
      scan({ studyInstanceUID: "a", studyDate: "20240301", crlMm: 62, placenta: "Anterior", presentation: "Cephalic" }),
    ]);
    expect(t.points[0].crlMm).toBe(62);
    expect(t.points[0].placenta).toBe("Anterior");
    expect(t.points[0].presentation).toBe("Cephalic");
  });

  it("establishes GA once from the earliest CRL scan and projects it forward", () => {
    const t = buildPregnancyTimeline([
      scan({ studyInstanceUID: "dating", studyDate: "20240101", crlMm: 60 }),
      scan({ studyInstanceUID: "growth", studyDate: "20240129" }),
    ]);
    expect(t.established).not.toBeNull();
    expect(t.established!.method).toBe("crl");
    const growth = t.points.find((p) => p.studyInstanceUID === "growth")!;
    const dating = t.points.find((p) => p.studyInstanceUID === "dating")!;
    // 28 days later → GA advanced by 28 days.
    expect(growth.gaByUltrasoundDays! - dating.gaByUltrasoundDays!).toBe(28);
  });

  it("computes GA-by-dates from LMP independently of ultrasound dating", () => {
    const t = buildPregnancyTimeline([scan({ studyDate: "20240401", lmp: "20240101" })]);
    expect(t.points[0].gaByDatesDays).toBe(91);
    expect(t.points[0].gaDisplay).toMatch(/^\d+w \d+d$/);
  });

  it("derives EFW from HC/AC/FL via the canonical engine and builds trends", () => {
    const t = buildPregnancyTimeline([
      scan({ studyInstanceUID: "a", studyDate: "20240301", crlMm: 60, bpdMm: 45, hcMm: 170, acMm: 150, flMm: 30 }),
      scan({ studyInstanceUID: "b", studyDate: "20240401", bpdMm: 55, hcMm: 200, acMm: 180, flMm: 38 }),
    ]);
    expect(t.points.every((p) => p.efwGrams != null)).toBe(true);
    const efwTrend = t.trends.find((tr) => tr.key === "efwGrams");
    expect(efwTrend?.points.length).toBe(2);
    // EFW should increase across gestation.
    expect(efwTrend!.points[1].value).toBeGreaterThan(efwTrend!.points[0].value);
  });

  it("orders points chronologically and skips undatable scans", () => {
    const t = buildPregnancyTimeline([
      scan({ studyInstanceUID: "later", studyDate: "20240401", lmp: "20240101" }),
      scan({ studyInstanceUID: "earlier", studyDate: "20240201", lmp: "20240101" }),
      scan({ studyInstanceUID: "bad", studyDate: "not-a-date" }),
    ]);
    expect(t.points.map((p) => p.studyInstanceUID)).toEqual(["earlier", "later"]);
  });
});
