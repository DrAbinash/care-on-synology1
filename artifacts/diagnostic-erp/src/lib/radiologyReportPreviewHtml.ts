/**
 * radiologyReportPreviewHtml — canonical client-side report HTML used by
 * Preview, Word export, and (as a plain-text mirror) PDF findings.
 *
 * Ported from RadiologyReportingWorkspace.legacy.tsx buildPreviewHtml so the
 * new modular workspace and Word converter share one source of truth.
 */
import type { ReportImageRef } from "./reportImageRefs";
import {
  buildClassicDemographyHeaderHtml,
  buildDemographyHeaderHtml,
  type ReportDemography,
} from "./reportDemography";
import {
  formatProvenanceHover,
  provenanceMapToSegments,
  provenanceVisualKind,
  type FieldProvenanceMap,
  type ProvenanceVisualKind,
} from "./reportFieldMerge";

/** Screen-only provenance colours (stripped at print via @media print). */
export const PROVENANCE_PREVIEW_CSS = `
@media screen {
  .preview-provenance-legend {
    font-size: 10px; color: #475569; margin: 0 0 8px; padding: 4px 8px;
    background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px;
  }
  .preview-provenance-legend span { margin-right: 10px; white-space: nowrap; }
  .prov-quick-select { color: #0369a1 !important; font-weight: 500; }
  .prov-quick-findings { color: #047857 !important; font-weight: 500; }
  .prov-template-a { color: #047857 !important; font-weight: 600; }
  .prov-template-b { color: #0369a1 !important; font-weight: 600; }
  .prov-merged { color: #b45309 !important; font-weight: 500; }
  .prov-structured { color: #4338ca !important; }
  .prov-structured-candidate { color: #7c3aed !important; font-style: italic; }
  .prov-other { color: #475569 !important; }
}
@media print {
  .preview-provenance-legend, .preview-prov { color: inherit !important; font-weight: inherit !important; font-style: inherit !important; }
}
`.trim();

export type ReportHeadingCase = "all_caps" | "title_case";
export type ReportSectionSpacing = "spaced" | "compact";
export type ReportImpressionStyle = "bulleted" | "numbered" | "plain";

export type PreviewFindingsItem = { normal: boolean; text: string };

export type BuildPreviewHtmlOpts = {
  patientName: string;
  age: string;
  sex: string;
  accessionNumber: string;
  referringDoctor: string;
  studyDate: string;
  /** Classic = NAME/AGE/SEX/ACC lines; premium = two-column table header. */
  headerStyle?: "classic" | "table";
  studyName: string;
  technique: string;
  clinicalHistory: string;
  findingsMap: Record<string, PreviewFindingsItem>;
  rawFindings: string;
  useStructured: boolean;
  impression: string[];
  recommendation: string;
  imageRefs: Array<Pick<ReportImageRef, "displayOrder" | "description" | "isKeyImage"> | {
    displayOrder: number;
    description: string;
    isKeyImage?: boolean;
  }>;
  headingCase?: ReportHeadingCase;
  sectionSpacing?: ReportSectionSpacing;
  impressionStyle?: ReportImpressionStyle;
  /** Radiologist name + degree for editor preview only (PDF uses print settings). */
  signerLine?: string;
  /** Screen-only provenance tinting (not printed). */
  findingsProvenance?: FieldProvenanceMap;
  impressionProvenance?: FieldProvenanceMap;
};

const PROV_CLASS: Record<ProvenanceVisualKind, string> = {
  manual: "",
  "quick-select": "prov-quick-select",
  "quick-findings": "prov-quick-findings",
  merged: "prov-merged",
  "template-a": "prov-template-a",
  "template-b": "prov-template-b",
  "structured-template": "prov-structured",
  "structured-candidate": "prov-structured-candidate",
  other: "prov-other",
};

function htmlWithProvenance(text: string, provenance: FieldProvenanceMap | undefined): string {
  if (!provenance || Object.keys(provenance).length === 0) {
    return escHtml(text).replaceAll("\n", "<br/>");
  }
  return provenanceMapToSegments(text, provenance).map((seg) => {
    const kind = provenanceVisualKind(seg.sources);
    const cls = PROV_CLASS[kind];
    const inner = escHtml(seg.text);
    if (!cls) return inner;
    return `<span class="${cls} preview-prov" title="${escHtml(formatProvenanceHover(seg.sources))}">${inner}</span>`;
  }).join("<br/>");
}

