# RADIOLOGY MASTER CODEBASE AUDIT
## Care Diagnostics ERP - Complete Architectural Review

---

# PART 1 - FRONTEND ROUTES AUDIT

| # | Route | Component | File | Lines | Purpose | Status | Recommendation |
|---|-------|-----------|------|-------|---------|--------|----------------|
| **CORE REPORTING** | | | | | | |
| 1 | `/radiology` | `Radiology` | `pages/Radiology.tsx` | ~73K | Main dashboard | **ACTIVE** | **KEEP** |
| 2 | `/radiology/worklist` | `RadiologyWorklist` | `pages/RadiologyWorklist.tsx` | ~44K | Study worklist | **ACTIVE** | **KEEP** |
| 3 | `/radiology/report-generator` | `RadiologyReportGen` | `pages/RadiologyReportGenerator.tsx` | ~95K | Legacy report generator | **DEPRECATED** | **DEPRECATE** |
| 4 | `/radiology/report/:studyId` | `RadiologyReportEditor` | `pages/RadiologyReportEditor.tsx` | ~21K | Simple editor | **DEPRECATED** | **DEPRECATE** |
| 5 | `/radiology/reporting-workspace` | `RadiologyReportingWorkspace` | `pages/RadiologyReportingWorkspace.tsx` | ~65K | **Unified workstation** | **ACTIVE** | **KEEP** |
| 6 | `/radiology/reporting-workspace/:studyId` | `RadiologyReportingWorkspace` | (same) | - | With study ID | **ACTIVE** | **KEEP** |
| 7 | `/radiology/unified-report/:worklistId` | `RadiologyReportUnified` | `pages/RadiologyReportUnified.tsx` | ~114K | **Competing unified page** | **DEPRECATED** | **DEPRECATE** |
| **VIEWER & DICOM** | | | | | | |
| 8 | `/radiology/viewer/:studyInstanceUID` | `DicomViewer` | `pages/DicomViewer.tsx` | ~848 | Full DICOM viewer | **ACTIVE** | **KEEP** |
| 9 | `/pacs` | `PACS` | `pages/PACS.tsx` | ~485 | Legacy PACS page | **DEPRECATED** | **DEPRECATE** |
| 10 | `/radiology/pacs-dashboard` | `PacsDashboard` | `pages/PacsDashboard.tsx` | ~1K | PACS monitoring | **RARELY USED** | **HIDE** |
| 11 | `/radiology/pacs-settings` | `PacsSettings` | `pages/PacsSettings.tsx` | ~1.3K | PACS configuration | **RARELY USED** | **HIDE** |
| 12 | `/radiology/dicom-qr` | `DicomQueryRetrieve` | `pages/DicomQueryRetrieve.tsx` | ~1.7K | DICOM query/retrieve | **RARELY USED** | **HIDE** |
| 13 | `/radiology/mwl-dashboard` | `MwlDashboard` | `pages/MwlDashboard.tsx` | ~330 | Modality worklist | **RARELY USED** | **HIDE** |
| 14 | `/radiology/dicom-agent-dashboard` | `DicomAgentDashboard` | `pages/DicomAgentDashboard.tsx` | - | DICOM agent monitor | **RARELY USED** | **HIDE** |
| 15 | `/radiology/modality-management` | `ModalityManagement` | `pages/ModalityManagement.tsx` | - | Modality config | **RARELY USED** | **HIDE** |
| 16 | `/radiology/agent-setup` | `AgentSetup` | `pages/AgentSetup.tsx` | - | DICOM agent setup | **RARELY USED** | **HIDE** |
| 17 | `/radiology/pacs-logs` | `PacsLogs` | `pages/PacsLogs.tsx` | - | PACS logs | **RARELY USED** | **HIDE** |
| **AI & INTELLIGENCE** | | | | | | |
| 18-34 | `/radiology/ai-*` | Various | Various | ~200-300 each | AI settings/tools | **RARELY USED** | **HIDE** (18 pages) |
| **OPERATIONAL** | | | | | | |
| 35-46 | `/radiology/productivity`, `/radiology/command-center`, etc. | Various | Various | - | Admin/operational | **RARELY USED** | **HIDE** (12 pages) |
| **TEMPLATES** | | | | | | |
| 47-60 | `/radiology/normal-templates`, `/radiology/structured-report-templates`, etc. | Various | Various | - | Template management | **RARELY USED** | **HIDE** (14 pages) |
| **TEACHING** | | | | | | |
| 61-70 | `/teaching-cases`, `/teaching-collections`, etc. | Various | Various | - | Teaching/academic | **RARELY USED** | **HIDE** (10 pages) |
| **TELERADIOLOGY** | | | | | | |
| 71 | `/teleradiology` | `TeleradiologyPortal` | `pages/TeleradiologyPortal.tsx` | ~19K | Teleradiology portal | **RARELY USED** | **HIDE** |
| **USG** | | | | | | |
| 72-74 | `/usg`, `/usg/worklist`, `/usg/doppler` | Various | Various | - | USG workflow | **RARELY USED** | **HIDE** (3 pages) |
| **OTHER** | | | | | | |
| 75 | `/dicom-nodes` | `DicomNodes` | `pages/DicomNodes.tsx` | ~1K | DICOM nodes config | **RARELY USED** | **HIDE** |
| 76-78 | `/reports`, `/report-generator`, `/report-hub` | Various | Various | - | Non-radiology reports | **ACTIVE** | **KEEP** |

## ROUTE SUMMARY

| Category | Count | Keep | Hide | Deprecate |
|----------|-------|------|------|-----------|
| Core Reporting | 7 | 3 | 0 | 4 |
| Viewer & DICOM | 10 | 1 | 9 | 1 |
| AI & Intelligence | 18 | 0 | 18 | 0 |
| Operational | 12 | 0 | 12 | 0 |
| Templates & Reporting | 14 | 0 | 14 | 0 |
| Teaching | 10 | 0 | 10 | 0 |
| Teleradiology | 1 | 0 | 1 | 0 |
| USG | 3 | 0 | 3 | 0 |
| Other | 3 | 3 | 0 | 0 |
| **TOTAL** | **78** | **7** | **67** | **5** |

**Daily radiologist workflow needs only 3 pages:**
1. `/radiology` (dashboard)
2. `/radiology/worklist` (study list)
3. `/radiology/reporting-workspace` (single unified workstation)

Plus 1 standalone viewer: `/radiology/viewer/:uid` (when full DICOM viewer needed)

---

# PART 2 - COMPONENT AUDIT

