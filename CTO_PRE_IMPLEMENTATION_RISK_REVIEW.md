# CARE ERP — Final Pre-Implementation Architectural Risk Review

**Reviewer:** Office of the CTO / Principal Architect
**Date:** 2026-07-09
**Scope of judgement:** A radiology-reporting platform intended to serve hundreds of radiologists, 50+ hospitals, ~100M reports and ~10M structured findings over a 10-year horizon.
**Mandate:** Identify hidden architectural risks *before* implementation proceeds further. The approved architecture and roadmap are treated as **frozen** — this document proposes **no redesign and no roadmap changes**. It surfaces risk only.

---

## 0. Verdict

> ## 🔴 NOT READY — for the stated mandate ($50M-class, 10-year, multi-hospital, 100M-report platform).
> The gap is **architectural, not cosmetic**, and it is concentrated in exactly the places that are cheapest to fix now and near-impossible to fix after data accrues: **identity/tenancy, clinical-record integrity, structured-data modeling, and disaster recovery.**

Two **independently confirmed CRITICAL** defects would each, on their own, block go-live for a regulated medical-records system:

1. **The only automatic backup that actually runs truncates every table at 5,000 rows** yet records `status:'success', encrypted:true` with a SHA-256 checksum (`artifacts/api-server/src/cron.ts:133,185-193`). For a 100M-report system this captures ~0.005% of history while manufacturing false confidence. An operator who tests "Run now" sees a plausible file and is lulled.
2. **The audit hash-chain — the platform's primary tamper-evidence and medico-legal defense — forks under concurrency.** It performs an un-serialized *read-last-row → insert* with no transaction, no advisory lock, and a non-unique chain index (`artifacts/api-server/src/lib/audit.ts:59-64,85`; `lib/db/src/schema/auditLogs.ts:42`). The moment two users write at once, the chain becomes a tree and its integrity guarantee silently voids.

Neither is a corner case. Both are on the primary write paths of a production hospital system.

### An honesty note on scope
The **current** deployment is a **single on-prem clinic** (Deoghar, on a Synology NAS), and the roadmap **explicitly defers multi-tenancy.** Several "50-hospital" failure claims were therefore *downgraded* during verification — today there is one site, so today there is no collision. That nuance **cuts against the mandate, not for it:** the schema is being laid down now (`serial int4` PKs, zero tenant key, global namespaces, single-box topology) on foundations that the stated 50-hospital / offline / cloud future **directly contradicts.** The risk is not that the current clinic breaks; it is that every foundational decision is being frozen in a shape that the target scale cannot inherit without a re-key of the entire schema.

---

## 1. How this review was conducted (and why you can trust it)

This was not a read-through. The codebase is large (**320 `pgTable` definitions across 113 schema files; a prior internal audit counted 305 tables, 71 FK constraints, 43 JSONB columns, 37 text-typed date fields**). The review fanned out one grounded reader per mandated dimension over the **real schema, migrations, API routes, and deployment scripts**, then ran an **adversarial verification pass**: every HIGH/CRITICAL finding was handed to a second reviewer whose job was to *refute* it against the actual code.

- **75 findings raised; 42 survived adversarial verification at HIGH/CRITICAL.**
- The verification pass **corrected or downgraded** several claims (e.g., a "50-hospital collision today" claim downgraded because there is one site; some cited file paths corrected from `lib/` to `artifacts/api-server/src/`). Survivors are cited to **verified `file:line`.**
- Findings already documented in the repo's own `DATABASE_RISK_MATRIX.md` are marked **[known]**; the rest are **hidden** — risks that table-level audit missed because they are *systemic*.

Every claim below reproduces against the tree at review time. Where a reviewer could not refute a claim, it is stated plainly.

---

## 2. The five cross-cutting architectural themes

These recur across every dimension. They are the real subject of this review; the per-area findings are symptoms.

