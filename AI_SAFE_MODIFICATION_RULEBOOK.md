# AI-Safe Modification Rulebook: CareDeoghar Hospital ERP

This document is a machine-readable and human-verifiable safeguard system for the CareDeoghar Hospital ERP. It serves to protect critical infrastructure—specifically PACS routing, medical billing, clinical reporting, payment gateway channels, user permissions, and deployment containerization.

> [!WARNING]
> **READ-ONLY MANDATE:** Do not write code or run migrations on the live production environment without executing the regression verification suites and safety checklists documented herein.

---

## 1. AI Agent Instruction Block
*Paste this block at the very start of any future LLM or autonomous coding agent session:*

```markdown
You are an AI coding agent tasked with modifying the CareDeoghar Hospital ERP.
Before making ANY changes to the codebase, database schemas, or configs, you MUST:
1. Locate and read: c:\Users\abina\caredeoghar--antigravity\AI_SAFE_MODIFICATION_RULEBOOK.md
2. Identify the risk tier of target files in the 'Top 25 High-Risk Files' registry.
3. Apply the corresponding 'If Modifying X' rule sets.
4. Execute the 'Safe Change Checklist' before proposing code edits.
5. Strictly adhere to the 'Do Not Break' workflows.
Do not modify auth middleware, database fields, or API keys without explicit override approvals.
```

---

## 2. Top 25 "Do Not Break" Workflows

These workflows are the operational foundation of the 24/7 diagnostic center. Any degradation here will disrupt clinical operations.

1. **Patient Registration & MRN Generation:** Unique ID generation sequence (`P-YYYYMMDD-[Seq]`) must not overlap.
2. **Walk-in Booking Checkout:** Bill generation and payment status linking must resolve under 2 seconds.
3. **ICICI Payment Checkout & Callback:** Immediate ledger credit on payment confirmation webhook execution.
4. **Modality Worklist (MWL) Sync:** Scans from modality (USG/Echo) query PACS and matching accession numbers must populate automatically.
5. **Conquest PACS Event Hook:** Automatic study status updates when Conquest invokes the `/api/pacs/event` API.
6. **Orthanc Study Proxy Queries:** Real-time retrieval of WADO images for the embedded DICOM viewer.
7. **OHIF Viewer Launching:** Passing valid StudyInstanceUID tokens to the OHIF container without authorization drops.
8. **Radiologist Study Locking:** Lock creation on study access to prevent concurrent overwrite, with 30-minute auto-expiry.
9. **Report Editor Save Draft:** Automatic local and database draft saving.
10. **Report Digital Signing:** Electronic signature integration with MD5/SHA256 verification hashes.
11. **PDF Report Compilation:** Playwright headless Chromium rendering of signing templates.
12. **DICOM PDF Archival:** Automatic conversion of signed report PDFs to DICOM format and push back to Orthanc PACS.
13. **Outbound WhatsApp Alerts:** Sending notifications containing PDF download links on report finalization.
14. **Patient OTP Verification:** Generating and verifying OTP tokens via the SMS portal.
15. **Patient Portal Download:** Secure PDF download access via authenticated portal sessions.
16. **User Permission Validation:** Restricting `/ledgers` and `/daily-summary` routes to authorized roles only.
17. **Day Close Reconciliation:** Closing daily cashier ledgers and committing balances.
18. **Doctor Commission Calculation:** Commission script computing percentage payouts based on tests completed.
19. **Form-F Record Creation:** Legal documentation of USG/obstetric procedures.
20. **Outsourced Lab Dispatch:** Logging and tracking tests dispatched to third-party labs.
21. **Bank Auto-Reconciliation:** Syncing bank statement records with daily ERP ledger accounts.
22. **Inventory Stock Deductions:** Deducting reagents and equipment cartridges on lab test execution.
23. **Audit Log Generation:** Recording all clinical modifications, payment deletions, and session logs.
24. **System Health Check API:** `/api/system-health` endpoint returning system metrics for status checks.
25. **Database Automated Backups:** Periodic cron-driven replication of the database state.

---

## 3. Top 25 High-Risk Files

