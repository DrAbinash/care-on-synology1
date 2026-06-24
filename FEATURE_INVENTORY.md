# Feature Inventory â€” Care Diagnostics ERP
**Version:** 2.0 (June 2026) | **Scope:** Complete feature-by-feature audit

> For every feature: Location, Status, Used?, Legacy?, Duplicate?, Recommended Action.

**Status Legend:**
- âœ… **Active** â€” Feature is complete and in production use
- âš ï¸ **Partial** â€” Feature exists but is incomplete or partially wired
- ðŸ”´ **Broken** â€” Feature exists but is known to not work correctly
- ðŸšï¸ **Legacy** â€” Feature exists but is superseded by a newer implementation
- ðŸ§ª **Experimental** â€” Feature exists but not ready for production
- ðŸ’€ **Dead** â€” Code exists but is unreachable or unused

---

## MODULE 1: PATIENT MANAGEMENT

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Patient Registration | `patients.ts`, `Register.tsx` | âœ… Active | Yes | No | No | Maintain |
| Patient Search (name/code/phone) | `Patients.tsx` | âœ… Active | Yes | No | No | Maintain |
| Patient Profile & History | `PatientDetail.tsx` | âœ… Active | Yes | No | No | Maintain |
| Patient Unique ID (P00001) | `patients.ts` â†’ `patient_counter` | âœ… Active | Yes | No | No | Maintain |
| Online Booking (public) | `public-booking.ts`, `clinic-site` | âœ… Active | Yes | No | No | Maintain |
| Walk-in Registration | `Register.tsx` | âœ… Active | Yes | No | No | Maintain |
| Appointment Scheduling | `appointments.ts`, `Appointments.tsx` | âœ… Active | Yes | No | No | Maintain |
| Kiosk Self-Registration | `kiosk.ts`, `Kiosk.tsx` | âš ï¸ Partial | Limited | No | No | Complete kiosk hardware integration |
| Patient Portal (self-service) | `portal.ts`, `Portal.tsx` | âš ï¸ Partial | Limited | No | No | Expand patient-facing features |
| Barcode Label Generation | `barcode-resolver.ts` | âœ… Active | Yes | No | No | Maintain |
| Queue Token Assignment | `tokens.ts`, `Queue.tsx` | âœ… Active | Yes | No | No | Maintain |
| Queue Display Screen | `display.ts`, `Display.tsx` | âœ… Active | Yes | No | No | Maintain |
| Patient Communication (WhatsApp) | `PatientCommunication.tsx` | âš ï¸ Partial | Yes | No | No | Test all WhatsApp providers |
| Receipt Verification | `verify.ts`, `VerifyReceipt.tsx` | âœ… Active | Yes | No | No | Maintain |

---

## MODULE 2: BILLING & PAYMENTS

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Bill Creation | `bills.ts`, `BillingDesk.tsx` | âœ… Active | Yes | No | No | Maintain |
| Bill Detail View | `BillDetail.tsx` | âœ… Active | Yes | No | No | Maintain |
| Test/Package Selection | `BillingDesk.tsx`, `packages.ts` | âœ… Active | Yes | No | No | Maintain |
| Discount Management | `discounts.ts`, `Discounts.tsx` | âœ… Active | Yes | No | No | Maintain |
| Discount Override (admin PIN) | `bills.ts` | âœ… Active | Yes | No | No | Maintain |
| Payment Logging (cash/UPI/card) | `payments.ts` (implicit) | âœ… Active | Yes | No | No | Maintain |
| Bill Editing & Audit Trail | `bills.ts`, `bill_audits` table | âœ… Active | Yes | No | No | Maintain |
| Receipt Printing | `BillingDesk.tsx` | âœ… Active | Yes | No | No | Maintain |
| Dues Management | `Dues.tsx` | âœ… Active | Yes | No | No | Maintain |
| Day Close Procedure | `day-close.ts`, `DayClose.tsx` | âœ… Active | Yes | No | No | Maintain |
| Daily Summary Email | `cron.ts â†’ fireDailySummary()` | âœ… Active | Yes | No | No | Maintain |
| Health Packages | `packages.ts`, `Packages.tsx` | âœ… Active | Yes | No | No | Maintain |
| VIP Surcharge | `bills.ts` (percentage from settings) | âœ… Active | Yes | No | No | Maintain |
| Bill Number Generation | `generateBillNumber(ledgerId)` | âœ… Active | Yes | No | No | Maintain |
| `BillingDesk.bak.tsx` | `artifacts/diagnostic-erp/src/pages/` | ðŸ’€ Dead | No | Yes | Yes (BillingDesk.tsx) | **Delete** |

