# Repository Index — Care Diagnostics ERP
**Version:** 2.0 (June 2026) | Use this as a map of every file and folder in the repo.

---

## Top-Level Directory Structure

```
caredeoghar--antigravity/
├── artifacts/                    # All deployable application code
│   ├── api-server/               # Express.js backend API
│   ├── diagnostic-erp/           # Primary internal SPA (Vite/React)
│   ├── clinic-site/              # Public patient booking site (Vite/React)
│   └── super-admin-portal/       # Owner admin console (Vite/React)
├── conquest/                     # Conquest PACS integration scripts
├── dicom-pull-agent/             # Legacy external DICOM pull agent
├── bridge-service/               # Fingerprint/scan bridge service
├── scan-bridge/                  # Alternate scan bridge
├── docker/                       # Docker helper scripts
├── migrations/                   # Drizzle ORM SQL migration files
├── scripts/                      # Utility scripts
├── docs/                         # Architecture documentation
├── backup_*/                     # Manual restore point snapshots
├── lib/                          # Shared library packages
├── docker-compose.yml            # Production container stack
├── package.json                  # Monorepo root package
├── pnpm-workspace.yaml           # pnpm workspace definition
├── tsconfig.base.json            # Shared TypeScript config
└── *.md                          # Documentation files (see below)
```

---

## Documentation Files (Root)

| File | Purpose |
|------|---------|
| `ERP_MASTER_CONTEXT.md` | **START HERE** — canonical system reference |
| `REPOSITORY_INDEX.md` | This file — complete file/folder map |
| `FEATURE_INVENTORY.md` | Every feature with status, location, recommendation |
| `CLAUDE_HANDOFF.md` | AI assistant onboarding & handoff guide |
| `ERP_PERMISSION_MATRIX.md` | Full RBAC authorization audit |
| `ERP_PACS_DOCUMENTATION.md` | Complete PACS/DICOM integration docs |
| `ERP_DEPLOYMENT_RUNBOOK.md` | Step-by-step deployment from scratch |
| `ERP_TECHNICAL_DEBT.md` | Ranked technical debt with recommendations |
| `Radiology_Architecture_Master.md` | Detailed radiology module architecture |
| `ERP_DATABASE_DICTIONARY.md` | Table-by-table database schema reference |
| `ERP_SECURITY_AUDIT.md` | Security threat model and findings |
| `RADIOLOGY_AUDIT.md` | Radiology workflow audit findings |
| `RADIOLOGY_AUDIT_REPORT.md` | Detailed radiology audit report |
| `RADIOLOGY_REALITY_AUDIT.md` | End-to-end radiology reality check |
| `RADIOLOGY_ACTION_PLAN.md` | Radiology improvement action plan |
| `RADIOLOGY_IMPLEMENTATION_ROADMAP.md` | Radiology feature roadmap |
| `RADIOLOGY_MODULE_INVENTORY.md` | Radiology module component inventory |
| `RADIOLOGY_PACS_EVIDENCE_AUDIT_JUNE_2026.md` | June 2026 PACS evidence audit |
| `RADIOLOGY_PRODUCTION_READINESS_AUDIT.md` | Production readiness check |
| `CARE_DIAGNOSTICS_MASTER_AUDIT_2026.md` | Full clinic audit 2026 |
| `PRODUCTION_DEV_CONSISTENCY_AUDIT.md` | Production vs dev consistency audit |
| `RE_AUDIT_PRODUCTION_JUNE_2026.md` | June 2026 production re-audit |
| `FEATURES.md` | Legacy feature list |
| `DEPLOY.md` / `DEPLOYMENT.md` | Deployment notes |
| `SYNOLOGY-INSTALL.md` | Synology installation guide |
| `CONQUEST_SETUP.md` | Conquest PACS setup guide |
| `BACKUP.md` / `RESTORE.md` | Backup and restore procedures |
| `BUILD-EXE.md` | Executable build instructions |
| `PEN_DRIVE_SETUP.md` | USB super-admin setup |
| `README-WINDOWS.md` | Windows development setup |
| `PATIENT_SELF_REGISTRATION_KIOSK.md` | Kiosk module documentation |
| `AGENT_LOG.md` | AI agent activity log |
| `threat_model.md` | Security threat model |

