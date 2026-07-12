/**
 * reportPresentation.ts — Ticket R1.1: THE shared report presentation layer.
 *
 * Every rendered report surface flows through renderReportDocument():
 * browser preview (workspace draft preview), browser print, staff PDF,
 * public/WhatsApp PDF, email share, PACS archive — and, later, patient /
 * referrer portals and mobile. One render pipeline, no duplicated HTML.
 *
 * The layout/typography of the previously dormant premium implementation
 * (frontend lib/premiumReportRenderer.ts — the "Antigravity"-era renderer
 * that never activated; see PREMIUM_LAYOUT_AUDIT.md) is ported here as the
 * `care-premium` template. `care-classic` reproduces the presentation the
 * clinic delivers today and stays the default, so nothing changes until an
 * administrator selects a different template.
 *
 * PRESENTATION ONLY. This module never touches structured JSON, hashes,
 * audit, amendments or clinical wording — it lays out content it is handed.
 * Slot separation (header / patientBlock / studyTitle / sectionHeading /
 * body / footer / signature / imagePanel) is deliberate groundwork for the
 * template engine (CARE V2, Hope, Government, Teleradiology, Patient Copy,
 * Referrer Copy) and configurable typography in later tickets — new
 * templates register in PRESENTATION_TEMPLATES without new render logic.
 */

// ── Escaping ─────────────────────────────────────────────────────────────────

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ── Document model (Phase 9 — slot-separated content) ───────────────────────

export interface ReportClinicHeader {
  name: string;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoDataUrl?: string | null;
}

export interface ReportPatientRow {
  label: string;
  value: string;
}

export interface ReportParameterRow {
  name: string;
  result: string;
  unit?: string;
  refRange?: string;
  /** lowercase css-safe flag ("high" | "low" | "critical" | "" for normal) */
  flag?: string;
}

export interface ReportSignatureModel {
  imageDataUrl?: string | null;
  name: string;
  qualification?: string | null;
  role?: string | null;
  registrationNo?: string | null;
  label: string;      // "Signed:" | "Verified:"
  whenLabel?: string; // pre-formatted timestamp (empty = hidden)
}

export interface ReportKeyImageModel {
  /** data: URL inlined server-side, or a same-origin proxy URL. NEVER a
   *  public PACS URL and never a browser blob URL. */
  src: string;
  caption: string;
  displayOrder: number;
  /** Optional deep-link identifiers kept for viewer integration (Phase 11). */
  sopInstanceUid?: string | null;
  /** R1.3 — clinically-flagged key image; rendered with a KEY badge. */
  isKeyImage?: boolean;
}

export interface ReportDocumentModel {
  reportNumber: string;
  /** Study / report title, e.g. "MRI BRAIN (PLAIN)". */
  studyTitle: string;
  typeLabel: string;   // "RADIOLOGY" | "PATHOLOGY"
  statusLabel: string; // "VERIFIED" | "SIGNED" ...
  clinic: ReportClinicHeader;
  patientRows: ReportPatientRow[];
  /** D8 safeguard fragments — passed through EXACTLY as produced by the
   *  version-resolution layer (semantics frozen; presentation only hosts them). */
  safeguardBannerHtml?: string;
  safeguardWatermarkHtml?: string;
  criticalNote?: string | null;
  isCritical?: boolean;
  impression?: string | null;
  parameters?: ReportParameterRow[];
  /** Trusted, already-sanitized report body HTML (radiology) — produced by the
   *  frozen render pipeline. */
  bodyHtml?: string;
  /** Plain text body (escaped by the renderer) for non-radiology reports. */
  bodyText?: string;
  keyImages?: ReportKeyImageModel[];
  stamp: { kind: "verified" | "pending" | "draft"; label: string };
  signatures: ReportSignatureModel[];
  /** R1.4 — a real, scannable QR code (PNG data: URL) encoding the report's
   *  public verification link, generated server-side by the caller (never a
   *  public PACS/internal URL — the same publicToken infra the patient PDF
   *  link already uses). When absent, no QR block is emitted at all — a
   *  static "QR Verification / SECURE" placeholder with nothing encoded in
   *  it used to render unconditionally here, which is not an honest stand-in
   *  for a real verification feature. */
  qrDataUrl?: string | null;
  showQrPlaceholder?: boolean;
  footerNote?: string | null;
  generatedAtLabel: string;
  /** Draft previews watermark themselves so a draft can never pass as final. */
  draftWatermark?: boolean;
  autoPrint?: boolean;
}

