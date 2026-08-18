import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEMPLATE_ID, PRESENTATION_TEMPLATES, escapeHtml,
  renderReportDocument, resolvePresentationTemplate,
  type ReportDocumentModel,
} from "./reportPresentation";
import { renderedPathForReference, viewportForImageCount } from "./reportImages";

// Ticket R1.1 — THE shared presentation layer. Every rendered surface flows
// through renderReportDocument, so its layout/typography/page-break contract
// is proven here template by template.

function baseModel(overrides: Partial<ReportDocumentModel> = {}): ReportDocumentModel {
  return {
    reportNumber: "RPT-20260711-001",
    studyTitle: "MRI BRAIN (PLAIN)",
    typeLabel: "RADIOLOGY",
    statusLabel: "VERIFIED",
    clinic: { name: "Care Diagnostics", tagline: "Precision Imaging", address: "Deoghar", phone: "06432-1234" },
    patientRows: [
      { label: "Patient", value: "Sunita Sharma" },
      { label: "Age / Sex", value: "42y / F" },
      { label: "Accession No.", value: "ACC-1" },
      { label: "Empty Hidden", value: "" },
    ],
    bodyHtml: "<p>FINDINGS: Normal study.</p>",
    stamp: { kind: "verified", label: "VERIFIED on 11/7/2026" },
    signatures: [{ name: "Dr. Asha Rao", qualification: "MD (Radiodiagnosis)", registrationNo: "JH-123", label: "Signed:", whenLabel: " 11/7/2026" }],
    footerNote: "Not valid for medicolegal use without seal",
    generatedAtLabel: "11/7/2026, 3:00 pm",
    ...overrides,
  };
}

describe("template registry (Phase 8)", () => {
  it("classic is the default; ids are unique; unknown ids resolve to the default", () => {
    expect(DEFAULT_TEMPLATE_ID).toBe("care-classic");
    const ids = PRESENTATION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(resolvePresentationTemplate("care-premium").id).toBe("care-premium");
    expect(resolvePresentationTemplate("no-such-template").id).toBe("care-classic");
    expect(resolvePresentationTemplate(null).id).toBe("care-classic");
  });

  it("every template defines typography for all eight slots (Phase 9)", () => {
    const slots = ["header", "patientBlock", "studyTitle", "sectionHeading", "body", "footer", "signature", "imagePanel"] as const;
    for (const t of PRESENTATION_TEMPLATES) {
      for (const slot of slots) expect(t.typography[slot], `${t.id}.${slot}`).toBeTruthy();
    }
  });
});

describe("renderReportDocument — content contract", () => {
  it("carries clinic, patient rows (empties hidden), body, stamp, signature and footer", () => {
    const html = renderReportDocument(baseModel(), resolvePresentationTemplate("care-classic"));
    expect(html).toContain("Care Diagnostics");
    expect(html).toContain("Sunita Sharma");
    expect(html).toContain("MRI BRAIN (PLAIN)");
    expect(html).toContain("FINDINGS: Normal study.");
    expect(html).toContain("VERIFIED on 11/7/2026");
    expect(html).toContain("Dr. Asha Rao");
    expect(html).toContain("Reg. No: JH-123");
    expect(html).toContain("Not valid for medicolegal use");
    expect(html).not.toContain("Empty Hidden");
  });

  it("escapes hostile content in every modeled field (patient name, captions, notes)", () => {
    const html = renderReportDocument(baseModel({
      patientRows: [{ label: "Patient", value: `<script>alert(1)</script>` }],
      isCritical: true,
      criticalNote: `<img onerror=x>`,
      keyImages: [{ src: "data:image/jpeg;base64,AAA", caption: `<b>bad</b>`, displayOrder: 0 }],
    }), resolvePresentationTemplate("care-premium"));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img onerror=x>");
    expect(html).not.toContain("<b>bad</b>");
  });

  it("bodyText is escaped; bodyHtml passes through (frozen radiology pipeline output)", () => {
    const escaped = renderReportDocument(baseModel({ bodyHtml: undefined, bodyText: "<p>plain</p>" }), resolvePresentationTemplate("care-classic"));
    expect(escaped).toContain("&lt;p&gt;plain&lt;/p&gt;");
    const trusted = renderReportDocument(baseModel(), resolvePresentationTemplate("care-classic"));
    expect(trusted).toContain("<p>FINDINGS: Normal study.</p>");
  });

  it("D8 safeguard fragments pass through byte-identical", () => {
    const banner = `<div class="superseded-banner">SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS</div>`;
    const watermark = `<div class="superseded-watermark" aria-hidden="true">SUPERSEDED</div>`;
    const html = renderReportDocument(baseModel({ safeguardBannerHtml: banner, safeguardWatermarkHtml: watermark }), resolvePresentationTemplate("care-premium"));
    expect(html).toContain(banner);
    expect(html).toContain(watermark);
  });

  it("draft previews watermark themselves and never render as final", () => {
    const html = renderReportDocument(baseModel({
      draftWatermark: true, stamp: { kind: "draft", label: "DRAFT (not signed)" }, statusLabel: "DRAFT",
    }), resolvePresentationTemplate("care-premium"));
    expect(html).toContain("DRAFT — NOT SIGNED");
    expect(html).toContain("draft-watermark");
  });

  it("autoPrint controls the print script", () => {
    expect(renderReportDocument(baseModel({ autoPrint: true }), resolvePresentationTemplate("care-classic"))).toContain("window.print()");
    expect(renderReportDocument(baseModel(), resolvePresentationTemplate("care-classic"))).not.toContain("window.print()");
  });
});

