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
  enrichReferringDoctorFromDoctors,
  resolveDoctorDegreeFromCatalog,
  doctorCatalogLabels,
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

  it("prefers exact catalog match when fuzzy would hit multiple doctors", () => {
    const enriched = enrichReferringDoctorFromCatalog("Sanjay Kumar", [
      "Dr. Sanjay Kumar, MD",
      "Dr. Sanjay Kumar Singh, MS",
    ]);
    expect(enriched).toBe("Dr. Sanjay Kumar, MD");
  });

  it("keeps multi-word Settings → Doctors degree intact (no re-parse)", () => {
    const enriched = enrichReferringDoctorFromCatalog("DR. SHIVANGI NEUROLOGY", [
      "Dr. Shivangi, DM Neurology",
    ]);
    expect(enriched).toBe("Dr. Shivangi, DM Neurology");
  });

  it("unique contains-match still pulls Settings → Doctors degree", () => {
    const enriched = enrichReferringDoctorFromDoctors("DR.SHIVANGI NEUROLOGY", [
      { name: "Dr. Shivangi", degree: "DM (Neurology)" },
    ]);
    expect(enriched).toContain("DM (Neurology)");
    expect(enriched).not.toMatch(/Shivangi Neurology,/i);
  });

  it("resolveDoctorDegreeFromCatalog returns Settings → Doctors.degree", () => {
    expect(resolveDoctorDegreeFromCatalog("Dr. Sugandha Priyadarshini", [
      { name: "Dr. Sugandha Priyadarshini", degree: "MD (Radiodiagnosis & Imaging)" },
    ])).toBe("MD (Radiodiagnosis & Imaging)");
  });

  it("pulls degree from Settings → Doctors structured rows", () => {
    const enriched = enrichReferringDoctorFromDoctors("DR.SANJAY KUMAR", [
      { name: "Dr. Sanjay Kumar", degree: "MD, DMRD" },
      { name: "Dr. Other", degree: "MS" },
    ]);
    expect(enriched).toMatch(/Sanjay Kumar/i);
    expect(enriched).toMatch(/MD/);
    expect(enriched).toMatch(/DMRD/);
  });

  it("doctorCatalogLabels joins name + degree without duplicating", () => {
    expect(doctorCatalogLabels([
      { name: "Dr. Sanjay Kumar", degree: "MD" },
      { name: "Dr. Sanjay Kumar, MD", degree: "MD" },
    ])).toEqual(["Dr. Sanjay Kumar, MD", "Dr. Sanjay Kumar, MD"]);
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

  it("uses the patient id as the UHID when the record has none of its own", () => {
    // The letter-pad block falls back the same way; the two header styles must
    // not name the same patient with two different numbers.
    const html = buildClassicDemographyHeaderHtml({
      patientName: "Rita Devi",
      sex: "F",
      patientId: "PID-4471",
      studyDate: "20260813",
    });
    expect(html).toContain("UHID:");
    expect(html).toContain("PID-4471");
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

  // The workspace does not print the server's letter-pad block: it replaces it
  // with this one. Adding UHID/ACCESSION to the server and the PDF but not here
  // would print the identifiers on the durable PDF and lose them on Print.
  it("prints the UHID and accession the canonical record has", () => {
    const html = buildLetterpadDemographyHtml({
      patientName: "Premchand Mandal",
      age: "4 Yrs",
      sex: "M",
      referringDoctor: "Dr Tushar Jyoti",
      studyDate: "18/08/2026",
      uhid: "UH-2026-000457",
      accessionNumber: "ACC-8891",
    });
    expect(html).toContain("UHID:");
    expect(html).toContain("UH-2026-000457");
    expect(html).toContain("ACCESSION:");
    expect(html).toContain("ACC-8891");
    // The four cells the clinic already reads are untouched.
    expect(html).toContain("PREMCHAND MANDAL");
    expect(html).toContain("4 YRS / M");
    expect(html).toContain("TUSHAR JYOTI");
    expect(html).toContain("18/08/2026");
    // Three rows: the identifiers add one, and a study with neither adds none.
    expect((html.match(/<tr>/g) || []).length).toBe(3);
  });

  it("uses the patient id for UHID when the record has no UHID of its own", () => {
    // Same fallback buildClassicDemographyHeaderParts uses, so the two header
    // styles cannot name the same patient differently.
    const html = buildLetterpadDemographyHtml({
      patientName: "Renu Keshri",
      age: "52 Yrs",
      sex: "F",
      patientId: "PID-4471",
    });
    expect(html).toContain("UHID:");
    expect(html).toContain("PID-4471");
    expect(html).not.toContain("ACCESSION:");
  });

  it("prints no identifier label when the record has no identifier", () => {
    const html = buildLetterpadDemographyHtml({
      patientName: "No Uhid Here",
      age: "30 Yrs",
      sex: "F",
      uhid: "",
      patientId: "",
      accessionNumber: "",
    });
    expect(html).not.toContain("UHID:");
    expect(html).not.toContain("ACCESSION:");
    expect(html).toContain("NO UHID HERE");
    // The blank row is not drawn either: an empty third line pushes the double
    // rule down and changes the layout of every report that has no identifiers.
    expect((html.match(/<tr>/g) || []).length).toBe(2);
  });

  it("keeps the identifiers when it replaces the server's letter-pad block", () => {
    const server = `<div class="letterpad-demo-wrap"><table class="letterpad-demo">
      <tr><td class="ld-left"><strong>NAME:</strong> <strong>RENU</strong></td>
      <td class="ld-right"><strong>AGE/SEX:</strong> F</td></tr>
      <tr><td class="ld-left"><strong>REFD. BY:</strong> X</td>
      <td class="ld-right"><strong>DATE:</strong> 13/08/2026</td></tr>
      <tr><td class="ld-left"><strong>UHID:</strong> UH-1</td>
      <td class="ld-right"><strong>ACCESSION:</strong> ACC-2</td></tr>
    </table><div class="letterpad-demo-rule"></div></div>`;
    const out = patchLetterpadDemographyHtml(server, {
      patientName: "Renu Keshri",
      age: "52 Yrs",
      sex: "F",
      referringDoctor: "Dr. Tushar Jyoti",
      studyDate: "13/08/2026",
      uhid: "UH-1",
      accessionNumber: "ACC-2",
    });
    expect(out).toContain("UH-1");
    expect(out).toContain("ACC-2");
    // Replaced, not appended: the block must not carry two identifier rows.
    expect(out.match(/UHID:/g)).toHaveLength(1);
    expect(out).not.toContain("<strong>REFD. BY:</strong> X");
  });
});
