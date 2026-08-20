/**
 * Maps bill-print settings to the shared document layout engine paper modes.
 */

import type { BillPaperSize, BillPrintPageOpts } from "../billPrintSettings";
import type { PrintPaper } from "./pageSpec";

export function billPaperSizeToPrintPaper(size: BillPaperSize): PrintPaper {
  switch (size) {
    case "A5-landscape":
      return "A5-landscape";
    case "A5-portrait":
      return "A5-portrait";
    case "half-a4":
      return "half-a4";
    case "A4":
    default:
      return "A4";
  }
}

/**
 * Derive the layout-engine paper mode from resolved bill page options and the
 * clinic's effective paper-size setting.
 */
export function resolveBillPrintPaper(
  pageOpts: BillPrintPageOpts,
  effectivePaperSize: BillPaperSize,
): PrintPaper {
  if (pageOpts.paperSize === "A4") return "A4";
  return billPaperSizeToPrintPaper(effectivePaperSize);
}

/** Infer paper from legacy BuildPrintHtmlOpts fields (Kiosk, compact paths). */
export function resolveBillPrintPaperFromOpts(opts: {
  paperSize: "A4" | "A5";
  orientation?: "portrait" | "landscape";
  pageCssSize?: string;
  compactOnA4?: boolean;
}): PrintPaper {
  if (opts.compactOnA4 && opts.paperSize === "A5") return "A4";
  if (opts.paperSize === "A4") return "A4";
  // Landscape content = 210×148 mm half-sheet (A5 / half A4). @page is A4
  // portrait (210×297) so the Epson tray does not rotate — detect via
  // orientation / legacy page sizes, not the A4 @page string itself.
  if (
    opts.orientation === "landscape" ||
    opts.pageCssSize?.includes("210mm 148mm") ||
    opts.pageCssSize === "A5 landscape"
  ) {
    return "A5-landscape";
  }
  return "A5-portrait";
}
