import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoGenerateReport,
  USG_TEMPLATES,
  USG_TEMPLATE_SKELETONS,
  USG_STRUCTURED_TEMPLATE_PRESETS,
  type AutoGenInput,
  type AutoGenOutput,
} from "./usgReportTemplates";

// Template-store consolidation regression suite.
//
// __fixtures__/usgReportTemplates.golden.json was captured from the
// PRE-consolidation renderer (the version with the skeleton text inlined in
// each switch case) using the exact fixtures below. The default render path
// must stay byte-identical across the skeleton/bindings split — this is the
// proof that moving the skeletons into structured_report_templates changed
// nothing clinically until an admin deliberately edits a template.

const GOLDEN: Record<string, AutoGenOutput> = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "usgReportTemplates.golden.json"), "utf8"),
);

const FIXTURE_MEASUREMENT = {
  id: 42,
  source: "ocr",
  crl: "62 mm", crlConfidence: "high",
  ga: "12w4d", gaConfidence: "high",
  edd: "2027-01-20", eddConfidence: "high",
  fhr: "156", fhrConfidence: "high",
  bpd: "82 mm", bpdConfidence: "high",
  hc: "300 mm", hcConfidence: "high",
  ac: "300 mm", acConfidence: "low",
  fl: "65 mm", flConfidence: "high",
  efw: "2100 g", efwConfidence: "high",
  liquorAfi: "12",
  placentaPosition: "Anterior, upper segment",
  fetalPresentation: "Cephalic",
  uterusSize: "78 x 42 x 51 mm", uterusSizeConfidence: "high",
  endometrium: "8 mm", endometriumConfidence: "high",
  rightOvary: "30 x 20 mm", rightOvaryConfidence: "high",
  leftOvary: "28 x 19 mm", leftOvaryConfidence: "low",
  liverSize: "14.2 cm", liverSizeConfidence: "high",
  gbWall: "2.5", gbWallConfidence: "high",
  cbd: "4.1", cbdConfidence: "high",
  spleenSize: "10.5 cm", spleenSizeConfidence: "high",
  rightKidney: "10.2 x 4.4 cm", rightKidneyConfidence: "high",
  leftKidney: "10.6 x 4.7 cm", leftKidneyConfidence: "high",
  prostateVolume: "24", prostateVolumeConfidence: "high",
} as any;

const FIXTURE_DOPPLER = [
  {
    id: 7, vesselName: "Right CCA", side: "right",
    psv: "82", edv: "24", ri: "0.71", pi: "1.4", sdRatio: "3.4",
    waveformLabel: "Triphasic", waveformDescription: "Normal low-resistance waveform.",
  },
  {
    id: 9, vesselName: "Left ICA", side: "left",
    psv: "64", edv: "22", ri: "0.66", pi: null, sdRatio: null,
    waveformLabel: null, waveformDescription: null,
  },
] as any[];

const BASE: Omit<AutoGenInput, "templateId"> = {
  measurement: FIXTURE_MEASUREMENT,
  dopplerMeasurements: FIXTURE_DOPPLER,
  patientName: "SITA DEVI",
  patientAge: "28 Y",
  patientSex: "F",
  referringDoctor: "Dr. A. Kumar",
  accessionNumber: "ACC-2026-0042",
  studyDate: "2026-07-16",
  lmp: "2026-04-20",
};

const EMPTY: Omit<AutoGenInput, "templateId"> = {
  measurement: null,
  dopplerMeasurements: [],
  patientName: null, patientAge: null, patientSex: null,
  referringDoctor: null, accessionNumber: null, studyDate: "2026-07-16", lmp: null,
};

