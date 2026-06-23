# Feature Inventory — Care Diagnostics ERP
**Version:** 2.0 (June 2026) | **Scope:** Complete feature-by-feature audit

> For every feature: Location, Status, Used?, Legacy?, Duplicate?, Recommended Action.

**Status Legend:**
- ✅ **Active** — Feature is complete and in production use
- ⚠️ **Partial** — Feature exists but is incomplete or partially wired
- 🔴 **Broken** — Feature exists but is known to not work correctly
- 🏚️ **Legacy** — Feature exists but is superseded by a newer implementation
- 🧪 **Experimental** — Feature exists but not ready for production
- 💀 **Dead** — Code exists but is unreachable or unused

---

## MODULE 1: PATIENT MANAGEMENT

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Patient Registration | `patients.ts`, `Register.tsx` | ✅ Active | Yes | No | No | Maintain |
| Patient Search (name/code/phone) | `Patients.tsx` | ✅ Active | Yes | No | No | Maintain |
| Patient Profile & History | `PatientDetail.tsx` | ✅ Active | Yes | No | No | Maintain |
| Patient Unique ID (P00001) | `patients.ts` → `patient_counter` | ✅ Active | Yes | No | No | Maintain |
| Online Booking (public) | `public-booking.ts`, `clinic-site` | ✅ Active | Yes | No | No | Maintain |
| Walk-in Registration | `Register.tsx` | ✅ Active | Yes | No | No | Maintain |
| Appointment Scheduling | `appointments.ts`, `Appointments.tsx` | ✅ Active | Yes | No | No | Maintain |
| Kiosk Self-Registration | `kiosk.ts`, `Kiosk.tsx` | ⚠️ Partial | Limited | No | No | Complete kiosk hardware integration |
| Patient Portal (self-service) | `portal.ts`, `Portal.tsx` | ⚠️ Partial | Limited | No | No | Expand patient-facing features |
| Barcode Label Generation | `barcode-resolver.ts` | ✅ Active | Yes | No | No | Maintain |
| Queue Token Assignment | `tokens.ts`, `Queue.tsx` | ✅ Active | Yes | No | No | Maintain |
| Queue Display Screen | `display.ts`, `Display.tsx` | ✅ Active | Yes | No | No | Maintain |
| Patient Communication (WhatsApp) | `PatientCommunication.tsx` | ⚠️ Partial | Yes | No | No | Test all WhatsApp providers |
| Receipt Verification | `verify.ts`, `VerifyReceipt.tsx` | ✅ Active | Yes | No | No | Maintain |

---

## MODULE 2: BILLING & PAYMENTS

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Bill Creation | `bills.ts`, `BillingDesk.tsx` | ✅ Active | Yes | No | No | Maintain |
| Bill Detail View | `BillDetail.tsx` | ✅ Active | Yes | No | No | Maintain |
| Test/Package Selection | `BillingDesk.tsx`, `packages.ts` | ✅ Active | Yes | No | No | Maintain |
| Discount Management | `discounts.ts`, `Discounts.tsx` | ✅ Active | Yes | No | No | Maintain |
| Discount Override (admin PIN) | `bills.ts` | ✅ Active | Yes | No | No | Maintain |
| Payment Logging (cash/UPI/card) | `payments.ts` (implicit) | ✅ Active | Yes | No | No | Maintain |
| Bill Editing & Audit Trail | `bills.ts`, `bill_audits` table | ✅ Active | Yes | No | No | Maintain |
| Receipt Printing | `BillingDesk.tsx` | ✅ Active | Yes | No | No | Maintain |
| Dues Management | `Dues.tsx` | ✅ Active | Yes | No | No | Maintain |
| Day Close Procedure | `day-close.ts`, `DayClose.tsx` | ✅ Active | Yes | No | No | Maintain |
| Daily Summary Email | `cron.ts → fireDailySummary()` | ✅ Active | Yes | No | No | Maintain |
| Health Packages | `packages.ts`, `Packages.tsx` | ✅ Active | Yes | No | No | Maintain |
| VIP Surcharge | `bills.ts` (percentage from settings) | ✅ Active | Yes | No | No | Maintain |
| Bill Number Generation | `generateBillNumber(ledgerId)` | ✅ Active | Yes | No | No | Maintain |
| `BillingDesk.bak.tsx` | `artifacts/diagnostic-erp/src/pages/` | 💀 Dead | No | Yes | Yes (BillingDesk.tsx) | **Delete** |

