# HOPE → CARE Diagnostic Referral Integration — Pre-Implementation Audit

> **Status:** Complete (STEP 1 of the brief).
> **Scope of this document:** everything discovered before writing integration code, so
> that the implementation *reuses* existing CARE services and never builds a parallel
> patient / billing / order / pathology / radiology system.
> **Repos audited:** `drabinash/care-on-synology1` (CARE Diagnostics ERP — the writable
> target) and `drabinash/hope` (HOPE Hospital ERP — read-only reference clone at
> `/workspace/hope`).

---

## 0. The two systems at a glance

| | **HOPE Hospital ERP** (`/workspace/hope`) | **CARE Diagnostics ERP** (this repo) |
|---|---|---|
| Backend | `artifacts/api-server` (Express 5 + Drizzle + PG) | `artifacts/api-server` (Express + Drizzle + PG) |
| Frontend | `artifacts/hms` (React) | `artifacts/diagnostic-erp` (React) |
| Schema | `lib/db/src/schema` (Drizzle) | `lib/db/src/schema` (Drizzle) |
| Migrations | Drizzle generated SQL `lib/db/migrations/0000..0010` | Hand-written idempotent `migrations/*.sql` (auto-discovered, alphabetical) |
| Auth | **Session cookie only** (`express-session`, `connect.sid`, `user_sessions`, username+PIN) — *no service-to-service auth* | 5 mechanisms incl. **hashed API-key** (`ai_caller_credentials`) + **`X-Boundary-Key`** inter-org contract |
| Integration infra | **None** (no outbox, HTTP client, scheduler, webhook) | No outbox/bus, but `sync_queue`/`ai_job_queue` shapes, `client_ref` idempotency, `node-cron` drainers, HMAC inbound webhooks |

Both are Synology-deployed monorepos by the same team, so conventions line up closely.

---

## 1. HOPE prescription workflow

* A consultation is an **`opd_visits`** row (`/workspace/hope/lib/db/src/schema/opd.ts:7`):
  `visit_no` (unique), `patient_id`, `doctor_id`, `chief_complaints` (**clinical history**),
  `diagnosis` (single field — *no separate provisional-diagnosis column*), `medicines`
  (jsonb), **`lab_tests` (free text)**, **`radiology_tests` (free text)**, `advise`, `vitals`.
* The doctor writes everything on one page `hms/src/pages/opd/[id].tsx`; lab & radiology are
  **plain textareas** (`:849-858`), saved via `PUT /api/opd/:id` (`routes/opd.ts:110`).
* Structured, billable diagnostics live in a *separate* module: **`diagnostic_orders`**
  (`schema/diagnostic_orders.ts:8`) — `order_no`, `type` (lab|radiology), `patient_id`,
  `doctor_id`, `opd_visit_id`, `items` jsonb, `status`, `invoice_id`. Populated only by the
  standalone Diagnostics page, **not** by the prescription.

**Takeaway:** the doctor's prescribed investigations are today *unstructured text* on the
visit. The integration must lift them into a structured referral — which is exactly why a
catalogue-mapping layer (with synonyms + admin review) is mandatory.

## 2. Current pharmacy prescription-to-order integration (the pattern to mirror)

HOPE already solves "prescribe once, appear downstream" for **medicines**, and this is the
blueprint the diagnostic integration must follow:

1. **Shared table** `prescription_queue` (`schema/pharmacy.ts:427`): `queue_no`, `patient_id`,
   `opd_visit_id`, `doctor_id/name`, `prescription_items` jsonb, `status`
   (pending|dispensing|partial|completed|cancelled), `dispensed_items`, `unavailable_items`,
   `sale_id`.
2. **Producer** — an **upsert block inside `PUT /opd/:id`** (`routes/opd.ts:129-178`): when
   `medicines` is non-empty it looks up an existing queue row by `opd_visit_id`, enriches each
   item with live stock, and `INSERT`/`UPDATE`s a `status:"pending"` row. Failures are caught
   and are **non-fatal** (the prescription still saves).
