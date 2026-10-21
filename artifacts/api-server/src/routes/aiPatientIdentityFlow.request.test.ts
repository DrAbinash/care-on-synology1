/**
 * CARE ERP, billing and CARE PACS are ONE system: every patient and every study the
 * AI doors are allowed to file a record for has to originate from a bill.
 *
 * WHY THIS FILE EXISTS
 * PR #1109 made the interactive AI doors confirm the STUDY they were asked about. It
 * did not make them confirm the PATIENT. `POST /drafts` stored whatever `patient_id`
 * and `accession_number` the browser sent, and `GET /drafts/:studyInstanceUID` hands
 * those rows to whoever opens the study next. A browser that named a second patient
 * while pointing at the first patient's study therefore got a draft of patient A
 * labelled as patient B, and a record that could not be checked against the bill the
 * study came from.
 *
 * WHAT THIS FILE RUNS FOR REAL
 * Every hop below is the production route, over HTTP, against PostgreSQL:
 *   Billing   POST /api/billing/save              (the desk's own Save)
 *   Study     the radiology fan-out that call queues (routes/radiology.ts)
 *   PACS      POST /api/internal/radiology/studies  (what the DICOM agent posts when
 *             the modality's study arrives, accessioned with the ERP's accession)
 *   Link      its own auto-link by accession, which stamps the UID on the study row
 *   Viewer    GET  /api/radiology/studies/:uid/ohif-launch
 *   Report    POST /api/ai-reporting/drafts then GET /api/ai-reporting/drafts/:uid
 *
 * Nothing here is a hand-made fixture: the patient, the bill, the study, the worklist
 * row and the stamped UID are written by the product's own routes, so the identity the
 * save door files is checked against rows this file did not arrange. The one thing
 * substituted is a second synthetic patient, used solely as an id a browser is not
 * entitled to name.
 *
 * WHY THIS FILE DOES NOT OPEN THE `/query` DOOR
 * `/query` refuses everything until `ai_provider_settings.__global__` says the clinic's
 * AI is enabled, and it sends to whatever endpoint the `ollama` row names. Both are
 * SINGLE rows, and `aiReporting.imageEgress.request.test.ts` already drives them — it
 * rewrites `__global__` before most of its 58 cases and deletes both rows on the way
 * out. Two suites cannot both get to say what the clinic's settings are. Measured, not
 * theorised: the nine AI suites without this file pass 173 tests; add this file with
 * its own settings write and `imageEgress` fails two, because this file's write landed
 * between that suite's write and its request. The same collision run the other way is
 * what this file hit first — the other suite's privacy prefix in place of the patient's
 * age.
 *
 * So the pixel half of the rule — which study's frames a bound request may fetch, and
 * that a refusal fetches none — stays pinned there, TEST 14 to 14h over a real
 * DICOMweb, and the `/query` identity half is proven by the two suites that do not touch
 * those rows: `aiReporting.query.test.ts` runs the real handler and asserts the audit
 * row's patient and accession and the demographics actually in the prompt, and
 * `interactiveStudyBinding.test.ts` pins the rule itself. What is pinned HERE is the
 * chain those rows come from, and the door that writes the record a report is later
 * built from.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportingDraftsTable,
  patientsTable,
  portalSessionsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";
import { seedBillingFixture, type BillingFixture } from "../testSupport/billingFixtures";

const maybe = hasDatabaseUrl() ? describe : describe.skip;

const AI_ANSWER =
  "FINDINGS: The study is technically adequate. No acute intracranial process.\n"
  + "IMPRESSION: No acute intracranial abnormality.";

/**
 * Wait for a row the product writes asynchronously.
 *
 * The billing fan-out is queued fire-and-forget (`enqueueBillingFanout`), so the
 * study appears some time after the 201. A fixed sleep would pass on an idle machine
 * and fail on a loaded one; this reads until the row is there and says which hop it
 * gave up on if it never arrives.
 */
async function poll<T>(read: () => Promise<T | null>, what: string): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const found = await read();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