---

## MODULE 3: LABORATORY

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Sample Collection & Tracking | `samples.ts`, `Samples.tsx` | ✅ Active | Yes | No | No | Maintain |
| Lab Result Entry | (via orders/tests workflow) | ✅ Active | Yes | No | No | Maintain |
| Abnormal Findings Flagging | `abnormal-findings.ts` | ✅ Active | Yes | No | No | Maintain |
| Test Catalog Management | `tests.ts`, `Tests.tsx` | ✅ Active | Yes | No | No | Maintain |
| Test Categories | `testCategories.ts` | ✅ Active | Yes | No | No | Maintain |
| Outsourced Lab Management | `outsourced-labs.ts`, `OutsourcedLabs.tsx` | ✅ Active | Yes | No | No | Maintain |
| Outsource Cost Report | `OutsourcedCostReport.tsx` | ✅ Active | Yes | No | No | Maintain |
| Outsource Reconciliation | `OutsourceReconciliation.tsx` | ✅ Active | Yes | No | No | Maintain |
| Outsource Rate Cards | `OutsourceRateCards.tsx` | ✅ Active | Yes | No | No | Maintain |

---

## MODULE 4: RADIOLOGY — CORE

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Radiology Worklist | `radiology.ts`, `RadiologyWorklist.tsx` | ✅ Active | Yes | No | No | Maintain |
| Command Center View | `RadiologyCommandCenter.tsx` | ✅ Active | Yes | No | No | Maintain |
| Study Claiming (Technician) | `radiologyWorkflow.ts` | ✅ Active | Yes | No | No | Maintain |
| Study Locking (Radiologist) | `radiology.ts` | ✅ Active | Yes | No | No | Maintain |
| Report Editor | `RadiologyReportEditor.tsx` | ✅ Active | Yes | No | No | Maintain |
| Report Generator | `RadiologyReportGenerator.tsx` | ✅ Active | Yes | No | No | Maintain |
| Unified Reporting Workspace | `RadiologyReportingWorkspace.tsx` | ✅ Active | Yes | No | Partial overlap w/ Editor | Consolidate eventually |
| Report Finalization & Lock | `radiology.ts` | ✅ Active | Yes | No | No | Maintain |
| Report PDF Generation | `radiology-report-generator.ts` + Playwright | ✅ Active | Yes | No | No | Maintain |
| Report Delivery | `reportDelivery.ts`, `ReportDelivery.tsx` | ✅ Active | Yes | No | No | Maintain |
| Report QR Code Verification | `verify.ts` | ✅ Active | Yes | No | No | Maintain |
| Report Templates | `report-templates.ts`, `ReportTemplates.tsx` | ✅ Active | Yes | No | No | Maintain |
| Structured Report Templates | `structuredReportTemplates.ts` | ✅ Active | Yes | No | No | Maintain |
| Template Versioning | `TemplateVersions.tsx` | ✅ Active | Yes | No | No | Maintain |
| Normal Report Templates | `NormalReportTemplates.tsx` | ✅ Active | Yes | No | No | Maintain |
| Technician Workflow | `TechnicianWorkflow.tsx` | ✅ Active | Yes | No | No | Maintain |
| Scan Station | `ScanStation.tsx` | ✅ Active | Yes | No | No | Maintain |
| `RadiologyLegacy.tsx` | `artifacts/diagnostic-erp/src/pages/` | 🏚️ Legacy | No | Yes | Yes (RadiologyReportEditor) | **Remove when stable** |

---

