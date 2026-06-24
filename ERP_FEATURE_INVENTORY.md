# ERP Feature Inventory: CareDeoghar Hospital ERP

This document lists all currently implemented features of the CareDeoghar Hospital ERP, categorized by primary operational groups.

---

## 1. Registration

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Patient Registration** | Patient Management | Active | `/patients/register` | `POST /api/patients` | `patients` | `/patients` | **Yes** |
| **Patient Search** | Patient Management | Active | `/patients` | `GET /api/patients/search` | `patients` | `/patients` | **Yes** |
| **Patient Profile & History** | Patient Management | Active | `/patients/:id` | `GET /api/patients/:id` | `patients`, `bills` | `/patients` | **Yes** |
| **Walk-in Registration** | Patient Management | Active | `/patients/register` | `POST /api/patients` | `patients` | `/patients` | **Yes** |
| **Appointment Scheduling** | Patient Management | Active | `/appointments` | `POST /api/appointments` | `appointments` | `/patients` | **Yes** |
| **Queue Token Assignment** | Patient Management | Active | `/queue` | `POST /api/tokens` | `queue_tokens` | `/patients` | **Yes** |
| **Queue Display Screen** | Patient Management | Active | `/queue/display` | `GET /api/tokens/active` | `queue_tokens` | None (Public View) | **Yes** |
| **Kiosk Self-Registration** | Patient Management | Partial | `/kiosk` | `POST /api/kiosk` | `patients`, `appointments` | `/kiosk` | **No** |

---

## 2. Billing

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Bill Creation & Checkout** | Billing & Payments | Active | `/billing` | `POST /api/bills` | `bills`, `bill_items`, `ledgers` | `/billing` | **Yes** |
| **Discount Management** | Billing & Payments | Active | `/discounts` | `POST /api/discounts` | `bills`, `discount_pins` | `/billing` | **Yes** |
| **Discount Override (Admin PIN)**| Billing & Payments | Active | `/billing` (modal) | `POST /api/bills/override` | `bills`, `discount_pins` | `/billing` | **Yes** |
| **Dues Management** | Billing & Payments | Active | `/dues` | `GET /api/bills/dues` | `bills` | `/billing` | **Yes** |
| **Day Close Procedure** | Billing & Payments | Active | `/day-close` | `POST /api/day-close` | `bills`, `ledgers` | `/billing` | **Yes** |
| **Health Packages** | Billing & Payments | Active | `/packages` | `GET /api/packages` | `health_packages` | `/billing` | **Yes** |
| **Daily Summary Email** | Billing & Payments | Active | N/A (Cron) | Internal trigger | `bills`, `ledgers` | System / Cron | **Yes** |

---

## 3. Laboratory

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Sample Collection & Track** | Laboratory | Active | `/samples` | `POST /api/samples/collect` | `samples`, `bill_items` | `/lab` | **Yes** |
| **Lab Result Entry** | Laboratory | Active | `/lab/results` | `POST /api/lab/results` | `lab_results` | `/lab` | **Yes** |
| **Abnormal Findings Flagging** | Laboratory | Active | `/lab/results` | `POST /api/lab/flag` | `lab_results` | `/lab` | **Yes** |
| **Test Catalog Management** | Laboratory | Active | `/tests` | `POST /api/tests` | `tests`, `test_categories` | `/lab` | **Yes** |
| **Outsourced Lab Management** | Laboratory | Active | `/lab/outsourced` | `POST /api/outsourced-labs` | `outsourced_labs` | `/lab` | **Yes** |
| **Outsource Reconciliation** | Laboratory | Active | `/lab/reconcile` | `POST /api/outsourced-labs/reconcile`| `outsourced_labs`, `bill_items` | `/lab` | **Yes** |

---

