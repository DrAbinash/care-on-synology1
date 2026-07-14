// Bill Print Settings — types, defaults, and localStorage persistence
//
// Global settings are stored in clinicSettings DB (server-side).
// User-wise overrides are stored in localStorage per user ID.
// When adminLock is ON, user overrides are ignored.

export type BillFormat = "classic" | "premium-a5" | "designer-a" | "designer-b" | "designer-c";
export const BILL_FORMATS: { id: BillFormat; label: string }[] = [
  { id: "classic",     label: "Classic Format (Existing)" },
  { id: "premium-a5", label: "Premium Format V1 (Existing)" },
  { id: "designer-a", label: "Designer Layout A — Minimal Premium" },
  { id: "designer-b", label: "Designer Layout B — Modern Diagnostic" },
  { id: "designer-c", label: "Designer Layout C — Corporate Healthcare" },
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
  classicEnabled: true,
  premiumA5Enabled: true,
  designerAEnabled: true,
  designerBEnabled: true,
  designerCEnabled: true,
  autoA4Threshold: 5,
  defaultPaperSize: "A5-portrait",
  defaultCopyType: "patient",
  showQrCode: true,
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

export function loadBillPrintSettings(global: Partial<BillPrintSettings> = {}): BillPrintSettings {
  const userId = getUserId();
  const role = getUserRole();
  const defaults = mergeDefaults(GLOBAL_BILL_PRINT_DEFAULTS, role);
  const merged = { ...defaults, ...global };
  const key = userId ? LS_KEY(userId) : "diagnosticErp:billPrintSettings";
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return merged;
    const parsed = JSON.parse(raw);
    // If adminLock is on globally, ignore local overrides
    if (global.adminLock) return merged;
    return { ...merged, ...parsed };
  } catch {
    return merged;
  }
}

export function saveBillPrintSettings(settings: Partial<BillPrintSettings>): void {
  const userId = getUserId();
  const key = userId ? LS_KEY(userId) : "diagnosticErp:billPrintSettings";
  try {
    const existing = loadBillPrintSettings();
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

// ── Helper to get current effective format ──
export function getEffectiveFormat(global: Partial<BillPrintSettings>, userOverride: Partial<BillPrintSettings> = {}): BillFormat {
  const merged = loadBillPrintSettings(global);
  const eff = { ...merged, ...userOverride };
  if (eff.defaultFormat === "premium-a5" && eff.premiumA5Enabled) return "premium-a5";
  if (eff.defaultFormat === "classic" && eff.classicEnabled) return "classic";
  if (eff.premiumA5Enabled) return "premium-a5";
  if (eff.classicEnabled) return "classic";
  return "classic";
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
      return { pageSize: "A5 landscape", width: "198mm", minHeight: "136mm", maxHeight: "136mm" };
    case "A5-portrait":
      return { pageSize: "A5 portrait", width: "136mm", minHeight: "198mm", maxHeight: "198mm" };
    case "half-a4":
      return { pageSize: "148mm 210mm", width: "148mm", minHeight: "198mm", maxHeight: "198mm" };
    case "A4":
    default:
      return { pageSize: "A4 portrait", width: "210mm", minHeight: "277mm", maxHeight: "none" };
  }
}

// ── Adaptive density class based on test count ──
export function getAdaptiveDensityClass(testCount: number): "premium-sparse-mode" | "normal-mode" | "compact-mode" {
  if (testCount <= 2) return "premium-sparse-mode";
  if (testCount <= 6) return "normal-mode";
  return "compact-mode";
}