## MODULE 5: RADIOLOGY — AI TOOLS

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| AI Draft (Ollama local) | `radiologyOllama.ts` | ✅ Active | Yes | No | No | Maintain |
| AI Draft (Gemini cloud) | `ai.ts`, `aiReporting.ts` | ✅ Active | Yes | No | No | Maintain |
| AI Copilot | `radiologyCopilot.ts` | ✅ Active | Yes | No | No | Maintain |
| Brain Intelligence (structured) | `radiologyBrainIntelligence.ts` | ✅ Active | Yes | No | No | Maintain |
| Spine Intelligence (structured) | `radiologySpineIntelligence.ts` | ✅ Active | Yes | No | No | Maintain |
| Tumor Follow-up Tracker | `radiologyTumorFollowup.ts` | ⚠️ Partial | Limited | No | No | Expand oncology workflow |
| Lesion Tracker | `radiologyLesions.ts` | ⚠️ Partial | Limited | No | No | Tie to OHIF measurements |
| Smart Findings (Chocolate Box) | `radiologySmartFindings.ts` | ✅ Active | Yes | No | No | Maintain |
| Radiologist Memory Store | `radiologyMemory.ts` | ✅ Active | Yes | No | No | Maintain |
| Knowledge Base | `radiologyKnowledge.ts` | ⚠️ Partial | Limited | No | No | Build content |
| Radiologist Snippets | `radiologySnippets.ts` | ✅ Active | Yes | No | No | Maintain |
| AI Annotations | `radiologyAnnotations.ts` | ⚠️ Partial | Limited | No | No | Wire to OHIF |
| Smart Radiology Engine | `smartRadiology.ts` | ✅ Active | Yes | No | No | Maintain |
| Voice Dictation | `VoiceDictation.tsx` | ⚠️ Partial | Limited | No | No | Complete browser speech API |
| Radiologist Favorites (findings) | `radiologySmartFindings.ts` | ✅ Active | Yes | No | No | Maintain |
| Radiologist Macros | `radiologySnippets.ts` | ✅ Active | Yes | No | No | Maintain |
| Favorite Impressions | `radiologySmartFindings.ts` | ✅ Active | Yes | No | No | Maintain |
| Favorite Templates | `structuredReportTemplates.ts` | ✅ Active | Yes | No | No | Maintain |
| AI Prompt Library | `aiPromptLibrary.ts` | ✅ Active | Yes | No | No | Maintain |
| AI Prompt Templates | `aiPromptTemplates.ts` | ✅ Active | Yes | No | No | Maintain |
| AI Comparison Workspace | `AiComparisonWorkspace.tsx` | 🧪 Experimental | Limited | No | No | Evaluate utility |
| AI Quality Scores | `AiQualityScores.tsx` | 🧪 Experimental | No | No | No | Evaluate utility |
| Feedback Loop Analytics | `FeedbackLoopAnalytics.tsx` | 🧪 Experimental | No | No | No | Evaluate utility |
| RAG Vector Store | `RagVectorStore.tsx` | 🧪 Experimental | No | No | No | Consider removing if unused |
| Training Data Exports | `TrainingDataExports.tsx` | 🧪 Experimental | No | No | No | Evaluate utility |
| Missed Finding Detector | `MissedFindingDetector.tsx` | 🧪 Experimental | No | No | No | Evaluate utility |
| Image Review Assistant | `ImageReviewAssistant.tsx` | 🧪 Experimental | No | No | No | Evaluate utility |

---

