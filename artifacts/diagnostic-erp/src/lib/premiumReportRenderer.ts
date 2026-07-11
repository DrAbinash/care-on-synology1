/**
 * premiumReportRenderer.ts
 * Premium Radiology Report Renderer — Care Diagnostics
 *
 * Builds a publication-quality HTML report from existing report data.
 * Called from RadiologyReportGenerator.tsx (RadiologyReportUnified was removed in M1.1).
 * Does NOT modify any database, schema, or existing API.
 * Is purely a presentation transformation layer.
 */

export type PremiumReportData = {
  // Patient demographics
  patientName: string;
  age?: string | null;
  sex?: string | null;
  uhid?: string | null;
  accessionNumber: string;
  studyDate?: string | null;
  studyTime?: string | null;
  referringDoctor?: string | null;
  reportingDoctor?: string | null;
  modality: string;
  studyDescription?: string | null;
  machineName?: string | null;
  // Report content (raw text from existing editor)
  clinicalHistory?: string | null;
  technique?: string | null;
  findings?: string | null;
  impression?: string | null;
  recommendation?: string | null;
  comparison?: string | null;
  // Images
  keyImages?: PremiumKeyImage[];
  // Signature
  signedByName?: string | null;
  signedByQualification?: string | null;
  signedByRegistration?: string | null;
  signedByImageUrl?: string | null;
  signedAt?: string | null;
  reportNumber?: string | null;
  // Verification
  qrDataUrl?: string | null;
  publicToken?: string | null;
};

export type PremiumKeyImage = {
  dataUrl: string;          // base64 or blob URL
  caption: string;          // e.g. "T2 Axial", "FLAIR", "DWI"
  sequenceName?: string;
  imageNumber?: string;
  sortOrder?: number;
};

export type PremiumTheme = "classic" | "modern" | "journal" | "premium" | "minimal";

export type PremiumRenderOptions = {
  theme: PremiumTheme;
  showImagePanel: boolean;
  maxImagesPerPage: number;   // default 8
  logoDataUrl?: string | null;
  clinicName: string;
  clinicTagline?: string | null;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
  enableQrVerification: boolean;
  enableDigitalSignature: boolean;
  enableStructuredFindings: boolean;
  enableWatermark: boolean;
  watermarkText?: string;
};

export const DEFAULT_PREMIUM_OPTIONS: PremiumRenderOptions = {
  theme: "modern",
  showImagePanel: true,
  maxImagesPerPage: 8,
  clinicName: "CARE DIAGNOSTICS",
  enableQrVerification: true,
  enableDigitalSignature: true,
  enableStructuredFindings: true,
  enableWatermark: false,
};

// ── Theme palettes ─────────────────────────────────────────────────────────────

const THEMES: Record<PremiumTheme, {
  headerBg: string; headerText: string; accent: string; sectionBg: string;
  sectionBorder: string; labelColor: string; valueColor: string;
  bodyFont: string; headingFont: string; impressionBg: string;
}> = {
  classic: {
    headerBg: "#1a1a2e", headerText: "#ffffff", accent: "#c9a96e",
    sectionBg: "#f8f7f4", sectionBorder: "#c9a96e",
    labelColor: "#555555", valueColor: "#111111",
    bodyFont: "Georgia, 'Times New Roman', serif",
    headingFont: "Georgia, 'Times New Roman', serif",
    impressionBg: "#fff8ee",
  },
  modern: {
    headerBg: "#0f172a", headerText: "#ffffff", accent: "#3b82f6",
    sectionBg: "#f8fafc", sectionBorder: "#3b82f6",
    labelColor: "#64748b", valueColor: "#0f172a",
    bodyFont: "'Segoe UI', Helvetica, Arial, sans-serif",
    headingFont: "'Segoe UI', Helvetica, Arial, sans-serif",
    impressionBg: "#eff6ff",
  },
  journal: {
    headerBg: "#1c3a5e", headerText: "#ffffff", accent: "#e63946",
    sectionBg: "#fafafa", sectionBorder: "#1c3a5e",
    labelColor: "#444444", valueColor: "#111111",
    bodyFont: "Georgia, 'Times New Roman', serif",
    headingFont: "'Palatino Linotype', Georgia, serif",
    impressionBg: "#fff0f1",
  },
  premium: {
    headerBg: "#14213d", headerText: "#fca311", accent: "#fca311",
    sectionBg: "#fffdf7", sectionBorder: "#fca311",
    labelColor: "#5a4a3a", valueColor: "#14213d",
    bodyFont: "'Segoe UI', Helvetica, Arial, sans-serif",
    headingFont: "'Segoe UI', Helvetica, Arial, sans-serif",
    impressionBg: "#fff9ee",
  },
  minimal: {
    headerBg: "#ffffff", headerText: "#111111", accent: "#111111",
    sectionBg: "#ffffff", sectionBorder: "#dddddd",
    labelColor: "#777777", valueColor: "#111111",
    bodyFont: "Helvetica, Arial, sans-serif",
    headingFont: "Helvetica, Arial, sans-serif",
    impressionBg: "#f5f5f5",
  },
};

