# 07 — Security, Permissions & Segregation-of-Duties Audit

**System:** CARE ERP (Care Diagnostics + Hope Neurotrauma & Multispeciality Hospital)
**Dimension auditor:** SEC
**Date:** 2026-07-16
**Repo:** `/home/user/care-on-synology1` (Express API at `artifacts/api-server`)
**Currency / TZ:** INR / Asia/Kolkata

---

## 1. Scope & method

This document audits the **authentication, authorization, segregation-of-duties (SoD),
audit-trail, secrets and webhook-forgeability** surface of the financial subsystem. It
covers brief sections 17–19: build the role → financial-capability matrix from the
*actual* middleware and permission data; find SoD failures; audit every financial
endpoint for missing auth, missing role checks, IDOR, mass assignment, client-trusted
totals, negative amounts, and hidden-field manipulation; audit webhook forgeability /
replay; inspect committed secrets; and map which financial mutations write audit logs
and which do not.

**Method.** Every finding below cites code I read in this run. Files read in full or in
the relevant range:

- `src/middleware/requireStaffAuth.ts` (232 ln), `requireSuperAdmin.ts` (92 ln)
- `src/routes/index.ts` (807 ln — the full mount table / auth wiring)
- `src/lib/audit.ts` (240 ln — the hash-chained immutable audit engine)
- `src/routes/bills.ts` (payments, cancel, refund, super-edit, delete, cancel-test,
  swap-test, change-doctor, gateway reconcile — ranges 374–2180)
- `src/routes/gateway-webhooks.ts` (signature verifiers + ICICI/HDFC handlers +
  reconcile, 58–460)
- `src/routes/expenses.ts`, `src/routes/accounting.ts` (voucher delete),
  `src/routes/ledgers.ts` (book reset / wipe), `src/routes/online-bookings.ts`
- `src/routes/orders.ts` (custom price path), `src/routes/public-booking.ts` (OTP)
- `lib/db/src/schema/users.ts` (bill_audits, super_admin_sessions)
- `.env.example`, `docker-compose.yml`, `lib/payments/PaymentEngine.ts`,
  `lib/payments/resolveActiveGateway.ts`, `lib/bootstrapAdmin.ts`

**Judgment standard applied.** A `requireStaffAuth` on a mount is not proof of
authorization — I checked for a *permission* gate too. A `bill_audits` insert is not
proof of a tamper-evident trail — I checked whether it is hash-chained and whether it can
be deleted. A "signature verified" webhook is not proof of integrity — I checked exactly
*which fields* the signature binds and whether the amount is among them.

---

## 2. How authorization actually works (verified model)

There is **no fixed role→capability table** in code. Authorization is a two-layer scheme
built entirely in `requireStaffAuth.ts`:

1. **Authentication** — `requireStaffAuth` (`requireStaffAuth.ts:53`) validates a
   `Authorization: Bearer <token>` staff-portal session against `portal_sessions`
   (scope `staff`, not expired), enforces an optional idle-timeout, re-loads the user to
   confirm `isActive`, and attaches `{ role, permissions[], maxDiscount }` to
   `req.staffSession` (`:147`). This is genuinely **server-side** — the client cannot
   assert its own role or permissions.

2. **Authorization** — three factories:
   - `requireStaffPermission(path)` (`:169`): `admin`/`super_admin` always pass
     (`FULL_ACCESS_ROLES`, `:26`); everyone else must carry the module string in their
     `permissions[]` (prefix match, `:182`).
   - `requireStaffSubPermission(module, action)` (`:192`): module or `module:action`.
   - `requireAdminRole` (`:221`): admin/super_admin only, **not** toggleable per user.

   Super-admin operations use a *separate* credential — `requireSuperAdmin`
   (`requireSuperAdmin.ts:15`), an `X-SA-Token` header validated against
   `super_admin_sessions`, optionally hardened by a USB-key gate
   (`isUsbGateEnforced()`), with a `remoteLoginEnabled` bypass for the owner.

Because `admin` and `super_admin` bypass every `requireStaffPermission` check, the
capability matrix below collapses to: **admin/super_admin can do everything; every other
role's financial power is exactly the set of permission strings an admin toggled on for
them in Settings → Users** (persisted as a JSON array in `users.permissions`,
`requireStaffAuth.ts:125`).

### 2.1 Financial capability → gate matrix (verified from `routes/index.ts`)