---

## API Server (`artifacts/api-server/src/`)

### Routes (100+ files)

#### Radiology Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `radiology.ts` | `/api/radiology` | Core radiology CRUD (studies, worklist) |
| `radiology-report-generator.ts` | `/api/radiology/report-generator` | Report PDF generation |
| `radiologyWorkflow.ts` | `/api/radiology/workflow` | Study workflow state management |
| `radiologyAnnotations.ts` | `/api/radiology/annotations` | DICOM annotation storage |
| `radiologyBrainIntelligence.ts` | `/api/radiology/brain` | Brain MRI structured reporting AI |
| `radiologySpineIntelligence.ts` | `/api/radiology/spine` | Spine MRI structured reporting AI |
| `radiologyCopilot.ts` | `/api/radiology/copilot` | AI report drafting copilot |
| `radiologyKnowledge.ts` | `/api/radiology/knowledge` | Radiologist knowledge base |
| `radiologyLesions.ts` | `/api/radiology/lesions` | Lesion tracking & measurement |
| `radiologyMemory.ts` | `/api/radiology/memory` | Radiologist personal memory store |
| `radiologyOllama.ts` | `/api/radiology/ollama` | Local Ollama AI integration |
| `radiologySmartFindings.ts` | `/api/radiology/smart-findings` | Chocolate Box findings library |
| `radiologySnippets.ts` | `/api/radiology/snippets` | Report text snippets |
| `radiologyTumorFollowup.ts` | `/api/radiology/tumor` | Tumor follow-up tracking |
| `smartRadiology.ts` | `/api/radiology/smart` | Smart reporting engine |
| `structuredReportTemplates.ts` | `/api/radiology/structured-templates` | Structured report templates |
| `report-templates.ts` | `/api/report-templates` | Standard report templates |
| `internal-radiology.ts` | `/api/internal/radiology` | **Conquest PACS Lua hook receiver** |
| `risMonitoring.ts` | `/api/ris` | RIS monitoring dashboard |
| `aiPromptLibrary.ts` | `/api/ai/prompts` | AI prompt library |
| `aiPromptTemplates.ts` | `/api/ai/prompt-templates` | AI prompt templates |

#### PACS/DICOM Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `pacs.ts` | `/api/pacs` | PACS management, Orthanc proxy |
| `pacsEnterprise.ts` | `/api/pacs/enterprise` | Enterprise PACS features |
| `dicom.ts` | `/api/dicom` | DICOM operations |
| `dicom-agent.ts` | `/api/dicom/agent` | DICOM pull agent control |
| `dicomStudyManager.ts` | `/api/dicom/study-manager` | Study manager |
| `dicomWorkflow.ts` | `/api/dicom/workflow` | DICOM workflow state |
| `dicom-uploads.ts` | `/api/dicom/uploads` | DICOM file upload |

#### USG/Ultrasound Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `usgReports.ts` | `/api/usg` | USG report management |
| `usgAnalytics.ts` | `/api/usg/analytics` | USG analytics |
| `usgCriticalAlerts.ts` | `/api/usg/critical-alerts` | Critical finding alerts |
| `usgDoppler.ts` | `/api/usg/doppler` | Doppler measurement reports |
| `usgExtraction.ts` | `/api/usg/extraction` | AI measurement extraction |

#### Clinical/Patient Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `patients.ts` | `/api/patients` | Patient CRUD |
| `orders.ts` | `/api/orders` | Test orders |
| `tests.ts` | `/api/tests` | Diagnostic test catalog |
| `testCategories.ts` | `/api/test-categories` | Test category management |
| `samples.ts` | `/api/samples` | Lab sample tracking |
| `reports.ts` | `/api/reports` | Lab/clinical reports |
| `patient-reports.ts` | `/api/patient-reports` | Patient-facing report delivery |
| `form-f.ts` | `/api/form-f` | Regulatory Form-F (obstetric USG) |
| `abnormal-findings.ts` | `/api/abnormal-findings` | Abnormal result flagging |
| `echoCardiology.ts` | `/api/echo` | Echocardiography reports |
| `fetalUsgLevel4.ts` | `/api/fetal-usg` | Fetal Level-4 USG reports |
| `teachingCases.ts` | `/api/teaching` | Teaching case collection |

