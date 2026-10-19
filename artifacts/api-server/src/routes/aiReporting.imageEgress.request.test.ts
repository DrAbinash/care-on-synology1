/**
 * PR-A2B — the interactive image routes ask the clinic, not the browser.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS SHAPED LIKE THIS
 * The defect was a missing hand-off, not a wrong rule. `/draft`, `/query`,
 * `/image-review` and `/api/ai-comparison/run` all reached `generateAiResponse`
 * without the clinic's resolved egress policy, and `assertCloudImageEgress` DENIES
 * on a missing term — so Development mode with cloud vision switched on in Settings
 * still refused every pixel, while the Settings screen looked like a control.
 *
 * A test that mocks `@workspace/ai-providers` cannot see that class of bug: the mock
 * answers whatever it is handed, so a term that never arrives is never missed.
 * Every case below runs the REAL provider layer — the real `assertCloudImageEgress`,
 * the real mode resolver, a real PostgreSQL row for each stored setting, and either a
 * real loopback HTTP server standing in for the clinic's Ollama or a recorded `fetch`
 * standing in for a cloud vendor.
 *
 * Substituted: Orthanc's DICOMweb responses (this file is about egress, not PACS),
 * the cloud vendor's socket, and `resolveLocalAiRuntime` (so no case depends on a
 * Docker network). NEVER substituted: the security mode, the cloud-vision opt-in,
 * the image gate, or endpoint-derived locality.
 *
 * One arm cannot be reached from an HTTP request: `resolveAiSecurityPolicy()`'s
 * `modeReadFailed` path needs the database itself to fail. It is pinned against a
 * throwing reader in `lib/ai/aiSecurityPolicy.test.ts`; what THIS file pins is the
 * sibling failure — a stored cloud-vision blob that cannot be read, which must also
 * refuse. A skip is not a pass: the suite needs DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiPromptTemplatesTable,
  aiProviderSettingsTable,
  aiReportingAuditLogsTable,
  aiReportingDraftsTable,
  aiSchedulerConfigTable,
  pacsSettingsTable,
  portalSessionsTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";
import { saveOvernightOpsControls } from "../lib/ai/clinicalConfigService";
import { resetOllamaRuntimeEndpointResolverForTests } from "@workspace/ai-providers";

const maybe = hasDatabaseUrl() ? describe : describe.skip;

/** The loopback Ollama stand-in, read at call time by the mock below. */
const local = vi.hoisted(() => ({ baseUrl: "http://127.0.0.1:11434" }));

vi.mock("../lib/aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: async () => ({
    ollamaBaseUrl: local.baseUrl,
    ollamaNumCtx: 8192,
  }),
}));

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

const MODEL_ANSWER =
  "FINDINGS: The study is technically adequate. No acute intracranial process.\n"
  + "IMPRESSION: No acute intracranial abnormality.";

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** One answer per wire format, so the real adapter parses it and attributes itself. */
function modelAnswerFor(url: string) {
  if (url.includes("/api/chat")) {
    return json({
      model: "qwen3-vl:8b",
      message: { content: MODEL_ANSWER },
      done: true,
      done_reason: "stop",
      eval_count: 24,
    });
  }
  return json({
    choices: [{ message: { role: "assistant", content: MODEL_ANSWER }, finish_reason: "stop" }],
    usage: { total_tokens: 40 },
  });
}

/**
 * How many attachments a recorded request body actually carries.
 *
 * Both wire formats are counted because both arms run for real here: Ollama's
 * `/api/chat` puts them on `messages[].images`, an OpenAI-wire vendor puts
 * `image_url` parts inside `messages[].content`. A helper that understood only one
 * would read a real send as an empty one and quietly turn "the pixels went out" into
 * "no assertion at all".
 */
function imageCountIn(body: unknown): number {
  const b = body as {
    messages?: Array<{
      images?: unknown[];
      content?: unknown;
    }>;
    images?: unknown[];
  } | null;
  let n = ((b?.images as unknown[]) ?? []).length;
  for (const m of b?.messages ?? []) {
    n += ((m?.images as unknown[]) ?? []).length;
    const parts = Array.isArray(m?.content) ? (m.content as Array<Record<string, unknown>>) : [];
    n += parts.filter((p) => p && typeof p === "object" && (p.type === "image_url" || p.image_url)).length;
  }
  return n;
}

