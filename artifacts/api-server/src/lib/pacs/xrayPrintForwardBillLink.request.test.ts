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
 * The last five cases cover the owner's trial ruling of 7 Nov 2026: an X-ray
 * whose name, body area and referring doctor all point at one bill links with no
 * review step (GREEN, method `name-referral-xray-auto`), and each of the four
 * ways that is refused — switch off, no area, ultrasound, and the score the
 * screen actually reads — is asserted separately.
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
  pacsSettingsTable,
  patientsTable,
  portalSessionsTable,
  radiologyAuditLogTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, inArray, like, notInArray, sql } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { autoLinkBilledStudyForWorklist } from "./worklistBillingLink";
import { runMatchingEngineForWorklist } from "../../routes/internal-radiology";
import { XRAY_AUTO_GREEN_METHOD, XRAY_AUTO_GREEN_SETTING_KEY } from "./xrayAutoGreen";

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

/**
 * One doctor per single-candidate fixture below, for the same reason: a shared
 * name across two fixtures makes both candidates equally eligible and a 5-point
 * referrer gap cannot separate them, so the matcher refuses for the wrong reason.
 */
const DOC_LONE_GREEN = `Thoidingam Mitul ${randomUUID().slice(0, 6)}`;
const DOC_LONE_SWITCH = `Bijayanti Toppo ${randomUUID().slice(0, 6)}`;
const DOC_LONE_NOAREA = `Kameshwar Bagha ${randomUUID().slice(0, 6)}`;
const DOC_LONE_US = `Suranjita Beso ${randomUUID().slice(0, 6)}`;
const DOC_LONE_INTAKE = `Dhruvanand Bhoi ${randomUUID().slice(0, 6)}`;

/** One shared token set so rule 5 fires identically on every candidate. */
const EXAM_DESC = `Chest PA ${RUN}`;
const XRAY_TEST_NAME = `X-RAY ${EXAM_DESC}`;
const MR_TEST_NAME = `MRI BRAIN ${RUN}`;
const MR_DESC = `Brain ${RUN}`;
const US_TEST_NAME = `USG ABDOMEN ${RUN}`;
const US_DESC = `Abdomen ${RUN}`;
/**
 * An arriving film that names an exam the bill does not: shares no word with
 * `XRAY_TEST_NAME`, so rule 5 cannot fire and the body-area leg is genuinely
 * absent. Deliberately carries no run marker — the marker is a word the billed
 * test name also contains, and rule 5 would count it as agreement.
 */
const DESC_WITHOUT_AREA = "Shoulder Oblique";

const XRAY_TEST_CODE = `XPL-${RUN}-X`;
const MR_TEST_CODE = `XPL-${RUN}-M`;
const US_TEST_CODE = `XPL-${RUN}-U`;

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
  a1: "Hemlata",
  a2: "Jharna",
  a3: "Pratima",
  a4: "Sanjoni",
  a5: "Basanti",
  a6: "Mamta",
  a7: "Lakshmi",
  a8: "Jyoshna",
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
  fixture: Pick<BillFixture, "tag" | "patientName">,
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

/**
 * One patient, one bill, one referring doctor — the shape a real single X-ray
 * has. The homonym fixture above is for refusals; to test what happens when the
 * matcher DOES win there must be exactly one candidate, or the gap rule refuses
 * first and the promotion is never reached.
 */
async function makeLoneBill(
  tag: string,
  opts: { kind: "xray" | "us"; doctor: string },
): Promise<{ patientId: number; studyId: number; patientName: string }> {
  const isUs = opts.kind === "us";
  const [[testRow], [doctor]] = await Promise.all([
    db
      .select({ id: testsTable.id })
      .from(testsTable)
      .where(eq(testsTable.code, isUs ? US_TEST_CODE : XRAY_TEST_CODE))
      .limit(1),
    db.select({ id: doctorsTable.id }).from(doctorsTable).where(eq(doctorsTable.name, opts.doctor)).limit(1),
  ]);
  if (!testRow || !doctor) throw new Error("fixture prerequisites missing");
  const who = PEOPLE[tag];
  if (!who) throw new Error(`no fixture person for tag ${tag}`);

  const [patient] = await db
    .insert(patientsTable)
    .values({
      patientId: `XPL-${RUN}-P${tag}`,
      firstName: who,
      lastName: `Barman ${RUN}${tag}`,
      dateOfBirth: "1988-06-11",
      gender: "female",
      ageValue: 35,
      ageUnit: "years",
      phone: "9000000003",
    })
    .returning();
  const [order] = await db
    .insert(ordersTable)
    .values({ orderNumber: `XPL-${RUN}-O${tag}`, patientId: patient!.id, doctorId: doctor!.id, status: "completed" })
    .returning();
  const [study] = await db
    .insert(radiologyStudiesTable)
    .values({
      accessionNumber: `XPL-${RUN}-A${tag}`,
      orderId: order!.id,
      patientId: patient!.id,
      testId: testRow.id,
      modality: isUs ? "US" : "CR",
      department: isUs ? "USG" : "X-Ray",
      studyDate: WINDOW_ISO,
      studyDescription: isUs ? US_DESC : EXAM_DESC,
      referringDoctor: null,
      status: "scheduled",
    })
    .returning();

  return {
    patientId: patient!.id,
    studyId: study!.id,
    patientName: `${who} Barman ${RUN}${tag}`,
  };
}