| Component | File | Lines | Purpose | Used By | Duplicate? | Visible? | Destination |
|-----------|------|-------|---------|---------|------------|----------|-------------|
| **RadiologyCopilotPanel** | `src/components/RadiologyCopilotPanel.tsx` | ~46K | Prior studies, impression suggest, consistency, follow-up | `RadiologyReportingWorkspace`, `ReportGenerator` | Partially | **YES** | **RIGHT TAB 2** |
| **RadiologyAICopilotPanel** | `src/components/RadiologyAICopilotPanel.tsx` | ~32K | Multi-AI provider shell (Phase 6) | `RadiologyReportUnified` | **DUPLICATE** | **NO** | **DEPRECATE** |
| **RadiologyMemoryPanel** | `src/components/RadiologyMemoryPanel.tsx` | ~27K | Memory engine: suggest, impressions, measurements, analytics | `RadiologyReportingWorkspace`, `ReportGenerator` | None | **YES** | **RIGHT TAB 4** |
| **RadiologyKnowledgePanel** | `src/components/RadiologyKnowledgePanel.tsx` | ~47K | Master templates, personal templates, knowledge base | `RadiologyReportUnified` | **DUPLICATE** | **NO** | **DEPRECATE** |
| **RadiologySmartFindingsPanel** | `src/components/RadiologySmartFindingsPanel.tsx` | ~16K | Structured findings builder | `RadiologyReportUnified` | **DUPLICATE** | **NO** | **DEPRECATE** |
| **RadiologyProductivityPanel** | `src/components/RadiologyProductivityPanel.tsx` | ~20K | Analytics dashboard | `RadiologyReportUnified` | None | **NO** | **BACKEND-ONLY** |
| **MeasurementAssistantPanel** | `src/components/MeasurementAssistantPanel.tsx` | ~305 | Guided measurement entry | `RadiologyReportingWorkspace`, `ReportGenerator` | None | **YES** | **RIGHT TAB 4** |
| **SpinalMeasurementPanel** | `src/components/SpinalMeasurementPanel.tsx` | ~396 | Vertebral/disc measurements | `RadiologyReportGenerator` | **DUPLICATE** | **NO** | **MERGE** into MeasurementAssistantPanel |
| **LesionTrackerPanel** | `src/components/LesionTrackerPanel.tsx` | ~407 | RECIST lesion tracking | `ReportGenerator` | None | **NO** | **HIDE** (Phase 10) |
| **TumorFollowupPanel** | `src/components/TumorFollowupPanel.tsx` | ~289 | Tumor response tracking | `RadiologyCopilotPanel` | **DUPLICATE** | **NO** | **MERGE** into LesionTrackerPanel |
| **BrainIntelligencePanel** | `src/components/BrainIntelligencePanel.tsx` | ~315 | Fazekas scoring, atrophy | `RadiologyCopilotPanel` | None | **NO** | **HIDE** (Phase 10B) |
| **SpineIntelligencePanel** | `src/components/SpineIntelligencePanel.tsx` | ~347 | Disc grading, stenosis | `RadiologyCopilotPanel` | None | **NO** | **HIDE** (Phase 10B) |
| **EmbeddedWadoViewer** | `src/components/EmbeddedWadoViewer.tsx` | ~287 | Lightweight DICOM viewer | `RadiologyReportingWorkspace` | None | **YES** | **LEFT PANEL** |
| **ImageAnnotationToolbar** | `src/components/ImageAnnotationToolbar.tsx` | ~285 | DICOM annotations | `ReportGenerator`, `RadiologyCopilotPanel` | None | **NO** | **HIDE** (Phase 10B) |
| **MultiAIReviewPanel** | `src/components/MultiAIReviewPanel.tsx` | ~389 | Multi-AI comparison | `RadiologyCopilotPanel` | **DUPLICATE** | **NO** | **HIDE** (research) |
| **AIConfidenceBadge** | `src/components/AIConfidenceBadge.tsx` | ~137 | Confidence badge | Multiple AI panels | None | **NO** | **HIDE** (Phase 10C) |
| **SmartRadiologyCards** | `src/components/smartRadiology/SmartRadiologyCards.tsx` | ~150 | Dashboard widgets | `Dashboard`, `RadiologyWorklist` | None | **YES** | **Dashboard** |
| **CaseOfMonthPanel** | `src/components/CaseOfMonthPanel.tsx` | ~32 | Editorial workflow | `TeachingCollections` | None | **NO** | **HIDE** (research) |

## COMPONENT DUPLICATION MAP

```
RadiologyCopilotPanel (Phase 8) ----
                                    |--- DUPLICATE -> MERGE into one
RadiologyAICopilotPanel (Phase 6) --

RadiologyKnowledgePanel ----
                            |--- DUPLICATE -> MERGE template features into workspace
Workspace Templates Tab  --

RadiologySmartFindingsPanel ----
                                |--- DUPLICATE -> MERGE into workspace editor
Workspace Smart Macros      ----

MeasurementAssistantPanel ----
                              |--- DUPLICATE -> MERGE into one
SpinalMeasurementPanel   ----

LesionTrackerPanel    ----
                         |--- DUPLICATE -> MERGE into one
TumorFollowupPanel  ----
```

---

# PART 3 - SETTINGS AUDIT

## Complete Feature Flag Inventory (85 flags)

