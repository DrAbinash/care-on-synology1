# Windows Emergency CARE — packaging (mirrors 225app)

Canonical app repo: https://github.com/DrAbinash/225app

This folder holds Windows deploy helpers + an overlay of the Bill-Desk UI /
Windows sync changes so CARE operators can apply them even if the cloud agent
cannot push to `225app`.

## Preferred: merge into 225app

1. Apply `/workspace/patches/225app-windows-emergency-care.patch` on a clone of 225app:
   ```sh
   cd 225app
   git apply ../care-on-synology1/patches/225app-windows-emergency-care.patch
   ```
   Or copy files from `overlay/` over a fresh 225app clone.
2. Follow `WINDOWS_EMERGENCY_DEPLOY.md`.

## CARE monorepo companion

Main CARE must include `/api/emergency-bridge` (this PR) so the Windows PC can
**Sync From Main CARE** and **Push Emergency Data**.
