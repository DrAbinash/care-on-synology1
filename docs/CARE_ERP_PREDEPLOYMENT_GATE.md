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
| A.1 | The ERP is pointed at the database you think it is | `current_database()` = your `DB_NAME`, `pg_is_in_recovery() = f`, `server_version` recorded, identity row `app_name = care-erp` **and its `instance_id` written down** | ☐ |
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
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select current_database(), pg_is_in_recovery(), setting from pg_settings where name='"'"'server_version'"'"'"'
```

```sh
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select app_name, environment, instance_id, created_at from public.system_database_identity"'
```

Both forms were checked against the shipped DDL (`docker/db-patch-entrypoint.sh:146-152` creates
`id, app_name, environment, instance_id, created_at`) and then run verbatim on the clinic database
2026-10-13: the identity row is `care-erp | production | bd62c32b92733266c8b521a171f88232 |
2026-07-08 08:53:46.432625+00` and the version read is `diagnostic_erp | f | 16.14`. Take the
`instance_id` **in writing**, not just `app_name`: it is the md5 minted the first time the stamping
script ever touched that database, so it is the only field that distinguishes the clinic's
`diagnostic_erp` from a *different* database that happens to carry the same `app_name` — a second
project stamped with `care-erp`, or the staging stack, matches on `app_name` and cannot be told
apart without it. It does not survive a restore: a database rebuilt from a production dump copies
the row, `instance_id` included, so it identifies the wrong-database mistake, not the
restored-onto-itself one. `pg_settings.name='server_version'` and `current_setting('server_version')`
are equivalent; the former also gives `server_version_num` (`160014`) if you need to compare exactly.

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
docker compose -p care-erp-github run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs
```

`-p` is not decoration. Measured 2026-10-13 from this checkout: a bare `docker compose ps` listed
**no containers** because compose derives the project name `care-on-synology1` from the folder,
while the live stack belongs to `care-erp-github`. Run without `-p` and the audit exits on a
connection error that looks like a dead database; "fix" that by removing `--no-deps` and compose
starts a **second** empty PostgreSQL against the same password, which the audit then reports as
roughly two hundred missing tables. Both flags are load-bearing. `--no-deps` starts no database, no API, no migration container. `schema-verify` is chosen
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
| D.4 | Outbound reachability, no side effect | the TCP layer and the HTTP layer are recorded **separately, per address**, and the same URL is tried from the NAS host as a control | ☐ |
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

On 2026-10-13 the clinic read `192.168.1.137:7080`, and that argument was settled by measurement
rather than by which file is newer: from inside `care-api`, `172.16.1.139:7080` completes TCP and
answers **HTTP 401 in 88 ms** while `192.168.1.137:7080` never completes TCP at all (§D.4). The
tracked template was the working address and the live value was the broken one. `hope_hospital_app`
publishes container `5000` to host `7080` on `0.0.0.0`, and no HOPE container name resolves from
`care-api` (`hope_hospital_app`, `hope-erp`, `hope_erp` → ENOTFOUND; it lives on
`hope_erp_network`, the ERP on `care-erp-github_default`), so an interface address is the only
form available to this pair until someone joins a bridge.

The address is not an orphan either: `deploy/synology/care.env:16` defines `NETWORK_LAN_HOST`,
and `:18-19` reserve `NETWORK_LAN_HOST_ALT` / `VITE_NETWORK_LAN_HOST_ALT` for exactly the case this
box turned out to be — "some clinic VLANs route only to this address", with a second NAS LAN IP
beside the first. `INTEGRATION_HOPE_CALLBACK_URL` at `care.env:125` is written out in full rather
than interpolated from it, which is how the live value drifted to the interface that containers
cannot open a socket to while the template stayed on the one that works. When you change it, change
the pair together or the two will drift again.

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

