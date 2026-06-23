# Care Diagnostics ERP — Technical Debt & Architectural Audit
**Code Quality, Performance Bottlenecks, and Security Remediation Report**

This document registers the results of a comprehensive scan of the Care Diagnostics ERP codebase. It identifies legacy code patterns, structural inefficiencies, security shortcuts, and potential database bottlenecks. Findings are ranked by severity from Critical to Low, with clear cleanup recommendations.

---

## 1. Executive Summary

The Care Diagnostics ERP codebase is fully functional, but contains areas of technical debt, particularly in authorization boundaries, resource-heavy operations (like PDF rendering and generation), and unoptimized database query patterns. Addressing these items is crucial to prevent system performance degradation and data leaks as the clinic scales its operations.

---

## 2. Severity Ranking & Issues Register

| Ref # | severity | Category | Description | Estimated Impact |
| :--- | :---: | :--- | :--- | :--- |
| **TD-01** | **Critical** | Security | Unprotected Daily Summary API (`/daily-summary`) | Financial data exposure |
| **TD-02** | **Critical** | Security | Open Mail Relay in Daily Summary Emailer | SPAM / Phishing / Data Exfiltration |
| **TD-03** | **Critical** | Security | Missing Route Gates on Laboratory Samples (`/samples`) | Unauthorized sample deletions/modifications |
| **TD-04** | **High** | Database / Perf | $O(N)$ Memory Inefficient Patient ID Generation | API server crash under load |
| **TD-05** | **High** | Performance | Headless Browser PDF Generation on Main Thread | Request timeout / high memory footprint |
| **TD-06** | **High** | Security | Unapplied Role Checks in DICOM Study Manager | Lower privilege users managing study links |
| **TD-07** | **Medium** | Security | Billing Mutation Gating Bypasses | Financial fraud / un-audited refunds |
| **TD-08** | **Medium** | Code Quality | Dead Code / Unused Role Verification Helpers | Developer confusion / security gaps |
| **TD-09** | **Low** | Code Quality | Workspace Repository Pollution | Maintenance overhead |

---

## 3. Detailed Audit Findings & Cleanup Recommendations

### TD-01: Unprotected Daily Summary API (`/daily-summary`)
- **Severity**: **Critical**
- **Location**: [daily-summary.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/daily-summary.ts)
- **Description**: The `/daily-summary` router is mounted in `index.ts` with only `requireStaffAuth` and lacks any module permission checks. This endpoint queries the database and returns overall billing aggregates, collections, cash-in-hand figures, expenses, and logs of bill/voucher edits.
- **Estimated Impact**: Any authenticated user (including low-privilege receptionists, technicians, or teleradiology partners) can retrieve the entire clinic’s financial metrics and audits by hitting this route.
- **Cleanup Recommendation**: Apply the `/reports` or `/accounting` permission gate at the route mounting point in `index.ts`:
  ```diff
  - router.use("/daily-summary", requireStaffAuth, dailySummaryRouter);
  + router.use("/daily-summary", requireStaffAuth, requireStaffPermission("/reports"), dailySummaryRouter);
  ```

---

