# ERP Module Index

### 1. Radiology / USG Reporting
- **Purpose**: Main reporting workspace for radiologists and sonologists.
- **Main Folders**: `/artifacts/diagnostic-erp/src/pages/UsgReporting.tsx`, `/artifacts/api-server/src/routes/usgReports.ts`
- **Main APIs**: `/api/usg-reports`, `/api/fetal-usg`
- **Database Tables**: `fetal_usg_studies`, `fetal_usg_measurements`, `usg_key_images`
- **Dependencies**: Recharts, Drizzle ORM

### 2. PCPNDT Form F Integration
- **Purpose**: Handles regulatory Form F creation for Obstetric scans.
- **Main Folders**: `/artifacts/diagnostic-erp/src/pages/FormF.tsx`, `/artifacts/api-server/src/routes/form-f.ts`
- **Main APIs**: `/api/form-f`
- **Database Tables**: `form_f_records`, `patient_identities`
- **Dependencies**: Aadhaar OCR scanner

### 3. PACS Modality Worklist Gateway
- **Purpose**: Syncs scheduled tests to the ultrasound/CT modality worklists.
- **Main Folders**: `/bridge-service`, `/artifacts/api-server/src/routes/dicomStudyManager.ts`
- **Main APIs**: `/api/dicom-studies`
- **Database Tables**: `dicom_studies`
- **Dependencies**: Conquest C-STORE

### 4. Billing & Cash Desk
- **Purpose**: Handles patient check-ins, payment logs, and daily accounting drawer closeouts.
- **Main Folders**: `/artifacts/diagnostic-erp/src/pages/BillingDesk.tsx`, `/artifacts/api-server/src/routes/banking.ts`
- **Main APIs**: `/api/banking`
- **Database Tables**: `bills`, `payment_logs`, `day_closures`
- **Dependencies**: Razorpay/UPI gateways
