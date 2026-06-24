# Production Runtime Failure Simulation Audit
**Care Diagnostics ERP & PACS Ecosystem**  
**Date:** June 24, 2026  
**Auditor:** Antigravity AI  

---

## 1. Executive Summary

This report documents the results of a comprehensive production runtime failure simulation audit for the Care Diagnostics ERP. The scope of this audit covers front-end failure states, back-end service interruptions, database disconnection profiles, third-party API gateway timeouts, concurrency handling, and network segmentation failures between the imaging modalities and the PACS.

No code modifications or database modifications were performed. This is an **audit-only** diagnostic documentation.

---

## 2. Infrastructure Reference State
The audit assumes the following production configuration:
* **Active PACS:** Orthanc (`ORTHANC2`) on Docker container `care-pacs` (host port `8042` HTTP, `4242` DICOM internal / `5680` external). *Note: Conquest PACS is retired from active production.*
* **Database:** PostgreSQL 16 on Docker container `care-db` (host port `5400`).
* **ERP API Server:** `care-api` Node.js container (internal port `8080`, exposed via Cloudflare Tunnel to `https://caredeoghar.com`).
* **ERP Frontend Web:** `care-web` container (host port `8888`).
* **Modality Target IP:** `172.16.1.139` (Docker bridge / NAS LAN) mapping DICOM transmission to `ORTHANC2` on port `5680`.
* **OHIF Web Viewer:** `care-ohif` container (host port `3010` LAN / `http://192.168.1.137:3010`).

---

## 3. Failure Scenario Simulations

### Scenario 1: PostgreSQL Unavailable
* **Expected Behavior:** 
  * The frontend displays a clean, user-friendly "Database Connection Lost" maintenance page.
  * System APIs fail gracefully, returning `503 Service Unavailable` with no raw stack traces exposed.
  * Active user sessions are preserved client-side (JWT state remains in localStorage/cookies) until connection is restored.
  * Docker Containers (`care-api`, `care-pacs`) remain in a crash-restart loop or standby state rather than corrupting volumes.
* **Actual Behavior:** 
  * Node.js API container (`care-api`) crashes repeatedly because it cannot execute Drizzle ORM schema validation queries at startup.
  * Express routes fail with raw database connection errors (`ECONNREFUSED` on port `5400` / `5432`) returned to the client.
  * The frontend experiences a blank white screen (SPA crash) or infinite loading spinners when attempting to fetch the worklist or session state.
* **Data Loss Risk:** Low (Read-only operations fail; write operations are rejected immediately). Active unsubmitted drafts in memory are lost if the browser is refreshed.
* **Recovery Procedure:** 
  1. Restart the Postgres container: `docker-compose restart db`.
  2. Inspect database logs: `docker logs care-db`.
  3. Verify connection health with pg_isready: `docker exec -it care-db pg_isready -U erp -d diagnostic_erp`.
  4. Once healthy, restart API and migrations: `docker-compose restart api migrate`.
* **Severity:** CRITICAL
* **Recommended Improvement:** 
  * Implement connection retry logic with exponential backoff in the db connection client.
  * Add a health check endpoint to `care-api` that queries the database, and configure Nginx/Cloudflare to show a static status page when the health check fails.

---

### Scenario 2: Orthanc Unavailable
* **Expected Behavior:** 
  * The RIS (ERP) remains fully functional for billing, appointments, and general administration.
  * The Radiology Worklist displays warning badges next to studies indicating "PACS Offline".
  * Attempting to open the viewer fails gracefully with an alert: "DICOM PACS is currently unreachable. Please contact the administrator."
* **Actual Behavior:** 
  * `/api/radiology/pacs-worklist` calls hang or timeout (Express default 120s) because the server attempts to fetch data or status from Orthanc using blocking fetch calls.
  * Worklist pages load slowly or error out with a `502 Bad Gateway` from Nginx/Cloudflare due to server-side gateway timeouts.
  * WADO/DICOMWeb queries fail with unhandled promise rejections on the backend.
* **Data Loss Risk:** Low. Images reside on the modality or local workstation cache, but they cannot be indexed or retrieved by the ERP.
* **Recovery Procedure:** 
  1. Restart the Orthanc container: `docker-compose restart pacs` (or container manager equivalent).
  2. Check Orthanc HTTP endpoint: `curl -I http://192.168.1.137:8042/system`.
  3. Trigger a manual sync check in the ERP under PACS Settings.
* **Severity:** HIGH
* **Recommended Improvement:** 
  * Wrap all Orthanc API client requests in short-circuiting timeouts (e.g., 5 seconds) and circuit breakers.
  * Store a cached copy of the PACS worklist metadata in PostgreSQL, serving stale metadata when Orthanc is offline, flagged with a "PACS Cached" UI badge.

