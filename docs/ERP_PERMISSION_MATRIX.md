# ERP_PERMISSION_MATRIX.md
**Care Diagnostics ERP — Role & Permission Matrix**
*Audited: 2026-06-24 | Version: Phase 11 (commit 4250dab)*

---

## Role Definitions

| Role | Description | ERP Access Level |
|------|-------------|-----------------|
| `super_admin` | System owner/operator. USB key + session required for sensitive routes. | Full access to all routes |
| `admin` | Clinic administrator. Regular staff session. | Full access to all ERP routes |
| `staff` | Custom-permission role. Billing staff, receptionist, radiologist, lab tech, etc. | Only what permissions grant |

> **`FULL_ACCESS_ROLES = { "admin", "super_admin" }`** — these bypass all `requireStaffPermission` checks.

---

## Permission Namespace Reference

All permission strings stored in `users.permissions` (JSON array):

| Permission Path | Module | Description |
|----------------|--------|-------------|
| `/patients` | Patient Management | View/edit patient records |
| `/billing` | Billing | Create bills, edit, cancel, refund |
| `/payments` | Payments | View/manage payment records |
| `/reports` | Reports | Revenue reports, patient reports, signatures |
| `/orders` | Orders | View/manage service orders |
| `/tests` | Test Catalog | Manage tests (GET free for all staff) |
| `/accounting` | Accounting | Vouchers, accounts, ledgers, expenses |
| `/discounts` | Discounts | Apply/manage discounts |
| `/inventory` | Inventory | Stock management |
| `/form-f` | Form F | Compliance form management |
| `/dicom-nodes` | PACS/DICOM | PACS nodes, DICOM settings, pull agent |
| `/queue` | Queue | Token/queue management |
| `/banking` | Banking | Bank account management |
| `/radiology` | Radiology | (not currently used as standalone — all staff access) |
| `/settings:users` | Settings → Staff | User/staff management |
| `/settings:clinic` | Settings → Clinic | Clinic settings, branding |
| `/settings:notifications` | Settings → Notifications | Email, WhatsApp, chatbot |
| `/settings:infrastructure` | Settings → Infrastructure | Machines, departments, templates, PACS |
| `/settings:devices` | Settings → Devices | Printers |
| `/settings:backup` | Settings → Backup | Backup replication config |
| `/day-close` | Day Close | Day-close workflow |
| `ai_reporting.use` | AI Reporting | Use Local AI (Ollama) assistant |

---

## Route-Level Access Control Matrix

### 🔓 Public Routes (No Authentication)

| Endpoint | Purpose | Security Control |
|----------|---------|-----------------|
| `GET /health` | Health check | None |
| `GET /clinic-settings/branding` | Bill print logo, clinic name | Returns non-sensitive branding only |
| `GET /api/public/booking/*` | Online booking flow | Rate limited (20/hr booking, 10/15min orders) |
| `POST /api/public/booking/payu-*` | PayU payment callbacks | HMAC signature verified |
| `POST /api/public/booking/phonepe-*` | PhonePe payment flow | Server-side status check |
| `POST /api/public/booking/bharatpe-*` | BharatPe payment flow | Rate limited |
| `POST /api/public/booking/icici-*` | ICICI payment callbacks | Signature verified |
| `GET /api/public/booking/razorpay-*` | Razorpay callbacks | HMAC verified |
| `GET /kiosk/*` | Self-registration kiosk | Rate limited |
| `GET|POST /whatsapp/webhook` | WhatsApp webhook | Meta hub.verify_token |
| `GET|POST /wa-chatbot/webhook` | WA Chatbot webhook | Provider token |
| `POST /banking/webhooks` | Banking webhooks | ⚠️ No signature verified (MED-003) |
| `GET /portal/*` | Patient portal | Patient session token |
| `GET /display/queue` | Waiting room display | `requireStaffAuth` ✅ |
| `GET /teleradiology/*` | Teleradiology viewer | Share token (TTL-gated) |
| `GET /p/r/*` | Patient PDF download | Report share token |
| `GET /verify/*` | Bill QR verification | Read-only, no PII |
| `GET /website/*` | Clinic website | GET public, mutations staff-gated |
| `POST /internal/cron/*` | Cron triggers | `CRON_SECRET` bearer |
| `GET /internal/backup` | DB backup stream | `INTERNAL_API_KEY` bearer |
| `POST /internal/*` | PACS automation | `INTERNAL_API_KEY` bearer |
| `GET|POST /scan-sessions/*` | Phone scan pairing | Session token (5-min expiry) |
| `GET /auth/webauthn/authenticate/*` | FIDO2 authentication | Public (challenge-response protocol) |

---

### 🔐 Staff-Authenticated Routes

#### Core ERP Modules