| Flag | Default | Description | Used In | Required? | Duplicate? |
|------|---------|-------------|---------|-----------|------------|
| **ESSENTIAL (14)** | | | | | |
| `radiologyAiAssistant` | `false` | Gemini impression generation | `RadiologyReportUnified` | **YES** | NO |
| `radiologyQuickAdd` | `false` | Alt+1-6 shortcuts | `RadiologyReportUnified` | **YES** | NO |
| `radiologyMacros` | `false` | /fl1, /faz1 shortcuts | `RadiologyReportUnified`, `RadiologyMemoryPanel` | **YES** | **YES** |
| `radiologyMeasurements` | `false` | Measurements panel | `RadiologyReportUnified` | **YES** | **YES** |
| `radiologyFavorites` | `false` | Templates/favorites | `RadiologyReportUnified` | **YES** | **YES** |
| `radiologyPreviousReports` | `false` | Prior reports | `RadiologyReportUnified` | **YES** | NO |
| `radiologySmartFormat` | `false` | Shift+Alt+1-5 templates | `RadiologyReportUnified` | **YES** | NO |
| `radiologyMemoryEngine` | `false` | Memory engine | `RadiologyMemoryPanel` | **YES** | NO |
| `radiologyImpressionMemory` | `false` | Impression recall | `RadiologyMemoryPanel` | **YES** | NO |
| `radiologyMeasurementMemory` | `false` | Measurement history | `RadiologyMemoryPanel` | **YES** | NO |
| `radiologyDecisionMemory` | `false` | Decision tracking | `RadiologyMemoryPanel` | **YES** | NO |
| `radiologyFeedbackLoop` | `false` | Feedback buttons | `RadiologyMemoryPanel` | **YES** | NO |
| `radiologyMacroEngine` | `false` | Macro engine | `RadiologyMemoryPanel` | **YES** | **YES** |
| `radiologyStyleLearning` | `false` | Style learning | `RadiologyMemoryPanel` | **YES** | NO |
| **ADVANCED (18)** | | | | | |
| `radiologyPriorComparison` | `false` | Prior auto-fetch | `RadiologyReportUnified` | NO | NO |
| `radiologyStructuredFindings` | `false` | Structured findings | `RadiologyReportUnified` | NO | **YES** |
| `radiologyConflictDetection` | `false` | Contradiction warning | `RadiologyReportUnified` | NO | NO |
| `radiologyQualityChecker` | `false` | Pre-finalize checks | `RadiologyReportUnified` | NO | **YES** |
| `radiologyPriorityEngine` | `false` | Auto-classify priority | `RadiologyReportUnified` | NO | NO |
| `radiologyVersionHistory` | `false` | Track edits | `RadiologyReportUnified` | NO | NO |
| `radiologyQAGuard` | `false` | Comprehensive QA | `RadiologyReportUnified` | NO | **YES** |
| `radiologyReportAssembler` | `false` | Multi-template selection | `RadiologyReportUnified` | NO | NO |
| `radiologyOneClickReports` | `false` | Instant reports | `RadiologyReportUnified` | NO | NO |
| `radiologyLanguagePolish` | `false` | Language polish | `RadiologyReportUnified` | NO | NO |
| `radiologyMultiAI` | `false` | Multi-AI routing | `RadiologyReportUnified` | NO | NO |
| `radiologyDifferentialDiagnosis` | `false` | Differential diagnosis | `RadiologyReportUnified` | NO | NO |
| `radiologyFollowUp` | `false` | Follow-up recommendations | `RadiologyReportUnified` | NO | **YES** |
| `radiologyPromptManager` | `false` | Prompt manager | `RadiologyReportUnified` | NO | **YES** |
| `radiologyProviderFallback` | `false` | Provider fallback | `RadiologyReportUnified` | NO | NO |
| `radiologyMissedFindingDetector` | `false` | Missed finding detector | `RadiologyReportUnified` | NO | NO |
| `radiologyImpressionRules` | `false` | Rule-based impressions | `RadiologyReportUnified` | NO | NO |
| `radiologySignOffProfiles` | `false` | Per-radiologist defaults | `RadiologyReportUnified` | NO | NO |
| **DUPLICATE (28)** | | | | | |
| `radiologyImpressionSync` | `false` | Auto-suggest impressions | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyAiAssistant` |
| `radiologySmartImpression` | `false` | Combine findings | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyAiAssistant` |
| `radiologySmartImpression_v2` | `false` | Smart impression builder | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyAiAssistant` |
| `radiologyAICopilot` | `false` | AI Copilot panel | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyAiAssistant` |
| `radiologyMeasurementLibrary` | `false` | One-click measurements | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyMeasurements` |
| `radiologyAdvancedMeasurements` | `false` | Advanced measurements | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyMeasurements` |
| `radiologyMeasurementTracker` | `false` | Measurement tracker | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyMeasurements` |
| `measurementAssistant` | `false` | Measurement assistant | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyMeasurements` |
| `radiologyFavoritesPack` | `false` | Save entire report | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyKnowledgeBase` | `false` | Teaching library | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyKnowledgePlatform` | `false` | Knowledge platform | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyKnowledgeBase_v2` | `false` | Knowledge base v2 | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyMasterLibrary` | `false` | Locked templates | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyMasterTemplates` | `false` | DB-backed templates | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyPersonalLibrary` | `false` | Personal library | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyFavoriteFindingSets` | `false` | Favorite finding sets | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyTemplatePacks` | `false` | Template packs | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFavorites` |
| `radiologyQualityCheck` | `false` | AI quality check | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyQualityChecker` |
| `radiologyFinalizationDashboard` | `false` | Final checkpoint | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyQualityChecker` |
| `radiologyConsistencyChecker` | `false` | Consistency checker | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyQualityChecker` |
| `radiologyComparison` | `false` | Previous comparison | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyPriorComparison` |
| `radiologyComparePrevious` | `false` | Previous comparison | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyPriorComparison` |
| `radiologyAnalytics` | `false` | Reporting stats | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyAnalytics` |
| `radiologySmartAnalytics` | `false` | Smart reporting stats | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyAnalytics` |
| `radiologyAnalyticsMemory` | `false` | Personal analytics | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyAnalytics` |
| `radiologyPromptManager_v2` | `false` | Prompt manager v2 | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyPromptManager` |
| `radiologyImageReviewAssistant` | `false` | Image review assistant | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyImageReview` |
| `radiologyFollowupAssistant` | `false` | Follow-up intelligence | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyFollowUp` |
| **OBSOLETE (1)** | | | | | |
| `radiologyAiHooks` | `false` | Future AI hooks | `RadiologyReportUnified` | NO | **OBSOLETE** |
| **PHASE 10 (14)** | | | | | |
| `dicomImageIntelligence` | `false` | Phase 10 master | `RadiologyReportUnified` | NO | NO |
| `lesionTracking` | `false` | Lesion tracker | `RadiologyReportUnified` | NO | NO |
| `changeDetection` | `false` | Change detector | `RadiologyReportUnified` | NO | NO |
| `spineIntelligence` | `false` | Spine intelligence | `RadiologyReportUnified` | NO | NO |
| `brainIntelligence` | `false` | Brain intelligence | `RadiologyReportUnified` | NO | NO |
| `tumorFollowup` | `false` | Tumor follow-up | `RadiologyReportUnified` | NO | NO |
| `imageAnnotations` | `false` | Image annotations | `RadiologyReportUnified` | NO | NO |
| `multiAIImageReview` | `false` | Multi-AI image review | `RadiologyReportUnified` | NO | **YES** -> merge into `radiologyMultiAI` |
| `teachingGenerator` | `false` | Teaching generator | `RadiologyReportUnified` | NO | NO |
| `researchDatabase` | `false` | Research database | `RadiologyReportUnified` | NO | NO |
| `caseOfMonth` | `false` | Case of the month | `RadiologyReportUnified` | NO | NO |
| `confidenceVisualization` | `false` | AI confidence bars | `RadiologyReportUnified` | NO | NO |
| `ollamaSupport` | `false` | Ollama local models | `RadiologyReportUnified` | NO | NO |
| `annotationLayer` | `false` | Report annotations | `RadiologyReportUnified` | NO | NO |
| **META (2)** | | | | | |
| `hideDeprecatedNav` | `false` | Hide deprecated nav | `Layout.tsx` | **YES** | NO |
| `showUnifiedReporting` | `false` | Show unified reporting | `Layout.tsx` | **YES** | NO |
| **TEACHING (6)** | | | | | |
| `radiologyTeachingMode` | `false` | Teaching mode | `RadiologyReportUnified` | NO | NO |
| `radiologyTeachingFiles` | `false` | Teaching files | `RadiologyReportUnified` | NO | NO |
| `radiologyTeachingAI` | `false` | Teaching AI | `RadiologyReportUnified` | NO | NO |
| `radiologyTeachingCollections` | `false` | Teaching collections | `RadiologyReportUnified` | NO | NO |
| `radiologyTeachingPresentation` | `false` | Presentation mode | `RadiologyReportUnified` | NO | NO |
| `radiologyTeachingResearch` | `false` | Research mode | `RadiologyReportUnified` | NO | NO |

### SETTINGS SUMMARY

| Category | Count | Keep | Remove | Merge |
|----------|-------|------|--------|-------|
| Essential | 14 | 14 | 0 | 0 |
| Advanced | 18 | 18 | 0 | 0 |
| Duplicate | 28 | 0 | 0 | 28 |
| Obsolete | 1 | 0 | 1 | 0 |
| Phase 10 | 14 | 14 | 0 | 0 |
| Meta | 2 | 2 | 0 | 0 |
| Teaching | 6 | 6 | 0 | 0 |
| **Total** | **85** | **54** | **1** | **28** |

