# Care Diagnostics ERP — Master System Context
**Version:** 2.0 (June 2026) | **Owner:** Care Diagnostics, Deoghar | **Classification:** Internal Developer Reference

> This is the canonical master reference for the Care Diagnostics Hospital ERP. Use this document as the first source of truth before reading any other documentation, asking any AI model, or starting any development task.

---

## 1. Executive Summary

Care Diagnostics ERP is a production-grade clinical information system and enterprise resource planner for a diagnostic center / imaging facility.

| Attribute | Detail |
|-----------|--------|
| **Hosting** | Synology DS1522+ NAS — Docker Compose (no cloud database) |
| **Network** | Modalities on same LAN as Synology NAS. Remote access via Tailscale VPN |
| **Stack** | TypeScript monorepo · pnpm workspaces · Express.js · Vite/React · PostgreSQL · Drizzle ORM |
| **Database** | 278+ tables, single PostgreSQL 16 instance (container: `care-db`) |
| **Frontend Apps** | 3 SPAs: `diagnostic-erp`, `clinic-site`, `super-admin-portal` |
| **Deployment** | Docker Compose · 5 containers · Nginx reverse proxy · No cloud DB |
| **AI Support** | Local Ollama (CPU inference) + Google Gemini API (cloud) |
| **PACS** | Conquest PACS (LAN, Lua-hook) + Orthanc PACS (Docker) |
| **Viewers** | OHIF (Docker), Weasis (local Windows), Embedded WADO |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Synology DS1522+ NAS (LAN + Tailscale)        │
│                                                                 │
│  [Nginx :8888] ──► [care-api :3000]  ──► [care-db :5432]      │
│        │                  │                                     │
│        │            [care-web] (static)                        │
│        │            [OHIF Viewer]                              │
│        │            [Orthanc PACS]                             │
└─────────────────────────────────────────────────────────────────┘
         │ LAN
┌────────────────────────────────────┐
│       Clinic Local Network         │
│  [MRI Modality] ─────────┐        │
│  [CT Scan]       C-STORE  ├──► [Orthanc PACS Docker]          │
│  [USG Voluson] ──────────┘        │                           │
│                                   │                           │
│  [USG Voluson] ──► C-STORE ──► [Conquest PACS (Windows PC)]   │
│                         └──► Lua Hook ──► /api/internal/       │
│                                           radiology/studies    │
│  [Weasis Viewer] (local DICOM viewer on Windows)              │
└────────────────────────────────────────────────────────────────┘

External:
  [Tailscale VPN] ──► Remote Radiologist / Physician access
  [WhatsApp API] ──► Patient notifications
  [Payment Gateways] ──► ICICI / PhonePe / Razorpay / PayU / BharatPe / Cashfree / HDFC
  [Google Gemini API] ──► AI-assisted radiology reporting
```

---

## 3. Docker Container Inventory

| Container | Image | Purpose | Host Port |
|-----------|-------|---------|-----------|
| `care-db` | postgres:16-alpine | Primary PostgreSQL database | 5400→5432 |
| `care-db-patch-v2` | postgres:16-alpine | Schema patcher (runs & exits) | — |
| `care-api` | custom Node.js | Express API server | internal |
| `care-web` | Nginx | Static frontend + API proxy | 8888→80 |
| `care-migrate` | custom Node.js | Drizzle migrations (runs & exits) | — |

> **Critical:** `care-db-patch-v2` handles schema evolution via raw SQL patch scripts. Any table or column additions MUST be reflected in both Drizzle schema files AND the patch scripts.

---

## 4. Frontend Applications

### 4.1 Diagnostic ERP (`/artifacts/diagnostic-erp`)
Primary internal desktop app. ~140+ pages. Staff roles: Admin, Receptionist, Billing, Radiologist, Lab, Accountant, Manager.

### 4.2 Clinic Site (`/artifacts/clinic-site`)
Public-facing patient booking portal. Online test catalog, package booking, payment gateway integration.

### 4.3 Super Admin Portal (`/artifacts/super-admin-portal`)
Owner/super-admin console. Doctor commission, financial books, backups, role permissions, security audit.

---

## 5. Backend Architecture

- **Entry Point:** `artifacts/api-server/src/index.ts`
- **Router Mounting:** `artifacts/api-server/src/routes/index.ts` (100+ domain routers)
- **Middleware Stack:** Rate limiting → Auth (`requireStaffAuth`) → Permission check → Route handler
- **Cron Scheduler:** `artifacts/api-server/src/cron.ts` — starts all background jobs

---

## 6. Authentication & Authorization

### Authentication
| Scope | Mechanism | Token Storage |
|-------|-----------|---------------|
| Staff | Username + PIN → Bearer token | `portal_sessions` table |
| Super Admin | USB key file (`superadmin.key`) via `X-SA-USB-Key` header | Environment variable check |
| Internal API | `INTERNAL_API_KEY` env var | Header validation |
| Patient Portal | Session token | `portal_sessions` (scope=patient) |

### Authorization (RBAC)
- Stored in `role_permissions` table
- 9 canonical roles: Super Admin, Admin, Manager, Receptionist, Billing, Radiology Typist, Radiologist, Lab, Accountant
- Permission bits: `canView`, `canCreate`, `canEdit`, `canDelete`, `canPrint`, `canReprint`, `canRefund`, `canExport`, `canApprove`, `canFinalize`

---

## 7. Core Module Workflows

### Patient Management
```
Search/ID → Demographics Entry → Token Assignment → Queue Display
```

### Billing
```
Test/Package Selection → Discount/Voucher → Payment → Bill Generation → Receipt Print
```

### Radiology
```
Worklist Entry → Technician Claim → AI Draft (Ollama/Gemini) → Radiologist Edit → Finalize/Lock → PDF → PACS Archive
```

### PACS Integration
```
Modality C-STORE → [Orthanc or Conquest]
                        ↓
