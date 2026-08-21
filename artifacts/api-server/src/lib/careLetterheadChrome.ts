/**
 * CARE Diagnostics letter-pad chrome — the printed-pad logo + St. Francis
 * address that Classic/Premium reports use.
 *
 * Lives in its own module so presentation-template seeds can pin the same
 * object the renderer reads, without a reportPresentation ↔ seeds cycle.
 * Radiology Settings → Report Style templates own these fields; clinic CRM
 * and the Report Letterhead Size dropdown do not.
 */

export const CARE_LETTERPAD = {
  kind: "care-letterpad" as const,
  clinicName: "CARE DIAGNOSTICS",
  /** Same wrap as generateReportPDF (jsPDF split of the printed pad). */
  addressLine1: "Near Bajla Mahila College, St. Francis School Road, Castair's Town, DEOGHAR-814 112",
  addressLine2: "(JHARKHAND)",
  address: "Near Bajla Mahila College, St. Francis School Road, Castair's Town, DEOGHAR-814 112 (JHARKHAND)",
  phones: "75490 99099, 99734 97200",
  email: "care.deoghar@gmail.com",
  website: "www.caredeoghar.com",
  logoHeight: "22mm",
  addressFontSize: "7.2pt",
  logoSrc: "/care-diagnostics-letterhead-logo.png",
  radiologist: "Dr. Sugandha Priyadarshini",
  credentials: "MD (Radiodiagnosis & Medical Imaging)",
  servicesRow1: "MULTI SLICE CT SCAN  |  3D/4D ULTRA SOUND  |  COLOUR DOPPLER  |  MAMMOGRAPHY  |  ECHO  |  DIGITAL X-RAY  |  ECG/EEG",
  servicesRow2: "PATHOLAB  |  OPG  |  TMT  |  NCV/EMG  |  ELASTOGRAPHY/ FIBROSCAN  |  UPPER GI ENDOSCOPY  |  HSG  |  BARIUM STUDY  |  TVS",
  disclaimer: "Radiological diagnosis is not always conclusive & often vary with clinical course of the disease or response to treatment. This report is not for medico-legal purpose.",
} as const;

/** Template-definition subset (no logoSrc / combined address — those stay renderer-only). */
export const CARE_LETTERPAD_TEMPLATE_FIELDS = {
  kind: CARE_LETTERPAD.kind,
  clinicName: CARE_LETTERPAD.clinicName,
  addressLine1: CARE_LETTERPAD.addressLine1,
  addressLine2: CARE_LETTERPAD.addressLine2,
  phones: CARE_LETTERPAD.phones,
  email: CARE_LETTERPAD.email,
  website: CARE_LETTERPAD.website,
  logoHeight: CARE_LETTERPAD.logoHeight,
  addressFontSize: CARE_LETTERPAD.addressFontSize,
  radiologist: CARE_LETTERPAD.radiologist,
  credentials: CARE_LETTERPAD.credentials,
  servicesRow1: CARE_LETTERPAD.servicesRow1,
  servicesRow2: CARE_LETTERPAD.servicesRow2,
  disclaimer: CARE_LETTERPAD.disclaimer,
} as const;

export type CareLetterheadChrome = {
  kind?: "care-letterpad" | "clinic";
  clinicName?: string;
  addressLine1?: string;
  addressLine2?: string;
  phones?: string;
  email?: string;
  website?: string;
  logoHeight?: string;
  addressFontSize?: string;
  radiologist?: string;
  credentials?: string;
  servicesRow1?: string;
  servicesRow2?: string;
  disclaimer?: string;
};

/** CARE defaults overlaid with template.letterhead — literals widen to string. */
export type ResolvedLetterheadChrome = {
  [K in keyof typeof CARE_LETTERPAD]: K extends "kind" ? "care-letterpad" | "clinic" : string;
};

export function resolveLetterheadChrome(template: { id?: string; letterhead?: CareLetterheadChrome }): ResolvedLetterheadChrome {
  const overlay = template.letterhead ?? {};
  return { ...CARE_LETTERPAD, ...overlay, kind: overlay.kind ?? CARE_LETTERPAD.kind };
}

export function usesCareLetterpad(template: { id?: string; letterhead?: { kind?: string } }): boolean {
  if (template.letterhead?.kind === "clinic") return false;
  if (template.letterhead?.kind === "care-letterpad") return true;
  return template.id === "care-premium" || template.id === "care-classic";
}

/**
 * Letter-pad header metrics from the presentation template (Settings Center).
 * Appended after Style/letterhead-scale CSS so Classic/Premium keep the ERP PDF
 * wordmark unless the template itself changes logoHeight / addressFontSize.
 */
export function letterPadErpPdfLockCss(chrome: CareLetterheadChrome = CARE_LETTERPAD): string {
  const logoH = chrome.logoHeight || CARE_LETTERPAD.logoHeight;
  const addrPt = chrome.addressFontSize || CARE_LETTERPAD.addressFontSize;
  return `
    /* Presentation-template letter-pad header (Radiology Settings → Report Style) */
    @page { margin: 8mm 14mm 12mm 14mm !important; }
    .letterpad .hdr {
      padding: 0 !important;
      gap: 0 !important;
      background: #fff !important;
      border: none !important;
      border-bottom: none !important;
      align-items: flex-start !important;
      overflow: visible !important;
    }
    .letterpad .hdr::before { display: none !important; }
    .letterpad .hdr-inner,
    .letterpad .hdr-inner.letterpad-bill {
      display: flex !important;
      flex-direction: row !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      gap: 8mm !important;
      width: 100% !important;
      padding: 0 !important;
    }
    .letterpad .hdr img.logo,
    .letterpad .letterpad-bill img.logo {
      width: auto !important;
      height: ${logoH} !important;
      max-width: 65mm !important;
      max-height: ${logoH} !important;
      object-fit: contain !important;
      object-position: left top !important;
    }
    .letterpad .hdr .contact,
    .letterpad .letterpad-bill .contact,
    .letterpad .letterpad-addr-right {
      max-width: none !important;
      width: auto !important;
      flex: 1 1 auto !important;
      margin: 4mm 0 0 0 !important;
      text-align: right !important;
      font-family: Helvetica, Arial, sans-serif !important;
      font-size: ${addrPt} !important;
      line-height: 3.1mm !important;
      font-weight: 400 !important;
      color: #141414 !important;
      text-transform: none !important;
      letter-spacing: 0 !important;
    }
    .letterpad .hdr-rule {
      display: block !important;
      border: none !important;
      border-top: 0.35mm solid #141414 !important;
      margin: 2mm 0 0 !important;
      height: 0 !important;
    }
    .letterpad .letterpad-demo-wrap { padding: 3.5mm 0 0 !important; }
    .letterpad .letterpad-demo {
      font-family: Helvetica, Arial, sans-serif !important;
      font-size: 9.5pt !important;
      color: #000 !important;
      table-layout: fixed !important;
      width: 100% !important;
    }
    .letterpad .letterpad-demo .ld-right { text-align: right !important; white-space: nowrap !important; width: 38% !important; }
    .letterpad .letterpad-demo .ld-left { text-align: left !important; width: 62% !important; overflow-wrap: anywhere !important; }
    .letterpad .body { font-size: 10pt !important; }
  `;
}
