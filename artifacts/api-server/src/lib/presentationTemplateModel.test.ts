import { describe, it, expect } from "vitest";
import {
  COPY_TYPES, DEFAULT_TEMPLATE_KEY, RENDERER_COMPAT_VERSION, SAFE_FONT_FAMILIES,
  TEMPLATE_EXPORT_SCHEMA_VERSION, TEMPLATE_SLOTS,
  activeTemplateSettingKey, compileTemplate, resolveTemplatePrecedence,
  validateDescription, validateDisplayName, validateImportEnvelope,
  validateTemplateDefinition, validateTemplateKey,
  type TemplateDefinition,
} from "./presentationTemplateModel";
import { parseExplicitTemplateParam } from "./presentationTemplateStore";
import { PRESENTATION_TEMPLATE_SEEDS, seedByKey } from "./presentationTemplateSeeds";
import { PRESENTATION_TEMPLATES } from "./reportPresentation";

// Ticket R1.2 — the pure core of the template engine: validation (the
// security boundary for every write and import), compilation, precedence.

const validDef = (): TemplateDefinition => JSON.parse(JSON.stringify(seedByKey("care-premium")!.definition));

describe("seed registry (Phase 2)", () => {
  it("ships all eight required templates, each valid, published, system, v1", () => {
    const keys = PRESENTATION_TEMPLATE_SEEDS.map((s) => s.templateKey).sort();
    expect(keys).toEqual([
      "care-classic", "care-premium", "care-v2", "government",
      "hope", "patient-copy", "referrer-copy", "teleradiology",
    ]);
    for (const s of PRESENTATION_TEMPLATE_SEEDS) {
      expect(s.version, s.templateKey).toBe(1);
      expect(s.isSystem, s.templateKey).toBe(true);
      expect(s.status, s.templateKey).toBe("published");
      expect(validateTemplateDefinition(s.definition), s.templateKey).toEqual([]);
      expect(validateTemplateKey(s.templateKey)).toEqual([]);
      expect(s.rendererVersion).toBeLessThanOrEqual(RENDERER_COMPAT_VERSION);
    }
  });

  it("copy types: patient-copy and referrer-copy carry their copy type; the rest are standard", () => {
    expect(seedByKey("patient-copy")!.copyType).toBe("patient");
    expect(seedByKey("referrer-copy")!.copyType).toBe("referrer");
    for (const key of ["care-classic", "care-premium", "care-v2", "hope", "government", "teleradiology"]) {
      expect(seedByKey(key)!.copyType, key).toBe("standard");
    }
  });

  it("care-classic and care-premium seeds compile to EXACTLY the R1.1 registry values", () => {
    for (const legacy of PRESENTATION_TEMPLATES) {
      const compiled = compileTemplate(seedByKey(legacy.id)!);
      expect(compiled.typography, legacy.id).toEqual(legacy.typography);
      expect(compiled.palette, legacy.id).toEqual(legacy.palette);
      expect(compiled.layout, legacy.id).toEqual(legacy.layout);
    }
  });
});