| # | Theme | One-line statement |
|---|-------|--------------------|
| **T1** | **Identity & tenancy are foreclosed at the schema layer** | 319 `serial int4` PKs, **no `branch_id`/`tenant_id`/`hospital_id` on any core table**, day-scoped per-DB business keys (accession/report numbers via `MAX(seq)+1`), single global counters. Every consolidation, offline merge, or cloud sync collides on identity. |
| **T2** | **Prose-and-opaque-JSON instead of data** | Findings/measurements live as free text, comma-in-column CSV, or un-indexed `jsonb` across 12+ measurement and 8+ finding/report stores, with **zero coded vocabulary** (no LOINC/SNOMED/RadLex/UCUM) and no GIN index. The "10M queryable structured findings" asset does not exist in queryable form. |
| **T3** | **Single-box operational model with no scaling or recovery path** | One un-replicated Postgres, one API container, a `pg` pool defaulting to **10 connections**, no read replica/pooler/sharding, no partitioning on 100M-row tables, no WAL/PITR, a silently-truncating backup, a cross-cloud backup source, and DR runbooks that cannot execute as written. |
| **T4** | **Immutability & tamper-evidence as theater** | The hash machinery guards throwaway *drafts* while the **delivered signed report is overwriteable text** with no hash/version; the audit chain forks under concurrency and is app-only (no DB `REVOKE`/trigger); RBAC action-bits and feature-flags the rollout depends on are dead code or `localStorage`. |
| **T5** | **No single source of truth anywhere** | Four schema-mutation paths, drift-on-restore, ~90 radiology reporting/template tables with 3–8 competing representations of one concept, 4+ report stores, 3–4 divergent amendment chains, duplicate stacks (2 TAT trackers, 5 audit logs). Every feature adds an (N+1)th near-duplicate instead of extending a canonical entity. |

---

## 3. The two blocking CRITICALs (expanded)

### CRIT-1 — The automatic backup is a false-green data-loss trap
`artifacts/api-server/src/cron.ts`

- `cron.ts:133` — the scheduled exporter runs `SELECT * FROM <table> LIMIT 5000` **with no `ORDER BY`** → an arbitrary 5,000 rows per table, not even the most recent.
- `cron.ts:124-129` — the table set is **hardcoded** (CONFIG=4, DB=6, FULL=10 tables); the FULL set **omits `patient_reports`**.
- `cron.ts:138-193` — stamps a SHA-256 checksum and writes `status:'success', encrypted:true`; failure email (`cron.ts:219`) only fires in the `catch`, so a truncated-but-"successful" run is **silent**.
- The *manual* path uses a real `pg_dump` — so a spot-check looks fine, which is precisely what makes this dangerous.

**Impact:** Severe. **Probability:** High (it runs daily). Every day deferred is another irrecoverable window of clinical and financial history that the system *believes* is backed up.

### CRIT-2 — The audit hash-chain forks under concurrency (and is re-sealable)
`artifacts/api-server/src/lib/audit.ts`, `lib/db/src/schema/auditLogs.ts`

- `audit.ts:59-64` reads the last row's `chainHash`; `audit.ts:85` inserts a new row in a **separate statement** — **no `db.transaction`, no `pg_advisory_lock`, no `SELECT … FOR UPDATE`**. Concurrent writers read the same `previousHash` and fork the chain into a tree.
- `auditLogs.ts:42` — `audit_chain_hash_idx` is **non-unique**; nothing enforces linearity at the DB.
- Immutability is **app-only** — there is no `REVOKE UPDATE/DELETE` and no `BEFORE` trigger, so anyone with DB access can rewrite rows, and the documented **boot-time blank-hash backfill re-seals** a tampered chain.
- **Notably, the codebase already uses `pg_advisory_lock` elsewhere** (`patients.ts`, day-close). The audit writer conspicuously omits the very pattern that would make it correct.

**Impact:** Severe. **Probability:** Very High under any real concurrency. The tamper-evidence the platform will rely on in a medico-legal dispute is not sound.

---

## 4. Detailed findings by mandated review area

Severity shown is the **post-verification** severity. `[known]` = also in the internal risk matrix; otherwise the finding is a **hidden** systemic risk.

