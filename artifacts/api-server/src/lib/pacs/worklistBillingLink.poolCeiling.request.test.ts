/**
 * The name±referral candidate pool must not silently fill up.
 *
 * WHY THIS FILE EXISTS
 * Lane 3 pulled a bounded set of billed studies from the ±1-day window
 * (`ORDER BY created_at DESC LIMIT n`) and ranked only what came back, so once
 * the window held more rows than `n`, the oldest bills — the early-morning ones,
 * since the day's later scans sort first — were never compared at all, and the
 * refusal said "no confident name±referral match". That reads as "this patient
 * was not billed" and is indistinguishable from "we stopped looking". Measured
 * against the clinic's real backlog the ceiling was in play for CT, where 420
 * rows arrived unbilled-linked in October alone.
 *
 * So the property asserted here is narrow and behavioural: a study that sits
 * behind 301 other candidates in the same window must still be found and linked.
 * A source-text grep on the limit would not catch a reordering change, a
 * windowed query that starts filtering differently, or a lane that quietly
 * drops ineligible rows before the limit is applied.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  patientsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
} from "@workspace/db/schema";
import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { NAME_REFERRAL_POOL_LIMIT, autoLinkBilledStudyForWorklist } from "./worklistBillingLink";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

/** One more candidate than the ceiling this replaced (300). */
const FILLERS = 301;

// A window nobody else's fixtures sit in, so the pool here is exactly what this
// file inserted plus whatever the database already holds (asserted below).
const STUDY_ISO = "2026-10-05";
const WORKLIST_DICOM = "20261005";
const MODALITY = "CT";

type Fixture = {
  targetPatientId: number;
  worklistId: number;
  studyIds: number[];
};

let made: Fixture[] = [];

async function fixture(): Promise<Fixture> {
  const [targetPatient] = await db
    .insert(patientsTable)
    .values({
      patientId: `PC-UHID-${RUN}`,
      firstName: "Ceiling",
      lastName: `Target ${RUN}`,
      dateOfBirth: "1985-04-02",
      gender: "female",
      phone: "9000000001",
    })
    .returning();

  // Every candidate, target included, joins `tests`, so the fillers need a real
  // test row too — one shared row is enough.
  const [test] = await db
    .insert(testsTable)
    .values({
      code: `PC-${RUN}`,
      name: `CT ABDOMEN PELVIS ${RUN}`,
      category: "Radiology",
      price: "3000",
      duration: "30",
      department: "CT",
    })
    .returning();

  const [fillerPatient] = await db
    .insert(patientsTable)
    .values({
      patientId: `PF-UHID-${RUN}`,
      firstName: "Filler",
      lastName: `Crowd ${RUN}`,
      dateOfBirth: "1970-01-01",
      gender: "male",
      phone: "9000000002",
    })
    .returning();

  // The billed study the matcher must reach: created FIRST, so `ORDER BY
  // created_at DESC` parks it behind the whole crowd of fillers.
  const [target] = await db
    .insert(radiologyStudiesTable)
    .values({
      accessionNumber: `ACC-PC-${RUN}`,
      patientId: targetPatient.id,
      testId: test.id,
      modality: MODALITY,
      department: "CT",
      studyDate: STUDY_ISO,
      studyDescription: `CT ABDOMEN PELVIS ${RUN}`,
      status: "scheduled",
      createdAt: new Date("2026-10-05T04:00:00Z"),
    })
    .returning();

  const crowd = Array.from({ length: FILLERS }, (_, i) => ({
    accessionNumber: `ACC-PF-${RUN}-${i}`,
    patientId: fillerPatient.id,
    testId: test.id,
    modality: MODALITY,
    department: "CT",
    studyDate: STUDY_ISO,
    studyDescription: `CT CHEST ${RUN}-${i}`,
    status: "scheduled" as const,
    createdAt: new Date(`2026-10-05T${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`),
  }));
  const fillerRows = await db.insert(radiologyStudiesTable).values(crowd).returning();

  // What a CT console pushes with no MWL: the patient's own name, no accession,
  // no billed study to point at.
  const [worklist] = await db
    .insert(radiologyWorklistTable)
    .values({
      patientName: `Ceiling Target ${RUN}`,
      age: "40Y",
      sex: "F",
      modality: MODALITY,
      studyDescription: `CT ABDOMEN PELVIS ${RUN}`,
      studyDate: WORKLIST_DICOM,
      accessionNumber: "",
      studyInstanceUID: `1.2.826.pc.${RUN}`,
      status: "STUDY_RECEIVED",
    })
    .returning();

  return {
    targetPatientId: targetPatient.id,
    worklistId: worklist.id,
    studyIds: [target.id, ...fillerRows.map((r) => r.id)],
  };
}

