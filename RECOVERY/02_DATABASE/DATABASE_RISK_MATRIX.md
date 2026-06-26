# DATABASE RISK MATRIX
## Care Diagnostics ERP — Production Risk Assessment

**Date:** 26 June 2026 | **Tables Audited:** 305 | **Schema files:** 113

---

## RISK LEGEND
| Level | Symbol | Description |
|-------|--------|-------------|
| CRITICAL | 🔴 | Must fix before production — data loss or corruption risk |
| HIGH | 🟠 | Fix in Week 1 — functional or integrity gap |
| MEDIUM | 🟡 | Fix in Month 1 — performance or maintainability |
| LOW | 🟢 | Fix in Quarter 1 — cosmetic or future-proofing |

---

## 🔴 CRITICAL RISKS

### DB-CRIT-01: 26 Missing FK Constraints
**Affected Tables:** radiology_studies, dicom_studies, vouchers, bill_audits, tokens, test_tokens, online_bookings, user_day_closures, webauthn_credentials, scan_sessions, paired_devices  
**Risk:** Orphaned rows accumulate silently. Example scenarios:
- Bill cancelled → adiology_studies.bill_id still points to deleted/cancelled bill
- Token issued → order deleted → 	okens.order_id points to nothing
- Voucher created → bill deleted → ouchers.bill_id points to nothing
- Gateway webhook → booking_ref exists but no patient_id record

**Highest impact missing FKs in financial module:**

| Table | Column | Missing FK |
|-------|--------|-----------|
| ouchers | ill_id | → ills.id |
| expenses | oucher_id | → ouchers.id |
| ill_audits | ill_id | → ills.id |
| online_bookings | patient_id | → patients.id |
| online_bookings | ill_id | → ills.id |

**Migration to fix (example):**
`sql
ALTER TABLE radiology_studies ADD CONSTRAINT fk_rs_patient FOREIGN KEY (patient_id) REFERENCES patients(id) DEFERRABLE;
ALTER TABLE radiology_studies ADD CONSTRAINT fk_rs_bill FOREIGN KEY (bill_id) REFERENCES bills(id);
ALTER TABLE vouchers ADD CONSTRAINT fk_vouchers_bill FOREIGN KEY (bill_id) REFERENCES bills(id);
ALTER TABLE bill_audits ADD CONSTRAINT fk_bill_audits_bill FOREIGN KEY (bill_id) REFERENCES bills(id);
`
> Note: Add DEFERRABLE where circular dependencies exist.

---

### DB-CRIT-02: Voucher Account IDs Stored as TEXT
**File:** lib/db/src/schema/accounting.ts L58–59  
**Evidence:**
`	ypescript
creditAccountId: text("credit_account_id").notNull(),
debitAccountId: text("debit_account_id").notNull(),
`
**Risk:** These columns SHOULD be integer FKs to ccounts.id. As TEXT:
- No DB-level integrity — any string is valid
- Account deleted → voucher has stale text reference
- Tally export will silently include vouchers with non-existent accounts
- Cannot JOIN on ccounts.id directly — string comparison only

**Migration to fix:**
`sql
-- 1. Add integer columns
ALTER TABLE vouchers ADD COLUMN credit_account_id_int INTEGER;
ALTER TABLE vouchers ADD COLUMN debit_account_id_int INTEGER;
-- 2. Backfill: assuming stored as '42' or 'cash' (needs investigation)
UPDATE vouchers SET credit_account_id_int = NULLIF(credit_account_id, '')::integer WHERE credit_account_id ~ '^[0-9]+$';
-- 3. Add FKs after verification
ALTER TABLE vouchers ADD CONSTRAINT fk_credit FOREIGN KEY (credit_account_id_int) REFERENCES accounts(id);
`
**Effort:** 4 hours + data migration.

---

### DB-CRIT-03: Staff Financial Records Cascade-Deleted with Staff
**File:** lib/db/src/schema/staff.ts L31, L44, L62  
**Evidence:**
`	ypescript
staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
`
**Applies to:** staff_advances, staff_salary_payments, staff_attendance  
**Risk:** Deleting a staff record (fired, resigned) silently and permanently deletes:
- All salary payment history
- All advance loan records  
- All attendance records

