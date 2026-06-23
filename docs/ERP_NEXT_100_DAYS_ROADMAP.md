# Care Diagnostics ERP — Next 100 Days Roadmap

This roadmap outlines the top 10 prioritized projects for the Care Diagnostics ERP based on comprehensive assessments of security, technical debt, PACS/radiology architecture, and the system feature inventory.

---

## Priorities Legend & Ranking System
Future work is ranked in strict accordance with the following system priorities:
1. **Radiologist Productivity** (Direct workflow speedups)
2. **Billing Impact** (Revenue assurance, commission tracking, and audit trails)
3. **Patient Experience** (WhatsApp chatbot, portals, check-in flows)
4. **PACS Stability** (DICOM reliability, modality integrations)
5. **Security** (Vulnerability mitigation, data encryption, RBAC enforcement)
6. **Technical Debt Reduction** (Code consolidation, dead code removal)

---

## Top 10 Projects

### Project 1: Browser-Based Voice Dictation Integration 🎙️
*   **Primary Driver:** Radiologist Productivity (Rank 1)
*   **Description:** Complete the partial [VoiceDictation.tsx](file:///c:/Users/abina/caredeoghar--antigravity/src/pages/VoiceDictation.tsx) integration utilizing browser Speech Recognition APIs. Connect it to custom macro triggers in the reporting workspace so radiologists can dictate reports instead of typing.
*   **Estimated Effort:** 16 hours
*   **Expected Impact:** Reduces reporting time by up to 50% per study.

### Project 2: Personal Macros & Findings Shortcuts Expansion ⚡
*   **Primary Driver:** Radiologist Productivity (Rank 1)
*   **Description:** Expand the [radiologySnippets.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/radiologySnippets.ts) and personal favorites logic. Allow radiologists to configure custom text shortcuts (e.g., typing `.norm-cervical` auto-expands into the full normal cervical spine text block) directly within [RadiologyReportingWorkspace.tsx](file:///c:/Users/abina/caredeoghar--antigravity/src/pages/RadiologyReportingWorkspace.tsx).
*   **Estimated Effort:** 12 hours
*   **Expected Impact:** Minimal keystrokes for standard normal/abnormal reports.

### Project 3: Embedded Lesion Tracker & OHIF Measurement Wiring 📏
*   **Primary Driver:** Radiologist Productivity (Rank 1)
*   **Description:** Connect the partial [radiologyLesions.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/radiologyLesions.ts) and oncology follow-up tracker to the OHIF viewer instance. Enable automatic extraction of linear/volumetric measurements from DICOM SR (Structured Report) or viewer states into the reporting workspace to prevent manual copy-paste errors.
*   **Estimated Effort:** 24 hours
*   **Expected Impact:** Eliminates copy-paste transcription errors for tumor sizes.

### Project 4: Financial Ledger Integrity & Automated Commission Sanity Checks 💰
*   **Primary Driver:** Billing Impact (Rank 2)
*   **Description:** Enhance the monthly automated money-trail audit (`fireMonthlyAudit`) and [books-sanity.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/books-sanity.ts) checking. Secure billing modifications by requiring admin PINs for any discounts, preventing commission leakage on referring doctor ledgers.
*   **Estimated Effort:** 16 hours
*   **Expected Impact:** Guarantees 100% money-trail alignment and removes billing loopholes.

### Project 5: Interactive WhatsApp Chatbot for Reports & Queue Queries 💬
*   **Primary Driver:** Patient Experience (Rank 3)
*   **Description:** Expand the incomplete [waChatbot.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/waChatbot.ts) flows. Build automated interactive pathways enabling patients to retrieve report PDF links, check their live token queue position, and request appointments directly from WhatsApp.
*   **Estimated Effort:** 20 hours
*   **Expected Impact:** Reduces reception call volume and provides instant access for patients.

### Project 6: Self-Service Patient Portal & Referrer Access Expansion 🌐
*   **Primary Driver:** Patient Experience (Rank 3)
*   **Description:** Upgrade the [Portal.tsx](file:///c:/Users/abina/caredeoghar--antigravity/src/pages/Portal.tsx) interface. Allow referring clinics and patients to view historical diagnostic orders, download signed PDF reports, and view dynamic scan key images through secure, cryptographically hashed public links (resolving guessable ID leaks).
*   **Estimated Effort:** 18 hours
*   **Expected Impact:** Better referrer integration and secure patient self-service.

### Project 7: Modality Worklist (MWL) Local SCP Container Deployment 🖥️
*   **Primary Driver:** PACS Stability (Rank 4)
*   **Description:** Fully deploy the Modality Worklist (MWL) service using an Orthanc Lua script or a Conquest configuration. Connect modalities (MRI, CT, USG) directly to the ERP patient scheduler so technicians do not have to manually input patient details, eliminating ID typos.
*   **Estimated Effort:** 24 hours
*   **Expected Impact:** 100% alignment between scan files and billing/ERP registration.

### Project 8: In-Process Native DIMSE Auto-Pull Agent Upgrade 🔄
*   **Primary Driver:** PACS Stability (Rank 4)
*   **Description:** Enable the Node.js native [dimse-agent.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts) via `ENABLE_DICOM_PULL_AGENT=1`. Secure internal webhook endpoints and retire the legacy node process root folder (`dicom-pull-agent/`), moving study query/retrieve fully inside the main backend container.
*   **Estimated Effort:** 14 hours
*   **Expected Impact:** Robust, in-app query-retrieve and simpler system deployment topology.

### Project 9: Physical USB Admin Gate Hardening & Security Mitigations 🔑
*   **Primary Driver:** Security (Rank 5)
*   **Description:** Secure the physical USB token check in [requireSuperAdminUsb.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/middleware/requireSuperAdminUsb.ts) to throw an error if the environment variable `SUPER_ADMIN_USB_KEY` is not defined (failing closed instead of open). Restrict PostgreSQL binding on port `5400` strictly to localhost.
*   **Estimated Effort:** 8 hours
*   **Expected Impact:** Secures critical super-admin actions and isolates the database.

### Project 10: Three-Way Report Generator Consolidation 🧹
*   **Primary Driver:** Technical Debt Reduction (Rank 6)
*   **Description:** Merge features from `ReportGenerator.tsx` and `RadiologyReportGenerator.tsx` into [RadiologyReportingWorkspace.tsx](file:///c:/Users/abina/caredeoghar--antigravity/src/pages/RadiologyReportingWorkspace.tsx). Remove duplicate files, set redirects for legacy endpoints, and deprecate the old `RadiologyLegacy.tsx` page.
*   **Estimated Effort:** 32 hours
*   **Expected Impact:** Eliminates duplicate maintenance of rendering interfaces and decreases bundle size.