Do **not** assume the NAS's own LAN address is unreachable from every container, and do **not**
infer one port's reachability from another port's. Each address:port pair is a separate fact, so
measure the pair the dispatcher actually uses. Measured 2026-10-13 on the clinic NAS, from inside
`care-api` — `8042` was proved separately and is listed only to show the two are not the same
question:

| Address:port, from inside `care-api` | TCP | HTTP | From the NAS host |
| --- | --- | --- | --- |
| `172.16.1.139:7080` (HOPE callback) | **ok** | **401 in 88 ms** | 401 in 2 ms |
| `192.168.1.137:7080` (the value the app is configured with) | **timeout at 5 s** | TimeoutError at 9,003 ms | 401 in 2 ms |
| `172.16.1.139:8042` (Orthanc) | ok | 200 in 50–67 ms | — |

Three things follow, and none of them is "HOPE is down". The route is served and answers
**401 Unauthorized** with real security headers, so HOPE's handler is up, listening, and correctly
refusing an unsigned request — that is a pass at the application layer. The same URL answers 401 in
under 3 ms from the NAS host on **both** addresses, so the failure is the container→`eth0` hairpin
for `192.168.1.137`, not the service. And because `eth1` completes the pair, the fix is one value:
`INTEGRATION_HOPE_CALLBACK_URL` should name `172.16.1.139`, which is what
`deploy/synology/care.env:125` already records. Changing it means restarting `care-api`, so it is
an owner decision, not a step on this page — and note that the 401 says nothing about whether the
**signature** would be accepted on a real POST; only §D.6–D.8 on one authorized case can say that.

The two controls below are what produced that table, and they are still the pair to run on any
other box, because the addresses are clinic-specific:

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
docker exec care-api node -e "const n=require('net'),h=process.argv[1],a=process.argv[2],p=+a;if(!h||!/^[A-Za-z0-9.:_-]+$/.test(h)||!(Number.isFinite(p)&&p>0&&p<65536)){console.log('NOT FILLED IN: replace HOST and PORT with real values (you passed host='+h+' port='+a+')');process.exit(0)}const s=n.connect({host:h,port:p,timeout:4000},()=>{console.log('TCP ok '+h+':'+p);s.removeAllListeners('error');s.destroy()});s.on('error',e=>console.log('TCP fail '+h+':'+p+' '+e.code));s.on('timeout',()=>{console.log('TCP timeout '+h+':'+p);s.destroy()})" HOST PORT
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
| 3 | Run the migration-ledger audit | §A.3 | `docker compose -p care-erp-github run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs` | **AUTHORIZATION** — it connects to the clinic DB. It is read-only by construction and proves so in step 2, but it is still the clinic database |
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

### Part 2 · Verdicts from the clinic box — read-only pass, 2026-10-13

Every row below is what `AbinashNAS` answered when asked, in SSH as `abinash` with a
read-only key, through `docker` (no `sudo`: `sudo -n` is refused on this account, which is
why nothing here could have written). `care-api` `care-web` `care-db` `care-redis` were
`Up 6 hours (healthy)`, created `2026-10-12T22:22:4xZ`; `care-db-patch-v2` and
`care-schema-verify` both `Exited (0)` in the same window. No container was started,
stopped, restarted or rebuilt to produce this table.

