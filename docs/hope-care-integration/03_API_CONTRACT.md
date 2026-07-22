# HOPE ↔ CARE Diagnostic Referral — API & Event Contract v1.0

All endpoints are additive and versioned. Inbound (HOPE→CARE) is served by CARE
at `/api/integration/v1`; outbound (CARE→HOPE) is delivered by CARE's outbox to a
partner-configured callback URL. Breaking changes bump the major version and a
new path segment (`/api/integration/v2`).

---

## 1. Authentication

### Inbound (HOPE → CARE)
* Header: `Authorization: Bearer intgk_...`
* The key is issued once via the CARE admin console (`POST /api/integration/admin/partners`),
  stored only as a SHA-256 hash, and scoped to a code-fixed permission allowlist:
  `diagnostic_referral:{create,update,cancel,read}`, `diagnostic_result:acknowledge`.
* Every attempt (allowed or denied) is written to `integration_partner_audit_log`.
* Defence in depth: the payload's `source.org` must equal the credential's `sourceOrgCode`.

### Outbound (CARE → HOPE)
* CARE signs each callback: headers `X-CARE-Event-Id`, `X-CARE-Event-Type`,
  `X-CARE-Timestamp` (unix seconds), `X-CARE-Signature: sha256=<hmac>`.
* `hmac = HMAC_SHA256(secret, "<timestamp>.<rawBody>")` (hex). Secret is read from
  `INTEGRATION_HOPE_SIGNING_SECRET` on the CARE host — never stored in the DB.
* HOPE must verify the signature, reject timestamps older than its skew window
  (replay protection), and dedupe on `eventId` (idempotent receiver).

---

## 2. Inbound endpoints

### `POST /api/integration/v1/diagnostic-referrals`  · `diagnostic_referral:create`
Create/receive a referral. **Idempotent** on `referralUuid` (immutable) and
`idempotencyKey` (per delivery). A repeat returns `200` with `replayed:true`; a
first receipt returns `201`.

Request:
```jsonc
{
  "referralUuid": "b3c1…",           // optional; CARE generates if absent
  "idempotencyKey": "b3c1…-v1",      // optional
  "source": {
    "org": "HOPE",                    // must match the credential's org
    "patientId": "UHID000123",        // HOPE patients.uhid
    "encounterId": "OPD-2026-0456",   // HOPE opd_visits.visit_no
    "prescriptionId": "RX-789",       // HOPE diagnostic_orders.order_no / prescription id
    "user": "dr.rajesh"               // HOPE prescriber username (created_by)
  },
  "patient": {
    "name": "Rajesh Kumar",
    "age": 34, "ageUnit": "years",    // HOPE has no DOB; CARE synthesises one
    "gender": "M",
    "phone": "9876543210",
    "address": "…", "email": "…"      // optional
  },
  "referringDoctor": {
    "id": "D-12", "name": "Dr. Sunita Rao",
    "specialization": "General Medicine", "registrationNo": "MH-45678"
  },
  "clinical": {
    "department": "General Medicine",
    "history": "Fever 5 days, fatigue",
    "provisionalDiagnosis": "? Enteric fever",
    "pregnancyStatus": null
  },
  "priority": "routine",              // routine | urgent | emergency
  "requestedDate": "2026-07-22T09:30:00Z",
  "consent": { "status": "verbal", "metadata": {} },
  "attachments": [],
  "notes": "Patient prefers morning collection",
  "tests": [
    { "code": "CBC", "name": "Complete Blood Count", "modality": "lab" },
    { "code": "LFT", "name": "Liver Function Test", "modality": "lab" },
    { "code": "USGWA", "name": "USG Whole Abdomen", "modality": "radiology" }
  ]
}
```
Response `201`:
```jsonc
{
  "referralUuid": "b3c1…", "referralId": 42, "status": "RECEIVED_BY_CARE",
  "matchStatus": "confirmed|probable|conflict|new",
  "mappingStatus": "all_mapped|partial|unmapped",
  "replayed": false,
  "items": [ { "id": 1, "sourceTestName": "Complete Blood Count", "itemStatus": "mapped", "careTestId": 55, "carePackageId": null } ],
  "contractVersion": "1.0"
}
```

