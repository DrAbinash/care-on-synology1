# 5 · Billing, report lifecycle, finalization and distribution
Sections 4, 5, 16 and the 20-step walkthrough. Repo: CARE ERP `origin/main 8658be5e`, HOPE `origin/main 8dbf555f`.
**Nothing about payment rules was changed, judged or proposed here — this is observed behaviour.** No credential, key or transaction value is reproduced.

---

## 5.1 Price → bill → payment

| Step | file:line | sync/async | writes |
|---|---|---|---|
| Price master | `lib/db/src/schema/tests.ts:8` (table **`diagnostic_tests`**, not `lab_tests`) | — | price |
| Per-line price snapshot | `orders.ts:41` `order_tests.price` | sync | order line |
| Discount rules | `schema/discounts.ts:3-19` (percentage/fixed; scope all/category/test; conditions `age_gte/age_lte/referral_doctor_id`); server `routes/discounts.ts:84,141-182` | sync | `discount_rules` |
| **Bill create** | `routes/bills.ts:712-1108` — **`taxAmount = 0` hardcoded at `:903`** | sync tx | `bills`, `payments` (inline), `bill_audits`, ledger backfill |
| Study fan-out | `bills.ts:1130` → `radiology.ts:137-227` | **async fire-and-forget** | `radiology_studies`, `radiology_scheduled_procedures`, MWL file |
| Add payment | `bills.ts:2947`, `FOR UPDATE` `:2977`, overpay cap `:3013` | sync tx | `payments`, `bills` |
| Gateway initiate | `bills.ts:3305-3408`; signing `lib/payments/IciciPaymentProvider.ts:55-58`; ref minted `:3333` = `BILLPAY-<billId>-<6 hex>` | sync HTTP out | `payment_logs` |
| Webhook | `routes/gateway-webhooks.ts:244` (ICICI) `:401` (HDFC/CCAvenue); verification `:61,:83`; settle `:113-209` | async | `payments`, `bills`, `payment_logs` |
| Callback / status poll | `routes/public-booking.ts:1552,1557` (block `:1404-1470`); `bills.ts:3411-3571` | sync | `payments`, `bills` |
| Refund (the only kind that exists) | `bills.ts:2090-2251` — negative `payments` row `:2158`, total frozen `:2137`, balance `:2145`, audit `:2175` | sync tx + async voucher | `payments`, `bills`, `bill_audits` |
| Waive due | `bills.ts:2020-2085` — **rewrites `total_amount`** | sync tx | `bills`, `bill_audits` |
| Voucher | `lib/auto-voucher.ts:210,308` | async, **never throws** | `vouchers` |
| Bill number | `bills.ts:222-229` → `documentNumberCounters.ts:44-64` → `next_bill_number_seq` | sync SEQUENCE | `bills.bill_number` unique **per ledger** (`bills.ts:59`) |
| Payment modes | cash / UPI / card / online as `payments.method`; **gateway refunds exist only as rows** | | |

**"BillDesk" is not a gateway here.** `grep BILLDESK_* env` → nothing. In this codebase *Billing Desk* is the in-house counter ledger (`routes/bills.ts`), the `BILLPAY-` reference prefix, and the studio's `resolveBillDeskForWorklistRows`. The real gateways are **ICICI Orange Pay** (env `:?` hard-required), HDFC/CCAvenue, PhonePe, BharatPe, PayU, Razorpay, Cashfree (`lib/payments/PaymentEngine.ts:21-73`), with credentials read from `payment_logs.request_payload` (`resolveBillDeskCollectorFromDb.ts`) rather than env.

## 5.2 Where payment is checked before radiology happens — nowhere

