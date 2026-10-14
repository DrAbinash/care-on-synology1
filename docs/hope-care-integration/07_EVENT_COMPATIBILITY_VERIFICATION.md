# HOPE ↔ CARE — Event Compatibility, Verified (I12-F)

_What each side actually accepts today, measured from both repositories rather than from a
design document; what that means for the deployment order; and the three facts that a
repository can never supply, with the command that does._

**Measured 2026-10-15 against** `DrAbinash/care-on-synology1` `origin/main` = `3f044107`
(which contains #1002 as `ff49174a`) and `DrAbinash/hope` `origin/main` = `c2644c7e`
(#191, "CARE callback: an event HOPE cannot interpret is refused, never acknowledged").
**Both are MERGED. Neither is known to be DEPLOYED** — see §6, which is the reason this
document exists.

Every `file:line` below was read from those two trees. Sections are labelled
**VERIFIED IN CODE** (a line proves it), **VERIFIED IN TESTS** (a test in one of the repos
drives it), or **NOT VERIFIED IN PRODUCTION** (it needs the boxes).

---

## 1. The two lists, measured

CARE's emitters, scanned the way the preflight gate scans them
(`node scripts/ops-preflight.mjs` → row `hope.event_contract`; scanner roots
`artifacts/api-server/src/services` + `.../routes`, test files and `eventType ===` readers
excluded):

| file | event types it emits |
|---|---|
| `routes/integration/hopeReferrals.ts` | `diagnostic_order.created`, `diagnostic_referral.cancelled` |
| `services/electronicFilm/hopeEmitter.ts` | `diagnostic_electronic_film.available` |
| `services/integration/criticalEscalation.ts` | `diagnostic_result.escalated` |
| `services/integration/emitReportToHope.ts` | `diagnostic_report.amended`, `diagnostic_report.finalised` |
| `services/integration/referralIngest.ts` | `diagnostic_referral.received` |
| `services/integration/resultsEmitter.ts` | `diagnostic_report.amended`, `diagnostic_report.finalised`, `diagnostic_result.critical` |
| `services/integration/statusReconciler.ts` | `diagnostic_sample.collected`, `diagnostic_study.completed`, `diagnostic_order.item_status_changed` |

**11 distinct types, 7 files.** `diagnostic_referral.status_changed` appears only in a test
fixture and is not an event CARE sends — a list compiled from `grep`s over the whole tree
would have counted it.

HOPE's registry, `artifacts/api-server/src/routes/careCallback.ts:72`
(`SUPPORTED_CARE_EVENT_TYPES`, the single statement of what that build can interpret):

`diagnostic_referral.received`, `diagnostic_order.created`, `diagnostic_referral.cancelled`,
`diagnostic_sample.collected`, `diagnostic_study.completed`, `diagnostic_order.item_status_changed`,
`diagnostic_report.finalised`, `diagnostic_report.amended`, `diagnostic_result.critical`,
`diagnostic_result.escalated` — **10 types**.

| | |
|---|---|
| **Delta** | `diagnostic_electronic_film.available` — emitted by CARE, **not** in HOPE's registry |
| **What happens to it** | refused `422 {ok:false,error:"unsupported_event_type"}`, retained with `processed = 0` (`careCallback.ts:397-413`), and CARE's outbox retries it and then dead-letters it |
| **Is that correct?** | Yes, and it is the fix, not the defect. Before #191 the same event got `200 {ok:true}` with `processed = 1`, so a document CARE believed it had delivered was delivered to nothing (`docs/hope-care-integration/05_ELECTRONIC_FILM_AND_IMAGING_AUDIT.md`, PR #1002). **Films are still not delivered** — refusal only makes that visible. Delivering them needs a HOPE landing leg plus a CARE handler arm, never a re-broadened `default:`. |

The drift guard against re-creating the old bug is structural: HOPE's `switch` ends in
`default:` that **throws**, so a registry entry without a handler arm cannot be merged
quietly. (Recorded from #191: its mutation battery had one intentional survivor — reverting
`default:` to `break` is unkillable because the gate makes that arm unreachable; it is a
next-editor guard, not runtime behaviour.)

## 2. Receiver contract, as HOPE's merged code states it

| situation | HOPE answers | `care_callback_events.processed` | CARE's outbox does |
|---|---|---|---|
| supported type, lands | `200` | `1`, **in the same transaction as the writes** (`careCallback.ts:456`) | `sent` |
| duplicate `event_id`, same payload | `200 {duplicate:true}` | stays `1` | `sent` |
| duplicate `event_id`, different payload | `409` | unchanged | retried, then `dead` |
| HOPE-side transient failure | `500` | `0` | retried with backoff |
| no matching referral (for the referral-required set) | `422 unknown_referral` | `0` | retried, then `dead` |
| **type this build cannot interpret** | `422 unsupported_event_type` | `0` | retried, then `dead` — visible on CARE's Integration Administration |
| **envelope outside major version 1** | `422 unsupported_event_version` (`:426`) | `0` | as above |

`VERIFIED IN CODE` for the answer codes; `VERIFIED IN TESTS` for the durability half — #190
made `processed` the durable flag because the callback used to acknowledge reports it never
stored, and #191's suite went red-first with 9/18 failing on `actual: 200` vs `expected: 422`
before it passed 18/18.

**Deliberately acknowledged as no-ops** (not refused): the pure status mirrors
`diagnostic_sample.collected`, `diagnostic_order.item_status_changed`, `diagnostic_referral.*`,
`diagnostic_study.completed` when there is no matching referral. CARE is the authority for
that state; refusing it would be noise. That is #190's documented decision, inherited by #191,
and it is a *choice*, not an oversight — the referral-required set is reports + `critical` +
`escalated`, because an action event with no referral has no clinician to act on it.

## 3. Signing and callback authentication — `VERIFIED IN CODE`, no change made

Outbound (CARE → HOPE), `artifacts/api-server/src/services/integration/outbox.ts`:

- `signBody()` at `:84` is `HMAC-SHA256(secret, "${timestamp}.${body}")`, hex, sent as
  `x-care-signature: sha256=<hex>` (`:370`).
- The secret comes **only** from the environment:
  `process.env["INTEGRATION_${code}_SIGNING_SECRET"]` (`:104`), surfaced to the container at
  `docker-compose.yml:317`. There is no database copy and no default.
- **Fail-closed, measured at `:336-352`:** with no URL or no secret, CARE does not send. It
  leaves the event `pending` with `lastError: "delivery_not_configured"` and backs off, and
  does *not* dead-letter a configuration gap. An unsigned request therefore cannot leave the
  building.
- The URL is `INTEGRATION_${code}_CALLBACK_URL` **or** the partner row's `callbackUrl`, and
  **env wins** (`outbox.ts:103-106`). That precedence is a trap, not a feature: a live checkout
  whose `.env` names an unreachable callback keeps overriding a corrected admin-screen value. It
  is exactly the condition recorded on this clinic's box (callback URL wrong in `.env` *and* in
  `integration_partners`, with an empty outbox).

Inbound verification (HOPE), `artifacts/api-server/src/middlewares/careCallbackAuth.ts`:

- `:16-18` — with `CARE_CALLBACK_SECRET` unset it answers **`503`**, not `401`, and never
  treats "unconfigured" as "authenticated".
- `:24` — `401 stale or missing timestamp`; `:31-32` — `timingSafeEqual` over the digests,
  `401 invalid signature`.

**The one pairing the operator owns:** CARE's `INTEGRATION_HOPE_SIGNING_SECRET` and HOPE's
`CARE_CALLBACK_SECRET` must be the *same value*, and both must be the value that is deployed,
not the value in the repo template. `docs/hope-care-integration/06_CREDENTIAL_ROTATION.md` is
the rotation procedure; the values committed to this repository before it went private are the
ones `scripts/check-env-secrets.mjs` now refuses to deploy, and `deploy-synology.sh` no longer
writes either secret into `.env`.

## 4. Delivery mechanics on the CARE side — `VERIFIED IN CODE`

| mechanism | value | where |
|---|---|---|
| attempts per event | `max_attempts` default **8** | `lib/db/src/schema/integrationOutbox.ts:34` |
| backoff | `min(30s · 2^(n-1), 1h)` → 30s, 60s, 2m, 4m, 8m, 16m, 32m | `outbox.ts:110` |
| time to a dead letter | **≈64 minutes** after the first failure, on the 8th attempt | derived from the two rows above |
| abandoned `sending` rows | reclaimed when `locked_at` is older than `max(3 × dispatch timeout, 90s)` (`staleLeaseMs`, `:131`), **consuming one attempt** so a repeatedly-crashing worker still dead-letters (`:258-268`) | `outbox.ts:118-268` |
| write-back fencing | an outcome is applied only if this dispatch still owns the row, with the heartbeat's `locked_at` stamp as the fencing token; the decision is read from `RETURNING`, never inferred from the call succeeding | `finalizeOwnedTransition`, `outbox.ts:193` (#995, #996) |
| dead letters | listed and retried by admin (`GET /api/integration/admin/outbox?status=dead,…`), replay keeps the original `event_id`, so HOPE's duplicate handling decides whether it lands twice | proven by `routes/integrationAdminOutbox.request.test.ts`, which also proves a non-admin is refused |

No change to any of it in this round. It matters for the compatibility question because a
refused `422` is **not** terminal: films will be retried for about an hour and then surface as
a dead letter. That is the intended shape — the event stays re-driveable, which is what makes
refusal recoverable rather than fatal.

## 5. Durable acknowledgement

`care_callback_events.processed = 1` is written **inside the landing transaction**
(`careCallback.ts:456`), and an unprocessed row is treated as a delivery that never finished,
so a repeat call resumes rather than falsely succeeding. Before #190 the route acknowledged
reports it had not stored. `VERIFIED IN CODE`; #190's suite covers the crash-between-insert-and-
acknowledge case.

## 6. MERGED is not DEPLOYED — the three facts a repository cannot supply

| | state of knowledge | how to establish it |
|---|---|---|
| HOPE's *running* build contains the refusal (`SUPPORTED_CARE_EVENT_TYPES`, throwing `default:`) | **UNKNOWN** | `docker inspect --format '{{.Image}}' <hope api>` compared with the image HOPE deployed after `c2644c7e`, or the direct probe below |
| CARE's running build contains #1002's film marking | **UNKNOWN** | `curl -fsS http://localhost:8888/api/system/version` and compare the SHA with `ff49174a`'s ancestry — and treat the reported SHA as evidence only after checking the checkout's HEAD, because the version stamp has lied before |
| the two boxes share one signing secret value | **UNKNOWN** | compare the two environment names' *presence and strength* (`node scripts/check-env-secrets.mjs --file .env` on CARE); never print either value |

The probe that settles the first one is behavioural, and it is the one the gate asks to be
recorded — send an event type HOPE should not understand and see which way it went:

```sh
node scripts/ops-preflight.mjs --record-hope-probe --refused --event-type diagnostic_electronic_film.available
```

`--refused` means HOPE answered a non-2xx for a type CARE sends; `--not-refused` means it
acknowledged something it cannot interpret — which keeps `hope.receiver_contract` at
`UNKNOWN`/failing rather than letting it pass. The recorder refuses to guess the direction
(§14 T12k): a probe recorded without saying which way it went would be a way of manufacturing
a green row, which is the defect this whole round targets. Evidence lives in
`ops-evidence.json` on the box that observed it, expires after 90 days, and is gitignored
because `deploy-synology.sh` hard-resets the checkout.

**Do not convert `UNKNOWN` to `PASS` to make a deploy go.** A clinic that believes its
integration works because a table says so, when nothing ever probed the deployed peer, is how
electronic films ended up stamped `SENT` for documents nobody received.

## 7. Required deployment order

Both PRs are merged. What is outstanding is *deployment*, and the order still matters for the
window in which the two boxes run different builds:

1. **HOPE first** (the build containing `c2644c7e`). Deploying the refusal before the sender
   change means CARE sees a `422` for films while it still marks on any 2xx — harmless, because
   a `422` is not a 2xx: CARE simply retries and dead-letters.
2. **Then CARE** (the build containing `ff49174a`). Deploying only CARE stops the false `SENT`
   but leaves each film `HOPE_PENDING` and `FAILED` against a dead letter that is visible on the
   Hope connection screen — correct, and now honest.
3. **Then verify, and record the verification** (§6). Until that is done, the deployed state is
   a hypothesis.
4. **A new event type always lands in HOPE before CARE emits it.** In the window where CARE
   emits a type HOPE does not know, those events dead-letter — replayable from Integration
   Administration because the retry keeps the original `event_id`, so HOPE's duplicate handling
   decides whether it lands twice.
5. If the signing secret pair is rotated, rotate **both** boxes and restart both: CARE reads the
   secret only from its environment, and a half-rotation shows up as `401 invalid signature`
   against a still-retried outbox — not as a configuration error.

## 8. What is deliberately NOT done here

- **No authentication change.** Both sides already fail closed, measured in §3. Nothing in this
  round touches signature verification, and no path accepts an unsigned callback.
- **No silent compatibility fallback.** The temptation this round had to refuse is "HOPE does not
  know this type, so mark it delivered anyway / accept it into a quarantine nobody reads".
  `care_callback_events` has no reader in HOPE's UI, so a `processed = 1` row nobody can list is
  the same silent loss with an audit trail. Refusal with `processed = 0` keeps the event
  re-driveable.
- **No new outbox state.** A "terminal/refused" status would have rippled through #1001's admin
  ordering and the reconcile job; the existing 8-attempt budget already bounds any 4xx.
- **No migration, no new column, no queue, no advisory lock** in this document's subject matter.
- **No Orthanc/DICOM replication.** Films are a CARE-side document record, not the DICOM store;
  their undelivered state is reported, and nothing here proposes moving images.

## 9. Outstanding, in priority order

| # | Item | Status |
|---|---|---|
| 1 | Establish whether the deployed HOPE build refuses `diagnostic_electronic_film.available`, and record it | operator action, §6 |
| 2 | Establish and record the deployed CARE SHA (#1002 present) | operator action, §6 |
| 3 | Electronic films: no delivery path exists on either side. Product decision — build the HOPE landing leg + CARE handler arm, or stop offering "Send to HOPE" for films | **owner decision**, not a defect this round can close |
| 4 | `ElectronicFilmPanel.tsx:118` offers "Send to HOPE" only when `ingestStatus === "STORED" && hopeDeliveryStatus !== "SENT"`, so a `HOPE_PENDING` + `FAILED` film has no resend click even though `POST /api/electronic-film/:id/send-hope` (`:62`) accepts it | named UI follow-up; deliberately not slipped into an infra PR |
| 5 | `diagnostic_study.completed` for an unknown referral still acks and drops | #190's documented decision, unchanged |
| 6 | The callback URL precedence (env over partner row) will keep re-breaking a corrected admin value on a box with a stale `.env` | reported by the gate's `hope.integration` row; the fix is the operator's `.env`, not a code change |

Related: `docs/hope-care-integration/03_API_CONTRACT.md` (the inbound contract),
`06_CREDENTIAL_ROTATION.md` (rotation), HOPE's own `CARE_DIAGNOSTICS_INTEGRATION.md`
(§"Callback event compatibility" and "Deployment order for a new event type" — the same
contract from the receiver's side), and `CARE_ERP_DEPLOYMENT_RUNBOOK.md` §1a for the gate.
