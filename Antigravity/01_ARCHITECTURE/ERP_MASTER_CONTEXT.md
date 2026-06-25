# Care Diagnostics ERP â€” Master System Context
**Version:** 2.0 (June 2026) | **Owner:** Care Diagnostics, Deoghar | **Classification:** Internal Developer Reference

> This is the canonical master reference for the Care Diagnostics Hospital ERP. Use this document as the first source of truth before reading any other documentation, asking any AI model, or starting any development task.

---

## 1. Executive Summary

Care Diagnostics ERP is a production-grade clinical information system and enterprise resource planner for a diagnostic center / imaging facility.

| Attribute | Detail |
|-----------|--------|
| **Hosting** | Synology DS1522+ NAS â€” Docker Compose (no cloud database) |
| **Network** | Modalities on same LAN as Synology NAS. Remote access via Tailscale VPN |
| **Stack** | TypeScript monorepo Â· pnpm workspaces Â· Express.js Â· Vite/React Â· PostgreSQL Â· Drizzle ORM |
| **Database** | 278+ tables, single PostgreSQL 16 instance (container: `care-db`) |
| **Frontend Apps** | 2 SPAs: `diagnostic-erp`, `clinic-site` |
| **Deployment** | Docker Compose Â· 5 containers Â· Nginx reverse proxy Â· No cloud DB |
| **AI Support** | Local Ollama (CPU inference) + Google Gemini API (cloud) |
| **PACS** | Conquest PACS (LAN, Lua-hook) + Orthanc PACS (Docker) |
| **Viewers** | OHIF (Docker), Weasis (local Windows), Embedded WADO |

---

## 2. System Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  Synology DS1522+ NAS (LAN + Tailscale)        â”‚
â”‚                                                                 â”‚
â”‚  [Nginx :8888] â”€â”€â–º [care-api :3000]  â”€â”€â–º [care-db :5432]      â”‚
â”‚        â”‚                  â”‚                                     â”‚
â”‚        â”‚            [care-web] (static)                        â”‚
â”‚        â”‚            [OHIF Viewer]                              â”‚
â”‚        â”‚            [Orthanc PACS]                             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚ LAN
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚       Clinic Local Network         â”‚
â”‚  [MRI Modality] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”        â”‚
â”‚  [CT Scan]       C-STORE  â”œâ”€â”€â–º [Orthanc PACS Docker]          â”‚
â”‚  [USG Voluson] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜        â”‚                           â”‚
â”‚                                   â”‚                           â”‚
â”‚  [USG Voluson] â”€â”€â–º C-STORE â”€â”€â–º [Conquest PACS (Windows PC)]   â”‚
â”‚                         â””â”€â”€â–º Lua Hook â”€â”€â–º /api/internal/       â”‚
â”‚                                           radiology/studies    â”‚
â”‚  [Weasis Viewer] (local DICOM viewer on Windows)              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

External:
  [Tailscale VPN] â”€â”€â–º Remote Radiologist / Physician access
  [WhatsApp API] â”€â”€â–º Patient notifications
  [Payment Gateways] â”€â”€â–º ICICI / PhonePe / Razorpay / PayU / BharatPe / Cashfree / HDFC
  [Google Gemini API] â”€â”€â–º AI-assisted radiology reporting