| Radiology action | file:line | payment consulted? |
|---|---|---|
| Study creation | `radiology.ts:137-227` | **No** — the only filter is `status != 'cancelled'` at `:310` |
| RIS worklist list | `radiology.ts:339-368` | No |
| PACS worklist | `radiology.ts:520-552` | No |
| Device MWL query | `internal-radiology.ts:2667-2723` | No |
| Image intake / push | `internal-radiology.ts:454,809-880` | No |
| Reporting studio queue | `internal-reporting-studio.ts:300-356` | **No** — `conds` is status + date/watermark only; bills arrive as `leftJoin`s and unmatched rows are still emitted |
| Report finalize | `radiology.ts:2367-2413`; `internal-reporting-studio.ts:736` | No — the gate is match-score + study lock + unreviewed-AI |
| Release / print / PDF | `patient-reports.ts:3380,3414` | **No** — the file contains zero payment tokens |
| Patient portal | `patientPortal.ts:54` | status filter `verified/delivered` only |
| Studio payload money fields | `internal-reporting-studio.ts:230-255`, `lib/reportingStudioBilling.ts:9-19` | **displayed only** (`PAID/DUE/UPI_PENDING`) |

So a paid study is never blocked by billing, and an unpaid study is never treated as paid — **payment simply is not a variable in the radiology chain.** Reporting eligibility is decided by *image arrival*, not by order or money. The deliberate exceptions: **emergency/offline** (`schema/emergencyBilling.ts`, `routes/emergencyBridge.ts` mounted ungated by staff session at `routes/index.ts:270`, reconciliation `lib/emergencyReconcile.ts:498-520` where an unpaid bill lands `pending` with tax 0) and **DS225** work, whose reports never touch a CARE bill at all and, on re-sync, coexist with an unpaid bill by design. This is a documented stance, not an accident — but it means *"released report with no payment"* is a normal state, and only the operator can say whether that is intended.

## 5.3 Bill ↔ study linking, and why it misses

The link is written in exactly one place: the **async fan-out** at `radiology.ts:17-19,73` (`bill_id`, `order_id`, `order_test_id`, unique per order-test). Everything downstream depends on `radiology_worklist.study_id`, which is nullable (`radiologyWorklist.ts:14`) and filled **only** by the 6-step intake cascade (`internal-radiology.ts:603-731`) whose steps 4-6 all require a resolved patient. The code measures its own failure: *"measured 666 of 668 US worklist rows arriving with `study_id` NULL"* (`internal-radiology.ts:977`). Auto-link then runs **for ultrasound only** (`:990`); for MRI/CT/X-ray it runs only from the UI, at finalize, or from the billing-vs-PACS summary (`:1951`, `internal-reporting-studio.ts:804`, `billingVsPacsSummary.ts:204`). Accession stamping into Orthanc is double-opt-in and USG-scoped (`stampAccessionFromBill.ts:53-58,187-191`); the worklist accession persists as `""` when DICOM carries none (`internal-radiology.ts:485-489`); `radiology_scheduled_procedures.sourceBillId` is a **TEXT** column (`radiologyScheduledProcedures.ts:27`).

## 5.4 Financial-integrity defects (all re-read in source)