### 4.1 Database schema
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| HIGH | **Every PK is `serial int4`; no tenant/site discriminator on core tables.** The 50-hospital / offline→cloud future is mathematically unbuildable without a full ID re-key. | 319 `serial().primaryKey()`; `grep bigserial` = 0; no `uuid` PK; the only `site_id` is on the teleradiology worklist (`radiology.ts:275`), 1 of 123 files. | High / Severe |
| HIGH | **Referential integrity is absent across the clinical spine, and the FKs that *do* exist cascade-delete clinical + audit records.** | Only **74 `.references()`** calls in 21 files; `dicomStudies.ts`, `radiology.ts`, `patientReports.ts` have **zero** FKs. Staff financial cascade **[known]**. | High / High |
| MED | **"Structured findings" are prose + opaque JSON snapshots + CSV-in-column** — not queryable. | `radiologySmartFindings.ts:21` `selections jsonb` is a per-report snapshot; actual finding is free-text `generatedFindings/Impression`; `radiologyQuickFindings.ts:44-48` `tags/suggests/properties` are comma-lists. | High / High |
| — | **No table partitioning anywhere**; `clinic_settings` god table (80+ cols) **[known]**; JSON-as-`text` vs `jsonb` used inconsistently. | `grep "PARTITION BY"` → none. | — |

### 4.2 Migration strategy
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| MED | **Deploy *is* release: full-stack teardown on a single box, no feature flags, no expand/contract, no zero-downtime path.** | `deploy-synology.sh:61-65` `docker compose down` → `up -d --build` ("3-5 minutes"); `care-db-patch-v2` mutates schema inside the outage window; feature-flag grep → 0 real hits. | Very High / High |
| MED | **Migration order is an alphabetical filename sort, not a dependency graph.** | `docker/db-patch-entrypoint.sh:335` `ls …/*.sql | sort`. Rename↔reconcile stranding is real. | High / High |
| — | **Forward-only, no automatic rollback; schema defined in three places** (Drizzle SQL + `migrations/*.sql` + inline shell patches). | `HOW_TO_ADD_DB_MIGRATIONS.md:193` "There are no automatic rollbacks. Forward-only migrations only." `add_performance_indexes.sql` exists but is **not wired** — a live example of the failure mode. | — |

### 4.3 Structured reporting
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| HIGH | **No canonical finding/measurement object model** — 12+ parallel measurement tables, 8+ finding/report stores, divergent value types for the same quantity. | `usgMeasurements.ts:27` `bpd` is `text` while `:56` `rightKidneyLengthMm` is `real` **in the same row**. | Very High / Severe |
| MED | **Structured selections have no link to the report** — the final report is a one-way prose copy with no provenance. | `radiologySmartFindings.ts:13-37` has no `reportId/studyId`; save route pastes generated text as free text. | High / High |
| MED | **No standardized clinical terminology** — zero LOINC/SNOMED/RadLex/BI-RADS; name-based soft refs everywhere. | exhaustive grep for `loinc|snomed|radlex|conceptCode` → 1 hit, and it's a *comment* (`usgExtractor.ts:465`). | High / High |
| MED | **Five parallel template families, two incompatible versioning schemes** — and the templates that drive the render pipeline are the **unversioned** ones. | `report_templates`, `structured_report_templates`, `radiology_structured_templates`, `ai_normal_report_templates` (no version) vs `radiology_master_templates` (`version:int`, `isLocked`). | High / Medium |
| LOW | **Render pipeline is non-reproducible** — impression rules & templates mutate in place; generated findings snapshot no rule/template version. | `PATCH /impression-rules` overwrites `conditions`/`generatedText` in place; no `*_versions` history table. | High / Severe |

### 4.4 Quick Select
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| MED | **No modality dimension** — MRI-specific sentences insert for *any* modality on the same body region; fixing it forces a combinatorial tab explosion the flat tab bar can't hold. | `radiologyQuickFindings.ts:30-59` has `study_type` but no `modality`; seed text is MRI-specific (`add_radiology_quick_findings.sql:54-56` T2/FLAIR, diffusion restriction, GRE/SWI blooming). | High / High |
| LOW | **Search ships the entire global catalog to every client and filters in-memory with `.includes()`** — no server-side search, FTS, trigram, or pagination. | `routes/radiologyQuickFindings.ts:36-51` has no `WHERE`/`LIMIT`; `QuickFindingsPanel.tsx:129-133` fetch-then-filter. | High / High |
| LOW | **Name/CSV soft-references with no integrity** — renaming a tab silently orphans its buttons **[known]**. | `studyType text` (not FK); `DELETE /tabs` does not cascade to `radiology_quick_findings.study_type`. | High / Medium |

