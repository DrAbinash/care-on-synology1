import { Router, type IRouter } from "express";
import healthRouter from "./health";
import systemRouter from "./system";
import { patientsRouter } from "./patients";
import { doctorsRouter } from "./doctors";
import { testsRouter } from "./tests";
import { ordersRouter } from "./orders";
import { billsRouter, paymentsRouter } from "./bills";
import { reportsRouter } from "./reports";
import inventoryRouter from "./inventory";
import accountingRouter from "./accounting";
import usersRouter from "./users";
import emailSettingsRouter from "./email-settings";
import discountsRouter from "./discounts";
import aiRouter from "./ai";
import pacsRouter from "./pacs";
import dicomRouter from "./dicom";
import samplesRouter from "./samples";
import { appointmentsRouter } from "./appointments";
import { packagesRouter } from "./packages";
import { expensesRouter } from "./expenses";
import discountReasonsRouter from "./discountReasons";
import testCategoriesRouter from "./testCategories";
import clinicSettingsRouter from "./clinicSettings";
import { ledgersRouter } from "./ledgers";
import { tokensRouter } from "./tokens";
import { testTokensRouter } from "./test-tokens";
import { radiologyRouter } from "./radiology";
import { pacsEnterpriseRouter } from "./pacsEnterprise";
import displayRouter from "./display";
import queueDisplaySettingsRouter from "./queueDisplaySettings";
import { whatsappRouter, whatsappWebhookRouter } from "./whatsapp";
import { waChatbotRouter, waChatbotWebhookRouter } from "./waChatbot";
import { printersRouter } from "./printers";
import { staffRouter } from "./staff";
import hrFormsRouter, { staffScopedHrFormsHandler } from "./hr-forms";
import storageRouter from "./storage";
import { bridgeRouter } from "./bridge";
import { reportTemplatesRouter } from "./report-templates";
import { knowledgeBaseRouter } from "./knowledgeBase";
import { aiCallerKnowledgeBaseRouter } from "./aiCallerKnowledgeBase";
import { receptionCommandCenterRouter } from "./receptionCommandCenter";
import { aiCallerCredentialsRouter } from "./aiCallerCredentials";
import { abnormalFindingsRouter } from "./abnormal-findings";
import formFRouter from "./form-f";
import { portalRouter } from "./portal";
import { patientReportsRouter, signaturesRouter, publicReportsRouter } from "./patient-reports";
import { teleradiologyRouter } from "./teleradiology";
import { machinesRouter } from "./machines";
import { departmentsRouter } from "./departments";
import { branchesRouter } from "./branches";
import { backupReplicationRouter } from "./backupReplication";
import internalBackupRouter from "./internal-backup";
import { vendorsRouter } from "./vendors";
import { websiteRouter } from "./website";
import { verifyRouter } from "./verify";
import internalCronRouter from "./internal-cron";
import internalRadiologyRouter from "./internal-radiology";
import dicomAgentRouter from "./dicom-agent";
import { publicBookingRouter } from "./public-booking";
import { onlineBookingsRouter } from "./online-bookings";
import { webauthnRouter } from "./webauthn";
import { dailySummaryRouter } from "./daily-summary";
import { advancedDashboardRouter } from "./advanced-dashboard";
import { myDailySummaryRouter } from "./my-daily-summary";
import { outsourcedLabsRouter } from "./outsourced-labs";
import { kioskRouter } from "./kiosk";
import { dayCloseRouter } from "./day-close";
import { booksSanityRouter } from "./books-sanity";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { requireSuperAdminUsb, isValidUsbKey, isUsbGateEnforced } from "../middleware/requireSuperAdminUsb";
import { requireStaffAuth, requireStaffPermission, requireStaffSubPermission } from "../middleware/requireStaffAuth";
import { db, clinicSettingsTable, ledgersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { backupLimiter, exportLimiter, adminMutationLimiter, standardUploadLimiter, loginLimiter, generalLimiter } from "../middleware/rateLimits";
import { activePluginRouter } from "../plugin-loader";
import userPreferencesRouter from "./userPreferences";
import barcodeResolverRouter from "./barcode-resolver";
import { uploadsRouter } from "./uploads";
import { radiologyReportGeneratorRouter } from "./radiology-report-generator";
import { structuredReportTemplatesRouter } from "./structuredReportTemplates";
import { floorsRouter, roomsRouter, modalitiesRouter } from "./locations";
import { aiReportingRouter } from "./aiReporting";
import { radiologyKnowledgeRouter } from "./radiologyKnowledge";
import { radiologySmartFindingsRouter } from "./radiologySmartFindings";
import { aiPromptTemplatesRouter } from "./aiPromptTemplates";
import { aiPromptLibraryRouter } from "./aiPromptLibrary";
import { aiModelRoutesRouter } from "./aiModelRoutes";
import { aiComparisonRouter } from "./aiComparison";
import { teachingCasesRouter } from "./teachingCases";
import { radiologyCoPilotRouter as radiologyCopilotRouter } from "./radiologyCopilot";
import { radiologyMemoryRouter } from "./radiologyMemory";
import { radiologyLesionsRouter } from "./radiologyLesions";
import { radiologySpineIntelligenceRouter } from "./radiologySpineIntelligence";
import { radiologyBrainIntelligenceRouter } from "./radiologyBrainIntelligence";
import { radiologyTumorFollowupRouter } from "./radiologyTumorFollowup";
import { radiologyAnnotationsRouter } from "./radiologyAnnotations";
import { radiologyOllamaRouter } from "./radiologyOllama";
import { radiologySnippetsRouter } from "./radiologySnippets";
import { radiologyMyAnalyticsRouter } from "./radiologyMyAnalytics";
import { bankingRouter, bankingWebhookRouter } from "./banking";
import { syncRouter } from "./sync";
import { usgExtractionRouter } from "./usgExtraction";
import { usgDopplerRouter } from "./usgDoppler";
import { usgReportsRouter } from "./usgReports";
import { usgCriticalAlertsRouter } from "./usgCriticalAlerts";
import { usgAnalyticsRouter } from "./usgAnalytics";
import echoCardiologyRouter from "./echoCardiology";
import fetalUsgLevel4Router from "./fetalUsgLevel4";
import pregnancyDashboardRouter from "./pregnancyDashboard";
import sonologistAssistantRouter from "./sonologistAssistant";
import dicomStudyManagerRouter from "./dicomStudyManager";
import dicomWorkflowRouter from "./dicomWorkflow";
import smartRadiologyRouter from "./smartRadiology";
import risMonitoringRouter from "./risMonitoring";
import radiologyWorkflowRouter from "./radiologyWorkflow";
import { scanSessionsRouter } from "./scan-sessions";
import { gatewayWebhookRouter } from "./gateway-webhooks";

const router: IRouter = Router();

// Expose USB verify and status endpoints directly on the host server
// so they can be checked/loaded before the Super Admin plugin itself is active.
router.get("/super-admin/usb/status", (_req, res): void => {
  res.json({ enforced: isUsbGateEnforced() });
});

router.post("/super-admin/usb/verify", loginLimiter, (req, res): void => {
  const presented = req.body?.key;
  if (!presented || typeof presented !== "string") {
    res.status(400).json({ ok: false, error: "key is required" });
    return;
  }
  const ok = isValidUsbKey(presented);
  if (!ok) {
    res.status(401).json({ ok: false, error: "Invalid USB key" });
    return;
  }
  res.json({ ok: true, enforced: isUsbGateEnforced() });
});

const SUPER_ADMIN_PREFIXES = [
  "/super-admin",
  "/backup",
  "/system",
  "/admin/audit-logs",
  "/admin/role-permissions",
  "/admin/system-health",
  "/commission",
  "/doctor-ledger",
];

router.use((req, res, next) => {
  const matched = SUPER_ADMIN_PREFIXES.find(p => req.path === p || req.path.startsWith(p + "/"));
  if (matched) {
    if (activePluginRouter) {
      activePluginRouter(req, res, next);
    } else {
      res.status(404).json({ error: "Super Admin plugin is not loaded." });
    }
  } else {
    next();
  }
});

// ─── Global rate limiter — protects all routes from flooding / abuse ──────────
// Applied after USB/super-admin prefix check but before ALL other routes so
// every endpoint (public and private) is covered. Generous enough for normal
// multi-tab ERP usage; tight enough to prevent scripted abuse.
router.use(generalLimiter);

// ─── Public / unauthenticated routes ─────────────────────────────────────────
router.use(healthRouter);
router.use(systemRouter);
// Internal cron trigger endpoints — auth via CRON_SECRET bearer token, not staff session.
// Hit by a Replit Scheduled deployment (see scripts/src/trigger-cron.ts) so cron emails
// keep firing on autoscale where in-process schedulers are disabled.
router.use("/internal/cron", internalCronRouter);
// Internal RIS/PACS automation endpoints — auth via INTERNAL_API_KEY bearer token.
// Called by Conquest PACS scripts and other server-to-server automations.
// Internal backup download — streams pg_dump output for off-site replication.
router.use("/internal/backup", internalBackupRouter);
router.use("/internal", internalRadiologyRouter); // [ZONE: radiology] name is generic, content is 100% radiology (DICOM agent callbacks)
router.use("/portal", portalRouter);
router.use("/display", displayRouter);
router.use("/settings/queue-display", queueDisplaySettingsRouter);
router.use("/bridge", bridgeRouter);
// Public tokenized PDF download for patient WhatsApp links — no staff auth.
router.use("/p/r", publicReportsRouter);
// Public tele-radiology share viewer (token-gated) — no staff auth.
router.use("/teleradiology", teleradiologyRouter);
// Public bill-verification page — the QR code on every printed bill links
// here so anyone (patient, regulator) can confirm the bill is genuine.
// Read-only, no PII beyond what is already on the printed receipt.
router.use("/verify", verifyRouter);

// Public online test booking (clinic-site "Book Now" + Razorpay payment).
// These endpoints are intentionally unauthenticated: the booking form and
// payment flow run on the public clinic site. Payment is verified server-side
// via HMAC before any record is persisted.
router.use("/public/booking", publicBookingRouter);

// Payment gateway server-to-server webhooks (ICICI, HDFC).
// MUST be public — the gateways POST here without a staff session.
// Individual admin endpoints inside the router apply requireStaffAuth themselves.
router.use("/gateway", gatewayWebhookRouter);

// Self-registration kiosk — public, rate-limited. Patients register and pay
// via UPI at an unattended kiosk without a staff login. Rate-limited at the
// route level; no sensitive staff data is accessible from these endpoints.
router.use("/kiosk", kioskRouter);

// WhatsApp Business webhook — public, validated by Meta's hub.verify_token.
// GET: Meta verification challenge. POST: incoming messages + AI auto-reply.
// Must be mounted BEFORE the staff-auth whatsapp router below.
router.use("/whatsapp/webhook", whatsappWebhookRouter);

// Website router: GET endpoints are intentionally public so the clinic-site
// frontend can fetch settings/pages/faqs/photos/popups without credentials.
// Mutating endpoints inside websiteRouter each apply requireStaffAuth directly.
// Must be mounted here (above the pathless storage middleware) so that
// unauthenticated public requests are not intercepted by requireStaffAuth.
router.use("/website", websiteRouter);

// ─── Staff-authenticated ERP routes ──────────────────────────────────────────
// Each route requiring a module permission is gated with requireStaffPermission
// immediately after requireStaffAuth so that low-privilege staff cannot access
// modules they have not been granted, even by calling the API directly.

// [ZONE: shared] patients, doctors, tests catalogue — used by both Billing
// and Radiology. See /PROTECTED_FILES.md before modifying.

// Patient data — /patients permission
router.use("/patients", requireStaffAuth, requireStaffPermission("/patients"), patientsRouter);

// Doctor management — /doctors permission
router.use("/doctors", requireStaffAuth, requireStaffPermission("/doctors"), doctorsRouter);

// Test catalogue — /tests permission
// Tests catalog: any authenticated staff can READ (Billing Desk, Packages,
// Reports, Orders all need the test list). Mutations stay /tests-gated.
router.use(
  "/tests",
  requireStaffAuth,
  (req, res, next) => {
    if (req.method === "GET") return next();
    return requireStaffPermission("/tests")(req, res, next);
  },
  testsRouter,
);

// [ZONE: billing] PROTECTED — orders, bills, payments, reports, inventory,
// accounting, discounts, expenses, ledgers, day-close, books-sanity.
// Any change here requires Dr. Abinash's explicit sign-off.
// See /PROTECTED_FILES.md.

// Order management — /orders permission
router.use("/orders", requireStaffAuth, requireStaffPermission("/orders"), ordersRouter);

// Billing — /billing permission (covers bill creation, edits, refunds, cancels)
router.use("/bills", requireStaffAuth, requireStaffPermission("/billing"), billsRouter);

// Payments — /payments permission
router.use("/payments", requireStaffAuth, requireStaffPermission("/payments"), paymentsRouter);

// Reports — /reports permission (covers dashboard, revenue, print reports)
router.use("/reports", requireStaffAuth, requireStaffPermission("/reports"), reportsRouter);

// Inventory — /inventory permission
router.use("/inventory", requireStaffAuth, requireStaffPermission("/inventory"), inventoryRouter);

// Accounting — /accounting permission (vouchers, accounts, ledger entries)
router.use("/accounting", requireStaffAuth, requireStaffPermission("/accounting"), accountingRouter);

// Discounts — /discounts permission
router.use("/discounts", requireStaffAuth, requireStaffPermission("/discounts"), discountsRouter);

// Discount reasons — /discounts permission (configuration for the discounts module)
// Discount reasons — any authenticated staff can READ (the Billing Desk
// dropdown needs the active reasons). Mutations stay /discounts-gated.
router.use(
  "/discount-reasons",
  requireStaffAuth,
  (req, res, next) => {
    if (req.method === "GET") return next();
    return requireStaffPermission("/discounts")(req, res, next);
  },
  discountReasonsRouter,
);

// Expenses — /accounting permission (financial records)
router.use("/expenses", requireStaffAuth, requireStaffPermission("/accounting"), expensesRouter);

// Ledgers — /accounting permission for mutations; read accessible to all staff
router.get("/ledgers", requireStaffAuth, requireStaffPermission("/accounting"), async (_req, res) => {
  const { ensureDefaultLedger } = await import("./ledgers");
  await ensureDefaultLedger();
  const ledgers = await db.select().from(ledgersTable).orderBy(ledgersTable.id);
  res.json({ ledgers });
});
router.use("/ledgers", requireStaffAuth, requireStaffPermission("/accounting"), ledgersRouter);
// Day-Close — per-user endpoints (/my-preview, /my-drawer-status, /my-close, /my-list)
// are open to all authenticated staff; admin-only routes are gated inline.
router.use("/day-close", requireStaffAuth, dayCloseRouter);
// Books Sanity / CA review — admin + super-admin only (same auth shape as day-close)
router.use("/books-sanity", requireStaffAuth, requireStaffPermission("/day-close"), booksSanityRouter);

// [ZONE: shared] staff, settings, infrastructure config — used by both zones.

router.use("/staff", requireStaffAuth, requireStaffSubPermission("/settings", "users"), staffRouter);

// HR re-joining / update forms — same /settings permission as staff records
router.use("/hr-forms", requireStaffAuth, requireStaffSubPermission("/settings", "users"), hrFormsRouter);

// Object storage (presigned URL request + object serving). Today the only
// consumer is the HR re-joining form photo uploader, which contains PII
// (passport-sized employee photo). Gate both endpoints behind the same
// /settings permission as the HR form and staff records so a regular biller
// with an object URL cannot fetch employee photos.
// IMPORTANT: storageRouter declares its own paths starting with
// "/storage/...", so it has to be mounted at the router root. Path-less
// `router.use(authMw, permMw, storageRouter)` would apply auth+perm to
// EVERY subsequent request and silently 403 anyone without /settings
// (previously broke packages, tokens, appointments, quick-test save,
// the receipt clinic header, etc. for billing/receptionist roles). Wrap
// the gate in a URL check so it only fires for /storage/* endpoints.
router.use((req, res, next) => {
  if (!req.url.startsWith("/storage/")) return next();
  return requireStaffAuth(req as never, res, () =>
    requireStaffPermission("/settings")(req as never, res, next),
  );
}, storageRouter);
// Staff-scoped HR forms listing (mounted on the /staff path so the StaffDetail
// dialog can fetch all forms for a single employee).
router.get(
  "/staff/:staffId/hr-forms",
  requireStaffAuth,
  requireStaffSubPermission("/settings", "users"),
  staffScopedHrFormsHandler,
);

// Clinic configuration — any authenticated staff can READ (the bill print
// receipt and many other surfaces need clinic name/address/logo). Writes
// (PUT) are normally restricted to /settings-permitted users, EXCEPT when
// the body only contains billing-desk-owned fields (`quickTestIds`,
// `billPrintCopies`) which receptionists/billing staff need to update from
// the Billing Desk itself.
const BILLING_OWNED_SETTINGS_KEYS = new Set(["quickTestIds", "billPrintCopies"]);

// Public branding endpoint — bill print header, logo, GSTIN, footer.
// Must be BEFORE the auth-gated /clinic-settings mount so it stays public.
router.get("/clinic-settings/branding", async (_req, res) => {
  let row: any = null;
  try {
    const rows = await db.select().from(clinicSettingsTable).limit(1);
    row = rows[0];
  } catch {
    // Schema may be ahead of the database (missing columns). Return safe defaults.
  }
  if (!row) {
    res.json({ name: "Care Diagnostics", tagline: "", address: "", registeredAddress: "", phone: "", email: "", website: "", gstin: "", logoDataUrl: null, footerNote: "", billPrintCopies: 1, billDefaultPaperSize: "A5", billShowCode: false, billShowCategory: false, qrOnBillEnabled: true, showTatOnBill: false, dayCloseAutoPrint: true, quickTestIds: "[null,null,null,null,null,null]", formFTestIds: "[]", formFBillingPrompt: false, formFAddressRequired: true, formFGuardianRequired: true });
    return;
  }
  res.json({
    name: row.name ?? "",
    tagline: row.tagline ?? "",
    address: row.address ?? "",
    registeredAddress: row.registeredAddress ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    gstin: row.gstin ?? "",
    logoDataUrl: row.logoDataUrl ?? null,
    footerNote: row.footerNote ?? "",
    portalHeading: row.portalHeading ?? "",
    portalWelcomeMessage: row.portalWelcomeMessage ?? "",
    billPrintCopies: row.billPrintCopies ?? 1,
    billDefaultPaperSize: row.billDefaultPaperSize ?? "A5",
    billShowCode: row.billShowCode ?? false,
    billShowCategory: row.billShowCategory ?? false,
    qrOnBillEnabled: row.qrOnBillEnabled ?? true,
    showTatOnBill: row.showTatOnBill ?? false,
    dayCloseAutoPrint: row.dayCloseAutoPrint ?? true,
    quickTestIds: row.quickTestIds ?? "[null,null,null,null,null,null]",
    formFTestIds: row.formFTestIds ?? "[]",
    formFBillingPrompt: row.formFBillingPrompt ?? false,
    formFAddressRequired: row.formFAddressRequired ?? true,
    formFGuardianRequired: row.formFGuardianRequired ?? true,
  });
});

router.use(
  "/clinic-settings",
  requireStaffAuth,
  (req, res, next) => {
    if (req.method === "GET") return next();
    if (req.method === "PUT") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const keys = Object.keys(body);
      if (keys.length > 0 && keys.every((k) => BILLING_OWNED_SETTINGS_KEYS.has(k))) {
        return next();
      }
    }
    return requireStaffSubPermission("/settings", "clinic")(req, res, next);
  },
  clinicSettingsRouter,
);
router.use("/email-settings", requireStaffAuth, requireStaffSubPermission("/settings", "notifications"), emailSettingsRouter);
// Test categories: anyone with staff auth can READ the list (Test Catalog,
// Billing Desk, Reports filter all need it). Mutations stay admin-only via
// the /settings permission.
router.use(
  "/test-categories",
  requireStaffAuth,
  (req, res, next) => {
    if (req.method === "GET") return next();
    return requireStaffSubPermission("/settings", "infrastructure")(req, res, next);
  },
  testCategoriesRouter,
);
router.use("/report-templates", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), reportTemplatesRouter);
router.use("/knowledge-base", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), knowledgeBaseRouter);
router.use("/ai-caller-credentials", aiCallerCredentialsRouter);
// External AI-caller-authenticated path — deliberately NOT behind
// requireStaffAuth, since its entire purpose is to be reachable by a
// future external service that has no staff session. Its own auth
// (requireAiCallerAuth) is applied per-route inside this router.
router.use("/ai-gw/v1/knowledge-base", aiCallerKnowledgeBaseRouter);
router.use("/reception-command-center", receptionCommandCenterRouter);
router.use("/abnormal-findings", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), abnormalFindingsRouter);
router.use("/machines", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), machinesRouter);
router.use("/departments", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), departmentsRouter);
router.use("/floors", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), floorsRouter);
router.use("/rooms", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), roomsRouter);
router.use("/modalities", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), modalitiesRouter);
router.use("/branches", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), branchesRouter);
router.use("/printers", requireStaffAuth, requireStaffSubPermission("/settings", "devices"), printersRouter);
router.use("/vendors", requireStaffAuth, requireStaffSubPermission("/settings", "infrastructure"), vendorsRouter);

