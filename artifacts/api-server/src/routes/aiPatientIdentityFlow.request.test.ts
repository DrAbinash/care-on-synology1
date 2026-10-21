/**
 * CARE ERP, billing and CARE PACS are ONE system: every patient and every study the
 * AI is allowed to touch has to originate from a bill.
 *
 * WHY THIS FILE EXISTS
 * PR #1109 made the interactive AI doors confirm the STUDY they were asked about. It
 * did not make them confirm the PATIENT. `/query` still read `patientId` out of the
 * body and used it twice: once to fetch that patient's age and sex into the prompt
 * the model reads, and once as the `patient_id` of the audit row. `POST /drafts`
 * stored whatever `patient_id` and `accession_number` the browser sent, and
 * `GET /drafts/:studyInstanceUID` hands those rows to whoever opens the study next.
 * A browser that names a second patient while pointing at the first patient's study
 * therefore got a draft of patient A described as patient B, and an audit row that
 * could not be checked against anything.
 *
 * WHAT THIS FILE RUNS FOR REAL
 * Every hop below is the production route, over HTTP, against PostgreSQL:
 *   Billing   POST /api/billing/save            (the desk's own Save)
 *   Study     the radiology fan-out that call queues (routes/radiology.ts)
 *   PACS      POST /api/internal/radiology/studies  (what the DICOM agent posts when
 *             the modality's study arrives, accessioned with the ERP's accession)
 *   Link      its own auto-link-by-accession, then the stamped UID on the study row
 *   Viewer    GET  /api/radiology/pacs/studies/:uid/ohif-launch
 *   AI        POST /api/ai-reporting/query and /draft against a loopback Ollama and a
 *             loopback DICOMweb that holds frames for exactly one study
 *   Report    POST /api/ai-reporting/drafts then GET /api/ai-reporting/drafts/:uid
 *
 * Substituted: the model and the PACS (both loopback HTTP), and one extra synthetic
 * patient used only as the id a browser is not entitled to name. Everything else —
 * the bill, the study, the worklist row, the UID stamp, the binding, the egress gate,
 * the rows — is the product.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiProviderSettingsTable,
  aiReportingAuditLogsTable,
  aiReportingDraftsTable,
  pacsSettingsTable,
  patientsTable,
  portalSessionsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";
import { seedBillingFixture, type BillingFixture } from "../testSupport/billingFixtures";
import { startMockDicomWeb, type MockDicomWeb } from "../testSupport/mockDicomWeb";

const maybe = hasDatabaseUrl() ? describe : describe.skip;

/** The loopback Ollama, read at call time by the runtime resolver mocked below. */
const local = vi.hoisted(() => ({ baseUrl: "http://127.0.0.1:11434" }));

vi.mock("../lib/aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: async () => ({ ollamaBaseUrl: local.baseUrl, ollamaNumCtx: 8192 }),
}));

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

const MODEL_ANSWER =
  "FINDINGS: The study is technically adequate. No acute intracranial process.\n"
  + "IMPRESSION: No acute intracranial abnormality.";

/** How many attachments a chat body actually carries, so "the pixels went" is a count. */
function imageCountIn(body: unknown): number {
  const b = body as { messages?: Array<{ images?: unknown[] }> } | null;
  let n = 0;
  for (const m of b?.messages ?? []) n += ((m?.images as unknown[]) ?? []).length;
  return n;
}

/** The last text the model was actually sent — where the demographics would be. */
function promptOf(body: unknown): string {
  const b = body as { messages?: Array<{ content?: unknown }> } | null;
  const parts = (b?.messages ?? []).map((m) => (typeof m?.content === "string" ? m.content : ""));
  return parts.join("\n");
}

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