| Capability | Route(s) | Gate (mount) | Verified line |
|---|---|---|---|
| Create bill / edit / cancel / refund | `/bills*` | `requireStaffPermission("/billing")` | index.ts:299 |
| Record payment | `/payments` | `requireStaffPermission("/payments")` | index.ts:302 |
| Create order / set line-item price | `/orders` | `requireStaffPermission("/orders")` | index.ts:296 |
| Discounts CRUD + apply | `/discounts` | `requireStaffPermission("/discounts")` | index.ts:318 |
| Override rate / edit tariff | `/tests` (mutations) | `requireStaffPermission("/tests")` | index.ts:280 |
| Accept cash / confirm UPI (inline) | `/bills` (inline payments) | `/billing` | index.ts:299 |
| **Manually settle gateway payment** | `/gateway/reconcile` | **`requireStaffAuth` only — NO permission** | index.ts:234; gateway-webhooks.ts:456 |
| Confirm online booking (→ patient+bill+payment) | `/online-bookings/:id/confirm` | **`requireStaffAuth` only — NO permission** | index.ts:734; online-bookings.ts:196 |
| Expense entry / edit / **delete** | `/expenses` | `requireStaffPermission("/accounting")` | index.ts:348 |
| Voucher edit / **delete** | `/accounting/vouchers*` | `requireStaffPermission("/accounting")` | index.ts:315; accounting.ts:329 |
| Ledger (book) wipe / delete | `/ledgers/:id/reset`, DELETE | `/accounting` **+ super-admin body token** | index.ts:357; ledgers.ts:280 |
| Super-edit bill totals | `/bills/:id/super-edit` | `/billing` **+ super-admin body token** | bills.ts:1364 |
| Delete bill + renumber sequence | `DELETE /bills/:id` | `/billing` **+ super-admin body token** | bills.ts:1451 |
| Day-close / reopen | `/day-close` | `requireStaffAuth` (admin routes gated inline) | index.ts:360 |
| Change payment-gateway settings | `/clinic-settings` (PUT) | `requireStaffSubPermission("/settings","clinic")` | index.ts:448 |
| Audit-trail viewer | `/audit-trail` | `requireStaffSubPermission("/settings","security")` | index.ts:479 |

The **SoD problem is structural**: `/accounting` is a *single* permission that authorizes
expense create **and** approve **and** delete, and voucher edit **and** delete. `/billing`
authorizes create **and** cancel **and** refund. There is no separate "approver",
"refund-authorizer" or "delete" sub-permission for the money modules, so one granted role
performs the entire create→approve→reverse→destroy lifecycle unaided (see SEC-02, SEC-03).

---

## 3. The two audit systems, and which mutations are actually covered

CARE has a genuinely strong **hash-chained immutable audit engine** in `lib/audit.ts`:
`auditLog()` (`audit.ts:75`) takes a transaction-scoped advisory lock
(`pg_advisory_xact_lock`, `:99`), reads the last row's `chainHash`, and inserts a new row
whose `chainHash = sha256(canonical(payload ‖ previousHash))` (`:110–144`). No route
updates or deletes `audit_logs` (grep across `routes/` finds only inserts, in
`patient-reports.ts`). `verifyAuditChain()` (`:223`) can detect any fork/gap. This is
exactly what a forensic trail should look like.

**The problem: the core billing money-mutations do not use it.** A grep for
`auditFromRequest(` in `bills.ts` finds exactly **one** call — the swap-test handler at
`bills.ts:2168`. Every other financial mutation writes only to `bill_audits`
(`billAuditsTable`), which is a **plain, mutable, un-chained** table:

```
// lib/db/src/schema/users.ts:57
export const billAuditsTable = pgTable("bill_audits", {
  id, billId, editedBy (text), reason (text), changeType (text),
  oldValue (text), newValue (text), createdAt
});   // no chainHash, no ipAddress, no userAgent, no userId
```

So bill **cancel** (`bills.ts:989`), **refund** (`:1225`), **super-edit** (`:1445`),
**delete** (`:1485`), **cancel-test** (`:1687`), **change-doctor** (`:1340`) and expense
**create/delete** and voucher **delete** produce either a deletable `bill_audits`/
`voucher_audits` row or **no audit row at all** — none of them enter the tamper-evident
chain. Modules that *do* call `auditLog`/`auditFromRequest`: accounting, users, portal,
patient-reports, banking, backupReplication, presentation-templates, radiology-*. The
money core is the notable omission (SEC-01).

---

## 4. Webhook forgeability & replay (verified)

`gateway-webhooks.ts` was clearly hardened once: both `verifyIciciWebhookSignature`
(`:59`) and `verifyHdfcWebhookSignature` (`:71`) now return `false` when the signature
**or** the secret is missing — closing the old "omit the field to skip verification" bug
(`:49–56`). Signature verification is now mandatory and rejects before any DB write
(`:217`, `:352`). That is good.

But the **HDFC signature does not bind the amount** and has no nonce/timestamp:

```
// gateway-webhooks.ts:76
const signatureInput = `${merchantId}|${orderId}|${status}|${secretKey}`;
```

The amount is then read straight from the body and posted verbatim
(`:338 rawAmount = body.amount`, `:377 amount = parseFloat(rawAmount)`, →`settleBill`).
This makes a captured-and-replayed HDFC callback tamperable in amount and repeatable
(SEC-04). ICICI, by contrast, hashes *all* body fields including amount (`:62–66`), so
ICICI amount is bound — a good contrast the report notes.

