/**
 * Request-level: DICOM AI extract must fail closed (HTTP 501)
 * and must never return canned clinical findings (normal or abnormal).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  usersTable,
  dicomStudiesTable,
  aiExtractionResultsTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

describe.skipIf(!hasDatabaseUrl())(
  "POST /api/dicom-workflow/ai-extract/:studyId — fail closed",
  () => {
    let app: Express;
    let token = "";
    let userId = 0;
    const marker = `vitest-dx-${randomUUID().slice(0, 8)}`;
    const studyIds: number[] = [];
    const extractionIds: number[] = [];

    beforeAll(async () => {
      app = await createTestApp();
      token = `vitest-token-${randomUUID()}`;
      const [user] = await db
        .insert(usersTable)
        .values({
          name: `Vitest DicomAi ${marker}`,
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
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const studies = await db
        .insert(dicomStudiesTable)
        .values([
          {
            studyInstanceUID: `1.2.840.10008.1.${marker}.normal`,
            patientName: `NORMAL^CASE^${marker}`,
            modality: "MR",
            studyDescription: "MRI Brain Plain — near normal",
          },
          {
            studyInstanceUID: `1.2.840.10008.1.${marker}.abnormal`,
            patientName: `ABNORMAL^CASE^${marker}`,
            modality: "CT",
            studyDescription: "CT Chest — suspected mass",
          },
        ])
        .returning({ id: dicomStudiesTable.id });
      for (const s of studies) studyIds.push(s.id);

      const [ex] = await db
        .insert(aiExtractionResultsTable)
        .values({
          studyId: studyIds[0]!,
          extractionType: "measurements_from_overlay",
          extractedData: JSON.stringify({ measurement: "liver span 14 cm", source: "ocr" }),
          confidence: "0.82",
          reviewStatus: "pending",
          isAiSuggested: false,
        })
        .returning({ id: aiExtractionResultsTable.id });
      extractionIds.push(ex.id);
    });

    afterAll(async () => {
      if (studyIds.length) {
        await db
          .delete(aiExtractionResultsTable)
          .where(inArray(aiExtractionResultsTable.studyId, studyIds));
        await db.delete(dicomStudiesTable).where(inArray(dicomStudiesTable.id, studyIds));
      }
      if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    });

    async function assertExtractDisabled(studyId: number, extractionType: string) {
      const beforeRows = await db
        .select()
        .from(aiExtractionResultsTable)
        .where(eq(aiExtractionResultsTable.studyId, studyId));

      const res = await request(app)
        .post(`/api/dicom-workflow/ai-extract/${studyId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ extractionType });

      expect(res.status).toBe(501);
      expect(res.body.code).toBe("dicom_ai_extraction_not_configured");
      expect(String(res.body.error)).toContain("DICOM AI extraction is not configured");
      expect(String(res.body.error)).toContain("No clinical findings were generated");

      const body = JSON.stringify(res.body).toLowerCase();
      expect(body).not.toContain("no significant abnormality");
      expect(body).not.toContain("ai suggestion");
      expect(body).not.toContain("impression");
      expect(body).not.toContain("template");
      expect(body).not.toContain("prior comparison");
      expect(body).not.toMatch(/"confidence"/);
      expect(body).not.toMatch(/"findings"/);

      const afterRows = await db
        .select()
        .from(aiExtractionResultsTable)
        .where(eq(aiExtractionResultsTable.studyId, studyId));
      expect(afterRows.length).toBe(beforeRows.length);
      expect(afterRows.map((r) => r.id).sort()).toEqual(beforeRows.map((r) => r.id).sort());
      expect(afterRows.map((r) => r.extractedData).sort()).toEqual(
        beforeRows.map((r) => r.extractedData).sort(),
      );
    }

    it("returns 501 for a near-normal MRI study without writing canned findings", async () => {
      await assertExtractDisabled(studyIds[0]!, "findings_suggestion");
    });

    it("returns 501 for an abnormal CT study without writing canned findings", async () => {
      await assertExtractDisabled(studyIds[1]!, "prior_comparison");
    });

    it("keeps OCR review list/accept infrastructure available", async () => {
      const list = await request(app)
        .get(`/api/dicom-workflow/ocr-review/${studyIds[0]!}`)
        .set("Authorization", `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
      expect(list.body.some((r: { id: number }) => r.id === extractionIds[0])).toBe(true);

      const accept = await request(app)
        .post(`/api/dicom-workflow/ocr-review/${extractionIds[0]!}/accept`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(accept.status).toBe(200);
      expect(accept.body.reviewStatus).toBe("accepted");

      await db
        .update(aiExtractionResultsTable)
        .set({
          reviewStatus: "pending",
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
        })
        .where(eq(aiExtractionResultsTable.id, extractionIds[0]!));
    });
  },
);
