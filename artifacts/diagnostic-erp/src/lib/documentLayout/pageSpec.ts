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
 * Half of A4 is A5: 210 mm × 148 mm (A5 landscape).
 *
 * `@page` uses the ISO named size (`A5 landscape` / `A5 portrait`) so Chrome's
 * print dialog selects A5 instead of falling back to A4 landscape. Exact mm
 * sizes (210mm 148mm) look like A4-width to many Epson/Chrome combinations and
 * both CARE Invoice and HOPE receipts then print on A4 landscape.
 *
 * Content boxes still use exact millimetres (widthMm / heightMm).
 * Printer dialog: Paper = A5, Scale = 100%, Margins = None.
 */
export const HALF_A4_TRAY_PAGE_CSS = "A5 landscape";

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
    pageSizeCss: "A5 portrait",
    // HOPE legacy used @page margin ~5mm 10mm; equal internal padding ≈ 8mm.
    defaultSafePaddingMm: 8,
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
    pageSizeCss: "A4 portrait",
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
