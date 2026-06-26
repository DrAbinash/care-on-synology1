# Permission Penetration Audit Report
**Care Diagnostics ERP**  
**Date:** June 24, 2026  
**Auditor:** Antigravity AI  

---

## 1. Executive Summary

This report documents the results of a comprehensive **Permission Penetration Audit** of the Care Diagnostics ERP. The scope of this audit covers front-end routes, back-end API routers, session idle timeouts, role-based access control (RBAC) boundaries, and defense-in-depth measures like the USB security key gate.

No configurations were automatically altered, no user access was revoked, and no roles were modified. This is an **audit-only** diagnostic document.

---

## 2. Role & Permission Matrix

The ERP uses a combination of role assignments and explicit permissions (stored in `usersTable.permissions` as a JSON array of strings). The table below outlines the default configurations and access scopes:

| Role | Default Frontend Paths Permitted | API Middleware Guard Level | Primary Operational Scope |
| :--- | :--- | :--- | :--- |
| **Super Admin** | All Paths (`*`) | Bypass USB gate with remote login, full access to ledger & compliance. | Platform Owner / Auditor |
| **Admin** | All Paths (`*`) | Bypass USB gate disallowed; standard staff auth full bypass. | Clinic Administrator |
| **Manager** | `["/", "/patients", "/orders", "/billing", "/payments", "/doctors", "/reports", "/referrals", "/accounting", "/discounts", "/register", "/pacs", "/dicom-nodes"]` | Validates `/settings` and other modules. | Branch Manager / Shift Lead |
| **Accountant** | `["/", "/accounting", "/reports", "/billing", "/payments"]` | Restricts non-accounting APIs. | Bookkeeper / Cashier |
| **Billing** | `["/", "/patients", "/billing", "/payments", "/register", "/discounts"]` | Restricts pricing mutations, deletes, and clinical templates. | Registration Desk / Biller |
| **Lab** | `["/orders", "/tests", "/report-generator", "/inventory"]` | Restricts registration and cash drawers. | Lab Technician |
| **Receptionist**| `["/", "/patients", "/orders", "/register"]` | Denies billing, payments, settings, and templates. | Front Desk |

---

## 3. Security Check Results

### 3.1 Route Protection (Client-Side Bypass)
* **Vulnerability**: In `staffSession.ts`, the `PERMISSIONED_PATHS` array defines what paths require check guards. However, none of the `/radiology/*` or `/teaching-cases/*` paths are registered in this set.
* **Impact**: Any authenticated staff member (including a receptionist or cleaner) can manually type URLs like `/radiology/pacs-settings` or `/radiology/network-control-center` in their browser and bypass the client-side router redirects.
* **Affected File**: [staffSession.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/lib/staffSession.ts)

### 3.2 API Protection (Server-Side Bypass)
* **Vulnerability**: In `index.ts`, many sub-routers are mounted with *only* `requireStaffAuth` and completely lack a second `requireStaffPermission` middleware.
* **Impact**: Users can execute requests directly against these backend endpoints even if their front-end UI hides the corresponding buttons.
* **Affected Routers**: `/radiology`, `/usg-extraction`, `/usg-doppler`, `/usg-reports`, `/usg-critical`, `/usg-analytics`, `/echo-cardiology`, `/fetal-usg`, `/dicom-studies`, `/dicom-workflow`, `/smart-radiology`, `/ris-monitor`, `/radiology-workflow`.

### 3.3 Navigation Protection (Menu Item Reachability)
* **Vulnerability**: The sidebar logic hides menu items that are not in a user's permission array. However, because `/radiology` paths are omitted from the client-side `PERMISSIONED_PATHS` array, their access status defaults to `true`.
* **Impact**: If a user manages to reveal hidden sidebar elements via browser developer console hacks, they can freely click them.

### 3.4 Owner/Admin Protection
* **Defense-in-depth Status**: Robust. The `/users` mutating routes in `users.ts` enforce the `blockSuperAdminEscalation` check, preventing non-super_admin accounts from demoting, deleting, or promoting users to the `super_admin` role.
* **Affected File**: [users.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/users.ts)

