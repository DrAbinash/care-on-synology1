# CARE ERP — Second-NAS Disaster Recovery

_Bring the whole billing/ERP system up on a **second Synology NAS** after the primary fails. With the one-time pre-staging below, real failover is **a few minutes**; from bare metal it is ~15–20 min (an image build)._

> **Read PART 0 before PART 1.** This document used to assume the standby existed, that a
> nightly backup was synced to it, and that the only thing standing between the clinic and a
> working standby was a `docker compose up`. None of that is recorded anywhere in this
> repository, and two of its commands cannot run on a Synology box at all. PART 0 is the
> version that says which facts are measured, which are the operator's to look up, and which
> are still UNKNOWN.

**What "the system" actually is — and what a dump does not carry.** The old first line was
"The system is just: a `docker compose` stack + one PostgreSQL database + a `.env` of secrets."
For the *database* that is true; the database is not everything. Invoice attachments, referral
documents, frozen key-image pixels and `audit_logs` rows past their retention live outside the
dump (`docs/CARE_ERP_BACKUP_COVERAGE.md`, and `docker-compose.yml:418-422` says it in as many
words: "DB backup alone is NOT sufficient for frozen key-image evidence"). A standby built from
a dump alone therefore boots and serves **without** those files. PART 3 lists what is missing
and who decides whether that is acceptable.

**Orthanc/DICOM is out of scope by owner decision** (I12 §2). Nothing in this plan replicates,
restores, schedules or alerts on the DICOM store. PACS availability is checked as a *connectivity*
question only (`ops-preflight` row `backup.orthanc_images` is `NOT_APPLICABLE` on purpose).

**Status: LOCAL, measured at `3f044107`.** Every path, port, variable and script name below was
read out of this repository; nothing was executed against either NAS. Where a fact can only be
obtained from the standby box itself, the document says so and gives the command that obtains it
rather than repeating an assumption. No step here changes a DSM setting, configures replication,
or promotes anything automatically.

---

## The idea

- **Primary NAS** runs the stack and takes a nightly backup (`CARE_ERP_BACKUP_RESTORE.md`).
- **Standby NAS** holds a copy of that backup artifact, the same code, a matching `.env`, and pre-built images.
- **On disaster**: prove the artifact, restore it, bring the stack up, repoint the network. Manually.

Three things have to be true before the word "standby" means anything, and each is a different
fact from the others:

| | established by |
|---|---|
| an artifact **exists** on the standby | `ops-backup-inventory` run **on the standby** |
| that artifact **restores** | `verify-backup-restore.sh` run **on the standby**, then recorded |
| the stack **serves** after the restore | `deploy-health.mjs` on the standby's published port |

A replicated folder proves the first only. The clinic has previously held backups that
"existed", matched their checksum, and could not be restored.

---

## PART 0 — What is on the standby? (read-only; run it before you promise anything)

Run these on the standby over SSH. One line each. Nothing here writes, installs, restores, or
touches a DSM setting — and no command in this section needs the primary to be alive.

```sh
uname -m
```
```sh
free -m
```
```sh
df -h /volume1
```
```sh
docker info --format '{{.ServerVersion}} {{.OSType}}/{{.Architecture}}'
```
```sh
docker compose ls
```
```sh
docker volume ls | grep -vE '[0-9a-f]{64}'
```
```sh
ls -d /volume1/docker/*/
```
```sh
node --version
```

`uname -m` and `free -m` are not pedantry. `docker compose build` on this repository builds a
pnpm monorepo (esbuild, Vite, a React SPA). A Synology box with an ARM CPU and 1–2 GB RAM may
not be able to do that at all, which changes the plan from "pre-build the images" to "copy the
images" or "the standby is not an ERP standby". **This repository contains no measurement of
the second box's CPU, RAM or DSM version** — those two lines are the measurement.

