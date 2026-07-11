# DATABASE ARCHITECTURE AUDIT
## Care Diagnostics ERP — Complete Database Audit
**Date:** 26 June 2026 | **Checkpoint:** checkpoint/pre-db-architecture-audit-20260626-2323  
**Mode:** Read-Only — No schema changes  
**Schema files:** 113 | **Tables:** 305 | **FK constraints:** 71 | **JSONB columns:** 43 | **text() date fields:** 37

---

## DATABASE PRODUCTION READINESS SCORE: 74 / 100

| Dimension | Score |
|-----------|-------|
| Schema Correctness | 78/100 |
| Referential Integrity | 65/100 |
| Index Coverage | 72/100 |
| Financial Data Safety | 90/100 |
| Audit Trail | 85/100 |
| Data Type Appropriateness | 60/100 |
| Radiology Linkage | 70/100 |
| JSONB Safety | 68/100 |

---

## PHASE 1 — COMPLETE TABLE INVENTORY (305 tables across 113 schema files)

### 🧑 PATIENT MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| patients | id, patient_id (text unique), first_name, last_name, phone, dob, gender | ✅ Core entity |
| patient_counter | id, counter | Atomic counter for patient_id generation |
| portal_sessions | token, patient_id, expires_at | Patient self-service portal |
| ppointments | id, patient_id, doctor_id, date, time, status | Appointment booking |
| orm_f | id, patient_id, order_id, ... | Radiological Form-F compliance |

### 📋 ORDERS MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| orders | id, order_number (unique), patient_id FK, doctor_id FK, status, total_amount | ✅ |
| order_tests | id, order_id FK, test_id FK, price, result, status | ✅ Junction table |
| 	ests | id, name, code, category_id, price, department | ✅ Test catalogue |
| 	est_categories | id, name, parent_id | ✅ Hierarchical |
| packages | id, name, tests (jsonb), price | ⚠️ tests stored as JSONB array |
| discount_reasons | id, name, max_pct | ✅ |
| discounts | id, code, type, value, valid_from, valid_to | ✅ |

### 💰 BILLING MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| ills | id, bill_number (unique), order_id FK, patient_id FK, subtotal, discount, tax_amount, total_amount, paid_amount, balance_amount, refund_amount, original_total, status | ✅ Core financial entity |
| payments | id, bill_id FK, amount, method, reference_number, recorded_by_name | ✅ |
| ill_audits | id, bill_id (no FK!), edited_by, change_type, old_value, new_value | ⚠️ Missing FK |
| online_bookings | id, booking_ref (unique), name, phone, test_ids (text JSON!), patient_id (no FK!), bill_id (no FK!) | ⚠️ Multiple missing FKs |
| payment_logs | id, booking_ref, gateway, amount, status, request_payload, response_payload | ✅ Gateway audit |

### 📊 ACCOUNTING MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| ccounts | id, name, type, code (unique), tally_group, opening_balance | ✅ |
| ouchers | id, voucher_number (unique), type, date (text!), credit_account_id (text!), debit_account_id (text!), amount, bill_id (no FK!) | ⚠️ account IDs stored as text |
| oucher_audits | id, voucher_id (no FK!), voucher_number, edited_by, change_type | ⚠️ Missing FK |
| ledgers | id, name (unique), is_default, is_walk_in | ✅ Simple |
| expenses | id, expense_id (unique), category, amount, expense_date (text!), voucher_id (no FK!) | ⚠️ text date, missing FK |
| expense_counter | id, counter | Counter for EXP-YYYYMM-NNN |
| day_closures | id, closure_date, closed_at, expected/actual by method, staff_breakdown (jsonb), test_summary (jsonb), expense_details (jsonb), refund_details (jsonb) | ⚠️ 4 JSONB aggregates |
| user_day_closures | id, user_id (no FK!), closure_date, expected/actual, denominations (jsonb), drawer_status | ⚠️ Missing FK on user_id |
| drawer_audit_log | id, user_id, action, old_status, new_status | ✅ |
| doctor_payouts | id, doctor_id FK, period, amount, status | ✅ |
| commission | id, doctor_id FK, order_id FK, test_id FK, amount, rate | ✅ |
| anking (19KB!) | 10+ tables: bank_accounts, bank_transactions, bank_reconciliations, etc. | ✅ Comprehensive |