describe("definition validation (Phases 2/7 — the security boundary)", () => {
  it("accepts a fully valid definition", () => {
    expect(validateTemplateDefinition(validDef())).toEqual([]);
  });

  it("rejects fonts off the approved list", () => {
    const d = validDef();
    d.typography.body!.fontFamily = "Comic Sans MS, cursive";
    expect(validateTemplateDefinition(d).some((i) => i.path === "typography.body.fontFamily")).toBe(true);
  });

  it("rejects unsafe colors (non-hex, css functions, urls)", () => {
    for (const bad of ["red", "rgb(0,0,0)", "url(http://x)", "#12345", "expression(alert(1))"]) {
      const d = validDef();
      d.colors.accent = bad;
      expect(validateTemplateDefinition(d).some((i) => i.path === "colors.accent"), bad).toBe(true);
    }
  });

  it("rejects invalid measurements, margins, line heights and page config", () => {
    const cases: Array<[(d: TemplateDefinition) => void, string]> = [
      [(d) => { d.typography.body!.fontSize = "10vh"; }, "typography.body.fontSize"],
      [(d) => { d.typography.body!.fontSize = "9999pt"; }, "typography.body.fontSize"],
      [(d) => { d.typography.body!.lineHeight = "9.9"; }, "typography.body.lineHeight"],
      [(d) => { d.page.margins = "10cm"; }, "page.margins"],
      [(d) => { d.page.margins = "10mm 12mm 14mm"; }, "page.margins"],
      [(d) => { (d.page as { size: string }).size = "Legal"; }, "page.size"],
      [(d) => { (d.page as { orientation: string }).orientation = "diagonal"; }, "page.orientation"],
      [(d) => { d.imagePanel.panelWidthMm = 200; }, "imagePanel.panelWidthMm"],
      [(d) => { d.imagePanel.panelWidthMm = 10; }, "imagePanel.panelWidthMm"],
      [(d) => { d.pageBreaks.orphans = 0; }, "pageBreaks.orphans"],
      [(d) => { d.pageBreaks.widows = 99; }, "pageBreaks.widows"],
    ];
    for (const [mutate, path] of cases) {
      const d = validDef();
      mutate(d);
      expect(validateTemplateDefinition(d).some((i) => i.path === path), path).toBe(true);
    }
  });

  it("rejects forbidden HTML/JS/CSS/URL content ANYWHERE in the definition", () => {
    for (const payload of [
      "<script>alert(1)</script>", "javascript:void(0)", "url(https://evil)",
      "expression(x)", "a; } body { display:none", "@import 'x'", "back\\slash", "http://leak",
    ]) {
      const d = validDef();
      d.watermark.text = payload;
      expect(validateTemplateDefinition(d).some((i) => i.path.includes("watermark")), payload).toBe(true);
    }
  });

  it("rejects unknown properties at every level (typo-proofing + smuggling)", () => {
    const d = validDef() as unknown as Record<string, unknown>;
    d.customCss = "body{}";
    expect(validateTemplateDefinition(d).some((i) => i.path === "definition.customCss")).toBe(true);
    const d2 = validDef();
    (d2.typography as Record<string, unknown>).bodyExtra = { fontSize: "10pt" };
    expect(validateTemplateDefinition(d2).some((i) => i.path === "typography.bodyExtra")).toBe(true);
    const d3 = validDef();
    (d3.typography.body as Record<string, unknown>).cssText = "x";
    expect(validateTemplateDefinition(d3).some((i) => i.path === "typography.body.cssText")).toBe(true);
  });

  it("requires colors, page, watermark, image panel and page-break sections", () => {
    for (const section of ["colors", "page", "watermark", "imagePanel", "pageBreaks", "header", "qr"]) {
      const d = validDef() as unknown as Record<string, unknown>;
      delete d[section];
      expect(validateTemplateDefinition(d).some((i) => i.path === section), section).toBe(true);
    }
  });

  it("template keys and display names are slug/length/content-checked", () => {
    expect(validateTemplateKey("care-classic")).toEqual([]);
    expect(validateTemplateKey("My Template").length).toBe(1);
    expect(validateTemplateKey("UPPER").length).toBe(1);
    expect(validateTemplateKey("a").length).toBe(1);
    expect(validateDisplayName("CARE Premium")).toEqual([]);
    expect(validateDisplayName("<b>x</b>").length).toBe(1);
    expect(validateDisplayName("x".repeat(81)).length).toBe(1);
  });

  it("description is bounded and safe (publish is not a validation bypass)", () => {
    expect(validateDescription(null)).toEqual([]);
    expect(validateDescription("A refreshed brand look.")).toEqual([]);
    expect(validateDescription("x".repeat(501)).length).toBe(1);
    expect(validateDescription("<script>alert(1)</script>").length).toBe(1);
    expect(validateDescription("see http://evil").length).toBe(1);
  });
});

describe("parseExplicitTemplateParam strictness", () => {
  it("accepts key and key@version; rejects malformed and non-decimal versions", () => {
    expect(parseExplicitTemplateParam("care-premium")).toEqual({ key: "care-premium", version: null });
    expect(parseExplicitTemplateParam("care-premium@2")).toEqual({ key: "care-premium", version: 2 });
    expect(parseExplicitTemplateParam("care-premium@2@9")).toBeNull(); // malformed, not silently v2
    expect(parseExplicitTemplateParam("care-premium@0x2")).toBeNull(); // no hex
    expect(parseExplicitTemplateParam("care-premium@2e1")).toBeNull(); // no exponent
    expect(parseExplicitTemplateParam("care-premium@0")).toBeNull();
    expect(parseExplicitTemplateParam("UPPER@1")).toBeNull();
    expect(parseExplicitTemplateParam("")).toBeNull();
    expect(parseExplicitTemplateParam(null)).toBeNull();
  });
});