/**
 * The Settings → Worklist (MWL) kill switch, written the way the settings route
 * writes it (category "mwl", upsert by key). `null` deletes the row, which is
 * the unset state the trial defaults from.
 */
async function setKillSwitch(value: string | null): Promise<void> {
  await db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.key, XRAY_AUTO_GREEN_SETTING_KEY));
  if (value === null) return;
  await db
    .insert(pacsSettingsTable)
    .values({ key: XRAY_AUTO_GREEN_SETTING_KEY, value, category: "mwl", isSecret: false });
}

/**
 * Remove every still-unlinked bill this run created, so a test that needs one
 * candidate has literally one. The homonym fixtures from the earlier cases stay
 * in the window and their names are all >0.85 similar to each other (they share
 * this run's marker), so without this a no-referrer arrival ties and refuses for
 * a fixture reason instead of the reason the case is about. Scoped to this run's
 * accession marker — nothing else on the database is touched.
 */
async function clearUnlinkedRivals(): Promise<void> {
  const linked = await db
    .select({ studyId: radiologyWorklistTable.studyId })
    .from(radiologyWorklistTable)
    .where(sql`${radiologyWorklistTable.studyId} is not null`);
  const keep = linked.map((r) => r.studyId!).filter((id) => Number.isFinite(id));
  await db
    .delete(radiologyStudiesTable)
    .where(
      and(
        like(radiologyStudiesTable.accessionNumber, `XPL-${RUN}%`),
        keep.length > 0 ? notInArray(radiologyStudiesTable.id, keep) : undefined,
      ),
    );
}

