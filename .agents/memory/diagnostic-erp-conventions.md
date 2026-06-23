---
name: diagnostic-erp frontend conventions
description: Recurring conventions for the diagnostic-erp artifact pages
---

- Staff session field is `subjectName` (NOT name/email) — both in `staffSession`
  on the API side and where the author/createdBy is recorded.
- Frontend data access: `api` from `@/lib/fetchApi` + React Query.
- `PageHeader` props are `title` / `subtitle` / `actions` (no icon/description).
- UI primitives live in `artifacts/diagnostic-erp/src/components/ui/`.
- Toasts via `useToast` from `@/hooks/use-toast`.
- New page needs three wirings: lazy import + `ERP_NAV_ORDER` entry + `<Route>`
  element in `App.tsx`, plus a nav item in `Layout.tsx`.
- After adding a backend route, RESTART the api-server workflow or the new path
  404s (server runs the old bundle until restart).
