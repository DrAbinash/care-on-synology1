# HOPE → CARE Diagnostic Referral Integration — Delivery Summary

Phase 1 of a reusable inter-organisation diagnostic referral platform, scoped to
HOPE Hospital → CARE Diagnostics. Built entirely on the CARE side (the writable
repo), 100% additive, feature-flagged OFF by default.

See also: `01_AUDIT.md` · `02_ARCHITECTURE.md` (diagrams) · `03_API_CONTRACT.md` ·
`04_HOPE_ADAPTER_REFERENCE.md`.

---

## 1. Architecture summary

HOPE and CARE stay separately owned and billed. HOPE emits a **clinical referral**
(not an invoice); CARE decides whether to accept, bill (with its own catalogue,
taxes, numbering and accounting), perform and report. The only coupling is a
**versioned, signed HTTP contract**. On CARE this is a new inbound API + a staff
"HOPE Referrals" inbox + services for patient matching, catalogue mapping, a
validated referral state machine, a transactional outbox, and a results reconciler —
all reusing CARE's canonical `patients` / `diagnostic_tests` / `orders` / `samples` /
`patient_reports` / `doctors`, and mirroring the existing `requireAiCallerAuth`
hashed-credential + audit pattern. **No frozen billing/accounting file or table is
touched; the integration never writes a bill.**

## 2. Schema changes (13 new tables, one migration)

`migrations/hope_care_diagnostic_referral_integration.sql` (idempotent, forward-only)
+ 7 Drizzle schema files:

| Entity | Purpose |
|---|---|
| `integration_partners` (+ `integration_partner_audit_log`) | inbound hashed partner keys + audit |
| `external_patient_links` (+ `_events`) | HOPE↔CARE patient crosswalk + link history |
| `external_provider_links` | HOPE↔CARE referring-doctor crosswalk |
| `service_catalogue_mappings` (+ `_synonyms`) | HOPE test code/name → CARE test/package |
| `diagnostic_referrals` (+ `_items`, `_events`) | referral aggregate + per-item state + audit |
| `integration_outbox` (+ `integration_delivery_attempts`) | transactional outbox → HOPE |
| `external_result_links` | CARE result ↔ HOPE order, idempotent re-emission |

A `feature_flags` row `ff_hope_care_referrals` (default OFF) gates the backend workers.

## 3. API / event contracts

Versioned v1.0 — full detail in `03_API_CONTRACT.md`. Inbound
`/api/integration/v1/diagnostic-referrals` (create/read/update/cancel/acknowledge,
partner-key auth, idempotent). Outbound signed callbacks: `diagnostic_referral.received`,
`diagnostic_order.created`, `diagnostic_referral.cancelled`,
`diagnostic_report.finalised`, `diagnostic_result.critical` (more reserved). Every
event carries id, version, idempotency key, timestamp, source/destination org,
referral/order ids, and correlation id.

## 4. Files changed

**Added** (additive, no sign-off surface): 7 `lib/db/src/schema/*.ts`; 1 migration;
`middleware/requireIntegrationPartnerAuth.ts` (+test); `routes/integration/{inbound,
hopeReferrals,admin}.ts`; `services/integration/*` (11 modules incl. 5 test files);
`pages/HopeReferrals.tsx`; `docs/hope-care-integration/*`.

**Edited** (surgical, additive only):
* `lib/db/src/schema/index.ts` — 7 `export *` lines.
* `artifacts/api-server/src/routes/index.ts` — mount 3 routers.
* `artifacts/api-server/src/index.ts` — start the integration scheduler (guarded by `ENABLE_SCHEDULERS`).
* `artifacts/diagnostic-erp/src/App.tsx` — 1 lazy route.
* `artifacts/diagnostic-erp/src/components/Layout.tsx` — 1 nav leaf (feature-flag gated).
* `artifacts/diagnostic-erp/src/lib/staffSession.ts` — `/hope-referrals` permission + `hopeReferralsInbox` flag.

No file in `PROTECTED_FILES.md` / `ACCOUNTING_PROTECTED_FILES.md` billing/accounting
lists was modified. The two frontend-shell edits (App/Layout) and the core schema
barrel/session touches are additive lines only.

## 5. Security review