### 3.5 PACS Protection
* **Vulnerability**: Any authenticated staff member can query/retrieve DICOM studies, review raw image slices, launch Weasis or OHIF web viewers, and modify PACS settings.
* **Impact**: Data leakage of Protected Health Information (PHI) and unauthorized modification of scanner/modality connection configurations.
* **Affected Routes**: `/pacs` (gated correctly), but `/radiology` and `/dicom-studies` are completely unguarded.

### 3.6 Financial Protection
* **Vulnerability 1**: The ledger endpoint `GET /ledgers` (mounted in `index.ts` line 264) is protected only by `requireStaffAuth`.
* **Impact 1**: Any authenticated staff user can list the clinic's internal accounts, banks, and ledgers.
* **Vulnerability 2**: The daily totals endpoints `GET /daily-summary` and `/dashboard/advanced-summary` only require `requireStaffAuth`.
* **Impact 2**: Low-level receptionists can view cash registers and total daily collections.

### 3.7 HR Protection
* **Status**: Secure. Staff rosters, salary histories, and HR forms (`/staff`, `/hr-forms`) are properly gated under the `/settings:users` sub-permission. 
* **Vulnerability**: The file-upload endpoint `/uploads` does not verify object ownership or resource context beyond basic staff authentication.

### 3.8 Website Protection
* **Status**: Secure. The website settings, page builder, popups, and FAQ mutation endpoints in `website.ts` all require `requireStaffPermission("/website")`. Public GET routes are appropriately left unauthenticated for client-side queries.

---

## 4. Prioritized Vulnerability List

### 4.1 Critical Risk Issues
1. **Unprotected Radiology & PACS API Endpoints**
   - **Route**: `router.use("/radiology", requireStaffAuth, pacsEnterpriseRouter)`
   - **Route**: `router.use("/radiology", requireStaffAuth, radiologyRouter)`
   - **Detail**: Non-radiology staff can read/write report drafts, trigger C-ECHO calls, and view clinical history.
   - **Remediation**: Require `requireStaffPermission("/radiology")` or `requireStaffPermission("/orders")`.

2. **DICOM Studies Access Leak**
   - **Route**: `router.use("/dicom-studies", requireStaffAuth, dicomStudyManagerRouter)`
   - **Detail**: Unprivileged users can access patients' raw DICOM metadata.
   - **Remediation**: Guard with `requireStaffPermission("/dicom-nodes")`.

---

### 4.2 High Risk Issues
1. **Client-side Route Bypass (Missing `PERMISSIONED_PATHS` entries)**
   - **Detail**: Omission of `/radiology`, `/teaching-cases`, `/backup-replication` from the client-side guard list allows manual url routing.
   - **Remediation**: Update `PERMISSIONED_PATHS` in `staffSession.ts` to include all sub-routes.

2. **Ledgers Read Access Leak**
   - **Route**: `GET /ledgers` (in `index.ts`)
   - **Detail**: Any staff can view structural accounting assets without the `/accounting` permission.
   - **Remediation**: Add `requireStaffPermission("/accounting")` to the GET endpoint.

---

### 4.3 Medium Risk Issues
1. **Kiosk and Public Bookings Rate Limiting Bypasses**
   - **Detail**: Lack of robust server-side IP tracking allows distributed API flooding of `/kiosk` endpoints.
   - **Remediation**: Implement a Redis-backed connection rate limiter on the public API layer.

---

### 4.4 Low Risk Issues
1. **Open Appointment and Package Readers**
   - **Route**: `/appointments`, `/packages`
   - **Detail**: Low-level staff can read clinic booking lists. This is acceptable for receptionist duties but should be monitored.

---

## 5. Recommended Remediation Roadmap (Audit Only)

```
[Phase 1: Secure API Endpoints] ───> [Phase 2: Sync Client Guards] ───> [Phase 3: Restrict Ledgers]
(Add requireStaffPermission)          (Update PERMISSIONED_PATHS)       (Protect accounting read route)
```

1. **Phase 1: Backend Guard Additions**:
   Apply `requireStaffPermission("/radiology")` to all `/radiology`, `/dicom-studies`, and `/usg-*` routes in `index.ts`.
2. **Phase 2: Frontend Sync**:
   Add `/radiology`, `/teaching-cases`, and `/backup-replication` to the `PERMISSIONED_PATHS` set in `staffSession.ts`.
3. **Phase 3: Accounting Tightening**:
   Restructure the custom `GET /ledgers` inline handler to pass through `requireStaffPermission("/accounting")`.