## MODULE 6: PACS & DICOM

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Conquest PACS Lua Hook | `conquest/erp_notify.lua` + `internal-radiology.ts` | ✅ Active | Yes | No | No | Maintain |
| Orthanc PACS Integration | `pacs.ts`, `pacsEnterprise.ts` | ✅ Active | Yes | No | No | Maintain |
| DICOMweb Proxy (WADO) | `pacs.ts` (Orthanc proxy) | ✅ Active | Yes | No | No | Maintain |
| OHIF Viewer | Docker container | ✅ Active | Yes | No | No | Maintain |
| Weasis Viewer (local) | Windows local install | ✅ Active | Yes | No | No | Maintain |
| Embedded DICOM Viewer | `DicomViewer.tsx` | ✅ Active | Yes | No | No | Maintain |
| Mobile DICOM Viewer | `MobileViewer.tsx` | ⚠️ Partial | Limited | No | No | Optimize for mobile |
| PACS Archive (PDF→DICOM) | `lib/pacsArchive.ts` | ✅ Active | Yes | No | No | Maintain |
| PACS Dashboard | `PacsDashboard.tsx` | ✅ Active | Yes | No | No | Maintain |
| PACS Logs | `PacsLogs.tsx` | ✅ Active | Yes | No | No | Maintain |
| PACS Watchdog | `PacsWatchdogDashboard.tsx` | ✅ Active | Yes | No | No | Maintain |
| Archive Lifecycle | `PacsArchiveLifecycle.tsx` | ✅ Active | Yes | No | No | Maintain |
| DICOM Auto-Pull (cron) | `cron.ts → scheduleDicomAutoPull()` | ✅ Active | Yes | No | No | Maintain |
| In-Process DIMSE Agent | `services/dicom-pull-agent/dimse-agent.ts` | ✅ Active | Opt-in | No | No | Enable via `ENABLE_DICOM_PULL_AGENT=1` |
| Legacy External DICOM Agent | `dicom-pull-agent/` (root folder) | 🏚️ Legacy | No | Yes | Yes (dimse-agent) | **Retire** |
| DICOM Node Configuration | `DicomNodes.tsx` | ✅ Active | Yes | No | No | Maintain |
| DICOM Query/Retrieve | `DicomQueryRetrieve.tsx` | ✅ Active | Yes | No | No | Maintain |
| DICOM Study Manager | `dicomStudyManager.ts` | ✅ Active | Yes | No | No | Maintain |
| Hanging Protocols | `HangingProtocols.tsx` | ⚠️ Partial | Limited | No | No | Wire to OHIF config |
| Modality Worklist (MWL) | `MwlDashboard.tsx`, `MwlManager.tsx` | ✅ Active | Yes | No | No | Maintain |
| HL7 Integration | `hl7.ts`, `Hl7Settings.tsx` | ⚠️ Partial | No | No | No | Evaluate if needed |
| RIS Monitoring | `risMonitoring.ts` | ⚠️ Partial | Limited | No | No | Expand |

---

## MODULE 7: USG / ULTRASOUND

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| USG Reporting | `usgReports.ts`, `UsgReporting.tsx` | ✅ Active | Yes | No | No | Maintain |
| USG Worklist | `UsgWorklist.tsx` | ✅ Active | Yes | No | No | Maintain |
| USG Analytics | `usgAnalytics.ts`, `UsgAnalytics.tsx` | ✅ Active | Yes | No | No | Maintain |
| Doppler Reporting | `usgDoppler.ts`, `UsgDoppler.tsx` | ✅ Active | Yes | No | No | Maintain |
| Critical USG Alerts | `usgCriticalAlerts.ts` | ✅ Active | Yes | No | No | Maintain |
| USG Measurement Extraction (AI) | `usgExtraction.ts`, `lib/usgExtractor.ts` | ✅ Active | Yes | No | No | Maintain |
| USG Key Images Gallery | `UsgKeyImagesGallery.tsx` | ✅ Active | Yes | No | No | Maintain |
| USG Measurement Review | `UsgMeasurementReview.tsx` | ✅ Active | Yes | No | No | Maintain |
| Echocardiography Reports | `echoCardiology.ts`, `EchoCardiology.tsx` | ✅ Active | Yes | No | No | Maintain |
| Fetal Echocardiography | `FetalEcho.tsx` | ✅ Active | Yes | No | No | Maintain |
| Fetal USG Level-4 | `fetalUsgLevel4.ts`, `FetalUsgLevel4.tsx` | ✅ Active | Yes | No | No | Maintain |
| Form-F (Obstetric Regulatory) | `form-f.ts`, `FormF.tsx` | ✅ Active | Yes | No | No | Maintain (legal requirement) |

---

## MODULE 8: TEACHING FILES & PEER REVIEW

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Teaching Case Library | `teachingCases.ts`, `TeachingFiles.tsx` | ✅ Active | Yes | No | No | Maintain |
| Case Collections | `TeachingCaseCollections.tsx` | ✅ Active | Yes | No | No | Maintain |
| Favorite Cases | `TeachingFavorites.tsx` | ✅ Active | Yes | No | No | Maintain |
| Teaching Mode | `TeachingMode.tsx` | ✅ Active | Yes | No | No | Maintain |
| AI Teaching Assistant | `TeachingAIAssistant.tsx` | 🧪 Experimental | Limited | No | No | Evaluate |
| Presentation Mode | `TeachingPresentationMode.tsx` | 🧪 Experimental | No | No | No | Evaluate |
| Research Mode | `TeachingResearchMode.tsx` | 🧪 Experimental | No | No | No | Evaluate |
| Teaching Analytics | `TeachingAnalytics.tsx` | ⚠️ Partial | No | No | No | Build metrics |
| Peer Review Assignments | `peerReview.ts`, `PeerReviewAssignments.tsx` | ✅ Active | Yes | No | No | Maintain |
| Critical Findings Manager | `CriticalFindings.tsx` | ✅ Active | Yes | No | No | Maintain |
| Critical Alerts | `CriticalAlertsManager.tsx` | ✅ Active | Yes | No | No | Maintain |

