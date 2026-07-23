# Critical-findings store audit (PR 3 — pre-consolidation)

Required inventory of every critical-finding store before touching the workflow (stabilization brief, PR 3). Verified against code at the base of this PR.

## The stores

| # | Table | Writers | Readers | Acknowledgement | Notification | Production usage | Migration risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `radiology_critical_findings` (schema/radiology.ts) | Radiologist flag: `POST /api/radiology-workflow/critical-alerts` (requireRad); `POST /api/radiology/critical-findings`; **auto-detect**: `scanForCriticalFindings()` on prelim report save (`radiology.ts:1622-1626`) via `lib/criticalFindingsAlert.flagCriticalFinding` | `GET /api/radiology-workflow/critical-alerts` (+ time-to-ack metrics) → **CriticalAlertsManager** page; dashboard count (`radiologyWorkflow.ts:488`); `GET /api/radiology/critical-findings` (no UI callers) | **BROKEN**: UI PATCHes `/api/radiology-workflow/critical-alerts/:id/acknowledge` which did not exist (404 forever); a working `PATCH /api/radiology/critical-findings/:id/acknowledge` existed but had zero callers and trusted client-supplied `clinicianName` | `notifyClinician()` helper existed but was imported by NO route; the UI Notify button had **no onClick** | The CT/MRI/X-ray critical workflow — the page polls every 5 s; findings could be created but never acknowledged from any client | **This PR's target.** Additive columns only; no data moved |
| 2 | `critical_findings_alerts` (schema/enterpriseRadiology.ts) | `pacsEnterprise.ts` (enterprise alert flow) | PacsDashboard | `POST` ack via `pacsEnterprise.ts:~1771` — **works** (PacsDashboard.tsx) | In-module | Live, self-contained enterprise-PACS module | None — untouched; keeps working |
| 3 | `critical_escalation` (schema/risMonitoring.ts) | `risMonitoring.ts` / HOPE-partner escalation (`services/integration/criticalEscalation.ts` on `external_result_links`) | RisMonitorCards | `PATCH` via `risMonitoring.ts:~339` — **works** | Escalation levels in-module | Live, self-contained RIS-monitor/HOPE flow | None — untouched |
| 4 | `fetal_usg_critical_alerts` (schema/fetalUsgLevel4.ts) + fetal-echo computed alerts (`echoCardiology.detectFetalEchoCritical`) | fetalUsgLevel4 / echoCardiology modules | Their own pages | `POST .../acknowledge-critical` — **works**, gates finalization | In-module | Live, gates USG/fetal-echo sign-off | None — untouched |
| 5 | `critical_findings` (schema/criticalFindings.ts, imported by aiReporting.ts) | AI-reporting pipeline | AI-reporting module | In-module | In-module | AI-draft flow bookkeeping | None — untouched |

Also verified: the mobile app (`diagno-booking-mobile/app/critical-alerts.tsx`) renders Acknowledge/Notify as explicitly **disabled** placeholders — left as-is (out of ERP scope; documented limitation).

## Consolidation decision — smallest safe path

Stores 2–5 are **live, self-contained module workflows with working acknowledgement paths**; consolidating their data would be a migration project with real risk and no immediate clinical gain. Store 1 is the broken one AND the canonical CT/MRI/X-ray escalation workflow. Therefore PR 3:

1. Fixes store 1 end-to-end (ack + notify + states + audit), using `lib/criticalFindingsAlert.ts` as the ONE engine.
2. Leaves stores 2–5 untouched and running (historical records preserved; nothing deleted).
3. **Reconciliation report:** not built — each parallel store already has a live, working UI surfacing its own unresolved alerts (PacsDashboard, RisMonitorCards, USG/fetal pages), so an aggregate admin report would duplicate five working screens; the brief allows omitting it ("if needed"). Revisit only if a store loses its surface.

## State model (store 1, after PR 3)

| State | Field evidence | Notes |
| --- | --- | --- |
| Detected | `created_at` | Manual flags are created by the reviewing radiologist; auto-detected flags come from the prelim-report keyword scan. |
| Reviewed | = creation for manual flags (the radiologist's flag IS the review) | No separate reviewed state is invented — documented honestly. |
| Notification attempted | `notified_clinician`, `notified_at`, `notification_method`, `notified_by` (recorder, from session), `notification_note` | Recording an internal/manual event — never pretends delivery. |
| Notification delivered | `notification_delivered` (nullable boolean) | Stays NULL for phone/in-person (not verifiable). Reserved for future verifiable channels (e.g. WhatsApp receipts). |
| Acknowledged | `acknowledged_by` + `acknowledged_role` (from the authenticated session, never client-supplied), `acknowledged_at`, `acknowledged_note` | Idempotent: a second acknowledge never overwrites the first. |

Both acknowledge and notify write to the tamper-evident `audit_logs` chain via `auditFromRequest`.
