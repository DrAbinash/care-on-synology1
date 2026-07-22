# Radiology report formats & the Report Builder findings library

This folder holds the practice's historical report samples (`ct/`, `usg/`,
`xray/`, `mri/`) used to reverse-engineer the house reporting style.

## Findings library (Report Builder)

The **Report Builder** page (`/radiology/report-builder`) is powered by a
searchable, de-identified findings catalogue mined from these samples:

- **Served asset:** `artifacts/diagnostic-erp/public/data/radiology-findings-library.json`
  (loaded directly by the browser for instant offline search).
- **Contents:** ~3,900 house-style findings grouped by modality → region →
  organ/section, each tagged normal/abnormal with a usage frequency, plus 47
  per-study normal templates (technique + section normals + normal impression).

### How it was produced (provenance)

1. Text was extracted from the legacy `.doc` (OLE) and `.docx` samples
   (~4,700 readable reports, 96% of the archive).
2. **De-identification** — patient names, ages, referring-doctor names and
   dates were stripped. Only clinical phrasing (technique / findings /
   impression) is retained; the library holds **no patient data**.
3. Sentences were cleaned, de-duplicated, measurement values collapsed to
   placeholders (e.g. `___ cm`), and classified by study title.

### Merging findings into one report

`POST /api/radiology/findings-library/merge` combines several selected findings
into one house-style report — Findings grouped by organ in anatomical order and
a numbered Impression built from the abnormal ones. It is pure and deterministic
(`artifacts/api-server/src/lib/findingsMerge.ts`); an optional `mode: "ai"`
smooths the prose without adding or removing any finding.

The Report Builder is a **drafting aid** — every report is reviewed and signed
in the reporting workspace.
