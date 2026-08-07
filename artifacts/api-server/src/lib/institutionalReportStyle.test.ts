import { describe, expect, it } from "vitest";
import {
  applyInstitutionalTemplateOverrides,
  buildInstitutionalStyleCss,
  coerceFontFamilyKey,
  coerceImagePlacement,
  coerceLogoPosition,
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
    expect(css).toContain("font-size: 15px");
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
  });

  it("hides header rule when disabled", () => {
    const css = buildInstitutionalStyleCss({
      headerRuleEnabled: false,
    });
    expect(css).toContain(".hdr-rule { display: none");
  });

  it("returns empty CSS when style is null", () => {
    expect(buildInstitutionalStyleCss(null)).toBe("");
    expect(buildInstitutionalStyleCss(undefined)).toBe("");
  });

  it("overrides template image placement and signature/logo config", () => {
    const next = applyInstitutionalTemplateOverrides(baseTemplate, {
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
    // original untouched
    expect(baseTemplate.layout.imagePlacement).toBe("inline");
  });

  it("maps end image placement to inline flow", () => {
    const next = applyInstitutionalTemplateOverrides(baseTemplate, {
      imagePlacement: "end",
    });
    expect(next.layout.imagePlacement).toBe("inline");
    expect(next.imagePanelCfg?.placement).toBe("inline");
  });
});
