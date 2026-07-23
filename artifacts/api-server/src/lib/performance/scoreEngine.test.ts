import { describe, it, expect } from "vitest";
import {
  computeScore,
  validatePolicy,
  gradeFor,
  DEFAULT_CARE_POLICY,
  type ScoringPolicy,
  type ScoreEvent,
  type GradeBand,
} from "./scoreEngine";

const POLICY: ScoringPolicy = {
  label: "test",
  expectedTotal: 100,
  categories: [
    { key: "attendance", label: "Attendance", maxMarks: 20, strategy: "deduction" },
    { key: "discipline", label: "Discipline", maxMarks: 20, strategy: "deduction" },
    { key: "quality", label: "Quality", maxMarks: 20, strategy: "deduction" },
    { key: "patient_service", label: "Patient Service", maxMarks: 15, strategy: "earned" },
    { key: "teamwork", label: "Teamwork", maxMarks: 15, strategy: "deduction" },
    { key: "initiative", label: "Initiative", maxMarks: 10, strategy: "earned" },
  ],
};

function cat(result: ReturnType<typeof computeScore>, key: string) {
  const c = result.categories.find((x) => x.key === key);
  if (!c) throw new Error(`missing category ${key}`);
  return c;
}

describe("validatePolicy", () => {
  it("accepts the default CARE policy (sums to 100)", () => {
    expect(() => validatePolicy(DEFAULT_CARE_POLICY)).not.toThrow();
  });

  it("throws when categories do not sum to the expected total", () => {
    const bad: ScoringPolicy = {
      categories: [{ key: "a", label: "A", maxMarks: 50, strategy: "deduction" }],
    };
    expect(() => validatePolicy(bad)).toThrow(/sum to 50, expected 100/);
  });

  it("respects an overridden expectedTotal", () => {
    const p: ScoringPolicy = {
      expectedTotal: 50,
      categories: [{ key: "a", label: "A", maxMarks: 50, strategy: "deduction" }],
    };
    expect(() => validatePolicy(p)).not.toThrow();
  });

  it("throws on duplicate category keys", () => {
    const p: ScoringPolicy = {
      expectedTotal: 40,
      categories: [
        { key: "a", label: "A", maxMarks: 20, strategy: "deduction" },
        { key: "a", label: "A2", maxMarks: 20, strategy: "deduction" },
      ],
    };
    expect(() => validatePolicy(p)).toThrow(/Duplicate category key: a/);
  });

  it("throws on a baseline outside [0, maxMarks]", () => {
    const p: ScoringPolicy = {
      expectedTotal: 20,
      categories: [{ key: "a", label: "A", maxMarks: 20, strategy: "earned", baseline: 25 }],
    };
    expect(() => validatePolicy(p)).toThrow(/baseline 25 is outside/);
  });
});

describe("computeScore — baselines", () => {
  it("with no events: deduction categories = max, earned categories = 0", () => {
    const r = computeScore(POLICY, []);
    expect(cat(r, "attendance").score).toBe(20);
    expect(cat(r, "discipline").score).toBe(20);
    expect(cat(r, "quality").score).toBe(20);
    expect(cat(r, "teamwork").score).toBe(15);
    // earned start at 0 — routine duty does NOT auto-award full marks
    expect(cat(r, "patient_service").score).toBe(0);
    expect(cat(r, "initiative").score).toBe(0);
    // 20 + 20 + 20 + 15 + 0 + 0
    expect(r.total).toBe(75);
    expect(r.maxTotal).toBe(100);
    expect(r.disqualified).toBe(false);
  });
});

describe("computeScore — deductions and earnings", () => {
  it("applies the worked example from the master prompt", () => {
    const events: ScoreEvent[] = [
      { date: "2026-07-03", label: "Late by 12 minutes", category: "attendance", points: -1 },
      { date: "2026-07-05", label: "Patient appreciation", category: "patient_service", points: +1 },
      { date: "2026-07-08", label: "Verified mobile misuse", category: "discipline", points: -2 },
      { date: "2026-07-12", label: "Emergency duty support", category: "initiative", points: +2 },
    ];
    const r = computeScore(POLICY, events);
    expect(cat(r, "attendance").score).toBe(19); // 20 - 1
    expect(cat(r, "discipline").score).toBe(18); // 20 - 2
    expect(cat(r, "patient_service").score).toBe(1); // 0 + 1
    expect(cat(r, "initiative").score).toBe(2); // 0 + 2
    // 19 + 18 + 20 + 1 + 15 + 2
    expect(r.total).toBe(75);
  });

  it("floors a deduction category at 0 (cannot go negative)", () => {
    const events: ScoreEvent[] = [
      { category: "attendance", points: -5 },
      { category: "attendance", points: -50 },
    ];
    const r = computeScore(POLICY, events);
    expect(cat(r, "attendance").rawScore).toBe(-35);
    expect(cat(r, "attendance").score).toBe(0);
  });

  it("caps an earned category at its maximum (positive entries cannot exceed max)", () => {
    const events: ScoreEvent[] = [
      { category: "initiative", points: 6 },
      { category: "initiative", points: 6 },
    ];
    const r = computeScore(POLICY, events);
    expect(cat(r, "initiative").rawScore).toBe(12);
    expect(cat(r, "initiative").score).toBe(10); // capped at max 10
  });

  it("caps a positive entry in a deduction category at the category max", () => {
    const events: ScoreEvent[] = [{ category: "attendance", points: +5 }];
    const r = computeScore(POLICY, events);
    expect(cat(r, "attendance").score).toBe(20); // 20 + 5 -> capped at 20
  });
});

