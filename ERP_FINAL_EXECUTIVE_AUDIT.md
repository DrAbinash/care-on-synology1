# Care Diagnostics ERP — Final Executive Audit
**Cross-Audit of All Technical Reports**
**Date:** June 24, 2026 | **Auditor:** Antigravity AI | **Scope:** Production Readiness for 24×7 Diagnostic Center

> **Constraint:** This is a read-only audit. No code, configuration, or database values were modified.

---

## 1. Audit Scope & Source Documents

| # | Document | Date | Status |
|---|----------|------|--------|
| 1 | `ERP_MASTER_CONTEXT.md` | June 2026 | Canonical reference |
| 2 | `ERP_SECURITY_AUDIT.md` | June 2026 | 24-item risk registry |
| 3 | `ERP_DATABASE_DICTIONARY.md` | June 2026 | 278-table schema reference |
| 4 | `ERP_PERMISSION_MATRIX.md` | June 2026 | RBAC vulnerability mapping |
| 5 | `ERP_PACS_DOCUMENTATION.md` | June 2026 | DICOM/PACS architecture |
| 6 | `ERP_DEPLOYMENT_RUNBOOK.md` | June 2026 | Synology deploy & DR guide |
| 7 | `ERP_TECHNICAL_DEBT.md` | June 2026 | 9-item ranked debt register |
| 8 | `RNCC_FINAL_PRODUCTION_VALIDATION.md` | June 24, 2026 | PACS live-state validation |
| 9 | `ERP_RUNTIME_FAILURE_SIMULATION.md` | June 24, 2026 | 15-scenario failure audit |

---

## 2. Contradictions Between Reports

The following factual contradictions were identified across the source documents:

### 2.1 — PACS Topology: Dual-Active vs. Orthanc-Only

| Document | Claim |
|----------|-------|
| `ERP_MASTER_CONTEXT.md` (§1 table) | Lists **both** Conquest PACS and Orthanc PACS as active production PACS systems |
| `ERP_MASTER_CONTEXT.md` (§7 workflow) | Shows Conquest Lua hook as **primary** intake path to ERP |
| `ERP_PACS_DOCUMENTATION.md` (§2-C) | Describes Conquest as "deployed as a lightweight DICOM receiver" currently handling C-STORE |
| `RNCC_FINAL_PRODUCTION_VALIDATION.md` (§6) | **Definitively states:** Conquest is retired; Orthanc is sole active PACS |
| `ERP_RUNTIME_FAILURE_SIMULATION.md` (§2) | Confirms: Conquest retired — do NOT include as active |

**Verdict:** The master context and PACS documentation are **outdated**. Conquest PACS is retired from active production. Only Orthanc (`ORTHANC2`, port `5680`) is active. The Lua hook workflow described in PACS documentation is **no longer the live intake path** — it describes a retired integration.

---

### 2.2 — Orthanc DICOM Port: 4242 vs. 5680

| Document | Claim |
|----------|-------|
| `ERP_MASTER_CONTEXT.md` | Lists Orthanc port as `4242` (standard Orthanc DICOM default) |
| `ERP_PACS_DOCUMENTATION.md` | Does not specify which external port Orthanc uses |
| `RNCC_FINAL_PRODUCTION_VALIDATION.md` (§4, §6) | Confirms DICOM target port is **`5680`** externally (mapped to internal `4242`) |
| `docs/LIVE_NETWORK_CONFIGURATION.md` | Confirms modalities target `172.16.1.139:5680` |

**Verdict:** External DICOM port is **`5680`**, not `4242`. Internal Docker port is `4242`. The master context is misleading — it lists internal port only.

---

### 2.3 — Orthanc DICOM Port Exposure in Docker Compose

| Document | Claim |
|----------|-------|
| `ERP_DEPLOYMENT_RUNBOOK.md` | Makes no mention of Orthanc DICOM port in the stack |
| `PACS_CURRENT_STATE_REPORT.md` | States Orthanc DICOM port `4242` is **not exposed** in docker-compose |
| `RNCC_FINAL_PRODUCTION_VALIDATION.md` | Confirms DICOM works at `5680` on the host |

