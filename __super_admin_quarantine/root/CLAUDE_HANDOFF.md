# Claude / AI Assistant Handoff Guide
**Care Diagnostics ERP** | Version: 2.0 (June 2026)

> **READ THIS FIRST.** This document is specifically designed for Claude Sonnet, Codex, GitHub Copilot, or any future AI assistant picking up work on this codebase. Read all sections before writing any code.

---

## 1. Who You Are Working For

**Client:** Care Diagnostics, Deoghar, Jharkhand, India
**System:** A full hospital ERP for a diagnostic imaging center
**Key User:** The clinic owner/radiologist uses an ASUS i9 Windows PC on LAN. Radiologists sometimes access remotely via Tailscale VPN.
**Deployment:** Synology DS1522+ NAS running Docker Compose. **There is NO cloud database.** Everything runs locally.

---

## 2. The Five Most Important Things to Know

### 2.1 This is a Monorepo
```
pnpm workspaces:
  - artifacts/api-server       ← Express.js backend
  - artifacts/diagnostic-erp   ← Internal staff SPA
  - artifacts/clinic-site      ← Public booking site
  - artifacts/super-admin-portal ← Owner console
  - lib/db                     ← Shared Drizzle ORM schema (@workspace/db)
```
Always use `@workspace/db` for database access. Never write raw SQL unless in migration files.

### 2.2 The DB Patch Container is Critical
The `care-db-patch-v2` Docker container runs raw SQL patches on every deploy. When you add a **new column or table**, you must add it to BOTH:
1. `lib/db/schema/*.ts` (Drizzle schema)
2. The patch SQL file inside `docker/db-patch-v2/` (for the patch container)

If you only do one, the schema will be out of sync and the app will crash.

### 2.3 The PACS Hook Is the Heart of Radiology Intake
```
Modality (MRI/CT/USG) 
    → C-STORE 
    → Conquest PACS (Windows PC on LAN)
    → Lua script (conquest/erp_notify.lua) fires HTTP POST
    → /api/internal/radiology/studies
    → ERP creates study record
    → Worklist populated
```
Any changes to `internal-radiology.ts` **break the entire study intake workflow**. Test with extreme care.

### 2.4 Report PDF = Playwright
Reports are rendered by Playwright (headless Chromium) loading an HTML template and printing to PDF. The service is in `radiology-report-generator.ts`. This requires Chromium to be installed in the Docker container.

### 2.5 Super Admin = USB Key
High-privilege operations (backups, payout overrides, role changes) require a physical USB drive with `superadmin.key` file. The key is validated via `X-SA-USB-Key` HTTP header against the `SUPER_ADMIN_USB_KEY` environment variable. **Never remove this gate.**

---

## 3. Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20 + Express.js (TypeScript) |
| Frontend | Vite 5 + React 18 (TypeScript) |
| Database | PostgreSQL 16 via Drizzle ORM |
| Styling | Vanilla CSS (no Tailwind) |
| Package Manager | pnpm (workspaces) |
| Runtime | Docker Compose on Synology NAS |
| AI (local) | Ollama (CPU inference, slow) |
| AI (cloud) | Google Gemini API |
| PACS | Conquest PACS (Windows) + Orthanc (Docker) |
| Viewers | OHIF (Docker) + Weasis (local) |
| VPN | Tailscale mesh |
| Payment | ICICI Orange Pay (primary) + 6 others |

---

## 4. Rules You Must Never Break

### NEVER remove these features (previous instructions mandate this):
- ✅ Findings Library (Chocolate Box / Smart Findings)
- ✅ Template Library (report templates)
- ✅ Chocolate Box functionality
- ✅ AI Draft feature
- ✅ Command Center
- ✅ Report workflow
- ✅ PACS integration
- ✅ Radiologist Favorites & Personal Macros (new as of June 2026)

