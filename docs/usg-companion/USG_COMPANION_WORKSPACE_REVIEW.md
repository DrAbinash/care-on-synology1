# USG Companion Workspace — Architecture & Workflow Review

> **Status:** Architecture & workflow review — *no code changed.* Grounded in a
> read-only audit of the ultrasound, measurement, finding-engine, reporting, AI,
> PCPNDT and prior-study subsystems.
>
> **Scope:** A dedicated, one-screen ultrasound reporting surface built for live
> scanning — where measuring, acquiring, observing and reporting happen at once —
> delivered as a **tenant of the existing canonical platform, not a parallel
> system.**

---

## 00 · The reframe that makes this safe

Your instinct is right: **the MRI/CT sequential model is wrong for ultrasound.**
In CT/MR the study is already acquired and archived; the radiologist reads a
fixed dataset top-to-bottom. In ultrasound the sonologist *is* the scanner —
measurements, image capture, observation and dictation all happen in the same
minute, organ by organ. The UI must mirror that.

But the audit surfaced a hard constraint we must design *with*, not against.
The platform carries binding decisions (decision register
`CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md` D-01/D-19, and
`R2_0_CANONICAL_ULTRASOUND_IMPLEMENTATION.md`): **one canonical reporting
workspace, one engine, one finalize contract — no new report page, no parallel
systems.** A deterministic "CARE Reporting Companion" already exists *inside*
the workspace and is the reference implementation for a planned 12-organ
"Companion" framework where *"a Companion is a tenant of the workspace, never a
copy of it."*

### Resolution — these are the same instruction

These are not in conflict. You said it exactly: *"This is NOT a separate
backend. Reuse the existing backend architecture. Only the workflow and UI
should be redesigned."* So we build a **dedicated USG-first workspace shell** —
a new route and layout that **composes existing components and writes to the
canonical `radiology_report_drafts` → `patient_reports` lifecycle.** Dedicated
in experience; a tenant in architecture. Zero new backend, zero parallel
reporting engine, PCPNDT gate untouched.

| Metric | Reading |
|---|---|
| **~24 clicks** | to report a normal-ish abdomen today, with 2+ forced tab-switches away from the report while inserting measurements. |
| **3 forks** | parallel USG report surfaces exist now: the canonical workspace *plus* standalone `UsgReporting`, `UsgDopplerReporting`, and a full obstetric fork `FetalUsgLevel4`. |
| **~60%** | of the "Dynamic Finding Builder" already exists — engine, auto-calc formulas, and an authored organ library — just not wired together or seeded. |
| **0 new** | reporting engines, draft stores, auth/lock/audit/PCPNDT systems. All reused verbatim. |

---

## 01 · Complete ultrasound audit

Findings from a four-track read of the ecosystem: the reporting UI & live
workflow, the measurement/viewer/provenance stack, the structured-finding
engine & organ content, and the canonical reporting core / AI / PCPNDT /
prior-study / cross-cutting reuse / prior design docs.

### 1.1 · Today's ultrasound is fragmented across parallel surfaces

| Surface | What it is | Status | Disposition |
|---|---|---|---|
| `RadiologyReportingWorkspace.tsx` | The canonical 3-panel workspace; hosts USG behind `isUltrasound`/`companionEligible` branches | canonical | The base the USG shell composes |
| `UsgCompanionPanel.tsx` | "CARE Reporting Companion" — readiness ring, deterministic Auto-Populate + provenance ledger, live checklist, suggestions, comparison | built | Elevate to the centerpiece |
| `UsgMeasurementReviewPanel.tsx` | Chrome-less, prop-driven per-field measurement review/approve/insert/pin/trace | built | Make co-visible, not tab-hidden |
| `ObDashboardStrip.tsx` | Obstetric biometry chip strip (GA/EDD/BPD…), insert-summary | read-only | Add write-back |
| `UsgReporting.tsx` | A *second* full report drafter (own quick-findings, macros, finalize, PDF); route alive but de-linked from nav | **fork** | Absorb → retire route |
| `UsgDopplerReporting.tsx` | Standalone Doppler CRUD (manual vessel entry, own PDF) | **fork** | Fold into the workspace Doppler organ |
| `FetalUsgLevel4.tsx` | Full obstetric reporting tool: own tabs, state, save/review/final-sign `/api/fetal-usg/*`, own PDF | **fork** | Fold OB into the shell as an organ mode (biggest win) |
| `UsgKeyImagesGallery` · `UsgMeasurementReview` | Two more separate key-image / measurement surfaces | duplicate | Unify into the shell's image rail |

