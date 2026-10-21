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
 *   Billing   POST /api/billing/save              (the desk's own Save)
 *   Study     the radiology fan-out that call queues (routes/radiology.ts)
 *   PACS      POST /api/internal/radiology/studies  (what the DICOM agent posts when
 *             the modality's study arrives, accessioned with the ERP's accession)
 *   Link      its own auto-link by accession, which stamps the UID on the study row
 *   Viewer    GET  /api/radiology/studies/:uid/ohif-launch
 *   AI        POST /api/ai-reporting/query against a loopback Ollama
 *   Report    POST /api/ai-reporting/drafts then GET /api/ai-reporting/drafts/:uid
 *
 * Substituted: the model (loopback HTTP), and one extra synthetic patient used only as
 * the id a browser is not entitled to name. Everything else — the bill, the study, the
 * worklist row, the UID stamp, the binding, the rows — is the product.
 *
 * WHY THESE REQUESTS ASK FOR NO IMAGES
 * The Orthanc base URL is ONE row in `pacs_settings`, and
 * `aiReporting.imageEgress.request.test.ts` already owns it with its own stand-in. A
 * second file writing that row makes the two fight over the same singleton (measured:
 * one file's insert fails on the key and the other's fetch then goes to a server that
 * has no such study). Which study's frames a bound request may fetch, and that a refusal
 * fetches none, is pinned there — TEST 14 to 14h, over a real DICOMweb. What is pinned
 * HERE is whose patient, whose accession and whose record.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

/** The loopback Ollama, read at call time by the runtime resolver mocked below. */
const local = vi.hoisted(() => ({ baseUrl: "http://127.0.0.1:11434" }));

vi.mock("../lib/aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: async () => ({ ollamaBaseUrl: local.baseUrl, ollamaNumCtx: 8192 }),
}));

const MODEL_ANSWER =
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