## 4. Radiology

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Radiology Worklist** | Radiology - Core | Active | `/radiology/worklist` | `GET /api/radiology` | `radiology_studies` | `/radiology` | **Yes** |
| **Command Center View** | Radiology - Core | Active | `/radiology/command-center` | `GET /api/radiology/command`| `radiology_studies` | `/radiology` | **Yes** |
| **Study Claiming** | Radiology - Core | Active | `/radiology/worklist` | `POST /api/radiology/:id/claim` | `radiology_studies` | `/radiology` | **Yes** |
| **USG / Doppler Reporting** | USG / Ultrasound | Active | `/usg/reporting` | `POST /api/usg` | `radiology_studies`, `reports`| `/radiology` | **Yes** |
| **Echocardiography Reports** | USG / Ultrasound | Active | `/echo` | `POST /api/echo` | `radiology_studies`, `reports`| `/radiology` | **Yes** |
| **Fetal USG Level-4** | USG / Ultrasound | Active | `/fetal-echo` | `POST /api/fetal-echo` | `radiology_studies`, `reports`| `/radiology` | **Yes** |
| **Form-F (Obstetric Regulatory)**| USG / Ultrasound | Active | `/usg/form-f` | `POST /api/form-f` | `form_f_records` | `/radiology` | **Yes** |
| **Teleradiology Portal** | Teleradiology | Active | `/teleradiology` | `POST /api/teleradiology` | `radiology_studies` | `/radiology` | **Yes** |

---

## 5. PACS

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Conquest Lua Hook Handler** | PACS & DICOM | Active | N/A (Internal) | `POST /api/pacs/event` | `radiology_studies` | `INTERNAL_API_KEY` | **Yes** |
| **Orthanc PACS Integration** | PACS & DICOM | Active | N/A (Internal) | `POST /api/pacs/proxy` | `pacs_settings` | `/dicom-nodes` | **Yes** |
| **OHIF Viewer Launcher** | PACS & DICOM | Active | `/viewer/:studyUid` | N/A (Viewer container) | N/A | `/radiology` | **Yes** |
| **Embedded DICOM Viewer** | PACS & DICOM | Active | `/dicom-viewer` | `GET /api/pacs/study/:id` | N/A | `/radiology` | **Yes** |
| **PACS Watchdog & Logs** | PACS & DICOM | Active | `/pacs/dashboard` | `GET /api/pacs/status` | `pacs_logs` | `/dicom-nodes` | **Yes** |
| **DICOM Query/Retrieve** | PACS & DICOM | Active | `/dicom/query-retrieve` | `POST /api/pacs/query` | `pacs_settings` | `/dicom-nodes` | **Yes** |
| **DICOM Auto-Pull (Cron)** | PACS & DICOM | Active | N/A (Cron) | Internal trigger | `pacs_settings` | System / Cron | **Yes** |
| **In-Process DIMSE Agent** | PACS & DICOM | Active | N/A (Service) | Internal service | N/A | System / CLI | **Yes** (Opt-in) |

---

## 6. Reporting

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Report Editor** | Radiology - Core | Active | `/radiology/editor/:id`| `POST /api/radiology/:id/report` | `reports`, `radiology_studies` | `/radiology` | **Yes** |
| **Report Templates** | Radiology - Core | Active | `/radiology/templates` | `POST /api/report-templates` | `report_templates` | `/radiology` | **Yes** |
| **Report Finalization & Sign** | Radiology - Core | Active | `/radiology/editor/:id`| `POST /api/radiology/:id/sign` | `reports`, `radiology_studies` | `/radiology` | **Yes** |
| **PACS Report Archival (PDF)** | PACS & DICOM | Active | N/A (Internal) | `POST /api/pacs/archive` | `reports` | `/radiology` | **Yes** |
| **QR Code Verification** | Radiology - Core | Active | `/verify/:id` | `GET /api/reports/:id/verify` | `reports` | None (Public) | **Yes** |

---

## 7. HR

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Staff Management (RBAC)** | Inventory & HR | Active | `/admin/staff` | `POST /api/users` | `users` | `/admin` | **Yes** |
| **HR Forms** | Inventory & HR | Partial | `/hr/forms` | `POST /api/hr-forms` | `hr_forms` | `/admin` | **No** |
| **Equipment Registry** | Inventory & HR | Active | `/machines` | `POST /api/machines` | `machines` | `/admin` | **Yes** |

---

## 8. CRM

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **WhatsApp Notification** | Communication | Active | `/whatsapp/send` | `POST /api/whatsapp/send` | `notifications` | `/whatsapp` | **Yes** |
| **WhatsApp Chatbot** | Communication | Partial | `/whatsapp/chatbot` | `POST /api/whatsapp/webhook` | `chatbot_sessions` | `/whatsapp` | **No** |
| **Appointment Reminders** | Communication | Partial | N/A (Cron) | Internal trigger | `notifications` | System / Cron | **No** |

