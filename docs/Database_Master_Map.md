# Database_Master_Map.md
**Care Diagnostics ERP — Database Architecture Master Map**
*Generated: 2026-06-24 | Total Schema Files: 115 | Estimated Tables: ~230*
*PostgreSQL via Drizzle ORM | Synology NAS Docker Container*

---

## 1. Entity Relationship Overview

```
PATIENTS (master)
    │
    ├── ORDERS (one per visit)
    │       │
    │       └── BILLS (financial record)
    │               │
    │               ├── PAYMENTS (payment events)
    │               ├── TOKENS (queue)
    │               ├── TEST_TOKENS (per-test queue)
    │               ├── ONLINE_BOOKINGS (if online origin)
    │               └── GATEWAY_TRANSACTIONS (payment gateway)
    │
    ├── RADIOLOGY_STUDIES (one per radiology test ordered)
    │       │
    │       ├── RADIOLOGY_WORKLIST (PACS-side view)
    │       ├── RADIOLOGY_REPORT_VERIFICATIONS
    │       ├── RADIOLOGY_CRITICAL_FINDINGS
    │       ├── RADIOLOGY_TAT_TRACKING
    │       ├── RADIOLOGY_STUDY_LOCKS
    │       ├── RADIOLOGY_AI_ENHANCEMENTS
    │       └── RADIOLOGY_FILM_ISSUES
    │
    ├── DICOM_STUDIES (PACS ingested studies)
    │       │
    │       ├── DICOM_STUDY_SERIES
    │       ├── DICOM_STUDY_AUDIT_LOG
    │       ├── AI_EXTRACTION_RESULTS
    │       └── TECHNICIAN_WORKFLOW
    │
    ├── USG_MEASUREMENTS (per USG study)
    │       │
    │       ├── USG_DOPPLER_MEASUREMENTS
    │       ├── USG_KEY_IMAGES
    │       ├── USG_REPORT_DRAFTS
    │       │       └── USG_REPORT_AMENDMENTS
    │       └── USG_AUDIT_LOG
    │
    ├── SAMPLES (lab samples)
    ├── FORM_F (PC-PNDT compliance)
    └── APPOINTMENTS

USERS (staff ERP accounts)
    ├── PORTAL_SESSIONS (auth tokens)
    ├── RADIOLOGY_PERSONAL_TEMPLATES
    ├── RADIOLOGY_MEMORY (all 9 memory tables)
    ├── RADIOLOGY_TEMPLATE_USAGE
    └── RADIOLOGIST_PROFILES

STAFF (HR records)
    ├── STAFF_ADVANCES
    ├── STAFF_SALARY_PAYMENTS
    ├── STAFF_ATTENDANCE
    └── HR_REJOINING_FORMS

DICOM_NODES (imaging devices)
    └── DICOM_PULL_JOBS

BANK_ACCOUNTS
    ├── BANK_TRANSACTIONS
    ├── RECONCILIATION_LOGS
    ├── GATEWAY_TRANSACTIONS
    └── FRAUD_ALERTS
```

---

## 2. Complete Table Inventory

### Module Groupings & Table Count

