/**
 * Preview mode on the bill-linking matcher.
 *
 * WHY THIS FILE EXISTS
 * `backfill-usg-bill-link.ts --preview` is meant to answer "how many of the
 * clinic's 8,649 unlinked rows will this backfill actually link, and why do the
 * rest refuse?" before anything is written to live billing rows. That question
 * is only worth asking if the preview reaches the same answer the run would.
 * A preview that reimplemented the matching would drift the first time a lane
 * changed and would still pass every test in this file, so the property that
 * matters is not "preview returns a sensible number" — it is:
 *
 *   1. preview writes NOTHING, in any of the three places a real link touches;
 *   2. preview and execute return the SAME decision and the SAME reason for the
 *      same data;
 *   3. preview does not consume a candidate, so two rows competing for one
 *      study both report "would link" — the number is an upper bound, and that
 *      is a fact the operator needs, not a bug to hide.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 * Orthanc is not involved: every lane here reads Postgres only.
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
import { eq } from "drizzle-orm";import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { autoLinkBilledStudyForWorklist } from "./worklistBillingLink";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

type Fixture = {
  patientId: number;
  testId: number;
  orderId: number;
  billId: number;
  studyId: number;
  worklistId: number;
};

/**
 * A billed radiology study and a PACS worklist row, deliberately unlinked.
 *
 * `linkBy` chooses which lane should be able to find the pair: "accession"
 * gives both sides the same accession string (lane 1, the GREEN fast path);
 * "name" leaves the worklist accession blank and relies on the patient's name,
 * modality and study date matching (lane 3, the one the clinic's backlog
 * actually needs).
 */
async function fixture(opts: {
  tag: string;
  linkBy: "accession" | "name" | "nothing";
  patientFirst: string;
  patientLast: string;
  /** ISO for radiology_studies. */
  studyDate: string;
  /** DICOM compact for radiology_worklist. */
  worklistStudyDate: string;
  modality?: string;
  studyAccession?: string;
  worklistAccession?: string;
  worklistUid?: string;
}): Promise<Fixture> {
  const suffix = `${RUN}-${opts.tag}`;
  const accession = opts.studyAccession ?? `ACC-${suffix}`;

  const [patient] = await db
    .insert(patientsTable)
    .values({
      patientId: `PV-UHID-${suffix}`,
      firstName: opts.patientFirst,
      lastName: opts.patientLast,
      dateOfBirth: "1985-04-02",
      gender: "female",
      phone: "9000000000",
    })
    .returning();

  const [test] = await db
    .insert(testsTable)
    .values({
      code: `PV-${suffix}`,
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
      patientId: patient.id,
      orderNumber: `ORD-${suffix}`,
      status: "completed",
      totalAmount: "1200",
    })
    .returning();

  const [bill] = await db
    .insert(billsTable)
    .values({
      // `unique(ledger_id, bill_number)` since PR #790, so this must be distinct
      // per fixture. The tag already is; deriving it from digits of the run id
      // collides across tags and fails the insert.
      billNumber: `PV-${suffix}`,
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
      modality: opts.modality ?? "US",
      department: "USG",
      studyDate: opts.studyDate,
      studyDescription: `USG WHOLE ABDOMEN ${suffix}`,
      status: "scheduled",
    })
    .returning();

  // The worklist side: what the PACS pushed. No study_id, no patient_id —
  // exactly the shape of the 8,649 rows in the clinic's backlog.
  const [worklist] = await db
    .insert(radiologyWorklistTable)
    .values({
      patientName: `${opts.patientFirst} ${opts.patientLast}`,
      age: "40Y",
      sex: "F",
      modality: opts.modality ?? "US",
      studyDescription: `USG WHOLE ABDOMEN ${suffix}`,
      studyDate: opts.worklistStudyDate,
      accessionNumber:
        opts.linkBy === "accession"
          ? accession
          : opts.worklistAccession !== undefined
            ? opts.worklistAccession
            : "",
      studyInstanceUID: opts.worklistUid ?? `1.2.826.${suffix}`,
      status: "STUDY_RECEIVED",
    })
    .returning();

  return {
    patientId: patient.id,
    testId: test.id,
    orderId: order.id,
    billId: bill.id,
    studyId: study.id,
    worklistId: worklist.id,
  };
}

