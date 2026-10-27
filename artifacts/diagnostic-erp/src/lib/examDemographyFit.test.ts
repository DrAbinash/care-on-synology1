/**
 * examDemographyFit — unit contracts.
 *
 * The billing desk advisory is deterministic string knowledge: ONE catalog of
 * sex-specific / age-typical exams, guarded against the classic false
 * positives (cervical SPINE, mammography on men), WARN-only by construction.
 * These tests pin the behaviour; the wiring pins live in
 * examDemographyFit.sourceContract.test.ts.
 */
import { describe, expect, it } from "vitest";
import { checkExamDemographyFit } from "./examDemographyFit";

const F = { sex: "female" };
const M = { sex: "male" };

describe("examDemographyFit — sex-specific exams", () => {
  it("1. male-only exams warn on a female patient", () => {
    for (const name of [
      "USG Prostate",
      "USG Scrotum",
      "Varicocele Doppler",
      "Semen Analysis",
      "MRI Prostate",
      "USG Testis",
    ]) {
      const w = checkExamDemographyFit([name], F);
      expect(w, name).toHaveLength(1);
      expect(w[0]!.code, name).toBe("sex_exam_mismatch");
      expect(w[0]!.testName, name).toBe(name);
      expect(w[0]!.message, name).toContain("male");
    }
  });

  it("2. female-only exams warn on a male patient", () => {
    for (const name of [
      "USG Uterus",
      "USG Ovarian Follicular Study",
      "HSG",
      "TVS",
      "Pap Smear",
      "USG Pregnancy",
      "Obstetric USG",
      "USG Cervical Length",
      "Hysterosalpingography",
      "Endometrial Biopsy",
    ]) {
      const w = checkExamDemographyFit([name], M);
      expect(w, name).toHaveLength(1);
      expect(w[0]!.code, name).toBe("sex_exam_mismatch");
      expect(w[0]!.testName, name).toBe(name);
    }
  });

  it("3. explicit (Male)/(Female) variants in the test name itself warn", () => {
    expect(checkExamDemographyFit(["USG Pelvis (Male)"], F)).toHaveLength(1);
    expect(checkExamDemographyFit(["USG Pelvis (Female)"], M)).toHaveLength(1);
    expect(checkExamDemographyFit(["Male Infertility Profile"], F)).toHaveLength(1);
    expect(checkExamDemographyFit(["Female Infertility Profile"], M)).toHaveLength(1);
    // Matching variants stay silent.
    expect(checkExamDemographyFit(["USG Pelvis (Male)"], M)).toHaveLength(0);
    expect(checkExamDemographyFit(["USG Pelvis (Female)"], F)).toHaveLength(0);
  });

  it("4. TRUS (transrectal ultrasound) reads as a male-only exam", () => {
    const w = checkExamDemographyFit(["TRUS"], F);
    expect(w).toHaveLength(1);
    expect(w[0]!.code).toBe("sex_exam_mismatch");
  });

  it("5. 'cervical spine' is NOT female anatomy — the guard holds", () => {
    expect(checkExamDemographyFit(["X-Ray Cervical Spine AP"], M)).toHaveLength(0);
    expect(checkExamDemographyFit(["MRI Cervical Spine Screening"], F)).toHaveLength(0);
    expect(checkExamDemographyFit(["USG Cervical Spine"], M)).toHaveLength(0);
    // …but cervix / cervical-length (obstetric) still is.
    expect(checkExamDemographyFit(["USG Cervical Length"], M)).toHaveLength(1);
    expect(checkExamDemographyFit(["Cervical Biopsy"], M)).toHaveLength(1);
  });

  it("6. mammography on a male patient stays silent (male breast workup is legitimate)", () => {
    expect(checkExamDemographyFit(["Mammography Bilateral"], M)).toHaveLength(0);
    expect(checkExamDemographyFit(["USG Breast"], M)).toHaveLength(0);
  });

  it("7. neutral exams never warn, regardless of sex", () => {
    for (const name of ["CBC", "X-Ray Chest PA", "USG Abdomen", "MRI Brain Plain", "CT KUB"]) {
      expect(checkExamDemographyFit([name], F), name).toHaveLength(0);
      expect(checkExamDemographyFit([name], M), name).toHaveLength(0);
    }
  });
});

describe("examDemographyFit — sex normalization", () => {
  it("8. accepts ERP words and DICOM letters alike", () => {
    for (const sex of ["male", "MALE", "Male", "m", "M"]) {
      expect(checkExamDemographyFit(["USG Prostate"], { sex }), sex).toHaveLength(0);
      expect(checkExamDemographyFit(["USG Prostate"], { sex }).length, sex).toBe(0);
    }
    for (const sex of ["female", "FEMALE", "f", "F", "woman", "girl"]) {
      const w = checkExamDemographyFit(["USG Prostate"], { sex });
      expect(w, sex).toHaveLength(1);
      expect(w[0]!.code).toBe("sex_exam_mismatch");
    }
  });

  it("9. missing / unknown sex prompts only for sex-specific exams", () => {
    for (const sex of ["", null, undefined, "other", "xyz"]) {
      const w = checkExamDemographyFit(["USG Prostate"], { sex });
      expect(w, String(sex)).toHaveLength(1);
      expect(w[0]!.code).toBe("sex_missing_for_exam");
      expect(w[0]!.message).toContain("Sex");
    }
    // Neutral exams never nag about a missing sex.
    expect(checkExamDemographyFit(["CBC", "USG Abdomen"], { sex: "" })).toHaveLength(0);
  });
});

