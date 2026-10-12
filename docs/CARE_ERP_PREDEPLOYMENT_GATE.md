# CARE ERP / PACS — Pre-deployment Gate

_Concise run-list for the operator, in the order the checks have to happen. §A–§C are the
short form of `CARE_ERP_CLINIC_READINESS_CHECKS.md` — that file carries the reasons, the
expected output verbatim, and the limitations; this file carries only what to run and what
counts as a pass. §D (HOPE) is written here for the first time, line-cited to the code that
implements each leg._

What this document does **not** do: it deploys nothing, restarts nothing, merges nothing,
migrates nothing, restores over no live data, rotates and prints no credential. Every
command was checked against the file that ships it at `main` = `0e801cf1`. **None of them
has been run against the clinic**, because that is the owner's box and the owner's decision.

Run everything from the deploy checkout — not `/volume1/homes/abinash/care-on-synology1`,
not `/volume1/docker/care-pacs`:

```sh
cd /volume1/docker/care-erp-github/care-on-synology1
docker compose ls
```

`docker compose ls` is the reliable project listing on this box (`com.docker.compose.*`
inspect labels come back empty for the care containers because the stack was started from
Synology Container Manager). Confirm the project row matches this directory before any
`docker compose run` below; a `docker compose` invocation that resolves to the wrong project
prints nothing and succeeds.

**Recording rule:** one line per check — `PASS`, `WARNING`, `FAIL`, or `NOT RUN`, plus the
number you actually saw. `NOT RUN` is not a pass, and a blank line does not clear a gate in
Part 2.

---

## Part 1 — Operator checklist

### A. Clinic database

| # | Check | Pass condition | Result |
|---|---|---|---|
| A.1 | The ERP is pointed at the database you think it is | `current_database()` = your `DB_NAME`, `pg_is_in_recovery() = f`, identity row `app_name = care-erp` | ☐ |
| A.2 | The session is genuinely read-only | Postgres refuses the write with `ERROR: cannot execute UPDATE in a read-only transaction` | ☐ |
| A.3 | **Ledger audit — only after explicit authorization** | the command completes and prints its summary | ☐ |
| A.4 | Record the three counts | the line `N critical, M warnings, K informational` is written down verbatim | ☐ |
| A.5 | Stop rule | `N > 0` ⇒ the deployment stops here | ☐ |

A.3 is the only step in this document that touches the clinic database, and it is a `SELECT`
against it. Get the owner's go-ahead before running it.

```sh
docker exec care-api sh -c 'printenv DATABASE_URL | sed -E "s#://[^@/]*@#://REDACTED@"'
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select current_database(), pg_is_in_recovery()"'
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select app_name, environment, created_at from public.system_database_identity"'
```

`app_name` is stamped by `docker/db-patch-entrypoint.sh:145-166`, which refuses to migrate a
database stamped for a different app. If A.1 shows a different `app_name`, stop — the audit
would describe a schema nobody deploys to. Never `printenv DATABASE_URL` unredacted; it
embeds `DB_PASSWORD`.

```sh
docker exec care-db sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update public.schema_migrations_log set name = name"'
```

Expected refusal, verbatim: `ERROR:  cannot execute UPDATE in a read-only transaction`. That
is the mechanism `scripts/audit-migration-ledger.mjs` relies on — it connects with
`-c default_transaction_read_only=on` (`:493`) and exits 1 unless Postgres confirms the
setting (`:497-508`). The statement is refused, so nothing changes.

```sh
docker compose run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs
```

`--no-deps` starts no database, no API, no migration container. `schema-verify` is chosen
because its image bakes `scripts/` + `scripts/node_modules` (so `pg` resolves) and mounts
`migrations` and `lib/db/drizzle` **read-only** — the exact pair the audit compares. To keep
the findings: add `--json=output/ledger-audit-$(date +%F).json`, then move the file out of
the checkout. Do not `git clean` to remove it: that directory holds untracked files that
exist in no branch.

Findings name schema objects only — no rows, no patient identifiers, no credentials. Read
every critical line; a `RECORDED_BUT_ABSENT` line is the half-applied-migration case that
#955 prevents in future and cannot undo. **Never rewrite a ledger row to silence a finding.**

### B. Backup restoration