| # | Defect | Evidence | Impact |
|---|---|---|---|
| **B-1** | **A gateway refund is never executed.** `refundPayment` is implemented on all seven providers (`PaymentProvider.ts:66`, `IciciPaymentProvider.ts:370`, `HdfcPaymentProvider.ts:259`, `PhonePe:150`, `BharatPe:156`, `PayU:143`, `Cashfree:34`) and has **zero call sites** in any route (verified by grep). `bills.ts:2090` writes a negative `payments` row only | measured grep + read | The books say refunded; **the patient's money has not moved**. Highest-consequence finding in this document |
| **B-2** | Partial capture posts the **intended** amount. `IciciPaymentProvider.ts:345-351` returns `paid` with no amount; `PaymentEngine.ts:102` accepts `amount` and ignores it; both settle paths (`public-booking.ts:1382`, `bills.ts:3524`) read `payment_logs.amount` | | over/under-capture silently booked as full payment |
| **B-3** | Double-capture by re-click. A **fresh** `BILLPAY-<id>-<hex>` is minted per click (`bills.ts:3333`, verified), balance read **unlocked** (`:3310`), and `settleBill` (`:190-195`) has no `paid ≤ total` cap. Session reuse exists (`reuseIciciPaymentSession.ts:64`) but is wired only for online bookings (`online-bookings.ts:664`) | | two successful captures on one bill |
| **B-4** | **The public verification page guesses the bill.** `routes/verify.ts:25-44` (verified: `where(eq(billsTable.billNumber, billNumber)).limit(1)`) on a **public** route, bypassing `lib/billByNumber.ts:19-40` which refuses on ambiguity. Since PR #790 bill numbers are unique **per ledger** — two books can print the same number | | wrong bill's PHI, patient name and totals rendered to whoever scans the QR; `:64-69` also does an unlocked read-modify-write counter |
| **B-5** | The reconcile queue cannot work. `gateway-webhooks.ts:714-719` (verified) tests Set membership for the literal ``BILLPAY-${id}`` and ``BILLPAY-${id}-``, but real refs are `BILLPAY-${id}-HEX` — `Set.has` is exact, so **both arms can never match** — and the third arm is `balance > 0`, reducing the "pending online" list to *every unpaid bill*. `/reconcile:570` then probes the gateway with a reference that was never issued | | the safety net for missed webhooks is a no-op; unsettled online payments are found only by accident |
| **B-6** | Unlocked money writers remain after the #887/#892 lock-order work (whose order was inventory: lots→item). `bills.ts:2432` super-edit writes `subtotal/discount/tax/total/balance/status` via a plain `db.update`, **no transaction, no `FOR UPDATE`** (verified); `:1607` similar. Every `FOR UPDATE` site is `:1585,1822,2034,2121,2680,2776,2977,3115,3498`, `accounting.ts:1214`, `public-booking.ts:1409`, `gateway-webhooks.ts:141` — super-edit is absent | | concurrent super-edit vs payment settle can lose an update |
| **B-7** | **Hard delete erases payment history**: `bills.ts:2530` (verified) `tx.delete(paymentsTable)` then `tx.delete(billsTable)` and renumbers sibling bills `:2557-2566` | | audit gap; irreversible |
| **B-8** | Money moves without an accounting row: `auto-voucher.ts:208,308-310` swallows every failure (`.catch(()=>{})` at `gateway-webhooks.ts:344`, `bills.ts:2209`); waive-due (`:2034-2060`) reduces revenue with a bill audit but no voucher | | ledger vs balance drift |
| **B-9** | `client_ref` index drift: migration `add_bill_order_idempotency.sql:23-25` is `WHERE client_ref IS NOT NULL`, schema `bills.ts:65-67` adds `status IS DISTINCT FROM 'cancelled'`. On a migrated DB, cancel-then-rebill with a replayed ref hits `:1090` → `returnExistingBillByClientRef` filters cancelled → rethrow → **500** | | rebill after cancellation fails |
| **B-10** | Tax is hardcoded `0` on the main create path (`bills.ts:903`, verified) while `bills.tax_amount` and GST machinery exist elsewhere | | every cash/UPI bill is tax-zero by code, not by rule |

**Test coverage:** `gateway-webhooks.test.ts` (13) exercises signature helpers only; `gateway-webhooks.settle.test.ts` (13) has 7 executed against a mocked db and **6 are text greps of source files** (`:210-250`) — the pattern AGENTS.md warns cannot catch a runtime fault. Uncovered by execution: `/reconcile`, `/pending-online-bills`, both settle paths, every provider's `refundPayment`, `bills.ts:2090` refund, super-edit, `emergencyReconcile`.

## 5.5 Report lifecycle

Two unrelated free-text status columns, no DB enum: `patient_reports.status` (`patientReports.ts:33`, default **`draft`**) and `radiology_worklist.status` (UPPERCASE, validity enforced only in code, `internal-radiology.ts:1271`).

