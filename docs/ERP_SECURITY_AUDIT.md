# ERP_SECURITY_AUDIT.md
**Care Diagnostics ERP — Comprehensive Security Audit**
*Audited: 2026-06-24 | Commit: checkpoint before security audit*
*Scope: 113 API routes, 5 middleware files, authentication, authorization, payments, uploads, PACS, DICOM, internal APIs*

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 3 | Requires immediate fix |
| 🟠 High | 6 | Fix before next deployment |
| 🟡 Medium | 9 | Fix in current sprint |
| 🔵 Low | 7 | Fix in next sprint |

**Overall posture:** Good. Authentication architecture is solid — layered Bearer-token + role + permission system is well-designed. Primary risks are in public endpoint over-exposure, missing permission scoping on sensitive radiology/PACS writes, and a credential leak in the public booking config endpoint.

---

## Authentication Architecture

### Session System

| Layer | Token | Validated Against | Expiry |
|-------|-------|-------------------|--------|
| Staff ERP | `Authorization: Bearer <token>` | `portal_sessions` (scope=staff) | `expiresAt` + idle timeout |
| Super Admin | `X-SA-Token: <token>` | `super_admin_sessions` | `expiresAt` |
| Super Admin USB | `X-SA-USB-Key: <key>` | `SUPER_ADMIN_USB_KEY` env var | Physical key present |
| Internal API | `Authorization: Bearer <key>` | `INTERNAL_API_KEY` env var | Static secret |
| Cron | `Authorization: Bearer <key>` | `CRON_SECRET` env var | Static secret |
| Scan Session | `sessionToken` in URL | `scan_sessions.session_token` | 5 minutes |
| Portal Patient | `Authorization: Bearer <token>` | `portal_sessions` (scope=patient) | Separate scope |
| Teleradiology | `shareToken` in URL | `teleradiology_shares` | Configurable TTL |

**Strengths:**
- Each session validates `isActive=true` on the user record — deactivated accounts are immediately blocked
- Idle timeout enforcement on every authenticated request (`sessionIdleTimeoutMinutes`)
- FIDO2/WebAuthn available as second factor
- USB hardware gate for super-admin routes with `remoteLoginEnabled` escape hatch for owner
- All tokens are cryptographically random bytes (not sequential IDs)

---

## 🔴 CRITICAL FINDINGS

### CRIT-001: Public Booking Config Leaks Merchant IDs to Internet

**Route:** `GET /api/public/booking/config` (`public-booking.ts` L100–218)
**Severity:** 🔴 Critical
**Impact:** Any internet user can retrieve all payment merchant IDs (ICICI, PayU, PhonePe, BharatPe, Razorpay key IDs) without authentication.

**Finding:**
```typescript
// PROBLEM: Returns merchant IDs publicly with no auth
res.json({
  iciciMerchantId: settings.iciciEnabled ? iciciMerchantId : "",
  bharatpeMerchantId: settings.bharatpeEnabled ? bharatpeMerchantId : "",
  phonepeMerchantId: settings.phonepeEnabled ? phonepeMerchantId : "",
  payuMerchantKey: payuKey,   // ← MERCHANT KEY exposed (not just ID)
  keyId: razorpayKeyId,        // ← Razorpay public key OK, but...
})
```
`payuMerchantKey` is the **merchant's own key** — not a public key. This is a credential.

**Fix:**
- Remove `payuMerchantKey` from the public response entirely
- Return only the active gateway name and public keys/IDs
- PayU initiation should happen server-side; `merchantKey` never goes to browser

---

### CRIT-002: Scan Session Upload — No Rate Limiting, No Size Cap, Token Brute-Forceable

**Route:** `POST /api/scan-sessions/upload/:token` (`scan-sessions.ts` L167)
**Severity:** 🔴 Critical
**Impact:** No rate limiting. Accepts arbitrary base64 payloads (no size validation). 32-char hex token (128-bit, strong), but no failed-attempt counter means unlimited probing attempts.

**Finding:**
```typescript
// No rate limiter applied
scanSessionsRouter.post("/upload/:token", async (req: any, res: any) => {
  // Accepts any base64 string payload — no max size check
  if (frontImage) {
    frontImageUrl = saveUpload(frontImage, folderId, "front");
  }
```
The `saveUpload()` function writes directly to disk with no file size check at the handler level. A malicious caller sending a multi-GB base64 string could OOM or fill disk.