Conquest Lua Hook → POST /api/internal/radiology/studies
                        ↓
                   ERP creates study record → Worklist populated
                        ↓
Radiologist opens OHIF/Weasis → Report drafted → Finalized
                        ↓
PDF compiled by Playwright → DICOM encapsulated → Archived to Orthanc
```

### Form-F (Regulatory)
```
USG Obstetric Bill → Scan OCR → Field Extraction → Form-F Record → Gate blocks finalization until linked
```

### Payment (Online Booking)
```
Public booking → Gateway selection → Payment initiation → Webhook callback → Auto-confirm order → Bill + Token created
```

---

## 8. Background Jobs (Cron Scheduler)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `scheduleDaily` | Every minute (fires at configured time) | Daily summary email to admin |
| `scheduleMonthEndCommission` | Every minute (fires 20:00 last day of month) | Doctor commission calculation email |
| `scheduleDicomAutoPull` | Every 5 minutes | Auto-pull DICOM jobs for active nodes with `autoPull=true` |
| `scheduleMonthlyAudit` | Every minute (fires 06:00 on 1st) | Books sanity money-trail auto-audit |
| `scheduleBankingAutoSync` | Every 5 minutes | Pull bank transactions, auto-reconcile |
| `scheduleFraudDetection` | Every 30 minutes | Run fraud detection engine |
| `scheduleAutomatedBackups` | Every minute (honors job schedule) | Run scheduled backup jobs from DB |
| `scheduleSessionIdleSweep` | Every 5 minutes | Expire idle staff sessions |
| `scheduleAuditLogPurge` | Daily at 03:00 | Archive + purge audit logs older than 730 days |
| DIMSE Pull Agent | Continuous (if `ENABLE_DICOM_PULL_AGENT=1`) | In-process C-FIND/C-MOVE via dcmjs-dimse |

---

## 9. Payment Gateway Integrations

| Gateway | Provider File | Status | Usage |
|---------|--------------|--------|-------|
| ICICI Orange Pay | `IciciPaymentProvider.ts` | Active | Online bookings, primary |
| PhonePe | `PhonePePaymentProvider.ts` | Active | Online bookings |
| Razorpay | `RazorpayPaymentProvider.ts` | Active | Online bookings |
| PayU | `PayUPaymentProvider.ts` | Active | Online bookings |
| BharatPe | `BharatPePaymentProvider.ts` | Active | Online bookings |
| Cashfree | `CashfreePaymentProvider.ts` | Active | Online bookings |
| HDFC | `HdfcPaymentProvider.ts` | Active | Online bookings |
| PaymentEngine | `PaymentEngine.ts` | Active | Unified orchestrator |

**Banking Providers (Bank Statement Sync):**
`AxisBankProvider`, `BharatPeProvider`, `CashfreeProvider`, `HDFCBankProvider`, `ICICIBankProvider`, `KotakBankProvider`, `PhonePeProvider`, `SBIBankProvider`, `GenericBankProvider`, `MockBankProvider`

---

## 10. AI/LLM Integrations

| Integration | Route File | Purpose |
|-------------|-----------|---------|
| Ollama (local LLM) | `radiologyOllama.ts` | Local AI draft generation for reports |
| Google Gemini | `ai.ts`, `aiReporting.ts` | Cloud AI reporting suggestions |
| AI Copilot | `radiologyCopilot.ts` | Radiologist assistant |
| Brain Intelligence | `radiologyBrainIntelligence.ts` | Brain MRI structured reporting |
| Spine Intelligence | `radiologySpineIntelligence.ts` | Spine MRI structured reporting |
| Tumor Follow-up | `radiologyTumorFollowup.ts` | Oncology tracking |
| Lesion Tracker | `radiologyLesions.ts` | Lesion detection & measurement |
| Smart Findings | `radiologySmartFindings.ts` | Chocolate Box / findings library |
| USG Extractor | `usgExtraction.ts` | USG measurement auto-extraction |

---

## 11. Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `production` or `development` |
| `PUBLIC_BASE_URL` | External base URL (e.g. `https://caredeoghar.com`) |
| `SUPER_ADMIN_USB_KEY` | USB authentication secret |
| `INTERNAL_API_KEY` | LAN agent authentication |
| `ICICI_BASE_URL` / `ICICI_MERCHANT_ID` / `ICICI_SECRET_KEY` | ICICI payment |
| `FINGERPRINT_BRIDGE_SECRET` | Biometric scan station auth |
| `GEMINI_API_KEY` | Google Gemini AI |
| `OLLAMA_BASE_URL` | Local Ollama inference URL |
| `ENABLE_DICOM_PULL_AGENT` | `1` to enable in-process DIMSE agent |
| `WHATSAPP_API_KEY` | WhatsApp notification provider key |
| `TAILSCALE_AUTH_KEY` | Tailscale mesh VPN auth |

