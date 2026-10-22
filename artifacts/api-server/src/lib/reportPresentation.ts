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

/**
 * `**emphasis**` / `__emphasis__` in a plain-text report field, folded into the
 * bold the printed page already uses. The two patterns are exactly the ones the
 * in-app PDF applies (`reportPdfGenerator.parseInlineMarkdown`), so one report
 * cannot print bold on the PDF and a literal `**` on the paper.
 *
 * Takes ALREADY-ESCAPED text: the only markup this introduces is the tag it writes
 * itself, which is why every call site escapes first rather than after.
 */
export function inlineEmphasisHtml(escaped: string): string {
  return escaped.replace(
    /\*\*([^*]+)\*\*|__([^_]+)__/g,
    (_whole, starRun: string | undefined, underscoreRun: string | undefined) =>
      `<strong>${starRun ?? underscoreRun}</strong>`,
  );
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

/**
 * The stable identity of a demographic field.
 *
 * Both fixed-label header blocks below used to find a value by matching the words
 * a producer happened to type into `label`. `patient-reports.ts` and
 * `radiology-report-generator.ts` build these arrays by hand, so rewording
 * "Study Date" to "Examination Date" silently dropped the examination date from
 * the printed header — no error, no test, a missing fact on a signed document.
 * A row may now declare which field it is, and the blocks read that first.
 */
export type ReportPatientFieldKey =
  | "patientName"
  | "ageSex"
  | "uhid"
  | "studyDate"
  | "referringDoctor"
  | "accessionNumber"
  | "testName"
  | "modality"
  | "reportDate"
  | "signedAt";

export interface ReportPatientRow {
  label: string;
  value: string;
  /** Which field this row IS. Absent on rows written before the contract. */
  key?: ReportPatientFieldKey;
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
  /** Why a cell has no pixels — "failed" means the fetch was ATTEMPTED and
   *  Orthanc refused/errored/oversized; "budget" means the export omitted it
   *  to stay loadable. Absent when src carries pixels. The reader/print say
   *  different things for the two, so a PACS fault is never mistaken for
   *  the report-image budget doing its job. */
  imageFetchStatus?: "failed" | "budget" | null;
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
  /**
   * The region this report documents, when it is not the region the booked
   * heading names. Produced by `reportedScopeNote()` in
   * `@workspace/report-quality` from the ADR-004 transition record — never from
   * report prose — and absent for every report that has never been re-regioned,
   * so those pages render exactly the bytes they rendered before.
   */
  reportingScopeNote?: string;
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
  /**
   * True when nothing on the record has authorized this document — a draft, a
   * preview of one, or a row whose signature has been withdrawn. The signature
   * slot then marks the page NOT SIGNED, and no name reaches the page from any
   * other source: not the clinic's signature register, not the letter-pad
   * chrome's configured radiologist, not this caller's defaults.
   *
   * Absent means "as before". A document that has no report row behind it (the
   * other generators' pages, the template samples) has nothing to authorize and
   * nothing to withhold, so it keeps drawing whatever block its caller passed.
   */
  signerUnsigned?: boolean;
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
    layout: { imagePlacement: "side-panel", patientBlockStyle: "stacked", pageMargins: "4mm 6mm" },
  },
  {
    id: "care-premium",
    name: "CARE Premium",
    description: "CARE letter-pad header and footer, report left, key images on the right.",
    typography: {
      header: { fontFamily: BASE_FONT, fontSize: "18pt", color: "#1e1b4b", fontWeight: "700", letterSpacing: "0.04em" },
      patientBlock: { fontFamily: BASE_FONT, fontSize: "8.5pt" },
      // No letter-spacing — wide tracking turns CLINICAL into C L I N I C A L in print.
      studyTitle: { fontFamily: BASE_FONT, fontSize: "12pt", color: "#1e3a8a", fontWeight: "700", textTransform: "uppercase" },
      sectionHeading: { fontFamily: BASE_FONT, fontSize: "9.5pt", fontWeight: "700", textTransform: "uppercase" },
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
    layout: { imagePlacement: "side-panel", patientBlockStyle: "table", pageMargins: "4mm 6mm" },
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

/** Year/month/day as written, or null when no such day exists. */
function asRealDate(y: number, m: number, d: number): { y: number; m: number; d: number } | null {
  // A study date outside this window is a misread, not history.
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return { y, m, d };
}

/**
 * Read the three shapes a study date arrives in: `2026-10-04` from the ERP,
 * `20261004` from DICOM, and `04/10/2026` typed into the Demography card in the
 * Reporting Workspace — a free-text field, and DD/MM/YYYY is how every report the
 * radiologist reads displays the date. Returns null for anything that would have to
 * be guessed, including a day that does not exist on the calendar.
 *
 * `reportPdfGenerator.ts` carries the browser's copy of this reading;
 * `reportStudyDate.test.ts` runs both over the same inputs so they cannot drift.
 */
function readStudyDate(raw: string): { y: number; m: number; d: number } | null {
  const typed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (typed) return asRealDate(Number(typed[3]), Number(typed[2]), Number(typed[1]));
  // Slashed and not DD/MM/YYYY: refuse rather than pick an order.
  if (raw.includes("/")) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) {
    return asRealDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
  }
  if (/[\s,-]/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
    }
  }
  return null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format a study date for report headers: "Sunday, October 4, 2026". */
export function formatReportDate(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const read = readStudyDate(trimmed);
  if (!read) return trimmed;
  const weekday = new Date(read.y, read.m - 1, read.d).toLocaleDateString("en-IN", { weekday: "long" });
  return `${weekday}, ${MONTH_NAMES[read.m - 1]} ${read.d}, ${read.y}`;
}

/** Letter-pad DATE line: DD/MM/YYYY (matches generateReportPDF). */
export function formatReportDateShort(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const read = readStudyDate(trimmed);
  if (!read) return trimmed;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(read.d)}/${pad(read.m)}/${read.y}`;
}

/**
 * Read one demographic field: by its stable key when the row declares one, else
 * by any of the display labels this block has always accepted.
 *
 * The label fallback deliberately skips every keyed row. A row that says it is
 * `reportDate` is not a candidate for the examination-date slot no matter what
 * its label reads — which is the whole defect: the signed builder emits one row
 * labelled "Date" carrying `patient_reports.created_at`, and matching on the word
 * "date" printed the report-writing day as the day of the scan.
 */
function rowByField(rows: ReportPatientRow[], key: ReportPatientFieldKey, ...labels: string[]): string {
  const keyed = rows.find((r) => r.key === key);
  if (keyed) return keyed.value?.trim() ?? "";
  const wanted = labels.map((l) => l.toLowerCase());
  const hit = rows.find((r) => !r.key && wanted.includes(r.label.toLowerCase()));
  return hit?.value?.trim() ?? "";
}

function stackedPatientBlockHtml(rows: ReportPatientRow[], pal: PresentationTemplate["palette"]): string {
  const name = rowByField(rows, "patientName", "patient", "name");
  const ageSex = rowByField(rows, "ageSex", "age / sex", "age/sex", "age", "sex");
  const uhid = rowByField(rows, "uhid", "uhid", "patient id", "patient id / uhid");
  const studyDate = rowByField(rows, "studyDate", "study date", "date");
  const refDr = rowByField(rows, "referringDoctor", "referring doctor", "ref. doctor", "ref by", "ref. by");
  const accession = rowByField(rows, "accessionNumber", "accession no.", "accession", "accession number");
  const testName = rowByField(rows, "testName", "test", "test name");

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

/** CARE letter-pad demography: NAME | AGE/SEX, REFD. BY | DATE, UHID | ACCESSION. */
function letterpadPatientBlockHtml(rows: ReportPatientRow[]): string {
  const name = rowByField(rows, "patientName", "patient", "name");
  const ageSex = rowByField(rows, "ageSex", "age / sex", "age/sex");
  const refDr = rowByField(rows, "referringDoctor", "referring doctor", "ref. doctor", "ref by", "ref. by", "refd. by");
  const dateRaw = rowByField(rows, "studyDate", "study date", "date");
  const dateStr = formatReportDateShort(dateRaw) || dateRaw;
  // The two identifiers that tie the sheet back to the study. Both arrive in
  // `rows` already — the block simply never drew them. A row whose value is the
  // route's own "no value" placeholder (an em dash) is absent, not blank: printing
  // "UHID: —" reads as an identifier to whoever receives the report.
  const blank = (v: string) => (/^[-–—.\s]*$/.test(v) ? "" : v);
  const uhid = blank(rowByField(rows, "uhid", "uhid", "patient id", "patient id / uhid"));
  const accession = blank(rowByField(rows, "accessionNumber", "accession no.", "accession", "accession number"));
  const cell = (label: string, value: string, boldValue = false) =>
    value
      ? `<strong>${escapeHtml(label)}</strong> ${boldValue ? `<strong>${escapeHtml(value)}</strong>` : escapeHtml(value)}`
      : "";
  const identifiers = uhid || accession
    ? `
    <tr>
      <td class="ld-left">${cell("UHID:", uhid)}</td>
      <td class="ld-right">${cell("ACCESSION:", accession)}</td>
    </tr>`
    : "";
  return `<table class="letterpad-demo">
    <tr>
      <td class="ld-left">${cell("NAME:", name, true)}</td>
      <td class="ld-right">${cell("AGE/SEX:", ageSex)}</td>
    </tr>
    <tr>
      <td class="ld-left">${cell("REFD. BY:", refDr)}</td>
      <td class="ld-right">${cell("DATE:", dateStr)}</td>
    </tr>${identifiers}
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

/**
 * The signature slot, drawn the same way on the letter-pad footer and on the
 * plain page.
 *
 * Both doors had the same hole from opposite directions: the plain page drew
 * whatever list it was handed, and the letter-pad substituted the chrome's own
 * configured radiologist whenever that list was empty — so an unsigned draft
 * printed "Signed: <name>" in the layout this clinic actually uses, which is
 * exactly the implication the DRAFT stamp above is there to avoid. A document
 * that declares itself unsigned gets the mark and no name, from either source.
 */
function signatureSlotHtml(
  model: ReportDocumentModel,
  signatures: ReportSignatureModel[],
  cfg: { show: boolean; showImage: boolean },
): string {
  if (!cfg.show) return "";
  if (model.signerUnsigned) return `<div class="sigs"><div class="signot">NOT SIGNED</div></div>`;
  return `<div class="sigs">${signaturesHtml(signatures, cfg.showImage)}</div>`;
}

function keyImagesHtml(
  images: ReportKeyImageModel[],
  placement: "inline" | "side-panel",
  opts: { heading?: string; extraClass?: string } = {},
): string {
  // Keep cells that have pixels OR a SOP uid (client hydrate fills empty src).
  // Drop rows with neither — those only paint blank navy boxes.
  const usable = images.filter((img) => {
    const src = String(img.src ?? "").trim();
    const hasPixels = src.length > 64 || src.startsWith("data:image/");
    return hasPixels || Boolean(img.sopInstanceUid?.trim());
  });
  if (usable.length === 0) return "";
  const heading = opts.heading ?? (placement === "side-panel" ? "KEY IMAGES" : "SELECTED IMAGES");
  const useViewport = placement === "side-panel";
  const cells = [...usable]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((img, cellIndex) => {
      // Captions are the radiologist's choice, so an absent one must leave no
      // trace: no element, no invented "Image N" label, no reserved strip.
      // Whitespace-only is treated as absent — a stray space typed into the
      // caption box would otherwise print an empty navy band.
      const caption = String(img.caption ?? "").trim();
      const alt = escapeHtml(caption);
      const sop = img.sopInstanceUid ? ` data-sop-instance-uid="${escapeHtml(img.sopInstanceUid)}"` : "";
      const badge = img.isKeyImage ? `<span class="key-image-badge">★ KEY</span>` : "";
      const src = String(img.src ?? "").trim();
      const pending = src.length <= 64 && !src.startsWith("data:image/");
      const imgTag = useViewport
        ? `<div class="image-viewport"><div class="image-framed" style="${framingInlineStyle(img.framing)};${framingImgInline(img.framing)}"><img src="${pending ? "" : src}" class="dicom-img${pending ? " dicom-img-pending" : ""}" alt="${alt}" /></div></div>`
        : `<img src="${pending ? "" : src}" class="dicom-img${pending ? " dicom-img-pending" : ""}" alt="${alt}" />`;
      // An attached image whose pixels could not be fetched used to print as a black
      // square with a caption over it — indistinguishable on paper from a legitimately
      // dark study. The letter-pad export says "IMAGE COULD NOT BE READ" for the same
      // cell (radiologyReportPdfExport.ts:131); one report must not say two different
      // things depending on which button was pressed. It is emitted only for a cell
      // that has no pixels and hides itself if pixels ever arrive for it.
      //
      // The no-pixels reason is kept honest: a cell the PACS refused is UNREADABLE
      // (investigate Orthanc); a cell the export BUDGET skipped was never fetched —
      // printing "could not be read" there would be a false accusation of the PACS.
      const budgetSkip = pending && img.imageFetchStatus === "budget";
      const unreadable = pending
        ? `<div class="image-unreadable" role="img" aria-label="${escapeHtml(budgetSkip ? `Key image #${cellIndex + 1} was omitted from this export (report image budget)` : `Key image #${cellIndex + 1} could not be read`)}">${budgetSkip ? "IMAGE NOT INCLUDED — EXPORT SIZE LIMIT" : "IMAGE COULD NOT BE READ"}</div>`
        : "";
      return `
        <figure class="image-cell${pending ? " image-cell-pending" : ""}"${sop}>
          ${badge}${imgTag}${unreadable}${caption ? `\n          <figcaption class="image-caption">${alt}</figcaption>` : ""}
        </figure>`;
    })
    .join("");
  const sideCls = placement === "side-panel" ? "image-panel-side image-panel-keyrail" : "image-panel-inline";
  const countAttr = placement === "side-panel" ? ` data-image-count="${usable.length}"` : "";
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

  /** A radiology impression is the clinical bottom line, so the sentence itself
   *  is bold, not just the label. Pathology reports keep the existing shape —
   *  their impression block carries structured sub-headings.
   *
   *  MODE A presentation contract: the impression and the plain-text body are the
   *  two fields a radiologist (or an accepted draft) can type markdown into, so
   *  emphasis is folded into the page's own bold rather than printed as `**`. */
  const impressionBlockHtml = model.impression
    ? model.typeLabel === "RADIOLOGY"
      ? `<div class="impression"><strong>Impression: ${inlineEmphasisHtml(escapeHtml(model.impression))}</strong></div>`
      : `<div class="impression"><strong>Impression:</strong> ${inlineEmphasisHtml(escapeHtml(model.impression))}</div>`
    : "";

  const bodyHtml = model.bodyHtml
    ? `<div class="body">${model.bodyHtml}</div>`
    : model.bodyText
      ? `<div class="body">${inlineEmphasisHtml(escapeHtml(model.bodyText))}</div>`
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
        ${headerCfg.showLogo
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
  const classicFooterHtml = footerCfg.show ? `<div class="ftr">${escapeHtml(model.footerNote ?? "")} • ${escapeHtml(model.typeLabel)} • ${escapeHtml(model.statusLabel)} • Generated ${escapeHtml(model.generatedAtLabel)}</div>` : "";
  const letterPadSignatures = model.signatures.filter((s) => s.name || s.imageDataUrl).length > 0
    ? model.signatures
    : [{ name: pad.radiologist, qualification: pad.credentials, label: "Signed:", whenLabel: "" }];
  // Letter-pad: signature sits in the footer block, immediately above the blue bar.
  const letterPadSigHtml = signatureSlotHtml(model, letterPadSignatures, signatureCfg);
  const letterPadFooterHtml = footerCfg.show ? `<div class="letterpad-footer-block">
    ${letterPadSigHtml}
    <div class="letterpad-services">${escapeHtml(pad.servicesRow1)}<br/>${escapeHtml(pad.servicesRow2)}</div>
    <div class="letterpad-disclaimer">${escapeHtml(pad.disclaimer)}</div>
  </div>` : letterPadSigHtml;

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
        max-width: 210mm; min-height: 297mm; margin: 0 auto; padding: 0;
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
    /* The booked heading stays the booked heading; this line states what the
       report documents when the radiologist recorded a different region. It is
       part of the page, not a screen affordance, so nothing may hide it on paper. */
    .reporting-scope-note {
      color: ${pal.labelColor};
      font-size: 10.5px;
      text-align: center;
      margin: 2px 0 8px;
      break-inside: avoid; break-after: avoid-page;
    }

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

    /* ── Findings tables (e.g. per-level canal diameters in spine reports) ── */
    .findings-table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 11px; white-space: normal; }
    .findings-table th { background: ${!banded ? "#1e1b4b" : pal.headerBg}; color: #fff; padding: 5px 7px; text-align: left; border: 1px solid ${pal.sectionBorder}; }
    .findings-table td { padding: 5px 7px; border: 1px solid ${pal.sectionBorder}; }
    .findings-table tr { break-inside: avoid; page-break-inside: avoid; }

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
      text-align: center;
      box-sizing: border-box;
      align-self: start;
      align-items: center; /* equal L/R navy around the image stack */
    }
    .image-panel-side .image-cell {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      width: var(--ki-size, 48mm);
      max-width: 100%;
      /* Height = the square .image-viewport plus any caption that exists. A 1/1
         ratio here left a caption zero space and overflow:hidden clipped it —
         that is why it used to be display:none. */
      min-height: 0;
      align-self: center;
      break-inside: auto;
      page-break-inside: auto;
    }
    .image-panel-side .image-caption {
      padding: 1px 5px; font-size: 6.5px; line-height: 1.3; flex-shrink: 0;
      /* Break a long unbroken series name inside the port instead of widening
         the rail and shifting the report column. */
      overflow-wrap: anywhere; word-break: break-word;
    }
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
    /* The missing-pixels tile, in the same words and the same colours the letter-pad
       export uses so one report cannot say two different things. Both of the rules
       that follow key off the src attribute, so a cell that is given pixels later
       shows the picture and drops the notice with no script keeping score. */
    .image-unreadable {
      display: flex; align-items: center; justify-content: center;
      min-height: 96px; padding: 6px;
      background: #e2e8f0; border: 1px solid #b91c1c; color: #b91c1c;
      font: 700 8px/1.2 system-ui, sans-serif; text-align: center;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .image-cell:has(img[src]):not(:has(img[src=""])) .image-unreadable { display: none; }
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
    /* A cell with no pixels has nothing to paint: without this the empty <img> and,
       in the rail, its navy square print above the notice. */
    .image-viewport .dicom-img[src=""], .dicom-img[src=""],
    .image-viewport:has(.dicom-img[src=""]) { display: none; }
    .image-caption {
      background: ${pal.accent}; color: #fff; font-weight: 600;
      padding: 2px 6px; letter-spacing: 0.05em;
      /* No text-transform: a caption is the radiologist's own sentence, not a
         field label. Upper-casing it turned a 146-character finding into a
         shouting block and made the printed words differ from the stored ones. */
    }

    /* ── Footer + signatures slots ── */
    .sigs { display: flex; gap: 30px; justify-content: ${sigJustify}; margin-top: 10px; break-inside: avoid; page-break-after: avoid; clear: both; }
    /* The absence of an authorization, printed where a name would have stood. */
    .signot { color: #991b1b; font-weight: 700; font-size: 11pt; }
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
      /* Equal 2.5mm frame on all sides — images centered in the navy rail */
      padding: 2.5mm;
      border: 0.35mm solid #3b82f6;
      border-radius: 3px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .image-panel-keyrail .image-panel-heading {
      color: #fff;
      border-bottom-color: #3b82f6;
      letter-spacing: 0;
      margin-bottom: 4px;
      width: 100%;
      text-align: center;
    }
    .image-panel-keyrail .image-caption { background: #1e3a8a; }
    .image-panel-keyrail .image-grid {
      gap: 3px;
      width: var(--ki-size, 48mm);
      max-width: 100%;
      align-items: center;
      margin: 0 auto;
    }
    .letterpad .signame { color: #b91c1c; font-size: 11pt; }
    .letterpad .reportno { display: none; }
    .letterpad-demo { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 2px 0 0; font-size: 11.5px; color: #111; text-transform: uppercase; }
    .letterpad-demo td { padding: 1px 0; vertical-align: top; }
    .letterpad-demo .ld-left { text-align: left; width: 62%; padding-right: 10px; overflow-wrap: anywhere; word-break: break-word; }
    .letterpad-demo .ld-right { text-align: right; width: 38%; white-space: nowrap; }
    .letterpad-demo-wrap { background: transparent; border: none; padding: 2px 0 0; border-radius: 0; margin-bottom: 0; }
    .letterpad .body { font-size: 11.5px; }
    .letterpad-demo-rule { border: none; border-top: 2.2px solid #111; border-bottom: 0.9px solid #111; height: 3.2px; margin: 2px 0 4px; }
    .letterpad-sheet { width: 100%; border-collapse: collapse; }
    .letterpad-sheet > thead > tr > td,
    .letterpad-sheet > tbody > tr > td,
    .letterpad-sheet > tfoot > tr > td { padding: 0; border: none; vertical-align: top; }
    .letterpad-services {
      background: #0a3282;
      color: #ffffff;
      text-align: center;
      /* Same strip height as before: smaller padding, larger type for print clarity */
      padding: 3px 6px;
      font-size: 8.5px;
      font-weight: 800;
      letter-spacing: 0.02em;
      line-height: 1.25;
      margin-top: 1mm;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .letterpad-disclaimer { font-size: 7px; color: #334155; text-align: center; padding: 2px 8px 1px; font-style: italic; }
    .letterpad-footer-block { break-inside: avoid; page-break-inside: avoid; page-break-before: avoid; }
    /* Signature flush above the blue services bar (right lowermost). */
    .letterpad .sigs {
      margin-top: 0;
      margin-bottom: 0.4mm;
      padding-top: 1mm;
      justify-content: flex-end;
      page-break-inside: avoid;
      page-break-before: avoid;
      break-before: avoid;
      clear: both;
      position: relative;
      z-index: 2;
    }
    .letterpad .sigbox { text-align: right; margin-left: auto; margin-bottom: 0; padding-bottom: 0; }
    .letterpad .sigline { display: none; }
    .letterpad .signame { letter-spacing: 0 !important; line-height: 1.15; }
    .letterpad .sigmeta { letter-spacing: 0 !important; word-spacing: normal !important; line-height: 1.15; margin: 0; }
    /* Stretch sheet so tfoot (signature + blue bar + disclaimer) sits at page bottom. */
    .letterpad-sheet { width: 100%; border-collapse: collapse; }
    @media print {
      /* Printable area ≈ 297mm − 4mm top − 3mm bottom */
      .letterpad-sheet { min-height: 290mm; height: 290mm; }
      .letterpad-sheet > tbody > tr > td { height: 100%; vertical-align: top; }
      .letterpad-sheet > tfoot > tr > td { vertical-align: bottom; padding-bottom: 0; }
      .letterpad-footer-block { margin-top: 0; margin-bottom: 0; }
      .letterpad-services { margin-top: 0.3mm; }
      .letterpad-disclaimer { padding: 1px 6px 0; }
    }
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
    ${model.reportingScopeNote ? `<div class="reporting-scope-note">${escapeHtml(model.reportingScopeNote)}</div>` : ""}
    ${model.safeguardBannerHtml ?? ""}
    ${criticalBanner}
    <div class="content-area${sidePanel ? " has-side-images" : ""}">
      <div class="report-column">
        ${impressionBlockHtml}
        ${parametersHtml(model.parameters)}
        ${bodyHtml}
        ${!sidePanel ? imagesBlock : ""}
        ${stampHtml}
      </div>
      ${sidePanel ? railBlock : ""}
    </div>
    ${overflowBlock}
    ${letterPad ? "" : signatureSlotHtml(model, model.signatures, signatureCfg)}
    ${qrHtml}
    ${letterPad ? `</td></tr></tbody><tfoot><tr><td>${letterPadFooterHtml}</td></tr></tfoot></table>` : classicFooterHtml}
  </div>
  ${model.autoPrint ? `<script>window.onload=()=>{setTimeout(()=>window.print(),250);}</script>` : ""}
  </body></html>`;
}
