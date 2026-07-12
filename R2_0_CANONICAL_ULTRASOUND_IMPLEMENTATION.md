# R2.0 — Canonical Ultrasound (USG/Doppler/OB) Integration (Implementation)

Folds ultrasound reporting into the ONE canonical Radiology Worklist →
Reporting Workspace flow. No new report page, no worklist redesign, no
backend redesign — Backend V1 (D1–D9 structured reporting, M1.x workspace,
R1.x presentation/image panel, viewer, audit, voice, renderer, report
lifecycle) stays frozen. R2.0 is additive integration on top of it, plus
targeted bug fixes surfaced by real-environment testing and adversarial
review.

## 1. Audit (Phase 1) — what already existed

Most of the USG surface area already existed from prior phases (M1.1
canonical-workspace consolidation, R1.1–R1.3 presentation/image-panel). The
audit classified every piece before writing any code:

| Area | Classification | Notes |
|---|---|---|
| `RadiologyWorklist.tsx` (`/radiology/worklist`) | **Reuse** | Already the sole live worklist; `UsgWorklist.tsx`/`DicomStudyWorklist.tsx` are lazy-imported but unrouted (redirect via `RedirectToUnifiedWorklist`) — dead code kept for rollback, untouched. |
| `RadiologyReportingWorkspace.tsx` (`/radiology/report/:studyId`) | **Reuse** | Already the canonical M1.1 page; had zero "USG mode" concept before R2.0. |
| USG extraction pipeline (`usgExtractor.ts`, DICOM SR → GE tags → OCR → manual, strict priority) | **Reuse** | Already correctly guards OCR from ever overwriting structured values (two independent checks). |
| `UsgMeasurementReview.tsx` (standalone page) | **Integrate** | Refactored into a thin wrapper over a new embeddable panel (§4). |
| `usgReportTemplates.ts` (13-template catalog, confidence-gated auto-fill) | **Integrate** | Wired into the workspace's Templates tab as a second catalog. |
| `PregnancyDashboard.tsx` (standalone OB dashboard) | **Integrate** | Kept as the deep-dive page; a new compact strip (§6) surfaces its core numbers inline in the workspace. |
| `FormF.tsx` (PCPNDT) | **Integrate + bug fix** | Kept as the one Form F UI; found and fixed a live auto-fill mislabeling bug (§7). |
| `ReportImagePanel.tsx` / `ReportImagePicker.tsx` (R1.3) | **Reuse as-is** | Already exactly what "Key Images" needs (caption, key-image flag, display order, reference-only persistence, server-built OHIF launch). |
| `UsgKeyImagesGallery.tsx` | **Legacy / partially bridged** | Separate `usg_key_images` store; the new panel's "Pin" action now writes through the canonical `radiology_image_references` table instead. |
| `UsgAdminSettings.tsx` / `UsgAnalytics.tsx` / `UsgCriticalAlerts.tsx` | **Admin only / Reuse** | Real, working, already correctly gated — untouched. |
| `UsgReporting.tsx` / `UsgDopplerReporting.tsx` (own draft/finalize lifecycle, PCPNDT lock, hash immutability, amendments) | **Legacy, preserved** | Materially more advanced than the generic report lifecycle for OB-specific compliance; NOT ported into the canonical workspace this round (see §11). Left routed and functional. |

## 2. Canonical Worklist (Phase 2)