**Verdict:** Orthanc's DICOM port is exposed outside `docker-compose.yml` — it is managed separately in Synology's Container Manager. The deployment runbook is **incomplete** and misleads engineers attempting to replicate the stack.

---

### 2.4 — Automatic Orthanc→ERP Study Push

| Document | Claim |
|----------|-------|
| `ERP_MASTER_CONTEXT.md` (§7 workflow) | Workflow diagram implies Conquest Lua → ERP is the only intake mechanism |
| `ERP_PACS_DOCUMENTATION.md` (§3-A) | Describes automatic push from PACS to ERP via Lua hook |
| `PACS_CURRENT_STATE_REPORT.md` (§3) | Status: **❌ BROKEN** — "There is no Orthanc→ERP auto-push mechanism implemented" |
| `ERP_RUNTIME_FAILURE_SIMULATION.md` (Scenario 2) | Confirms: Orthanc cannot auto-notify ERP |

**Verdict:** The documented intake workflow (PACS → ERP automatic push) does **not function** with Orthanc. The documentation describes a Conquest-era workflow. The current Orthanc setup requires **manual sync or polling** — a critical production gap.

---

### 2.5 — C-ECHO / DCMTK Availability

| Document | Claim |
|----------|-------|
| `ERP_DEPLOYMENT_RUNBOOK.md` | Implies DICOM connection tests work normally |
| `PACS_CURRENT_STATE_REPORT.md` | `echoscu` (DCMTK) is **not installed** in the `care-api` container; C-ECHO silently falls back to TCP probe |

**Verdict:** DICOM protocol-level connectivity tests cannot run inside the API container. The deployment runbook does not mention DCMTK as a dependency, leaving engineers with a false sense of verified PACS connectivity.

---

### 2.6 — Conquest Lua Hook: Live vs. Placeholder

| Document | Claim |
|----------|-------|
| `ERP_MASTER_CONTEXT.md` | Presents Lua hook as active PACS→ERP pipeline |
| `ERP_PACS_DOCUMENTATION.md` | Documents Lua hook as the functional integration |
| `PACS_CURRENT_STATE_REPORT.md` | Lua hook contains `YOUR_DOMAIN.replit.app` placeholder — **never configured for production** |
| `RNCC_FINAL_PRODUCTION_VALIDATION.md` | Classifies placeholder as "Legacy but harmless" (Conquest retired) |

**Verdict:** The Lua hook has **never been live in production**. All documentation claiming it is the active intake mechanism was aspirational architecture, not deployed reality.

---

### 2.7 — Backup Encryption Status

| Document | Claim |
|----------|-------|
| `ERP_DEPLOYMENT_RUNBOOK.md` (§6) | Backup script saves `.dump` files; no encryption mentioned |
| `ERP_SECURITY_AUDIT.md` (§21) | **High severity finding:** Backups stored in plaintext |
| `DISASTER_RECOVERY_AUDIT.md` (§4) | Recommends AES-256 encryption but lists it as `[ ]` (not done) |

**Verdict:** Backups are **confirmed unencrypted**. The runbook normalizes this behavior by publishing the backup script as-is without encryption. No report contradicts this — it is a consistent confirmed gap.

---

### 2.8 — PostgreSQL Port Binding

| Document | Claim |
|----------|-------|
| `ERP_DEPLOYMENT_RUNBOOK.md` | Lists `5400` as a port used for "database tools" — no binding restriction mentioned |
| `ERP_SECURITY_AUDIT.md` (§16) | Flags `0.0.0.0:5400` binding as **High severity** |
| `docker-compose.yml` | `"${DB_HOST_PORT:-5400}:5432"` — bound to `0.0.0.0` by default |

**Verdict:** The deployment runbook implicitly normalizes an insecure database port binding. It documents the port without warning engineers to restrict it to `127.0.0.1`.

---

## 3. Disproved Assumptions

