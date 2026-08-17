/**
 * CARE ERP Document Layout Engine — single source of truth for physical page
 * dimensions. Every printable document (bills, reports, certificates, etc.)
 * must resolve paper size through this module. No renderer may duplicate
 * @page width/height or margin calculations.
 */

/** Physical paper modes supported by the layout engine. */
export type PrintPaper = "A5-landscape" | "A5-portrait" | "half-a4" | "A4";

export type PageSpec = {
  paper: PrintPaper;
  /** Physical page width in millimetres. */
  widthMm: number;
  /** Physical page height in millimetres. */
  heightMm: number;
  /** Exact CSS value for `@page { size: … }`. */
  pageSizeCss: string;
  /** Default internal safe padding when the caller does not override. */
  defaultSafePaddingMm: number;
};

/**
 * Half of A4 is A5: 210 mm × 148 mm. Load cut half-A4 or A5 in the tray in
 * portrait (210 mm across). @page must match the physical sheet (210×148) so
 * the job does not reserve a full A4 (297 mm) band below the receipt.
 * Named `A5 landscape` or choosing Landscape in the print dialog still
 * rotates the job and leaves a blank strip on the right — avoid those.
 */
export const HALF_A4_TRAY_PAGE_CSS = "210mm 148mm";

/** Canonical page specifications — exact physical dimensions in mm. */
export const PAGE_SPECS: Record<PrintPaper, PageSpec> = {
  "A5-landscape": {
    paper: "A5-landscape",
    widthMm: 210,
    heightMm: 148,
    pageSizeCss: HALF_A4_TRAY_PAGE_CSS,
    // Keep clear of typical ~3mm unprintable bands while using the half-sheet width.
    defaultSafePaddingMm: 4,
  },
  "A5-portrait": {
    paper: "A5-portrait",
    widthMm: 148,
    heightMm: 210,
    pageSizeCss: "148mm 210mm",
    defaultSafePaddingMm: 6,
  },
  "half-a4": {
    paper: "half-a4",
    widthMm: 210,
    heightMm: 148,
    pageSizeCss: HALF_A4_TRAY_PAGE_CSS,
    defaultSafePaddingMm: 4,
  },
  A4: {
    paper: "A4",
    widthMm: 210,
    heightMm: 297,
    pageSizeCss: "210mm 297mm",
    defaultSafePaddingMm: 4,
  },
};

export type ResolvedPageLayout = PageSpec & {
  /** Effective internal safe padding in mm (admin override or default). */
  safePaddingMm: number;
};

/**
 * Resolve a paper mode to its layout spec with optional safe-padding override.
 * `printMarginMm` from bill settings maps to safe padding (not @page margin).
 */
export function resolvePageLayout(
  paper: PrintPaper,
  safePaddingMmOverride?: number | null,
): ResolvedPageLayout {
  const spec = PAGE_SPECS[paper];
  const safePaddingMm =
    safePaddingMmOverride != null && safePaddingMmOverride >= 0
      ? safePaddingMmOverride
      : spec.defaultSafePaddingMm;
  return { ...spec, safePaddingMm };
}

/** Content-area width/height inside safe padding (for templates that need it). */
export function contentBoxMm(layout: ResolvedPageLayout): {
  widthMm: number;
  heightMm: number;
} {
  const pad = layout.safePaddingMm * 2;
  return {
    widthMm: layout.widthMm - pad,
    heightMm: layout.heightMm - pad,
  };
}