describe("golden regression — default render is byte-identical to the pre-consolidation renderer", () => {
  for (const t of USG_TEMPLATES) {
    test(`${t.id} — with approved measurements`, () => {
      expect(autoGenerateReport({ templateId: t.id, ...BASE })).toEqual(GOLDEN[t.id]);
    });
    test(`${t.id} — with no measurements at all`, () => {
      expect(autoGenerateReport({ templateId: t.id, ...EMPTY })).toEqual(GOLDEN[`${t.id}__empty`]);
    });
  }
});

describe("skeleton override (admin-edited structured_report_templates row)", () => {
  test("override skeleton is rendered with the same safety bindings", () => {
    const out = autoGenerateReport(
      { templateId: "OB_GROWTH", ...BASE },
      { skeletonOverride: "CUSTOM BODY\nBPD is ${bpd} and AC is ${ac}\nIMPRESSION:" },
    );
    expect(out.content).toContain("CUSTOM BODY");
    expect(out.content).toContain("BPD is 82 mm");
    // Low-confidence guard survives the override — AC was flagged low.
    expect(out.content).toContain("AC is [___ low confidence – verify]");
    // System-owned header and disclaimer still wrap the custom body.
    expect(out.content).toContain("USG OBSTETRIC — GROWTH SCAN");
    expect(out.content).toContain("This report is generated from approved measurements only.");
  });

  test("unknown ${tokens} in an admin skeleton degrade to '___', never leak raw", () => {
    const out = autoGenerateReport(
      { templateId: "KUB", ...BASE },
      { skeletonOverride: "Kidney: ${rightKidney}   Oops: ${notARealToken}" },
    );
    expect(out.content).toContain("Kidney: 10.2 x 4.4 cm");
    expect(out.content).toContain("Oops: ___");
    expect(out.content).not.toContain("${notARealToken}");
  });

  test("blank/whitespace override falls back to the built-in skeleton", () => {
    const withBlank = autoGenerateReport({ templateId: "THYROID", ...BASE }, { skeletonOverride: "   " });
    const withDefault = autoGenerateReport({ templateId: "THYROID", ...BASE });
    expect(withBlank).toEqual(withDefault);
  });

  test("filled/skipped counters are computed from bindings, independent of the skeleton", () => {
    const defaultOut = autoGenerateReport({ templateId: "OB_GROWTH", ...BASE });
    const overrideOut = autoGenerateReport(
      { templateId: "OB_GROWTH", ...BASE },
      { skeletonOverride: "minimal" },
    );
    expect(overrideOut.filledFieldCount).toBe(defaultOut.filledFieldCount);
    expect(overrideOut.skippedLowConfidenceCount).toBe(defaultOut.skippedLowConfidenceCount);
  });
});

describe("USG_STRUCTURED_TEMPLATE_PRESETS — canonical-table seed rows", () => {
  test("one row per template, keyed modality USG + studyType = UsgTemplateId", () => {
    expect(USG_STRUCTURED_TEMPLATE_PRESETS).toHaveLength(USG_TEMPLATES.length);
    for (const t of USG_TEMPLATES) {
      const row = USG_STRUCTURED_TEMPLATE_PRESETS.find((r) => r.studyType === t.id);
      expect(row).toBeDefined();
      expect(row!.modality).toBe("USG");
      expect(row!.templateName).toBe(t.label);
      expect(row!.isPreset).toBe(true);
      // The seeded skeleton is exactly the built-in default — no drift.
      expect(row!.defaultFindings).toBe(USG_TEMPLATE_SKELETONS[t.id].skeleton);
    }
  });

  test("sectionsJson documents the placeholders actually present in the skeleton", () => {
    const row = USG_STRUCTURED_TEMPLATE_PRESETS.find((r) => r.studyType === "OB_GROWTH")!;
    const sections = JSON.parse(row.sectionsJson);
    expect(sections.kind).toBe("usg-autofill-skeleton");
    for (const token of ["bpd", "hc", "ac", "fl", "efw", "ga", "edd", "fhr", "afi", "placenta", "presentation"]) {
      expect(sections.placeholders).toContain(token);
    }
  });
});
