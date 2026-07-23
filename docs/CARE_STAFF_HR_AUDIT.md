# CARE Staff, Attendance, Performance & Recognition — Repository Audit (Phase 0)

**Status:** Complete · **Date:** 2026-07-23 · **Scope:** audit only — no financial/destructive change.

This document is the mandatory pre-implementation audit for enhancing the existing
CARE ERP Staff module into a Staff, Attendance, Performance & Recognition system.
Every claim below is grounded in the actual repository. Companion documents:
`CARE_STAFF_HR_ARCHITECTURE.md`, `CARE_STAFF_HR_IMPLEMENTATION_PLAN.md`,
`FINGERPRINT_ATTENDANCE_INTEGRATION.md`, `CARE_PERFORMANCE_POLICY_CONFIGURATION.md`,
`CARE_STAFF_HR_ROLLOUT.md`, `CARE_STAFF_HR_OPEN_ISSUES.md`, `ADR/ADR-003-staff-hr-performance-module.md`.

> **Headline:** The Staff module is **not** "basic". It is a **partially-built HR system**
> with real payroll-adjacent primitives, plus a **near-complete but dormant USB
> fingerprint-attendance implementation** that is disabled by an unset secret. The work
> is *enhancement and completion*, not greenfield. Nothing dormant should be discarded.

---

## 1. Existing Staff module

### 1.1 Frontend (React 19 + Vite, router = `wouter`)

Base: `artifacts/diagnostic-erp/`

| Route | Component | File | Notes |
|---|---|---|---|
| `/staff` | `StaffPage` | `src/pages/Staff.tsx` (707 lines) | Tabs: **Employees**, **Attendance**, **Fingerprint Kiosk**. Detail dialog tabs: Profile / Advances / Salary / Fingerprint / HR Forms. |
| `/hr-forms` | `HRFormsPage` | `src/pages/HRForms.tsx` (1077 lines) | Bilingual (Hindi/English) re-joining/onboarding forms; also embedded as `StaffHRFormsPanel` inside the Staff detail dialog. |

- **Routing** is declared in `src/App.tsx` (`Router()` ~L301, `<Switch>` ~L320). Both staff routes sit inside the authenticated `<PermissionGuard>` + `<Layout>` zone.
- **Navigation:** `src/components/Layout.tsx` — both leaves live in the **"Administration"** group: `{ path: "/staff", label: "Staff Directory" }`, `{ path: "/hr-forms", label: "HR Forms" }`.
- **Design system:** shadcn/ui ("new-york"), 55 primitives in `src/components/ui/`. `Staff.tsx` renders its data tables as raw `<table>` rather than `ui/table.tsx` (a standardisation opportunity).
- **Data layer:** TanStack Query over the hand-written `src/lib/fetchApi.ts` (`api.get/post/...`, bearer auth, retry/backoff). Newer core pages instead use the generated `@workspace/api-client-react`; the Staff module has not migrated.
- **The "Fingerprint Kiosk" UI uses browser WebAuthn** (`navigator.credentials.create/get`) — **not** the USB scanner bridge. See §2.

### 1.2 Backend (Express, mounted under `/api`)

Base: `artifacts/api-server/` · Router registry: `src/routes/index.ts` · Auth: `src/middleware/requireStaffAuth.ts`

| Mount | Router file | Gate |
|---|---|---|
| `/api/staff` | `routes/staff.ts` | `requireStaffAuth` + `requireStaffSubPermission("/settings","users")` |
| `/api/hr-forms` | `routes/hr-forms.ts` | `requireStaffAuth` + `requireStaffSubPermission("/settings","users")` |
| `/api/departments` | `routes/departments.ts` | `requireStaffAuth` + `requireStaffSubPermission("/settings","infrastructure")` |
| `/api/bridge` | `routes/bridge.ts` | **no mount gate** — per-route bridge secret + challenge tokens |
| `/api/my/quick-doctors` | `routes/staffQuickDoctors.ts` | `requireStaffAuth` only (self-scoped) |
| `/api/auth/webauthn` | `routes/webauthn.ts` | user (login) FIDO2 — distinct from staff attendance |
| `/api/storage/*` | `routes/storage.ts` | presigned object-storage uploads (used by HR photo) |

Key `staff.ts` endpoints: staff CRUD (`POST` generates `EMP-####`; `DELETE` = soft-delete `is_active=false`), advances (`GET/POST/DELETE`), salary (`GET/POST/DELETE`, FIFO advance recovery), attendance (`/attendance/all`, `/:id/attendance`, `/:id/attendance/punch`, `/:id/attendance/summary`), WebAuthn biometric (`/:id/biometric/register/{begin,complete}`, `/biometric/punch/{begin,complete}`), `/dashboard/today`.

