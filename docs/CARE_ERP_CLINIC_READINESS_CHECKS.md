# CARE ERP / PACS — Clinic Readiness Checks

_Three procedures to run on the Synology box before a deployment is called safe. Every
command here was checked against the files that ship it — `docker-compose.yml`,
`docker/db-patch-entrypoint.sh`, `scripts/audit-migration-ledger.mjs`,
`scripts/verify-backup-restore.sh`, `scripts/synology-nas-backup.sh` and
`../care-pacs/docker-compose.production.yml` at `main` = `f3dbb974` — not from memory.
**None of them has been run against the clinic**, because they need the NAS and because
touching the clinic box is the owner's decision. Nothing here deploys, restarts, migrates,
restores over live data, rotates or prints a credential._

Each procedure is independently executable and ordered inside itself: a pre-flight that
proves you are looking at the right database, the read-only action, and what a passing
answer looks like. Where a step could be mistaken for a mutation, it says so.

Run from the deploy checkout, which is what `deploy-synology.sh` documents in its own
header:

```sh
cd /volume1/docker/care-erp-github/care-on-synology1
```

> The NAS holds ~17 sibling projects under `/volume1/docker/`, and CARE is nested one
> level deeper, so a `for d in /volume1/docker/*/` loop misses it. Do not run these from
> `/volume1/homes/abinash/care-on-synology1` (a third checkout that holds working
> documents) or from `/volume1/docker/care-pacs`.

---

## A. Migration-ledger audit of the clinic database

### Why this exists

`care-db-patch-v2` records a migration in `public.schema_migrations_log` when it applies
it. Before #955 a Drizzle file that raised an unexpected error was **still recorded as
applied** and skipped on every later deploy, so a database can believe it is migrated
while holding half a schema. #955 stops that happening again; it cannot undo a window
that already happened. This audit is the only thing that asks the question, and it is
read-only by construction.

### A.1 Pre-flight — prove the target before trusting any answer

Three separate checks. They are cheap, and each one has caught a wrong-`.env` mistake
elsewhere in this system.

```sh
# 1. Which database is the ERP actually pointed at? Redacted inside the container,
#    so the user:password never reaches the terminal, a log or a screenshot.
docker exec care-api sh -c 'printenv DATABASE_URL | sed -E "s#://[^@/]*@#://REDACTED@#"'

# 2. What is the live Postgres, and is it in recovery?
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select current_database(), pg_is_in_recovery(), setting from pg_settings where name='"'"'server_version'"'"'"'

# 3. Which project does this database think it belongs to?
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select app_name, environment, instance_id, created_at from public.system_database_identity"'
```

Expected for the clinic: `current_database()` = your `DB_NAME` (`diagnostic_erp` by
default), `pg_is_in_recovery() = f`, and **`app_name = care-erp`**. The identity row is
stamped by `docker/db-patch-entrypoint.sh:145-166`, which **refuses to migrate** a
database stamped for a different app — the same protection in a different place. If row 3
returns a different `app_name`, stop: you are pointed at the wrong database, and the audit
would be describing a schema nobody deploys to.

Write down the `instance_id` too, not only `app_name`. It is the md5 minted the first time the
stamping script ever touched that database, so it is the one field that separates the clinic's
`diagnostic_erp` from a **different** database carrying the same `app_name` — a second project
stamped `care-erp`, or the staging stack, agrees on `app_name` and is indistinguishable without it.
What it cannot catch is a restore: a database rebuilt from a production dump copies the row whole,
`instance_id` included. Measured on `AbinashNAS` 2026-10-13, for comparison:
`diagnostic_erp | f | 16.14` and `care-erp | production | bd62c32b92733266c8b521a171f88232 |
2026-07-08 08:53:46.432625+00`.

> Never `printenv DATABASE_URL`, and never echo it into a log or a screenshot: it embeds
> `DB_PASSWORD`. `docker exec` into `care-db` uses the credentials the container already
> has. Do not run these against `127.0.0.1:5400` from the host either — `care-db` publishes
> on loopback only, and a host-side client would need the password.

### A.2 Prove the session is read-only before the audit runs