This is a **legal violation** under India's payment of wages and labour record-keeping requirements.

**Migration to fix:**
`sql
ALTER TABLE staff_advances DROP CONSTRAINT staff_advances_staff_id_fkey;
ALTER TABLE staff_advances ADD CONSTRAINT staff_advances_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT;
-- Repeat for staff_salary_payments, staff_attendance
`

---

## 🟠 HIGH RISKS

### DB-HIGH-01: Date Fields Stored as TEXT
**Affected:** ouchers.date, expenses.expense_date, adiology_studies.studyDate (date ✅), various others  
**Risk:**
- No DB-level date format validation — '32/13/2026' is valid text
- Cannot use PostgreSQL date functions (BETWEEN, date_trunc, age()) without casting
- Sorting by date requires ORDER BY date::date — full scan, index unused

**Fix:** ALTER TABLE vouchers ALTER COLUMN date TYPE date USING date::date;

---

### DB-HIGH-02: ills.status Unconstrained Text
**Risk:** Any string can be inserted — 'PAID', 'Paid', 'paid', 'CANCELLED', 'voided' all valid  
**Fix:** Add CHECK constraint or PostgreSQL enum:
`sql
ALTER TABLE bills ADD CONSTRAINT bills_status_check 
  CHECK (status IN ('pending', 'partial', 'paid', 'cancelled'));
`

---

### DB-HIGH-03: No CHECK Constraints on Money Columns
**Risk:** alance_amount = -500 is DB-valid. Application logic prevents it, but a direct SQL insert or bug could create negative balances that would contaminate all financial reports.  
**Fix:**
`sql
ALTER TABLE bills ADD CONSTRAINT bills_balance_nonneg CHECK (balance_amount >= 0);
ALTER TABLE bills ADD CONSTRAINT bills_paid_nonneg CHECK (paid_amount >= 0);
ALTER TABLE bills ADD CONSTRAINT bills_total_nonneg CHECK (total_amount >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_amount_pos CHECK (amount > 0);
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_pos CHECK (amount > 0);
`

---

### DB-HIGH-04: Final Report Is Overwriteable TEXT
**Risk:** adiology_studies.final_report and adiology_studies.prelim_report are plain text columns. Updating them overwrites the previous content with no audit trail or version history.  
**Fix:** Add eport_versions table:
`sql
CREATE TABLE radiology_report_versions (
  id SERIAL PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES radiology_studies(id),
  report_type TEXT NOT NULL, -- 'prelim' | 'final' | 'amendment'
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`

---

### DB-HIGH-05: Missing Patient Search Indexes
**Risk:** Patient search by phone/name is a full sequential scan of the patients table. At 50,000 patients, this takes 200–500ms per search.  
**Fix:**
`sql
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_name ON patients(lower(first_name), lower(last_name));
CREATE INDEX idx_patients_patient_id ON patients(patient_id);
`

---

### DB-HIGH-06: online_bookings Uses TEXT for Arrays
**Risk:** 	est_ids TEXT DEFAULT '[]' is a JSON array stored as text. Application must double-parse: JSON.parse(JSON.parse(...)). Any direct SQL query or migration touching this column must handle text, not native array operators.  
**Fix:**
`sql
ALTER TABLE online_bookings ALTER COLUMN test_ids TYPE jsonb USING test_ids::jsonb;
ALTER TABLE online_bookings ALTER COLUMN package_ids TYPE jsonb USING package_ids::jsonb;
`

---

## 🟡 MEDIUM RISKS

### DB-MED-01: No Unique Constraint on day_closures.closure_date
**Risk:** Two day-close events on the same date create two records. Reports will double-count.  
**Fix:** CREATE UNIQUE INDEX ON day_closures(closure_date);

