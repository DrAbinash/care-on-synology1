# CARE Staff/HR Module — Open Issues, Decisions & Known Limitations

**Date:** 2026-07-23

Known limitations of the current codebase, plus the previously-open decisions — **all five now
RESOLVED by the owner (2026-07-23)**. Nothing here blocks the additive, Shadow-Mode foundation.

---

## A. Decisions — RESOLVED by owner (2026-07-23)

### 1. Identity link: `users` ↔ `staff` — ✅ RESOLVED
**Decision:** strict **one-to-one** mapping; every staff member has at most one ERP identity; no
duplicate identity systems. **Implemented:** additive `staff_user_links` table with `UNIQUE(staff_id)`
and `UNIQUE(user_id)` (does not touch protected `staff.ts`/`users.ts`). Self-service reads gate on
`ff_hr_employee_self_service`.

### 2. Permissions — ✅ RESOLVED
**Decision:** **extend the existing** permission framework only; do **not** build a second RBAC.
**Approach:** new modules registered in the existing `role_permissions` matrix; segregation of duties
(submitter ≠ approver) enforced server-side via `req.staffSession.subjectId`. Actual grants applied via
the off-repo matrix owner.

### 3. Financial boundary — ✅ RESOLVED
**Decision (confirmed):** performance stays **advisory**. **No** automatic payroll, **no** automatic
deduction, **no** automatic increment — everything management-approved. Any future payroll linkage must
go through `FINANCIAL_CHANGE_CONTROL.md` + owner sign-off.

### 4. Fingerprint hardware — ✅ RESOLVED
**Decision:** do **not** implement vendor-specific code; keep the abstraction. When hardware is
finalized, **only a provider is added**. **Implemented:** `attendanceSource.ts` abstraction (inert); the
dormant USB bridge is documented as a future provider and is **not rewritten**.

### 5. Scoring rules — ✅ RESOLVED
**Decision:** implement exactly as **configurable**; **no hard-coded business policy** — everything
editable by management. The pure engine already computes from configurable categories/rules; policy
tables land in Phase 3 with per-cycle rule snapshots.

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
