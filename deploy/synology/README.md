# Synology deploy — Hope Hospital + Care Diagnostics

Both systems run on **NAS `192.168.1.137`**.

| System | LAN URL | Copy env to |
|--------|---------|-------------|
| **Hope ERP** | http://192.168.1.137:7080/ | Hope repo root → `.env` |
| **Care ERP** | http://192.168.1.137:8888/ (public: https://caredeoghar.com) | `care-on-synology1/` → `.env` |

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
cp deploy/synology/care.env .env
docker compose up -d --build
```

## 3. Wire Hope ↔ Care (one time)

After both databases are up:

```bash
cd /volume1/docker/care-on-synology1
docker compose exec api node scripts/bootstrap-hope-care-integration.mjs
```

This enables the `ff_hope_care_referrals` flag and registers the **HOPE** partner key
(already present in both `.env` files).

## 4. Test catalogue (both systems)

The CSV does **not** auto-sync. Import in **both**:

- **Hope:** Clinical Masters → CARE Catalogue → Upload CSV
- **Care:** Tests → import the same `test-catalog-*.csv`

## 5. Medicines (Hope Medicals only)

Pharmacy stock lives under entity **Hope Medicals** (teal sidebar). It does not
appear in Care ERP or hospital Materials — that is correct.

## 6. Smoke test

1. Doctor saves OPD prescription with lab test (e.g. CBC).
2. Care ERP → **HOPE Referrals** inbox shows the referral.
3. After report finalisation in Care, result appears in Hope patient record.

If referrals fail, try changing Hope `CARE_REFERRAL_URL` to
`https://caredeoghar.com/api/integration/v1`.
