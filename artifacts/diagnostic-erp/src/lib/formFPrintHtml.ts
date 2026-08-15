/**
 * Printable Form F (PCPNDT) HTML — uses shared document layout @page rules so
 * Epson L130 / Chrome print the statutory A4 sheet at full width (210 mm),
 * not a scaled-down browser viewport.
 */

import { documentLayoutCssForPaper } from "./documentLayout/buildDocumentHtml";

/** Wrap live `#formf-print` markup in a self-contained print document. */
export function buildFormFPrintHtml(formPrintRootHtml: string): string {
  const pageCss = documentLayoutCssForPaper("A4", 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Form F — PCPNDT</title>
<style>
${pageCss}
#formf-print {
  width: 210mm;
  max-width: 210mm;
  min-height: 297mm;
  margin: 0;
  box-sizing: border-box;
}
#formf-print img {
  max-width: 100%;
}
</style></head><body>${formPrintRootHtml}</body></html>`;
}
