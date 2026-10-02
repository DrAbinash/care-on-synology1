import { describe, expect, test } from "vitest";
import { containsPhi, detectPhiCategories, scrubPhiText } from "./phiText";

// The clinical-note prompt is the shape that actually leaves CARE today, so the
// detector is tested against it verbatim rather than against invented examples.
const CLINICAL_NOTE = `You are a clinical documentation assistant for a diagnostic center.

Patient: Ananya Sharma
ID: EXP-2610-0016
Gender: F
Date of Birth: 1992-04-30
Blood Group: B+

Recent Diagnostic Tests:
US001 (USG Whole Abdomen) — Imaging — Status: completed`;

describe("detectPhiCategories", () => {
  test("catches the clinical-note prompt as shipped", () => {
    const found = detectPhiCategories(CLINICAL_NOTE);
    expect(found).toContain("name");
    expect(found).toContain("patient_id");
    expect(found).toContain("date_of_birth");
  });

  test("recognises the Indian hospital label vocabulary", () => {
    expect(detectPhiCategories("UHID: 2024/88123")).toContain("patient_id");
    expect(detectPhiCategories("Patient Name: Ramesh")).toContain("name");
    expect(detectPhiCategories("DOB 30-04-1992")).toContain("date_of_birth");
    expect(detectPhiCategories("Mobile: 9812345678")).toContain("phone");
    expect(detectPhiCategories("Address: 12 MG Road, Pune")).toContain("address");
  });

  test("flags an unlabelled mobile and email, which appear in free-text referrals", () => {
    expect(detectPhiCategories("call 9812345678 for review")).toContain("phone");
    expect(detectPhiCategories("referred via a.b@clinic.example")).toContain("email");
  });

  test("clean radiology prose is not flagged", () => {
    const clean = [
      "MRI BRAIN WITH CONTRAST.",
      "The study demonstrates a 6 mm ring-enhancing lesion in the right basal ganglia.",
      "No midline shift. The ventricles are normal in size and configuration.",
      "Impression: Neurocysticercosis.",
    ].join("\n");
    expect(containsPhi(clean)).toBe(false);
    expect(detectPhiCategories(clean)).toEqual([]);
  });

  test("does not mistake clinical numbers and dates for identifiers", () => {
    // Pain since <date>, a haemoglobin, an age, and a follow-up interval are all
    // ordinary report prose. Flagging them would make the gate useless.
    const prose = [
      "Pain since 12/03/19.",
      "Hb 11.4 g/dL, WBC 7,800/cumm.",
      "Age 34 years, male.",
      "Suggest follow-up in 6 months.",
      "Lesion measures 2.4 x 1.8 cm.",
    ].join("\n");
    expect(containsPhi(prose)).toBe(false);
  });
});

describe("scrubPhiText", () => {
  test("removes identifier values and keeps the labels and the clinical content", () => {
    const r = scrubPhiText(CLINICAL_NOTE);

    expect(r.text).not.toContain("Ananya Sharma");
    expect(r.text).not.toContain("EXP-2610-0016");
    expect(r.text).not.toContain("1992-04-30");
    expect(r.text).toContain("Patient: [REDACTED]");
    expect(r.text).toContain("Gender: F");
    expect(r.text).toContain("Blood Group: B+");
    expect(r.text).toContain("US001 (USG Whole Abdomen)");
    expect(r.removedCategories).toContain("name");
    expect(r.removedCount).toBeGreaterThanOrEqual(3);
  });

  test("scrubbing is idempotent — a second pass finds nothing new", () => {
    const once = scrubPhiText(CLINICAL_NOTE);
    const twice = scrubPhiText(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.removedCount).toBe(0);
  });

  test("the scrubbed clinical note no longer trips the detector", () => {
    expect(containsPhi(scrubPhiText(CLINICAL_NOTE).text)).toBe(false);
  });

  test("clean text is returned byte-identical", () => {
    const clean = "No acute abnormality. Clinical correlation advised.";
    const r = scrubPhiText(clean);
    expect(r.text).toBe(clean);
    expect(r.removedCount).toBe(0);
  });

  test("scrubs an unlabelled mobile without eating a measurement", () => {
    const r = scrubPhiText("Contact 9812345678. The nodule is 7 mm.");
    expect(r.text).not.toContain("9812345678");
    expect(r.text).toContain("7 mm");
  });
});
