# USG Template-Store Consolidation — canonical table as the authority

**Status: implemented.**
**Resolves the "template-authority" follow-up from [`platform-consolidation-pr-b.md`](./platform-consolidation-pr-b.md) §18.2 for the live USG catalog.**

## What changed

The 13 live USG auto-generate templates (`OB_EARLY` … `CAROTID_DOPPLER`) were
hardcoded in `artifacts/api-server/src/lib/usgReportTemplates.ts` — a
code-resident template store parallel to the canonical
`structured_report_templates` table (which had zero USG rows). Admins could
edit MRI/CT/X-ray structured templates through the canonical CRUD but not the
USG ones.

Each template is now split into its two real parts:

1. **Skeleton (content, DB-authoritative).** The static report body with
   `${token}` placeholders. Seeded into `structured_report_templates`
   (modality `USG`, `studyType` = the `UsgTemplateId`, skeleton in
   `defaultFindings`) by the existing admin **POST
   `/api/structured-report-templates/seed`** endpoint — the same preset
   mechanism the MRI/CT presets already use; no SQL migration and no schema
   change. Once seeded, every render site reads the DB row first
   (`lib/usgTemplateStore.ts`), so editing the row in the canonical template
   CRUD genuinely changes generated USG reports. The code copy remains only
   as the seed source and the fail-open fallback (un-seeded or unreachable
   DB ⇒ built-in skeleton ⇒ exact pre-consolidation output).

2. **Auto-fill bindings (logic, code-owned, NOT admin-editable).** Which
   approved measurement feeds which token, the low-confidence
   `[___ low confidence – verify]` guard, the Doppler row rendering, and the
   system-owned header (patient identity) and footer (safety disclaimer).
   None of this can be changed from the DB: an admin-edited skeleton can
   reposition or drop tokens, but can never inject an unapproved value, and
   an unknown/typo'd `${token}` renders as `___`.

## Render sites wired

All three `autoGenerateReport()` call sites in `routes/usgReports.ts`
(`POST /auto-generate`, `POST /` draft creation, `POST /:id/regenerate`) pass
the DB skeleton override. `GET /usg-reports/templates` now annotates each
descriptor with `customized: true|false` (DB-backed vs built-in fallback) —
an additive response field.

Unaffected by design: `usgCompanion.ts` (uses only `suggestTemplate` /
`USG_TEMPLATES` for study-type detection), `radiologyKnowledgePacks.ts`
(validates template IDs only — the `UsgTemplateId` contract is unchanged),
and the canonical workspace's quick-select UI (same endpoint shapes).

## Proof of no clinical change

`usgReportTemplates.golden.json` (committed fixture) was captured from the
**pre-consolidation** renderer: all 13 templates × {full approved
measurements incl. a low-confidence field, completely empty}. The refactored
renderer's default path is asserted **byte-identical** on all 26 cases
(`usgReportTemplates.test.ts`), alongside override-behavior and fail-open
lookup tests (`usgTemplateStore.test.ts`).

## Operational note

Run **POST `/api/structured-report-templates/seed`** (admin; also reachable
from the template admin UI's seed action) once after deploying — it is
idempotent and now inserts the 13 USG rows alongside the existing presets.
Until then, behavior is exactly as before this change.

## Still open (unchanged by this work)

- The unwired YAML content-pack catalog (`seeds/radiology/content-packs/`)
  still has no loader — wire or formally deprecate.
- `radiologyMasterTemplates.ts` (frontend): dead as a template store but
  `criticalWatchListFor` is still imported by the canonical workspace —
  extract that before deleting the file.
- The other overlapping stores catalogued in the PR B doc §5
  (`ai_normal_report_templates`, `report_templates`, knowledge-library
  table) are separate product decisions, untouched here.