Both handlers **ACK HTTP 200 before processing** (`:187`, `:332`) and also fall through
to the already-sent 200 on signature rejection (`:222`, `:357`), so the gateway never
receives a retry signal — a transient DB failure silently drops a genuine payment
(SEC-10).

---

## 5. Secrets & bootstrap (verified — mostly a strength)

- `.env.example` ships **placeholders**, not live secrets: `DB_PASSWORD=change…`,
  `JWT_SECRET=change…`, `SESSION_SECRET=change…`, and commented-out
  `SUPER_ADMIN_USB_KEY` / `INTERNAL_API_KEY`. No real secret value is committed.
- `docker-compose.yml` injects every secret via `${VAR}` interpolation
  (`ICICI_SECRET_KEY: ${ICICI_SECRET_KEY}`, `JWT_SECRET: ${JWT_SECRET}`, etc.) — no
  hard-coded value.
- Provider secrets fall back to **empty string**, never a baked-in default
  (`PaymentEngine.ts:42,49,56,62`; `resolveActiveGateway.ts:25–29`), and the webhook
  verifiers reject when the secret is empty — so a mis-deployed instance fails closed.
- One operational hazard remains documented in code: `BOOTSTRAP_ADMIN_FORCE=true` resets
  the admin PIN to default on every restart; `bootstrapAdmin.ts:16` at least now honours
  the env flag (its comment records that it used to be hard-coded `true`). See SEC note in
  §7 strengths / potential risk.

No card-PAN logging was observed; `logWebhookPayload` (`gateway-webhooks.ts:161`) stores
the gateway JSON (txn metadata) to `payment_logs`, which is acceptable but is raw and
unbounded (minor).

---

## 6. Findings

### [SEC-01] P0 — Core billing money-mutations bypass the tamper-evident audit chain and write only to a mutable, deletable `bill_audits` table
- Severity: P0
- Classification: Missing control
- Location: `artifacts/api-server/src/routes/bills.ts` — cancel `:989`, refund `:1225`,
  super-edit `:1445`, delete `:1485`, cancel-test `:1687`, change-doctor `:1340`; schema
  `lib/db/src/schema/users.ts:57`; contrast engine `artifacts/api-server/src/lib/audit.ts:75`
- Current behavior: `bills.ts` imports `auditFromRequest` but calls it exactly once (swap-test, `:2168`). Every other bill mutation records history only via `db.insert(billAuditsTable)`. `bill_audits` has **no `chainHash`, no `ipAddress`, no `userAgent`, no `userId`** and is a normal table with a `DELETE` path (see SEC-08). The hash-chained `audit_logs` engine, which *does* have advisory-lock serialization and per-row chaining (`audit.ts:98–144`) and which no route can update/delete, is not used for these events.
- Why unsafe: The most sensitive financial actions in the system — voiding a bill, refunding money, editing totals, deleting a bill — leave a trail that can be silently altered or removed at the database level (and is removed wholesale by the ledger-reset route, SEC-08). There is no cryptographic guarantee that the recorded history matches what happened, so the "immutable audit" marketing in the governance docs does not hold for the billing core.
- Failure scenario: A biller with `/billing` refunds ₹8,000 from a paid bill (`bills.ts:1225` writes a `bill_audits` row). Someone with DB access — or the ledger-reset route (SEC-08) — deletes that `bill_audits` row. `verifyAuditChain()` still reports the global chain intact because the refund was never in the chain. The refund is now invisible to any tamper-evidence check.
- Recommended correction: Route every financial mutation (cancel, refund, super-edit, delete, cancel-test, change-doctor, expense create/edit/delete, voucher edit/delete, ledger reset) through `auditLog()`/`auditFromRequest` **inside the same transaction**, capturing `userId`, `oldValue`, `newValue`, `reason`, `ipAddress`, `userAgent`. Keep `bill_audits` as a UI convenience view but treat `audit_logs` as the system of record.
- Backward compatible: Yes — additive audit writes; no behavior change to the money math.
- Data migration required: No (new rows only); optionally backfill is not possible for historical events.

