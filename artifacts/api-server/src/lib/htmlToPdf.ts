/**
 * htmlToPdf.ts — render already-built report HTML into a real PDF via a
 * headless Chromium (Playwright — already a runtime dependency, and this is
 * the same launch/page.pdf() pattern already used in production by
 * pacsArchive.ts for PACS-archived report PDFs).
 *
 * `preferCSSPageSize: true` lets the report template's own `@page`/`@media
 * print` CSS (reportPresentation.ts) drive page size and margins, exactly as
 * a browser would when printing the same HTML via the existing /print route
 * — no separate page-size config to keep in sync here.
 */

import { chromium } from "playwright";

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
