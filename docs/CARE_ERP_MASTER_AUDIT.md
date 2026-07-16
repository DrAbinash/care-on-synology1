# CARE ERP — Master Platform Audit (Non-Radiology)

**Read-only independent audit at HEAD** (`feature/website-login-redirection`, post PR #115). Scope: the entire CARE ERP **except** the already-frozen Radiology Reporting Platform (audited separately in `docs/reporting-platform/`), which is treated as canonical — verified only at its integration seams. Method: six parallel subsystem explorers over 163 API routes / 169 pages / 137 DB schemas, with every load-bearing finding re-verified against source by the lead auditor. Evidence is `file:line`.

> **One correction made during verification:** an explorer reported "inventory endpoints are fully unauthenticated." This is **false** — `routes/index.ts:317` mounts inventory behind `requireStaffAuth + requireStaffPermission("/inventory")`. The explorer read the router file (no in-file middleware) and missed the mount-level guard. The real, lesser inventory issue is spoofable *attribution* (`performedBy` from request body), not missing *authentication*. This correction is reflected throughout.

---

## 1. Executive summary

CARE ERP is a **genuinely capable, largely well-engineered single-clinic hospital ERP** with several subsystems that are better than typical for this market: the radiology platform (separately frozen), a hash-chained immutable audit log, row-locked concurrency-correct billing, a real lab sample state machine with cryptographic sign→countersign report immutability, a restore-*tested* database backup, and a disciplined public-route security fence. The engineering culture is real: 458 explicit DB indexes, idempotent migrations with a schema verifier, typed shared libraries, and consistent bcrypt-12.

It is **not yet ready for multi-hospital deployment**, and has a **small number of serious, mostly pre-existing risks** that are concentrated — not spread thin. The dominant themes are: (a) **image/DICOM disaster recovery is effectively absent** while the DB is well protected; (b) **two live unauthenticated PHI-leaking public endpoints**; (c) **financial governance that the code contradicts** (unaudited voucher DELETE, mutable paid bills, gutted commission/ledger engines still marked CRITICAL); (d) **multi-tenancy is a facade** (zero `branchId` in 137 schemas); and (e) several modules that are **UI shells over missing engines** (inventory never decrements, HL7 ignores results, payroll ignores attendance, GST is `0`).

None of these require rewriting stable systems. The radiology platform, audit chain, billing concurrency core, and lab report immutability are excellent and must be preserved. The work ahead is **targeted hardening and completing half-built modules**, plus one genuine architectural decision (tenancy) before hospital #2.

## 2. Overall ERP Score: **62 / 100**

Justification: strong core engineering and several best-in-class subsystems (+), pulled down by two live PHI leaks, absent image DR, financial-governance contradictions, and three modules that are non-functional behind a working UI. The score is a production-*capable* single clinic with a serious pre-launch fix list — not a prototype (that would be &lt;40), not multi-hospital-ready (that would need 75+). Weighting: patient-data safety and financial integrity dominate; feature breadth is secondary.

## 3. Module-by-module scorecard

| Module | Score | One-line verdict |
|---|---|---|
| Reception (registration/MRD/search) | 5/10 | Works, but fragmented MRD numbering + no merge tool + broken search count |
| Appointments | 4/10 | A logbook, not a scheduler — no availability, no conflict check, no reminders |
| Queue / Token / Display | 6.5/10 | Production-grade SSE display; dual token tables with double writes |
| Billing | 6.5/10 | Concurrency-correct + audited; no bill immutability, GST absent |
| Accounts / Finance | 4.5/10 | Balanced vouchers, but unaudited voucher DELETE + gutted ledger engines |
| Laboratory | 7/10 | Excellent sample state machine + signed-report immutability; HL7 hollow |
| Inventory | 4/10 | Clean CRUD, but core auto-decrement is dead code; no expiry tracking |
| HR | 5/10 | Careful payroll/advance primitives; no leave/shift; payroll ≠ attendance |
| PACS / Imaging ops | 4/10 | Strong report-archival; ingest broken, image DR absent |
| DevOps / Deployment | 5/10 | Real tested DB restore + idempotent migrations; no rollback, `changeme` default |
| Website / Public site | 6.5/10 | Good write-authz + upload hardening; CSR-only SEO, booking duplicated ×3 |
| Portal / Public APIs | 5/10 | Good session mechanics; two live unauth PHI leaks adjacent |
| Administration | 5/10 | Great audit infra; config unlogged, permission matrix off-repo, tenancy fake |
| Security (cross-cutting) | 6/10 | Solid fundamentals; stored-XSS→token-theft, audit gaps |

## 4. Reception audit

Registration, search, bulk CSV import, and a batched history view exist and work for the happy path. **Three structural defects:**
- **MRD numbering is fragmented** — front desk mints `P-00001` (`patients.ts:60`, advisory-lock + full `LIKE 'P-%'` scan), while online/self/kiosk mint `P00001` (`online-bookings.ts:37`, `patientCounterTable`). **Two formats, two independent counters sharing no source of truth** — the numeric cores collide across channels, differentiated only by a hyphen. Confirmed at both call sites. A data-model defect touching every patient/bill/token.
- **`pg_advisory_lock` is defeated by connection pooling** — acquire and release run as separate `db.execute` calls on possibly-different pooled connections (`patients.ts:44-73`); the lock leaks and does not serialize. The comment claims it's fixed; the pooling model contradicts it.
- **No merge workflow** (repo-wide grep: only radiology/backup hits) and **no inline "returning patient?" lookup** at registration — server dedup is a 5-minute identical-name+phone window only, so last week's patient is silently re-created. Search pagination is broken: the `count(*)` has no `where` (`patients.ts:96-99`), so searches paginate into empty pages. Leading-wildcard `ILIKE` on 4 columns is non-SARGable (fine at 5k, degrades at 100k+).

## 5. Appointment audit

Thin CRUD with sensible filters and counter-based IDs, but **not a scheduling system**: `timeSlot` is a free-text string with **no doctor-availability model and no double-booking prevention** (grep for availability in the path is empty); **no appointment reminders** (the only SMS is a Razorpay payment nudge); `emergency`/`walk-in` are cosmetic dropdown labels with no priority effect; reschedule is a bare `PATCH` with no history/notification; and the mount uses only `requireStaffAuth` (no sub-permission), so any staffer can delete any appointment. `/stats` is an in-JS O(n) scan.

## 6. Billing audit

**The concurrency core is genuinely strong** — refund/payment/settle all use `SELECT … FOR UPDATE` in a transaction (the concurrent-payment race is closed), `totalAmount` is never mutated on refund, discount reasons are mandatory with server-side per-role ceilings, and multi-path settlement (manual/gateway/redirect/reconcile) converges idempotently. **Weaknesses:** no immutability on paid bills (`bills.ts:758`, `super-edit:1364` rewrite subtotal/tax on any bill); closed periods only *warn* on backdated refunds; auto-voucher failures are swallowed (`auto-voucher.ts:181` + caller `.catch(()=>{})`) so a payment can succeed with no ledger entry under &gt;3 concurrent inserts; refund math is re-derived in ≥4 places with drifting thresholds (`≤0` vs `≤0.01`); and **GST is absent** — `taxAmount = 0` hardcoded (`bills.ts:549`, confirmed), no CGST/SGST split, no HSN/SAC, no GST-payable account. For an exempt diagnostics business this may be scoped-out, but governance docs imply tax handling the code never performs.

## 7. Laboratory audit

**The strongest non-radiology module.** A real sample state machine (`pending→collected→received→in_processing→completed→reported/rejected`) with enforced transitions, mandatory rejection reasons, and race-safe barcode allocation. Report finalization is **cryptographically sound**: sign→countersign where verifier must differ from signer, SHA-256 content verified before countersign, signed documents immutable (amendment-only). Outsourced-labs is a complete subsystem (rate cards, settlement, profitability). **Gaps:** HL7/LIS is a **message logger** that parses only PID-3/OBR-3 and **ignores OBX result segments** (`hl7.ts:159-196`) — "LIS integration" is not backed by result ingestion; there is **no discrete analyte result entry with reference ranges** (only imaging has measured values); abnormal-findings is a dictionary lookup, not a critical/panic-value acknowledgment workflow; general-lab TAT tracking is radiology-only; order-number generation uses `count(*)+1` (collision-prone).

## 8. PACS audit

**Report-archival is the strongest part** (per-revision success/failure tracking, retry, full audit in `pacsArchive.ts`), and the stall watchdog is thoughtful. But **core ingest is broken/unfinished**: Orthanc→ERP auto-push doesn't exist (no `OnStoredInstance` hook); the Conquest hook ships with placeholder credentials (`conquest/erp_notify.lua:34` = `REPLACE_WITH_YOUR_INTERNAL_API_KEY`); studies only reach the ERP via an **opt-in** 5-min pull agent (`ENABLE_DICOM_PULL_AGENT`); and "Test Connection" runs a bare TCP probe because DCMTK isn't installed — **C-ECHO health is a lie** (green when the association may be dead). Orthanc/Conquest containers are **referenced but not defined in `docker-compose.yml`** — unmanaged, out of version control.

## 9. Website audit

Good write-side authorization (raw-HTML fields admin-role-gated at the API), well-defended tracking-ID injection (GTM/GA/Pixel regex-validated before inline-script interpolation), and clean, hardened uploads (MIME whitelist, 25 MB cap, filename sanitization, traversal guards). **Weaknesses:** SEO is **client-side-only** (CSR SPA, meta set in `useEffect` — crawlers without JS see an empty shell; no `sitemap.xml`/`robots.txt`), and the **booking flow is triplicated** across `clinic-site`, an Expo mobile app (`diagno-booking-mobile`), and the kiosk — same shared backend, three UIs, so every booking-side fix must be made three times. Dead code: `reportDelivery.ts` handlers lack auth but are **not mounted** (delete to prevent accidental future exposure).

## 10. HR audit

Financially careful primitives: atomic biometric attendance (`UNIQUE(staff_id,date)`), FIFO advance recovery with over-deduction capping, row-locked onboarding→salary approval. **But payroll does not compute from attendance** — `daysPresent`/`baseAmount` are manual body inputs, forcing error-prone transcription between two disconnected silos. **Missing entirely:** leave management, shift planning (a free-text field only), incentives (commission is a 1-line stub), department permissions, and any termination/exit workflow.

## 11. Inventory audit

Clean item/vendor CRUD, transactional stock-in with unit cost, low-stock alerts, and an audited transaction ledger — **all correctly authenticated** (mount-level `requireStaffAuth + requireStaffPermission`, per the correction above). **But the module's central promise is dead code:** consumption rules are defined (`inventory.ts:287-437`) yet `inventoryConsumptionRulesTable` has **zero consumers repo-wide** (confirmed) — **nothing decrements stock when a test runs**, so balances drift to fiction. **Expiry/batch tracking is entirely absent** from the schema (`inventory.ts:7-19`) — reagent-expiry alerts are impossible. Residual real issue: `performedBy` attribution comes from the request body, not the session, so the audit trail is spoofable even though the endpoint is authenticated. No purchase-order/approval workflow.

## 12. Accounts audit

Double-entry vouchers are structurally zero-sum and a books-sanity scanner exists — good. **But the "append-only, protected ledger" that `FINANCIAL_FREEZE_RULEBOOK.md` promises is contradicted by code:** `DELETE /vouchers/:id` (`accounting.ts:329`, confirmed) is a **hard delete with no reason and no audit row** — a posted ledger line vanishes without trace, on the same coarse `/accounting` permission as read; `PATCH /vouchers/:id` edits in place (not reversal); auto-voucher failures are silently swallowed (payment without ledger entry possible); `POST /ledgers/:id/reset` is a bulk financial-data wipe (super-admin+reason-gated, but destroys audit trails); and the **commission + doctor-ledger engines are 1-line stubs** ("moved to USB plugin", confirmed) while governance still lists them CRITICAL — a whole protected subsystem is absent from the repo.

## 13. Administration audit

Strong hash-chained immutable audit **infrastructure** (SHA-256 chain, advisory-lock fork prevention, pure verifier) and a coherent settings-permission scheme. **But:** audit *coverage* has holes — discounts, patients (PHI), feature flags, email/SMTP settings, branches, departments, and backups write **zero** audit rows; the real role→permission matrix lives in an **off-repo USB plugin** (`role-permissions.ts` is a stub) and is therefore unauditable; and notification (email + **two** WhatsApp stacks + reportDelivery), dashboard (3 overlapping), and settings (5+ surfaces) layers are triplicated with no unifying abstraction.

## 14. Security audit

**Fundamentals are solid:** bcrypt-12, server-side session revalidation with immediate revocation, layered brute-force lockout + IP rate limiting, HMAC-verified ICICI/Razorpay/PayU webhooks, effectively **zero SQL-injection surface** (all 276 `sql\`\`` uses are bound parameters), disciplined public-route fence. Ranked findings:

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **CRITICAL** | Two live **unauthenticated PHI leaks**: `/public/booking/my-bookings` (phone-only) and `/public/booking/by-ref` (24-bit ref, no rate limit) return full booking rows incl. payment txn IDs | `public-booking.ts:290, 257`; mounted no-auth `index.ts:230` |
| 2 | **HIGH** | **Stored-XSS → session-token theft**: 5 `dangerouslySetInnerHTML` sinks, **DOMPurify absent** (grep=0), staff Bearer token in `localStorage` | `fetchApi.ts:6`; sinks incl. `FormF.tsx:139`, `VerifyReceipt.tsx:103` |
| 3 | **HIGH** | **Unaudited hard-DELETE of ledger vouchers** destroys double-entry records with no trace | `accounting.ts:329` |
| 4 | **HIGH** | **Payment amount tampering**: client `totalAmount` never recomputed server-side from whitelisted test prices before gateway order | `public-booking.ts:540/728/891/1134/1487/1637` |
| 5 | **HIGH** | **HDFC webhook signature omits amount** + no replay protection → tampered settlement (ICICI is correct) | `gateway-webhooks.ts:71-78` (confirmed) |
| 6 | MEDIUM | Sensitive-action audit gaps (discounts, PHI, all admin config); fire-and-forget audit can drop rows silently | `discounts.ts`/`patients.ts` audit refs = 0 |
| 7 | MEDIUM | Super-admins exempt from brute-force lockout; PIN (not password) credential | `portal.ts:364,375` |
| 8 | MEDIUM | Patient portal login defaults to phone + DOB (PIN optional) | `portal.ts:277-307` |
| 9 | MEDIUM | Broken OTP presented as a control (`send-otp` echoes code, no SMS delivery) | `public-booking.ts:1589` |
| 10 | LOW-MED | `changeme` default DB password live in compose; plaintext bearer tokens in DB dumps | `docker-compose.yml:48…`; `DEPLOYMENT.md:389` |

## 15. Operations audit

Real strengths: idempotent migrations + schema verifier with `api` now gated on `service_completed_successfully`, and a **genuinely restore-tested** DB backup harness. **Risks:** deploy runs `git reset --hard` **off a feature branch** with **no rollback** and **no pre-migration DB snapshot**; `SCHEMA_VERIFY_STRICT` defaults off; alerting is **email-only, co-located with the monitored `care-api`** (if it dies, no alert fires); the container healthcheck is liveness-only (a dead-DB container reads "healthy"); and `care-api` is a **universal SPOF** hosting web + all cron + alerting.

## 16. AI readiness audit

**No architectural blocker.** There is a proper `AiProvider` abstraction (`lib/ai-providers`, 15 consumers) with built-in provider configs, already used **beyond radiology** (expenses, echo-cardiology, fetal USG). Any module can integrate AI by shaping a request to that interface. The one caveat is data governance: PHI-bearing prompts to external providers need a documented boundary (the radiology platform already treats AI as advisory-only with provenance — the pattern to extend). AI-readiness is a per-module API-shape task, not an infrastructure gap.

## 17. Performance audit

Good indexing culture (458 explicit indexes). Current-volume hotspots: N+1 on order list (~60 round-trips/page), in-JS `/stats` scans (appointments), non-SARGable patient search, `count(*)`-based sequence generation (orders, vouchers) that both collides *and* scans. The DB pool uses **defaults** (`new Pool({connectionString})`, no `max`, no PgBouncer) — fine now, a bottleneck at 500 concurrent users.

## 18. Scalability audit (100 hospitals / 500 users / 10M patients / 100M reports)

**Cannot scale as-is, for one decisive reason: it is single-tenant.** Zero `branchId`/`tenantId` columns across 137 schemas (confirmed); a single `clinic_settings` row is assumed everywhere. 100 hospitals = a schema-wide tenancy retrofit touching every table and query — greenfield-level work, not a toggle. Beyond tenancy: `count(*)+1` sequences, leading-wildcard search, and unpooled connections all break well before 10M patients; append-only quality/audit tables need a retention/partition policy before 100M reports; and image storage (already un-backed-up) has no object-store/S3 tier. **The radiology platform itself is proven modality-scalable; the ERP substrate around it is not hospital-scalable.**

## 19. Technical debt

Highest-interest debt: (1) tenancy absence; (2) three modules that are UI-over-missing-engine (inventory decrement, HL7 results, payroll-from-attendance); (3) financial governance docs describing code that doesn't exist (commission/ledger stubs, GST, bill immutability); (4) dual token tables + double writes; (5) off-repo permission plugin making authz unauditable; (6) one dead package (`lib/api-spec`, 0 consumers) and dead unmounted `reportDelivery.ts`.

## 20. Remaining duplication

- **Booking UIs ×3** (clinic-site / Expo mobile / kiosk) over one backend.
- **Token systems ×2** (`tokensTable` + `testTokensTable`, both written per registration; `/api/tokens/today` appears orphaned).
- **WhatsApp stacks ×2** (`whatsapp.ts` + `waChatbot.ts`), separate webhooks.
- **Dashboards ×3** (daily-summary / advanced-dashboard / my-daily-summary) + settings surfaces ×5.
- Refund math re-derived in ≥4 places. Consolidate only where drift is a real risk (refund math, tokens) — the dashboards/booking-UIs are intentional and lower priority.

## 21. Legacy systems

Off-repo USB super-admin plugin (permission matrix, commission, doctor-ledger — live dependency, unauditable here); dormant D1 structured-report layer and YAML content pipeline (radiology-adjacent, zero consumers); legacy USG finalize path (guarded, retire on telemetry); Replit-era backup scripts pointing at cloud URLs while deployment is on-prem (stale, confusing). None safe to delete without caller/data proof — except the clearly-dead `lib/api-spec` and unmounted `reportDelivery.ts`.

## 22. Integration issues

- **Reception→Billing→Radiology is well-integrated** — bill save fans out radiology studies idempotently (`radiology_studies_order_test_uq`) with tokens in-response. This hop is genuinely automated.
- **Billing→Lab is NOT** — no discrete lab result ingestion; HL7 drops OBX.
- **Billing→Accounts** is integrated but lossy (swallowed voucher failures).
- **Attendance→Payroll** and **Orders→Inventory** are disconnected silos.
- **PACS→ERP** relies on an opt-in pull; push is broken.

## 23. Clinical workflow issues

The patient journey (Reception → Billing → Radiology → Report → Accounts) is smooth on the imaging path and automated at the billing hop. Friction concentrates at the **pathology-lab** path (no discrete results, hollow HL7), **reception** (duplicate patients with no merge, two MRD formats on printed slips), and **appointments** (no availability, so double-booking and no reminders create no-shows and desk conflicts). Manual work that should be automated: payroll from attendance, stock decrement from test volume, appointment reminders.

## 24. Human factors review

- **Receptionist:** search-then-register (no inline dedup) → duplicates they can't later merge; two visually different MRD formats; the queue/TV side is excellent (real-time, privacy-masked, per-room).
- **Technician:** great barcode + state-machine UX; undercut by no discrete result entry for pathology.
- **Radiologist:** served by the frozen platform (excellent).
- **Billing:** strong receipt/token flow; refund/discount governance protects them.
- **HR admin:** careful advance handling; payroll transcription is drudgery.
- **Administrator/Owner:** good dashboards but config changes leave no audit trail; "multi-branch" screen implies capability that isn't there.

## 25. Immediate fixes (0–2 days)

1. **Gate `my-bookings` + `by-ref`** behind the existing report-token pattern (or OTP that actually sends). Close the two PHI leaks. *(Security #1)*
2. **Add an audit row + reason to voucher edit; convert DELETE to a reversing entry** (or block it). *(Security #3)*
3. **Recompute booking `amount` server-side** from whitelisted test/package prices. *(Security #4)*
4. **Include amount in the HDFC signature** (mirror the ICICI implementation). *(Security #5)*
5. **Fail-fast the DB password** (`${DB_PASSWORD:?}`) and rotate off `changeme`.
6. **Fix the image backup command** in `BACKUP.md` (it tars the DB dir, not object storage) and script an Orthanc/Conquest store dump.
7. **Fix the search `count(*)`** to honor the `where` clause (Reception pagination).

## 26. High-value improvements (weeks)

Sanitize all `dangerouslySetInnerHTML` with DOMPurify (or move report HTML rendering to a sandboxed iframe) and move the staff token to an httpOnly cookie; unify the two token tables; wire inventory consumption rules to decrement on order completion + add expiry/batch fields; derive payroll from attendance; add appointment availability + double-booking prevention + a reminder cron; add audit rows to discounts/patients/admin-config; add a patient-merge tool; add PgBouncer + a `max` pool bound; implement C-ECHO with DCMTK (or stop showing green).

## 27. Long-term roadmap

Tenancy (`branchId` retrofit) before hospital #2; an object-store tier (S3/MinIO) with real image DR + off-site replication; move cron/alerting off the API SPOF (separate worker + a dead-man's-switch on an external monitor); GST engine if any GST-liable service is billed; complete HL7 (OBX ingestion) + discrete lab results with reference ranges; retire the off-repo permission plugin into an auditable in-repo model; deploy from tagged releases with rollback + pre-migration snapshots.

## 28. Final recommendation

**Ship the single clinic after the §25 immediate fixes; do not onboard a second hospital until tenancy and image DR are built.** The core is sound and several subsystems are excellent — invest in *completing* the half-built modules and *hardening* the public/financial edges, not rewriting. Preserve the radiology platform, audit chain, billing concurrency core, and lab report immutability untouched.

---

## Final questions — explicit answers

1. **Ready for multi-hospital deployment?** **No.** Single-tenant (zero `branchId` in 137 schemas) + absent image DR. Multi-hospital is a schema-wide retrofit, not a config change.
2. **Maintainable for 10 years?** **Yes, conditionally.** Clean shared-lib layering, typed contracts, strong migration discipline and audit infra make it maintainable — *if* the off-repo permission plugin is brought in-repo and the UI-over-missing-engine modules are either completed or removed (dead code rots trust).
3. **Highest-priority module next?** **Public booking / portal security** — it has live, unauthenticated PHI exposure. Patient data safety outranks everything.
4. **Technically weakest module?** **PACS ingest + image DR** (4/10) — broken auto-push, faked C-ECHO, and no image backup is an operational and medico-legal exposure. (Inventory ties on functionality, but images are irreplaceable.)
5. **Highest ROI for improvement?** **Appointments** — small, well-scoped work (availability model + reminder cron) that directly reduces no-shows and desk conflicts, i.e. revenue and daily friction, at low engineering cost.
6. **Highest operational risk?** **Image/DICOM disaster recovery** — a NAS/volume loss loses all source images with no backup. Irreversible.
7. **Highest security risk?** **The two unauthenticated public-booking PHI endpoints** (`my-bookings` + `by-ref`) — live, trivially exploitable, leaking identity + payment identifiers.
8. **Which module would you redesign today?** **The multi-tenancy/branch model** — retrofitting tenancy later is far costlier than designing it now; and **inventory** (rebuild around event-driven decrement + batch/expiry from the start).
9. **Outstanding architectural decisions?** Tenancy model (row-level `branchId` vs DB-per-tenant); object-storage tier + image DR strategy; whether to bring the permission/commission plugin in-repo; session-token transport (cookie vs localStorage); notification-layer unification.
10. **Decisions that must NEVER change?** The hash-chained immutable audit log; row-locked transactional billing with never-mutated totals; cryptographic lab sign→countersign report immutability; the frozen radiology platform's one-engine-per-concern invariants; the disciplined public-route auth fence; HMAC webhook verification.
11. **Top 20 recommendations for the next year:** (1) close both PHI leaks; (2) audit+reverse voucher deletes; (3) server-side booking amount; (4) sign HDFC amount; (5) DB-password fail-fast; (6) fix image backup + script Orthanc DR; (7) sanitize XSS sinks + httpOnly token; (8) fix Reception search count + advisory-lock; (9) unify MRD numbering to one counter/format; (10) patient-merge tool; (11) wire inventory decrement + expiry; (12) payroll-from-attendance; (13) appointment availability + reminders; (14) audit discounts/PHI/admin-config; (15) unify token tables; (16) PgBouncer + pool bounds; (17) deploy from tags + rollback + pre-migration snapshot; (18) move cron/alerting off the API SPOF + external dead-man's-switch; (19) complete HL7 OBX + discrete lab results; (20) design the `branchId` tenancy model.
12. **Overall score /100:** **62.** A production-capable single clinic with best-in-class subsystems (radiology, audit chain, billing concurrency, lab immutability) held back by two live PHI leaks, absent image DR, financial-governance contradictions, three non-functional modules behind working UIs, and no real tenancy. Fixable without rewrites — but not yet multi-hospital, and not shippable to the public internet until §25 lands.

---

### Honesty notes
- One explorer finding (inventory "unauthenticated") was **wrong and is corrected here** — inventory is mount-authenticated; the real issue is spoofable attribution. Cross-verification caught it.
- The radiology platform was **not** re-audited (frozen); only its integration seams were checked and are healthy.
- Findings behind the off-repo USB permission plugin (authz correctness for `/admin/*`, commission, doctor-ledger) **cannot be fully verified from this repo** and are flagged as such rather than asserted.
- Scores are engineering judgments with `file:line` evidence, not measured telemetry.
