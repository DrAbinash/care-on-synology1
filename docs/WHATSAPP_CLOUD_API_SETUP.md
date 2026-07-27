# WhatsApp Cloud API — Setup Guide

CARE ERP's WhatsApp integration is the official **Meta WhatsApp Business
Cloud API**. There is exactly one supported production provider, one
webhook endpoint, and one settings page. This guide covers first-time setup;
for day-to-day config changes use the ERP itself (Admin → Integrations →
WhatsApp).

Evolution API is **not** a supported WhatsApp provider and has no code
presence in CARE ERP — any `EVOLUTION_API_URL` left over in your `.env` from
a previous setup can simply be deleted; it is no longer read anywhere.

## 1. Meta-side setup (one-time, in Meta Business Manager)

1. Go to **developers.facebook.com** → create/select an App → add the
   **WhatsApp** product.
2. Under **WhatsApp → API Setup**, note:
   - **Phone number ID**
   - **WhatsApp Business Account ID (WABA ID)**
   - Generate a **permanent access token** (System User token, not the
     24-hour test token) under Business Settings → System Users.
3. Under **App Settings → Basic**, note the **App Secret** — this is the key
   used to verify every webhook's `x-hub-signature-256` header. Treat it
   with the same care as the access token.
4. Approve at least one **message template** (Business Manager → Message
   Templates) if you plan to send template messages (bill/report/reminder
   notifications typically use one).

## 2. CARE ERP setup

Open **Admin → Integrations → WhatsApp** (`/admin/integrations/whatsapp`).
This is the single settings surface — do not configure WhatsApp anywhere
else.

1. **Provider & Credentials tab**: paste the access token, phone number ID,
   app secret, WABA ID, business display name. Click **Test config** — this
   makes a real (cheap) Graph API call to confirm the credentials work.
2. **Numbers tab** (optional): if the clinic uses more than one WhatsApp
   number (e.g. a separate number for radiology reports vs general
   messages), add each number here with its own access token and a role.