| # | Check | Pass condition | Result |
|---|---|---|---|
| B.1 | Latest completed artifact identified | newest file named, family known (`.sql.gz[.enc]` or `backup_*.sql[.enc]`) | ☐ |
| B.2 | Its timestamp is inside the retention window | `RETENTION_DAYS` = 14 by default; a weeks-old newest file is a finding about the backup job | ☐ |
| B.3 | Production untouched — recorded **before** | `started=` / `restarts=` captured for `care-db care-api care-web` | ☐ |
| B.4 | Restore ran in isolation | ends `🎉 PASS` | ☐ |
| B.5 | Schema and critical tables present | restored table count > 0 and `patients` / `bills` / `payments` / `vouchers` / `patient_reports` non-zero | ☐ |
| B.6 | Cleanup confirmed | `care-db-restore-sandbox` does not exist, temp dir gone | ☐ |
| B.7 | Production untouched — recorded **after** | identical to B.3 | ☐ |

```sh
ls -lt /volume1/backups/caredeoghar | head -12
```

```sh
docker inspect --format '{{.Name}} running={{.State.Running}} restarts={{.RestartCount}} started={{.State.StartedAt}}' care-db care-api care-web
```

```sh
bash scripts/verify-backup-restore.sh /volume1/backups/caredeoghar
```

Encrypted artifact only — the passphrase goes through the environment, never onto a command
line (`ps` and shell history keep it) and never into a file in the deploy directory:

```sh
read -rs PASSPHRASE
```

```sh
BACKUP_PASSPHRASE="$PASSPHRASE" bash scripts/verify-backup-restore.sh /volume1/backups/caredeoghar
```

```sh
unset PASSPHRASE
```

The script starts `postgres:16-alpine` as container `care-db-restore-sandbox`, database
`diagnostic_erp_restore_test`, with a random per-run password and **no published host port
at all**; it refuses a data-only dump, restores with `ON_ERROR_STOP=1`, fails on an empty
`patients`/`bills` restore, and cleans up on every exit path including Ctrl-C. It does **not**
compare against the live database's counts — reading the restored numbers against what the
clinic expects is the step that catches a backup of the wrong database, and it is yours.

```sh
docker ps -a --format '{{.Names}}' | grep -c restore-sandbox
```

Expected `0`. Then re-run the B.3 command and diff. **Never** `docker volume prune` on this
box (~50 anonymous volumes belong to other projects), never add `-v` to a `compose down`.

`scripts/synology-restore.sh` is a different thing: it restores **over** a database, and
these dumps contain `DROP`-style statements (`pg_dump --clean --if-exists`). Use it only as
a deliberate rollback, only after B.4 proved the artifact, only against a scratch database
first, only with the owner in the loop.

### C. PACS

| # | Check | Pass condition | Result |
|---|---|---|---|
| C.1 | Orthanc container up | `status=running`, `restarts` not climbing | ☐ |
| C.2 | `care-api` → Orthanc `/system` | JSON with `"Version"` and `ApiVersion` | ☐ |
| C.3 | If C.2 failed: which cause | container DNS resolution vs the two projects' network lists | ☐ |
| C.4 | DICOMweb mounted | `GET $ORTHANC_INTERNAL_URL/dicom-web/studies?limit=1` returns a JSON array (possibly `[]`) | ☐ |
| C.5 | The OHIF image actually running | `image`, `imageid`, and the image's `built=` time | ☐ |
| C.6 | OHIF version, and its `care-pacs` commit | `build-info.json` answers version/commit; **it does not contain a `care-pacs` SHA** | ☐ |
| C.7 | Image retrieval the way the report prints it | `200` + `Content-Type: image/jpeg` | ☐ |
| C.8 | ERP endpoints on the published address | `deploy-health.mjs` exits 0 | ☐ |
| C.9 | Human smoke in the browser | attach → caption → reorder → save → reopen → Print → Download PDF → durable PDF | ☐ |

Ask for `.State.Health` on `care-orthanc` and you get an error: the shipped
`docker-compose.production.yml` defines no healthcheck for it.

```sh
docker inspect --format '{{.Name}} status={{.State.Status}} restarts={{.RestartCount}} started={{.State.StartedAt}} image={{.Config.Image}}' care-orthanc
```

```sh
docker exec care-api sh -c 'wget -qO- "$ORTHANC_INTERNAL_URL/system"'
```