// Outsourced labs — /tests permission (test catalog management)
router.use(
  "/outsourced-labs",
  requireStaffAuth,
  (req, res, next) => {
    if (req.method === "GET") return next();
    return requireStaffPermission("/tests")(req, res, next);
  },
  outsourcedLabsRouter,
);

// [ZONE: radiology] Radiology / PACS / DICOM / USG / AI reporting.
// No direct billing impact — can be developed and debugged more freely
// than the billing zone above. See /PROTECTED_FILES.md.

// DICOM / PACS — /dicom-nodes permission
router.use("/pacs", requireStaffAuth, requireStaffPermission("/dicom-nodes"), pacsRouter);
router.use("/dicom", requireStaffAuth, requireStaffPermission("/dicom-nodes"), dicomRouter);
// DICOM Pull Agent Monitor — staff read-only, gated by /dicom-nodes permission
router.use("/dicom-agent", requireStaffAuth, requireStaffPermission("/dicom-nodes"), dicomAgentRouter);

// Enterprise PACS features (upgraded C-ECHO, viewer launch, routing rules,
// MWL procedures, pulled-studies stats, failed-queue retry).
// Mounted BEFORE radiologyRouter so its handlers (e.g. echo-test upgrade) win.
router.use("/radiology", requireStaffAuth, requireStaffPermission("/radiology"), pacsEnterpriseRouter);

