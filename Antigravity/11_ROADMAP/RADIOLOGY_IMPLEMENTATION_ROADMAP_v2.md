# Radiology Module — Revised Implementation Roadmap (v2)

## Care Diagnostics ERP — Consolidation & Productivity Enhancement Plan

**Prepared:** 2026-06-05
**Revised:** 2026-06-05
**Architect:** Senior RIS/PACS Product Architect
**Status:** Ready for review — no code changes yet

---

## Executive Summary

This revised roadmap incorporates architectural feedback from the principal reviewer. The key changes from v1:

1. **Split View postponed** — will not ship until Unified Reporting has been in production for 2-4 weeks
2. **Report Macro System added** — text shortcuts like `/mri_brain_normal` that expand into full findings/impressions
3. **Previous Report Intelligence added** — auto-display prior reports when opening a study
4. **Favorites Library added** — radiologist-curated collection of frequently used findings/impressions
5. **Batch Finalization removed** — patient safety > speed; deferred indefinitely
6. **Advanced Analytics deferred** — workflow efficiency comes before operational dashboards

**Estimated total effort:** 6-7 weeks (1 developer)
**Risk level:** LOW (no schema changes, no API deletions, no breaking changes)
**Rollback strategy:** Every change is reversible within 5 minutes

---

## Re-Assessed Split View Decision

### Assessment

| Factor | Analysis |
|--------|----------|
| **Weasis/OHIF availability** | Staff already have dedicated PACS viewers (Weasis desktop, OHIF web). These are purpose-built for image review and offer superior hanging protocols, multi-series comparison, and measurement tools compared to any embedded web viewer. |
| **Screen real estate** | Split view (worklist + report + embedded viewer) would be crowded on 1080p monitors. Most radiologists already use dual monitors (PACS on one, reporting on another). |
| **Complexity vs. benefit** | Implementing a split view with proper resizable panels, mobile fallback, and state management is ~3-4 days of work. The benefit is marginal when users already have Weasis. |
| **Workflow disruption** | Split view changes the fundamental navigation model. If users don't like it, it becomes technical debt. |

### Decision: **POSTPONE**

- **Condition:** Ship after Unified Reporting has been in production for 2-4 weeks
- **Trigger:** User feedback explicitly requests a single-screen workflow
- **Fallback:** If no feedback requests it, do not implement at all
- **Rationale:** The current workflow (worklist click -> new tab with report) is functional. The pain point is report writing speed, not navigation. Fix the writing speed first, then reassess navigation.

---

## Phase 0: Foundation & Safety (Day 1-2)

### Objective
Establish baseline safety, fix known bugs, and create a feature-flag system so subsequent phases can be toggled on/off without redeployment.

### Files Affected

| File | Action | Lines |
|------|--------|-------|
| `artifacts/diagnostic-erp/src/App.tsx` | Fix duplicate `/radiology/command-center` route | Lines 294, 303 |
| `artifacts/diagnostic-erp/src/lib/staffSession.ts` | Add `getFeatureFlags()` | ~10 lines |
| `artifacts/diagnostic-erp/src/components/Layout.tsx` | Add `featureFlag` prop to `NavLeaf` type | ~5 lines |

### Detailed Steps

1. **Fix duplicate route in App.tsx**
   - Remove the duplicate `<Route path="/radiology/command-center" ...>` at line 303
   - Keep the one at line 294 (the correct one)
   - This is a zero-risk bugfix — no functionality change

2. **Add feature-flag system**
   - Add `getFeatureFlags()` to `staffSession.ts` that reads from `localStorage` or a new `/api/staff/feature-flags` endpoint
   - Add `featureFlag?: string` to `NavLeaf` type in `Layout.tsx`
   - When rendering nav items, skip items whose `featureFlag` is not enabled
   - Default all new items to disabled (opt-in)

3. **Create flag definitions**
   - `showUnifiedReporting` — enables new unified reporting UI
   - `showMeasurementPanel` — enables measurement auto-insert panel
   - `showAiDraftPanel` — enables AI draft inline panel
   - `showReportMacros` — enables macro expansion in report textarea
   - `showPreviousReport` — enables prior report panel
   - `showFavoritesLibrary` — enables favorites sidebar
   - `hideDeprecatedNav` — hides old nav items (for gradual rollout)

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Route fix breaks Command Center | Very Low | Medium | Both routes point to same component; removing one is safe |
| Feature flag logic has bugs | Low | Low | Flags default to OFF; no change in current behavior |
| StaffSession.ts changes break auth | Low | High | Add function, don't modify existing functions |

### Dependencies
- None (self-contained)

### Rollback Plan
- Route fix: revert the deletion in App.tsx
- Feature flags: remove `featureFlag` prop from NavLeaf; all items return to default visibility
- `staffSession.ts` change: revert to previous commit

**Rollback time:** 2 minutes

### Expected Productivity Gain
- None (this is infrastructure)
- **Value:** Enables zero-risk rollout of all subsequent phases

### Testing Checklist
- [ ] Command Center still loads at `/radiology/command-center`
- [ ] All existing nav items still visible
- [ ] Feature flags can be toggled in localStorage
- [ ] Flagged items hide/show correctly

---

## Phase 1: Menu Consolidation (Week 1)

### Objective
Reduce sidebar from 18 items to 12, merge USG/DOPPLER into Radiology, hide deprecated pages, and move admin items to Settings group. All old routes remain functional for bookmarks/back-compat.

### Files Affected

| File | Action | Complexity |
|------|--------|------------|
| `artifacts/diagnostic-erp/src/components/Layout.tsx` | Restructure `navItems` array | Medium |
| `artifacts/diagnostic-erp/src/App.tsx` | Add `ownerOnly` to admin routes | Low |
| `artifacts/diagnostic-erp/src/lib/staffSession.ts` | Add permission aliases for moved items | Low |

### Detailed Steps

