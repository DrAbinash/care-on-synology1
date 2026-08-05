// Bill Print Settings — types, defaults, and persistence.
//
// Clinic-wide settings are stored server-side in clinic_settings.
// bill_print_settings_json (a JSON blob of Partial<BillPrintSettings>) —
// parse it with parseGlobalBillPrintSettings() and pass the result to
// loadBillPrintSettings(global) at every print call site. Per-user overrides
// live in localStorage keyed by user ID; when the server global has
// adminLock ON, those local overrides are ignored.
//
// HISTORY: before the server column existed, loadBillPrintSettings() was
// called everywhere WITHOUT the global — so "clinic-wide" settings silently
// lived only in each browser's localStorage, and what the admin configured
// (and verified in the Settings live preview) never reached other counters.
// A counter that still had the built-in A5-portrait default then sent A5
// print jobs to a printer tray loaded with A4 paper, which many drivers
// rotate 90° to fit — bills printed sideways while the admin's preview
// looked perfect. Always pass the server global here so the effective paper
// size is the one the clinic actually configured.

export type BillFormat = "classic" | "modern-landscape" | "premium-a5" | "designer-a" | "designer-b" | "designer-c";
// Ordered by recommendation, most-recommended first — "modern-landscape" is
// the purpose-built A5-landscape layout for Epson-style ink printers (most
// clinics' primary workflow); the older formats are kept for backward
// compatibility so existing counters that already picked one keep printing
// exactly the same bill.
export const BILL_FORMATS: { id: BillFormat; label: string }[] = [
  { id: "modern-landscape", label: "Modern — A5 Landscape (Recommended)" },
  { id: "classic",          label: "Classic (Legacy)" },
  { id: "premium-a5",       label: "Premium A5 (Legacy)" },
  { id: "designer-a",       label: "Designer A — Minimal Premium" },
  { id: "designer-b",       label: "Designer B — Modern Diagnostic" },
  { id: "designer-c",       label: "Designer C — Corporate Healthcare" },
];

export type BillPaperSize = "A5-landscape" | "A5-portrait" | "half-a4" | "A4";
export const BILL_PAPER_SIZES: { id: BillPaperSize; label: string }[] = [
  { id: "A5-portrait", label: "A5 Portrait" },
  { id: "A5-landscape", label: "A5 Landscape" },
  { id: "half-a4", label: "Half A4" },
  { id: "A4", label: "A4" },
];

export type CopyType = "patient" | "office" | "both";
export const BILL_COPY_TYPES: { id: CopyType; label: string }[] = [
  { id: "patient", label: "Patient Copy" },
  { id: "office", label: "Office Copy" },
  { id: "both", label: "Both Copies" },
];

export type PrintAction = "save-print" | "save-preview" | "save-only";
export const PRINT_ACTIONS: { id: PrintAction; label: string }[] = [
  { id: "save-print", label: "Save & Print" },
  { id: "save-preview", label: "Save & Preview" },
  { id: "save-only", label: "Save Only" },
];

export type UserRole = "reception" | "accounts" | "admin" | "supervisor" | "billing" | "lab" | "manager";