```sh
docker inspect --format '{{.Name}} -> {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' care-api care-orthanc
```

`ORTHANC_INTERNAL_URL` defaults to `http://care-orthanc:8042` (`docker-compose.yml:336`).
`care-pacs` is a separate compose project on `care-pacs-net`, so that name resolves **only if
the two projects share a user-defined bridge** — C.3 distinguishes "Orthanc down" from
"projects not joined", and they have completely different fixes.

Two traps that have burned time on this box: a container **cannot reach the NAS's own LAN IP
on a Docker-published port** (Synology hairpin/DNAT block — measured), so a failure against
`172.16.1.139:8042` from inside `care-api` proves nothing about Orthanc; and
`ORTHANC_CHANGES_POLLER` must be `false` while `care-erp-sync` runs, or two writers race the
same worklist.

```sh
docker exec care-api sh -c 'wget -qO- "$ORTHANC_INTERNAL_URL/dicom-web/studies?limit=1"'
```

For a specific instance, Orthanc 1.13 keys path-style lookups by its internal id, so
`…/instances/{SOPInstanceUID}` returns **400**; the lookup must be QIDO-filtered
(`…/instances?00080018=<SOP>`), and an unmatched filter is a `200` with an empty array, never
a 404. Take the UIDs from the ERP's own image references, not from a patient list.

```sh
docker inspect --format '{{.Name}} status={{.State.Status}} image={{.Config.Image}} imageid={{.Image}}' care-ohif
```

```sh
docker image inspect --format 'built={{.Created}} tags={{.RepoTags}}' care-ohif-enterprise:v1
```

```sh
curl -fsS http://127.0.0.1:3010/care/build-info.json
```

```sh
curl -fsS http://127.0.0.1:3010/index.html | grep -o 'src="[^"]*\.js"' | sort
```

The second command is the only commit discriminator that works here: blob hashes matched
current main 5/5 for files D2 never touched, so they prove nothing. Measured 2026-10-10 on
this NAS: `ohifRef=v3.10.0`, `ohifCommit=0b6e9cba…`, `careViewerVersion=1.2.0-p2-radiologist`.
Until someone reads the injected `<script src>` list, the honest statement is "OHIF is
serving, version known, `care-pacs` commit not established". An ERP deploy never rebuilds
this container — `docker compose up -d --build` in the ERP project does not touch it.

```sh
docker exec care-api sh -c 'wget -S -qO /dev/null "$ORTHANC_INTERNAL_URL/dicom-web/studies/STUDY/series/SERIES/instances/SOP/rendered" 2>&1 | head -8'
```

Status and size only — never pipe image bytes into a terminal or a log. Frames are 1-based
(`…/frames/{n}/rendered`) and a single-frame object has no `frames/` path at all. If the
answer is not 200, get Orthanc's own status line: `lib/reportImages.ts:186` returns `null`
for **every** non-OK response, so a 429, a 500, a timeout and a corrupt object are one event
downstream. Do not infer "Orthanc down" from this leg.

```sh
node scripts/deploy-health.mjs --host-port "${HOST_PORT:-8888}"
```

```sh
docker exec care-api sh -c 'echo "OHIF_URL=$OHIF_URL"'
```

`deploy-health.mjs` probes `/nginx-health`, `/api/healthz` and `/api/health/schema` **and
checks the bodies**, because `care-web` answers an unknown path with the SPA's `index.html`
at 200 — a bare successful `curl` is not evidence. There is no port 8080 published on the
host. If `OHIF_URL` starts with `/`, resolve it against the ERP origin; the clinic's address
is not a fact this repository owns. There is no `OHIF_PUBLIC_BASE_URL` in compose.

### D. HOPE integration

| # | Check | Pass condition | Result |
|---|---|---|---|
| D.1 | Which side is configured | the four names report `set`/`unset`; **no value is printed** | ☐ |
| D.2 | The HOPE partner row exists and is active | `code=HOPE`, `is_active=t`, `callback_url` matches D.1 | ☐ |
| D.3 | Traffic is enabled | `ff_hope_care_referrals.enabled = t`, or `HOPE_CARE_INTEGRATION_FORCE=1` | ☐ |
| D.4 | Outbound reachability, no side effect | any HTTP status line answers from inside `care-api` | ☐ |
| D.5 | Inbound reachability + auth refused without a credential | open `health` returns the contract version; an unsigned POST returns **401** | ☐ |
| D.6 | One authorized test send, from the UI | `200` with `emitted: true, alreadySent: false` | ☐ |
| D.7 | The expected report status reached HOPE | outbox row `status=sent`, `external_result_links.delivered_at` non-null, `report_status` as intended | ☐ |
| D.8 | No duplicate was created | re-sending the same report returns `alreadySent: true` and the row counts do not move | ☐ |

