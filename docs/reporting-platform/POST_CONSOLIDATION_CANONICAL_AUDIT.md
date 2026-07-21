# POST-CONSOLIDATION CANONICAL AUDIT — CARE Radiology Reporting Platform

**Read-only integration audit at HEAD** (`5ac7e795`, post PR #112). Adversarial,
evidence-based, verified against the current tree — not against prior audit
assumptions. No code was changed; this document is the only artifact.

---

## 1. Executive verdict

**READY AFTER TARGETED FIXES.**

The last several days of work produced a **real** canonical platform, not the
appearance of one: one workspace serves all four modalities, one engine exists
per concern (mechanically re-verified at HEAD — all contract invariants pass
after every parallel merge), clinical behaviour is data in versioned
registries, and the two most recent parallel workstreams (Universal Measurement
Platform, Quality Phase 4) integrated **through** the frozen contracts rather
than around them — the strongest possible evidence that the architecture holds
under concurrent development.

What keeps the verdict at "after targeted fixes" rather than "coherent and
ready": one **open, documented PHI exposure** (public booking — predates this
work, still unfixed at HEAD), a small set of real integration seams
(recommendation registry is label-based, not canonical-measurement-ID-based;
one legacy USG finalize path still parallel; one workspace state leak), a
self-inflicted N+1 on the new coverage endpoint, and the honest fact that the
contract suite is structural rather than behavioural. None of these are
architectural; all are enumerated with exact remediation order in §19.

## 2. Canonical-system diagram

```
Worklist / Study Launch (?modality=&accession=)
        │
        ▼
ONE RadiologyReportingWorkspace ── Voice · Palette · Print · Finalize
        │  matchStudyRegion (most-specific wins — verified: CT/XR dispatch correct)
        ▼
ONE Knowledge Pack engine (89 packs; validatePack/packCoverage/stats/coverage)
        │ activates / keys
        ├─ Templates (structured_report_templates)          ── ONE
        ├─ Protocols (radiology_protocols)                  ── ONE
        ├─ History chips / Quick+Structured findings        ── ONE
        ├─ Universal Measurement Catalog (@workspace/measurements,
        │    canonical meas.* ids + aliases + units + ranges) ── ONE (new)
        ├─ Quality Engine (lib/report-quality: text tier live,
        │    Phase-3 structured + Phase-4 measurement rules, SHADOW) ── ONE
        ├─ Clinical Recommendation Registry (53 entries)    ── ONE
        ├─ Companion (one panel, US+CT gate)                ── ONE
        ├─ Copilot (one orchestrator + module registry)     ── ONE
        └─ Comparison (radiologyComparison)                 ── ONE
```

Every box re-verified singular at HEAD by the contract suite's invariants
(offline run: **ALL PASS**).

## 3. End-to-end workflow maps

**MRI Brain** — worklist → `?modality=MRI` → one workspace → region `Brain`
(resolver, longest-match; unaffected regression-wise, verified) → base MRI pack
(registry stub `{}` by design; content is table-driven) → master template +
protocol + chips + quick findings (`studyType="Brain"`) → viewer bridge
(`useViewerMeasurements`, now canonical-ID-resolving via `@workspace/
measurements` in `copilotMeasurementModule`/`radiologyComparison`) → Copilot
(modules incl. registry recommendations) → comparison → text-tier quality badge
+ shadow structured/measurement tiers → draft autosave (+401 rescue) → finalize
(`finalizeSafety`) → canonical server print artifact → amendment lifecycle.
**No MRI-specific fork found.**

**USG Whole Abdomen** — same workspace; Voluson/DICOM pipeline → extracted
measurements → `UsgMeasurementReviewPanel` (correctly USG-only: SR/OCR/
PCPNDT) → Companion assembly + auto-populate plan + provenance ledger →
`companionCopilot` context → PCPNDT: client guard on finalize (obstetric-only,
`:5266`-era check, present) + backend guards in `usgReports.ts` / `form-f.ts` /
`patient-reports.ts` (verified present). **Two lifecycles exist here** — the
canonical workspace path and the legacy `usgReports.ts` draft path with its own
`/:id/finalize` and an admin-gated, reason+confirm `finalize-force` — see §10.

