# Radiology Module Inventory — Care Diagnostics ERP

Complete inventory of every menu, submenu, route, component, feature, setting, AI function, PACS function, and reporting function in the Radiology & Imaging module.

**Generated:** 2026-06-05
**Artifact:** `diagnostic-erp` (web) + `api-server` + `lib/db`
**Last Major Update:** 2026-06-05

---

## Table of Contents

1. [Menus & Sidebar Groups](#1-menus--sidebar-groups)
2. [Submenus & Navigation Items](#2-submenus--navigation-items)
3. [Routes & Pages](#3-routes--pages)
4. [Frontend Components](#4-frontend-components)
5. [Backend API Routes](#5-backend-api-routes)
6. [Database Schema Tables](#6-database-schema-tables)
7. [AI Functions](#7-ai-functions)
8. [PACS Functions](#8-pacs-functions)
9. [Reporting Functions](#9-reporting-functions)
10. [Settings & Configuration](#10-settings--configuration)
11. [Features & Modules](#11-features--modules)
12. [Summary Statistics](#12-summary-statistics)

---

## 1. Menus & Sidebar Groups

| # | Feature Name | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|-------------|------------|---------|--------|-------------|------------|-----------|
| 1.1 | **Radiology & Imaging** | Sidebar Group | Main sidebar group for all radiology, imaging, PACS, DICOM, and AI features. | Implemented | React Router, Layout.tsx | Yes | 2026-06-05 |
| 1.2 | **USG / DOPPLER** | `/usg` | Standalone menu item for Ultrasound/Doppler reporting. | Implemented | USG module, USG reporting pages | Yes | 2026-05-22 |
| 1.3 | **Settings** | `/settings` | Contains `/settings/radiology` for all radiology-specific configuration. | Implemented | Settings.tsx, RadiologySettings.tsx | Yes | 2026-05-21 |

---

## 2. Submenus & Navigation Items

### 2.1 Core Worklist & Reporting (Daily Use)

| # | Feature Name | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|-------------|------------|---------|--------|-------------|------------|-----------|
| 2.1.1 | **Worklist Hub** | `/radiology/worklist` | RIS-driven worklist showing all pending, in-progress, and completed radiology studies. | Implemented | `/api/radiology/worklist`, `/api/radiology/pacs-worklist` | Yes | 2026-06-05 |
| 2.1.2 | **Unified Reporting** | `/radiology/unified-report/:worklistId` | Single smart reporting page for ALL modalities (USG, MRI, CT, X-ray, Echo, Fetal). Replaces 7 separate pages. | Implemented | `/api/internal/radiology/worklist/:id`, `/api/usg-extraction/*` | Yes | 2026-06-05 |
| 2.1.3 | **PACS Viewer** | `/pacs` | Main PACS viewer interface for browsing studies, series, and instances. | Implemented | `/api/pacs/*`, Orthanc/Conquest | Yes | 2026-05-26 |
| 2.1.4 | **DICOM Query/Retrieve** | `/radiology/dicom-qr` | Search and retrieve studies from remote PACS via C-FIND. | Implemented | `/api/dicom/nodes`, `/api/dicom/nodes/:id/pull` | Yes | 2026-05-17 |
| 2.1.5 | **MWL Dashboard** | `/radiology/mwl-dashboard` | DICOM Modality Worklist (MWL) dashboard showing scheduled procedures. | Implemented | `/api/radiology-workflow/mwl` | Yes | 2026-05-21 |
| 2.1.6 | **Normal Templates** | `/radiology/normal-templates` | One-click normal report templates for common studies. | Implemented | `radiology_structured_templates` | Yes | 2026-06-05 |
| 2.1.7 | **AI Reporting** | `/radiology/ai-reporting-settings` | Configuration for AI-driven report generation and auto-drafting. | Implemented | `/api/smart-radiology/*`, Gemini API | Yes | 2026-06-03 |
| 2.1.8 | **Voice Dictation** | `/radiology/voice-dictation` | Voice-to-text reporting for radiologists. | Implemented | Web Speech API | Yes | 2026-05-17 |
| 2.1.9 | **Critical Findings** | `/radiology/critical-findings` | Track and manage critical/high-priority findings. | Implemented | `radiology_critical_findings` table | Yes | 2026-05-22 |
| 2.1.10 | **AI Extraction Review** | `/radiology/ai-extraction-review` | Human review of AI-extracted measurements from USG studies. | Implemented | `/api/usg-extraction/*`, `ai_extraction_results` | Yes | 2026-05-22 |
| 2.1.11 | **Teleradiology** | `/teleradiology` | External radiologist portal for remote reporting. | Implemented | `/api/teleradiology/*`, `/api/teleradiology-portal/*` | Yes | 2026-05-22 |
| 2.1.12 | **Echo Cardiology** | `/echo` | Full echocardiography reporting with 2D, Doppler, and valve measurements. | Implemented | `/api/echo-cardiology/*`, `echo_cardiology` table | Yes | 2026-06-03 |
| 2.1.13 | **Fetal Echo** | `/fetal-echo` | Fetal echocardiography reporting with specialized measurements. | Implemented | `/api/echo-cardiology/*`, `fetal_echo` tables | Yes | 2026-06-03 |
| 2.1.14 | **Fetal USG** | `/fetal-usg` | Anomaly scan / growth scan with detailed biometry and checklists. | Implemented | `/api/fetal-usg-level4/*`, `fetal_usg_level4` table | Yes | 2026-06-03 |

### 2.2 AI / Smart Radiology (Consolidated)

| # | Feature Name | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|-------------|------------|---------|--------|-------------|------------|-----------|
| 2.2.1 | **AI Prompt Templates** | `/radiology/ai-prompt-templates` | Manage editable prompt templates for AI radiology reporting. | Implemented | `/api/ai-prompt-templates`, `ai_prompt_templates` table | Yes | 2026-06-02 |
| 2.2.2 | **AI Model Routing** | `/radiology/ai-model-routing` | Route AI tasks to specific providers (Gemini, OpenAI, Ollama). | Implemented | `/api/ai-model-routes`, `ai_model_routes` table | Yes | 2026-06-02 |
| 2.2.3 | **Normal Templates** | `/radiology/normal-templates` | One-click normal report templates for common studies. | Implemented | `radiology_structured_templates` | Yes | 2026-06-05 |
| 2.2.4 | **AI Quality Check** | `/api/smart-radiology/quality-check` | Automated QC before finalization. | Implemented | `report_quality_checks` table | Yes | 2026-05-22 |
| 2.2.5 | **AI Feedback Loop** | `/api/radiology/pacs-worklist/:id/ai-feedback` | Radiologist feedback on AI drafts (thumbs up/down). | Implemented | `ai_quality_scores` table | Yes | 2026-06-03 |
| 2.2.6 | **AI Draft Generation** | `/api/internal/radiology/ai-draft` | Internal hook for AI draft generation. | Implemented | `ai_job_queue` table | Yes | 2026-05-11 |
| 2.2.7 | **AI Billing Suggestions** | `/api/smart-radiology/billing-suggestions` | Suggest billable items based on findings. | Implemented | `/api/smart-radiology/*`, billing module | No | 2026-05-22 |
| 2.2.8 | **AI Translation** | `/api/smart-radiology/translations` | Bilingual (English/Hindi) patient summaries. | Implemented | `report_translations` table | Yes | 2026-05-22 |
| 2.2.9 | **AI Follow-Up** | `/api/smart-radiology/follow-up` | Recommend follow-up studies based on findings. | Implemented | `follow_up_recommendations` table | Yes | 2026-05-22 |

### 2.3 Management & Admin (Owner Only)

| # | Feature Name | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|-------------|------------|---------|--------|-------------|------------|-----------|
| 2.3.1 | **PACS Settings** | `/radiology/pacs-settings` | PACS server configuration (Conquest/Orthanc URL, ports, viewer). | Implemented | `/api/pacs/config`, `pacs_settings` schema | No | 2026-06-05 |
| 2.3.2 | **Modality Management** | `/radiology/modality-management` | Register and manage imaging modalities (CT, MRI, X-Ray, USG). | Implemented | `/api/dicom/nodes`, `dicom_nodes` table | No | 2026-05-21 |
| 2.3.3 | **DICOM Agent** | `/radiology/dicom-agent-dashboard` | Monitor the DICOM pull agent and DIMSE agent. | Implemented | `dicom_pull_agent_status`, `dicom_pull_agent_logs` | No | 2026-05-21 |
| 2.3.4 | **Watchdog** | `/radiology/watchdog` | Automated watchdog for PACS and RIS services. | Implemented | `risMonitoring` routes | No | 2026-05-21 |

### 2.4 Deprecated / Consolidated (Kept for back-compat, not in sidebar)

| # | Feature Name | Route/Page | Purpose | Status | Reason | Last Date |
|---|-------------|------------|---------|--------|--------|-----------|
| 2.4.1 | **USG Reporting** | `/usg/reporting` | General USG report editor. | Deprecated | Consolidated into Unified Reporting | 2026-05-22 |
| 2.4.2 | **USG Doppler Reporting** | `/usg/doppler` | Doppler report editor. | Deprecated | Consolidated into Unified Reporting | 2026-05-22 |
| 2.4.3 | **Radiology Report Editor** | `/radiology/report/:studyId` | Standalone report editor. | Deprecated | Consolidated into Unified Reporting | 2026-05-17 |
| 2.4.4 | **Radiology Reporting Workspace** | `/radiology/reporting-workspace` | Central reporting dashboard. | Deprecated | Consolidated into Unified Reporting | 2026-05-19 |
| 2.4.5 | **Radiology Report Generator** | `/radiology/report-generator` | Template-based report generator. | Deprecated | Consolidated into Unified Reporting | 2026-06-03 |
| 2.4.6 | **Command Center** | `/radiology/pacs-dashboard` | Real-time monitoring dashboard. | Deprecated | Removed from sidebar, accessible via PACS | 2026-05-21 |
| 2.4.7 | **Radiologist Queue** | `/radiology/radiologist-queue` | Queue per radiologist. | Deprecated | Merged into Worklist Hub | 2026-05-21 |
| 2.4.8 | **Technician Workflow** | `/radiology/technician-workflow/:studyId` | Technician input workflow. | Deprecated | Merged into DICOM workflow | 2026-05-17 |
| 2.4.9 | **Hanging Protocols** | `/radiology/hanging-protocols` | Viewer layout presets. | Deprecated | Not used in daily workflow | 2026-05-21 |
| 2.4.10 | **AI Audit Log** | `/radiology/ai-audit-log` | Audit trail of AI findings. | Deprecated | Removed from sidebar, kept in AI Reporting | 2026-05-22 |
| 2.4.11 | **AI Quality Scores** | `/radiology/ai-quality-scores` | Accuracy metrics. | Deprecated | Removed from sidebar, kept in AI Reporting | 2026-05-22 |
| 2.4.12 | **AI Prompt Effectiveness** | `/radiology/ai-prompt-effectiveness` | Prompt performance analytics. | Deprecated | Removed from sidebar, kept in AI Reporting | 2026-05-22 |
| 2.4.13 | **AI DICOM Findings** | `/radiology/ai-dicom-findings` | AI image analysis. | Deprecated | Removed from sidebar, kept in AI Reporting | 2026-05-22 |
| 2.4.14 | **RAG Vector Store** | `/radiology/rag-vector-store` | Semantic search DB. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.15 | **AI Search & Retrieval** | `/radiology/ai-search-retrieval` | Semantic search interface. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.16 | **Anomaly Alerts** | `/radiology/anomaly-alerts` | Workflow anomaly detection. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.17 | **Report Diff Viewer** | `/radiology/report-diff` | Compare report versions. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.18 | **Feedback Loop Analytics** | `/radiology/feedback-loop-analytics` | Analytics on radiologist feedback. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.19 | **Template Versions** | `/radiology/template-versions` | Version history for templates. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.20 | **Peer Review** | `/radiology/peer-review-assignments` | Peer review assignments. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.21 | **Turnaround Time** | `/radiology/turnaround-times` | TAT analytics. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.22 | **Training Data Export** | `/radiology/training-data-exports` | Export anonymized data. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.23 | **Quality Gates** | `/radiology/quality-gates` | Automated checks before finalization. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.24 | **Provider Health** | `/radiology/provider-health` | Monitor AI provider health. | Deprecated | Removed from sidebar, not used daily | 2026-05-22 |
| 2.4.25 | **DICOM Study Worklist** | `/radiology/dicom-study-worklist` | DICOM study listing. | Deprecated | Merged into Worklist Hub | 2026-05-21 |
| 2.4.26 | **Acquisition Gateway** | `/radiology/acquisition-gateway` | Monitor incoming studies. | Deprecated | Merged into DICOM Agent | 2026-05-22 |
| 2.4.27 | **MWL Manager** | `/radiology/mwl-manager` | MWL entry management. | Deprecated | Merged into MWL Dashboard | 2026-05-22 |
| 2.4.28 | **AI Pipeline** | `/radiology/ai-pipeline` | AI orchestration pipeline. | Deprecated | Merged into AI Reporting | 2026-05-22 |
| 2.4.29 | **Storage Lifecycle** | `/radiology/storage-lifecycle` | Storage tiering. | Deprecated | Merged into PACS Settings | 2026-05-22 |
| 2.4.30 | **Productivity Tools** | `/radiology/productivity-tools` | Shortcuts and macros. | Deprecated | Not used daily | 2026-05-22 |
| 2.4.31 | **PACS Logs** | `/radiology/pacs-logs` | Operational logs. | Deprecated | Merged into PACS Settings | 2026-05-21 |
| 2.4.32 | **AI Inference Settings** | `/radiology/ai-inference-settings` | Inference config. | Deprecated | Merged into AI Reporting | 2026-05-22 |
| 2.4.33 | **Archive Lifecycle** | `/radiology/archive-lifecycle` | Storage lifecycle management. | Deprecated | Merged into PACS Settings | 2026-05-21 |
| 2.4.34 | **HL7 / RIS Bridge** | `/radiology/hl7-settings` | HL7 message routing. | Deprecated | Merged into PACS Settings | 2026-05-21 |
| 2.4.35 | **Agent Setup** | `/radiology/agent-setup` | DICOM bridge setup wizard. | Deprecated | Merged into DICOM Agent | 2026-05-21 |
| 2.4.36 | **Patient Communication** | `/radiology/patient-communication` | Patient-friendly summaries. | Deprecated | Merged into Report Delivery | 2026-05-22 |
| 2.4.37 | **AI Billing Suggestions** | `/radiology/billing-suggestions` | AI billing code suggestions. | Deprecated | Merged into AI Reporting | 2026-05-22 |
| 2.4.38 | **USG Analytics** | `/usg/analytics` | USG throughput metrics. | Deprecated | Not used daily | 2026-05-22 |
| 2.4.39 | **USG Settings** | `/usg/settings` | USG machine profiles. | Deprecated | Merged into PACS Settings | 2026-05-22 |
| 2.4.40 | **USG Key Images** | `/usg/key-images` | USG frame gallery. | Deprecated | Merged into PACS Viewer | 2026-05-22 |
| 2.4.41 | **USG Critical Alerts** | `/usg/critical` | USG-specific alerts. | Deprecated | Merged into Critical Findings | 2026-05-22 |
| 2.4.42 | **USG Worklist** | `/usg/worklist` | USG-specific queue. | Deprecated | Merged into Worklist Hub | 2026-05-22 |

---

## 3. Routes & Pages

### 3.1 Frontend Routes (Diagnostic ERP)

| # | Route/Page | Component | Purpose | Status | Used Daily | Last Date |
|---|------------|-----------|---------|--------|------------|-----------|
| 3.1.1 | `/radiology` | `Radiology.tsx` | Radiology module landing page. | Implemented | No | 2026-05-02 |
| 3.1.2 | `/radiology/worklist` | `RadiologyWorklist.tsx` | RIS worklist with filtering and status. | Implemented | Yes | 2026-06-05 |
| 3.1.3 | `/radiology/unified-report/:worklistId` | `RadiologyReportUnified.tsx` | **NEW** — Unified reporting page for all modalities. | Implemented | Yes | 2026-06-05 |
| 3.1.4 | `/radiology/reporting-workspace` | `RadiologyReportingWorkspace.tsx` | Reporting workspace (deprecated). | Deprecated | No | 2026-05-19 |
| 3.1.5 | `/radiology/reporting-workspace/:studyId` | `RadiologyReportingWorkspace.tsx` | Reporting workspace for specific study. | Deprecated | No | 2026-05-19 |
| 3.1.6 | `/radiology/report/:studyId` | `RadiologyReportEditor.tsx` | Standalone report editor (deprecated). | Deprecated | No | 2026-05-17 |
| 3.1.7 | `/radiology/report-generator` | `RadiologyReportGenerator.tsx` | Report generator (deprecated). | Deprecated | No | 2026-06-03 |
| 3.1.8 | `/radiology/report-generator/:studyId` | `RadiologyReportGenerator.tsx` | Report generator for specific study. | Deprecated | No | 2026-06-03 |
| 3.1.9 | `/radiology/pacs-dashboard` | `PacsDashboard.tsx` | PACS command center (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.10 | `/radiology/pacs-settings` | `PacsSettings.tsx` | PACS configuration page. | Implemented | No | 2026-06-05 |
| 3.1.11 | `/radiology/pacs-logs` | `PacsLogs.tsx` | PACS operational logs (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.12 | `/radiology/dicom-agent-dashboard` | `DicomAgentDashboard.tsx` | DICOM agent monitoring. | Implemented | No | 2026-05-21 |
| 3.1.13 | `/radiology/modality-management` | `ModalityManagement.tsx` | Manage imaging modalities. | Implemented | No | 2026-05-21 |
| 3.1.14 | `/radiology/dicom-qr` | `DicomQueryRetrieve.tsx` | DICOM C-FIND query/retrieve. | Implemented | Yes | 2026-05-17 |
| 3.1.15 | `/radiology/mwl-dashboard` | `MwlDashboard.tsx` | MWL dashboard. | Implemented | Yes | 2026-05-21 |
| 3.1.16 | `/radiology/viewer/:studyInstanceUID` | `DicomViewer.tsx` | In-browser DICOM viewer. | Implemented | Yes | 2026-05-17 |
| 3.1.17 | `/radiology/ai-reporting-settings` | `AiReportingSettings.tsx` | AI reporting settings. | Implemented | Yes | 2026-06-03 |
| 3.1.18 | `/radiology/ai-prompt-templates` | `AiPromptTemplates.tsx` | Prompt templates. | Implemented | Yes | 2026-06-02 |
| 3.1.19 | `/radiology/ai-model-routing` | `AiModelRouting.tsx` | AI model routing. | Implemented | Yes | 2026-06-02 |
| 3.1.20 | `/radiology/ai-audit-log` | `AiAuditLog.tsx` | AI audit log (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.21 | `/radiology/ai-quality-scores` | `AiQualityScores.tsx` | AI quality scores (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.22 | `/radiology/ai-prompt-effectiveness` | `AiPromptEffectiveness.tsx` | Prompt effectiveness (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.23 | `/radiology/ai-dicom-findings` | `AiDicomFindings.tsx` | AI DICOM findings (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.24 | `/radiology/rag-vector-store` | `RagVectorStore.tsx` | RAG vector store (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.25 | `/radiology/ai-search-retrieval` | `AiSearchRetrieval.tsx` | AI search (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.26 | `/radiology/anomaly-alerts` | `AnomalyAlerts.tsx` | Anomaly alerts (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.27 | `/radiology/report-diff` | `ReportDiffViewer.tsx` | Report diff (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.28 | `/radiology/feedback-loop-analytics` | `FeedbackLoopAnalytics.tsx` | Feedback analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.29 | `/radiology/template-versions` | `TemplateVersions.tsx` | Template versions (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.30 | `/radiology/billing-suggestions` | `AiBillingSuggestions.tsx` | Billing suggestions (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.31 | `/radiology/peer-review-assignments` | `PeerReviewAssignments.tsx` | Peer review (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.32 | `/radiology/turnaround-times` | `TurnaroundTimeAnalytics.tsx` | TAT analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.33 | `/radiology/training-data-exports` | `TrainingDataExports.tsx` | Training exports (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.34 | `/radiology/quality-gates` | `ReportQualityGates.tsx` | Quality gates (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.35 | `/radiology/critical-findings` | `CriticalFindings.tsx` | Critical findings tracker. | Implemented | Yes | 2026-05-22 |
| 3.1.36 | `/radiology/provider-health` | `ProviderHealthMonitor.tsx` | Provider health (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.37 | `/radiology/command-center` | `CommandCenter.tsx` | Command center (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.38 | `/radiology/voice-dictation` | `VoiceDictation.tsx` | Voice dictation. | Implemented | Yes | 2026-05-17 |
| 3.1.39 | `/radiology/patient-communication` | `PatientCommunication.tsx` | Patient communication (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.40 | `/radiology/normal-templates` | `NormalReportTemplates.tsx` | Normal templates. | Implemented | Yes | 2026-06-05 |
| 3.1.41 | `/radiology/ai-extraction-review` | `AiExtractionReview.tsx` | AI extraction review. | Implemented | Yes | 2026-05-22 |
| 3.1.42 | `/radiology/hanging-protocols` | `HangingProtocols.tsx` | Hanging protocols (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.43 | `/radiology/dicom-study-worklist` | `DicomStudyWorklist.tsx` | DICOM study listing (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.44 | `/radiology/radiologist-queue` | `RadiologistQueue.tsx` | Radiologist queue (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.45 | `/radiology/technician-workflow/:studyId` | `TechnicianWorkflow.tsx` | Technician workflow (deprecated). | Deprecated | No | 2026-05-17 |
| 3.1.46 | `/echo` | `EchoCardiology.tsx` | Echo cardiology. | Implemented | Yes | 2026-06-03 |
| 3.1.47 | `/fetal-echo` | `FetalEcho.tsx` | Fetal echo. | Implemented | Yes | 2026-06-03 |
| 3.1.48 | `/fetal-usg` | `FetalUsgLevel4.tsx` | Fetal USG. | Implemented | Yes | 2026-06-03 |
| 3.1.49 | `/fetal-usg/:studyId` | `FetalUsgLevel4.tsx` | Fetal USG with pre-filled study. | Implemented | Yes | 2026-06-03 |
| 3.1.50 | `/usg` | `UsgDoppler.tsx` | USG/Doppler landing. | Implemented | Yes | 2026-05-22 |
| 3.1.51 | `/usg/worklist` | `UsgWorklist.tsx` | USG worklist (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.52 | `/usg/measurements/:studyInstanceUID` | `UsgMeasurementReview.tsx` | Measurement review. | Implemented | Yes | 2026-05-21 |
| 3.1.53 | `/usg/measurements` | `UsgMeasurementReview.tsx` | Measurement review (no UID). | Implemented | Yes | 2026-05-21 |
| 3.1.54 | `/usg/reporting` | `UsgReporting.tsx` | USG report editor (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.55 | `/usg/doppler` | `UsgDopplerReporting.tsx` | USG Doppler report editor (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.56 | `/usg/key-images` | `UsgKeyImagesGallery.tsx` | USG key images (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.57 | `/usg/critical` | `UsgCriticalAlerts.tsx` | USG critical alerts (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.58 | `/usg/settings` | `UsgAdminSettings.tsx` | USG admin settings (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.59 | `/usg/analytics` | `UsgAnalytics.tsx` | USG analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.60 | `/settings/radiology` | `RadiologySettings.tsx` | Radiology settings hub. | Implemented | Yes | 2026-05-21 |
| 3.1.61 | `/radiology/usg-measurements/:studyInstanceUID` | `UsgMeasurementReview.tsx` | Radiology path measurement review. | Implemented | Yes | 2026-05-22 |
| 3.1.62 | `/radiology/usg-measurements` | `UsgMeasurementReview.tsx` | Radiology path measurement review. | Implemented | Yes | 2026-05-22 |
| 3.1.63 | `/radiology/usg-admin-settings` | `UsgAdminSettings.tsx` | USG admin via radiology path (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.64 | `/m/viewer/:studyInstanceUID` | `MobileViewer.tsx` | Mobile DICOM viewer. | Implemented | Yes | 2026-05-26 |
| 3.1.65 | `/dicom-nodes` | `DicomNodes.tsx` | DICOM node management. | Implemented | No | 2026-05-16 |
| 3.1.66 | `/teleradiology` | `TeleradiologyPortal.tsx` | Teleradiology portal. | Implemented | Yes | 2026-05-03 |
| 3.1.67 | `/radiology/acquisition-gateway` | `AcquisitionGateway.tsx` | Acquisition gateway (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.68 | `/radiology/mwl-manager` | `MwlManager.tsx` | MWL manager (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.69 | `/radiology/ai-pipeline` | `AiPipelineManager.tsx` | AI pipeline (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.70 | `/radiology/critical-alerts` | `CriticalAlertsManager.tsx` | Critical alerts (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.71 | `/radiology/storage-lifecycle` | `StorageLifecycle.tsx` | Storage lifecycle (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.72 | `/radiology/productivity-tools` | `RadiologistTools.tsx` | Productivity tools (deprecated). | Deprecated | No | 2026-05-22 |
| 3.1.73 | `/radiology/archive-lifecycle` | `PacsArchiveLifecycle.tsx` | Archive lifecycle (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.74 | `/radiology/watchdog` | `PacsWatchdogDashboard.tsx` | Watchdog. | Implemented | No | 2026-06-05 |
| 3.1.75 | `/radiology/agent-setup` | `AgentSetup.tsx` | Agent setup (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.76 | `/radiology/hl7-settings` | `Hl7Settings.tsx` | HL7 settings (deprecated). | Deprecated | No | 2026-05-21 |
| 3.1.77 | `/radiology/ai-inference-settings` | `AiInferenceSettings.tsx` | AI inference settings (deprecated). | Deprecated | No | 2026-05-22 |

---

## 4. Frontend Components

| # | Component | Location | Purpose | Status | Used Daily | Last Date |
|---|----------|----------|---------|--------|------------|-----------|
| 4.1 | `Radiology` | `pages/Radiology.tsx` | Radiology module landing page. | Implemented | No | 2026-05-02 |
| 4.2 | `RadiologyWorklist` | `pages/RadiologyWorklist.tsx` | RIS worklist with filtering and status. | Implemented | Yes | 2026-06-05 |
| 4.3 | `RadiologyReportUnified` | `pages/RadiologyReportUnified.tsx` | **NEW** — Unified reporting page for all modalities. | Implemented | Yes | 2026-06-05 |
| 4.4 | `RadiologyReportingWorkspace` | `pages/RadiologyReportingWorkspace.tsx` | Reporting workspace (deprecated). | Deprecated | No | 2026-05-19 |
| 4.5 | `RadiologyReportEditor` | `pages/RadiologyReportEditor.tsx` | Standalone report editor (deprecated). | Deprecated | No | 2026-05-17 |
| 4.6 | `RadiologyReportGenerator` | `pages/RadiologyReportGenerator.tsx` | Report generator (deprecated). | Deprecated | No | 2026-06-03 |
| 4.7 | `PACS` | `pages/PACS.tsx` | PACS viewer interface. | Implemented | Yes | 2026-05-26 |
| 4.8 | `PacsDashboard` | `pages/PacsDashboard.tsx` | PACS dashboard (deprecated). | Deprecated | No | 2026-05-21 |
| 4.9 | `DicomQueryRetrieve` | `pages/DicomQueryRetrieve.tsx` | DICOM C-FIND search interface. | Implemented | Yes | 2026-05-17 |
| 4.10 | `DicomViewer` | `pages/DicomViewer.tsx` | In-browser DICOM viewer. | Implemented | Yes | 2026-05-17 |
| 4.11 | `DicomStudyWorklist` | `pages/DicomStudyWorklist.tsx` | DICOM study listing (deprecated). | Deprecated | No | 2026-05-21 |
| 4.12 | `DicomAgentDashboard` | `pages/DicomAgentDashboard.tsx` | DICOM agent monitoring. | Implemented | No | 2026-05-21 |
| 4.13 | `DicomNodes` | `pages/DicomNodes.tsx` | DICOM node configuration. | Implemented | No | 2026-05-16 |
| 4.14 | `MwlDashboard` | `pages/MwlDashboard.tsx` | MWL dashboard. | Implemented | Yes | 2026-05-21 |
| 4.15 | `MwlManager` | `pages/MwlManager.tsx` | MWL entry management (deprecated). | Deprecated | No | 2026-05-22 |
| 4.16 | `ModalityManagement` | `pages/ModalityManagement.tsx` | Modality management. | Implemented | No | 2026-05-21 |
| 4.17 | `PacsSettings` | `pages/PacsSettings.tsx` | PACS settings. | Implemented | No | 2026-05-21 |
| 4.18 | `PacsLogs` | `pages/PacsLogs.tsx` | PACS logs (deprecated). | Deprecated | No | 2026-05-21 |
| 4.19 | `PacsArchiveLifecycle` | `pages/PacsArchiveLifecycle.tsx` | Archive lifecycle (deprecated). | Deprecated | No | 2026-05-21 |
| 4.20 | `PacsWatchdogDashboard` | `pages/PacsWatchdogDashboard.tsx` | Watchdog dashboard. | Implemented | No | 2026-06-05 |
| 4.21 | `AiReportingSettings` | `pages/AiReportingSettings.tsx` | AI reporting settings. | Implemented | Yes | 2026-06-03 |
| 4.22 | `AiPromptTemplates` | `pages/AiPromptTemplates.tsx` | Prompt templates. | Implemented | Yes | 2026-06-02 |
| 4.23 | `AiModelRouting` | `pages/AiModelRouting.tsx` | AI model routing. | Implemented | Yes | 2026-06-02 |
| 4.24 | `ReportTemplatesPage` | `pages/ReportTemplates.tsx` | Report templates. | Implemented | Yes | 2026-05-22 |
| 4.25 | `AiAuditLog` | `pages/AiAuditLog.tsx` | AI audit log (deprecated). | Deprecated | No | 2026-05-22 |
| 4.26 | `AiQualityScores` | `pages/AiQualityScores.tsx` | AI quality scores (deprecated). | Deprecated | No | 2026-05-22 |
| 4.27 | `AiPromptEffectiveness` | `pages/AiPromptEffectiveness.tsx` | Prompt effectiveness (deprecated). | Deprecated | No | 2026-05-22 |
| 4.28 | `AiDicomFindings` | `pages/AiDicomFindings.tsx` | AI DICOM findings (deprecated). | Deprecated | No | 2026-05-22 |
| 4.29 | `RagVectorStore` | `pages/RagVectorStore.tsx` | RAG vector store (deprecated). | Deprecated | No | 2026-05-22 |
| 4.30 | `AiSearchRetrieval` | `pages/AiSearchRetrieval.tsx` | AI search (deprecated). | Deprecated | No | 2026-05-22 |
| 4.31 | `AnomalyAlerts` | `pages/AnomalyAlerts.tsx` | Anomaly alerts (deprecated). | Deprecated | No | 2026-05-22 |
| 4.32 | `ReportDiffViewer` | `pages/ReportDiffViewer.tsx` | Report diff (deprecated). | Deprecated | No | 2026-05-22 |
| 4.33 | `FeedbackLoopAnalytics` | `pages/FeedbackLoopAnalytics.tsx` | Feedback analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 4.34 | `TemplateVersions` | `pages/TemplateVersions.tsx` | Template versions (deprecated). | Deprecated | No | 2026-05-22 |
| 4.35 | `AiBillingSuggestions` | `pages/AiBillingSuggestions.tsx` | Billing suggestions (deprecated). | Deprecated | No | 2026-05-22 |
| 4.36 | `PeerReviewAssignments` | `pages/PeerReviewAssignments.tsx` | Peer review (deprecated). | Deprecated | No | 2026-05-22 |
| 4.37 | `TurnaroundTimeAnalytics` | `pages/TurnaroundTimeAnalytics.tsx` | TAT analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 4.38 | `TrainingDataExports` | `pages/TrainingDataExports.tsx` | Training exports (deprecated). | Deprecated | No | 2026-05-22 |
| 4.39 | `ReportQualityGates` | `pages/ReportQualityGates.tsx` | Quality gates (deprecated). | Deprecated | No | 2026-05-22 |
| 4.40 | `CriticalFindings` | `pages/CriticalFindings.tsx` | Critical findings tracker. | Implemented | Yes | 2026-05-22 |
| 4.41 | `ProviderHealthMonitor` | `pages/ProviderHealthMonitor.tsx` | Provider health (deprecated). | Deprecated | No | 2026-05-22 |
| 4.42 | `CommandCenter` | `pages/CommandCenter.tsx` | Command center (deprecated). | Deprecated | No | 2026-05-21 |
| 4.43 | `RadiologyCommandCenter` | `pages/RadiologyCommandCenter.tsx` | Radiology command center (deprecated). | Deprecated | No | 2026-05-22 |
| 4.44 | `VoiceDictation` | `pages/VoiceDictation.tsx` | Voice dictation. | Implemented | Yes | 2026-05-17 |
| 4.45 | `PatientCommunication` | `pages/PatientCommunication.tsx` | Patient communication (deprecated). | Deprecated | No | 2026-05-22 |
| 4.46 | `NormalReportTemplates` | `pages/NormalReportTemplates.tsx` | Normal templates. | Implemented | Yes | 2026-06-05 |
| 4.47 | `AcquisitionGateway` | `pages/AcquisitionGateway.tsx` | Acquisition gateway (deprecated). | Deprecated | No | 2026-05-22 |
| 4.48 | `StorageLifecycle` | `pages/StorageLifecycle.tsx` | Storage lifecycle (deprecated). | Deprecated | No | 2026-05-22 |
| 4.49 | `CriticalAlertsManager` | `pages/CriticalAlertsManager.tsx` | Critical alerts manager (deprecated). | Deprecated | No | 2026-05-22 |
| 4.50 | `AiPipelineManager` | `pages/AiPipelineManager.tsx` | AI pipeline (deprecated). | Deprecated | No | 2026-05-22 |
| 4.51 | `RadiologistTools` | `pages/RadiologistTools.tsx` | Productivity tools (deprecated). | Deprecated | No | 2026-05-22 |
| 4.52 | `AgentSetup` | `pages/AgentSetup.tsx` | Agent setup (deprecated). | Deprecated | No | 2026-05-21 |
| 4.53 | `RadiologistQueue` | `pages/RadiologistQueue.tsx` | Radiologist queue (deprecated). | Deprecated | No | 2026-05-21 |
| 4.54 | `TechnicianWorkflow` | `pages/TechnicianWorkflow.tsx` | Technician workflow (deprecated). | Deprecated | No | 2026-05-17 |
| 4.55 | `AiExtractionReview` | `pages/AiExtractionReview.tsx` | AI extraction review. | Implemented | Yes | 2026-05-22 |
| 4.56 | `HangingProtocols` | `pages/HangingProtocols.tsx` | Hanging protocols (deprecated). | Deprecated | No | 2026-05-21 |
| 4.57 | `RadiologySettings` | `pages/RadiologySettings.tsx` | Radiology settings. | Implemented | Yes | 2026-05-21 |
| 4.58 | `AiInferenceSettings` | `pages/AiInferenceSettings.tsx` | AI inference settings (deprecated). | Deprecated | No | 2026-05-22 |
| 4.59 | `Hl7Settings` | `pages/Hl7Settings.tsx` | HL7 settings (deprecated). | Deprecated | No | 2026-05-21 |
| 4.60 | `EchoCardiology` | `pages/EchoCardiology.tsx` | Echo cardiology. | Implemented | Yes | 2026-06-03 |
| 4.61 | `FetalEcho` | `pages/FetalEcho.tsx` | Fetal echo. | Implemented | Yes | 2026-06-03 |
| 4.62 | `FetalUsgLevel4` | `pages/FetalUsgLevel4.tsx` | Fetal USG. | Implemented | Yes | 2026-06-03 |
| 4.63 | `UsgDoppler` | `pages/UsgDoppler.tsx` | USG Doppler landing. | Implemented | Yes | 2026-05-22 |
| 4.64 | `UsgWorklist` | `pages/UsgWorklist.tsx` | USG worklist (deprecated). | Deprecated | No | 2026-05-22 |
| 4.65 | `UsgReporting` | `pages/UsgReporting.tsx` | USG reporting (deprecated). | Deprecated | No | 2026-05-22 |
| 4.66 | `UsgDopplerReporting` | `pages/UsgDopplerReporting.tsx` | USG Doppler reporting (deprecated). | Deprecated | No | 2026-05-22 |
| 4.67 | `UsgMeasurementReview` | `pages/UsgMeasurementReview.tsx` | USG measurement review. | Implemented | Yes | 2026-05-21 |
| 4.68 | `UsgCriticalAlerts` | `pages/UsgCriticalAlerts.tsx` | USG critical alerts (deprecated). | Deprecated | No | 2026-05-22 |
| 4.69 | `UsgAdminSettings` | `pages/UsgAdminSettings.tsx` | USG admin settings (deprecated). | Deprecated | No | 2026-05-22 |
| 4.70 | `UsgAnalytics` | `pages/UsgAnalytics.tsx` | USG analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 4.71 | `UsgKeyImagesGallery` | `pages/UsgKeyImagesGallery.tsx` | USG key images (deprecated). | Deprecated | No | 2026-05-22 |
| 4.72 | `TeleradiologyPortal` | `pages/TeleradiologyPortal.tsx` | Teleradiology portal. | Implemented | Yes | 2026-05-03 |
| 4.73 | `MobileViewer` | `pages/MobileViewer.tsx` | Mobile viewer. | Implemented | Yes | 2026-05-26 |
| 4.74 | `SmartRadiologyCards` | `components/smartRadiology/SmartRadiologyCards.tsx` | AI findings cards. | Implemented | Yes | 2026-05-22 |
| 4.75 | `SmartRadiologyWidget` | `components/smartRadiology/` | Smart radiology widget. | Implemented | Yes | 2026-05-22 |
| 4.76 | `SmartRadiologyPanel` | `components/smartRadiology/` | Smart radiology panel. | Implemented | Yes | 2026-05-22 |

---

## 5. Backend API Routes

### 5.1 Radiology Operations (`/api/radiology`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.1.1 | GET | `/api/radiology/worklist` | RIS worklist with filters. | Implemented | Yes | 2026-05-21 |
| 5.1.2 | GET | `/api/radiology/pacs-worklist` | PACS-pushed studies view. | Implemented | Yes | 2026-05-21 |
| 5.1.3 | GET | `/api/radiology/pacs-worklist/count` | Total PACS worklist count. | Implemented | Yes | 2026-05-21 |
| 5.1.4 | GET | `/api/radiology/pacs-worklist/:id/ai-draft` | Stored AI draft for study. | Implemented | Yes | 2026-06-03 |
| 5.1.5 | POST | `/api/radiology/pacs-worklist/:id/ai-feedback` | Submit AI draft feedback. | Implemented | Yes | 2026-06-03 |
| 5.1.6 | GET | `/api/radiology/options` | Available modalities, departments, statuses. | Implemented | Yes | 2026-05-21 |
| 5.1.7 | GET | `/api/radiology/:id/pacs-url` | Generate viewer URLs (Orthanc, Weasis, OHIF). | Implemented | Yes | 2026-05-21 |
| 5.1.8 | GET | `/api/radiology/technicians` | List radiology technicians. | Implemented | Yes | 2026-05-21 |
| 5.1.9 | GET | `/api/radiology/templates/:testId` | Report templates for test. | Implemented | Yes | 2026-05-08 |
| 5.1.10 | GET | `/api/radiology/studies/:id` | Full study details. | Implemented | Yes | 2026-05-21 |
| 5.1.11 | POST | `/api/radiology/studies` | Create radiology study (walk-in). | Implemented | Yes | 2026-05-21 |
| 5.1.12 | PATCH | `/api/radiology/studies/:id` | Update study status, tech, notes, MWL fields. | Implemented | Yes | 2026-05-21 |

### 5.2 DICOM Node & Job Management (`/api/dicom`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.2.1 | GET | `/api/dicom/provider` | PACS provider config and health. | Implemented | Yes | 2026-05-24 |
| 5.2.2 | GET | `/api/dicom/nodes` | List all DICOM nodes. | Implemented | Yes | 2026-05-16 |
| 5.2.3 | POST | `/api/dicom/nodes` | Register new DICOM node. | Implemented | No | 2026-05-16 |
| 5.2.4 | POST | `/api/dicom/nodes/:id/test` | TCP connection test. | Implemented | Yes | 2026-05-24 |
| 5.2.5 | POST | `/api/dicom/nodes/:id/pull` | Trigger C-MOVE/C-GET pull. | Implemented | Yes | 2026-05-16 |
| 5.2.6 | GET | `/api/dicom/pull-jobs` | List pull job status. | Implemented | Yes | 2026-05-16 |

### 5.3 PACS Data Proxy (`/api/pacs`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.3.1 | GET | `/api/pacs/config` | Internal PACS configuration. | Implemented | Yes | 2026-05-21 |
| 5.3.2 | GET | `/api/pacs/health` | Orthanc connectivity check. | Implemented | Yes | 2026-05-21 |
| 5.3.3 | GET | `/api/pacs/patients` | List PACS patients. | Implemented | Yes | 2026-05-21 |
| 5.3.4 | GET | `/api/pacs/studies` | List PACS studies. | Implemented | Yes | 2026-05-21 |
| 5.3.5 | GET | `/api/pacs/instances/:id/preview` | DICOM preview image proxy. | Implemented | Yes | 2026-05-21 |
| 5.3.6 | GET | `/api/pacs/wado` | WADO-URI proxy. | Implemented | Yes | 2026-05-21 |

### 5.4 USG Reporting & Measurements (`/api/usg-reports`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.4.1 | GET | `/api/usg-reports` | List USG report drafts. | Implemented | Yes | 2026-05-22 |
| 5.4.2 | POST | `/api/usg-reports/suggest-template` | Template suggestion by study. | Implemented | Yes | 2026-05-22 |
| 5.4.3 | POST | `/api/usg-reports/auto-generate` | Auto-generate report from measurements. | Implemented | Yes | 2026-05-22 |
| 5.4.4 | POST | `/api/usg-reports/:id/verify` | Mark report as verified. | Implemented | Yes | 2026-05-22 |
| 5.4.5 | POST | `/api/usg-reports/:id/finalize` | Finalize report with hash. | Implemented | Yes | 2026-05-22 |
| 5.4.6 | POST | `/api/usg-reports/:id/quality-check` | Automated QC run. | Implemented | Yes | 2026-05-22 |

### 5.5 USG Measurement Extraction (`/api/usg-extraction`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.5.1 | GET | `/api/usg-extraction/stats` | Dashboard counts. | Implemented | Yes | 2026-05-21 |
| 5.5.2 | POST | `/api/usg-extraction/extract` | Trigger extraction for a study. | Implemented | Yes | 2026-05-21 |
| 5.5.3 | GET | `/api/usg-extraction/study/:studyInstanceUID` | Get measurements for a study. | Implemented | Yes | 2026-06-05 |
| 5.5.4 | GET | `/api/usg-extraction/worklist/:worklistId` | Get measurements for a worklist entry. | Implemented | Yes | 2026-06-05 |
| 5.5.5 | PATCH | `/api/usg-extraction/measurements/:id/approve` | Approve a measurement set. | Implemented | Yes | 2026-05-21 |
| 5.5.6 | PATCH | `/api/usg-extraction/measurements/:id/reject` | Reject a measurement set. | Implemented | Yes | 2026-05-21 |
| 5.5.7 | PATCH | `/api/usg-extraction/measurements/:id/field` | Update a single field. | Implemented | Yes | 2026-05-21 |
| 5.5.8 | GET | `/api/usg-extraction/settings` | Get admin settings. | Implemented | No | 2026-05-21 |
| 5.5.9 | PUT | `/api/usg-extraction/settings` | Save admin settings. | Implemented | No | 2026-05-21 |

### 5.6 Smart Radiology AI (`/api/smart-radiology`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.6.1 | POST | `/api/smart-radiology/ai-impressions/:studyId` | Generate AI impressions. | Implemented | Yes | 2026-05-22 |
| 5.6.2 | POST | `/api/smart-radiology/quality-check/:reportDraftId` | AI quality check. | Implemented | Yes | 2026-05-22 |
| 5.6.3 | POST | `/api/smart-radiology/follow-up/:reportDraftId` | Follow-up recommendations. | Implemented | Yes | 2026-05-22 |
| 5.6.4 | POST | `/api/smart-radiology/translations/:reportDraftId` | Bilingual report summaries. | Implemented | Yes | 2026-05-22 |
| 5.6.5 | POST | `/api/smart-radiology/sonographer-drafts` | Submit sonographer tablet drafts. | Implemented | Yes | 2026-05-22 |
| 5.6.6 | POST | `/api/smart-radiology/billing-suggestions` | Suggest billable items. | Implemented | No | 2026-05-22 |
| 5.6.7 | POST | `/api/smart-radiology/sr-export` | Structured report export. | Implemented | No | 2026-05-22 |

### 5.7 Radiology Workflow (`/api/radiology-workflow`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.7.1 | GET | `/api/radiology-workflow/mwl` | Retrieve MWL entries. | Implemented | Yes | 2026-05-12 |
| 5.7.2 | POST | `/api/radiology-workflow/mwl` | Create MWL entry. | Implemented | Yes | 2026-05-12 |
| 5.7.3 | GET | `/api/radiology-workflow/incoming` | Monitor acquisition gateway. | Implemented | No | 2026-05-22 |
| 5.7.4 | GET | `/api/radiology-workflow/ai-jobs` | AI pipeline status. | Implemented | No | 2026-05-22 |
| 5.7.5 | GET | `/api/radiology-workflow/critical-alerts` | Critical alerts. | Implemented | Yes | 2026-05-22 |
| 5.7.6 | GET | `/api/radiology-workflow/command-center` | Aggregated dashboard. | Implemented | No | 2026-05-22 |

### 5.8 Internal API (`/api/internal`)

| # | Method | Path | Purpose | Status | Used Daily | Last Date |
|---|--------|------|---------|--------|------------|-----------|
| 5.8.1 | POST | `/api/internal/radiology/studies` | Upsert worklist (PACS hook). | Implemented | Yes | 2026-05-11 |
| 5.8.2 | POST | `/api/internal/radiology/report-status` | Update study status. | Implemented | Yes | 2026-05-11 |
| 5.8.3 | POST | `/api/internal/radiology/ai-draft` | Trigger AI draft generation. | Implemented | Yes | 2026-05-11 |

### 5.9 Additional Radiology Routes

| # | Route File | Purpose | Status | Used Daily | Last Date |
|---|-----------|---------|--------|------------|-----------|
| 5.9.1 | `echoCardiology.ts` | `/api/echo-cardiology/*` | Echo cardiology CRUD. | Implemented | Yes | 2026-06-03 |
| 5.9.2 | `fetalUsgLevel4.ts` | `/api/fetal-usg-level4/*` | Fetal USG Level 4. | Implemented | Yes | 2026-06-03 |
| 5.9.3 | `usgDoppler.ts` | `/api/usg-doppler/*` | Doppler measurements. | Implemented | Yes | 2026-05-22 |
| 5.9.4 | `usgExtraction.ts` | `/api/usg-extraction/*` | USG measurement extraction. | Implemented | Yes | 2026-06-05 |
| 5.9.5 | `usgAnalytics.ts` | `/api/usg-analytics/*` | USG analytics. | Implemented | No | 2026-05-22 |
| 5.9.6 | `usgCriticalAlerts.ts` | `/api/usg-critical-alerts/*` | USG critical alerts. | Implemented | Yes | 2026-05-22 |
| 5.9.7 | `dicomWorkflow.ts` | `/api/dicom-workflow/*` | DICOM workflow. | Implemented | Yes | 2026-05-17 |
| 5.9.8 | `teleradiology.ts` | `/api/teleradiology/*` | Teleradiology backend. | Implemented | Yes | 2026-05-22 |
| 5.9.9 | `teleradiologyPortal.ts` | `/api/teleradiology-portal/*` | Teleradiology portal. | Implemented | Yes | 2026-05-03 |
| 5.9.10 | `reportDelivery.ts` | `/api/report-delivery/*` | Report delivery. | Implemented | Yes | 2026-05-22 |
| 5.9.11 | `pacsEnterprise.ts` | `/api/pacs-enterprise/*` | Enterprise PACS. | Implemented | No | 2026-05-21 |
| 5.9.12 | `risMonitoring.ts` | `/api/ris-monitoring/*` | RIS monitoring. | Implemented | No | 2026-05-21 |
| 5.9.13 | `dicom-agent.ts` | `/api/dicom-agent/*` | DICOM agent. | Implemented | No | 2026-05-21 |
| 5.9.14 | `dicom-uploads.ts` | `/api/dicom-uploads/*` | DICOM file uploads. | Implemented | Yes | 2026-05-22 |
| 5.9.15 | `hl7.ts` | `/api/hl7/*` | HL7 messaging. | Implemented | No | 2026-05-21 |
| 5.9.16 | `aiModelRoutes.ts` | `/api/ai-model-routes/*` | AI model routing. | Implemented | Yes | 2026-06-02 |
| 5.9.17 | `structuredReportTemplates.ts` | `/api/structured-report-templates/*` | Structured templates. | Implemented | Yes | 2026-05-22 |

---

## 6. Database Schema Tables

### 6.1 Core Radiology

| # | Table | Schema File | Purpose | Status | Used Daily | Last Date |
|---|-------|-------------|---------|--------|------------|-----------|
| 6.1.1 | `radiology_studies` | `radiology.ts` | Main registry for radiology tests. | Implemented | Yes | 2026-05-21 |
| 6.1.2 | `radiology_film_issues` | `radiology.ts` | Physical film/CD issuance logs. | Implemented | Yes | 2026-05-21 |
| 6.1.3 | `radiology_prompts` | `radiology.ts` | Reusable AI instructions. | Implemented | Yes | 2026-05-21 |
| 6.1.4 | `radiology_priority_rules` | `radiology.ts` | Auto priority assignment rules. | Implemented | Yes | 2026-05-21 |
| 6.1.5 | `radiologist_assignment_rules` | `radiology.ts` | Auto radiologist assignment. | Implemented | Yes | 2026-05-21 |
| 6.1.6 | `radiologist_subspecialties` | `radiology.ts` | Radiologist expertise mapping. | Implemented | Yes | 2026-05-21 |
| 6.1.7 | `radiologist_workloads` | `radiology.ts` | Real-time workload tracking. | Implemented | Yes | 2026-05-21 |
| 6.1.8 | `radiology_report_verifications` | `radiology.ts` | Multi-stage approval tracking. | Implemented | Yes | 2026-05-21 |
| 6.1.9 | `radiology_critical_findings` | `radiology.ts` | High-priority finding alerts. | Implemented | Yes | 2026-05-21 |
| 6.1.10 | `radiology_tat_tracking` | `radiology.ts` | Turnaround time SLA. | Implemented | Yes | 2026-05-21 |
| 6.1.11 | `radiology_structured_templates` | `radiology.ts` | JSON-based report templates. | Implemented | Yes | 2026-05-21 |
| 6.1.12 | `radiology_ai_enhancements` | `radiology.ts` | AI-generated findings. | Implemented | Yes | 2026-05-21 |
| 6.1.13 | `radiology_dicom_measurements` | `radiology.ts` | Structured DICOM measurements. | Implemented | Yes | 2026-05-21 |
| 6.1.14 | `teleradiology_sites` | `radiology.ts` | Remote site registry. | Implemented | Yes | 2026-05-22 |
| 6.1.15 | `radiology_multi_site_worklist` | `radiology.ts` | Multi-site sync. | Implemented | Yes | 2026-05-22 |
| 6.1.16 | `dicom_routing_optimization_log` | `radiology.ts` | Routing decisions log. | Implemented | No | 2026-05-22 |

### 6.2 Worklist & Workflow

| # | Table | Schema File | Purpose | Status | Used Daily | Last Date |
|---|-------|-------------|---------|--------|------------|-----------|
| 6.2.1 | `radiology_worklist` | `radiologyWorklist.ts` | PACS-pushed RIS mirror. | Implemented | Yes | 2026-05-21 |
| 6.2.2 | `radiology_audit_log` | `radiologyWorklist.ts` | RIS automation audit. | Implemented | No | 2026-05-21 |
| 6.2.3 | `mwl_entries` | `radiologyWorkflow.ts` | DICOM MWL entries. | Implemented | Yes | 2026-05-12 |
| 6.2.4 | `dicom_incoming_studies` | `radiologyWorkflow.ts` | Acquisition gateway. | Implemented | Yes | 2026-05-22 |
| 6.2.5 | `ai_job_queue` | `radiologyWorkflow.ts` | AI task orchestration. | Implemented | Yes | 2026-05-22 |
| 6.2.6 | `radiologist_shortcuts` | `radiologyWorkflow.ts` | Radiologist shortcuts. | Implemented | No | 2026-05-22 |
| 6.2.7 | `radiologist_macros` | `radiologyWorkflow.ts` | Radiologist macros. | Implemented | No | 2026-05-22 |
| 6.2.8 | `viewer_presets` | `radiologyWorkflow.ts` | Window/level presets. | Implemented | No | 2026-05-22 |
| 6.2.9 | `study_access_log` | `radiologyWorkflow.ts` | Study access audit. | Implemented | No | 2026-05-22 |
| 6.2.10 | `pacs_storage_tier` | `radiologyWorkflow.ts` | Storage tier management. | Implemented | No | 2026-05-22 |
| 6.2.11 | `radiology_scheduled_procedures` | `radiologyScheduledProcedures.ts` | MWL source table. | Implemented | Yes | 2026-05-12 |

### 6.3 DICOM & Infrastructure

| # | Table | Schema File | Purpose | Status | Used Daily | Last Date |
|---|-------|-------------|---------|--------|------------|-----------|
| 6.3.1 | `dicom_nodes` | `dicom.ts` | DICOM node configuration. | Implemented | Yes | 2026-05-16 |
| 6.3.2 | `dicom_pull_jobs` | `dicom.ts` | Pull job lifecycle. | Implemented | Yes | 2026-05-16 |
| 6.3.3 | `dicom_studies` | `dicomStudies.ts` | Canonical DICOM study registry. | Implemented | Yes | 2026-05-21 |
| 6.3.4 | `dicom_study_series` | `dicomStudies.ts` | Series-level metadata. | Implemented | Yes | 2026-05-21 |
| 6.3.5 | `dicom_study_audit_log` | `dicomStudies.ts` | Study lifecycle events. | Implemented | No | 2026-05-21 |
| 6.3.6 | `ai_extraction_results` | `dicomStudies.ts` | Human-reviewable AI extraction. | Implemented | Yes | 2026-05-21 |
| 6.3.7 | `hanging_protocols` | `dicomStudies.ts` | Viewer layout configs. | Implemented | No | 2026-05-21 |
| 6.3.8 | `technician_workflow` | `dicomStudies.ts` | Technician metadata. | Implemented | Yes | 2026-05-21 |
| 6.3.9 | `modality_routing_map` | `dicomStudies.ts` | Modality routing. | Implemented | Yes | 2026-05-21 |
| 6.3.10 | `dicom_pull_agent_logs` | `dicomAgent.ts` | Agent technical logs. | Implemented | No | 2026-05-21 |
| 6.3.11 | `dicom_pull_agent_status` | `dicomAgent.ts` | Agent health tracking. | Implemented | No | 2026-05-21 |
| 6.3.12 | `dicom_pulled_studies` | `dicomPulledStudies.ts` | Deduplication registry. | Implemented | Yes | 2026-05-21 |
| 6.3.13 | `dicom_failed_retrieval_queue` | `dicomPulledStudies.ts` | Failed retrieval retry. | Implemented | Yes | 2026-05-21 |
| 6.3.14 | `dicom_routing_rules` | `dicomRoutingRules.ts` | Auto-forward rules. | Implemented | No | 2026-05-22 |

### 6.4 USG & Smart Radiology

| # | Table | Schema File | Purpose | Status | Used Daily | Last Date |
|---|-------|-------------|---------|--------|------------|-----------|
| 6.4.1 | `usg_measurements` | `usgMeasurements.ts` | Unified USG measurement storage. | Implemented | Yes | 2026-06-05 |
| 6.4.2 | `usg_extraction_logs` | `usgMeasurements.ts` | OCR/AI extraction performance. | Implemented | No | 2026-05-21 |
| 6.4.3 | `usg_key_images` | `usgMeasurements.ts` | Significant frame references. | Implemented | Yes | 2026-05-21 |
| 6.4.4 | `usg_doppler_measurements` | `usgMeasurements.ts` | Doppler measurements. | Implemented | Yes | 2026-05-22 |
| 6.4.5 | `usg_extraction_settings` | `usgMeasurements.ts` | USG AI pipeline config. | Implemented | No | 2026-05-21 |
| 6.4.6 | `usg_machine_profiles` | `usgMeasurements.ts` | USG machine registry. | Implemented | No | 2026-05-21 |
| 6.4.7 | `usg_report_drafts` | `usgMeasurements.ts` | USG report drafts. | Implemented | Yes | 2026-05-22 |
| 6.4.8 | `ai_impressions` | `smartRadiology.ts` | AI impressions with edits. | Implemented | Yes | 2026-05-22 |
| 6.4.9 | `report_quality_checks` | `smartRadiology.ts` | Pre-finalization validation. | Implemented | Yes | 2026-05-22 |
| 6.4.10 | `follow_up_recommendations` | `smartRadiology.ts` | AI follow-up suggestions. | Implemented | Yes | 2026-05-22 |
| 6.4.11 | `template_learning` | `smartRadiology.ts` | Pattern learning from corrections. | Implemented | No | 2026-05-22 |
| 6.4.12 | `report_translations` | `smartRadiology.ts` | Bilingual summaries. | Implemented | Yes | 2026-05-22 |
| 6.4.13 | `sonographer_drafts` | `smartRadiology.ts` | Tablet workflow drafts. | Implemented | Yes | 2026-05-22 |
| 6.4.14 | `smart_routing_rules` | `smartRadiology.ts` | Advanced routing rules. | Implemented | No | 2026-05-22 |
| 6.4.15 | `study_tat_metrics` | `smartRadiology.ts` | Detailed SLA tracking. | Implemented | No | 2026-05-22 |
| 6.4.16 | `report_amendments` | `smartRadiology.ts` | Post-finalization change history. | Implemented | Yes | 2026-05-22 |
| 6.4.17 | `dicom_sr_export_queue` | `smartRadiology.ts` | Structured report export. | Implemented | No | 2026-05-22 |
| 6.4.18 | `fetal_usg_level4` | `fetalUsgLevel4.ts` | Fetal anomaly scan biometry. | Implemented | Yes | 2026-06-03 |
| 6.4.19 | `echo_cardiology` | `echoCardiology.ts` | Echo cardiology measurements. | Implemented | Yes | 2026-06-03 |

### 6.5 Enterprise & AI Management

| # | Table | Schema File | Purpose | Status | Used Daily | Last Date |
|---|-------|-------------|---------|--------|------------|-----------|
| 6.5.1 | `enterprise_radiology` | `enterpriseRadiology.ts` | Enterprise performance stats. | Implemented | No | 2026-05-21 |
| 6.5.2 | `teleradiology_users` | `teleradiologyUsers.ts` | External radiologist users. | Implemented | Yes | 2026-05-22 |
| 6.5.3 | `radiology_share_links` | `radiologyShareLinks.ts` | Tokenized share links. | Implemented | Yes | 2026-05-22 |
| 6.5.4 | `ai_model_routes` | `aiModelRoutes.ts` | AI provider routing. | Implemented | Yes | 2026-06-02 |
| 6.5.5 | `ai_prompt_templates` | `aiPromptTemplates.ts` | Modality-aware prompts. | Implemented | Yes | 2026-06-02 |
| 6.5.6 | `ai_quality_scores` | `aiQualityScores.ts` | AI accuracy metrics. | Implemented | No | 2026-05-22 |
| 6.5.7 | `anomaly_alerts` | `anomalyAlerts.ts` | Workflow anomaly detection. | Implemented | No | 2026-05-22 |
| 6.5.8 | `turnaround_times` | `turnaroundTimes.ts` | TAT analytics snapshots. | Implemented | No | 2026-05-22 |
| 6.5.9 | `structured_report_templates` | `structuredReportTemplates.ts` | Structured report definitions. | Implemented | Yes | 2026-05-22 |
| 6.5.10 | `abnormal_findings` | `abnormalFindings.ts` | Pre-canned finding library. | Implemented | Yes | 2026-05-22 |
| 6.5.11 | `pacs_settings` | `pacsSettings.ts` | PACS configuration storage. | Implemented | Yes | 2026-06-05 |
| 6.5.12 | `radiology_workflow` | `radiologyWorkflow.ts` | Workflow automation. | Implemented | Yes | 2026-05-22 |
| 6.5.13 | `ris_monitoring` | `risMonitoring.ts` | RIS monitoring data. | Implemented | No | 2026-05-21 |

---

## 7. AI Functions

| # | AI Function | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|-------------|------------|---------|--------|-------------|------------|-----------|
| 7.1 | **AI Impression Generation** | `/api/smart-radiology/ai-impressions/:studyId` | Generate radiology impressions from DICOM/study data using Gemini. | Implemented | Gemini API, `ai_impressions` | Yes | 2026-06-03 |
| 7.2 | **AI Quality Check** | `/api/smart-radiology/quality-check/:reportDraftId` | Validate reports for L/R mismatch, missing fields, etc. | Implemented | `/api/smart-radiology/quality-check`, `report_quality_checks` | Yes | 2026-05-22 |
| 7.3 | **AI Follow-Up Suggestions** | `/api/smart-radiology/follow-up/:reportDraftId` | Recommend follow-up studies based on findings. | Implemented | `/api/smart-radiology/follow-up`, `follow_up_recommendations` | Yes | 2026-05-22 |
| 7.4 | **AI Translation** | `/api/smart-radiology/translations/:reportDraftId` | Generate bilingual (English/Hindi) patient summaries. | Implemented | `/api/smart-radiology/translations`, `report_translations` | Yes | 2026-05-22 |
| 7.5 | **AI Sonographer Drafts** | `/api/smart-radiology/sonographer-drafts` | Accept tablet workflow drafts from sonographers. | Implemented | `/api/smart-radiology/sonographer-drafts`, `sonographer_drafts` | Yes | 2026-05-22 |
| 7.6 | **USG Measurement Extraction** | `/api/usg-extraction/*` | Extract measurements from DICOM SR, OCR, and AI. | Implemented | `usgExtractor.ts`, `usgMeasurementEngine.ts` | Yes | 2026-06-05 |
| 7.7 | **AI Report Enhancement** | `lib/aiReportEnhancer.ts` | Refine and proofread radiologist drafts. | Implemented | `aiReportEnhancer.ts`, Gemini API | Yes | 2026-05-22 |
| 7.8 | **AI Billing Suggestions** | `/api/smart-radiology/billing-suggestions` | Suggest billable items based on findings. | Implemented | `/api/smart-radiology/*`, billing module | No | 2026-05-22 |
| 7.9 | **AI Prompt Template Engine** | `/api/ai-prompt-templates/*` | Modality-aware prompt generation. | Implemented | `aiPromptTemplates.ts`, `ai_prompt_templates` table | Yes | 2026-06-02 |
| 7.10 | **AI Model Routing** | `/api/ai-model-routes/*` | Route tasks to Gemini/OpenAI/Ollama. | Implemented | `aiModelRoutes.ts`, `ai_model_routes` table | Yes | 2026-06-02 |
| 7.11 | **AI Feedback Loop** | `/api/radiology/pacs-worklist/:id/ai-feedback` | Radiologist feedback on AI drafts (thumbs up/down). | Implemented | `ai_quality_scores` table | Yes | 2026-06-03 |
| 7.12 | **AI Draft Generation** | `/api/internal/radiology/ai-draft` | Internal hook for AI draft generation. | Implemented | `ai_job_queue` table | Yes | 2026-05-11 |
| 7.13 | **Voice Dictation** | `/radiology/voice-dictation` | Voice-to-text for radiology reporting. | Implemented | Web Speech API | Yes | 2026-05-17 |
| 7.14 | **Normal Templates** | `/radiology/normal-templates` | One-click normal report templates for common studies. | Implemented | `radiology_structured_templates` | Yes | 2026-06-05 |

---

## 8. PACS Functions

| # | PACS Function | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|-------------|------------|---------|--------|-------------|------------|-----------|
| 8.1 | **PACS Viewer** | `/pacs` | Browse studies, series, instances; launch Weasis/OHIF. | Implemented | `/api/pacs/*`, Orthanc/Conquest | Yes | 2026-05-26 |
| 8.2 | **DICOM C-FIND Query** | `/api/dicom/nodes/:id/test` | Query remote PACS for studies via C-FIND. | Implemented | `/api/dicom/*`, DIMSE | Yes | 2026-05-17 |
| 8.3 | **DICOM C-MOVE/C-GET Pull** | `/api/dicom/nodes/:id/pull` | Retrieve studies from remote PACS. | Implemented | `dimse-agent.ts`, DICOM nodes | Yes | 2026-05-16 |
| 8.4 | **WADO-URI Proxy** | `/api/pacs/wado` | Retrieve DICOM instances via WADO-URI. | Implemented | `pacs.ts`, WADO | Yes | 2026-05-21 |
| 8.5 | **DICOM Preview** | `/api/pacs/instances/:id/preview` | Generate PNG/JPG preview of DICOM instances. | Implemented | `pacs.ts`, WADO | Yes | 2026-05-21 |
| 8.6 | **PACS Health Check** | `/api/pacs/health` | Check Orthanc connectivity. | Implemented | `/api/pacs/health` | Yes | 2026-05-21 |
| 8.7 | **PACS Configuration** | `/api/pacs/config` | Read PACS settings (URL, viewer type). | Implemented | `/api/pacs/config` | Yes | 2026-05-21 |
| 8.8 | **DICOM Node Management** | `/api/dicom/nodes` | Register, list, and manage DICOM nodes. | Implemented | `dicom.ts`, `dicom_nodes` table | Yes | 2026-05-16 |
| 8.9 | **DICOM Pull Agent** | `dimse-agent.ts` | Background service for DICOM pull from modalities. | Implemented | `dicom-pull-agent/` directory | Yes | 2026-05-11 |
| 8.10 | **DICOM Upload** | `/api/dicom-uploads/*` | Manual DICOM file upload. | Implemented | `dicom-uploads.ts` | Yes | 2026-05-22 |
| 8.11 | **DICOM Viewer** | `/radiology/viewer/:studyInstanceUID` | In-browser DICOM viewer. | Implemented | `DicomViewer.tsx` | Yes | 2026-05-17 |
| 8.12 | **Mobile DICOM Viewer** | `/m/viewer/:studyInstanceUID` | Mobile-optimized DICOM viewer. | Implemented | `MobileViewer.tsx` | Yes | 2026-05-26 |
| 8.13 | **PACS Dashboard** | `/radiology/pacs-dashboard` | PACS operational dashboard (deprecated). | Deprecated | `/api/pacs/*`, `/api/dicom/*` | No | 2026-05-21 |
| 8.14 | **PACS Settings** | `/radiology/pacs-settings` | PACS server configuration. | Implemented | `pacsSettings.ts` | No | 2026-06-05 |
| 8.15 | **DICOM Study Registry** | `/api/dicom/*` | Canonical DICOM study registry. | Implemented | `dicom_studies` table | Yes | 2026-05-21 |
| 8.16 | **DICOM Series & Instances** | `/api/dicom/*` | Series and instance metadata. | Implemented | `dicom_study_series` table | Yes | 2026-05-21 |
| 8.17 | **DICOM Pull Job Monitoring** | `/api/dicom/pull-jobs` | Track DICOM pull jobs. | Implemented | `dicom_pull_jobs` table | Yes | 2026-05-16 |
| 8.18 | **DICOM Node TCP Test** | `/api/dicom/nodes/:id/test` | Test DICOM node connectivity. | Implemented | `tcpProbe` | Yes | 2026-05-24 |
| 8.19 | **DICOM Presets Sync** | `/api/dicom/presets` | Sync DICOM search presets across devices. | Implemented | `dicomStudies.ts` | Yes | 2026-05-17 |
| 8.20 | **PACS Watchdog** | `/radiology/watchdog` | Automated PACS service monitoring. | Implemented | `risMonitoring.ts` | No | 2026-06-05 |
| 8.21 | **DICOM Agent Dashboard** | `/radiology/dicom-agent-dashboard` | Monitor local/remote DICOM agents. | Implemented | `dicomAgent.ts` | No | 2026-05-21 |
| 8.22 | **DICOM Q/R Export** | `/radiology/dicom-qr` | Export Q/R results to CSV/PDF. | Implemented | `DicomQueryRetrieve.tsx` | Yes | 2026-05-17 |
| 8.23 | **DICOM SR Export** | `/api/smart-radiology/sr-export` | Export structured reports back to PACS. | Implemented | `dicom_sr_export_queue` | No | 2026-05-22 |
| 8.24 | **DICOM Key Images** | `/usg/key-images` | Save and display key image frames (deprecated). | Deprecated | `usg_key_images` table | No | 2026-05-22 |

---

## 9. Reporting Functions

| # | Reporting Function | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|-----------------|------------|---------|--------|-------------|------------|-----------|
| 9.1 | **Unified Reporting** | `/radiology/unified-report/:worklistId` | **NEW** — Single smart reporting page for all modalities with embedded OHIF viewer, auto-detect modality, normal templates, and AI draft. | Implemented | `RadiologyReportUnified.tsx` | Yes | 2026-06-05 |
| 9.2 | **Radiology Report Editor** | `/radiology/report/:studyId` | Standalone report editor (deprecated). | Deprecated | `RadiologyReportEditor.tsx` | No | 2026-05-17 |
| 9.3 | **Report Generator** | `/radiology/report-generator` | Template-based report generation (deprecated). | Deprecated | `RadiologyReportGenerator.tsx` | No | 2026-06-03 |
| 9.4 | **Report Verification** | `/api/usg-reports/:id/verify` | Multi-stage verification (preliminary, peer, final). | Implemented | `radiology_report_verifications` | Yes | 2026-05-22 |
| 9.5 | **Report Finalization** | `/api/usg-reports/:id/finalize` | Finalize with hash and lock. | Implemented | `usgReports.ts` | Yes | 2026-05-22 |
| 9.6 | **Report Quality Check** | `/api/usg-reports/:id/quality-check` | Automated QC before finalization. | Implemented | `report_quality_checks` | Yes | 2026-05-22 |
| 9.7 | **Report Template Engine** | `/api/radiology/templates/:testId` | Modality-specific templates. | Implemented | `radiology_structured_templates` | Yes | 2026-05-08 |
| 9.8 | **USG Report Draft** | `/usg/reporting` | USG-specific report with measurements (deprecated). | Deprecated | `UsgReporting.tsx` | No | 2026-05-22 |
| 9.9 | **USG Doppler Report** | `/usg/doppler` | Doppler report with vascular data (deprecated). | Deprecated | `UsgDopplerReporting.tsx` | No | 2026-05-22 |
| 9.10 | **Echo Cardiology Report** | `/echo` | Comprehensive echo report (2D, Doppler, Valves). | Implemented | `EchoCardiology.tsx` | Yes | 2026-06-03 |
| 9.11 | **Fetal Echo Report** | `/fetal-echo` | Fetal echo reporting. | Implemented | `FetalEcho.tsx` | Yes | 2026-06-03 |
| 9.12 | **Fetal USG Level 4 Report** | `/fetal-usg` | Anomaly/growth scan with checklists. | Implemented | `FetalUsgLevel4.tsx` | Yes | 2026-06-03 |
| 9.13 | **Teleradiology Report** | `/teleradiology` | Remote radiologist reporting portal. | Implemented | `TeleradiologyPortal.tsx` | Yes | 2026-05-03 |
| 9.14 | **Report Diff Viewer** | `/radiology/report-diff` | Compare report versions (deprecated). | Deprecated | `ReportDiffViewer.tsx` | No | 2026-05-22 |
| 9.15 | **Report Amendment Tracking** | `smartRadiology.ts` | Track changes after finalization. | Implemented | `report_amendments` | Yes | 2026-05-22 |
| 9.16 | **Report Delivery** | `/api/report-delivery/*` | Deliver reports via email, WhatsApp, portal. | Implemented | `reportDelivery.ts` | Yes | 2026-05-22 |
| 9.17 | **Report Share Links** | `radiologyShareLinks.ts` | Tokenized share links for external viewing. | Implemented | `radiology_share_links` | Yes | 2026-05-22 |
| 9.18 | **Report Voice Dictation** | `/radiology/voice-dictation` | Voice-to-text report drafting. | Implemented | `VoiceDictation.tsx` | Yes | 2026-05-17 |
| 9.19 | **Report Template Versions** | `/radiology/template-versions` | Version history for templates (deprecated). | Deprecated | `TemplateVersions.tsx` | No | 2026-05-22 |
| 9.20 | **Report Peer Review** | `/radiology/peer-review-assignments` | Assignment and tracking of peer review (deprecated). | Deprecated | `PeerReviewAssignments.tsx` | No | 2026-05-22 |
| 9.21 | **Report AI Enhancement** | `lib/aiReportEnhancer.ts` | AI proofreading and refinement. | Implemented | `aiReportEnhancer.ts` | Yes | 2026-05-22 |
| 9.22 | **Report Turnaround Time** | `/radiology/turnaround-times` | TAT analytics per radiologist (deprecated). | Deprecated | `TurnaroundTimeAnalytics.tsx` | No | 2026-05-22 |
| 9.23 | **Report Quality Gates** | `/radiology/quality-gates` | Automated checks before finalization (deprecated). | Deprecated | `ReportQualityGates.tsx` | No | 2026-05-22 |
| 9.24 | **Report Critical Findings** | `/radiology/critical-findings` | Track and notify critical findings. | Implemented | `CriticalFindings.tsx` | Yes | 2026-05-22 |
| 9.25 | **Report Patient Communication** | `/radiology/patient-communication` | Generate patient-friendly summaries (deprecated). | Deprecated | `PatientCommunication.tsx` | No | 2026-05-22 |
| 9.26 | **Report Billing Suggestions** | `/radiology/billing-suggestions` | AI billing code suggestions (deprecated). | Deprecated | `AiBillingSuggestions.tsx` | No | 2026-05-22 |
| 9.27 | **Report PDF Generation** | `/radiology/report-generator` | Generate PDF from report data (deprecated). | Deprecated | `RadiologyReportGenerator.tsx` | No | 2026-06-03 |
| 9.28 | **Report Print Settings** | `lib/billPrintSettings.ts` | Customizable PDF print settings. | Implemented | `billPrintSettings.ts` | Yes | 2026-06-03 |
| 9.29 | **Report AI Draft** | `/api/radiology/pacs-worklist/:id/ai-draft` | AI-generated draft for radiologist review. | Implemented | `radiology_worklist` | Yes | 2026-06-03 |
| 9.30 | **Report Normal Templates** | `/radiology/normal-templates` | One-click normal templates. | Implemented | `NormalReportTemplates.tsx` | Yes | 2026-06-05 |
| 9.31 | **Report AI Auto-Generate** | `/api/usg-reports/auto-generate` | Auto-generate from measurements. | Implemented | `usgReports.ts` | Yes | 2026-05-22 |
| 9.32 | **Report AI Suggest Template** | `/api/usg-reports/suggest-template` | Recommend template by study. | Implemented | `usgReports.ts` | Yes | 2026-05-22 |
| 9.33 | **Report Feedback Loop** | `/radiology/feedback-loop-analytics` | Track radiologist feedback on AI (deprecated). | Deprecated | `FeedbackLoopAnalytics.tsx` | No | 2026-05-22 |
| 9.34 | **Report Training Data Export** | `/radiology/training-data-exports` | Export anonymized data (deprecated). | Deprecated | `TrainingDataExports.tsx` | No | 2026-05-22 |
| 9.35 | **Unified Report Measurements** | `/api/usg-extraction/study/:uid` | Fetch structured measurements for unified report. | Implemented | `usgExtraction.ts` | Yes | 2026-06-05 |

---

## 10. Settings & Configuration

| # | Setting | Route/Page | Purpose | Status | Dependencies | Used Daily | Last Date |
|---|---------|------------|---------|--------|-------------|------------|-----------|
| 10.1 | **PACS Server Config** | `/radiology/pacs-settings` | Conquest/Orthanc URL, AE Titles, ports, viewer. | Implemented | `pacsSettings.ts` | No | 2026-06-05 |
| 10.2 | **DICOM Nodes** | `/radiology/dicom-qr` | External node configuration and Q/R settings. | Implemented | `dicom_nodes` table | No | 2026-05-16 |
| 10.3 | **AI Prompt Templates** | `/radiology/ai-prompt-templates` | Modality-aware prompt presets. | Implemented | `ai_prompt_templates` table | Yes | 2026-06-02 |
| 10.4 | **AI Model Routing** | `/radiology/ai-model-routing` | Task-to-provider routing rules. | Implemented | `ai_model_routes` table | Yes | 2026-06-02 |
| 10.5 | **Modality Management** | `/radiology/modality-management` | CT, MRI, X-Ray, USG device registry. | Implemented | `dicom_nodes` table | No | 2026-05-21 |
| 10.6 | **Teleradiology Settings** | `/teleradiology` | External radiologist settings. | Implemented | `teleradiologyUsers.ts` | No | 2026-05-22 |
| 10.7 | **DICOM Routing Rules** | `/radiology/dicom-agent-dashboard` | Auto-forward rules. | Implemented | `dicom_routing_rules` | No | 2026-05-22 |
| 10.8 | **Radiology Settings Hub** | `/settings/radiology` | Centralized radiology settings. | Implemented | `RadiologySettings.tsx` | Yes | 2026-05-21 |
| 10.9 | **DICOM Preset Sync** | `/radiology/dicom-qr` | Search presets across devices. | Implemented | `dicomStudies.ts` | Yes | 2026-05-17 |
| 10.10 | **Normal Templates** | `/radiology/normal-templates` | Normal template configuration. | Implemented | `radiology_structured_templates` | Yes | 2026-06-05 |
| 10.11 | **AI Reporting Settings** | `/radiology/ai-reporting-settings` | AI report generation config. | Implemented | `ai_model_routes` table | Yes | 2026-06-03 |
| 10.12 | **PACS Watchdog** | `/radiology/watchdog` | Automated monitoring thresholds. | Implemented | `risMonitoring.ts` | No | 2026-06-05 |
| 10.13 | **DICOM Agent** | `/radiology/dicom-agent-dashboard` | Agent monitoring config. | Implemented | `dicomAgent.ts` | No | 2026-05-21 |

---

## 11. Features & Modules

### 11.1 Core Radiology Workflow

| # | Feature | Route/Page | Purpose | Status | Used Daily | Last Date |
|---|---------|------------|---------|--------|------------|-----------|
| 11.1.1 | **RIS Worklist** | `/radiology/worklist` | Study lifecycle tracking. | Implemented | Yes | 2026-06-05 |
| 11.1.2 | **PACS Worklist** | `/api/radiology/pacs-worklist` | PACS-pushed study mirror. | Implemented | Yes | 2026-05-21 |
| 11.1.3 | **Unified Reporting** | `/radiology/unified-report/:worklistId` | Single reporting page for all modalities. | Implemented | Yes | 2026-06-05 |
| 11.1.4 | **AI Report Drafting** | `/api/smart-radiology/ai-impressions` | AI-generated impressions. | Implemented | Yes | 2026-06-03 |
| 11.1.5 | **Voice Dictation** | `/radiology/voice-dictation` | Voice-to-text reporting. | Implemented | Yes | 2026-05-17 |
| 11.1.6 | **Report Verification** | `/api/usg-reports/:id/verify` | Multi-stage verification. | Implemented | Yes | 2026-05-22 |
| 11.1.7 | **Report Finalization** | `/api/usg-reports/:id/finalize` | Hash-locked finalization. | Implemented | Yes | 2026-05-22 |
| 11.1.8 | **Report Quality Check** | `/api/usg-reports/:id/quality-check` | Automated QC. | Implemented | Yes | 2026-05-22 |
| 11.1.9 | **Report Delivery** | `/api/report-delivery/*` | Multi-channel delivery. | Implemented | Yes | 2026-05-22 |
| 11.1.10 | **Report Share Links** | `radiologyShareLinks.ts` | Secure sharing. | Implemented | Yes | 2026-05-22 |
| 11.1.11 | **Radiologist Assignment** | `radiologist_assignment_rules` | Auto-assignment. | Implemented | Yes | 2026-05-21 |
| 11.1.12 | **Priority Rules** | `radiology_priority_rules` | Auto-priority. | Implemented | Yes | 2026-05-21 |
| 11.1.13 | **Workload Tracking** | `radiologist_workloads` | Real-time tracking. | Implemented | Yes | 2026-05-21 |
| 11.1.14 | **TAT Tracking** | `radiology_tat_tracking` | SLA monitoring. | Implemented | Yes | 2026-05-21 |
| 11.1.15 | **Critical Findings** | `radiology_critical_findings` | Alert management. | Implemented | Yes | 2026-05-22 |
| 11.1.16 | **Peer Review** | `radiology_report_verifications` | Multi-stage review (deprecated). | Deprecated | Yes | 2026-05-22 |
| 11.1.17 | **Template Engine** | `radiology_structured_templates` | JSON templates. | Implemented | Yes | 2026-05-21 |
| 11.1.18 | **PDF Generation** | `RadiologyReportGenerator.tsx` | PDF export (deprecated). | Deprecated | Yes | 2026-06-03 |
| 11.1.19 | **Print Settings** | `lib/billPrintSettings.ts` | Customizable printing. | Implemented | Yes | 2026-06-03 |
| 11.1.20 | **Normal Templates** | `RadiologyReportUnified.tsx` | One-click normal templates (built-in). | Implemented | Yes | 2026-06-05 |
| 11.1.21 | **AI Draft Integration** | `RadiologyReportUnified.tsx` | AI draft input + generate button. | Implemented | Yes | 2026-06-05 |
| 11.1.22 | **Measurement Auto-Insert** | `RadiologyReportUnified.tsx` | Click measurements to insert into report. | Implemented | Yes | 2026-06-05 |
| 11.1.23 | **Embedded OHIF Viewer** | `RadiologyReportUnified.tsx` | OHIF iframe embedded in reporting page. | Implemented | Yes | 2026-06-05 |

### 11.2 PACS & DICOM Infrastructure

| # | Feature | Route/Page | Purpose | Status | Used Daily | Last Date |
|---|---------|------------|---------|--------|------------|-----------|
| 11.2.1 | **PACS Viewer** | `/pacs` | Study browsing and viewer launch. | Implemented | Yes | 2026-05-26 |
| 11.2.2 | **DICOM Viewer** | `/radiology/viewer/:studyInstanceUID` | In-browser viewing. | Implemented | Yes | 2026-05-17 |
| 11.2.3 | **Mobile Viewer** | `/m/viewer/:studyInstanceUID` | Mobile viewing. | Implemented | Yes | 2026-05-26 |
| 11.2.4 | **DICOM Query/Retrieve** | `/radiology/dicom-qr` | C-FIND search. | Implemented | Yes | 2026-05-17 |
| 11.2.5 | **DICOM Pull Agent** | `dimse-agent.ts` | Background pulling. | Implemented | Yes | 2026-05-11 |
| 11.2.6 | **DICOM Node Management** | `/api/dicom/nodes` | Node registry. | Implemented | Yes | 2026-05-16 |
| 11.2.7 | **DICOM Upload** | `/api/dicom-uploads/*` | Manual upload. | Implemented | Yes | 2026-05-22 |
| 11.2.8 | **WADO-URI Proxy** | `/api/pacs/wado` | Instance retrieval. | Implemented | Yes | 2026-05-21 |
| 11.2.9 | **DICOM Preview** | `/api/pacs/instances/:id/preview` | PNG/JPG preview. | Implemented | Yes | 2026-05-21 |
| 11.2.10 | **PACS Health** | `/api/pacs/health` | Connectivity check. | Implemented | Yes | 2026-05-21 |
| 11.2.11 | **PACS Config** | `/api/pacs/config` | Settings read. | Implemented | Yes | 2026-05-21 |
| 11.2.12 | **PACS Dashboard** | `/radiology/pacs-dashboard` | Operational dashboard (deprecated). | Deprecated | No | 2026-05-21 |
| 11.2.13 | **PACS Logs** | `/radiology/pacs-logs` | Debugging logs (deprecated). | Deprecated | No | 2026-05-21 |
| 11.2.14 | **Archive Lifecycle** | `/radiology/archive-lifecycle` | Storage management (deprecated). | Deprecated | No | 2026-05-21 |
| 11.2.15 | **Watchdog** | `/radiology/watchdog` | Service monitoring. | Implemented | No | 2026-06-05 |
| 11.2.16 | **MWL Dashboard** | `/radiology/mwl-dashboard` | Worklist scheduling. | Implemented | Yes | 2026-05-12 |
| 11.2.17 | **MWL Manager** | `/radiology/mwl-manager` | Entry management (deprecated). | Deprecated | No | 2026-05-22 |
| 11.2.18 | **HL7 Bridge** | `/radiology/hl7-settings` | RIS integration (deprecated). | Deprecated | No | 2026-05-21 |
| 11.2.19 | **DICOM Routing** | `dicomRoutingRules.ts` | Auto-forward. | Implemented | No | 2026-05-22 |
| 11.2.20 | **DICOM Presets** | `/radiology/dicom-qr` | Search presets. | Implemented | Yes | 2026-05-17 |
| 11.2.21 | **DICOM Study Registry** | `/api/dicom/*` | Study tracking. | Implemented | Yes | 2026-05-21 |
| 11.2.22 | **DICOM Agent** | `/radiology/dicom-agent-dashboard` | Agent monitoring. | Implemented | No | 2026-05-21 |
| 11.2.23 | **DICOM Agent Setup** | `/radiology/agent-setup` | Setup wizard (deprecated). | Deprecated | No | 2026-05-21 |
| 11.2.24 | **DICOM Workflow** | `/api/dicom-workflow/*` | Workflow automation. | Implemented | Yes | 2026-05-17 |
| 11.2.25 | **Hanging Protocols** | `/radiology/hanging-protocols` | Viewer layouts (deprecated). | Deprecated | No | 2026-05-21 |
| 11.2.26 | **PACS Settings Seed** | `lib/db/drizzle/0004_seed_pacs_viewer_defaults.sql` | Default PACS viewer settings seeded. | Implemented | Yes | 2026-06-05 |

### 11.3 USG & Doppler

| # | Feature | Route/Page | Purpose | Status | Used Daily | Last Date |
|---|---------|------------|---------|--------|------------|-----------|
| 11.3.1 | **USG Worklist** | `/usg/worklist` | USG-specific queue (deprecated). | Deprecated | No | 2026-05-22 |
| 11.3.2 | **USG Reporting** | `/usg/reporting` | General USG reports (deprecated). | Deprecated | No | 2026-05-22 |
| 11.3.3 | **USG Doppler** | `/usg/doppler` | Doppler reports (deprecated). | Deprecated | No | 2026-05-22 |
| 11.3.4 | **USG Measurements** | `/usg/measurements/:uid` | Measurement review. | Implemented | Yes | 2026-05-21 |
| 11.3.5 | **USG Critical Alerts** | `/usg/critical` | USG alerts (deprecated). | Deprecated | No | 2026-05-22 |
| 11.3.6 | **USG Key Images** | `/usg/key-images` | Frame gallery (deprecated). | Deprecated | No | 2026-05-22 |
| 11.3.7 | **USG Analytics** | `/usg/analytics` | Throughput metrics (deprecated). | Deprecated | No | 2026-05-22 |
| 11.3.8 | **USG Settings** | `/usg/settings` | Machine profiles (deprecated). | Deprecated | No | 2026-05-22 |
| 11.3.9 | **USG Measurement Extraction** | `usgExtractor.ts` | AI/OCR extraction. | Implemented | Yes | 2026-05-21 |
| 11.3.10 | **USG Report Templates** | `usgReportTemplates.ts` | Abdomen, Pelvis, Fetal. | Implemented | Yes | 2026-05-22 |
| 11.3.11 | **USG Quality Check** | `/api/usg-reports/:id/quality-check` | Automated QC. | Implemented | Yes | 2026-05-22 |
| 11.3.12 | **Fetal USG Level 4** | `/fetal-usg` | Anomaly scan. | Implemented | Yes | 2026-06-03 |
| 11.3.13 | **Echo Cardiology** | `/echo` | Echo reporting. | Implemented | Yes | 2026-06-03 |
| 11.3.14 | **Fetal Echo** | `/fetal-echo` | Fetal echo. | Implemented | Yes | 2026-06-03 |

### 11.4 AI & Smart Platform

| # | Feature | Route/Page | Purpose | Status | Used Daily | Last Date |
|---|---------|------------|---------|--------|------------|-----------|
| 11.4.1 | **AI Impressions** | `/api/smart-radiology/ai-impressions` | Generate impressions. | Implemented | Yes | 2026-06-03 |
| 11.4.2 | **AI Quality Check** | `/api/smart-radiology/quality-check` | Validate reports. | Implemented | Yes | 2026-05-22 |
| 11.4.3 | **AI Follow-Up** | `/api/smart-radiology/follow-up` | Recommend follow-ups. | Implemented | Yes | 2026-05-22 |
| 11.4.4 | **AI Translation** | `/api/smart-radiology/translations` | Bilingual summaries. | Implemented | Yes | 2026-05-22 |
| 11.4.5 | **AI Sonographer Drafts** | `/api/smart-radiology/sonographer-drafts` | Tablet drafts. | Implemented | Yes | 2026-05-22 |
| 11.4.6 | **AI Model Routing** | `/api/ai-model-routes/*` | Provider routing. | Implemented | Yes | 2026-06-02 |
| 11.4.7 | **AI Prompt Templates** | `/api/ai-prompt-templates/*` | Prompt presets. | Implemented | Yes | 2026-06-02 |
| 11.4.8 | **AI Feedback Loop** | `/api/radiology/pacs-worklist/:id/ai-feedback` | Feedback collection. | Implemented | Yes | 2026-06-03 |
| 11.4.9 | **AI Audit Log** | `/radiology/ai-audit-log` | Audit trail (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.10 | **AI Quality Scores** | `/radiology/ai-quality-scores` | Accuracy metrics (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.11 | **AI Prompt Effectiveness** | `/radiology/ai-prompt-effectiveness` | Performance analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.12 | **AI DICOM Findings** | `/radiology/ai-dicom-findings` | Image analysis (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.13 | **RAG Vector Store** | `/radiology/rag-vector-store` | Semantic search DB (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.14 | **AI Search & Retrieval** | `/radiology/ai-search-retrieval` | Semantic search (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.15 | **AI Anomaly Detection** | `/radiology/anomaly-alerts` | Workflow anomaly (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.16 | **AI Pipeline** | `/radiology/ai-pipeline` | Orchestration (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.17 | **AI Report Enhancement** | `lib/aiReportEnhancer.ts` | Proofreading. | Implemented | Yes | 2026-05-22 |
| 11.4.18 | **AI Template Learning** | `smartRadiology.ts` | Pattern learning (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.19 | **AI Normal Templates** | `/radiology/normal-templates` | One-click normal. | Implemented | Yes | 2026-06-05 |
| 11.4.20 | **AI Billing Suggestions** | `/radiology/billing-suggestions` | Billing codes (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.21 | **AI Inference Settings** | `/radiology/ai-inference-settings` | Inference config (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.22 | **AI Provider Health** | `/radiology/provider-health` | API status (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.23 | **AI Extraction Review** | `/radiology/ai-extraction-review` | Human review. | Implemented | Yes | 2026-05-22 |
| 11.4.24 | **AI SR Export** | `/api/smart-radiology/sr-export` | Structured report export (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.25 | **AI Voice Dictation** | `/radiology/voice-dictation` | Voice-to-text. | Implemented | Yes | 2026-05-17 |
| 11.4.26 | **AI Patient Communication** | `/radiology/patient-communication` | Patient summaries (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.27 | **AI Training Export** | `/radiology/training-data-exports` | Data export (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.28 | **AI Feedback Analytics** | `/radiology/feedback-loop-analytics` | Feedback analytics (deprecated). | Deprecated | No | 2026-05-22 |
| 11.4.29 | **AI Template Versions** | `/radiology/template-versions` | Version history (deprecated). | Deprecated | No | 2026-05-22 |

### 11.5 Teleradiology

| # | Feature | Route/Page | Purpose | Status | Used Daily | Last Date |
|---|---------|------------|---------|--------|------------|-----------|
| 11.5.1 | **Teleradiology Portal** | `/teleradiology` | External radiologist access. | Implemented | Yes | 2026-05-03 |
| 11.5.2 | **Teleradiology Backend** | `/api/teleradiology/*` | Study assignment. | Implemented | Yes | 2026-05-22 |
| 11.5.3 | **Teleradiology Users** | `/api/teleradiology-portal/*` | User management. | Implemented | Yes | 2026-05-03 |
| 11.5.4 | **Teleradiology Sites** | `teleradiology_sites` | Remote site registry. | Implemented | Yes | 2026-05-22 |
| 11.5.5 | **Multi-Site Worklist** | `radiology_multi_site_worklist` | Cross-site sync. | Implemented | Yes | 2026-05-22 |

### 11.6 Management & Admin

| # | Feature | Route/Page | Purpose | Status | Used Daily | Last Date |
|---|---------|------------|---------|--------|------------|-----------|
| 11.6.1 | **Command Center** | `/radiology/command-center` | Real-time monitoring (deprecated). | Deprecated | No | 2026-05-22 |
| 11.6.2 | **Acquisition Gateway** | `/radiology/acquisition-gateway` | Incoming studies (deprecated). | Deprecated | No | 2026-05-22 |
| 11.6.3 | **Storage Lifecycle** | `/radiology/storage-lifecycle` | Tier management (deprecated). | Deprecated | No | 2026-05-22 |
| 11.6.4 | **Critical Alerts Manager** | `/radiology/critical-alerts` | Alert management (deprecated). | Deprecated | No | 2026-05-22 |
| 11.6.5 | **Productivity Tools** | `/radiology/productivity-tools` | Shortcuts and macros (deprecated). | Deprecated | No | 2026-05-22 |
| 11.6.6 | **RIS Monitoring** | `/api/ris-monitoring/*` | RIS health. | Implemented | No | 2026-05-21 |
| 11.6.7 | **Enterprise Analytics** | `/api/pacs-enterprise/*` | Performance stats. | Implemented | No | 2026-05-21 |
| 11.6.8 | **Radiology Settings Hub** | `/settings/radiology` | Centralized config. | Implemented | Yes | 2026-05-21 |
| 11.6.9 | **DICOM Nodes** | `/dicom-nodes` | Node management. | Implemented | No | 2026-05-16 |
| 11.6.10 | **PACS Enterprise** | `/api/pacs-enterprise/*` | Enterprise features. | Implemented | No | 2026-05-21 |
| 11.6.11 | **PACS Settings** | `/radiology/pacs-settings` | Server configuration. | Implemented | No | 2026-06-05 |
| 11.6.12 | **Modality Management** | `/radiology/modality-management` | Device registry. | Implemented | No | 2026-05-21 |
| 11.6.13 | **DICOM Agent** | `/radiology/dicom-agent-dashboard` | Agent monitoring. | Implemented | No | 2026-05-21 |
| 11.6.14 | **Watchdog** | `/radiology/watchdog` | Service monitoring. | Implemented | No | 2026-06-05 |

---

## 12. Summary Statistics

| Metric | Count |
|--------|-------|
| **Total Menus** | 3 |
| **Total Submenus** | 58 |
| **Total Routes/Pages** | 77 |
| **Total Components** | 76 |
| **Total API Routes** | 53 |
| **Total Database Tables** | 63 |
| **Total AI Functions** | 14 |
| **Total PACS Functions** | 24 |
| **Total Reporting Functions** | 35 |
| **Total Settings** | 13 |
| **Total Features** | 78 |
| **Implemented** | 425 |
| **Not Yet Implemented** | 0 |
| **Daily Used** | ~90 |
| **Admin/Owner Only** | ~18 |
| **Deprecated / Consolidated** | ~42 |
| **Last Major Update** | 2026-06-05 |
| **First Implementation** | 2026-04-08 |

---

## File Locations

### Key Backend Files
- `artifacts/api-server/src/routes/radiology.ts` — Core RIS routes
- `artifacts/api-server/src/routes/internal-radiology.ts` — Internal hooks (worklist, ai-draft)
- `artifacts/api-server/src/routes/dicom.ts` — DICOM node management
- `artifacts/api-server/src/routes/pacs.ts` — PACS proxy
- `artifacts/api-server/src/routes/usgReports.ts` — USG reporting
- `artifacts/api-server/src/routes/usgExtraction.ts` — **USG measurement extraction** (fixed for unified report)
- `artifacts/api-server/src/routes/smartRadiology.ts` — AI functions
- `artifacts/api-server/src/routes/radiologyWorkflow.ts` — Workflow automation
- `artifacts/api-server/src/routes/echoCardiology.ts` — Echo cardiology
- `artifacts/api-server/src/routes/fetalUsgLevel4.ts` — Fetal USG
- `artifacts/api-server/src/routes/usgDoppler.ts` — Doppler
- `artifacts/api-server/src/routes/dicomWorkflow.ts` — DICOM workflow
- `artifacts/api-server/src/routes/teleradiology.ts` — Teleradiology
- `artifacts/api-server/src/lib/dicomConnectors.ts` — DICOM connector abstraction
- `artifacts/api-server/src/lib/usgExtractor.ts` — USG AI extraction
- `artifacts/api-server/src/lib/usgMeasurementEngine.ts` — Measurement engine
- `artifacts/api-server/src/lib/usgReportTemplates.ts` — USG templates
- `artifacts/api-server/src/lib/aiReportEnhancer.ts` — AI report enhancement
- `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts` — DIMSE agent
- `lib/db/drizzle/0004_seed_pacs_viewer_defaults.sql` — **PACS viewer defaults seed**

### Key Frontend Files
- `artifacts/diagnostic-erp/src/components/Layout.tsx` — Sidebar navigation (consolidated)
- `artifacts/diagnostic-erp/src/App.tsx` — Route definitions
- `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx` — Worklist
- `artifacts/diagnostic-erp/src/pages/RadiologyReportUnified.tsx` — **NEW Unified reporting page**
- `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx` — Reporting workspace (deprecated)
- `artifacts/diagnostic-erp/src/pages/RadiologyReportEditor.tsx` — Report editor (deprecated)
- `artifacts/diagnostic-erp/src/pages/RadiologyReportGenerator.tsx` — Report generator (deprecated)
- `artifacts/diagnostic-erp/src/pages/PACS.tsx` — PACS viewer
- `artifacts/diagnostic-erp/src/pages/DicomQueryRetrieve.tsx` — DICOM Q/R
- `artifacts/diagnostic-erp/src/pages/DicomViewer.tsx` — DICOM viewer
- `artifacts/diagnostic-erp/src/pages/EchoCardiology.tsx` — Echo cardiology
- `artifacts/diagnostic-erp/src/pages/FetalUsgLevel4.tsx` — Fetal USG
- `artifacts/diagnostic-erp/src/pages/UsgMeasurementReview.tsx` — Measurement review
- `artifacts/diagnostic-erp/src/pages/TeleradiologyPortal.tsx` — Teleradiology
- `artifacts/diagnostic-erp/src/pages/RadiologySettings.tsx` — Settings hub
- `artifacts/diagnostic-erp/src/components/smartRadiology/` — AI components

### Key Schema Files
- `lib/db/src/schema/radiology.ts` — Core radiology
- `lib/db/src/schema/radiologyWorklist.ts` — Worklist
- `lib/db/src/schema/radiologyWorkflow.ts` — Workflow
- `lib/db/src/schema/dicom.ts` — DICOM nodes
- `lib/db/src/schema/dicomStudies.ts` — DICOM studies
- `lib/db/src/schema/usgMeasurements.ts` — USG measurements
- `lib/db/src/schema/smartRadiology.ts` — AI features
- `lib/db/src/schema/fetalUsgLevel4.ts` — Fetal USG
- `lib/db/src/schema/echoCardiology.ts` — Echo cardiology
- `lib/db/src/schema/pacsSettings.ts` — PACS settings
- `lib/db/src/schema/aiModelRoutes.ts` — AI routing
- `lib/db/src/schema/aiPromptTemplates.ts` — AI prompts
- `lib/db/src/schema/aiQualityScores.ts` — AI quality
- `lib/db/src/schema/anomalyAlerts.ts` — Anomaly alerts
- `lib/db/src/schema/turnaroundTimes.ts` — TAT
- `lib/db/src/schema/structuredReportTemplates.ts` — Templates
- `lib/db/src/schema/abnormalFindings.ts` — Findings library
- `lib/db/src/schema/radiologyShareLinks.ts` — Share links
- `lib/db/src/schema/teleradiologyUsers.ts` — Teleradiology
- `lib/db/src/schema/enterpriseRadiology.ts` — Enterprise

---

*End of Radiology Module Inventory*
