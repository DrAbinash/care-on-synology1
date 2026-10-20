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
import { reportedScopeNote, type ReportedScopeRecord } from "@workspace/report-quality";
import { generateReportPDF, loadPrintSettings, type PrintClinic, type ReportKeyImage, type ReportSignerOfRecord } from "./reportPdfGenerator";
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
      // Heading on its own line — the convention findingsDocument.ts reads, so
      // the PDF draws it as a section heading like the print surface does.
      return `${fmtHeading(label, hc)}:\n${sentence}`;
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
 * Fetch the selected images as base64 data URLs for jsPDF's key-image rail, in the
 * radiologist's chosen display order. Reuses the SAME browser DICOMweb base +
 * rendered-image endpoint the embedded viewer and image picker already use (M1.2
 * launch contract) — no new PACS access path.
 *
 * Every reference comes back, whether its pixels did or not: a reference whose
 * render failed is returned with an empty `src` and its own identity, which is
 * what lets the PDF draw a placeholder and name the attachment instead of quietly
 * exporting a shorter study. `limit` remains for callers that genuinely want one;
 * there is no default, because a selected image is evidence.
 *
 * Each result keeps the label its stored reference carries, so a reference the
 * radiologist named prints with that name and one they left alone prints bare.
 */
export async function fetchKeyImageDataUrls(
  dicomWebBase: string | null,
  refs: ReportImageRef[],
  opts: { limit?: number; size?: number; fetchImpl?: typeof fetch } = {},
): Promise<ReportKeyImage[]> {
  if (!dicomWebBase || refs.length === 0) return [];
  const limit = opts.limit ?? Infinity;
  const size = opts.size ?? 600;
  const fetchImpl = opts.fetchImpl ?? dicomWebFetch;
  const ordered = [...refs].sort((a, b) => a.displayOrder - b.displayOrder).slice(0, limit);
  return Promise.all(
    ordered.map(async (ref): Promise<ReportKeyImage> => {
      const identity = {
        caption: ref.description.trim(),
        attachmentId: ref.id,
        sopInstanceUid: ref.sopInstanceUid,
      };
      const url = thumbnailRenderedUrl(dicomWebBase, ref, size);
      if (!url) return { src: "", ...identity };
      try {
        const res = await fetchImpl(url);
        if (!res.ok) return { src: "", ...identity };
        return { src: await blobToDataUrl(await res.blob()), ...identity };
      } catch {
        return { src: "", ...identity };
      }
    }),
  );
}

/** Captions are the radiologist's words, and they go into innerHTML. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a CARE letter-pad key-images rail matching reportPresentation markup.
 * A cell carries a `<figcaption>` only when that image has a caption: an
 * uncaptioned image gets no element, no label and no reserved strip.
 */