async function teardown(f: Fixture) {
  await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, f.worklistId)).catch(() => {});
  await db
    .delete(radiologyStudiesTable)
    .where(sql`${radiologyStudiesTable.id} in (${sql.join(f.studyIds.map((id) => sql`${id}`), sql`, `)})`)
    .catch(() => {});
  for (const uhid of [`PC-UHID-${RUN}`, `PF-UHID-${RUN}`]) {
    const [p] = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(eq(patientsTable.patientId, uhid))
      .limit(1);
    if (p) await db.delete(patientsTable).where(eq(patientsTable.id, p.id)).catch(() => {});
  }
  const [t] = await db
    .select({ id: testsTable.id })
    .from(testsTable)
    .where(eq(testsTable.code, `PC-${RUN}`))
    .limit(1);
  if (t) await db.delete(testsTable).where(eq(testsTable.id, t.id)).catch(() => {});
}

/** The pool lane 3 actually reads: unlinked billed studies in the ±1-day window. */
async function poolSize() {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(radiologyStudiesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .innerJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
    .where(
      and(
        gte(radiologyStudiesTable.studyDate, "2026-10-04"),
        lte(radiologyStudiesTable.studyDate, "2026-10-06"),
        sql`${radiologyStudiesTable.id} not in (
             select ${radiologyWorklistTable.studyId} from ${radiologyWorklistTable}
             where ${radiologyWorklistTable.studyId} is not null)`,
      ),
    );
  return row?.n ?? 0;
}

describe.skipIf(!dbAvailable)("worklistBillingLink name-referral candidate pool", () => {
  afterAll(async () => {
    for (const f of made) await teardown(f);
    made = [];
  });

  it("ranks a billed study that sits behind the old 300-row ceiling", async () => {
    const f = await fixture();
    made.push(f);

    // The fillers must genuinely occupy the pool: if a join or a filter dropped
    // them, the target would rank first and this test would pass while proving
    // nothing. Checked against the pool query lane 3 itself uses, not counted
    // from what this file inserted.
    const pool = await poolSize();
    expect(pool).toBeGreaterThanOrEqual(FILLERS + 1);

    const result = await autoLinkBilledStudyForWorklist(f.worklistId, "vitest:pool");

    // No `pool < NAME_REFERRAL_POOL_LIMIT` precondition assert: derived from the
    // constant under test, it fails before this line when the ceiling is lowered,
    // so the ceiling mutation would be caught by bookkeeping instead of by the
    // link. The diagnostic goes in the message instead — a database busy enough
    // to exceed the ceiling says so here, in the same line as the failure.
    expect(result.linked, `pool=${pool} ceiling=${NAME_REFERRAL_POOL_LIMIT}`).toBe(true);
    expect(result.method).toBe("name-referral");
    expect(result.studyId).toBeDefined();

    const [w] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, f.worklistId))
      .limit(1);
    expect(w.patientId).toBe(f.targetPatientId);

    // The link must be the specific study buried under the crowd, not any
    // candidate: that is what separates a widened pool from a lucky guess.
    const [linked] = await db
      .select({ accession: radiologyStudiesTable.accessionNumber })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, w.studyId!))
      .limit(1);
    expect(linked.accession).toBe(`ACC-PC-${RUN}`);
  });

  it("the buried study is the one created earliest in the window", async () => {
    // Guards the premise the test above rests on: DESC ordering really does put
    // the target last, so a future change to the sort order is visible here
    // rather than silently turning the first test into a no-op.
    const [earliest] = await db
      .select({ accession: radiologyStudiesTable.accessionNumber })
      .from(radiologyStudiesTable)
      .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
      .where(
        and(
          eq(patientsTable.firstName, "Ceiling"),
          lt(radiologyStudiesTable.createdAt, new Date("2026-10-05T05:00:00Z")),
        ),
      )
      .orderBy(asc(radiologyStudiesTable.createdAt))
      .limit(1);
    expect(earliest?.accession).toBe(`ACC-PC-${RUN}`);
  });
});
