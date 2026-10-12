/**
 * Every case is a refusal or a leak that the print path would otherwise make.
 *
 * The shape that matters most is the collision: `radiology_worklist.id` and
 * `radiology_studies.id` are independent serials in the same database, so a
 * worklist row EXISTS for a study id that belongs to someone else. An unguarded
 * `WHERE id = study_id` returns it and prints its accession — a different
 * patient's identifier on a document that leaves the clinic by WhatsApp. These
 * tests are written before the wiring, per the ticket.
 */
import { describe, expect, it, vi } from "vitest";

// The decision under test takes rows as arguments and must never reach a
// database. `@workspace/db` throws on import when DATABASE_URL is unset, so it
// is replaced with a stub that throws on USE: if a "pure" path ever grows a
// query, these tests fail loudly instead of quietly needing Postgres.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => { throw new Error("resolveReportAccession must stay database-free"); },
  },
}));

import {
  ACCESSION_ROW_LABEL,
  accessionPrintRow,
  resolveReportAccession,
  type ResolvedReportAccession,
} from "./reportStudyIdentity";
import { renderReportDocument, resolvePresentationTemplate, type RenderableTemplate, type ReportDocumentModel } from "./reportPresentation";

const wl = (over: Record<string, unknown> = {}) => ({
  id: 501,
  patientId: 77,
  accessionNumber: "ACC-77",
  ...over,
});
const study = (over: Record<string, unknown> = {}) => ({
  id: 501,
  patientId: 77,
  accessionNumber: "ACC-STUDY-77",
  ...over,
});

describe("resolveReportAccession — what may be printed", () => {
  it("names the accession when the worklist row is provably the report's own study", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77, worklist: wl(),
    });
    expect(r).toMatchObject({ status: "resolved", accession: "ACC-77", source: "worklist" });
  });

  it("falls back to the billed study only for the SAME patient", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77,
      worklist: null, billedStudy: study(),
    });
    expect(r).toMatchObject({ status: "resolved", accession: "ACC-STUDY-77", source: "billed-study" });
  });

  it("prefers the worklist row, because that is what the finalize path stored in study_id", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77,
      worklist: wl(), billedStudy: study(),
    });
    expect(r).toMatchObject({ status: "resolved", source: "worklist", accession: "ACC-77" });
  });

  it("refuses the id-space collision: a worklist row belonging to another patient", () => {
    // study_id 501 is this report's billed-study id; a worklist row happens to
    // share the number and belongs to patient 900.
    const r = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77,
      worklist: wl({ patientId: 900, accessionNumber: "ACC-OTHER-PATIENT" }),
      billedStudy: study(),
    });
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.source).toBe("billed-study");
    expect(r.accession).not.toMatch(/OTHER/);
    expect(r.accession).toBe("ACC-STUDY-77");
  });

  it("prints NOTHING rather than another patient's accession when both candidates are foreign", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77,
      worklist: wl({ patientId: 900 }),
      billedStudy: study({ patientId: 901 }),
    });
    expect(r.status).toBe("absent");
    if (r.status !== "absent") return;
    expect(r.reason).toBe("patient-mismatch");
    expect(r.rejected.map((x) => x.source)).toEqual(["worklist", "billed-study"]);
    expect(accessionPrintRow(r)).toBeNull();
  });

  it("refuses a candidate that names no patient, rather than assuming it matches", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77,
      worklist: wl({ patientId: null }),
    });
    expect(r.status).toBe("absent");
    if (r.status === "absent") expect(r.rejected[0].why).toMatch(/names no patient/);
    expect(accessionPrintRow(r)).toBeNull();
  });

  it("refuses when the report itself has no patient to verify against", () => {
    for (const pid of [null, undefined, 0, "0"]) {
      // `patientId: 1` is the candidate this must also refuse: a resolver that
      // defaulted the missing report patient to a first row would match it and
      // print that stranger's accession.
      for (const candidate of [wl(), wl({ patientId: 1 })]) {
        const r = resolveReportAccession({
          isRadiology: true, studyId: 501, reportPatientId: pid as number | null, worklist: candidate,
        });
        expect(r.status).toBe("absent");
        if (r.status === "absent") expect(r.reason).toBe("patient-mismatch");
        expect(accessionPrintRow(r)).toBeNull();
      }
    }
  });

  it("is absence, not blank, when the study is not linked", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: null, reportPatientId: 77, worklist: null,
    });
    expect(r).toMatchObject({ status: "absent", reason: "no-study-reference" });
  });

  it("leaves a radiology study that genuinely has no accession unlabelled", () => {
    const blank = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77,
      worklist: wl({ accessionNumber: "   " }),
    });
    expect(blank).toMatchObject({ status: "absent", reason: "blank-accession" });
    expect(accessionPrintRow(blank)).toBeNull();
  });

  it("does not treat a pathology report as a failed lookup", () => {
    const r = resolveReportAccession({
      isRadiology: false, studyId: 501, reportPatientId: 77, worklist: wl(),
    });
    expect(r).toMatchObject({ status: "absent", reason: "not-radiology" });
    expect(r.status === "absent" && r.rejected).toEqual([]);
  });

  it("says no-candidate when nothing was found, which is not the same claim as a mismatch", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: 501, reportPatientId: 77, worklist: null, billedStudy: null,
    });
    expect(r).toMatchObject({ status: "absent", reason: "no-candidate" });
  });

  it("trims the accession it prints and never invents one from whitespace", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: 1, reportPatientId: 1,
      worklist: wl({ id: 1, patientId: 1, accessionNumber: "  ACC-9  " }),
    });
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.accession).toBe("ACC-9");
  });

  it("accepts a string id, because study_id arrives as text on some paths", () => {
    const r = resolveReportAccession({
      isRadiology: true, studyId: "501" as unknown as number, reportPatientId: "77" as unknown as number,
      worklist: wl(),
    });
    expect(r.status).toBe("resolved");
  });
});