maybe("interactive image egress — real routes, real gate, stored settings (HTTP + DB)", () => {
  const marker = `a2b-${randomUUID().slice(0, 8)}`;
  const STUDY = `1.2.840.111.${Date.now() % 1000000}`;
  const CLOUD_HOST = "api.deepseek.com";
  const PUBLIC_LABELLED_HOST = "public-model.vitest.invalid";

  let app: Awaited<ReturnType<typeof import("../testSupport/apiTestApp").createTestApp>>;
  let token = "";
  let staffLabel = "";
  let userId = 0;
  let worklistId = 0;
  let localServer: Server | null = null;
  let localPort = 0;
  const localChats: Array<{ images: number; path: string }> = [];
  const outbound: Array<{ url: string; images: number }> = [];
  const savedEnvKey = process.env.DEEPSEEK_API_KEY;
  const realFetch = globalThis.fetch;

  async function setGlobal(patch: Record<string, unknown>): Promise<void> {
    const settingsJson = JSON.stringify({
      enabled: true,
      defaultProvider: "ollama",
      aiSecurityMode: "clinical",
      ...patch,
    });
    const [row] = await db
      .select({ id: aiProviderSettingsTable.id })
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, "__global__"))
      .limit(1);
    if (row) {
      await db
        .update(aiProviderSettingsTable)
        .set({ settingsJson })
        .where(eq(aiProviderSettingsTable.id, row.id));
    } else {
      await db
        .insert(aiProviderSettingsTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ provider: "__global__", isEnabled: true, settingsJson } as any);
    }
  }

  async function upsertProvider(provider: string, values: Record<string, unknown>) {
    const [row] = await db
      .select({ id: aiProviderSettingsTable.id })
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, provider))
      .limit(1);
    if (row) {
      await db
        .update(aiProviderSettingsTable)
        .set(values as Partial<typeof aiProviderSettingsTable.$inferInsert>)
        .where(eq(aiProviderSettingsTable.id, row.id));
    } else {
      await db
        .insert(aiProviderSettingsTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ provider, isEnabled: true, ...values } as any);
    }
  }

  type AuditRow = {
    endpointLocality: string | null;
    imageSourceTypes: string | null;
    provider: string;
    numImages: number | null;
    success: boolean | null;
    correlationId: string | null;
    userId: number | null;
  };

  const AUDIT_COLS = {
    endpointLocality: aiReportingAuditLogsTable.endpointLocality,
    imageSourceTypes: aiReportingAuditLogsTable.imageSourceTypes,
    provider: aiReportingAuditLogsTable.provider,
    numImages: aiReportingAuditLogsTable.numImages,
    success: aiReportingAuditLogsTable.success,
    correlationId: aiReportingAuditLogsTable.correlationId,
    userId: aiReportingAuditLogsTable.userId,
  };

  async function auditRows(): Promise<AuditRow[]> {
    return db
      .select(AUDIT_COLS)
      .from(aiReportingAuditLogsTable)
      .where(eq(aiReportingAuditLogsTable.studyInstanceUID, STUDY))
      .orderBy(desc(aiReportingAuditLogsTable.id))
      .limit(6);
  }

  /**
   * Rows for the same person rather than the same study, because `/run` compares
   * providers for a caller who has no study row — it files `numImages` and a
   * locality, and no UID. Reading back what the route actually wrote is the only
   * way to pin that both arms of one comparison were recorded on their own terms.
   */
  async function auditRowsByUser(limit = 4): Promise<AuditRow[]> {
    return db
      .select(AUDIT_COLS)
      .from(aiReportingAuditLogsTable)
      .where(eq(aiReportingAuditLogsTable.userName, staffLabel))
      .orderBy(desc(aiReportingAuditLogsTable.id))
      .limit(limit);
  }

  const postDraft = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/ai-reporting/draft")
      .set("Authorization", `Bearer ${token}`)
      .send({
        worklistId,
        modality: "MR",
        studyDescription: "MRI Brain",
        reportBody: "Findings supplied by the radiologist for this test.",
        ...body,
      });

  const postQuery = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/ai-reporting/query")
      .set("Authorization", `Bearer ${token}`)
      .send({ studyInstanceUID: STUDY, promptText: "Summarise this examination.", ...body });

  const postCompare = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/ai-comparison/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Describe this examination.", providers: ["ollama"], ...body });

  beforeAll(async () => {
    // `bootstrapLocalAi` binds a clinic-runtime resolver into the provider layer in
    // the running server. Without that binding the local arm resolves the endpoint
    // from this test's own runtime mock, which is the path under test here.
    resetOllamaRuntimeEndpointResolverForTests();

    const { createTestApp } = await import("../testSupport/apiTestApp");
    app = await createTestApp();

    // A real loopback model, because the local arm's transport is the DNS-pinned one:
    // it speaks over sockets, so a fetch stub could never observe it. Same shape as
    // `hardenedTransport.test.ts`.
    localServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          /* not JSON — still counted as a delivery */
        }
        localChats.push({ images: imageCountIn(parsed), path: req.url ?? "" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          model: "qwen3-vl:8b",
          message: { content: MODEL_ANSWER },
          done: true,
          done_reason: "stop",
          eval_count: 24,
        }));
      });
    });
    await new Promise<void>((resolve) => localServer!.listen(0, "127.0.0.1", resolve));
    localPort = (localServer!.address() as AddressInfo).port;
    local.baseUrl = `http://127.0.0.1:${localPort}`;

    staffLabel = `${marker}-staff`;
    const label = staffLabel;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: label,
        email: `${label}@vitest.invalid`,
        username: label,
        role: "doctor",
        // What a reporting clinician's session actually carries: the AI-use
        // permission, plus the `/radiology` namespace permission the worklist routers
        // gate on (the Composer mounts live under that prefix).
        permissions: JSON.stringify(["ai_reporting.use", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    token = `vitest-a2b-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: userId,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `${marker} Synthetic`,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyInstanceUID: STUDY,
        accessionNumber: `${marker}-ACC`,
        studyUidProvenance: "verified",
        patientMatchStatus: "UNMATCHED",
      })
      .returning({ id: radiologyWorklistTable.id });
    worklistId = wl.id;

    // The prompt is pinned so nothing in a seeded template can trip the TEXT PHI
    // detector and turn an image-egress assertion into a text one.
    await db.insert(aiPromptTemplatesTable).values({
      name: "MRI Brain",
      modality: "MR",
      promptContent: "Describe the intracranial findings of this examination.",
      isActive: true,
      createdBy: marker,
    });

    await db.insert(pacsSettingsTable).values({
      key: "orthanc_base_url",
      category: "orthanc",
      value: "http://orthanc.vitest.invalid:8042",
    });

    await upsertProvider("ollama", { endpointUrl: local.baseUrl, defaultModel: "qwen3-vl:8b" });
    await upsertProvider("deepseek", { defaultModel: "deepseek-v4-flash-vision-exp" });
    // Named local, pointed at a public address: the case PR-A closed the label hole for.
    await upsertProvider("local_openai_compatible", {
      endpointUrl: `https://${PUBLIC_LABELLED_HOST}/v1`,
      defaultModel: "bonsai",
    });

    process.env.DEEPSEEK_API_KEY = "vitest-cloud-key-not-real";

    // Orthanc and the cloud vendor both answer through one stub: Orthanc must reply
    // in every case, because every case asks for a study's images.
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : (input as { url?: string })?.url ?? "");
      if (url.includes("/dicom-web/")) {
        if (url.endsWith("/series")) {
          return json([
            { "0020000D": { Value: [STUDY] }, "0020000E": { Value: ["1.2.3.10"] } },
            { "0020000D": { Value: [STUDY] }, "0020000E": { Value: ["1.2.3.11"] } },
          ]);
        }
        if (url.endsWith("/instances")) {
          return json([{ "00080018": { Value: ["1.2.3.10.1"] }, "0020000E": { Value: ["1.2.3.10"] } }]);
        }
        if (url.includes("/rendered")) {
          return new Response(JPEG, { status: 200, headers: { "Content-Type": "image/jpeg" } });
        }
        return json([]);
      }
      let parsed: unknown = null;
      try {
        parsed = init?.body ? JSON.parse(String(init.body)) : null;
      } catch {
        parsed = null;
      }
      outbound.push({ url, images: imageCountIn(parsed) });
      return modelAnswerFor(url);
    }) as typeof fetch;

    await setGlobal({ aiSecurityMode: "clinical" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });
  });

  afterEach(() => {
    localChats.length = 0;
    outbound.length = 0;
    local.baseUrl = `http://127.0.0.1:${localPort}`;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (savedEnvKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedEnvKey;
    if (localServer) {
      await new Promise<void>((resolve) => localServer!.close(() => resolve()));
    }

    await db
      .delete(aiReportingAuditLogsTable)
      .where(eq(aiReportingAuditLogsTable.studyInstanceUID, STUDY))
      .catch(() => undefined);
    await db
      .delete(aiReportingAuditLogsTable)
      .where(eq(aiReportingAuditLogsTable.userName, staffLabel))
      .catch(() => undefined);
    await db
      .delete(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.studyInstanceUID, STUDY))
      .catch(() => undefined);
    await db
      .delete(aiPromptTemplatesTable)
      .where(eq(aiPromptTemplatesTable.createdBy, marker))
      .catch(() => undefined);
    await db
      .delete(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .catch(() => undefined);
    await db
      .delete(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, "orthanc_base_url"))
      .catch(() => undefined);
    for (const p of ["__global__", "ollama", "deepseek", "local_openai_compatible"]) {
      await db
        .delete(aiProviderSettingsTable)
        .where(eq(aiProviderSettingsTable.provider, p))
        .catch(() => undefined);
    }
    await db
      .delete(portalSessionsTable)
      .where(eq(portalSessionsTable.subjectId, userId))
      .catch(() => undefined);
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => undefined);
  });

  const cloudCalls = () => outbound.filter((c) => c.url.includes(CLOUD_HOST));
  const labelledPublicCalls = () => outbound.filter((c) => c.url.includes(PUBLIC_LABELLED_HOST));

  // ── DEVELOPMENT MODE ────────────────────────────────────────────────────────

  it("TEST 1 — Development + local Ollama + images: the pixels arrive, nothing is asked for", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postDraft({ provider: "ollama" });
    expect(res.status).toBe(200);
    expect(res.body?.impression).toBe("No acute intracranial abnormality.");
    expect(res.body?.failure).toBeNull();
    expect(localChats).toHaveLength(1);
    expect(localChats[0].images).toBe(2);
    expect(cloudCalls()).toHaveLength(0);

    const [row] = await auditRows();
    expect(row.endpointLocality).toBe("local");
    expect(row.imageSourceTypes).toBe("DICOM,DICOM");
    expect(row.numImages).toBe(2);
    expect(row.success).toBe(true);
  });

  it("TEST 2 — Development + cloud + opt-in OFF: refused before any socket", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postDraft({ provider: "deepseek" });
    expect(res.status).toBe(502);
    expect(res.body?.failure?.code).toBe("IMAGE_EGRESS_BLOCK");
    expect(res.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_BLOCKED");
    expect(cloudCalls()).toHaveLength(0);
    expect(localChats).toHaveLength(0);
  });

  it("TEST 3 — Development + cloud + opt-in ON: the study's pixels reach the cloud endpoint", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await postDraft({ provider: "deepseek" });
    expect(res.status).toBe(200);
    expect(res.body?.provider).toBe("deepseek");
    expect(cloudCalls()).toHaveLength(1);
    expect(cloudCalls()[0].images).toBe(2);

    // No attestation was sent, and none was needed — which is what Development mode
    // means — while the audit row still names where the bytes went.
    const [row] = await auditRows();
    expect(row.endpointLocality).toBe("cloud");
    expect(row.imageSourceTypes).toBe("DICOM,DICOM");
    expect(row.correlationId).toBeTruthy();
  });

  it("TEST 6 — a body that asserts cloudVisionAllowed authorises nothing", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postDraft({
      provider: "deepseek",
      // Invented keys. Even if a future body schema grew one, the value the gate
      // acts on comes from the stored row.
      cloudVisionAllowed: true,
      requireAttestation: false,
      imageSourceTypes: ["OPERATOR_SUPPLIED"],
    });
    expect(res.status).toBe(502);
    expect(res.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_BLOCKED");
    expect(cloudCalls()).toHaveLength(0);
  });

  it("TEST 14 — the mode is read per send, so a switch changes the next request, not the process", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });
    const first = await postDraft({ provider: "deepseek" });
    expect(first.status).toBe(200);

    // Same process, same module registry, no restart and no re-import.
    await setGlobal({ aiSecurityMode: "clinical" });
    const second = await postDraft({ provider: "deepseek" });
    expect(second.status).toBe(502);
    expect(second.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_UNATTESTED");
    expect(cloudCalls()).toHaveLength(1);
  });

  // ── CLINICAL MODE ───────────────────────────────────────────────────────────

  it("TEST 4 — Clinical + cloud + opt-in ON + no attestation: refused, and the refusal is filed", async () => {
    await setGlobal({ aiSecurityMode: "clinical" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await postDraft({ provider: "deepseek" });
    expect(res.status).toBe(502);
    expect(res.body?.failure?.code).toBe("IMAGE_EGRESS_BLOCK");
    expect(res.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_UNATTESTED");
    expect(cloudCalls()).toHaveLength(0);

    // The refusal sentence is composed from the provenance list the GATE received, so
    // this is also the proof that the frames reached it labelled: an omission would
    // read "unknown source" here while the audit row still claimed DICOM.
    expect(String(res.body?.diagnostics?.errorMessage ?? "")).toContain(
      "Patient-derived images (DICOM, DICOM)",
    );

    const [row] = await auditRows();
    expect(row.success).toBe(false);
    expect(row.numImages).toBe(2);
    // The bytes never moved, so the endpoint was never resolved: recorded as the
    // destination this request was addressed to, which the send layer still names.
    expect(row.endpointLocality).toBe("cloud");
  });

  it("TEST 5 — Clinical + cloud + opt-in ON + the clinician's confirmation: allowed", async () => {
    await setGlobal({ aiSecurityMode: "clinical" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await postDraft({ provider: "deepseek", attestCloudImageEgress: true });
    expect(res.status).toBe(200);
    expect(cloudCalls()).toHaveLength(1);
    expect(cloudCalls()[0].images).toBe(2);

    // Whose confirmation this was is the SESSION's answer, and the row proves it: the
    // attester recorded is the clinician who sent the request, which is the one field
    // a browser could not overwrite.
    const [row] = await auditRows();
    expect(row.userId).toBe(userId);
    expect(row.endpointLocality).toBe("cloud");
  });

  it("TEST 5b — an attestation asserted as false is not an attestation", async () => {
    await setGlobal({ aiSecurityMode: "clinical" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await postDraft({ provider: "deepseek", attestCloudImageEgress: false });
    expect(res.status).toBe(502);
    expect(res.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_UNATTESTED");
    expect(cloudCalls()).toHaveLength(0);
  });

  it("TEST 7 — a mode the server has never heard of reads as Clinical", async () => {
    // Written straight to the row, because the settings route refuses to store one:
    // this is the hand-edited / older-build database case.
    await setGlobal({ aiSecurityMode: "developr" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const cloud = await postDraft({ provider: "deepseek" });
    expect(cloud.status).toBe(502);
    expect(cloud.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_UNATTESTED");
    expect(cloudCalls()).toHaveLength(0);

    // The same unreadable value never loosens the local arm into a cloud call.
    const localRes = await postDraft({ provider: "ollama" });
    expect(localRes.status).toBe(200);
    expect(cloudCalls()).toHaveLength(0);
  });

  it("TEST 8 — an unreadable cloud-vision setting sends nothing, even in Development mode", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });
    // Corrupt the stored blob the opt-in is read from: the reader's own fail-safe
    // answer is "not permitted", and a request cannot vote on that.
    const [cfg] = await db
      .select({ id: aiSchedulerConfigTable.id })
      .from(aiSchedulerConfigTable)
      .limit(1);
    expect(cfg).toBeTruthy();
    await db
      .update(aiSchedulerConfigTable)
      .set({ overnightOpsJson: "{\"deepseekCloudVisionAllowed\": true" } as Partial<typeof aiSchedulerConfigTable.$inferInsert>)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(eq(aiSchedulerConfigTable.id, (cfg as any).id));

    const res = await postDraft({ provider: "deepseek", attestCloudImageEgress: true });
    expect(res.status).toBe(502);
    expect(res.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_BLOCKED");
    expect(cloudCalls()).toHaveLength(0);

    // Strictness about egress is not a blanket outage: local inference still runs.
    const localRes = await postDraft({ provider: "ollama" });
    expect(localRes.status).toBe(200);
  });

  it("TEST 9 — a provider NAMED local and pointed at a public endpoint is judged as cloud", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postDraft({ provider: "local_openai_compatible" });
    expect(res.status).toBe(502);
    // A name-based reading would have waved this through as local with no opt-in
    // needed. Only an endpoint-derived cloud classification produces this code.
    expect(res.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_BLOCKED");
    expect(labelledPublicCalls()).toHaveLength(0);
  });

  it("TEST 10 — a failing local arm never becomes a cloud call", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    local.baseUrl = "http://127.0.0.1:1";
    const res = await postDraft({ provider: "ollama" });

    expect(res.status).toBe(502);
    expect(res.body?.resolution?.provider).toBe("ollama");
    expect(res.body?.failure?.provider).toBe("ollama");
    expect(res.body?.failure?.code).not.toBe("IMAGE_EGRESS_BLOCK");
    expect(cloudCalls()).toHaveLength(0);
  });

  it("TEST 12 — the answer stays a draft: nothing is signed and nothing is inserted into a report", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postDraft({ provider: "ollama" });
    expect(res.status).toBe(200);
    expect(String(res.body?.aiSafetyLabel ?? "")).toMatch(/Requires Radiologist Review/);

    const [wl] = await db
      .select({
        status: radiologyWorklistTable.status,
        reportId: radiologyWorklistTable.reportId,
      })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .limit(1);
    expect(wl.reportId).toBeFalsy();
    expect(String(wl.status ?? "")).not.toMatch(/FINAL|DELIVERED|SIGNED/);

    const drafts = await db
      .select({ status: aiReportingDraftsTable.status })
      .from(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.studyInstanceUID, STUDY));
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.status === "draft")).toBe(true);
  });

  it("POST /query carries the same policy: cloud needs the opt-in, local never does", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const refused = await postQuery({ provider: "deepseek" });
    expect(refused.status).toBe(502);
    expect(refused.body?.failure?.detailCode).toBe("PHI_IMAGE_CLOUD_BLOCKED");
    expect(cloudCalls()).toHaveLength(0);

    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });
    const allowed = await postQuery({ provider: "deepseek" });
    expect(allowed.status).toBe(200);
    expect(allowed.body?.numImages).toBe(2);
    expect(cloudCalls()).toHaveLength(1);
    expect(cloudCalls()[0].images).toBe(2);

    const textOnly = await postQuery({ provider: "ollama", maxImages: 0 });
    expect(textOnly.status).toBe(200);
    expect(textOnly.body?.numImages).toBe(0);
  });

  it("POST /image-review states its pixels' provenance on the row it files", async () => {
    await setGlobal({ aiSecurityMode: "clinical" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    // The global default resolves to Ollama here, so this pins the local arm under
    // Clinical mode: patient frames, no attestation, sent anyway — because nothing
    // leaves the clinic. §6 of the owner's brief.
    const res = await request(app)
      .post("/api/ai-reporting/image-review")
      .set("Authorization", `Bearer ${token}`)
      .send({ worklistId, reportBody: "Findings for review." });
    expect(res.status).toBe(200);
    expect(localChats).toHaveLength(1);

    const [row] = await auditRows();
    expect(row.endpointLocality).toBe("local");
    expect(row.imageSourceTypes).toBe("DICOM,DICOM");
  });

  // ── MODEL COMPARISON ROUTE ──────────────────────────────────────────────────

  it("TEST 1c — Development comparison: local arm answers with its pixels", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postCompare({
      providers: ["ollama"],
      images: [JPEG.toString("base64")],
    });
    expect(res.status).toBe(200);
    expect(res.body?.results?.[0]?.success).toBe(true);
    expect(localChats).toHaveLength(1);
    expect(localChats[0].images).toBe(1);
  });

  it("TEST 2c — Development comparison: the cloud arm is refused while the local arm still answers", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postCompare({
      providers: ["ollama", "deepseek"],
      images: [JPEG.toString("base64")],
    });
    expect(res.status).toBe(200);
    const byProvider = Object.fromEntries(
      (res.body?.results ?? []).map((r: { provider: string; success: boolean; error: string | null }) => [
        r.provider,
        `${r.success}:${r.error ?? ""}`,
      ]),
    );
    expect(String(byProvider["ollama"])).toMatch(/^true:/);
    // This surface answers with the gate's own sentence and no `failure.code` object
    // (unlike `/draft`, which C1 gave one). The two refusals are distinguishable by
    // their wording, which is what a clinician reads here, so the assertion is on the
    // term that differs: an un-set opt-in versus an un-attested patient.
    expect(String(byProvider["deepseek"])).toContain("without explicit cloudVisionAllowed");
    // TEST 11 at this route: a cloud refusal is that arm's answer, not the run's.
    expect(cloudCalls()).toHaveLength(0);
    expect(localChats).toHaveLength(1);
  });

  it("TEST 3c — Development comparison with the opt-in on: both arms see the same picture", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await postCompare({
      providers: ["ollama", "deepseek"],
      images: [JPEG.toString("base64")],
    });
    expect(res.status).toBe(200);
    const results = res.body?.results ?? [];
    expect(results.filter((r: { success: boolean }) => r.success)).toHaveLength(2);
    expect(cloudCalls()).toHaveLength(1);
    expect(cloudCalls()[0].images).toBe(1);
    expect(localChats).toHaveLength(1);

    const rows = await auditRowsByUser(2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.endpointLocality).sort()).toEqual(["cloud", "local"]);
    expect(rows.every((r) => r.numImages === 1)).toBe(true);
  });

  it("TEST 4c — Clinical comparison: unattributed pixels need the clinician's confirmation", async () => {
    await setGlobal({ aiSecurityMode: "clinical" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const unattested = await postCompare({
      providers: ["deepseek"],
      images: [JPEG.toString("base64")],
    });
    expect(unattested.body?.results?.[0]?.success).toBe(false);
    // The different refusal: Clinical mode demanded an attestation these
    // body-supplied pixels could not answer for.
    expect(String(unattested.body?.results?.[0]?.error ?? "")).toContain("provenance is unverified");
    expect(cloudCalls()).toHaveLength(0);

    const attested = await postCompare({
      providers: ["deepseek"],
      images: [JPEG.toString("base64")],
      attestCloudImageEgress: true,
    });
    expect(attested.body?.results?.[0]?.success).toBe(true);
    expect(cloudCalls()).toHaveLength(1);
  });

  it("TEST 6c — the comparison route's opt-in comes from the row, not the request", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await postCompare({
      providers: ["deepseek"],
      images: [JPEG.toString("base64")],
      cloudVisionAllowed: true,
    });
    expect(res.body?.results?.[0]?.success).toBe(false);
    expect(String(res.body?.results?.[0]?.error ?? "")).toContain("without explicit cloudVisionAllowed");
    expect(cloudCalls()).toHaveLength(0);
  });

  it("TEST 12c — a comparison winner is a saved preference, never a signed report", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    const saved = await request(app)
      .post("/api/ai-comparison/save-winner")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Describe this examination.", provider: "ollama", response: MODEL_ANSWER });
    expect(saved.status).toBe(200);
    expect(String(saved.body?.aiSafetyLabel ?? "")).toMatch(/Requires Radiologist Review/);

    const [wl] = await db
      .select({ status: radiologyWorklistTable.status, reportId: radiologyWorklistTable.reportId })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .limit(1);
    expect(wl.reportId).toBeFalsy();
    expect(String(wl.status ?? "")).not.toMatch(/FINAL|DELIVERED|SIGNED/);
  });

  it("authz is unchanged: an unauthenticated comparison request never reaches a provider", async () => {
    const res = await request(app)
      .post("/api/ai-comparison/run")
      .send({ prompt: "Describe this examination.", providers: ["ollama"] });
    expect(res.status).toBe(401);
    expect(localChats).toHaveLength(0);
    expect(cloudCalls()).toHaveLength(0);
  });

  // ── THE COMPOSER'S STRICTER DOOR, MEASURED UNTOUCHED ───────────────────────
  //
  // `POST /api/radiology/report-composer/vision-trial` is judged by a different gate —
  // `assertGatewayPrivacy` — which in addition to everything above demands a
  // `PixelEgressProof`, the record of an on-premises raster inspection. No caller on
  // this server produces one (`imageDeidentification.ts` is written, tested, and
  // connected to nobody), so that path stays refused in both modes and PR-A2B does
  // not change it. These four cases are the measurement of that claim, including the
  // one way a "fix" could have been faked: satisfying the door from the request body.

  const trial = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/radiology/report-composer/vision-trial")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clinicalPrompt: "Describe the visible structures.",
        // The local arm is skipped on purpose: this is about the door on the cloud
        // arm, and a skipped arm still answers with its own verdict.
        runLocal: false,
        images: [{ mimeType: "image/jpeg", base64: JPEG.toString("base64") }],
        ...body,
      });

  it("TEST 13 — Development mode does not open the Composer's proof door", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await trial({ confirmCloudVisionTrial: true });
    expect(res.status, `body: ${res.text.slice(0, 400)}`).toBe(200);
    expect(res.body?.deepseek?.ok).toBe(false);
    expect(res.body?.deepseek?.safeError).toBe("cloud_image_not_verified");
    expect(res.body?.writesClinicalReport).toBe(false);
  });

  it("TEST 13b — a proof object in the request body is not a proof", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await trial({
      confirmCloudVisionTrial: true,
      // Exactly the shape `PixelEgressProof` has, and exactly what the gate will not
      // accept from outside the process: a proof carries the bytes it checked, so it
      // can only come from the thing that checked them.
      pixelProof: { posture: "clean", images: [{ base64: JPEG.toString("base64"), mimeType: "image/jpeg" }] },
    });
    expect(res.body?.deepseek?.ok).toBe(false);
    expect(res.body?.deepseek?.safeError).toBe("cloud_image_not_verified");
  });

  it("TEST 13c — the trial's stored opt-in is the authority, not the body's", async () => {
    await setGlobal({ aiSecurityMode: "development" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: false });

    const res = await trial({ confirmCloudVisionTrial: true, cloudVisionAllowed: true });
    expect(res.body?.deepseek?.ok).toBe(false);
    // Refused one step before the proof check: the clinic's own flag is off.
    expect(res.body?.deepseek?.safeError).toBe("cloud_vision_trial_not_confirmed");
  });

  it("TEST 13d — Clinical mode meets the same door: the proof term is not mode-dependent", async () => {
    await setGlobal({ aiSecurityMode: "clinical" });
    await saveOvernightOpsControls({ deepseekCloudVisionAllowed: true });

    const res = await trial({ confirmCloudVisionTrial: true });
    expect(res.body?.deepseek?.ok).toBe(false);
    expect(res.body?.deepseek?.safeError).toBe("cloud_image_not_verified");
  });
});
