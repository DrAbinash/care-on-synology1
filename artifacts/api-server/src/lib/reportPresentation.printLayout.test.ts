/**
 * Chromium print proof for the Premium two-column rail.
 * HTML-only layout contracts live in reportPresentation.test.ts; this file
 * launches the same Playwright path htmlToPdf.ts uses and checks that four
 * key images sit on the RIGHT of page 1 instead of a blank-left page 2.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { chromium } from "playwright";
import { detectContentBoundingBox, suggestFramingFromBox } from "./imageFraming";
import {
  renderReportDocument,
  resolvePresentationTemplate,
  letterPadErpPdfLockCss,
  type ReportDocumentModel,
  type ReportKeyImageModel,
} from "./reportPresentation";
import { buildLetterheadScaleCss } from "./reportLetterheadScale";

function resolveArtifactDir(): string {
  const preferred = "/opt/cursor/artifacts";
  try {
    mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = join(tmpdir(), "premium-print-layout");
    mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const ARTIFACT_DIR = resolveArtifactDir();

function hasChromium(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

type PrintBox = { left: number; top: number; width: number; height: number };
type PrintGeo = { col: PrintBox | null; rail: PrintBox | null; cellCount: number };

type BrowserDocument = {
  querySelector: (sel: string) => { getBoundingClientRect: () => PrintBox } | null;
  querySelectorAll: (sel: string) => { length: number; item: (i: number) => { getBoundingClientRect: () => PrintBox } | null };
};

function measureSideRail(): PrintGeo {
  const doc = (globalThis as unknown as { document: BrowserDocument }).document;
  const col = doc.querySelector(".report-column")?.getBoundingClientRect();
  const rail = doc.querySelector(".image-panel-side")?.getBoundingClientRect();
  const nodeList = doc.querySelectorAll(".image-panel-side .image-cell");
  const cells: PrintBox[] = [];
  for (let i = 0; i < nodeList.length; i++) {
    const el = nodeList.item(i);
    if (el) cells.push(el.getBoundingClientRect());
  }
  return {
    col: col ? { left: col.left, top: col.top, width: col.width, height: col.height } : null,
    rail: rail ? { left: rail.left, top: rail.top, width: rail.width, height: rail.height } : null,
    cellCount: cells.length,
  };
}

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

const ARHAN_BODY = `<p><strong>CLINICAL HISTORY:</strong> LOC ?Convulsions</p>
<p><strong>TECHNIQUE:</strong> Multiplanar T1-weighted, T2-weighted, FLAIR, DWI with ADC, SWI/T2*, and post-contrast T1-weighted sequences were obtained on Brand New 3 Tesla Machine.</p>
<p><strong>FINDINGS:</strong> A focal, well-circumscribed lesion is identified in the subcortical white matter of the right parietal lobe, measuring approximately 10.9 x 9.9 mm.</p>
<p>• Signal Characteristics: The lesion is T1 hypointense and T2 hyperintense with surrounding gross hyperintensity suggestive of oedema. On FLAIR, the central core is hypointense, consistent with fluid-filled content with surrounding gross hyperintensity.</p>
<p>• Enhancement Pattern: Post-gadolinium sequences demonstrate a distinct, regular peripheral ring enhancement surrounding the non-enhancing core.</p>
<p>• Perilesional Edema: There is associated perilesional vasogenic edema, visualized as T2/FLAIR hyperintensity in the adjacent white matter. No significant mass effect or midline shift is noted.</p>
<p>• Susceptibility (SWI): A focal area of SWI hypointensity (blooming) is present within the lesion. Analysis of the phase imaging reveals reverse phase hyperintensity, diagnostic of diamagnetic material (calcification).</p>
<p>• Diffusion (DWI/ADC): Primarily DWI hypointense with a focal hyperintense internal focus. The ADC map is hyperintense, confirming the absence of restricted diffusion.</p>
<p><strong>IMPRESSION:</strong></p>
<p>1. A focal, well-circumscribed lesion is identified in the subcortical white matter of the right parietal lobe, measuring approximately 10.9 x 9.9 mm. The lesion is T1 hypointense and T2 hyperintense with surrounding gross hyperintensity suggestive of oedema.</p>
<p>2. On FLAIR, the central core is hypointense, consistent with fluid-filled content with surrounding gross hyperintensity.</p>
<p>3. Post-gadolinium sequences demonstrate a distinct, regular peripheral ring enhancement surrounding the non-enhancing core.</p>
<p><strong>RECOMMENDATION:</strong> FOLLOW UP SCAN IF CLINICALLY INDICATED. Clinical correlation advised.</p>`;

describe.skipIf(!hasChromium())("premium print layout (Chromium)", () => {
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

      const geo = await page.evaluate(measureSideRail);

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

  it("frames the PRAHLAD MRI JPEGs in the right rail on a single page", async () => {
    const fs = await import("node:fs");
    const paths = [2, 3, 4, 5].map((n) => `/tmp/prahlad-imgs/img-00${n}.jpg`);
    if (paths.some((p) => !fs.existsSync(p))) return;

    const captions = ["T2W Axial", "FLAIR", "T1W Sagittal", "DWI"];
    const images: ReportKeyImageModel[] = [];
    for (let i = 0; i < paths.length; i++) {
      const buf = fs.readFileSync(paths[i]);
      const { data, info } = await sharp(buf)
        .resize(160, 160, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const box = detectContentBoundingBox(data, info.width, info.height);
      const framing = box
        ? suggestFramingFromBox(box, info.width, info.height)
        : { zoom: 1.7, offsetX: 0, offsetY: 0, fitMode: "cover" as const };
      images.push({
        src: `data:image/jpeg;base64,${buf.toString("base64")}`,
        caption: captions[i],
        displayOrder: i,
        framing,
      });
    }

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
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      expect(pdfPageCount(Buffer.from(pdf))).toBe(1);
      mkdirSync(ARTIFACT_DIR, { recursive: true });
      writeFileSync(`${ARTIFACT_DIR}/premium_prahlad_real_mri_4images.pdf`, pdf);
      await page.screenshot({
        path: `${ARTIFACT_DIR}/premium_prahlad_real_mri_page1.png`,
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

  it("classic + 6 images keeps a right rail on page 1 (Arhan / PREVIEW-19)", async () => {
    const src = await mriLikeJpeg();
    const captions = [
      "T1_FSE_FLAIR_COR_FS", "FLAIR-AXIAL", "T2_AXIAL",
      "EPI_DWI_TRA_B0", "T1_FSE_FLAIR_SAG_FS", "FLAIR-AXIAL",
    ];
    const six: ReportKeyImageModel[] = captions.map((caption, i) => ({
      src, caption, displayOrder: i,
      framing: { zoom: 1.4, offsetX: 0, offsetY: 0, fitMode: "cover" as const },
    }));
    const html = renderReportDocument(
      modelWithImages(six, ARHAN_BODY),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("has-side-images");
    expect(html).toContain("image-panel-side");
    expect(html).not.toMatch(/class="image-panel image-panel-inline/);
    expect(html).not.toContain("SELECTED IMAGES");

    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.setContent(html, { waitUntil: "networkidle" });
      const geo = await page.evaluate(measureSideRail);
      expect(geo.col).toBeTruthy();
      expect(geo.rail).toBeTruthy();
      expect(geo.cellCount).toBe(6);
      expect(geo.rail!.left).toBeGreaterThan(geo.col!.left + geo.col!.width * 0.5);
      expect(Math.abs(geo.rail!.top - geo.col!.top)).toBeLessThan(24);

      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      expect(pdfPageCount(Buffer.from(pdf))).toBeLessThanOrEqual(2);
      mkdirSync(ARTIFACT_DIR, { recursive: true });
      writeFileSync(`${ARTIFACT_DIR}/classic_arhan_6images.pdf`, pdf);
      await page.screenshot({
        path: `${ARTIFACT_DIR}/classic_arhan_page1_print.png`,
        fullPage: false,
      });
    } finally {
      await browser.close();
    }
  }, 90_000);

  it("Premchand-style Classic print has letter-pad header + NAME/AGE demography", async () => {
    const src = await mriLikeJpeg();
    const html = renderReportDocument(
      {
        ...modelWithImages(
          [
            { src, caption: "T2 SAG", displayOrder: 0, framing: { zoom: 1.4, offsetX: 0, offsetY: 0, fitMode: "cover" } },
            { src, caption: "T2 AX", displayOrder: 1, framing: { zoom: 1.4, offsetX: 0, offsetY: 0, fitMode: "cover" } },
          ],
          `<div class="section-heading">Clinical History</div><p>NECK PAIN. CERVICAL RADICULOPATHY.</p>
<div class="section-heading">Technique</div><p>MRI Cervical Spine: T1W and T2W sagittal.</p>
<div class="section-heading">Findings</div><p>Cervical lordosis maintained. Craniovertebral junction normal.</p>
<div class="section-heading">Impression</div><ol><li>Normal MRI Cervical Spine.</li></ol>`,
        ),
        studyTitle: "MRI LS SPINE WITH CERVICAL SPINE",
        clinic: { name: "WRONG", address: "WRONG ADDRESS", phone: "0000000000", email: "care.deoghar@gmail.com" },
        patientRows: [
          { label: "Patient", value: "Premchand Mandal" },
          { label: "Age / Sex", value: "4 YRS / M" },
          { label: "Referring Doctor", value: "Dr. Tushar Jyoti (Ortho), MS" },
          { label: "Study Date", value: "20260818" },
        ],
        stamp: { kind: "pending", label: "" },
        impression: undefined,
        draftWatermark: false,
      },
      resolvePresentationTemplate("care-classic"),
      { customCss: buildLetterheadScaleCss() },
    );
    expect(html).toContain("St. Francis School Road");
    expect(html).toMatch(/DEOGHAR-814 112<br\/>\s*\(JHARKHAND\)/);
    expect(html).toContain("care.deoghar@gmail.com");
    expect(html).toContain("www.caredeoghar.com");
    expect(html).toContain("height: 22mm !important");
    expect(html.indexOf("height: 22mm !important")).toBeGreaterThan(html.indexOf("height: 82px !important"));
    expect(letterPadErpPdfLockCss()).toContain("7.2pt");
    expect(html).toContain("NAME:");
    expect(html).toContain("Premchand Mandal");
    expect(html).toContain("18/08/2026");
    expect(html).not.toContain("WRONG ADDRESS");
    expect(html).toContain("letterpad-sheet");
    expect(html).not.toContain("PREVIEW (unsigned)");

    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.setContent(html, { waitUntil: "networkidle" });
      mkdirSync(ARTIFACT_DIR, { recursive: true });
      await page.screenshot({
        path: `${ARTIFACT_DIR}/premchand_letterpad_print_page1.png`,
        fullPage: false,
      });
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      writeFileSync(`${ARTIFACT_DIR}/premchand_letterpad_print.pdf`, pdf);
    } finally {
      await browser.close();
    }
  }, 90_000);
});