| ID | Verdict | Evidence | Risk | Required action | Deployment impact |
|---|---|---|---|---|---|
| **CL-1** | **AUTHORIZATION REQUIRED** — pre-flight complete, audit not run | Target confirmed three ways: `current_database()=diagnostic_erp`, `server_version 16.14`, `pg_is_in_recovery()=f`; identity row `care-erp / production / bd62c32b92733266c8b521a171f88232 / 2026-07-08 08:53:46Z`; session default `default_transaction_read_only=off`, which is the value the audit overrides and then verifies. **The disagreement it will have to explain is already visible:** `schema_migrations_log` has 206 rows of which 15 are `kind=drizzle`, while `drizzle.__drizzle_migrations` holds 17 and `schema_deploy_state` 19 | Two Drizzle files are tracked by Drizzle's own table and not by the app's ledger. That is the exact shape of a half-applied migration, and `/api/health/schema` cannot see it — it reports `pass_with_warnings`, `issues=0`, 206 migrations, 462 live tables, 6,857 live columns | Run §A.3 **with `-p care-erp-github`** and read the `N critical, M warnings, K informational` line; keep it with the date | **Blocks every deploy**, including code-only, because the two critical codes describe objects the running app already assumes |
| **CL-2** | **NOT TESTED** — the artifacts exist and are fresh; restorability is unproven | Newest: `/volume1/backup/care-erp/db/backup_DB_2026-10-13T03-30-57-419Z.sql.enc`, 775,648,192 B, mode 0644. 1,272 `db` artifacts back to 2026-09-13; `notes` records `pg_dump` on 6,752 of 6,813 runs, so schema-complete rather than the data-only fallback. **`public.backup_verification` has 0 rows** | Not one restore has ever been proven on this box. The 30-day history spans the `SESSION_SECRET` rotation of ~2026-10-03 and nothing records which key sealed which file | Run §B.4 on the **newest and the oldest** `db` artifact separately; confirm `BACKUP_PASSPHRASE` is also stored off-box | **Blocks a schema-shipping deploy** (migrations here are forward-only; a restore is the only rollback) |
| **CL-3** | **PASS on the precondition / FAIL on the proof** | `deploy-synology.sh` still takes no backup (its own steps are `git reset --hard` → `compose down --remove-orphans` → `up -d --build`), but the hourly job produced artifacts at 22:30 and 22:32 on 2026-10-12, the same night the containers were recreated at 22:22 | The safety net exists by accident of a scheduler, not by the deploy path. If CL-2 has not passed, the net is untested | Record `$BD` artifact name + `docker inspect … image=` for `care-api care-web` inside the deploy window, before step 1 | **Yes if CL-2 is not done** |
| **CL-4** | **PASS, with a named fragility** | `GET http://172.16.1.139:8042/system` from inside `care-api` → **HTTP 200 in 50–67 ms**; `/dicom-web/studies?limit=1` → 200; `/plugins` = explorer.js, dicom-web, orthanc-worklists, postgresql-index; `/statistics` = 2,654 patients / 2,681 studies / 9,973 series / 242,278 instances. `care-orthanc` by name → **DNS fail ENOTFOUND** (separate project, separate bridge). `192.168.1.137:8042` from the same container → **TimeoutError** | PACS reachability depends on `eth1` keeping `172.16.1.139`. Renumber that interface and image attach stops, with no schema or config error anywhere | Decide: join `care-pacs-net` to the ERP project (needs authorization + restart), or keep the address and monitor it. Write the choice into `deploy/synology/care.env`, which currently records `172.16.1.139:7080` while the live value is `192.168.1.137:7080` | **No** for reports. Image attach has a working server leg today |
| **CL-5** | **FAIL for viewer-side claims** | `care-ohif-enterprise:v1`, `builtAtUtc 2026-10-10T05:14:48Z`, `careViewerVersion 1.2.0-p2-radiologist`, `ohifRef v3.10.0`, `ohifCommit 0b6e9cba…`, no `care-pacs` SHA. All five hand-written `care-*.js` served by that image are byte-identical to `care-pacs origin/main` (`ddef581`) after LF normalization, but the 6.89 MB app bundle contains only the **snapshot** form `window.__CARE_OHIF__={servicesManager:…}` | The D2 displayed-image fixes authored after that build (care-pacs `d9a3eb9`, 2026-10-10 18:12Z) are **not deployed**. Saying "D2 is live" is false; saying "D2 is broken" is equally false — it is dormant | Owner authorizes a `care-ohif` rebuild; re-read the bundle afterwards | **No** for the ERP. **Yes** for any viewer-side claim |
| **CL-6** | **FAIL on configuration — reachability now proved, delivery still never observed** | `integration_outbox` 0 rows, `integration_delivery_attempts` 0 rows, `external_result_links` 0/0/0, partner audit log 1 row, `last_used_at 2026-08-14 05:07:48Z`. Configured callback `http://192.168.1.137:7080/api/integration/care-callback`; from inside `care-api` that address **fails at the TCP layer (timeout at 5 s, TimeoutError at 9,003 ms)**, while `172.16.1.139:7080` completes TCP and returns **HTTP 401 in 88 ms**. The NAS host gets 401 in 2 ms on both. No HOPE name resolves from `care-api` (ENOTFOUND; HOPE is on `hope_erp_network`, the ERP on `care-erp-github_default`), and `hope_hospital_app` maps container `5000` → host `7080`. `ff_hope_care_referrals.enabled = t` at **2026-10-12 22:24:28Z** — switched on at the last deploy | The flag is on for an address the application cannot open a socket to. A signed referral report queues, retries to `max_attempts` 8 and dead-letters with nothing in the ERP UI to say so. The 401 proves HOPE is healthy and refusing an unsigned request — it does **not** prove the HMAC signature would be accepted on a real POST | **Owner decision, both ways are a config change plus a `care-api` restart:** set `INTEGRATION_HOPE_CALLBACK_URL` to the address measured to work (`http://172.16.1.139:7080/api/integration/care-callback`, which is what `care.env:125` already records), or set `ff_hope_care_referrals` back to `f` until §D.6–D.8 pass on one authorized case | **Blocks Hope referral traffic.** Not the ERP report path |
| **CL-7** | **AUTHORIZATION REQUIRED** — unchanged, owner-deferred | The NAS checkout carries untracked `.env.before-rotate-2026-10-03`, `BEFORE-QODER.env`, `before1234.env` and a modified `STARTUP_SCHEMA_VERIFICATION.md`; `HOPE_PARTNER_KEY`, `INTEGRATION_HOPE_SIGNING_SECRET`, `INTERNAL_API_KEY`, `SESSION_SECRET`, `DATABASE_URL` all report `set` (values never printed) | A rotation has already happened once without history remediation, and it is the same event that may make September's backups undecryptable (CL-2) | Owner's rotation window + history remediation, and this time record which key sealed which artifact | **No** — standing exposure, not a deploy gate |
| **CL-8** | **NOT TESTED** | Nothing NAS-side bears on it; `lib/reportImages.ts:186` still returns `null` for every non-OK response on `main` | A 429, a 500, a timeout and a corrupt object are one event, so staff are told "no image" for four different faults | Typed outcome from `fetchPrintImageBytes` + a `*.request.test.ts` per class, then the four messages read on a screen | **No** |
| **CL-9** (new) | **FAIL** — exposure, not a fault of this deploy | Published on every interface (`0.0.0.0`): `care-orthanc` **8042 and 5680**, `care-ohif` 3010, `care-web` 8888, `hope_hospital_app` 7080, plus the staging stack's 8091/3012/8043. `care-db` is correctly `127.0.0.1:5400` only, `d2stg-db` `127.0.0.1:5401` | 5680 is `care-pacs/docker-compose.yml:70` `"5680:4242"   # DICOM C-STORE / C-ECHO / MWL C-FIND`, published on `0.0.0.0`: any device on the clinic LAN can call `C-STORE` into the production index unauthenticated. 8042 likewise exposes the whole DICOMweb query API to the LAN | Owner decision on the firewall/publication surface; **not** a documentation item | **No** for this deploy. **Yes** for calling the PACS box production-hardened |
| **CL-10** (new) | **PASS on isolation / FAIL on provenance** | A whole second stack runs beside production: `d2stg-api` `d2stg-web` `d2stg-db` `d2stg-redis` `d2stg-ohif` `d2stg-orthanc`, `Up 2 days`, on project `care-erp` (`docker-compose.yml` + `docker-compose.staging.yml`) from `/volume1/docker/care-d2-staging/care-erp`, which is **not a git repository**. Its DB is `care_d2_staging_db_data` on `care-erp_default` with **0 patients**; `care-db` does not resolve from `d2stg-api` (ENOTFOUND); both APIs read `db:5432/diagnostic_erp`, which resolves inside their own project only | Patient data is provably not shared — that part is good news. But staging acceptance results cannot be tied to a SHA, and `d2stg-orthanc` runs `orthancteam/orthanc:latest`, an unpinned tag | Either version the staging tree or stop presenting its verdicts as evidence for production | **No** |

