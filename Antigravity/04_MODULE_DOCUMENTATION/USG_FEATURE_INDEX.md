# USG & Doppler Feature Index

| Feature | Status | Backend Files | Frontend Files | Database Tables | API Routes | Dependencies |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Voluson Ingestion** | ✔ Complete | `dicomStudyManager.ts` | `MwlDashboard.tsx` | `dicom_studies` | `/api/dicom-studies` | Conquest DICOM agent |
| **DICOM SR Parsing** | ✔ Complete | `usgExtraction.ts` | `UsgMeasurementReview.tsx`| `usg_measurements` | `/api/usg-extraction`| Node-Postgres |
| **OCR Fallback** | ✔ Complete | `usgExtraction.ts` | `UsgMeasurementReview.tsx`| `usg_extraction_logs` | `/api/usg-extraction`| Tesseract.js / OCR service |
| **PCPNDT Form F Prefill**| ✔ Complete | `form-f.ts` | `FormF.tsx` | `form_f_records` | `/api/form-f` | Clinic Settings |
| **Measurement Provenance**| ✔ Complete| `usgExtraction.ts` | `UsgMeasurementReview.tsx`| `usg_measurements` | `/api/usg-extraction`| Drizzle ORM |
| **AI Key Image Selection**| ✔ Complete | `pregnancyDashboard.ts` | `PregnancyDashboard.tsx` | `usg_key_images` | `/api/fetal-usg-dashboard`| WADO service |
| **Pregnancy Timeline** | ✔ Complete | `pregnancyDashboard.ts` | `PregnancyDashboard.tsx` | `pregnancy_episodes` | `/api/fetal-usg-dashboard`| Recharts |
| **AI Sonologist Assistant**| ✔ Complete | `sonologistAssistant.ts` | `SonologistAssistantPanel.tsx` | `radiologist_learning_settings` | `/api/radiology-copilot/sonologist-assistant`| NLP / Ollama / Mocked AI |
| **Voice Post-dictation** | ✔ Complete | `sonologistAssistant.ts` | `SonologistAssistantPanel.tsx` | `radiology_memory_phrases` | `/api/radiology-copilot/sonologist-assistant`| Web Speech API |
| **Audit Trails** | ✔ Complete | `pregnancyDashboard.ts` | `UsgReporting.tsx` | `usg_audit_log` | `/api/fetal-usg-dashboard`| Drizzle ORM |