### 4.5 Viewer integration (OHIF / Weasis / internal)
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| MED | **The OHIF/Weasis "measurement import bridge" has no producer** — every measurement is re-typed by hand and the safety net built on it is inert. | The only insert into `viewer_measurements` is the manual `POST` route (`radiologyLesions.ts:495`); **no client calls it.** | Very High / High |
| MED | **No canonical measurement entity** — 5+ disjoint text stores joined by lowercased label strings; **OCR, not DICOM SR, is the primary automated source.** | `radiology_measurements.value:text`, `viewer_measurements.value:text`, `lesion_timeline.measurementMm:real`, `usg_measurements.source` default `'ocr'`. | Very High / High |
| MED | **Viewer launch is fire-and-forget `window.open`** — no viewer↔report reconciliation, no server-side "who viewed which images" audit; launch ground-truth lives in `localStorage`. | `viewerService.ts:357`; `recordSuccessfulLaunch` persists to `localStorage` only. | High / High |
| LOW | **PACS/viewer routing is one global KV table with hardcoded single-clinic IPs** — cannot serve 50 LANs. | `pacsSettings.ts:5-13` no `branch_id`; hardcoded `172.16.1.139`/`192.168.1.137`/`caredeoghar.com` in `viewerService.ts:66-69,495-496`. | High / Severe |

### 4.6 AI subsystem
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| HIGH | **AI-authored text is indistinguishable from radiologist text in the stored signed report** — zero segment-level provenance. | `POST /insert-to-report` (`aiReporting.ts:1193-1210`) only flips `status='inserted'`/`wasInsertedToReport=true`; no marker is written into the report body. | High / Severe |
| MED | **No AI sentence is pinned to an immutable (prompt-version + model-version + input) tuple** — reproducibility is structurally impossible. | `aiReportingDraftsTable` stores `provider/model/promptText` only — no template id/version, no model hash. | High / Severe |
| MED | **AI audit trail is best-effort (errors swallowed) and sits *outside* the tamper-evident chain.** | `db.insert(aiReportingAuditLogsTable)…​.catch(()=>{})` at `aiReporting.ts:597,797,855,935,1077`; response returns even if the audit write throws. | High / High |
| MED | **Vision-model image inputs are never persisted (only a count) and are non-deterministically selected.** | `aiReporting.ts:210-211` picks `instances[floor(len/2)]` on an unsorted list; `:229-236` lossy 512px resize. | High / High |
| — | **Genuine positives:** AI never auto-signs (`aiReporting.ts` "AI must NEVER auto-sign"); `ai_extraction_results` carries `isAiSuggested` + human review workflow. The *posture* is right; the *record* is not. | — | — |

### 4.7 Performance at scale
See §5 for the quantified projection. Confirmed bottlenecks:
| Sev | Finding | Evidence |
|-----|---------|----------|
| **CRITICAL** | **Global audit chain = hospital-wide serialization point** (or, if left racy, meaningless). | `audit.ts:59-101` (see CRIT-2). |
| HIGH | **One `pg` pool, `max` unset (default 10), into one un-replicated Postgres** — a ceiling ~2 orders of magnitude below 1000 concurrent users. | `lib/db/src/index.ts:13` `new Pool({connectionString})` no `max`. |
| HIGH | **All primary search is `ILIKE '%term%'` with no `pg_trgm`/GIN/FTS** — the "performance" btree indexes cannot serve these queries (false coverage). | `patients.ts:88-91`, `patient-reports.ts:182-188`. |
| MED | **`serial int4` on the highest-churn append-only tables overflows within 10 years** (audit/usage logs, cap 2.147B). | `auditLogs.ts:19`, `radiologySmartFindings.ts:93,115`, `dicomStudies.ts:120`. |
| MED | **10M "structured findings" are un-indexed `jsonb` + prose** — cross-study analytics are full scans. | `radiologySmartFindings.ts:21,30-36` all btree; `grep "USING gin"` → none. |