| Transition | Route | Guards | Audit row |
|---|---|---|---|
| → draft | `POST /api/patient-reports` (`:1966`) | PCPNDT `:2020`, unreviewed-AI `:2080`, content `:2109`, `claimWorklistForFinalize` FOR UPDATE (`radiologyIdentity.ts:249`) | none |
| → signed (structured, flag on) | same POST → `structuredFinalizeTransaction:954` | D1 validate `:1130`; `pg_advisory_xact_lock('care_erp_audit_chain')` `:1100` | **hash-chained** `finalize`, id reserved `:1124-1126` |
| → pending_verification (legacy) | `POST /:id/sign:2371` | SIGN_DENY_ROLES `:2379`, already-signed `:2417`, content `:2471` | `legacy_sign:2553` |
| → verified | `POST /:id/verify:2574` / `performStructuredVerify:633` | **verifier ≠ signer** `:660`, `verifyContentSha256` `:667`, superseded `:680` | chained `verify:754` |
| → delivered | `markDeliveredIfVerified:3486` (print/pdf/public/share), auto-WhatsApp `:2750` | | `report_shares` |
| signed → draft | `POST /:id/withdraw-signature:2869` | refuses verified/delivered `:2897` and structured `:2906`; signer-or-admin `:2916`; worklist→`REPORT_IN_PROGRESS`, reportId/delivery cleared `:2967` | `signature_withdrawn:2917` |
| signed → new row | `POST /:id/amend:1555` | flag `:1564`, `state==="final"`, `UNIQUE(original_report_id)`, clinical-equivalence `:1717` | chained `finalize` for the new doc |
| cancel / void | **does not exist** — no cancelled/void status anywhere in the table or routes | | |

**L-1 (P0) — the signed row has no status.** `patient-reports.ts:1147-1171` (verified: `signedAt` is set, `status` is not) → the structured-finalized report stays `draft`. Every deliverable filter uses `["pending_verification","verified","delivered"]` (`:3467`, `:3530`, `patientPortal.ts:54`, `reportDeliveryTracking.ts:56`, `resultsEmitter.ts:48`) while `isSignedArtifact` protects it as signed. So a legitimately signed report is **invisible to the portal, to delivery tracking, and to the HOPE emitter**, and reaches HOPE only via the manual button (which passes on `!!signedAt`, `emitReportToHope.ts:123`).
**L-2 (P0) — amendment publishes an undeliverable draft and the old PDF keeps serving.** `POST /:id/amend` inserts the superseding row with **no `status`** (`:1803-1828`, verified) → the version resolver walks newest→requested and returns **`latest_not_deliverable`**, handing out the *superseded* row via the original token (`radiologyReportVersion.ts:333-342`, verified; `report_shares`/`delivered_at` stamp the old row `:3472`). The released copy and the version chain then disagree — a medico-legal problem, not a UI one.
**L-3** — **no amendment is reachable from the radiologist's screen**: `POST /:id/amend` has no frontend caller (`signedReportCorrectionTruth.test.ts:231` asserts the refusal message must *not* promise "Amend"). The only working correction path is Report Hub → withdraw → re-sign (`lib/reportSignatureWithdrawal.ts:113`), which reopens the same row.

**Signature reality.** Legacy signature = `signatureId` (a row in a staff CRUD table `signatures`), `signedByName`, `signedAt` — **names, no crypto**. Structured signature = `audit.signature{signed_by, signed_role, signed_by_id, signed_at, signed_content_sha256, audit_log_ref}` over `content_sha256 = SHA-256(JCS(doc))` (`lib/structuredReport/hash.ts:6,40-41`), verified by recomputation at `performStructuredVerify:667`. That is **tamper-evidence, not a signature**: symmetric, and recomputable by anyone who can write the JSON and rehash. A third party holding the PDF can verify nothing but signer names, dates, and a QR of the clinic's own token URL (`:200-213`). `signature_id` has no FK, and `signaturesRouter` allows delete (`:1249-1300`), orphaning it while `signedByName` survives as free text (**L-4**, attribution can be quietly rewritten).

**PDF and print.** One generator for both: HTML from `buildReportArtifact:3043` → `/print` (HTML + auto-print, `:3380-3408`) → `/pdf` renders **the same HTML through headless Chromium** (`lib/htmlToPdf.ts:14-22`). **No PDF is stored** — no column, no object-storage write; only `radiology_report_attachments.filePath` on disk, plus an Encapsulated-PDF DICOM series pushed to Orthanc at finalize (`lib/pacsArchive.ts:174-229`, **USG only**, fire-and-forget `import().then()` `:1360`). Re-rendering a released report is therefore **not reproducible**: footer says `Generated ${new Date()…}` (`:3330`) and the QR token rotates on a 72 h TTL (`:153,166`). If Playwright/Chromium is missing in the api image, **every PDF is a 500** — unconfirmed from here.

