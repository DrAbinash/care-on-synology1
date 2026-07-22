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

### Building a report (template-driven)

The workflow mirrors how radiologists actually report:

1. A **base normal format** is auto-selected from the study (or picked).
2. The radiologist searches and ticks the **abnormal findings** that apply.
3. Each abnormal **replaces that organ's normal line** in the Findings body and
   adds an **Impression line**; every other organ stays normal.

This composition is pure and deterministic
(`artifacts/diagnostic-erp/src/lib/findingsCompose.ts`, `composeReport`) and runs
client-side for instant preview. It powers two surfaces:

- the standalone **Report Builder** page (`/radiology/report-builder`), and
- the **Library** tab inside the Reporting Workspace, whose "Apply to report"
  writes the composed Findings + Impression straight into the report being edited.

The Report Builder is a **drafting aid** — every report is reviewed and signed
in the reporting workspace.
