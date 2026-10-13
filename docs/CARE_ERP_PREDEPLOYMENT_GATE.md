# CARE ERP / PACS — Pre-deployment Gate

_Concise run-list for the operator, in the order the checks have to happen. §A–§C are the
short form of `CARE_ERP_CLINIC_READINESS_CHECKS.md` — that file carries the reasons, the
expected output verbatim, and the limitations; this file carries only what to run and what
counts as a pass. §D (HOPE) is written here for the first time, line-cited to the code that
implements each leg._

What this document does **not** do: it deploys nothing, restarts nothing, merges nothing,
migrates nothing, restores over no live data, rotates and prints no credential. Every
command was checked against the file that ships it, at `main` = `46d36612` (the §A–§C
procedures themselves landed in #965). **None of them
has been run against the clinic**, because that is the owner's box and the owner's decision.

## What is already verified, and what this page cannot verify for you

| Already verified, with evidence | Never performed — only the clinic NAS can answer it |
| --- | --- |
| CI green on both required jobs at the merged head (`0e801cf1` → `9d87cfc2`), and at `3209eabb` of this document's own branch | §A against **the clinic database**. The audit has only ever run against synthetic ones |
| Fresh Windows `core.autocrlf=true` checkout: shebangs, fixtures, compose and `.mjs`/`.cjs` all land as LF; **65 passed / 65** across the four affected suites | §B against **the clinic's backup artifacts**, on the clinic's Docker host |
| The audit's detection proven on three synthetic databases, clean control **0 critical / 0 warnings / 1 informational** | §C's Orthanc/OHIF legs against **the running containers** and the real `care-pacs` image |
| The audit's read-only guarantee asserted by the suite (29 tests) and broken deliberately by 4/4 mutants | §D's connectivity in both directions, and HOPE's side of the contract |
| Every code citation in this file re-checked against files that are byte-identical in current `main` | §C.9 read by a human on a real report from today's queue |

So this page is a set of instructions, not a result. **Nothing in Part 1 has been executed
anywhere**, which is why every box is empty; a filled-in Part 1 is the artifact this gate asks
for, and Part 2 is only closed by reading it back.

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
docker exec care-api sh -c 'printenv DATABASE_URL | sed -E "s#://[^@/]*@#://REDACTED@#"'
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
| B.2 | Its timestamp is inside the retention window | `retention_days` is 30 for the `DB`/`config` jobs and 5 for `Nightly` on this box (not the script's 14-day default); a weeks-old newest file is a finding about the backup job | ☐ |
| B.3 | Production untouched — recorded **before** | `started=` / `restarts=` captured for `care-db care-api care-web` | ☐ |
| B.4 | Restore ran in isolation | ends `🎉 PASS` | ☐ |
| B.5 | Schema and critical tables present | restored table count > 0 and `patients` / `bills` / `payments` / `vouchers` / `patient_reports` non-zero | ☐ |
| B.6 | Cleanup confirmed | `care-db-restore-sandbox` does not exist, temp dir gone | ☐ |
| B.7 | Production untouched — recorded **after** | identical to B.3 | ☐ |

#### B.0 — where this clinic's backups actually land (read this before B.1)

An earlier draft of this page told you to look in `/volume1/backups/caredeoghar`. That directory
does not exist on `AbinashNAS` and never did, so B.1 as written would have reported "no backups"
about a box that has been taking them hourly. The destination is decided by two facts that have to
be read together, because the job rows store a **container** path:

| Measured 2026-10-13 | Value |
|---|---|
| `.env` | `BACKUP_HOST_DIR=/volume1/backup/care-erp` — `backup`, singular, not `backups` |
| `docker-compose.yml:445` | `- ${BACKUP_HOST_DIR:-/volume1/docker/backups}:/volume1/docker/backups` |
| host directory holding the live artifacts | `/volume1/backup/care-erp/{db,auto-db,config}` |
| host directory holding nothing newer than **2026-08-26** | `/volume1/docker/backups/{db,auto-db,config}` — the abandoned pre-fix default, ~203 GB of stale files |
| newest artifact | `/volume1/backup/care-erp/db/backup_DB_2026-10-13T03-30-57-419Z.sql.enc`, 775,648,192 bytes, mode 0644 root:root |
| cadence | hourly (~22 runs per job per day), **not** the `0 2 * * *` recorded in `backup_jobs.schedule` |
| history | `db` 1272 files back to 2026-09-13 · `auto-db` 104 · `config` 636; `retention_days` 30, and 5 for the `Nightly` job |
| produced by | `backup_job_logs.notes` records `pg_dump` on 6,752 of 6,813 runs — schema-complete, not the data-only fallback |
| restore ever verified | **no** — `public.backup_verification` contains 0 rows, so `restore_test_status` has never been set |

Read the destination from the checkout instead of assuming it, then list it:

```sh
cd /volume1/docker/care-erp-github/care-on-synology1
```

```sh
BD=$(grep -E '^BACKUP_HOST_DIR=' .env | cut -d= -f2-); echo "destination = $BD"; ls -lt "$BD/db" | head -8
```

B.1 and B.2 are answered by that listing. Note that the `file_path` written in `backup_job_logs`
still reads `/volume1/docker/backups/db/…` — the container half of the bind mount. That string is
correct inside the container and wrong on the host, which is precisely the confusion that made four
weeks of phantom backups look healthy.

```sh
ls -lt "$BD/db" | head -12
```


```sh
docker inspect --format '{{.Name}} running={{.State.Running}} restarts={{.RestartCount}} started={{.State.StartedAt}}' care-db care-api care-web
```

```sh
bash scripts/verify-backup-restore.sh "$BD/db"
```

Pass `$BD/db`, **not** `$BD`. The script takes the newest file it can find, and the `config` job
writes last in every hour (03:30:57 for `db`, 03:31:04 for `config` on this box), so pointing it at
the parent verifies a 3.6 MB configuration-only artifact and prints `🎉 PASS` over a backup that
never contained a patient row. Same trap for `auto-db`: it is a `FULL` snapshot of the same schema,
so a pass there says nothing about the `DB` jobs the rollback would actually use.

Encrypted artifact only — the passphrase goes through the environment, never onto a command
line (`ps` and shell history keep it) and never into a file in the deploy directory:

```sh
read -rs PASSPHRASE
```

```sh
BACKUP_PASSPHRASE="$PASSPHRASE" bash scripts/verify-backup-restore.sh "$BD/db"
```

```sh
unset PASSPHRASE
```

`candidatePassphrases()` tries `BACKUP_PASSPHRASE` then `SESSION_SECRET`, so the passphrase that
must be supplied is the one **in force when that file was written**. This box rotated
`SESSION_SECRET` around 2026-10-03: the NAS checkout carries an untracked
`.env.before-rotate-2026-10-03` beside the live `.env` (along with `BEFORE-QODER.env` and
`before1234.env`), and the 30-day `db` history runs back to 2026-09-13, straight across that
boundary. Nothing in the job rows records which of the two keys encrypted a given file, so a
pre-rotation artifact may only be readable with the superseded secret. Whether `BACKUP_PASSPHRASE` was already set before
the rotation is not knowable from metadata; B.4 is what settles it. If the newest artifact decrypts
and a September one does not, the clinic has 30 days of backup names and only a few days of backup.
Confirm before the deploy, not during an incident, that the passphrase is also stored somewhere that
survives the NAS.

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

Every in-container HTTP probe below runs through `node`, not `wget`. Measured on this box
2026-10-13: `care-api` has **no `wget`, no `nc`, no `python3`** — only `curl` and `node`
`v22.22.3`. A `wget` line pasted there fails with `wget: not found`, which reads exactly like the
endpoint being down. This is the canonical form; the path is the only argument, and the URL comes
from the container's own environment so nothing has to be exported into your shell:

```sh
docker exec care-api node -e 'const u=process.env.ORTHANC_INTERNAL_URL+process.argv[1];fetch(u,{signal:AbortSignal.timeout(8e3)}).then(async r=>{const s=await r.text();console.log("HTTP",r.status,(r.headers.get("content-type")||"-").split(";")[0],s.length,"bytes");console.log(s.slice(0,220))}).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message)))' /system
```

```sh
docker exec care-api sh -c 'command -v wget curl nc node python3'
```

Run that second line once before trusting any §C or §D verdict. Ask it of the HOPE container too
before using the §D inbound-leg lines — that image has not been checked from here, so do not
assume it matches `care-api`.

```sh
docker inspect --format '{{.Name}} -> {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' care-api care-orthanc
```

`ORTHANC_INTERNAL_URL` defaults to `http://care-orthanc:8042` (`docker-compose.yml:336`).
`care-pacs` is a separate compose project on `care-pacs-net`, so that name resolves **only if
the two projects share a user-defined bridge** — C.3 distinguishes "Orthanc down" from
"projects not joined", and they have completely different fixes.

Three traps on this box, all measured on it rather than assumed (2026-10-13):

- **The hairpin/DNAT block is interface-specific, so "the NAS's LAN IP" is not one property.**
  `AbinashNAS` answers on three: `eth0 192.168.1.137/24`, `eth1 172.16.1.139/16`,
  `eth2 192.168.1.47/24`. From inside `care-api`, `GET http://172.16.1.139:8042/system` returned
  **HTTP 200 in 50–67 ms** while the identical request to `http://192.168.1.137:8042/system`
  **timed out**. A timeout therefore names an *address*, not Orthanc. Never conclude "Orthanc is
  down" from one interface, and always take the host-side control before trusting a container-side
  failure.
- **The live `ORTHANC_INTERNAL_URL` is not the compose default.** It is `http://172.16.1.139:8042`
  (`OHIF_URL=http://172.16.1.139:3010`), because `care-orthanc` does **not** resolve from `care-api`
  — `DNS fail ENOTFOUND`, separate compose project, separate bridge. So C.3's verdict here is
  "projects not joined", and the clinic papers over it with an interface address. That works today
  and fails silently the day `eth1` is renumbered; record which of the two you are relying on.
- `ORTHANC_CHANGES_POLLER` must be `false` while `care-erp-sync` runs, or two writers race the
  same worklist (it is `false` on this box). `/dicom-web/system` returns **404** and always will —
  the DICOMweb plugin exposes no `/system`; that 404 is not an outage.

```sh
docker exec care-api node -e 'const u=process.env.ORTHANC_INTERNAL_URL+process.argv[1];fetch(u,{signal:AbortSignal.timeout(8e3)}).then(async r=>{const s=await r.text();console.log("HTTP",r.status,(r.headers.get("content-type")||"-").split(";")[0],s.length,"bytes");console.log(s.slice(0,220))}).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message)))' '/dicom-web/studies?limit=1'
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
docker exec care-api node -e 'const u=process.env.ORTHANC_INTERNAL_URL+process.argv[1];fetch(u,{signal:AbortSignal.timeout(15e3)}).then(r=>console.log("HTTP",r.status,(r.headers.get("content-type")||"-").split(";")[0],"len="+(r.headers.get("content-length")||"?"))).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message)))' '/dicom-web/studies/STUDY/series/SERIES/instances/SOP/rendered'
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

**Do not use `GET /api/health`'s `build.commit` to decide what is deployed.** Measured on this box
2026-10-13: the endpoint reported `2d51e8d7` while the checkout it was built from was at `46d36612`,
because the value is baked from `GIT_COMMIT` in `.env` at build time and nobody updates it by hand.
Three facts do answer the question, and all three are read-only:

```sh
git -C /volume1/docker/care-erp-github/care-on-synology1 rev-parse --short HEAD && git -C /volume1/docker/care-erp-github/care-on-synology1 status --short | head
```

```sh
docker inspect --format '{{.Name}} created={{.Created}} image={{.Config.Image}} imageid={{.Image}}' care-api care-web care-ohif
```

The first gives the revision the next build will use *and* how many dirty entries sit on top of it
(this checkout had four, three of them untracked `.env` variants); the second gives the image IDs the
running processes came from. Compare `created=` with the last `deploy-synology.sh` run: a checkout
that moved without the containers moving means the clinic is not on that code yet.

### D. HOPE integration

| # | Check | Pass condition | Result |
|---|---|---|---|
| D.0 | What is configured, and what has already happened | the live callback URL host is written down, and the outbox status distribution + last errors are read **before** anything is sent | ☐ |
| D.1 | Which side is configured | the four names report `set`/`unset`; **no value is printed** | ☐ |
| D.2 | The HOPE partner row exists and is active | `code=HOPE`, `is_active=t`, `callback_url` matches D.1 | ☐ |
| D.3 | Traffic is enabled | `ff_hope_care_referrals.enabled = t`, or `HOPE_CARE_INTEGRATION_FORCE=1` | ☐ |
| D.4 | Outbound reachability, no side effect | any HTTP status line answers from inside `care-api` | ☐ |
| D.5 | Inbound reachability + auth refused without a credential | open `health` returns the contract version; an unsigned POST returns **401** | ☐ |
| D.6 | One authorized test send, from the UI | `200` with `emitted: true, alreadySent: false` | ☐ |
| D.7 | The expected report status reached HOPE | outbox row `status=sent`, `external_result_links.delivered_at` non-null, `report_status` as intended | ☐ |
| D.8 | No duplicate was created | re-sending the same report returns `alreadySent: true` and the row counts do not move | ☐ |

D.0 — run this first, because it needs no probe and no send, and it usually settles the
question on its own. `integration_delivery_attempts` already holds HOPE's status code and
response body for every attempt ever made. The callback URL is an endpoint, not a credential, so
printing it is safe — and it is worth checking, because the tracked template
(`deploy/synology/care.env:125`) and `deploy/synology/README.md:9` both say
`http://172.16.1.139:7080/…` while `deploy/synology/NAS_OVERNIGHT_ENV_PATCH.env:3` records the
**live** value as `http://192.168.1.137:7080/…`. Two different NAS addresses; one of the two
documents is stale. **Do not diagnose from a template — read the container.**

```sh
docker exec care-api sh -c 'echo "callback=$INTEGRATION_HOPE_CALLBACK_URL"'
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select status, last_error, count(*), max(attempts) attempts, min(created_at::date) first, max(created_at::date) last from public.integration_outbox group by 1,2 order by 3 desc"'
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select o.event_type, a.attempt_no, a.http_status, left(coalesce(a.error,'"'"'''"'"'),40) error, left(coalesce(a.response_body,'"'"'''"'"'),60) response, a.created_at from public.integration_delivery_attempts a join public.integration_outbox o on o.id = a.outbox_id order by a.id desc limit 20"'
```

Read those three before D.4. `sent` + `delivered_at` on real rows means the path has worked from
this container, and no hairpin theory applies to it. Rows stuck at `pending` with
`delivery_not_configured` mean a missing URL or secret, not a network. `timeout`/`fetch failed`
means transport. `http_status` 401/403 means the far end rejected the signature. A 4xx with a
response body naming a business rule means HOPE received it and said no — which is a
**connectivity pass** and an application problem, and they need completely different fixes.

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
docker exec care-api node -e 'const u=process.env.INTEGRATION_HOPE_CALLBACK_URL,t=Date.now();fetch(u,{method:"GET",signal:AbortSignal.timeout(8e3)}).then(r=>console.log("HTTP",r.status,(Date.now()-t)+"ms")).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message),(Date.now()-t)+"ms"))'
```

Any HTTP status line — 200, 401, 405, 404 — means the endpoint is reachable and answering, and
then the hairpin question is settled for this container pair and no further.

Do **not** assume the NAS's own LAN address is unreachable from every container. What was
measured on the clinic NAS is one pair, on the staging project: a container calling
`192.168.1.137:8043` got `fetch failed` while the same URL worked from the LAN and from a
browser. Whether `care-api → :7080` behaves the same way is a fact about *this* pair, so run the
two controls and let them agree or disagree:

```sh
HOPE_URL=$(docker exec care-api printenv INTEGRATION_HOPE_CALLBACK_URL); curl -sS -o /dev/null -w "host→$HOPE_URL %{http_code} in %{time_total}s\n" --max-time 8 "$HOPE_URL"
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select callback_url from public.integration_partners where code='"'"'HOPE'"'"'"'
```

The first runs **on the NAS host**, outside any container, against the same URL — which is why it
reads the value out of the container first: `INTEGRATION_HOPE_CALLBACK_URL` exists in the API's
environment, not in your shell's. If the host gets a status and `care-api` does not, that is the
container-side address form — the fix is a shared user-defined network or the docker gateway, not
a HOPE restart, and HOPE is fine. If **neither** answers, HOPE itself is down or not listening on
that port. If both answer, CL-6's network half is closed and anything left is signature or
application level. The second command checks which URL the running bootstrap actually stored,
because `bootstrapHopeCareIntegration()` overwrites `callback_url` from the container environment
on every API start (`bootstrapHopeCareIntegration.ts:68-70,103`) — so the row is the live value,
and `deploy/synology/care.env` may not be. `hope.env:51`
(`CARE_REFERRAL_URL=http://172.16.1.139:8888/api/integration/v1`) has the same shape in the
opposite direction.

#### D.4a — the probe ladder, when D.0 says something is failing

Seven reads, in dependency order, each answering one question and nothing else. Run 1 first
because every other line uses its answer; substitute the values it prints rather than a value
copied from a tracked env file. `HOST`, `PORT` and `HOPE_CONTAINER` are **placeholders, not
commands** — paste probe 1's output and step 1's container name into them. Running a line with
the literal word `HOST` in it is not a network failure; it is a line you have not filled in yet.

```sh
docker exec care-api sh -c 'u=${INTEGRATION_HOPE_CALLBACK_URL#*://}; echo "${u%%/*}"'
```

```sh
docker exec care-api node -e 'const {Resolver}=require("dns").promises,r=new Resolver({server:"127.0.0.11",tcp:false});r.resolve4(process.argv[1]).then(a=>console.log("DNS ok",a.join(" "))).catch(e=>console.log("DNS fail",e.code||e.message))' HOST
```

```sh
docker exec care-api node -e "const n=require('net'),h=process.argv[1],p=+process.argv[2],s=n.connect({host:h,port:p,timeout:4000},()=>{console.log('TCP ok '+h+':'+p);s.removeAllListeners('error');s.destroy()});s.on('error',e=>console.log('TCP fail '+e.code));s.on('timeout',()=>{console.log('TCP timeout');s.destroy()})" HOST PORT
```

Then the two HTTP legs already written above — the GET from inside `care-api` (§D.4) and the
same URL from the NAS host (§D.4 control) — and the two directions' last pieces:

```sh
docker exec HOPE_CONTAINER sh -c 'command -v wget curl node python3 nc; echo "care_referral_url=$CARE_REFERRAL_URL"'
```

```sh
docker exec HOPE_CONTAINER node -e 'const u=process.env.CARE_REFERRAL_URL;if(!u){console.log("CARE_REFERRAL_URL is unset here: read it from the partner row (D.2) and record that you used that one");process.exit(0)}fetch(u+"/health",{signal:AbortSignal.timeout(6e3)}).then(async r=>console.log("HTTP",r.status,(await r.text()).slice(0,120))).catch(e=>console.log("inbound-leg-failed",e.name,e.message||(e.cause&&e.cause.message)))'
```

```sh
docker exec HOPE_CONTAINER sh -c 'curl -s -m 6 -o /dev/null -w "HTTP %{http_code} %{time_total}s\n" "$CARE_REFERRAL_URL/health"'
```

```sh
docker inspect --format '{{.Name}} -> {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' care-api care-web HOPE_CONTAINER
```

Probe 6 is the reverse leg and it is deliberately driven from **inside HOPE's own container,
using HOPE's own environment**: `CARE_REFERRAL_URL` (`deploy/synology/hope.env:51`) is the value
that application actually dials, and `127.0.0.1` from inside that container is HOPE, not CARE —
so any probe that hard-codes a loopback or an assumed port proves nothing about this leg. The
first line tells you which of `wget`/`curl`/`node` the image has — `care-api` turned out to have
only `curl` and `node`, so do not assume HOPE is the same — then run the matching form and say
which one you used. If `CARE_REFERRAL_URL` is unset there, read it from the partner row (§D.2)
instead and record which of the two you probed, because they can disagree.

`nslookup` is aimed at `127.0.0.11`, Docker's embedded resolver, so probe 2 answers exactly one
question: *does this project's DNS know that name?* A literal IPv4 in probe 1 means DNS is not
the failing class at all — skip 2. Probe 3 uses `node`, the same runtime and resolver the
dispatcher itself uses, so it cannot disagree with the app about reachability the way a shell
tool might.

| What you see | Class | What it does **not** mean |
| --- | --- | --- |
| probe 2 `SERVFAIL` / `nxdomain` for a name | **1 — network (name resolution)** | The service is down. Two compose projects simply do not share a resolver. |
| probe 3 `ENOTFOUND` | **1 — network (name)** | As above; the address never became a route. |
| probe 3 `EHOSTUNREACH` / `ETIMEDOUT`, and the host control answers | **1 — network (routing / the container-side address form)** | HOPE is unhealthy. The fix is the address or the network, not a restart. |
| probe 3 `ECONNREFUSED` | **2 — service unavailable** | A firewall. Something answered and had nothing listening on that port — check the container is up and the port is published. |
| probe 4 connects, §D.6 gets 401/403 | **3 — authentication** | A network fault. The packet arrived and the far end read it. |
| probe 4 answers 200/4xx to the GET, and `integration_delivery_attempts` shows 4xx with a body | **4 — application-level rejection** | Connectivity. **This row is a connectivity pass** — HOPE received the event and declined it for a stated reason. |

Both directions matter: HOPE's own `CARE_REFERRAL_URL` (`deploy/synology/hope.env:51`) is a NAS
LAN address too, so probe 6 is the same ladder pointed the other way, and it is the leg that
breaks *first* in practice because it is the one a browser never exercises.

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

## Part 1 · Run order — the ten steps, in the order to do them

`SAFE NOW` means the command cannot change anything: it reads a container, a socket or a
`SELECT`. `AUTHORIZATION` means stop and get the owner's go-ahead first, because it either
touches the clinic database, spends a real test case, or changes what staff see. Nothing here
restarts, rebuilds, redeploys or reconfigures.

| # | Step | Where | Command or gate | Safe now? |
|---|---|---|---|---|
| 1 | Identify the production containers actually running | §Conventions | `docker compose ls` · `docker ps --format '{{.Names}} {{.Status}} {{.Image}}'` — expect `care-db care-api care-web care-redis care-db-patch-v2 care-schema-verify` from the ERP project, plus `care-orthanc care-ohif care-erp-sync care-tailscale-ohif` from `care-pacs`, and a Hope container if one exists | **SAFE NOW** |
| 2 | Verify the target database's identity | §A.1–A.2 | the three redacted pre-flight reads, then the read-only refusal proof | **SAFE NOW** |
| 3 | Run the migration-ledger audit | §A.3 | `docker compose run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs` | **AUTHORIZATION** — it connects to the clinic DB. It is read-only by construction and proves so in step 2, but it is still the clinic database |
| 4 | Verify current backup availability | §B.0–B.2 | `BD=$(grep -E '^BACKUP_HOST_DIR=' .env \| cut -d= -f2-); ls -lt "$BD/db" \| head -8` | **SAFE NOW** |
| 5 | Restore into an isolated temporary database | §B.3–B.7 | `bash scripts/verify-backup-restore.sh "$BD/db"` — the `db` directory, not `$BD` | **SAFE NOW for production** — no published port, its own container and database, cleanup on every exit path. Say it out loud anyway: it starts a Postgres and reads a real patient dump into a sandbox on this box |
| 6 | Verify Orthanc | §C.1–C.5 | the §C `node -e` fetch of `/system`, then QIDO, then one `/rendered` status — **not** `wget`, which `care-api` does not have | **SAFE NOW** |
| 7 | Verify OHIF | §C.5–C.7 | `docker inspect`, `build-info.json`, the injected `<script src>` list | **SAFE NOW** |
| 8 | Verify the HOPE callback path | §D.0–D.5 | read the outbox history, then the GET from inside `care-api`, then the host-side control, then the unsigned inbound POST for 401 | **SAFE NOW** (D.0–D.5 send no clinical event). **D.6 is AUTHORIZATION** — one synthetic or owner-named case, clicked once, counted twice |
| 9 | Record the evidence | §Recording rule, §Sign-off | the `N critical / M warnings / K informational` line, the restore's `🎉 PASS`, the artifact name + timestamp, the two unchanged D.8 counts, and the §C.9 human read | **SAFE NOW** |
| 10 | Update the clearance register | Part 2 | move each CL row from *open* to *closed with evidence*, or leave it open and say why | **SAFE NOW** — but the update is what makes the next deploy decision readable |

If step 3 prints any critical, **stop the whole sequence there**: steps 4–8 are pointless over a
schema nobody can vouch for, and step 10 must record the finding rather than the intent.

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
| CL-6 | HOPE callback liveness has never been observed, and the two tracked config documents disagree about which NAS address it points at (`care.env:125` / `README.md:9` say `172.16.1.139:7080`, `NAS_OVERNIGHT_ENV_PATCH.env:3` says the live value is `192.168.1.137:7080`) | **P1** | §D.0's outbox history has been read, §D.4 answers with an HTTP status from inside `care-api`, §D.6–D.8 pass on one authorized test case, and both sides record the same status | D.0's status distribution, D.7's outbox + `external_result_links` lines, D.8's unchanged counts, and HOPE's own confirmation | **No** for the ERP serving reports. **Yes** for Hope referral traffic — enabling the flag without this sends into an endpoint nobody has observed answering |
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
