# Threat Model

## Project Overview

Care Diagnostics is a TypeScript pnpm monorepo for a diagnostic-center ERP. Production components include an Express 5 API server (`artifacts/api-server/src/index.ts` and `src/app.ts`), PostgreSQL via Drizzle (`lib/db`), React/Vite staff and super-admin frontends, a public clinic-site frontend, and a workstation-local fingerprint bridge service (`bridge-service/src/index.js`). The application manages patient records, bills, test orders/results, appointments, staff users, inventory, accounting, referral commission workflows, website-builder content, backups, AI-assisted report/billing features, and biometric attendance/login.

Production assumptions for scans: mockup sandbox code is dev-only; `NODE_ENV` is `production`; deployed traffic is TLS-terminated by the platform; source-level HTTPS certificate management is out of scope. Windows/Electron packaging is in scope only when it changes production/server trust boundaries or exposes the same API/data surfaces.

## Assets

- **Patient medical and personal data** -- patient demographics, contact details, appointments, bills, payments, orders, diagnostic results, report text, and photos. Unauthorized access can expose sensitive health information and identity data.
- **Staff, user, and super-admin accounts** -- PINs, roles, permissions, portal sessions, super-admin sessions, and biometric templates. Compromise enables impersonation, unauthorized data access, and tampering with operational records.
- **Financial and compliance data** -- billing, payment ledgers, voucher/accounting data, referral commission rules, doctor ledgers, and Tally exports. Exposure or tampering can create financial loss and compliance issues.
- **Application secrets and integration credentials** -- `DATABASE_URL`, Gemini/API keys, email SMTP credentials, bridge shared secret, and DICOM/PACS credentials. Leaks can compromise external systems and backend data.
- **Website-builder content and uploaded files** -- public site settings, custom HTML/head snippets, uploaded media under `data/uploads`, analytics/tracking identifiers, popups, and pages. Malicious content can affect public visitors or staff previewing/publishing content.
- **Biometric templates and bridge communications** -- fingerprint templates captured locally and synchronized with the ERP API. These are highly sensitive identifiers and cannot be rotated like passwords.

## Trust Boundaries

- **Browser to Express API** -- all staff, patient, public site, and super-admin frontend calls cross from an untrusted client into `/api`. Server-side authentication, authorization, validation, and rate limiting must protect sensitive routes.
- **Public/Patient/Staff/Super-admin boundaries** -- public clinic-site and portal endpoints must not expose internal ERP data; patient portal sessions must be scoped to one patient; staff-only ERP operations must require authenticated staff; compliance-only routes must require super-admin authorization.
- **API to PostgreSQL** -- the API has broad database access through Drizzle. SQL construction must remain parameterized and object updates must restrict writable fields.
- **API to filesystem/uploads/static assets** -- website uploads are stored under `data/uploads` and served from `/uploads`; system update/backup features read or create files. File type, path, size, and content handling must prevent traversal, executable upload exposure, and data exfiltration.
- **API to external services** -- Gemini AI, email, DICOM/PACS providers, WhatsApp links, and other outbound calls cross into less-trusted external systems. User-controlled URLs or provider endpoints must not create SSRF, credential disclosure, or uncontrolled data sharing.
- **Workstation bridge to API** -- `bridge-service` runs on localhost and uses `ERP_BRIDGE_SECRET` to call `/api/bridge/*`; browsers can call the local bridge. Origin controls and shared-secret validation must prevent arbitrary websites from using the scanner or enrolling/exfiltrating biometric data.
- **Production vs development/test artifacts** -- `artifacts/mockup-sandbox`, `.cache`, attached assets, and local scripts are dev-only unless explicitly served by production entry points.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, and `artifacts/api-server/src/routes/index.ts`.
- High-risk API routes: `routes/users.ts`, `routes/portal.ts`, `routes/backup.ts`, `routes/bridge.ts`, `routes/system.ts`, `routes/website.ts`, billing/orders/reports/patients routes, and `middleware/requireSuperAdmin.ts`.
- Authorization hot spots: the "Unrestricted staff-authenticated routes" block in `artifacts/api-server/src/routes/index.ts`, especially `/ai`, `/form-f`, `/patient-reports`, `/signatures`, and other routers not covered by `PERMISSIONED_PATHS`.
- Frontend/public site XSS surfaces: `artifacts/clinic-site/src/head.tsx`, `artifacts/clinic-site/src/sections.tsx`, `artifacts/diagnostic-erp/src/pages/Website.tsx`, report/print HTML generation, and any `dangerouslySetInnerHTML` or `innerHTML` use.
- File/upload/static surfaces: `/uploads` static middleware in `app.ts`, `routes/website.ts` photo upload/delete, `routes/system.ts` update upload, and backup endpoints.
- Bridge/biometric surface: `bridge-service/src/index.js` and API `/api/bridge/*` implementation.
- Tokenized sharing/session surfaces: `routes/patient-reports.ts`, `routes/teleradiology.ts`, `routes/super-admin.ts`, and any frontend code that transports bearer tokens via URLs or long-lived public links.
- Dev-only areas normally ignored: `artifacts/mockup-sandbox`, `.cache`, and attached design assets unless reachable through production routes.

## Threat Categories

### Spoofing

Staff, patient, super-admin, and bridge identities must not be forgeable. API endpoints that access ERP data must require server-validated authentication; super-admin tokens must be unpredictable, active, scoped, and checked on every privileged route; patient portal login must prove control of the patient identity rather than only knowledge of public identifiers; bridge API calls must require the configured shared secret.

### Tampering

Clients must not be trusted to enforce roles, permissions, prices, discounts, report status, commission data, or accounting values. Server routes must validate request bodies with explicit schemas, restrict mass assignment to intended fields, compute sensitive financial/business values server-side, and protect file-system operations from path manipulation.

### Repudiation

Sensitive actions such as bill edits/reprints, backups, user/role changes, commission changes, report verification, and ledger resets require durable audit records tying the action to an authenticated actor and timestamp. Caller-supplied `performedBy` values are not sufficient when the route itself lacks authentication.

### Information Disclosure

Patient records, reports, billing/payment data, staff records, PINs, biometric templates, backups, commission data, SMTP/API credentials, and database errors must not be exposed to unauthenticated users or to the wrong role. API responses should omit unnecessary sensitive fields, and logs/error messages should avoid secrets and health data.

### Denial of Service

Public endpoints including portal login, AI calls, file uploads, report generation, backup generation, and bridge operations can consume CPU, memory, database, or external API quota. They require body/file size limits, rate limits, timeouts, and authentication where appropriate.

### Elevation of Privilege

Privilege boundaries must be enforced server-side, not only by separate frontends or hidden UI. Regular staff must not be able to reach super-admin/compliance actions; patients must not change another patient’s data; unauthenticated public callers must not invoke ERP CRUD, backup, update, or user management routes. Injection, unsafe HTML rendering, path traversal, or uncontrolled server-side requests could also elevate attacker capabilities and must be prevented.