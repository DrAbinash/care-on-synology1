import { describe, it, expect } from "vitest";
import { categoriesToPolicy, eventRowsToScoreEvents, APPLIED_STATUSES } from "./performanceMapping";
import { computeScore } from "./scoreEngine";
import type { PerformanceCategory, PerformanceEvent } from "@workspace/db/schema";

function cat(p: Partial<PerformanceCategory>): PerformanceCategory {
  return {
    id: 0, key: "", label: "", maxMarks: 0, strategy: "deduction", baseline: null, sortOrder: 0,
    isActive: true, effectiveFrom: null, effectiveUntil: null, createdAt: new Date(), updatedAt: new Date(),
    ...p,
  } as PerformanceCategory;
}
function ev(p: Partial<PerformanceEvent>): PerformanceEvent {
  return {
    id: 0, cycleId: 1, staffId: 1, ruleId: null, categoryKey: "", points: 0, disqualifying: false,
    eventDate: "2026-07-05", description: null, notes: null, evidenceStorageKey: null, status: "submitted",
    submittedByUserId: null, submittedByName: null, verifiedByUserId: null, verifiedAt: null,
    employeeResponse: null, appealStatus: null, finalDecision: null, createdAt: new Date(), updatedAt: new Date(),
    ...p,
  } as PerformanceEvent;
}

const CATS: PerformanceCategory[] = [
  cat({ key: "attendance", label: "Attendance", maxMarks: 20, strategy: "deduction", sortOrder: 10 }),
  cat({ key: "discipline", label: "Discipline", maxMarks: 20, strategy: "deduction", sortOrder: 20 }),
  cat({ key: "quality", label: "Quality", maxMarks: 20, strategy: "deduction", sortOrder: 30 }),
  cat({ key: "patient_service", label: "Patient", maxMarks: 15, strategy: "earned", sortOrder: 40 }),
  cat({ key: "teamwork", label: "Teamwork", maxMarks: 15, strategy: "deduction", sortOrder: 50 }),
  cat({ key: "initiative", label: "Initiative", maxMarks: 10, strategy: "earned", sortOrder: 60 }),
];

describe("categoriesToPolicy", () => {
  it("maps active categories to a valid policy summing to their total", () => {
    const policy = categoriesToPolicy(CATS);
    expect(policy.expectedTotal).toBe(100);
    expect(policy.categories.map((c) => c.key)).toEqual(["attendance", "discipline", "quality", "patient_service", "teamwork", "initiative"]);
    expect(policy.categories.find((c) => c.key === "patient_service")!.strategy).toBe("earned");
  });

  it("drops inactive categories and sorts by sortOrder", () => {
    const policy = categoriesToPolicy([
      cat({ key: "b", label: "B", maxMarks: 60, sortOrder: 20 }),
      cat({ key: "a", label: "A", maxMarks: 40, sortOrder: 10 }),
      cat({ key: "z", label: "Z", maxMarks: 99, sortOrder: 5, isActive: false }),
    ]);
    expect(policy.categories.map((c) => c.key)).toEqual(["a", "b"]);
    expect(policy.expectedTotal).toBe(100);
  });
});

describe("eventRowsToScoreEvents", () => {
  it("marks only applied statuses as approved", () => {
    expect(APPLIED_STATUSES.has("approved")).toBe(true);
    expect(APPLIED_STATUSES.has("score_applied")).toBe(true);
    const evs = eventRowsToScoreEvents([
      ev({ id: 1, categoryKey: "attendance", points: -1, status: "approved" }),
      ev({ id: 2, categoryKey: "discipline", points: -5, status: "submitted" }),
    ]);
    expect(evs.find((e) => e.id === 1)!.approved).toBe(true);
    expect(evs.find((e) => e.id === 2)!.approved).toBe(false);
  });
});

describe("end-to-end: DB rows → policy + events → engine", () => {
  it("computes the worked example only from approved events", () => {
    const events: PerformanceEvent[] = [
      ev({ id: 1, categoryKey: "attendance", points: -1, status: "approved" }),
      ev({ id: 2, categoryKey: "patient_service", points: 1, status: "approved" }),
      ev({ id: 3, categoryKey: "discipline", points: -2, status: "approved" }),
      ev({ id: 4, categoryKey: "initiative", points: 2, status: "approved" }),
      ev({ id: 5, categoryKey: "discipline", points: -10, status: "submitted" }), // NOT approved → ignored
    ];
    const result = computeScore(categoriesToPolicy(CATS), eventRowsToScoreEvents(events));
    // 19(att) + 18(disc) + 20(qual) + 1(patient) + 15(team) + 2(init) = 75
    expect(result.total).toBe(75);
    expect(result.unapplied).toHaveLength(1); // the submitted -10
  });
});
