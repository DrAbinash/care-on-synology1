/**
 * radiologyReportPdfExport.ts — export the in-app radiology draft to a real
 * PDF via generateReportPDF() (reportPdfGenerator.ts — genuine jsPDF output,
 * already used in production by USG/Echo/Fetal reporting), including the
 * DICOM images already selected in the Report Images panel.
 *
 * That image-selection UI (ReportImagePicker / ReportImagePanel /
 * reportImageRefs.ts — Tickets R1.1-R1.3) is real and persists selections to
 * the server. When this file was written, buildPreviewHtml's own
 * `imageRefs` param was fed from a dead `useState([])` in
 * RadiologyReportingWorkspace.tsx with no setter, so the selected images
 * never reached Preview, the legacy finalize HTML, or the Word export — this
 * was the first export path that actually fetched and embedded them. That
 * dead state has since been fixed (RadiologyReportingWorkspace.tsx now feeds
 * all three from the same query this file uses), so all four surfaces show
 * the same selected images today.
 */

import { thumbnailRenderedUrl, type ReportImageRef } from "./reportImageRefs";
import { generateReportPDF, loadPrintSettings, type PrintClinic } from "./reportPdfGenerator";
import type { CareLetterpadChrome } from "./careLetterpadChrome";
import { dicomWebFetch } from "./browserDicomWeb";

function fmtHeading(text: string, headingCase: "all_caps" | "title_case"): string {
  if (headingCase === "all_caps") return text.toUpperCase();
  return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Plain-text equivalent of buildPreviewHtml's findings rendering (structured
 * normal-scaffold vs. freeform), for a PDF body that has no HTML layer.
 */
