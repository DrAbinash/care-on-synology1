import { describe, it, expect } from "vitest";
import { buildObSection } from "./usgObSection";

describe("P5.1 usgObSection — canonical OB section via the one engine", () => {
  it("establishes GA from CRL and computes EDD, driving the impression", () => {
    const r = buildObSection({
      studyDate: "2024-03-01", crlMm: 60, fhrBpm: 150,
      liveGestation: true, cardiacActivity: true,
    });
    expect(r.computed.gaMethod).toBe("crl");
    expect(r.computed.gaByUsDays).toBeGreaterThan(0);
    expect(r.computed.eddIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.impression[0]).toMatch(/single live intrauterine gestation/i);
    expect(r.impression[0]).toMatch(/cardiac activity present/i);
  });

  it("computes EFW from HC/AC/FL and reports AFI interpretation", () => {
    const r = buildObSection({
      studyDate: "2024-03-01", lmp: "2023-08-15",
      bpdMm: 80, hcMm: 290, acMm: 260, flMm: 58, afiCm: 4, liveGestation: true,
    });
    expect(r.computed.efwGrams).not.toBeNull();
    expect(r.computed.afiInterpretation).toBe("oligohydramnios");
    expect(r.impression.some((i) => /oligohydramnios/i.test(i))).toBe(true);
    // Oligohydramnios → not a "normal" section.
    expect(r.section.normal).toBe(false);
  });

  it("flags a GA-by-US vs GA-by-dates discrepancy as a descriptive caveat", () => {
    // CRL 60mm ≈ 12+4w, but an LMP implying ~20w → large gap.
    const r = buildObSection({
      studyDate: "2024-03-01", crlMm: 60, lmp: "2023-10-15", liveGestation: true,
    });
    expect(r.caveats.length).toBeGreaterThan(0);
    expect(r.caveats[0]).toMatch(/differs from age by dates/i);
    expect(r.section.normal).toBe(false);
  });

  it("never emits fetal sex and drops clauses for missing inputs (no fabrication)", () => {
    const r = buildObSection({ studyDate: "2024-03-01", crlMm: 55, liveGestation: true });
    const blob = `${r.section.text} ${r.impression.join(" ")} ${r.caveats.join(" ")}`.toLowerCase();
    expect(blob).not.toMatch(/\b(male|female|sex|gender|boy|girl)\b/);
    expect(r.section.text).not.toMatch(/EFW/); // no HC/AC/FL provided → no EFW clause
    expect(r.computed.efwGrams).toBeNull();
  });

  it("accepts four AFI quadrants and derives the total via the engine", () => {
    const r = buildObSection({
      studyDate: "2024-03-01", crlMm: 60, afiQuadrantsCm: [3, 4, 3, 4], liveGestation: true,
    });
    expect(r.computed.afiCm).toBe(14);
    expect(r.computed.afiInterpretation).toBe("normal");
  });
});