### 4.8 Security
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| HIGH | **Signed report integrity is absent.** `radiology_studies.final_report` is overwriteable `text` with no version/hash/audit; a `radiology_typist` can rewrite a signed report. | `radiology.ts:56`; report fragmentation across `patient_reports.body`, `teleradiology_assignments.final_report`, `usg_report_drafts`. | High / Severe |
| HIGH | **Granular RBAC (`canFinalize`/`canApprove`) is dead code** — only `canView` is ever read; finalize sits behind a coarse `/radiology` path gate. | `rolePermissions.ts:21-30` defines bits; `portal.ts:481-495` reads only `canView`; grep finds no `canFinalize` enforcement. | High / High |
| HIGH | **Report authorship is a client-supplied string** — "who signed" is forgeable. | `peerReview.ts:85`. | High / Severe |
| HIGH | **All session/share/report bearer tokens are stored in plaintext** — any DB dump/backup is a master key to live sessions and PHI. | `portalSessions.ts:7` plaintext `token`; validated by equality (`requireStaffAuth.ts:55`). | Medium / Severe |
| HIGH | **"Feature flags" the rollout depends on are per-browser `localStorage` toggles** — no server store, tenant scope, audit, or governance. | `artifacts/diagnostic-erp/src/lib/staffSession.ts`. | Very High / Medium |

### 4.9 Disaster Recovery
| Sev | Finding | Evidence | Prob / Impact |
|-----|---------|----------|---------------|
| **CRITICAL** | **Row-capped "successful" backup** (see CRIT-1). | `cron.ts:133,124-129,185-193`. | High / Severe |
| HIGH | **The committed daily backup pulls a dump from a remote Replit cloud URL — a *different database* than the on-prem NAS — and the restore script clobbers local data with it.** | `scripts/synology-backup.sh:26` `API_BASE="https://caredeoghar.replit.app"`; `internal-backup.ts:42-45`. | High / Severe |
| HIGH | **DR runbooks contain commands that cannot work as written** — wrong volume name, incompatible restore format. | `docker-compose.yml:367-370` volume `care_main_db_data` vs runbook `docker volume rm caredeoghar_db_data`; `pg_restore` on a `psql`-format dump. | High / High |
| HIGH | **A half-applied migration is recorded as success** (`ON_ERROR_STOP=0` + `|| true`); schema-verify is non-blocking — contradicting the entrypoint's own "schema mismatch is impossible" guarantee, with no blue/green to roll back. | `db-patch-entrypoint.sh:297-299` vs the strict helper at `:110-113`. | High / High |
| MED | **Restoring a backup silently reverts the schema** because the migration ledger lives *inside* the backed-up volume; the 27k-line `zz_schema_reconcile` file is an unscalable recurring scar. | `db-patch-entrypoint.sh:210-231,285-351`; `HOW_TO_ADD_DB_MIGRATIONS.md:157-183`. | Very High / Severe |
| — | **Single Synology NAS is a SPOF** for web+API+Postgres+Orthanc+OHIF+Conquest; backups on the same box, unencrypted; **no automated restore verification** **[known]**. | `DISASTER_RECOVERY_BUSINESS_CONTINUITY_AUDIT.md:72-74`. | — |

### 4.10 Future evolution
| Capability | Verdict | Why |
|-----------|---------|-----|
| **Multi-tenant hospitals** | 🔴 **Redesign** | No tenant key on any core table; `serial` PKs + global business keys collide across sites. |
| **Offline / mobile reporting** | 🔴 **Redesign** | `sync_queue` maps `localId→cloudId` **integers** with a coarse `server_wins/local_wins/merge` string — FK references embedded in payloads corrupt on merge. |
| **Cloud deployment** | 🟠 **Major work** | Single-box Synology assumptions, hardcoded LAN IPs, one un-replicated Postgres, no shard key. |
| **DICOM SR / FHIR / HL7 export** | 🟠 **Lossy-by-construction** | Export paths are **inert queue stubs** (`smartRadiology.ts:700-724`); incoming SR concept codes are discarded; findings are prose, so any encoder is lossy. |
| **AI measurements** | 🟠 **Blocked on the data model** | Measurements fragmented across ≥5 incompatible free-text tables with no coded, provenance-bearing entity. |

