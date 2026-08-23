import { Router, type IRouter } from "express";
import healthRouter from "./health";
import systemRouter from "./system";
import { patientsRouter } from "./patients";
import patientTimelineRouter from "./patientTimeline";
import { doctorsRouter } from "./doctors";
import { testsRouter } from "./tests";
import { ordersRouter } from "./orders";
import { billsRouter, paymentsRouter } from "./bills";
import { emergencyBillingRouter } from "./emergencyBilling";
import { emergencyBridgeRouter } from "./emergencyBridge";
import { reportsRouter } from "./reports";
import inventoryRouter from "./inventory";
import inventoryDemandsRouter from "./inventoryDemands";
import inventoryBatchesRouter from "./inventoryBatches";
import { purchaseInvoicesRouter } from "./purchaseInvoices";
import accountingRouter from "./accounting";
import usersRouter from "./users";
import emailSettingsRouter from "./email-settings";
import auditTrailRouter from "./audit-trail";
import featureFlagsRouter from "./featureFlags";
import discountsRouter from "./discounts";
import aiRouter from "./ai";
import pacsRouter from "./pacs";
import dicomRouter from "./dicom";
import samplesRouter from "./samples";
// HOPE → CARE diagnostic referral integration (additive; docs/hope-care-integration/)
import { integrationInboundRouter } from "./integration/inbound";
import { hopeReferralsRouter } from "./integration/hopeReferrals";
import { integrationAdminRouter } from "./integration/admin";
import { appointmentsRouter } from "./appointments";
import { packagesRouter } from "./packages";
import { expensesRouter } from "./expenses";
import discountReasonsRouter from "./discountReasons";
import reprintReasonsRouter from "./reprintReasons";
import testCategoriesRouter from "./testCategories";
import clinicSettingsRouter from "./clinicSettings";
import staffQuickDoctorsRouter from "./staffQuickDoctors";
import { ledgersRouter } from "./ledgers";
import { tokensRouter } from "./tokens";
import { testTokensRouter } from "./test-tokens";
import { radiologyRouter } from "./radiology";
import { radiologyWorklistLocksRouter } from "./radiology-worklist-locks";
import { radiologyWorklistAssignmentsRouter } from "./radiology-worklist-assignments";
import { radiologyVoiceRouter } from "./radiology-voice";
import { radiologyOpsRouter } from "./radiology-ops";
import { radiologyDiagnosticsRouter } from "./radiology-diagnostics";
import { presentationTemplatesRouter } from "./presentation-templates";
import { pacsEnterpriseRouter } from "./pacsEnterprise";
import displayRouter from "./display";
import queueDisplaySettingsRouter from "./queueDisplaySettings";
import paymentDisplayRouter from "./paymentDisplay";
import { whatsappRouter } from "./whatsapp";
import { waChatbotRouter } from "./waChatbot";
import { printersRouter } from "./printers";
import { staffRouter } from "./staff";
import hrFormsRouter, { staffScopedHrFormsHandler } from "./hr-forms";
import peopleRouter from "./people";
import performanceRouter from "./performance";
import recognitionRouter from "./recognition";
import appraisalRouter from "./appraisal";
import rosterRouter from "./roster";
import leaveRouter from "./leave";
import disciplinaryRouter from "./disciplinary";
import mySelfServiceRouter from "./mySelfService";
import reportDeliveryTrackingRouter from "./reportDeliveryTracking";
import recallRouter from "./recall";
import feedbackRouter from "./feedback";
import publicFeedbackRouter from "./publicFeedback";
import billPaymentLinksRouter from "./billPaymentLinks";
import opsCockpitRouter from "./opsCockpit";
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
import { pathologyFlagPreviewRouter } from "./pathologyFlagPreview";
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
import internalAutomationsWhatsappRouter from "./internal-automations-whatsapp";
import internalRadiologyRouter from "./internal-radiology";
import dicomAgentRouter from "./dicom-agent";
import { publicBookingRouter } from "./public-booking";
import { mobileConfigRouter } from "./mobileConfig";
import { mobileBillDeskRouter } from "./mobileBillDesk";
import { patientPortalRouter } from "./patientPortal";
import { onlineBookingsRouter } from "./online-bookings";
import { webauthnRouter } from "./webauthn";
import { dailySummaryRouter } from "./daily-summary";
import { advancedDashboardRouter } from "./advanced-dashboard";
import { reconciliationRouter } from "./reconciliation";
import { myDailySummaryRouter } from "./my-daily-summary";
import { outsourcedLabsRouter } from "./outsourced-labs";
import { kioskRouter } from "./kiosk";
import { dayCloseRouter } from "./day-close";
import { booksSanityRouter } from "./books-sanity";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { requireSuperAdminUsb, isValidUsbKey, isUsbGateEnforced } from "../middleware/requireSuperAdminUsb";
import { requireStaffAuth, requireStaffPermission, requireStaffSubPermission, requireAdminRole } from "../middleware/requireStaffAuth";
import diagnosticsRouter from "./diagnostics";
import billingPerformanceRouter from "./billingPerformance";
import billingDeskSaveRouter from "./billingDeskSave";
import adminOperationsRouter from "./admin-operations";
import { measurementRegistryRouter } from "./measurementRegistry";
import { pathologyRegistryRouter } from "./pathologyRegistry";
import radiologyQuickFindingsRouter from "./radiologyQuickFindings";
import radiologyCatalogRouter from "./radiologyCatalog";
import radiologyContentPackTilesRouter from "./radiologyContentPackTiles";
import radiologyWhisperProxyRouter from "./radiologyWhisperProxy";
import { db, clinicSettingsTable, ledgersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { backupLimiter, exportLimiter, adminMutationLimiter, standardUploadLimiter, loginLimiter, generalLimiter, n8nAutomationLimiter } from "../middleware/rateLimits";
import { activePluginRouter } from "../plugin-loader";
import { superAdminHostAuthRouter } from "./superAdminHostAuth";
import { superAdminBooksHostRouter } from "./superAdminBooksHost";
import userPreferencesRouter from "./userPreferences";
import barcodeResolverRouter from "./barcode-resolver";
import { uploadsRouter } from "./uploads";
import { scansRouter } from "./scans";
import { radiologyReportGeneratorRouter } from "./radiology-report-generator";
import { radiologyReportAttachmentsRouter } from "./radiology-report-attachments";
import electronicFilmRouter, { electronicFilmPublicRouter } from "./electronic-film";
import { radiologyFindingLibraryRouter } from "./radiology-finding-library";
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
import { voiceReportComposerRouter } from "./voiceReportComposer";
import { aiPipelineHealthRouter } from "./aiPipelineHealth";
import { radiologySnippetsRouter } from "./radiologySnippets";
import { radiologyReportFormatsRouter } from "./radiologyReportFormats";
import { radiologyMyAnalyticsRouter } from "./radiologyMyAnalytics";
import { bankingRouter, bankingWebhookRouter } from "./banking";
import { syncRouter } from "./sync";
import { usgExtractionRouter } from "./usgExtraction";
import { usgDopplerRouter } from "./usgDoppler";
import { usgReportsRouter } from "./usgReports";
import { usgCriticalAlertsRouter } from "./usgCriticalAlerts";
import { usgAnalyticsRouter } from "./usgAnalytics";
import { careUsgCompanionRouter } from "./careUsgCompanion";
import usgPacsReturnRouter from "./usgPacsReturn";
import usgAdminRouter from "./usgAdmin";
import usgPriorRouter from "./usgPrior";
import usgObDopplerRouter from "./usgObDoppler";
import usgAiRouter from "./usgAi";
import usgCineRouter from "./usgCine";
import { radiologyKnowledgePacksRouter } from "./radiologyKnowledgePacks";
import echoCardiologyRouter from "./echoCardiology";
import fetalUsgLevel4Router from "./fetalUsgLevel4";
import pregnancyDashboardRouter from "./pregnancyDashboard";
import sonologistAssistantRouter from "./sonologistAssistant";
import dicomStudyManagerRouter from "./dicomStudyManager";
import dicomWorkflowRouter from "./dicomWorkflow";
import smartRadiologyRouter from "./smartRadiology";
import reportQualityRouter from "./reportQuality";
import risMonitoringRouter from "./risMonitoring";
import radiologyWorkflowRouter from "./radiologyWorkflow";
import { aiClinicalRouter } from "./aiClinical";
import { aiInteropRouter } from "./aiInterop";
import { scanSessionsRouter } from "./scan-sessions";
// Federated Radiology Service — boundary API (additive, server-to-server only)
import boundaryRouter from "./boundary";
import { gatewayWebhookRouter } from "./gateway-webhooks";
// FHIR R4 read façade — self-authenticating (Bearer FHIR_API_KEY), off until configured.
import fhirRouter from "./fhir";
// ABDM / ABHA national health stack — management (staff auth) + gateway callbacks
// (public transport, ABDM_CALLBACK_SECRET). Off until ABDM_ENABLED=true.
import abdmRouter, { callbackRouter as abdmCallbackRouter } from "./abdm";
import abdmExtRouter from "./abdmExt";

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

// Host-side login (before plugin gate). Fixes:
//  - "Super Admin plugin is not loaded" blocking PIN/usbPin login
//  - brittle exact display-name match ("Dr Abinash Kumar" only)
router.use("/super-admin", superAdminHostAuthRouter);
// Host-side assign-doctors (before plugin gate). Fixes USB plugin SQL that
// referenced non-existent orders.appointment_id → Internal server error.
router.use("/super-admin", superAdminBooksHostRouter);

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
// Windows / DS225+ Emergency CARE → Main CARE bridge (fetch-token auth, not staff session).
// Lets the emergency PC pull master snapshots and push JSON bills when Main CARE is back.
router.use("/emergency-bridge", emergencyBridgeRouter);
// Federated Radiology Service boundary API — API-key auth (X-Boundary-Key),
// not staff session. Mounted before staff-auth routes so the radiology
// service can reach it server-to-server without a staff login.
router.use("/boundary", boundaryRouter);
// FHIR R4 read façade — Bearer FHIR_API_KEY (server-to-server), not staff session.
// Returns 503 until FHIR_API_KEY is configured, so patient data stays unexposed by default.
router.use("/fhir", fhirRouter);
// ABDM gateway callbacks — public transport, gated by ABDM_ENABLED + a shared
// ABDM_CALLBACK_SECRET (fail-closed). Mounted before the staff-auth management
// router so gateway callbacks reach it without a staff login.
router.use("/abdm/callback", abdmCallbackRouter);
// Internal cron trigger endpoints — auth via CRON_SECRET bearer token, not staff session.
// Hit by a Replit Scheduled deployment (see scripts/src/trigger-cron.ts) so cron emails
// keep firing on autoscale where in-process schedulers are disabled.
router.use("/internal/cron", internalCronRouter);
// n8n -> CARE WhatsApp automation triggers — auth via a dedicated
// WHATSAPP_AUTOMATION_SECRET bearer token (separate from CRON_SECRET), rate
// limited. See internal-automations-whatsapp.ts for the full contract.
router.use("/internal/automations/whatsapp", n8nAutomationLimiter, internalAutomationsWhatsappRouter);
// Internal RIS/PACS automation endpoints — auth via INTERNAL_API_KEY bearer token.
// Called by Conquest PACS scripts and other server-to-server automations.
// Internal backup download — streams pg_dump output for off-site replication.
router.use("/internal/backup", internalBackupRouter);
router.use("/internal", internalRadiologyRouter); // [ZONE: radiology] name is generic, content is 100% radiology (DICOM agent callbacks)
router.use("/portal", portalRouter);
router.use("/display", displayRouter);
router.use("/settings/queue-display", queueDisplaySettingsRouter);
// Auth is enforced per-route inside paymentDisplayRouter itself (staff auth
// for the POST mutations Bill Desk calls, staff-or-display-token for the GET
// feed the customer-facing screen reads) — same pattern as displayRouter above.
router.use("/payment-display", paymentDisplayRouter);
router.use("/bridge", bridgeRouter);
// Public tokenized PDF download for patient WhatsApp links — no staff auth.
router.use("/p/r", publicReportsRouter);
// Public tokenized patient feedback / NPS form — no staff auth. Serves a
// self-contained HTML page and records the response. Gated by ff_feedback_nps.
router.use("/f", publicFeedbackRouter);
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

// Public mobile-app display config (clinic info + admin-curated content for
// diagno-booking-mobile). Whitelisted non-secret fields only — see the router.
router.use("/public/mobile-config", mobileConfigRouter);

// Patient portal — OTP-over-WhatsApp login minting server-side sessions, and
// session-gated bookings/reports. The OTP endpoints are public (rate-limited
// inside the router); the data endpoints enforce the patient session token.
router.use("/patient", patientPortalRouter);

// Payment gateway server-to-server webhooks (ICICI, HDFC).
// MUST be public — the gateways POST here without a staff session.
// Individual admin endpoints inside the router apply requireStaffAuth themselves.
router.use("/gateway", gatewayWebhookRouter);

// Self-registration kiosk — public, rate-limited. Patients register and pay
// via UPI at an unattended kiosk without a staff login. Rate-limited at the
// route level; no sensitive staff data is accessible from these endpoints.
router.use("/kiosk", kioskRouter);

// WhatsApp Business webhook is mounted directly on the Express app in
// app.ts, BEFORE the global express.json() parser, so POST handlers can
// verify Meta's x-hub-signature-256 HMAC against the exact raw request
// bytes (see MetaWhatsAppCloudProvider.verifyWebhook). Routing it a second
// time here — after express.json() has already consumed the body — would
// either never be reached (app.ts's mount fully handles the request first)
// or, if it somehow were, would verify against a re-serialized JSON.stringify
// of the parsed body instead of the bytes Meta actually signed. Do not
// re-add a mount for "/whatsapp/webhook" here.

// Website router: GET endpoints are intentionally public so the clinic-site
// frontend can fetch settings/pages/faqs/photos/popups without credentials.
// Mutating endpoints inside websiteRouter each apply requireStaffAuth directly.
// Must be mounted here (above the pathless storage middleware) so that
// unauthenticated public requests are not intercepted by requireStaffAuth.
router.use("/website", websiteRouter);

// HOPE → CARE inbound inter-org API (versioned). Mounted public like other
// server-to-server integrations; each route self-applies
// requireIntegrationPartnerAuth with a hashed partner key. Nothing flows until
// an active integration partner is provisioned via the admin console.
router.use("/integration/v1", integrationInboundRouter);

// ─── Staff-authenticated ERP routes ──────────────────────────────────────────
// Each route requiring a module permission is gated with requireStaffPermission
// immediately after requireStaffAuth so that low-privilege staff cannot access
// modules they have not been granted, even by calling the API directly.

// [ZONE: shared] patients, doctors, tests catalogue — used by both Billing
// and Radiology. See /PROTECTED_FILES.md before modifying.

// Patient data — /patients permission
router.use("/patients", requireStaffAuth, requireStaffPermission("/patients"), patientsRouter);
router.use("/patients", requireStaffAuth, requireStaffPermission("/patients"), patientTimelineRouter);

// Doctor catalogue: any authenticated staff can READ (Billing Desk's
// referring-doctor picker and Register.tsx both need the doctor list, same
// as /tests). Mutations (create/update/delete/import) stay /doctors-gated.
router.use(
  "/doctors",
  requireStaffAuth,
  (req, res, next) => {
    if (req.method === "GET") return next();
    return requireStaffPermission("/doctors")(req, res, next);
  },
  doctorsRouter,
);

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

// HOPE Referrals inbox — CARE staff workflow (verify patient → verify/map tests
// → create CARE order → hand off to existing billing). New /hope-referrals
// permission; admin/super_admin always have access. Additive — creates orders
// via the canonical path and NEVER writes a bill.
router.use("/hope-referrals", requireStaffAuth, requireStaffPermission("/hope-referrals"), hopeReferralsRouter);

// Integration admin console — partner provisioning, catalogue mappings, failed
// integrations / outbox. Admin / super_admin only.
router.use("/integration/admin", requireStaffAuth, requireAdminRole, integrationAdminRouter);

// [ZONE: billing] PROTECTED — orders, bills, payments, reports, inventory,
// accounting, discounts, expenses, ledgers, day-close, books-sanity.
// Any change here requires Dr. Abinash's explicit sign-off.
// See /PROTECTED_FILES.md.

// Order management — /orders permission
router.use("/orders", requireStaffAuth, requireStaffPermission("/orders"), ordersRouter);

// Billing — /billing permission (covers bill creation, edits, refunds, cancels)
router.use("/bills", requireStaffAuth, requireStaffPermission("/billing"), billsRouter);

// One-shot desk save (order+bill) — needs BOTH /orders and /billing, same as
// the two-call path the desk used before.
router.use(
  "/billing",
  requireStaffAuth,
  requireStaffPermission("/orders"),
  requireStaffPermission("/billing"),
  billingDeskSaveRouter,
);

// Payments — /payments permission
router.use("/payments", requireStaffAuth, requireStaffPermission("/payments"), paymentsRouter);

// Emergency Billing reconciliation (DS225+ → canonical CARE). Admin only.
// USB catalogue seed download is further gated to super_admin staff login.
// Does not create a second billing engine; imports through existing order/bill/payment tables.
router.use("/emergency-billing", requireStaffAuth, requireAdminRole, emergencyBillingRouter);

// Mobile Bill Desk — READ-ONLY billing views for the staff mobile app, behind
// its own dedicated permission so admins grant mobile billing visibility per
// staff member independent of the desktop /billing permission.
router.use("/mobile-bill-desk", requireStaffAuth, requireStaffPermission("/mobile-bill-desk"), mobileBillDeskRouter);

// Reports — /reports permission (covers dashboard, revenue, print reports)
router.use("/reports", requireStaffAuth, requireStaffPermission("/reports"), reportsRouter);

// Admin-only request performance diagnostics (not part of the toggleable
// per-user permission system — see requireAdminRole).
router.use("/diagnostics", requireStaffAuth, requireAdminRole, diagnosticsRouter);

// Admin-only Clinic Peak / Billing Lane monitor (composes requestMetrics +
// cheap health probes; no per-request DB writes; PHI-free).
router.use("/admin/billing-performance", requireStaffAuth, requireAdminRole, billingPerformanceRouter);

// Admin-only Operational Health / Deployment Smoke Test (one-minute
// post-rebuild verification: application/db/auth/core-erp/radiology-pacs/
// queue/integrations/storage checks + persisted run history).
router.use("/admin/operations", requireStaffAuth, requireAdminRole, adminOperationsRouter);

// Unified operational-health cockpit + proactive alerts (admin-only). Gated
// additionally by ff_ops_cockpit (Shadow Mode) inside the router.
router.use("/ops-cockpit", requireStaffAuth, requireAdminRole, opsCockpitRouter);

// Admin-only Universal Measurement Registry manager (read-only console +
// live impact analysis over quick measurements / protocols / packs / rules).
router.use("/measurement-registry", requireStaffAuth, requireAdminRole, measurementRegistryRouter);

// Admin-only Universal Pathology Registry manager (read-only catalog + live
// self-validation + coverage scan of existing report parameter labels).
router.use("/pathology-registry", requireStaffAuth, requireAdminRole, pathologyRegistryRouter);

// Inventory — /inventory permission (demands router first — /demands before /:id)
router.use("/inventory", requireStaffAuth, requireStaffPermission("/inventory"), inventoryDemandsRouter);
router.use("/inventory", requireStaffAuth, requireStaffPermission("/inventory"), inventoryRouter);
// Reagent batch/lot + expiry + auto-reorder — additive, same /inventory prefix + guards.
router.use("/inventory", requireStaffAuth, requireStaffPermission("/inventory"), inventoryBatchesRouter);
// Scan a supplier invoice -> OCR + catalog-match -> review -> post as stock-in.
// Same /inventory permission — this is an alternate entry point to the same
// Stock In flow, not a distinct module.
router.use("/purchase-invoices", requireStaffAuth, requireStaffPermission("/inventory"), purchaseInvoicesRouter);

// ABDM / ABHA management — /settings permission. Callbacks are mounted publicly
// above (/abdm/callback); this staff-gated router handles the rest of /abdm.
router.use("/abdm", requireStaffAuth, requireStaffPermission("/settings"), abdmRouter);
// ABDM/ABHA consent-request lifecycle + ABHA enrolment (additive extension).
// Mounted at a DISTINCT /abha prefix (not a second /abdm router): the existing
// abdmRouter's ABDM_ENABLED gate 503s every /abdm/* request when ABDM is off,
// which would block these routes in Shadow Mode. This router is gated by
// ff_abdm_abha instead (real gateway calls still require ABDM_ENABLED inside).
router.use("/abha", requireStaffAuth, requireStaffPermission("/settings"), abdmExtRouter);

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

// Reprint reasons — /billing permission (configuration for the bill re-print
// dialog). Same read-open/write-gated shape as discount-reasons above: any
// authenticated staff can READ (the re-print dialog dropdown needs the
// active reasons), mutations require /billing.
router.use(
  "/reprint-reasons",
  requireStaffAuth,
  (req, res, next) => {
    if (req.method === "GET") return next();
    return requireStaffPermission("/billing")(req, res, next);
  },
  reprintReasonsRouter,
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
// People Management platform (360° profile foundation). Same gate as HR;
// additionally behind ff_hr_staff_enhanced (Shadow Mode) inside the router.
router.use("/people", requireStaffAuth, requireStaffSubPermission("/settings", "users"), peopleRouter);
// Performance module (advisory, shadow-mode); gated additionally by
// ff_hr_performance_scoring inside the router.
router.use("/performance", requireStaffAuth, requireStaffSubPermission("/settings", "users"), performanceRouter);
// Recognition, allowances & notifications (advisory); per-feature flags inside.
router.use("/recognition", requireStaffAuth, requireStaffSubPermission("/settings", "users"), recognitionRouter);
// Appraisal, increment recommendations & PIP (advisory); gated by ff_hr_annual_appraisals inside.
router.use("/appraisal", requireStaffAuth, requireStaffSubPermission("/settings", "users"), appraisalRouter);
// Duty roster, leave & disciplinary (HR-gated; per-feature ff_hr_* flags inside).
router.use("/roster", requireStaffAuth, requireStaffSubPermission("/settings", "users"), rosterRouter);
router.use("/leave", requireStaffAuth, requireStaffSubPermission("/settings", "users"), leaveRouter);
router.use("/disciplinary", requireStaffAuth, requireStaffSubPermission("/settings", "users"), disciplinaryRouter);
// Employee self-service (self-scoped to the caller's own staff record — requireStaffAuth only).
router.use("/self-service", requireStaffAuth, mySelfServiceRouter);

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
    res.json({
      name: "Care Diagnostics", tagline: "", address: "", registeredAddress: "", phone: "", email: "", website: "", gstin: "",
      logoDataUrl: null, footerNote: "", billPrintCopies: 1, billDefaultPaperSize: "A5",
      billPrintSettingsJson: "{}",
      billShowCode: false, billShowCategory: false, qrOnBillEnabled: true, showTatOnBill: false,
      dayCloseAutoPrint: true, quickTestIds: "[null,null,null,null,null,null]", formFTestIds: "[]",
      formFBillingPrompt: false, formFAddressRequired: true, formFGuardianRequired: true,
      patientPhoneRequired: true,
    });
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
    // Required for Admin Lock / clinic-wide bill print — Billing Desk and Bill
    // Detail load clinic data from this public branding route (not the auth
    // GET /clinic-settings). Without this field, adminLock never reaches counters.
    billPrintSettingsJson: row.billPrintSettingsJson ?? "{}",
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
    patientPhoneRequired: row.patientPhoneRequired ?? true,
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

// Per-staff Billing Desk Quick Doctor slot layout — personal data, not a
// clinic-wide setting. Any authenticated staff member may read/write their
// OWN row; requireStaffAuth alone is the correct (and only) gate here — see
// staffQuickDoctors.ts, which always scopes to req.staffSession.subjectId
// and never trusts a client-supplied staffId. Do NOT gate this with
// requireStaffSubPermission("/settings", ...) — that would reintroduce the
// "Failed to save quick doctor" 403 for non-admin staff this route exists
// to fix.
router.use("/my/quick-doctors", requireStaffAuth, staffQuickDoctorsRouter);

router.use("/email-settings", requireStaffAuth, requireStaffSubPermission("/settings", "notifications"), emailSettingsRouter);
// Immutable audit-trail viewer (login/logout/password/account events + all
// module audit rows). Gated to security-permitted staff / admins — same gate
// as Settings → Security.
router.use("/audit-trail", requireStaffAuth, requireStaffSubPermission("/settings", "security"), auditTrailRouter);
// Server-side feature flags (Radiology Implementation Roadmap, Ticket T0.1).
// GET is open to any authenticated staff member — the client needs it on
// every page load to hydrate ff_radiology_* flags. Mutations are gated
// requireAdminRole INSIDE the router (see featureFlags.ts), not here, so no
// extra permission wrapper is added at the mount point.
router.use("/feature-flags", requireStaffAuth, featureFlagsRouter);
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
router.use("/report-templates", requireStaffAuth, requireStaffPermission("/report-generator"), reportTemplatesRouter);
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
// Phase P3 — AI clinical workflow (scheduler/policy/preferences/draft). Every
// endpoint is internally gated by the ff_radiology_ai master flag + per-scope
// policy (default OFF), so mounting it exposes nothing until an admin enables it.
router.use("/ai", requireStaffAuth, requireStaffPermission("/radiology"), aiClinicalRouter);
// Phase P4 — AI enterprise interoperability (DICOM SR / FHIR / viewer sync /
// timeline / comparison / feedback dataset). Same master flag + per-scope
// gating as the clinical router; exports are admin-gated. Additive only.
router.use("/ai/interop", requireStaffAuth, requireStaffPermission("/radiology"), aiInteropRouter);

// USG auto-measurement extraction — all authenticated staff can trigger/review;
// settings writes require admin role (enforced inside the router).
router.use("/usg-extraction", requireStaffAuth, requireStaffPermission("/radiology"), usgExtractionRouter);

// USG Doppler measurements — all authenticated staff can read/write.
router.use("/usg-doppler", requireStaffAuth, requireStaffPermission("/radiology"), usgDopplerRouter);

// USG Report Drafts — all authenticated staff can create/edit drafts.
router.use("/usg-reports", requireStaffAuth, requireStaffPermission("/radiology"), usgReportsRouter);
router.use("/usg-critical", requireStaffAuth, requireStaffPermission("/radiology"), usgCriticalAlertsRouter);
router.use("/usg-analytics", requireStaffAuth, requireStaffPermission("/radiology"), usgAnalyticsRouter);

// CARE USG Companion (Phase 1) — study-scoped assembly + telemetry + dashboard
// stats. Composes existing engines only (no new measurement/template/copilot
// engine). Study/assembly responses are shared resources (keyed by study), so
// they are safe for the service worker to cache — no personal-identity scoping.
router.use("/care-usg-companion", requireStaffAuth, requireStaffPermission("/radiology"), careUsgCompanionRouter);

// USG Companion admin / rollout control plane (P9). Readiness matrix is readable
// by any radiology staff; flag enable/disable/kill-switch are admin-only and
// server-enforced (dependency + clinic-validation gates), and every change is
// audited. This is the one surface that turns USG phase flags on/off.
router.use("/usg-admin", requireStaffAuth, requireStaffPermission("/radiology"), usgAdminRouter);

// USG P4 prior-study intelligence — comparable priors, structured comparison,
// pregnancy timeline. Read-only; each endpoint is flag-gated (404 when OFF) and
// same-patient guarded at both the SQL and the matcher layer.
router.use("/usg-prior", requireStaffAuth, requireStaffPermission("/radiology"), usgPriorRouter);

// USG P5 OB & Doppler — canonical sections built via the one obstetric engine.
// Each endpoint is flag-gated (404 when OFF); responses are canonical section +
// impression payloads the workspace merges into the draft. No fetal sex; Form-F
// is display-only (the finalize gate stays fail-closed).
router.use("/usg-ob-doppler", requireStaffAuth, requireStaffPermission("/radiology"), usgObDopplerRouter);

// USG P6 report→PACS return — fail-closed eligibility + enqueue of the durable
// USG_PACS_RETURN_JOB (drained by the existing per-minute cron). Flag-gated
// (404 when OFF). The actual push is the canonical archiveReportToPacs; drafts
// and superseded / PCPNDT-non-compliant reports are never enqueued.
router.use("/usg-pacs-return", requireStaffAuth, requireStaffPermission("/radiology"), usgPacsReturnRouter);

// USG P8 advisory AI — suggestion-only; accept-only; honest unavailable state
// when no model gateway. Flag-gated (404 when OFF). AI can never reach a signed
// report (write-guard throws on any non-draft target).
router.use("/usg-ai", requireStaffAuth, requireStaffPermission("/radiology"), usgAiRouter);

// USG P7 cine — capture key frames (DICOM references) from multi-frame clips.
// Flag-gated (404 when OFF); DICOM references only, never a fabricated frame.
router.use("/usg-cine", requireStaffAuth, requireStaffPermission("/radiology"), usgCineRouter);

// CARE Knowledge Pack Engine — a registry/loader/validator over the existing
// per-study-type content (quick findings / protocols / history / measurements /
// impression rules / templates / teaching / knowledge). Reads: any radiology
// staff. Mutations: admin-only (enforced inside the router). Purely additive.
router.use("/radiology/knowledge-packs", requireStaffAuth, requireStaffPermission("/radiology"), radiologyKnowledgePacksRouter);
router.use("/echo-cardiology", requireStaffAuth, requireStaffPermission("/radiology"), echoCardiologyRouter);
router.use("/fetal-usg", requireStaffAuth, requireStaffPermission("/radiology"), fetalUsgLevel4Router);
router.use("/fetal-usg-dashboard", requireStaffAuth, requireStaffPermission("/radiology"), pregnancyDashboardRouter);
router.use("/radiology-copilot/sonologist-assistant", requireStaffAuth, requireStaffPermission("/radiology"), sonologistAssistantRouter);

// Phase 10: RIS/PACS Foundation — DICOM study management + smart workflow
router.use("/dicom-studies", requireStaffAuth, requireStaffPermission("/dicom-nodes"), dicomStudyManagerRouter);
router.use("/dicom-workflow", requireStaffAuth, requireStaffPermission("/radiology"), dicomWorkflowRouter);
router.use("/smart-radiology", requireStaffAuth, requireStaffPermission("/radiology"), smartRadiologyRouter);
// PR #101 Phase 2 — canonical Report Quality Engine (shadow; additive, no
// existing endpoint replaced). Establishes the canonical persistence + API DTO.
router.use("/report-quality", requireStaffAuth, requireStaffPermission("/radiology"), reportQualityRouter);

// Phase 11: RIS/PACS Production Monitoring & Hardening
router.use("/ris-monitor", requireStaffAuth, requireStaffPermission("/radiology"), risMonitoringRouter);

// Phase 12: Real Radiology Workflow & DICOM Operations
router.use("/radiology-workflow", requireStaffAuth, requireStaffPermission("/radiology"), radiologyWorkflowRouter);

// Study locks / claiming (Ticket M1.6A) — one active lock per worklist study
// so two radiologists never unknowingly report the same study. Mounted before
// radiologyRouter; the /worklist-lock/* subpaths are unique to this router.
router.use("/radiology", requireStaffAuth, requireStaffPermission("/radiology"), radiologyWorklistLocksRouter);

// Assignment management (Ticket M1.6B1) — organizational ownership, distinct
// from the lock above. /worklist-assignment/*, /radiologists, /workload.
router.use("/radiology", requireStaffAuth, requireStaffPermission("/radiology"), radiologyWorklistAssignmentsRouter);

// Voice-command audit (Ticket M1.6B2) — high-risk voice attempts/outcomes
// into the hash-chained audit log. /voice-command-audit only.
router.use("/radiology", requireStaffAuth, requireStaffPermission("/radiology"), radiologyVoiceRouter);

// Backend v1 operational surface (Ticket BEND-1): health, consistency,
// re-delivery obligations, durable jobs, audit verification, restore proof,
// safe repairs. GET /health is staff-readable (masked); the rest is admin.
router.use("/radiology-ops", requireStaffAuth, requireStaffPermission("/radiology"), radiologyOpsRouter);

// Clinical-activation diagnostics toolkit (Ticket M1.3 "Flight Deck") —
// read-only deployment/viewer/network/study/workflow/settings diagnostics.
// Admin-only end to end (exposes unmasked endpoint topology).
router.use("/radiology-diagnostics", requireStaffAuth, requireStaffPermission("/radiology"), radiologyDiagnosticsRouter);

// Enterprise report template engine (Ticket R1.2): versioned presentation
// templates. Reads/previews are staff-visible; mutations are admin-only,
// audited, and version-creating only (published versions are immutable).
router.use("/radiology/presentation-templates", requireStaffAuth, requireStaffPermission("/radiology"), presentationTemplatesRouter);

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

// Attach an externally-produced (Word/PDF) final report to a radiology
// study — the clinic composes reports in Word, not this app's structured
// builder; see radiology-report-attachments.ts for the full rationale.
router.use(
  "/radiology/report-attachments",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyReportAttachmentsRouter,
);

router.use("/electronic-film/public", electronicFilmPublicRouter);

router.use(
  "/electronic-film",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  electronicFilmRouter,
);

// Editable findings library (Report Builder) — add/modify/delete abnormal
// findings per modality + organ; seeded once from the mined house catalogue.
router.use(
  "/radiology/finding-library",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyFindingLibraryRouter,
);

// Structured report templates — open to all authenticated staff for reading.
router.use(
  "/radiology/structured-report-templates",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  structuredReportTemplatesRouter,
);

// Radiology Quick Select — configurable study tabs + one-click finding
// buttons for the Reporting Workspace side panel. Reads: any radiology
// staff. Mutations: admin-only (enforced inside the router).
router.use(
  "/radiology/quick-select",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyQuickFindingsRouter,
);

// Radiology Canonical Catalog (Tickets B1 + B2) — the canonical parameter
// library + finding graph. FOUNDATION ONLY: the router itself is gated behind
// the ff_radiology_catalog feature flag (default OFF) and returns 404 until
// enabled, so nothing in the running product consumes these tables yet. Reads:
// radiology staff. Mutations: admin-only (enforced inside the router).
router.use(
  "/radiology/catalog",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyCatalogRouter,
);

// Radiology Content Pack Tiles — serves YAML content-pack findings as QuickSelectTiles
// to the reporting workspace. NOT gated behind ff_radiology_catalog — reads seed YAML.
router.use(
  "/radiology/content-pack-tiles",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyContentPackTilesRouter,
);

// Radiology Whisper Proxy — local STT for air-gapped deployments
router.use(
  "/radiology/whisper",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyWhisperProxyRouter,
);

// Radiology Snippets — Quick Add, Smart Format, Favorites, Macros
router.use(
  "/radiology/snippets",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologySnippetsRouter,
);

// Whole-report formats (Z.ai ReportFormat library) — radiology_snippets type=report_format
router.use(
  "/radiology/report-formats",
  requireStaffAuth,
  requireStaffPermission("/radiology"),
  radiologyReportFormatsRouter,
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
// Same permission as /patient-reports — this is the result-entry grid's own
// flag-suggestion call, not the admin-only /pathology-registry console.
router.use("/pathology-flag-preview", requireStaffAuth, requireStaffPermission("/reports"), pathologyFlagPreviewRouter);
// Staff-selected WhatsApp report delivery + read-receipt tracking + reminders.
// Gated additionally by ff_report_delivery_receipts (Shadow Mode) inside the router.
router.use("/report-delivery-tracking", requireStaffAuth, requireStaffPermission("/reports"), reportDeliveryTrackingRouter);
// Recall / follow-up engine. Gated additionally by ff_recall_engine (Shadow Mode) inside the router.
router.use("/recall", requireStaffAuth, requireStaffPermission("/reports"), recallRouter);
// Patient feedback / NPS dashboard (staff). Gated additionally by ff_feedback_nps (Shadow Mode) inside the router.
router.use("/feedback", requireStaffAuth, requireStaffPermission("/reports"), feedbackRouter);
// Online payment links for bills — additive scaffolding that reuses the
// sanctioned gateway/webhook path (no writes to bills/payments/vouchers). Gated
// additionally by ff_online_payment_links (Shadow Mode, disabled) inside the router.
router.use("/bill-payment-links", requireStaffAuth, requireStaffPermission("/billing"), billPaymentLinksRouter);

// AI Radiology Reporting — encrypted API keys, audit logging, draft management
router.use("/ai-reporting", requireStaffAuth, aiReportingRouter);

// AI Prompt Templates — modality-aware, versioned, editable-without-code prompts
router.use("/ai-prompt-templates", requireStaffAuth, aiPromptTemplatesRouter);
router.use("/ai-prompt-library", requireStaffAuth, aiPromptLibraryRouter);
router.use("/ai-model-routing", requireStaffAuth, aiModelRoutesRouter);

// Unified OCR + local-AI pipeline health / model registry / non-PHI smoke test
router.use("/ai-pipeline", requireStaffAuth, aiPipelineHealthRouter);

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
router.use("/radiology/voice-report-composer", requireStaffAuth, voiceReportComposerRouter);

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
router.use("/dashboard/reconciliation", requireStaffAuth, reconciliationRouter);
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
// Staff-facing conversation inbox, contacts, templates, audit logs and
// manual-send API — genuinely reusable and kept mounted.
//
// The "/wa-chatbot/webhook/:provider" POST/GET receiver that used to live
// alongside waChatbotRouter in ./waChatbot has been deleted outright (not
// just unmounted) — it was a second, divergent inbound-message pipeline
// whose signature check re-serialized the already-JSON-parsed body via
// JSON.stringify() before verifying, which could never match Meta's HMAC
// over the original raw bytes, and whose GET verification read
// WHATSAPP_VERIFY_TOKEN from the environment directly instead of the
// unified encrypted whatsapp_settings used everywhere else. The one
// production webhook is "/api/whatsapp/webhook" (mounted in app.ts, before
// express.json(), so it can verify against the true raw body) — its inbound
// handler already delegates to the same WhatsAppBotEngine used by that
// deleted route (see the comment above sharedBotEngine in
// routes/whatsapp.ts), so no bot behavior was lost. If a Meta app is still
// configured to call the old URL, repoint it at "/api/whatsapp/webhook".
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

// Shared document-scan metadata service (scanned_documents table) — reused
// by Form F, Patient Registration, Expenses, and Banking's UnifiedScanCapture
// flows. Auth is enforced per-route inside scans.ts (all routes require
// staff auth today; unlike scan-sessions, nothing here is phone-facing).
router.use("/scans", standardUploadLimiter, scansRouter);

// Wireless scan sessions & phone pairing. Staff-initiated routes (POST /create,
// GET /paired-phone) enforce requireStaffAuth themselves inside scan-sessions.ts.
// The remaining routes (GET /status/:token, POST /upload/:token, POST /pair,
// GET /mobile-poll/:deviceId) are deliberately token/device-scoped, not staff-
// session-scoped — a phone browser scanning the QR never carries a staff cookie,
// only the short-lived session token embedded in the QR URL, which *is* its auth.
// A blanket requireStaffAuth at the mount level here would 401 every one of those
// phone-facing calls (this previously broke Wireless Smart Scan end-to-end).
router.use("/scan-sessions", scanSessionsRouter);

export default router;