`docker compose ls` is the reliable inventory here: `com.docker.compose.project.working_dir`
labels come back empty for stacks started from Container Manager, so a label-based check can
report "nothing running" on a box that has eleven projects.

`node --version` decides which instructions in this document you can actually run. On the
primary, `node` is at `/usr/local/bin/node` while **`pnpm` and `npx` are not on PATH**; the full
toolchain is under `/volume1/@appstore/Node.js_v22/usr/local/bin/`. Every command in this
document is therefore written as `node scripts/<tool>.mjs`, not `pnpm <script>`. If you want
the `pnpm` forms, prefix `export PATH="/volume1/@appstore/Node.js_v22/usr/local/bin:$PATH"`.

### 0.1 Is anything being replicated at all? — ask the files, not DSM

**Do not let a document tell you a DSM task exists.** Hyper Backup and Snapshot Replication
configurations live in DSM, not in this repository, and their destination folder names are
chosen by whoever set them up — so there is no portable path to grep. §10 of the I12 brief is
explicit: assume nothing, configure nothing remotely, change nothing in DSM.

What *is* portable evidence is the artifact itself. Point the inventory at wherever the standby
keeps ERP dumps and read its verdict:

```sh
cd <checkout on the standby>
```
```sh
BACKUP_DIR=/volume1/backup/care-erp/db node scripts/ops-backup-inventory.mjs
```

It reads one directory and reaches no verdict: one row per artifact, what its `.meta` sidecar
claims, whether the checksum was recorded or actually recomputed, whether a restore of *that
file* was ever proved, which days are missing from the retained span, and whether anything is
still a `.partial` from a job that died mid-write.

| it prints | what it means for DR |
|---|---|
| `No backup directory could be read … UNKNOWN about the backups, not evidence that there are none` | you have not established replication; find the real destination and re-run, exit code **2** |
| `MISSING n day(s)` | those days are not recoverable on this box, whatever the schedule claims |
| `no .meta sidecar` | pre-#1004 dumps: restorable, but nothing proves which database they came from |
| `NO artifact in this inventory has a proven restore` | the standby is a folder of files, not a standby — this is the sentence PART 0.2 removes |

### 0.2 Turn the standby from "files" into "proof" (once, deliberately)

`verify-backup-restore.sh` restores a real artifact into a **throwaway** container with
`ON_ERROR_STOP=1`, refuses a dump that is not schema-complete, and fails if `patients` or
`bills` landed empty. It never touches the standby's `care_main_db_data`.

```sh
BACKUP_DIR=/volume1/backup/care-erp/db node scripts/ops-backup-inventory.mjs --verify-checksums
```
```sh
bash scripts/verify-backup-restore.sh /volume1/backup/care-erp/db
```

Then record who proved it, for which file, so the answer survives the person:

```sh
node scripts/ops-preflight.mjs --record-restore --artifact <name-the-inventory-printed> --tables <n> --patients <n>
```

That writes `ops-evidence.json` on the standby — a file that is **gitignored on purpose**,
because `deploy-synology.sh` runs `git reset --hard` and a tracked evidence file would be
wiped by the next deploy. Evidence recorded on the standby belongs to the standby.

Both scripts need the passphrase for an **encrypted** artifact, and neither should take it as a
command-line argument: `export BACKUP_PASSPHRASE` (or `SESSION_SECRET`, which
`candidatePassphrases()` also tries) in the same shell, then run. If the standby's `.env` is
present, `ops-preflight` reads it; `verify-backup-restore.sh` takes the value from the
environment.

---

## PART 0b — The DS225+ already has a job; read this before giving it a second one

The clinic's second box is documented in this repository as the **emergency billing** machine,
and that documentation and this one currently disagree:

| source | what it says about the DS225+ |
|---|---|
| `docs/DS225_EMERGENCY_BILLING_ARCHITECTURE.md` | runs the `225app` capture stack with **its own PostgreSQL**; "**Do not clone the CARE monorepo onto DS225+**"; "must not contain … a copy of `diagnostic_erp`"; "Emergency Billing must **not** use Hyper Backup vaults or that restore volume" |
| this document | clone the repository, `docker compose build`, restore `diagnostic_erp` |