// USG auto-measurement extraction — all authenticated staff can trigger/review;
// settings writes require admin role (enforced inside the router).
router.use("/usg-extraction", requireStaffAuth, requireStaffPermission("/radiology"), usgExtractionRouter);

// USG Doppler measurements — all authenticated staff can read/write.
router.use("/usg-doppler", requireStaffAuth, requireStaffPermission("/radiology"), usgDopplerRouter);

// USG Report Drafts — all authenticated staff can create/edit drafts.
router.use("/usg-reports", requireStaffAuth, requireStaffPermission("/radiology"), usgReportsRouter);
router.use("/usg-critical", requireStaffAuth, requireStaffPermission("/radiology"), usgCriticalAlertsRouter);
router.use("/usg-analytics", requireStaffAuth, requireStaffPermission("/radiology"), usgAnalyticsRouter);
router.use("/echo-cardiology", requireStaffAuth, requireStaffPermission("/radiology"), echoCardiologyRouter);
router.use("/fetal-usg", requireStaffAuth, requireStaffPermission("/radiology"), fetalUsgLevel4Router);
router.use("/fetal-usg-dashboard", requireStaffAuth, requireStaffPermission("/radiology"), pregnancyDashboardRouter);
router.use("/radiology-copilot/sonologist-assistant", requireStaffAuth, requireStaffPermission("/radiology"), sonologistAssistantRouter);

