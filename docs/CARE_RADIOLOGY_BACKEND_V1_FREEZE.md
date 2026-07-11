# CARE Radiology Backend v1 — Freeze Contract (BEND-1)

**Status: FROZEN.** Backend feature development is closed. Only the changes
listed under *Allowed post-freeze changes* may modify the modules below until
an explicit Backend v2 decision.

## 1. Backend v1 capabilities

- **Structured report lifecycle (D1–D9)**: canonical D1 documents, catalog
  (B), materialization, D4 render, D5 sign (JCS `jcs-sha256/1` content hash,
  signature stamps), D6 structured read surfaces, D7 linear amendment chains
  (DB-enforced by `UNIQUE(original_report_id)` + `UNIQUE(amended_report_id)`),
  D8 version resolution (`resolveReportVersion` — the ONLY latest-revision
  authority), D9 verify/countersign + lifecycle metadata.
- **Workflow (M1.x)**: canonical workspace (M1.1), study launch (M1.2),
  reporting integration (M1.4), productivity workflow + ONE command
  dispatcher (M1.5), study locking with derived expiry (M1.6A), id-canonical
  assignment + workload (M1.6B1), voice layer over the dispatcher
  (M1.6B2/B3).
- **Operational closure (BEND-1)**: durable amendment re-delivery obligations
  (per revision × channel × recipient, masked recipients, latest-revision
  completion rule, auto-send default OFF), per-revision PACS archive state,
  durable job runner over `dicom_retry_queue` (idempotent enqueue, bounded
  retries, dead-letter, restart-safe claims), `/api/radiology-ops` health +
  consistency + safe repairs, wired audit-chain verification with legacy-
  recipe classification, restore-verification proof into throwaway
  databases, truthful startup/readiness state.

## 2. Authoritative modules / tables / routes

| Concern | Authoritative code | Tables |
|---|---|---|
| Report rows + signed JSON | `routes/patient-reports.ts` | `patient_reports` (signed doc inline in `structured_json`) |
| Amendment chain | `routes/patient-reports.ts` (amend), `lib/radiologyReportVersion.ts` (resolve) | `patient_report_amendments` |
| Drafts + D1 | `routes/radiology-report-generator.ts` | `radiology_report_drafts` (`structured_json_d1` canonical; `structured_json` = A4 cache) |
| Finding instances | dual-write in report-generator / amend snapshot | `report_finding_instances` |
| Locks / assignment | `lib/studyLock*`, `lib/studyAssignment*` | `radiology_worklist` lock/assignment columns |
| Re-delivery obligations | `lib/redeliveryRules.ts`, `lib/redeliveryObligations.ts` | `radiology_redelivery_obligations` |
| PACS archive | `lib/pacsArchive.ts` | `radiology_studies` (latest) + `radiology_pacs_archive_revisions` (per revision) |
| Durable jobs | `lib/radiologyJobRules.ts`, `lib/radiologyJobs.ts`, `lib/radiologyJobHandlers.ts` | `dicom_retry_queue` |
| Ops surface | `routes/radiology-ops.ts`, `lib/radiologyOpsHealth.ts`, `lib/radiologyConsistency.ts` | `radiology_ops_checks` |
| Audit chain | `lib/audit.ts` (write+verify), `lib/auditVerification.ts` (ops) | `audit_logs` |
| Restore proof | `lib/restoreVerification.ts` | `radiology_ops_checks` (`restore_verification`) |
| Startup truth | `lib/startupState.ts`, `/api/healthz` | — |
| Flags | `lib/radiologyFeatureFlagRegistry.ts` (registry), `lib/featureFlags.ts` (runtime) | `feature_flags` |

Routes: `/api/patient-reports/*`, `/api/radiology/*` (incl. `worklist-lock`,
`worklist-assignment`, `report-generator`), `/api/radiology-ops/*`,
`/api/ai/transcribe*` (voice), `/api/internal/backup/download`.

## 3. Allowed post-freeze changes

- Bug fix (with test).
- Security fix.
- Clinical-activation defect (found during go-live; smallest compatible fix).
- Performance fix **with measurement proof**.
- Backward-compatible provider integration (delivery/STT/PACS providers
  behind the existing interfaces — no new lifecycle semantics).

## 4. Prohibited without a Backend v2 decision

- Schema redesign (incl. converting bare-integer links to FKs wholesale).
- A second/competing report lifecycle or delivery pipeline.
- A new renderer (D4 render is the one text producer for structured reads).
- A duplicate catalog.
- ANY mutation of signed structured JSON (`patient_reports.structured_json`)
  or of clinical prose — amendments are the only forward path.
- Replacement of the locking (derived expiry) or assignment (id-canonical +
  name mirror) models.
- Rewriting historical audit rows or resealing a broken chain.

## 5. Feature-flag enable order (all default OFF)

`ff_radiology_structured_core` → `ff_radiology_catalog` →
`ff_radiology_structured_d1_draft` → `ff_radiology_structured_final` →
`ff_radiology_structured_read`; everything else (voice_structured,
render_v2, measurement_pool, classification, modality_expand, catalog_delta,
search_v2, hierarchy, presets, multiwindow, ai_assist, scale_partition) is
seeded-but-inert until its strand ships. `GET /api/radiology-ops/flags`
reports live state + dependency violations; the registry
(`radiologyFeatureFlagRegistry.ts`) is source-pinned against the code.

**Rollback order = reverse of enable order.** Disabling any flag stops new
writes on its path; existing rows stay readable (see per-flag rollback notes
in the registry).

## 6. Operational verification commands

```bash
# health (staff; masked topology unless admin)
GET /api/radiology-ops/health
# consistency (admin, read-only, persists a summary)
GET /api/radiology-ops/consistency
# audit chain (admin; {"mode":"full"} for genesis-to-tip)
POST /api/radiology-ops/audit-verify
# structured drift (admin; persists summary)
POST /api/radiology-ops/drift-scan
# restore proof (admin; durable job → radiology_ops_checks)
POST /api/radiology-ops/restore-verify
# job backlog / dead letters / manual drain
GET  /api/radiology-ops/jobs/dead-letter
POST /api/radiology-ops/jobs/tick
# re-delivery backlog + transitions
GET  /api/radiology-ops/obligations?status=pending
POST /api/radiology-ops/obligations/:id/(acknowledge|dismiss|queue)
# repairs — ALWAYS dry-run first, then confirmToken "REPAIR-<action>"
POST /api/radiology-ops/repair {"action":"release_stale_locks","dryRun":true}
```

Scheduled (with `ENABLE_SCHEDULERS=1`): radiology job tick every minute;
audit-chain window verification daily 04:15.

## 7. Known deferred items (accepted for v1)

- The two parallel delivery logs (`report_shares`, `report_delivery_logs`)
  are not unified; obligations key off `report_shares`.
- Docker's liveness `/health` stays process-only by design (no DB probe);
  readiness truth lives in `/api/healthz` + `/api/health/schema` +
  `/api/radiology-ops/health`.
- Bare-integer links stay (consistency checks watch them; FK retrofit is a
  v2 decision).
- Legacy-recipe audit rows (boot-time SQL backfill) verify by linkage only —
  explicitly classified, not re-sealable.
- Seeded-but-inert feature flags remain unwired until their strands ship.
- `.enc` restore verification requires `BACKUP_PASSPHRASE` in the server env.

**CARE RADIOLOGY BACKEND V1: FROZEN.**
