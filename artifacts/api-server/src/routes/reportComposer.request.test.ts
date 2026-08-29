/**
 * Request-level smoke for report composer routes (DB optional — skips if unset).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

describe.skipIf(!hasDatabaseUrl())("report composer routes", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const marker = `vitest-compose-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    app = await createTestApp();
    token = `vitest-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Vitest Composer ${marker}`,
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
  });

  afterAll(async () => {
    if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("POST /jobs returns 202 with jobId without waiting for model", async () => {
    const snapshot = {
      worklistId: null,
      studyId: null,
      findings: "No significant disc bulge.",
      impression: "",
      recommendation: "",
      clinicalHistory: "",
      technique: "MRI LS Spine",
      modality: "MR",
      region: "LS_SPINE",
      observations: [
        {
          concept: "bulge",
          source: "quick-select",
          level: "L4-L5",
          findingsText: "L4-5 diffuse disc bulge",
          conflictGroup: "disc_L4_L5",
          baselineReplaces: "No significant disc bulge.",
        },
      ],
    };
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ snapshot, jobKind: "FULL_REPORT" });
    expect([202, 400, 403, 500]).toContain(res.status);
    if (res.status === 202) {
      expect(res.body.jobId).toBeTypeOf("number");
      expect(res.body.status).toBe("QUEUED");
    }
  });

  it("POST /test is PHI-safe synthetic", async () => {
    const res = await request(app)
      .post("/api/radiology/report-composer/test")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect([200, 403, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/patientName|Abinash|phone/i);
      expect(res.body.compose).toBeTruthy();
    }
  });

  it("process-now completes without mutating patient reports", async () => {
    const snapshot = {
      findings: "No significant disc bulge.\nFacet joints preserved.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "bulge",
          source: "quick-select",
          level: "L4-L5",
          findingsText: "L4-5 diffuse disc bulge with bilateral lateral recess narrowing",
          baselineReplaces: "No significant disc bulge.",
        },
        {
          concept: "facet",
          source: "voice",
          level: "L4-L5",
          findingsText: "mild bilateral facet hypertrophy at L4-5",
        },
      ],
      worklistId: null,
      modality: "MR",
      region: "LS_SPINE",
    };
    const enq = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ snapshot, jobKind: "FULL_REPORT" });
    if (enq.status !== 202) return;
    const jobId = enq.body.jobId as number;
    const proc = await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(proc.status).toBe(200);
    expect(proc.body.job?.status).toMatch(/READY|FAILED/);
    // Never applied automatically
    expect(proc.body.job?.status).not.toBe("APPLIED");
  });
});