async function teardown(f: Fixture) {
  await db.delete(radiologyAuditLogTable).where(eq(radiologyAuditLogTable.worklistId, f.worklistId)).catch(() => {});
  await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, f.worklistId)).catch(() => {});
  await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, f.studyId)).catch(() => {});
  await db.delete(billsTable).where(eq(billsTable.id, f.billId)).catch(() => {});
  await db.delete(ordersTable).where(eq(ordersTable.id, f.orderId)).catch(() => {});
  await db.delete(testsTable).where(eq(testsTable.id, f.testId)).catch(() => {});
  await db.delete(patientsTable).where(eq(patientsTable.id, f.patientId)).catch(() => {});
}

/** Everything a real link writes. Preview must leave all of it untouched. */
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

describe.skipIf(!dbAvailable)("worklistBillingLink preview", () => {
  const made: Fixture[] = [];

  afterAll(async () => {
    for (const f of made) await teardown(f);
  });

  it("preview reports the link and writes none of the three things a real link touches", async () => {
    const f = await fixture({
      tag: "pv1",
      linkBy: "accession",
      patientFirst: "Preview",
      patientLast: `Accession ${RUN}`,
      studyDate: "2026-09-20",
      worklistStudyDate: "20260920",
    });
    made.push(f);

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:preview", {
      preview: true,
    });

    expect(result.linked).toBe(true);
    expect(result.preview).toBe(true);
    expect(result.studyId).toBe(f.studyId);
    expect(result.method).toBe("accession-normalized");
    expect(result.matchScore).toBe("GREEN");

    const after = await readBack(f);
    expect(after.w.studyId).toBeNull();
    expect(after.w.patientId).toBeNull();
    expect(after.s.status).toBe("scheduled");
    expect(after.s.acquiredAt).toBeNull();
    expect(after.s.studyInstanceUid).toBeNull();
    expect(after.auditCount).toBe(0);
  });

  it("execute writes all three things preview skipped", async () => {
    const f = await fixture({
      tag: "ex1",
      linkBy: "accession",
      patientFirst: "Execute",
      patientLast: `Accession ${RUN}`,
      studyDate: "2026-09-21",
      worklistStudyDate: "20260921",
    });
    made.push(f);

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:execute");
    expect(result.linked).toBe(true);
    expect(result.preview).toBeUndefined();

    const after = await readBack(f);
    expect(after.w.studyId).toBe(f.studyId);
    expect(after.w.patientId).toBe(f.patientId);
    expect(after.s.status).toBe("acquired");
    expect(after.s.acquiredAt).not.toBeNull();
    // The link is auditable: this is what makes a 3,922-row backfill reversible.
    expect(after.auditCount).toBe(1);
  });

  it("preview and execute reach the same decision and the same reason", async () => {
    const p = await fixture({
      tag: "parity-p",
      linkBy: "accession",
      patientFirst: "Parity",
      patientLast: `Preview ${RUN}`,
      studyDate: "2026-09-22",
      worklistStudyDate: "20260922",
    });
    const e = await fixture({
      tag: "parity-e",
      linkBy: "accession",
      patientFirst: "Parity",
      patientLast: `Execute ${RUN}`,
      studyDate: "2026-09-22",
      worklistStudyDate: "20260922",
    });
    made.push(p, e);

    const previewed = await autoLinkBilledStudyForWorklist(p.worklistId, "vitest:preview", {
      preview: true,
    });
    const executed = await autoLinkBilledStudyForWorklist(e.worklistId, "vitest:execute");

    // Compared without studyId, which is fixture-local by construction.
    expect({ ...previewed, studyId: 0, preview: undefined }).toEqual({
      ...executed,
      studyId: 0,
      preview: undefined,
    });
  });

  it("a refusal carries the same reason in both modes and writes nothing", async () => {
    const f = await fixture({
      tag: "ref1",
      linkBy: "nothing",
      patientFirst: "Nobody",
      patientLast: `Matches ${RUN}`,
      studyDate: "2026-09-23",
      worklistStudyDate: "20260923",
      // Same modality and date, but the name is unrelated to the billed
      // patient, so no lane can claim it — the clinic's most common shape.
      worklistAccession: "",
    });
    made.push(f);
    // Break the name link the only way lane 3 could otherwise use.
    await db
      .update(radiologyWorklistTable)
      .set({ patientName: `Stranger Unrelated ${RUN}` })
      .where(eq(radiologyWorklistTable.id, f.worklistId));

    const previewed = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:preview", {
      preview: true,
    });
    const afterPreview = await readBack(f);
    expect(previewed.linked).toBe(false);
    expect(previewed.preview).toBeUndefined();
    expect(afterPreview.w.studyId).toBeNull();
    expect(afterPreview.auditCount).toBe(0);

    const executed = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:execute");
    expect(executed.linked).toBe(false);
    // The reason string is the whole product: an operator reads these to decide
    // whether to widen the backfill or send rows to Match Center instead.
    expect(executed.reason).toBe(previewed.reason);
    expect(executed.reason).toContain("Match Center");
  });

  it("preview does not consume a candidate, so competition is an upper bound", async () => {
    // One billed study, two worklist rows claiming the same accession. A real
    // run links the first and the second then sees the study as already
    // claimed; a preview run reports both as linkable because it wrote nothing.
    // Asserting this keeps the summary honest: `wouldLink` counts decisions,
    // not distinct studies, and the script reports the overlap separately.
    const shared = `ACC-shared-${RUN}`;
    const a = await fixture({
      tag: "cmp-a",
      linkBy: "accession",
      patientFirst: "Compete",
      patientLast: `Alpha ${RUN}`,
      studyDate: "2026-09-24",
      worklistStudyDate: "20260924",
      studyAccession: shared,
      worklistAccession: shared,
    });
    const b = await fixture({
      tag: "cmp-b",
      linkBy: "name",
      patientFirst: "Compete",
      patientLast: `Alpha ${RUN}`,
      studyDate: "2026-09-24",
      worklistStudyDate: "20260924",
      studyAccession: `ACC-b-${RUN}`,
      worklistAccession: shared,
    });
    made.push(a, b);

    const first = await autoLinkBilledStudyForWorklist(a.worklistId, "vitest:preview", { preview: true });
    const second = await autoLinkBilledStudyForWorklist(b.worklistId, "vitest:preview", { preview: true });

    expect(first.linked).toBe(true);
    expect(first.studyId).toBe(a.studyId);
    // Both preview "yes" — but only one study exists for this accession, so a
    // real run could not satisfy both.
    expect(second.linked).toBe(true);
    expect(second.studyId).toBe(a.studyId);

    const afterA = await readBack(a);
    expect(afterA.w.studyId).toBeNull();
    expect(afterA.auditCount).toBe(0);
  });

  it("lane 3 (name±referral) previews without writing", async () => {
    // The lane that actually matters for the clinic's backlog: these rows have
    // no accession, so lanes 1 and 2 cannot fire and every one of the 3,922
    // would-be links is decided here. A `preview` flag threaded only to the
    // accession call site would pass every other test in this file and then
    // write to live billing rows in production.
    const f = await fixture({
      tag: "l3",
      linkBy: "name",
      patientFirst: "Referral",
      patientLast: `Lane ${RUN}`,
      studyDate: "2026-09-25",
      worklistStudyDate: "20260925",
    });
    made.push(f);

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:preview", {
      preview: true,
    });
    expect(result.linked).toBe(true);
    expect(result.method).toBe("name-referral");
    expect(result.studyId).toBe(f.studyId);
    expect(result.preview).toBe(true);
    // A name match is never proof, so this lane caps GREEN down to YELLOW and
    // leaves Match Center approval as the gate. Asserted as behaviour rather
    // than as the wording of a reason string, which any reword would break.
    expect(result.matchScore).toBe("YELLOW");

    const after = await readBack(f);
    expect(after.w.studyId).toBeNull();
    expect(after.w.patientId).toBeNull();
    expect(after.s.status).toBe("scheduled");
    expect(after.s.acquiredAt).toBeNull();
    expect(after.auditCount).toBe(0);
  });

  it("lane 2 (patient-scoped score) previews without writing", async () => {
    const f = await fixture({
      tag: "l2",
      linkBy: "name",
      patientFirst: "Patient",
      patientLast: `Scoped ${RUN}`,
      studyDate: "2026-09-26",
      worklistStudyDate: "20260926",
    });
    made.push(f);
    // Resolving the patient is what routes a row into lane 2 rather than 3.
    await db
      .update(radiologyWorklistTable)
      .set({ patientId: f.patientId, patientMatchStatus: "MATCHED" })
      .where(eq(radiologyWorklistTable.id, f.worklistId));

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:preview", {
      preview: true,
    });
    expect(result.linked).toBe(true);
    expect(result.method).toBe("patient-scoped-score");
    expect(result.studyId).toBe(f.studyId);

    const after = await readBack(f);
    expect(after.w.studyId).toBeNull();
    expect(after.s.status).toBe("scheduled");
    expect(after.auditCount).toBe(0);
  });
});