D.1 — `HOPE_PARTNER_KEY` and `INTEGRATION_HOPE_SIGNING_SECRET` are live credentials. Print
presence, never values:

```sh
docker exec care-api sh -c 'for v in HOPE_PARTNER_KEY INTEGRATION_HOPE_SIGNING_SECRET HOPE_CARE_INTEGRATION_FORCE INTEGRATION_HOPE_CALLBACK_URL; do if [ -n "$(printenv $v)" ]; then echo "$v=set"; else echo "$v=unset"; fi; done'
```

D.2 — never `select *` from this table. `key_prefix` is the **first 14 characters of the live
partner API key** (`bootstrapHopeCareIntegration.ts:72`) and `key_hash` is its SHA-256:

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select code, is_active, callback_url, source_org_code, destination_org_code, permissions, last_used_at from public.integration_partners where code = '"'"'HOPE'"'"'"'
```

The row is created or refreshed on every API start by `bootstrapHopeCareIntegration()` —
which is why D.2 must agree with D.1. `permissions` should be exactly the six in
`HOPE_INTEGRATION_PERMISSIONS` (`bootstrapHopeCareIntegration.ts:27-34`).

D.3 — the background dispatcher is dark unless the flag is on:

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select key, enabled from public.feature_flags where key = '"'"'ff_hope_care_referrals'"'"'"'
```

`tickOutbox()` runs every minute and returns immediately unless `integrationEnabled()`
(`services/integration/scheduler.ts:22-34,76`), which is the flag **or**
`HOPE_CARE_INTEGRATION_FORCE=1`. The flag is cached for 60 s, so a change takes up to a
minute to take effect.

D.4 — reach the callback with a **GET**, never a POST. CARE's outbound events are consumed by
HOPE's handler, which is not in this repository, so CARE cannot promise that an unsigned POST
is a no-op on the far side; a GET cannot create a report and still proves the socket:

```sh
docker exec care-api sh -c 'wget -S -qO /dev/null -T 8 "$INTEGRATION_HOPE_CALLBACK_URL" 2>&1 | head -4'
```

Any HTTP status line — 200, 401, 405, 404 — means the endpoint is reachable and answering.
Read `deploy/synology/care.env:125` before you interpret a failure: the configured default is
`http://172.16.1.139:7080/api/integration/care-callback`, and **172.16.1.139 is this NAS's own
LAN address** (`care.env:6`, `NETWORK_LAN_HOST`). That is the exact address form measured to
be blocked for container-originated calls (hairpin/DNAT). So a `fetch failed` / timeout here,
while a browser on the LAN opens `http://172.16.1.139:7080/` fine, is **not** "HOPE is down" —
it means the callback URL must be a container-DNS name on a shared bridge or the docker
gateway, and it will keep failing dispatch until someone changes it. `hope.env:51`
(`CARE_REFERRAL_URL=http://172.16.1.139:8888/api/integration/v1`) has the same shape in the
opposite direction.

D.5 — the inbound legs, with no credential involved. Take the published port from the
container rather than assuming `8888`, because `HOST_PORT` lives in `.env` and the clinic's
address is not a fact this repository owns:

```sh
HP=$(docker port care-web 80/tcp | head -1 | sed -E 's/.*:([0-9]+)$/\1/'); echo "published ERP port = $HP"
```

```sh
curl -fsS "http://127.0.0.1:${HP}/api/integration/v1/health"
```