**Fix:**
- Add rate limiter: `rateLimit({ windowMs: 60_000, max: 20 })`
- Validate base64 string length before decoding: `if (frontImage.length > 10_000_000) return 413`
- Add failed token probe counter or short-circuit with 404 on expired sessions

---

### CRIT-003: Internal Radiology Endpoints Open in Development Without Key

**Route:** `GET|POST /api/internal/*` (`internal-radiology.ts` L44–68)
**Severity:** 🔴 Critical (development/staging only; production is safe)
**Impact:** If `INTERNAL_API_KEY` is not set in a non-production environment, ALL internal radiology endpoints are unprotected and accessible without authentication.

**Finding:**
```typescript
if (!expected) {
  if (process.env["NODE_ENV"] === "production") {
    // GOOD: returns 503
  }
  // DEV/STAGING: ALLOWS WITHOUT KEY — logs a warning only
  logger.warn("INTERNAL_API_KEY not set — internal radiology endpoints are unprotected");
  next();
  return;
}
```
These endpoints can create patients, update study statuses, trigger AI drafts — all with no auth in dev/staging.

**Fix:**
- Change behaviour: always require key unless `NODE_ENV === 'test'`
- Or generate a random key on startup and log it: `INTERNAL_API_KEY auto-generated for this session: <key>`
- Document that `.env.example` must include `INTERNAL_API_KEY`

---

## 🟠 HIGH FINDINGS

### HIGH-001: PACS Enterprise Mutations — No Admin Guard on Sensitive Operations

**Routes:** `pacsEnterprise.ts` — mounted at `/api/radiology` behind `requireStaffAuth` only (no permission check)
**Severity:** 🟠 High
**Impact:** Any authenticated staff member (even a receptionist with only `/billing` permission) can:
- `POST /api/radiology/routing-rules` — create/modify DICOM routing rules
- `DELETE /api/radiology/routing-rules/:id` — delete routing rules
- `POST /api/radiology/failed-queue/:id/retry` — retry DICOM pull jobs
- `DELETE /api/radiology/failed-queue/:id` — abandon DICOM jobs
- `POST /api/radiology/pacs-settings/load-defaults` — overwrite PACS viewer settings

**Finding (index.ts L384):**
```typescript
// Only requireStaffAuth — NO /dicom-nodes or /settings permission check
router.use("/radiology", requireStaffAuth, pacsEnterpriseRouter);
```

**Fix:**
- Wrap mutating routes inside `pacsEnterpriseRouter` with `requireStaffSubPermission("/settings", "infrastructure")` or `/dicom-nodes`
- Read-only GET endpoints (`/pulled-studies`, `/mwl-procedures`) can remain open to all staff

---

### HIGH-002: Scan Sessions Pair Endpoint — No Auth Enforced for Phone Device Pairing

**Route:** `POST /api/scan-sessions/pair` (`scan-sessions.ts` L246)
**Severity:** 🟠 High
**Impact:** Anyone with any valid (non-expired) scan token can pair a phone to any staff member's account and receive future scan session tokens.

**Finding:**
```typescript
// No requireStaffAuth — accepts sessionToken as standalone auth
scanSessionsRouter.post("/pair", async (req: any, res: any) => {
  if (!staffId && sessionToken) {
    const sessions = await db.select()...where(sessionToken)
    staffId = sessions[0].staffId; // ← Inherits ANY staff's ID from token
  }
```
A scan token issued for user A can be used to permanently pair a third-party device to user A's account.

**Fix:**
- Only allow pairing from authenticated staff sessions, not scan tokens
- Separate the concern: pairing should require `requireStaffAuth`, uploading can use token-only

---

### HIGH-003: `GET /api/clinic-settings` Returns Full Settings Row Including Payment Credentials

**Route:** `GET /api/clinic-settings` (`clinicSettings.ts` L231–234)
**Severity:** 🟠 High
**Impact:** Any authenticated staff member (any role) can read the full `clinic_settings` row, which includes:
- `razorpayKeyId`, `payuMerchantKey`, `iciciMerchantId`, `iciciAggregatorId`, `iciciSecretKey` (hash)
- `phonepeMerchantId`, `bharatpeMerchantId`, `cashfreeAppId`
- `ollamaBaseUrl`, `ollamaFallbackUrl`

**Finding (clinicSettings.ts L231–234):**
```typescript
clinicSettingsRouter.get("/", async (_req, res) => {
  const row = await getOrCreate();
  res.json(row); // ← Returns ENTIRE row, including payment credentials
});
```

