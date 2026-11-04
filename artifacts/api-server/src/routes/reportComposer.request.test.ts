/**
 * Request-level smoke for report composer routes (DB optional — skips if unset).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
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
import { randomUUID } from "node:crypto";
import {
  getComposeJob,
  processComposeJob,
  publicJobView,
} from "../lib/reportComposer/jobService";

describe.skipIf(!hasDatabaseUrl())("report composer routes", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  let worklistId = 0;
  const jobIds: number[] = [];
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
    // A compose job now has to name a study the server can resolve, so the
    // smoke cases need a real worklist row rather than a null reference.
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Vitest Composer ${marker}`,
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: `1.2.826.vitest.${marker}.route`,
        accessionNumber: `ACC-ROUTE-${marker}`,
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;
  });

  afterAll(async () => {
    if (jobIds.length) await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, jobIds));
    if (worklistId) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("POST /jobs returns 202 with jobId without waiting for model", async () => {
    const snapshot = {
      worklistId,
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
    // Exact status: this suite used to accept 202/400/403/500, so it stayed
    // green while every request was being refused.
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTypeOf("number");
    expect(res.body.status).toBe("QUEUED");
    jobIds.push(res.body.jobId as number);
  });

  it(
    "POST /test is PHI-safe synthetic",
    async () => {
      const res = await request(app)
        .post("/api/radiology/report-composer/test")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect([200, 403, 500]).toContain(res.status);
      if (res.status === 200) {
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(/patientName|Abinash|phone/i);
        expect(res.body.compose).toBeTruthy();
        expect(res.body.writesClinicalReport).toBe(false);
      }
    },
    60_000,
  );

  it(
    "POST /test returns displayStatus and never writes clinical report",
    async () => {
      const res = await request(app)
        .post("/api/radiology/report-composer/test")
        .set("Authorization", `Bearer ${token}`)
        .send({
          studyType: "MRI LS Spine",
          region: "LS_SPINE",
          modality: "MR",
          observationsText: "Loss of lumbar lordosis.\nDisc desiccation at L4-5.",
        });
      expect([200, 403, 500]).toContain(res.status);
      if (res.status !== 200) return;
      expect(res.body.writesClinicalReport).toBe(false);
      expect(["LOCAL_AI_SUCCESS", "CLOUD_AI_SUCCESS", "FALLBACK_DRAFT", "FAILED", "OTHER"]).toContain(
        res.body.compose?.displayStatus,
      );
      if (res.body.compose?.displayStatus === "FALLBACK_DRAFT") {
        expect(res.body.compose.fallbackUsed === true || res.body.compose.model === "deterministic").toBe(
          true,
        );
        expect(res.body.compose.userMessage).toMatch(/Local AI was not used/i);
        expect(res.body.compose.personaLoaded).toBe(false);
      }
      if (res.body.compose?.displayStatus === "LOCAL_AI_SUCCESS") {
        expect(res.body.compose.fallbackUsed).toBe(false);
        expect(res.body.compose.model).not.toBe("deterministic");
        expect(res.body.compose.ollamaCalled).toBe(true);
        expect(res.body.compose.personaLoaded).toBe(true);
      }
    },
    60_000,
  );

  it("GET /diagnostics exposes DeepSeek official-API status and defaultProvider=ollama", async () => {
    const res = await request(app)
      .get("/api/radiology/report-composer/diagnostics")
      .set("Authorization", `Bearer ${token}`);
    expect([200, 403, 500]).toContain(res.status);
    if (res.status !== 200) return;
    expect(res.body.composer?.transport).toBe("ollama");
    expect(res.body.composer?.defaultProvider).toBe("ollama");
    expect(typeof res.body.composer?.deepSeekConfigured).toBe("boolean");
    expect(typeof res.body.composer?.qwenConfigured).toBe("boolean");
    expect(typeof res.body.composer?.openaiConfigured).toBe("boolean");
    expect(String(res.body.composer?.deepSeekNote ?? "")).toMatch(/DeepSeek|Ollama|DEEPSEEK_API_KEY/i);
    expect(res.body.composer?.deepSeekTextModel).toBeTruthy();
    expect(Array.isArray(res.body.aiProviders)).toBe(true);
    expect(Array.isArray(res.body.models)).toBe(true);
    // Secrets must never appear
    expect(JSON.stringify(res.body)).not.toMatch(/sk-[a-zA-Z0-9]{8,}/);
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
      worklistId,
      modality: "MR",
      region: "LS_SPINE",
    };
    const enq = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ snapshot, jobKind: "FULL_REPORT" });
    // An early `return` on a non-202 here once let the whole case run zero
    // assertions; the enqueue is now pinned, so the checks below are reached.
    expect(enq.status).toBe(202);
    const jobId = enq.body.jobId as number;
    jobIds.push(jobId);
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

/**
 * PER-JOB REFERENCE-KNOWLEDGE OVERRIDE at runtime, for the two classes of staff account.
 *
 * This is the arm #1266 never had: every case in the suite above signs in as an `admin` whose
 * permission list holds BOTH `ai_reporting.use` and `ai_reporting.configure`, so the unauthorized
 * branch of `canOverrideReferenceKnowledge` (`routes/reportComposer.ts:154`) has never been
 * executed by a request. The only other coverage was `knowledgeStatusIsReported.test.ts`, which
 * reads the route's source text — green while the endpoint was unreachable, is what that class of
 * test buys. These cases go through the real router over supertest and then read the row back,
 * because the answer to "was this report composed with reference knowledge off, and who asked for
 * it" is a fact about the persisted job, not about a response body.
 */
