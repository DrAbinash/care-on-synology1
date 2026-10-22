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
  formatStudyDateForPrint,
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

  it("never turns the patient primary key into a printed UHID", () => {
    // `patientId` on the workspace path is radiology_worklist.patient_id — a
    // Postgres sequence value the clinic never issued. A report that reads
    // "UHID: 47" invents an identifier, and it is reachable the moment a queue
    // filter hides the open study so the list row (and its real UHID) is gone.
    const merged = mergeReportDemography({
      erp: { patientName: "Renu Keshri", patientId: 47, accessionNumber: "ACC-9" },
    });
    expect(merged.patientId).toBe("47");
    expect(merged.uhid).toBe("");
    expect(buildLetterpadDemographyHtml(merged)).not.toContain("UHID:");
    expect(buildLetterpadDemographyHtml(merged)).toContain(
      "<strong>ACCESSION:</strong> ACC-9",
    );
    expect(buildClassicDemographyHeaderHtml(merged)).not.toContain("UHID:");
  });

  it("still reads a patient code that arrives as text", () => {
    // The fallback predates the worklist detail read: some callers hand the
    // merge a patient code rather than a primary key, and that one is real.
    const merged = mergeReportDemography({
      erp: { patientName: "Renu Keshri", patientId: "PID-4471" },
    });
    expect(merged.uhid).toBe("PID-4471");
    expect(buildLetterpadDemographyHtml(merged)).toContain(
      "<strong>UHID:</strong> PID-4471",
    );
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

  // ── The card and the signed report must state the same age ──────────────────
  // A date of birth is evaluated on the day of the EXAMINATION, because that is
  // the day the card is describing and the day the signed report will print.
  it("evaluates the date of birth on the examination day, not today", () => {
    // Scanned 10 Jan 2025, reported long afterwards: 45 then, not the clock's age.
    expect(resolveDisplayAge({ age: "" }, { dateOfBirth: "1980-01-10" }, null, "20250110")).toBe("45 Yrs");
    expect(resolveDisplayAge({ age: "" }, { dateOfBirth: "1980-01-10" }, null, "2025-01-10")).toBe("45 Yrs");
  });
  it("keeps today's age when no examination date is recorded", () => {
    const now = new Date();
    let years = now.getFullYear() - 1980;
    if (now.getMonth() < 0 || (now.getMonth() === 0 && now.getDate() < 10)) years--;
    expect(resolveDisplayAge({ age: "" }, { dateOfBirth: "1980-01-10" }, null, null)).toBe(`${years} Yrs`);
  });
  it("refuses a slashed study date rather than guessing which part is the day", () => {
    // `studyDateToISO` reads digits positionally, so 10/01/2025 would become
    // 1001-20-25 and the age derived from it would be invented. Behaving exactly
    // as if no date were recorded is the honest outcome.
    const master = { dateOfBirth: "1980-01-10" };
    expect(resolveDisplayAge({ age: "" }, master, null, "10/01/2025")).toBe(
      resolveDisplayAge({ age: "" }, master, null, null),
    );
  });
  it("returns a stated registration age as recorded, whatever the study date", () => {
    // `(ageValue, ageUnit)` is an age someone wrote down, not a derivation, so an
    // examination date has nothing to re-evaluate.
    expect(resolveDisplayAge({ age: "" }, { ageValue: 60, ageUnit: "years" }, null, "20250110")).toBe("60 Yrs");
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
    // The merge owns display formatting: a machine ISO date prints in the
    // same dd/mm/yyyy form the server-rendered headers use.
    expect(html).toContain("DATE: <strong>13/08/2026</strong>");
  });
});

