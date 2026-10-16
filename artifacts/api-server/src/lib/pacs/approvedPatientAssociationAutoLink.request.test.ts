/**
 * An APPROVED patient association must survive bill auto-linking.
 *
 * Match Center approval is a human answer to "which patient is this study". The billed-study
 * cascade in `worklistBillingLink.ts` answers the same question from data the bill desk typed
 * (lane 1, normalized accession) or from a name ± referral ranking (lane 3), and its single
 * write point copies `radiology_studies.patient_id` onto `radiology_worklist.patient_id`. So a
 * row that is approved to patient A but not yet linked to a bill can be re-pointed at patient B
 * by the very guess the approval was meant to replace — silently, on the paths that run by
 * themselves: DICOM intake for ultrasound (`internal-radiology.ts:991`), worklist entry load
 * (`:2013`), Reporting Studio (`internal-reporting-studio.ts:804`) and the backfill.
 *
 * The guard therefore belongs at the one writer, not at its callers, and it must refuse in
 * preview exactly as in a real run — a preview that over-reported the backfill's yield would
 * send the operator into the same overwrite.
 *
 * What is asserted alongside the refusal is the part that must NOT regress: an unapproved row
 * still links, and an approved row whose billed study belongs to the SAME patient still gets
 * its bill. Refusing every approved row would strand the clinic's USG backlog on Match Center.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  billsTable,
  ordersTable,
  patientsTable,
  radiologyAuditLogTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { autoLinkBilledStudyForWorklist } from "./worklistBillingLink";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

type Fixture = {
  patientA: number;
  patientB: number;
  testId: number;
  orderId: number;
  billId: number;
  studyId: number;
  worklistId: number;
};

/**
 * Patient A is the approved identity; patient B owns the billed study.
 *
 * `lane` chooses how the cascade is supposed to reach B's study: "accession" gives the worklist
 * row B's accession string (lane 1, GREEN, and the one that runs during ultrasound intake);
 * "name" leaves the accession blank and lets the name ± referral ranking find it (lane 3, capped
 * to YELLOW — the demographic guess the brief names explicitly).
 */
async function fixture(opts: {
  tag: string;
  lane: "accession" | "name";
  approved: boolean;
  /**
   * One date per case, a week apart. Lane 3 searches every billed study inside a day-radius of
   * the worklist date, so five fixtures sharing one date make it answer "ambiguous" before it
   * ever reaches the write the guard is supposed to refuse.
   */
  studyDate: string;
}): Promise<Fixture> {
  const suffix = `${RUN}-${opts.tag}`;
  const accession = `ACC-${suffix}`;
  // Lane 3 ranks across every billed study in the date window, so the name has to be unique per
  // fixture or two of them are equally good and the cascade answers "ambiguous" instead of
  // reaching the write under test.
  const billedFirst = `Billed${opts.tag.replace(/[^a-z0-9]/gi, "")}`;

  const [a] = await db
    .insert(patientsTable)
    .values({
      patientId: `APPR-UHID-${suffix}-A`,
      firstName: "Approved",
      lastName: `Alpha ${suffix}`,
      dateOfBirth: "1985-04-02",
      gender: "female",
      phone: "9000000001",
    })
    .returning();
  const [b] = await db
    .insert(patientsTable)
    .values({
      patientId: `APPR-UHID-${suffix}-B`,
      firstName: billedFirst,
      lastName: `Bravo ${suffix}`,
      dateOfBirth: "1979-07-09",
      gender: "male",
      phone: "9000000002",
    })
    .returning();

  const [test] = await db
    .insert(testsTable)
    .values({
      code: `APPR-${suffix}`,
      name: `USG WHOLE ABDOMEN ${suffix}`,
      category: "Radiology",
      price: "1200",
      duration: "20",
      department: "USG",
    })
    .returning();

  const [order] = await db
    .insert(ordersTable)
    .values({
      patientId: b.id,
      orderNumber: `ORD-${suffix}`,
      status: "completed",
      totalAmount: "1200",
    })
    .returning();

  const [bill] = await db
    .insert(billsTable)
    .values({
      billNumber: `APPR-${suffix}`,
      orderId: order.id,
      patientId: b.id,
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
      patientId: b.id,
      testId: test.id,
      modality: "US",
      department: "USG",
      studyDate: opts.studyDate,
      studyDescription: `USG WHOLE ABDOMEN ${suffix}`,
      status: "scheduled",
    })
    .returning();

  // The worklist row: approved to patient A, still carrying no bill link — the shape the
  // cascade is allowed to fill in, and the shape the approval must protect.
  const [worklist] = await db
    .insert(radiologyWorklistTable)
    .values({
      // Lane 3 ranks on these, so the row is described as patient B even though a human said it
      // is patient A. That is precisely the disagreement under test — and if the demographics did
      // not fit B's study, the cascade would never reach the write and the case would pass
      // vacuously.
      patientName: `${billedFirst} Bravo ${suffix}`,
      patientId: a.id,
      patientMatchStatus: "MATCHED",
      age: "47Y",
      sex: "M",
      modality: "US",
      studyDescription: `USG WHOLE ABDOMEN ${suffix}`,
      studyDate: opts.studyDate.replace(/-/g, ""),
      accessionNumber: opts.lane === "accession" ? accession : "",
      studyInstanceUID: `1.2.826.apppr.${suffix}`,
      matchScore: opts.approved ? "YELLOW" : "RED",
      matchDecision: opts.approved ? "APPROVED" : "NONE",
      matchApprovedBy: opts.approved ? "Match Center" : null,
      matchApprovedAt: opts.approved ? new Date() : null,
      status: "STUDY_RECEIVED",
    })
    .returning();

  return {
    patientA: a.id,
    patientB: b.id,
    testId: test.id,
    orderId: order.id,
    billId: bill.id,
    studyId: study.id,
    worklistId: worklist.id,
  };
}