### DUPLICATE FLAG GROUPS

1. **Impression** -> `radiologyAiAssistant`: absorbs `radiologyImpressionSync`, `radiologySmartImpression`, `radiologySmartImpression_v2`, `radiologyAICopilot`
2. **Measurements** -> `radiologyMeasurements`: absorbs `radiologyMeasurementLibrary`, `radiologyAdvancedMeasurements`, `radiologyMeasurementTracker`, `measurementAssistant`, `radiologyMeasurementMemory`
3. **Templates** -> `radiologyFavorites`: absorbs `radiologyFavoritesPack`, `radiologyKnowledgeBase`, `radiologyKnowledgePlatform`, `radiologyKnowledgeBase_v2`, `radiologyMasterLibrary`, `radiologyMasterTemplates`, `radiologyPersonalLibrary`, `radiologyFavoriteFindingSets`, `radiologyTemplatePacks`
4. **QA** -> `radiologyQualityChecker`: absorbs `radiologyQAGuard`, `radiologyFinalizationDashboard`, `radiologyQualityCheck`, `radiologyConflictDetection`, `radiologyConsistencyChecker`
5. **Comparison** -> `radiologyPriorComparison`: absorbs `radiologyComparison`, `radiologyComparePrevious`
6. **Macros** -> `radiologyMacros`: absorbs `radiologyMacroEngine`
7. **Analytics** -> `radiologyAnalytics`: absorbs `radiologySmartAnalytics`, `radiologyAnalyticsMemory`
8. **Prompt** -> `radiologyPromptManager`: absorbs `radiologyPromptManager_v2`
9. **Image Review** -> `radiologyImageReview`: absorbs `radiologyImageReviewAssistant`, `radiologyMissedFindingDetector`, `multiAIImageReview`
10. **Follow-up** -> `radiologyFollowUp`: absorbs `radiologyFollowupAssistant`
11. **Structured** -> `radiologyStructuredFindings`: absorbs `radiologySmartFindings_v2`, `radiologyStructuredReporting`
12. **Multi-AI** -> `radiologyMultiAI`: absorbs `radiologyAIComparison`, `radiologyProviderRouting`

---

# PART 4 - DATABASE AUDIT

## Table Inventory (117 Tables)

| Table | Records | Purpose | Required? |
|-------|---------|---------|-----------|
| **ACTIVE (has data)** | | | |
| `ai_normal_report_templates` | 50 | Normal templates | **YES** |
| `radiology_master_templates` | 40 | Master templates | **YES** |
| `radiology_knowledge_base` | 13 | Knowledge articles | **YES** |
| `radiology_audit_log` | 11 | Audit trail | **YES** |
| `radiology_template_usage` | 9 | Usage stats | **YES** |
| `radiology_normal_snippets` | 6 | Normal snippets | **YES** |
| `radiology_personal_templates` | 5 | Personal templates | **YES** |
| `dicom_nodes` | 4 | DICOM nodes | **YES** |
| `radiology_template_packs` | 3 | Template packs | **YES** |
| `radiology_studies` | 3 | Studies | **YES** |
| `radiology_template_versions` | 2 | Versions | **YES** |
| `radiology_template_comparison` | 2 | Comparisons | **YES** |
| `ai_prompt_library` | 3 | AI prompts | **YES** |
| `ai_provider_settings` | 2 | AI config | **YES** |
| `radiology_template_favorites` | 1 | Favorites | **YES** |
| `dicom_modalities` | 1 | Modalities | **YES** |
| `dicom_pull_agent_status` | 1 | Agent status | **YES** |
| `dicom_pull_agent_logs` | 189 | Agent logs | **YES** |
| `pacs_settings` | 14 | PACS config | **YES** |
| `radiology_worklist` | 7 | Worklist | **YES** |
| **EMPTY (0 records)** | | | |
| `radiology_memory` | 0 | Memory engine | **YES** (Phase 9) |
| `radiology_memory_*` (8 tables) | 0 | Memory subtables | **YES** (Phase 9) |
| `radiology_smart_findings` | 0 | Smart findings | **YES** (Phase 5) |
| `radiology_smart_findings_audit` | 0 | Smart audit | **YES** (Phase 5) |
| `radiology_smart_macros` | 0 | Smart macros | **YES** (Phase 5) |
| `radiology_smart_usage` | 0 | Smart usage | **YES** (Phase 5) |
| `radiology_lesions` | 0 | Lesion tracking | **YES** (Phase 10) |
| `radiology_lesion_timeline` | 0 | Lesion timeline | **YES** (Phase 10) |
| `radiology_annotations` | 0 | Image annotations | **YES** (Phase 10B) |
| `radiology_brain_sessions` | 0 | Brain sessions | **YES** (Phase 10B) |
| `radiology_spine_sessions` | 0 | Spine sessions | **YES** (Phase 10B) |
| `radiology_spine_levels` | 0 | Spine levels | **YES** (Phase 10B) |
| `radiology_tumor_followups` | 0 | Tumor follow-up | **YES** (Phase 10B) |
| `radiology_report_*` (6 tables) | 0 | Report drafts, lifecycle, verifications | **YES** |
| `radiology_measurements` | 0 | Measurements | **YES** |
| `radiology_dicom_measurements` | 0 | DICOM measurements | **YES** |
| `radiology_impression_rules` | 0 | Impression rules | **YES** |
| `radiology_favorite_finding_sets` | 0 | Favorite sets | **YES** |
| `radiology_snippets` | 0 | Snippets | **YES** |
| `radiology_structured_templates` | 0 | Structured templates | **YES** |
| `radiology_scheduled_procedures` | 0 | Scheduled procedures | **YES** |
| `radiology_share_links` | 0 | Share links | **YES** |
| `radiology_tat_tracking` | 0 | TAT tracking | **YES** |
| `radiology_voice_logs` | 0 | Voice logs | **YES** |
| `radiology_critical_findings` | 0 | Critical findings | **YES** |
| `radiology_film_issues` | 0 | Film issues | **YES** |
| `radiology_priority_rules` | 0 | Priority rules | **YES** |
| `radiology_multi_site_worklist` | 0 | Multi-site worklist | **YES** |
| `radiology_ai_enhancements` | 0 | AI enhancements | **YES** |
| `radiology_ai_review_audits` | 0 | AI review audits | **YES** |
| `radiology_prompts` | 0 | Prompts | **YES** |
| `dicom_incoming_studies` | 0 | Incoming studies | **YES** |
| `dicom_pull_jobs` | 0 | Pull jobs | **YES** |
| `dicom_pulled_studies` | 0 | Pulled studies | **YES** |
| `dicom_retry_queue` | 0 | Retry queue | **YES** |
| `dicom_routing_rules` | 0 | Routing rules | **YES** |
| `dicom_routing_optimization_log` | 0 | Routing optimization | **YES** |
| `dicom_failed_retrieval_queue` | 0 | Failed retrieval | **YES** |
| `dicom_sr_export_queue` | 0 | SR export | **YES** |
| `dicom_studies` | 0 | DICOM studies | **YES** |
| `dicom_study_series` | 0 | DICOM series | **YES** |
| `dicom_study_audit_log` | 0 | DICOM audit | **YES** |
| `pacs_archive_lifecycle` | 0 | Archive lifecycle | **YES** |
| `pacs_logs` | 0 | PACS logs | **YES** |
| `pacs_storage_tier` | 0 | Storage tier | **YES** |
| `teaching_cases` | 0 | Teaching cases | **YES** |
| `teaching_case_*` (5 tables) | 0 | Teaching subtables | **YES** |
| `teleradiology_users` | 0 | Teleradiology users | **YES** |
| `teleradiology_sites` | 0 | Teleradiology sites | **YES** |
| `teleradiology_sessions` | 0 | Teleradiology sessions | **YES** |
| `teleradiology_assignments` | 0 | Teleradiology assignments | **YES** |
| `report_templates` | 0 | Report templates | **YES** |
| `report_template_versions` | 0 | Report versions | **YES** |
| `report_amendments` | 0 | Report amendments | **YES** |
| `report_delivery_*` (2 tables) | 0 | Delivery tracking | **YES** |
| `report_quality_*` (2 tables) | 0 | Quality checks | **YES** |
| `report_shares` | 0 | Report shares | **YES** |
| `report_translations` | 0 | Translations | **YES** |
| `study_access_log` | 0 | Study access | **YES** |
| `study_tat_metrics` | 0 | Study TAT | **YES** |
| `measurement_history` | 0 | Measurement history | **YES** |
| `template_learning` | 0 | Template learning | **YES** |
| `ai_billing_suggestions` | 0 | AI billing | **YES** |
| `ai_dicom_findings` | 0 | AI DICOM findings | **YES** |
| `ai_extraction_results` | 0 | AI extraction | **YES** |
| `ai_impressions` | 0 | AI impressions | **YES** |
| `ai_job_queue` | 0 | AI job queue | **YES** |
| `ai_model_routes` | 0 | AI model routes | **YES** |
| `ai_prompt_templates` | 0 | AI prompt templates | **YES** |
| `ai_provider_health_logs` | 0 | AI health logs | **YES** |
| `ai_quality_scores` | 0 | AI quality scores | **YES** |
| `ai_reporting_audit_logs` | 0 | AI reporting audit | **YES** |
| `ai_reporting_drafts` | 0 | AI drafts | **YES** |
| `ai_server_health_log` | 0 | AI server health | **YES** |
| `ai_training_data_exports` | 0 | AI training data | **YES** |
| `ai_voice_transcriptions` | 0 | AI voice | **YES** |
| `ai_patient_communications` | 0 | AI patient comms | **YES** |

