# CARE ↔ HOPE credential rotation — READINESS runbook

> **DO NOT EXECUTE ANYTHING IN THIS DOCUMENT. Rotation, restart, deploy, network
> change and any production database write are all forbidden here, and stay
> forbidden until the owner approves in writing. This package prepares rotation;
> it does not authorise it, and it is not a procedure to follow right now.**

Written 2026-10-15 against `origin/main` at `2d7d5c91`, in a documentation-only
checkout. Nothing in this file was run against the clinic. Every factual claim
carries a `file:line`; the guard test `scripts/credentialRotationReadiness.test.mjs`
re-reads those files at test time and fails if any of them drifts.

---

## (a) Scope, and what this document never authorises

**In scope (preparation only):** the two shared secrets on the CARE↔HOPE edge and
the configuration a rotation must keep consistent with them.

**Out of scope, never authorised by this document:**

1. **No rotation.** No new credential is generated against a live host, no `.env` is
   edited, no `integration_partners` row is written.
2. **No restart.** Specifically no restart of `care-api`: that container serves the live
   Bill Desk, Cashier, Accounting and Patient Registration screens, and restarting it
   interrupts them. Every restart step below is marked *OWNER-APPROVAL REQUIRED* and is
   not permission.
3. **No deploy.** `deploy-synology.sh` is not run; it hard-resets to `origin/main` and
   its step 2c invokes the secret gate (`deploy-synology.sh:163`).
4. **No network change, no call to HOPE.** Nothing here probes HOPE or sends an event.
5. **No production database write.** No `UPDATE`/`INSERT`, no `docker exec`, no psql.
6. **No printing of a value.** Not to a terminal, a chat, a ticket, a log or a
   screenshot. Where a value is described it is described by length and a 12-hex SHA-256
   digest prefix, never by content.
7. **No in-app "rotate key" button.** For this partner it is a trap — see (c)4.

**What the credential is.** CARE pushes signed events to HOPE over HTTPS; HOPE pushes
referrals to CARE. These two secrets are the shared identities between those products.
HOPE is not in clinical production. Whether this channel carries live traffic *today* is
**not observable from this repository** — the owner must confirm it before any window is
scheduled (see Step 2 and (g)4).

---

## (b) Credential inventory

Four names, two shared secrets. Each secret has a CARE-side name and a HOPE-side alias,
and both sides must hold the identical value.