```

---

## 3. Docker Container Inventory

| Container | Image | Purpose | Host Port |
|-----------|-------|---------|-----------|
| `care-db` | postgres:16-alpine | Primary PostgreSQL database | 5400â†’5432 |
| `care-db-patch-v2` | postgres:16-alpine | Schema patcher (runs & exits) | â€” |
| `care-api` | custom Node.js | Express API server | internal |
| `care-web` | Nginx | Static frontend + API proxy | 8888â†’80 |
| `care-migrate` | custom Node.js | Drizzle migrations (runs & exits) | â€” |

> **Critical:** `care-db-patch-v2` handles schema evolution via raw SQL patch scripts. Any table or column additions MUST be reflected in both Drizzle schema files AND the patch scripts.

---

## 4. Frontend Applications

### 4.1 Diagnostic ERP (`/artifacts/diagnostic-erp`)
Primary internal desktop app. ~140+ pages. Staff roles: Admin, Receptionist, Billing, Radiologist, Lab, Accountant, Manager.

### 4.2 Clinic Site (`/artifacts/clinic-site`)
Public-facing patient booking portal. Online test catalog, package booking, payment gateway integration.

---

## 5. Backend Architecture

- **Entry Point:** `artifacts/api-server/src/index.ts`
- **Router Mounting:** `artifacts/api-server/src/routes/index.ts` (100+ domain routers)
- **Middleware Stack:** Rate limiting â†’ Auth (`requireStaffAuth`) â†’ Permission check â†’ Route handler
- **Cron Scheduler:** `artifacts/api-server/src/cron.ts` â€” starts all background jobs

---

## 6. Authentication & Authorization

### Authentication
| Scope | Mechanism | Token Storage |
|-------|-----------|---------------|
| Staff | Username + PIN â†’ Bearer token | `portal_sessions` table |
| Internal API | `INTERNAL_API_KEY` env var | Header validation |
| Patient Portal | Session token | `portal_sessions` (scope=patient) |

### Authorization (RBAC)
- Stored in `role_permissions` table
- 9 canonical roles: Admin, Manager, Receptionist, Billing, Radiology Typist, Radiologist, Lab, Accountant
- Permission bits: `canView`, `canCreate`, `canEdit`, `canDelete`, `canPrint`, `canReprint`, `canRefund`, `canExport`, `canApprove`, `canFinalize`

---

## 7. Core Module Workflows

### Patient Management
```
Search/ID â†’ Demographics Entry â†’ Token Assignment â†’ Queue Display
```

### Billing
```
Test/Package Selection â†’ Discount/Voucher â†’ Payment â†’ Bill Generation â†’ Receipt Print
```

### Radiology
```
Worklist Entry â†’ Technician Claim â†’ AI Draft (Ollama/Gemini) â†’ Radiologist Edit â†’ Finalize/Lock â†’ PDF â†’ PACS Archive
```

### PACS Integration
```
Modality C-STORE â†’ [Orthanc or Conquest]
                        â†“
Conquest Lua Hook â†’ POST /api/internal/radiology/studies
                        â†“
                   ERP creates study record â†’ Worklist populated
                        â†“
Radiologist opens OHIF/Weasis â†’ Report drafted â†’ Finalized
                        â†“
PDF compiled by Playwright â†’ DICOM encapsulated â†’ Archived to Orthanc
```

### Form-F (Regulatory)
```
USG Obstetric Bill â†’ Scan OCR â†’ Field Extraction â†’ Form-F Record â†’ Gate blocks finalization until linked
```

### Payment (Online Booking)
```
Public booking â†’ Gateway selection â†’ Payment initiation â†’ Webhook callback â†’ Auto-confirm order â†’ Bill + Token created
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
| `artifacts/api-server/src/lib/pacsArchive.ts` | PDFâ†’DICOMâ†’Orthanc archival pipeline |
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

1. **No git history** â€” Repository has been developed without version control commits. All "restore points" are directory copies (`backup_*/`).
2. **Schema patching via db-patch-v2** â€” Column additions bypass Drizzle migrations; must manually keep in sync.
3. **CPU-only Ollama** â€” Synology DS1522+ has no GPU; AI inference is slow under concurrent load.
4. **Conquest PACS on Windows PC** â€” Not dockerized; requires manual Lua binary and script installation.
5. **mmap Git error** â€” Large files (SQL dumps, DOCX) cause `git add` failures on Windows; use `.gitignore` for binary assets.
6. **Tailscale dependency** â€” Remote radiologist OHIF access fails if Tailscale disconnects.
7. **Single DB instance** â€” No read replicas; heavy report queries can block writes.

---

## 14. Quick Reference â€” API Route Prefixes

| Prefix | File | Auth |
|--------|------|------|
| `/api/public/*` | `public-booking.ts`, `website.ts` | None |
| `/api/portal/*` | `tokens.ts`, `portal.ts` | Session |
| `/api/internal/*` | `internal-radiology.ts`, `internal-cron.ts`, `internal-backup.ts` | `INTERNAL_API_KEY` |
| `/api/*` (staff) | All others | `requireStaffAuth` |