// Phase 10: RIS/PACS Foundation — DICOM study management + smart workflow
router.use("/dicom-studies", requireStaffAuth, requireStaffPermission("/dicom-nodes"), dicomStudyManagerRouter);
router.use("/dicom-workflow", requireStaffAuth, requireStaffPermission("/radiology"), dicomWorkflowRouter);
router.use("/smart-radiology", requireStaffAuth, requireStaffPermission("/radiology"), smartRadiologyRouter);

// Phase 11: RIS/PACS Production Monitoring & Hardening
router.use("/ris-monitor", requireStaffAuth, requireStaffPermission("/radiology"), risMonitoringRouter);

// Phase 12: Real Radiology Workflow & DICOM Operations
router.use("/radiology-workflow", requireStaffAuth, requireStaffPermission("/radiology"), radiologyWorkflowRouter);

// Radiology studies — open to all authenticated staff (doctors, radiologists, etc.)
router.use("/radiology", requireStaffAuth, requireStaffPermission("/radiology"), radiologyRouter);

// Radiology Report Generator — staff-accessible report builder with voice dictation,
// key image upload, template library, draft save, and final report creation.
router.use(
  "/radiology/report-generator",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyReportGeneratorRouter,
);

// Structured report templates — open to all authenticated staff for reading.
router.use(
  "/radiology/structured-report-templates",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  structuredReportTemplatesRouter,
);