maybe("Billing → Worklist → PACS/OHIF → AI → Report: one patient, one study", () => {
  const marker = `idflow-${randomUUID().slice(0, 8)}`;
  /** Digits and dots only: the AI doors validate a DICOM UID, and a lettered marker
   *  is rejected by zod before any handler runs, which would test the regex instead. */
  const DICOM_UID = `1.2.840.999.${(Date.now() % 100000).toString().padStart(5, "0")}`;
  const OTHER_STUDY_UID = `1.2.840.999.${((Date.now() + 1) % 100000).toString().padStart(5, "0")}`;

  let app: Awaited<ReturnType<typeof import("../testSupport/apiTestApp").createTestApp>>;
  let fx: BillingFixture;
  let modelServer: Server | null = null;

  let radiologistToken = "";
  let uhid = "";
  let otherPatientId = 0;
  let studyId = 0;
  let accession = "";
  let worklistId = 0;

  const auth = () => ({ Authorization: `Bearer ${radiologistToken}` });

  /**
   * `maxImages: 0` everywhere: the Orthanc base URL is one row in `pacs_settings`, so a
   * second file pointing it at its own stand-in would move it out from under the suite
   * that already owns it (measured, not theorised — see the file header). Which study's
   * frames a bound request may fetch is pinned in
   * `aiReporting.imageEgress.request.test.ts` TEST 14–14h, over a real DICOMweb.
   */
  const postQuery = (body: Record<string, unknown>) =>
    request(app).post("/api/ai-reporting/query").set(auth()).send({
      studyInstanceUID: DICOM_UID,
      promptText: "Summarise this examination.",
      provider: "ollama",
      maxImages: 0,
      ...body,
    });

  const postDrafts = (body: Record<string, unknown>) =>
    request(app).post("/api/ai-reporting/drafts").set(auth()).send({
      studyInstanceUID: DICOM_UID,
      provider: "ollama",
      draftText: "Saved from the viewer drawer.",
      ...body,
    });

  /** What each shared provider row held before this file touched it. */
  const prior: Array<{ provider: string; values: Record<string, unknown> | null }> = [];

  async function takeProvider(provider: string, values: Record<string, unknown>): Promise<void> {
    const [existing] = await db
      .select()
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, provider))
      .limit(1);
    prior.push({
      provider,
      values: existing
        ? {
            settingsJson: existing.settingsJson,
            endpointUrl: existing.endpointUrl,
            defaultModel: existing.defaultModel,
            isEnabled: existing.isEnabled,
          }
        : null,
    });
    if (existing) {
      await db
        .update(aiProviderSettingsTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ isEnabled: true, ...values } as any)
        .where(eq(aiProviderSettingsTable.id, existing.id));
      return;
    }
    await db
      .insert(aiProviderSettingsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ provider, isEnabled: true, ...values } as any);
  }

  async function putProviderBack(): Promise<void> {
    for (const entry of prior) {
      if (entry.values) {
        await db
          .update(aiProviderSettingsTable)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .set(entry.values as any)
          .where(eq(aiProviderSettingsTable.provider, entry.provider))
          .catch(() => {});
      } else {
        await db
          .delete(aiProviderSettingsTable)
          .where(eq(aiProviderSettingsTable.provider, entry.provider))
          .catch(() => {});
      }
    }
  }

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

    // ── A loopback Ollama, because the local arm's transport is by socket ─────
    // It answers and keeps nothing: what the model was actually SENT is asserted from
    // the audit row's own `promptText`, so the identity claim does not rest on a recorder
    // of mine that could differ from what the product sent.
    modelServer = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        const reply = (payload: unknown) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        const url = req.url ?? "";
        if (url.startsWith("/api/tags")) {
          reply({ models: [{ name: "qwen3-vl:8b" }] });
          return;
        }
        if (url.startsWith("/api/show")) {
          reply({ capabilities: ["vision", "completion"] });
          return;
        }
        reply({
          model: "qwen3-vl:8b",
          message: { content: MODEL_ANSWER },
          done: true,
          done_reason: "stop",
          eval_count: 24,
        });
      });
    });
    await new Promise<void>((resolve) => modelServer!.listen(0, "127.0.0.1", resolve));
    const port = (modelServer!.address() as AddressInfo).port;
    local.baseUrl = `http://127.0.0.1:${port}`;

    // `includeDemographics: true` is the clinic's own setting, and this file asks what
    // the model was actually given — the request itself never supplies a patient. The two
    // demographics cases ALSO pass the flag in their body, because the `__global__` row
    // this file takes is shared and a neighbour suite can put its own values back while
    // this one is running; a request that states what it wants is not at the mercy of
    // that.
    const settingsJson = JSON.stringify({
      enabled: true,
      defaultProvider: "ollama",
      aiSecurityMode: "clinical",
      includeDemographics: true,
      anonymize: false,
      allowedRoles: [],
    });
    // ── AI settings, taken up rather than stamped over ────────────────────────
    // `__global__` and `ollama` are single rows shared by every AI suite that runs
    // against this database. Inserting them a second time collides, and deleting them on
    // the way out leaves a neighbour reading "provider disabled or not configured" — so
    // the columns this file needs are captured first and put back at the end, and only a
    // row this file created is ever removed.
    await takeProvider("__global__", { settingsJson });
    await takeProvider("ollama", {
      endpointUrl: local.baseUrl,
      defaultModel: "qwen3-vl:8b",
    });
  }, 120_000);

  afterAll(async () => {
    if (modelServer) await new Promise<void>((resolve) => modelServer!.close(() => resolve()));
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
    await putProviderBack();
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

  it("the AI answers the bound study and files it under the ERP patient", async () => {
    // The live viewer drawer's own payload: it sends the UID and the accession it was
    // handed, and no patient id at all. Whose patient that is comes from the clinic's
    // row — which is what this asserts, so the audit record can be checked against the
    // bill it came from.
    const rowsBefore = await auditCount(DICOM_UID);
    const res = await postQuery({ accessionNumber: accession });
    expect(res.status).toBe(200);

    // That the loopback model was reached is read off the wire rather than off a recorder
    // of mine: this answer text exists nowhere else.
    expect(String(res.body.aiResponse)).toContain("No acute intracranial");
    expect(res.body.numImages).toBe(0);

    expect(await auditCount(DICOM_UID)).toBe(rowsBefore + 1);
    const rows = await auditRows(DICOM_UID);
    expect(rows[0].patientId).toBe(fx.patientId);
    expect(rows[0].accessionNumber).toBe(accession);
    expect(rows[0].numImages).toBe(0);
  });

  it("the demographics the model sees are the bound study's patient's", async () => {
    // The request names no patient, so the only patient this can be about is the one the
    // study belongs to. On main the demographics silently did not happen at all: the
    // branch waited for an id the viewer has never sent.
    //
    // `includeDemographics`/`anonymize` are stated here rather than left to the shared
    // `__global__` row, which another AI suite owns and rewrites while this file runs.
    const res = await postQuery({ includeDemographics: true, anonymize: false });
    expect(res.status).toBe(200);

    // Read from the product's own audit column: `promptText` is the assembled prompt, so
    // this is the sentence the model was given, not my copy of it.
    const rows = await auditRows(DICOM_UID);
    expect(String(rows[0].promptText)).toContain("Age: 36");
    expect(String(rows[0].promptText)).not.toContain("Age: 71");
    expect(rows[0].includedDemographics).toBe(true);
  });

  it("refuses a browser that names another patient, and records nothing", async () => {
    // The audit table already holds this study's earlier rows, so what a refusal must
    // not do is measured as a delta: this request added nothing to the record, and the
    // door closes before any provider call — a send that happened would have filed a row.
    const rowsBefore = await auditCount(DICOM_UID);
    const res = await postQuery({ patientId: otherPatientId });
    expect(res.status).toBe(409);
    expect(String(res.body.code)).toBe("PATIENT_ID_MISMATCH");
    expect(await auditCount(DICOM_UID)).toBe(rowsBefore);

    // And it names both ids, so the radiologist can see which one the clinic disagrees
    // with rather than being told something failed.
    expect(String(res.body.error)).toContain(String(otherPatientId));
    expect(String(res.body.error)).toContain(String(fx.patientId));
  });

  it("still accepts a client that sends the ERP's own patient id", async () => {
    // API compatibility: a caller that repeats the clinic's answer is not punished for
    // it. `aiReportingClient` still types the field, and a screen that sends it must go
    // on working.
    const res = await postQuery({ patientId: fx.patientId });
    expect(res.status).toBe(200);
    expect(String(res.body.aiResponse)).toContain("No acute intracranial");
    const rows = await auditRows(DICOM_UID);
    expect(rows[0].patientId).toBe(fx.patientId);
  });

  it("refuses a study this clinic's billing never produced", async () => {
    // The Orthanc-only case the owner ruled out: a well-formed DICOM UID with no
    // ERP study and no worklist row behind it.
    const res = await postQuery({ studyInstanceUID: OTHER_STUDY_UID });
    expect(res.status).toBe(400);
    expect(String(res.body.code)).toBe("STUDY_NOT_IN_CLINIC");
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
