# Radiology Knowledge Base Audit — Care Diagnostics ERP

This audit compiles a thorough assessment of the Care Diagnostics Radiology Knowledge Base, covering Chocolate Box findings, structured templates, normal templates, macros, and AI prompt templates. It identifies duplication, modality coverage gaps, standardization pathways, and presents a low-risk cleanup roadmap.

---

## 1. Modality Coverage Analysis

The table below catalogs current template, findings, and impressions coverage counts across the primary modalities:

| Modality | Number of Templates | Number of Findings | Number of Impressions | Coverage Estimate | Missing / Under-Represented Areas |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MRI** | 6 | ~60 | ~20 | 85% | MR Angiography (MRA) structured reports, Joint-specific contrast MRIs, Pelvis/Prostate mappings. |
| **CT** | 4 | ~45 | ~15 | 80% | CT Angiographies (coronary/renal), Spine-specific CTs (Cervical/Lumbar/Dorsal), Neck/Orbit CTs. |
| **X-Ray** | 2 | ~15 | ~5 | 50% | Joint-specific views (Knee, Shoulder, Hip), Sinus views (PNS Water's view), Abdomen erect/supine. |
| **USG** | 1 | ~12 | ~4 | 40% | USG Pelvis, Obstetric (Aneuploidy screening, growth scans), Thyroid/Neck, Small parts (Scrotum/Testes). |
| **Mammography** | 0 | 0 | 0 | 0% | Completely missing. Requires BI-RADS structured templates and screening/diagnostic layouts. |
| **Doppler** | 1 | ~10 | ~2 | 30% | Renal Doppler, Arterial/Venous extremity Doppler (Upper/Lower limbs), Portal vein Doppler. |

---

## 2. Issues Identification & Prioritization

### 2.1 High Priority Issues
1. **Mammography Gap**: Total absence of templates, findings, and BI-RADS configurations for Mammography, leaving radiologists to type reports manually.
2. **Obstetric Ultrasound Deficit**: No structured templates or findings lists for Obstetric/Pregnancy ultrasounds (First Trimester, Anomaly scan, Obstetric Doppler).
3. **Database vs Preset Overlaps**: Seeding scripts do not verify if customized versions of preset templates already exist in `structuredReportTemplatesTable` under non-preset flags, creating potential user duplicates when re-seeding.

### 2.2 Medium Priority Issues
1. **Spine Macro Redundancies**: High overlap between Spine findings macros inside `structuredReportTemplatesTable` and the central smart findings definitions in `radiologySmartEngine.ts`.
2. **Missing MRA Brain prompt details**: The "MRI Brain" prompt template does not explicitly structure vascular details when combined with MRA TOF sequences.
3. **Plain vs Contrast Template Duplication**: Plain and contrast brain MRI templates share 80% of identical anatomical finding lines, leading to duplicate management overhead.

### 2.3 Low Priority Issues
1. **Inconsistent Naming Formats**: "USG Abdomen" vs "USG Whole Abdomen" naming discrepancies between preset lists and DB settings.
2. **Unused Prompt Templates**: The prompt library holds "MRI Orbit" and "MRI Hip" prompts, but no structured database templates exist to back them, leaving them mostly unused in daily worklists.

---

## 3. Standardization Recommendations

### 3.1 Preferred Wording & Style Guide
- **Impressions Style**: Every impression must conclude with a clear summary sentence (e.g. `No acute intracranial pathology detected.`) rather than trailing lists.
- **Severity Flagging**: Bold key terms in findings (e.g. **Acute Infarct**, **Severe Canal Stenosis**) to support downstream critical notification parsers.
- **Reporting Structure**: Follow a rigid sequence-wise pattern (e.g., Alignment -> Vertebrae -> Discs -> Cord) for all spine studies, matching the automated merge parser.

### 3.2 Template Consolidation Opportunities
- Merge **MRI Brain Plain** and **MRI Brain With Contrast** into a single dynamic template that automatically toggles the post-contrast sections based on whether contrast was administered.
- Consolidate spine segments: standard spine findings categories can share a single base `findingsItems` JSON schema with conditional segments for cervical, dorsal, or lumbar.

---

## 4. AI Prompt Template Audit

### Curated Prompt Templates Library
- **MRI Brain**: Structured sequence-by-sequence prompt. Matches well, no conflicts.
- **MRI Pituitary**: Highly specific. Unused in the default presets list but useful for manual overrides.
- **MRI Whole Spine Screening**: Redundant with separate cervical/dorsal/lumbar prompts.
- **CT PNS**: Standardized and robust.
- **USG Breast**: Contains TI-RADS / BI-RADS scoring directives.

### Prompt Improvements
- Update **MRI Whole Spine Screening** to guide Gemini/local Llama3 models to explicitly merge findings from different segments without repeating introductory techniques or concluding sentences.
- Add an **Obstetric Ultrasound** prompt template detailing gestational age, FHR, presentation, and liquor parameters.

---

## 5. Recommended Cleanup Roadmap (Audit Only)

```
[Phase 1: Add Missing Core] ────> [Phase 2: Consolidate Spine/Brain] ────> [Phase 3: Standardize Prompts]
(Mammography & Obstetric USG)      (Merge plain/contrast templates)       (Remove unused Orbit/Hip prompts)
```

1. **Phase 1: Seed Missing Modalities**:
   - Introduce 3 new templates for Mammography (Left/Right BI-RADS), Obstetric USG, and Extremity Doppler.
2. **Phase 2: Consolidate Overlapping Templates**:
   - Safely archive duplicate plain/contrast templates in the UI settings panel.
3. **Phase 3: Refine AI Prompts**:
   - Align AI prompt versioning (currently version 1) to reference the dynamic merge engine technique definitions.