| Module | Tables | File(s) |
|--------|--------|---------|
| Core Clinical | 12 | patients, doctors, tests, test_categories, orders, samples, packages, package_tests, appointments, discounts, discount_reasons, form_f |
| Billing & Payments | 8 | bills, payments, payment_logs, bill_audits, commissions, doctor_payouts, tokens, test_tokens |
| Radiology Studies | 18 | radiology_studies, radiology_film_issues, radiology_prompts, radiology_priority_rules, radiologist_assignment_rules, radiologist_subspecialties, radiologist_workloads, radiology_report_verifications, radiology_critical_findings, radiology_tat_tracking, radiology_structured_templates, radiology_ai_enhancements, radiology_dicom_measurements, teleradiology_sites, radiology_multi_site_worklist, dicom_routing_optimization_log, radiology_study_locks, radiology_chocolate_findings, radiology_user_findings_preferences, radiology_user_report_preferences, radiology_user_item_usage_logs, radiology_worklist, radiology_share_links, radiology_scheduled_procedures |
| DICOM / PACS | 12 | dicom_nodes, dicom_pull_jobs, dicom_pulled_studies, dicom_routing_rules, dicom_failed_retrieval_queue, pacs_settings, pacs_logs, dicom_studies, dicom_study_series, dicom_study_audit_log, ai_extraction_results, hanging_protocols, technician_workflow, modality_routing_map |
| USG / Doppler | 10 | usg_measurements, usg_extraction_logs, usg_key_images, usg_doppler_measurements, usg_extraction_settings, usg_machine_profiles, usg_report_drafts, usg_report_amendments, usg_finding_image_links, usg_audit_log |
| Echo / Fetal USG | ~8 | echo_studies, echo_measurements, echo_report_drafts, echo_audit_log, fetal_usg_studies, fetal_measurements, fetal_anomaly_findings, fetal_usg_report_drafts |
| Radiology AI & Reporting | 20+ | radiology_report_generator_sessions, radiology_text_macros, radiology_report_preferences, radiology_normal_snippets, radiologist_style_preferences, radiology_report_lifecycle_log, spinal_measurements, radiology_smart_macros, ai_reporting_sessions, ai_prompt_templates, ai_prompt_library, ai_model_routes, ai_quality_scores, ai_dicom_findings, rag_documents, ai_billing_suggestions, peer_review_assignments, turnaround_times, ai_training_data_exports, report_quality_gates, critical_findings, ai_provider_health, ai_voice_transcriptions, ai_patient_communications, ai_normal_report_templates, voice_dictation_logs |
| Radiology Knowledge | 9 | radiology_master_templates, radiology_template_versions, radiology_personal_templates, radiology_template_packs, radiology_knowledge_base, radiologist_profiles, radiology_template_usage, radiology_template_favorites, radiology_template_comparison |
| Radiology Memory | 9 | radiology_memory, radiology_memory_patterns, radiology_memory_measurements, radiology_memory_classifications, radiology_memory_phrases, radiology_memory_impressions, radiology_memory_decisions, radiology_memory_feedback, radiology_memory_usage |
| Smart Radiology + RIS | ~14 | smart_radiology_worklist, smart_priority_queue, smart_assignment_log, smart_report_sessions, smart_findings_library, smart_macro_library, ris_monitoring_tables (~8) |
| Other Radiology | 8 | radiology_snippets, radiology_smart_findings, radiology_lesions, radiology_organ_intelligence, radiology_annotations, radiology_ai_review_audits, structured_report_templates, teaching_cases |
| Staff & HR | 9 | staff, staff_counter, staff_advances, staff_salary_payments, staff_attendance, staff_biometric_credentials, bridge_fingerprint_templates, hr_rejoining_forms, hr_rejoining_form_counter |
| Auth & Sessions | 7 | users, portal_sessions, user_sessions, webauthn_credentials, scan_sessions, paired_devices, scan_audit_logs |
| Settings & Config | 16 | clinic_settings, ledgers, machines, departments, branches, floors, rooms, modalities, printer_settings, backup_logs, backup_replication, email (settings), role_permissions, upload_files, signatures, pacs_settings |
| Accounting & Finance | 5 | accounting/vouchers, expenses, day_closures, user_day_closures, drawer_audit_log |
| Banking Enterprise | 10 | bank_accounts, bank_transactions, payment_requests, webhook_logs, bank_audit_logs, reconciliation_logs, fraud_alerts, shift_closures, gateway_transactions, refund_requests |
| WhatsApp & Comms | 8 | whatsapp_settings, whatsapp_numbers, whatsapp, whatsapp_conversations, messages, conversations, email_log, report_delivery_logs |
| Website & Bookings | 4 | site_settings, site_pages, site_popups, online_bookings |
| Audit & Compliance | 5 | audit_logs, audit_runs, anomaly_alerts, hl7_integration_settings, hl7_messages |
| Outsourced Labs | ~6 | outsourced_labs, outsourced_tests, outsourced_orders, outsourced_results, lab_communication_logs |
| Sync & Infrastructure | 2 | sync_queue, backup_replication (also in settings) |

**Total estimated: ~230 tables**

---

## 3. Table Dependencies Map

### Core Dependency Chain (Most Critical)

```
patients
  └─► orders ──────────────────────────────► bills
                                               │
                                               ├─► payments
                                               ├─► payment_logs
                                               ├─► gateway_transactions
                                               ├─► tokens
                                               ├─► test_tokens
                                               ├─► bill_audits
                                               ├─► online_bookings (if online)
                                               └─► radiology_studies
                                                         │
                                                         ├─► radiology_worklist (PACS view)
                                                         ├─► dicom_studies (PACS ingest)
                                                         ├─► usg_report_drafts
                                                         ├─► radiology_tat_tracking
                                                         ├─► radiology_study_locks
                                                         └─► radiology_ai_enhancements
```