async function auditActions(worklistId: number): Promise<Array<{ action: string; details: string | null }>> {  return db
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
    await db.insert(testsTable).values({
      code: US_TEST_CODE,
      name: US_TEST_NAME,
      category: "Radiology",
      price: "1200",
      duration: "20",
      department: "USG",
    });
    const doctors = await db
      .insert(doctorsTable)
      .values([
        { name: DOC_MASTER_A, specialization: "Orthopaedics" },
        { name: DOC_MASTER_B, specialization: "General Surgery" },
        { name: DOC_TYPED_ON_B, specialization: "Medicine" },
        { name: DOC_LONE_GREEN, specialization: "Medicine" },
        { name: DOC_LONE_SWITCH, specialization: "Medicine" },
        { name: DOC_LONE_NOAREA, specialization: "Medicine" },
        { name: DOC_LONE_US, specialization: "Medicine" },
        { name: DOC_LONE_INTAKE, specialization: "Medicine" },
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
    // Name + body area + referring doctor all agree with one bill, so the X-ray
    // trial links it outright instead of parking it in the Match Center.
    expect(result.method).toBe(XRAY_AUTO_GREEN_METHOD);
    expect(result.matchScore).toBe("GREEN");
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

  // ── the X-ray auto-GREEN trial (owner ruling, 7 Nov 2026) ──────────────────
  it("links one X-ray bill without a review step when name, area and referrer all agree", async () => {
    const bill = await makeLoneBill("a1", { kind: "xray", doctor: DOC_LONE_GREEN });
    const worklistId = await makeArrival(
      { tag: "a1", patientName: bill.patientName },
      { referringDoctor: DOC_LONE_GREEN },
    );

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:auto");

    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.studyId).toBe(bill.studyId);
    expect(result.matchScore).toBe("GREEN");
    expect(result.method).toBe(XRAY_AUTO_GREEN_METHOD);
    const audit = (await auditActions(worklistId)).find((a) => a.action === "AUTO_LINK_BILLED");
    expect(JSON.parse(audit!.details || "{}")).toMatchObject({
      matchScore: "GREEN",
      method: XRAY_AUTO_GREEN_METHOD,
    });
  });

  it("goes back to YELLOW review when the settings switch is off", async () => {
    await setKillSwitch("false");
    const bill = await makeLoneBill("a2", { kind: "xray", doctor: DOC_LONE_SWITCH });
    const worklistId = await makeArrival(
      { tag: "a2", patientName: bill.patientName },
      { referringDoctor: DOC_LONE_SWITCH },
    );

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:auto");

    // Same evidence, switch off: the link still happens (that behaviour predates
    // the trial and must not change), but a person is asked to confirm it.
    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.matchScore).toBe("YELLOW");
    expect(result.method).toBe("name-referral");
  });

  it("keeps reviewing an X-ray whose film names no body area", async () => {
    const bill = await makeLoneBill("a3", { kind: "xray", doctor: DOC_LONE_NOAREA });
    const worklistId = await makeArrival(
      { tag: "a3", patientName: bill.patientName },
      { referringDoctor: DOC_LONE_NOAREA, description: DESC_WITHOUT_AREA },
    );

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:auto");

    // The OCR description is the area leg. Without it this is a name+doctor guess.
    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.matchScore).toBe("YELLOW");
    expect(result.method).toBe("name-referral");
  });

  it("leaves ultrasound exactly where it was: same evidence, still YELLOW", async () => {
    const bill = await makeLoneBill("a4", { kind: "us", doctor: DOC_LONE_US });
    const worklistId = await makeArrival(
      { tag: "a4", patientName: bill.patientName },
      { modality: "US", referringDoctor: DOC_LONE_US, description: US_DESC },
    );

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:auto");

    // Every leg agrees here too, so the only thing keeping this YELLOW is the
    // modality gate. Reopening it to ultrasound would be a second decision.
    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.matchScore).toBe("YELLOW");
    expect(result.method).toBe("name-referral");
  });

  it("does not promote the shape every real film arrives in: no referring doctor on it", async () => {
    await clearUnlinkedRivals();
    const bill = await makeLoneBill("a6", { kind: "xray", doctor: DOC_LONE_GREEN });
    // No referringDoctor: what the CS-7 sends — measured 0 of 144 DX rows.
    const worklistId = await makeArrival({ tag: "a6", patientName: bill.patientName }, {});

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:auto");

    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.matchScore).toBe("YELLOW");
    expect(result.method).toBe("name-referral");
  });

  it("promotes that same film only when the mode is deliberately widened", async () => {
    await setKillSwitch("name-area");
    await clearUnlinkedRivals();
    const bill = await makeLoneBill("a7", { kind: "xray", doctor: DOC_LONE_SWITCH });
    const worklistId = await makeArrival({ tag: "a7", patientName: bill.patientName }, {});

    const result = await autoLinkBilledStudyForWorklist(worklistId, "vitest:auto");

    expect(result.linked, JSON.stringify(result.reason)).toBe(true);
    expect(result.matchScore).toBe("GREEN");
    expect(result.method).toBe(XRAY_AUTO_GREEN_METHOD);
    await setKillSwitch(null);
  });

  it("scores the referring doctor from the doctor master when it re-scores the row", async () => {
    await clearUnlinkedRivals();
    const bill = await makeLoneBill("a8", { kind: "xray", doctor: DOC_LONE_GREEN });
    const worklistId = await makeArrival(
      { tag: "a8", patientName: bill.patientName },
      { referringDoctor: DOC_LONE_GREEN },
    );

    await autoLinkBilledStudyForWorklist(worklistId, "vitest:evidence");
    await db
      .update(radiologyWorklistTable)
      .set({ studyId: bill.studyId })
      .where(eq(radiologyWorklistTable.id, worklistId));
    await runMatchingEngineForWorklist(worklistId);

    // The re-score writes the reasons the Match Center lists for the reviewer.
    // It used to read radiology_studies.referring_doctor alone — production
    // fills that on 2 of 544 X-ray bills — so a film the linker had just matched
    // on the doctor master was shown as evidence that mentioned no doctor at all.
    const row = await readWorklist(worklistId);
    const evidence = String(row.matchReasons || "[]");
    const reasons = JSON.parse(evidence) as string[];
    expect(reasons.some((r) => r.startsWith("Referring doctor matches")), evidence).toBe(true);
  });

  it("intake persists GREEN on the row the Match Center reads", async () => {
    const bill = await makeLoneBill("a5", { kind: "xray", doctor: DOC_LONE_INTAKE });

    const res = await request(app)
      .post("/api/internal/radiology/studies")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        patientName: bill.patientName,
        modality: "DX",
        studyDate: WINDOW_DICOM,
        studyDescription: EXAM_DESC,
        referringDoctor: DOC_LONE_INTAKE,
        // What the console puts on the film, and what the rule reads: measured
        // 142 of 144 real DX rows carry a sex. Omitting it here would test the
        // wrong thing — the rule requires the leg, so the arrival must have it.
        sex: "F",
        age: "35Y",
        studyInstanceUID: `1.2.826.xpl.${RUN}.intake.a5`,
        patientId: `XPL-${RUN}-NOPATIENT`,
      });
    expect([200, 201]).toContain(res.status);
    const worklistId = Number(res.body?.worklistId);
    cleanupWorklistIds.push(worklistId);

    const row = await readWorklist(worklistId);
    expect(row.studyId, JSON.stringify(await auditActions(worklistId))).toBe(bill.studyId);
    // match_score is what needsMatchReview() reads on screen. The linker's return
    // value alone would leave the row asking a person about an accepted film.
    expect(row.matchScore).toBe("GREEN");
    expect(row.matchDecision).toBe("PENDING");

    const audit = (await auditActions(worklistId)).find((a) => a.action === "AUTO_LINK_BILLED");
    expect(JSON.parse(audit!.details || "{}").method).toBe(XRAY_AUTO_GREEN_METHOD);
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
    () => db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.key, XRAY_AUTO_GREEN_SETTING_KEY)),
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