**CT Brain** — `?modality=CT` → region `CT Brain Plain` (most-specific wins —
the #104 fix, still correct at HEAD) → `ct.brain_plain` pack (rich manifest) →
CT protocol/findings/measurements → **shared** Companion (`companionEligible`)
→ shared Copilot (CT impression rules) → shadow quality tiers → same
finalize/print. **No CT engine anywhere** (invariant scan clean).

**Chest X-Ray** — region `X-Ray Chest PA` beats generic `Chest` (verified in
resolver matrix) → XR pack with `notApplicableSections:["measurements"]`
honesty → CTR quick measurement optional → registry `rec.xr.chest.ctr-correlation`
→ same lifecycle. Descriptive-study handling correct.

Failure/degradation points found: Companion inside `ModuleErrorBoundary`
(safe); pack assembly failures degrade to empty coverage (logged, safe); the
one **silent-degradation** class found is label-matching fallbacks (§6).

## 4. Reuse vs duplication matrix

| Concern | Canonical | Parallel systems found | Classification |
|---|---|---|---|
| Workspace | `RadiologyReportingWorkspace` | `UsgReporting`, `UsgDopplerReporting`, `RadiologyLegacy`, `RadiologyReportEditor` | legacy-but-required (routed, deprecated-labeled, pinned by `canonicalWorkspaceRouting.test.ts`) |
| Report lifecycle | draft→finalize→amend (report-generator/patient-reports) | `usgReports.ts` finalize + finalize-force | **legacy but still required**; guarded; retirement candidate after traffic telemetry |
| Print/PDF | canonical server print artifact | legacy page printers (bill-print unrelated) | intentional single path for reports |
| Measurement identity | `@workspace/measurements` catalog | label/key matching in older layers (§6) | **intentional adapter phase** — canonical for new edges, aliases bridge old |
| Quality | `lib/report-quality` | ~10 legacy validators incl. D1 `validator.ts`, `usgQualityCheck`, `reportValidator` (wrapped) | wrapped/shadowed/dormant per migration plan — **unsafe to retire yet** (by design) |
| Recommendations | `clinicalRecommendations.ts` | KP manifest `recommendations` strings; derived legacy follow-up DB | manifest strings = pack data (activation, not logic); follow-up DB = **intentional adapter** (derived, single source) |
| Copilot | one orchestrator | none | — |
| Companion | one panel | none (USG-branding cosmetic) | — |
| Comparison / Template / Protocol / Findings | one each | none | — |
| Admin model | modality-parameterised pages | none duplicated | — |

## 5. Knowledge Pack integration findings

Packs are **not** mere labels: `packCoverage()` joins live content by
`studyType`/`builderType`/`bodyPart`/`knowledgeCategory`; manifests drive
Companion rules, Copilot activation hints, comparison measurements, critical
findings, recommendations; `resolvePackMeasurements()` (new) resolves manifest
`comparisonMeasurements` strings through the canonical catalog. Verified
genuine connections for all four modalities.

Findings:
- **KP-1 (info)** MRI/USG base packs are `{}` stubs — documented, intentional,
  but they make "pack = source of truth" true only for CT/XR today.
- **KP-2 (info)** ~28 placeholder packs; several already content-rich
  (`pack.placeholder-rich` — the Content Validator now flags exactly this).
- **KP-3 (warn)** `manifest.copilotModules` values are file names, not registry
  ids; never consumed at runtime (scorer counts length only). Harmless, but a
  manifest field that *looks* load-bearing and isn't — normalize the data or
  document. (Known since #104 audit; still true.)
- **KP-4 (ok)** No runtime system found that bypasses packs to hardcode
  modality clinical logic (grep for modality-fork engine patterns: clean).

## 6. Measurement-platform integration (the central new seam)

**Verdict: canonical for new data / new edges — not yet canonical end-to-end.**

Canonical-ID consumers at HEAD (verified imports): comparison engine,
copilot measurement module, viewer measurements panel, USG companion (server),
knowledge-pack manifest resolution, lesions route, Quality **Phase 4**
(rules *generated from* the catalog — one rule per measurement with a range;
`measurementRangeRuleId`), Measurement Registry Manager (+ its `/validation`
endpoint with unresolved-alias and orphan detection).

Still label/alias/key-matched (the honest gap list):
- **M-1 (warn)** **Clinical Recommendation Registry triggers match display
  labels** (`"Stone size"`, `"CBD diameter"`), not `meas.*` ids. Fallback label
  matching can silently miss a renamed label (silent false-negative, never a
  wrong-concept firing — labels are exact-match). Migration path: add
  `canonicalMeasurementIds` to triggers, resolve via the catalog, keep labels
  as aliases. Data-shaped fix.
- **M-2 (warn)** Phase-3 structured quality rules key on measurement keys/
  labels in `params` (predates the catalog). Phase 4 supersedes the range
  checks from the registry; Phase-3 rules should progressively reference ids.
- **M-3 (info)** Protocol `required_measurements` remains a substring check
  against rendered text (works, but is the loosest identity edge; known CT
  token-alignment backlog).
- **M-4 (info)** Historical measurement rows (usg_measurements etc.) carry no
  canonical ids — expected; the registry's impact index resolves live labels
  and reports `unresolvedLabels` instead of guessing. Correct honesty.

No conflicting units or duplicate aliases detected by the registry's own
validation at audit time (endpoint logic verified; live run requires DB).

## 7. Quality Engine migration status

Verified at HEAD: provider engine · stable hierarchical ids + `Q001–Q115`
aliases · categories/dependsOn metadata · canonical DTO · append-only
evaluations + normalized findings + override history (migrations 0008/0009) ·
engine/rule/pack versioning · runtime timing · deterministic/heuristic tiers ·
`notEvaluated` honesty · blockingEligibility=false everywhere · **no finalize
integration yet** (by explicit decision).

```
Legacy quality systems:  10   (reportValidator wrapped; D1 dormant; others live-but-separate)
Wrapped:                  1   Shadowed tiers: text(live badge)+structured(P3)+measurement(P4)
Canonical layer:          1   Safe to retire now: 0 (parity-in-prod not yet evidenced)
Migration:            ~20%    Finalize gate: NOT enabled (deterministic-only plan stands)
```

Findings:
- **Q-1 (warn)** `REPORT_QUALITY_ENGINE_VERSION = "0.5.0-phase3"` while Phase-4
  measurement rules shipped (`MEASUREMENT_RULE_SET_VERSION="4.0.0"`).
  Version-drift in persisted evaluations' `engineVersion`. One-line data fix.
- **Q-2 (ok)** No double evaluation found (single-eval weight scorer intact);
  no heuristic blocker (none blocking-eligible at all); shadow isolation
  re-verified (0 structured rules on the global engine).
- **Q-3 (info)** Legacy validators (checklistEngine, missedFindingDetector,
  smartRadiology, usgQualityCheck) still emit their own advice UI-side —
  scheduled Phases 5+; currently *separate truths* by design, not conflict
  (different surfaces).
- **Q-4 (warn)** Dashboards: quality dashboards still read legacy tables;
  canonical evaluations are persisted but not yet surfaced anywhere — inverse
  of "dashboards reading legacy instead of canonical", same net effect.

## 8. Recommendation-registry integration status

**The registry is the canonical source, with one intentional adapter.**
Follow-up DB is *derived* (`legacyFollowUpDatabase()`), consumers unchanged;
Copilot module + Companion questions + admin manager all consume the registry;
hygiene (dupes/conflicts/orphans/enums/versions) re-verified clean at HEAD
(offline run: ALL PASS). KP manifest `recommendations` strings remain **pack
data** (activation phrases), not a second logic source.

Findings: **R-1 (warn)** = M-1 (label-based triggers). **R-2 (info)**
registry entries' consumption is advisory-only (correct per constitution);
"entries never consumed" cannot be measured without acceptance telemetry
(known gap). **R-3 (info)** USG copilot modules (thyroid/liver/etc.) embed
clinical advisory text in code — predate the registry; they are deterministic
module logic, not follow-up recommendations, but are the next migration
candidates if centralization should be total.

## 9. Workspace state & data integrity

`resetWorkspaceState()` verified to reset: report fields, findings map,
quick selections + instances, structured values/dialog, AI copilot items +
cache, companion ledger, `copilotDismissed`, selected prior, critical flag +
note, communication checklist. Autosave has dirty-tracking + 401 rescue +
offline awareness; finalize blocked during stale save via status checks.

Findings:
- **W-1 (bug, low-med)** `dismissedCoPilotIds` (the deterministic text-Copilot
  dismissal set, line ~1652) is **not** cleared in `resetWorkspaceState()` —
  dismissals leak across studies within a session (same-id suggestions stay
  hidden on the next study). One-line fix candidate.
- **W-2 (ok)** Region change after delayed responses: content queries key on
  resolved region/study; React Query cache keys include identifiers — no
  wrong-study pack content observed in code paths.
- **W-3 (info)** Multi-tab/concurrent-radiologist locking relies on study
  status + draft ownership; no hard lock service. Existing behaviour, not a
  regression; document as operational limitation.

## 10. Routing & lifecycle

Canonical: draft → autosave → finalize (`finalizeReport` → report-generator
draft finalize / patient-reports persistence) → print artifact → amendment.
Legacy adapters clearly separated (deprecated pages route to preserved
components; `canonicalWorkspaceRouting.test.ts` pins them).

Findings:
- **L-1 (warn)** `usgReports.ts` keeps a parallel legacy finalize
  (`/:id/finalize`) plus **`/finalize-force`** — the force path is
  admin/super_admin-only, requires reason (≥3 chars) + `confirm:true`, only on
  verified drafts. Guarded and auditable, but it is a second signing path;
  classify **legacy-but-required**, retire after zero-traffic evidence.
- **L-2 (ok)** No route-order shadowing found (`/coverage` before `/:packId`
  verified; stats likewise). No duplicate finalize transactions in canonical
  path.
- **L-3 (PCPNDT)** Client guard (obstetric USG finalize) + backend guards
  (usgReports/form-f/patient-reports) both present; direct-API bypass
  resistance rests on the backend guards — present for the legacy path;
  canonical patient-reports path carries pcpndt hooks (verified grep). Fetal
  USG limitation: guards are obstetric-scope only, by regulation design.

## 11. Admin & operational surfaces

All admin pages permission-gated (`AdminOnlySettings` client-side +
`requireStaffAuth`/`requireAdminRole` server-side on measurement-registry;
pack routes admin-guarded; recommendation manager read-only **by design** —
labeled as such, not pretending to edit). System-pack `is_system` delete/
import-overwrite protections verified. Coverage/Validator dashboards linked
from the Cockpit.

Findings: **A-1 (info)** dashboard numbers: coverage dashboard computes
client-side from `/coverage` while the Cockpit gauge uses `/stats` — same
underlying helpers, but *weights* differ (clinical score ≠ readiness%);
labeled, acceptable, worth one sentence in the UI. **A-2 (info)** destructive
pack import has `force` + system guards; measurement-registry is read-only —
no destructive edit found without impact analysis.

## 12. Contract-test truthfulness

Classification of `platform-contract.test.ts` assertions:

| Kind | Count (approx) | Examples |
|---|---|---|
| Pure-function behavioural | ~20 | resolver matrix, negative contracts, perf timing |
| Data/registry integration | ~10 | 89-pack parse, manifest known-keys, semver, pack-rule presence |
| Structural (single-engine invariants, per-modality twins) | ~15 | exactly-one scans, forbidden-identifier scan |
| Source-string heuristic | ~17×4 | capability anchors in the one workspace + no `modality===` fork |
| Documentation-only | 0 | — |

Honest assessment: the source-string anchors prove *wiring exists in the one
file that serves all modalities* and that no fork exists — they do **not**
prove the workspace opens, content resolves from a live DB, Companion/Copilot
initialize, print renders, or finalize commits. Those are covered indirectly
(existing focused unit suites + deploy-time typecheck) but not end-to-end.
**False confidence risk: moderate and now explicitly labeled.** Minimum real
contract tests still required (recommendation, not implemented here):
1) one DB-backed test per modality: seed migrations → `/coverage` → assert
pack sections non-empty; 2) one Playwright smoke per modality: open workspace
→ apply template/protocol → save draft → print-preview 200 → finalize on a
test study; 3) one canonical-vs-legacy finalize parity check for USG.

