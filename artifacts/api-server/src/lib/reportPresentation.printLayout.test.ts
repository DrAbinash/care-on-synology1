/**
 * Chromium print proof for the Premium two-column rail.
 * HTML-only layout contracts live in reportPresentation.test.ts; this file
 * launches the same Playwright path htmlToPdf.ts uses and checks that four
 * key images sit on the RIGHT of page 1 instead of a blank-left page 2.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { chromium } from "playwright";
import {
  renderReportDocument,
  resolvePresentationTemplate,
  type ReportDocumentModel,
  type ReportKeyImageModel,
} from "./reportPresentation";

const ARTIFACT_DIR = "/opt/cursor/artifacts";

function pdfPageCount(buf: Buffer): number {
  const text = buf.toString("latin1");
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,120}\/Count\s+(\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
  return counts.length ? Math.max(...counts) : 0;
}

async function mriLikeJpeg(): Promise<string> {
  const svg = `<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
    <rect width="256" height="256" fill="#050505"/>
    <ellipse cx="128" cy="132" rx="68" ry="78" fill="#b7b7b7"/>
    <ellipse cx="128" cy="120" rx="28" ry="22" fill="#d8d8d8"/>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

function modelWithImages(images: ReportKeyImageModel[], bodyHtml: string): ReportDocumentModel {
  return {
    reportNumber: "RPT-PRAHLAD-001",
    studyTitle: "MRI BRAIN (PLAIN)",
    typeLabel: "RADIOLOGY",
    statusLabel: "VERIFIED",
    clinic: { name: "CARE DIAGNOSTICS", address: "Deoghar", phone: "75490 99099", email: "care.deoghar@gmail.com" },
    patientRows: [
      { label: "Patient", value: "PRAHLAD KUMAR YADAV" },
      { label: "Age / Sex", value: "45y / M" },
      { label: "Accession No.", value: "ACC-MRI-1" },
      { label: "Referring Doctor", value: "Dr. Test" },
    ],
    impression: "No acute intracranial haemorrhage. No mass effect.",
    bodyHtml,
    keyImages: images,
    stamp: { kind: "verified", label: "VERIFIED" },
    signatures: [{ name: "Dr. Sugandha Priyadarshini", qualification: "MD (Radiodiagnosis)", label: "Signed:" }],
    footerNote: "Not for medico-legal purpose",
    generatedAtLabel: "18/8/2026, 10:00 am",
  };
}

const SHORT_BODY = `<p><strong>CLINICAL HISTORY:</strong> Headache.</p>
<p><strong>TECHNIQUE:</strong> Multiplanar MRI brain.</p>
<p><strong>FINDINGS:</strong> Brain parenchyma is normal. Ventricles are normal. No midline shift.</p>`;

describe("premium print layout (Chromium)", () => {
  it("keeps four framed key images on the right of page 1", async () => {
    const src = await mriLikeJpeg();
    const captions = ["T2W Axial", "FLAIR Coronal", "T1W Sagittal", "DWI Axial"];
    const images: ReportKeyImageModel[] = captions.map((caption, i) => ({
      src,
      caption,
      displayOrder: i,
      framing: { zoom: 1.55, offsetX: 0, offsetY: 0, fitMode: "cover" as const },
    }));
    const html = renderReportDocument(
      modelWithImages(images, SHORT_BODY),
      resolvePresentationTemplate("care-premium"),
    );

    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.setContent(html, { waitUntil: "networkidle" });

      const geo = await page.evaluate(() => {
        const col = document.querySelector(".report-column")?.getBoundingClientRect();
        const rail = document.querySelector(".image-panel-side")?.getBoundingClientRect();
        const cells = [...document.querySelectorAll(".image-panel-side .image-cell")]
          .map((el) => el.getBoundingClientRect());
        return {
          col: col ? { left: col.left, top: col.top, width: col.width, height: col.height } : null,
          rail: rail ? { left: rail.left, top: rail.top, width: rail.width, height: rail.height } : null,
          cellCount: cells.length,
        };
      });

      expect(geo.col).toBeTruthy();
      expect(geo.rail).toBeTruthy();
      expect(geo.cellCount).toBe(4);
      expect(geo.rail!.left).toBeGreaterThan(geo.col!.left + geo.col!.width * 0.5);
      expect(Math.abs(geo.rail!.top - geo.col!.top)).toBeLessThan(24);
      expect(geo.rail!.width / (geo.col!.width + geo.rail!.width)).toBeGreaterThan(0.22);
      expect(geo.rail!.width / (geo.col!.width + geo.rail!.width)).toBeLessThan(0.38);

      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      expect(pdfPageCount(Buffer.from(pdf))).toBe(1);

      mkdirSync(ARTIFACT_DIR, { recursive: true });
      writeFileSync(`${ARTIFACT_DIR}/premium_prahlad_4images.pdf`, pdf);
      await page.screenshot({
        path: `${ARTIFACT_DIR}/premium_prahlad_page1_print.png`,
        fullPage: false,
      });
    } finally {
      await browser.close();
    }
  }, 90_000);

  it("0 images uses full width; 6 images stay a single right rail", async () => {
    const src = await mriLikeJpeg();
    const none = renderReportDocument(
      modelWithImages([], SHORT_BODY),
      resolvePresentationTemplate("care-premium"),
    );
    expect(none).not.toContain("has-side-images");

    const six: ReportKeyImageModel[] = Array.from({ length: 6 }, (_, i) => ({
      src, caption: `IMG ${i + 1}`, displayOrder: i,
      framing: { zoom: 1.4, offsetX: 0, offsetY: 0, fitMode: "cover" as const },
    }));
    const html = renderReportDocument(
      modelWithImages(six, SHORT_BODY),
      resolvePresentationTemplate("care-premium"),
    );
    expect(html).toContain('data-image-count="6"');
    expect(html).not.toContain("KEY IMAGES (continued)");

    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.setContent(html, { waitUntil: "networkidle" });
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      mkdirSync(ARTIFACT_DIR, { recursive: true });
      writeFileSync(`${ARTIFACT_DIR}/premium_6images.pdf`, pdf);
      expect(pdfPageCount(Buffer.from(pdf))).toBeLessThanOrEqual(2);
    } finally {
      await browser.close();
    }
  }, 90_000);
});
