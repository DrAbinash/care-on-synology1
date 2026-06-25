# ERP Authorization & Permission Matrix Audit
**Care Diagnostics ERP Security Assessment**

This document details the architectural review of the Care Diagnostics ERP authorization system, includes a complete module-to-action permissions matrix, identifies security vulnerabilities (missing checks, overly broad permissions, and privilege escalation paths), and outlines actionable recommendations for implementing granular Role-Based Access Control (RBAC).

---

## 1. Executive Summary of the Authorization Model

The Care Diagnostics ERP uses a hybrid authentication and authorization model built on top of Express middleware:

1. **Authentication (`requireStaffAuth`)**:
   - Validates bearer tokens against `portal_sessions` with `scope = 'staff'`.
   - Validates user status (`isActive = true`).
   - Enforces configurable session idle timeouts (`sessionIdleTimeoutMinutes`).
   - Attaches `req.staffSession` containing: `role`, `permissions` (parsed JSON array of strings), and `maxDiscount` (percentage limits).

2. **Authorization Middleware**:
   - **`requireStaffPermission(permission)`**: Checks if the user's `permissions` array contains the specified permission path or sub-paths prefixed with it (e.g. `permission + ":"`). Bypass granted if the user's role is in `FULL_ACCESS_ROLES` (`admin`, `admin`).
   - **`requireStaffSubPermission(modulePath, action)`**: Checks if the user has `modulePath` or `${modulePath}:${action}` in their permissions.

3. **Admin Bypass**:

---

## 2. Complete ERP Permission Matrix

The table below catalogs current route-level authorization gates across all **17 major modules** for the **8 standard actions**:
- **V**: View (Read / List / Detail)
- **C**: Create (Insert / Add)
- **E**: Edit (Update / Modify)
- **D**: Delete (Remove / Cancel / Void)
- **A**: Approve (Finalize / Verify / Release)
- **X**: Export (CSV / Excel download)
- **P**: Print (Generate PDF / Receipt reprint)
- **S**: Manage Settings (Configuration / Rule setups)