maybe("Billing → Worklist → PACS/OHIF → Report: one patient, one study", () => {
  const marker = `idflow-${randomUUID().slice(0, 8)}`;
  /** Digits and dots only: the AI doors validate a DICOM UID, and a lettered marker
   *  is rejected by zod before any handler runs, which would test the regex instead. */
  const DICOM_UID = `1.2.840.999.${(Date.now() % 100000).toString().padStart(5, "0")}`;
  const OTHER_STUDY_UID = `1.2.840.999.${((Date.now() + 1) % 100000).toString().padStart(5, "0")}`;

  let app: Awaited<ReturnType<typeof import("../testSupport/apiTestApp").createTestApp>>;
  let fx: BillingFixture;

  let radiologistToken = "";
  let uhid = "";
  let otherPatientId = 0;
  let studyId = 0;
  let accession = "";
  let worklistId = 0;

  const auth = () => ({ Authorization: `Bearer ${radiologistToken}` });

  const postDrafts = (body: Record<string, unknown>) =>
    request(app).post("/api/ai-reporting/drafts").set(auth()).send({
      studyInstanceUID: DICOM_UID,
      provider: "ollama",
      draftText: "Saved from the viewer drawer.",
      ...body,
    });

  async function draftCount(uid: string): Promise<number> {
    const rows = await db
      .select({ id: aiReportingDraftsTable.id })
      .from(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.studyInstanceUID, uid));
    return rows.length;
  }

  async function draftRows(uid: string) {
    return db
      .select({
        id: aiReportingDraftsTable.id,
        patientId: aiReportingDraftsTable.patientId,
        accessionNumber: aiReportingDraftsTable.accessionNumber,
        studyInstanceUID: aiReportingDraftsTable.studyInstanceUID,
        draftText: aiReportingDraftsTable.draftText,
      })
      .from(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.studyInstanceUID, uid))
      .orderBy(desc(aiReportingDraftsTable.id));
  }

  beforeAll(async () => {
    const { createTestApp } = await import("../testSupport/apiTestApp");
    app = await createTestApp();
    fx = await seedBillingFixture();

    // A catalogue test in an imaging department: `generateStudiesForOrder` skips any
    // test whose department is not one of X-Ray/USG/MRI/CT/Mammography/DEXA, so
    // without this the bill produces no study at all and the flow never starts.
    await db
      .update(testsTable)
      .set({ department: "MRI" })
      .where(eq(testsTable.id, fx.testId));

    // The patient a browser is not entitled to name: same clinic, different person.
    const [decoy] = await db
      .insert(patientsTable)
      .values({
        patientId: `VT-DECOY-${marker}`,
        firstName: "Decoy",
        lastName: marker,
        dateOfBirth: "1955-05-05",
        gender: "female",
        phone: "9000000002",
        ageValue: 71,
      })
      .returning({ id: patientsTable.id });
    otherPatientId = decoy.id;

    const [staff] = await db
      .insert(usersTable)
      .values({
        name: `Rad. Flow ${marker}`,
        email: `rad-${marker}@vitest.invalid`,
        username: `rad-${marker}`,
        role: "doctor",
        // What a reporting clinician's session carries: the AI-use permission, plus
        // the `/radiology` namespace the worklist and viewer routers gate on.
        permissions: JSON.stringify(["ai_reporting.use", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning({ id: usersTable.id, name: usersTable.name });
    radiologistToken = `vitest-idflow-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token: radiologistToken,
      scope: "staff",
      subjectId: staff.id,
      subjectName: staff.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // ── Billing: the desk's own Save & Print call ────────────────────────────
    const bill = await request(app)
      .post("/api/billing/save")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        patientId: fx.patientId,
        tests: [{ testId: fx.testId, price: fx.testPrice }],
        clientRef: randomUUID(),
        payments: [{ amount: fx.testPrice, method: "cash" }],
      });
    expect(bill.status).toBe(201);

    // ── Study: the radiology fan-out that Save queues ────────────────────────
    const study = await poll(
      async () => {
        const [row] = await db
          .select({ id: radiologyStudiesTable.id, accessionNumber: radiologyStudiesTable.accessionNumber })
          .from(radiologyStudiesTable)
          .where(eq(radiologyStudiesTable.patientId, fx.patientId))
          .limit(1);
        return row ?? null;
      },
      "the radiology study the billing fan-out should have created",
    );
    studyId = study.id;
    accession = study.accessionNumber;

    // ── PACS: the DICOM agent's arrival, carrying the ERP accession ───────────
    const [patientRow] = await db
      .select({ patientId: patientsTable.patientId })
      .from(patientsTable)
      .where(eq(patientsTable.id, fx.patientId))
      .limit(1);
    uhid = String(patientRow?.patientId ?? "");

    // The DICOM agent's own arrival call. `/api/internal/*` is guarded by
    // requireStaffOrInternalAuth, so this carries a staff bearer exactly as the
    // clinic's agent carries its internal key — the handler under test is the same.
    const intake = await request(app)
      .post("/api/internal/radiology/studies")
      .set(auth())
      .send({
        patientName: "SYNTHETIC^PATIENT",
        patientId: uhid,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: "20261019",
        accessionNumber: accession,
        studyInstanceUID: DICOM_UID,
      });
    // 201 for a worklist row this arrival created, 200 for one it updated.
    expect([200, 201]).toContain(intake.status);

    const linked = await poll(
      async () => {
        const [row] = await db
          .select({ id: radiologyWorklistTable.id, patientId: radiologyWorklistTable.patientId })
          .from(radiologyWorklistTable)
          .where(eq(radiologyWorklistTable.studyInstanceUID, DICOM_UID))
          .limit(1);
        return row?.patientId != null ? row : null;
      },
      "the worklist row auto-linked to the billed study",
    );
    worklistId = linked.id;
  }, 120_000);

  afterAll(async () => {
    // Marker-scoped teardown, children first.
    const uids = [DICOM_UID, OTHER_STUDY_UID];
    const drafts = await db
      .select({ id: aiReportingDraftsTable.id })
      .from(aiReportingDraftsTable)
      .where(inArray(aiReportingDraftsTable.studyInstanceUID, uids));
    if (drafts.length) {
      await db
        .delete(aiReportingDraftsTable)
        .where(inArray(aiReportingDraftsTable.id, drafts.map((d) => d.id)));
    }
    await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, otherPatientId)).catch(() => {});
    await db
      .delete(portalSessionsTable)
      .where(eq(portalSessionsTable.token, radiologistToken))
      .catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.username, `rad-${marker}`)).catch(() => {});
    await fx?.cleanup();
  }, 60_000);

  it("the chain joins the billed patient to the study and the DICOM UID", () => {
    // Not a fixture: rows the product wrote through its own routes. Everything the
    // AI doors must later be checked against is asserted to exist here first, so a
    // door cannot pass by binding to a row this file made up.
    expect(accession).toBeTruthy();
    expect(uhid).toBeTruthy();
    expect(studyId).toBeGreaterThan(0);
    expect(worklistId).toBeGreaterThan(0);
  });

  it("the viewer launch hands the browser the ERP's own identity", async () => {
    // This response is where a screen gets the accession and UID it later sends back to
    // the AI doors, so it is where a wrong identity would have started.
    const res = await request(app)
      .get(`/api/radiology/studies/${DICOM_UID}/ohif-launch`)
      .set(auth())
      .query({ worklistId });
    expect(res.status).toBe(200);
    expect(res.body.accessionNumber).toBe(accession);
    expect(res.body.studyInstanceUID).toBe(DICOM_UID);
  });

  it("saves the draft under the ERP identity, never the browser's labels", async () => {
    // The live viewer drawer's own payload: it may repeat the accession it was handed
    // — wrongly, as this case does on purpose — and never supplies a patient. Whose
    // patient and which accession the saved record carries is the clinic's answer.
    const res = await postDrafts({
      accessionNumber: "WRONG-ACCESSION-FROM-THE-BROWSER",
      aiResponse: AI_ANSWER,
    });
    expect(res.status).toBe(200);

    const rows = await draftRows(DICOM_UID);
    expect(rows).toHaveLength(1);
    expect(rows[0].accessionNumber).toBe(accession);
    expect(rows[0].patientId).toBe(fx.patientId);

    // What the next person to open the study is handed back. A draft that stored the
    // browser's labels would be re-displayed here as that other patient's report.
    const reopened = await request(app)
      .get(`/api/ai-reporting/drafts/${DICOM_UID}`)
      .set(auth());
    expect(reopened.status).toBe(200);
    expect(reopened.body[0].accessionNumber).toBe(accession);
    expect(reopened.body[0].patientId).toBe(fx.patientId);

    await db.delete(aiReportingDraftsTable).where(eq(aiReportingDraftsTable.id, rows[0].id));
  });

  it("refuses to save a draft for another patient's study", async () => {
    const before = await draftCount(DICOM_UID);
    const res = await postDrafts({ patientId: otherPatientId });
    expect(res.status).toBe(409);
    expect(String(res.body.code)).toBe("PATIENT_ID_MISMATCH");
    expect(await draftCount(DICOM_UID)).toBe(before);

    // The refusal names both ids, so the clinician can see which one the clinic
    // disagrees with rather than being told something failed.
    expect(String(res.body.error)).toContain(String(otherPatientId));
    expect(String(res.body.error)).toContain(String(fx.patientId));
  });

  it("refuses to save a draft against a study the clinic does not have", async () => {
    // The Orthanc-only case the owner ruled out: a well-formed DICOM UID with no
    // ERP study and no worklist row behind it.
    const before = await draftCount(OTHER_STUDY_UID);
    const res = await postDrafts({ studyInstanceUID: OTHER_STUDY_UID });
    expect(res.status).toBe(400);
    expect(String(res.body.code)).toBe("STUDY_NOT_IN_CLINIC");
    expect(await draftCount(OTHER_STUDY_UID)).toBe(before);
  });
});