Both cannot be the plan for one box. This is an **owner decision**, not something to resolve in
a script, and it is the highest-value item in this section:

- **Option A — the DS225+ stays emergency-billing only.** Then this document's standby is a
  *different* machine (or a cloud VM, which the architecture doc forbids for the emergency
  role) and PART 0 must be run wherever that is. Emergency capture keeps working during a CARE
  outage, which is the capability the clinic actually bought.
- **Option B — the DS225+ is also the ERP standby.** Then the two roles must be fenced from each
  other on every axis below, and the "no clone" sentence in the architecture doc has to be
  corrected rather than quietly ignored.

| collision | primary value (this repo) | what a careless standby does |
|---|---|---|
| compose **project name** | the ERP is `/volume1/docker/care-erp-github/care-on-synology1`, composed as project `care-erp-github` | a stack composed from a folder named `care-erp` is a *different* project: `down`/`logs`/`ps` without the same `-p` match nothing, print no output, and return **success**. The same mistake with `up` is worse than a blind command: `db_data` is pinned to the external name `care_main_db_data`, so the new project attaches the **real patient database**, while `object_storage` and `uploads_data` (`docker-compose.yml:648-649`) are created **empty** under the new prefix — an ERP that logs in, reports patients and prints bills, with no uploaded documents and no frozen key-images, and nothing in `/health` that sees it |
| external volume | `db_data` is `external: true, name: care_main_db_data` | `docker volume create care_main_db_data` on a box that already has one restores the clinic into someone else's running database |
| host port | `"${HOST_PORT:-8888}:80"` (`docker-compose.yml:545`), `"${DB_BIND_ADDR:-127.0.0.1}:${DB_HOST_PORT:-5400}:5432"` (`:80`) | the second stack cannot bind 8888 and the first keeps serving stale code while everyone believes the failover happened |
| **schedulers** | `ENABLE_SCHEDULERS: ${ENABLE_SCHEDULERS:-}` (`docker-compose.yml:280`) gates in-process cron: backups, HOPE outbox, WhatsApp, retention | two live schedulers = double outbound sends, double purges, and a day-close that ran twice |
| HOPE identity | `HOPE_PARTNER_KEY`, `INTEGRATION_HOPE_CALLBACK_URL` (`:316,:319`) | the standby replays an old outbox at HOPE under the same partner key |
| DB identity guard | `system_database_identity` stamped `app_name=care-erp` | a mismatch fails loudly, which is the *good* outcome; a match on the wrong box is the bad one |

The rule while the decision is open: **one box writes.** If a standby is ever brought up while
the primary is reachable, it must not run `ENABLE_SCHEDULERS`, must not be handed the HOPE
credentials, and must not be published on the address staff use. That is a configuration
statement, not a code change, and `ops-preflight` on the standby is what records it.

---

## PART 1 — One-time pre-staging on the standby (do this while healthy)

This is what turns "hours" into "minutes". Steps 1 and 6 are operator actions in DSM; nothing
here can be done from the repository, and nothing here changes a DSM setting for you.

1. **Install Container Manager** (DSM → Package Center). Confirm with `docker compose ls`.
2. **Get the code** onto the standby. Use the same path convention as the primary so the
   project name and every documented command stay true — `/volume1/docker/care-erp-github/care-on-synology1`:
   ```sh
   git clone https://github.com/DrAbinash/care-on-synology1.git /volume1/docker/care-erp-github/care-on-synology1
   ```
   The NAS's git credential helper is repo-scoped and **refuses a new clone** ("could not read
   Username"); on the primary the working recipe is to fetch inside an existing clone and
   export it:
   ```sh
   git -C /volume1/docker/care-erp-github/care-on-synology1 fetch origin main
   ```
   ```sh
   git archive FETCH_HEAD | tar -x -C /volume1/docker/care-erp-github/care-on-synology1
   ```
   Record the SHA you staged (`git -C <dir> rev-parse HEAD`). During a failover you want to know
   which commit the standby is at, because the primary's last deploy may not be it.
