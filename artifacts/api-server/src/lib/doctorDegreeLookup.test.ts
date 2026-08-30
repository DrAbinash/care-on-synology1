import { describe, expect, test } from "vitest";
import {
  collapseSpacedOutLetters,
  enrichReferringDoctorWithDegree,
  resolveDoctorDegreeFromRows,
} from "./doctorDegreeLookup";

describe("doctorDegreeLookup", () => {
  test("resolveDoctorDegreeFromRows returns Settings → Doctors.degree", () => {
    expect(resolveDoctorDegreeFromRows("Dr. Sugandha Priyadarshini", [
      { name: "Dr. Sugandha Priyadarshini", degree: "MD (Radiodiagnosis & Imaging)" },
    ])).toBe("MD (Radiodiagnosis & Imaging)");
  });

  test("enrichReferringDoctorWithDegree appends catalog degree", () => {
    expect(enrichReferringDoctorWithDegree("DR. SHIVANGI NEUROLOGY", [
      { name: "Dr. Shivangi", degree: "DM (Neurology)" },
    ])).toContain("DM (Neurology)");
  });

  test("collapseSpacedOutLetters joins spaced characters", () => {
    expect(collapseSpacedOutLetters("A d e t a i l e d   c o n t r a s t")).toBe("Adetailed contrast");
  });
});
