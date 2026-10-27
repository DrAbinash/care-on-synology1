# CARE ERP — Report Delivery go-live checklist

_The run-list for putting the physical report counter into service at the clinic.
It migrates nothing, deploys nothing and merges nothing by itself: every step is
something a person does, in this order. Written against `main` after #1182,
#1183, #1184, #1185 and #1187, plus the dashboard PR._

**What this feature is.** Two scanner operations on the existing Scan Station —
RECEIVE REPORTS and DELIVER REPORTS — and four queues on the existing Report
Delivery page. Every act is one row in `report_custody_events`, attributed to the
authenticated staff session. Nothing here changes report status, payment, or
commission; a handover records paper moving, not a report becoming `delivered`.

---

## 1. Database migrations

Applied automatically by `deploy-synology.sh` step 4 (`care-db-patch-v2`). Three
files, all additive, all idempotent, **no backfill**:

| File | Adds |
| --- | --- |
| `migrations/zzzzzzzzzzzzzzzzzzzzzzz_report_delivery_custody.sql` | the `report_custody_events` ledger, `patient_reports.origin` / `physical_state` / `physical_state_at`, `clinic_settings.require_report_dispatch_acknowledgment`, three nullable `scan_audit_logs` columns |
| `migrations/zzzzzzzzzzzzzzzzzzzzzzz_word_report_custody.sql` | lets a custody event name an **examination** instead of a report row (`report_id` nullable, `targets_something_chk`, the two exam-scoped unique indexes) |
| `migrations/zzzzzzzzzzzzzzzzzzzzzzz_report_delivery_golive.sql` | `clinic_settings.report_delivery_golive_at` (nullable) |

Check, on the NAS:

```
sudo docker logs care-db-patch-v2 --tail 20
```

Pass = migrations complete, then `sudo docker inspect --format='{{.State.Status}} {{.State.ExitCode}}' care-db-patch-v2` says `completed 0`.
Fail = it stops before the API starts; the same log names the file.

Confirm the ledger exists:

```
sudo docker exec -it care-db psql -U erp -d diagnostic_erp -c "\d report_custody_events"
```

## 2. Staff permissions — the one decision to make before opening the desk

Settings → Users, per person who works the counter. **Report Delivery** is a
module with four ticks; nothing is granted automatically and no job title is
checked:

| Tick | Lets the person |
| --- | --- |
| See the counter and its queues (`view`) | open the four queues on Report Delivery |
| Acknowledge signed paper at the counter (`receive`) | RECEIVE REPORTS at the Scan Station |
| Confirm physical handover to the patient (`handover`) | DELIVER REPORTS at the Scan Station |
| Correct a delivery / close a discrepancy (`correct`) | the supervisor correction path (reserved; no screen uses it yet) |

Ticking the module grants all four. A new desk usually needs `view` + `receive` +
`handover` for the billing/reception staff who work it, and one backup.

> **Know this before you rely on the gate.** Anyone holding the **Samples** module
> still reaches Report Delivery, because `LEGACY_PIGGYBACKS` in
> `artifacts/api-server/src/lib/staffSessionUser.ts` lists `/report-delivery`
> under `/samples`. That is pre-existing, it is why lab staff can open the page
> today, and removing it decides exactly which live accounts get a 403 — which
> cannot be derived from the repository. It is left alone deliberately; say the
> word and it comes out as its own change.

## 3. Go-live configuration

Settings → Clinic Info → **Report delivery go-live**: the date and time the
counter starts keeping records. Save Changes.

- Reports **signed before** it are never listed in Awaiting Receipt. The release
  moment compared is `signed_at` (falling back to `created_at`), so a 2019 report
  restored from backup does not become this week's backlog.
- Leave it empty and Awaiting Receipt reads **"not measured"** — which is the
  honest answer, not zero. The other three queues work either way, because the
  ledger holds nothing from before go-live.
- **No historical custody events are backfilled.** Old paper only enters the
  ledger when a clerk receives it.

## 4. Environment variables

**None.** No new credential, no new auth mechanism, no `.env` edit. Checked, not
assumed: `BOUNDARY_API_KEY` appears only in `artifacts/api-server/src/routes/boundary.ts`
(the optional federated Radiology Service) and in one PACS-archive test file; no
custody route, library or Scan Station component references it. The delivery
counters run on the existing staff session and `DATABASE_URL` alone.

## 5. Verify after deployment — five minutes at the desk

Use a real bill whose reports are signed. Do these in order; each line is what
should happen.

1. **Login as a staff account without the ticks** → Scan Station shows no receive
   mode; `GET /api/report-custody/queues` answers 403. If it opens, the tick was
   granted too widely.
2. **Scan the bill QR into RECEIVE REPORTS** → the examinations on that bill are
   listed. Nothing has been recorded yet: the queue counts do not move.
3. **Tick two of them, confirm** → one custody event each, and both now appear in
   **At Counter** with the receiving clerk's name and the time. A third unticked
   report stays in **Awaiting Receipt**.
4. **Rescan the same label** → amber "already at the counter", and the second
   confirm writes nothing (the database's partial unique index, not the UI,
   refuses it).
5. **Scan the bill into DELIVER REPORTS, hand one over** naming the recipient →
   that sheet moves to **Handed Over** showing the clerk who received it **and**
   the clerk who handed it out. Reload the page: the states are unchanged.
6. **Open the report in the clinical record** → its status is still
   `pending_verification` (or `verified`) and "delivered" has not been stamped.
   If it has, the deployment is wrong: stop and say so.
7. **Scan a laboratory sample label at the Scan Station** → it resolves to the
   sample exactly as before, and no custody row is created.

## 6. Rollback

Everything added is additive, so rollback is a code revert, not a data repair:

```
cd /volume1/docker/care-on-synology1
git fetch origin
git reset --hard origin/main
```

then rebuild the web and api containers (the normal `docker compose up -d --build`
step of `deploy-synology.sh`). Do **not** drop the ledger or the columns: they
hold the counter's record, they are nullable, and no old code reads them.

- To stop staff using the desk without reverting anything: remove the three
  Report Delivery ticks. The queues and both scanner operations refuse immediately;
  previously recorded events stay in the database.
- `report_custody_events` is append-only. If an entry was recorded wrongly, it is
  corrected by a new event that closes the old one — never by an UPDATE or DELETE.

## 7. Known limits at go-live (not defects — decisions)

- **No report carries a barcode.** Only `SampleLabel.tsx` prints one, so report
  labels are a future enhancement; the desk runs on the **bill QR** and on typing
  an `RPT-…` number. Both take the identical server path.
- **Word paper cannot be volunteered by Awaiting Receipt.** A Word report is not a
  row in CARE, so the queue can only list reports this app produced; Word sheets
  appear once they are received. The page says this under the queue.
- The old one-click Deliver action is retired (`POST /api/resolve-barcode/reports/:id/deliver`
  now answers 410). Until the old Report Delivery page is removed from the menu,
  two surfaces describe handover — the station is the one that records custody.