---

## MODULE 3: LABORATORY

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Sample Collection & Tracking | `samples.ts`, `Samples.tsx` | âœ… Active | Yes | No | No | Maintain |
| Lab Result Entry | (via orders/tests workflow) | âœ… Active | Yes | No | No | Maintain |
| Abnormal Findings Flagging | `abnormal-findings.ts` | âœ… Active | Yes | No | No | Maintain |
| Test Catalog Management | `tests.ts`, `Tests.tsx` | âœ… Active | Yes | No | No | Maintain |
| Test Categories | `testCategories.ts` | âœ… Active | Yes | No | No | Maintain |
| Outsourced Lab Management | `outsourced-labs.ts`, `OutsourcedLabs.tsx` | âœ… Active | Yes | No | No | Maintain |
| Outsource Cost Report | `OutsourcedCostReport.tsx` | âœ… Active | Yes | No | No | Maintain |
| Outsource Reconciliation | `OutsourceReconciliation.tsx` | âœ… Active | Yes | No | No | Maintain |
| Outsource Rate Cards | `OutsourceRateCards.tsx` | âœ… Active | Yes | No | No | Maintain |

---

## MODULE 4: RADIOLOGY â€” CORE

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Radiology Worklist | `radiology.ts`, `RadiologyWorklist.tsx` | âœ… Active | Yes | No | No | Maintain |
| Command Center View | `RadiologyCommandCenter.tsx` | âœ… Active | Yes | No | No | Maintain |
| Study Claiming (Technician) | `radiologyWorkflow.ts` | âœ… Active | Yes | No | No | Maintain |
| Study Locking (Radiologist) | `radiology.ts` | âœ… Active | Yes | No | No | Maintain |
| Report Editor | `RadiologyReportEditor.tsx` | âœ… Active | Yes | No | No | Maintain |
| Report Generator | `RadiologyReportGenerator.tsx` | âœ… Active | Yes | No | No | Maintain |
| Unified Reporting Workspace | `RadiologyReportingWorkspace.tsx` | âœ… Active | Yes | No | Partial overlap w/ Editor | Consolidate eventually |
| Report Finalization & Lock | `radiology.ts` | âœ… Active | Yes | No | No | Maintain |
| Report PDF Generation | `radiology-report-generator.ts` + Playwright | âœ… Active | Yes | No | No | Maintain |
| Report Delivery | `reportDelivery.ts`, `ReportDelivery.tsx` | âœ… Active | Yes | No | No | Maintain |
| Report QR Code Verification | `verify.ts` | âœ… Active | Yes | No | No | Maintain |
| Report Templates | `report-templates.ts`, `ReportTemplates.tsx` | âœ… Active | Yes | No | No | Maintain |
| Structured Report Templates | `structuredReportTemplates.ts` | âœ… Active | Yes | No | No | Maintain |
| Template Versioning | `TemplateVersions.tsx` | âœ… Active | Yes | No | No | Maintain |
| Normal Report Templates | `NormalReportTemplates.tsx` | âœ… Active | Yes | No | No | Maintain |
| Technician Workflow | `TechnicianWorkflow.tsx` | âœ… Active | Yes | No | No | Maintain |
| Scan Station | `ScanStation.tsx` | âœ… Active | Yes | No | No | Maintain |
| `RadiologyLegacy.tsx` | `artifacts/diagnostic-erp/src/pages/` | ðŸšï¸ Legacy | No | Yes | Yes (RadiologyReportEditor) | **Remove when stable** |

---