### [SEC-02] P1 — Vouchers (double-entry ledger records) can be hard-deleted with no audit row, no reason, under the same `/accounting` permission that creates them
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/accounting.ts:329` (`router.delete("/vouchers/:id")`); mount `routes/index.ts:315`
- Current behavior:
  ```
  router.delete("/vouchers/:id", async (req, res) => {
    const id = parseId(req.params.id, res);
    if (id === null) return;
    await db.delete(vouchersTable).where(eq(vouchersTable.id, id));   // hard delete
    res.json({ ok: true });
  });
  ```
  No `voucher_audits` insert (the *edit* path at `:320` does write audits, the delete path does not), no reason required, no super-admin token, no `auditLog`. Any user holding `/accounting` can call it.
- Why unsafe: A voucher **is** the accounting ledger entry that drives the Trial Balance. Silently deleting it removes a posting from the books with zero trace — the definitional embezzlement/whitewash primitive. It also breaks SoD: the identical `/accounting` permission both creates and destroys ledger entries.
- Failure scenario: An accounts clerk with `/accounting` books a fake ₹50,000 payment voucher (auto-voucher or manual), later realizes it will surface in a CA review, and issues `DELETE /api/accounting/vouchers/842`. The voucher vanishes from the ledger; the Trial Balance rebalances; no audit row records who deleted it or why.
- Recommended correction: Remove the hard-delete; replace with a reversing entry (a contra-voucher) that keeps both postings. If deletion is unavoidable, require a super-admin token + mandatory reason + an `auditLog()` write in the same transaction, and never physically remove the row (soft-delete with `voidedBy`/`voidedReason`).
- Backward compatible: No — callers expecting hard delete change semantics; but this is the correct accounting behavior.
- Data migration required: No (add `voided_at`/`voided_by` columns if soft-delete is adopted).

### [SEC-03] P1 — Expenses: create, self-approve, and hard-delete all live under one `/accounting` permission; delete writes no audit and `approvedBy` is a free-text body field
- Severity: P1
- Classification: Missing control
- Location: `artifacts/api-server/src/routes/expenses.ts` — create `:92` (`approvedBy` from body `:96/:109`), delete `:211`; mount `routes/index.ts:348`
- Current behavior: `POST /expenses` accepts `approvedBy` straight from the request body (`const { … approvedBy … } = parsed.data; … approvedBy: approvedBy ?? null`) — the creator names the approver. `DELETE /expenses/:id` (`:211`) hard-deletes with **no audit row of any kind** and no reason:
  ```
  const [expense] = await db.delete(expensesTable).where(eq(expensesTable.id, id)).returning();
  ```
- Why unsafe: A single granted role performs the full expense lifecycle — record it, mark it approved (by anyone, including a fabricated name), and later erase it without trace. There is no maker-checker separation and no destruction audit, which is the classic petty-cash / expense-fraud gap a forensic review looks for.
- Failure scenario: A staffer with `/accounting` posts a ₹12,000 "vendor payment" expense with `approvedBy: "Dr. Abinash"` (never actually approved), the cash leaves the drawer, and after day-close reconciliation they `DELETE /api/expenses/…` to remove the record. No audit, no chain, nothing to reconstruct.
- Recommended correction: Split into distinct sub-permissions (`/accounting:expense.create`, `:expense.approve`, `:expense.delete`); derive `approvedBy` from an authenticated approver's session in a separate approval action, not the creation body; forbid hard delete (soft-delete + `auditLog()`); require a reason.
- Backward compatible: No — introduces an approval step and removes hard delete.
- Data migration required: No (add `void`/approval-status columns if soft-delete/maker-checker adopted).

### [SEC-04] P1 — HDFC webhook signature does not bind the amount and has no nonce/timestamp; the amount is trusted from the body and is replayable/tamperable
- Severity: P1
- Classification: Architectural weakness
- Location: `artifacts/api-server/src/routes/gateway-webhooks.ts` — signer `:76`, amount source `:338/:377`, settle `:390` / `settleBill:122`
- Current behavior: `signatureInput = `${merchantId}|${orderId}|${status}|${secretKey}`` (`:76`). The amount is read separately (`rawAmount = body.amount`, `:338`) and posted verbatim into `payments` via `settleBill`. The signature therefore validates order+status only; it is identical for every replay of a given order/status (no nonce), and it says nothing about the amount. Idempotency is keyed on `referenceNumber = txnId` (`settleBill:114`), and `txnId` comes from the attacker-controllable body (`:336`).
- Why unsafe: Anyone able to observe one genuine HDFC callback (proxy, log, network path) can resend it with a **larger `amount`** and a **fresh `txnId`** — it still passes signature verification (those fields are unchanged) and dodges the `referenceNumber` idempotency guard, crediting an inflated or duplicate payment. Even without the secret, the integrity of the settled amount is not cryptographically protected.
- Failure scenario: A ₹500 HDFC booking payment webhook is captured. The attacker replays it to `/api/gateway/hdfc-webhook` with `amount: 50000` and `txnId: "X999"`. Signature (`merchantId|orderId|SUCCESS|secret`) matches; idempotency check (billId+"X999") finds nothing; `settleBill` records a ₹50,000 payment and marks the bill paid.
- Recommended correction: Require HDFC (and any provider) to include the amount and a nonce/timestamp in the signed string, and verify amount-in-signature == amount-in-body == expected order amount before settling; reject stale timestamps; key idempotency on the gateway's own immutable transaction id, and additionally on `(billId, orderId)` so a new `txnId` cannot double-settle the same order.
- Backward compatible: No — requires the HDFC integration to sign amount+nonce (coordination with the provider/merchant config).
- Data migration required: No.

### [SEC-05] P1 — Financial settlement endpoints require only authentication, not authorization: any logged-in staff (zero module permissions) can settle bills and confirm bookings into patient+bill+payment
- Severity: P1
- Classification: Missing control
- Location: `artifacts/api-server/src/routes/index.ts:234` (`/gateway` mounted with no gate), `:734` (`/online-bookings` mounted `requireStaffAuth` only); `gateway-webhooks.ts:456` (`/reconcile`, `requireStaffAuth` only), `:582` (`/pending-online-bills`); `online-bookings.ts:196` (`/:id/confirm`), `:86` (`/:id/cancel`)
- Current behavior: `router.use("/online-bookings", requireStaffAuth, onlineBookingsRouter)` — no `requireStaffPermission`. `gatewayWebhookRouter.post("/reconcile", requireStaffAuth, …)` — no permission. `reconcile` calls the gateway status API and, if paid, runs `settleBill`, writing a `payments` row and flipping the bill to `paid`. `confirmBookingInternal` (`online-bookings.ts:103`) creates a patient, a bill, and a payment.
- Why unsafe: A user provisioned with an empty `permissions[]` (e.g. a radiology-only or reception-only account, deliberately denied `/billing` and `/payments`) can still create financial records and mark bills paid, entirely outside the billing permission fence. This defeats the point of the module-permission system for money movement, and the confirm/cancel routes also write no audit.
- Failure scenario: A reception account with no `/billing` or `/payments` permission calls `POST /api/gateway/reconcile {type:"bill", id:123}` (or `POST /api/online-bookings/45/confirm`). If the gateway/booking says paid, a ₹3,000 payment is recorded and bill 123 flips to `paid` — by a user who cannot open the Billing module in the UI.
- Recommended correction: Gate `/gateway/reconcile`, `/gateway/pending-online-bills`, `/online-bookings/:id/confirm` and `/:id/cancel` with `requireStaffPermission("/payments")` (or `/billing`), and audit each settlement/confirmation via `auditLog()`.
- Backward compatible: Yes for admins; non-admins lose access they arguably never should have had (may need permission grants for legitimate staff).
- Data migration required: No.

### [SEC-06] P1 — Public OTP endpoint returns the OTP code in its HTTP response, nullifying the OTP as an authentication factor
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/public-booking.ts:1581` (`/send-otp`), returns at `:1589`
- Current behavior:
  ```
  const code = generateOtp();
  otpStore.set(phone, { code, name: name || "", expiresAt: Date.now() + 5*60*1000 });
  res.json({ sent: true, phone, code });   // <-- OTP returned to the caller
  ```
  `/verify-otp` (`:1592`) then compares the submitted code against the stored one.
