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

import { framingImgInline, framingInlineStyle, sideRailCount } from "./imageFraming";
import { careLetterheadLogoDataUrl } from "./careLetterheadLogo";
import {
  letterPadErpPdfLockCss,
  resolveLetterheadChrome,
  usesCareLetterpad,
  type CareLetterheadChrome,
} from "./careLetterheadChrome";

export {
  CARE_LETTERPAD,
  letterPadErpPdfLockCss,
  resolveLetterheadChrome,
  usesCareLetterpad,
  type CareLetterheadChrome,
} from "./careLetterheadChrome";

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
  /** Non-destructive viewport framing (zoom / pan / fit). Same CSS is used
   *  by workspace preview, print, and PDF. */
  framing?: { zoom: number; offsetX: number; offsetY: number; fitMode: "contain" | "cover" } | string | null;
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
     *  "side-panel" — report left (~70%) / key images right (~30%) on BOTH
     *  screen preview and print/PDF. Full width when no images. */
    imagePlacement: "inline" | "side-panel";
    /** "grid" — the classic 4-column label-over-value demographics grid.
     *  "table" — the premium label : value table.
     *  "stacked" — letterhead-style lines (name, age/sex, UHID, ref dr). */
    patientBlockStyle: "grid" | "table" | "stacked";
    pageMargins: string;
  };
}

const BASE_FONT = "'Segoe UI', Helvetica, Arial, sans-serif";

export const PRESENTATION_TEMPLATES: PresentationTemplate[] = [
  {
    id: "care-classic",
    name: "CARE Classic",
    description: "CARE letterhead with stacked demographics and key images on the right (letter-pad).",
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
    layout: { imagePlacement: "side-panel", patientBlockStyle: "stacked", pageMargins: "12mm 14mm" },
  },
  {
    id: "care-premium",
    name: "CARE Premium",
    description: "CARE letter-pad header and footer, report left, key images on the right.",
    typography: {
      header: { fontFamily: BASE_FONT, fontSize: "18pt", color: "#1e1b4b", fontWeight: "700", letterSpacing: "0.04em" },
      patientBlock: { fontFamily: BASE_FONT, fontSize: "8.5pt" },
      studyTitle: { fontFamily: BASE_FONT, fontSize: "12pt", color: "#1e3a8a", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase" },
      sectionHeading: { fontFamily: BASE_FONT, fontSize: "9.5pt", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase" },
      body: { fontFamily: BASE_FONT, fontSize: "10pt", color: "#0f172a" },
      footer: { fontFamily: BASE_FONT, fontSize: "7.5pt", color: "#334155" },
      signature: { fontFamily: BASE_FONT, fontSize: "10pt" },
      imagePanel: { fontFamily: BASE_FONT, fontSize: "7pt" },
    },
    palette: {
      headerBg: "#ffffff", headerText: "#1e1b4b", accent: "#1e3a8a",
      sectionBg: "#f8fafc", sectionBorder: "#cbd5e1",
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

/** Format YYYYMMDD or ISO dates for report headers. */
export function formatReportDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) {
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const mi = parseInt(m, 10) - 1;
    if (mi >= 0 && mi < 12) {
      const d = new Date(parseInt(y, 10), mi, parseInt(day, 10));
      if (!Number.isNaN(d.getTime())) {
        const weekday = d.toLocaleDateString("en-IN", { weekday: "long" });
        return `${weekday}, ${months[mi]} ${parseInt(day, 10)}, ${y}`;
      }
    }
    return `${day}/${m}/${y}`;
  }
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    }
  } catch { /* fall through */ }
  return raw;
}

/** Letter-pad DATE line: DD/MM/YYYY (matches generateReportPDF). */
export function formatReportDateShort(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(6, 8)}/${digits.slice(4, 6)}/${digits.slice(0, 4)}`;
  }
  try {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}/${d.getFullYear()}`;
    }
  } catch { /* fall through */ }
  return trimmed;
}

function rowByLabel(rows: ReportPatientRow[], ...labels: string[]): string {
  const wanted = labels.map((l) => l.toLowerCase());
  const hit = rows.find((r) => wanted.includes(r.label.toLowerCase()));
  return hit?.value?.trim() ?? "";
}

