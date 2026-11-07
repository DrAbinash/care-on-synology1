/**
 * X-ray films that arrive with no accession must still reach their bill, and the
 * referring doctor the matcher compares must come from the doctor master.
 *
 * WHY THIS FILE EXISTS
 * Measured on production for the 30 days to 7 Nov 2026: 172 X-ray rows reached
 * intake unbilled-linked — 142 labelled DX from the console's own auto-send and
 * 30 print forwards labelled OT — and every one of them had `accession_number`
 * blank AND `study_id` NULL AND `patient_id` NULL. The CS-7 refuses C-FIND, so
 * there is no accession for it to echo back and the patient-scoped lane cannot
 * see a row with no patient. Intake ran the bill matcher for ultrasound only
 * (`isUltrasoundModality`), so none of these rows was ever even attempted: the
 * Match Center showed a film with no bill and no explanation.
 *
 * The second half is the referrer. Rule 3b and the doctor-conflict veto both
 * read `radiology_studies.referring_doctor`, which the same census shows is
 * filled on 2 of 544 billed X-rays (the bill desk's optional DICOM prompts go
 * empty). The clinic's referral record is `orders.doctor_id` → the Settings →
 * Doctors master, which resolves 498 of those 544. Reading the column alone made
 * the rule inert; reading the master alone would overrule the desk when it did
 * type something. Both tests below therefore separate the two legs by giving the
 * two same-name bills different doctors, on the master and on the row.
 *
 * Every case is behavioural: it posts real DICOM intake or calls the real
 * linker and reads back the row and the audit trail. A source-text grep would
 * stay green with the gate closed, with the joins dropped, or with the COALESCE
 * reversed.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  doctorsTable,
  ordersTable,
  patientsTable,
  portalSessionsTable,
  radiologyAuditLogTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, inArray, like } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { autoLinkBilledStudyForWorklist } from "./worklistBillingLink";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

/** Fixed window nobody else's fixture sits in; ±1 day is what the lane reads. */
const WINDOW_ISO = "2026-03-15";
const WINDOW_DICOM = "20260315";

/**
 * Three invented referring doctors, each with its OWN uniqueness token. They must
 * share no token and no substring: the matcher scores doctor names with the same
 * fuzzy cleaner it uses for patients, so two doctors that both end in the run
 * marker read as 64% the same person — which is above the conflict threshold and
 * below the match bonus, so neither the +5 nor the veto fires and every case
 * collapses into an ambiguous tie. Measured, twice.
 */
const DOC_MASTER_A = `Nirmal Ghosh ${randomUUID().slice(0, 6)}`;
const DOC_MASTER_B = `Zoraimthana Lunglen ${randomUUID().slice(0, 6)}`;
const DOC_TYPED_ON_B = `Bankyawati Saren ${randomUUID().slice(0, 6)}`;

/** One shared token set so rule 5 fires identically on every candidate. */
const EXAM_DESC = `Chest PA ${RUN}`;
const XRAY_TEST_NAME = `X-RAY ${EXAM_DESC}`;
const MR_TEST_NAME = `MRI BRAIN ${RUN}`;
const MR_DESC = `Brain ${RUN}`;

const XRAY_TEST_CODE = `XPL-${RUN}-X`;
const MR_TEST_CODE = `XPL-${RUN}-M`;

/**
 * One DISTINCT invented given name per fixture. Both patients inside a fixture
 * share it (that is the homonym being tested) while fixtures stay far apart:
 * the matcher scores names fuzzily, so two fixtures that differ only in a
 * 2-character suffix come out 92% similar and pile up into one ambiguous
 * candidate pool — measured, and it made every case in this file fail for the
 * wrong reason.
 */
const PEOPLE: Record<string, string> = {
  r1: "Sunita",
  r2: "Anupa",
  r3: "Kalpana",
  g1: "Meera",
  g2: "Radha",
  g3: "Sabita",
};

