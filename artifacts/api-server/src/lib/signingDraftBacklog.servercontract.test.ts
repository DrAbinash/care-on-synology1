/**
 * Server-side source contract for the signing/draft-integrity backlog:
 * signing freezes every uncovered picker reference (so the signed artifact
 * carries the pictures the pre-sign preview showed, without depending on
 * PACS), the legacy finalize stamps final_report_id like the structured one,
 * and every multi-draft picker agrees on ONE ordering rule — most recently
 * updated wins, id as the deterministic tiebreaker (the asc(id) pickers could
 * resolve a signed report's images from a stale draft).
 *
 * The behavioural halves live in frozenKeyImages.test.ts (DB-gated: the
 * freeze helper, the ordering pickers) — this file pins the ROUTE wiring the
 * route harnesses cannot reach cheaply.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readServer = (rel: string): string => readFileSync(join(here, "..", "routes", rel), "utf8");
const readLib = (rel: string): string => readFileSync(join(here, rel), "utf8");

const patientReports = readServer("patient-reports.ts");
const frozenKeyImages = readLib("frozenKeyImages.ts");
const reportImages = readLib("reportImages.ts");
const radiologyIdentity = readLib("radiologyIdentity.ts");
const generatorRoutes = readServer("radiology-report-generator.ts");

describe("signing freezes the uncovered picker refs", () => {
  it("the helper exists beside the frozen-image machinery it extends", () => {
    expect(frozenKeyImages).toContain("export async function freezeUncoveredImageRefsForSign");
  });

  it("the structured signed path calls it with the signed draft", () => {
    const signedBlock = patientReports.slice(
      patientReports.indexOf('if (outcome.kind === "signed")'),
      patientReports.indexOf('if (outcome.kind === "signed")') + 1200,
    );
    expect(signedBlock).toContain("freezeUncoveredImageRefsForSign");
    expect(signedBlock).toContain("outcome.draftId");
  });

  it("the legacy path stamps the draft AND freezes its refs — the flag-off majority", () => {
    const legacyBlock = patientReports.slice(
      patientReports.indexOf("const row = bound"),
      patientReports.indexOf("const row = bound") + 2400,
    );
    expect(legacyBlock).toContain("finalReportId");
    expect(legacyBlock).toContain("freezeUncoveredImageRefsForSign");
    expect(legacyBlock).toContain("signDraftId");
  });
});

describe("the amendment path signs with the same freeze (#1158 follow-up)", () => {
  const amendStart = patientReports.indexOf('patientReportsRouter.post("/:id/amend"');
  const amendEnd = patientReports.indexOf("// PCPNDT server-side finalize guard");
  const amendBlock = amendStart >= 0 && amendEnd > amendStart ? patientReports.slice(amendStart, amendEnd) : "";

  it("POST /:id/amend freezes the amendment draft's uncovered refs after commit", () => {
    expect(amendBlock).toContain("freezeUncoveredImageRefsForSign");
    expect(amendBlock).toContain("freezeCtx");
    expect(amendBlock).toContain("frozenImageRefs");
  });

  it("the freeze lands BEFORE the redelivery obligations — an auto-send job must not race it", () => {
    const freezeAt = amendBlock.indexOf("freezeUncoveredImageRefsForSign");
    const obligationsAt = amendBlock.indexOf("createObligationsForAmendment");
    expect(freezeAt).toBeGreaterThanOrEqual(0);
    expect(obligationsAt).toBeGreaterThanOrEqual(0);
    expect(freezeAt).toBeLessThan(obligationsAt);
  });

  it("a freeze failure never throws over the signed amendment (own try/catch, log line names the path)", () => {
    expect(amendBlock).toContain("freeze-at-amend failed");
    expect(amendBlock).toContain("signed amendment unaffected");
  });
});

describe("multi-draft pickers agree: most recently updated wins, id breaks ties", () => {
  it("the signed-print binding fallback no longer prefers the LOWEST id", () => {
    const binding = frozenKeyImages.slice(
      frozenKeyImages.indexOf("async function findDraftThroughWorklistBinding"),
      frozenKeyImages.indexOf("async function findDraftThroughWorklistBinding") + 900,
    );
    expect(binding).not.toContain("asc(radiologyReportDraftsTable.id)");
    expect(binding).toContain("desc(radiologyReportDraftsTable.updatedAt)");
    expect(binding).toContain("desc(radiologyReportDraftsTable.id)");
  });

  it("resolveReportKeyImages no longer prefers the LOWEST id", () => {
    const fn = reportImages.slice(
      reportImages.indexOf("export async function resolveReportKeyImages"),
      reportImages.indexOf("export async function resolveReportKeyImages") + 900,
    );
    expect(fn).not.toContain("asc(radiologyReportDraftsTable.id)");
    expect(fn).toContain("desc(radiologyReportDraftsTable.updatedAt)");
    expect(fn).toContain("desc(radiologyReportDraftsTable.id)");
  });

  it("the stamped lookup is aligned too (one rule, every picker)", () => {
    const fn = frozenKeyImages.slice(
      frozenKeyImages.indexOf("export async function resolveReportPrintKeyImagesDetailed"),
      frozenKeyImages.indexOf("export async function resolveReportPrintKeyImagesDetailed") + 900,
    );
    expect(fn).not.toContain("asc(radiologyReportDraftsTable.id)");
  });

  it("the draft list route breaks ties deterministically", () => {
    const fn = generatorRoutes.slice(
      generatorRoutes.indexOf('"/drafts"'),
      generatorRoutes.indexOf('"/drafts"') + 1200,
    );
    expect(fn).toContain("desc(radiologyReportDraftsTable.updatedAt)");
    expect(fn).toContain("desc(radiologyReportDraftsTable.id)");
  });

  it("the report-identity lookup breaks ties deterministically", () => {
    expect(radiologyIdentity).toContain("desc(radiologyReportDraftsTable.id)");
  });
});
