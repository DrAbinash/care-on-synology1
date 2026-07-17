# 06 — GST / Tax & Invoice-Compliance Audit

**System:** CARE ERP (Care Diagnostics + Hope Neurotrauma & Multispeciality Hospital)
**Audit date:** 2026-07-16
**Auditor dimension:** GST / tax configuration, invoice-document compliance, credit notes, tax-report reproducibility
**Status of conclusions:** Technical findings are verified against code read in this run (exact file:line cited for every claim). All conclusions about *legal* GST treatment are explicitly marked **Requires CA/GST-professional validation** — this document does not certify or deny tax compliance; it describes what the software can and cannot represent.

---

## 1. Scope & method

Every occurrence of `gst`, `gstin`, `cgst`, `sgst`, `igst`, `cess`, `hsn`, `sac`, `tax`, `taxRate`, `taxAmount`, `place of supply`, `credit note`, `debit note`, `GSTR` in the monorepo was grepped and each financial hit was read in source:

- **Schema:** `lib/db/src/schema/bills.ts`, `clinicSettings.ts`, `branches.ts`, `accounting.ts`, `tests.ts`, `expenses.ts`, `outsourcedLabs.ts`, `vendors.ts` (via grep), plus base DDL `lib/db/drizzle/0000_dear_forge.sql` and `migrations/zz_schema_reconcile_20260709.sql`, `migrations/fix_gstin_razorpay_nullable.sql`.
- **API:** `artifacts/api-server/src/routes/bills.ts` (all money-mutating routes), `clinicSettings.ts`, `accounting.ts` (Tally exports), `books-sanity.ts`, `services/self-registration.ts`, `lib/istDate.ts`, zod contracts in `lib/api-zod/src/generated/api.ts`.
- **Print templates (what the patient actually receives):** `artifacts/diagnostic-erp/src/lib/printBill.ts` (classic, read in full), `designerBillPrint.ts` and `premiumBillPrint.ts` (tax/GST-relevant sections), `pages/BillDetail.tsx`, `pages/Settings.tsx` (GSTIN entry), `pages/Inventory.tsx` / `OutsourceSettings.tsx` (vendor GSTIN entry).

Repo-wide greps for `hsn`, `sac`, `cgst`, `sgst`, `igst`, `place of supply`, `cess` returned **zero financial hits** (only radiology-content false positives such as "thecal sac"); greps for `credit note`/`debit note` and `GSTR` returned **zero hits**. Those negatives are themselves findings.

---

## 2. What the system actually does with tax — evidence-backed narrative

### 2.1 Tax is a permanently-zero header field

`bills.tax_amount` exists as a header-level column (`lib/db/src/schema/bills.ts:16` — `taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0")`), but **every** bill-creation path hardcodes it to zero:

- Billing desk: `artifacts/api-server/src/routes/bills.ts:549-550` —
  ```ts
  const taxAmount = 0;
  const totalAmount = subtotal - discountAmt + taxAmount;
  ```
  inserted at `:596` as `taxAmount: taxAmount.toFixed(2)`.
- Kiosk / online self-registration: `artifacts/api-server/src/services/self-registration.ts:192` — `taxAmount: "0.00",`.

There is **no tax configuration surface anywhere**: `diagnostic_tests` has only `price` (`lib/db/src/schema/tests.ts:10`) — no tax rate, no taxability flag, no HSN/SAC; `clinic_settings` holds only a `gstin` string (`lib/db/src/schema/clinicSettings.ts:15`); no tax-rate table exists in any schema file or migration. The healthcare-services GST exemption is therefore an *implicit assumption baked into a hardcoded `0`*, not a modeled rule.

The only paths that can ever make `tax_amount` non-zero are the super-admin edit (`bills.ts:1396,1414`, body schema `lib/api-zod/src/generated/api.ts:1961` — `taxAmount: zod.number().optional()`, unbounded, negatives accepted) and direct SQL. The ERP UI exposes a "Tax (₹)" input only inside the super-edit dialog (`artifacts/diagnostic-erp/src/pages/BillDetail.tsx:1181`), and `BillDetail.tsx:783-786` renders a Tax row only `{bill.taxAmount > 0 && ...}`.

**Positive note:** because `tax_amount` is stored on the bill row at insert time and bill totals are never recomputed from the current test catalog, there is **no silent recomputation of old invoices from current rates** — the anti-pattern the audit brief asks to flag is absent. The stored-at-sale invariant is even monitored: `routes/books-sanity.ts:63-71` flags any bill where `ABS(subtotal - discount + tax_amount - total_amount) > 0.01`.

### 2.2 GSTIN storage: four places, one used

| Holder | Column | Used for |
| --- | --- | --- |
| Clinic (single row) | `clinic_settings.gstin` — `clinicSettings.ts:15`, nullable per `migrations/fix_gstin_razorpay_nullable.sql:13` | Printed on all three receipt templates (`printBill.ts:338`, `premiumBillPrint.ts:524`, `designerBillPrint.ts:384,547`) |
| Branch | `branches.gstin` — `lib/db/src/schema/branches.ts:16` | **Never referenced by billing or printing** (bills carry no `branch_id`; grep confirms only Settings UI CRUD at `Settings.tsx:6751-6855`) |
| Vendor / outsourced lab | `vendors.gstin` (`vendors.ts:16`), `outsourced_labs.gstin` (`outsourcedLabs.ts:27`) | Display-only in Inventory/Outsource settings pages |
| Chart-of-accounts party | `accounts.gstApplicable`, `accounts.gstNumber` (`accounting.ts:47-48`) | Exported to Tally with registration type hardcoded `Regular` (`routes/accounting.ts:688-689`) |