const cleanupWorklistIds: number[] = [];
const doctorIds: number[] = [];
const staffSessionTokens: string[] = [];
let staffUserId = 0;

type BillFixture = {
  tag: string;
  patientName: string;
  patientIdA: number;
  patientIdB: number;
  studyIdA: number;
  studyIdB: number;
  accessionA: string;
  accessionB: string;
};

/**
 * Two DIFFERENT patients with the SAME display name, the SAME age and the SAME
 * sex, each with one billed study on the same date and the same test name. Every
 * scoring rule except the referring doctor is deliberately tied, so a link here
 * can only come from the referrer — and a refusal can only come from the tie.
 * This is the homonym case the referral key exists for: 3 of the 172 real X-ray
 * rows land in a same-name group that name alone cannot separate.
 *
 * `shape` picks which half of the COALESCE is being exercised:
 *  - "master": both study rows leave referring_doctor NULL, and the two orders
 *    name different doctors. Only orders.doctor_id → doctors.name can separate
 *    them (measured: that column is filled on 2 of 544 real X-ray bills, the
 *    master resolves 498).
 *  - "typed": both orders name the SAME doctor and patient B's study row carries
 *    a typed referrer. Only "typed value wins over the master" separates them.
 */
async function makeHomonymBills(
  tag: string,
  modality: "CR" | "MR",
  shape: "master" | "typed" = "master",
): Promise<BillFixture> {
  const wantedCode = modality === "CR" ? XRAY_TEST_CODE : MR_TEST_CODE;
  const [[testRow], [doctorA], [doctorB], [doctorC]] = await Promise.all([
    db.select({ id: testsTable.id }).from(testsTable).where(eq(testsTable.code, wantedCode)).limit(1),
    db.select({ id: doctorsTable.id }).from(doctorsTable).where(eq(doctorsTable.name, DOC_MASTER_A)).limit(1),
    db.select({ id: doctorsTable.id }).from(doctorsTable).where(eq(doctorsTable.name, DOC_MASTER_B)).limit(1),
    db.select({ id: doctorsTable.id }).from(doctorsTable).where(eq(doctorsTable.name, DOC_TYPED_ON_B)).limit(1),
  ]);
  if (!testRow || !doctorA || !doctorB || !doctorC) throw new Error("fixture prerequisites missing");
  const who = PEOPLE[tag];
  if (!who) throw new Error(`no fixture person for tag ${tag}`);
  const patientName = `${who} Barman ${RUN}${tag}`;

  const patients = await db
    .insert(patientsTable)
    .values([
      {
        patientId: `XPL-${RUN}-P${tag}A`,
        firstName: who,
        lastName: `Barman ${RUN}${tag}`,
        dateOfBirth: "1988-06-11",
        gender: "female",
        ageValue: 35,
        ageUnit: "years",
        phone: "9000000001",
      },
      {
        patientId: `XPL-${RUN}-P${tag}B`,
        firstName: who,
        lastName: `Barman ${RUN}${tag}`,
        dateOfBirth: "1989-02-03",
        gender: "female",
        ageValue: 36,
        ageUnit: "years",
        phone: "9000000002",
      },
    ])
    .returning();

  const orders = await db
    .insert(ordersTable)
    .values([
      { orderNumber: `XPL-${RUN}-O${tag}A`, patientId: patients[0]!.id, doctorId: doctorA.id, status: "completed" },
      // "master": B is ordered under a different doctor.
      // "typed": B is ordered under the SAME doctor as A, and only the value the
      // desk typed on the study row distinguishes them.
      {
        orderNumber: `XPL-${RUN}-O${tag}B`,
        patientId: patients[1]!.id,
        doctorId: shape === "master" ? doctorB.id : doctorA.id,
        status: "completed",
      },
    ])
    .returning();

  const studies = await db
    .insert(radiologyStudiesTable)
    .values([
      {
        accessionNumber: `XPL-${RUN}-A${tag}A`,
        orderId: orders[0]!.id,
        patientId: patients[0]!.id,
        testId: testRow.id,
        modality,
        department: modality === "CR" ? "X-RAY" : "MRI",
        studyDate: WINDOW_ISO,
        studyDescription: modality === "CR" ? EXAM_DESC : MR_DESC,
        referringDoctor: null,
        status: "scheduled",
      },
      {
        accessionNumber: `XPL-${RUN}-A${tag}B`,
        orderId: orders[1]!.id,
        patientId: patients[1]!.id,
        testId: testRow.id,
        modality,
        department: modality === "CR" ? "X-RAY" : "MRI",
        studyDate: WINDOW_ISO,
        studyDescription: modality === "CR" ? EXAM_DESC : MR_DESC,
        referringDoctor: shape === "typed" ? DOC_TYPED_ON_B : null,
        status: "scheduled",
      },
    ])
    .returning();

  return {
    tag,
    patientName,
    patientIdA: patients[0]!.id,
    patientIdB: patients[1]!.id,
    studyIdA: studies[0]!.id,
    studyIdB: studies[1]!.id,
    accessionA: studies[0]!.accessionNumber,
    accessionB: studies[1]!.accessionNumber,
  };
}

