import { describe, expect, it } from "vitest";
import {
  mergeReportDemography,
  buildDemographyHeaderHtml,
  buildClassicDemographyHeaderHtml,
  reconcileAccessionVsReferringDoctor,
  formatReferringDoctorDisplay,
  enrichReferringDoctorFromCatalog,
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

  it("skips implausible 126 Yrs from sentinel DOB", () => {
    const d = mergeReportDemography({
      erp: { patientName: "Walk-in", age: "126 Yrs", dateOfBirth: "1900-01-01" },
      dicom: {},
    });
    expect(d.age).toBe("");
    expect(d.dateOfBirth).toBe("");
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

  it("dicomAgeToDisplay rejects implausible years", () => {
    expect(dicomAgeToDisplay("126Y")).toBe("");
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
  it("drops implausible 126 Yrs", () => {
    expect(resolveDisplayAge({ age: "126 Yrs" }, { dateOfBirth: "1900-01-01" }, "126Y")).toBe("");
  });
});

describe("reconcileAccessionVsReferringDoctor", () => {
  it("moves MRI billing doctor name from Acc No. to REF. BY", () => {
    const d = mergeReportDemography({
      erp: { patientName: "Rita Devi", accessionNumber: "DR.SANJAY KUMAR", referringDoctor: "" },
      dicom: {},
    });
    expect(d.accessionNumber).toBe("");
    expect(d.referringDoctor).toMatch(/Sanjay Kumar/i);
    expect(d.referringDoctor).toMatch(/^Dr\./);
  });

  it("keeps a real accession number", () => {
    const d = mergeReportDemography({
      erp: { accessionNumber: "ACC-20260813-MR-001", referringDoctor: "Dr. ERP" },
      dicom: {},
    });
    expect(d.accessionNumber).toBe("ACC-20260813-MR-001");
    expect(d.referringDoctor).toBe("Dr. ERP");
  });

  it("enriches referring doctor from catalog when uniquely matched", () => {
    const enriched = enrichReferringDoctorFromCatalog(
      formatReferringDoctorDisplay("Sanjay Kumar"),
      ["Dr. Sanjay Kumar, MD"],
    );
    expect(enriched).toContain("MD");
  });
});

describe("buildClassicDemographyHeaderHtml", () => {
  it("omits ACC and REF. BY when blank", () => {
    const html = buildClassicDemographyHeaderHtml({
      patientName: "Rita Devi",
      sex: "F",
      studyDate: "20260813",
      accessionNumber: "",
      referringDoctor: "",
    });
    expect(html).toContain("NAME:");
    expect(html).toContain("Rita Devi");
    expect(html).toContain("AGE/SEX:");
    expect(html).toContain(" F");
    expect(html).toContain("DATE:");
    expect(html).not.toContain("ACC:");
    expect(html).not.toContain("REF. BY:");
  });

  it("shows REF. BY after reconcile and hides fake ACC", () => {
    const reconciled = reconcileAccessionVsReferringDoctor({
      accessionNumber: "DR.SANJAY KUMAR",
      referringDoctor: "",
    });
    const html = buildClassicDemographyHeaderHtml({
      patientName: "Rita Devi",
      sex: "F",
      studyDate: "20260813",
      ...reconciled,
    });
    expect(html).toContain("REF. BY:");
    expect(html).toContain("Sanjay Kumar");
    expect(html).not.toContain("ACC:");
  });
});

describe("buildDemographyHeaderHtml", () => {
  it("omits blank REF. BY and ACC in table layout", () => {
    const html = buildDemographyHeaderHtml(mergeReportDemography({
      erp: {
        patientName: "Rita Devi",
        sex: "F",
        studyDate: "2026-08-13",
        accessionNumber: "",
        referringDoctor: "",
      },
    }));
    expect(html).toContain("RITA DEVI");
    expect(html).not.toContain("REF. BY:");
    expect(html).not.toContain("ACC:");
    expect(html).toContain("DATE:");
  });
});

describe("buildDemographyHeaderHtml — full row", () => {
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
