# Protected Accounting Files & Tables
## Care Diagnostics ERP Production Governance

This registry catalogs the source code, database resources, and API endpoints that are subject to the Financial Freeze Policy.

---

## 1. Protected Source Code Files

| File Name | Location | Primary Role | Sensitivity |
| :--- | :--- | :--- | :--- |
| [bills.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/bills.ts) | `routes/` | Registration billing, test cancel/refunds, test swapping, payment verification desk. | 🔴 CRITICAL |
| [gateway-webhooks.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/gateway-webhooks.ts) | `routes/` | ICICI / HDFC S2S callbacks, signature checking, transaction reconciliation. | 🔴 CRITICAL |
| [ReconciliationEngine.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/services/banking/ReconciliationEngine.ts) | `services/banking/` | Bank transaction mapping, matching confidence algorithms, auto-close triggers. | 🔴 CRITICAL |
| [public-booking.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/public-booking.ts) | `routes/` | Online booking payment collection and status updates. | 🟡 HIGH |
| [auto-voucher.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/auto-voucher.ts) | `lib/` | Generates double-entry vouchers for patient bills, refunds, and expense ledgers. | 🔴 CRITICAL |
| [books-sanity.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/books-sanity.ts) | `routes/` | Database consistency scanner and one-shot backfill tools. | 🟡 HIGH |
| [my-daily-summary.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/my-daily-summary.ts) | `routes/` | Computes gross digital, net collections, and cash drawer reconciliations. | 🟡 HIGH |

---

## 2. Protected Database Tables

| Table Name | Drizzle Schema reference | Primary Role | Protection Level |
| :--- | :--- | :--- | :--- |
| `bills` | `billsTable` | Billed amounts, subtotal, discount, paid, refund, balance. | 🔒 LOCK |
| `payments` | `paymentsTable` | Individual payment transactions, refund amounts, payment method, references. | 🔒 LOCK |
| `vouchers` | `vouchersTable` | Voucher sequences (RV, PV, JV, etc.) for ledger mappings. | 🔒 LOCK |
| `ledger_lines` | `ledgerLinesTable` | Single-entry debit/credit ledger transactions. | 🔒 LOCK |
| `accounts` | `accountsTable` | Chart of Accounts (Cash, Bank, Expenses, Revenue). | 🔒 LOCK |
| `expenses` | `expensesTable` | Clinic operational cost ledgers. | 🔒 LOCK |

---

## 3. Protected API Routes

*   `POST /api/bills` — Bill generation
*   `POST /api/bills/:id/payments` — Adding payments
*   `POST /api/bills/:id/refund` — Creating refunds
*   `POST /api/bills/:id/cancel-test` — Test cancellations
*   `POST /api/gateway/icici/callback` — Webhook ingestion
*   `POST /api/gateway/hdfc/callback` — Webhook ingestion
*   `POST /api/gateway/reconcile` — Manual/Admin reconciliation
*   `POST /api/banking/reconciliation` — Transaction auto-matching