## MODULE 5: RADIOLOGY â€” AI TOOLS

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| AI Draft (Ollama local) | `radiologyOllama.ts` | âœ… Active | Yes | No | No | Maintain |
| AI Draft (Gemini cloud) | `ai.ts`, `aiReporting.ts` | âœ… Active | Yes | No | No | Maintain |
| AI Copilot | `radiologyCopilot.ts` | âœ… Active | Yes | No | No | Maintain |
| Brain Intelligence (structured) | `radiologyBrainIntelligence.ts` | âœ… Active | Yes | No | No | Maintain |
| Spine Intelligence (structured) | `radiologySpineIntelligence.ts` | âœ… Active | Yes | No | No | Maintain |
| Tumor Follow-up Tracker | `radiologyTumorFollowup.ts` | âš ï¸ Partial | Limited | No | No | Expand oncology workflow |
| Lesion Tracker | `radiologyLesions.ts` | âš ï¸ Partial | Limited | No | No | Tie to OHIF measurements |
| Smart Findings (Chocolate Box) | `radiologySmartFindings.ts` | âœ… Active | Yes | No | No | Maintain |
| Radiologist Memory Store | `radiologyMemory.ts` | âœ… Active | Yes | No | No | Maintain |
| Knowledge Base | `radiologyKnowledge.ts` | âš ï¸ Partial | Limited | No | No | Build content |
| Radiologist Snippets | `radiologySnippets.ts` | âœ… Active | Yes | No | No | Maintain |
| AI Annotations | `radiologyAnnotations.ts` | âš ï¸ Partial | Limited | No | No | Wire to OHIF |
| Smart Radiology Engine | `smartRadiology.ts` | âœ… Active | Yes | No | No | Maintain |
| Voice Dictation | `VoiceDictation.tsx` | âš ï¸ Partial | Limited | No | No | Complete browser speech API |
| Radiologist Favorites (findings) | `radiologySmartFindings.ts` | âœ… Active | Yes | No | No | Maintain |
| Radiologist Macros | `radiologySnippets.ts` | âœ… Active | Yes | No | No | Maintain |
| Favorite Impressions | `radiologySmartFindings.ts` | âœ… Active | Yes | No | No | Maintain |
| Favorite Templates | `structuredReportTemplates.ts` | âœ… Active | Yes | No | No | Maintain |
| AI Prompt Library | `aiPromptLibrary.ts` | âœ… Active | Yes | No | No | Maintain |
| AI Prompt Templates | `aiPromptTemplates.ts` | âœ… Active | Yes | No | No | Maintain |
| AI Comparison Workspace | `AiComparisonWorkspace.tsx` | ðŸ§ª Experimental | Limited | No | No | Evaluate utility |
| AI Quality Scores | `AiQualityScores.tsx` | ðŸ§ª Experimental | No | No | No | Evaluate utility |
| Feedback Loop Analytics | `FeedbackLoopAnalytics.tsx` | ðŸ§ª Experimental | No | No | No | Evaluate utility |
| RAG Vector Store | `RagVectorStore.tsx` | ðŸ§ª Experimental | No | No | No | Consider removing if unused |
| Training Data Exports | `TrainingDataExports.tsx` | ðŸ§ª Experimental | No | No | No | Evaluate utility |
| Missed Finding Detector | `MissedFindingDetector.tsx` | ðŸ§ª Experimental | No | No | No | Evaluate utility |
| Image Review Assistant | `ImageReviewAssistant.tsx` | ðŸ§ª Experimental | No | No | No | Evaluate utility |

---

