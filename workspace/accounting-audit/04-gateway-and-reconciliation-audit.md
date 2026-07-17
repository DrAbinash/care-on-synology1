# 04 — Payment Gateway, Webhook & Reconciliation Audit

> Trace of the online-payment path: `public-booking.ts`, `gateway-webhooks.ts`,
> `onlineBookings` schema, and the settlement/booking-confirmation logic. The
> guiding skeptical standard: *a successful callback is not safe unless
> authentication, signature verification, uniqueness, idempotency and
> transactional processing are ALL proven.*

---

## 1. What is implemented (and works)

- **Signature verification is now mandatory.** `verifyIcici` / `verifyHdfc`
  reject a webhook when the hash or the configured secret is missing
  (`gateway-webhooks.ts:59-79`, `:217`, `:352`) — a real fix over a prior
  skippable-verify state. This is a genuine strength.
- `settleBill` locks the bill row `FOR UPDATE` and re-reads inside a transaction,
  and checks for an existing payment with the same `(bill_id, reference_number)`
  before inserting (`gateway-webhooks.ts:98-119`). For **two concurrent webhooks
  for the same bill carrying the same reference**, this serialises correctly and
  the second is a no-op.

## 2. Confirmed / plausible weaknesses

- **SEC-04 (P1):** the **HDFC signature does not bind the amount**, and there is
  **no nonce/timestamp** (`gateway-webhooks.ts:76`). The `amount` is trusted from
  the request body. An attacker who can craft a body that satisfies the
  (amount-independent) signature — or who replays a captured callback — can
  settle a bill for an arbitrary or stale amount. Signature must cover
  `{order_id, amount, status, txn_id}` and a monotonic nonce.
- **SEC-05 (P1):** the settlement / booking-confirmation endpoints require only
  **authentication, not authorization** (`gateway-webhooks.ts:456`) — any
  logged-in staff member can settle bills and confirm bookings, not just a
  cashier/accountant role.
- **SEC-10 (P2):** webhooks return **HTTP 200 before processing** and *also* on
  signature rejection (`gateway-webhooks.ts:187`). Because the gateway sees 200,
  it never retries — so a genuine payment whose processing throws (or whose
  signature check has a transient config gap) is **silently dropped**. Reject
  with 4xx/5xx so the provider retries.
- **DQ-04 (P1):** there is **no global uniqueness** for gateway transaction
  identity. The only DB-level guard is per-bill (`onlineBookings.ts:19`); the
  cross-bill `payments.reference_number` has no unique index (see `02 §2.2`).
  The webhook path uses `txnID` as the reference while the manual reconcile path
  passes `bookingRef` as the gateway id — **different reference values for the
  same economic payment** — so the per-bill application check can miss and create
  a **duplicate payment row / double receipt** across paths.
- **RPT-10 (P2):** gateway payments are dated at **webhook processing time**; the
  gateway's own transaction timestamp is not stored (`gateway-webhooks.ts:122`).
  A payment initiated at 23:59 and processed at 00:01 lands on the wrong
  financial day and cannot be re-dated from stored data.

## 3. Payment-success ≠ bank-settlement

The system records payment *status* but **does not model settlement**. There is
no representation of:

```
initiated → pending → success → verified → settled(in bank) → reversed/refunded/chargeback
```

Missing fields everywhere: bank UTR / reference, settlement batch id, gross vs
gateway-fee vs GST-on-fee vs net-settled, settlement date, bank-credit date,
reconciliation status, mismatch reason. **The system confuses "callback said
success" with "money is in our bank account."** There is no three-way
reconciliation.

### Recommended three-way reconciliation model (design only — do not build during audit)

```
CARE ERP payment record   ⟷   gateway settlement report   ⟷   bank statement line
   (payments row)               (provider txn + fee)            (UTR credit)
        │                              │                              │
        └──────── match on provider_txn_id / UTR / amount / date ─────┘
                         → reconciliation_session with variance + reason
```

New (additive) tables: `gateway_settlements`, `bank_transactions`,
`reconciliation_sessions`, plus `payments.provider`, `payments.provider_txn_id`
(UNIQUE), `payments.bank_utr`, `payments.settled_at`. See
`11-remediation-roadmap.md` Phase 2.

## 4. Idempotency & duplicate-prevention checklist

| Control | Present? | Evidence |
|---|---|---|
| Signature verification | ✅ mandatory | gateway-webhooks.ts:59-79 |
| Amount bound into signature | ❌ (HDFC) | SEC-04 |
| Nonce / replay protection | ❌ | SEC-04 |
| Per-bill duplicate check | ✅ | gateway-webhooks.ts:98-119 |
| **Global** unique provider txn id (DB) | ❌ | DQ-04 |
| Retry-safe (4xx on failure) | ❌ (always 200) | SEC-10 |
| Raw payload retention | partial | see payment logs |
| Gateway timestamp stored | ❌ | RPT-10 |

## 5. Severity roll-up

| ID | Sev | One-line |
|---|---|---|
| SEC-04 | P1 | Webhook signature doesn't bind amount; replayable |
| SEC-05 | P1 | Settlement needs only authentication, not authorization |
| DQ-04 | P1 | No global unique gateway txn id → duplicate receipts across paths |
| SEC-10 | P2 | 200-before-processing → gateway never retries dropped payments |
| RPT-10 | P2 | Payment dated at processing time; gateway timestamp discarded |
| Signature verify mandatory | ✅ | Strength |
| settleBill row-lock + per-bill dedupe | ✅ | Strength (within a single path) |