1. **Restructure Radiology group in Layout.tsx**

   **Current (18 items):**
   ```
   Radiology & Imaging
   |-- Worklist Hub
   |-- Reporting Workspace
   |-- PACS Viewer
   |-- Normal Templates
   |-- AI Reporting
   |-- DICOM Query/Retrieve
   |-- MWL Dashboard
   |-- Teleradiology
   |-- Echo Cardiology
   |-- Fetal USG
   |-- Fetal Echo
   |-- Voice Dictation
   |-- Critical Findings
   |-- AI Extraction Review
   |-- PACS Settings (ownerOnly)
   |-- Modality Management (ownerOnly)
   |-- DICOM Agent (ownerOnly)
   |-- Watchdog (ownerOnly)
   ```

   **New (12 items):**
   ```
   Radiology & Imaging
   |-- Worklist Hub
   |-- Reporting Workspace
   |-- PACS Viewer
   |-- Normal Templates
   |-- Critical Findings
   |-- DICOM Query/Retrieve
   |-- MWL Dashboard
   |-- Teleradiology
   |-- Echo Cardiology
   |-- Fetal USG
   |-- Fetal Echo
   |-- Voice Dictation
   ```

   **Removed from Radiology group:**
   - `AI Reporting` -> move to Settings > Radiology
   - `AI Extraction Review` -> hide (integrated later)
   - `PACS Settings` -> move to Settings > PACS
   - `Modality Management` -> move to Settings > Devices
   - `DICOM Agent` -> move to Settings > Agents
   - `Watchdog` -> move to Settings > Monitoring

2. **Remove `/usg` top-level item**
   - Delete line 173 in Layout.tsx: `{ path: "/usg", icon: Waves, label: "USG / DOPPLER" }`
   - USG studies are already visible in Radiology Worklist (modality = US/USG)
   - Old routes `/usg/*` remain in App.tsx for back-compat

3. **Add moved items to Settings group**
   - Add to Settings children:
     - `{ path: "/radiology/pacs-settings", icon: Server, label: "PACS & DICOM", ownerOnly: true }`
     - `{ path: "/radiology/modality-management", icon: Monitor, label: "Modality Management", ownerOnly: true }`
     - `{ path: "/radiology/dicom-agent-dashboard", icon: Server, label: "DICOM Agent", ownerOnly: true }`
     - `{ path: "/radiology/watchdog", icon: ShieldAlert, label: "Watchdog", ownerOnly: true }`
     - `{ path: "/radiology/ai-reporting-settings", icon: BrainCircuit, label: "AI Reporting", ownerOnly: true }`

4. **Add `ownerOnly` to admin routes in App.tsx**
   - Wrap admin route components with `ownerOnly` permission check
   - Currently these routes exist but are only gated by sidebar visibility
   - Adding route-level protection is defense-in-depth

5. **Hide deprecated nav items (not delete)**
   - Add `featureFlag: "hideDeprecatedNav"` to the removed items
   - When `hideDeprecatedNav` is NOT set, items still appear
   - This allows gradual rollout — staff can toggle back if needed

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Staff can't find moved items | Medium | Medium | Items are in Settings, not deleted; announce changes |
| `/usg` bookmark breaks | Low | Low | Route still works, just not in sidebar |
| Permission alias missing | Low | High | Add aliases before deploying; test all roles |
| Settings group becomes too long | Medium | Low | Settings group is already long; this adds 5 items |

### Dependencies
- Phase 0 (feature-flag system)

### Rollback Plan
1. Revert `navItems` array in `Layout.tsx` to previous version
2. Re-add `/usg` item to top-level nav
3. Remove new items from Settings group
4. Toggle `hideDeprecatedNav` flag OFF

**Rollback time:** 2 minutes (single file revert)

### Expected Productivity Gain
| Metric | Before | After | Gain |
|--------|--------|-------|------|
| Sidebar items | 18 | 12 | 33% reduction |
| Decision time (which page?) | 3-5s | 1-2s | 60% faster |
| Menu confusion | High | Low | Substantial |
| USG/DOPPLER separation | Confusing | Unified | Clearer |

### Testing Checklist
- [ ] All 12 Radiology items render correctly
- [ ] Settings group shows moved items
- [ ] `/usg` route still works when typed directly
- [ ] Owner-only items hidden for non-owner roles
- [ ] Mobile sidebar shows correct items
- [ ] `ERP_NAV_ORDER` in App.tsx still valid for permission checks

---

## Phase 2: Unified Reporting Enhancement (Week 2-4)

### Objective
Port missing features from the 6 deprecated report pages into `RadiologyReportUnified.tsx`, making it the single page for all radiology reporting. Add measurement panel, AI draft panel, and normal template integration. This is the highest-impact phase.

### Files Affected

| File | Action | Complexity |
|------|--------|------------|
| `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` | Major enhancement | High |
| `artifacts/diagnostic-erp/src/pages/RadiologyReportGenerator.tsx` | Reference (read-only) | — |
| `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx` | Reference (read-only) | — |
| `artifacts/diagnostic-erp/src/pages/UsgReporting.tsx` | Reference (read-only) | — |
| `artifacts/api-server/src/routes/usgExtraction.ts` | Add new endpoint (if needed) | Low |

### Detailed Steps

#### Step 2.1: Add Measurement Auto-Insert Panel (3 days)

1. **Add measurement fetch logic**
   - In `RadiologyReportUnified.tsx`, add `useQuery` to poll `/api/usg-extraction/study/:studyInstanceUID`
   - Poll interval: 5 seconds (when study is active)
   - Show panel only when `modality` is US/USG/Echo/Fetal

2. **Create measurement panel UI**
   - Collapsible side panel (right side, below AI draft)
   - Shows extracted measurements as a table:
     ```
     | Measurement | Value | Confidence | Action |
     | BPD         | 3.2cm | High       | [Insert] |
     | HC          | 12.1cm| High       | [Insert] |
     | ...
     ```
   - "Insert All" button at top
   - Each row has "Insert" button that appends formatted text to report textarea

