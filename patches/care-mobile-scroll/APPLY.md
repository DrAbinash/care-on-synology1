# CARE mobile scroll / dialog fixes

Apply on a clone of `DrAbinash/care-on-synology1` (this agent cannot push there):

```bash
cd care-on-synology1
git checkout main && git pull
git checkout -b cursor/mobile-scroll-fix-080e
git am /path/to/patches/care-mobile-scroll/0001-*.patch
git am /path/to/patches/care-mobile-scroll/0002-*.patch
git push -u origin cursor/mobile-scroll-fix-080e
```

Then rebuild/redeploy the diagnostic-erp frontend.

## What this fixes

1. **Day Close (All Staff)** — right columns (Counted Cash, Actions) reachable via horizontal swipe
2. **Billing Desk** — scroll down to Payment on mobile
3. **Add Doctor / Edit Doctor** — dialog scrolls so Save is visible
4. Same table/dialog patterns on Staff, Accounting, Bill Detail, Patient Detail, Order Detail

## Root cause

`ModuleErrorBoundary` wrapped every page in `overflow-x-hidden`, which **clipped** wide tables so page-level and nested horizontal scroll could not move left/right. Dialogs had no `max-height`/`overflow-y`, so tall forms (Add Doctor) cut off the Save button on phones.