### PACS Dependency Chain

```
dicom_nodes
  └─► dicom_pull_jobs ──► dicom_pulled_studies
                    │
                    └──► dicom_studies
                               │
                               ├─► dicom_study_series
                               ├─► dicom_study_audit_log
                               ├─► ai_extraction_results
                               └─► technician_workflow
```

### Radiology Knowledge Dependency Chain

```
radiology_master_templates
  ├─► radiology_template_versions (version history)
  ├─► radiology_template_comparison (diff snapshots)
  └─► radiology_personal_templates ──► radiology_template_packs
              │
              └─► radiologist_profiles (default templates)
                        │
                        └─► radiology_template_usage (analytics)
                        └─► radiology_template_favorites

users ──► radiology_memory (all 9 tables)
```

### Banking Dependency Chain

```
bank_accounts
  ├─► bank_transactions
  │         └─► reconciliation_logs ◄── payments (bills)
  │                                 ◄── vouchers
  ├─► payment_requests
  ├─► webhook_logs
  └─► bank_audit_logs

bills ──► gateway_transactions ──► refund_requests
       └─► fraud_alerts
```

---

## 4. Large Tables — Growth Projections

| Table | Rows/Day | Est. 1-Year Rows | Est. 3-Year Rows | Risk |
|-------|----------|-----------------|-----------------|------|
| `audit_logs` | 200-500 | 73K–182K | 220K–550K | 🔴 HIGH — partition needed |
| `bills` | 50-200 | 18K–73K | 55K–220K | 🟡 MEDIUM |
| `payments` | 100-400 | 36K–146K | 110K–440K | 🟡 MEDIUM |
| `test_tokens` | 200-800 | 73K–292K | 220K–875K | 🟡 MEDIUM |
| `radiology_studies` | 30-150 | 11K–55K | 33K–165K | 🟡 MEDIUM |
| `dicom_studies` | 30-150 | 11K–55K | 33K–165K | 🟠 HIGH (JSONB col) |
| `portal_sessions` | 20-100 | 7K–36K | — | 🟡 needs cleanup |
| `usg_measurements` | 20-80 | 7K–29K | — | 🟡 wide rows (~200 cols) |
| `usg_audit_log` | 50-200 | 18K–73K | — | 🟡 append-only |
| `dicom_study_audit_log` | 50-200 | 18K–73K | — | 🟡 append-only |
| `radiology_user_item_usage_logs` | 100-500 | 36K–182K | — | 🟡 usage analytics |
| `radiology_template_usage` | 50-200 | 18K–73K | — | 🟡 analytics |
| `radiology_memory_decisions` | 50-300 | 18K–109K | — | 🟡 append-only |
| `dicom_pull_jobs` | 10-50 | 3K–18K | — | 🟢 manageable |
| `dicom_pulled_studies` | 30-150 | 11K–55K | — | 🟡 needs archival |
| `bank_transactions` | 10-50 | 3K–18K | — | 🟢 manageable |
| `webhook_logs` | 5-50 | 1K–18K | — | 🟢 manageable |
| `hl7_messages` | 0-20 | 0–7K | — | 🟢 low |
| `usg_extraction_logs` | 20-80 | 7K–29K | — | 🟡 medium |

---

## 5. Performance Concerns

### Missing Indexes (Likely Query Patterns Without Index)

| Table | Missing Index | Likely Query |
|-------|--------------|-------------|
| `bills` | `(status, created_at)` | Today's pending bills |
| `bills` | `(ledger_id, created_at)` | Ledger-wise daily summary |
| `payments` | `(created_at)` | Daily payment reports |
| `audit_logs` | `(created_at)` | Date-range audit queries |
| `audit_logs` | `(user_id, action)` | Per-user action history |
| `portal_sessions` | `(expires_at, is_active)` | Session cleanup queries |
| `portal_sessions` | `(user_id, is_active)` | User session lookup |
| `dicom_pull_jobs` | `(status, created_at)` | Pending job pickup |
| `bank_transactions` | `(bank_account_id, transaction_date)` | Statement queries |
| `bank_transactions` | `(reconciliation_status)` | Unreconciled transactions |
| `test_tokens` | `(token_date, ledger_id, status)` | Queue display (COMPOUND needed) |
| `reconciliation_logs` | `(status, created_at)` | Pending reconciliation |
| `fraud_alerts` | `(status, severity)` | Alert dashboard |
| `pacs_settings` | `(key, category)` | UNIQUE constraint + index missing |

