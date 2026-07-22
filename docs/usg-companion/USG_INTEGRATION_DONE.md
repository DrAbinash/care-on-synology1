# USG Companion — Final Integration: Things Done

Completion report for wiring the merged P3–P9 cores into the real CARE ERP
application. **Everything below is merged into `feature/website-login-redirection`.**

> **Nothing is enabled in production. Every USG flag defaults OFF. No clinic
> validation occurred** (this environment has no live Orthanc, OHIF viewer, or
> AI model gateway). Labels are honest: *vertical integration complete* means
> code + API + persistence + tests are in place and the flag is wired — it does
> **not** mean clinic-validated.

---

## 1. Slices delivered (all merged)

| Slice | Phase | PR | What was wired |
|---|---|---|---|
| 1 | **P9** admin/rollout | #167 | Rollout control plane: readiness matrix + server-enforced enable/disable/kill-switch, audited |
| 2 | **P4** prior intelligence | #168 | Prior matching + structured comparison + comparison suggestions |
| 3 | **P5** OB & Doppler | #171 | Canonical OB/Doppler sections + Form-F status + parity report |
| 4 | **P3** exact provenance | #172 | SR → `viewer_measurements` ingest (fail-safe, idempotent, no fabricated frame) |
| 5a | **P6** report→PACS | #173 | Durable return job + eligibility/status API |
| 5b | **P7** cine | #174 | Cine key-frame capture into `usg_key_images` (DICOM references) |
| 5c | **P8** AI assistant | #175 | Advisory boundary: accept-only, honest unavailable state, write-guard |

---

## 2. What each phase now does

### P9 — Rollout control plane (`/radiology/usg-rollout`, admin-only)
- **API** `/api/usg-admin`: `GET /readiness` (matrix of every phase: code / wired / enabled / validation / dependencies / blockers), `POST /flags/:key/enable|disable`, `POST /kill-switch`.
- **Server-enforced gates**: a flag can't be enabled while a dependency is OFF; a not-clinic-validated phase needs an explicit **force + reason acknowledgement** (audited). Kill-switch disables all USG flags at once.
- Persists to `feature_flags`; audits to `usg_audit_log`.

### P4 — Prior intelligence (workspace right-rail panel)
- **API** `/api/usg-prior`: comparable priors, structured current-vs-prior deltas + editable suggestions, pregnancy timeline.
- Reads real `radiology_studies` / `usg_measurements` / `patient_reports`.
- **Cross-patient comparison impossible** (SQL scope + matcher guard + explicit patient-id check → 403).
- Accepted suggestions append to the **current draft's impression only**.

### P5 — OB & Doppler (workspace OB/Doppler panel)
- **API** `/api/usg-ob-doppler`: `ob-section`, `doppler-section`, `form-f-status`.
- OB/Doppler sections built via the **one** obstetric engine; Doppler indices recomputed from source velocities.
- **No fetal sex** ever emitted; Form-F status is display-only; PCPNDT finalize gate unchanged (fail-closed).
- Parity vs legacy `FetalUsgLevel4` documented (`P5-OB-PARITY.md`) — **partial**, so the legacy `/fetal-usg` route stays.

### P3 — Exact provenance
- Additive, **fail-safe**, flag-gated step in `runUsgExtraction` ingests SR rows into `viewer_measurements`.
- Real SOP + frame; **frame is never fabricated** (NULL persisted, not the column default 1); idempotent re-ingest.

### P6 — Report → PACS return
- **API** `/api/usg-pacs-return`: eligibility, return (enqueue), status.
- Durable `USG_PACS_RETURN_JOB` (drained by the existing per-minute cron) **re-checks eligibility at execution time** and delegates to the canonical `archiveReportToPacs`.
- Drafts / superseded / PCPNDT-non-compliant reports are **never enqueued**; finalize path untouched.

### P7 — Cine key-frame capture
- **API** `/api/usg-cine`: describe clip, capture key-frame, list key-frames.
- Persists **DICOM references** (SOP + real selected frame) to `usg_key_images` — never blobs, never a fabricated frame, only for genuine multi-frame clips; idempotent.