**Recipient GSTIN does not exist**: `patients` has no GSTIN column and there is no corporate-client/B2B entity, so a B2B invoice (e.g. corporate health-checkup contract, insurance/TPA billing) cannot be issued with the recipient's GSTIN — a hard prerequisite for the counterparty's ITC.

No GSTIN written anywhere is format-validated: `PUT /api/clinic-settings` treats `gstin` as a generic trimmed string (`routes/clinicSettings.ts:268`, `:306`, generic string check at `:327-334`), and `Settings.tsx:1339-1340` is a bare `<Input>` labelled "GSTIN / Tax No.".

### 2.3 Intra/inter-state logic, CGST/SGST split, IGST, place of supply

**None of it exists.** Repo-wide greps for `cgst`, `sgst`, `igst`, `place of supply`, `cess`, `hsn`, `sac` produce zero financial hits. There is no state-code comparison anywhere, no split of any tax amount into components, and no per-line tax storage — `order_tests` rows carry only `price` (verified in `bills.ts:470-474` join selecting `testId/isActive/name`, and the insert path documented in the billing map: client-sent price stored verbatim). The single `bills.tax_amount` header field could not support a CGST/SGST split even if populated.

### 2.4 What the printed document says

The classic template (`printBill.ts:322-486`) prints, in full: clinic header with `GSTIN: <clinic gstin>` when configured (`:338`), title **"INVOICE / RECEIPT"** (`:348`), test table with per-line ₹ amounts (`:281-293`), then totals **SUBTOTAL → DISCOUNT → TOTAL → PAID → BALANCE DUE** (`:436-446`). **There is no tax row at all** — `taxAmount` is in the `PrintBillData` type (`printBill.ts:8`) but never rendered. No HSN/SAC column, no taxable-value column, no place of supply, no recipient GSTIN, no "exempt supply" or "bill of supply" declaration, no amount-in-words on the classic format (optional on premium, `printBill.ts:525`).

The "designer" template goes further and **labels the document "Tax Invoice"** (`designerBillPrint.ts:544`) while containing no tax content whatsoever.

### 2.5 Invoice-number lifecycle

- **Generation:** pure-numeric `YYYYMM` + zero-padded sequence from `MAX(bill_number)` under a Postgres advisory lock (`bills.ts:98-125`, lock taken at `:571` and in `self-registration.ts:182`). DB-level `UNIQUE` on `bill_number` exists in the drizzle base DDL (`lib/db/drizzle/0000_dear_forge.sql:122` — `CONSTRAINT "bills_bill_number_unique" UNIQUE("bill_number")`).
- **Month prefix is computed in server-local time** — `bills.ts:99-100` uses `new Date().getFullYear()/getMonth()`, while the project's own `lib/istDate.ts:4-6` documents "the server container runs UTC… `getFullYear()` etc. are also UTC-based".
- **Mutation:** `PUT /bills/:id` can change discount/total/status (`bills.ts:758-802`); `PATCH /:id/super-edit` can rewrite subtotal/discount/tax/total (`bills.ts:1394-1418`), audited per field into `bill_audits` (`:1422-1445`, including a `taxAmount` audit row at `:1443`).
- **Deletion:** `DELETE /bills/:id` (super-admin token) hard-deletes the payments and the bill (`bills.ts:1498-1499`) and then **renumbers every later bill in the same month down by one** (`bills.ts:1502-1524`, e.g. `:1522` — `const newBillNumber = `${monthPrefix}${String(parts.seq - 1).padStart(4, "0")}`;`).
- **Cancellation:** `POST /:id/cancel` keeps the row, sets status/cancelledBy/reason and zeroes balance (`bills.ts:979-987`), cascades to `order_tests` (`:1002-1009`), audits (`:989-996`) — the invoice number is *not* reused on cancellation. This is the correct pattern; the delete route is the violation.

### 2.6 Refunds and credit notes

Refunds are modeled as **negative rows in `payments`** (`bills.ts:1037-1044` — `amount: String(-refundedAmount)` with note `"REFUND on cancellation: ..."`; the standalone `/refund` route uses the same pattern per its header comment at `bills.ts:1136-1139`). There is **no credit-note or debit-note entity anywhere** (repo grep for `credit.?note|debit.?note` over `.ts/.tsx/.sql`: zero hits): no separate document series, no printable credit-note document, no linkage of a value reduction to the original invoice other than the payments row and `bills.refund_amount`.

### 2.7 Tax reporting & reproducibility

There is **no GST report of any kind**: no GSTR-1/GSTR-3B export, no HSN summary, no exempt-supply register (grep `GSTR` → zero hits). The only tax aggregation in the codebase is `SUM(b.tax_amount)` inside the books-sanity period totals (`routes/books-sanity.ts:177`) — which will always be ~0. The Tally exports (`routes/accounting.ts:660-878`) emit two-ledger vouchers with **no GST allocations, rates or classifications**, and stamp `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>` for every party that has any `gstNumber` (`accounting.ts:688-689`, `:902-903`) regardless of actual registration type (composition/unregistered/UIN).

