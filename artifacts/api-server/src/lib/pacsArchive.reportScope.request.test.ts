/**
 * PRIORITY 4 (RIS/PACS integration review, 2026-10-16) — the report the PACS archive renders must
 * belong to the patient AND the examination the archive is being written for.
 *
 * `patient_reports.study_id` is a shared identifier space: the Reporting Workspace finalize path
 * stores the `radiology_worklist` ROW id there, while legacy rows store the billed
 * `radiology_studies` id. `resolveArchiveReportRow` has to look in both, and the two id sequences
 * are independent — so "41" is simultaneously someone else's worklist row and this patient's
 * billed study.
 *
 * Two consequences, one per describe block below:
 *  1. an unscoped pick renders ANOTHER PATIENT's signed report into this study's Orthanc series;
 *  2. a pick scoped only by patient renders ANOTHER EXAMINATION of the same patient — an MRI LS
 *     Spine report filed inside an MRI Brain series, under the correct name and patient ID, which
 *     is the harder failure because everything on the object looks right.
 *
 * Why the resolver is tested directly rather than through `archiveReportToPacs`: that function
 * launches Chromium and POSTs a DICOM object to Orthanc. The decision under test is the SQL pick
 * that happens before either, and it is exported for exactly that reason.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts. A mocked `db` cannot
 * prove any of this — the existing D8 mock discards its `where` argument entirely, which is why the
 * cross-patient defect survived it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  billsTable,
  ordersTable,
  orderTestsTable,
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
  orderTestId: number;
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

/** A radiology master test. `code` is UNIQUE, so the run marker and tag both ride on it. */
async function radiologyTest(tag: string, name: string): Promise<number> {
  const [t] = await db
    .insert(testsTable)
    .values({
      code: `ARCHX-${RUN}-${tag}-${name.replace(/\s+/g, "")}`,
      name: `MRI ${name} ${RUN}`,
      category: "Radiology",
      price: "1200",
      duration: "30",
      department: "MRI",
    })
    .returning();
  return t.id;
}

/**
 * A billed radiology study for one patient — the archive entrypoint's argument.
 *
 * `forceId` writes an explicit primary key. That is not a shortcut: the defect under test needs a
 * `radiology_worklist.id` and a `radiology_studies.id` to be the SAME number, and the two tables
 * count independently, so in production the coincidence happens on its own (that is how #1042's
 * cross-patient case arises). Forcing the pair is how the test says "these two sequences have
 * overlapped" without waiting for it.
 */
async function billedStudy(
  tag: string,
  patientId: number,
  testId: number,
  opts: { forceId?: number; description?: string } = {},
): Promise<{ studyId: number; orderId: number; billId: number; orderTestId: number }> {
  const suffix = `${RUN}-${tag}`;
  const [order] = await db
    .insert(ordersTable)
    .values({ patientId, orderNumber: `ORD-${suffix}`, status: "completed", totalAmount: "1200" })
    .returning();
  // The row a real study is fanned out from (generateStudiesForOrder). `radiology_studies.order_test_id`
  // is UNIQUE, so it identifies one examination and no other — which is the fact the legacy-spelling
  // check leans on when a patient has the same test twice.
  const [orderTest] = await db
    .insert(orderTestsTable)
    .values({ orderId: order.id, testId, price: "1200" })
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
      ...(opts.forceId != null ? { id: opts.forceId } : {}),
      accessionNumber: `ACC-${suffix}`,
      billId: bill.id,
      orderId: order.id,
      orderTestId: orderTest.id,
      patientId,
      testId,
      modality: "MR",
      department: "MRI",
      studyDate: "2026-09-15",
      studyDescription: opts.description ?? "MRI Brain",
      status: "acquired",
    })
    .returning();
  return { studyId: study.id, orderId: order.id, billId: bill.id, orderTestId: orderTest.id };
}

/** A PACS worklist row bound to a billed study, with the report back-link the finalize path writes. */
async function worklistRow(opts: {
  tag: string;
  patientId: number;
  studyId: number;
  forceId?: number;
  description?: string;
}): Promise<number> {
  const suffix = `${RUN}-${opts.tag}`;
  const [row] = await db
    .insert(radiologyWorklistTable)
    .values({
      ...(opts.forceId != null ? { id: opts.forceId } : {}),
      patientName: `Archive ${opts.tag} ${RUN}`,
      patientId: opts.patientId,
      patientMatchStatus: "MATCHED",
      modality: "MR",
      studyDescription: opts.description ?? "MRI Brain",
      studyDate: "20260915",
      accessionNumber: `ACC-${suffix}`,
      studyId: opts.studyId,
      status: "REPORT_FINAL",
    })
    .returning();
  return row.id;
}