export function escHtml(v: string): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeImpressionBullet(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed.replace(/^\s*(?:\d+[\.\)]\s+|[-•*]\s+)/, "").trim();
  return stripped || trimmed;
}

export function fmtHeading(text: string, headingCase: ReportHeadingCase): string {
  if (headingCase === "all_caps") return text.toUpperCase();
  return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Build the same HTML the Preview pane and Word export use. */
export function buildPreviewHtml(opts: BuildPreviewHtmlOpts): string {
  const hc = opts.headingCase ?? "all_caps";
  const ss = opts.sectionSpacing ?? "spaced";
  const sp = ss === "compact" ? "2px" : "10px";
  const sp2 = ss === "compact" ? "4px" : "12px";

  const demography: ReportDemography = {
    patientName: opts.patientName,
    age: opts.age,
    sex: opts.sex,
    patientId: "",
    uhid: "",
    accessionNumber: opts.accessionNumber,
    studyDescription: "",
    studyDate: opts.studyDate,
    referringDoctor: opts.referringDoctor,
    dateOfBirth: "",
  };
  const headerHtml = opts.headerStyle === "classic"
    ? buildClassicDemographyHeaderHtml(demography)
    : buildDemographyHeaderHtml(demography);

  let findingsHtml = "";
  if (opts.useStructured) {
    findingsHtml = Object.entries(opts.findingsMap)
      .map(([label, item]) => {
        const raw = item.text.trim();
        const sentence = raw || (item.normal ? "Normal." : "—");
        const body = escHtml(sentence).replaceAll("\n", "<br/>");
        const bodyHtml = item.normal ? body : `<strong>${body}</strong>`;
        return `<p style="margin:${sp} 0;break-after:avoid-page;page-break-after:avoid;"><strong>${escHtml(fmtHeading(label, hc))}:</strong> ${bodyHtml}</p>`;
      })
      .join("\n");
  } else {
    const body = opts.rawFindings.trim()
      ? htmlWithProvenance(opts.rawFindings, opts.findingsProvenance)
      : "<em style='color:#aaa;'>No findings entered.</em>";
    findingsHtml = `<p style="margin:0 0 ${sp};">${body}</p>`;
  }

  const impressionBullets = opts.impression.filter(Boolean).map(normalizeImpressionBullet);
  let impressionHtml = "";
  if (impressionBullets.length > 0) {
    const ist = opts.impressionStyle ?? "bulleted";
    const impressionBody = htmlWithProvenance(
      impressionBullets.join("\n"),
      opts.impressionProvenance,
    );
    if (ist === "numbered") {
      impressionHtml = `<ol style="margin:4px 0 0 22px;padding:0;">${impressionBullets.map((b) => {
        const seg = provenanceMapToSegments(b, opts.impressionProvenance ?? {})[0];
        const kind = seg ? provenanceVisualKind(seg.sources) : "manual";
        const cls = PROV_CLASS[kind];
        const inner = escHtml(b);
        const wrapped = cls ? `<span class="${cls} preview-prov">${inner}</span>` : inner;
        return `<li>${wrapped}</li>`;
      }).join("")}</ol>`;
    } else if (ist === "plain") {
      impressionHtml = `<p style="margin:4px 0;">${impressionBody.replace(/<br\/>/g, "; ")}</p>`;
    } else {
      impressionHtml = `<ul style="margin:4px 0 0 18px;padding:0;">${impressionBullets.map((b) => {
        const seg = provenanceMapToSegments(b, opts.impressionProvenance ?? {})[0];
        const kind = seg ? provenanceVisualKind(seg.sources) : "manual";
        const cls = PROV_CLASS[kind];
        const inner = escHtml(b);
        const wrapped = cls ? `<span class="${cls} preview-prov">${inner}</span>` : inner;
        return `<li>${wrapped}</li>`;
      }).join("")}</ul>`;
    }
  } else {
    impressionHtml = `<p style="margin:4px 0;color:#aaa;"><em>Draft impression — not verified.</em></p>`;
  }

  const provenanceLegend = (opts.findingsProvenance || opts.impressionProvenance)
    ? `<div class="preview-provenance-legend" style="font-size:10px;color:#475569;margin:0 0 8px;padding:4px 8px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:4px;">
      <span class="prov-template-a" style="color:#047857;font-weight:600;margin-right:8px;">● Format A</span>
      <span class="prov-template-b" style="color:#0369a1;font-weight:600;margin-right:8px;">● Format B</span>
      <span class="prov-quick-select" style="color:#0369a1;margin-right:8px;">● Quick Select</span>
      <span class="prov-quick-findings" style="color:#047857;margin-right:8px;">● Quick Findings</span>
      <em>(preview only — not printed)</em></div>
      <style>${PROVENANCE_PREVIEW_CSS}</style>`
    : "";

  const hStyle = (margin: string) => `margin:${margin};break-after:avoid-page;page-break-after:avoid;`;

  const orderedImageRefs = [...opts.imageRefs].sort((a, b) => a.displayOrder - b.displayOrder);
  const imagesHtml = orderedImageRefs.length > 0
    ? `<h3 style="${hStyle(`${sp2} 0 ${sp}`)}"><u>${fmtHeading("Key Images", hc)}</u></h3>
    <ul style="margin:4px 0 0 18px;padding:0;">${orderedImageRefs.map((img, i) => `<li>Image ${i + 1}${img.isKeyImage ? " (KEY)" : ""}: ${escHtml(img.description)}</li>`).join("")}</ul>`
    : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13pt;line-height:1.6;color:#111;width:100%;margin:0 auto;">
    ${provenanceLegend}
    ${headerHtml}
    <hr style="border:none;border-top:2px solid #000;margin:8px 0;" />
    <h2 style="text-align:center;text-decoration:underline;font-size:16pt;margin:10px 0;break-after:avoid-page;page-break-after:avoid;"><strong>${escHtml(opts.studyName)}</strong></h2>
    <h3 style="${hStyle(`${sp} 0 ${sp}`)}font-size:14pt;"><u>${fmtHeading("Technique", hc)}</u></h3>
    <p style="margin:0 0 ${sp};font-size:13pt;">${escHtml(opts.technique)}</p>
    ${opts.clinicalHistory ? `<h3 style="${hStyle(`${sp} 0 ${sp}`)}font-size:14pt;"><u>${fmtHeading("Clinical History", hc)}</u></h3><p style="margin:0 0 ${sp};font-size:13pt;">${escHtml(opts.clinicalHistory)}</p>` : ""}
    <hr style="border:none;border-top:2px solid #000;margin:8px 0;" />
    <h3 style="${hStyle(`${sp} 0 ${sp}`)}font-size:14pt;"><u>${fmtHeading("Findings / Observation", hc)}</u></h3>
    ${findingsHtml}
    ${imagesHtml}
    <h3 style="${hStyle(`${sp2} 0 ${sp}`)}font-size:14pt;"><u>${fmtHeading("Impression", hc)}</u></h3>
    ${impressionHtml}
    ${opts.recommendation?.trim() ? `<h3 style="${hStyle(`${sp2} 0 ${sp}`)}font-size:14pt;"><u>${fmtHeading("Recommendation", hc)}</u></h3>
    <p style="margin:0 0 ${sp};font-size:13pt;">${escHtml(opts.recommendation.trim())}</p>` : ""}
    <hr style="border:none;border-top:1px solid #999;margin:${sp2} 0 4px;" />
    <p style="font-size:11pt;color:#666;font-style:italic;margin:0;">Please correlate with clinical history and findings. Report issued by authorized radiologist only.</p>
    ${opts.signerLine ? `<p style="text-align:right;margin:18px 0 0;font-size:13pt;"><strong>${escHtml(opts.signerLine)}</strong></p>` : ""}
  </div>`.trim();
}

/** Friendlier toast copy for common Word/PDF export failures. */
export function formatReportExportError(err: unknown, kind: "Word" | "PDF"): string {
  const raw = err instanceof Error ? err.message : `Could not build the ${kind}`;
  if (/failed to fetch dynamically imported module|loading chunk|importing a module script failed/i.test(raw)) {
    return `${kind} export script could not load (stale page or tunnel error). Reload this page and try again.`;
  }
  if (/<!doctype|<html|cloudflare|tunnel error/i.test(raw)) {
    return "ERP server unreachable. Retry when the tunnel/NAS is up, or use LAN.";
  }
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}