### NEVER do these without explicit user approval:
- ❌ Drop any database tables
- ❌ Remove the USB super-admin gate
- ❌ Change the `/api/internal/radiology/studies` endpoint signature
- ❌ Modify the Lua hook (`conquest/erp_notify.lua`) without testing
- ❌ Change the `SUPER_ADMIN_USB_KEY` validation logic
- ❌ Remove the `care-db-patch-v2` container from docker-compose

### ALWAYS do these:
- ✅ Create a git checkpoint (or manual backup copy) before major changes
- ✅ Update `lib/db/schema` AND the patch container SQL when changing DB
- ✅ Keep TypeScript strict — no `any` without justification
- ✅ Use `@workspace/db` for all database access
- ✅ Test PACS workflow if touching radiology routes
- ✅ Write `.md` documentation in the project root for significant features

---

## 5. File Locations Cheat Sheet

### "Where do I put...?"

| What | Where |
|------|-------|
| New API endpoint | `artifacts/api-server/src/routes/newfeature.ts` + register in `index.ts` |
| New DB table | `lib/db/schema/newfeature.ts` + export in schema index + add to patch SQL |
| New frontend page | `artifacts/diagnostic-erp/src/pages/NewPage.tsx` + add route in `App.tsx` |
| New background job | `artifacts/api-server/src/cron.ts` — add new `scheduleSomething()` function |
| New payment provider | `artifacts/api-server/src/lib/payments/NewProvider.ts` + register in `PaymentEngine.ts` |
| New AI feature | `artifacts/api-server/src/routes/radiologyNewThing.ts` |
| Environment variable | `.env.example` (document it) + `docker-compose.yml` (pass to container) |
| Documentation | Project root `.md` file |

### "Where is...?"

| What | Location |
|------|---------|
| Auth middleware | `artifacts/api-server/src/middleware/requireStaffAuth.ts` |
| USB gate middleware | `artifacts/api-server/src/middleware/requireSuperAdminUsb.ts` |
| All cron jobs | `artifacts/api-server/src/cron.ts` |
| PACS archive (PDF→DICOM) | `artifacts/api-server/src/lib/pacsArchive.ts` |
| Payment engine | `artifacts/api-server/src/lib/payments/PaymentEngine.ts` |
| Object storage | `artifacts/api-server/src/lib/objectStorage.ts` |
| Conquest Lua hook | `conquest/erp_notify.lua` |
| DICOM pull agent | `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts` |
| All DB tables/schema | `lib/db/schema/` |
| Docker stack | `docker-compose.yml` |

---

## 6. Common Development Workflows

### Adding a New API Route
```typescript
// 1. Create: artifacts/api-server/src/routes/myfeature.ts
import { Router } from 'express';
import { requireStaffAuth } from '../middleware/requireStaffAuth';
import { db } from '@workspace/db';

const router = Router();

router.get('/', requireStaffAuth, async (req, res) => {
  // ...
});

export default router;

// 2. Register in: artifacts/api-server/src/routes/index.ts
import myfeatureRouter from './myfeature';
app.use('/api/myfeature', myfeatureRouter);
```

### Adding a New DB Table
```typescript
// 1. Create: lib/db/schema/myfeature.ts
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const myFeatureTable = pgTable('my_feature', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Export in: lib/db/schema/index.ts
export * from './myfeature';

// 3. Add SQL to: docker/db-patch-v2/patch.sql
CREATE TABLE IF NOT EXISTS my_feature (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Adding a New Cron Job
```typescript
// In: artifacts/api-server/src/cron.ts

function scheduleMyNewJob() {
  cron.schedule('0 6 * * *', async () => { // daily at 6am
    try {
      await fireMyNewJob();
    } catch (err) {
      console.error('[cron] My new job failed:', err);
    }
  });
  console.log('[cron] My new job scheduler started');
}

async function fireMyNewJob() {
  // implementation
}

