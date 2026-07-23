/**
 * Allowance & award eligibility engine — pure, deterministic, explainable.
 * ============================================================================
 * Given a staff member's metrics + a configurable rule, returns a status and an
 * itemised reason list. ADVISORY ONLY: nothing here grants money — allowances
 * and awards are always human-approved (owner decision), and allowance statuses
 * are earned/temporary, never permanent salary. No DB, no I/O.
 *
 * Status semantics:
 *   disqualified            — a hard disqualifier is present (e.g. major misconduct)
 *   provisionally_eligible  — no failure, but a required metric is missing (needs data)
 *   eligible                — every requirement satisfied
 *   not_eligible            — a requirement failed
 */

export interface StaffMetrics {
  monthlyScore?: number;
  quarterlyScore?: number;
  threeMonthAvg?: number;
  annualAvg?: number;
  attendancePct?: number; // 0–100
  majorMisconduct?: boolean;
  repeatedMobileMisuse?: boolean;
  seriousComplaint?: boolean;
  unauthorizedAbsence?: boolean;
  documentedExtraContribution?: boolean;
  satisfactoryTeamwork?: boolean;
  satisfactoryPatientBehaviour?: boolean;
  satisfactoryDiscipline?: boolean;
  requiredShiftCriteriaMet?: boolean;
}

export type ScoreField = "monthlyScore" | "quarterlyScore" | "threeMonthAvg" | "annualAvg";

export interface AllowanceRule {
  kind: "travel" | "food";
  scoreField?: ScoreField;
  minScore?: number;
  minAttendancePct?: number;
  requireNoMajorMisconduct?: boolean;
  requireNoRepeatedMobileMisuse?: boolean;
  requireNoSeriousComplaint?: boolean;
  requireExtraContribution?: boolean;
  requireSatisfactoryTeamwork?: boolean;
  requireSatisfactoryPatientBehaviour?: boolean;
  requireSatisfactoryDiscipline?: boolean;
  requireShiftCriteria?: boolean;
}

export type AllowanceStatus = "eligible" | "provisionally_eligible" | "not_eligible" | "disqualified";
export interface Reason { rule: string; ok: boolean | null; detail?: string }
export interface EligibilityResult { status: AllowanceStatus; reasons: Reason[] }

function checkBool(reasons: Reason[], rule: string, required: boolean | undefined, value: boolean | undefined, wantTrue: boolean): void {
  if (!required) return;
  if (value === undefined) { reasons.push({ rule, ok: null, detail: "missing" }); return; }
  reasons.push({ rule, ok: wantTrue ? value === true : value === false });
}

export function evaluateAllowance(metrics: StaffMetrics, rule: AllowanceRule): EligibilityResult {
  const reasons: Reason[] = [];

  // Hard disqualifiers.
  const disq: Reason[] = [];
  if (rule.requireNoMajorMisconduct && metrics.majorMisconduct === true) disq.push({ rule: "no_major_misconduct", ok: false });
  if (rule.requireNoSeriousComplaint && metrics.seriousComplaint === true) disq.push({ rule: "no_serious_complaint", ok: false });
  if (rule.requireNoRepeatedMobileMisuse && metrics.repeatedMobileMisuse === true) disq.push({ rule: "no_repeated_mobile_misuse", ok: false });
  if (disq.length > 0) return { status: "disqualified", reasons: disq };

  // Score threshold.
  const field: ScoreField = rule.scoreField ?? (rule.kind === "travel" ? "threeMonthAvg" : "monthlyScore");
  const score = metrics[field];
  if (rule.minScore != null) {
    if (score === undefined) reasons.push({ rule: "min_score", ok: null, detail: `${field} missing` });
    else reasons.push({ rule: "min_score", ok: score >= rule.minScore, detail: `${score} >= ${rule.minScore}` });
  }
  // Attendance threshold.
  if (rule.minAttendancePct != null) {
    if (metrics.attendancePct === undefined) reasons.push({ rule: "min_attendance", ok: null, detail: "attendancePct missing" });
    else reasons.push({ rule: "min_attendance", ok: metrics.attendancePct >= rule.minAttendancePct, detail: `${metrics.attendancePct}% >= ${rule.minAttendancePct}%` });
  }

  checkBool(reasons, "extra_contribution", rule.requireExtraContribution, metrics.documentedExtraContribution, true);
  checkBool(reasons, "satisfactory_teamwork", rule.requireSatisfactoryTeamwork, metrics.satisfactoryTeamwork, true);
  checkBool(reasons, "satisfactory_patient_behaviour", rule.requireSatisfactoryPatientBehaviour, metrics.satisfactoryPatientBehaviour, true);
  checkBool(reasons, "satisfactory_discipline", rule.requireSatisfactoryDiscipline, metrics.satisfactoryDiscipline, true);
  checkBool(reasons, "shift_criteria", rule.requireShiftCriteria, metrics.requiredShiftCriteriaMet, true);
  // Soft disqualifier: mobile misuse when not hard-required is still recorded.
  checkBool(reasons, "no_repeated_mobile_misuse", rule.requireNoRepeatedMobileMisuse, metrics.repeatedMobileMisuse, false);

  const anyFail = reasons.some((r) => r.ok === false);
  const anyMissing = reasons.some((r) => r.ok === null);
  const status: AllowanceStatus = anyFail ? "not_eligible" : anyMissing ? "provisionally_eligible" : "eligible";
  return { status, reasons };
}