### 🔬 RADIOLOGY MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| adiology_studies | id, accession_number (unique), bill_id (no FK!), order_id (no FK!), order_test_id (unique, no FK!), patient_id (no FK!), test_id (no FK!), modality, status, study_instance_uid, pacs_archive_status | ⚠️ 5 missing FKs |
| adiology_film_issues | id, study_id (no FK!), issue_type | ⚠️ Missing FK |
| adiology_prompts | id, name, content, modality | ✅ |
| adiology_priority_rules | id, name, priority, body_part_pattern | ✅ |
| adiology_worklist | Multiple tables in radiologyWorklist.ts | See PACS audit |
| adiology_share_links | id, study_id FK, token (unique), expires_at | ✅ |
| adiology_report_generator (16KB!) | prelim/final report data, key images, macros, lifecycle log | ✅ |
| adiology_annotations | id, study_id, annotation_data (jsonb) | ✅ |
| adiology_lesions | id, patient_id, study_id, lesion_data (jsonb) | ✅ |
| adiology_memory (11KB!) | patient history, prior comparisons | ✅ |
| adiology_knowledge (12KB!) | template library, KB entries | ✅ |
| adiology_smart_findings | id, study_id, findings (jsonb) | ✅ |
| adiology_snippets | id, user_id, content, tags | ✅ |
| adiology_organ_intelligence | spine, brain, tumor tables | ✅ |
| enterprise_radiology (11KB!) | MWL procedures, DICOM routing, C-MOVE jobs | ✅ |
| 	urnaround_times | id, study_id, event, recorded_at | ✅ TAT tracking |
| peer_review_assignments | id, study_id, reviewer_id, status | ✅ |
| critical_findings | id, study_id, finding, acknowledged_at | ✅ |
| eport_quality_gates | id, study_id, gate_name, passed | ✅ |
| adiology_ai_review_audits | id, study_id, ai_model, verdict | ✅ |

### 🏥 PACS / DICOM MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| dicom (6KB) | dicom_nodes, dicom_modality_worklist | ✅ |
| dicom_studies | id, study_instance_uid (unique), accession_number, patient_id (no FK!), linked_bill_id (no FK!), linked_order_id (no FK!), dicom_metadata (jsonb) | ⚠️ 3 missing FKs + heavy JSONB |
| dicom_study_series | id, study_id (no FK!), series_instance_uid | ⚠️ Missing FK |
| dicom_agent | pulled study queue, status tracking | ✅ |
| dicom_pulled_studies | id, study_uid, patient_match_status | ✅ |
| dicom_routing_rules | id, source_ae, dest_ae, rules (jsonb) | ✅ |
| pacs_settings | id, provider, orthanc_url, viewer_type, wado_url | ✅ |

### 🧪 PATHOLOGY / SAMPLES
| Table | Key Columns | Notes |
|-------|-------------|-------|
| samples | id, barcode (unique), order_id FK, patient_id FK, status, outsource_* | ✅ |
| sample_test_assignments | sample_id FK cascade, order_test_id FK cascade, unique(sample_id, order_test_id) | ✅ |
| outsourced_labs (13KB!) | labs, rate_cards, cost_entries, reconciliation | ✅ |

### 👩‍💼 HR MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| staff | id, staff_id (unique), first_name, role, base_salary, bank_account | ✅ |
| staff_counter | id, counter | ✅ |
| staff_advances | id, staff_id FK cascade, amount, recovered_amount, status | ✅ |
| staff_salary_payments | id, staff_id FK cascade, month_year, net_amount | ✅ |
| staff_attendance | id, staff_id FK cascade, date, punch_in/out, unique(staff_id, date) | ✅ |
| staff_biometric_credentials | id, staff_id FK cascade | ✅ |

### 🌐 WEBSITE / ONLINE BOOKING
| Table | Key Columns | Notes |
|-------|-------------|-------|
| site_settings | id, clinic_name, theme, SEO fields | ✅ |
| site_pages | id, slug (unique), content (jsonb) | ✅ |
| site_popups | id, title, content | ✅ |
| online_bookings | id, booking_ref (unique), test_ids (text JSON), patient_id (no FK) | ⚠️ |

### 🎫 QUEUE MANAGEMENT
| Table | Key Columns | Notes |
|-------|-------------|-------|
| 	okens | id, token_number, order_id (no FK!), patient_id (no FK!), department, status, called_at | ⚠️ Missing FKs |
| 	est_tokens | id, order_test_id (no FK!), token_number, status | ⚠️ Missing FK |