- Why unsafe: Any caller (the booking flow is public and unauthenticated by design, `index.ts:229`) can request an OTP for **any** 10-digit phone number and read the code directly from the response, then immediately pass `/verify-otp`. The OTP provides zero proof of phone ownership — the "mobile login" gate is effectively open, letting anyone assume any phone identity for the booking/mobile flow.
- Failure scenario: An attacker POSTs `/api/public/booking/send-otp {phone:"9876543210"}`, reads `code` from the JSON, POSTs `/verify-otp {phone:"9876543210", code}`, and is now "verified" as that number — able to view/act on that customer's booking context without ever controlling the phone.
- Recommended correction: Never return the code; deliver it only out-of-band (SMS/WhatsApp). Rate-limit per phone and per IP, cap attempts, and hash the stored code. If a dev/test bypass is needed, gate it behind `NODE_ENV !== "production"`.
- Backward compatible: No — front-end must stop reading `code` from the response and rely on real SMS delivery.
- Data migration required: No.

### [SEC-07] P2 — Actor identity for financial mutations is taken from the request body (`performedBy` / `editedBy` / `approvedBy`), so audit attribution is spoofable
- Severity: P2
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/bills.ts` — cancel-test `:1624` (`performedBy` from body), swap-test `:1978/:1990`, change-doctor `:1311/:1318`; `expenses.ts:96` (`approvedBy`); (cancel `:964` and refund `:1154` correctly *prefer* the session name but still fall back to `bodyParsed.data.performedBy`)
- Current behavior: e.g. cancel-test: `const { orderTestId, performedBy, reason } = req.body …; const actor = String(performedBy).trim();` — the audit row's `editedBy`/`performedBy` is whatever string the caller sends. change-doctor moves referral-commission attribution to a new doctor using a body-supplied `performedBy` with no commission sub-permission.
- Why unsafe: The person shown in the audit trail as having cancelled a test, swapped a test, or moved a doctor's commission is chosen by the caller, not derived from the authenticated session. Combined with SEC-01 (these rows are not in the tamper-evident chain and carry no `userId`/IP), attribution is unreliable — a user can pin their action on a colleague.
- Failure scenario: Biller A cancels a ₹2,000 test line and sends `performedBy:"Biller B"`. The `bill_audits` row credits Biller B. There is no `userId`, IP, or chain to contradict it.
- Recommended correction: Always derive the actor from `req.staffSession` (subjectId + subjectName) and ignore any body-supplied actor; record `userId` and IP; feed into `auditLog()` (SEC-01). Add a `commission`/`change-doctor` sub-permission.
- Backward compatible: Yes — server ignores a field it used to trust; response shape unchanged.
- Data migration required: No.

### [SEC-08] P2 — Ledger "reset" and delete routes hard-delete payments, bills, orders, patients **and the `bill_audits` trail itself**, with no entry in the immutable chain
- Severity: P2
- Classification: Architectural weakness
- Location: `artifacts/api-server/src/routes/ledgers.ts` — reset `:280`, deletes `payments`/`bill_audits`/`bills` `:357–359`, orders `:362–363`, patients `:373`; DELETE `/:id` `:192`
- Current behavior: `POST /ledgers/:id/reset` (super-admin token + reason + an orphan-guard that blocks wiping patients with paid/partial bills, `:333–353`) then executes `db.delete(billAuditsTable)…` alongside `db.delete(paymentsTable)` and `db.delete(billsTable)`. There is **no `auditLog()`** recording the wipe in the tamper-evident chain — the only record is the response body and any external log.
- Why unsafe: A single privileged action erases financial rows *and* their per-bill audit history in one transaction, and the deletion of the audit trail is itself unaudited in the immutable chain. Even with the orphan guard, empty/cancelled bills and their audit rows are destroyed; and the guard is application-level only. This is a bulk-destruction primitive whose own execution leaves no cryptographic record.
- Failure scenario: A super-admin session (or a stolen `X-SA-Token` where the USB gate is off) calls `POST /api/ledgers/2/reset`. All bills, payments, and `bill_audits` for book 2 are deleted. `verifyAuditChain()` reports the global chain intact because nothing about the wipe entered it.
- Recommended correction: Write an `auditLog()` entry (counts, ledger id, reason, actor, IP) **before** the deletes and inside the same transaction; never delete `bill_audits` (retain it, or export it first); prefer archival/soft-delete over physical deletion of financial rows.
- Backward compatible: Yes — additive audit + retention.
- Data migration required: No.

### [SEC-09] P2 — Super-admin bill operations authenticate via a token carried in the request body, bypassing the `requireSuperAdmin` middleware's USB/remote-login enforcement path
- Severity: P2
- Classification: Architectural weakness
- Location: `artifacts/api-server/src/routes/bills.ts` — `verifySuperAdminToken` `:1353`, used by super-edit `:1381` and delete `:1470`; contrast `middleware/requireSuperAdmin.ts:15`
- Current behavior: These routes are mounted only behind `/billing` (`index.ts:299`) and then verify a super-admin session by reading `req.body.token` and looking it up ad-hoc (`verifySuperAdminToken` checks `isActive`+`expiresAt` only). USB enforcement is applied via a *separate* `rejectIfUsbMissing` header check (`bills.ts:21`), but the token itself travels in the body, not the `X-SA-Token` header the canonical `requireSuperAdmin` middleware expects.
- Why unsafe: Two divergent super-admin auth implementations increase the chance of drift (e.g. `verifySuperAdminToken` does not re-check that the user's role is still `super_admin` or `isActive` the way `requireSuperAdmin.ts:81–88` does — it trusts the session row alone). Secrets in request *bodies* are also more likely to be captured by body-logging middleware/APM than header-scoped tokens.
- Failure scenario: A super-admin user is demoted (role changed / deactivated) but their `super_admin_sessions` row is still `isActive` and unexpired. `verifySuperAdminToken` (bills.ts) still returns `valid:true` and lets them super-edit or delete a bill, whereas `requireSuperAdmin.ts` would have rejected them at the role/isActive re-check.
- Recommended correction: Route these through the shared `requireSuperAdmin` middleware (header token + role/isActive re-check + USB gate), or make `verifySuperAdminToken` re-load the user and enforce `isActive && role===super_admin`. Move the token out of the body into `X-SA-Token`.
- Backward compatible: No — clients must send the header instead of a body field.
- Data migration required: No.

### [SEC-10] P2 — Webhooks acknowledge HTTP 200 before processing and also 200 on signature rejection, so the gateway gets no retry signal and genuine payments can be silently dropped
- Severity: P2
- Classification: Architectural weakness
- Location: `artifacts/api-server/src/routes/gateway-webhooks.ts` — early ACK `:187` (ICICI), `:332` (HDFC); reject-then-return-after-200 `:217–223`, `:352–358`
- Current behavior: `res.status(200).json({ status: "received" })` is sent first thing (`:187/:332`); all processing (signature check, settle) happens afterwards with the response already committed. On signature failure the handler logs and `return`s — the client already has a 200.
- Why unsafe: If processing throws (DB down, deadlock, bug) after the 200, the gateway believes delivery succeeded and never retries — a real captured payment is lost with only a log line. And a legitimately-signed callback that transiently fails to settle is indistinguishable, to the gateway, from success.
- Failure scenario: ICICI posts a valid ₹4,000 settlement; `settleBill` throws on a lock timeout; the gateway saw 200 and does not retry; the bill stays unpaid and only a warning log exists. Staff must catch it via the heuristic `/reconcile` path (which itself lacks a permission gate, SEC-05).
- Recommended correction: Process first, then ACK; return non-2xx on transient processing failure so the gateway retries; return an explicit 4xx on signature rejection (per provider contract) so bad senders are visibly refused; persist an inbound-webhook record in a transaction before ACK for durable replay.
- Backward compatible: Yes (subject to each gateway's ACK-timeout window — measure before deploying).
- Data migration required: No (optional inbound-webhook table).

### [SEC-11] P2 — Client-trusted prices and un-validated inline payments (mass assignment) at the order/bill boundary
- Severity: P2
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/orders.ts:216` (custom-test price stored verbatim); `artifacts/api-server/src/routes/bills.ts:382` (inline `payments` array read raw from `req.body`), `:583` (paid/balance computed from it)
- Current behavior: Orders custom-test path: `lineItems = customTests!.map(ct => ({ testId: ct.testId, price: String(ct.price) }))` — the client's price string is persisted with no comparison to the catalog tariff. Bill creation: `inlinePayments = Array.isArray(payload.payments) ? payload.payments : []` bypasses the `CreateBillBody` zod schema entirely; each payment is accepted on `amount > 0 && method !== "online"` with a **free-text `method`** and no per-method validation.
- Why unsafe: The billed subtotal and the recorded tender are taken from client-controlled fields. A modified client (or a direct API call) can bill an arbitrary price for a test and attach payments with arbitrary free-text methods, defeating catalog pricing and payment-method controls. (Full pricing analysis is in the billing-dimension doc; flagged here as the SoD/mass-assignment surface.)
- Failure scenario: A caller POSTs `/api/orders` with a custom test priced at ₹10 (catalog ₹1,000), then `/api/bills` with an inline `{amount:10, method:"cash"}`; the bill totals ₹10 and shows paid, pocketing the ₹990 difference off-book.
- Recommended correction: Recompute every line price from the catalog server-side (allow explicit, permissioned overrides that are audited); validate the inline `payments` array with the same zod schema and method enum used by `POST /payments`.
- Backward compatible: No for the custom-price path (unless override is permissioned); yes for payment validation tightening.
- Data migration required: No.