| # | Original Assumption (from early docs) | Disproved By | Finding |
|---|---------------------------------------|--------------|---------|
| 1 | Conquest PACS is co-active with Orthanc in production | `RNCC_FINAL_PRODUCTION_VALIDATION.md` | Conquest is retired. Orthanc is sole active PACS. |
| 2 | The Lua hook is the live study intake pipeline | `PACS_CURRENT_STATE_REPORT.md` | Hook has never been deployed to production; placeholder URL intact. |
| 3 | Orthanc automatically pushes new studies to the ERP | `PACS_CURRENT_STATE_REPORT.md` | No auto-push exists. Manual sync required. |
| 4 | C-ECHO validates DICOM association correctly | `PACS_CURRENT_STATE_REPORT.md` | Falls back to TCP probe; no DCMTK in container. |
| 5 | Admin role implies fine-grained privilege separation | `ERP_PERMISSION_MATRIX.md`, `ERP_SECURITY_AUDIT.md` | Admin bypasses all sub-permission checks via `FULL_ACCESS_ROLES`. |
| 6 | `/radiology` routes are protected by the permission matrix | `ERP_PERMISSION_MATRIX.md` | All radiology sub-routes are gated only by `requireStaffAuth`. Any staff can access them. |
| 7 | The system handles concurrent report editing safely | `ERP_RUNTIME_FAILURE_SIMULATION.md` (Scenario 13) | Lock exists, but stale locks persist for 30 minutes on browser close, blocking other radiologists. |
| 8 | Orthanc DICOM port is `4242` | `RNCC_FINAL_PRODUCTION_VALIDATION.md` | External port is `5680`; `4242` is the internal Docker port only. |
| 9 | Payment gateway timeouts mark transactions as failed | `ERP_RUNTIME_FAILURE_SIMULATION.md` (Scenario 8) | No idempotent transaction lock; duplicate bookings can occur on retry. |
| 10 | Session expiry gracefully warns users before losing data | `ERP_RUNTIME_FAILURE_SIMULATION.md` (Scenario 15) | Session expires silently; unsaved report text is lost without warning. |

---

## 4. Critical Risk Registry

These risks can cause data loss, system compromise, or regulatory non-compliance.

| # | Risk | Location | Impact |
|---|------|----------|--------|
| **CR-01** | Open mail relay — any staff can send arbitrary HTML to any email | `my-daily-summary.ts` POST `/send-email` | Phishing, data exfiltration, SPAM abuse |
| **CR-02** | Laboratory samples (`/api/samples`) have zero permission gates | `samples.ts`, `routes/index.ts` | Any staff can delete/modify specimen records |
| **CR-03** | No Orthanc → ERP auto-push: studies can silently miss the worklist | PACS architecture gap | Patient scans not visible to radiologists |
| **CR-04** | Session expires silently; unsaved report text lost without warning | Frontend — all reporting pages | Finalized report drafts discarded on session timeout |
| **CR-05** | Playwright PDF generation runs synchronously on the main Node thread | `pacsArchive.ts` | Under concurrent load, API event loop blocked; server crash possible |

---

## 5. High Risk Registry

These risks enable unauthorized access, financial fraud, or operational disruption.

| # | Risk | Location | Impact |
|---|------|----------|--------|
| **HR-01** | PostgreSQL port `5400` bound to `0.0.0.0` | `docker-compose.yml` | Database brute-force from LAN or WAN |
| **HR-02** | Daily financial summary accessible to all authenticated staff | `/api/daily-summary` | Revenue figures exposed to receptionists and lab techs |
| **HR-03** | All radiology routes (`/radiology/*`) gated by auth only | `routes/index.ts` | Any staff can read, write, finalize clinical reports |
| **HR-04** | DICOM study manager mutative endpoints lack role enforcement | `dicomStudyManager.ts` | Any staff can link studies to wrong billing records |
| **HR-05** | Backup `.dump` files stored in plaintext on NAS | Backup cron script | Physical NAS theft = full PHI exposure |
| **HR-06** | Patient ID generation is O(N) memory loop | `patients.ts` | API OOM crash at scale (~10,000+ patients) |
| **HR-07** | No persistent failed-login counter in database | Auth middleware | Slow brute-force against 4-digit PIN achievable across restarts |
| **HR-08** | Session tokens stored in localStorage (not HTTP-Only cookies) | Frontend auth | XSS attack can extract session token |
| **HR-09** | Billing cancellation/refund endpoints bypass sub-permission checks | `bills.ts` | Receptionist can issue unauthorized refunds |
| **HR-10** | No idempotent lock on payment gateway callbacks | Payment handlers | Duplicate booking/double-charge on gateway timeout + retry |

