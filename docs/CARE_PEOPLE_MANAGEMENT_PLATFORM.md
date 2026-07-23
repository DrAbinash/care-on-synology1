# CARE People Management Platform — Architecture Vision

**Status:** Approved design direction (owner review, 2026-07-23) · Companion to
`CARE_STAFF_HR_AUDIT.md` / `CARE_STAFF_HR_ARCHITECTURE.md` / `ADR-003`.

> The Staff module is not "HR forms". It is the **People Management platform** of CARE ERP —
> the single source of truth for every employee, that future modules plug into. This document
> records the long-term architecture so Phase 1 lays foundations that never need to be undone.
> Nothing here activates payroll, attendance automation, or fingerprint hardware; those stay
> behind feature flags + Shadow Mode.

---

## 1. One employee, one identity, one profile

- **Strict 1:1 `staff` ↔ `users`** (owner decision). Enforced additively via `staff_user_links`
  (`UNIQUE(staff_id)`, `UNIQUE(user_id)`) — no parallel employee concept is ever created, and the
  protected `staff.ts`/`users.ts` files are not modified. The employee profile is **the** source of
  truth; every module references `staff.id`.
- Future modules **plug into the same profile**, never fork it: Performance · Attendance · Leave ·
  Shift · Payroll (advisory) · Incentives · Training · SOP Compliance · Skills · Certifications ·
  Appraisals · Promotions · Exit · Internal Messaging · Document Vault.

## 2. The 360° employee profile (single screen)

A CRM-style profile (not an admin form) that answers, on one screen: who is this employee · how long
here · strengths · skills · training completed · attendance · performance trend · awards · warnings ·
promotion-ready? · allowance-eligible? · full organizational timeline.

**Sections (tabs):** Overview · Employment · Attendance · Performance · Recognition · Documents ·
Payroll · Training · Warnings · **Activity Timeline** · Audit History. Each tab is role-gated and
feature-flagged; a tab renders only when its module is enabled and the viewer is permitted.

**Foundation shipped now (data layer):** `staff_user_links`, `designations`, `staff_status_history`,
`staff_reporting_lines`, `staff_documents`, `skills` + `staff_skills`, `staff_timeline_events`.

## 3. Activity timeline (auto-generated)

`staff_timeline_events` is the append-only lifecycle log. **Any** module writes a row via
`(source_module, ref_type, ref_id)`: Joined → Probation Completed → Attendance Correction → Warning →
Appreciation → Award → Allowance Approved → Training Completed → Promotion → Increment → Performance
Review → Resignation → Exit. `visibility` (`internal` | `employee_visible`) governs self-service
exposure. This single stream is what makes annual appraisal and the 360° view trivial to assemble.

## 4. Skill matrix

`skills` (master) + `staff_skills` (per-employee, `level` = beginner | intermediate | advanced |
trainer, `certified`). Seed catalogue: Reception, MRI, CT, USG, Billing, Sample Collection,
Phlebotomy, Emergency, ICU, Nursing, Accounts, HR, IT, Administration, Cleaning, Driver, Housekeeping,
Marketing. Powers future staffing, internal promotions, and "who can cover X" queries.

## 5. Training (future-ready — schema-compatible, not built now)

Design so the profile can later carry: training assigned/completed, certificates, expiry reminders,
mandatory SOP completion, video training, competency validation. Timeline events (`training_completed`)
and `staff_documents` (`doc_type` = certificate) already accommodate the artefacts; dedicated
`training_*` tables land in a later phase. No UI now.

## 6. Recognition — configurable badges (Phase 4)

Beyond Employee of the Week/Month/Year, support configurable badges: Patient Champion · Best Team
Player · Innovation Award · Zero Complaint Award · Perfect Attendance · Emergency Hero · Best Mentor ·
Fast Learner · Service Excellence. Modelled as a configurable `award_types`/badge master (data, not
code) so management defines and awards them; each award writes a timeline event. Advisory only.

## 7. Performance trends (dashboard)

