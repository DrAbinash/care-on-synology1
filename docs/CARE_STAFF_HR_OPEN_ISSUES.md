# CARE Staff/HR Module — Open Issues, Decisions & Known Limitations

**Date:** 2026-07-23

Decisions that genuinely need management/owner input before certain phases proceed, plus known
limitations of the current codebase. Nothing here is blocking Phase 0/1 (docs + inert foundation).

---

## A. Decisions requiring management input

### 1. Identity link: `users` (login) ↔ `staff` (HR master) — **needs a decision**
Today they are separate with no FK. Employee self-service ("my score/attendance") and correct actor
attribution need a link. **Recommendation:** add a nullable, additive `users.staff_id → staff.id` (or a
`staff_user_links` table), reversible, gated by `ff_hr_employee_self_service`. *Decision needed:* approve the
link approach and the mapping rule (who maps a user to a staff record, and whether every user must map).

### 2. Permission model — new modules & the off-repo matrix
The real role→permission grants live in an **off-repo USB plugin**; the in-repo `role-permissions.ts` is a
stub. We propose new modules (`staff`, `hr`, `attendance`, `performance`, `recognition`, `allowances`,
`appraisals`). *Decision needed:* who updates the off-repo matrix, and the intended grants per role
(especially: which role = "Supervisor", "HR/Manager", "Director"? Current `ERP_ROLES` has `manager` but no
`hr`/`supervisor`/`director`). Segregation of duties (submitter ≠ approver) will be enforced server-side.

### 3. Financial boundary — payroll, allowances, increments
The master audit *wishes* payroll were derived from attendance, but `staff_salary_payments` is under the
Financial Freeze. **Recommendation:** keep performance/allowance/increment outputs **advisory** (human
approval; never auto-payroll). *Decision needed:* if/when attendance→payroll or allowance→payroll is ever
wired, it must go through `FINANCIAL_CHANGE_CONTROL.md` + owner sign-off. Confirm this stays out of scope for
now.

### 4. Fingerprint hardware
USB attendance is dormant pending a device. *Decision needed:* target vendor (Mantra MFS100 is closest to
working — only its matcher is missing), number of workstations, and whether biometric login (not just
attendance) is wanted. No vendor-specific integration will be invented without real hardware details.

### 5. Data-privacy / policy sign-off
Performance events touch employee reputation. *Decision needed:* approve the default rule points and
disqualifier list (`CARE_PERFORMANCE_POLICY_CONFIGURATION.md`), confidentiality of complainant identity, and
that approved/medical leave never incurs an attendance penalty.

---

## B. Known limitations (current codebase)

| # | Limitation | Impact | Planned phase |
|---|---|---|---|
| B1 | No audit logging on staff/HR/attendance/bridge routes | Legal defensibility | wire `auditFromRequest` as routes are added |
| B2 | Payroll ≠ attendance (manual `days_present/absent`) | Error-prone | stays manual until Change Control |
| B3 | No shift/roster/leave model | Attendance can't be judged late/absent/overnight | Phase 2 |
| B4 | No raw-punch/correction/import-run tables | No idempotent import or audited corrections | Phase 2 |
| B5 | USB bridge adapters incomplete (mock only; mantra no matcher; zkteco/morpho stubs) | No real device yet | when hardware arrives |
| B6 | `desktop/bridge/` broken duplicate (missing `src/adapters/`) | Dead/crashing copy | reconcile/delete |
| B7 | `useBridge.ts` client hook imported by zero pages | USB path unreachable from UI | Phase 2 |
| B8 | `/staff` frontend not permission-gated (visibility only; API enforces) | UX (403 after click) | add to `PERMISSIONED_PATHS` when modules land |
| B9 | Existing `staff_*` child tables use `ON DELETE CASCADE` | HR history could be lost on staff delete | new tables use RESTRICT; consider migrating old ones (change-controlled) |
| B10 | No in-app notification system | "review due"/"appeal" alerts | Phase 4 (build) |
| B11 | Staff module uses raw `<table>` + `fetchApi` (not `ui/table.tsx`/generated client) | Inconsistency | cosmetic, opportunistic |
| B12 | Object-storage volume not replicated/backed up (per archive readiness doc) | HR document durability | ops decision |

---

## C. Risks & mitigations

- **Migration hard-stop:** one bad `migrations/*.sql` stops the whole deploy. *Mitigated:* additive/idempotent
  only + `check-migration-order.cjs` in CI.
- **PHI cache leak:** self-scoped GETs must be in `sw.js` `NETWORK_ONLY_PREFIXES` (CI-enforced). *No such
  endpoint ships in this PR.*
- **Scope creep across the freeze line:** enforced by keeping recognition/allowance/increment advisory and
  routing any financial wiring through Change Control.
- **Off-repo permission drift:** design to the middleware contract; coordinate grants with the plugin owner.
