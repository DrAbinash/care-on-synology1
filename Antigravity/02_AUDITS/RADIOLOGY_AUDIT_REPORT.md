# Radiology Module Audit Report
## Care Diagnostics ERP - Comprehensive Architecture & Workflow Assessment

**Prepared:** 2026-06-05
**Auditor:** Senior RIS/PACS Product Architect
**Scope:** All radiology features, pages, APIs, workflows, components, and database tables

---

## 1. Executive Summary

### The Core Problem

The Radiology module has **76+ pages, 53+ API routes, and 63+ database tables** - but the radiologist's daily workflow is still **fragmented across 7 different report-writing pages** and **multiple navigation hierarchies**. The original design optimized for "feature completeness" rather than "workflow efficiency."

### Key Findings

| Metric | Current State | Ideal State |
|--------|--------------|-------------|
| **Report pages** | 7 competing pages | 1 unified page |
| **Sidebar items** | 18 (down from 40+) | 10-12 max |
| **Clicks: Worklist -> Report** | 3-4 clicks + page load | 1 click |
| **Clicks: Report -> Images** | 2 clicks + new tab | 0 (embedded) |
| **Measurement typing** | 100% manual (or copy-paste) | 90% auto-inserted |
| **Normal report time** | 3-5 minutes | 30 seconds |
| **Menu confusion** | High ("Which report page?") | None |

### The Biggest Wins (In Order)

1. **Kill the 7 competing report pages** -> One `RadiologyReportUnified` page
2. **Merge the worklist into the reporting page** -> No navigation at all for most cases
3. **Auto-insert measurements** -> From DICOM SR -> report text (not review -> copy -> paste)
4. **One-click normal templates** -> 80% of scans are normal -> should be instant
5. **Collapse "USG/DOPPLER" into Radiology** -> One worklist, one reporting page

---

## 2. Current Architecture Assessment

### 2.1 Frontend Pages (76 Total)

#### Category A: Core Daily Workflow

| Page | Size | Route | Purpose | Daily Usage |
|------|------|-------|---------|-------------|
| `RadiologyWorklist.tsx` | 43K | `/radiology/worklist` | Study queue | HIGH |
| `RadiologyReportUnified.tsx` | 37K | `/radiology/unified-report/:id` | NEW unified reporting | HIGH (target) |
| `PACS.tsx` | 24K | `/pacs` | Study browser | HIGH |
| `DicomViewer.tsx` | 37K | `/radiology/viewer/:uid` | In-browser viewer | Medium |
| `EchoCardiology.tsx` | 29K | `/echo` | Echo reporting | Medium |
| `FetalUsgLevel4.tsx` | 48K | `/fetal-usg` | Fetal reporting | Medium |
| `FetalEcho.tsx` | 25K | `/fetal-echo` | Fetal echo | Low |
| `UsgMeasurementReview.tsx` | 31K | `/usg/measurements/:uid` | Measurement review | Medium |

#### Category B: Important Supporting

| Page | Size | Route | Purpose | Daily Usage |
|------|------|-------|---------|-------------|
| `DicomQueryRetrieve.tsx` | 82K | `/radiology/dicom-qr` | Query remote PACS | Medium |
| `MwlDashboard.tsx` | 15K | `/radiology/mwl-dashboard` | Scheduled procedures | Medium |
| `NormalReportTemplates.tsx` | ~8K | `/radiology/normal-templates` | One-click templates | HIGH |
| `CriticalFindings.tsx` | 9K | `/radiology/critical-findings` | Urgent alerts | Medium |
| `VoiceDictation.tsx` | ~10K | `/radiology/voice-dictation` | Voice-to-text | Low-Medium |
| `TeleradiologyPortal.tsx` | ~20K | `/teleradiology` | Remote reporting | Low |

#### Category C: Administrative / Technical

