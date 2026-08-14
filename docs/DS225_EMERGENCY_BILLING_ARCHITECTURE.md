# DS225+ Emergency Billing — Architecture

DS225+ **captures** emergency bills. DS1522+ CARE remains the **only** source of truth for accounting, commission, and canonical billing.

This is **not** a second ERP and **not** an active-active billing pair. Do not deploy it to cloud VPS / Render / Replit / Vercel / Cloudflare.

## Phase 0 audit (canonical CARE)

| Concern | Canonical location | Reuse |
| --- | --- | --- |
| Billing | `POST /api/orders` then `POST /api/bills` (`artifacts/api-server/src/routes/bills.ts`) | Import writes the same `orders` / `order_tests` / `bills` / `payments` rows |
| Bill numbers | `generateBillNumber()` + `pg_advisory_xact_lock(hashtext('care_erp_bill_number'))` | Imported CARE bills get normal CARE numbers; original `EMG-*` is stored as provenance |
| Idempotency | `bills.client_ref` unique (`emg:<uuid>`) **and** `emergency_imported_transactions.emergency_transaction_uuid` unique | Both enforced in PostgreSQL |
| Payments | Mixed cash / UPI / card; `paid` / `partial` / `pending` from paid vs net | Emergency `amountReceived` / `dueAmount` copied exactly |
| Patients | `patients` + UHID `P-#####`; matching in `@workspace/emergency-billing` | Conservative: EXACT / PROBABLE / NEW / CONFLICT — never silent merge |
| Catalogue / tariff | `diagnostic_tests.price` | Cached on DS225+; import uses **captured** unit prices, not later CARE tariff |
| Referring doctors | `doctors` | Cached ids; commission is **not** calculated on DS225+ |
| Discount | `users.max_discount` on DS225+; CARE import preserves the original discount | |
| Receipts | Emergency HTML print; CARE reprints via existing bill print | PDF is **not** an import format |
| Accounting | `autoVoucherForPayment()` after CARE import | No vouchers on DS225+ |
| Commission | Existing CARE engine on `order_tests` | No commission engine on DS225+ |
| CSV/JSON import | **New** `CARE_EMERGENCY_BILLING_V1` / `CARE_EMERGENCY_BILLING_JSON_V1` | There was no prior bill CSV import |
| Synology | `docker-compose.yml` (`care-db` / `care-api` / `care-web`, volume `care_main_db_data`) | Emergency stack is a **separate** compose project |
| DS225+ DR | `docs/CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md` (full ERP standby) | Emergency Billing must **not** use Hyper Backup vaults or that restore volume |

Client offline queue (`offlineBillingQueue.ts`) is for brief blips on the same CARE API. It is **not** this system.

## Runtime topology

```text
NORMAL:     Reception → DS1522+ → full CARE ERP
EMERGENCY:  Reception → CARE-EMERGENCY LAN → DS225+ → Emergency Billing only
RECOVERY:   DS225+ → NAS API or CSV/JSON → CARE Settings → Emergency Reconciliation
            → canonical CARE bills → existing accounts + commission
```

## Components

| Piece | Role |
| --- | --- |
| `@workspace/emergency-billing` | Shared numbering, matching, CSV/JSON, money, idempotency counts |
| DS225+ `care-emergency-*` | Minimal capture app + dedicated PostgreSQL |
| CARE `/api/emergency-billing` | Preview, fetch, CSV/JSON import through canonical bill path |
| CARE Settings → Billing → Emergency Billing | Owner-operated recovery UI |

## What DS225+ must not contain

Accounting, commission, PACS/Orthanc/MWL, radiology reporting, pathology processing, AI, inventory, HR, expenses, appointments, WhatsApp automation, or a copy of `diagnostic_erp`.

## Numbering

- Human: `EMG-YYYYMMDD-XXXXX` (IST calendar date)
- Machine: `emergency_transaction_uuid` (UUID, unique, never reused)
- After import, CARE bill number is normal; `EMG-*` stays searchable in reconciliation history and order notes (`source=LOCAL_EMERGENCY`)

## Emergency session

Locked by default. Only `admin` / `super_admin` may **START** / **END** a session. History is never deleted. Reception cannot self-activate.

## Idempotency

Uploading or fetching the same UUID repeatedly must yield:

```text
supplied N
already reconciled N
created 0
duplicates N
failures 0
```

Interrupted import rolls back the CARE transaction (UUID row + bill). Concurrent imports serialize on `care_erp_emergency_import` plus unique constraints.

## Patient matching

1. CARE patient id / UHID  
2. Phone + exact name → EXACT  
3. Phone + different name → PROBABLE (review)  
4. Else NEW PATIENT  
Name-only never matches. CONFLICT never auto-imports.

## Storage isolation

| Use | Volume / path |
| --- | --- |
| Emergency DB | Docker volume `care_emergency_db_data` |
| Logical dumps | `care_emergency_backups` or `/volume1/docker/care-emergency/backups` |
| Forbidden | `care_main_db_data`, Hyper Backup vault, Snapshot Replication destinations |