**Refuted by this pass** — recorded because each was previously asserted somewhere in these
documents, and none of them is true of this box:

1. "The clinic has no backups since 2026-08-26." False: ~203 GB under `/volume1/docker/backups`
   is the abandoned pre-fix default, and the live `BACKUP_HOST_DIR=/volume1/backup/care-erp` has
   been written hourly through today. The `BACKUP_HOST_DIR` bind did its job.
2. "A container cannot reach the NAS's own LAN IP on a published port." False as stated: it
   reaches `172.16.1.139` and times out to `192.168.1.137`. Interface-specific, not a rule.
3. "`/api/health` names the deployed build." False: it reported `build.commit=2d51e8d7` while the
   checkout was at `46d36612`, because `GIT_COMMIT` in `.env` is what gets baked.
4. "The staging stack may be reading the production patient database." False, and now measured:
   separate project, separate bridge, separate volume, `0` patients, `care-db` unresolvable from it.
5. "`wget`-based §C/§D probes are runnable." False: `care-api` has no `wget`, no `nc`, no
   `python3` — `curl` and `node v22.22.3` only. Those probes are rewritten in §C and §D.
6. The `d2stg-*` staging DB's `db_data`-style volume holds real patient data (believed from an
   earlier round on a different box). Not here.
7. **This page's own first reading of the HOPE control**, which recorded "the NAS host reaches
   `192.168.1.137:7080` → HTTP 302 in 10 ms". Re-measured against the callback path itself it is
   **401 in 2 ms**; the 302 belongs to `/`, which redirects to `/site`. A redirect from the root is
   not evidence about a route, and reading one as the other made an authentication answer look like
   a page redirect. Measure the exact path the dispatcher posts to.