Expected `{"ok":true,"service":"care-integration-inbound","contractVersion":"1.0"}` —
`routes/integration/inbound.ts:32` is deliberately unauthenticated. Then prove the gate is
actually wired:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "http://127.0.0.1:${HP}/api/integration/v1/diagnostic-referrals" -H 'content-type: application/json' -d '{}'
```

Expected `401` (`middleware/requireIntegrationPartnerAuth.ts:88-91`, `missing_key`). Say so
out loud to whoever objects: **this writes exactly one denied-attempt row** into
`integration_partner_audit_log` — that insert is the proof the gate records what it refuses,
and it creates no referral, no order and no patient. Use `127.0.0.1` here, not the LAN IP, for
the same hairpin reason as D.4.

D.6 — one test case, and it must be synthetic or a referral the owner has explicitly named.
Use the Reporting Workspace **Send to Hope** button (`WorkspaceTopBar.tsx:682`) rather than
`POST /api/internal/radiology/send-report-to-hope` from a shell: the endpoint accepts a
`Bearer ${INTERNAL_API_KEY}` or a staff JWT (`routes/internal-radiology.ts:369`), and the
button is the path the clinic actually uses, so it tests that path. It refuses an unsigned
report with 409 `NOT_SIGNED` and an unlinked study with 409 `NO_REFERRAL`
(`internal-radiology.ts:1927-1930`) — both are correct answers, not failures.

D.7 — what "the expected report status was received" means on the CARE side:

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id, event_type, status, attempts, max_attempts, last_error, sent_at from public.integration_outbox order by id desc limit 10"'
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id, referral_id, care_report_id, report_status, is_critical, emitted_outbox_id, delivered_at from public.external_result_links order by id desc limit 10"'
```

`report_status` is `final`, or `amended` for a correction (`emitReportToHope.ts:222`).
`delivered_at` is stamped only on a 2xx from HOPE, in the same leg that flips the outbox row
to `sent` (`outbox.ts:186`). Two failure signatures worth knowing:
`last_error = delivery_not_configured` means the URL or the secret is missing and the event is
**deliberately never dead-lettered** (`outbox.ts:146-158`) — it clears itself once the partner
is provisioned; anything else (`timeout`, `http_500`) is a real transport or HOPE-side failure,
and after `max_attempts` (default 8, `lib/db/src/schema/integrationOutbox.ts:34`) the row goes
`dead`. The workspace's own number for that is `sync_errors` in
`GET /api/hope-referrals/stats` (`routes/integration/hopeReferrals.ts:58-59`). Confirming the
status on **HOPE's** side needs Hope's logs or its UI — CARE can only show what it sent and
what the far end answered.

