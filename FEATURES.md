# Care Diagnostics ERP — Complete Feature Reference

> Auto-generated feature documentation derived from the live codebase.
> Regenerate with: `pnpm --filter @workspace/scripts run generate:features`
> Last updated: 2026-05-09T08:46:14.570Z

## Source Overview

# Overview

This pnpm monorepo, built with TypeScript, provides a comprehensive Diagnostic ERP system. Its purpose is to streamline operations for diagnostic centers, covering patient management, billing, lab operations, inventory, accounting, and AI-driven insights. The system supports both web and self-contained Windows desktop applications. The business vision is to modernize diagnostic center workflows, improve efficiency, and elevate patient care through intelligent automation.

# User Preferences

I prefer iterative development. I want to be asked before you make any major changes to the codebase. I prefer clear and concise explanations.

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

## Navigation Snapshot

- Billing Desk (/)
- Dashboard (/dashboard)
- Daily Summary (/daily-summary)
- Patients (/patients)
- Appointments (/appointments)
- Online Bookings (/online-bookings)
- Queue Tokens (/queue)
- Radiology (/radiology)
- Bills (/billing)
- Due Payments (/dues)
- Payments (/payments)
- Orders (/orders)
- Tests (/tests)
- Outsourced Labs (/outsourced-labs)
- Packages (/packages)
- Reports (/reports)
- Report Generator (/report-generator)
- Report Hub (/report-hub)
- Inventory (/inventory)
- Expenses (/expenses)
- Staff Directory (/staff)
- HR Forms (/hr-forms)
- Doctors (/referrals)
- Accounting (/accounting)
- Discounts (/discounts)
- Form F (PCPNDT) (/form-f)
- Website Builder (/website)
- PACS Viewer (/pacs)
- DICOM Nodes (/dicom-nodes)
- Machines (/machines)
- Settings (/settings)
- System Update (/system-update)

## Settings Module Snapshot

- Dashboard (/)
- Patients (/patients)
- Quick Register (/register)
- Orders (/orders)
- Test Catalog (/tests)
- Billing (/billing)
- Payments (/payments)
- Doctors (/doctors)
- Reports (/reports)
- Report Generator (/report-generator)
- Inventory (/inventory)
- Referrals (/referrals)
- Accounting (/accounting)
- Discounts (/discounts)
- Settings (/settings)

## Key UI Surfaces

- Dashboard: KPI cards, revenue chart, popular tests, recent bills, pending reports, low-stock alerts
- Billing Desk: patient search, registration, test/package add, discounts, payments, receipt printing
- Report Hub: report lists, verification, sharing, printing, delivery workflow
- Portal: patient login, bill/report viewing, appointment booking, staff login

## Security Highlights

- admin USB key gate on privileged routes and portal unlock
- Staff and patient auth separated
- Patient API responses sanitize sensitive portal hashes
- Server-side validation and audit logging for financial actions

## Special Operational Features

- Bill number format: YYYYMM####
- Bill print receipt: uppercase headings and isolated print layout
- Partial test cancellation: cancelled tests excluded from billing and commissions
- Test type split: inhouse vs outsourced
- Outsourced labs CRUD and lab association for outsourced tests
- Referral commission reports exclude cancelled tests

## admin Controls

- USB verification endpoint available
- USB enforcement middleware applied

## Feature Surface References

- BillingDesk.tsx
- BillDetail.tsx
- Tests.tsx
- OutsourcedLabs.tsx
- ReportHub.tsx
- Portal.tsx
- Settings.tsx
- Dashboard.tsx

## Notes

This document is intentionally generated from the repository state so it can be refreshed whenever features are added, removed, or edited.