| Page | Size | Route | Purpose | Users |
|------|------|-------|---------|-------|
| `PacsSettings.tsx` | 60K | `/radiology/pacs-settings` | PACS config | Admin |
| `DicomNodes.tsx` | 47K | `/dicom-nodes` | DICOM registry | Admin |
| `DicomAgentDashboard.tsx` | 19K | `/radiology/dicom-agent-dashboard` | Agent status | Admin |
| `ModalityManagement.tsx` | ~15K | `/radiology/modality-management` | Device registry | Admin |
| `RadiologySettings.tsx` | 6K | `/settings/radiology` | General settings | Admin |
| `MwlManager.tsx` | 8K | `/radiology/mwl-manager` | MWL config | Admin |
| `PacsWatchdogDashboard.tsx` | ~10K | `/radiology/watchdog` | Service monitoring | Admin |
| `Hl7Settings.tsx` | ~8K | `/radiology/hl7-settings` | HL7 bridge | Admin |

#### Category D: Advanced / Future

| Page | Size | Route | Purpose |
|------|------|-------|---------|
| `AiReportingSettings.tsx` | 27K | `/radiology/ai-reporting-settings` | AI provider config |
| `AiPromptTemplates.tsx` | 13K | `/radiology/ai-prompt-templates` | Prompt management |
| `AiModelRouting.tsx` | ~12K | `/radiology/ai-model-routing` | AI routing |
| `AiExtractionReview.tsx` | ~15K | `/radiology/ai-extraction-review` | Measurement review queue |
| `PacsDashboard.tsx` | 51K | `/radiology/pacs-dashboard` | Operational metrics |
| `CommandCenter.tsx` | ~15K | `/radiology/command-center` | Real-time dashboard |

#### Category E: Duplicate / Overlapping (7+ competing report pages)

| Page | Size | Route | Overlaps With |
|------|------|-------|---------------|
| `RadiologyReportGenerator.tsx` | 93K | `/radiology/report-generator` | Unified Report, Report Editor |
| `RadiologyReportingWorkspace.tsx` | 58K | `/radiology/reporting-workspace` | Unified Report |
| `RadiologyReportEditor.tsx` | 21K | `/radiology/report/:studyId` | Unified Report |
| `UsgReporting.tsx` | 55K | `/usg/reporting` | Unified Report |
| `UsgDopplerReporting.tsx` | 19K | `/usg/doppler` | Unified Report |
| `ReportGenerator.tsx` | 1553 lines | `/report-generator` | General pathology reports |
| `ReportHub.tsx` | 934 lines | `/report-hub` | Report management |
| `UsgWorklist.tsx` | 12K | `/usg/worklist` | RadiologyWorklist |
| `RadiologistQueue.tsx` | 7K | `/radiology/radiologist-queue` | RadiologyWorklist |
| `DicomStudyWorklist.tsx` | ~15K | `/radiology/dicom-study-worklist` | RadiologyWorklist |

#### Category F: Obsolete / Deprecated (30+ pages)

`AiAuditLog`, `AiQualityScores`, `AiPromptEffectiveness`, `AiDicomFindings`, `RagVectorStore`, `AiSearchRetrieval`, `AnomalyAlerts`, `ReportDiffViewer`, `FeedbackLoopAnalytics`, `TemplateVersions`, `AiBillingSuggestions`, `PeerReviewAssignments`, `TurnaroundTimeAnalytics`, `TrainingDataExports`, `ReportQualityGates`, `ProviderHealthMonitor`, `AcquisitionGateway`, `StorageLifecycle`, `PacsArchiveLifecycle`, `PacsLogs`, `AgentSetup`, `RadiologistTools`, `AiPipelineManager`, `CriticalAlertsManager`, `UsgCriticalAlerts`, `UsgKeyImagesGallery`, `UsgAnalytics`, `UsgAdminSettings`, `HangingProtocols`, `TechnicianWorkflow`, `PatientCommunication`, `RadiologyCommandCenter` (duplicate), `AiInferenceSettings`

### 2.2 Non-Radiology Pages That Compete

