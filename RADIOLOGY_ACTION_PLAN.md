# Radiology Action Plan — Care Diagnostics ERP

**Created:** 2026-06-05
**Goal:** Fix the core pain point: *USG reports take too long to type with measurements*
**Status:** Phase 1 complete (OHIF + Unified Report). Phases 2-4 in progress.

---

## Phase 1: Fix Viewer & Build Unified Page (COMPLETE)

| Task | Status | Files Changed |
|------|--------|--------------|
| Seed PACS viewer defaults (idempotent migration) | Done | `lib/db/drizzle/0004_seed_pacs_viewer_defaults.sql` |
| Build `RadiologyReportUnified.tsx` — single page for all modalities | Done | `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` |
| Fix measurement API endpoint (`/api/usg-extraction/study/:uid`) | Done | `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` |
| Add route `/radiology/unified-report/:worklistId` | Done | `artifacts/diagnostic-erp/src/App.tsx` |
| Consolidate sidebar from 40+ items to 18 | Done | `artifacts/diagnostic-erp/src/components/Layout.tsx` |
| Update inventory with deprecated items marked | Done | `RADIOLOGY_MODULE_INVENTORY.md` |

**Outcome:** Staff can now open the unified report page, see embedded OHIF, measurements, and AI draft in one place.

---

## Phase 2: Real-Time Measurement Extraction (NEXT)

**Goal:** Make measurements actually flow from DICOM → DB → Unified Report without manual typing.

| # | Task | Priority | Est. Effort | Notes |
|---|------|----------|-------------|-------|
| 2.1 | **Test `usgExtractor.ts` end-to-end** — verify it actually reads DICOM SR and populates `usg_measurements` table | High | 2h | Check if extraction is triggered automatically when studies arrive |
| 2.2 | **Fix measurement polling** — unified page should auto-refresh measurements when new data arrives | High | 1h | Add `refetchInterval` or SSE to `useQuery` for measurements |
| 2.3 | **Add measurement approval flow** — extracted measurements need radiologist approval before inserting into report | High | 2h | Use existing `/api/usg-extraction/measurements/:id/approve` endpoint |
| 2.4 | **Test auto-insert with real DICOM** — verify clicking a measurement row inserts the correct text | Medium | 1h | Ensure `insertMeasurement(m)` produces readable text |
| 2.5 | **Handle missing measurements gracefully** — show helpful message when no measurements exist for a study | Low | 30m | "No measurements extracted yet. Run extraction manually?" |

**Acceptance:** A radiologist can open a USG study, see extracted measurements, approve them, and click-to-insert into the report without typing.

---

## Phase 3: Template & AI Draft Polish (NEXT)

**Goal:** Make normal templates and AI drafts actually usable in the unified report.

| # | Task | Priority | Est. Effort | Notes |
|---|------|----------|-------------|-------|
| 3.1 | **Test normal template insertion** — verify one-click normal template inserts text into the report textarea | High | 1h | Check if `NormalReportTemplates.tsx` works with unified page |
| 3.2 | **Test AI draft generation** — verify `/api/internal/radiology/ai-draft` returns a useful draft | High | 2h | Check Gemini prompt quality; add modality-specific context |
| 3.3 | **Add "Insert AI Draft" button** — unified page should have a button to insert AI draft into the report textarea | High | 1h | Reuse existing `aiDraftJson` from worklist entry |
| 3.4 | **Add AI draft feedback** — thumbs up/down on AI draft quality for learning loop | Medium | 1h | Use existing `/api/radiology/pacs-worklist/:id/ai-feedback` |
| 3.5 | **Improve AI draft for USG** — add measurement context to the AI prompt so draft includes measurements | Medium | 2h | Pass `usg_measurements` JSON to the AI draft endpoint |
| 3.6 | **Add "AI Draft — Requires Radiologist Review" label** | High | 30m | Safety requirement per `ai-safety-label` memory |

**Acceptance:** A radiologist can click "Normal Template" or "Generate AI Draft" and have usable text in the report within 3 seconds.

---

## Phase 4: Workflow & Navigation Polish (NEXT)

**Goal:** Make the worklist → report → finalize flow smooth and fast.

| # | Task | Priority | Est. Effort | Notes |
|---|------|----------|-------------|-------|
| 4.1 | **Update worklist navigation** — clicking "Report" on a worklist row should open `/radiology/unified-report/:id` | High | 30m | Check `RadiologyWorklist.tsx` navigation |
| 4.2 | **Add "Save Draft" button** — save report text without finalizing | High | 1h | Use existing report draft table or create new endpoint |
| 4.3 | **Add "Finalize" button** — lock the report with hash and signature | High | 1h | Use existing `/api/usg-reports/:id/finalize` |
| 4.4 | **Add status indicators** — worklist should show "Draft Saved", "Finalized", "AI Draft Ready" | Medium | 1h | Update worklist row badges |
| 4.5 | **Add keyboard shortcuts** — Ctrl+S for save, Ctrl+Enter for finalize | Low | 30m | Add `useEffect` keyboard listener |
| 4.6 | **Test print from unified page** — verify PDF generation works | Medium | 1h | Reuse `generateReportPDF` from `reportPdfGenerator.ts` |
| 4.7 | **Add "Back to Worklist" button** with unsaved changes warning | Medium | 30m | Check `isDirty` state before navigation |

**Acceptance:** A radiologist can pick a study from the worklist, write/insert a report, save, and finalize — all in under 2 minutes.

---

## Phase 5: Echo & Fetal Integration (FUTURE)

**Goal:** Bring echo and fetal measurements into the unified report.

| # | Task | Priority | Est. Effort | Notes |
|---|------|----------|-------------|-------|
| 5.1 | **Add echo measurement panel** — show 2D, Doppler, valve measurements in unified page when modality = ECHO | Medium | 3h | Extend `DicomMeasurement` type or add `EchoMeasurement` |
| 5.2 | **Add fetal measurement panel** — show BPD, HC, AC, FL, CRL, EFW, GA in unified page when modality = FETAL | Medium | 3h | Reuse `fetal_usg_level4` table |
| 5.3 | **Add modality-specific normal templates** — echo normal template, fetal normal template | Medium | 2h | Extend `normal-templates` to be modality-aware |
| 5.4 | **Add modality-specific AI prompts** — echo AI draft, fetal AI draft | Low | 3h | Use `ai_prompt_templates` with modality filter |

---

## Quick Wins (Can Do Immediately)

1. **Verify worklist navigates to unified report** — check `RadiologyWorklist.tsx` line ~450 for `navigate()` calls
2. **Add `ownerOnly` to deprecated AI pages** — so they don't clutter non-owner views
3. **Test `usg-extraction` endpoint manually** — `curl /api/usg-extraction/stats` to verify it's running
4. **Check `pacs_settings` table has data** — verify OHIF defaults are seeded

---

## Files to Monitor

```
artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx    # Unified page
artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx         # Worklist navigation
artifacts/diagnostic-erp/src/components/Layout.tsx               # Sidebar
artifacts/api-server/src/routes/usgExtraction.ts               # Measurement API
artifacts/api-server/src/routes/internal-radiology.ts          # AI draft
artifacts/api-server/src/lib/usgExtractor.ts                   # Extraction engine
lib/db/src/schema/usgMeasurements.ts                         # Measurement schema
lib/db/src/schema/pacsSettings.ts                            # PACS settings
```

---

*Last Updated: 2026-06-05*