export function buildKeyImagesRailHtml(images: ReportKeyImage[]): string {
  const cells = images.map((img, i) => {
    const caption = (img.caption ?? "").trim();
    const alt = escapeHtmlAttr(caption);
    const fig = caption ? `<figcaption class="image-caption">${alt}</figcaption>` : "";
    // An attachment whose pixels did not arrive still occupies its cell, and says
    // so in its own words — never with a caption invented for it.
    const viewport = img.src
      ? `<div class="image-viewport"><div class="image-framed" style="--img-zoom:1;--img-ox:0%;--img-oy:0%;--img-fit:contain;"><img src="${img.src}" class="dicom-img" alt="${alt}"/></div></div>`
      : `<div class="image-viewport"><div class="image-unreadable" role="img" aria-label="Key image #${i + 1} could not be read" style="display:flex;align-items:center;justify-content:center;min-height:96px;background:#e2e8f0;border:1px solid #b91c1c;color:#b91c1c;font:700 8px/1.2 system-ui,sans-serif;text-align:center;padding:6px;">IMAGE COULD NOT BE READ</div></div>`;
    return `<div class="image-cell">${viewport}${fig}</div>`;
  }).join("");
  return `<div class="image-panel image-panel-side image-panel-keyrail" data-image-count="${images.length}"><div class="image-panel-heading">KEY IMAGES</div><div class="image-grid">${cells}</div></div>`;
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

/** Drop empty/pending KEY IMAGES rails so print does not show a navy orphan strip. */
export function stripEmptySideImagePanel(html: string): string {
  if (!/image-panel-side/.test(html)) return html;
  if (countInlinedDicomImages(html) > 0) return html;
  const stripped = replaceSideImagePanel(html, "");
  if (!stripped) return html;
  return stripped
    .replace(/\bhas-side-images\b/g, "")
    .replace(/class="content-area\s+"/g, 'class="content-area"');
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
  if (!html) return html;
  // No client images available — drop empty/pending navy rails (orphan page 2).
  if (!dicomWebBase || refs.length === 0) {
    return stripEmptySideImagePanel(html);
  }
  const alreadyInlined = countInlinedDicomImages(html);
  const pendingEmpty =
    /dicom-img-pending|image-cell-pending|class="dicom-img"[^>]*src=""|src=""[^>]*class="dicom-img"/.test(html);
  // Re-hydrate when the rail is missing pixels, has pending placeholders, or
  // when fewer inlined images than selected refs (server budget/skip left blanks).
  // The comparison is against every selected reference: this used to cap the
  // budget at 6, so a 14-image study was declared "complete" once 6 were inlined
  // and the remaining 8 never reached the page.
  if (
    !opts?.force
    && !pendingEmpty
    && alreadyInlined > 0
    && alreadyInlined >= Math.min(refs.length, opts?.limit ?? Infinity)
  ) {
    return html;
  }

  const urls = await fetchKeyImageDataUrls(dicomWebBase, refs, {
    limit: opts?.limit,
    size: opts?.size ?? 800,
    fetchImpl: opts?.fetchImpl,
  });
  if (urls.length === 0) {
    // Failed hydrate — do not leave a blank navy KEY IMAGES strip on page 2.
    return stripEmptySideImagePanel(html);
  }
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
  /** Optional so the pages that have not got a UHID in scope keep compiling; the
   *  reporting workspace always passes it, and the header prints it when present. */
  uhid?: string;
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
  /**
   * The radiologist's saved impression style, passed through so the downloaded
   * PDF matches the screen preview and the print document. Omitted means
   * `numbered`, which is what this generator has always printed.
   */
  impressionStyle?: "bulleted" | "numbered" | "plain";
  dicomWebBase: string | null;
  imageRefs: ReportImageRef[];
  /**
   * Frozen viewport artifacts (data URLs). When non-empty, these are used for
   * the KEY IMAGES rail instead of live Orthanc rendering of imageRefs.
   */
  frozenKeyImages?: ReportKeyImage[];
  clinic: PrintClinic;
  letterhead?: CareLetterpadChrome;
  /** When false, the CARE letterpad header (logo + address) is omitted — for pre-printed letterheads. */
  showLetterpadHeader?: boolean;
  /** Structured measurements (e.g. spine canal AP rows) for the MEASUREMENTS section. */
  measurements?: Array<{ label: string; value: string }>;
  /** Settings → Doctors master — signature degree + REF. BY enrichment. */
  doctorsCatalog?: Array<{ name: string; degree?: string | null }>;
  /**
   * ADR-004 region-transition history from the open study's store.
   */
  regionTransitions?: readonly ReportedScopeRecord[] | null;
  /**
   * The examination that was BOOKED, in its own right — not the string drawn as
   * the heading. `studyName` arrives resolved through
   * `resolvePrintedReportTitle(appliedFormatReportTitle, booked)`, so whenever a
   * clinic's report format supplies its own title it names the region the report
   * *documents*, and asking the shared rule for a scope note with that string
   * makes it answer "nothing to explain" — which is how a study booked
   * whole-spine and documented cervical exported a PDF with no scope sentence at
   * all while the printed page carried it. The heading precedence is unchanged;
   * this feeds only the sentence under it. Callers that omit it keep the
   * previous behaviour.
   */
  bookedStudyName?: string | null;
  /**
   * The signer named by THIS report's authorization record, for a finalized radiology
   * report. Supplied by the caller from `patient_reports.signatureId` / `signedByName`;
   * when present the PDF prints that person rather than this browser's Print-Settings
   * signature, so a report cannot leave the building bearing the name of whoever was
   * sitting at the workstation.
   */
  signerOfRecord?: ReportSignerOfRecord | null;
  /** True when nothing has authorized this document (a draft, or an unsigned row). */
  unsigned?: boolean;
}

export async function exportRadiologyReportToPdf(input: RadiologyPdfExportInput): Promise<void> {
  const keyImages =
    input.frozenKeyImages && input.frozenKeyImages.length > 0
      ? input.frozenKeyImages
      : await fetchKeyImageDataUrls(input.dicomWebBase, input.imageRefs);
  const settings = loadPrintSettings();
  const measurements = input.measurements?.filter((m) => m.label && m.value) ?? [];
  generateReportPDF(
    {
      patientName: input.patientName,
      age: input.age,
      sex: input.sex,
      accessionNumber: input.accessionNumber,
      uhid: input.uhid ?? "",
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
      recommendation: input.recommendation?.trim() ?? "",
      measurements: measurements.length > 0 ? measurements : undefined,
      keyImages,
      reportTitle: input.studyName || "Radiology Report",
      // The booked examination the reader was promised, which is not necessarily
      // the heading above: a clinic's format title names the region this report
      // documents. One shared rule, same input as the server's print document.
      reportingScopeNote: reportedScopeNote({
        bookedTitle: input.bookedStudyName?.trim() || input.studyName || "Radiology Report",
        records: input.regionTransitions ?? [],
      }) ?? undefined,
      signerOfRecord: input.signerOfRecord ?? null,
      unsigned: input.unsigned === true,
    },
    {
      ...settings,
      impressionStyle: input.impressionStyle ?? settings.impressionStyle,
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
        measurements: measurements.length > 0 || settings.show.measurements,
        keyImages: keyImages.length > 0 || settings.show.keyImages,
      },
    },
    input.clinic,
    { letterhead: input.letterhead, doctorsCatalog: input.doctorsCatalog },
  );
}