---

## 12. Critical Files Reference

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/index.ts` | Express app entry + route mounting |
| `artifacts/api-server/src/cron.ts` | All background job schedulers |
| `artifacts/api-server/src/routes/internal-radiology.ts` | Conquest PACS Lua hook receiver |
| `artifacts/api-server/src/lib/pacsArchive.ts` | PDF→DICOM→Orthanc archival pipeline |
| `artifacts/api-server/src/lib/payments/PaymentEngine.ts` | Payment gateway orchestrator |
| `artifacts/api-server/src/lib/objectStorage.ts` | Local file storage (MinIO-compatible) |
| `conquest/erp_notify.lua` | Lua script on Conquest PACS server |
| `docker-compose.yml` | Full container stack definition |
| `migrations/` | Drizzle ORM migration SQL files |
| `docs/Radiology_Architecture_Master.md` | Detailed radiology architecture |
| `ERP_PERMISSION_MATRIX.md` | Full RBAC permission audit |
| `ERP_PACS_DOCUMENTATION.md` | Complete PACS integration documentation |
| `ERP_DEPLOYMENT_RUNBOOK.md` | Step-by-step deployment guide |
| `ERP_TECHNICAL_DEBT.md` | Ranked technical debt findings |

---

## 13. Known Issues & Risks

1. **No git history** — Repository has been developed without version control commits. All "restore points" are directory copies (`backup_*/`).
2. **Schema patching via db-patch-v2** — Column additions bypass Drizzle migrations; must manually keep in sync.
3. **CPU-only Ollama** — Synology DS1522+ has no GPU; AI inference is slow under concurrent load.
4. **Conquest PACS on Windows PC** — Not dockerized; requires manual Lua binary and script installation.
5. **mmap Git error** — Large files (SQL dumps, DOCX) cause `git add` failures on Windows; use `.gitignore` for binary assets.
6. **Tailscale dependency** — Remote radiologist OHIF access fails if Tailscale disconnects.
7. **Single DB instance** — No read replicas; heavy report queries can block writes.

---

## 14. Quick Reference — API Route Prefixes

| Prefix | File | Auth |
|--------|------|------|
| `/api/public/*` | `public-booking.ts`, `website.ts` | None |
| `/api/portal/*` | `tokens.ts`, `portal.ts` | Session |
| `/api/internal/*` | `internal-radiology.ts`, `internal-cron.ts`, `internal-backup.ts` | `INTERNAL_API_KEY` |
| `/api/admin/*` | `super-admin.ts`, `backup.ts` | USB key |
| `/api/*` (staff) | All others | `requireStaffAuth` |