| Page | Route | Why It Competes |
|------|-------|-----------------|
| `ReportGenerator.tsx` | `/report-generator` | Radiologists also write pathology reports |
| `ReportHub.tsx` | `/report-hub` | Duplicates worklist + delivery |
| `Samples.tsx` | `/samples` | Radiology has its own sample tracking |
| `ScanStation.tsx` | `/scan-station` | Should be integrated into worklist |
| `ReportDelivery.tsx` | `/report-delivery` | Should be integrated into reporting |
| `Reports.tsx` | `/reports` | Analytics (not radiology reports) |

### 2.3 API Architecture

22+ route files for radiology. Over-segmented but well-structured.

### 2.4 Database Schema (63+ tables)

| Category | Tables | Assessment |
|----------|--------|------------|
| Core workflow | 5 | Essential |
| DICOM/PACS | 6 | Essential |
| USG measurements | 5 | Essential |
| AI/Smart | 6 | Partially used |
| Specialized | 3 | Used |
| Enterprise | 7 | Over-engineered |
| Admin/Config | 7 | Some unused |
| Audit/Log | 5 | Operational |
| Teleradiology | 2 | If used |

---

## 3. Workflow Assessment

### 3.1 Current Workflow (Painful)

```
Bill Created -> Study in Worklist -> Open Worklist (1 click)
  -> Click Study (1 click) -> Choose WHICH report page? (confusion)
  -> Navigate to /radiology/report-generator OR /radiology/reporting-workspace OR /radiology/unified-report
  -> Page loads -> Click "View Images" -> Opens PACS in new tab (2 clicks)
  -> Read measurements from DICOM -> Switch back to report tab
  -> Type measurements manually OR go to /usg/measurements/:uid -> Copy -> Paste
  -> Click "Generate AI Draft" -> Wait -> Read -> Decide to use or not
  -> Click "Normal Templates" -> Another page -> Find template -> Copy -> Paste
  -> Type impression manually -> Click Save -> Click Finalize -> Go to Delivery page
```

**Total clicks: 15-20 | Page loads: 5-7 | Interruptions: 4 (tab switching, copying, navigation)**

### 3.2 Ideal Workflow (Target)

```
Bill Created -> Study in Worklist -> Click Study (1 click)
  -> Unified Report Page loads WITH:
     - Embedded OHIF viewer (left panel)
     - Measurements extracted from DICOM SR (click to insert)
     - AI Draft generated (click to insert)
     - Normal Templates (1-click insert)
     - Report textarea (center)
     - Patient info (top, auto-filled)
     - Save Draft / Finalize buttons (bottom)
  -> Radiologist reviews images, clicks normal template, edits if needed, clicks Finalize
```

**Total clicks: 3-5 | Page loads: 1 | Interruptions: 0**

---

## 4. UI/UX Assessment

### Problems Identified

1. **Decision fatigue**: 7 different report pages confuse radiologists
2. **Tab madness**: Images open in separate tabs, breaking flow
3. **Copy-paste hell**: Measurements require manual transcription or review-page copy-paste
4. **Feature overload**: 18 sidebar items, many never used
5. **Inconsistent UX**: Each report page has different button placement, different save behavior
6. **Missing keyboard shortcuts**: No hotkeys for common actions
7. **No inline help**: Radiologists must guess what buttons do
8. **USG/DOPPLER outside Radiology**: Separate menu item creates confusion

### What Works Well

1. **Unified Report Page**: Already built, has the right concept
2. **DICOM auto-ingest**: New studies appear automatically with toast notification
3. **USG extraction pipeline**: DICOM SR -> measurements -> pending_review (good safety)
4. **AI safety label**: "AI Draft - Requires Radiologist Review" is correct
5. **Normal templates**: Database-backed, editable, one-click concept is right
6. **PACS integration**: OHIF viewer works, WADO proxy works

---

## 5. Feature Classification

### 5.1 A - Core Daily Workflow (Keep, Make Primary)

| Feature | Route | Action | Notes |
|---------|-------|--------|-------|
| Worklist Hub | `/radiology/worklist` | **Keep** | Primary entry point |
| Unified Report | `/radiology/unified-report/:id` | **Make primary** | Merge all report pages into this |
| PACS Viewer | `/pacs` | **Keep** | For browsing, not per-study |
| Normal Templates | `/radiology/normal-templates` | **Integrate** | Into unified report page |
| Critical Findings | `/radiology/critical-findings` | **Keep** | Essential for patient safety |