// Radiology Snippets — Quick Add, Smart Format, Favorites, Macros
router.use(
  "/radiology/snippets",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologySnippetsRouter,
);

// Phase 4: Radiology Knowledge Platform — Master Templates, Personal Library, Knowledge Base
router.use(
  "/radiology/knowledge",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyKnowledgeRouter,
);

// Phase 5: Structured Smart Reporting Engine — Deterministic rules-based text generation
router.use(
  "/radiology/smart",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologySmartFindingsRouter,
);

// Clinical report & compliance routes — /reports permission.
// These expose patient PHI (names, codes, phone, email, test details),
// clinician signature records, and compliance Form-F data. Restricting them
// to the /reports permission matches every other sensitive clinical module.
router.use("/form-f", requireStaffAuth, requireStaffPermission("/form-f"), formFRouter);
router.use("/patient-reports", requireStaffAuth, requireStaffPermission("/reports"), patientReportsRouter);
router.use("/signatures", requireStaffAuth, requireStaffPermission("/reports"), signaturesRouter);

// AI Radiology Reporting — encrypted API keys, audit logging, draft management
router.use("/ai-reporting", requireStaffAuth, aiReportingRouter);

// AI Prompt Templates — modality-aware, versioned, editable-without-code prompts
router.use("/ai-prompt-templates", requireStaffAuth, aiPromptTemplatesRouter);
router.use("/ai-prompt-library", requireStaffAuth, aiPromptLibraryRouter);
router.use("/ai-model-routing", requireStaffAuth, aiModelRoutesRouter);