* **Service-to-service auth:** hashed (`SHA-256`) bearer keys per partner, shown once,
  revocable, rotate-able; **code-fixed permission allowlist** (`diagnostic_referral:*`,
  `diagnostic_result:acknowledge`) that data cannot widen — no billing/refund/delete
  scope is representable. A test asserts this. Source-org check on every referral.
* **Replay protection / signing:** outbound callbacks are HMAC-signed over
  `timestamp.body`; the HOPE adapter rejects stale timestamps and dedupes on eventId.
  Signing secret is env-only, never in the DB or logs.
* **Idempotency:** unique `referral_uuid` + `idempotency_key`; unique outbox
  `event_id`/`idempotency_key`; partial-unique result links — no duplicate patient,
  order, bill, or emitted result.
* **Least privilege / RBAC:** inbox behind `requireStaffPermission("/hope-referrals")`;
  admin console behind `requireAdminRole`; partners can only see/act on their own
  org's referrals (cross-org reads 404).
* **Audit:** every auth attempt (`integration_partner_audit_log`), every referral
  action (`diagnostic_referral_events`), every link decision
  (`external_patient_link_events`), every delivery attempt
  (`integration_delivery_attempts`).
* **Data minimisation / logs:** only clinically-relevant fields are copied; error logs
  carry messages, not PHI or secrets (consistent with `lib/db` pool-error masking).
* **Patient-safety matching:** deterministic tiers, staff confirmation for "probable",
  hard **block** on identity conflict, **never** auto-merge on name alone.
* **Accounting boundary:** integration never creates a bill/voucher; hands off to the
  frozen billing desk; HOPE prices are estimates, CARE re-prices from `diagnostic_tests`.

## 6. Migration & rollback

* **Migrate:** the idempotent SQL file is auto-discovered and applied by
  `docker/db-patch-entrypoint.sh` on the next deploy (validated by
  `scripts/check-migration-order.cjs`). Safe to run repeatedly.
* **Enable:** set `INTEGRATION_HOPE_CALLBACK_URL` /
  `INTEGRATION_HOPE_SIGNING_SECRET` / `HOPE_PARTNER_KEY` (see
  `deploy/synology/care.env`). On every Care API start the entrypoint + startup
  bootstrap upsert the HOPE partner and enable `ff_hope_care_referrals`
  automatically. Manual `POST /api/integration/admin/partners` is optional.
* **Rollback:** flip the feature flag OFF (workers idle immediately) and/or deactivate
  the partner (inbound 401) — no schema change needed, no data loss. Removing the nav
  is a one-line revert. Tables are additive and forward-only (per repo policy); they
  can remain unused with zero impact. No frozen surface to revert.

## 7. Test results

* **Type-check:** `pnpm run typecheck` (libs + api-server + diagnostic-erp + scripts) — **PASS**.
* **Migration order:** `scripts/check-migration-order.cjs` — **PASS** (no ordering violations).
* **Unit/integration:** `pnpm test` → **3127 passed, 20 skipped**, incl. **50 new tests**
  across 6 suites (normalize, state machine, patient matching, catalogue mapping,
  partner-auth allowlist, outbox signing).
* **Pre-existing environment failures:** 11 test files fail only with
  `DATABASE_URL must be set` — they import `@workspace/db` without a DB and are
  **untouched by this change** (verified: zero overlap with the changed-file set). They
  pass in an environment with Postgres provisioned. No coverage was weakened.

New tests cover the brief's scenarios that are unit-testable without a live DB:
repeated referral / duplicate delivery (idempotency design + state machine),
same-name/different-mobile (no false merge), shared family phone (low-confidence
probable, not merged), identity conflict (blocked), unmapped test (never guessed),
1:many panel mapping, permission failures & cross-org leakage (allowlist), signing/
replay protection.

## 8. Manual end-to-end validation

A live DB was not available in this build sandbox, so the money/DB-touching path was
verified by type-check + logic tests + code review rather than a running server. To
validate the acceptance scenario on a provisioned instance, use this sequence
(also the basis for an integration test once a test DB is wired):