3. **Consumer** — pharmacy routes read the queue, dispense, and bill
   (`routes/pharmacy-v3.ts:449-594`).

**The gap this project closes:** medicines auto-flow OPD → `prescription_queue`; `lab_tests` /
`radiology_tests` do **not** auto-flow anywhere. The new integration replicates the
`opd.ts:129-178` upsert, but the "queue" is an **external org (CARE)** reached over HTTP.

## 3. Patient registration schema — HOPE

`patients` (`/workspace/hope/lib/db/src/schema/patients.ts:5`): `uhid` (**unique, server-generated
MRN** — never rename/alter per blueprint), single `name`, **`age` integer (NO date-of-birth)**,
`gender`, `phone` (mobile), `email`, `address`, `blood_group`, `allergies`,
`emergency_contact`, `entity_id` (multi-tenant).

**Consequence:** HOPE cannot supply a DOB — identity matching from HOPE keys on **phone + name
+ age + gender**, never DOB.

## 4. Patient registration schema — CARE

`patients` (`lib/db/src/schema/patients.ts:5`): `patient_id` (**unique MRN**, e.g. `P-00001`),
`first_name`, `last_name`, **`date_of_birth` text NOT NULL**, `gender`, `phone` (the de-facto
identity key), `email`, `address`, `blood_group`, `age_value`, `age_unit`, `ledger_id`.

**Mapping frictions to handle:**
* HOPE `name` (single) → CARE `first_name`/`last_name` (split on first space).
* HOPE `age` (int) → CARE `age_value`/`age_unit` **and** a synthesized `date_of_birth`
  (`NOT NULL`; derive `YYYY-01-01` from age, flagged approximate).
* No external-id column on CARE patients today → we add a crosswalk table (§ below), never a
  column on `patients` (protected/core).

## 5. CARE diagnostic test catalogue

* **One billable catalogue**: `diagnostic_tests` (`schema/tests.ts:5`) — `code` (unique),
  `name`, `category`, `price` (single flat price), `department` (Pathology/X-Ray/USG/MRI/CT…),
  `test_type` (inhouse|outsourced), `modality_id`, `is_active`. Radiology & pathology share it.
* **Packages/panels**: `packages` + `package_tests` join (`schema/packages.ts`).
* **Clinical reference libraries** (no price, not sellable): pathology analytes/panels with
  LOINC + aliases in `lib/pathology/src/catalog.ts`; dormant `radiology_catalog`.

**Mapping key:** HOPE test code/name → **`diagnostic_tests.code`** (1:1), a `packages` row
(1:many), or "unmapped → admin review". HOPE's catalogue key is `billing_heads.code`
(category Pathology/Radiology); neither side has LOINC on the billable row.

## 6. CARE billing and invoice workflow — and the accounting freeze

* `bills` **is** the invoice; line items are the order's `order_tests`; "receipts" render from
  `bills` + `payments`. `POST /api/bills` (`routes/bills.ts:373`) copies `subtotal` from
  `orders.total_amount`, is **idempotent on `client_ref`**, generates `bill_number`
  (`YYYYMM####`) under an advisory lock, and double-entry vouchers post via `auto-voucher.ts`.
* **🔒 FINANCIAL FREEZE (governance).** `ACCOUNTING_PROTECTED_FILES.md`,
  `FINANCIAL_FREEZE_RULEBOOK.md`, `FINANCIAL_CHANGE_CONTROL.md`, `PROTECTED_FILES.md` lock:
  * **Tables:** `bills, payments, vouchers, accounts, expenses` (+ ledger).
  * **Files needing sign-off:** `routes/bills.ts, payments.ts, orders.ts, accounting.ts,
    banking.ts, gateway-webhooks.ts`, the payment providers, and the schemas
    `bills.ts, banking.ts, ledgers.ts, …`. Frontend `Billing*.tsx, BillDetail.tsx` etc.
  * **Invariants:** `balance = max(0, total − paid − refund)`; `total = subtotal − discount +
    tax`; every voucher balances; cancelled ⇒ balance `0.00`.