### P8 — Advisory AI assistant
- **API** `/api/usg-ai`: suggest (honest hidden/unavailable states), accept.
- Reuses the canonical AI enablement (master flag + policies). Every suggestion validated through the safety core (**fetal-sex content dropped**, accept-only).
- **Accept is the only write path** — a forged non-draft target throws `AiWriteViolationError` → **403**. AI can never finalize/sign/write `patient_reports`.

---

## 3. Flags flipped to `wired: true` (still default OFF)

`ff_radiology_usg_exact_provenance` · `ff_radiology_usg_prior_intelligence` ·
`ff_radiology_usg_ob_canonical` · `ff_radiology_usg_doppler_canonical` ·
`ff_radiology_usg_report_to_pacs` · `ff_radiology_usg_cine` ·
`ff_radiology_usg_ai_assistant`

Still `wired: false` (documented reasons): `ff_radiology_usg_dicom_extraction`
(SR-primary swap pending), `ff_radiology_usg_pregnancy_timeline` (UI pending),
`ff_radiology_usg_ai_growth` (needs gateway), `ff_radiology_usg_sugandha_mode`
(pilot targeting pending).

---

## 4. Verification (this integration effort)

- **~90 new tests**, all green — real-Postgres integration tests for P4/P5/P6/P7 and fixture-backed tests for P3/P8.
- Full-workspace `pnpm typecheck` clean; `diagnostic-erp` frontend builds.
- Flag-registry validation + flag-source-scan green (no unregistered gated literal).
- Rebased/merge-conflict-resolved cleanly across the parallel PRs.

---

## 5. Guarantees held across every slice

- **No new tables** — every persistence target is a canonical existing table (`viewer_measurements`, `usg_measurements`, `usg_doppler_measurements`, `usg_key_images`, `radiology_pacs_archive_revisions`, `feature_flags`, `usg_audit_log`, `ai_*`).
- **Flags default OFF**; every new route **404s when its flag is OFF** (direct-API gated, not just the UI).
- **Cross-patient comparison impossible**; **no fetal sex**; **PCPNDT fail-closed**; **AI cannot finalize/sign/write `patient_reports`**.
- Critical finalize/extraction paths are untouched or only additively/fail-safe extended.

---

## 6. NOT done — needs live infrastructure + clinic validation

| Item | Needs |
|---|---|
| Actual Orthanc push + encapsulated-PDF validation (P6) | live Orthanc |
| Frame-level viewer navigation + cine playback (P3, P7) | live OHIF viewer |
| AI model generation + `ai_shadow_drafts`/`ai_evidence` persistence + growth notes (P8) | AI model gateway (`USG_AI_GATEWAY_URL`) |
| SR-primary extraction swap (P3 `dicom_extraction`) | live Orthanc / GE Voluson |
| Pregnancy-timeline UI (P4) | frontend (server route already wired/tested) |
| Sugandha pilot-user targeting + demo mode (P9/rollout) | product decision + config |
| **Clinic validation of every phase** | staging + real study data |

Exact steps for each are in **`USG_INTEGRATION_STATUS.md`** and
**`USG_CLINIC_CHECKLIST.md`** (enable order, per-phase validation, rollback drill).

---

## 7. Related docs

- `USG_INTEGRATION_STATUS.md` — live per-phase matrix (Core/API/UI/Persistence/Infra/Clinic/Flag).
- `USG_CLINIC_CHECKLIST.md` — executable staging/clinic validation steps.
- `P5-OB-PARITY.md` — OB parity vs legacy fetal-USG.
- `USG_COMPANION_MASTER_HANDOVER.md`, `P{3..9}-IMPLEMENTATION-REPORT.md` — the merged cores.

**Classification: VERTICAL INTEGRATION COMPLETE (P3–P9) — CLINIC VALIDATION PENDING. All flags OFF.**