3. **Format insertion text**
   - Template: `BPD: 3.2 cm (High confidence)`
   - Group by category (Fetal, Pelvic, Abdominal)
   - Insert at cursor position or append to end

4. **Add approval shortcut**
   - "Approve & Insert" button that calls `PATCH /api/usg-extraction/measurements/:id/approve` then inserts
   - This skips the separate review page entirely

#### Step 2.2: Add AI Draft Inline Panel (2 days)

1. **Reuse existing AI draft fetch**
   - `RadiologyReportUnified.tsx` already has `aiDraftStatus` and `aiDraftJson` in the `WorklistEntry` type
   - Add `useQuery` to fetch the actual draft text when status is "READY"

2. **Create AI draft panel**
   - Collapsible panel below measurements
   - Shows AI-generated report text with yellow "AI Draft" banner
   - "Insert AI Draft" button -> inserts into report textarea
   - "Discard" button -> clears the draft
   - Always show the safety label: "AI Draft — Requires Radiologist Review"

3. **Add AI trigger button**
   - "Generate AI Draft" button that calls `POST /api/usg-extraction/extract` or existing AI endpoint
   - Shows loading state while generating
   - Auto-refreshes when complete

#### Step 2.3: Integrate Normal Templates (1 day)

1. **Add template fetch**
   - `useQuery` to `/api/radiology/normal-templates` (or equivalent)
   - Filter by current modality and body part

2. **Create template picker**
   - Inline dropdown or quick-access bar above report textarea
   - Shows 5-10 most relevant templates
   - "More templates..." link opens full template page
   - Click -> inserts template text into report
   - Keyboard shortcut: `N` (when focus is not in textarea)

3. **Template categorization**
   - Auto-suggest based on modality + study description
   - Example: modality = US, description = "Abdomen" -> show "Normal Abdomen" template first

#### Step 2.4: Port Missing Features from Deprecated Pages (4 days)

1. **From `RadiologyReportGenerator.tsx` (93K):**
   - Voice dictation button (microphone icon)
   - Print settings dialog (page size, margins, header)
   - PDF export button
   - Report parameters (structured data entry)

2. **From `RadiologyReportingWorkspace.tsx` (58K):**
   - Better embedded viewer integration (iframe sizing)
   - Study comparison (prior studies panel)
   - Key images gallery

3. **From `UsgReporting.tsx` (55K):**
   - USG-specific measurement layouts (fetal biometry table)
   - Doppler measurement integration
   - USG-specific normal templates

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Unified page becomes too large | Medium | High | Split into sub-components; lazy-load panels |
| Measurement panel shows wrong data | Low | High | Use existing `usgExtraction.ts` endpoints; same data |
| AI draft quality degrades | Medium | Medium | Not changing AI logic; just moving UI location |
| Normal template fetch fails | Low | Medium | Graceful fallback: show "No templates available" |
| Old report pages break | Very Low | High | Not modifying them; just hiding from sidebar |

### Dependencies
- Phase 0 (feature flags)
- Phase 1 (menu consolidation)
- `usgExtraction.ts` endpoints already exist
- Normal templates API already exists

### Rollback Plan
1. Toggle `showUnifiedReporting` flag OFF
2. Old sidebar items reappear (if `hideDeprecatedNav` is also OFF)
3. Staff can use old report pages again
4. Unified page changes are preserved but not the default

**Rollback time:** 1 minute (toggle flag)

### Expected Productivity Gain
| Metric | Before | After | Gain |
|--------|--------|-------|------|
| Report pages to choose from | 7 | 1 | 86% reduction |
| Measurement insertion time | 30-60s | 5s | 90% faster |
| AI draft access | 2 clicks + new tab | 1 click | Inline |
| Normal template access | 3 clicks + copy/paste | 1 click | 80% faster |
| Tab switching | 3-4 times | 0 | Eliminated |

### Testing Checklist
- [ ] Unified page loads for all study types
- [ ] Measurement panel shows for US/USG studies
- [ ] Measurement "Insert" button works
- [ ] AI draft panel shows when ready
- [ ] AI draft insert works
- [ ] Normal templates filter by modality
- [ ] Template insert works
- [ ] Voice dictation button works
- [ ] Print settings work
- [ ] PDF export works
- [ ] Page size stays under 200KB (code-split if needed)

---

## Phase 3: Report Macro System (Week 5)

### Objective
Implement text shortcuts that expand into predefined findings/impressions. This is the fastest way to reduce typing for common patterns.

### Schema Analysis

| Existing Table | Relevance |
|---------------|-----------|
| `aiNormalReportTemplates` | Has `findings` and `impression` fields — can be reused as macro sources |
| `patientReports` | Has `body` and `impression` — can store user-created macros |
| `structuredReportTemplates` | May have parameter-based templates — check for overlap |

**Decision:** Create a new table `radiologistMacros` rather than overloading existing tables.

### New Schema (Required)