Because issued bills can be mutated in place (2.5), hard-deleted, and renumbered, **a turnover/tax figure computed for a past period is not reproducible**: re-running the same query later can return different totals and different invoice-number-to-transaction mappings, with the only record of the change living in `bill_audits` free-text rows.

---

## 3. Strengths (what is done well)

These are genuine controls found in code, cited so the executive summary can credit them:

1. **No retroactive recomputation from current prices.** Subtotal/discount/tax/total are frozen on the bill row at creation (`bills.ts:588-607`); `original_total` is additionally preserved (`bills.ts:598`, schema `bills.ts:28`) and a guarded backfill restores it if the old refund bug mutated totals (`books-sanity.ts:233-346`, dry-run by default, transactional, self-verifying).
2. **DB-level invoice-number uniqueness + race-safe allocation.** `UNIQUE("bill_number")` (`0000_dear_forge.sql:122`) plus `pg_advisory_xact_lock` around MAX-read-then-insert in both allocators (`bills.ts:571`, `self-registration.ts:182`), with an unusually well-reasoned comment about pool deadlocks (`bills.ts:106-114`).
3. **Cancellation preserves the document.** Cancelled bills keep their row and number, record who/when/why (`bills.ts:979-987`), cascade to line items to stop commission accrual (`:1002-1009`), and print with a "CANCELLED" title (`printBill.ts:348`).
4. **A CA-facing self-audit endpoint exists.** `GET /api/books-sanity` checks total-arithmetic drift *including tax* (`books-sanity.ts:63-81`), paid-vs-payments drift, cancelled-but-unrefunded money, >50% discounts, and surfaces every super-admin edit including `taxAmount` changes for review (`:149-169`).
5. **Amount edits are field-level audited.** Super-edit writes one `bill_audits` row per changed field including tax (`bills.ts:1422-1445`); bill deletion writes a pre-delete audit row preserving the old bill number (`bills.ts:1485-1492`); Tally exports are themselves audit-logged (`accounting.ts:768-777`).
6. **GSTIN placeholder hygiene.** Startup migration converts the `GSTIN_NOT_SET` placeholder to NULL specifically so receipts never print a garbage GSTIN (`artifacts/api-server/src/index.ts:386-392`, `migrations/fix_gstin_razorpay_nullable.sql`).
7. **Refunds are visible, not erased.** Negative payment rows keep the full money trail in the payment history and on the printed payment-details block (`printBill.ts:301-307`).

---

## 4. Findings

### [GST-01] P1 — No tax engine: taxAmount hardcoded to zero, healthcare exemption implicit and unmodeled
- Severity: P1
- Classification: Missing control (tax treatment itself: Requires CA/GST-professional validation)
- Location: `artifacts/api-server/src/routes/bills.ts:549-550,596` (billing desk); `artifacts/api-server/src/services/self-registration.ts:192` (kiosk/online); `lib/db/src/schema/tests.ts:5-34` (no per-test tax fields); `lib/db/src/schema/bills.ts:16` (header-only `tax_amount`)
- Current behavior: Every bill is created with `const taxAmount = 0;` (`bills.ts:549`) / `taxAmount: "0.00"` (`self-registration.ts:192`). There is no tax-rate configuration table, no per-service taxability flag, no exemption category on `diagnostic_tests` (only `price`, `tests.ts:10`).
- Why unsafe: The system encodes "everything we sell is GST-exempt" as a hardcoded literal. Healthcare *diagnostic services* are generally exempt (Notification 12/2017, entry 74), but a hospital+diagnostics group routinely has taxable supplies: non-ICU room rent above ₹5,000/day (taxable at 5% since 18-07-2022), sale of medicines/consumables/implants to outpatients, cosmetic procedures, food/canteen, rental income, scrap sales. If any such item is ever billed through this system it will be invoiced at 0% tax with no way to configure otherwise, creating an unrecorded output-tax liability with interest/penalty exposure.
- Failure scenario: Hope Hospital bills a private non-ICU room at ₹6,000/day for 5 days through a "Room Rent" test entry. The system prints ₹30,000 with no GST; 5% (₹1,500) output tax is never charged, never recorded, never reported. A departmental audit two years later raises demand + interest + penalty on every such bill.
- Recommended correction: Add per-service tax classification (exempt / taxable-with-rate / nil-rated) and HSN/SAC to the service catalog; compute and store per-line taxable value and tax at billing time; default everything to "exempt (healthcare)" so current behavior is preserved explicitly rather than implicitly. Have the CA confirm the supply-wise classification list.
- Backward compatible: yes — defaulting all existing services to exempt keeps every current bill identical.
- Data migration required: yes — new columns on `diagnostic_tests` (taxability, rate, sac) and per-line tax columns on `order_tests`/bills; backfill existing rows as exempt/0.