### 5.2 B - Important Supporting (Keep, Accessible)

| Feature | Route | Action | Notes |
|---------|-------|--------|-------|
| DICOM Q/R | `/radiology/dicom-qr` | **Keep** | Used for remote studies |
| MWL Dashboard | `/radiology/mwl-dashboard` | **Keep** | Scheduled procedures |
| Voice Dictation | `/radiology/voice-dictation` | **Integrate** | Button in unified report |
| Teleradiology | `/teleradiology` | **Keep** | If used |
| Echo | `/echo` | **Keep** | Specialized modality |
| Fetal USG | `/fetal-usg` | **Keep** | Specialized modality |
| Fetal Echo | `/fetal-echo` | **Keep** | Specialized modality |

### 5.3 C - Administrative (Move to Admin Section)

| Feature | Route | Action | Notes |
|---------|-------|--------|-------|
| PACS Settings | `/radiology/pacs-settings` | **Move** | To Settings > PACS |
| DICOM Nodes | `/dicom-nodes` | **Move** | To Settings > DICOM |
| DICOM Agent | `/radiology/dicom-agent-dashboard` | **Move** | To Settings > Agents |
| Modality Management | `/radiology/modality-management` | **Move** | To Settings > Devices |
| MWL Manager | `/radiology/mwl-manager` | **Move** | To Settings > MWL |
| Watchdog | `/radiology/watchdog` | **Move** | To Settings > Monitoring |
| HL7 Settings | `/radiology/hl7-settings` | **Move** | To Settings > Integrations |

### 5.4 D - Advanced / Future (Hide, Flag-gated)

| Feature | Route | Action | Notes |
|---------|-------|--------|-------|
| AI Reporting Settings | `/radiology/ai-reporting-settings` | **Hide** | Flag: `showAdvancedAi` |
| AI Prompt Templates | `/radiology/ai-prompt-templates` | **Hide** | Flag: `showAdvancedAi` |
| AI Model Routing | `/radiology/ai-model-routing` | **Hide** | Flag: `showAdvancedAi` |
| PACS Dashboard | `/radiology/pacs-dashboard` | **Hide** | Flag: `showAnalytics` |
| Command Center | `/radiology/command-center` | **Hide** | Flag: `showAnalytics` |
| AI Extraction Review | `/radiology/ai-extraction-review` | **Hide** | Now integrated into report page |

### 5.5 E - Duplicate / Overlapping (Deprecate Routes, Merge Code)

| Feature | Route | Action | Merge Into |
|---------|-------|--------|------------|
| RadiologyReportGenerator | `/radiology/report-generator` | **Deprecate** | Unified Report |
| RadiologyReportingWorkspace | `/radiology/reporting-workspace` | **Deprecate** | Unified Report |
| RadiologyReportEditor | `/radiology/report/:studyId` | **Deprecate** | Unified Report |
| UsgReporting | `/usg/reporting` | **Deprecate** | Unified Report |
| UsgDopplerReporting | `/usg/doppler` | **Deprecate** | Unified Report |
| UsgWorklist | `/usg/worklist` | **Deprecate** | RadiologyWorklist |
| RadiologistQueue | `/radiology/radiologist-queue` | **Deprecate** | RadiologyWorklist |
| DicomStudyWorklist | `/radiology/dicom-study-worklist` | **Deprecate** | RadiologyWorklist |
| ReportHub | `/report-hub` | **Deprecate** | RadiologyWorklist + Delivery |
| ReportGenerator (general) | `/report-generator` | **Keep** | For pathology, not radiology |

### 5.6 F - Obsolete (Hide Routes, Preserve Code)

All 30+ obsolete pages listed in Category F above: **Hide from sidebar, keep routes in App.tsx for back-compat.**

---

## 6. Feature Overlap Analysis

### 6.1 The 7 Competing Report Pages