#### Billing/Financial Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `bills.ts` | `/api/bills` | Bill CRUD and management |
| `payments.ts` (implicit) | `/api/payments` | Payment logging |
| `discounts.ts` | `/api/discounts` | Discount management |
| `commission.ts` | `/api/commission` | Doctor commission rules |
| `ledgers.ts` | `/api/ledgers` | Financial ledger management |
| `accounting.ts` | `/api/accounting` | Accounts & bookkeeping |
| `expenses.ts` | `/api/expenses` | Expense logging |
| `day-close.ts` | `/api/day-close` | Daily closure procedure |
| `daily-summary.ts` | `/api/daily-summary` | Daily financial summary |
| `my-daily-summary.ts` | `/api/my-daily-summary` | Per-staff daily summary |
| `doctor-ledger.ts` | `/api/doctor-ledger` | Doctor-wise ledger |
| `books-sanity.ts` | `/api/books-sanity` | Money-trail audit checks |
| `banking.ts` | `/api/banking` | Bank account & transaction sync |
| `outsourced-labs.ts` | `/api/outsourced-labs` | Outsourced test management |

#### Admin/System Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `users.ts` | `/api/users` | User/staff management |
| `staff.ts` | `/api/staff` | Staff directory |
| `role-permissions.ts` | `/api/role-permissions` | RBAC management |
| `audit-logs.ts` | `/api/audit-logs` | Audit log viewer |
| `backup.ts` | `/api/backup` | Manual backup endpoints |
| `backupReplication.ts` | `/api/backup/replication` | Backup replication |
| `internal-backup.ts` | `/api/internal/backup` | Internal backup trigger |
| `super-admin.ts` | `/api/admin` | Super-admin protected ops |
| `system.ts` | `/api/system` | System configuration |
| `system-health.ts` | `/api/system/health` | Health check endpoint |
| `clinicSettings.ts` | `/api/clinic-settings` | Clinic configuration |
| `settings.ts` (implicit) | `/api/settings` | General settings |
| `sync.ts` | `/api/sync` | Data synchronization |
| `storage.ts` | `/api/storage` | Object storage management |
| `locations.ts` | `/api/locations` | Multi-location / branches |
| `branches.ts` | `/api/branches` | Branch management |
| `departments.ts` | `/api/departments` | Department management |
| `machines.ts` | `/api/machines` | Equipment registry |

#### Patient/Public Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `public-booking.ts` | `/api/public/booking` | Public test booking + payment callbacks |
| `online-bookings.ts` | `/api/online-bookings` | Online booking management |
| `appointments.ts` | `/api/appointments` | Appointment scheduling |
| `kiosk.ts` | `/api/kiosk` | Self-registration kiosk |
| `tokens.ts` | `/api/tokens` | Queue token management |
| `packages.ts` | `/api/packages` | Health packages catalog |
| `portal.ts` | `/api/portal` | Patient/staff portal |
| `verify.ts` | `/api/verify` | Receipt/report verification |
| `display.ts` | `/api/display` | Queue display screen |
| `scan-sessions.ts` | `/api/scan-sessions` | Scan session OCR |
| `barcode-resolver.ts` | `/api/barcode` | Barcode lookup |
| `reportDelivery.ts` | `/api/report-delivery` | Report delivery tracking |

#### Communication Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `whatsapp.ts` | `/api/whatsapp` | WhatsApp notification send |
| `waChatbot.ts` | `/api/wa-chatbot` | WhatsApp chatbot engine |
| `email-settings.ts` | `/api/email-settings` | Email configuration |
| `printers.ts` | `/api/printers` | Printer management |
| `uploads.ts` | `/api/uploads` | File upload handling |
| `webauthn.ts` | `/api/webauthn` | WebAuthn/FIDO2 authentication |