| ID | File Path | Risk Level | Primary Function |
| :--- | :--- | :--- | :--- |
| 1 | [`artifacts/api-server/src/routes/index.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/index.ts) | Critical | Central router mount, houses RBAC rules |
| 2 | [`artifacts/api-server/src/middleware/requireStaffAuth.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/middleware/requireStaffAuth.ts) | Critical | Authentication/authorization verification middleware |
| 3 | [`artifacts/api-server/src/lib/pacsArchive.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacsArchive.ts) | Critical | Playwright PDF-to-DICOM push pipeline |
| 4 | [`artifacts/api-server/src/lib/payments/PaymentEngine.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/payments/PaymentEngine.ts) | Critical | Coordinates payment gateways (ICICI/PhonePe etc.) |
| 5 | [`conquest/erp_notify.lua`](file:///c:/Users/abina/caredeoghar--antigravity/conquest/erp_notify.lua) | High | PACS Conquest study hook script |
| 6 | [`docker-compose.yml`](file:///c:/Users/abina/caredeoghar--antigravity/docker-compose.yml) | High | Host orchestrations and network bridges |
| 7 | [`artifacts/diagnostic-erp/src/lib/staffSession.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/lib/staffSession.ts) | High | Client route permissions and session management |
| 8 | [`artifacts/api-server/src/routes/my-daily-summary.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/my-daily-summary.ts) | High | Daily performance email summary generator |
| 9 | [`artifacts/api-server/src/lib/dicomConnectors.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/dicomConnectors.ts) | High | Low-level DIMSE query/retrieve commands |
| 10 | [`artifacts/api-server/src/routes/public-booking.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/public-booking.ts) | High | Public online booking and payment callback endpoints |
| 11 | [`artifacts/api-server/src/routes/whatsapp.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/whatsapp.ts) | High | WhatsApp API notification triggers |
| 12 | [`artifacts/api-server/src/cron.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/cron.ts) | High | Orchestrator for all cron events |
| 13 | [`services/banking/ReconciliationEngine.ts`](file:///c:/Users/abina/caredeoghar--antigravity/services/banking/ReconciliationEngine.ts) | High | Automated bank statement processing |
| 14 | [`services/banking/ICICIBankProvider.ts`](file:///c:/Users/abina/caredeoghar--antigravity/services/banking/ICICIBankProvider.ts) | High | Direct API integration with ICICI banking |
| 15 | [`artifacts/api-server/src/routes/accounting.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/accounting.ts) | High | Ledger updates, commission rule mappings |
| 16 | [`artifacts/api-server/src/routes/patients.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/patients.ts) | High | Patient creation, updates and ID counter logic |
| 17 | [`artifacts/api-server/src/routes/bills.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/bills.ts) | High | Invoice generation, discount validation, dues handling |
| 18 | [`artifacts/api-server/src/routes/radiology.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/radiology.ts) | High | Worklist fetch, study locking, report signing |
| 19 | [`artifacts/api-server/src/routes/samples.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/samples.ts) | Medium | Barcode printing, collection status tracker |
| 20 | [`artifacts/api-server/src/lib/usgExtractor.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/usgExtractor.ts) | Medium | Parses text/measurements from USG modalities |
| 21 | [`artifacts/diagnostic-erp/src/pages/BillingDesk.tsx`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/BillingDesk.tsx) | Medium | Cashier billing interface |
| 22 | [`artifacts/diagnostic-erp/src/pages/RadiologyReportEditor.tsx`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/RadiologyReportEditor.tsx) | Medium | Radiologist reporting editor |
| 23 | [`db/schema.ts`](file:///c:/Users/abina/caredeoghar--antigravity/db/schema.ts) | High | System-wide database definitions |
| 24 | [`deploy-synology.sh`](file:///c:/Users/abina/caredeoghar--antigravity/deploy-synology.sh) | High | Host production deployment script |
| 25 | [`scripts/backup.sh`](file:///c:/Users/abina/caredeoghar--antigravity/scripts/backup.sh) | High | Automated database backup process |

---

## 4. Critical Areas & Safety Documentation

### 1. PACS / Orthanc / DICOM / RNCC
* **File Path:** [`artifacts/api-server/src/lib/pacsArchive.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacsArchive.ts) / [`conquest/erp_notify.lua`](file:///c:/Users/abina/caredeoghar--antigravity/conquest/erp_notify.lua)
* **Purpose:** Ensures imaging data is mapped between modalities, local servers (Conquest/Orthanc), and ERP.
* **Why it is Dangerous:** If modified, incoming patient studies will not match bills, leaving radiologists unable to see or write reports.
* **What can break:** Auto-linking, OHIF viewer loading, report DICOM archiving.
* **Required Tests Before Change:** Confirm Orthanc and Conquest endpoints are reachable.
* **Required Tests After Change:** Trigger a mock study upload and check if status transitions to "Received".
* **Rollback Advice:** Revert to the stable `conquest/erp_notify.lua` backup reference.

---

### 2. Radiology Worklist & Report Editor
* **File Path:** [`artifacts/api-server/src/routes/radiology.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/radiology.ts)
* **Purpose:** Displays studies needing diagnostics; handles locks and status updates.
* **Why it is Dangerous:** Modifying the query or locking mechanism can cause lockups or allow multiple radiologists to edit the same report concurrently.
* **What can break:** Study locking, draft saves, worklist performance.
* **Required Tests Before Change:** Confirm `locked_by` values clear properly on test databases.
* **Required Tests After Change:** Open a study in two separate browsers and verify the lock warning displays.
* **Rollback Advice:** Keep database backups of `radiology_studies` schema structures.

---

### 3. AI Draft Generation & Reporting
* **File Path:** [`artifacts/api-server/src/routes/aiReporting.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/aiReporting.ts)
* **Purpose:** Communicates with Ollama (local) or Gemini (cloud) to draft clinical findings.
* **Why it is Dangerous:** Faulty prompt construction or API timeouts can result in missing medical text drafts.
* **What can break:** Draft population, prompt templates.
* **Required Tests Before Change:** Verify OpenAI / Gemini API key validity and local Ollama server status.
* **Required Tests After Change:** Submit a draft generation request and verify structured findings return.
* **Rollback Advice:** Revert key configurations immediately in `.env` if timeout rates increase.

---

### 4. Billing Desk & Refund/Cancellation Logic
* **File Path:** [`artifacts/api-server/src/routes/bills.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/bills.ts)
* **Purpose:** Handles invoices, line-item pricing, discounts, and cancellations.
* **Why it is Dangerous:** Financial reporting errors can lead to audits failing, cash desk mismatch, and regulatory complications.
* **What can break:** Ledger balances, billing desk checkout, receipt printing.
* **Required Tests Before Change:** Verify double-entry balancing rules in accounting libraries.
* **Required Tests After Change:** Execute mock bills with cash, UPI, and discounts; verify ledger state.
* **Rollback Advice:** Re-run the ledger auditor tool to check for balancing violations.

---

### 5. ICICI Payment Gateway & Future Providers
* **File Path:** [`artifacts/api-server/src/lib/payments/PaymentEngine.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/payments/PaymentEngine.ts)
* **Purpose:** Interfaces with payment gateways to process transactions.
* **Why it is Dangerous:** Minor modifications to payment routes or variables can result in double-charging or unconfirmed payments.
* **What can break:** Checkout routing, transaction validation, callback hooks.
* **Required Tests Before Change:** Use test API credentials for ICICI payment simulation.
* **Required Tests After Change:** Run a mock UPI checkout transaction and verify callback ledger logging.
* **Rollback Advice:** Keep primary gateway provider files separate to allow rapid switching.

---

### 6. User Roles, Permissions & Auth
* **File Path:** [`artifacts/api-server/src/middleware/requireStaffAuth.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/middleware/requireStaffAuth.ts)
* **Purpose:** Controls endpoint access checks.
* **Why it is Dangerous:** Security omissions can expose confidential patient diagnostics or financial ledgers to public paths.
* **What can break:** Route protection, RBAC enforcement.
* **Required Tests Before Change:** Validate staff sessions and roles on dev databases.
* **Required Tests After Change:** Attempt accessing `/api/ledgers` with a non-admin token; verify `403 Forbidden` response.
* **Rollback Advice:** Restrict permissions immediately to basic authorization if routing breaches occur.

---

## 5. Formal Modification Rule Sets

* **If modifying `pacsArchive.ts`:**
  * **Always verify:** Playwright chromium process closes under all outcomes.
  * **Always test:** Signed PDFs translate to DICOM encapsulation formats.
  * **Never change:** Output file structures without matching search keys in Orthanc.

* **If modifying `requireStaffAuth.ts`:**
  * **Always verify:** Token decoders default to "Deny All" if session strings are corrupt.
  * **Always test:** Login session expiry parameters.
  * **Never change:** Authentication cookies config without verifying client-side requests in `staffSession.ts`.

* **If modifying `PaymentEngine.ts`:**
  * **Always verify:** Webhook routes operate with CSRF protection disabled but source IP white-listed.
  * **Always test:** Payment callbacks under slow network scenarios.
  * **Never change:** Transaction status rules without mapping to financial ledger records.

* **If modifying `db/schema.ts`:**
  * **Always verify:** Added columns are either nullable or have default constraints.
  * **Always test:** The migrations execute without errors on test database states.
  * **Never change:** Existing column names without updating Drizzle and the `care-db-patch-v2` scripts.

* **If modifying `deploy-synology.sh`:**
  * **Always verify:** System volume maps point to persistent NAS folders.
  * **Always test:** Container restart behaviors.
  * **Never change:** Port bindings without checking local Cloudflare tunnel configuration routes.

---

## 6. Top 25 Required Regression Tests

1. **Verify Patient ID Sequence:** Validate MRN counter increments correctly.
2. **Verify Search Speeds:** Index scanning for patients on 10,000+ test records.
3. **Verify Auth Middleware:** Block requests lacking authentication tokens.
4. **Verify RBAC Access:** Ensure `/api/ledgers` is blocked for technician roles.
5. **Verify Double Ledger Postings:** Confirm equal debits and credits on checkouts.
6. **Verify Discount Approval PIN:** Apply overriding discount; check for block on invalid PIN.
7. **Verify Dues Settlement:** Update billing balances on partial payments.
8. **Verify Conquest Lua Endpoint:** Push study to mock API; check database response.
9. **Verify Orthanc WADO Query:** Fetch image tags via API proxy.
10. **Verify Study Lock Expiry:** Check if lock clears automatically after 30 minutes.
11. **Verify Concurrent Locking:** Attempt to write to a locked report from a separate test user.
12. **Verify Draft Persistence:** Save report draft; reload page; verify contents match.
13. **Verify Report Signing Hash:** Verify digital signature calculations.
14. **Verify Playwright Render:** Generate report PDF using mock data.
15. **Verify DICOM Encapsulation:** Extract metadata from generated report DICOM files.
16. **Verify WhatsApp Alert Send:** Confirm API call dispatch to Meta/Twilio.
17. **Verify OTP Generation:** Request portal access; check OTP delivery script.
18. **Verify Portal Report Download:** Authenticate patient; retrieve specific signed PDF.
19. **Verify Refund Limits:** Request refund exceeding the original transaction; verify it is blocked.
20. **Verify Form-F Fields:** Save obstetric USG details; check database validations.
21. **Verify Day Close Verification:** Ensure daily summary balances match ledger records.
22. **Verify Commission Script:** Test percentages against diagnostic fees.
23. **Verify Backup Restore Runbook:** Restore dump to a test container; check record integrity.
24. **Verify Health Check API:** `/api/system-health` returns `UP` status.
25. **Verify Rate Limiting:** Run concurrent query loops; verify `429 Too Many Requests` is returned.

---

## 7. Change Verification Checklists

### Safe Change Checklist
- [ ] Create a Git checkpoint/branch before starting.
- [ ] Validate database migration files locally using mock database states.
- [ ] Keep backup schema patches up to date.
- [ ] Confirm internal API endpoints are reachable.
- [ ] Verify permission guards on new route mappings.
- [ ] Ensure all resources and processes close on exit (e.g. databases, browser runners).
- [ ] Document code modifications in local change logs.

### Unsafe Change Examples
* **Unsafe:** Modifying columns in `bills` without updating the `care-db-patch-v2` scripts. *(Result: Database schema mismatch crashes server on startup.)*
* **Unsafe:** Disabling the Playwright timeout settings in `pacsArchive.ts`. *(Result: Unclosed browser instances consume server memory, leading to crashes.)*
* **Unsafe:** Bypassing `requireStaffAuth` during route testing without restoring permissions. *(Result: Exposure of patient record systems.)*

### Emergency Rollback Checklist
- [ ] Roll back Git state immediately using `git reset --hard [Last Known Good Commit]`.
- [ ] Restore database states from recent sql dumps using target restore scripts.
- [ ] Verify routing tunnels are operational.
- [ ] Validate server states via health checks.
- [ ] Re-run regression suites to confirm normal operations.
- [ ] Notify clinical IT desk if downtime persists.
