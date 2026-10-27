/**
 * Server source contract for the title/demography/catalog backlog:
 * per-study studyDescription on multi-test orders (one bill-level string used
 * to be stamped on EVERY study and propagated to the modality via MWL),
 * department normalization in the study fan-out (case/whitespace variants
 * were SILENTLY skipped — a bill saved, a patient paid, no study existed),
 * and tests-catalog validation at the source (blank/duplicate names,
 * untrimmed departments).
 *
 * Pure logic (canonicalRadiologyDepartment) is unit-tested here too — the
 * helper lives in lib/radiologyDepartments.ts with no route dependencies.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalRadiologyDepartment } from "../lib/radiologyDepartments";

const here = dirname(fileURLToPath(import.meta.url));
const readRoute = (rel: string): string => readFileSync(join(here, rel), "utf8");
const readLib = (rel: string): string => readFileSync(join(here, "..", "lib", rel), "utf8");

const radiologyRoute = readRoute("radiology.ts");
const testsRoute = readRoute("tests.ts");
const departmentsLib = readLib("radiologyDepartments.ts");

describe("canonicalRadiologyDepartment — trim + case, never a silent skip", () => {
  it("exact canonical names survive", () => {
    expect(canonicalRadiologyDepartment("MRI")).toBe("MRI");
    expect(canonicalRadiologyDepartment("X-Ray")).toBe("X-Ray");
  });

  it("case and whitespace variants canonicalize", () => {
    expect(canonicalRadiologyDepartment(" mri ")).toBe("MRI");
    expect(canonicalRadiologyDepartment("x-ray")).toBe("X-Ray");
    expect(canonicalRadiologyDepartment("USG\t")).toBe("USG");
    expect(canonicalRadiologyDepartment("dexa")).toBe("DEXA");
  });

  it("spelled-out aliases canonicalize (the shapes CSV imports actually produce)", () => {
    expect(canonicalRadiologyDepartment("XRay")).toBe("X-Ray");
    expect(canonicalRadiologyDepartment("X Ray")).toBe("X-Ray");
  });

  it("non-radiology and garbage answer null", () => {
    expect(canonicalRadiologyDepartment("Pathology")).toBeNull();
    expect(canonicalRadiologyDepartment("")).toBeNull();
    expect(canonicalRadiologyDepartment(null)).toBeNull();
    expect(canonicalRadiologyDepartment("???")).toBeNull();
  });
});

describe("the study fan-out stamps each study with ITS OWN billed test", () => {
  it("the per-study description is computed, not copied from the bill", () => {
    const anchor = radiologyRoute.indexOf("export async function generateStudiesForOrder");
    const slice = radiologyRoute.slice(anchor, anchor + 6000);
    expect(slice).toContain("canonicalRadiologyDepartment");
    expect(slice).toMatch(/singleRadiologyTest/);
    expect(slice).toMatch(/perStudyDescription/);
    // The bill-level string is only trusted for a single-test order.
    expect(slice).toMatch(/singleRadiologyTest\s*\?\s*\(billLevelDescription\s*\|\|\s*ot\.testName\)\s*:\s*ot\.testName/);
  });

  it("the skipped tests are named, not silently dropped", () => {
    const anchor = radiologyRoute.indexOf("export async function generateStudiesForOrder");
    const end = radiologyRoute.indexOf("// ── Missing-study reconciliation", anchor);
    const slice = radiologyRoute.slice(anchor, end > 0 ? end : anchor + 9000);
    expect(slice).toMatch(/skipped\.push/);
    expect(slice).toMatch(/skipped\.length > 0/);
  });

  it("the exact-match list no longer decides membership alone", () => {
    const anchor = radiologyRoute.indexOf("export async function generateStudiesForOrder");
    const slice = radiologyRoute.slice(anchor, anchor + 3000);
    expect(slice).not.toContain("RADIOLOGY_DEPARTMENTS.includes(department)");
  });
});

describe("tests-catalog validation at the source", () => {
  it("create rejects blank/whitespace names after trimming", () => {
    const anchor = testsRoute.indexOf('testsRouter.post("/",');
    const slice = testsRoute.slice(anchor, anchor + 2200);
    expect(slice).toMatch(/\.trim\(\)/);
    expect(slice).toMatch(/name is required|name cannot be empty/i);
  });

  it("create rejects duplicate names case-insensitively", () => {
    const anchor = testsRoute.indexOf('testsRouter.post("/",');
    const slice = testsRoute.slice(anchor, anchor + 2600);
    expect(slice).toMatch(/sql`lower\(|lower\(testsTable\.name\)|name.*already in use.*name|already exists/i);
  });

  it("the department is normalized through the shared canonical map", () => {
    const anchor = testsRoute.indexOf('testsRouter.post("/",');
    const slice = testsRoute.slice(anchor, anchor + 2200);
    expect(slice).toContain("canonicalRadiologyDepartment");
  });

  it("the import path trims the department VALUE, not just the guard", () => {
    const anchor = testsRoute.indexOf('testsRouter.post("/import"');
    const slice = testsRoute.slice(anchor, anchor + 3200);
    expect(slice).toMatch(/department:\s*canonicalRadiologyDepartment\(|department\.trim\(\)/);
  });
});

describe("the shared department helper exists once", () => {
  it("one list, in one lib, imported by both routes", () => {
    expect(departmentsLib).toContain("export function canonicalRadiologyDepartment");
    expect(radiologyRoute).toContain('from "../lib/radiologyDepartments"');
    expect(testsRoute).toContain('from "../lib/radiologyDepartments"');
  });
});

const generatorRoute = readRoute("radiology-report-generator.ts");

describe("the server print route reads the same title authority", () => {
  it("the billed catalogue name outranks the DICOM description and the draft's studyName", () => {
    const anchor = generatorRoute.indexOf("const studyTitle = (");
    expect(anchor).toBeGreaterThan(0);
    const slice = generatorRoute.slice(anchor, anchor + 600);
    // Order in the || chain is the precedence.
    expect(slice.indexOf("catalogTestName")).toBeLessThan(slice.indexOf("worklist?.studyDescription"));
    expect(slice.indexOf("worklist?.studyDescription")).toBeLessThan(slice.indexOf("draft.studyName"));
    // The rule is named where it is stated (the comment above the chain).
    expect(generatorRoute.slice(Math.max(0, anchor - 500), anchor)).toContain("resolveCanonicalStudyTitle");
  });
});