### Part 2 · Second read-only pass — same day, backups, callback and the audit's last unknown

Everything below was measured on the clinic box with read-only commands. No container was
restarted, nothing was written to the database, and no backup file was touched.

**CL-1's last unknown is now closed — and it changes the command.** A container named
`care-schema-verify` **already exists**: it is the service's own one-shot, created 2026-10-12
22:22:46, `Exited (0)`, labelled `com.docker.compose.oneoff=False`, `service=schema-verify`,
project `care-erp-github`, and it ran the image's default command
(`node /repo/scripts/db-schema-verify.cjs --verbose`). `docker compose run --dry-run` is not
supported here (`interactive run is not supported in dry-run mode`), so the collision behaviour
could not be proven without executing. It does not need to be: this box runs compose `2.20.1`
and `docker compose run --help` lists `--name string  Assign a name to the container`, so
naming the one-off makes the collision impossible by construction.

The command to authorize, and what each part is for:

```
docker compose -p care-erp-github run --rm --no-deps \
  --name care-schema-verify-audit schema-verify \
  node scripts/audit-migration-ledger.mjs
```

- `-p care-erp-github` is load-bearing — the folder is `care-on-synology1`, and without `-p`
  compose resolves to the folder name, matches nothing and prints **nothing at all**.
- `--no-deps` is load-bearing — without it compose starts a **second, empty** PostgreSQL and the
  audit reports roughly 200 `CRITICAL_TABLE_MISSING` findings about a database that has no
  patients. Both mistakes produce a confident, worthless result.
