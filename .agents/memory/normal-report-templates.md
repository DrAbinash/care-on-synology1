---
name: Normal Report Templates
description: One-click pre-built normal templates for common radiology studies; applies from report generator toolbar.
---

## Rule
Every normal template in the system is:
- Pre-built for common studies (e.g., MRI Brain, CT Chest, USG Abdomen)
- Stored in `ai_normal_report_templates` with name, modality, findings, impression, technique, clinicalHistory, comparison
- Unique by `(name, modality)` via partial index
- Loaded with modality filter so radiologists see only relevant templates
- Applied from a "Normal Template" button in the **Radiology Report Generator** toolbar
- **Never auto-finalizes** — shows "AI Draft – Requires Radiologist Review" and requires manual Save/Generate

## How to apply
From the report generator toolbar:
1. Click **Normal Template** → opens picker overlay
2. Picker filters by the current study's modality (auto)
3. Select a template, click **Apply**
4. Findings + impression populate instantly
5. Radiologist can edit and then click **Generate** / **Save Final**

## Integration points
- `RadiologyReportGenerator.tsx`: toolbar button + inline picker overlay
- `NormalReportTemplates.tsx`: standalone library page (grid, filter, add, delete, apply)
- Backend: `aiReporting.ts` with GET/POST/PATCH/DELETE/apply endpoints
- DB: `ai_normal_report_templates` table + startup migration

## Why
60–70% of radiology studies are normal. One-click normal templates save radiologist time while preserving the AI safety label requirement.