describe("mergeReportDemography — study-date display parity", () => {
  it("prints the raw DICOM compact date as dd/mm/yyyy, like the server does", () => {
    // The live defect: pacs-worklist detail returns studyDate "20261022" and
    // every client surface printed it verbatim while the server PDF said
    // "22/10/2026" — one report, two dates.
    const d = mergeReportDemography({ erp: { studyDate: "20261022" } });
    expect(d.studyDate).toBe("22/10/2026");
  });

  it("normalizes an ISO study date to dd/mm/yyyy", () => {
    expect(mergeReportDemography({ erp: { studyDate: "2026-10-22" } }).studyDate).toBe("22/10/2026");
  });

  it("normalizes a radiologist's typed machine date too, not just merged sources", () => {
    const d = mergeReportDemography({
      erp: { studyDate: "22/10/2026" },
      overrides: { studyDate: "20261022" },
    });
    expect(d.studyDate).toBe("22/10/2026");
  });

  it("leaves a typed dd/mm/yyyy untouched", () => {
    expect(mergeReportDemography({ erp: { studyDate: "13/08/2026" } }).studyDate).toBe("13/08/2026");
  });

  it("refuses to guess an ambiguous slashed date", () => {
    expect(mergeReportDemography({ erp: { studyDate: "10/22/2026" } }).studyDate).toBe("10/22/2026");
  });
});

describe("formatStudyDateForPrint", () => {
  it("renders the DICOM compact form as dd/mm/yyyy", () => {
    expect(formatStudyDateForPrint("20261022")).toBe("22/10/2026");
  });
  it("renders the ISO form as dd/mm/yyyy", () => {
    expect(formatStudyDateForPrint("2026-10-22")).toBe("22/10/2026");
    expect(formatStudyDateForPrint("2026-10-22T15:30:00")).toBe("22/10/2026");
  });
  it("passes through display text it cannot honestly convert", () => {
    expect(formatStudyDateForPrint("13/08/2026")).toBe("13/08/2026");
    expect(formatStudyDateForPrint("10/22/2026")).toBe("10/22/2026");
    expect(formatStudyDateForPrint("22 Oct 2026")).toBe("22 Oct 2026");
    expect(formatStudyDateForPrint("")).toBe("");
    expect(formatStudyDateForPrint(null)).toBe("");
  });
  it("passes through a calendar-invalid machine date instead of inventing one", () => {
    expect(formatStudyDateForPrint("20261301")).toBe("20261301");
    expect(formatStudyDateForPrint("20260230")).toBe("20260230");
    expect(formatStudyDateForPrint("123")).toBe("123");
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

  it("replaces the server's normalized DATE with the same normalized DATE, not the raw source", () => {
    // The live defect ran through exactly this patch: the server letterpad
    // printed "DATE: 22/10/2026", the patch rewrote it with the raw worklist
    // value "20261022", and the workspace print surfaces disagreed with the
    // server PDF. With the canonical merge owning display formatting, the
    // patched block prints the same dd/mm/yyyy the server already chose.
    const server = `<div class="letterpad-demo-wrap"><table class="letterpad-demo">
      <tr><td class="ld-left"><strong>NAME:</strong> <strong>SUNITA SHARMA</strong></td>
      <td class="ld-right"><strong>AGE/SEX:</strong> 58 YRS / F</td></tr>
      <tr><td class="ld-left"><strong>REFD. BY:</strong> DR. S VERMA</td>
      <td class="ld-right"><strong>DATE:</strong> 22/10/2026</td></tr>
    </table><div class="letterpad-demo-rule"></div></div>`;
    const merged = mergeReportDemography({
      erp: {
        patientName: "Sunita Sharma",
        age: "58 Yrs",
        sex: "F",
        referringDoctor: "Dr. S Verma",
        studyDate: "20261022",
        uhid: "P-00001",
        accessionNumber: "ACC-20261022-MR-001",
      },
    });
    const out = patchLetterpadDemographyHtml(server, merged);
    expect(out).toContain("22/10/2026");
    // The raw machine form is gone from the DATE cell (the accession number
    // legitimately contains the digits — scope the assertion to the cell).
    expect(out).not.toContain("<strong>DATE:</strong> 20261022");
    // The identifiers survive the same replace, not just the date.
    expect(out).toContain("UHID:");
    expect(out).toContain("P-00001");
    expect(out).toContain("ACCESSION:");
    expect(out).toContain("ACC-20261022-MR-001");
  });
});