// ── Template model (Phase 8/9 — registry + typography slots) ────────────────

export type PresentationSlot =
  | "header" | "patientBlock" | "studyTitle" | "sectionHeading"
  | "body" | "footer" | "signature" | "imagePanel";

export interface SlotTypography {
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  letterSpacing?: string;
  textTransform?: string;
  fontWeight?: string;
}

export interface PresentationTemplate {
  id: string;
  name: string;
  description: string;
  /** Per-slot typography — later tickets expose these as configuration;
   *  the render logic already consumes them exclusively through this map. */
  typography: Record<PresentationSlot, SlotTypography>;
  palette: {
    headerBg: string; headerText: string; accent: string;
    sectionBg: string; sectionBorder: string;
    labelColor: string; valueColor: string; impressionBg: string;
  };
  layout: {
    /** "inline" — images render as a block after the body (classic).
     *  "side-panel" — desktop: report left / images right; print: floated
     *  right rail the text wraps around. Full width when no images. */
    imagePlacement: "inline" | "side-panel";
    /** "grid" — the classic 4-column label-over-value demographics grid.
     *  "table" — the premium label : value table. */
    patientBlockStyle: "grid" | "table";
    pageMargins: string;
  };
}

const BASE_FONT = "'Segoe UI', Helvetica, Arial, sans-serif";