## MODULE 6: PACS & DICOM

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Conquest PACS Lua Hook | `conquest/erp_notify.lua` + `internal-radiology.ts` | âœ… Active | Yes | No | No | Maintain |
| Orthanc PACS Integration | `pacs.ts`, `pacsEnterprise.ts` | âœ… Active | Yes | No | No | Maintain |
| DICOMweb Proxy (WADO) | `pacs.ts` (Orthanc proxy) | âœ… Active | Yes | No | No | Maintain |
| OHIF Viewer | Docker container | âœ… Active | Yes | No | No | Maintain |
| Weasis Viewer (local) | Windows local install | âœ… Active | Yes | No | No | Maintain |
| Embedded DICOM Viewer | `DicomViewer.tsx` | âœ… Active | Yes | No | No | Maintain |
| Mobile DICOM Viewer | `MobileViewer.tsx` | âš ï¸ Partial | Limited | No | No | Optimize for mobile |
| PACS Archive (PDFâ†’DICOM) | `lib/pacsArchive.ts` | âœ… Active | Yes | No | No | Maintain |
| PACS Dashboard | `PacsDashboard.tsx` | âœ… Active | Yes | No | No | Maintain |
| PACS Logs | `PacsLogs.tsx` | âœ… Active | Yes | No | No | Maintain |
| PACS Watchdog | `PacsWatchdogDashboard.tsx` | âœ… Active | Yes | No | No | Maintain |
| Archive Lifecycle | `PacsArchiveLifecycle.tsx` | âœ… Active | Yes | No | No | Maintain |
| DICOM Auto-Pull (cron) | `cron.ts â†’ scheduleDicomAutoPull()` | âœ… Active | Yes | No | No | Maintain |
| In-Process DIMSE Agent | `services/dicom-pull-agent/dimse-agent.ts` | âœ… Active | Opt-in | No | No | Enable via `ENABLE_DICOM_PULL_AGENT=1` |
| Legacy External DICOM Agent | `dicom-pull-agent/` (root folder) | ðŸšï¸ Legacy | No | Yes | Yes (dimse-agent) | **Retire** |
| DICOM Node Configuration | `DicomNodes.tsx` | âœ… Active | Yes | No | No | Maintain |
| DICOM Query/Retrieve | `DicomQueryRetrieve.tsx` | âœ… Active | Yes | No | No | Maintain |
| DICOM Study Manager | `dicomStudyManager.ts` | âœ… Active | Yes | No | No | Maintain |
| Hanging Protocols | `HangingProtocols.tsx` | âš ï¸ Partial | Limited | No | No | Wire to OHIF config |
| Modality Worklist (MWL) | `MwlDashboard.tsx`, `MwlManager.tsx` | âœ… Active | Yes | No | No | Maintain |
| HL7 Integration | `hl7.ts`, `Hl7Settings.tsx` | âš ï¸ Partial | No | No | No | Evaluate if needed |
| RIS Monitoring | `risMonitoring.ts` | âš ï¸ Partial | Limited | No | No | Expand |

---

## MODULE 7: USG / ULTRASOUND

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| USG Reporting | `usgReports.ts`, `UsgReporting.tsx` | âœ… Active | Yes | No | No | Maintain |
| USG Worklist | `UsgWorklist.tsx` | âœ… Active | Yes | No | No | Maintain |
| USG Analytics | `usgAnalytics.ts`, `UsgAnalytics.tsx` | âœ… Active | Yes | No | No | Maintain |
| Doppler Reporting | `usgDoppler.ts`, `UsgDoppler.tsx` | âœ… Active | Yes | No | No | Maintain |
| Critical USG Alerts | `usgCriticalAlerts.ts` | âœ… Active | Yes | No | No | Maintain |
| USG Measurement Extraction (AI) | `usgExtraction.ts`, `lib/usgExtractor.ts` | âœ… Active | Yes | No | No | Maintain |
| USG Key Images Gallery | `UsgKeyImagesGallery.tsx` | âœ… Active | Yes | No | No | Maintain |
| USG Measurement Review | `UsgMeasurementReview.tsx` | âœ… Active | Yes | No | No | Maintain |
| Echocardiography Reports | `echoCardiology.ts`, `EchoCardiology.tsx` | âœ… Active | Yes | No | No | Maintain |
| Fetal Echocardiography | `FetalEcho.tsx` | âœ… Active | Yes | No | No | Maintain |
| Fetal USG Level-4 | `fetalUsgLevel4.ts`, `FetalUsgLevel4.tsx` | âœ… Active | Yes | No | No | Maintain |
| Form-F (Obstetric Regulatory) | `form-f.ts`, `FormF.tsx` | âœ… Active | Yes | No | No | Maintain (legal requirement) |

---

## MODULE 8: TEACHING FILES & PEER REVIEW

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Teaching Case Library | `teachingCases.ts`, `TeachingFiles.tsx` | âœ… Active | Yes | No | No | Maintain |
| Case Collections | `TeachingCaseCollections.tsx` | âœ… Active | Yes | No | No | Maintain |
| Favorite Cases | `TeachingFavorites.tsx` | âœ… Active | Yes | No | No | Maintain |
| Teaching Mode | `TeachingMode.tsx` | âœ… Active | Yes | No | No | Maintain |
| AI Teaching Assistant | `TeachingAIAssistant.tsx` | ðŸ§ª Experimental | Limited | No | No | Evaluate |
| Presentation Mode | `TeachingPresentationMode.tsx` | ðŸ§ª Experimental | No | No | No | Evaluate |
| Research Mode | `TeachingResearchMode.tsx` | ðŸ§ª Experimental | No | No | No | Evaluate |
| Teaching Analytics | `TeachingAnalytics.tsx` | âš ï¸ Partial | No | No | No | Build metrics |
| Peer Review Assignments | `peerReview.ts`, `PeerReviewAssignments.tsx` | âœ… Active | Yes | No | No | Maintain |
| Critical Findings Manager | `CriticalFindings.tsx` | âœ… Active | Yes | No | No | Maintain |
| Critical Alerts | `CriticalAlertsManager.tsx` | âœ… Active | Yes | No | No | Maintain |

