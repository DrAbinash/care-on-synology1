# Internal Reporting Studio — Worklist contract

Mount: `GET /api/internal/reporting-studio/worklist`  
Auth: `x-api-key: $REPORTING_STUDIO_API_KEY` (optional `x-studio-id` for audit labelling)

## Modes

| Client params | Feature flag | Response |
| --- | --- | --- |
| No `since` / `limit` / `cursor` | any | **Legacy** `{ rows, meta }` — byte-identical shape for already-deployed studios |
| Any of `since` / `limit` / `cursor` | `REPORTING_WORKLIST_INCREMENTAL` **on** (default) | **Incremental** `{ orders, nextCursor, serverTime, truncated }` |
| Any of `since` / `limit` / `cursor` | flag **off** | Legacy path (inclusive `updatedAt >= since` if `since` present) |

### Rollback

```bash
# On the API host / compose env — disables incremental envelope; studios keep legacy pulls.
REPORTING_WORKLIST_INCREMENTAL=0
# then restart @workspace/api-server
```

## Night window (closed pulls)

`GET /worklist` is refused between **18:00 and 09:00 Asia/Kolkata** unless the API
host says otherwise. This is the ERP's most expensive read — a page of up to 500
`radiology_worklist` rows through five joins plus the per-row bill lookup — and
studios fetch it on a fixed interval whether or not a radiologist is working.

```bash
# On the API host / compose env — hours are Asia/Kolkata, "start:end", wrap allowed.
REPORTING_STUDIO_QUIET_HOURS=off      # never closed (pull runs all night)
REPORTING_STUDIO_QUIET_HOURS=20:07    # closed 20:00-07:00
REPORTING_STUDIO_QUIET_HOURS=09:18    # close the working day instead
# unset → 18:09. Then restart @workspace/api-server. No deploy needed.
```

During a closed window the endpoint answers **503** with `Retry-After` (seconds until
it reopens) and a body like:

```json
{
  "error": "Reporting Studio worklist pull is closed between 18:00 and 09:00 IST (REPORTING_STUDIO_QUIET_HOURS). …",
  "quiet": true,
  "timezone": "Asia/Kolkata",
  "quietWindow": { "startHour": 18, "endHour": 9 },
  "opensAt": "2026-11-13T03:30:00.000Z",
  "retryAfterSeconds": 27000
}
```

Studio contract for a closed pull: **treat it as a failed poll, not an empty worklist.**
No query ran, so `rows`/`orders` are absent by design — clearing or overwriting the local
store from this response would drop every pending study until 09:00. Keep the current
list, do not advance `lastSyncAt`, and honour `Retry-After`.

Only `/worklist` is gated. `/ping`, `/audit`, `/billing-status` and `/finalize` answer
all night, so a report finished after hours still signs and freezes normally.

## Shared query params

| Param | Notes |
| --- | --- |
| `status` | `pending` (default) \| `all` \| `reported` \| `final` \| `delivered` |
| `since` | Epoch **ms** (13 digits), epoch **seconds** (10 digits), or ISO-8601. Incremental mode uses **exclusive** `COALESCE(updated_at, created_at) > since`. |
| `limit` | Incremental only. Default `200`, max `500`. |
| `cursor` | Incremental only. Keyset on `radiology_worklist.id` (pass previous `nextCursor`). |

## Legacy response (`{ rows, meta }`)

Unchanged row objects. `meta` includes `syncedAt`, `rowsServed`, `rowsByModality`, `validationFailures`, `sentinels`, `sourceId`, `matchedBy`.

Hard cap: 500 rows ordered by `updated_at DESC`.

## Incremental response

```json
{
  "orders": [ /* same row contract as legacy rows[] */ ],
  "nextCursor": "12345",
  "serverTime": 1727000000000,
  "truncated": true
}
```

- `orders` — same Zod contract as legacy rows (`studioWorklistRowSchema`).
- `nextCursor` — opaque stringified id for the next page, or `null` when done.
- `serverTime` — ERP wall clock (epoch ms). Studios should store this (or `Date.now()` at receipt) as `lastSyncAt`.
- `truncated` — `true` when more rows exist beyond this page (`limit`).

### Watermark semantics (studio adoption)

1. Persist `lastSyncAt` after a successful pull (use response `serverTime`).
2. On the next poll (~60s), call with:
   - `since = lastSyncAt - 5 minutes` (overlap for clock skew / late updates)
   - `limit=200` (or up to 500)
   - page with `cursor=nextCursor` until `truncated === false`
3. **Upsert** each order by `worklistId` into the studio local store (do not replace the whole list with a single page).
4. Exclusive boundary: a row whose change time **equals** `since` is **not** returned — the 5-minute overlap re-fetches recent rows safely.

## Indexes

`radiology_worklist(updated_at)` and `(updated_at, id)` — see `migrations/add_radiology_worklist_updated_at_indexes.sql`.