describe("examDemographyFit — age-typical exams", () => {
  it("10. obstetric / follicular work is age-windowed 10–60 yrs on top of female-only", () => {
    expect(checkExamDemographyFit(["Follicular Study"], { ...F, ageValue: 70, ageUnit: "years" }))
      .toHaveLength(1);
    expect(
      checkExamDemographyFit(["Follicular Study"], { ...F, ageValue: 70, ageUnit: "years" })[0]!.code,
    ).toBe("age_exam_mismatch");
    expect(checkExamDemographyFit(["Follicular Study"], { ...F, ageValue: 30, ageUnit: "years" })).toHaveLength(0);
    // Boundaries are inclusive.
    expect(checkExamDemographyFit(["Obstetric USG"], { ...F, ageValue: 10, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Obstetric USG"], { ...F, ageValue: 60, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Obstetric USG"], { ...F, ageValue: 61, ageUnit: "years" })[0]!.code)
      .toBe("age_exam_mismatch");
    expect(checkExamDemographyFit(["Obstetric USG"], { ...F, ageValue: 9, ageUnit: "years" })[0]!.code)
      .toBe("age_exam_mismatch");
    // Sex mismatch outranks the age check when both would fire.
    const both = checkExamDemographyFit(["Obstetric USG"], { sex: "male", ageValue: 70, ageUnit: "years" });
    expect(both).toHaveLength(1);
    expect(both[0]!.code).toBe("sex_exam_mismatch");
  });

  it("11. bone age is a pediatric exam (max 18 yrs)", () => {
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: 25, ageUnit: "years" })[0]!.code)
      .toBe("age_exam_mismatch");
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: 18, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: 9, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...F, ageValue: 12, ageUnit: "years" })).toHaveLength(0);
    // Age unknown → no age opinion.
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M })).toHaveLength(0);
  });

  it("12. prostate work is adult (min 30 yrs); scrotum/testis is any age (torsion is pediatric)", () => {
    expect(checkExamDemographyFit(["MRI Prostate"], { ...M, ageValue: 25, ageUnit: "years" })[0]!.code)
      .toBe("age_exam_mismatch");
    expect(checkExamDemographyFit(["MRI Prostate"], { ...M, ageValue: 30, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["USG Scrotum"], { ...M, ageValue: 8, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["USG Testis"], { ...M, ageValue: 6, ageUnit: "years" })).toHaveLength(0);
  });

  it("13. months / days units convert before the window check", () => {
    // A 6-month-old is not a follicular-study patient (0.5 yrs < 10).
    expect(
      checkExamDemographyFit(["Follicular Study"], { ...F, ageValue: 6, ageUnit: "months" })[0]!.code,
    ).toBe("age_exam_mismatch");
    // A 14-month-old bone age is normal.
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: 14, ageUnit: "months" })).toHaveLength(0);
    // 20 days old — no rule for plain USG.
    expect(checkExamDemographyFit(["USG Abdomen"], { ...M, ageValue: 20, ageUnit: "days" })).toHaveLength(0);
  });

  it("14. date of birth is honoured when no stated age exists; sentinel DOB is not an age", () => {
    expect(
      checkExamDemographyFit(["Follicular Study"], { ...F, dateOfBirth: "1950-06-01" })[0]!.code,
    ).toBe("age_exam_mismatch");
    expect(checkExamDemographyFit(["Follicular Study"], { ...F, dateOfBirth: "1995-03-10" })).toHaveLength(0);
    // 1900-01-01 is the blank-registration placeholder — never an age.
    expect(checkExamDemographyFit(["Follicular Study"], { ...F, dateOfBirth: "1900-01-01" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, dateOfBirth: "1900-01-01" })).toHaveLength(0);
  });

  it("15. implausible stated ages are treated as unknown, not as 150-yr-old patients", () => {
    expect(checkExamDemographyFit(["Follicular Study"], { ...F, ageValue: 150, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: 0, ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: -3, ageUnit: "years" })).toHaveLength(0);
  });
});

describe("examDemographyFit — collection behaviour", () => {
  it("16. one warning per line item, even when several rules match the same name", () => {
    // "Pregnancy USG (Female)" matches the obstetric rule AND the explicit
    // female word — the cashier sees one line, not a wall.
    expect(checkExamDemographyFit(["Pregnancy USG (Female)"], M)).toHaveLength(1);
    expect(checkExamDemographyFit(["TRUS Prostate"], F)).toHaveLength(1);
  });

  it("17. warnings carry the exact test name that triggered them", () => {
    const w = checkExamDemographyFit(
      ["CBC", "USG Prostate", "X-Ray Chest PA"],
      { sex: "female" },
    );
    expect(w).toHaveLength(1);
    expect(w[0]!.testName).toBe("USG Prostate");
  });

  it("18. no patient in view → no opinion (nothing to validate against)", () => {
    expect(checkExamDemographyFit(["USG Prostate"], null)).toHaveLength(0);
    expect(checkExamDemographyFit(["USG Prostate"], undefined)).toHaveLength(0);
    expect(checkExamDemographyFit([], F)).toHaveLength(0);
  });

  it("19. string age values (the new-patient form keeps them as strings) parse like numbers", () => {
    expect(
      checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: "25", ageUnit: "years" })[0]!.code,
    ).toBe("age_exam_mismatch");
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: "9", ageUnit: "years" })).toHaveLength(0);
    expect(checkExamDemographyFit(["Bone Age X-Ray"], { ...M, ageValue: "", ageUnit: "years" })).toHaveLength(0);
  });

  it("20. messages quote the test name and speak in years", () => {
    const w = checkExamDemographyFit(["Follicular Study"], { ...F, ageValue: 70, ageUnit: "years" });
    expect(w[0]!.message).toContain("Follicular Study");
    expect(w[0]!.message).toContain("70");
    const s = checkExamDemographyFit(["USG Prostate"], F);
    expect(s[0]!.message).toContain("USG Prostate");
  });
});