---

## 6. Top 20 Fixes Ranked by ROI

> ROI = (Risk Severity × Patient/Financial Impact) ÷ Implementation Effort

| Rank | Fix | Risk Eliminated | Effort | ROI |
|------|-----|-----------------|--------|-----|
| **1** | Bind PostgreSQL to `127.0.0.1:5400:5432` | Database exposure (HR-01) | 1 line | ★★★★★ |
| **2** | Add `requireStaffPermission("/radiology")` to all radiology routes | PHI access by non-radiology staff (HR-03) | 1 hour | ★★★★★ |
| **3** | Add `requireStaffPermission("/tests")` to `/samples` router | Lab sample tampering (CR-02) | 30 min | ★★★★★ |
| **4** | Add `requireStaffPermission("/reports")` to `/daily-summary` | Financial data leak (HR-02) | 30 min | ★★★★★ |
| **5** | Lock down `send-email` endpoint — remove arbitrary HTML body | Open mail relay (CR-01) | 2 hours | ★★★★★ |
| **6** | Encrypt daily backup dumps with AES-256/gpg before writing | PHI on disk (HR-05) | 2 hours | ★★★★★ |
| **7** | Implement Orthanc→ERP auto-push via Orthanc Lua or REST API | Studies silently missed (CR-03) | 1–2 days | ★★★★☆ |
| **8** | Add session expiry warning banner + localStorage draft save | Silent data loss (CR-04) | 1 day | ★★★★☆ |
| **9** | Replace O(N) Patient ID loop with PostgreSQL sequence | API OOM at scale (HR-06) | 4 hours | ★★★★☆ |
| **10** | Add persistent failed-login counter + account lockout in DB | Brute-force PIN attacks (HR-07) | 1 day | ★★★★☆ |
| **11** | Apply sub-permission checks to billing cancel/refund routes | Unauthorized refunds (HR-09) | 4 hours | ★★★★☆ |
| **12** | Add idempotent transaction lock key to payment callbacks | Duplicate charges (HR-10) | 1 day | ★★★★☆ |
| **13** | Apply role guards inside `dicomStudyManager.ts` link/priority routes | Clinical data integrity (HR-04) | 4 hours | ★★★☆☆ |
| **14** | Offload Playwright PDF rendering to a background job worker | API thread blocking (CR-05) | 2 days | ★★★☆☆ |
| **15** | Migrate auth tokens from localStorage to HTTP-Only cookies | XSS session theft (HR-08) | 2 days | ★★★☆☆ |
| **16** | Install `dcmtk` (echoscu) in Dockerfile | False PACS connectivity tests | 30 min | ★★★☆☆ |
| **17** | Add `X-Frame-Options: DENY` + `Content-Security-Policy` headers in Nginx | Clickjacking / XSS | 1 hour | ★★★☆☆ |
| **18** | Implement websocket heartbeat to release stale study locks on tab close | 30-min radiologist lockouts | 2 days | ★★★☆☆ |
| **19** | Update `ERP_MASTER_CONTEXT.md` to reflect Orthanc-only PACS topology | Engineering misdirection from docs | 1 hour | ★★☆☆☆ |
| **20** | Delete or archive backup_* and restore_* folders from repo root | Repo pollution, deployment bloat | 30 min | ★★☆☆☆ |

---

## 7. Assessment Scores

### 7.1 Production Readiness Score: **72 / 100**

| Category | Score | Key Deduction |
|----------|-------|---------------|
| Security | 55/100 | Open routes, plaintext backups, exposed DB port |
| Reliability | 70/100 | No auto-push sync; single NAS SPOF |
| PACS Integration | 65/100 | No Orthanc auto-push; C-ECHO fallback to TCP |
| Permissions / RBAC | 60/100 | 15+ routes unprotected beyond `requireStaffAuth` |
| Billing / Payments | 75/100 | No idempotent payment locks; bypass on refunds |
| Performance | 72/100 | O(N) patient ID; synchronous Playwright on main thread |
| Backup & Recovery | 75/100 | Backups run; unencrypted; no restore test automation |
| Maintainability | 80/100 | Clean monorepo; docs partially outdated |
| Deployment | 82/100 | Containerized; documented; DB port security missing |
| Audit Logging | 72/100 | Logs written; no hash-chain tamper protection |