---

## MODULE 9: TELERADIOLOGY

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Teleradiology Portal | `teleradiologyPortal.ts`, `TeleradiologyPortal.tsx` | ✅ Active | Yes | No | No | Maintain |
| Teleradiology Routing | `teleradiology.ts` | ✅ Active | Yes | No | No | Maintain |
| Radiologist Assignment | `lib/radiologistAssignment.ts` | ✅ Active | Yes | No | No | Maintain |
| Study Priority Engine | `lib/studyPriorityEngine.ts` | ✅ Active | Yes | No | No | Maintain |
| TAT Tracker | `lib/tatTracker.ts`, `TurnaroundTimeAnalytics.tsx` | ✅ Active | Yes | No | No | Maintain |
| Multi-Site Worklist | `lib/multiSiteWorklist.ts` | ⚠️ Partial | Limited | No | No | Expand for multi-branch |

---

## MODULE 10: ACCOUNTING & FINANCE

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Accounting Module | `accounting.ts`, `Accounting.tsx` | ✅ Active | Yes | No | No | Maintain |
| Ledger Management | `ledgers.ts` | ✅ Active | Yes | No | No | Maintain |
| Expense Tracking | `expenses.ts`, `Expenses.tsx` | ✅ Active | Yes | No | No | Maintain |
| Day Close | `day-close.ts`, `DayClose.tsx` | ✅ Active | Yes | No | No | Maintain |
| Doctor Ledger | `doctor-ledger.ts`, (super-admin portal) | ✅ Active | Yes | No | No | Maintain |
| Doctor Commission Rules | `commission.ts` | ✅ Active | Yes | No | No | Maintain |
| Month-End Commission Email | `cron.ts → fireMonthEndCommission()` | ✅ Active | Yes | No | No | Maintain |
| Books Sanity Check | `books-sanity.ts`, `BooksSanity.tsx` | ✅ Active | Yes | No | No | Maintain |
| Monthly Money-Trail Audit (auto) | `cron.ts → fireMonthlyAudit()` | ✅ Active | Yes | No | No | Maintain |
| Referral Management | `Referrals.tsx` | ✅ Active | Yes | No | No | Maintain |

---

## MODULE 11: BANKING

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Bank Account Management | `banking.ts`, `Banking.tsx` | ✅ Active | Yes | No | No | Maintain |
| Bank Statement Auto-Sync | `cron.ts → scheduleBankingAutoSync()` | ✅ Active | Yes | No | No | Maintain |
| Auto-Reconciliation Engine | `services/banking/ReconciliationEngine.ts` | ✅ Active | Yes | No | No | Maintain |
| Fraud Detection Engine | `services/banking/FraudDetectionEngine.ts` | ✅ Active | Yes | No | No | Maintain |
| ICICI Bank Provider | `services/banking/ICICIBankProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| HDFC Bank Provider | `services/banking/HDFCBankProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Axis Bank Provider | `services/banking/AxisBankProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| SBI Bank Provider | `services/banking/SBIBankProvider.ts` | ⚠️ Partial | No | No | No | Verify SBI API availability |
| Kotak Bank Provider | `services/banking/KotakBankProvider.ts` | ⚠️ Partial | No | No | No | Verify Kotak API |
| PhonePe Bank Provider | `services/banking/PhonePeProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| BharatPe Bank Provider | `services/banking/BharatPeProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Cashfree Bank Provider | `services/banking/CashfreeProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Mock Bank Provider | `services/banking/MockBankProvider.ts` | 🧪 Testing | Dev | No | No | Keep for testing |

---