### DB-MED-02: dicom_studies.dicom_metadata JSONB Bloat
**Risk:** Full DICOM tag dumps can reach 2–5 MB per row. At 1,000 studies/month, this adds 2–5 GB/month to the database.  
**Fix:** Strip to essential tags at ingest; store full dump in object storage.

### DB-MED-03: packages.tests JSONB Array — No FK
**Risk:** Test deleted → package silently broken. No cascade or validation.  
**Fix:** Add package_tests junction table.

### DB-MED-04: No Soft Delete
**Risk:** All deletions are hard deletes. Medical record regulations require 7-year retention.  
**Fix:** Add deleted_at TIMESTAMPTZ to patients, orders, bills, radiology_studies.

### DB-MED-05: Counter Tables vs PostgreSQL Sequences
**Tables:** patient_counter, expense_counter, staff_counter  
**Risk:** Under concurrent load, two transactions can read the same counter value before either increments. Application uses transactions, so risk is low but not zero.  
**Fix:** Replace with CREATE SEQUENCE patient_seq; SELECT nextval('patient_seq');

### DB-MED-06: clinic_settings God Table (80+ columns)
**Risk:** Every clinic setting in one row. Unrelated features share one table. Adding new settings always risks migration failures.  
**Fix:** Gradually extract feature-specific tables (ai_settings, pacs_settings, payment_settings).

### DB-MED-07: users.permissions Stored as TEXT
**Risk:** JSON-in-text; no schema validation, no JSONB operators.  
**Fix:** ALTER TABLE users ALTER COLUMN permissions TYPE jsonb USING permissions::jsonb;

---

## 🟢 LOW RISKS

### DB-LOW-01: voucher_audits.voucher_id Has No FK
Minor — voucher audit rows outlive vouchers (acceptable for immutable audit trail).

### DB-LOW-02: No Dedicated expense_audits Table
Expenses can be created but edit/delete audit only captured in audit_logs if wired.

### DB-LOW-03: radiology_studies.study_instance_uid Nullable
A study can exist before a DICOM study UID is assigned (scheduled state). Acceptable by design.

### DB-LOW-04: Duplicate dayClosures Export in index.ts
dayClosures is exported twice from schema index (line 32 and 73). Harmless but cluttered.

---

## FINANCIAL TABLE SAFETY MATRIX

| Table | Type Safe | FK Safe | Constraint Safe | Audit Safe | Score |
|-------|-----------|---------|-----------------|------------|-------|
| ills | ✅ numeric | ✅ | ⚠️ No CHECKs | ✅ bill_audits | 82/100 |
| payments | ✅ numeric | ✅ bill_id | ⚠️ No ref_no unique | ✅ audit_logs | 80/100 |
| ouchers | ✅ numeric | ❌ text acct IDs | ⚠️ text date | ✅ voucher_audits | 55/100 |
| expenses | ✅ numeric | ❌ no voucher FK | ⚠️ text date | ⚠️ no exp_audits | 58/100 |
| day_closures | ✅ numeric | ✅ | ⚠️ no date unique | ✅ row = record | 75/100 |
| online_bookings | ✅ numeric | ❌ patient/bill | ⚠️ text arrays | ✅ payment_logs | 60/100 |
| ccounts | ✅ | ✅ | ✅ | ✅ audit_logs | 88/100 |

---

## RADIOLOGY LINKAGE RISK MATRIX

| Link | Method | Enforced | Risk |
|------|--------|----------|------|
| DICOM StudyUID → dicom_studies | UNIQUE index | ✅ DB | ✅ Safe |
| dicom_studies.accession → radiology_studies.accession | Text JOIN | ❌ Application only | ⚠️ Can break |
| radiology_studies.order_test_id → order_tests | UNIQUE index, no FK | ⚠️ Partial | ⚠️ Orphan risk |
| radiology_studies.patient_id → patients | No FK | ❌ None | 🔴 High risk |
| patient_reports.study_id → radiology_studies | Check needed | Unknown | ⚠️ |
| Final report → radiology_studies.final_report | TEXT column | ❌ Overwriteable | ⚠️ No versioning |

---

*Report generated: 26 June 2026 — Read-only audit*