- New `lib/usgModality.ts` (frontend) / `lib/usgModality.ts` (backend, a
  documented duplicate — the two packages don't share a lib):
  `normalizeModality()`/`isUltrasoundModality()` fold `US`, `USG`,
  `Doppler`, `OB US`, `Fetal US`, `4D/3D US`, `Color Doppler`, etc. into one
  `"US"` bucket (alias list, substring match, and a `US`-prefix boundary
  check so "USER" doesn't false-match).
- `RadiologyWorklist.tsx`'s modality filter now normalizes both sides of
  the comparison instead of exact string equality.
- `GET /api/radiology/pacs-worklist` gained three additive scalar-subquery
  fields — `usgMeasurementCount`, `usgKeyImageCount`, `usgReportStatus` —
  joined by the already-indexed `worklist_id` FK on
  `usg_measurements`/`usg_key_images`/`usg_report_drafts`. No migration.
- Three new columns (Measurements / Images / USG Report), shown only on
  US-modality rows; the Measurements badge deep-links into the canonical
  workspace (`/radiology/report/:id`, the worklist row's own id).
- The backend intake auto-extraction trigger (`internal-radiology.ts`) and
  the USG dashboard's `/stats`/`/push-monitor` modality filters were also
  updated to the shared normalizer (Phase 16 finding — see §10) so an
  aliased PACS modality string is recognized consistently end-to-end, not
  just in worklist display.

## 3. USG mode in the Reporting Workspace (Phase 3)

`isUltrasound = isUltrasoundModality(entry?.modality)`, one `useMemo`,
consistently gates every USG addition (verified by adversarial review to
have no scattered re-derivation). When true:

- **Measure tab**: the new `UsgMeasurementReviewPanel` (§4) mounts above the
  existing generic `MeasurementAssistantPanel` (unchanged, still serves
  every modality's manual calculator).
- **Templates tab**: a "USG Templates" section lists the 13-template
  catalog (`/api/usg-reports/templates`); `PreferencesPanel` (already
  DB-backed favourites/recents, previously only wired into deprecated
  pages) is now mounted here too — gives every modality, USG included,
  "favourite and recently used templates first" for free.
- **Report editor top**: `ObDashboardStrip` (§6) for obstetric studies.
- **Keyboard**: Ctrl+1..6 quick-select six practical templates (Whole
  Abdomen / KUB / Pregnancy / Arterial Doppler / Breast / Thyroid).
- **PCPNDT**: a "Review & Map to Form F" action (§7).

For every non-ultrasound study the workspace is byte-for-byte the same as
before R2.0 — verified live against a seeded CT study (§9).

## 4. Measurement review + provenance (Phases 4–5, 8)

`UsgMeasurementReview.tsx` (837 lines, full standalone page) was refactored
into a ~200-line thin wrapper plus a new, reusable
`components/radiology/UsgMeasurementReviewPanel.tsx`, mounted both by that
wrapper (`studyInstanceUID` only) and by the canonical workspace
(`studyInstanceUID` + `draftId` + insert/approve callbacks).

The panel decomposes the extraction pipeline's wide `usg_measurements` row
(plus any `usg_doppler_measurements` rows) into a Name / Value / Unit /
Confidence / Source list, each entry showing:

- **Double-click** → insert into the report.
- **Ctrl+Enter** (row-focused) → approve. Scoped correctly: the row's
  `keydown` handler calls `stopPropagation()` before the workspace's
  window-level "Ctrl+Enter = finalize the whole report" handler can see it
  (verified live — approving a row never triggers the finalize confirm
  dialog).
- **Insert / Approve & Insert** buttons, each disabled with a
  "Rejected — not inserted" note once the parent row is rejected.
- **Trace** — the pre-existing provenance dialog (Study/Series/SOP/Frame,
  source badge SR/GE-tag/OCR/Manual, confidence, raw vs. normalized value).
- **Open source image** — calls the existing server-built, SOP/series-aware
  `/ohif-launch` endpoint (never exposes a raw PACS URL; degrades SOP →
  Series → Study with an explicit "opened at study level" notice).
- **Pin as key image** — the one new call this panel makes: posts to the
  existing `POST /api/radiology/report-generator/image-references` with
  `isKeyImage: true`, i.e. the same canonical, reference-only store R1.3's
  `ReportImagePanel` already renders — only available when embedded with a
  `draftId` and the entry has a `sopInstanceUID`.
- A 4-step timeline (Extracted → Reviewed → Approved → Inserted) per row.

On the standalone page (no `draftId`, no insert callback), Insert/Approve &
Insert/Pin are hidden entirely rather than shown as active no-ops — an
earlier version left them active, which is fixed in §10.

## 5. Templates (Phase 6) — see §3 above (Templates tab).

## 6. Pregnancy Dashboard (Phase 7)

`GET /api/fetal-usg-dashboard/strip/:studyId` (new, additive endpoint) —
`:studyId` is the canonical `radiology_studies.id`
(`fetal_usg_studies.study_id`'s own FK target), resolved from a
`fetal_usg_studies` lookup with a same-pregnancy-episode fallback when the
exact study has no measurements yet. Returns one compact snapshot: GA
(server-computed label), EDD, BPD/HC/AC/FL/EFW, AFI + interpretation, FHR,
placenta location/grade, presentation.

`components/radiology/ObDashboardStrip.tsx` renders it as a row of
click-to-edit chips (mirrors the old page's inline-edit interaction
pattern) above the report editor for obstetric studies — silent (renders
nothing) for every non-OB study or an OB study FetalUsgLevel4 hasn't
touched yet. An "Insert OB Summary into Findings" button compiles the
current (possibly-edited) chip values into one line and merges it into
`rawFindings`. Edits here only affect report text, never the underlying
`fetal_usg_measurements` row — correcting the source data stays
FetalUsgLevel4's job.

## 7. PCPNDT / Form F (Phase 9)

**Never auto-fill.** `reviewAndMapToFormF()` (workspace) reads the current
row from `GET /api/usg-extraction/study/:studyInstanceUID`, requires
`status === "approved"`, and builds a plain biometry reference string (`GA:
…, CRL: …, EDD: …, …`) — deliberately with **no** "Normal"/"Abnormal"
guess. `window.open("/form-f?prefillUsgSummary=…")`.

Form F shows this as a dismissible, read-only reference banner. The
"Apply" action:

- Extracts and populates the objective **Gestational Age** fields (14a) —
  transcription of a measurement, not a diagnosis, so it's safe to
  automate.
- Resolves and attaches the real `fetalUsgStudyId` (via the same `/strip`
  endpoint from §6) for PCPNDT traceability.
- Leaves **Ultrasound Result (Normal/Abnormal)** and every other field
  exactly as the radiologist has already set them — that categorization is
  never guessed. The toast names exactly what was/wasn't applied.

Nothing is written to the database from this flow until the radiologist's
own, pre-existing, explicit **Save** on the Form F page.

This also fixed a genuine live bug in the *existing* auto-populate path
(`fetchFromBilling`, gated behind the pre-existing
`autoPopulateFormFFromObMeasurements` clinic setting): the server always
returns a descriptive string ("Normal (CRL: 65mm, …)"), but the UI radios
compared against the literal `"normal"`/`"abnormal"` — never matching —
so a genuinely normal auto-populated scan could silently save as
`"Abnormal: "` with an empty detail. Fixed by normalizing at the one
ingestion point (`categorizeUsgResult()`), with zero behavior change for
manual entry.

## 8. Key Images (Phase 10) — see §4 ("Pin as key image").

`ReportImagePanel`/`ReportImagePicker` (R1.3) needed no changes — already
exactly the reusable panel the spec asks for. `UsgKeyImagesGallery.tsx`
(separate `usg_key_images` store, cross-study grid) is left as-is/legacy;
bridging its write path fully into `radiology_image_references` is a
follow-up (§11).

## 9. Productivity + Viewer (Phases 11–12)

- Favourites/recents: see §3 (`PreferencesPanel`).
- Ctrl+1..6: new entries in `workspaceCommands.ts`
  (`select-template-1..6`) and `workspaceReportState.ts`
  (`matchWorkspaceShortcut`), guarded against firing while focus is in
  `INPUT`/`TEXTAREA` (same pattern the existing `/` shortcut already used) —
  destructive template-apply must never fire while typing. **Caveat**:
  some browsers reserve Ctrl+1..8/9 for tab-switching at the OS/chrome
  level and may never deliver the keydown to the page at all; verified
  working in headless Chromium (Playwright), not verified against every
  real desktop browser/OS combination.
- Viewer: "Open source image" (per measurement) and key-image thumbnail
  click both resolve through the existing server-built `/ohif-launch`
  endpoint — never exposes a raw PACS URL. The main "Open Study" viewer
  launch panel (`OpenStudyPanel`/`studyLaunchService.ts`) is a
  pre-existing, unrelated, study-level-only mechanism that already did
  expose raw PACS/OHIF/Weasis URLs to the browser before R2.0 and was left
  untouched (out of scope — "Viewer" is on the frozen list).

## 10. Finalization + navigation (Phases 13–14)

Both already worked correctly for USG before R2.0 and needed no code
change — verified live (§9 below): the shared `radiologyReportLifecycle.ts`
save/finalize service and the server-rendered preview/print/PDF pipeline
are modality-agnostic (`modality` is a display/audit field only). No
separate USG worklist exists in the primary nav (`Layout.tsx` sidebar only
ever had "Fetal USG"/"Echo Cardiology" as advanced tools, never a daily
USG worklist); old `/usg/*` routes keep working via
`RedirectToUnifiedWorklist`.

## 11. Testing (Phase 15) — real Postgres + real Chromium

Local Postgres 16 (schema pushed via `drizzle-kit push`, 342 tables), real
API server + Vite dev server, headless Chromium via Playwright driven by
hand-written scripts (not committed — ad hoc verification only). Seeded 8
worklist rows spanning modality spellings (`US`, `USG`, `Fetal US`, `OB
US`, `Doppler`) and study types: **Whole Abdomen, Pregnancy (dating), OB
Growth Scan, NT Scan, Carotid Doppler, KUB, Breast, Thyroid**, plus one CT
study to verify non-USG studies are unaffected. Verified against the
running app (not just typecheck/unit tests):

- Worklist: normalized modality filter, Measurements/Images/USG Report
  columns render and deep-link correctly.
- Workspace: USG mode panels appear only for ultrasound studies; the CT
  study shows zero USG UI.
- Measurement review: double-click insert, Ctrl+Enter approve (scoped,
  verified no finalize-dialog leak, verified DB write —
  `reviewedBy`/`status` actually persisted), Doppler rows, Trace dialog,
  rejected-row gating.
- Templates: Ctrl+5 applies the Breast template via
  `/api/usg-reports/auto-generate` and reports "no approved measurements
  yet" correctly when none exist.
- Pregnancy Dashboard strip: auto-populates GA/EDD/BPD/HC/AC/FL/EFW/FHR/
  Placenta/Liquor/Presentation from seeded data; "Insert OB Summary"
  merges into findings.
- Form F handoff: banner shows raw reference text, "Apply" populates GA +
  study link, correctly reports "no obstetric measurements to map" for a
  non-OB (Whole Abdomen) study.
- Finalize → reopen: filled a KUB report, saved draft, previewed,
  finalized (confirm dialog fired with correct patient/study/accession
  text), reopened fresh — "Report is finalized. Editing is disabled."
  banner and all content persisted correctly.
- `pnpm typecheck` clean on both packages (zero new errors vs. a
  pre-existing 30-error baseline unrelated to this work); `vitest run`
  462/462 (diagnostic-erp) and 1099/1099 (api-server).

## 12. Adversarial review (Phase 16)

Ran a 10-angle review (line-by-line, removed-behavior, cross-file tracer,
language pitfalls, wrapper correctness, reuse, simplification, efficiency,
altitude, CLAUDE.md conventions) against the full diff. Found and fixed 8
MUST-FIX bugs plus one broken test (full list and reasoning in the commit
message for `R2.0 Phase 16: adversarial review fixes`) — the two most
significant:

1. The worklist's Measurements badge linked via the wrong id
   (`entry.studyId`, an unrelated/often-null id-space) instead of
   `entry.id` — could open the wrong study.
2. Form F's "Apply to Ultrasound Result" button was a **complete no-op**
   that still displayed a false "Applied" success toast (the biometry
   summary text can never match the Normal/Abnormal categorizer by
   design) — fixed to extract Gestational Age honestly and report exactly
   what did/didn't happen.

Also fixed: a numeric-only regex corrupting non-numeric measurement
inserts into duplicate/garbled report lines; missing approval-status
gating on Insert/Approve & Insert/Pin; a misleading "Inserted" indicator
that could bleed false-positive state across page mounts via a shared
localStorage key; a stale backend intake trigger that never learned the
new modality aliases; plus several lower-severity efficiency/consistency
fixes (stale-time tuning, cache invalidation gaps, a UTC date-parsing
off-by-one-day bug, an unhandled clipboard-write rejection). All re-verified
live after fixing (see commit message for the exact repro/fix per item).

## 13. Known limitations / follow-up work (not done this round)

- **Field-level correction UI**: the old standalone page let a radiologist
  click a measurement value to correct an OCR misread before approving
  (`PATCH /measurements/:id/field`, still live on the backend, now
  unreachable from any UI). Approval remains row-level only. Restoring
  inline correction in the new panel is a real, valuable follow-up.
- **`usg_key_images` vs. `radiology_image_references`**: two overlapping
  key-image stores still coexist (pre-existing before R2.0). The new
  "Pin" action correctly uses the canonical store; the standalone page's
  legacy "Add key image by URL" section and `UsgKeyImagesGallery.tsx`
  still use the older, disconnected one.
- **`UsgReporting.tsx`/`UsgDopplerReporting.tsx`**: their PCPNDT
  compliance-lock / verify / quality-check / hash-immutability / amendment
  machinery is materially more advanced than the generic report lifecycle
  for obstetric studies and was intentionally NOT ported into the
  canonical workspace this round — porting it is a larger, separate
  effort, not a drop-in.
- **Frame-level key images**: "representative cine frame" capture is a
  pre-existing R1.3 gap (whole-SOP-instance selection only); not
  addressed here.
- **Ctrl+1..6 vs. browser tab-switching**: see §9 caveat.
- Environment-only, unrelated to this change: this local test environment
  has no real PACS/Orthanc server, so OHIF/Weasis launch calls 404/400 in
  testing (expected — no live DICOM viewer configured here); two
  pre-existing, unrelated startup warnings appear in server logs
  (a `pacs_settings` upsert missing a unique constraint, and a
  pre-existing `has_seconds` migration syntax error) — both predate this
  branch and are outside R2.0's scope.

## 14. Rollback

Every change here is additive or a narrow bug fix in already-editable
🟡 Radiology/PACS-zone files (`PROTECTED_FILES.md`) — no schema migration,
no destructive change. To roll back: revert the two commits on this branch
(`R2.0 canonical ultrasound integration` + `R2.0 Phase 16: adversarial
review fixes`). Every previously-existing standalone USG page/route keeps
working unchanged if reverted; nothing else in the app depends on the new
files (`usgModality.ts` ×2, `ObDashboardStrip.tsx`,
`UsgMeasurementReviewPanel.tsx`) or the new endpoint
(`GET /api/fetal-usg-dashboard/strip/:studyId`).