### Wide-Row Tables (Potential Storage / Query Performance Issue)

| Table | Issue |
|-------|-------|
| `usg_measurements` | ~200 columns. Very wide. SELECT * is expensive. Use column lists. |
| `dicom_studies` | `dicom_metadata JSONB` — full DICOM tag dump. Can be 10-50KB per row. |
| `usg_key_images` | `thumbnail_base64` — inline base64 thumbnails. Move to object storage. |
| `clinic_settings` | Single row but extremely wide. Fine as-is. |
| `hr_rejoining_forms` | `photo_data_url` — inline base64 photo. Move to object storage. |
| `users` | `photo_data_url` — inline base64 portrait. Consider S3/object storage. |

### JSONB Columns with Growth Risk

| Table | JSONB Column | Risk |
|-------|-------------|------|
| `dicom_studies` | `dicom_metadata` | Can be large per study |
| `bank_transactions` | `raw_payload` | Bank API responses |
| `gateway_transactions` | `raw_payload` | Payment gateway responses |
| `fraud_alerts` | `evidence` | Evidence blobs |
| `shift_closures` | `denominations` | Small, fine |
| `users` | `dicom_presets` | Small, fine |
| `hr_rejoining_forms` | `family_details`, `salary_structure`, `document_checklist` | Small, fine |

---

## 6. Duplicate / Overlapping Tables

### ⚠️ CRITICAL OVERLAP: Three Study Tables Storing the Same Data

| Table | Purpose | Problem |
|-------|---------|---------|
| `radiology_studies` | RIS: Ordered studies from bills | Generated at billing |
| `radiology_worklist` | PACS-side worklist (Orthanc pulls) | Populated from PACS |
| `dicom_studies` | Canonical DICOM study registry (Phase 9+) | Most complete |

**All three can contain the same study with different data.** The Q/R query merges `radiology_studies` + `radiology_worklist` by accession number. `dicom_studies` is a third source. In practice, the ERP has built a 3-layer view of the same study data.

**Recommendation:** `dicom_studies` should become the canonical table. `radiology_worklist` should be a filtered view or deprecated. `radiology_studies` (RIS) is indispensable as it is tied to billing.

---

### ⚠️ HIGH OVERLAP: Two Session Tables

| Table | Purpose |
|-------|---------|
| `portal_sessions` | Primary session table (staff + patient scope) |
| `user_sessions` | Fingerprint/bridge login sessions |

Both store `token`, `userId`, `expiresAt`, `isActive`. The `user_sessions` table appears to be a legacy/parallel table from the fingerprint bridge login system. Most routes use `portal_sessions`.

**Recommendation:** Evaluate if `user_sessions` is still actively used. If bridge sessions are created here, merge into `portal_sessions` with a `loginMethod` column (already has `loginMethod` in `user_sessions`).

---

### ⚠️ MEDIUM OVERLAP: Multiple "Findings Library" Concepts

| Table | Concept |
|-------|---------|
| `radiology_chocolate_findings` | Pre-written finding + impression pairs |
| `radiology_smart_findings` | Smart findings with auto-impression |
| `radiology_snippets` | User-saved text snippets |
| `radiology_normal_snippets` | Normal-finding templates |
| `radiology_master_templates` (findings field) | Full template findings |
| `radiology_personal_templates` (findings field) | Personal template findings |
| `radiology_knowledge_base` | Knowledge articles with templates |

Seven different places to store/retrieve "a finding text for modality X body part Y." This creates confusion about which table is authoritative for a given use case.

**Recommendation:** Define clear hierarchy: Knowledge Base (educational) → Master Templates (authoritative report templates) → Personal Templates (individual preference) → Chocolate/Smart Findings (click-to-insert shortcuts) → Snippets (user-defined).

---

### ⚠️ MEDIUM OVERLAP: Radiology AI Enhancement Tables

| Table | Purpose |
|-------|---------|
| `radiology_ai_enhancements` | Study-level AI findings/impressions |
| `ai_extraction_results` | AI extraction with review state (in dicom_studies module) |
| `ai_dicom_findings` | AI DICOM annotations |
| `ai_reporting_sessions` | Ollama session with full report draft |