#### Inventory/HR Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `inventory.ts` | `/api/inventory` | Inventory management |
| `vendors.ts` | `/api/vendors` | Vendor management |
| `hr-forms.ts` | `/api/hr-forms` | HR form management |
| `doctors.ts` | `/api/doctors` | Doctor/referral management |
| `teleradiology.ts` | `/api/teleradiology` | Teleradiology workflow |
| `teleradiologyPortal.ts` | `/api/teleradiology/portal` | Teleradiologist portal |
| `userPreferences.ts` | `/api/user-preferences` | User preference storage |

#### AI/Analytics Routes
| File | API Prefix | Purpose |
|------|-----------|---------|
| `ai.ts` | `/api/ai` | AI operations (Gemini) |
| `aiComparison.ts` | `/api/ai/comparison` | AI output comparison workspace |
| `aiModelRoutes.ts` | `/api/ai/models` | AI model routing config |
| `aiReporting.ts` | `/api/ai/reporting` | AI reporting settings |
| `advanced-dashboard.ts` | `/api/dashboard/advanced` | Advanced analytics dashboard |
| `hl7.ts` | `/api/hl7` | HL7 messaging |
| `website.ts` | `/api/website` | Public website content |

### Services (`artifacts/api-server/src/services/`)

| Directory | Service | Purpose |
|-----------|---------|---------|
| `services/banking/` | `BankingService.ts` | Core banking abstraction |
| `services/banking/` | `BankProviderFactory.ts` | Provider factory pattern |
| `services/banking/` | `ReconciliationEngine.ts` | Auto-reconciliation |
| `services/banking/` | `FraudDetectionEngine.ts` | Transaction fraud detection |
| `services/banking/` | `*BankProvider.ts` (8 providers) | Bank-specific implementations |
| `services/dicom-pull-agent/` | `dimse-agent.ts` | In-process DICOM C-FIND/C-MOVE |
| `services/whatsapp/` | `WhatsAppService.ts` | WhatsApp abstraction |
| `services/whatsapp/` | `WhatsAppProviderFactory.ts` | Provider factory |
| `services/whatsapp/` | `*Provider.ts` (5 providers) | Twilio, Meta, WATI, Gupshup, Interakt, Mock |

### Libraries (`artifacts/api-server/src/lib/`)

| File | Purpose |
|------|---------|
| `pacsArchive.ts` | PDF→DICOM encapsulation→Orthanc archive |
| `objectStorage.ts` | Local MinIO-compatible file storage |
| `objectAcl.ts` | Object storage access control |
| `payments/PaymentEngine.ts` | Payment gateway orchestrator |
| `payments/PaymentProvider.ts` | Base payment provider interface |
| `payments/IciciPaymentProvider.ts` | ICICI Orange Pay |
| `payments/PhonePePaymentProvider.ts` | PhonePe UPI |
| `payments/RazorpayPaymentProvider.ts` | Razorpay |
| `payments/PayUPaymentProvider.ts` | PayU |
| `payments/BharatPePaymentProvider.ts` | BharatPe |
| `payments/CashfreePaymentProvider.ts` | Cashfree |
| `payments/HdfcPaymentProvider.ts` | HDFC SmartHub |
| `pacs/providers.ts` | PACS provider abstraction (Orthanc/Conquest) |
| `dicomConnectors.ts` | DICOM node connectivity |
| `dicomPatientCreator.ts` | Auto-create patients from DICOM metadata |
| `dicomRoutingOptimizer.ts` | Study routing optimization |
| `criticalFindingsAlert.ts` | Critical finding alert dispatch |
| `multiSiteWorklist.ts` | Multi-site worklist aggregation |
| `studyPriorityEngine.ts` | Study priority scoring |
| `tatTracker.ts` | Turnaround time tracking |
| `peerReview.ts` | Peer review assignment |
| `radiologistAssignment.ts` | Auto-assign studies to radiologists |
| `usgExtractor.ts` | USG measurement AI extraction |
| `usgMeasurementEngine.ts` | USG measurement calculation engine |
| `usgQualityCheck.ts` | USG image quality assessment |
| `usgReportTemplates.ts` | USG report template library |
| `webauthnService.ts` | WebAuthn FIDO2 implementation |
| `cryptoUtils.ts` | Encryption/decryption utilities |
| `logger.ts` | Structured logging |
| `istDate.ts` | IST timezone date utilities |
| `rateLimits.ts` (middleware) | Rate limiting middleware |
| `requireStaffAuth.ts` (middleware) | Staff session authentication |
| `requireSuperAdmin.ts` (middleware) | Super-admin access gate |
| `requireSuperAdminUsb.ts` (middleware) | USB key validation |
| `errorHandler.ts` (middleware) | Global error handler |