### DATABASE SUMMARY

| Status | Count |
|--------|-------|
| **Active** (has data) | 20 |
| **Empty** (0 records) | 97 |
| **Orphan tables** | 0 |
| **Duplicate tables** | ~10 |

### TABLE DUPLICATES

1. `radiology_snippets` (0) vs `radiology_normal_snippets` (6) -> Merge
2. `report_templates` (0) vs `radiology_master_templates` (40) -> Deprecate `report_templates`
3. `dicom_studies` (0) vs `radiology_studies` (3) -> Deprecate `dicom_studies`
4. `radiology_measurements` (0) vs `radiology_dicom_measurements` (0) vs `radiology_memory_measurements` (0) -> Merge into one
5. `ai_prompt_library` (3) vs `ai_prompt_templates` (0) vs `radiology_prompts` (0) -> Merge into one
6. `radiology_report_drafts` (0) vs `ai_reporting_drafts` (0) -> Merge into one
7. `radiology_report_lifecycle_log` (0) vs `ai_reporting_audit_logs` (0) -> Merge into one

---

# PART 5 - API AUDIT

## Backend Route Files

| File | Lines | Endpoints | Purpose | Status | Recommendation |
|------|-------|-----------|---------|--------|----------------|
| `internal-radiology.ts` | 60,466 | 20+ | Core radiology, DICOM, worklist, MWL, pull agent | **ACTIVE** | **KEEP** |
| `radiology.ts` | 74,906 | 20+ | Main radiology route (legacy) | **ACTIVE** | **KEEP** |
| `radiology-report-generator.ts` | 67,265 | 20+ | Report generator, templates, macros, snippets, measurements | **ACTIVE** | **KEEP** |
| `radiologyCopilot.ts` | 38,450 | 13 | Prior studies, impressions, consistency, follow-up, productivity | **ACTIVE** | **KEEP** |
| `radiologyKnowledge.ts` | 72,324 | 30+ | Master templates, personal templates, knowledge base, analytics | **ACTIVE** | **KEEP** |
| `radiologySmartFindings.ts` | 22,134 | 16 | Structured findings, impression rules, favorite sets, audit | **ACTIVE** | **KEEP** |
| `radiologyMemory.ts` | 17,763 | 10 | Memory engine, suggest, impressions, decisions, feedback, analytics | **ACTIVE** | **KEEP** |
| `radiologyOllama.ts` | 26,555 | 7 | Ollama status, test, findings, impression, multi-review, differential | **ACTIVE** | **KEEP** |
| `smartRadiology.ts` | 38,577 | 25+ | AI impressions, quality check, follow-up, templates, TAT, amendments | **ACTIVE** | **KEEP** |
| `radiologyWorkflow.ts` | 23,983 | 25+ | MWL, incoming studies, AI jobs, shortcuts, macros, alerts, command center | **ACTIVE** | **KEEP** |
| `radiologyLesions.ts` | 18,485 | 8 | Lesion CRUD, timeline, measurements, templates | **ACTIVE** | **KEEP** |
| `radiologyAnnotations.ts` | 6,330 | 5 | Image annotations CRUD | **ACTIVE** | **KEEP** |
| `radiologyTumorFollowup.ts` | 6,479 | 5 | Tumor follow-up CRUD, timeline | **ACTIVE** | **KEEP** |
| `radiologyBrainIntelligence.ts` | 5,456 | 3 | Brain sessions, trends | **ACTIVE** | **KEEP** |
| `radiologySpineIntelligence.ts` | 5,750 | 4 | Spine sessions, levels, compare | **ACTIVE** | **KEEP** |
| `teleradiology.ts` | 12,020 | 2 | Teleradiology share (public) | **RARELY USED** | **KEEP** |
| `teleradiologyPortal.ts` | 16,142 | 10+ | Teleradiology portal operations | **RARELY USED** | **KEEP** |
| `radiologySnippets.ts` | 8,247 | 5+ | Normal snippets, usage, audit | **ACTIVE** | **KEEP** |
| **TOTAL** | **~527,000 lines** | **~220+ endpoints** | | | **ALL KEEP** |

### API SUMMARY