Obstetric biometry can be typed **three times** — in `FetalUsgLevel4`,
re-summarised into the workspace Findings, and again reviewed into Form F.
Doppler is entered in three unrelated places. This duplication is the core
problem the shell removes.

### 1.2 · The live-workflow friction (evidence-based)

- **Measurements are hidden behind a tab.** The measurement review lives in the
  right sidebar's "Measure" tab (1 of 11 tabs), so the sonologist must switch
  away from the Findings editor to review/insert — they can never see
  measurements and the report body at once.
- **Insertion is one field at a time.** No "insert all approved"; a
  whole-abdomen row is many single clicks. Extraction is a manual *Re-Extract*
  batch pull — nothing streams during the scan.
- **Findings is one flat text blob.** Applying a USG template *overwrites*
  `rawFindings` — multi-region reporting (abdomen + KUB + pelvis + Doppler in
  one pass) fights a single field with no per-organ structure.
- **Big panels stack above the editor.** The Companion and OB strip render above
  Findings inside a scroll container, pushing the field being typed below the
  fold; fixed 45/42 split with a 5-row tab header eats vertical space.
- **Corrections don't round-trip.** OB chip edits are display-only — a value
  fixed during review isn't written back to `fetal_usg_measurements`.

### 1.3 · What already exists that we reuse (the good news)

- **Deterministic finding engine** — `structuredFindings.ts` +
  `StructuredFindingDialog.tsx` turn parameters → report text + impression, with
  conflict groups, optional-clause grammar, one-click normals. No AI, unit-tested.
- **Every auto-calc formula** — `usgMeasurementEngine.ts` (ellipsoid volume, RI,
  GA) + `obstetricCalculations.ts` (EFW, GA, EDD, AFI, PI, S/D, CPR) — pure &
  tested. Not yet wired to the builder.
- **An authored organ library** — `seeds/…/usg_abdomen.yaml`, `usg_kub.yaml`,
  `doppler_ll.yaml`, `_shared_libraries.yaml` + 13 organ skeletons in
  `usgReportTemplates.ts`. Authored, but only Brain/Spine seed at runtime.
- **Prior-study intelligence** — `radiologyComparison.ts` (canonical-id diff,
  interval change) + the whole obstetric growth/timeline stack in
  `pregnancyDashboard.ts`.
- **Canonical lifecycle** — `radiologyReportLifecycle.ts` →
  `radiology_report_drafts` / `patient_reports`, two-step verify/finalize,
  delivery. The one contract to write into.
- **Shared platform** — Auth, study-lock, hash-chained audit, voice dictation,
  command palette, worklist hook, PCPNDT gate — all already fire for USG (a USG
  study *is* a worklist row).

### 1.4 · The one honest constraint: measurement provenance is partial

**Reality check for "click a measurement → exact image + frame + caliper":**
Today provenance can reach the right *study/series*, sometimes the right image,
but **never the right frame or caliper**: frame number is hardcoded to `1`
everywhere; DICOM-SR provenance points at the SR *document*, not the imaged
frame; no SCOORD/caliper coordinates are stored; and the embedded viewer can't
be commanded to a specific instance/frame or draw an overlay. The
correctly-shaped store (`viewer_measurements` with caliper coords) exists but
has **no populator**.