// Add to startCronScheduler():
export function startCronScheduler() {
  // ... existing jobs ...
  scheduleMyNewJob();
}
```

---

## 7. Database Quick Reference

### Key Tables
| Table | Purpose |
|-------|---------|
| `patients` | Patient demographics |
| `orders` | Test orders |
| `order_tests` | Individual tests in an order |
| `bills` | Bill records |
| `payments` | Payment transactions |
| `tokens` | Queue tokens |
| `radiology_studies` | DICOM study records from PACS |
| `radiology_worklist` | Radiologist work queue |
| `report_templates` | Report template library |
| `structured_report_templates` | Structured AI templates |
| `radiology_findings` | Findings library (Chocolate Box) |
| `radiology_snippets` | Radiologist personal snippets |
| `radiology_favorites` | Radiologist starred items |
| `portal_sessions` | Auth sessions (staff + patient) |
| `role_permissions` | RBAC permission matrix |
| `clinic_settings` | ALL system configuration (105+ columns) |
| `audit_logs` | Security & change audit trail |
| `dicom_nodes` | DICOM node configurations |
| `dicom_pull_jobs` | DICOM auto-pull job queue |
| `bank_accounts` | Linked bank accounts |
| `bank_transactions` | Imported bank transactions |
| `backup_jobs` | Scheduled backup job definitions |
| `backup_job_logs` | Backup execution history |
| `audit_runs` | Money-trail audit snapshots |

### Querying Pattern (Drizzle)
```typescript
import { db } from '@workspace/db';
import { patientsTable } from '@workspace/db/schema';
import { eq, and, gte } from 'drizzle-orm';

// Select
const patients = await db
  .select()
  .from(patientsTable)
  .where(eq(patientsTable.id, patientId));

// Insert
const [newPatient] = await db
  .insert(patientsTable)
  .values({ name: 'John', phone: '9876543210' })
  .returning();

// Transaction
await db.transaction(async (tx) => {
  await tx.insert(ordersTable).values({...});
  await tx.insert(billsTable).values({...});
});
```

---

## 8. Radiology Workflow Deep Dive

This is the most complex part of the system. Read carefully.

```
1. STUDY INTAKE (PACS → ERP)
   Modality sends DICOM → Conquest on Windows PC
   Conquest's erp_notify.lua fires POST /api/internal/radiology/studies
   internal-radiology.ts creates radiology_studies record
   Study appears in RadiologyWorklist

2. TECHNICIAN PHASE
   Technician opens RadiologyWorklist, claims study (status: scanning)
   Patient is prepared, scan proceeds

3. RADIOLOGIST PHASE
   Radiologist opens CommandCenter or RadiologyWorklist
   Opens OHIF Viewer (Docker, accessed via DICOMweb proxy)
   OR opens Weasis (local Windows DICOM viewer)
   Drafts report in RadiologyReportingWorkspace
   AI Copilot (Ollama/Gemini) suggests findings
   Smart Findings (Chocolate Box) allows inserting saved findings
   Radiologist edits, finalizes, signs off

4. REPORT GENERATION
   Playwright renders HTML template → PDF
   PDF stored in object storage (local MinIO-compatible)
   PDF archived to Orthanc as DICOM Encapsulated Document

5. DELIVERY
   Report delivery tracking updated
   WhatsApp notification sent to patient
   QR code on report links to verification page
```

---

## 9. Radiology Report Features Reference

| Feature | Location | Notes |
|---------|----------|-------|
| Chocolate Box (findings library) | `radiologySmartFindings.ts` | Pre-written findings by category |
| Personal Favorites | `radiology_favorites` table | Per-radiologist starred findings/impressions |
| Personal Macros | `radiology_snippets` table | Custom text shortcuts |
| Favorite Templates | `structured_report_templates` with `isFavorite` flag | Quick-access templates |
| AI Draft | `radiologyOllama.ts` / `radiologyCopilot.ts` | One-click AI suggestions |
| Brain MRI Structured | `radiologyBrainIntelligence.ts` | Section-by-section brain protocol |
| Spine MRI Structured | `radiologySpineIntelligence.ts` | Cervical/thoracic/lumbar levels |
| Normal Templates | `NormalReportTemplates.tsx` | "Within Normal Limits" quick fill |
| Report Diff Viewer | `ReportDiffViewer.tsx` | Compare report versions |

---

## 10. PACS Technical Details

### Conquest PACS (Windows PC, LAN)
- Runs as Windows service on clinic's ASUS i9 PC
- Modalities send to Conquest via DICOM C-STORE
- Conquest fires `erp_notify.lua` on study receive
- Lua script does `http.request('POST', ERP_URL, jsonPayload)`
- ERP_URL = `http://<synology-ip>:8888/api/internal/radiology/studies`
- Auth: `X-Internal-API-Key` header must match `INTERNAL_API_KEY` env var