### 🤖 AI MODULE
| Table | Key Columns | Notes |
|-------|-------------|-------|
| i_reporting (4.7KB) | drafts, sessions, usage logs | ✅ |
| i_prompt_templates | id, name, modality, content | ✅ |
| i_prompt_library | id, category, prompt, tags | ✅ |
| i_model_routes | id, modality, provider, model | ✅ |
| i_quality_scores | id, study_id, score, dimension | ✅ |
| i_dicom_findings | id, study_id, findings (jsonb) | ✅ |
| i_billing_suggestions | id, patient_id (no FK!), suggestions (jsonb) | ⚠️ |
| i_voice_transcriptions | id, user_id, audio_ref, transcript | ✅ |
| i_training_data_exports | id, study_id, labels, annotations | ✅ |
| ag_documents | id, content, embedding_ref, source | ✅ |
| nomaly_alerts | id, entity_type, entity_id, rule, detected_at | ✅ |

### 🔐 AUTH / SECURITY
| Table | Key Columns | Notes |
|-------|-------------|-------|
| users | id, email (unique), username (unique), role, pin (hashed), permissions (text!), failed_login_attempts, locked_until | ⚠️ permissions stored as text |
| super_admin_sessions | token (PK), user_id, expires_at, is_active | ✅ |
| webauthn_credentials | id, user_id (no FK!), credential_id (unique), public_key | ⚠️ Missing FK |
| staff | separate from users — HR records (not auth) | ✅ Intentional split |
| ole_permissions | id, role_name, module, permissions (jsonb) | ✅ |

### ⚙️ SETTINGS / CONFIG
| Table | Key Columns | Notes |
|-------|-------------|-------|
| clinic_settings (15KB!) | 80+ columns — MEGA table | ⚠️ God table |
| email | id, smtp_host, smtp_port, api_key | ✅ |
| printer_settings | id, name, type, connection | ✅ |
| machines (5.6KB) | modalities, maintenance, calibration | ✅ |
| departments | id, name, code | ✅ |
| ranches | id, name, address, is_active | ✅ |
| loors | id, name, branch_id | ✅ |
| ooms | id, name, floor_id, type | ✅ |
| modalities | id, name, ae_title, ip | ✅ |

### 📦 AUDIT / SYSTEM
| Table | Key Columns | Notes |
|-------|-------------|-------|
| udit_logs | id, user_id, action, module, entity_type, entity_id, old_value, new_value, chain_hash | ✅ Cryptographic chain |
| udit_runs | id, run_type, status, results (jsonb) | ✅ |
| ackup_logs | id, type, status, file_path, size | ✅ |
| ackup_replication | id, source, target, schedule | ✅ |
| sync_queue | id, entity_type, entity_id, action, status | ✅ |
| upload_files | id, original_name, stored_path, mime_type, size | ✅ |
| scan_sessions | id, session_token, device_name, user_id (no FK!) | ⚠️ |
| paired_devices | id, device_id, user_id (no FK!), paired_at | ⚠️ |
| oice_dictation_logs | id, user_id, study_id, transcript | ✅ |

---

## PHASE 2 — RELATIONSHIP AUDIT

### ✅ CORRECTLY WIRED FOREIGN KEYS (71 total)
- orders.patient_id → patients.id ✅
- orders.doctor_id → doctors.id ✅
- order_tests.order_id → orders.id ✅
- order_tests.test_id → tests.id ✅
- ills.order_id → orders.id ✅
- ills.patient_id → patients.id ✅
- payments.bill_id → bills.id ✅
- samples.order_id → orders.id ✅
- samples.patient_id → patients.id ✅
- sample_test_assignments.sample_id → samples.id CASCADE ✅
- sample_test_assignments.order_test_id → order_tests.id CASCADE ✅
- inventory_items.preferred_vendor_id → vendors.id SET NULL ✅
- inventory_transactions.item_id → inventory_items.id ✅
- inventory_consumption_rules.test_id → tests.id ✅
- staff_advances.staff_id → staff.id CASCADE ✅
- staff_salary_payments.staff_id → staff.id CASCADE ✅
- staff_attendance.staff_id → staff.id CASCADE ✅
- adiology_share_links.study_id → radiology_studies.id ✅

### ⚠️ MISSING FOREIGN KEYS — HIGH RISK