**Fix:**
- Redact secrets from the default GET: return `iciciSecretKey: "••••••••"` if set
- Or restrict `GET /clinic-settings/` to `/settings` permission
- Payment secret fields should only be returned to `/settings:payment` role

---

### HIGH-004: HL7 Route — Permission Check Done Manually, Not via Middleware

**Route:** `hl7Router` — mounted at `/api/radiology/hl7` (inside `radiologyRouter`)
**Severity:** 🟠 High
**Impact:** Manual staffSession check at each route handler rather than using the established middleware. This pattern is inconsistent and creates risk of copy-paste mistakes where `staffSession` check is omitted.

**Finding (hl7.ts L16–18):**
```typescript
hl7Router.get("/settings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }
```
No permission guard — any staff member can view and modify HL7 integration settings.

**Fix:**
- Use `requireStaffSubPermission("/settings", "infrastructure")` on PUT/POST
- Use `requireStaffAuth` middleware at router level, not per-handler
- HL7 inbound config should be admin-only

---

### HIGH-005: `POST /api/radiology/pacs-settings/load-defaults` — Hardcodes LAN IP

**Route:** `pacsEnterprise.ts` L209–236
**Severity:** 🟠 High
**Impact:** The `load-defaults` endpoint hardcodes LAN IP addresses (`172.16.1.139`, `192.168.1.137`) and writes them to the `pacs_settings` table. If called on a different clinic's deployment, it would overwrite production PACS settings with Care Diagnostics' specific IPs.

**Finding:**
```typescript
const DEFAULT_VIEWER_SETTINGS: Record<string, string> = {
  ohif_base_url: "http://192.168.1.137:3010",       // ← Hardcoded LAN IP
  dicom_web_base_url: "http://172.16.1.139:8042/dicom-web",  // ← Hardcoded LAN IP
  pacs_ip: "172.16.1.139",                           // ← Hardcoded
  ...
};
```

**Fix:**
- Move defaults to `.env` or `clinic_settings` table
- Protect endpoint with admin permission: `requireStaffSubPermission("/settings", "infrastructure")`
- Or remove endpoint and document manual configuration

---

### HIGH-006: Mobile Polling — Leaks Session Token to Any Device ID

**Route:** `GET /api/scan-sessions/mobile-poll/:deviceId` (`scan-sessions.ts` L357)
**Severity:** 🟠 High
**Impact:** Any caller that knows a `deviceId` (which is a client-generated string with no validation) can poll and receive pending scan session tokens. This allows token hijacking if `deviceId` is guessable.

**Finding:**
```typescript
scanSessionsRouter.get("/mobile-poll/:deviceId", async (req: any, res: any) => {
  // No auth, no deviceId validation format
  res.json({
    pending: true,
    sessionToken: sessions[0].sessionToken,  // ← Token returned to anyone
  });
```

**Fix:**
- Validate that `deviceId` is a UUID or matches a registered paired device
- Add HMAC or signed response so only the legitimate device can use the token
- Apply rate limiting: 1 req/5s per IP

---

## 🟡 MEDIUM FINDINGS

### MED-001: Day-Close Endpoint — All-Staff Access, No Role Check on Admin Operations

**Route:** `/api/day-close` — mounted with `requireStaffAuth` only
**Severity:** 🟡 Medium
**Finding:** `dayCloseRouter` contains per-user endpoints (safe) and admin-only endpoints (`/all`, `/admin-list`, `/reopen`). The admin check is done inline per-handler, not at the router mount level.
**Risk:** If a handler misses the admin check, billing staff could close/reopen other users' day.
**Fix:** Add inline `FULL_ACCESS_ROLES.has(session.role)` guard to all admin-only endpoints; audit all handlers in `day-close.ts`.

---

### MED-002: Radiology Routes — No Sub-Permission Differentiation Between Read and Write

**Routes:** All radiology subrouters (knowledge, copilot, lesions, memory, spine, brain, tumor, annotations, Ollama)
**Severity:** 🟡 Medium
**Finding:** All 14 radiology sub-modules are mounted with `requireStaffAuth` only. Any receptionist who logs in can modify radiology AI templates, delete lesion tracking data, or update teaching cases.
**Fix:** Add `requireStaffSubPermission("/radiology", "write")` for mutating operations (PUT/POST/DELETE) in these modules.

---

### MED-003: Banking Webhook — No Signature Verification

