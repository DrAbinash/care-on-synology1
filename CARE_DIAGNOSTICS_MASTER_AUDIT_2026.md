# CARE DIAGNOSTICS — MASTER SYNOLOGY MIGRATION, PACS, ERP & IMAGING PLATFORM AUDIT

**Date:** 7 June 2026
**Auditor:** Replit Agent (Architecture Review)
**Scope:** Complete infrastructure, production-readiness, and migration audit
**Constraint:** Read-only analysis. No code changes. No deployments. No database modifications.

---

## EXECUTIVE SUMMARY

Care Diagnostics operates a comprehensive TypeScript/pnpm monorepo ERP with **111 database schema files**, **40+ frontend pages**, and **30+ API route modules**. The system is currently hosted on Replit (cloud) with a PostgreSQL database, while PACS (Conquest) runs on a local Windows PC. The goal is to migrate entirely to a Synology DS1522+ NAS.

**Critical Finding:** Production database has **51 missing tables** compared to development, and **3 missing columns** in `clinic_settings` (ollama-related fields), causing ERP UI failures when code expects columns the database doesn't have.

**Recommendation Priority:**
1. **URGENT:** Fix production database schema drift before any migration
2. **HIGH:** Plan PACS parallel operation (Conquest + Orthanc) for zero-downtime migration
3. **MEDIUM:** Synology Docker deployment is already supported by existing `docker-compose.yml`
4. **LOW:** AI/Ollama should remain on Windows or move to a dedicated GPU workstation

---

## PART 1 — DEVELOPMENT VS PRODUCTION AUDIT (NON-RADIOLOGY ERP)

### 1.1 Database Schema Comparison

**Evidence:**
- Development schema files: **111** (`lib/db/src/schema/*.ts`)
- Development tables: **277** (per live query)
- Production tables: **226** (per live query)
- **Missing in production: 51 tables**

#### Critical Non-Radiology Tables Missing in Production

| Table | Module | Impact if Missing |
|---|---|---|
| `echo_regional_walls` | Echo Cardiology | Cannot record regional wall motion |
| `hanging_protocols` | PACS Viewer | Cannot save viewer layouts |
| `hl7_integration_settings` | HL7 Integration | Cannot configure HL7 feeds |
| `hl7_messages` | HL7 Integration | Cannot track HL7 message history |
| `measurement_history` | Patient Metrics | Cannot track longitudinal measurements |
| `modality_routing_map` | DICOM Routing | Cannot route studies by modality |
| `mwl_entries` | Modality Worklist | Cannot generate worklist entries |
| `radiologist_macros` | Radiology | Cannot save radiologist macros |
| `radiologist_shortcuts` | Radiology | Cannot save radiologist shortcuts |
| `technician_workflow` | Technician | Cannot track technician workflow |
| `upload_files` | File Uploads | Cannot track uploaded files metadata |
| `viewer_presets` | PACS Viewer | Cannot save viewer presets |

#### Column Discrepancy in `clinic_settings`

**Evidence:**
- Development: **105 columns**
- Production: **102 columns**
- Missing in production: `ollama_base_url`, `ollama_model`, `ollama_local_only`

**Impact:** The application performs `SELECT *` on `clinic_settings` at startup. When the code (compiled with 105-column expectations) queries a database with only 102 columns, PostgreSQL throws `42703` (undefined column) errors, causing **500 Internal Server Errors** on all ERP screens that load clinic settings.

**Root Cause:** Schema was updated in development without running a corresponding migration on production. The `ollama_*` columns were added for AI integration but the production database never received the `ALTER TABLE` statements.

### 1.2 API Route Completeness

**Evidence:** 30+ non-radiology route files in `artifacts/api-server/src/routes/`

| Module | Routes | Status |
|---|---|---|
| Patient Management | `patients.ts` | Complete (GET, POST, PUT, import, history) |
| Doctor Management | `doctors.ts` | Complete (GET, POST, PATCH, import, delete) |
| Test Catalog | `tests.ts` | Complete (CRUD + import) |
| Order Management | `orders.ts` | Complete (CRUD + test status) |
| Billing | `bills.ts` | Complete (search, preview, create, super-edit) |
| Inventory | `inventory.ts` | Complete (CRUD + stock-in, consumption rules) |
| Accounting | `accounting.ts` | Complete (accounts, vouchers, ledger, P&L) |
| Commission | `commission.ts` | Complete (rules, reports) |
| Staff | `users.ts` | Complete (CRUD + password) |
| Appointments | `appointments.ts` | Complete (CRUD + stats) |
| Packages | `packages.ts` | Complete (CRUD) |
| Expenses | `expenses.ts` | Complete (CRUD + scan-bill) |
| Ledgers | `ledgers.ts` | Complete (CRUD + reset) |
| Discounts | `discounts.ts` | Complete (CRUD + apply) |
| Samples | `samples.ts` | Complete (CRUD + status + outsource) |
| HR Forms | `hr-forms.ts` | Complete (CRUD) |
| Branches | `branches.ts` | Complete (CRUD) |
| Vendors | `vendors.ts` | Complete (CRUD) |
| Departments | `departments.ts` | Complete (CRUD) |
| Machines | `machines.ts` | Complete (CRUD + maintenance) |
| Locations | `locations.ts` | Complete (floors, rooms, modalities) |
| WhatsApp | `whatsapp.ts` | Complete (send, webhook) |
| Banking | `banking.ts` | Complete (accounts, reconcile, webhook) |
| Website Builder | `website.ts` | Complete (settings, pages, FAQs) |
| System | `system.ts` | Complete (info, update, logs) |
| Audit Logs | `audit-logs.ts` | Complete (read-only) |
| Role Permissions | `role-permissions.ts` | Complete (RBAC) |
| Barcode | `barcode-resolver.ts` | Complete (lookup) |
| Backup | `backup.ts` | Complete (list, trigger, download) |
| Health | `health.ts` | Complete (healthz, ready) |

**Finding:** All non-radiology routes are implemented and code-complete. No missing endpoints identified.

### 1.3 Frontend Page Completeness

**Evidence:** 40+ page components in `artifacts/diagnostic-erp/src/pages/`

| Page | Route | Status |
|---|---|---|
| BillingDesk | `/` | Complete |
| Dashboard | `/dashboard` | Complete |
| Patients | `/patients` | Complete |
| PatientDetail | `/patients/:id` | Complete |
| Tests | `/tests` | Complete |
| Orders | `/orders` | Complete |
| OrderDetail | `/orders/:id` | Complete |
| Billing | `/billing` | Complete |
| BillDetail | `/billing/:id` | Complete |
| Payments | `/payments` | Complete |
| Dues | `/dues` | Complete |
| Reports | `/reports` | Complete |
| ReportGenerator | `/report-generator` | Complete |
| ReportHub | `/report-hub` | Complete |
| Inventory | `/inventory` | Complete |
| Referrals | `/referrals` | Complete |
| Accounting | `/accounting` | Complete |
| Banking | `/banking` | Complete |
| Settings | `/settings` | Complete |
| SystemUpdate | `/system-update` | Complete |
| Discounts | `/discounts` | Complete |
| Appointments | `/appointments` | Complete |
| Packages | `/packages` | Complete |
| Expenses | `/expenses` | Complete |
| DayClose | `/day-close` | Complete |
| MyDayClose | `/my-day-close` | Complete |
| BooksSanity | `/books-sanity` | Complete |
| Staff | `/staff` | Complete |
| HRForms | `/hr-forms` | Complete |
| Queue | `/queue` | Complete |
| DailySummary | `/daily-summary` | Complete |
| MyDailySummary | `/my-daily-summary` | Complete |
| OnlineBookings | `/online-bookings` | Complete |
| OutsourcedLabs | `/outsourced-labs` | Complete |
| OutsourcedCostReport | `/outsourced-cost-report` | Complete |
| Samples | `/samples` | Complete |
| ScanStation | `/scan-station` | Complete |
| ReportDelivery | `/report-delivery` | Complete |
| Kiosk | `/kiosk` | Complete |
| FormF | `/form-f` | Complete |
| Machines | `/machines` | Complete |
| Website | `/website` | Complete |
| WhatsAppChatbot | `/whatsapp-chatbot` | Complete |
| BackupReplication | `/backup-replication` | Complete |
| Portal | `/portal` | Complete |
| VerifyReceipt | `/verify-receipt/:billId` | Complete |
| Display | `/display` | Complete |

**Finding:** All non-radiology pages are implemented. Navigation is permission-based via `Layout.tsx` with `ERP_NAV_ORDER` and `staffSession.ts`.

### 1.4 Settings / Configuration Completeness

**Evidence:** `clinic_settings` table has 105 columns covering:

