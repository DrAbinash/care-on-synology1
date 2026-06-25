# Hospital Production Readiness Assessment
**Care Diagnostics ERP & PACS Ecosystem**  
**Date:** June 24, 2026  
**Auditor:** Antigravity AI  
**Scope:** 24x7 Diagnostic Center Production Readiness Audit

---

## 1. Executive Summary

This document evaluates the production readiness of the Care Diagnostics ERP & PACS ecosystem for deployment in a high-demand, 24x7 diagnostic center supporting multiple radiologists, modalities, billing operations, online payments, and clinical reporting workflows.

The system is highly capable, modern, and features deep clinical integration (e.g., automated DICOM matching, concurrent study locking, local dictation upgrades, and PACS connectivity). However, several critical vulnerabilities in API security, database exposure, synchronous backend operations, and single points of failure (SPOF) must be resolved before full production deployment.

### Overall Production Readiness Score: **72 / 100**

---

## 2. Category Scoring Breakdown

| Category | Score | Primary Evaluation Criteria & Findings |
| :--- | :---: | :--- |
| **Security** | **55 / 100** | Parameterized queries are sound, but the system has weak PIN brute-force protection, plaintext backup storage, unencrypted database ports, and unencrypted PII at rest. |
| **Reliability** | **70 / 100** | Docker Compose recovery is defined. However, there is no automatic system failover, and the database node lacks clustered replication. |
| **Backup** | **75 / 100** | Daily PostgreSQL dumps are automated. However, dumps are stored in plaintext locally without encryption, and automated restore testing is absent. |
| **Disaster Recovery** | **70 / 100** | RTO/RPO runbooks are documented. However, physical hardware redundancy is missing (single Synology NAS SPOF), and failover procedures require manual CLI steps. |
| **PACS** | **68 / 100** | Orthanc configuration is functional, but lack of a whitelisted C-STORE target verification and manual sync requirements limit production scale. |
| **Database** | **75 / 100** | Structured schema with proper indices. However, Patient ID generation relies on $O(N)$ memory-heavy loops, and the DB port is exposed to the local network adapter. |
| **Billing** | **78 / 100** | Fully featured billing modules. However, transaction locks on payment gateway hooks are lacking, risking duplicate transactions or un-audited refunds. |
| **Audit Logging** | **72 / 100** | Modality matching, study locking, and report changes are logged. However, log data is modifiable within standard tables, lacking cryptographic tamper protection. |
| **User Permissions** | **65 / 100** | Matrix exists. However, critical gaps exist: `/radiology` and `/dicom-studies` routes are unprotected, and permission escalation check boundaries are bypassable. |
| **Performance** | **72 / 100** | Good UI response, but PDF generation runs on the main thread (blocking event loop), and client-side database fetches are not fully paginated. |
| **Maintainability** | **80 / 100** | Clean repository structure utilizing Drizzle ORM, but root workspace has multiple local backup folders polluting search indices. |
| **Deployment** | **85 / 100** | Containerized deployment using Docker Compose. Simple to spin up, but environment secrets lack standard vault container protection. |

**Weighted Average Score: 72%**

---

## 3. Action Item Registry

### 3.1 Must Fix (Critical Risk - Fix Before Launch)
1. **Unprotected Radiology & PACS API Routes**
   * *Risk:* Low-privilege users can view, edit, or delete patient study data because `/radiology`, `/dicom-studies`, `/daily-summary`, and `/samples` routes lack module-level permission gates.
   * *Fix:* Wrap these routes with `requireStaffPermission()` middleware in the backend API router.
2. **Database Container Port Exposed Globally**
   * *Risk:* Postgres container exposes port `5400` on the network host (`0.0.0.0`), allowing brute force database logins across the LAN or WAN.
   * *Fix:* Change host binding in `docker-compose.yml` to `127.0.0.1:5400:5432` so database connections are restricted to the local machine and the internal Docker network.
3. **Open Mail Relay in Daily Summary Endpoint**
   * *Risk:* Attackers or compromised accounts can use the `/api/dashboard/my-daily-summary/send-email` route to send arbitrary HTML spam, phishing emails, or exfiltrate client data.
   * *Fix:* Block arbitrary HTML payloads in the request body. Restrict email templates to server-rendered formats and add permission gates.
4. **Plaintext Backup Storage**
   * *Risk:* Daily database `.dump` files are written in plaintext on the NAS filesystem. If the hardware is physically compromised, all patient PHI is exposed.
   * *Fix:* Update backup scripts to compress and encrypt dumps using AES-256 before storing them on local volumes.
5. **Headless Browser PDF Generation on Main Node Thread**
   * *Risk:* Finalizing reports launches a Playwright headless Chromium instance inside the main API thread. Simultaneous report print requests can block the event loop, causing server timeouts.
   * *Fix:* Offload PDF generation to a queue worker or execute it in a separate process pool.

---

### 3.2 Should Fix (High Risk - Fix Within 30 Days of Launch)
1. **$O(N)$ Patient ID Suffix Loop**
   * *Risk:* Patient ID generation reads every patient record from the database to parse the highest suffix value in memory. This will crash the API server as the record count increases.
   * *Fix:* Implement a PostgreSQL sequence-backed or SQL-level extraction query to retrieve only the maximum ID.
2. **Session Security (Cookies vs. Local Storage)**
   * *Risk:* Authentication tokens are stored in browser localStorage, making them vulnerable to cross-site scripting (XSS) extraction.
   * *Fix:* Migrate session tokens to Secure, HTTP-Only, SameSite cookies.
3. **No Database Level Account Lockout State**
   * *Risk:* Staff login relies on simple usernames and bcrypt hashed PINs. Lack of persistent failed login counters allows brute-force attacks across container restarts.
   * *Fix:* Track failed login attempts in the database and block accounts for a set duration after 5 failed attempts.
4. **Duplicate Payment Webhook Locks**
   * *Risk:* Timeout of payment checks can cause double-booking billing logs or un-audited refunds if webhook handlers receive multiple requests.
   * *Fix:* Implement database-level transaction keys for transaction callbacks.
5. **DCMTK Tooling Missing inside Docker Context**
   * *Risk:* C-ECHO calls fall back to basic TCP socket probes, which verifies port availability but not PACS protocol compliance.
   * *Fix:* Install `dcmtk` (specifically `echoscu`) in the `care-api` Dockerfile.

---

### 3.3 Nice To Have (Improvement Opportunities - Long-term Roadmap)
1. **WS-Based Lock Timeout**
   * *Improvement:* Stale study locks block editors for 30 minutes. Implement websocket heartbeats to automatically release study locks when a radiologist closes their browser tab.
2. **Audit Log Hash-Chaining**
   * *Improvement:* Database administrators can alter database rows in the audit log table. Hash-chaining logs ensures database tampering is instantly detectable.
3. **PII Column Encryption**
   * *Improvement:* Phone numbers and emails are stored in plaintext. Encrypt sensitive columns using AES-GCM at the database schema level.
4. **VLAN Segmentation**
   * *Improvement:* Modality DICOM traffic runs on the shared clinic LAN. Segment modalities and the PACS onto a dedicated private VLAN.
5. **Repository Cleanliness**
   * *Improvement:* Clean up backup folders (`backup_pre_refactor`, `restore_point_payment_refactor`) to reduce search noise and deployment size.
