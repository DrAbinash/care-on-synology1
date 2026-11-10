---
name: Reporting-workspace re-audit (2026-11-10)
description: The 15-batch demography→composer→print remediation campaign — where it lives, and the two ways it broke CI so the next campaign doesn't repeat them.
---

## What this was

Full re-audit of the reporting workspace (demography card → key images/VOI →
finding/AI composer → the four export doors → PDF/Word/preview/print):
**22 verified bugs + 16 enhancements**, landed as 15 batches on
`fix/reaudit-demography-to-print` (PR #1318 for batches 1–14, then batch 15 +
wrap-up pushed straight to main).

- Findings and batch map: `docs/audits/care-erp-reporting-workspace-reaudit-2026-11-10.md`
- Finding IDs cited in commits/tests: `A-1…A-13` (bugs), `X-1…X-9` (export bugs), `E-1…E-16` (enhancements)
- Key durable designs: `readExportAuthorization()` in `useWorkspaceExportShare.ts`
  is the ONE authorization reader every export door shares (E-9);
  `buildClientPreviewHtml()` is the one client-HTML builder (X-4/E-14);
  `GET /api/patient-reports/:id/pdf?archive=1` is the PDF/A door — 501 when no
  Ghostscript, 502 on failed conversion, bookkeeping only after bytes exist (E-12).

## Two ways this campaign broke CI — the lessons

**1. The testids fixture is an exact-set gate.**
`radiologyReportingWorkspace.testids.test.ts` asserts the live `data-testid`
inventory of the workspace tree EQUALS the fixture array exactly. Deleting a
testid from JSX (e.g. the dead `report-format-primary-slot`, A-13) without
deleting the fixture entry in the SAME commit turns the whole suite red.
Rule: any commit that adds/removes a static `data-testid` in
`pages/RadiologyReportingWorkspace.tsx`, `hooks/radiology-workspace/`, or
`components/radiology/workspace/` must update
`lib/fixtures/radiologyReportingWorkspace.testids.json` with it.

**2. Source-contract pins must be repinned in the batch that moves the source.**
Five suites failed on main (run 2968) because earlier batches changed source
spellings (`authorizedArtifact: Boolean(linkedReportId)` → `linkedReportSigned
=== true`; `loadSignerOfRecord(` in the print body → `readExportAuthorization(`;
`rawFindings:` in the preview memo → inside `buildClientPreviewHtml`; a
`contentLocked` count) while the pinned contract tests were never run in the
batch's scoped vitest set. Rule: after any batch that renames/moves an
identifier, grep the test tree for the OLD spelling
(`rg "<old spelling>" artifacts/*/src --glob '*.test.*'`) and repin in the same
commit — scoped runs only cover what you remember to run.