### 4.X Cross-cutting
| Sev | Finding | Evidence |
|-----|---------|----------|
| HIGH | **378 tests; zero cover the legally/clinically critical report-lifecycle paths.** | 30 test files, 378 `it()/test()` cases; grep over tests: `finalReport`→0, `immutab`→0, hash-chain→0, `critical-find`→0, `amend`→0, Form-F→0. |
| — | **Documentation & subsystem sprawl** as a governance smell: 60+ overlapping audit docs, many `backup_*` dirs, `__super_admin_quarantine`, ~90 radiology reporting/template tables solving overlapping problems, duplicate stacks (2 TAT trackers, "5 audit logs"). | repo root inventory. |

---

## 5. Performance at the stated scale — quantified

**Assume 100M reports, 10M structured findings, 1000 concurrent users, 50 hospitals.**

| Pressure point | Behavior at scale | Root cause |
|----------------|-------------------|------------|
| **Every audited write** (finalize, print, refund, login…) | Serializes on the single global chain tail — a hospital-wide bottleneck — *or* stays racy and produces an invalid chain. There is no middle state. | Global linear hash-chain, no per-tenant/per-day sub-chains (§CRIT-2). |
| **1000 concurrent users** | Hard wall at ~10 DB connections; requests queue and time out long before the DB is the limit. | `pg` pool `max` unset → default 10, single un-replicated instance. |
| **Patient / report search** | Leading-wildcard `ILIKE '%term%'` = sequential scans on 100M rows; the added btree indexes don't apply. | No `pg_trgm`/GIN/FTS. |
| **`audit_logs`, usage logs** | `int4` PK exhausts at 2.147B rows within the 10-year window → **every insert hard-fails**; converting a live multi-billion-row table to `bigint` is an `ACCESS EXCLUSIVE` rewrite (hours of downtime on NAS I/O). | `serial` on highest-churn tables. |
| **Cross-study analytics / AI export** | Full scans over un-indexed `jsonb` + prose; the "10M queryable findings" cannot be queried as data. | No canonical coded finding entity, no GIN. |
| **100M-row tables generally** | No partitioning → vacuum/index-maintenance/bloat pain, slow restores, and no shard key to add horizontal scale later. | No partitioning, no tenant/shard key. |

---

## 6. What is genuinely sound (credit where due)

A fair review names the good bones — they are why remediation is *tractable*, not a rewrite:

- **AI safety posture is correct in intent:** AI never auto-signs; `ai_extraction_results.isAiSuggested` + a `pending→accepted/rejected/modified` human-review workflow; a dedicated AI audit table.
- **Tamper-evidence was *attempted*** (hash chain) and the **correct primitive already exists in-tree** (`pg_advisory_lock` in `patients.ts`/day-close) — the fix is to apply it, not invent it.
- **Forethought stubs exist** for the future: `dicom_sr_export_queue`, `hl7Schema`, `sync_queue`, `hanging_protocols`, a `branches` table, `report_template_versions`. The scaffolding shows the right destinations were anticipated.
- **Financial module is comparatively strong** (numeric money types, `bill_audits`, idempotency work) — the internal matrix scored it 90/100.
- **Idempotent migrations never hard-fail a deploy** — operationally forgiving, even though it trades away schema determinism.

The problem is not the intent. It is that the **load-bearing guarantees (integrity, identity, recoverability) are asserted but not enforced**, and they are being frozen into the schema now.

---

## 7. FINAL SECTION

### 7.1 The five architectural decisions most likely to become technical debt in 5 years