### Orthanc PACS (Docker container)
- Runs alongside ERP in Docker Compose
- Modalities can also C-STORE directly to Orthanc
- OHIF Viewer reads from Orthanc via DICOMweb
- ERP archives PDF reports as DICOM Encapsulated Documents to Orthanc

### DICOM Auto-Pull (In-Process Agent)
- Enable with `ENABLE_DICOM_PULL_AGENT=1`
- Uses `dcmjs-dimse` library (pure Node.js, no external DCMTK needed)
- Polls `dicom_nodes` table for nodes with `autoPull=true`
- Creates `dicom_pull_jobs` records; agent processes them

---

## 11. Environment Setup for Development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file
cp .env.example .env
# Edit .env with your local values

# 3. Start DB (Docker)
docker compose up care-db -d

# 4. Run migrations
pnpm --filter @workspace/api-server db:migrate

# 5. Start API server
pnpm --filter @workspace/api-server dev

# 6. Start ERP frontend
pnpm --filter @workspace/diagnostic-erp dev

# Key URLs:
# API: http://localhost:3000
# ERP: http://localhost:5173
# Admin: http://localhost:5174
```

---

## 12. AI Model Routing

### Ollama (Local)
- Runs on Synology NAS (CPU only, no GPU)
- URL: `OLLAMA_BASE_URL` env var (e.g. `http://192.168.1.x:11434`)
- Models: usually `llama3`, `mistral`, or `phi3`
- **SLOW** — CPU inference, 30–120 seconds per request
- Used for: radiologist AI draft suggestions (offline-capable)

### Gemini (Cloud)
- API Key: `GEMINI_API_KEY` env var
- Used for: higher quality AI suggestions, cloud fallback
- **Cost-sensitive** — monitor usage
- Unavailable during internet outages

### Routing Logic
- `radiologyOllama.ts` handles Ollama specifically
- `radiologyCopilot.ts` handles the unified copilot (can use either)
- `aiModelRoutes.ts` allows admin to configure routing preferences

---

## 13. Payment Gateway Notes

### Primary (ICICI Orange Pay)
- Most tested and used for online bookings
- Domain whitelisting is strict: production URLs must match exactly
- `PUBLIC_BASE_URL` must be set correctly in `.env`
- Callback URL: `GET/POST /api/public/booking/icici-callback`

### Domain Normalization (CRITICAL)
In `PaymentEngine.ts` and `public-booking.ts`, return URLs are forced to `https://caredeoghar.com` in production. This is intentional — banks whitelist exact domains. Do NOT change this without updating bank whitelisting.

### Adding a New Gateway
1. Create `NewGatewayPaymentProvider.ts` in `lib/payments/`
2. Implement `PaymentProvider` interface
3. Register in `PaymentEngine.ts` switch-case
4. Add credentials to `.env.example` and `docker-compose.yml`
5. Add callback handler in `public-booking.ts`

---

## 14. Known Gotchas & Traps

