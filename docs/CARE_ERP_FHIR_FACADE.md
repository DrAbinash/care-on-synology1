# CARE ERP — FHIR R4 Read Façade

*A read-only FHIR R4 API over existing CARE data, for interoperability with
hospital information systems, the ABDM national health stack (see
`CARE_ERP_ABDM_INTEGRATION.md`) and research/analytics tooling.*

> **Off by default.** The whole façade returns `503` until `FHIR_API_KEY` is set.
> It never writes — only `GET` is implemented.

## Activation

1. Generate a long random key and set it in the API server environment:
   ```
   FHIR_API_KEY=<64+ random chars>
   # optional: canonical base URL used in Bundle fullUrls
   FHIR_BASE_URL=https://care.yourclinic.in/api/fhir
   ```
2. Restart the API server. Every request must then carry
   `Authorization: Bearer <FHIR_API_KEY>` (compared in constant time). Without a
   valid token the façade returns a FHIR `OperationOutcome` with `401`.

Because the key is a single shared secret, treat it like any server-to-server
credential: issue one per consuming system where possible (rotate by changing
the env var), put the endpoint behind TLS, and prefer network allow-listing.

## Endpoints

Mounted at **`/api/fhir`**. Responses use `Content-Type: application/fhir+json`.

| Method & path | Returns |
| --- | --- |
| `GET /api/fhir/metadata` | `CapabilityStatement` (FHIR 4.0.1). |
| `GET /api/fhir/Patient/:id` | `Patient` (CARE `patients.id`). |
| `GET /api/fhir/Patient?identifier=&name=` | `Bundle` (searchset). `identifier` matches `patient_id`; `name` is a substring over first/last name. |
| `GET /api/fhir/DiagnosticReport/:id` | `DiagnosticReport` (CARE `patient_reports.id`). |
| `GET /api/fhir/DiagnosticReport?patient=` | `Bundle`. `patient` accepts `42` or `Patient/42`. |
| `GET /api/fhir/DiagnosticReport/:id/$everything` | `Bundle` — the report plus its contained `Observation`s. |
| `GET /api/fhir/Observation/:reportId-:index` | `Observation` (one structured parameter row of a report). |
| `GET /api/fhir/ServiceRequest/:id` | `ServiceRequest` (CARE `order_tests.id`). |
| `GET /api/fhir/ServiceRequest?patient=` | `Bundle`. |

Search results are capped at 200 resources.

## Mapping

Pure, unit-tested functions in `src/lib/fhirMappers.ts`
(`fhirMappers.test.ts`, 18 cases). Route layer (`src/routes/fhir.ts`) only does
I/O; it is covered by a live smoke test against a seeded database (23 checks).

| CARE source | FHIR resource | Notes |
| --- | --- | --- |
| `patients` | `Patient` | `patient_id` → identifier (`urn:care:patient-id`); free-text gender → administrative-gender; free-text DOB coerced to `YYYY[-MM[-DD]]` (age strings dropped, not faked). |
| `patient_reports` | `DiagnosticReport` | status: draft→`partial`, pending_verification→`preliminary`, verified/delivered→`final`; pathology→`LAB`, radiology→`RAD`; `impression`→`conclusion`; `verified_at` preferred for `issued`. |
| `patient_reports.parameters[i]` | `Observation` (id `"<reportId>-<i>"`) | numeric value → `valueQuantity` (+unit), else `valueString`; `refRange`→`referenceRange.text`; `flag` H/L/HH/LL/N/A/critical → v3 interpretation code (unknown flags kept as text). |
| `orders` + `order_tests` | `ServiceRequest` | one per ordered test; `active`→`active`, `cancelled`→`revoked`; `order_number`→identifier. |

## Design notes

- **Additive & inert.** No existing route or table changes; nothing is written.
  Turning the key off fully disables it.
- **Stable resource ids.** `Patient/:id`, `DiagnosticReport/:id`,
  `ServiceRequest/:id` are the CARE database ids; `Observation` ids are
  `"<reportId>-<paramIndex>"` so they are addressable and deterministic.
- **No PDFs / binaries.** The façade emits structured data only; the tokenised
  public PDF download (`/p/r`) remains the channel for rendered reports.
- **Not yet exposed:** encounters, coverage/claims, appointments. These can be
  added as further read mappers when a consumer needs them.
