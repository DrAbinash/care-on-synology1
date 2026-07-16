# PR C — CARE USG Gold Standard, Complete Study Library & Canonical PCPNDT Migration Roadmap: Deliverables

Builds on PR B (USG Platform Consolidation, #88) and the two PCPNDT safety follow-ups (client-side guard in #88,
server-side guard in #91). This PR completes the USG platform's *clinical content* — it does not touch the
Reporting Workspace's engine, Copilot core, report lifecycle, or any patient report data.

## 1. Repository audit summary (Phase 1)

Verified directly against the merged HEAD (PR #88 + #91), not from prior audit documents alone:

- Canonical `RadiologyReportingWorkspace` is the only Reporting Workspace; USG is routed through it via
  `?modality=USG` exactly as PR B shipped.
- Client-side PCPNDT guard (`isPcpndtRelevantUsg` check in `finalizeReport()`) and server-side guards
  (`POST /api/patient-reports`, `POST /api/internal/radiology/report-status`) are both present and compose
  correctly with MRI PR 3/5's protocol-completeness/offline-guard work that landed on the same base branch.
- PR B's content pack (`migrations/zz_add_usg_platform_content_pack.sql`) had seeded 13 broad study tabs
  (Whole Abdomen, KUB, Pelvis, TVS, Obstetric, Growth, Anomaly, NT, Thyroid, Breast, Scrotum, Doppler,
  Soft Tissue) — a representative starter set, explicitly documented as non-exhaustive.
- 6 USG Copilot modules existed (Abdomen, KUB/Kidney-adjacent, Thyroid, Breast, Scrotum, and the PCPNDT guard
  module) before this PR; Fetal USG/Fetal Echo/legacy `UsgReporting.tsx` were confirmed untouched and still the
  PCPNDT-compliant pathway.
- No second Reporting Workspace, Copilot core, Smart Findings engine, Template/Protocol engine, or report
  lifecycle existed anywhere in the codebase — the delta audit found nothing to consolidate that PR B had missed.

## 2. `USG_GOLD_STANDARD.md` (Phase 2)

`docs/usg-reporting/USG_GOLD_STANDARD.md` is the new authoritative clinical content specification: 32 study
types across General, Gynaecology, Obstetric, Small Parts, and Doppler, each fully defined per the schema the
PR spec requested (purpose, section order, mandatory/optional sections, measurements + units + normal ranges,
normal template, Quick Findings, Clinical History chips, protocol, impression/recommendation/follow-up
philosophy, Copilot behaviour, Structured Finding Assistant logic, critical findings, print behaviour).

Authored via a two-stage (author → adversarial verify) multi-agent pass per clinical category, so every entry
was independently checked for clinical plausibility and internal consistency before being converted into the
migration below — not hand-written without review.

## 3. Complete Common USG Study Library (Phase 3)

| Category | Studies | Tabs |
|---|---|---|
| General | 6 | Whole Abdomen, KUB, Pelvis (TA/TV), Appendix, Hernia, Soft Tissue |
| Gynaecology | 5 | TVS, Follicular Study, Endometrium, Ovarian Lesions, Infertility |
| Obstetric | 9 | Early Pregnancy, Dating, Viability, NT, Anomaly, Growth, BPP, Cervical Length, Multiple Pregnancy |
| Small Parts | 5 | Thyroid, Breast, Scrotum, Neck, MSK |
| Doppler | 7 | Carotid, Venous, Arterial, Renal, Hepatic, Portal, Obstetric |

**Total: 32 studies.** Every study reuses the existing Templates/Protocol/Quick-Findings/Clinical-History-Chip/
Measurement/Copilot infrastructure — none of these tables or engines were duplicated or forked.

11 of the 32 study tabs already existed from PR B's starter set (Whole Abdomen, KUB, Pelvis, TVS, Anomaly,
Growth, NT, Thyroid, Breast, Scrotum, Soft Tissue); the remaining 21 are new tabs this PR adds.

## 4. Complete Structured Measurements (Phase 4)

`migrations/zzz_add_usg_gold_standard_content.sql` adds 134 rows to `radiology_quick_measurements` (the
existing measurement library table — first-ever USG rows in that table; PR B never populated it for USG) — no
hardcoded React content. Every measurement carries a label, unit, normal range (documented in the Gold Standard
doc; the DB table doesn't store normal-range prose, matching its existing schema), and a `{value}`-templated
Quick Measurement string.

**Correctness fix included:** `radiology_protocols.required_measurements` is consumed by
`RadiologyReportingWorkspace.tsx`'s `missingRequiredMeasurements` as a plain case-insensitive substring check
against the free-text Findings. PR B's 11 original USG protocols used snake_case tokens (e.g. `liver_span`)
that never literally appear in rendered Findings text (the Quick Measurement template renders `"Liver span:
135 mm."` — no underscore), so those checks could never clear. This PR's migration corrects
`required_measurements` on those 11 pre-existing rows via a targeted, idempotent `UPDATE` (only that one column
— technique/normal/recommendation text already shipped under PR B is untouched) to tokens derived directly from
the actual Quick Measurement templates, so the existing validation chain now genuinely works. See migration
§5b for the exact statements and rationale.

One further deliberate correction: PR B's `USG Pelvis (TA/TV)` protocol required uterus/endometrium/ovary
measurements unconditionally, which doesn't hold for a male pelvis/prostate study. The Gold Standard content
marks pelvis measurements as not-required (still available as one-click Quick Measurements) — `required_measurements`
for that protocol is now correctly empty rather than incorrectly female-specific.

## 5. Smart Findings (Phase 5) & Structured Finding Assistant (Phase 6)

Both are the same underlying mechanism (`radiology_quick_findings` rows, `questions_json` non-empty ⇒
Structured Finding Assistant) — no separate work was needed beyond the content-pack migration:

- 183 new Quick Findings rows across the 32 studies (gallstones, fatty liver grades, hydronephrosis grades,
  renal calculus, renal/hepatic cysts, ascites, fibroid, ovarian cysts, endometrial polyp, varicocele,
  hydrocele, thyroid nodule TI-RADS, breast lesion BI-RADS, DVT, carotid plaque/stenosis grading, and more).
- 100 of those are structured (`{key}`/`[optional clause]` + a `questions` array of `select`/`text`
  questions — no `number` type, matching the existing assistant's supported types), covering every study
  category (General, Gynaecology, Obstetric, Small Parts, Doppler).
- Verified live: all 100 structured rows and all 183 total findings inserted with zero collisions against
  PR B's existing content (see §8 idempotency verification).

## 6. Copilot Modules (Phase 7 — landed in the prior commit on this branch)

7 new modules (Kidney/KUB, Liver, Gall Bladder, Pelvis, TVS, Growth, Anomaly), each a plain plug-in via
`registerCopilotModule()`, bringing total USG-specific Copilot coverage to 13 modules. Zero changes to
`copilotOrchestrator.ts` or any Copilot core file.

## 7. Canonical PCPNDT Roadmap (Phase 8) & Configuration-Driven PCPNDT Design (Phase 9)

Both delivered as `docs/usg-reporting/pcpndt-canonical-roadmap.md` in the prior commit on this branch — no
PCPNDT implementation changes in this PR, per the spec. See that document for the full migration order,
dependencies, risk assessment, backward-compatibility plan, legacy retirement plan, and the `requiresPCPNDT`
configuration-driven design proposal (schema impact + migration strategy documented, not built).

## 8. Content Validation (Phase 10)

Audited for an existing validator before considering building anything new (`pnpm run validate:radiology-content`
→ `scripts/src/validate-radiology-content-packs.ts`). That script validates a **different, unrelated** YAML
content-pack import pipeline (`seeds/radiology/content-packs/v1`, gated behind `ff_radiology_catalog`) that is
not yet merged into any branch and is not what the Reporting Workspace reads from — running it correctly
reports "no packs found" and exits 0. It does not apply to the `radiology_quick_findings` / `radiology_protocols`
/ `radiology_quick_measurements` tables this PR's content lives in, so no changes were made there.

The actual, already-wired validation path for these tables is `missingRequiredMeasurements` (computed in
`RadiologyReportingWorkspace.tsx` from `activeProtocol.requiredMeasurements`), consumed by:

- `computeQualityScore` (`reportValidator.ts`) — live report quality score
- `computeFinalizeSafety` (`finalizeSafety.ts`) — pre-finalize safety checklist
- `copilotOrchestrator.ts` — Copilot's missing-measurement prompts

This chain requires **zero additional wiring** for any of the 32 new studies — it activates automatically
because it reads `radiology_protocols.required_measurements`, which this PR populates (and, for 11 pre-existing
protocols, corrects — see §4). No new validator was written; no duplicate validation engine was created.

Critical findings, impression completeness, and recommendation completeness are documented per-study in the
Gold Standard doc's `criticalFindings`/`impressionPhilosophy`/`recommendationPhilosophy` fields, and enforced
the same way existing USG/MRI content is: via Copilot module prompts (advisory) and the existing
`detectCriticalFindings` mechanism reading each study's Quick-Findings-driven Findings/Impression text — not a
new mechanism.

## 9. Testing (Phase 11)

- `artifacts/diagnostic-erp`: **723/723 tests passing** across 55 test files (`npx vitest run`), including all
  7 new Copilot module test suites, existing PCPNDT guard tests, and the full pre-existing MRI/CT/USG suite —
  no regressions.
- `artifacts/diagnostic-erp` typecheck: **0 errors** (`pnpm run typecheck`).
- Workspace-wide `typecheck:libs`: **0 errors** (`tsc --build`).
- Full workspace `vitest run` from repo root: **2021/2021 executed tests passing** across 139 passing test
  files. 7 test files fail to *load* (not to pass/fail individual tests) because their modules
  (`presentationTemplateStore`, `radiologyDeploymentDiagnostics`, `radiologyDiagnosticsRules`,
  `radiologyOpsHealth`, `reportPresentation`, `pacsEnterprise.launch`, `IciciPaymentProvider`)
  unconditionally require a live `DATABASE_URL` at import time — a pre-existing test-infrastructure
  limitation unrelated to USG/PCPNDT/radiology content, confirmed by the fact that none of those files touch
  radiology content, Copilot, or the Reporting Workspace.
- Migration verification against an ephemeral PostgreSQL 16 instance (`drizzle-kit push` for schema, then both
  `zz_add_usg_platform_content_pack.sql` and `zzz_add_usg_gold_standard_content.sql` applied twice):
  - Pass 1: 34 tabs, 98 clinical history chips, 190 quick findings (100 structured), 134 measurements, 34 USG
    protocols (21 inserted + 11 corrected).
  - Pass 2 (idempotency): **zero** net new rows from any `INSERT`; all 11 `UPDATE` statements are pure
    no-ops in effect (same value re-set) — fully safe to re-run.
  - Spot-checked `required_measurements` tokens against their corresponding `radiology_quick_measurements`
    templates to confirm the Phase 4 correctness fix actually works (e.g. "Liver span" now correctly matches
    the rendered "Liver span: 135 mm." Findings text).

### Coverage summary

| Area | Status |
|---|---|
| Templates / Protocol Engine | 32 studies, all live-DB verified |
| Clinical History Chips | 96 new + 2 pre-existing overlaps, live-DB verified |
| Measurements | 134 rows, live-DB verified, required-token correctness verified |
| Smart Findings | 183 rows (83 plain + 100 structured), live-DB verified |
| Structured Finding Assistant | 100 structured findings across all 5 categories |
| Copilot | 13 USG modules total, 53+ unit tests, 0 core changes |
| Printing | Unchanged — reuses existing report print pipeline; `printBehavior` documented per study |
| Study switching / Worklist / Sidebar | Unchanged from PR B — no new routes or nav entries needed |
| Permissions | Unchanged — same routes, same `requireStaffPermission` gates as PR B |
| Legacy routes (`/usg/reporting`, Fetal USG, Fetal Echo) | Confirmed still functional, still the PCPNDT-compliant path |
| Historical reports | Untouched — this PR only adds/corrects config-table rows, never touches `patient_reports`/`usg_reports` data |
| MRI/CT regression | 0 failures across the full MRI/CT test suite |
| PCPNDT protections | Both client- and server-side guards unchanged and re-verified composing correctly |

## 10. Files modified / added

New:
- `docs/usg-reporting/USG_GOLD_STANDARD.md`
- `docs/usg-reporting/usg-gold-standard-pr-c.md` (this document)
- `docs/usg-reporting/pcpndt-canonical-roadmap.md` (prior commit)
- `migrations/zzz_add_usg_gold_standard_content.sql`
- `artifacts/diagnostic-erp/src/lib/copilotUsg{Kidney,Liver,Gallbladder,Pelvis,Tvs,Growth,Anomaly}Module.ts` (+ `.test.ts` each, prior commit)

Modified:
- `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx` — 7 additional Copilot module
  side-effect imports only (prior commit); no changes in this commit.

## 11. Database changes

`migrations/zzz_add_usg_gold_standard_content.sql` — purely additive/corrective content, idempotent
(`ON CONFLICT ... DO NOTHING` for inserts; targeted `UPDATE ... WHERE name = ...` for the 11 pre-existing
protocol corrections). No new tables, no new columns, no schema changes. No `patient_reports`, `usg_reports`,
`radiology_worklist`, or Form F data is touched.

## 12. Known limitations

- The Gold Standard doc's normal ranges and clinical philosophy fields are reference/authoring guidance, not
  machine-enforced — same as PR B's existing content.
- `required_measurements` correctness (§4) is now fixed for all 32 studies, but the underlying mechanism is
  still a plain substring match, not a structured measurement-key binding — acceptable for now, consistent
  with the existing platform-wide pattern, and not something this PR's scope calls for redesigning.
- PCPNDT-relevant obstetric studies in this new content library (Early Pregnancy, Dating, Viability, Anomaly,
  Growth, NT, BPP, Cervical Length, Multiple Pregnancy, Obstetric Doppler) inherit the existing PCPNDT guards
  automatically via `isObstetricUsgStudy()` — no new gap was introduced, but full compliant finalize for these
  studies still requires migrating through the canonical roadmap (§7 / `pcpndt-canonical-roadmap.md`), not this PR.
- Doppler sub-studies (Carotid/Venous/Arterial/Renal/Hepatic/Portal/Obstetric) share one broad "Doppler"
  Copilot module from PR B; no per-vessel Doppler Copilot module was added in Phase 7 (out of the 7 modules
  requested) — flagged here rather than silently left uncovered.

## 13. Confirmations

- **No duplicate Reporting Workspace, Copilot engine, Smart Findings engine, Template engine, Protocol engine,
  measurement engine, or report lifecycle was created.** Every deliverable in this PR is either a config-table
  row (migration) or a Copilot plug-in module using the exact existing `registerCopilotModule()` contract.
- **MRI/CT reporting is unaffected.** Full MRI/CT test suite passes; the migration touches no MRI/CT rows.
- **Historical reports and legacy drafts are untouched.** No `patient_reports`/`usg_reports` row was read,
  written, or migrated by this PR.
- **PCPNDT protections are unchanged and re-verified composing correctly** with all content added in this PR.