| Table | Column | Should reference | Risk |
|-------|--------|------------------|------|
| ill_audits | ill_id | ills.id | Orphaned audit rows if bill deleted |
| adiology_studies | ill_id | ills.id | Unlinked studies after bill cancel |
| adiology_studies | order_id | orders.id | Cannot JOIN without FK |
| adiology_studies | patient_id | patients.id | Patient merge risks |
| adiology_studies | 	est_id | 	ests.id | Test deletion → dangling reference |
| adiology_studies | order_test_id | order_tests.id | No cascade protection |
| adiology_film_issues | study_id | adiology_studies.id | Orphan film records |
| dicom_studies | patient_id | patients.id | Patient match not enforced |
| dicom_studies | linked_bill_id | ills.id | Soft link, can go stale |
| dicom_studies | linked_order_id | orders.id | Same |
| dicom_study_series | study_id | dicom_studies.id | Orphan series |
| ouchers | ill_id | ills.id | Voucher linked to deleted bill |
| ouchers | credit_account_id | ccounts.id | Stored as TEXT — no FK possible |
| ouchers | debit_account_id | ccounts.id | Stored as TEXT — no FK possible |
| oucher_audits | oucher_id | ouchers.id | Audit survives voucher delete |
| expenses | oucher_id | ouchers.id | Expense detached from voucher |
| online_bookings | patient_id | patients.id | Booking can reference non-existent patient |
| online_bookings | ill_id | ills.id | Bill link unprotected |
| 	okens | order_id | orders.id | Token orphaned on order delete |
| 	okens | patient_id | patients.id | Same |
| 	est_tokens | order_test_id | order_tests.id | Same |
| user_day_closures | user_id | users.id | Drawer record survives user deletion |
| webauthn_credentials | user_id | users.id | Key survives user deletion |
| i_billing_suggestions | patient_id | patients.id | Stale AI suggestions |
| scan_sessions | user_id | users.id | Session orphaned on user delete |
| paired_devices | user_id | users.id | Same |

**Total missing FKs: 26**

### ⚠️ DANGEROUS CASCADE RULES

| Table | FK | Cascade | Risk |
|-------|----|---------|------|
| staff_advances | staff_id → staff.id | CASCADE DELETE | Deleting a staff member silently erases all advance payment history |
| staff_salary_payments | staff_id → staff.id | CASCADE DELETE | Salary records permanently deleted with staff |
| staff_attendance | staff_id → staff.id | CASCADE DELETE | HR / payroll records deleted |
| staff_biometric_credentials | staff_id → staff.id | CASCADE DELETE | Acceptable — auth artifact |
| sample_test_assignments | sample_id → samples.id | CASCADE DELETE | Acceptable |

**Recommendation:** Change staff_advances, staff_salary_payments, staff_attendance to RESTRICT or SET NULL. HR records are financial / legal records and must never be silently deleted.

### ⚠️ JSON FIELDS THAT SHOULD BE NORMALIZED

| Table | Column | Content | Risk |
|-------|--------|---------|------|
| packages | 	ests (jsonb) | Array of test IDs | No FK enforcement; test deleted → silent broken package |
| online_bookings | 	est_ids | TEXT, not JSONB! JSON encoded as text string | Double-parse risk |
| online_bookings | package_ids | TEXT, not JSONB! | Same |
| day_closures | staff_breakdown | JSONB staff summary | Analytics only, acceptable |
| day_closures | 	est_summary | JSONB test breakdown | Analytics only, acceptable |
| day_closures | expense_details | JSONB expense list | Duplicates expenses table |
| day_closures | efund_details | JSONB refund list | Duplicates bills.refund_amount |
| dicom_studies | dicom_metadata | Full DICOM tag dump JSONB | Can grow to MB per row |
| users | permissions | TEXT (JSON string) | Should be JSONB or normalized to role_permissions |
| users | dicom_presets | JSONB | Acceptable user preference |
| ole_permissions | permissions | JSONB permission map | Acceptable |
| clinic_settings | Multiple JSON columns | ollama_known_models, online_booking_services, service_images | Minor — config data |

---

## PHASE 3 — FINANCIAL TABLE DEEP AUDIT

