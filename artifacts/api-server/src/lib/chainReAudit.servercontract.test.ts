/**
 * Server-side source contract for the chain re-audit (bill desk → demography →
 * name of test → technique → findings → impression → recommendation → print).
 *
 * The behavioural halves live in the unit files beside the modules
 * (reportStudyIdentity.test.ts — the sex vocabulary; impressionFormatting.test.ts
 * — the heading case). This file pins the ROUTE wiring the route harnesses
 * cannot reach cheaply: the print-preview Test row and heading-case param, and
 * the reporting-studio relay's freeze-at-sign parity with the three in-app
 * signing paths (#1158/#1160).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readLib = (rel: string): string => readFileSync(join(here, rel), "utf8");
const readServer = (rel: string): string => readFileSync(join(here, "..", "routes", rel), "utf8");

const reportStudyIdentity = readLib("reportStudyIdentity.ts");
const generatorRoutes = readServer("radiology-report-generator.ts");
const studioRelay = readServer("internal-reporting-studio.ts");

describe("demography — one sex vocabulary on the signed artifact", () => {
  it("patientFactsFromMaster routes the master's gender through the DICOM normalizer", () => {
    const fn = reportStudyIdentity.slice(
      reportStudyIdentity.indexOf("export function patientFactsFromMaster"),
      reportStudyIdentity.indexOf("export function patientFactsFromMaster") + 1000,
    );
    expect(fn).toContain("genderToDicomSex(row.gender)");
    expect(fn).not.toContain("sex: trimmed(row.gender)");
  });
});

describe("name of test — the draft preview's Test row keeps the heading's middle source", () => {
  it("the Test identity row falls through the DICOM description like the heading chain does", () => {
    const row = generatorRoutes.slice(
      generatorRoutes.indexOf('{ key: "testName", label: "Test"'),
      generatorRoutes.indexOf('{ key: "testName", label: "Test"') + 200,
    );
    expect(row).toContain("catalogTestName ?? worklist?.studyDescription ?? draft.studyName");
  });
});

describe("print — the draft print-preview honors the clinic's heading case", () => {
  const route = generatorRoutes.slice(
    generatorRoutes.indexOf('"/drafts/:id/print-preview"'),
    generatorRoutes.indexOf('"/drafts/:id/print-preview"') + 8000,
  );

  it("the route parses a headingCase query parameter", () => {
    expect(route).toContain("parseHeadingCase(req.query.headingCase)");
  });

  it("the Technique heading and the stored section names are case-formatted", () => {
    expect(route).not.toContain('<div class="section-heading">Technique</div>');
    expect(route).not.toContain('<div class="section-heading">Findings</div>');
  });

  it("the impression section receives the parsed case", () => {
    expect(route).toContain("renderImpressionSectionHtml(impressionBullets, impressionStyle, esc, headingCase)");
  });
});

describe("print — the reporting-studio relay signs with the same freeze (#1158/#1160 parity)", () => {
  const relay = studioRelay.slice(
    studioRelay.indexOf("router.post(\"/finalize\""),
    studioRelay.length,
  );

  it("a relay-created signed report freezes the workspace draft's uncovered picker refs", () => {
    expect(relay).toContain("freezeUncoveredImageRefsForSign");
  });

  it("the freeze looks the draft up through the worklist binding with the one ordering rule", () => {
    expect(relay).toContain("desc(radiologyReportDraftsTable.updatedAt)");
    expect(relay).toContain("desc(radiologyReportDraftsTable.id)");
  });

  it("a freeze failure never fails the relayed finalize", () => {
    expect(relay).toContain("catch");
    expect(relay).toMatch(/freeze-at-studio-relay failed|reporting-studio freeze failed/);
  });
});