### [GST-02] P0 — Bill deletion renumbers already-issued invoices and hard-deletes their payments
- Severity: P0
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/bills.ts:1451-1529` (`DELETE /api/bills/:id`), specifically `:1498-1499` (hard delete) and `:1502-1524` (renumber loop, `:1522` reassigns `${monthPrefix}${seq-1}`)
- Current behavior: A super-admin token deletes the bill row and all its payment rows (`tx.delete(paymentsTable)…; tx.delete(billsTable)…`), resets the order to `pending`, then shifts **every later bill number in that month down by one** so the sequence closes over the gap. Only a single free-text `bill_audits` row (`:1485-1492`) records the deleted number.
- Why unsafe: Invoice serial numbers, once issued, must be unique and must not be reassigned (GST Rule 46(b); a cancelled invoice must be reported, not erased). After one deletion, every subsequent printed invoice in patients' hands carries a number that now points to a *different* transaction in the database — receipt-verification QR flows, doctor-commission references, gateway `BILLPAY-` references and any GST return already filed for the period all silently desynchronize. Payments (settlement evidence) are destroyed, not voided.
- Failure scenario: 60 bills exist for 202607. Bill `2026070031` (₹8,500, paid by UPI) is deleted on 10-July. Bills `2026070032`–`2026070060` are renumbered `…0031`–`…0059`. A patient holding printed invoice `2026070045` disputes a charge in August; the DB row now numbered `2026070045` belongs to a different patient and different amount. Simultaneously ₹8,500 of recorded UPI settlement vanishes from the payments table while the bank statement still shows it.
- Recommended correction: Remove the renumber loop and the hard delete entirely; replace with the existing cancel flow (status=cancelled + mandatory refund handling). If a "never happened" administrative void is truly needed, keep the row with status `void`, keep payments (offset with reversal rows), and never reuse the number.
- Backward compatible: no (intentionally) — it removes a destructive capability; the UI's delete action should be re-pointed at cancel/void.
- Data migration required: no code-data migration, but historical renumbered periods can only be reconstructed from `bill_audits`; a one-time reconciliation report of `changeType='deleted'` rows should be produced for the CA.

### [GST-03] P1 — Issued invoices are mutable in place (including tax), with unbounded values and no credit note
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/bills.ts:1364-1448` (`PATCH /:id/super-edit`, values applied `:1411-1418`); body contract `lib/api-zod/src/generated/api.ts:1956-1962` (`subtotal/discount/taxAmount: zod.number().optional()` — no bounds, negatives accepted); `bills.ts:751-802` (`PUT /:id` recomputes discount/total/balance); UI tax input `artifacts/diagnostic-erp/src/pages/BillDetail.tsx:1181`
- Current behavior: Super-edit rewrites `subtotal`, `discount`, `taxAmount`, `totalAmount`, `balanceAmount`, `status` on the existing bill row (`:1411-1418`). Zod allows any finite number, including negative tax (net total `newSubtotal - newDiscount + newTaxAmount`, `:1397`). `PUT /bills/:id` similarly rewrites discount/total after the invoice has been printed. Changes are audited (`:1422-1445`) but the *document itself* is replaced, not supplemented.
- Why unsafe: The value of supply recorded for a tax period changes retroactively with no credit/debit note. A period total computed on the 1st and re-computed on the 20th can differ; nothing distinguishes "correcting a typo before handing the invoice over" from "reducing declared turnover months later". Negative `taxAmount` can silently reduce a bill's total below its line-item sum.
- Failure scenario: March turnover is reported from `SUM(total_amount)` = ₹12,40,000. In May, a super-admin edits a March bill's subtotal from ₹40,000 to ₹4,000 ("entry error"). The March figure now reproduces as ₹12,04,000; the filed return no longer matches the books, and the only trail is a `bill_audits` row a reviewer must manually notice via books-sanity.
- Recommended correction: Freeze bill money fields after first print/day-close; corrections after freeze must go through a credit/debit-note document (GST-04) that references the original bill. At minimum, bound super-edit inputs (`>= 0`, discount ≤ subtotal) and block edits to bills in closed periods.
- Backward compatible: partially — a freeze changes admin workflow; bounding the zod schema is fully compatible with legitimate use.
- Data migration required: no.

### [GST-04] P1 — No credit-note / debit-note entities: refunds and cancellations have no GST document
- Severity: P1
- Classification: Missing control
- Location: absence, evidenced at `artifacts/api-server/src/routes/bills.ts:1037-1044` (refund = negative `payments` row: `amount: String(-refundedAmount)`), `:1136-1139` (refund route header comment), `:979-987` (cancel mutates status only); repo grep `credit.?note|debit.?note` over `.ts/.tsx/.sql` = zero hits
- Current behavior: A refund inserts a negative payment row and adjusts `bills.refund_amount`/`paid_amount`; a cancellation flips `status` and zeroes balance. No numbered credit-note document is created, printed, or linked; nothing exists for upward revisions (debit notes).
- Why unsafe: Section 34 CGST Act requires credit notes for post-supply value reductions and their declaration in returns. Even for a fully-exempt provider, the CA needs a document trail for every value reversal — currently reversals are only reconstructible by joining negative payment rows and audit text. Patients receive no refund document; disputes rely on the mutated original bill.
- Failure scenario: A ₹15,000 MRI bill is cancelled with auto-refund on 30-June; July's books show only a negative payment row dated 30-June. The patient claims in August the refund was never received — there is no numbered refund/credit document with amount, reason, mode and signature to produce; the printed bill in their hands still says PAID ₹15,000.
- Recommended correction: Introduce a `credit_notes` table (own FY-based series, FK to bill, amount, reason, mode, actor, printable template referencing the original invoice number/date) and emit one automatically from the cancel/refund routes. Debit notes analogously for upward corrections replacing post-freeze super-edits.
- Backward compatible: yes — additive; existing refund rows remain and can be back-linked best-effort.
- Data migration required: optional backfill generating credit notes for historical rows where `refund_amount > 0`.

