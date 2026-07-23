# CARE ERP — Security Review (router surface + auth)

_Final stabilization security pass across the API router surface (~153 routers in `artifacts/api-server/src/routes/`) plus the login/session flow. Result: **no Critical or High findings.** The codebase shows consistent security hygiene; the notes below are the evidence and the (deliberate) advisories._

## Scope & method
Every router file was swept for the high-severity, detectable classes below, each traced to the actual code + its mount in `routes/index.ts`. This complements the login-safety review (see `CARE_ERP_MASTER_HANDOVER.md`) and the earlier §13 spot-check.

## Results by category

| Class | Result | Evidence |
|---|---|---|
| **SQL injection** | ✅ none | Queries use Drizzle parameterization. Every `sql.raw()` use targets a **fixed constant or a validated enum**, never request data: `reports.ts` `groupBy` is one of 3 hard-coded strings (period is Zod-validated); `radiologistAssignment.ts` `col` comes from a fixed map; `risMonitoring.ts` uses literal column names; `restoreVerification.ts` operates on internal backup DB/table names. User values in `sql\`… ${x}\`` are bound parameters (e.g. `ILIKE ${'%'+query+'%'}`). |
| **Missing authorization** | ✅ none | Sensitive routers are guarded either at mount (`requireStaffAuth` + `requireStaffPermission`/`requireAdminRole`) or internally (`router.use(requireStaffAuth)` — verified for `ai-caller-credentials`, `reception-command-center`, `scan-sessions`). The unauthenticated mounts are all intentionally public with their own auth: displays (`DISPLAY_ACCESS_TOKEN`), webhooks (signature-verified: gateway, banking, whatsapp), staff/patient login (rate-limited + lockout), public booking, integration partner (`requireIntegrationPartnerAuth`), WebAuthn authenticate, internal service callbacks (`INTERNAL_API_KEY`). |
| **SSRF** | ✅ none | Server-side `fetch()` calls target **admin-configured** integration endpoints (Orthanc, Ollama, payment/WhatsApp/banking providers) — not per-request user URLs. No route fetches a URL taken from `req.body/query/params`. An SSRF/private-IP guard exists (`ALLOW_PRIVATE_IPS`, `pacs/*`, `radiologyOllama`). |
| **Secret exposure** | ✅ none | `integration/admin.ts` returns a freshly generated API key **once on creation** (admin-gated, "shown only once" — the correct pattern). `teleradiologyPortal.ts` explicitly **strips** `pinHash` from responses. Provider API keys are stored encrypted and never returned/logged. |
| **PHI / secrets in logs** | ✅ none | No logger/console call logs patient identifiers or report bodies. Log-redaction infrastructure exists (`logger.ts`, `operationsHealth.ts` redacts `Bearer` tokens). |
| **PCPNDT / fetal-sex leakage** | ✅ none | No endpoint returns `fetalSex`/`gender`; every reference is a fail-closed guard. Form F enforcement is server-side and fail-closed; AI never emits fetal sex nor bypasses Form F. |
| **File upload validation** | ✅ present | `uploads.ts` enforces `MAX_UPLOAD_SIZE_BYTES`; `dicom-uploads.ts` uses multer with a size limit (`DICOM_UPLOAD_MAX_BYTES`, 512 MB default) **and** a `fileFilter` restricting to `DICOM_MIME_TYPES`. |
| **Open redirect** | ✅ none | No `res.redirect()` with a request-derived target. |
| **Demo-mode isolation** | ✅ proven | `/radiology/usg-demo` makes zero writes/network calls (pinned by `UsgDemoMode.safety.test.ts`). |

## Login / session (summary — full detail in the handover)
Strong: bcrypt(12) PINs + legacy auto-upgrade, **per-account lockout** (5 attempts → 30 min, admin-alerted), IP rate-limiting (`skipSuccessfulRequests`), 192-bit random **server-side** revocable session tokens with expiry + idle-timeout, **Bearer-header** auth (no CSRF), `lan_only_login` LAN restriction, WebAuthn hardware-key option, patient-portal lockout + bcrypt + constant-time compare.

## Advisories (deliberate trade-offs — not vulnerabilities)
1. Bootstrap default PIN `1234` + `BOOTSTRAP_ADMIN_FORCE` resets the PIN on every restart → must be `false`/unset in production; change the PIN on first login.
2. `super_admin` is exempt from account lockout and `admin`/`super_admin` from `lan_only_login` (so admins aren't locked out remotely) → these accounts' defense is PIN strength + WebAuthn. **Recommend** enabling WebAuthn for admins and using a long super_admin PIN.
3. Minimum PIN length is 4 (numeric) — acceptable given lockout + rate-limit; consider ≥6 by policy for admin roles.
4. Session tokens live in browser storage (standard for Bearer auth) — the XSS trade-off; React auto-escaping and the absence of `dangerouslySetInnerHTML` on untrusted data keep this low-risk.

## Conclusion
No Critical/High vulnerabilities were found on the router surface; no code changes were required by this pass. The advisories above are configuration/operational hardening recommendations, tracked for the owner. A future periodic deep pass can extend this with per-route object-level-authorization fuzzing.