## MODULE 12: PAYMENT GATEWAYS (ONLINE BOOKING)

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Payment Engine (orchestrator) | `lib/payments/PaymentEngine.ts` | ✅ Active | Yes | No | No | Maintain |
| ICICI Orange Pay | `lib/payments/IciciPaymentProvider.ts` | ✅ Active | Yes | No | No | Primary gateway — maintain |
| PhonePe | `lib/payments/PhonePePaymentProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Razorpay | `lib/payments/RazorpayPaymentProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| PayU | `lib/payments/PayUPaymentProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| BharatPe | `lib/payments/BharatPePaymentProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Cashfree | `lib/payments/CashfreePaymentProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| HDFC SmartHub | `lib/payments/HdfcPaymentProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Payment Callback Webhooks | `public-booking.ts` | ✅ Active | Yes | No | No | Maintain |
| Online Booking Auto-Confirm | `public-booking.ts → confirmBookingInternal()` | ✅ Active | Yes | No | No | Maintain |

---

## MODULE 13: COMMUNICATION

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| WhatsApp Notification (send) | `whatsapp.ts`, `WhatsAppService.ts` | ✅ Active | Yes | No | No | Maintain |
| WhatsApp Chatbot | `waChatbot.ts`, `WhatsAppChatbot.tsx` | ⚠️ Partial | Limited | No | No | Expand chatbot flows |
| Meta WhatsApp Cloud | `services/whatsapp/MetaWhatsAppCloudProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Twilio WhatsApp | `services/whatsapp/TwilioWhatsAppProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| WATI Provider | `services/whatsapp/WATIProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Gupshup Provider | `services/whatsapp/GupshupProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Interakt Provider | `services/whatsapp/InteraktProvider.ts` | ✅ Active | Yes | No | No | Maintain |
| Mock WhatsApp Provider | `services/whatsapp/MockWhatsAppProvider.ts` | 🧪 Testing | Dev | No | No | Keep for testing |
| Daily Summary Email | `cron.ts`, `email.ts` | ✅ Active | Yes | No | No | Maintain |
| Appointment Reminders (WhatsApp) | `cron.ts` (implicit) | ⚠️ Partial | Limited | No | No | Wire cron trigger |

---

## MODULE 14: INVENTORY & HR

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Inventory Management | `inventory.ts`, `Inventory.tsx` | ✅ Active | Yes | No | No | Maintain |
| Vendor Management | `vendors.ts` | ✅ Active | Yes | No | No | Maintain |
| HR Forms | `hr-forms.ts`, `HRForms.tsx` | ⚠️ Partial | Limited | No | No | Expand HR features |
| Staff Management | `users.ts`, `Staff.tsx` | ✅ Active | Yes | No | No | Maintain |
| Equipment Registry | `machines.ts`, `Machines.tsx` | ✅ Active | Yes | No | No | Maintain |

---

## MODULE 15: SYSTEM ADMINISTRATION

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Role-Based Access Control | `role-permissions.ts`, `role_permissions` table | ✅ Active | Yes | No | No | Maintain |
| USB Super-Admin Gate | `requireSuperAdminUsb.ts` | ✅ Active | Yes | No | No | Maintain |
| Audit Logging | `audit-logs.ts`, `audit_logs` table | ✅ Active | Yes | No | No | Maintain |
| Audit Log Archive (cron) | `cron.ts → scheduleAuditLogPurge()` | ✅ Active | Yes | No | No | Maintain |
| Session Idle Sweep | `cron.ts → scheduleSessionIdleSweep()` | ✅ Active | Yes | No | No | Maintain |
| Automated Backup (cron) | `cron.ts → scheduleAutomatedBackups()` | ✅ Active | Yes | No | No | Maintain |
| Manual Backup | `backup.ts` | ✅ Active | Yes | No | No | Maintain |
| Backup Replication | `backupReplication.ts` | ✅ Active | Yes | No | No | Maintain |
| Clinic Settings | `clinicSettings.ts` | ✅ Active | Yes | No | No | Maintain |
| Multi-Location / Branches | `locations.ts`, `branches.ts` | ⚠️ Partial | Limited | No | No | Expand if multi-branch needed |
| System Health Check | `system-health.ts`, `SystemUpdate.tsx` | ✅ Active | Yes | No | No | Maintain |
| Rate Limiting | `middleware/rateLimits.ts` | ✅ Active | Yes | No | No | Maintain |
| WebAuthn / FIDO2 | `webauthn.ts`, `webauthnService.ts` | ⚠️ Partial | No | No | No | Complete biometric login |
| Fingerprint Bridge | `bridge-service/` | ⚠️ Partial | Limited | No | No | Needs hardware |
| Storage Management | `storage.ts`, `StorageLifecycle.tsx` | ✅ Active | Yes | No | No | Maintain |
| Website Content Management | `website.ts`, `Website.tsx` | ✅ Active | Yes | No | No | Maintain |