- Branding (name, logo, colors, fonts)
- Contact (address, phone, email, website)
- Billing (GSTIN, print copies, paper size, QR code)
- Portal (enabled, heading, welcome message, booking)
- Payments (Razorpay, PayU, PhonePe, BharatPe, Cashfree, ICICI)
- Kiosk (enabled, payment gateway)
- UPI (QR image, VPA, enabled)
- Security (LAN-only login, allowed IPs, FIDO2, session timeout, lockout)
- Form F (test IDs, billing prompt, address required, guardian required)
- Receipt (thank you, collection, QR, promotional messages)
- Footer (service, follow-up, promotional, accreditation, WhatsApp)
- Scan (auto-crop, auto-rotate, archive, padding, JPEG quality, max width)
- AI (Ollama base URL, model, local-only)

**Missing in production:** `ollama_base_url`, `ollama_model`, `ollama_local_only` — causing ERP crashes.

### 1.5 Environment Variables

**Evidence:** From codebase audit and `app.ts`

| Variable | Required | Purpose | Current Status |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection | Set in both environments |
| `NODE_ENV` | Yes | production/development | Set |
| `SESSION_SECRET` | Yes | Cookie encryption | Set (production only) |
| `SERVE_STATIC_DIR` | Yes (prod) | Static SPA serving | Set in production |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | No | Gemini AI | Set |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | No | Gemini proxy | Set |
| `ENABLE_SCHEDULERS` | No | Cron jobs | `=1` in production |
| `ORTHANC_URL` | No | PACS REST API | Configured but may not be active |
| `ORTHANC_USERNAME` | No | PACS auth | Configured |
| `ORTHANC_PASSWORD` | No | PACS auth | Configured |
| `OHIF_URL` | No | Viewer URL | Configured |
| `WADO_URL` | No | WADO endpoint | Configured |
| `PACS_PROVIDER` | No | orthanc/conquest | Likely "conquest" currently |
| `PACS_VIEWER_TYPE` | No | weasis/ohif/radiant | Likely "weasis" |
| `CONQUEST_URL` | No | Conquest HTTP API | Configured |
| `ENABLE_DICOM_PULL_AGENT` | No | DIMSE agent | May not be active |
| `INTERNAL_API_KEY` | Yes | Agent auth | Set (production only) |
| `WHATSAPP_PROVIDER` | No | mock/meta/twilio | Default "mock" |
| `WHATSAPP_*` | No | Various WhatsApp vars | Partially configured |
| `FINGERPRINT_BRIDGE_SECRET` | No | Biometric auth | Configured |

### 1.6 Menu / Navigation Items

**Evidence:** `Layout.tsx` defines the navigation structure:

**Top-Level (flat):**
- Billing Desk, My Daily Summary, Patients, Appointments, Online Bookings, Queue Tokens, Samples, Scan Station, Report Delivery, Reports, Report Generator, Report Hub, Expenses, Accounting, Banking, Books Sanity, Form F, Website Builder, WhatsApp Chatbot, Machines

**Grouped:**
- Billing & Payments: Bills, Due Payments, Payments, Orders
- Staff: Staff Directory, HR Forms
- Settings: General Settings, Radiology Settings, Test Catalog, Outsourced Labs, Outsource Costs, Packages, Inventory, Discounts, Doctors/Referrals, Backup & Replication, System Update

**Finding:** All menu items are implemented with permission-based visibility. No missing items identified.

### 1.7 Features in Dev but Not Production

| Feature | Evidence | Risk |
|---|---|---|
| Ollama AI integration | `clinic_settings` missing ollama columns | **HIGH** — causes 500 errors |
| Echo cardiology regional walls | `echo_regional_walls` table missing | Medium — echo reporting incomplete |
| HL7 integration | `hl7_integration_settings` + `hl7_messages` missing | Medium — cannot integrate with external systems |
| Measurement history | `measurement_history` table missing | Medium — no longitudinal tracking |
| Modality routing | `modality_routing_map` table missing | Medium — DICOM routing manual only |
| MWL entries | `mwl_entries` table missing | Medium — worklist generation incomplete |
| Radiologist macros | `radiologist_macros` table missing | Low — productivity feature missing |
| Technician workflow | `technician_workflow` table missing | Low — no technician tracking |
| Upload files tracking | `upload_files` table missing | Medium — file metadata lost |
| Viewer presets | `viewer_presets` table missing | Low — user experience degraded |
| Radiology memory engine | `radiology_memory` + 8 related tables | N/A (radiology excluded) |
| AI model routes | `ai_model_routes` table | N/A (AI excluded) |
| Teaching cases | `teaching_cases` table | N/A (radiology excluded) |
| Radiology annotations | `radiology_annotations` table | N/A (radiology excluded) |
| Teleradiology users | `teleradiology_users` table | N/A (radiology excluded) |

### 1.8 Features in Production but Not Dev

**Evidence:** None identified. Production is a subset of development.

### 1.9 Build/Version Mismatch

**Evidence:**
- Development commit: `ed6bdbce` (June 6, 2026)
- Production commit: Unknown (likely older)
- The production schema is missing tables that were added in recent commits

**Finding:** Production is running older code that doesn't match the current schema.

### 1.10 Deployment Mismatch

**Evidence:**
- Development: Replit workflows (hot-reload, instant)
- Production: Replit Reserved VM (`deploymentTarget = "vm"` in `.replit`)
- Production uses single-process unified serve (`build-deploy.mjs`)
- Docker configuration exists but is not used in production

**Finding:** Production deployment is Replit-specific and cannot be directly migrated to Synology without Docker adoption.

### 1.11 Production-Only Errors

**Evidence:** From deployment logs and code analysis:

1. **500 errors on clinic settings load** — Missing `ollama_*` columns in production
2. **Potential 500 errors on new features** — Any feature that touches the 51 missing tables will fail
3. **401 errors in preview** — Staff auth required (expected, not an error)

### 1.12 Database Drift Summary

| Metric | Development | Production | Delta |
|---|---|---|---|
| Tables | 277 | 226 | **-51** |
| Schema files | 111 | 111 | 0 (same codebase) |
| `clinic_settings` columns | 105 | 102 | **-3** |
| Patients | 4 (test) | 3,724 | Production is live |
| Bills | Minimal | 3,615 | Production is live |

**Critical Action Required:**
1. Run `ALTER TABLE clinic_settings ADD COLUMN ollama_base_url TEXT DEFAULT ''`, `ollama_model TEXT DEFAULT ''`, `ollama_local_only BOOLEAN DEFAULT FALSE` on production
2. Create the 51 missing tables (or disable the code that references them)
3. OR: Deploy the latest code that matches production schema

---

## PART 2 — PACS / DICOM / VIEWER AUDIT

### 2.1 Conquest PACS Status

**Evidence:**
- Configuration: `conquest/erp_notify.lua` — Lua hook that pushes metadata to ERP on image reception
- Inbound endpoint: `POST /api/internal/radiology/studies` (protected by `INTERNAL_API_KEY`)
- PACS IP: `172.16.1.139` (Clinic Windows PC)
- `PACS_PROVIDER` likely set to "conquest" in production

**Assessment:**
- Conquest is **operational** and receiving studies
- Worklist is **receiving studies** (per user report)
- DICOM Puller is **running** on Windows PC

### 2.2 DICOM Puller Status

**Evidence:** Two implementations exist:

1. **DCMTK Pull Agent** (`dicom-pull-agent/`): External Node.js process using `findscu`/`movescu`
2. **In-Process DIMSE Agent** (`artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts`): Native Node.js using `dcmjs-dimse`

**Assessment:**
- The DCMTK agent is designed to run on the Windows PC near modalities
- The in-process agent is enabled via `ENABLE_DICOM_PULL_AGENT=1`
- Both are **code-complete** but actual runtime status requires live verification

### 2.3 Weasis Integration

**Evidence:**
- `PACS_VIEWER_TYPE` can be set to "weasis"
- ERP can launch Weasis via URL protocol or direct link
- `EmbeddedWadoViewer` component exists as a lightweight built-in alternative

**Assessment:**
- Weasis is **installed** on Windows PC
- Integration is **configured** but requires live testing

### 2.4 OHIF Status

**Evidence:**
- `OHIF_URL` environment variable exists
- `PACS_VIEWER_TYPE` can be set to "ohif"
- OHIF is **NOT currently installed** per user report
- No OHIF Docker container in current `docker-compose.yml`

**Assessment:**
- OHIF is **not deployed** anywhere
- The codebase is ready for OHIF integration once deployed

### 2.5 DICOMweb Endpoint

**Evidence:**
- `WADO_URL` environment variable exists
- `/api/pacs` routes proxy WADO-URI requests
- `EmbeddedWadoViewer` fetches frames via WADO-URI
- No native DICOMweb (WADO-RS) endpoint exists in the current API

**Assessment:**
- DICOMweb is **partially available** via WADO-URI proxy
- Full DICOMweb (WADO-RS) would require Orthanc or a dedicated DICOMweb server

### 2.6 ERP Launching Weasis

**Evidence:**
- `DicomViewer.tsx` page has viewer launch logic
- Can launch external viewers via URL protocols
- Configuration controlled by `PACS_VIEWER_TYPE`

