# Enhancement Recommendations
## Care Diagnostics ERP — Post-Assessment Analysis

**Date:** June 27, 2026  
**Based on:** PRODUCTION_ASSESSMENT_REPORT.md + TOP_100_PRODUCTION_BUGS.md  
**Context:** All 5 MRI phases complete. Assessment-based hardening applied.  

This document lists every actionable enhancement identified from the full codebase assessment, grouped by risk and effort. Items are ordered within each group by impact.

---

## ✅ Already Implemented This Session

| Fix | File | What |
|-----|------|------|
| Performance indexes wired | `docker/db-patch-entrypoint.sh` | Bills/payments/vouchers indexes auto-deploy |
| Voice tables migration | `migrations/voice_tables_migration.sql` | Auto-creates voice_dictation_logs, ai_voice_transcriptions |
| Drizzle migration 0005 | `lib/db/drizzle/meta/_journal.json` | mri_protocol_specs now in care-migrate chain |
| CORS lockdown | `artifacts/api-server/src/app.ts` | Origin allowlist via ALLOWED_ORIGINS env var |
| Nginx security headers | `docker/nginx.conf` | X-Frame-Options, nosniff, HSTS, Permissions-Policy |
| pg pool credential masking | `lib/db/src/index.ts` | DATABASE_URL never leaks to stderr |
| Phase 1–5 MRI enhancements | Multiple | Protocol specs, AI prompts, QA, measurements, analytics |

---

## 🔴 Critical — Implement Before Next Production Deployment

### C1. Payment Double-Click Race Condition (Bug #1)
**File:** `artifacts/diagnostic-erp/src/pages/Billing.tsx` (or payment form component)  
**Risk:** Duplicate payment records, accounting ledger drift, wrong day-close totals  
**Fix:** Disable the "Record Payment" button immediately on first click and re-enable only on API error response. Add a 2-second debounce. On the server, add an idempotency key check — same amount + billId within 5 seconds = reject duplicate.

```typescript
// Frontend pattern
const [submitting, setSubmitting] = useState(false);
const handlePayment = async () => {
  if (submitting) return;          // debounce
  setSubmitting(true);
  try { await recordPayment(...); }
  finally { setSubmitting(false); }
};
<Button disabled={submitting} onClick={handlePayment}>Record Payment</Button>
```

### C2. ICICI Webhook Concurrent Duplicate (Bug #2)
**File:** `artifacts/api-server/src/routes/gateway-webhooks.ts`  
**Risk:** Two simultaneous S2S callbacks from ICICI insert duplicate payments  
**Fix:** Wrap the webhook handler in a Postgres advisory lock or unique constraint on `(transaction_id, event_type)`. The existing `existingPayment` check has a race window between SELECT and INSERT.

```sql
-- Add to payment_logs table
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_logs_txn_event
  ON payment_logs (provider, (response_payload->>'transactionId'), event_type);
```

### C3. JWT in localStorage (Bug #7 / Assessment Section 15)
**Risk:** XSS attack steals staff session token → full account takeover  
**Current state:** `erp_session` stored in `localStorage`, sent as `Authorization: Bearer` header  
**Recommendation:** Full migration to HttpOnly cookies is a multi-sprint refactor (affects `staffSession.ts`, `requireStaffAuth.ts`, all 150+ fetch calls, mobile app). Do not implement partially.  
**Interim mitigation (implement now):**
- Add `Content-Security-Policy` header in nginx to block inline script execution
- This dramatically reduces XSS attack surface without touching auth code

```nginx
# In docker/nginx.conf, add to the existing security headers block:
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://api.anthropic.com;" always;
```
Note: `unsafe-inline` is required because the existing React build uses inline scripts. Schedule a full CSP + HttpOnly cookie migration when capacity allows.

### C4. Timezone Drift in Daily Summary (Bug #16)
**File:** `artifacts/api-server/src/routes/day-close.ts` or billing summary queries  
**Risk:** Transactions processed 12:00 AM–5:30 AM IST allocated to wrong day  
**Fix:** All date-range queries must use IST-aware boundaries.