**Route:** `POST /api/banking/webhooks` — public, no auth
**Severity:** 🟡 Medium
**Finding:** `bankingWebhookRouter` is mounted publicly. Code inspection found no HMAC/signature verification (`grep hmac, signature, verify` returned 0 results in `banking.ts`). If the banking provider sends webhook events, they are processed without verifying they came from the provider.
**Fix:** Implement provider-specific signature verification (HMAC-SHA256 or X-Webhook-Signature header) before processing any banking webhook events.

---

### MED-004: Public Booking — `totalAmount` Not Verified Server-Side Before Payment Initiation

**Routes:** `/api/public/booking/payu-initiate`, `/phonepe-initiate`, `/bharatpe-initiate`
**Severity:** 🟡 Medium
**Finding:** `totalAmount` is passed directly from the browser request body. The server does not re-calculate the price from the selected test IDs.
```typescript
const amount = Number(totalAmount);
if (!Number.isFinite(amount) || amount <= 0) { // Only checks positive
```
A user could modify `totalAmount: 1` in browser devtools and pay ₹1 for a ₹5000 MRI.
**Fix:** Server should calculate total from `testIds + packageIds` using DB prices. Compare client-provided amount to calculated amount; reject if discrepancy > 1%.

---

### MED-005: `GET /api/public/booking/my-bookings?phone=` — No Phone Verification

**Route:** `public-booking.ts` L242–251
**Severity:** 🟡 Medium
**Finding:** Returns all bookings for any phone number without verification.
```typescript
publicBookingRouter.get("/my-bookings", async (req, res) => {
  const phone = String(req.query.phone || "");
  // No OTP, no rate limit, no session — anyone can enumerate bookings by phone
  const rows = await db.select()...where(phone)...
```
PII exposure: name, email, selected tests, booking status all returned.
**Fix:** Require OTP verification before returning booking list. Apply rate limiting: 5 req/minute per IP.

---

### MED-006: WhatsApp Webhook — Validation Comment Only, Not Verified in Code

**Route:** `GET|POST /api/whatsapp/webhook`
**Severity:** 🟡 Medium
**Finding:** Comment says "validated by Meta's hub.verify_token" but webhook signature verification (`X-Hub-Signature-256`) on POST messages was not confirmed in the router. If not implemented, forged webhook events could trigger AI auto-replies.
**Fix:** Verify `X-Hub-Signature-256: sha256=<hmac>` on all POST webhook events using the WhatsApp App Secret.

---

### MED-007: Internal Backup — No Rate Limiting on pg_dump Stream

**Route:** `GET /api/internal/backup` (streams pg_dump output)
**Severity:** 🟡 Medium
**Finding:** Protected by `INTERNAL_API_KEY` but no rate limiting. A compromised key allows unlimited pg_dump streams, potentially exfiltrating the entire database repeatedly.
**Fix:** Apply `backupLimiter` (already defined in `rateLimits.ts`) to this route. Currently `backupLimiter` is only applied to `/backup/run` (super-admin route).

---

### MED-008: DICOM Upload — No Permission Beyond `requireStaffAuth`

**Route:** `POST /api/dicom-uploads` (`dicom-uploads.ts` L110)
**Severity:** 🟡 Medium
**Finding:** DICOM upload is protected by `requireStaffAuth` but no `/dicom-nodes` permission. A receptionist can upload DICOM files.
**Fix:** Add `requireStaffPermission("/dicom-nodes")` or `requireStaffSubPermission("/radiology", "upload")`.

---

### MED-009: Super Admin Route — `POST /api/super-admin/login` Has No Lockout

**Route:** `super-admin.ts` — login endpoint
**Severity:** 🟡 Medium
**Finding:** `loginLimiter` (10 attempts / 15 min) is applied at the route level. However, the super admin login has different characteristics — brute-forcing a 6-digit PIN should trigger permanent lockout after N attempts, not reset after 15 minutes.
**Fix:** Track failed PIN attempts in `super_admin_sessions` table. Lock account after 5 consecutive failures for 1 hour; alert via log.

---

## 🔵 LOW FINDINGS

### LOW-001: PACS Echo Test — Command Injection Potential via echoscu

**Route:** `POST /api/radiology/modalities/:id/echo-test` (`pacsEnterprise.ts` L125)
**Severity:** 🔵 Low (mitigated by auth)
**Finding:**
```typescript
await execAsync(`echoscu -aec "${aeTitle}" -aet "DIAGNOCENTER" --timeout 5 "${host}" ${port}`)
```
`aeTitle` and `host` are loaded from the database (not from request body), so there is no direct injection vector from external input. However, if a malicious modality record is inserted via a compromised admin account, shell injection via `aeTitle` is possible.
**Fix:** Use an argument array with `execFile` instead of `execAsync` with a shell-interpolated string. Validate `aeTitle` as alphanumeric+underscore only before use in exec.