### [GST-05] P2 — No HSN/SAC, per-line taxable value, CGST/SGST/IGST split, place of supply, or recipient GSTIN anywhere
- Severity: P2
- Classification: Missing control
- Location: `lib/db/src/schema/tests.ts:5-34` (no HSN/SAC), `lib/db/src/schema/bills.ts:12-19` (single header `tax_amount`, no components), `lib/db/src/schema/patients.ts` (no GSTIN — confirmed via schema grep), repo-wide grep for `hsn|sac|cgst|sgst|igst|place of supply|cess` = zero financial hits
- Current behavior: The data model cannot represent a compliant taxable invoice line: no SAC (999316/9993 for healthcare), no per-line taxable value or rate, no CGST/SGST vs IGST determination (no supplier-state vs place-of-supply comparison exists), and no field to hold a B2B recipient's GSTIN.
- Why unsafe: The day any supply is taxable (see GST-01) or any B2B recipient needs a compliant invoice (corporate health checkups, TPA billing, inter-entity charges between the hospital and the diagnostics company), the system is structurally unable to issue it — staff will fall back to manual/parallel invoicing outside the ERP, which is where control is lost. Even a fully-exempt registered entity reports exempt turnover in GSTR-1/3B and should identify services by SAC.
- Failure scenario: A company contracts 200 employee health packages at ₹2,500 + GST-where-applicable and requires its GSTIN on invoices for its records. The ERP cannot print it; accounts staff produce Word invoices with a parallel number series; ERP turnover and filed turnover diverge permanently.
- Recommended correction: Delivered together with GST-01: per-line `taxable_value`, `sac`, `rate`, `cgst/sgst/igst` columns; optional `recipient_gstin`/`recipient_state` on bills; place-of-supply defaulted to clinic state.
- Backward compatible: yes — nullable/zero-default columns.
- Data migration required: yes — additive columns, backfill nulls/zeros.

### [GST-06] P2 — "Designer" print template labels a zero-tax document "Tax Invoice"; no template declares exemption or is a Bill of Supply
- Severity: P2
- Classification: Confirmed defect (correct document type: Requires CA/GST-professional validation)
- Location: `artifacts/diagnostic-erp/src/lib/designerBillPrint.ts:544` (`Tax Invoice` label); `printBill.ts:348` (`INVOICE / RECEIPT` hybrid title); `printBill.ts:436-446` (totals block has no tax line, no exemption declaration)
- Current behavior: The designer layout prints the heading "Tax Invoice" on a document that contains no tax rate, no tax amount, no HSN/SAC and (per GST-01) is always zero-tax. The classic layout titles itself "INVOICE / RECEIPT" — a single document trying to be both the invoice (supply document) and the receipt (payment document). No template carries an exempt-supply declaration or presents itself as a "Bill of Supply" (the document a registered person issues for exempt supplies, Rule 49).
- Why unsafe: A document titled "Tax Invoice" that shows no tax is internally contradictory and invites scrutiny; if the entity is GST-registered, issuing "Tax Invoice"-titled documents for exempt supplies instead of Bills of Supply is a form defect the CA must rule on. The invoice/receipt fusion also means a partly-paid supply and its later payments share one document, blurring the supply date vs receipt date distinction.
- Failure scenario: During a GST survey, officers sample printed bills headed "Tax Invoice" with GSTIN displayed and zero tax collected on every line, with no exemption notification cited — forcing the entity to defend document form and classification simultaneously.
- Recommended correction: Make the document title configuration-driven by registration status and supply type: "Bill of Supply" (registered, exempt), "Tax Invoice" (registered, taxable — only once GST-01 is fixed), "Invoice"/"Receipt" (unregistered). Add a one-line footer such as "Healthcare services — exempt under Notification 12/2017-CT(R), Sl. 74" once the CA confirms wording.
- Backward compatible: yes — label/footer changes only.
- Data migration required: no.

### [GST-07] P2 — GSTIN fields accept arbitrary strings with no format or checksum validation
- Severity: P2
- Classification: Missing control
- Location: `artifacts/api-server/src/routes/clinicSettings.ts:268,306,327-334` (gstin passes through the generic "must be a string" check and is stored trimmed); `artifacts/diagnostic-erp/src/pages/Settings.tsx:1339-1340` (bare input "GSTIN / Tax No."); same pattern for branches (`Settings.tsx:6855`), vendors (`Inventory.tsx:1201,1237`), outsourced labs (`OutsourceSettings.tsx:236`)
- Current behavior: Any string — a typo, a PAN, a phone number — is accepted as GSTIN at every capture point and, for `clinic_settings.gstin`, is then printed bold on every invoice (`printBill.ts:338`).
- Why unsafe: A malformed or transposed GSTIN on every issued invoice is a systematic document defect that also breaks any downstream e-invoice/return automation; vendor-side bad GSTINs corrupt future ITC/RCM records.
- Failure scenario: Admin pastes `20ABCDE1234FIZ5` (letter I instead of digit 1) into Settings. Every invoice for months prints an invalid GSTIN; a B2B customer's accountant rejects the invoices during their ITC review.
- Recommended correction: Validate against the 15-character pattern `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` plus the mod-36 check digit at API level (all four capture points), with a UI hint; allow explicit blank.
- Backward compatible: yes — validation on write only; optionally warn on existing invalid values.
- Data migration required: no (optional one-time report of invalid stored values).

