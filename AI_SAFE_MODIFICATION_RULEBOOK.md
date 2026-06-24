# AI-Safe Modification Rulebook: CareDeoghar Hospital ERP

This document serves as the formal boundary reference, safety checklist, and dependency guide for any automated agent or developer attempting modifications on the CareDeoghar Hospital ERP. 

It is designed for direct ingestion by Large Language Models (LLMs) and advanced agentic developer environments. Read this entire document before proposing or executing changes.

---

## 1. Preface for AI Systems (Autonomous Execution Directives)

> [!IMPORTANT]
> **Strict Operational Constraints for LLMs:**
> 1. **Do Not Touch Sandbox Parameters:** Do not edit, bypass, or mock authorization middleware to resolve test failures.
> 2. **Drizzle Schema Alignment:** Any database schema modification must be mapped *both* in Drizzle schema definitions and the production manual patch scripts (`care-db-patch-v2`).
> 3. **Fail-Closed Principle:** All permission gates must fail-closed. If a permission token or role state is undefined or missing, access **must** be denied.
> 4. **No Code Modification During Audit Mode:** If invoked in an audit or diagnostic role, write documentation only.

---

## 2. Tier 1: Files That Should Almost Never Be Touched

The following files represent the core architectural stability, auth boundary, and critical automation paths. Modifications to these files have a high blast radius and require mandatory expert human review.