| Endpoint Prefix | Staff Auth | Permission Required | Notes |
|----------------|-----------|---------------------|-------|
| `GET /tests` | ✅ | None (GET free for all) | Mutations need `/tests` |
| `PUT/POST/DELETE /tests` | ✅ | `/tests` | |
| `/patients` | ✅ | `/patients` | PHI gated |
| `/doctors` | ✅ | `/doctors` | |
| `/orders` | ✅ | `/orders` | |
| `/bills` | ✅ | `/billing` | Financial records |
| `/payments` | ✅ | `/payments` | Financial records |
| `/reports` | ✅ | `/reports` | PHI + revenue |
| `/inventory` | ✅ | `/inventory` | |
| `/accounting` | ✅ | `/accounting` | Financial |
| `/expenses` | ✅ | `/accounting` | Financial |
| `/ledgers` (GET) | ✅ | None (read all staff) | |
| `/ledgers` (mutations) | ✅ | `/accounting` | |
| `/discounts` | ✅ | `/discounts` | |
| `GET /discount-reasons` | ✅ | None (GET free) | |
| `PUT/POST /discount-reasons` | ✅ | `/discounts` | |
| `/form-f` | ✅ | `/form-f` | PHI + compliance |
| `/patient-reports` | ✅ | `/reports` | PHI |
| `/signatures` | ✅ | `/reports` | |
| `/tokens` | ✅ | `/queue` | |
| `/test-tokens` | ✅ | `/queue` | |
| `/banking` | ✅ | `/banking` | Financial |
| `/day-close` | ✅ | None (own records) | Admin ops inline-gated |
| `/books-sanity` | ✅ | `/day-close` | |
| `/whatsapp` | ✅ | None | |
| `/sync` | ✅ | None | |
| `/samples` | ✅ | None | |
| `/appointments` | ✅ | None | |
| `/online-bookings` | ✅ | None | |
| `/packages` | ✅ | None | |
| `/daily-summary` | ✅ | None | |
| `/dashboard/advanced-summary` | ✅ | None | |
| `/dashboard/my-daily-summary` | ✅ | None | |
| `/resolve-barcode` | ✅ | None | |
| `/uploads` | ✅ | None | Rate limited |

#### Settings Module

| Endpoint Prefix | Staff Auth | Permission | Notes |
|----------------|-----------|------------|-------|
| `GET /clinic-settings` | ✅ | None (read all staff) | ⚠️ Returns full row incl. secrets (HIGH-003) |
| `PUT /clinic-settings` (quick test ids, print copies) | ✅ | None (billing-owned) | Whitelist: `quickTestIds`, `billPrintCopies` |
| `PUT /clinic-settings` (all other fields) | ✅ | `/settings:clinic` | |
| `POST /clinic-settings/ollama` | ✅ | `/settings:clinic` (via middleware chain) | ⚠️ Verify chain order |
| `/email-settings` | ✅ | `/settings:notifications` | |
| `GET /test-categories` | ✅ | None (read free) | |
| `PUT/POST /test-categories` | ✅ | `/settings:infrastructure` | |
| `/report-templates` | ✅ | `/settings:infrastructure` | |
| `/abnormal-findings` | ✅ | `/settings:infrastructure` | |
| `/machines` | ✅ | `/settings:infrastructure` | |
| `/departments` | ✅ | `/settings:infrastructure` | |
| `/floors`, `/rooms`, `/modalities` | ✅ | `/settings:infrastructure` | |
| `/branches` | ✅ | `/settings:infrastructure` | |
| `/printers` | ✅ | `/settings:devices` | |
| `/vendors` | ✅ | `/settings:infrastructure` | |
| `/staff` | ✅ | `/settings:users` | |
| `/hr-forms` | ✅ | `/settings:users` | |
| `/storage/` | ✅ | `/settings` (any) | Employee PII gated |
| `/users` (preferences) | ✅ | None (own preferences) | |
| `/users` (all) | ✅ | `/settings:users` | |
| `/wa-chatbot` | ✅ | `/settings:notifications` | |
| `/admin/backup-replication` | ✅ | `/settings:backup` | |
| `/auth/webauthn` | ✅ | None | Credential management |

#### PACS / DICOM / Radiology