The audit connects with `options: "-c default_transaction_read_only=on"`
(`scripts/audit-migration-ledger.mjs:493`) and **exits 1 unless Postgres confirms the
setting** (`:497-508`). To see the same guard refuse a write, independent of the audit:

```sh
docker exec care-db sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update public.schema_migrations_log set name = name"'
```

Expected, verbatim:

```
ERROR:  cannot execute UPDATE in a read-only transaction
```

That is the mechanism the audit relies on. It is also a **read-only test of a write** — the
statement is refused and nothing changes; it is never run against the ledger by any script
in this repository.

### A.3 The audit itself

Establish the project name first, because the folder is not it. Measured on `AbinashNAS`
2026-10-13 from `/volume1/docker/care-erp-github/care-on-synology1`: a bare `docker compose ps`
listed **no containers**, while `docker compose -p care-erp-github ps` listed `care-api`, `care-db`,
`care-redis`, `care-web`. The live stack's project is `care-erp-github`; the name compose derives
from that folder is `care-on-synology1`, which owns nothing.

```sh
docker compose ls
```

```sh
docker compose -p care-erp-github run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs
```

* **Do not run this without `-p`, and do not "fix" a failure by dropping `--no-deps`.** Without
  `-p` the one-off container joins the empty `care-on-synology1` project, `db:5432` does not resolve
  there, and the audit exits with a connection error that reads like a broken database. The tempting
  remedy — `compose run schema-verify` *with* its dependencies — starts a **second** PostgreSQL from
  the same `DB_PASSWORD` against a fresh empty volume, and the audit then reports roughly two hundred
  missing tables against a schema that was never the clinic's. Both `-p` and `--no-deps` are load-bearing.

* `--no-deps` starts no database, no API and no migration container. The service is chosen
  because `schema-verify` is built from the `migrate` stage, which **bakes `scripts/` and
  `scripts/node_modules` into the image** (that is why `pg` resolves) and mounts
  `migrations` and `lib/db/drizzle` **read-only** — which is exactly the pair the audit
  compares.
* `DATABASE_URL` comes from the service environment (`docker-compose.yml:172`), so no
  credential appears on any command line or in the output.
* The service's compose project name must be the one the stack was brought up with.
  `docker compose ls` is the reliable way to see it on this box; a bare `docker compose`
  invocation that resolves to the wrong project prints nothing and succeeds.

To keep the findings as an artefact:

```sh
docker compose -p care-erp-github run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs \
  --json=output/ledger-audit-$(date +%F).json
```

`output/` is the deploy directory itself (`./:/repo/output:rw`), so the file lands in the
checkout. It is **untracked**: move it out of the working tree — `mkdir -p /volume1/docker/ledger-audits`
and keep it there with the run date — or delete it once the decision is made. Do not "tidy the
checkout" with `git clean` to remove it — that directory holds untracked files that exist in no
branch, including old credential sets and TLS keys.

### A.4 Reading the answer

| Line | Means |
| --- | --- |
| `✓ No inconsistency: every effect the ledger's migrations declare is present in this database.` | Recorded migrations match the schema. It cannot say a migration ran that the ledger never recorded. |
| `CRITICAL [RECORDED_BUT_ABSENT] …` | A recorded file declares this object and Postgres does not have it. **This is the half-applied case.** |
| `CRITICAL [CRITICAL_TABLE_MISSING] / [CRITICAL_COLUMN_MISSING]` | A table/column every deploy assumes is gone or never arrived. |
| `INFO [CONSTRAINT_UNDER_OTHER_NAME]` | Not a defect: the key exists under a different name (a measured pattern in this tree). |
| `exit 0` / `exit 1` | 0 = ran, whatever it found. 1 = a critical needs a decision (or any finding under `--strict`), or the DB was unreachable / the session was not read-only. **A clean audit and a crashed audit are never the same number.** |

The findings name schema objects only. `--json` writes `{database, deployState, identity,
ledgerRows, assertedEffects, findings}` — verified against the writer at
`scripts/audit-migration-ledger.mjs:630-636`: **no rows, no patient identifiers, no
credentials**.

### A.5 What it cannot see (so a green run is not a clean bill of health)