`hr-forms.ts`: list/create/get/patch, `POST /:id/approve` (row-locked; writes `fixedSalary` → `staff.base_salary`), `/:id/reject`, delete (blocked once approved).

### 1.3 Database tables (Drizzle — `lib/db/src/schema/`)

`staff.ts`: `staff`, `staff_counter`, `staff_advances`, `staff_salary_payments`, `staff_attendance`, `staff_biometric_credentials` (WebAuthn), `bridge_fingerprint_templates` (USB scanner), `user_sessions`, `hr_rejoining_forms`, `hr_rejoining_form_counter`.
`departments.ts`: `departments` (master). `users.ts`: `users`, `webauthn_credentials`. `staffQuickDoctors.ts`: `staff_quick_doctors`.

Originally created by **Drizzle** migrations `lib/db/drizzle/0000_dear_forge.sql` / `0001` / `0006`; `staff_quick_doctors` by hand-written `migrations/add_staff_quick_doctors.sql`.

### 1.4 Permissions

- **Backend enforcement is real:** all `/api/staff` + `/api/hr-forms` writes require the `/settings:users` sub-permission (admin/super_admin bypass via `FULL_ACCESS_ROLES`).
- **Frontend visibility gap:** `/staff` is **not** in `PERMISSIONED_PATHS` (`src/lib/staffSession.ts`), so the nav leaf and route are visible to every signed-in user — the API then returns 403. This is a **UX gap, not a data leak** (the server enforces). `/hr-forms` is aliased to `/settings`, so it is admin-gated at the nav layer.
- The `role_permissions` matrix has modules `dashboard…audit` (`rolePermissions.ts`, `PERMISSION_MODULES`) with **no dedicated `staff`/`hr`/`performance` module**. The real role→permission grants live in an **off-repo USB plugin** (`role-permissions.ts` in-repo is a stub) — see `CARE_ERP_MASTER_AUDIT.md` §13/21. Authorization design must target the middleware contract; actual grants are applied off-repo.

### 1.5 Current capabilities

Staff CRUD · departments master · advances · manual salary payments (FIFO advance recovery) · manual attendance punch + log · WebAuthn (platform-authenticator) attendance enrollment & kiosk punch · rich 12-section HR re-joining form with approval→salary write-back · per-staff billing "quick doctor" layout.

### 1.6 Missing features (not present anywhere)

Leave management · shift/duty roster (only free-text `shift_type`/`reporting_time`/`duty_hours` on the HR form) · designation master (only a free-text column) · reporting hierarchy · employment-status history · document repository (only a single HR-form photo) · **all performance/scoring/recognition/allowance/appraisal/PIP** · attendance-derived payroll · in-app notifications · any performance analytics.

### 1.7 Technical debt / unsafe or incomplete behaviour

| # | Item | File |
|---|---|---|
| D1 | **No audit logging** on any staff/HR/attendance/bridge route, though a tamper-evident `audit_logs` chain + `auditFromRequest()` helper exist. `CARE_ERP_MASTER_AUDIT.md` lists departments/backups/etc. audit gaps as a defect. | `routes/staff.ts`, `hr-forms.ts`, `bridge.ts` |
| D2 | **No zod validation** for staff/attendance/salary/advances/HR forms — hand-rolled `if` checks. Only `departments.ts` uses zod. | `routes/staff.ts` |
| D3 | **No service layer** — all HR business logic is inline in route handlers. | `routes/*.ts` |
| D4 | **Payroll ≠ attendance:** `days_present`/`days_absent` on `staff_salary_payments` are **manual** inputs, transcribed by hand. Two disconnected silos. | `staff.ts` schema |
| D5 | `staff` vs `users` are **two identity tables with no FK link** (see §4). Employee self-service needs a bridge. | schema |
| D6 | Existing `staff_*` child tables use `ON DELETE CASCADE`; the DB audit says HR/legal records should be `RESTRICT`/`SET NULL`. | `staff.ts` schema |
| D7 | `/staff` frontend not permission-gated (visibility gap, §1.4). | `staffSession.ts` |
| D8 | Broken duplicate bridge (`desktop/bridge/` missing `src/adapters/` → crashes on import); unused client hook `useBridge.ts`. | see §2 |

---

## 2. Existing attendance & biometric implementation

**Three distinct mechanisms coexist and are easily conflated.** Full detail in `FINGERPRINT_ATTENDANCE_INTEGRATION.md`.