// ── Structure findings into labelled sections ──────────────────────────────────

export function structureFindings(raw: string): Array<{ heading: string; content: string }> {
  if (!raw?.trim()) return [];

  // Try to detect existing headings (ALL CAPS or Title Case followed by :)
  const sectionRe = /^([A-Z][A-Z\s\/\-]{2,}|[A-Z][a-z]+(?: [A-Z][a-z]+){0,3})\s*:/gm;
  const sections: Array<{ heading: string; content: string }> = [];
  const matches = [...raw.matchAll(sectionRe)];

  if (matches.length >= 2) {
    // Found existing structure — parse it
    matches.forEach((m, i) => {
      const start = m.index! + m[0].length;
      const end = matches[i + 1]?.index ?? raw.length;
      sections.push({
        heading: m[1].trim(),
        content: raw.slice(start, end).trim(),
      });
    });
    return sections;
  }

  // No structure found — return as single block
  return [{ heading: "FINDINGS", content: raw.trim() }];
}

// ── Auto-bold abnormalities ────────────────────────────────────────────────────

const BOLD_PATTERNS = [
  /\b(\d+\.?\d*\s*(?:mm|cm|cm²|mm²|mL|cc|x\s*\d+\.?\d*\s*(?:mm|cm)))\b/g,
  /\b(no\s+?abnormality|unremarkable|within normal limits|normal study)\b/gi,
  /\b(mass|lesion|tumor|cyst|nodule|effusion|collection|haemorrhage|hemorrhage|infarct|ischemia|oedema|edema|herniation|stenosis|occlusion|thrombus|abscess|empyema|carcinoma|malignancy|metastasis|metastases)\b/gi,
];

function autoBoldText(text: string): string {
  let result = text;
  for (const re of BOLD_PATTERNS) {
    result = result.replace(re, (_m, g) => `<strong>${g}</strong>`);
  }
  return result;
}

// ── Format impression as numbered list ────────────────────────────────────────