---

## Frontend ERP Pages (`artifacts/diagnostic-erp/src/pages/`)

### Dashboard & Core
| Page | Route (approximate) | Purpose |
|------|---------------------|---------|
| `Dashboard.tsx` | `/dashboard` | Main clinic dashboard |
| `DailySummary.tsx` | `/daily-summary` | Daily collection summary |
| `MyDailySummary.tsx` | `/my-daily-summary` | Personal daily summary |
| `DayClose.tsx` | `/day-close` | Daily closure procedure |
| `MyDayClose.tsx` | `/my-day-close` | Personal day close |
| `Queue.tsx` | `/queue` | Patient queue display |
| `Display.tsx` | `/display` | Public queue display screen |
| `Kiosk.tsx` | `/kiosk` | Self-registration kiosk |

### Patient & Registration
| Page | Route | Purpose |
|------|-------|---------|
| `Patients.tsx` | `/patients` | Patient list & search |
| `PatientDetail.tsx` | `/patients/:id` | Patient profile & history |
| `Register.tsx` | `/register` | New patient registration |
| `Appointments.tsx` | `/appointments` | Appointment management |
| `OnlineBookings.tsx` | `/online-bookings` | Online booking management |
| `PatientCommunication.tsx` | `/patient-comms` | Patient messaging |

### Billing & Finance
| Page | Route | Purpose |
|------|-------|---------|
| `Billing.tsx` | `/billing` | Billing dashboard |
| `BillingDesk.tsx` | `/billing-desk` | Active billing terminal |
| `BillDetail.tsx` | `/bills/:id` | Bill detail view |
| `Payments.tsx` | `/payments` | Payment log |
| `Dues.tsx` | `/dues` | Outstanding dues |
| `Discounts.tsx` | `/discounts` | Discount management |
| `Accounting.tsx` | `/accounting` | Accounting module |
| `Banking.tsx` | `/banking` | Bank sync & reconciliation |
| `Expenses.tsx` | `/expenses` | Expense tracking |
| `Referrals.tsx` | `/referrals` | Referral management |
| `VerifyReceipt.tsx` | `/verify-receipt` | Receipt verification |
| `FormF.tsx` | `/form-f` | Regulatory Form-F |
| `Orders.tsx` | `/orders` | Order management |
| `OrderDetail.tsx` | `/orders/:id` | Order detail |

