# CARE ERP — ABDM / ABHA Integration (Scaffold)

*Integration with India's Ayushman Bharat Digital Mission (ABDM): link a
patient's ABHA, make CARE diagnostic records discoverable as "care contexts" in
their PHR app, and receive consent artefacts from the Consent Manager.*

> **Scaffold, off by default.** Everything returns `503` until `ABDM_ENABLED=true`.
> The **local** pieces (ABHA validation/storage, care-context registration,
> discovery lookup, consent storage) are fully implemented and tested. The
> **gateway-dependent** pieces (session token, outbound push) are gated stubs,
> and **health-data exchange** (encrypted payloads + X-HMAC signature
> verification) is intentionally **not** implemented — see "Before production".

## What this gives you

| Capability | State |
| --- | --- |
| Store a patient's ABHA number/address (validated, normalised) | ✅ implemented |
| Register CARE records as discoverable care contexts | ✅ implemented |
| Respond to gateway **discovery** callbacks (references only) | ✅ implemented |
| Store **consent artefacts** from the Consent Manager | ✅ implemented |
| Gateway **session token** acquisition + caching | ✅ implemented (needs creds) |
| Push care-context links to the gateway | ⚠️ gated stub (`gatewayPush: "pending"`) |
| **Health-data exchange** (encrypted FHIR bundle push) | ❌ not implemented — by design |

## Data model (`migrations/add_abdm_abha_integration.sql`)

- **`abha_links`** — a patient's ABHA identity (number `XX-XXXX-XXXX-XXXX`,
  address `handle@registrar`, name/gender/YOB, status, verification flag).
- **`abdm_care_contexts`** — CARE records exposed under an ABHA
  (`care_context_ref`, `display`, `hi_type`, `linked` flag).
- **`abdm_consent_artefacts`** — consents granted by the Consent Manager
  (`consent_id`, status, HI-types, date window, expiry).
- **`abdm_gateway_log`** — audit of every inbound/outbound gateway interaction.

Additive and idempotent; references only `patients`.

## Endpoints

### Management — `/api/abdm` (staff auth, `/settings` permission)

| Method & path | Purpose |
| --- | --- |
| `GET /status` | `{ enabled, configured }`. |
| `POST /abha/link` | Link an ABHA to a patient. Validates the 14-digit number and `handle@registrar` address; upserts on (patient, address). |
| `GET /abha/by-patient/:patientId` | A patient's ABHA links. |
| `POST /abha/:id/unlink` | Soft-unlink (status → `unlinked`). |
| `POST /care-contexts` | Register CARE records as care contexts (idempotent on ref). |
| `GET /care-contexts/by-patient/:patientId` | List a patient's care contexts. |
| `GET /consents?status=` | Consent artefacts received from the gateway. |

### Gateway callbacks — `/api/abdm/callback` (public transport, secret-gated)

Gated by `ABDM_ENABLED` **and** a shared `ABDM_CALLBACK_SECRET` bearer token
(fail-closed: `503` if either is missing, `401` on a bad token).

| Method & path | Purpose |
| --- | --- |
| `POST /consents/hip/notify` | Store/update a consent artefact's state. |
| `POST /care-contexts/discover` | Given an ABHA address, return matching care-context **references + labels** (never clinical content). |
| `POST /health-information/request` | Acknowledged + logged, returns `501` — encrypted data push not implemented. |

## Activation

```
ABDM_ENABLED=true
ABDM_CLIENT_ID=<from ABDM HIP registration>
ABDM_CLIENT_SECRET=<...>
ABDM_CM_ID=sbx                 # sandbox registrar; use your CM id in prod
ABDM_HIP_ID=<your HIP id>
ABDM_HIP_NAME=CARE Diagnostics
ABDM_BASE_URL=https://dev.abdm.gov.in   # sandbox; swap for prod gateway
ABDM_SESSION_PATH=/api/hiecm/gateway/v3/sessions
ABDM_CALLBACK_SECRET=<long random shared secret for callback transport>
```

With `ABDM_ENABLED=true` but no client credentials, `/status` reports
`configured: false` and the local features still work; outbound gateway calls
throw `AbdmNotConfiguredError` until credentials are set.

## Before production (the parts a scaffold cannot safely stub)

1. **Callback authentication.** Replace the shared-secret check in
   `requireCallbackAuth` (routes/abdm.ts) with ABDM's **X-HMAC signature
   verification** over the raw request body.
2. **Payload encryption.** Health-information responses must be encrypted with
   the HIU's public key (ECDH/curve25519 per the ABDM crypto spec). Build the
   FHIR document bundle from the existing `lib/fhirMappers.ts` (`DiagnosticReport`
   + `Observation`), then encrypt before pushing. `abdmPost` does **not** encrypt.
3. **Consent enforcement.** `abdmProtocol.consentPermits()` implements the
   GRANTED / unexpired / hi-type / date-window rule — call it before assembling
   any data-push response.
4. **Public callback URL + allow-listing.** The gateway must be able to reach
   `/api/abdm/callback/*` over HTTPS; register that URL with your HIP.

## Tests

- `src/lib/abdmProtocol.test.ts` — 9 cases (ABHA number/address validation and
  formatting, year-of-birth, care-context payload, consent-permits rule).
- Live smoke test (18 checks) covers management CRUD, validation, upsert/idempotency,
  the callback secret gate, consent storage, discovery lookup, and the
  feature-flag-off `503` path.
