# Windows Emergency CARE (pointer)

The Windows Emergency CARE Server is built on the existing DS225+ emergency
architecture in **`https://github.com/DrAbinash/225app`** — not a separate ERP.

## CARE-side additions in this monorepo

| Piece | Path |
| --- | --- |
| Token bridge (master pull + JSON import) | `artifacts/api-server/src/routes/emergencyBridge.ts` mounted at `/api/emergency-bridge` |
| Existing reconciliation UI | Settings → Billing → Emergency Billing |
| Shared contracts | `lib/emergency-billing` |

## Emergency host (225app)

See that repo’s `docs/WINDOWS_EMERGENCY_DEPLOY.md` for Docker Desktop one-command
start / backup / restore. Bill Desk UI matches CARE ERP visually with an
**EMERGENCY MODE** banner.

Do not deploy this CARE monorepo onto the Windows emergency PC.