async function readBack(f: Fixture) {
  const [w] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, f.worklistId))
    .limit(1);
  const [s] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, f.studyId))
    .limit(1);
  const audits = await db
    .select({ id: radiologyAuditLogTable.id })
    .from(radiologyAuditLogTable)
    .where(eq(radiologyAuditLogTable.worklistId, f.worklistId));
  return { w, s, auditCount: audits.length };
}

async function teardown(f: Fixture) {
  await db.delete(radiologyAuditLogTable).where(eq(radiologyAuditLogTable.worklistId, f.worklistId)).catch(() => {});
  await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, f.worklistId)).catch(() => {});
  await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, f.studyId)).catch(() => {});
  await db.delete(billsTable).where(eq(billsTable.id, f.billId)).catch(() => {});
  await db.delete(ordersTable).where(eq(ordersTable.id, f.orderId)).catch(() => {});
  await db.delete(testsTable).where(eq(testsTable.id, f.testId)).catch(() => {});
  await db
    .delete(patientsTable)
    .where(eq(patientsTable.id, f.patientA))
    .catch(() => {});
  await db.delete(patientsTable).where(eq(patientsTable.id, f.patientB)).catch(() => {});
}

describe.skipIf(!dbAvailable)("auto-link must not replace an APPROVED patient association", () => {
  const made: Fixture[] = [];

  afterAll(async () => {
    for (const f of made) await teardown(f);
  });

  it("lane 1 (accession): refuses to move an approved row to another patient, and writes nothing", async () => {
    const f = await fixture({ tag: "acc-approved", lane: "accession", approved: true, studyDate: "2026-09-27" });
    made.push(f);

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:approved");

    expect(result.linked).toBe(false);
    // The reason is read by the backfill operator and logged at intake; it has to say which
    // authority refused, not just that nothing matched.
    expect(result.reason).toMatch(/APPROVED/i);
    expect(result.reason).toMatch(/Match Center/i);

    const after = await readBack(f);
    expect(after.w.patientId).toBe(f.patientA);
    expect(after.w.studyId).toBeNull();
    expect(after.w.matchDecision).toBe("APPROVED");
    expect(after.s.status).toBe("scheduled");
    expect(after.s.acquiredAt).toBeNull();
    expect(after.auditCount).toBe(0);
  });

  it("lane 3 (name±referral): refuses the demographic guess over an approved association", async () => {
    const f = await fixture({ tag: "name-approved", lane: "name", approved: true, studyDate: "2026-10-05" });
    made.push(f);

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:approved");
    expect(result.linked).toBe(false);
    expect(result.reason).toMatch(/APPROVED/i);

    const after = await readBack(f);
    expect(after.w.patientId).toBe(f.patientA);
    expect(after.w.studyId).toBeNull();
    expect(after.auditCount).toBe(0);
  });

  it("preview refuses for the same reason a real run does", async () => {
    // The backfill's `--preview` number is the operator's only sight of what 8,649 unlinked rows
    // would become. A preview that kept counting approved rows as linkable would promise a yield
    // the run then refuses to deliver.
    const f = await fixture({ tag: "acc-preview", lane: "accession", approved: true, studyDate: "2026-09-28" });
    made.push(f);

    const previewed = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:approved", {
      preview: true,
    });
    const executed = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:approved");

    expect(previewed.linked).toBe(false);
    expect(previewed.reason).toBe(executed.reason);

    const after = await readBack(f);
    expect(after.w.patientId).toBe(f.patientA);
    expect(after.w.studyId).toBeNull();
  });

  it("control: an unapproved row still links, and takes the billed study's patient as before", async () => {
    // Without this case the guard could be a blanket refusal and still pass everything above.
    const f = await fixture({ tag: "acc-unapproved", lane: "accession", approved: false, studyDate: "2026-09-29" });
    made.push(f);

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:control");
    expect(result.linked).toBe(true);
    expect(result.method).toBe("accession-normalized");
    expect(result.studyId).toBe(f.studyId);

    const after = await readBack(f);
    expect(after.w.studyId).toBe(f.studyId);
    expect(after.w.patientId).toBe(f.patientB);
    expect(after.s.status).toBe("acquired");
    expect(after.auditCount).toBe(1);
  });

  it("control: an approved row whose billed study is the SAME patient still gets its bill", async () => {
    const f = await fixture({ tag: "acc-same-patient", lane: "accession", approved: true, studyDate: "2026-09-30" });
    made.push(f);
    // The common approved shape: the human approved the row onto the patient who owns the bill.
    await db
      .update(radiologyWorklistTable)
      .set({ patientId: f.patientB })
      .where(eq(radiologyWorklistTable.id, f.worklistId));

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:approved");
    expect(result.linked).toBe(true);
    expect(result.studyId).toBe(f.studyId);

    const after = await readBack(f);
    expect(after.w.patientId).toBe(f.patientB);
    expect(after.w.matchDecision).toBe("APPROVED");
  });
});