/** A worklist row as the console/print-SCP leaves it: no accession, no patient. */
async function makeArrival(
  fixture: BillFixture,
  opts: { modality?: string; referringDoctor?: string | null; description?: string | null },
): Promise<number> {
  const modality = opts.modality ?? "DX";
  const [row] = await db
    .insert(radiologyWorklistTable)
    .values({
      patientName: fixture.patientName,
      age: "35Y",
      sex: "F",
      modality,
      studyDescription: opts.description ?? (modality === "MR" ? MR_DESC : EXAM_DESC),
      studyDate: WINDOW_DICOM,
      accessionNumber: "",
      referringDoctor: opts.referringDoctor ?? null,
      studyInstanceUID: `1.2.826.xpl.${RUN}.${modality}.${fixture.tag}`,
      status: "STUDY_RECEIVED",
    })
    .returning();
  cleanupWorklistIds.push(row.id);
  return row.id;
}

async function auditActions(worklistId: number): Promise<Array<{ action: string; details: string | null }>> {
  return db
    .select({ action: radiologyAuditLogTable.action, details: radiologyAuditLogTable.details })
    .from(radiologyAuditLogTable)
    .where(eq(radiologyAuditLogTable.worklistId, worklistId));
}

async function readWorklist(worklistId: number) {
  const [row] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);
  return row;
}

