/**
 * A previously signed report must be readable as a PRIOR report — request level,
 * real Postgres.
 *
 * Measured live on the isolated rig at 63b373b8 (browser journey J14, then a
 * direct GET): the Reporting Workspace's own "Prior report" panel listed every
 * prior study of the patient and showed NO content for any of them, including
 * one the workspace had just signed. The signed text was in the database the
 * whole time:
 *
 *   patient_reports id 2 · study_id = 1 · "Normal MRI of the brain…"
 *   radiology_worklist id 1 → radiology_studies id 2 (SYNRC6301)
 *   GET /api/radiology-copilot/prior-studies?patientId=1 → study 2 came back
 *   with reportId=null, impression=null, finalReport=null.
 *
 * The cause is an id-space mistake in the reader. `patient_reports.study_id` has
 * two spellings, and both are production reality:
 *   · the workspace finalize path writes the radiology_worklist ROW id —
 *     lib/radiologyIdentity.ts: "Always the worklist row id — store this on
 *     patient_reports.study_id";
 *   · legacy / free-text writers write the billed radiology_studies.id, which is
 *     what `careUsgCompanion.ts:156-168` and `emitReportToHope` both have to
 *     untangle with a patient check.
 * `/prior-studies` matched only the second spelling, so every report written by
 * the modern path — i.e. every report this clinic signs — fell out of the join.
 * The panels then fell back to `radiology_studies.final_report`, which the
 * workspace never populates (measured: 0 of 14 rig studies carry it), and the
 * radiologist read "No report text available." beside an examination that had
 * been reported and signed.
 *
 * What this file pins:
 *   1. the premise is measured, not assumed — the row the workspace create path
 *      writes really does carry the worklist id, and it really is a different
 *      number from the billed study id;
 *   2. that prior's impression AND findings text come back for the study they
 *      belong to;
 *   3. the legacy spelling still resolves (the fix must not trade one broken
 *      panel for another);
 *   4. the two id spaces are independent sequences, so a colliding worklist row
 *      belonging to a DIFFERENT patient must not re-attribute this patient's
 *      report — the resolution is patient-checked both ways;
 *   5. a study with no report behind it still shows no content, and is not given
 *      another study's content.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  patientsTable,
  testsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientReportsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("prior-studies returns what the workspace signed — request level", () => {
  let app: Express;
  const marker = `priorc-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const auth = { Authorization: `Bearer ${token}` };
  const today = new Date().toISOString().slice(0, 10);

  const patientIds: number[] = [];
  const studyIds: number[] = [];
  const worklistIds: number[] = [];
  const reportIds: number[] = [];
  const testIds: number[] = [];

  let patientA = 0; // the patient whose priors are being read
  let patientB = 0; // somebody else, whose worklist row will occupy A's study number
  let testMr = 0;

  async function patient(tag: string) {
    const [row] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker.toUpperCase()}-${tag}`,
        firstName: "Prior",
        lastName: `${tag} ${marker}`,
        dateOfBirth: "1975-04-01",
        gender: "male",
        phone: "0000000000",
      })
      .returning();
    patientIds.push(row.id);
    return row.id;
  }

  async function study(patientId: number, accession: string, modality = "MR") {
    const [row] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: accession,
        patientId,
        testId: testMr,
        modality,
        department: "MRI",
        bodyPart: "HEAD",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "reported_final",
      })
      .returning();
    studyIds.push(row.id);
    return row.id;
  }

  async function worklist(patientId: number, studyId: number | null, accession: string, forceId?: number) {
    const values = {
      patientName: `Prior ${marker}`,
      patientId,
      studyId,
      modality: "MR",
      studyDescription: "MRI Brain",
      studyDate: today,
      accessionNumber: accession,
      studyInstanceUID: `1.2.840.priorc.${marker}.${accession}`,
      matchScore: "GREEN",
      matchDecision: "APPROVED",
      status: "STUDY_RECEIVED",
      ...(forceId ? { id: forceId } : {}),
    };
    const [row] = await db.insert(radiologyWorklistTable).values(values as never).returning();
    worklistIds.push(row.id);
    return row.id;
  }

  const FINDINGS_SENTENCE = "A chronic subdural collection overlies the left hemisphere.";
  const IMPRESSION_SENTENCE = "Chronic subdural haematoma over the left hemisphere.";

  /** Exactly the body shape the workspace stores: rendered HTML, not prose. */
  const signedBody = `<div class="section-heading">FINDINGS</div><p>${FINDINGS_SENTENCE}</p>`
    + `<div class="section-heading">IMPRESSION</div><ul><li>${IMPRESSION_SENTENCE}</li></ul>`;

  const priorStudies = (patientId: number, excludeStudyId?: number) => {
    const qs = new URLSearchParams({ patientId: String(patientId), limit: "20" });
    if (excludeStudyId) qs.set("excludeStudyId", String(excludeStudyId));
    return request(app).get(`/api/radiology-copilot/prior-studies?${qs.toString()}`).set(auth);
  };

  const rowFor = (body: { studies: Array<Record<string, unknown>> }, id: number) =>
    body.studies.find((s) => s.id === id) ?? null;

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr. PriorProbe ${marker}`,
        email: `priorc-${marker}@vitest.invalid`,
        username: `priorc-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const [mr] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `MRB${marker.slice(-4).toUpperCase()}`,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testMr = mr.id;
    testIds.push(mr.id);

    patientA = await patient("Alpha");
    patientB = await patient("Bravo");
  });

  afterAll(async () => {
    if (reportIds.length) await db.delete(patientReportsTable).where(inArray(patientReportsTable.id, reportIds));
    if (worklistIds.length) await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, worklistIds));
    if (studyIds.length) await db.delete(radiologyStudiesTable).where(inArray(radiologyStudiesTable.id, studyIds));
    if (patientIds.length) await db.delete(patientsTable).where(inArray(patientsTable.id, patientIds));
    if (testIds.length) await db.delete(testsTable).where(inArray(testsTable.id, testIds));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    await db.delete(usersTable).where(eq(usersTable.email, `priorc-${marker}@vitest.invalid`));
  });

  it("gives the prior study its signed impression and findings when the report is keyed by the worklist row", async () => {
    // Two examinations for one patient: the older one is the prior being read,
    // the newer one is the study open on screen (so it is excluded by id).
    const priorStudy = await study(patientA, `ACC-${marker}-prior`);
    const currentStudy = await study(patientA, `ACC-${marker}-current`);
    const priorWorklist = await worklist(patientA, priorStudy, `WL-${marker}-prior`);
    await worklist(patientA, currentStudy, `WL-${marker}-current`);

    // The premise, measured rather than asserted from a comment: this is the
    // payload the Reporting Workspace posts when it saves/signs.
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testMr,
        studyId: priorWorklist,
        worklistId: priorWorklist,
        title: "MRI Brain",
        body: signedBody,
        impression: IMPRESSION_SENTENCE,
      });
    expect([200, 201], `create: ${created.status} ${created.text}`).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);

    const [stored] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId));
    expect(stored.studyId, "the workspace keys the report by the worklist row id").toBe(priorWorklist);
    expect(stored.studyId, "and that number is NOT the billed study id it describes").not.toBe(priorStudy);

    const res = await priorStudies(patientA, currentStudy);
    expect(res.status, res.text).toBe(200);
    const prior = rowFor(res.body, priorStudy);
    expect(prior, `the signed study must be listed at all: ${JSON.stringify(res.body)}`).not.toBeNull();
    expect(prior, "the report must be attributed to the study it belongs to").toMatchObject({
      reportId,
      impression: IMPRESSION_SENTENCE,
    });
    expect(String(prior!.finalReport)).toContain(FINDINGS_SENTENCE);
    // The current study is excluded, so its own row cannot answer for a prior.
    expect(rowFor(res.body, currentStudy)).toBeNull();
  });

  it("excludes the study being reported when the caller names the worklist row it was opened from", async () => {
    // The workspace route is /radiology/report/:worklistId, and measured on the rig
    // the panels sent THAT number as excludeStudyId. Excluding only the billed-study
    // spelling left the study under reporting listed as its own prior; the panel
    // auto-selects the newest row, so the radiologist read
    // "No report text available." instead of the signed examination behind it.
    const priorStudy = await study(patientA, `ACC-${marker}-selfprior`);
    const priorWorklist = await worklist(patientA, priorStudy, `WL-${marker}-selfprior`);
    const currentStudy = await study(patientA, `ACC-${marker}-selfprior-current`);
    const currentWorklist = await worklist(patientA, currentStudy, `WL-${marker}-selfprior-open`);

    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-selfprior`,
        type: "radiology",
        patientId: patientA,
        testId: testMr,
        studyId: priorWorklist, // the workspace spelling again: the worklist row id
        title: "MRI Brain",
        body: signedBody,
        impression: IMPRESSION_SENTENCE,
        status: "verified",
      })
      .returning();
    reportIds.push(row.id);

    const res = await priorStudies(patientA, currentWorklist);
    expect(res.status, res.text).toBe(200);
    expect(res.body.studies.map((s: { id: number }) => s.id), "the study being reported must not list itself")
      .not.toContain(currentStudy);
    const prior = rowFor(res.body, priorStudy);
    expect(prior, `the signed prior must still be there: ${JSON.stringify(res.body)}`).not.toBeNull();
    expect(prior).toMatchObject({ reportId: row.id, impression: IMPRESSION_SENTENCE });
  });

  it("still resolves a legacy report keyed by the billed study id", async () => {
    const legacyStudy = await study(patientA, `ACC-${marker}-legacy`);
    const otherStudy = await study(patientA, `ACC-${marker}-other`);
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-legacy`,
        type: "radiology",
        patientId: patientA,
        testId: testMr,
        studyId: legacyStudy, // the legacy spelling: the billed study row itself
        title: "MRI Brain (legacy)",
        body: signedBody,
        impression: IMPRESSION_SENTENCE,
        status: "verified",
      })
      .returning();
    reportIds.push(row.id);

    const res = await priorStudies(patientA);
    expect(res.status, res.text).toBe(200);
    const prior = rowFor(res.body, legacyStudy);
    expect(prior, "a legacy-keyed signed report must not lose its content").not.toBeNull();
    expect(prior).toMatchObject({ reportId: row.id, impression: IMPRESSION_SENTENCE });
    expect(String(prior!.finalReport)).toContain(FINDINGS_SENTENCE);
    // The study with nothing behind it stays empty — it is not given the other's text.
    const bare = rowFor(res.body, otherStudy);
    expect(bare).not.toBeNull();
    expect(bare!.reportId).toBeNull();
    expect(bare!.impression).toBeNull();
    expect(bare!.finalReport).toBeNull();
  });

  it("will not re-attribute a report through another patient's colliding worklist row", async () => {
    // radiology_studies.id and radiology_worklist.id are independent sequences, so
    // the number one patient's report carries can be another patient's worklist
    // row. Built here by naming the ids rather than hoping the sequences drift
    // together (routes/finalizeStudyIdAuthority.request.test.ts documents the same
    // collision on the write side).
    const studyA = await study(patientA, `ACC-${marker}-collide`);
    const excluded = await study(patientA, `ACC-${marker}-collide2`);
    const studyB = await study(patientB, `ACC-${marker}-b`);
    const worklistB = await worklist(patientB, studyB, `WL-${marker}-b`, studyA);
    expect(worklistB, "the fixture really produced the collision").toBe(studyA);

    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-collide`,
        type: "radiology",
        patientId: patientA,
        testId: testMr,
        studyId: studyA, // A's legacy spelling — and, by number, B's worklist row
        title: "MRI Brain (colliding number)",
        body: signedBody,
        impression: IMPRESSION_SENTENCE,
        status: "verified",
      })
      .returning();
    reportIds.push(row.id);

    const resA = await priorStudies(patientA, excluded);
    expect(resA.status, resA.text).toBe(200);
    const priorA = rowFor(resA.body, studyA);
    expect(priorA, "the report must stay on its own patient's study").not.toBeNull();
    expect(priorA).toMatchObject({ reportId: row.id, impression: IMPRESSION_SENTENCE });

    // B's own read must not be handed A's signed text.
    const resB = await priorStudies(patientB);
    expect(resB.status, resB.text).toBe(200);
    const bRow = rowFor(resB.body, studyB);
    expect(bRow === null || bRow!.reportId, "another patient's report is never attributed here").not.toBe(row.id);
    if (bRow) expect(bRow!.impression).toBeNull();
  });
});