### [SEC-12] P3 — `bill_audits` / `voucher_audits` rows lack `userId`, IP, user-agent and a chain hash, so financial-history rows cannot be bound to an authenticated principal or checked for tampering
- Severity: P3
- Classification: Missing control
- Location: schema `lib/db/src/schema/users.ts:57` (`bill_audits`); `lib/db/src/schema/accounting.ts:72` (`voucher_audits`)
- Current behavior: `bill_audits` columns are `id, billId, editedBy (text), reason, changeType, oldValue, newValue, createdAt` — no `userId`, `ipAddress`, `userAgent`, or `chainHash`. `editedBy` is a free-text string supplied by the mutation (SEC-07).
- Why unsafe: Even where an audit row *is* written, it carries no verifiable link to a session/user, no source IP, and no tamper-evidence. Two independent weaknesses (spoofable actor + deletable/un-chained storage) compound: the audit rows are neither trustworthy in attribution nor durable.
- Failure scenario: Investigating a disputed ₹5,000 refund, the auditor finds a `bill_audits` row `editedBy:"Reception"` — but cannot determine which user, from which device/IP, and cannot prove the row was not edited after the fact.
- Recommended correction: Add `userId`, `ipAddress`, `userAgent` columns; populate from `req.staffSession` + request; and (per SEC-01) mirror every financial mutation into the hash-chained `audit_logs`.
- Backward compatible: Yes — additive columns.
- Data migration required: Yes — add nullable columns (`user_id`, `ip_address`, `user_agent`) to `bill_audits`/`voucher_audits`; historical rows stay null.