describe("computeScore — approval gate", () => {
  it("ignores unapproved events and records them as unapplied", () => {
    const events: ScoreEvent[] = [
      { id: 1, category: "discipline", points: -5, approved: false },
      { id: 2, category: "discipline", points: -2, approved: true },
    ];
    const r = computeScore(POLICY, events);
    expect(cat(r, "discipline").score).toBe(18); // only the approved -2 applied
    expect(r.unapplied).toHaveLength(1);
    expect(r.unapplied[0].reason).toBe("not_approved");
  });
});

describe("computeScore — disqualification", () => {
  it("flags disqualified without zeroing the numeric score", () => {
    const events: ScoreEvent[] = [
      { id: "x", label: "Serious misconduct", category: "discipline", points: -5, disqualifying: true },
    ];
    const r = computeScore(POLICY, events);
    expect(r.disqualified).toBe(true);
    expect(r.disqualifyingEvents).toHaveLength(1);
    expect(cat(r, "discipline").score).toBe(15); // 20 - 5, not zeroed
    expect(r.total).toBe(70); // 20(att) + 15(disc) + 20(qual) + 0(patient) + 15(team) + 0(init)
  });
});

describe("computeScore — unknown category", () => {
  it("does not apply events for unknown categories, records a warning", () => {
    const events: ScoreEvent[] = [{ category: "nonexistent", points: -99 }];
    const r = computeScore(POLICY, events);
    expect(r.total).toBe(75); // unchanged from the no-event baseline
    expect(r.unapplied).toHaveLength(1);
    expect(r.unapplied[0].reason).toBe("unknown_category");
  });
});

describe("computeScore — determinism", () => {
  it("is order-independent and reproducible", () => {
    const a: ScoreEvent[] = [
      { id: 1, date: "2026-07-01", category: "attendance", points: -1 },
      { id: 2, date: "2026-07-02", category: "discipline", points: -2 },
      { id: 3, date: "2026-07-03", category: "initiative", points: +3 },
    ];
    const b = [...a].reverse();
    const ra = computeScore(POLICY, a);
    const rb = computeScore(POLICY, b);
    expect(JSON.stringify(ra)).toEqual(JSON.stringify(rb));
  });
});

describe("computeScore — rounding", () => {
  it("rounds category and total scores to the configured precision", () => {
    const p: ScoringPolicy = {
      expectedTotal: 10,
      roundTo: 1,
      categories: [{ key: "a", label: "A", maxMarks: 10, strategy: "earned" }],
    };
    const r = computeScore(p, [{ category: "a", points: 3.333 }]);
    expect(cat(r, "a").score).toBe(3.3);
    expect(r.total).toBe(3.3);
  });
});

describe("gradeFor", () => {
  const bands: GradeBand[] = [
    { min: 90, label: "Exceptional", recommendation: "Increment or promotion review" },
    { min: 85, label: "Higher increment" },
    { min: 75, label: "Standard increment" },
    { min: 55, label: "Increment deferred" },
    { min: 0, label: "No increment; performance review" },
  ];

  it("selects the highest band whose min is satisfied", () => {
    expect(gradeFor(92, bands)?.label).toBe("Exceptional");
    expect(gradeFor(87, bands)?.label).toBe("Higher increment");
    expect(gradeFor(75, bands)?.label).toBe("Standard increment");
    expect(gradeFor(60, bands)?.label).toBe("Increment deferred");
    expect(gradeFor(10, bands)?.label).toBe("No increment; performance review");
  });

  it("returns null when no band matches", () => {
    expect(gradeFor(5, [{ min: 50, label: "x" }])).toBeNull();
  });
});