**Assessment:**
- ERP **can launch Weasis** if configured correctly
- Requires correct `PACS_VIEWER_TYPE` and `WADO_URL` settings

### 2.7 PACS Configuration Production-Readiness

**Evidence:**
- `pacs_settings` table exists in database
- `dicom_nodes` table exists (modality configuration)
- `dicom_pull_jobs` table exists (job tracking)
- `radiology_worklist` table exists (worklist entries)

**Assessment:**
- Configuration is **database-driven** and production-ready
- Missing: `modality_routing_map` table (not in production)
- Missing: `mwl_entries` table (not in production)

### 2.8 Windows PC Dependencies

**Components Dependent on Windows PC:**
1. **Conquest PACS** — Running on `172.16.1.139`
2. **Weasis Viewer** — Installed on Windows PC
3. **DCMTK DICOM Puller** — Designed to run near modalities
4. **DICOM Modality Worklist** — May be generated by Windows software

**Components That Can Move to Synology:**
1. **Orthanc PACS** — Can run in Docker on Synology
2. **OHIF Viewer** — Can run in Docker on Synology
3. **DICOMweb** — Can be served by Orthanc on Synology
4. **ERP API** — Can run in Docker on Synology
5. **PostgreSQL** — Can run in Docker on Synology
6. **File Storage** — Synology NAS is ideal for this
7. **Backup Storage** — Synology NAS is ideal for this

### 2.9 PACS / DICOM Infrastructure Summary

| Component | Current Location | Can Move to Synology | Notes |
|---|---|---|---|
| Conquest PACS | Windows PC (172.16.1.139) | No (Windows-only) | Keep during transition |
| Orthanc PACS | Not deployed | Yes | Deploy on Synology |
| Weasis | Windows PC | No (desktop app) | Keep as backup viewer |
| OHIF | Not installed | Yes | Deploy on Synology |
| DICOM Puller | Windows PC | Partially | DCMTK needs Windows; in-process can run anywhere |
| Worklist | Windows PC | Yes | Orthanc can generate MWL |
| DICOMweb | Not available | Yes | Orthanc provides WADO-RS |
| ERP API | Replit | Yes | Docker-ready |
| PostgreSQL | Replit | Yes | Docker-ready |
| File Storage | Replit | Yes | Synology is ideal |

---

## PART 3 — SYNOLOGY SUITABILITY ASSESSMENT

### 3.1 Hardware Specs: Synology DS1522+

