/**
 * PR #1171 — the sign-time half of demography-override persistence.
 *
 * `freezeSignedReportPresentation` captures the identity a report was signed
 * with via `captureReportIdentity` — which resolves from the worklist /
 * billed-study / patient-master, i.e. the UNCORRECTED values. These pins hold
 * the pure application of the draft's overrides onto that captured identity,
 * and source contracts for the wiring: the freeze actually consults the
 * promoted draft, and the draft reader prefers the draft the report came from.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDemographyOverridesToIdentity,
  type FrozenReportIdentity,
} from "./reportStudyIdentity";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const BASE: FrozenReportIdentity = {
  patientName: "UNCORRECTED NAME",
  uhid: "UH-1001",
  sex: "M",
  ageAtExamination: "61 Yrs",
  study: {
    accessionNumber: "ACC-1",
    studyDate: "2026-02-02",
    modality: "MR",
    studyDescription: "MRI BRAIN",
    referringDoctor: "DR. OLD REFERRER",
    studyInstanceUid: "1.2.3",
    documentedAge: "061Y",
    sex: "M",
  },
  capturedAt: "2026-10-24T00:00:00.000Z",
};

describe("applyDemographyOverridesToIdentity — the frozen half carries the correction", () => {
  it("1. every mapped field of the correction lands on the captured identity", () => {
    const out = applyDemographyOverridesToIdentity(BASE, {
      kind: "care.demography_overrides.v1",
      patientName: "CORRECTED NAME",
      age: "35 Yrs",
      sex: "F",
      uhid: "UH-9001",
      studyDescription: "MRI BRAIN WITH CONTRAST",
      studyDate: "01/02/2026",
      referringDoctor: "DR. NEW REFERRER",
    });
    expect(out.patientName).toBe("CORRECTED NAME");
    expect(out.ageAtExamination).toBe("35 Yrs");
    expect(out.sex).toBe("F");
    expect(out.uhid).toBe("UH-9001");
    expect(out.study.studyDescription).toBe("MRI BRAIN WITH CONTRAST");
    expect(out.study.studyDate).toBe("01/02/2026");
    expect(out.study.referringDoctor).toBe("DR. NEW REFERRER");
  });

  it("2. blank overrides change nothing — only a real correction counts", () => {
    const out = applyDemographyOverridesToIdentity(BASE, {
      kind: "care.demography_overrides.v1",
      patientName: "   ",
      age: "",
    });
    expect(out.patientName).toBe("UNCORRECTED NAME");
    expect(out.ageAtExamination).toBe("61 Yrs");
  });

  it("3. null overrides leave the identity byte-identical", () => {
    expect(applyDemographyOverridesToIdentity(BASE, null)).toEqual(BASE);
  });

  it("4. the input identity is never mutated, and capturedAt survives", () => {
    const out = applyDemographyOverridesToIdentity(BASE, {
      kind: "care.demography_overrides.v1",
      patientName: "CORRECTED NAME",
    });
    expect(BASE.patientName).toBe("UNCORRECTED NAME");
    expect(out.capturedAt).toBe(BASE.capturedAt);
    expect(out).not.toBe(BASE);
    expect(out.study).not.toBe(BASE.study);
  });

  it("5. dateOfBirth has no frozen slot — it is stored but the server identity is honest about what it prints", () => {
    // The server render prints no DOB line; the field round-trips in the
    // envelope for the client's own surfaces. Applying it must not invent a
    // slot or throw.
    const out = applyDemographyOverridesToIdentity(BASE, {
      kind: "care.demography_overrides.v1",
      dateOfBirth: "1990-04-01",
    });
    expect((out as unknown as Record<string, unknown>).dateOfBirth).toBeUndefined();
    expect(out.patientName).toBe("UNCORRECTED NAME");
  });

  it("6. unmapped override study fields (accession, modality) are not invented either", () => {
    const out = applyDemographyOverridesToIdentity(BASE, {
      kind: "care.demography_overrides.v1",
    } as never);
    expect(out.study.accessionNumber).toBe("ACC-1");
    expect(out.study.modality).toBe("MR");
  });
});

describe("PR #1171 wiring — the freeze consults the promoted draft", () => {
  const reports = read("routes/patient-reports.ts");
  const identity = read("lib/radiologyIdentity.ts");
  const generator = read("routes/radiology-report-generator.ts");
  const persistence = read("../../diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts");
  const clinical = read("../../diagnostic-erp/src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
  const demography = read("../../diagnostic-erp/src/lib/reportDemography.ts");

  it("7. freezeSignedReportPresentation applies the draft's overrides to the captured identity", () => {
    const at = reports.indexOf("async function freezeSignedReportPresentation");
    expect(at).toBeGreaterThan(-1);
    const block = reports.slice(at, at + 3000);
    expect(block).toContain("loadDemographyOverridesForSignedReport");
    expect(block).toContain("applyDemographyOverridesToIdentity");
    // the applied result is what gets frozen, not the raw capture
    expect(block).toMatch(/freezeReportPresentation\(\s*reportId,\s*record,\s*\w*[Ii]dentity/);
  });

  it("8. the draft reader prefers the promoted draft, then the latest for the study key", () => {
    const at = identity.indexOf("export async function loadDemographyOverridesForSignedReport");
    expect(at).toBeGreaterThan(-1);
    const block = identity.slice(at, at + 2200);
    expect(block).toContain("finalReportId");
    expect(block).toContain("orderBy(desc(radiologyReportDraftsTable.updatedAt), desc(radiologyReportDraftsTable.id))");
  });

  it("9. SaveDraftBody declares the demographyOverrides key so the schema does not strip it", () => {
    const at = generator.indexOf("const SaveDraftBody = z.object({");
    const block = generator.slice(at, at + 6000);
    expect(block).toContain("demographyOverrides:");
    // and the patch builder receives it (rest goes in whole)
    expect(generator).toContain("buildCareStructuredJsonPatch(rest)");
  });

  it("10. the workspace saves the overrides on every draft save", () => {
    const at = persistence.indexOf("saveRadiologyDraft<DraftSaveResponse>");
    const block = persistence.slice(at, at + 4200);
    expect(block).toContain("demographyOverrides");
  });

  it("11. the workspace restores the overrides when a draft reopens", () => {
    // The hydrate call itself — the setter fed by the envelope reader — not
    // the import statement that also names the reader.
    expect(persistence).toMatch(
      /setDemographyOverrides\(\s*\n?\s*extractDemographyOverridesFromStructuredJson\(draft\.structuredJson\)/,
    );
  });

  it("12. useWorkspaceClinicalUi passes the state and its setter into the persistence hook", () => {
    const at = clinical.indexOf("} = useDraftPersistence({");
    const block = clinical.slice(at, at + 2200);
    expect(block).toContain("demographyOverrides,");
    expect(block).toContain("setDemographyOverrides,");
  });

  it("13. the client envelope reader exists beside the canonical demography model", () => {
    expect(demography).toContain("export function extractDemographyOverridesFromStructuredJson");
  });
});
