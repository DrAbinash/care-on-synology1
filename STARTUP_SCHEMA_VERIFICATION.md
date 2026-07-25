# STARTUP_SCHEMA_VERIFICATION

**Status:** ❌ FAIL  
**Timestamp:** 2026-07-25T14:40:20.084Z  
**Mode:** VERIFY  

## Self-Diagnostics

| Field | Value |
|---|---|
| Git Commit | `unknown` |
| Git Branch | `unknown` |
| Git Tag | `unknown` |
| PostgreSQL Version | PostgreSQL 16.14 |
| Drizzle Journal Version | 7 |
| Migration Files | 133 |
| Drizzle Migrations Applied | 12 |
| Feature Migrations Applied | 133 |
| Expected Tables | 433 |
| Actual Tables | 438 |
| Expected Columns | 4912 |
| Actual Columns | 6322 |
| Missing Tables [ERROR] | **0** |
| Extra Tables (possible drift) [INFO] | 0 |
| Missing Columns [ERROR] | **2** |
| Missing Indexes [WARNING] | 4 |
| Type Mismatches [WARNING] — genuine, non-blocking | 14 |
| Normalized Differences [IGNORED] — not drift | 0 |
| Source Issues | 0 |
| Warnings | 23 |
| Deploy State db_patch_ok | true |
| Live Table Count | 438 |
| Verification Result | ❌ FAIL |

## ❌ Missing Columns  [ERROR]

| Table | Column | Expected Type | Source File | Suggested Fix |
|---|---|---|---|---|
| `email_settings` | `daily_summary_last_sent_date` | `text` | daily_summary_last_sent.sql | Run `docker compose up -d --build` or `--repair` |
| `email_settings` | `daily_summary_time` | `text` | zz_schema_reconcile_20260709.sql | Run `docker compose up -d --build` or `--repair` |

## ⚠️ Type Mismatches  [WARNING] — genuine differences, non-blocking

Every entry below survived normalization (case, whitespace, quoting, schema
qualification, trailing punctuation, and known PostgreSQL type aliases already
accounted for) — these are real drift, not formatting artifacts.

| Table | Column | Expected | Actual | Reason |
|---|---|---|---|---|
| `fetal_echo_studies` | `ga_weeks` | `real` | `integer` | No known equivalent alias |
| `fetal_usg_audit_logs` | `created_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_checklists` | `updated_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_critical_alerts` | `acknowledged_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_critical_alerts` | `created_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_measurements` | `created_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_measurements` | `updated_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_reports` | `reviewed_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_reports` | `finalized_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_reports` | `updated_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_studies` | `created_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_studies` | `updated_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_template_preferences` | `created_at` | `timestamp` | `timestamptz` | No known equivalent alias |
| `fetal_usg_template_preferences` | `updated_at` | `timestamp` | `timestamptz` | No known equivalent alias |

## ⚠️ Missing Indexes  [WARNING]

- `idx_orders_referred_by` on `orders`
- `idx_bills_referred_by_id` on `bills`
- `idx_bills_referred_by_created` on `bills`
- `radiology_worklist_accession_uq` on `radiology_worklist`

## Triggers

- `mri_protocol_specs_uat` on `mri_protocol_specs`
- `mri_pq_results_uat` on `mri_protocol_quality_results`
- `ai_shadow_drafts_immutable_guard` on `ai_shadow_drafts`
- `ai_shadow_drafts_immutable_guard` on `ai_shadow_drafts`
- `study_snapshots_immutable_guard` on `study_snapshots`
- `study_snapshots_immutable_guard` on `study_snapshots`

## Warnings

- Missing index 'idx_orders_referred_by' on 'orders'
- Missing index 'idx_bills_referred_by_id' on 'bills'
- Missing index 'idx_bills_referred_by_created' on 'bills'
- Nullable mismatch: clinic_settings.gstin expected NOT NULL but DB allows NULL
- Nullable mismatch: clinic_settings.razorpay_key_id expected NOT NULL but DB allows NULL
- Nullable mismatch: radiology_worklist.accession_number expected NOT NULL but DB allows NULL
- Missing index 'radiology_worklist_accession_uq' on 'radiology_worklist'
- Nullable mismatch: echo_reports.critical_alerts_acknowledged expected NOT NULL but DB allows NULL
- Type mismatch fetal_echo_studies.ga_weeks: expected 'real', live is 'integer'
- Nullable mismatch: fetal_echo_studies.critical_alerts_acknowledged expected NOT NULL but DB allows NULL
- Type mismatch fetal_usg_audit_logs.created_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_checklists.updated_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_critical_alerts.acknowledged_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_critical_alerts.created_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_measurements.created_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_measurements.updated_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_reports.reviewed_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_reports.finalized_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_reports.updated_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_studies.created_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_studies.updated_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_template_preferences.created_at: expected 'timestamp', live is 'timestamptz'
- Type mismatch fetal_usg_template_preferences.updated_at: expected 'timestamp', live is 'timestamptz'

---
_Generated by scripts/db-schema-verify.cjs — Care Diagnostics ERP_