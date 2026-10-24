/**
 * The identity relationship behind the durable accession, proven against real
 * rows.
 *
 * The unit suite (`reportStudyIdentity.test.ts`) proves the decision. This file
 * proves the two facts that decision rests on, which only a database can show:
 *
 *   1. `patient_reports.study_id` really is a SHARED id space — a
 *      `radiology_worklist` row EXISTS at the id a report names, and it can
 *      belong to a DIFFERENT patient. That is read back from Postgres here, not
 *      assumed.
 *   2. Whichever shape `study_id` holds, the value that reaches the printed
 *      document is the report's own patient's, or nothing is.
 *
 * No assertion below depends on which numbers the two `serial` columns happen to
 * hand out: the CI database starts empty, the clinic's does not, and a collision
 * between them is exactly the bug. Expectations that could flip with the serials
 * are computed from the rows that were actually created.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every `*.request.test.ts`.
 * Every patient, study, worklist, test and report is synthetic and carries the
 * run marker, so a leak is visible as a string this file created. Nothing here
 * reads or writes a clinic row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  patientReportsTable,
  patientsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";
import {
  ACCESSION_ROW_LABEL,
  accessionPrintRow,
  loadReportAccessionForReport,
} from "./reportStudyIdentity";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8).toUpperCase();
/** Marker-unique, so any printed value traces back to exactly one fixture row. */
const acc = (tag: string) => `ACC-P3-${RUN}-${tag}`;
/** Beyond every serial a fixture database can reach: a reference that resolves to nothing. */
const ORPHAN_REF = 987654321;
const OWN = acc("OWN-WORKLIST");
const OWN_STUDY = acc("OWN-STUDY");
const OWN_LONE = acc("OWN-LONE");
const FOREIGN_WL = acc("OTHER-WORKLIST");
const FOREIGN_STUDY = acc("OTHER-STUDY");

type Fixture = {
  testId: number;
  patientA: number;
  patientB: number;
  /** Owns no study and no worklist row anywhere — the probe patient. */
  patientC: number;
  studyA: number;
  /** A billed study no worklist row points at — the pre-worklist shape. */
  studyLone: number;
  worklistA: number;
  worklistForeign: number;
  studyForeign: number;
  worklistBlank: number;
  reports: {
    finalize: number;
    billed: number;
    /** study_id = a billed study no worklist row points at. */
    lone: number;
    collision: number;
    stranger: number;
    noStudy: number;
    orphan: number;
    pathology: number;
    blank: number;
  };
};

let f: Fixture;