3. **Copy `.env`** from the primary, out of band, never committed. See the two-secrets box below.
   Do **not** copy `ops-evidence.json` — evidence belongs to the box that proved it.
4. **Create the external DB volume** the compose file names:
   ```sh
   docker volume create care_main_db_data
   ```
   Only on a box where that name does not already exist (`docker volume ls`). Never recreate a
   volume that holds data.
5. **Pre-build the images** — if step 0.1's `uname -m` / `free -m` say the box can. If they do
   not, transfer images instead of building them (`docker save` on the primary, `docker load` on
   the standby) and note that the standby's images then carry the primary's build date, which
   `deploy-health.mjs` will report.
6. **Replicate the *dump artifacts*, never the live database directory.** A file-level replica
   of `/volume1/@docker/volumes/care_main_db_data/_data` is a copy of an open PostgreSQL data
   directory: it is not transaction-consistent, and restoring from it is how a standby ends up
   with a database that starts and then refuses to be believed. Ship the
   `caredeoghar_*.sql.gz[.enc]` files (and their `.meta` sidecars — pre-#1004 dumps have none,
   which the inventory reports as UNVERIFIED).
7. **Rehearse** (PART 0.2 + PART 2 on a throwaway DB name while the primary is up). A rehearsed
   DR plan is the only kind that works, and a rehearsal is what produces the recorded proof.

> **Two secrets MUST match the primary** on the standby `.env`, or you will lock users out or block migrations:
> - `JWT_SECRET` and `SESSION_SECRET` — same values, so existing logins/tokens keep working.
> - `APP_NAME` — same value (default `care-erp`); the DB-identity guard refuses to migrate a database stamped with a different app name.
>
> Also copy `DB_USER/DB_PASSWORD/DB_NAME`, `ICICI_*`, `INTERNAL_API_KEY`, and any HOPE/WhatsApp values in use.
>
> **`SESSION_SECRET` is also the fallback decryption key for encrypted backups.**
> `candidatePassphrases()` (`artifacts/api-server/src/lib/backupCrypto.ts:71`) tries only
> `BACKUP_PASSPHRASE` and the current `SESSION_SECRET`, with no slot for a previous value. A
> standby whose `SESSION_SECRET` was rotated after the dumps were written cannot decrypt them,
> so a standby `.env` copied from a *later* rotation is worse than no `.env`. Copy the `.env`
> that matches the artifacts, and keep one `.env` per backup epoch.

---

## PART 2 — Failover (primary is down): bring the standby up

In the standby's checkout. Ask the gate before you start anything, and read its answer as what
it is — `INSUFFICIENT_EVIDENCE` is not a green light.

```sh
node scripts/ops-preflight.mjs
```

It shells out to `git`, `docker`, `psql` and two other scripts. Anything not installed on the
standby's host comes back **UNKNOWN**, not PASS — a box without a `psql` client cannot prove a
database row, and the gate would rather say so than guess. `sudo node …` is the form that works
when the SSH user is not in the docker group.

```sh
# 1. Prove the artifact you are about to use (throwaway container; the ERP stack stays down)
bash scripts/verify-backup-restore.sh /volume1/backup/care-erp/db

# 2. Or restore through the script that knows both artifact shapes: it decrypts if
#    needed, sniffs the gzip magic bytes, and checks the schema in the right order.
export BACKUP_PASSPHRASE   # never on the command line: it would sit in ps -ef and history
bash scripts/synology-restore.sh /volume1/backup/care-erp/db/caredeoghar_<stamp>.sql.gz
```