describe.skipIf(!dbAvailable)("X-ray print-forward bill linking", () => {
  let app: Express;
  let staffToken = "";

  beforeAll(async () => {
    await db.insert(testsTable).values({
      code: XRAY_TEST_CODE,
      name: XRAY_TEST_NAME,
      category: "Radiology",
      price: "700",
      duration: "15",
      department: "X-Ray",
    });
    await db.insert(testsTable).values({
      code: MR_TEST_CODE,
      name: MR_TEST_NAME,
      category: "Radiology",
      price: "4000",
      duration: "40",
      department: "MRI",
    });
    const doctors = await db
      .insert(doctorsTable)
      .values([
        { name: DOC_MASTER_A, specialization: "Orthopaedics" },
        { name: DOC_MASTER_B, specialization: "General Surgery" },
        { name: DOC_TYPED_ON_B, specialization: "Medicine" },
      ])
      .returning();
    doctorIds.push(...doctors.map((d) => d.id));

    app = await createTestApp();
    staffToken = await createStaffSession(RUN);
  }, 120_000);

  afterAll(async () => {
    await deleteByMarker(RUN);
  }, 120_000);

  // ── the referrer key ───────────────────────────────────────────────────────
  it("links the one same-name bill whose referring doctor matches, read from orders.doctor_id", async () => {
    const fixture = await makeHomonymBills("r1", "CR");
    const worklistId = await makeArrival(fixture, { referringDoctor: DOC_MASTER_A });

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:referrer");

    // The winning study's own referring_doctor column is NULL: the only place
    // DOC_MASTER_A exists is orders.doctor_id → doctors.name. Reverting
    // studySelect to the column alone leaves both candidates eligible and tied,
    // so this fails on the link, not on bookkeeping.
    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.method).toBe("name-referral");
    expect(result.matchScore).toBe("YELLOW");
    expect(result.studyId).toBe(fixture.studyIdA);

    const row = await readWorklist(worklistId);
    expect(row.studyId).toBe(fixture.studyIdA);
    expect(row.patientId).toBe(fixture.patientIdA);
  });

  it("keeps a referring doctor the bill desk typed ahead of the doctor master", async () => {
    const fixture = await makeHomonymBills("r2", "CR", "typed");
    // Both bills were ordered under DOC_MASTER_A here; only patient B's study
    // row carries the typed DOC_TYPED_ON_B. Reading the master alone would
    // conflict on both candidates and refuse; reading the column alone would
    // leave A unopposed and win by too little to link. Only the typed value
    // winning over the master, with the master behind it, picks study B.
    const worklistId = await makeArrival(fixture, { referringDoctor: DOC_TYPED_ON_B });

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:referrer");

    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.studyId).toBe(fixture.studyIdB);
  });

  it("refuses to choose between two same-name bills when nothing separates them", async () => {
    const fixture = await makeHomonymBills("r3", "CR");
    // What the CS-7 actually sends today: no accession, no referrer.
    const worklistId = await makeArrival(fixture, { referringDoctor: null });

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:referrer");

    expect(result.linked).toBe(false);
    expect(result.reason).toContain("ambiguous");
    const row = await readWorklist(worklistId);
    expect(row.studyId).toBeNull();
    const actions = await auditActions(worklistId);
    expect(actions.map((a) => a.action)).toContain("AUTO_LINK_REFUSED");
  });

  // ── the intake gate ────────────────────────────────────────────────────────
  it("intake attempts the bill link for an X-ray film that arrives with no accession", async () => {
    const fixture = await makeHomonymBills("g1", "CR");
    // Drop patient B's bill from the pool so the arrival has one candidate:
    // a real link at intake is the outcome the desk needs, not just an attempt.
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, fixture.studyIdB));

    const res = await request(app)
      .post("/api/internal/radiology/studies")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        patientName: fixture.patientName,
        modality: "DX",
        studyDate: WINDOW_DICOM,
        studyDescription: EXAM_DESC,
        studyInstanceUID: `1.2.826.xpl.${RUN}.intake.g1`,
        patientId: `XPL-${RUN}-NOPATIENT`,
      });
    expect([200, 201]).toContain(res.status);
    const worklistId = Number(res.body?.worklistId);
    expect(Number.isInteger(worklistId) && worklistId > 0).toBe(true);
    cleanupWorklistIds.push(worklistId);

    const row = await readWorklist(worklistId);
    expect(row.accessionNumber).toBe("");
    // The modality's own unusable PatientID stays on the row as recorded, and
    // the patient the row ends up pointing at is the one the WINNING BILL
    // names — intake invented no identity to get there.
    expect(row.dicomPatientId).toBe(`XPL-${RUN}-NOPATIENT`);
    expect(row.patientId).toBe(fixture.patientIdA);
    expect(row.studyId, JSON.stringify(await auditActions(worklistId))).toBe(fixture.studyIdA);

    const linked = (await auditActions(worklistId)).find((a) => a.action === "AUTO_LINK_BILLED");
    expect(linked, "intake left no auto-link audit").toBeDefined();
    expect(JSON.parse(linked!.details || "{}").method).toBe("name-referral");
  });

  it("audits an X-ray refusal, and audits nothing for MR — the widening stops at X-ray", async () => {
    const xray = await makeHomonymBills("g2", "CR");
    const mr = await makeHomonymBills("g3", "MR");

    const post = async (body: Record<string, unknown>) => {
      const res = await request(app)
        .post("/api/internal/radiology/studies")
        .set("Content-Type", "application/json")
        .set("Authorization", `Bearer ${staffToken}`)
        .send(body);
      return Number(res.body?.worklistId);
    };

    const xrayWorklistId = await post({
      patientName: xray.patientName,
      modality: "DX",
      studyDate: WINDOW_DICOM,
      studyDescription: EXAM_DESC,
      studyInstanceUID: `1.2.826.xpl.${RUN}.intake.g2`,
      patientId: `XPL-${RUN}-NOPATIENT`,
    });
    cleanupWorklistIds.push(xrayWorklistId);

    const mrWorklistId = await post({
      patientName: mr.patientName,
      modality: "MR",
      studyDate: WINDOW_DICOM,
      studyDescription: MR_DESC,
      studyInstanceUID: `1.2.826.xpl.${RUN}.intake.g3`,
      patientId: `XPL-${RUN}-NOPATIENT`,
    });
    cleanupWorklistIds.push(mrWorklistId);

    // Both arrivals are equally hard: two same-name bills, no accession, no
    // referrer. The only difference is the modality, so the difference in the
    // audit trail can only be the gate.
    const xrayActions = (await auditActions(xrayWorklistId)).map((a) => a.action);
    expect(xrayActions).toContain("AUTO_LINK_REFUSED");
    expect((await readWorklist(xrayWorklistId)).studyId).toBeNull();

    const mrActions = (await auditActions(mrWorklistId)).map((a) => a.action);
    expect(mrActions).not.toContain("AUTO_LINK_REFUSED");
    expect(mrActions).not.toContain("AUTO_LINK_BILLED");
  });
});