```sql
-- Wrong (UTC boundary):
WHERE created_at >= '2026-06-27 00:00:00'

-- Right (IST boundary — UTC+5:30):
WHERE created_at AT TIME ZONE 'Asia/Kolkata' >= '2026-06-27 00:00:00'
-- Or equivalently:
WHERE created_at >= '2026-06-26 18:30:00+00'
```

The API server already sets `process.env.TZ = "Asia/Kolkata"` in `index.ts`, but raw SQL date comparisons bypass this.

---

## 🟡 High Priority — Within 30 Days

### H1. Browser Back-Button Re-submission on Kiosk (Bug #17)
**File:** Kiosk registration success page  
**Risk:** Duplicate patient records  
**Fix:** After successful registration, use `history.replace` instead of `push` so the back button goes to the previous screen, not re-submits. Or add a POST-Redirect-GET pattern.

### H2. Referral Doctor Ledger Missing Index (Bug #21)
**File:** `migrations/` — add a new migration file  
**Risk:** Query timeout as DB grows past 50K records  
**Fix:** Add to a new `migrations/add_referral_indexes.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_bills_referred_by
  ON bills (referred_by_id, created_at);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_doctor
  ON referral_commissions (doctor_id, created_at);
```

Register in `docker/db-patch-entrypoint.sh` Step 5.

### H3. Session Expired OHIF Crash (Bug #9)
**File:** `artifacts/diagnostic-erp/src/pages/DicomViewer.tsx` or OHIF integration  
**Risk:** Radiologist loses active report dictation when session expires mid-read  
**Fix:** Add a session expiry interceptor in the fetch API client that catches 401 responses and:
1. Saves the current draft to localStorage
2. Shows a "Session expired — please log in again" modal
3. Restores the draft after re-login

### H4. Large PDF Upload Memory Leak (Bug #18)
**File:** `artifacts/api-server/src/routes/` — file upload handlers  
**Risk:** Files >15 MB freeze all concurrent API requests  
**Fix:** Stream large file uploads directly to disk using `multer` with `diskStorage` instead of `memoryStorage`. Already done for DICOM uploads — apply the same pattern to report PDF uploads.

### H5. Doctor Payout Double-Void (Bug #14)
**File:** `artifacts/api-server/src/routes/` — doctor ledger  
**Risk:** Duplicate reverse vouchers, accounting drift  
**Fix:** Same pattern as payment double-click — optimistic lock on void action:

```sql
UPDATE doctor_payouts
SET status = 'voided', voided_at = NOW()
WHERE id = $1 AND status != 'voided'  -- guard
RETURNING id;
-- If no row returned → already voided, reject with 409
```

---

## 🔵 Medium Priority — Next Sprint

### M1. Patient Deletion Orphan Vouchers (Bug #5)
**Risk:** Trial balance integrity breakdown after patient record deletion  
**Fix:** Add a database-level guard: before deleting a patient, check for linked vouchers/bills and either block deletion or soft-delete (set `deleted_at` timestamp) rather than hard-delete.

### M2. Form F Null Aadhaar Bypass (Bug #15)
**File:** USG scheduler validation  
**Risk:** PCPNDT compliance breach  
**Fix:** Enforce required fields at the API level in the Zod schema, not just in the frontend UI. Required fields should be validated server-side.

### M3. Unsigned PDF API Bypass (Bug #6)
**File:** Report PDF generation route  
**Risk:** Unsigned reports can be retrieved bypassing digital signature requirement  
**Fix:** Add a `signedAt IS NOT NULL` guard to the PDF endpoint. Return 403 for unsigned reports requested externally.

### M4. Trial Balance Float Overflow (Bug #11)
**File:** Accounting trial balance query  
**Risk:** 500 error when querying 12-month range with millions of rows  
**Fix:** Use `SUM(amount::numeric)` instead of `SUM(amount::float)`. Postgres `numeric` type has arbitrary precision and never overflows. Already done for refund amounts — apply to trial balance aggregation.

