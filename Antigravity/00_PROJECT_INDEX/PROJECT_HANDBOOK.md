# Care Diagnostics ERP — Project Handbook

## 1. Project Overview
Care Diagnostics ERP is a comprehensive, production-grade clinical information system (CIS) and radiology information system (RIS) integrated with PACS (Conquest) and viewers (OHIF/Weasis). It supports appointment booking, self-registration kiosks, billing desk workflows, ICICI payment gateway reconciliations, and advanced AI co-pilot reporting for ultrasound (USG), Doppler, CT, and MRI scans.

---

## 2. Technology Stack
- **Backend Core**: Node.js, Express, TypeScript.
- **Database Layer**: PostgreSQL, Drizzle ORM.
- **Frontend Core**: React, Vite, Tailwind CSS, Wouter, Radix UI.
- **PACS & Modality**: Conquest PACS, Conquest Lua scripting, WADO query-retrieve.
- **AI Integrations**: Ollama (local Llama/Mistral), Web Speech API, Tesseract.js OCR.
- **Deployment**: Docker, Docker Compose, Synology NAS, Cloudflare Tunnel.

---

## 3. Folder Structure
- `/artifacts/api-server`: Backend Express REST API codebase.
- `/artifacts/diagnostic-erp`: Frontend Vite-React single-page application.
- `/lib/db`: Shared PostgreSQL database schemas and Drizzle migrations.
- `/conquest`: PACS Conquest server config files.
- `/bridge-service`: Conquest-to-ERP DICOM worklist integration daemon.

---

## 4. Key Modules & Services
- **USG / Doppler Module**: Biometric entry, checklists, timeline progression, AI image ranks, and reporting co-pilot.
- **Form F (PCPNDT)**: Aadhaar card OCR validation, consent signatures, and auto-population from OB scans.
- **Billing & Accounting**: Multi-ledger doctor commission payments, cash drawer audit logs, and daily close balances.
- **PACS Worklist & Viewer**: DICOM modality worklist (MWL) query gateway, launching OHIF and Weasis.