function stackedPatientBlockHtml(rows: ReportPatientRow[], pal: PresentationTemplate["palette"]): string {
  const name = rowByLabel(rows, "patient", "name");
  const ageSex = rowByLabel(rows, "age / sex", "age/sex", "age", "sex");
  const uhid = rowByLabel(rows, "uhid", "patient id", "patient id / uhid");
  const studyDate = rowByLabel(rows, "study date", "date");
  const refDr = rowByLabel(rows, "referring doctor", "ref. doctor", "ref by", "ref. by");
  const accession = rowByLabel(rows, "accession no.", "accession", "accession number");
  const testName = rowByLabel(rows, "test", "test name");

  const lines: string[] = [];
  if (name) lines.push(`<div class="ps-name">${escapeHtml(name)}</div>`);
  const meta1 = [ageSex ? `Age/Sex: ${escapeHtml(ageSex)}` : "", studyDate ? `Date: ${escapeHtml(studyDate)}` : ""].filter(Boolean).join(" &nbsp;&nbsp; ");
  if (meta1) lines.push(`<div class="ps-line">${meta1}</div>`);
  const meta2 = [uhid ? `UHID: ${escapeHtml(uhid)}` : "", refDr ? `Ref. By: ${escapeHtml(refDr)}` : ""].filter(Boolean).join(" &nbsp;&nbsp; ");
  if (meta2) lines.push(`<div class="ps-line">${meta2}</div>`);
  const meta3 = [accession ? `Accession: ${escapeHtml(accession)}` : "", testName ? `Test: ${escapeHtml(testName)}` : ""].filter(Boolean).join(" &nbsp;&nbsp; ");
  if (meta3) lines.push(`<div class="ps-line">${meta3}</div>`);

  if (lines.length === 0) {
    return rows.filter((r) => r.value).map((r) => `<div class="ps-line"><strong>${escapeHtml(r.label)}:</strong> ${escapeHtml(r.value)}</div>`).join("");
  }

  return `<div class="patient-stacked" style="--ps-label:${pal.labelColor};--ps-value:${pal.valueColor}">${lines.join("")}</div>`;
}