### M5. Kiosk QR Expiry Race (Bug #12)
**File:** Kiosk payment flow  
**Risk:** Double collection + missed registration slip  
**Fix:** Add a grace period (60 seconds) after QR expiry during which the webhook is still accepted. Store `qr_generated_at` and `qr_expires_at` on the booking record.

### M6. XML Character Encoding for Tally (Bug #23)
**File:** Tally XML export  
**Fix:** Use proper XML encoding — `xmlbuilder2` or equivalent library that handles Unicode correctly. Never manually concatenate XML strings.

---

## 🟢 Architecture Enhancements — Plan for 3–6 Months

### A1. PostgreSQL Streaming Replication
**Risk identified:** Single PostgreSQL node — no failover  
**Recommendation:** Set up a hot-standby replica on the Synology NAS second volume or a cloud VPS. Synology DSM supports PostgreSQL replication natively. Promotes to primary in ~30 seconds if main DB fails. RPO drops from 24h to near-zero.

### A2. Content Security Policy (Full)
**Prerequisite:** Resolve C3 (JWT migration to HttpOnly cookies first)  
**Then:** Remove `unsafe-inline` from CSP, implement nonce-based inline scripts in the React build (Vite supports this). This fully eliminates XSS → token theft attack vector.

### A3. API Versioning
**Assessment note:** No formal versioning strategy  
**Recommendation:** Add `/api/v1/` prefix to all routes via a simple Express middleware that rewrites paths. Keep backward compatibility via an alias route (`/api/` → `/api/v1/`). Enables safe breaking changes in future.

### A4. ADC Calculator (MRI Enhancement)
**Assessment gap:** No ADC value calculator for DWI  
**Recommendation:** Add a clinical calculator panel in the Measurements tab (Phase 3 area):
- Input: DWI signal intensity at b=0 and b=1000 s/mm²
- Output: Calculated ADC value in ×10⁻³ mm²/s
- Normal range reference: grey matter ~0.8, white matter ~0.7, restricted <0.6
- Flag restriction automatically

### A5. Fazekas Scale Visual Guide
**Assessment gap:** White matter grading is text-only  
**Recommendation:** Add an in-app visual reference card (SVG, not an image to avoid copyright) showing Fazekas 0–3 periventricular and subcortical patterns. Radiologist clicks the matching image → grade auto-populates in the report. This would sit in the existing NeuroPromptPanel (Phase 2 area).

### A6. Structured JSON Report Export
**Assessment item 20.5:** Structured data export for EMR  
**Recommendation:** Add a `GET /api/radiology/report-generator/drafts/:id/export?format=json` endpoint that returns the report in a structured format suitable for HL7 FHIR DiagnosticReport resource. Already have all the data — just needs a serializer.

### A7. Follow-up Compliance Tracking
**Assessment item 10 (Reporting Analytics):** Follow-up recommendation compliance  
**Recommendation:** Parse the `followup` field from the neuro prompt output (Phase 2). Extract the recommended imaging (MRI / CT / date) and create a `followup_tasks` record. Add a "Pending Follow-ups" view to the My Analytics page (Phase 5). Alert if overdue.

### A8. AI Draft Edit Tracking
**Assessment item 20.4:** Show which phrases were AI-generated vs radiologist-edited  
**Recommendation:** When AI text is inserted into the findings draft (via NeuroPromptPanel or LocalAiPanel), wrap it with invisible markers in the local state:
```
[AI_START]…AI-generated text…[AI_END]
```
On report save, compute what percentage of the final report text originated from AI. Store as `ai_contribution_pct` in the report draft. Show in Phase 5 analytics.

---

## 📋 Migration Checklist — What's Already Wired vs What's Not