### bills table
- ✅ 	otal_amount = immutable original invoice (preserved per audit)
- ✅ original_total = pre-discount copy (redundant but safe)
- ✅ efund_amount tracked separately
- ✅ alance_amount = MAX(0, total − paid − refund) — invariant verified
- ✅ ill_number unique constraint
- ✅ status values: pending | partial | paid | cancelled (text, not enum)
- ⚠️ No CHECK constraint enforcing alance_amount >= 0
- ⚠️ No CHECK constraint enforcing paid_amount >= 0
- ⚠️ No CHECK constraint enforcing 	otal_amount >= 0
- ⚠️ status is unconstrained text — any string can be inserted

### payments table
- ✅ ill_id FK to bills
- ✅ mount numeric(10,2)
- ✅ method text (cash|upi|card|cheque|bank|online — unconstrained)
- ⚠️ No unique constraint on eference_number — duplicate gateway refs technically insertable
- ⚠️ No FK from payments back to users — only ecorded_by_name (text)
- ⚠️ No soft-delete — payments are permanent (correct for accounting but no reversal flag)

### vouchers table
- ⚠️ credit_account_id and debit_account_id stored as TEXT — no FK to accounts
- ⚠️ date stored as TEXT, not date type — no date validation at DB level
- ✅ oucher_number unique
- ✅ mount numeric(12,2) — wider precision than payments (good)
- ⚠️ ill_id integer but no FK — orphan vouchers if bill deleted

### expenses table
- ⚠️ expense_date stored as TEXT — no DB-level date constraint
- ⚠️ oucher_id integer but no FK to vouchers
- ⚠️ No created_by_name or user reference for the creator
- ✅ mount numeric(10,2)

### day_closures table
- ✅ closure_date is date type (correct)
- ✅ closed_at timezone-aware timestamp
- ⚠️ No unique constraint on closure_date — two closures on same day possible
- ⚠️ staff_breakdown JSONB duplicates data already in payments table (stale on re-open)
- ⚠️ No index on closure_date for quick lookups

### online_bookings / gateway payments
- ✅ ooking_ref unique
- ⚠️ 	est_ids and package_ids stored as TEXT (JSON string) not JSONB
- ⚠️ patient_id and ill_id have no FK constraint
- ✅ Multiple gateway transaction IDs stored (ICICI, Razorpay, PhonePe, BharatPe, PayU)
- ⚠️ No unique constraint on gateway transaction IDs (could theoretically process same txn twice if webhook fires race)

---

## PHASE 4 — RADIOLOGY / PACS TABLE AUDIT

### StudyInstanceUID Linkage Chain
`
DICOM Image (on Orthanc/Conquest)
    ↓ StudyInstanceUID
dicom_studies.study_instance_uid [UNIQUE ✅]
    ↓ accession_number (text, nullable)
radiology_studies.accession_number [UNIQUE ✅]
    ↓ order_test_id (no FK ⚠️)
order_tests.id
    ↓ order_id FK ✅
orders.id
    ↓ patient_id FK ✅
patients.id
`

**Gap:** dicom_studies.accession_number → radiology_studies.accession_number is a soft text JOIN, no FK. If accession format changes or study is re-mapped, the link silently breaks.

### radiology_studies Risks
- ⚠️ ill_id, order_id, patient_id, 	est_id, order_test_id — all integers WITHOUT FK constraints
- ✅ ccession_number has UNIQUE index
- ✅ order_test_id has UNIQUE index (one study per test)
- ✅ Indexes on: status, study_date, priority
- ⚠️ Missing index on patient_id (patient study history queries)
- ⚠️ Missing index on ill_id (billing-to-study lookup)
- ⚠️ study_instance_uid nullable — study can exist without DICOM UID until acquired
- ⚠️ pacs_archive_status unconstrained text

### dicom_studies Risks
- ✅ 9 indexes defined (excellent coverage)
- ✅ study_instance_uid UNIQUE
- ⚠️ dicom_metadata JSONB can grow to 2–5 MB per row for large studies
- ⚠️ patient_id nullable (matched later) — risk of permanent unmatched studies
- ⚠️ No cascade cleanup of dicom_study_series when dicom_studies deleted

### Report Lifecycle Fragmentation
Reports are spread across:
1. adiology_studies.prelim_report (text) — inline
2. adiology_studies.final_report (text) — inline
3. adiology_report_generator tables — structured drafts
4. patient_reports — final published reports
5. i_reporting — AI-assisted drafts

**Risk:** Five parallel report stores with no enforced FK chain between them. A final report in patient_reports may not correspond to any adiology_studies row.

---

## PHASE 5 — INDEX & PERFORMANCE AUDIT