## 13. Documentation vs implementation drift

- **D-1 (warn)** Handbook/freeze say Quality is "Phases 0–3, shadow" and
  engine version says `phase3` — **Phase 4 merged** (measurement rules). Docs
  + version constant need a dated addendum, not a rewrite (additive, contract
  respected).
- **D-2 (info)** Freeze scores/coverage snapshots (89 packs, 53 rec entries)
  now drift as content lands — docs correctly label numbers "live via
  dashboards"; keep snapshots dated.
- **D-3 (ok)** `HOW_TO_ADD_NEW_MODALITY`, manifest key list, constitution:
  verified still true at HEAD (measurement platform added **no** manifest key —
  it resolved existing strings; contract respected).
- **D-4 (info)** Older root-level docs (`RADIOLOGY_V2_STATUS`, master design
  specs, some `docs/archive`) describe superseded states — mark historical.
- **D-5 (warn)** `SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE.md` says
  "Status: Open. Not fixed." — accurate, which is the problem (§15).

## 14. Dead / dormant / legacy inventory

| System | State | Retire? |
|---|---|---|
| D1 structured-report layer (`structuredReport/validator.ts`, R0–R18) | dormant, zero consumers | Keep (Phase-8 target). Safe to leave. |
| YAML content-pack pipeline (`seeds/radiology/content-packs/v1`) | dormant, zero TS consumers | Keep or archive; document as unused. |
| Legacy USG pages/routes (`UsgReporting`, `UsgDopplerReporting`, `RadiologyLegacy`, `RadiologyReportEditor`) | reachable, deprecated-labeled, pinned by routing test | Retire after zero-traffic telemetry; not before. |
| Legacy USG lifecycle (`usgReports.ts` finalize/force) | live parallel path, guarded | Same telemetry gate as above. |
| Legacy quality tables (`report_quality_checks`/`gates`) + 9 legacy validators | live/wrapped/shadowed per plan | **Unsafe to retire** until prod parity (planned Phases 5+). |
| Old follow-up DB shape | adapter (derived from registry) | Retire consumers at leisure; zero risk. |
| Old architecture docs | historical | Mark as such. |
| Duplicate critical-results paths / voice stacks / report assemblers | **none found** (one of each verified) | — |