| Endpoint Prefix | Staff Auth | Permission | Risk Notes |
|----------------|-----------|------------|-----------|
| `/pacs` | ✅ | `/dicom-nodes` | ✅ |
| `/dicom` | ✅ | `/dicom-nodes` | ✅ |
| `/dicom-agent` | ✅ | `/dicom-nodes` | ✅ |
| `/dicom-uploads` | ✅ | None | ⚠️ Should require `/dicom-nodes` |
| `/dicom-studies` | ✅ | None | ⚠️ Should require `/dicom-nodes` |
| `/dicom-workflow` | ✅ | None | ⚠️ Should require `/dicom-nodes` |
| `/smart-radiology` | ✅ | None | |
| `/ris-monitor` | ✅ | None | |
| `/radiology-workflow` | ✅ | None | |
| `/radiology` (enterprise) | ✅ | None | ⚠️ Missing admin guard on mutations |
| `/radiology` (base router) | ✅ | None | All staff read |
| `/radiology/report-generator` | ✅ | None | |
| `/radiology/structured-report-templates` | ✅ | None | |
| `/radiology/snippets` | ✅ | None | |
| `/radiology/knowledge` | ✅ | None | |
| `/radiology/smart` | ✅ | None | |
| `/ai-reporting` | ✅ | None (sub-permission inline) | |
| `/ai-prompt-templates` | ✅ | None | |
| `/ai-prompt-library` | ✅ | None | |
| `/ai-model-routing` | ✅ | None | |
| `/ai-comparison` | ✅ | None | |
| `/teaching-cases` | ✅ | None | |
| `/radiology-copilot` | ✅ | None | |
| `/radiology-memory` | ✅ | None | |
| `/radiology-lesions` | ✅ | None | |
| `/radiology-spine` | ✅ | None | |
| `/radiology-brain` | ✅ | None | |
| `/radiology-tumor` | ✅ | None | |
| `/radiology-annotations` | ✅ | None | |
| `/radiology-ollama` | ✅ | `ai_reporting.use` (inline per action) | ✅ |
| `/usg-extraction` | ✅ | None (admin check inline for settings) | |
| `/usg-doppler` | ✅ | None | |
| `/usg-reports` | ✅ | None | |
| `/usg-critical` | ✅ | None | |
| `/usg-analytics` | ✅ | None | |
| `/echo-cardiology` | ✅ | None | |
| `/fetal-usg` | ✅ | None | |

#### Super Admin Only

| Endpoint Prefix | Auth Required | Notes |
|----------------|---------------|-------|
| `/commission` | Super Admin session | Doctor referral commissions |
| `/doctor-ledger` | Super Admin session | Doctor payout ledger |
| `/backup` | Super Admin session | DB backup operations |
| `/system` | Super Admin session | System management |
| `/admin/audit-logs` | Super Admin + USB | Double-gated |
| `/admin/role-permissions` | Super Admin + USB | Double-gated |
| `/admin/system-health` | Super Admin + USB | Double-gated |

---

## Overpowered Role Analysis

### `admin` Role — Identified Overreach

| Capability | Risk | Recommendation |
|------------|------|----------------|
| Full access to all 113 routes without restriction | If admin account is compromised, complete system access | No change needed — this is by design for clinic administrator |
| Can access `/commission` and `/doctor-ledger` | Financial fraud risk | These are super-admin only — admin is correctly BLOCKED |
| Can modify role permissions | Self-privilege escalation | ✅ Role permissions are `requireSuperAdmin` |

**Finding:** `admin` cannot access super-admin routes — `requireSuperAdmin` checks `role === "super_admin"`. This is correct. The admin role is safely bounded.

---

### `staff` Role — Permission Gaps Found

| Scenario | Current State | Risk |
|----------|--------------|------|
| Receptionist with `/billing` can view OHIF/Weasis viewer | All staff see radiology routes | Medium — radiology images accessible without imaging permission |
| Lab tech can modify AI prompt templates | No radiology sub-permission | Low — templates affect AI suggestions only |
| Billing staff can delete radiology lesion tracking entries | No write sub-permission | Medium — data integrity risk |
| Any staff can create DICOM routing rules | ⚠️ HIGH-001 | High |
| Any staff can pair a scan session phone | ⚠️ HIGH-002 | High |

---

## Unused Permissions (Defined but Never Checked in Routes)

Based on route audit, the following permission strings are **defined in role-permissions templates** but not enforced by any route:

| Permission | Status |
|------------|--------|
| `/radiology` | Defined but not checked — all staff access radiology anyway |
| `/ai` | Not used as a route permission (aiRouter uses per-module checks) |
| `/dashboard` | Not enforced as a route permission |
| `/search` | Not enforced as a route permission |

**Recommendation:** Either enforce these or remove them from role permission templates to avoid confusing admins into thinking they restrict access.

---

## Missing Permissions (Routes Without Adequate Permission Checks)