| Q (from the master prompt) | Finding |
|---|---|
| Does attendance exist? | **Yes.** `staff_attendance` (`punch_in`/`punch_out`/**`source`**, unique `(staff_id, attendance_date)`). |
| Manual attendance? | **Yes.** `POST /api/staff/:id/attendance/punch` (source `"manual"`); UI in `Staff.tsx` Attendance tab. |
| Fingerprint / biometric code? | **Yes, two kinds:** (A) **WebAuthn** platform-authenticator (Windows Hello/Touch ID) — **live & wired**, source `"fingerprint"`, table `staff_biometric_credentials`; (B) **USB fingerprint scanner bridge** (ZKTeco/Mantra/Morpho) — **backend-complete but dormant**, source `"usb-bridge"`, table `bridge_fingerprint_templates`. |
| Which device/protocol/SDK? | USB path: local `bridge-service/` (Node, `127.0.0.1:8765`) talks to vendor SDK; server stores **templates + results only, never raw biometrics**. Adapter contract: `{ status(), capture(), match(a,b), threshold }`. |
| Production-ready / partial / dead / mocked? | Server routes (`routes/bridge.ts`) **production-ready but disabled** (503 when `FINGERPRINT_BRIDGE_SECRET` unset). Adapters: **mock** works (demo), **mantra** partial (capture real, `match()` throws), **zkteco/morpho** stubs. Frontend hook `useBridge.ts` exists but is **imported by zero pages** (dead on client). `desktop/bridge/` is a **broken duplicate**. |
| Employee → biometric-user mapping? | Templates keyed by `{scope: "staff"|"user", scopeId}` in `bridge_fingerprint_templates`; match returns a `templateId` the server resolves to a staff/user row. **Not** name-based. |
| Punch storage? | Raw `punch_in`/`punch_out` timestamps on `staff_attendance`; **no separate raw-punch table** (a summary-only model today). |
| Duplicate punches? | Partially — unique `(staff_id, attendance_date)` + a smart in/out toggle in `recordPunch()`; no multi-punch history. |
| Time zones? | Container runs `TZ=Asia/Kolkata`; dates via `todayIST` (`lib/istDate.ts`). Timestamps are `timestamptz`. |
| Missed-punch correction? | Only via generic `PATCH`/`DELETE` on attendance rows — **no dedicated correction workflow or audit**. |
| Shifts / overnight duty? | **Not supported** — no shift model; overnight/cross-midnight not handled. Only free-text HR-form fields. |
| Imported records audit trail? | **No.** Bridge writes carry `source` but **no `audit_logs` entry** and no import-run ledger. |
| Works without a live device? | **Yes** — manual punch + WebAuthn work with no USB device; the mock adapter simulates the USB path. |

---

## 3. Integration map

| Existing component | Location | Current status | Reuse / modify / replace |
|---|---|---|---|
| Staff master | `schema/staff.ts` `staffTable`, `routes/staff.ts` | Working (basic) | **Reuse** (extend additively; do not duplicate) |
| Departments master | `schema/departments.ts`, `routes/departments.ts` | Working | **Reuse**; add `designations` master + optional FK later |
| Attendance | `staff_attendance`, `routes/staff.ts` | Working (summary-only) | **Reuse + extend** (raw punches, corrections, summaries) |
| WebAuthn attendance | `staff_biometric_credentials`, `routes/staff.ts` | Live | **Reuse** as attendance source `"fingerprint"` |
| USB fingerprint bridge | `bridge_fingerprint_templates`, `routes/bridge.ts`, `bridge-service/` | Backend-complete, **dormant** | **Reuse + complete** (adapter + UI + enable secret) |
| HR re-joining form | `hr_rejoining_forms`, `routes/hr-forms.ts`, `HRForms.tsx` | Working (approval→salary) | **Reuse**; keep salary write-back inside Financial Freeze |
| Payroll / advances / salary | `staff_salary_payments`, `staff_advances` | Working, **Financial Freeze** | **Do not modify** without Change Control + owner sign-off |
| Auth / permissions | `middleware/requireStaffAuth.ts`, `role_permissions` | Working (matrix off-repo) | **Reuse** primitives; add module perms via change control |
| Audit log | `schema/auditLogs.ts`, `lib/audit.ts` | Working (hash-chained) | **Reuse** — wire into every sensitive HR mutation |
| Feature flags | `schema/featureFlags.ts`, `lib/featureFlags.ts` | Working (server `ff_*`) + client `FEATURE_FLAG_DEFAULTS` | **Reuse** — seed `ff_hr_*` in shadow mode |
| Object storage | `lib/objectStorage.ts`, `routes/storage.ts` | Working (presigned) | **Reuse** for HR documents (`storage_key` pattern) |
| PDF | client `jsPDF`+autotable (`reportPdfGenerator.ts`) | Working | **Reuse** for scorecards |
| CSV/Excel | `lib/csv.ts`, `xlsx` | Working | **Reuse** for registers/exports |
| Cron / pollers | `cron.ts`, `services/integration/scheduler.ts` | Working (node-cron, `ENABLE_SCHEDULERS`) | **Reuse** shape for an attendance-import poller |
| In-app notifications | — | **Does not exist** | **Build** (model on integration outbox) |

---

## 4. The identity split (critical)

`users` (login accounts: role, permissions, PIN, WebAuthn) and `staff` (HR master: salary, bank, joining) are **separate tables with no foreign key between them**. Evidence: `staff_quick_doctors.staff_id → users.id`, but `staff_attendance.staff_id → staff.id`. `docs/archive/DATABASE_ARCHITECTURE_AUDIT.md` calls the split "intentional (HR records ≠ auth)". Consequence: **employee self-service** (a logged-in *user* viewing their own *staff* score/attendance) needs an explicit, reviewed link. This is a genuine decision — see Open Issues #1.

---

## 5. Gap analysis

**Critical**
- **C1 — Audit coverage:** sensitive HR mutations (salary-field edits, attendance overrides, future performance/discipline) write no `audit_logs`. Legal-defensibility gap. *Fix: wire `auditFromRequest()`.*
- **C2 — Identity link (users↔staff):** blocks employee self-service and correct actor attribution. *Needs a decision (Open Issues #1).*
- **C3 — Financial Freeze boundary:** attendance→payroll, salary, allowances, increments all touch frozen finance. Must **not** be auto-wired; recognition/allowance/increment stay advisory until Change Control.

**High**
- H1 — No performance/scoring/recognition/allowance/appraisal/PIP model at all.
- H2 — No shift/roster/leave model → attendance cannot be judged (late/absent/overnight undefined).
- H3 — USB fingerprint path incomplete (adapters stubbed, no UI, disabled).
- H4 — No raw-punch preservation, correction workflow, or import-run ledger.
- H5 — Self-scoped GET endpoints (future "my score/attendance") must be added to `sw.js` `NETWORK_ONLY_PREFIXES` (CI-enforced; prior PHI-cache leak).

**Medium**
- M1 — No zod validation on staff routes. M2 — No service layer. M3 — `/staff` frontend visibility gap. M4 — `CASCADE` on HR child tables. M5 — Broken `desktop/bridge/` duplicate; dead `useBridge.ts`. M6 — Designation is free text; no reporting hierarchy / status history / document repo.

**Low**
- L1 — Staff tables use raw `<table>` not `ui/table.tsx`. L2 — Staff module not migrated to the generated API client. L3 — jsPDF is client-only (fine for scorecards).

---

## 6. Proposed architecture (summary — full detail in `CARE_STAFF_HR_ARCHITECTURE.md`)

1. **Extend, never duplicate.** Keep `staff` as the HR master; add **new additive tables** for everything net-new; keep protected files (`staff.ts`, `hr-forms.ts`, `bridge.ts`) edits minimal and change-controlled.
2. **Attendance ingestion abstraction** over the existing `source` column: `manual | fingerprint | usb-bridge | csv_import | api_import | admin_correction | system_generated`, with **raw punches** preserved separately from **daily summaries**, plus a **correction workflow** and **import-run ledger** — reusing the dormant bridge as one provider.
3. **Server-side, pure, deterministic score engine** (shipped in this PR: `artifacts/api-server/src/lib/performance/scoreEngine.ts`) driven by **admin-configurable, effective-dated rules**; every score fully itemised; official score never computed in React.
4. **Reuse infrastructure:** `requireStaffSubPermission` (add `staff`/`hr`/`performance` modules via change control), `auditFromRequest`, `feature_flags` (`ff_hr_*`), object storage, jsPDF, `lib/csv.ts`, node-cron.
5. **Shadow mode first:** all `ff_hr_*` flags seeded **disabled**; compute-only; **no** payroll amount, allowance, increment, or discipline is ever triggered by software alone.

---

## 7. What Phase-0/1 lands in this change (safe, additive, inert)

- These seven docs + ADR-003.
- **New non-financial foundation tables** (`lib/db/src/schema/staffHr.ts` + idempotent `migrations/staff_hr_foundation.sql`): `designations`, `staff_status_history`, `staff_reporting_lines`, `staff_documents` — `RESTRICT`/`SET NULL`, not `CASCADE`. No routes/UI yet (inert).
- **Seeded `ff_hr_*` feature flags — all disabled (shadow mode).**
- **Pure score engine + full unit tests** (`scoreEngine.ts` / `.test.ts`) — no DB, no wiring, no financial effect.
- **Zero** changes to any financial/protected file (only an additive one-line export in `schema/index.ts`).

Deferred to reviewed follow-ups: identity link, permission-module registration, routes/UI, performance tables, bridge completion, notifications. See `CARE_STAFF_HR_IMPLEMENTATION_PLAN.md`.