### [GST-08] P2 — Per-branch GSTIN exists but is dead: bills have no branch linkage and all invoices print the single clinic GSTIN
- Severity: P2
- Classification: Architectural weakness
- Location: `lib/db/src/schema/branches.ts:16` (`gstin: text("gstin")`); `lib/db/src/schema/bills.ts:7-46` (no `branch_id`); print templates use `clinic_settings.gstin` only (`printBill.ts:338`, `designerBillPrint.ts:547`, `premiumBillPrint.ts:524`); branch GSTIN referenced nowhere else (grep: only Settings-page CRUD, `Settings.tsx:6751-6855`)
- Current behavior: Branches can each store a GSTIN, but no bill, payment, ledger or report is branch-scoped, there is no per-branch (or per-registration) invoice series, and printing always uses the single `clinic_settings.gstin`.
- Why unsafe: The group operates two brands (Care Diagnostics and Hope Neurotrauma & Multispeciality Hospital). If these are — or ever become — distinct GST registrations (different legal entities, or verticals registered separately), the system cannot issue invoices under the correct GSTIN or keep the mandatory separate serial series per registration; all revenue is stamped with one GSTIN regardless of which entity supplied the service.
- Failure scenario: The hospital entity's GSTIN is entered in a branch record; invoices for hospital services still print the diagnostics company's GSTIN. Turnover of two legal entities is commingled under one registration in every printed document.
- Recommended correction: Confirm with the CA how many registrations/entities exist. If more than one: add `branch_id` (or `registration_id`) to bills, print the owning registration's GSTIN and name, and give each registration its own invoice series. If exactly one: remove/hide the dead branch GSTIN field to prevent false confidence.
- Backward compatible: yes if single-registration (cosmetic); moderate schema work if multi-registration.
- Data migration required: yes in the multi-registration case (attribute historical bills to a registration).

