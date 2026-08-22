# Emergency Billing deployment

The Emergency Billing application lives in a dedicated repository:

  https://github.com/DrAbinash/225app

## Targets

| Host | Guide |
| --- | --- |
| Synology DS225+ | Clone to `/volume1/docker/care-emergency/` — see 225app README |
| Windows Emergency PC | Docker Desktop — see `docs/WINDOWS_EMERGENCY_DEPLOY.md` in 225app |

Do not clone this CARE monorepo onto the emergency host.

Main CARE keeps integration only: master-data push, `/api/emergency-bridge` pull/push, CSV/JSON import, reconciliation UI.