---

## 7. What is done well (strengths for the executive summary)

- **Server-side authorization.** `requireStaffAuth` re-loads the user on every request,
  enforces `isActive`, parses permissions server-side, and enforces an optional idle
  timeout (`requireStaffAuth.ts:53–157`). The client cannot assert its own role.
- **A real tamper-evident audit engine exists.** `audit.ts` implements a SHA-256
  hash-chain with `pg_advisory_xact_lock` serialization (`:98–144`) and a pure verifier
  (`verifyChainRows`, `:195`); no route updates or deletes `audit_logs`. The engine is
  excellent — the gap (SEC-01) is that billing does not call it, not that it is weak.
- **Super-admin USB defense-in-depth.** `requireSuperAdmin` re-checks role+isActive and
  can require a physical USB key with a scoped `remoteLoginEnabled` bypass
  (`requireSuperAdmin.ts:24–58, 81–88`).
- **Webhook signatures are now mandatory and fail-closed.** Both verifiers reject on
  missing signature/secret (`gateway-webhooks.ts:59–79`), closing the prior
  "omit-to-skip" bug; settlement is idempotent and row-locked (`settleBill:98–149`).
- **Payments API is well-guarded.** `POST /payments` uses `FOR UPDATE`, rejects
  `amount <= 0` (explicitly directing refunds elsewhere), and caps payment at the
  outstanding balance (`bills.ts:1886–1918`).