export type BillPrintSettings = {
  // Format
  defaultFormat: BillFormat;
  classicEnabled: boolean;
  premiumA5Enabled: boolean;
  designerAEnabled: boolean;
  designerBEnabled: boolean;
  designerCEnabled: boolean;
  // Auto paper size threshold: switch from A5 → A4 when tests >= this value
  autoA4Threshold: number;

  // Paper
  defaultPaperSize: BillPaperSize;

  // Copy
  defaultCopyType: CopyType;

  // Display toggles
  showQrCode: boolean;
  /** When true, printed bills show each test's catalog duration as a TAT column. */
  showTatOnBill: boolean;
  showAmountInWords: boolean;
  showSignatureLine: boolean;
  showComputerGenerated: boolean;
  showReportMessage: boolean;
  showServiceFooter: boolean;
  showBrandingFooter: boolean;
  showBarcode: boolean;
  showWatermark: boolean;
  showPatientInstructions: boolean;
  showSystemInfo: boolean;
  // Big "QUEUE TOKEN #NN" box on the printed bill (separate from the
  // per-test department token list, which always prints when present).
  // Off by default — most billing-counter receipts don't need it since the
  // per-test tokens already cover queue routing; kiosk self-registration
  // receipts show it unconditionally since that IS the kiosk's purpose.
  showQueueTokenOnBill: boolean;

  // ── Layout & typography (Classic format) ──
  // Every field here is nullable: null means "use the built-in tuned
  // default" (which still varies by A5 vs A4 paper size, see printBill.ts's
  // pageMargin/titleSize/etc.). A non-null value applies as a fixed
  // override regardless of paper size. This is deliberately per-field
  // rather than a single global "density" so a clinic can tune exactly the
  // one thing that's wrong for their printer without fighting a preset.
  printMarginMm: number | null;
  printTitleFontPx: number | null;
  printPatientNameFontPx: number | null;
  printBodyFontPx: number | null;
  printHeaderFontPx: number | null;
  printTableFontPx: number | null;
  printTotalFontPx: number | null;
  printFooterFontPx: number | null;
  printTinyFontPx: number | null;

  // Print action
  defaultPrintAction: PrintAction;

  // Preview
  enablePreview: boolean;
  directPrintAfterSave: boolean;
  autoOpenPrintDialog: boolean;
  askBeforePrint: boolean;
  autoDownloadPdf: boolean;
  fastBillingMode: boolean;

  // Admin lock
  adminLock: boolean;
};

export const GLOBAL_BILL_PRINT_DEFAULTS: BillPrintSettings = {
  // Dense A5-landscape receipt — fills the page professionally; avoids the
  // half-blank A4 look of Classic on full A4 paper for typical short bills.
  defaultFormat: "modern-landscape",
  classicEnabled: true,
  premiumA5Enabled: true,
  designerAEnabled: true,
  designerBEnabled: true,
  designerCEnabled: true,
  autoA4Threshold: 8,
  defaultPaperSize: "A5-landscape",
  defaultCopyType: "patient",
  showQrCode: true,
  showTatOnBill: false,
  showAmountInWords: false,
  showSignatureLine: true,
  showComputerGenerated: true,
  showReportMessage: true,
  showServiceFooter: true,
  showBrandingFooter: true,
  showBarcode: false,
  showWatermark: false,
  showPatientInstructions: false,
  showSystemInfo: false,
  showQueueTokenOnBill: false,
  printMarginMm: null,
  printTitleFontPx: null,
  printPatientNameFontPx: null,
  printBodyFontPx: null,
  printHeaderFontPx: null,
  printTableFontPx: null,
  printTotalFontPx: null,
  printFooterFontPx: null,
  printTinyFontPx: null,
  defaultPrintAction: "save-print",
  enablePreview: false,
  directPrintAfterSave: true,
  autoOpenPrintDialog: true,
  askBeforePrint: false,
  autoDownloadPdf: false,
  fastBillingMode: true,
  adminLock: false,
};

export const ROLE_BILL_PRINT_DEFAULTS: Record<UserRole, Partial<BillPrintSettings>> = {
  reception: {
    fastBillingMode: true,
    enablePreview: false,
    defaultPrintAction: "save-print",
  },
  accounts: {
    enablePreview: true,
    autoDownloadPdf: true,
    defaultPrintAction: "save-preview",
  },
  admin: {
    enablePreview: true,
    defaultPrintAction: "save-preview",
  },
  supervisor: {
    enablePreview: true,
    defaultPrintAction: "save-preview",
  },
  billing: {
    fastBillingMode: true,
    enablePreview: false,
    defaultPrintAction: "save-print",
  },
  lab: {
    fastBillingMode: true,
    enablePreview: false,
    defaultPrintAction: "save-print",
  },
  manager: {
    enablePreview: true,
    defaultPrintAction: "save-preview",
  },
};

// ── localStorage keys ──
const LS_KEY = (userId: string) => `diagnosticErp:billPrintSettings:${userId}`;
const LAST_USER_KEY = "diagnosticErp:lastBillPrintUserId";

export function getUserId(): string {
  try {
    const raw = window.localStorage.getItem("erp_session");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return String(parsed.user?.id ?? "");
  } catch {
    return "";
  }
}

export function getUserRole(): UserRole | null {
  try {
    const raw = window.localStorage.getItem("erp_session");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const role = String(parsed.user?.role ?? "");
    if (ROLE_BILL_PRINT_DEFAULTS[role as UserRole]) return role as UserRole;
    return null;
  } catch {
    return null;
  }
}