// AI Comparison Workspace
router.use("/ai-comparison", requireStaffAuth, aiComparisonRouter);

// Phase 8: Teaching Files
router.use("/teaching-cases", requireStaffAuth, teachingCasesRouter);

// Phase 8: Radiology Copilot — Prior Study, Measurements, Smart Impression, Consistency, Follow-up
router.use("/radiology-copilot", requireStaffAuth, radiologyCopilotRouter);

// Phase 9: Radiology Memory + Context Engine
router.use("/radiology-memory", requireStaffAuth, radiologyMemoryRouter);

// Phase 5: Personal Reporting Analytics
router.use("/radiology/my-analytics", requireStaffAuth, requireStaffPermission("/radiology"), radiologyMyAnalyticsRouter);

// Phase 10A: Lesion Tracker + Measurement Assistant
router.use("/radiology-lesions", requireStaffAuth, radiologyLesionsRouter);

// Phase 10B: Organ Intelligence — Spine, Brain, Tumor follow-up
router.use("/radiology-spine", requireStaffAuth, radiologySpineIntelligenceRouter);
router.use("/radiology-brain", requireStaffAuth, radiologyBrainIntelligenceRouter);
router.use("/radiology-tumor", requireStaffAuth, radiologyTumorFollowupRouter);

// Phase 10C: AI Research Platform — Annotations, Ollama local models
router.use("/radiology-annotations", requireStaffAuth, radiologyAnnotationsRouter);
router.use("/radiology-ollama", requireStaffAuth, radiologyOllamaRouter);