**Delivery channels**

| Channel | Trigger | Retry | Fetch authorisation |
|---|---|---|---|
| WhatsApp share | manual `POST /:id/share:3514` | `wa_outbox` backoff + dead-letter (`WhatsAppOutbox.ts:309-325`) | token link |
| WhatsApp auto | on `verify` if `whatsapp_settings.autoSendOnVerify` (`:2678-2753`) | outbox | token |
| "Report ready" (HOPE referral) | `reconcileResults` cron | outbox idempotency key | token |
| **Email** | `/share` sends link/HTML — **no PDF despite an `attachPdf` option**; also `/api/report-delivery/send` | **none** (`/retry/:id` only logs) | token |
| **`/api/report-delivery/send` WhatsApp** | manual | — | **provider is a `"MANUAL"` placeholder that never sends** (`reportDelivery.ts:141-149`, verified: `?? "MANUAL"` → `status="pending"`, note "manual copy required") |
| Print | `GET /:id/print` | n/a | staff `/reports` |
| Patient portal | `GET /api/patient/my-reports`, `POST /reports/:id/link` | n/a | **phone number as identity** (`patientPortal.ts:319-395`) |
| Public link / QR | minted per request | — | `GET /api/p/r/:token/pdf` — **no staff auth** (`routes/index.ts:307`), 24-byte token, 72 h expiry |
| Doctor/telerad link | share insert `:2717` | — | `radiology_share_links` token |
| HOPE workstation | CARE outbox → `diagnostic_orders` | outbox | HOPE session |
| PACS archive | on finalize | job `radiology_pacs_rearchive` | staff |

**L-5 (P1) — horizontal access.** `/api/patient-reports/:id/**` is protected only by `requireStaffAuth` + `requireStaffPermission("/reports")` (`routes/index.ts:1006-1010`, verified — the comment there says this restriction is deliberate and matches other clinical modules). `GET /:id` (`:1396`) has **no patient, entity, branch or study predicate**: `where(eq(patientReportsTable.id, id))` and then a `report_shares` select. Any staff account with the `/reports` permission can enumerate integer ids and read another branch's or another entity's PHI, including the share history. The **public token route is genuinely unguessable**; the staff route is the weak one.

**Critical-value notification.** The detector that gates signing is **browser-only**: `detectCriticalFindings` (`diagnostic-erp/src/lib/criticalResults.ts:217`, curated phrase list) called at `useStudyFinalize.ts:252`. With `ff_radiology_critical_result_comms` **off** (registry default false, `lib/radiologyFeatureFlagRegistry.ts:194`), `gatedCriticalHits=[]` and `criticalMarked=false` (`:255`) — **the report is signed and delivered with `is_critical=false` even though the UI just detected "acute infarct"**. A server-side keyword scan exists only on the legacy prelim route (`lib/criticalFindingsAlert.ts:116-142`, called `routes/radiology.ts:2338`) over a different table. Notification via `/api/radiology-workflow/critical-alerts/:id/notify` is **record-only — nothing is sent** (`routes/radiologyWorkflow.ts:435-464`). The only real automatic channel is `diagnostic_result.critical` → HOPE queue + escalation (`criticalEscalation.ts:66-88`, 30 min ×3). An amendment inherits `isCritical` (`:1821`) but creates **no** new critical event (`external_result_links` uniqueness blocks re-emit, `resultsEmitter.ts:172`). Acknowledgement can be self-issued by the signing radiologist in the same click (`useStudyFinalize.ts:520`).

**Authoritative system:** **CARE** owns the released report (`patient_reports` + `status` gates the token PDF). HOPE holds a copy (`patient_documents`, sha256-deduped) and is **explicitly never mutated on amendment** (`careCallback.ts:171-174`) — so after any correction, HOPE's stored PDF is stale by design, with no delete propagation.