| Gotcha | Details |
|--------|---------|
| **pnpm workspace imports** | Always use `@workspace/db`, not relative paths to lib/db |
| **IST dates** | Use `lib/istDate.ts` for Indian timezone. Never use plain `new Date()` for business dates |
| **Clinic settings** | Everything is in `clinic_settings` table (105+ columns). Don't add new config tables without consulting existing patterns |
| **Bill number sequence** | Always use `generateBillNumber(ledgerId)` — never generate manually |
| **Patient ID sequence** | Always use `patient_counter` table via API — never generate manually |
| **Session scope** | Sessions have `scope: 'staff' | 'patient'`. Always filter by scope in queries |
| **Playwright PDF** | Requires `--no-sandbox` flag in Docker. Do not remove |
| **Object storage paths** | Files stored under `/app/data/object-storage/` in Docker. Path must be a Docker volume mount |
| **Audit log writes** | All sensitive operations must write to `audit_logs`. Do not skip this |
| **Rate limiting** | All public routes have rate limits. Don't add internal API calls to public routes |
| **Git state** | The repo was developed without regular commits. Do NOT assume git blame is useful |
| **mmap error** | Large binary files cause `git add` to fail on Windows. Use `.gitignore` for `*.dump`, `*.docx`, `*.exe` |

---

## 15. Documentation Ecosystem

Read these documents in order when starting a task:

1. **`ERP_MASTER_CONTEXT.md`** — System overview, architecture, workflows (START HERE)
2. **`REPOSITORY_INDEX.md`** — Complete file map
3. **`FEATURE_INVENTORY.md`** — Every feature, status, and recommendation
4. **`CLAUDE_HANDOFF.md`** — This document (AI-specific guidance)
5. **`ERP_PERMISSION_MATRIX.md`** — For authorization/RBAC work
6. **`ERP_PACS_DOCUMENTATION.md`** — For any PACS/DICOM work
7. **`ERP_DEPLOYMENT_RUNBOOK.md`** — For deployment/infrastructure work
8. **`ERP_TECHNICAL_DEBT.md`** — For cleanup/refactoring work
9. **`Radiology_Architecture_Master.md`** — For deep radiology feature work
10. **`docs/`** folder — Additional architecture documentation

---

## 16. Recommended Next Development Priorities

Based on the technical debt audit and system state, these are the highest-value items:

### Critical (Fix First)
1. **Delete `env` and `env_my_temp.txt`** from root — potential secret exposure
2. **Delete `BillingDesk.bak.tsx`** — backup file in pages directory
3. **Delete duplicate `.md` files** with "(copy)" in name
4. **Establish git workflow** — commit history is empty; all versions are directory copies

### High Value
1. **Complete WebAuthn/FIDO2** — biometric login is partially built but not wired
2. **Enable Orthanc as primary PACS** — Conquest is legacy, Orthanc is already in Docker
3. **Retire `dicom-pull-agent/` folder** — replaced by in-process dimse-agent
4. **Fix schema sync** — ensure db-patch-v2 SQL matches Drizzle schema exactly

### Medium Value
1. **Complete Voice Dictation** — browser speech API implementation is started
2. **Expand WhatsApp Chatbot flows** — infrastructure exists, flows are minimal
3. **Wire Hanging Protocols to OHIF** — OHIF supports hanging protocols via config
4. **Build Teaching Analytics** — page exists but has no real metrics

### Low Priority
1. Evaluate and remove experimental AI pages if unused (RAG, Training Data, etc.)
2. Complete HL7 integration if any HL7-capable lab equipment is connected
3. Expand multi-site/multi-location support if second branch opens

---

## 17. Contact & Context

- **Deployment URL:** `https://caredeoghar.com` (via Tailscale or direct)
- **Local NAS IP:** Check Tailscale dashboard (100.x.x.x range)
- **Conquest PACS:** Runs on Windows PC (ASUS i9) on clinic LAN
- **Modalities on LAN:** MRI, CT Scan, USG Voluson
- **Primary radiologist workflow:** ASUS i9 Windows PC → Chrome browser → ERP
- **Remote access:** Tailscale VPN → OHIF viewer → ERP API

---

*This handoff document was generated: June 2026. Review and update after each major development sprint.*