/** A signed report carrying the full billing identity the finalize path writes onto it. */
async function examReport(parts: {
  patientId: number;
  testId: number;
  orderId: number | null;
  billId: number | null;
  orderTestId: number | null;
  studyId: number | null;
  title: string;
  seq: number;
  reportIds: number[];
}): Promise<number> {
  const [report] = await db
    .insert(patientReportsTable)
    .values({
      reportNumber: `RPT-${RUN}-${parts.patientId}-${parts.seq}`,
      type: "radiology",
      patientId: parts.patientId,
      testId: parts.testId,
      orderId: parts.orderId,
      billId: parts.billId,
      orderTestId: parts.orderTestId,
      studyId: parts.studyId,
      title: parts.title,
      body: `<p>${parts.title}</p>`,
      status: "final",
      signedByName: "Dr Archive",
      signedAt: new Date(),
    })
    .returning();
  parts.reportIds.push(report.id);
  return report.id;
}

/**
 * The resolver's argument, read back out of `radiology_studies` the way `archiveReportToPacs`
 * reads it. Deliberately not hand-written: RIS-005 was a defect in the fields the implementation
 * chose NOT to look at, so a literal that spells out only the ones it uses would flatter it.
 */
async function studyRef(studyId: number) {
  const [row] = await db
    .select({
      id: radiologyStudiesTable.id,
      patientId: radiologyStudiesTable.patientId,
      testId: radiologyStudiesTable.testId,
      billId: radiologyStudiesTable.billId,
      orderId: radiologyStudiesTable.orderId,
      orderTestId: radiologyStudiesTable.orderTestId,
    })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId))
    .limit(1);
  return row;
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
      orderTestId: f.orderTestId,
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
  // order_tests carries the FKs (→ orders, → tests), so it goes before both.
  await db.delete(orderTestsTable).where(eq(orderTestsTable.id, f.orderTestId)).catch(() => {});
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
  const { studyId, orderId, billId, orderTestId } = await billedStudy(tag, patientId, test.id);
  const f: Fixture = {
    patientId, testId: test.id, orderId, billId, orderTestId, studyId, worklistId: null, reportIds: [],
  };
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

    const picked = await resolveArchiveReportRow(await studyRef(own.studyId));
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

    const picked = await resolveArchiveReportRow(await studyRef(own.studyId));
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
    const alone = await resolveArchiveReportRow(await studyRef(mine.studyId));
    expect(alone).toBeNull();

    // And when mine does exist, mine wins rather than whichever row the engine happened to read
    // first — the pick has no ORDER BY, so without one this is a coin toss the archive stores in
    // Orthanc as a DICOM object.
    const mineReportId = await signedReport(mine, mine.studyId, "OWN PATIENT REPORT");
    const both = await resolveArchiveReportRow(await studyRef(mine.studyId));
    expect(both?.id).toBe(mineReportId);
  });

  it("is deterministic when the same patient has two candidate rows", async () => {
    const own = await fixture("two-rows");
    await signedReport(own, own.studyId, "OLDER");
    const newer = await signedReport(own, own.studyId, "NEWER");

    const first = await resolveArchiveReportRow(await studyRef(own.studyId));
    const second = await resolveArchiveReportRow(await studyRef(own.studyId));
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toBe(newer);
  });
});

/**
 * RIS-005: the second obligation. Correct patient, wrong examination.
 *
 * Patient A has an MRI Brain and an MRI LS Spine. `patientId` is identical on both; the accession,
 * the worklist row, the billed study, the test and the report are all different. Filing the LS
 * Spine report inside the Brain study's series produces a DICOM object whose patient name, patient
 * ID, accession and StudyInstanceUID are all CORRECT — so nothing on the archive tells anyone the
 * document is for a different question. That is why patient scoping alone is not enough.
 */
