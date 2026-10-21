import { describe, expect, it } from "vitest";
import {
  applyInstitutionalTemplateOverrides,
  buildInstitutionalStyleCss,
  buildReportSurfaceCss,
  coerceFontFamilyKey,
  coerceImagePlacement,
  coerceLogoPosition,
  KEY_IMAGE_ASPECTS,
  keyImageLayoutCss,
  parseReportFormatNudge,
  resolveFontFamilyCss,
} from "./institutionalReportStyle";
import type { RenderableTemplate } from "./reportPresentation";

const baseTemplate: RenderableTemplate = {
  id: "care-classic",
  name: "Classic",
  description: "test",
  typography: {
    header: {},
    patientBlock: {},
    studyTitle: {},
    sectionHeading: {},
    body: {},
    footer: {},
    signature: {},
    imagePanel: {},
  },
  palette: {
    headerBg: "#ffffff",
    headerText: "#111",
    accent: "#1e1b4b",
    sectionBg: "#f8fafc",
    sectionBorder: "#e2e8f0",
    labelColor: "#64748b",
    valueColor: "#0f172a",
    impressionBg: "#eff6ff",
  },
  layout: {
    patientBlockStyle: "table",
    imagePlacement: "inline",
    pageMargins: "14mm",
  },
};

describe("institutionalReportStyle", () => {
  it("coerces logo / image placement / font keys safely", () => {
    expect(coerceLogoPosition("center")).toBe("center");
    expect(coerceLogoPosition("nope")).toBe("left");
    expect(coerceImagePlacement("side-panel")).toBe("side-panel");
    expect(coerceImagePlacement("end")).toBe("end");
    expect(coerceImagePlacement("weird")).toBe("inline");
    expect(coerceFontFamilyKey("times")).toBe("times");
    expect(coerceFontFamilyKey("evil")).toBe("arial");
    expect(resolveFontFamilyCss("times")).toContain("Times New Roman");
  });

  it("emits CSS for headings, line gap, logo, signature, and fonts", () => {
    const css = buildInstitutionalStyleCss({
      headingStyle: "bold_underlined",
      subheadingStyle: "plain",
      spacing: "comfortable",
      lineGap: "comfortable",
      fontSize: "large",
      fontFamily: "georgia",
      logoPosition: "right",
      signaturePosition: "center",
      abnormalEmphasis: "bold_both",
      studyTitleStyle: "underlined",
      margins: "narrow",
      logoScale: "xlarge",
      clinicNameScale: "xlarge",
      addressScale: "standard",
      nameAlign: "right",
      addressAlign: "left",
      headerRuleEnabled: true,
      headerRuleThickness: "extra",
      headerRuleColor: "navy",
    });
    expect(css).toContain("Georgia");
    expect(css).toContain("font-size: 16px");
    expect(css).toContain("line-height: 1.7");
    expect(css).toContain("flex-direction: row-reverse");
    expect(css).toContain("justify-content: center");
    expect(css).toContain(".section-heading");
    expect(css).toContain("text-decoration: underline");
    expect(css).toContain(".image-panel-heading");
    expect(css).toContain("font-weight: 500"); // plain subheading
    expect(css).toContain("width: 104px"); // xlarge logo
    expect(css).toContain("font-size: 34px"); // xlarge clinic name
    expect(css).toContain("border-top: 5px solid #1e3a8a"); // extra navy rule
    expect(css).toMatch(/\.hdr-inner \.hdr-brand \{ text-align: right/);
    expect(css).toMatch(/\.hdr-address-bar \{ text-align: left/);
    expect(css).toContain("aspect-ratio: 1 / 1");
    expect(css).toContain("object-fit: contain");
  });

  it("hides header rule when disabled", () => {
    const css = buildInstitutionalStyleCss({
      headerRuleEnabled: false,
    });
    expect(css).toContain(".hdr-rule { display: none");
  });

  it("leaves the rail cell free to grow by a caption, in every port shape", () => {
    // This layer wins over reportPresentation's with !important, so a 1/1 ratio
    // here clipped the caption out of the printed page while the HTML still
    // contained it. The square belongs to .image-viewport, never to .image-cell.
    for (const aspect of [undefined, ...KEY_IMAGE_ASPECTS, "not-a-shape"] as const) {
      const css = keyImageLayoutCss({ keyImageAspect: aspect });
      const allRules: string[] = css.match(/\.image-cell\s*\{[^}]*\}/g) ?? [];
      const cellRules = allRules.filter((r) => !r.includes(".image-cell ."));
      expect(cellRules.length, `aspect=${aspect}: no .image-cell rule found at all`).toBeGreaterThan(0);
      for (const rule of cellRules) {
        expect(rule, `aspect=${aspect}`).not.toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
      }
      expect(css, `aspect=${aspect}: the port itself stays square`).toMatch(/\.image-viewport\s*\{[^}]*aspect-ratio/);
    }
  });

  it("emits default square/contain + extreme-right layout CSS when style is null", () => {
    const css = buildInstitutionalStyleCss(null);
    expect(css).toContain("aspect-ratio: 1 / 1");
    expect(css).toContain("object-fit: contain");
    expect(css).toContain(".letterpad-demo .ld-right { text-align: right");
    expect(buildInstitutionalStyleCss(undefined)).toContain("aspect-ratio: 1 / 1");
  });

  it("overrides image placement and signature on clinic-branded templates; letter-pad keeps logo left", () => {
    const clinicTemplate: RenderableTemplate = { ...baseTemplate, id: "hope", letterhead: { kind: "clinic" } };
    const next = applyInstitutionalTemplateOverrides(clinicTemplate, {
      imagePlacement: "side-panel",
      logoPosition: "center",
      signaturePosition: "left",
      showDigitalSignature: false,
      studyTitleStyle: "bar",
    });
    expect(next.layout.imagePlacement).toBe("side-panel");
    expect(next.imagePanelCfg?.placement).toBe("side-panel");
    expect(next.headerCfg?.logoPosition).toBe("center");
    expect(next.signatureCfg?.align).toBe("left");
    expect(next.signatureCfg?.showImage).toBe(false);
    expect(next.studyTitleCfg?.style).toBe("bar");
    expect(clinicTemplate.layout.imagePlacement).toBe("inline");
  });

  it("does not let Style logoPosition squash CARE letter-pad chrome", () => {
    const next = applyInstitutionalTemplateOverrides(baseTemplate, {
      logoPosition: "center",
    });
    expect(next.headerCfg?.logoPosition).toBeUndefined();
  });

  it("maps default inline placement to a right side rail (letter-pad / Arhan)", () => {
    const next = applyInstitutionalTemplateOverrides(baseTemplate, {
      imagePlacement: "inline",
    });
    expect(next.layout.imagePlacement).toBe("side-panel");
    expect(next.imagePanelCfg?.placement).toBe("side-panel");
    expect(baseTemplate.layout.imagePlacement).toBe("inline");
  });

  it("maps end image placement to after-body gallery, not a right rail", () => {
    const next = applyInstitutionalTemplateOverrides(baseTemplate, {
      imagePlacement: "end",
    });
    expect(next.layout.imagePlacement).toBe("inline");
    expect(next.imagePanelCfg?.placement).toBe("inline");
  });

  it("skipLetterheadChrome omits square-logo and @page header chrome", () => {
    const css = buildInstitutionalStyleCss({
      logoScale: "xlarge",
      clinicNameScale: "xlarge",
      logoPosition: "right",
      headerRuleEnabled: true,
      margins: "narrow",
    }, { skipLetterheadChrome: true });
    expect(css).not.toContain("width: 104px");
    expect(css).not.toContain("@page { size: A4");
    expect(css).not.toContain("flex-direction: row-reverse");
    expect(css).toContain("Institutional report style overrides");
    expect(css).toContain("font-family:");
  });

  it("CARE letter-pad surface CSS skips the 82px logo-scale fragment", () => {
    const css = buildReportSurfaceCss(
      { id: "care-classic", letterhead: { kind: "care-letterpad" } },
      { logoScale: "large", fontFamily: "georgia" },
      { logoScale: "large", headerScale: "large" },
    );
    expect(css).not.toContain("height: 82px !important");
    expect(css).toContain("Georgia");
    const clinicCss = buildReportSurfaceCss(
      { id: "hope", letterhead: { kind: "clinic" } },
      { logoScale: "large" },
      { logoScale: "large" },
    );
    expect(clinicCss).toContain("height: 82px !important");
  });

  // ── Per-report typography nudge (Print Preview +/- controls) ───────────────
  // The owner's rule is "Settings as the default, report-specific adjustments
  // without changing global settings or other reports", so the two properties
  // these tests exist to keep are RELATIVITY and the untouched no-op.
  //
  // Every assertion below pulls the value out of the ONE rule it is about. The
  // generated CSS also sets `font-size` and `line-height` on `.hdr .name`,
  // `.hdr .tagline` and `.hdr .contact`, so a bare `css.toContain("12px")` was
  // satisfied by the letterhead while the body text was untouched — it stayed
  // green against a mutation that disabled the nudge completely.

  /** The body rule's declarations, or throw. */
  const bodyRule = (css: string) => {
    const m = css.match(/body, \.body \{([^}]*)\}/);
    if (!m) throw new Error("no body rule in generated CSS");
    return m[1];
  };
  const lineGapRule = (css: string) => {
    const m = css.match(/\.body p, \.body div, \.body li \{([^}]*)\}/);
    if (!m) throw new Error("no body paragraph rule in generated CSS");
    return m[1];
  };
  const sectionGapRule = (css: string) => {
    const m = css.match(/\.section-heading, \.image-panel-heading \{([^}]*)\}/);
    if (!m) throw new Error("no section heading rule in generated CSS");
    return m[1];
  };

  describe("format nudge is relative to the Settings row", () => {
    it("starts from the clinic's own preset, not from a constant", () => {
      const small = buildInstitutionalStyleCss({ fontSize: "small", spacing: "standard" }, { format: { fontSizeSteps: 1 } });
      const large = buildInstitutionalStyleCss({ fontSize: "large", spacing: "standard" }, { format: { fontSizeSteps: 1 } });
      expect(bodyRule(small)).toContain("font-size: 13.5px !important");
      expect(bodyRule(large)).toContain("font-size: 17px !important");
    });

    it("spacing steps move line-height, body gap and section gap together", () => {
      const css = buildInstitutionalStyleCss({ fontSize: "standard", spacing: "standard" }, { format: { spacingSteps: 1 } });
      expect(bodyRule(css)).toContain("line-height: 1.50 !important");
      expect(lineGapRule(css)).toContain("margin-bottom: 11px !important");
      expect(sectionGapRule(css)).toContain("margin-top: 16px !important");
    });

    it("steps the whole range down without ever reaching an unreadable size", () => {
      const up = buildInstitutionalStyleCss({ fontSize: "standard", spacing: "standard" }, { format: { fontSizeSteps: 4 } });
      const down = buildInstitutionalStyleCss({ fontSize: "standard", spacing: "standard" }, { format: { fontSizeSteps: -4 } });
      expect(bodyRule(up)).toContain("font-size: 18px !important");
      expect(bodyRule(down)).toContain("font-size: 10px !important");
    });

    it("clamps a hand-edited query to the reachable range in both directions", () => {
      const up = buildInstitutionalStyleCss({ fontSize: "standard", spacing: "standard" }, { format: { fontSizeSteps: 99 } });
      const down = buildInstitutionalStyleCss({ fontSize: "standard", spacing: "standard" }, { format: { fontSizeSteps: -99 } });
      expect(bodyRule(up)).toContain("font-size: 18px !important");
      expect(bodyRule(down)).toContain("font-size: 10px !important");
    });

    it("a report nobody adjusted is served byte-identical CSS", () => {
      const style = { fontSize: "standard", spacing: "comfortable", fontFamily: "georgia" };
      const before = buildInstitutionalStyleCss(style);
      expect(buildInstitutionalStyleCss(style, { format: null })).toBe(before);
      expect(buildInstitutionalStyleCss(style, { format: { fontSizeSteps: 0, spacingSteps: 0 } })).toBe(before);
    });

    it("buildReportSurfaceCss forwards the nudge into the body rule", () => {
      const css = buildReportSurfaceCss(
        { id: "hope", letterhead: { kind: "clinic" } },
        { fontSize: "standard", spacing: "standard" },
        undefined,
        { fontSizeSteps: -2 },
      );
      expect(bodyRule(css)).toContain("font-size: 12px !important");
    });

    // The clinic prints on the CARE letter-pad, whose chrome pins
    // `.letterpad .body { font-size: 10pt !important }` at HIGHER specificity
    // than `body, .body`. Without a step stated against that pin the control
    // changed the Style-derived rule and nothing the radiologist could see —
    // measured in Chromium, the body stayed at 13.3333px for every step.
    it("a letter-pad report steps from the pinned 10pt, not only the Style row", () => {
      const css = buildReportSurfaceCss(
        { id: "care-classic", letterhead: { kind: "care-letterpad" } },
        { fontSize: "standard", spacing: "standard" },
        undefined,
        { fontSizeSteps: 2 },
      );
      expect(css).toContain("body .letterpad .body { font-size: calc(10pt + 2px) !important; }");

      const down = buildReportSurfaceCss(
        { id: "care-classic", letterhead: { kind: "care-letterpad" } },
        { fontSize: "standard", spacing: "standard" },
        undefined,
        { fontSizeSteps: -2 },
      );
      expect(down).toContain("body .letterpad .body { font-size: calc(10pt - 2px) !important; }");
    });

    it("no step means no letter-pad override at all", () => {
      const letterpad = (format: { fontSizeSteps?: number } | null) => buildReportSurfaceCss(
        { id: "care-classic", letterhead: { kind: "care-letterpad" } },
        { fontSize: "standard", spacing: "standard" },
        undefined,
        format,
      );
      expect(letterpad(null)).not.toContain("calc(10pt");
      expect(letterpad({ fontSizeSteps: 0 })).not.toContain("calc(10pt");

      // A clinic-branded template has no pin to step from, so it gets no override
      // even at a step — its size already comes from the Style row above.
      const clinic = buildReportSurfaceCss(
        { id: "hope", letterhead: { kind: "clinic" } },
        { fontSize: "standard" },
        undefined,
        { fontSizeSteps: 1 },
      );
      expect(clinic).not.toContain("calc(10pt");
    });
  });

  describe("parseReportFormatNudge", () => {
    it("reads the query pair and clamps it", () => {
      expect(parseReportFormatNudge({ fontSizeSteps: "2", spacingSteps: "-1" })).toEqual({ fontSizeSteps: 2, spacingSteps: -1 });
      expect(parseReportFormatNudge({ fontSizeSteps: "99" })).toEqual({ fontSizeSteps: 4, spacingSteps: 0 });
    });
    it("returns null when nothing was adjusted, so the URL stays as it was", () => {
      expect(parseReportFormatNudge(undefined)).toBeNull();
      expect(parseReportFormatNudge({})).toBeNull();
      expect(parseReportFormatNudge({ fontSizeSteps: "0", spacingSteps: "0" })).toBeNull();
    });
    it("refuses to invent a size from garbage", () => {
      expect(parseReportFormatNudge({ fontSizeSteps: "abc" })).toBeNull();
      expect(parseReportFormatNudge({ fontSizeSteps: "1&drop_table=1" })).toBeNull();
      expect(parseReportFormatNudge({ fontSizeSteps: Array(3).fill("1") })).toBeNull();
    });
  });
});