3. **Webhook tab**: set a verify token (any random string you also paste
   into Meta's webhook subscription dialog — see step 3 below).
4. **Automation tab**: leave **Shadow mode ON** and the **test allowlist**
   populated with only staff/test numbers until you've verified real sends
   work end-to-end (see §5). Set quiet hours, daily limits, and per-type
   toggles here.
5. **Consent & Safety tab**: review transactional/reminder/marketing
   toggles. STOP/START handling and PHI protection are always on and cannot
   be disabled from this page.

## 3. Meta webhook configuration

In the Meta App dashboard → WhatsApp → Configuration:

- **Callback URL**: `https://<your-domain>/api/whatsapp/webhook`
- **Verify token**: the same value entered in CARE's Webhook tab above.
- Subscribe to the **messages** field (required) — this delivers both
  inbound messages and delivery-status receipts (`sent`/`delivered`/`read`/
  `failed`).

There is exactly one webhook route in CARE: `/api/whatsapp/webhook`. It is
mounted **before** the global JSON body parser so it can verify Meta's HMAC
signature against the exact raw request bytes — do not point Meta at any
other URL, and do not add a second webhook subscription.

Meta will immediately send a GET verification request; CARE responds using
the Webhook tab's verify token. A failed verification means the token
doesn't match — re-check both sides.

## 4. Activating sends (feature flag)

All WhatsApp Cloud API sending is gated behind the `ff_whatsapp_cloud_api`
feature flag (Admin → Settings → Feature Flags), off by default on a fresh
deploy. Turn it on only after:

- Credentials test successfully (§2.1).
- The webhook shows `lastValidSignatureAt` populated (send yourself a test
  WhatsApp message to the configured number, or use Meta's webhook test
  tool).
- Shadow mode is still ON and your own number is in the test allowlist —
  use **Send test template** (Provider tab) to confirm a real message
  arrives on your phone before anyone else's.

## 5. Rolling out to real patients

1. With shadow mode ON and your number allowlisted, trigger a real
   operation that sends WhatsApp (e.g. create a test bill, or use the
   Health tab's dead-letter retry on a suppressed message) and confirm
   delivery.
2. Turn **shadow mode OFF**. From this point every send goes to Meta for
   real — there is no test-vs-production code path, only configuration.
3. Watch the **Health tab** (queued/processing/dead-letter counts, last
   sent/delivered/read) for the first hour of real traffic.

## 6. n8n integration

n8n's role is strictly: run schedules, call CARE's authenticated internal
API, escalate failures. n8n never touches CARE's Postgres, never stores
WhatsApp credentials, never renders patient message text, and never talks to
Meta directly.

- **Base URL**: `https://<your-domain>/api/internal/automations/whatsapp`
- **Auth**: `Authorization: Bearer $WHATSAPP_AUTOMATION_SECRET` (a dedicated
  secret, separate from `CRON_SECRET` — set it in `.env` / Container
  Manager, generate with `openssl rand -base64 32`).
- **Endpoints** (all `POST` except health):
  | Endpoint | Purpose |
  |---|---|
  | `GET /health` | Outbox queue depth, feature-flag state — poll this before deciding whether to fire the others. |
  | `POST /dispatch-outbox` | Drains queued/retry-scheduled messages toward Meta. **Call this on a short interval (every 1-5 min)** — without it, retries and quiet-hours-deferred messages never actually go out. |
  | `POST /dispatch-due-appointment-reminders` | Triggers tomorrow's appointment reminders (idempotent per appointment+date). |
  | `POST /dispatch-payment-reminders` | Triggers outstanding-dues reminders (idempotent per patient+date). |
  | `POST /dispatch-report-ready-notifications` | Triggers report-ready re-notifications for undelivered reports (idempotent, max 1 reminder). |

  Every endpoint triggers fixed, existing CARE business logic — none accept
  arbitrary message text or a recipient list from n8n.

- **Example n8n workflow**: a Schedule Trigger (every 5 minutes) → HTTP
  Request node (`POST .../dispatch-outbox`, Bearer auth) is the minimum
  viable setup to make the outbox actually deliver. Add separate daily
  Schedule Triggers for the three `dispatch-*-reminders` endpoints at
  whatever times suit the clinic (these duplicate — and are meant to
  eventually replace — the older `CRON_SECRET`-gated
  `/api/internal/cron/whatsapp-*` endpoints some deployments may already
  have wired up; don't run both against the same trigger to avoid double
  work, though both paths are independently idempotent so occasional
  overlap is harmless).

## 7. Synology / Container Manager notes

- Set `WHATSAPP_AUTOMATION_SECRET` (and, if not using the DB-backed settings
  page, the legacy `WHATSAPP_*` fallback vars) in the `care-api` container's
  environment, then restart the container — env vars are read at process
  start.
- The webhook endpoint (`/api/whatsapp/webhook`) must be reachable from the
  public internet over HTTPS for Meta to deliver webhooks — confirm your
  reverse-proxy / Cloudflare route forwards `/api/whatsapp/*` to the
  `care-api` container the same way `/api/gateway-webhooks` already does.
- No new container or database is required — WhatsApp state lives in the
  existing `care-db` Postgres instance (`wa_outbox`, `wa_delivery_attempts`,
  `whatsapp_settings`, `whatsapp_numbers` tables), migrated automatically by
  the existing `care-db-patch-v2` migration runner.

## 8. Troubleshooting

See `CARE_ERP_TROUBLESHOOTING.md` §15 ("WhatsApp unavailable") and the
Health tab's dead-letter queue for per-message error detail. Rejected
webhook signatures are counted on the Webhook tab — a nonzero, growing count
usually means the App Secret configured in CARE doesn't match Meta's, or a
second Meta App is (incorrectly) pointed at the same URL with a different
secret.