### Radiology
| Page | Route | Purpose |
|------|-------|---------|
| `Radiology.tsx` | `/radiology` | Radiology dashboard |
| `RadiologyWorklist.tsx` | `/radiology/worklist` | Study worklist |
| `RadiologyCommandCenter.tsx` | `/radiology/command-center` | Command center view |
| `CommandCenter.tsx` | `/command-center` | Alternate command center |
| `RadiologyReportEditor.tsx` | `/radiology/report-editor` | Full report editor |
| `RadiologyReportGenerator.tsx` | `/radiology/report-generator` | AI-assisted generator |
| `RadiologyReportingWorkspace.tsx` | `/radiology/workspace` | Unified reporting workspace |
| `RadiologyReportUnified.tsx` | `/radiology/unified-report` | Unified report view |
| `RadiologistQueue.tsx` | `/radiologist-queue` | Radiologist work queue |
| `RadiologistTools.tsx` | `/radiologist-tools` | Tools & macros |
| `RadiologyAdvancedTools.tsx` | `/radiology/advanced-tools` | Advanced AI tools |
| `RadiologyProductivity.tsx` | `/radiology/productivity` | Productivity analytics |
| `RadiologySettings.tsx` | `/radiology/settings` | Radiology configuration |
| `RadiologyLegacy.tsx` | `/radiology/legacy` | Legacy report editor |
| `NormalReportTemplates.tsx` | `/report-templates/normal` | Normal findings templates |
| `ReportTemplates.tsx` | `/report-templates` | Template management |
| `ReportGenerator.tsx` | `/report-generator` | General report generator |
| `ReportHub.tsx` | `/report-hub` | Centralized report hub |
| `Reports.tsx` | `/reports` | Reports list |
| `ReportDelivery.tsx` | `/report-delivery` | Delivery tracking |
| `ReportDiffViewer.tsx` | `/report-diff` | Report version comparison |
| `ReportQualityGates.tsx` | `/report-quality` | Quality gate checklist |
| `TemplateVersions.tsx` | `/template-versions` | Template version history |
| `SectionsEditor.tsx` | `/sections-editor` | Report section editor |
| `TechnicianWorkflow.tsx` | `/technician` | Technician scan workflow |
| `ScanStation.tsx` | `/scan-station` | Scan station terminal |
| `VoiceDictation.tsx` | `/voice-dictation` | Voice dictation interface |

### PACS & DICOM
| Page | Route | Purpose |
|------|-------|---------|
| `PACS.tsx` | `/pacs` | PACS management |
| `PacsDashboard.tsx` | `/pacs/dashboard` | PACS dashboard |
| `PacsSettings.tsx` | `/pacs/settings` | PACS configuration |
| `PacsLogs.tsx` | `/pacs/logs` | PACS event logs |
| `PacsArchiveLifecycle.tsx` | `/pacs/archive` | Archive lifecycle management |
| `PacsWatchdogDashboard.tsx` | `/pacs/watchdog` | PACS health monitor |
| `DicomViewer.tsx` | `/dicom-viewer` | Embedded DICOM viewer |
| `MobileViewer.tsx` | `/mobile-viewer` | Mobile-optimized viewer |
| `DicomAgentDashboard.tsx` | `/dicom/agent` | DICOM pull agent control |
| `DicomNodes.tsx` | `/dicom/nodes` | DICOM node configuration |
| `DicomQueryRetrieve.tsx` | `/dicom/qr` | Manual C-FIND/C-MOVE |
| `DicomStudyWorklist.tsx` | `/dicom/worklist` | DICOM study worklist |
| `HangingProtocols.tsx` | `/hanging-protocols` | Viewer hanging protocols |
| `ModalityManagement.tsx` | `/modalities` | Modality configuration |
| `MwlDashboard.tsx` | `/mwl` | Modality Worklist dashboard |
| `MwlManager.tsx` | `/mwl/manager` | MWL management |
| `AcquisitionGateway.tsx` | `/acquisition-gateway` | DICOM acquisition gateway |

### USG/Ultrasound
| Page | Route | Purpose |
|------|-------|---------|
| `UsgReporting.tsx` | `/usg/reporting` | USG report creation |
| `UsgWorklist.tsx` | `/usg/worklist` | USG study worklist |
| `UsgAnalytics.tsx` | `/usg/analytics` | USG analytics |
| `UsgDoppler.tsx` | `/usg/doppler` | Doppler report |
| `UsgDopplerReporting.tsx` | `/usg/doppler/reporting` | Doppler reporting |
| `UsgCriticalAlerts.tsx` | `/usg/alerts` | Critical USG alerts |
| `UsgKeyImagesGallery.tsx` | `/usg/gallery` | Key image gallery |
| `UsgMeasurementReview.tsx` | `/usg/measurements` | Measurement review |
| `UsgAdminSettings.tsx` | `/usg/admin` | USG admin settings |
| `EchoCardiology.tsx` | `/echo` | Echo cardiology reports |
| `FetalEcho.tsx` | `/fetal-echo` | Fetal echocardiography |
| `FetalUsgLevel4.tsx` | `/fetal-usg-level4` | Fetal Level-4 USG |

