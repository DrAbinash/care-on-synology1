import { describe, expect, it } from "vitest";
import {
  mergeReportDemography,
  buildDemographyHeaderHtml,
  buildClassicDemographyHeaderHtml,
  buildLetterpadDemographyHtml,
  patchLetterpadDemographyHtml,
  reconcileAccessionVsReferringDoctor,
  formatReferringDoctorDisplay,
  formatDoctorWithDegree,
  enrichReferringDoctorFromCatalog,
  dicomAgeToDisplay,
  resolveDisplayAge,
  isJunkReferringDoctor,
} from "./reportDemography";

describe("isJunkReferringDoctor", () => {
  it("rejects self-referral placeholders", () => {
    expect(isJunkReferringDoctor("DR. SELF ONLINE")).toBe(true);
    expect(isJunkReferringDoctor("DR. SELF WB")).toBe(true);
    expect(isJunkReferringDoctor("SELF")).toBe(true);
    expect(isJunkReferringDoctor("self referral")).toBe(true);
    expect(isJunkReferringDoctor("walk-in")).toBe(true);
    expect(isJunkReferringDoctor("Dr. Surya Udai Singh")).toBe(false);
  });

  it("formatReferringDoctorDisplay blanks junk", () => {
    expect(formatReferringDoctorDisplay("DR. SELF WB")).toBe("");
    expect(formatReferringDoctorDisplay("DR. SELF ONLINE")).toBe("");
  });
});

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
  it("ERP age wins over DICOM when master absent", () => {
    expect(resolveDisplayAge({ age: "50 Yrs" }, null, "050Y")).toBe("50 Yrs");
  });
  it("prefers patient-master age over worklist/ERP age", () => {
    expect(resolveDisplayAge({ age: "12 Yrs" }, { ageValue: 60, ageUnit: "years" }, "012Y")).toBe("60 Yrs");
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

  it("appends doctors-master degree without duplicating tokens already in the name", () => {
    expect(formatDoctorWithDegree("Dr. Sanjay Kumar", "MD")).toBe("Dr. Sanjay Kumar, MD");
    expect(formatDoctorWithDegree("Dr. Sanjay Kumar, MD", "MD")).toBe("Dr. Sanjay Kumar, MD");
    expect(formatDoctorWithDegree("Sanjay Kumar", "MBBS, MD")).toMatch(/MBBS/);
    expect(formatDoctorWithDegree("Sanjay Kumar", "MBBS, MD")).toMatch(/MD/);
  });

  it("merge picks up catalog degree from doctors master", () => {
    const d = mergeReportDemography({
      erp: { referringDoctor: "Sanjay Kumar" },
      referringDoctorCatalog: [formatDoctorWithDegree("Dr. Sanjay Kumar", "MD")],
    });
    expect(d.referringDoctor).toContain("MD");
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

describe("letterpad demography patch", () => {
  it("buildLetterpadDemographyHtml blanks junk REF and includes age", () => {
    const html = buildLetterpadDemographyHtml({
      patientName: "Renu Keshri",
      age: "52 Yrs",
      sex: "F",
      referringDoctor: "DR. SELF WB",
      studyDate: "13/08/2026",
    });
    expect(html).toContain("RENU KESHRI");
    expect(html).toContain("52 YRS / F");
    expect(html).not.toContain("SELF");
    expect(html).toContain("13/08/2026");
  });

  it("patchLetterpadDemographyHtml replaces server AGE/SEX and REFD. BY", () => {
    const server = `<div class="letterpad-demo-wrap"><table class="letterpad-demo">
      <tr><td class="ld-left"><strong>NAME:</strong> <strong>RENU</strong></td>
      <td class="ld-right"><strong>AGE/SEX:</strong> F</td></tr>
      <tr><td class="ld-left"><strong>REFD. BY:</strong> DR. SELF WB</td>
      <td class="ld-right"><strong>DATE:</strong> 13/08/2026</td></tr>
    </table><div class="letterpad-demo-rule"></div></div>`;
    const out = patchLetterpadDemographyHtml(server, {
      patientName: "Renu Keshri",
      age: "52 Yrs",
      sex: "F",
      referringDoctor: "Dr. Surya Udai Singh",
      studyDate: "13/08/2026",
    });
    expect(out).toContain("52 YRS / F");
    expect(out).toContain("SURYA UDAI SINGH");
    expect(out).not.toContain("SELF");
  });
});