/** CARE letter-pad demography: NAME | AGE/SEX, REFD. BY | DATE (matches jsPDF). */
function letterpadPatientBlockHtml(rows: ReportPatientRow[]): string {
  const name = rowByLabel(rows, "patient", "name");
  const ageSex = rowByLabel(rows, "age / sex", "age/sex");
  const refDr = rowByLabel(rows, "referring doctor", "ref. doctor", "ref by", "ref. by", "refd. by");
  const dateRaw = rowByLabel(rows, "study date", "date");
  const dateStr = formatReportDateShort(dateRaw) || dateRaw;
  const cell = (label: string, value: string) =>
    value
      ? `<strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}`
      : "";
  return `<table class="letterpad-demo">
    <tr>
      <td class="ld-left">${cell("NAME:", name)}</td>
      <td class="ld-right">${cell("AGE/SEX:", ageSex)}</td>
    </tr>
    <tr>
      <td class="ld-left">${cell("REFD. BY:", refDr)}</td>
      <td class="ld-right">${cell("DATE:", dateStr)}</td>
    </tr>
  </table>
  <div class="letterpad-demo-rule"></div>`;
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

function keyImagesHtml(
  images: ReportKeyImageModel[],
  placement: "inline" | "side-panel",
  opts: { heading?: string; extraClass?: string } = {},
): string {
  if (images.length === 0) return "";
  const heading = opts.heading ?? (placement === "side-panel" ? "KEY IMAGES" : "SELECTED IMAGES");
  const useViewport = placement === "side-panel";
  const cells = [...images]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((img, i) => {
      const alt = escapeHtml(img.caption || `Image ${i + 1}`);
      const sop = img.sopInstanceUid ? ` data-sop-instance-uid="${escapeHtml(img.sopInstanceUid)}"` : "";
      const badge = img.isKeyImage ? `<span class="key-image-badge">★ KEY</span>` : "";
      const imgTag = useViewport
        ? `<div class="image-viewport"><div class="image-framed" style="${framingInlineStyle(img.framing)};${framingImgInline(img.framing)}"><img src="${img.src}" class="dicom-img" alt="${alt}" /></div></div>`
        : `<img src="${img.src}" class="dicom-img" alt="${alt}" />`;
      return `
        <figure class="image-cell"${sop}>
          ${badge}${imgTag}
          <figcaption class="image-caption">${alt}</figcaption>
        </figure>`;
    })
    .join("");
  const sideCls = placement === "side-panel" ? "image-panel-side image-panel-keyrail" : "image-panel-inline";
  const countAttr = placement === "side-panel" ? ` data-image-count="${images.length}"` : "";
  return `
      <div class="image-panel ${sideCls}${opts.extraClass ? ` ${opts.extraClass}` : ""}"${countAttr}>
        <div class="image-panel-heading">${heading}</div>
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
  headerCfg?: {
    show: boolean;
    showLogo: boolean;
    showTagline: boolean;
    showContact: boolean;
    style: "banded" | "underlined";
    /** Clinic Style settings / template override for logo placement in the letterhead. */
    logoPosition?: "left" | "center" | "right";
  };
  studyTitleCfg?: { style: "bar" | "plain" };
  signatureCfg?: {
    show: boolean;
    showImage: boolean;
    /** Horizontal alignment of the signature block(s). */
    align?: "left" | "center" | "right";
  };
  footerCfg?: { show: boolean };
  imagePanelCfg?: { placement: "inline" | "side-panel"; panelWidthMm: number };
  watermarkCfg?: { enabled: boolean; text: string };
  qrCfg?: { show: boolean };
  pageBreaks?: { orphans: number; widows: number };
  spacingCfg?: { lineHeight?: string; sectionGap?: string };
  impressionTypography?: SlotTypography;
  bodyLineHeight?: string;
  bodyTextAlign?: string;
  letterhead?: CareLetterheadChrome;
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
  const letterPad = usesCareLetterpad(template);
  const pad = resolveLetterheadChrome(template);
  const banded = template.headerCfg ? template.headerCfg.style === "banded" : pal.headerBg !== "#ffffff";
  const titleBar = template.studyTitleCfg ? template.studyTitleCfg.style === "bar" : banded;
  const headerCfg = template.headerCfg ?? { show: true, showLogo: true, showTagline: true, showContact: true, style: banded ? "banded" as const : "underlined" as const };
  const signatureCfg = template.signatureCfg ?? { show: true, showImage: true };
  const footerCfg = template.footerCfg ?? { show: true };
  const logoPosition = letterPad ? "left" : (headerCfg.logoPosition ?? "left");
  const signatureAlign = signatureCfg.align ?? "right";
  const sigJustify =
    signatureAlign === "left" ? "flex-start" : signatureAlign === "center" ? "center" : "flex-end";
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
  const patientBlockHtml = letterPad
    ? letterpadPatientBlockHtml(visibleRows)
    : template.layout.patientBlockStyle === "stacked"
    ? stackedPatientBlockHtml(visibleRows, pal)
    : template.layout.patientBlockStyle === "grid"
    ? `<div class="patient-grid">${visibleRows
        .map((r) => `<div><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`)
        .join("")}</div>`
    : `<table class="patient-table"><tbody>${visibleRows
        .map((r) => `<tr><td class="pt-label">${escapeHtml(r.label)}</td><td class="pt-sep">:</td><td class="pt-value">${escapeHtml(r.value)}</td></tr>`)
        .join("")}</tbody></table>`;

  const criticalBanner = model.isCritical
    ? `<div class="critical">⚠ CRITICAL VALUE — IMMEDIATE ATTENTION REQUIRED${model.criticalNote ? `: ${escapeHtml(model.criticalNote)}` : ""}</div>`
    : "";

  const stampHtml = model.stamp.label
    ? `<div class="stamp ${model.stamp.kind}">${escapeHtml(model.stamp.label)}</div>`
    : "";

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
  const sortedImages = [...images].sort((a, b) => a.displayOrder - b.displayOrder);
  const railN = sidePanel ? sideRailCount(sortedImages.length) : 0;
  const railImages = sidePanel ? sortedImages.slice(0, railN) : [];
  const overflowImages = sidePanel ? sortedImages.slice(railN) : [];
  const railBlock = sidePanel ? keyImagesHtml(railImages, "side-panel") : "";
  const overflowBlock = overflowImages.length > 0
    ? keyImagesHtml(overflowImages, "inline", { heading: "KEY IMAGES (continued)", extraClass: "image-panel-overflow" })
    : "";
  const letterPadPhone = `Phone: ${pad.phones}`;
  const letterPadEmail = pad.email;
  const letterPadName = pad.clinicName;
  const letterPadLogo = headerCfg.showLogo ? careLetterheadLogoDataUrl() : "";
  const letterPadHeaderHtml = headerCfg.show ? `<div class="hdr">
      <div class="hdr-inner logo-pos-left letterpad-bill">
        ${letterPadLogo
          ? `<img class="logo" src="${letterPadLogo}" alt="${escapeHtml(letterPadName)}"/>`
          : `<div class="hdr-brand"><div class="name">${escapeHtml(letterPadName)}</div></div>`}
        <div class="contact letterpad-addr-right">
          ${escapeHtml(pad.addressLine1)}<br/>
          ${escapeHtml(pad.addressLine2)}<br/>
          ${escapeHtml(letterPadPhone)}<br/>
          Email: ${escapeHtml(letterPadEmail)}<br/>
          ${escapeHtml(pad.website)}
        </div>
      </div>
    </div>
    <hr class="hdr-rule" />` : "";
  const classicHeaderHtml = headerCfg.show ? `<div class="hdr">
      <div class="hdr-inner logo-pos-${logoPosition}">
        ${model.clinic.logoDataUrl && headerCfg.showLogo ? `<img class="logo" src="${model.clinic.logoDataUrl}" alt="logo"/>` : ""}
        <div class="hdr-brand">
          <div class="name">${escapeHtml(model.clinic.name)}</div>
          ${model.clinic.tagline && headerCfg.showTagline ? `<div class="tagline">${escapeHtml(model.clinic.tagline)}</div>` : ""}
        </div>
        ${headerCfg.showContact ? `<div class="contact">
          ${[model.clinic.phone, model.clinic.email].filter(Boolean).map((v) => escapeHtml(v!)).join(" • ")}<br/>
          ${model.clinic.website ? `${escapeHtml(model.clinic.website)}` : ""}
        </div>` : ""}
      </div>
    </div>
    ${model.clinic.address ? `<div class="hdr-address-bar">${escapeHtml(model.clinic.address)}</div>` : ""}
    <hr class="hdr-rule" />` : "";
  const letterPadFooterHtml = footerCfg.show ? `<div class="letterpad-footer-block">
    <div class="letterpad-services">${escapeHtml(pad.servicesRow1)}<br/>${escapeHtml(pad.servicesRow2)}</div>
    <div class="letterpad-disclaimer">${escapeHtml(pad.disclaimer)}</div>
  </div>` : "";
  const classicFooterHtml = footerCfg.show ? `<div class="ftr">${escapeHtml(model.footerNote ?? "")} • ${escapeHtml(model.typeLabel)} • ${escapeHtml(model.statusLabel)} • Generated ${escapeHtml(model.generatedAtLabel)}</div>` : "";
  const letterPadSignatures = model.signatures.filter((s) => s.name || s.imageDataUrl).length > 0
    ? model.signatures
    : [{ name: pad.radiologist, qualification: pad.credentials, label: "Signed:", whenLabel: "" }];

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
    @media screen {
      html, body { background: #94a3b8; }
      .report-wrapper {
        max-width: 210mm; min-height: 297mm; margin: 12px auto; padding: 0;
        box-shadow: 0 4px 24px rgba(15, 23, 42, 0.28);
      }
    }

    /* ── Header slot ── */
    .hdr {
      background: ${pal.headerBg};
      display: flex; align-items: center; gap: 14px;
      padding: ${!banded ? "12px 16px 10px" : "14px 20px 10px"};
      ${!banded ? `border-bottom: 2px solid ${pal.accent};` : ""}
      margin-bottom: ${!banded ? "0" : "0"};
      break-inside: avoid;
      position: relative;
      overflow: hidden;
    }
    .hdr::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 6px;
      background: linear-gradient(180deg, #0ea5e9 0%, #6366f1 55%, #14b8a6 100%);
      border-radius: 0 3px 3px 0;
    }
    .hdr-inner { display: flex; align-items: center; gap: 14px; width: 100%; padding-left: 8px; }
    .hdr-inner.logo-pos-center { flex-direction: column; align-items: center; text-align: center; gap: 8px; }
    .hdr-inner.logo-pos-center .hdr-brand { flex: 0 1 auto; text-align: center; }
    .hdr-inner.logo-pos-center .contact { margin-left: 0; text-align: center; width: 100%; }
    .hdr-inner.logo-pos-right { flex-direction: row-reverse; }
    .hdr-inner.logo-pos-right .hdr-brand { text-align: right; }
    .hdr-inner.logo-pos-right .contact { margin-left: 0; margin-right: auto; text-align: left; }
    .hdr-address-bar {
      font-size: 9.5px; color: #475569; text-align: center;
      border-bottom: none;
      padding: 4px 12px 6px; margin-bottom: 0;
      line-height: 1.45;
    }
    .hdr-rule {
      border: none;
      border-top: 2px solid ${pal.accent};
      margin: 2px 0 10px;
      height: 0;
    }
    .hdr-rule.hdr-rule-hidden { display: none; }
    .hdr img.logo { width: 64px; height: 64px; object-fit: contain; }
    .hdr .letterpad-bill img.logo { width: auto; height: 22mm; max-width: 65mm; object-fit: contain; object-position: left top; }
    .hdr .letterpad-bill .contact { flex: 1; font-size: 7.2pt; line-height: 3.1mm; color: #141414; text-align: right; margin-top: 4mm; }
    .hdr .hdr-brand { flex: 1; }
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
        ? `padding: 10px 0 8px; text-align: center; text-decoration: underline; text-underline-offset: 4px; letter-spacing: 0.04em;${letterPad ? " clear: both;" : ""}`
        : `background: ${pal.accent}; text-align: center; padding: 8px 20px; clear: both; text-decoration: none;`}
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
    .patient-stacked { line-height: 1.45; }
    .patient-stacked .ps-name { font-size: 13pt; font-weight: 800; color: ${pal.valueColor}; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.02em; }
    .patient-stacked .ps-line { font-size: 10pt; color: ${pal.valueColor}; margin: 2px 0; }

    /* ── Content area: report column + optional image side panel ── */
    .content-area { padding: ${!banded ? "0" : "0 20px"}; }
    ${sidePanel ? `
    /* TWO-COLUMN on screen AND print (A4 preview must match PDF).
       A large-screen-only CSS grid left print as a single column, so the
       image rail dropped below the report onto page 2 (blank left / stacked
       right). Chromium print also treats a tall grid item with unbreakable
       children as one box and shoves it to the next page. A table row keeps
       the 70/30 split starting on page 1; each .image-cell stays unsplit;
       square port size is capped by count so 1–6 images fit the first page
       without a float pagination bomb. */
    .content-area.has-side-images {
      display: table;
      width: 100%;
      table-layout: fixed;
      border-collapse: separate;
      border-spacing: 10px 0;
    }
    .content-area.has-side-images > .report-column {
      display: table-cell;
      vertical-align: top;
      width: 70%;
    }
    .content-area.has-side-images > .image-panel-side {
      display: table-cell;
      vertical-align: top;
      width: 30%;
      max-width: ${panelWidthMm}mm;
      margin: 0;
      page-break-inside: auto;
      break-inside: auto;
      height: auto;
      text-align: right;
    }
    .content-area.has-side-images + .sigs { margin-top: 12px; }
    @media print {
      .content-area.has-side-images { display: table; width: 100%; }
      .image-panel-side { position: static; width: 30%; }
      .content-area.has-side-images .image-panel-side .image-grid { flex-direction: column; }
      .content-area.has-side-images .image-panel-side .image-cell {
        page-break-inside: auto;
        break-inside: auto;
      }
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
    .image-panel-side .image-grid {
      display: flex;
      flex-direction: column;
      flex: 0 0 auto;
      gap: 6px;
      min-height: 0;
      align-items: stretch;
    }
    .image-panel-side.image-panel-keyrail {
      display: inline-flex;
      flex-direction: column;
      height: auto;
      min-height: 0;
      width: fit-content;
      max-width: 100%;
      margin-left: auto; /* extreme right within the side column (align with DATE edge) */
      text-align: left;
      box-sizing: border-box;
      align-self: start;
    }
    .image-panel-side .image-cell {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      width: min(100%, var(--ki-size, 48mm));
      max-width: 100%;
      aspect-ratio: 1 / 1;
      min-height: 0;
      align-self: flex-start;
      /* Allow the side rail to paginate with the report column. Avoid on every
         square cell made Chromium shove long classic reports to 3+ pages
         (Arhan / PREVIEW-19: 6 images + long findings). */
      break-inside: auto;
      page-break-inside: auto;
    }
    .image-panel-side .image-caption { padding: 1px 5px; font-size: 6.5px; flex-shrink: 0; display: none; }
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
    ${sidePanel ? `
    /* Square ports sized by count so 1–6 fit page 1 with the report body
       (full rail-width 1:1 cells overflow A4 and orphan the signature). */
    .image-panel-side[data-image-count="1"] { --ki-size: 48mm; }
    .image-panel-side[data-image-count="2"] { --ki-size: 40mm; }
    .image-panel-side[data-image-count="3"] { --ki-size: 32mm; }
    .image-panel-side[data-image-count="4"] { --ki-size: 26mm; }
    .image-panel-side[data-image-count="5"] { --ki-size: 22mm; }
    .image-panel-side[data-image-count="6"] { --ki-size: 18mm; }
    .image-viewport {
      position: relative; width: 100%; flex: 0 0 auto;
      aspect-ratio: 1 / 1; height: auto; min-height: 0;
      overflow: hidden; background: #000;
    }
    .image-viewport .image-framed {
      position: absolute; inset: 0;
      transform: translate(var(--img-ox, 0%), var(--img-oy, 0%)) scale(var(--img-zoom, 1));
      transform-origin: center center;
    }
    .image-viewport .dicom-img {
      width: 100%; height: 100%; max-height: none;
      object-fit: var(--img-fit, contain); object-position: center;
      display: block;
    }
    /* Extreme-right tight navy frame; square ports sized by --ki-size (no empty stretch). */` : ""}
    .image-panel-overflow { margin-top: 10px; }
    .image-caption {
      background: ${pal.accent}; color: #fff; font-weight: 600;
      padding: 2px 6px; letter-spacing: 0.05em; text-transform: uppercase;
    }

    /* ── Footer + signatures slots ── */
    .sigs { display: flex; gap: 30px; justify-content: ${sigJustify}; margin-top: 26px; break-inside: avoid; page-break-after: avoid; clear: both; }
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
    ${letterPad ? `
    .hdr { background: #fff; padding: 0; border: none; }
    .hdr::before { display: none; }
    .hdr-inner.letterpad-bill { align-items: flex-start; gap: 8mm; padding-left: 0; }
    .hdr img.logo { width: auto; height: 22mm; max-width: 65mm; object-fit: contain; }
    .hdr-rule { border-top: 0.35mm solid #141414; margin: 2mm 0 0; }
    .letterpad-addr { color: #111; font-size: 9.5px; text-align: center; padding: 2px 12px 0; }
    .letterpad-contact { color: #111; font-size: 9px; text-align: center; padding: 2px 12px 6px; }
    .image-panel-keyrail {
      background: #0f172a;
      color: #fff;
      /* Tight 2–3mm symmetrical frame around the image stack — no empty navy band */
      padding: 2.5mm;
      border: 0.35mm solid #3b82f6;
      border-radius: 3px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .image-panel-keyrail .image-panel-heading { color: #fff; border-bottom-color: #3b82f6; letter-spacing: 0.12em; margin-bottom: 4px; }
    .image-panel-keyrail .image-caption { background: #1e3a8a; }
    .image-panel-keyrail .image-grid { gap: 3px; width: fit-content; max-width: 100%; }
    .letterpad .signame { color: #b91c1c; font-size: 11pt; }
    .letterpad .reportno { display: none; }
    .letterpad-demo { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 2px 0 0; font-size: 11.5px; color: #111; text-transform: uppercase; }
    .letterpad-demo td { padding: 1px 0; vertical-align: top; }
    .letterpad-demo .ld-left { text-align: left; width: 62%; padding-right: 10px; overflow-wrap: anywhere; word-break: break-word; }
    .letterpad-demo .ld-right { text-align: right; width: 38%; white-space: nowrap; }
    .letterpad-demo-wrap { background: transparent; border: none; padding: 2px 0 0; border-radius: 0; margin-bottom: 0; }
    .letterpad .body { font-size: 11.5px; }
    .letterpad-demo-rule { border: none; border-top: 2.2px solid #111; border-bottom: 0.9px solid #111; height: 3.2px; margin: 6px 0 8px; }
    .letterpad-sheet { width: 100%; border-collapse: collapse; }
    .letterpad-sheet > thead > tr > td,
    .letterpad-sheet > tbody > tr > td,
    .letterpad-sheet > tfoot > tr > td { padding: 0; border: none; vertical-align: top; }
    .letterpad-services { background: #0f2d6e; color: #fff; text-align: center; padding: 6px 8px; font-size: 6.5px; font-weight: 700; letter-spacing: 0.04em; line-height: 1.45; margin-top: 14px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .letterpad-disclaimer { font-size: 7.5px; color: #334155; text-align: center; padding: 6px 12px 4px; font-style: italic; }
    .letterpad-footer-block { break-inside: avoid; page-break-inside: avoid; page-break-before: avoid; }
    ` : ""}

    /* ── Print rules (Phase 7: widows/orphans, no split images, no blank pages) ── */
    @media print {
      @page { size: ${pageSize}; margin: ${template.layout.pageMargins}; }
      .report-wrapper { max-width: 100%; }
      .no-print { display: none !important; }
      .image-cell, .sigs, .impression, .patient-section, .hdr, .letterpad-footer-block { page-break-inside: avoid; }
      .sigs { page-break-after: avoid; }
      .section-heading, .image-panel-heading { page-break-after: avoid; }
      body { orphans: ${orphans}; widows: ${widows}; }
    }
    ${opts.customCss ?? ""}
    ${letterPad ? letterPadErpPdfLockCss(pad) : ""}
  </style></head><body>
  <div class="report-wrapper${letterPad ? " letterpad" : ""}">
    ${model.safeguardWatermarkHtml ?? ""}
    ${draftWatermark}
    ${templateWatermark}
    ${letterPad ? `<table class="letterpad-sheet"><thead><tr><td>
    ${letterPadHeaderHtml}
    <div class="patient-section letterpad-demo-wrap">${patientBlockHtml}</div>
    </td></tr></thead><tbody><tr><td>` : `${classicHeaderHtml}
    <span class="reportno">Report #: ${escapeHtml(model.reportNumber)}</span>
    <div class="patient-section">${patientBlockHtml}</div>`}
    <div class="study-title-bar">${escapeHtml(model.studyTitle)}</div>
    ${model.safeguardBannerHtml ?? ""}
    ${criticalBanner}
    <div class="content-area${sidePanel ? " has-side-images" : ""}">
      <div class="report-column">
        ${model.impression ? `<div class="impression"><strong>Impression:</strong> ${escapeHtml(model.impression)}</div>` : ""}
        ${parametersHtml(model.parameters)}
        ${bodyHtml}
        ${!sidePanel ? imagesBlock : ""}
        ${stampHtml}
      </div>
      ${sidePanel ? railBlock : ""}
    </div>
    ${overflowBlock}
    ${signatureCfg.show ? `<div class="sigs">${signaturesHtml(letterPad ? letterPadSignatures : model.signatures, signatureCfg.showImage)}</div>` : ""}
    ${qrHtml}
    ${letterPad ? `</td></tr></tbody><tfoot><tr><td>${letterPadFooterHtml}</td></tr></tfoot></table>` : classicFooterHtml}
  </div>
  ${model.autoPrint ? `<script>window.onload=()=>{setTimeout(()=>window.print(),250);}</script>` : ""}
  </body></html>`;
}