| # | Decision | Why it matters | Probability | Impact | Future migration cost if ignored |
|---|----------|----------------|-------------|--------|----------------------------------|
| **D1** | **`serial int4` PKs everywhere, no tenant/branch discriminator, per-DB `MAX(seq)+1` business keys.** | Silently forecloses every multi-site, offline, and cloud-sync future the platform is sized for. Two boxes both mint patient #5001 / `ACC-20260709-CT-001`; because FKs are mostly undeclared and links are text soft-keys, **no tool can even enumerate what to rewrite** during a merge. Also caps append-only logs at 2.147B rows. | **Very High** | **Severe** | **12–24 eng-months.** Widen every PK/FK to `bigint`/`uuid` (`ACCESS EXCLUSIVE` rewrites), build a per-table `localId→cloudId` remap over 100M rows (incl. CSV-in-column ids and text soft-keys), reconcile now-non-unique MRNs/accession numbers — with no down-migration under the git-checkout rollback model. |
| **D2** | **Findings/measurements as prose / CSV / un-indexed `jsonb`, no canonical entity, no coded vocabulary.** | The queryable-findings corpus is the platform's headline asset and it is illusory at the data layer. Cross-study analytics, AI training export, quality surveillance, and conformant DICOM-SR/HL7/FHIR all need typed values + coded concepts — the code even **discards incoming SR concept codes**. | **Very High** | **High** | **12–36 eng-months, partially unrecoverable.** A canonical coded-observation model + NLP re-extraction + text→numeric coercion over 100M historical reports whose structure was never captured; every rule/report/export reader migrates in lockstep with live AI readers. |
| **D3** | **Single global, linear, unpartitioned audit hash-chain as the sole tamper-evidence control.** | A linear chain can't be partitioned/sharded without breaking ordering → simultaneously a **throughput ceiling** and **un-legal-holdable** (can't export/hold/delete one hospital's trail without breaking global integrity). Its `int4` PK on the highest-churn table is the first plausible overflow, after which swallowed errors stop the compliance trail silently. | **High** | **High** | **6–18 eng-months, high risk.** Convert a live 1–2B-row heap to per-tenant/per-day sub-chains + `bigint` + partitioning → re-hash/re-link history or accept a chain discontinuity a regulator may reject; rewrite verification semantics and every call site. |
| **D4** | **Report content & versioning fragmented across 4+ divergent stores** with inconsistent immutability and 3–4 incompatible amendment chains. | "What is the authoritative signed report and its full history" has **no single answer** — it depends on which store the report flowed through (two enforce immutability, two overwrite in place). An addendum in one store is invisible to consumers of another. This is direct medico-legal discovery/amendment exposure across a 10-year record. | **High** | **High** | **9–18 eng-months, high risk.** Consolidate 4+ stores and 3–4 amendment chains into one immutable versioned document model → migrating live finalized clinical documents (the highest-risk migration class) after 100M reports exist. |
| **D5** | **Four independent schema-mutation paths** (Drizzle journal, in-process boot migrations, hand-written idempotent SQL ordered by filename, a 27k-line reconcile) with the ledger living *inside* the backed-up volume. | There is **no canonical definition of the schema** — its shape is an emergent property of execution order. Restoring any backup reverts the schema while the ledger swears it's current (the documented drift scar). Across independent on-prem boxes, **no two production DBs are provably identical**; a half-applied migration is recorded as success and never retried. | **Very High** | **High** | **9–24 eng-months.** Collapse to one fail-closed migration authority with schema-fingerprint tracking, then reconcile 50 independently-drifted live DBs you cannot all reach at once — plus recurring bespoke incident cost every deferred month. |

### 7.2 The five design decisions to change TODAY (cheap now, brutal later)

These are the *pre-data* decisions. They are recommendations for risk closure — **not** roadmap or architecture changes — surfaced because their cost curve is near-vertical the moment real data accrues.