- **No `--json`.** The service bind-mounts the checkout read-write at `/repo/output`, and the
  audit's only filesystem write is `fs.writeFileSync(jsonOut, …)` guarded by `if (jsonOut)`
  (`scripts/audit-migration-ledger.mjs:630-636`). Omitting the flag leaves zero writes anywhere.
- Read-only is enforced twice: the connection is opened with
  `options: "-c default_transaction_read_only=on"` (`:493`) and the session then **verifies** it
  with `SHOW default_transaction_read_only` and exits 1 if the setting did not take (`:497-508`).
  The live server default is `off`, so the second check is what does the work. The queries are
  SELECT/SHOW only, over `schema_migrations_log`, `drizzle.__drizzle_migrations`,
  `schema_deploy_state`, `system_database_identity`, `information_schema.*` and `to_regclass` —
  no clinical table — and the connection string is never printed. Exit code = count of criticals.

Expected result, from the live counts already taken: the audit compares **192** `migrations/*.sql`
files on `origin/main` against `schema_migrations_log` (**206** rows, 15 of them `kind=drizzle`),
`drizzle.__drizzle_migrations` (**17**) and `schema_deploy_state` (**19**) over 462 public tables.
A clean run prints `0 critical`. Anything else names schema objects — never rows or patients —
and `RECORDED_BUT_ABSENT` is the half-applied case #955 prevents in future and cannot undo.
**Never rewrite a ledger row to silence a finding.**

**CL-2 gained the failing producer's name.** The second backup family is not a container and not
a script in a repository: it is **Synology Task Scheduler task id=15**, `15 2 * * * root
/usr/syno/bin/synoschedtask --run id=15` in `/etc/crontab`, writing
`/volume1/docker/backups/postgres/care/care_erp_<date>_02-15.dump` as user `abinash`. Its schedule
matches the filename exactly. The sibling task at 02:45 (`id=16`) writes
`hope_erp_<date>_02-45.dump` by the same mechanism and **succeeds** (626,673 B, byte-identical
night after night — which is its own smell: a real hospital dump that never changes size).

The care task is not simply dead — it is **intermittent**, which is why it survived unnoticed:

| night | bytes |
|---|---|
| 2026-10-02 / 03 / 04 | 329,689,377 / 335,611,035 / 343,654,187 |
| 2026-10-05 / 06 | **0** / **0** |
| 2026-10-07 | 382,922,529 |
| 2026-10-08 | **0** |
| 2026-10-09 | 406,343,843 |
| 2026-10-10 → 10-13 | **0** every night |

A zero-byte file is created and then the dump fails, so the job's exit status looks like a
completed task. The command it runs is only visible in
`/usr/syno/etc/esynoscheduler/esynoscheduler.db`, which is `-rwx------ root` — **this pass could
not read it, and will not guess at it.** To identify it, read the task in DSM → Control Panel →
Task Scheduler, or as root:

```
sudo sqlite3 /usr/syno/etc/esynoscheduler/esynoscheduler.db ".tables"
```

Two more facts about backups, both from the same pass.

**The legacy family proves integrity checking already exists here.**
`/volume1/docker/ERP-BACKUPS/care/database/intraday/` holds `pg_dump -Fc` dumps **with `.sha256`
sidecars** (e.g. `care_2026-09-22_23-00-18.dump` + its 128-byte checksum file), produced by
`erp-backup-runner` on a 09:00/12:00/15:00/17:00/23:00 schedule. That container has been `Exited
(130)` since 2026-09-22 21:26 with `restart=unless-stopped` and `restartCount=0` — it was
interrupted, never restarted, and still holds read-write mounts on a named volume and on the
13 GB `ERP-BACKUPS` directory, plus membership in both the care and hope bridge networks. So the
clinic's only checksum-verified dump family has produced nothing for three weeks.