### EXISTING INDEXES (well-covered)
- ✅ adiology_studies: accession_number (UNIQUE), order_test_id (UNIQUE), status, study_date, priority
- ✅ dicom_studies: study_instance_uid, accession_number, patient_id, modality, link_status, radiologist_id, priority, report_id
- ✅ udit_logs: user_id, action, module, (entity_type, entity_id), created_at, chain_hash
- ✅ staff_attendance: unique(staff_id, date)
- ✅ samples: barcode (UNIQUE)
- ✅ sample_test_assignments: unique(sample_id, order_test_id)

### MISSING INDEXES — CRITICAL

| Table | Missing Index | Query Impact |
|-------|--------------|--------------|
| ills | (status, balance_amount) | Outstanding dues SUM — full scan ✅ Added by migration |
| ills | (created_at) | Daily summary date filter — full scan ✅ Added |
| ills | (bill_number) | MAX() for sequence generation ✅ Added |
| ills | (patient_id) | Patient billing history — full scan |
| payments | (bill_id, created_at) | Payment history per bill ✅ Added |
| payments | (method, created_at) | Daily method-wise summary |
| payments | (created_at) | Date range payment totals |
| ouchers | (date) | Voucher date filter (text date!) |
| ouchers | (type, date) | Voucher type filter for Tally export |
| expenses | (expense_date) | Expense date filter (text date!) |
| patients | (phone) | Patient phone search — full scan |
| patients | (first_name, last_name) | Patient name search — full scan |
| patients | (created_at) | New patient count by date |
| orders | (patient_id, created_at) | Patient order history |
| orders | (status) | Pending orders worklist |
| order_tests | (order_id) | Tests per order (very common) |
| 	okens | (order_id, status) | Queue lookup by order |
| 	okens | (department, status, created_at) | Department queue display |
| 	est_tokens | (order_test_id) | Token per test lookup |
| online_bookings | (status, created_at) | Booking management table |
| online_bookings | (phone) | Patient booking search |
| adiology_studies | (patient_id) | Patient radiology history |
| adiology_studies | (bill_id) | Billing-to-study navigation |
| adiology_studies | (assigned_radiologist_id, status) | Radiologist worklist |
| samples | (order_id) | Samples per order |
| samples | (status) | Lab pending samples list |
| udit_logs | (created_at DESC) | Already indexed ✅ |
| day_closures | (closure_date) | Day close lookup by date |
| user_day_closures | (user_id, closure_date) | Per-user closure history |
| ouchers | (bill_id) | Bill-linked vouchers |
| expenses | (created_at) | Expense by date |

---

## PHASE 6 — AUDIT TRAIL & IMMUTABILITY

| Event | Audit Coverage | Notes |
|-------|---------------|-------|
| Bill creation | ✅ udit_logs + ill_audits | Both channels |
| Bill edit (super-edit) | ✅ ill_audits per field | Old/new values stored |
| Bill cancellation | ✅ ill_audits + udit_logs | Reason stored |
| Payment recorded | ✅ udit_logs | Not in ill_audits (by design) |
| Refund issued | ✅ ill_audits + udit_logs | refund_amount change tracked |
| Expense created | ⚠️ Only udit_logs (if wired) | No dedicated expense_audits table |
| Voucher edited | ✅ oucher_audits per field | Old/new values |
| Day close | ✅ day_closures row | Immutable after creation |
| Day close re-open | ✅ eopenedAt, eopenedByName on same row | Super-admin action |
| User drawer approve | ✅ drawer_audit_log | Approval trail |
| Report finalized | ⚠️ adiology_studies.final_report (overwriteable text!) | No version history |
| Report amended | ⚠️ No eport_amendments table | Amendment not tracked separately |
| PACS match | ⚠️ dicom_studies.link_reason only | No change history |
| User created | ✅ udit_logs | |
| Permission changed | ✅ udit_logs | |
| Settings changed | ✅ udit_logs | |
| Login / logout | ✅ udit_logs | |
| Audit log chain | ✅ SHA-256 chain hash | Tamper-detectable |

**Critical Gap:** adiology_studies.final_report is a TEXT column that can be overwritten without version tracking. If a radiologist amends a finalized report, the old text is gone.

---

## PHASE 7 — DATA RETENTION & SAFETY