### [GST-09] P2 — Invoice-series month prefix computed in UTC, not IST: bills issued 00:00–05:30 IST get the previous month's series
- Severity: P2
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/bills.ts:99-100` (`const date = new Date(); const yyyymm = `${date.getFullYear()}${…getMonth()+1…}``); contrast with the project's own warning in `artifacts/api-server/src/lib/istDate.ts:4-6` ("the server container runs UTC… getFullYear() etc. are also UTC-based"); same allocator used by kiosk via `self-registration.ts:183`
- Current behavior: `generateBillNumber` derives the `YYYYMM` prefix from server-local (UTC) time. Between midnight and 05:30 IST on the 1st of every month, new invoices are numbered into the *previous* month's series (e.g. a bill created 01-Aug 01:00 IST is numbered `202607xxxx`) while its `created_at` timestamptz correctly falls in August IST.
- Why unsafe: The invoice number's period label, the bill's actual IST date, and period reports (books-sanity filters on `created_at`) disagree for a predictable window every month — an emergency-heavy hospital bills through that window nightly. This muddies month-wise invoice-series continuity, day-close reconciliation, and any period-scoped filing the CA prepares; it also interacts with the delete-renumber logic (GST-02), which groups by the possibly-wrong month prefix.
- Failure scenario: On 01-Aug at 00:40 IST an emergency CT bill is numbered `2026070184`. July's series appears to have 184 bills when the CA reconciles July on 02-Aug morning but 183 when re-run after realizing the last one is an August supply; the printed number says July while the register says August.
- Recommended correction: Derive the prefix via the existing IST helpers (`todayIST()`/`nowIST()` from `lib/istDate.ts`) inside `generateBillNumber`.
- Backward compatible: yes — only affects numbers generated after the fix; existing numbers untouched.
- Data migration required: no.

### [GST-10] P2 — No GST reporting or reproducible tax register; Tally export carries no tax data and hardcodes registration type
- Severity: P2
- Classification: Missing control
- Location: repo grep `GSTR` = zero hits; only tax aggregation is `COALESCE(SUM(b.tax_amount),0) AS tax_sum` in `artifacts/api-server/src/routes/books-sanity.ts:177`; Tally voucher exports emit two-ledger entries with no tax allocations (`artifacts/api-server/src/routes/accounting.ts:704-731`, `:796-829`); `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>` hardcoded whenever a `gstNumber` exists (`accounting.ts:688-689`, `:902-903`)
- Current behavior: There is no exempt-turnover register, no HSN/SAC summary, no GSTR-1/3B-shaped export, and no snapshot of period tax figures. The Tally XML path exports masters and plain Dr/Cr vouchers; every party with any `gst_number` string is exported as a "Regular" registrant.
- Why unsafe: Even a fully-exempt registered entity files returns declaring exempt turnover; the CA must currently derive it from raw bill queries whose underlying rows are mutable (GST-03) and deletable (GST-02) — so the same question asked twice can return different answers, and nothing proves what was true at filing time. Mislabelled registration types imported into Tally propagate into the CA's GST workpapers.
- Failure scenario: The CA files Q1 returns off a bills export taken 05-July. In September a super-admin deletes one April bill (renumbering 30 others) and edits two others. A departmental query in the next FY asks the entity to substantiate Q1 turnover; the system now produces a different figure and a different invoice list, with the delta only reconstructible by manually replaying `bill_audits`.
- Recommended correction: (a) A period-locked turnover report (exempt/taxable/nil split once GST-01/05 land) with an immutable monthly snapshot — the existing monthly books-sanity cron snapshot (`books-sanity.ts:27-29` comment) is the natural home; (b) export actual registration type from a proper enum instead of hardcoding "Regular"; (c) period close that blocks bill mutation (ties to GST-03).
- Backward compatible: yes — additive reporting.
- Data migration required: no.

### [GST-11] P3 — Purchase-side GST entirely unmodeled: no tax fields on expenses or vendor invoices (TDS only), no RCM tracking
- Severity: P3
- Classification: Missing control (RCM applicability: Requires CA/GST-professional validation)
- Location: `lib/db/src/schema/expenses.ts:5-19` (amount/category only — no GST amount, no supplier GSTIN, no RCM flag); `lib/db/src/schema/outsourcedLabs.ts:155-165` (`outsource_vendor_invoices`: `grossAmount`/`tdsAmount`/`netPayable`, no tax fields) and `:171-186` (items likewise TDS-only); `vendors.gstin` (`vendors.ts:16`) captured but never used in any computation
- Current behavior: Purchases and expenses record TDS with care (income-tax side) but carry zero GST data: no input-tax split of vendor invoice amounts, no ITC-eligibility flag, no reverse-charge marker.
- Why unsafe: A predominantly-exempt healthcare provider generally cannot claim ITC — but reverse-charge liabilities (e.g. sponsorship, legal services, imports, security services from non-body-corporates) create *output* tax payable regardless of exemption, and nothing in this system can record or surface them. GST embedded in purchases is also invisible for cost accounting.
- Failure scenario: The hospital pays ₹2,00,000 to an advocate firm (RCM-notified service). The expense is recorded as a plain ₹2,00,000 cash-basis entry; ₹36,000 RCM output tax is never accrued or paid; discovered in a later audit with interest.
- Recommended correction: Add optional GST fields (taxable value, tax amount, supplier GSTIN, RCM flag, ITC-eligible flag) to `expenses` and `outsource_vendor_invoices`; a simple RCM-category checklist on expense categories, with the CA supplying the applicable category list.
- Backward compatible: yes — nullable additive columns.
- Data migration required: no (historical rows stay null).

### [GST-12] P3 — Fresh-install/reconcile DDL creates `bills` without the UNIQUE(bill_number) constraint; zero CHECK constraints permit invalid tax values
- Severity: P3
- Classification: Potential risk
- Location: `migrations/zz_schema_reconcile_20260709.sql:142-170` (`CREATE TABLE IF NOT EXISTS "bills" (… "bill_number" text DEFAULT '' NOT NULL …)` — no UNIQUE; only a non-unique index at `:27220` `CREATE INDEX IF NOT EXISTS "idx_bills_bill_number"`); contrast `lib/db/drizzle/0000_dear_forge.sql:122` (`CONSTRAINT "bills_bill_number_unique" UNIQUE("bill_number")`); `grep -c CHECK lib/db/drizzle/0000_dear_forge.sql` = 0
- Current behavior: The schema is defined in (at least) two DDL paths. The drizzle base enforces invoice-number uniqueness; the reconcile migration's create-if-missing path does not, and additionally defaults `bill_number` to `''`. No financial table anywhere has a CHECK constraint, so `tax_amount < 0`, `discount > subtotal`, `paid > total` are all DB-legal.
- Why unsafe: An environment bootstrapped via the reconcile path (fresh Synology install, disaster recovery) silently loses the DB-level guarantee that no two invoices share a number — the advisory lock prevents races only among well-behaved app writers, not manual SQL, backfills, or bugs. The absence of CHECKs means every invariant this audit relies on is application-layer only.
- Failure scenario: A DR restore recreates the DB from the reconcile script; months later a support engineer's backfill script inserts bills with duplicate numbers; nothing errors, and duplicate invoice numbers reach patients.
- Recommended correction: Add an idempotent migration asserting `bills_bill_number_unique` (and non-empty bill_number) exists regardless of bootstrap path; add minimal CHECKs (`tax_amount >= 0`, `discount >= 0`, `subtotal >= 0`) after a data-quality scan.
- Backward compatible: yes, provided a pre-check confirms no existing violations (books-sanity already hunts the arithmetic ones).
- Data migration required: pre-flight duplicate/negative scan; constraint creation only.

### [GST-13] P3 — Invoice series has no financial-year identity and no document-type segregation
- Severity: P3
- Classification: Unverified business rule (series design: Requires CA/GST-professional validation)
- Location: `artifacts/api-server/src/routes/bills.ts:89-133` (`YYYYMM` + global running sequence continuing across months from `MAX(bill_number)`, `:115-123`); single series shared by billing desk, kiosk and online bookings (`self-registration.ts:183`); no series for refund/credit documents (GST-04)
- Current behavior: One global numeric series serves every document the system produces; the sequence continues across month and FY boundaries (seq derives from the global MAX, `:119-123`). Nothing marks an FY, and receipts, invoices and (future) credit notes are not distinguishable by series.
- Why unsafe: Rule 46(b) requires a consecutive serial number unique **for a financial year** — the current scheme is likely acceptable (numbers are globally unique and monotonic) *until* the delete-renumber path (GST-02) reuses numbers, at which point within-FY uniqueness of issued documents is broken. The lack of an FY marker also complicates the CA's year-wise series continuity statement, and a future credit-note series must not share this sequence.
- Failure scenario: Preparing the FY 2026-27 audit file, the CA must certify the invoice series; with month-prefixed numbers whose sequence spans FYs and a history of renumbering, the continuity statement cannot be made without replaying `bill_audits`.
- Recommended correction: With the CA, fix a series policy (e.g. `FY2627/000001` or keep `YYYYMM####` but reset per FY and document it), guarantee no reuse (GST-02 fix), and reserve distinct series for credit notes and any future taxable-invoice class.
- Backward compatible: yes — apply to new numbers from a cutover date; parser already handles multiple legacy formats (`bills.ts:127-133`).
- Data migration required: no.