---

## MODULE 9: TELERADIOLOGY

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Teleradiology Portal | `teleradiologyPortal.ts`, `TeleradiologyPortal.tsx` | âœ… Active | Yes | No | No | Maintain |
| Teleradiology Routing | `teleradiology.ts` | âœ… Active | Yes | No | No | Maintain |
| Radiologist Assignment | `lib/radiologistAssignment.ts` | âœ… Active | Yes | No | No | Maintain |
| Study Priority Engine | `lib/studyPriorityEngine.ts` | âœ… Active | Yes | No | No | Maintain |
| TAT Tracker | `lib/tatTracker.ts`, `TurnaroundTimeAnalytics.tsx` | âœ… Active | Yes | No | No | Maintain |
| Multi-Site Worklist | `lib/multiSiteWorklist.ts` | âš ï¸ Partial | Limited | No | No | Expand for multi-branch |

---

## MODULE 10: ACCOUNTING & FINANCE

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Accounting Module | `accounting.ts`, `Accounting.tsx` | âœ… Active | Yes | No | No | Maintain |
| Ledger Management | `ledgers.ts` | âœ… Active | Yes | No | No | Maintain |
| Expense Tracking | `expenses.ts`, `Expenses.tsx` | âœ… Active | Yes | No | No | Maintain |
| Day Close | `day-close.ts`, `DayClose.tsx` | âœ… Active | Yes | No | No | Maintain |
| Doctor Commission Rules | `commission.ts` | âœ… Active | Yes | No | No | Maintain |
| Month-End Commission Email | `cron.ts â†’ fireMonthEndCommission()` | âœ… Active | Yes | No | No | Maintain |
| Books Sanity Check | `books-sanity.ts`, `BooksSanity.tsx` | âœ… Active | Yes | No | No | Maintain |
| Monthly Money-Trail Audit (auto) | `cron.ts â†’ fireMonthlyAudit()` | âœ… Active | Yes | No | No | Maintain |
| Referral Management | `Referrals.tsx` | âœ… Active | Yes | No | No | Maintain |

---

## MODULE 11: BANKING

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Bank Account Management | `banking.ts`, `Banking.tsx` | âœ… Active | Yes | No | No | Maintain |
| Bank Statement Auto-Sync | `cron.ts â†’ scheduleBankingAutoSync()` | âœ… Active | Yes | No | No | Maintain |
| Auto-Reconciliation Engine | `services/banking/ReconciliationEngine.ts` | âœ… Active | Yes | No | No | Maintain |
| Fraud Detection Engine | `services/banking/FraudDetectionEngine.ts` | âœ… Active | Yes | No | No | Maintain |
| ICICI Bank Provider | `services/banking/ICICIBankProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| HDFC Bank Provider | `services/banking/HDFCBankProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Axis Bank Provider | `services/banking/AxisBankProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| SBI Bank Provider | `services/banking/SBIBankProvider.ts` | âš ï¸ Partial | No | No | No | Verify SBI API availability |
| Kotak Bank Provider | `services/banking/KotakBankProvider.ts` | âš ï¸ Partial | No | No | No | Verify Kotak API |
| PhonePe Bank Provider | `services/banking/PhonePeProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| BharatPe Bank Provider | `services/banking/BharatPeProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Cashfree Bank Provider | `services/banking/CashfreeProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Mock Bank Provider | `services/banking/MockBankProvider.ts` | ðŸ§ª Testing | Dev | No | No | Keep for testing |

---

## MODULE 12: PAYMENT GATEWAYS (ONLINE BOOKING)

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Payment Engine (orchestrator) | `lib/payments/PaymentEngine.ts` | âœ… Active | Yes | No | No | Maintain |
| ICICI Orange Pay | `lib/payments/IciciPaymentProvider.ts` | âœ… Active | Yes | No | No | Primary gateway â€” maintain |
| PhonePe | `lib/payments/PhonePePaymentProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Razorpay | `lib/payments/RazorpayPaymentProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| PayU | `lib/payments/PayUPaymentProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| BharatPe | `lib/payments/BharatPePaymentProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Cashfree | `lib/payments/CashfreePaymentProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| HDFC SmartHub | `lib/payments/HdfcPaymentProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Payment Callback Webhooks | `public-booking.ts` | âœ… Active | Yes | No | No | Maintain |
| Online Booking Auto-Confirm | `public-booking.ts â†’ confirmBookingInternal()` | âœ… Active | Yes | No | No | Maintain |