describe("accessionPrintRow — the row the header draws", () => {
  it("uses the label reportPresentation already harvests into `Accession:`", () => {
    const row = accessionPrintRow({ status: "resolved", accession: "ACC-1", source: "worklist" });
    expect(row).toEqual({ label: ACCESSION_ROW_LABEL, value: "ACC-1" });
    // reportPresentation.ts:313 matches on the lower-cased label exactly.
    expect(ACCESSION_ROW_LABEL.toLowerCase()).toBe("accession no.");
  });

  it("returns null rather than an empty label for every absent verdict", () => {
    for (const reason of ["not-radiology", "no-study-reference", "no-candidate", "patient-mismatch", "blank-accession"] as const) {
      expect(accessionPrintRow({ status: "absent", reason, rejected: [] })).toBeNull();
    }
  });
});

// The three demographic blocks in `reportPresentation.ts` each harvest the label
// from their own list, so "the row is omitted" has to be proven against each of
// them rather than assumed from one. care-classic and care-premium both take the
// letter-pad path (`usesCareLetterpad` is id-driven), so the stacked and table
// shapes are reached by overriding the template, exactly as the compiled
// clinic-template path does.
describe("the durable print/PDF header draws the verdict", () => {
  const own = resolveReportAccession({
    isRadiology: true, studyId: 501, reportPatientId: 77,
    worklist: wl({ patientId: 77, accessionNumber: "ACC-20261012-MR-007" }),
    billedStudy: study({ patientId: 900, accessionNumber: "ACC-OTHER-PATIENT" }),
  });
  const nothing = resolveReportAccession({
    isRadiology: true, studyId: 501, reportPatientId: 77,
    worklist: wl({ patientId: 900 }),
    billedStudy: study({ patientId: 901 }),
  });

  function modelFor(resolved: ResolvedReportAccession): ReportDocumentModel {
    const row = accessionPrintRow(resolved);
    return {
      reportNumber: "RPT-20261012-001",
      studyTitle: "MRI BRAIN (PLAIN)",
      typeLabel: "RADIOLOGY",
      statusLabel: "VERIFIED",
      clinic: { name: "Care Diagnostics", tagline: "Precision Imaging", address: "Deoghar", phone: "06432-1234" },
      // The route's own order: Patient, Patient ID (= the UHID), then accession.
      patientRows: [
        { label: "Patient", value: "Sunita Sharma" },
        { label: "Patient ID", value: "PV-UHID-0001" },
        ...(row ? [row] : []),
        { label: "Age / Sex", value: "42y / F" },
      ],
      bodyHtml: "<p>FINDINGS: synthetic.</p>",
      stamp: { kind: "verified", label: "VERIFIED on 12/10/2026" },
      signatures: [],
      footerNote: "Not valid for medicolegal use without seal",
      generatedAtLabel: "12/10/2026, 3:00 pm",
    };
  }

  const premium = resolvePresentationTemplate("care-premium");
  /** Tags separate a label from its value in two of the three blocks, so the
   *  assertions read the document the way a clinician does — as text. */
  const visibleText = (html: string) =>
    html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
  const shapes: { name: string; template: RenderableTemplate; prints: string }[] = [
    { name: "care-classic (letter-pad)", template: resolvePresentationTemplate("care-classic"), prints: "ACCESSION: ACC-20261012-MR-007" },
    {
      name: "stacked",
      template: { ...premium, id: "clinic-stacked", letterhead: { kind: "clinic" }, layout: { ...premium.layout, patientBlockStyle: "stacked" } },
      prints: "Accession: ACC-20261012-MR-007",
    },
    {
      name: "table",
      template: { ...premium, id: "clinic-table", letterhead: { kind: "clinic" }, layout: { ...premium.layout, patientBlockStyle: "table" } },
      prints: "Accession No. : ACC-20261012-MR-007",
    },
  ];

  for (const shape of shapes) {
    it(`${shape.name}: prints the verified accession next to the UHID`, () => {
      const text = visibleText(renderReportDocument(modelFor(own), shape.template));
      expect(text).toContain(shape.prints);
      expect(text).toContain("PV-UHID-0001");
      // The collision candidate that was refused must not reach the page.
      expect(text).not.toContain("ACC-OTHER-PATIENT");
    });

    it(`${shape.name}: draws no accession label at all when nothing verified`, () => {
      const text = visibleText(renderReportDocument(modelFor(nothing), shape.template));
      expect(text.toLowerCase()).not.toContain("accession");
      expect(text).not.toContain("ACC-77");
      expect(text).not.toContain("ACC-STUDY-77");
      // The rest of the header is untouched by the refusal.
      expect(text).toContain("PV-UHID-0001");
      expect(text).toContain("Sunita Sharma");
    });
  }

  it("a patient name containing the word accession cannot make the check vacuous", () => {
    const rows = modelFor(nothing).patientRows;
    const html = renderReportDocument(
      { ...modelFor(nothing), patientRows: [{ label: "Patient", value: "Accession Sharma" }, ...rows.slice(1)] },
      shapes[2]!.template,
    );
    const text = visibleText(html);
    expect(text).toContain("Accession Sharma");
    expect(text).not.toContain(ACCESSION_ROW_LABEL);
  });
});
