/**
 * Z.AI audit item 8 — a referring-doctor correction must reach the modality.
 *
 * `PATCH /api/radiology/pacs-worklist/:id/referring-doctor` is the one-tap chip in
 * Reporting Workspace (`ReferringDoctorQuickSelect`). It wrote the worklist row and
 * the linked `radiology_studies` row, then called `republishWorklistForAccession`
 * to re-issue the `.wl` the scanner fetches — but that function selects
 * `radiology_scheduled_procedures` by accession and hands THAT row to the writer,
 * and the PATCH never touched it. So the correction printed on every ERP surface
 * while the technologist's console kept showing the referrer the radiologist had
 * just replaced, and the toast said "Referring doctor set".
 *
 * These cases drive the real route over a real Postgres and read the row the
 * publisher reads, then feed that row to the repo's own dump builder — the artefact
 * leg is asserted from the bytes the writer would emit, not from a grep of the
 * route. (`dump2dcm` is not installed here or in CI, so a produced `.wl` file is
 * not observable in either; that is why the dump text is taken from the exported
 * builder over the stored row.)
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  billsTable,
  ordersTable,
  patientsTable,
  portalSessionsTable,
  radiologyScheduledProceduresTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { buildMwlDumpText } from "../lib/pacs/mwlWorklistWriter";

const dbReady = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8).toUpperCase();

const OLD_DOC = `DR OLD ${RUN}`;
const NEW_DOC = `DR NEW ${RUN}`;

describe.skipIf(!dbReady)("referring-doctor correction → the modality worklist", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const created = {
    worklistIds: [] as number[],
    studyIds: [] as number[],
    procedureAccessions: [] as string[],
    patientIds: [] as number[],
    testIds: [] as number[],
    orderIds: [] as number[],
    billIds: [] as number[],
  };

  beforeAll(async () => {
    app = await createTestApp();
    token = `rd-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Referrer Tester ${RUN}`,
        email: `referrer-${RUN}@vitest.invalid`,
        username: `referrer-${RUN}`,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/reports"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: userId,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    // Child rows first; every table here is marker-scoped to this run.
    if (created.procedureAccessions.length) {
      await db
        .delete(radiologyScheduledProceduresTable)
        .where(inArray(radiologyScheduledProceduresTable.accessionNumber, created.procedureAccessions));
    }
    if (created.worklistIds.length) await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, created.worklistIds));
    if (created.studyIds.length) await db.delete(radiologyStudiesTable).where(inArray(radiologyStudiesTable.id, created.studyIds));
    if (created.billIds.length) await db.delete(billsTable).where(inArray(billsTable.id, created.billIds));
    if (created.orderIds.length) await db.delete(ordersTable).where(inArray(ordersTable.id, created.orderIds));
    if (created.testIds.length) await db.delete(testsTable).where(inArray(testsTable.id, created.testIds));
    if (created.patientIds.length) await db.delete(patientsTable).where(inArray(patientsTable.id, created.patientIds));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  /**
   * One booked, published study: patient → order → bill → radiology study →
   * worklist row → scheduled procedure, the last being the row MWL is built from.
   */
  async function scenario(tag: string, opts: { procedure?: boolean; status?: string } = {}) {
    const accession = `RD-${RUN}-${tag}`;
    const suffix = `${RUN}-${tag}`;
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `RD-UHID-${suffix}`,
        firstName: `Vitest`,
        lastName: `Referrer ${tag}`,
        dateOfBirth: "1985-04-02",
        gender: "female",
        phone: "9000000000",
      })
      .returning();
    const [test] = await db
      .insert(testsTable)
      .values({
        code: `RD-${suffix}`,
        name: `MRI BRAIN ${suffix}`,
        category: "Radiology",
        price: "1200",
        duration: "20",
        department: "MRI",
      })
      .returning();
    const [order] = await db
      .insert(ordersTable)
      .values({ patientId: patient.id, orderNumber: `RD-ORD-${suffix}`, status: "completed", totalAmount: "1200" })
      .returning();
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `RD-BILL-${suffix}`,
        orderId: order.id,
        patientId: patient.id,
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
        accessionNumber: accession,
        billId: bill.id,
        orderId: order.id,
        patientId: patient.id,
        testId: test.id,
        modality: "MR",
        department: "MRI",
        studyDate: "2026-11-13",
        studyDescription: `MRI BRAIN ${suffix}`,
        referringDoctor: OLD_DOC,
        status: "scheduled",
      })
      .returning();
    const [worklist] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Vitest Referrer ${tag}`,
        age: "40Y",
        sex: "F",
        modality: "MR",
        studyDescription: `MRI BRAIN ${suffix}`,
        studyDate: "20261113",
        accessionNumber: accession,
        studyInstanceUID: `1.2.826.${suffix}`,
        referringDoctor: OLD_DOC,
        patientMatchStatus: "MATCHED",
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "STUDY_RECEIVED",
        studyId: study.id,
      })
      .returning();

    if (opts.procedure !== false) {
      await db.insert(radiologyScheduledProceduresTable).values({
        accessionNumber: accession,
        patientId: `RD-UHID-${suffix}`,
        patientName: `Vitest Referrer ${tag}`,
        modality: "MR",
        studyDescription: `MRI BRAIN ${suffix}`,
        referringDoctor: OLD_DOC,
        // The doctors-master id the booking resolved, so a test can show the
        // correction replacing the publisher's own typed-name convention.
        referringDoctorId: `9${RUN.slice(0, 4)}`,
        scheduledDate: "20261113",
        scheduledTime: "093000",
        stationAeTitle: "MRI01",
        status: opts.status ?? "SCHEDULED",
      });
      created.procedureAccessions.push(accession);
    }

    created.patientIds.push(patient.id, patient.id);
    created.testIds.push(test.id);
    created.orderIds.push(order.id);
    created.billIds.push(bill.id);
    created.studyIds.push(study.id);
    created.worklistIds.push(worklist.id);

    return { worklistId: worklist.id, studyId: study.id, accession, patient, test, order, bill };
  }

  const procedureRow = async (accession: string) => {
    const [row] = await db
      .select()
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, accession))
      .limit(1);
    return row;
  };

  const patch = async (worklistId: number, referringDoctor: string) =>
    request(app)
      .patch(`/api/radiology/pacs-worklist/${worklistId}/referring-doctor`)
      .set("Authorization", `Bearer ${token}`)
      .send({ referringDoctor });

  const referrerLine = (dump: string) => dump.match(/\(0008,0090\) PN \[([^\]]*)\]/)?.[1] ?? null;

  /**
   * The states `republishWorklistForAccession` can only reach with a folder
   * mounted: with none configured it returns `skipped` before it looks at any
   * row, so "no procedure row" and "terminal status, file removed" are both
   * unobservable. A fresh empty folder is the deployment's shape, not a mock —
   * every write into it goes to a directory no scanner reads.
   */
  const patchWithFolder = async (worklistId: number, referringDoctor: string) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), `mwl-rd-${RUN}-`));
    const previous = process.env.ORTHANC_WORKLIST_DIR;
    process.env.ORTHANC_WORKLIST_DIR = dir;
    try {
      return await patch(worklistId, referringDoctor);
    } finally {
      if (previous === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
      else process.env.ORTHANC_WORKLIST_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  };

  // ── 1. The defect ──────────────────────────────────────────────────────────
  it("corrects the row the worklist file is actually built from", async () => {
    const s = await scenario("ROW");
    const res = await patch(s.worklistId, NEW_DOC);
    expect(res.status).toBe(200);

    const row = await procedureRow(s.accession);
    expect(row?.referringDoctor, "the published procedure must carry the correction").toBe(NEW_DOC);
  });

  it("re-issues a dump that names the corrected doctor, not the booked one", async () => {
    const s = await scenario("DUMP");
    await patch(s.worklistId, NEW_DOC);

    // Exactly what `republishWorklistForAccession` reads and hands to the writer.
    const row = await procedureRow(s.accession);
    const dump = buildMwlDumpText(row as any);
    const printed = referrerLine(dump);
    expect(printed, "the referrer the console paints").not.toBeNull();
    expect(printed!.toUpperCase()).toContain(RUN);
    expect(printed!).toContain("NEW");
    expect(printed!).not.toContain("OLD");
  });

  it("drops the doctors-master id the booking resolved, as a typed name always does", async () => {
    const s = await scenario("ID");
    expect((await procedureRow(s.accession))?.referringDoctorId).not.toBeNull();
    await patch(s.worklistId, NEW_DOC);
    // `resolveReferringDoctor` returns `{ id: null }` for any typed name, so a row
    // claiming both a hand-typed referrer and the old doctor's id would be a row
    // no publisher could have written.
    expect((await procedureRow(s.accession))?.referringDoctorId).toBeNull();
  });

  // ── 2. The surfaces that already worked must keep working ──────────────────
  it("moves the worklist row and the billed study row in the same request", async () => {
    const s = await scenario("SURFACES");
    await patch(s.worklistId, NEW_DOC);
    const [wl] = await db
      .select({ referringDoctor: radiologyWorklistTable.referringDoctor })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, s.worklistId));
    const [study] = await db
      .select({ referringDoctor: radiologyStudiesTable.referringDoctor })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, s.studyId));
    expect(wl?.referringDoctor).toBe(NEW_DOC);
    expect(study?.referringDoctor).toBe(NEW_DOC);
    expect((await procedureRow(s.accession))?.referringDoctor).toBe(NEW_DOC);
  });

  // ── 3. Controls ────────────────────────────────────────────────────────────
  it("clearing the referrer clears every surface, and the dump names no one", async () => {
    const s = await scenario("CLEAR");
    await patch(s.worklistId, "");
    expect((await procedureRow(s.accession))?.referringDoctor).toBeNull();
    const dump = buildMwlDumpText((await procedureRow(s.accession)) as any);
    // Blank, never "ANONYMOUS": a walk-in must not be shown as referred by someone.
    expect(referrerLine(dump)).toBe("");
  });

  it("one study's correction does not rewrite another accession's procedure", async () => {
    // The update is keyed by accession. A mutant that drops the WHERE clause fixes
    // the console in front of the radiologist and corrupts every other patient's.
    const mine = await scenario("SCOPE-A");
    const other = await scenario("SCOPE-B");
    await patch(mine.worklistId, NEW_DOC);
    expect((await procedureRow(other.accession))?.referringDoctor).toBe(OLD_DOC);
  });

  it("a worklist row with no accession updates no procedure row and publishes nothing", async () => {
    const tagged = await scenario("NOACC");
    const [bare] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Vitest No Accession ${RUN}`,
        age: "40Y",
        sex: "F",
        modality: "MR",
        studyDescription: `MRI BRAIN ${RUN}-NOACC-B`,
        studyDate: "20261113",
        accessionNumber: "",
        studyInstanceUID: `1.2.826.${RUN}.NOACC.B`,
        referringDoctor: OLD_DOC,
        status: "STUDY_RECEIVED",
      })
      .returning();
    created.worklistIds.push(bare.id);
    try {
      const res = await patch(bare.id, NEW_DOC);
      expect(res.status).toBe(200);
      expect(res.body.mwl).toMatchObject({ attempted: false, action: "skipped" });
      expect((await procedureRow(tagged.accession))?.referringDoctor).toBe(OLD_DOC);
    } finally {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, bare.id));
    }
  });

  it("a study that was never published reports no worklist entry instead of claiming success", async () => {
    // The state the workspace toast names. Nothing here can fix the machine's copy,
    // because the machine was never given one — saying "Referring doctor set" alone
    // is how a technologist ends up scanning under the old referrer.
    const s = await scenario("NOPUB", { procedure: false });
    const res = await patchWithFolder(s.worklistId, NEW_DOC);
    expect(res.status).toBe(200);
    expect(res.body.mwl).toMatchObject({ attempted: false, action: "no_procedure_row" });
    // The correction is not lost with the file: the rows the ERP prints still move.
    const [wl] = await db
      .select({ referringDoctor: radiologyWorklistTable.referringDoctor })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, s.worklistId))
      .limit(1);
    expect(wl?.referringDoctor).toBe(NEW_DOC);
  });

  it("a correction on a scanned study still lands in the row it was published from", async () => {
    const s = await scenario("DONE", { status: "COMPLETED" });
    const res = await patchWithFolder(s.worklistId, NEW_DOC);
    expect(res.status).toBe(200);
    expect((await procedureRow(s.accession))?.referringDoctor).toBe(NEW_DOC);
    // And the file is not put back on the console: a completed examination goes
    // down the removal leg, exactly as a test withheld from the machine does.
    expect(res.body.mwl.attempted).toBe(true);
    expect(res.body.mwl.action).toBe("withheld");
  });

  // ── 4. The outcome the desk is shown ───────────────────────────────────────
  it("reports the republish outcome with the correction", async () => {
    const s = await scenario("OUTCOME");
    const offline = await patch(s.worklistId, NEW_DOC);
    expect(offline.body.mwl).toMatchObject({ attempted: false, action: "skipped" });

    // With a worklist folder configured the route must say it went and rewrote it.
    // `written` is deliberately not asserted: it depends on `dump2dcm`, which this
    // machine and CI do not install — see the client suite for that state's wording.
    const res = await patchWithFolder(s.worklistId, `DR OTHER ${RUN}`);
    expect(res.status).toBe(200);
    expect(res.body.mwl.attempted).toBe(true);
    expect(res.body.mwl.action).toBe("written");
    // Its *value* is environment-dependent (`dump2dcm` is absent here and in CI,
    // present on the NAS), but the field itself is the difference between "we
    // tried" and "the console can read it", so the route must always carry it
    // when it says it wrote.
    expect(typeof res.body.mwl.written).toBe("boolean");
  });

  it("answers 400 without a string and 404 for a worklist row that does not exist", async () => {
    const s = await scenario("GUARDS");
    const bad = await request(app)
      .patch(`/api/radiology/pacs-worklist/${s.worklistId}/referring-doctor`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(bad.status).toBe(400);
    const missing = await patch(9_999_999, NEW_DOC);
    expect(missing.status).toBe(404);
    // The refusal must not have rewritten anything either.
    expect((await procedureRow(s.accession))?.referringDoctor).toBe(OLD_DOC);
  });
});