```sh
# 3. Start ONLY the database first, so the restore lands before anything serves traffic
docker compose up -d db
```
```sh
docker exec care-db sh -c 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q; do sleep 2; done'
```

```sh
# 4. Bring up the rest. care-db-patch-v2 applies migrations newer than the backup;
#    care-api starts only after care-db-patch-v2 AND care-schema-verify both exit 0.
docker compose up -d
```

```sh
# 5. Confirm it is healthy — on the port the ERP actually publishes.
#    `--docker-prefix sudo` because the container states are read with `docker inspect`,
#    and on a Synology the SSH user is usually not in the docker group.
node scripts/deploy-health.mjs --host-port 8888 --docker-prefix sudo
```

> **Why step 5 is not `curl http://localhost:8080/…` and not `pnpm operations:verify-deployment`.**
> Both were in this document and neither can work on a Synology box. Nothing publishes 8080 on
> the host: 8080 exists only *inside* `care-api`, whose own healthcheck calls it, while the ERP
> is published as `${HOST_PORT:-8888}:80` (`docker-compose.yml:545`) — see
> `CARE_ERP_DEPLOYMENT_RUNBOOK.md` §3 and §10 for the deploy script that used to fail this way
> silently. And `pnpm` is not on PATH on the NAS, while `scripts/verify-deployment.mjs` additionally
> `import pg from "pg"`, which is not installed on the host — so that command has two ways to
> fail before it verifies anything. `deploy-health.mjs` is Node-builtins-only, checks container
> states and the response **bodies** of `/nginx-health`, `/api/healthz` and `/api/health/schema`,
> and exits non-zero if any is wrong. An unknown path on `care-web` returns the SPA's
> `index.html` with status **200**, which is why "curl succeeded" is not evidence.

6. **Repoint the network** to the standby:
   - Same LAN IP (primary fully dead): move the IP/cable; staff hit the same address.
   - Cloudflare Tunnel / `caredeoghar.com`: point it at the standby. `caredeoghar.com` is served
     by nginx in `care-web` with `/api/` → API, `/erp/` → the SPA, `/` → the clinic site.
   - External services with different addresses on this site (Orthanc/OHIF/Ollama): reporting and
     billing work without them; they are non-blocking. **PACS image backup is not part of this
     plan** — see the scope note at the top.
7. **Keep the standby honest while it is live**: if it is not the primary, it must not run
   schedulers (PART 0b). Turn `ENABLE_SCHEDULERS` off, or accept that backups, HOPE outbox,
   WhatsApp and retention are running twice.
8. Log in, open **Admin → Operational Health**, and run `docs/CARE_ERP_NAS_VALIDATION_CHECKLIST.md`.

---

## PART 3 — What a restored standby will not contain

Not a pessimistic hedge — the datasets in `docs/CARE_ERP_BACKUP_COVERAGE.md` that no dump
carries, with the recovery window each one actually has:

| dataset | on the standby after this procedure | real RPO |
|---|---|---|
| `diagnostic_erp` (patients, bills, payments, vouchers, report text) | yes | the age of the newest artifact that passes step 1 |
| uploaded documents, expense/receipt images (`uploads_data` volume) | **no** — not in the dump, and nothing in this repo copies the volume | unbounded: everything not separately copied is gone |
| frozen key-image pixels (`radiology-key-images/`, same volume) | **no** — `docker-compose.yml:418-422` explicitly warns | unbounded, and these are signed-report evidence |
| `audit_logs` older than the retention window | **no** — archived to `/app/data/archives`, which is on no volume, then deleted | already lost on the primary, so a standby cannot recover it |
| the live `.env` (`BACKUP_PASSPHRASE`, rotated secrets) | only if copied out of band | lose it and older **encrypted** dumps become undecryptable |
| Orthanc/DICOM images | not applicable by owner decision | out of scope, not a gap |