export function buildFindingsText(opts: {
  useStructured: boolean;
  findingsMap: Record<string, { normal: boolean; text: string }>;
  rawFindings: string;
  headingCase?: "all_caps" | "title_case";
}): string {
  if (!opts.useStructured) return opts.rawFindings.trim();
  const hc = opts.headingCase ?? "all_caps";
  return Object.entries(opts.findingsMap)
    .map(([label, item]) => {
      const raw = item.text.trim().replace(/\s+/g, " ");
      const sentence = raw || (item.normal ? "Normal." : "—");
      // Blank line between anatomical sections — letter-pad readability
      return `${fmtHeading(label, hc)}: ${sentence}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image data"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Best-effort fetch of up to `limit` selected images as base64 data URLs for
 * jsPDF's keyImages, in the radiologist's chosen display order. Reuses the
 * SAME browser DICOMweb base + rendered-image endpoint the embedded viewer
 * and image picker already use (M1.2 launch contract) — no new PACS access
 * path. A single broken/unreachable image is skipped, not fatal.
 */
export async function fetchKeyImageDataUrls(
  dicomWebBase: string | null,
  refs: ReportImageRef[],
  opts: { limit?: number; size?: number; fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  if (!dicomWebBase || refs.length === 0) return [];
  const limit = opts.limit ?? 12;
  const size = opts.size ?? 600;
  const fetchImpl = opts.fetchImpl ?? dicomWebFetch;
  const ordered = [...refs].sort((a, b) => a.displayOrder - b.displayOrder).slice(0, limit);
  const dataUrls = await Promise.all(
    ordered.map(async (ref) => {
      const url = thumbnailRenderedUrl(dicomWebBase, ref, size);
      if (!url) return null;
      try {
        const res = await fetchImpl(url);
        if (!res.ok) return null;
        return await blobToDataUrl(await res.blob());
      } catch {
        return null;
      }
    }),
  );
  return dataUrls.filter((v): v is string => Boolean(v));
}

/** Build a CARE letter-pad key-images rail matching reportPresentation markup. */
export function buildKeyImagesRailHtml(dataUrls: string[]): string {
  const cells = dataUrls.map((src, i) => (
    `<div class="image-cell"><div class="image-viewport"><div class="image-framed" style="--img-zoom:1;--img-ox:0%;--img-oy:0%;--img-fit:contain;"><img src="${src}" class="dicom-img" alt="Key image ${i + 1}"/></div></div></div>`
  )).join("");
  return `<div class="image-panel image-panel-side image-panel-keyrail" data-image-count="${dataUrls.length}"><div class="image-panel-heading">KEY IMAGES</div><div class="image-grid">${cells}</div></div>`;
}

/** Count dicom-img tags that already carry a usable inlined data URL. */
export function countInlinedDicomImages(html: string): number {
  const srcFirst = html.match(/class="dicom-img"[^>]*src="(data:image[^"]*)"/g) || [];
  const classSecond = html.match(/src="(data:image[^"]*)"[^>]*class="dicom-img"/g) || [];
  const urls = [...srcFirst, ...classSecond]
    .map((tag) => {
      const m = tag.match(/src="(data:image[^"]*)"/);
      return m?.[1] ?? "";
    })
    // Tiny / empty payloads are black squares in print — treat as not inlined.
    .filter((src) => src.length > 64);
  return urls.length;
}

/**
 * Replace the first side-panel key-images block with `rail`, using a depth
 * walk so nested </div>s inside image cells do not truncate the match
 * (the previous non-greedy regex stopped at the KEY IMAGES heading close).
 */
export function replaceSideImagePanel(html: string, rail: string): string | null {
  const start = html.search(/<div\b[^>]*\bimage-panel-side\b[^>]*>/);
  if (start < 0) return null;
  let i = start;
  let depth = 0;
  const openRe = /<div\b[^>]*>/gi;
  const closeRe = /<\/div>/gi;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return null;
    if (open && open.index < close.index) {
      depth += 1;
      i = open.index + open[0].length;
      continue;
    }
    depth -= 1;
    i = close.index + close[0].length;
    if (depth === 0) {
      return html.slice(0, start) + rail + html.slice(i);
    }
  }
  return null;
}

/**
 * When the server print-preview HTML has no usable inlined DICOM pixels
 * (Orthanc unreachable, empty placeholders, or black stub thumbs) but the
 * browser can reach DICOMweb, fetch thumbnails client-side and inject / replace
 * the key-images rail so Print Preview / Print like final match Selected images.
 */
export async function hydratePrintPreviewKeyImages(
  html: string,
  dicomWebBase: string | null,
  refs: ReportImageRef[],
  opts?: { limit?: number; size?: number; fetchImpl?: typeof fetch; force?: boolean },
): Promise<string> {
  if (!html || !dicomWebBase || refs.length === 0) return html;
  const alreadyInlined = countInlinedDicomImages(html);
  // Re-hydrate when the rail is missing pixels, or when fewer inlined images
  // than selected refs (server budget/skip left black empty cells).
  if (!opts?.force && alreadyInlined > 0 && alreadyInlined >= Math.min(refs.length, opts?.limit ?? 6)) {
    return html;
  }

  const urls = await fetchKeyImageDataUrls(dicomWebBase, refs, {
    limit: opts?.limit ?? 6,
    size: opts?.size ?? 800,
    fetchImpl: opts?.fetchImpl,
  });
  if (urls.length === 0) return html;
  const rail = buildKeyImagesRailHtml(urls);

  if (/image-panel-side/.test(html)) {
    const replaced = replaceSideImagePanel(html, rail);
    if (replaced) return replaced;
  }

  let out = html.includes("has-side-images")
    ? html
    : html.replace(/class="content-area([^"]*)"/, 'class="content-area has-side-images$1"');

  if (/<\/div>\s*<\/div>\s*(?:<div class="sigs"|<\/td>)/.test(out) && out.includes("report-column")) {
    const withRail = out.replace(
      /(<\/div>)(\s*)(<\/div>\s*(?:<div class="sigs"|<\/td>))/ ,
      `$1$2${rail}$3`,
    );
    // Only accept if we actually inserted the rail once near content-area.
    if (withRail.includes("image-panel-keyrail") || withRail.includes('data-image-count=')) {
      return withRail;
    }
  }

  if (out.includes('<div class="sigs"')) {
    return out.replace('<div class="sigs"', `${rail}<div class="sigs"`);
  }
  return `${out}${rail}`;
}

export interface RadiologyPdfExportInput {
  patientName: string;
  age: string;
  sex: string;
  accessionNumber: string;
  studyDate: string;
  referringDoctor: string;
  modality: string;
  bodyPart: string;
  clinicalHistory: string;
  technique: string;
  useStructured: boolean;
  findingsMap: Record<string, { normal: boolean; text: string }>;
  rawFindings: string;
  impression: string[];
  recommendation: string;
  studyName: string;
  headingCase?: "all_caps" | "title_case";
  dicomWebBase: string | null;
  imageRefs: ReportImageRef[];
  clinic: PrintClinic;
  letterhead?: CareLetterpadChrome;
  /** When false, the CARE letterpad header (logo + address) is omitted — for pre-printed letterheads. */
  showLetterpadHeader?: boolean;
}

export async function exportRadiologyReportToPdf(input: RadiologyPdfExportInput): Promise<void> {
  const keyImages = await fetchKeyImageDataUrls(input.dicomWebBase, input.imageRefs);
  const settings = loadPrintSettings();
  generateReportPDF(
    {
      patientName: input.patientName,
      age: input.age,
      sex: input.sex,
      accessionNumber: input.accessionNumber,
      studyDate: input.studyDate,
      referringDoctor: input.referringDoctor,
      modality: input.modality,
      bodyPart: input.bodyPart,
      clinicalHistory: input.clinicalHistory,
      technique: input.technique,
      findings: buildFindingsText({
        useStructured: input.useStructured,
        findingsMap: input.findingsMap,
        rawFindings: input.rawFindings,
        headingCase: input.headingCase,
      }),
      impression: input.impression.filter(Boolean).join("\n"),
      recommendation: input.recommendation || "Please correlate with clinical findings.",
      keyImages,
      reportTitle: input.studyName || "Radiology Report",
    },
    {
      ...settings,
      header: {
        ...settings.header,
        enabled: input.showLetterpadHeader !== false, // respect toggle; default true
      },
      footer: {
        ...settings.footer,
        // Pre-printed letterheads also have the services bar + disclaimer pre-printed.
        enabled: input.showLetterpadHeader !== false ? settings.footer.enabled : false,
      },
      show: {
        ...settings.show,
        keyImages: keyImages.length > 0 || settings.show.keyImages,
      },
    },
    input.clinic,
    { letterhead: input.letterhead },
  );
}
