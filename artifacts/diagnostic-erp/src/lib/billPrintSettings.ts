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

export type BillFormat = "classic";
/** Retired format ids that may still appear in older clinic_settings JSON blobs. */
export type LegacyBillFormat =
  | BillFormat
  | "modern-landscape"
  | "premium-a5"
  | "designer-a"
  | "designer-b"
  | "designer-c";

/** All bill printing uses the unified Classic template. */
export function normalizeBillFormat(_raw: unknown): BillFormat {
  return "classic";
}

export type BillPaperSize = "A5-landscape" | "A5-portrait" | "half-a4" | "A4";
export const BILL_PAPER_SIZES: { id: BillPaperSize; label: string }[] = [
  { id: "A5-portrait", label: "A5 Portrait (148×210 mm)" },
  { id: "A5-landscape", label: "Half A4 / A5 (210×148 mm)" },
  { id: "half-a4", label: "Half A4 (same as A5)" },
  { id: "A4", label: "A4" },
];

export type CopyType = "patient" | "office" | "both";
export const BILL_COPY_TYPES: { id: CopyType; label: string }[] = [
  { id: "patient", label: "Patient Copy" },
  { id: "office", label: "Office Copy" },
  { id: "both", label: "Both Copies" },
];

/** Map copy-type dropdown → physical pages (patient/office = 1, both = 2). */
export function billPrintCopiesForCopyType(copyType: CopyType | undefined | null): number {
  return copyType === "both" ? 2 : 1;
}

/** Copy-type dropdown value that matches a physical copy count. */
export function copyTypeForBillPrintCopies(copies: number): CopyType {
  return copies >= 2 ? "both" : "patient";
}

/**
 * Physical bill pages to render/print. Source of truth is Settings → Billing
 * Print (`defaultCopyType`). Legacy `bill_print_copies` is used when the JSON
 * has no copy type, or still says patient while the column is 2 (old dual UI).
 */
export function resolveBillPrintCopyCount(
  clinic: { billPrintCopies?: number | null } | null | undefined,
  rawSettings?: { defaultCopyType?: CopyType | null } | null,
): number {
  const copyType = rawSettings?.defaultCopyType ?? null;
  if (copyType === "both") return 2;
  if (copyType === "office") return 1;
  const fromColumn = Number(clinic?.billPrintCopies);
  if (Number.isFinite(fromColumn) && fromColumn >= 2) return 2;
  return 1;
}

export type PrintAction = "save-print" | "save-preview" | "save-only";
export const PRINT_ACTIONS: { id: PrintAction; label: string }[] = [
  { id: "save-print", label: "Save & Print" },
  { id: "save-preview", label: "Save & Preview" },
  { id: "save-only", label: "Save Only" },
];

/** How Billing Desk should deliver a receipt after save. */
export type BillPrintDelivery = "print" | "preview-only" | "preview-and-print" | "skip";

/**
 * Decide whether to open the in-app preview, the browser print dialog, or both.
 * Explicit Save & Print always reaches the printer; enablePreview may also show
 * the in-app preview first.
 */
export function resolveBillPrintDelivery(
  settings: Pick<BillPrintSettings, "enablePreview" | "directPrintAfterSave" | "autoOpenPrintDialog">,
  intent: "save-print" | "save-only" | "background",
): BillPrintDelivery {
  if (intent === "save-only") return "skip";

  const shouldPrint =
    intent === "save-print" ||
    settings.directPrintAfterSave ||
    settings.autoOpenPrintDialog;

  if (!shouldPrint) {
    return settings.enablePreview ? "preview-only" : "skip";
  }

  if (intent === "save-print") {
    return settings.enablePreview ? "preview-and-print" : "print";
  }

  return settings.enablePreview ? "preview-only" : "print";
}

export type UserRole = "reception" | "accounts" | "admin" | "supervisor" | "billing" | "lab" | "manager";

