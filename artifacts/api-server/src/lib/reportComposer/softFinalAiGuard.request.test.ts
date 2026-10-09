/**
 * Admin "mark final" (soft final) must honor the unreviewed-AI guard (P0-6).
 *
 * `POST /api/patient-reports` and `POST /:id/sign` both call
 * `checkUnreviewedAiFinalize` and fail closed. `POST /api/internal/radiology/report-status`
 * is the third way a study reaches REPORT_FINAL — status-only, with no signed
 * row — and it was the only one with no AI-review check at all. An administrator
 * (or anything holding the internal key) could mark a study Final while AI
 * suggestions still sat PENDING, so the worklist read as complete over machine
 * text nobody had accepted, revised or discarded.
 *
 * This runs the real route over real HTTP against a real database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  portalSessionsTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";

const uid = () => `1.2.826.0.1.3680043.9.9.${Date.now()}.${randomUUID().slice(0, 6)}`;

describe.skipIf(!hasDatabaseUrl())(
  "internal report-status respects the unreviewed-AI finalize guard",
  () => {
    let app: Express;
    const marker = `vitest-softfinal-${randomUUID().slice(0, 8)}`;
    let adminToken = "";
    let adminId = 0;
    let worklistId = 0;
    let jobId = 0;
    let studyInstanceUID = "";

    const pendingChanges = JSON.stringify([
      {
        id: "c1",
        changeType: "REPLACE",
        field: "findings",
        reviewState: "PENDING",
        proposedText: "Left foraminal narrowing at L5-S1.",
      },
    ]);
    const reviewedChanges = JSON.stringify([
      {
        id: "c1",
        changeType: "REPLACE",
        field: "findings",
        reviewState: "ACCEPTED",
        acceptedAt: new Date().toISOString(),
        proposedText: "Left foraminal narrowing at L5-S1.",
      },
    ]);

    beforeAll(async () => {
      app = await createTestApp();

      const [admin] = await db
        .insert(usersTable)
        .values({
          name: `Vitest Admin ${marker}`,
          email: `${marker}@vitest.invalid`,
          username: marker,
          role: "admin",
          permissions: JSON.stringify(["/radiology", "/admin"]),
          pin: "4321",
          isActive: true,
        })
        .returning();
      adminId = admin.id;
      adminToken = `vitest-token-${marker}`;
      await db.insert(portalSessionsTable).values({
        token: adminToken,
        scope: "staff",
        subjectId: admin.id,
        subjectName: admin.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      studyInstanceUID = uid();
      const [wl] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: `Vitest^Softfinal^${marker}`,
          modality: "MR",
          studyDescription: "MRI LS SPINE PLAIN",
          studyInstanceUID,
          accessionNumber: `ACC-${marker}`,
          status: "REPORT_IN_PROGRESS",
          aiDraftStatus: "NONE",
          dicomPatientId: `VT-${marker}`,
          // Identity resolved, so the ONLY thing that can refuse the finalize
          // in these tests is the AI-review guard under test — the route's
          // MATCH_GATE_BLOCKED check runs after it, not before.
          matchScore: "GREEN",
          matchDecision: "APPROVED",
        })
        .returning({ id: radiologyWorklistTable.id });
      worklistId = wl.id;

      const [job] = await db
        .insert(aiReportComposeJobsTable)
        .values({
          worklistId,
          jobKind: "FULL_REPORT",
          status: "READY",
          sourceReportRevision: "r1",
          sourceFindingsHash: "f1",
          sourceImpressionHash: "i1",
          sourceRecommendationHash: "rc1",
          inputHash: "in1",
          inputSnapshotJson: JSON.stringify({ modality: "MR", region: "Lumbar spine" }),
          trackedChangesJson: pendingChanges,
          proposedFindings: "Left foraminal narrowing at L5-S1.",
          createdBy: marker,
        })
        .returning({ id: aiReportComposeJobsTable.id });
      jobId = job.id;
    }, 60_000);

    afterAll(async () => {
      if (jobId) {
        await db.delete(aiReportComposeJobsTable).where(eq(aiReportComposeJobsTable.id, jobId)).catch(() => {});
      }
      if (worklistId) {
        await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
      }
      if (adminToken) {
        await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, adminToken)).catch(() => {});
      }
      if (adminId) {
        await db.delete(usersTable).where(eq(usersTable.id, adminId)).catch(() => {});
      }
    });

    // A function, not a literal: worklistId is only assigned inside beforeAll.
    const softFinalBody = () => ({
      worklistId,
      status: "REPORT_FINAL",
      softFinalOverride: true,
      softFinalReason: `vitest ${marker}`,
      actor: "vitest",
    });

    it("refuses to mark the study Final while AI suggestions are unreviewed", async () => {
      const res = await request(app)
        .post("/api/internal/radiology/report-status")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(softFinalBody());

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe("unreviewed_ai_compose_changes");

      const [row] = await db
        .select({ status: radiologyWorklistTable.status })
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.id, worklistId));
      expect(row.status).not.toBe("REPORT_FINAL");
    });

    it("still refuses for an internal-key caller, so automation cannot bypass it either", async () => {
      const key = process.env.INTERNAL_API_KEY;
      if (!key) {
        console.warn(
          "[SKIP] INTERNAL_API_KEY unset — the internal-key arm of the soft-final guard was not exercised in this run",
        );
        return;
      }
      const res = await request(app)
        .post("/api/internal/radiology/report-status")
        .set("Authorization", `Bearer ${key}`)
        .send(softFinalBody());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("unreviewed_ai_compose_changes");
    });

    it("allows the same request once the AI suggestions have been reviewed", async () => {
      await db
        .update(aiReportComposeJobsTable)
        .set({ trackedChangesJson: reviewedChanges, status: "APPLIED" })
        .where(eq(aiReportComposeJobsTable.id, jobId));

      const res = await request(app)
        .post("/api/internal/radiology/report-status")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(softFinalBody());

      expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);

      const [row] = await db
        .select({ status: radiologyWorklistTable.status })
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.id, worklistId));
      expect(row.status).toBe("REPORT_FINAL");
    });
  },
);