### AI & Analytics
| Page | Route | Purpose |
|------|-------|---------|
| `AiDicomFindings.tsx` | `/ai/dicom-findings` | AI DICOM analysis |
| `AiComparisonWorkspace.tsx` | `/ai/comparison` | AI output comparison |
| `AiExtractionReview.tsx` | `/ai/extraction` | AI extraction review |
| `AiInferenceSettings.tsx` | `/ai/inference` | Inference configuration |
| `AiModelRouting.tsx` | `/ai/routing` | Model routing config |
| `AiPipelineManager.tsx` | `/ai/pipeline` | AI pipeline management |
| `AiPromptManager.tsx` | `/ai/prompts` | Prompt management |
| `AiPromptTemplates.tsx` | `/ai/prompt-templates` | Prompt templates |
| `AiPromptEffectiveness.tsx` | `/ai/effectiveness` | Prompt analytics |
| `AiQualityScores.tsx` | `/ai/quality` | AI quality scoring |
| `AiReportingSettings.tsx` | `/ai/reporting-settings` | AI reporting config |
| `AiSearchRetrieval.tsx` | `/ai/search` | AI-powered search |
| `AiBillingSuggestions.tsx` | `/ai/billing` | AI billing suggestions |
| `AiAuditLog.tsx` | `/ai/audit` | AI action audit log |
| `AgentSetup.tsx` | `/agent-setup` | AI agent configuration |
| `FeedbackLoopAnalytics.tsx` | `/ai/feedback` | Feedback loop analytics |
| `ImageReviewAssistant.tsx` | `/ai/image-review` | Image review AI |
| `MissedFindingDetector.tsx` | `/ai/missed-findings` | Missed finding detection |
| `RagVectorStore.tsx` | `/ai/rag` | RAG vector store management |
| `TrainingDataExports.tsx` | `/ai/training-data` | Training data export |
| `AnomalyAlerts.tsx` | `/ai/anomaly` | Anomaly detection alerts |
| `TurnaroundTimeAnalytics.tsx` | `/tat` | TAT analytics |

### Teaching & Peer Review
| Page | Route | Purpose |
|------|-------|---------|
| `TeachingFiles.tsx` | `/teaching` | Teaching case library |
| `TeachingCaseDetail.tsx` | `/teaching/:id` | Case detail view |
| `TeachingCaseCollections.tsx` | `/teaching/collections` | Case collections |
| `TeachingFavorites.tsx` | `/teaching/favorites` | Favorite cases |
| `TeachingMode.tsx` | `/teaching/mode` | Interactive teaching mode |
| `TeachingAIAssistant.tsx` | `/teaching/ai` | AI teaching assistant |
| `TeachingAnalytics.tsx` | `/teaching/analytics` | Teaching analytics |
| `TeachingPresentationMode.tsx` | `/teaching/presentation` | Presentation mode |
| `TeachingResearchMode.tsx` | `/teaching/research` | Research mode |
| `PeerReviewAssignments.tsx` | `/peer-review` | Peer review assignments |
| `CriticalFindings.tsx` | `/critical-findings` | Critical findings manager |
| `CriticalAlertsManager.tsx` | `/critical-alerts` | Alert management |

### Teleradiology
| Page | Route | Purpose |
|------|-------|---------|
| `TeleradiologyPortal.tsx` | `/teleradiology` | Teleradiology portal |
| `OutsourceDashboard.tsx` | `/outsource/dashboard` | Outsource dashboard |
| `OutsourcedLabs.tsx` | `/outsource/labs` | Outsourced lab management |
| `OutsourceWorklist.tsx` | `/outsource/worklist` | Outsource worklist |
| `OutsourceLedger.tsx` | `/outsource/ledger` | Outsource cost ledger |
| `OutsourcedCostReport.tsx` | `/outsource/cost-report` | Cost report |
| `OutsourceRateCards.tsx` | `/outsource/rates` | Rate card management |
| `OutsourceReconciliation.tsx` | `/outsource/reconciliation` | Cost reconciliation |
| `OutsourceSettings.tsx` | `/outsource/settings` | Outsource settings |