## 15. Security / compliance / medico-legal (ranked separately)

- **S-1 (HIGH, open, pre-existing)** Public booking `my-bookings`/`my-reports`
  expose PHI to anyone knowing a phone number — documented open finding at
  HEAD, unauthenticated by design gap. **This is the single most important
  item in this audit.** Not caused by the platform work; must be scheduled
  regardless.
- **S-2 (ok)** Report/quality/pack/measurement routes staff- or admin-gated
  (verified mounts); print/preview paths keyed by draft/report id under staff
  auth.
- **S-3 (ok)** Signing authority: finalize requires roles; force path
  admin+reason+confirm; amendments append-only; overrides append-only with
  actor/reason/timestamp.
- **S-4 (info)** AI usage is advisory-only with provenance (`why`), no silent
  writes (constitution holds in code); prompt-injection surface limited to
  advisory text rendering — sanitization worth a dedicated pass alongside
  stored-XSS review of free-text report rendering in print/HTML (not audited
  line-by-line here; flagged for the S-1 security sprint).
- **S-5 (info)** PHI in logs: server logs warn-level objects (`{ err }`) —
  spot checks clean, full log audit out of scope.

## 16. Performance & scale

Current volume: no user-visible problems expected; per-keystroke Copilot/
quality work is debounced; registries are O(tens) lookups; bundle grows only
by lazy-loaded admin pages.

