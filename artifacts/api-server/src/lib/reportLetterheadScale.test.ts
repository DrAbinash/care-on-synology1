import { describe, expect, it } from "vitest";
import {
  buildLetterheadScaleCss,
  coerceFooterScale,
  coerceHeaderScale,
  coerceLogoScale,
  DEFAULT_FOOTER_SCALE,
  DEFAULT_HEADER_SCALE,
  DEFAULT_LOGO_SCALE,
  FOOTER_PX,
  HEADER_CONTACT_PX,
  HEADER_NAME_PX,
  HEADER_TAGLINE_PX,
  LOGO_PX,
} from "./reportLetterheadScale";

describe("reportLetterheadScale", () => {
  it("defaults are the 'large' tier (bigger out of the box)", () => {
    expect(DEFAULT_HEADER_SCALE).toBe("large");
    expect(DEFAULT_LOGO_SCALE).toBe("large");
    expect(DEFAULT_FOOTER_SCALE).toBe("large");
  });

  it("empty input renders the large-tier px values", () => {
    const css = buildLetterheadScaleCss();
    expect(css).toContain(`width: ${LOGO_PX.large}px !important`);
    expect(css).toContain(`height: ${LOGO_PX.large}px !important`);
    expect(css).toContain(`.hdr .name { font-size: ${HEADER_NAME_PX.large}px !important; }`);
    expect(css).toContain(`.hdr .contact { font-size: ${HEADER_CONTACT_PX.large}px !important; line-height: 1.5 !important; }`);
    expect(css).toContain(`.hdr .tagline { font-size: ${HEADER_TAGLINE_PX.large}px !important; }`);
    expect(css).toContain(`.ftr { font-size: ${FOOTER_PX.large}px !important; }`);
  });

  it("standard header keeps the seed sizes and 1.4 contact line-height", () => {
    const css = buildLetterheadScaleCss({ headerScale: "standard", logoScale: "standard", footerScale: "standard" });
    expect(css).toContain(`width: 60px !important`);
    expect(css).toContain(`.hdr .name { font-size: 20px !important; }`);
    expect(css).toContain(`.hdr .contact { font-size: 10px !important; line-height: 1.4 !important; }`);
    expect(css).toContain(`.hdr .tagline { font-size: 10px !important; }`);
    expect(css).toContain(`.ftr { font-size: 9px !important; }`);
  });

  it("xlarge maps to the largest px values", () => {
    const css = buildLetterheadScaleCss({ headerScale: "xlarge", logoScale: "xlarge", footerScale: "large" });
    expect(css).toContain(`width: 104px !important`);
    expect(css).toContain(`.hdr .name { font-size: 34px !important; }`);
    expect(css).toContain(`.hdr .contact { font-size: 15px !important; line-height: 1.5 !important; }`);
    expect(css).toContain(`.hdr .tagline { font-size: 14px !important; }`);
  });

  it("each logo enum maps to its px", () => {
    expect(LOGO_PX).toEqual({ standard: 60, large: 82, xlarge: 104 });
    expect(HEADER_NAME_PX).toEqual({ standard: 20, large: 27, xlarge: 34 });
    expect(HEADER_CONTACT_PX).toEqual({ standard: 10, large: 12.5, xlarge: 15 });
    expect(HEADER_TAGLINE_PX).toEqual({ standard: 10, large: 12, xlarge: 14 });
    expect(FOOTER_PX).toEqual({ standard: 9, large: 11.5 });
  });

  it("coerces unknown values to the defaults", () => {
    expect(coerceHeaderScale("huge")).toBe(DEFAULT_HEADER_SCALE);
    expect(coerceHeaderScale(undefined)).toBe(DEFAULT_HEADER_SCALE);
    expect(coerceHeaderScale(null)).toBe(DEFAULT_HEADER_SCALE);
    expect(coerceHeaderScale(42)).toBe(DEFAULT_HEADER_SCALE);
    expect(coerceLogoScale("")).toBe(DEFAULT_LOGO_SCALE);
    // footer has no "xlarge" tier → coerces to default
    expect(coerceFooterScale("xlarge")).toBe(DEFAULT_FOOTER_SCALE);
    expect(coerceFooterScale("standard")).toBe("standard");
  });

  it("unknown input to buildLetterheadScaleCss falls back to defaults", () => {
    const css = buildLetterheadScaleCss({ headerScale: "nonsense", logoScale: 999, footerScale: "xlarge" });
    expect(css).toContain(`width: ${LOGO_PX.large}px !important`);
    expect(css).toContain(`.hdr .name { font-size: ${HEADER_NAME_PX.large}px !important; }`);
    expect(css).toContain(`.ftr { font-size: ${FOOTER_PX.large}px !important; }`);
  });

  it("valid enums pass through coercion unchanged", () => {
    expect(coerceHeaderScale("standard")).toBe("standard");
    expect(coerceHeaderScale("large")).toBe("large");
    expect(coerceHeaderScale("xlarge")).toBe("xlarge");
    expect(coerceLogoScale("xlarge")).toBe("xlarge");
    expect(coerceFooterScale("large")).toBe("large");
  });
});