## 5.6 Twenty-step walkthrough — MRI lumbar spine

| # | Step | Implementation | Missing / observed |
|---|---|---|---|
| 1 | Arrival, registration | `POST /api/patients` (`patients.ts:135`), UHID `P-#####` from a sequence | dedup only phone+name within 5 min; **no ABDM** on this path |
| 2 | Visit | **no visit table** — the `orders` row *is* the visit (`orders.ts:8`, `ORD-YYYYMM-####`) | terminology mismatch |
| 3 | Test selected | `diagnostic_tests` (`tests.ts:5`), `department` free-text drives modality | pricing snapshot per line |
| 4 | Order line | `order_tests` (`orders.ts:37`) with FKs | |
| 5 | Bill | `bills.ts:712-1108` in one tx; tax 0; discounts applied | B-10 |
| 6 | Payment | cash/UPI inline, or gateway session (`:3305-3408`) | B-2, B-3 |
| 7 | Settlement | webhook / callback / poll, `settleBill` | **B-5**: the missed-webhook sweep cannot match its own refs |
| 8 | Study created | **async fan-out** `radiology.ts:137-227`, accession `ACC-YYYYMMDD-MOD-NNN` by racy `MAX+1`+retry | failure is silent; compensated by a 15-min sweep |
| 9 | MWL published | `.wl` file → Orthanc DIMSE | **(0040,0001) empty for MRI** → console-specific; no accession ⇒ silent no-op |
| 10 | Scan performed | MRI scanner, UIH | **not verifiable** from code; `172.16.1.x` unroutable here |
| 11 | DICOM transfer | C-STORE to `ORTHANC2` (push) **or** puller C-MOVE (5 min, 1-day window) | both possible; puller dest AE inconsistent (`CONQUESTPACS` default) |
| 12 | Archive | Orthanc + PG index | **unauthenticated on LAN**; AE not checked |
| 13 | ERP learns | `care-erp-sync` → `POST /api/internal/radiology/studies` | single sidecar; cursor loss replays; intake 500 = permanent drop; **which Orthanc it points at is ARCH-01** |
| 14 | Worklist appears | `radiology_worklist` row, `STUDY_RECEIVED` | `study_id` NULL unless matched; no bill/payment gate; **phantom `ORTHANC_ONLY` rows are injected into the list** (`radiology.ts:747-769`) |
| 15 | Images viewed | OHIF via one of **4** launch builders | allowlist empty by default ⇒ bridge replies dropped; D2 not deployed |
| 16 | Observations entered | Quick Select tiles + canonical ledger + free text | tile side/severity start unset (#877); demography edits not persisted |
| 17 | AI draft | Composer job → Local Ollama → tracked changes `PENDING` | **Local/LAN mode must be ON**; `qwen3-vl:8b` default answers `empty_model_response`; cloud arm unreachable |
| 18 | Refine | `/polish` | **no UI caller** (copilot panel never imported); context truncated to 1,200 chars |
| 19 | Save draft | 1 POST, 30 s autosave, CAS baseline (#906) | "Save & leave" double-saves |
| 20 | Finalize | sign dialog → quality gate → `finalizeReport` | **L-1**: structured row lands `draft`; **L-5**: any `/reports` staff can read it by id; **critical flag off** |
| 21 | PDF | headless Chromium on the print HTML | never stored; not reproducible; depends on Chromium presence |
| 22 | Deliver | WhatsApp/email/portal/HOPE | email has no PDF; `/report-delivery/send` WhatsApp is a placeholder; HOPE copy goes stale on amendment |

**Shortest reliable workflow to aim for** (no new screens): register → bill (or emergency) → study row with accession → MWL with the scanner's real AE title → C-STORE → worklist row **matched to the bill by accession** → open OHIF → one click "Draft from images" → review tracked changes → sign → auto-deliver. The distance between that and today is: B-5/B-1 (money trust), ARCH-01 + MWL AE (arrival trust), identity matching (§5.3, reporting trust), L-1/L-2/L-3 (release trust), and the 8 gated assistance regions in `RADIOLOGY-WORKSPACE-AUDIT.md` (time).
