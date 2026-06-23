/**
 * Paper-size / orientation preference helpers for the Super Admin Portal.
 *
 * Uses the same localStorage key as the diagnostic-erp so the orientation
 * choice is shared across both surfaces.
 */

export type PaperOrientation = "portrait" | "landscape";

const PAPER_ORIENTATIONS = ["portrait", "landscape"] as const;

function loadPaperSize<T extends string>(
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

function persistPaperSize<T extends string>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore quota errors
  }
}

const REPORT_ORIENTATION_KEY = "diagnosticErp:reportOrientation";

export function loadReportOrientation(): PaperOrientation {
  return loadPaperSize(REPORT_ORIENTATION_KEY, PAPER_ORIENTATIONS, "portrait");
}

export function persistReportOrientation(orientation: PaperOrientation): void {
  persistPaperSize(REPORT_ORIENTATION_KEY, orientation);
}