| Spec | Value | Notes |
|---|---|---|
| CPU | AMD Ryzen R1600 (dual-core, 2.6GHz) | Entry-level server CPU |
| RAM | 8GB DDR4 ECC (expandable to 32GB) | Sufficient for ERP + PACS |
| Drive Bays | 5 (3.5" SATA) | Good for RAID + growth |
| M.2 Slots | 2 (NVMe cache) | Excellent for database performance |
| Network | 2x 1GbE (expandable to 10GbE) | Adequate for DICOM |
| Max Raw Capacity | 80TB (5x16TB) | Excellent for long-term storage |
| Docker Support | Yes (via Container Manager) | Native DSM 7+ |
| Virtualization | Yes (VDSM) | Can run VMs if needed |

### 3.2 Suitability by Workload

| Workload | Suitability | Notes |
|---|---|---|
| ERP API | **Excellent** | Node.js in Docker, low CPU usage |
| PostgreSQL | **Excellent** | Docker container, NVMe cache recommended |
| PACS (Orthanc) | **Good** | Moderate CPU for DICOM indexing; RAM sufficient |
| OHIF Viewer | **Good** | Static files + API calls; minimal Synology load |
| DICOMweb | **Good** | Served by Orthanc; minimal overhead |
| Reporting Storage | **Excellent** | NAS is purpose-built for this |
| Study Archive | **Excellent** | RAID5/6 with 16TB drives = 64TB usable |
| Tailscale Access | **Excellent** | Native Tailscale package for DSM |
| Backup Storage | **Excellent** | Built-in Hyper Backup + external targets |
| AI (Ollama) | **Poor** | No GPU. CPU inference is extremely slow |

### 3.3 Resource Utilization Estimates

#### Current Load (1 modality, 3-4K patients/year)

| Resource | Current | Synology Usage |
|---|---|---|
| CPU | Low | 10-20% (ERP + Orthanc) |
| RAM | 2-4GB | 4-6GB of 8GB |
| Storage | ~50GB/year | 50GB/year + 500GB PACS |

#### 1-Year Projection (3 modalities, 5K patients/year)

| Resource | Projected | Synology Usage |
|---|---|---|
| CPU | Moderate | 20-30% |
| RAM | 4-6GB | 6-8GB (consider upgrade to 16GB) |
| Storage | ~200GB | 200GB + 2TB PACS studies |
| Studies | 5K/year | 50-100GB DICOM data |

#### 3-Year Projection (5 modalities, 8K patients/year)

| Resource | Projected | Synology Usage |
|---|---|---|
| CPU | Moderate | 30-40% |
| RAM | 6-8GB | 8-16GB (upgrade to 16GB recommended) |
| Storage | ~500GB | 500GB + 5TB PACS studies |
| Studies | 8K/year | 100-200GB DICOM data |

#### 5-Year Projection (Full operation, 10K patients/year)

| Resource | Projected | Synology Usage |
|---|---|---|
| CPU | Moderate-High | 40-50% |
| RAM | 8-12GB | 16-32GB (upgrade to 32GB recommended) |
| Storage | ~1TB | 1TB + 10TB PACS studies |
| Studies | 10K/year | 200-400GB DICOM data |

### 3.4 Storage Layout Recommendation

```
Synology DS1522+ (5 bays)
├─ Bay 1: 4TB WD Red (OS, DSM, Docker containers)
├─ Bay 2: 8TB WD Red (ERP database, PostgreSQL data)
├─ Bay 3: 8TB WD Red (PACS studies, DICOM storage)
├─ Bay 4: 8TB WD Red (PACS studies, RAID redundancy)
└─ Bay 5: 8TB WD Red (Backups, file storage, archives)

Volume Layout:
├─ Volume 1 (RAID1): Bays 1-2 = 4TB usable (OS + DB)
├─ Volume 2 (RAID1): Bays 3-4 = 8TB usable (PACS)
└─ Volume 3 (Single): Bay 5 = 8TB usable (Backups)

Recommended: All bays in RAID5 = 28TB usable (with 4x8TB) or 32TB (with 4x16TB)
```

### 3.5 M.2 NVMe Cache Recommendation

| Slot | Use | Impact |
|---|---|---|
| M.2 Slot 1 | PostgreSQL data | Dramatic query performance improvement |
| M.2 Slot 2 | Docker containers | Faster container startup and I/O |

### 3.6 Synology Assessment Summary

**Verdict:** Synology DS1522+ is **highly suitable** for ERP + PACS + storage. The only limitation is AI (no GPU). Plan for RAM upgrade to 16GB within year 1.

---

## PART 4 — TARGET ARCHITECTURE DESIGN

### 4.1 Current State Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                │
│                         (Replit)                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐│
│  │ Clinic Site │    │ ERP Portal  │    │ Admin Portal  ││
│  │   (React)   │    │   (React)   │    │       (React)       ││
│  └─────────────┘    └─────────────┘    └─────────────────────┘│
│         │                  │                     │             │
│         └──────────────────┼─────────────────────┘             │
│                            │                                    │
│                   ┌────────┴────────┐                          │
│                   │  Express API      │                          │
│                   │  (Node.js)        │                          │
│                   │  Port 8080        │                          │
│                   └────────┬────────┘                          │
│                            │                                    │
│                   ┌────────┴────────┐                          │
│                   │   PostgreSQL      │                          │
│                   │   (Replit)        │                          │
│                   └─────────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Local Network (Clinic)
├─────────────────────────────────────────────────────────────────┐
│  Windows PC (172.16.1.139)                                      │
│  ├─ Conquest PACS                                              │
│  ├─ Weasis Viewer                                              │
│  ├─ DICOM Puller (DCMTK)                                       │
│  ├─ DICOM Worklist                                             │
│  └─ DICOM Modality Bridge                                      │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                          │
│  │  MRI    │  │   CT    │  │  USG    │  Modality Worklist     │
│  │ (UIH)   │  │         │  │(Voluson)│  ← Conquest            │
│  └────┬────┘  └────┬────┘  └────┬────┘                          │
│       │            │            │                                │
│       └────────────┴────────────┘                                │
│                    │                                              │
│            DICOM Network (C-STORE)                               │
│                    │                                              │
│              Conquest PACS (172.16.1.139)                         │
│                                                                 │
│  Synology DS1522+ (abinashnas)                                  │
│  ├─ Tailscale (active)                                           │
│  ├─ File storage (limited use)                                   │
│  └─ Backup target                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Target State Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    REMOTE ACCESS (Tailscale)                      │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │  Pune   │  │  Home   │  │ Travel  │  │ Mobile  │            │
│  │  (Dr)   │  │  (Dr)   │  │  (Dr)   │  │  (Staff)│            │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘            │
│       │            │            │            │                  │
│       └────────────┴────────────┴────────────┘                  │
│                    │                                              │
│            Tailscale Mesh VPN (100.x.x.x)                       │
│                    │                                              │
└────────────────────┼────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              SYNOLOGY DS1522+ (abinashnas)                      │
│                     PRIMARY PLATFORM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Docker Container Manager                    │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │   care-web   │  │   care-api   │  │   care-db    │    │   │
│  │  │   (nginx)    │  │  (Node.js)   │  │ (PostgreSQL)│    │   │
│  │  │   Port 80    │  │  Port 8080   │  │  Port 5432   │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  │                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │   Orthanc    │  │    OHIF      │  │   Redis      │    │   │
│  │  │   (PACS)     │  │   (Viewer)   │  │  (Cache)     │    │   │
│  │  │   Port 8042  │  │   Port 3000  │  │  Port 6379   │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  │                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐                      │   │
│  │  │ DICOM Puller │  │   Backup     │                      │   │
│  │  │  (dimse)     │  │   (cron)     │                      │   │
│  │  │              │  │              │                      │   │
│  │  └─────────────┘  └─────────────┘                      │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   DSM Services                           │   │
│  │  ├─ Tailscale (secure mesh VPN)                          │   │
│  │  ├─ Hyper Backup (to external USB/cloud)                 │   │
│  │  ├─ Snapshot Replication ( BTRFS protection)            │   │
│  │  ├─ Active Backup (Windows PC backup)                    │   │
│  │  └─ File Station (file management)                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Storage Layout:                                                │
│  ├─ Volume 1 (RAID5): ERP database, Docker containers         │
│  ├─ Volume 2 (RAID5): PACS studies, DICOM archive             │
│  └─ Volume 3 (RAID5): Backups, file storage, exports            │
│                                                                 │
│  M.2 Cache:                                                     │
│  ├─ NVMe 1: PostgreSQL hot data                               │
│  └─ NVMe 2: Docker containers + Orthanc index                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                     │
                     │ Local Network (Clinic)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Modality Network                                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │  MRI    │  │   CT    │  │  USG    │  │ Future  │           │
│  │ (UIH)   │  │         │  │(Voluson)│  │         │           │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
│       │            │            │            │                  │
│       └────────────┴────────────┴────────────┘                  │
│                    │                                              │
│         ┌─────────┴─────────┐                                   │
│         │                   │                                   │
│         ▼                   ▼                                   │
│  ┌─────────────┐    ┌─────────────┐                            │
│  │  Conquest    │    │   Orthanc    │                            │
│  │  (Windows)   │    │  (Synology)  │                            │
│  │  172.16.1.139 │    │  100.x.x.x:8042│                           │
│  │  KEEP during   │    │  NEW primary   │                            │
│  │  transition    │    │  PACS         │                            │
│  └─────────────┘    └─────────────┘                            │
│                                                                 │
│  Windows PC (asusi9clinic) — Phase 2 Retirement Target          │
│  ├─ Weasis (backup viewer only)                                 │
│  ├─ DICOM Puller (migrate to Synology)                         │
│  └─ Ollama (if AI needed locally)                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Architecture Component Mapping

| Component | Current | Target | Migration Path |
|---|---|---|---|
| ERP API | Replit (Express) | Synology Docker | Docker-compose |
| PostgreSQL | Replit | Synology Docker | pg_dump + restore |
| Clinic Site | Replit SPA | Synology nginx | Static build |
| ERP Portal | Replit SPA | Synology nginx | Static build |
| Admin | Replit SPA | Synology nginx | Static build |
| Conquest PACS | Windows PC | Retire | Keep until validated |
| Orthanc PACS | Not deployed | Synology Docker | Fresh install |
| OHIF Viewer | Not installed | Synology Docker | Fresh install |
| Weasis | Windows PC | Keep as backup | No migration needed |
| DICOMweb | Not available | Orthanc WADO-RS | Enable in Orthanc |
| Worklist | Conquest | Orthanc MWL | Reconfigure modalities |
| File Storage | Replit | Synology NAS | rsync / SCP |
| Backups | Replit | Synology Hyper Backup | Configure jobs |
| Tailscale | Active | Active | Extend to Synology ERP |
| AI (Gemini) | Replit | Replit or Synology | Keep as-is |
| AI (Ollama) | Not deployed | Windows PC or GPU box | Not on Synology |

---

## PART 5 — ORTHANC + OHIF MIGRATION PLAN

### 5.1 Phase 1: Install Orthanc on Synology

**Duration:** 1-2 days
**Downtime:** None (parallel installation)

**Steps:**
1. Install Container Manager (Docker) on DSM 7+
2. Create `orthanc` folder in Docker shared folder
3. Create `orthanc.json` configuration:
   ```json
   {
     "Name": "CareDiagnostics",
     "StorageDirectory": "/var/lib/orthanc/db",
     "IndexDirectory": "/var/lib/orthanc/db",
     "DicomModalities": {
       "MRI": ["UIH", "172.16.1.10", 104],
       "CT": ["CT", "172.16.1.11", 104],
       "USG": ["USG", "172.16.1.12", 104]
     },
     "DicomAet": "CAREPACS",
     "DicomPort": 4242,
     "HttpPort": 8042,
     "RemoteAccessAllowed": true,
     "AuthenticationEnabled": true,
     "RegisteredUsers": {
       "admin": "secure-password-here"
     },
     "DicomWeb": {
       "Enable": true,
       "Root": "/dicom-web/",
       "EnableWado": true,
       "WadoRoot": "/wado/",
       "Host": "100.x.x.x"
     }
   }
   ```
4. Deploy Orthanc Docker container:
   ```bash
   docker run -d \
     --name orthanc \
     --restart unless-stopped \
     -p 4242:4242 \
     -p 8042:8042 \
     -v /volume2/orthanc/db:/var/lib/orthanc/db \
     -v /volume2/orthanc/config:/etc/orthanc \
     jodogne/orthanc:latest
   ```
5. Verify Orthanc UI at `http://abinashnas:8042`
6. Test DICOM C-ECHO from a modality

### 5.2 Phase 2: Install OHIF on Synology

**Duration:** 1 day
**Downtime:** None

**Steps:**
1. Build OHIF with Synology-specific configuration:
   ```dockerfile
   FROM node:18-alpine AS builder
   WORKDIR /app
   RUN apk add --no-cache git
   RUN git clone https://github.com/OHIF/Viewers.git .
   RUN yarn install
   ENV REACT_APP_CONFIG=/app/platform/app/public/config/default.js
   # Configure for Orthanc DICOMweb
   RUN yarn build
   
   FROM nginx:alpine
   COPY --from=builder /app/platform/app/dist /usr/share/nginx/html
   COPY nginx.conf /etc/nginx/conf.d/default.conf
   EXPOSE 3000
   ```
2. nginx.conf for OHIF:
   ```nginx
   server {
     listen 3000;
     location / {
       root /usr/share/nginx/html;
       try_files $uri $uri/ /index.html;
     }
     location /dicom-web/ {
       proxy_pass http://orthanc:8042/dicom-web/;
       proxy_set_header Host $host;
     }
   }
   ```
3. Deploy OHIF container:
   ```bash
   docker run -d \
     --name ohif \
     --restart unless-stopped \
     -p 3000:3000 \
     --link orthanc:orthanc \
     care-diagnostics/ohif:latest
   ```
4. Verify OHIF at `http://abinashnas:3000`

### 5.3 Phase 3: Parallel PACS Operation

**Duration:** 1-2 weeks
**Downtime:** None

**Steps:**
1. Configure modalities to send to BOTH PACS systems:
   - Primary: Conquest (existing) — keep as-is
   - Secondary: Orthanc (new) — add as secondary destination
2. For each modality:
   - MRI: Add Orthanc as secondary DICOM node
   - CT: Add Orthanc as secondary DICOM node
   - USG: Add Orthanc as secondary DICOM node
3. Verify studies are arriving in both systems
4. Monitor Orthanc for any issues
5. Keep Conquest as the "source of truth" during this phase

### 5.4 Phase 4: Send Studies to Both PACS

**Duration:** 1-2 weeks (ongoing)
**Downtime:** None

**Configuration:**
- Each modality DICOM node configuration:
  ```
  Primary DICOM Server: Conquest (172.16.1.139:5678)
  Secondary DICOM Server: Orthanc (100.x.x.x:4242)
  ```
- Or use DICOM router on Synology to forward from Conquest to Orthanc

### 5.5 Phase 5: Validate Workflow

**Duration:** 1-2 weeks
**Checklist:**
- [ ] Studies arrive in Orthanc (check count matches Conquest)
- [ ] Worklist generation works in Orthanc
- [ ] DICOMweb (WADO-RS) is accessible
- [ ] OHIF loads studies correctly
- [ ] ERP can launch OHIF for studies
- [ ] Reporting workflow is functional end-to-end
- [ ] Study search works in Orthanc
- [ ] Patient/study metadata is correct
- [ ] Image quality is preserved
- [ ] No data loss between Conquest and Orthanc

### 5.6 Phase 6: Retire Conquest

**Duration:** 1 day
**Downtime:** None (if properly planned)

**Prerequisites (ALL must be true):**
- [ ] Orthanc has 100% of studies from last 30 days
- [ ] All radiologists confirm OHIF is acceptable
- [ ] Worklist is fully operational on Orthanc
- [ ] ERP has been updated to point to Orthanc
- [ ] Backup of Conquest database exists
- [ ] 1 week of successful parallel operation

**Steps:**
1. Update modality configurations to remove Conquest
2. Update ERP `PACS_PROVIDER` to "orthanc"
3. Update `ORTHANC_URL` to Synology address
4. Update `OHIF_URL` to Synology address
5. Stop Conquest service (but keep data for 3 months)
6. Archive Conquest database to Synology

### 5.7 Docker Architecture for Synology

```yaml
# docker-compose.pacs.yml
version: '3.8'

services:
  orthanc:
    image: jodogne/orthanc:latest
    container_name: care-orthanc
    restart: unless-stopped
    ports:
      - "4242:4242"   # DICOM
      - "8042:8042"   # HTTP / DICOMweb
    volumes:
      - /volume2/orthanc/db:/var/lib/orthanc/db
      - /volume2/orthanc/config:/etc/orthanc
    environment:
      - ORTHANC__NAME=CareDiagnostics
      - ORTHANC__DICOM_AET=CAREPACS
      - ORTHANC__DICOM_PORT=4242
      - ORTHANC__HTTP_PORT=8042
      - ORTHANC__DICOM_WEB__ENABLE=true
    networks:
      - pacs-network

  ohif:
    image: ohif/viewer:latest
    container_name: care-ohif
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - APP_CONFIG=/usr/share/nginx/html/app-config.js
    volumes:
      - /volume2/ohif/config:/usr/share/nginx/html
    networks:
      - pacs-network
    depends_on:
      - orthanc

  dicom-router:
    image: dcm4che/dcm4chee-arc-psql:5.31.0
    container_name: care-dicom-router
    restart: unless-stopped
    environment:
      - POSTGRES_DB=pacsdb
      - POSTGRES_USER=pacs
      - POSTGRES_PASSWORD=secure-password
    networks:
      - pacs-network

networks:
  pacs-network:
    driver: bridge
```

### 5.8 Folder Structure

```
/volume1/docker/
├─ orthanc/
│  ├─ db/                    # DICOM storage
│  ├─ config/
│  │  └─ orthanc.json        # Main configuration
│  └─ logs/                  # Log files
│
├─ ohif/
│  ├─ config/
│  │  └─ app-config.js       # OHIF configuration
│  └─ nginx/
│     └─ default.conf         # nginx reverse proxy
│
├─ erp/
│  ├─ docker-compose.yml     # Main ERP stack
│  ├─ .env                   # Environment variables
│  └─ backups/               # Database backups
│
└─ shared/
   ├─ uploads/              # File uploads
   ├─ exports/              # Tally exports, reports
   └─ dicom-archive/        # Long-term DICOM storage
```

### 5.9 Storage Layout

| Volume | Purpose | Size | RAID |
|---|---|---|---|
| Volume 1 (Bays 1-2) | ERP + Docker | 4TB | RAID1 |
| Volume 2 (Bays 3-4) | PACS (Orthanc) | 8TB | RAID1 |
| Volume 3 (Bay 5) | Backups + Archive | 8TB | Single |

### 5.10 Backup Layout

| Source | Destination | Frequency | Tool |
|---|---|---|---|
| Orthanc DB | Volume 3 | Daily | Synology Snapshot |
| DICOM studies | Volume 3 | Daily | rsync |
| ERP database | Volume 3 | Hourly | pg_dump |
| Full system | External USB | Weekly | Hyper Backup |
| Full system | Cloud (S3) | Monthly | Hyper Backup |

### 5.11 Rollback Plan

**If Orthanc fails during validation:**
1. Keep Conquest running throughout parallel operation
2. Switch modalities back to Conquest-only (5 minutes)
3. Switch ERP `PACS_PROVIDER` back to "conquest" (1 minute)
4. Investigate and fix Orthanc issue
5. Re-attempt validation

**If data loss is detected:**
1. Stop Orthanc immediately
2. Compare study counts: Conquest vs Orthanc
3. Re-send missing studies from modalities
4. If needed, re-send from Conquest to Orthanc

**Worst case:**
- Conquest remains primary indefinitely
- Orthanc serves as secondary/archive only
- No disruption to clinical operations

---

## PART 6 — ERP MIGRATION FROM REPLIT TO SYNOLOGY

### 6.1 Database Migration Strategy

**Current State:**
- PostgreSQL on Replit (cloud-hosted)
- 3,724 patients, 3,615 bills
- Production schema: 226 tables (51 missing vs dev)

**Target State:**
- PostgreSQL in Docker on Synology
- All 277 tables (after schema sync)
- Full data integrity

**Migration Steps:**

1. **Pre-migration (on Replit):**
   ```bash
   # Fix schema drift first
   # Add missing columns to clinic_settings
   ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS ollama_base_url TEXT DEFAULT '';
   ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS ollama_model TEXT DEFAULT '';
   ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS ollama_local_only BOOLEAN DEFAULT FALSE;
   
   # Create missing tables (or temporarily disable features)
   # Run all missing CREATE TABLE statements
   
   # Full backup
   pg_dump $DATABASE_URL > care-diagnostics-full-$(date +%Y%m%d).sql
   ```

2. **Synology preparation:**
   ```bash
   # Start PostgreSQL container
   docker run -d \
     --name care-db \
     --restart unless-stopped \
     -e POSTGRES_USER=erp \
     -e POSTGRES_PASSWORD=STRONG_PASSWORD \
     -e POSTGRES_DB=diagnostic_erp \
     -v /volume1/docker/erp/postgres:/var/lib/postgresql/data \
     -p 5432:5432 \
     postgres:16-alpine
   
   # Wait for DB to be ready
   sleep 30
   ```

3. **Restore on Synology:**
   ```bash
   # Copy dump file to Synology
   scp care-diagnostics-full-20260607.sql admin@abinashnas:/volume1/docker/erp/
   
   # Restore
   docker exec -i care-db psql -U erp -d diagnostic_erp < care-diagnostics-full-20260607.sql
   ```

4. **Verification:**
   ```bash
   # Check table count
   docker exec care-db psql -U erp -d diagnostic_erp -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
   
   # Check patient count
   docker exec care-db psql -U erp -d diagnostic_erp -c "SELECT count(*) FROM patients;"
   
   # Check bill count
   docker exec care-db psql -U erp -d diagnostic_erp -c "SELECT count(*) FROM bills;"
   ```

### 6.2 Upload Storage Migration

**Current:** Replit object storage (sidecar)
**Target:** Synology NAS shared folder

**Migration:**
```bash
# On Replit: export all uploaded files
# Files are in data/uploads/ or object storage

# On Synology:
mkdir -p /volume1/docker/shared/uploads

# Transfer via rsync
rsync -avz --progress \
  runner@replit-host:/path/to/uploads/ \
  admin@abinashnas:/volume1/docker/shared/uploads/

# Update ERP configuration to use local storage
# Modify objectStorage.ts or .env
PUBLIC_OBJECT_SEARCH_PATHS=/volume1/docker/shared/uploads/public
PRIVATE_OBJECT_DIR=/volume1/docker/shared/uploads/private
```

### 6.3 File Storage Migration

**Current:** Replit ephemeral storage
**Target:** Synology persistent storage

**Files to migrate:**
- Patient photos (`data/uploads/photos/`)
- Scan documents (`data/uploads/scans/`)
- DICOM uploads (`data/uploads/dicom/`)
- Report exports (`data/exports/`)
- Backup files (`data/backups/`)

### 6.4 Environment Variables Migration

| Variable | Replit Value | Synology Value | Notes |
|---|---|---|---|
| `DATABASE_URL` | Replit URL | `postgres://erp:pass@care-db:5432/diagnostic_erp` | Docker internal |
| `NODE_ENV` | `production` | `production` | Same |
| `PORT` | `8080` | `8080` | Same |
| `SERVE_STATIC_DIR` | `artifacts/api-server/dist/web` | `/app/dist/web` | Docker path |
| `SESSION_SECRET` | Set | Set | Copy value |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Set | Set | Copy value |
| `ORTHANC_URL` | Not set | `http://care-orthanc:8042` | New |
| `ORTHANC_USERNAME` | Not set | `admin` | New |
| `ORTHANC_PASSWORD` | Not set | `secure-pass` | New |
| `OHIF_URL` | Not set | `http://abinashnas:3000` | New |
| `PACS_PROVIDER` | `conquest` | `orthanc` | Change after migration |
| `ENABLE_DICOM_PULL_AGENT` | Not set | `1` | Enable on Synology |
| `INTERNAL_API_KEY` | Set | Set | Generate new strong key |
| `TZ` | `Asia/Kolkata` | `Asia/Kolkata` | Same |

### 6.5 SSL Strategy

**Option A: Tailscale + HTTPS (Recommended)**
- Tailscale provides automatic HTTPS certificates for all devices
- `https://abinashnas.tailnet-name.ts.net` — valid certificate
- No manual certificate management
- Works for all remote access scenarios

**Option B: Reverse Proxy with Let's Encrypt**
- Requires public domain and port 80/443 access
- More complex but works without Tailscale
- Use Synology's built-in reverse proxy + Let's Encrypt

**Option C: Self-Signed Certificates**
- Quick to set up
- Browser warnings for users
- Acceptable for internal use only

**Recommendation:** Use Tailscale + HTTPS (Option A) for all access. Add Synology reverse proxy for local clinic access without Tailscale.

### 6.6 Reverse Proxy Strategy

**nginx configuration for Synology:**
```nginx
server {
    listen 80;
    server_name abinashnas.local;
    
    # ERP API
    location /api/ {
        proxy_pass http://care-api:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Clinic website
    location / {
        proxy_pass http://care-web:80/;
        proxy_set_header Host $host;
    }
    
    # ERP portal
    location /erp/ {
        proxy_pass http://care-web:80/erp/;
        proxy_set_header Host $host;
    }
    
    # Admin
        proxy_set_header Host $host;
    }
    
    # Orthanc
    location /pacs/ {
        proxy_pass http://care-orthanc:8042/;
        proxy_set_header Host $host;
    }
    
    # OHIF
    location /viewer/ {
        proxy_pass http://care-ohif:3000/;
        proxy_set_header Host $host;
    }
}
```

### 6.7 Docker Strategy

**Use existing `docker-compose.yml` from the repo:**

```yaml
# /volume1/docker/erp/docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    container_name: care-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER:-erp}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
      POSTGRES_DB: ${DB_NAME:-diagnostic_erp}
    volumes:
      - /volume1/docker/erp/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-erp} -d ${DB_NAME:-diagnostic_erp}"]
      interval: 5s
      timeout: 5s
      retries: 20

  api:
    build:
      context: /volume1/docker/erp/repo
      dockerfile: Dockerfile
      target: api
    container_name: care-api
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://${DB_USER:-erp}:${DB_PASSWORD:-changeme}@db:5432/${DB_NAME:-diagnostic_erp}
      NODE_ENV: production
      PORT: "8080"
      SERVE_STATIC_DIR: /app/dist/web
      ORTHANC_URL: http://care-orthanc:8042
      OHIF_URL: http://abinashnas:3000
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - /volume1/docker/shared/uploads:/app/uploads

  web:
    build:
      context: /volume1/docker/erp/repo
      dockerfile: Dockerfile
      target: web
    container_name: care-web
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - api

  migrate:
    build:
      context: /volume1/docker/erp/repo
      dockerfile: Dockerfile
      target: migrate
    container_name: care-migrate
    environment:
      DATABASE_URL: postgres://${DB_USER:-erp}:${DB_PASSWORD:-changeme}@db:5432/${DB_NAME:-diagnostic_erp}
    depends_on:
      db:
        condition: service_healthy
    profiles: ["tools"]
    restart: "no"
```

### 6.8 Backup Strategy

**Layer 1: Database (PostgreSQL)**
- Hourly: Incremental pg_dump (custom format)
- Daily: Full pg_dump (plain SQL)
- Weekly: Full pg_dump compressed
- Retention: 7 days hourly, 30 days daily, 12 weeks weekly
- Tool: `pg_dump` + Synology Task Scheduler

**Layer 2: DICOM Studies**
- Real-time: Synology Snapshot Replication (BTRFS)
- Daily: rsync to backup volume
- Weekly: Full archive to external USB
- Retention: 90 days snapshots, 1 year on backup volume
- Tool: Synology Snapshot + Hyper Backup

**Layer 3: File Uploads**
- Real-time: Synology Snapshot
- Daily: rsync to backup volume
- Weekly: Cloud sync (S3-compatible)
- Tool: Synology Drive Sync + Cloud Sync

**Layer 4: Docker Containers**
- Weekly: Export container configs
- On change: Commit docker-compose.yml to git
- Tool: `docker compose config` + git

**Layer 5: Full System**
- Monthly: Hyper Backup to external USB
- Quarterly: Hyper Backup to cloud (S3)
- Tool: Synology Hyper Backup

### 6.9 Restore Strategy

**Database Restore (Point-in-Time):**
```bash
# Stop ERP
docker compose stop api

# Restore from backup
docker exec -i care-db psql -U erp -d diagnostic_erp < backup-file.sql

# Restart ERP
docker compose start api
```

**DICOM Studies Restore:**
```bash
# Stop Orthanc
docker stop care-orthanc

# Restore from snapshot
# Synology BTRFS snapshots can be browsed in File Station

# Or restore from backup
rsync -avz /volume3/backups/orthanc/ /volume2/orthanc/db/

# Restart Orthanc
docker start care-orthanc
```

**Full System Restore:**
1. Reinstall DSM on Synology (if hardware failure)
2. Restore from Hyper Backup
3. Reinstall Docker packages
4. Start containers
5. Verify all services

### 6.10 Disaster Recovery

**Scenario A: Synology Hardware Failure**
1. Replace failed drive (hot-swap if RAID)
2. RAID rebuilds automatically
3. If total failure: restore from Hyper Backup to new NAS
4. Estimated recovery time: 2-4 hours

**Scenario B: Database Corruption**
1. Stop ERP containers
2. Restore from latest valid pg_dump
3. Verify data integrity
4. Restart ERP
5. Estimated recovery time: 30 minutes

**Scenario C: Ransomware Attack**
1. Isolate NAS from network
2. Restore from offline backup (external USB)
3. Verify no encrypted files in backup
4. Rebuild and update all passwords
5. Estimated recovery time: 4-8 hours

**Scenario D: Complete Site Loss**
1. Procure new Synology DS1522+
2. Restore DSM from Hyper Backup cloud
3. Reinstall Docker containers
4. Restore database from cloud backup
5. Restore DICOM from cloud backup
6. Estimated recovery time: 1-2 days

### 6.11 ERP Migration Timeline

| Week | Activity | Risk |
|---|---|---|
| 1 | Fix schema drift (add missing columns/tables) | Low |
| 1 | Full production database backup | Low |
| 1 | Set up Synology Docker environment | Low |
| 2 | Deploy PostgreSQL on Synology | Low |
| 2 | Restore database to Synology | Medium |
| 2 | Verify data integrity | Low |
| 3 | Deploy ERP API on Synology | Low |
| 3 | Deploy web frontends on Synology | Low |
| 3 | Internal testing | Low |
| 4 | Parallel operation (Replit + Synology) | Medium |
| 4 | User acceptance testing | Low |
| 5 | DNS cutover to Synology | High |
| 5 | Monitor for 1 week | Medium |
| 6 | Decommission Replit (keep as backup) | Low |

---

## PART 7 — AI ARCHITECTURE REVIEW

### 7.1 Current AI Architecture

| Component | Current | Status |
|---|---|---|
| Gemini AI | Replit AI Integration | Active, working |
| Ollama | Not deployed | Configured but no GPU |
| Local AI models | None | Not feasible on current hardware |
| AI features | Clinical notes, billing insights, patient communication | Working via Gemini |

### 7.2 Synology DS1522+ AI Capability

| Spec | Value | AI Impact |
|---|---|---|
| CPU | AMD Ryzen R1600 (2 cores) | Insufficient for LLMs |
| RAM | 8GB (expandable to 32GB) | Insufficient for model loading |
| GPU | None | Cannot run CUDA workloads |
| Storage | SATA HDD | Too slow for model I/O |

**Verdict:** Synology DS1522+ is **NOT suitable** for Ollama or any local LLM inference.

### 7.3 AI Options

**Option A: Keep Gemini on Replit (Recommended)**
- Continue using Gemini via Replit AI Integration
- No local hardware needed
- Works from any location (including Synology)
- Cost: Included in Replit plan
- **Recommendation:** Keep this as primary AI

**Option B: Ollama on Windows PC**
- Use existing Windows PC (asusi9clinic)
- CPU-only inference (slow)
- Limited to small models (3B-7B parameters)
- Good for: Quick drafts, simple text generation
- **Recommendation:** Use as secondary/offline AI

**Option C: Dedicated GPU Workstation**
- NVIDIA RTX 4060/4070 or better
- 32GB+ RAM
- SSD storage
- Cost: ~₹80,000-150,000
- Capable of: 7B-13B parameter models, image analysis, report generation
- **Recommendation:** Consider for future if AI becomes critical

**Option D: Cloud AI Services**
- OpenAI GPT-4, Claude, etc.
- No local hardware needed
- Pay per use
- **Recommendation:** Backup option if Gemini fails

### 7.4 Recommended AI Architecture

```
Primary AI: Gemini (via Replit AI Integration)
├─ Currently hosted: Replit
├─ Can be accessed from: Any location (Replit is cloud)
├─ Synology ERP can call: Same API endpoints
└─ No migration needed

Secondary AI: Ollama (on Windows PC)
├─ Host: asusi9clinic (Windows PC)
├─ Models: Small LLMs (3B-7B)
├─ Use case: Offline backup, quick drafts
├─ Access: Tailscale from Synology
└─ Keep running alongside Synology

Future AI: GPU Workstation (optional)
├─ Host: Dedicated machine
├─ Models: Large LLMs (7B-13B), vision models
├─ Use case: Advanced reporting, image analysis
├─ Access: Tailscale from Synology
└─ Timeline: 2027+ if needed
```

### 7.5 AI Migration Impact

**No migration needed for AI.** The Gemini integration is cloud-based and works regardless of where the ERP is hosted. The Synology ERP will continue calling the same Gemini API endpoints.

---

## PART 8 — REMOTE REPORTING ARCHITECTURE

### 8.1 Current Remote Access

| Location | Access Method | Status |
|---|---|---|
| Clinic | Direct LAN | Working |
| Pune | Tailscale | Working |
| Home | Tailscale | Working |
| Travel | Tailscale | Working |
| Mobile | Tailscale | Working |

### 8.2 Target Remote Reporting Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    TAILSCALE MESH NETWORK                         │
│                    (100.x.x.x addresses)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐         ┌─────────────┐         ┌─────────┐         │
│  │  Pune   │◄──────►│             │◄──────►│  Home   │         │
│  │ (Dr)    │  Tailscale│  SYNOLOGY   │  Tailscale│  (Dr)   │         │
│  │         │   mesh   │  DS1522+    │   mesh   │         │         │
│  └─────────┘         │  (abinashnas)│         └─────────┘         │
│                      │             │                              │
│  ┌─────────┐         │  ┌─────────┐  │         ┌─────────┐         │
│  │  Travel │◄──────►│  │  ERP    │  │◄──────►│  Mobile │         │
│  │  (Dr)   │         │  │  Portal │  │         │ (Staff) │         │
│  │         │         │  └─────────┘  │         │         │         │
│  └─────────┘         │             │         └─────────┘         │
│                      │  ┌─────────┐  │                            │
│                      │  │  PACS   │  │                            │
│                      │  │(Orthanc)│  │                            │
│                      │  └─────────┘  │                            │
│                      │             │                            │
│                      │  ┌─────────┐  │                            │
│                      │  │  OHIF   │  │                            │
│                      │  │(Viewer) │  │                            │
│                      │  └─────────┘  │                            │
│                      └─────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 Remote Reporting Steps

**From Pune / Home / Travel:**
1. Connect device to Tailscale (auto-connects)
2. Open browser to `https://abinashnas.tailnet-name.ts.net/erp/`
3. Log in with staff credentials
4. Navigate to Reporting section
5. Studies are fetched from Orthanc (Synology) via DICOMweb
6. OHIF viewer loads in browser
7. Radiologist writes report in ERP
8. Report is saved to PostgreSQL (Synology)

**From Mobile:**
1. Open Tailscale app (auto-connects)
2. Open browser or mobile app
3. Log in with staff credentials
4. View reports, bills, appointments
5. Limited reporting (view-only recommended)

### 8.4 Security for Remote Reporting

| Layer | Implementation | Notes |
|---|---|---|
| Network | Tailscale (WireGuard) | Encrypted mesh, no open ports |
| Auth | Staff PIN + session | Existing ERP auth |
| HTTPS | Tailscale certificates | Auto-generated, valid |
| PACS | Orthanc auth | Username/password per user |
| DICOM | C-STORE only from LAN | Modalities cannot connect remotely |
| VPN | Required for all access | No public exposure |

### 8.5 Performance Considerations

| Activity | Bandwidth | Latency | Notes |
|---|---|---|---|
| ERP page load | 100KB | <100ms | Tailscale mesh is fast |
| Study list | 50KB | <100ms | API call |
| DICOM image (512x512) | 250KB | <100ms | OHIF loads progressively |
| DICOM image (2Kx2K) | 2MB | 200-500ms | May need compression |
| Report save | 10KB | <100ms | Instant |
| Video consult | 1Mbps | <200ms | Not currently supported |

**Recommendation:** For 3T MRI large series (1000+ slices), consider:
- OHIF progressive loading (built-in)
- Thumbnail-first loading
- Optional: Pre-generate JPEG2000 thumbnails

---

## PART 9 — SECURITY AUDIT

### 9.1 PACS Security

| Aspect | Current | Target | Risk |
|---|---|---|---|
| Conquest | No auth (LAN only) | Retire | Medium (LAN only) |
| Orthanc | Username/password | Same | Low |
| DICOM | C-STORE from LAN only | Same | Low |
| DICOMweb | Auth via Orthanc | Same | Low |
| OHIF | Auth via Orthanc | Same | Low |
| Tailscale | WireGuard encryption | Same | Low |

**Recommendation:**
- Orthanc should have strong admin password
- Enable Orthanc's `DicomWeb` with authentication
- Restrict DICOM C-STORE to LAN IPs only
- No public PACS exposure

### 9.2 ERP Security

| Aspect | Current | Target | Risk |
|---|---|---|---|
| Auth | Staff PIN + session | Same | Low |
| LAN-only | Configurable | Same | Low |
| FIDO2 | Configurable | Same | Low |
| Session timeout | Configurable | Same | Low |
| Lockout | Configurable | Same | Low |
| SSL | Tailscale HTTPS | Same | Low |
| Secrets | Environment vars | Same | Low |

**Recommendation:**
- Keep all existing security features
- Use strong database password
- Enable session timeout for remote access

### 9.3 Database Security

| Aspect | Current | Target | Risk |
|---|---|---|---|
| PostgreSQL | Replit hosted | Synology Docker | Low |
| Password | Managed by Replit | Self-managed | Medium |
| SSL | Replit internal | Docker internal | Low |
| Backups | Replit | Synology | Low |
| Access | API only | API only | Low |

**Recommendation:**
- Use strong password for PostgreSQL on Synology
- Do not expose PostgreSQL port externally
- Use Docker internal network only
- Enable daily backups with encryption

### 9.4 Backup Security

| Aspect | Current | Target | Risk |
|---|---|---|---|
| Backups | Replit | Synology + USB + Cloud | Low |
| Encryption | Not verified | Enable Hyper Backup encryption | Medium |
| Retention | Limited | 3-2-1 rule | Low |
| Offline | No | External USB | Medium |

**Recommendation:**
- Implement 3-2-1 backup rule (3 copies, 2 media, 1 offsite)
- Encrypt all backups with strong password
- Store one copy offline (external USB)
- Store one copy in cloud (S3-compatible)

### 9.5 Tailscale Security

| Aspect | Current | Target | Risk |
|---|---|---|---|
| Network | Mesh VPN | Same | Low |
| Auth | Tailscale login | Same | Low |
| Keys | Device-based | Same | Low |
| ACLs | Default | Review and restrict | Medium |

**Recommendation:**
- Review Tailscale ACLs to restrict device access
- Use Tailscale's "device authorization" feature
- Enable "overdue device notification"
- Consider Tailscale's "funnel" feature for limited public access

### 9.6 User Authentication

| Aspect | Current | Target | Risk |
|---|---|---|---|
| Staff | Username + PIN | Same | Low |
| Patient | Mobile + PIN | Same | Low |
| Admin | USB + PIN | Same | Low |
| Portal | PIN-based | Same | Low |
| FIDO2 | Optional | Optional | Low |
| Biometric | Fingerprint (local) | Same | Low |

**Recommendation:**
- All existing auth mechanisms work on Synology
- No changes needed
- Consider adding 2FA for remote staff access

### 9.7 Disaster Recovery

| Scenario | Current RTO | Target RTO | Target RPO |
|---|---|---|---|
| Database failure | Hours | 30 minutes | 1 hour |
| DICOM failure | Days | 2 hours | 0 (real-time) |
| Full site loss | Days | 4 hours | 1 day |
| Ransomware | Days | 8 hours | 1 day |

**Recommendation:**
- Test restore procedures quarterly
- Document runbooks for all scenarios
- Maintain offline backup copy
- Consider warm standby on secondary NAS

### 9.8 Ransomware Protection

| Layer | Implementation | Notes |
|---|---|---|
| Prevention | Tailscale (no public ports) | Strong |
| Detection | Synology Antivirus | Enable |
| Immunity | BTRFS snapshots | Enable Auto Snapshot |
| Recovery | Offline backups | External USB |
| Insurance | Hyper Backup | Cloud copy |

**Recommendation:**
- Enable Synology's built-in antivirus
- Enable Auto Snapshot (BTRFS)
- Keep offline backups (not network-attached)
- Train staff on phishing awareness
- Disable SMB/RDP from internet

---

## PART 10 — FINAL RECOMMENDATION

### 10.1 Executive Summary

Care Diagnostics has a **mature, production-ready ERP codebase** with 111 database schemas, 40+ frontend pages, and 30+ API modules. The system is well-architected for migration to Synology DS1522+.

**However, there are critical issues that must be resolved before migration:**

1. **CRITICAL:** Production database schema drift (51 missing tables, 3 missing columns) causes ERP failures
2. **HIGH:** PACS migration requires parallel operation (Conquest + Orthanc) to avoid downtime
3. **MEDIUM:** AI should remain cloud-based (Gemini); Synology cannot run local LLMs
4. **LOW:** Synology hardware is suitable for all workloads except AI

### 10.2 Critical Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Schema drift causes migration failure | High | High | Fix drift before migration |
| Data loss during PACS migration | Low | Critical | Parallel operation + backups |
| Synology hardware failure | Low | High | RAID + backups + spare drive |
| Network connectivity issues | Medium | Medium | Tailscale mesh is resilient |
| Staff resistance to change | Medium | Medium | Parallel operation + training |
| Ransomware attack | Low | Critical | Offline backups + snapshots |
| AI performance degradation | None | None | No AI migration needed |

### 10.3 Quick Wins

1. **Fix schema drift** (1 day) — Add missing columns to production
2. **Enable Tailscale on Synology** (already done)
3. **Install Orthanc on Synology** (1 day) — Start parallel PACS
4. **Configure OHIF** (1 day) — Test viewer
5. **Set up database backups** (1 day) — Synology Task Scheduler

### 10.4 Migration Priorities

| Priority | Activity | Duration | Dependencies |
|---|---|---|---|
| P0 | Fix production schema drift | 1 day | None |
| P0 | Full production backup | 1 day | None |
| P1 | Deploy Orthanc on Synology | 2 days | None |
| P1 | Deploy OHIF on Synology | 1 day | Orthanc |
| P1 | Parallel PACS operation | 2 weeks | Orthanc + OHIF |
| P2 | Deploy ERP on Synology | 3 days | Schema fixed |
| P2 | Migrate database | 1 day | ERP deployed |
| P2 | Parallel ERP operation | 1 week | Database migrated |
| P3 | DNS cutover | 1 day | Parallel ERP validated |
| P3 | Retire Conquest | 1 day | PACS validated |
| P4 | Decommission Replit | 1 day | 1 month stability |

### 10.5 Recommended Production Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              CARE DIAGNOSTICS — TARGET PRODUCTION                 │
│                        (Synology DS1522+)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Docker Stack                          │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │   │
│  │  │  nginx  │ │ Express │ │PostgreSQL│ │ Orthanc │      │   │
│  │  │ (web)   │ │ (API)   │ │  (DB)   │ │ (PACS)  │      │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐                  │   │
│  │  │  OHIF   │ │ DICOM   │ │  Redis  │                  │   │
│  │  │(Viewer) │ │ Puller  │ │ (Cache) │                  │   │
│  │  └─────────┘ └─────────┘ └─────────┘                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  DSM Services                            │   │
│  │  ├─ Tailscale (secure remote access)                     │   │
│  │  ├─ Hyper Backup (encrypted backups)                     │   │
│  │  ├─ Snapshot Replication (BTRFS protection)              │   │
│  │  ├─ Active Backup (Windows PC backup)                    │   │
│  │  └─ File Station (document management)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Storage: 5x 8TB WD Red (RAID5) = 32TB usable                  │
│  M.2 Cache: 2x NVMe (database + Docker)                         │
│  RAM: 16GB (upgrade from 8GB)                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

External Connections:
├─ Replit (Gemini AI) — keep as-is
├─ Windows PC (Ollama backup) — keep as-is
├─ Cloud (S3 backup) — monthly
├─ External USB (offline backup) — weekly
└─ Tailscale (remote access) — all locations

Modality Network:
├─ MRI (UIH) ──► Orthanc (Synology) — primary
├─ CT ─────────► Orthanc (Synology) — primary
├─ USG (Voluson) ► Orthanc (Synology) — primary
└─ Conquest (Windows) — secondary (retire after validation)
```

### 10.6 Component-Specific Recommendations

#### 3T MRI
- **PACS:** Send to Orthanc (Synology) as primary
- **Viewer:** OHIF for remote reporting, Weasis as backup
- **Worklist:** Orthanc MWL
- **Storage:** RAID5 volume on Synology (2-5TB/year)
- **Backup:** Real-time snapshots + weekly archive

#### CT
- **PACS:** Send to Orthanc (Synology) as primary
- **Viewer:** OHIF
- **Worklist:** Orthanc MWL
- **Storage:** Same as MRI
- **Backup:** Same as MRI

#### USG
- **PACS:** Send to Orthanc (Synology) as primary
- **Viewer:** OHIF (ultrasound presets)
- **Worklist:** Orthanc MWL
- **Storage:** Smaller studies (100-500MB)
- **Backup:** Same as MRI

#### ERP
- **Host:** Synology Docker (DS1522+)
- **Database:** PostgreSQL in Docker (NVMe cached)
- **API:** Node.js Express (1-2 CPU cores)
- **Web:** nginx (static SPA serving)
- **Storage:** 50GB/year + uploads
- **Backup:** Hourly DB + daily full + weekly archive

#### PACS
- **Primary:** Orthanc (Docker on Synology)
- **Secondary:** Conquest (Windows PC — retire later)
- **Viewer:** OHIF (Docker on Synology)
- **DICOMweb:** Orthanc WADO-RS
- **Worklist:** Orthanc MWL
- **Storage:** 1-2TB/year (DICOM + JPEG2000)
- **Backup:** BTRFS snapshots + weekly archive

#### Remote Reporting
- **Network:** Tailscale (WireGuard mesh)
- **ERP:** `https://abinashnas.tailnet.ts.net/erp/`
- **PACS:** Orthanc DICOMweb via Tailscale
- **Viewer:** OHIF in browser
- **Auth:** ERP staff PIN + Orthanc user auth
- **Security:** No public ports, encrypted mesh

#### Future AI Integration
- **Primary:** Gemini (cloud, via Replit)
- **Secondary:** Ollama (Windows PC, small models)
- **Future:** GPU workstation (if needed)
- **Integration:** Same API endpoints regardless of host
- **Timeline:** No immediate action needed

---

## APPENDIX A — EVIDENCE SOURCES

All findings in this audit are based on direct evidence from:

1. **Database Schema:** `lib/db/src/schema/*.ts` (111 files)
2. **API Routes:** `artifacts/api-server/src/routes/*.ts` (30+ files)
3. **Frontend Pages:** `artifacts/diagnostic-erp/src/pages/*.tsx` (40+ files)
4. **Navigation:** `artifacts/diagnostic-erp/src/components/Layout.tsx`
5. **Environment:** `artifacts/api-server/src/app.ts`, `docker-compose.yml`
6. **Deployment:** `DEPLOY.md`, `Dockerfile`, `build-deploy.mjs`
7. **PACS Config:** `conquest/erp_notify.lua`, `pacs.ts`, `dicom.ts`
8. **Production DB:** Live queries (226 vs 277 tables)
9. **User Input:** Infrastructure description, current setup details

---

## APPENDIX B — IMMEDIATE ACTION ITEMS

### This Week (Critical)

1. [ ] Fix production `clinic_settings` schema (add 3 missing columns)
2. [ ] Create missing non-critical tables OR disable related features
3. [ ] Full production database backup (pg_dump)
4. [ ] Verify current backup strategy on Replit

### Next Week (High Priority)

1. [ ] Install Container Manager on Synology DSM
2. [ ] Deploy Orthanc Docker on Synology
3. [ ] Test DICOM connectivity from one modality
4. [ ] Configure Tailscale for Synology ERP access

### Next Month (Medium Priority)

1. [ ] Deploy OHIF on Synology
2. [ ] Configure modalities for dual PACS (Conquest + Orthanc)
3. [ ] Deploy ERP on Synology (Docker)
4. [ ] Migrate database to Synology
5. [ ] Begin parallel ERP operation

### Next Quarter (Long Term)

1. [ ] Validate PACS workflow (4-6 weeks)
2. [ ] Retire Conquest (after validation)
3. [ ] DNS cutover to Synology
4. [ ] Decommission Replit (after 1 month stability)
5. [ ] Upgrade Synology RAM to 16GB
6. [ ] Add M.2 NVMe cache

---

**End of Audit Report**

*Report generated: 7 June 2026*
*Classification: Internal — Care Diagnostics*
*No code changes, no deployments, no database modifications were made during this audit.*