Four tables record AI-generated findings for a study. They are conceptually similar with different schemas and scope levels.

**Recommendation:** `ai_reporting_sessions` is the active one (Phase 11). The others may be legacy from earlier phases. Audit which are actively read/written.

---

### ⚠️ LOW OVERLAP: Multiple Structured Template Tables

| Table | File |
|-------|------|
| `radiology_structured_templates` | `radiology.ts` |
| `structured_report_templates` | `structuredReportTemplates.ts` |

Both store "structured report templates" with modality/body part. Created in different development phases.

**Recommendation:** Verify which is active. Merge or deprecate one.

---

## 7. Unused / Potentially Unused Tables

Based on schema existence vs. active route/service inspection:

| Table | File | Assessment | Confidence |
|-------|------|-----------|-----------|
| `teleradiology_sites` | `radiology.ts` | No matching route found; multi-site not deployed | 🟡 Likely unused |
| `radiology_multi_site_worklist` | `radiology.ts` | Multi-site not deployed | 🟡 Likely unused |
| `dicom_routing_optimization_log` | `radiology.ts` | Load balancing not deployed | 🟡 Likely unused |
| `modality_routing_map` | `dicomStudies.ts` | Auto-routing not wired | 🟡 Likely unused |
| `hanging_protocols` | `dicomStudies.ts` | Viewer layout integration TBD | 🟡 Likely unused |
| `radiologist_subspecialties` | `radiology.ts` | Assignment rules exist but subspecialty matching unclear | 🟡 Partial |
| `radiology_multi_site_worklist` | `radiology.ts` | No route exists | 🔴 Unused |
| `rag_documents` | `ragDocuments.ts` | RAG pipeline not deployed | 🟡 Partial |
| `ai_training_data_exports` | `aiTrainingDataExports.ts` | Export job not implemented | 🟡 Likely unused |
| `ai_patient_communications` | `aiPatientCommunications.ts` | AI comms not deployed | 🟡 Partial |
| `peer_review_assignments` | `peerReviewAssignments.ts` | Peer review workflow not wired | 🟡 Partial |
| `conversations` + `messages` | `conversations.ts`, `messages.ts` | General-purpose, unclear if used | 🟡 Unknown |
| `radiology_dicom_measurements` | `radiology.ts` | Similar to usg_measurements, may be legacy | 🟡 Unknown |
| `ai_billing_suggestions` | `aiBillingSuggestions.ts` | AI billing feature not deployed | 🟡 Likely unused |

> ⚠️ "Likely unused" = schema exists but no active route or service writes to it. Requires verification via `SELECT count(*) FROM table_name` on production DB.

---

## 8. Cleanup Recommendations

### Priority 1 — Immediate Action

#### A. Add Missing Indexes
```sql
-- Audit logs — date-range queries
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_action_idx ON audit_logs (user_id, action);

-- Bills — daily dashboard queries
CREATE INDEX IF NOT EXISTS bills_status_date_idx ON bills (status, created_at DESC);
CREATE INDEX IF NOT EXISTS bills_ledger_date_idx ON bills (ledger_id, created_at DESC);

-- Portal sessions — cleanup + lookup
CREATE INDEX IF NOT EXISTS portal_sessions_expires_idx ON portal_sessions (expires_at, is_active);
CREATE INDEX IF NOT EXISTS portal_sessions_user_idx ON portal_sessions (user_id, is_active);

-- PACS settings — prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS pacs_settings_key_cat_uq ON pacs_settings (key, category);

-- Test tokens — queue display
CREATE INDEX IF NOT EXISTS test_tokens_date_ledger_idx ON test_tokens (token_date, ledger_id, status);

-- Bank transactions — reconciliation
CREATE INDEX IF NOT EXISTS bank_txn_recon_idx ON bank_transactions (reconciliation_status, created_at DESC);
```

#### B. Session Cleanup Job
Add a nightly cron to delete expired sessions:
```sql
-- Run nightly
DELETE FROM portal_sessions WHERE expires_at < NOW() - INTERVAL '7 days';
DELETE FROM scan_sessions WHERE expires_at < NOW() - INTERVAL '1 day';
```

#### C. DICOM Pull Job Cleanup
```sql
-- Archive completed pull jobs older than 30 days
DELETE FROM dicom_pull_jobs 
WHERE status IN ('completed', 'failed') AND created_at < NOW() - INTERVAL '30 days';
```