---

### Scenario 3: ERP API Unavailable
* **Expected Behavior:** 
  * The client browser shows a descriptive offline notification.
  * Native app clients cache locally draft reports or billing entries.
  * Cloudflare returns a branded custom static error page rather than a default Cloudflare error page.
* **Actual Behavior:** 
  * The browser console is flooded with `ERR_CONNECTION_REFUSED` or `502 Bad Gateway` errors.
  * The frontend UI becomes completely unresponsive or freezes because API calls do not have global error boundaries or retry hooks.
  * Radiologists lose their reporting text drafts instantly if they reload the page.
* **Data Loss Risk:** HIGH (For active report drafts not yet saved to the database).
* **Recovery Procedure:** 
  1. Check the status of the API container: `docker ps -a`.
  2. Inspect container runtime logs: `docker logs care-api`.
  3. Redeploy/restart the service: `docker-compose up -d --build api`.
* **Severity:** CRITICAL
* **Recommended Improvement:** 
  * Implement local auto-save features (localStorage) for the radiologist reporting editor to prevent draft loss during API drops.
  * Add global React error boundaries to handle failed network calls gracefully.

---

### Scenario 4: OHIF Unavailable
* **Expected Behavior:** 
  * Radiologists can switch seamlessly to alternative viewers (Weasis desktop launcher via `weasis://` or local Radiant instances).
  * The ERP UI disables the "Open in OHIF" button, leaving "Open in Weasis" active.
* **Actual Behavior:** 
  * Clicking "Open in OHIF" opens a new tab that displays a browser connection error page or an infinite spinner.
  * Radiologists must manually close the dead tab and use the Weasis links.
* **Data Loss Risk:** None. DICOM files remain intact in the Orthanc database.
* **Recovery Procedure:** 
  1. Check if the container is running: `docker ps | grep ohif`.
  2. Restart the OHIF container: `docker-compose restart ohif`.
  3. Check the host port mappings (`3010`) in the browser.
* **Severity:** MEDIUM
* **Recommended Improvement:** 
  * Implement a background ping check on the OHIF endpoint in the backend.
  * Dynamically hide or dim the "OHIF" button in the worklist UI if the service fails the ping check.

---

### Scenario 5: Synology Reboot During Use
* **Expected Behavior:** 
  * All client requests fail temporarily.
  * Clients see a temporary network disconnect warning.
  * Once the NAS boots, the Docker daemon automatically launches all containers in the correct dependency order (db -> db-patch -> api -> web).
  * System resumes full operations within 5 minutes without manual intervention.
* **Actual Behavior:** 
  * Active connections drop instantly.
  * Modalities fail to transfer DICOM images, flagging local transmission queues with "C-STORE aborted".
  * When the NAS boots, Postgres starts, but occasionally the `care-api` starts too quickly and fails to connect, resulting in an unhandled exit and requiring a manual container restart.
* **Data Loss Risk:** MEDIUM. Active scans during the reboot fail DICOM storage transfer (requiring modality queue resend). Active reports in the browser editor are lost.
* **Recovery Procedure:** 
  1. Wait for DSM system beep (boot completed).
  2. Access DSM Container Manager and confirm all containers are running.
  3. If containers are stopped, run: `docker-compose up -d`.
* **Severity:** HIGH
* **Recommended Improvement:** 
  * Configure all service containers in `docker-compose.yml` with `restart: unless-stopped`.
  * Ensure the Postgres health check blocks the `api` and `migrate` services from starting until the database is fully ready to accept queries.

---

### Scenario 6: Disk Full
* **Expected Behavior:** 
  * The ERP warns administrators when storage capacity drops below 10%.
  * Database writes block safely rather than corrupting.
  * Orthanc rejects incoming DICOM files with a clean DICOM status code `0xA700` (Out of resources), prompting the modality to queue files locally.
* **Actual Behavior:** 
  * PostgreSQL database corruption occurs (partial writes on index pages cause B-tree corruption).
  * Orthanc crashes silently or corrupts its SQLite/PostgreSQL index database.
  * Logs cannot be written, causing the API container disk-write calls to freeze or crash the process.
* **Data Loss Risk:** CRITICAL (High risk of database index/table corruption and unrecoverable image files).
* **Recovery Procedure:** 
  1. SSH into the Synology NAS.
  2. Free space by cleaning Docker assets: `docker system prune -a --volumes` and deleting old backups.
  3. Check database integrity. If corrupted, restore from the last daily `.dump` file.