---

### LOW-002: Teleradiology Share — Token Length Not Audited

**Route:** `/api/teleradiology` — token-gated public viewer
**Severity:** 🔵 Low
**Finding:** Token length/entropy was not confirmed in code. If token is short (e.g., 8 hex chars = 32 bits), brute force via the public endpoint is feasible.
**Fix:** Verify token is `crypto.randomBytes(16).toString('hex')` (32 hex chars = 128-bit entropy). Add rate limiting on token validation endpoint.

---

### LOW-003: `requireSuperAdminUsb` — USB Key Stored in Plaintext Env Var

**Route:** All `/admin/*` routes
**Severity:** 🔵 Low
**Finding:** `SUPER_ADMIN_USB_KEY` is a plaintext string in env var compared with constant-time equality. If the env var is leaked (e.g., via `/api/system-health`), the USB key is compromised.
**Fix:** Store a BCRYPT hash of the USB key instead of plaintext. Compare using `bcrypt.compare()`.

---

### LOW-004: Audit Logs — Accessible via `requireSuperAdminUsb + requireSuperAdmin` but Exported CSV is in Memory

**Route:** `GET /api/admin/audit-logs/export`
**Severity:** 🔵 Low
**Finding:** Large audit log exports are built entirely in memory as CSV strings. A very large table could OOM the server.
**Fix:** Stream the CSV response using Node.js streams instead of building a string. The `exportLimiter` already prevents frequent calls (good).

---

### LOW-005: Health Check Endpoint Exposes Runtime Info

**Route:** `GET /health` (public, no auth)
**Severity:** 🔵 Low
**Finding:** Returns application health status. Confirm it does not include Node.js version, database version, or environment names in the response.
**Fix:** Ensure `health.ts` returns only `{ status: "ok" }` with no infrastructure version info.

---

### LOW-006: Error Handler — Stack Traces in Production

**Middleware:** `errorHandler.ts`
**Severity:** 🔵 Low
**Finding:** Need to verify that error handler does not return stack traces to clients in production mode.
**Fix:** Ensure `errorHandler.ts` returns `{ error: "Internal Server Error" }` without stack traces when `NODE_ENV === "production"`.

---

### LOW-007: `POST /api/clinic-settings/ollama` — No Permission Guard

**Route:** Added in Phase 11 (commit 4250dab)
**Severity:** 🔵 Low
**Finding:** The new Ollama settings endpoint (`POST /clinic-settings/ollama`) is mounted under `/clinic-settings` which requires `requireStaffSubPermission("/settings", "clinic")` for non-GET requests. However, the POST handler is added AFTER the `export default` statement, which means it relies on Express route order being correct. Should be verified.
**Fix:** Add explicit `requireStaffSubPermission("/settings", "clinic")` guard inside the POST handler or move it before export.

---

## Authentication Summary

### What is Well-Secured ✅

| Route Group | Auth | Permission | Notes |
|-------------|------|-----------|-------|
| `/admin/audit-logs` | Super Admin + USB | ✅ | Double-gated |
| `/admin/role-permissions` | Super Admin + USB | ✅ | Double-gated |
| `/admin/system-health` | Super Admin + USB | ✅ | Double-gated |
| `/commission` | Super Admin | ✅ | Financial data |
| `/doctor-ledger` | Super Admin | ✅ | Financial data |
| `/backup` | Super Admin | ✅ | Sensitive |
| `/system` | Super Admin | ✅ | System ops |
| `/billing` | Staff Auth | `/billing` | ✅ |
| `/accounting` | Staff Auth | `/accounting` | ✅ |
| `/form-f` | Staff Auth | `/form-f` | ✅ PHI gated |
| `/patient-reports` | Staff Auth | `/reports` | ✅ PHI gated |
| `/pacs` | Staff Auth | `/dicom-nodes` | ✅ |
| `/dicom` | Staff Auth | `/dicom-nodes` | ✅ |
| `/patients` | Staff Auth | `/patients` | ✅ |
| Internal cron | `CRON_SECRET` | — | ✅ Env-key gated |
| Internal radiology | `INTERNAL_API_KEY` | — | ✅ Env-key gated (prod) |

### What Lacks Sufficient Auth ⚠️