> **Hard rule adopted for this project:** the integration is **100 % additive**. It does **not**
> modify any frozen billing/accounting file or table, and it **never creates a bill**. It
> pre-populates and hands off to the *existing, unmodified* order/billing endpoints; CARE staff
> confirm and the canonical `POST /api/orders` + `POST /api/bills` do the actual money work.

## 7. Pathology order workflow (CARE)

* Order header `orders` (status pending→collected→completed) + line items `order_tests`.
* Physical lifecycle is per **sample**: `samples` (`schema/samples.ts`) with
  `SMP-YYMMDD-NNNN` accession, states `pending→collected→received→in_processing→completed→
  reported` (+ terminal `rejected`); junction `sample_test_assignments`.
* Results: `patient_reports` (parameters jsonb, `status` draft→pending_verification→verified→
  delivered, `is_critical`, sign at `POST /:id/sign`, verify at `POST /:id/verify`, critical
  ack at `POST /:id/acknowledge-critical`). Critical flagging engine `lib/pathology/src/flagging.ts`.
* Clinical history for pathology rides only on `orders.notes` (no dedicated column).

**Reuse:** accepting a pathology referral item = create the order (canonical), then it flows
into `samples` + `patient_reports` unchanged.

## 8. Radiology / RIS worklist workflow (CARE)

* Three spines + a crosswalk: `radiology_studies` (billing-driven order/worklist, has
  `clinical_history`, `referring_doctor`, `body_part`, `priority`, status
  scheduled→…→reported_final→delivered), `radiology_worklist` (PACS reporting mirror),
  `dicom_studies` (DICOM registry), unified by `canonical_study` on `study_instance_uid`.
* **Radiology studies + MWL (`radiology_scheduled_procedures`) are auto-fanned-out when a bill
  is created** (`bills.ts:635`). So reusing the canonical order/bill path gives radiology
  routing, clinical history and referring-doctor propagation **for free**.

**Reuse:** accepting a radiology referral item = same order/bill path; the USG/X-ray/CT study
appears on the existing worklist.

## 9. Referring-doctor records

* The **`doctors` table IS the referral master** (`schema/doctors.ts:5`): `name`,
  `specialization`, `phone`, `registration_number`, commission fields, `ledger_id`.
  ~962 referral doctors seeded via `import-referral-doctors.ts` (`ON CONFLICT(name) DO NOTHING`).
* The referring doctor lives on **`orders.doctor_id`** (bills reach it transitively).
* HOPE prescriber = HOPE `doctors` (`name`, `specialization`, `registration_no`).

**Reuse + add:** map a HOPE doctor → a CARE `doctors` row via a provider crosswalk
(`external_provider_links`), creating one on first use (mirroring the existing importer's
idempotent-by-name behaviour).

## 10. Existing APIs, webhooks, event bus, shared DB

* **CARE:** no transactional outbox / event bus. Closest reusable shapes: `sync_queue`
  (action/table/payload/is_synced/retry), `ai_job_queue` (status/retry/result/error),
  `client_ref` idempotency, ~18 `node-cron` every-minute drainers in `cron.ts`,
  `/api/internal/cron` (bearer `CRON_SECRET`) for autoscale triggering, HMAC inbound webhooks
  (`gateway-webhooks.ts` → `webhook_logs`). **Existing inter-org contract:** `routes/boundary.ts`
  (`X-Boundary-Key`, `GET /boundary/studies`, `POST /boundary/studies/:accession/report|status|
  deliver`) — the closest analog and the style this project matches.
* **HOPE:** none of the above — no outbox, no scheduler, no HTTP client. Global `fetch`
  is available on the Node runtime; everything on the emit/receive side is greenfield.

## 11. Authentication between the two systems

* **CARE inbound (HOPE→CARE):** mirror `requireAiCallerAuth` — a hashed bearer key in a
  DB-backed `integration_partners` table, per-attempt audit log, code-fixed permission
  allowlist, plus a source-organisation check; optional HMAC signature + timestamp/nonce for
  replay protection.
