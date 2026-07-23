# Financial stabilization plan (payments → vouchers → refunds → reconciliation)

Approved plan (stabilization brief, financial PR). Workstream **F1 is implemented in this PR**; F2–F4 follow as separate PRs. Governance: FINANCIAL_CHANGE_CONTROL.md workflow — the change-control questionnaire is in the PR description; every workstream ships alone, with regression + money-trail verification; **no financial record is ever deleted** (supersession/reversal only).

## Reverified baseline (against current code)

| Audit finding | Status |
| --- | --- |
| Day-close double-subtracts cash expenses | **Already fixed upstream** (`applyCashExpenses`, per-approver attribution, LOCKED BUSINESS RULE #4). F4 adds a regression lock only. |
| Same gateway payment can post twice | **Fixed in F1 (this PR).** Webhook keyed `reference_number` by provider `txnID`; callback/poll keyed by our merchant ref — two keys for one payment defeated the `(bill_id, reference_number)` unique index. |
| Prepaid booking/kiosk payments don't voucher at capture | Open → **F2**. |
| `sync-billing` backfill misposts | Open → **F2** (UTC-dated, first-Direct-Income classification, and its `PAY-<id>` dedupe key is disjoint from auto-voucher's `billNumber` reference — it re-vouchers desk payments). |
| Gateway refunds never execute | Open → **F3** (`refundPayment` in all 7 providers, zero call sites; banking approve dead-ends; paid-booking cancel keeps money). |
| Bank settlement matching has no data source | Open → **F4** (the new AI statement parser posts vouchers directly instead of feeding `bank_transactions` + the matching engine). |

## Canonical identifier model (F1 — implemented)

| Identifier | Meaning | Storage |
| --- | --- | --- |
| Provider transaction ID | Gateway's own id (ICICI `txnID`, Razorpay `payment_id`, PayU `mihpayid`, PhonePe `transactionId`, Cashfree `cf_payment_id`, BharatPe `txnId`, HDFC txn ref) — normalized as `gatewayTxnId` in `PaymentProvider.ts` | `payments.gateway_txn_id` (new) + partial unique `(bill_id, gateway_txn_id)` |
| Merchant reference | Ours: `BILLPAY-<billId>-XXXXXX` / booking ref (`merchantTxnNo`) | `payments.reference_number` — its ONLY meaning now; unique `(bill_id, reference_number)` |
| Booking / intent reference | `online_bookings.booking_ref` (= prepay merchant reference) | unchanged |
| Bill reference | `bills.id` + `bill_number` | unchanged |
| Refund reference | Ours: `REFUND-<originalPaymentId>` (F3); theirs: `refundTxnId` | negative payment row (F3) |
| Settlement status | `captured → settled (bank-matched only) → superseded / refund_pending / refunded / refund_failed`; NULL for legacy/cash | `payments.settlement_status` (new) |

**One idempotency strategy across webhook/callback/poll:** every settle path keys by **(bill_id, merchant reference)**; the provider txn id lives in `gateway_txn_id` with its own unique index as backstop. All three guards match either identifier in either column, so rows recorded before this change (webhook rows keyed by `txnID`) still dedupe. The bill `FOR UPDATE` row-lock serializes same-bill races.

**Historical duplicates:** `GET /api/accounting/duplicate-payment-suspects` (admin) lists suspect pairs (same bill, equal amount, ≤15 min apart, differing references, both online, non-superseded). `POST /api/accounting/payments/:id/supersede` (admin, mandatory reason) voids the duplicate **reversibly**: marks it `superseded` in favor of the survivor, restores the bill's paid/balance under the same invariant the settle paths use, posts a reversal voucher through the existing `autoVoucherForPayment` negative-amount path, and writes a `void` audit-chain entry. Nothing is deleted.

Known F1 limitation (accepted, matches existing voucher failure-tolerance): the reversal voucher posts after the supersession transaction commits; a voucher failure is logged but not rolled back — F2's payments-without-voucher sanity check will surface any such gap.

## F2 — Capture-time vouchers + backfill retirement (next)

Voucher at capture in `confirmBookingInternal`/self-registration via `autoVoucherForPayment` (IST-dated, method-correct account, real performer). Unify the voucher reference scheme to `PAY-<paymentId>` across auto-voucher and sync so their dedupe keys coincide (kills the desk-payment double-voucher). Demote `sync-billing` from Accounting-page auto-run to an admin-triggered dry-run → confirm flow. Reversal-voucher guidance for historical misposts (no deletion). Add books-sanity checks: payments-without-voucher, vouchers-without-payment.

## F3 — Refund execution loop

Cancelling a **paid** booking creates a `refund_request` (banking's approval flow = the single authorization gate). Approve → idempotent executor (`requested → approved → executing → executed/failed`, guarded transitions) → `PaymentEngine.refundPayment` against stored `gateway_txn_id` → negative payment row (`REFUND-<paymentId>`, `settlement_status` transitions), auto Payment Voucher (bills.ts refund pattern), `refund_requests.executed` + provider `refundTxnId`, patient WhatsApp/email notification via the existing delivery stack. Failures land in a visible retry queue.

## F4 — Reconciliation + regression

Bank-statement parser output redirected into `bank_transactions` + the existing matching engine (statement rows become reconciliation input, not direct vouchers); matches set `settlement_status='settled'`. Books-sanity page surfaces the new checks + duplicate suspects. Regression suite across the full matrix; day-close expense-rule lock-test.