---

### Priority 2 — Sprint Work

#### D. Move Inline Base64 to Object Storage
Tables storing large base64 blobs in text columns (up to multi-MB per row):

| Table | Column | Action |
|-------|--------|--------|
| `usg_key_images` | `thumbnail_base64` | Move to object storage; store URL |
| `users` | `photo_data_url` | Already has `photo_storage_key` alt; migrate |
| `hr_rejoining_forms` | `photo_data_url` | Already has `photo_storage_key` alt; migrate |
| `staff_biometric_credentials` | `public_key` | Small, keep as-is |

#### E. Audit Active Table Usage
Run the following on production PostgreSQL to identify truly unused tables:
```sql
-- Check row counts for potentially unused tables
SELECT relname, n_live_tup 
FROM pg_stat_user_tables 
WHERE relname IN (
  'teleradiology_sites', 'radiology_multi_site_worklist',
  'dicom_routing_optimization_log', 'modality_routing_map',
  'hanging_protocols', 'rag_documents', 'ai_billing_suggestions',
  'ai_training_data_exports', 'peer_review_assignments',
  'conversations', 'messages'
)
ORDER BY n_live_tup DESC;
```

#### F. Add Audit Log Partitioning
`audit_logs` will be the largest table. Add monthly range partitioning:
```sql
-- PostgreSQL 10+ range partitioning by created_at month
-- (requires schema migration — plan carefully)
```
Short term: add a compound index `(created_at DESC, action)` and implement 1-year archive policy (move to `audit_logs_archive_YYYY`).

---

### Priority 3 — Next Quarter

#### G. Resolve Three-Table Study Overlap
Define the canonical study table:
- `radiology_studies` = RIS order (billing-linked) — **KEEP**
- `dicom_studies` = PACS-ingested canonical study — **KEEP as primary**
- `radiology_worklist` = legacy PACS worklist — **Deprecate or make a VIEW**

Action: Build a view `v_unified_worklist` that JOINs `radiology_studies` (for RIS data) with `dicom_studies` (for PACS data) matched by `accession_number`.

#### H. Merge Session Tables
Evaluate `user_sessions` vs `portal_sessions`. If fingerprint sessions are no longer active, mark `user_sessions` as deprecated. If still active, migrate rows to `portal_sessions` with `loginMethod = 'fingerprint'`.

#### I. Clean Up Duplicate Template Tables
Verify which of these is active: `radiology_structured_templates` vs `structured_report_templates`. Drop the unused one after data migration.

#### J. Archive Old Radiology Memory
`radiology_memory_decisions` and `radiology_memory_usage` will grow indefinitely. Implement monthly aggregation:
- Aggregate `radiology_memory_usage` into monthly summaries
- Archive `radiology_memory_decisions` older than 6 months

---

## 9. Relationship Strength Classification

| Relationship | Type | Enforcement |
|-------------|------|------------|
| bills → orders | Many-to-one | ✅ FK constraint |
| bills → patients | Many-to-one | ✅ FK constraint |
| payments → bills | Many-to-one | ✅ FK constraint |
| staff_advances → staff | Many-to-one | ✅ FK + CASCADE |
| radiology_template_versions → master_templates | Many-to-one | ✅ FK + CASCADE |
| radiology_personal_templates → users | Many-to-one | ✅ FK + CASCADE |
| radiology_studies → patients | Many-to-one | ⚠️ Logical only |
| radiology_studies → bills | Many-to-one | ⚠️ Logical only |
| radiology_studies → tests | Many-to-one | ⚠️ Logical only |
| dicom_studies → patients | Many-to-one | ⚠️ Logical only |
| dicom_pull_jobs → dicom_nodes | Many-to-one | ⚠️ Logical only |
| portal_sessions → users | Many-to-one | ⚠️ Logical only |
| audit_logs → users | Many-to-one | ⚠️ Logical only |
| bank_transactions → bank_accounts | Many-to-one | ⚠️ Logical only |
| reconciliation_logs → bank_transactions | Many-to-one | ⚠️ Logical only |
| test_tokens → bills | Many-to-one | ⚠️ Logical only |
| usg_measurements → radiology_worklist | Many-to-one | ⚠️ Logical only |