### `GET /api/integration/v1/diagnostic-referrals/:referralUuid` · `diagnostic_referral:read`
Poll status. Returns header status, `matchStatus`, `mappingStatus`, and per-item statuses.

### `PUT /api/integration/v1/diagnostic-referrals/:referralUuid` · `diagnostic_referral:update`
Amend clinical history / provisional Dx / priority / notes **before CARE creates an
order**. `409` once the order exists (use cancellation/amendment).

### `POST /api/integration/v1/diagnostic-referrals/:referralUuid/cancel` · `diagnostic_referral:cancel`
Cancel a pending referral. `409` if it is already billed/sampled/reported (the state
machine forbids the transition) — HOPE must then use CARE's cancellation/amendment flow.

### `POST /api/integration/v1/diagnostic-referrals/:referralUuid/acknowledge` · `diagnostic_result:acknowledge`
HOPE acknowledges a critical result: `{ resultLinkId, acknowledgedBy, method }`.

### `GET /api/integration/v1/health` (open)
`{ ok: true, contractVersion: "1.0" }`.

---

## 3. Outbound events (CARE → HOPE callback)

Envelope (POST body to the partner callback URL):
```jsonc
{
  "eventId": "uuid",
  "eventType": "diagnostic_report.finalised",
  "eventVersion": "1.0",
  "idempotencyKey": "diagnostic_report.finalised:<referralUuid>:<reportId>",
  "correlationId": "<referralUuid>",
  "sourceOrg": "CARE", "destinationOrg": "HOPE",
  "occurredAt": "2026-07-22T…",
  "data": { … event-specific … }
}
```

| eventType | when | key `data` fields |
|---|---|---|
| `diagnostic_referral.received` | CARE stored the referral | referralUuid, status, matchStatus, mappingStatus |
| `diagnostic_order.created` | staff accepted → CARE order made | referralUuid, careOrderId, careOrderNumber, status, acceptedItems[] |
| `diagnostic_referral.cancelled` | referral cancelled at CARE | referralUuid, reason |
| `diagnostic_sample.collected` | *(Phase 2)* pathology sample collected for the order | referralUuid, careOrderId, status |
| `diagnostic_study.completed` | *(Phase 2)* radiology study performed | referralUuid, careOrderId, status |
| `diagnostic_order.item_status_changed` | *(Phase 2)* referral header advanced a milestone | referralUuid, careOrderId, status |
| `diagnostic_report.finalised` | patient_report verified/delivered | referralUuid, careOrderId, careReportId, reportNumber, resultType, reportStatus, isCritical, finalisedAt, finalisingDoctor, title, impression, reportRef, reportToken *(Phase 2)* |
| `diagnostic_result.critical` | a finalised report flagged critical | referralUuid, careReportId, reportNumber, criticalNote, resultLinkId, finalisingDoctor |

Reserved for later phases (same envelope): `diagnostic_referral.updated`,
`diagnostic_invoice.created`, `diagnostic_payment.received`,
`diagnostic_report.amended`, `diagnostic_result.acknowledged`.

Delivery guarantees: at-least-once with idempotent receiver; exponential backoff
(30s→…→1h), `maxAttempts` then dead-letter; every attempt logged to
`integration_delivery_attempts`; admin retry via
`POST /api/integration/admin/outbox/:id/retry`.

---

## 4. Staff & admin endpoints (CARE-internal, staff-session auth)

* `GET/…  /api/hope-referrals` — inbox list, `/stats`, `/:id`, and actions
  `contact-patient`, `confirm-patient`, `map-test`, `accept`, `decline`, `cancel`.
* `GET/POST/PUT /api/integration/admin/partners` — provision/rotate partner keys.
* `GET/POST/PUT /api/integration/admin/mappings` — catalogue mapping review.
* `GET /api/integration/admin/outbox`, `/:id/attempts`, `/:id/retry`,
  `POST /api/integration/admin/{dispatch-outbox,reconcile-results}`.

Every event object also carries: Event ID, version, idempotency key, timestamp,
source & destination org, referral/order identifiers, and a correlation id — per
the brief's §20 requirements.
