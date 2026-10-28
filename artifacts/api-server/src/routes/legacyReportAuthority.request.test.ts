/**
 * B10-23 (request level) — POST /api/radiology/:id/report on a real
 * database.
 *
 * WHY THIS FILE EXISTS NEXT TO THE PURE TESTS. legacyReportAuthority.test.ts
 * proves the rule. It cannot prove that the route reaches the rule before the
 * UPDATE, that the two facts are gathered from the right columns
 * (radiology_worklist.study_id vs patient_reports.study_id, which live in
 * different id spaces), or that the historical-correction branch still writes.
 * A guard that is imported but never consulted, a lookup on the wrong column,
 * and a blanket 403 that also blocks the allowed case all pass a pure test.
 * This file executes the route.
 *
 * DATABASE_ONLY: skipped when DATABASE_URL is unset — so on the Windows
 * operator box this is CI's job, exactly like resolveStudyUid.request.test.ts.
 *
 * The allowed case is the positive control for every refusal below. Delete it
 * and "always 409" would look like a clean pass.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  patientsTable,
  testsTable,
  usersTable,
  portalSessionsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientReportsTable,
} from "@workspace/db/schema";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)(
  "B10-23 legacy report write — the route refuses what the workspace owns",
  () => {
    let app: Express;
    const marker = `b10legacy-${randomUUID().slice(0, 8)}`;
    const token = `vitest-token-${randomUUID()}`;
    let userId = 0;
    let patientId = 0;
    let testId = 0;
    const studyIds: number[] = [];
    const worklistIds: number[] = [];
    const reportIds: number[] = [];
    const otherPatientIds: number[] = [];

    beforeAll(async () => {
      app = await createTestApp();
      const [user] = await db
        .insert(usersTable)
        .values({
          name: `B10 Legacy ${marker}`,
          email: `${marker}@vitest.invalid`,
          username: marker,
          role: "admin",
          permissions: JSON.stringify(["/radiology"]),
          pin: "0000",
          isActive: true,
        })
        .returning();
      userId = user.id;
      await db.insert(portalSessionsTable).values({
        token,
        scope: "staff",
        subjectId: user.id,
        subjectName: user.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const [patient] = await db
        .insert(patientsTable)
        .values({
          patientId: `B10-${marker}`,
          firstName: `Legacy ${marker}`,
          lastName: "Patient",
          dateOfBirth: "1980-01-01",
          gender: "male",
          phone: "9999999999",
        })
        .returning();
      patientId = patient.id;

      const [testRow] = await db
        .insert(testsTable)
        .values({
          name: `MRI Brain ${marker}`,
          code: `MR${marker.slice(-5).toUpperCase()}`,
          price: "1000",
          category: "Radiology",
          department: "MRI",
          duration: "1 day",
          isActive: true,
        })
        .returning();
      testId = testRow.id;
    }, 120_000);

    afterAll(async () => {
      for (const id of reportIds) {
        await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
      }
      for (const id of worklistIds) {
        await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
      }
      for (const id of studyIds) {
        await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
      }
      await db
        .delete(patientReportsTable)
        .where(like(patientReportsTable.reportNumber, `%${marker}%`))
        .catch(() => {});
      await db
        .delete(patientsTable)
        .where(eq(patientsTable.id, patientId))
        .catch(() => {});
      for (const id of otherPatientIds) {
        await db.delete(patientsTable).where(eq(patientsTable.id, id)).catch(() => {});
      }
      await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
      await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    }, 120_000);

    async function makeStudy(fields: {
      tag: string;
      finalReport?: string | null;
      prelimReport?: string | null;
      status?: string;
    }) {
      const [row] = await db
        .insert(radiologyStudiesTable)
        .values({
          accessionNumber: `ACC-${marker}-${fields.tag}`,
          patientId,
          testId,
          modality: "MR",
          department: "MRI",
          studyDescription: "MRI Brain",
          studyDate: new Date().toISOString().slice(0, 10),
          status: fields.status ?? "acquired",
          finalReport: fields.finalReport ?? null,
          prelimReport: fields.prelimReport ?? null,
        })
        .returning();
      studyIds.push(row.id);
      return row;
    }

    async function linkWorklist(studyId: number, tag: string) {
      const [wl] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: `LEGACY^LINK ${marker}`,
          modality: "MR",
          studyDate: "20260315",
          accessionNumber: `ACC-${marker}-WL-${tag}`,
          studyId,
        })
        .returning();
      worklistIds.push(wl.id);
      return wl;
    }

    async function addReport(studyRef: number, tag: string) {
      const [rep] = await db
        .insert(patientReportsTable)
        .values({
          reportNumber: `RPT-${marker}-${tag}`,
          type: "radiology",
          patientId,
          testId,
          studyId: studyRef,
          title: `MRI Brain ${marker}`,
          body: "<p>signed canonical report</p>",
          status: "verified",
        })
        .returning();
      reportIds.push(rep.id);
      return rep;
    }

    const post = (
      studyId: number,
      payload: { stage: string; body: string; reportedBy?: string },
    ) =>
      request(app)
        .post(`/api/radiology/${studyId}/report`)
        .set({ "Content-Type": "application/json", Authorization: `Bearer ${token}` })
        .send(payload);

    const readStudy = async (studyId: number) => {
      const [row] = await db
        .select()
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.id, studyId));
      return row;
    };

    test("a study with a worklist row is refused, and the column is untouched", async () => {
      const study = await makeStudy({ tag: "WL" });
      const wl = await linkWorklist(study.id, "WL");
      const res = await post(study.id, { stage: "final", body: "Legacy competing truth." });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LEGACY_REPORT_SURFACE_CLOSED");
      expect(String(res.body.error)).toContain("Reporting Workspace");

      const after = await readStudy(study.id);
      expect(after.finalReport).toBeNull();
      expect(after.status).toBe("acquired");
      expect(wl.studyId).toBe(study.id);
    });

    test("a patient_reports row keyed on the worklist id also refuses (the canonical id space)", async () => {
      const study = await makeStudy({ tag: "WLKEY" });
      const wl = await linkWorklist(study.id, "WLKEY");
      await addReport(wl.id, "WLKEY");
      const res = await post(study.id, { stage: "final", body: "Competing final." });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LEGACY_REPORT_SURFACE_CLOSED");
      expect((await readStudy(study.id)).finalReport).toBeNull();
    });

    test("a patient_reports row keyed on the study id refuses even with no worklist row", async () => {
      // Older/other writers store radiology_studies.id in the same column, which
      // is why the lookup checks both keys.
      const study = await makeStudy({ tag: "STUDYKEY" });
      await addReport(study.id, "STUDYKEY");
      const res = await post(study.id, { stage: "final", body: "Competing final." });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LEGACY_REPORT_SURFACE_CLOSED");
    });

    test("another patient's report that merely carries this study's NUMBER does not refuse it", async () => {
      // `patient_reports.study_id` holds ids from two independent sequences — the
      // Reporting Workspace stores `radiology_worklist.id`, older writers store
      // `radiology_studies.id` (the two cases above). Nothing makes the two
      // numbering spaces agree, so somebody else's worklist row id can be exactly
      // this legacy study's id. Measured on CI: with that collision present the
      // historical free-text correction of an untouched legacy study was refused
      // 409 "the Reporting Workspace owns this" — a sentence about a report that
      // belongs to a different patient entirely. The row has to describe THIS
      // study's patient, not just carry this study's number.
      const [otherPatient] = await db
        .insert(patientsTable)
        .values({
          patientId: `B10-OTHER-${marker}`,
          firstName: `Other ${marker}`,
          lastName: "Colliding",
          dateOfBirth: "1970-01-01",
          gender: "female",
          phone: "9999900000",
        })
        .returning();
      otherPatientIds.push(otherPatient.id);

      const otherStudy = await makeStudy({ tag: "COLLIDE-OTHER" });
      const study = await makeStudy({ tag: "COLLIDE-LEGACY", finalReport: "Historical text." });

      // The collision itself: a worklist ROW whose id equals the legacy study's
      // id, belonging to another patient and describing another study.
      const [collidingWorklist] = await db
        .insert(radiologyWorklistTable)
        .values({
          id: study.id,
          patientId: otherPatient.id,
          patientName: `Other ${marker}`,
          modality: "MR",
          studyDate: "20260315",
          accessionNumber: `ACC-${marker}-COLLIDE-WL`,
          studyId: otherStudy.id,
        })
        .returning();
      worklistIds.push(collidingWorklist.id);

      // …and that patient's signed report, keyed the canonical way, by the
      // worklist row id — which is numerically this study's id.
      const [collidingReport] = await db
        .insert(patientReportsTable)
        .values({
          reportNumber: `RPT-${marker}-COLLIDE`,
          type: "radiology",
          patientId: otherPatient.id,
          testId,
          studyId: collidingWorklist.id,
          title: `MRI Brain ${marker}`,
          body: "<p>somebody else's signed report</p>",
          status: "verified",
        })
        .returning();
      reportIds.push(collidingReport.id);

      expect(collidingWorklist.id, "the fixture really produced the collision")
        .toBe(study.id);
      expect(collidingReport.patientId, "and the report belongs to another patient")
        .not.toBe(study.patientId);

      const res = await post(study.id, { stage: "final", body: "Corrected history." });
      expect(res.status, res.text).toBe(200);
      expect((await readStudy(study.id)).finalReport).toBe("Corrected history.");

      // The refusal still fires for a report that really does describe this study.
      const ours = await addReport(study.id, "COLLIDE-OURS");
      const refused = await post(study.id, { stage: "final", body: "Should not write." });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("LEGACY_REPORT_SURFACE_CLOSED");
      expect((await readStudy(study.id)).finalReport).toBe("Corrected history.");
      expect(ours.studyId).toBe(study.id);
    }, 60_000);

    test("a legacy-only study cannot get a FIRST final report", async () => {
      const study = await makeStudy({ tag: "NEWFIN", finalReport: null });
      const res = await post(study.id, { stage: "final", body: "Brand new authoritative report." });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LEGACY_REPORT_CREATION_CLOSED");

      const after = await readStudy(study.id);
      expect(after.finalReport).toBeNull();
      // Status is the study's clinical state; a refused write must not move it.
      expect(after.status).toBe("acquired");
    });

    test("a whitespace-only stored final is not an existing document", async () => {
      const study = await makeStudy({ tag: "BLANK", finalReport: "   " });
      const res = await post(study.id, { stage: "final", body: "Now with content." });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LEGACY_REPORT_CREATION_CLOSED");
    });

    test("a legacy-only study cannot get a FIRST preliminary report either", async () => {
      // priorStudies.ts reads prelimReport when finalReport is absent, and
      // pacsArchive.ts falls back to it, so "preliminary" is not inert text.
      const study = await makeStudy({ tag: "NEWPRELIM", prelimReport: null });
      const res = await post(study.id, { stage: "preliminary", body: "First prelim ever." });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LEGACY_REPORT_CREATION_CLOSED");
      expect((await readStudy(study.id)).prelimReport).toBeNull();
    });

    test("POSITIVE CONTROL — correcting an existing legacy final report still writes", async () => {
      // The historical-compatibility branch is the whole reason this is a rule
      // and not a 403. Without this case, "always refuse" would pass every test
      // above.
      const study = await makeStudy({
        tag: "CORRECT",
        finalReport: "Old typo-laden 2019 free-text report.",
      });
      const res = await post(study.id, {
        stage: "final",
        body: "Corrected 2019 free-text report.",
        reportedBy: "Dr Legacy",
      });

      expect(res.status).toBe(200);
      const after = await readStudy(study.id);
      expect(after.finalReport).toBe("Corrected 2019 free-text report.");
      expect(after.status).toBe("reported_final");
    });

    test("POSITIVE CONTROL — correcting an existing legacy preliminary report still writes", async () => {
      const study = await makeStudy({
        tag: "CORRECTPRELIM",
        prelimReport: "Earlier prelim draft.",
      });
      const res = await post(study.id, { stage: "preliminary", body: "Fixed prelim draft." });
      expect(res.status).toBe(200);
      expect((await readStudy(study.id)).prelimReport).toBe("Fixed prelim draft.");
    });

    test("an invalid stage is still rejected before any write", async () => {
      const study = await makeStudy({ tag: "BADSTAGE", finalReport: "Existing." });
      const res = await post(study.id, { stage: "interim", body: "Whatever." });
      expect(res.status).toBe(400);
    });

    test("an unknown study id is a 404, not a refusal that implies a write happened", async () => {
      const res = await post(999_999_999, { stage: "final", body: "Nothing here." });
      expect(res.status).toBe(404);
    });

    test("GET /studies/:id reports the worklist id the handoff needs, and null when there is none", async () => {
      // The Reporting Workspace route takes a radiology_worklist.id, so the
      // legacy page cannot build a handoff URL without this resolution. A wrong
      // key would silently 404 for the radiologist.
      const unlinked = await makeStudy({ tag: "NOLINK" });
      const linked = await makeStudy({ tag: "HASLINK" });
      const wl = await linkWorklist(linked.id, "HASLINK");

      const a = await request(app)
        .get(`/api/radiology/studies/${unlinked.id}`)
        .set({ Authorization: `Bearer ${token}` });
      expect(a.status).toBe(200);
      expect(a.body.worklistId).toBeNull();

      const b = await request(app)
        .get(`/api/radiology/studies/${linked.id}`)
        .set({ Authorization: `Bearer ${token}` });
      expect(b.status).toBe(200);
      expect(b.body.worklistId).toBe(wl.id);
      // additive only — the existing detail fields must still be there
      expect(b.body.accessionNumber).toBe(`ACC-${marker}-HASLINK`);
    });

    test("the guard is per study: a linked sibling does not freeze an unlinked one's correction", async () => {
      const linked = await makeStudy({ tag: "PAIR1", finalReport: "Old text A." });
      await linkWorklist(linked.id, "PAIR1");
      const unlinked = await makeStudy({ tag: "PAIR2", finalReport: "Old text B." });

      expect((await post(linked.id, { stage: "final", body: "New A." })).status).toBe(409);
      // The body names which guard refused, and therefore which table a stray row
      // came from: `LEGACY_REPORT_SURFACE_CLOSED` is the worklist/report lookup,
      // "study is currently locked by" is `radiology_study_locks`. Without it a
      // failure here reads as one identical mystery every time.
      const unlinkedWrite = await post(unlinked.id, { stage: "final", body: "New B." });
      expect(unlinkedWrite.status, unlinkedWrite.text).toBe(200);

      expect((await readStudy(unlinked.id)).finalReport).toBe("New B.");
      expect((await readStudy(linked.id)).finalReport).toBe("Old text A.");
    });
  },
);