> **Recommendation:** The most critical missing FK constraints are: `radiology_studies.bill_id → bills.id` and `portal_sessions.user_id → users.id`. Adding these would prevent orphaned records.

---

## 10. Module-Level Risk Summary

| Module | Growth Risk | Performance Risk | Cleanup Needed | Data Quality Risk |
|--------|------------|-----------------|---------------|-----------------|
| Billing (bills, payments) | 🟡 Medium | 🟡 Medium | 🟡 Archive old bills | 🟢 Low |
| Audit Logs | 🔴 High | 🔴 High | 🔴 Partition/archive | 🟢 Low |
| Radiology Studies | 🟡 Medium | 🟡 Medium | 🟢 Low | 🟡 3-table overlap |
| DICOM Studies | 🔴 High | 🔴 High (JSONB) | 🟡 Archive | 🔴 Overlap risk |
| USG Measurements | 🟡 Medium | 🔴 High (wide rows) | 🟢 Low | 🟢 Low |
| Radiology Memory | 🟡 Medium | 🟡 Medium | 🟡 Aggregate | 🟢 Low |
| Portal Sessions | 🟡 Medium | 🟡 Medium | 🔴 Cleanup needed | 🟢 Low |
| Banking | 🟢 Low | 🟢 Low | 🟢 Low | 🟡 Recon accuracy |
| Staff/HR | 🟢 Low | 🟢 Low | 🟢 Low | 🔴 PII (Aadhaar/PAN) |
| Knowledge Tables | 🟢 Low | 🟢 Low | 🟡 Unused tables | 🟢 Low |
| AI Platform | 🟡 Medium | 🟢 Low | 🟡 Unused tables | 🟢 Low |
| WhatsApp/Comms | 🟡 Medium | 🟢 Low | 🟡 Archive old msgs | 🟢 Low |

---

## 11. PII / Sensitive Data Map

| Table | PII Type | Columns | Sensitivity |
|-------|---------|---------|------------|
| `patients` | Patient demographics | name, phone, dob, address, blood_group | 🔴 High |
| `hr_rejoining_forms` | Employee PII | aadhaar_number, pan_number, bank_account_number, photo | 🔴 Critical |
| `staff` | Employee info | bank_account, ifsc, phone | 🔴 High |
| `clinic_settings` | Payment credentials | icici_secret_key, payu_merchant_key, razorpay_key_id | 🔴 Critical |
| `form_f` | Medical + compliance | obstetric history, clinical indications | 🔴 High (Legal) |
| `usg_report_drafts` | Medical records | finalized_report_hash, full report text | 🔴 High |
| `users` | Staff credentials | pin (hashed), permissions | 🟠 High |
| `portal_sessions` | Auth tokens | token (bearer) | 🟠 High |
| `radiology_studies` | Clinical records | clinical_history, prelim_report, final_report | 🔴 High |
| `dicom_studies` | DICOM metadata | patient_name, patient_age, institution_name | 🟠 High |
| `whatsapp` | Communication | phone numbers, message content | 🟡 Medium |
| `audit_logs` | Access patterns | ip_address, user actions | 🟡 Medium |

**Immediate actions for PII protection:**
1. `hr_rejoining_forms.aadhaar_number` — mask/encrypt at application level
2. `clinic_settings` payment keys — should be in environment variables, not DB
3. `usg_key_images.thumbnail_base64` — PHI in base64, move to object storage with access control

---

## 12. Recommended Next Steps

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| P1 | Run row-count audit on production DB | Know actual sizes | 30 min |
| P1 | Add missing indexes (see Section 8A) | Query performance | 2 hours |
| P1 | Set up session cleanup cron | Storage + security | 1 hour |
| P2 | Move base64 photos to object storage | Row size reduction | 1 day |
| P2 | Audit + confirm unused tables | Schema hygiene | 1 day |
| P2 | Add `(key, category)` unique constraint to `pacs_settings` | Data integrity | 1 hour |
| P3 | Build `v_unified_worklist` view | Resolve 3-table overlap | 3 hours |
| P3 | Implement audit_logs archival | Long-term storage | 2 days |
| P3 | Encrypt `hr_rejoining_forms.aadhaar_number` | PII protection | 1 day |
| P4 | Monthly aggregation for radiology_memory | Storage management | 1 day |
| P4 | Merge/deprecate `user_sessions` | Technical debt | 2 hours |
| P4 | Evaluate + drop truly unused tables | Schema clarity | 1 day |
