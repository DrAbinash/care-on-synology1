# Care Diagnostics ERP — Financial Formula & Logic Change Log

**Date:** 26 June 2026  
**Audit Type:** Forensic Financial Audit  
**Prepared by:** Antigravity AI (Engineering Session)  
**Status:** Production-ready — all changes TypeScript-verified and committed

---

## Table of Contents

1. [Refund: `total_amount` Must Not Be Mutated](#1-refund-total_amount-must-not-be-mutated)
2. [Balance Amount: Correct Semantics After Refund](#2-balance-amount-correct-semantics-after-refund)
3. [Expense: Auto-Generate Payment Voucher](#3-expense-auto-generate-payment-voucher)
4. [Digital Collection: Show Net, Not Gross](#4-digital-collection-show-net-not-gross)
5. [Gateway Settlement: Auto-Voucher on Online Payment](#5-gateway-settlement-auto-voucher-on-online-payment)
6. [Backfill: How to Fix Historical Data](#6-backfill-how-to-fix-historical-data)
7. [Summary of All Invariants](#7-summary-of-all-invariants)

---

## 1. Refund: `total_amount` Must Not Be Mutated

### What Was Wrong (Old Logic)

When a refund was processed, the old code **subtracted the refund from `total_amount`**:

```
total_amount = total_amount - refund_amount
```

This permanently destroyed the original invoice amount in the database.

#### Old Example

| Field | Before Refund | After Refund (OLD — WRONG) |
|-------|--------------|---------------------------|
| `total_amount` | ₹1,000 | ₹700 ← permanently changed |
| `paid_amount` | ₹1,000 | ₹700 |
| `refund_amount` | ₹0 | ₹300 |
| `balance_amount` | ₹0 | ₹0 |

**Problem:** If you look at this bill tomorrow, it appears the patient was billed ₹700 — not ₹1,000. Revenue reports understate the original billing. Tally export is wrong. Audits cannot trace the original invoice.

---

### What Is Correct (New Logic)

`total_amount` is **never changed after a bill is created**. It permanently stores the original billed amount. Refunds are tracked in `refund_amount` only.

```
total_amount  = UNCHANGED (original invoice amount, forever)
refund_amount = refund_amount + new_refund
paid_amount   = paid_amount - new_refund
```

#### New Example

| Field | Before Refund | After Refund (NEW — CORRECT) |
|-------|--------------|------------------------------|
| `total_amount` | ₹1,000 | ₹1,000 ← preserved |
| `paid_amount` | ₹1,000 | ₹700 |
| `refund_amount` | ₹0 | ₹300 |
| `balance_amount` | ₹0 | ₹0 (see Section 2) |

**Benefit:** Revenue reports, Tally exports, and audit trails all reflect the true original billing amount. ₹1,000 was billed, ₹300 was returned.

---

### Files Changed

| File | What Changed |
|------|-------------|
| `artifacts/api-server/src/routes/bills.ts` | Removed `totalAmount: String(newTotal)` from refund UPDATE |
| `artifacts/api-server/src/routes/bills.ts` | Same fix in cancel+autoRefund path |

---

## 2. Balance Amount: Correct Semantics After Refund

### The Core Invariant

```
balance_amount = MAX(0, total_amount − paid_amount − refund_amount)
```

This is the **true net money still owed by the patient.**

---

### What Was Wrong (After Fix 1 Applied Alone)

When we first preserved `total_amount`, the balance calculation still used:

```
balance_amount = total_amount - paid_amount     ← WRONG after refund
```

#### Broken Example

```
Bill: ₹1,000 billed, ₹1,000 paid, then ₹300 refunded

total_amount   = ₹1,000  ✅ (preserved)
paid_amount    = ₹700
refund_amount  = ₹300
balance_amount = 1,000 - 700 = ₹300  ← WRONG

Consequences:
  ✗ Bill appears in "Dues List" (balance > 0)
  ✗ Staff CAN collect ₹300 again → double-collection risk
  ✗ Daily-summary outstanding shows ₹300 phantom due
```

---

### What Is Correct (New Logic)

```
balance_amount = MAX(0, total_amount − paid_amount − refund_amount)
             = MAX(0, 1,000 − 700 − 300)
             = MAX(0, 0)
             = ₹0  ✅
```

#### Full Scenario Table

| Scenario | total | paid | refund | balance | Status |
|----------|-------|------|--------|---------|--------|
| Fresh bill, no payment | 1,000 | 0 | 0 | **1,000** | pending |
| Partial payment | 1,000 | 600 | 0 | **400** | partial |
| Full payment | 1,000 | 1,000 | 0 | **0** | paid |
| Full pay + full refund | 1,000 | 700 | 300 | **0** | paid |
| Full pay + partial refund | 1,000 | 850 | 150 | **0** | paid |
| Partial pay + partial refund | 1,000 | 500 | 200 | **300** | partial |
| Cancelled bill | 1,000 | 0 | 0 | **0** | cancelled |

#### Status Logic

```
netOwed = MAX(0, total_amount − refund_amount)

status = "paid"    when paid_amount >= netOwed
status = "partial" when 0 < paid_amount < netOwed
status = "pending" when paid_amount == 0
```

**Example:**
```
Bill ₹1,000, refund ₹300 → netOwed = ₹700
paid = ₹700 → status = "paid"     ✅
paid = ₹500 → status = "partial"  ✅
paid = ₹0   → status = "pending"  ✅
```

---

### Files Changed

| File | What Changed |
|------|-------------|
| `bills.ts` (refund route) | `newBalance = MAX(0, total − newPaid − newRefund)` |
| `bills.ts` (add-payment route) | `balance = total − newPaid − existingRefund` |
| `my-daily-summary.ts` | `remainingDues` = just `balance` (not `balance − refund`) |
| `my-daily-summary.ts` | `trueOutstanding` = just `balance` (simplified) |
| `daily-summary.ts` | Comment updated; `SUM(balance)` naturally correct |

---

## 3. Expense: Auto-Generate Payment Voucher

### What Was Wrong (Old Logic)

When a cash expense was recorded, **no accounting entry was created**:

```
POST /api/expenses  →  INSERT INTO expenses  →  done

Cash account: never touched
Voucher books: empty
```

---

### What Is Correct (New Logic)

Every expense now auto-generates a **Payment Voucher**:

```
POST /api/expenses
  → INSERT INTO expenses
  → autoVoucherForExpense()
      → DEBIT:  Expense Account (e.g., "Generator Fuel")  ₹2,000
      → CREDIT: Cash / Bank Account                       ₹2,000
      → INSERT INTO vouchers (type = "payment")
```

#### Example — Cash Expense

```
Expense: Generator fuel, ₹2,000, payment_mode = cash

Voucher created:
  Voucher No:    PMT-2026-0041
  Type:          Payment
  Date:          26-Jun-2026
  Narration:     Expense: Generator fuel

  Dr  Generator Fuel (Expenses)    ₹2,000
  Cr  Cash                         ₹2,000
```

#### Example — Digital Expense

```
Expense: Cloud hosting, ₹5,000, payment_mode = bank_transfer

Voucher created:
  Voucher No:    PMT-2026-0042
  Type:          Payment
  Narration:     Expense: Cloud hosting

  Dr  Cloud Hosting (Expenses)     ₹5,000
  Cr  Bank                         ₹5,000
```

---

### Files Changed

| File | What Changed |
|------|-------------|
| `lib/auto-voucher.ts` | Added `autoVoucherForExpense()` function |
| `routes/expenses.ts` | Calls `autoVoucherForExpense()` after CREATE and UPDATE |

---

## 4. Digital Collection: Show Net, Not Gross

### What Was Wrong (Old Display)

The KPI card showed **Gross Digital Collection** — total UPI/card received — without subtracting digital refunds:

```
Old KPI:  "Digital Collection:  ₹15,000"
          (included ₹1,500 that was refunded back via UPI)
```

---

### What Is Correct (New Display)

```
Net Digital Collection = Gross Digital Collected − Digital Refunds

Example:
  Digital received:    ₹15,000
  Digital refunded:    ₹1,500
  Net Digital:         ₹13,500  ← what is now shown in KPI
```

#### Full Cashbox Reconciliation

```
Cash In (gross)                   ₹20,000
  − Cash Refunded                  ₹2,000
  ─────────────────────────────────────
  = Net Cash Collected             ₹18,000
  − Cash Expenses                   ₹3,000
  ─────────────────────────────────────
  = Expected Physical Cash         ₹15,000  ← matches counter ✅

Digital In (gross)                ₹15,000
  − Digital Refunded               ₹1,500
  ─────────────────────────────────────
  = Net Digital Collection         ₹13,500  ← now shown correctly ✅
```

---

### Files Changed

| File | What Changed |
|------|-------------|
| `artifacts/diagnostic-erp/src/pages/MyDailySummary.tsx` | KPI card label → "Net Digital Collection", value → `s.netDigital` |

---

## 5. Gateway Settlement: Auto-Voucher on Online Payment

### What Was Wrong (Old Logic)

When a patient paid online, the ERP received payment confirmation but **created no accounting voucher**:

```
Old: Gateway callback → mark bill paid → done
     (money never reached the ledger)
```

---

### What Is Correct (New Logic)

Gateway webhooks (S2S) now settle the bill AND create an accounting voucher:

```
ICICI/HDFC webhook received:
  → Verify signature (HMAC-SHA256 / SHA256)
  → Check idempotency (already paid? skip)
  → Mark bill as paid
  → autoVoucherForPayment()
      Dr  Bank / Online Receipts   ₹amount
      Cr  Patient Receivables      ₹amount
  → Return HTTP 200 within 5 seconds
```

#### ICICI Webhook Signature Verification

```
Expected = HMAC-SHA256(requestBody, ICICI_SECRET_KEY)
Provided = X-ICICI-Signature header

If Expected !== Provided → reject with 401 (not a real ICICI call)
```

#### HDFC Webhook Signature Verification

```
Expected = SHA256(merchantId + "|" + orderId + "|" + status + "|" + HDFC_SECRET_KEY)
Provided = signature field in POST body

If Expected !== Provided → reject with 401
```

#### HDFC Payment Encryption (AES-128-CBC)

```
Key  = MD5(HDFC_WORKING_KEY)     → 16 bytes
IV   = MD5(HDFC_WORKING_KEY)     → same 16 bytes

Initiate:
  plainText  = "merchant_id=XXX&order_id=BILLPAY-1043&amount=500.00&..."
  encRequest = AES_128_CBC_Encrypt(plainText, key, iv)  → hex string

  Redirect → https://smartgateway.hdfcbank.com/...?encRequest=<hex>&access_code=<code>

Callback verify:
  encResp  → AES_128_CBC_Decrypt(encResp, key, iv) → plain params
  order_status = "Success" → settled ✅
```

---

### New API Endpoints Added

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/gateway/icici-webhook` | POST | ICICI S2S payment notification |
| `/api/gateway/hdfc-webhook` | POST | HDFC S2S payment notification |
| `/api/gateway/reconcile` | POST | Manual reconciliation (missed webhooks) |
| `/api/gateway/pending-online-bills` | GET | List pending online payment bills |

---

### Files Changed

| File | What Changed |
|------|-------------|
| `routes/gateway-webhooks.ts` | NEW file: all webhook + reconciliation logic |
| `lib/payments/HdfcPaymentProvider.ts` | REWRITTEN: Real CCAvenue AES-128-CBC implementation |
| `routes/index.ts` | Registered `/api/gateway` router |
| `lib/payments/PaymentEngine.ts` | Wired `HDFC_ACCESS_CODE` env var |

---

## 6. Backfill: How to Fix Historical Data

### Problem

Bills created before the fix may have `total_amount < original_total` (old code mutated them). One-time correction needed.

### Identifying Affected Bills

```sql
SELECT id, bill_number,
  total_amount::numeric   AS current_total,
  original_total::numeric AS original_total,
  refund_amount::numeric  AS refund,
  (original_total::numeric - total_amount::numeric) AS drift
FROM bills
WHERE refund_amount::numeric > 0
  AND ABS(total_amount::numeric - original_total::numeric) > 0.01;
```

### Backfill Formula

```sql
UPDATE bills
SET
  total_amount   = original_total,
  balance_amount = GREATEST(0,
                     original_total::numeric
                     - paid_amount::numeric
                     - refund_amount::numeric)
WHERE refund_amount::numeric > 0
  AND ABS(total_amount::numeric - original_total::numeric) > 0.01;
```

### Before / After Example

**Before backfill:**

| Bill | total | original | paid | refund | balance |
|------|-------|----------|------|--------|---------|
| B-001 | 700 | 1,000 | 700 | 300 | 0 |
| B-002 | 500 | 800 | 800 | 300 | 0 |

**After backfill:**

| Bill | total | original | paid | refund | balance |
|------|-------|----------|------|--------|---------|
| B-001 | **1,000** | 1,000 | 700 | 300 | **0** |
| B-002 | **800** | 800 | 800 | 300 | **0** |

### How to Run (No SSH Needed)

Login as **Super Admin** in the ERP browser, then:

```
# Dry run — shows what will change, no data touched
GET  /api/books-sanity/run-backfill

# Apply — only run if dry run shows affected bills
POST /api/books-sanity/run-backfill?confirm=true
```

Returns `{ affected: N, bills: [...] }`. If `N = 0` → nothing to fix.

---

## 7. Summary of All Invariants

### Bill Financial Invariants

```
1. total_amount   = subtotal − discount + tax_amount
                   Set at bill creation. NEVER changed again.

2. balance_amount = MAX(0, total_amount − paid_amount − refund_amount)

3. original_total = copy of total_amount at bill creation time
                   (reference for backfill and audit only)

4. status rules:
     "paid"      ←→  paid_amount >= (total_amount − refund_amount)
     "partial"   ←→  0 < paid_amount < (total_amount − refund_amount)
     "pending"   ←→  paid_amount == 0
     "cancelled" ←→  cancelled_at IS NOT NULL  (balance forced 0.00)
```

### Collection Formulas

```
Net Digital Collection  = Gross Digital Received − Digital Refunds  ✅ shown in KPI
Net Cash Collected      = Cash In − Cash Refunded
Expected Physical Cash  = Net Cash Collected − Cash Expenses
Total Outstanding Dues  = SUM(bills.balance_amount WHERE status IN ['pending','partial'])
                         (naturally correct — balance already subtracts refunds)
```

### Accounting Double-Entry

```
Bill created:
  Dr  Patient Receivables   total_amount
  Cr  Revenue               total_amount

Payment received:
  Dr  Cash / Bank           payment_amount
  Cr  Patient Receivables   payment_amount

Refund issued:
  Dr  Patient Receivables   refund_amount
  Cr  Cash / Bank           refund_amount
  NOTE: total_amount stays at original — the Dr/Cr pair is preserved for audit

Expense recorded:
  Dr  Expense Account       expense_amount
  Cr  Cash / Bank           expense_amount
  → Auto-voucher creates this automatically ✅

Online payment received:
  Dr  Bank / Online         amount
  Cr  Patient Receivables   amount
  → Gateway webhook creates this automatically ✅
```

---

## Environment Variables Required on Synology

Add these to `.env` in the Docker compose folder:

```env
# ICICI Orange Pay (already present)
ICICI_SECRET_KEY=d350487e-e1ec-452e-994e-bddb9fb96605

# HDFC SmartGateway (CCAvenue) — get from HDFC merchant portal
HDFC_MERCHANT_ID=<your merchant ID>
HDFC_ACCESS_CODE=<your CCAvenue access code>
HDFC_SECRET_KEY=<your 32-char CCAvenue working key>
HDFC_BASE_URL=https://smartgateway.hdfcbank.com
```

## Webhook URLs to Register in Gateway Portals

| Gateway | Method | URL |
|---------|--------|-----|
| ICICI Orange Pay | POST | `https://caredeoghar.com/api/gateway/icici-webhook` |
| HDFC SmartGateway | POST | `https://caredeoghar.com/api/gateway/hdfc-webhook` |

---

## Commits Reference

| Commit Hash | Description |
|-------------|-------------|
| `49abe60f` | ICICI/HDFC S2S webhooks + expense auto-voucher + refund total_amount fix |
| `e408314f` | Fix balance_amount = total − paid − refund (closes double-collection risk) |
| `e1119d7f` | Backfill API endpoint + net digital UI + HDFC real AES-128-CBC SDK |

---

*End of document. Care Diagnostics ERP — Financial Audit Session, 26 June 2026.*