Findings:
- **P-1 (warn, self-inflicted)** `GET /knowledge-packs/coverage` runs
  `packCoverage` per pack sequentially — **11 count queries × ~89 packs ≈
  ~1,000 sequential queries per dashboard load** (admin-only, but heavy).
  `/stats` shares the shape at ~⅔ scale (enabled-only). Fix: batched
  `GROUP BY study_type` counts (one query per table) or short-TTL cache. At
  10 hospitals/100s of packs this becomes mandatory.
- **P-2 (info)** Append-only `report_quality_evaluations` growth at 10M
  reports: fine with the existing indexes; needs retention/archival policy
  statement before Phase-6 dashboards.
- **P-3 (info)** Workspace file size (5.8k lines) is a maintainability, not
  runtime, cost; render hot paths are memoized.
- **P-4 (ok)** 1,000 rules: provider model + data-driven definitions scale;
  Phase-4 generation from the catalog demonstrates the pattern.

## 17. Clinical usability (radiologist-lens)

Strengths: one keyboard-reachable workspace (palette, F-keys, voice), one-click
normal templates + protocol normals, quick-findings + structured assistant,
Companion auto-populate with provenance, prior comparison inline, print parity.

Top friction (classified; **none require a new engine**):
1. Copilot dismissal leak (W-1) — *bug fix*
2. CT/XR quick-findings breadth (20 CT tabs empty) — *content*
3. `required_measurements` tokens that can't clear — *content*
4. Warning fatigue risk when structured tiers surface (future gate) — *configuration* (severity thresholds per deployment)
5. Recommendation `insertText` phrasing uniformity — *content*
6. Companion USG branding on CT studies — *UX polish*
7. Normal-study fast path (one keystroke "all-normal + finalize") — *UX polish*
8. Combined-study flow (already has combinations; surface in palette) — *configuration*
9. Urgent-finding path: critical toggle + comms checklist good; add palette verb — *UX polish*
10. Heatmap/dashboard links inside workspace for admins — *UX polish*
11–20: measurement one-click insert discoverability, prior-selection default
to latest same-region, template chips ordering by usage, chips for common
histories per referrer, voice grammar for measurements, palette fuzzy study
jump (exists — publicize), reduce right-tab count for XR (config), teaching-
case save shortcut, per-user weight presets on coverage page, keyboard nav in
validator/coverage tables — *content/config/polish respectively*.