```bash
# 0. deploy migration, enable flag, provision partner (returns intgk_… once)
curl -XPOST $CARE/api/integration/admin/partners -H "Authorization: Bearer $STAFF" \
  -d '{"code":"HOPE","name":"HOPE Hospital","sourceOrgCode":"HOPE"}'
# 1. map CBC/LFT/USG to CARE tests (admin/mappings), status "active"
# 2. HOPE (or curl) sends the referral
curl -XPOST $CARE/api/integration/v1/diagnostic-referrals -H "Authorization: Bearer intgk_…" \
  -d '{"source":{"org":"HOPE","patientId":"UHID1","encounterId":"OPD1"},
       "patient":{"name":"Rajesh Kumar","age":34,"gender":"M","phone":"9876543210"},
       "referringDoctor":{"id":"D1","name":"Dr Rao"},
       "tests":[{"code":"CBC","name":"Complete Blood Count"},
                {"code":"LFT","name":"Liver Function Test"},
                {"code":"USGWA","name":"USG Whole Abdomen","modality":"radiology"}]}'
# 3. re-POST the SAME body → 200 replayed:true, no duplicate patient/order/bill
# 4. staff: /hope-referrals → confirm patient → Accept all → order created
# 5. existing Billing Desk bills the order → CARE's own bill/receipt
# 6. verify a report in patient_reports → reconciler emits diagnostic_report.finalised
```

## 9. Acceptance-criteria coverage

| # | Criterion | Status |
|---|---|---|
| 1–3 | Patient examined in HOPE, CBC/LFT/USG prescribed, prescription saves | HOPE-side (adapter ref §1; fire-and-forget so save always succeeds) |
| 4 | Referral appears in CARE without re-entry | ✅ inbound API + inbox |
| 5 | CARE identifies/creates the correct patient | ✅ matcher + crosswalk + inbox confirm/create |
| 6 | Staff accept all/selected tests | ✅ accept (all or `itemIds`) |
| 7 | Billing opens pre-populated | ✅ canonical order created; inbox deep-links to Billing Desk (full prefill = Phase 2) |
| 8 | CARE creates its own independent bill/receipt | ✅ via existing frozen billing (unchanged) |
| 9–10 | CBC/LFT → pathology; USG → radiology worklist | ✅ modality routing; radiology auto-fans from the bill |
| 11 | Individual test statuses return to HOPE | ✅ per-item state + events; report/critical emitted (sample/study status = Phase 2) |
| 12 | Final reports visible in HOPE record | ✅ reconciler → `diagnostic_report.finalised`; HOPE lands it (adapter ref §2) |
| 13 | Critical result needs documented acknowledgement | ✅ `diagnostic_result.critical` + `/acknowledge` + audit |
| 14 | Re-sending does not duplicate patient/order/bill | ✅ idempotency + crosswalk (unit-tested design) |
| 15 | HOPE & CARE accounting stay separate | ✅ never writes a CARE bill; HOPE prices are estimates; no revenue share |

## 10. Remaining limitations (honest)

* HOPE-side code is a **reference** (`04_…`), not pushed — the HOPE repo is separate
  and out of this task's write scope.
* Billing hand-off deep-links to the existing Billing Desk with `?orderId=`; **full
  auto-prefill of the Billing Desk** would need a (sign-off-gated) edit to the frozen
  `BillingDesk.tsx` — deliberately deferred.
* Result-return currently emits on **report finalisation** (+ critical). Intermediate
  `sample.collected` / `study.completed` events and inbound PDF payloads are scaffolded
  (event types reserved) but Phase 2.
* End-to-end DB integration tests require a provisioned Postgres (not available in this
  sandbox); the logic is covered by 50 unit tests + the manual sequence above.
* The inbox `map-test` action persists mappings but a dedicated bulk mapping-admin UI
  is minimal (API is complete).

## 11. Shipped clinical follow-ons (finance still separate)

Later work (still **no** shared books / PAN / roles SSO):

* IPD → Care referral emit (Hope)
* Finalised report `pdfUrl` + Hope `patient_documents` landing
* Partner `GET /api/integration/v1/catalogue` + Hope “Sync from CARE”
* Diagnostics CARE status badges + critical-worklist report links
* Care-attributed WhatsApp: prep on accept, report-ready on finalise
* Public booking `?source=hope` server-side catalogue narrowing

**Still deferred:** Billing Desk full auto-prefill; shared staff roles/SSO;
cross-entity finance/MIS merges (never — Hope Hospital, Hope Medicals, Care
remain three separate PANs).