D.8 — no duplicate clinical report is created. The guard runs before anything is inserted: an
existing `(referral_id, care_report_id)` row in `external_result_links` returns
`{emitted: false, alreadySent: true}` and only re-dispatches pending work
(`emitReportToHope.ts:167-179`). The outbox is idempotent a second time on
`idempotency_key = diagnostic_report.finalised:<referralUuid>:<reportId>`
(`emitReportToHope.ts:233`, `outbox.ts:41-52`).

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from public.external_result_links"'
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from public.integration_outbox where idempotency_key like '"'"'diagnostic_report.%'"'"'"'
```

Click Send to Hope a second time on the same report, then re-run both counts. **They must not
move.** If the second click adds a row, that is a P0 finding about the integration, and the
deployment stops.

---

## Part 2 — Deployment clearance register

Every outstanding P0 and P1 from `CARE_ERP_PRODUCTION_READINESS.md` (the component view) and
the four decision items in its §Decision (the action view). "Closes when" is the exact state
of the world, not an intention.

| ID | Item | Sev | Closes when | Evidence that closes it | Blocks deployment |
|---|---|---|---|---|---|
| CL-1 | The migration-ledger audit has never been run against the clinic database. Before #955 a Drizzle file that raised was **recorded as applied and then skipped forever**, so the live schema can be half-applied while the ledger says complete | **P0** | Part 1 §A has run and printed **0 critical** | the `N critical, M warnings, K informational` line, kept with the run date; `output/ledger-audit-<date>.json` if `--json` was used | **Yes — every deploy.** The two critical codes (`CRITICAL_TABLE_MISSING`, `CRITICAL_COLUMN_MISSING`) describe objects the running app assumes, so they are true regardless of whether this deploy ships a schema file. It takes seconds and cannot write |
| CL-2 | No backup has been proven restorable on this NAS recently; `deploy-synology.sh` never verifies one | **P1** | Part 1 §B ends `🎉 PASS`, with B.3 = B.7 | the artifact filename + timestamp, the restored table/row counts, the sandbox-absent check | **Yes for a deploy that ships schema** (migrations here are forward-only, so a restore is the only rollback). No for code-only, though running it anyway costs minutes |
| CL-3 | `deploy-synology.sh` takes no backup before `git reset --hard` + `compose down --remove-orphans` | **P1** | A fresh artifact exists **and** §B has proved it, inside the same window as the deploy | B.1's filename with today's timestamp, plus the app-image IDs recorded before the build: `docker inspect --format '{{.Name}}={{.Image}}' care-api care-web` | **Yes if CL-2 is not done.** The script is the clinic's only deploy path and it will not stop itself |
| CL-4 | Orthanc may not resolve from inside `care-api`, because `care-pacs` is a separate compose project | **P1** | §C.2 returns `"Version"`, or §C.3 shows the two containers sharing a user-defined bridge and names the fix | C.2's JSON, or the two network lists from C.3 | **No** for the ERP serving reports — it degrades to whatever image set is already frozen. **Yes** for rolling out PACS image attach |
| CL-5 | The `care-pacs` commit of the running `care-ohif` is unknown, and an ERP deploy cannot rebuild it | **P1** | §C.6's `<script src>` list has been read and compared against `care-pacs` main, or the image has been rebuilt and re-read | the `build-info.json` output + the script list + the decision (rebuild or accept) | **No** for the ERP. **Yes** for claiming any viewer-side fix (D2 displayed-image identity) is live — merged code in `care-pacs` is dormant until someone rebuilds that image |
| CL-6 | HOPE callback liveness is unverified, and the configured default URL is the NAS's own LAN IP on a published port — the shape measured to fail from inside a container | **P1** | §D.4 answers with an HTTP status, §D.6–D.8 pass on one authorized test case, and both sides record the same status | D.7's outbox + `external_result_links` lines, D.8's unchanged counts, and HOPE's own confirmation | **No** for the ERP serving reports. **Yes** for Hope referral traffic — enabling the flag without this sends into an endpoint nobody has reached |
| CL-7 | Live production secrets are committed in `deploy/synology/care.env`, `hope.env` and are re-appended by `deploy-synology.sh:117-120` | **P1** (owner-deferred) | The owner's rotation window runs, with history remediation | an owner decision, not a command | **No** — deferred deliberately and by name. Recorded so nobody reports it as fixed. It is not a deploy gate; it is a standing exposure |
| CL-8 | The server-side print leg collapses 429 / 500 / timeout / corrupt into one "no image" event (`lib/reportImages.ts:186`) | **P1** for what staff are told | `fetchPrintImageBytes` returns a typed outcome and a `*.request.test.ts` pins each class | the test, plus the four messages read on a screen | **No.** The client legs (#950) are green; this is the P2-for-deploy / P1-for-trust item already listed in the readiness matrix |

Items classified **P2** stay in the matrix's own severity column and gate nothing: the persona
prompt file's duplicated switch arms, the 20 test files this Windows worktree cannot collect,
the two `backupHealth` POSIX-path cases, and `CARE_ERP_OPEN_ISSUES.md` row 13's residual
"no human has read today's durable PDF" (closed by §C.9).

### Gate rule

A deploy is **cleared** when all four are true:

1. **CL-1** has run and printed 0 critical.
2. **CL-2** passed within the same window **if** this head ships any new `migrations/*.sql` or
   `lib/db/drizzle/*` file — check with
   `git diff --name-only <deployed-sha>..HEAD -- migrations lib/db/drizzle | head`.
3. §C.8 (`deploy-health.mjs`) exits 0 after the deploy, and §C.9 has been done by a human on
   one real report from today's queue.
4. §D.8's two counts did not move — if the deploy touches the integration, or the flag is on.

Anything else is a **WARNING** to be read, not a failure to be talked past. A green CI run on
`main` clears none of these rows: CI proves the code, not the clinic's box.

### Sign-off

| Line | Name | Date | Result |
|---|---|---|---|
| Database (§A) | | | |
| Backup (§B) | | | |
| PACS (§C) | | | |
| HOPE (§D) | | | |
| Deploy authorized | | | |

**Decision carried into this gate: CONDITIONALLY READY** — no P0 in the code, one P0-shaped
unknown that only §A can settle, and four NAS-side verifications this repository can ask for
but cannot answer for the clinic.
