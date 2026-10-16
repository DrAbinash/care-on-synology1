/**
 * PRIORITY 4 (RIS/PACS integration review, 2026-10-16) — the report the PACS archive renders must
 * belong to the patient the archive is being written for.
 *
 * `patient_reports.study_id` is a shared identifier space: the Reporting Workspace finalize path
 * stores the `radiology_worklist` ROW id there, while legacy rows store the billed
 * `radiology_studies` id. `resolveArchiveReportRow` has to look in both, and the two id sequences
 * are independent — so "41" is simultaneously someone else's worklist row and this patient's
 * billed study. An unscoped pick therefore renders another patient's signed report into this
 * study's Orthanc series, stamped with this patient's DICOM PatientName/PatientID.
 *
 * Why the resolver is tested directly rather than through `archiveReportToPacs`: that function
 * launches Chromium and POSTs a DICOM object to Orthanc. The decision under test is the SQL pick
 * that happens before either, and it is exported for exactly that reason.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  billsTable,
  ordersTable,
  patientReportsTable,
  patientsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";
import { resolveArchiveReportRow } from "./pacsArchive";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

type Fixture = {
  patientId: number;
  testId: number;
  orderId: number;
  billId: number;
  studyId: number;
  worklistId: number | null;
  reportIds: number[];
};

const made: Fixture[] = [];

async function person(tag: string): Promise<number> {
  const [p] = await db
    .insert(patientsTable)
    .values({
      patientId: `ARCH-${RUN}-${tag}`,
      firstName: `Archive ${tag}`,
      lastName: RUN,
      dateOfBirth: "1980-01-01",
      gender: "female",
      phone: "9000000000",
    })
    .returning();
  return p.id;
}

/** A billed radiology study for one patient — the archive entrypoint's argument. */
async function billedStudy(tag: string, patientId: number, testId: number): Promise<{ studyId: number; orderId: number; billId: number }> {
  const suffix = `${RUN}-${tag}`;
  const [order] = await db
    .insert(ordersTable)
    .values({ patientId, orderNumber: `ORD-${suffix}`, status: "completed", totalAmount: "1200" })
    .returning();
  const [bill] = await db
    .insert(billsTable)
    .values({
      billNumber: `ARCH-${suffix}`,
      orderId: order.id,
      patientId,
      subtotal: "1200",
      totalAmount: "1200",
      paidAmount: "1200",
      balanceAmount: "0",
      status: "paid",
    })
    .returning();
  const [study] = await db
    .insert(radiologyStudiesTable)
    .values({
      accessionNumber: `ACC-${suffix}`,
      billId: bill.id,
      orderId: order.id,
      patientId,
      testId,
      modality: "MR",
      department: "MRI",
      studyDate: "2026-09-15",
      studyDescription: "MRI Brain",
      status: "acquired",
    })
    .returning();
  return { studyId: study.id, orderId: order.id, billId: bill.id };
}

/** A signed report row. `studyId` is written verbatim — that is the whole point. */
async function signedReport(f: Fixture, studyIdValue: number, body: string): Promise<number> {
  const [report] = await db
    .insert(patientReportsTable)
    .values({
      // `patient_reports.report_number` carries a UNIQUE index, and this file creates several
      // fixtures per run, so the number is keyed on the fixture's own patient id.
      reportNumber: `RPT-${RUN}-${f.patientId}-${f.reportIds.length + 1}`,
      type: "radiology",
      patientId: f.patientId,
      testId: f.testId,
      orderId: f.orderId,
      billId: f.billId,
      studyId: studyIdValue,
      title: body,
      body: `<p>${body}</p>`,
      status: "final",
      signedByName: "Dr Archive",
      signedAt: new Date(),
    })
    .returning();
  f.reportIds.push(report.id);
  return report.id;
}

async function teardown(f: Fixture) {
  for (const id of f.reportIds) {
    await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
  }
  if (f.worklistId != null) {
    await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, f.worklistId)).catch(() => {});
  }
  await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, f.studyId)).catch(() => {});
  await db.delete(billsTable).where(eq(billsTable.id, f.billId)).catch(() => {});
  await db.delete(ordersTable).where(eq(ordersTable.id, f.orderId)).catch(() => {});
  await db.delete(testsTable).where(eq(testsTable.id, f.testId)).catch(() => {});
  await db.delete(patientsTable).where(eq(patientsTable.id, f.patientId)).catch(() => {});
}