async function seed(): Promise<Fixture> {
  const [test] = await db
    .insert(testsTable)
    .values({
      code: `P3-${RUN}`,
      name: `MRI BRAIN (PLAIN) ${RUN}`,
      category: "Radiology",
      price: "3000",
      duration: "30",
      department: "MRI",
    })
    .returning();

  const patient = async (tag: string, firstName: string) => {
    const [row] = await db
      .insert(patientsTable)
      .values({
        patientId: `P3-${RUN}-${tag}`,
        firstName,
        lastName: `SYNTHETIC ${RUN}`,
        dateOfBirth: "1980-01-01",
        gender: "male",
        phone: "9000000000",
      })
      .returning();
    return row.id;
  };
  const patientA = await patient("A", "Alpha");
  const patientB = await patient("B", "Bravo");
  const patientC = await patient("C", "Charlie");

  const study = async (patientId: number, tag: string) => {
    const [row] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: acc(tag),
        patientId,
        testId: test!.id,
        modality: "MR",
        department: "MRI",
        studyDescription: `MRI BRAIN ${RUN}`,
        status: "scheduled",
      })
      .returning();
    return row.id;
  };
  const worklist = async (opts: {
    patientId: number | null;
    tag: string;
    studyId: number | null;
    accession?: string;
  }) => {
    const [row] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `SYNTHETIC ${RUN}`,
        patientId: opts.patientId ?? undefined,
        patientMatchStatus: opts.patientId ? "MATCHED" : "UNMATCHED",
        studyId: opts.studyId ?? undefined,
        modality: "MR",
        studyDescription: `MRI BRAIN ${RUN}`,
        studyDate: "20261012",
        accessionNumber: opts.accession ?? acc(opts.tag),
        studyInstanceUID: `1.2.826.0.1.${RUN}.${opts.tag}`,
        status: "STUDY_RECEIVED",
      })
      .returning();
    return row.id;
  };

  const studyA = await study(patientA, "OWN-STUDY");
  const studyForeign = await study(patientB, "OTHER-STUDY");
  const worklistA = await worklist({ patientId: patientA, tag: "OWN-WORKLIST", studyId: studyA });
  // The mislink this module exists for: another patient's worklist row naming
  // patient A's billed study — what the PACS auto-linker writes when it guesses.
  const worklistForeign = await worklist({ patientId: patientB, tag: "OTHER-WORKLIST", studyId: studyA });
  const worklistBlank = await worklist({
    patientId: patientA, tag: "BLANK", studyId: null, accession: "   ",
  });
  // A billed study nothing in the worklist table points at: the pre-worklist
  // rows, where only `radiology_studies` can name the study.
  const studyLone = await study(patientA, "OWN-LONE");

  const report = async (opts: {
    patientId: number;
    studyId: number | null;
    type?: string;
    tag: string;
  }) => {
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-P3-${RUN}-${opts.tag}`,
        type: opts.type ?? "radiology",
        patientId: opts.patientId,
        testId: test!.id,
        studyId: opts.studyId,
        title: `MRI BRAIN (PLAIN) ${RUN}`,
        body: "<p>FINDINGS: synthetic findings, no clinical content.</p>",
        impression: "Synthetic impression.",
        status: "verified",
        signedByName: "Dr Synthetic Rao",
        signedAt: new Date("2026-10-12T09:00:00+05:30"),
        verifiedByName: "Dr Synthetic Rao",
        verifiedAt: new Date("2026-10-12T09:30:00+05:30"),
      })
      .returning();
    return row.id;
  };

  const reports = {
    finalize: await report({ patientId: patientA, studyId: worklistA, tag: "FINALIZE" }),
    billed: await report({ patientId: patientA, studyId: studyA, tag: "BILLED" }),
    lone: await report({ patientId: patientA, studyId: studyLone, tag: "LONE" }),
    collision: await report({ patientId: patientB, studyId: worklistA, tag: "COLLISION" }),
    stranger: await report({ patientId: patientC, studyId: worklistA, tag: "STRANGER" }),
    noStudy: await report({ patientId: patientA, studyId: null, tag: "NOSTUDY" }),
    orphan: await report({ patientId: patientA, studyId: ORPHAN_REF, tag: "ORPHAN" }),
    pathology: await report({ patientId: patientA, studyId: worklistA, tag: "PATHOLOGY", type: "pathology" }),
    blank: await report({ patientId: patientA, studyId: worklistBlank, tag: "BLANK" }),
  };

  return {
    testId: test!.id,
    patientA,
    patientB,
    patientC,
    studyA,
    studyLone,
    worklistA,
    worklistForeign,
    studyForeign,
    worklistBlank,
    reports,
  };
}

async function teardown(x: Fixture) {
  await db.delete(patientReportsTable).where(eq(patientReportsTable.testId, x.testId)).catch(() => {});
  for (const tag of ["OWN-WORKLIST", "OTHER-WORKLIST", "BLANK"]) {
    await db
      .delete(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, `1.2.826.0.1.${RUN}.${tag}`))
      .catch(() => {});
  }
  for (const a of [OWN_STUDY, FOREIGN_STUDY, OWN_LONE]) {
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.accessionNumber, a)).catch(() => {});
  }
  await db.delete(testsTable).where(eq(testsTable.id, x.testId)).catch(() => {});
  for (const tag of ["A", "B", "C"]) {
    await db.delete(patientsTable).where(eq(patientsTable.patientId, `P3-${RUN}-${tag}`)).catch(() => {});
  }
}

/**
 * Who owns a value that would be printed? Looked up by the marker-unique string
 * in BOTH candidate tables, so a resolver that printed a foreign accession fails
 * here instead of agreeing with its own bug.
 */
async function ownersOf(accession: string): Promise<number[]> {
  const [w, s] = await Promise.all([
    db
      .select({ p: radiologyWorklistTable.patientId })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.accessionNumber, accession)),
    db
      .select({ p: radiologyStudiesTable.patientId })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.accessionNumber, accession)),
  ]);
  return [...w.map((r) => r.p), ...s.map((r) => r.p)].filter((v): v is number => v != null);
}

const FOREIGN_VALUES = [FOREIGN_WL, FOREIGN_STUDY];

/**
 * The two-shape worklist lookup, read straight from the tables, so a test can
 * state which row the loader must have seen without asking the loader itself.
 * Same order as `resolveWorklistFromStudyRef`: the primary key first, then the
 * `study_id` link.
 */
async function rawWorklistAt(ref: number) {
  const byId = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, ref))
    .limit(1);
  if (byId[0]) return byId[0];
  const byStudy = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyId, ref))
    .limit(1);
  return byStudy[0] ?? null;
}

/** The route's own question, with the report row as the database holds it. */
async function verdictForReport(reportId: number) {
  const [row] = await db
    .select({ type: patientReportsTable.type, studyId: patientReportsTable.studyId, patientId: patientReportsTable.patientId })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, reportId))
    .limit(1);
  return loadReportAccessionForReport(row!);
}

function visibleText(html: string): string {
  // Tags separate a label from its value in two of the three demographic blocks.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
}

describe.skipIf(!dbAvailable)("durable report accession — real rows", () => {
  beforeAll(async () => {
    f = await seed();
  }, 60_000);

  afterAll(async () => {
    if (f) await teardown(f);
  });

  it("the seeded rows really do share an id space", async () => {
    // The claim the whole module is built on, measured rather than asserted from
    // the fixture code: the number a report names in `study_id` can resolve to a
    // worklist row AND to a billed study row at the same time, and the worklist
    // row can belong to a different patient than the report does.
    const [report] = await db
      .select({ patientId: patientReportsTable.patientId, studyId: patientReportsTable.studyId })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, f.reports.collision))
      .limit(1);
    expect(report?.studyId).toBe(f.worklistA);
    const [rowAtThatNumber] = await db
      .select({ patientId: radiologyWorklistTable.patientId, accession: radiologyWorklistTable.accessionNumber })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, f.worklistA))
      .limit(1);
    expect(rowAtThatNumber?.accession).toBe(OWN);
    expect(rowAtThatNumber?.patientId).not.toBe(report?.patientId);
  });

  describe("loadReportAccessionForReport", () => {
    it("resolves the finalize shape: study_id = radiology_worklist.id", async () => {
      const r = await verdictForReport(f.reports.finalize);
      expect(r).toMatchObject({ status: "resolved", accession: OWN, source: "worklist" });
      expect(accessionPrintRow(r)).toEqual({ label: ACCESSION_ROW_LABEL, value: OWN });
    });

    it.each(["billed", "lone"] as const)("uses only the resolved worklist's link for a legacy %s reference", async (shape) => {
      const studyRef = shape === "billed" ? f.studyA : f.studyLone;
      const r = await verdictForReport(f.reports[shape]);
      const wl = await rawWorklistAt(studyRef);
      const billedId = wl ? wl.studyId : studyRef;
      const [billed] = billedId ? await db.select().from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.id, billedId)).limit(1) : [];
      const ownWorklist = wl?.patientId === f.patientA ? wl.accessionNumber?.trim() : "";
      const ownBilled = billed?.patientId === f.patientA ? billed.accessionNumber?.trim() : "";
      const expected = ownWorklist || ownBilled;
      if (!expected) {
        expect(r.status).toBe("absent");
        expect(accessionPrintRow(r)).toBeNull();
        return;
      }
      expect(r).toMatchObject({ status: "resolved", accession: expected, source: ownWorklist ? "worklist" : "billed-study" });
      expect(FOREIGN_VALUES).not.toContain(expected);
      expect((await ownersOf(expected)).every((p) => p === f.patientA)).toBe(true);
    });

    it("refuses another patient's worklist and its linked billed study", async () => {
      const r = await verdictForReport(f.reports.collision);
      expect(r).toMatchObject({ status: "absent", reason: "patient-mismatch" });
      expect(r.status === "absent" && r.rejected.some((x) => x.source === "worklist")).toBe(true);
      expect(accessionPrintRow(r)).toBeNull();
    });

    it("prints nothing for a patient who owns neither candidate", async () => {
      const r = await verdictForReport(f.reports.stranger);
      expect(r).toMatchObject({ status: "absent", reason: "patient-mismatch" });
      expect(accessionPrintRow(r)).toBeNull();
    });

    it("treats a missing study reference as absence, not as a blank", async () => {
      expect(await verdictForReport(f.reports.noStudy)).toMatchObject({
        status: "absent", reason: "no-study-reference",
      });
    });

    it("treats a study reference that matches no row as absence", async () => {
      const r = await verdictForReport(f.reports.orphan);
      expect(r).toMatchObject({ status: "absent", reason: "no-candidate" });
      expect(accessionPrintRow(r)).toBeNull();
    });

    it("withholds it from a pathology report whose same id resolves for radiology", async () => {
      const path = await verdictForReport(f.reports.pathology);
      expect(path).toMatchObject({ status: "absent", reason: "not-radiology" });
      // The refusal above is the type gate, not an empty lookup: the sibling
      // radiology report on the same worklist row does resolve.
      expect((await verdictForReport(f.reports.finalize)).status).toBe("resolved");
    });

    it("leaves an unlinked worklist with a blank accession unlabelled", async () => {
      const r = await verdictForReport(f.reports.blank);
      expect(r).toMatchObject({ status: "absent", reason: "blank-accession" });
      expect(accessionPrintRow(r)).toBeNull();
    });
  });

  describe("the durable artifact every delivery surface renders", () => {
    // Print, PDF, the public/WhatsApp PDF, email share and the PACS archive all
    // call buildReportArtifact (patient-reports.ts:3043), so this IS the document
    // a patient or a referring clinician receives.
    it("names the study in the printed header of a linked radiology report", async () => {
      const { buildReportArtifact } = await import("../routes/patient-reports");
      const artifact = await buildReportArtifact(f.reports.finalize, { surface: "pdf", versionMode: "specific" });
      expect(artifact).not.toBeNull();
      const text = visibleText(artifact!.html);
      // Label and value adjacent — not merely the string present somewhere.
      expect(/accession.{0,14}ACC-P3-/i.test(text)).toBe(true);
      expect(text).toContain(OWN);
      expect(text).toContain(`P3-${RUN}-A`); // the UHID, unchanged beside it
      for (const foreign of FOREIGN_VALUES) expect(text).not.toContain(foreign);
    });

    it("does not print the other patient's accession on a mislinked report", async () => {
      const { buildReportArtifact } = await import("../routes/patient-reports");
      const artifact = await buildReportArtifact(f.reports.collision, {
        surface: "public_pdf", versionMode: "specific",
      });
      expect(artifact).not.toBeNull();
      const text = visibleText(artifact!.html);
      // The naive join's answer must not appear on patient B's document.
      expect(text).not.toContain(OWN);
      expect(text.toLowerCase()).not.toContain("accession");
      expect(text).toContain(`MRI BRAIN (PLAIN) ${RUN}`); // and the document is intact
      expect(text).toContain(`P3-${RUN}-B`);
    });

    it("omits the accession line entirely when the report has no study", async () => {
      const { buildReportArtifact } = await import("../routes/patient-reports");
      const artifact = await buildReportArtifact(f.reports.noStudy, { surface: "email", versionMode: "specific" });
      expect(artifact).not.toBeNull();
      const text = visibleText(artifact!.html);
      expect(text.toLowerCase()).not.toContain("accession");
      expect(text).toContain(`MRI BRAIN (PLAIN) ${RUN}`);
    });
  });
});
