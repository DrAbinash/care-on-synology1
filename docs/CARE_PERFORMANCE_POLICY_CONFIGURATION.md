# CARE Performance Policy — Configuration Guide

**Status:** Framework defined; engine shipped (pure); policy tables land in Phase 3 · **Date:** 2026-07-23

Policy is **data, not code**: authorized management configures categories, rules, bands and
eligibility. Nothing here is hard-coded in the frontend, and the official score is computed
server-side by the pure engine `artifacts/api-server/src/lib/performance/scoreEngine.ts`
(unit-tested; see `scoreEngine.test.ts`). Values below are **defaults to seed**, reviewable before
any cycle is finalized. No penalty matrix is activated until configured and management-reviewed.

---

## 1. The 100-point framework (default categories)

| Category | Key | Max | Default strategy |
|---|---|---:|---|
| Attendance and Punctuality | `attendance` | 20 | deduction |
| Professional Behaviour and Discipline | `discipline` | 20 | deduction |
| Quality and Accuracy of Work | `quality` | 20 | deduction |
| Patient Service and Feedback | `patient_service` | 15 | earned |
| Teamwork and Communication | `teamwork` | 15 | deduction |
| Initiative and Responsibility | `initiative` | 10 | earned |
| **Total** | | **100** | |

Matches `DEFAULT_CARE_POLICY` in `scoreEngine.ts`. Categories, maxima and strategy are all editable
(stored in `performance_categories` once that table lands). `validatePolicy()` enforces that maxima
sum to the expected total (default 100).

---

## 2. Scoring model (how a score is derived — never typed in)

Management may **not** type an unexplained final score. Every score is derived from:
category baselines → verified positive events → verified deductions → approved adjustments →
automatic attendance-derived deductions → category caps → disqualifying events. Every score is
**fully itemised and reproducible**.

- **Deduction categories** start at their maximum; verified violations subtract.
- **Earned categories** start at a baseline (default 0); positive contributions add. So 100/100 is
  **not** automatic for merely completing routine duty.
- **Caps:** each category is clamped to `[0, max]`, so positive entries can never exceed the maximum
  and deductions can never drive a category below zero.
- **Disqualifying events** flag the result for awards/allowances **without** zeroing the number.

**Worked example (from the master prompt) →** see `scoreEngine.test.ts` "applies the worked example":
Late −1 (attendance), Patient appreciation +1 (patient_service), Mobile misuse −2 (discipline),
Emergency duty +2 (initiative).

---

## 3. Configurable rule fields

A rule (future `performance_rules`, effective-dated, snapshotted per finalized cycle) may define:
rule name · rule code · category · positive/negative · point value · min/max point · frequency cap ·
evidence required · employee-response required · approval level · automatic/manual · active period ·
department applicability · designation applicability · repeat-offence multiplier · award disqualification ·
allowance disqualification · major-misconduct flag · effective-from · effective-until.

**Default event points (seed — review before activation):**

| Event | Category | Default |
|---|---|---:|
| Late by 6–15 minutes | attendance | −1 |
| Late by 16–30 minutes | attendance | −2 |
| Unauthorized absence | attendance | −5 |
| Mobile misuse (verified) | discipline | −2 |
| Patient appreciation (verified) | patient_service | +1 |
| Emergency extra duty | initiative | +2 |
| Serious misconduct | discipline | **disqualifying** |

The rules engine resolves each rule to a concrete **signed** `ScoreEvent { category, points, disqualifying }`
that the pure engine then applies. Approved leave / medically-authorized absence must **not** produce an
attendance penalty.

---

## 4. Event workflow

```
Draft → Submitted → Employee Notified → Employee Response → Manager Review
      → Approved / Rejected / Returned → Score Applied → Appeal → Final Decision
```
Purely-positive entries may use a simplified flow where policy permits. **Unverified complaints never reduce
a score** (`approved:false` events are not applied by the engine). Duplicate penalties for the same incident
are prevented at the event layer. Every mutation writes an `audit_logs` row (actor, action, target, old/new,
reason, approval chain).

---

## 5. Grade bands → increment recommendation (advisory only)

| Annual score | Recommendation |
|---|---|
| 90–100 | Exceptional increment or promotion review |
| 85–89 | Higher increment |
| 75–84 | Standard increment |
| 65–74 | Limited increment |
| 55–64 | Increment deferred |
| Below 55 | No increment; performance review |

Implemented by `gradeFor(total, bands)` in the engine. **Recommendation only** — the system never alters
payroll. Final decisions also weigh role, qualification, responsibility, current salary, market parity,
department needs, budget and promotion readiness.

---

## 6. Recognition eligibility (configurable; management approves)

- **Employee of the Week** — min weekly score, no unauthorized absence, no major misconduct, no serious
  complaint, no disqualifying mobile misuse, sufficient attendance. **"No eligible winner this week" is allowed.**
- **Employee of the Month** — monthly score ≥ 85, no major disciplinary issue, verified positive contribution,
  attendance threshold, management approval. System **shortlists**, never auto-declares.
- **Employee of the Year** — annual average + attendance + discipline + patient service + quality + teamwork +
  leadership + initiative + award history; major-misconduct disqualification; management reviews evidence.

## 7. Allowance eligibility (earned, performance-linked — not a permanent entitlement)

- **Travel Allowance** (default): last-3-month avg ≥ 85, attendance ≥ 95%, no major misconduct, no repeated
  mobile misuse, satisfactory patient behaviour + teamwork, ≥ 1 documented extra contribution.
- **Food Allowance** (default): monthly/quarterly score ≥ 80, satisfactory attendance/discipline, no major
  complaint, required shift/duty criteria met.
- **Statuses:** Eligible · Provisionally Eligible · Not Eligible · On Hold · Disqualified for Current Cycle ·
  Approved · Rejected · Expired. Eligibility is computed server-side; **final approval is human**, and in shadow
  mode nothing is granted automatically. These are **not** automatic permanent salary components (Financial Freeze).

## 8. Performance Improvement Plan (PIP)

Fields: reason · target categories · required actions · training assigned · supervisor · start date ·
review dates · completion date · outcome · employee comments · management decision.
States: `Draft → Active → Review Due → Improved / Extended / Failed → Closed`. No public shaming; PIP data is
confidential to the employee, their supervisor, and HR/management.

---

## 9. Shadow mode & integrity

Until reviewed, `ff_hr_performance_scoring` and related flags are **disabled**. When enabled in shadow mode:
scores compute and are reviewable, but **no** award, allowance, increment, or discipline is triggered by
software alone, and **no** payroll amount changes. Finalized cycles are **locked** and store the exact
**rule-set version** used, so historical scores never change when rules later change (reopening is an explicit,
audited procedure).