export interface AwardCriteria {
  scoreField?: ScoreField;
  minScore?: number;
  minAttendancePct?: number;
  requireNoMajorMisconduct?: boolean;
  requireNoUnauthorizedAbsence?: boolean;
  requireNoSeriousComplaint?: boolean;
}

/** Award eligibility (used to SHORTLIST — never to auto-declare a winner). */
export function evaluateAward(metrics: StaffMetrics, criteria: AwardCriteria): EligibilityResult {
  const reasons: Reason[] = [];
  const disq: Reason[] = [];
  if (criteria.requireNoMajorMisconduct && metrics.majorMisconduct === true) disq.push({ rule: "no_major_misconduct", ok: false });
  if (criteria.requireNoUnauthorizedAbsence && metrics.unauthorizedAbsence === true) disq.push({ rule: "no_unauthorized_absence", ok: false });
  if (criteria.requireNoSeriousComplaint && metrics.seriousComplaint === true) disq.push({ rule: "no_serious_complaint", ok: false });
  if (disq.length > 0) return { status: "disqualified", reasons: disq };

  const field = criteria.scoreField ?? "monthlyScore";
  const score = metrics[field];
  if (criteria.minScore != null) {
    if (score === undefined) reasons.push({ rule: "min_score", ok: null });
    else reasons.push({ rule: "min_score", ok: score >= criteria.minScore, detail: `${score} >= ${criteria.minScore}` });
  }
  if (criteria.minAttendancePct != null) {
    if (metrics.attendancePct === undefined) reasons.push({ rule: "min_attendance", ok: null });
    else reasons.push({ rule: "min_attendance", ok: metrics.attendancePct >= criteria.minAttendancePct });
  }
  const anyFail = reasons.some((r) => r.ok === false);
  const anyMissing = reasons.some((r) => r.ok === null);
  return { status: anyFail ? "not_eligible" : anyMissing ? "provisionally_eligible" : "eligible", reasons };
}

// Default, editable rules (owner-approved thresholds live in DB config later).
export const DEFAULT_TRAVEL_RULE: AllowanceRule = {
  kind: "travel", scoreField: "threeMonthAvg", minScore: 85, minAttendancePct: 95,
  requireNoMajorMisconduct: true, requireNoRepeatedMobileMisuse: true, requireExtraContribution: true,
  requireSatisfactoryTeamwork: true, requireSatisfactoryPatientBehaviour: true,
};
export const DEFAULT_FOOD_RULE: AllowanceRule = {
  kind: "food", scoreField: "monthlyScore", minScore: 80,
  requireNoMajorMisconduct: true, requireNoSeriousComplaint: true, requireSatisfactoryDiscipline: true,
  requireShiftCriteria: true,
};
