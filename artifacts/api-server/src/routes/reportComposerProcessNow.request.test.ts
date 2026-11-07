/**
 * Who may start a queued compose job now, executed through the real router.
 *
 * The audit item: `canUse()` admits `ai_reporting.use` for enqueue, read, accept,
 * reject, applied and discard, while `POST /jobs/:id/process-now` demanded
 * `FULL_ACCESS_ROLES` — and the workspace calls it optimistically and ignores a 403
 * (`useReportComposer.ts:387-393`). So a radiologist's enqueue waited for the drain
 * tick (10 s after boot, then every 20 s — `src/cron.ts:231,236`) while an admin's did
 * not: the same clinical request, ~22 s slower for the person who reports.
 *
 * This is the arm the composer suites never had: every existing process-now case signs
 * in as `admin`, where the role grant and the permission grant are the same answer, so
 * nothing executed the `ai_reporting.use` leg. Requires PostgreSQL; skipped without it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  portalSessionsTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

describe.skipIf(!hasDatabaseUrl())("report composer — process-now authorization", () => {
  let app: Express;
  let radiologistToken = "";
  let noAiToken = "";
  const userIds: number[] = [];
  const sessionTokens: string[] = [];
  const jobIds: number[] = [];
  let worklistId = 0;
  const marker = `vitest-pnauth-${randomUUID().slice(0, 8)}`;

  async function makeStaff(label: string, permissions: string[]): Promise<string> {
    const token = `vitest-pnauth-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Vitest ProcessNow ${marker}`,
        // A `radiologist` role, not `admin`: FULL_ACCESS_ROLES authorizes by role alone,
        // so an admin session cannot tell the two gates apart.
        role: "radiologist",
        email: `${marker}.${label}@vitest.invalid`,
        username: `${marker}.${label}`,
        permissions: JSON.stringify(permissions),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userIds.push(user.id);
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    sessionTokens.push(token);
    return token;
  }

  async function enqueue(token: string, tag: string): Promise<number> {
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        jobKind: "FULL_REPORT",
        snapshot: {
          worklistId,
          studyId: null,
          modality: "MR",
          region: "LS_SPINE",
          clinicalHistory: "Low back pain.",
          technique: "MRI LS Spine",
          findings: `Loss of lordosis. ${tag}`,
          impression: "",
          recommendation: "",
          observations: [{ concept: `obs_${tag}`, source: "manual", findingsText: `Loss of lordosis. ${tag}` }],
        },
      });
    expect(res.status).toBe(202);
    const jobId = res.body.jobId as number;
    jobIds.push(jobId);
    return jobId;
  }

  beforeAll(async () => {
    app = await createTestApp();
    // "/radiology" is the module grant the mount itself demands
    // (`routes/index.ts:787` requireStaffPermission("/radiology")).
    radiologistToken = await makeStaff("use", ["/radiology", "ai_reporting.use"]);
    noAiToken = await makeStaff("noai", ["/radiology"]);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Vitest ProcessNow ${marker}`,
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: `1.2.826.vitest.${marker}`,
        accessionNumber: `ACC-PN-${marker}`,
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;
  });

  afterAll(async () => {
    if (jobIds.length) await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, jobIds));
    if (worklistId) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    if (sessionTokens.length) await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.token, sessionTokens));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  it("a radiologist with ai_reporting.use starts the job instead of waiting for the tick", async () => {
    const jobId = await enqueue(radiologistToken, "use-only");
    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${radiologistToken}`)
      .send({});
    // The refusal this replaced was 403 { ok:false, error:"admin required" }, swallowed by
    // the client, so asserting the status is the whole point: 403 here is the bug back.
    // `ok` is NOT asserted — the engine can answer 200 with ok:false when a provider is
    // unconfigured, which is the same door an admin passes today (see the existing
    // `process-now completes without mutating patient reports` case).
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(res.body.job?.id).toBe(jobId);
    expect(res.body.job?.status).not.toBe("APPLIED");
  });

  it("refuses staff with no AI reporting grant at all, and says what is required", async () => {
    const jobId = await enqueue(radiologistToken, "outsider");
    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${noAiToken}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/AI reporting permission required/);
  });
});