| Route Group | Current | Recommended |
|-------------|---------|-------------|
| `POST/DELETE /radiology/routing-rules` | Staff Auth only | `/settings:infrastructure` |
| `POST /radiology/pacs-settings/load-defaults` | Staff Auth only | `/settings:infrastructure` |
| `GET /radiology/failed-queue` | Staff Auth only | `/dicom-nodes` |
| `POST /radiology/failed-queue/:id/retry` | Staff Auth only | `/dicom-nodes` |
| `/dicom-uploads` (POST/DELETE) | Staff Auth only | `/dicom-nodes` |
| `/dicom-studies` mutations | Staff Auth only | `/dicom-nodes` |
| Radiology knowledge mutations (PUT/DELETE) | Staff Auth only | `radiology.write` (new) |
| Teaching cases mutations | Staff Auth only | `radiology.write` (new) |
| Radiology AI template mutations | Staff Auth only | `radiology.write` (new) |

---

## Permission String Recommendations (New Permissions to Add)

| New Permission | Purpose | Assign to |
|---------------|---------|-----------|
| `radiology.write` | Create/edit/delete radiology reports, templates, lesions | Radiologist role |
| `radiology.finalize` | Finalize/sign radiology reports | Senior radiologist only |
| `ai_reporting.configure` | Modify AI prompt templates and model routes | Admin |
| `dicom.upload` | Upload DICOM studies | DICOM operator role |
| `pacs.configure` | Modify PACS routing rules and viewer settings | Admin/PACS admin |

---

## Role-Based Default Permission Templates

### Recommended Role Templates

#### `billing_receptionist`
```json
["/billing", "/payments", "/patients", "/orders", "/queue", "/appointments", "/packages"]
```

#### `lab_technician`
```json
["/orders", "/samples", "/patients"]
```

#### `radiologist`
```json
["/radiology", "radiology.write", "radiology.finalize", "/dicom-nodes", "ai_reporting.use", "/patients", "/reports"]
```

#### `radiology_technician`
```json
["/radiology", "dicom.upload", "/dicom-nodes"]
```

#### `accountant`
```json
["/accounting", "/billing", "/payments", "/reports", "/day-close"]
```

#### `clinic_manager`
```json
["/billing", "/payments", "/patients", "/doctors", "/accounting", "/reports", "/staff", "/settings:clinic", "/settings:users", "/queue", "/orders"]
```

---

## Super Admin Route Summary

Routes requiring `super_admin` role (blocked for `admin`):

| Route | Justification |
|-------|--------------|
| `POST /api/super-admin/login` | Separate portal with PIN |
| `GET /api/commission` | Doctor referral financial data |
| `GET /api/doctor-ledger` | Doctor payout records |
| `POST /api/backup/run` | Full DB backup |
| `GET /api/admin/audit-logs` | Security audit logs |
| `POST /api/admin/role-permissions/seed` | Reset all role permissions |
| `GET /api/admin/system-health` | System diagnostics |

All above routes also require `requireSuperAdminUsb` (physical USB key) except `/super-admin/login` itself.

---

## PACS / Viewer Access Summary

| Surface | Access Control | Notes |
|---------|---------------|-------|
| OHIF (`:3010`) | LAN only, no auth | Direct PACS viewer — safe if LAN-only |
| Weasis (launch URL from ERP) | Staff Auth required to generate URL | URL generation gated |
| Orthanc (`:8042`) | LAN only, single-user config | Not exposed via Cloudflare Tunnel |
| DICOM Q/R API | Staff Auth | No DICOM-specific permission |
| DICOM Pull Jobs | Staff Auth | No DICOM-specific permission |
| PACS Settings (viewer URLs) | Staff Auth | ⚠️ Missing admin check |
| MWL Procedures | Staff Auth | No DICOM-specific permission |

---

## Cloudflare Tunnel Exposure

| Service | Exposed Publicly | Auth |
|---------|-----------------|------|
| ERP API (`:8080` → `caredeoghar.com`) | ✅ Yes | Staff Auth required |
| Open WebUI (`:3000` → `webui.caredeoghar.com`) | ✅ Yes | Open WebUI login required |
| OHIF Viewer (`:3010`) | ❌ LAN only | N/A |
| Orthanc (`:8042`) | ❌ LAN only | N/A |
| Ollama (`:11434`) | ❌ MUST STAY LAN only | N/A |

> ⚠️ **CRITICAL:** Never expose Ollama port 11434 via Cloudflare Tunnel. AI model inference must remain LAN-only.

---

## Audit Notes & Caveats

1. **Audit date:** 2026-06-24. This matrix reflects code at git commit `checkpoint before security audit`.
2. **Inline auth checks:** Some routes use manual `req.staffSession` checks inside handlers instead of middleware — these are equivalent but less maintainable.
3. **Permission inheritance:** `admin` and `super_admin` bypass all `requireStaffPermission` via `FULL_ACCESS_ROLES`.
4. **Foreign key assumption:** User-owned records (radiology reports, day-close, AI drafts) do not validate ownership on read — any authenticated staff can read any record.
5. **This document should be updated:** whenever new routes are added, permissions are changed, or roles are modified.