---

## MODULE 13: COMMUNICATION

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| WhatsApp Notification (send) | `whatsapp.ts`, `WhatsAppService.ts` | âœ… Active | Yes | No | No | Maintain |
| WhatsApp Chatbot | `waChatbot.ts`, `WhatsAppChatbot.tsx` | âš ï¸ Partial | Limited | No | No | Expand chatbot flows |
| Meta WhatsApp Cloud | `services/whatsapp/MetaWhatsAppCloudProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Twilio WhatsApp | `services/whatsapp/TwilioWhatsAppProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| WATI Provider | `services/whatsapp/WATIProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Gupshup Provider | `services/whatsapp/GupshupProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Interakt Provider | `services/whatsapp/InteraktProvider.ts` | âœ… Active | Yes | No | No | Maintain |
| Mock WhatsApp Provider | `services/whatsapp/MockWhatsAppProvider.ts` | ðŸ§ª Testing | Dev | No | No | Keep for testing |
| Daily Summary Email | `cron.ts`, `email.ts` | âœ… Active | Yes | No | No | Maintain |
| Appointment Reminders (WhatsApp) | `cron.ts` (implicit) | âš ï¸ Partial | Limited | No | No | Wire cron trigger |

---

## MODULE 14: INVENTORY & HR

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Inventory Management | `inventory.ts`, `Inventory.tsx` | âœ… Active | Yes | No | No | Maintain |
| Vendor Management | `vendors.ts` | âœ… Active | Yes | No | No | Maintain |
| HR Forms | `hr-forms.ts`, `HRForms.tsx` | âš ï¸ Partial | Limited | No | No | Expand HR features |
| Staff Management | `users.ts`, `Staff.tsx` | âœ… Active | Yes | No | No | Maintain |
| Equipment Registry | `machines.ts`, `Machines.tsx` | âœ… Active | Yes | No | No | Maintain |

---

## MODULE 15: SYSTEM ADMINISTRATION

| Feature | Location | Status | Used? | Legacy? | Duplicate? | Recommended Action |
|---------|----------|--------|-------|---------|------------|-------------------|
| Role-Based Access Control | `role-permissions.ts`, `role_permissions` table | âœ… Active | Yes | No | No | Maintain |
| Audit Logging | `audit-logs.ts`, `audit_logs` table | âœ… Active | Yes | No | No | Maintain |
| Audit Log Archive (cron) | `cron.ts â†’ scheduleAuditLogPurge()` | âœ… Active | Yes | No | No | Maintain |
| Session Idle Sweep | `cron.ts â†’ scheduleSessionIdleSweep()` | âœ… Active | Yes | No | No | Maintain |
| Automated Backup (cron) | `cron.ts â†’ scheduleAutomatedBackups()` | âœ… Active | Yes | No | No | Maintain |
| Manual Backup | `backup.ts` | âœ… Active | Yes | No | No | Maintain |
| Backup Replication | `backupReplication.ts` | âœ… Active | Yes | No | No | Maintain |
| Clinic Settings | `clinicSettings.ts` | âœ… Active | Yes | No | No | Maintain |
| Multi-Location / Branches | `locations.ts`, `branches.ts` | âš ï¸ Partial | Limited | No | No | Expand if multi-branch needed |
| System Health Check | `system-health.ts`, `SystemUpdate.tsx` | âœ… Active | Yes | No | No | Maintain |
| Rate Limiting | `middleware/rateLimits.ts` | âœ… Active | Yes | No | No | Maintain |
| WebAuthn / FIDO2 | `webauthn.ts`, `webauthnService.ts` | âš ï¸ Partial | No | No | No | Complete biometric login |
| Fingerprint Bridge | `bridge-service/` | âš ï¸ Partial | Limited | No | No | Needs hardware |
| Storage Management | `storage.ts`, `StorageLifecycle.tsx` | âœ… Active | Yes | No | No | Maintain |
| Website Content Management | `website.ts`, `Website.tsx` | âœ… Active | Yes | No | No | Maintain |

---