- **No secrets committed.** `.env.example` uses `change…` placeholders; `docker-compose.yml`
  uses `${VAR}` interpolation; provider secrets fall back to empty string and fail closed
  (`PaymentEngine.ts:42–62`, `resolveActiveGateway.ts:25–29`).
- **Read-open / write-gated pattern** is used consistently and thoughtfully across the
  catalog routes (doctors/tests/discount-reasons/test-categories) so low-privilege staff
  can read reference data without holding mutation permissions (`index.ts:267–345`).

**Potential risk to watch (not a defect):** `BOOTSTRAP_ADMIN_FORCE=true` resets the admin
PIN to default on every restart; ensure it is unset in production
(`lib/bootstrapAdmin.ts:16`, and the operator note in `docker-compose.yml`).

---

## 8. Direct DELETE routes for financial data (inventory)

| Route | File:line | Auth | Audited? |
|---|---|---|---|
| `DELETE /bills/:id` (+ delete payments, renumber sequence) | bills.ts:1451/1498 | `/billing` + super-admin body token + USB | `bill_audits` only (not chained) |
| `DELETE /accounting/vouchers/:id` | accounting.ts:329 | `/accounting` | **No audit** |
| `DELETE /expenses/:id` | expenses.ts:211 | `/accounting` | **No audit** |
| `POST /ledgers/:id/reset` (delete payments, bill_audits, bills, orders, patients) | ledgers.ts:357–373 | `/accounting` + super-admin token | **No chain audit** |
| `DELETE /ledgers/:id` | ledgers.ts:192 | `/accounting` + super-admin token | — |
| `DELETE /discounts/:id` | discounts.ts:117 | `/discounts` | No audit |
| `DELETE /packages/:id` | packages.ts:334 | `/packages`(staff) | No audit |
| `DELETE /tests/:id` (`?force=true` hard-deletes referenced) | tests.ts:294 | `/tests` | No audit |
| `DELETE /banking/accounts/:id` | banking.ts:104 | `/banking` | banking module audits elsewhere |

---

## Findings register

| ID | Severity | Classification | Title | Location |
|---|---|---|---|---|
| SEC-01 | P0 | Missing control | Billing money-mutations bypass the immutable audit chain (write only to mutable `bill_audits`) | bills.ts:989/1225/1445/1485/1687; users.ts:57; audit.ts:75 |
| SEC-02 | P1 | Confirmed defect | Vouchers hard-deletable with no audit/reason under `/accounting` | accounting.ts:329 |
| SEC-03 | P1 | Missing control | Expense create/self-approve/hard-delete under one permission; delete unaudited; `approvedBy` from body | expenses.ts:96/109/211 |
| SEC-04 | P1 | Architectural weakness | HDFC webhook signature omits amount + no nonce → replay/amount-tamper | gateway-webhooks.ts:76/338/377 |
| SEC-05 | P1 | Missing control | `/gateway/reconcile` + online-booking confirm/cancel gated by auth only, no permission | index.ts:234/734; gateway-webhooks.ts:456; online-bookings.ts:196/86 |
| SEC-06 | P1 | Confirmed defect | `/send-otp` returns the OTP in its response, nullifying the factor | public-booking.ts:1589 |
| SEC-07 | P2 | Confirmed defect | Actor identity (`performedBy`/`editedBy`/`approvedBy`) taken from body → spoofable | bills.ts:1624/1978/1311; expenses.ts:96 |
| SEC-08 | P2 | Architectural weakness | Ledger reset/delete hard-deletes bills+payments+`bill_audits` with no chain audit | ledgers.ts:280/357–373/192 |
| SEC-09 | P2 | Architectural weakness | Super-admin bill ops authenticate via body token, bypassing `requireSuperAdmin` role re-check | bills.ts:1353/1381/1470; requireSuperAdmin.ts:15 |
| SEC-10 | P2 | Architectural weakness | Webhooks ACK 200 before processing and on signature-reject → no gateway retry | gateway-webhooks.ts:187/332/217/352 |
| SEC-11 | P2 | Confirmed defect | Client-trusted custom price + un-validated inline payments (mass assignment) | orders.ts:216; bills.ts:382/583 |
| SEC-12 | P3 | Missing control | `bill_audits`/`voucher_audits` lack userId/IP/UA/chain hash | users.ts:57; accounting.ts:72 |