**The neighbouring stack's restore test has been failing every week since 2026-08-30, for a
reason worth copying — and fixing.** `hope_hospital_backup` is `Up`, and its `/backups/verify.log`
reads, on 2026-08-30, 09-06, 09-13, 09-20, 09-27, 10-04 and 10-11:

```
[verify] FAIL — there are no backups in /backups to verify.
```

Its `entrypoint.sh` is the design CARE should have: a sleep loop **inside compose**, deliberately
chosen over Task Scheduler because, in its own words, "the whole reason there were no backups is
that the checklist asked somebody to type `pg_dump` by hand"; nightly dump plus a **weekly restore
test** (`BACKUP_VERIFY_DOW`). It fails for a one-line reason: `verify-restore.sh` globs
`${BACKUP_DIR}/hope_*.dump.enc` at the top level while `backup.sh` also copies artifacts into
`${BACKUP_DIR}/monthly/`. The verification has never once looked at a real backup. `find /backups
-name '*.dump*'` inside that container returns **0**. This is the same class of defect as CARE's
own newest-file trap, found twice on one box — a restore test that cannot see the files the backup
job writes reports a confident FAIL forever, or in CARE's case would report PASS about the wrong
artifact.

**Restore procedure (§B.4) is unchanged, and is the procedure to authorize.** It runs
`postgres:16-alpine` as `care-db-restore-sandbox` with a random per-run password and **no
published host port at all**, refuses a data-only dump, restores with `ON_ERROR_STOP=1`, fails on
an empty `patients`/`bills` restore, and cleans up on every exit path. Run it against the newest
**and** the oldest `db`-family artifact separately — those are the encrypted
`backup_DB_*.sql.enc` files under `$BACKUP_HOST_DIR=/volume1/backup/care-erp/db` (newest
2026-10-13T08-31-01Z, 789,553,120 B; 1,272 artifacts). Pass the passphrase through the
environment, never a command line, and read the restored counts against what the clinic expects —
the script deliberately does not compare against the live database, because that comparison is the
step that catches a backup of the wrong database. `public.backup_verification` still has **0
rows**: no restore has ever been proven on this box.

**CL-6: nothing has ever been dispatched, and both config sources hold the dead address.**
`integration_outbox` has **0 rows** and `integration_delivery_attempts` has **0 rows**. There is no
delivery history to read — the callback leg has never carried an event. `ff_hope_care_referrals` is
`t` (set 2026-10-12 22:24:28) and `ENABLE_SCHEDULERS` is set in `care-api`, while
`INTEGRATION_HOPE_SIGNING_SECRET` and `HOPE_PARTNER_KEY` are both non-empty, so the path is armed.

Where the URL comes from is settled by source, not by inference:
`services/integration/outbox.ts:78-91` resolves the destination as `envUrl ?? dbUrl`, where
`envUrl` is `process.env.INTEGRATION_HOPE_CALLBACK_URL` and `dbUrl` is
`integration_partners.callback_url` (`:86`). **Both hold the unreachable address.** Measured live:

| value | source |
|---|---|
| `http://192.168.1.137:7080` | `care-api` environment, and `integration_partners` row 1 (`code=HOPE`, `direction=inbound`, `is_active=t`, `last_used_at=2026-08-14`) |
| TCP timeout | that address, from inside `care-api` — re-measured on this pass |
| TCP OK, `HTTP 200` in 783 ms on `/`, `401` on the callback path | `172.16.1.139:7080`, from inside `care-api` |

So the instruction "the configured callback endpoint is already correct" does not hold, and the
change to authorize is one `.env` value plus the matching `integration_partners.callback_url`,
followed by a `care-api` restart — none of which is performed here.