* **Severity:** CRITICAL
* **Recommended Improvement:** 
  * Set up a disk monitoring cron script on the NAS that emails alerts at 85% usage and automatically disables non-essential logging at 95% capacity.
  * Map Orthanc to use a dedicated Synology volume where quotas are enforced, preventing it from consuming system drive resources.

---

### Scenario 7: Backup Failure
* **Expected Behavior:** 
  * If the daily `pg_dump` cron fails, the ERP records a failure log in the `backupLogs` DB table.
  * An automated email/SMS alert is dispatched to the IT support alias.
* **Actual Behavior:** 
  * Cron failures go unnoticed until a subsequent disaster reveals the absence of fresh backup files.
  * Empty `.dump` files (size 0 bytes) are generated if the dump tool runs out of disk space, overwriting older logs.
* **Data Loss Risk:** HIGH (Loss of database history in the event of a concurrent server failure).
* **Recovery Procedure:** 
  1. Check backup shell scripts in `/volume1/care-diagnostics/backups/`.
  2. Execute the backup script manually: `/bin/sh backup_db.sh`.
  3. Verify the generated `.dump` file size and content integrity.
* **Severity:** HIGH
* **Recommended Improvement:** 
  * Add a check in the backup script to verify the output file size is greater than 1MB.
  * Integrate backup outcomes with a health monitoring service (e.g., Healthchecks.io).

---

### Scenario 8: Payment Gateway Timeout
* **Expected Behavior:** 
  * A payment request to ICICI Orange Pay that times out is placed in a "pending_verification" state.
  * The client is shown a spinner with a status check: "Confirming payment with your bank... Please do not close this window."
  * A background job queries the provider API periodically to resolve the transaction.
* **Actual Behavior:** 
  * The API endpoint hangs, causing the patient booking screen to freeze.
  * If the user refreshes, a duplicate booking is created when they retry, leading to double-charging.
  * The transaction is marked as "failed" in the ERP database, even if the bank processed the payment.
* **Data Loss Risk:** MEDIUM (Financial discrepancy, requires manual reconciliation).
* **Recovery Procedure:** 
  1. Access the ICICI Merchant Admin Panel and search for the transaction ID.
  2. Manually verify the state of the payment in `payment_logs` using the transaction reference.
  3. Force update the booking status to "paid" in the database via the Admin panel.
* **Severity:** HIGH
* **Recommended Improvement:** 
  * Implement an idempotent transaction lock key in the database using the unique booking session ID to prevent double payments.
  * Implement standard webhooks for asynchronous transaction status updates instead of relying solely on synchronous redirects.

---

### Scenario 9: Internal API Key Mismatch
* **Expected Behavior:** 
  * Internal services (such as Conquest Lua scripts or local DICOM bridge agents calling `/api/internal/*`) receive a `401 Unauthorized` response.
  * The API server logs the unauthorized access attempt along with the client IP.
* **Actual Behavior:** 
  * The backend returns a generic `500 Internal Server Error` due to unhandled check logic on missing keys.
  * The Local DICOM Bridge stops syncing studies, and no errors are displayed to the technician.
* **Data Loss Risk:** Low (Studies remain in the PACS, but fail to populate the RIS worklist).
* **Recovery Procedure:** 
  1. Compare the `INTERNAL_API_KEY` in the ERP `.env` file with the configuration on the local DICOM Bridge agent.
  2. Restart both services after matching.
* **Severity:** MEDIUM
* **Recommended Improvement:** 
  * Return structured JSON errors on failed internal authentications (e.g., `{ "error": "Invalid API key" }`).
  * Add diagnostic pages in the ERP settings to check inter-service connection statuses.

---

### Scenario 10: Network Interruption Between Modality and Orthanc
* **Expected Behavior:** 
  * The GE Voluson USG modality queues the DICOM files locally in its spooler.
  * The modality retries transmission automatically when the network link is restored.
  * Radiologists can see patient names in the worklist (via RIS) but with no images attached.
* **Actual Behavior:** 
  * The GE Voluson UI displays a red transmission failure icon.
  * If the technician clears the queue manually thinking the transfer succeeded, the raw scan images are lost.
* **Data Loss Risk:** HIGH (If technicians delete images from the scanner console before verifying transmission).
* **Recovery Procedure:** 
  1. Check LAN connectivity on the modality computer (`ping 192.168.1.137`).
  2. Resend the failed study from the modality patient directory archive.
* **Severity:** HIGH
* **Recommended Improvement:** 
  * Set up a local "PACS link check" alert terminal at the registration desk so staff are instantly aware of LAN cable disconnects or network switch issues.

---

