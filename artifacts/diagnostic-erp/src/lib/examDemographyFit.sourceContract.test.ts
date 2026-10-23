/**
 * Source contracts — the BillingDesk advisory is actually wired to the
 * resolved patient and the selected tests, and it stays ADVISORY: no save
 * path consults it. The unit contracts in examDemographyFit.test.ts pin the
 * matcher; these pins guard the wiring so the banner can never silently
 * detach from the cart, or quietly grow into a gate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const DESK = "pages/BillingDesk.tsx";
const LIB = "lib/examDemographyFit.ts";

const ADVISORY_START = "// ── Exam/demography advisory";
const ADVISORY_END = "// ── Test actions ──";

describe("exam/demography advisory — BillingDesk wiring", () => {
  const desk = read(DESK);

  it("1. the desk imports the ONE checker (no inline keyword logic)", () => {
    expect(desk).toContain('checkExamDemographyFit } from "@/lib/examDemographyFit"');
    // Exactly one call site — the memo. Not in any mutation, not in addTest.
    const calls = desk.split("checkExamDemographyFit(").length - 1;
    expect(calls).toBe(1);
  });

  it("2. the memo reads the CART and the patient-in-view (existing first, typed new patient second)", () => {
    const memo = desk.slice(
      desk.indexOf(ADVISORY_START),
      desk.indexOf(ADVISORY_END),
    );
    expect(memo).toContain("const examDemographyWarnings = useMemo");
    expect(memo).toContain("selectedTests");
    // Existing patient wins; the half-typed new-patient form is the fallback.
    expect(memo.indexOf("selectedPatient")).toBeGreaterThan(-1);
    expect(memo.indexOf("newPatient")).toBeGreaterThan(-1);
    expect(memo.indexOf("selectedPatient")).toBeLessThan(memo.indexOf("newPatient"));
    // The memo is pure derivation — it renders nothing and throws nothing.
    expect(memo).not.toContain("throw");
    expect(memo).not.toContain("return <");
  });

  it("3. the advisory renders inside the Selected Tests card, amber, with the message text", () => {
    const desk2 = read(DESK);
    const cardStart = desk2.indexOf("Selected Tests (");
    const testidAt = desk2.indexOf('data-testid="billing-exam-demography-warning"');
    expect(testidAt).toBeGreaterThan(-1);
    // …after the Selected Tests card header…
    expect(testidAt).toBeGreaterThan(cardStart);
    // …inside the card (before the Packages sub-block), amber like the duplicate-bill banner.
    // ">Packages<" — the sub-header text — not the substring inside "selectedPackages".
    const block = desk2.slice(cardStart, desk2.indexOf(">Packages<", cardStart));
    expect(block).toContain("billing-exam-demography-warning");
    expect(block).toContain("AlertTriangle");
    expect(block).toContain("w.message");
    // Advisory-only: only rendered when warnings exist.
    expect(block).toContain("examDemographyWarnings.length > 0");
  });

  it("4. ADVISORY ONLY — no save path consults the checker or the warnings", () => {
    const desk3 = read(DESK);
    const saveFlow = desk3.slice(
      desk3.indexOf("const generateMut = useMutation"),
      desk3.indexOf("const filteredTests = allTests"),
    );
    expect(saveFlow).not.toContain("checkExamDemographyFit");
    expect(saveFlow).not.toContain("examDemographyWarnings");
    // The register mutation stays gate-free too.
    const registerFlow = desk3.slice(
      desk3.indexOf("const createPatientMut = useMutation"),
      desk3.indexOf("const finishFormFPopupFlow"),
    );
    expect(registerFlow).not.toContain("checkExamDemographyFit");
    expect(registerFlow).not.toContain("examDemographyWarnings");
  });

  it("5. the desk carries no exam-keyword knowledge of its own", () => {
    expect(/prostate|uterus|follicular|scrotum|mammograph/i.test(desk)).toBe(false);
  });
});

describe("exam/demography advisory — the lib keeps one catalog", () => {
  it("6. ONE rule table, declared once, with the sentinel-DOB rule reused from ./age", () => {
    const lib = read(LIB);
    expect(lib.split("EXAM_RULES").length - 1).toBeGreaterThanOrEqual(1);
    // Declared exactly once as the module-level catalog…
    expect(lib.split("const EXAM_RULES").length - 1).toBe(1);
    // …reuses the ONE sentinel-DOB rule instead of re-declaring 1900-01-01.
    expect(lib).toContain('from "./age"');
    expect(lib).toContain("isSentinelDob");
    // The three (and only three) advisory codes.
    expect(lib).toContain('"sex_exam_mismatch"');
    expect(lib).toContain('"age_exam_mismatch"');
    expect(lib).toContain('"sex_missing_for_exam"');
    // Deterministic by construction: no Date.now / Math.random in the check.
    expect(lib).not.toContain("Math.random");
  });
});