describe("import envelope validation (Phase 7)", () => {
  const validEnvelope = () => ({
    schemaVersion: TEMPLATE_EXPORT_SCHEMA_VERSION,
    rendererVersion: RENDERER_COMPAT_VERSION,
    templateKey: "hope-custom",
    version: 1,
    displayName: "Hope Custom",
    copyType: "standard" as const,
    definition: validDef(),
  });

  it("accepts a valid envelope", () => {
    const { issues, envelope } = validateImportEnvelope(validEnvelope());
    expect(issues).toEqual([]);
    expect(envelope?.templateKey).toBe("hope-custom");
  });

  it("rejects wrong schema versions and future renderer versions", () => {
    expect(validateImportEnvelope({ ...validEnvelope(), schemaVersion: 99 }).issues.some((i) => i.path === "schemaVersion")).toBe(true);
    expect(validateImportEnvelope({ ...validEnvelope(), rendererVersion: RENDERER_COMPAT_VERSION + 1 }).issues.some((i) => i.path === "rendererVersion")).toBe(true);
  });

  it("rejects unknown envelope properties, bad copy types and bad versions", () => {
    expect(validateImportEnvelope({ ...validEnvelope(), extra: 1 }).issues.some((i) => i.path === "$.extra")).toBe(true);
    expect(validateImportEnvelope({ ...validEnvelope(), copyType: "internal" }).issues.some((i) => i.path === "copyType")).toBe(true);
    expect(validateImportEnvelope({ ...validEnvelope(), version: 0 }).issues.some((i) => i.path === "version")).toBe(true);
    expect(validateImportEnvelope({ ...validEnvelope(), version: 1.5 }).issues.some((i) => i.path === "version")).toBe(true);
  });

  it("rejects a poisoned definition inside an otherwise valid envelope (no partial import)", () => {
    const env = validEnvelope();
    env.definition.colors.accent = "url(javascript:alert(1))";
    const { issues, envelope } = validateImportEnvelope(env);
    expect(issues.length).toBeGreaterThan(0);
    expect(envelope).toBeNull();
  });

  it("export → import round trip validates cleanly for every seed", () => {
    for (const s of PRESENTATION_TEMPLATE_SEEDS) {
      const envelope = {
        schemaVersion: TEMPLATE_EXPORT_SCHEMA_VERSION,
        rendererVersion: s.rendererVersion,
        templateKey: s.templateKey,
        version: s.version,
        displayName: s.displayName,
        description: s.description ?? null,
        copyType: s.copyType,
        definition: s.definition,
        exportedAt: "2026-07-11T00:00:00.000Z",
      };
      expect(validateImportEnvelope(envelope).issues, s.templateKey).toEqual([]);
    }
  });
});