export const PRESENTATION_TEMPLATES: PresentationTemplate[] = [
  {
    id: "care-classic",
    name: "CARE Classic",
    description: "The presentation the clinic delivers today — unchanged default.",
    typography: {
      header: { fontFamily: BASE_FONT, fontSize: "20px", color: "#1e1b4b", fontWeight: "800" },
      patientBlock: { fontFamily: BASE_FONT, fontSize: "11px" },
      studyTitle: { fontFamily: BASE_FONT, fontSize: "16px", color: "#1e1b4b", fontWeight: "700" },
      sectionHeading: { fontFamily: BASE_FONT, fontSize: "12px", fontWeight: "700" },
      body: { fontFamily: BASE_FONT, fontSize: "12px", color: "#111" },
      footer: { fontFamily: BASE_FONT, fontSize: "9px", color: "#64748b" },
      signature: { fontFamily: BASE_FONT, fontSize: "12px" },
      imagePanel: { fontFamily: BASE_FONT, fontSize: "10px" },
    },
    palette: {
      headerBg: "#ffffff", headerText: "#1e1b4b", accent: "#4338ca",
      sectionBg: "#f8fafc", sectionBorder: "#e2e8f0",
      labelColor: "#64748b", valueColor: "#111111", impressionBg: "#fef9c3",
    },
    layout: { imagePlacement: "inline", patientBlockStyle: "grid", pageMargins: "14mm" },
  },
  {
    id: "care-premium",
    name: "CARE Premium",
    description: "Publication-quality layout activated from the dormant premium implementation: banded header, accent study bar, structured sections, image panel on the right.",
    typography: {
      header: { fontFamily: BASE_FONT, fontSize: "18pt", color: "#ffffff", fontWeight: "700", letterSpacing: "0.04em" },
      patientBlock: { fontFamily: BASE_FONT, fontSize: "8.5pt" },
      studyTitle: { fontFamily: BASE_FONT, fontSize: "12pt", color: "#ffffff", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase" },
      sectionHeading: { fontFamily: BASE_FONT, fontSize: "9.5pt", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase" },
      body: { fontFamily: BASE_FONT, fontSize: "10pt", color: "#0f172a" },
      footer: { fontFamily: BASE_FONT, fontSize: "7.5pt", color: "#94a3b8" },
      signature: { fontFamily: BASE_FONT, fontSize: "10pt" },
      imagePanel: { fontFamily: BASE_FONT, fontSize: "7pt" },
    },
    palette: {
      headerBg: "#0f172a", headerText: "#ffffff", accent: "#3b82f6",
      sectionBg: "#f8fafc", sectionBorder: "#3b82f6",
      labelColor: "#64748b", valueColor: "#0f172a", impressionBg: "#eff6ff",
    },
    layout: { imagePlacement: "side-panel", patientBlockStyle: "table", pageMargins: "10mm 12mm" },
  },
  // Future template ids (R1.2+): "care-v2", "hope", "government",
  // "teleradiology", "patient-copy", "referrer-copy" — register here with
  // their own typography/palette/layout; render logic below is shared.
];

export const DEFAULT_TEMPLATE_ID = "care-classic";

export function resolvePresentationTemplate(id?: string | null): PresentationTemplate {
  const wanted = (id ?? "").trim();
  return PRESENTATION_TEMPLATES.find((t) => t.id === wanted)
    ?? PRESENTATION_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!;
}

// ── Fragment builders (shared by all templates) ──────────────────────────────

function slotCss(t: SlotTypography): string {
  const parts: string[] = [];
  if (t.fontFamily) parts.push(`font-family:${t.fontFamily};`);
  if (t.fontSize) parts.push(`font-size:${t.fontSize};`);
  if (t.color) parts.push(`color:${t.color};`);
  if (t.letterSpacing) parts.push(`letter-spacing:${t.letterSpacing};`);
  if (t.textTransform) parts.push(`text-transform:${t.textTransform};`);
  if (t.fontWeight) parts.push(`font-weight:${t.fontWeight};`);
  return parts.join("");
}

function parametersHtml(params: ReportParameterRow[] | undefined): string {
  if (!params || params.length === 0) return "";
  return `
      <table class="params">
        <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th></tr></thead>
        <tbody>
          ${params.map((p) => {
            const safeFlag = (p.flag ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
            const flagged = safeFlag !== "" && safeFlag !== "normal";
            return `<tr class="${flagged ? "abnormal" : ""}">
              <td>${escapeHtml(p.name)}</td>
              <td><strong>${escapeHtml(p.result)}</strong>${flagged ? ` <span class="flag flag-${safeFlag}">${escapeHtml(safeFlag.toUpperCase())}</span>` : ""}</td>
              <td>${escapeHtml(p.unit ?? "")}</td>
              <td>${escapeHtml(p.refRange ?? "")}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
}

function signaturesHtml(signatures: ReportSignatureModel[], showImage = true): string {
  const blocks = signatures.filter((s) => s.name || s.imageDataUrl).map((sig) => `
      <div class="sigbox">
        <div class="sigimg">${sig.imageDataUrl && showImage ? `<img src="${sig.imageDataUrl}" alt="signature"/>` : ""}</div>
        <div class="sigline"></div>
        <div class="signame">${escapeHtml(sig.name)}</div>
        <div class="sigmeta">${escapeHtml(sig.qualification ?? "")}${sig.qualification && sig.role ? " • " : ""}${escapeHtml(sig.role ?? "")}</div>
        <div class="sigmeta">${sig.registrationNo ? `Reg. No: ${escapeHtml(sig.registrationNo)}` : ""}</div>
        <div class="sigmeta sigwhen">${escapeHtml(sig.label)}${escapeHtml(sig.whenLabel ?? "")}</div>
      </div>`);
  return blocks.join("");
}

function keyImagesHtml(images: ReportKeyImageModel[], placement: "inline" | "side-panel"): string {
  if (images.length === 0) return "";
  const cells = [...images]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((img, i) => `
        <figure class="image-cell"${img.sopInstanceUid ? ` data-sop-instance-uid="${escapeHtml(img.sopInstanceUid)}"` : ""}>
          ${img.isKeyImage ? `<span class="key-image-badge">★ KEY</span>` : ""}<img src="${img.src}" class="dicom-img" alt="${escapeHtml(img.caption || `Image ${i + 1}`)}" />
          <figcaption class="image-caption">${escapeHtml(img.caption || `Image ${i + 1}`)}</figcaption>
        </figure>`)
    .join("");
  return `
      <div class="image-panel ${placement === "side-panel" ? "image-panel-side" : "image-panel-inline"}">
        <div class="image-panel-heading">SELECTED IMAGES</div>
        <div class="image-grid">${cells}</div>
      </div>`;
}

// ── R1.2 — template render extensions ────────────────────────────────────────
// The versioned template engine (presentationTemplateModel.compileTemplate)
// resolves definitions into PresentationTemplate PLUS these optional fields.
// Every default reproduces the R1.1 hard-coded behavior byte-for-byte, so
// legacy PRESENTATION_TEMPLATES objects and compiled seeds render identically.

export interface TemplateRenderExtensions {
  templateKey?: string;
  templateVersion?: number;
  copyType?: string;
  page?: { size: "A4" | "A5" | "Letter"; orientation: "portrait" | "landscape"; margins: string };
  headerCfg?: { show: boolean; showLogo: boolean; showTagline: boolean; showContact: boolean; style: "banded" | "underlined" };
  studyTitleCfg?: { style: "bar" | "plain" };
  signatureCfg?: { show: boolean; showImage: boolean };
  footerCfg?: { show: boolean };
  imagePanelCfg?: { placement: "inline" | "side-panel"; panelWidthMm: number };
  watermarkCfg?: { enabled: boolean; text: string };
  qrCfg?: { show: boolean };
  pageBreaks?: { orphans: number; widows: number };
  spacingCfg?: { lineHeight?: string; sectionGap?: string };
  impressionTypography?: SlotTypography;
  bodyLineHeight?: string;
  bodyTextAlign?: string;
}

export type RenderableTemplate = PresentationTemplate & TemplateRenderExtensions;

// ── The ONE renderer ─────────────────────────────────────────────────────────

export interface RenderDocumentOptions {
  /** Extra CSS appended last (institutional style carry-over: font size,
   *  margins, spacing, half-page/screen-only print modes). Presentation only. */
  customCss?: string;
}

export function renderReportDocument(
  model: ReportDocumentModel,
  template: RenderableTemplate,
  opts: RenderDocumentOptions = {},
): string {
  const ty = template.typography;
  const pal = template.palette;
  const images = model.keyImages ?? [];
  // R1.3 — badge CSS is emitted only when a flagged image exists, so every
  // pre-R1.3 document (no key flags) still renders byte-identically.
  const hasKeyImages = images.some((img) => img.isKeyImage === true);
  const hasImages = images.length > 0;
  const sidePanel = template.layout.imagePlacement === "side-panel" && hasImages;

  // R1.2 template capabilities — every default reproduces R1.1 behavior.
  const banded = template.headerCfg ? template.headerCfg.style === "banded" : pal.headerBg !== "#ffffff";
  const titleBar = template.studyTitleCfg ? template.studyTitleCfg.style === "bar" : banded;
  const headerCfg = template.headerCfg ?? { show: true, showLogo: true, showTagline: true, showContact: true, style: banded ? "banded" as const : "underlined" as const };
  const signatureCfg = template.signatureCfg ?? { show: true, showImage: true };
  const footerCfg = template.footerCfg ?? { show: true };
  const panelWidthMm = template.imagePanelCfg?.panelWidthMm ?? 64;
  const orphans = template.pageBreaks?.orphans ?? 3;
  const widows = template.pageBreaks?.widows ?? 3;
  const bodyLineHeight = template.bodyLineHeight ?? "1.55";
  const sectionGap = template.spacingCfg?.sectionGap ?? "12px";
  const pageSize = template.page ? `${template.page.size} ${template.page.orientation}` : "A4 portrait";
  // R1.4 — a QR block is only ever emitted when a REAL, scannable code was
  // generated server-side (model.qrDataUrl). showQrPlaceholder alone used to
  // be sufficient and rendered a static "SECURE" box that encoded nothing —
  // silently misleading on a document a patient may try to scan.
  const qrVisible = Boolean(model.showQrPlaceholder) && Boolean(model.qrDataUrl) && template.qrCfg?.show !== false;
  const templateWatermark = template.watermarkCfg?.enabled && template.watermarkCfg.text
    ? `<div class="template-watermark" aria-hidden="true">${escapeHtml(template.watermarkCfg.text)}</div>`
    : "";

  const visibleRows = model.patientRows.filter((r) => r.value);
  const patientBlockHtml = template.layout.patientBlockStyle === "grid"
    ? `<div class="patient-grid">${visibleRows
        .map((r) => `<div><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`)
        .join("")}</div>`
    : `<table class="patient-table"><tbody>${visibleRows
        .map((r) => `<tr><td class="pt-label">${escapeHtml(r.label)}</td><td class="pt-sep">:</td><td class="pt-value">${escapeHtml(r.value)}</td></tr>`)
        .join("")}</tbody></table>`;

  const criticalBanner = model.isCritical
    ? `<div class="critical">⚠ CRITICAL VALUE — IMMEDIATE ATTENTION REQUIRED${model.criticalNote ? `: ${escapeHtml(model.criticalNote)}` : ""}</div>`
    : "";

  const stampHtml = `<div class="stamp ${model.stamp.kind}">${escapeHtml(model.stamp.label)}</div>`;

  const bodyHtml = model.bodyHtml
    ? `<div class="body">${model.bodyHtml}</div>`
    : model.bodyText
      ? `<div class="body">${escapeHtml(model.bodyText)}</div>`
      : "";

  const qrHtml = qrVisible ? `
      <div class="qr-block">
        <div class="qr-box"><span>Scan to verify</span><img class="qr-mark" src="${model.qrDataUrl}" alt="QR verification code" width="50" height="50" /></div>
      </div>` : "";

  const draftWatermark = model.draftWatermark
    ? `<div class="draft-watermark" aria-hidden="true">DRAFT — NOT SIGNED</div>`
    : "";

  const imagesBlock = keyImagesHtml(images, template.layout.imagePlacement);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(model.reportNumber)} — ${escapeHtml(model.studyTitle)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      ${slotCss(ty.body)}
      background: #ffffff;
      line-height: ${bodyLineHeight};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-wrapper { max-width: 210mm; margin: 0 auto; background: #fff; }

    /* ── Header slot ── */
    .hdr {
      background: ${pal.headerBg};
      display: flex; align-items: center; gap: 14px;
      padding: ${!banded ? "0 0 10px" : "14px 20px 10px"};
      ${!banded ? `border-bottom: 3px solid ${pal.accent};` : ""}
      margin-bottom: ${!banded ? "12px" : "0"};
      break-inside: avoid;
    }
    .hdr img.logo { width: 60px; height: 60px; object-fit: contain; }
    .hdr .name { ${slotCss(ty.header)} line-height: 1.1; }
    .hdr .tagline { font-size: 10px; color: ${!banded ? "#475569" : pal.accent}; margin-top: 2px; letter-spacing: 0.06em; }
    .hdr .contact { margin-left: auto; text-align: right; font-size: 10px; color: ${!banded ? "#475569" : pal.headerText + "cc"}; line-height: 1.4; }

    /* ── Study title slot ──
       R1.4 — the banded/titleBar branch below adds clear:both so the
       preceding floated .reportno span (which sits before this element in
       the DOM) cannot paint underneath/on top of this bar's solid
       background — a float's box paints above a following block's
       background in CSS painting order, so without this the report number
       rendered as low-contrast text stacked illegibly on the colored bar in
       every banded/titleBar template (premium and any other banded seed).
       Classic (the !titleBar branch, no background) is unaffected either
       way and keeps its existing "Report #" beside the title layout. */
    .study-title-bar {
      ${slotCss(ty.studyTitle)}
      ${!titleBar
        ? `padding: 2px 0 6px;`
        : `background: ${pal.accent}; text-align: center; padding: 8px 20px; clear: both;`}
      break-inside: avoid; break-after: avoid-page;
    }
    .reportno { float: right; font-family: monospace; color: ${pal.labelColor}; font-size: 10px; }

    /* ── Patient block slot ── */
    .patient-section {
      ${slotCss(ty.patientBlock)}
      background: ${pal.sectionBg};
      border: 1.5px solid ${pal.sectionBorder};
      border-radius: ${!banded ? "6px" : "0"};
      padding: 10px 14px; margin-bottom: 12px;
      break-inside: avoid;
    }
    .patient-table { width: 100%; border-collapse: collapse; }
    .patient-table td { padding: 1.5px 0; vertical-align: top; }
    .pt-label { color: ${pal.labelColor}; font-weight: 600; width: 130px; white-space: nowrap; }
    .pt-sep { width: 12px; color: ${pal.labelColor}; padding: 1.5px 4px; }
    .pt-value { color: ${pal.valueColor}; font-weight: 500; }
    .patient-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 14px; }
    .patient-grid div span { color: ${pal.labelColor}; display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    .patient-grid div strong { font-size: 12px; color: ${pal.valueColor}; }

    /* ── Content area: report column + optional image side panel ── */
    .content-area { padding: ${!banded ? "0" : "0 20px"}; }
    ${sidePanel ? `
    /* Desktop: two columns — clinical report left, selected images right. */
    @media screen and (min-width: 1024px) {
      .content-area { display: grid; grid-template-columns: 1fr ${panelWidthMm}mm; gap: 8mm; align-items: start; }
      .image-panel-side { position: sticky; top: 8px; }
    }
    /* R1.4 — print/PDF does NOT float the image panel. A floated column
       runs independently of the main text's page-break flow: once the
       float outgrows the (often much shorter) report text beside it,
       Chromium's print engine keeps emitting pages whose main column is
       empty while only the float continues — reproduced with real
       Chromium print-to-PDF: a 24-image care-premium report grew from 6
       pages (classic, no float) to 10 pages, most of them blank, and a
       100-image report reached 26 pages. Printing the images in normal
       document flow after the report text, 2-up, paginates exactly like
       every other section on the page (break-inside:avoid per image cell,
       already set below) and can never desynchronize from the text. */
    @media print {
      .image-panel-side { width: 100%; }
      /* Specificity must beat the unconditional (screen-sidebar) single-column
         rule below (.image-panel-side .image-grid), which has no media
         qualifier and so also matches print — an equal-specificity print rule
         placed earlier in the stylesheet loses to it by source order. Scoping
         through the real .content-area ancestor (image-panel-side is always
         its direct child — see the content-area markup below) adds a class
         to the selector without resorting to !important. */
      .content-area .image-panel-side .image-grid { grid-template-columns: repeat(2, 1fr); }
    }` : ""}

    /* ── Section headings + body slots ── */
    .section-heading {
      ${slotCss(ty.sectionHeading)}
      color: ${pal.accent};
      border-bottom: 1.5px solid ${pal.sectionBorder};
      padding-bottom: 3px; margin: ${sectionGap} 0 6px;
      break-after: avoid-page;
    }
    .body { white-space: pre-wrap; line-height: ${bodyLineHeight}; margin: 0 0 12px;${template.bodyTextAlign ? ` text-align: ${template.bodyTextAlign};` : ""} }
    .body p, .body div { orphans: ${orphans}; widows: ${widows}; }
    p { orphans: ${orphans}; widows: ${widows}; }

    /* ── Impression ── */
    .impression {
      ${slotCss(template.impressionTypography ?? {})}
      background: ${pal.impressionBg};
      border-left: 4px solid ${pal.accent};
      border-radius: 4px; padding: 8px 12px; margin: 0 0 12px;
      break-inside: avoid;
    }

    /* ── Parameters table ── */
    .params { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 11px; }
    .params th { background: ${!banded ? "#1e1b4b" : pal.headerBg}; color: #fff; padding: 6px 8px; text-align: left; }
    .params td { padding: 5px 8px; border-bottom: 1px solid ${pal.sectionBorder}; }
    .params tr.abnormal td { background: #fef2f2; }
    .params tr { break-inside: avoid; }
    .flag { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 700; }
    .flag-low { background: #dbeafe; color: #1e40af; }
    .flag-high { background: #fee2e2; color: #b91c1c; }
    .flag-critical { background: #7f1d1d; color: #fff; }

    /* ── Status / banners ── */
    .stamp { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: 700; font-size: 11px; margin: 8px 0; }
    .stamp.verified { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .stamp.pending { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .stamp.draft { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .critical { background: #7f1d1d; color: #fff; padding: 8px 12px; font-weight: 800; font-size: 13px; margin: 0 0 12px; border-radius: 4px; letter-spacing: 0.3px; }
    .superseded-banner { background: #7f1d1d; color: #fff; border: 2px solid #450a0a; padding: 10px 14px; font-weight: 800; font-size: 13px; margin: 0 0 12px; border-radius: 4px; letter-spacing: 0.3px; }
    .amended-banner { background: #eff6ff; color: #1e3a8a; border: 1.5px solid #3b82f6; padding: 8px 12px; font-weight: 700; font-size: 12px; margin: 0 0 12px; border-radius: 4px; }
    .version-warning { background: #fef3c7; color: #92400e; border: 1.5px solid #f59e0b; padding: 8px 12px; font-weight: 700; font-size: 12px; margin: 0 0 12px; border-radius: 4px; }
    .superseded-watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; transform: rotate(-28deg); font-size: 104px; font-weight: 900; color: rgba(185,28,28,0.14); letter-spacing: 10px; z-index: 9999; pointer-events: none; }
    .template-watermark { position: fixed; top: 46%; left: 0; right: 0; text-align: center; transform: rotate(-28deg); font-size: 56px; font-weight: 900; color: rgba(71,85,105,0.10); letter-spacing: 8px; z-index: 9997; pointer-events: none; }
    .draft-watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; transform: rotate(-28deg); font-size: 64px; font-weight: 900; color: rgba(30,64,175,0.12); letter-spacing: 6px; z-index: 9998; pointer-events: none; }

    /* ── Image panel slot ── */
    .image-panel { ${slotCss(ty.imagePanel)} margin: 10px 0; }
    .image-panel-heading {
      ${slotCss(ty.sectionHeading)}
      color: ${pal.accent};
      border-bottom: 1.5px solid ${pal.sectionBorder};
      padding-bottom: 3px; margin-bottom: 6px;
      break-after: avoid-page;
    }
    .image-panel-inline .image-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .image-panel-side .image-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .image-cell {
      margin: 0; border: 1px solid #e0e0e0; border-radius: 4px; overflow: hidden;
      background: #000; text-align: center;
      break-inside: avoid; page-break-inside: avoid;
    }${hasKeyImages ? `
    .image-cell { position: relative; }
    .key-image-badge {
      position: absolute; top: 3px; left: 3px; z-index: 1;
      background: ${pal.accent}; color: #fff; font-size: 8px; font-weight: 800;
      letter-spacing: 0.06em; padding: 1px 5px; border-radius: 3px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }` : ""}
    .dicom-img { width: 100%; max-height: 70mm; object-fit: contain; display: block; background: #000; }
    .image-caption {
      background: ${pal.accent}; color: #fff; font-weight: 600;
      padding: 2px 6px; letter-spacing: 0.05em; text-transform: uppercase;
    }

    /* ── Footer + signatures slots ── */
    .sigs { display: flex; gap: 30px; justify-content: flex-end; margin-top: 26px; break-inside: avoid; clear: both; }
    .sigbox { ${slotCss(ty.signature)} width: 200px; text-align: center; }
    .sigbox .sigimg { height: 50px; display: flex; align-items: flex-end; justify-content: center; }
    .sigbox .sigimg img { max-height: 50px; max-width: 180px; object-fit: contain; }
    .sigline { border-top: 1.5px solid #111; margin: 2px 0 4px; }
    .signame { font-weight: 700; }
    .sigmeta { font-size: 10px; color: ${pal.labelColor}; line-height: 1.3; }
    .sigwhen { margin-top: 3px; font-style: italic; }
    .qr-block { float: left; margin-top: 10px; }
    .qr-box { display: inline-block; padding: 4px; border: 1px solid #ccc; background: #fff; border-radius: 4px; font-size: 8px; color: #666; font-weight: bold; text-align: center; }
    .qr-mark { width: 50px; height: 50px; display: block; margin: 2px auto 0; }
    .ftr { ${slotCss(ty.footer)} margin-top: 18px; text-align: center; border-top: 1px solid ${pal.sectionBorder}; padding-top: 6px; clear: both; break-inside: avoid; }

    /* ── Print rules (Phase 7: widows/orphans, no split images, no blank pages) ── */
    @media print {
      @page { size: ${pageSize}; margin: ${template.layout.pageMargins}; }
      .report-wrapper { max-width: 100%; }
      .no-print { display: none !important; }
      .image-cell, .sigs, .impression, .patient-section, .hdr { page-break-inside: avoid; }
      .section-heading, .image-panel-heading { page-break-after: avoid; }
      body { orphans: ${orphans}; widows: ${widows}; }
    }
    ${opts.customCss ?? ""}
  </style></head><body>
  <div class="report-wrapper">
    ${model.safeguardWatermarkHtml ?? ""}
    ${draftWatermark}
    ${templateWatermark}
    ${headerCfg.show ? `<div class="hdr">
      ${model.clinic.logoDataUrl && headerCfg.showLogo ? `<img class="logo" src="${model.clinic.logoDataUrl}" alt="logo"/>` : ""}
      <div>
        <div class="name">${escapeHtml(model.clinic.name)}</div>
        ${model.clinic.tagline && headerCfg.showTagline ? `<div class="tagline">${escapeHtml(model.clinic.tagline)}</div>` : ""}
      </div>
      ${headerCfg.showContact ? `<div class="contact">
        ${escapeHtml(model.clinic.address ?? "")}<br/>
        ${[model.clinic.phone, model.clinic.email].filter(Boolean).map((v) => escapeHtml(v!)).join(" • ")}<br/>
        ${escapeHtml(model.clinic.website ?? "")}
      </div>` : ""}
    </div>` : ""}
    <span class="reportno">Report #: ${escapeHtml(model.reportNumber)}</span>
    <div class="study-title-bar">${escapeHtml(model.studyTitle)}</div>
    <div class="patient-section">
      ${patientBlockHtml}
    </div>
    ${model.safeguardBannerHtml ?? ""}
    ${criticalBanner}
    <div class="content-area">
      <div class="report-column">
        ${model.impression ? `<div class="impression"><strong>Impression:</strong> ${escapeHtml(model.impression)}</div>` : ""}
        ${parametersHtml(model.parameters)}
        ${bodyHtml}
        ${!sidePanel ? imagesBlock : ""}
        ${stampHtml}
      </div>
      ${sidePanel ? imagesBlock : ""}
    </div>
    ${signatureCfg.show ? `<div class="sigs">${signaturesHtml(model.signatures, signatureCfg.showImage)}</div>` : ""}
    ${qrHtml}
    ${footerCfg.show ? `<div class="ftr">${escapeHtml(model.footerNote ?? "")} • ${escapeHtml(model.typeLabel)} • ${escapeHtml(model.statusLabel)} • Generated ${escapeHtml(model.generatedAtLabel)}</div>` : ""}
  </div>
  ${model.autoPrint ? `<script>window.onload=()=>{setTimeout(()=>window.print(),250);}</script>` : ""}
  </body></html>`;
}