function formatImpression(raw: string): string {
  if (!raw?.trim()) return "";
  const lines = raw.split(/\n/).map(l => l.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  if (lines.length === 0) return "";
  return lines.map((line, i) =>
    `<div class="impression-item"><span class="impression-num">${i + 1}.</span> <strong>${line}</strong></div>`
  ).join("");
}

// ── Format date nicely ─────────────────────────────────────────────────────────

function niceDate(d?: string | null): string {
  if (!d) return "";
  if (/^\d{8}$/.test(d)) {
    return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
  }
  try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

function niceTime(t?: string | null): string {
  if (!t) return "";
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  return t;
}

// ── Main render function ───────────────────────────────────────────────────────

export function renderPremiumReport(data: PremiumReportData, opts: PremiumRenderOptions): string {
  const t = THEMES[opts.theme];
  const studyTitle = (data.studyDescription || `${data.modality} Study`).toUpperCase();
  const findingSections = opts.enableStructuredFindings
    ? structureFindings(data.findings || "")
    : [{ heading: "FINDINGS", content: data.findings || "" }];

  const showImages = opts.showImagePanel && (data.keyImages?.length ?? 0) > 0;
  const images = data.keyImages ?? [];

  // ── Patient info table ──
  const patientRows = [
    ["Patient Name", data.patientName || ""],
    ["Age / Sex", [data.age, data.sex].filter(Boolean).join(" / ") || ""],
    ["UHID", data.uhid || ""],
    ["Accession No.", data.accessionNumber],
    ["Study Date", niceDate(data.studyDate) + (data.studyTime ? " " + niceTime(data.studyTime) : "")],
    ["Modality", data.modality || ""],
    ["Machine", data.machineName || ""],
    ["Referring Doctor", data.referringDoctor || ""],
    ["Reporting Doctor", data.reportingDoctor || ""],
  ].filter(([, v]) => v);

  const patientTableHtml = `
    <table class="patient-table">
      <tbody>
        ${patientRows.map(([l, v]) => `
          <tr>
            <td class="pt-label">${l}</td>
            <td class="pt-sep">:</td>
            <td class="pt-value">${v}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;

  // ── Section builder ──
  const section = (heading: string, content: string, extra = "") =>
    content.trim() ? `
      <div class="report-section ${extra}">
        <div class="section-heading">${heading}</div>
        <div class="section-body">${content}</div>
      </div>` : "";

  // ── Findings sections ──
  const findingsHtml = findingSections.map(s => `
    <div class="findings-block">
      ${s.heading !== "FINDINGS" ? `<div class="findings-sub-heading">${s.heading}</div>` : ""}
      <div class="findings-text">${autoBoldText(s.content).replace(/\n/g, "<br>")}</div>
    </div>
  `).join("");

  // ── Image panel ──
  const imagePanelHtml = showImages ? `
    <div class="image-section">
      <div class="section-heading">REPRESENTATIVE IMAGES</div>
      <div class="image-grid">
        ${images.slice(0, opts.maxImagesPerPage).map((img, i) => `
          <div class="image-cell">
            <img src="${img.dataUrl}" class="dicom-img" alt="${img.caption}" loading="lazy" />
            <div class="image-caption">${img.caption || `Image ${i + 1}`}</div>
            ${img.imageNumber ? `<div class="image-num">Img: ${img.imageNumber}</div>` : ""}
          </div>
        `).join("")}
      </div>
      ${images.length > opts.maxImagesPerPage ? `
        <div class="image-overflow-note">
          + ${images.length - opts.maxImagesPerPage} more images on next page
        </div>
      ` : ""}
    </div>` : "";

  // ── Signature block ──
  const sigHtml = opts.enableDigitalSignature && data.signedByName ? `
    <div class="signature-block">
      ${data.signedByImageUrl ? `<img src="${data.signedByImageUrl}" class="sig-image" alt="Signature" />` : ""}
      <div class="sig-name">${data.signedByName}</div>
      ${data.signedByQualification ? `<div class="sig-qual">${data.signedByQualification}</div>` : ""}
      ${data.signedByRegistration ? `<div class="sig-reg">Reg. No. ${data.signedByRegistration}</div>` : ""}
      ${data.signedAt ? `<div class="sig-time">Signed: ${new Date(data.signedAt).toLocaleString("en-IN")}</div>` : ""}
    </div>` : "";

  const qrHtml = opts.enableQrVerification && data.qrDataUrl ? `
    <div class="qr-block">
      <img src="${data.qrDataUrl}" class="qr-img" alt="QR Verification" />
      <div class="qr-label">Scan to verify</div>
      ${data.reportNumber ? `<div class="qr-report-no">${data.reportNumber}</div>` : ""}
    </div>` : "";

  // ── Full HTML ──
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${studyTitle} — ${data.patientName}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: ${t.bodyFont};
    font-size: 10pt;
    color: ${t.valueColor};
    background: #ffffff;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .report-wrapper {
    max-width: 210mm;
    margin: 0 auto;
    padding: 0;
    background: #fff;
  }

  /* ── Header ── */
  .report-header {
    background: ${t.headerBg};
    color: ${t.headerText};
    padding: 14px 20px 10px;
    display: flex;
    align-items: center;
    gap: 16px;
    page-break-inside: avoid;
  }
  .header-logo {
    width: 60px;
    height: 60px;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: 4px;
  }
  .header-logo-placeholder {
    width: 56px;
    height: 56px;
    border: 2px solid ${t.accent};
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 8pt;
    color: ${t.accent};
    flex-shrink: 0;
    text-align: center;
    padding: 4px;
  }
  .header-text { flex: 1; }
  .clinic-name {
    font-family: ${t.headingFont};
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: ${t.headerText};
  }
  .clinic-tagline {
    font-size: 8pt;
    color: ${t.accent};
    margin-top: 2px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .clinic-contact {
    font-size: 7.5pt;
    color: ${t.headerText}cc;
    margin-top: 4px;
  }

  /* ── Study title ── */
  .study-title-bar {
    background: ${t.accent};
    color: #ffffff;
    text-align: center;
    padding: 8px 20px;
    font-family: ${t.headingFont};
    font-size: 12pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    page-break-inside: avoid;
  }
  ${opts.theme === "minimal" ? ".study-title-bar { background: #111; color: #fff; }" : ""}

  /* ── Patient info ── */
  .patient-section {
    border: 1.5px solid ${t.sectionBorder};
    border-top: none;
    background: ${t.sectionBg};
    padding: 10px 20px;
    page-break-inside: avoid;
  }
  .patient-table { width: 100%; border-collapse: collapse; }
  .patient-table tr { vertical-align: top; }
  .pt-label {
    font-size: 8.5pt;
    color: ${t.labelColor};
    font-weight: 600;
    width: 130px;
    padding: 1.5px 0;
    white-space: nowrap;
  }
  .pt-sep { width: 12px; color: ${t.labelColor}; padding: 1.5px 4px; }
  .pt-value { font-size: 8.5pt; color: ${t.valueColor}; padding: 1.5px 0; font-weight: 500; }

  /* ── Divider ── */
  .section-divider {
    height: 2px;
    background: linear-gradient(to right, ${t.accent}, transparent);
    margin: 0 20px;
  }

  /* ── Report body ── */
  .report-body {
    padding: 0 20px;
  }

  /* ── Section ── */
  .report-section { margin: 14px 0; page-break-inside: avoid; }
  .section-heading {
    font-family: ${t.headingFont};
    font-size: 9.5pt;
    font-weight: 700;
    color: ${t.accent};
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border-bottom: 1.5px solid ${t.sectionBorder};
    padding-bottom: 3px;
    margin-bottom: 6px;
  }
  .section-body {
    font-size: 10pt;
    color: ${t.valueColor};
    line-height: 1.65;
  }

  /* ── Findings sub-sections ── */
  .findings-block { margin-bottom: 8px; }
  .findings-sub-heading {
    font-size: 9pt;
    font-weight: 700;
    color: ${t.valueColor};
    margin-bottom: 2px;
    text-transform: capitalize;
  }
  .findings-text { font-size: 10pt; line-height: 1.65; }

  /* ── Impression ── */
  .impression-section {
    background: ${t.impressionBg};
    border-left: 4px solid ${t.accent};
    border-radius: 4px;
    padding: 10px 14px;
    margin: 14px 0;
    page-break-inside: avoid;
  }
  .impression-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 5px;
    font-size: 10pt;
    line-height: 1.55;
  }
  .impression-num {
    font-weight: 700;
    color: ${t.accent};
    flex-shrink: 0;
    min-width: 18px;
  }

  /* ── Images ── */
  .image-section { margin: 14px 0; page-break-inside: avoid; }
  .image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(85mm, 1fr));
    gap: 8px;
    margin-top: 8px;
  }
  .image-cell {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    background: #000;
    text-align: center;
    page-break-inside: avoid;
  }
  .dicom-img {
    width: 100%;
    height: 85mm;
    object-fit: contain;
    display: block;
    background: #000;
  }
  .image-caption {
    background: ${t.accent};
    color: #fff;
    font-size: 7pt;
    font-weight: 600;
    padding: 2px 6px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .image-num {
    font-size: 6.5pt;
    color: #888;
    padding: 1px 6px 3px;
    background: #f8f8f8;
  }
  .image-overflow-note {
    font-size: 8pt;
    color: #666;
    text-align: center;
    margin-top: 6px;
    font-style: italic;
  }

  /* ── Footer: Signature + QR ── */
  .report-footer {
    margin: 20px 20px 10px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    border-top: 1.5px solid ${t.sectionBorder};
    padding-top: 12px;
    page-break-inside: avoid;
  }
  .signature-block { flex: 1; }
  .sig-image {
    max-height: 40px;
    max-width: 140px;
    object-fit: contain;
    margin-bottom: 4px;
    display: block;
  }
  .sig-name { font-size: 10pt; font-weight: 700; color: ${t.valueColor}; }
  .sig-qual { font-size: 8pt; color: ${t.labelColor}; }
  .sig-reg { font-size: 7.5pt; color: ${t.labelColor}; }
  .sig-time { font-size: 7pt; color: #aaa; margin-top: 3px; }
  .qr-block { text-align: center; flex-shrink: 0; }
  .qr-img { width: 64px; height: 64px; display: block; margin: 0 auto; }
  .qr-label { font-size: 7pt; color: #999; margin-top: 2px; }
  .qr-report-no { font-size: 6.5pt; color: #bbb; }

  /* ── End of report ── */
  .end-of-report {
    text-align: center;
    font-size: 8pt;
    color: #aaa;
    padding: 8px 20px 14px;
    letter-spacing: 0.08em;
  }

  /* ── Watermark ── */
  ${opts.enableWatermark && opts.watermarkText ? `
  .report-wrapper::before {
    content: "${opts.watermarkText}";
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-45deg);
    font-size: 60pt;
    color: rgba(0,0,0,0.04);
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
  }` : ""}

  /* ── Print ── */
  @media print {
    @page { size: A4 portrait; margin: 10mm 12mm; }
    body { font-size: 9.5pt; }
    .report-wrapper { max-width: 100%; }
    .image-grid { grid-template-columns: repeat(auto-fill, minmax(75mm, 1fr)); }
    .dicom-img { height: 75mm; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
    .report-section { page-break-inside: avoid; }
    .impression-section { page-break-inside: avoid; }
    .image-cell { page-break-inside: avoid; }
    .report-footer { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="report-wrapper">

  <!-- HEADER -->
  <div class="report-header">
    ${opts.logoDataUrl
      ? `<img src="${opts.logoDataUrl}" class="header-logo" alt="${opts.clinicName} Logo" />`
      : `<div class="header-logo-placeholder">LOGO</div>`
    }
    <div class="header-text">
      <div class="clinic-name">${opts.clinicName}</div>
      ${opts.clinicTagline ? `<div class="clinic-tagline">${opts.clinicTagline}</div>` : ""}
      ${(opts.clinicAddress || opts.clinicPhone)
        ? `<div class="clinic-contact">${[opts.clinicAddress, opts.clinicPhone].filter(Boolean).join(" &nbsp;|&nbsp; ")}</div>`
        : ""}
    </div>
  </div>

  <!-- STUDY TITLE -->
  <div class="study-title-bar">${studyTitle}</div>

  <!-- PATIENT INFO -->
  <div class="patient-section">
    ${patientTableHtml}
  </div>

  <div class="section-divider"></div>

  <!-- REPORT BODY -->
  <div class="report-body">

    ${data.clinicalHistory?.trim()
      ? section("CLINICAL HISTORY", `<div>${data.clinicalHistory.replace(/\n/g, "<br>")}</div>`)
      : ""}

    ${data.technique?.trim()
      ? section("TECHNIQUE", `<div>${data.technique.replace(/\n/g, "<br>")}</div>`)
      : ""}

    ${data.comparison?.trim()
      ? section("COMPARISON", `<div>${data.comparison.replace(/\n/g, "<br>")}</div>`)
      : ""}

    <!-- FINDINGS -->
    ${findingSections.length > 0 ? `
    <div class="report-section">
      <div class="section-heading">FINDINGS</div>
      <div class="section-body">
        ${findingsHtml}
      </div>
    </div>` : ""}

    <!-- IMAGES (inline after findings) -->
    ${imagePanelHtml}

    <!-- IMPRESSION -->
    ${data.impression?.trim() ? `
    <div class="impression-section">
      <div class="section-heading" style="border-bottom-color:${t.accent}88;">IMPRESSION</div>
      <div class="section-body" style="margin-top:8px;">
        ${formatImpression(data.impression)}
      </div>
    </div>` : ""}

    ${data.recommendation?.trim()
      ? section("RECOMMENDATION", `<div>${data.recommendation.replace(/\n/g, "<br>")}</div>`)
      : ""}

  </div>

  <!-- FOOTER: SIGNATURE + QR -->
  <div class="report-footer">
    ${sigHtml}
    ${qrHtml}
  </div>

  <div class="end-of-report">— End of Report —</div>

</div>
</body>
</html>`;
}