describe("premium layout (Phase 7)", () => {
  const images = [
    { src: "data:image/jpeg;base64,AAA", caption: "T2 AXIAL", displayOrder: 1, sopInstanceUid: "1.2.3.4" },
    { src: "data:image/jpeg;base64,BBB", caption: "FLAIR", displayOrder: 0 },
  ];

  it("with images: two-column table on screen AND print; rail stays beside the report", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-premium"));
    expect(html).toContain("has-side-images");
    expect(html).toContain("display: table");
    expect(html).toContain("width: 70%");
    expect(html).toContain("width: 30%");
    expect(html).not.toMatch(/\.image-panel-side\s*\{\s*float:\s*right/);
    expect(html).toContain("KEY IMAGES");
    expect(html).toContain("image-viewport");
    expect(html.indexOf("FLAIR")).toBeLessThan(html.indexOf("T2 AXIAL")); // displayOrder wins
    expect(html).toContain('data-sop-instance-uid="1.2.3.4"');  // viewer integration hook
  });

  it("without images: full-width report, no side panel CSS, no image heading", () => {
    const html = renderReportDocument(baseModel({ keyImages: [] }), resolvePresentationTemplate("care-premium"));
    expect(html).not.toContain("has-side-images");
    expect(html).not.toContain("KEY IMAGES");
  });

  it("page-break discipline: widows/orphans set, images and signatures never split", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-premium"));
    expect(html).toContain("orphans: 3; widows: 3");
    expect(html).toMatch(/\.image-cell[\s\S]*?break-inside: avoid/);
    expect(html).toMatch(/\.image-cell, \.sigs, \.impression, \.patient-section, \.hdr, \.letterpad-footer-block \{ page-break-inside: avoid; \}/);
    expect(html).toContain("page-break-after: avoid");
  });

  it("classic template keeps the inline image grid and stacked demographics", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-classic"));
    expect(html).toContain("image-panel-inline");
    expect(html).toContain("patient-stacked");
    expect(html).not.toContain("float: right; width: 62mm");
  });

  it("letter-pad header, footer, Sugandha default, key images on the right", () => {
    const html = renderReportDocument(
      baseModel({ keyImages: images, signatures: [], clinic: { name: "", address: "", phone: "", email: "" } }),
      resolvePresentationTemplate("care-premium"),
    );
    expect(html).toContain("letterpad");
    expect(html).toContain("logo-pos-left");
    expect(html).toContain("letterpad-bill");
    expect(html).toContain("DEOGHAR-814 112");
    expect(html).toContain("care.deoghar@gmail.com");
    expect(html).toContain("MULTI SLICE CT SCAN");
    expect(html).toContain("not for medico-legal");
    expect(html).toContain("Dr. Sugandha Priyadarshini");
    expect(html).toContain("MD (Radiodiagnosis &amp; Medical Imaging)");
    expect(html).toContain("KEY IMAGES");
    expect(html).toContain("has-side-images");
    expect(html).toContain("width: 70%");
    expect(html).toContain("width: 30%");
  });

  it("only data:/same-origin srcs are ever emitted (no public PACS URLs by construction)", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-premium"));
    const srcs = [...html.matchAll(/class="dicom-img"[^>]*/g)];
    expect(srcs.length).toBe(2);
    expect(html).toMatch(/<img src="data:image\/jpeg;base64,AAA" class="dicom-img"/);
  });
});