async function createStaffSession(marker: string): Promise<string> {
  const token = `xpl-${randomUUID()}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `Xray Link ${marker}`,
      email: `${marker}@vitest.invalid`,
      username: marker,
      role: "admin",
      permissions: JSON.stringify(["/radiology"]),
      pin: "0000",
      isActive: true,
    })
    .returning();
  await db.insert(portalSessionsTable).values({
    token,
    scope: "staff",
    subjectId: user.id,
    subjectName: user.name,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  staffSessionTokens.push(token);
  staffUserId = user.id;
  return token;
}

/** Marker-scoped teardown, in FK-safe order, best-effort on a shared database. */
async function deleteByMarker(marker: string) {
  const sweep: Array<() => Promise<unknown>> = [
    () => db.delete(radiologyWorklistTable).where(like(radiologyWorklistTable.studyInstanceUID, `%${marker}%`)),
    () =>
      cleanupWorklistIds.length === 0
        ? Promise.resolve()
        : db.delete(radiologyAuditLogTable).where(inArray(radiologyAuditLogTable.worklistId, cleanupWorklistIds)),
    () => db.delete(radiologyStudiesTable).where(like(radiologyStudiesTable.accessionNumber, `XPL-${marker}%`)),
    () => db.delete(ordersTable).where(like(ordersTable.orderNumber, `XPL-${marker}%`)),
    () => db.delete(patientsTable).where(like(patientsTable.patientId, `XPL-${marker}%`)),
    () => db.delete(testsTable).where(like(testsTable.code, `XPL-${marker}%`)),
    () =>
      doctorIds.length === 0
        ? Promise.resolve()
        : db.delete(doctorsTable).where(inArray(doctorsTable.id, doctorIds)),
  ];
  for (const drop of sweep) {
    try {
      await drop();
    } catch {
      // A shared database may already have cascaded the row; the next test run
      // uses a fresh marker either way.
    }
  }
  for (const token of staffSessionTokens) {
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
  }
  if (staffUserId) await db.delete(usersTable).where(eq(usersTable.id, staffUserId)).catch(() => {});
}
