-- =============================================================================
-- CARE ERP — ACCOUNTING DATA-QUALITY AUDIT SCRIPT
-- =============================================================================
-- Audit:    Forensic financial-controls audit, dimension "DQ" (data quality)
-- Authored: 2026-07-16 (audit environment; NOT yet executed against production)
-- Target:   PostgreSQL (Synology deployment copy of the CARE ERP database)
--
-- STRICTLY READ-ONLY: this file contains only SELECT statements.
--   - No INSERT / UPDATE / DELETE
--   - No DDL, no temp tables, no SET that mutates state
--   - Safe to run against a production copy (and against production itself,
--     though a copy is recommended so long-running scans don't hold snapshots).
--
-- Every table/column name below was verified against the Drizzle schema in
-- lib/db/src/schema/*.ts (the snake_case DB names declared in pgTable()),
-- and against migrations/zz_schema_reconcile_20260709.sql.
--
-- OUTPUT CONVENTION — every check emits exactly one row:
--   check_id      | e.g. 'DQC-01'
--   description   | what invariant was tested
--   anomaly_count | number of violating rows/groups (0 = clean)
--   sample_ids    | up to 5 primary-key / business identifiers of violations
--                   (NO patient names, NO phone numbers — ids only)
--
-- MONEY SEMANTICS (verified in code):
--   * bills.total_amount = subtotal - discount + tax_amount
--       (artifacts/api-server/src/routes/bills.ts:549-550)
--   * bills.paid_amount = SUM(payments.amount) including negative refund rows
--       (refunds insert negative payment rows AND decrement paid_amount:
--        bills.ts:1206-1226, 1037-1052, 1783-1800)
--   * bills.refund_amount = cumulative refunded = -SUM(negative payments)
--   * bills.balance_amount = GREATEST(0, total - paid - refund)
--       (bills.ts:1195, gateway-webhooks.ts:135)
--   * Refund payment rows carry notes LIKE 'REFUND%'
--   * "Physical cash" is ONLY method = 'cash'
--       (artifacts/api-server/src/lib/paymentMethodClassifier.ts:55-67)
--   * Vouchers are single-row double entries (debit_account_id /
--     credit_account_id as text); auto-vouchers store bills.bill_number in
--     vouchers.reference and expenses.expense_id in vouchers.reference
--       (artifacts/api-server/src/lib/auto-voucher.ts:172, 235)
--   * Timezone for business dates: Asia/Kolkata (IST).
--
-- NUMERIC TOLERANCE: 0.01 (one paisa) on all money comparisons.
--
-- CHECKS THE SCHEMA CANNOT EXPRESS (documented, not implemented — see
-- 09-data-quality-findings.md):
--   * "multiple receipts per payment"  — no receipts table exists; the
--     payments row IS the receipt (no receipt_number column anywhere).
--   * "voucher debit/credit imbalance" — vouchers are single-row two-account
--     entries; debit always equals credit by construction. Substituted:
--     DQC-58 (debit==credit account), DQC-29 (non-positive amounts).
--   * "ledger lines without vouchers"  — no journal/ledger-line table exists;
--     `ledgers` is a patient-group dimension (lib/db/src/schema/ledgers.ts),
--     not an accounting ledger.
--   * per-line tax reconciliation      — order_tests has no tax columns;
--     bills.tax_amount is a single opaque figure (hardcoded 0 at creation).
--     Substituted: DQC-31 (total identity) and DQC-33 (unexpected nonzero tax).
-- =============================================================================


-- =============================================================================
-- SECTION 1 — DUPLICATE IDENTIFIERS
-- =============================================================================
-- Drizzle declares bills.bill_number, orders.order_number, vouchers.voucher_number,
-- expenses.expense_id and patients.patient_id UNIQUE, but the alternative DDL
-- bootstrap path migrations/zz_schema_reconcile_20260709.sql:142-186 & 296-311
-- creates bills/payments/vouchers WITHOUT unique constraints. If the live DB
-- was (partly) built by that path, duplicates are physically possible.

-- ── DQC-01: duplicate bill numbers ───────────────────────────────────────────
-- Invariant: bill_number uniquely identifies an invoice. NOTE: super-admin
-- DELETE /bills/:id renumbers all later bills of the month in-place
-- (bills.ts:1497-1525), so duplicates here can also indicate an interrupted
-- renumbering pass.
WITH anomalies AS (
  SELECT bill_number, COUNT(*) AS n, MIN(id) AS first_id
  FROM bills
  GROUP BY bill_number
  HAVING COUNT(*) > 1
)
SELECT 'DQC-01' AS check_id,
       'Duplicate bill_number values in bills' AS description,
       (SELECT COUNT(*) FROM anomalies) AS anomaly_count,
       (SELECT string_agg(bill_number || ' (x' || n || ', first bill id ' || first_id || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s) AS sample_ids;

-- ── DQC-02: duplicate order numbers ──────────────────────────────────────────
WITH anomalies AS (
  SELECT order_number, COUNT(*) AS n, MIN(id) AS first_id
  FROM orders
  GROUP BY order_number
  HAVING COUNT(*) > 1
)
SELECT 'DQC-02',
       'Duplicate order_number values in orders',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(order_number || ' (x' || n || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-03: duplicate patient MRNs ───────────────────────────────────────────
-- patients.patient_id is the business MRN printed on bills/receipts.
WITH anomalies AS (
  SELECT patient_id, COUNT(*) AS n
  FROM patients
  GROUP BY patient_id
  HAVING COUNT(*) > 1
)
SELECT 'DQC-03',
       'Duplicate patient_id (MRN) values in patients',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(patient_id || ' (x' || n || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-04: duplicate expense ids ────────────────────────────────────────────
-- expense_id (EXP-YYMM-####) is generated from a non-atomic counter read
-- (artifacts/api-server/src/routes/expenses.ts:22-32) — race duplicates possible.
WITH anomalies AS (
  SELECT expense_id, COUNT(*) AS n
  FROM expenses
  GROUP BY expense_id
  HAVING COUNT(*) > 1
)
SELECT 'DQC-04',
       'Duplicate expense_id values in expenses',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(expense_id || ' (x' || n || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-05: duplicate voucher numbers ────────────────────────────────────────
-- Voucher numbering is COUNT(*)+1 per month bucket (auto-voucher.ts:101-109)
-- and vouchers can be hard-deleted (accounting.ts:329-335), which recycles
-- numbers. The reconcile DDL path creates voucher_number WITHOUT a unique
-- index (zz_schema_reconcile_20260709.sql:296-311).
WITH anomalies AS (
  SELECT voucher_number, COUNT(*) AS n, MIN(id) AS first_id
  FROM vouchers
  GROUP BY voucher_number
  HAVING COUNT(*) > 1
)
SELECT 'DQC-05',
       'Duplicate voucher_number values in vouchers',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(voucher_number || ' (x' || n || ', first voucher id ' || first_id || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-06: duplicate payment rows for the same bill + gateway reference ─────
-- Should be 0 IF the partial unique index from
-- migrations/add_payment_idempotency_index.sql:17-19 is actually present.
-- Any hit means the index is missing on this DB AND a double-credit occurred.
WITH anomalies AS (
  SELECT bill_id, reference_number, COUNT(*) AS n, SUM(amount) AS total_credited
  FROM payments
  WHERE reference_number IS NOT NULL AND reference_number <> ''
  GROUP BY bill_id, reference_number
  HAVING COUNT(*) > 1
)
SELECT 'DQC-06',
       'Duplicate payments with identical (bill_id, reference_number)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || bill_id || ' ref ' || reference_number || ' (x' || n || ', total ' || total_credited || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-07: same gateway reference credited to MULTIPLE different bills ──────
-- The partial unique index is scoped per bill, so one gateway transaction id
-- posted against two different bills passes the index but is still a
-- double-credit of one real-world payment.
WITH anomalies AS (
  SELECT reference_number, COUNT(DISTINCT bill_id) AS n_bills, SUM(amount) AS total_credited
  FROM payments
  WHERE reference_number IS NOT NULL AND reference_number <> ''
    AND amount > 0
  GROUP BY reference_number
  HAVING COUNT(DISTINCT bill_id) > 1
)
SELECT 'DQC-07',
       'Same payment reference_number credited to more than one bill',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(reference_number || ' (' || n_bills || ' bills, total ' || total_credited || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n_bills DESC LIMIT 5) s);

-- ── DQC-08: duplicate provider transaction ids across online bookings ────────
-- online_bookings has FIVE per-gateway id columns with NO unique index
-- (lib/db/src/schema/onlineBookings.ts:19-29). The same provider payment id
-- appearing on two bookings means one payment confirmed two bookings.
WITH ids AS (
  SELECT id, 'razorpay' AS gw, razorpay_payment_id AS txn FROM online_bookings
    WHERE razorpay_payment_id IS NOT NULL AND razorpay_payment_id <> ''
  UNION ALL
  SELECT id, 'payu', payu_payment_id FROM online_bookings
    WHERE payu_payment_id IS NOT NULL AND payu_payment_id <> ''
  UNION ALL
  SELECT id, 'phonepe', phonepe_transaction_id FROM online_bookings
    WHERE phonepe_transaction_id IS NOT NULL AND phonepe_transaction_id <> ''
  UNION ALL
  SELECT id, 'bharatpe', bharatpe_transaction_id FROM online_bookings
    WHERE bharatpe_transaction_id IS NOT NULL AND bharatpe_transaction_id <> ''
  UNION ALL
  SELECT id, 'icici', icici_transaction_id FROM online_bookings
    WHERE icici_transaction_id IS NOT NULL AND icici_transaction_id <> ''
),
anomalies AS (
  SELECT gw, txn, COUNT(*) AS n, MIN(id) AS first_booking
  FROM ids
  GROUP BY gw, txn
  HAVING COUNT(*) > 1
)
SELECT 'DQC-08',
       'Same provider payment/transaction id on multiple online_bookings rows',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(gw || ':' || txn || ' (x' || n || ', first booking id ' || first_booking || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-09: duplicate external transaction ids in gateway_transactions ───────
-- banking.ts:267 declares external_transaction_id with no unique index.
WITH anomalies AS (
  SELECT provider, external_transaction_id, COUNT(*) AS n
  FROM gateway_transactions
  WHERE external_transaction_id IS NOT NULL AND external_transaction_id <> ''
  GROUP BY provider, external_transaction_id
  HAVING COUNT(*) > 1
)
SELECT 'DQC-09',
       'Duplicate (provider, external_transaction_id) in gateway_transactions',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(provider || ':' || external_transaction_id || ' (x' || n || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-10: duplicate gateway webhook deliveries ─────────────────────────────
-- webhook_logs (banking.ts:93-106) stores every delivery. Identical raw bodies
-- from the same provider = the gateway retried / replayed a callback. Not an
-- error per se, but every duplicate delivery must map to exactly ONE payment
-- row (cross-check DQC-06/07).
WITH anomalies AS (
  SELECT provider,
         md5(COALESCE(raw_body, payload::text, '')) AS body_hash,
         COUNT(*) AS n, MIN(id) AS first_id
  FROM webhook_logs
  GROUP BY provider, md5(COALESCE(raw_body, payload::text, ''))
  HAVING COUNT(*) > 1
)
SELECT 'DQC-10',
       'Duplicate webhook deliveries (same provider + identical body)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(provider || ' hash ' || substr(body_hash, 1, 8) || ' (x' || n || ', first log id ' || first_id || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-11: multiple SUCCESS payment_logs for one booking + gateway ──────────
-- payment_logs (lib/db/src/schema/paymentLogs.ts) has no uniqueness at all.
-- Two 'success' rows for the same booking_ref+gateway indicate a replayed /
-- double-processed callback.
WITH anomalies AS (
  SELECT booking_ref, gateway, COUNT(*) AS n
  FROM payment_logs
  WHERE status = 'success'
  GROUP BY booking_ref, gateway
  HAVING COUNT(*) > 1
)
SELECT 'DQC-11',
       'Multiple success rows in payment_logs for same (booking_ref, gateway)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(booking_ref || '/' || gateway || ' (x' || n || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-12: near-duplicate CASH payments (heuristic) ─────────────────────────
-- Cash rows have NULL reference_number, so the partial unique index cannot
-- protect them (add_payment_idempotency_index.sql:9-10). Two identical cash
-- amounts on the same bill within 120 seconds are flagged for human review
-- (double-click / retry duplicates). REVIEW ITEMS, not proven defects.
WITH anomalies AS (
  SELECT p1.id AS id1, p2.id AS id2, p1.bill_id, p1.amount
  FROM payments p1
  JOIN payments p2
    ON p2.bill_id = p1.bill_id
   AND p2.id > p1.id
   AND p2.amount = p1.amount
   AND lower(p2.method) = lower(p1.method)
   AND ABS(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at))) < 120
  WHERE lower(p1.method) = 'cash'
    AND p1.amount > 0
)
SELECT 'DQC-12',
       'Possible duplicate cash payments: same bill+amount within 120s (review)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('payments ' || id1 || '+' || id2 || ' on bill ' || bill_id || ' amount ' || amount, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id1 LIMIT 5) s);


-- =============================================================================
-- SECTION 2 — REFERENTIAL INTEGRITY / ORPHANS
-- =============================================================================
-- Drizzle declares FKs for payments.bill_id, bills.order_id/patient_id and
-- order_tests (bills.ts:50, bills.ts:10-11, orders.ts:30-31), but the
-- reconcile DDL path (zz_schema_reconcile_20260709.sql:142-186) creates these
-- tables WITHOUT foreign keys, so orphans are possible on DBs built that way.
-- Several link columns (bills.ledger_id, vouchers.bill_id, expenses.voucher_id,
-- online_bookings.bill_id/patient_id, all banking links) have NO FK in any path.

-- ── DQC-13: payments without a bill ──────────────────────────────────────────
WITH anomalies AS (
  SELECT p.id, p.bill_id, p.amount
  FROM payments p
  LEFT JOIN bills b ON b.id = p.bill_id
  WHERE b.id IS NULL
)
SELECT 'DQC-13',
       'payments rows whose bill_id has no bills row',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('payment ' || id || ' -> bill ' || bill_id || ' (amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-14: bills without a patient ──────────────────────────────────────────
WITH anomalies AS (
  SELECT b.id, b.bill_number, b.patient_id
  FROM bills b
  LEFT JOIN patients pt ON pt.id = b.patient_id
  WHERE pt.id IS NULL
)
SELECT 'DQC-14',
       'bills rows whose patient_id has no patients row',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' -> patient ' || patient_id, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-15: bills without an order ───────────────────────────────────────────
WITH anomalies AS (
  SELECT b.id, b.bill_number, b.order_id
  FROM bills b
  LEFT JOIN orders o ON o.id = b.order_id
  WHERE o.id IS NULL
)
SELECT 'DQC-15',
       'bills rows whose order_id has no orders row',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' -> order ' || order_id, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-16: order line items without order or test master ────────────────────
WITH anomalies AS (
  SELECT ot.id, ot.order_id, ot.test_id,
         CASE WHEN o.id IS NULL THEN 'missing order' ELSE 'missing test' END AS problem
  FROM order_tests ot
  LEFT JOIN orders o ON o.id = ot.order_id
  LEFT JOIN diagnostic_tests t ON t.id = ot.test_id
  WHERE o.id IS NULL OR t.id IS NULL
)
SELECT 'DQC-16',
       'order_tests rows with missing parent order or missing test master',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('order_test ' || id || ' (' || problem || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-17: bills pointing to a non-existent ledger ──────────────────────────
-- bills.ledger_id is a bare integer with no FK (lib/db/src/schema/bills.ts:21).
WITH anomalies AS (
  SELECT b.id, b.bill_number, b.ledger_id
  FROM bills b
  WHERE b.ledger_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ledgers l WHERE l.id = b.ledger_id)
)
SELECT 'DQC-17',
       'bills.ledger_id values with no ledgers row',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' -> ledger ' || ledger_id, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-18: online bookings pointing at missing bill / patient ───────────────
-- online_bookings.bill_id and patient_id are bare integers, no FK
-- (lib/db/src/schema/onlineBookings.ts:32-33).
WITH anomalies AS (
  SELECT ob.id, ob.booking_ref,
         CASE WHEN ob.bill_id IS NOT NULL AND b.id IS NULL THEN 'missing bill ' || ob.bill_id
              ELSE 'missing patient ' || ob.patient_id END AS problem
  FROM online_bookings ob
  LEFT JOIN bills b ON b.id = ob.bill_id
  LEFT JOIN patients pt ON pt.id = ob.patient_id
  WHERE (ob.bill_id IS NOT NULL AND b.id IS NULL)
     OR (ob.patient_id IS NOT NULL AND pt.id IS NULL)
)
SELECT 'DQC-18',
       'online_bookings linked to a bill_id/patient_id that does not exist',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('booking ' || id || ' ' || booking_ref || ' (' || problem || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-19: payment_logs without a matching booking ──────────────────────────
-- Billing-desk gateway initiations reuse payment_logs with synthetic refs of
-- the form 'BILL-<billId>-...' (bills.ts:2312-2318 parses parts[1] as billId),
-- so those are excluded; everything else should resolve to an online booking.
WITH anomalies AS (
  SELECT pl.id, pl.booking_ref, pl.gateway, pl.status
  FROM payment_logs pl
  WHERE pl.booking_ref NOT LIKE 'BILL-%'
    AND NOT EXISTS (SELECT 1 FROM online_bookings ob WHERE ob.booking_ref = pl.booking_ref)
)
SELECT 'DQC-19',
       'payment_logs (non billing-desk) whose booking_ref has no online_bookings row',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('log ' || id || ' ref ' || booking_ref || ' [' || gateway || '/' || status || ']', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-20: expenses pointing at a missing voucher ───────────────────────────
WITH anomalies AS (
  SELECT e.id, e.expense_id, e.voucher_id
  FROM expenses e
  WHERE e.voucher_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = e.voucher_id)
)
SELECT 'DQC-20',
       'expenses.voucher_id values with no vouchers row (voucher hard-deleted?)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(expense_id || ' -> voucher ' || voucher_id, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-21: vouchers pointing at a missing bill ──────────────────────────────
-- vouchers.bill_id has no FK (lib/db/src/schema/accounting.ts:67). Orphans here
-- are ALSO evidence of hard-deleted bills (DELETE /bills, bills.ts:1497-1526
-- deletes the bill and its payments but leaves vouchers behind).
WITH anomalies AS (
  SELECT v.id, v.voucher_number, v.bill_id, v.amount
  FROM vouchers v
  WHERE v.bill_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = v.bill_id)
)
SELECT 'DQC-21',
       'vouchers.bill_id values with no bills row (deleted-bill remnants)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(voucher_number || ' -> bill ' || bill_id || ' (amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-22: voucher account ids that resolve to no account ───────────────────
-- vouchers.debit_account_id / credit_account_id are TEXT with no FK
-- (accounting.ts:58-59). Auto-vouchers store the numeric accounts.id as text
-- (auto-voucher.ts:85-90). Anything that does not resolve is an orphan posting
-- that silently vanishes from trial balance / P&L groupings.
WITH anomalies AS (
  SELECT v.id, v.voucher_number,
         CASE WHEN da.id IS NULL THEN 'debit=' || v.debit_account_id ELSE 'credit=' || v.credit_account_id END AS bad_ref
  FROM vouchers v
  LEFT JOIN accounts da ON da.id::text = v.debit_account_id
  LEFT JOIN accounts ca ON ca.id::text = v.credit_account_id
  WHERE da.id IS NULL OR ca.id IS NULL
)
SELECT 'DQC-22',
       'vouchers whose debit/credit account id resolves to no accounts row',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(voucher_number || ' (' || bad_ref || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-23: bill audit rows for bills that no longer exist ───────────────────
-- bill_audits has deliberately no FK (bills.ts:1484 comment); orphan audit rows
-- are the ONLY surviving evidence of hard-deleted bills.
WITH anomalies AS (
  SELECT ba.id, ba.bill_id, ba.change_type
  FROM bill_audits ba
  WHERE NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = ba.bill_id)
)
SELECT 'DQC-23',
       'bill_audits rows whose bill no longer exists (hard-delete evidence)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('audit ' || id || ' -> bill ' || bill_id || ' [' || change_type || ']', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-24: voucher audit rows for vouchers that no longer exist ─────────────
WITH anomalies AS (
  SELECT va.id, va.voucher_id, va.voucher_number
  FROM voucher_audits va
  WHERE NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = va.voucher_id)
)
SELECT 'DQC-24',
       'voucher_audits rows whose voucher no longer exists (hard-delete evidence)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('audit ' || id || ' -> voucher ' || voucher_id || ' (' || voucher_number || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-25: refund requests pointing at missing bill/payment ─────────────────
WITH anomalies AS (
  SELECT rr.id, rr.bill_id, rr.payment_id, rr.status,
         CASE WHEN b.id IS NULL THEN 'missing bill' ELSE 'missing payment' END AS problem
  FROM refund_requests rr
  LEFT JOIN bills b ON b.id = rr.bill_id
  LEFT JOIN payments p ON p.id = rr.payment_id
  WHERE b.id IS NULL OR p.id IS NULL
)
SELECT 'DQC-25',
       'refund_requests whose bill_id or payment_id does not exist',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('refund_request ' || id || ' (' || problem || ', status ' || status || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-26: banking linkage orphans ──────────────────────────────────────────
-- bank_transactions.payment_id / voucher_id and reconciliation_logs links are
-- all bare integers (banking.ts:45-68, 144-166).
WITH anomalies AS (
  SELECT 'bank_txn ' || bt.id || ' -> payment ' || bt.payment_id AS ref
  FROM bank_transactions bt
  WHERE bt.payment_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = bt.payment_id)
  UNION ALL
  SELECT 'bank_txn ' || bt.id || ' -> voucher ' || bt.voucher_id
  FROM bank_transactions bt
  WHERE bt.voucher_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = bt.voucher_id)
  UNION ALL
  SELECT 'recon_log ' || rl.id || ' -> bank_txn ' || rl.bank_transaction_id
  FROM reconciliation_logs rl
  WHERE NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.id = rl.bank_transaction_id)
  UNION ALL
  SELECT 'recon_log ' || rl.id || ' -> payment ' || rl.payment_id
  FROM reconciliation_logs rl
  WHERE rl.payment_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = rl.payment_id)
)
SELECT 'DQC-26',
       'Orphaned banking/reconciliation links (bank_transactions, reconciliation_logs)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(ref, '; ') FROM (SELECT ref FROM anomalies LIMIT 5) s);


-- =============================================================================
-- SECTION 3 — AMOUNT / SIGN / VALUE SANITY
-- =============================================================================
-- There are ZERO CHECK constraints in the entire financial schema (verified:
-- `grep -c CHECK lib/db/drizzle/0000_dear_forge.sql` = 0), so every rule below
-- is enforceable only by application code — and therefore violable.

-- ── DQC-27: negative money fields on bills ───────────────────────────────────
WITH anomalies AS (
  SELECT id, bill_number
  FROM bills
  WHERE subtotal < 0 OR discount < 0 OR tax_amount < 0 OR total_amount < 0
     OR paid_amount < -0.01  -- paid can be transiently ~0; truly negative is anomalous
     OR balance_amount < 0 OR refund_amount < 0 OR original_total < 0
)
SELECT 'DQC-27',
       'bills with any negative money column',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-28: zero payments, and negative payments that are not refunds ────────
-- Negative payment rows are ONLY legitimate as refunds and always carry
-- notes LIKE 'REFUND%' (bills.ts:1042, 1213, 1788).
WITH anomalies AS (
  SELECT id, bill_id, amount, method
  FROM payments
  WHERE amount = 0
     OR (amount < 0 AND (notes IS NULL OR notes NOT LIKE 'REFUND%'))
)
SELECT 'DQC-28',
       'payments with zero amount, or negative amount not labelled as REFUND',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('payment ' || id || ' bill ' || bill_id || ' amount ' || amount, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-29: non-positive expense / voucher amounts ───────────────────────────
WITH anomalies AS (
  SELECT 'expense ' || expense_id || ' amount ' || amount AS ref, id
  FROM expenses WHERE amount <= 0
  UNION ALL
  SELECT 'voucher ' || voucher_number || ' amount ' || amount, id
  FROM vouchers WHERE amount <= 0
)
SELECT 'DQC-29',
       'expenses or vouchers with amount <= 0',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(ref, '; ') FROM (SELECT ref FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-30: discount exceeding gross (subtotal) ──────────────────────────────
-- App-level guard exists only at creation (bills.ts:533-536); PUT /bills/:id
-- and super-edit can bypass it.
WITH anomalies AS (
  SELECT id, bill_number, subtotal, discount
  FROM bills
  WHERE discount > subtotal + 0.01
)
SELECT 'DQC-30',
       'bills where discount > subtotal (over-100% discount)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (sub ' || subtotal || ', disc ' || discount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-31: bill total identity broken ───────────────────────────────────────
-- Invariant: total_amount = subtotal - discount + tax_amount (bills.ts:550).
WITH anomalies AS (
  SELECT id, bill_number, subtotal, discount, tax_amount, total_amount
  FROM bills
  WHERE ABS(total_amount - (subtotal - discount + tax_amount)) > 0.01
)
SELECT 'DQC-31',
       'bills where total_amount <> subtotal - discount + tax_amount',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (total ' || total_amount || ' vs calc ' || (subtotal - discount + tax_amount) || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-32: discount given with no recorded reason ───────────────────────────
-- App rule: "Discount reason is required when a discount is given" (bills.ts:413-415).
WITH anomalies AS (
  SELECT id, bill_number, discount
  FROM bills
  WHERE discount > 0.01
    AND (discount_reason IS NULL OR btrim(discount_reason) = '')
)
SELECT 'DQC-32',
       'bills with discount > 0 but empty discount_reason',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (disc ' || discount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-33: nonzero tax amounts (unexplained by any line-item data) ──────────
-- Bill creation hardcodes taxAmount = 0 (bills.ts:549) and order_tests carries
-- no tax columns, so ANY nonzero tax_amount was set by an edit path and has no
-- supporting breakdown. Flagged for CA/GST review.
WITH anomalies AS (
  SELECT id, bill_number, tax_amount
  FROM bills
  WHERE ABS(tax_amount) > 0.005
)
SELECT 'DQC-33',
       'bills with nonzero tax_amount (no line-level tax data exists to support it)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (tax ' || tax_amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-34: refunds exceeding lifetime collections ───────────────────────────
-- refund_amount must never exceed the sum of positive payment rows ever taken.
WITH pay AS (
  SELECT bill_id, COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS collected
  FROM payments GROUP BY bill_id
),
anomalies AS (
  SELECT b.id, b.bill_number, b.refund_amount, COALESCE(p.collected, 0) AS collected
  FROM bills b
  LEFT JOIN pay p ON p.bill_id = b.id
  WHERE b.refund_amount > COALESCE(p.collected, 0) + 0.01
)
SELECT 'DQC-34',
       'bills where refund_amount exceeds total positive payments collected',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (refund ' || refund_amount || ' > collected ' || collected || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);


-- =============================================================================
-- SECTION 4 — DENORMALIZED BILL TOTALS vs PAYMENT ROWS
-- =============================================================================
-- bills.paid_amount / refund_amount / balance_amount are cached aggregates
-- rewritten by at least seven independent code paths (bills.ts:611, 1037,
-- 1208, 1783, 1919, 2074/2107, 2349; gateway-webhooks.ts:122;
-- public-booking.ts:1328; self-registration.ts:202) with NO database-level
-- reconciliation. These checks recompute them from the payments ledger.

-- ── DQC-35: paid_amount out of sync with SUM(payments) ───────────────────────
-- Invariant: paid_amount = SUM(all payment rows, refunds included as negatives).
WITH pay AS (
  SELECT bill_id, COALESCE(SUM(amount), 0) AS ledger_paid
  FROM payments GROUP BY bill_id
),
anomalies AS (
  SELECT b.id, b.bill_number, b.paid_amount, COALESCE(p.ledger_paid, 0) AS ledger_paid
  FROM bills b
  LEFT JOIN pay p ON p.bill_id = b.id
  WHERE ABS(b.paid_amount - COALESCE(p.ledger_paid, 0)) > 0.01
)
SELECT 'DQC-35',
       'bills.paid_amount <> SUM(payments.amount) for the bill',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (cached ' || paid_amount || ' vs ledger ' || ledger_paid || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY ABS(paid_amount - ledger_paid) DESC LIMIT 5) s);

-- ── DQC-36: refund_amount out of sync with negative payment rows ─────────────
-- Note: PATCH /bills/:id/super-edit can set totals without touching payments,
-- so hits here also expose untraceable super-edits.
WITH refunds AS (
  SELECT bill_id, COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0) AS ledger_refund
  FROM payments GROUP BY bill_id
),
anomalies AS (
  SELECT b.id, b.bill_number, b.refund_amount, COALESCE(r.ledger_refund, 0) AS ledger_refund
  FROM bills b
  LEFT JOIN refunds r ON r.bill_id = b.id
  WHERE ABS(b.refund_amount - COALESCE(r.ledger_refund, 0)) > 0.01
)
SELECT 'DQC-36',
       'bills.refund_amount <> -SUM(negative payments) for the bill',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (cached ' || refund_amount || ' vs ledger ' || ledger_refund || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY ABS(refund_amount - ledger_refund) DESC LIMIT 5) s);

-- ── DQC-37: balance identity broken ──────────────────────────────────────────
-- Invariant: balance_amount = GREATEST(0, total - paid - refund)
-- (bills.ts:1195; gateway-webhooks.ts:135). Cancelled bills are zeroed on
-- cancel (bills.ts:980-985) and satisfy this via DQC-39 instead.
WITH anomalies AS (
  SELECT id, bill_number, status, total_amount, paid_amount, refund_amount, balance_amount
  FROM bills
  WHERE status <> 'cancelled'
    AND ABS(balance_amount - GREATEST(0, total_amount - paid_amount - refund_amount)) > 0.01
)
SELECT 'DQC-37',
       'bills.balance_amount <> GREATEST(0, total - paid - refund)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (bal ' || balance_amount || ' vs calc ' || GREATEST(0, total_amount - paid_amount - refund_amount) || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-38: bill status incoherent with amounts ──────────────────────────────
-- Known statuses: pending | partial | paid | cancelled (bills.ts:586, 980, 1198-1200).
WITH anomalies AS (
  SELECT id, bill_number, status, total_amount, paid_amount, balance_amount
  FROM bills
  WHERE (status = 'paid'    AND balance_amount > 0.01)
     OR (status = 'pending' AND paid_amount    > 0.01)
     OR (status = 'partial' AND (paid_amount <= 0.01 OR (balance_amount <= 0.01 AND total_amount > 0.01)))
     OR (status NOT IN ('pending', 'partial', 'paid', 'cancelled'))
)
SELECT 'DQC-38',
       'bills whose status contradicts paid/balance amounts, or unknown status',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' [' || status || ' paid=' || paid_amount || ' bal=' || balance_amount || ']', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);


-- =============================================================================
-- SECTION 5 — CANCELLATION COHERENCE
-- =============================================================================

-- ── DQC-39: cancelled bills with nonzero balance ─────────────────────────────
-- Cancel zeroes the outstanding balance (bills.ts:980-985 "Zero out the
-- outstanding balance so cancelled bills never appear [in dues]").
WITH anomalies AS (
  SELECT id, bill_number, balance_amount
  FROM bills
  WHERE status = 'cancelled' AND ABS(balance_amount) > 0.01
)
SELECT 'DQC-39',
       'cancelled bills whose balance_amount is not zero',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (bal ' || balance_amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-40: positive payments recorded AFTER a bill was cancelled ────────────
-- Money should never be collected against a cancelled bill.
WITH anomalies AS (
  SELECT p.id AS payment_id, p.bill_id, p.amount, p.created_at, b.cancelled_at
  FROM payments p
  JOIN bills b ON b.id = p.bill_id
  WHERE b.status = 'cancelled'
    AND b.cancelled_at IS NOT NULL
    AND p.amount > 0
    AND p.created_at > b.cancelled_at
)
SELECT 'DQC-40',
       'positive payments dated after the bill''s cancelled_at timestamp',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('payment ' || payment_id || ' on cancelled bill ' || bill_id || ' (amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY payment_id LIMIT 5) s);

-- ── DQC-41: cancelled bills still holding collected money (review) ───────────
-- After cancel + full refund, paid_amount should be ~0 (refunds decrement it).
-- A cancelled bill with paid_amount > 0 means patient money was retained
-- without an active service. May be legitimate (adjustments) — REVIEW ITEMS.
WITH anomalies AS (
  SELECT id, bill_number, paid_amount, refund_amount
  FROM bills
  WHERE status = 'cancelled' AND paid_amount > 0.01
)
SELECT 'DQC-41',
       'cancelled bills with paid_amount still > 0 (money retained; review)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (paid ' || paid_amount || ', refunded ' || refund_amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY paid_amount DESC LIMIT 5) s);


-- =============================================================================
-- SECTION 6 — BILL ↔ ORDER LINES ↔ BOOKINGS
-- =============================================================================

-- ── DQC-42: bill subtotal out of sync with active line items ─────────────────
-- Invariant: subtotal = SUM(order_tests.price WHERE status <> 'cancelled')
-- (creation: bills.ts:526 from orders.total_amount; recalc: bills.ts:1764).
WITH lines AS (
  SELECT order_id, COALESCE(SUM(price) FILTER (WHERE status <> 'cancelled'), 0) AS active_total
  FROM order_tests GROUP BY order_id
),
anomalies AS (
  SELECT b.id, b.bill_number, b.subtotal, COALESCE(l.active_total, 0) AS active_total
  FROM bills b
  LEFT JOIN lines l ON l.order_id = b.order_id
  WHERE b.status <> 'cancelled'
    AND ABS(b.subtotal - COALESCE(l.active_total, 0)) > 0.01
)
SELECT 'DQC-42',
       'bills.subtotal <> SUM(active order_tests.price) for the bill''s order',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || id || ' ' || bill_number || ' (sub ' || subtotal || ' vs lines ' || active_total || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY ABS(subtotal - active_total) DESC LIMIT 5) s);

-- ── DQC-43: multiple active (non-cancelled) bills for one order ──────────────
-- App enforces one active bill per order (bills.ts:449, 495-501); no DB unique
-- constraint backs this.
WITH anomalies AS (
  SELECT order_id, COUNT(*) AS n, MIN(id) AS first_bill
  FROM bills
  WHERE status <> 'cancelled'
  GROUP BY order_id
  HAVING COUNT(*) > 1
)
SELECT 'DQC-43',
       'orders with more than one non-cancelled bill (multiple final invoices)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('order ' || order_id || ' (' || n || ' active bills, first bill id ' || first_bill || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-44: multiple online bookings confirmed into the same bill ────────────
-- Each confirmed booking must map to its own bill (self-registration creates a
-- fresh bill per booking). Two bookings sharing bill_id = one invoice claimed
-- by two paid bookings.
WITH anomalies AS (
  SELECT bill_id, COUNT(*) AS n
  FROM online_bookings
  WHERE bill_id IS NOT NULL
  GROUP BY bill_id
  HAVING COUNT(*) > 1
)
SELECT 'DQC-44',
       'multiple online_bookings rows sharing the same bill_id',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || bill_id || ' (' || n || ' bookings)', '; ')
          FROM (SELECT * FROM anomalies ORDER BY n DESC LIMIT 5) s);

-- ── DQC-45: booking's patient differs from the bill's patient ────────────────
WITH anomalies AS (
  SELECT ob.id, ob.booking_ref, ob.patient_id AS booking_patient, b.patient_id AS bill_patient
  FROM online_bookings ob
  JOIN bills b ON b.id = ob.bill_id
  WHERE ob.patient_id IS NOT NULL
    AND ob.patient_id <> b.patient_id
)
SELECT 'DQC-45',
       'online booking linked to a bill that belongs to a different patient id',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('booking ' || id || ' ' || booking_ref || ' (booking pt ' || booking_patient || ' vs bill pt ' || bill_patient || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);


-- =============================================================================
-- SECTION 7 — GATEWAY PAYMENTS ↔ BOOKINGS
-- =============================================================================
-- Booking state machine: pending_payment → paid → confirmed | payment_failed |
-- cancelled (onlineBookings.ts:30 default 'pending_payment').

-- ── DQC-46: successful gateway payment but booking never marked paid ─────────
WITH anomalies AS (
  SELECT pl.id AS log_id, pl.booking_ref, pl.gateway, ob.status
  FROM payment_logs pl
  JOIN online_bookings ob ON ob.booking_ref = pl.booking_ref
  WHERE pl.status = 'success'
    AND ob.status NOT IN ('paid', 'confirmed')
)
SELECT 'DQC-46',
       'success payment_logs whose booking is not in paid/confirmed status',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('log ' || log_id || ' ref ' || booking_ref || ' [' || gateway || ' -> booking ' || status || ']', '; ')
          FROM (SELECT * FROM anomalies ORDER BY log_id LIMIT 5) s);

-- ── DQC-47: confirmed bookings without a bill ────────────────────────────────
-- Confirmation creates the bill (services/self-registration.ts:184-200,
-- routes/online-bookings.ts). A confirmed booking with no bill means paid
-- money with no invoice.
WITH anomalies AS (
  SELECT ob.id, ob.booking_ref, ob.total_amount
  FROM online_bookings ob
  WHERE ob.status = 'confirmed'
    AND (ob.bill_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = ob.bill_id))
)
SELECT 'DQC-47',
       'confirmed bookings with no (or missing) bill',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('booking ' || id || ' ' || booking_ref || ' (amount ' || total_amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-48: paid/confirmed bookings with NO gateway evidence at all ──────────
-- A booking claiming money was received must carry at least one provider
-- transaction id (any of the 5 gateway column pairs) or a success payment_log.
WITH anomalies AS (
  SELECT ob.id, ob.booking_ref, ob.status, ob.total_amount
  FROM online_bookings ob
  WHERE ob.status IN ('paid', 'confirmed')
    AND COALESCE(ob.razorpay_payment_id, '') = ''
    AND COALESCE(ob.payu_payment_id, '') = ''
    AND COALESCE(ob.payu_txn_id, '') = ''
    AND COALESCE(ob.phonepe_transaction_id, '') = ''
    AND COALESCE(ob.bharatpe_transaction_id, '') = ''
    AND COALESCE(ob.icici_transaction_id, '') = ''
    AND NOT EXISTS (
      SELECT 1 FROM payment_logs pl
      WHERE pl.booking_ref = ob.booking_ref AND pl.status = 'success'
    )
)
SELECT 'DQC-48',
       'paid/confirmed bookings with no gateway txn id and no success payment_log',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('booking ' || id || ' ' || booking_ref || ' [' || status || ', ' || total_amount || ']', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-49: successful gateway_transactions not linked to any payment ────────
WITH anomalies AS (
  SELECT gt.id, gt.provider, gt.external_transaction_id, gt.amount
  FROM gateway_transactions gt
  WHERE gt.status = 'success'
    AND (gt.payment_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = gt.payment_id))
)
SELECT 'DQC-49',
       'gateway_transactions in success status with no linked payments row',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('gtxn ' || id || ' ' || provider || '/' || COALESCE(external_transaction_id, '?') || ' (amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-50: gateway transaction amount differs from the linked payment ───────
WITH anomalies AS (
  SELECT gt.id, gt.provider, gt.amount AS gw_amount, p.amount AS pay_amount
  FROM gateway_transactions gt
  JOIN payments p ON p.id = gt.payment_id
  WHERE ABS(gt.amount - p.amount) > 0.01
)
SELECT 'DQC-50',
       'gateway_transactions.amount <> linked payments.amount',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('gtxn ' || id || ' ' || provider || ' (gw ' || gw_amount || ' vs pay ' || pay_amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);


-- =============================================================================
-- SECTION 8 — DAY CLOSE
-- =============================================================================
-- Day close is explicitly NON-blocking: "Bills/payments created AFTER closedAt
-- automatically belong to the next open day — there is no hard block"
-- (lib/db/src/schema/dayClosures.ts:12-14). Payments carry only created_at, so
-- true backdating cannot be detected from data; the checks below catch what IS
-- detectable.

-- ── DQC-51: cash receipts recorded after the day's close, same IST date ──────
-- Cash taken on a business date AFTER that date's drawer was closed and signed
-- off was never counted in that day's drawer. REVIEW ITEMS (allowed by design,
-- but each one is uncounted same-day cash).
WITH last_close AS (
  SELECT closure_date, MAX(covered_to_ts) AS last_close_ts
  FROM day_closures
  WHERE status = 'closed'
  GROUP BY closure_date
),
anomalies AS (
  SELECT p.id, p.bill_id, p.amount, p.created_at, lc.closure_date
  FROM payments p
  JOIN last_close lc
    ON (p.created_at AT TIME ZONE 'Asia/Kolkata')::date = lc.closure_date
   AND p.created_at > lc.last_close_ts
  WHERE lower(p.method) = 'cash'
    AND p.amount > 0
)
SELECT 'DQC-51',
       'cash payments recorded on a closed IST business date AFTER its final close',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('payment ' || id || ' bill ' || bill_id || ' amount ' || amount || ' on ' || closure_date, '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-52: closure arithmetic inconsistencies ───────────────────────────────
-- variance must equal total_actual - total_expected, and total_expected must
-- equal the sum of the per-method expected columns (both closure tables).
WITH anomalies AS (
  SELECT 'day_closure ' || id AS ref
  FROM day_closures
  WHERE ABS(variance - (total_actual - total_expected)) > 0.01
     OR ABS(total_expected - (expected_cash + expected_upi + expected_card + expected_cheque + expected_other)) > 0.01
  UNION ALL
  SELECT 'user_day_closure ' || id
  FROM user_day_closures
  WHERE ABS(variance - (total_actual - total_expected)) > 0.01
     OR ABS(total_expected - (expected_cash + expected_upi + expected_card + expected_cheque + expected_other)) > 0.01
)
SELECT 'DQC-52',
       'day_closures/user_day_closures with internally inconsistent totals or variance',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(ref, '; ') FROM (SELECT ref FROM anomalies LIMIT 5) s);

-- ── DQC-53: closure coverage-window anomalies ────────────────────────────────
-- Inverted windows, or two CLOSED closures whose coverage windows overlap
-- (same payment counted in two sign-offs).
WITH anomalies AS (
  SELECT 'inverted window: day_closure ' || id AS ref
  FROM day_closures
  WHERE covered_from_ts IS NOT NULL AND covered_from_ts >= covered_to_ts
  UNION ALL
  SELECT 'overlap: day_closures ' || a.id || '+' || b.id
  FROM day_closures a
  JOIN day_closures b
    ON b.id > a.id
   AND a.status = 'closed' AND b.status = 'closed'
   AND a.covered_from_ts IS NOT NULL AND b.covered_from_ts IS NOT NULL
   AND tstzrange(a.covered_from_ts, a.covered_to_ts, '(]')
       && tstzrange(b.covered_from_ts, b.covered_to_ts, '(]')
)
SELECT 'DQC-53',
       'day-closure coverage windows inverted or overlapping between closed rows',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(ref, '; ') FROM (SELECT ref FROM anomalies LIMIT 5) s);


-- =============================================================================
-- SECTION 9 — EXPENSES & VOUCHERS
-- =============================================================================

-- ── DQC-54: expense hygiene — blank category/description, no approver ────────
-- category/description are NOT NULL but empty strings are DB-legal; approved_by
-- is nullable free text (lib/db/src/schema/expenses.ts:8-15). "Missing user"
-- cannot be checked more strongly: expenses has NO user id column at all.
WITH anomalies AS (
  SELECT id, expense_id, amount,
         CASE WHEN btrim(category) = '' THEN 'blank category'
              WHEN btrim(description) = '' THEN 'blank description'
              ELSE 'no approver' END AS problem
  FROM expenses
  WHERE btrim(category) = ''
     OR btrim(description) = ''
     OR COALESCE(btrim(approved_by), '') = ''
)
SELECT 'DQC-54',
       'expenses with blank category/description or no approved_by recorded',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(expense_id || ' (' || problem || ', amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-55: expenses with no auto-voucher posted ─────────────────────────────
-- autoVoucherForExpense stores expense_id in vouchers.reference
-- (auto-voucher.ts:235) but is fire-and-forget with all errors swallowed
-- (auto-voucher.ts:244-246) — gaps here are expenses missing from the books.
WITH anomalies AS (
  SELECT e.id, e.expense_id, e.amount
  FROM expenses e
  WHERE NOT EXISTS (
    SELECT 1 FROM vouchers v WHERE v.reference = e.expense_id
  )
)
SELECT 'DQC-55',
       'expenses with no voucher referencing their expense_id (silent posting loss)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(expense_id || ' (amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-56: '-edit' corrective vouchers (double-posted expenses) ─────────────
-- PATCH /expenses/:id fires a NEW full-amount voucher with reference
-- '<expense_id>-edit' while "the original PV remains for audit"
-- (expenses.ts:152-167) — every row here is an expense amount posted TWICE
-- (original + edited full amount, not the delta) in the voucher ledger.
WITH anomalies AS (
  SELECT v.id, v.voucher_number, v.reference, v.amount
  FROM vouchers v
  WHERE v.reference LIKE '%-edit'
)
SELECT 'DQC-56',
       'corrective ''-edit'' expense vouchers (full amount double-posted in books)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(voucher_number || ' ref ' || reference || ' (amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-57: receipt vouchers out of sync with positive payments per bill ─────
-- Every positive payment should produce one receipt voucher for the same
-- amount (auto-voucher.ts:128-174), but posting is fire-and-forget
-- (auto-voucher.ts:181-183). Differences = revenue in billing that never
-- reached the books (or duplicated vouchers). EXPECT a large count if
-- auto-vouchering was enabled after go-live — interpret trendwise.
WITH pay AS (
  SELECT bill_id, COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS collected
  FROM payments GROUP BY bill_id
),
vch AS (
  SELECT bill_id, COALESCE(SUM(amount) FILTER (WHERE type = 'receipt'), 0) AS receipted
  FROM vouchers WHERE bill_id IS NOT NULL GROUP BY bill_id
),
anomalies AS (
  SELECT COALESCE(p.bill_id, v.bill_id) AS bill_id,
         COALESCE(p.collected, 0) AS collected,
         COALESCE(v.receipted, 0) AS receipted
  FROM pay p
  FULL OUTER JOIN vch v ON v.bill_id = p.bill_id
  WHERE ABS(COALESCE(p.collected, 0) - COALESCE(v.receipted, 0)) > 0.01
)
SELECT 'DQC-57',
       'bills where receipt-voucher total <> positive-payments total (books gap)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('bill ' || bill_id || ' (collected ' || collected || ' vs receipted ' || receipted || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY ABS(collected - receipted) DESC LIMIT 5) s);

-- ── DQC-58: vouchers debiting and crediting the same account ─────────────────
-- Single-row double entry means debit==credit account is a self-cancelling,
-- meaningless posting. (True debit/credit IMBALANCE is structurally impossible
-- in this schema — see header note.)
WITH anomalies AS (
  SELECT id, voucher_number, debit_account_id, amount
  FROM vouchers
  WHERE debit_account_id = credit_account_id
)
SELECT 'DQC-58',
       'vouchers where debit_account_id = credit_account_id',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(voucher_number || ' (account ' || debit_account_id || ', amount ' || amount || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-59: voucher/expense dates stored as unparseable text ─────────────────
-- vouchers.date and expenses.expense_date are TEXT columns (accounting.ts:57,
-- expenses.ts:11): anything non-ISO silently falls out of period reports.
WITH anomalies AS (
  SELECT 'voucher ' || voucher_number || ' date "' || "date" || '"' AS ref, id
  FROM vouchers
  WHERE "date" !~ '^\d{4}-\d{2}-\d{2}$'
  UNION ALL
  SELECT 'expense ' || expense_id || ' date "' || expense_date || '"', id
  FROM expenses
  WHERE expense_date !~ '^\d{4}-\d{2}-\d{2}$'
)
SELECT 'DQC-59',
       'vouchers/expenses whose text date is not strict YYYY-MM-DD',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(ref, '; ') FROM (SELECT ref FROM anomalies ORDER BY id LIMIT 5) s);

-- ── DQC-60: voucher references stale vs current bill number ──────────────────
-- Auto-vouchers freeze bills.bill_number into vouchers.reference
-- (auto-voucher.ts:172), but super-admin DELETE /bills RENUMBERS later bills
-- of the month in place (bills.ts:1502-1525) without touching vouchers.
-- Mismatches = books referencing invoice numbers that now belong to a
-- DIFFERENT bill.
WITH anomalies AS (
  SELECT v.id, v.voucher_number, v.reference, b.bill_number
  FROM vouchers v
  JOIN bills b ON b.id = v.bill_id
  WHERE v.reference IS NOT NULL
    AND v.reference <> ''
    AND v.reference <> b.bill_number
)
SELECT 'DQC-60',
       'vouchers whose stored bill reference no longer matches the bill''s number',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg(voucher_number || ' (ref ' || reference || ' vs bill now ' || bill_number || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);


-- =============================================================================
-- SECTION 10 — AUDIT HASH CHAIN
-- =============================================================================

-- ── DQC-61: audit_logs hash-chain discontinuities ────────────────────────────
-- Design: previous_hash of row N must equal chain_hash of row N-1 (by id);
-- both default to '' (lib/db/src/schema/auditLogs.ts:32-33), so empty-hash
-- rows are DB-legal and evade chain verification. Full SHA-256 recomputation
-- requires the application verifier; this check finds structural breaks.
WITH chain AS (
  SELECT id, previous_hash, chain_hash,
         LAG(chain_hash) OVER (ORDER BY id) AS expected_prev
  FROM audit_logs
),
anomalies AS (
  SELECT id,
         CASE WHEN chain_hash = '' THEN 'empty chain_hash'
              ELSE 'previous_hash mismatch' END AS problem
  FROM chain
  WHERE chain_hash = ''
     OR (expected_prev IS NOT NULL AND previous_hash <> expected_prev)
)
SELECT 'DQC-61',
       'audit_logs rows breaking the hash chain (empty hash or prev-hash mismatch)',
       (SELECT COUNT(*) FROM anomalies),
       (SELECT string_agg('audit_log ' || id || ' (' || problem || ')', '; ')
          FROM (SELECT * FROM anomalies ORDER BY id LIMIT 5) s);


-- =============================================================================
-- FINAL SUMMARY — all anomaly counts in one result set
-- =============================================================================
-- Re-computes each check's count (no temp state is kept — script is pure
-- SELECT). Order by section, then id. anomaly_count = 0 means clean.

SELECT * FROM (
  SELECT 'DQC-01' AS check_id, 'Duplicate bill numbers' AS description,
    (SELECT COUNT(*) FROM (SELECT 1 FROM bills GROUP BY bill_number HAVING COUNT(*) > 1) q) AS anomaly_count
  UNION ALL SELECT 'DQC-02', 'Duplicate order numbers',
    (SELECT COUNT(*) FROM (SELECT 1 FROM orders GROUP BY order_number HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-03', 'Duplicate patient MRNs',
    (SELECT COUNT(*) FROM (SELECT 1 FROM patients GROUP BY patient_id HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-04', 'Duplicate expense ids',
    (SELECT COUNT(*) FROM (SELECT 1 FROM expenses GROUP BY expense_id HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-05', 'Duplicate voucher numbers',
    (SELECT COUNT(*) FROM (SELECT 1 FROM vouchers GROUP BY voucher_number HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-06', 'Duplicate payments (bill, gateway ref)',
    (SELECT COUNT(*) FROM (SELECT 1 FROM payments WHERE reference_number IS NOT NULL AND reference_number <> '' GROUP BY bill_id, reference_number HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-07', 'Gateway ref credited to multiple bills',
    (SELECT COUNT(*) FROM (SELECT 1 FROM payments WHERE reference_number IS NOT NULL AND reference_number <> '' AND amount > 0 GROUP BY reference_number HAVING COUNT(DISTINCT bill_id) > 1) q)
  UNION ALL SELECT 'DQC-08', 'Duplicate provider txn ids across bookings',
    (SELECT COUNT(*) FROM (
      SELECT gw, txn FROM (
        SELECT 'rzp' AS gw, razorpay_payment_id AS txn FROM online_bookings WHERE COALESCE(razorpay_payment_id, '') <> ''
        UNION ALL SELECT 'payu', payu_payment_id FROM online_bookings WHERE COALESCE(payu_payment_id, '') <> ''
        UNION ALL SELECT 'phonepe', phonepe_transaction_id FROM online_bookings WHERE COALESCE(phonepe_transaction_id, '') <> ''
        UNION ALL SELECT 'bharatpe', bharatpe_transaction_id FROM online_bookings WHERE COALESCE(bharatpe_transaction_id, '') <> ''
        UNION ALL SELECT 'icici', icici_transaction_id FROM online_bookings WHERE COALESCE(icici_transaction_id, '') <> ''
      ) ids GROUP BY gw, txn HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-09', 'Duplicate gateway_transactions external ids',
    (SELECT COUNT(*) FROM (SELECT 1 FROM gateway_transactions WHERE COALESCE(external_transaction_id, '') <> '' GROUP BY provider, external_transaction_id HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-10', 'Duplicate webhook deliveries',
    (SELECT COUNT(*) FROM (SELECT 1 FROM webhook_logs GROUP BY provider, md5(COALESCE(raw_body, payload::text, '')) HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-11', 'Duplicate success payment_logs per booking',
    (SELECT COUNT(*) FROM (SELECT 1 FROM payment_logs WHERE status = 'success' GROUP BY booking_ref, gateway HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-12', 'Near-duplicate cash payments <120s (review)',
    (SELECT COUNT(*) FROM payments p1 JOIN payments p2 ON p2.bill_id = p1.bill_id AND p2.id > p1.id AND p2.amount = p1.amount AND lower(p2.method) = lower(p1.method) AND ABS(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at))) < 120 WHERE lower(p1.method) = 'cash' AND p1.amount > 0)
  UNION ALL SELECT 'DQC-13', 'Payments without bills',
    (SELECT COUNT(*) FROM payments p WHERE NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = p.bill_id))
  UNION ALL SELECT 'DQC-14', 'Bills without patients',
    (SELECT COUNT(*) FROM bills b WHERE NOT EXISTS (SELECT 1 FROM patients pt WHERE pt.id = b.patient_id))
  UNION ALL SELECT 'DQC-15', 'Bills without orders',
    (SELECT COUNT(*) FROM bills b WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = b.order_id))
  UNION ALL SELECT 'DQC-16', 'Order lines without order/test master',
    (SELECT COUNT(*) FROM order_tests ot WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = ot.order_id) OR NOT EXISTS (SELECT 1 FROM diagnostic_tests t WHERE t.id = ot.test_id))
  UNION ALL SELECT 'DQC-17', 'Bills with orphan ledger_id',
    (SELECT COUNT(*) FROM bills b WHERE b.ledger_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledgers l WHERE l.id = b.ledger_id))
  UNION ALL SELECT 'DQC-18', 'Bookings with orphan bill/patient link',
    (SELECT COUNT(*) FROM online_bookings ob WHERE (ob.bill_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = ob.bill_id)) OR (ob.patient_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patients pt WHERE pt.id = ob.patient_id)))
  UNION ALL SELECT 'DQC-19', 'payment_logs without booking (non-desk)',
    (SELECT COUNT(*) FROM payment_logs pl WHERE pl.booking_ref NOT LIKE 'BILL-%' AND NOT EXISTS (SELECT 1 FROM online_bookings ob WHERE ob.booking_ref = pl.booking_ref))
  UNION ALL SELECT 'DQC-20', 'Expenses with orphan voucher_id',
    (SELECT COUNT(*) FROM expenses e WHERE e.voucher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = e.voucher_id))
  UNION ALL SELECT 'DQC-21', 'Vouchers with orphan bill_id',
    (SELECT COUNT(*) FROM vouchers v WHERE v.bill_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = v.bill_id))
  UNION ALL SELECT 'DQC-22', 'Voucher account ids unresolvable',
    (SELECT COUNT(*) FROM vouchers v WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id::text = v.debit_account_id) OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id::text = v.credit_account_id))
  UNION ALL SELECT 'DQC-23', 'bill_audits for deleted bills',
    (SELECT COUNT(*) FROM bill_audits ba WHERE NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = ba.bill_id))
  UNION ALL SELECT 'DQC-24', 'voucher_audits for deleted vouchers',
    (SELECT COUNT(*) FROM voucher_audits va WHERE NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = va.voucher_id))
  UNION ALL SELECT 'DQC-25', 'refund_requests with orphan bill/payment',
    (SELECT COUNT(*) FROM refund_requests rr WHERE NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = rr.bill_id) OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = rr.payment_id))
  UNION ALL SELECT 'DQC-26', 'Banking/reconciliation link orphans',
    ((SELECT COUNT(*) FROM bank_transactions bt WHERE bt.payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = bt.payment_id))
     + (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.voucher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = bt.voucher_id))
     + (SELECT COUNT(*) FROM reconciliation_logs rl WHERE NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.id = rl.bank_transaction_id))
     + (SELECT COUNT(*) FROM reconciliation_logs rl WHERE rl.payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = rl.payment_id)))
  UNION ALL SELECT 'DQC-27', 'Bills with negative money fields',
    (SELECT COUNT(*) FROM bills WHERE subtotal < 0 OR discount < 0 OR tax_amount < 0 OR total_amount < 0 OR paid_amount < -0.01 OR balance_amount < 0 OR refund_amount < 0 OR original_total < 0)
  UNION ALL SELECT 'DQC-28', 'Zero payments / unlabelled negative payments',
    (SELECT COUNT(*) FROM payments WHERE amount = 0 OR (amount < 0 AND (notes IS NULL OR notes NOT LIKE 'REFUND%')))
  UNION ALL SELECT 'DQC-29', 'Non-positive expense/voucher amounts',
    ((SELECT COUNT(*) FROM expenses WHERE amount <= 0) + (SELECT COUNT(*) FROM vouchers WHERE amount <= 0))
  UNION ALL SELECT 'DQC-30', 'Discount exceeds subtotal',
    (SELECT COUNT(*) FROM bills WHERE discount > subtotal + 0.01)
  UNION ALL SELECT 'DQC-31', 'Bill total identity broken',
    (SELECT COUNT(*) FROM bills WHERE ABS(total_amount - (subtotal - discount + tax_amount)) > 0.01)
  UNION ALL SELECT 'DQC-32', 'Discount without reason',
    (SELECT COUNT(*) FROM bills WHERE discount > 0.01 AND (discount_reason IS NULL OR btrim(discount_reason) = ''))
  UNION ALL SELECT 'DQC-33', 'Nonzero unexplained tax amounts',
    (SELECT COUNT(*) FROM bills WHERE ABS(tax_amount) > 0.005)
  UNION ALL SELECT 'DQC-34', 'Refunds exceed lifetime collections',
    (SELECT COUNT(*) FROM bills b WHERE b.refund_amount > COALESCE((SELECT SUM(p.amount) FILTER (WHERE p.amount > 0) FROM payments p WHERE p.bill_id = b.id), 0) + 0.01)
  UNION ALL SELECT 'DQC-35', 'paid_amount out of sync with payments',
    (SELECT COUNT(*) FROM bills b WHERE ABS(b.paid_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.bill_id = b.id), 0)) > 0.01)
  UNION ALL SELECT 'DQC-36', 'refund_amount out of sync with negative payments',
    (SELECT COUNT(*) FROM bills b WHERE ABS(b.refund_amount - COALESCE((SELECT -SUM(p.amount) FILTER (WHERE p.amount < 0) FROM payments p WHERE p.bill_id = b.id), 0)) > 0.01)
  UNION ALL SELECT 'DQC-37', 'Balance identity broken',
    (SELECT COUNT(*) FROM bills WHERE status <> 'cancelled' AND ABS(balance_amount - GREATEST(0, total_amount - paid_amount - refund_amount)) > 0.01)
  UNION ALL SELECT 'DQC-38', 'Bill status incoherent with amounts',
    (SELECT COUNT(*) FROM bills WHERE (status = 'paid' AND balance_amount > 0.01) OR (status = 'pending' AND paid_amount > 0.01) OR (status = 'partial' AND (paid_amount <= 0.01 OR (balance_amount <= 0.01 AND total_amount > 0.01))) OR (status NOT IN ('pending', 'partial', 'paid', 'cancelled')))
  UNION ALL SELECT 'DQC-39', 'Cancelled bills with nonzero balance',
    (SELECT COUNT(*) FROM bills WHERE status = 'cancelled' AND ABS(balance_amount) > 0.01)
  UNION ALL SELECT 'DQC-40', 'Payments after cancellation',
    (SELECT COUNT(*) FROM payments p JOIN bills b ON b.id = p.bill_id WHERE b.status = 'cancelled' AND b.cancelled_at IS NOT NULL AND p.amount > 0 AND p.created_at > b.cancelled_at)
  UNION ALL SELECT 'DQC-41', 'Cancelled bills retaining money (review)',
    (SELECT COUNT(*) FROM bills WHERE status = 'cancelled' AND paid_amount > 0.01)
  UNION ALL SELECT 'DQC-42', 'Subtotal out of sync with active lines',
    (SELECT COUNT(*) FROM bills b WHERE b.status <> 'cancelled' AND ABS(b.subtotal - COALESCE((SELECT SUM(ot.price) FILTER (WHERE ot.status <> 'cancelled') FROM order_tests ot WHERE ot.order_id = b.order_id), 0)) > 0.01)
  UNION ALL SELECT 'DQC-43', 'Multiple active bills per order',
    (SELECT COUNT(*) FROM (SELECT 1 FROM bills WHERE status <> 'cancelled' GROUP BY order_id HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-44', 'Multiple bookings per bill',
    (SELECT COUNT(*) FROM (SELECT 1 FROM online_bookings WHERE bill_id IS NOT NULL GROUP BY bill_id HAVING COUNT(*) > 1) q)
  UNION ALL SELECT 'DQC-45', 'Booking/bill patient mismatch',
    (SELECT COUNT(*) FROM online_bookings ob JOIN bills b ON b.id = ob.bill_id WHERE ob.patient_id IS NOT NULL AND ob.patient_id <> b.patient_id)
  UNION ALL SELECT 'DQC-46', 'Success logs with unpaid bookings',
    (SELECT COUNT(*) FROM payment_logs pl JOIN online_bookings ob ON ob.booking_ref = pl.booking_ref WHERE pl.status = 'success' AND ob.status NOT IN ('paid', 'confirmed'))
  UNION ALL SELECT 'DQC-47', 'Confirmed bookings without bill',
    (SELECT COUNT(*) FROM online_bookings ob WHERE ob.status = 'confirmed' AND (ob.bill_id IS NULL OR NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = ob.bill_id)))
  UNION ALL SELECT 'DQC-48', 'Paid bookings with no gateway evidence',
    (SELECT COUNT(*) FROM online_bookings ob WHERE ob.status IN ('paid', 'confirmed') AND COALESCE(ob.razorpay_payment_id, '') = '' AND COALESCE(ob.payu_payment_id, '') = '' AND COALESCE(ob.payu_txn_id, '') = '' AND COALESCE(ob.phonepe_transaction_id, '') = '' AND COALESCE(ob.bharatpe_transaction_id, '') = '' AND COALESCE(ob.icici_transaction_id, '') = '' AND NOT EXISTS (SELECT 1 FROM payment_logs pl WHERE pl.booking_ref = ob.booking_ref AND pl.status = 'success'))
  UNION ALL SELECT 'DQC-49', 'Successful gateway txns unlinked to payments',
    (SELECT COUNT(*) FROM gateway_transactions gt WHERE gt.status = 'success' AND (gt.payment_id IS NULL OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = gt.payment_id)))
  UNION ALL SELECT 'DQC-50', 'Gateway txn amount <> linked payment',
    (SELECT COUNT(*) FROM gateway_transactions gt JOIN payments p ON p.id = gt.payment_id WHERE ABS(gt.amount - p.amount) > 0.01)
  UNION ALL SELECT 'DQC-51', 'Cash receipts after same-day close',
    (SELECT COUNT(*) FROM payments p JOIN (SELECT closure_date, MAX(covered_to_ts) AS last_close_ts FROM day_closures WHERE status = 'closed' GROUP BY closure_date) lc ON (p.created_at AT TIME ZONE 'Asia/Kolkata')::date = lc.closure_date AND p.created_at > lc.last_close_ts WHERE lower(p.method) = 'cash' AND p.amount > 0)
  UNION ALL SELECT 'DQC-52', 'Closure arithmetic inconsistencies',
    ((SELECT COUNT(*) FROM day_closures WHERE ABS(variance - (total_actual - total_expected)) > 0.01 OR ABS(total_expected - (expected_cash + expected_upi + expected_card + expected_cheque + expected_other)) > 0.01)
     + (SELECT COUNT(*) FROM user_day_closures WHERE ABS(variance - (total_actual - total_expected)) > 0.01 OR ABS(total_expected - (expected_cash + expected_upi + expected_card + expected_cheque + expected_other)) > 0.01))
  UNION ALL SELECT 'DQC-53', 'Closure window inverted/overlapping',
    ((SELECT COUNT(*) FROM day_closures WHERE covered_from_ts IS NOT NULL AND covered_from_ts >= covered_to_ts)
     + (SELECT COUNT(*) FROM day_closures a JOIN day_closures b ON b.id > a.id AND a.status = 'closed' AND b.status = 'closed' AND a.covered_from_ts IS NOT NULL AND b.covered_from_ts IS NOT NULL AND tstzrange(a.covered_from_ts, a.covered_to_ts, '(]') && tstzrange(b.covered_from_ts, b.covered_to_ts, '(]')))
  UNION ALL SELECT 'DQC-54', 'Expense hygiene (blank category/approver)',
    (SELECT COUNT(*) FROM expenses WHERE btrim(category) = '' OR btrim(description) = '' OR COALESCE(btrim(approved_by), '') = '')
  UNION ALL SELECT 'DQC-55', 'Expenses without vouchers',
    (SELECT COUNT(*) FROM expenses e WHERE NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.reference = e.expense_id))
  UNION ALL SELECT 'DQC-56', '"-edit" double-posted expense vouchers',
    (SELECT COUNT(*) FROM vouchers WHERE reference LIKE '%-edit')
  UNION ALL SELECT 'DQC-57', 'Receipt vouchers <> payments per bill',
    (SELECT COUNT(*) FROM (
      SELECT COALESCE(p.bill_id, v.bill_id) AS bid
      FROM (SELECT bill_id, COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS collected FROM payments GROUP BY bill_id) p
      FULL OUTER JOIN (SELECT bill_id, COALESCE(SUM(amount) FILTER (WHERE type = 'receipt'), 0) AS receipted FROM vouchers WHERE bill_id IS NOT NULL GROUP BY bill_id) v
        ON v.bill_id = p.bill_id
      WHERE ABS(COALESCE(p.collected, 0) - COALESCE(v.receipted, 0)) > 0.01) q)
  UNION ALL SELECT 'DQC-58', 'Vouchers with debit = credit account',
    (SELECT COUNT(*) FROM vouchers WHERE debit_account_id = credit_account_id)
  UNION ALL SELECT 'DQC-59', 'Unparseable text dates (vouchers/expenses)',
    ((SELECT COUNT(*) FROM vouchers WHERE "date" !~ '^\d{4}-\d{2}-\d{2}$')
     + (SELECT COUNT(*) FROM expenses WHERE expense_date !~ '^\d{4}-\d{2}-\d{2}$'))
  UNION ALL SELECT 'DQC-60', 'Stale voucher bill references',
    (SELECT COUNT(*) FROM vouchers v JOIN bills b ON b.id = v.bill_id WHERE v.reference IS NOT NULL AND v.reference <> '' AND v.reference <> b.bill_number)
  UNION ALL SELECT 'DQC-61', 'Audit hash-chain breaks',
    (SELECT COUNT(*) FROM (SELECT id, previous_hash, chain_hash, LAG(chain_hash) OVER (ORDER BY id) AS expected_prev FROM audit_logs) c WHERE c.chain_hash = '' OR (c.expected_prev IS NOT NULL AND c.previous_hash <> c.expected_prev))
) summary
ORDER BY check_id;

-- =============================================================================
-- END OF SCRIPT
-- =============================================================================