describe.skipIf(!hasDatabaseUrl())("report composer — per-job reference-knowledge authorization", () => {
  let app: Express;
  let configuredToken = "";
  let useOnlyToken = "";
  const userIds: number[] = [];
  const sessionTokens: string[] = [];
  const jobIds: number[] = [];
  let worklistId = 0;
  const marker = `vitest-rag-${randomUUID().slice(0, 8)}`;

  async function makeStaff(label: string, permissions: string[]): Promise<string> {
    const token = `vitest-rag-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Vitest RAG ${marker}`,
        // A `radiologist` role, not `admin`: FULL_ACCESS_ROLES authorizes by role alone, so an
        // admin session proves nothing about the grant being tested.
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

  function snapshot(tag: string) {
    return {
      worklistId,
      studyId: null,
      // Unique per arm: `enqueueComposeJob` dedupes a double-submit over the SAME frozen input
      // (worklist + report revision + input hash + jobKind) and answers with the job already
      // queued — including the reference-knowledge envelope THAT row carries. Five identical
      // snapshots here would therefore have tested one job five times, and every arm below
      // would have reported the first arm's decision.
      findings: `No significant disc bulge. ${tag}`,
      impression: "",
      recommendation: "",
      clinicalHistory: "",
      technique: "MRI LS Spine",
      modality: "MR",
      region: "LS_SPINE",
      observations: [{ concept: "bulge", source: "quick-select", level: "L4-L5", findingsText: `L4-5 diffuse disc bulge ${tag}`, baselineReplaces: "No significant disc bulge." }],
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    // "/radiology" is the module grant the mount itself demands
    // (`routes/index.ts:771` `requireStaffPermission("/radiology")`); the AI grants are what
    // `canUse` / `canOverrideReferenceKnowledge` read. An account with only the AI strings is
    // refused by the module gate and never reaches the code under test.
    configuredToken = await makeStaff("configured", ["/radiology", "ai_reporting.use", "ai_reporting.configure"]);
    useOnlyToken = await makeStaff("useonly", ["/radiology", "ai_reporting.use"]);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Vitest RAG ${marker}`,
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: `1.2.826.vitest.${marker}.rag`,
        accessionNumber: `ACC-RAG-${marker}`,
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

  async function rowOf(jobId: number) {
    const [row] = await db
      .select({
        status: aiReportComposeJobsTable.status,
        validationJson: aiReportComposeJobsTable.validationJson,
      })
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, jobId))
      .limit(1);
    return row;
  }

  it("granted staff: the override is honoured, and the queued row carries it", async () => {
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${configuredToken}`)
      .send({ snapshot: snapshot("arm-honoured"), jobKind: "FULL_REPORT", ragOverride: "off" });
    expect(res.status).toBe(202);
    jobIds.push(res.body.jobId as number);
    expect(res.body.ragOverride).toMatchObject({
      requested: "off", effective: "off", honoured: true, ignoredReason: null,
    });
    expect(JSON.parse((await rowOf(res.body.jobId as number)).validationJson ?? "").ragOverride)
      .toMatchObject({ requested: "off", effective: "off", honoured: true });
  });

  it("staff without the AI-configuration grant: composed anyway, and the row says it was refused", async () => {
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${useOnlyToken}`)
      .send({ snapshot: snapshot("arm-refused"), jobKind: "FULL_REPORT", ragOverride: "off" });
    // Not 403: an experimental field never gets to fail a clinical request.
    expect(res.status).toBe(202);
    jobIds.push(res.body.jobId as number);
    expect(res.body.status).toBe("QUEUED");
    expect(res.body.ragOverride).toMatchObject({
      requested: "off", effective: "default", honoured: false, ignoredReason: "not authorized",
    });
    expect(JSON.parse((await rowOf(res.body.jobId as number)).validationJson ?? "").ragOverride)
      .toMatchObject({ effective: "default", honoured: false, ignoredReason: "not authorized" });
  });

  it("an unrecognized word is recorded as ignored, not as an error", async () => {
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${configuredToken}`)
      .send({ snapshot: snapshot("arm-unrecognized"), jobKind: "FULL_REPORT", ragOverride: "sometimes" });
    expect(res.status).toBe(202);
    jobIds.push(res.body.jobId as number);
    expect(res.body.ragOverride).toMatchObject({
      requested: "sometimes", effective: "default", honoured: false, ignoredReason: "unrecognized",
    });
  });

  it("nothing requested: the row is written exactly as it was before this field existed", async () => {
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${useOnlyToken}`)
      .send({ snapshot: snapshot("arm-absent"), jobKind: "FULL_REPORT" });
    expect(res.status).toBe(202);
    jobIds.push(res.body.jobId as number);
    expect(res.body.ragOverride).toBeUndefined();
    expect((await rowOf(res.body.jobId as number)).validationJson).toBeNull();
  });

  it("a failed job keeps the decision, and a second claim of the same row does not lose it", async () => {
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${configuredToken}`)
      .send({ snapshot: snapshot("arm-failed"), jobKind: "FULL_REPORT", ragOverride: "off" });
    expect(res.status).toBe(202);
    const jobId = res.body.jobId as number;
    jobIds.push(jobId);
    // A deterministic failure that needs no model: the frozen snapshot is unreadable, so the
    // worker fails the job before it composes anything — the path that used to write
    // `validation_json` as NULL and take the override request with it.
    await db
      .update(aiReportComposeJobsTable)
      .set({ inputSnapshotJson: "{ not json" })
      .where(eq(aiReportComposeJobsTable.id, jobId));

    const first = await processComposeJob(jobId);
    expect(first.ok).toBe(false);
    expect(first.detail).toBe("bad_stored_snapshot");
    const afterFail = await rowOf(jobId);
    expect(afterFail.status).toBe("FAILED");
    expect(JSON.parse(afterFail.validationJson ?? "").ragOverride).toMatchObject({
      requested: "off", effective: "off", honoured: true,
    });

    // Retry the same row: it is not claimable, and the record of what was asked is still there.
    // (Whether a FAILED compose row SHOULD be re-runnable is a separate decision — this case only
    // pins that the override does not vanish in the meantime.)
    const again = await processComposeJob(jobId);
    expect(again.detail).toMatch(/not claimable \(FAILED\)/);
    expect(JSON.parse((await rowOf(jobId)).validationJson ?? "").ragOverride).toMatchObject({
      requested: "off", effective: "off", honoured: true,
    });
  });

  it("the job the radiologist reads back still names the mode it ran in", async () => {
    const res = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${configuredToken}`)
      .send({ snapshot: snapshot("arm-view"), jobKind: "FULL_REPORT", ragOverride: "off" });
    expect(res.status).toBe(202);
    const jobId = res.body.jobId as number;
    jobIds.push(jobId);
    // The view behind GET /jobs/:id — what the review panel and any later audit read sees.
    const view = publicJobView(await getComposeJob(jobId)!);
    expect((view.validation as { ragOverride?: { effective?: string; honoured?: boolean } })
      ?.ragOverride).toMatchObject({ effective: "off", honoured: true });
  });
});
