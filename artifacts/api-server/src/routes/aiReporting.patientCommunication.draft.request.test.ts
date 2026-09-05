/**
 * Request-level: patient-communication AI draft must fail closed (HTTP 501)
 * and must never return canned clinical interpretation for any input.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable, aiPatientCommunicationsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

describe.skipIf(!hasDatabaseUrl())(
  "POST /api/ai-reporting/patient-communications/:id/draft — fail closed",
  () => {
    let app: Express;
    let token = "";
    let userId = 0;
    const marker = `vitest-pc-${randomUUID().slice(0, 8)}`;
    const createdIds: number[] = [];

    beforeAll(async () => {
      app = await createTestApp();
      token = `vitest-token-${randomUUID()}`;
      const [user] = await db
        .insert(usersTable)
        .values({
          name: `Vitest PatientComm ${marker}`,
          email: `${marker}@vitest.invalid`,
          username: marker,
          role: "admin",
          permissions: JSON.stringify(["ai_reporting.use", "ai_reporting.configure"]),
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

      const rows = await db
        .insert(aiPatientCommunicationsTable)
        .values([
          {
            communicationType: "result_summary",
            language: "en",
            originalText:
              "MRI Brain: No acute infarct. Mild chronic small-vessel ischaemic change. No mass lesion.",
            status: "pending",
          },
          {
            communicationType: "result_summary",
            language: "en",
            originalText:
              "MRI Brain: Large right MCA territory acute infarct with hemorrhagic transformation. Midline shift 6 mm. Urgent clinical correlation.",
            status: "pending",
          },
        ])
        .returning({ id: aiPatientCommunicationsTable.id });
      for (const r of rows) createdIds.push(r.id);
    });

    afterAll(async () => {
      if (createdIds.length) {
        await db.delete(aiPatientCommunicationsTable).where(inArray(aiPatientCommunicationsTable.id, createdIds));
      }
      if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    });

    async function assertDraftDisabled(id: number) {
      const before = await db
        .select()
        .from(aiPatientCommunicationsTable)
        .where(eq(aiPatientCommunicationsTable.id, id))
        .limit(1);
      expect(before[0]?.aiDraft ?? null).toBeNull();

      const res = await request(app)
        .post(`/api/ai-reporting/patient-communications/${id}/draft`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(501);
      expect(res.body.code).toBe("patient_communication_ai_not_configured");
      expect(String(res.body.error)).toContain(
        "AI patient-friendly summaries are not enabled yet",
      );
      const body = JSON.stringify(res.body).toLowerCase();
      expect(body).not.toContain("overall findings are normal");
      expect(body).not.toContain("no significant abnormalities");
      expect(body).not.toContain("within 2 weeks");
      expect(body).not.toContain("continue with your regular care");

      const after = await db
        .select()
        .from(aiPatientCommunicationsTable)
        .where(eq(aiPatientCommunicationsTable.id, id))
        .limit(1);
      expect(after[0]?.aiDraft ?? null).toBeNull();
      expect(after[0]?.status).toBe("pending");
    }

    it("returns 501 for a near-normal report without writing canned text", async () => {
      await assertDraftDisabled(createdIds[0]!);
    });

    it("returns 501 for an abnormal/urgent report without writing canned text", async () => {
      await assertDraftDisabled(createdIds[1]!);
    });
  },
);
