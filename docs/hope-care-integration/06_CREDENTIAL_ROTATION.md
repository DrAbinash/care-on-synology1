# 6. HOPE ↔ CARE credential exposure and rotation

**Status: exposure confirmed, code fixed, rotation NOT performed.**
Writing date 2026-10-15, against `origin/main` at `6e649ffc`. Nothing in this file was
executed against the clinic: no credential was generated, rotated, printed or sent, and no
production host was touched. Rotating a live credential is the owner's action.

---

## 1. What was exposed

`DrAbinash/care-on-synology1` is a **public** GitHub repository (verified: the unauthenticated
`GET /repos/DrAbinash/care-on-synology1` returns 200, and
`raw.githubusercontent.com/…/main/deploy/synology/care.env` returns 200). Until this change,
two live integration credentials were committed in it, in **17 places across 8 tracked files**:

| file | what it held |
|---|---|
| `.env.example` | both values, as the root template every deploy starts from |
| `deploy/synology/care.env` | both values, the template `deploy-synology.sh` copies to `.env` |
| `deploy/synology/hope.env` | both values under their HOPE-side names |
| `deploy/synology/README.md` | both values, twice, as setup instructions |
| `deploy-synology.sh` | both values, appended into any `.env` that lacked them |
| `patch` | both values again, inside a `git format-patch` output committed by #350 |
| `artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts` | the partner key as `DEFAULT_HOPE_PARTNER_KEY` |
| `scripts/bootstrap-hope-care-integration.mjs` | the same key as `DEFAULT_PARTNER_KEY` |

The values themselves are not repeated in this document, in the PR, or in any test. They are
identified below by SHA-256 digest only:

| credential | env names (CARE / HOPE) | sha256 | role |
|---|---|---|---|
| inbound partner key | `HOPE_PARTNER_KEY` / `CARE_PARTNER_KEY` | `5dce9552501ceca7…` | `Authorization: Bearer …` to CARE |
| callback signing secret | `INTEGRATION_HOPE_SIGNING_SECRET` / `CARE_CALLBACK_SECRET` | `2c2c65bbe5fd7e52…` | HMAC on CARE→HOPE callbacks |

**What either one buys an attacker.** The partner key authenticates against
`requireIntegrationPartnerAuth`, which looks the caller up by `sha256(key)` in
`integration_partners.key_hash` and is granted `diagnostic_referral:create/update/cancel/read`,
`diagnostic_result:acknowledge` and `whatsapp:enqueue` — so it can write and cancel referrals,
acknowledge results and send WhatsApp messages to patients as HOPE. The signing secret lets
anyone produce a `sha256=<hmac>` header that HOPE's `requireCareSignature` accepts, i.e. post
fabricated results or amendments into HOPE's patient record from a source HOPE believes is CARE.

**Scope notes.** `deploy/synology/hope.env` is HOPE's template, committed *in this public repo*;
the sibling `DrAbinash/hope` repository is private (unauthenticated request returns 404), but
that no longer matters — the shared values were published from the public side. Git history still
contains every copy: **removing them from the current source does not make the historical values
safe.** They must be considered disclosed.

## 2. What the code does now

Three layers, each independently fail-closed, none of them able to invent a credential:

1. **`bootstrapHopeCareIntegration.ts`** — `HOPE_PARTNER_KEY` comes from the environment only.
   Armed but unset (`HOPE_CARE_INTEGRATION_FORCE=1` was committed in the templates, so this was
   the default state of every Synology host) → the partner is **not** registered,
   `ff_hope_care_referrals` is **not** enabled, and the reason is logged with no value in it.
   Same rule in the standalone `scripts/bootstrap-hope-care-integration.mjs` that
   `docker/api-entrypoint.sh` runs pre-listen.
2. **`deploy-synology.sh`** — still writes the non-secret wiring lines
   (`INTEGRATION_HOPE_CALLBACK_URL`, `HOPE_CARE_INTEGRATION_FORCE`) and **no longer writes either
   credential** into `.env`.
3. **`scripts/check-env-secrets.mjs`** (deploy step 2c) — now guards `HOPE_PARTNER_KEY` and
   `INTEGRATION_HOPE_SIGNING_SECRET` too. A host armed for Hope with either missing, weak, or
   byte-for-byte equal to a value this repository published **fails the deploy** with the
   procedure named. Findings are names and lengths; never values.

`scripts/check-no-committed-secrets.mjs` is wired into CI (`Static checks` job) against
`scripts/committed-secrets-baseline.json`, a shrink-only ratchet: a new credential anywhere in
the tree fails the build, and reducing a count has to be re-recorded so the baseline can never
sit above reality.

Authentication was not weakened anywhere in this change: HOPE still returns 503 when
`CARE_CALLBACK_SECRET` is unset and 401 on a bad signature or stale timestamp; CARE's sender
still refuses to dispatch unsigned (`delivery_not_configured`, row stays `pending`); the inbound
permission allowlist is unchanged.

## 3. Rotation procedure (owner-approved action)

The env pair is the source of truth on both hosts. Note the precedence: CARE's `integration_partners`
row for `code='HOPE'` is re-derived from `HOPE_PARTNER_KEY` on every API start, so
`POST /api/integration/admin/partners/:id/rotate-key` is **not** the way to rotate this partner —
its generated value is overwritten by the next boot. Use it for other partners only.

