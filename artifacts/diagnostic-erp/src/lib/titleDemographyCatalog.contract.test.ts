/**
 * Source contract + unit cover for the title/demography/catalog backlog —
 * the flagged items this PR closes:
 *
 *   1. THREE title authorities picked independently (signed artifact =
 *      DICOM description, print-like-final = billed name, preview = format
 *      title) — one study, three different headings. One precedence now:
 *      billed name → DICOM description → applied format title.
 *   2. Client/server age precedence parity — the client printed the STATED
 *      age first, the server DOB-at-examination first; a patient with both
 *      fields disagreed with themselves across surfaces.
 *   3. The UHID edit box edited the numeric patient PK — inert by
 *      construction, because every render reads `uhid` first.
 *   4/5 (server-side) are pinned in signingDraftBacklog's neighbour:
 *      titleDemographyCatalog.servercontract.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCanonicalStudyTitle } from "./zai-workspace/fullReportFormat";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, rel), "utf8");

const fullReportFormat = read("./zai-workspace/fullReportFormat.ts");
const clinicalUi = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const finalizeHook = read("../hooks/radiology-workspace/useStudyFinalize.ts");
const demographyCard = read("../components/radiology/ReportDemographyCard.tsx");
const demographyLib = read("./reportDemography.ts");
const ageLib = read("./age.ts");
const testsPage = read("../pages/Tests.tsx");

describe("resolveCanonicalStudyTitle — one precedence, three inputs", () => {
  it("the billed name wins over the DICOM description and the format title", () => {
    expect(
      resolveCanonicalStudyTitle({
        billedName: "MRI LS Spine with Whole Spine Screening",
        dicomDescription: "MRI LUMBAR SACRAL SPINE PLAIN",
        formatTitle: "MRI LUMBOSACRAL SPINE",
      }),
    ).toBe("MRI LS Spine with Whole Spine Screening");
  });

  it("the DICOM description beats the format title when no billed name exists", () => {
    expect(
      resolveCanonicalStudyTitle({ billedName: null, dicomDescription: "MRI BRAIN PLAIN", formatTitle: "MRI Brain" }),
    ).toBe("MRI BRAIN PLAIN");
  });

  it("the format title is the last real authority", () => {
    expect(resolveCanonicalStudyTitle({ formatTitle: "MRI Brain" })).toBe("MRI Brain");
  });

  it("blank strings fall through, not short-circuit", () => {
    expect(resolveCanonicalStudyTitle({ billedName: "   ", dicomDescription: "", formatTitle: "MRI Brain" })).toBe("MRI Brain");
  });

  it("nothing to say answers empty — the caller names its own last resort", () => {
    expect(resolveCanonicalStudyTitle({})).toBe("");
  });
});

describe("the three doors read the same authority", () => {
  it("the exported heading (preview + client PDF) is canonical, not format-title-first", () => {
    const anchor = clinicalUi.indexOf("const studyNameForExport = ");
    expect(anchor).toBeGreaterThan(0);
    const slice = clinicalUi.slice(anchor, anchor + 700);
    expect(slice).toContain("resolveCanonicalStudyTitle(");
    // Format title is an INPUT now, not the winner.
    expect(slice).toMatch(/formatTitle:\s*appliedFormatReportTitle/);
    expect(slice).toMatch(/billedName:/);
  });

  it("the signed artifact's titleFallback is the same chain", () => {
    const anchor = clinicalUi.indexOf("titleFallback:");
    expect(anchor).toBeGreaterThan(0);
    const slice = clinicalUi.slice(anchor, anchor + 600);
    expect(slice).toContain("resolveCanonicalStudyTitle(");
    // The billed name outranks the DICOM description in the fallback too.
    expect(slice.indexOf("testName")).toBeLessThan(slice.indexOf("studyDescription"));
  });

  it("the finalize gauntlet prefers the canonical fallback over the queue row's DICOM description", () => {
    const anchor = finalizeHook.indexOf("const primaryStudyTitle =");
    expect(anchor).toBeGreaterThan(0);
    const slice = finalizeHook.slice(anchor, anchor + 400);
    expect(slice).toMatch(/opts\.titleFallback\?\.trim\(\)/);
    expect(slice.indexOf("titleFallback")).toBeLessThan(slice.indexOf("studyDescription"));
  });
});

describe("age precedence parity — the client mirrors the server rule", () => {
  it("the demography resolution asks DOB-at-examination first", () => {
    const anchor = demographyLib.indexOf("export function resolveDisplayAge");
    const slice = demographyLib.slice(anchor, anchor + 2800);
    expect(slice).toContain("yearsFromDob");
    // DOB is evaluated BEFORE the stated age, mirroring formatAgeAtExamination
    // — and only against a usable examination date (the server's
    // ageYearsBetween refuses a null as-of; so does this mirror now).
    expect(slice.indexOf("yearsFromDob")).toBeLessThan(slice.indexOf("formatAgeForPrint"));
    expect(slice).toContain("dob && asOf ? yearsFromDob(dob, asOf) : null");
  });

  it("yearsFromDob is exported for that mirror (age.ts)", () => {
    expect(ageLib).toContain("export function yearsFromDob");
  });
});

describe("the UHID edit box edits the UHID", () => {
  it("the editable field list keys the UHID field, not the numeric PK", () => {
    expect(demographyCard).not.toMatch(/\{\s*key:\s*"patientId",\s*label:\s*"Patient ID \/ UHID"\s*\}/);
    expect(demographyCard).toMatch(/\{\s*key:\s*"uhid",\s*label:\s*"UHID"\s*\}/);
  });
});

describe("the tests catalog page stops creating its own duplicates", () => {
  it("DEXA is a selectable department (the server's map accepts it)", () => {
    expect(testsPage).toContain('"DEXA"');
  });

  it("the submit path trims name and code before saving", () => {
    const anchor = testsPage.indexOf("const onSubmit = ");
    const slice = testsPage.slice(anchor, anchor + 2200);
    expect(slice).toMatch(/const name = \(data\.name \?\? ""\)\.trim\(\)/);
    expect(slice).toMatch(/const code = \(data\.code \?\? ""\)\.trim\(\)/);
    expect(slice).toMatch(/\bname,\s*\n\s*code,/);
  });

  it("a duplicate name warns inline before the save is attempted", () => {
    const anchor = testsPage.indexOf("const onSubmit = ");
    const slice = testsPage.slice(anchor, anchor + 2200);
    expect(slice).toMatch(/already exists|duplicate/i);
  });
});