| Area | Current State | Risk | Recommendation |
|------|--------------|------|----------------|
| **Soft delete** | ❌ None on any table | Hard delete permanently removes records | Add deleted_at to patients, bills, orders |
| **Bills** | No delete endpoint — bills are cancelled (status=cancelled) | ✅ Safe | |
| **Patients** | No delete endpoint visible in schema | ✅ Likely safe | Confirm no DELETE in patients.ts route |
| **Reports** | inal_report TEXT on radiology_studies — overwriteable | ⚠️ No version history | Add report versions table |
| **DICOM metadata** | Stored in JSONB dicom_metadata — no separate archive | ⚠️ DB bloat risk | Offload large metadata to object storage |
| **Backups** | ackup_logs table exists | ✅ Tracked | No automated backup service in Docker |
| **Audit logs** | Chain-hashed — tamper evident | ✅ | No auto-purge; will grow indefinitely |
| **Old vouchers** | No archive table | ⚠️ All vouchers in single table | Add rchived_at after 3 years |
| **HR records** | CASCADE DELETE on staff | ❌ Legal retention risk | Change to RESTRICT |
| **Legal retention** | Medical records: 7 years (India) | ⚠️ No enforcement | Must not delete patient/report data |
| **DICOM retention** | Images in Orthanc (external) | ⚠️ No ERP-level retention policy | Implement Orthanc storage lifecycle |

---

## SUMMARY RISK TABLE

| Risk ID | Severity | Category | Description |
|---------|----------|----------|-------------|
| DB-CRIT-01 | 🔴 CRITICAL | Referential Integrity | 26 missing FK constraints across financial and clinical tables |
| DB-CRIT-02 | 🔴 CRITICAL | Data Type | ouchers.credit_account_id and debit_account_id stored as TEXT — no FK enforcement possible |
| DB-CRIT-03 | 🔴 CRITICAL | Cascades | Staff financial records (advances, salary) delete on CASCADE — legal data loss risk |
| DB-HIGH-01 | 🟠 HIGH | Data Type | expenses.expense_date stored as TEXT — date validation bypassed at DB level |
| DB-HIGH-02 | 🟠 HIGH | Data Type | ouchers.date stored as TEXT — same risk |
| DB-HIGH-03 | 🟠 HIGH | Data Type | online_bookings.test_ids stored as TEXT (not JSONB) — double-parse risk |
| DB-HIGH-04 | 🟠 HIGH | Missing Constraint | ills.status unconstrained text — any value insertable |
| DB-HIGH-05 | 🟠 HIGH | Missing Constraint | No CHECK constraints on ills.balance_amount >= 0, paid_amount >= 0 |
| DB-HIGH-06 | 🟠 HIGH | Missing Index | patients(phone), patients(first_name, last_name) — patient search full scan |
| DB-HIGH-07 | 🟠 HIGH | Missing Index | ills(patient_id) — patient billing history full scan |
| DB-HIGH-08 | 🟠 HIGH | Missing Index | adiology_studies(patient_id, assigned_radiologist_id) — worklist queries slow |
| DB-HIGH-09 | 🟠 HIGH | Audit Gap | adiology_studies.final_report overwriteable without version tracking |
| DB-HIGH-10 | 🟠 HIGH | Schema | clinic_settings is a 80+ column God table — schema risk |
| DB-MED-01 | 🟡 MEDIUM | Data Integrity | day_closures no unique constraint on closure_date — two closes same day possible |
| DB-MED-02 | 🟡 MEDIUM | Performance | dicom_studies.dicom_metadata JSONB can grow to MB per row |
| DB-MED-03 | 🟡 MEDIUM | Normalization | packages.tests JSONB array of IDs — no FK enforcement |
| DB-MED-04 | 🟡 MEDIUM | Retention | No soft delete on any table |
| DB-MED-05 | 🟡 MEDIUM | Fragmentation | 5 parallel report stores with no FK chain |
| DB-MED-06 | 🟡 MEDIUM | Missing Index | 20+ missing indexes on high-query columns |
| DB-LOW-01 | 🟢 LOW | Naming | Counter tables (patient_counter, expense_counter, staff_counter) could be sequences |
| DB-LOW-02 | 🟢 LOW | Audit | No dedicated expense_audits table |
| DB-LOW-03 | 🟢 LOW | Schema | users.permissions stored as TEXT JSON — should be JSONB |

---

*Audit Date: 26 June 2026 | Read-only — no schema modified | Git checkpoint: checkpoint/pre-db-architecture-audit-20260626-2323*