```
RadiologyReportUnified.tsx (37K, NEW) - Target: embedded viewer, measurements, AI, templates
RadiologyReportGenerator.tsx (93K) - OLD: full-featured but standalone, no embedded viewer
RadiologyReportingWorkspace.tsx (58K) - OLD: workspace concept, embedded viewer but complex
RadiologyReportEditor.tsx (21K) - OLD: simple text editor, no viewer
UsgReporting.tsx (55K) - OLD: USG-specific, duplicates unified report
UsgDopplerReporting.tsx (19K) - OLD: Doppler-specific, duplicates unified report
ReportGenerator.tsx (1553 lines) - OLD: general pathology, not radiology-specific
```

**Recommendation**: Keep `RadiologyReportUnified` as the single report page. Port missing features from others into it:
- From `RadiologyReportGenerator`: Voice dictation, print settings, PDF export
- From `RadiologyReportingWorkspace`: Better embedded viewer integration
- From `UsgReporting`: USG-specific measurement layouts
- From `ReportGenerator`: Report parameters (structured data entry)

### 6.2 The 3 Competing Worklists

```
RadiologyWorklist.tsx (43K) - Main worklist, has status filtering, queue panel
UsgWorklist.tsx (12K) - USG-specific, just a subset
DicomStudyWorklist.tsx (~15K) - DICOM-specific, overlaps
```

**Recommendation**: Keep `RadiologyWorklist` only. Add modality filter tabs to it. Remove USG-specific worklist.

### 6.3 The Measurement Extraction Bottleneck

```
Current: DICOM SR -> usgExtractor.ts -> pending_review -> UsgMeasurementReview page
         -> Radiologist copies -> pastes into report

Ideal: DICOM SR -> usgExtractor.ts -> auto-appear in Unified Report
       -> Radiologist clicks "Insert" -> auto-formatted into report text
```

**Recommendation**: Skip the separate review page. Extracted measurements should appear in the unified report page with "Insert" buttons. Only go to review page for corrections.

---

## 7. Recommended Menu Structure

### 7.1 Proposed Sidebar (12 items max)

```
RADIOLOGY & IMAGING (group)
|-- Worklist Hub          /radiology/worklist           (daily)
|-- Reporting Workspace   /radiology/unified-report       (daily - can merge with worklist)
|-- PACS Viewer           /pacs                           (daily)
|-- Normal Templates      /radiology/normal-templates     (daily)
|-- Critical Findings     /radiology/critical-findings   (daily)
|-- DICOM Query/Retrieve  /radiology/dicom-qr             (weekly)
|-- MWL Dashboard         /radiology/mwl-dashboard        (weekly)
|-- Teleradiology         /teleradiology                  (if used)
|-- Echo Cardiology       /echo                           (specialty)
|-- Fetal USG             /fetal-usg                      (specialty)
|-- Voice Dictation       /radiology/voice-dictation      (optional)

SETTINGS (group)
|-- PACS & DICOM          /radiology/pacs-settings        (admin)
|-- DICOM Nodes           /dicom-nodes                    (admin)
|-- DICOM Agent           /radiology/dicom-agent-dashboard (admin)
|-- Modality Management   /radiology/modality-management  (admin)
|-- Radiology Settings    /settings/radiology             (admin)

REMOVE from sidebar:
- AI Reporting (move to settings)
- AI Extraction Review (integrate into report page)
- All analytics pages (hide, flag-gated)
- All admin pages (move to settings group)
- USG/DOPPLER top-level item (merge into radiology)
```

### 7.2 Proposed Worklist -> Report Flow

```
[Worklist Hub]
  |-- Study row: Patient | Modality | Status | Actions
  |-- Actions: [Report] [View Images] [Measurements] [AI Draft] [Finalize]
  |-- Click [Report] -> opens Unified Report with study pre-loaded
  |-- Click [View Images] -> opens embedded viewer (not new tab)
  |-- Click [Measurements] -> shows extracted measurements panel
  |-- Click [AI Draft] -> shows AI draft panel
  |-- Click [Finalize] -> one-click finalize (for normal studies)
```

---

## 8. Actionable Recommendations

