# SEC_SOP_001: Authentication, Access Control & Session Policies
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Protect patient confidentiality (HIPAA compliance) and secure financial write endpoints by enforcing strict access control, password policy, and session timeouts.
*   **Scope**: Staff logins, role-based access controls (RBAC), and session timeouts.
*   **Responsibility**: IT Administrators and Security Officers.

---

## 2. Step-by-Step Security Procedures

### A. Staff Account Provisioning
1.  Navigate to **Staff Management** inside the ERP under Admin credentials.
2.  Click **Add Staff**. Fill in name, email, and mobile number.
3.  **Role Assignment**: Assign a specific role mapping to the staff member's responsibilities:
    *   `receptionist`: Access to search directory, register patients, and queue management.
    *   `billing`: Access to patient records, billing, and payment desk.
    *   `radiologist` / `pathologist`: Access to diagnostic worklist and reporting consoles.
    *   `accountant`: Access to ledger dashboard, vouchers, and exports.
    *   `admin`: Full configuration overrides.
4.  Generate a temporary password and force the user to reset it on their first login.

### B. Session Timeout & Lockouts
1.  Idle session timeout is configured to **30 minutes**.
2.  If a terminal remains inactive for 30 minutes, the browser will automatically invalidate the JWT token and redirect the user to the login screen.
3.  Accounts are automatically locked for 30 minutes after **5 consecutive failed login attempts**.

---

## 3. Reference to Security Audits
For details on password hashing algorithms, authentication middleware, and RBAC matrix evaluations, refer to:
*   **[ERP_SECURITY_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/07_SECURITY/ERP_SECURITY_AUDIT.md)**
*   **[PERMISSION_PENETRATION_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/07_SECURITY/PERMISSION_PENETRATION_AUDIT.md)**

---

## 4. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
