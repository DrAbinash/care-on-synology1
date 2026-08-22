/**
 * Searchable destinations for the ERP-wide Ctrl+K palette (header, all pages).
 * Keep keywords generous — staff search by task name, not route.
 */

export type GlobalCommandAction = {
  id: string;
  label: string;
  path: string;
  group: string;
  keywords?: string[];
  hint?: string;
};

function settingsTab(id: string, label: string, keywords: string[] = []): GlobalCommandAction {
  return {
    id: `settings-tab-${id}`,
    label,
    path: `/settings?tab=${id}`,
    group: "Settings",
    keywords: ["settings", "configuration", "config", ...keywords],
    hint: "Settings tab",
  };
}

function radiologyTab(id: string, label: string, keywords: string[] = []): GlobalCommandAction {
  return {
    id: `radiology-tab-${id}`,
    label,
    path: `/settings/radiology?tab=${id}`,
    group: "Radiology Settings",
    keywords: ["radiology", "pacs", "settings", ...keywords],
    hint: "Radiology settings",
  };
}

function page(id: string, label: string, path: string, group: string, keywords: string[] = [], hint?: string): GlobalCommandAction {
  return { id, label, path, group, keywords, hint };
}

/** Flat catalog of every page / settings tab reachable from Ctrl+K. */
export const GLOBAL_COMMAND_ACTIONS: GlobalCommandAction[] = [
  // ── Core workflows ────────────────────────────────────────────────────────
  page("billing-desk", "Billing Desk", "/", "Core", ["bill", "billing", "cashier", "front desk"], "Home"),
  page("patients", "Patients", "/patients", "Core", ["patient list", "records"]),
  page("register", "Quick Register", "/register", "Core", ["new patient", "registration"]),
  page("orders", "Orders", "/orders", "Core", ["lab orders", "test orders"]),
  page("reports", "Reports", "/reports", "Core", ["analytics", "summary"]),
  page("my-daily-summary", "My Daily Summary", "/my-daily-summary", "Core", ["today", "daily"]),
  page("my-day-close", "My Day Close", "/my-day-close", "Core", ["close day", "handover"]),
  page("day-close", "Day Close (All Staff)", "/day-close", "Administration", ["close day", "owner"]),

  // ── Billing & payments ────────────────────────────────────────────────────
  page("bills", "Bills", "/billing", "Billing", ["billing list", "invoices"]),
  page("dues", "Due Payments", "/dues", "Billing", ["outstanding", "pending"]),
  page("payments", "Payments", "/payments", "Billing", ["receipts", "collections"]),
  page("payment-links", "Payment Links", "/payment-links", "Billing", ["online pay", "razorpay"]),
  page("discounts", "Discounts", "/discounts", "Billing", ["discount rules"]),
  page("packages", "Packages", "/packages", "Billing", ["health packages", "bundles"]),

  // ── Radiology & imaging ───────────────────────────────────────────────────
  page("rad-worklist", "Radiology Worklist", "/radiology/worklist", "Radiology", ["worklist", "studies", "dicom"]),
  page("rad-reporting", "Reporting Workspace", "/radiology/reporting-workspace", "Radiology", ["report", "dictation", "radiologist"]),
  page("rad-dicom-match", "DICOM Match", "/radiology/my-collection", "Radiology", ["match", "collection"]),
  page("rad-delivery", "Report Delivery", "/report-delivery", "Radiology", ["send report", "whatsapp report"]),
  page("rad-critical", "Critical Findings", "/radiology/critical-findings", "Radiology", ["critical", "alert"]),
  page("pacs-viewer", "PACS Viewer", "/pacs", "Radiology", ["ohif", "viewer", "images"]),
  page("echo", "Echo", "/echo", "Radiology", ["echocardiography", "cardiac"]),
  page("usg-worklist", "USG Worklist", "/radiology/worklist?modality=USG", "Radiology", ["ultrasound worklist"]),
  page("usg-reporting", "General USG Reporting", "/radiology/reporting-workspace?modality=USG", "Radiology", ["ultrasound report"]),
  page("fetal-usg", "Fetal USG", "/fetal-usg", "Radiology", ["obstetric", "pregnancy"]),
  page("fetal-echo", "Fetal Echo", "/fetal-echo", "Radiology", ["fetal cardiac"]),
  page("usg-doppler", "Doppler Reporting", "/usg/doppler", "Radiology", ["doppler", "vascular usg"]),
  page("usg-queue", "USG Queue / Call Next", "/queue?department=USG", "Radiology", ["ultrasound queue", "call next"]),
  page("rad-ops", "Radiology Ops Dashboard", "/radiology/operations-dashboard", "Radiology", ["operations", "owner"]),
  page("teleradiology", "Teleradiology", "/teleradiology", "Radiology", ["remote read"]),

  // ── Lab & pathology ───────────────────────────────────────────────────────
  page("samples", "Samples", "/samples", "Lab", ["lab samples", "specimens"]),
  page("report-hub", "Report Hub", "/report-hub", "Lab", ["pathology reports"]),
  page("report-generator", "Report Generator", "/report-generator", "Lab", ["lab report", "pathology"]),
  page("scan-station", "Scan Station", "/scan-station", "Lab", ["barcode", "sample scan"]),
  page("form-f", "Form F (PCPNDT)", "/form-f", "Lab", ["pcpndt", "form f", "compliance"]),

  // ── Outsource labs ────────────────────────────────────────────────────────
  page("outsource-worklist", "Outsource Worklist", "/outsource/worklist", "Outsource Labs", ["referral lab"]),
  page("outsource-rates", "Outsource Rate Cards", "/outsource/rate-cards", "Outsource Labs", ["rates", "pricing"]),
  page("outsource-recon", "Outsource Reconciliation", "/outsource/reconciliation", "Outsource Labs", ["reconcile"]),
  page("outsource-ledger", "Outsource Ledgers", "/outsource/ledger", "Outsource Labs", ["ledger"]),
  page("outsource-dashboard", "Outsource Dashboard", "/outsource/dashboard", "Outsource Labs", []),
  page("outsource-settings", "Outsource Settings", "/outsource/settings", "Outsource Labs", ["config"]),

  // ── Front desk & portals ──────────────────────────────────────────────────
  page("appointments", "Appointments", "/appointments", "Front Desk", ["schedule", "booking"]),
  page("online-bookings", "Online Bookings", "/online-bookings", "Front Desk", ["web booking"]),
  page("queue", "Queue Tokens", "/queue", "Front Desk", ["token", "waiting"]),
  page("hope-referrals", "HOPE Referrals", "/hope-referrals", "Front Desk", ["hope", "referral"]),

  // ── Staff & HR ────────────────────────────────────────────────────────────
  page("staff", "Staff Directory", "/staff", "Staff", ["employees", "hr"]),
  page("people", "People (360°)", "/people", "Staff", ["employee profile"]),
  page("performance", "Performance", "/performance", "Staff", ["kpi", "metrics"]),
  page("attendance", "Attendance Devices", "/attendance-devices", "Staff", ["biometric", "fingerprint"]),
  page("my-portal", "My Portal", "/my-portal", "Staff", ["self service"]),
  page("hr-forms", "HR Forms", "/hr-forms", "Staff", ["forms"]),
  page("leave", "Leave", "/leave", "Staff", ["time off"]),
  page("roster", "Duty Roster", "/roster", "Staff", ["shift", "schedule"]),
  page("disciplinary", "Disciplinary", "/disciplinary", "Staff", []),
  page("appraisals", "Appraisals", "/appraisals", "Staff", ["review"]),
  page("allowances", "Allowances", "/allowances", "Staff", []),
  page("awards", "Awards", "/awards", "Staff", []),

  // ── Administration ────────────────────────────────────────────────────────
  page("dashboard", "Owner Dashboard", "/dashboard", "Administration", ["admin", "owner", "overview"]),
  page("reconciliation", "Reconciliation Center", "/reconciliation", "Administration", ["reconcile", "accounts"]),
  page("diagnostics-api", "API Diagnostics", "/diagnostics", "Administration", ["api health"]),
  page("billing-performance", "Billing Peak Monitor", "/billing-performance", "Administration", ["performance"]),
  page("ops-cockpit", "Operations Cockpit", "/ops-cockpit", "Administration", ["ops"]),
  page("recall", "Recall & Follow-up", "/recall", "Administration", ["follow up"]),
  page("feedback", "Feedback / NPS", "/feedback", "Administration", ["nps", "survey"]),
  page("expenses", "Expenses", "/expenses", "Administration", []),
  page("accounting", "Accounting", "/accounting", "Administration", ["books", "ledger"]),
  page("banking", "Banking", "/banking", "Administration", []),
  page("books-sanity", "Books Sanity (CA)", "/books-sanity", "Administration", ["chartered accountant"]),
  page("website", "Website Builder", "/website", "Administration", ["clinic website"]),
  page("whatsapp-chatbot", "WhatsApp Chatbot", "/whatsapp-chatbot", "Administration", ["chatbot"]),
  page("machines", "Machines", "/machines", "Administration", ["equipment"]),
  page("inventory", "Inventory", "/inventory", "Operations", ["stock", "supplies"]),
  page("referrals", "Doctors", "/referrals", "Operations", ["referring doctors", "physicians"]),

  // ── Settings hub pages (sidebar) ──────────────────────────────────────────
  page("settings", "General Settings", "/settings", "Settings", ["configuration", "config", "clinic settings"]),
  page("settings-radiology-hub", "Radiology Settings Center", "/settings/radiology", "Radiology Settings", ["pacs", "dicom", "radiology admin"]),
  page("settings-scanner", "Scanner Settings", "/settings/scanner", "Settings", ["document scanner", "scan"]),
  page("test-catalog", "Test Catalog", "/tests", "Settings", ["tests", "pricing", "catalogue"]),
  page("measurement-registry", "Measurement Registry", "/measurement-registry", "Settings", ["measurements", "radiology parameters"]),
  page("pathology-registry", "Pathology Registry", "/pathology-registry", "Settings", ["pathology parameters"]),
  page("outsourced-labs", "Outsourced Labs", "/outsourced-labs", "Settings", ["referral labs"]),
  page("outsourced-costs", "Outsource Costs", "/outsourced-cost-report", "Settings", ["cost report"]),
  page("backup-replication", "Backup & Replication", "/backup-replication", "Settings", ["backup", "restore"]),
  page("system-update", "System Update", "/system-update", "Settings", ["upgrade", "version"]),
  page("abdm", "ABDM / ABHA", "/abdm-abha", "Settings", ["abha", "health id"]),
  page("whatsapp-integration", "WhatsApp Integration", "/admin/integrations/whatsapp", "Settings", ["whatsapp api", "notifications"]),
  page("knowledge-base", "Knowledge Base", "/knowledge-base", "Settings", ["articles", "help"]),
  page("hope-connection", "Hope Connection", "/hope-connection", "Settings", ["hope care", "partner"]),
  page("reception-command", "Reception Command Center", "/reception-command-center", "Settings", ["reception", "front desk"]),
  page("diagnostic-integration", "Diagnostic Integration", "/diagnostic-integration", "Settings", ["integration", "sync"]),
  page("ai-caller-credentials", "AI Caller Credentials", "/ai-caller-credentials", "Settings", ["voice ai", "caller"]),

  // ── Settings tabs (ERP Settings page) ─────────────────────────────────────
  settingsTab("clinic", "Clinic Info", ["clinic name", "address", "logo", "contact"]),
  settingsTab("integrations", "Integrations & Ops", ["hope", "reception", "diagnostic integration"]),
  settingsTab("about", "About / Version", ["version", "build", "release"]),
  settingsTab("appearance", "Appearance", ["theme", "sidebar", "colors", "dark mode"]),
  settingsTab("radiology", "Radiology (Settings tab)", ["radiology tools", "radiology hub"]),
  settingsTab("users", "Users", ["staff accounts", "roles", "permissions"]),
  settingsTab("security", "Security", ["fido", "2fa", "passkey", "login"]),
  settingsTab("password", "Change Password", ["pin", "credentials"]),
  settingsTab("portal", "Portal & Login", ["patient portal", "login page"]),
  settingsTab("online-booking", "Online Booking", ["website booking", "payment gateway"]),
  settingsTab("mobile-app", "Mobile App", ["android", "ios", "staff app"]),
  settingsTab("kiosk", "Self-Reg Kiosk", ["kiosk", "self registration", "qr"]),
  settingsTab("queue-settings", "Queue Settings", ["queue", "token", "display"]),
  settingsTab("queue-display", "Queue Display (TV)", ["tv", "waiting room", "screen"]),
  settingsTab("billing-print", "Billing Print", ["bill format", "invoice print", "receipt layout", "half a4", "a5"]),
  settingsTab("emergency-billing", "Emergency Billing", ["emergency", "after hours"]),
  settingsTab("receipt-messages", "Receipt Messages", ["receipt text", "footer message"]),
  settingsTab("footer-services", "Footer Services", ["bill footer", "services list"]),
  settingsTab("promotional-footer", "Promotional Footer", ["promo", "marketing footer"]),
  settingsTab("discount-reasons", "Discount Reasons", ["discount", "concession"]),
  settingsTab("reprint-reasons", "Edit/Modify/Reprint Reasons", ["reprint", "modify bill"]),
  settingsTab("email", "Email Notifications", ["smtp", "email alerts"]),
  settingsTab("printers", "Printers", ["print", "thermal", "a4"]),
  settingsTab("scanner", "Scanner (Settings tab)", ["document scanner"]),
  settingsTab("form-f", "Form F Tests (Settings)", ["pcpndt tests"]),
  settingsTab("departments", "Departments", ["department list"]),
  settingsTab("locations", "Locations", ["site", "branch location"]),
  settingsTab("branches", "Branches", ["multi branch"]),
  settingsTab("backup", "Backup (Settings tab)", ["database backup"]),
  settingsTab("audit-log", "Audit Log", ["audit trail", "history"]),
  settingsTab("feature-flags", "Feature Flags (Server)", ["flags", "beta", "toggle features"]),
  settingsTab("manual", "User Manual", ["help", "documentation", "guide"]),

  // ── Radiology Settings Center tabs ──────────────────────────────────────────
  radiologyTab("overview", "Radiology Overview", ["health", "status", "traffic light"]),
  radiologyTab("general", "Radiology General", ["start here", "hub"]),
  radiologyTab("pacs", "PACS Server", ["orthanc", "conquest", "dicom server"]),
  radiologyTab("pacs-advanced", "PACS Full Settings", ["dicom nodes", "ae title", "advanced pacs"]),
  radiologyTab("viewers", "Radiology Viewers", ["ohif", "weasis", "image viewer"]),
  radiologyTab("mwl", "Modality Worklist (MWL)", ["worklist sync", "dicom mwl"]),
  radiologyTab("modalities", "Modalities", ["ae title", "rooms", "ct", "mri", "usg"]),
  radiologyTab("sync", "Sync / Automation", ["care-erp-sync", "poller", "agent"]),
  radiologyTab("usg-extraction", "USG Extraction", ["ultrasound", "voluson", "sr extraction", "measurements"]),
  radiologyTab("quick-select", "Quick Select", ["finding chips", "macros", "shortcuts"]),
  radiologyTab("content-catalog", "Content Catalog", ["findings catalog", "parameters", "aliases"]),
  radiologyTab("reporting", "AI & Templates", ["ai reporting", "draft", "llm", "templates"]),
  radiologyTab("diagnostics", "Radiology Diagnostics", ["health check", "flight deck", "logs"]),
  radiologyTab("deployment", "Radiology Deployment", ["orthanc url", "mounts", "worker flags"]),
  radiologyTab("reading-suite", "Reading Suite", ["reading room", "workflow"]),
  radiologyTab("network", "Network Profiles", ["lan", "tailscale", "routing"]),
  radiologyTab("style", "Report Style", ["report style", "letterhead", "fonts", "print chrome", "presentation template", "logo", "header", "footer"]),
  radiologyTab("premium", "Premium Layout", ["premium report", "layout"]),
  radiologyTab("voice", "Voice Dictation", ["dictation", "speech", "microphone", "whisper"]),
  radiologyTab("history", "Clinical History Chips", ["history", "clinical history"]),
  radiologyTab("advanced", "Radiology Advanced", ["expert", "advanced options"]),

  // ── Radiology AI / admin deep links ─────────────────────────────────────────
  page("rad-ai-prompts", "AI Prompt Manager", "/radiology/ai-prompt-manager", "Radiology Settings", ["prompts", "ai"]),
  page("rad-ai-compare", "AI Comparison", "/radiology/ai-comparison", "Radiology Settings", ["compare drafts"]),
  page("rad-missed-finding", "Missed Finding Detector", "/radiology/missed-finding-detector", "Radiology Settings", ["qa", "missed finding"]),
  page("rad-image-review", "Image Review Assistant", "/radiology/image-review", "Radiology Settings", ["image ai"]),
  page("rad-provider-fallback", "AI Provider Fallback", "/radiology/provider-fallback", "Radiology Settings", ["failover", "openai", "anthropic"]),
  page("rad-ai-extraction", "AI Extraction Review", "/radiology/ai-extraction-review", "Radiology Settings", ["extraction queue"]),
  page("teaching-files", "Teaching Files", "/teaching-cases", "Radiology Settings", ["teaching cases"]),
  page("rad-knowledge-packs", "Radiology Knowledge Packs", "/settings/radiology/knowledge-packs", "Radiology Settings", ["knowledge pack", "install pack"]),
];

/** De-dupe by path — first entry wins (more specific labels kept earlier). */
export function dedupeGlobalCommands(actions: GlobalCommandAction[]): GlobalCommandAction[] {
  const seen = new Set<string>();
  const out: GlobalCommandAction[] = [];
  for (const action of actions) {
    if (seen.has(action.path)) continue;
    seen.add(action.path);
    out.push(action);
  }
  return out;
}

export const GLOBAL_COMMANDS = dedupeGlobalCommands(GLOBAL_COMMAND_ACTIONS);

/** Value string fed to cmdk for fuzzy matching. */
export function commandSearchValue(action: GlobalCommandAction): string {
  return [action.label, action.group, action.hint, ...(action.keywords ?? [])].filter(Boolean).join(" ");
}

export function filterGlobalCommands(query: string, actions: GlobalCommandAction[] = GLOBAL_COMMANDS): GlobalCommandAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return actions;
  return actions.filter((action) => commandSearchValue(action).toLowerCase().includes(q));
}

export function globalCommandGroups(actions: GlobalCommandAction[] = GLOBAL_COMMANDS): string[] {
  return Array.from(new Set(actions.map((a) => a.group)));
}