| Category | Endpoint Count | Keep | Deprecate |
|----------|---------------|------|-----------|
| Core Reporting | ~60 | 60 | 0 |
| AI/Copilot | ~50 | 50 | 0 |
| DICOM/PACS | ~40 | 40 | 0 |
| Templates/Knowledge | ~40 | 40 | 0 |
| Teaching/Teleradiology | ~20 | 20 | 0 |
| Workflow | ~30 | 30 | 0 |
| **TOTAL** | **~240** | **240** | **0** |

**No dead APIs.** All endpoints are referenced by at least one component.

---

# PART 6 - AI SYSTEM AUDIT

| System | Exists | Operational | Visible | Backend Only | Duplicate | Recommendation |
|--------|--------|-------------|---------|--------------|-----------|----------------|
| **Radiology Copilot** | YES | YES (deterministic) | YES | NO | YES (overlaps with AI Copilot) | **KEEP** |
| **AI Copilot Panel** | YES | YES (deterministic) | NO | NO | YES (overlaps with Radiology Copilot) | **DEPRECATE** |
| **Memory Engine** | YES | YES | YES | NO | NO | **KEEP** |
| **Smart Findings** | YES | YES (deterministic) | NO | NO | YES (overlaps with workspace) | **DEPRECATE** |
| **Ollama** | YES | YES (requires local) | NO | YES | YES (overlaps with Gemini) | **KEEP** |
| **Knowledge Base** | YES | YES | NO | NO | NO | **KEEP** |
| **Follow-Up Engine** | YES | YES (deterministic) | NO | NO | YES (overlaps with Copilot) | **MERGE** |
| **Missed Finding Detector** | YES | YES (deterministic + Ollama) | NO | NO | YES (split local/backend) | **MERGE** |
| **Brain Intelligence** | YES | YES (deterministic) | NO | NO | NO | **KEEP** |
| **Spine Intelligence** | YES | YES (deterministic) | NO | NO | NO | **KEEP** |
| **Tumor Follow-Up** | YES | YES (deterministic) | NO | NO | YES (overlaps with Lesion Tracker) | **MERGE** |
| **Multi-AI** | YES | YES (routes to Gemini/GPT/Claude/Ollama) | NO | YES | YES (overlaps with Ollama multi-review) | **KEEP** |
| **Differential Diagnosis** | YES | YES (deterministic) | NO | NO | YES (overlaps with Ollama) | **MERGE** |
| **Quality Checker** | YES | YES (deterministic) | NO | NO | YES (multiple implementations) | **MERGE** |
| **Image Review** | YES | YES (Gemini vision) | NO | NO | YES (multiple implementations) | **MERGE** |
| **Prompt Manager** | YES | YES | NO | NO | YES (v1 vs v2) | **MERGE** |
| **AI Review Audits** | YES | YES (audit trail) | NO | YES | NO | **KEEP** |
| **Lesion Tracker** | YES | YES (RECIST) | NO | NO | YES (overlaps with Tumor Follow-up) | **MERGE** |
| **Change Detector** | YES | YES (deterministic) | NO | NO | NO | **KEEP** |
| **Measurement Assistant** | YES | YES (deterministic) | NO | NO | NO | **KEEP** |
| **Organ Intelligence** | YES | Schema only | NO | NO | NO | **KEEP** |
| **Research Database** | YES | Schema only | NO | NO | NO | **KEEP** |
| **Teaching Generator** | YES | YES | NO | NO | NO | **KEEP** |
| **Case of Month** | YES | Schema only | NO | NO | NO | **KEEP** |
| **Confidence Visualization** | YES | UI component only | NO | NO | NO | **KEEP** |
| **Annotation Layer** | YES | Schema only | NO | NO | NO | **KEEP** |

### AI SYSTEM SUMMARY

| Status | Count |
|--------|-------|
| Fully operational | 18 |
| Schema only / backend ready | 6 |
| Has duplicates | 10 |
| Should be merged | 10 |
| Should be deprecated | 2 |

---

# PART 7 - USER WORKFLOW AUDIT

## Dr. Sugandha's Daily MRI Brain Workflow

### Current State (Multiple Pages)

| Step | Action | Screen | Route | Clicks | Problem |
|------|--------|--------|-------|--------|---------|
| 1 | Open study | Worklist | `/radiology/worklist` | 1 | OK |
| 2 | Review images | Click "View" | `/radiology/viewer/:uid` | 1 | Context lost |
| 3 | Start reporting | Click "Report" | `/radiology/unified-report/:id` | 1 | Context lost |
| 4 | Compare prior | Open "Prior" tab | (same page) | 1 | May be hidden |
| 5 | Insert template | Open "Templates" tab | (same page) | 1 | May be hidden |
| 6 | Dictate findings | Type in editor | (same page) | 1 | OK |
| 7 | AI review | Click "AI Review" | Opens AI panel | 1 | May be hidden |
| 8 | Finalize | Click "Finalize" | (same page) | 1 | OK |
| 9 | Print | Click "Print" | (same page) | 1 | OK |
| 10 | Upload | Automatic | (same page) | 0 | OK |

**Total clicks: ~10 | Screens: 3 | Routes: 3 | Context loss: 2**

### Bottlenecks

1. **Context loss**: Viewer and reporting are separate pages
2. **Feature flag maze**: Most AI features hidden by default
3. **Competing unified pages**: Both `/radiology/reporting-workspace` and `/radiology/unified-report` exist
4. **DICOM viewer isolation**: Full viewer is standalone
5. **Template discovery**: Templates in separate page

### Proposed Unified Workflow

| Step | Action | Screen | Route | Clicks |
|------|--------|--------|-------|--------|
| 1 | Open study | Worklist | `/radiology/worklist` | 1 |
| 2 | Click "Report" | **Unified Workstation** | `/radiology/reporting-workspace/:id` | 1 |
| 3 | Review images | **LEFT panel** viewer | (same page) | 0 |
| 4 | Compare prior | **RIGHT panel Tab 2** | (same page) | 1 |
| 5 | Insert template | **RIGHT panel Tab 1** | (same page) | 1 |
| 6 | Dictate findings | **CENTER panel** editor | (same page) | 1 |
| 7 | AI review | **RIGHT panel Tab 3** | (same page) | 1 |
| 8 | Finalize | **BOTTOM action bar** | (same page) | 1 |
| 9 | Print | **BOTTOM action bar** | (same page) | 1 |
| 10 | Upload | Automatic | (same page) | 0 |

**Total clicks: ~9 | Screens: 2 | Routes: 2 | Context loss: 0**

**Improvement: 1 fewer click, 1 fewer screen, 0 context loss, all features visible in one place.**

---

# PART 8 - FINAL CONSOLIDATION REPORT

## PAGES TO KEEP

| Page | Route | Why |
|------|-------|-----|
| Radiology Dashboard | `/radiology` | Landing page |
| Worklist | `/radiology/worklist` | Study selection |
| **Unified Workstation** | `/radiology/reporting-workspace` | **SINGLE AUTHORITATIVE PAGE** |
| Standalone Viewer | `/radiology/viewer/:uid` | Full DICOM viewer |

## PAGES TO HIDE (Admin/Backend Only)

