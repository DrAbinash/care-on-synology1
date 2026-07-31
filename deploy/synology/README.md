# Synology deploy — Hope Hospital + Care Diagnostics

Both systems run on **NAS `192.168.1.137`**. Copy the matching env once, then
`docker compose up` — migrations **and** Hope↔Care partner wiring run
automatically on Care API start (no manual bootstrap).

| System | LAN URL | Env file |
|--------|---------|----------|
| **Hope ERP** | http://192.168.1.137:7080/ | `deploy/synology/hope.env` → Hope repo `.env` |
| **Care ERP** | http://192.168.1.137:8888/ (public: https://caredeoghar.com) | `deploy/synology/care.env` → Care repo `.env` |

Partner key + callback signing secret are already matched across both files.

## 1. Hope Hospital

```bash
cd /volume1/docker/hope-erp   # your Hope project folder
cp deploy/synology/hope.env .env
docker compose up -d --build
```

Login: `abinashsingh` / PIN from `INITIAL_ADMIN_PIN` (or boot log).

## 2. Care Diagnostics

```bash
cd /volume1/docker/care-on-synology1
cp deploy/synology/care.env .env   # skip if .env already exists
# or: bash deploy-synology.sh      # pulls, ensures .env, builds, starts
docker compose up -d --build
```

On every Care API start:

1. `care-db-patch-v2` applies migrations (as before)
2. `docker/api-entrypoint.sh` + API startup bootstrap register the **HOPE**
   partner and enable `ff_hope_care_referrals`

No `docker compose exec … bootstrap-hope-care-integration.mjs` step.

## 3. Test catalogue (both systems)

The CSV does **not** auto-sync. Import in **both** once:

- **Hope:** Clinical Masters → CARE Catalogue → Upload CSV
- **Care:** Tests → import the same `test-catalog-*.csv`

## 4. Medicines (Hope Medicals only)

Pharmacy stock lives under entity **Hope Medicals** (teal sidebar). It does not
appear in Care ERP or hospital Materials — that is correct.

## 5. Smoke test

1. Doctor saves OPD prescription with lab test (e.g. CBC).
2. Care ERP → **HOPE Referrals** inbox shows the referral.
3. After report finalisation in Care, result appears in Hope patient record.

If referrals fail from inside Docker networking, set Hope
`CARE_REFERRAL_URL=https://caredeoghar.com/api/integration/v1` and redeploy Hope.
