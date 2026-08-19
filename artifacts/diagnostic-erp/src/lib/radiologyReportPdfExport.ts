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
      show: {
        ...settings.show,
        keyImages: keyImages.length > 0 || settings.show.keyImages,
      },
    },
    input.clinic,
    { letterhead: input.letterhead },
  );
}