| Module | Route / Scope | V | C | E | D | A | X | P | S | Current Access Gate / Middleware |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Dashboard** | `/dashboard/advanced-summary` | Admin | - | - | - | - | - | - | - | `requireStaffAuth` + Owner-only check (`FULL_ACCESS_ROLES`) |
| | `/dashboard/my-daily-summary` | Staff | - | - | - | - | - | - | - | `requireStaffAuth` (Aggregates restricted to owner unless superadmin) |
| | `/daily-summary` | **ALL** | - | - | - | - | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| **Registration** | `/patients` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffPermission("/patients")` (C/E checked via sub-permissions) |
| | `/portal/admin` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffPermission("/patients")` |
| | `/kiosk` | Public | Public | - | - | - | - | - | - | Unauthenticated, rate-limited public endpoint |
| **Billing** | `/bills` | Staff | Staff | Staff | Staff | - | - | Staff | - | `requireStaffPermission("/billing")` (E/D gated by sub-permissions) |
| | `/discount-reasons` | **ALL** | Staff | Staff | Staff | - | - | - | - | GET open to all; mutations require `requireStaffPermission("/discounts")` |
| | `/discounts` | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffPermission("/discounts")` |
| **Laboratory** | `/tests` (Catalog) | **ALL** | Staff | Staff | Staff | - | - | - | - | GET open to all; mutations require `requireStaffPermission("/tests")` |
| | `/test-categories` | **ALL** | Admin | Admin | Admin | - | - | - | Admin | GET open to all; mutations require `/settings:infrastructure` |
| | `/outsourced-labs` | **ALL** | Staff | Staff | Staff | - | - | - | - | GET open to all; mutations require `requireStaffPermission("/tests")` |
| | `/samples` | **ALL** | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| **Radiology** | `/radiology` (Worklist) | **ALL** | **ALL** | **ALL** | **ALL** | **ALL** | **ALL** | **ALL** | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| | `/radiology/report-generator`| **ALL** | **ALL** | **ALL** | **ALL** | **ALL** | - | **ALL** | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| | `/radiology/structured-...` | **ALL** | - | - | - | - | - | - | - | `requireStaffAuth` only |
| | `/radiology/snippets` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology/knowledge` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology/smart` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-copilot` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-memory` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-lesions` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-spine` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-brain` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-tumor` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-annotations` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| | `/radiology-ollama` | **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | `requireStaffAuth` only |
| **PACS** | `/pacs` (AE Nodes) | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffPermission("/dicom-nodes")` |
| | `/dicom` | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffPermission("/dicom-nodes")` |
| | `/dicom-agent` | Staff | - | - | - | - | - | - | - | `requireStaffPermission("/dicom-nodes")` |
| | `/dicom-studies` (Registry)| **ALL** | **ALL** | **ALL** | **ALL** | - | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| | `/dicom-workflow` | **ALL** | **ALL** | - | - | - | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| | `/smart-radiology` | **ALL** | **ALL** | - | - | - | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| | `/ris-monitor` | **ALL** | - | - | - | - | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| **Reports** | `/reports` | Staff | - | - | - | - | Staff | Staff | - | `requireStaffPermission("/reports")` |
| | `/patient-reports` | Staff | Staff | Staff | - | - | Staff | Staff | - | `requireStaffPermission("/reports")` |
| | `/signatures` | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffPermission("/reports")` |
| | `/form-f` (Ultrasonography) | Staff | Staff | Staff | - | - | Staff | Staff | - | `requireStaffPermission("/form-f")` |
| **Pharmacy** | *Not Implemented* | - | - | - | - | - | - | - | - | Core inventory modules used for clinic consumables |
| **Accounts** | `/accounting` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffPermission("/accounting")` |
| | `/expenses` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffPermission("/accounting")` |
| | `/ledgers` | **ALL** | Staff | Staff | Staff | - | - | - | - | GET open to all; mutations require `requireStaffPermission("/accounting")` |
| | `/banking` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffPermission("/banking")` (Webhooks public) |
| **Inventory** | `/inventory` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffPermission("/inventory")` |
| | `/vendors` | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffSubPermission("/settings", "infrastructure")` |
| **HR** | `/staff` | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffSubPermission("/settings", "users")` |
| | `/hr-forms` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffSubPermission("/settings", "users")` |
| **CRM** | `/online-bookings` | **ALL** | - | - | - | - | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| | `/whatsapp` | **ALL** | **ALL** | - | - | - | - | - | - | **VULNERABILITY**: `requireStaffAuth` only (no permission check) |
| | `/wa-chatbot` | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffSubPermission("/settings", "notifications")` (Webhooks public) |
| **Settings** | `/clinic-settings` | **ALL** | - | **ALL** | - | - | - | - | Admin | GET open to all; PUT permitted for all on quickTestIds; others require clinic settings |
| | `/printers` | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffSubPermission("/settings", "devices")` |
| | `/locations` (Modality/Room)| Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffSubPermission("/settings", "infrastructure")` |
| **User Mgmt** | `/users` (Preferences) | **ALL** | - | **ALL** | - | - | - | - | - | GET preferences open to all; mutations require settings:users |
| | `/users` (Mutations) | Staff | Staff | Staff | Staff | - | - | - | - | `requireStaffSubPermission("/settings", "users")` |
| **Payment GW** | `/public/booking` | Public | Public | - | - | - | - | - | - | Unauthenticated public Razorpay/bank callback routes |
| **Notifications**| `/email-settings` | Staff | Staff | Staff | - | - | - | - | - | `requireStaffSubPermission("/settings", "notifications")` |

**Key to Access Gates**:
- **Staff**: Restricted to authorized staff possessing the module-specific permission (e.g. `/patients`, `/billing`).
- **Admin**: Bypasses restriction via admin flags or specific infrastructure permission gates.
- **ALL**: Authenticated staff can access without specific route-level permission checks.
- **Public**: Entirely unauthenticated public routing.

---

## 3. Security Analysis & Vulnerabilities

### A. Missing Permission Checks (Broken Object Level Authorization)

1. **Daily Financial Summary Leak (`/daily-summary`)**:
   - *Endpoint*: `GET /api/daily-summary`
   - *Impact*: Any authenticated user (including low-privilege receptionists or lab staff) can query this endpoint to view daily cash/digital totals, expenses, discounts, individual user cash-drawer collections, and audit trails.
   - *Severity*: **High**

2. **Laboratory Samples Modification Bypasses (`/samples`)**:
   - *Endpoint*: `POST /api/samples`, `PATCH /api/samples/:id`, `DELETE /api/samples/:id`, `POST /api/samples/:id/status`, `POST /api/samples/:id/outsource`
   - *Impact*: There are no permission checks on the `/samples` router beyond outer `requireStaffAuth`. Any user can register samples, transition their states, update notes, set up outsourcing costs, or delete sample records entirely.
   - *Severity*: **Critical**

3. **DICOM Registry & Workflow Exposure (`/dicom-studies`, `/dicom-workflow`, `/ris-monitor`)**:
   - *Endpoints*: `POST /api/dicom-studies`, `POST /api/dicom-studies/:id/link`, `POST /api/dicom-studies/:id/priority`, `POST /api/dicom-studies/:id/sync-retry`, `POST /api/dicom-studies/ai-extractions/:id/review`
   - *Impact*: Anyone can link DICOM studies to random billing records, adjust study priorities, trigger PACS retries, and review/modify AI clinical extractions.
   - *Severity*: **High**

4. **Radiology Worklist & Report Generation (`/radiology/*`)**:
   - *Endpoints*: `/api/radiology`, `/api/radiology/report-generator`, `/api/radiology/snippets`, `/api/radiology/knowledge`, `/api/radiology/smart`
   - *Impact*: The outer routes lack permission checks (relying only on `requireStaffAuth`). Although there are helper functions in `dicomStudyManager.ts` meant to restrict actions to technicians, doctors, or radiologists, they are not applied. Receptionists or billers could technically create, write, or finalize diagnostic reports.
   - *Severity*: **Critical**

5. **CRM & WhatsApp Communication Access (`/online-bookings`, `/whatsapp`)**:
   - *Endpoints*: `/api/online-bookings`, `/api/whatsapp`
   - *Impact*: Any staff account can read patient bookings or send arbitrary manual/templated WhatsApp notifications without a specific CRM module permission check.
   - *Severity*: **Medium**

### B. Overly Broad Permissions

1. **Unrestricted GET Actions on Sensitive Datasets**:
   - `/tests` and `/ledgers` allow any staff member to pull a full dump of ledgers or test catalogs. While reading catalogs is necessary for billing, ledgers contain financial settings and balances.
2. **Settings Write Privilege Bypasses**:
   - `/clinic-settings` (PUT) allows *any* staff member to edit settings if they only provide `quickTestIds` or `billPrintCopies` in the body. If the backend schema checks are not strict, parameter injection could allow editing restricted clinic parameters.
3. **FIDO2/WebAuthn Setup**:
   - `/auth/webauthn` registration is open to any active staff session. An attacker who gains temporary access to a low-privilege staff session can register a security key and establish a persistent backdoor.

### C. Privilege Escalation Paths

1. **Arbitrary SMTP Mail Relay via Daily Summary**:
   - *Endpoint*: `POST /api/dashboard/my-daily-summary/send-email`
   - *Vulnerability*: Any staff member can send custom HTML content to any email address through the clinicâ€™s configured SMTP server. An attacker can use this as an open mail relay for phishing, spamming, or data exfiltration.
   - *Severity*: **Critical**

2. **Billing Modification & Refund Bypass**:
   - *Endpoints*: `POST /api/bills/:id/change-doctor`, `POST /api/bills/:id/cancel-test`, `POST /api/bills/:id/cancel-refund-tests`
   - *Vulnerability*: These endpoints require `/billing` permission but bypass the specific `requireStaffSubPermission("/billing", "edit")`, `"delete"`, or `"refund"` checks. A receptionist can cancel individual tests and trigger refunds on a bill without holding the "refund" or "delete" sub-permissions.
   - *Severity*: **High**

---

## 4. Recommendations for Granular Role-Based Access Control

To transition the Care Diagnostics ERP to a secure, granular RBAC architecture, we recommend implementing the following controls:

### A. Role Definition & Permissions Mapping

| Role | Scope of Access | Allowed Permissions |
| :--- | :--- | :--- |
| **Super Admin** | Full administrative and system control | All modules, audit log exports, backup management, WebAuthn admin, user setups. |
| **Admin** | Clinic management and configuration | `/settings`, `/patients`, `/billing`, `/accounting`, `/reports`, `/tests`, `/dicom-nodes`. |
| **Manager** | Operational desk oversight | `/patients`, `/billing` (with partial edit/cancel), `/reports` (read-only), `/dicom-nodes`. |
| **Radiologist / Doctor** | Clinical diagnosis and reporting | `/radiology`, `/radiology/report-generator`, `/radiology/knowledge`, `/patients:read`. |
| **Lab Technician** | Sample processing and testing | `/samples` (collect/process), `/tests` (read), `/patients` (read), `/reports` (lab results only). |
| **Billing Agent** | Bill desk operations | `/patients:create`, `/billing:create`, `/billing:print`, `/discounts` (capped by maxDiscount). |
| **Receptionist** | Patient check-in and queuing | `/patients:create`, `/patients:read`, `/queue` (tokens). |

### B. Actionable Remediation Patterns

1. **Enforce Route Gating in `routes/index.ts`**:
   Replace loose mounts with specific permission-checking middlewares:
   ```typescript
   // Restrict Radiology to Radiologists, Doctors, and Admins
   router.use("/radiology", requireStaffAuth, requireStaffPermission("/radiology"), radiologyRouter);

   // Restrict Daily Summary to Managers/Admins
   router.use("/daily-summary", requireStaffAuth, requireStaffPermission("/reports"), dailySummaryRouter);

   // Restrict Lab Samples to Lab Techs, Doctors, and Admins
   router.use("/samples", requireStaffAuth, requireStaffPermission("/tests"), samplesRouter);
   ```

2. **Lock Down the Email Relay Endpoint**:
   Modify `my-daily-summary.ts` to restrict the HTML sender endpoint to admins or remove the arbitrary `htmlBody` parameter, building the HTML layout strictly on the server:
   ```typescript
   myDailySummaryRouter.post("/send-email", requireStaffSubPermission("/reports", "export"), async (req, res) => {
     // Render HTML securely on the server instead of trusting req.body.htmlBody
   });
   ```

3. **Secure Partial Cancellation and Doctor Modifications**:
   Apply sub-permission checks in `bills.ts` to avoid receptionist-level bypasses:
   ```typescript
   billsRouter.post("/:id/change-doctor", requireStaffSubPermission("/billing", "edit"), ...);
   billsRouter.post("/:id/cancel-test", requireStaffSubPermission("/billing", "delete"), ...);
   billsRouter.post("/:id/cancel-refund-tests", requireStaffSubPermission("/billing", "refund"), ...);
   ```

4. **Verify DICOM Study Manager Roles**:
   Enforce technician or radiologist checks inside `dicomStudyManager.ts`:
   ```typescript
   router.post("/:id/link", (req, res, next) => {
     if (!requireTechnicianOrAbove(req)) {
       return res.status(403).json({ error: "Technician role required to link studies." });
     }
     next();
   }, linkHandler);
   ```