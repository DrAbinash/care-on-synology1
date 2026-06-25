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