// AI endpoints — each sub-route applies its own requireStaffPermission matching
// the data domain it accesses (patients PHI, billing records, or radiology
// orders). requireStaffAuth here provides the outer authentication guard;
// per-route permission checks inside aiRouter enforce module-level access.
router.use("/ai", requireStaffAuth, aiRouter);

// ─── Unrestricted staff-authenticated routes ──────────────────────────────────
// These routes serve operational functions genuinely shared across all staff
// roles and do not expose sensitive module-specific data on their own.
router.use("/samples", requireStaffAuth, samplesRouter);
router.use("/resolve-barcode", requireStaffAuth, barcodeResolverRouter);
router.use("/appointments", requireStaffAuth, appointmentsRouter);
router.use("/online-bookings", requireStaffAuth, onlineBookingsRouter);
router.use("/daily-summary", requireStaffAuth, requireStaffPermission("/reports"), dailySummaryRouter);
router.use("/dashboard/advanced-summary", requireStaffAuth, advancedDashboardRouter);
router.use("/dashboard/my-daily-summary", requireStaffAuth, myDailySummaryRouter);
router.use("/packages", requireStaffAuth, packagesRouter);
router.use("/whatsapp", requireStaffAuth, whatsappRouter);
router.use("/tokens", requireStaffAuth, requireStaffPermission("/queue"), tokensRouter);
router.use("/test-tokens", requireStaffAuth, requireStaffPermission("/queue"), testTokensRouter);