---

## 9. Website

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Website Content Manager** | System Admin | Active | `/admin/website` | `POST /api/website` | `website_content` | `/admin` | **Yes** |

---

## 10. Online Booking

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Public Booking Portal** | Patient Management | Active | `/book` | `POST /api/public-bookings` | `appointments`, `patients` | None (Public) | **Yes** |
| **Booking Auto-Confirmation** | Billing & Payments | Active | `/book/confirm` | `POST /api/public-bookings/confirm`| `appointments`, `patients`, `bills` | None (Public) | **Yes** |

---

## 11. Payments

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Payment Gateway Engine** | Payment Gateways | Active | `/payments/checkout` | `POST /api/payments/checkout` | `payments` | None (Public/Staff) | **Yes** |
| **ICICI Orange Pay Gateway** | Payment Gateways | Active | `/payments/checkout` | `POST /api/payments/checkout` | `payments` | None (Public/Staff) | **Yes** |
| **PhonePe Gateway** | Payment Gateways | Active | `/payments/checkout` | `POST /api/payments/checkout` | `payments` | None (Public/Staff) | **Yes** |
| **Razorpay Gateway** | Payment Gateways | Active | `/payments/checkout` | `POST /api/payments/checkout` | `payments` | None (Public/Staff) | **Yes** |
| **Cashfree Gateway** | Payment Gateways | Active | `/payments/checkout` | `POST /api/payments/checkout` | `payments` | None (Public/Staff) | **Yes** |
| **Payment Webhooks** | Payment Gateways | Active | N/A (Internal) | `POST /api/payments/webhook` | `payments`, `bills` | None (Public) | **Yes** |

---

## 12. AI

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Local AI Draft (Ollama)** | Radiology - AI Tools | Active | `/radiology/editor/:id`| `POST /api/radiology/ai-draft` | `ai_reports_log` | `/radiology` | **Yes** |
| **Cloud AI Draft (Gemini)** | Radiology - AI Tools | Active | `/radiology/editor/:id`| `POST /api/radiology/ai-draft` | `ai_reports_log` | `/radiology` | **Yes** |
| **AI Copilot & Templates** | Radiology - AI Tools | Active | `/radiology/editor/:id`| `POST /api/radiology/copilot` | `radiology_snippets` | `/radiology` | **Yes** |
| **Spine & Brain Intelligence**| Radiology - AI Tools | Active | `/radiology/editor/:id`| `POST /api/radiology/spine-brain`| `radiology_snippets` | `/radiology` | **Yes** |
| **Smart Findings Engine** | Radiology - AI Tools | Active | `/radiology/editor/:id`| `POST /api/radiology/findings` | `smart_findings` | `/radiology` | **Yes** |
| **Tumor Follow-up Tracker** | Radiology - AI Tools | Partial | `/radiology/oncology` | `GET /api/radiology/tumor-track`| `radiology_annotations`| `/radiology` | **No** |
| **AI Annotations** | Radiology - AI Tools | Partial | `/radiology/editor/:id`| `POST /api/radiology/annotations`| `radiology_annotations`| `/radiology` | **No** |

---

## 13. Admin

| Feature | Module | Status | URL | Backend Route | Database Tables | Permissions Required | Production Ready? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **RBAC Configuration** | System Admin | Active | `/admin/rbac` | `POST /api/role-permissions` | `role_permissions` | `/admin` | **Yes** |
| **Audit Logging Dashboard** | System Admin | Active | `/admin/audit` | `GET /api/audit-logs` | `audit_logs` | `/admin` | **Yes** |
| **System Backup Replication** | System Admin | Active | `/admin/backup` | `POST /api/backup` | N/A | `/admin` | **Yes** |
| **System Health Check** | System Admin | Active | `/admin/health` | `GET /api/system-health` | N/A | `/admin` | **Yes** |
| **WebAuthn / Biometrics** | System Admin | Partial | `/admin/webauthn` | `POST /api/webauthn` | `users`, `webauthn_credentials`| `/admin` | **No** |
| **Fingerprint Bridge Service** | System Admin | Partial | N/A | Local bridge API | N/A | System / CLI | **No** |
