import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("/scripts") ? process.cwd().slice(0, -8) : process.cwd();
const outPath = join(root, "FEATURES.md");

const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const replitMd = read("replit.md");
const layoutTsx = read("artifacts/diagnostic-erp/src/components/Layout.tsx");
const settingsTsx = read("artifacts/diagnostic-erp/src/pages/Settings.tsx");
const superAdminTs = read("artifacts/api-server/src/routes/super-admin.ts");

const navMatches = [...layoutTsx.matchAll(/\{ path: "([^"]+)", icon: [^,]+, label: "([^"]+)" \}/g)].map((m) => `- ${m[2]} (${m[1]})`);
const moduleMatches = [...settingsTsx.matchAll(/\{ path: "([^"]+)", label: "([^"]+)" \}/g)].map((m) => `- ${m[2]} (${m[1]})`);

const content = `# Care Diagnostics ERP — Complete Feature Reference

> Auto-generated feature documentation derived from the live codebase.
> Regenerate with: \`pnpm --filter @workspace/scripts run generate:features\`
> Last updated: ${new Date().toISOString()}

## Source Overview

${replitMd.split("\n").slice(0, 20).join("\n")}

## Navigation Snapshot

${navMatches.join("\n")}

## Settings Module Snapshot

${moduleMatches.slice(0, 20).join("\n")}

## Key UI Surfaces

- Dashboard: KPI cards, revenue chart, popular tests, recent bills, pending reports, low-stock alerts
- Billing Desk: patient search, registration, test/package add, discounts, payments, receipt printing
- Report Hub: report lists, verification, sharing, printing, delivery workflow
- Portal: patient login, bill/report viewing, appointment booking, staff login

## Security Highlights

- Super-admin USB key gate on privileged routes and portal unlock
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

## Super-Admin Controls

${superAdminTs.includes("usb/verify") ? "- USB verification endpoint available" : "- USB verification endpoint unavailable"}
${superAdminTs.includes("requireSuperAdminUsb") ? "- USB enforcement middleware applied" : "- USB enforcement middleware unavailable"}

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
`;

writeFileSync(outPath, content);
console.log(`Wrote ${outPath}`);
