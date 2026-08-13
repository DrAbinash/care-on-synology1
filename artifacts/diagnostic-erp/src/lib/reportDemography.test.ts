import { describe, expect, it } from "vitest";
import {
  mergeReportDemography,
  buildDemographyHeaderHtml,
  dicomAgeToDisplay,
  resolveDisplayAge,
} from "./reportDemography";

describe("mergeReportDemography — ERP > DICOM > manual override", () => {
  it("prefers ERP demographics over DICOM", () => {
    const d = mergeReportDemography({
      erp: { patientName: "Jane Doe", age: "34 Yrs", sex: "F", referringDoctor: "Dr. ERP" },
      dicom: { patientName: "JANE DICOM", age: "034Y", sex: "M", referringDoctor: "Dr. DICOM" },
    });
    expect(d.patientName).toBe("Jane Doe");
    expect(d.age).toBe("34 Yrs");
    expect(d.sex).toBe("F");
    expect(d.referringDoctor).toBe("Dr. ERP");
  });

  it("falls back to DICOM PatientAge / PatientSex when ERP is blank", () => {
    const d = mergeReportDemography({
      erp: { patientName: "Jane Doe", age: "", sex: "" },
      dicom: { dicomMetadata: { PatientAge: "006M", PatientSex: "F" } },
    });
    expect(d.age).toBe("6 Mo");
    expect(d.sex).toBe("F");
  });

  it("manual overrides always win", () => {
    const d = mergeReportDemography({
      erp: { patientName: "Jane Doe", age: "34 Yrs", referringDoctor: "Dr. ERP" },
      dicom: {},
      overrides: { patientName: "Jane Smith", age: "35 Yrs" },
    });
    expect(d.patientName).toBe("Jane Smith");
    expect(d.age).toBe("35 Yrs");
    expect(d.referringDoctor).toBe("Dr. ERP");
  });

  it("ignores blank/zero ERP age so DICOM can fill", () => {
    const d = mergeReportDemography({
      erp: { patientName: "Baby", age: "0" },
      dicom: { age: "012D" },
    });
    expect(d.age).toBe("12 D");
  });

  it("manual demography override survives merge for output", () => {
    const merged = mergeReportDemography({
      erp: { patientName: "Jane Doe", age: "34 Yrs" },
      dicom: {},
      overrides: { patientName: "Edited Name" },
    });
    const html = buildDemographyHeaderHtml(merged);
    expect(html).toContain("EDITED NAME");
    expect(html).not.toContain("JANE DOE");
  });
});

describe("dicomAgeToDisplay", () => {
  it.each([
    ["045Y", "45 Yrs"],
    ["006M", "6 Mo"],
    ["012D", "12 D"],
    ["000Y", ""],
    ["junk", ""],
  ])("%s → %s", (input, expected) => {
    expect(dicomAgeToDisplay(input)).toBe(expected);
  });
});

describe("resolveDisplayAge", () => {
  it("ERP age wins over DICOM", () => {
    expect(resolveDisplayAge({ age: "50 Yrs" }, null, "050Y")).toBe("50 Yrs");
  });
  it("patient master ageValue wins over DICOM", () => {
    expect(resolveDisplayAge({ age: "" }, { ageValue: 8, ageUnit: "months" }, "050Y")).toBe("8 Mo");
  });
  it("falls back to DICOM PatientAge", () => {
    expect(resolveDisplayAge({ age: "" }, null, "050Y")).toBe("50 Yrs");
  });
});

describe("buildDemographyHeaderHtml", () => {
  it("renders name/ref left, age/dob/date right, upper-case", () => {
    const html = buildDemographyHeaderHtml(mergeReportDemography({
      erp: {
        patientName: "Jane Doe",
        age: "34 Yrs",
        sex: "F",
        referringDoctor: "Dr. Who",
        studyDate: "2026-08-13",
        dateOfBirth: "1992-01-01",
      },
    }));
    expect(html).toContain("JANE DOE");
    expect(html).toContain("DR. WHO");
    expect(html).toContain("34 Yrs / F");
    expect(html).toContain("1992-01-01");
    expect(html).toContain("2026-08-13");
  });
});
