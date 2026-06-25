# Care Diagnostics ERP — Knowledge Graph
**Purpose:** Machine-readable relationship map for AI systems, future engineers, and automated analysis tools.
**Date:** June 24, 2026 | **Scope:** Full system — modules, APIs, tables, jobs, PACS, billing, payments, AI, users, permissions
**Format:** Every node lists its dependencies and the impact of removing each dependency.

> **For AI systems reading this document:** This is the single canonical map of the Care Diagnostics ERP system. Read this before attempting to answer questions about module relationships, data flows, or impact analysis. Do not assume standard patterns — verify against this document first.

---

## Index of Nodes

| Section | Node | Type |
|---------|------|------|
| §1 | [PostgreSQL Database](#1-postgresql-database) | Infrastructure |
| §2 | [Patient Module](#2-patient-module) | Module |
| §3 | [Billing Module](#3-billing-module) | Module |
| §4 | [Radiology / RIS Module](#4-radiology--ris-module) | Module |
| §5 | [PACS / Orthanc](#5-pacs--orthanc) | External Service |
| §6 | [DICOM Pull Agent](#6-dicom-pull-agent) | Background Job |
| §7 | [Orthanc Auto-Push (Missing)](#7-orthanc-auto-push-gap) | Gap Node |
| §8 | [OHIF Viewer](#8-ohif-viewer) | External Service |
| §9 | [Weasis Viewer](#9-weasis-viewer) | External Service |
| §10 | [Modality Worklist (MWL)](#10-modality-worklist-mwl) | Service / Gap |
| §11 | [Online Booking Module](#11-online-booking-module) | Module |
| §12 | [Payment Gateway Layer](#12-payment-gateway-layer) | External Services |
| §13 | [AI Reporting Engine](#13-ai-reporting-engine) | Module |
| §14 | [Background Job Scheduler (Cron)](#14-background-job-scheduler-cron) | Infrastructure |
| §15 | [Users & Permissions (RBAC)](#15-users--permissions-rbac) | Module |
| §16 | [WhatsApp Notification Module](#16-whatsapp-notification-module) | Module |
| §17 | [Laboratory Module](#17-laboratory-module) | Module |
| §18 | [Accounting & Banking Module](#18-accounting--banking-module) | Module |
| §19 | [Report & PDF Engine](#19-report--pdf-engine) | Service |
| §20 | [Cloudflare Tunnel](#20-cloudflare-tunnel) | Infrastructure |
| §21 | [Tailscale VPN](#21-tailscale-vpn) | Infrastructure |
| §22 | [Synology NAS (Host)](#22-synology-nas-host) | Infrastructure |
| §23 | [Form-F Compliance Module](#23-form-f-compliance-module) | Module |
| §24 | [Full Dependency Impact Matrix](#24-full-dependency-impact-matrix) | Reference |

---

## 1. PostgreSQL Database

**Node ID:** `DB`
**Type:** Infrastructure — Single PostgreSQL 16 instance (`care-db` container)
**Host Port:** `5400` → internal `5432`
**Volume:** `db_data` (Docker named volume on Synology)

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| Docker named volume `db_data` | Synology NAS Docker storage | **Complete data loss.** All patient records, billing, reports, PACS links, user sessions destroyed. Unrecoverable without latest backup. |
| `.env` → `DATABASE_URL` | Deployment config | All containers that connect to PostgreSQL fail to start. ERP goes dark. |
| `care-migrate` container | Drizzle migration runner | Schema is not created on fresh deploy. API crashes with "relation does not exist" errors. |
| `care-db-patch-v2` container | SQL patch scripts | Column additions and schema changes post-migration are not applied. Certain features silently break. |

### Downstream Dependents (everything depends on this)

| Module | Tables Used | Impact if DB Unavailable |
|--------|------------|--------------------------|
| Billing | `bills`, `payments`, `orders`, `bill_audits` | Cannot create bills, accept payments, or print receipts |
| Radiology | `radiology_studies`, `dicom_studies`, `radiology_scheduled_procedures` | Worklist empty; no reports can be written or finalized |
| Patients | `patients`, `portal_sessions` | Cannot register or look up patients; staff login fails |
| PACS/DICOM | `dicom_nodes`, `dicom_pull_jobs`, `pacs_settings` | No PACS node config; pull jobs cannot queue |
| AI Reporting | `radiology_studies.ai_draft`, `radiology_studies.final_report` | No draft storage; completed reports lost |
| Background Jobs | All cron jobs read/write DB | All scheduled jobs fail silently |
| Users/Auth | `users`, `portal_sessions`, `role_permissions` | No one can log in |

---

## 2. Patient Module

**Node ID:** `PATIENT`
**API Routes:** `GET/POST/PATCH /api/patients/*`
**Route File:** `routes/patients.ts`
**Permission Gate:** `requireStaffPermission("/patients")`

### Core Tables

| Table | Purpose |
|-------|---------|
| `patients` | Master patient record (name, phone, DOB, address, UHID) |
| `portal_sessions` (scope=patient) | Patient portal session tokens |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `DB` → `patients` table | PostgreSQL | Cannot create, look up, or update patients. Billing and Radiology cannot initiate. |
| `requireStaffAuth` middleware | Auth system | Patient API becomes unauthenticated — public read/write of all PHI |
| `requireStaffPermission("/patients")` | RBAC middleware | Any authenticated staff can create/edit patients regardless of role |
| Patient ID generator (`P-YYMMDD-NNNN` format) | `patients.ts` service | Sequential ID breaks; duplicates or collisions if O(N) loop is skipped |

### Downstream Dependents

| Module | Dependency Type | Impact if PATIENT removed |
|--------|----------------|--------------------------|
| Billing | FK: `bills.patientId → patients.id` | Cannot create bills without a patient |
| Radiology | FK: `radiology_studies.patientId → patients.id` | No worklist entries; no reports |
| Form-F | FK: `form_f.patientId → patients.id` | Obstetric compliance records cannot be linked |
| WhatsApp | Uses `patients.phone` | Cannot deliver reports or notifications |
| Online Booking | Creates/links patient on booking confirmation | Bookings cannot complete without patient creation |
| DICOM | `dicomPatientCreator` creates Orthanc patient using `patients` row | PACS patient record not created; DICOM archival links break |

---

## 3. Billing Module

**Node ID:** `BILLING`
**API Routes:** `/api/bills`, `/api/payments`, `/api/orders`, `/api/discounts`
**Route Files:** `routes/bills.ts`, `routes/payments.ts`, `routes/orders.ts`
**Permission Gate:** `requireStaffPermission("/billing")` / `requireStaffPermission("/payments")`

### Core Tables

| Table | Purpose |
|-------|---------|
| `bills` | Bill header (totals, status, patient link, created_by) |
| `bill_items` | Line items (test, price, discount per item) |
| `payments` | Payment records (method, amount, recorded_by) |
| `orders` | Test/package order linked to bill |
| `order_items` | Individual tests in an order |
| `bill_audits` | Immutable log of every bill modification |
| `voucher_audits` | Discount voucher usage trail |
| `discount_reasons` | Catalog of approved discount reason codes |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `DB` → bill/payment tables | PostgreSQL | Complete billing failure |
| `PATIENT` module | Patient lookup | Cannot create a bill without a valid patient record |
| `requireStaffPermission("/billing")` | RBAC | Receptionists/lab staff could create or cancel bills |
| Test catalogue (`tests` table) | Lab Module | Cannot add tests to an order; bill items empty |
| Doctor catalogue (`doctors` table) | Doctor management | Referring doctor field blank; commission calculation breaks |
| Accession number generator | `bills.ts` service | Radiology accession tracking breaks; PACS matching fails |
| `generateStudiesForOrder()` | `bills.ts` → `radiology_studies` | Radiology worklist entries not created when radiology test billed |
| `dicomPatientCreator` | PACS service | Orthanc patient record not created; future DICOM archival for this patient fails |

### Downstream Dependents

| Module | Dependency Type | Impact if BILLING removed |
|--------|----------------|--------------------------|
| Radiology | Accession number links `bills → radiology_studies` | No radiology studies can be initiated; worklist empty |
| Accounting | All payments feed `ledgers` and `accounting` | Financial statements inaccurate |
| Online Booking | Booking completion creates a bill | Bookings cannot finalize without billing |
| Report PDF | Bills must exist before reports are finalized | No finalization path without a valid bill |
| Commission Calculation (Cron) | Reads `bills` for doctor commission | Doctor commission emails fail |
| Fraud Detection (Cron) | Reads `bills` and `payments` for anomaly detection | Fraud detection job fails |

---

## 4. Radiology / RIS Module

**Node ID:** `RADIOLOGY`
**API Routes:** `/api/radiology/*`, `/api/dicom-studies/*`, `/api/dicom-workflow/*`, `/api/smart-radiology/*`, `/api/ris-monitor/*`, `/api/radiology-workflow/*`
**Route Files:** `routes/radiology.ts`, `routes/pacsEnterprise.ts`, `routes/dicomStudyManager.ts`, `routes/dicomWorkflow.ts`
**Permission Gate:** `requireStaffPermission("/radiology")` (all sub-routes)

### Core Tables

| Table | Purpose |
|-------|---------|
| `radiology_studies` | Primary RIS record — links bill → study → report → PACS |
| `dicom_studies` | DICOM registry (Phase 9+) — canonical PACS ingestion record |
| `radiology_scheduled_procedures` | MWL entries — procedure scheduled for modality |
| `dicom_nodes` | Modality and PACS node registry (AE titles, IPs, ports) |
| `dicom_pull_jobs` | Queue of pending/running DICOM pull operations |
| `dicom_pull_agent_logs` | Log of each pull attempt |
| `dicom_pull_agent_status` | Current agent status (enabled/disabled/running) |
| `pacs_settings` | Key-value store for PACS and viewer configuration |
| `pacs_logs` | PACS event audit log |
| `radiology_worklist` | Legacy PACS-side worklist (partially superseded by `v_unified_worklist`) |
| `radiology_snippets` | Radiologist text templates |
| `radiology_knowledge` | Structured radiology knowledge base |
| `radiology_annotations` | Image annotation records |
| `radiology_lesions` | Lesion tracking records |
| `radiology_memory` | AI context memory for recurring patients |
| `teaching_cases` | Teaching file library |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `DB` → radiology tables | PostgreSQL | Entire RIS collapses |
| `BILLING` module | Accession number, `radiology_studies` created by `generateStudiesForOrder` | No studies without a bill |
| `PATIENT` module | Patient identity | Studies cannot be linked to patients |
| `PACS / Orthanc` | Image storage and retrieval | Viewers return no images; archival fails |
| `DICOM Pull Agent` | Polls modalities for images | Images never auto-pulled; manual C-STORE from modality only |
| `AI Reporting Engine` | Generates draft reports | No AI assistance; radiologist starts from blank |
| `requireStaffPermission("/radiology")` | RBAC | Any authenticated staff can write clinical reports |
| Playwright / `pacsArchive.ts` | PDF rendering + DICOM SR archival | Finalized reports not archived to PACS; `pacs_archive_status` stuck at pending |
| `Report & PDF Engine` | PDF generation | No printable report; WhatsApp delivery fails |
| Study lock mechanism (DB row lock) | `radiology_studies.locked_by` | Concurrent radiologist editing causes data corruption |

### Downstream Dependents

| Module | Dependency Type | Impact if RADIOLOGY removed |
|--------|----------------|------------------------------|
| PACS / Orthanc | Radiology finalizes and archives SR to Orthanc | PACS never receives encapsulated reports |
| WhatsApp | Report delivery triggered on `REPORT_FINAL` | Patients not notified |
| PDF Engine | Radiology triggers PDF render | No reports generated |
| AI Reporting | Reads `radiology_studies` for context | AI cannot suggest findings without study record |
| Form-F | Links to `radiology_studies` for USG obstetric | Compliance gateway broken |
| USG Extraction (Cron) | Reads study modality from `radiology_studies` | Auto-extraction disabled |

---

## 5. PACS / Orthanc

**Node ID:** `ORTHANC`
**Type:** External Docker service (`care-pacs`)
**LAN IP:** `192.168.1.137:8042` (HTTP/REST/DICOMweb)
**DICOM Port:** `4242` (internal) / `5680` (external host mapping)
**AE Title:** `ORTHANC2` (configured in `pacs_settings`) / `DIAGNOCENTER_PACS` (used as C-MOVE destination in DIMSE agent)
**Auth:** `admin` / *(empty — no password set)*

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| Synology Docker volume (orthanc storage) | NAS `/volume1/docker/orthanc/db/` | All DICOM files permanently lost on container restart |
| `ORTHANC_URL` env var | `.env` | ERP cannot reach Orthanc; all PACS calls fail |
| `ORTHANC_USERNAME` / `ORTHANC_PASSWORD` env | `.env` | Auth failure; all REST calls return 401 |
| `ALLOW_PRIVATE_IPS=true` | `.env` | Docker SSRF guard blocks ERP→Orthanc calls; all PACS features break |
| Synology NAS uptime | Hardware | Orthanc goes offline; imaging workflow stops |
| LAN connectivity | Network | Modalities cannot C-STORE to Orthanc; viewers cannot load images |

### API Integration Points (ERP → Orthanc)

| ERP Action | Orthanc Endpoint Called | Purpose |
|------------|------------------------|---------|
| Billing creates radiology test | `POST /patients` | Create patient record in Orthanc |
| Report finalized | `POST /tools/create-dicom` | Encapsulate PDF as DICOM SR |
| Viewer URL generated | Constructs URL using `OHIF_URL` + StudyInstanceUIDs | Launch OHIF viewer |
| WADO image load | `GET /wado?...` (proxied via `/api/pacs/wado`) | Fetch DICOM pixel data |
| PACS health check | `GET /system` | Verify Orthanc is running |
| Study list | `GET /studies` | List all studies in Orthanc |
| Patient list | `GET /patients` | List all PACS patients |
| DIMSE pull destination | C-MOVE target (AE: `DIAGNOCENTER_PACS`) | Receive pulled studies from modalities |

### Downstream Dependents

| Module | Dependency Type | Impact if ORTHANC removed |
|--------|----------------|--------------------------|
| Radiology | Image storage and retrieval | Viewers show no images; archival fails |
| OHIF Viewer | DICOMweb source | OHIF loads but has no studies |
| Weasis | WADO source | Weasis launches but shows no images |
| DICOM Pull Agent | C-MOVE destination | Pulled studies have nowhere to go |
| Report Archive | `POST /tools/create-dicom` | DICOM SR not created; reports not in PACS |
| pacsArchive | Orthanc REST API | PDF→DICOM pipeline breaks |

---

## 6. DICOM Pull Agent

**Node ID:** `DIMSE_AGENT`
**Type:** Background Service (in-process, `care-api` container)
**File:** `services/dicom-pull-agent/dimse-agent.ts`
**Status:** ⚠️ DISABLED — `ENABLE_DICOM_PULL_AGENT=1` not set in `.env`
**Library:** `dcmjs-dimse`

### Operations Performed

| Operation | Direction | Purpose |
|-----------|-----------|---------|
| C-ECHO | ERP → Modality | Verify DICOM connectivity |
| C-FIND | ERP → Modality | Query available studies on modality |
| C-MOVE | ERP instructs Modality | Pull study from modality to Orthanc |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `ENABLE_DICOM_PULL_AGENT=1` | `.env` | Agent never starts (currently missing) |
| `dicom_nodes` table (DB) | PostgreSQL | No modality addresses to connect to |
| `dicom_pull_jobs` table (DB) | PostgreSQL | Pull queue lost; jobs cannot persist across restarts |
| `ORTHANC` running | care-pacs container | C-MOVE has no destination; pulled images lost |
| LAN connectivity to modalities | Network | C-ECHO/C-FIND/C-MOVE fail; no images retrieved |
| `dcmjs-dimse` npm library | Node.js dependency | DICOM operations unavailable |

### Downstream Dependents

| Module | Dependency Type | Impact if DIMSE_AGENT disabled |
|--------|----------------|-------------------------------|
| Radiology worklist | Studies arrive via pull or modality push | Studies only visible if modality does C-STORE push; worklist may miss exams |
| PACS/Orthanc | Receives images via C-MOVE | Orthanc populated only from modality-initiated pushes |

---

## 7. Orthanc Auto-Push (Gap)

**Node ID:** `ORTHANC_AUTOPUSH`
**Type:** 🔴 MISSING — Not Implemented
**Description:** There is no mechanism for Orthanc to automatically notify the ERP when a new DICOM study arrives. This is a confirmed critical production gap.

### What Should Exist

When a modality does a C-STORE push to Orthanc, Orthanc should trigger a POST to `/api/internal/radiology/studies` with study metadata. This would:
1. Auto-create a `dicom_studies` row
2. Match study to existing `radiology_studies` by accession number
3. Update worklist status to `STUDY_RECEIVED`

### Current Workaround

- The DIMSE Pull Agent (§6) polls modalities periodically — but it is currently **disabled**
- Manual sync from RNCC (Radiology Network Control Center) is the only active path
- If neither is used, studies appear in Orthanc PACS but are **invisible to ERP worklist**

### Impact of this Gap

| Affected Module | Impact |
|-----------------|--------|
| Radiology worklist | Radiologist does not see incoming scans until manual sync |
| USG Auto-Extraction | Not triggered (no `STUDY_RECEIVED` event fires) |
| AI Draft Generation | Not auto-triggered for new studies |
| Modality Worklist status | `STUDY_RECEIVED` state never set automatically |

---

## 8. OHIF Viewer

**Node ID:** `OHIF`
**Type:** External Docker service (`care-ohif`)
**LAN URL:** `http://192.168.1.137:3010`
**Container Port:** `3010`
**Auth:** None (open on LAN)
**Tunnel:** Not exposed externally ✅

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `ORTHANC` running | care-pacs | OHIF loads but all study lists are empty |
| `OHIF_URL` env var | `.env` | ERP cannot construct OHIF viewer launch URL |
| `pacs_settings` → `ohif_base_url` | PostgreSQL | DB-sourced viewer URL overrides env; ⚠️ currently points to Docker bridge IP `172.16.1.139:3000` — wrong |
| LAN access from client workstation | Network | Remote access not possible (not Cloudflare-tunneled) |
| DICOMweb endpoint (Orthanc) | Orthanc REST | OHIF has no image source |

### Downstream Dependents

| Module | Dependency Type | Impact if OHIF removed |
|--------|----------------|------------------------|
| Radiology | Primary web-based DICOM viewer | Radiologists fall back to Weasis desktop only |
| Teleradiology | OHIF embedded in token-gated viewer | Teleradiology share links break |

### Known Issues

- `pacs_settings.ohif_base_url` = `http://172.16.1.139:3000` (Docker bridge IP, wrong port) — **viewer launch currently broken from LAN workstations**
- No ERP session propagated to OHIF; any LAN user can access all images

---

## 9. Weasis Viewer

**Node ID:** `WEASIS`
**Type:** Desktop Java application (client-side)
**Launch:** `weasis://` URI protocol handler
**WADO Source:** `http://192.168.1.137:8042/wado`

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| Weasis installed on client PC | Local installation | Protocol handler not registered; launch URL opens nothing |
| `WADO_URL` env var | `.env` | WADO URL fallback (`ORTHANC_URL/wado`) used; may still work |
| `pacs_settings.wado_uri_base_url` | PostgreSQL | ⚠️ Currently `http://172.16.1.139:8042/wado` — Docker bridge IP — Weasis cannot connect |
| `ORTHANC` running | care-pacs | WADO endpoint unavailable; no images loaded |

### Downstream Dependents

| Module | Dependency Type | Impact if WEASIS removed |
|--------|----------------|--------------------------|
| Radiology | Fallback viewer if OHIF unavailable | Radiologists have only OHIF |

---

## 10. Modality Worklist (MWL)

**Node ID:** `MWL`
**Type:** ⚠️ PARTIALLY IMPLEMENTED — ERP side built; DICOM SCP not deployed

### What is Built (ERP Side)

| Component | Status |
|-----------|--------|
| `radiology_scheduled_procedures` table | ✅ Exists and populated on billing |
| `POST /api/internal/radiology/mwl` | ✅ Returns MWL entries as JSON |
| `GET /api/internal/radiology/structured-mwl` | ✅ Returns structured JSON for a MWL SCP agent |
| MWL fields in `radiology_studies` | ✅ `body_part`, `study_description`, `scheduled_station_ae_title` |

### What is Missing (DICOM SCP Side)

| Component | Status | Impact |
|-----------|--------|--------|
| DICOM MWL SCP container on Synology | ❌ Not deployed | Modalities query MWL SCP via C-FIND — none is running |
| Orthanc MWL Lua plugin | ❌ Not installed | Orthanc cannot serve MWL |
| "Windows MWL SCP Agent" | ❌ Not deployed | The `/structured-mwl` endpoint was designed for this |

### Impact of MWL Gap

| Affected Party | Impact |
|----------------|--------|
| Imaging modality (CT/MRI/USG) | Technicians must manually type patient name and accession number on scanner console |
| Accession number matching | Risk of typos causing DICOM study to fail auto-linking to ERP bill |
| Patient data quality in PACS | DICOM tags may have wrong patient name/ID due to manual entry error |

---

## 11. Online Booking Module

**Node ID:** `ONLINE_BOOKING`
**API Routes:** `/api/public/booking/*` (public), `/api/online-bookings` (staff)
**Route Files:** `routes/public-booking.ts`, `routes/online-bookings.ts`
**Access:** Public booking flow unauthenticated; staff view auth-gated

### Core Tables

| Table | Purpose |
|-------|---------|
| `online_bookings` | Booking record (patient details, test selection, payment status) |
| `booking_payments` | Payment attempt records linked to bookings |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `DB` → `online_bookings` | PostgreSQL | Bookings cannot be stored or retrieved |
| `Payment Gateway Layer` | ICICI/PhonePe/Razorpay/etc. | Payment cannot be initiated; booking stuck at unpaid |
| `PATIENT` module | Patient creation | Confirmed bookings cannot create a patient record |
| `BILLING` module | Bill creation on booking confirmation | Confirmed booking cannot generate bill and token |
| `PUBLIC_BASE_URL` env var | `.env` | Payment return URLs malformed; gateway redirects to wrong URL |
| Rate limiting middleware | Express middleware | Booking endpoint vulnerable to form flooding |
| HMAC/signature verification | Payment gateway provider | Gateway callbacks cannot be authenticated; fake payments accepted |

### Downstream Dependents

| Module | Dependency Type | Impact if ONLINE_BOOKING removed |
|--------|----------------|----------------------------------|
| Patient module | Creates patients from booking | Walk-in bookings from clinic site would require manual staff entry |
| Billing | Auto-generates bills on payment confirm | No revenue from online channel |
| WhatsApp | Sends booking confirmation messages | Patients not notified of booking |
| Payment Gateway | Processes booking payments | Gateway integration purpose removed |

---

## 12. Payment Gateway Layer

**Node ID:** `PAYMENT_GW`
**Type:** Multi-provider external services
**Files:** `lib/payments/PaymentEngine.ts`, `lib/payments/providers/*.ts`

### Active Providers

| Provider | File | Usage |
|----------|------|-------|
| ICICI Orange Pay | `IciciPaymentProvider.ts` | Primary online booking |
| PhonePe | `PhonePePaymentProvider.ts` | Online bookings |
| Razorpay | `RazorpayPaymentProvider.ts` | Online bookings / kiosk |
| PayU | `PayUPaymentProvider.ts` | Online bookings |
| BharatPe | `BharatPePaymentProvider.ts` | Online bookings |
| Cashfree | `CashfreePaymentProvider.ts` | Online bookings |
| HDFC | `HdfcPaymentProvider.ts` | Online bookings |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| Provider API keys (`ICICI_*`, `PHONEPE_*`, etc.) | `.env` | That gateway becomes non-functional; falls back to other providers |
| `PUBLIC_BASE_URL` | `.env` | Return/callback URLs malformed; gateway cannot redirect after payment |
| Internet connectivity from Synology | Network | All payment initiations fail |
| `PaymentEngine.ts` orchestrator | `lib/payments/` | Provider selection and retry logic unavailable |
| HMAC verification logic | Provider files | Fake gateway callbacks accepted; fraudulent bookings confirmed |

### Downstream Dependents

| Module | Dependency Type | Impact if PAYMENT_GW removed |
|--------|----------------|------------------------------|
| Online Booking | Payment initiation | Clinic site bookings require cash-only or offline payment |
| Kiosk | Patient self-pay | Kiosk payment becomes non-functional |
| Banking Auto-Sync | Reads payment records for reconciliation | Reconciliation still works from bank statements |

### Known Risk

No idempotent transaction lock key on payment callbacks. If a gateway times out and retries the callback, the booking may be confirmed twice, creating duplicate patient and billing records.

---

## 13. AI Reporting Engine

**Node ID:** `AI_REPORTING`
**API Routes:** `/api/ai-reporting`, `/api/ai-prompt-templates`, `/api/ai-prompt-library`, `/api/ai-model-routing`, `/api/ai-comparison`, `/api/radiology-ollama`, `/api/radiology-copilot`, `/api/radiology-brain`, `/api/radiology-spine`, `/api/radiology-tumor`, `/api/radiology-lesions`, `/api/radiology-memory`, `/api/radiology-annotations`
**Route Files:** `routes/aiReporting.ts`, `routes/radiologyBrainIntelligence.ts`, `routes/radiologySpineIntelligence.ts`, `routes/radiologyTumorFollowup.ts`, `routes/radiologyOllama.ts`, `routes/radiologyCopilot.ts`, `routes/radiologyLesions.ts`, `routes/radiologyMemory.ts`, `routes/radiologyAnnotations.ts`

### AI Provider Map

| Provider | Env Var | Model Type | Usage |
|----------|---------|-----------|-------|
| Google Gemini | `GEMINI_API_KEY` | Cloud LLM | Primary AI draft generation, smart findings |
| Ollama (local) | `OLLAMA_BASE_URL` | CPU inference | Local draft generation (slow on DS923+) |
| Open WebUI | Port `3000` | UI for Ollama | Staff-facing chat interface |

### Core Tables

| Table | Purpose |
|-------|---------|
| `radiology_studies.ai_draft` | Stored AI-generated draft text |
| `radiology_studies.final_report` | Radiologist-edited finalized report |
| `ai_prompt_templates` | Modality/body-part specific prompt templates |
| `radiology_memory` | AI context memory per patient/study type |
| `radiology_lesions` | Lesion measurements and follow-up data |
| `radiology_annotations` | Image annotation coordinates |
| `teaching_cases` | Teaching file library |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `GEMINI_API_KEY` | `.env` | Gemini-powered suggestions unavailable; falls back to Ollama |
| `OLLAMA_BASE_URL` | `.env` | Local inference unavailable; falls back to Gemini |
| Both AI providers down | External failure | No AI assistance; radiologist types report from scratch |
| `RADIOLOGY` module | `radiology_studies` table | No study context for AI to read |
| `DB` → AI tables | PostgreSQL | Drafts, templates, memory lost |
| `requireStaffAuth` middleware | Auth system | AI endpoints open to unauthenticated callers |
| Internet from Synology | Network | Gemini API calls fail; Ollama still works locally |

### Downstream Dependents

| Module | Dependency Type | Impact if AI_REPORTING removed |
|--------|----------------|-------------------------------|
| Radiology | AI draft population | Radiologists work without AI assistance only |
| USG Extraction | AI-assisted measurement extraction | Manual measurement entry required |
| Teaching Cases | AI analysis of teaching files | Teaching analysis disabled |

---

## 14. Background Job Scheduler (Cron)

**Node ID:** `CRON`
**File:** `artifacts/api-server/src/cron.ts`
**Type:** In-process Node.js scheduler (starts with `care-api`)

### Job Registry

| Job Function | Schedule | Purpose | Tables Read/Written |
|-------------|----------|---------|---------------------|
| `scheduleDaily` | Every minute (fires at configured time) | Daily summary email to admin | `bills`, `payments`, `users` |
| `scheduleMonthEndCommission` | Every minute (fires 20:00 last day of month) | Doctor commission calculation email | `bills`, `doctors`, `orders` |
| `scheduleDicomAutoPull` | Every 5 minutes | Auto-pull DICOM jobs for nodes with `autoPull=true` | `dicom_nodes`, `dicom_pull_jobs` |
| `scheduleMonthlyAudit` | Every minute (fires 06:00 on 1st) | Books sanity money-trail audit | `bills`, `payments`, `accounting` |
| `scheduleBankingAutoSync` | Every 5 minutes | Pull bank transactions, auto-reconcile | `banking_transactions`, `payments` |
| `scheduleFraudDetection` | Every 30 minutes | Run fraud detection engine | `bills`, `payments`, `bill_audits` |
| `scheduleAutomatedBackups` | Every minute (honors job schedule) | Run scheduled backup jobs from DB | `backup_jobs`, filesystem |
| `scheduleSessionIdleSweep` | Every 5 minutes | Expire idle staff sessions | `portal_sessions` |
| `scheduleAuditLogPurge` | Daily at 03:00 | Archive + purge audit logs older than 730 days | `audit_log` |
| DIMSE Pull Agent | Continuous (if `ENABLE_DICOM_PULL_AGENT=1`) | In-process C-FIND/C-MOVE | `dicom_nodes`, `dicom_pull_jobs`, Orthanc |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `care-api` process running | Docker container | All jobs stop |
| `DB` | PostgreSQL | Jobs cannot read config or write results |
| Email / SMTP settings | `email_settings` table | Daily summary and commission emails fail silently |
| `INTERNAL_API_KEY` | `.env` | Internal cron trigger endpoint (`/api/internal/cron`) unauthenticated |
| Banking provider API keys | `.env` per provider | Banking auto-sync fails for that provider |

### Downstream Dependents

| Module | Dependency Type | Impact if CRON disabled |
|--------|----------------|------------------------|
| Billing | Commission job | Doctor commissions not calculated |
| PACS | DICOM pull job | Modality images not pulled automatically |
| Banking | Auto-sync | Manual bank reconciliation only |
| Security | Session sweep | Idle sessions never expire; stale tokens remain valid indefinitely |
| Backups | Automated backup job | Backup dumps not created; data recovery impossible after failure |
| Audit Log | Purge job | Audit log table grows unbounded |

---

## 15. Users & Permissions (RBAC)

**Node ID:** `RBAC`
**API Routes:** `/api/users/*`, `/api/auth/*`
**Route Files:** `routes/users.ts`, `routes/webauthn.ts`
**Tables:** `users`, `role_permissions`, `portal_sessions`

### Role Hierarchy

```
super_admin
    └── admin (FULL_ACCESS_ROLES — bypasses all sub-permission checks)
         └── manager
              ├── radiologist
              ├── billing
              ├── receptionist
              ├── lab
              └── accountant
```

### Permission System Architecture

| Layer | Mechanism | File |
|-------|-----------|------|
| Backend authentication | `requireStaffAuth` — validates Bearer token vs `portal_sessions` | `middleware/requireStaffAuth.ts` |
| Backend authorization | `requireStaffPermission(path)` — checks `users.permissions` JSON array | `middleware/requireStaffAuth.ts` |
| Backend sub-permission | `requireStaffSubPermission(module, action)` | `middleware/requireStaffAuth.ts` |
| Frontend route guard | `PERMISSIONED_PATHS` set + `PERMISSION_ALIASES` map | `lib/staffSession.ts` |
| Admin bypass | `FULL_ACCESS_ROLES = new Set(["admin", "super_admin"])` | `middleware/requireStaffAuth.ts` |

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Staff account (username, PIN hash, role, permissions JSON array, maxDiscount) |
| `role_permissions` | Default permission set per role (used for new user setup) |
| `portal_sessions` | Active session tokens (scope: `staff` or `patient`) |
| `session_audit_log` | Login/logout events |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `DB` → `users`, `portal_sessions` | PostgreSQL | No one can log in; all APIs reject requests |
| `JWT_SECRET` env var | `.env` | Sessions cannot be signed or verified; all tokens invalid |
| `SESSION_SECRET` env var | `.env` | Express session layer breaks |
| `requireStaffAuth` middleware | `middleware/requireStaffAuth.ts` | Every protected route becomes unauthenticated |
| `blockSuperAdminEscalation` guard | `users.ts` | Any admin can promote accounts to super_admin; privilege escalation |
| `PERMISSIONED_PATHS` set | `staffSession.ts` | Client-side route guard has no paths to check; all routes appear accessible |

### Downstream Dependents

Every module depends on RBAC. The following are the highest-impact removals:

| If RBAC Removed | Immediate Impact |
|-----------------|-----------------|
| Authentication fails | System unusable — no one can log in |
| Permission checks removed | All staff can access all modules; PHI exposed |
| Session sweep cron stops | Stale sessions persist indefinitely |
| Admin bypass exists | Compromised admin account = full system compromise |

---

## 16. WhatsApp Notification Module

**Node ID:** `WHATSAPP`
**API Routes:** `/api/whatsapp`, `/api/whatsapp/webhook` (public)
**Route Files:** `routes/whatsapp.ts`, `routes/whatsappWebhook.ts`, `routes/waChatbot.ts`

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `WHATSAPP_API_KEY` | `.env` | WhatsApp API calls fail; no messages sent |
| `PATIENT` module | `patients.phone` | No phone number to send to |
| `RADIOLOGY` module | Report finalization triggers WhatsApp | Report links not delivered to patients |
| `BILLING` module | Bill generation can trigger WhatsApp receipt | Billing notifications stop |
| Internet from Synology | Network | API calls to WhatsApp Business API fail |

### Downstream Dependents

| Module | Dependency Type | Impact if WHATSAPP removed |
|--------|----------------|---------------------------|
| Patient report delivery | Primary delivery mechanism | Patients must physically collect reports |
| Online booking confirmation | Booking confirmation via WhatsApp | Patients not notified of booking |
| WA Chatbot | Depends on WhatsApp webhook | Patient self-service query bot stops |

---

## 17. Laboratory Module

**Node ID:** `LAB`
**API Routes:** `/api/tests`, `/api/samples`, `/api/test-categories`, `/api/outsourced-labs`
**Permission Gates:** `/tests` (mutations), `/samples` (⚠️ `requireStaffAuth` only — no permission gate)

### Core Tables

| Table | Purpose |
|-------|---------|
| `tests` | Test catalogue (name, price, code, reference ranges) |
| `test_categories` | Test category hierarchy |
| `samples` | Specimen collection records |
| `outsourced_labs` | External lab partners for outsourced tests |
| `order_items` | Links orders to tests |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `DB` → lab tables | PostgreSQL | Test catalogue empty; samples cannot be logged |
| `BILLING` module | Tests selected during bill creation | No billing without test catalogue |
| `requireStaffPermission("/tests")` on mutations | RBAC | Any staff can modify test prices and catalogue |
| ⚠️ `/samples` has **no permission gate** | Bug (audit finding P-06) | Any authenticated staff can create/delete lab specimens |

---

## 18. Accounting & Banking Module

**Node ID:** `ACCOUNTING`
**API Routes:** `/api/accounting`, `/api/expenses`, `/api/ledgers`, `/api/banking`
**Permission Gates:** `requireStaffPermission("/accounting")`, `requireStaffPermission("/banking")`

### Core Tables

| Table | Purpose |
|-------|---------|
| `ledgers` | Chart of accounts |
| `accounting_entries` | Double-entry journal |
| `expenses` | Clinic expense records |
| `banking_transactions` | Bank statement transactions |
| `banking_reconciliation` | Auto-matched payment records |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `DB` → accounting tables | PostgreSQL | Financial statements inaccessible |
| `BILLING` module | Payments feed ledger entries | Accounting data becomes incomplete |
| Banking provider API keys | `.env` per bank | Auto-sync fails for that bank |
| `scheduleBankingAutoSync` cron | CRON module | Manual bank statement import only |
| `requireStaffPermission("/accounting")` | RBAC | Any staff can view and modify financial records |

---

## 19. Report & PDF Engine

**Node ID:** `PDF_ENGINE`
**Type:** Service (Playwright headless Chromium)
**File:** `lib/pacsArchive.ts`
**Dependency:** `playwright` npm package + Chromium in Docker container

### Process Flow

```
Radiologist clicks "Finalize & Sign"
    ↓
radiology_studies.status = REPORT_FINAL
    ↓
pacsArchive.ts triggered
    ↓
Playwright launches headless Chromium
    ↓
Loads report HTML (signatures, letterhead, margins)
    ↓
Renders to A4 PDF buffer
    ↓
PDF base64-encoded
    ↓
POST /tools/create-dicom → Orthanc
    ↓
pacs_archive_status = 'archived'
    ↓
PDF stored in object_storage volume
    ↓
Tokenized URL generated → WhatsApp delivery
```

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `playwright` npm package | Docker build | PDF generation fails completely |
| Chromium binary in Docker image | `playwright install chromium` in Dockerfile | Same as above — silent failure |
| `ORTHANC` running | care-pacs | PDF archived to object storage but not pushed to PACS |
| `RADIOLOGY` module | `radiology_studies` for report content | Nothing to render |
| Main Node.js event loop | `care-api` process | ⚠️ Runs **synchronously on main thread** — blocks all API responses during PDF render |
| `object_storage` Docker volume | Synology NAS | PDF files lost on container restart |

### Known Critical Issue

Playwright runs synchronously on the main API event loop. Under concurrent report finalization (multiple radiologists signing simultaneously), the API server becomes unresponsive for all other requests until PDF generation completes.

---

## 20. Cloudflare Tunnel

**Node ID:** `CF_TUNNEL`
**Type:** Docker service (`cloudflared`)
**Exposes:** `caredeoghar.com` → ERP `:8888`, `webui.caredeoghar.com` → Open WebUI `:3000`

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| Cloudflare account active | External (Cloudflare) | Tunnel goes down; remote access breaks |
| `TAILSCALE_AUTH_KEY` or tunnel token | `.env` | Tunnel cannot authenticate |
| `care-api` and `care-web` running | Docker containers | Tunnel has nothing to proxy to |
| Internet uplink from Synology | Network | Tunnel connection drops |

### Downstream Dependents

| Module | Dependency Type | Impact if CF_TUNNEL removed |
|--------|----------------|------------------------------|
| Remote staff access | Primary public URL | Remote staff must use Tailscale VPN direct IP |
| Online booking (clinic-site) | External patient-facing portal | Patient bookings from public internet stop |
| Payment gateway callbacks | Webhooks POST to `caredeoghar.com` | Payment confirmation webhooks fail; online bookings stuck as "unpaid" |
| WhatsApp webhook | Meta posts to `caredeoghar.com` | Incoming WhatsApp messages not received |

---

## 21. Tailscale VPN

**Node ID:** `TAILSCALE`
**Type:** Software-defined VPN mesh
**NAS Tailscale IP:** `100.65.255.115`
**DSM Port:** `5000` (HTTP), `5001` (HTTPS)

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `TAILSCALE_AUTH_KEY` | `.env` | Tailscale cannot authenticate; remote mesh access fails |
| Tailscale service (Package Center) | Synology DSM | VPN mesh not running on NAS |
| Internet uplink | Network | Tailscale relay unavailable; direct connection required |

### Downstream Dependents

| Module | Dependency Type | Impact if TAILSCALE removed |
|--------|----------------|------------------------------|
| Remote radiologist access | OHIF viewer (LAN-only) requires VPN to access from outside | Remote reporting becomes impossible |
| Remote admin access (DSM `5000`) | Admin accesses Synology DSM remotely via Tailscale | Remote NAS management requires physical presence |
| Developer DB access | `psql` at `100.65.255.115:5400` | Remote DB tools cannot connect |

---

## 22. Synology NAS (Host)

**Node ID:** `NAS`
**Model:** Synology DS923+ (confirmed from PACS architecture doc; earlier doc listed DS1522+)
**LAN IP:** `192.168.1.137`
**Tailscale IP:** `100.65.255.115`

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| Physical hardware | On-premise device | Entire system offline; all services unreachable |
| UPS power backup | External UPS unit | Power failure = hard shutdown = potential data corruption |
| Storage volumes | Internal HDDs | All Docker volumes lost; full data loss |
| Internet uplink | ISP | Cloudflare tunnel, payment gateways, Gemini AI, WhatsApp all fail |
| Docker (Container Manager) | DSM package | All containers stop |

### No Redundancy

This is a **single point of failure**. There is no active-passive NAS HA cluster, no warm standby, no automatic failover. Estimated RTO for full NAS hardware failure: 4–8 hours (requires hardware replacement + restore from Hyper Backup).

---

## 23. Form-F Compliance Module

**Node ID:** `FORM_F`
**API Routes:** `/api/form-f`
**Permission Gate:** `requireStaffPermission("/form-f")`
**Regulatory Context:** Government-mandated record for obstetric ultrasound (PC-PNDT Act, India)

### Core Tables

| Table | Purpose |
|-------|---------|
| `form_f_records` | Form-F regulatory submission per USG obstetric study |
| `form_f_ocr_extractions` | OCR-extracted field values from scanned forms |

### Dependencies

| Dependency | Provided By | Impact if Removed |
|------------|------------|-------------------|
| `RADIOLOGY` module | `radiology_studies` for USG obstetric study | Form-F cannot link to imaging study |
| `PATIENT` module | Patient demographics for form | Form cannot identify patient |
| `BILLING` module | Bill confirms USG obstetric was performed | No financial anchor for Form-F |
| `requireStaffPermission("/form-f")` | RBAC | Any staff can create/view/export compliance records |

### Gate Behavior

When a USG obstetric bill is created, the system places a **finalization gate** on the radiology study. The radiologist **cannot finalize** the report until a Form-F record is linked to the study. This is enforced at the API level in `radiology.ts`.

---

## 24. Full Dependency Impact Matrix

This matrix answers: *"If component X is removed, which other components break?"*

| Component Removed | Immediately Breaks | Partially Degrades | No Impact |
|-------------------|-------------------|--------------------|-----------|
| **PostgreSQL DB** | Everything | — | Nothing |
| **care-api process** | Everything | — | Nothing |
| **Orthanc PACS** | Image viewing, PDF archival, DICOM pull destination | Radiology worklist (manual only) | Billing (cash-only mode) |
| **OHIF Viewer** | Web-based image viewing | — | Weasis still works |
| **DICOM Pull Agent** | Automatic image retrieval | — | Modality push (C-STORE) still works |
| **AI Reporting (Gemini)** | Cloud AI drafts | — | Ollama local AI still works |
| **Ollama** | Local AI drafts | — | Gemini still works |
| **Cloudflare Tunnel** | Remote access, online bookings, payment callbacks | — | LAN-only clinic operations continue |
| **Tailscale VPN** | Remote radiologist access to OHIF | — | In-clinic operations continue |
| **Payment Gateway (one)** | That gateway's payment type | — | Other gateways work |
| **All Payment Gateways** | Online booking payments | — | Cash billing continues |
| **WhatsApp** | Patient report delivery, chatbot | — | PDF printing continues |
| **Cron Scheduler** | Auto-backups, session sweeps, bank sync, commission emails | — | Manual operations only |
| **RBAC Middleware** | All authorization; PHI exposed | — | Nothing (total failure) |
| **Playwright/PDF Engine** | PDF reports, PACS archival | — | Online reports still viewable as HTML |
| **MWL SCP (missing)** | Already broken — modalities always manually entered | — | Manual entry workaround in place |
| **Form-F module** | PC-PNDT regulatory compliance | — | All non-obstetric workflows |
| **Synology NAS (hardware)** | Everything | — | Nothing |

---

## 25. Data Flow Summary — End-to-End Patient Journey

```
Patient arrives at clinic
        │
        ▼
[PATIENT MODULE] — create/find patient record
        │
        ▼
[BILLING MODULE] — select tests, apply discount, accept payment
        │ ├── generateStudiesForOrder() → [RADIOLOGY: radiology_studies row created]
        │ └── dicomPatientCreator() → [ORTHANC: patient created in PACS]
        │
        ▼
[RADIOLOGY MODULE] — worklist populated
        │
        ├── [MWL ⚠️ Gap] — Modality should auto-fetch patient from worklist
        │    └── Currently: Technician manually enters patient on scanner
        │
        ├── [MODALITY] — Scan performed → DICOM images generated
        │    │
        │    └─── C-STORE push → [ORTHANC] — images stored
        │                │
        │                └─── [ORTHANC_AUTOPUSH ❌ Gap] — no auto-notify to ERP
        │                     └── Currently: Manual sync or DIMSE Pull Agent (disabled)
        │
        ├── [RADIOLOGY MODULE] — study matched to worklist entry
        │
        ├── [AI REPORTING] — AI draft generated (Gemini or Ollama)
        │
        ├── [RADIOLOGY MODULE] — Radiologist edits and signs report
        │
        ├── [PDF ENGINE] — Playwright renders PDF
        │    │
        │    └── [ORTHANC] — DICOM SR archived
        │
        ├── [WHATSAPP] — patient receives report link
        │
        └── [FORM-F] — obstetric USG compliance record (if applicable)
```

---

*This document is generated from static code and configuration analysis. It is accurate as of June 24, 2026. Dynamic runtime state (e.g., whether Orthanc is actually running, whether the pull agent is actually enabled) must be verified against the live Synology NAS environment. The `docs/LIVE_NETWORK_CONFIGURATION.md` and `RNCC_FINAL_PRODUCTION_VALIDATION.md` documents contain the most recent live-state verification.*