| # | Credential (CARE env name) | HOPE-side alias | Purpose | Direction | Read at | Stored in | Posture observable from this checkout | Visible to tests / CI? |
|---|---|---|---|---|---|---|---|---|
| 1 | `HOPE_PARTNER_KEY` | `CARE_PARTNER_KEY` | Bearer credential HOPE presents to CARE; authenticated by SHA-256 hash lookup | **incoming** to CARE | `artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:104` (verify), `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:61` (env→DB stamp) | **both** — env is the source, DB `integration_partners.key_hash` is the per-request authority | templates assign an empty value (length 0): `.env.example:258`, `deploy/synology/care.env:135`. Live value **not measured here** — no `.env` exists in this checkout. | No live value. Tests use synthetic fixtures only (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.db.test.ts:81`, `scripts/integration-credential-posture.test.mjs:22`). CI sees the *digest of the previously published value*, `5dce9552501c`, at `scripts/check-env-secrets.mjs:61` |
| 2 | `INTEGRATION_HOPE_SIGNING_SECRET` | `CARE_CALLBACK_SECRET` | HMAC-SHA256 key signing CARE→HOPE outbox callbacks | **outgoing** from CARE | `artifacts/api-server/src/services/integration/outbox.ts:104` (sole read) | **env only** — no DB column exists for it, by design (`lib/db/src/schema/integrationPartners.ts:13`) | empty in templates (length 0): `.env.example:251`, `deploy/synology/care.env:133`. Live value **not measured here**. | No live value. CI sees digest `2c2c65bbe5fd` at `scripts/check-env-secrets.mjs:66` |
| 3 | `INTEGRATION_HOPE_CALLBACK_URL` | — (not a secret) | Where CARE POSTs signed events; **env overrides the DB row** | outgoing | `artifacts/api-server/src/services/integration/outbox.ts:103` | both, env wins (`artifacts/api-server/src/services/integration/outbox.ts:105`); DB column `callback_url` | the LAN endpoint at `.env.example:249`, `deploy/synology/care.env:132`; forwarded at `docker-compose.yml:316` | n/a (URL, not a credential) |
| 4 | `HOPE_CARE_INTEGRATION_FORCE` | — (not a secret) | Arms the bootstrap on hosts whose keys are empty | both (gate) | `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:77`, `docker/api-entrypoint.sh:13` | env, `docker-compose.yml:318` | empty at `.env.example:256`, **`=1`** at `deploy/synology/care.env:134` | n/a |

**Posture note.** A live length and live digest prefix are deliberately absent rather than
guessed. What is measurable from source: both tracked templates assign these names an
empty value, and the two values this repository *previously committed* are identified by
digest only — `5dce9552501c…` (partner key) and `2c2c65bbe5fd…` (signing secret), from
`scripts/check-env-secrets.mjs:61` and `scripts/check-env-secrets.mjs:66`. To obtain the
live posture without exposing anything, the owner runs
`node scripts/integration-credential-posture.mjs --care-file <CARE .env> --hope-file <HOPE .env>`
on the NAS: it prints name, character count (`scripts/integration-credential-posture.mjs:89`)
and an 8-hex digest prefix (`scripts/integration-credential-posture.mjs:57`), and never the
value. Exit codes: `0` agreement, `1` mismatch or published value
(`scripts/integration-credential-posture.mjs:137`), `2` unreadable file
(`scripts/integration-credential-posture.mjs:110`).

**Minimum accepted length** for both secrets, enforced by the deploy gate: 32
(`scripts/check-env-secrets.mjs:33`).

---

## (c) Dependency / consumer map

Line format — `` `file:line` `` :: `` `identifier` `` :: role — description.
The guard test asserts each cited identifier appears within ±5 lines of the cited line,
and that every cited path exists.

### c1. `HOPE_PARTNER_KEY` — read to VERIFY incoming (never to sign outgoing)

- `artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:104` :: `keyHash` :: verify-incoming — the only per-request authentication site; compares `sha256(Bearer …)` to the DB column and **never reads the environment**
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:61` :: `HOPE_PARTNER_KEY` :: stamp-db — takes the env value
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:115` :: `hashPartnerApiKey` :: derive — SHA-256 of that value
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:116` :: `rawKey.slice(0, 14)` :: derive — persists 14 characters of the live key as `key_prefix`
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:145` :: `keyHash` :: stamp-db — the overwrite that defeats a UI rotation
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:131` :: `keyHash` :: stamp-db — same, on the insert branch
- `artifacts/api-server/src/index.ts:2982` :: `bootstrapHopeCareIntegration()` :: hook — runs on **every** API start
- `docker/api-entrypoint.sh:19` :: `bootstrap-hope-care-integration.mjs` :: hook — a second, pre-listen copy of the same stamp
- `scripts/bootstrap-hope-care-integration.mjs:88` :: `HOPE_PARTNER_KEY` :: gate — the CLI form of the same rule
- `docker-compose.yml:319` :: `HOPE_PARTNER_KEY` :: forward — without this line the container never sees the value
- `scripts/check-env-secrets.mjs:142` :: `HOPE_PARTNER_KEY` :: gate — deploy step 2c; fails the deploy
- `scripts/integration-credential-posture.mjs:37` :: `HOPE_PARTNER_KEY` :: display — digest-only probe
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:80` :: `HOPE_PARTNER_KEY` :: gate — arming decision
- `.env.example:258` :: `HOPE_PARTNER_KEY` :: template
- `deploy/synology/care.env:135` :: `HOPE_PARTNER_KEY` :: template
- `deploy/synology/hope.env:61` :: `CARE_PARTNER_KEY` :: template — HOPE's alias, also empty
- `artifacts/diagnostic-erp/src/pages/IntegrationAdmin.tsx:207` :: `keyPrefix` :: display — shows the 14-char prefix to admins

### c2. `INTEGRATION_HOPE_SIGNING_SECRET` — read to SIGN outgoing

- `artifacts/api-server/src/services/integration/outbox.ts:104` :: `INTEGRATION_${code}_SIGNING_SECRET` :: sign-outgoing — the only place the signing key is obtained; **env-only, no DB fallback**
- `artifacts/api-server/src/services/integration/outbox.ts:85` :: `createHmac` :: sign-outgoing — HMAC-SHA256 over `<timestamp>.<body>`
- `artifacts/api-server/src/services/integration/outbox.ts:370` :: `x-care-signature` :: sign-outgoing — wire format `sha256=<hex>`
- `artifacts/api-server/src/services/integration/outbox.ts:369` :: `x-care-timestamp` :: sign-outgoing — unix seconds; the receiver's staleness rule makes host clock skew part of this edge
- `artifacts/api-server/src/services/integration/outbox.ts:336` :: `cfg.secret` :: gate — no secret ⇒ row stays `pending` with `delivery_not_configured`; nothing sent, nothing dead-lettered
- `artifacts/api-server/src/services/electronicFilm/diagnostics.ts:120` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: display — reports set/unset only, never a value
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:81` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: gate — arming decision
- `docker/api-entrypoint.sh:14` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: gate — arming decision
- `docker-compose.yml:317` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: forward
- `scripts/check-env-secrets.mjs:151` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: gate
- `scripts/integration-credential-posture.mjs:43` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: display
- `.env.example:251` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: template
- `deploy/synology/care.env:133` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: template
- `deploy/synology/hope.env:62` :: `CARE_CALLBACK_SECRET` :: template
- `artifacts/diagnostic-erp/src/pages/HopeHospitalConnection.tsx:214` :: `INTEGRATION_HOPE_SIGNING_SECRET` :: display — the UI already tells staff it is env-only

### c3. Adjacent configuration a rotation must keep consistent

- `artifacts/api-server/src/services/integration/outbox.ts:105` :: `url: envUrl ?? dbUrl` :: gate — callback URL is env-first, DB-second, evaluated per delivery
- `artifacts/api-server/src/services/integration/outbox.ts:99` :: `code = p.code` :: derive — the DB `code` column chooses **which env var name** is read; renaming the partner silently renames the variable
- `lib/db/src/schema/integrationPartners.ts:28` :: `keyHash` :: column — one `text` value, no list
- `lib/db/src/schema/integrationPartners.ts:31` :: `keyPrefix` :: column — 14 characters of the live key; never `select` this table
- `lib/db/src/schema/integrationPartners.ts:33` :: `callbackUrl` :: column
- `lib/db/src/schema/integrationPartners.ts:40` :: `permissions` :: column — re-stamped to the full allowlist at boot (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:148` :: `permissions`)
- `lib/db/src/schema/integrationOutbox.ts:34` :: `maxAttempts` :: retry — default **8**
- `artifacts/api-server/src/services/integration/outbox.ts:108` :: `backoffMs` :: retry — `30s · 2ⁿ`, capped at 1 h
- `artifacts/api-server/src/services/integration/outbox.ts:230` :: `timeoutMs` :: retry — 15 s per HTTP attempt
- `artifacts/api-server/src/services/integration/scheduler.ts:82` :: `tickOutbox` :: retry — dispatch every minute, only with `ENABLE_SCHEDULERS`
- `artifacts/api-server/src/routes/index.ts:367` :: `integration/v1` :: mount — partner-facing routes
- `artifacts/api-server/src/routes/index.ts:415` :: `integration/admin` :: mount — `requireStaffAuth` + `requireAdminRole`
- `artifacts/api-server/src/routes/integration/inbound.ts:258` :: `diagnostic_referral:read` :: route — the read-only proof route
- `artifacts/api-server/src/routes/integration/admin.ts:92` :: `rotate-key` :: route — **the trap; see (c)4**
- `artifacts/api-server/src/routes/integration/admin.ts:95` :: `keyHash` :: stamp-db — writes a generated key to the DB, and to the DB only
- `artifacts/api-server/src/routes/integration/admin.ts:107` :: `set.callbackUrl` :: stamp-db — admin write to a column env overrides
- `artifacts/diagnostic-erp/src/pages/HopeHospitalConnection.tsx:113` :: `rotate-key` :: display — the in-app button behind that endpoint
- `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:28` :: `DEFAULT_HOPE_CALLBACK_URL` :: derive — hard-coded LAN fallback when env is unset

### c4. The env-is-authoritative trap — verified, and sharper than the brief said

The brief said: an admin rotate writes the DB, the process reads env first, so a UI
rotation does not stick. Verified in code, the real precedence is **not one rule but three**,
and they differ by which half of the edge you are on.

**Outbound signing secret — env is the *only* authority, per request.**
`artifacts/api-server/src/services/integration/outbox.ts:104` reads
`process.env[\`INTEGRATION_${code}_SIGNING_SECRET\`] ?? null` with no DB candidate in the
expression at all. There is nothing for the DB to win against: a secret stored anywhere
other than the environment is never read.

**Callback URL — env beats DB, per delivery. The precedence expression is
`artifacts/api-server/src/services/integration/outbox.ts:105` :: `url: envUrl ?? dbUrl`.**
So the admin edit at `artifacts/api-server/src/routes/integration/admin.ts:107` has no
effect while the env variable is set, and a container start re-overwrites the column from
env anyway (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:147` :: `callbackUrl`).

**Inbound partner key — DB is authoritative per request, but env re-stamps the DB on every
container start.** `artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:104`
reads only the DB hash, so `POST …/rotate-key` *does* take effect immediately — and is then
silently reverted at the next boot, because `artifacts/api-server/src/index.ts:2982` runs
`bootstrapHopeCareIntegration()` on every API start and
`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:145` writes `keyHash` derived
from `HOPE_PARTNER_KEY`. The same stamp runs a second time pre-listen from
`docker/api-entrypoint.sh:19`. Net effect for the owner: **a UI rotation reports success,
works until the next restart, then breaks inbound HOPE→CARE traffic with
`401 invalid_or_revoked_key` at a moment nobody chose.** The repository already states this
at `scripts/check-env-secrets.mjs:146` and `docs/hope-care-integration/06_CREDENTIAL_ROTATION.md:80`.

**Ordering consequence.** Both env reads happen at process start (`process.env` is fixed
when the process boots), so **editing a `.env` changes nothing on a running container.** No
credential takes effect without restarting the process that reads it — and on the CARE side
that process is `care-api`.

### c5. What happens if only one half changes

| Changed alone | Immediate effect | Recoverable? |
|---|---|---|
| CARE partner key only | HOPE's bearer no longer hashes to `key_hash` → every inbound request 401 (`artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:108` :: `invalid_or_revoked_key`) | Yes — restore the pair; nothing is queued inbound |
| HOPE partner key only | the same 401, from the other side | Yes |
| CARE signing secret only | CARE signs new, HOPE verifies old → callback 401; rows go `pending → http_401` and dead-letter at attempt 8 (`artifacts/api-server/src/services/integration/outbox.ts:400` :: `maxAttempts`) | Partially — dead rows need `POST /api/integration/admin/outbox/:id/retry` (`artifacts/api-server/src/routes/integration/admin.ts:213` :: `retry`) |
| HOPE callback secret only | same, mirrored | Partially, as above |
| `INTEGRATION_HOPE_CALLBACK_URL` only | events POSTed to the wrong host; unreachable ⇒ retry, then dead-letter | Yes, if caught inside the retry budget |
| DB `code` for the partner | the env var CARE reads changes name (`artifacts/api-server/src/services/integration/outbox.ts:99`) → secret null → `delivery_not_configured`, everything stays `pending` | Yes, by restoring the code |

**Window shape, stated plainly.** With `max_attempts = 8`
(`lib/db/src/schema/integrationOutbox.ts:34`) and `30s·2ⁿ` capped at 1 h
(`artifacts/api-server/src/services/integration/outbox.ts:108`), an event queued at the
start of a broken window exhausts its retries roughly 30–40 minutes later; a window longer
than about an hour dead-letters whatever was queued in it, and those rows return only via
the manual retry route.

---

## (d) Safe rotation sequence — PREPARED, NOT AUTHORISED

Every step has `Pre-check` / `Action` / `Post-check` / `Abort criterion` / `Rollback`.
Steps 7 and 8 are **OWNER-APPROVAL REQUIRED** because they restart containers. Do not begin
until the owner has approved this document.

**Ordering constraint from (c)4:** stage both `.env` files *before* restarting either
process, and keep only one clinic-visible restart. Restart **HOPE first, `care-api` last**:
HOPE is not in clinical production, and ending on `care-api` means the pair becomes
consistent the moment the clinic-facing container returns. The mismatch window breaks both
directions in either order, so the tie-breaker is which restart the clinic feels — it is
`care-api`.

### Step 1 — Record the approval, and the pre-rotation posture
- **Pre-check:** an explicit, dated owner approval naming this document exists; no deploy is in progress.
- **Action:** run `node scripts/integration-credential-posture.mjs --care-file <CARE .env> --hope-file <HOPE .env>` and record its output next to the approval. Names, lengths, 8-hex prefixes only.
- **Post-check:** both pairs report `pair matches: YES` *before* you start — otherwise you are rotating into an outage you did not cause, and the record must say so.
- **Abort criterion:** no written approval; or the probe prints a value (it cannot by design — `scripts/integration-credential-posture.test.mjs:119` proves it does not).
- **Rollback:** none required; this step changed nothing. Delete the notes file if it holds anything beyond names and prefixes.

### Step 2 — Confirm whether the channel is actually live
- **Pre-check:** read-only admin access to `GET /api/integration/admin/outbox` (`artifacts/api-server/src/routes/integration/admin.ts:192` :: `outbox`).
- **Action:** record counts by status. Non-zero `pending`/`sending` means real events are in flight and the window must be scheduled around them.
- **Post-check:** the counts are written into the approval record.
- **Abort criterion:** any `sending` row older than one dispatch tick (`artifacts/api-server/src/services/integration/scheduler.ts:82`) — that delivery is mid-POST and would be cut in flight.
- **Rollback:** none required; read-only.

### Step 3 — Generate two replacement values locally, into mode-600 files
- **Pre-check:** `umask` gives `077`; the target directory is access-restricted, not a shared or synced folder.
- **Action:** follow (e)2. Two values, one per pair, each written by redirection, never echoed.
- **Post-check:** `ls -l` shows `-rw-------`; `wc -c` reports 65 or 71 bytes; the value never appeared on a tty.
- **Abort criterion:** the value was displayed, typed at a prompt, left in shell history, or written into any tracked file. If so it is burned — regenerate and treat the burned value as disclosed.
- **Rollback:** delete the scratch files (`shred -u` where available) and start again. No host has changed.

### Step 4 — Prove the two new halves agree *before* either host sees them
- **Pre-check:** two staged env files exist and neither is a live host file yet.
- **Action:** run the posture probe against the staged pair; require `pair matches: YES` on both rows.
- **Post-check:** no `WEAK` and no `PUBLISHED-IN-GIT` flag on any of the four lines.
- **Abort criterion:** any `pair matches: NO` — restarting now guarantees an outage that no rollback note will fix.
- **Rollback:** discard the staged files; live hosts untouched.

### Step 5 — Stage CARE's `.env` (no restart)
- **Pre-check:** `cp -p .env .env.pre-rotation-<utc-stamp> && chmod 600 .env.pre-rotation-*` so the rollback copy exists and is not world-readable.
- **Action:** set `HOPE_PARTNER_KEY` and `INTEGRATION_HOPE_SIGNING_SECRET` to the new values without displaying them (see (e)3). Never write either into `deploy/synology/care.env` — `deploy/synology/care.env:126` already forbids it.
- **Post-check:** `node scripts/check-env-secrets.mjs --file .env` exits 0 and names neither credential as weak, unset or published.
- **Abort criterion:** that command fails, or `docker-compose.yml:317` / `docker-compose.yml:319` no longer forward the variables — a correct `.env` then still yields an unset container environment.
- **Rollback:** restore the stamped copy and `chmod 600 .env`. The running container is unaffected either way, because nothing has been restarted.

### Step 6 — Stage HOPE's `.env` (no restart)
- **Pre-check:** the same stamped-backup discipline as Step 5, in HOPE's own project directory.
- **Action:** set `CARE_PARTNER_KEY` and `CARE_CALLBACK_SECRET` to the matching new values.
- **Post-check:** the Step 4 probe, re-run against both staged live files, reports `pair matches: YES` twice.
- **Abort criterion:** the two files disagree in any digest prefix.
- **Rollback:** restore HOPE's stamped copy. Nothing restarted yet.

### Step 7 — Restart HOPE  *(OWNER-APPROVAL REQUIRED)*
- **Pre-check:** HOPE answers its own health check; nobody is mid-prescription against it; the Step 6 post-check is green.
- **Action:** restart HOPE's application process only. CARE deliberately still runs the old pair. HOPE's project name, container names and restart command are **not** in this repository, so this step is deliberately a description, not a copied command — the owner supplies it from HOPE's own runbook.
- **Post-check:** HOPE's callback receiver answers `401` (not `503`) to an unsigned POST: the secret is loaded, not absent.
- **Abort criterion:** HOPE comes up reporting its callback secret unset. Then CARE must **not** be restarted; roll HOPE back instead.
- **Rollback:** restore HOPE's `.env` from the Step 6 copy and restart HOPE again. CARE never moved, so the channel returns to its exact prior state.

### Step 8 — Restart `care-api`  *(OWNER-APPROVAL REQUIRED — interrupts the live Bill Desk)*
- **Pre-check:** clinic staff warned; no `sending` rows (Step 2); `ENABLE_SCHEDULERS` set on exactly one process so a second dispatcher does not start (`artifacts/api-server/src/services/integration/scheduler.ts:82`); the schema containers are healthy.
- **Action:** restart the `care-api` container. This is the only clinic-visible action in this runbook. `docker/api-entrypoint.sh:19` and `artifacts/api-server/src/index.ts:2982` then re-stamp `integration_partners.key_hash` and `callback_url` from the new environment before the server takes traffic.
- **Post-check:** the startup log contains `Hope↔Care integration bootstrapped` and not `bootstrap failed`; the row's `key_prefix` shows the new 14 characters via `GET /api/integration/admin/partners` (`artifacts/api-server/src/routes/integration/admin.ts:56` :: `keyPrefix`) — never by selecting the table.
- **Abort criterion:** the API logs `HOPE_PARTNER_KEY is not set` (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:62`), or `partnerAction` is absent, or the process crash-loops. Then the DB still holds the OLD hash while HOPE sends the NEW key: inbound is broken and must be rolled back immediately.
- **Rollback:** restore CARE's `.env` from the Step 5 copy and restart `care-api` once more (a second clinic-visible interruption — which is exactly why Step 4 exists); roll HOPE back too if Step 7 already ran.

### Step 9 — Prove it without clinical traffic
- **Pre-check:** Step 8's post-check is green.
- **Action:** run the read-only proofs in (f). Inbound is proved with a `GET` against a partner-authenticated **read-only** route, `GET /api/integration/v1/catalogue` (`artifacts/api-server/src/routes/integration/inbound.ts:258`), which authenticates the new bearer key and writes no clinical row. Outbound acceptance is proved only by delivery state — see (f)3 for the honest limit.
- **Post-check:** inbound answers 200 with the new key and 401 with the old; rows queued during the window move to `sent`.
- **Abort criterion:** inbound answers 401 with the new key (environment and database disagree — check `docker-compose.yml:319`), or queued rows reach `dead`.
- **Rollback:** if inbound fails, revert both hosts to their stamped copies and restart both — never leave the pair half-moved. If only outbound dead-lettered, keep the new credentials and re-drive the dead rows with `POST /api/integration/admin/outbox/:id/retry` (`artifacts/api-server/src/routes/integration/admin.ts:213`); that is a repair, not a revert.

### Step 10 — Record, and destroy the scratch material
- **Pre-check:** every proof in (f) captured.
- **Action:** append the two lengths, the two 8-hex prefixes, the date, the approver and the window duration to the change record; delete the mode-600 scratch files.
- **Post-check:** `node scripts/ops-preflight.mjs` on the NAS still reports `credentials.safe` as PASS (`scripts/ops-preflight.mjs` :: `credentials.safe`), and the record contains no value.
- **Abort criterion:** the record contains a value, or a scratch file is still on disk.
- **Rollback:** the record is re-issued rather than rolled back; if scratch files remain the rotation is not finished — treat those values as at risk and regenerate on the next approved window.

---

## (e) Generating a replacement value

Two shapes, matching what the code accepts: the partner key looks like an issued key
(`intgk_` + 64 hex = 70 characters — `artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:43` :: `randomBytes`), and the signing secret is 64 hex from
`openssl rand -hex 32` (`deploy/synology/README.md:35`). Bootstrap refuses a partner key
shorter than `MIN_PARTNER_KEY_LENGTH = 32` (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:50` :: `MIN_PARTNER_KEY_LENGTH`).

1. **Never type the value.** No `openssl rand` to stdout, no `export X=`, no paste into
   chat or a ticket, no `echo`, no `cat`, no `set -x`. Nothing that reaches a log, a
   terminal scrollback or a screenshot. Nothing committed to a tracked file.
2. **Generate by redirection into a mode-600 file, then lock it down:**
   ```sh
   umask 077
   mkdir -p .rotation && chmod 700 .rotation
   KEYFILE=.rotation/hope-partner-key.new
   printf 'intgk_%s' "$(openssl rand -hex 32)" > "$KEYFILE"
   chmod 600 "$KEYFILE"

   SECFILE=.rotation/hope-signing-secret.new
   openssl rand -hex 32 > "$SECFILE"
   chmod 600 "$SECFILE"
   ```
   Use `printf`, not `echo`, and be deliberate about the trailing newline: the deploy-gate
   env loader trims values and strips surrounding quotes when it reads a file
   (`scripts/check-env-secrets.mjs:80` :: `trim`), and the inbound middleware trims the
   bearer token (`artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:86` :: `trim`),
   but the outbox signer does **no** trimming
   (`artifacts/api-server/src/services/integration/outbox.ts:104` :: `process.env`) — so a
   secret that picked up a stray newline disagrees with the peer in exactly the way a wrong
   secret does, and only the digest comparison in (e)4 will show it.
3. **Write it into the env file without displaying it:**
   ```sh
   KEY="$(cat "$KEYFILE")"
   sed "s|^HOPE_PARTNER_KEY=.*|HOPE_PARTNER_KEY=${KEY}|" .env > .env.new
   chmod 600 .env.new && mv .env.new .env
   ```
4. **Verify the produced value's digest without printing it:**
   ```sh
   node -e 'const c=require("node:crypto"),f=require("node:fs");
   const v=f.readFileSync(process.argv[1],"utf8").trim();
   console.log(process.argv[2], v.length, c.createHash("sha256").update(v).digest("hex").slice(0,12))' \
     "$KEYFILE" HOPE_PARTNER_KEY
   ```
   Output is name, length, and twelve hex characters — three facts, no secret. The **same
   prefix must appear on both hosts' copies of a pair** before Step 7; that comparison is
   Step 4. The probe in (b) does the same thing across two files at once, so it is the gate
   and this is the manual fallback.
5. **A precedent not to copy.** `scripts/rotate-internal-api-key.sh:25` :: `sed` writes a
   freshly generated key into a **tracked** file, and its default target is
   `scripts/rotate-internal-api-key.sh:12` :: `TARGET` (`deploy/synology/care.env`). That is
   defensible for a template that ships nowhere and is wrong for this pair: it would commit
   the live secret and fail the ratchet (`scripts/check-no-committed-secrets.mjs:165` :: `grew`).
   Do not point that script at the Hope credentials.

---

## (f) Verification with the repository's own read-only tools

| Question after a rotation | Tool (real path) | Which answer proves it |
|---|---|---|
| Do both hosts hold the **same** value, without me looking at it? | `scripts/integration-credential-posture.mjs` | `pair matches: YES` on both pairs — digest-prefix comparison at `scripts/integration-credential-posture.mjs:73` :: `digestPrefix`; output is name/length/prefix at `scripts/integration-credential-posture.mjs:89`. Exit `0`/`1` at `scripts/integration-credential-posture.mjs:137` :: `rotateRequired`. **This is the only existing self-contained proof of agreement, and it needs no network, no database and no restart.** |
| Is the live value one this repository published? | `scripts/check-env-secrets.mjs` | exit 0. `PUBLISHED_CREDENTIALS` (`scripts/check-env-secrets.mjs:59`) is compared by `findPublishedMatch` (`scripts/check-env-secrets.mjs:108`); a hit reports name and reason only (`scripts/check-env-secrets.mjs:177` :: `reason`). Deploy-enforced at `deploy-synology.sh:163` |
| Is the deployment still gate-clean? | `scripts/ops-preflight.mjs` | `credentials.safe` (`scripts/ops-preflight.mjs` :: `credentials.safe`) answers the published/weak question; `env.required` (`scripts/ops-preflight.mjs` :: `env.required`) answers presence — **note `HOPE_PARTNER_KEY` and `INTEGRATION_HOPE_SIGNING_SECRET` are not in `REQUIRED_ENV`** (`scripts/ops-preflight.mjs` :: `REQUIRED_ENV`), so an absent Hope credential surfaces only through `credentials.safe` and `hope.integration`; `hope.integration` (`scripts/ops-preflight.mjs` :: `hope.integration`) answers "armed and has a callback URL"; `hope.receiver_version` (`scripts/ops-preflight.mjs` :: `hope.receiver_version`) answers only what an operator previously recorded, because the HOPE side is not observable from here |
| Did I commit anything? | `scripts/check-no-committed-secrets.mjs --baseline scripts/committed-secrets-baseline.json` | `passed against baseline … 16 findings in 8 files`. Shrink-only ratchet at `scripts/check-no-committed-secrets.mjs:165`; its own findings print masked values (`scripts/check-no-committed-secrets.mjs:197` :: `masked`) |
| Is the value in the **process**, not just the file? | `printenv` inside the running container | `docker exec care-api sh -c 'for v in HOPE_PARTNER_KEY INTEGRATION_HOPE_SIGNING_SECRET; do if printenv "$v" >/dev/null; then echo "$v=set"; else echo "$v=unset"; fi; done'` prints presence only. This is what separates "I edited `.env`" from "the value is loaded", because the signer reads a boot-frozen `process.env` at dispatch time (`artifacts/api-server/src/services/integration/outbox.ts:104`) |
| Could `.env` be right and the container still wrong? | `docker-compose.yml` | `docker-compose.yml:317` and `docker-compose.yml:319` are the only path from `.env` into `care-api`; a missing line makes the secret unset no matter what the file says |
| Is the callback target still the right host? | `scripts/deploy-health.mjs` | `hopeOriginFromEnvText` (`scripts/deploy-health.mjs` :: `hopeOriginFromEnvText`) reports the HOPE origin and reachability as a **note, never a gate** (`scripts/deploy-health.mjs` :: `hopeNote`) — it opens a socket, so it proves reachability, not credential agreement |
| Is inbound really authenticating with the new key? | `GET /api/integration/v1/catalogue` | `artifacts/api-server/src/routes/integration/inbound.ts:258` — read-only, permission `diagnostic_referral:read`, no clinical write; 200 with the new key and 401 with the old. Every attempt, allowed or denied, lands in `integration_partner_audit_log` (`artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:129` :: `logAttempt`) |

### f3. The honest limit on proving the OUTBOUND half

**No self-signed test event exists.** CARE emits only business event types and each one
requires a real referral / report / film row; there is no `*.test` or `ping` type among
them, and `dispatchPendingOutbox` has no dry-run parameter — its option object takes
`limit`, `workerId`, `timeoutMs`, `staleLeaseMs` only
(`artifacts/api-server/src/services/integration/outbox.ts:223` :: `opts`). So the
least-impact proof the code supports today is **indirect**:

1. prove the **value** agrees on both hosts with the posture probe (no traffic at all);
2. prove CARE **signed** something by watching an event that had to move anyway go
   `pending → sent` in `GET /api/integration/admin/outbox`
   (`artifacts/api-server/src/routes/integration/admin.ts:192`);
3. prove HOPE **accepted** the signature only from the absence of `http_401` in the
   per-attempt log (`artifacts/api-server/src/routes/integration/admin.ts:207` :: `attempts`).

If neither (2) nor (3) is reachable inside the window, **outbound acceptance is unproved**
and must be recorded as unproved rather than assumed. A staging pair would close this gap;
this repository contains nothing wired for that purpose.

---

## (g) Residual risks the owner must personally decide

1. **The published values are still published.** Both credentials were committed while the
   repository was public; git history retains every copy, so deleting them from the working
   tree does not un-leak them. Evidence: `scripts/check-env-secrets.mjs:59` keeps their
   digests precisely so a live value can be matched without re-printing it, and
   `docs/hope-care-integration/06_CREDENTIAL_ROTATION.md:15` lists 17 places across 8 files.
   *Decision: is rotation overdue rather than optional?*
2. **16 committed secret findings across 8 tracked files exist at `2d7d5c91`,** verified by
   `scripts/check-no-committed-secrets.mjs` against
   `scripts/committed-secrets-baseline.json`. **None is a Hope-edge credential** — both are
   empty at `deploy/synology/care.env:133`, `deploy/synology/care.env:135`,
   `deploy/synology/hope.env:61` and `deploy/synology/hope.env:62`. 8 sit in
   `deploy/synology/care.env` (`JWT_SECRET`, `SESSION_SECRET`, `BACKUP_PASSPHRASE`,
   `CRON_SECRET`, `SUPER_ADMIN_USB_KEY`, `ICICI_SECRET_KEY`, `INTERNAL_API_KEY`,
   `OCR_WORKER_TOKEN`), 1 in `deploy/synology/hope.env`, 3 in test material — twice in
   `artifacts/api-server/src/lib/secretStrength.test.ts` and once as a PEM block in
   `lib/ai-providers/src/hardenedTransport.test.ts` — 2 in the two copies of the financial
   change log (`docs/archive/FINANCIAL_FORMULA_CHANGE_LOG.md` and
   `SOP/RECOVERY/08_FINANCIAL/FINANCIAL_FORMULA_CHANGE_LOG.md`, which the binder keeps as a
   twin), 1 in `.replit`, 1 in a vendored C# patch
   (`dicom-to-windows-export/DicomToWindows-electronic-film/patches/0001-Add-electronic-film-jobs-capture-modes-and-local-adm.patch`),
   which is 16 in total, and
   `scripts/credentialRotationReadiness.test.mjs` re-adds them from the baseline instead of
   trusting this sentence. Names only — no
   value is needed, and none is printed here. *Decision: rotate each separately;
   `SESSION_SECRET`/`JWT_SECRET` sign out every staff member, `BACKUP_PASSPHRASE` strands
   30 days of encrypted dumps, `ICICI_SECRET_KEY` is an issuer credential. Bundling them
   into a Hope rotation is how this becomes an outage.*
3. **The in-app rotate-key button is a live footgun for this partner.** It writes only the
   DB (`artifacts/api-server/src/routes/integration/admin.ts:95`) and is re-overwritten at
   the next boot (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:145`), while
   the UI still offers it (`artifacts/diagnostic-erp/src/pages/HopeHospitalConnection.tsx:113`).
   Nothing in the code disables it for the `HOPE` row. *Decision: remove the button for this
   partner, or rely on staff training?*
4. **No dual-accept exists, so a zero-downtime overlap is impossible as the code stands.**
   Inbound comparison is a single-value `eq` against one `text` column
   (`artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts:104`,
   `lib/db/src/schema/integrationPartners.ts:28`); outbound is one `process.env` lookup
   (`artifacts/api-server/src/services/integration/outbox.ts:104`). There is no array, no
   `alt`/`previous`/`old` key, no key list, and no `kid` selector consulted at verification
   time — `key_prefix` is display-only (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:116`).
   So a rotation **must** contain a window where one side signs with the new value and the
   other verifies with the old. Outgoing events in that window are not lost — they retry
   (`artifacts/api-server/src/services/integration/outbox.ts:108`) until attempt 8
   (`lib/db/src/schema/integrationOutbox.ts:34`) and then dead-letter. **Incoming referrals
   in that window are refused outright with a 401** and are only recoverable if HOPE retries
   them, which is outside this repository. *Decision: accept the window, or fund a
   dual-accept change first.*
5. **Clock skew is part of the signature.** `x-care-timestamp` is unix seconds
   (`artifacts/api-server/src/services/integration/outbox.ts:364`) and the HMAC covers
   `<timestamp>.<body>` (`artifacts/api-server/src/services/integration/outbox.ts:85`). There
   is no nonce, and no skew tolerance is defined anywhere in this repository — the receiver's
   rule lives in HOPE. *Decision: verify both hosts' clocks before the window.*
6. **A `care-api` restart interrupts the live Bill Desk**, and Step 8 cannot be avoided
   because the environment is read at process start. There is no hot-reload path for either
   credential. *Decision: the window itself.*
7. **The bootstrap overwrites more than the credential at every start:** `callback_url`,
   `permissions` and `is_active` are all re-stamped from env and code
   (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:147`,
   `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:148`,
   `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:149`). Any admin narrowing
   of HOPE's permissions (`artifacts/api-server/src/routes/integration/admin.ts:109`) is
   widened back to the full allowlist on the next boot. *Decision: acceptable for a partner
   holding `whatsapp:enqueue`?*
8. **The callback URL is not a secret but is a hard-coded fallback.**
   `DEFAULT_HOPE_CALLBACK_URL` (`artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts:28`)
   is a literal LAN address used when the env value is unset, so a host with the secret set
   and the URL unset writes that address into the DB and POSTs signed events to it.
   *Decision: should the fallback exist at all?*
9. **`ENABLE_SCHEDULERS` widens the blast radius of a restart.** Dispatch runs every minute
   only where exactly one process is scheduled
   (`artifacts/api-server/src/services/integration/scheduler.ts:82`); a restart that changes
   which process holds the flag can start two dispatchers or none. *Decision: confirm the
   flag before Step 8.*

---

## What this document deliberately does NOT claim

- **The live length or digest prefix of either credential.** No `.env` exists in this
  checkout and none was read. (b) therefore reports the template state (empty, length 0)
  and the previously published digests only. Any live figure here would have been invented;
  Step 1 and (e)4 are how the owner measures it.
- **That HOPE's receiver code accepts a given signature.** HOPE is a separate repository and
  nothing in it was read. Every HOPE-side statement here is limited to the aliases in
  `deploy/synology/hope.env` and what CARE's own failure paths imply.
- **That the CARE→HOPE channel is carrying live traffic.** Outbox contents, HOPE's answers
  and the current `integration_partners` row are database and network facts this checkout
  cannot see; Steps 1–2 measure them.
- **That outbound HMAC acceptance can be proved without a real event.** The search for a
  test/ping event type and for a dry-run flag found neither, so the claim is not made ((f)3).
- **That clock skew, retry count or backoff are configurable.** The only values found are
  code-level defaults (`artifacts/api-server/src/services/integration/outbox.ts:230`,
  `lib/db/src/schema/integrationOutbox.ts:34`); no env variable for tolerance, skew,
  attempts or backoff exists in `docker-compose.yml`.
- **HOPE's restart command.** Its project name and container names are not in this
  repository, so Step 7 describes the action instead of inventing a command.