## 18. Top 25 issues (ranked)

| # | Issue | Axis | Sev |
|---|---|---|---|
| 1 | S-1 public-booking PHI exposure (open, documented) | security/compliance | HIGH |
| 2 | L-1 parallel legacy USG finalize (+force) | data integrity | MED |
| 3 | Q-4 canonical evaluations persisted but unsurfaced; dashboards read legacy | data integrity | MED |
| 4 | M-1/R-1 recommendation triggers label-based (silent false-negatives on rename) | patient safety (miss-risk) | MED |
| 5 | W-1 `dismissedCoPilotIds` leaks across studies | daily workflow | MED |
| 6 | P-1 `/coverage` N+1 (~1k queries) | performance | MED |
| 7 | Q-1 engine version string stale (phase3 while P4 ships) | data integrity (audit trail) | MED |
| 8 | Contract-suite behavioural gap (no DB/browser smoke) | architectural risk | MED |
| 9 | D-1 docs say Phases 0–3; Phase 4 merged | documentation | LOW-MED |
| 10 | M-2 Phase-3 rules label/key-based vs catalog | architecture | LOW-MED |
| 11 | KP-3 manifest `copilotModules` file-name values (unconsumed) | data hygiene | LOW |
| 12 | CT quick-findings breadth (20/26 tabs empty) | clinical readiness | LOW-MED (content) |
| 13 | CT `required_measurements` token alignment | clinical workflow | LOW (content) |
| 14 | Placeholder-rich packs not promoted (validator flags) | content ops | LOW |
| 15 | M-3 protocol substring identity edge | architecture | LOW |
| 16 | W-3 no hard concurrent-edit lock (status-based only) | data integrity | LOW (existing) |
| 17 | Recommendation/override telemetry absent (dashboards partial) | ops visibility | LOW |
| 18 | S-4 XSS/prompt-injection pass on rendered advisory/report HTML | security | LOW-MED (audit task) |
| 19 | P-2 evaluations retention policy unstated | scale | LOW |
| 20 | A-1 two "readiness" numbers (score vs readiness%) labeled but confusable | ops UX | LOW |
| 21 | D-4 historical docs unmarked | documentation | LOW |
| 22 | R-3 USG copilot modules embed advisory text in code | centralization | LOW |
| 23 | Legacy USG pages reachable (intentional) — needs traffic telemetry to retire | debt | LOW |
| 24 | YAML/D1 dormant systems undocumented as unused in handbook inventory | documentation | LOW |
| 25 | Workspace file size (mechanical split someday) | maintainability | LOW |