maybe("Billing → Worklist → PACS/OHIF → AI → Report: one patient, one study", () => {
  const marker = `idflow-${randomUUID().slice(0, 8)}`;
  /** Digits and dots only: the AI doors validate a DICOM UID, and a lettered marker
   *  is rejected by zod before any handler runs, which would test the regex instead. */
  const DICOM_UID = `1.2.840.999.${(Date.now() % 100000).toString().padStart(5, "0")}`;
  const SERIES_A = `${DICOM_UID}.10`;
  const SERIES_B = `${DICOM_UID}.11`;
  const OTHER_STUDY_UID = `1.2.840.999.${((Date.now() + 1) % 100000).toString().padStart(5, "0")}`;

  let app: Awaited<ReturnType<typeof import("../testSupport/apiTestApp").createTestApp>>;
  let fx: BillingFixture;
  let pacs: MockDicomWeb;
  let modelServer: Server | null = null;

  let radiologistToken = "";
  let uhid = "";
  let otherPatientId = 0;
  let studyId = 0;
  let accession = "";
  let worklistId = 0;

  /** Every chat the loopback model served, with what it was given. */
  const chats: Array<{ images: number; prompt: string }> = [];

  const auth = () => ({ Authorization: `Bearer ${radiologistToken}` });

  const postQuery = (body: Record<string, unknown>) =>
    request(app).post("/api/ai-reporting/query").set(auth()).send({
      studyInstanceUID: DICOM_UID,
      promptText: "Summarise this examination.",
      provider: "ollama",
      maxImages: 2,
      ...body,
    });

  const postDrafts = (body: Record<string, unknown>) =>
    request(app).post("/api/ai-reporting/drafts").set(auth()).send({
      studyInstanceUID: DICOM_UID,
      provider: "ollama",
      draftText: "Saved from the viewer drawer.",
      ...body,
    });

  async function auditCount(uid: string): Promise<number> {
    const rows = await db
      .select({ id: aiReportingAuditLogsTable.id })
      .from(aiReportingAuditLogsTable)
      .where(eq(aiReportingAuditLogsTable.studyInstanceUID, uid));
    return rows.length;
  }

  async function draftCount(uid: string): Promise<number> {
    const rows = await db
      .select({ id: aiReportingDraftsTable.id })
      .from(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.studyInstanceUID, uid));
    return rows.length;
  }

  async function auditRows(uid: string) {
    return db
      .select({
        patientId: aiReportingAuditLogsTable.patientId,
        accessionNumber: aiReportingAuditLogsTable.accessionNumber,
        studyInstanceUID: aiReportingAuditLogsTable.studyInstanceUID,
        includedDemographics: aiReportingAuditLogsTable.includedDemographics,
        numImages: aiReportingAuditLogsTable.numImages,
        success: aiReportingAuditLogsTable.success,
        promptText: aiReportingAuditLogsTable.promptText,
      })
      .from(aiReportingAuditLogsTable)
      .where(eq(aiReportingAuditLogsTable.studyInstanceUID, uid))
      .orderBy(desc(aiReportingAuditLogsTable.id))
      .limit(4);
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
    await db
      .update(patientsTable)
      .set({ ageValue: 36 })
      .where(eq(patientsTable.id, fx.patientId));

    // The patient a browser is not entitled to name: same clinic, different person,
    // and an age no draft of the first patient may ever carry.
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

    // ── The PACS holds frames for exactly this study ─────────────────────────
    // Two series, one object each: `fetchStudyImages` takes the middle instance of
    // every series as that series' representative frame, so two frames is two
    // series, not two objects in one series.
    pacs = await startMockDicomWeb({
      [DICOM_UID]: {
        [SERIES_A]: [{ sopUid: `${SERIES_A}.1` }],
        [SERIES_B]: [{ sopUid: `${SERIES_B}.1` }],
      },
    });
    await db
      .insert(pacsSettingsTable)
      .values({ key: "orthanc_base_url", category: "orthanc", value: pacs.url });

    // ── A loopback Ollama, because the local arm's transport is by socket ─────
    modelServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          parsed = null;
        }
        const url = req.url ?? "";
        if (url.startsWith("/api/tags")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ models: [{ name: "qwen3-vl:8b" }] }));
          return;
        }
        if (url.startsWith("/api/show")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ capabilities: ["vision", "completion"] }));
          return;
        }
        chats.push({ images: imageCountIn(parsed), prompt: promptOf(parsed) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: "qwen3-vl:8b",
            message: { content: MODEL_ANSWER },
            done: true,
            done_reason: "stop",
            eval_count: 24,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => modelServer!.listen(0, "127.0.0.1", resolve));
    const port = (modelServer!.address() as AddressInfo).port;
    local.baseUrl = `http://127.0.0.1:${port}`;

    const settingsJson = JSON.stringify({
      enabled: true,
      defaultProvider: "ollama",
      aiSecurityMode: "clinical",
      includeDemographics: true,
      anonymize: false,
      allowedRoles: [],
    });
    await db
      .insert(aiProviderSettingsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ provider: "__global__", isEnabled: true, settingsJson } as any);
    await db
      .insert(aiProviderSettingsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ provider: "ollama", isEnabled: true, endpointUrl: local.baseUrl, defaultModel: "qwen3-vl:8b" } as any);
  }, 120_000);

  afterEach(() => {
    chats.length = 0;
    pacs?.setMode("serve");
  });

  afterAll(async () => {
    if (modelServer) await new Promise<void>((resolve) => modelServer!.close(() => resolve()));
    await pacs?.close();
    // Marker-scoped teardown, children first.
    const uids = [DICOM_UID, OTHER_STUDY_UID];
    const drafts = await db
      .select({ id: aiReportingDraftsTable.id })
      .from(aiReportingDraftsTable)
      .where(inArray(aiReportingDraftsTable.studyInstanceUID, uids));
    const auditIds = await db
      .select({ id: aiReportingAuditLogsTable.id })
      .from(aiReportingAuditLogsTable)
      .where(inArray(aiReportingAuditLogsTable.studyInstanceUID, uids));
    if (drafts.length) {
      await db
        .delete(aiReportingDraftsTable)
        .where(inArray(aiReportingDraftsTable.id, drafts.map((d) => d.id)));
    }
    if (auditIds.length) {
      await db
        .delete(aiReportingAuditLogsTable)
        .where(inArray(aiReportingAuditLogsTable.id, auditIds.map((a) => a.id)));
    }
    await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).catch(() => {});
    await db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.key, "orthanc_base_url")).catch(() => {});
    await db.delete(aiProviderSettingsTable).where(inArray(aiProviderSettingsTable.provider, ["__global__", "ollama"])).catch(() => {});
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
    const res = await request(app)
      .get(`/api/radiology/studies/${DICOM_UID}/ohif-launch`)
      .set(auth())
      .query({ worklistId });
    expect(res.status).toBe(200);
    expect(res.body.accessionNumber).toBe(accession);
    expect(res.body.studyInstanceUID).toBe(DICOM_UID);
  });

  it("the AI sends the frames of the bound study and files the ERP patient", async () => {
    // The live viewer drawer's own payload: it sends the UID and the accession it was
    // handed, and no patient id at all.
    const res = await postQuery({ accessionNumber: accession });
    expect(res.status).toBe(200);

    expect(chats).toHaveLength(1);
    expect(chats[0].images).toBe(2);
    const fetched = pacs.hits().filter((h) => h.includes("/rendered"));
    expect(fetched).toHaveLength(2);
    expect(fetched.every((h) => h.includes(DICOM_UID))).toBe(true);

    const rows = await auditRows(DICOM_UID);
    expect(rows[0].patientId).toBe(fx.patientId);
    expect(rows[0].accessionNumber).toBe(accession);
    expect(rows[0].numImages).toBe(2);
  });

  it("the demographics the model sees are the bound study's patient's", async () => {
    const res = await postQuery({});
    expect(res.status).toBe(200);
    expect(chats[0].prompt).toContain("Age: 36");
    expect(chats[0].prompt).not.toContain("Age: 71");

    const rows = await auditRows(DICOM_UID);
    expect(rows[0].includedDemographics).toBe(true);
  });

  it("refuses a browser that names another patient, and sends nothing", async () => {
    // The stand-in PACS records every request it has ever received, and the audit
    // table already holds this study's earlier rows, so what a refusal must not do is
    // measured as a delta: this request added nothing to either log.
    const askedBefore = pacs.hits().length;
    const rowsBefore = await auditCount(DICOM_UID);
    const res = await postQuery({ patientId: otherPatientId });
    expect(res.status).toBe(409);
    expect(String(res.body.code)).toBe("PATIENT_ID_MISMATCH");

    // A refusal that still fetched and still asked is not a refusal.
    expect(pacs.hits()).toHaveLength(askedBefore);
    expect(chats).toHaveLength(0);
    expect(await auditCount(DICOM_UID)).toBe(rowsBefore);
    // And it says who is wrong in terms the radiologist can act on.
    expect(String(res.body.error)).toContain(String(otherPatientId));
    expect(String(res.body.error)).toContain(String(fx.patientId));
  });

  it("still accepts a client that sends the ERP's own patient id", async () => {
    const res = await postQuery({ patientId: fx.patientId });
    expect(res.status).toBe(200);
    expect(chats[0].images).toBe(2);
    const rows = await auditRows(DICOM_UID);
    expect(rows[0].patientId).toBe(fx.patientId);
  });

  it("refuses a study this clinic's billing never produced", async () => {
    // The Orthanc-only case the owner ruled out: a well-formed DICOM UID with no
    // ERP study and no worklist row behind it.
    const res = await postQuery({ studyInstanceUID: OTHER_STUDY_UID });
    expect(res.status).toBe(400);
    expect(String(res.body.code)).toBe("STUDY_NOT_IN_CLINIC");
    expect(chats).toHaveLength(0);
    expect(await auditRows(OTHER_STUDY_UID)).toHaveLength(0);
  });

  it("saves the draft under the ERP identity, never the browser's labels", async () => {
    const res = await postDrafts({
      accessionNumber: "WRONG-ACCESSION-FROM-THE-BROWSER",
      aiResponse: MODEL_ANSWER,
    });
    expect(res.status).toBe(200);

    const rows = await draftRows(DICOM_UID);
    expect(rows).toHaveLength(1);
    expect(rows[0].accessionNumber).toBe(accession);
    expect(rows[0].patientId).toBe(fx.patientId);

    // What the next person to open the study is handed back.
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
  });

  it("refuses to save a draft against a study the clinic does not have", async () => {
    const before = await draftCount(OTHER_STUDY_UID);
    const res = await postDrafts({ studyInstanceUID: OTHER_STUDY_UID });
    expect(res.status).toBe(400);
    expect(String(res.body.code)).toBe("STUDY_NOT_IN_CLINIC");
    expect(await draftCount(OTHER_STUDY_UID)).toBe(before);
  });
});