export type BillPrintSettings = {
  /** @deprecated Always normalized to "classic"; kept for legacy JSON blobs only. */
  defaultFormat: BillFormat;
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
  /** Clinic logo height on the printed bill (px). null = format built-in default. */
  printLogoHeightPx: number | null;
  /** Header layout: "right" = address/phone/website under the invoice title
   * (bill number sits in the patient meta block under date/time);
   * "left" = address block under the clinic name (classic style). */
  headerLayout: "left" | "right" | null;
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
  defaultFormat: "classic",
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
  printLogoHeightPx: null,
  headerLayout: "right",
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

/**
 * Cursor-default bill paper — the only layout knob clinics cannot change.
 * Header, margins, fonts, copies, and QR/TAT remain Settings → Billing Print
 * controls. Changing `defaultPaperSize` / `autoA4Threshold` here is the only
 * way to retune the physical page.
 */
export const CURSOR_BILL_PRINT_LAYOUT = {
  defaultPaperSize: "A5-landscape" as BillPaperSize,
  autoA4Threshold: 8,
};

export type CursorBillPrintLayout = typeof CURSOR_BILL_PRINT_LAYOUT;

export function applyCursorBillPrintLayout<T extends Partial<BillPrintSettings>>(settings: T): T & CursorBillPrintLayout {
  return { ...settings, ...CURSOR_BILL_PRINT_LAYOUT };
}

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

function finalizeBillPrintSettings(settings: BillPrintSettings): BillPrintSettings {
  return applyCursorBillPrintLayout({
    ...settings,
    defaultFormat: "classic",
  });
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
    return finalizeBillPrintSettings(locked);
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return finalizeBillPrintSettings(merged);
    const parsed = JSON.parse(raw);
    return finalizeBillPrintSettings({ ...merged, ...parsed });
  } catch {
    return finalizeBillPrintSettings(merged);
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
// printMarginMm etc. on BillPrintSettings for field docs. Paper size stays
// Cursor-default via loadBillPrintSettings / resolveBillPrintPageOpts. ──
export function printLayoutOpts(settings: Partial<BillPrintSettings>) {
  return {
    printMarginMm: settings.printMarginMm,
    printLogoHeightPx: settings.printLogoHeightPx,
    headerLayout: settings.headerLayout,
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

/** Resolve logo height (px) for a bill format; clamps to a printable range. */
export function resolveBillLogoHeightPx(
  overridePx: number | null | undefined,
  formatDefaultPx: number,
): number {
  const raw = overridePx != null && Number.isFinite(overridePx) ? Number(overridePx) : formatDefaultPx;
  return Math.max(24, Math.min(160, Math.round(raw)));
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

/** Pixel dimensions for on-screen bill previews (96 dpi, matches Settings live preview). */
export function billPreviewPaperPx(pageOpts: BillPrintPageOpts): { w: number; h: number } {
  if (pageOpts.paperSize === "A4") return { w: 794, h: 1123 };
  // Half-sheet content is always 210×148 (landscape), even when @page is A4 portrait.
  if (pageOpts.orientation === "landscape" || pageOpts.pageCssSize.includes("210mm 148mm") || pageOpts.pageCssSize.includes("210mm 297mm")) {
    return { w: 794, h: 559 };
  }
  return { w: 559, h: 794 };
}

export function getPaperSizeCss(size: BillPaperSize): { pageSize: string; width: string; minHeight: string; maxHeight: string } {
  switch (size) {
    case "A5-landscape":
    case "half-a4":
      // Content is 210×148; @page is A4 portrait so the tray is not rotated.
      // Emitting 210×148 (landscape page box) makes Chrome/Epson leave blank
      // bands on the right and below.
      return { pageSize: "210mm 297mm", width: "210mm", minHeight: "148mm", maxHeight: "148mm" };
    case "A5-portrait":
      return { pageSize: "A5 portrait", width: "148mm", minHeight: "210mm", maxHeight: "none" };
    case "A4":
    default:
      return { pageSize: "A4 portrait", width: "210mm", minHeight: "297mm", maxHeight: "none" };
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
 * renderer should declare. Paper is Cursor-default (half A4 / A5 landscape on
 * an A4 portrait @page). Long bills (≥ Cursor autoA4Threshold) switch to A4.
 */
export function resolveBillPrintPageOpts(
  _settings: Pick<BillPrintSettings, "defaultPaperSize" | "autoA4Threshold"> | Partial<BillPrintSettings> | undefined,
  testCount: number,
): BillPrintPageOpts {
  const threshold = CURSOR_BILL_PRINT_LAYOUT.autoA4Threshold;
  if (testCount >= threshold) {
    return {
      paperSize: "A4",
      orientation: "portrait",
      compactFooterGap: testCount <= 8,
      pageCssSize: "A4 portrait",
    };
  }
  return {
    paperSize: "A5",
    orientation: "landscape",
    // Fill the 148 mm content box — pin footer to the bottom. Compact gap was
    // for tall A4 pages; on the half-sheet it left blank space under the receipt.
    compactFooterGap: false,
    // A4 portrait @page + 210×148 content. Do not emit 210×148 or named
    // "A5 landscape" — those landscape page boxes rotate the Epson job and
    // leave blank bands on the right and below. Cut the A4 sheet after print.
    pageCssSize: "210mm 297mm",
  };
}

/**
 * Bill Detail reprint used to expose an A4/A5 toggle. Paper is now
 * Cursor-default only — manual / admin-lock overrides are ignored.
 */
export function applyManualBillPaperOverride(
  _settings: Pick<BillPrintSettings, "defaultPaperSize" | "adminLock">,
  _manualPaper: "A4" | "A5" | null | undefined,
): Pick<BillPrintSettings, "defaultPaperSize"> {
  return { defaultPaperSize: CURSOR_BILL_PRINT_LAYOUT.defaultPaperSize };
}

// ── Adaptive density class based on test count ──
export function getAdaptiveDensityClass(testCount: number): "premium-sparse-mode" | "normal-mode" | "compact-mode" {
  if (testCount <= 2) return "premium-sparse-mode";
  if (testCount <= 6) return "normal-mode";
  return "compact-mode";
}
