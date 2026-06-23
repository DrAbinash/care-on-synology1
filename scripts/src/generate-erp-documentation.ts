import {
  Document, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableCell, TableRow, WidthType, BorderStyle, Packer,
  NumberFormat, convertInchesToTwip, Header, Footer, PageNumber,
} from "docx";
import fs from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: create a bordered table
// ─────────────────────────────────────────────────────────────────────────────
function borderedTable(rows: TableRow[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
    },
  });
}

function hCell(text: string, width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: { fill: "1F4E79", color: "FFFFFF" },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })],
    })],
  });
}

function cCell(text: string, width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })],
  });
}

function cCellMulti(lines: string[], width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: lines.map(l => new Paragraph({
      children: [new TextRun({ text: l, size: 18 })],
      spacing: { after: 60 },
    })),
  });
}

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 300, after: 150 },
  });
}

function body(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, size: 21 })],
    spacing: { after: 120 },
  });
}

function bold(text: string) {
  return new TextRun({ text, bold: true, size: 21 });
}

function bullet(text: string) {
  return new Paragraph({
    children: [new TextRun({ text: "\u2022 " + text, size: 21 })],
    spacing: { after: 80 },
    indent: { left: convertInchesToTwip(0.3) },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT CONTENT
// ─────────────────────────────────────────────────────────────────────────────
const children: any[] = [];

// ── TITLE PAGE ──────────────────────────────────────────────────────────────
children.push(new Paragraph({ text: "", spacing: { before: 2000 } }));
children.push(new Paragraph({
  text: "CARE DIAGNOSTICS ERP",
  alignment: AlignmentType.CENTER,
  heading: HeadingLevel.TITLE,
  spacing: { after: 200 },
}));
children.push(new Paragraph({
  text: "Comprehensive System Documentation",
  alignment: AlignmentType.CENTER,
  heading: HeadingLevel.HEADING_1,
  spacing: { after: 400 },
}));
children.push(new Paragraph({
  text: "Hospital-Grade Diagnostic Center Management Platform",
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
}));
children.push(new Paragraph({
  text: "Version 2026.05  |  Confidential",
  alignment: AlignmentType.CENTER,
  spacing: { after: 1200 },
}));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── TABLE OF CONTENTS ───────────────────────────────────────────────────────
children.push(heading("Table of Contents"));
const tocItems = [
  "1. Executive Summary",
  "2. System Architecture & Technology Stack",
  "3. Module Overview (All 30+ Modules)",
  "4. The Money Trail: Bill to Bank",
  "5. DICOM / PACS & Radiology Workflow",
  "6. Staff Role-Based Access Control",
  "7. Radiology Reporting Engine",
  "8. Security, Audit & Compliance",
  "9. Installation & Deployment",
  "10. Future Roadmap & Recommendations",
];
tocItems.forEach(item => children.push(bullet(item)));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 1. EXECUTIVE SUMMARY ────────────────────────────────────────────────────
children.push(heading("1. Executive Summary"));
children.push(body("Care Diagnostics ERP is a hospital-grade, all-in-one management platform designed for pathology and radiology centers. It unifies patient registration, test ordering, billing, accounting, inventory, radiology workflow, PACS integration, AI-assisted reporting, staff management, and a public-facing clinic website into a single cohesive system."));
children.push(body("Built on a TypeScript pnpm monorepo with an Express 5 API server, PostgreSQL database via Drizzle ORM, and multiple React/Vite frontend artifacts, the system is designed for cross-platform deployment on Windows, Linux, Docker, and Synology NAS environments."));
children.push(heading("Key Highlights", HeadingLevel.HEADING_2));
[
  "Unified single-page billing workflow with per-test queue tokens",
  "Immutable append-only audit trail for every sensitive action",
  "Granular role-based permissions: 8 roles x 13 modules x 10 permission bits",
  "AI-powered clinical note generation, billing insights, and report drafting",
  "Full DICOM/PACS integration with Orthanc, Weasis, and OHIF viewers",
  "Teleradiology with tokenized share links and multi-site worklists",
  "Automated bank reconciliation with fraud detection",
  "Biometric fingerprint kiosk for staff attendance and login",
  "USB pen-drive gate for super-admin access (physical security layer)",
  "WhatsApp and email notifications for bills, reports, and appointments",
].forEach(t => children.push(bullet(t)));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 2. SYSTEM ARCHITECTURE ──────────────────────────────────────────────────
children.push(heading("2. System Architecture & Technology Stack"));
children.push(heading("2.1 Monorepo Structure", HeadingLevel.HEADING_2));
children.push(body("The project is organized as a pnpm workspace monorepo with shared libraries and multiple deployable artifacts:"));

const archRows = [
  new TableRow({ children: [hCell("Layer", 25), hCell("Technology", 25), hCell("Purpose", 50)] }),
  new TableRow({ children: [cCell("Monorepo Tool"), cCell("pnpm workspaces"), cCell("Package discovery, catalog pins, overrides")] }),
  new TableRow({ children: [cCell("Runtime"), cCell("Node.js 24"), cCell("Server-side JavaScript execution")] }),
  new TableRow({ children: [cCell("Language"), cCell("TypeScript 5.9"), cCell("Type-safe development across all packages")] }),
  new TableRow({ children: [cCell("API Framework"), cCell("Express 5"), cCell("RESTful HTTP API server")] }),
  new TableRow({ children: [cCell("Database"), cCell("PostgreSQL + Drizzle ORM"), cCell("Relational data with schema-first migrations")] }),
  new TableRow({ children: [cCell("Validation"), cCell("Zod + drizzle-zod"), cCell("Runtime input/output validation")] }),
  new TableRow({ children: [cCell("API Codegen"), cCell("Orval (OpenAPI)"), cCell("Auto-generate client hooks and schemas")] }),
  new TableRow({ children: [cCell("Frontend"), cCell("React 19 + Vite 7"), cCell("SPA web applications")] }),
  new TableRow({ children: [cCell("UI Library"), cCell("shadcn/ui + Tailwind"), cCell("Component design system")] }),
  new TableRow({ children: [cCell("AI Integration"), cCell("Gemini API (Replit AI)"), cCell("Clinical notes, insights, report drafting")] }),
  new TableRow({ children: [cCell("Email"), cCell("Nodemailer"), cCell("SMTP-based notifications")] }),
  new TableRow({ children: [cCell("Scheduling"), cCell("node-cron"), cCell("In-process background tasks")] }),
  new TableRow({ children: [cCell("PACS"), cCell("Orthanc DICOM"), cCell("DICOM storage and REST proxy")] }),
  new TableRow({ children: [cCell("Build"), cCell("esbuild (CJS bundle)"), cCell("Fast server bundling")] }),
  new TableRow({ children: [cCell("Auth"), cCell("Bearer tokens + WebAuthn"), cCell("Staff sessions + biometric login")] }),
];
children.push(borderedTable(archRows));

children.push(heading("2.2 Deployable Artifacts", HeadingLevel.HEADING_2));
const artifactRows = [
  new TableRow({ children: [hCell("Artifact", 25), hCell("Path", 20), hCell("Purpose", 55)] }),
  new TableRow({ children: [cCell("api-server"), cCell("/api"), cCell("Express API + database + static file serving")] }),
  new TableRow({ children: [cCell("diagnostic-erp"), cCell("/erp"), cCell("Staff ERP dashboard (billing, orders, reports, inventory)")] }),
  new TableRow({ children: [cCell("clinic-site"), cCell("/"), cCell("Public clinic website with dynamic content builder")] }),
  new TableRow({ children: [cCell("super-admin-portal"), cCell("/super-admin-portal"), cCell("Super admin dashboard (backups, audit, permissions, health)")] }),
  new TableRow({ children: [cCell("diagno-booking-mobile"), cCell("Mobile app"), cCell("Expo React Native patient booking app")] }),
  new TableRow({ children: [cCell("bridge-service"), cCell("Localhost"), cCell("Workstation-local fingerprint/DICOM bridge")] }),
];
children.push(borderedTable(artifactRows));

children.push(heading("2.3 Database Schema Overview", HeadingLevel.HEADING_2));
children.push(body("The PostgreSQL database contains 80+ tables organized into the following domains:"));
[
  "Patient Management: patients, patient_relatives, patient_documents",
  "Test Catalog: tests, test_categories, test_groups, packages, package_tests",
  "Orders & Billing: orders, order_tests, bills, payments, bill_audits, test_tokens",
  "Lab Workflow: samples, sample_test_assignments, sample_status_logs",
  "Radiology: radiology_studies, radiology_worklist, mwl_entries, dicom_incoming_studies, radiology_report_drafts",
  "PACS: pacs_settings, dicom_nodes, dicom_pull_jobs, dicom_pulled_studies, dicom_routing_rules",
  "Reporting: patient_reports, report_templates, signatures, report_delivery_logs",
  "Accounting: accounts, vouchers, voucher_audits, ledgers, day_closures",
  "Inventory: inventory_items, inventory_transactions, inventory_consumption_rules, vendors",
  "Commission: commission_rules, doctor_payouts, commission_reports",
  "Banking: bank_accounts, bank_transactions, payment_requests, refund_requests, reconciliation_logs, fraud_alerts",
  "Staff & HR: users, staff, staff_advances, staff_salary_payments, staff_attendance, staff_biometric_credentials, hr_rejoining_forms",
  "Appointments: appointments, online_bookings, appointment_slots",
  "Website Builder: site_settings, site_pages, site_popups",
  "Security & Audit: audit_logs, role_permissions, upload_files, backup_logs, backup_jobs, backup_job_logs",
  "AI & Automation: ai_provider_settings, ai_reporting_audit_logs, ai_reporting_drafts, ai_job_queue",
  "Teleradiology: teleradiology_users, teleradiology_sessions, teleradiology_assignments",
  "HL7 Integration: hl7_integration_settings, hl7_messages",
  "Machines & Maintenance: machines, machine_maintenance_logs, machine_calibration_logs",
  "Locations: floors, rooms, modalities, departments, branches",
].forEach(t => children.push(bullet(t)));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 3. MODULE OVERVIEW ──────────────────────────────────────────────────────
children.push(heading("3. Complete Module Overview"));
children.push(body("The ERP system comprises 30+ functional modules. Each module has dedicated API routes, database tables, and frontend pages. Below is the complete module catalog:"));

const modRows = [
  new TableRow({ children: [hCell("#", 5), hCell("Module", 18), hCell("Description", 40), hCell("Key Tables", 37)] }),
  new TableRow({ children: [cCell("1"), cCell("Patient Management"), cCell("Registration, demographics, relatives, documents, UHID generation"), cCell("patients, patient_relatives, patient_documents")] }),
  new TableRow({ children: [cCell("2"), cCell("Test Catalog"), cCell("Tests, categories, groups, packages, pricing, reference ranges"), cCell("tests, test_categories, test_groups, packages, package_tests")] }),
  new TableRow({ children: [cCell("3"), cCell("Orders"), cCell("Test ordering, status tracking, sample linking"), cCell("orders, order_tests")] }),
  new TableRow({ children: [cCell("4"), cCell("Billing Desk"), cCell("Unified billing workflow: search, register, add tests, discounts, payments, receipts"), cCell("bills, payments, bill_audits, ledgers")] }),
  new TableRow({ children: [cCell("5"), cCell("Payments"), cCell("Cash, UPI, Card, split payments, refunds, auto-vouchers"), cCell("payments, voucher_audits, day_closures")] }),
  new TableRow({ children: [cCell("6"), cCell("Lab Reports"), cCell("Result entry, auto-flagging, verification, signatures, PDF generation"), cCell("patient_reports, signatures, report_templates")] }),
  new TableRow({ children: [cCell("7"), cCell("Sample Management"), cCell("Barcode generation, collection, routing, status tracking"), cCell("samples, sample_test_assignments, sample_status_logs")] }),
  new TableRow({ children: [cCell("8"), cCell("Test Tokens"), cCell("Per-test queue tokens for lab and radiology departments"), cCell("test_tokens")] }),
  new TableRow({ children: [cCell("9"), cCell("Radiology Studies"), cCell("Study scheduling, accession numbers, modality worklist"), cCell("radiology_studies, mwl_entries, radiology_worklist")] }),
  new TableRow({ children: [cCell("10"), cCell("PACS Viewer"), cCell("Orthanc proxy, DICOM studies, WADO-URI, Weasis/OHIF launch"), cCell("pacs_settings, dicom_nodes, dicom_pulled_studies")] }),
  new TableRow({ children: [cCell("11"), cCell("Radiology Reporting"), cCell("Template library, voice dictation, AI cleanup, draft save, key images"), cCell("radiology_report_drafts, radiology_text_macros, radiology_key_images")] }),
  new TableRow({ children: [cCell("12"), cCell("Structured Reports"), cCell("Predefined templates for USG, CT, MRI with auto-fill fields"), cCell("structured_report_templates, radiology_structured_templates")] }),
  new TableRow({ children: [cCell("13"), cCell("Teleradiology"), cCell("Remote reporting, share links, multi-site worklists"), cCell("teleradiology_users, teleradiology_assignments, radiology_share_links")] }),
  new TableRow({ children: [cCell("14"), cCell("AI Reporting"), cCell("Gemini-powered report drafting, enhancement, measurement extraction"), cCell("ai_reporting_drafts, ai_reporting_audit_logs, ai_job_queue")] }),
  new TableRow({ children: [cCell("15"), cCell("Inventory"), cCell("Stock management, reagent tracking, vendor orders, consumption rules"), cCell("inventory_items, inventory_transactions, vendors, inventory_consumption_rules")] }),
  new TableRow({ children: [cCell("16"), cCell("Vendors"), cCell("Supplier management with GSTIN, payment terms, purchase history"), cCell("vendors, vendor_transactions")] }),
  new TableRow({ children: [cCell("17"), cCell("Accounting"), cCell("Double-entry vouchers, ledger groups, trial balance, TallyPrime export"), cCell("accounts, vouchers, voucher_audits, ledgers")] }),
  new TableRow({ children: [cCell("18"), cCell("Commission"), cCell("Referral doctor commission rules, payout reports, discount deduction"), cCell("commission_rules, doctor_payouts")] }),
  new TableRow({ children: [cCell("19"), cCell("Banking"), cCell("Bank accounts, transaction sync, reconciliation, fraud detection"), cCell("bank_accounts, bank_transactions, reconciliation_logs, fraud_alerts")] }),
  new TableRow({ children: [cCell("20"), cCell("Doctors"), cCell("Referral doctor directory, specializations, ledger assignment"), cCell("doctors, doctor_payouts")] }),
  new TableRow({ children: [cCell("21"), cCell("Appointments"), cCell("Day-view scheduler, slot management, online bookings"), cCell("appointments, appointment_slots, online_bookings")] }),
  new TableRow({ children: [cCell("22"), cCell("Staff Management"), cCell("Users, roles, attendance, salary, advances, biometric credentials"), cCell("users, staff, staff_attendance, staff_salary_payments, staff_biometric_credentials")] }),
  new TableRow({ children: [cCell("23"), cCell("HR Forms"), cCell("Joining, rejoining, exit, document checklists, salary structures"), cCell("hr_rejoining_forms, staff")] }),
  new TableRow({ children: [cCell("24"), cCell("Machines"), cCell("Equipment registry, maintenance schedules, calibration logs"), cCell("machines, machine_maintenance_logs, machine_calibration_logs")] }),
  new TableRow({ children: [cCell("25"), cCell("Website Builder"), cCell("Public clinic site design, pages, popups, analytics, HTML snippets"), cCell("site_settings, site_pages, site_popups")] }),
  new TableRow({ children: [cCell("26"), cCell("WhatsApp"), cCell("WhatsApp Business API integration, chatbot, notifications"), cCell("whatsapp_settings, whatsapp_conversations, wa_chatbot")] }),
  new TableRow({ children: [cCell("27"), cCell("Email"), cCell("SMTP configuration, bill emails, report emails, broadcast"), cCell("email_settings")] }),
  new TableRow({ children: [cCell("28"), cCell("Reports & Analytics"), cCell("Business reports, revenue analytics, AI insights"), cCell("reports")] }),
  new TableRow({ children: [cCell("29"), cCell("Display Board"), cCell("TV display for token numbers and patient queue"), cCell("display_board")] }),
  new TableRow({ children: [cCell("30"), cCell("Kiosk"), cCell("Self-service patient registration and appointment kiosk"), cCell("kiosk_sessions")] }),
  new TableRow({ children: [cCell("31"), cCell("Patient Portal"), cCell("Public portal for patients to view bills, reports, book appointments"), cCell("portal_sessions, patient_reports")] }),
  new TableRow({ children: [cCell("32"), cCell("Super Admin"), cCell("Backups, audit trail, role permissions, system health, USB gate"), cCell("audit_logs, role_permissions, backup_logs, upload_files")] }),
];
children.push(borderedTable(modRows));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 4. MONEY TRAIL ──────────────────────────────────────────────────────────
children.push(heading("4. The Money Trail: From Bill Creation to Bank Reconciliation"));
children.push(body("The financial workflow in Care Diagnostics ERP is designed for complete auditability, from the moment a patient walks in to the final bank reconciliation. Every step creates an immutable record."));

children.push(heading("4.1 Step 1: Patient Registration & Order Creation", HeadingLevel.HEADING_2));
children.push(body("When a patient arrives, the reception staff registers them in the Patient Management module, generating a unique UHID (Unique Hospital Identification Number). Tests are then ordered from the Test Catalog, which supports individual tests, packages (bundled tests at discounted rates), and quick-add slots for frequently ordered combinations."));
children.push(bullet("Each order creates a row in the orders table with status = pending"));
children.push(bullet("Order tests are linked in order_tests table with individual statuses"));
children.push(bullet("The referring doctor is captured for later commission calculation"));

children.push(heading("4.2 Step 2: Bill Generation", HeadingLevel.HEADING_2));
children.push(body("The Billing Desk converts an order into a bill. The bill number format is YYYYMM#### (e.g., 2026050001). Legacy bills with BILL- prefix are still accepted for backward compatibility."));
children.push(bullet("Subtotal = sum of all test prices"));
children.push(bullet("Discount = role-gated percentage or fixed amount (maxDiscount enforced per staff role)"));
children.push(bullet("Net amount = subtotal - discount"));
children.push(bullet("Bill status starts as unpaid, moves to partial or paid as payments are recorded"));
children.push(bullet("Each bill is assigned to a ledger (default walk-in ledger or doctor-specific ledger)"));
children.push(bullet("Per-test queue tokens are auto-generated for lab and radiology departments"));

children.push(heading("4.3 Step 3: Payment Recording", HeadingLevel.HEADING_2));
children.push(body("Payments support multiple methods simultaneously (split payments):"));
[
  "Cash: Recorded with drawer/operator tracking",
  "UPI: QR code generation and reconciliation via UTR",
  "Card: POS terminal integration ready",
  "Bank Transfer: Direct bank account payments",
  "Wallet: Digital wallet payments",
].forEach(t => children.push(bullet(t)));
children.push(body("Each payment creates a row in the payments table linked to the bill. The bill's paid_amount and balance_amount are updated atomically. When balance reaches zero, the bill status changes to paid."));
children.push(body("An auto-voucher is generated for every payment: a Receipt Voucher (RV) that debits the payment method account (e.g., 'Cash-in-Hand') and credits 'Diagnostic Services Revenue'."));

children.push(heading("4.4 Step 4: Commission Calculation", HeadingLevel.HEADING_2));
children.push(body("Commission is calculated for the referring doctor based on a rule hierarchy:"));
[
  "EXCLUSIVE RULE (Test-specific): Highest priority. Matches exact test ID.",
  "CATEGORY RULE: Matches test category (e.g., all biochemistry tests).",
  "GENERAL RULE: Catch-all rules for the doctor.",
  "DOCTOR DEFAULT: Fallback percentage if no rules match.",
].forEach(t => children.push(bullet(t)));
children.push(body("Commission can be calculated in two discount deduction modes:"));
children.push(bullet("DEDUCT: Bill discount is subtracted from commission before payout"));
children.push(bullet("DEDUCT_ROLLOVER: Discount is tracked but rolled over to next billing cycle"));
children.push(body("Commission reports are generated monthly and can be exported for payout processing. The doctor_payouts table tracks actual payments made to doctors."));

children.push(heading("4.5 Step 5: Accounting & Vouchers", HeadingLevel.HEADING_2));
children.push(body("The accounting module follows double-entry bookkeeping principles with Tally-compatible ledger groups:"));
[
  "Receipt Voucher (RV): Records money received (payments, advances)",
  "Payment Voucher (PV): Records money paid out (refunds, expenses, doctor payouts)",
  "Contra Voucher (CV): Records transfers between accounts (cash to bank)",
  "Journal Voucher (JV): Records non-cash adjustments (write-offs, corrections)",
].forEach(t => children.push(bullet(t)));
children.push(body("Every voucher edit creates an audit record in voucher_audits_table. The trial balance report shows all account balances. Day closures reconcile cash drawer amounts with system totals."));

children.push(heading("4.6 Step 6: Banking Integration", HeadingLevel.HEADING_2));
children.push(body("The banking module connects to major Indian banks (ICICI, Axis, HDFC) and Razorpay:"));
[
  "Bank Account Management: Multiple accounts per provider with sandbox/production environments",
  "Transaction Sync: Automatic import of bank statements via API",
  "Reconciliation Engine: Matches bank transactions (by UTR) with ERP vouchers/bills using fuzzy matching",
  "Fraud Detection: Flags duplicate payments, large unlinked transfers, and anomalous patterns",
  "Payment Requests: Initiate payouts to vendors, doctors, or staff",
  "Refund Processing: Handle patient refunds with bank tracking",
].forEach(t => children.push(bullet(t)));
children.push(body("The reconciliation workflow: bank transactions are imported, the system attempts auto-match by UTR, amount, and date. Unmatched items are presented for manual review. Matched items create audit logs for CA verification."));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 5. DICOM / PACS ──────────────────────────────────────────────────────────
children.push(heading("5. DICOM / PACS & Radiology Architecture"));
children.push(body("Care Diagnostics implements a complete RIS-PACS ecosystem with DICOM modality worklist, image acquisition gateway, structured reporting, and multi-viewer support."));

children.push(heading("5.1 DICOM Data Flow", HeadingLevel.HEADING_2));
children.push(body("The DICOM workflow connects imaging modalities (X-Ray, CT, MRI, USG, Mammography) to the ERP through a secure pipeline:"));
[
  "1. ORDER: Doctor orders a radiology test. The system captures DICOM fields (Body Part, Station AE Title, Modality).",
  "2. SCHEDULE: Study is scheduled with auto-generated accession number (ACC-YYYYMMDD-MODALITY-NNNN).",
  "3. MWL: Modality Worklist entry is created. The modality queries the ERP for scheduled patients, eliminating manual entry errors.",
  "4. ACQUISITION: Patient is scanned. Images are pushed to the PACS server (Orthanc or Conquest) via DICOM C-STORE.",
  "5. INCOMING GATEWAY: The Acquisition Gateway monitors dicom_incoming_studies, validates AE Titles, and quarantines corrupted studies.",
  "6. WORKLIST UPDATE: Study status moves from scheduled to acquired.",
  "7. REPORTING: Radiologist opens the study in the reporting workspace, uses templates, voice dictation, or AI assistance.",
  "8. VERIFICATION: Senior radiologist verifies the report (preliminary vs final).",
  "9. DELIVERY: Report is shared via WhatsApp/Email/Patient Portal with PDF and key images.",
].forEach(t => children.push(bullet(t)));

children.push(heading("5.2 PACS Integration Components", HeadingLevel.HEADING_2));
const pacsRows = [
  new TableRow({ children: [hCell("Component", 25), hCell("Technology", 25), hCell("Function", 50)] }),
  new TableRow({ children: [cCell("DICOM Server"), cCell("Orthanc"), cCell("Primary DICOM storage, REST API, WADO-URI, DICOMweb")] }),
  new TableRow({ children: [cCell("Alt DICOM Server"), cCell("Conquest DICOM"), cCell("Fallback/secondary PACS provider")] }),
  new TableRow({ children: [cCell("Web Viewer"), cCell("Weasis / OHIF"), cCell("Browser-based DICOM image viewing")] }),
  new TableRow({ children: [cCell("Bridge Service"), cCell("Node.js (localhost)"), cCell("Workstation-local proxy for scanner/biometric integration")] }),
  new TableRow({ children: [cCell("PACS API Route"), cCell("Express proxy"), cCell("Secure authenticated proxy to Orthanc REST API")] }),
  new TableRow({ children: [cCell("DICOM Router"), cCell("Express + node-dicom"), cCell("Route studies between modalities and storage tiers")] }),
  new TableRow({ children: [cCell("Study Monitor"), cCell("RIS Monitoring"), cCell("Health monitoring for RIS/PACS sync, queue depths")] }),
];
children.push(borderedTable(pacsRows));

children.push(heading("5.3 Teleradiology", HeadingLevel.HEADING_2));
children.push(body("The teleradiology module enables remote radiologists to report on studies from anywhere:"));
[
  "Tokenized share links with expiration (1-30 days configurable)",
  "Multi-site worklist: Radiologists can see studies from multiple diagnostic centers",
  "Radiologist assignment engine: Auto-assigns studies based on subspecialty, workload, and availability",
  "Peer review workflow: Preliminary reports can be sent for second opinion",
  "Critical findings alert: STAT/Emergency studies trigger instant notifications",
  "AI enhancement: Remote radiologists can request AI-powered report suggestions",
].forEach(t => children.push(bullet(t)));

children.push(heading("5.4 DICOM Security", HeadingLevel.HEADING_2));
children.push(body("DICOM endpoints are protected by multiple security layers:"));
[
  "All PACS API routes require staff authentication (requireStaffAuth)",
  "Orthanc ID validation: Only 36-char hex UUIDs with dashes are accepted",
  "SSRF hardening: tcpProbe validates PACS URLs before connecting",
  "DICOM node credentials are stored encrypted in the database",
  "Study access is logged in audit_logs for compliance",
].forEach(t => children.push(bullet(t)));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 6. ROLE-BASED ACCESS ────────────────────────────────────────────────────
children.push(heading("6. Staff Role-Based Access Control (RBAC)"));
children.push(body("The ERP implements granular, server-enforced role-based permissions. There are 8 staff roles and 13 functional modules, each with 10 permission bits."));

children.push(heading("6.1 Staff Roles", HeadingLevel.HEADING_2));
const roleRows = [
  new TableRow({ children: [hCell("Role", 20), hCell("Description", 40), hCell("Typical Access", 40)] }),
  new TableRow({ children: [cCell("super_admin"), cCell("System owner with full access to all modules and destructive operations"), cCell("All modules + super-admin pages (backups, audit, permissions)")] }),
  new TableRow({ children: [cCell("admin"), cCell("Center manager with broad operational access except super-admin features"), cCell("Billing, reports, inventory, staff, settings")] }),
  new TableRow({ children: [cCell("reception"), cCell("Front desk staff handling registration, appointments, and basic billing"), cCell("Patients, appointments, orders, basic billing view")] }),
  new TableRow({ children: [cCell("billing"), cCell("Dedicated billing operator handling invoices, payments, and refunds"), cCell("Full billing module, payments, receipts, day closure")] }),
  new TableRow({ children: [cCell("radiology_typist"), cCell("Data entry staff who type radiology reports from dictation"), cCell("Radiology reporting workspace, templates, drafts")] }),
  new TableRow({ children: [cCell("radiologist"), cCell("Medical doctor who interprets imaging studies and signs reports"), cCell("Radiology worklist, reporting, verification, AI tools")] }),
  new TableRow({ children: [cCell("lab_technician"), cCell("Lab staff who collect samples, run tests, and enter results"), cCell("Sample management, test tokens, lab worklist, result entry")] }),
  new TableRow({ children: [cCell("accountant"), cCell("Finance staff handling vouchers, ledgers, commissions, and banking"), cCell("Accounting, commission reports, banking, day closure")] }),
];
children.push(borderedTable(roleRows));

children.push(heading("6.2 Permission Matrix (13 Modules x 10 Bits)", HeadingLevel.HEADING_2));
children.push(body("Each module has 10 granular permission bits stored in the role_permissions table:"));
const permBits = ["view", "create", "edit", "delete", "print", "reprint", "refund", "export", "approve", "finalize"];
permBits.forEach((bit, i) => children.push(bullet(`${i + 1}. ${bit.toUpperCase()}: ${bit} permission`)));

children.push(body("The 13 modules are: patients, tests, orders, billing, reports, radiology, inventory, accounting, commission, appointments, staff, machines, and website."));
children.push(body("Permission checks are enforced server-side in requireStaffPermission middleware. The frontend reflects these permissions dynamically (buttons hide when the user lacks permission)."));

children.push(heading("6.3 USB Pen-Drive Gate (Super Admin)", HeadingLevel.HEADING_2));
children.push(body("The super-admin surface has an additional physical security layer:"));
[
  "A USB pen drive must contain a file named superadmin.key with content matching the SUPER_ADMIN_USB_KEY environment secret",
  "The ERP auto-detects the drive every 4 seconds using the File System Access API",
  "The Super Admin link appears only when the drive is plugged in",
  "Firefox/Safari fall back to a manual file picker dialog",
  "Ctrl+Alt+U opens the pairing dialog on first setup",
  "The key is cached in sessionStorage (dies with the tab)",
  "When SUPER_ADMIN_USB_KEY is unset, the gate is bypassed with a startup warning",
].forEach(t => children.push(bullet(t)));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 7. RADIOLOGY REPORTING ──────────────────────────────────────────────────
children.push(heading("7. Radiology Reporting Engine"));
children.push(body("The radiology reporting module is one of the most advanced features, supporting voice dictation, AI assistance, structured templates, key images, and multi-level verification."));

children.push(heading("7.1 Reporting Workflow", HeadingLevel.HEADING_2));
[
  "1. STUDY SELECTION: Radiologist picks a study from the smart worklist (filtered by priority, modality, or subspecialty).",
  "2. TEMPLATE CHOICE: Select from 100+ structured templates (USG, CT, MRI, X-Ray, Mammography) or start free-text.",
  "3. VOICE DICTATION: Use browser microphone to dictate findings. Gemini AI cleans up grammar and medical terminology.",
  "4. AI ENHANCEMENT: Request AI suggestions for differential diagnosis, measurements, or normal variant descriptions.",
  "5. KEY IMAGES: Upload up to 10 key images per report (JPG/PNG/WebP, max 10MB each) with annotations.",
  "6. DRAFT SAVE: Auto-save drafts every 30 seconds. Drafts persist across sessions.",
  "7. PRELIMINARY REPORT: Junior radiologist submits preliminary report for senior review.",
  "8. PEER REVIEW: Senior radiologist reviews, edits, and either approves or returns with comments.",
  "9. FINAL REPORT: Verified report is locked. No further edits allowed (immutable).",
  "10. DELIVERY: Report is automatically shared via WhatsApp/Email and appears in the Patient Portal.",
].forEach(t => children.push(bullet(t)));

children.push(heading("7.2 Structured Templates", HeadingLevel.HEADING_2));
children.push(body("Structured templates provide fill-in-the-blank fields for common study types:"));
[
  "USG Abdomen: Liver, GB, CBD, Spleen, Pancreas, Kidneys, Bladder, Prostate/Uterus",
  "USG Obstetrics: Gestation age, BPD, HC, AC, FL, amniotic fluid, placenta",
  "CT Brain: Brain parenchyma, ventricles, basal cisterns, skull bones, paranasal sinuses",
  "MRI Knee: Ligaments, menisci, cartilage, bone marrow, effusion",
  "X-Ray Chest: Heart size, lung fields, hila, costophrenic angles, bony thorax",
  "Mammography: Breast density, masses, calcifications, lymph nodes, BIRADS category",
].forEach(t => children.push(bullet(t)));

children.push(heading("7.3 AI Reporting Features", HeadingLevel.HEADING_2));
children.push(body("The AI reporting module uses Gemini API for intelligent assistance:"));
[
  "Voice-to-text cleanup: Converts raw dictation into polished medical prose",
  "Auto-measurement extraction: Reads measurements from USG images and populates template fields",
  "Normal snippet insertion: One-click insertion of normal variant descriptions",
  "Differential diagnosis suggestions: AI suggests possible diagnoses based on findings",
  "Critical finding detection: AI scans reports for critical language and flags for immediate attention",
  "Report quality scoring: AI evaluates completeness, clarity, and medical accuracy",
].forEach(t => children.push(bullet(t)));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 8. SECURITY & AUDIT ───────────────────────────────────────────────────────
children.push(heading("8. Security, Audit & Compliance"));
children.push(body("The system implements defense-in-depth security with multiple layers of protection."));

children.push(heading("8.1 Authentication & Authorization", HeadingLevel.HEADING_2));
[
  "Bearer token sessions: All staff and patient portal sessions use JWT-like bearer tokens",
  "WebAuthn biometric login: Fingerprint authentication via @simplewebauthn/server",
  "PIN-based login: Staff enter 4-6 digit PINs for quick workstation access",
  "Portal PIN hash sanitization: API responses replace portalPinHash with hasPortalAccess boolean",
  "Role-based permissions: Server-enforced, not UI-only",
  "Super-admin USB gate: Physical pen-drive required for super-admin access",
].forEach(t => children.push(bullet(t)));

children.push(heading("8.2 Immutable Audit Trail", HeadingLevel.HEADING_2));
children.push(body("Every sensitive action is recorded in the audit_logs table:"));
[
  "Action type: create, edit, delete, print, reprint, refund, export, approve, finalize, login, logout",
  "Actor details: userId, userName, role, IP address, user agent",
  "Entity details: module, entityType, entityId, oldValue, newValue",
  "Reason: Free-text reason for the action (required for destructive operations)",
  "Timestamp: Created at server time (no client-supplied timestamps)",
  "Append-only: Records are never updated or deleted",
].forEach(t => children.push(bullet(t)));

children.push(heading("8.3 Rate Limiting", HeadingLevel.HEADING_2));
const rateRows = [
  new TableRow({ children: [hCell("Limiter", 25), hCell("Window", 20), hCell("Max Requests", 15), hCell("Applies To", 40)] }),
  new TableRow({ children: [cCell("loginLimiter"), cCell("15 minutes"), cCell("10"), cCell("Login and brute-force endpoints")] }),
  new TableRow({ children: [cCell("portalLimiter"), cCell("15 minutes"), cCell("60"), cCell("Public portal endpoints")] }),
  new TableRow({ children: [cCell("backupLimiter"), cCell("1 hour"), cCell("5"), cCell("Backup generation")] }),
  new TableRow({ children: [cCell("exportLimiter"), cCell("5 minutes"), cCell("10"), cCell("CSV/Excel exports")] }),
  new TableRow({ children: [cCell("adminMutationLimiter"), cCell("15 minutes"), cCell("30"), cCell("Super admin mutations")] }),
  new TableRow({ children: [cCell("generalLimiter"), cCell("1 minute"), cCell("300"), cCell("All general API routes")] }),
];
children.push(borderedTable(rateRows));

children.push(heading("8.4 Security Headers", HeadingLevel.HEADING_2));
[
  "Helmet: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy",
  "CORS: Configured for the Replit proxy environment",
  "Trust proxy: Set to 1 so rate limiting uses real client IPs",
  "No stack traces in production: errorHandler middleware strips stack traces when NODE_ENV=production",
].forEach(t => children.push(bullet(t)));

children.push(heading("8.5 File Upload Security", HeadingLevel.HEADING_2));
children.push(body("The uploads module enforces strict validation:"));
[
  "MIME type whitelist: Only approved types (PDF, images, docs, spreadsheets, videos, audio)",
  "DICOM whitelist: Separate whitelist for DICOM files (application/dicom, etc.)",
  "Size limits: 10 MB for general files, 200 MB for DICOM studies",
  "Path traversal protection: Module names are sanitized, no ../ allowed",
  "SHA-256 checksums: Every upload is checksummed for integrity verification",
  "Metadata tracking: uploadedBy, uploadedById, patientId, module, timestamp stored in database",
  "Soft delete only: Files are marked isDeleted=true, never physically removed (compliance)",
].forEach(t => children.push(bullet(t)));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 9. INSTALLATION ───────────────────────────────────────────────────────────
children.push(heading("9. Installation & Deployment"));

children.push(heading("9.1 Prerequisites", HeadingLevel.HEADING_2));
[
  "Node.js 24 (LTS)",
  "pnpm 10+ (package manager)",
  "PostgreSQL 15+ (database)",
  "Git (for cloning)",
].forEach(t => children.push(bullet(t)));

children.push(heading("9.2 Docker Deployment (Recommended for Production)", HeadingLevel.HEADING_2));
children.push(body("Create a docker-compose.yml:"));
children.push(new Paragraph({
  children: [new TextRun({ text: `version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: care_diagnostics
      POSTGRES_USER: care_user
      POSTGRES_PASSWORD: CHANGE_ME
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  api-server:
    build:
      context: .
      dockerfile: artifacts/api-server/Dockerfile
    environment:
      DATABASE_URL: postgres://care_user:CHANGE_ME@postgres:5432/care_diagnostics
      SESSION_SECRET: CHANGE_ME_32_CHARS
      SUPER_ADMIN_USB_KEY: CHANGE_ME
      ENABLE_SCHEDULERS: "1"
      NODE_ENV: production
      SERVE_STATIC_DIR: artifacts/api-server/dist/web
    ports:
      - "8080:8080"
    depends_on:
      - postgres

  orthanc:
    image: jodogne/orthanc:1.12.4
    ports:
      - "8042:8042"
      - "4242:4242"
    volumes:
      - orthanc-data:/var/lib/orthanc/db

volumes:
  pgdata:
  orthanc-data:`, size: 16, font: "Courier New" })],
  spacing: { after: 200 },
  shading: { fill: "F5F5F5" },
}));
children.push(body("Run: docker-compose up -d"));

children.push(heading("9.3 Synology NAS Deployment", HeadingLevel.HEADING_2));
children.push(body("For small-to-medium diagnostic centers running on Synology NAS:"));
[
  "1. Install Container Manager from Synology Package Center",
  "2. Create a shared folder named care-diagnostics for persistent data",
  "3. In Container Manager > Project, create a new project with the docker-compose.yml above",
  "4. Map volumes: care-diagnostics/pgdata -> /var/lib/postgresql/data",
  "5. Set environment variables in the Container Manager UI",
  "6. Expose port 8080 via Synology's reverse proxy (Control Panel > Application Portal > Reverse Proxy)",
  "7. Enable HTTPS with Let's Encrypt certificate (Control Panel > Security > Certificate)",
  "8. Set up scheduled backups of the care-diagnostics shared folder via Hyper Backup",
].forEach((t, i) => children.push(bullet(t)));
children.push(body("Note: Synology DS920+ or higher recommended for PostgreSQL + Orthanc. For smaller units, consider running only the ERP without Orthanc (external PACS)."));

children.push(heading("9.4 Windows Deployment", HeadingLevel.HEADING_2));
children.push(body("For Windows-based diagnostic centers:"));
[
  "1. Install Node.js 24 LTS from nodejs.org (select 'Automatically install necessary tools')",
  "2. Install pnpm: npm install -g pnpm",
  "3. Install PostgreSQL 16 from postgresql.org (remember the superuser password)",
  "4. Clone the repository: git clone <repo-url> && cd care-diagnostics",
  "5. Install dependencies: pnpm install",
  "6. Create .env file in artifacts/api-server/ with DATABASE_URL, SESSION_SECRET, etc.",
  "7. Run database migrations: pnpm --filter @workspace/api-server run migrate",
  "8. Build all artifacts: pnpm --filter @workspace/api-server run build-deploy",
  "9. Start the server: pnpm --filter @workspace/api-server run start",
  "10. Install Orthanc for Windows from orthanc-server.com (optional, for PACS)",
  "11. Configure Orthanc URL in environment variables: ORTHANC_URL=http://localhost:8042",
  "12. Access ERP at http://localhost:8080/erp",
].forEach((t, i) => children.push(bullet(t)));
children.push(body("For production Windows deployment, use pm2 or NSSM to run the API server as a Windows service."));

children.push(heading("9.5 Required Environment Variables", HeadingLevel.HEADING_2));
const envRows = [
  new TableRow({ children: [hCell("Variable", 30), hCell("Required", 12), hCell("Description", 58)] }),
  new TableRow({ children: [cCell("DATABASE_URL"), cCell("Yes"), cCell("PostgreSQL connection string")] }),
  new TableRow({ children: [cCell("SESSION_SECRET"), cCell("Yes"), cCell("32+ character secret for session tokens")] }),
  new TableRow({ children: [cCell("SUPER_ADMIN_USB_KEY"), cCell("Yes*"), cCell("USB gate key content (*bypassed if unset)")] }),
  new TableRow({ children: [cCell("AI_INTEGRATIONS_GEMINI_API_KEY"), cCell("No"), cCell("Gemini API key for AI features")] }),
  new TableRow({ children: [cCell("AI_INTEGRATIONS_GEMINI_BASE_URL"), cCell("No"), cCell("Gemini API base URL")] }),
  new TableRow({ children: [cCell("ENABLE_SCHEDULERS"), cCell("No"), cCell("Set to 1 to enable cron jobs")] }),
  new TableRow({ children: [cCell("NODE_ENV"), cCell("Yes"), cCell("production or development")] }),
  new TableRow({ children: [cCell("SERVE_STATIC_DIR"), cCell("Yes"), cCell("Path to built frontend static files")] }),
  new TableRow({ children: [cCell("ORTHANC_URL"), cCell("No"), cCell("Orthanc DICOM server URL")] }),
  new TableRow({ children: [cCell("ORTHANC_USERNAME"), cCell("No"), cCell("Orthanc REST API username")] }),
  new TableRow({ children: [cCell("ORTHANC_PASSWORD"), cCell("No"), cCell("Orthanc REST API password")] }),
  new TableRow({ children: [cCell("SMTP_HOST, SMTP_PORT, etc."), cCell("No"), cCell("Email server configuration")] }),
];
children.push(borderedTable(envRows));
children.push(new Paragraph({ text: "", pageBreakBefore: true }));

// ── 10. FUTURE ROADMAP ──────────────────────────────────────────────────────
children.push(heading("10. Future Roadmap & Recommendations"));
children.push(body("Based on current industry trends and user feedback, the following enhancements are recommended for future releases:"));

children.push(heading("10.1 Short-Term (Next 3 Months)", HeadingLevel.HEADING_2));
[
  "Mobile ERP App: Native mobile app for staff to view worklists, enter results, and approve reports on-the-go",
  "HL7 FHIR Integration: Support for FHIR R4 to integrate with hospital EMR/EHR systems",
  "LIS Integration: Connect with external laboratory information systems via ASTM or HL7",
  "Barcode & QR Integration: Generate QR codes for bills and reports that patients can scan for instant access",
  "Advanced Analytics Dashboard: Real-time revenue charts, test volume trends, doctor referral analytics",
  "Patient Feedback System: Post-visit survey via SMS/WhatsApp with NPS scoring",
].forEach(t => children.push(bullet(t)));

children.push(heading("10.2 Medium-Term (Next 6-12 Months)", HeadingLevel.HEADING_2));
[
  "Multi-Center Cloud: Central dashboard for chain diagnostic centers with consolidated reporting",
  "AI-Powered Quality Control: Automated QC for lab results using historical data patterns",
  "Predictive Maintenance: ML-based prediction for equipment maintenance based on usage and error logs",
  "Insurance Integration: Direct claim submission to TPA/insurance companies",
  "Online Payment Gateway: Razorpay/Stripe integration for patient online bill payment",
  "Voice Assistant: Hands-free navigation for radiologists using voice commands",
  "Blockchain Audit Trail: Cryptographically tamper-proof audit logs using blockchain hashing",
  "Dark Mode: Full dark theme support across all frontend artifacts",
].forEach(t => children.push(bullet(t)));

children.push(heading("10.3 Long-Term (Next 1-2 Years)", HeadingLevel.HEADING_2));
[
  "AI Diagnostic Engine: Deep learning models for automated pathology slide analysis and radiology detection",
  "Telemedicine Integration: Video consultation module for remote doctor-patient interactions",
  "Genomics Integration: Support for genetic test ordering, reporting, and counseling workflows",
  "IoT Device Integration: Real-time monitoring of lab equipment (temperature, reagent levels) via sensors",
  "Digital Pathology: Whole slide imaging (WSI) support with digital pathology viewers",
  "International Standards: CAP, ISO 15189, NABL accreditation compliance modules",
  "Patient Health Records: Longitudinal PHR with integration to national health exchanges (ABDM in India)",
].forEach(t => children.push(bullet(t)));

children.push(heading("10.4 Architecture Recommendations", HeadingLevel.HEADING_2));
[
  "Microservices: Split the monolithic API into domain-specific microservices (billing-service, radiology-service, etc.)",
  "Event-Driven Architecture: Use Redis Streams or Kafka for async event processing (report ready, bill paid, etc.)",
  "GraphQL API: Add a GraphQL layer for flexible client queries alongside REST",
  "Edge Caching: Implement Redis caching for frequently accessed data (test catalog, doctor list)",
  "CDN Integration: Use a CDN for static assets and DICOM image previews",
  "Kubernetes: Container orchestration for scalable multi-center deployments",
].forEach(t => children.push(bullet(t)));

children.push(new Paragraph({ text: "", spacing: { before: 600 } }));
children.push(new Paragraph({
  text: "--- END OF DOCUMENT ---",
  alignment: AlignmentType.CENTER,
  spacing: { before: 400 },
}));
children.push(new Paragraph({
  text: "Care Diagnostics ERP  |  Confidential & Proprietary",
  alignment: AlignmentType.CENTER,
  spacing: { before: 100 },
}));

// ─────────────────────────────────────────────────────────────────────────────
// BUILD & SAVE
// ─────────────────────────────────────────────────────────────────────────────
const doc = new Document({
  sections: [{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), right: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1) },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [new TextRun({ text: "Care Diagnostics ERP - System Documentation", size: 16, italics: true })],
          alignment: AlignmentType.RIGHT,
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: "Page ", size: 16 }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
            new TextRun({ text: " of ", size: 16 }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 }),
          ],
          alignment: AlignmentType.CENTER,
        })],
      }),
    },
    children,
  }],
});

const outPath = "./exports/Care_Diagnostics_ERP_Documentation.docx";
fs.mkdirSync("./exports", { recursive: true });

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);

console.log(`Document written to ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