// ─── Super-admin-only sensitive operational routes ────────────────────────────
// FIDO2 / WebAuthn authentication routes:
//   /api/auth/webauthn/authenticate/*  → public (standalone security-key login)
//   /api/auth/webauthn/register/*      → staff auth required (credential management)
//   /api/auth/webauthn/credentials     → staff auth required
import { webauthnPublicRouter } from "./webauthn";
router.use("/auth/webauthn/authenticate", webauthnPublicRouter);
router.use("/auth/webauthn", requireStaffAuth, webauthnRouter);

// ─── Backup & Replication (admin/super-admin) ─────────────────────────────
router.use("/admin/backup-replication", requireStaffAuth, requireStaffSubPermission("/settings", "backup"), backupReplicationRouter);

// ─── Super-admin-only routes ──────────────────────────────────────────────────
// User management lives under the regular ERP "Settings" surface — admins
// (and anyone else granted /settings) need to add staff and reset PINs
// without holding a super-admin session. The route stays inside the
// staff-auth fence so unauthenticated public callers still cannot touch it.
// Self-service preferences (no /settings permission required — any staff can update their own theme).
// Must be registered before the /settings-gated usersRouter so the PATCH handler is reachable.
router.use("/users", requireStaffAuth, userPreferencesRouter);
router.use("/users", requireStaffAuth, requireStaffSubPermission("/settings", "users"), usersRouter);

// ─── WhatsApp Chatbot module ───────────────────────────────────────────────────
// Provider-agnostic WhatsApp chatbot: webhook receiver, bot engine,
// conversation inbox, contacts, templates, audit logs.
// Webhooks are mounted PUBLICLY before auth so WhatsApp providers can POST.
router.use("/wa-chatbot/webhook", waChatbotWebhookRouter);
router.use("/wa-chatbot", requireStaffAuth, requireStaffSubPermission("/settings", "notifications"), waChatbotRouter);

// ─── Banking module ────────────────────────────────────────────────────────────
// Provider-agnostic banking: balance, transactions, payments, webhooks,
// reconciliation. Requires /banking permission for all endpoints.
// [ZONE: billing] PROTECTED — see /PROTECTED_FILES.md.
// Banking webhooks are mounted PUBLICLY before auth so bank providers can
// POST without a staff bearer token. Signature verification happens inside
// the handler.
router.use("/banking/webhooks", bankingWebhookRouter);
router.use("/banking", requireStaffAuth, requireStaffPermission("/banking"), bankingRouter);

// [ZONE: shared, billing-adjacent] touches patients/orders/bills/payments
// together — do not modify from radiology-focused work. See /PROTECTED_FILES.md.
// Offline sync — push/pull changes between local desktop instance and cloud.
router.use("/sync", requireStaffAuth, syncRouter);

// Standard uploads — JSON base64, validated, size-limited, metadata tracked
router.use("/uploads", requireStaffAuth, standardUploadLimiter, uploadsRouter);

// Wireless scan sessions & phone pairing — staff auth required (phone pairs with
// a logged-in session; unauthenticated access would allow rogue devices to inject
// scan data into any active session).
router.use("/scan-sessions", requireStaffAuth, scanSessionsRouter);

export default router;