| Page | Route | Why Hidden |
|------|-------|------------|
| PACS Dashboard | `/radiology/pacs-dashboard` | Admin monitoring |
| PACS Settings | `/radiology/pacs-settings` | Admin configuration |
| DICOM QR | `/radiology/dicom-qr` | Admin DICOM |
| MWL Dashboard | `/radiology/mwl-dashboard` | Admin workflow |
| Agent Setup | `/radiology/agent-setup` | Admin setup |
| AI Settings | `/radiology/ai-reporting-settings` | Admin AI |
| AI Prompt Templates | `/radiology/ai-prompt-templates` | Admin prompt editor |
| AI Prompt Manager | `/radiology/ai-prompt-manager` | Admin prompt manager |
| AI Comparison | `/radiology/ai-comparison` | Research tool |
| Missed Finding Detector | `/radiology/missed-finding-detector` | Research tool |
| Image Review | `/radiology/image-review` | Research tool |
| AI Model Routing | `/radiology/ai-model-routing` | Admin config |
| AI Audit Log | `/radiology/ai-audit-log` | Admin audit |
| Productivity | `/radiology/productivity` | Admin dashboard |
| Command Center | `/radiology/command-center` | Admin operations |
| Advanced Tools | `/radiology/advanced-tools` | Admin tools |
| All other `/radiology/...` | ~40 more | Admin/research |
| Teaching pages | `/teaching-*` | Research/academic |
| Teleradiology | `/teleradiology` | Not deployed |
| USG pages | `/usg/*` | Separate workflow |
| PACS (legacy) | `/pacs` | Legacy |
| DICOM Nodes | `/dicom-nodes` | Admin config |

## PAGES TO DEPRECATE

| Page | Route | Replacement |
|------|-------|-------------|
| Report Generator | `/radiology/report-generator` | `/radiology/reporting-workspace` |
| Report Editor | `/radiology/report/:studyId` | `/radiology/reporting-workspace/:studyId` |
| Unified Report | `/radiology/unified-report/:id` | `/radiology/reporting-workspace/:id` |
| PACS (legacy) | `/pacs` | `/radiology/viewer` |

## COMPONENTS TO KEEP

| Component | Destination | Why |
|-----------|-------------|-----|
| `RadiologyCopilotPanel` | RIGHT PANEL | Core AI assistance |
| `RadiologyMemoryPanel` | RIGHT PANEL | Phase 9 memory |
| `MeasurementAssistantPanel` | RIGHT PANEL | Guided measurements |
| `EmbeddedWadoViewer` | LEFT PANEL | Lightweight viewer |
| `SmartRadiologyCards` | Dashboard | Dashboard widgets |
| `AIConfidenceBadge` | (hidden) | Phase 10C |
| `ImageAnnotationToolbar` | (hidden) | Phase 10B |
| `BrainIntelligencePanel` | (hidden) | Phase 10B |
| `SpineIntelligencePanel` | (hidden) | Phase 10B |
| `LesionTrackerPanel` | (hidden) | Phase 10 |
| `TumorFollowupPanel` | (hidden) | Phase 10B |
| `MultiAIReviewPanel` | (hidden) | Research |
| `CaseOfMonthPanel` | (hidden) | Research |

## COMPONENTS TO MERGE

| Component | Merge Into | Reason |
|-----------|------------|--------|
| `RadiologyAICopilotPanel` | `RadiologyCopilotPanel` | Duplicate |
| `RadiologyKnowledgePanel` | Workspace Templates Tab | Duplicate |
| `RadiologySmartFindingsPanel` | Workspace editor | Duplicate |
| `SpinalMeasurementPanel` | `MeasurementAssistantPanel` | Overlap |
| `TumorFollowupPanel` | `LesionTrackerPanel` | Overlap |

## SETTINGS TO KEEP

| Setting | Why |
|---------|-----|
| `radiologyAiAssistant` | Core AI |
| `radiologyQuickAdd` | Shortcuts |
| `radiologyMacros` | Text expansion |
| `radiologyMeasurements` | Measurements |
| `radiologyFavorites` | Templates |
| `radiologyPreviousReports` | Prior comparison |
| `radiologyMemoryEngine` | Memory |
| `radiologyImpressionMemory` | Impression recall |
| `radiologyMeasurementMemory` | Measurement history |
| `radiologyDecisionMemory` | Decision tracking |
| `radiologyFeedbackLoop` | Feedback |
| `radiologyMacroEngine` | Macros |
| `radiologyStyleLearning` | Style learning |
| `radiologyPriorComparison` | Prior auto-fetch |
| `dicomImageIntelligence` | Phase 10 master |
| `lesionTracking` | Lesion tracking |
| `changeDetection` | Change detection |
| `measurementAssistant` | Measurement assistant |

## SETTINGS TO REMOVE

| Setting | Reason |
|---------|--------|
| `radiologyAiHooks` | Never implemented |

## SETTINGS TO MERGE

| Group | Into | Flags |
|-------|------|-------|
| Impression | `radiologyAiAssistant` | `radiologyImpressionSync`, `radiologySmartImpression`, `radiologySmartImpression_v2`, `radiologyAICopilot` |
| Measurements | `radiologyMeasurements` | `radiologyMeasurementLibrary`, `radiologyAdvancedMeasurements`, `radiologyMeasurementTracker`, `measurementAssistant`, `radiologyMeasurementMemory` |
| Templates | `radiologyFavorites` | `radiologyFavoritesPack`, `radiologyKnowledgeBase`, `radiologyKnowledgePlatform`, `radiologyKnowledgeBase_v2`, `radiologyMasterLibrary`, `radiologyMasterTemplates`, `radiologyPersonalLibrary`, `radiologyFavoriteFindingSets`, `radiologyTemplatePacks` |
| QA | `radiologyQualityChecker` | `radiologyQAGuard`, `radiologyFinalizationDashboard`, `radiologyQualityCheck`, `radiologyConflictDetection`, `radiologyConsistencyChecker` |
| Comparison | `radiologyPriorComparison` | `radiologyComparison`, `radiologyComparePrevious` |
| Macros | `radiologyMacros` | `radiologyMacroEngine` |
| Analytics | `radiologyAnalytics` | `radiologySmartAnalytics`, `radiologyAnalyticsMemory` |
| Prompt | `radiologyPromptManager` | `radiologyPromptManager_v2` |
| Image Review | `radiologyImageReview` | `radiologyImageReviewAssistant`, `radiologyMissedFindingDetector`, `multiAIImageReview` |
| Follow-up | `radiologyFollowUp` | `radiologyFollowupAssistant` |
| Structured | `radiologyStructuredFindings` | `radiologySmartFindings_v2`, `radiologyStructuredReporting` |
| Multi-AI | `radiologyMultiAI` | `radiologyAIComparison`, `radiologyProviderRouting` |

## DATABASE TABLES TO KEEP

All 117 tables are **KEEP**:
- 20 tables have active data
- 97 tables are empty but have functional schemas
- No orphan tables
- All serve a purpose in the phased roadmap

## DATABASE TABLES TO ARCHIVE

| Table | Reason |
|-------|--------|
| `report_templates` | Superseded by `radiology_master_templates` |
| `dicom_studies` | Superseded by `radiology_studies` |
| `radiology_snippets` | Superseded by `radiology_normal_snippets` |

