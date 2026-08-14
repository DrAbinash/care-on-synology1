# Emergency Billing — Owner recovery SOP (print this page)

**Goal:** get every emergency bill into CARE once, with no duplicates, then stop.

## A. While CARE is healthy (do this now, not during an outage)

1. Confirm DS225+ Emergency Billing is running (`http://<DS225-IP>/`).
2. CARE → **Settings → Billing → Emergency Billing**.
3. Save DS225+ URL and fetch token.
4. Click **Push master data to DS225+** (after tariff or staff changes, and at least weekly).
5. **Super admin login only:** click **Download USB seed**. Unzip onto the pendrive `data/seed/` folder (`tests.csv`, `doctors.csv`, master JSON). This zip is **not** a bill import. Regular admin logins cannot download it.

## B. When CARE / main LAN is down

1. Reception switches to **CARE-EMERGENCY**.
2. You log in to Emergency Billing.
3. Click **START EMERGENCY SESSION**. Type why (power, NAS, network…).
4. Reception bills as usual. You do **not** use SSH or Docker.
5. When CARE is back: **END EMERGENCY SESSION**.

## C. Reconcile into CARE (no developer)

1. On a PC on the **normal** clinic network, open CARE.
2. **Settings → Billing → Emergency Billing**.
3. Click **Fetch from Emergency NAS**.
4. Read the preview (bills, cash/UPI/card, due, exact/new/review/conflicts).
5. Click **Import safe transactions**.
6. Check: created vs already imported vs failures. One bad row must not block the rest.
7. Review PROBABLE / CONFLICT rows before importing them (never merge uncertain patients).
8. Spot-check a bill in CARE: patient, tests, paid, **due unchanged**, EMG number in history.

### If Fetch fails (NAS-to-NAS down)

On DS225+ (still on emergency LAN if needed): login as owner → **Export CSV** and **Export JSON**.

Copy the files (USB is fine). On CARE: **Upload CSV** and/or **Upload JSON** → Preview → Import safe.

JSON is the highest-fidelity copy. CSV is `CARE_EMERGENCY_BILLING_V1`.

### If you upload the same file twice

Expected: **0 new bills**. Counts show already imported / duplicates. That is success.

## D. What you must not do

- Do not type emergency bills into CARE by hand if they already have an `EMG-*` number.
- Do not calculate commission or accounting on DS225+.
- Do not delete emergency rows after import (they become RECONCILED history).
- Do not restore or overwrite Hyper Backup data to “fix” billing.