**Consequence:** full Measurement Intelligence is *buildable* but is its own
phase (a real SCOORD/frame-capture layer + a targetable viewer) — not a day-one
promise. We ship the honest version first: jump-to-source-image with the
provenance we already have, then upgrade to exact frame + caliper.

---

## 02 · UI/UX proposal — one screen, organ-first, keyboard-driven

A dedicated route (`/radiology/usg/:studyId`) that mounts a USG-first shell. It
keeps the canonical editor state and lifecycle underneath, but arranges the
screen around the live-scan reality: a **report structured by organ** in the
centre, the **Dynamic Finding Builder** attached to whichever organ is active,
and **measurements + viewer co-visible** on the right. Nothing important is
hidden behind a tab; the sonologist works top-to-bottom of an organ list
without scrolling the report away.

### Annotated 3-column layout

```
┌─ TOPBAR: RIYA KUMARI · US Whole Abdomen · 🔒 Claimed by you · PCPNDT n/a · Readiness 82% · Save · Sign ⌘↵ ─┐
│                                                                                                            │
│  ┌─ LEFT (1,2) ───────────┐  ┌─ CENTER (3,4) ───────────────┐  ┌─ RIGHT (5,6) ──────────────────┐         │
│  │ Patient · History      │  │ Report · by organ            │  │ Viewer · frame + caliper       │         │
│  │  42 F · RUQ pain        │  │ ┌ Liver ● normal ─────────┐  │  │  [ GB · IMG 7 / f12   ▶ cine ] │         │
│  │  prior scan 3 mo ago ↗  │  │ │ Normal size/echotexture. │  │  │  [ thumb ][ thumb ][ thumb ]   │         │
│  │ Presets                 │  │ └──────────────────────────┘  │  │                                │         │
│  │  Whole Abdomen ▾ · KUB  │  │ ┌ Gallbladder ● building ──┐  │  │ Measurements                   │         │
│  │  · Pelvis · OB · Doppler│  │ │ Cholelithiasis:          │  │  │  GB stone 3.0 cm · CBD 4 mm    │         │
│  │ Organs (2)              │  │ │ [count Multiple][largest │  │  │  · R kidney 98 mm              │         │
│  │  ● Liver          L     │  │ │  3 cm][mobility Mobile]   │  │  │  Prostate vol L·W·H → 28 mL    │         │
│  │  ● Gallbladder ◀  G     │  │ │  [wall Normal][Murphy −]  │  │  │                                │         │
│  │  ● CBD            B     │  │ │ → "Multiple mobile calculi│  │  │ Prior comparison               │         │
│  │  ● Pancreas       P     │  │ │   largest 3 cm, normal    │  │  │  R kidney stone 4.0→5.5 mm     │         │
│  │  ● Spleen         S     │  │ │   wall, neg Murphy."      │  │  │  (+38%)                        │         │
│  │  ▲ Kidneys        K     │  │ └──────────────────────────┘  │  │                                │         │
│  │  ● Bladder        U     │  │ ┌ Kidneys ▲ ───────────────┐  │  │ Knowledge pack · Gallbladder   │         │
│  │                         │  │ │ R renal calculus:        │  │  │  Wall >3 mm ⇒ consider         │         │
│  │  ⇧N Normal-all-remaining│  │ │ [site Lower calyx][5.5 mm]│  │  │  cholecystitis · perichole-    │         │
│  │                         │  │ │ [HN Mild][shadow Yes]     │  │  │  cystic fluid…                 │         │
│  │                         │  │ └──────────────────────────┘  │  │                                │         │
│  │                         │  │ Impression (auto, editable):  │  │                                │         │
│  │                         │  │  1. Cholelithiasis.           │  │                                │         │
│  │                         │  │  2. R lower calyceal calculus │  │                                │         │
│  │                         │  │     w/ mild hydronephrosis.   │  │                                │         │
│  └─────────────────────────┘  └───────────────────────────────┘  └────────────────────────────────┘         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Annotation key (reuse vs new):**

1. **Patient / history / presets / organ nav** *(reuse)* — reuses worklist entry
   + `useReportingWorkflow`, clinical-history chips, study-type detection
   (`suggestTemplate`).
2. **Organ rail with status dots + hotkeys** *(new)* — thin nav; green = normal,
   amber = has finding. Click / press key to make an organ active.
3. **Organ-structured report** *(reuse+)* — the canonical draft state
   (`findings_sections`) rendered per organ instead of one blob; writes via
   `saveRadiologyDraft`.
4. **Dynamic Finding Builder** *(extend)* — parameter chips for the active organ
   → deterministic text (extends `structuredFindings` + `StructuredFindingDialog`).
5. **Embedded viewer** *(reuse→extend)* — reuses `EmbeddedWadoViewer`;
   frame/cine/caliper overlay + `goToInstance()` are the Phase-3 upgrade.
6. **Measurements / prior / knowledge — co-visible** *(reuse)* — reuses
   `UsgMeasurementReviewPanel`, `radiologyComparison`, the knowledge pack; moved
   out of a hidden tab.

### Keyboard model (a sonologist keeps one hand on the probe)

`L` `G` `K` … jump to an organ · `N` normal-this-organ · `⇧N` normal-all-remaining
· `F` open finding builder for the active organ · `Tab` through parameters · `M`
pull latest measurements · `⌘↵` sign (same gate as today's Finalize). Voice
reuses `useVoiceSession` with organ sections added to the dictation target set.

---

## 03 · Workflow — current vs proposed

| Step (multi-organ abdomen) | Now | Proposed |
|---|---:|---:|
| Open study & images | 2 | 1 |
| Load template / baseline normals | 1–2 | 0 *(auto on open)* |
| Reach + review measurements | 1 tab + n | 0 *(co-visible)* |
| Insert measurements into report | ~6 | 1 *(insert-all / auto)* |
| Record 2 abnormal findings | free-type | ~6 chips |
| Normalise the other organs | 1–2 | 1 *(⇧N)* |
| Compose impression | 2–4 | 0–1 *(auto-composed)* |
| Save · Finalize | 3 | 1 *(⌘↵)* |
| **Approx. total** | **~24** | **~11** |

**Obstetric** collapses hardest: today it is effectively two reporting sessions
(`FetalUsgLevel4` + the workspace) plus a Form F review — biometry typed up to
three times. In the shell, OB is an organ mode: biometry arrives from the SR
extractor, growth/interval come from the existing `pregnancyDashboard`,
corrections write back once, and finalize hits the *same* PCPNDT gate — one
session.

---

## 04 · Reuse plan — what stays unchanged

The shell consumes these verbatim. This is the "no parallel systems" guarantee
made concrete.

| Concern | Reused unchanged | Why it just works |
|---|---|---|
| Report storage & lifecycle | `radiologyReportLifecycle.ts` · `radiology-report-generator.ts` · `patient-reports.ts` · `radiology_report_drafts` · `patient_reports` | Draft/save/verify/finalize/deliver contract is modality-agnostic |
| Finding engine + dialog | `structuredFindings.ts` · `StructuredFindingDialog.tsx` · `smartFindings.ts` · `quickFindingsMerge.ts` · `measurementVars.ts` | Parameter→text/impression, conflict groups, merge, linked measurements |
| Auto-calc math | `usgMeasurementEngine.ts` · `obstetricCalculations.ts` | Ellipsoid volume, EFW, GA, EDD, AFI, RI/PI/S-D, CPR — pure, tested |
| Measurement capture & review | `usgExtractor.ts` · usg-extraction routes · `UsgMeasurementReviewPanel.tsx` · `usg_measurements` | SR→GE-tags→OCR, pending_review, per-field insert/approve/pin |
| Companion engine | `UsgCompanionPanel` + `usgCompanion*.ts` · `careUsgCompanion.ts` | Deterministic Auto-Populate, readiness, provenance ledger |
| Prior intelligence | `radiologyComparison.ts` · `ComparisonPanel.tsx` · `pregnancyDashboard.ts` · `radiology_lesion_timeline` | Canonical-id diff, interval change, OB growth/timeline |
| PCPNDT / Form F | `pcpndtCompliance.ts` · patient-reports (create) · report-status · `FormF.tsx` | One shared fail-closed gate on every finalize path — never forked |
| Viewer & images | `EmbeddedWadoViewer.tsx` · `OpenStudyPanel` · `ReportImagePicker` · `studyLaunchService.ts` · `/ohif-launch` | Network-aware launch, DICOM-reference key images (no blobs) |
| Cross-cutting | `requireStaffAuth` · `useStudyLock`/worklist-lock · `audit.ts` · `useVoiceSession` · `CommandPalette` · `useReportingWorkflow` | USG is already a `radiologyWorklistTable` row — all fire as-is |

---

## 05 · New components — deliberately minimal

Everything below is additive and mostly frontend. Backend additions are tiny
and behind flags.

### Frontend (the shell)

- **`UsgWorkspace.tsx`** — the dedicated route/shell that composes the existing
  editor state, lifecycle, viewer, companion, and measurement panel into the
  3-column organ-first layout. Thin orchestration, no new state store.
- **`OrganRail.tsx`** — organ navigation with normal/abnormal status dots +
  hotkeys; drives which organ section & finding library is active.
- **`DynamicFindingBuilder.tsx`** — parameter-chip surface for the active organ;
  wraps `StructuredFindingDialog`/`structuredFindings` with inline (non-modal)
  editing and live numeric calc.
- **`OrganReportSection.tsx`** — renders one organ's normal/abnormal block from
  `findings_sections` (per-organ, not one blob).

### Thin backend / data (all flag-gated, additive)

- **Numeric parameter type** on the finding-question model — add `number` +
  `unit` + a `derived/computeFrom` hook to `StructuredQuestion` so L/W/H →
  `{volume}` via the existing formulas. *(engine extend)*
- **Organ Finding Library seed** — import the already-authored YAML packs
  (`usg_abdomen.yaml` …) into `radiology_quick_findings` rows + USG organ tabs.
  Content exists; this is a loader, not authoring. *(seed)*
- **SCOORD / frame provenance capture** (Phase 3) — extend
  `usgExtractor.parseDicomSr` to resolve the SR content item's referenced image
  SOP + frame + SCOORD caliper, and populate the existing empty
  `viewer_measurements` store; add `goToInstance/goToFrame/showCaliper` to the
  viewer handle + a frame-level `/ohif-launch` param. *(real new capability)*
- **Prior-study endpoints** — implement (or redirect) the missing
  `/api/radiology-copilot/prior-studies` + `/structured-comparison` that
  `ComparisonPanel` already calls, and expose structured `usg_measurements` to
  `compareMeasurementRows` for non-obstetric follow-up. *(close gap)*

---

## 06 · Phased plan — small, shippable, reversible

Every phase is behind `ff_usg_workspace` (and its own sub-flags), reachable only
at the new route, so the existing workspace is never touched. Each ships
independently and rolls back by flag.

### P0 · Read-only shell *(reuse-only)*
- **Scope** — New route renders the 3-column layout by composing existing
  components (editor state, viewer, companion, measurement panel) in read-through
  mode. No new engine.
- **Accept** — Open a US study; view report, measurements co-visible, viewer,
  prior — identical data to the canonical workspace; save/finalize still go
  through the canonical lifecycle.
- **Rollback** — Flag off → route 404s; nothing else affected.

### P1 · Dynamic Finding Builder + organ rail *(extend)*
- **Scope** — Numeric/unit/derived parameter type; organ rail + per-organ report
  sections; seed abdomen/KUB/pelvis/Doppler library from YAML. Three reference
  findings: renal calculus, cholelithiasis, prostatomegaly (auto-volume).
- **Accept** — Building a parameterized finding writes deterministic text +
  impression into the canonical draft; volume auto-computes; text matches unit
  tests.
- **Rollback** — Sub-flag off → builder hidden, plain editor remains.

### P2 · One-click Normal + continuous companion *(reuse+)*
- **Scope** — Per-organ Normal + normal-all-remaining, reusing the Companion's
  deterministic dedupe-merge Auto-Populate; readiness/checklist update as
  findings/measurements change. Insert-all-approved measurements.
- **Accept** — Marking one organ abnormal and pressing ⇧N fills every other
  organ's normal without clobbering typed text; provenance ledger records each
  fill.
- **Rollback** — Falls back to today's on-demand Auto-Populate button.

### P3 · Measurement Intelligence (provenance) *(new capability)*
- **Scope** — SR SCOORD/ReferencedSOP + real frame parsing → populate
  `viewer_measurements`; viewer `goToInstance/goToFrame` + caliper overlay;
  frame-level launch. Click a report measurement → exact image/frame/caliper.
- **Accept** — For an SR-bearing study, clicking a measurement opens its exact
  frame with the caliper overlaid; OCR/manual degrade gracefully to image-level
  with a truthful note.
- **Rollback** — Sub-flag off → today's study/series-level "trace" behaviour.

### P4 · Previous-Study Intelligence *(close gaps)*
- **Scope** — Implement the missing prior-study endpoints; feed structured
  USG/Doppler measurements into `compareMeasurementRows`; surface interval days +
  growth/percentile (OB) and stone/cyst/nodule deltas (non-OB) using
  `radiology_lesion_timeline`.
- **Accept** — Prior images/measurements/report/impression show side-by-side;
  deltas are formatted (never auto-classified), matching the deterministic-first
  contract.
- **Rollback** — Comparison panel reverts to the `priorUsgText` path.

### P5 · Fold in the OB & Doppler forks *(consolidation)*
- **Scope** — OB becomes an organ mode inside the shell (biometry + checklist +
  growth in-place, single finalize through the canonical PCPNDT gate); Doppler
  folds into the Doppler organ. Route-redirect the standalone forks (keep files
  for rollback, mirroring the V2 legacy-page pattern).
- **Accept** — An OB study is reported once, writes back corrections, and
  finalizes through the shared gate with Form F enforced; no data typed twice.
  Legacy OB path remains until the PCPNDT roadmap §1.8 checklist is signed off.
- **Rollback** — Redirects removed; forks reachable again.

---

## 07 · Regression safety

- **Isolation by route + flag.** The shell lives at a new route behind
  `ff_usg_workspace`; the canonical `RadiologyReportingWorkspace` is not edited.
  USG in the canonical workspace keeps working throughout, so there is always a
  fallback.
- **One storage, one finalize.** The shell writes only to
  `radiology_report_drafts`/`patient_reports` via `radiologyReportLifecycle` —
  never to the legacy `usg_report_drafts`. Same verify/finalize, same
  authorship-from-session (D-33), same append-only signed `patient_reports.body`
  (D-19).
- **PCPNDT untouched.** The single shared `checkPcpndtFormFCompliance` stays the
  only gate on every finalize path; the shell only mirrors it in the UI. The
  legacy compliant OB path is not deleted until its roadmap checklist is complete.
- **Guard tests extend the existing pattern.** Add a
  `canonicalWorkspaceRouting`-style source-guard asserting: the shell imports the
  canonical lifecycle (not a new one), mounts no second QuickFindings engine,
  posts to no new draft/finalize transport, and reuses the shared PCPNDT gate.
  This is exactly how the repo already pins "one engine, one workspace."
- **Additive backend only.** New parameter type / organ seed / provenance columns
  are additive and flag-gated (`ff_radiology_*` defaults off), matching the
  platform's shadow-first convention; no schema migration touches billing,
  `sync.ts`, or the frozen reporting contract.
- **Consolidation is last and reversible.** The forks are only route-redirected
  (files kept for rollback) once the shell reaches parity — no deletions during
  build.

---

## Appendix A · The Dynamic Finding Builder

A **Finding Object** replaces static templates: an organ-scoped, parameterized
definition that deterministically generates report text, an impression
contribution, and (when numeric) a derived calculation. It is an *extension* of
the existing `radiology_quick_findings` / `structuredFindings` model — the same
`questionsJson` engine, plus a numeric/derived parameter type.

### Shape

| Field | Meaning |
|---|---|
| `organ · findingType` | Scope + label (e.g. Kidney · Renal calculus) |
| `parameters[]` | `{ key, label, type: select\|number\|yesno\|text, options?, unit?, required?, default? }` |
| `derived[]` | `{ key, computeFrom:[…], formula }` — bound to existing `usgMeasurementEngine`/`obstetricCalculations` (e.g. ellipsoid volume) |
| `findingText · impressionText` | Templates with `{key}` slots + `[optional clauses]` that vanish when a value is nullish (grammar-safe) |
| `normalText` | The organ's baseline normal statement (one-click Normal) |
| `conflictGroup · severityFrom` | Mutual exclusion; severity/grade optionally derived from a numeric (e.g. prostate grade from volume) |

### Three worked examples (exactly as specified)

**Right renal calculus**
- Parameters: `location` (Upper/Mid/Lower calyx · Pelvis · PUJ) · `number`
  (Single/Multiple) · `largest` (5.5 mm) · `hydronephrosis` (None→Severe) ·
  `shadowing` (Y/N)
- → *"Right lower calyceal calculus measuring 5.5 mm with posterior acoustic
  shadowing and mild hydronephrosis."*

**Cholelithiasis**
- Parameters: `number` (Single/Multiple) · `largest` (3 cm) · `mobility`
  (Mobile/Impacted) · `wall` (mm) · `pericholecystic` (Y/N) · `Murphy` (+/−)
- → *"Multiple mobile calculi, largest 3 cm; gallbladder wall normal, no
  pericholecystic collection, negative sonographic Murphy sign."*

**Prostatomegaly**
- Parameters: `AP` (mm) · `TR` (mm) · `CC` (mm) → volume `0.523·L·W·H = 28 mL`
- → *"Prostate enlarged, measuring 4.2 × 3.8 × 3.4 cm (volume ≈ 28 mL)."*
  **Impression:** Grade II prostatomegaly.

### One-click Normal & the organ library

Each organ carries a normal statement; marking any organ abnormal leaves the
rest normal, and `⇧N` inserts every remaining organ's normal in one pass
(reusing the Companion's non-destructive dedupe-merge — typed text is never
clobbered). The library is organ-wise, seeded from the already-authored content:
**Liver · Gallbladder · CBD · Pancreas · Spleen · Kidneys · Ureters/Bladder ·
Prostate · Uterus/Ovaries · Obstetrics · Scrotum · Breast · Thyroid/Neck · Soft
tissue · Doppler** — of which liver, GB/CBD, kidneys, prostate, uterus/ovaries
and Doppler already have fully-parameterized findings authored in the YAML
packs, and every listed organ has a normal skeleton in `usgReportTemplates.ts`.

### Bottom line

Tasks 3–5 (dynamic builder, organ library, one-click normal) are mostly
**wiring + seeding existing assets** and land early (P1–P2). Tasks 6–7
(measurement intelligence, prior intelligence) are **genuinely new capability**
gated on the provenance/endpoint work and land in P3–P4. The whole thing is a
dedicated USG experience that never forks the reporting engine, storage, PCPNDT
gate, or audit trail — exactly the "reuse everything, redesign only the workflow
& UI" brief.

---

*Next step, on your word: turn this into an implementation plan for Phase 0
(read-only shell).*