| Route Group | Current Auth | Missing |
|-------------|-------------|---------|
| `POST /radiology/routing-rules` | Staff Auth only | Admin/infrastructure permission |
| `POST /radiology/pacs-settings/load-defaults` | Staff Auth only | Admin permission |
| `POST /scan-sessions/pair` | None (token only) | Staff Auth for pairing |
| `GET /scan-sessions/mobile-poll/:deviceId` | None | Rate limit + deviceId validation |
| `POST /scan-sessions/upload/:token` | None | Rate limit + size cap |
| `GET /public/booking/my-bookings` | None | OTP or rate limit |
| `GET /public/booking/config` | None | Remove `payuMerchantKey` |
| `GET /clinic-settings/` | Staff Auth (any) | Redact payment secrets |

---

## Payment Gateway Security

| Gateway | Signature Verified | Server-Side Amount Check | Notes |
|---------|--------------------|--------------------------|-------|
| PayU | ✅ SHA512 HMAC | ❌ Client amount trusted | Fix: MED-004 |
| PhonePe | ✅ Server-side status check | ❌ Client amount trusted | Fix: MED-004 |
| BharatPe | Partial | ❌ Client amount trusted | Fix: MED-004 |
| Razorpay | ✅ (in PaymentEngine) | ❌ Client amount trusted | Fix: MED-004 |
| ICICI | ✅ (in PaymentEngine) | ❌ Client amount trusted | Fix: MED-004 |
| Banking Webhook | ❌ No signature | — | Fix: MED-003 |

---

## DICOM / PACS Security

| Surface | Auth | Risk |
|---------|------|------|
| Orthanc (192.168.1.137:8042) | None (LAN only) | LAN-only — OK |
| OHIF (192.168.1.137:3010) | None (LAN only) | LAN-only — OK |
| `/api/pacs` | Staff + `/dicom-nodes` | ✅ |
| `/api/dicom` | Staff + `/dicom-nodes` | ✅ |
| `/api/radiology/routing-rules` | Staff only | ⚠️ Missing admin check |
| `/api/radiology/pacs-settings/load-defaults` | Staff only | ⚠️ Missing admin check |
| DICOM C-ECHO (echoscu exec) | Staff | ⚠️ Shell injection risk (LOW-001) |
| `/api/dicom-uploads` | Staff only | ⚠️ No DICOM permission check |

---

## Recommended Fix Priority

### Immediate (Before Next Deploy)
1. **CRIT-001**: Remove `payuMerchantKey` from public booking config response
2. **CRIT-002**: Add rate limit + size cap to scan session upload endpoint
3. **HIGH-003**: Redact payment secrets from `GET /clinic-settings/`

### This Sprint
4. **HIGH-001**: Add admin permission to PACS routing rule mutations
5. **HIGH-002**: Require `requireStaffAuth` for phone pairing
6. **HIGH-006**: Add deviceId validation + rate limit to mobile poll
7. **MED-004**: Server-side total amount calculation for all payment gateways
8. **MED-005**: OTP or rate limit on `my-bookings` public endpoint

### Next Sprint
9. **MED-003**: Banking webhook signature verification
10. **MED-006**: WhatsApp webhook signature verification
11. **MED-007**: Rate limit internal backup stream
12. **LOW-001**: Refactor echoscu call to use `execFile` with argument array
13. **LOW-003**: Hash USB key in env instead of storing plaintext
14. **CRIT-003**: Require `INTERNAL_API_KEY` in all environments (not just production)

---

## Non-Issues (Confirmed Safe)

- ✅ Session tokens are cryptographically random (not guessable)
- ✅ SQL injection: Drizzle ORM with parameterized queries throughout
- ✅ XSS: API is JSON-only; no HTML rendering
- ✅ CORS: Not audited here (managed at reverse proxy / Cloudflare level)
- ✅ DB schema: All input validated via Zod before DB writes in critical routes
- ✅ Logo upload: 1.5MB cap enforced, base64 only, no file path traversal
- ✅ File path traversal: DICOM upload uses `crypto.randomBytes` for filename, not user input
- ✅ Password storage: Uses bcrypt (confirmed in user auth flow)
- ✅ Public reports: Token-gated, tokens are study-specific not reusable across studies
- ✅ Teleradiology shares: Token-gated with expiry
- ✅ HL7 inbound: `INTERNAL_API_KEY` protected
- ✅ Rate limiting: Login (10/15min), backup (5/hr), upload (20/5min), DICOM upload (10/10min)
