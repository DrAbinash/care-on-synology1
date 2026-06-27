# WALKTHROUGH: Phase 5 — My Reporting Analytics Dashboard

**Date:** June 27, 2026  
**Commit:** 527f986a  
**Tag:** phase5/my-analytics-v1  
**Restore point:** checkpoint/before-phase5-analytics  

---

## What I inspected before writing code

**`RadiologyProductivity.tsx`** — Already exists at `/radiology/productivity`. Aggregates across all radiologists from a `/radiology-copilot/productivity` endpoint. Not personal.

**`TurnaroundTimeAnalytics.tsx`** — Exists, uses `/api/ai-reporting/turnaround-times`. Requires manual date entry and a submit button. Not auto-scoped to the logged-in radiologist.

**`radiology_studies`** — Has `finalReportedBy`, `finalReportedAt`, `createdAt`, `modality`, `priority`. TAT = `finalReportedAt - createdAt`.

**`radiology_measurements`** — Has `reportedBy`, `createdAt`, `isAbnormal`, `label`. Already populated by Phase 3.

**`mri_protocol_quality_results`** — Has `completedBy`, `completedAt`, `overallGrade`. Populated by Phase 3 QA checklist.

**`ai_prompt_library_versions`** — Has `createdBy`, `createdAt`. Tracks every save of a prompt library entry.

**Decision:** New dedicated API route + new page, scoped to logged-in radiologist. `recharts` is already in the dependency tree (used by `TurnaroundTimeAnalytics` and `RadiologyProductivity`).

---

## Files Changed

### 1. `radiologyMyAnalytics.ts` (NEW API — 193 lines)

**Endpoint:** `GET /api/radiology/my-analytics?days=30`

Scoped to the logged-in radiologist (`req.staffSession.subjectName`). Period is configurable 1–365 days (default 30). Runs 7 parallel SQL queries:

| Query | Table | What it computes |
|---|---|---|
| TAT stats | `radiology_studies` | totalSigned, avg/median/min/max minutes to final report |
| Modality breakdown | `radiology_studies` | count per modality |
| Daily volume | `radiology_studies` | reports per day (last N days) |
| Measurement stats | `radiology_measurements` | total saved, studies, abnormal count, unique labels |
| QA stats | `mri_protocol_quality_results` | count per grade (acceptable/suboptimal/non-diagnostic) |
| AI prompt stats | `ai_prompt_library_versions` | edits count, categories customised |
| Priority breakdown | `radiology_studies` | count per priority level |

QA and AI queries are wrapped in `try/catch` — return empty arrays if the tables don't exist in the environment yet. All other queries use only core tables that always exist.

**Mounted at:** `/api/radiology/my-analytics` with `requireStaffAuth` + `requireStaffPermission("/radiology")`

---

### 2. `MyReportingAnalytics.tsx` (NEW PAGE — 444 lines)

**Route:** `/radiology/my-analytics`  
**Sidebar:** Radiology group → "My Analytics" (below Operations Dashboard)

**Period selector:** 7 / 30 / 90 days — no submit button, auto-refetches on change.

**Sections rendered:**

```
┌─────────────────────────────────────────────────────────────┐
│  My Reporting Analytics          Dr. Abinash   [30 days ↺] │
├─────────────────────────────────────────────────────────────┤
│  TURNAROUND TIME                                            │
│  [Reports: 28] [Avg: 14m] [Median: 12m] [Min: 4m] [Max: 1h]│
├─────────────────────────────────────────────────────────────┤
│  DAILY SIGNING VOLUME                                       │
│  ▁▃▅▂▄▇▃▅▆▂▄▇ ... (bar chart last 30 days)                 │
├──────────────────────┬──────────────────────────────────────┤
│  BY MODALITY         │  BY PRIORITY                        │
│  MRI ████████ 18     │  routine  ████████████ 22 (79%)     │
│  CT  ████ 7          │  urgent   ██ 4 (14%)                │
│  USG ██ 3            │  stat     █ 2 (7%)                  │
├──────────────────────┼────────────────┬────────────────────┤
│  MEASUREMENTS        │  PROTOCOL QA   │  AI PROMPT         │
│  Total saved: 94     │  Acceptable: 9 │  Edits: 3          │
│  Studies: 22         │  Suboptimal: 2 │  Categories: 2     │
│  Abnormal: 6         │  Non-diag: 0   │                    │
│  Labels used: 14     │  98% acceptable│                    │
└──────────────────────┴────────────────┴────────────────────┘
```

---

### 3. `App.tsx` + `Layout.tsx` (MODIFIED)

- Lazy import: `const MyReportingAnalytics = lazy(() => import("@/pages/MyReportingAnalytics"))`
- Route: `<Route path="/radiology/my-analytics" component={MyReportingAnalytics} />`
- Permitted paths array updated
- Sidebar: `{ path: "/radiology/my-analytics", icon: BarChart3, label: "My Analytics" }`

---

## What this enables for Dr. Abinash

After a week of use across phases 1–4:

- **TAT visibility:** See if your average signing time is improving. Green ≤ 20 min / Amber ≤ 40 min / Red > 40 min.
- **Volume tracking:** Identify busy days vs light days. Plan dictation sessions accordingly.
- **Measurement adoption:** Confirm that measurements are being saved (Phase 3 wiring working as expected).
- **QA pass rate:** 100% acceptable = all scans were of diagnostic quality. Any non-diagnostic = protocol issue to address with technologist.
- **Priority distribution:** See if stat/emergency studies are arriving in expected proportions.

---

## Cross-phase data sources

| Section | Fed by |
|---|---|
| TAT + modality + daily + priority | Existing `radiology_studies` (always existed) |
| Measurements | Phase 3 wiring (`MeasurementAssistantPanel.onMeasurementsChange` → save) |
| Protocol QA | Phase 3 `ProtocolQAChecklist` → `mri_protocol_quality_results` |
| AI prompt edits | Phase 2 seed + any edits via AI Prompt Manager |

---

## No migration required

All 7 queries use existing tables. `mri_protocol_quality_results` and `ai_prompt_library_versions` are wrapped in try/catch and return empty if the tables don't exist — the page renders gracefully with zeroes in those sections.

---

## Full roadmap status

| Phase | Feature | Status |
|---|---|---|
| 1 | MRI Protocol Specs + QA checklist schema + API | ✅ Complete |
| 2 | Neuro AI Prompt Library (5 categories, 9 prompt types each) | ✅ Complete |
| 3 | QA Checklist UI + Measurement wiring to findings draft | ✅ Complete |
| 4 | Lesion Comparison Panel (delta, trend, insert to findings) | ✅ Complete |
| 5 | My Reporting Analytics Dashboard | ✅ Complete |

All 5 phases committed. All tagged. All walkthroughs written.

**Phase 5 Status: ✅ COMPLETE — All phases done.**