* Statements inside `DO $$ … $$` blocks — 38 of them in the migration tree — are never
  asserted, because they run conditionally at migrate time.
* `INSERT`/`UPDATE`/`DELETE` in migrations — 275 statements — are invisible: this is a
  **schema** audit, so a half-applied data migration is precisely what it cannot show.
* Column types, defaults and nullability are not compared; `scripts/db-schema-verify.cjs`
  covers part of that from the other direction.
* It reads the **working tree**, not the deployed commit. Run it from a checkout at the SHA
  that actually deployed this database, or an `ORPHAN_RECORD` line just means you changed
  directory.

Full list with measurements: `docs/MIGRATION_LEDGER_AUDIT.md`, *Known limitations and false
positives*.

### A.6 If it reports something

Follow `docs/MIGRATION_LEDGER_AUDIT.md` §Remediation. The two rules that are not
negotiable: **do not delete or rewrite a ledger row to silence a finding**, and **do not
re-run a migration file you have not read**, because a file that half-applied once can
half-apply again on top of the damage. Nothing in this procedure changes anything; a finding
is a question with a precise subject, and the answer is a reviewed, additive, compensating
migration — which is a separate decision with its own review.

---

## B. Isolated restore of a real backup

### B.1 What this proves, and what it does not

A backup that has never been restored is a file, not a backup. Production ran for months on
artifacts that reported success, matched their SHA-256, and could not restore (the dump was
data-only, and the old verifier piped everything through `gunzip -c` and ran `psql` without
`ON_ERROR_STOP`). `scripts/verify-backup-restore.sh` exists because of that, and it restores
into a container that is deleted on every exit path.

What it does **not** do: it does not compare against the live database's counts. The script
prints the restored side (`tables`, `patients`, `bills`, `payments`, `vouchers`,
`patient_reports`) and fails if `patients` or `bills` is empty; reading those numbers
against what the clinic expects is yours, and it is the step that catches a backup of the
wrong database.

### B.2 Identify the artifact and its timestamp

```sh
ls -lt /volume1/backups/caredeoghar | head -12
```

Two naming families are valid, and both restore with the same script:

| Pattern | Written by | Compressed? |
| --- | --- | --- |
| `caredeoghar_<ts>.sql.gz[.enc]` | `scripts/synology-nas-backup.sh` (and the older `synology-backup.sh`) | yes |
| `backup_<job>_<ts>.sql[.enc]` | the in-app scheduler (`cron.ts`) | **no** |

The `.enc` envelope is AES-256-CBC/PBKDF2 in both cases. Read the timestamp from the
`ls -lt` output and from the script's own line — `modified: …` — and expect the newest file
to be within your retention window (`RETENTION_DAYS`, 14 by default). A newest artifact that
is weeks old is a finding about the backup job, not about the restore.

### B.3 Run it in isolation

```sh
bash scripts/verify-backup-restore.sh /volume1/backups/caredeoghar
```

Encrypted artifact only. The passphrase goes through the **environment**, never onto a
command line where `ps`/shell history would keep it, and never into a file in the deploy
directory. The operator supplies it in their own shell first:

```sh
read -rs PASSPHRASE                       # typed, not echoed, not stored in history
BACKUP_PASSPHRASE="$PASSPHRASE" bash scripts/verify-backup-restore.sh /volume1/backups/caredeoghar
unset PASSPHRASE
```

If the artifact predates a past rotation, the value that was **in force when the file was
written** is the one that decrypts it (the script also tries `SESSION_SECRET`, matching what
the app itself tries).

What the script does, all of it off the production path:

* picks the newest artifact of either family, decrypts, sniffs the gzip magic bytes
  (`1f 8b`) and decompresses only if it really is compressed;
* refuses anything that is not schema-complete — a data-only dump is a failure, not a pass;
* starts `postgres:16-alpine` as container **`care-db-restore-sandbox`**, database
  **`diagnostic_erp_restore_test`**, user `postgres`, with a random per-run password
  (`sandbox-$$-$(date +%s)`), and **publishes no host port at all** — a sandbox holding real
  patient data is deliberately unreachable from the network;
* restores with `psql -v ON_ERROR_STOP=1`, which is what makes it a test rather than a
  formality, with durability switched off because the container is deleted seconds later;
