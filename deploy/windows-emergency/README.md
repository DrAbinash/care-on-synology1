# Windows Emergency CARE — packaging (mirrors 225app)

Canonical app repo: https://github.com/DrAbinash/225app

This folder holds Windows deploy helpers + an overlay of the Bill-Desk UI /
Windows sync changes so CARE operators can apply them even if the cloud agent
cannot push to `225app`.

## Admin recovery (void pending / close session) — must land in 225app

CARE PR alone cannot clear Daily Summary EMG alerts. The DS225+ app must expose:

- `POST /api/internal/void-bill` (fetch token)
- `POST /api/internal/end-session` (fetch token)

Those live in **`https://github.com/DrAbinash/225app`**, not only in this monorepo overlay.

### Apply + push to 225app (required)

```sh
git clone https://github.com/DrAbinash/225app.git
cd 225app
git checkout -b cursor/emg-admin-void-close-session
git apply /path/to/care-on-synology1/patches/225app-admin-void-close-session.patch
# or: copy deploy/windows-emergency/overlay/artifacts/emergency-billing/src/server.ts
#      over artifacts/emergency-billing/src/server.ts
git add artifacts/emergency-billing/src/server.ts
git commit -m "feat(emergency): CARE-remote void pending + end open session"
git push -u origin HEAD
# open PR on 225app, merge, then on DS225+:
#   cd /volume1/docker/care-emergency && git pull && docker compose up -d --build
```

Cloud agents for `care-on-synology1` often **cannot push to 225app** (separate private repo / token scope).
If you want agents to push there, add `DrAbinash/225app` to the Cloud Agent environment repository access.

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