export function getUserName(): string {
  try {
    const raw = window.localStorage.getItem("erp_session");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return String(parsed.user?.name ?? "");
  } catch {
    return "";
  }
}

// Safe-parse the clinic_settings.billPrintSettingsJson blob (from
// GET /api/clinic-settings or /api/clinic-settings/branding) into the
// `global` argument for loadBillPrintSettings(). Anything malformed —
// null, empty, invalid JSON, or a non-object — degrades to {} so a bad
// or missing server value can never break printing.
export function parseGlobalBillPrintSettings(json: string | null | undefined): Partial<BillPrintSettings> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Partial<BillPrintSettings>;
  } catch {
    return {};
  }
}

export function billPrintSettingsStorageKey(userId = getUserId()): string {
  return userId ? LS_KEY(userId) : "diagnosticErp:billPrintSettings";
}

/** Drop this browser's per-user bill-print override (used when admin lock is on). */
export function clearBillPrintSettingsOverride(userId = getUserId()): void {
  try {
    window.localStorage.removeItem(billPrintSettingsStorageKey(userId));
  } catch {
    // ignore
  }
}

export function loadBillPrintSettings(global: Partial<BillPrintSettings> = {}): BillPrintSettings {
  const userId = getUserId();
  const role = getUserRole();
  const defaults = mergeDefaults(GLOBAL_BILL_PRINT_DEFAULTS, role);
  const merged = { ...defaults, ...global };
  const key = billPrintSettingsStorageKey(userId);

  // Admin lock = clinic-wide forced settings. Skip role defaults so every
  // counter gets the exact blob the admin saved, not role-specific tweaks.
  if (merged.adminLock) {
    const locked = { ...GLOBAL_BILL_PRINT_DEFAULTS, ...global } as BillPrintSettings;
    try {
      if (window.localStorage.getItem(key)) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
    return locked;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return merged;
    const parsed = JSON.parse(raw);
    return { ...merged, ...parsed };
  } catch {
    return merged;
  }
}

/** Persist a per-user override. Clinic-wide saves from Settings should NOT call this. */
export function saveBillPrintSettings(
  settings: Partial<BillPrintSettings>,
  global: Partial<BillPrintSettings> = {},
): void {
  if (global.adminLock || settings.adminLock) return;

  const key = billPrintSettingsStorageKey();
  try {
    const existing = loadBillPrintSettings(global);
    const merged = { ...existing, ...settings };
    window.localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export function mergeDefaults(base: BillPrintSettings, role: UserRole | null): BillPrintSettings {
  if (!role) return base;
  return { ...base, ...ROLE_BILL_PRINT_DEFAULTS[role] };
}

// ── Layout & typography overrides, ready to spread into BuildPrintHtmlOpts
// (printBill.ts). Centralized here so every print call site (Billing Desk,
// Bill Detail reprint, Settings live preview) stays in sync — see
// printMarginMm etc. on BillPrintSettings for field docs. ──
export function printLayoutOpts(settings: BillPrintSettings) {
  return {
    printMarginMm: settings.printMarginMm,
    printTitleFontPx: settings.printTitleFontPx,
    printPatientNameFontPx: settings.printPatientNameFontPx,
    printBodyFontPx: settings.printBodyFontPx,
    printHeaderFontPx: settings.printHeaderFontPx,
    printTableFontPx: settings.printTableFontPx,
    printTotalFontPx: settings.printTotalFontPx,
    printFooterFontPx: settings.printFooterFontPx,
    printTinyFontPx: settings.printTinyFontPx,
  };
}

// ── Helper to get current effective format ──
export function getEffectiveFormat(global: Partial<BillPrintSettings>, userOverride: Partial<BillPrintSettings> = {}): BillFormat {
  const merged = loadBillPrintSettings(global);
  const eff = { ...merged, ...userOverride };
  if (eff.defaultFormat === "modern-landscape") return "modern-landscape";
  if (eff.defaultFormat === "designer-a" && eff.designerAEnabled !== false) return "designer-a";
  if (eff.defaultFormat === "designer-b" && eff.designerBEnabled !== false) return "designer-b";
  if (eff.defaultFormat === "designer-c" && eff.designerCEnabled !== false) return "designer-c";
  if (eff.defaultFormat === "premium-a5" && eff.premiumA5Enabled) return "premium-a5";
  if (eff.defaultFormat === "classic" && eff.classicEnabled) return "classic";
  if (eff.premiumA5Enabled) return "premium-a5";
  if (eff.classicEnabled) return "classic";
  return "modern-landscape";
}

// ── Paper size helpers ──
export function getAutoBillPaperSize(
  testCount: number,
  manualSize?: BillPaperSize,
  threshold = 5,
): BillPaperSize {
  if (manualSize === "A4" || manualSize === "half-a4" || manualSize === "A5-landscape" || manualSize === "A5-portrait") return manualSize;
  return testCount > threshold ? "A4" : "A5-portrait";
}

export function getPaperSizeCss(size: BillPaperSize): { pageSize: string; width: string; minHeight: string; maxHeight: string } {
  switch (size) {
    case "A5-landscape":
      return { pageSize: "A5 landscape", width: "198mm", minHeight: "132mm", maxHeight: "none" };
    case "A5-portrait":
      return { pageSize: "A5 portrait", width: "136mm", minHeight: "194mm", maxHeight: "none" };
    case "half-a4":
      return { pageSize: "210mm 148mm", width: "210mm", minHeight: "140mm", maxHeight: "none" };
    case "A4":
    default:
      return { pageSize: "A4 portrait", width: "210mm", minHeight: "277mm", maxHeight: "none" };
  }
}

/** Resolved @page + body options shared by Billing Desk, Bill Detail, Settings preview. */
export type BillPrintPageOpts = {
  paperSize: "A4" | "A5";
  orientation: "portrait" | "landscape";
  /** Short A5 bills: avoid flex spacer that leaves a huge blank middle. */
  compactFooterGap: boolean;
  /** Exact CSS size for @page (half-a4, A5 landscape, etc.). */
  pageCssSize: string;
};

/**
 * Map clinic Billing Print settings + test count → paper/orientation the HTML
 * renderer should declare. Always honours defaultPaperSize (including
 * A5-landscape) — older call sites only passed A4/half-a4 as "forced", which
 * made landscape trays print portrait jobs and the driver scaled/rotated them.
 */
export function resolveBillPrintPageOpts(
  settings: Pick<BillPrintSettings, "defaultPaperSize" | "autoA4Threshold">,
  testCount: number,
): BillPrintPageOpts {
  const effective = getAutoBillPaperSize(
    testCount,
    settings.defaultPaperSize,
    settings.autoA4Threshold ?? 5,
  );
  if (effective === "A4") {
    return {
      paperSize: "A4",
      orientation: "portrait",
      // Short A4 bills still look sparse if we leave a huge flex gap — keep
      // the footer tight so content reads as one professional block.
      compactFooterGap: testCount <= 8,
      pageCssSize: "A4 portrait",
    };
  }
  const orientation: "portrait" | "landscape" =
    effective === "A5-landscape" ? "landscape" : "portrait";
  const pageCssSize =
    effective === "half-a4"
      ? "210mm 148mm"
      : effective === "A5-landscape"
        ? "A5 landscape"
        : "A5 portrait";
  return {
    paperSize: "A5",
    orientation,
    compactFooterGap: testCount <= 4,
    pageCssSize,
  };
}

/**
 * Bill Detail reprint exposes an A4/A5 header toggle. When staff pick manual
 * paper, honour it while keeping the clinic's A5 variant (landscape vs portrait).
 */
export function applyManualBillPaperOverride(
  settings: Pick<BillPrintSettings, "defaultPaperSize">,
  manualPaper: "A4" | "A5" | null | undefined,
): Pick<BillPrintSettings, "defaultPaperSize"> {
  if (!manualPaper) return settings;
  if (manualPaper === "A4") return { defaultPaperSize: "A4" };
  const size = settings.defaultPaperSize;
  if (size === "A5-landscape" || size === "half-a4") return { defaultPaperSize: size };
  return { defaultPaperSize: "A5-portrait" };
}

// ── Adaptive density class based on test count ──
export function getAdaptiveDensityClass(testCount: number): "premium-sparse-mode" | "normal-mode" | "compact-mode" {
  if (testCount <= 2) return "premium-sparse-mode";
  if (testCount <= 6) return "normal-mode";
  return "compact-mode";
}