| # | Change to make before more data/code accrues | Why it matters | Probability | Impact | Cost now vs later |
|---|----------------------------------------------|----------------|-------------|--------|-------------------|
| **C1** | **Choose the identity strategy now:** `bigint` identity PK/FK, a nullable `tenant_id`/`branch_id` on every core table, and globally-unique business keys (UUID or site-prefixed/composite) instead of `MAX(seq)+1`. | Adding a defaulted column + choosing a key strategy is a near-free schema edit today (single migration, no reference backfill). Deferred, it is the single largest latent cost in the platform and blocks multi-site/offline/sync permanently. | **Very High** | **Severe** | **Days now** vs **12–24 eng-months** later (table rewrites under `ACCESS EXCLUSIVE`, 100M-row id remap, MRN/accession uniqueness reconciliation). |
| **C2** | **Define ONE canonical finding/measurement entity** — typed numeric value + coded concept (LOINC/SNOMED/RadLex) + coded unit (UCUM) + method + confidence + model/prompt provenance — and route all 12+ tables through it **before findings are written as prose.** | The controlled-vocabulary + typed-value model is the one choice that makes the entire 10-year data asset (analytics, AI training, SR/FHIR/HL7 export, RECIST/growth trending) possible, and it is cheap only while the corpus is empty. | **Very High** | **Severe** | **A schema design now** vs **12–36 eng-months and permanent lossiness** later (NLP re-extraction over 100M prose reports, competing with live readers). |
| **C3** | **Make report finalization safe on the write path:** one immutable, versioned, content-hashed signed-report record; **server-side authorship bound to the authenticated session** (not a client `radiologistId`); and a real finalize/approve gate using the **already-defined** `canFinalize`/`canApprove` bits. | Today `final_report` is overwriteable text a typist can rewrite with no version/hash/audit, and "who signed" is a forgeable string — the core evidentiary property of a medical record is absent. Wiring immutability + authorship + the dead RBAC bits is bounded now; retrofitting can never prove historical reports intact retroactively. | **High** | **Severe** | **Weeks–2 months now** vs **8–16 eng-months + a permanent pre-fix integrity gap** later. |
| **C4** | **Make the audit chain concurrency-correct and DB-enforced before it grows:** serialize the read-then-insert with the `pg_advisory_lock` **already used elsewhere in the codebase** (or a DB sequence/trigger), add DB-level append-only enforcement (`REVOKE UPDATE/DELETE` or a `BEFORE` trigger), ship a real verification endpoint, and size the PK `bigint`. | The tamper-evidence guarantee is worthless until this is fixed, and every row written before the fix is unprovable. The correct primitive is already in-tree; this is a localized change to one helper. | **High** | **High** | **Days now** vs **4–8 eng-months + a permanent trust gap** later (re-hashing billions of rows without breaking legal continuity). |
| **C5** | **Replace the row-capped scheduled backup with a true streaming `pg_dump`/WAL pipeline**, fix restore tooling to target the actual on-prem DB (correct user/db/port/volume and dump format), and **declare a single backup source of truth** (stop pulling from the remote Replit cloud DB). | This is a confirmed CRITICAL producing **false-green backups today**; the documented restore either fails on wrong defaults or clobbers on-prem clinical data with a stale cloud snapshot. Every day deferred is another irrecoverable window of history. | **High** | **Severe** | **1–3 eng-months now** vs **discovering post-disaster that years of "successful" backups are unusable** and DR runbooks never worked. |

---

## 8. Bottom line for the approval decision

The architecture is **not** production-ready for the mandated scale, and — critically — **the two blocking CRITICALs (CRIT-1 backup, CRIT-2 audit chain) plus the signed-report integrity gap are live risks in the *current single-clinic* deployment, independent of the 50-hospital ambition.** They should be treated as pre-production blockers regardless of the tenancy timeline.

The remaining risks (identity, canonical finding model, report consolidation, migration authority) are **inexpensive to shape correctly *before* data and code accrue** and **ruinously expensive after** — precisely the class of decision a pre-implementation review exists to catch. None of the five "change-today" recommendations requires redesigning the approved architecture or altering the roadmap; each is a foundational choice that is currently being made *implicitly and by default*, and is far cheaper to make deliberately now.

If the mandate's 50-hospital / offline / cloud premise is real, the identity and data-model decisions (C1, C2) are the ones I would not let a single additional production table be created without resolving.

---

*Prepared as a read-only pre-implementation risk review. No source code was modified. Findings were fanned out per dimension over the live tree and adversarially verified against `file:line`; claims that could not be independently reproduced were dropped or downgraded.*
