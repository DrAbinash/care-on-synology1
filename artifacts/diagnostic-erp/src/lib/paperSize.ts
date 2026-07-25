/**
 * Shared localStorage-backed paper-size / orientation preference helpers.
 *
 * Generic layer used by:
 *  - billPrintLayout.ts  (A4 / A5 bill receipt size)
 */

export type PaperOrientation = "portrait" | "landscape";

const PAPER_ORIENTATIONS = ["portrait", "landscape"] as const;

// ─── Generic helpers ──────────────────────────────────────────────────────────

/**
 * Read a paper-size preference from localStorage.
 * Returns `defaultValue` when the key is absent, the value is unrecognised,
 * or localStorage is unavailable (SSR / sandboxed iframe).
 */
export function loadPaperSize<T extends string>(
  key: string,
  validValues: readonly T[],
  defaultValue: T,
): T {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (raw !== null && (validValues as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // SSR / iframe sandbox — ignore
  }
  return defaultValue;
}

/**
 * Persist a paper-size preference to localStorage.
 * Silently ignores quota errors and sandboxed environments.
 */
export function persistPaperSize<T extends string>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore quota errors
  }
}

// ─── Report orientation (jsPDF commission / referral reports) ─────────────────

const REPORT_ORIENTATION_KEY = "diagnosticErp:reportOrientation";

/** Load the saved report PDF orientation preference (defaults to portrait). */
export function loadReportOrientation(): PaperOrientation {
  return loadPaperSize(REPORT_ORIENTATION_KEY, PAPER_ORIENTATIONS, "portrait");
}

/** Persist the report PDF orientation preference. */
export function persistReportOrientation(orientation: PaperOrientation): void {
  persistPaperSize(REPORT_ORIENTATION_KEY, orientation);
}

// ─── Summary / Dashboard PDF orientation ─────────────────────────────────────

const SUMMARY_PDF_ORIENTATION_KEY = "diagnosticErp:summaryPdfOrientation";

/**
 * Load the saved summary/dashboard PDF orientation preference.
 * Defaults to "landscape" (matching the historical hardcoded value in SummaryExport.tsx).
 */
export function loadSummaryPdfOrientation(): PaperOrientation {
  return loadPaperSize(SUMMARY_PDF_ORIENTATION_KEY, PAPER_ORIENTATIONS, "landscape");
}

/** Persist the summary/dashboard PDF orientation preference. */
export function persistSummaryPdfOrientation(orientation: PaperOrientation): void {
  persistPaperSize(SUMMARY_PDF_ORIENTATION_KEY, orientation);
}

// ─── DICOM Q/R orientation ────────────────────────────────────────────────────

export function getDicomQrPaperSizeKey(userId?: number): string {
  return `dicom_qr_paper_size_${userId ?? "anon"}`;
}

/** Load the saved DICOM Q/R PDF orientation preference (defaults to landscape). */
export function loadDicomQrPaperSize(userId?: number): PaperOrientation {
  return loadPaperSize(getDicomQrPaperSizeKey(userId), PAPER_ORIENTATIONS, "landscape");
}

/** Persist the DICOM Q/R PDF orientation preference. */
export function persistDicomQrPaperSize(orientation: PaperOrientation, userId?: number): void {
  persistPaperSize(getDicomQrPaperSizeKey(userId), orientation);
}
