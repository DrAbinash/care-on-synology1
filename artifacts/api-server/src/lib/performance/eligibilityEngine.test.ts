import { describe, it, expect } from "vitest";
import {
  evaluateAllowance, evaluateAward, DEFAULT_TRAVEL_RULE, DEFAULT_FOOD_RULE, type StaffMetrics,
} from "./eligibilityEngine";

describe("evaluateAllowance — travel", () => {
  it("is eligible when all thresholds are met", () => {
    const m: StaffMetrics = {
      threeMonthAvg: 88, attendancePct: 97, majorMisconduct: false, repeatedMobileMisuse: false,
      documentedExtraContribution: true, satisfactoryTeamwork: true, satisfactoryPatientBehaviour: true,
    };
    expect(evaluateAllowance(m, DEFAULT_TRAVEL_RULE).status).toBe("eligible");
  });

  it("is not_eligible when the score is below the minimum", () => {
    const m: StaffMetrics = {
      threeMonthAvg: 80, attendancePct: 97, majorMisconduct: false, repeatedMobileMisuse: false,
      documentedExtraContribution: true, satisfactoryTeamwork: true, satisfactoryPatientBehaviour: true,
    };
    const r = evaluateAllowance(m, DEFAULT_TRAVEL_RULE);
    expect(r.status).toBe("not_eligible");
    expect(r.reasons.find((x) => x.rule === "min_score")!.ok).toBe(false);
  });

  it("is disqualified on major misconduct regardless of score", () => {
    const m: StaffMetrics = { threeMonthAvg: 99, attendancePct: 100, majorMisconduct: true };
    expect(evaluateAllowance(m, DEFAULT_TRAVEL_RULE).status).toBe("disqualified");
  });

  it("is provisionally_eligible when a required metric is missing", () => {
    const m: StaffMetrics = {
      threeMonthAvg: 90, attendancePct: 97, majorMisconduct: false, repeatedMobileMisuse: false,
      documentedExtraContribution: true, satisfactoryTeamwork: true, /* patient behaviour missing */
    };
    expect(evaluateAllowance(m, DEFAULT_TRAVEL_RULE).status).toBe("provisionally_eligible");
  });
});

describe("evaluateAllowance — food", () => {
  it("uses the monthly score and shift criteria", () => {
    const ok: StaffMetrics = { monthlyScore: 82, majorMisconduct: false, seriousComplaint: false, satisfactoryDiscipline: true, requiredShiftCriteriaMet: true };
    expect(evaluateAllowance(ok, DEFAULT_FOOD_RULE).status).toBe("eligible");
    const bad = { ...ok, requiredShiftCriteriaMet: false };
    expect(evaluateAllowance(bad, DEFAULT_FOOD_RULE).status).toBe("not_eligible");
  });
});

describe("evaluateAward (shortlisting)", () => {
  it("shortlists a high performer with clean record", () => {
    const r = evaluateAward({ monthlyScore: 90, attendancePct: 98, majorMisconduct: false, unauthorizedAbsence: false }, { minScore: 85, minAttendancePct: 95, requireNoMajorMisconduct: true, requireNoUnauthorizedAbsence: true });
    expect(r.status).toBe("eligible");
  });
  it("disqualifies on unauthorized absence", () => {
    const r = evaluateAward({ monthlyScore: 95, unauthorizedAbsence: true }, { requireNoUnauthorizedAbsence: true, minScore: 85 });
    expect(r.status).toBe("disqualified");
  });
});
