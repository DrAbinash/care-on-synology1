# ERP_DATABASE_DICTIONARY.md
**Care Diagnostics ERP — Complete Database Dictionary**
*Generated: 2026-06-24 | Schema Location: `lib/db/src/schema/` | 115 files | ~230 tables*
*ORM: Drizzle-ORM (PostgreSQL) | FK enforcement: Drizzle-level (some logical-only, marked)*

---

## Table of Contents

1. [Core Clinical Tables](#1-core-clinical-tables)
2. [Billing & Payments](#2-billing--payments)
3. [Radiology Studies & Worklist](#3-radiology-studies--worklist)
4. [DICOM / PACS Infrastructure](#4-dicom--pacs-infrastructure)
5. [USG / Doppler Module](#5-usg--doppler-module)
6. [Radiology AI & Reporting Engine](#6-radiology-ai--reporting-engine)
7. [Radiology Knowledge & Memory](#7-radiology-knowledge--memory)
8. [Radiology Smart Features](#8-radiology-smart-features)
9. [Echo Cardiology & Fetal USG](#9-echo-cardiology--fetal-usg)
10. [Staff & HR](#10-staff--hr)
11. [Authentication & Sessions](#11-authentication--sessions)
12. [Settings & Configuration](#12-settings--configuration)
13. [Queue & Tokens](#13-queue--tokens)
14. [Accounting & Finance](#14-accounting--finance)
15. [Banking & Payments (Enterprise)](#15-banking--payments-enterprise)
16. [WhatsApp & Communications](#16-whatsapp--communications)
17. [Website & Online Booking](#17-website--online-booking)
18. [Audit & Compliance](#18-audit--compliance)
19. [Outsourced Labs](#19-outsourced-labs)
20. [Sync & Infrastructure](#20-sync--infrastructure)
21. [AI Platform Tables](#21-ai-platform-tables)

---

## 1. Core Clinical Tables

### `patients`
**File:** `patients.ts` | **PK:** `id` (serial)
**Purpose:** Master patient registry. One row per patient. Source of truth for demographics.

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| firstName, lastName | text | Patient name |
| phone | text | Primary contact |
| dateOfBirth | date | Used for age calculation |
| gender | text | M / F / Other |
| address | text | |
| bloodGroup | text | |
| uhid | text | Unique Hospital ID, nullable |
| isActive | boolean | Soft-delete flag |
| createdAt, updatedAt | timestamp | |

**Indexes:** None declared (indexed via FK lookups from bills, orders, radiology_studies)
**FKs pointing to patients:** `orders.patientId`, `bills.patientId`, `radiology_studies.patientId`, `portal_sessions.patientId` (logical), `form_f.patientId` (logical), `dicom_studies.patientId` (logical)
**Growth risk:** Low-Medium. ~50-200 new rows/month. Long term stable.

---

### `doctors`
**File:** `doctors.ts` | **PK:** `id` (serial)
**Purpose:** Referring doctor registry. Used for commission tracking and report headings.

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| name | text | Doctor full name |
| phone | text | |
| specialization | text | |
| registrationNumber | text | |
| isActive | boolean | |

**Growth risk:** Very low. Static reference table.

---

### `tests`
**File:** `tests.ts` | **PK:** `id` (serial)
**Purpose:** Test/service catalog. Every billable service is a row here.

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| code | text | Short code |
| name | text | Display name |
| category | text | USG, CT, MRI, X-Ray, Blood, etc. |
| department | text | |
| price | numeric | Default price |
| duration | integer | Minutes |
| isActive | boolean | |

**Growth risk:** Very low. Semi-static.

---

### `test_categories`
**File:** `testCategories.ts` | **PK:** `id` (serial)
**Purpose:** Hierarchical test categories (e.g., Radiology → USG).

---

### `orders`
**File:** `orders.ts` | **PK:** `id` (serial)
**Purpose:** One order per patient visit. Container for order items (tests selected).

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| patientId | integer | → patients.id |
| doctorId | integer | → doctors.id (logical) |
| orderDate | date | |
| status | text | pending / confirmed / cancelled |
| source | text | walk-in / online / referred |
| notes | text | |
| createdAt | timestamp | |

**Indexes:** status, patientId implied by query patterns
**Downstream:** bills, radiology_studies, order_tests (if separate), test_tokens

---

### `samples`
**File:** `samples.ts` | **PK:** `id` (serial)
**Purpose:** Lab sample tracking (blood, urine, tissue). Tracks collection, receipt, processing.

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| orderId | integer | → orders.id (logical) |
| billId | integer | → bills.id (logical) |
| patientId | integer | → patients.id (logical) |
| sampleType | text | blood / urine / tissue |
| barcodeId | text | Unique barcode |
| collectedAt | timestamp | |
| collectedBy | text | |
| status | text | pending / collected / received / processed / rejected |
| rejectionReason | text | |

**Indexes:** barcodeId, status, patientId

---

### `packages`
**File:** `packages.ts` | **PK:** `id` (serial)
**Purpose:** Test packages / health check bundles.

### `package_tests`
**File:** `packages.ts`
**Purpose:** Many-to-many junction: which tests are in each package.

---

### `appointments`
**File:** `appointments.ts` | **PK:** `id` (serial)
**Purpose:** Pre-booking appointments (before bill is created).

---

### `discounts`
**File:** `discounts.ts` | **PK:** `id` (serial)
**Purpose:** Discount applications on bills. Links to discount_reasons.

### `discount_reasons`
**File:** `discountReasons.ts`
**Purpose:** Dropdown options for discount justification (Doctor Order, VIP, Staff, etc.).

---

### `form_f`
**File:** `formF.ts` | **PK:** `id` (serial)
**Purpose:** Pre-Conception and Pre-Natal Diagnostic Techniques (PC-PNDT) compliance form. Required by law for all obstetric USG.

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| patientId | integer | → patients.id (logical) |
| billId | integer | (logical) |
| gestationalAge | text | |
| lastMenstrualPeriod | date | |
| referringDoctor | text | |
| purpose | text | Allowed reasons per PNDT act |
| declaration | boolean | Patient / doctor declaration |
| formDate | date | |
| signedBy | text | |

**Compliance risk:** Must never be deleted. Archive-only.

---

### `patient_reports`
**File:** `patientReports.ts` | **PK:** `id` (serial)
**Purpose:** Patient-facing PDF report delivery records. Tracks what was delivered and how.

---

### `report_templates`
**File:** `reportTemplates.ts` | **PK:** `id` (serial)
**Purpose:** Generic report templates (non-radiology, e.g., pathology, blood work).

### `report_template_versions`
**File:** `reportTemplateVersions.ts`
**Purpose:** Version history of report templates.

### `abnormal_findings`
**File:** `abnormalFindings.ts`
**Purpose:** Reference ranges and abnormal finding definitions for lab tests.

---

## 2. Billing & Payments

### `bills`
**File:** `bills.ts` | **PK:** `id` (serial)
**Purpose:** Financial transaction record. One bill per visit (linked to one order).

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| billNumber | text | UNIQUE — `BILL-YYYYMMDD-NNN` |
| orderId | integer | → orders.id (FK) |
| patientId | integer | → patients.id (FK) |
| subtotal | numeric(10,2) | Before discount |
| discount | numeric(10,2) | Total discount applied |
| discountReason | text | |
| taxAmount | numeric(10,2) | |
| totalAmount | numeric(10,2) | After discount + tax |
| paidAmount | numeric(10,2) | Payments received so far |
| balanceAmount | numeric(10,2) | Still owed |
| status | text | pending / paid / partial / cancelled |
| ledgerId | integer | → ledgers.id (logical) |
| cancelledAt | timestamp | |
| refundAmount | numeric(10,2) | |
| originalTotal | numeric(10,2) | Pre-edit amount |
| qrScanCount | integer | Analytics |
| createdAt, updatedAt | timestamp | |

**Indexes:** billNumber (unique), orderId (FK), patientId (FK)
**FKs pointing to bills:** payments, radiology_studies, dicom_studies, online_bookings, form_f, scan_sessions (all logical)
**Growth risk:** HIGH. Core transactional table. ~50-200 bills/day. 18,000–72,000 rows/year. Add date-range index.

---

### `payments`
**File:** `bills.ts` | **PK:** `id` (serial)
**Purpose:** Individual payment events on a bill (cash, UPI, card, etc.).

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| billId | integer | → bills.id (FK) |
| amount | numeric(10,2) | |
| method | text | cash / upi / card / cheque / online |
| referenceNumber | text | UPI/card ref |
| recordedByName | text | |
| createdAt | timestamp | |

**Growth risk:** HIGH. 1-3 rows per bill. ~100,000–200,000 rows/year.

---

### `payment_logs`
**File:** `paymentLogs.ts` | **PK:** `id` (serial)
**Purpose:** Gateway-level payment transaction log (Razorpay, PayU, PhonePe callbacks).

---

### `bill_audits`
**File:** `users.ts` | **PK:** `id` (serial)
**Purpose:** Immutable log of every bill edit — who changed what, when, and why.

| Column | Type | Notes |
|--------|------|-------|
| billId | integer | → bills.id (logical) |
| editedBy | text | User name |
| reason | text | Mandatory justification |
| changeType | text | discount / cancel / edit |
| oldValue, newValue | text | JSON diff |

**Compliance note:** Must never be deleted. Append-only.
**Growth risk:** Medium. ~1-5 rows per bill edit.

---

### `commissions`
**File:** `commission.ts` | **PK:** `id` (serial)
**Purpose:** Doctor referral commission calculations (super-admin only).

### `doctor_payouts`
**File:** `doctorPayouts.ts`
**Purpose:** Actual commission payouts to referring doctors.

---

## 3. Radiology Studies & Worklist

### `radiology_studies`
**File:** `radiology.ts` | **PK:** `id` (serial)
**Purpose:** ⭐ CORE: One row per ordered radiology study (USG, X-Ray, CT, MRI, etc.). The RIS order entry. Generated from bill creation.

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| accessionNumber | text | UNIQUE — `ACC-YYYYMMDD-MOD-NNN` |
| billId | integer | → bills.id (logical) |
| orderId | integer | → orders.id (logical) |
| orderTestId | integer | UNIQUE — one study per order test |
| patientId | integer | → patients.id (logical) |
| testId | integer | → tests.id (logical) |
| modality | text | CR, US, MR, CT, MG, MA, BMD, OT |
| status | text | scheduled → in_progress → acquired → reported_preliminary → reported_final → delivered |
| studyDate | date | |
| studyInstanceUid | text | DICOM UID (nullable) |
| technicianId | integer | → users.id (logical) |
| assignedRadiologistId | integer | → users.id (logical) |
| claimedAt | timestamp | Teleradiology claim time |
| clinicalHistory | text | |
| prelimReport | text | Draft report text |
| finalReport | text | Final signed report text |
| templateId | integer | Last template used |
| priority | text | stat / emergency / urgent / routine / vip |
| pacsArchiveStatus | text | none / pending / success / failed |

**Indexes:**
- `radiology_studies_accession_uq` (unique)
- `radiology_studies_order_test_uq` (unique)
- `radiology_studies_status_idx`
- `radiology_studies_date_idx`
- `radiology_studies_priority_idx`

**Growth risk:** HIGH. 50-200 rows/day. ~18,000–72,000 rows/year. Best partitioned by `study_date`.

---

### `radiology_film_issues`
**File:** `radiology.ts`
**Purpose:** Physical CD/film/print issuance log per study. Tracks patient collection.

### `radiology_prompts`
**File:** `radiology.ts`
**Purpose:** Reusable AI prompt instructions per modality. Pastes into dictation pane.

### `radiology_priority_rules`
**File:** `radiology.ts`
**Purpose:** Admin-configurable auto-priority assignment rules (keyword → priority mapping).

### `radiologist_assignment_rules`
**File:** `radiology.ts`
**Purpose:** Maps modality + shift → preferred radiologist. Used by auto-assignment cron.

### `radiologist_subspecialties`
**File:** `radiology.ts`
**Purpose:** Many-to-many: user → subspecialties (neuroradiology, MSK, etc.).

### `radiologist_workloads`
**File:** `radiology.ts` | Unique on `userId`
**Purpose:** Real-time workload snapshot per radiologist. Updated when studies are assigned/reported.

### `radiology_report_verifications`
**File:** `radiology.ts`
**Purpose:** Multi-stage report verification workflow (prelim → peer review → verified → final).

### `radiology_critical_findings`
**File:** `radiology.ts`
**Purpose:** Critical finding alerts — logged with notification method and acknowledgement.

### `radiology_tat_tracking`
**File:** `radiology.ts` | Unique on `studyId`
**Purpose:** TAT (Turnaround Time) tracking per study. Tracks SLA breach.

### `radiology_structured_templates`
**File:** `radiology.ts`
**Purpose:** Structured report templates (JSON format) per modality/body part.

### `radiology_ai_enhancements`
**File:** `radiology.ts`
**Purpose:** AI-generated findings/impressions per study. Tracks acceptance/rejection.

### `radiology_dicom_measurements`
**File:** `radiology.ts`
**Purpose:** Measurements extracted from DICOM (length, area, volume, angle, density).

### `teleradiology_sites`
**File:** `radiology.ts`
**Purpose:** Remote site registry for multi-site teleradiology network.

### `radiology_multi_site_worklist`
**File:** `radiology.ts`
**Purpose:** Bridge table: study assignment to remote teleradiology site.

### `dicom_routing_optimization_log`
**File:** `radiology.ts`
**Purpose:** Log of DICOM routing decisions (local vs remote vs load-balanced).

### `radiology_study_locks`
**File:** `radiology.ts` | Unique on `studyId`
**Purpose:** Optimistic locking for concurrent report editing. One active lock per study.

### `radiology_chocolate_findings`
**File:** `radiology.ts`
**Purpose:** Standardized "chocolate box" findings library — pre-written finding + impression pairs per modality + body part.

### `radiology_user_findings_preferences`
**File:** `radiology.ts`
**Purpose:** Per-user favorite findings and custom finding overrides.

### `radiology_user_report_preferences`
**File:** `radiology.ts`
**Purpose:** Per-user saved favorites: findings, impressions, templates, personal macros.

### `radiology_user_item_usage_logs`
**File:** `radiology.ts`
**Purpose:** Click/usage tracking for findings, macros, templates — used for smart sorting.

---

### `radiology_worklist`
**File:** `radiologyWorklist.ts` | **PK:** `id` (serial)
**Purpose:** PACS-side worklist — studies pulled from ORTHANC/Conquest. Separate from RIS-side `radiology_studies`.

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| accessionNumber | text | |
| studyInstanceUID | text | |
| patientName | text | DICOM tag |
| patientId | integer | ERP patient match (logical) |
| modality | text | |
| studyDate | text | Compact YYYYMMDD from DICOM |
| referringDoctor | text | |
| status | text | |

**⚠️ Overlap Risk:** `radiology_worklist` and `radiology_studies` both store study data. The Q/R query merges them, deduplicating by accession number. Architectural tech debt.

---

### `radiology_share_links`
**File:** `radiologyShareLinks.ts`
**Purpose:** Token-gated temporary links to share reports externally (patients, referring doctors).

---

### `radiology_scheduled_procedures`
**File:** `radiologyScheduledProcedures.ts`
**Purpose:** MWL (Modality Worklist) entries pushed to PACS. One row per procedure sent to scanner.

---

## 4. DICOM / PACS Infrastructure

### `dicom_nodes`
**File:** `dicom.ts` | **PK:** `id` (serial) | Unique on `aeTitle`
**Purpose:** Registry of all DICOM imaging devices (scanners, PACS servers, Orthanc).

| Column | Type | Notes |
|--------|------|-------|
| aeTitle | text | UNIQUE — DICOM AE Title |
| host | text | IP address |
| port | integer | Default 104 |
| modality | text | CR, US, MR, CT, etc. |
| autoPull | boolean | Enables auto Q/R |
| pullIntervalSeconds | integer | |
| conquestAeTitle / Host / Port | text/int | Destination PACS |
| preferredRetrieveMethod | text | C_MOVE / C_GET / WATCH_FOLDER |
| watchFolderPath | text | For file-system import |
| lastConnectionStatus | text | ok / error |

---

### `dicom_pull_jobs`
**File:** `dicom.ts` | **PK:** `id` (serial)
**Purpose:** One row per DICOM pull attempt. Picked up by the local DICOM Pull Agent.

| Column | Type | Notes |
|--------|------|-------|
| nodeId | integer | → dicom_nodes.id (logical) |
| triggerType | text | manual / auto |
| status | text | pending → running → completed / failed / partial |
| queryDateFrom, queryDateTo | text | ISO date range |
| studiesFound, studiesPulled, studiesFailed | integer | Results |
| agentId | text | Hostname of agent machine |

**Growth risk:** Medium. Auto-pull creates 1 row per interval per node. Needs periodic cleanup of old completed rows.

---

### `dicom_modalities`
**File:** `dicom.ts` (via pacsEnterprise router usage of `dicomModalitiesTable`)
**Purpose:** Modality registry used for C-ECHO tests and routing. *(Note: may be same as dicom_nodes for some deployments — verify.)*

---

### `dicom_pulled_studies`
**File:** `dicomPulledStudies.ts` | **PK:** `id` (serial)
**Purpose:** Inventory of DICOM studies successfully pulled from remote nodes. Used by Q/R dashboard.

| Column | Type | Notes |
|--------|------|-------|
| studyInstanceUID | text | DICOM UID |
| accessionNumber | text | |
| patientName | text | |
| modality | text | |
| status | text | pulled / linked / archived |

**Growth risk:** HIGH. Every auto-pulled study creates a row. Could accumulate rapidly. Needs periodic archival.

---

### `dicom_routing_rules`
**File:** `dicomRoutingRules.ts` | **PK:** `id` (serial)
**Purpose:** Routing rules for DICOM Q/R (source AE → destination PACS). Priority-ordered.

---

### `dicom_failed_retrieval_queue`
**File:** `dicomAgent.ts` | **PK:** `id` (serial)
**Purpose:** Failed pull attempts queued for retry. Cleared on success.

---

### `pacs_settings`
**File:** `pacsSettings.ts` | **PK:** `id` (serial)
**Purpose:** Key-value store for PACS/viewer settings (OHIF URL, Orthanc URL, WADO URL, viewer mode).

| Column | Type | Notes |
|--------|------|-------|
| key | text | Setting name |
| value | text | Setting value |
| category | text | viewer / orthanc / conquest |
| isSecret | boolean | Hides value in UI if true |

**Note:** Single-row-per-key pattern. No compound unique index on (key, category) declared — could allow duplicates. Should add unique constraint.

---

### `pacs_logs`
**File:** `pacsSettings.ts`
**Purpose:** PACS event audit log (C-ECHO, study archived, viewer launched, etc.).

---

### `dicom_studies`
**File:** `dicomStudies.ts` | **PK:** `id` (serial)
**Purpose:** ⭐ Canonical DICOM study registry — ingested from any source (Orthanc, DICOMweb, HL7). Single source of truth for the PACS layer above USG reporting.

| Column | Type | Notes |
|--------|------|-------|
| studyInstanceUID | text | UNIQUE |
| accessionNumber | text | |
| patientId | integer | → patients.id (logical) |
| modality | text | |
| ingestStatus | text | pending / ingested / failed / duplicate / linked |
| ingestSource | text | orthanc / conquest / dicomweb / hl7 / manual |
| linkStatus | text | linked / suggested / conflict / unlinked |
| linkedBillId | integer | → bills.id (logical) |
| linkedOrderId | integer | → orders.id (logical) |
| assignedRadiologistId | integer | → users.id (logical) |
| reportStatus | text | not_started / draft / verified / finalized / amended |
| dicomMetadata | jsonb | Full DICOM tag dump |

**Indexes:** 9 indexes: UID, accession, patient, status, link, modality, radiologist, priority, report
**Growth risk:** HIGH. Every DICOM study ingested creates a row. Metadata JSONB column can be large.
**⚠️ Overlap:** Overlaps with `radiology_worklist` and `radiology_studies`. Three tables hold study data.

---

### `dicom_study_series`
**File:** `dicomStudies.ts`
**Purpose:** Series-level detail (one row per series per study).

### `dicom_study_audit_log`
**File:** `dicomStudies.ts`
**Purpose:** Immutable lifecycle log: study ingested, linked, viewer opened, AI suggestion generated, etc.

### `ai_extraction_results`
**File:** `dicomStudies.ts`
**Purpose:** AI/OCR extraction output with human review state per study.

### `hanging_protocols`
**File:** `dicomStudies.ts`
**Purpose:** Viewer layout + required measurement checklists per modality/body part.

### `technician_workflow`
**File:** `dicomStudies.ts` | Unique on `studyId`
**Purpose:** Scan metadata: contrast used, image quality, adverse reactions per study.

### `modality_routing_map`
**File:** `dicomStudies.ts` | Unique on `modalityCode`
**Purpose:** Maps DICOM modality code → ERP module path (US → /usg, CT → /ct, etc.).

---

## 5. USG / Doppler Module

### `usg_measurements`
**File:** `usgMeasurements.ts` | **PK:** `id` (serial)
**Purpose:** Structured USG measurements extracted from DICOM SR or OCR (OB biometry, organ sizes, etc.). 100+ columns for different measurement types.

**Key columns:** bpd, hc, ac, fl, crl, efw, ga, edd, fhr, placentaPosition, uterusSize, liverSize, spleenSize, kidneys, prostate, thyroid, etc. + confidence columns for each.

**Indexes:** studyInstanceUID, worklistId, status, patientId
**Growth risk:** HIGH. ~100+ columns per row. Large rows. Index on studyInstanceUID critical.

---

### `usg_extraction_logs`
**File:** `usgMeasurements.ts`
**Purpose:** Per-extraction-run log (status, frames processed, errors, duration).

### `usg_key_images`
**File:** `usgMeasurements.ts`
**Purpose:** Clinically significant DICOM frames flagged per study. Includes thumbnailBase64 (⚠️ large column).

### `usg_doppler_measurements`
**File:** `usgMeasurements.ts`
**Purpose:** Doppler measurements per vessel (PSV, EDV, RI, PI, S/D ratio).

### `usg_extraction_settings`
**File:** `usgMeasurements.ts` | Singleton (id=1)
**Purpose:** AI extraction pipeline configuration (confidence thresholds, OCR toggles).

### `usg_machine_profiles`
**File:** `usgMeasurements.ts`
**Purpose:** Registry of USG/Doppler machines (GE Voluson, etc.) used for source attribution.

### `usg_report_drafts`
**File:** `usgMeasurements.ts` | **PK:** `id` (serial)
**Purpose:** Draft USG/Doppler reports, auto-filled from approved measurements. Lifecycle: draft → pending_review → verified → finalized.

| Column | Type | Notes |
|--------|------|-------|
| templateType | text | OB_EARLY / OB_GROWTH / WHOLE_ABDOMEN / KUB / etc. |
| draftContent | text | Full report text |
| status | text | draft / pending_review / verified / finalized / amended |
| finalizedReportHash | text | SHA hash for tamper detection |
| lockedBy | text | Concurrent edit lock |

**Indexes:** studyInstanceUID, worklistId, status, patientId, finalizedReportHash

### `usg_report_amendments`
**File:** `usgMeasurements.ts`
**Purpose:** Full amendment history — every post-finalization change is a row here.

### `usg_finding_image_links`
**File:** `usgMeasurements.ts`
**Purpose:** Links report findings to specific key images/frames.

### `usg_audit_log`
**File:** `usgMeasurements.ts`
**Purpose:** Immutable action log for all USG/Doppler operations.

**Growth risk:** HIGH over time. Append-only. Needs archival strategy.

---

## 6. Radiology AI & Reporting Engine

### `radiology_report_generator_sessions`
**File:** `radiologyReportGenerator.ts`
**Purpose:** AI report generation sessions — stores input context, model used, output draft, acceptance status.

### `radiology_text_macros`
**File:** `radiologyReportGenerator.ts`
**Purpose:** User-defined text macros (shorthand expansions) for report dictation.

### `radiology_report_preferences`
**File:** `radiologyReportGenerator.ts`
**Purpose:** Per-user report preferences (font, spacing, section order, defaults).

### `radiology_image_references`
**File:** `radiologyReportGenerator.ts`
**Purpose:** Image references embedded in reports (WADO URLs, DICOM instance UIDs).

### `radiology_normal_snippets`
**File:** `radiologyReportGenerator.ts`
**Purpose:** Normal-range report snippets per modality (fast-insert for normal studies).

### `radiologist_style_preferences`
**File:** `radiologyReportGenerator.ts`
**Purpose:** Per-radiologist reporting style (structured/narrative, impression format).

### `radiology_report_lifecycle_log`
**File:** `radiologyReportGenerator.ts`
**Purpose:** Report lifecycle events (draft created, revised, finalized, delivered, amended).

### `spinal_measurements`
**File:** `radiologyReportGenerator.ts`
**Purpose:** Spine-specific measurements (disc heights, vertebral body dimensions, canal diameter).

### `radiology_smart_macros`
**File:** `radiologyReportGenerator.ts`
**Purpose:** Context-aware macros that auto-expand based on modality + body part.

---

### `radiology_workflow`
**File:** `radiologyWorkflow.ts`
**Purpose:** Study workflow state machine — tracks every status transition with actor and timestamp.

### `radiology_workflow_configs`
**File:** `radiologyWorkflow.ts`
**Purpose:** Configurable workflow definitions per modality (steps, required fields, SLA).

---

### `ai_reporting_sessions`
**File:** `aiReporting.ts` | **PK:** `id` (serial)
**Purpose:** Ollama/AI report generation sessions — prompt sent, response received, accepted or not.

### `ai_prompt_templates`
**File:** `aiPromptTemplates.ts`
**Purpose:** Admin-configurable prompt templates for different modalities/body parts.

### `ai_prompt_library`
**File:** `aiPromptLibrary.ts`
**Purpose:** Curated prompt library with tags, ratings, usage counts.

### `ai_model_routes`
**File:** `aiModelRoutes.ts`
**Purpose:** Model routing config — which AI model handles which task (GPT-4, Claude, Ollama, etc.).

### `ai_quality_scores`
**File:** `aiQualityScores.ts`
**Purpose:** Quality score tracking per AI response (accuracy, relevance, usefulness ratings).

### `ai_dicom_findings`
**File:** `aiDicomFindings.ts`
**Purpose:** AI-generated DICOM findings (CAD-like outputs) per study.

### `rag_documents`
**File:** `ragDocuments.ts`
**Purpose:** RAG (Retrieval-Augmented Generation) document store. Source texts for AI context retrieval.

### `ai_billing_suggestions`
**File:** `aiBillingSuggestions.ts`
**Purpose:** AI-generated billing code suggestions based on study description.

### `peer_review_assignments`
**File:** `peerReviewAssignments.ts`
**Purpose:** Peer review workflow — assigns one radiologist to review another's report.

### `turnaround_times`
**File:** `turnaroundTimes.ts`
**Purpose:** Configured TAT SLA targets per modality and priority.

### `ai_training_data_exports`
**File:** `aiTrainingDataExports.ts`
**Purpose:** Export batches of anonymized report data for AI model fine-tuning.

### `report_quality_gates`
**File:** `reportQualityGates.ts`
**Purpose:** Configurable quality check rules before a report can be finalized.

### `critical_findings` (global)
**File:** `criticalFindings.ts`
**Purpose:** Global critical finding notification log (separate from radiology-specific one).

### `ai_provider_health`
**File:** `aiProviderHealth.ts`
**Purpose:** Health check log for AI providers (Ollama, OpenAI, Anthropic) — latency and uptime.

### `ai_voice_transcriptions`
**File:** `aiVoiceTranscriptions.ts`
**Purpose:** Voice-to-text transcription logs for dictation feature.

### `ai_patient_communications`
**File:** `aiPatientCommunications.ts`
**Purpose:** AI-drafted patient communication messages (result notifications, follow-up reminders).

### `ai_normal_report_templates`
**File:** `aiNormalReportTemplates.ts`
**Purpose:** Pre-built normal-finding report templates for one-click finalization.

### `voice_dictation_logs`
**File:** `voiceDictationLogs.ts`
**Purpose:** Log of voice dictation events (start, stop, word count, accuracy score).

---

## 7. Radiology Knowledge & Memory

### `radiology_master_templates`
**File:** `radiologyKnowledge.ts` | Unique on `(groupName, templateName)`
**Purpose:** Locked master report templates per group (DR_SUGANDHA_MASTER, DR_ABINASH_MASTER, etc.).

### `radiology_template_versions`
**File:** `radiologyKnowledge.ts` | Unique on `(masterTemplateId, version)`
**Purpose:** Immutable version history of master templates.

### `radiology_personal_templates`
**File:** `radiologyKnowledge.ts` | FK → users.id
**Purpose:** Per-radiologist personal report templates (cloned or created from scratch).

### `radiology_template_packs`
**File:** `radiologyKnowledge.ts` | FK → users.id
**Purpose:** Multi-template packs (e.g., "MRI Brain Pack") grouping related templates.

### `radiology_knowledge_base`
**File:** `radiologyKnowledge.ts`
**Purpose:** Searchable knowledge articles with classification systems (BI-RADS, TI-RADS, PI-RADS, Fazekas, Bosniak).

### `radiologist_profiles`
**File:** `radiologyKnowledge.ts` | Unique on `staffId`
**Purpose:** Per-radiologist sign-off profile (default templates, AI toggles, preferences).

### `radiology_template_usage`
**File:** `radiologyKnowledge.ts` | FK → users.id
**Purpose:** Usage analytics per template per user (view/apply/clone/favorite actions).
**Growth risk:** High over time — append-only. Needs periodic aggregation.

### `radiology_template_favorites`
**File:** `radiologyKnowledge.ts` | Unique on `(staffId, templateId, templateSource)`
**Purpose:** Per-user favorite templates list.

### `radiology_template_comparison`
**File:** `radiologyKnowledge.ts`
**Purpose:** Snapshots of personal-vs-master template comparisons with diffs.

---

### Memory Engine Tables (8 tables)
**File:** `radiologyMemory.ts`

| Table | Purpose |
|-------|---------|
| `radiology_memory` | Master memory: finding text + impression per modality/body part per user |
| `radiology_memory_patterns` | Wording style preferences (variant selection tracking) |
| `radiology_memory_measurements` | Measurement history per patient per measurement type |
| `radiology_memory_classifications` | Classification usage (BI-RADS values, TI-RADS grades) |
| `radiology_memory_phrases` | Commonly typed phrase completions per trigger |
| `radiology_memory_impressions` | Approved impression drafts per finding signature |
| `radiology_memory_decisions` | Accept/reject/edit decision tracking for AI suggestions |
| `radiology_memory_feedback` | Explicit thumbs-up/down feedback on AI suggestions |
| `radiology_memory_usage` | Per-session usage statistics (suggestions offered/accepted/rejected) |

**Growth risk:** MEDIUM-HIGH. Grows with every reporting session. `_decisions` and `_usage` could become large. Consider daily aggregation.

---

## 8. Radiology Smart Features

### Smart Radiology (14+ tables)
**File:** `smartRadiology.ts` | 17,206 bytes

| Table | Purpose |
|-------|---------|
| `smart_radiology_worklist` | Enhanced worklist with smart triage features |
| `smart_priority_queue` | Priority-ranked study queue |
| `smart_assignment_log` | Radiologist auto-assignment history |
| `smart_routing_decisions` | AI-assisted routing decisions |
| `smart_report_sessions` | Smart reporting workspace sessions |
| `smart_findings_library` | Library of categorized findings |
| `smart_macro_library` | Context-aware macro library |
| Others | Various smart feature support tables |

### RIS Monitoring (multiple tables)
**File:** `risMonitoring.ts` | 9,413 bytes
**Purpose:** Radiology Information System monitoring — study volumes, TAT compliance, radiologist performance KPIs.

---

### Other Radiology Feature Tables

| Table | File | Purpose |
|-------|------|---------|
| `radiology_snippets` | `radiologySnippets.ts` | User-saved text snippets for report sections |
| `radiology_smart_findings` | `radiologySmartFindings.ts` | Smart findings with auto-impression generation |
| `radiology_lesions` | `radiologyLesions.ts` | Lesion tracking across serial studies |
| `radiology_organ_intelligence` | `radiologyOrganIntelligence.ts` | Organ-specific normal reference data |
| `radiology_annotations` | `radiologyAnnotations.ts` | DICOM viewer annotations (lines, arrows, ROI) |
| `radiology_ai_review_audits` | `radiologyAiReviewAudits.ts` | AI suggestion review audit records |
| `structured_report_templates` | `structuredReportTemplates.ts` | Alternate structured templates (JSON schema based) |
| `radiology_knowledge` | legacy route name | → see radiologyKnowledge.ts tables |
| `teaching_cases` | `teachingCases.ts` | Educational case library with annotated reports |
| `radiology_copilot_sessions` | `radiologyCopilot.ts` (inferred) | AI copilot session state |
| `spine_intelligence` | `radiologyOrganIntelligence.ts` | Spine-specific knowledge engine |
| `brain_intelligence` | `radiologyOrganIntelligence.ts` | Brain-specific knowledge engine |
| `tumor_followup` | `radiologyLesions.ts` (inferred) | Tumor follow-up tracking across time |

---

## 9. Echo Cardiology & Fetal USG

### Echo Cardiology Tables
**File:** `echoCardiology.ts` | 12,238 bytes

| Table | Purpose |
|-------|---------|
| `echo_studies` | Echocardiography study registry |
| `echo_measurements` | M-mode, 2D, Doppler measurements (LVEF, LV dimensions, valve gradients) |
| `echo_report_drafts` | Echo reports with structured findings |
| `echo_audit_log` | Immutable echo action log |

### Fetal USG Level 4 Tables
**File:** `fetalUsgLevel4.ts` | 9,337 bytes

| Table | Purpose |
|-------|---------|
| `fetal_usg_studies` | Level 4 anomaly scan registry |
| `fetal_measurements` | Comprehensive fetal biometry |
| `fetal_anomaly_findings` | Structured organ-by-organ findings |
| `fetal_usg_report_drafts` | Fetal scan reports |

---

## 10. Staff & HR

### `staff`
**File:** `staff.ts` | **PK:** `id` (serial)
**Purpose:** Physical staff/employee registry (HR records). Separate from `users` (ERP login accounts).

| Column | Type | Notes |
|--------|------|-------|
| staffId | text | UNIQUE — auto-generated ID |
| firstName, lastName | text | |
| role | text | |
| department | text | |
| baseSalary | numeric(10,2) | |
| bankAccount, ifsc | text | Payroll info |
| isActive | boolean | |

**Note:** `staff` (HR records) ≠ `users` (ERP login). May or may not be linked.

### `staff_counter`
**File:** `staff.ts` | Singleton counter for generating staffId numbers.

### `staff_advances`
**File:** `staff.ts` | FK → staff.id (cascade delete)
**Purpose:** Staff salary advance records (loan tracking).

### `staff_salary_payments`
**File:** `staff.ts` | FK → staff.id (cascade delete)
**Purpose:** Monthly salary payment records with breakdown.

### `staff_attendance`
**File:** `staff.ts` | Unique on `(staffId, attendanceDate)` | FK → staff.id
**Purpose:** Daily punch-in/punch-out records.

### `staff_biometric_credentials`
**File:** `staff.ts` | FK → staff.id (cascade delete)
**Purpose:** WebAuthn/FIDO2 credentials for staff biometric login.

### `bridge_fingerprint_templates`
**File:** `staff.ts`
**Purpose:** Fingerprint templates for USB biometric scanners (ZKTeco, Mantra, Morpho). Scoped to `staff` or `user`.

### `hr_rejoining_forms`
**File:** `staff.ts` | Unique on `formNumber` | FK → staff.id
**Purpose:** Comprehensive HR re-joining form (12 sections) — personal details, family, bank, salary structure, document checklist. Contains Aadhaar/PAN numbers.

⚠️ **PII sensitivity:** Contains Aadhaar, PAN, photo, family member details. Encrypt at rest if possible.

### `hr_rejoining_form_counter`
**File:** `staff.ts` | Singleton counter.

---

### `vendors`
**File:** `vendors.ts`
**Purpose:** Vendor/supplier registry for inventory and outsourced services.

---

## 11. Authentication & Sessions

### `users`
**File:** `users.ts` | **PK:** `id` (serial)
**Purpose:** ERP staff login accounts. Different from `staff` (HR records).

| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| name | text | Display name |
| email | text | UNIQUE |
| username | text | UNIQUE — preferred login handle |
| role | text | super_admin / admin / staff |
| permissions | text | JSON array of permission paths |
| pin | text | Hashed PIN for login |
| photoDataUrl | text | Base64 portrait (~800KB max) |
| sidebarTheme | text | UI preference |
| dicomPresets | jsonb | Saved DICOM search presets |
| mustChangePin | boolean | Force PIN change on next login |
| remoteLoginEnabled | boolean | Bypasses USB key requirement |
| failedLoginAttempts | integer | Brute-force counter |
| lockedUntil | timestamp | Account lockout expiry |
| maxConcurrentSessions | integer | |
| maxDiscount | numeric(5,2) | Per-user discount limit |
| isActive | boolean | Soft-delete |

---

### `portal_sessions`
**File:** `portalSessions.ts` | **PK:** `id` (serial)
**Purpose:** Active session tokens for both staff (scope=staff) and patient portal (scope=patient).

| Column | Type | Notes |
|--------|------|-------|
| token | text | UNIQUE bearer token |
| userId / patientId | integer | Depends on scope |
| scope | text | staff / patient |
| expiresAt | timestamp | |
| isActive | boolean | |
| lastActivityAt | timestamp | Idle timeout tracking |

**Growth risk:** HIGH. New row per login. Needs periodic cleanup of expired/inactive sessions.

---

### `user_sessions`
**File:** `staff.ts` | **PK:** `id` (serial)
**Purpose:** Fingerprint/PIN login sessions (bridge-specific sessions, parallel to portal_sessions).

⚠️ **Duplicate pattern:** Both `portal_sessions` and `user_sessions` track login sessions. Consolidation opportunity.

### `super_admin_sessions`
**File:** `users.ts` | **PK:** `token` (varchar 128)
**Purpose:** Super admin session tokens (separate portal).

### `webauthn_credentials`
**File:** `users.ts` | Unique on `credentialId`
**Purpose:** FIDO2/WebAuthn public key credentials for staff.

---

### `scan_sessions`
**File:** `scanSessions.ts` | **PK:** `id` (serial)
**Purpose:** Short-lived (5 min) QR code scan sessions for mobile document upload.

### `paired_devices`
**File:** `pairedDevices.ts`
**Purpose:** Registered mobile devices paired with staff for ongoing scan upload.

### `scan_audit_logs`
**File:** `scanAuditLogs.ts`
**Purpose:** Audit trail for all scan session events.

---

## 12. Settings & Configuration

### `clinic_settings`
**File:** `clinicSettings.ts` | **PK:** `id` (serial) | 15,128 bytes
**Purpose:** ⭐ MASTER config table. Single row. Stores all clinic-wide settings.

Includes: clinic name, logo, payment gateway credentials (Razorpay, PayU, PhonePe, ICICI, BharatPe), online booking config, Ollama config, idle timeouts, VIP settings, kiosk config, session limits, etc.

⚠️ **Contains credentials:** `iciciSecretKey`, `payuMerchantKey`, `razorpayKeyId` are stored here. ⚠️

---

### `ledgers`
**File:** `ledgers.ts`
**Purpose:** Accounting ledger accounts (Cash, UPI, Bank, NEFT, etc.).

### `machines`
**File:** `machines.ts` | 5,658 bytes
**Purpose:** Medical equipment registry with maintenance schedule tracking.

### `departments`
**File:** `departments.ts`
**Purpose:** Clinical department registry (Radiology, Pathology, OPD, etc.).

### `branches`
**File:** `branches.ts`
**Purpose:** Multi-branch clinic location registry.

### `floors`
**File:** `floors.ts`
**Purpose:** Floor registry per branch.

### `rooms`
**File:** `rooms.ts`
**Purpose:** Room registry per floor (examination rooms, reporting rooms).

### `modalities` (config table)
**File:** `modalities.ts`
**Purpose:** *(Distinct from dicom_nodes)* Modality display names and configuration for the ERP UI.

### `printer_settings`
**File:** `printerSettings.ts`
**Purpose:** Per-workstation printer configuration.

### `backup_logs`
**File:** `backupLogs.ts`
**Purpose:** Database backup operation logs.

### `backup_replication`
**File:** `backupReplication.ts`
**Purpose:** Replication target configuration (remote backup destinations).

### `email` settings
**File:** `email.ts`
**Purpose:** SMTP email configuration.

### `role_permissions`
**File:** `rolePermissions.ts`
**Purpose:** Permission templates per role — default permission sets for new users.

### `pacs_settings` (see Section 4)

### `upload_files`
**File:** `uploadFiles.ts`
**Purpose:** File attachment tracking (reports, documents, HR forms) — metadata only, actual files on disk.

### `signatures`
**File:** `signatures.ts`
**Purpose:** Doctor/radiologist digital signature images (base64) for report stamping.

---

## 13. Queue & Tokens

### `tokens`
**File:** `tokens.ts` | **PK:** `id` (serial)
**Purpose:** Patient queue tokens per visit/bill.

| Column | Type | Notes |
|--------|------|-------|
| billId | integer | → bills.id (logical) |
| tokenNo | integer | Sequential number |
| status | text | waiting / serving / done |
| ledgerId | integer | Which counter |

---

### `test_tokens`
**File:** `testTokens.ts` | **PK:** `id` (serial)
**Purpose:** Granular per-test queue tokens (individual test waiting room display).

| Column | Type | Notes |
|--------|------|-------|
| billId | integer | → bills.id (logical) |
| testId | integer | → tests.id (logical) |
| patientId | integer | → patients.id (logical) |
| tokenNo | integer | |
| status | text | waiting / serving / completed |
| department | text | |
| roomNumber | text | |
| ledgerId | integer | |
| priority | integer | 0 = normal, >0 = priority |
| calledAt | timestamp | When "Call Next" was pressed |
| tokenDate | date | |

**Indexes:** tokenDate, status, ledgerId, department
**Growth risk:** HIGH. ~2-5 rows per bill per day. 200,000–500,000 rows/year.

---

## 14. Accounting & Finance

### `accounting` / vouchers
**File:** `accounting.ts` | 3,834 bytes
**Purpose:** Double-entry accounting vouchers (debit/credit journal entries).

### `expenses`
**File:** `expenses.ts`
**Purpose:** Operational expenses (rent, utilities, consumables, staff expenses).

### `day_closures`
**File:** `dayClosures.ts` | 4,317 bytes
**Purpose:** Day-end close summary (total collections, denomination counts, supervisor approval).

### `user_day_closures`
**File:** `userDayClosures.ts` | 4,581 bytes
**Purpose:** Per-user shift close records (individual cashier's reconciliation).

### `drawer_audit_log`
**File:** `drawerAuditLog.ts`
**Purpose:** Cash drawer open/close events with reason.

---

## 15. Banking & Payments (Enterprise)

### `bank_accounts`
**File:** `banking.ts`
**Purpose:** Registered bank accounts (ICICI, HDFC, etc.) with provider config.

### `bank_transactions`
**File:** `banking.ts`
**Purpose:** Imported bank statement entries for reconciliation.

### `payment_requests`
**File:** `banking.ts`
**Purpose:** Outgoing payment requests (vendor payments, refunds).

### `webhook_logs`
**File:** `banking.ts`
**Purpose:** Raw banking webhook event log with signature verification status.

### `bank_audit_logs`
**File:** `banking.ts`
**Purpose:** Banking operation audit trail.

### `reconciliation_logs`
**File:** `banking.ts`
**Purpose:** Bank transaction ↔ ERP payment matching records with confidence scores.

### `fraud_alerts`
**File:** `banking.ts`
**Purpose:** Automated fraud detection alerts (duplicate UTR, bill-edited-after-payment, etc.).

### `shift_closures`
**File:** `banking.ts`
**Purpose:** Enterprise shift close with physical cash denomination count and bank deposit tracking.

### `gateway_transactions`
**File:** `banking.ts`
**Purpose:** Payment gateway transaction lifecycle (Razorpay, PhonePe, PayU, BharatPe) with settlement tracking.

### `refund_requests`
**File:** `banking.ts`
**Purpose:** Refund approval workflow with gateway-level tracking.

---

## 16. WhatsApp & Communications

### `whatsapp_settings`
**File:** `whatsappSettings.ts`
**Purpose:** WhatsApp Business API configuration.

### `whatsapp_numbers`
**File:** `whatsappNumbers.ts`
**Purpose:** Registered WhatsApp numbers and their verification status.

### `whatsapp` (messages)
**File:** `whatsapp.ts` | 7,256 bytes
**Purpose:** WhatsApp message log (sent/received, templates used, delivery status).

### `whatsapp_conversations`
**File:** `whatsappConversations.ts`
**Purpose:** Conversation threads (groups of messages per patient/number).

### `messages`
**File:** `messages.ts`
**Purpose:** General message store (SMS, email, WA — multi-channel).

### `conversations`
**File:** `conversations.ts`
**Purpose:** General conversation threads.

### `email` log
**File:** `email.ts`
**Purpose:** Email sending log (recipient, subject, status, provider response).

### `report_delivery_logs`
**File:** `reportDeliveryLogs.ts`
**Purpose:** Report delivery attempts log (WhatsApp, email, SMS) per patient report.

---

## 17. Website & Online Booking

### `site_settings`
**File:** `siteSettings.ts` | 3,308 bytes
**Purpose:** Public clinic website configuration (SEO, banners, hours, contact).

### `site_pages`
**File:** `sitePages.ts`
**Purpose:** CMS pages for the clinic website.

### `site_popups`
**File:** `sitePopups.ts`
**Purpose:** Website popup/announcement configuration.

### `online_bookings`
**File:** `onlineBookings.ts` | **PK:** `id` (serial)
**Purpose:** Online booking records from public booking portal.

| Column | Type | Notes |
|--------|------|-------|
| bookingRef | text | UNIQUE — `OB202506ABC123` |
| name, phone, email | text | |
| selectedDate | text | |
| testIds, packageIds | text | JSON arrays |
| totalAmount | text | ⚠️ Stored as text, not numeric |
| status | text | pending_payment / paid / confirmed / cancelled |
| razorpayOrderId, payuTxnId, etc. | text | Gateway-specific refs |
| billId | integer | → bills.id (after confirmation) |

---

## 18. Audit & Compliance

### `audit_logs`
**File:** `auditLogs.ts` | **PK:** `id` (serial)
**Purpose:** Global ERP action audit log — every sensitive action recorded.

| Column | Type | Notes |
|--------|------|-------|
| userId | integer | Who did it |
| userName | text | |
| action | text | login / bill_cancel / refund / etc. |
| entityType | text | bill / patient / user / etc. |
| entityId | integer | |
| details | text | JSON context |
| ipAddress | text | |
| createdAt | timestamp | |

**Growth risk:** HIGH. 50-500 entries/day. Will accumulate rapidly. Partition by month or archive after 1 year.

### `audit_runs`
**File:** `auditRuns.ts`
**Purpose:** Scheduled audit run records (books sanity, balance checks).

### `anomaly_alerts`
**File:** `anomalyAlerts.ts`
**Purpose:** Auto-detected financial anomalies (duplicate payments, unusual amounts).

### `hl7_integration_settings`
**File:** `hl7Schema.ts` | Singleton
**Purpose:** HL7 v2 integration configuration (sending/receiving facility, enabled message types).

### `hl7_messages`
**File:** `hl7Schema.ts`
**Purpose:** Incoming/outgoing HL7 message log (ADT, ORM, ORU).

---

### `teleradiology_users`
**File:** `teleradiologyUsers.ts`
**Purpose:** External teleradiologist accounts (separate from internal users) for remote reading.

### `dicom_agent` settings
**File:** `dicomAgent.ts`
**Purpose:** DICOM Pull Agent configuration and status.

### `sync_queue`
**File:** `syncQueue.ts`
**Purpose:** Offline-first sync queue for multi-branch data synchronization.

---

## 19. Outsourced Labs

### Outsourced Lab Tables
**File:** `outsourcedLabs.ts` | 13,582 bytes

| Table | Purpose |
|-------|---------|
| `outsourced_labs` | Registry of external labs |
| `outsourced_tests` | Tests sent to external labs |
| `outsourced_orders` | Orders dispatched to external labs |
| `outsourced_results` | Results received from external labs |
| `lab_communication_logs` | Communication history with labs |
| Others | Various outsourcing workflow support tables |

---

## 20. Sync & Infrastructure

### `backup_replication`
**File:** `backupReplication.ts`
**Purpose:** Remote backup replication targets (Synology NAS, S3, SFTP).

### `sync_queue`
**File:** `syncQueue.ts`
**Purpose:** Data change events queued for sync to secondary databases or remote branches.

---

## 21. AI Platform Tables

| Table | File | Purpose |
|-------|------|---------|
| `ai_reporting_sessions` | `aiReporting.ts` | Ollama/AI session logs |
| `ai_prompt_templates` | `aiPromptTemplates.ts` | Configurable prompts |
| `ai_prompt_library` | `aiPromptLibrary.ts` | Curated prompt library |
| `ai_model_routes` | `aiModelRoutes.ts` | Model routing config |
| `ai_quality_scores` | `aiQualityScores.ts` | AI output quality scores |
| `ai_dicom_findings` | `aiDicomFindings.ts` | AI DICOM annotations |
| `rag_documents` | `ragDocuments.ts` | RAG knowledge documents |
| `ai_billing_suggestions` | `aiBillingSuggestions.ts` | AI billing code suggestions |
| `ai_training_data_exports` | `aiTrainingDataExports.ts` | Fine-tuning export records |
| `ai_provider_health` | `aiProviderHealth.ts` | Provider uptime/latency log |
| `ai_voice_transcriptions` | `aiVoiceTranscriptions.ts` | Dictation transcription log |
| `ai_patient_communications` | `aiPatientCommunications.ts` | AI-drafted communications |
| `ai_normal_report_templates` | `aiNormalReportTemplates.ts` | Pre-built normal templates |

---

## Foreign Key Relationship Summary

### Explicit FK Constraints (Drizzle `.references()`)

| Table | Column | References | On Delete |
|-------|--------|-----------|-----------|
| `bills` | orderId | orders.id | — |
| `bills` | patientId | patients.id | — |
| `payments` | billId | bills.id | — |
| `staff_advances` | staffId | staff.id | CASCADE |
| `staff_salary_payments` | staffId | staff.id | CASCADE |
| `staff_attendance` | staffId | staff.id | CASCADE |
| `staff_biometric_credentials` | staffId | staff.id | CASCADE |
| `hr_rejoining_forms` | staffId | staff.id | CASCADE |
| `radiology_template_versions` | masterTemplateId | radiology_master_templates.id | CASCADE |
| `radiology_personal_templates` | staffId | users.id | CASCADE |
| `radiology_template_packs` | staffId | users.id | CASCADE |
| `radiology_template_usage` | staffId | users.id | CASCADE |
| `radiology_template_favorites` | staffId | users.id | CASCADE |
| `radiology_template_comparison` | staffId, personalTemplateId, masterTemplateId | users, personal_templates, master_templates | CASCADE |
| `radiologist_profiles` | staffId | users.id | CASCADE |

### Logical FKs (no constraint, referenced in code)

Most cross-module relationships are **logical only** — enforced by application code, not DB constraints. This is by design (Drizzle ORM with SQLite-compatible approach).

Key logical FKs:
- `radiology_studies.billId` → `bills.id`
- `radiology_studies.patientId` → `patients.id`
- `radiology_studies.testId` → `tests.id`
- `dicom_studies.patientId` → `patients.id`
- `dicom_pull_jobs.nodeId` → `dicom_nodes.id`
- `test_tokens.billId` → `bills.id`
- `portal_sessions.userId` → `users.id`
- `audit_logs.userId` → `users.id`
- `bank_transactions.bankAccountId` → `bank_accounts.id`
- `gateway_transactions.billId` → `bills.id`
- `reconciliation_logs.bankTransactionId` → `bank_transactions.id`
