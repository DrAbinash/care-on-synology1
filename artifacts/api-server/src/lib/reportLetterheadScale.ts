/**
 * reportLetterheadScale.ts — presentation-only sizing overrides for the
 * radiology report letterhead (header/logo/clinic-name/address + footer).
 *
 * These are NOT template defaults: reportPresentation.ts keeps its byte-stable
 * seed CSS, and this module produces an EXTRA `customCss` fragment (all rules
 * `!important`) that is appended LAST so it wins by cascade order. Both the
 * finalized-report render path (patient-reports.ts) and the draft print-preview
 * path (radiology-report-generator.ts) call buildLetterheadScaleCss so drafts
 * and finals size identically.
 *
 * The three inputs come from pacs_settings key/value rows (no schema change).
 * Defaults ship BIGGER than the historical seed sizes ("large") so the
 * letterhead reads well out of the box; unknown/absent values coerce to the
 * default.
 */

export type HeaderScale = "standard" | "large" | "xlarge";
export type LogoScale = "standard" | "large" | "xlarge";
export type FooterScale = "standard" | "large";

// ── pacs_settings keys ───────────────────────────────────────────────────────
export const REPORT_HEADER_SCALE_KEY = "report_header_scale";
export const REPORT_LOGO_SCALE_KEY = "report_logo_scale";
export const REPORT_FOOTER_SCALE_KEY = "report_footer_scale";

// ── Defaults (bigger than the seed out of the box) ───────────────────────────
export const DEFAULT_HEADER_SCALE: HeaderScale = "large";
export const DEFAULT_LOGO_SCALE: LogoScale = "large";
export const DEFAULT_FOOTER_SCALE: FooterScale = "large";

// ── px maps ──────────────────────────────────────────────────────────────────
/** Logo box (width === height). Seed is 60px. */
export const LOGO_PX: Record<LogoScale, number> = {
  standard: 60,
  large: 82,
  xlarge: 104,
};
/** Clinic name (.hdr .name) font size. */
export const HEADER_NAME_PX: Record<HeaderScale, number> = {
  standard: 20,
  large: 27,
  xlarge: 34,
};
/** Address / contact block (.hdr .contact) font size. Seed is 10px. */
export const HEADER_CONTACT_PX: Record<HeaderScale, number> = {
  standard: 10,
  large: 12.5,
  xlarge: 15,
};
/** Tagline (.hdr .tagline) font size — bumped proportionally with the header. */
export const HEADER_TAGLINE_PX: Record<HeaderScale, number> = {
  standard: 10,
  large: 12,
  xlarge: 14,
};
/** Footer (.ftr) font size. Seed is 9px. */
export const FOOTER_PX: Record<FooterScale, number> = {
  standard: 9,
  large: 11.5,
};

// ── Coercion (unknown/absent → default) ──────────────────────────────────────
export function coerceHeaderScale(raw: unknown): HeaderScale {
  return raw === "standard" || raw === "large" || raw === "xlarge" ? raw : DEFAULT_HEADER_SCALE;
}
export function coerceLogoScale(raw: unknown): LogoScale {
  return raw === "standard" || raw === "large" || raw === "xlarge" ? raw : DEFAULT_LOGO_SCALE;
}
export function coerceFooterScale(raw: unknown): FooterScale {
  return raw === "standard" || raw === "large" ? raw : DEFAULT_FOOTER_SCALE;
}

export interface LetterheadScaleInput {
  headerScale?: unknown;
  logoScale?: unknown;
  footerScale?: unknown;
}

/**
 * Pure: translate the three (possibly-invalid) scale values into a CSS string
 * of `!important` overrides. Always returns a non-empty string (defaults are
 * bigger than the seed). Safe to append to any customCss.
 */
export function buildLetterheadScaleCss(input: LetterheadScaleInput = {}): string {
  const header = coerceHeaderScale(input.headerScale);
  const logo = coerceLogoScale(input.logoScale);
  const footer = coerceFooterScale(input.footerScale);

  const logoPx = LOGO_PX[logo];
  const namePx = HEADER_NAME_PX[header];
  const contactPx = HEADER_CONTACT_PX[header];
  const taglinePx = HEADER_TAGLINE_PX[header];
  const footerPx = FOOTER_PX[footer];
  // Bump line-height on the address block for the larger header tiers so the
  // multi-line contact stack does not crowd.
  const contactLineHeight = header === "standard" ? 1.4 : 1.5;

  return `
      /* Report letterhead sizing (pacs_settings: ${REPORT_HEADER_SCALE_KEY}=${header}, ${REPORT_LOGO_SCALE_KEY}=${logo}, ${REPORT_FOOTER_SCALE_KEY}=${footer}) */
      .hdr img.logo { width: ${logoPx}px !important; height: ${logoPx}px !important; }
      .hdr .name { font-size: ${namePx}px !important; }
      .hdr .contact { font-size: ${contactPx}px !important; line-height: ${contactLineHeight} !important; }
      .hdr .tagline { font-size: ${taglinePx}px !important; }
      .ftr { font-size: ${footerPx}px !important; }
    `;
}
