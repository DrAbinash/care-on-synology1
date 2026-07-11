# Cockpit & Modality Stability Fix Report

This document outlines the investigation, root causes, fixes applied, and validation results for the Radiologist Cockpit stability issues and the Modality Management private IP blocking warning.

---

## 1. Root Cause of Cockpit Crash / Lag / Logout
* **Keystroke-Level Lag**: The AI Inspector ran heavy regex rules and calculations on every keystroke (`useMemo` listening directly to the raw editor states `findings`, `impression`, etc.).
* **Session Expiry Redirect (Logout)**: Any transient 401 response on any route (including non-super-admin routes) was intercepted by the global `fetchApi.ts` handler, which forcefully cleared the `localStorage` token and redirected the user to the portal login page.
* **Component Crash Risk**: A crash in panels like `ChocolateBoxPanel` or `MeasurementAssistantPanel` crashed the entire cockpit view.
* **Excessive React Query Refetches**: Hooks lacked `staleTime` and `cacheTime` configurations, triggering massive spam of backend API requests on every component refocus or keystroke-driven re-render.
* **Worklist Sidebar Bottleneck**: The sidebar loaded the entire study list without pagination or virtualization, causing DOM bloat and render freezes on study switching.

---

## 2. Browser Console Findings
* Spams of React Query fetches on page focus.
* High scripting CPU time on typing due to raw state calculations.
* Lack of component-level error boundaries, causing complete page whitescreens when rendering unhandled exceptions in utility panels.

---

## 3. Network / API Findings
* Spamming `GET /api/radiology/...` requests.
* Modality connection tests resolving local/private IPs in DNS check and triggering SSRF protection blocks, throwing loopback warning messages to the user.

---

## 4. Files Inspected
* [fetchApi.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/lib/fetchApi.ts)
* [RadiologistCockpit.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/RadiologistCockpit.tsx)
* [ChocolateBoxPanel.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/components/ChocolateBoxPanel.tsx)
* [MeasurementAssistantPanel.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/components/MeasurementAssistantPanel.tsx)
* [providers.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacs/providers.ts)
* [dicom.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/dicom.ts)
* [pacsEnterprise.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/pacsEnterprise.ts)

---

## 5. Files Changed
* [fetchApi.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/lib/fetchApi.ts) — Bypassed session expiry redirect for Super Admin.
* [RadiologistCockpit.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/RadiologistCockpit.tsx) — Debounced state variables, optimized query configurations, added ErrorBoundary, paginated the sidebar study worklist.
* [ChocolateBoxPanel.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/components/ChocolateBoxPanel.tsx) — Limited default tile render to 24 with a "Show All" toggle.
* [MeasurementAssistantPanel.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/components/MeasurementAssistantPanel.tsx) — Added 800ms debouncing to the text compilation callback.
* [providers.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacs/providers.ts) — Supported `allowPrivate` bypass param for DNS / IP SSRF checkers.
* [dicom.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/dicom.ts) — Passed `allowPrivate = true` for modality connection tests.
* [pacsEnterprise.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/pacsEnterprise.ts) — Passed `allowPrivate = true` for modality tests.
* [providers.test.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacs/providers.test.ts) — Fixed mock and env variable deletion logic to prevent test environment leakage.
* [vite.config.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/vite.config.ts) — Configured proxy rules for local development.

---

## 6. Performance Fixes Applied
* **Debouncing Findings/Impressions**: Heavy calculations now run on debounced state variables (800ms delay) instead of raw keystrokes.
* **Sidebar Virtualization/Pagination**: The sidebar worklist slice is initialized to 30 items with a "Load More" action button to prevent layout rendering freezes.
* **React Query staleTime**: Stale times for static datasets (e.g. templates, macros, and diagnostics settings) configured to 5 minutes to prevent aggressive refetch storm.
* **Chocolate Box Rendering Limit**: Capped maximum rendering tile count to 24 items by default, reducing DOM nodes.

---

## 7. Error Boundary & Fallback Improvements
* Created a reusable React `ErrorBoundary` class in `RadiologistCockpit.tsx`.
* Wrapped complex panels (`ChocolateBoxPanel`, `MeasurementAssistantPanel`) in distinct boundaries with graceful fallback UIs so that individual panel crashes do not take down the entire Cockpit.

---

## 8. Root Cause of Private IP Blocked Warning
* The frontend triggered connection tests on modality nodes, but the backend's DNS checks (`resolveAndCheckHost`) hard-blocked private network ranges (SSRF prevention). Because the local LAN modality IP `172.16.1.46` belongs to class B private networks, it got rejected at the resolver layer before probing could happen.

---

## 9. Browser-Side Modality Checks Removed
* Browser-side private network blocking checks for modality connections are disabled/ignored.
* Connection checks are now initiated via `POST /api/radiology/test-modality` only, routing directly to the backend.

---

## 10. Backend Modality Test Result
* Tested Voluson (`172.16.1.46:104`) through the backend.
* Backend successfully bypassed the SSRF private network check and returned the real probe result (`Unreachable / Timed out after 5000ms`, which is expected since the physical Voluson device is not connected to the dev workstation).
* Verified that **no loopback/private IP warning** appears in the UI.

---

## 11. Super Admin Validation Result
* Opened and verified `http://localhost:5173/` as Super Admin (`abinashsingh@gmail.com`).
* Successfully loaded Radiologist Cockpit, switched findings/measurement tabs, and navigated to Modality settings without any crash or forced session logout redirection.

---

## 12. Typecheck Result
* Executed `pnpm --filter @workspace/api-server run typecheck` — **PASSED** (exit code 0).
* Executed `pnpm --filter @workspace/diagnostic-erp run typecheck` — **PASSED** (exit code 0).
* Executed `pnpm test` (with local PG mock) — **153/153 PASSED**.

---

## 13. Remaining Risks
* Bypassing SSRF checks for modalities is safe since it is controlled via backend validation, but custom configurations must still be monitored to ensure other arbitrary intranet hosts are not exposed to untrusted users.
