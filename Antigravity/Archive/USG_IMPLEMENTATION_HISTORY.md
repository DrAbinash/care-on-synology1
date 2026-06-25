# USG & Doppler Implementation History

### Phase 1: Voluson Push
* **Goal**: Establish GE Voluson E9 TCP connectivity and image ingestion.
* **Files Changed**: `dicomStudyManager.ts`, `dicomRoutingRules.ts`
* **Database Changes**: `dicom_studies`
* **APIs**: `/api/dicom-studies/intake`
* **UI**: Modality management dashboard
* **Result**: Raw studies received.

### Phase 2: Direct DICOM Extraction
* **Goal**: Hierarchical retrieval of pixel data and headers.
* **Files Changed**: `dicomStudyManager.ts`, `usgExtraction.ts`
* **Result**: Frame extraction verified.

### Phase 3: PCPNDT Integration
* **Goal**: Auto-populate Form F regulatory details.
* **Files Changed**: `clinicSettings.ts`, `formF.ts`, `form-f.ts`, `FormF.tsx`
* **Database Changes**: Added `auto_populate_form_f_from_ob_measurements` settings column and `fetal_usg_study_id` reference.
* **Result**: Biometric prefill functionality.

### Phase 5: Measurement Provenance
* **Goal**: Audit source of measurements.
* **Files Changed**: `usgMeasurements.ts`, `usgExtraction.ts`
* **Result**: Values labeled as manual, OCR, or DICOM SR.

### Phase 6 & 7: AI Key Image Selection + Pregnancy Timeline
* **Goal**: Rank candidates, select key frames, timeline serial grouping, and Recharts plotting.
* **Files Changed**: `pregnancyEpisodes.ts`, `pregnancyDashboard.ts`, `PregnancyDashboard.tsx`, `App.tsx`, `UsgDoppler.tsx`
* **Database Changes**: Added `pregnancy_episodes` table and ranking columns to `usg_key_images`.
* **Result**: Pregnancy timeline dashboard functional.

### Phase 8: AI Sonologist Assistant
* **Goal**: Side-by-side co-pilot, quality review alerts, and post-dictation formatting.
* **Files Changed**: `radiologistLearningSettings.ts`, `sonologistAssistant.ts`, `SonologistAssistantPanel.tsx`, `UsgReporting.tsx`
* **Database Changes**: Added `radiologist_learning_settings` table.
* **Result**: Sonologist Assistant panel side-by-side with report editor.