* prints the restored table count and the row counts for `patients`, `bills`, `payments`,
  `vouchers`, `patient_reports`, and fails on an empty `patients`/`bills` restore;
* cleans up on every exit path, including Ctrl-C: `docker rm -f care-db-restore-sandbox`
  and `rm -rf` its `mktemp` work directory.

Expected ending: `🎉 PASS`. Anything else names the exact failure.

### B.4 Prove production was not touched

Run before and after, and diff the two answers:

```sh
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E '^(care-db|care-api|care-web|care-redis)\b'
docker inspect --format '{{.Name}} running={{.State.Running}} restarts={{.RestartCount}} started={{.State.StartedAt}}' care-db care-api care-web
```

Unchanged `started=` and `restarts=` on all three means the restore never went near them.
The live data is in the external volume `care_main_db_data`, which this script does not
mount; the sandbox gets an anonymous layer that dies with the container. **Never**
`docker volume prune` on this box (there are ~50 anonymous volumes belonging to other
projects), and never add `-v` to a `compose down`.

### B.5 The live restore path is a different script

`scripts/synology-restore.sh` restores **over** a database (`LOCAL_DB_URL`, default
`postgresql://postgres:password@localhost:5432/caredeoghar` — that default is not this
clinic's target). Backups written by `synology-nas-backup.sh` use
`pg_dump --clean --if-exists`, so the artifact itself contains `DROP`/`TRUNCATE`-style
statements. Use it only as a deliberate rollback, only after B.3 has proven the artifact,
only against a scratch database first, and only with the owner in the loop. See
`CARE_ERP_RECOVERY_GUIDE.md`.

---

## C. Orthanc and OHIF, without restarting anything

`care-pacs` is a **separate compose project on its own bridge network**
(`care-pacs-net`). Everything below is written so that a failure tells you which of the two
causes you have: Orthanc down, or the two projects not sharing a network.

### C.1 Orthanc container status

```sh
docker inspect --format '{{.Name}} status={{.State.Status}} restarts={{.RestartCount}} started={{.State.StartedAt}} image={{.Config.Image}}' care-orthanc
```

`orthancteam/orthanc:latest` publishes **no healthcheck** in `docker-compose.production.yml`,
so do not ask for `.State.Health` — it errors. `care-orthanc` serves `8042` (REST/DICOMweb)
and `5680→4242` (DICOM C-STORE/C-ECHO).

### C.2 CARE API → Orthanc connectivity (the only path that matters for reports)

```sh
docker exec care-api node -e 'const u=process.env.ORTHANC_INTERNAL_URL+process.argv[1];fetch(u,{signal:AbortSignal.timeout(8e3)}).then(async r=>{const s=await r.text();console.log("HTTP",r.status,(r.headers.get("content-type")||"-").split(";")[0],s.length,"bytes");console.log(s.slice(0,220))}).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message)))' /system
```

`care-api` ships `curl` and `node v22.22.3` and **no `wget`, no `nc`, no `python3`** (measured on
the clinic box 2026-10-13), so every probe in this section runs through `node`. A `wget` line
pasted there exits with `not found`, which reads exactly like Orthanc being down.

Expected: a JSON object with `"Version"` (and `ApiVersion`). `ORTHANC_INTERNAL_URL` defaults
to `http://care-orthanc:8042` (`docker-compose.yml:336`), which resolves **only if the two
projects share a user-defined network**. If it fails, distinguish the two causes:

```sh
# does the name resolve at all from inside the API container? (Docker's embedded resolver)
docker exec care-api node -e 'const {Resolver}=require("dns").promises,r=new Resolver({server:"127.0.0.11",tcp:false});r.resolve4(process.argv[1]).then(a=>console.log("DNS ok",a.join(" "))).catch(e=>console.log("DNS fail",e.code||e.message))' care-orthanc
# is the socket openable, independent of HTTP?
docker exec care-api node -e "const n=require('net'),h=process.argv[1],a=process.argv[2],p=+a;if(!h||!/^[A-Za-z0-9.:_-]+$/.test(h)||!(Number.isFinite(p)&&p>0&&p<65536)){console.log('NOT FILLED IN: replace HOST and PORT with real values (you passed host='+h+' port='+a+')');process.exit(0)}const s=n.connect({host:h,port:p,timeout:4000},()=>{console.log('TCP ok '+h+':'+p);s.removeAllListeners('error');s.destroy()});s.on('error',e=>console.log('TCP fail '+h+':'+p+' '+e.code));s.on('timeout',()=>{console.log('TCP timeout '+h+':'+p);s.destroy()})" HOST PORT
# which networks does each side sit on?
docker inspect --format '{{.Name}} -> {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' care-api care-orthanc
```

Three separate questions, because one line that answers "DNS+HTTP ok or failed" cannot tell you
which half broke: name resolution, socket, network membership. On the clinic box 2026-10-13 the
resolver answered `DNS fail ENOTFOUND` for `care-orthanc` (separate compose project) and the
configured `ORTHANC_INTERNAL_URL` is the interface address `http://172.16.1.139:8042`, which
answered `HTTP 200` in 50–67 ms.

Two more facts that have burned time here: **the hairpin/DNAT block is per-interface, not a rule
about "the NAS's LAN IP"** — this box answers on `eth0 192.168.1.137`, `eth1 172.16.1.139` and
`eth2 192.168.1.47`, and from `care-api` the `eth1` address completes while the `eth0` one times
out, so a failure against one address says nothing about the other and nothing about Orthanc; and
`ORTHANC_CHANGES_POLLER` must be `false` when `care-erp-sync` runs, or two writers race on
the same worklist.

### C.3 DICOMweb availability, and the Orthanc 1.13 quirk

```sh
# QIDO at study level — proves /dicom-web is mounted, not just the REST root
docker exec care-api node -e 'const u=process.env.ORTHANC_INTERNAL_URL+process.argv[1];fetch(u,{signal:AbortSignal.timeout(8e3)}).then(async r=>{const s=await r.text();console.log("HTTP",r.status,(r.headers.get("content-type")||"-").split(";")[0],s.length,"bytes");console.log(s.slice(0,220))}).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message)))' '/dicom-web/studies?limit=1'
```

Expect a JSON array (possibly `[]`). Now the quirk the image picker depends on: Orthanc
1.13.0 keys path-style lookups by **its internal id**, so
`/dicom-web/studies/{S}/series/{SE}/instances/{SOPInstanceUID}` returns **400**, and the
lookup must be QIDO-filtered instead:

```sh
docker exec care-api node -e 'const u=process.env.ORTHANC_INTERNAL_URL+"/dicom-web/studies/"+process.argv[1]+"/series/"+process.argv[2]+"/instances?00080018="+process.argv[3];fetch(u,{headers:{accept:"application/dicom+json"},signal:AbortSignal.timeout(8e3)}).then(async r=>{const s=await r.text();let n="not-json";try{n=JSON.parse(s).length}catch(e){}console.log("HTTP",r.status,"entries="+n,s.length,"bytes")}).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message)))' STUDY SERIES SOP
```

Pass the three UIDs as the three trailing arguments; the URL is built inside the container from
`ORTHANC_INTERNAL_URL`, so nothing has to be exported first. `care-api` has no `wget` (measured
2026-10-13: `curl` and `node v22.22.3` only), so the `wget -qO-` form of this probe reports
`not found`, which is not an Orthanc answer. The response body is DICOM metadata for one study, so
this line prints counts only — never paste the array into a log.

An unmatched filter is a `200` with an **empty array**, never a 404 — that distinction is
what `scripts/…/mockDicomWeb.ts` mimics, and it is why a regression back to path-style
lookups fails its check instead of passing silently. Substitute real UIDs taken from the
ERP's own image references, not from a patient list.

### C.4 OHIF container status and the version actually running

```sh
docker inspect --format '{{.Name}} status={{.State.Status}} restarts={{.RestartCount}} image={{.Config.Image}} imageid={{.Image}}' care-ohif
docker image inspect --format 'built={{.Created}} tags={{.RepoTags}}' care-ohif-enterprise:v1
curl -fsS http://127.0.0.1:3010/care/build-info.json
```

`build-info.json` answers `ohifRef`, `ohifCommit`, `careViewerVersion`, `builtAtUtc` —
measured on this NAS on 2026-10-10 as `v3.10.0 @ 0b6e9cba…`, `1.2.0-p2-radiologist`. It does
**not** contain the `care-pacs` commit, and comparing served JS blob hashes is nearly useless
(D2 left `care-security/bridge/measurement/chrome` untouched, so 5/5 matched current main).
The discriminator is the **injected `<script src>` list** in the served `index.html`;
until someone reads it, the honest statement is "OHIF is serving, version known, `care-pacs`
commit not established". A merged PR in `care-pacs` does **not** recreate this container —
`docker compose up -d --build` in the ERP project never touches it.

```sh
curl -fsS http://127.0.0.1:3010/index.html | grep -o 'src="[^"]*\.js"' | sort
```

### C.5 Image retrieval, the way the report prints it

The print/PDF leg fetches exactly this path (`artifacts/api-server/src/lib/reportImages.ts:131-133`):

```
{ORTHANC_INTERNAL_URL}/dicom-web/studies/{study}/series/{series}/instances/{sop}/rendered
{ORTHANC_INTERNAL_URL}/dicom-web/studies/{study}/series/{series}/instances/{sop}/frames/{n}/rendered   # 1-based
```

```sh
# status and size only — never pipe image bytes into a log or a terminal
docker exec care-api node -e 'const u=process.env.ORTHANC_INTERNAL_URL+"/dicom-web/studies/"+process.argv[1]+"/series/"+process.argv[2]+"/instances/"+process.argv[3]+"/rendered";fetch(u,{signal:AbortSignal.timeout(15e3)}).then(r=>console.log("HTTP",r.status,(r.headers.get("content-type")||"-").split(";")[0],"len="+(r.headers.get("content-length")||"?"))).catch(e=>console.log("FAIL",e.name,e.message||(e.cause&&e.cause.message)))' STUDY SERIES SOP
```

Expect `200` and `Content-Type: image/jpeg`. A single-frame object has **no** `frames/` path
at all; asking for one is a 404 by design. This is the leg that returns `null` for every
non-OK answer (see the P2 finding in `CARE_ERP_PRODUCTION_READINESS.md`), so a 429, a 500, a
timeout and a corrupt object look identical here — if the answer is not 200, get Orthanc's
own status line, do not infer "Orthanc down".

### C.6 Reporting-workspace connectivity

```sh
node scripts/deploy-health.mjs --host-port "${HOST_PORT:-8888}"     # the same gate the deploy uses
docker exec care-api sh -c 'echo "OHIF_URL=$OHIF_URL"'              # not a credential; safe to print
```

`deploy-health.mjs` probes `/nginx-health`, `/api/healthz` and `/api/health/schema` **and
checks the bodies**, because `care-web` answers an unknown path with the SPA's `index.html`
at status 200 — a successful `curl` on its own is not evidence. There is **no port 8080
published on the host**: 8080 exists only inside `care-api`, where its own healthcheck calls
it.

If `OHIF_URL` begins with `/` (the CONFIG_GUIDE ships that variant), it is relative to the
ERP origin — resolve it against `http://172.16.1.139:${HOST_PORT:-8888}` rather than curling
`/ohif` on its own; if it is absolute, curl it as-is. Either way the value comes from the
deployed environment, because the clinic's address is not a fact this repository owns.

The final check is the one only a human can do, and it is the one that has repeatedly found
what tests missed: open a worklist row in the browser, attach one image from PACS, add a
caption, reorder, save, reopen, Print, Download PDF, and open the durable PDF. What must be
true: the images keep their order, a caption prints with the radiologist's own
capitalisation, an absent caption prints no blank band, and the accession number appears
only where the server can prove it belongs to that patient.

---

## Order of operations

A, B and C are all safe to run on a live clinic day, because none of them writes. Run them
in this order anyway: **A first** (a half-migrated schema changes what B's artifact would
even mean), then **B** (the only thing that makes a rollback possible), then **C** (the
PACS legs that a report depends on). The deploy sequence that consumes all three is
`CARE_ERP_DEPLOYMENT_RUNBOOK.md` §12, steps 3, 4 and 10.