Owner decision, once, in writing: either the `uploads_data` volume is brought into the backup
and replication plan, or the clinic accepts that a failover loses attachments and frozen key
images and says so before it is needed. Silently discovering it during an outage is the failure
this section exists to prevent.

## Recovery objectives with this setup

- **RPO (database):** the age of the newest artifact that restores — *measured*, not "24 h".
  `node scripts/ops-backup-inventory.mjs` prints it per artifact; tighten it by backing up more
  often or syncing after each day-close, and re-measure after changing either.
- **RPO (everything in PART 3 marked "no"):** not currently bounded by anything.
- **RTO:** a few minutes pre-staged, ~15–20 min from bare metal — **plus** the time to build if
  PART 0's `uname -m` / `free -m` say the box cannot build, **plus** step 1's verification, which
  is not optional. Quoting "a few minutes" for a standby that has never restored an artifact is
  how a clinic spends its first outage discovering which of its backups work.

## Do not automate failover

There is no witness, no health-check-driven promotion, and there should not be one here
(I12 §10). Two reasons specific to this ERP:

1. **Split brain is a data-loss event, not a nuisance.** Two `care-api` processes against two
   `diagnostic_erp` databases produce two divergent bill number sequences and two day-closes.
   Reconciliation after that is manual, and `docs/DS225_EMERGENCY_BILLING_RECONCILIATION_SOP.md`
   is the kind of work it creates. A human choosing "the primary is gone" is the correct design.
2. **A false promotion costs more than an outage.** The standby has no uploads and no frozen
   images (PART 3). Bringing it up because a health check flapped replaces a delay with a
   permanent loss.

## After the emergency

When the primary is repaired, decide which NAS is authoritative, take a fresh backup from
whichever ran during the outage, verify it restores, and restore it onto the other so both match
before switching back. Never run both as the live billing system at the same time. Records
created on the standby during the outage exist only in the standby's database: take that dump
**before** anything is reprovisioned, and keep both dumps — the pre-outage one is the evidence
for whatever the audit asks about the gap.

## Failover checklist (print this)

- [ ] PART 0 answered on this box: CPU, RAM, Container Manager present, projects listed
- [ ] The DS225+ role decision is written down (PART 0b) and this box matches it
- [ ] Standby has the code, and you know its SHA
- [ ] `node --version` works, and every command you plan to run is `node …`, not `pnpm …`
- [ ] A matching `.env` (`JWT_SECRET`, `SESSION_SECRET`, `APP_NAME`) that also matches the **epoch of the artifacts**
- [ ] `care_main_db_data` does not already exist on this box under different contents
- [ ] An artifact is present on the standby, its `.meta` names `diagnostic_erp`, and `ops-backup-inventory` printed no `MISSING` day inside the span you intend to rely on
- [ ] `verify-backup-restore.sh` exited 0 **on this box**, and the proof was recorded with `--record-restore`
- [ ] `node scripts/ops-preflight.mjs` is not `NOT_READY`, and every critical `UNKNOWN` is one you have consciously accepted
- [ ] `docker compose up -d db` → `care-db` healthy; restore with no `ERROR:` lines
- [ ] `docker compose up -d` → all containers healthy, `care-db-patch-v2` and `care-schema-verify` `Exited(0)`
- [ ] `node scripts/deploy-health.mjs --host-port 8888` exits 0
- [ ] The stack came up under the project name you chose in PART 0, so `uploads_data` and
      `object_storage` are the volumes that hold content — open one uploaded patient document
      and one signed report's frozen key-image rail in the UI. `deploy-health` passing does
      not cover either, and a report that prints without its images looks normal.
- [ ] `ENABLE_SCHEDULERS` is off if the primary is anywhere still alive
- [ ] Network repointed; a test login and a test bill work; the PART 3 losses are stated to whoever signs off
- [ ] Change the bootstrap admin PIN if `BOOTSTRAP_ADMIN_FORCE` was used
