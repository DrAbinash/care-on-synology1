# USG Companion — Phase P2 Implementation Report

**Branch:** `claude/usg-companion-p2-workflow` (stacked on the merged P0/P1).
**Feature flag:** `ff_radiology_usg_companion_p2` — **default OFF**. Active only
inside the dedicated USG workspace when both `ff_radiology_usg_workspace` and
this flag are on; with it off, the P0/P1 workspace is byte-for-byte unchanged.

P2 turns the P0/P1 shell into an efficient daily-reporting workspace. All new
logic is **pure, deterministic, and unit-tested**; the UI is wired behind the
flag. No parallel report lifecycle / draft store / finalized-report store /
PCPNDT engine / measurement engine was created — everything rides the canonical
`findings_sections` and lifecycle.

## Sub-phases

| # | Capability | Module(s) | Status |
|---|---|---|---|
| P2.1 | Continuous readiness (advisory) | `usgReadiness.ts` + `ReadinessBar.tsx` | Code complete |
| P2.2 | Insert all approved measurements | `usgMeasurementInsert.ts` | Logic complete; UI wiring to the live measurement panel = follow-up |
| P2.3 | Measurement conflict reconciliation | `usgMeasurementInsert.ts` | Logic complete |
| P2.4 | Persistent organ states | `usgReportComposer.ts` (extended) | Code complete (persisted + round-tripped) |
| P2.5 | Preset-aware reporting | `usgPresets.ts` | Registry complete (non-OB presets; OB/Doppler presets = P5) |
| P2.6 | Expanded finding library | `usgFindingLibraryExtended.ts` | Core abdomen/KUB set (12 findings); framework extensible |
| P2.7 | Report/impression consistency | `usgConsistency.ts` | Code complete (advisory) |
| P2.8 | Manual-edit safety | `usgManualEdit.ts` | Code complete |
| P2.9 | Keyboard workflow | `usgKeyboard.ts` + `ShortcutOverlay.tsx` | Code complete |
| P2.10 | Audit & observability | `usgAudit.ts` | Code complete (maps to canonical log-action) |

## Key safety properties (all unit-tested)

- **Persistent organ states** ride inside canonical `findings_sections`
  (`{normal,text,status,findings}`, `.passthrough()`d). Findings always dominate
  (→abnormal); `not_applicable` emits no report text; `surgically_absent` /
  `not_visualized` carry a clinical statement; removing the last abnormality does
  **not** silently normalize; `markNormal`/`addFinding` clear stale status.
- **Preset-aware normals**: `Normal-all-remaining` uses the preset's expected,
  sex-filtered organ set; clinical modifiers (post-cholecystectomy, nephrectomy,
  post-hysterectomy, bowel-gas/bladder-filling) remove/limit organs so an absent
  or unseen organ is never marked normal.
- **Insert-all-approved** inserts only approved+mapped+preset-relevant
  measurements, preserving value/unit/source/reference; detects already-present
  vs conflict (abs+% diff); never auto-inserts a conflict; leaves pending/rejected
  untouched. **Reconciliation** (keep-report / use-incoming / keep-both / reject /
  unresolved) is always audited (author, timestamp, both values, source) and never
  silently overwrites.
- **Manual-edit safety**: generated and edited text both kept; a param-driven
  regenerate preserves a divergent manual edit and flags reconciliation.
- **Consistency & readiness** are advisory only — the sole finalize block remains
  the server-side PCPNDT gate (surfaced, never client-enforced).
- **Keyboard**: plain-key shortcuts never fire while typing; editing shortcuts
  disabled when locked; bare shortcut letters proven not to collide with organ
  hotkeys.
- **Audit**: structural metadata only (a PHI guard drops prose/long values);
  mapped to the canonical `log-action` endpoint — no parallel audit store.

## Finding library coverage (P2.6)

**Added (12):** liver — fatty (grade I/II/III) + hepatomegaly + hepatic cyst;
gallbladder — sludge, polyp (≥10 mm follow-up flag), wall thickening; CBD —
dilated (+ choledocholithiasis); kidney — hydronephrosis, simple cyst, increased
cortical echogenicity; bladder — wall thickening, pre/post-void residual.
Plus the P1 three (renal calculus, cholelithiasis, prostatomegaly).

**Follow-up within P2.6 (framework ready, not yet authored):** spleen, pancreas,
ureters, uterus, ovaries/adnexa, peritoneum/general, scrotum, thyroid/neck,
breast, soft tissue. Each is a data-only `UsgFindingDef` addition — no engine
change. Descriptive lesion findings never assert malignancy.

## Tests

- **New P2 unit tests:** `usgPresets` (9), `usgOrganStates` (7), `usgConsistency`
  (6), `usgReadiness` (5), `usgMeasurementInsert` (5), `usgFindingLibraryExtended`
  (9), `usgManualEdit` (4), `usgKeyboard` (6), `usgAudit` (3).
- **Full suite (serial, real Postgres): 208 files / 2996 tests, 0 failures.**
  (Parallel runs show a pre-existing flake in `radiology-report-generator.test.ts`
  from cross-test DB-row-count contention — passes in isolation and serially; not
  related to this frontend-only change and not a defect.)
- **Full-workspace typecheck (`pnpm typecheck`, tsc --build): 0 errors.**
- **Production build (`diagnostic-erp`): success.**

## Migration / schema notes

**None.** P2 rides entirely on the existing `radiology_report_drafts.findings_sections`
JSON (organ `status` added inside the object) and existing endpoints. No new
tables, columns, or migrations.

## Known limitations

- **Insert-all-approved UI**: the planning/reconciliation logic is complete and
  tested; wiring it to the live `UsgMeasurementReviewPanel`'s approved-measurement
  stream (and the conflict-reconciliation dialog) is a follow-up UI task.
- **Finding library** covers core abdomen/KUB; the remaining organs are catalogued
  above for follow-up.
- **UI is typecheck- and build-verified only** — not runtime/browser-validated in
  this CI container (no live stack); a deployed smoke on staging is required
  before enabling the flag.
- Obstetric/Doppler presets and modes are **P5**, not P2.

## Classification

**CODE COMPLETE — CLINIC VALIDATION PENDING.** All P2 logic is implemented and
tested; the flag defaults OFF; the deployed clinic smoke (per
`P0-P1-DEPLOYED-ACCEPTANCE.md`) plus a P2-specific walkthrough on real staging
remain before enabling.