```typescript
// lib/db/src/schema/radiologistMacros.ts
export const radiologistMacrosTable = pgTable("radiologist_macros", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull(),           // e.g. "/mri_brain_normal"
  label: text("label").notNull(),               // e.g. "MRI Brain Normal"
  modality: text("modality").notNull(),         // e.g. "MR"
  bodyPart: text("body_part"),                  // e.g. "brain"
  findings: text("findings").notNull(),         // Full findings text
  impression: text("impression").notNull(),     // Full impression text
  isSystem: boolean("is_system").notNull().default(false), // true = built-in, false = user-created
  createdBy: text("created_by"),                // staff name or "system"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Index:** unique on `(trigger, createdBy)` — same trigger can exist as system + user versions.

### Files Affected

| File | Action | Complexity |
|------|--------|------------|
| `lib/db/src/schema/radiologistMacros.ts` | New schema file | Low |
| `lib/db/src/schema/index.ts` | Export new table | Low |
| `artifacts/api-server/src/routes/radiologyMacros.ts` | New API routes | Medium |
| `artifacts/api-server/src/routes/index.ts` | Mount new routes | Low |
| `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` | Add macro expansion UI | Medium |
| `artifacts/diagnostic-erp/src/pages/RadiologistMacrosAdmin.tsx` | New admin page (optional) | Medium |

### Built-in Macros (Shipped with System)

| Trigger | Label | Modality | Body Part | Findings | Impression |
|---------|-------|----------|-----------|----------|------------|
| `/mri_brain_normal` | MRI Brain Normal | MR | brain | Normal brain parenchyma. No focal lesion. Ventricles normal. No mass effect. | Normal MRI brain study. |
| `/ls_l45` | Lumbar Spine L4-5 | MR | spine | Mild disc desiccation at L4-5. Posterior disc bulge with mild thecal sac indentation. No significant neural foraminal stenosis. | Mild degenerative changes at L4-5. No significant canal stenosis. |
| `/fatty_liver_grade2` | Fatty Liver Grade 2 | US | liver | Hepatomegaly with diffuse increase in echogenicity. Portal vein walls poorly visualized. Diaphragm obscured. | Grade 2 hepatic steatosis. |
| `/cervical_spondylosis` | Cervical Spondylosis | X-Ray | spine | Straightening of cervical lordosis. Disc space narrowing at C5-6. Osteophyte formation. | Cervical spondylosis. No acute abnormality. |
| `/normal_kub` | Normal KUB | US | abdomen | Kidneys: normal size, echotexture, no hydronephrosis. Liver: normal. Gallbladder: normal wall, no stone. Spleen: normal. | Normal KUB ultrasound. |
| `/normal_pelvis` | Normal Pelvic USG | US | pelvis | Uterus: normal size, anteverted, homogeneous. Endometrium: normal thickness. Ovaries: normal size, no cyst. | Normal pelvic ultrasound. |
| `/normal_fetal_20w` | Normal Fetal 20 Weeks | US | fetal | Single live fetus in cephalic presentation. BPD, HC, AC, FL appropriate for 20 weeks. Normal amniotic fluid. Placenta anterior, grade 1. | Normal fetal biometry at 20 weeks. No anomaly detected. |

### Detailed Steps

1. **Create database schema** (1 day)
   - Add `radiologistMacros.ts` to schema
   - Run migration
   - Seed with built-in macros above

2. **Create API endpoints** (1 day)
   - `GET /api/radiology-macros` — list macros (filtered by modality)
   - `GET /api/radiology-macros/:trigger` — get specific macro
   - `POST /api/radiology-macros` — create user macro (staff-only)
   - `PUT /api/radiology-macros/:id` — update user macro
   - `DELETE /api/radiology-macros/:id` — delete user macro
   - System macros are read-only

3. **Implement macro expansion in report textarea** (2 days)
   - Listen for `/` key in textarea
   - Show autocomplete dropdown with matching macros
   - Filter by current modality (pre-sorted)
   - `Tab` or `Enter` to expand
   - Expand into: `findings` + `\n\nIMPRESSION: ` + `impression`
   - Cursor placed at end of inserted text
   - Escape to close dropdown without expanding

4. **Add macro management UI** (1 day)
   - New page: `/radiology/macros` (in Settings or as sidebar item)
   - Table of user macros (CRUD)
   - Table of system macros (read-only, with "Copy to My Macros" button)
   - Preview panel showing expansion result
   - Test button: type trigger, see expansion

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Trigger conflicts with normal typing | Low | Medium | Only expand after space or newline; require Tab/Enter confirmation |
| Too many macros clutter dropdown | Medium | Low | Limit to 10 visible; modality filter; search |
| User macros lost on schema change | Low | High | Backward-compatible schema; migration strategy |
| System macros not comprehensive | Medium | Medium | Start with 20-30; add more based on feedback |

### Dependencies
- Phase 0 (feature flags)
- Phase 2 (unified reporting — macros go in the report textarea)
- Database schema change (new table)

### Rollback Plan
1. Toggle `showReportMacros` flag OFF
2. `/` key behaves normally in textarea
3. Database table remains but is unused

**Rollback time:** 1 minute

### Expected Productivity Gain

| Metric | Before | After | Gain |
|--------|--------|-------|------|
| Normal report typing | 2-3 minutes | 10 seconds | 95% faster |
| Common findings typing | 1-2 minutes | 5 seconds | 95% faster |
| Typing errors | Frequent | Rare | Macros are pre-validated |
| Report consistency | Variable | Standardized | Higher quality |
| Learning curve | None | 1-2 days | Quick |

**Estimated impact:** 40-60% of reports can use macros (normal studies + common findings). For a radiologist doing 20 reports/day, this saves ~30-45 minutes of typing.

### Testing Checklist
- [ ] `/` triggers macro dropdown
- [ ] Modalities filter correctly
- [ ] Tab/Enter expands macro
- [ ] Escape closes dropdown
- [ ] Macro text inserts correctly
- [ ] User can create custom macro
- [ ] User can edit/delete their macros
- [ ] System macros are read-only
- [ ] Macro management page works

---

## Phase 4: Previous Report Intelligence (Week 6)

### Objective
When a radiologist opens a study, automatically display prior reports for the same patient. This enables quick comparison, trend detection, and context-aware reporting.

### Schema Analysis

| Existing Table | Relevance |
|---------------|-----------|
| `patientReports` | Has `patientId`, `studyId`, `body`, `impression`, `createdAt` — all needed fields exist |
| `radiologyWorklist` | Has `patientId`, `studyInstanceUID`, `studyDate` — can link to reports |

**Decision:** No new schema needed. Query existing `patientReports` by `patientId`.

### Files Affected

| File | Action | Complexity |
|------|--------|------------|
| `artifacts/api-server/src/routes/patientReports.ts` | Add `GET /api/patient-reports/:patientId/previous` | Low |
| `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` | Add prior report panel | Medium |
| `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx` | Add prior report indicator | Low |

### Detailed Steps

1. **Create API endpoint** (1 day)
   - `GET /api/patient-reports/:patientId/previous?currentStudyId=:id`
   - Returns up to 5 prior reports (excluding current study)
   - Sorted by `createdAt` desc
   - Fields: `id`, `title`, `body` (truncated), `impression`, `createdAt`, `modality`, `studyId`
   - Include `daysSinceLastStudy` calculation

2. **Add prior report panel to unified report** (2 days)
   - Collapsible panel (left side, above or below patient info)
   - Shows:
     ```
     Previous Reports (3 found)
     |
     |-- [2026-05-15] MRI Brain — Normal (View)
     |-- [2026-03-10] CT Abdomen — Fatty liver (View)
     |-- [2025-11-20] X-Ray Chest — Normal (View)
     ```
   - "View" button -> expands inline showing full impression
   - "Quick Compare" button -> opens side-by-side comparison (if prior study has images)
   - "Copy Impression" button -> copies prior impression to current report (for follow-up)

3. **Add prior report indicator to worklist** (1 day)
   - In worklist row, show small icon (e.g., `History` from lucide) when patient has prior reports
   - Hover shows count and date of most recent prior report
   - Click opens prior report panel

4. **Add "Follow-up" detection** (1 day)
   - If current study description matches prior study description (same modality + body part)
   - Show "Follow-up" badge in prior report panel
   - Auto-suggest: "Compare with previous study dated [date]"
   - Pre-fill report with: "Follow-up study. Previous study dated [date] showed [impression]."

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Prior report loading is slow | Medium | Medium | Limit to 5 reports; cache results; lazy load panel |
| Wrong patient match (homonym) | Low | High | Match by `patientId` (DB PK), not name |
| Prior report overwhelms UI | Medium | Low | Collapsible panel; show count first |
| "Copy Impression" leads to errors | Low | High | Add confirmation; label as "Copy as starting point" |

### Dependencies
- Phase 0 (feature flags)
- Phase 2 (unified reporting — panel goes in report page)
- `patientReports` table already exists

### Rollback Plan
1. Toggle `showPreviousReport` flag OFF
2. Prior report panel hidden
3. Worklist indicator hidden
4. API endpoint remains but is unused

**Rollback time:** 1 minute

### Expected Productivity Gain

| Metric | Before | After | Gain |
|--------|--------|-------|------|
| Time to find prior report | 2-3 min (search patients) | Instant | 100% faster |
| Comparison awareness | Often missed | Always visible | Better quality |
| Follow-up context | Manual lookup | Auto-detected | Higher accuracy |
| Trend detection | Requires memory | Visual comparison | Better diagnosis |
| Report consistency | Variable | Reference available | Higher quality |

**Estimated impact:** 20-30% of studies are follow-ups. For these, prior report access saves 2-3 minutes per study. For a radiologist doing 20 reports/day with 6 follow-ups, this saves ~15 minutes.

### Testing Checklist
- [ ] Prior report panel shows when patient has history
- [ ] Panel shows correct prior reports
- [ ] "View" expands full impression
- [ ] "Quick Compare" opens comparison
- [ ] "Copy Impression" works with confirmation
- [ ] Worklist shows prior report icon
- [ ] Follow-up badge appears correctly
- [ ] No prior history = panel hidden gracefully

---

## Phase 5: Favorites Library (Week 7)

### Objective
Radiologists can save frequently used findings, impressions, and templates into a personal library. Access them via a sidebar panel or keyboard shortcuts.

### Schema Analysis

| Existing Table | Relevance |
|---------------|-----------|
| `aiNormalReportTemplates` | System-level templates; not user-specific |
| `radiologistMacros` | Phase 3 table; can store favorites as user macros with a flag |

**Decision:** Extend `radiologistMacros` table with an `isFavorite` boolean, or create a separate `radiologistFavorites` table. Given the similarity, extending `radiologistMacros` is cleaner.

### Schema Change

```typescript
// Add to radiologistMacrosTable:
// isFavorite: boolean("is_favorite").notNull().default(false)
// category: text("category").notNull().default("macro") // "macro" | "favorite" | "snippet"
```

Actually, a separate table is cleaner for semantics:

```typescript
// lib/db/src/schema/radiologistFavorites.ts
export const radiologistFavoritesTable = pgTable("radiologist_favorites", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull(),           // FK to staff
  label: text("label").notNull(),                   // e.g. "My Normal Liver"
  type: text("type").notNull(),                     // "finding" | "impression" | "template" | "snippet"
  modality: text("modality"),                       // optional filter
  bodyPart: text("body_part"),                      // optional filter
  content: text("content").notNull(),               // The text to insert
  shortcutKey: text("shortcut_key"),                // e.g. "F1", "Ctrl+1"
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Files Affected

| File | Action | Complexity |
|------|--------|------------|
| `lib/db/src/schema/radiologistFavorites.ts` | New schema file | Low |
| `lib/db/src/schema/index.ts` | Export new table | Low |
| `artifacts/api-server/src/routes/radiologistFavorites.ts` | New API routes | Medium |
| `artifacts/api-server/src/routes/index.ts` | Mount new routes | Low |
| `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` | Add favorites panel | Medium |
| `artifacts/diagnostic-erp/src/pages/RadiologistFavoritesAdmin.tsx` | New management page | Medium |

### Detailed Steps

1. **Create database schema** (1 day)
   - Add `radiologistFavorites.ts` to schema
   - Run migration

2. **Create API endpoints** (1 day)
   - `GET /api/radiologist-favorites` — list favorites for current staff
   - `POST /api/radiologist-favorites` — create favorite
   - `PUT /api/radiologist-favorites/:id` — update
   - `DELETE /api/radiologist-favorites/:id` — delete
   - `POST /api/radiologist-favorites/reorder` — reorder

3. **Add favorites panel to unified report** (2 days)
   - Collapsible panel (right side, below macros/templates)
   - Shows user's saved items as a list:
     ```
     My Favorites
     |-- [Finding] Normal liver echotexture
     |-- [Impression] No acute abnormality
     |-- [Template] Normal KUB
     |-- [Snippet] "Clinical correlation recommended"
     ```
   - Click -> inserts into report at cursor
   - Drag to reorder
   - "Add to Favorites" button in report toolbar (saves current selection)

4. **Add "Save to Favorites" flow** (1 day)
   - Select text in report textarea
   - Click "Save to Favorites" (star icon in toolbar)
   - Dialog: label, type (finding/impression/snippet), modality, body part
   - Save -> appears in favorites panel

5. **Add keyboard shortcuts** (1 day)
   - `Ctrl+1` through `Ctrl+9` -> insert favorite #1-9
   - `Ctrl+Shift+F` -> open favorites panel
   - Shortcuts configurable in favorites management page

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Favorites lost on logout | Low | High | Persist to database; not localStorage |
| Too many favorites clutter panel | Medium | Low | Limit to 20; pagination; search |
| Keyboard shortcut conflicts | Medium | Low | Use Ctrl+Shift+; avoid browser defaults |
| Favorites not shareable between staff | Medium | Medium | Phase 2: add "Share with team" feature |

### Dependencies
- Phase 0 (feature flags)
- Phase 2 (unified reporting — panel goes in report page)
- Phase 3 (macros — favorites can reuse macro UI patterns)
- Database schema change (new table)

### Rollback Plan
1. Toggle `showFavoritesLibrary` flag OFF
2. Favorites panel hidden
3. "Save to Favorites" button hidden
4. Database table remains but is unused

**Rollback time:** 1 minute

### Expected Productivity Gain

| Metric | Before | After | Gain |
|--------|--------|-------|------|
| Common phrases typed | Every time | 1 click | 95% faster |
| Favorite findings access | Search/copy/paste | 1 click | 90% faster |
| Personal template library | None | Curated | New capability |
| Consistency across shifts | Variable | Personal standards | Higher quality |
| Learning curve | None | 2-3 days | Quick |

**Estimated impact:** 10-15 phrases per report are reused. Saving these as favorites reduces typing by 30-40% per report. For 20 reports/day, this saves ~20-30 minutes.

### Testing Checklist
- [ ] Favorites panel shows saved items
- [ ] Click inserts content at cursor
- [ ] "Save to Favorites" saves selected text
- [ ] Keyboard shortcuts work (Ctrl+1-9)
- [ ] Reorder works
- [ ] Delete works
- [ ] Favorites persist across sessions
- [ ] Favorites management page works

---

## Phase 6: Measurement Auto-Insert (Week 7-8)

### Objective
Eliminate the separate measurement review page. Extracted measurements should flow directly into the unified report with one click. Only go to review for corrections.

### Files Affected

| File | Action | Complexity |
|------|--------|------------|
| `artifacts/api-server/src/routes/usgExtraction.ts` | Add `directInsert` endpoint (optional) | Low |
| `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` | Enhance measurement panel | Medium |
| `artifacts/diagnostic-erp/src/pages/UsgMeasurementReview.tsx` | Keep but demote | None |

### Detailed Steps

#### Step 6.1: Streamline Measurement Flow (3 days)

1. **Auto-extract on study arrival**
   - When a new USG study appears in worklist, auto-trigger `POST /api/usg-extraction/extract`
   - Current behavior: manual trigger only
   - New behavior: auto-trigger + background processing
   - Show "Extracting..." status in worklist row

2. **Show measurements inline (no review page)**
   - In unified report panel, show extracted measurements as soon as available
   - Format: `BPD: 3.2 cm (confidence: High)`
   - "Approve & Insert" button -> approves + inserts in one action
   - "Edit" button -> opens measurement review page (for corrections)
   - "Reject" button -> marks as rejected, removes from panel

3. **Add batch insert**
   - "Insert All Measurements" button -> inserts all approved measurements at once
   - Formats as a structured block:
     ```
     FETAL BIOMETRY:
     BPD: 3.2 cm
     HC: 12.1 cm
     AC: 10.5 cm
     FL: 2.1 cm
     EFW: 150 g
     GA: 14 weeks
     ```

#### Step 6.2: Smart Formatting (2 days)

1. **Modality-aware formatting**
   - Fetal: Biometry table with GA/EDD calculation
   - Pelvic: Uterus, ovaries, endometrium
   - Abdominal: Liver, spleen, kidneys, CBD
   - Doppler: Flow velocities, resistance indices

2. **Confidence indicators**
   - High confidence: normal text
   - Medium confidence: italic text with "(verify)" note
   - Low confidence: red text, requires manual verification

3. **Unit normalization**
   - Convert all measurements to standard units (cm, g, mm)
   - Add units if missing from extraction

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Auto-extract floods API | Low | Medium | Debounce: max 1 extraction per study per 5 minutes |
| Wrong measurements inserted | Medium | High | Confidence threshold: medium+ auto-insert, low requires review |
| Review page still needed | Low | Medium | Keep review page accessible via "Edit" button |
| Formatting looks unprofessional | Low | Medium | Templates for each modality; radiologist can edit |

### Dependencies
- Phase 0 (feature flags)
- Phase 2 (unified reporting)
- `usgExtractor.ts` already exists
- `usgExtraction.ts` endpoints already exist

### Rollback Plan
1. Toggle `showMeasurementPanel` flag OFF
2. Measurements no longer show in unified report
3. Staff uses existing `/usg/measurements/:uid` review page
4. Auto-extract: disable the trigger in worklist

**Rollback time:** 2 minutes

### Expected Productivity Gain
| Metric | Before | After | Gain |
|--------|--------|-------|------|
| Measurement typing time | 30-60s | 5s | 90% faster |
| Review page visits | Every study | Only for corrections | 90% reduction |
| Measurement accuracy | Human error | Extracted + verified | Higher |
| Normal study time | 3-5 min | 30-60s | 80% faster |

### Testing Checklist
- [ ] Auto-extract triggers on study arrival
- [ ] Measurements appear in unified report panel
- [ ] "Approve & Insert" works
- [ ] "Insert All" works
- [ ] Formatting is correct per modality
- [ ] Low-confidence items flagged red
- [ ] "Edit" button opens review page
- [ ] Review page still works independently

---

## Phase 7: Polish & Split View Decision (Week 8)

### Objective
Add finishing touches: status indicators, notifications, delivery integration, and performance optimization. Make the go/no-go decision on split view based on 2-4 weeks of production usage.

### Files Affected

| File | Action | Complexity |
|------|--------|------------|
| `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx` | Status indicators, notifications | Medium |
| `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` | Delivery integration, preview | Medium |
| `artifacts/diagnostic-erp/src/components/Layout.tsx` | Feedback banner | Low |

### Detailed Steps

#### Step 7.1: Status Indicators & Notifications (2 days)

1. **Enhanced status badges**
   - Add "Extraction in Progress" status
   - Add "AI Draft Generating" status
   - Add "Review Required" status (for low-confidence measurements)
   - Add "Critical Finding" status (red, pulsing)

2. **Toast notifications**
   - "New study arrived: Patient Name (USG)"
   - "AI draft ready for Patient Name"
   - "Measurements extracted for Patient Name"
   - "Report finalized for Patient Name"
   - Auto-dismiss after 5 seconds

3. **Sound notifications** (optional)
   - Soft chime for new studies
   - Different chime for critical findings
   - Toggle in settings

#### Step 7.2: Delivery Integration (2 days)

1. **Add delivery buttons to report page**
   - Print (existing)
   - Email -> opens email dialog with patient email pre-filled
   - WhatsApp -> opens WhatsApp dialog with patient phone pre-filled
   - SMS -> if SMS integration exists
   - Patient Portal -> marks as available in portal

2. **Delivery tracking**
   - Show delivery status in worklist
   - "Delivered" badge when email/WhatsApp sent
   - "Viewed" badge when patient opens portal

#### Step 7.3: Performance Optimization (2 days)

1. **Code splitting**
   - Split unified report page into lazy-loaded sub-components:
     - `MeasurementPanel` (lazy)
     - `AiDraftPanel` (lazy)
     - `TemplatePicker` (lazy)
     - `ViewerPanel` (lazy)
   - Reduces initial bundle size

2. **Virtual scrolling for worklist**
   - If worklist has >100 studies, use virtual scrolling
   - Currently all rows render at once

3. **Debounce auto-save**
   - Current: auto-save every 30 seconds (good)
   - Add debounce on typing: save 2 seconds after typing stops
   - Prevents save conflicts

4. **Prefetch next study**
   - When radiologist is on study N, prefetch study N+1 data
   - Reduces perceived load time

#### Step 7.4: Split View Decision Point

After 2-4 weeks of production usage:

| Condition | Decision |
|-----------|----------|
| Users explicitly request single-screen workflow | Implement split view (3-4 days) |
| Users are happy with current two-tab workflow | Do not implement |
| Mixed feedback | Implement as opt-in feature (flag-gated) |

**If implementing:**
- Add route: `/radiology/worklist?mode=split`
- Resizable panels (worklist + report)
- Remember preference in localStorage
- Mobile fallback to single-page

### Items DELIBERATELY NOT INCLUDED

| Item | Reason |
|------|--------|
| **Batch Finalization** | Patient safety > speed. Individual review required for every report. |
| **Advanced Analytics** | Workflow efficiency comes first. Dashboards can wait. |
| **Split View** | Conditioned on 2-4 weeks of production feedback. |
| **Keyboard Shortcuts** | Covered in macro system (Phase 3) and favorites (Phase 5). |

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Toast notifications become annoying | Medium | Low | Toggle in settings; auto-dismiss |
| Delivery integration breaks | Low | Medium | Use existing delivery APIs; no new endpoints |
| Code splitting breaks lazy loading | Low | Medium | Test all lazy components load correctly |
| Split view adds complexity | Medium | High | Only implement if explicitly requested |

### Dependencies
- All previous phases
- 2-4 weeks of production usage data for split view decision

### Rollback Plan
- Notifications: disable toast system
- Delivery: hide delivery buttons
- Performance: revert to non-lazy components
- Split view: remove route and component

**Rollback time:** 5-10 minutes (multiple files)

### Expected Productivity Gain
| Metric | Before | After | Gain |
|--------|--------|-------|------|
| Delivery time | 3-5 min per report | 1 click | 90% faster |
| Notification awareness | Manual checking | Auto alerts | Higher |
| Page load time | 3-5s | 1-2s | 60% faster |
| Studies per hour (normal) | ~12 | ~25 | 108% increase |

### Testing Checklist
- [ ] Toast notifications show correctly
- [ ] Delivery buttons work (print, email, WhatsApp)
- [ ] Lazy components load correctly
- [ ] Virtual scrolling works for large lists
- [ ] Auto-save debounce works
- [ ] Performance metrics improved (Lighthouse score)

---

## Cross-Phase Dependencies Diagram

```
Phase 0: Foundation
    |
    v
Phase 1: Menu Consolidation
    |
    v
Phase 2: Unified Reporting  <----------------+
    |                                       |
    v                                       |
Phase 3: Report Macros                      |
    |                                       |
    v                                       |
Phase 4: Previous Report Intelligence       |
    |                                       |
    v                                       |
Phase 5: Favorites Library                    |
    |                                       |
    v                                       |
Phase 6: Measurement Auto-Insert            |
    |                                       |
    v                                       |
Phase 7: Polish & Split View Decision  ------+
```

**Critical path:** 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
**Parallel work:** Phases 3, 4, 5 can be developed in parallel after Phase 2

---

## Risk Matrix (All Phases)

| Risk | Phase | Likelihood | Impact | Overall Score |
|------|-------|-----------|--------|---------------|
| Staff resistance to change | 1 | High | Medium | 6/10 |
| Unified page becomes too complex | 2 | Medium | High | 6/10 |
| Macro system not adopted | 3 | Medium | Medium | 4/10 |
| Prior report loading slow | 4 | Medium | Medium | 4/10 |
| Favorites not used | 5 | Medium | Low | 3/10 |
| Measurement extraction accuracy | 6 | Medium | High | 6/10 |
| Split view adds complexity | 7 | Medium | High | 5/10 |
| Feature flag bugs | 0 | Low | Low | 2/10 |
| Route fix breaks something | 0 | Very Low | Medium | 1/10 |

**Overall project risk: LOW (4/10)**
- No database schema changes (Phase 3, 5 add new tables, but no ALTER TABLE)
- No API route deletions
- No breaking changes to existing workflows
- Every phase has a 1-2 minute rollback
- Feature flags allow gradual rollout

---

## Rollback Strategy Summary

| Phase | Rollback Time | Method | Data Loss |
|-------|--------------|--------|-----------|
| 0 | 2 min | Revert file | None |
| 1 | 2 min | Revert navItems | None |
| 2 | 1 min | Toggle flag | None |
| 3 | 1 min | Toggle flag | None (macros saved in DB) |
| 4 | 1 min | Toggle flag | None |
| 5 | 1 min | Toggle flag | None (favorites saved in DB) |
| 6 | 2 min | Toggle flag + disable trigger | None |
| 7 | 5 min | Hide UI elements | None |

**Worst case:** Revert all phases -> 15 minutes -> return to current state

---

## Productivity Impact Estimation

### Before vs. After (All Phases)

| Metric | Current | After All Phases | Improvement |
|--------|---------|-----------------|-------------|
| Report pages | 7 | 1 | 86% |
| Sidebar items | 18 | 12 | 33% |
| Clicks per report | 15-20 | 3-5 | 75% |
| Page loads per report | 5-7 | 1 | 86% |
| Measurement typing | 30-60s | 5s | 90% |
| Normal report time | 3-5 min | 30-60s | 80% |
| Studies per hour | ~12 | ~25 | 108% |
| Tab switching | 3-4 times | 0 | 100% |
| Decision fatigue | High | None | Substantial |

### Per-Feature Productivity Impact

| Feature | Time Saved per Report | Reports Affected | Daily Impact (20 reports) |
|---------|----------------------|-----------------|---------------------------|
| **Macros** | 1-2 min | 40-60% (normal/common) | 15-30 min |
| **Previous Report** | 2-3 min | 20-30% (follow-ups) | 10-15 min |
| **Favorites Library** | 30-60s | 80% (all reports) | 15-20 min |
| **Measurement Auto-Insert** | 30-60s | 30-40% (USG) | 5-10 min |
| **Normal Templates** | 1-2 min | 40-60% (normal) | 15-30 min |
| **AI Draft Inline** | 30-60s | 30-40% (complex) | 5-10 min |
| **Menu Consolidation** | 5-10s | 100% | 2-3 min |
| **Delivery Integration** | 2-3 min | 80% | 30-40 min |

**Total estimated daily time saved:** ~1.5-2 hours per radiologist
**Weekly savings:** ~8-10 hours
**Monthly savings:** ~35-40 hours

---

## Implementation Order (Recommended)

1. **Phase 0** (Day 1-2) — establishes safety net
2. **Phase 1** (Week 1) — immediate UX improvement, low risk
3. **Phase 2** (Week 2-4) — core feature, highest impact
4. **Phase 3** (Week 5) — macros, high ROI, small scope
5. **Phase 4** (Week 6) — prior report, high value for follow-ups
6. **Phase 5** (Week 7) — favorites, personal productivity
7. **Phase 6** (Week 7-8) — measurement automation, builds on Phase 2
8. **Phase 7** (Week 8+) — polish, split view decision

**Minimum viable improvement:** Phases 0 + 1 + 2 + 3 (4-5 weeks) -> reduces report time by 60%
**Full implementation:** All phases (8 weeks) -> reduces report time by 80%

---

## Success Metrics to Track

After each phase, measure:

1. **Average time from worklist to finalized report** (target: <2 min for normal)
2. **Number of clicks per report** (target: <5)
3. **Percentage of reports using macros** (target: >40%)
4. **Percentage of reports using normal templates** (target: >60%)
5. **Percentage of measurements auto-inserted** (target: >80%)
6. **Percentage of AI drafts used** (target: >40%)
7. **Percentage of follow-ups with prior report viewed** (target: >80%)
8. **Radiologist satisfaction** (weekly survey, 1-5 scale)
9. **Studies per radiologist per hour** (target: >20)
10. **Error rate** (target: no increase)

---

## Resource Requirements

| Resource | Need | Available |
|----------|------|-----------|
| Developer | 1 full-time | You (or assign) |
| Tester | 1 radiologist | On-site staff |
| DICOM test data | 50 studies | Existing PACS |
| Staging environment | 1 instance | Replit preview |
| Rollback window | 2 hours | After-hours |

---

## Communication Plan

| Phase | Communication | Audience |
|-------|--------------|----------|
| 0 | "Feature flags added, no changes" | All staff |
| 1 | "Menu simplified, USG merged into Radiology" | All staff |
| 2 | "New unified reporting page available" | Radiologists |
| 3 | "Type /mri_brain_normal for instant reports" | Radiologists |
| 4 | "Previous reports now auto-display" | Radiologists |
| 5 | "Save your favorite phrases for quick access" | Radiologists |
| 6 | "Measurements auto-insert, no more typing" | Radiologists |
| 7 | "Notifications, delivery, and performance" | All staff |

---

*End of Revised Implementation Roadmap (v2)*
