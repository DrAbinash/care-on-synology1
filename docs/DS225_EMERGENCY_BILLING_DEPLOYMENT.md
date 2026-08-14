# DS225+ Emergency Billing — Deployment (CARE side)

The capture application is **not** in this monorepo.

Clone and deploy:

```text
https://github.com/DrAbinash/225app
```

to `/volume1/docker/care-emergency/` on DS225+. See that repository's `README.md`, `docker-compose.yml`, `.env.example`, and `docs/`.

Do **not** clone this CARE monorepo onto DS225+ merely to run emergency billing.

## CARE (DS1522+)

1. Apply emergency billing schema (`pnpm db:push` or the emergency billing SQL under `migrations/`).
2. Redeploy CARE API/web.
3. Admin: Settings → Billing → Emergency Billing — store DS225+ URL + fetch token.
4. Click **Push Initial Master Data** (or **Push Master Data Now**) before the first emergency session.

Scheduled fallback: `EMERGENCY_MASTER_SYNC_INTERVAL_HOURS` (default 6), only on the process with `ENABLE_SCHEDULERS=1`.