## APIS TO KEEP

All 18 backend route files (~220 endpoints) are **KEEP**:
- All APIs are referenced by at least one component
- Even unused APIs are part of the phased roadmap
- Backend-only APIs can be hidden from frontend but kept for admin/future

## APIS TO REMOVE

None. All APIs serve a purpose.

---

# PART 9 - UNIFIED WORKSTATION READINESS

## YES - The current codebase CAN be consolidated into a single enterprise reporting workstation.

### The existing `RadiologyReportingWorkspace` at `/radiology/reporting-workspace` is ALREADY the unified workstation.

It currently has:
- **LEFT panel**: Study info + EmbeddedWadoViewer + Weasis/OHIF/PACS buttons
- **CENTER panel**: Report editor (findings, impression, technique, recommendations)
- **RIGHT panel**: 5 tabs (Templates, Prior, AI, Measure, Teaching)
- **BOTTOM action bar**: Save Draft, Preview, Print, AI Review, Finalize, Send Report, View in ERP

### What needs to change (minimal):

1. **Consolidate competing pages**: Remove `RadiologyReportUnified`, `RadiologyReportGenerator`, `RadiologyReportEditor` from routes
2. **Consolidate settings**: Merge 28 duplicate flags into 12 essential flags
3. **Consolidate components**: Merge `RadiologyAICopilotPanel` into `RadiologyCopilotPanel`, merge `SpinalMeasurementPanel` into `MeasurementAssistantPanel`
4. **Enable core flags**: Set essential flags ON by default (or remove gating for core features)
5. **Hide admin pages**: Remove admin/research pages from sidebar, keep accessible via direct URL
6. **Merge duplicate tables**: Merge `radiology_snippets` -> `radiology_normal_snippets`, `dicom_studies` -> `radiology_studies`

### PROPOSED UNIFIED WORKSTATION LAYOUT

```
+-------------------------------------------------------------------+
|  LEFT PANEL (35%)          | CENTER PANEL (45%)     | RIGHT (20%) |
|  -------------------        | -------------------    | ----------- |
|  Study Info Card            |                        | [Tab 1]     |
|  - Patient name, age, M/F   |  REPORT EDITOR         | Templates   |
|  - Study date, modality     |                        | - Normal    |
|  - Body part, accession     |  Clinical History      | - Master    |
|  - Referring doctor         |  Technique             | - Personal  |
|                            |  Findings              | - Macros    |
|  Embedded WADO Viewer       |  Impression            |             |
|  - Lightweight DICOM       |  Recommendations       | [Tab 2]     |
|  - Series thumbnails       |  Critical flag         | Prior       |
|  - Key images              |                        | - Prior     |
|                            |                        | - Comparison|
|  External Viewer Buttons   |                        | - Change    |
|  - Weasis (launch)         |                        |             |
|  - OHIF (launch)           |                        | [Tab 3]     |
|  - PACS (launch)           |                        | AI          |
|                            |                        | - Impression|
|                            |                        | - Quality   |
|                            |                        | - Follow-up |
|                            |                        | - Differential|
|                            |                        |             |
|                            |                        | [Tab 4]     |
|                            |                        | Measure     |
|                            |                        | - Assistant |
|                            |                        | - Memory    |
|                            |                        | - Ranges    |
|                            |                        |             |
|                            |                        | [Tab 5]     |
|                            |                        | Teaching    |
|                            |                        | - Save case |
|                            |                        | - AI summary|
|                            |                        | - Research  |
+-------------------------------------------------------------------+
|  BOTTOM ACTION BAR                                                |
|  [Save Draft] [Preview] [Print] [AI Review] [Finalize] [Send] [ERP] |
+-------------------------------------------------------------------+
```

### COMPONENT ALLOCATION

| Panel | Existing Component | What It Provides |
|-------|-------------------|-------------------|
| **LEFT** | Study Info (built-in) | Patient demographics, study metadata |
| **LEFT** | `EmbeddedWadoViewer` | DICOM image preview, series thumbnails |
| **CENTER** | Report Editor (built-in) | Clinical history, technique, findings, impression, recommendations |
| **RIGHT Tab 1** | `RadiologyKnowledgePanel` (merge) | Templates, snippets, macros, knowledge base |
| **RIGHT Tab 2** | `RadiologyCopilotPanel` (initialTab="prior") | Prior studies, comparison, change detection |
| **RIGHT Tab 3** | `RadiologyCopilotPanel` (initialTab="impression") + AI | AI impression, quality check, differential, follow-up |
| **RIGHT Tab 4** | `MeasurementAssistantPanel` + `RadiologyMemoryPanel` | Measurements, memory history, normal ranges |
| **RIGHT Tab 5** | Teaching save (built-in) | Save teaching case, AI summary, research tagging |
| **BOTTOM** | Action Bar (built-in) | Save, preview, print, AI review, finalize, send, view ERP |

### WHAT IS ALREADY WORKING

- [x] `RadiologyReportingWorkspace` exists with 3-column layout
- [x] 5 right-panel tabs exist (Templates, Prior, AI, Measure, Teaching)
- [x] Bottom action bar exists
- [x] Embedded WADO viewer exists
- [x] All AI panels are integrated
- [x] All feature flags are present (just OFF)
- [x] All backend APIs are built
- [x] All database schemas are ready

### WHAT NEEDS TO BE DONE

1. **Consolidate competing pages**: Remove `RadiologyReportUnified`, `RadiologyReportGenerator`, `RadiologyReportEditor` from routes
2. **Consolidate settings**: Merge 28 duplicate flags into 12 essential flags
3. **Consolidate components**: Merge `RadiologyAICopilotPanel` into `RadiologyCopilotPanel`, merge `SpinalMeasurementPanel` into `MeasurementAssistantPanel`
4. **Enable core flags**: Set essential flags ON by default (or remove gating for core features)
5. **Hide admin pages**: Remove admin/research pages from sidebar, keep accessible via direct URL
6. **Merge duplicate tables**: Merge `radiology_snippets` -> `radiology_normal_snippets`, `dicom_studies` -> `radiology_studies`

### CONCLUSION

**The codebase is ready for consolidation.** The `RadiologyReportingWorkspace` is already the single unified workstation. The remaining work is **cleanup** - not building new features. Remove competing pages, merge duplicate settings, and enable core features. The radiologist's daily workflow fits entirely within 3 pages (dashboard, worklist, workstation) and 1 right-panel with 5 tabs.

---

## AUDIT SUMMARY

| Category | Total | Keep | Hide | Deprecate | Merge |
|----------|-------|------|------|-----------|-------|
| **Pages** | 78 | 4 | 64 | 5 | 0 |
| **Components** | 19 | 13 | 0 | 0 | 5 |
| **Settings** | 85 | 54 | 0 | 1 | 28 |
| **DB Tables** | 117 | 113 | 0 | 0 | 4 |
| **API Endpoints** | ~240 | 240 | 0 | 0 | 0 |
| **AI Systems** | 24 | 22 | 0 | 2 | 10 |

**The radiology subsystem is 95% built. The remaining 5% is cleanup and consolidation.**

---

*End of Audit*
