# Synology deploy — Hope Hospital + Care Diagnostics

Both systems run on **NAS `172.16.1.139`**. Use **Container Manager** (no SSH /
`docker compose` required). Migrations **and** Hope↔Care partner wiring run
automatically on Care API start.

| System | LAN URL | Project folder (typical) | Env template |
|--------|---------|--------------------------|--------------|
| **Hope ERP** | http://172.16.1.139:7080/ | `/volume1/docker/hope-erp` | `deploy/synology/hope.env` |
| **Care ERP** | http://172.16.1.139:8888/ (https://caredeoghar.com) | `/volume1/docker/care-on-synology1` | `deploy/synology/care.env` |

Partner key + callback signing secret are already matched across both templates.

---

## Container Manager (recommended)

### A. One-time: put `.env` next to `docker-compose.yml`

Container Manager reads a file named **`.env`** in the project root for
`${VAR}` substitution. Do this once per project (or after you wipe the folder).

1. Open **File Station**
2. Go to the project folder (e.g. `docker/care-on-synology1` or `docker/hope-erp`)
3. Open `deploy/synology/`
4. Copy `care.env` (Care) or `hope.env` (Hope)
5. Paste into the project root and **rename** the copy to `.env`  
   (File Station → right‑click → Rename)

If `.env` already exists and referrals work, leave it. To set the Hope keys,
open `.env` in Text Editor and put these lines in it — **the templates ship the
two keys empty on purpose, so the values are yours to generate**:

```sh
openssl rand -hex 32                 # → INTEGRATION_HOPE_SIGNING_SECRET (Care) = CARE_CALLBACK_SECRET (Hope)
echo "intgk_$(openssl rand -hex 32)" # → HOPE_PARTNER_KEY (Care) = CARE_PARTNER_KEY (Hope)
```

Both sides of each pair must hold the same value, and neither value is ever
committed back into `deploy/synology/*.env`. The coordinated procedure, including
what to do if only one side has been updated, is
`docs/hope-care-integration/06_CREDENTIAL_ROTATION.md` in the Care repository.

**Care `.env` must include:**
```
INTEGRATION_HOPE_CALLBACK_URL=http://172.16.1.139:7080/api/integration/care-callback
INTEGRATION_HOPE_SIGNING_SECRET=
HOPE_CARE_INTEGRATION_FORCE=1
HOPE_PARTNER_KEY=
```

**Hope `.env` must include:**
```
ENABLE_CARE_INTEGRATION=1
CARE_REFERRAL_URL=http://172.16.1.139:8888/api/integration/v1
CARE_PARTNER_KEY=
CARE_CALLBACK_SECRET=
CARE_BOOKING_URL=https://caredeoghar.com/book
NOTIFY_PROVIDER=care
```

### B. Update code + rebuild in Container Manager

Do **Care first**, then **Hope** (or the reverse — order does not matter for
bootstrap; Care registers the partner whenever its API starts with the env above).

1. **Container Manager → Project**
2. Select the project (`care-on-synology1` / `hope-erp` — whatever you named it)
3. Pull latest **`main`** into that folder (preferred: SSH `bash deploy-synology.sh`, which
   hard-resets to `origin/main`; or Git Server / File Station sync so
   `docker-compose.yml` and source match `main`)
4. Click **Build** (or **Action → Build** / **Recreate**)  
   - Prefer **Build** so images rebuild from the new code  
   - Leave “clean build” / recreate volumes **off** unless you intend to wipe DB
5. Wait until all services are **Running** (Care: `care-db-patch-v2` and
   `care-schema-verify` exit successfully, then `care-api` / `care-web` healthy)

On every Care API start (after this PR is deployed):

1. `care-db-patch-v2` applies migrations
2. API entrypoint + startup bootstrap register the **HOPE** partner and enable
   `ff_hope_care_referrals`

No Container Manager “Exec” / terminal bootstrap step.

### C. Optional: set env in the UI instead of `.env`

If you prefer not to use a `.env` file:

1. Project → **Edit** → environment / variable section (depends on DSM version)
2. Paste the Care or Hope key block from section A
3. **Build** / recreate the project

Using a root `.env` file is simpler and matches `docker-compose.yml` `${VAR}` usage.

---

## CLI alternative (SSH — optional)

```bash
# Care
cd /volume1/docker/care-on-synology1
cp deploy/synology/care.env .env
docker compose up -d --build

# Hope
cd /volume1/docker/hope-erp
cp deploy/synology/hope.env .env
docker compose up -d --build
```

---

## Test catalogue (both systems, once)

The CSV does **not** auto-sync. Import in **both**:

- **Hope:** Clinical Masters → CARE Catalogue → Upload CSV
- **Care:** Tests → import the same `test-catalog-*.csv`

## Medicines

Pharmacy stock is **Hope Medicals** only — not Care ERP. That is correct.

## Smoke test

1. Hope doctor saves OPD with a lab test (e.g. CBC)
2. Care → **HOPE Referrals** shows the referral
3. After Care finalises the report, the result appears in Hope

If Hope cannot reach Care on LAN from inside Docker, set Hope
`CARE_REFERRAL_URL=https://caredeoghar.com/api/integration/v1`, save `.env`,
then **Build** the Hope project again.