describe("image reference → rendered path (Phase 10)", () => {
  it("builds the DICOMweb rendered path, with frames when present", () => {
    expect(renderedPathForReference({ studyInstanceUid: "1.2", seriesInstanceUid: "1.3", sopInstanceUid: "1.4", frameNumber: null }))
      .toBe("/dicom-web/studies/1.2/series/1.3/instances/1.4/rendered");
    expect(renderedPathForReference({ studyInstanceUid: "1.2", seriesInstanceUid: "1.3", sopInstanceUid: "1.4", frameNumber: 3 }))
      .toBe("/dicom-web/studies/1.2/series/1.3/instances/1.4/frames/3/rendered");
  });

  it("rejects incomplete or malformed references (never a broken URL in a report)", () => {
    expect(renderedPathForReference({ studyInstanceUid: null, seriesInstanceUid: "1.3", sopInstanceUid: "1.4", frameNumber: null })).toBeNull();
    expect(renderedPathForReference({ studyInstanceUid: "1.2", seriesInstanceUid: "not-a-uid!", sopInstanceUid: "1.4", frameNumber: null })).toBeNull();
    expect(renderedPathForReference({ studyInstanceUid: "1.2", seriesInstanceUid: "1.3", sopInstanceUid: "", frameNumber: null })).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters and tolerates null/undefined", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Ticket R1.2 — template-engine capabilities of the ONE renderer + strict
// compatibility guarantees for the R1.1 templates.
// ═════════════════════════════════════════════════════════════════════════════

import { compileTemplate } from "./presentationTemplateModel";
import { PRESENTATION_TEMPLATE_SEEDS, seedByKey } from "./presentationTemplateSeeds";

describe("R1.2 — CARE Classic/Premium byte compatibility", () => {
  it("rendering with a compiled seed is BYTE-IDENTICAL to the legacy R1.1 template object", () => {
    const model = baseModel({
      keyImages: [{ src: "data:image/jpeg;base64,AAA", caption: "T2", displayOrder: 0 }],
      isCritical: true, criticalNote: "call referrer",
      parameters: [{ name: "P", result: "1", unit: "u", refRange: "0-2", flag: "high" }],
    });
    for (const legacy of PRESENTATION_TEMPLATES) {
      const legacyHtml = renderReportDocument(model, legacy);
      const compiledHtml = renderReportDocument(model, compileTemplate(seedByKey(legacy.id)!));
      expect(compiledHtml, legacy.id).toBe(legacyHtml);
    }
  });

  it("no-image render is also byte-identical (full-width layout path)", () => {
    const model = baseModel({ keyImages: [] });
    for (const legacy of PRESENTATION_TEMPLATES) {
      expect(renderReportDocument(model, compileTemplate(seedByKey(legacy.id)!)), legacy.id)
        .toBe(renderReportDocument(model, legacy));
    }
  });
});

describe("R1.2 — template capabilities", () => {
  it("page size/orientation and margins flow into @page", () => {
    const gov = compileTemplate(seedByKey("government")!);
    const html = renderReportDocument(baseModel(), gov);
    expect(html).toContain("@page { size: A4 portrait; margin: 18mm 16mm; }");
    const landscape = compileTemplate({
      ...seedByKey("government")!,
      definition: { ...seedByKey("government")!.definition, page: { size: "A5", orientation: "landscape", margins: "8mm" } },
    });
    expect(renderReportDocument(baseModel(), landscape)).toContain("@page { size: A5 landscape; margin: 8mm; }");
  });

  it("template watermark renders escaped; disabled watermark emits nothing", () => {
    const gov = compileTemplate(seedByKey("government")!);
    const html = renderReportDocument(baseModel(), gov);
    expect(html).toContain(">GOVERNMENT COPY</div>");
    expect(html).toContain("template-watermark");
    const classic = compileTemplate(seedByKey("care-classic")!);
    expect(renderReportDocument(baseModel(), classic)).not.toContain('class="template-watermark" aria-hidden="true">');
  });

  it("image panel width is template-driven on screen (R1.4 — print no longer floats)", () => {
    const referrer = compileTemplate(seedByKey("referrer-copy")!);
    const html = renderReportDocument(baseModel({
      keyImages: [{ src: "data:image/jpeg;base64,AAA", caption: "X", displayOrder: 0 }],
    }), referrer);
    expect(html).toContain("has-side-images");
    expect(html).not.toMatch(/\.image-panel-side\s*\{\s*float:\s*right/);
  });

  it("header visibility toggles: government hides the logo; hidden header emits no .hdr div", () => {
    const gov = compileTemplate(seedByKey("government")!);
    const withLogo = baseModel();
    withLogo.clinic.logoDataUrl = "data:image/png;base64,AAA";
    expect(renderReportDocument(withLogo, gov)).not.toContain('class="logo"');
    const noHeader = compileTemplate({
      ...seedByKey("care-classic")!,
      definition: { ...seedByKey("care-classic")!.definition, header: { show: false, showLogo: true, showTagline: true, showContact: true, style: "underlined" } },
    });
    expect(renderReportDocument(withLogo, noHeader)).not.toContain('<div class="hdr">');
  });

  it("QR/footer/signature toggles suppress their blocks", () => {
    const base = seedByKey("care-classic")!;
    const noExtras = compileTemplate({
      ...base,
      definition: {
        ...base.definition,
        qr: { show: false },
        footer: { show: false },
        signature: { show: false, showImage: false },
      },
    });
    const html = renderReportDocument(baseModel({ showQrPlaceholder: true }), noExtras);
    expect(html).not.toContain('<div class="qr-block">');
    expect(html).not.toContain('<div class="ftr">');
    expect(html).not.toContain('<div class="sigs">');
  });

  it("page-break rules are template-driven (government uses orphans/widows 4)", () => {
    const gov = compileTemplate(seedByKey("government")!);
    expect(renderReportDocument(baseModel(), gov)).toContain("orphans: 4; widows: 4");
  });

  it("impression slot typography styles the impression box", () => {
    const base = seedByKey("care-v2")!;
    const html = renderReportDocument(baseModel({ impression: "sample impression" }), compileTemplate(base));
    expect(html).toMatch(/\.impression \{\s*font-weight:600;/);
  });

  it("every seed renders the same clinical content (presentation only)", () => {
    const model = baseModel({ impression: "No acute abnormality." });
    for (const s of PRESENTATION_TEMPLATE_SEEDS) {
      const html = renderReportDocument(model, compileTemplate(s));
      expect(html, s.templateKey).toContain("FINDINGS: Normal study.");
      expect(html, s.templateKey).toContain("No acute abnormality.");
      expect(html, s.templateKey).toContain("Sunita Sharma");
      expect(html, s.templateKey).toContain("RPT-20260711-001");
    }
  });
});

// ── R1.3 — enterprise image panel: key-image badge + adaptive sizing ─────────

describe("R1.3 — key-image badge", () => {
  const images = [
    { src: "data:image/jpeg;base64,AAA", caption: "T2 AXIAL", displayOrder: 0, sopInstanceUid: "1.2.3.4", isKeyImage: true },
    { src: "data:image/jpeg;base64,BBB", caption: "FLAIR", displayOrder: 1 },
  ];

  it("flagged images carry the KEY badge; unflagged ones don't", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-premium"));
    const cells = html.split("<figure");
    const t2Cell = cells.find((c) => c.includes("T2 AXIAL"))!;
    const flairCell = cells.find((c) => c.includes("FLAIR"))!;
    expect(t2Cell).toContain('<span class="key-image-badge">★ KEY</span>');
    expect(flairCell).not.toContain("key-image-badge\">");
  });

  it("no flags → no badge markup AND no badge CSS (R1.1 documents byte-unchanged)", () => {
    const html = renderReportDocument(
      baseModel({ keyImages: images.map((i) => ({ ...i, isKeyImage: false })) }),
      resolvePresentationTemplate("care-premium"),
    );
    expect(html).not.toContain("key-image-badge");
    // Classic header accent uses position:relative on .hdr — only assert the
    // key-image conditional block is absent (R1.1 compat: no .image-cell rule).
    expect(html).not.toMatch(/\.image-cell \{ position: relative; \}/);
    // The conditional must contribute ZERO bytes when false — .image-cell's
    // closing brace is directly followed by .dicom-img, exactly as in R1.1.
    expect(html).toContain("    }\n    .dicom-img");
  });

  it("badge renders in classic (inline) placement too — one renderer everywhere", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-classic"));
    expect(html).toContain("image-panel-inline");
    expect(html).toContain('<span class="key-image-badge">★ KEY</span>');
  });
});

describe("R1.3 — adaptive thumbnail viewport (0/1/5/20/100 images)", () => {
  it("every pre-R1.3 count (≤8) keeps the R1.1 800px; only new counts shrink", () => {
    expect(viewportForImageCount(0)).toBe(800);
    expect(viewportForImageCount(1)).toBe(800);
    expect(viewportForImageCount(5)).toBe(800);
    expect(viewportForImageCount(8)).toBe(800); // R1.1 maximum — compat boundary
    expect(viewportForImageCount(9)).toBe(560);
    expect(viewportForImageCount(20)).toBe(560);
    expect(viewportForImageCount(21)).toBe(420);
    expect(viewportForImageCount(50)).toBe(420);
    expect(viewportForImageCount(100)).toBe(320);
  });
});

// ── R1.4 — practical production cutover fixes ────────────────────────────────

describe("R1.4 — real QR code, never a fake placeholder", () => {
  it("no QR block at all when qrDataUrl is absent, even if the toggle is on", () => {
    const html = renderReportDocument(baseModel({ showQrPlaceholder: true, qrDataUrl: null }), resolvePresentationTemplate("care-classic"));
    expect(html).not.toContain('class="qr-block"');
    expect(html).not.toContain("SECURE"); // the old static placeholder text must never reappear
  });

  it("a real <img> QR renders when qrDataUrl is present and the toggle is on", () => {
    const html = renderReportDocument(
      baseModel({ showQrPlaceholder: true, qrDataUrl: "data:image/png;base64,AAA" }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain('class="qr-block"');
    expect(html).toContain('<img class="qr-mark" src="data:image/png;base64,AAA"');
    expect(html).not.toContain("SECURE");
  });

  it("qrDataUrl present but the toggle off still suppresses the block", () => {
    const html = renderReportDocument(baseModel({ showQrPlaceholder: false, qrDataUrl: "data:image/png;base64,AAA" }), resolvePresentationTemplate("care-classic"));
    expect(html).not.toContain('class="qr-block"');
  });

  it("template qrCfg.show=false suppresses the block even with data present", () => {
    const noQr = { ...resolvePresentationTemplate("care-classic"), qrCfg: { show: false } };
    const html = renderReportDocument(baseModel({ showQrPlaceholder: true, qrDataUrl: "data:image/png;base64,AAA" }), noQr);
    expect(html).not.toContain('class="qr-block"');
  });
});

describe("premium two-column print rail (page-1 images beside findings)", () => {
  const images = [
    { src: "data:image/jpeg;base64,AAA", caption: "T2 AXIAL", displayOrder: 0 },
    { src: "data:image/jpeg;base64,BBB", caption: "FLAIR", displayOrder: 1 },
  ];

  it("print keeps a 1-column image rail (not a 2-up gallery dumped after the text)", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-premium"));
    expect(html).not.toMatch(/\.image-panel-side\s*\{\s*float:\s*right/);
    expect(html).toMatch(/@media print[\s\S]*?\.content-area.has-side-images \.image-panel-side \.image-grid\s*\{\s*grid-template-columns:\s*1fr/);
    expect(html).not.toMatch(/\.content-area.has-side-images \.image-panel-side \.image-grid\s*\{\s*grid-template-columns:\s*repeat\(2/);
  });

  it("two-column table is not gated on min-width 1024px (A4 preview is ~794px)", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-premium"));
    expect(html).not.toContain("min-width: 1024px");
    expect(html).toContain(".content-area.has-side-images");
    expect(html).toContain("display: table");
    expect(html).toContain("table-layout: fixed");
  });

  it("fixed 4:3 viewport + cover default; framing CSS variables are emitted", () => {
    const html = renderReportDocument(baseModel({
      keyImages: [{ src: "data:image/jpeg;base64,AAA", caption: "T2", displayOrder: 0, framing: { zoom: 1.35, offsetX: -12, offsetY: 8, fitMode: "cover" } }],
    }), resolvePresentationTemplate("care-premium"));
    expect(html).toContain("aspect-ratio: 4 / 3");
    expect(html).toContain("object-fit: var(--img-fit, cover)");
    expect(html).toContain("--img-zoom:1.35");
    expect(html).toContain("--img-ox:-12%");
    expect(html).toContain("--img-oy:8%");
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("scale(1.35)");
    expect(html).toContain('data-image-count="1"');
    expect(html).toContain('[data-image-count="1"] .image-viewport { height: 78mm;');
    expect(html).toContain('[data-image-count="4"] .image-viewport { height: 30mm;');
  });

  it("7+ images keep 6 on the right rail and continue the rest below (no empty left column)", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      src: `data:image/jpeg;base64,A${i}`, caption: `IMG ${i}`, displayOrder: i,
    }));
    const html = renderReportDocument(baseModel({ keyImages: many }), resolvePresentationTemplate("care-premium"));
    expect(html).toContain('data-image-count="6"');
    expect(html).toContain("KEY IMAGES (continued)");
    expect(html).toContain("image-panel-overflow");
  });

  it("classic inline images are not wrapped in the premium viewport", () => {
    const html = renderReportDocument(baseModel({ keyImages: images }), resolvePresentationTemplate("care-classic"));
    expect(html).toContain("image-panel-inline");
    expect(html).not.toContain("image-viewport");
  });

  it("zero images never emit an empty right column", () => {
    const html = renderReportDocument(baseModel({ keyImages: [] }), resolvePresentationTemplate("care-premium"));
    expect(html).not.toContain("has-side-images");
    expect(html).not.toContain('class="image-panel image-panel-side');
    expect(html).not.toContain("KEY IMAGES");
  });

  it("four images use the medium print viewport height", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      src: `data:image/jpeg;base64,A${i}`, caption: `IMG ${i}`, displayOrder: i,
    }));
    const html = renderReportDocument(baseModel({ keyImages: four }), resolvePresentationTemplate("care-premium"));
    expect(html).toContain('data-image-count="4"');
    expect(html).toContain('[data-image-count="4"] .image-viewport { height: 30mm;');
  });
});