The performance dashboard shows more than a current score: monthly/quarterly/annual trend, radar chart
across categories, department comparison (authorized roles only), strengths, improvement areas. Built
on the pure, versioned score engine (`scoreEngine.ts`) + finalized-cycle snapshots. No public
leaderboards; comparisons are management-only.

## 8. Attendance source abstraction

Every attendance source is abstracted behind one interface and produces the **same** canonical event
(`artifacts/api-server/src/lib/attendance/attendanceSource.ts`, shipped inert). Sources: Manual · USB
Bridge · WebAuthn · Fingerprint Device · CSV · API · Face Recognition · RFID · Mobile GPS (+ admin
correction, system generated). Adding hardware = adding a **provider**; the dormant USB bridge becomes
`UsbBridgeProvider` and is **not rewritten**. Ingestion/persistence is Phase 2.

## 9. Enterprise-grade attendance (design; Phase 2 tables)

Introduce `attendance_raw_punches` (immutable), `attendance_daily_summaries`, `attendance_corrections`
(audited workflow), `attendance_import_runs` (idempotent ledger), `employee_biometric_mappings` /
`attendance_devices`. Design correctly for: multiple/split/night shifts, cross-midnight duty, grace
periods, holiday calendars, overtime, compensatory off, and **future** payroll integration. **Payroll
stays inactive** — attendance never auto-computes salary without Change Control + owner sign-off.

## 10. Secure HR document vault

`staff_documents` (shipped) evolves into a permission-controlled vault. `doc_type` covers: Identity ·
Qualification · Registration · Joining · Contracts · Appraisal · Warnings · Experience · NOC ·
Promotion/Increment Letters · Certificates · Medical Fitness · Police Verification. `confidential`
defaults TRUE; bytes live in object storage (`storage_key`); access is role-gated.

## 11. Leave module (future — schema-compatible)

Not in this PR, but the model must accommodate leave types: Casual · Sick · Earned · Maternity ·
Paternity · Comp Off · Half Day · Short Leave · Leave Without Pay · Training · Duty. Leave integrates
with attendance (approved/medical leave never incurs an attendance penalty) and writes timeline events.

## 12. Department dashboard (future)

Each department head later sees: attendance % · average performance · pending reviews · training status ·
recognition · improvement plans · warnings · staff strength · vacancies. Derivable from
`staff_reporting_lines` + `departments` + the per-module tables; no schema blocker introduced.

## 13. Employee self-service portal (future)

The employee dashboard becomes self-service: attendance · leave · performance · awards · training ·
salary slip · documents · requests · appeals · personal details · notifications. Enabled by the 1:1
identity link + `visibility='employee_visible'` filtering. Every self-scoped GET must be added to
`sw.js` `NETWORK_ONLY_PREFIXES` (CI-enforced).

## 14. Reports (architected for export)

Report surfaces to design toward (no build now): Department Performance · Attendance Register · Award
History · Increment History · Training Status · Employee Lifecycle · HR Dashboard · Attrition · Joining
Trend · Performance Trend. Reuse `lib/csv.ts` + client jsPDF; server stays authoritative.

## 15. AI readiness (no AI now — no blockers)

Keep every HR entity analyzable so CARE's AI layer can later surface: employees needing training ·
burnout risk · high performers · promotion candidates · attendance anomalies · department workload ·
recognition suggestions. Achieved by normalized, well-typed, timeline-fed tables — not by embedding AI
now.

## 16. Organizational chart

Auto-generated from `staff_reporting_lines` (supervisor) + `departments` + `designations` + `staff`.
No new table — it is a derived view/query rendered later. `staff_reporting_lines` (shipped) already
carries the effective-dated hierarchy the chart needs.

## 17. Guardrails (unchanged, reaffirmed by owner)

Advisory-only performance (no auto payroll/deduction/increment) · extend the existing RBAC (no parallel
framework) · provider-abstracted hardware (no vendor code until hardware finalized) · fully configurable
scoring (no hard-coded policy) · additive/idempotent migrations · Shadow Mode + feature flags · never
delete historical HR data.
