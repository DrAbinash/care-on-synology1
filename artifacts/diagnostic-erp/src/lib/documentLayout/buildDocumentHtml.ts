/**
 * Wraps document body content in a complete, self-contained HTML document
 * using the shared page layout rules (@page margin 0, exact mm page box,
 * internal safe padding). Templates supply only inner HTML and optional
 * format-specific CSS — never @page rules or page dimensions.
 */

import {
  type PrintPaper,
  resolvePageLayout,
  type ResolvedPageLayout,
} from "./pageSpec";

export type DocumentPage = {
  /** Inner HTML for one physical page (placed inside `.care-doc-page`). */
  html: string;
  /** Extra class names for this page section. */
  className?: string;
  /** Inline style additions for this page section. */
  style?: string;
};

export type BuildDocumentHtmlOpts = {
  title: string;
  paper: PrintPaper;
  /** Maps to internal safe padding (not @page margin). */
  safePaddingMm?: number | null;
  pages: DocumentPage[];
  bodyFontFamily?: string;
  bodyFontSize?: string;
  bodyColor?: string;
  /** Format-specific CSS (typography, colors, tables). No @page or .care-doc-page sizing. */
  extraStyles?: string;
  /**
   * Patient booking slip: A4 physical page with a centred 148 mm-wide content
   * column. Used only by `compactOnA4` bill paths (e.g. clinic-site book.tsx).
   */
  compactSlipOnA4?: boolean;
};

/** Shared base CSS — single implementation, used by every document type. */
export function buildDocumentBaseCss(layout: ResolvedPageLayout, compactSlipOnA4: boolean): string {
  const { widthMm, heightMm, pageSizeCss, safePaddingMm } = layout;
  const slipRule = compactSlipOnA4
    ? `
  .care-doc-page--slip {
    width: 148mm;
    min-height: auto;
    height: auto;
    margin-left: auto;
    margin-right: auto;
    padding-top: ${safePaddingMm}mm;
    padding-right: ${safePaddingMm}mm;
    padding-bottom: ${safePaddingMm}mm;
    padding-left: ${safePaddingMm}mm;
  }`
    : "";

  return `
  @page { size: ${pageSizeCss}; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: ${widthMm}mm;
    max-width: ${widthMm}mm;
    background: #fff;
    overflow: hidden;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    color: #000;
  }
  .care-doc-page {
    width: ${widthMm}mm;
    max-width: ${widthMm}mm;
    height: ${heightMm}mm;
    /* Explicit equal L/R padding — avoids asymmetric “more gap on the right”
       from scrollbars or shorthand padding quirks in print/preview. */
    padding-top: ${safePaddingMm}mm;
    padding-right: ${safePaddingMm}mm;
    padding-bottom: ${safePaddingMm}mm;
    padding-left: ${safePaddingMm}mm;
    margin: 0;
    box-sizing: border-box;
    overflow: hidden;
    position: relative;
    page-break-after: always;
    break-after: page;
  }
  .care-doc-page > table,
  .care-doc-page > div {
    max-width: 100%;
  }
  .care-doc-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  ${slipRule}
  @media print {
    html, body { width: ${widthMm}mm; }
    .care-doc-page {
      width: ${widthMm}mm !important;
      height: ${heightMm}mm !important;
      overflow: hidden;
    }
  }`;
}

function renderPages(pages: DocumentPage[], compactSlipOnA4: boolean): string {
  return pages
    .map((p, i) => {
      const breakBefore = i > 0 ? "page-break-before:always;break-before:page;" : "";
      const slipClass = compactSlipOnA4 ? " care-doc-page--slip" : "";
      const cls = `care-doc-page${slipClass}${p.className ? ` ${p.className}` : ""}`;
      return `<section class="${cls}" style="${breakBefore}${p.style ?? ""}">${p.html}</section>`;
    })
    .join("");
}

/** Build a complete printable HTML document. */
export function buildDocumentHtml(opts: BuildDocumentHtmlOpts): string {
  const layout = resolvePageLayout(opts.paper, opts.safePaddingMm);
  const compactSlipOnA4 = Boolean(opts.compactSlipOnA4);
  const baseCss = buildDocumentBaseCss(layout, compactSlipOnA4);
  const fontFamily = opts.bodyFontFamily ?? "Arial, Helvetica, sans-serif";
  const fontSize = opts.bodyFontSize ?? "12px";
  const color = opts.bodyColor ?? "#000";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${opts.title}</title>
<style>
${baseCss}
body {
  font-family: ${fontFamily};
  font-size: ${fontSize};
  color: ${color};
}
${opts.extraStyles ?? ""}
</style></head><body>${renderPages(opts.pages, compactSlipOnA4)}</body></html>`;
}

/** Exposed for tests — verify generated CSS without building full HTML. */
export function documentLayoutCssForPaper(
  paper: PrintPaper,
  safePaddingMm?: number | null,
  compactSlipOnA4 = false,
): string {
  const layout = resolvePageLayout(paper, safePaddingMm);
  return buildDocumentBaseCss(layout, compactSlipOnA4);
}