## 19. Exact remediation order

1. **S-1** — dedicated security fix (OTP-or-token gate on public booking
   reads). Independent of platform.
2. **Q-1 + D-1** — bump engine version, add Phase-4 addendum to handbook/freeze
   (one commit, restores audit-trail accuracy).
3. **W-1** — add `setDismissedCoPilotIds(new Set())` to `resetWorkspaceState`.
4. **P-1** — batch `/coverage`+`/stats` counts (GROUP BY per table) or cache.
5. **M-1/R-1** — additive `canonicalMeasurementIds` on recommendation triggers,
   resolved via `@workspace/measurements`; labels stay as aliases.
6. **Contract smoke tier (Audit-12 rec)** — 4 DB-backed + 4 Playwright smokes.
7. **Q-4** — surface canonical evaluations on the quality dashboard
   (read-only), begin dashboard cutover per migration plan.
8. **L-1** — instrument legacy USG finalize traffic; retire when zero.
9. Content backlog (12/13/14) per the coverage dashboard's own priority list.
10. M-2/M-3/R-3/KP-3 as scheduled hygiene inside Phases 5+.

## 20. What must NOT be changed

The one-workspace/one-engine invariants; the frozen Platform Contract v1
surfaces; shadow-first quality discipline (no finalize gate before prod
parity); PCPNDT guards; append-only persistence; `is_system` pack guards;
legacy USG pages until telemetry proves them dead; the constitution.

## 21. What can now be safely frozen

The measurement catalog contract (id/alias/unit/range shape) — it survived
Phase-4 generation and manifest resolution untouched; the pack manifest key
set; the recommendation entry contract (with the additive M-1 field noted);
the contract-suite invariant list.

## 22. What remains canonical in aspiration only

- Measurement identity **end-to-end** (canonical for new edges; label-bridged
  at recommendations, Phase-3 params, protocol substrings, historical rows).
- Quality Engine as the **single** quality truth (still 1-of-11 until Phases
  5+ cut legacy surfaces over).
- "Every recommendation from the registry" at the *module* level (USG copilot
  modules still embed advisory text in code).
- Behavioural contract proof (structural suite + unit tests today).

## 23. Final scores

| Axis | Score |
|---|---|
| Architecture | 4.8 / 5 |
| Canonical integration (runtime truth) | 4.2 / 5 |
| Clinical readiness | 4.2 / 5 (content-bound, not platform-bound) |
| Data integrity | 4.3 / 5 |
| Security | 3.4 / 5 (S-1 dominates; platform surfaces themselves 4.5) |
| Performance | 4.3 / 5 (P-1 fixable in a day) |
| Maintainability | 4.4 / 5 |
| Modality scalability | 5 / 5 (proven twice: CT, X-Ray; measurement platform integrated through contracts) |

## 24. Final verdict

**READY AFTER TARGETED FIXES.**

The platform is genuinely canonical — one workspace, one engine per concern,
registries that are consumed at runtime rather than decorative, parallel
workstreams that landed through the frozen contracts, and invariants that
mechanically still hold at HEAD. The remaining work is a short, ordered list
(§19) dominated by one pre-existing security fix, two one-line corrections,
one query batch, one additive identity migration, and a behavioural test tier
— none of which require new architecture. The freeze holds.
