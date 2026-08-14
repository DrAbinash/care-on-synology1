# DS225+ Emergency Billing — Disaster drill

Run this drill **before** a real outage. Do not use production Hyper Backup volumes.

## Setup

1. CARE (DS1522+ or lab) is healthy. Push master data to Emergency Billing.
2. Two browsers (or two PCs) as “Reception 1” and “Reception 2”.
3. Note current CARE bill count / last bill number.

## Drill

### 1. Simulate DS1522+ unavailable

Stop CARE API **or** disconnect the main LAN. Leave DS225+ Emergency stack up. Internet off is OK.

### 2. Emergency LAN only

Point both reception browsers at `http://<DS225-IP>/`. No SSH.

### 3. Owner starts session

Admin: **START EMERGENCY SESSION** reason `DRILL`. Reception must have been locked before this.

### 4. Five (or more) bills from two PCs

Create at least:

| # | Patient | Pay | Notes |
| --- | --- | --- | --- |
| 1 | Existing cached patient | Cash full | |
| 2 | New patient | UPI full | |
| 3 | Same name as #1, different mobile | Card | PROBABLE/NEW later |
| 4 | MRI (or any test) net ₹4000, received ₹3000 | Cash partial | Due ₹1000 must survive import |
| 5 | Discount within staff cap | Mixed cash+UPI | |
| 6 | Fully due (received 0) | | |
| 7 | Then **Void** one extra bill with a reason | | must not import |

Optionally create ~100 bills (script or repeated save) to test numbering and two-PC concurrency.

### 5. Reboot tests

- Restart `care-emergency-api` (or the NAS container) mid-session. Session still active; bills still there.
- Close/reopen the browser; login again; continue billing.

### 6. Restore CARE

Bring DS1522+ / main LAN back. **END EMERGENCY SESSION**.

### 7. Fetch → Preview → Import

CARE Settings → Emergency Billing → Fetch from Emergency NAS → Import safe.

Verify in CARE for a sample:

- Patient not silently merged
- Tests present
- Paid and **due** match the emergency receipt
- Accounting voucher exists for the payment (existing pipeline)
- Referring doctor present so commission engine can see the order (no second engine)

### 8. Idempotency

Upload the **same CSV** (export from DS225+). Expected: **0 created**, already imported = all, **0 duplicate bills**.

Fetch again after import: pending should drop as rows become RECONCILED on DS225+ (if NAS callback succeeded). Records are **not** deleted.

### 9. Cross-channel duplicate

Take a UUID already imported via NAS API and include it in a CSV upload. Expected: already reconciled, no second CARE bill.

### 10. Interrupted / concurrent import

Start import, stop CARE API mid-way, restart, import again. Unique UUID means no doubles. Two overlapping Import clicks: one creates, the other sees unique violation → already imported.

### 11. Tariff change after the emergency bill

Change a test price on CARE **after** the emergency receipt was printed. Import must keep the **emergency captured** price, not the new tariff.

## Pass criteria

```text
NO DUPLICATE BILLS
NO LOST TRANSACTIONS
NO SILENT PATIENT MERGES
NO DOUBLE PAYMENTS
NO DOUBLE COMMISSIONS
```

Voided drills never become CARE revenue. Partial dues stay dues.