### Laboratory
| Page | Route | Purpose |
|------|-------|---------|
| `Samples.tsx` | `/samples` | Lab sample tracking |
| `Tests.tsx` | `/tests` | Test catalog management |
| `Portal.tsx` | `/portal` | Patient self-service portal |

### System & Settings
| Page | Route | Purpose |
|------|-------|---------|
| `Settings.tsx` | `/settings` | System settings |
| `Staff.tsx` | `/staff` | Staff management |
| `Doctors.tsx` | `/doctors` | Doctor directory |
| `Machines.tsx` | `/machines` | Equipment registry |
| `Packages.tsx` | `/packages` | Health package management |
| `Inventory.tsx` | `/inventory` | Inventory management |
| `HRForms.tsx` | `/hr-forms` | HR form management |
| `Website.tsx` | `/website` | Website content management |
| `WhatsAppChatbot.tsx` | `/whatsapp-chatbot` | WhatsApp chatbot config |
| `StorageLifecycle.tsx` | `/storage` | Storage lifecycle management |
| `BackupReplication.tsx` | `/backup` | Backup management |
| `SystemUpdate.tsx` | `/system-update` | System update management |
| `Hl7Settings.tsx` | `/hl7` | HL7 settings |
| `ProviderFallback.tsx` | `/provider-fallback` | Provider fallback config |
| `ProviderHealthMonitor.tsx` | `/provider-health` | Provider health monitor |
| `CommissionReportTab.tsx` | `/commission-report` | Commission report |
| `OutsourcedCostReport.tsx` | `/outsource/cost` | Outsourced cost reporting |
| `BooksSanity.tsx` | `/books-sanity` | Books sanity check |
| `not-found.tsx` | `*` | 404 page |

---

## Conquest PACS Integration (`conquest/`)

| File | Purpose |
|------|---------|
| `erp_notify.lua` | **Critical** — Lua script that fires HTTP POST to ERP on DICOM study receive |
| `conquest.ini` | Conquest PACS configuration |
| `dicomserver.exe` | Conquest PACS server binary |

---

## Bridge Services

| Directory | Purpose |
|-----------|---------|
| `bridge-service/` | Fingerprint scanner HTTP bridge (local Windows service) |
| `scan-bridge/` | Document scanner bridge service |
| `dicom-pull-agent/` | Legacy external DICOM pull agent (now replaced by in-process dimse-agent) |

---

## Backup Snapshots (Manual Restore Points)

| Directory | Created For |
|-----------|------------|
| `backup_favorites_macros/` | Before radiologist favorites & macros feature |
| `backup_pacs_archive_restore_point/` | Before PACS archive changes |
| `backup_pre_gateway/` | Before payment gateway integration |
| `backup_pre_refactor/` | Before major refactor |
| `backup_pre_summary_website_fix/` | Before summary/website fixes |
| `backup_pre_ux_refactor/` | Before UX refactor |
| `backup_pre_viewer_integration/` | Before viewer integration |
| `backup_radiology_command_center/` | Before command center |
| `backup_smart_findings_chocolate_box/` | Before chocolate box feature |
| `backup_study_locking_restore_point/` | Before study locking |
| `backup_task_a_b_restore_point/` | Before task A/B features |
| `restore_point_payment_refactor/` | Before payment refactor |

---

## Database (`lib/db/`)

- **ORM:** Drizzle ORM
- **Schema files:** `lib/db/schema/` (278+ table definitions)
- **Migrations:** `migrations/` folder + `care-db-patch-v2` container
- **Key Schema File:** `@workspace/db/schema` (monorepo internal package)
