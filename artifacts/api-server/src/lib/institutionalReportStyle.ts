/**
 * institutionalReportStyle.ts — maps clinic Style settings
 * (radiology_institutional_styles) onto the shared report renderer.
 *
 * Presentation only: produces a customCss fragment and shallow template
 * overrides (logo / signature / DICOM placement, fonts, heading decoration,
 * line gap, findings emphasis). Never touches clinical wording.
 */

import type { RenderableTemplate } from "./reportPresentation";

export const LOGO_POSITIONS = ["left", "center", "right"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export const SIGNATURE_POSITIONS = ["left", "center", "right"] as const;
export type SignaturePosition = (typeof SIGNATURE_POSITIONS)[number];

export const IMAGE_PLACEMENTS = ["inline", "side-panel", "end"] as const;
export type ImagePlacement = (typeof IMAGE_PLACEMENTS)[number];

export const HEADING_STYLES = ["plain", "bold", "underlined", "bold_underlined"] as const;
export type HeadingStyle = (typeof HEADING_STYLES)[number];

export const ABNORMAL_EMPHASIS = ["none", "bold_abnormal", "bold_impression", "bold_both"] as const;
export type AbnormalEmphasis = (typeof ABNORMAL_EMPHASIS)[number];

export const SPACING_PRESETS = ["compact", "standard", "comfortable"] as const;
export type SpacingPreset = (typeof SPACING_PRESETS)[number];

export const FONT_SIZE_PRESETS = ["small", "standard", "large"] as const;
export type FontSizePreset = (typeof FONT_SIZE_PRESETS)[number];

export const STUDY_TITLE_STYLES = ["plain", "underlined", "bar"] as const;
export type StudyTitleStyle = (typeof STUDY_TITLE_STYLES)[number];

/** Short keys stored in DB → CSS font-family stacks (approved / safe). */
export const REPORT_FONT_KEYS = {
  segoe: "'Segoe UI', Helvetica, Arial, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  arial: "Arial, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, serif",
  palatino: "'Palatino Linotype', Georgia, serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Geneva, sans-serif",
  courier: "'Courier New', Courier, monospace",
} as const;
export type ReportFontKey = keyof typeof REPORT_FONT_KEYS;

export interface InstitutionalReportStyle {
  headingStyle?: string | null;
  subheadingStyle?: string | null;
  abnormalEmphasis?: string | null;
  spacing?: string | null;
  lineGap?: string | null;
  printLayout?: string | null;
  margins?: string | null;
  fontSize?: string | null;
  fontFamily?: string | null;
  logoPosition?: string | null;
  signaturePosition?: string | null;
  imagePlacement?: string | null;
  studyTitleStyle?: string | null;
  showDigitalSignature?: boolean | null;
  showQrVerification?: boolean | null;
}

export function coerceLogoPosition(raw: unknown): LogoPosition {
  return LOGO_POSITIONS.includes(raw as LogoPosition) ? (raw as LogoPosition) : "left";
}

export function coerceSignaturePosition(raw: unknown): SignaturePosition {
  return SIGNATURE_POSITIONS.includes(raw as SignaturePosition) ? (raw as SignaturePosition) : "right";
}

export function coerceImagePlacement(raw: unknown): ImagePlacement {
  return IMAGE_PLACEMENTS.includes(raw as ImagePlacement) ? (raw as ImagePlacement) : "inline";
}

export function coerceHeadingStyle(raw: unknown): HeadingStyle {
  return HEADING_STYLES.includes(raw as HeadingStyle) ? (raw as HeadingStyle) : "underlined";
}

export function coerceAbnormalEmphasis(raw: unknown): AbnormalEmphasis {
  return ABNORMAL_EMPHASIS.includes(raw as AbnormalEmphasis) ? (raw as AbnormalEmphasis) : "bold_abnormal";
}

export function coerceSpacing(raw: unknown): SpacingPreset {
  return SPACING_PRESETS.includes(raw as SpacingPreset) ? (raw as SpacingPreset) : "standard";
}

export function coerceFontSize(raw: unknown): FontSizePreset {
  return FONT_SIZE_PRESETS.includes(raw as FontSizePreset) ? (raw as FontSizePreset) : "standard";
}

export function coerceStudyTitleStyle(raw: unknown): StudyTitleStyle {
  return STUDY_TITLE_STYLES.includes(raw as StudyTitleStyle) ? (raw as StudyTitleStyle) : "underlined";
}

export function coerceFontFamilyKey(raw: unknown): ReportFontKey {
  return raw != null && String(raw) in REPORT_FONT_KEYS ? (String(raw) as ReportFontKey) : "arial";
}

export function resolveFontFamilyCss(raw: unknown): string {
  return REPORT_FONT_KEYS[coerceFontFamilyKey(raw)];
}

const FONT_PX: Record<FontSizePreset, string> = {
  small: "11px",
  standard: "13px",
  large: "15px",
};

const MARGIN_CSS: Record<string, string> = {
  narrow: "14mm 10mm",
  standard: "14mm",
  wide: "20mm 25mm",
};

const LINE_HEIGHT: Record<SpacingPreset, string> = {
  compact: "1.25",
  standard: "1.45",
  comfortable: "1.7",
};

/** Gap between consecutive body lines / paragraphs. */
const LINE_GAP: Record<SpacingPreset, string> = {
  compact: "2px",
  standard: "8px",
  comfortable: "14px",
};

const SECTION_GAP: Record<SpacingPreset, string> = {
  compact: "6px",
  standard: "12px",
  comfortable: "18px",
};

function headingDecorationCss(style: HeadingStyle, selector: string): string {
  switch (style) {
    case "plain":
      return `
      ${selector} {
        font-weight: 500 !important;
        text-decoration: none !important;
        border-bottom: none !important;
      }`;
    case "bold":
      return `
      ${selector} {
        font-weight: 800 !important;
        text-decoration: none !important;
        border-bottom: none !important;
      }`;
    case "underlined":
      return `
      ${selector} {
        font-weight: 600 !important;
        text-decoration: underline !important;
        text-underline-offset: 3px !important;
        border-bottom: none !important;
      }`;
    case "bold_underlined":
    default:
      return `
      ${selector} {
        font-weight: 800 !important;
        text-decoration: underline !important;
        text-underline-offset: 3px !important;
        border-bottom: none !important;
      }`;
  }
}

function studyTitleCss(style: StudyTitleStyle): string {
  switch (style) {
    case "plain":
      return `
      .study-title-bar {
        text-decoration: none !important;
        background: transparent !important;
        clear: none !important;
      }`;
    case "bar":
      return `
      .study-title-bar {
        text-decoration: none !important;
      }`;
    case "underlined":
    default:
      return `
      .study-title-bar {
        text-decoration: underline !important;
        text-underline-offset: 4px !important;
        background: transparent !important;
      }`;
  }
}

function logoPositionCss(pos: LogoPosition): string {
  switch (pos) {
    case "center":
      return `
      .hdr-inner {
        flex-direction: column !important;
        align-items: center !important;
        text-align: center !important;
        gap: 8px !important;
      }
      .hdr-inner .hdr-brand { flex: 0 1 auto !important; text-align: center !important; }
      .hdr-inner .contact {
        margin-left: 0 !important;
        text-align: center !important;
        width: 100%;
      }`;
    case "right":
      return `
      .hdr-inner { flex-direction: row-reverse !important; }
      .hdr-inner .hdr-brand { text-align: right !important; }
      .hdr-inner .contact {
        margin-left: 0 !important;
        margin-right: auto !important;
        text-align: left !important;
      }`;
    case "left":
    default:
      return `
      .hdr-inner { flex-direction: row !important; }
      .hdr-inner .contact { margin-left: auto !important; text-align: right !important; }`;
  }
}

function signaturePositionCss(pos: SignaturePosition): string {
  const justify =
    pos === "left" ? "flex-start" : pos === "center" ? "center" : "flex-end";
  return `
      .sigs { justify-content: ${justify} !important; }`;
}

function findingsEmphasisCss(emphasis: AbnormalEmphasis): string {
  if (emphasis === "none") {
    return `
      .body strong, .body b, .impression strong, .impression b {
        font-weight: inherit !important;
      }
      .findings-abnormal, .abnormal-term {
        font-weight: inherit !important;
      }`;
  }
  const boldFindings = emphasis === "bold_abnormal" || emphasis === "bold_both";
  const boldImpression = emphasis === "bold_impression" || emphasis === "bold_both";
  return `
      ${boldFindings ? `
      .body .findings-abnormal, .body .abnormal-term, .body strong.findings-abnormal {
        font-weight: 800 !important;
      }` : `
      .body .findings-abnormal, .body .abnormal-term {
        font-weight: inherit !important;
      }`}
      ${boldImpression ? `
      .impression, .impression strong, .impression li {
        font-weight: 700 !important;
      }` : ""}`;
}

/**
 * Build the institutional customCss fragment appended last by renderReportDocument.
 * Always returns a string (may be empty when style is null).
 */
export function buildInstitutionalStyleCss(style: InstitutionalReportStyle | null | undefined): string {
  if (!style) return "";

  const spacing = coerceSpacing(style.lineGap ?? style.spacing);
  const fontSize = coerceFontSize(style.fontSize);
  const fontFamily = resolveFontFamilyCss(style.fontFamily);
  const heading = coerceHeadingStyle(style.headingStyle);
  const subheading = coerceHeadingStyle(style.subheadingStyle ?? style.headingStyle);
  const studyTitle = coerceStudyTitleStyle(style.studyTitleStyle);
  const logoPos = coerceLogoPosition(style.logoPosition);
  const sigPos = coerceSignaturePosition(style.signaturePosition);
  const abnormal = coerceAbnormalEmphasis(style.abnormalEmphasis);
  const marginVal = MARGIN_CSS[style.margins ?? "standard"] ?? MARGIN_CSS.standard;
  const fs = FONT_PX[fontSize];
  const lineHt = LINE_HEIGHT[spacing];
  const lineGap = LINE_GAP[spacing];
  const sectionGap = SECTION_GAP[spacing];

  let css = `
      /* Institutional report style overrides */
      @page { size: A4; margin: ${marginVal}; }
      body, .body {
        font-family: ${fontFamily} !important;
        font-size: ${fs} !important;
        line-height: ${lineHt} !important;
      }
      .hdr .name, .hdr .tagline, .hdr .contact,
      .patient-section, .study-title-bar, .section-heading,
      .impression, .sigbox, .ftr, .image-panel {
        font-family: ${fontFamily} !important;
      }
      .body p, .body div, .body li {
        margin-top: 0 !important;
        margin-bottom: ${lineGap} !important;
      }
      .section-heading, .image-panel-heading {
        margin-top: ${sectionGap} !important;
        margin-bottom: ${lineGap} !important;
      }
      ${headingDecorationCss(heading, ".section-heading")}
      ${headingDecorationCss(subheading, ".image-panel-heading, .body h3, .body h4, .subheading")}
      ${studyTitleCss(studyTitle)}
      ${logoPositionCss(logoPos)}
      ${signaturePositionCss(sigPos)}
      ${findingsEmphasisCss(abnormal)}
    `;

  if (style.printLayout === "half_page") {
    css += `
      body { height: 50% !important; border: 1px dashed #ccc !important; padding: 10px !important; }
    `;
  }

  return css;
}

/**
 * Shallow-clone a resolved template and apply institutional layout overrides
 * (DICOM image placement, signature visibility, QR). Does not mutate input.
 */
export function applyInstitutionalTemplateOverrides(
  template: RenderableTemplate,
  style: InstitutionalReportStyle | null | undefined,
): RenderableTemplate {
  if (!style) return template;

  const imagePlacement = coerceImagePlacement(style.imagePlacement);
  // "end" means after findings in normal document flow (= inline for renderer).
  const layoutPlacement = imagePlacement === "side-panel" ? "side-panel" : "inline";

  const next: RenderableTemplate = {
    ...template,
    layout: {
      ...template.layout,
      imagePlacement: layoutPlacement,
    },
    imagePanelCfg: {
      placement: layoutPlacement,
      panelWidthMm: template.imagePanelCfg?.panelWidthMm ?? 64,
    },
    headerCfg: {
      ...(template.headerCfg ?? {
        show: true,
        showLogo: true,
        showTagline: true,
        showContact: true,
        style: "underlined" as const,
      }),
      logoPosition: coerceLogoPosition(style.logoPosition),
    },
    signatureCfg: {
      show: template.signatureCfg?.show ?? true,
      showImage:
        style.showDigitalSignature === false
          ? false
          : (template.signatureCfg?.showImage ?? true),
      align: coerceSignaturePosition(style.signaturePosition),
    },
    studyTitleCfg: {
      style:
        coerceStudyTitleStyle(style.studyTitleStyle) === "bar"
          ? "bar"
          : "plain",
    },
    qrCfg: {
      show: style.showQrVerification === false ? false : (template.qrCfg?.show ?? true),
    },
    spacingCfg: {
      lineHeight: LINE_HEIGHT[coerceSpacing(style.lineGap ?? style.spacing)],
      sectionGap: SECTION_GAP[coerceSpacing(style.lineGap ?? style.spacing)],
    },
    bodyLineHeight: LINE_HEIGHT[coerceSpacing(style.lineGap ?? style.spacing)],
  };

  // When imagePlacement is "end", force images after body (inline panel, not side).
  if (imagePlacement === "end") {
    next.layout = { ...next.layout, imagePlacement: "inline" };
    next.imagePanelCfg = { ...next.imagePanelCfg!, placement: "inline" };
  }

  return next;
}

/** Defaults used by GET when no DB row exists and by Style UI presets. */
export const DEFAULT_INSTITUTIONAL_STYLE = {
  presetName: "Care Diagnostics Default",
  sectionOrder: "Technique,Findings,Impression",
  showClinicalHistory: true,
  showComparison: true,
  showRecommendation: true,
  showCriticalCommunication: true,
  showMeasurements: true,
  headingStyle: "underlined",
  subheadingStyle: "underlined",
  abnormalEmphasis: "bold_abnormal",
  spacing: "standard",
  lineGap: "standard",
  printLayout: "letterhead",
  margins: "standard",
  fontSize: "standard",
  fontFamily: "arial",
  logoPosition: "left",
  signaturePosition: "right",
  imagePlacement: "inline",
  studyTitleStyle: "underlined",
  showRadiologistName: true,
  showDegree: true,
  showRegNumber: true,
  showDigitalSignature: true,
  showTimestamp: true,
  showQrVerification: true,
} as const;