### Phase 1: Consolidate (Week 1-2)

1. **Remove deprecated sidebar items** (30+ items) - keep routes for back-compat
2. **Merge USG/DOPPLER into Radiology** group - remove top-level `/usg` item
3. **Hide admin pages** behind ownerOnly or move to Settings group
4. **Hide analytics pages** behind feature flag
5. **Fix duplicate route** `/radiology/command-center` in App.tsx

### Phase 2: Unify Reporting (Week 3-4)

1. **Port missing features into Unified Report**:
   - Voice dictation button from `RadiologyReportGenerator`
   - Print settings dialog from `RadiologyReportGenerator`
   - Better embedded viewer from `RadiologyReportingWorkspace`
   - USG measurement layouts from `UsgReporting`
2. **Add measurement auto-insert**:
   - Poll `/api/usg-extraction/study/:uid` from unified report
   - Show extracted measurements as clickable rows
   - Click -> insert formatted text into report textarea
3. **Add AI draft insert**:
   - Show AI draft as collapsible panel
   - "Insert AI Draft" button -> inserts into report
   - Always show safety label

### Phase 3: Worklist Integration (Week 5-6)

1. **Add action buttons to worklist rows**:
   - Report, View Images, Measurements, AI Draft, Finalize
2. **Make worklist a split view**:
   - Left: study list
   - Right: unified report panel (collapsible)
   - No page navigation needed for 80% of studies
3. **Add keyboard shortcuts**:
   - `R` -> Report selected study
   - `F` -> Finalize
   - `N` -> Insert normal template
   - `V` -> Toggle voice dictation

### Phase 4: Polish (Week 7-8)

1. **Add study status indicators** to worklist
2. **Add auto-refresh** with toast notifications
3. **Add batch finalize** for normal studies
4. **Add report preview** before finalization
5. **Add delivery integration** (print, email, WhatsApp) from report page

### What NOT to Do

1. **Don't delete existing report pages** - hide routes, preserve code
2. **Don't change database schema** - existing tables work fine
3. **Don't remove API routes** - they're used internally
4. **Don't break existing bookmarks** - routes stay, sidebar changes
5. **Don't force new workflow immediately** - make it optional, gather feedback

---

## 9. Missing Features for Productivity

### 9.1 Quick Wins (Implement Soon)

| Feature | Impact | Effort |
|---------|--------|--------|
| Keyboard shortcuts for common actions | High | 1 day |
| Measurement auto-insert from DICOM | High | 3 days |
| AI draft one-click insert | High | 2 days |
| Normal template one-click from report | High | 1 day |
| Worklist row action buttons | High | 2 days |
| Split view worklist + report | High | 3 days |

### 9.2 Medium-term (After consolidation)

| Feature | Impact | Effort |
|---------|--------|--------|
| Report macros (custom shortcuts) | Medium | 3 days |
| Batch operations (batch finalize) | Medium | 2 days |
| Report templates per modality | Medium | 3 days |
| Voice dictation integration | Medium | 2 days |
| Study comparison (prior studies) | Medium | 5 days |

### 9.3 Future (Nice to have)

| Feature | Impact | Effort |
|---------|--------|--------|
| AI-assisted impression generation | Medium | 5 days |
| Automated quality checks | Medium | 3 days |
| Peer review workflow | Low | 5 days |
| Multi-site teleradiology | Low | 10 days |
| Patient portal report viewing | Medium | 5 days |

---

## 10. Conclusion

The Radiology module has **excellent infrastructure** (DICOM pipeline, measurement extraction, AI integration, PACS viewer) but **poor workflow integration**. The fix is not to build more features, but to **consolidate the existing ones into a single, seamless workflow**.

**The guiding principle**: A radiologist should never have to think about which page to use, which tab to switch to, or how to copy measurements. They should open the worklist, click a study, and everything they need should be right there.

**Key metrics to track**:
- Average time from worklist to finalized report
- Number of clicks per report
- Percentage of reports using normal templates
- Percentage of measurements auto-inserted vs typed
- Radiologist satisfaction (survey)

---

*End of Audit Report*
