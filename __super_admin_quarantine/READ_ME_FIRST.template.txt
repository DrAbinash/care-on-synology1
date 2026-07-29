SUPER ADMIN PEN DRIVE — SETUP FOR DR. ABINASH
=============================================

WHAT YOU HAVE (4 files):
  superadmin.key      <- YOUR SECRET CODE (64 characters). Keep private!
  superadmin.pin      <- Your auto-login PIN (8 characters). Optional.
  superadmin-api.js   <- The Super Admin backend plugin (rebuilt today).
  superadmin-ui.js    <- The Super Admin screens (rebuilt today).

STEP 1 — COPY TO PEN DRIVE (Windows, 1 minute)
  1. Plug in an empty pen drive (or reuse the existing Super Admin drive).
  2. Copy these 4 files onto the pen drive at the TOP level (not inside a folder).
     Replace any older superadmin-api.js / superadmin-ui.js already on the drive.
  3. Keep your existing superadmin.key / superadmin.pin — do not change them unless
     you are rotating the secret.
  That's it for the drive.

STEP 2 — SERVER SECRET (already done if the old drive worked)
  The Synology care-api container must have:
        SUPER_ADMIN_USB_KEY  = (contents of superadmin.key)
        SUPER_ADMIN_USB_PIN  = (contents of superadmin.pin — optional)
  Restart care-api only if you change those values.

STEP 3 — PAIR YOUR BILLING PC (one time, if not already paired)
  1. Plug the pen drive into the billing PC.
  2. In the ERP, press  Ctrl + Alt + U
  3. Click "Pick pen-drive folder", choose the pen drive, allow access.

DAILY USE
  Plug in drive -> amber "Super Admin" link appears in the sidebar.
  Pull the drive out -> link disappears within ~4 seconds. No trace.

IF THE DRIVE IS EVER LOST
  Anyone who finds it CANNOT use it (the server also checks the secret,
  and the portal needs the PIN). Still, rotate immediately:
  ask me to "rotate the super admin key" — new key file + you update the
  Synology environment value. Old drive becomes useless instantly.

DO NOT
  - email these files or paste the code into chats/WhatsApp
  - put them in Google Drive
  - commit them to GitHub (they are deliberately NOT in the repository)

------------------------------------------------------------------
WHAT'S NEW IN THIS BUILD
------------------------------------------------------------------
Two USB files rebuilt (superadmin-api.js + superadmin-ui.js). Keep your
existing superadmin.key / .pin.

NEW in this build — billed-only commission + Referral Register extras:

  Referral Report, Rate Analysis, detailed/consolidated commission reports,
  and Doctor Ledger earned totals now use BILLED, NON-CANCELLED orders only.

  - Unbilled duplicate orders no longer generate commission rows
    (they previously appeared as On Hold — "Not billed" and inflated
    visits / revenue / total commission).
  - Cancelled tests still drop out entirely.
  - Cancelled bills still never generate payable commission.
  - Payment eligibility holds (Full Payment Collected, etc.) continue to
    apply only to orders that already have a live bill.

  Referral Register (Excel-style) — Home → Referral Register:
  - Columns: DATE | PATIENT'S NAME | TEST NAME | AMOUNT | REF. BY DOCTOR
  - Filters: date range, referring doctor, test pick-list / name search,
    patient/bill search, category/modality (USG · MRI · CT · X-Ray · Other)
  - Month presets: This month · Last month · Custom dates
  - Views: Flat list · Doctor-wise · Compare months (last vs this)
  - Export: Excel · CSV · Print
  - WhatsApp / Email: send a doctor their register (preview → confirm).
    Amounts are billed test revenue, not commission.

Also still included from earlier builds:
  - Expected / Discount / Actual commission breakdown
  - Commission Eligibility (payout hold) + On Hold reasons
  - Doctor Ledger nets the same discount as the Referral Report
  - Eligible-only payout quick-fill
  - Per-doctor Commission Statement PDF
  - Clawback / "Reversed after eligibility" panel
  - "Why this amount?" drill-down on Referral Report

** SERVER UPDATE REQUIRED FOR FULL EFFECT **
  The USB plugin carries the Super Admin report/ledger routes.
  The main care-api server must ALSO be on a build that includes:
    - commissionCalc billed-only helpers
    - reconcile cron that skips unbilled orders
  Deploy care-api from the branch that merged
  "Exclude unbilled orders from referral commission reports"
  (cursor/fix-commission-billed-only-cb41 / PR #324), then copy these
  two rebuilt USB files onto the pen drive.

------------------------------------------------------------------