### TD-02: Open Mail Relay in Daily Summary Emailer
- **Severity**: **Critical**
- **Location**: [my-daily-summary.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/my-daily-summary.ts#L20-L56)
- **Description**: The `POST /api/dashboard/my-daily-summary/send-email` endpoint accepts an arbitrary `htmlBody` and `to` address from the request body and forwards it to the SMTP transporter without restricting the content or checking user privileges.
- **Estimated Impact**: A compromised low-privilege staff account (or an attacker exploiting a session) can use the endpoint as an open mail relay to send phishing campaigns, spam, or exfiltrate patient records.
- **Cleanup Recommendation**:
  - Restrict the endpoint using `requireStaffSubPermission("/reports", "export")`.
  - Do not accept arbitrary HTML bodies. Render the email template directly on the server based on database records.

---

### TD-03: Missing Route Gates on Laboratory Samples (`/samples`)
- **Severity**: **Critical**
- **Location**: [samples.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/samples.ts)
- **Description**: The `/samples` router handles the entire lifecycle of lab specimen collection, outsourcing overrides, notes modifications, and deletions. It is mounted using only the outer `requireStaffAuth` gate.
- **Estimated Impact**: Any logged-in staff member can delete specimen records, manipulate outsourcing costs (which affects margins), or prematurely change sample status to complete.
- **Cleanup Recommendation**: Enforce `/tests` or `/orders` module permissions on the router in `index.ts`:
  ```diff
  - router.use("/samples", requireStaffAuth, samplesRouter);
  + router.use("/samples", requireStaffAuth, requireStaffPermission("/tests"), samplesRouter);
  ```

---

### TD-04: $O(N)$ Memory Inefficient Patient ID Generation
- **Severity**: **High**
- **Location**: [patients.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/patients.ts#L23-L48)
- **Description**: The `generatePatientId()` function queries *all* patient records matching prefix `P-%` from PostgreSQL, returns the records to Node, and parses the numerical suffix in a JavaScript loop to find the highest value.
- **Estimated Impact**: Once the database scales to tens of thousands of patients, this query will consume massive memory, stall the event loop, and cause Node out-of-memory (OOM) crashes on new patient registrations.
- **Cleanup Recommendation**: Move suffix extraction to the database level using SQL parsing, or use a dedicated database sequence.
  ```sql
  -- Recommended database sequence-backed resolution
  SELECT nextval('patient_id_seq');
  ```

---

### TD-05: Headless Browser PDF Generation on Main Thread
- **Severity**: **High**
- **Location**: [pacsArchive.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacsArchive.ts#L133-L150)
- **Description**: When a report is finalized, `archiveReportToPacs` launches a Playwright headless Chromium browser instance *synchronously* to render the report HTML and print it to a PDF buffer before uploading it to Orthanc.
- **Estimated Impact**: Headless browsers consume significant CPU and memory. Running this inside the main API process can block the event loop, causing other incoming requests to time out or crash the server.
- **Cleanup Recommendation**: Offload the PDF generation task to a background worker process, or queue it using a job runner (e.g. BullMQ / Redis or a lightweight database job queue).

---

### TD-06: Unapplied Role Checks in DICOM Study Manager
- **Severity**: **High**
- **Location**: [dicomStudyManager.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/dicomStudyManager.ts)
- **Description**: The router defines helper utilities `requireRadiologist` and `requireTechnicianOrAbove`, but never references them on major mutative endpoints (such as `/:id/link`, `/:id/priority`, `/:id/sync-retry`, and `/ai-extractions/:id/review`).
- **Estimated Impact**: Low-privilege users can modify clinical correlations, link studies incorrectly, and alter AI clinical observations without validation.
- **Cleanup Recommendation**: Apply the helper functions as middleware on mutative endpoints:
  ```typescript
  router.post("/:id/link", (req, res, next) => {
    if (!requireTechnicianOrAbove(req)) {
      return res.status(403).json({ error: "Technician role required." });
    }
    next();
  }, linkHandler);
  ```

---

### TD-07: Billing Mutation Gating Bypasses
- **Severity**: **Medium**
- **Location**: [bills.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/bills.ts)
- **Description**: The endpoints for `change-doctor`, `cancel-test`, and `cancel-refund-tests` require the outer `/billing` permission but bypass the specific `billing:edit`, `billing:delete`, or `billing:refund` sub-permissions.
- **Estimated Impact**: A billing user who does not have refund or deletion privileges can still issue partial cancellations and refunds by targeting specific tests.
- **Cleanup Recommendation**: Add sub-permission checks on all mutative routes inside `bills.ts`:
  ```typescript
  billsRouter.post("/:id/cancel-test", requireStaffSubPermission("/billing", "delete"), ...);
  ```

---

### TD-08: Dead Code / Unused Role Verification Helpers
- **Severity**: **Medium**
- **Location**: [dicomStudyManager.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/dicomStudyManager.ts#L54-L60)
- **Description**: Helper functions `requireRadiologist` and `requireTechnicianOrAbove` are declared in the codebase but never referenced, leaving dead code that hides missing permission logic.
- **Estimated Impact**: Increased developer confusion during audits; false sense of security.
- **Cleanup Recommendation**: Apply these helpers to the routes as detailed in TD-06, or clean up the unused declarations.

---

### TD-09: Workspace Repository Pollution
- **Severity**: **Low**
- **Location**: Project Root Directory
- **Description**: The project root contains multiple temporary and backup folders (`backup_pre_gateway`, `backup_pre_refactor`, `restore_point_payment_refactor`) and temporary files (`diff.txt`, `.env---delete`).
- **Estimated Impact**: Increases repository size, slows down grep searches, and complicates deployment packaging.
- **Cleanup Recommendation**: Add these directories to `.gitignore`, or archive and delete old backups.