describe("R1.4 — report number no longer overlaps the banded title bar", () => {
  it("premium's study-title-bar clears the floated report-number span", () => {
    const html = renderReportDocument(baseModel(), resolvePresentationTemplate("care-premium"));
    expect(html).toMatch(/\.study-title-bar\s*\{[^}]*clear:\s*both/);
  });

  it("classic (no colored background) is unaffected", () => {
    const html = renderReportDocument(baseModel(), resolvePresentationTemplate("care-classic"));
    const rule = html.match(/\.study-title-bar\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toContain("clear: both");
  });
});

describe("R1.4 — header contact line never has a dangling leading bullet", () => {
  it("phone blank, email set → no leading bullet", () => {
    const html = renderReportDocument(
      baseModel({ clinic: { name: "Care Diagnostics", phone: "", email: "info@clinic.com" } }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("info@clinic.com<br/>");
    expect(html).not.toContain("• info@clinic.com");
  });

  it("both present → still joined with the bullet separator", () => {
    const html = renderReportDocument(
      baseModel({ clinic: { name: "Care Diagnostics", phone: "06432-1234", email: "info@clinic.com" } }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("06432-1234 • info@clinic.com");
  });
});

describe("R1.4 — screen_only print layout no longer blanks the printed page", () => {
  it("the renderer's own CSS never hides the report body on print (only .no-print UI chrome)", () => {
    // reportPresentation.ts has no knowledge of institutional styles; the
    // fix itself lives in patient-reports.ts no longer emitting a
    // `body { display: none }` customCss override for printLayout ===
    // "screen_only" (pinned separately against that route's source). This
    // pins the renderer's OWN unconditional CSS never hides the body itself
    // — only the legitimate `.no-print` UI-chrome rule uses display:none.
    const html = renderReportDocument(baseModel(), resolvePresentationTemplate("care-classic"));
    expect(html).not.toMatch(/\bbody\s*\{\s*display:\s*none/);
    expect(html).toContain(".no-print { display: none !important; }"); // legitimate, unrelated rule still present
  });
});