async function fixture(tag: string): Promise<Fixture> {
  const [test] = await db
    .insert(testsTable)
    .values({
      code: `ARCH-${RUN}-${tag}`,
      name: `MRI BRAIN ${RUN}-${tag}`,
      category: "Radiology",
      price: "1200",
      duration: "30",
      department: "MRI",
    })
    .returning();
  const patientId = await person(tag);
  const { studyId, orderId, billId } = await billedStudy(tag, patientId, test.id);
  const f: Fixture = { patientId, testId: test.id, orderId, billId, studyId, worklistId: null, reportIds: [] };
  made.push(f);
  return f;
}

describe.skipIf(!dbAvailable)("the PACS archive may only render this patient's report", () => {
  afterAll(async () => {
    for (const f of made) await teardown(f);
  });

  it("positive control: a legacy report keyed by the billed study id still resolves", async () => {
    const own = await fixture("own-legacy");
    const reportId = await signedReport(own, own.studyId, "OWN PATIENT REPORT");

    const picked = await resolveArchiveReportRow({ id: own.studyId, patientId: own.patientId });
    expect(picked?.id).toBe(reportId);
  });

  it("positive control: a finalize-path report keyed by the worklist row id still resolves", async () => {
    const own = await fixture("own-worklist");
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Archive own-worklist ${RUN}`,
        patientId: own.patientId,
        patientMatchStatus: "MATCHED",
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: "20260915",
        accessionNumber: `ACC-${RUN}-own-worklist`,
        studyId: own.studyId,
        status: "REPORT_FINAL",
      })
      .returning();
    own.worklistId = wl.id;
    const reportId = await signedReport(own, wl.id, "OWN FINALIZE REPORT");

    const picked = await resolveArchiveReportRow({ id: own.studyId, patientId: own.patientId });
    expect(picked?.id).toBe(reportId);
  });

  it("never renders another patient's report reachable through this study's worklist leg", async () => {
    const mine = await fixture("mine");
    const other = await fixture("other");

    // The realistic shape, and the one the billing side can create by itself: a worklist row that
    // points at MY billed study while belonging to ANOTHER patient. The resolver looks up both id
    // namespaces, so that row's id enters the search — and it is exactly the id my counterpart's
    // finalize-path report carries in patient_reports.study_id.
    const [foreignWl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Archive other ${RUN}`,
        patientId: other.patientId,
        patientMatchStatus: "MATCHED",
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: "20260915",
        accessionNumber: `ACC-${RUN}-foreign`,
        studyId: mine.studyId,
        status: "REPORT_FINAL",
      })
      .returning();
    other.worklistId = foreignWl.id;
    await signedReport(other, foreignWl.id, "ANOTHER PATIENT REPORT");

    // Nothing of mine exists yet, so the only row in range is the foreign one.
    const alone = await resolveArchiveReportRow({ id: mine.studyId, patientId: mine.patientId });
    expect(alone).toBeNull();

    // And when mine does exist, mine wins rather than whichever row the engine happened to read
    // first — the pick has no ORDER BY, so without one this is a coin toss the archive stores in
    // Orthanc as a DICOM object.
    const mineReportId = await signedReport(mine, mine.studyId, "OWN PATIENT REPORT");
    const both = await resolveArchiveReportRow({ id: mine.studyId, patientId: mine.patientId });
    expect(both?.id).toBe(mineReportId);
  });

  it("is deterministic when the same patient has two candidate rows", async () => {
    const own = await fixture("two-rows");
    await signedReport(own, own.studyId, "OLDER");
    const newer = await signedReport(own, own.studyId, "NEWER");

    const first = await resolveArchiveReportRow({ id: own.studyId, patientId: own.patientId });
    const second = await resolveArchiveReportRow({ id: own.studyId, patientId: own.patientId });
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toBe(newer);
  });
});
