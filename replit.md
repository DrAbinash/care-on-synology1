# Overview

This pnpm monorepo, built with TypeScript, provides a comprehensive Diagnostic ERP system. Its purpose is to streamline operations for diagnostic centers, covering patient management, billing, lab operations, inventory, accounting, and AI-driven insights. The system supports both web and self-contained Windows desktop applications. The business vision is to modernize diagnostic center workflows, improve efficiency, and elevate patient care through intelligent automation.

# User Preferences

I prefer iterative development. I want to be asked before you make any major changes to the codebase. I prefer clear and concise explanations.

- **Default staff landing page**: `abinashsingh@gmail.com` lands on `/my-daily-summary` after login; all other staff users land on their first permitted page.
- **My Daily Summary staff filter**: Defaults to "All Staff / Total" (not the logged-in user's name).

# System Architecture

## Stack

-   **Monorepo tool**: pnpm workspaces
-   **Node.js version**: 24
-   **Package manager**: pnpm
-   **TypeScript version**: 5.9
-   **API framework**: Express 5
-   **Database**: PostgreSQL + Drizzle ORM
-   **Validation**: Zod, `drizzle-zod`
-   **API codegen**: Orval (from OpenAPI spec)
-   **Build**: esbuild (CJS bundle)

## UI/UX Decisions

The system features a unified single-page billing workflow, customizable quick test slots, and a modern dashboard. Key UI/UX elements include patient photo capture, a comprehensive report generator with auto-flagging and voice readout, a PACS viewer, a day-view appointment scheduler, WebAuthn-powered fingerprint kiosk for staff, and mobile-friendly patient and staff portals.

## Technical Implementations

The API server uses Express 5. The database schema is managed with Drizzle ORM. AI integration leverages the Gemini REST API for clinical note generation, billing insights, and patient communication. Email notifications are powered by Nodemailer and `node-cron`. In-process schedulers are gated behind `ENABLE_SCHEDULERS=1` for execution on always-on hosts, with API endpoints available for cloud-based scheduled deployments. The system is designed for cross-platform compatibility (Windows, macOS, Linux) and supports Dockerized deployment. Security features include SSRF-guarded `tcpProbe` and bearer token authentication. All API endpoints returning patient data sanitize `portalPinHash` to `hasPortalAccess`. Server-side validation is implemented for billing amounts, including discounts and payments, and DICOM SSRF hardening. Biometric capture and enrollment flows are secured with token validation and role-based authorization. WhatsApp settings writes are permission-gated.

### Bill Number Format

Bills generated after May 2026 use a pure-numeric format `YYYYMM####` (e.g. `2026050001`) — no `BILL-` prefix, no dashes. The backend (`generateBillNumber` in `artifacts/api-server/src/routes/bills.ts`) emits the new format, and a `parseBillNumberParts` helper accepts BOTH the new format AND the legacy `BILL-YYYYMM-####` rows so the super-admin delete/renumber flow keeps working across the transition. The print receipts (`BillDetail.tsx`, `BillingDesk.tsx`) defensively strip any `BILL-` prefix before display so legacy rows also print as digits only.

### Bill Print Template

Two print surfaces exist: `BillDetail.tsx` (Bill view "Print" button) and `BillingDesk.tsx` (auto-print right after creating a bill). Both follow the same conventions:
- `text-transform: uppercase` on the print wrapper forces patient name, gender, referring doctor, and test names into capital case regardless of input case. Use class `pr-keep-case` / `bdr-keep-case` to opt out for any field that must preserve mixed case.
- Print isolation uses the visibility trick (`body * { visibility: hidden }` + show only the receipt subtree) combined with `position: absolute` (NOT `position: fixed`). `display: none` on body children would hide `#root` and therefore the receipt itself, since React mounts the receipt inside `#root`. `position: fixed` was the original cause of the blank trailing page in Chrome.
- Title is "INVOICE / RECEIPT" (not "Tax Invoice").
- Patient demographics are a compact 2-line block (no boxed background, no 2-column grid) so most bills fit on a single A5 page when the user picks A5.

### Super-Admin USB Pen-Drive Gate

The super-admin surface is gated by a physical USB pen drive containing `superadmin.key`, whose content must match the `SUPER_ADMIN_USB_KEY` environment secret. Implemented in `artifacts/api-server/src/middleware/requireSuperAdminUsb.ts` and applied to `POST /api/super-admin/login`, all `requireSuperAdmin`-protected routes, and the super-admin bill mutations (`PATCH /api/bills/:id/super-edit`, `DELETE /api/bills/:id`) for defense-in-depth. Public endpoints `GET /api/super-admin/usb/status` and `POST /api/super-admin/usb/verify` (rate-limited) let the UI verify a key file. **Billing UI auto-detect (`artifacts/diagnostic-erp/src/lib/usbKey.ts` + `Layout.tsx`)**: the sidebar shows ZERO USB-related affordance. A hidden Ctrl+Alt+U combo opens a one-time pairing dialog that uses the File System Access API to remember the pen-drive root in IndexedDB; from then on the app silently re-reads `superadmin.key` every 4s and the Super Admin link appears/disappears as the drive is plugged/unplugged. Firefox/Safari fall back to a manual file picker inside the same dialog. The super-admin-portal also shows a `UsbUnlockScreen` before its PIN login. The key is stashed in `sessionStorage` (dies with the tab). When `SUPER_ADMIN_USB_KEY` is unset, the gate is bypassed with a startup warning (back-compat). See `PEN_DRIVE_SETUP.md` for operator instructions.

## Feature Specifications

The ERP system includes modules for Dashboard, Patient Management, Orders, Test Catalog, Billing, Payments, Doctors, Reports (with AI Insights), Inventory, Referrals, Accounting (TallyPrime export), PACS Viewer, Appointments, Staff Management, and Settings.
Key features:
-   **Billing Desk**: Unified workflow for patient search, registration, test catalog, package quick-add, discounts, payments, and bill generation with per-test queue tokens.
-   **Report Generation Hub**: Centralized system for pathology and radiology reports with inline parameter entry, templates, signature management, verification, and sharing options.
-   **Website Builder & Public Clinic Site**: An ERP module for designing and publishing the clinic's public website, with content served dynamically and security measures including publish-state gating and HTML sanitization.
-   **Vendor Management (Inventory)**: Manages suppliers with contact details, GSTIN, payment terms, and tracks purchase history.
-   **Radiology Workflow**: End-to-end imaging workflow with worklist, reporting queue, and film/CD issuance.
-   **AI Features**: Clinical note generation, billing insights, and patient communication drafting.
-   **Patient Portal**: Public-facing portal for patients to view bills, visits, reports, and book appointments.
-   **Staff Portal**: Staff login for accessing the main ERP.
-   **Compliance**: Referral commission features and doctor due/payment ledgers are super-admin exclusive.
-   **Admin Tools**: Machine/Maintenance module, Master Settings, and Clinic Branding Centralization.

# URL Layout (May 2026 swap)

The public-facing URL space was swapped so the marketing site owns the root domain:

| Path | Artifact | Notes |
|------|----------|-------|
| `/` | `clinic-site` | Public clinic website (was `/site/`) |
| `/erp` | `diagnostic-erp` | Staff ERP (was `/`) |
| `/erp/portal` | `diagnostic-erp` route | Patient + staff portal landing (was `/portal`) |
| `/super-admin-portal` | `super-admin-portal` | Unchanged |
| `/api` | `api-server` | Unchanged |

Touchpoints (keep in sync if changing again): each artifact's `.replit-artifact/artifact.toml` (`previewPath`, `services.paths`, `BASE_PATH`); `artifacts/api-server/scripts/build-deploy.mjs` (BASE_PATH passed to each `buildFrontend`); `artifacts/api-server/src/app.ts` (static mounts + SPA fallback regexes). Old `/portal` and `/site/` bookmarks no longer resolve — communicate to staff/patients before redeploy.

# Deploy Gotchas

-   **Target**: Reserved VM (`deploymentTarget = "vm"` in `.replit` — note the schema only accepts `"vm"`, NOT `"reserved"`). Picked because `node-cron` schedulers in api-server need an always-on host.
-   **Single-process unified serve**: `artifacts/api-server/scripts/build-deploy.mjs` bundles the Express API to `dist/index.mjs` AND builds all 3 SPAs (`clinic-site` → `dist/web/site/` at `/`, `diagnostic-erp` → `dist/web/erp/` at `/erp/`, `super-admin-portal` → `dist/web/super-admin-portal/` at `/super-admin-portal/`). At runtime `SERVE_STATIC_DIR=artifacts/api-server/dist/web` makes `app.ts` mount them. One process, one port — required because Reserved VM exposes a single port.
-   **`.replitignore` whitelist**: the global `**/dist` exclusion would strip the bundled output before image push. Counter-rule `!artifacts/api-server/dist/**` is required. Do NOT remove.
-   **Required prod secrets**: `DATABASE_URL`, `SUPER_ADMIN_USB_KEY`, `SESSION_SECRET`, `AI_INTEGRATIONS_GEMINI_API_KEY`, `AI_INTEGRATIONS_GEMINI_BASE_URL`, object-storage trio (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`), `ENABLE_SCHEDULERS=1`, `NODE_ENV=production`, `SERVE_STATIC_DIR=artifacts/api-server/dist/web` (REQUIRED — without it the Express server returns "Cannot GET /" for every page because it never mounts the built SPAs).
-   **Geography is locked at first publish** — pick India region in Advanced before clicking Deploy if low-latency for Deoghar matters.

# External Dependencies

-   **PostgreSQL**: Primary database.
-   **Drizzle ORM**: For database interactions.
-   **Orval**: API codegen.
-   **Zod**: Schema validation.
-   **Gemini API (via Replit AI Integrations)**: For AI-powered features.
-   **Nodemailer**: For email notifications.
-   **node-cron**: For scheduling tasks.
-   **Orthanc DICOM server**: For PACS integration.
-   **Conquest DICOM server**: Alternative PACS provider.
-   **Weasis / OHIF**: External DICOM viewers.
-   **@simplewebauthn/server**: For WebAuthn credentials in Fingerprint Kiosk.