The safe verification method, and why it cannot be done in production: the outbox has **ten** event
types and **no ping or test event among them** — every one requires a real referral. Signing is `x-care-signature: sha256=HMAC-SHA256(secret, "timestamp.body")` with no nonce
(`signBody` at `outbox.ts:70`, header set at `:175`); a 2xx moves the row to `sent`, non-2xx
retries by `30s × 2^(n-1)` capped at one hour (`:94-97`) to `max_attempts` — which defaults to
**8** (`lib/db/src/schema/integrationOutbox.ts:34`) — and then `dead`, and **`failed` is never
written**, so any dashboard that filters on `failed` shows nothing forever. Verification therefore
has to happen somewhere a synthetic event is allowed:

1. Use the isolated `d2stg-*` stack (project `care-erp`, its own `care_d2_staging_db_data`,
   **0 patients**, and `care-db` unresolvable from it) as both sender and receiver.
2. Enqueue one synthetic outbox row there, run `dispatchPendingOutbox()`, and let a throwaway
   listener **recompute the HMAC over `timestamp.body`** and compare — that proves URL reachability,
   header shape, signature correctness and the retry path.
3. No patient record, no clinical callback and no production row is involved. Receiver-side
   verification itself lives in the HOPE repository
   (`docs/hope-care-integration/04_HOPE_ADAPTER_REFERENCE.md:96-103`, where the reference receiver
   reads `x-care-timestamp` and `x-care-signature` and answers `401 bad signature` on mismatch).

**Two credential exposures found by reading file metadata only.** Neither value is reproduced here,
and neither file was opened.

1. The live `care-db` password **equals the public fallback written in `docker-compose.yml`** —
   tested by comparison inside the container, which printed only an equality verdict. The blast
   radius is limited because `care-db` publishes `127.0.0.1:5400` only, so nothing on the LAN can
   reach it; anything that can read the repository can nevertheless supply the credentials to
   another Postgres or to a host-side tunnel. Rotation is the owner's call and is not performed.
2. `/etc/crontab:4` runs `/volume1/docker/care-studio/nightly-backup.sh`, which `cp -f`s the live
   `.env` to `/volume1/backup/care-studio-data/env.backup` — 878 bytes, modified **2026-10-13
   02:00**, i.e. it is running. A second copy of the signing secrets therefore exists in a backup
   directory, outside the deploy directory's permissions and outside any rotation plan.

**Orthanc authentication is recorded as an accepted, deferred decision, and is not re-raised by
this pass.** `AuthenticationEnabled:false`, anonymous DICOMweb read, `RemoteAccessAllowed:true`,
`DicomAlwaysAllowStore:true`, CORS `*` with `DELETE` permitted, `8042`/`5680` on `0.0.0.0`, all
confirmed from the deployed `orthanc.json` earlier the same day. The owner has acknowledged it.
This page should be updated when it changes, not when it is re-discovered; the one thing that
would make it materially worse is a routable LAN or a port change, so §C.5's published-port line is
the check to keep.

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

**Decision after the read-only pass of 2026-10-13: still CONDITIONALLY READY, and the condition
has moved.** §A's pre-flight passed on all five points and the audit itself is the only thing
standing between this box and a cleared database, so CL-1 is one authorized command away from
closing. What changed is CL-6: the referral flag went on at the 2026-10-12 22:24 deploy, so
"sends into an endpoint nobody has observed answering" is no longer a warning about a hypothetical
rollout — it is the current production state, and it is the one item on this page that can hurt a
patient today. Two rows also gained facts nobody had before: the backups are healthier than this
page assumed (CL-2, hourly and schema-complete) and the network is looser than it assumed (CL-9).

CL-6 is now the cheapest item on this page to close, because its cause is named rather than
suspected: HOPE answers `401` in 88 ms at `172.16.1.139:7080` from inside `care-api` and never
completes a socket to the `192.168.1.137:7080` the app is configured with. One `.env` value plus a
`care-api` restart — both the owner's call, neither performed here — and the referral leg has a
reachable endpoint. Whether HOPE *accepts* the signature is still §D.6–D.8, and nothing short of
one authorized case can say that.

Nothing in this register was closed by a test run, and a green CI on `main` closes none of it.
Deploy remains the owner's decision.