---

## 5. Consolidated position for the CA / GST professional

The following judgments are **outside software audit competence** and must be validated by the organization's CA/GST professional; the software findings above tell them exactly what the system can and cannot evidence:

1. Whether *every* supply billed through this ERP is exempt healthcare service (basis of GST-01/05/06) — including hospital room rent, consumables, and any non-clinical income.
2. Whether the entity/entities are GST-registered, how many registrations exist across Care Diagnostics and Hope Hospital (GST-08), and therefore whether documents should be Bills of Supply (GST-06).
3. RCM exposure on the expense categories the system records tax-blind (GST-11).
4. The acceptable invoice-series convention and the remediation narrative for historical renumbered/deleted invoices (GST-02/13) in any period already covered by filed returns.

## 6. Findings register

| ID | Severity | Classification | Title | Location |
|---|---|---|---|---|
| GST-01 | P1 | Missing control | No tax engine: taxAmount hardcoded to zero, exemption implicit and unmodeled | artifacts/api-server/src/routes/bills.ts:549; services/self-registration.ts:192; lib/db/src/schema/tests.ts:5-34 |
| GST-02 | P0 | Confirmed defect | Bill deletion renumbers issued invoices and hard-deletes payments | artifacts/api-server/src/routes/bills.ts:1451-1529 |
| GST-03 | P1 | Confirmed defect | Issued invoices mutable in place (incl. unbounded/negative tax), no credit note | artifacts/api-server/src/routes/bills.ts:1364-1448, 751-802; lib/api-zod/src/generated/api.ts:1956-1962 |
| GST-04 | P1 | Missing control | No credit-note/debit-note entities for refunds and cancellations | artifacts/api-server/src/routes/bills.ts:1037-1044, 979-987 (absence; repo grep zero hits) |
| GST-05 | P2 | Missing control | No HSN/SAC, per-line tax, CGST/SGST/IGST split, place of supply, or recipient GSTIN | lib/db/src/schema/tests.ts:5-34; bills.ts:12-19 (repo grep zero hits) |
| GST-06 | P2 | Confirmed defect | Zero-tax document printed with "Tax Invoice" title; no Bill-of-Supply/exemption declaration | artifacts/diagnostic-erp/src/lib/designerBillPrint.ts:544; printBill.ts:348,436-446 |
| GST-07 | P2 | Missing control | GSTIN accepted without format/checksum validation at all four capture points | artifacts/api-server/src/routes/clinicSettings.ts:268,306,327-334; diagnostic-erp Settings.tsx:1339-1340 |
| GST-08 | P2 | Architectural weakness | Branch GSTIN dead: bills unlinked to branch, single clinic GSTIN printed on everything | lib/db/src/schema/branches.ts:16; bills.ts:7-46; printBill.ts:338 |
| GST-09 | P2 | Confirmed defect | Invoice-series month prefix computed in UTC, not IST | artifacts/api-server/src/routes/bills.ts:99-100; lib/istDate.ts:4-6 |
| GST-10 | P2 | Missing control | No GST reporting/reproducible tax register; Tally export tax-blind, registration type hardcoded | artifacts/api-server/src/routes/accounting.ts:688-689,704-731; books-sanity.ts:177 |
| GST-11 | P3 | Missing control | Purchase-side GST/ITC/RCM unmodeled (TDS only) | lib/db/src/schema/expenses.ts:5-19; outsourcedLabs.ts:155-186 |
| GST-12 | P3 | Potential risk | Reconcile DDL creates bills without UNIQUE(bill_number); zero CHECK constraints | migrations/zz_schema_reconcile_20260709.sql:142-170,27220; lib/db/drizzle/0000_dear_forge.sql:122 |
| GST-13 | P3 | Unverified business rule | No financial-year invoice-series identity; no document-type series segregation | artifacts/api-server/src/routes/bills.ts:89-133 |