* **CARE→HOPE callbacks:** HOPE has *no* service auth today. The contract specifies a signed
  request (shared secret HMAC over body+timestamp) that HOPE validates in a **new API-key
  middleware** dropped into its empty `src/middlewares/`, mounted before `requireAuth`.

## 12. Existing duplicate-patient detection

* CARE has only weak/local dedupe: desk create rejects same phone+name within 5 min; self/online
  flow matches **phone only**; DICOM intake does name+DOB then fuzzy name; **no global dedupe,
  no merge, no external crosswalk.** ID generation is inconsistent across 4 code paths
  (`P-00001` vs `P00001`).
* **We add** a deterministic, staff-reviewed matcher + persistent `external_patient_links`
  crosswalk. We **never** auto-merge on name alone, and we reuse the highest-confidence signal
  (an existing HOPE↔CARE link) before anything else.

## 13. Existing test/package/pricing tables

Covered in §5. Pricing is a single `diagnostic_tests.price`; tiered/corporate pricing exists
only in the outsource domain (`outsource_price_groups`). **HOPE prices, if ever shown, are
estimates only** — CARE billing always re-prices from `diagnostic_tests`.

## 14. Cancellation and refund workflows

* CARE: `POST /api/bills/:id/cancel` (cascades `order_tests`→cancelled, optional auto-refund),
  `/refund`, `/cancel-test`, `/cancel-refund-tests` — all frozen, all preserve `total_amount`.
* The referral state machine mirrors real life: before CARE acceptance → cancel/update the
  pending referral; after billing/sample/report → **no destructive change**, only
  cancellation/amendment via CARE's existing (frozen) flows, with an acknowledged event back to
  HOPE.

## 15. Report delivery back to HOPE

* CARE finalisation already logs delivery in `report_delivery_logs` (WhatsApp/email) and, for
  radiology, `ris_sync_status` (with a `report_delivery` type that is *not yet implemented*).
* HOPE sink for returned results: **`diagnostic_orders.items` jsonb + `status`/`completed_at`**
  (reuse `PUT /diagnostic-orders/:id`) and **`patient_documents`** for the PDF. HOPE's blueprint
  explicitly names this as the missing "LIS parser integration" — the CARE result callback fills
  exactly that gap.

---

## Reusable components (do NOT rebuild)

| Need | Reuse |
|---|---|
| Patient records & creation | CARE `patients` + patient-id generation; **never** a parallel patient store |
| Test catalogue & pricing | `diagnostic_tests`, `packages`/`package_tests` |
| Order creation | canonical `POST /api/orders` (`orders.ts`) — call it, don't fork it |
| Billing / invoice / receipt / refund | `POST /api/bills` & friends — **frozen**, hand off only |
| Pathology sample & result | `samples`, `patient_reports`, `flagging.ts` |
| Radiology worklist & MWL | auto-fanned from bill; `radiology_studies`, `radiology_scheduled_procedures` |
| Referring doctor | `doctors` table |
| Service-to-service auth pattern | `requireAiCallerAuth` (hashed key + audit) |
| Inter-org HTTP contract style | `routes/boundary.ts` |
| Idempotency convention | `client_ref` + unique partial index |
| Background worker loop | `node-cron` drainers in `cron.ts` |
| Feature-flag backbone | `feature_flags` table + `staffSession.ts` client flags |

## Missing components (build — all additive)

1. `integration_partners` (+ audit log) — inbound partner credentials.
2. `external_patient_links` (+ event history) — HOPE↔CARE patient crosswalk.
3. `external_provider_links` — HOPE↔CARE referring-doctor crosswalk.
4. `service_catalogue_mappings` — HOPE test code/name → CARE test/package, versioned, synonyms.
5. `diagnostic_referrals`, `diagnostic_referral_items`, `diagnostic_referral_events` — the
   referral aggregate + per-item state + audit trail.
6. `integration_outbox` (+ `integration_delivery_attempts`) — transactional outbox → HOPE.
7. `external_result_links` — CARE report/order/study ↔ HOPE order/uhid.
8. Middleware `requireIntegrationPartnerAuth`, inbound API, state machine, patient-matching
   service, catalogue-mapping service, outbox dispatcher + cron, staff inbox API + UI.