> **72/100** — System is clinically capable and operationally functional. Deployment is recommended only after Critical and High risks above are resolved.

---

### 7.2 Hospital Operational Risk Score: **38 / 100** *(lower = safer)*

| Risk Factor | Score Contribution |
|-------------|-------------------|
| PACS auto-sync gap (studies can miss worklist silently) | +12 |
| Stale 30-min study locks blocking radiologists | +7 |
| Silent session expiry losing report drafts | +8 |
| Single NAS hardware SPOF | +5 |
| Synchronous PDF generation blocking API | +6 |

> **38/100 Operational Risk** — The most critical operational threats are the silent PACS sync gap and the session expiry data loss. These affect patient care and clinician workflow directly.

---

### 7.3 Data-Loss Risk Score: **31 / 100** *(lower = safer)*

| Risk Factor | Score Contribution |
|-------------|-------------------|
| Unencrypted backup dumps on NAS | +8 |
| Plaintext PII in database columns | +7 |
| No restore testing automation | +5 |
| Single DB instance — no read replica | +4 |
| Browser localStorage token exposure | +4 |
| Active scan loss if modality queue cleared during NAS reboot | +3 |

> **31/100 Data-Loss Risk** — Risk is moderate. DICOM files are safe in the PACS volume; database records are protected by Docker volumes. Main threat is physical NAS compromise or backup recovery failure.

---

### 7.4 Security Maturity Score: **48 / 100**

| Dimension | Score | Notes |
|-----------|-------|-------|
| Authentication | 60/100 | Staff PIN + bcrypt; no MFA; no account lockout persistence |
| Authorization / RBAC | 45/100 | 15+ routes beyond basic auth gate; admin over-bypass |
| Network Isolation | 55/100 | Tailscale protects remote access; DB port exposed on LAN |
| Data Encryption | 30/100 | Queries parameterized; backups unencrypted; PII plaintext |
| Audit Trail Integrity | 50/100 | Logs exist; no cryptographic tamper protection |
| Dependency Security | 55/100 | Modern stack; no automatic vulnerability scanning |

> **48/100 Security Maturity** — The system relies heavily on Tailscale network isolation as a compensating control instead of defense-in-depth. Application-layer security needs substantial hardening.

---

## 8. Prioritized Implementation Roadmap

### 8.1 Immediate — 1 Week
*Fixes that are single-file, low-risk, and eliminate Critical/High vulnerabilities immediately.*

| # | Action | Owner |
|---|--------|-------|
| 1 | Change `docker-compose.yml` DB port binding to `127.0.0.1:5400:5432` | DevOps |
| 2 | Add `requireStaffPermission("/radiology")` to all `/radiology/*` mounts in `routes/index.ts` | Backend Dev |
| 3 | Add `requireStaffPermission("/tests")` to `/samples` mount | Backend Dev |
| 4 | Add `requireStaffPermission("/reports")` to `/daily-summary` mount | Backend Dev |
| 5 | Lock down `send-email` — strip arbitrary `htmlBody`; require admin permission | Backend Dev |
| 6 | Update backup cron script to pipe through `gpg --symmetric` before disk write | DevOps |
| 7 | Update `ERP_MASTER_CONTEXT.md` to reflect Orthanc-only PACS topology and port `5680` | Tech Lead |

---

### 8.2 Short-term — 1 Month
*Fixes requiring more design/testing but addressing High-severity gaps.*

| # | Action | Owner |
|---|--------|-------|
| 1 | Add sub-permission checks to `bills.ts` cancel/refund/change-doctor routes | Backend Dev |
| 2 | Apply role guards (`requireTechnicianOrAbove`, `requireRadiologist`) in `dicomStudyManager.ts` | Backend Dev |
| 3 | Replace O(N) patient ID loop with PostgreSQL `nextval` sequence | Backend Dev |
| 4 | Add persistent `failedLoginAttempts` counter to DB + account lockout after 5 failures | Backend Dev |
| 5 | Implement Orthanc→ERP auto-push: configure Orthanc Lua script to POST to `/api/internal/radiology/studies` | PACS/Backend Dev |
| 6 | Add session expiry warning modal (3 min before timeout) + save draft to `localStorage` | Frontend Dev |
| 7 | Install `dcmtk` (`echoscu`) in Dockerfile | DevOps |
| 8 | Add `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options` headers in Nginx config | DevOps |
| 9 | Implement idempotent transaction key (UUID) on payment gateway initiation to prevent double-charge on retry | Backend Dev |