| File Path | Description | Risk of Modification |
| :--- | :--- | :--- |
| [`artifacts/api-server/src/routes/index.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/index.ts) | Central router mount file. Houses all route-level permission guards (RBAC mapping). | A single error or route misplacement can bypass security for the entire diagnostic ERP, exposing clinical data or ledger details. |
| [`artifacts/api-server/src/middleware/requireStaffAuth.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/middleware/requireStaffAuth.ts) | Staff authentication and authorization validation logic. | Bypassing or introducing logical flaws in this middleware compromises every authenticated endpoint. |
| [`artifacts/api-server/src/lib/pacsArchive.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacsArchive.ts) | Orchestrates the browser-based PDF-to-DICOM rendering & push pipeline via Playwright. | Breakages here will cause radiologist report signatures to complete in ERP but silently fail to push the signed PDF report back into Orthanc/PACS. |
| [`artifacts/api-server/src/lib/payments/PaymentEngine.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/payments/PaymentEngine.ts) | Gateway coordinator orchestrating all 7 payment channels. | Code adjustments can lead to double-charges, webhook processing failures, or race conditions during ledger updates. |
| [`artifacts/diagnostic-erp/src/lib/staffSession.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/lib/staffSession.ts) | Frontend route mapping, `PERMISSIONED_PATHS`, and client-side access control. | Mismatches between this file and backend route guards will create navigation lockouts or allow front-end bypass of restricted pages. |
| [`conquest/erp_notify.lua`](file:///c:/Users/abina/caredeoghar--antigravity/conquest/erp_notify.lua) | Lua script executed by Conquest PACS on image receive/association. | Modifying or removing this breaks study auto-linking to bills, leaving modalities and ERP disconnected. |
| [`docker-compose.yml`](file:///c:/Users/abina/caredeoghar--antigravity/docker-compose.yml) | Service definitions, networking bridges, port assignments, and volume mounts. | Misconfiguring ports (specifically database ports) or volume paths risks permanent data loss, split-brain routing, or bridge-network isolation. |

---

## 3. Critical System Logic & Routes

### A. Critical Routes & Permissions
The following routes must maintain exact authorization gates:
* **Radiology Worklist & Workflows:** `/radiology`, `/usg-*`, `/echo-*`, `/fetal-*`, `/dicom-workflow`, `/smart-radiology`, `/ris-monitor`, `/radiology-workflow`
  * *Required Gate:* `requireStaffPermission("/radiology")`
* **DICOM Server Management:** `/dicom-studies`
  * *Required Gate:* `requireStaffPermission("/dicom-nodes")`
* **Financial Ledger Access:** `/ledgers`
  * *Required Gate:* `requireStaffPermission("/accounting")`
* **Daily Performance Summaries:** `/daily-summary`
  * *Required Gate:* `requireStaffPermission("/reports")`
* **Dangerous Endpoints (Open Relays):**
  * `/samples` - Only has `requireStaffAuth` without sub-permission checks. Extremely sensitive.
  * `/dashboard/my-daily-summary` with `send-email` action - Accepts raw `htmlBody` parameter. **Do not modify to allow external/unauthorized email relaying.**

### B. Critical PACS Logic
* **Accession Number Matching:** The ERP assigns accession numbers using the format `ACC-YYYYMMDD-[Modality]-[Seq]`. The Conquest and Orthanc pipelines rely on this exact format to link received DICOM files with ERP patient bills.
* **Study Lock Engine:** The radiologist report-writing UI locks studies by populating the `locked_by` and `locked_at` columns. The lock automatically expires after 30 minutes. Changing this duration or logic can lead to concurrent edit conflicts or permanent study lockouts.
* **Playwright PDF Generation:** `pacsArchive.ts` launches an headless Chromium instance to render the HTML report and convert it to a DICOM PDF. This requires specific system libraries and Chrome installed inside the Docker image.

### C. Critical Billing & Payment Logic
* **Dual Ledger Entries:** Every finalized bill must generate corresponding double-entry records in the ledger tables. Modifying the payment status without writing matching ledger transactions creates financial discrepancies.
* **Refund Guardrails:** The payment engine prevents refund requests that exceed the original transaction value. Changing the verification sequence can allow duplicate refunds or negative ledger balances.

---

## 4. Database Safety Rules

### A. Critical Database Tables
* `bills` - Single source of truth for hospital revenue.
* `patients` - Central demographics registry. Uniqueness constraints on mobile numbers/MRNs.
* `radiology_studies` - Maps PACS studies (`StudyInstanceUID`) to ERP orders.
* `payments` - Records transaction identifiers, webhook responses, and gateway metadata.
* `portal_sessions` - Session store for active users. Dropping or truncating this log forces logout for all hospital staff.

### B. Dangerous Migrations
* **Adding `NOT NULL` Columns:** Never add a `NOT NULL` column to `bills`, `patients`, `payments`, or `radiology_studies` without providing a concrete default value. Doing so causes Drizzle to crash during startup migration execution on existing production tables.
* **Dropping Unique Constraints:** Do not drop unique constraints on `StudyInstanceUID` or `accession_number`. These fields are key deduplication indexes for incoming HL7/DICOM traffic.
* **Raw SQL Patches:** Always check the `care-db-patch-v2` container configuration. If a column is added via Drizzle, it must also be updated in manual DB patching layers to ensure production parity.

---

## 5. Formal Modification Rules (Condition-Action Gates)

### Rule Set 1: Routes & Authentication
* **If modifying `/routes/index.ts`:**
  * **Always verify:** `requireStaffAuth` and `requireStaffPermission` middleware functions are applied to all new and existing paths.
  * **Always test:** Unauthorized requests receive `401 Unauthorized` or `403 Forbidden` responses.

* **If modifying `requireStaffAuth.ts`:**
  * **Always verify:** The token parsing matches the cookies or Authorization headers sent by both diagnostic-erp and client portals.
  * **Always test:** Session timeout, invalid token signatures, and role-override edge cases fail securely.

* **If modifying `staffSession.ts` (Frontend):**
  * **Always verify:** The `PERMISSIONED_PATHS` map matches backend route structures exactly.
  * **Always test:** Client navigation blocks and redirects users to `/unauthorized` when trying to access restricted modules.

---

### Rule Set 2: PACS & Radiology Workflows
* **If modifying `pacsArchive.ts`:**
  * **Always verify:** The browser instance closes properly (`await browser.close()`) in both success and error handlers to prevent memory leaks.
  * **Always test:** Generated DICOM files are pushed to Orthanc using the correct Modality type (`SR` or `OT`) and matched to the original patient.

* **If modifying `conquest/erp_notify.lua`:**
  * **Always verify:** The `INTERNAL_API_KEY` header is configured correctly and target URLs use the internal bridge network address (`http://100.65.255.115:5000` or Docker service names).
  * **Always test:** Incoming study notifications trigger a status update to `completed` or `draft` in the ERP.

* **If modifying Radiology Study statuses:**
  * **Always verify:** The study's `locked_by` field is cleared when a radiologist navigates away or submits a report.
  * **Always test:** Concurrent edit attempts return a locked status warning to secondary radiologists.

---

### Rule Set 3: Billing & Payments
* **If modifying `PaymentEngine.ts`:**
  * **Always verify:** The transaction status check operates under a database transaction block (`db.transaction`) to prevent double-crediting.
  * **Always test:** Webhook timeouts, partial payments, and failed gateway responses revert/hold order completion statuses.

* **If modifying Bill creation workflows:**
  * **Always verify:** The `generateStudiesForOrder()` helper is triggered immediately to allocate study slots and generate accession numbers.
  * **Always test:** If the patient creation in Orthanc (`dicomPatientCreator`) fails, the bill transaction is rolled back safely.

---

## 6. Hidden Dependencies Directory

The system contains several invisible dependencies that will not show up during static imports or standard code searches:

| Trigger Element | Dependent Target | Mechanism / Protocol | Failure Mode if Broken |
| :--- | :--- | :--- | :--- |
| Bill Creation | Orthanc PACS Patients | REST API calls via `dicomPatientCreator` | Modality worklist gets images but cannot link to patient info. |
| Conquest lua hook | ERP API `/api/pacs/event` | Lua script HTTP POST with `INTERNAL_API_KEY` | DICOM uploads succeed in PACS but studies remain "Scheduled" or invisible in ERP. |
| Dockerfile/Compose | Playwright Engine | Playwright browser download script during build | Report signing crashes API server with "browser not found" error. |
| `.env` Configuration | `ALLOW_PRIVATE_IPS` flag | SSRF Protection Middleware (`providers.ts`) | All ERP-to-Orthanc internal LAN API requests are blocked. |
| Database column creation | `care-db-patch-v2` container | Manual SQL updates vs Drizzle migrations | SQL mismatch during runtime query execution on production database. |
| Modality Workflow | Accession Number Format | String parsing regex in PACS scripts | Scans cannot auto-map to patient records, forcing manual reconciliation. |
| `FULL_ACCESS_ROLES` Set | Staff Permissions Check | Hardcoded Set comparison in `requireStaffAuth.ts` | Bypasses all sub-route checks. Changing role names or names within the Set results in unauthorized administrative access. |

---

## 7. Dangerous Refactor Patterns

Do not attempt the following refactors:
1. **Converting localStorage auth to HTTP-only Cookies:** While safer in theory, the diagnostic ERP client, booking widget, and portal app share state via localStorage keys. Changing to HTTP-only cookies without simultaneously refactoring all sub-domains will break authentication across clinical sites.
2. **Abstracting the Payment Gateways into an async queue:** Delaying bill finalization or payment verification breaks the immediate print requirement at the billing desk. Patients cannot leave with payment receipts.
3. **Consolidating Orthanc and Conquest databases:** Orthanc is used for high-speed local image routing and OHIF viewing; Conquest acts as a legacy bridge for specific modalities. Modifying their respective database schemas or sharing volumes will lead to indexing lockouts.
4. **Moving the `requireStaffPermission` logic to individual routes:** Central routing configuration in `index.ts` is the single source of truth. Dispersing permission guards makes auditing security controls difficult and increases the risk of missing checks.