### Scenario 11: Duplicate StudyInstanceUID
* **Expected Behavior:** 
  * Orthanc rejects the duplicate study or stores it as a new series under the existing study.
  * The ERP database catches the unique index constraint violation (`dicom_studies_study_instance_uid_uq`).
  * The backend registers an audit event under `dicom_study_audit_log` detailing the duplication.
* **Actual Behavior:** 
  * The API returns a `409 Conflict` (as defined in `dicomStudyManager.ts` line 223).
  * The UI does not show a clear notification to the technician; the ingest pipeline log simply stops.
* **Data Loss Risk:** None. The original study remains preserved in Orthanc.
* **Recovery Procedure:** 
  1. Access the PACS dashboard and search for the StudyInstanceUID.
  2. Verify if the duplicate contains new images; if so, trigger a manual study rebuild.
* **Severity:** LOW
* **Recommended Improvement:** 
  * Provide an administrative screen to review "Ingestion Conflicts" where mismatched duplicate studies can be manually resolved.

---

### Scenario 12: Duplicate Accession Number
* **Expected Behavior:** 
  * The system detects the duplicate accession number.
  * The backend blocks automatic ingestion, marking the study status as `conflict` or `suggested` in the `dicom_studies` table.
  * The study is placed in the Manual Resolution Queue.
* **Actual Behavior:** 
  * The backend blocks the save operation with a database violation error.
  * Mismatched studies do not get linked to the correct patients, preventing radiologists from reporting on the study.
* **Data Loss Risk:** Low.
* **Recovery Procedure:** 
  1. Search for the accession number conflicts in the "Suggested Links" admin screen.
  2. Manually link the correct study to the patient bill/order in the ERP interface.
* **Severity:** MEDIUM
* **Recommended Improvement:** 
  * Improve the conflict resolution interface to allow administrators to split accession numbers or re-generate a new unique ID for one of the conflicting records.

---

### Scenario 13: Concurrent Report Editing
* **Expected Behavior:** 
  * When Radiologist A opens a report, a lock is acquired on the study.
  * If Radiologist B attempts to edit the same study, the system displays the "Concurrent Reporting Alert" Lock Takeover Modal.
  * Radiologist B is placed in View-Only mode, with options to "Request Lock Release" or (if admin) perform a "Force Admin Override".
* **Actual Behavior:** 
  * The lockout interface is fully implemented and gates the workspace.
  * However, if the lock owner drops their connection, the study remains locked for 30 minutes until the stale timeout threshold is met, blocking other users.
* **Data Loss Risk:** Low (Prevented by the view-only lock).
* **Recovery Procedure:** 
  1. The second radiologist can request the lock owner to close their tab.
  2. An administrator can bypass the lock using the "Force Admin Override" button.
* **Severity:** LOW
* **Recommended Improvement:** 
  * Implement active websocket heartbeats for locks so that closing a browser tab immediately releases the lock, rather than waiting for the 30-minute stale timeout.

---

### Scenario 14: Failed AI Generation
* **Expected Behavior:** 
  * If Ollama or the Gemini API is unreachable, the ERP handles the error gracefully.
  * The radiologist is notified via a toast: "AI draft generation failed. You can continue writing manually."
  * The system registers the error in `ai_reporting_audit_logs`.
* **Actual Behavior:** 
  * The draft request hangs for up to 30 seconds before returning a `502 Bad Gateway` error.
  * The editor remains blank or loading, causing user confusion.
* **Data Loss Risk:** None.
* **Recovery Procedure:** 
  1. Verify the AI provider status under settings: `POST /api/ai-reporting/test-provider`.
  2. Switch to a fallback model (e.g., Gemini Cloud instead of local Ollama).
* **Severity:** LOW
* **Recommended Improvement:** 
  * Set the maximum timeout on local Ollama requests to 10 seconds.
  * Fall back to raw dictation features immediately when AI services are offline.

---

### Scenario 15: Browser Session Expiration
* **Expected Behavior:** 
  * After 30 minutes of inactivity, the user session expires.
  * The system displays a warning: "Session expired due to inactivity. Please log in again."
  * Active draft text in the editor is saved to a local scratchpad before redirection to prevent data loss.
* **Actual Behavior:** 
  * The session expires silently.
  * The user is redirected to the login page when they click "Save" or "Finalize".
  * Any unsaved changes in the reporting editor are lost.
* **Data Loss Risk:** HIGH (Loss of finished report content due to sudden session redirection).
* **Recovery Procedure:** 
  1. Log in again.
  2. Manually re-transcribe or re-type the report.
* **Severity:** HIGH
* **Recommended Improvement:** 
  * Save draft revisions to `localStorage` or `sessionStorage` in real-time.
  * Present an in-app overlay dialog to re-enter credentials (re-authenticate) without leaving the workspace page.