Nothing in this sequence can leave a callback accepted-but-unsigned: both ends fail closed on a
missing secret, so a half-configured pair refuses traffic rather than trusting it.

1. **Decide the window** (a few minutes). Outbox retries use `30s·2ⁿ` capped at 1 h with
   `max_attempts=8`, so an event queued during the window is still retrying when you finish; a
   window longer than an hour dead-letters whatever queued, and
   `POST /api/integration/admin/outbox/:id/retry` recovers those.
2. **Generate two fresh values** on the NAS, one per pair. Do not reuse anything previously
   committed, and do not put them in a shell history you later paste into a screenshot:
   `openssl rand -hex 32` for the signing secret, `intgk_$(openssl rand -hex 32)` for the partner key.
3. **CARE `.env`** (the deploy checkout on the NAS, e.g. `/volume1/docker/care-on-synology1/.env`):
   set `HOPE_PARTNER_KEY` and `INTEGRATION_HOPE_SIGNING_SECRET`. Never write either back into
   `deploy/synology/care.env`.
4. **HOPE `.env`**: set `CARE_PARTNER_KEY` to the same value as `HOPE_PARTNER_KEY`, and
   `CARE_CALLBACK_SECRET` to the same value as `INTEGRATION_HOPE_SIGNING_SECRET`.
5. **Check before restarting**, without displaying anything:
   `node scripts/integration-credential-posture.mjs --care-file .env --hope-file <hope .env>`
   → both pairs must report `pair matches: YES`, no `PUBLISHED-IN-GIT`, no `WEAK`.
6. **Restart CARE then HOPE** (`docker compose -p care-erp-github up -d` for CARE; HOPE's own
   project for HOPE). CARE's bootstrap re-hashes the partner row from the environment on start.
7. **Verify**: run the posture probe again (it reads the two `.env` files), then
   `docker exec care-api sh -c 'for v in HOPE_PARTNER_KEY INTEGRATION_HOPE_SIGNING_SECRET; do if [ -n "$(printenv $v)" ]; then echo "$v=set"; else echo "$v=unset"; fi; done'`
   for presence only, and `GET /api/integration/admin/outbox` for the delivery state. Do **not**
   `select *` from `integration_partners`: `key_prefix` is the first 14 characters of the live key.
   Inbound can be proved with a request bearing the new key that returns something other than
   `401 invalid_or_revoked_key`. Outbound HMAC acceptance cannot be proved against production
   without a real referral row — the staging stack (`d2stg-*`, its own DB with 0 patients) is the
   safe place for that, per CL-6 of `docs/CARE_ERP_PREDEPLOYMENT_GATE.md`.
8. **Record** which key sealed which artifacts if you also rotate `BACKUP_PASSPHRASE` (see §4).

### If only one side got updated

The failure is loud, not silent, and each symptom identifies itself:

| symptom | meaning |
|---|---|
| CARE answers HOPE with `401 invalid_or_revoked_key` | the two partner keys differ |
| outbox rows go `pending → http_401`, then `dead` after 8 attempts | the two signing secrets differ (HOPE rejects the HMAC) |
| outbox rows stay `pending` with `delivery_not_configured` | CARE has no secret/URL at all — nothing was ever sent |
| HOPE returns 503 `CARE callback not configured on HOPE` | HOPE has no `CARE_CALLBACK_SECRET` |

## 4. Still open, deliberately not in this change

`scripts/check-no-committed-secrets.mjs` reports **16 findings across 8 tracked files** after the
Hope pair was scrubbed. Eight of them are in `deploy/synology/care.env`:
`JWT_SECRET`, `SESSION_SECRET`, `BACKUP_PASSPHRASE`, `CRON_SECRET`, `SUPER_ADMIN_USB_KEY`,
`ICICI_SECRET_KEY`, `INTERNAL_API_KEY`, `OCR_WORKER_TOKEN` — plus one in `deploy/synology/hope.env`,
three in test fixtures, two in the financial change logs, one in `.replit` and one in a vendored
C# patch file.

They are baselined, not fixed, because each is a different owner decision with a different blast
radius, and silently bundling them into a secrets PR is how a fix becomes an outage:

- `BACKUP_PASSPHRASE` seals the hourly `/volume1/backup/care-erp/db/*.sql.enc` artifacts. The
  30-day history already spans the ~2026-10-03 rotation with nothing recording which key sealed
  which file (CL-2/CL-7 of the pre-deployment gate), so rotating it again needs a backup plan
  first, and `public.backup_verification` still has 0 rows.
- `SESSION_SECRET` / `JWT_SECRET` sign live logins: rotating them signs every staff member out.
- `ICICI_SECRET_KEY` is a payment-issuer credential — rotating it means a gateway account change.
- `INTERNAL_API_KEY` is shared with `care_erp_sync.py` on the Orthanc host (`scripts/rotate-internal-api-key.sh`).

Recommended order: rotate the Hope pair first (nothing else depends on it, and it is the one
credential whose compromise writes into another organisation's patient record), then take the
others one at a time with their own dependency checks. Until then, the ratchet guarantees no
*new* value joins the set.