describe.skipIf(!dbAvailable)("the PACS archive may only render this examination's report", () => {
  type ExamFixture = {
    patientId: number;
    brainTestId: number;
    lsTestId: number;
    brain: { studyId: number; orderId: number; billId: number; orderTestId: number; worklistId: number };
    ls: { studyId: number; orderId: number; billId: number; orderTestId: number; worklistId: number };
    reportIds: number[];
    worklistIds: number[];
    studyIds: number[];
    billIds: number[];
    orderIds: number[];
    orderTestIds: number[];
    testIds: number[];
  };

  const examMade: ExamFixture[] = [];
  // A number no small serial in either table will have reached, so the two explicit inserts below
  // are the only rows that share it — which is precisely the overlap being tested.
  const COLLIDED_ID = 950000 + (parseInt(RUN.slice(0, 4), 16) % 40000);
  // Each fixture needs its OWN overlapped number: the studies and worklist rows of every fixture live in the
  // same table until afterAll, so reusing one id across fixtures would collide with itself.
  let overlapSeq = 0;

  async function examFixture(tag: string): Promise<ExamFixture> {
    const sharedId = COLLIDED_ID + overlapSeq++;
    const patientId = await person(`exam-${tag}`);
    const brainTestId = await radiologyTest(tag, "BRAIN");
    const lsTestId = await radiologyTest(tag, "LS SPINE");

    const brainBase = await billedStudy(`exam-${tag}-brain`, patientId, brainTestId, {
      forceId: sharedId,
      description: "MRI BRAIN",
    });
    const lsBase = await billedStudy(`exam-${tag}-ls`, patientId, lsTestId, {
      description: "MRI LS SPINE",
    });
    const brainWorklistId = await worklistRow({
      tag: `exam-${tag}-brain-wl`,
      patientId,
      studyId: brainBase.studyId,
      description: "MRI BRAIN",
    });
    // The overlap: this worklist row's id IS the Brain study's id, and it is bound to the LS study.
    const lsWorklistId = await worklistRow({
      tag: `exam-${tag}-ls-wl`,
      patientId,
      studyId: lsBase.studyId,
      forceId: sharedId,
      description: "MRI LS SPINE",
    });

    return {
      patientId,
      brainTestId,
      lsTestId,
      brain: { ...brainBase, worklistId: brainWorklistId },
      ls: { ...lsBase, worklistId: lsWorklistId },
      reportIds: [],
      worklistIds: [brainWorklistId, lsWorklistId],
      studyIds: [brainBase.studyId, lsBase.studyId],
      billIds: [brainBase.billId, lsBase.billId],
      orderIds: [brainBase.orderId, lsBase.orderId],
      orderTestIds: [brainBase.orderTestId, lsBase.orderTestId],
      testIds: [brainTestId, lsTestId],
    };
  }

  async function examTeardown(f: ExamFixture) {
    for (const id of f.reportIds) await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    for (const id of f.worklistIds) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    for (const id of f.studyIds) await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    for (const id of f.billIds) await db.delete(billsTable).where(eq(billsTable.id, id)).catch(() => {});
    for (const id of f.orderTestIds) await db.delete(orderTestsTable).where(eq(orderTestsTable.id, id)).catch(() => {});
    for (const id of f.orderIds) await db.delete(ordersTable).where(eq(ordersTable.id, id)).catch(() => {});
    for (const id of f.testIds) await db.delete(testsTable).where(eq(testsTable.id, id)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, f.patientId)).catch(() => {});
  }

  afterAll(async () => {
    for (const f of examMade) await examTeardown(f);
  });

  it("positive pair: each examination of one patient resolves to its own report", async () => {
    const f = await examFixture("both");
    examMade.push(f);
    const brainReport = await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: f.brain.orderId, billId: f.brain.billId, orderTestId: f.brain.orderTestId,
      studyId: f.brain.worklistId, title: "BRAIN REPORT", seq: 1, reportIds: f.reportIds,
    });
    const lsReport = await examReport({
      patientId: f.patientId, testId: f.lsTestId, orderId: f.ls.orderId, billId: f.ls.billId, orderTestId: f.ls.orderTestId,
      studyId: f.ls.worklistId, title: "LS SPINE REPORT", seq: 2, reportIds: f.reportIds,
    });

    const forBrain = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    const forLs = await resolveArchiveReportRow(await studyRef(f.ls.studyId));
    expect(forBrain?.id).toBe(brainReport);
    expect(forLs?.id).toBe(lsReport);
  });

  it("refuses to file another examination's report when the two id spaces collide", async () => {
    const f = await examFixture("collide");
    examMade.push(f);
    // Only the LS Spine report exists. Archiving the BRAIN study must not adopt it, even though
    // the patient matches and the LS worklist row's id equals the Brain study's id.
    const lsReport = await examReport({
      patientId: f.patientId, testId: f.lsTestId, orderId: f.ls.orderId, billId: f.ls.billId, orderTestId: f.ls.orderTestId,
      studyId: f.ls.worklistId, title: "LS SPINE REPORT", seq: 1, reportIds: f.reportIds,
    });

    const picked = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(picked?.id).not.toBe(lsReport);
    expect(picked).toBeNull();

    // And the same report is still correctly reachable from the examination it belongs to — the
    // refusal above must not be the resolver failing to find anything at all.
    const forLs = await resolveArchiveReportRow(await studyRef(f.ls.studyId));
    expect(forLs?.id).toBe(lsReport);
  });

  it("prefers the examination's own report over a colliding one when both are reachable", async () => {
    const f = await examFixture("prefer");
    examMade.push(f);
    // Order matters here. The Brain report is written FIRST, so the colliding LS Spine row is the
    // newest — and newest-first is exactly what an unsighted resolver would then archive. If this
    // fixture were created the other way round the assertion would pass on recency alone and prove
    // nothing about the refusal.
    const brainReport = await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: f.brain.orderId, billId: f.brain.billId, orderTestId: f.brain.orderTestId,
      studyId: f.brain.worklistId, title: "BRAIN REPORT", seq: 1, reportIds: f.reportIds,
    });
    await examReport({
      patientId: f.patientId, testId: f.lsTestId, orderId: f.ls.orderId, billId: f.ls.billId, orderTestId: f.ls.orderTestId,
      studyId: f.ls.worklistId, title: "LS SPINE REPORT SIGNED AFTERWARDS", seq: 2, reportIds: f.reportIds,
    });

    const picked = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(picked?.id).toBe(brainReport);
  });

  it("a report with no study reference is never adopted by an arbitrary examination", async () => {
    const f = await examFixture("null-study");
    examMade.push(f);
    await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: f.brain.orderId, billId: f.brain.billId, orderTestId: f.brain.orderTestId,
      studyId: null, title: "REPORT WITH NO STUDY LINK", seq: 1, reportIds: f.reportIds,
    });

    const picked = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(picked).toBeNull();
  });

  it("keeps the legacy spelling working: a report keyed by the billed study id of the right exam resolves", async () => {
    const f = await examFixture("legacy");
    examMade.push(f);
    const legacy = await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: f.brain.orderId, billId: f.brain.billId, orderTestId: f.brain.orderTestId,
      studyId: f.brain.studyId, title: "LEGACY BRAIN REPORT", seq: 1, reportIds: f.reportIds,
    });

    const picked = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(picked?.id).toBe(legacy);
  });

  /**
   * Owner test case 7 — the amendment contract. `patient-reports.ts:1810-1817` copies the parent's
   * `testId`/`orderTestId`/`orderId`/`billId`/`studyId` onto the amendment verbatim, so an amendment
   * belongs to the same examination as what it corrects and must be the row the archive picks.
   */
  it("picks the amendment of this examination, not the superseded row and not another examination's", async () => {
    const f = await examFixture("amend");
    examMade.push(f);
    await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: f.brain.orderId, billId: f.brain.billId, orderTestId: f.brain.orderTestId,
      studyId: f.brain.worklistId, title: "BRAIN ROOT", seq: 1, reportIds: f.reportIds,
    });
    const amendment = await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: f.brain.orderId, billId: f.brain.billId, orderTestId: f.brain.orderTestId,
      studyId: f.brain.worklistId, title: "BRAIN AMENDMENT", seq: 2, reportIds: f.reportIds,
    });
    await examReport({
      patientId: f.patientId, testId: f.lsTestId, orderId: f.ls.orderId, billId: f.ls.billId, orderTestId: f.ls.orderTestId,
      studyId: f.ls.worklistId, title: "LS SPINE AMENDMENT", seq: 3, reportIds: f.reportIds,
    });

    const first = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(first?.id).toBe(amendment);
    // Same study, twice, same row — the pick must not be a coin toss between the amendment and the
    // LS spine report that shares this patient.
    const second = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(second?.id).toBe(amendment);
  });

  /**
   * RIS-005's hardest case, and the one `patient_id` plus `test_id` cannot answer: the SAME patient
   * scanned with the SAME master test a year apart. Both rows agree on patient and test, so only the
   * billing identity says which examination a signed report was written for — and `order_test_id` is
   * UNIQUE on `radiology_studies`, so it names one study and no other.
   */
  it("refuses the previous year's report when a patient repeats the identical test", async () => {
    const sharedId = COLLIDED_ID + overlapSeq++;
    const patientId = await person("repeat");
    const testId = await radiologyTest("repeat", "BRAIN");

    const older = await billedStudy("repeat-older", patientId, testId, { description: "MRI BRAIN" });
    const olderWl = await worklistRow({
      tag: "repeat-older-wl", patientId, studyId: older.studyId, forceId: sharedId, description: "MRI BRAIN",
    });
    // The overlap the shared id space produces by itself: the NEW study's primary key is the OLD
    // worklist row's id, and the old report carries that number as its study reference.
    const newer = await billedStudy("repeat-newer", patientId, testId, { forceId: sharedId, description: "MRI BRAIN" });
    const newerWl = await worklistRow({
      tag: "repeat-newer-wl", patientId, studyId: newer.studyId, description: "MRI BRAIN",
    });
    expect(newer.studyId).toBe(olderWl);

    const f: ExamFixture = {
      // brain/ls here mean "first examination" / "the repeat", both of the identical master test.
      patientId,
      brainTestId: testId,
      lsTestId: testId,
      brain: { ...older, worklistId: olderWl },
      ls: { ...newer, worklistId: newerWl },
      reportIds: [],
      worklistIds: [olderWl, newerWl],
      studyIds: [older.studyId, newer.studyId],
      billIds: [older.billId, newer.billId],
      orderIds: [older.orderId, newer.orderId],
      orderTestIds: [older.orderTestId, newer.orderTestId],
      testIds: [testId],
    };
    examMade.push(f);

    // The PREVIOUS year's report is written last, so it is the highest id: newest-first cannot be
    // what makes the assertion below pass, only the refusal of a contradictory billing identity can.
    const newReport = await examReport({
      patientId, testId, orderId: newer.orderId, billId: newer.billId, orderTestId: newer.orderTestId,
      studyId: newerWl, title: "CURRENT YEAR BRAIN REPORT", seq: 1, reportIds: f.reportIds,
    });
    const oldReport = await examReport({
      patientId, testId, orderId: older.orderId, billId: older.billId, orderTestId: older.orderTestId,
      studyId: olderWl, title: "PREVIOUS YEAR BRAIN REPORT", seq: 2, reportIds: f.reportIds,
    });

    const forNewer = await resolveArchiveReportRow(await studyRef(newer.studyId));
    expect(forNewer?.id).toBe(newReport);
    expect(forNewer?.id).not.toBe(oldReport);

    // And the refusal above is scoping, not blindness: the previous year's report is still exactly
    // where that year's own study points.
    const forOlder = await resolveArchiveReportRow(await studyRef(older.studyId));
    expect(forOlder?.id).toBe(oldReport);
  });

  /**
   * Duplicate modality intake binds TWO `radiology_worklist` rows to one billed study, and the
   * report can hang off either. The resolver looks up every bound row, so a `.limit(1)` here would
   * silently archive "no report" for the second one.
   */
  it("finds the report through any of several worklist rows bound to the same study", async () => {
    const f = await examFixture("two-wl");
    examMade.push(f);
    const secondWl = await worklistRow({
      tag: "exam-two-wl-second", patientId: f.patientId, studyId: f.brain.studyId, description: "MRI BRAIN",
    });
    f.worklistIds.push(secondWl);
    const report = await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: f.brain.orderId, billId: f.brain.billId, orderTestId: f.brain.orderTestId,
      studyId: secondWl, title: "BRAIN REPORT OFF SECOND WORKLIST ROW", seq: 1, reportIds: f.reportIds,
    });

    const picked = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(picked?.id).toBe(report);
  });

  /**
   * The shape the billing terms cannot see: a genuinely old row that carries no bill, order or
   * order-test at all. `test_id` is NOT NULL on both `patient_reports` and `radiology_studies`, so it
   * is the one examination discriminator that a legacy row cannot be missing — and the reason the
   * billing checks are allowed to pass on absence while this one is not.
   */
  it("refuses a legacy row with no billing identity that names a different test, and still accepts one that names this test", async () => {
    const f = await examFixture("null-billing");
    examMade.push(f);
    // Contradictory: keyed to the BRAIN study's own id, but the LS Spine test.
    await examReport({
      patientId: f.patientId, testId: f.lsTestId, orderId: null, billId: null, orderTestId: null,
      studyId: f.brain.studyId, title: "LEGACY ROW FOR THE WRONG TEST", seq: 1, reportIds: f.reportIds,
    });

    const refused = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(refused).toBeNull();

    // Same missing billing identity, correct test — the row the clinic actually has to keep working.
    const sameTest = await examReport({
      patientId: f.patientId, testId: f.brainTestId, orderId: null, billId: null, orderTestId: null,
      studyId: f.brain.studyId, title: "LEGACY ROW WITH NO BILLING IDENTITY", seq: 2, reportIds: f.reportIds,
    });
    const accepted = await resolveArchiveReportRow(await studyRef(f.brain.studyId));
    expect(accepted?.id).toBe(sameTest);
  });
});
