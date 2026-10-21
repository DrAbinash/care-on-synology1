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
 * TWO STUDIES AND TWO CLINICIANS, ON PURPOSE
 * A draft is not only an identity problem, it is a shared one: `GET /drafts/:uid` returns
 * every clinician's saved drafts for the study, the drawer's `Load` button arms whichever
 * id was clicked, and `POST /drafts` with an `id` rewrote that row's text without looking
 * at whose it was or which study it belonged to. So this file registers a second study
 * through the same chain and signs in a second radiologist with the same permissions,
 * because both halves of that defect — overwrite another clinician's draft, write into
 * another study's record — are reachable by clicking, not by crafting a request.
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
  /** A second study the clinic really does have — the one a stale drawer writes into if
   *  the save door trusts the id it is handed. */
  const OTHER_STUDY_UID = `1.2.840.999.${((Date.now() + 1) % 100000).toString().padStart(5, "0")}`;
  /** A well-formed UID nothing in this clinic carries. */
  const UNKNOWN_UID = `1.2.840.999.${((Date.now() + 2) % 100000).toString().padStart(5, "0")}`;

  let app: Awaited<ReturnType<typeof import("../testSupport/apiTestApp").createTestApp>>;
  let fx: BillingFixture;

  let radiologistToken = "";
  let colleagueToken = "";
  let uhid = "";
  let otherPatientId = 0;
  let studyId = 0;
  let accession = "";
  let worklistId = 0;
  let otherStudyId = 0;
  let otherAccession = "";
  let otherWorklistId = 0;

  const auth = () => ({ Authorization: `Bearer ${radiologistToken}` });
  /** A second reporting clinician in the same clinic, with the same permissions. */
  const asColleague = () => ({ Authorization: `Bearer ${colleagueToken}` });

  const postDrafts = (body: Record<string, unknown>, headers = auth()) =>
    request(app).post("/api/ai-reporting/drafts").set(headers).send({
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
        userId: aiReportingDraftsTable.userId,
        userName: aiReportingDraftsTable.userName,
        status: aiReportingDraftsTable.status,
        draftText: aiReportingDraftsTable.draftText,
        aiResponse: aiReportingDraftsTable.aiResponse,
      })
      .from(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.studyInstanceUID, uid))
      .orderBy(desc(aiReportingDraftsTable.id));
  }

  /** Read one draft row by id, however it was written. */
  async function draftById(id: number) {
    const [row] = await db
      .select({
        id: aiReportingDraftsTable.id,
        studyInstanceUID: aiReportingDraftsTable.studyInstanceUID,
        userId: aiReportingDraftsTable.userId,
        userName: aiReportingDraftsTable.userName,
        status: aiReportingDraftsTable.status,
        draftText: aiReportingDraftsTable.draftText,
      })
      .from(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Bill an examination and register its arrival, exactly as the desk and the DICOM
   * agent do, and return the rows the product wrote. Two studies are needed because the
   * overwrite this file is about is not a cross-patient problem first — it is a draft id
   * from one study being written while the screen is on another, which is how a
   * cross-patient write actually happens in practice.
   */
  async function billAndRegister(studyUid: string, excludeIds: number[]) {
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

    const study = await poll(
      async () => {
        const rows = await db
          .select({ id: radiologyStudiesTable.id, accessionNumber: radiologyStudiesTable.accessionNumber })
          .from(radiologyStudiesTable)
          .where(eq(radiologyStudiesTable.patientId, fx.patientId));
        return rows.find((r) => !excludeIds.includes(r.id)) ?? null;
      },
      `the radiology study the billing fan-out should have created for ${studyUid}`,
    );

    const intake = await request(app)
      .post("/api/internal/radiology/studies")
      .set(auth())
      .send({
        patientName: "SYNTHETIC^PATIENT",
        patientId: uhid,
        modality: "MR",
        studyDescription: studyUid === DICOM_UID ? "MRI Brain" : "MRI Cervical Spine",
        studyDate: "20261019",
        accessionNumber: study.accessionNumber,
        studyInstanceUID: studyUid,
      });
    // 201 for a worklist row this arrival created, 200 for one it updated.
    expect([200, 201]).toContain(intake.status);

    const linked = await poll(
      async () => {
        const [row] = await db
          .select({ id: radiologyWorklistTable.id, patientId: radiologyWorklistTable.patientId })
          .from(radiologyWorklistTable)
          .where(eq(radiologyWorklistTable.studyInstanceUID, studyUid))
          .limit(1);
        return row?.patientId != null ? row : null;
      },
      `the worklist row auto-linked to the billed study ${studyUid}`,
    );

    return { studyId: study.id, accession: study.accessionNumber, worklistId: linked.id };
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

    const [colleague] = await db
      .insert(usersTable)
      .values({
        name: `Rad. Colleague ${marker}`,
        email: `rad2-${marker}@vitest.invalid`,
        username: `rad2-${marker}`,
        role: "doctor",
        permissions: JSON.stringify(["ai_reporting.use", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    colleagueToken = `vitest-idflow2-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token: colleagueToken,
      scope: "staff",
      subjectId: colleague.id,
      subjectName: `Rad. Colleague ${marker}`,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // The ERP UHID the DICOM agent reports, which is how its arrival finds the bill.
    const [patientRow] = await db
      .select({ patientId: patientsTable.patientId })
      .from(patientsTable)
      .where(eq(patientsTable.id, fx.patientId))
      .limit(1);
    uhid = String(patientRow?.patientId ?? "");

    // ── Billing → fan-out study → PACS arrival → auto-link, twice ─────────────
    const first = await billAndRegister(DICOM_UID, []);
    studyId = first.studyId;
    accession = first.accession;
    worklistId = first.worklistId;

    const second = await billAndRegister(OTHER_STUDY_UID, [first.studyId]);
    otherStudyId = second.studyId;
    otherAccession = second.accession;
    otherWorklistId = second.worklistId;
  }, 180_000);

  afterAll(async () => {
    // Marker-scoped teardown, children first.
    const uids = [DICOM_UID, OTHER_STUDY_UID, UNKNOWN_UID];
    const drafts = await db
      .select({ id: aiReportingDraftsTable.id })
      .from(aiReportingDraftsTable)
      .where(inArray(aiReportingDraftsTable.studyInstanceUID, uids));
    if (drafts.length) {
      await db
        .delete(aiReportingDraftsTable)
        .where(inArray(aiReportingDraftsTable.id, drafts.map((d) => d.id)));
    }
    for (const id of [worklistId, otherWorklistId]) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    for (const id of [studyId, otherStudyId]) {
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    }
    await db.delete(patientsTable).where(eq(patientsTable.id, otherPatientId)).catch(() => {});
    for (const token of [radiologistToken, colleagueToken]) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    }
    for (const name of [`rad-${marker}`, `rad2-${marker}`]) {
      await db.delete(usersTable).where(eq(usersTable.username, name)).catch(() => {});
    }
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
    const before = await draftCount(UNKNOWN_UID);
    const res = await postDrafts({ studyInstanceUID: UNKNOWN_UID });
    expect(res.status).toBe(400);
    expect(String(res.body.code)).toBe("STUDY_NOT_IN_CLINIC");
    expect(await draftCount(UNKNOWN_UID)).toBe(before);
  });

  it("the clinician who saved a draft re-saves it and the row is updated in place", async () => {
    // The legitimate path, which the ownership rule must not break: the drawer keeps the
    // id its save returned (`DicomViewer.tsx` `savedDraftId`) and posts it back on the
    // next Save. Same person, same study — the text changes and nothing else moves.
    const created = await postDrafts({ aiResponse: AI_ANSWER, draftText: "First version." });
    expect(created.status).toBe(200);
    const id = Number(created.body.id);
    expect(id).toBeGreaterThan(0);

    const again = await postDrafts({ id, draftText: "Second version, same clinician." });
    expect(again.status, `body: ${again.text}`).toBe(200);
    expect(Number(again.body.id)).toBe(id);

    const row = await draftById(id);
    expect(row?.draftText).toBe("Second version, same clinician.");
    // Updating must not lose who it belongs to or which study it belongs to.
    expect(row?.studyInstanceUID).toBe(DICOM_UID);
    expect(row?.userId).toBeGreaterThan(0);

    await db.delete(aiReportingDraftsTable).where(eq(aiReportingDraftsTable.id, id));
  });

  it("refuses a colleague's save that would overwrite another radiologist's draft", async () => {
    const created = await postDrafts({ draftText: "Written by the first radiologist." });
    const id = Number(created.body.id);
    const mine = await draftById(id);

    // The viewer's Saved Drafts list shows every clinician's draft for the study and
    // `Load` arms whatever id was clicked, so this is the second clinician pressing Save
    // after loading the first one's text — not a crafted request.
    const before = await draftCount(DICOM_UID);
    const res = await postDrafts({ id, draftText: "Overwritten by a colleague." }, asColleague());
    expect(res.status, `body: ${res.text}`).toBe(403);
    expect(String(res.body.code)).toBe("DRAFT_NOT_YOURS");
    expect(await draftCount(DICOM_UID)).toBe(before);
    expect(await draftById(id)).toMatchObject({ draftText: mine?.draftText ?? "" });

    // And the refusal names a way out that works, because the clinician's own text must
    // not be lost: saving without the id keeps it as a draft of their own.
    expect(String(res.body.error)).toMatch(/saved by/i);
    const kept = await postDrafts({ draftText: "My own copy." }, asColleague());
    expect(kept.status, `body: ${kept.text}`).toBe(200);
    expect(Number(kept.body.id)).not.toBe(id);
    const colleagueRow = await draftById(Number(kept.body.id));
    expect(colleagueRow?.draftText).toBe("My own copy.");

    await db
      .delete(aiReportingDraftsTable)
      .where(inArray(aiReportingDraftsTable.id, [id, Number(kept.body.id)]));
  });

  it("refuses a save whose draft id belongs to a different study", async () => {
    // The stale-drawer case: `savedDraftId` survives a study switch (the drawer is not
    // re-keyed on the study), so the screen is on one study while the id names another.
    // Writing it would put this examination's text into that examination's record.
    const created = await postDrafts({ draftText: "A draft on the first study." });
    const id = Number(created.body.id);

    const otherBefore = await draftCount(OTHER_STUDY_UID);
    const res = await postDrafts({
      studyInstanceUID: OTHER_STUDY_UID,
      id,
      draftText: "Text from the study the screen is on now.",
    });
    expect(res.status, `body: ${res.text}`).toBe(409);
    expect(String(res.body.code)).toBe("DRAFT_STUDY_MISMATCH");
    // Both UIDs are named: "which study did the screen have open" is a question only the
    // clinician can answer, so the refusal has to show both sides.
    expect(String(res.body.error)).toContain(DICOM_UID);
    expect(String(res.body.error)).toContain(OTHER_STUDY_UID);
    expect(await draftById(id)).toMatchObject({ studyInstanceUID: DICOM_UID, draftText: "A draft on the first study." });
    expect(await draftCount(OTHER_STUDY_UID)).toBe(otherBefore);

    await db.delete(aiReportingDraftsTable).where(eq(aiReportingDraftsTable.id, id));
  });

  it("does not report a saved draft for an id that no longer exists", async () => {
    // A deleted or never-existing row is not a save. The door used to answer `{ id }` for
    // it, and the drawer showed "Draft saved" and kept an id that points at nothing — so
    // every later Save, and the insert mark, was addressed to a row that is not there.
    const res = await postDrafts({ id: 999_999_999, draftText: "Nothing to update." });
    expect(res.status, `body: ${res.text}`).toBe(404);
    expect(String(res.body.code)).toBe("DRAFT_NOT_FOUND");

    const insert = await request(app)
      .post("/api/ai-reporting/insert-to-report")
      .set(auth())
      .send({ draftId: 999_999_999 });
    expect(insert.status, `body: ${insert.text}`).toBe(404);
  });
});