## Data-flow (summary; full diagram in `03_ARCHITECTURE.md`)

```
HOPE doctor saves prescription (PUT /opd/:id)
   └─(mirror pharmacy upsert)→ HOPE emits diagnostic_referral.created  ──HTTPS(signed)──▶
        CARE  POST /api/integration/v1/diagnostic-referrals  (partner-key auth, idempotent)
          → diagnostic_referrals (PRESCRIBED→RECEIVED_BY_CARE)
          → patient matching  → external_patient_links
          → catalogue mapping → diagnostic_referral_items
          → HOPE Referrals inbox (CARE staff)
                → verify patient → verify/​map tests → Accept
                   → canonical POST /api/orders  (+ existing billing desk = CARE's own bill)
                   → pathology (samples/patient_reports) & radiology (worklist) unchanged
          → integration_outbox → cron dispatcher ──HTTPS(signed)──▶ HOPE result callback
                → HOPE diagnostic_orders.items/status + patient_documents (longitudinal record)
```

## Risk register

* **Security:** partner key compromise → per-partner hashed keys, rotation, rate limits, audit,
  least-privilege permission allowlist, source-org check, optional HMAC+nonce replay guard, no
  PHI in ordinary logs.
* **Patient-matching:** wrong merge is a clinical-safety event → deterministic tiers, staff
  confirmation for "probable", hard block on conflict, never auto-merge on name; full link audit.
* **Accounting-boundary:** any accidental CARE-bill creation from HOPE, or HOPE recording CARE
  revenue → integration never writes bills/vouchers; hands off to frozen endpoints; HOPE prices
  are estimates; no hidden revenue-share.
* **Reliability:** CARE downtime must not lose a prescription → HOPE save is non-fatal on emit
  failure (mirrors pharmacy), transactional outbox with retry/backoff/dead-letter + reconciler.
* **Duplication:** re-sent referral → idempotency key + immutable source referral UUID unique
  index; accept-once guard; one patient, one order, one bill.

## Proposed implementation plan (phased, feature-flagged)

* **Phase 1 (this PR):** schema + migration, partner auth, inbound referral API + state machine,
  patient matching + crosswalk, catalogue mapping, referral events/audit, CARE HOPE-Referrals
  inbox (list + detail + accept → canonical order handoff), outbox + dispatcher + reconciler,
  results-back emission scaffolding, comprehensive tests, docs, contract, HOPE adapter reference.
* **Phase 2:** billing pre-population deep-link polish, richer pathology/radiology status
  round-trips, per-item status events to HOPE.
* **Phase 3:** finalized reports & PDFs to HOPE, critical-result acknowledgement loop,
  cancellation/amendment flows, failed-sync reconciliation dashboard.
* **Phase 4 (not before core is stable):** patient WhatsApp link, prep instructions,
  appointment scheduling, price estimates, referral-leakage analytics.

## Files expected to change / add (CARE)

* **Add** `lib/db/src/schema/{integrationPartners,externalPatientLinks,externalProviderLinks,
  serviceCatalogueMappings,diagnosticReferrals,integrationOutbox,externalResultLinks}.ts`;
  one `export *` line each in `lib/db/src/schema/index.ts`.
* **Add** `migrations/hope_care_diagnostic_referral_integration.sql` (idempotent).
* **Add** `artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts`.
* **Add** `artifacts/api-server/src/services/integration/*` (state machine, patient matching,
  catalogue mapping, outbox, results emit) and `routes/integration/*` (inbound API, staff inbox).
* **Add** cron registration for the outbox dispatcher + reconciler.
* **Touch (additive, surgical, flagged):** `routes/index.ts` (mount 3 routers),
  `artifacts/diagnostic-erp/src/App.tsx` + `components/Layout.tsx` (1 route + 1 nav item),
  `lib/staffSession.ts` (`/hope-referrals` permission + client feature flag).
* **Do NOT touch:** any frozen billing/accounting file or table; `orders.ts`; `patient-reports.ts`
  core logic (results-back uses a decoupled reconciler, not an edit to that route).