---

## MODULE 16: SUPER ADMIN PORTAL

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Doctor Ledger | `super-admin-portal/DoctorLedger.tsx` | ✅ Active | Yes | No | No | Maintain |
| Doctor Manager | `super-admin-portal/DoctorManager.tsx` | ✅ Active | Yes | No | No | Maintain |
| Commission Report | `super-admin-portal/CommissionReport.tsx` | ✅ Active | Yes | No | No | Maintain |
| Commission Rules | `super-admin-portal/CommissionRules.tsx` | ✅ Active | Yes | No | No | Maintain |
| Money Trail Audit | `super-admin-portal/MoneyTrailAudit.tsx` | ✅ Active | Yes | No | No | Maintain |
| Payment Debug | `super-admin-portal/PaymentDebug.tsx` | ✅ Active | Yes | No | No | Maintain |
| Payment Gateway Settings | `super-admin-portal/PaymentGatewaySettings.tsx` | ✅ Active | Yes | No | No | Maintain |
| Role Permissions | `super-admin-portal/RolePermissions.tsx` | ✅ Active | Yes | No | No | Maintain |
| Referral Report | `super-admin-portal/ReferralReport.tsx` | ✅ Active | Yes | No | No | Maintain |
| Security Dashboard | `super-admin-portal/SecurityDashboard.tsx` | ✅ Active | Yes | No | No | Maintain |
| System Health | `super-admin-portal/SystemHealth.tsx` | ✅ Active | Yes | No | No | Maintain |

---

## DEAD CODE / CLEANUP REQUIRED

| Item | Location | Issue | Action |
|------|----------|-------|--------|
| `BillingDesk.bak.tsx` | `artifacts/diagnostic-erp/src/pages/` | Backup file in pages directory | **Delete immediately** |
| `RadiologyLegacy.tsx` | `artifacts/diagnostic-erp/src/pages/` | Superseded by RadiologyReportEditor | Remove when stable |
| `dicom-pull-agent/` (root folder) | Repo root | Superseded by in-process dimse-agent | **Archive/remove** |
| `ProviderFallback.tsx` | `diagnostic-erp/src/pages/` | Usage unclear | Audit and remove if unused |
| `PRODUCTION_DEV_CONSISTENCY_AUDIT (copy).md` | Repo root | Duplicate file with "(copy)" in name | **Delete** |
| `CARE_DIAGNOSTICS_WEBSITE_STRUCTURE (copy).md` | Repo root | Duplicate file with "(copy)" in name | **Delete** |
| `RADIOLOGY_IMPLEMENTATION_ROADMAP_v2.md` | Repo root | Superseded by `v2` version | **Delete v1** |
| `bill_preview.html` | Repo root | Loose file, unclear usage | Investigate and move or delete |
| `diff.txt` | Repo root | Scratch file | **Delete** |
| `counts.sql` / `counts_final.sql` / `counts_raw.sql` | Repo root | Scratch SQL files | **Delete** |
| `env` / `env_my_temp.txt` | Repo root | Sensitive! Contains env vars | **Delete immediately** |
| `mock-node-fetch.ts` | `api-server/src/` | Test stub in production source | Move to test directory |

---

## FEATURE SUMMARY COUNTS

| Status | Count |
|--------|-------|
| ✅ Active | ~120 features |
| ⚠️ Partial | ~25 features |
| 🧪 Experimental | ~15 features |
| 🏚️ Legacy | 3 features |
| 💀 Dead | 3+ items |
| **Total Inventory** | **~166 features** |