describe("resolution precedence (Phase 6 — deterministic)", () => {
  const active = { standard: "care-premium", patient: "patient-copy" };

  it("explicit always wins, on any surface", () => {
    expect(resolveTemplatePrecedence({
      explicitKey: "hope", explicitVersion: 2,
      frozen: { templateKey: "care-classic", templateVersion: 1 },
      copyType: "patient", activeByCopyType: active,
    })).toEqual({ templateKey: "hope", version: 2, source: "explicit" });
  });

  it("STANDARD surface: frozen identity outranks the active standard selection (reproducible clinical document)", () => {
    expect(resolveTemplatePrecedence({
      frozen: { templateKey: "hope", templateVersion: 1 },
      copyType: "standard",
      activeByCopyType: { standard: "government" },
    })).toEqual({ templateKey: "hope", version: 1, source: "frozen" });

    expect(resolveTemplatePrecedence({ copyType: "standard", activeByCopyType: active }))
      .toEqual({ templateKey: "care-premium", version: null, source: "standard-active" });

    expect(resolveTemplatePrecedence({ copyType: "standard", activeByCopyType: {} }))
      .toEqual({ templateKey: DEFAULT_TEMPLATE_KEY, version: null, source: "default" });
  });

  it("PATIENT/REFERRER surface: the copy-type active selection outranks the frozen STANDARD identity", () => {
    // the R1.2 regression that shipped in review: without this, patient-copy
    // could never apply to a report signed after R1.2 (every sign freezes the
    // standard identity, which used to outrank copy-type resolution).
    expect(resolveTemplatePrecedence({
      frozen: { templateKey: "care-classic", templateVersion: 1 },
      copyType: "patient", activeByCopyType: active,
    })).toEqual({ templateKey: "patient-copy", version: null, source: "copy-type-active" });

    // referrer has no active selection → falls to frozen standard, then standard active
    expect(resolveTemplatePrecedence({
      frozen: { templateKey: "care-classic", templateVersion: 1 },
      copyType: "referrer", activeByCopyType: active,
    })).toEqual({ templateKey: "care-classic", version: 1, source: "frozen" });

    expect(resolveTemplatePrecedence({ copyType: "referrer", activeByCopyType: active }))
      .toEqual({ templateKey: "care-premium", version: null, source: "standard-active" });
  });

  it("settings keys: standard keeps the R1.1 key; copy types get suffixed keys", () => {
    expect(activeTemplateSettingKey("standard")).toBe("report_presentation_template");
    expect(activeTemplateSettingKey("patient")).toBe("report_presentation_template_patient");
    expect(activeTemplateSettingKey("referrer")).toBe("report_presentation_template_referrer");
    expect(COPY_TYPES).toEqual(["standard", "patient", "referrer"]);
  });
});

describe("freeze snapshot reproducibility (Phase 3 — review-caught)", () => {
  it("compiling a record reconstructed from a snapshot equals compiling the original", () => {
    // simulates the render-time reproducibility fallback: the version row is
    // gone, so we rebuild the record from the frozen full-definition snapshot.
    const original = seedByKey("care-premium")!;
    const snapshotRecord = {
      templateKey: original.templateKey,
      version: original.version,
      displayName: original.displayName,
      description: original.description,
      orgScope: "global",
      copyType: original.copyType,
      status: "published" as const,
      rendererVersion: 1,
      isSystem: false,
      definition: original.definition, // the FULL definition the snapshot must carry
    };
    expect(compileTemplate(snapshotRecord)).toEqual(compileTemplate(original));
  });
});

describe("compilation (Phase 4)", () => {
  it("exposes every configuration section to the renderer", () => {
    const compiled = compileTemplate(seedByKey("government")!);
    expect(compiled.templateKey).toBe("government");
    expect(compiled.templateVersion).toBe(1);
    expect(compiled.watermarkCfg).toEqual({ enabled: true, text: "GOVERNMENT COPY" });
    expect(compiled.page.margins).toBe("18mm 16mm");
    expect(compiled.pageBreaks).toEqual({ orphans: 4, widows: 4 });
    expect(compiled.headerCfg.showLogo).toBe(false);
    expect(compiled.layout.pageMargins).toBe(compiled.page.margins);
  });

  it("impression slot + body line height/alignment flow through", () => {
    const d = validDef();
    d.typography.impression = { fontWeight: "700", color: "#111111" };
    d.typography.body!.lineHeight = "1.8";
    d.typography.body!.textAlign = "left";
    const compiled = compileTemplate({ templateKey: "x-test", version: 2, displayName: "X", copyType: "standard", definition: d });
    expect(compiled.impressionTypography).toEqual({ fontWeight: "700", color: "#111111", fontFamily: undefined, fontSize: undefined, letterSpacing: undefined, textTransform: undefined });
    expect(compiled.bodyLineHeight).toBe("1.8");
    expect(compiled.bodyTextAlign).toBe("left");
  });

  it("every safe font and slot constant is exposed for the admin UI", () => {
    expect(SAFE_FONT_FAMILIES.length).toBeGreaterThanOrEqual(8);
    expect(TEMPLATE_SLOTS).toContain("impression");
    expect(TEMPLATE_SLOTS.length).toBe(9);
  });
});
