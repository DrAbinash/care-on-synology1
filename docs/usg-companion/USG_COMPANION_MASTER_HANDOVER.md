# USG Companion — Master Handover

Living handover for the USG Companion project. Updated through **Phase P2**.

## What is built

| Phase | State | Where |
|---|---|---|
| **P0** dedicated USG workspace shell | **Merged** (PR #152) | `pages/UsgCompanionWorkspace.tsx`, `components/radiology/usg/*` |
| **P1** Dynamic Finding Builder + 3 reference findings | **Merged** (PR #152) | `lib/usgFindingBuilder.ts`, `lib/usgOrganLibrary.ts`, `lib/usgProstateConfig.ts` |
| P0/P1 hardening (shared volume, prostatomegaly separation) | **Merged** (PR #152) | `lib/measurements/src/volume.ts` |
| **P2** daily-reporting workflow | **Code complete — clinic validation pending** | this branch `claude/usg-companion-p2-workflow` |
| P3–P9 | **Not started** | — |

## What is enabled

**Nothing is enabled by default.** Every flag defaults **OFF**. The canonical
`RadiologyReportingWorkspace` serves all USG studies until flags are turned on.

## Feature-flag matrix

| Flag | Phase | Default | Effect |
|---|---|---|---|
| `ff_radiology_usg_workspace` | P0/P1 | OFF | Enables the dedicated `/radiology/usg/:studyId` route + worklist routing for US studies. Off → redirects to canonical. |
| `ff_radiology_usg_companion_p2` | P2 | OFF | Adds readiness bar, shortcut overlay, organ states, preset-aware normals, expanded findings, consistency, insert-all logic. Inert when off. |
| `ff_radiology_usg_dicom_extraction` | P3 | OFF | (reserved — not implemented) |
| `ff_radiology_usg_exact_provenance` | P3 | OFF | (reserved) |
| `ff_radiology_usg_prior_intelligence` | P4 | OFF | (reserved) |
| `ff_radiology_usg_pregnancy_timeline` | P4 | OFF | (reserved) |
| `ff_radiology_usg_ob_canonical` | P5 | OFF | (reserved) |
| `ff_radiology_usg_doppler_canonical` | P5 | OFF | (reserved) |
| `ff_radiology_usg_report_to_pacs` | P6 | OFF | (reserved) |
| `ff_radiology_usg_cine` | P7 | OFF | (reserved) |
| `ff_radiology_usg_ai_assistant` / `_ai_growth` | P8 | OFF | (reserved) |
| `ff_radiology_usg_sugandha_mode` | P9 | OFF | (reserved) |

*Reserved flags are named for the roadmap but are only registered when their
phase lands. Only `ff_radiology_usg_workspace` and `ff_radiology_usg_companion_p2`
exist in `staffSession.ts` today.*

## Routes

- `/radiology/usg/:studyId` — dedicated USG workspace (behind `ff_radiology_usg_workspace`).
- Canonical `/radiology/report/:studyId` — unchanged fallback; the USG route
  redirects here when the flag is off.

## Tables & storage (all canonical — no USG-specific tables)

- `radiology_report_drafts.findings_sections` — organ sections incl. structured
  finding objects **and** the P2 organ `status`, as JSON (`.passthrough()`).
- `radiology_report_drafts.impression` — canonical `string[]`.
- `patient_reports` — signed report (canonical verify/finalize).
- PCPNDT via `form_f_records` + `checkPcpndtFormFCompliance` (server-side, unchanged).

## External dependencies

- Postgres (canonical schema). Orthanc/OHIF for the viewer (P0/P1 reuse). No new
  queues/workers in P0–P2. (P3 extraction, P6 PACS-return, P8 AI will add workers.)

## How to deploy (safe rollout)

1. Merge with all flags **OFF**. Deploy normally.
2. Run synthetic/demo cases, then a real clinic smoke with a dummy study.
3. Enable `ff_radiology_usg_workspace` for Dr. Sugandha only; keep canonical as fallback.
4. Then enable `ff_radiology_usg_companion_p2`.
5. Do **not** globally enable until explicitly approved.

## How to roll back

- Turn the relevant flag OFF (server `feature_flags` table / `/api/feature-flags`).
  The route redirects to canonical and all P2 UI goes inert immediately. No data
  migration to reverse (P0–P2 add no schema).

## How to test

```
# isolated test Postgres
DATABASE_URL=postgres://…/care_test pnpm --filter @workspace/db run push-force
DATABASE_URL=postgres://…/care_test pnpm exec vitest run --no-file-parallelism   # 0 failures
pnpm typecheck                                                                    # 0 errors
pnpm --filter @workspace/diagnostic-erp run build                                 # success
```
Run serially (`--no-file-parallelism`) to avoid a pre-existing cross-test DB
row-count flake in `radiology-report-generator.test.ts` (passes in isolation).

## Remaining clinic validations (not yet performed — do on staging)

Deployed worklist→open→lock→build findings→save/reload→finalize→signed report;
audit author; no legacy-store write; Orthanc viewer loads the correct study;
PCPNDT fail-closed for an incomplete-Form-F obstetric study. See
`P0-P1-DEPLOYED-ACCEPTANCE.md` — these require the real staging + Orthanc, which
were not available in the CI container.

## Unresolved limitations

- Deployed/browser validation pending (CI container has no full stack/PACS).
- Insert-all-approved UI wiring to the live measurement stream is a P2 follow-up.
- Finding library covers core abdomen/KUB; other organs are catalogued in
  `P2-IMPLEMENTATION-REPORT.md`.

## Recommended next human actions

1. Review + merge the P2 PR (flags OFF — safe).
2. Run the deployed smoke on staging (P0/P1 + P2) with dummy studies.
3. If green, enable flags for Dr. Sugandha and observe.
4. Prioritise P3 (DICOM extraction/provenance) next per the roadmap.