---

### 8.3 Medium-term — 3 Months
*Architectural improvements requiring significant design or refactoring.*

| # | Action | Owner |
|---|--------|-------|
| 1 | Offload Playwright PDF generation to a background worker queue (e.g., database-backed job queue or BullMQ) | Backend Dev |
| 2 | Migrate staff session tokens from `localStorage` to Secure, HTTP-Only, SameSite cookies | Full-stack Dev |
| 3 | Implement websocket heartbeat for study lock keep-alive; auto-release lock on tab close | Full-stack Dev |
| 4 | Run automated backup restore test in a sandbox container weekly (cron job) | DevOps |
| 5 | Configure Tailscale ACL to bind DB port `5400` access strictly to Tailscale IP range only | DevOps |
| 6 | Implement file signature (magic number) validation on all upload endpoints using `file-type` | Backend Dev |
| 7 | Add SSRF-blocking allowlist on backend `fetch` calls to PACS/AI endpoints — block `127.0.0.1`, `169.254.x.x` | Backend Dev |

---

### 8.4 Long-term — 6 Months
*Infrastructure and compliance hardening requiring procurement or major refactoring.*

| # | Action | Owner |
|---|--------|-------|
| 1 | Implement cryptographic hash-chaining on `audit_log` rows (each log includes SHA-256 of previous row) | Backend Dev |
| 2 | Encrypt sensitive PII columns at rest using AES-GCM at application layer (phone, email, DOB) | Backend Dev |
| 3 | Configure Synology High Availability (SHA) with a second passive NAS unit for automatic failover | IT Infrastructure |
| 4 | Add Dual-WAN router with 4G/5G failover for clinic LAN connectivity | IT Infrastructure |
| 5 | Implement read replica PostgreSQL for report/analytics queries to prevent write contention | DevOps/Backend |
| 6 | Replace hardcoded `.env` secrets with Docker Secrets or Synology Secrets Manager | DevOps |
| 7 | Deploy automated vulnerability scanning (e.g., `npm audit` CI gate + Trivy container scan) | DevOps |

---

## 9. Summary Scorecard

| Metric | Score | Grade |
|--------|-------|-------|
| **Production Readiness** | 72 / 100 | B− |
| **Hospital Operational Risk** | 38 / 100 *(lower=safer)* | Moderate |
| **Data-Loss Risk** | 31 / 100 *(lower=safer)* | Moderate-Low |
| **Security Maturity** | 48 / 100 | D+ |
| **Critical Risks Remaining** | 5 | ⚠️ Must Fix Before Launch |
| **High Risks Remaining** | 10 | ⚠️ Fix Within 30 Days |
| **Contradictions Found** | 8 | Documents need update |
| **Disproved Assumptions** | 10 | Architecture partially aspirational |

---

## 10. Final Recommendation

The Care Diagnostics ERP is a **feature-complete, clinically sophisticated system** built on a sound modern stack. It handles the full lifecycle from patient registration through billing, radiology, PACS integration, and report delivery.

**It is NOT yet safe for solo 24×7 clinical production deployment** due to:

1. Multiple unprotected backend API routes allowing any staff to read/write clinical data
2. Confirmed broken automatic PACS→ERP study synchronization
3. Synchronous PDF generation capable of blocking the entire API under load
4. Silent session expiry causing radiologist report loss
5. Unencrypted patient data backups on local storage

**Conditional Launch Criteria:** The system may safely go to production after completing all 7 items in the **Immediate (1 Week)** roadmap phase and items 1–6 of the **Short-term (1 Month)** phase. The remaining items represent maturity improvements rather than blockers.

---

*This document is a cross-synthesis audit only. No source code, database records, or production configurations were altered during this assessment.*
