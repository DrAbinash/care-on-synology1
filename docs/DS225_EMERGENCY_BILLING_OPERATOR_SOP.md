# Emergency Billing — Staff SOP (print this page)

**CARE not working? Do not invent a workaround. Follow this page.**

## 1. Switch network

1. Connect the PC to Wi‑Fi **CARE-EMERGENCY** (or the emergency LAN cable).
2. Open the bookmark **Emergency Billing** (`http://192.168.50.10` or the address on the sticker).

You do **not** need DSM, SSH, Docker, or the internet.

## 2. Login

Use your normal CARE username + PIN.

If the red banner says **EMERGENCY BILLING LOCKED**, stop. Only the owner/admin can start a session.

## 3. Bill (only when the banner is green)

1. Search the patient (name / mobile / UHID). If missing, type name, age, sex, mobile.
2. Search the test/service. Price comes from the last synced tariff — do not edit it.
3. Choose referring doctor if known.
4. Discount only if you are allowed; a reason is mandatory.
5. Enter cash / UPI / card received. Due is calculated. Partial payment is OK.
6. **Save & print receipt**. Give the paper to the patient.

The number looks like `EMG-20260814-00001`. That is an **emergency** receipt. The final CARE bill is created later.

## 4. Mistakes

- **Never delete** a bill.
- To cancel: **Void**, type a real reason. The original bill stays in history.
- Reprint: **Print** on that row (this is logged).

## 5. When CARE is back

1. Stop taking new emergency bills.
2. Tell the owner. They end the session and import into CARE.
3. Switch the PC back to the normal clinic Wi‑Fi / LAN.
4. Use CARE as usual. Do **not** re-enter the same bills by hand.

## Banner you must notice

**Tariff/master data last synchronized:** &lt;date time&gt;

If that date is old, prices may be stale. Still bill — do not guess new prices.