### Currently auto-deploying via care-db-patch-v2 (no action needed):
- All Drizzle migrations 0000–0005 ✅
- `seed_mri_protocols.sql` (Phase 1) ✅
- `seed_neuro_prompt_library.sql` (Phase 2) ✅
- `add_performance_indexes.sql` (Fix 1) ✅
- `voice_tables_migration.sql` (Fix 2) ✅
- All 50+ ADD COLUMN IF NOT EXISTS patches (Step 4) ✅

### Recommended migrations to add next:
```
migrations/add_referral_indexes.sql        ← H2: referral doctor performance
migrations/add_csp_nonce_table.sql         ← A2: when CSP migration begins
migrations/add_followup_tasks.sql          ← A7: follow-up compliance tracking
```

### To add any migration:
1. Create `migrations/your_file.sql` (fully idempotent — IF NOT EXISTS everywhere)
2. Add one line to `docker/db-patch-entrypoint.sh` Step 5:
   `run_feature_migration "Description" "your_file.sql"`
3. Deploy — runs automatically

---

## Summary Table

| ID | Priority | Effort | What | Status |
|----|----------|--------|------|--------|
| C1 | 🔴 Critical | 2h | Payment double-click race | **TODO** |
| C2 | 🔴 Critical | 3h | ICICI webhook duplicate | **TODO** |
| C3 | 🔴 Critical | 30m interim | CSP header (interim XSS mitigation) | **TODO** |
| C4 | 🔴 Critical | 4h | Timezone drift in daily summary | **TODO** |
| H1 | 🟡 High | 1h | Kiosk back-button re-submit | **TODO** |
| H2 | 🟡 High | 30m | Referral ledger index | **TODO** |
| H3 | 🟡 High | 4h | Session expiry OHIF crash | **TODO** |
| H4 | 🟡 High | 2h | Large PDF upload memory leak | **TODO** |
| H5 | 🟡 High | 2h | Doctor payout double-void | **TODO** |
| M1 | 🔵 Medium | 2h | Patient deletion orphan guard | **TODO** |
| M2 | 🔵 Medium | 1h | Form F null bypass server-side | **TODO** |
| M3 | 🔵 Medium | 1h | Unsigned PDF API guard | **TODO** |
| M4 | 🔵 Medium | 1h | Trial balance numeric overflow | **TODO** |
| M5 | 🔵 Medium | 3h | Kiosk QR expiry grace period | **TODO** |
| M6 | 🔵 Medium | 2h | Tally XML Unicode encoding | **TODO** |
| A1 | 🟢 Architecture | 1 week | PostgreSQL streaming replication | **PLAN** |
| A2 | 🟢 Architecture | 2 weeks | Full CSP (after JWT migration) | **PLAN** |
| A3 | 🟢 Architecture | 1 week | API versioning /v1/ | **PLAN** |
| A4 | 🟢 Architecture | 3h | ADC calculator in measurements | **PLAN** |
| A5 | 🟢 Architecture | 4h | Fazekas scale visual guide | **PLAN** |
| A6 | 🟢 Architecture | 4h | FHIR JSON report export | **PLAN** |
| A7 | 🟢 Architecture | 1 week | Follow-up compliance tracking | **PLAN** |
| A8 | 🟢 Architecture | 3h | AI contribution % tracking | **PLAN** |

---

## Already Fixed (Do Not Revisit)

| Bug | Fix | Commit |
|-----|-----|--------|
| #8 Negative refund amount | `amount: z.number().gt(0)` already in Zod schema | Pre-existing |
| Double-collection refund | Balance formula refactored | e408314f |
| Financial formula inconsistencies | 99/100 audit passed | Pre-existing |
| PACS network config | Dashboard validation complete | Pre-existing |
| Performance indexes | Wired to auto-deploy | 1d1b4353 |
| Voice tables | Wired to auto-deploy | 1d1b4353 |
| mriProtocolSpecs Drizzle gap | 0005 added to journal | 1d1b4353 |
| CORS wide open | Origin allowlist via env var | 1d1b4353 |
| Nginx security headers | X-Frame, nosniff, HSTS, PP | 1d1b4353 |
| DATABASE_URL in error logs | pool.on error handler | 1d1b4353 |

