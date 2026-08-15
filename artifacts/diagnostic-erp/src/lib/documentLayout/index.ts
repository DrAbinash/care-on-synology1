/**
 * CARE ERP Document Layout Engine
 *
 * Reusable page layout and print delivery for bills, reports, certificates,
 * and other printable documents. Templates supply content and visual styling;
 * this module owns all physical page dimensions and browser print delivery.
 */

export {
  type PrintPaper,
  type PageSpec,
  type ResolvedPageLayout,
  PAGE_SPECS,
  HALF_A4_TRAY_PAGE_CSS,
  resolvePageLayout,
  contentBoxMm,
} from "./pageSpec";

export {
  type DocumentPage,
  type BuildDocumentHtmlOpts,
  buildDocumentHtml,
  buildDocumentBaseCss,
  documentLayoutCssForPaper,
} from "./buildDocumentHtml";

export {
  printViaIframe,
  openBlankPrintWindow,
  writeAndPrint,
} from "./printDelivery";

export {
  billPaperSizeToPrintPaper,
  resolveBillPrintPaper,
  resolveBillPrintPaperFromOpts,
} from "./billPaper";
